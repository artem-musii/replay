import type { ReplayMutationCommand, ReplayCommandErrorCode } from "./commandSchemas";
import {
  agentObservationSourceRequirement,
  compatibleAgentObservationSourceIds,
  isExternallyAttributedClaimSourceType,
} from "./claimProvenance";
import { validateCurrentReportPreview } from "./consistency";
import {
  completenessAttestationKey,
  completenessBasisFingerprint,
  isCompletenessAttestationCurrent,
} from "./completeness";
import { clampTimeToRange, interpolateTrajectory } from "./interpolation";
import { buildReportPreview, createReportPreviewReviewBinding } from "./report";
import type {
  ActionAuthor,
  AgentProposal,
  AgentProposalChange,
  AgentProposalRevision,
  ActorKeyframe,
  ActorPose,
  ChangeRecord,
  Claim,
  EvidenceAsset,
  HypothesisAssumption,
  ItemLock,
  OpenQuestion,
  ReplayCase,
  TimelineEvent,
  Trajectory,
} from "./models";
import { containsLiabilityConclusion } from "./languageSafety";

export class DomainCommandError extends Error {
  readonly code: ReplayCommandErrorCode;
  readonly details: Record<string, unknown> | undefined;
  readonly lockedItem:
    | {
        id: string;
        type: string;
        lockedBy: ActionAuthor;
        reason?: string | undefined;
        allowedAlternatives: string[];
      }
    | undefined;

  constructor(
    code: ReplayCommandErrorCode,
    message: string,
    options: {
      details?: Record<string, unknown> | undefined;
      lockedItem?: DomainCommandError["lockedItem"] | undefined;
    } = {},
  ) {
    super(message);
    this.name = "DomainCommandError";
    this.code = code;
    this.details = options.details;
    this.lockedItem = options.lockedItem;
  }
}

export interface CommandExecutionContext {
  now: string;
  nextVersion: number;
  makeId: (prefix: string) => string;
}

export interface MutationOutcome {
  nextState: ReplayCase;
  affectedIds: string[];
  summary: string;
  undoable: boolean;
  historyBarrier?: boolean;
}

function fail(
  code: ReplayCommandErrorCode,
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new DomainCommandError(code, message, details ? { details } : {});
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function ensureBranchOwnedIndex(
  state: ReplayCase,
  ownerBranchId: string,
  collectionName: "trajectoryIds" | "eventIds",
  objectId: string,
): void {
  state.branches.forEach((branch) => {
    branch[collectionName] =
      branch.id === ownerBranchId
        ? unique([...branch[collectionName], objectId])
        : branch[collectionName].filter((candidateId) => candidateId !== objectId);
  });
}

type DamageMarkerOwner = {
  actor: ReplayCase["actors"][number];
  marker: ReplayCase["actors"][number]["damageMarkers"][number];
};

function damageMarkerOwners(state: ReplayCase): DamageMarkerOwner[] {
  return state.actors.flatMap((actor) => actor.damageMarkers.map((marker) => ({ actor, marker })));
}

function requireDamageMarkerOwner(state: ReplayCase, markerId: string): DamageMarkerOwner {
  const owner = damageMarkerOwners(state).find(({ marker }) => marker.id === markerId);
  if (!owner) fail("NOT_FOUND", `Damage marker ${markerId} does not exist`, { markerId });
  return owner;
}

function assertDamageMarkerLinkEditable(
  owner: DamageMarkerOwner,
  command: ReplayMutationCommand,
): void {
  ensureUnlocked(owner.actor, "actor");
  if (owner.marker.status === "confirmed" && command.actor !== "human") {
    fail(
      "HUMAN_CONFIRMATION_REQUIRED",
      "An agent cannot change links on a human-confirmed damage observation",
    );
  }
}

function damageClaimLinkChanges(
  state: ReplayCase,
  previousSceneObjectIds: readonly string[],
  nextSceneObjectIds: readonly string[],
  command: ReplayMutationCommand,
): Array<DamageMarkerOwner & { linked: boolean }> {
  const changes = damageMarkerOwners(state).flatMap((owner) => {
    const wasLinked = previousSceneObjectIds.includes(owner.marker.id);
    const linked = nextSceneObjectIds.includes(owner.marker.id);
    return wasLinked === linked ? [] : [{ ...owner, linked }];
  });
  changes.forEach((owner) => assertDamageMarkerLinkEditable(owner, command));
  return changes;
}

function setDamageEvidenceRelation(
  marker: DamageMarkerOwner["marker"],
  asset: EvidenceAsset,
  linked: boolean,
): void {
  marker.linkedEvidenceIds = linked
    ? unique([...marker.linkedEvidenceIds, asset.id])
    : marker.linkedEvidenceIds.filter((id) => id !== asset.id);
  asset.linkedSceneObjectIds = linked
    ? unique([...asset.linkedSceneObjectIds, marker.id])
    : asset.linkedSceneObjectIds.filter((id) => id !== marker.id);
}

function setDamageClaimRelation(
  marker: DamageMarkerOwner["marker"],
  claim: Claim,
  linked: boolean,
): void {
  marker.linkedClaimIds = linked
    ? unique([...marker.linkedClaimIds, claim.id])
    : marker.linkedClaimIds.filter((id) => id !== claim.id);
  claim.linkedSceneObjectIds = linked
    ? unique([...claim.linkedSceneObjectIds, marker.id])
    : claim.linkedSceneObjectIds.filter((id) => id !== marker.id);
}

function requireHumanUi(
  command: ReplayMutationCommand,
  code: ReplayCommandErrorCode,
  message: string,
): void {
  if (command.actor !== "human" || command.origin !== "ui") fail(code, message);
}

function assertNotConfirmedByAgent(command: ReplayMutationCommand, status: string): void {
  if (status === "confirmed" && (command.actor !== "human" || command.origin !== "ui")) {
    fail(
      "HUMAN_CONFIRMATION_REQUIRED",
      "Only an explicit human interface action may create confirmed information.",
    );
  }
}

function resolveObservationSourceIds(
  state: ReplayCase,
  command: ReplayMutationCommand,
  sourceType: Claim["sourceType"],
  submittedSourceIds: readonly string[],
): string[] {
  const uniqueSourceIds = unique([...submittedSourceIds]);
  const compatibleSourceIds = compatibleAgentObservationSourceIds(
    state,
    sourceType,
    uniqueSourceIds,
  );
  if (
    command.actor === "agent" &&
    isExternallyAttributedClaimSourceType(sourceType) &&
    compatibleSourceIds.length === 0
  ) {
    fail(
      "FORBIDDEN_ACTION",
      `An agent observation classified as ${sourceType} must cite ${agentObservationSourceRequirement(sourceType)}. Use agent-inference when no compatible external source exists.`,
      {
        sourceType,
        providedSourceIds: uniqueSourceIds,
      },
    );
  }
  if (
    command.actor === "human" &&
    (sourceType === "photo" || sourceType === "document") &&
    compatibleSourceIds.length === 0
  ) {
    fail(
      "INVALID_COMMAND",
      `A human observation classified as ${sourceType} must cite ${agentObservationSourceRequirement(sourceType)}.`,
      {
        sourceType,
        providedSourceIds: uniqueSourceIds,
      },
    );
  }
  return command.actor === "agent" || sourceType === "photo" || sourceType === "document"
    ? compatibleSourceIds
    : uniqueSourceIds;
}

function requireNeutralHypothesis(text: string): void {
  if (/\b(?:true|correct)\b/i.test(text) || containsLiabilityConclusion(text)) {
    fail(
      "FORBIDDEN_ACTION",
      "Hypotheses must use neutral alternative language and cannot determine truth, fault, or liability.",
    );
  }
}

function requireNeutralReportText(text: string): void {
  if (containsLiabilityConclusion(text)) {
    fail(
      "FORBIDDEN_ACTION",
      "Report wording must be neutral and cannot determine fault or legal liability.",
    );
  }
}

function changeRecord(
  context: CommandExecutionContext,
  command: ReplayMutationCommand,
  summary: string,
): ChangeRecord {
  return {
    id: context.makeId("change"),
    caseVersion: context.nextVersion,
    author: command.actor,
    origin: command.origin,
    summary,
    createdAt: context.now,
    ...(command.requestId ? { requestId: command.requestId } : {}),
  };
}

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  const leftIds = new Set(left);
  const rightIds = new Set(right);
  return leftIds.size === rightIds.size && [...leftIds].every((id) => rightIds.has(id));
}

function claimContentOrProvenanceChanged(
  claim: Claim,
  command: Extract<ReplayMutationCommand, { type: "claim.update" }>,
): boolean {
  return (
    (command.statement !== undefined && command.statement !== claim.statement) ||
    (command.sourceType !== undefined && command.sourceType !== claim.sourceType) ||
    (command.sourceIds !== undefined && !sameIdSet(command.sourceIds, claim.sourceIds)) ||
    (command.linkedEvidenceIds !== undefined &&
      !sameIdSet(command.linkedEvidenceIds, claim.linkedEvidenceIds)) ||
    (command.linkedEventIds !== undefined &&
      !sameIdSet(command.linkedEventIds, claim.linkedEventIds)) ||
    (command.linkedSceneObjectIds !== undefined &&
      !sameIdSet(command.linkedSceneObjectIds, claim.linkedSceneObjectIds))
  );
}

/** A human confirmation attests to one exact claim revision, including its provenance. */
function invalidatePriorClaimConfirmation(
  claim: Claim,
  context: CommandExecutionContext,
  command: ReplayMutationCommand,
): boolean {
  if (claim.status !== "confirmed" || !claim.humanConfirmed) return false;
  claim.status = "reported";
  claim.humanConfirmed = false;
  delete claim.confirmedAt;
  claim.updatedAt = context.now;
  claim.changeHistory.push(
    changeRecord(
      context,
      command,
      "Prior human confirmation invalidated because claim content or provenance changed.",
    ),
  );
  return true;
}

function lockError(id: string, type: string, lock: ItemLock): never {
  throw new DomainCommandError("LOCKED_ITEM", `${type} ${id} is locked`, {
    lockedItem: {
      id,
      type,
      lockedBy: lock.lockedBy,
      ...(lock.reason ? { reason: lock.reason } : {}),
      allowedAlternatives: [
        "Ask the human to unlock the item",
        "Create or edit an alternative hypothesis branch",
        "Record the discrepancy as an open question",
      ],
    },
  });
}

function ensureUnlocked(
  item: { id: string; locked: boolean; lock?: ItemLock | undefined },
  type: string,
): void {
  if (item.locked) {
    lockError(
      item.id,
      type,
      item.lock ?? { lockedBy: "system", lockedAt: new Date(0).toISOString() },
    );
  }
}

function allObjectIds(replayCase: ReplayCase): Set<string> {
  return new Set([
    replayCase.id,
    ...replayCase.actors.flatMap((actor) => [
      actor.id,
      ...actor.damageMarkers.map((marker) => marker.id),
    ]),
    ...replayCase.trajectories.flatMap((trajectory) => [
      trajectory.id,
      ...trajectory.keyframes.map((keyframe) => keyframe.id),
    ]),
    ...replayCase.timelineEvents.map((event) => event.id),
    ...replayCase.branches.flatMap((branch) => [
      branch.id,
      ...branch.assumptions.map((assumption) => assumption.id),
    ]),
    ...replayCase.claims.map((claim) => claim.id),
    ...replayCase.evidence.flatMap((asset) => [
      asset.id,
      ...asset.annotations.map((annotation) => annotation.id),
    ]),
    ...replayCase.questions.map((question) => question.id),
    ...replayCase.proposals.flatMap((proposal) => [
      proposal.id,
      ...proposal.revisions.flatMap((revision) => [
        revision.id,
        ...revision.changes.map((change) => change.id),
      ]),
    ]),
    ...replayCase.activity.map((activity) => activity.id),
    ...replayCase.completenessAttestations.map((attestation) => attestation.id),
    ...replayCase.reportNotes.map((note) => note.id),
    ...replayCase.reportSnapshots.map((snapshot) => snapshot.id),
  ]);
}

function reserveId(
  replayCase: ReplayCase,
  context: CommandExecutionContext,
  prefix: string,
  preferred?: string,
): string {
  const known = allObjectIds(replayCase);
  if (preferred) {
    if (known.has(preferred))
      fail("DUPLICATE_ID", `Object ID ${preferred} already exists`, { id: preferred });
    return preferred;
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = context.makeId(prefix);
    if (!known.has(candidate)) return candidate;
  }
  return fail("INVALID_STATE", `Unable to allocate a unique ${prefix} ID`);
}

function requireActor(replayCase: ReplayCase, actorId: string) {
  const actor = replayCase.actors.find((candidate) => candidate.id === actorId);
  if (!actor) fail("NOT_FOUND", `Actor ${actorId} does not exist`, { actorId });
  return actor;
}

function requireTrajectory(replayCase: ReplayCase, trajectoryId: string): Trajectory {
  const trajectory = replayCase.trajectories.find((candidate) => candidate.id === trajectoryId);
  if (!trajectory) fail("NOT_FOUND", `Trajectory ${trajectoryId} does not exist`, { trajectoryId });
  return trajectory;
}

function trajectoriesForActorBranch(
  replayCase: ReplayCase,
  actorId: string,
  branchId: string,
): Trajectory[] {
  return replayCase.trajectories.filter(
    (trajectory) => trajectory.actorId === actorId && trajectory.branchId === branchId,
  );
}

function requireUnambiguousTrajectoryForActorBranch(
  replayCase: ReplayCase,
  actorId: string,
  branchId: string,
): Trajectory | undefined {
  const trajectories = trajectoriesForActorBranch(replayCase, actorId, branchId);
  if (trajectories.length > 1) {
    fail(
      "INVALID_STATE",
      `Actor ${actorId} has multiple trajectories (${trajectories.map((trajectory) => trajectory.id).join(", ")}) in branch ${branchId}; resolve the ambiguity before editing`,
      { actorId, branchId, trajectoryIds: trajectories.map((trajectory) => trajectory.id) },
    );
  }
  return trajectories[0];
}

function requireEvent(replayCase: ReplayCase, eventId: string): TimelineEvent {
  const event = replayCase.timelineEvents.find((candidate) => candidate.id === eventId);
  if (!event) fail("NOT_FOUND", `Timeline event ${eventId} does not exist`, { eventId });
  return event;
}

function requireClaim(replayCase: ReplayCase, claimId: string): Claim {
  const claim = replayCase.claims.find((candidate) => candidate.id === claimId);
  if (!claim) fail("NOT_FOUND", `Claim ${claimId} does not exist`, { claimId });
  return claim;
}

