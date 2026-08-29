/* eslint-disable @typescript-eslint/no-non-null-assertion -- fixture objects are asserted by these focused tests */
import { describe, expect, it } from "vitest";

import {
  createDemoCase,
  editableKeyframeTimeBounds,
  getActorPoseAtTime,
  initialTrajectoryTimes,
  interpolateTrajectory,
  quantizeEditableTimeMs,
  quantizeTimeMs,
  quantizeTimeInRange,
  sceneDeltaForCompassHeading,
  sceneDeltaForMetricHeading,
  sampleTrajectory,
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

  it("uses tenths-of-a-second editing while preserving close imported keyframes", () => {
    expect(quantizeTimeMs(8_337)).toBe(8_300);
    expect(quantizeTimeMs(8_337, 50)).toBe(8_350);
    expect(quantizeTimeInRange(89, { start: 50, end: 90 })).toBe(89);
    expect(editableKeyframeTimeBounds(6_000, 10_000, { start: 0, end: 20_000 })).toEqual({
      min: 6_100,
      max: 9_900,
    });
    expect(editableKeyframeTimeBounds(0, 100, { start: 0, end: 20_000 })).toEqual({
      min: 1,
      max: 99,
    });
    expect(quantizeEditableTimeMs(25, { min: 1, max: 49 }, { start: 0, end: 20_000 })).toBe(25);
  });

  it("converts compass headings through the scene's non-square coordinate scale", () => {
    const delta = sceneDeltaForCompassHeading(45, 96);
    const renderedHeading = ((Math.atan2(delta.x * 10, -delta.y * 7) * 180) / Math.PI + 360) % 360;
    expect(renderedHeading).toBeCloseTo(45, 8);
    expect(Math.hypot(delta.x * 10, delta.y * 7)).toBeCloseTo(96, 8);
  });

  it("converts a real-metre heading through the case calibration", () => {
    const delta = sceneDeltaForMetricHeading(45, 10, {
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      calibration: {
        widthMeters: 100,
        heightMeters: 70,
        source: "measured",
        uncertaintyMeters: 0.2,
      },
    });
    expect((delta.x / 100) * 100).toBeCloseTo(Math.SQRT1_2 * 10, 8);
    expect((-delta.y / 100) * 70).toBeCloseTo(Math.SQRT1_2 * 10, 8);
  });

  it("uses a smooth time-aware curve for three or more poses and exposes the same render samples", () => {
    const turning: Trajectory = {
      ...trajectory,
      interpolationMode: "smooth",
      keyframes: [
        { id: "turn-1", actorId: "actor-test", timeMs: 0, x: 0, y: 0, rotationDeg: 90 },
        { id: "turn-2", actorId: "actor-test", timeMs: 1_000, x: 10, y: 0, rotationDeg: 135 },
        { id: "turn-3", actorId: "actor-test", timeMs: 2_000, x: 10, y: 10, rotationDeg: 180 },
      ],
    };
    const beforeCorner = interpolateTrajectory(turning, 500);
    const afterCorner = interpolateTrajectory(turning, 1_500);
    expect(beforeCorner.y).toBeLessThan(0);
    expect(afterCorner.x).toBeGreaterThan(10);
    const samples = sampleTrajectory(turning, 4);
    expect(samples).toHaveLength(9);
    expect(samples[4]).toEqual(interpolateTrajectory(turning, 1_000));
  });

  it("keeps the roundabout opening hold stationary before moving each vehicle forward", () => {
    const replayCase = createDemoCase();

    for (const trajectory of replayCase.trajectories) {
      const firstFrame = trajectory.keyframes[0];
      const holdFrame = trajectory.keyframes[1];
      if (!firstFrame || !holdFrame) throw new Error("Expected two opening path points");

      for (const timeMs of [500, 1_000, 1_500, 2_000, holdFrame.timeMs]) {
        expect(interpolateTrajectory(trajectory, timeMs)).toMatchObject({
          x: firstFrame.x,
          y: firstFrame.y,
        });
      }

      const afterHold = interpolateTrajectory(trajectory, holdFrame.timeMs + 100);
      const headingRadians = (holdFrame.rotationDeg * Math.PI) / 180;
      const sceneWidth = replayCase.environment.bounds.maxX - replayCase.environment.bounds.minX;
      const sceneHeight = replayCase.environment.bounds.maxY - replayCase.environment.bounds.minY;
      const deltaMeters = {
        x:
          ((afterHold.x - holdFrame.x) * replayCase.environment.calibration.widthMeters) /
          sceneWidth,
        y:
          ((afterHold.y - holdFrame.y) * replayCase.environment.calibration.heightMeters) /
          sceneHeight,
      };
      const forwardProgressMeters =
        deltaMeters.x * Math.sin(headingRadians) - deltaMeters.y * Math.cos(headingRadians);

      expect(forwardProgressMeters).toBeGreaterThan(0);
    }
  });

  it("keeps explicitly linear trajectories on each keyframe chord without curve overshoot", () => {
    const turning: Trajectory = {
      ...trajectory,
      interpolationMode: "linear",
      keyframes: [
        { id: "turn-1", actorId: "actor-test", timeMs: 0, x: 0, y: 0, rotationDeg: 90 },
        { id: "turn-2", actorId: "actor-test", timeMs: 1_000, x: 10, y: 0, rotationDeg: 135 },
        { id: "turn-3", actorId: "actor-test", timeMs: 2_000, x: 10, y: 10, rotationDeg: 180 },
      ],
    };

    expect(interpolateTrajectory(turning, 500)).toEqual({
      x: 5,
      y: 0,
      rotationDeg: 112.5,
    });
    expect(interpolateTrajectory(turning, 1_500)).toEqual({
      x: 10,
      y: 5,
      rotationDeg: 157.5,
    });
  });

  it("keeps newly-created two-point spans inside short and offset case ranges", () => {
    expect(initialTrajectoryTimes(10_300, { start: 10_000, end: 10_500 })).toEqual({
      start: 10_000,
      end: 10_500,
    });
    expect(initialTrajectoryTimes(0, { start: 0, end: 500 })).toEqual({
      start: 0,
      end: 500,
    });
  });

  it("reads the active branch pose at an incident-relative time", () => {
    const replayCase = createDemoCase();
    expect(getActorPoseAtTime(replayCase, "actor-vehicle-a", 10_000)).toMatchObject({
      x: 65,
      y: 62,
      rotationDeg: 62,
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

  it("distinguishes the visible road template from the surrounding scene", () => {
    const roundabout = createDemoCase();
    roundabout.actors[0]!.pose = { x: 10, y: 10, rotationDeg: 0 };
    roundabout.actors[1]!.pose = { x: 50, y: 50, rotationDeg: 0 };

    const issues = validateConsistency(roundabout, { scope: "geometry" });
    const affected = issues
      .filter((issue) => issue.ruleId === "geometry.actor-outside-scene")
      .flatMap((issue) => issue.affectedIds);
    expect(affected).toContain(roundabout.actors[0]!.id);
    expect(affected).toContain(roundabout.actors[1]!.id);
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
