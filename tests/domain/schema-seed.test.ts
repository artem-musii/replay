/* eslint-disable @typescript-eslint/no-non-null-assertion -- fixture objects are asserted by these focused tests */
import { describe, expect, it } from "vitest";

import {
  buildReportPreview,
  createBlankCase,
  createDemoCase,
  exportReplayCase,
  importReplayCase,
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
    expect(first.seedVersion).toBe(2);
    expect(ReplayCaseSchema.parse(first)).toEqual(first);
    expect(validateCaseReferences(first)).toEqual([]);
  });

  it("contains the deliberate impact-position inconsistency and no fault conclusion", () => {
    const replayCase = createDemoCase();
    const ruleIds = replayCase.consistencyIssues.map((issue) => issue.ruleId);
    expect(
      replayCase.consistencyIssues.some((issue) => issue.ruleId === "geometry.impact-separation"),
    ).toBe(true);
    expect(ruleIds).not.toContain("geometry.actor-outside-scene");
    expect(ruleIds).not.toContain("geometry.keyframe-outside-scene");
    expect(JSON.stringify(replayCase).toLowerCase()).not.toContain("at fault");
    expect(replayCase.evidence.every((asset) => asset.syntheticDemoAsset)).toBe(true);
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
