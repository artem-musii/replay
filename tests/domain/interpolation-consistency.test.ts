/* eslint-disable @typescript-eslint/no-non-null-assertion -- fixture objects are asserted by these focused tests */
import { describe, expect, it } from "vitest";

import {
  createDemoCase,
  getActorPoseAtTime,
  interpolateTrajectory,
  validateConsistency,
} from "../../src/domain";
import type { Trajectory } from "../../src/domain";

describe("trajectory interpolation", () => {
  const trajectory: Trajectory = {
    id: "trajectory-test",
    actorId: "actor-test",
    branchId: "branch-test",
    keyframes: [
      { id: "keyframe-1", actorId: "actor-test", timeMs: 1_000, x: 0, y: 0, rotationDeg: 350 },
      { id: "keyframe-2", actorId: "actor-test", timeMs: 3_000, x: 10, y: 20, rotationDeg: 10 },
    ],
    visible: true,
    locked: false,
    createdBy: "human",
    changeHistory: [],
  };

  it("clamps before and after the trajectory", () => {
    expect(interpolateTrajectory(trajectory, 0)).toEqual({ x: 0, y: 0, rotationDeg: 350 });
    expect(interpolateTrajectory(trajectory, 5_000)).toEqual({ x: 10, y: 20, rotationDeg: 10 });
  });

  it("interpolates position and takes the shortest rotation path", () => {
    expect(interpolateTrajectory(trajectory, 2_000)).toEqual({ x: 5, y: 10, rotationDeg: 0 });
  });

  it("reads the active branch pose at an incident-relative time", () => {
    const replayCase = createDemoCase();
    expect(getActorPoseAtTime(replayCase, "actor-vehicle-a", 10_000)).toMatchObject({
      x: 52,
      y: 50,
    });
  });
});

describe("deterministic consistency rules", () => {
  it("detects timeline ordering and out-of-range errors", () => {
    const replayCase = createDemoCase();
    replayCase.timelineEvents.find((event) => event.id === "event-impact")!.timeMs = 25_000;
    const issues = validateConsistency(replayCase, { scope: "timeline" });
    expect(issues.map((issue) => issue.ruleId)).toContain("timeline.event-out-of-range");
    expect(issues.map((issue) => issue.ruleId)).toContain("timeline.final-before-impact");
  });

  it("detects teleportation with a stable issue id", () => {
    const replayCase = createDemoCase();
    replayCase.trajectories[0]!.keyframes[1]!.timeMs = 1;
    replayCase.trajectories[0]!.keyframes[1]!.x = 99;
    const first = validateConsistency(replayCase, { scope: "geometry" });
    const second = validateConsistency(replayCase, { scope: "geometry" });
    expect(first).toEqual(second);
    expect(first.some((issue) => issue.ruleId === "geometry.trajectory-teleport")).toBe(true);
  });

  it("flags deleted evidence that remains cited", () => {
    const replayCase = createDemoCase();
    const evidence = replayCase.evidence.find((asset) => asset.id === "evidence-overview")!;
    evidence.deleted = true;
    evidence.deletedAt = "2026-08-27T10:00:00.000Z";
    const issues = validateConsistency(replayCase, { scope: "provenance" });
    expect(issues.some((issue) => issue.ruleId === "provenance.invalid-evidence-link")).toBe(true);
  });

  it("does not confuse informational damage hints with physical conclusions", () => {
    const replayCase = createDemoCase();
    const issues = validateConsistency(replayCase, { scope: "damage" });
    for (const issue of issues)
      expect(issue.explanation.toLowerCase()).not.toContain("determines fault");
  });
});