function requireEvidence(replayCase: ReplayCase, evidenceId: string): EvidenceAsset {
  const asset = replayCase.evidence.find((candidate) => candidate.id === evidenceId);
  if (!asset) fail("NOT_FOUND", `Evidence ${evidenceId} does not exist`, { evidenceId });
  if (asset.deleted)
    fail("INVALID_STATE", `Evidence ${evidenceId} has been deleted`, { evidenceId });
  return asset;
}

function requireBranch(replayCase: ReplayCase, branchId: string) {
  const branch = replayCase.branches.find((candidate) => candidate.id === branchId);
  if (!branch) fail("NOT_FOUND", `Hypothesis branch ${branchId} does not exist`, { branchId });
  return branch;
}

function requireQuestion(replayCase: ReplayCase, questionId: string): OpenQuestion {
  const question = replayCase.questions.find((candidate) => candidate.id === questionId);
  if (!question) fail("NOT_FOUND", `Question ${questionId} does not exist`, { questionId });
  return question;
}

function requireProposal(replayCase: ReplayCase, proposalId: string): AgentProposal {
  const proposal = replayCase.proposals.find((candidate) => candidate.id === proposalId);
  if (!proposal) fail("NOT_FOUND", `Agent proposal ${proposalId} does not exist`, { proposalId });
  return proposal;
}

function requirePendingProposal(replayCase: ReplayCase, proposalId: string): AgentProposal {
  const proposal = requireProposal(replayCase, proposalId);
  if (proposal.status !== "pending") {
    fail("INVALID_STATE", `Agent proposal ${proposalId} has already been ${proposal.status}`, {
      proposalId,
      status: proposal.status,
    });
  }
  return proposal;
}

function assertBranchEditable(replayCase: ReplayCase, branchId: string) {
  const branch = requireBranch(replayCase, branchId);
  if (branch.status === "archived")
    fail("ARCHIVED_BRANCH", `Hypothesis branch ${branchId} is archived`, { branchId });
  return branch;
}

function assertReferences(
  replayCase: ReplayCase,
  ids: string[],
  kind: "claim" | "evidence" | "event" | "scene" | "branch" | "source",
): void {
  const known = new Set(
    kind === "source"
      ? allObjectIds(replayCase)
      : kind === "claim"
        ? replayCase.claims.map((item) => item.id)
        : kind === "evidence"
          ? replayCase.evidence.filter((item) => !item.deleted).map((item) => item.id)
          : kind === "event"
            ? replayCase.timelineEvents.map((item) => item.id)
            : kind === "branch"
              ? replayCase.branches.map((item) => item.id)
              : [
                  ...replayCase.actors.map((item) => item.id),
                  ...replayCase.trajectories.map((item) => item.id),
                  ...replayCase.actors.flatMap((actor) =>
                    actor.damageMarkers.map((item) => item.id),
                  ),
                ],
  );
  const missing = ids.filter((item) => !known.has(item));
  if (missing.length > 0)
    fail("NOT_FOUND", `Missing ${kind} references: ${missing.join(", ")}`, { missing, kind });
}

const questionImportanceWeight: Record<OpenQuestion["importance"], number> = {
  blocking: 400,
  high: 300,
  medium: 200,
  low: 100,
};

const rankingReasonWeight: Record<OpenQuestion["rankingReasons"][number], number> = {
  "blocks-report": 50,
  "resolves-contradiction": 40,
  "distinguishes-hypotheses": 30,
  "required-field": 20,
  "contextual-detail": 10,
};

export function rankOpenQuestions(questions: OpenQuestion[]): OpenQuestion[] {
  return [...questions].sort((a, b) => {
    const score = (question: OpenQuestion) =>
      questionImportanceWeight[question.importance] +
      question.rankingReasons.reduce((sum, reason) => sum + rankingReasonWeight[reason], 0);
    return (
      score(b) - score(a) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
    );
  });
}

function appendBranchChange(
  branch: ReplayCase["branches"][number],
  context: CommandExecutionContext,
  command: ReplayMutationCommand,
  summary: string,
): void {
  branch.updatedAt = context.now;
  branch.changeHistory.push(changeRecord(context, command, summary));
}

function applyCaseUpdate(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "case.update" }>,
): MutationOutcome {
  if (
    command.title === undefined &&
    command.incidentDate === undefined &&
    command.approximateTime === undefined &&
    command.sceneTemplateId === undefined &&
    command.environment === undefined &&
    command.timeRangeMs === undefined
  )
    fail("INVALID_COMMAND", "Case update contains no changes");
  if (command.title !== undefined) state.title = command.title;
  if (command.incidentDate !== undefined) {
    if (command.incidentDate === null) delete state.incidentDate;
    else state.incidentDate = command.incidentDate;
  }
  if (command.approximateTime !== undefined) {
    if (command.approximateTime === null) delete state.approximateTime;
    else state.approximateTime = command.approximateTime;
  }
  if (command.sceneTemplateId !== undefined) state.sceneTemplateId = command.sceneTemplateId;
  if (command.environment !== undefined) state.environment = structuredClone(command.environment);
  if (command.timeRangeMs !== undefined) {
    if (command.timeRangeMs.end <= command.timeRangeMs.start)
      fail("INVALID_COMMAND", "Time range end must follow start");
    state.timeRangeMs = structuredClone(command.timeRangeMs);
  }
  return {
    nextState: state,
    affectedIds: [state.id],
    summary: "Updated case details.",
    undoable: true,
  };
}

function applyActorUpsert(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "actor.upsert" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  const incoming = structuredClone(command.sceneActor);
  incoming.lastEditedBy = command.actor;
  incoming.lastEditedAt = context.now;
  requireNeutralReportText(incoming.label);
  const existingIndex = state.actors.findIndex((actor) => actor.id === incoming.id);
  if (existingIndex >= 0) {
    const existing = state.actors[existingIndex];
    if (!existing) fail("INVALID_STATE", `Actor index ${String(existingIndex)} is invalid`);
    ensureUnlocked(existing, "actor");
    const damageChanged =
      JSON.stringify(existing.damageMarkers) !== JSON.stringify(incoming.damageMarkers);
    if (command.actor !== "human" || command.origin !== "ui") {
      const existingHasTrustedDimensions =
        existing.dimensionsSource === "measured" || existing.dimensionsSource === "manufacturer";
      const incomingClaimsTrustedDimensions =
        incoming.dimensionsSource === "measured" || incoming.dimensionsSource === "manufacturer";
      const trustedDimensionsChanged =
        existing.dimensionsSource !== incoming.dimensionsSource ||
        existing.dimensions.width !== incoming.dimensions.width ||
        existing.dimensions.length !== incoming.dimensions.length ||
        existing.wheelbaseMeters !== incoming.wheelbaseMeters;
      if (
        trustedDimensionsChanged &&
        (existingHasTrustedDimensions || incomingClaimsTrustedDimensions)
      ) {
        fail(
          "FORBIDDEN_ACTION",
          "An agent cannot alter measured/manufacturer dimensions, source, or wheelbase",
        );
      }
      if (incoming.locked) {
        fail("FORBIDDEN_ACTION", "An agent cannot lock a scene actor through an upsert command");
      }
      const confirmedDamageChanged =
        damageChanged &&
        [...existing.damageMarkers, ...incoming.damageMarkers].some(
          (marker) => marker.status === "confirmed",
        );
      if (confirmedDamageChanged) {
        fail(
          "HUMAN_CONFIRMATION_REQUIRED",
          "An agent cannot alter human-confirmed damage while updating a scene actor",
        );
      }
    }
    if (damageChanged) {
      fail(
        "INVALID_COMMAND",
        "Actor upsert cannot change damage markers; use the damage command so provenance links stay synchronized",
      );
    }
    state.actors[existingIndex] = incoming;
    const trajectoryOutcome = command.poseAt
      ? applyPoseAtTime(state, incoming.id, incoming.pose, command.poseAt, command, context)
      : undefined;
    return {
      nextState: state,
      affectedIds: unique([incoming.id, ...(trajectoryOutcome?.affectedIds ?? [])]),
      summary: `Updated ${incoming.label}.`,
      undoable: true,
    };
  }
  if (
    (command.actor !== "human" || command.origin !== "ui") &&
    (incoming.dimensionsSource === "measured" || incoming.dimensionsSource === "manufacturer")
  ) {
    fail("FORBIDDEN_ACTION", "An agent cannot create measured/manufacturer vehicle dimensions");
  }
  if (incoming.damageMarkers.length > 0) {
    fail(
      "INVALID_COMMAND",
      "A new actor must be created before adding damage markers through the damage command",
    );
  }
  if (
    (command.actor !== "human" || command.origin !== "ui") &&
    (incoming.locked || incoming.damageMarkers.some((marker) => marker.status === "confirmed"))
  ) {
    fail(
      "HUMAN_CONFIRMATION_REQUIRED",
      "An agent cannot create locks or confirmed damage observations",
    );
  }
  if (allObjectIds(state).has(incoming.id))
    fail("DUPLICATE_ID", `Object ID ${incoming.id} already exists`);
  state.actors.push(incoming);
  return {
    nextState: state,
    affectedIds: [incoming.id],
    summary: `Added ${incoming.label}.`,
    undoable: true,
  };
}

function applyActorPose(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "actor.update-pose" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  const actor = requireActor(state, command.actorId);
  ensureUnlocked(actor, "actor");
  const trajectoryOutcome = command.poseAt
    ? applyPoseAtTime(state, actor.id, command.pose, command.poseAt, command, context)
    : undefined;
  if (trajectoryOutcome) {
    return {
      ...trajectoryOutcome,
      summary: `${command.actor === "agent" ? "Agent" : "Human"} moved ${actor.label} at the playhead.`,
    };
  }
  actor.pose = structuredClone(command.pose);
  actor.lastEditedBy = command.actor;
  actor.lastEditedAt = context.now;
  return {
    nextState: state,
    affectedIds: [actor.id],
    summary: `${command.actor === "agent" ? "Agent" : "Human"} moved ${actor.label}.`,
    undoable: true,
  };
}

function applyTrajectorySet(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "trajectory.set" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  const actor = requireActor(state, command.actorId);
  ensureUnlocked(actor, "actor");
  const branch = assertBranchEditable(state, command.branchId);
  for (let index = 1; index < command.keyframes.length; index += 1) {
    const current = command.keyframes[index];
    const previous = command.keyframes[index - 1];
    if (!current || !previous) fail("INVALID_COMMAND", "Trajectory keyframes are incomplete");
    if (current.timeMs <= previous.timeMs) {
      fail("INVALID_COMMAND", "Trajectory keyframe times must be strictly increasing");
    }
  }
  const actorBranchTrajectory = requireUnambiguousTrajectoryForActorBranch(
    state,
    actor.id,
    branch.id,
  );
  let trajectory = command.trajectoryId
    ? state.trajectories.find((candidate) => candidate.id === command.trajectoryId)
    : actorBranchTrajectory;
  if (trajectory && (trajectory.actorId !== actor.id || trajectory.branchId !== branch.id)) {
    fail(
      "INVALID_COMMAND",
      "An existing trajectory cannot be reassigned to another actor or branch",
    );
  }
  if (command.trajectoryId && !trajectory && allObjectIds(state).has(command.trajectoryId)) {
    fail("DUPLICATE_ID", `Object ID ${command.trajectoryId} already exists`);
  }
  if (!trajectory && actorBranchTrajectory) {
    fail(
      "INVALID_COMMAND",
      `Actor ${actor.id} already has trajectory ${actorBranchTrajectory.id} in branch ${branch.id}; update that trajectory instead of creating ${command.trajectoryId ?? "another trajectory"}`,
      {
        actorId: actor.id,
        branchId: branch.id,
        existingTrajectoryId: actorBranchTrajectory.id,
        requestedTrajectoryId: command.trajectoryId,
      },
    );
  }
  const trajectoryId =
    trajectory?.id ?? reserveId(state, context, "trajectory", command.trajectoryId);
  const keyframeIds = new Set<string>();
  const keyframes = command.keyframes.map((keyframe) => {
    const keyframeId = keyframe.id ?? context.makeId("keyframe");
    if (keyframeIds.has(keyframeId)) fail("DUPLICATE_ID", `Duplicate keyframe ID ${keyframeId}`);
    keyframeIds.add(keyframeId);
    return { ...keyframe, id: keyframeId, actorId: actor.id };
  });
  if (trajectory) {
    ensureUnlocked(trajectory, "trajectory");
    trajectory.keyframes = keyframes;
    if (command.visible !== undefined) trajectory.visible = command.visible;
    trajectory.changeHistory.push(changeRecord(context, command, "Updated trajectory keyframes."));
  } else {
    trajectory = {
      id: trajectoryId,
      actorId: actor.id,
      branchId: branch.id,
      interpolationMode: "linear",
      keyframes,
      visible: command.visible ?? true,
      locked: false,
      createdBy: command.actor,
      changeHistory: [changeRecord(context, command, "Created trajectory.")],
    };
    state.trajectories.push(trajectory);
  }
  ensureBranchOwnedIndex(state, branch.id, "trajectoryIds", trajectory.id);
  const final = keyframes.at(-1);
  if (!final) fail("INVALID_COMMAND", "Trajectory requires at least one keyframe");
  actor.pose = { x: final.x, y: final.y, rotationDeg: final.rotationDeg };
  actor.lastEditedBy = command.actor;
  actor.lastEditedAt = context.now;
  appendBranchChange(branch, context, command, `Updated ${actor.label} trajectory.`);
  return {
    nextState: state,
    affectedIds: [trajectory.id, actor.id, branch.id],
    summary: `Updated ${actor.label} trajectory in ${branch.name}.`,
    undoable: true,
  };
}

function keyframesWithPoseAtTime(
  state: ReplayCase,
  trajectory: Trajectory,
  timeMs: number,
  pose: ActorPose,
  makeKeyframeId: () => string,
): ActorKeyframe[] {
  const targetTimeMs = clampTimeToRange(timeMs, state.timeRangeMs);
  const exactIndex = trajectory.keyframes.findIndex((keyframe) => keyframe.timeMs === targetTimeMs);
  if (exactIndex >= 0) {
    return trajectory.keyframes.map((keyframe, index) =>
      index === exactIndex ? { ...keyframe, ...structuredClone(pose) } : structuredClone(keyframe),
    );
  }
  if (trajectory.keyframes.length >= 2_000) {
    fail("INVALID_COMMAND", `Trajectory ${trajectory.id} already has the maximum 2,000 keyframes`);
  }
  return [
    ...structuredClone(trajectory.keyframes),
    {
      id: makeKeyframeId(),
      actorId: trajectory.actorId,
      timeMs: targetTimeMs,
      ...structuredClone(pose),
    },
  ].sort((left, right) => left.timeMs - right.timeMs);
}

