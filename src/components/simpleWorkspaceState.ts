import type { AgentProposal, ReplayCase } from "../domain";

export type SimpleStage = "review" | "decide" | "report";

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function isProposalStale(replayCase: ReplayCase, proposal: AgentProposal): boolean {
  const revision = proposal.revisions.at(-1);
  if (!revision) return true;
  return revision.changes.some((change) => {
    const actor = replayCase.actors.find((candidate) => candidate.id === change.actorId);
    if (!actor) return true;
    if (change.kind === "trajectory-set") {
      const current = replayCase.trajectories.find(
        (candidate) =>
          candidate.id === change.trajectoryId && candidate.branchId === change.branchId,
      );
      if (change.createsTrajectory) return current !== undefined;
      if (!current || !change.baseTrajectory) return true;
      return (
        current.visible !== change.baseTrajectory.visible ||
        !sameValue(current.keyframes, change.baseTrajectory.keyframes)
      );
    }
    if (!sameValue(actor.pose, change.basePose)) return true;
    if (!change.baseTrajectory) {
      return replayCase.trajectories.some(
        (candidate) =>
          candidate.actorId === change.actorId && candidate.branchId === change.branchId,
      );
    }
    const current = replayCase.trajectories.find(
      (candidate) => candidate.id === change.baseTrajectory?.trajectoryId,
    );
    if (!current) return true;
    return (
      current.visible !== change.baseTrajectory.visible ||
      !sameValue(current.keyframes, change.baseTrajectory.keyframes)
    );
  });
}

export function simpleStageForCase(replayCase: ReplayCase): SimpleStage {
  if (replayCase.proposals.some((proposal) => proposal.status === "pending")) return "decide";
  if (
    replayCase.proposals.some((proposal) => proposal.decision) ||
    replayCase.reportSnapshots.length > 0
  )
    return "report";
  return "review";
}
