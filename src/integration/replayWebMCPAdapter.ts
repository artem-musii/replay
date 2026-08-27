import {
  buildReportPreview,
  compareHypotheses,
  getCaseSummary,
  getRecentActivity,
  getWorkspaceState,
  validateConsistency,
  type ConsistencyValidationScope,
  type ReplayCase,
  type ReplayCommandResult,
  type ReplayEngine,
  type WorkspaceItemType as DomainWorkspaceItemType,
  type WorkspaceMode,
} from "../domain";
import type {
  ActivityAuthorFilter,
  ReplayAdapterResult,
  ReplayInvocationContext,
  ReplayWebMCPAdapter,
  ReplayWebMCPCommand,
  WorkspaceItemType,
  WorkspaceSection,
} from "../webmcp";

export interface ReplayAdapterUiBridge {
  getCase: () => ReplayCase;
  hasReportPreview: () => boolean;
  persistCase?: (replayCase: ReplayCase) => Promise<void>;
  setReportPreview: (preview: ReturnType<typeof buildReportPreview>) => void;
  setAgentWorking: (active: boolean, toolName?: string) => void;
  revealAffected: (ids: readonly string[]) => void;
  setComparison: (ids: string[]) => void;
}

function resultFromDomain(result: ReplayCommandResult): ReplayAdapterResult {
  return {
    ok: result.ok,
    message: result.message,
    caseVersion: result.caseVersion,
    ...(result.ok && result.activityId ? { activityId: result.activityId } : {}),
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

export function createReplayWebMCPAdapter(
  engine: ReplayEngine,
  ui: ReplayAdapterUiBridge,
): ReplayWebMCPAdapter {
  const execute = async (
    command: ReplayWebMCPCommand,
    context: ReplayInvocationContext,
  ): Promise<ReplayAdapterResult> => {
    ensureNotAborted(context);
    const replayCase = ui.getCase();
    const payload = command.payload;
    const meta = mutationMeta(command);
    let domainCommand: Record<string, unknown>;

    switch (command.type) {
      case "upsert_scene_actor": {
        const actorId =
          typeof payload.actorId === "string" ? payload.actorId : id("actor", command.requestId);
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
          !["claim", "timeline-event", "actor", "trajectory", "damage", "hypothesis"].includes(
            String(targetType),
          )
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
          targetType,
          targetId: payload.targetId,
        };
        break;
      }
      case "create_open_question": {
        const relatedIds = payload.relatedIds as string[];
        domainCommand = {
          type: "question.add",
          ...meta,
          question: payload.question,
          reason: payload.reason,
          importance: payload.importance,
          rankingReasons:
            payload.importance === "blocking" ? ["blocks-report"] : ["contextual-detail"],
          relatedClaimIds: relatedIds.filter((relatedId) =>
            replayCase.claims.some((claim) => claim.id === relatedId),
          ),
          relatedSceneObjectIds: relatedIds.filter(
            (relatedId) =>
              replayCase.actors.some((actor) => actor.id === relatedId) ||
              replayCase.trajectories.some((trajectory) => trajectory.id === relatedId) ||
              replayCase.timelineEvents.some((event) => event.id === relatedId),
          ),
          relatedBranchIds: relatedIds.filter((relatedId) =>
            replayCase.branches.some((branch) => branch.id === relatedId),
          ),
        };
        break;
      }
      case "fork_hypothesis":
        domainCommand = {
          type: "hypothesis.fork",
          ...meta,
          parentBranchId: payload.sourceBranchId,
          name: payload.name,
          description: payload.description,
          assumptions: (
            payload.assumptions as Array<{ statement: string; relatedIds: string[] }>
          ).map((assumption) => ({
            statement: assumption.statement,
            supportingEvidenceIds: assumption.relatedIds.filter((relatedId) =>
              replayCase.evidence.some((asset) => asset.id === relatedId),
            ),
            conflictingEvidenceIds: [],
          })),
        };
        break;
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
    const result = engine.execute(domainCommand, { signal: context.signal });
    if (result.ok) await ui.persistCase?.(engine.getState());
    return resultFromDomain(result);
  };

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
      const activity = getRecentActivity(ui.getCase(), input.limit);
      return input.author === "all"
        ? activity
        : activity.filter((item) => item.author === input.author);
    },
    validateConsistency(input, context) {
      ensureNotAborted(context);
      return validateConsistency(ui.getCase(), {
        scope: scopeForWebMCP(input.scope),
        ...(input.branchId ? { branchId: input.branchId } : {}),
      });
    },
    compareHypotheses(input, context) {
      ensureNotAborted(context);
      const [baseline, ...alternatives] = input.branchIds;
      if (!baseline || alternatives.length === 0)
        throw new Error("Choose at least two hypothesis branches.");
      ui.setComparison([...input.branchIds]);
      return {
        branchIds: [...input.branchIds],
        comparisonMode: input.comparisonMode,
        pairwiseComparisons: alternatives.map((alternative) =>
          compareHypotheses(ui.getCase(), baseline, alternative),
        ),
      };
    },
    focusWorkspaceItem(input, context) {
      ensureNotAborted(context);
      const replayCase = ui.getCase();
      const mode =
        (input.workspaceMode as WorkspaceMode | undefined) ?? workspaceModeForItem(input.itemType);
      const command = {
        type: "workspace.focus",
        actor: "agent",
        origin: "webmcp",
        itemType: domainItemType(input.itemType),
        itemId:
          input.itemType === "issue"
            ? (replayCase.reportSnapshots.at(-1)?.id ?? "report-preview")
            : input.itemId,
        workspaceMode: mode,
      };
      return resultFromDomain(engine.execute(command));
    },
    revertAgentAction(input, context) {
      ensureNotAborted(context);
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
      return resultFromDomain(
        engine.revertAgentAction(activity.requestId, {
          actor: "agent",
          origin: "webmcp",
          requestId: input.requestId,
          expectedVersion: input.expectedVersion,
        }),
      );
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
      const preview = buildReportPreview(
        replayCase,
        input.branchId ? { branchIds: [input.branchId] } : {},
      );
      ui.setReportPreview(preview);
      return {
        ok: true,
        message: "Built and opened a neutral report preview for human review.",
        caseVersion: replayCase.caseVersion,
        affectedIds: ["report-preview"],
        issues: replayCase.consistencyIssues,
      };
    },
    setAgentWorking(state) {
      ui.setAgentWorking(state.active, state.active ? state.toolName : undefined);
    },
    revealAffected(ids) {
      ui.revealAffected(ids);
    },
  };
}