function applyPoseAtTime(
  state: ReplayCase,
  actorId: string,
  pose: ActorPose,
  poseAt: Readonly<{ branchId: string; timeMs: number }>,
  sourceCommand: ReplayMutationCommand,
  context: CommandExecutionContext,
): MutationOutcome | undefined {
  const branch = assertBranchEditable(state, poseAt.branchId);
  const trajectory = requireUnambiguousTrajectoryForActorBranch(state, actorId, branch.id);
  if (!trajectory) return undefined;
  const keyframes = keyframesWithPoseAtTime(state, trajectory, poseAt.timeMs, pose, () =>
    reserveId(state, context, "keyframe"),
  );
  return applyTrajectorySet(
    state,
    {
      type: "trajectory.set",
      actor: sourceCommand.actor,
      origin: sourceCommand.origin,
      ...(sourceCommand.requestId ? { requestId: sourceCommand.requestId } : {}),
      trajectoryId: trajectory.id,
      actorId,
      branchId: branch.id,
      keyframes,
      visible: trajectory.visible,
    },
    context,
  );
}

type ProposalChangeInput = Extract<
  ReplayMutationCommand,
  { type: "proposal.create" }
>["changes"][number];

function posesEqual(left: ActorPose, right: ActorPose): boolean {
  return left.x === right.x && left.y === right.y && left.rotationDeg === right.rotationDeg;
}

function keyframesEqual(left: ActorKeyframe[], right: ActorKeyframe[]): boolean {
  return (
    left.length === right.length &&
    left.every((keyframe, index) => {
      const candidate = right[index];
      if (!candidate) return false;
      return (
        keyframe.id === candidate.id &&
        keyframe.actorId === candidate.actorId &&
        keyframe.timeMs === candidate.timeMs &&
        keyframe.x === candidate.x &&
        keyframe.y === candidate.y &&
        keyframe.rotationDeg === candidate.rotationDeg
      );
    })
  );
}

function allocateProposalScopedId(
  state: ReplayCase,
  context: CommandExecutionContext,
  prefix: string,
  reservedIds: Set<string>,
): string {
  const knownIds = allObjectIds(state);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = context.makeId(prefix);
    if (!knownIds.has(candidate) && !reservedIds.has(candidate)) {
      reservedIds.add(candidate);
      return candidate;
    }
  }
  return fail("INVALID_STATE", `Unable to allocate a unique ${prefix} ID`);
}

function canonicalizeProposalKeyframes(
  state: ReplayCase,
  actorId: string,
  inputKeyframes: Extract<ProposalChangeInput, { kind: "trajectory-set" }>["keyframes"],
  allowedExistingIds: Set<string>,
  reservedIds: Set<string>,
  context: CommandExecutionContext,
): ActorKeyframe[] {
  const knownIds = allObjectIds(state);
  let previousTime = -Infinity;
  return inputKeyframes.map((keyframe) => {
    if (keyframe.timeMs <= previousTime) {
      fail("INVALID_COMMAND", "Proposal trajectory keyframe times must be strictly increasing");
    }
    previousTime = keyframe.timeMs;
    let keyframeId = keyframe.id;
    if (keyframeId) {
      if (
        reservedIds.has(keyframeId) ||
        (knownIds.has(keyframeId) && !allowedExistingIds.has(keyframeId))
      ) {
        fail("DUPLICATE_ID", `Proposal keyframe ID ${keyframeId} is already in use`, {
          id: keyframeId,
        });
      }
      reservedIds.add(keyframeId);
    } else {
      keyframeId = allocateProposalScopedId(state, context, "keyframe", reservedIds);
    }
    return {
      id: keyframeId,
      actorId,
      timeMs: keyframe.timeMs,
      x: keyframe.x,
      y: keyframe.y,
      rotationDeg: keyframe.rotationDeg,
    };
  });
}

function canonicalizeProposalChanges(
  state: ReplayCase,
  inputs: ProposalChangeInput[],
  poseAt: Readonly<{ branchId: string; timeMs: number }>,
  context: CommandExecutionContext,
  reservedIds: Set<string>,
): AgentProposalChange[] {
  const actorTargets = new Set<string>();
  return inputs.map((input) => {
    if (actorTargets.has(input.actorId)) {
      fail("INVALID_COMMAND", `Proposal contains more than one change for actor ${input.actorId}`, {
        actorId: input.actorId,
      });
    }
    actorTargets.add(input.actorId);
    const actor = requireActor(state, input.actorId);
    ensureUnlocked(actor, "actor");
    const changeId = allocateProposalScopedId(state, context, "proposal-change", reservedIds);
    if (input.kind === "actor-pose") {
      const reviewedBranchId = input.branchId ?? poseAt.branchId;
      const reviewedTimeMs = clampTimeToRange(
        input.targetTimeMs ?? poseAt.timeMs,
        state.timeRangeMs,
      );
      const branch = assertBranchEditable(state, reviewedBranchId);
      const trajectory = requireUnambiguousTrajectoryForActorBranch(state, actor.id, branch.id);
      if (trajectory) ensureUnlocked(trajectory, "trajectory");
      const currentPose = trajectory
        ? interpolateTrajectory(trajectory, reviewedTimeMs)
        : actor.pose;
      if (posesEqual(currentPose, input.proposedPose)) {
        fail("INVALID_COMMAND", `Proposed pose for ${actor.label} does not change its position`);
      }
      return {
        id: changeId,
        kind: "actor-pose" as const,
        actorId: actor.id,
        basePose: structuredClone(actor.pose),
        proposedPose: structuredClone(input.proposedPose),
        branchId: branch.id,
        targetTimeMs: reviewedTimeMs,
        ...(trajectory
          ? {
              baseTrajectory: {
                trajectoryId: trajectory.id,
                keyframes: structuredClone(trajectory.keyframes),
                visible: trajectory.visible,
              },
            }
          : {}),
      };
    }

    const branch = assertBranchEditable(state, input.branchId);
    const actorBranchTrajectory = requireUnambiguousTrajectoryForActorBranch(
      state,
      actor.id,
      branch.id,
    );
    const trajectory = input.trajectoryId
      ? state.trajectories.find((candidate) => candidate.id === input.trajectoryId)
      : actorBranchTrajectory;
    if (trajectory) {
      ensureUnlocked(trajectory, "trajectory");
      if (trajectory.actorId !== actor.id || trajectory.branchId !== branch.id) {
        fail(
          "INVALID_COMMAND",
          "A proposed trajectory update cannot reassign its actor or hypothesis branch",
        );
      }
    } else if (input.trajectoryId && allObjectIds(state).has(input.trajectoryId)) {
      fail("DUPLICATE_ID", `Object ID ${input.trajectoryId} already exists`, {
        id: input.trajectoryId,
      });
    }
    if (!trajectory && actorBranchTrajectory) {
      fail(
        "INVALID_COMMAND",
        `A proposed trajectory for actor ${actor.id} in branch ${branch.id} must update existing trajectory ${actorBranchTrajectory.id} instead of creating ${input.trajectoryId ?? "another trajectory"}`,
        {
          actorId: actor.id,
          branchId: branch.id,
          existingTrajectoryId: actorBranchTrajectory.id,
          requestedTrajectoryId: input.trajectoryId,
        },
      );
    }

    const trajectoryId =
      trajectory?.id ??
      (input.trajectoryId
        ? (() => {
            if (reservedIds.has(input.trajectoryId)) {
              return fail("DUPLICATE_ID", `Proposal target ID ${input.trajectoryId} is duplicated`);
            }
            reservedIds.add(input.trajectoryId);
            return input.trajectoryId;
          })()
        : allocateProposalScopedId(state, context, "trajectory", reservedIds));
    const allowedExistingKeyframeIds = new Set(
      trajectory?.keyframes.map((keyframe) => keyframe.id) ?? [],
    );
    const keyframes = canonicalizeProposalKeyframes(
      state,
      actor.id,
      input.keyframes,
      allowedExistingKeyframeIds,
      reservedIds,
      context,
    );
    const visible = input.visible ?? trajectory?.visible ?? true;
    if (trajectory?.visible === visible && keyframesEqual(trajectory.keyframes, keyframes)) {
      fail("INVALID_COMMAND", `Proposed trajectory for ${actor.label} contains no changes`);
    }
    return {
      id: changeId,
      kind: "trajectory-set" as const,
      actorId: actor.id,
      branchId: branch.id,
      trajectoryId,
      createsTrajectory: trajectory === undefined,
      baseActorPose: structuredClone(actor.pose),
      ...(trajectory
        ? {
            baseTrajectory: {
              keyframes: structuredClone(trajectory.keyframes),
              visible: trajectory.visible,
            },
          }
        : {}),
      proposedTrajectory: {
        keyframes,
        visible,
      },
    };
  });
}

function proposalAffectedIds(proposal: AgentProposal): string[] {
  const latestRevision = proposal.revisions.at(-1);
  return unique([
    proposal.id,
    ...(latestRevision?.changes.flatMap((change) =>
      change.kind === "trajectory-set"
        ? [change.actorId, change.trajectoryId, change.branchId]
        : [change.actorId],
    ) ?? []),
  ]);
}

function applyProposalCreate(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "proposal.create" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  if (command.actor !== "agent" || command.origin !== "webmcp") {
    fail("FORBIDDEN_ACTION", "Only a WebMCP agent may create an agent proposal");
  }
  requireNeutralReportText(command.title);
  requireNeutralReportText(command.rationale);
  if (command.revisionSummary) requireNeutralReportText(command.revisionSummary);
  const proposalId = reserveId(state, context, "proposal", command.proposalId);
  const reservedIds = new Set<string>([proposalId]);
  const revisionId = allocateProposalScopedId(state, context, "proposal-revision", reservedIds);
  const changes = canonicalizeProposalChanges(
    state,
    command.changes,
    command.poseAt,
    context,
    reservedIds,
  );
  const proposal: AgentProposal = {
    id: proposalId,
    title: command.title,
    rationale: command.rationale,
    status: "pending",
    createdBy: "agent",
    origin: "webmcp",
    createdAt: context.now,
    updatedAt: context.now,
    revisions: [
      {
        id: revisionId,
        revisionNumber: 1,
        summary: command.revisionSummary ?? "Initial agent proposal.",
        createdBy: "agent",
        origin: "webmcp",
        authorshipTrusted: true,
        createdAt: context.now,
        changes,
      },
    ],
  };
  state.proposals.push(proposal);
  return {
    nextState: state,
    affectedIds: proposalAffectedIds(proposal),
    summary: `Agent proposed ${changes.length} reversible scene change${changes.length === 1 ? "" : "s"} for human review.`,
    undoable: true,
  };
}

function applyProposalAdjust(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "proposal.adjust" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  requireHumanUi(
    command,
    "FORBIDDEN_ACTION",
    "Only a human using the interface may manually adjust an agent proposal",
  );
  requireNeutralReportText(command.summary);
  const proposal = requirePendingProposal(state, command.proposalId);
  const previousRevision = proposal.revisions.at(-1);
  if (!previousRevision) {
    fail("VERSION_CONFLICT", `Cannot adjust ${proposal.title}; it has no proposal revision`);
  }
  const boundChanges = command.changes.map((input) => {
    if (input.kind !== "actor-pose") return input;
    const previousChange = previousRevision.changes.find(
      (change): change is Extract<AgentProposalChange, { kind: "actor-pose" }> =>
        change.kind === "actor-pose" && change.actorId === input.actorId,
    );
    const reviewedBranchId = previousChange?.branchId;
    const reviewedTimeMs = previousChange?.targetTimeMs;
    if (!reviewedBranchId || reviewedTimeMs === undefined) {
      return input;
    }
    if (
      (input.branchId !== undefined && input.branchId !== reviewedBranchId) ||
      (input.targetTimeMs !== undefined && input.targetTimeMs !== reviewedTimeMs)
    ) {
      fail(
        "INVALID_COMMAND",
        `Cannot move the reviewed branch or playhead binding while adjusting ${proposal.title}`,
        {
          proposalId: proposal.id,
          actorId: input.actorId,
          reviewedBranchId,
          reviewedTimeMs,
        },
      );
    }
    return {
      ...input,
      branchId: reviewedBranchId,
      targetTimeMs: reviewedTimeMs,
    };
  });
  const reservedIds = new Set<string>([proposal.id]);
  const revisionId = allocateProposalScopedId(state, context, "proposal-revision", reservedIds);
  const changes = canonicalizeProposalChanges(
    state,
    boundChanges,
    command.poseAt,
    context,
    reservedIds,
  );
  const revision: AgentProposalRevision = {
    id: revisionId,
    revisionNumber: proposal.revisions.length + 1,
    summary: command.summary,
    createdBy: "human",
    origin: "ui",
    authorshipTrusted: true,
    createdAt: context.now,
    changes,
  };
  proposal.revisions.push(revision);
  proposal.updatedAt = context.now;
  return {
    nextState: state,
    affectedIds: proposalAffectedIds(proposal),
    summary: `Human manually adjusted agent proposal: ${proposal.title}.`,
    undoable: true,
  };
}

