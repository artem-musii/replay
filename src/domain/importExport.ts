import { validateConsistency } from "./consistency";
import { truncateXmlSafeText } from "./languageSafety";
import type { ReplayCase } from "./models";
import { REPLAY_SCHEMA_VERSION } from "./models";
import { createReportPreviewReviewBinding, reportPreviewHasValidReviewBinding } from "./report";
import { parseReplayCase } from "./schema";

export interface CaseReferenceIssue {
  path: string;
  message: string;
}

const MAX_REFERENCE_ISSUES = 1_000;

export class ReplayImportError extends Error {
  readonly code = "INVALID_IMPORT" as const;
  readonly issues: CaseReferenceIssue[];

  constructor(message: string, issues: CaseReferenceIssue[] = []) {
    super(message);
    this.name = "ReplayImportError";
    this.issues = issues;
  }
}

function addReferenceIssue(issues: CaseReferenceIssue[], issue: CaseReferenceIssue): void {
  if (issues.length < MAX_REFERENCE_ISSUES) issues.push(issue);
}

function indexById<T extends { id: string }>(values: readonly T[]): Map<string, T> {
  const indexed = new Map<string, T>();
  for (const value of values) {
    if (!indexed.has(value.id)) indexed.set(value.id, value);
  }
  return indexed;
}

function checkUniqueIds(
  values: { id: string }[],
  path: string,
  issues: CaseReferenceIssue[],
): Set<string> {
  const ids = new Set<string>();
  values.forEach((value, index) => {
    if (ids.has(value.id))
      addReferenceIssue(issues, {
        path: `${path}.${index}.id`,
        message: `Duplicate ID ${value.id}`,
      });
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
      addReferenceIssue(issues, {
        path: `${path}.${index}`,
        message: `Missing referenced object ${reference}`,
      });
    }
  });
}

function requireSameReferenceSet(
  actual: string[],
  expected: Set<string>,
  path: string,
  issues: CaseReferenceIssue[],
): void {
  requireReferences(actual, expected, path, issues);
  const actualSet = new Set(actual);
  for (const reference of expected) {
    if (!actualSet.has(reference)) {
      addReferenceIssue(issues, {
        path,
        message: `Historical snapshot index is missing ${reference}`,
      });
    }
  }
}

function checkUniqueReferenceIds(
  references: string[],
  path: string,
  label: string,
  issues: CaseReferenceIssue[],
): void {
  const firstIndexById = new Map<string, number>();
  references.forEach((reference, index) => {
    const firstIndex = firstIndexById.get(reference);
    if (firstIndex !== undefined) {
      addReferenceIssue(issues, {
        path: `${path}.${index}`,
        message: `Duplicate ${label} ${reference}; first indexed at ${path}.${firstIndex}`,
      });
      return;
    }
    firstIndexById.set(reference, index);
  });
}

function recordBranchIndexMembership(
  memberships: Map<string, Map<string, number>>,
  objectId: string,
  branchId: string,
): void {
  const branchCounts = memberships.get(objectId) ?? new Map<string, number>();
  branchCounts.set(branchId, (branchCounts.get(branchId) ?? 0) + 1);
  memberships.set(objectId, branchCounts);
}

