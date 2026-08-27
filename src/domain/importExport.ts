import { validateConsistency } from "./consistency";
import type { ReplayCase } from "./models";
import { REPLAY_SCHEMA_VERSION } from "./models";
import { validWorkspaceCitationPaths } from "./report";
import { parseReplayCase } from "./schema";

export interface CaseReferenceIssue {
  path: string;
  message: string;
}

export class ReplayImportError extends Error {
  readonly code = "INVALID_IMPORT" as const;
  readonly issues: CaseReferenceIssue[];

  constructor(message: string, issues: CaseReferenceIssue[] = []) {
    super(message);
    this.name = "ReplayImportError";
    this.issues = issues;
  }
}

function checkUniqueIds(
  values: { id: string }[],
  path: string,
  issues: CaseReferenceIssue[],
): Set<string> {
  const ids = new Set<string>();
  values.forEach((value, index) => {
    if (ids.has(value.id))
      issues.push({ path: `${path}.${index}.id`, message: `Duplicate ID ${value.id}` });
    ids.add(value.id);
  });
  return ids;
}

function requireReferences(
  references: string[],
  known: Set<string>,
  path: string,
  issues: CaseReferenceIssue[],
): void {
  references.forEach((reference, index) => {
    if (!known.has(reference)) {
      issues.push({ path: `${path}.${index}`, message: `Missing referenced object ${reference}` });
    }
  });
}