function assertProposalRevisionIsCurrent(
  state: ReplayCase,
  proposal: AgentProposal,
  revision: AgentProposalRevision,
  poseAt: Readonly<{ branchId: string; timeMs: number }>,
): void {
  for (const change of revision.changes) {
    const actor = requireActor(state, change.actorId);
    ensureUnlocked(actor, "actor");
    const expectedActorPose = change.kind === "actor-pose" ? change.basePose : change.baseActorPose;
    if (!posesEqual(actor.pose, expectedActorPose)) {
      fail(
        "VERSION_CONFLICT",
        `Cannot accept ${proposal.title}; ${actor.label} changed after this proposal revision`,
        { proposalId: proposal.id, changeId: change.id, actorId: actor.id },
      );
    }
    if (change.kind === "actor-pose") {
      if (!change.branchId || change.targetTimeMs === undefined) {
        fail(
          "VERSION_CONFLICT",
          `Cannot accept ${proposal.title}; this older pose revision has no reviewed branch and playhead binding`,
          { proposalId: proposal.id, changeId: change.id, actorId: actor.id },
        );
      }
      const acceptanceTimeMs = clampTimeToRange(poseAt.timeMs, state.timeRangeMs);
      if (change.branchId !== poseAt.branchId || change.targetTimeMs !== acceptanceTimeMs) {
        fail(
          "INVALID_COMMAND",
          `Cannot accept ${proposal.title} at a different branch or playhead than the reviewed pose`,
          {
            proposalId: proposal.id,
            changeId: change.id,
            reviewedBranchId: change.branchId,
            activeBranchId: poseAt.branchId,
            reviewedTimeMs: change.targetTimeMs,
            activeTimeMs: acceptanceTimeMs,
          },
        );
      }
      const branch = assertBranchEditable(state, change.branchId);
      const matchingTrajectories = trajectoriesForActorBranch(state, actor.id, branch.id);
      if (matchingTrajectories.length > 1) {
        fail(
          "VERSION_CONFLICT",
          `Cannot accept ${proposal.title}; ${actor.label} now has multiple trajectories in branch ${branch.id}`,
          {
            proposalId: proposal.id,
            changeId: change.id,
            trajectoryIds: matchingTrajectories.map((trajectory) => trajectory.id),
          },
        );
      }
      const trajectory = matchingTrajectories[0];
      if (!change.baseTrajectory) {
        if (trajectory) {
          fail(
            "VERSION_CONFLICT",
            `Cannot accept ${proposal.title}; ${actor.label} gained a trajectory after review began`,
            { proposalId: proposal.id, changeId: change.id, trajectoryId: trajectory.id },
          );
        }
        continue;
      }
      if (trajectory?.id !== change.baseTrajectory.trajectoryId) {
        fail(
          "VERSION_CONFLICT",
          `Cannot accept ${proposal.title}; its reviewed trajectory baseline is no longer available`,
          {
            proposalId: proposal.id,
            changeId: change.id,
            trajectoryId: change.baseTrajectory.trajectoryId,
          },
        );
      }
      ensureUnlocked(trajectory, "trajectory");
      if (
        trajectory.visible !== change.baseTrajectory.visible ||
        !keyframesEqual(trajectory.keyframes, change.baseTrajectory.keyframes)
      ) {
        fail(
          "VERSION_CONFLICT",
          `Cannot accept ${proposal.title}; trajectory ${trajectory.id} changed after review began`,
          { proposalId: proposal.id, changeId: change.id, trajectoryId: trajectory.id },
        );
      }
      continue;
    }
    const branch = assertBranchEditable(state, change.branchId);
    const matchingTrajectories = trajectoriesForActorBranch(state, actor.id, branch.id);
    if (matchingTrajectories.length > 1) {
      fail(
        "VERSION_CONFLICT",
        `Cannot accept ${proposal.title}; ${actor.label} now has multiple trajectories in branch ${branch.id}`,
        {
          proposalId: proposal.id,
          changeId: change.id,
          trajectoryIds: matchingTrajectories.map((candidate) => candidate.id),
        },
      );
    }
    const actorBranchTrajectory = matchingTrajectories[0];
    const trajectory = state.trajectories.find((candidate) => candidate.id === change.trajectoryId);
    if (change.createsTrajectory) {
      const conflictingTrajectory = actorBranchTrajectory ?? trajectory;
      if (conflictingTrajectory) {
        fail(
          "VERSION_CONFLICT",
          `Cannot accept ${proposal.title}; ${actor.label} gained trajectory ${conflictingTrajectory.id} in branch ${branch.id} after review began`,
          {
            proposalId: proposal.id,
            changeId: change.id,
            trajectoryId: conflictingTrajectory.id,
          },
        );
      }
      continue;
    }
    if (
      !trajectory ||
      !change.baseTrajectory ||
      actorBranchTrajectory?.id !== change.trajectoryId
    ) {
      fail(
        "VERSION_CONFLICT",
        `Cannot accept ${proposal.title}; its trajectory baseline is no longer available`,
        { proposalId: proposal.id, changeId: change.id, trajectoryId: change.trajectoryId },
      );
    }
    ensureUnlocked(trajectory, "trajectory");
    if (
      trajectory.actorId !== change.actorId ||
      trajectory.branchId !== change.branchId ||
      trajectory.visible !== change.baseTrajectory.visible ||
      !keyframesEqual(trajectory.keyframes, change.baseTrajectory.keyframes)
    ) {
      fail(
        "VERSION_CONFLICT",
        `Cannot accept ${proposal.title}; trajectory ${trajectory.id} changed after review began`,
        { proposalId: proposal.id, changeId: change.id, trajectoryId: trajectory.id },
      );
    }
  }
}

function applyProposalAccept(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "proposal.accept" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  requireHumanUi(
    command,
    "FORBIDDEN_ACTION",
    "Only a human using the interface may accept an agent proposal",
  );
  if (command.note) requireNeutralReportText(command.note);
  const proposal = requirePendingProposal(state, command.proposalId);
  const revision = proposal.revisions.at(-1);
  if (!revision) fail("INVALID_STATE", `Agent proposal ${proposal.id} has no revision`);

  // Validate every baseline and lock before applying any target mutation.
  assertProposalRevisionIsCurrent(state, proposal, revision, command.poseAt);
  const appliedAffectedIds: string[] = [];
  for (const change of revision.changes) {
    if (change.kind === "actor-pose") {
      if (!change.branchId || change.targetTimeMs === undefined) {
        fail(
          "INVALID_STATE",
          `Accepted pose revision ${change.id} is missing its reviewed branch and playhead binding`,
        );
      }
      const outcome = applyActorPose(
        state,
        {
          type: "actor.update-pose",
          actor: "human",
          origin: "ui",
          ...(command.requestId ? { requestId: command.requestId } : {}),
          actorId: change.actorId,
          pose: structuredClone(change.proposedPose),
          poseAt: { branchId: change.branchId, timeMs: change.targetTimeMs },
        },
        context,
      );
      appliedAffectedIds.push(...outcome.affectedIds);
      continue;
    }
    const outcome = applyTrajectorySet(
      state,
      {
        type: "trajectory.set",
        actor: "human",
        origin: "ui",
        ...(command.requestId ? { requestId: command.requestId } : {}),
        trajectoryId: change.trajectoryId,
        actorId: change.actorId,
        branchId: change.branchId,
        keyframes: structuredClone(change.proposedTrajectory.keyframes),
        visible: change.proposedTrajectory.visible,
      },
      context,
    );
    appliedAffectedIds.push(...outcome.affectedIds);
  }
  proposal.status = "accepted";
  proposal.updatedAt = context.now;
  proposal.decision = {
    outcome: "accepted",
    revisionId: revision.id,
    decidedBy: "human",
    origin: "ui",
    decidedAt: context.now,
    ...(command.note ? { note: command.note } : {}),
    humanAttestationTrusted: true,
  };
  return {
    nextState: state,
    affectedIds: unique([...proposalAffectedIds(proposal), ...appliedAffectedIds]),
    summary: `Human accepted agent proposal: ${proposal.title}.`,
    undoable: true,
  };
}

function applyProposalReject(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "proposal.reject" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  requireHumanUi(
    command,
    "FORBIDDEN_ACTION",
    "Only a human using the interface may reject an agent proposal",
  );
  if (command.note) requireNeutralReportText(command.note);
  const proposal = requirePendingProposal(state, command.proposalId);
  const revision = proposal.revisions.at(-1);
  if (!revision) fail("INVALID_STATE", `Agent proposal ${proposal.id} has no revision`);
  proposal.status = "rejected";
  proposal.updatedAt = context.now;
  proposal.decision = {
    outcome: "rejected",
    revisionId: revision.id,
    decidedBy: "human",
    origin: "ui",
    decidedAt: context.now,
    ...(command.note ? { note: command.note } : {}),
    humanAttestationTrusted: true,
  };
  return {
    nextState: state,
    affectedIds: proposalAffectedIds(proposal),
    summary: `Human rejected agent proposal: ${proposal.title}.`,
    undoable: true,
  };
}

function applyTimelineUpsert(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "timeline.upsert" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  const branch = assertBranchEditable(state, command.branchId);
  requireNeutralReportText(command.title);
  assertNotConfirmedByAgent(command, command.certainty);
  const missingActorIds = command.linkedActorIds.filter(
    (actorId) => !state.actors.some((actor) => actor.id === actorId),
  );
  if (missingActorIds.length > 0)
    fail("NOT_FOUND", `Missing actor references: ${missingActorIds.join(", ")}`);
  assertReferences(state, command.linkedClaimIds ?? [], "claim");
  assertReferences(state, command.linkedEvidenceIds ?? [], "evidence");
  if (
    command.eventType === "impact" &&
    command.actor === "agent" &&
    !["reported", "uncertain", "agent-hypothesis"].includes(command.certainty)
  ) {
    fail(
      "HUMAN_CONFIRMATION_REQUIRED",
      "Agent-created impact markers must remain reported, uncertain, or hypothetical",
    );
  }
  let event = command.eventId
    ? state.timelineEvents.find((candidate) => candidate.id === command.eventId)
    : undefined;
  const eventId = event?.id ?? reserveId(state, context, "event", command.eventId);
  const previousLinkedClaimIds = event
    ? unique([
        ...event.linkedClaimIds,
        ...state.claims
          .filter((claim) => claim.linkedEventIds.includes(eventId))
          .map((claim) => claim.id),
      ])
    : [];
  const previousLinkedEvidenceIds = event
    ? unique([
        ...event.linkedEvidenceIds,
        ...state.evidence
          .filter((asset) => asset.linkedEventIds.includes(eventId))
          .map((asset) => asset.id),
      ])
    : [];
  const linkedClaimIds = unique(command.linkedClaimIds ?? previousLinkedClaimIds);
  const linkedEvidenceIds = unique(command.linkedEvidenceIds ?? previousLinkedEvidenceIds);
  if (event) {
    ensureUnlocked(event, "timeline-event");
    if (event.certainty === "confirmed" && command.actor !== "human") {
      fail(
        "HUMAN_CONFIRMATION_REQUIRED",
        "An agent cannot change a human-confirmed timeline event",
      );
    }
    if (event.branchId !== branch.id)
      fail("INVALID_COMMAND", "An event cannot be moved between branches");
    event.timeMs = command.timeMs;
    event.type = command.eventType;
    event.title = command.title;
    event.certainty = command.certainty;
    event.linkedActorIds = unique(command.linkedActorIds);
    event.linkedClaimIds = linkedClaimIds;
    event.linkedEvidenceIds = linkedEvidenceIds;
    if (command.location) event.location = structuredClone(command.location);
    else delete event.location;
    event.changeHistory.push(changeRecord(context, command, "Updated timeline event."));
  } else {
    event = {
      id: eventId,
      branchId: branch.id,
      timeMs: command.timeMs,
      type: command.eventType,
      title: command.title,
      certainty: command.certainty,
      linkedActorIds: unique(command.linkedActorIds),
      linkedClaimIds,
      linkedEvidenceIds,
      ...(command.location ? { location: structuredClone(command.location) } : {}),
      locked: false,
      createdBy: command.actor,
      changeHistory: [changeRecord(context, command, "Created timeline event.")],
    };
    state.timelineEvents.push(event);
  }
  ensureBranchOwnedIndex(state, branch.id, "eventIds", event.id);
  for (const claim of state.claims) {
    const nextLinkedEventIds = event.linkedClaimIds.includes(claim.id)
      ? unique([...claim.linkedEventIds, event.id])
      : claim.linkedEventIds.filter((id) => id !== event.id);
    if (!sameIdSet(claim.linkedEventIds, nextLinkedEventIds)) {
      ensureUnlocked(claim, "claim");
      invalidatePriorClaimConfirmation(claim, context, command);
      claim.linkedEventIds = nextLinkedEventIds;
    }
  }
  for (const asset of state.evidence) {
    if (event.linkedEvidenceIds.includes(asset.id)) {
      asset.linkedEventIds = unique([...asset.linkedEventIds, event.id]);
      asset.linkedBranchIds = unique([...asset.linkedBranchIds, branch.id]);
    } else {
      asset.linkedEventIds = asset.linkedEventIds.filter((id) => id !== event.id);
    }
  }
  appendBranchChange(branch, context, command, `Updated timeline event ${event.title}.`);
  return {
    nextState: state,
    affectedIds: unique([
      event.id,
      branch.id,
      ...previousLinkedClaimIds,
      ...previousLinkedEvidenceIds,
      ...event.linkedClaimIds,
      ...event.linkedEvidenceIds,
    ]),
    summary: `Updated timeline event: ${event.title}.`,
    undoable: true,
  };
}

function applyDamageMark(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "damage.mark" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  const actor = requireActor(state, command.actorId);
  ensureUnlocked(actor, "actor");
  assertNotConfirmedByAgent(command, command.status);
  if (command.status === "confirmed") requireNeutralReportText(command.description);
  assertReferences(state, command.linkedClaimIds ?? [], "claim");
  assertReferences(state, command.linkedEvidenceIds ?? [], "evidence");
  let marker = command.markerId
    ? actor.damageMarkers.find((candidate) => candidate.id === command.markerId)
    : undefined;
  const markerId = marker?.id ?? reserveId(state, context, "damage", command.markerId);
  const previousLinkedClaimIds = marker ? [...marker.linkedClaimIds] : [];
  const previousLinkedEvidenceIds = marker ? [...marker.linkedEvidenceIds] : [];
  const linkedClaimIds = unique(command.linkedClaimIds ?? []);
  const linkedEvidenceIds = unique(command.linkedEvidenceIds ?? []);
  linkedClaimIds.forEach((claimId) => requireClaim(state, claimId));
  linkedEvidenceIds.forEach((evidenceId) => requireEvidence(state, evidenceId));
  const changedClaims = state.claims.filter(
    (claim) => linkedClaimIds.includes(claim.id) !== claim.linkedSceneObjectIds.includes(markerId),
  );
  changedClaims.forEach((claim) => {
    ensureUnlocked(claim, "claim");
    if (claim.status === "confirmed" && command.actor !== "human") {
      fail(
        "HUMAN_CONFIRMATION_REQUIRED",
        "An agent cannot change damage links on a human-confirmed claim",
      );
    }
  });
  const changedEvidence = state.evidence.filter(
    (asset) =>
      linkedEvidenceIds.includes(asset.id) !== asset.linkedSceneObjectIds.includes(markerId),
  );
  if (marker) {
    if (marker.status === "confirmed" && command.actor !== "human") {
      fail(
        "HUMAN_CONFIRMATION_REQUIRED",
        "An agent cannot change a human-confirmed damage observation",
      );
    }
    marker.region = command.region;
    marker.description = command.description;
    marker.status = command.status;
  } else {
    marker = {
      id: markerId,
      actorId: actor.id,
      region: command.region,
      description: command.description,
      status: command.status,
      linkedClaimIds: [],
      linkedEvidenceIds: [],
      createdBy: command.actor,
    };
    actor.damageMarkers.push(marker);
  }
  for (const claim of changedClaims) {
    invalidatePriorClaimConfirmation(claim, context, command);
    setDamageClaimRelation(marker, claim, linkedClaimIds.includes(claim.id));
  }
  for (const asset of changedEvidence) {
    setDamageEvidenceRelation(marker, asset, linkedEvidenceIds.includes(asset.id));
  }
  marker.linkedClaimIds = linkedClaimIds;
  marker.linkedEvidenceIds = linkedEvidenceIds;
  return {
    nextState: state,
    affectedIds: unique([
      actor.id,
      marker.id,
      ...previousLinkedClaimIds,
      ...previousLinkedEvidenceIds,
      ...linkedClaimIds,
      ...linkedEvidenceIds,
    ]),
    summary: `Marked ${command.region} damage on ${actor.label}.`,
    undoable: true,
  };
}

