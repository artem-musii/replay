import { describe, expect, it } from "vitest";

import { createDemoCase } from "../../src/domain/seed";
import type { Trajectory } from "../../src/domain/models";
import {
  analyzeBranchMotion,
  analyzeTrajectoryMotion,
  analyzeVehicleFootprintRelation,
  createOrientedVehicleFootprint,
  createSceneMetricCalibration,
  normalizedSceneDistanceMeters,
  normalizedScenePointToMeters,
} from "../../src/domain/physics";

function trajectory(
  points: Array<[timeMs: number, x: number, y: number, rotationDeg: number]>,
): Trajectory {
  return {
    id: "trajectory-physics-test",
    actorId: "actor-physics-test",
    branchId: "branch-physics-test",
    keyframes: points.map(([timeMs, x, y, rotationDeg], index) => ({
      id: `keyframe-${String(index + 1)}`,
      actorId: "actor-physics-test",
      timeMs,
      x,
      y,
      rotationDeg,
    })),
    visible: true,
    locked: false,
    createdBy: "human",
    changeHistory: [],
  };
}

describe("metric scene calibration", () => {
  it("uses the 100 m by 70 m fallback without clamping evidence", () => {
    expect(normalizedScenePointToMeters({ x: 50, y: 50 })).toEqual({ xM: 50, yM: 35 });
    expect(normalizedScenePointToMeters({ x: 120, y: -10 })).toEqual({ xM: 120, yM: -7 });
    expect(normalizedSceneDistanceMeters({ x: 0, y: 0 }, { x: 100, y: 100 })).toBeCloseTo(
      Math.hypot(100, 70),
      10,
    );
  });

  it("supports measured metric extents and alternate normalized bounds", () => {
    const calibration = createSceneMetricCalibration({
      sceneBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      widthMeters: 20,
      heightMeters: 10,
    });
    expect(normalizedScenePointToMeters({ x: 0.25, y: 0.8 }, calibration)).toEqual({
      xM: 5,
      yM: 8,
    });
  });

  it("rejects invalid calibration instead of silently inventing scale", () => {
    expect(() =>
      createSceneMetricCalibration({
        sceneBounds: { minX: 1, minY: 0, maxX: 1, maxY: 100 },
      }),
    ).toThrow(/positive area/i);
    expect(() => createSceneMetricCalibration({ widthMeters: 0 })).toThrow(/positive/i);
  });
});

describe("oriented vehicle footprints", () => {
  it("builds dimension-aware corners in compass-heading order", () => {
    const footprint = createOrientedVehicleFootprint(
      { x: 50, y: 50, rotationDeg: 0 },
      { width: 2, length: 4 },
    );
    expect(footprint.center).toEqual({ xM: 50, yM: 35 });
    expect(footprint.corners).toEqual([
      { xM: 49, yM: 33 },
      { xM: 51, yM: 33 },
      { xM: 51, yM: 37 },
      { xM: 49, yM: 37 },
    ]);
  });

  it("reports exact clearance for separated, rotated-size-aware rectangles", () => {
    const relation = analyzeVehicleFootprintRelation(
      {
        pose: { x: 0, y: 50, rotationDeg: 90 },
        dimensions: { width: 2, length: 4 },
      },
      {
        pose: { x: 10, y: 50, rotationDeg: 90 },
        dimensions: { width: 2, length: 4 },
      },
    );
    expect(relation.overlaps).toBe(false);
    expect(relation.separationM).toBeCloseTo(6, 10);
    expect(relation.penetrationDepthM).toBe(0);
  });

  it("recognizes the seeded impact as boundary contact without rigid-body penetration", () => {
    const replayCase = createDemoCase();
    const first = replayCase.actors.find((actor) => actor.id === "actor-vehicle-a");
    const second = replayCase.actors.find((actor) => actor.id === "actor-vehicle-b");
    if (!first || !second) throw new Error("Expected seeded vehicles");
    const firstPose = replayCase.trajectories
      .find((candidate) => candidate.actorId === first.id)
      ?.keyframes.find((frame) => frame.timeMs === 10_000);
    const secondPose = replayCase.trajectories
      .find((candidate) => candidate.actorId === second.id)
      ?.keyframes.find((frame) => frame.timeMs === 10_000);
    if (!firstPose || !secondPose) throw new Error("Expected seeded impact poses");

    const relation = analyzeVehicleFootprintRelation(
      { pose: firstPose, dimensions: first.dimensions },
      { pose: secondPose, dimensions: second.dimensions },
    );
    expect(relation.centerDistanceM).toBeGreaterThan(
      (first.dimensions.width + second.dimensions.width) / 2,
    );
    expect(relation.overlaps).toBe(true);
    expect(relation.separationM).toBe(0);
    expect(relation.penetrationDepthM).toBeCloseTo(0, 8);
  });
});

