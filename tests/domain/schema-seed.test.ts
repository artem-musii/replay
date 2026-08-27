/* eslint-disable @typescript-eslint/no-non-null-assertion -- fixture objects are asserted by these focused tests */
import { describe, expect, it } from "vitest";

import {
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
    expect(first.schemaVersion).toBe(1);
    expect(first.seedVersion).toBe(1);
    expect(ReplayCaseSchema.parse(first)).toEqual(first);
    expect(validateCaseReferences(first)).toEqual([]);
  });

  it("contains the deliberate impact-position inconsistency and no fault conclusion", () => {
    const replayCase = createDemoCase();
    expect(
      replayCase.consistencyIssues.some((issue) => issue.ruleId === "geometry.impact-separation"),
    ).toBe(true);
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
    const restored = importReplayCase(json);
    expect(restored).toEqual(original);
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
});