function applyClaimAdd(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "claim.add" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  assertNotConfirmedByAgent(command, command.status);
  if (command.status === "confirmed") requireNeutralReportText(command.statement);
  if (!command.branchId && command.sharedAcrossBranches === false) {
    fail("INVALID_COMMAND", "A non-shared claim requires an owning branchId");
  }
  assertReferences(state, command.linkedEvidenceIds ?? [], "evidence");
  assertReferences(state, command.linkedEventIds ?? [], "event");
  assertReferences(state, command.linkedSceneObjectIds ?? [], "scene");
  assertReferences(state, command.sourceIds ?? [], "source");
  const submittedSourceIds = unique(command.sourceIds ?? []);
  const sourceIds = resolveObservationSourceIds(
    state,
    command,
    command.sourceType,
    submittedSourceIds,
  );
  const branch = command.branchId ? assertBranchEditable(state, command.branchId) : undefined;
  if (branch && command.sharedAcrossBranches)
    fail("INVALID_COMMAND", "A branch-specific claim cannot be shared across all branches");
  const claimId = reserveId(state, context, "claim", command.claimId);
  const humanConfirmed = command.status === "confirmed";
  const created: Claim = {
    id: claimId,
    statement: command.statement,
    ...(command.subjectId ? { subjectId: command.subjectId } : {}),
    status: command.status,
    sourceType: command.sourceType,
    sourceIds,
    linkedEvidenceIds: unique(command.linkedEvidenceIds ?? []),
    linkedEventIds: unique(command.linkedEventIds ?? []),
    linkedSceneObjectIds: unique(command.linkedSceneObjectIds ?? []),
    ...(branch ? { branchId: branch.id } : {}),
    sharedAcrossBranches: branch ? false : (command.sharedAcrossBranches ?? true),
    createdBy: command.actor,
    humanConfirmed,
    ...(humanConfirmed ? { confirmedAt: context.now } : {}),
    locked: false,
    createdAt: context.now,
    updatedAt: context.now,
    changeHistory: [
      changeRecord(
        context,
        command,
        humanConfirmed ? "Human created and confirmed the claim." : "Created claim.",
      ),
    ],
  };
  const damageLinkChanges = damageClaimLinkChanges(
    state,
    [],
    created.linkedSceneObjectIds,
    command,
  );
  const linkedEvents = created.linkedEventIds.map((eventId) => requireEvent(state, eventId));
  linkedEvents.forEach((event) => ensureUnlocked(event, "timeline-event"));
  state.claims.push(created);
  if (branch) {
    branch.claimIds = unique([...branch.claimIds, created.id]);
    appendBranchChange(branch, context, command, "Added a branch-specific claim.");
  } else {
    state.branches.forEach((candidate) => {
      candidate.sharedClaimIds = unique([...candidate.sharedClaimIds, created.id]);
    });
  }
  for (const evidenceId of created.linkedEvidenceIds) {
    const asset = requireEvidence(state, evidenceId);
    asset.linkedClaimIds = unique([...asset.linkedClaimIds, created.id]);
  }
  for (const event of linkedEvents) {
    event.linkedClaimIds = unique([...event.linkedClaimIds, created.id]);
  }
  for (const change of damageLinkChanges) {
    setDamageClaimRelation(change.marker, created, change.linked);
  }
  return {
    nextState: state,
    affectedIds: unique([
      created.id,
      ...created.sourceIds,
      ...created.linkedEvidenceIds,
      ...created.linkedEventIds,
      ...created.linkedSceneObjectIds,
      ...damageLinkChanges.map(({ actor }) => actor.id),
      ...(branch ? [branch.id] : []),
    ]),
    summary: "Added an observation.",
    undoable: true,
  };
}

function applyClaimUpdate(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "claim.update" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  const claim = requireClaim(state, command.claimId);
  ensureUnlocked(claim, "claim");
  if (claim.status === "confirmed" && command.actor !== "human") {
    fail("HUMAN_CONFIRMATION_REQUIRED", "An agent cannot change a human-confirmed claim");
  }
  assertReferences(state, command.linkedEvidenceIds ?? [], "evidence");
  assertReferences(state, command.linkedEventIds ?? [], "event");
  assertReferences(state, command.linkedSceneObjectIds ?? [], "scene");
  assertReferences(state, command.sourceIds ?? [], "source");
  const nextSourceType = command.sourceType ?? claim.sourceType;
  const nextSourceIds =
    command.sourceType !== undefined || command.sourceIds !== undefined
      ? resolveObservationSourceIds(
          state,
          command,
          nextSourceType,
          command.sourceIds ?? claim.sourceIds,
        )
      : claim.sourceIds;
  const previousLinkedEventIds = [...claim.linkedEventIds];
  const previousLinkedSceneObjectIds = [...claim.linkedSceneObjectIds];
  const nextLinkedEventIds = unique(command.linkedEventIds ?? claim.linkedEventIds);
  const nextLinkedSceneObjectIds = unique(
    command.linkedSceneObjectIds ?? claim.linkedSceneObjectIds,
  );
  const damageLinkChanges = damageClaimLinkChanges(
    state,
    previousLinkedSceneObjectIds,
    nextLinkedSceneObjectIds,
    command,
  );
  const changedBacklinkEvents = state.timelineEvents.filter(
    (event) => nextLinkedEventIds.includes(event.id) !== event.linkedClaimIds.includes(claim.id),
  );
  changedBacklinkEvents.forEach((event) => ensureUnlocked(event, "timeline-event"));
  if (claimContentOrProvenanceChanged(claim, command)) {
    invalidatePriorClaimConfirmation(claim, context, command);
  }
  if (command.statement !== undefined) claim.statement = command.statement;
  if (command.status !== undefined) {
    claim.status = command.status;
    claim.humanConfirmed = false;
    delete claim.confirmedAt;
  }
  if (command.sourceType !== undefined) claim.sourceType = command.sourceType;
  if (command.sourceType !== undefined || command.sourceIds !== undefined)
    claim.sourceIds = nextSourceIds;
  if (command.linkedEvidenceIds !== undefined)
    claim.linkedEvidenceIds = unique(command.linkedEvidenceIds);
  if (command.linkedEventIds !== undefined) claim.linkedEventIds = nextLinkedEventIds;
  if (command.linkedSceneObjectIds !== undefined)
    claim.linkedSceneObjectIds = nextLinkedSceneObjectIds;
  if (claim.status === "confirmed" && containsLiabilityConclusion(claim.statement)) {
    fail(
      "FORBIDDEN_ACTION",
      "A fault or liability conclusion cannot be stored as a confirmed fact",
    );
  }
  claim.updatedAt = context.now;
  claim.changeHistory.push(changeRecord(context, command, "Updated claim."));
  for (const asset of state.evidence) {
    asset.linkedClaimIds = asset.linkedClaimIds.filter((id) => id !== claim.id);
  }
  for (const evidenceId of claim.linkedEvidenceIds) {
    requireEvidence(state, evidenceId).linkedClaimIds.push(claim.id);
  }
  for (const event of changedBacklinkEvents) {
    event.linkedClaimIds = claim.linkedEventIds.includes(event.id)
      ? unique([...event.linkedClaimIds, claim.id])
      : event.linkedClaimIds.filter((claimId) => claimId !== claim.id);
  }
  for (const change of damageLinkChanges) {
    setDamageClaimRelation(change.marker, claim, change.linked);
  }
  return {
    nextState: state,
    affectedIds: unique([
      claim.id,
      ...previousLinkedEventIds,
      ...claim.linkedEventIds,
      ...previousLinkedSceneObjectIds,
      ...claim.linkedSceneObjectIds,
      ...damageLinkChanges.map(({ actor }) => actor.id),
      ...changedBacklinkEvents.map((event) => event.id),
    ]),
    summary: "Updated an observation.",
    undoable: true,
  };
}

function applyClaimConfirm(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "claim.confirm" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  requireHumanUi(
    command,
    "HUMAN_CONFIRMATION_REQUIRED",
    "Only a human can confirm a claim through the interface",
  );
  const claim = requireClaim(state, command.claimId);
  ensureUnlocked(claim, "claim");
  if (claim.branchId || claim.status === "agent-hypothesis") {
    fail(
      "HUMAN_CONFIRMATION_REQUIRED",
      "A branch-specific hypothesis cannot be converted directly into a confirmed fact",
    );
  }
  if (
    (claim.sourceType === "photo" || claim.sourceType === "document") &&
    compatibleAgentObservationSourceIds(state, claim.sourceType, claim.sourceIds).length === 0
  ) {
    fail(
      "HUMAN_CONFIRMATION_REQUIRED",
      `Attach ${agentObservationSourceRequirement(claim.sourceType)} before confirming this observation.`,
    );
  }
  requireNeutralReportText(claim.statement);
  claim.status = "confirmed";
  claim.humanConfirmed = true;
  claim.confirmedAt = context.now;
  claim.updatedAt = context.now;
  claim.changeHistory.push(changeRecord(context, command, "Human confirmed this claim."));
  return {
    nextState: state,
    affectedIds: [claim.id],
    summary: `Human confirmed: ${claim.statement}`,
    undoable: true,
  };
}

function applyLockSet(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "lock.set" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  requireHumanUi(
    command,
    "FORBIDDEN_ACTION",
    "Only a human can lock or unlock workspace items through the interface",
  );
  let target: { id: string; locked: boolean; lock?: ItemLock | undefined };
  if (command.targetType === "actor") target = requireActor(state, command.targetId);
  else if (command.targetType === "trajectory") target = requireTrajectory(state, command.targetId);
  else if (command.targetType === "timeline-event") target = requireEvent(state, command.targetId);
  else target = requireClaim(state, command.targetId);
  target.locked = command.locked;
  if (command.locked) {
    target.lock = {
      lockedBy: "human",
      lockedAt: context.now,
      ...(command.reason ? { reason: command.reason } : {}),
    };
  } else {
    delete target.lock;
  }
  return {
    nextState: state,
    affectedIds: [target.id],
    summary: `Human ${command.locked ? "locked" : "unlocked"} ${command.targetType} ${target.id}.`,
    undoable: true,
  };
}

function applyEvidenceAdd(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "evidence.add" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  if (state.evidence.some((asset) => asset.checksum === command.checksum)) {
    fail("DUPLICATE_EVIDENCE", "Evidence with the same checksum is already present", {
      checksum: command.checksum,
    });
  }
  const evidenceId = reserveId(state, context, "evidence", command.evidenceId);
  const asset: EvidenceAsset = {
    id: evidenceId,
    name: command.name,
    mimeType: command.mimeType,
    sizeBytes: command.sizeBytes,
    localBlobKey: command.localBlobKey,
    checksum: command.checksum,
    syntheticDemoAsset: command.syntheticDemoAsset ?? false,
    source: command.source,
    ...(command.capturedAt ? { capturedAt: command.capturedAt } : {}),
    createdAt: context.now,
    ...(command.notes !== undefined ? { notes: command.notes } : {}),
    tags: unique(command.tags ?? []),
    annotations: structuredClone(command.annotations ?? []),
    annotationLinks: [],
    linkedClaimIds: [],
    linkedEventIds: [],
    linkedSceneObjectIds: [],
    linkedBranchIds: [],
    deleted: false,
  };
  state.evidence.push(asset);
  return {
    nextState: state,
    affectedIds: [asset.id],
    summary: `Added evidence: ${asset.name}.`,
    undoable: false,
    // Local evidence bytes are persisted outside ordinary command history.
    // Removal must go through evidence.delete so metadata and bytes share the
    // durable purge transaction instead of leaving an invisible orphan.
    historyBarrier: true,
  };
}

function applyEvidenceUpdate(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "evidence.update" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  const asset = requireEvidence(state, command.evidenceId);
  if (asset.deleted) fail("NOT_FOUND", `Evidence ${command.evidenceId} has been deleted`);
  if (command.capturedAt !== undefined) {
    if (command.capturedAt === null) delete asset.capturedAt;
    else asset.capturedAt = command.capturedAt;
  }
  if (command.notes !== undefined) {
    if (command.notes === null || command.notes.trim() === "") delete asset.notes;
    else asset.notes = command.notes;
  }
  if (command.tags !== undefined) asset.tags = unique(command.tags);
  const affectedClaimIds: string[] = [];
  if (command.annotations !== undefined) {
    const previousAnnotations = new Map(
      asset.annotations.map((annotation) => [annotation.id, annotation] as const),
    );
    const nextAnnotations = new Map(
      command.annotations.map((annotation) => [annotation.id, annotation] as const),
    );
    const changedAnnotationIds = new Set(
      asset.annotations.flatMap((annotation) => {
        const next = nextAnnotations.get(annotation.id);
        return !next || JSON.stringify(annotation) !== JSON.stringify(next) ? [annotation.id] : [];
      }),
    );
    for (const annotation of command.annotations) {
      if (!previousAnnotations.has(annotation.id)) changedAnnotationIds.add(annotation.id);
    }
    for (const link of asset.annotationLinks) {
      if (link.targetType !== "claim" || !changedAnnotationIds.has(link.annotationId)) continue;
      const claim = requireClaim(state, link.targetId);
      affectedClaimIds.push(claim.id);
      invalidatePriorClaimConfirmation(claim, context, command);
    }
    asset.annotations = structuredClone(command.annotations);
    const retainedAnnotationIds = new Set(asset.annotations.map((annotation) => annotation.id));
    asset.annotationLinks = asset.annotationLinks.filter((link) =>
      retainedAnnotationIds.has(link.annotationId),
    );
  }
  return {
    nextState: state,
    affectedIds: unique([
      asset.id,
      ...asset.annotations.map((annotation) => annotation.id),
      ...affectedClaimIds,
    ]),
    summary: `Updated evidence details: ${asset.name}.`,
    undoable: true,
  };
}

