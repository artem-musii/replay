/* eslint-disable @typescript-eslint/no-non-null-assertion -- fixture objects are asserted by these focused tests */
import { describe, expect, it } from "vitest";

import {
  buildReportPreview,
  createBlankCase,
  createDemoCase,
  exportReplayCase,
  importReplayCase,
  REPLAY_SEED_VERSION,
  ReplayCaseSchema,
  ReplayImportError,
  validateCaseReferences,
} from "../../src/domain";

describe("versioned case schemas and seeds", () => {
  it("creates the exact same validated demo case on every reset", () => {
    const first = createDemoCase();
    const second = createDemoCase();

    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe(2);
    expect(first.seedVersion).toBe(REPLAY_SEED_VERSION);
    expect(ReplayCaseSchema.parse(first)).toEqual(first);
    expect(validateCaseReferences(first)).toEqual([]);
  });

  it("uses calibrated footprints without a false impact-separation warning or fault conclusion", () => {
    const replayCase = createDemoCase();
    const ruleIds = replayCase.consistencyIssues.map((issue) => issue.ruleId);
    expect(
      replayCase.consistencyIssues.some((issue) => issue.ruleId === "geometry.impact-separation"),
    ).toBe(false);
    expect(ruleIds).not.toContain("geometry.actor-outside-scene");
    expect(ruleIds).not.toContain("geometry.keyframe-outside-scene");
    expect(ruleIds).not.toContain("geometry.impact-excessive-penetration");
    expect(ruleIds).not.toContain("geometry.unmarked-footprint-overlap");
    expect(ruleIds).not.toContain("damage.contact-direction-hint");
    expect(JSON.stringify(replayCase).toLowerCase()).not.toContain("at fault");
    expect(replayCase.evidence.every((asset) => asset.syntheticDemoAsset)).toBe(true);
  });

  it("keeps both demo vehicles moving counter-clockwise in the same traffic flow", () => {
    const replayCase = createDemoCase();
    const vehicleA = replayCase.trajectories.find(
      (trajectory) => trajectory.id === "trajectory-a-baseline",
    )!;
    const vehicleB = replayCase.trajectories.find(
      (trajectory) => trajectory.id === "trajectory-b-baseline",
    )!;

    expect(vehicleA.interpolationMode).toBe("smooth");
    expect(vehicleB.interpolationMode).toBe("smooth");
    expect(vehicleA.keyframes).toHaveLength(13);
    expect(vehicleB.keyframes).toHaveLength(13);
    expect(vehicleB.keyframes.map((keyframe) => keyframe.timeMs)).toEqual(
      vehicleA.keyframes.map((keyframe) => keyframe.timeMs),
    );
    expect(vehicleB.keyframes.map((keyframe) => keyframe.x)).toEqual(
      [...vehicleB.keyframes.map((keyframe) => keyframe.x)].sort((first, second) => first - second),
    );
    expect(vehicleA.keyframes.map((keyframe) => keyframe.x)).toEqual(
      [...vehicleA.keyframes.map((keyframe) => keyframe.x)].sort((first, second) => first - second),
    );

    const impactIndex = vehicleA.keyframes.findIndex((keyframe) => keyframe.timeMs === 10_000);
    expect(impactIndex).toBeGreaterThan(0);
    expect(vehicleB.keyframes[impactIndex]!.x).toBeGreaterThan(vehicleA.keyframes[impactIndex]!.x);
    expect(
      Math.abs(
        vehicleB.keyframes[impactIndex]!.rotationDeg - vehicleA.keyframes[impactIndex]!.rotationDeg,
      ),
    ).toBe(0);
  });

  it("rejects unknown persisted fields", () => {
    const raw = { ...createDemoCase(), injected: "ignored?" };
    expect(() => ReplayCaseSchema.parse(raw)).toThrow();
  });

  it("creates a strict but intentionally incomplete blank case", () => {
    const blank = createBlankCase(
      {
        title: "Parking exit incident",
        sceneType: "intersection",
        roadCondition: "dry",
        vehicleCount: 2,
        initialStatement: "Vehicle A was stopped near the exit.",
      },
      { now: "2026-08-27T10:00:00.000Z", caseId: "case-blank-test" },
    );

    expect(blank.id).toBe("case-blank-test");
    expect(blank.actors).toHaveLength(2);
    expect(blank.actors.map((actor) => actor.pose)).toEqual([
      { x: 24, y: 56.4, rotationDeg: 90 },
      { x: 76, y: 43.6, rotationDeg: 270 },
    ]);
    expect(blank.claims[0]?.status).toBe("reported");
    expect(blank.consistencyIssues.some((issue) => issue.ruleId === "completeness.timeline")).toBe(
      true,
    );
    expect(ReplayCaseSchema.parse(blank)).toEqual(blank);
  });
});