export function validateCaseReferences(replayCase: ReplayCase): CaseReferenceIssue[] {
  const issues: CaseReferenceIssue[] = [];
  const actorIds = checkUniqueIds(replayCase.actors, "actors", issues);
  const trajectoryIds = checkUniqueIds(replayCase.trajectories, "trajectories", issues);
  const eventIds = checkUniqueIds(replayCase.timelineEvents, "timelineEvents", issues);
  const branchIds = checkUniqueIds(replayCase.branches, "branches", issues);
  const claimIds = checkUniqueIds(replayCase.claims, "claims", issues);
  const evidenceIds = checkUniqueIds(replayCase.evidence, "evidence", issues);
  const questionIds = checkUniqueIds(replayCase.questions, "questions", issues);
  const proposalIds = checkUniqueIds(replayCase.proposals, "proposals", issues);
  const activityIds = checkUniqueIds(replayCase.activity, "activity", issues);
  const snapshotIds = checkUniqueIds(replayCase.reportSnapshots, "reportSnapshots", issues);
  const noteIds = checkUniqueIds(replayCase.reportNotes, "reportNotes", issues);
  void questionIds;
  void proposalIds;
  void activityIds;
  void snapshotIds;
  void noteIds;

  const globalIds = new Map<string, string>();
  const registerGlobalId = (objectId: string, path: string) => {
    const previousPath = globalIds.get(objectId);
    if (previousPath) {
      issues.push({
        path,
        message: `Object ID ${objectId} is already used at ${previousPath}`,
      });
    } else {
      globalIds.set(objectId, path);
    }
  };
  registerGlobalId(replayCase.id, "id");
  replayCase.actors.forEach((actor, actorIndex) => {
    registerGlobalId(actor.id, `actors.${actorIndex}.id`);
    actor.damageMarkers.forEach((marker, markerIndex) =>
      registerGlobalId(marker.id, `actors.${actorIndex}.damageMarkers.${markerIndex}.id`),
    );
  });
  replayCase.trajectories.forEach((trajectory, trajectoryIndex) => {
    registerGlobalId(trajectory.id, `trajectories.${trajectoryIndex}.id`);
    trajectory.keyframes.forEach((keyframe, keyframeIndex) =>
      registerGlobalId(
        keyframe.id,
        `trajectories.${trajectoryIndex}.keyframes.${keyframeIndex}.id`,
      ),
    );
  });
  replayCase.timelineEvents.forEach((event, index) =>
    registerGlobalId(event.id, `timelineEvents.${index}.id`),
  );
  replayCase.branches.forEach((branch, branchIndex) => {
    registerGlobalId(branch.id, `branches.${branchIndex}.id`);
    branch.assumptions.forEach((assumption, assumptionIndex) =>
      registerGlobalId(assumption.id, `branches.${branchIndex}.assumptions.${assumptionIndex}.id`),
    );
  });
  replayCase.claims.forEach((claim, index) => registerGlobalId(claim.id, `claims.${index}.id`));
  replayCase.evidence.forEach((asset, assetIndex) => {
    registerGlobalId(asset.id, `evidence.${assetIndex}.id`);
    asset.annotations.forEach((annotation, annotationIndex) =>
      registerGlobalId(annotation.id, `evidence.${assetIndex}.annotations.${annotationIndex}.id`),
    );
  });
  replayCase.questions.forEach((question, index) =>
    registerGlobalId(question.id, `questions.${index}.id`),
  );
  replayCase.proposals.forEach((proposal, proposalIndex) => {
    registerGlobalId(proposal.id, `proposals.${proposalIndex}.id`);
    proposal.revisions.forEach((revision, revisionIndex) => {
      registerGlobalId(revision.id, `proposals.${proposalIndex}.revisions.${revisionIndex}.id`);
      revision.changes.forEach((change, changeIndex) =>
        registerGlobalId(
          change.id,
          `proposals.${proposalIndex}.revisions.${revisionIndex}.changes.${changeIndex}.id`,
        ),
      );
    });
  });
  replayCase.activity.forEach((event, index) => registerGlobalId(event.id, `activity.${index}.id`));
  replayCase.reportNotes.forEach((note, index) =>
    registerGlobalId(note.id, `reportNotes.${index}.id`),
  );
  replayCase.reportSnapshots.forEach((snapshot, index) =>
    registerGlobalId(snapshot.id, `reportSnapshots.${index}.id`),
  );

  const damageIds = new Set(
    replayCase.actors.flatMap((actor) => actor.damageMarkers.map((marker) => marker.id)),
  );
  const assumptionIds = new Set(
    replayCase.branches.flatMap((branch) => branch.assumptions.map((assumption) => assumption.id)),
  );
  const sceneIds = new Set([...actorIds, ...trajectoryIds, ...damageIds]);
  const activeBranch = replayCase.branches.find(
    (branch) => branch.id === replayCase.activeBranchId,
  );
  if (!activeBranch) {
    issues.push({ path: "activeBranchId", message: "Active branch does not exist" });
  } else if (activeBranch.status === "archived") {
    issues.push({ path: "activeBranchId", message: "Active branch cannot be archived" });
  }

  replayCase.actors.forEach((actor, actorIndex) => {
    const markerIds = new Set<string>();
    actor.damageMarkers.forEach((marker, markerIndex) => {
      const path = `actors.${actorIndex}.damageMarkers.${markerIndex}`;
      if (markerIds.has(marker.id))
        issues.push({ path: `${path}.id`, message: `Duplicate damage marker ID ${marker.id}` });
      markerIds.add(marker.id);
      if (marker.actorId !== actor.id)
        issues.push({
          path: `${path}.actorId`,
          message: "Damage marker actor does not match its owner",
        });
      requireReferences(marker.linkedClaimIds, claimIds, `${path}.linkedClaimIds`, issues);
      requireReferences(marker.linkedEvidenceIds, evidenceIds, `${path}.linkedEvidenceIds`, issues);
    });
  });

  replayCase.trajectories.forEach((trajectory, index) => {
    const path = `trajectories.${index}`;
    requireReferences([trajectory.actorId], actorIds, `${path}.actorId`, issues);
    requireReferences([trajectory.branchId], branchIds, `${path}.branchId`, issues);
    checkUniqueIds(trajectory.keyframes, `${path}.keyframes`, issues);
  });

  replayCase.timelineEvents.forEach((event, index) => {
    const path = `timelineEvents.${index}`;
    requireReferences([event.branchId], branchIds, `${path}.branchId`, issues);
    requireReferences(event.linkedActorIds, actorIds, `${path}.linkedActorIds`, issues);
    requireReferences(event.linkedClaimIds, claimIds, `${path}.linkedClaimIds`, issues);
    requireReferences(event.linkedEvidenceIds, evidenceIds, `${path}.linkedEvidenceIds`, issues);
  });

  replayCase.claims.forEach((claim, index) => {
    const path = `claims.${index}`;
    if (claim.branchId) requireReferences([claim.branchId], branchIds, `${path}.branchId`, issues);
    requireReferences(claim.linkedEvidenceIds, evidenceIds, `${path}.linkedEvidenceIds`, issues);
    requireReferences(claim.linkedEventIds, eventIds, `${path}.linkedEventIds`, issues);
    requireReferences(claim.linkedSceneObjectIds, sceneIds, `${path}.linkedSceneObjectIds`, issues);
    requireReferences(claim.sourceIds, new Set(globalIds.keys()), `${path}.sourceIds`, issues);
  });

  replayCase.branches.forEach((branch, index) => {
    const path = `branches.${index}`;
    if (branch.parentBranchId) {
      requireReferences([branch.parentBranchId], branchIds, `${path}.parentBranchId`, issues);
      if (branch.parentBranchId === branch.id)
        issues.push({ path: `${path}.parentBranchId`, message: "Branch cannot parent itself" });
    }
    requireReferences(branch.sharedClaimIds, claimIds, `${path}.sharedClaimIds`, issues);
    requireReferences(branch.trajectoryIds, trajectoryIds, `${path}.trajectoryIds`, issues);
    requireReferences(branch.eventIds, eventIds, `${path}.eventIds`, issues);
    requireReferences(branch.claimIds, claimIds, `${path}.claimIds`, issues);
    branch.trajectoryIds.forEach((trajectoryId, childIndex) => {
      const trajectory = replayCase.trajectories.find((candidate) => candidate.id === trajectoryId);
      if (trajectory && trajectory.branchId !== branch.id) {
        issues.push({
          path: `${path}.trajectoryIds.${childIndex}`,
          message: "Trajectory belongs to a different branch",
        });
      }
    });
    branch.eventIds.forEach((eventId, childIndex) => {
      const event = replayCase.timelineEvents.find((candidate) => candidate.id === eventId);
      if (event && event.branchId !== branch.id) {
        issues.push({
          path: `${path}.eventIds.${childIndex}`,
          message: "Timeline event belongs to a different branch",
        });
      }
    });
    branch.claimIds.forEach((claimId, childIndex) => {
      const claim = replayCase.claims.find((candidate) => candidate.id === claimId);
      if (claim && claim.branchId !== branch.id) {
        issues.push({
          path: `${path}.claimIds.${childIndex}`,
          message: "Claim belongs to a different branch",
        });
      }
    });
    branch.sharedClaimIds.forEach((claimId, childIndex) => {
      const claim = replayCase.claims.find((candidate) => candidate.id === claimId);
      if (claim && !claim.sharedAcrossBranches) {
        issues.push({
          path: `${path}.sharedClaimIds.${childIndex}`,
          message: "Shared claim is not marked sharedAcrossBranches",
        });
      }
    });
    const assumptionIds = checkUniqueIds(branch.assumptions, `${path}.assumptions`, issues);
    void assumptionIds;
    branch.assumptions.forEach((assumption, assumptionIndex) => {
      const assumptionPath = `${path}.assumptions.${assumptionIndex}`;
      requireReferences(
        assumption.supportingEvidenceIds,
        evidenceIds,
        `${assumptionPath}.supportingEvidenceIds`,
        issues,
      );
      requireReferences(
        assumption.conflictingEvidenceIds,
        evidenceIds,
        `${assumptionPath}.conflictingEvidenceIds`,
        issues,
      );
      for (const evidenceId of new Set([
        ...assumption.supportingEvidenceIds,
        ...assumption.conflictingEvidenceIds,
      ])) {
        const asset = replayCase.evidence.find((candidate) => candidate.id === evidenceId);
        if (asset && !asset.linkedBranchIds.includes(branch.id)) {
          issues.push({
            path: assumptionPath,
            message: `Evidence ${evidenceId} is missing its reverse link to branch ${branch.id}`,
          });
        }
      }
    });
  });

  // Detect parent cycles independently of branch ordering.
  for (const branch of replayCase.branches) {
    const visited = new Set<string>([branch.id]);
    let parentId = branch.parentBranchId;
    while (parentId) {
      if (visited.has(parentId)) {
        issues.push({
          path: `branches.${branch.id}.parentBranchId`,
          message: "Branch parent relationship contains a cycle",
        });
        break;
      }
      visited.add(parentId);
      parentId = replayCase.branches.find((candidate) => candidate.id === parentId)?.parentBranchId;
    }
  }

  replayCase.evidence.forEach((asset, index) => {
    const path = `evidence.${index}`;
    requireReferences(asset.linkedClaimIds, claimIds, `${path}.linkedClaimIds`, issues);
    requireReferences(asset.linkedEventIds, eventIds, `${path}.linkedEventIds`, issues);
    requireReferences(asset.linkedSceneObjectIds, sceneIds, `${path}.linkedSceneObjectIds`, issues);
    requireReferences(asset.linkedBranchIds, branchIds, `${path}.linkedBranchIds`, issues);
    checkUniqueIds(asset.annotations, `${path}.annotations`, issues);
    const annotationIds = new Set(asset.annotations.map((annotation) => annotation.id));
    const annotationLinkKeys = new Set<string>();
    asset.annotationLinks.forEach((link, linkIndex) => {
      const linkPath = `${path}.annotationLinks.${linkIndex}`;
      requireReferences([link.annotationId], annotationIds, `${linkPath}.annotationId`, issues);
      const targetIds =
        link.targetType === "claim"
          ? claimIds
          : link.targetType === "timeline-event"
            ? eventIds
            : link.targetType === "actor"
              ? actorIds
              : link.targetType === "trajectory"
                ? trajectoryIds
                : link.targetType === "damage"
                  ? damageIds
                  : link.targetType === "hypothesis"
                    ? branchIds
                    : assumptionIds;
      requireReferences([link.targetId], targetIds, `${linkPath}.targetId`, issues);
      if (link.targetType === "assumption") {
        const assumption = replayCase.branches
          .flatMap((branch) => branch.assumptions)
          .find((candidate) => candidate.id === link.targetId);
        if (
          assumption &&
          !assumption.supportingEvidenceIds.includes(asset.id) &&
          !assumption.conflictingEvidenceIds.includes(asset.id)
        ) {
          issues.push({
            path: linkPath,
            message: `Assumption ${link.targetId} is missing its reverse link to evidence ${asset.id}`,
          });
        }
      }
      const key = `${link.annotationId}:${link.targetType}:${link.targetId}`;
      if (annotationLinkKeys.has(key)) {
        issues.push({ path: linkPath, message: "Duplicate annotation link" });
      }
      annotationLinkKeys.add(key);
    });
  });

  replayCase.questions.forEach((question, index) => {
    const path = `questions.${index}`;
    requireReferences(question.relatedClaimIds, claimIds, `${path}.relatedClaimIds`, issues);
    requireReferences(
      question.relatedSceneObjectIds,
      new Set([...sceneIds, ...eventIds]),
      `${path}.relatedSceneObjectIds`,
      issues,
    );
    requireReferences(question.relatedBranchIds, branchIds, `${path}.relatedBranchIds`, issues);
  });

  replayCase.proposals.forEach((proposal, proposalIndex) => {
    const proposalPath = `proposals.${proposalIndex}`;
    proposal.revisions.forEach((revision, revisionIndex) => {
      const revisionPath = `${proposalPath}.revisions.${revisionIndex}`;
      revision.changes.forEach((change, changeIndex) => {
        const changePath = `${revisionPath}.changes.${changeIndex}`;
        requireReferences([change.actorId], actorIds, `${changePath}.actorId`, issues);
        if (change.kind !== "trajectory-set") return;
        requireReferences([change.branchId], branchIds, `${changePath}.branchId`, issues);
        const target = replayCase.trajectories.find(
          (trajectory) => trajectory.id === change.trajectoryId,
        );
        if (!change.createsTrajectory || proposal.status === "accepted") {
          requireReferences(
            [change.trajectoryId],
            trajectoryIds,
            `${changePath}.trajectoryId`,
            issues,
          );
        }
        if (target && (target.actorId !== change.actorId || target.branchId !== change.branchId)) {
          issues.push({
            path: `${changePath}.trajectoryId`,
            message: "Proposal trajectory target belongs to a different actor or branch",
          });
        }
      });
    });
  });

  replayCase.activity.forEach((activity, index) => {
    if (!activity.overridesActivityId) return;
    const path = `activity.${index}.overridesActivityId`;
    requireReferences([activity.overridesActivityId], activityIds, path, issues);
    const overriddenIndex = replayCase.activity.findIndex(
      (candidate) => candidate.id === activity.overridesActivityId,
    );
    const overriddenActivity = replayCase.activity[overriddenIndex];
    if (overriddenIndex >= index) {
      issues.push({ path, message: "Human override must reference an earlier activity" });
    }
    if (
      overriddenActivity &&
      (overriddenActivity.author !== "agent" || overriddenActivity.origin !== "webmcp")
    ) {
      issues.push({ path, message: "Human override must reference an agent WebMCP activity" });
    }
    if (
      overriddenActivity &&
      !overriddenActivity.affectedIds.some((affectedId) =>
        activity.affectedIds.includes(affectedId),
      )
    ) {
      issues.push({
        path,
        message: "Human override must share an affected object with its target",
      });
    }
  });

  replayCase.reportNotes.forEach((note, index) => {
    requireReferences(note.claimIds, claimIds, `reportNotes.${index}.claimIds`, issues);
    requireReferences(note.evidenceIds, evidenceIds, `reportNotes.${index}.evidenceIds`, issues);
  });

  replayCase.reportSnapshots.forEach((snapshot, snapshotIndex) => {
    const path = `reportSnapshots.${snapshotIndex}`;
    requireReferences(snapshot.confirmedClaimIds, claimIds, `${path}.confirmedClaimIds`, issues);
    requireReferences(
      snapshot.includedEvidenceIds,
      evidenceIds,
      `${path}.includedEvidenceIds`,
      issues,
    );
    requireReferences(
      snapshot.unresolvedQuestionIds,
      questionIds,
      `${path}.unresolvedQuestionIds`,
      issues,
    );
    requireReferences(snapshot.branchIds, branchIds, `${path}.branchIds`, issues);
    snapshot.preview.sections.forEach((section, sectionIndex) => {
      section.statements.forEach((statement, statementIndex) => {
        requireReferences(
          statement.citations.claimIds,
          claimIds,
          `${path}.preview.sections.${sectionIndex}.statements.${statementIndex}.citations.claimIds`,
          issues,
        );
        requireReferences(
          statement.citations.workspacePaths,
          validWorkspaceCitationPaths(replayCase),
          `${path}.preview.sections.${sectionIndex}.statements.${statementIndex}.citations.workspacePaths`,
          issues,
        );
        requireReferences(
          statement.citations.evidenceIds,
          evidenceIds,
          `${path}.preview.sections.${sectionIndex}.statements.${statementIndex}.citations.evidenceIds`,
          issues,
        );
      });
    });
  });

  if (replayCase.selectedItem) {
    const knownByType: Record<NonNullable<ReplayCase["selectedItem"]>["type"], Set<string>> = {
      actor: actorIds,
      trajectory: trajectoryIds,
      "timeline-event": eventIds,
      claim: claimIds,
      evidence: evidenceIds,
      question: questionIds,
      hypothesis: branchIds,
      report: new Set([replayCase.id, "report-preview", ...snapshotIds]),
    };
    if (!knownByType[replayCase.selectedItem.type].has(replayCase.selectedItem.id)) {
      issues.push({ path: "selectedItem.id", message: "Selected workspace item does not exist" });
    }
  }

  return issues.sort((a, b) => a.path.localeCompare(b.path) || a.message.localeCompare(b.message));
}

