import { describe, expect, it } from "vitest";

import {
  createDemoCase,
  diffProposalTrajectory,
  resolveProposalReviewRequest,
} from "../../src/domain";
import type { AgentProposalTrajectoryChange } from "../../src/domain";

function trajectoryChange(): AgentProposalTrajectoryChange {
  const replayCase = createDemoCase();
  const trajectory = replayCase.trajectories.find(
    (candidate) => candidate.id === "trajectory-a-baseline",
  );
  const actor = replayCase.actors.find((candidate) => candidate.id === "actor-vehicle-a");
  if (!trajectory || !actor) throw new Error("The demo proposal fixture is incomplete.");
  return {
    id: "proposal-change-review",
    kind: "trajectory-set",
    actorId: actor.id,
    branchId: trajectory.branchId,
    trajectoryId: trajectory.id,
    createsTrajectory: false,
    baseActorPose: structuredClone(actor.pose),
    baseTrajectory: {
      keyframes: structuredClone(trajectory.keyframes),
      visible: trajectory.visible,
    },
    proposedTrajectory: {
      keyframes: structuredClone(trajectory.keyframes),
      visible: trajectory.visible,
    },
  };
}

describe("proposal trajectory review diff", () => {
  it("reports only stable-ID keyframe edits in calibrated metres", () => {
    const replayCase = createDemoCase();
    const change = trajectoryChange();
    const keyframe = change.proposedTrajectory.keyframes[7];
    if (!keyframe) throw new Error("The demo path needs an interior review keyframe.");
    keyframe.x += 0.2;
    keyframe.y -= 0.2;
    keyframe.rotationDeg = 359;
    const baseKeyframe = change.baseTrajectory?.keyframes[7];
    if (!baseKeyframe) throw new Error("The demo path needs a matching baseline keyframe.");
    baseKeyframe.rotationDeg = 1;

    const diff = diffProposalTrajectory(change, replayCase.environment);

    expect(diff).toMatchObject({ visibilityChanged: false, endpointsPreserved: true });
    expect(diff.keyframeDeltas).toHaveLength(1);
    expect(diff.keyframeDeltas[0]).toMatchObject({
      keyframeId: keyframe.id,
      kind: "modified",
      reviewTimeMs: keyframe.timeMs,
      deltaRotationDeg: -2,
    });
    expect(diff.keyframeDeltas[0]?.deltaXMeters).toBeCloseTo(0.2, 10);
    expect(diff.keyframeDeltas[0]?.deltaYMeters).toBeCloseTo(-0.14, 10);

    baseKeyframe.rotationDeg = 1_000_001;
    keyframe.rotationDeg = -1_000_001;
    expect(
      diffProposalTrajectory(change, replayCase.environment).keyframeDeltas[0]?.deltaRotationDeg,
    ).toBe(158);
  });

  it("matches by ID and distinguishes added, removed, timing, and visibility changes", () => {
    const replayCase = createDemoCase();
    const change = trajectoryChange();
    const removed = change.proposedTrajectory.keyframes.splice(2, 1)[0];
    const timed = change.proposedTrajectory.keyframes[3];
    if (!removed || !timed) throw new Error("The demo path needs review keyframes.");
    timed.timeMs += 125;
    change.proposedTrajectory.keyframes.push({
      id: "keyframe-added-review",
      actorId: change.actorId,
      timeMs: 19_500,
      x: 80,
      y: 55,
      rotationDeg: 12,
    });
    change.proposedTrajectory.keyframes.sort((left, right) => left.timeMs - right.timeMs);
    change.proposedTrajectory.visible = !change.proposedTrajectory.visible;

    const diff = diffProposalTrajectory(change, replayCase.environment);

    expect(diff.visibilityChanged).toBe(true);
    expect(diff.keyframeDeltas.map(({ keyframeId, kind }) => ({ keyframeId, kind }))).toEqual(
      expect.arrayContaining([
        { keyframeId: timed.id, kind: "modified" },
        { keyframeId: "keyframe-added-review", kind: "added" },
        { keyframeId: removed.id, kind: "removed" },
      ]),
    );
    expect(diff.keyframeDeltas.map((delta) => delta.reviewTimeMs)).toEqual(
      [...diff.keyframeDeltas]
        .sort((left, right) => left.reviewTimeMs - right.reviewTimeMs)
        .map((delta) => delta.reviewTimeMs),
    );
  });

  it("uses independent axis calibration for arbitrary finite scene bounds", () => {
    const replayCase = createDemoCase();
    replayCase.environment.bounds = { minX: -50, minY: 10, maxX: 150, maxY: 60 };
    replayCase.environment.calibration.widthMeters = 100;
    replayCase.environment.calibration.heightMeters = 200;
    const change = trajectoryChange();
    const keyframe = change.proposedTrajectory.keyframes[6];
    if (!keyframe) throw new Error("The demo path needs an interior review keyframe.");
    keyframe.x += 20;
    keyframe.y += 5;

    const delta = diffProposalTrajectory(change, replayCase.environment).keyframeDeltas[0];

    expect(delta?.deltaXMeters).toBeCloseTo(10, 10);
    expect(delta?.deltaYMeters).toBeCloseTo(20, 10);
  });
});

describe("proposal review target resolution", () => {
  const request = {
    proposalId: "proposal-review",
    revisionId: "revision-review",
    changeId: "change-review",
    branchId: "branch-alternative",
    proposalTimeMs: 8_000.5,
    keyframeId: "keyframe-review",
  } as const;

  it("blocks review until the proposal hypothesis is canonically active", () => {
    expect(
      resolveProposalReviewRequest(request, {
        activeBranchId: "branch-baseline",
        timeRangeMs: { start: 0, end: 14_000 },
      }),
    ).toEqual({
      ok: false,
      code: "BRANCH_MISMATCH",
      activeBranchId: "branch-baseline",
      proposalBranchId: "branch-alternative",
    });
  });

  it("uses the playhead's rounded and clamped millisecond semantics", () => {
    expect(
      resolveProposalReviewRequest(request, {
        activeBranchId: "branch-alternative",
        timeRangeMs: { start: 0, end: 14_000 },
      }),
    ).toMatchObject({
      ok: true,
      target: {
        proposalTimeMs: 8_000.5,
        reviewTimeMs: 8_001,
      },
    });

    expect(
      resolveProposalReviewRequest(
        { ...request, proposalTimeMs: 20_000.25 },
        {
          activeBranchId: "branch-alternative",
          timeRangeMs: { start: 0, end: 14_000 },
        },
      ),
    ).toMatchObject({
      ok: true,
      target: {
        proposalTimeMs: 20_000.25,
        reviewTimeMs: 14_000,
      },
    });
  });
});