function applyEvidenceLink(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "evidence.link" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  const asset = requireEvidence(state, command.evidenceId);
  const annotation = command.annotationId
    ? asset.annotations.find((candidate) => candidate.id === command.annotationId)
    : undefined;
  if (command.annotationId && !annotation) {
    fail(
      "NOT_FOUND",
      `Annotation ${command.annotationId} does not exist on evidence ${command.evidenceId}`,
    );
  }
  const affectedIds = [asset.id, ...(annotation ? [annotation.id] : []), command.targetId];
  if (command.targetType === "claim") {
    const claim = requireClaim(state, command.targetId);
    ensureUnlocked(claim, "claim");
    const addsEvidence = !claim.linkedEvidenceIds.includes(asset.id);
    const addsAnnotationLink = Boolean(
      annotation &&
      !asset.annotationLinks.some(
        (candidate) =>
          candidate.annotationId === annotation.id &&
          candidate.targetType === "claim" &&
          candidate.targetId === claim.id,
      ),
    );
    if (addsEvidence || addsAnnotationLink) {
      invalidatePriorClaimConfirmation(claim, context, command);
    }
    claim.linkedEvidenceIds = unique([...claim.linkedEvidenceIds, asset.id]);
    asset.linkedClaimIds = unique([...asset.linkedClaimIds, claim.id]);
  } else if (command.targetType === "timeline-event") {
    const event = requireEvent(state, command.targetId);
    ensureUnlocked(event, "timeline-event");
    event.linkedEvidenceIds = unique([...event.linkedEvidenceIds, asset.id]);
    asset.linkedEventIds = unique([...asset.linkedEventIds, event.id]);
    asset.linkedBranchIds = unique([...asset.linkedBranchIds, event.branchId]);
  } else if (command.targetType === "actor") {
    const actor = requireActor(state, command.targetId);
    ensureUnlocked(actor, "actor");
    asset.linkedSceneObjectIds = unique([...asset.linkedSceneObjectIds, actor.id]);
  } else if (command.targetType === "trajectory") {
    const trajectory = requireTrajectory(state, command.targetId);
    ensureUnlocked(trajectory, "trajectory");
    asset.linkedSceneObjectIds = unique([...asset.linkedSceneObjectIds, trajectory.id]);
    asset.linkedBranchIds = unique([...asset.linkedBranchIds, trajectory.branchId]);
  } else if (command.targetType === "damage") {
    const owner = requireDamageMarkerOwner(state, command.targetId);
    assertDamageMarkerLinkEditable(owner, command);
    setDamageEvidenceRelation(owner.marker, asset, true);
    affectedIds.push(owner.actor.id);
  } else if (command.targetType === "hypothesis") {
    const branch = assertBranchEditable(state, command.targetId);
    asset.linkedBranchIds = unique([...asset.linkedBranchIds, branch.id]);
  } else {
    const owner = state.branches.find((branch) =>
      branch.assumptions.some((assumption) => assumption.id === command.targetId),
    );
    if (!owner) fail("NOT_FOUND", `Assumption ${command.targetId} does not exist`);
    const branch = assertBranchEditable(state, owner.id);
    const assumption = branch.assumptions.find((candidate) => candidate.id === command.targetId);
    if (!assumption) fail("NOT_FOUND", `Assumption ${command.targetId} does not exist`);
    assumption.supportingEvidenceIds = unique([...assumption.supportingEvidenceIds, asset.id]);
    assumption.updatedAt = context.now;
    asset.linkedBranchIds = unique([...asset.linkedBranchIds, branch.id]);
    affectedIds.push(branch.id);
    appendBranchChange(
      branch,
      context,
      command,
      `Linked supporting evidence to assumption ${assumption.id}.`,
    );
  }
  if (annotation) {
    const link = {
      annotationId: annotation.id,
      targetType: command.targetType,
      targetId: command.targetId,
    };
    if (
      !asset.annotationLinks.some(
        (candidate) =>
          candidate.annotationId === link.annotationId &&
          candidate.targetType === link.targetType &&
          candidate.targetId === link.targetId,
      )
    ) {
      asset.annotationLinks.push(link);
    }
  }
  return {
    nextState: state,
    affectedIds,
    summary:
      command.targetType === "assumption"
        ? annotation
          ? `Linked annotation ${annotation.id} as supporting evidence for assumption ${command.targetId}.`
          : `Linked evidence ${asset.name} as support for assumption ${command.targetId}.`
        : annotation
          ? `Linked annotation ${annotation.id} from evidence ${asset.name}.`
          : `Linked evidence ${asset.name}.`,
    undoable: true,
  };
}

function branchStillUsesEvidence(
  state: ReplayCase,
  asset: EvidenceAsset,
  branchId: string,
): boolean {
  if (
    asset.linkedEventIds.some(
      (eventId) =>
        state.timelineEvents.find((event) => event.id === eventId)?.branchId === branchId,
    )
  )
    return true;
  if (
    asset.linkedSceneObjectIds.some(
      (sceneId) =>
        state.trajectories.find((trajectory) => trajectory.id === sceneId)?.branchId === branchId,
    )
  )
    return true;
  const branch = state.branches.find((candidate) => candidate.id === branchId);
  return Boolean(
    branch?.assumptions.some(
      (assumption) =>
        assumption.supportingEvidenceIds.includes(asset.id) ||
        assumption.conflictingEvidenceIds.includes(asset.id),
    ),
  );
}

function applyEvidenceUnlink(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "evidence.unlink" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  requireHumanUi(
    command,
    "FORBIDDEN_ACTION",
    "Only a human can remove an evidence relationship through the interface",
  );
  const asset = requireEvidence(state, command.evidenceId);
  const annotation = command.annotationId
    ? asset.annotations.find((candidate) => candidate.id === command.annotationId)
    : undefined;
  if (command.annotationId && !annotation) {
    fail(
      "NOT_FOUND",
      `Annotation ${command.annotationId} does not exist on evidence ${command.evidenceId}`,
    );
  }
  const matchingAnnotationLinks = asset.annotationLinks.filter(
    (candidate) =>
      candidate.targetType === command.targetType &&
      candidate.targetId === command.targetId &&
      (!command.annotationId || candidate.annotationId === command.annotationId),
  );
  let removed = matchingAnnotationLinks.length > 0;
  const removeBaseRelation = command.annotationId === undefined;
  const affectedIds = [asset.id, ...(annotation ? [annotation.id] : []), command.targetId];

  if (command.targetType === "claim") {
    const claim = requireClaim(state, command.targetId);
    ensureUnlocked(claim, "claim");
    const removesBase =
      removeBaseRelation &&
      (claim.linkedEvidenceIds.includes(asset.id) ||
        claim.sourceIds.includes(asset.id) ||
        asset.linkedClaimIds.includes(claim.id));
    if (removesBase || removed) invalidatePriorClaimConfirmation(claim, context, command);
    if (removeBaseRelation) {
      claim.linkedEvidenceIds = claim.linkedEvidenceIds.filter((id) => id !== asset.id);
      claim.sourceIds = claim.sourceIds.filter((id) => id !== asset.id);
      asset.linkedClaimIds = asset.linkedClaimIds.filter((id) => id !== claim.id);
    }
    removed ||= removesBase;
  } else if (command.targetType === "timeline-event") {
    const event = requireEvent(state, command.targetId);
    ensureUnlocked(event, "timeline-event");
    const removesBase =
      removeBaseRelation &&
      (event.linkedEvidenceIds.includes(asset.id) || asset.linkedEventIds.includes(event.id));
    if (removeBaseRelation) {
      event.linkedEvidenceIds = event.linkedEvidenceIds.filter((id) => id !== asset.id);
      asset.linkedEventIds = asset.linkedEventIds.filter((id) => id !== event.id);
      if (!branchStillUsesEvidence(state, asset, event.branchId)) {
        asset.linkedBranchIds = asset.linkedBranchIds.filter((id) => id !== event.branchId);
      }
    }
    removed ||= removesBase;
  } else if (command.targetType === "actor") {
    const actor = requireActor(state, command.targetId);
    ensureUnlocked(actor, "actor");
    const removesBase = removeBaseRelation && asset.linkedSceneObjectIds.includes(actor.id);
    if (removeBaseRelation) {
      asset.linkedSceneObjectIds = asset.linkedSceneObjectIds.filter((id) => id !== actor.id);
    }
    removed ||= removesBase;
  } else if (command.targetType === "trajectory") {
    const trajectory = requireTrajectory(state, command.targetId);
    ensureUnlocked(trajectory, "trajectory");
    const removesBase = removeBaseRelation && asset.linkedSceneObjectIds.includes(trajectory.id);
    if (removeBaseRelation) {
      asset.linkedSceneObjectIds = asset.linkedSceneObjectIds.filter((id) => id !== trajectory.id);
      if (!branchStillUsesEvidence(state, asset, trajectory.branchId)) {
        asset.linkedBranchIds = asset.linkedBranchIds.filter((id) => id !== trajectory.branchId);
      }
    }
    removed ||= removesBase;
  } else if (command.targetType === "damage") {
    const owner = requireDamageMarkerOwner(state, command.targetId);
    assertDamageMarkerLinkEditable(owner, command);
    const removesBase =
      removeBaseRelation &&
      (owner.marker.linkedEvidenceIds.includes(asset.id) ||
        asset.linkedSceneObjectIds.includes(owner.marker.id));
    if (removeBaseRelation) setDamageEvidenceRelation(owner.marker, asset, false);
    affectedIds.push(owner.actor.id);
    removed ||= removesBase;
  } else if (command.targetType === "hypothesis") {
    const branch = assertBranchEditable(state, command.targetId);
    const removesBase = removeBaseRelation && asset.linkedBranchIds.includes(branch.id);
    if (removeBaseRelation) {
      asset.linkedBranchIds = asset.linkedBranchIds.filter((id) => id !== branch.id);
    }
    removed ||= removesBase;
  } else {
    const owner = state.branches.find((branch) =>
      branch.assumptions.some((assumption) => assumption.id === command.targetId),
    );
    if (!owner) fail("NOT_FOUND", `Assumption ${command.targetId} does not exist`);
    const branch = assertBranchEditable(state, owner.id);
    const assumption = branch.assumptions.find((candidate) => candidate.id === command.targetId);
    if (!assumption) fail("NOT_FOUND", `Assumption ${command.targetId} does not exist`);
    const removesBase = removeBaseRelation && assumption.supportingEvidenceIds.includes(asset.id);
    if (removeBaseRelation) {
      assumption.supportingEvidenceIds = assumption.supportingEvidenceIds.filter(
        (id) => id !== asset.id,
      );
      assumption.updatedAt = context.now;
      if (!branchStillUsesEvidence(state, asset, branch.id)) {
        asset.linkedBranchIds = asset.linkedBranchIds.filter((id) => id !== branch.id);
      }
      if (removesBase) {
        affectedIds.push(branch.id);
        appendBranchChange(
          branch,
          context,
          command,
          `Removed supporting evidence from assumption ${assumption.id}.`,
        );
      }
    }
    removed ||= removesBase;
  }

  if (!removed) {
    fail(
      "NOT_FOUND",
      `Evidence ${asset.id} is not linked to ${command.targetType} ${command.targetId}${command.annotationId ? ` through annotation ${command.annotationId}` : ""}`,
    );
  }
  asset.annotationLinks = asset.annotationLinks.filter(
    (candidate) => !matchingAnnotationLinks.includes(candidate),
  );
  return {
    nextState: state,
    affectedIds: unique(affectedIds),
    summary: annotation
      ? `Removed annotation ${annotation.id} link from evidence ${asset.name}.`
      : `Removed evidence link from ${asset.name}.`,
    undoable: true,
  };
}

function applyEvidenceDelete(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "evidence.delete" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  requireHumanUi(
    command,
    "FORBIDDEN_ACTION",
    "Evidence deletion requires an explicit human confirmation",
  );
  const asset = requireEvidence(state, command.evidenceId);
  const removedSourceIds = new Set([
    asset.id,
    ...asset.annotations.map((annotation) => annotation.id),
  ]);
  const claimsWithRemovedEvidence = state.claims.filter(
    (claim) =>
      claim.linkedEvidenceIds.includes(asset.id) ||
      claim.sourceIds.some((sourceId) => removedSourceIds.has(sourceId)),
  );
  const affectedIds = unique([
    asset.id,
    ...asset.annotations.map((annotation) => annotation.id),
    ...asset.linkedClaimIds,
    ...claimsWithRemovedEvidence.map((claim) => claim.id),
    ...asset.linkedEventIds,
    ...asset.linkedSceneObjectIds,
    ...asset.linkedBranchIds,
    ...asset.annotationLinks.map((link) => link.targetId),
  ]);
  state.claims.forEach((claim) => {
    const removesSource = claim.sourceIds.some((sourceId) => removedSourceIds.has(sourceId));
    const removesEvidenceLink = claim.linkedEvidenceIds.includes(asset.id);
    if (removesSource || removesEvidenceLink) {
      invalidatePriorClaimConfirmation(claim, context, command);
    }
    claim.sourceIds = claim.sourceIds.filter((id) => !removedSourceIds.has(id));
    claim.linkedEvidenceIds = claim.linkedEvidenceIds.filter((id) => id !== asset.id);
  });
  state.timelineEvents.forEach((event) => {
    event.linkedEvidenceIds = event.linkedEvidenceIds.filter((id) => id !== asset.id);
  });
  state.actors.forEach((actor) => {
    actor.damageMarkers.forEach((marker) => {
      if (marker.linkedEvidenceIds.includes(asset.id)) {
        setDamageEvidenceRelation(marker, asset, false);
      }
    });
  });
  state.branches.forEach((branch) => {
    branch.assumptions.forEach((assumption) => {
      assumption.supportingEvidenceIds = assumption.supportingEvidenceIds.filter(
        (id) => id !== asset.id,
      );
      assumption.conflictingEvidenceIds = assumption.conflictingEvidenceIds.filter(
        (id) => id !== asset.id,
      );
    });
  });
  state.reportNotes.forEach((note) => {
    note.evidenceIds = note.evidenceIds.filter((id) => id !== asset.id);
    if (note.claimIds.length === 0 && note.evidenceIds.length === 0) note.reviewedByHuman = false;
  });
  state.activity.forEach((activity) => {
    if (activity.affectedIds.includes(asset.id)) {
      activity.summary = "Historical evidence activity (details removed after human deletion).";
    }
  });
  asset.name = "Deleted evidence";
  asset.mimeType = "image/png";
  asset.sizeBytes = 1;
  asset.localBlobKey = `deleted:${asset.id}`;
  asset.checksum = `deleted-${asset.id}`;
  asset.syntheticDemoAsset = false;
  asset.source = "import";
  delete asset.capturedAt;
  delete asset.notes;
  asset.tags = [];
  asset.annotations = [];
  asset.annotationLinks = [];
  asset.linkedClaimIds = [];
  asset.linkedEventIds = [];
  asset.linkedSceneObjectIds = [];
  asset.linkedBranchIds = [];
  asset.deleted = true;
  asset.deletedAt = context.now;
  return {
    nextState: state,
    affectedIds,
    summary: "Human deleted evidence and scrubbed its active metadata.",
    undoable: false,
    historyBarrier: true,
  };
}

