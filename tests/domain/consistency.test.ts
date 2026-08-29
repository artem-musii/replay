import { describe, expect, it } from "vitest";

import {
  createBlankCase,
  createDemoCase,
  isPointOnTemplateRoad,
  motionAdvisoryThresholdsForCase,
  validateConsistency,
} from "../../src/domain";
import type { ActorKeyframe, ReplayCase, RoadSceneType, Trajectory } from "../../src/domain";

const NOW = "2026-08-28T12:00:00.000Z";

function blankCase(
  sceneType: RoadSceneType = "straight-road",
  roadCondition: ReplayCase["environment"]["roadCondition"] = "dry",
): ReplayCase {
  return createBlankCase(
    {
      title: `Consistency ${sceneType}`,
      sceneType,
      roadCondition,
      vehicleCount: 1,
    },
    { caseId: `case-${sceneType}`, now: NOW },
  );
}

function attachTrajectory(
  replayCase: ReplayCase,
  keyframes: Array<Omit<ActorKeyframe, "id" | "actorId">>,
): Trajectory {
  const actor = replayCase.actors[0];
  const branch = replayCase.branches[0];
  if (!actor || !branch) throw new Error("Test case needs an actor and branch");
  const trajectory: Trajectory = {
    id: "trajectory-test",
    actorId: actor.id,
    branchId: branch.id,
    keyframes: keyframes.map((keyframe, index) => ({
      ...keyframe,
      id: `keyframe-${String(index + 1)}`,
      actorId: actor.id,
    })),
    visible: true,
    locked: false,
    createdBy: "human",
    changeHistory: [],
  };
  replayCase.trajectories = [trajectory];
  branch.trajectoryIds = [trajectory.id];
  return trajectory;
}

function ruleIds(replayCase: ReplayCase, scope: "all" | "scene" | "geometry" | "motion") {
  return validateConsistency(replayCase, { scope }).map((item) => item.ruleId);
}

