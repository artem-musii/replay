import type { AgentProposal, ReplayCase } from "./models";

export type ProposalDecisionTrust = "local-human-attested" | "unverified-import";

export interface AcceptedProposalGeometryTrust {
  actorIds: ReadonlyMap<string, ProposalDecisionTrust>;
  trajectoryIds: ReadonlyMap<string, ProposalDecisionTrust>;
}

export function getProposalDecisionTrust(
  proposal: AgentProposal,
): ProposalDecisionTrust | undefined {
  if (!proposal.decision) return undefined;
  const reviewedRevision = proposal.revisions.find(
    (revision) => revision.id === proposal.decision?.revisionId,
  );
  return reviewedRevision?.authorshipTrusted && proposal.decision.humanAttestationTrusted
    ? "local-human-attested"
    : "unverified-import";
}

function recordGeometryTrust(
  trustById: Map<string, ProposalDecisionTrust>,
  id: string,
  trust: ProposalDecisionTrust,
): void {
  // If ambiguous records share a timestamp, preserve the more cautious classification.
  if (trust === "unverified-import" || !trustById.has(id)) trustById.set(id, trust);
}

export function getAcceptedProposalGeometryTrust(
  replayCase: ReplayCase,
): AcceptedProposalGeometryTrust {
  const actorIds = new Map<string, ProposalDecisionTrust>();
  const trajectoryIds = new Map<string, ProposalDecisionTrust>();

  for (const proposal of replayCase.proposals) {
    if (proposal.status !== "accepted" || proposal.decision?.outcome !== "accepted") {
      continue;
    }
    const revision = proposal.revisions.find(
      (candidate) => candidate.id === proposal.decision?.revisionId,
    );
    if (!revision) continue;
    const trust = getProposalDecisionTrust(proposal);
    if (!trust) continue;

    for (const change of revision.changes) {
      const actor = replayCase.actors.find((candidate) => candidate.id === change.actorId);
      if (actor?.lastEditedAt === proposal.decision.decidedAt) {
        recordGeometryTrust(actorIds, actor.id, trust);
      }

      const trajectoryIdsForChange = new Set<string>();
      if (change.kind === "trajectory-set") {
        trajectoryIdsForChange.add(change.trajectoryId);
      } else {
        if (change.baseTrajectory) {
          trajectoryIdsForChange.add(change.baseTrajectory.trajectoryId);
        }
        for (const trajectory of replayCase.trajectories) {
          if (trajectory.actorId === change.actorId && trajectory.branchId === change.branchId) {
            trajectoryIdsForChange.add(trajectory.id);
          }
        }
      }

      for (const trajectoryId of trajectoryIdsForChange) {
        const trajectory = replayCase.trajectories.find(
          (candidate) => candidate.id === trajectoryId,
        );
        if (trajectory?.changeHistory.at(-1)?.createdAt === proposal.decision.decidedAt) {
          recordGeometryTrust(trajectoryIds, trajectory.id, trust);
        }
      }
    }
  }

  return { actorIds, trajectoryIds };
}
