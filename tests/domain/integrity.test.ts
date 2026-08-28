import { describe, expect, it } from "vitest";

import {
  createDemoCase,
  exportReplayCase,
  importReplayCase,
  validateConsistency,
} from "../../src/domain";

describe("case integrity review rules", () => {
  it("keeps template calibration visibly distinct from survey evidence", () => {
    const replayCase = createDemoCase();
    const issues = validateConsistency(replayCase, { scope: "integrity" });

    expect(issues.map((issue) => issue.ruleId)).toContain("integrity.calibration-source");
    expect(issues.some((issue) => issue.severity === "error")).toBe(false);
  });

  it("marks direct agent geometry as inference without calling it dishonest", () => {
    const replayCase = createDemoCase();
    const actor = replayCase.actors[0];
    const trajectory = replayCase.trajectories[0];
    if (!actor || !trajectory) throw new Error("Demo geometry is incomplete");
    actor.lastEditedBy = "agent";
    actor.lastEditedAt = "2026-08-28T10:00:00.000Z";
    trajectory.changeHistory.push({
      id: "change-agent-path-review",
      caseVersion: replayCase.caseVersion,
      author: "agent",
      origin: "webmcp",
      summary: "Agent updated trajectory keyframes.",
      createdAt: "2026-08-28T10:00:00.000Z",
    });

    const issues = validateConsistency(replayCase, { scope: "integrity" });
    expect(issues.map((issue) => issue.ruleId)).toEqual(
      expect.arrayContaining([
        "integrity.agent-authored-actor-geometry",
        "integrity.agent-authored-trajectory",
      ]),
    );
    expect(JSON.stringify(issues)).not.toMatch(/dishonest|fraudulent|cheat(?:ing)?/i);
  });

  it("surfaces unsigned imports as a transfer-boundary warning", () => {
    const imported = importReplayCase(exportReplayCase(createDemoCase()), {
      now: "2026-08-28T10:00:00.000Z",
    });
    const issues = validateConsistency(imported, { scope: "integrity" });

    expect(issues.some((issue) => issue.ruleId === "integrity.unsigned-import")).toBe(true);
    expect(imported.reportSnapshots).toEqual([]);
    expect(imported.claims.every((claim) => !claim.humanConfirmed)).toBe(true);
  });

  it("detects malformed evidence digests and impossible ledger versions", () => {
    const replayCase = createDemoCase();
    const evidence = replayCase.evidence[0];
    if (!evidence) throw new Error("Demo evidence is incomplete");
    evidence.checksum = "not-a-sha256";
    replayCase.activity.push({
      id: "activity-future-version",
      caseVersion: replayCase.caseVersion + 1,
      author: "system",
      origin: "system",
      actionType: "test.future",
      summary: "Synthetic future activity for deterministic testing.",
      affectedIds: [replayCase.id],
      undoable: false,
      createdAt: "2026-08-28T10:00:00.000Z",
    });

    const issues = validateConsistency(replayCase, { scope: "integrity" });
    expect(issues.map((issue) => issue.ruleId)).toEqual(
      expect.arrayContaining([
        "integrity.evidence-checksum-format",
        "integrity.future-activity-version",
      ]),
    );
    expect(
      issues.find((issue) => issue.ruleId === "integrity.future-activity-version")?.severity,
    ).toBe("error");
  });
});