export interface ImportReplayCaseOptions {
  maxBytes?: number;
  trustHumanAttestations?: boolean;
  now?: string;
  /** Opens an imported transfer as a distinct local case instead of overwriting the source ID. */
  rekeyCaseId?: string;
}

function rekeyImportedCase(replayCase: ReplayCase, nextCaseId: string): ReplayCase {
  const normalizedCaseId = nextCaseId.trim();
  if (normalizedCaseId.length === 0 || normalizedCaseId.length > 128) {
    throw new ReplayImportError("The new local case ID must contain 1 to 128 characters");
  }
  const previousCaseId = replayCase.id;
  if (normalizedCaseId === previousCaseId) return replayCase;
  const rekeyed = structuredClone(replayCase);
  const replaceCaseId = (id: string): string => (id === previousCaseId ? normalizedCaseId : id);
  rekeyed.id = normalizedCaseId;
  rekeyed.claims.forEach((claim) => {
    claim.sourceIds = claim.sourceIds.map(replaceCaseId);
  });
  rekeyed.activity.forEach((activity) => {
    activity.affectedIds = activity.affectedIds.map(replaceCaseId);
  });
  rekeyed.consistencyIssues.forEach((issue) => {
    issue.affectedIds = issue.affectedIds.map(replaceCaseId);
  });
  rekeyed.reportSnapshots.forEach((snapshot) => {
    snapshot.preview.caseId = normalizedCaseId;
  });
  if (rekeyed.selectedItem?.type === "report" && rekeyed.selectedItem.id === previousCaseId) {
    rekeyed.selectedItem.id = normalizedCaseId;
  }
  return rekeyed;
}