describe("case import and export", () => {
  it("round-trips a case through strict JSON validation", () => {
    const original = createDemoCase();
    const json = exportReplayCase(original);
    const restored = importReplayCase(json, { trustHumanAttestations: true });
    expect(restored).toEqual(original);
  });

  it("can re-key an imported transfer so it cannot overwrite its source case", () => {
    const original = createDemoCase();
    original.claims[0]!.sourceIds = [original.id];
    original.activity[0]!.affectedIds = [original.id];
    original.consistencyIssues[0]!.affectedIds = [original.id];
    original.selectedItem = { type: "report", id: original.id };
    const preview = buildReportPreview(original, {
      generatedAt: "2026-08-27T10:00:00.000Z",
    });
    original.reportSnapshots.push({
      id: "snapshot-rekey-test",
      caseVersion: original.caseVersion,
      createdAt: "2026-08-27T10:00:00.000Z",
      confirmedClaimIds: preview.includedClaimIds,
      includedEvidenceIds: preview.includedEvidenceIds,
      unresolvedQuestionIds: preview.unresolvedQuestionIds,
      branchIds: original.branches.map((branch) => branch.id),
      humanAcknowledged: true,
      immutable: true,
      preview,
    });

    const restored = importReplayCase(exportReplayCase(original), {
      trustHumanAttestations: true,
      rekeyCaseId: "case-import-copy",
    });

    expect(restored.id).toBe("case-import-copy");
    expect(restored.claims[0]!.sourceIds).toEqual(["case-import-copy"]);
    expect(restored.activity[0]!.affectedIds).toEqual(["case-import-copy"]);
    expect(
      restored.consistencyIssues.every((issue) => !issue.affectedIds.includes(original.id)),
    ).toBe(true);
    expect(restored.selectedItem).toEqual({ type: "report", id: "case-import-copy" });
    expect(restored.reportSnapshots[0]!.preview.caseId).toBe("case-import-copy");
    expect(validateCaseReferences(restored)).toEqual([]);
  });

  it("migrates a version 1 backup to the current annotation-link shape", () => {
    const current = createDemoCase();
    const legacy = {
      ...current,
      schemaVersion: 1,
      evidence: current.evidence.map((asset) => {
        const legacyAsset: Partial<typeof asset> = structuredClone(asset);
        delete legacyAsset.annotationLinks;
        return legacyAsset;
      }),
    };

    const restored = importReplayCase(JSON.stringify(legacy));

    expect(restored.schemaVersion).toBe(2);
    expect(restored.evidence.every((asset) => asset.annotationLinks.length === 0)).toBe(true);
    expect(ReplayCaseSchema.parse(restored)).toEqual(restored);
  });

  it("rejects malformed JSON, unsupported versions, and dangling references", () => {
    expect(() => importReplayCase("{nope")).toThrow(ReplayImportError);
    expect(() => importReplayCase({ ...createDemoCase(), schemaVersion: 999 })).toThrow(
      /Unsupported/,
    );

    const dangling = createDemoCase();
    dangling.claims[0]!.linkedEvidenceIds.push("evidence-missing");
    expect(() => importReplayCase(dangling)).toThrow(ReplayImportError);
  });

  it("enforces a bounded JSON import size", () => {
    expect(() => importReplayCase(JSON.stringify(createDemoCase()), { maxBytes: 10 })).toThrow(
      /exceeds/,
    );
  });

  it("rejects IDs reused by different object kinds", () => {
    const replayCase = createDemoCase();
    replayCase.evidence[0]!.id = replayCase.actors[0]!.id;
    expect(() => importReplayCase(replayCase)).toThrow(/invalid object references/i);
  });

  it("does not trust forged human attestations from an unsigned JSON file", () => {
    const forged = createDemoCase();
    const claim = forged.claims.find((item) => item.id === "claim-initial-statement");
    if (!claim) throw new Error("Fixture claim is missing");
    claim.status = "confirmed";
    claim.humanConfirmed = true;
    claim.confirmedAt = "2026-08-27T10:00:00.000Z";
    const preview = buildReportPreview(forged, {
      generatedAt: "2026-08-27T10:01:00.000Z",
    });
    forged.reportSnapshots.push({
      id: "snapshot-forged-human-review",
      caseVersion: forged.caseVersion,
      createdAt: "2026-08-27T10:01:00.000Z",
      confirmedClaimIds: forged.claims
        .filter((item) => item.status === "confirmed")
        .map((item) => item.id),
      includedEvidenceIds: preview.includedEvidenceIds,
      unresolvedQuestionIds: preview.unresolvedQuestionIds,
      branchIds: forged.branches.map((branch) => branch.id),
      humanAcknowledged: true,
      immutable: true,
      preview,
    });

    const restored = importReplayCase(JSON.stringify(forged), {
      now: "2026-08-27T12:00:00.000Z",
    });

    expect(restored.claims.every((item) => !item.humanConfirmed)).toBe(true);
    expect(restored.claims.every((item) => item.status !== "confirmed")).toBe(true);
    expect(restored.reportSnapshots).toEqual([]);
    expect(restored.activity.at(-1)).toMatchObject({
      author: "system",
      actionType: "case.imported-untrusted",
    });
  });
});
