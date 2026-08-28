import { describe, expect, it } from "vitest";

import {
  createDemoScenario,
  DEMO_SCENARIO_IDS,
  DEMO_SCENARIO_METADATA,
  isDemoScenarioId,
  type DemoScenarioId,
} from "../../src/domain/demoScenarios";
import {
  analyzeVehicleFootprintRelation,
  createSceneMetricCalibration,
} from "../../src/domain/physics";
import { getActorPoseAtTime } from "../../src/domain/interpolation";
import { validateCaseReferences } from "../../src/domain/importExport";
import { containsLiabilityConclusion } from "../../src/domain/languageSafety";
import type { ReplayCase } from "../../src/domain/models";
import { ReplayCaseSchema } from "../../src/domain/schema";
import { createDemoCase } from "../../src/domain/seed";
import { validateConsistency } from "../../src/domain/consistency";

const NEW_SCENARIO_IDS = [
  "straight-road-rear-end",
  "t-junction-crossing",
  "parking-account-contradiction",
] as const;

const CLEAN_SCENARIO_IDS = [
  "roundabout-calibrated",
  "straight-road-rear-end",
  "t-junction-crossing",
] as const;

function linkedImpactRelation(replayCase: ReplayCase, timeMs: number) {
  const impact = replayCase.timelineEvents.find(
    (event) => event.branchId === replayCase.activeBranchId && event.type === "impact",
  );
  const first = replayCase.actors.find((actor) => actor.id === impact?.linkedActorIds[0]);
  const second = replayCase.actors.find((actor) => actor.id === impact?.linkedActorIds[1]);
  const firstPose = first
    ? getActorPoseAtTime(replayCase, first.id, timeMs, replayCase.activeBranchId)
    : undefined;
  const secondPose = second
    ? getActorPoseAtTime(replayCase, second.id, timeMs, replayCase.activeBranchId)
    : undefined;
  if (!impact || !first || !second || !firstPose || !secondPose) {
    throw new Error(`Scenario ${replayCase.id} requires one two-vehicle impact`);
  }

  return {
    impact,
    relation: analyzeVehicleFootprintRelation(
      { pose: firstPose, dimensions: first.dimensions },
      { pose: secondPose, dimensions: second.dimensions },
      createSceneMetricCalibration({
        sceneBounds: replayCase.environment.bounds,
        widthMeters: replayCase.environment.calibration.widthMeters,
        heightMeters: replayCase.environment.calibration.heightMeters,
      }),
    ),
  };
}