function applyQuestionAdd(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "question.add" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  assertReferences(state, command.relatedClaimIds ?? [], "claim");
  const knownRelatedObjectIds = new Set([
    ...state.actors.map((actor) => actor.id),
    ...state.trajectories.map((trajectory) => trajectory.id),
    ...state.timelineEvents.map((event) => event.id),
    ...state.actors.flatMap((actor) => actor.damageMarkers.map((marker) => marker.id)),
  ]);
  const missingRelatedObjectIds = (command.relatedSceneObjectIds ?? []).filter(
    (id) => !knownRelatedObjectIds.has(id),
  );
  if (missingRelatedObjectIds.length > 0) {
    fail("NOT_FOUND", `Missing related workspace objects: ${missingRelatedObjectIds.join(", ")}`);
  }
  assertReferences(state, command.relatedBranchIds ?? [], "branch");
  const questionId = reserveId(state, context, "question", command.questionId);
  const question: OpenQuestion = {
    id: questionId,
    question: command.question,
    reason: command.reason,
    importance: command.importance,
    rankingReasons: unique(command.rankingReasons ?? []),
    relatedClaimIds: unique(command.relatedClaimIds ?? []),
    relatedSceneObjectIds: unique(command.relatedSceneObjectIds ?? []),
    relatedBranchIds: unique(command.relatedBranchIds ?? []),
    status: "open",
    createdBy: command.actor,
    createdAt: context.now,
    updatedAt: context.now,
  };
  state.questions = rankOpenQuestions([...state.questions, question]);
  return {
    nextState: state,
    affectedIds: unique([
      question.id,
      ...question.relatedClaimIds,
      ...question.relatedSceneObjectIds,
      ...question.relatedBranchIds,
    ]),
    summary: `Added open question: ${question.question}`,
    undoable: true,
  };
}

function applyQuestionUpdate(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "question.update" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  const question = requireQuestion(state, command.questionId);
  if (command.status === "answered") {
    requireHumanUi(
      command,
      "FORBIDDEN_ACTION",
      "Question answers must be supplied explicitly by a human",
    );
    if (!command.answer || !command.answerSource)
      fail("INVALID_COMMAND", "Answered questions require an answer and source");
    question.answer = command.answer;
    question.answerSource = command.answerSource;
  } else {
    delete question.answer;
    delete question.answerSource;
  }
  question.status = command.status;
  question.updatedAt = context.now;
  const affectedIds = [question.id];
  if (command.convertAnswerToObservation) {
    if (question.status !== "answered" || !question.answer || !question.answerSource) {
      fail("INVALID_COMMAND", "Only an answered question can become an observation");
    }
    const claimId = reserveId(state, context, "claim", command.observationClaimId);
    const observation: Claim = {
      id: claimId,
      statement: question.answer,
      status: "reported",
      sourceType: question.answerSource,
      sourceIds: [question.id],
      linkedEvidenceIds: [],
      linkedEventIds: [],
      linkedSceneObjectIds: unique(question.relatedSceneObjectIds),
      sharedAcrossBranches: true,
      createdBy: "human",
      humanConfirmed: false,
      locked: false,
      createdAt: context.now,
      updatedAt: context.now,
      changeHistory: [
        changeRecord(context, command, "Converted a human answer into a reported observation."),
      ],
    };
    const damageLinkChanges = damageClaimLinkChanges(
      state,
      [],
      observation.linkedSceneObjectIds,
      command,
    );
    state.claims.push(observation);
    state.branches.forEach((branch) => {
      branch.sharedClaimIds = unique([...branch.sharedClaimIds, observation.id]);
    });
    for (const change of damageLinkChanges) {
      setDamageClaimRelation(change.marker, observation, change.linked);
      affectedIds.push(change.actor.id, change.marker.id);
    }
    question.relatedClaimIds = unique([...question.relatedClaimIds, observation.id]);
    affectedIds.push(observation.id);
  }
  state.questions = rankOpenQuestions(state.questions);
  return {
    nextState: state,
    affectedIds,
    summary: `Updated question: ${question.question}`,
    undoable: true,
  };
}

function cloneBranchContents(
  state: ReplayCase,
  parent: ReplayCase["branches"][number],
  branchId: string,
  command: Extract<ReplayMutationCommand, { type: "hypothesis.fork" }>,
  context: CommandExecutionContext,
): {
  trajectories: Trajectory[];
  events: TimelineEvent[];
  claims: Claim[];
  assumptions: HypothesisAssumption[];
} {
  const trajectories = parent.trajectoryIds.map((trajectoryId) => {
    const source = requireTrajectory(state, trajectoryId);
    const clonedId = context.makeId("trajectory");
    return {
      ...structuredClone(source),
      id: clonedId,
      branchId,
      keyframes: source.keyframes.map((keyframe) => ({
        ...structuredClone(keyframe),
        id: context.makeId("keyframe"),
      })),
      createdBy: command.actor,
      changeHistory: [changeRecord(context, command, `Forked from trajectory ${source.id}.`)],
    };
  });
  const claimIdMap = new Map(
    parent.claimIds.map((claimId) => [claimId, context.makeId("claim")] as const),
  );
  const eventIdMap = new Map<string, string>();
  const events = parent.eventIds.map((eventId) => {
    const source = requireEvent(state, eventId);
    const clonedId = context.makeId("event");
    eventIdMap.set(source.id, clonedId);
    return {
      ...structuredClone(source),
      id: clonedId,
      branchId,
      linkedClaimIds: source.linkedClaimIds.map((id) => claimIdMap.get(id) ?? id),
      createdBy: command.actor,
      changeHistory: [changeRecord(context, command, `Forked from event ${source.id}.`)],
    };
  });
  const claims: Claim[] = parent.claimIds.map((claimId) => {
    const source = requireClaim(state, claimId);
    const clonedId = claimIdMap.get(source.id);
    if (!clonedId) fail("INVALID_STATE", `Could not allocate a clone for claim ${source.id}`);
    const cloned: Claim = {
      ...structuredClone(source),
      id: clonedId,
      branchId,
      status: source.status === "confirmed" ? ("agent-hypothesis" as const) : source.status,
      humanConfirmed: false,
      linkedEventIds: source.linkedEventIds.map((id) => eventIdMap.get(id) ?? id),
      createdBy: command.actor,
      createdAt: context.now,
      updatedAt: context.now,
      changeHistory: [changeRecord(context, command, `Forked from claim ${source.id}.`)],
    };
    delete cloned.confirmedAt;
    return cloned;
  });
  const assumptions = parent.assumptions.map((source) => ({
    ...structuredClone(source),
    id: context.makeId("assumption"),
    createdBy: command.actor,
    createdAt: context.now,
    updatedAt: context.now,
  }));
  return { trajectories, events, claims, assumptions };
}

function applyHypothesisFork(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "hypothesis.fork" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  requireNeutralHypothesis(`${command.name} ${command.description}`);
  const parent = assertBranchEditable(state, command.parentBranchId);
  const branchId = reserveId(state, context, "branch", command.branchId);
  const cloned = cloneBranchContents(state, parent, branchId, command, context);
  const clonedClaimIds = new Set(cloned.claims.map((claim) => claim.id));
  const clonedEventIds = new Set(cloned.events.map((event) => event.id));
  for (const event of cloned.events) {
    for (const claimId of event.linkedClaimIds) {
      if (!clonedClaimIds.has(claimId)) ensureUnlocked(requireClaim(state, claimId), "claim");
    }
  }
  for (const claim of cloned.claims) {
    for (const eventId of claim.linkedEventIds) {
      if (!clonedEventIds.has(eventId))
        ensureUnlocked(requireEvent(state, eventId), "timeline-event");
    }
  }
  const clonedDamageClaimChanges = cloned.claims.map((claim) => ({
    claim,
    changes: damageClaimLinkChanges(state, [], claim.linkedSceneObjectIds, command),
  }));
  for (const assumption of command.assumptions ?? []) {
    assertReferences(state, assumption.supportingEvidenceIds ?? [], "evidence");
    assertReferences(state, assumption.conflictingEvidenceIds ?? [], "evidence");
    cloned.assumptions.push({
      id: context.makeId("assumption"),
      statement: assumption.statement,
      status: "active",
      supportingEvidenceIds: unique(assumption.supportingEvidenceIds ?? []),
      conflictingEvidenceIds: unique(assumption.conflictingEvidenceIds ?? []),
      createdBy: command.actor,
      createdAt: context.now,
      updatedAt: context.now,
    });
  }
  const branch: ReplayCase["branches"][number] = {
    id: branchId,
    name: command.name,
    description: command.description,
    parentBranchId: parent.id,
    sharedClaimIds: [...parent.sharedClaimIds],
    assumptions: cloned.assumptions,
    trajectoryIds: cloned.trajectories.map((trajectory) => trajectory.id),
    eventIds: cloned.events.map((event) => event.id),
    claimIds: cloned.claims.map((claim) => claim.id),
    status: "active",
    createdBy: command.actor,
    createdAt: context.now,
    updatedAt: context.now,
    changeHistory: [changeRecord(context, command, `Forked from ${parent.name}.`)],
  };
  state.trajectories.push(...cloned.trajectories);
  state.timelineEvents.push(...cloned.events);
  state.claims.push(...cloned.claims);
  state.branches.push(branch);
  state.activeBranchId = branch.id;

  for (const { claim, changes } of clonedDamageClaimChanges) {
    for (const change of changes) {
      setDamageClaimRelation(change.marker, claim, change.linked);
    }
  }

  for (const event of cloned.events) {
    for (const claimId of event.linkedClaimIds) {
      const claim = requireClaim(state, claimId);
      claim.linkedEventIds = unique([...claim.linkedEventIds, event.id]);
    }
  }
  for (const claim of cloned.claims) {
    for (const eventId of claim.linkedEventIds) {
      const event = requireEvent(state, eventId);
      event.linkedClaimIds = unique([...event.linkedClaimIds, claim.id]);
    }
  }

  const relevantEvidence = new Set([
    ...cloned.events.flatMap((event) => event.linkedEvidenceIds),
    ...cloned.claims.flatMap((claim) => claim.linkedEvidenceIds),
    ...cloned.assumptions.flatMap((assumption) => [
      ...assumption.supportingEvidenceIds,
      ...assumption.conflictingEvidenceIds,
    ]),
  ]);
  for (const asset of state.evidence) {
    if (asset.linkedBranchIds.includes(parent.id) || relevantEvidence.has(asset.id)) {
      asset.linkedBranchIds = unique([...asset.linkedBranchIds, branch.id]);
    }
    for (const claim of cloned.claims.filter((item) => item.linkedEvidenceIds.includes(asset.id))) {
      asset.linkedClaimIds = unique([...asset.linkedClaimIds, claim.id]);
    }
    for (const event of cloned.events.filter((item) => item.linkedEvidenceIds.includes(asset.id))) {
      asset.linkedEventIds = unique([...asset.linkedEventIds, event.id]);
    }
  }
  return {
    nextState: state,
    affectedIds: unique([
      branch.id,
      ...branch.trajectoryIds,
      ...branch.eventIds,
      ...branch.claimIds,
      ...branch.assumptions.map((assumption) => assumption.id),
      ...cloned.events.flatMap((event) => event.linkedClaimIds),
      ...cloned.claims.flatMap((claim) => claim.linkedEventIds),
      ...clonedDamageClaimChanges.flatMap(({ changes }) =>
        changes.flatMap(({ actor, marker }) => [actor.id, marker.id]),
      ),
    ]),
    summary: `Created hypothesis: ${branch.name}.`,
    undoable: true,
  };
}

function applyHypothesisRename(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "hypothesis.rename" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  requireNeutralHypothesis(`${command.name} ${command.description ?? ""}`);
  const branch = assertBranchEditable(state, command.branchId);
  branch.name = command.name;
  if (command.description !== undefined) branch.description = command.description;
  appendBranchChange(branch, context, command, "Renamed hypothesis branch.");
  return {
    nextState: state,
    affectedIds: [branch.id],
    summary: `Renamed hypothesis to ${branch.name}.`,
    undoable: true,
  };
}

function applyHypothesisAddAssumption(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "hypothesis.add-assumption" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  requireNeutralHypothesis(command.statement);
  const branch = assertBranchEditable(state, command.branchId);
  assertReferences(state, command.supportingEvidenceIds ?? [], "evidence");
  assertReferences(state, command.conflictingEvidenceIds ?? [], "evidence");
  const assumptionId = reserveId(state, context, "assumption", command.assumptionId);
  const assumption: HypothesisAssumption = {
    id: assumptionId,
    statement: command.statement,
    status: "active",
    supportingEvidenceIds: unique(command.supportingEvidenceIds ?? []),
    conflictingEvidenceIds: unique(command.conflictingEvidenceIds ?? []),
    createdBy: command.actor,
    createdAt: context.now,
    updatedAt: context.now,
  };
  branch.assumptions.push(assumption);
  appendBranchChange(branch, context, command, "Added branch-specific assumption.");
  for (const evidenceId of unique([
    ...assumption.supportingEvidenceIds,
    ...assumption.conflictingEvidenceIds,
  ])) {
    const asset = requireEvidence(state, evidenceId);
    asset.linkedBranchIds = unique([...asset.linkedBranchIds, branch.id]);
  }
  return {
    nextState: state,
    affectedIds: [branch.id, assumption.id],
    summary: `Added an assumption to ${branch.name}.`,
    undoable: true,
  };
}

function applyHypothesisUpdateAssumption(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "hypothesis.update-assumption" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  const branch = assertBranchEditable(state, command.branchId);
  const assumption = branch.assumptions.find((candidate) => candidate.id === command.assumptionId);
  if (!assumption) fail("NOT_FOUND", `Assumption ${command.assumptionId} does not exist`);
  if (command.statement !== undefined) {
    requireNeutralHypothesis(command.statement);
    assumption.statement = command.statement;
  }
  if (command.status !== undefined) assumption.status = command.status;
  if (command.supportingEvidenceIds !== undefined) {
    assertReferences(state, command.supportingEvidenceIds, "evidence");
    assumption.supportingEvidenceIds = unique(command.supportingEvidenceIds);
  }
  if (command.conflictingEvidenceIds !== undefined) {
    assertReferences(state, command.conflictingEvidenceIds, "evidence");
    assumption.conflictingEvidenceIds = unique(command.conflictingEvidenceIds);
  }
  const linkedEvidenceIds = unique([
    ...assumption.supportingEvidenceIds,
    ...assumption.conflictingEvidenceIds,
  ]);
  for (const evidenceId of linkedEvidenceIds) {
    const asset = requireEvidence(state, evidenceId);
    asset.linkedBranchIds = unique([...asset.linkedBranchIds, branch.id]);
  }
  assumption.updatedAt = context.now;
  appendBranchChange(branch, context, command, "Updated branch-specific assumption.");
  return {
    nextState: state,
    affectedIds: [branch.id, assumption.id, ...linkedEvidenceIds],
    summary: `Updated an assumption in ${branch.name}.`,
    undoable: true,
  };
}