function requireOwningBranchIndex(
  objectId: string,
  ownerBranchId: string,
  objectLabel: string,
  collectionName: "trajectoryIds" | "eventIds" | "claimIds",
  branchIndexById: Map<string, number>,
  memberships: Map<string, Map<string, number>>,
  issues: CaseReferenceIssue[],
): void {
  const ownerIndex = branchIndexById.get(ownerBranchId);
  if (ownerIndex === undefined) return;
  if ((memberships.get(objectId)?.get(ownerBranchId) ?? 0) > 0) return;
  addReferenceIssue(issues, {
    path: `branches.${ownerIndex}.${collectionName}`,
    message: `${objectLabel} ${objectId} is missing from owning branch ${ownerBranchId}.${collectionName}`,
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
  const completenessAttestationIds = checkUniqueIds(
    replayCase.completenessAttestations,
    "completenessAttestations",
    issues,
  );
  void questionIds;
  void proposalIds;
  void activityIds;
  void snapshotIds;
  void noteIds;
  void completenessAttestationIds;

  const trajectoryById = indexById(replayCase.trajectories);
  const eventById = indexById(replayCase.timelineEvents);
  const branchById = indexById(replayCase.branches);
  const branchIndexById = new Map<string, number>();
  replayCase.branches.forEach((branch, index) => {
    if (!branchIndexById.has(branch.id)) branchIndexById.set(branch.id, index);
  });
  const claimById = indexById(replayCase.claims);
  const evidenceById = indexById(replayCase.evidence);
  const activityById = indexById(replayCase.activity);
  const activityIndexById = new Map<string, number>();
  replayCase.activity.forEach((activity, index) => {
    if (!activityIndexById.has(activity.id)) activityIndexById.set(activity.id, index);
  });

  const globalIds = new Map<string, string>();
  const registerGlobalId = (objectId: string, path: string) => {
    const previousPath = globalIds.get(objectId);
    if (previousPath) {
      addReferenceIssue(issues, {
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
  replayCase.completenessAttestations.forEach((attestation, index) =>
    registerGlobalId(attestation.id, `completenessAttestations.${index}.id`),
  );

  const damageIds = new Set(
    replayCase.actors.flatMap((actor) => actor.damageMarkers.map((marker) => marker.id)),
  );
  const damageById = indexById(replayCase.actors.flatMap((actor) => actor.damageMarkers));
  const assumptionIds = new Set(
    replayCase.branches.flatMap((branch) => branch.assumptions.map((assumption) => assumption.id)),
  );
  const assumptionById = indexById(replayCase.branches.flatMap((branch) => branch.assumptions));
  const sceneIds = new Set([...actorIds, ...trajectoryIds, ...damageIds]);
  const questionSceneIds = new Set([...sceneIds, ...eventIds]);
  const globalKnownIds = new Set(globalIds.keys());
  const evidenceLinkedBranchIdsById = new Map(
    replayCase.evidence.map((asset) => [asset.id, new Set(asset.linkedBranchIds)]),
  );
  const assumptionEvidenceIdsById = new Map(
    replayCase.branches.flatMap((branch) =>
      branch.assumptions.map(
        (assumption) =>
          [
            assumption.id,
            new Set([...assumption.supportingEvidenceIds, ...assumption.conflictingEvidenceIds]),
          ] as const,
      ),
    ),
  );
  const activeBranch = branchById.get(replayCase.activeBranchId);
  if (!activeBranch) {
    addReferenceIssue(issues, {
      path: "activeBranchId",
      message: "Active branch does not exist",
    });
  } else if (activeBranch.status === "archived") {
    addReferenceIssue(issues, {
      path: "activeBranchId",
      message: "Active branch cannot be archived",
    });
  }

  replayCase.actors.forEach((actor, actorIndex) => {
    const markerIds = new Set<string>();
    actor.damageMarkers.forEach((marker, markerIndex) => {
      const path = `actors.${actorIndex}.damageMarkers.${markerIndex}`;
      if (markerIds.has(marker.id))
        addReferenceIssue(issues, {
          path: `${path}.id`,
          message: `Duplicate damage marker ID ${marker.id}`,
        });
      markerIds.add(marker.id);
      if (marker.actorId !== actor.id)
        addReferenceIssue(issues, {
          path: `${path}.actorId`,
          message: "Damage marker actor does not match its owner",
        });
      requireReferences(marker.linkedClaimIds, claimIds, `${path}.linkedClaimIds`, issues);
      requireReferences(marker.linkedEvidenceIds, evidenceIds, `${path}.linkedEvidenceIds`, issues);
      checkUniqueReferenceIds(
        marker.linkedClaimIds,
        `${path}.linkedClaimIds`,
        "linked claim ID",
        issues,
      );
      checkUniqueReferenceIds(
        marker.linkedEvidenceIds,
        `${path}.linkedEvidenceIds`,
        "linked evidence ID",
        issues,
      );
      marker.linkedClaimIds.forEach((claimId, claimIndex) => {
        const claim = claimById.get(claimId);
        if (claim && !claim.linkedSceneObjectIds.includes(marker.id)) {
          addReferenceIssue(issues, {
            path: `${path}.linkedClaimIds.${claimIndex}`,
            message: `Claim ${claimId} is missing its reverse scene link to damage marker ${marker.id}`,
          });
        }
      });
      marker.linkedEvidenceIds.forEach((evidenceId, evidenceIndex) => {
        const asset = evidenceById.get(evidenceId);
        if (asset && !asset.linkedSceneObjectIds.includes(marker.id)) {
          addReferenceIssue(issues, {
            path: `${path}.linkedEvidenceIds.${evidenceIndex}`,
            message: `Evidence ${evidenceId} is missing its reverse scene link to damage marker ${marker.id}`,
          });
        }
      });
    });
  });

  replayCase.completenessAttestations.forEach((attestation, index) => {
    if (attestation.kind !== "actor-damage") return;
    requireReferences(
      [attestation.actorId],
      actorIds,
      `completenessAttestations.${index}.actorId`,
      issues,
    );
  });

  const trajectoryOwnersByActor = new Map<string, Map<string, string>>();
  replayCase.trajectories.forEach((trajectory, index) => {
    const path = `trajectories.${index}`;
    requireReferences([trajectory.actorId], actorIds, `${path}.actorId`, issues);
    requireReferences([trajectory.branchId], branchIds, `${path}.branchId`, issues);
    checkUniqueIds(trajectory.keyframes, `${path}.keyframes`, issues);
    const byBranch = trajectoryOwnersByActor.get(trajectory.actorId) ?? new Map<string, string>();
    const existingTrajectoryId = byBranch.get(trajectory.branchId);
    if (existingTrajectoryId) {
      addReferenceIssue(issues, {
        path,
        message: `Actor ${trajectory.actorId} has more than one trajectory in branch ${trajectory.branchId}: ${existingTrajectoryId} and ${trajectory.id}`,
      });
    } else {
      byBranch.set(trajectory.branchId, trajectory.id);
      trajectoryOwnersByActor.set(trajectory.actorId, byBranch);
    }
  });

  replayCase.timelineEvents.forEach((event, index) => {
    const path = `timelineEvents.${index}`;
    requireReferences([event.branchId], branchIds, `${path}.branchId`, issues);
    requireReferences(event.linkedActorIds, actorIds, `${path}.linkedActorIds`, issues);
    requireReferences(event.linkedClaimIds, claimIds, `${path}.linkedClaimIds`, issues);
    requireReferences(event.linkedEvidenceIds, evidenceIds, `${path}.linkedEvidenceIds`, issues);
    checkUniqueReferenceIds(
      event.linkedClaimIds,
      `${path}.linkedClaimIds`,
      "linked claim ID",
      issues,
    );
    checkUniqueReferenceIds(
      event.linkedEvidenceIds,
      `${path}.linkedEvidenceIds`,
      "linked evidence ID",
      issues,
    );
    event.linkedClaimIds.forEach((claimId, claimIndex) => {
      const claim = claimById.get(claimId);
      if (claim && !claim.linkedEventIds.includes(event.id)) {
        addReferenceIssue(issues, {
          path: `${path}.linkedClaimIds.${claimIndex}`,
          message: `Claim ${claimId} is missing its reverse link to event ${event.id}`,
        });
      }
    });
    event.linkedEvidenceIds.forEach((evidenceId, evidenceIndex) => {
      const asset = evidenceById.get(evidenceId);
      if (asset && !asset.linkedEventIds.includes(event.id)) {
        addReferenceIssue(issues, {
          path: `${path}.linkedEvidenceIds.${evidenceIndex}`,
          message: `Evidence ${evidenceId} is missing its reverse link to timeline event ${event.id}`,
        });
      }
    });
  });

  replayCase.claims.forEach((claim, index) => {
    const path = `claims.${index}`;
    if (claim.branchId) requireReferences([claim.branchId], branchIds, `${path}.branchId`, issues);
    if (claim.branchId && claim.sharedAcrossBranches) {
      addReferenceIssue(issues, {
        path: `${path}.sharedAcrossBranches`,
        message: `Claim ${claim.id} cannot be both branch-scoped and shared across branches`,
      });
    }
    if (!claim.branchId && !claim.sharedAcrossBranches) {
      addReferenceIssue(issues, {
        path: `${path}.branchId`,
        message: `Non-shared claim ${claim.id} requires an owning branchId`,
      });
    }
    requireReferences(claim.linkedEvidenceIds, evidenceIds, `${path}.linkedEvidenceIds`, issues);
    requireReferences(claim.linkedEventIds, eventIds, `${path}.linkedEventIds`, issues);
    requireReferences(claim.linkedSceneObjectIds, sceneIds, `${path}.linkedSceneObjectIds`, issues);
    requireReferences(claim.sourceIds, globalKnownIds, `${path}.sourceIds`, issues);
    checkUniqueReferenceIds(
      claim.linkedEvidenceIds,
      `${path}.linkedEvidenceIds`,
      "linked evidence ID",
      issues,
    );
    checkUniqueReferenceIds(
      claim.linkedEventIds,
      `${path}.linkedEventIds`,
      "linked event ID",
      issues,
    );
    checkUniqueReferenceIds(
      claim.linkedSceneObjectIds,
      `${path}.linkedSceneObjectIds`,
      "linked scene object ID",
      issues,
    );
    claim.linkedEvidenceIds.forEach((evidenceId, evidenceIndex) => {
      const asset = evidenceById.get(evidenceId);
      if (asset && !asset.linkedClaimIds.includes(claim.id)) {
        addReferenceIssue(issues, {
          path: `${path}.linkedEvidenceIds.${evidenceIndex}`,
          message: `Evidence ${evidenceId} is missing its reverse link to claim ${claim.id}`,
        });
      }
    });
    claim.linkedEventIds.forEach((eventId, eventIndex) => {
      const event = eventById.get(eventId);
      if (event && !event.linkedClaimIds.includes(claim.id)) {
        addReferenceIssue(issues, {
          path: `${path}.linkedEventIds.${eventIndex}`,
          message: `Event ${eventId} is missing its reverse link to claim ${claim.id}`,
        });
      }
    });
    claim.linkedSceneObjectIds.forEach((sceneObjectId, sceneIndex) => {
      const marker = damageById.get(sceneObjectId);
      if (marker && !marker.linkedClaimIds.includes(claim.id)) {
        addReferenceIssue(issues, {
          path: `${path}.linkedSceneObjectIds.${sceneIndex}`,
          message: `Damage marker ${marker.id} is missing its reverse link to claim ${claim.id}`,
        });
      }
    });
  });

  const trajectoryBranchMemberships = new Map<string, Map<string, number>>();
  const eventBranchMemberships = new Map<string, Map<string, number>>();
  const branchClaimMemberships = new Map<string, Map<string, number>>();
  const sharedClaimMemberships = new Map<string, Map<string, number>>();
  replayCase.branches.forEach((branch, index) => {
    const path = `branches.${index}`;
    if (branch.parentBranchId) {
      requireReferences([branch.parentBranchId], branchIds, `${path}.parentBranchId`, issues);
      if (branch.parentBranchId === branch.id)
        addReferenceIssue(issues, {
          path: `${path}.parentBranchId`,
          message: "Branch cannot parent itself",
        });
    }
    requireReferences(branch.sharedClaimIds, claimIds, `${path}.sharedClaimIds`, issues);
    requireReferences(branch.trajectoryIds, trajectoryIds, `${path}.trajectoryIds`, issues);
    requireReferences(branch.eventIds, eventIds, `${path}.eventIds`, issues);
    requireReferences(branch.claimIds, claimIds, `${path}.claimIds`, issues);
    checkUniqueReferenceIds(
      branch.sharedClaimIds,
      `${path}.sharedClaimIds`,
      "shared claim ID",
      issues,
    );
    checkUniqueReferenceIds(branch.trajectoryIds, `${path}.trajectoryIds`, "trajectory ID", issues);
    checkUniqueReferenceIds(branch.eventIds, `${path}.eventIds`, "timeline event ID", issues);
    checkUniqueReferenceIds(branch.claimIds, `${path}.claimIds`, "branch claim ID", issues);
    branch.trajectoryIds.forEach((trajectoryId, childIndex) => {
      recordBranchIndexMembership(trajectoryBranchMemberships, trajectoryId, branch.id);
      const trajectory = trajectoryById.get(trajectoryId);
      if (trajectory && trajectory.branchId !== branch.id) {
        addReferenceIssue(issues, {
          path: `${path}.trajectoryIds.${childIndex}`,
          message: "Trajectory belongs to a different branch",
        });
      }
    });
    branch.eventIds.forEach((eventId, childIndex) => {
      recordBranchIndexMembership(eventBranchMemberships, eventId, branch.id);
      const event = eventById.get(eventId);
      if (event && event.branchId !== branch.id) {
        addReferenceIssue(issues, {
          path: `${path}.eventIds.${childIndex}`,
          message: "Timeline event belongs to a different branch",
        });
      }
    });
    branch.claimIds.forEach((claimId, childIndex) => {
      recordBranchIndexMembership(branchClaimMemberships, claimId, branch.id);
      const claim = claimById.get(claimId);
      if (claim && (claim.branchId !== branch.id || claim.sharedAcrossBranches)) {
        addReferenceIssue(issues, {
          path: `${path}.claimIds.${childIndex}`,
          message: "Claim is not a non-shared claim owned by this branch",
        });
      }
    });
    branch.sharedClaimIds.forEach((claimId, childIndex) => {
      recordBranchIndexMembership(sharedClaimMemberships, claimId, branch.id);
      const claim = claimById.get(claimId);
      if (claim && (!claim.sharedAcrossBranches || claim.branchId !== undefined)) {
        addReferenceIssue(issues, {
          path: `${path}.sharedClaimIds.${childIndex}`,
          message: "Claim is not a global shared-across-branches claim",
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
        const asset = evidenceById.get(evidenceId);
        if (asset && !evidenceLinkedBranchIdsById.get(asset.id)?.has(branch.id)) {
          addReferenceIssue(issues, {
            path: assumptionPath,
            message: `Evidence ${evidenceId} is missing its reverse link to branch ${branch.id}`,
          });
        }
      }
    });
  });

  replayCase.trajectories.forEach((trajectory) => {
    requireOwningBranchIndex(
      trajectory.id,
      trajectory.branchId,
      "Trajectory",
      "trajectoryIds",
      branchIndexById,
      trajectoryBranchMemberships,
      issues,
    );
  });
  replayCase.timelineEvents.forEach((event) => {
    requireOwningBranchIndex(
      event.id,
      event.branchId,
      "Timeline event",
      "eventIds",
      branchIndexById,
      eventBranchMemberships,
      issues,
    );
  });
  replayCase.claims.forEach((claim) => {
    if (claim.branchId && !claim.sharedAcrossBranches) {
      requireOwningBranchIndex(
        claim.id,
        claim.branchId,
        "Branch claim",
        "claimIds",
        branchIndexById,
        branchClaimMemberships,
        issues,
      );
      return;
    }
    if (!claim.branchId && claim.sharedAcrossBranches) {
      replayCase.branches.forEach((branch, branchIndex) => {
        if ((sharedClaimMemberships.get(claim.id)?.get(branch.id) ?? 0) > 0) return;
        addReferenceIssue(issues, {
          path: `branches.${branchIndex}.sharedClaimIds`,
          message: `Shared claim ${claim.id} is missing from branch ${branch.id}.sharedClaimIds`,
        });
      });
    }
  });

  // Detect parent cycles independently of branch ordering.
  for (const branch of replayCase.branches) {
    const visited = new Set<string>([branch.id]);
    let parentId = branch.parentBranchId;
    while (parentId) {
      if (visited.has(parentId)) {
        addReferenceIssue(issues, {
          path: `branches.${branch.id}.parentBranchId`,
          message: "Branch parent relationship contains a cycle",
        });
        break;
      }
      visited.add(parentId);
      parentId = branchById.get(parentId)?.parentBranchId;
    }
  }

  replayCase.evidence.forEach((asset, index) => {
    const path = `evidence.${index}`;
    requireReferences(asset.linkedClaimIds, claimIds, `${path}.linkedClaimIds`, issues);
    requireReferences(asset.linkedEventIds, eventIds, `${path}.linkedEventIds`, issues);
    requireReferences(asset.linkedSceneObjectIds, sceneIds, `${path}.linkedSceneObjectIds`, issues);
    requireReferences(asset.linkedBranchIds, branchIds, `${path}.linkedBranchIds`, issues);
    checkUniqueReferenceIds(
      asset.linkedClaimIds,
      `${path}.linkedClaimIds`,
      "linked claim ID",
      issues,
    );
    checkUniqueReferenceIds(
      asset.linkedEventIds,
      `${path}.linkedEventIds`,
      "linked event ID",
      issues,
    );
    checkUniqueReferenceIds(
      asset.linkedSceneObjectIds,
      `${path}.linkedSceneObjectIds`,
      "linked scene object ID",
      issues,
    );
    asset.linkedClaimIds.forEach((claimId, claimIndex) => {
      const claim = claimById.get(claimId);
      if (claim && !claim.linkedEvidenceIds.includes(asset.id)) {
        addReferenceIssue(issues, {
          path: `${path}.linkedClaimIds.${claimIndex}`,
          message: `Claim ${claimId} is missing its reverse link to evidence ${asset.id}`,
        });
      }
    });
    asset.linkedEventIds.forEach((eventId, eventIndex) => {
      const event = eventById.get(eventId);
      if (event && !event.linkedEvidenceIds.includes(asset.id)) {
        addReferenceIssue(issues, {
          path: `${path}.linkedEventIds.${eventIndex}`,
          message: `Timeline event ${eventId} is missing its reverse link to evidence ${asset.id}`,
        });
      }
    });
    asset.linkedSceneObjectIds.forEach((sceneObjectId, sceneIndex) => {
      const marker = damageById.get(sceneObjectId);
      if (marker && !marker.linkedEvidenceIds.includes(asset.id)) {
        addReferenceIssue(issues, {
          path: `${path}.linkedSceneObjectIds.${sceneIndex}`,
          message: `Damage marker ${marker.id} is missing its reverse link to evidence ${asset.id}`,
        });
      }
    });
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
        const assumption = assumptionById.get(link.targetId);
        if (assumption && !assumptionEvidenceIdsById.get(assumption.id)?.has(asset.id)) {
          addReferenceIssue(issues, {
            path: linkPath,
            message: `Assumption ${link.targetId} is missing its reverse link to evidence ${asset.id}`,
          });
        }
      }
      const key = `${link.annotationId}:${link.targetType}:${link.targetId}`;
      if (annotationLinkKeys.has(key)) {
        addReferenceIssue(issues, { path: linkPath, message: "Duplicate annotation link" });
      }
      annotationLinkKeys.add(key);
    });
  });

  replayCase.questions.forEach((question, index) => {
    const path = `questions.${index}`;
    requireReferences(question.relatedClaimIds, claimIds, `${path}.relatedClaimIds`, issues);
    requireReferences(
      question.relatedSceneObjectIds,
      questionSceneIds,
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
        if (change.kind === "actor-pose") {
          if (change.branchId) {
            requireReferences([change.branchId], branchIds, `${changePath}.branchId`, issues);
          }
          if (change.baseTrajectory) {
            requireReferences(
              [change.baseTrajectory.trajectoryId],
              trajectoryIds,
              `${changePath}.baseTrajectory.trajectoryId`,
              issues,
            );
            const target = trajectoryById.get(change.baseTrajectory.trajectoryId);
            if (
              target &&
              (target.actorId !== change.actorId || target.branchId !== change.branchId)
            ) {
              addReferenceIssue(issues, {
                path: `${changePath}.baseTrajectory.trajectoryId`,
                message: "Proposal pose trajectory baseline belongs to a different actor or branch",
              });
            }
          }
          return;
        }
        requireReferences([change.branchId], branchIds, `${changePath}.branchId`, issues);
        const target = trajectoryById.get(change.trajectoryId);
        if (!change.createsTrajectory || proposal.status === "accepted") {
          requireReferences(
            [change.trajectoryId],
            trajectoryIds,
            `${changePath}.trajectoryId`,
            issues,
          );
        }
        if (target && (target.actorId !== change.actorId || target.branchId !== change.branchId)) {
          addReferenceIssue(issues, {
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
    const overriddenIndex = activityIndexById.get(activity.overridesActivityId) ?? -1;
    const overriddenActivity = activityById.get(activity.overridesActivityId);
    if (overriddenIndex >= index) {
      addReferenceIssue(issues, {
        path,
        message: "Human override must reference an earlier activity",
      });
    }
    if (
      overriddenActivity &&
      (overriddenActivity.author !== "agent" || overriddenActivity.origin !== "webmcp")
    ) {
      addReferenceIssue(issues, {
        path,
        message: "Human override must reference an agent WebMCP activity",
      });
    }
    const overriddenAffectedIds = new Set(overriddenActivity?.affectedIds ?? []);
    if (
      overriddenActivity &&
      !activity.affectedIds.some((affectedId) => overriddenAffectedIds.has(affectedId))
    ) {
      addReferenceIssue(issues, {
        path,
        message: "Human override must share an affected object with its target",
      });
    }
  });

  replayCase.reportNotes.forEach((note, index) => {
    requireReferences(note.claimIds, claimIds, `reportNotes.${index}.claimIds`, issues);
    requireReferences(note.evidenceIds, evidenceIds, `reportNotes.${index}.evidenceIds`, issues);
  });

  let previousBoundSnapshot: ReplayCase["reportSnapshots"][number] | undefined;
  replayCase.reportSnapshots.forEach((snapshot, snapshotIndex) => {
    const path = `reportSnapshots.${snapshotIndex}`;
    if (snapshot.preview.reviewBinding) {
      if (!reportPreviewHasValidReviewBinding(snapshot.preview)) {
        addReferenceIssue(issues, {
          path: `${path}.preview.reviewBinding.fingerprint`,
          message:
            "Bound historical report preview fingerprint does not match its content and scope",
        });
      }
      if (snapshot.preview.caseId !== replayCase.id) {
        addReferenceIssue(issues, {
          path: `${path}.preview.caseId`,
          message: "Bound historical report preview belongs to a different case",
        });
      }
      if (snapshot.caseVersion !== snapshot.preview.caseVersion + 1) {
        addReferenceIssue(issues, {
          path: `${path}.caseVersion`,
          message: "Bound snapshot version must immediately follow its reviewed case version",
        });
      }
      if (snapshot.caseVersion > replayCase.caseVersion) {
        addReferenceIssue(issues, {
          path: `${path}.caseVersion`,
          message: "Bound snapshot version cannot be newer than the current case",
        });
      }
      if (Date.parse(snapshot.createdAt) < Date.parse(snapshot.preview.generatedAt)) {
        addReferenceIssue(issues, {
          path: `${path}.createdAt`,
          message: "Bound snapshot cannot predate the preview that a human reviewed",
        });
      }
      if (Date.parse(snapshot.createdAt) > Date.parse(replayCase.updatedAt)) {
        addReferenceIssue(issues, {
          path: `${path}.createdAt`,
          message: "Bound snapshot cannot postdate the current case",
        });
      }
      if (previousBoundSnapshot) {
        if (snapshot.caseVersion <= previousBoundSnapshot.caseVersion) {
          addReferenceIssue(issues, {
            path: `${path}.caseVersion`,
            message: "Bound snapshots must remain in increasing case-version order",
          });
        }
        if (Date.parse(snapshot.createdAt) < Date.parse(previousBoundSnapshot.createdAt)) {
          addReferenceIssue(issues, {
            path: `${path}.createdAt`,
            message: "Bound snapshots must remain in chronological order",
          });
        }
      }
      previousBoundSnapshot = snapshot;
    }
    const historicalClaimIds = new Set(snapshot.preview.includedClaimIds);
    const historicalEvidenceIds = new Set(snapshot.preview.includedEvidenceIds);
    const historicalQuestionIds = new Set(snapshot.preview.unresolvedQuestionIds);
    requireReferences(
      snapshot.confirmedClaimIds,
      historicalClaimIds,
      `${path}.confirmedClaimIds`,
      issues,
    );
    requireSameReferenceSet(
      snapshot.includedEvidenceIds,
      historicalEvidenceIds,
      `${path}.includedEvidenceIds`,
      issues,
    );
    requireSameReferenceSet(
      snapshot.unresolvedQuestionIds,
      historicalQuestionIds,
      `${path}.unresolvedQuestionIds`,
      issues,
    );
    if (snapshot.preview.reviewBinding) {
      requireSameReferenceSet(
        snapshot.branchIds,
        new Set(snapshot.preview.reviewBinding.branchIds),
        `${path}.branchIds`,
        issues,
      );
    }
    const citedClaimIds = new Set<string>();
    const citedEvidenceIds = new Set<string>();
    snapshot.preview.sections.forEach((section, sectionIndex) => {
      section.statements.forEach((statement, statementIndex) => {
        statement.citations.claimIds.forEach((id) => citedClaimIds.add(id));
        statement.citations.evidenceIds.forEach((id) => citedEvidenceIds.add(id));
        requireReferences(
          statement.citations.claimIds,
          historicalClaimIds,
          `${path}.preview.sections.${sectionIndex}.statements.${statementIndex}.citations.claimIds`,
          issues,
        );
        requireReferences(
          statement.citations.evidenceIds,
          historicalEvidenceIds,
          `${path}.preview.sections.${sectionIndex}.statements.${statementIndex}.citations.evidenceIds`,
          issues,
        );
      });
    });
    requireSameReferenceSet(
      snapshot.preview.includedClaimIds,
      citedClaimIds,
      `${path}.preview.includedClaimIds`,
      issues,
    );
    requireSameReferenceSet(
      snapshot.preview.includedEvidenceIds,
      citedEvidenceIds,
      `${path}.preview.includedEvidenceIds`,
      issues,
    );
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
      addReferenceIssue(issues, {
        path: "selectedItem.id",
        message: "Selected workspace item does not exist",
      });
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

export interface ReplayImportTrustResetSummary {
  confirmedClaims: number;
  confirmedDamageMarkers: number;
  confirmedTimelineEvents: number;
  answeredQuestions: number;
  evidenceFilesUnavailable: number;
  reviewedReportNotes: number;
  completenessAttestations: number;
  finalizedSnapshots: number;
  proposalRevisions: number;
  proposalDecisions: number;
}

export interface PreparedReplayCaseImport {
  replayCase: ReplayCase;
  trustResetSummary: ReplayImportTrustResetSummary;
}

function importTrustResetSummary(replayCase: ReplayCase): ReplayImportTrustResetSummary {
  return {
    confirmedClaims: replayCase.claims.filter(
      (claim) => claim.status === "confirmed" || claim.humanConfirmed,
    ).length,
    confirmedDamageMarkers: replayCase.actors
      .flatMap((actor) => actor.damageMarkers)
      .filter((marker) => marker.status === "confirmed").length,
    confirmedTimelineEvents: replayCase.timelineEvents.filter(
      (event) => event.certainty === "confirmed",
    ).length,
    answeredQuestions: replayCase.questions.filter((question) => question.status === "answered")
      .length,
    evidenceFilesUnavailable: replayCase.evidence.filter(
      (asset) => !asset.deleted && asset.localBlobKey.startsWith("evidence:"),
    ).length,
    reviewedReportNotes: replayCase.reportNotes.filter((note) => note.reviewedByHuman).length,
    completenessAttestations: replayCase.completenessAttestations.filter(
      (attestation) => attestation.humanAttestationTrusted,
    ).length,
    finalizedSnapshots: replayCase.reportSnapshots.length,
    proposalRevisions: replayCase.proposals.reduce(
      (count, proposal) =>
        count + proposal.revisions.filter((revision) => revision.authorshipTrusted).length,
      0,
    ),
    proposalDecisions: replayCase.proposals.filter(
      (proposal) => proposal.decision?.humanAttestationTrusted,
    ).length,
  };
}

function truncateDiagnostic(value: string, maxLength = 240): string {
  return value.length <= maxLength ? value : `${truncateXmlSafeText(value, maxLength - 1)}…`;
}

function schemaImportErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const candidateIssues: unknown = Reflect.get(error, "issues");
    if (Array.isArray(candidateIssues)) {
      const details = candidateIssues.slice(0, 4).flatMap((candidate): string[] => {
        if (typeof candidate !== "object" || candidate === null) return [];
        const path: unknown = Reflect.get(candidate, "path");
        const message: unknown = Reflect.get(candidate, "message");
        if (typeof message !== "string") return [];
        const normalizedPath = Array.isArray(path)
          ? path
              .filter((segment): segment is string | number =>
                ["string", "number"].includes(typeof segment),
              )
              .join(".")
          : "";
        return [
          `${normalizedPath ? `${truncateDiagnostic(normalizedPath)}: ` : ""}${truncateDiagnostic(message)}`,
        ];
      });
      const omitted = candidateIssues.length - details.length;
      return details.length > 0
        ? `Case import failed schema validation. ${details.join("; ")}${omitted > 0 ? `; ${omitted} more issue${omitted === 1 ? "" : "s"} omitted.` : ""}`
        : "Case import failed schema validation.";
    }
  }
  if (error instanceof Error && error.message) {
    return `Case import failed schema validation. ${truncateDiagnostic(error.message, 1_000)}`;
  }
  return "Case import failed schema validation.";
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
    if (snapshot.preview.reviewBinding) {
      const scope = snapshot.preview.reviewBinding;
      const content = structuredClone(snapshot.preview);
      delete content.reviewBinding;
      snapshot.preview.reviewBinding = createReportPreviewReviewBinding(content, scope);
    }
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
      summary: truncateXmlSafeText(`Imported history (unverified): ${change.summary}`, 500),
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
      summary: truncateXmlSafeText(`Imported history (unverified): ${change.summary}`, 500),
    }));
  });
  sanitized.timelineEvents.forEach((event) => {
    if (event.certainty === "confirmed") event.certainty = "reported";
    event.changeHistory = event.changeHistory.map((change) => ({
      ...change,
      author: "system",
      origin: "system",
      summary: truncateXmlSafeText(`Imported history (unverified): ${change.summary}`, 500),
    }));
  });
  sanitized.branches.forEach((branch) => {
    branch.changeHistory = branch.changeHistory.map((change) => ({
      ...change,
      author: "system",
      origin: "system",
      summary: truncateXmlSafeText(`Imported history (unverified): ${change.summary}`, 500),
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
  sanitized.completenessAttestations.forEach((attestation) => {
    attestation.humanAttestationTrusted = false;
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
      summary: truncateXmlSafeText(`Imported history (unverified): ${activity.summary}`, 500),
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
      "Imported an unsigned structured case export. Human confirmations, completeness records, answers, reviewed notes, and finalized snapshots require fresh local review.",
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
  if (source.schemaVersion !== 1 && source.schemaVersion !== REPLAY_SCHEMA_VERSION) return input;
  const migrated = structuredClone(source);
  if (source.schemaVersion === 1) {
    migrated.schemaVersion = REPLAY_SCHEMA_VERSION;
    migrated.proposals = [];
    if (Array.isArray(migrated.evidence)) {
      migrated.evidence = migrated.evidence.map((asset: unknown): unknown =>
        typeof asset === "object" && asset !== null
          ? { ...(asset as Record<string, unknown>), annotationLinks: [] }
          : asset,
      );
    }
  }
  if (source.schemaVersion === 1 && Array.isArray(migrated.reportSnapshots)) {
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
  if (!("completenessAttestations" in migrated)) migrated.completenessAttestations = [];
  return migrated;
}

export function prepareReplayCaseImport(
  input: unknown,
  options: ImportReplayCaseOptions = {},
): PreparedReplayCaseImport {
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
    throw new ReplayImportError(schemaImportErrorMessage(error));
  }
  const trustResetSummary = options.trustHumanAttestations
    ? {
        confirmedClaims: 0,
        confirmedDamageMarkers: 0,
        confirmedTimelineEvents: 0,
        answeredQuestions: 0,
        evidenceFilesUnavailable: 0,
        reviewedReportNotes: 0,
        completenessAttestations: 0,
        finalizedSnapshots: 0,
        proposalRevisions: 0,
        proposalDecisions: 0,
      }
    : importTrustResetSummary(parsed);
  if (!options.trustHumanAttestations) {
    parsed = resetUntrustedImportAttestations(parsed, options.now ?? new Date().toISOString());
  }
  if (options.rekeyCaseId) parsed = rekeyImportedCase(parsed, options.rekeyCaseId);
  const referenceIssues = validateCaseReferences(parsed);
  if (referenceIssues.length > 0) {
    throw new ReplayImportError("Case import contains invalid object references", referenceIssues);
  }
  parsed.consistencyIssues = validateConsistency(parsed);
  return { replayCase: parseReplayCase(parsed), trustResetSummary };
}

export function importReplayCase(
  input: unknown,
  options: ImportReplayCaseOptions = {},
): ReplayCase {
  return prepareReplayCaseImport(input, options).replayCase;
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
