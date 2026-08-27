import {
  buildReportPreview,
  compareHypotheses,
  getCaseSummary,
  getRecentActivity,
  getWorkspaceState,
  validateConsistency,
  type ActivityEvent,
  type ConsistencyValidationScope,
  type ReplayCase,
  type ReplayCommandResult,
  type ReplayEngine,
  type ReplayStagedCommand,
  type WorkspaceItemType as DomainWorkspaceItemType,
  type WorkspaceMode,
} from "../domain";
import type {
  ActivityAuthorFilter,
  ReplayAdapterResult,
  ReplayInvocationContext,
  ReplayToolInvocationAudit,
  ReplayWebMCPAdapter,
  ReplayWebMCPCommand,
  WorkspaceItemType,
  WorkspaceSection,
} from "../webmcp";
import { ReplayWebMCPContractError } from "../webmcp";

export interface ReplayAdapterUiBridge {
  getCase: () => ReplayCase;
  hasReportPreview: () => boolean;
  persistCase?: (
    replayCase: ReplayCase,
    options: Readonly<{ expectedCaseVersion: number; compensation?: true }>,
  ) => Promise<void>;
  setReportPreview: (preview: ReturnType<typeof buildReportPreview>) => void;
  setAgentWorking: (active: boolean, toolName?: string) => void;
  revealAffected: (ids: readonly string[]) => void;
  focusIssue: (issueId: string, affectedIds: readonly string[]) => void;
  setComparison: (ids: string[]) => void;
  getVisibleActivity?: () => readonly ActivityEvent[];
  recordToolInvocation?: (audit: ReplayToolInvocationAudit) => void;
  getMutationBlockReason?: () => string | undefined;
}

function resultFromDomain(result: ReplayCommandResult): ReplayAdapterResult {
  return {
    ok: result.ok,
    message: result.message,
    caseVersion: result.caseVersion,
    ...(result.ok && result.activityId ? { activityId: result.activityId } : {}),
    ...(result.ok && result.idempotent ? { idempotent: true } : {}),
    affectedIds: result.affectedIds,
    issues: result.issues,
    ...(!result.ok ? { code: result.error.code } : {}),
    ...(!result.ok ? { data: { error: result.error } } : {}),
  };
}

function workspaceModeForItem(itemType: WorkspaceItemType): WorkspaceMode {
  if (itemType === "actor" || itemType === "trajectory" || itemType === "event") return "scene";
  if (itemType === "claim") return "facts";
  if (itemType === "evidence") return "evidence";
  if (itemType === "question") return "questions";
  if (itemType === "hypothesis") return "hypotheses";
  return "report";
}

function domainItemType(itemType: WorkspaceItemType): DomainWorkspaceItemType {
  if (itemType === "event") return "timeline-event";
  if (itemType === "issue") return "report";
  return itemType;
}

function scopeForWebMCP(scope: string): ConsistencyValidationScope {
  if (scope === "scene") return "scene";
  if (scope === "timeline" || scope === "provenance" || scope === "report") return scope;
  return "all";
}

function ensureNotAborted(context: ReplayInvocationContext): void {
  if (context.signal.aborted)
    throw context.signal.reason ?? new DOMException("Cancelled", "AbortError");
}

function mutationMeta(command: ReplayWebMCPCommand) {
  return {
    actor: "agent" as const,
    origin: "webmcp" as const,
    requestId: command.requestId,
    expectedVersion: command.expectedVersion,
  };
}

function id(prefix: string, requestId: string): string {
  return `${prefix}-${requestId}`.slice(0, 128);
}

function newSceneActorId(replayCase: ReplayCase): string {
  const existingActorIds = new Set(replayCase.actors.map((actor) => actor.id));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = `actor-${crypto.randomUUID()}`;
    if (!existingActorIds.has(candidate)) return candidate;
  }
  throw new Error("Unable to allocate a unique scene actor ID.");
}

function adapterFailure(
  replayCase: ReplayCase,
  code: string,
  message: string,
): ReplayAdapterResult {
  return {
    ok: false,
    message,
    code,
    caseVersion: replayCase.caseVersion,
    affectedIds: [],
    issues: replayCase.consistencyIssues,
  };
}