function resetUntrustedImportAttestations(replayCase: ReplayCase, now: string): ReplayCase {
  const sanitized = structuredClone(replayCase);
  sanitized.caseVersion += 1;
  sanitized.updatedAt = now;
  sanitized.claims.forEach((claim) => {
    if (claim.status === "confirmed") claim.status = "reported";
    claim.humanConfirmed = false;
    delete claim.confirmedAt;
    claim.changeHistory = claim.changeHistory.map((change) => ({
      ...change,
      author: "system",
      origin: "system",
      summary: `Imported history (unverified): ${change.summary}`.slice(0, 500),
    }));
  });
  sanitized.actors.forEach((actor) => {
    actor.damageMarkers.forEach((marker) => {
      if (marker.status === "confirmed") marker.status = "reported";
    });
  });
  sanitized.trajectories.forEach((trajectory) => {
    trajectory.changeHistory = trajectory.changeHistory.map((change) => ({
      ...change,
      author: "system",
      origin: "system",
      summary: `Imported history (unverified): ${change.summary}`.slice(0, 500),
    }));
  });
  sanitized.timelineEvents.forEach((event) => {
    if (event.certainty === "confirmed") event.certainty = "reported";
    event.changeHistory = event.changeHistory.map((change) => ({
      ...change,
      author: "system",
      origin: "system",
      summary: `Imported history (unverified): ${change.summary}`.slice(0, 500),
    }));
  });
  sanitized.branches.forEach((branch) => {
    branch.changeHistory = branch.changeHistory.map((change) => ({
      ...change,
      author: "system",
      origin: "system",
      summary: `Imported history (unverified): ${change.summary}`.slice(0, 500),
    }));
  });
  sanitized.questions.forEach((question) => {
    if (question.status === "answered") question.status = "open";
    delete question.answer;
    delete question.answerSource;
  });
  sanitized.evidence.forEach((asset) => {
    if (asset.localBlobKey.startsWith("evidence:")) {
      asset.deleted = true;
      asset.deletedAt = now;
      asset.source = "import";
    }
  });
  sanitized.reportNotes.forEach((note) => {
    note.reviewedByHuman = false;
  });
  sanitized.proposals.forEach((proposal) => {
    proposal.revisions.forEach((revision) => {
      revision.authorshipTrusted = false;
    });
    if (proposal.decision) proposal.decision.humanAttestationTrusted = false;
  });
  sanitized.reportSnapshots = [];
  if (
    sanitized.selectedItem?.type === "report" &&
    sanitized.selectedItem.id !== sanitized.id &&
    sanitized.selectedItem.id !== "report-preview"
  ) {
    delete sanitized.selectedItem;
  }
  sanitized.activity = sanitized.activity.map((activity) => {
    const imported = {
      ...activity,
      author: "system" as const,
      origin: "system" as const,
      summary: `Imported history (unverified): ${activity.summary}`.slice(0, 500),
      undoable: false,
    };
    delete imported.requestId;
    delete imported.classification;
    delete imported.overridesActivityId;
    return imported;
  });
  sanitized.activity.push({
    id: `activity-import-review-${crypto.randomUUID()}`,
    caseVersion: sanitized.caseVersion,
    author: "system",
    origin: "system",
    actionType: "case.imported-untrusted",
    summary:
      "Imported an unsigned structured case export. Human confirmations, answers, reviewed notes, and finalized snapshots require fresh local review.",
    affectedIds: [sanitized.id],
    undoable: false,
    createdAt: now,
  });
  return sanitized;
}