function applyHypothesisArchive(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "hypothesis.archive" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  const branch = assertBranchEditable(state, command.branchId);
  const alternatives = state.branches.filter(
    (candidate) => candidate.status === "active" && candidate.id !== branch.id,
  );
  if (alternatives.length === 0)
    fail("INVALID_STATE", "At least one active reconstruction branch must remain");
  const fallbackBranch = alternatives[0];
  if (!fallbackBranch)
    fail("INVALID_STATE", "At least one active reconstruction branch must remain");
  branch.status = "archived";
  appendBranchChange(branch, context, command, "Archived branch without deleting its history.");
  if (state.activeBranchId === branch.id) state.activeBranchId = fallbackBranch.id;
  return {
    nextState: state,
    affectedIds: [branch.id, state.activeBranchId],
    summary: `Archived hypothesis: ${branch.name}.`,
    undoable: true,
  };
}

function applyHypothesisRestore(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "hypothesis.restore" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  const branch = requireBranch(state, command.branchId);
  if (branch.status !== "archived")
    fail("INVALID_STATE", `Hypothesis ${branch.id} is not archived`);
  branch.status = "active";
  appendBranchChange(branch, context, command, "Restored archived branch.");
  return {
    nextState: state,
    affectedIds: [branch.id],
    summary: `Restored hypothesis: ${branch.name}.`,
    undoable: true,
  };
}

function applyHypothesisSetActive(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "hypothesis.set-active" }>,
): MutationOutcome {
  const branch = assertBranchEditable(state, command.branchId);
  state.activeBranchId = branch.id;
  return {
    nextState: state,
    affectedIds: [branch.id],
    summary: `Switched to hypothesis: ${branch.name}.`,
    undoable: true,
  };
}

function applyReportAddNote(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "report.add-note" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  requireNeutralReportText(command.text);
  if (command.claimIds.length === 0 && command.evidenceIds.length === 0) {
    fail("INVALID_COMMAND", "A report note must cite at least one claim or evidence item");
  }
  assertReferences(state, command.claimIds, "claim");
  assertReferences(state, command.evidenceIds, "evidence");
  const noteId = reserveId(state, context, "report-note", command.noteId);
  state.reportNotes.push({
    id: noteId,
    text: command.text,
    claimIds: unique(command.claimIds),
    evidenceIds: unique(command.evidenceIds),
    createdBy: command.actor,
    reviewedByHuman: command.actor === "human" && command.origin === "ui",
    createdAt: context.now,
  });
  return {
    nextState: state,
    affectedIds: [noteId, ...command.claimIds, ...command.evidenceIds],
    summary: `${command.actor === "agent" ? "Agent proposed" : "Human added"} an evidence-bound report note.`,
    undoable: true,
  };
}

function applyReportReviewNote(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "report.review-note" }>,
): MutationOutcome {
  requireHumanUi(
    command,
    "FORBIDDEN_ACTION",
    "Only a human can review an agent-authored report note",
  );
  const index = state.reportNotes.findIndex((note) => note.id === command.noteId);
  if (index < 0) fail("NOT_FOUND", `Report note ${command.noteId} does not exist`);
  const note = state.reportNotes[index];
  if (!note) fail("INVALID_STATE", `Report note index ${String(index)} is invalid`);
  if (command.approved) note.reviewedByHuman = true;
  else state.reportNotes.splice(index, 1);
  return {
    nextState: state,
    affectedIds: [note.id],
    summary: `Human ${command.approved ? "approved" : "rejected"} a proposed report note.`,
    undoable: true,
  };
}

function applyCompletenessAttest(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "completeness.attest" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  requireHumanUi(
    command,
    "HUMAN_CONFIRMATION_REQUIRED",
    "Completeness records require an explicit human interface action",
  );
  const subject = command.attestation;
  let summary: string;
  const affectedIds = [state.id];
  if (subject.kind === "no-evidence-supplied") {
    if (state.evidence.some((asset) => !asset.deleted)) {
      fail(
        "INVALID_COMMAND",
        "Available evidence is already indexed; a no-evidence record would be contradictory",
      );
    }
    summary = "Human recorded that no evidence was supplied for this local case.";
  } else if (subject.kind === "actor-damage") {
    const actor = requireActor(state, subject.actorId);
    if (actor.damageMarkers.length > 0) {
      fail(
        "INVALID_COMMAND",
        `${actor.label} already has recorded damage; an unknown or not-assessed record would be contradictory`,
      );
    }
    affectedIds.push(actor.id);
    summary =
      subject.outcome === "unknown"
        ? `Human recorded that ${actor.label}’s damage location is unknown.`
        : `Human recorded that damage was not assessed for ${actor.label}.`;
  } else {
    if (
      state.questions.some(
        (question) => question.status === "open" || question.status === "deferred",
      )
    ) {
      fail(
        "INVALID_COMMAND",
        "Open or deferred questions are already the explicit uncertainty record for this case",
      );
    }
    summary = "Human completed the uncertainty review and recorded that none remain open.";
  }

  const existing = state.completenessAttestations.find(
    (attestation) =>
      completenessAttestationKey(attestation) === completenessAttestationKey(subject),
  );
  if (
    existing &&
    isCompletenessAttestationCurrent(state, existing) &&
    (subject.kind !== "actor-damage" ||
      (existing.kind === "actor-damage" && existing.outcome === subject.outcome))
  ) {
    fail("INVALID_COMMAND", "This completeness record is already current.");
  }

  const attestationId = reserveId(state, context, "completeness-attestation");
  state.completenessAttestations = state.completenessAttestations.filter(
    (attestation) =>
      completenessAttestationKey(attestation) !== completenessAttestationKey(subject),
  );
  const base = {
    id: attestationId,
    attestedBy: "human" as const,
    origin: "ui" as const,
    attestedAt: context.now,
    basisFingerprint: completenessBasisFingerprint(state, subject),
    humanAttestationTrusted: true,
  };
  state.completenessAttestations.push(
    subject.kind === "actor-damage" ? { ...base, ...subject } : { ...base, kind: subject.kind },
  );
  return {
    nextState: state,
    affectedIds: unique([...affectedIds, attestationId, ...(existing ? [existing.id] : [])]),
    summary,
    undoable: true,
  };
}

function applyCompletenessWithdraw(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "completeness.withdraw" }>,
): MutationOutcome {
  requireHumanUi(
    command,
    "HUMAN_CONFIRMATION_REQUIRED",
    "Only a human using the interface may withdraw a completeness record",
  );
  const index = state.completenessAttestations.findIndex(
    (attestation) => attestation.id === command.attestationId,
  );
  if (index < 0) {
    fail("NOT_FOUND", `Completeness attestation ${command.attestationId} does not exist`);
  }
  const attestation = state.completenessAttestations[index];
  if (!attestation) fail("INVALID_STATE", "Completeness attestation index is invalid");
  state.completenessAttestations.splice(index, 1);
  return {
    nextState: state,
    affectedIds: unique([
      attestation.id,
      state.id,
      ...(attestation.kind === "actor-damage" ? [attestation.actorId] : []),
    ]),
    summary: "Human withdrew a completeness record for fresh review.",
    undoable: true,
  };
}

function applyReportFinalize(
  state: ReplayCase,
  command: Extract<ReplayMutationCommand, { type: "report.finalize" }>,
  context: CommandExecutionContext,
): MutationOutcome {
  if (command.actor === "agent" || command.origin === "webmcp") {
    fail(
      "AGENT_FINALIZATION_FORBIDDEN",
      "An agent may build a preview but may never finalize a report",
    );
  }
  requireHumanUi(
    command,
    "HUMAN_FINALIZATION_REQUIRED",
    "Finalization requires the visible human review form",
  );
  const reviewed = command.reviewedPreview;
  if (reviewed.caseId !== state.id || reviewed.caseVersion !== state.caseVersion) {
    fail(
      "REPORT_PREVIEW_STALE",
      "The reviewed report preview is stale. Build and review a fresh preview before finalizing.",
      {
        reviewedCaseId: reviewed.caseId,
        reviewedCaseVersion: reviewed.caseVersion,
        currentCaseId: state.id,
        currentCaseVersion: state.caseVersion,
      },
    );
  }
  const preview = buildReportPreview(state, {
    generatedAt: reviewed.generatedAt,
    branchIds: reviewed.branchIds,
    includeHypotheses: reviewed.includeHypotheses,
  });
  const binding = preview.reviewBinding;
  if (!binding) {
    fail(
      "REPORT_PREVIEW_STALE",
      "The current report preview could not be bound for review. Build it again before finalizing.",
    );
  }
  if (
    binding.fingerprint !== reviewed.fingerprint ||
    binding.includeHypotheses !== reviewed.includeHypotheses ||
    binding.branchIds.length !== reviewed.branchIds.length ||
    binding.branchIds.some((branchId, index) => branchId !== reviewed.branchIds[index])
  ) {
    fail(
      "REPORT_PREVIEW_STALE",
      "The visible report preview no longer matches current case content or branch scope. Build and review a fresh preview before finalizing.",
      {
        reviewedFingerprint: reviewed.fingerprint,
        currentFingerprint: binding.fingerprint,
        reviewedBranchIds: reviewed.branchIds,
        currentBranchIds: binding.branchIds,
      },
    );
  }
  const blockingIssues = state.consistencyIssues.filter((item) => item.severity === "error");
  if (blockingIssues.length > 0) {
    fail(
      "REPORT_REQUIREMENTS_MISSING",
      "Resolve or explicitly correct consistency errors before finalization",
      {
        issueIds: blockingIssues.map((item) => item.id),
      },
    );
  }
  if (preview.missingRequirements.length > 0) {
    fail("REPORT_REQUIREMENTS_MISSING", "The report preview is missing required information", {
      missingRequirements: preview.missingRequirements,
    });
  }
  const reportErrors = validateCurrentReportPreview(state, preview).filter(
    (issue) => issue.severity === "error",
  );
  if (reportErrors.length > 0) {
    fail("REPORT_REQUIREMENTS_MISSING", "The report contains unsupported or invalid citations", {
      issueIds: reportErrors.map((issue) => issue.id),
    });
  }
  const snapshotId = reserveId(state, context, "report-snapshot");
  const humanReviewSection = preview.sections.find((section) => section.id === "human-review");
  const humanReviewStatement = humanReviewSection?.statements.find(
    (statement) => statement.id === "report-human-review",
  );
  if (humanReviewStatement) {
    humanReviewStatement.text =
      "A human reviewed the unresolved questions, acknowledged the method and limitations, reviewed the confirmed facts and every included unconfirmed or hypothesis statement, and manually finalized this snapshot.";
  }
  const finalizedPreviewContent = structuredClone(preview);
  delete finalizedPreviewContent.reviewBinding;
  preview.reviewBinding = createReportPreviewReviewBinding(finalizedPreviewContent, binding);
  state.reportSnapshots.push({
    id: snapshotId,
    caseVersion: context.nextVersion,
    createdAt: context.now,
    confirmedClaimIds: preview.includedClaimIds.filter((claimId) => {
      const claim = state.claims.find((candidate) => candidate.id === claimId);
      return claim?.status === "confirmed" && claim.humanConfirmed;
    }),
    includedEvidenceIds: preview.includedEvidenceIds,
    unresolvedQuestionIds: preview.unresolvedQuestionIds,
    branchIds: binding.branchIds,
    humanAcknowledged: true,
    immutable: true,
    preview,
  });
  return {
    nextState: state,
    affectedIds: [snapshotId],
    summary: "Human finalized an immutable factual report snapshot.",
    undoable: false,
    historyBarrier: true,
  };
}

export function applyReplayMutation(
  replayCase: ReplayCase,
  command: ReplayMutationCommand,
  context: CommandExecutionContext,
): MutationOutcome {
  const state = structuredClone(replayCase);
  switch (command.type) {
    case "case.update":
      return applyCaseUpdate(state, command);
    case "actor.upsert":
      return applyActorUpsert(state, command, context);
    case "actor.update-pose":
      return applyActorPose(state, command, context);
    case "trajectory.set":
      return applyTrajectorySet(state, command, context);
    case "proposal.create":
      return applyProposalCreate(state, command, context);
    case "proposal.adjust":
      return applyProposalAdjust(state, command, context);
    case "proposal.accept":
      return applyProposalAccept(state, command, context);
    case "proposal.reject":
      return applyProposalReject(state, command, context);
    case "timeline.upsert":
      return applyTimelineUpsert(state, command, context);
    case "damage.mark":
      return applyDamageMark(state, command, context);
    case "claim.add":
      return applyClaimAdd(state, command, context);
    case "claim.update":
      return applyClaimUpdate(state, command, context);
    case "claim.confirm":
      return applyClaimConfirm(state, command, context);
    case "lock.set":
      return applyLockSet(state, command, context);
    case "evidence.add":
      return applyEvidenceAdd(state, command, context);
    case "evidence.update":
      return applyEvidenceUpdate(state, command, context);
    case "evidence.link":
      return applyEvidenceLink(state, command, context);
    case "evidence.unlink":
      return applyEvidenceUnlink(state, command, context);
    case "evidence.delete":
      return applyEvidenceDelete(state, command, context);
    case "question.add":
      return applyQuestionAdd(state, command, context);
    case "question.update":
      return applyQuestionUpdate(state, command, context);
    case "hypothesis.fork":
      return applyHypothesisFork(state, command, context);
    case "hypothesis.rename":
      return applyHypothesisRename(state, command, context);
    case "hypothesis.add-assumption":
      return applyHypothesisAddAssumption(state, command, context);
    case "hypothesis.update-assumption":
      return applyHypothesisUpdateAssumption(state, command, context);
    case "hypothesis.archive":
      return applyHypothesisArchive(state, command, context);
    case "hypothesis.restore":
      return applyHypothesisRestore(state, command, context);
    case "hypothesis.set-active":
      return applyHypothesisSetActive(state, command);
    case "report.add-note":
      return applyReportAddNote(state, command, context);
    case "report.review-note":
      return applyReportReviewNote(state, command);
    case "completeness.attest":
      return applyCompletenessAttest(state, command, context);
    case "completeness.withdraw":
      return applyCompletenessWithdraw(state, command);
    case "report.finalize":
      return applyReportFinalize(state, command, context);
    case "case.validate":
      return {
        nextState: state,
        affectedIds: [state.id],
        summary: "System ran deterministic consistency checks.",
        undoable: false,
      };
  }
}
