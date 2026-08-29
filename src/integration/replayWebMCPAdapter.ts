import {
  buildReportPreview,
  clampTimeToRange,
  compareHypotheses,
  getActorPoseAtTime,
  getCaseSummary,
  getRecentActivity,
  rankOpenQuestions,
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
import { ReplayWebMCPContractError, WEBMCP_SCENE_COORDINATE_LIMIT } from "../webmcp";

export interface ReplayAdapterUiBridge {
  getCase: () => ReplayCase;
  getVisibleWorkspace: () => Readonly<{
    workspaceMode: WorkspaceMode;
    selectedItem?: Readonly<{ type: DomainWorkspaceItemType | "issue"; id: string }> | undefined;
  }>;
  getPlayheadTimeMs?: () => number;
  getReportPreview: () => ReturnType<typeof buildReportPreview> | undefined;
  getSelectedReportSnapshotId?: () => string | undefined;
  persistCase?: (
    replayCase: ReplayCase,
    options: Readonly<{ expectedCaseVersion: number; compensation?: true }>,
  ) => Promise<void>;
  setReportPreview: (preview: ReturnType<typeof buildReportPreview>) => void;
  setAgentWorking: (active: boolean, toolName?: string) => void;
  setMutationTransactionActive?: (active: boolean) => void;
  revealAffected: (ids: readonly string[]) => void;
  focusWorkspaceItem: (
    itemType: Exclude<WorkspaceItemType, "issue">,
    itemId: string,
    workspaceMode: WorkspaceMode,
  ) => void;
  focusIssue: (issueId: string, affectedIds: readonly string[]) => void;
  setComparison: (ids: string[]) => void;
  getVisibleActivity?: () => readonly ActivityEvent[];
  recordToolInvocation?: (audit: ReplayToolInvocationAudit) => void;
  getMutationBlockReason?: () => string | undefined;
}

type VisibleReportPreviewState = Readonly<{
  status: "none" | "transient-human-review" | "finalized-snapshot";
  preview?: ReturnType<typeof buildReportPreview>;
  snapshotId?: string;
}>;

function visibleReportPreviewState(
  ui: ReplayAdapterUiBridge,
  replayCase: ReplayCase,
): VisibleReportPreviewState {
  const preview = ui.getReportPreview();
  if (preview === undefined) return { status: "none" };

  const selectedSnapshotId = ui.getSelectedReportSnapshotId?.();
  const matchingSnapshot =
    (selectedSnapshotId
      ? replayCase.reportSnapshots.find((snapshot) => snapshot.id === selectedSnapshotId)
      : undefined) ??
    replayCase.reportSnapshots.find(
      (snapshot) =>
        snapshot.preview.caseId === preview.caseId &&
        snapshot.preview.caseVersion === preview.caseVersion &&
        snapshot.preview.generatedAt === preview.generatedAt,
    );
  if (selectedSnapshotId !== undefined || matchingSnapshot !== undefined) {
    const snapshotId = selectedSnapshotId ?? matchingSnapshot?.id;
    return {
      status: "finalized-snapshot",
      preview,
      ...(snapshotId === undefined ? {} : { snapshotId }),
    };
  }
  return { status: "transient-human-review", preview };
}

function playheadTimeForCase(ui: ReplayAdapterUiBridge, replayCase: ReplayCase): number {
  return clampTimeToRange(
    ui.getPlayheadTimeMs?.() ?? replayCase.timeRangeMs.start,
    replayCase.timeRangeMs,
  );
}

interface ExpectedPoseTarget {
  branchId: string;
  playheadTimeMs: number;
}

function parseExpectedPoseTarget(value: unknown): ExpectedPoseTarget | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const candidate = value as Readonly<Record<string, unknown>>;
  if (
    typeof candidate.branchId !== "string" ||
    candidate.branchId.length === 0 ||
    typeof candidate.playheadTimeMs !== "number" ||
    !Number.isInteger(candidate.playheadTimeMs) ||
    candidate.playheadTimeMs < 0 ||
    candidate.playheadTimeMs > 86_400_000
  ) {
    return undefined;
  }
  return {
    branchId: candidate.branchId,
    playheadTimeMs: candidate.playheadTimeMs,
  };
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

function workspaceItemExists(
  replayCase: ReplayCase,
  itemType: Exclude<WorkspaceItemType, "issue">,
  itemId: string,
  branchId = replayCase.activeBranchId,
): boolean {
  if (itemType === "actor") return replayCase.actors.some((item) => item.id === itemId);
  if (itemType === "trajectory")
    return replayCase.trajectories.some((item) => item.id === itemId && item.branchId === branchId);
  if (itemType === "event")
    return replayCase.timelineEvents.some(
      (item) => item.id === itemId && item.branchId === branchId,
    );
  if (itemType === "claim") return replayCase.claims.some((item) => item.id === itemId);
  if (itemType === "evidence")
    return replayCase.evidence.some((item) => item.id === itemId && !item.deleted);
  if (itemType === "question") return replayCase.questions.some((item) => item.id === itemId);
  return replayCase.branches.some((item) => item.id === itemId);
}

function scopeForWebMCP(scope: string): ConsistencyValidationScope {
  if (
    scope === "all" ||
    scope === "scene" ||
    scope === "timeline" ||
    scope === "geometry" ||
    scope === "motion" ||
    scope === "damage" ||
    scope === "integrity" ||
    scope === "provenance" ||
    scope === "completeness" ||
    scope === "report"
  ) {
    return scope;
  }
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
  const candidate = `${prefix}-${requestId}`;
  if (candidate.length <= 128) return candidate;
  let first = 2_166_136_261;
  let second = 2_248_222_519;
  for (let index = 0; index < candidate.length; index += 1) {
    const codeUnit = candidate.charCodeAt(index);
    first = Math.imul(first ^ codeUnit, 16_777_619);
    second = Math.imul(second ^ codeUnit, 2_246_822_519);
  }
  const hash = `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
  return `${candidate.slice(0, 128 - hash.length - 1)}-${hash}`;
}

const WEBMCP_NORMALIZED_BOUNDS = { minX: 0, minY: 0, maxX: 1, maxY: 1 } as const;

const WEBMCP_COORDINATE_SYSTEM = {
  type: "normalized-scene",
  position: {
    fields: ["x", "y"],
    unit: "normalized",
    minimum: -WEBMCP_SCENE_COORDINATE_LIMIT,
    maximum: WEBMCP_SCENE_COORDINATE_LIMIT,
    inBoundsMinimum: 0,
    inBoundsMaximum: 1,
    xDirection: "left-to-right",
    yDirection: "top-to-bottom",
    reference: "open-case-environment-bounds",
    boundsPath: "scene.environment.bounds",
    boundsRepresentation: "normalized-envelope",
    outOfBoundsRepresentation: "proportional-values-outside-0..1",
  },
  rotation: { field: "rotationDeg", unit: "degrees" },
  time: { field: "timeMs", unit: "milliseconds-from-reviewed-interval-start" },
} as const;

const HYPOTHESIS_TRAJECTORY_DELTA_LIMIT = 16;
const HYPOTHESIS_EVENT_DELTA_LIMIT = 32;

function normalizedCoordinateForDomain(
  value: number,
  minimum: number,
  maximum: number,
  referenceDomainValue?: number,
): number {
  if (
    referenceDomainValue !== undefined &&
    value === domainCoordinateForWebMCP(referenceDomainValue, minimum, maximum)
  ) {
    return referenceDomainValue;
  }
  const domainValue = minimum + value * (maximum - minimum);
  if (!Number.isFinite(domainValue)) {
    throw new ReplayWebMCPContractError(
      "INVALID_INPUT",
      "The normalized scene coordinate cannot be represented safely in the open case bounds.",
    );
  }
  return Object.is(domainValue, -0) ? 0 : domainValue;
}

function domainCoordinateForWebMCP(value: number, minimum: number, maximum: number): number {
  const normalized = (value - minimum) / (maximum - minimum);
  if (!Number.isFinite(normalized)) {
    throw new RangeError("The case contains a scene coordinate that cannot be normalized safely.");
  }
  return Object.is(normalized, -0) ? 0 : normalized;
}

function pointForWebMCP<T extends Readonly<{ x: number; y: number }>>(
  point: T,
  bounds: ReplayCase["environment"]["bounds"],
): T {
  return {
    ...point,
    x: domainCoordinateForWebMCP(point.x, bounds.minX, bounds.maxX),
    y: domainCoordinateForWebMCP(point.y, bounds.minY, bounds.maxY),
  };
}

function environmentForWebMCP(environment: ReplayCase["environment"]) {
  return {
    sceneType: environment.sceneType,
    roadCondition: environment.roadCondition,
    weather: environment.weather,
    lighting: environment.lighting,
    trafficSide: environment.trafficSide,
    calibration: { ...environment.calibration },
    ...(environment.postedSpeedLimitKph === undefined
      ? {}
      : { postedSpeedLimitKph: environment.postedSpeedLimitKph }),
    bounds: WEBMCP_NORMALIZED_BOUNDS,
    roadPolygon: environment.roadPolygon.map((point) => pointForWebMCP(point, environment.bounds)),
  };
}

function actorForWebMCP(
  actor: ReplayCase["actors"][number],
  pose: ReplayCase["actors"][number]["pose"],
  bounds: ReplayCase["environment"]["bounds"],
) {
  return {
    id: actor.id,
    label: actor.label,
    kind: actor.kind,
    dimensions: { ...actor.dimensions },
    vehicleClass: actor.vehicleClass,
    dimensionsSource: actor.dimensionsSource,
    ...(actor.wheelbaseMeters === undefined ? {} : { wheelbaseMeters: actor.wheelbaseMeters }),
    colorToken: actor.colorToken,
    pose: pointForWebMCP(pose, bounds),
    ...(actor.lastEditedBy === undefined ? {} : { lastEditedBy: actor.lastEditedBy }),
    ...(actor.lastEditedAt === undefined ? {} : { lastEditedAt: actor.lastEditedAt }),
    locked: actor.locked,
    ...(actor.lock === undefined ? {} : { lock: { ...actor.lock } }),
    damageMarkers: actor.damageMarkers.map((marker) => ({
      id: marker.id,
      actorId: marker.actorId,
      region: marker.region,
      description: marker.description,
      status: marker.status,
      linkedClaimIds: [...marker.linkedClaimIds],
      linkedEvidenceIds: [...marker.linkedEvidenceIds],
      createdBy: marker.createdBy,
    })),
  };
}

function trajectoryGeometryForWebMCP(
  trajectory: ReplayCase["trajectories"][number],
  bounds: ReplayCase["environment"]["bounds"],
) {
  return {
    id: trajectory.id,
    actorId: trajectory.actorId,
    branchId: trajectory.branchId,
    interpolationMode: trajectory.interpolationMode ?? "smooth",
    visible: trajectory.visible,
    locked: trajectory.locked,
    ...(trajectory.lock === undefined ? {} : { lock: { ...trajectory.lock } }),
    createdBy: trajectory.createdBy,
    keyframes: trajectory.keyframes.map((keyframe) => ({
      id: keyframe.id,
      timeMs: keyframe.timeMs,
      ...pointForWebMCP(
        { x: keyframe.x, y: keyframe.y, rotationDeg: keyframe.rotationDeg },
        bounds,
      ),
    })),
  };
}

function eventForWebMCP(
  event: ReplayCase["timelineEvents"][number],
  bounds: ReplayCase["environment"]["bounds"],
) {
  return {
    id: event.id,
    branchId: event.branchId,
    timeMs: event.timeMs,
    type: event.type,
    title: event.title,
    certainty: event.certainty,
    linkedActorIds: [...event.linkedActorIds],
    linkedClaimIds: [...event.linkedClaimIds],
    linkedEvidenceIds: [...event.linkedEvidenceIds],
    ...(event.location === undefined ? {} : { location: pointForWebMCP(event.location, bounds) }),
    locked: event.locked,
    ...(event.lock === undefined ? {} : { lock: { ...event.lock } }),
    createdBy: event.createdBy,
  };
}

function claimForWebMCP(claim: ReplayCase["claims"][number]) {
  return {
    id: claim.id,
    statement: claim.statement,
    ...(claim.subjectId === undefined ? {} : { subjectId: claim.subjectId }),
    status: claim.status,
    sourceType: claim.sourceType,
    sourceIds: [...claim.sourceIds],
    linkedEvidenceIds: [...claim.linkedEvidenceIds],
    linkedEventIds: [...claim.linkedEventIds],
    linkedSceneObjectIds: [...claim.linkedSceneObjectIds],
    ...(claim.branchId === undefined ? {} : { branchId: claim.branchId }),
    sharedAcrossBranches: claim.sharedAcrossBranches,
    createdBy: claim.createdBy,
    humanConfirmed: claim.humanConfirmed,
    ...(claim.confirmedAt === undefined ? {} : { confirmedAt: claim.confirmedAt }),
    locked: claim.locked,
    ...(claim.lock === undefined ? {} : { lock: { ...claim.lock } }),
    createdAt: claim.createdAt,
    updatedAt: claim.updatedAt,
  };
}

function evidenceForWebMCP(asset: ReplayCase["evidence"][number]) {
  return {
    id: asset.id,
    name: asset.name,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    checksum: asset.checksum,
    syntheticDemoAsset: asset.syntheticDemoAsset,
    source: asset.source,
    ...(asset.capturedAt === undefined ? {} : { capturedAt: asset.capturedAt }),
    createdAt: asset.createdAt,
    ...(asset.notes === undefined ? {} : { notes: asset.notes }),
    tags: [...asset.tags],
    annotations: asset.annotations.map((annotation) => ({ ...annotation })),
    annotationLinks: asset.annotationLinks.map((link) => ({ ...link })),
    linkedClaimIds: [...asset.linkedClaimIds],
    linkedEventIds: [...asset.linkedEventIds],
    linkedSceneObjectIds: [...asset.linkedSceneObjectIds],
    linkedBranchIds: [...asset.linkedBranchIds],
    deleted: asset.deleted,
    ...(asset.deletedAt === undefined ? {} : { deletedAt: asset.deletedAt }),
  };
}

function questionForWebMCP(question: ReplayCase["questions"][number]) {
  return {
    id: question.id,
    question: question.question,
    reason: question.reason,
    importance: question.importance,
    rankingReasons: [...question.rankingReasons],
    relatedClaimIds: [...question.relatedClaimIds],
    relatedSceneObjectIds: [...question.relatedSceneObjectIds],
    relatedBranchIds: [...question.relatedBranchIds],
    status: question.status,
    ...(question.answer === undefined ? {} : { answer: question.answer }),
    ...(question.answerSource === undefined ? {} : { answerSource: question.answerSource }),
    createdBy: question.createdBy,
    createdAt: question.createdAt,
    updatedAt: question.updatedAt,
  };
}

function branchForWebMCP(branch: ReplayCase["branches"][number]) {
  return {
    id: branch.id,
    name: branch.name,
    description: branch.description,
    ...(branch.parentBranchId === undefined ? {} : { parentBranchId: branch.parentBranchId }),
    sharedClaimIds: [...branch.sharedClaimIds],
    assumptions: branch.assumptions.map((assumption) => ({
      id: assumption.id,
      statement: assumption.statement,
      status: assumption.status,
      supportingEvidenceIds: [...assumption.supportingEvidenceIds],
      conflictingEvidenceIds: [...assumption.conflictingEvidenceIds],
      createdBy: assumption.createdBy,
      createdAt: assumption.createdAt,
      updatedAt: assumption.updatedAt,
    })),
    trajectoryIds: [...branch.trajectoryIds],
    eventIds: [...branch.eventIds],
    claimIds: [...branch.claimIds],
    status: branch.status,
    createdBy: branch.createdBy,
    createdAt: branch.createdAt,
    updatedAt: branch.updatedAt,
  };
}

function branchTrajectoryForActor(replayCase: ReplayCase, branchId: string, actorId: string) {
  const branch = replayCase.branches.find((candidate) => candidate.id === branchId);
  if (!branch) return undefined;
  return replayCase.trajectories.find(
    (trajectory) =>
      trajectory.branchId === branchId &&
      trajectory.actorId === actorId &&
      branch.trajectoryIds.includes(trajectory.id),
  );
}

function comparableEventKey(event: ReplayCase["timelineEvents"][number]): string {
  return `${event.type}|${event.title}|${[...event.linkedActorIds].sort().join(",")}`;
}

function geometryTimingDeltasForWebMCP(
  replayCase: ReplayCase,
  firstBranchId: string,
  secondBranchId: string,
  comparison: ReturnType<typeof compareHypotheses>,
) {
  const bounds = replayCase.environment.bounds;
  const trajectoryActorIds = comparison.changedTrajectoryActorIds;
  const trajectoryItems = trajectoryActorIds
    .slice(0, HYPOTHESIS_TRAJECTORY_DELTA_LIMIT)
    .map((actorId) => {
      const first = branchTrajectoryForActor(replayCase, firstBranchId, actorId);
      const second = branchTrajectoryForActor(replayCase, secondBranchId, actorId);
      return {
        actorId,
        branches: {
          [firstBranchId]: first === undefined ? null : trajectoryGeometryForWebMCP(first, bounds),
          [secondBranchId]:
            second === undefined ? null : trajectoryGeometryForWebMCP(second, bounds),
        },
      };
    });

  const firstBranch = replayCase.branches.find((branch) => branch.id === firstBranchId);
  const secondBranch = replayCase.branches.find((branch) => branch.id === secondBranchId);
  const firstEvents = replayCase.timelineEvents.filter((event) =>
    firstBranch?.eventIds.includes(event.id),
  );
  const secondEvents = replayCase.timelineEvents.filter((event) =>
    secondBranch?.eventIds.includes(event.id),
  );
  const firstByKey = new Map(firstEvents.map((event) => [comparableEventKey(event), event]));
  const secondByKey = new Map(secondEvents.map((event) => [comparableEventKey(event), event]));
  const changedEventIds = new Set(comparison.changedEventIds);
  const changedEventKeys = [...new Set([...firstByKey.keys(), ...secondByKey.keys()])]
    .filter((key) => {
      const first = firstByKey.get(key);
      const second = secondByKey.get(key);
      return (
        (first !== undefined && changedEventIds.has(first.id)) ||
        (second !== undefined && changedEventIds.has(second.id))
      );
    })
    .sort();
  const eventItems = changedEventKeys.slice(0, HYPOTHESIS_EVENT_DELTA_LIMIT).map((key) => {
    const first = firstByKey.get(key);
    const second = secondByKey.get(key);
    const identity = first ?? second;
    return {
      identity: {
        type: identity?.type,
        title: identity?.title,
        linkedActorIds: identity === undefined ? [] : [...identity.linkedActorIds].sort(),
      },
      branches: {
        [firstBranchId]: first === undefined ? null : eventForWebMCP(first, bounds),
        [secondBranchId]: second === undefined ? null : eventForWebMCP(second, bounds),
      },
    };
  });

  return {
    timeRangeMs: structuredClone(replayCase.timeRangeMs),
    trajectoryDeltas: {
      totalCount: trajectoryActorIds.length,
      returnedCount: trajectoryItems.length,
      truncated: trajectoryItems.length < trajectoryActorIds.length,
      items: trajectoryItems,
    },
    eventDeltas: {
      totalCount: changedEventKeys.length,
      returnedCount: eventItems.length,
      truncated: eventItems.length < changedEventKeys.length,
      items: eventItems,
    },
  };
}

function proposalForWebMCP(
  proposal: ReplayCase["proposals"][number],
  bounds: ReplayCase["environment"]["bounds"],
) {
  const keyframesForWebMCP = (keyframes: ReplayCase["trajectories"][number]["keyframes"]) =>
    keyframes.map((keyframe) => ({
      id: keyframe.id,
      timeMs: keyframe.timeMs,
      ...pointForWebMCP(
        { x: keyframe.x, y: keyframe.y, rotationDeg: keyframe.rotationDeg },
        bounds,
      ),
    }));

  return {
    id: proposal.id,
    title: proposal.title,
    rationale: proposal.rationale,
    status: proposal.status,
    createdBy: proposal.createdBy,
    origin: proposal.origin,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
    revisions: proposal.revisions.map((revision) => ({
      id: revision.id,
      revisionNumber: revision.revisionNumber,
      summary: revision.summary,
      createdBy: revision.createdBy,
      origin: revision.origin,
      authorshipTrusted: revision.authorshipTrusted,
      createdAt: revision.createdAt,
      changes: revision.changes.map((change) =>
        change.kind === "actor-pose"
          ? {
              id: change.id,
              kind: change.kind,
              actorId: change.actorId,
              basePose: pointForWebMCP(change.basePose, bounds),
              proposedPose: pointForWebMCP(change.proposedPose, bounds),
              ...(change.branchId === undefined ? {} : { branchId: change.branchId }),
              ...(change.targetTimeMs === undefined ? {} : { targetTimeMs: change.targetTimeMs }),
              ...(change.baseTrajectory === undefined
                ? {}
                : {
                    baseTrajectory: {
                      trajectoryId: change.baseTrajectory.trajectoryId,
                      visible: change.baseTrajectory.visible,
                      keyframes: keyframesForWebMCP(change.baseTrajectory.keyframes),
                    },
                  }),
            }
          : {
              id: change.id,
              kind: change.kind,
              actorId: change.actorId,
              branchId: change.branchId,
              trajectoryId: change.trajectoryId,
              createsTrajectory: change.createsTrajectory,
              baseActorPose: pointForWebMCP(change.baseActorPose, bounds),
              ...(change.baseTrajectory === undefined
                ? {}
                : {
                    baseTrajectory: {
                      visible: change.baseTrajectory.visible,
                      keyframes: keyframesForWebMCP(change.baseTrajectory.keyframes),
                    },
                  }),
              proposedTrajectory: {
                visible: change.proposedTrajectory.visible,
                keyframes: keyframesForWebMCP(change.proposedTrajectory.keyframes),
              },
            },
      ),
    })),
    ...(proposal.decision === undefined ? {} : { decision: { ...proposal.decision } }),
  };
}

function reportSnapshotForWebMCP(snapshot: ReplayCase["reportSnapshots"][number]) {
  return {
    id: snapshot.id,
    caseVersion: snapshot.caseVersion,
    createdAt: snapshot.createdAt,
    confirmedClaimIds: [...snapshot.confirmedClaimIds],
    includedEvidenceIds: [...snapshot.includedEvidenceIds],
    unresolvedQuestionIds: [...snapshot.unresolvedQuestionIds],
    branchIds: [...snapshot.branchIds],
    humanAcknowledged: snapshot.humanAcknowledged,
    immutable: snapshot.immutable,
    previewSummary: {
      caseId: snapshot.preview.caseId,
      caseVersion: snapshot.preview.caseVersion,
      generatedAt: snapshot.preview.generatedAt,
      title: snapshot.preview.title,
      ...(snapshot.preview.reviewBinding === undefined
        ? {}
        : {
            reviewBinding: {
              ...snapshot.preview.reviewBinding,
              branchIds: [...snapshot.preview.reviewBinding.branchIds],
            },
          }),
    },
  };
}

function claimsForWebMCP(replayCase: ReplayCase) {
  return structuredClone(replayCase.claims.map(claimForWebMCP));
}

function evidenceSectionForWebMCP(replayCase: ReplayCase) {
  return structuredClone(
    replayCase.evidence.filter((asset) => !asset.deleted).map(evidenceForWebMCP),
  );
}

function questionsForWebMCP(replayCase: ReplayCase) {
  return structuredClone(rankOpenQuestions(replayCase.questions).map(questionForWebMCP));
}

function reportForWebMCP(replayCase: ReplayCase) {
  return structuredClone({
    completenessAttestations: replayCase.completenessAttestations,
    notes: replayCase.reportNotes.map((note) => ({
      id: note.id,
      text: note.text,
      claimIds: [...note.claimIds],
      evidenceIds: [...note.evidenceIds],
      createdBy: note.createdBy,
      reviewedByHuman: note.reviewedByHuman,
      createdAt: note.createdAt,
    })),
    snapshots: replayCase.reportSnapshots.map(reportSnapshotForWebMCP),
  });
}

function sceneForWebMCP(replayCase: ReplayCase, playheadTimeMs: number, branchId: string) {
  return structuredClone({
    environment: environmentForWebMCP(replayCase.environment),
    sceneTemplateId: replayCase.sceneTemplateId,
    playheadTimeMs,
    actors: replayCase.actors.map((actor) =>
      actorForWebMCP(
        actor,
        getActorPoseAtTime(replayCase, actor.id, playheadTimeMs, branchId) ?? actor.pose,
        replayCase.environment.bounds,
      ),
    ),
    trajectories: replayCase.trajectories
      .filter((trajectory) => trajectory.branchId === branchId)
      .map((trajectory) => trajectoryGeometryForWebMCP(trajectory, replayCase.environment.bounds)),
    branchId,
    activeBranchId: replayCase.activeBranchId,
    branchIsActive: branchId === replayCase.activeBranchId,
  });
}

function timelineForWebMCP(replayCase: ReplayCase, branchId: string) {
  return structuredClone({
    timeRangeMs: replayCase.timeRangeMs,
    events: replayCase.timelineEvents
      .filter((event) => event.branchId === branchId)
      .map((event) => eventForWebMCP(event, replayCase.environment.bounds)),
    branchId,
    activeBranchId: replayCase.activeBranchId,
    branchIsActive: branchId === replayCase.activeBranchId,
  });
}

function hypothesesForWebMCP(replayCase: ReplayCase) {
  return structuredClone({
    branches: replayCase.branches.map(branchForWebMCP),
    activeBranchId: replayCase.activeBranchId,
    proposals: replayCase.proposals.map((proposal) =>
      proposalForWebMCP(proposal, replayCase.environment.bounds),
    ),
  });
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
    ui.setMutationTransactionActive?.(true);
    try {
      return await operation();
    } finally {
      ui.setMutationTransactionActive?.(false);
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
    const bounds = replayCase.environment.bounds;
    const playheadTimeMs = playheadTimeForCase(ui, replayCase);
    const blockedReason = ui.getMutationBlockReason?.();
    const payload = command.payload;
    const meta = mutationMeta(command);
    const hasPriorRequest = replayCase.activity.some(
      (activity) => activity.requestId === command.requestId,
    );
    let domainCommand: Record<string, unknown>;

    switch (command.type) {
      case "upsert_scene_actor": {
        const requestedActorId = typeof payload.actorId === "string" ? payload.actorId : undefined;
        const existing = requestedActorId
          ? replayCase.actors.find((actor) => actor.id === requestedActorId)
          : undefined;
        if (requestedActorId && !existing) {
          return adapterFailure(
            replayCase,
            "NOT_FOUND",
            `Scene actor ${requestedActorId} does not exist. Omit actorId to create a new actor.`,
          );
        }
        if (
          existing &&
          [
            payload.label,
            payload.position,
            payload.rotationDeg,
            payload.dimensions,
            payload.vehicleClass,
            payload.dimensionsSource,
            payload.wheelbaseMeters,
            payload.colorToken,
          ].every((field) => field === undefined) &&
          !hasPriorRequest
        ) {
          return adapterFailure(
            replayCase,
            "INVALID_INPUT",
            "Updating a scene actor requires at least one editable field.",
          );
        }
        const actorId = requestedActorId ?? newSceneActorId(replayCase);
        const requestedPosition = payload.position as { x: number; y: number } | undefined;
        const requestedDimensions = payload.dimensions as
          { width: number; length: number } | undefined;
        const poseEditRequested =
          requestedPosition !== undefined || typeof payload.rotationDeg === "number";
        let expectedPoseTarget: ExpectedPoseTarget | undefined;
        if (existing && poseEditRequested) {
          expectedPoseTarget = parseExpectedPoseTarget(payload.expectedPoseTarget);
          if (!expectedPoseTarget) {
            return adapterFailure(
              replayCase,
              "INVALID_INPUT",
              "Changing an existing actor position or rotation requires expectedPoseTarget from the latest scene read.",
            );
          }
          if (
            !hasPriorRequest &&
            (expectedPoseTarget.branchId !== replayCase.activeBranchId ||
              expectedPoseTarget.playheadTimeMs !== playheadTimeMs)
          ) {
            return adapterFailure(
              replayCase,
              "VERSION_CONFLICT",
              `Expected pose target ${expectedPoseTarget.branchId} at ${String(expectedPoseTarget.playheadTimeMs)} ms, but the visible target is ${replayCase.activeBranchId} at ${String(playheadTimeMs)} ms. Read the scene again before retrying with a new requestId.`,
            );
          }
        }
        const visiblePose = existing
          ? (getActorPoseAtTime(
              replayCase,
              existing.id,
              expectedPoseTarget?.playheadTimeMs ?? playheadTimeMs,
              expectedPoseTarget?.branchId ?? replayCase.activeBranchId,
            ) ?? existing.pose)
          : undefined;
        const poseBaseline = poseEditRequested ? visiblePose : existing?.pose;
        const label = typeof payload.label === "string" ? payload.label : existing?.label;
        const position =
          requestedPosition ??
          (poseBaseline
            ? {
                x: domainCoordinateForWebMCP(poseBaseline.x, bounds.minX, bounds.maxX),
                y: domainCoordinateForWebMCP(poseBaseline.y, bounds.minY, bounds.maxY),
              }
            : undefined);
        const rotationDeg =
          typeof payload.rotationDeg === "number" ? payload.rotationDeg : poseBaseline?.rotationDeg;
        const dimensions = requestedDimensions ?? existing?.dimensions;
        if (!label || !position || rotationDeg === undefined || !dimensions) {
          return adapterFailure(
            replayCase,
            "INVALID_INPUT",
            "Creating a scene actor requires label, position, rotationDeg, and dimensions.",
          );
        }
        const wheelbaseMeters =
          typeof payload.wheelbaseMeters === "number"
            ? payload.wheelbaseMeters
            : existing?.wheelbaseMeters;
        const dimensionsChanged =
          existing?.dimensions.width !== dimensions.width ||
          existing.dimensions.length !== dimensions.length ||
          existing.wheelbaseMeters !== wheelbaseMeters;
        const vehicleClass = payload.vehicleClass ?? existing?.vehicleClass ?? "unknown";
        const requestedDimensionsSource =
          payload.dimensionsSource === "template" ||
          payload.dimensionsSource === "estimated" ||
          payload.dimensionsSource === "unknown"
            ? payload.dimensionsSource
            : undefined;
        const dimensionsSource =
          requestedDimensionsSource ??
          (dimensionsChanged ? "estimated" : existing.dimensionsSource);
        const colorToken = payload.colorToken ?? existing?.colorToken ?? "vehicle-muted-blue";
        const resolvedPose = {
          x: normalizedCoordinateForDomain(position.x, bounds.minX, bounds.maxX, poseBaseline?.x),
          y: normalizedCoordinateForDomain(position.y, bounds.minY, bounds.maxY, poseBaseline?.y),
          rotationDeg,
        };
        const comparisonPose = poseEditRequested ? visiblePose : existing?.pose;
        if (
          existing &&
          comparisonPose &&
          label === existing.label &&
          resolvedPose.x === comparisonPose.x &&
          resolvedPose.y === comparisonPose.y &&
          resolvedPose.rotationDeg === comparisonPose.rotationDeg &&
          dimensions.width === existing.dimensions.width &&
          dimensions.length === existing.dimensions.length &&
          vehicleClass === existing.vehicleClass &&
          dimensionsSource === existing.dimensionsSource &&
          wheelbaseMeters === existing.wheelbaseMeters &&
          colorToken === existing.colorToken &&
          !hasPriorRequest
        ) {
          return adapterFailure(
            replayCase,
            "INVALID_INPUT",
            `Update for scene actor ${existing.id} does not change any editable field.`,
          );
        }
        domainCommand = {
          type: "actor.upsert",
          ...meta,
          ...(expectedPoseTarget
            ? {
                poseAt: {
                  branchId: expectedPoseTarget.branchId,
                  timeMs: expectedPoseTarget.playheadTimeMs,
                },
              }
            : {}),
          sceneActor: {
            id: actorId,
            label,
            kind: "vehicle",
            dimensions,
            vehicleClass,
            dimensionsSource,
            ...(wheelbaseMeters === undefined ? {} : { wheelbaseMeters }),
            colorToken,
            pose: resolvedPose,
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
          keyframes: frames.map((frame) => {
            const referenceFrame = frame.id
              ? existing?.keyframes.find((candidate) => candidate.id === frame.id)
              : undefined;
            return {
              ...(frame.id ? { id: frame.id } : {}),
              timeMs: frame.timeMs,
              x: normalizedCoordinateForDomain(
                frame.x,
                bounds.minX,
                bounds.maxX,
                referenceFrame?.x,
              ),
              y: normalizedCoordinateForDomain(
                frame.y,
                bounds.minY,
                bounds.maxY,
                referenceFrame?.y,
              ),
              rotationDeg: frame.rotationDeg,
            };
          }),
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
          | {
              kind: "trajectory-keyframe-patch";
              actorId: string;
              branchId: string;
              adjustments: Array<{
                keyframeId: string;
                x?: number;
                y?: number;
                rotationDeg?: number;
              }>;
              visible: true;
            }
        >;
        const includesActorPose = changes.some((change) => change.kind === "actor-pose");
        const expectedPoseTarget = includesActorPose
          ? parseExpectedPoseTarget(payload.expectedPoseTarget)
          : undefined;
        if (includesActorPose && !expectedPoseTarget) {
          return adapterFailure(
            replayCase,
            "INVALID_INPUT",
            "An actor-pose proposal requires expectedPoseTarget from the latest scene read.",
          );
        }
        if (
          expectedPoseTarget &&
          !hasPriorRequest &&
          (expectedPoseTarget.branchId !== replayCase.activeBranchId ||
            expectedPoseTarget.playheadTimeMs !== playheadTimeMs)
        ) {
          return adapterFailure(
            replayCase,
            "VERSION_CONFLICT",
            `Expected pose target ${expectedPoseTarget.branchId} at ${String(expectedPoseTarget.playheadTimeMs)} ms, but the visible target is ${replayCase.activeBranchId} at ${String(playheadTimeMs)} ms. Read the scene again before retrying with a new requestId.`,
          );
        }
        const proposalPoseTarget = expectedPoseTarget ?? {
          branchId: replayCase.activeBranchId,
          playheadTimeMs,
        };
        const canonicalChanges: Record<string, unknown>[] = [];
        for (const change of changes) {
          if (change.kind === "actor-pose") {
            const actor = replayCase.actors.find((candidate) => candidate.id === change.actorId);
            const referencePose = actor
              ? (getActorPoseAtTime(
                  replayCase,
                  actor.id,
                  proposalPoseTarget.playheadTimeMs,
                  proposalPoseTarget.branchId,
                ) ?? actor.pose)
              : undefined;
            canonicalChanges.push({
              kind: change.kind,
              actorId: change.actorId,
              proposedPose: {
                x: normalizedCoordinateForDomain(
                  change.proposedPose.x,
                  bounds.minX,
                  bounds.maxX,
                  referencePose?.x,
                ),
                y: normalizedCoordinateForDomain(
                  change.proposedPose.y,
                  bounds.minY,
                  bounds.maxY,
                  referencePose?.y,
                ),
                rotationDeg: change.proposedPose.rotationDeg,
              },
            });
            continue;
          }
          if (change.kind === "trajectory-set") {
            const referenceTrajectory = change.trajectoryId
              ? replayCase.trajectories.find((trajectory) => trajectory.id === change.trajectoryId)
              : replayCase.trajectories.find(
                  (trajectory) =>
                    trajectory.actorId === change.actorId &&
                    trajectory.branchId === change.branchId,
                );
            canonicalChanges.push({
              kind: change.kind,
              ...(change.trajectoryId ? { trajectoryId: change.trajectoryId } : {}),
              actorId: change.actorId,
              branchId: change.branchId,
              keyframes: change.keyframes.map((frame) => {
                const referenceFrame = frame.id
                  ? referenceTrajectory?.keyframes.find((candidate) => candidate.id === frame.id)
                  : undefined;
                return {
                  ...(frame.id ? { id: frame.id } : {}),
                  timeMs: frame.timeMs,
                  x: normalizedCoordinateForDomain(
                    frame.x,
                    bounds.minX,
                    bounds.maxX,
                    referenceFrame?.x,
                  ),
                  y: normalizedCoordinateForDomain(
                    frame.y,
                    bounds.minY,
                    bounds.maxY,
                    referenceFrame?.y,
                  ),
                  rotationDeg: frame.rotationDeg,
                };
              }),
              visible: change.visible,
            });
            continue;
          }

          const actor = replayCase.actors.find((candidate) => candidate.id === change.actorId);
          if (!actor) {
            return adapterFailure(
              replayCase,
              "NOT_FOUND",
              `Scene actor ${change.actorId} does not exist.`,
            );
          }
          const branch = replayCase.branches.find((candidate) => candidate.id === change.branchId);
          if (!branch) {
            return adapterFailure(
              replayCase,
              "NOT_FOUND",
              `Hypothesis branch ${change.branchId} does not exist.`,
            );
          }
          if (branch.status !== "active") {
            return adapterFailure(
              replayCase,
              "INVALID_INPUT",
              `Hypothesis branch ${change.branchId} is archived and cannot receive a trajectory patch.`,
            );
          }
          const matchingTrajectories = replayCase.trajectories.filter(
            (trajectory) =>
              trajectory.actorId === change.actorId && trajectory.branchId === change.branchId,
          );
          if (matchingTrajectories.length === 0) {
            return adapterFailure(
              replayCase,
              "NOT_FOUND",
              `No trajectory exists for actor ${change.actorId} in branch ${change.branchId}.`,
            );
          }
          if (matchingTrajectories.length > 1) {
            return adapterFailure(
              replayCase,
              "INVALID_INPUT",
              `More than one trajectory exists for actor ${change.actorId} in branch ${change.branchId}; a keyframe patch would be ambiguous.`,
            );
          }
          const trajectory = matchingTrajectories[0];
          if (!trajectory) {
            return adapterFailure(replayCase, "NOT_FOUND", "The requested trajectory is missing.");
          }
          const adjustmentIds = change.adjustments.map((adjustment) => adjustment.keyframeId);
          if (new Set(adjustmentIds).size !== adjustmentIds.length) {
            return adapterFailure(
              replayCase,
              "INVALID_INPUT",
              "Trajectory keyframe patch IDs must be unique.",
            );
          }
          const keyframesById = new Map(
            trajectory.keyframes.map((keyframe) => [keyframe.id, keyframe]),
          );
          const missingKeyframeIds = adjustmentIds.filter(
            (keyframeId) => !keyframesById.has(keyframeId),
          );
          if (missingKeyframeIds.length > 0) {
            return adapterFailure(
              replayCase,
              "NOT_FOUND",
              `Trajectory keyframe ${missingKeyframeIds.join(", ")} ${missingKeyframeIds.length === 1 ? "does" : "do"} not exist on ${trajectory.id}.`,
            );
          }
          const firstKeyframe = trajectory.keyframes[0];
          const lastKeyframe = trajectory.keyframes.at(-1);
          const endpointIds = new Set(
            [firstKeyframe?.id, lastKeyframe?.id].filter(
              (keyframeId): keyframeId is string => keyframeId !== undefined,
            ),
          );
          const changedEndpointIds = adjustmentIds.filter((keyframeId) =>
            endpointIds.has(keyframeId),
          );
          if (changedEndpointIds.length > 0) {
            return adapterFailure(
              replayCase,
              "INVALID_INPUT",
              `Trajectory keyframe patches must preserve first and last endpoints; ${changedEndpointIds.join(", ")} cannot be changed.`,
            );
          }
          const adjustmentsById = new Map(
            change.adjustments.map((adjustment) => [adjustment.keyframeId, adjustment]),
          );
          canonicalChanges.push({
            kind: "trajectory-set",
            trajectoryId: trajectory.id,
            actorId: change.actorId,
            branchId: change.branchId,
            keyframes: trajectory.keyframes.map((frame) => {
              const adjustment = adjustmentsById.get(frame.id);
              return {
                id: frame.id,
                timeMs: frame.timeMs,
                x:
                  adjustment?.x === undefined
                    ? frame.x
                    : normalizedCoordinateForDomain(
                        adjustment.x,
                        bounds.minX,
                        bounds.maxX,
                        frame.x,
                      ),
                y:
                  adjustment?.y === undefined
                    ? frame.y
                    : normalizedCoordinateForDomain(
                        adjustment.y,
                        bounds.minY,
                        bounds.maxY,
                        frame.y,
                      ),
                rotationDeg: adjustment?.rotationDeg ?? frame.rotationDeg,
              };
            }),
            visible: change.visible,
          });
        }
        domainCommand = {
          type: "proposal.create",
          ...meta,
          poseAt: {
            branchId: proposalPoseTarget.branchId,
            timeMs: proposalPoseTarget.playheadTimeMs,
          },
          proposalId:
            typeof payload.proposalId === "string"
              ? payload.proposalId
              : id("proposal", command.requestId),
          title: payload.title,
          rationale: payload.rationale,
          revisionSummary: "Initial coordinated scene proposal from Site Tools.",
          changes: canonicalChanges,
        };
        break;
      }
      case "mark_impact_event": {
        const location = payload.location as { x: number; y: number };
        const requestedEventId = typeof payload.eventId === "string" ? payload.eventId : undefined;
        const existingEvent = requestedEventId
          ? replayCase.timelineEvents.find((event) => event.id === requestedEventId)
          : undefined;
        if (requestedEventId && !existingEvent) {
          return adapterFailure(
            replayCase,
            "NOT_FOUND",
            `Impact event ${requestedEventId} does not exist. Omit eventId to create a new impact.`,
          );
        }
        if (existingEvent && existingEvent.type !== "impact") {
          return adapterFailure(
            replayCase,
            "INVALID_INPUT",
            `Timeline event ${existingEvent.id} is ${existingEvent.type}, not an impact, and cannot be reclassified by mark_impact_event.`,
          );
        }
        if (existingEvent && existingEvent.branchId !== payload.branchId) {
          return adapterFailure(
            replayCase,
            "INVALID_INPUT",
            `Impact event ${existingEvent.id} belongs to branch ${existingEvent.branchId}, not ${String(payload.branchId)}.`,
          );
        }
        domainCommand = {
          type: "timeline.upsert",
          ...meta,
          ...(requestedEventId ? { eventId: requestedEventId } : {}),
          branchId: payload.branchId,
          timeMs: payload.timeMs,
          eventType: "impact",
          title: "Approximate contact",
          certainty: payload.status,
          linkedActorIds: payload.actorIds,
          location: {
            x: normalizedCoordinateForDomain(
              location.x,
              bounds.minX,
              bounds.maxX,
              existingEvent?.location?.x,
            ),
            y: normalizedCoordinateForDomain(
              location.y,
              bounds.minY,
              bounds.maxY,
              existingEvent?.location?.y,
            ),
          },
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
        if (sourceIds.length === 0) {
          return adapterFailure(
            replayCase,
            "INVALID_INPUT",
            "A damage record requires at least one active evidence or observation source ID.",
          );
        }
        const knownSourceIds = new Set([
          ...replayCase.evidence.filter((asset) => !asset.deleted).map((asset) => asset.id),
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
        const sourceIds = [...new Set(payload.sourceIds as string[])];
        const relatedIds = [...new Set(payload.relatedIds as string[])];
        const activeEvidenceIds = new Set(
          replayCase.evidence.filter((asset) => !asset.deleted).map((asset) => asset.id),
        );
        const observationIds = new Set(replayCase.claims.map((claim) => claim.id));
        const eventIds = new Set(replayCase.timelineEvents.map((event) => event.id));
        const sceneObjectIds = new Set([
          ...replayCase.actors.map((actor) => actor.id),
          ...replayCase.trajectories.map((trajectory) => trajectory.id),
          ...replayCase.actors.flatMap((actor) => actor.damageMarkers.map((marker) => marker.id)),
        ]);
        const invalidSourceIds = sourceIds.filter(
          (sourceId) => !activeEvidenceIds.has(sourceId) && !observationIds.has(sourceId),
        );
        if (invalidSourceIds.length > 0) {
          return adapterFailure(
            replayCase,
            "INVALID_INPUT",
            `Observation sourceIds accept only existing active evidence or observation IDs; unsupported or missing: ${invalidSourceIds.join(", ")}.`,
          );
        }
        const invalidRelatedIds = relatedIds.filter(
          (relatedId) =>
            !activeEvidenceIds.has(relatedId) &&
            !eventIds.has(relatedId) &&
            !sceneObjectIds.has(relatedId),
        );
        if (invalidRelatedIds.length > 0) {
          return adapterFailure(
            replayCase,
            "INVALID_INPUT",
            `Observation relatedIds accept only existing active evidence, timeline-event, actor, trajectory, or damage-marker IDs; unsupported or missing: ${invalidRelatedIds.join(", ")}.`,
          );
        }
        const sourceEvidenceIds = sourceIds.filter((sourceId) => activeEvidenceIds.has(sourceId));
        const relatedEvidenceIds = relatedIds.filter((relatedId) =>
          activeEvidenceIds.has(relatedId),
        );
        domainCommand = {
          type: "claim.add",
          ...meta,
          statement: payload.statement,
          status: payload.status,
          sourceType: payload.sourceType,
          sourceIds,
          linkedEvidenceIds: [...new Set([...sourceEvidenceIds, ...relatedEvidenceIds])],
          linkedEventIds: relatedIds.filter((relatedId) => eventIds.has(relatedId)),
          linkedSceneObjectIds: relatedIds.filter((relatedId) => sceneObjectIds.has(relatedId)),
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
        const relatedSceneObjectIds = new Set([
          ...replayCase.actors.map((actor) => actor.id),
          ...replayCase.trajectories.map((trajectory) => trajectory.id),
          ...replayCase.timelineEvents.map((event) => event.id),
          ...replayCase.actors.flatMap((actor) => actor.damageMarkers.map((marker) => marker.id)),
        ]);
        const activeEvidenceIds = new Set(
          replayCase.evidence.filter((asset) => !asset.deleted).map((asset) => asset.id),
        );
        const evidenceRelations = relatedIds.filter((relatedId) =>
          activeEvidenceIds.has(relatedId),
        );
        if (evidenceRelations.length > 0) {
          return adapterFailure(
            replayCase,
            "INVALID_INPUT",
            `Questions cannot relate directly to evidence IDs (${evidenceRelations.join(", ")}). Relate the observation, actor, trajectory, event, damage marker, or hypothesis that the evidence supports.`,
          );
        }
        const missingRelatedIds = relatedIds.filter(
          (relatedId) =>
            !relatedClaimIds.has(relatedId) &&
            !relatedBranchIds.has(relatedId) &&
            !relatedSceneObjectIds.has(relatedId),
        );
        if (missingRelatedIds.length > 0) {
          return adapterFailure(
            replayCase,
            "NOT_FOUND",
            `Question relation ${missingRelatedIds.join(", ")} ${missingRelatedIds.length === 1 ? "does" : "do"} not exist.`,
          );
        }
        domainCommand = {
          type: "question.add",
          ...meta,
          question: payload.question,
          reason: payload.reason,
          importance: payload.importance,
          rankingReasons:
            payload.importance === "blocking" ? ["blocks-report"] : ["contextual-detail"],
          relatedClaimIds: relatedIds.filter((relatedId) => relatedClaimIds.has(relatedId)),
          relatedSceneObjectIds: relatedIds.filter((relatedId) =>
            relatedSceneObjectIds.has(relatedId),
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
        if (visibleReportPreviewState(ui, replayCase).status !== "transient-human-review") {
          return adapterFailure(
            replayCase,
            "INVALID_STATE",
            "add_report_note requires an open current report preview. Finalized snapshots and closed previews are read-only; build a current draft preview first.",
          );
        }
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
      const visibleWorkspace = ui.getVisibleWorkspace();
      const visibleReport = visibleReportPreviewState(ui, replayCase);
      return {
        caseOpen: true,
        sceneExists: Boolean(replayCase.sceneTemplateId),
        factsAvailable: true,
        baselineExists: replayCase.branches.length > 0,
        reportPreviewAvailable: visibleReport.status === "transient-human-review",
        caseVersion: replayCase.caseVersion,
        workspaceMode: visibleWorkspace.workspaceMode,
        ...(visibleWorkspace.selectedItem
          ? { selectedItemId: visibleWorkspace.selectedItem.id }
          : {}),
      };
    },
    subscribe(listener) {
      return engine.subscribe(() => listener());
    },
    getCaseSummary(context) {
      ensureNotAborted(context);
      return getCaseSummary(ui.getCase());
    },
    getWorkspaceState(
      sections: readonly WorkspaceSection[],
      context,
      options?: Readonly<{ branchId?: string }>,
    ) {
      ensureNotAborted(context);
      const replayCase = ui.getCase();
      const visibleWorkspace = ui.getVisibleWorkspace();
      const playheadTimeMs = playheadTimeForCase(ui, replayCase);
      const branchId = options?.branchId ?? replayCase.activeBranchId;
      if (!replayCase.branches.some((branch) => branch.id === branchId)) {
        throw new ReplayWebMCPContractError(
          "NOT_FOUND",
          `Hypothesis branch ${branchId} does not exist.`,
        );
      }
      const projectedSections: Partial<Record<WorkspaceSection, unknown>> = {};
      for (const section of sections) {
        if (section === "claims") projectedSections[section] = claimsForWebMCP(replayCase);
        else if (section === "evidence")
          projectedSections[section] = evidenceSectionForWebMCP(replayCase);
        else if (section === "questions")
          projectedSections[section] = questionsForWebMCP(replayCase);
        else if (section === "selection") {
          projectedSections[section] =
            visibleWorkspace.selectedItem === undefined
              ? null
              : structuredClone(visibleWorkspace.selectedItem);
        } else if (section === "scene") {
          projectedSections[section] = sceneForWebMCP(replayCase, playheadTimeMs, branchId);
        } else if (section === "timeline") {
          projectedSections[section] = timelineForWebMCP(replayCase, branchId);
        } else if (section === "hypotheses") {
          projectedSections[section] = hypothesesForWebMCP(replayCase);
        } else {
          const visibleReport = visibleReportPreviewState(ui, replayCase);
          projectedSections[section] = {
            ...reportForWebMCP(replayCase),
            visiblePreviewStatus: visibleReport.status,
            visiblePreview:
              visibleReport.preview === undefined ? null : structuredClone(visibleReport.preview),
            ...(visibleReport.snapshotId === undefined
              ? {}
              : { visiblePreviewSnapshotId: visibleReport.snapshotId }),
          };
        }
      }
      return {
        coordinateSystem: structuredClone(WEBMCP_COORDINATE_SYSTEM),
        ...(options?.branchId === undefined
          ? {}
          : {
              branchContext: {
                projectedBranchId: branchId,
                activeBranchId: replayCase.activeBranchId,
                activeBranchUnchanged: true,
              },
            }),
        ...projectedSections,
      };
    },
    getRecentActivity(input: Readonly<{ limit: number; author: ActivityAuthorFilter }>, context) {
      ensureNotAborted(context);
      const replayCase = ui.getCase();
      const canonicalActivityById = new Map(
        replayCase.activity.map((item) => [item.id, item] as const),
      );
      const activity = ui.getVisibleActivity
        ? structuredClone([...ui.getVisibleActivity()]).sort((left, right) =>
            right.createdAt.localeCompare(left.createdAt),
          )
        : getRecentActivity(replayCase, replayCase.activity.length);
      const filtered =
        input.author === "all" ? activity : activity.filter((item) => item.author === input.author);
      return filtered.slice(0, input.limit).map((item) => {
        const canonicalActivity = canonicalActivityById.get(item.id);
        const requestId = canonicalActivity?.requestId;
        return {
          ...item,
          revertEligible:
            requestId !== undefined &&
            requestId === item.requestId &&
            engine.canRevertAgentAction(requestId),
        };
      });
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
        coordinateSystem: structuredClone(WEBMCP_COORDINATE_SYSTEM),
        branchIds: [...input.branchIds],
        activeBranchId: replayCase.activeBranchId,
        activeBranchUnchanged: true,
        pairwiseComparisons: alternatives.map((alternative) => {
          const pairwiseComparison = compareHypotheses(replayCase, baseline, alternative);
          return {
            ...pairwiseComparison,
            geometryTimingDeltas: geometryTimingDeltasForWebMCP(
              replayCase,
              baseline,
              alternative,
              pairwiseComparison,
            ),
          };
        }),
      };
      ensureNotAborted(context);
      return comparison;
    },
    revealHypothesisComparison(branchIds, context) {
      ensureNotAborted(context);
      ui.setComparison([...branchIds]);
    },
    focusWorkspaceItem(input, context) {
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
            issues: [],
          };
        }
        ensureNotAborted(context);
        ui.focusIssue(issue.id, issue.affectedIds);
        return {
          ok: true,
          message: `Focused consistency issue: ${issue.title}`,
          caseVersion: replayCase.caseVersion,
          affectedIds: issue.affectedIds,
          issues: [issue],
        };
      }
      const branchScoped = input.itemType === "trajectory" || input.itemType === "event";
      if (input.branchId !== undefined && !branchScoped) {
        return {
          ok: false,
          message: "branchId is accepted only when focusing a trajectory or timeline event.",
          code: "INVALID_INPUT",
          caseVersion: replayCase.caseVersion,
          affectedIds: [],
          issues: [],
        };
      }
      const inspectedBranchId = branchScoped
        ? (input.branchId ?? replayCase.activeBranchId)
        : undefined;
      if (
        inspectedBranchId !== undefined &&
        !replayCase.branches.some((branch) => branch.id === inspectedBranchId)
      ) {
        return {
          ok: false,
          message: `Hypothesis branch ${inspectedBranchId} does not exist.`,
          code: "NOT_FOUND",
          caseVersion: replayCase.caseVersion,
          affectedIds: [],
          issues: [],
        };
      }
      if (
        !workspaceItemExists(
          replayCase,
          input.itemType,
          input.itemId,
          inspectedBranchId ?? replayCase.activeBranchId,
        )
      ) {
        return {
          ok: false,
          message:
            inspectedBranchId === undefined
              ? `Workspace ${domainItemType(input.itemType)} ${input.itemId} does not exist.`
              : `Workspace ${domainItemType(input.itemType)} ${input.itemId} does not exist in hypothesis branch ${inspectedBranchId}.`,
          code: "NOT_FOUND",
          caseVersion: replayCase.caseVersion,
          affectedIds: [],
          issues: [],
        };
      }
      const mode = workspaceModeForItem(input.itemType);
      ensureNotAborted(context);
      ui.focusWorkspaceItem(input.itemType, input.itemId, mode);
      return {
        ok: true,
        message:
          inspectedBranchId === undefined
            ? `Focused ${domainItemType(input.itemType)} ${input.itemId}.`
            : `Focused ${domainItemType(input.itemType)} ${input.itemId} in hypothesis branch ${inspectedBranchId} without activating the branch.`,
        caseVersion: replayCase.caseVersion,
        affectedIds: [input.itemId],
        issues: replayCase.consistencyIssues.filter((issue) =>
          issue.affectedIds.includes(input.itemId),
        ),
        ...(inspectedBranchId === undefined
          ? {}
          : {
              data: {
                inspectedBranchId,
                activeBranchId: replayCase.activeBranchId,
                activeBranchUnchanged: true,
              },
            }),
      };
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
      const previewRequirementsComplete = preview.missingRequirements.length === 0;
      return {
        ok: true,
        message: previewRequirementsComplete
          ? "Built and opened a report preview with all preview requirements present. add_report_note is now available in the next Site Tools inventory. It is not finalized or share-ready; only a human can review, acknowledge, and finalize it."
          : `Built and opened a report preview with ${String(preview.missingRequirements.length)} missing requirement${preview.missingRequirements.length === 1 ? "" : "s"}. add_report_note is now available in the next Site Tools inventory. It is not finalized or share-ready; only a human can review, acknowledge, and finalize it.`,
        caseVersion: replayCase.caseVersion,
        affectedIds: ["report-preview"],
        issues: replayCase.consistencyIssues,
        data: {
          previewVersion: preview.caseVersion,
          readiness: {
            previewRequirementsComplete,
            finalized: false,
            shareReady: false,
            humanActionRequired: true,
            nextRequiredAction: "human-review-acknowledgement-and-finalization",
          },
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