/** Migrates older structured case exports before strict current-schema validation. */
export function migrateReplayCase(input: unknown): unknown {
  if (typeof input !== "object" || input === null) return input;
  const source = input as Record<string, unknown>;
  if (source.schemaVersion !== 1) return input;
  const migrated = structuredClone(source);
  migrated.schemaVersion = 2;
  migrated.proposals = [];
  if (Array.isArray(migrated.evidence)) {
    migrated.evidence = migrated.evidence.map((asset: unknown): unknown =>
      typeof asset === "object" && asset !== null
        ? { ...(asset as Record<string, unknown>), annotationLinks: [] }
        : asset,
    );
  }
  if (Array.isArray(migrated.reportSnapshots)) {
    migrated.reportSnapshots = migrated.reportSnapshots.map((snapshot: unknown): unknown => {
      if (typeof snapshot !== "object" || snapshot === null) return snapshot;
      const nextSnapshot = structuredClone(snapshot as Record<string, unknown>);
      const preview = nextSnapshot.preview;
      if (typeof preview !== "object" || preview === null) return nextSnapshot;
      const nextPreview = structuredClone(preview as Record<string, unknown>);
      if (Array.isArray(nextPreview.sections)) {
        nextPreview.sections = nextPreview.sections.map((reportSection: unknown): unknown => {
          if (typeof reportSection !== "object" || reportSection === null) return reportSection;
          const nextSection = structuredClone(reportSection as Record<string, unknown>);
          if (Array.isArray(nextSection.statements)) {
            nextSection.statements = nextSection.statements.map(
              (reportStatement: unknown): unknown => {
                if (typeof reportStatement !== "object" || reportStatement === null)
                  return reportStatement;
                const nextStatement = structuredClone(reportStatement as Record<string, unknown>);
                const citations = nextStatement.citations;
                if (typeof citations === "object" && citations !== null) {
                  nextStatement.citations = {
                    ...(citations as Record<string, unknown>),
                    workspacePaths: [],
                  };
                }
                return nextStatement;
              },
            );
          }
          return nextSection;
        });
      }
      nextSnapshot.preview = nextPreview;
      return nextSnapshot;
    });
  }
  return migrated;
}