describe("trajectory motion metrics", () => {
  it("derives speed, acceleration, yaw, heading mismatch, radius, and lateral acceleration", () => {
    const analysis = analyzeTrajectoryMotion(
      trajectory([
        [0, 0, 50, 90],
        [1_000, 10, 50, 90],
        [2_000, 30, 50, 120],
      ]),
    );

    expect(analysis.segments).toHaveLength(2);
    expect(analysis.segments[0]).toMatchObject({
      distanceM: 10,
      speedMps: 10,
      accelerationMps2: null,
      pathHeadingDeg: 90,
      headingDeltaDeg: 0,
      yawRateDegPerSecond: 0,
      headingMismatchDeg: 0,
      turnRadiusM: null,
      lateralAccelerationMps2: null,
    });
    expect(analysis.segments[1]?.speedMps).toBeCloseTo(20, 10);
    expect(analysis.segments[1]?.accelerationMps2).toBeCloseTo(10, 10);
    expect(analysis.segments[1]?.yawRateDegPerSecond).toBeCloseTo(30, 10);
    expect(analysis.segments[1]?.headingMismatchDeg).toBeCloseTo(15, 10);
    expect(analysis.segments[1]?.turnRadiusM).toBeCloseTo(38.637, 3);
    expect(analysis.segments[1]?.lateralAccelerationMps2).toBeCloseTo(10.353, 3);
  });

  it("emits only caller-profile advisories and preserves observed values", () => {
    const analysis = analyzeTrajectoryMotion(
      trajectory([
        [0, 0, 50, 90],
        [1_000, 10, 50, 90],
        [2_000, 30, 50, 120],
      ]),
      {
        thresholds: {
          maxSpeedMps: 15,
          maxAccelerationMps2: 5,
          maxYawRateDegPerSecond: 20,
          maxHeadingMismatchDeg: 10,
          minTurnRadiusM: 40,
          maxLateralAccelerationMps2: 8,
        },
      },
    );

    expect(analysis.advisories.map((advisory) => advisory.code)).toEqual([
      "motion.speed",
      "motion.acceleration",
      "motion.yaw-rate",
      "motion.heading-mismatch",
      "motion.turn-radius",
      "motion.lateral-acceleration",
    ]);
    expect(analysis.advisories[0]).toMatchObject({
      segmentIndex: 1,
      observed: 20,
      threshold: 15,
      unit: "m/s",
    });
    expect(
      analyzeTrajectoryMotion(
        trajectory([
          [0, 0, 50, 90],
          [1_000, 10, 50, 90],
        ]),
      ).advisories,
    ).toEqual([]);
  });
});

describe("compact branch motion analysis", () => {
  it("uses the case's measured metric extents unless the caller overrides them", () => {
    const replayCase = createDemoCase();
    replayCase.environment.calibration = {
      widthMeters: 120,
      heightMeters: 49,
      source: "measured",
      uncertaintyMeters: 0.25,
    };

    expect(analyzeBranchMotion(replayCase, "branch-baseline").calibration).toMatchObject({
      widthMeters: 120,
      heightMeters: 49,
    });
  });

  it("summarizes branch motion and size-aware impact pairs deterministically", () => {
    const analysis = analyzeBranchMotion(createDemoCase(), "branch-baseline", {
      thresholds: { maxHeadingMismatchDeg: 20 },
    });

    expect(analysis.calibration).toEqual({
      sceneBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      widthMeters: 100,
      heightMeters: 70,
    });
    expect(analysis.totals).toMatchObject({
      trajectoryCount: 2,
      segmentCount: 24,
      impactPairCount: 1,
      overlappingImpactPairCount: 1,
    });
    expect(analysis.trajectories.map((item) => item.actorId)).toEqual([
      "actor-vehicle-a",
      "actor-vehicle-b",
    ]);
    expect(analysis.advisories).toEqual([]);
    expect(analysis.impactFootprints[0]).toMatchObject({
      eventId: "event-impact",
      timeMs: 10_000,
      actorIds: ["actor-vehicle-a", "actor-vehicle-b"],
      overlaps: true,
      separationM: 0,
    });
    expect(analysis.impactFootprints[0]?.penetrationDepthM).toBeCloseTo(0, 8);
  });

  it("rejects an unknown branch", () => {
    expect(() => analyzeBranchMotion(createDemoCase(), "branch-missing")).toThrow(
      /unknown branch/i,
    );
  });
});