describe("deterministic demo scenario library", () => {
  it("publishes stable metadata for four distinct road accounts", () => {
    expect(DEMO_SCENARIO_IDS).toEqual([
      "roundabout-calibrated",
      "straight-road-rear-end",
      "t-junction-crossing",
      "parking-account-contradiction",
    ]);
    expect(DEMO_SCENARIO_METADATA.map(({ id, sceneType }) => [id, sceneType])).toEqual([
      ["roundabout-calibrated", "roundabout"],
      ["straight-road-rear-end", "straight-road"],
      ["t-junction-crossing", "t-junction"],
      ["parking-account-contradiction", "parking-area"],
    ]);
    expect(new Set(DEMO_SCENARIO_METADATA.map((item) => item.id)).size).toBe(
      DEMO_SCENARIO_METADATA.length,
    );
    expect(DEMO_SCENARIO_METADATA.map((item) => item.synthetic)).toEqual([true, true, true, true]);
  });

  it("delegates the calibrated roundabout scenario to the existing demo seed", () => {
    expect(createDemoScenario("roundabout-calibrated")).toEqual(createDemoCase());
  });

  it.each(DEMO_SCENARIO_IDS)("returns a schema-valid, reference-valid %s fixture", (id) => {
    const replayCase = createDemoScenario(id);

    expect(ReplayCaseSchema.parse(replayCase)).toEqual(replayCase);
    expect(validateCaseReferences(replayCase)).toEqual([]);
    expect(replayCase.environment.sceneType).toBe(
      DEMO_SCENARIO_METADATA.find((metadata) => metadata.id === id)?.sceneType,
    );
    expect(replayCase.trajectories.length).toBeGreaterThanOrEqual(2);
    expect(replayCase.timelineEvents.length).toBeGreaterThanOrEqual(5);
    expect(replayCase.claims.length).toBeGreaterThan(0);
    expect(replayCase.questions.length).toBeGreaterThan(0);
    expect(replayCase.activity.length).toBeGreaterThan(0);
    expect(replayCase.evidence.every((asset) => asset.syntheticDemoAsset)).toBe(true);
    expect(replayCase.claims.some((claim) => containsLiabilityConclusion(claim.statement))).toBe(
      false,
    );
  });

  it.each(NEW_SCENARIO_IDS)("keeps every new %s claim synthetic and reported", (id) => {
    const replayCase = createDemoScenario(id);

    expect(replayCase.claims.every((claim) => claim.status === "reported")).toBe(true);
    expect(replayCase.claims.every((claim) => !claim.humanConfirmed)).toBe(true);
    expect(replayCase.claims.every((claim) => /synthetic demo/i.test(claim.statement))).toBe(true);
    expect(JSON.stringify(replayCase.claims)).not.toMatch(/dishonest|fraudulent|cheat(?:ing)?/i);
  });

  it("retains explicit metric calibration and vehicle-dimension sources", () => {
    const expectedCalibrationSources = {
      "straight-road-rear-end": "measured",
      "t-junction-crossing": "template",
      "parking-account-contradiction": "estimated",
    } as const;

    for (const id of NEW_SCENARIO_IDS) {
      const replayCase = createDemoScenario(id);
      expect(replayCase.environment.calibration.source).toBe(expectedCalibrationSources[id]);
      expect(replayCase.environment.calibration.widthMeters).toBeGreaterThan(0);
      expect(replayCase.environment.calibration.heightMeters).toBeGreaterThan(0);
      expect(
        replayCase.actors.every(
          (actor) =>
            actor.dimensionsSource !== "unknown" &&
            actor.dimensions.width > 0 &&
            actor.dimensions.length > actor.dimensions.width,
        ),
      ).toBe(true);
    }
  });

  it("uses scenario-specific stable case and object IDs", () => {
    const cases = DEMO_SCENARIO_IDS.map((id) => createDemoScenario(id));
    const caseIds = cases.map((replayCase) => replayCase.id);
    const objectIds = cases.flatMap((replayCase) => [
      ...replayCase.actors.map((item) => item.id),
      ...replayCase.trajectories.map((item) => item.id),
      ...replayCase.timelineEvents.map((item) => item.id),
      ...replayCase.branches.map((item) => item.id),
      ...replayCase.claims.map((item) => item.id),
      ...replayCase.questions.map((item) => item.id),
      ...replayCase.activity.map((item) => item.id),
    ]);

    expect(new Set(caseIds).size).toBe(caseIds.length);
    expect(new Set(objectIds).size).toBe(objectIds.length);
  });

  it.each(DEMO_SCENARIO_IDS)("creates byte-stable fresh copies for %s", (id) => {
    const first = createDemoScenario(id);
    const second = createDemoScenario(id);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first).not.toBe(second);
    if (first.actors[0] && second.actors[0]) {
      first.actors[0].label = "Locally changed label";
      expect(second.actors[0].label).not.toBe(first.actors[0].label);
    }
  });

  it("keeps both realistic fixtures free of motion-category findings", () => {
    for (const id of ["straight-road-rear-end", "t-junction-crossing"] as const) {
      const replayCase = createDemoScenario(id);
      expect(replayCase.consistencyIssues.filter((issue) => issue.scope === "motion")).toEqual([]);
      expect(
        replayCase.consistencyIssues.filter(
          (issue) => issue.scope === "geometry" && issue.severity === "error",
        ),
      ).toEqual([]);
    }
  });

  it.each(CLEAN_SCENARIO_IDS)(
    "makes the %s impact exact or shallow contact without material overlap elsewhere",
    (id) => {
      const replayCase = createDemoScenario(id);
      const atImpact = linkedImpactRelation(
        replayCase,
        replayCase.timelineEvents.find((event) => event.type === "impact")?.timeMs ?? -1,
      );

      expect(atImpact.relation.overlaps).toBe(true);
      expect(atImpact.relation.separationM).toBe(0);
      expect(atImpact.relation.penetrationDepthM).toBeLessThanOrEqual(0.01);

      let maximumUnmarkedPenetrationM = 0;
      for (
        let timeMs = replayCase.timeRangeMs.start;
        timeMs <= replayCase.timeRangeMs.end;
        timeMs += 25
      ) {
        if (timeMs === atImpact.impact.timeMs) continue;
        const { relation } = linkedImpactRelation(replayCase, timeMs);
        expect(relation.overlaps, `${id} unexpectedly contacts at ${String(timeMs)} ms`).toBe(
          false,
        );
        maximumUnmarkedPenetrationM = Math.max(
          maximumUnmarkedPenetrationM,
          relation.penetrationDepthM,
        );
      }
      expect(maximumUnmarkedPenetrationM).toBeLessThanOrEqual(0.1);

      const geometryRuleIds = validateConsistency(replayCase, { scope: "geometry" }).map(
        (issue) => issue.ruleId,
      );
      expect(geometryRuleIds).not.toContain("geometry.impact-excessive-penetration");
      expect(geometryRuleIds).not.toContain("geometry.unmarked-footprint-overlap");
      expect(geometryRuleIds).not.toContain("geometry.unmarked-footprint-contact");
    },
  );

  it("surfaces the parking account's metric movement contradiction for WebMCP review", () => {
    const replayCase = createDemoScenario("parking-account-contradiction");
    const account = replayCase.claims.find((claim) => claim.id.endsWith("stationary-account"));
    const aislePath = replayCase.trajectories.find((item) => item.id.endsWith("aisle"));
    const first = aislePath?.keyframes[0];
    const second = aislePath?.keyframes[1];

    expect(account?.status).toBe("reported");
    expect(account?.statement).toMatch(/reported to have remained stationary/i);
    expect(first && second ? second.timeMs - first.timeMs : undefined).toBe(1_000);
    expect(first && second ? second.x - first.x : undefined).toBe(65);
    expect(
      replayCase.consistencyIssues.some(
        (issue) => issue.scope === "motion" && issue.affectedIds.includes(aislePath?.id ?? ""),
      ),
    ).toBe(true);
    expect(replayCase.consistencyIssues.map((issue) => issue.ruleId)).toEqual(
      expect.arrayContaining([
        "geometry.impact-excessive-penetration",
        "geometry.unmarked-footprint-overlap",
      ]),
    );
    expect(replayCase.questions.some((question) => question.importance === "blocking")).toBe(true);
  });

  it("recognizes supported IDs and rejects unknown runtime input", () => {
    expect(isDemoScenarioId("t-junction-crossing")).toBe(true);
    expect(isDemoScenarioId("unknown-scenario")).toBe(false);
    expect(() => createDemoScenario("unknown-scenario" as DemoScenarioId)).toThrow(
      /unknown demo scenario/i,
    );
  });
});
