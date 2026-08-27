import { validateConsistency } from "./consistency";
import type { HypothesisBranch, HypothesisComparison, ReplayCase, Trajectory } from "./models";

function requireBranch(replayCase: ReplayCase, branchId: string): HypothesisBranch {
  const branch = replayCase.branches.find((candidate) => candidate.id === branchId);
  if (!branch) throw new Error(`Hypothesis branch ${branchId} does not exist`);
  return branch;
}

function trajectoriesByActor(
  replayCase: ReplayCase,
  branch: HypothesisBranch,
): Map<string, Trajectory> {
  return new Map(
    replayCase.trajectories
      .filter((trajectory) => branch.trajectoryIds.includes(trajectory.id))
      .map((trajectory) => [trajectory.actorId, trajectory]),
  );
}

function trajectoryFingerprint(trajectory: Trajectory | undefined): string {
  if (!trajectory) return "missing";
  return JSON.stringify(
    trajectory.keyframes.map((keyframe) => [
      keyframe.timeMs,
      keyframe.x,
      keyframe.y,
      keyframe.rotationDeg,
    ]),
  );
}

function eventKey(event: ReplayCase["timelineEvents"][number]): string {
  return `${event.type}|${event.title}|${[...event.linkedActorIds].sort().join(",")}`;
}

function eventFingerprint(event: ReplayCase["timelineEvents"][number] | undefined): string {
  if (!event) return "missing";
  return JSON.stringify({
    timeMs: event.timeMs,
    location: event.location,
    linkedClaimIds: [...event.linkedClaimIds].sort(),
    linkedEvidenceIds: [...event.linkedEvidenceIds].sort(),
  });
}

/** Compares two branches without ranking either as true, correct, or at fault. */
export function compareHypotheses(
  replayCase: ReplayCase,
  firstBranchId: string,
  secondBranchId: string,
): HypothesisComparison {
  if (firstBranchId === secondBranchId) throw new Error("Choose two different hypothesis branches");
  const first = requireBranch(replayCase, firstBranchId);
  const second = requireBranch(replayCase, secondBranchId);
  const firstTrajectories = trajectoriesByActor(replayCase, first);
  const secondTrajectories = trajectoriesByActor(replayCase, second);
  const actorIds = [...new Set([...firstTrajectories.keys(), ...secondTrajectories.keys()])].sort();
  const changedTrajectoryActorIds = actorIds.filter(
    (actorId) =>
      trajectoryFingerprint(firstTrajectories.get(actorId)) !==
      trajectoryFingerprint(secondTrajectories.get(actorId)),
  );

  const firstEvents = replayCase.timelineEvents.filter((event) =>
    first.eventIds.includes(event.id),
  );
  const secondEvents = replayCase.timelineEvents.filter((event) =>
    second.eventIds.includes(event.id),
  );
  const firstByKey = new Map(firstEvents.map((event) => [eventKey(event), event]));
  const secondByKey = new Map(secondEvents.map((event) => [eventKey(event), event]));
  const changedEventIds = [...new Set([...firstByKey.keys(), ...secondByKey.keys()])]
    .sort()
    .filter(
      (key) => eventFingerprint(firstByKey.get(key)) !== eventFingerprint(secondByKey.get(key)),
    )
    .flatMap((key) =>
      [firstByKey.get(key)?.id, secondByKey.get(key)?.id].filter((value): value is string =>
        Boolean(value),
      ),
    );

  const supportingEvidenceIds: Record<string, string[]> = {};
  const conflictingEvidenceIds: Record<string, string[]> = {};
  const unresolvedQuestionIds: Record<string, string[]> = {};
  const issues: HypothesisComparison["issues"] = {};
  const summaries: Record<string, string> = {};
  for (const branch of [first, second]) {
    supportingEvidenceIds[branch.id] = [
      ...new Set(branch.assumptions.flatMap((assumption) => assumption.supportingEvidenceIds)),
    ].sort();
    conflictingEvidenceIds[branch.id] = [
      ...new Set(branch.assumptions.flatMap((assumption) => assumption.conflictingEvidenceIds)),
    ].sort();
    unresolvedQuestionIds[branch.id] = replayCase.questions
      .filter(
        (question) =>
          (question.status === "open" || question.status === "deferred") &&
          question.relatedBranchIds.includes(branch.id),
      )
      .map((question) => question.id)
      .sort();
    const branchIssues = validateConsistency(replayCase, { branchId: branch.id });
    issues[branch.id] = branchIssues;
    const conflictCount = branchIssues.filter(
      (item) => item.severity === "error" || item.severity === "warning",
    ).length;
    const assumptionCount = branch.assumptions.filter(
      (assumption) => assumption.status === "active",
    ).length;
    summaries[branch.id] =
      `${branch.name} contains ${String(conflictCount)} unresolved consistency ${conflictCount === 1 ? "conflict" : "conflicts"} ` +
      `and requires ${String(assumptionCount)} explicit ${assumptionCount === 1 ? "assumption" : "assumptions"}.`;
  }

  return {
    branchIds: [firstBranchId, secondBranchId],
    changedTrajectoryActorIds,
    changedEventIds: [...new Set(changedEventIds)].sort(),
    assumptions: {
      [first.id]: structuredClone(first.assumptions),
      [second.id]: structuredClone(second.assumptions),
    },
    supportingEvidenceIds,
    conflictingEvidenceIds,
    unresolvedQuestionIds,
    issues,
    summaries,
  };
}