export function importReplayCase(
  input: unknown,
  options: ImportReplayCaseOptions = {},
): ReplayCase {
  const maxBytes = options.maxBytes ?? 20 * 1024 * 1024;
  let raw: unknown = input;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).byteLength > maxBytes) {
      throw new ReplayImportError(`Case import exceeds the ${maxBytes}-byte limit`);
    }
    try {
      raw = JSON.parse(input) as unknown;
    } catch {
      throw new ReplayImportError("Case import is not valid JSON");
    }
  }
  if (typeof raw !== "object" || raw === null)
    throw new ReplayImportError("Case import must be a JSON object");
  const incomingVersion = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (incomingVersion !== 1 && incomingVersion !== REPLAY_SCHEMA_VERSION) {
    throw new ReplayImportError(`Unsupported case schema version: ${String(incomingVersion)}`);
  }
  raw = migrateReplayCase(raw);

  let parsed: ReplayCase;
  try {
    parsed = parseReplayCase(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Case import failed schema validation";
    throw new ReplayImportError(message);
  }
  if (!options.trustHumanAttestations) {
    parsed = resetUntrustedImportAttestations(parsed, options.now ?? new Date().toISOString());
  }
  if (options.rekeyCaseId) parsed = rekeyImportedCase(parsed, options.rekeyCaseId);
  const referenceIssues = validateCaseReferences(parsed);
  if (referenceIssues.length > 0) {
    throw new ReplayImportError("Case import contains invalid object references", referenceIssues);
  }
  parsed.consistencyIssues = validateConsistency(parsed);
  return parseReplayCase(parsed);
}

export interface ExportReplayCaseOptions {
  pretty?: boolean;
}

export function exportReplayCase(
  replayCase: ReplayCase,
  options: ExportReplayCaseOptions = {},
): string {
  const validated = parseReplayCase(replayCase);
  const referenceIssues = validateCaseReferences(validated);
  if (referenceIssues.length > 0) {
    throw new ReplayImportError(
      "Cannot export a case with invalid object references",
      referenceIssues,
    );
  }
  return JSON.stringify(validated, null, options.pretty === false ? undefined : 2);
}