export function createReplayWebMCPAdapter(
  engine: ReplayEngine,
  ui: ReplayAdapterUiBridge,
): ReplayWebMCPAdapter {
  let mutationQueue: Promise<void> = Promise.resolve();

  const serializeMutation = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = mutationQueue;
    let release: (() => void) | undefined;
    mutationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
    }
  };

  const settleStagedMutation = async (
    staged: ReplayStagedCommand,
    context: ReplayInvocationContext,
  ): Promise<ReplayAdapterResult> => {
    if (!staged.result.ok || !staged.changed) {
      return resultFromDomain(staged.commit({ signal: context.signal }));
    }

    let persistenceCompleted = false;
    const liveBefore = engine.getState();
    const stagedState = staged.state;
    try {
      ensureNotAborted(context);
      if (ui.persistCase) {
        await ui.persistCase(stagedState, {
          expectedCaseVersion: liveBefore.caseVersion,
        });
        persistenceCompleted = true;
      }
      ensureNotAborted(context);
      const committed = staged.commit({ signal: context.signal });
      if (!committed.ok && persistenceCompleted && ui.persistCase) {
        try {
          await ui.persistCase(engine.getState(), {
            expectedCaseVersion: stagedState.caseVersion,
            compensation: true,
          });
        } catch {
          return adapterFailure(
            engine.getState(),
            "PERSISTENCE_FAILED",
            "The case changed during persistence and the durable rollback could not be confirmed. The live mutation was not committed.",
          );
        }
      }
      return resultFromDomain(committed);
    } catch (error) {
      staged.discard();
      let rollbackFailed = false;
      if (persistenceCompleted && ui.persistCase) {
        try {
          await ui.persistCase(engine.getState(), {
            expectedCaseVersion: stagedState.caseVersion,
            compensation: true,
          });
        } catch {
          rollbackFailed = true;
        }
      }
      if (context.signal.aborted && !rollbackFailed) {
        throw context.signal.reason ?? error;
      }
      const detail = error instanceof Error ? error.message : "The local save failed.";
      return adapterFailure(
        engine.getState(),
        "PERSISTENCE_FAILED",
        rollbackFailed
          ? `The mutation was not committed, but durable rollback could not be confirmed: ${detail}`
          : `The mutation was not committed because persistence failed: ${detail}`,
      );
    }
  };

  const executeUnlocked = async (
    command: ReplayWebMCPCommand,
    context: ReplayInvocationContext,
  ): Promise<ReplayAdapterResult> => {
    ensureNotAborted(context);
    const replayCase = ui.getCase();
    const blockedReason = ui.getMutationBlockReason?.();
    const payload = command.payload;
    const meta = mutationMeta(command);
    let domainCommand: Record<string, unknown>;

    switch (command.type) {
      case "upsert_scene_actor": {
        const actorId =
          typeof payload.actorId === "string" ? payload.actorId : newSceneActorId(replayCase);
        const existing = replayCase.actors.find((actor) => actor.id === actorId);
        const position = payload.position as { x: number; y: number };
        const dimensions = payload.dimensions as { width: number; length: number };
        domainCommand = {
          type: "actor.upsert",
          ...meta,
          sceneActor: {
            id: actorId,
            label: payload.label,
            kind: "vehicle",
            dimensions,
            colorToken: payload.colorToken ?? existing?.colorToken ?? "vehicle-muted-blue",
            pose: { x: position.x * 100, y: position.y * 100, rotationDeg: payload.rotationDeg },
            locked: existing?.locked ?? false,
            ...(existing?.lock ? { lock: existing.lock } : {}),
            damageMarkers: existing?.damageMarkers ?? [],
          },
        };
        break;
      }
      case "set_actor_trajectory": {
        const frames = payload.keyframes as Array<{
          id?: string;
          timeMs: number;
          x: number;
          y: number;
          rotationDeg: number;
        }>;
        const existing = replayCase.trajectories.find(
          (trajectory) =>
            trajectory.actorId === payload.actorId && trajectory.branchId === payload.branchId,
        );
        domainCommand = {
          type: "trajectory.set",
          ...meta,
          ...(existing ? { trajectoryId: existing.id } : {}),
          actorId: payload.actorId,
          branchId: payload.branchId,
          keyframes: frames.map((frame) => ({
            ...(frame.id ? { id: frame.id } : {}),
            timeMs: frame.timeMs,
            x: frame.x * 100,
            y: frame.y * 100,
            rotationDeg: frame.rotationDeg,
          })),
          visible: true,
        };
        break;
      }
      case "propose_scene_changes": {
        const changes = payload.changes as Array<
          | {
              kind: "actor-pose";
              actorId: string;
              proposedPose: { x: number; y: number; rotationDeg: number };
            }
          | {
              kind: "trajectory-set";
              trajectoryId?: string;
              actorId: string;
              branchId: string;
              keyframes: Array<{
                id?: string;
                timeMs: number;
                x: number;
                y: number;
                rotationDeg: number;
              }>;
              visible: boolean;
            }
        >;
        domainCommand = {
          type: "proposal.create",
          ...meta,
          proposalId:
            typeof payload.proposalId === "string"
              ? payload.proposalId
              : id("proposal", command.requestId),
          title: payload.title,
          rationale: payload.rationale,
          revisionSummary: "Initial coordinated scene proposal from Site Tools.",
          changes: changes.map((change) =>
            change.kind === "actor-pose"
              ? {
                  kind: change.kind,
                  actorId: change.actorId,
                  proposedPose: {
                    x: change.proposedPose.x * 100,
                    y: change.proposedPose.y * 100,
                    rotationDeg: change.proposedPose.rotationDeg,
                  },
                }
              : {
                  kind: change.kind,
                  ...(change.trajectoryId ? { trajectoryId: change.trajectoryId } : {}),
                  actorId: change.actorId,
                  branchId: change.branchId,
                  keyframes: change.keyframes.map((frame) => ({
                    ...(frame.id ? { id: frame.id } : {}),
                    timeMs: frame.timeMs,
                    x: frame.x * 100,
                    y: frame.y * 100,
                    rotationDeg: frame.rotationDeg,
                  })),
                  visible: change.visible,
                },
          ),
        };
        break;
      }
      case "mark_impact_event": {
        const location = payload.location as { x: number; y: number };
        domainCommand = {
          type: "timeline.upsert",
          ...meta,
          ...(typeof payload.eventId === "string" ? { eventId: payload.eventId } : {}),
          branchId: payload.branchId,
          timeMs: payload.timeMs,
          eventType: "impact",
          title: "Approximate contact",
          certainty: payload.status,
          linkedActorIds: payload.actorIds,
          location: { x: location.x * 100, y: location.y * 100 },
        };
        break;
      }
      case "mark_vehicle_damage": {
        const regionMap: Record<string, string> = {
          left: "left-side",
          right: "right-side",
          other: "unknown",
        };
        const sourceIds = payload.sourceIds as string[];
        const knownSourceIds = new Set([
          ...replayCase.evidence.map((asset) => asset.id),
          ...replayCase.claims.map((claim) => claim.id),
        ]);
        const unknownSourceIds = sourceIds.filter((sourceId) => !knownSourceIds.has(sourceId));
        if (unknownSourceIds.length > 0) {
          return adapterFailure(
            replayCase,
            "NOT_FOUND",
            `Damage source ${unknownSourceIds.join(", ")} ${unknownSourceIds.length === 1 ? "does" : "do"} not exist.`,
          );
        }
        domainCommand = {
          type: "damage.mark",
          ...meta,
          actorId: payload.actorId,
          region: regionMap[String(payload.damageRegion)] ?? payload.damageRegion,
          description: payload.description,
          status: payload.status,
          linkedEvidenceIds: sourceIds.filter((sourceId) =>
            replayCase.evidence.some((asset) => asset.id === sourceId),
          ),
          linkedClaimIds: sourceIds.filter((sourceId) =>
            replayCase.claims.some((claim) => claim.id === sourceId),
          ),
        };
        break;
      }
      case "add_observation": {
        const linkedIds = payload.linkedIds as string[];
        domainCommand = {
          type: "claim.add",
          ...meta,
          statement: payload.statement,
          status: payload.status,
          sourceType: payload.sourceType,
          sourceIds: linkedIds,
          linkedEvidenceIds: linkedIds.filter((linkedId) =>
            replayCase.evidence.some((asset) => asset.id === linkedId),
          ),
          linkedEventIds: linkedIds.filter((linkedId) =>
            replayCase.timelineEvents.some((event) => event.id === linkedId),
          ),
          linkedSceneObjectIds: linkedIds.filter(
            (linkedId) =>
              replayCase.actors.some((actor) => actor.id === linkedId) ||
              replayCase.trajectories.some((trajectory) => trajectory.id === linkedId),
          ),
          ...(typeof payload.branchId === "string" ? { branchId: payload.branchId } : {}),
          sharedAcrossBranches: payload.sharedAcrossBranches,
        };
        break;
      }
      case "link_evidence": {
        if (typeof payload.annotationId === "string") {
          const asset = replayCase.evidence.find(
            (candidate) => candidate.id === payload.evidenceId,
          );
          if (!asset?.annotations.some((annotation) => annotation.id === payload.annotationId)) {
            return {
              ok: false,
              message: `Annotation ${payload.annotationId} does not exist on evidence ${String(payload.evidenceId)}.`,
              code: "NOT_FOUND",
              caseVersion: replayCase.caseVersion,
              affectedIds: [],
              issues: [],
            };
          }
        }
        const targetMap: Record<string, string> = { event: "timeline-event" };
        const targetType = targetMap[String(payload.targetType)] ?? payload.targetType;
        if (
          ![
            "claim",
            "timeline-event",
            "actor",
            "trajectory",
            "damage",
            "hypothesis",
            "assumption",
          ].includes(String(targetType))
        ) {
          return {
            ok: false,
            message: `Evidence cannot be linked to ${String(payload.targetType)} with the current canonical model.`,
            code: "FORBIDDEN_ACTION",
            caseVersion: replayCase.caseVersion,
            affectedIds: [],
            issues: [],
          };
        }
        domainCommand = {
          type: "evidence.link",
          ...meta,
          evidenceId: payload.evidenceId,
          ...(typeof payload.annotationId === "string"
            ? { annotationId: payload.annotationId }
            : {}),
          targetType,
          targetId: payload.targetId,
        };
        break;
      }
      case "create_open_question": {
        const relatedIds = payload.relatedIds as string[];
        const relatedClaimIds = new Set(replayCase.claims.map((claim) => claim.id));
        const relatedBranchIds = new Set(replayCase.branches.map((branch) => branch.id));
        domainCommand = {
          type: "question.add",
          ...meta,
          question: payload.question,
          reason: payload.reason,
          importance: payload.importance,
          rankingReasons:
            payload.importance === "blocking" ? ["blocks-report"] : ["contextual-detail"],
          relatedClaimIds: relatedIds.filter((relatedId) => relatedClaimIds.has(relatedId)),
          relatedSceneObjectIds: relatedIds.filter(
            (relatedId) => !relatedClaimIds.has(relatedId) && !relatedBranchIds.has(relatedId),
          ),
          relatedBranchIds: relatedIds.filter((relatedId) => relatedBranchIds.has(relatedId)),
        };
        break;
      }
      case "fork_hypothesis": {
        const assumptions = payload.assumptions as Array<{
          statement: string;
          relatedIds: string[];
        }>;
        domainCommand = {
          type: "hypothesis.fork",
          ...meta,
          parentBranchId: payload.sourceBranchId,
          name: payload.name,
          description: payload.description,
          assumptions: assumptions.map((assumption) => ({
            statement: assumption.statement,
            supportingEvidenceIds: assumption.relatedIds,
            conflictingEvidenceIds: [],
          })),
        };
        break;
      }
      case "update_hypothesis_assumption": {
        const assumption = payload.assumption as
          { statement: string; relatedIds: string[] } | undefined;
        if (payload.operation === "add") {
          domainCommand = {
            type: "hypothesis.add-assumption",
            ...meta,
            branchId: payload.branchId,
            statement: assumption?.statement,
            supportingEvidenceIds: assumption?.relatedIds ?? [],
          };
        } else {
          domainCommand = {
            type: "hypothesis.update-assumption",
            ...meta,
            branchId: payload.branchId,
            assumptionId: payload.assumptionId,
            ...(assumption
              ? { statement: assumption.statement, supportingEvidenceIds: assumption.relatedIds }
              : {}),
            ...(payload.operation === "remove" ? { status: "withdrawn" } : {}),
          };
        }
        break;
      }
      case "add_report_note":
        domainCommand = {
          type: "report.add-note",
          ...meta,
          text: payload.note,
          claimIds: payload.claimIds,
          evidenceIds: payload.evidenceIds,
        };
        break;
      default:
        return {
          ok: false,
          message: "Unsupported mutation tool.",
          code: "INVALID_COMMAND",
          caseVersion: replayCase.caseVersion,
          affectedIds: [],
          issues: [],
        };
    }
    ensureNotAborted(context);
    const staged = engine.stage(
      domainCommand,
      { signal: context.signal },
      {
        operation: "webmcp-command",
        type: command.type,
        actor: command.actor,
        origin: command.origin,
        payload: command.payload,
      },
    );
    if (blockedReason && staged.changed) {
      staged.discard();
      return {
        ok: false,
        message: blockedReason,
        code: "VERSION_CONFLICT",
        caseVersion: replayCase.caseVersion,
        affectedIds: [],
        issues: replayCase.consistencyIssues,
      };
    }
    return settleStagedMutation(staged, context);
  };

  const execute = (
    command: ReplayWebMCPCommand,
    context: ReplayInvocationContext,
  ): Promise<ReplayAdapterResult> => serializeMutation(() => executeUnlocked(command, context));

  return {
    getLifecycle() {
      const replayCase = ui.getCase();
      return {
        caseOpen: true,
        sceneExists: Boolean(replayCase.sceneTemplateId),
        factsAvailable: true,
        baselineExists: replayCase.branches.length > 0,
        reportPreviewAvailable: ui.hasReportPreview(),
        caseVersion: replayCase.caseVersion,
        workspaceMode: replayCase.workspaceMode,
        ...(replayCase.selectedItem ? { selectedItemId: replayCase.selectedItem.id } : {}),
      };
    },
    subscribe(listener) {
      return engine.subscribe(() => listener());
    },
    getCaseSummary(context) {
      ensureNotAborted(context);
      return getCaseSummary(ui.getCase());
    },
    getWorkspaceState(sections: readonly WorkspaceSection[], context) {
      ensureNotAborted(context);
      const replayCase = ui.getCase();
      return Object.fromEntries(
        sections.map((section) => {
          if (section === "claims") return [section, getWorkspaceState(replayCase, "facts")];
          if (section === "selection") return [section, replayCase.selectedItem];
          return [section, getWorkspaceState(replayCase, section)];
        }),
      );
    },
    getRecentActivity(input: Readonly<{ limit: number; author: ActivityAuthorFilter }>, context) {
      ensureNotAborted(context);
      const replayCase = ui.getCase();
      const activity = ui.getVisibleActivity
        ? structuredClone([...ui.getVisibleActivity()]).sort((left, right) =>
            right.createdAt.localeCompare(left.createdAt),
          )
        : getRecentActivity(replayCase, replayCase.activity.length);
      const filtered =
        input.author === "all" ? activity : activity.filter((item) => item.author === input.author);
      return filtered.slice(0, input.limit);
    },
    validateConsistency(input, context) {
      ensureNotAborted(context);
      const replayCase = ui.getCase();
      if (
        input.branchId !== undefined &&
        !replayCase.branches.some((branch) => branch.id === input.branchId)
      ) {
        throw new ReplayWebMCPContractError(
          "NOT_FOUND",
          `Hypothesis branch ${input.branchId} does not exist.`,
        );
      }
      return validateConsistency(replayCase, {
        scope: scopeForWebMCP(input.scope),
        ...(input.branchId ? { branchId: input.branchId } : {}),
      });
    },
    compareHypotheses(input, context) {
      ensureNotAborted(context);
      const replayCase = ui.getCase();
      const [baseline, ...alternatives] = input.branchIds;
      if (!baseline || alternatives.length === 0)
        throw new ReplayWebMCPContractError(
          "INVALID_INPUT",
          "Choose at least two hypothesis branches.",
        );
      const unknownBranchIds = input.branchIds.filter(
        (branchId) => !replayCase.branches.some((branch) => branch.id === branchId),
      );
      if (unknownBranchIds.length > 0) {
        throw new ReplayWebMCPContractError(
          "NOT_FOUND",
          `Hypothesis branch ${unknownBranchIds.join(", ")} ${unknownBranchIds.length === 1 ? "does" : "do"} not exist.`,
        );
      }
      const comparison = {
        branchIds: [...input.branchIds],
        pairwiseComparisons: alternatives.map((alternative) =>
          compareHypotheses(replayCase, baseline, alternative),
        ),
      };
      ensureNotAborted(context);
      ui.setComparison([...input.branchIds]);
      return comparison;
    },
    focusWorkspaceItem(input, context) {
      return serializeMutation(async () => {
        ensureNotAborted(context);
        const replayCase = ui.getCase();
        if (input.itemType === "issue") {
          const issue = replayCase.consistencyIssues.find(
            (candidate) => candidate.id === input.itemId,
          );
          if (!issue) {
            return {
              ok: false,
              message: `Consistency issue ${input.itemId} does not exist.`,
              code: "NOT_FOUND",
              caseVersion: replayCase.caseVersion,
              affectedIds: [],
              issues: replayCase.consistencyIssues,
            };
          }
          const focusResult = await settleStagedMutation(
            engine.stage(
              {
                type: "workspace.focus",
                actor: "agent",
                origin: "webmcp",
                itemType: "report",
                itemId: replayCase.reportSnapshots.at(-1)?.id ?? "report-preview",
                workspaceMode: "report",
              },
              { signal: context.signal },
            ),
            context,
          );
          if (!focusResult.ok) return focusResult;
          ui.focusIssue(issue.id, issue.affectedIds);
          return {
            ...focusResult,
            message: `Focused consistency issue: ${issue.title}`,
            affectedIds: issue.affectedIds,
          };
        }
        const mode =
          (input.workspaceMode as WorkspaceMode | undefined) ??
          workspaceModeForItem(input.itemType);
        return settleStagedMutation(
          engine.stage(
            {
              type: "workspace.focus",
              actor: "agent",
              origin: "webmcp",
              itemType: domainItemType(input.itemType),
              itemId: input.itemId,
              workspaceMode: mode,
            },
            { signal: context.signal },
          ),
          context,
        );
      });
    },
    revertAgentAction(input, context) {
      return serializeMutation(async () => {
        ensureNotAborted(context);
        const blockedReason = ui.getMutationBlockReason?.();
        const activity = ui.getCase().activity.find((item) => item.id === input.activityId);
        if (!activity?.requestId)
          return {
            ok: false,
            message: "This activity has no reversible agent request ID.",
            code: "UNSAFE_REVERT",
            caseVersion: ui.getCase().caseVersion,
            affectedIds: [],
            issues: [],
          };
        const staged = engine.stageAgentActionRevert(
          activity.requestId,
          {
            actor: "agent",
            origin: "webmcp",
            requestId: input.requestId,
            expectedVersion: input.expectedVersion,
          },
          { signal: context.signal },
          {
            operation: "webmcp-agent-action-revert",
            type: "revert_agent_action",
            actor: "agent",
            origin: "webmcp",
            payload: { activityId: input.activityId },
          },
        );
        if (blockedReason && staged.changed) {
          staged.discard();
          return {
            ok: false,
            message: blockedReason,
            code: "VERSION_CONFLICT",
            caseVersion: ui.getCase().caseVersion,
            affectedIds: [],
            issues: ui.getCase().consistencyIssues,
          };
        }
        return settleStagedMutation(staged, context);
      });
    },
    execute,
    buildReportPreview(input, context) {
      ensureNotAborted(context);
      const replayCase = ui.getCase();
      if (input.expectedVersion !== replayCase.caseVersion)
        return {
          ok: false,
          message: `Expected case version ${input.expectedVersion}, but the current version is ${replayCase.caseVersion}.`,
          code: "VERSION_CONFLICT",
          caseVersion: replayCase.caseVersion,
          affectedIds: [],
          issues: replayCase.consistencyIssues,
        };
      if (input.branchId !== undefined) {
        const branch = replayCase.branches.find((candidate) => candidate.id === input.branchId);
        if (!branch) {
          return adapterFailure(
            replayCase,
            "NOT_FOUND",
            `Hypothesis branch ${input.branchId} does not exist.`,
          );
        }
        if (branch.status !== "active") {
          return adapterFailure(
            replayCase,
            "INVALID_INPUT",
            `Hypothesis branch ${input.branchId} is archived and cannot be previewed.`,
          );
        }
      }
      const preview = buildReportPreview(
        replayCase,
        input.branchId ? { branchIds: [input.branchId] } : {},
      );
      ui.setReportPreview(preview);
      return {
        ok: true,
        message:
          preview.missingRequirements.length > 0
            ? `Built and opened the preview with ${String(preview.missingRequirements.length)} missing requirements for human review.`
            : "Built and opened a neutral report preview for human review.",
        caseVersion: replayCase.caseVersion,
        affectedIds: ["report-preview"],
        issues: replayCase.consistencyIssues,
        data: {
          previewVersion: preview.caseVersion,
          missingRequirements: preview.missingRequirements,
          unresolvedQuestionIds: preview.unresolvedQuestionIds,
        },
      };
    },
    setAgentWorking(state) {
      ui.setAgentWorking(state.active, state.active ? state.toolName : undefined);
    },
    revealAffected(ids) {
      ui.revealAffected(ids);
    },
    recordToolInvocation(audit) {
      ui.recordToolInvocation?.(audit);
    },
  };
}