describe("calibrated deterministic consistency advisories", () => {
  it("flags legacy agent claims that overstate external provenance", () => {
    const replayCase = createDemoCase();
    const source = replayCase.claims.find((claim) => claim.id === "claim-initial-statement");
    if (!source) throw new Error("Missing seeded human statement");
    replayCase.claims.push({
      ...structuredClone(source),
      id: "claim-agent-provenance-spoof",
      statement: "An agent incorrectly labelled this as a witness account.",
      sourceType: "witness-statement",
      sourceIds: ["actor-vehicle-a"],
      createdBy: "agent",
      humanConfirmed: false,
      changeHistory: [
        {
          id: "change-agent-provenance-spoof",
          caseVersion: replayCase.caseVersion,
          author: "agent",
          origin: "webmcp",
          summary: "Created claim.",
          createdAt: NOW,
          requestId: "request-agent-provenance-spoof",
        },
      ],
    });

    const provenanceIssue = validateConsistency(replayCase, { scope: "provenance" }).find(
      (item) => item.ruleId === "provenance.agent-external-source-missing",
    );
    expect(provenanceIssue).toMatchObject({
      severity: "error",
      affectedIds: expect.arrayContaining(["claim-agent-provenance-spoof"]),
    });
    expect(provenanceIssue?.explanation).toContain("witness-statement");
  });

  it("adaptively catches a complete vehicle pass-through between 100 ms endpoints", () => {
    const replayCase = createBlankCase(
      {
        title: "Fast crossing",
        sceneType: "straight-road",
        roadCondition: "dry",
        vehicleCount: 2,
      },
      { caseId: "case-fast-crossing", now: NOW },
    );
    replayCase.timeRangeMs = { start: 0, end: 100 };
    const branch = replayCase.branches[0];
    const first = replayCase.actors[0];
    const second = replayCase.actors[1];
    if (!branch || !first || !second) throw new Error("Fast crossing needs two actors");
    first.pose = { x: 60, y: 50, rotationDeg: 90 };
    second.pose = { x: 40, y: 50, rotationDeg: 270 };
    replayCase.trajectories = [
      {
        id: "trajectory-fast-first",
        actorId: first.id,
        branchId: branch.id,
        interpolationMode: "linear",
        keyframes: [
          { id: "first-0", actorId: first.id, timeMs: 0, x: 40, y: 50, rotationDeg: 90 },
          {
            id: "first-100",
            actorId: first.id,
            timeMs: 100,
            x: 60,
            y: 50,
            rotationDeg: 90,
          },
        ],
        visible: true,
        locked: false,
        createdBy: "human",
        changeHistory: [],
      },
      {
        id: "trajectory-fast-second",
        actorId: second.id,
        branchId: branch.id,
        interpolationMode: "linear",
        keyframes: [
          {
            id: "second-0",
            actorId: second.id,
            timeMs: 0,
            x: 60,
            y: 50,
            rotationDeg: 270,
          },
          {
            id: "second-100",
            actorId: second.id,
            timeMs: 100,
            x: 40,
            y: 50,
            rotationDeg: 270,
          },
        ],
        visible: true,
        locked: false,
        createdBy: "human",
        changeHistory: [],
      },
    ];
    branch.trajectoryIds = replayCase.trajectories.map((trajectory) => trajectory.id);

    expect(ruleIds(replayCase, "geometry")).toContain("geometry.unmarked-footprint-overlap");
  });

  it("exports the exact posted-speed, road-condition, and wheelbase profile", () => {
    const replayCase = blankCase("straight-road", "wet");
    replayCase.environment.postedSpeedLimitKph = 50;
    const actor = replayCase.actors[0];
    if (!actor) throw new Error("Missing test actor");
    actor.wheelbaseMeters = 2.8;

    const thresholds = motionAdvisoryThresholdsForCase(replayCase, actor);

    expect(thresholds.maxSpeedMps).toBeCloseTo(18.75, 8);
    expect(thresholds.maxAccelerationMps2).toBe(4);
    expect(thresholds.maxDecelerationMps2).toBe(7);
    expect(thresholds.maxLateralAccelerationMps2).toBe(4);
    expect(thresholds.maxYawRateDegPerSecond).toBe(90);
    expect(thresholds.maxHeadingMismatchDeg).toBe(25);
    expect(thresholds.minTurnRadiusM).toBeCloseTo(2.8 / Math.tan((40 * Math.PI) / 180), 8);
  });

  it("uses a labelled template review default when no posted limit is established", () => {
    const replayCase = blankCase("straight-road", "dry");
    delete replayCase.environment.postedSpeedLimitKph;
    const actor = replayCase.actors[0];
    if (!actor) throw new Error("Missing test actor");
    attachTrajectory(replayCase, [
      { timeMs: 0, x: 10, y: 50, rotationDeg: 90 },
      { timeMs: 1_000, x: 50, y: 50, rotationDeg: 90 },
    ]);

    expect(motionAdvisoryThresholdsForCase(replayCase, actor).maxSpeedMps).toBeCloseTo(30, 8);
    const speedIssue = validateConsistency(replayCase, { scope: "motion" }).find(
      (issue) => issue.ruleId === "motion.speed",
    );
    expect(speedIssue?.explanation).toContain("80 km/h straight-road template default");
    expect(speedIssue?.explanation).not.toContain("posted 80 km/h limit");
  });

  it("uses the case's metre calibration for speed instead of raw scene coordinates", () => {
    const replayCase = blankCase();
    replayCase.environment.postedSpeedLimitKph = 40;
    attachTrajectory(replayCase, [
      { timeMs: 0, x: 10, y: 50, rotationDeg: 90 },
      { timeMs: 5_000, x: 60, y: 50, rotationDeg: 90 },
    ]);

    replayCase.environment.calibration.widthMeters = 100;
    expect(ruleIds(replayCase, "motion")).not.toContain("motion.speed");

    replayCase.environment.calibration.widthMeters = 200;
    const speedIssue = validateConsistency(replayCase, { scope: "motion" }).find(
      (item) => item.ruleId === "motion.speed",
    );
    expect(speedIssue?.explanation).toContain("200.0 m × 70.0 m");
    expect(speedIssue?.explanation).toContain("deterministic review advisory");
    expect(speedIssue?.explanation).toContain("not a forensic finding");
  });

  it("uses oriented dimensions for impact contact and reports exact footprint gaps", () => {
    const replayCase = createDemoCase();
    expect(ruleIds(replayCase, "geometry")).not.toContain("geometry.impact-separation");

    const movedKeyframe = replayCase.trajectories
      .find((trajectory) => trajectory.actorId === "actor-vehicle-b")
      ?.keyframes.find((keyframe) => keyframe.timeMs === 10_000);
    if (!movedKeyframe) throw new Error("Missing impact keyframe");
    movedKeyframe.x += 12;

    const issue = validateConsistency(replayCase, { scope: "geometry" }).find(
      (item) => item.ruleId === "geometry.impact-separation",
    );
    expect(issue?.title).toContain("footprints");
    expect(issue?.explanation).toContain("oriented vehicle footprints");
    expect(issue?.explanation).toMatch(/\d+\.\d{2} m gap/);
    expect(issue?.explanation).toContain("not a forensic conclusion");
  });

  it.each<{
    sceneType: RoadSceneType;
    pose: { x: number; y: number; rotationDeg: number };
  }>([
    { sceneType: "roundabout", pose: { x: 20, y: 37.7, rotationDeg: 90 } },
    { sceneType: "intersection", pose: { x: 20, y: 35.5, rotationDeg: 90 } },
    { sceneType: "t-junction", pose: { x: 20, y: 26.5, rotationDeg: 90 } },
    { sceneType: "straight-road", pose: { x: 20, y: 35.5, rotationDeg: 90 } },
    { sceneType: "parking-area", pose: { x: 6.5, y: 50, rotationDeg: 0 } },
  ])("checks full vehicle footprints on the $sceneType template", ({ sceneType, pose }) => {
    const replayCase = blankCase(sceneType);
    const actor = replayCase.actors[0];
    if (!actor) throw new Error("Missing test actor");
    actor.pose = pose;

    expect(isPointOnTemplateRoad(sceneType, pose)).toBe(true);
    const footprintIssue = validateConsistency(replayCase, { scope: "geometry" }).find(
      (item) => item.ruleId === "geometry.actor-outside-scene",
    );
    expect(footprintIssue?.affectedIds).toContain(actor.id);
    expect(footprintIssue?.explanation).toContain("full");
    expect(footprintIssue?.explanation).toContain("oriented footprint");
  });

  it("sweeps the full footprint between valid roundabout keyframes", () => {
    const replayCase = blankCase("roundabout");
    attachTrajectory(replayCase, [
      { timeMs: 0, x: 28, y: 50, rotationDeg: 90 },
      { timeMs: 5_000, x: 72, y: 50, rotationDeg: 90 },
    ]);

    const issues = validateConsistency(replayCase, { scope: "geometry" });
    expect(issues.map((item) => item.ruleId)).not.toContain("geometry.keyframe-outside-scene");
    const sweptIssue = issues.find(
      (item) => item.ruleId === "geometry.trajectory-footprint-off-road",
    );
    expect(sweptIssue?.explanation).toContain("interpolated full footprint");
    expect(sweptIssue?.explanation).toContain("not forensic truth");
  });

  it("surfaces every deterministic motion metric as review advice across scopes", () => {
    const replayCase = blankCase();
    replayCase.environment.postedSpeedLimitKph = 15;
    attachTrajectory(replayCase, [
      { timeMs: 0, x: 10, y: 50, rotationDeg: 90 },
      { timeMs: 1_000, x: 10.5, y: 50, rotationDeg: 90 },
      { timeMs: 1_100, x: 11.5, y: 50, rotationDeg: 270 },
      { timeMs: 1_200, x: 11.51, y: 50, rotationDeg: 270 },
    ]);

    const expected = [
      "motion.speed",
      "motion.acceleration",
      "motion.deceleration",
      "motion.yaw-rate",
      "motion.heading-mismatch",
      "motion.turn-radius",
      "motion.lateral-acceleration",
    ];
    const motion = validateConsistency(replayCase, { scope: "motion" });
    expect(new Set(motion.map((item) => item.ruleId))).toEqual(new Set(expected));
    for (const item of motion) {
      expect(item.scope).toBe("motion");
      expect(item.severity).toBe("warning");
      expect(item.explanation).toContain("deterministic review advisory");
      expect(item.explanation).toContain("not a forensic finding");
    }

    expect(ruleIds(replayCase, "scene")).toEqual(expect.arrayContaining(expected));
    expect(ruleIds(replayCase, "all")).toEqual(expect.arrayContaining(expected));
    expect(ruleIds(replayCase, "geometry")).not.toEqual(expect.arrayContaining(expected));
  });
});
