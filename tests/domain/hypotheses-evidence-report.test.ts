/* eslint-disable @typescript-eslint/no-non-null-assertion -- fixture objects are asserted by these focused tests */
import { describe, expect, it } from "vitest";

import {
  buildReportPreview,
  compareHypotheses,
  createDemoCase,
  ReplayEngine,
} from "../../src/domain";

function createEngine(): ReplayEngine {
  let counter = 0;
  return new ReplayEngine(createDemoCase(), {
    now: () => "2026-08-27T10:00:00.000Z",
    idFactory: (prefix) => `${prefix}-test-${++counter}`,
  });
}

describe("evidence lifecycle", () => {
  it("validates duplicates, creates bidirectional claim links, and tombstones deletion", () => {
    const engine = createEngine();
    const add = engine.execute({
      type: "evidence.add",
      actor: "human",
      origin: "ui",
      expectedVersion: 1,
      evidenceId: "evidence-uploaded",
      name: "Uploaded damage.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 10_000,
      localBlobKey: "local/evidence-uploaded",
      checksum: "sha256-uploaded-1234",
      source: "local-upload",
      tags: ["damage"],
    });
    expect(add.ok).toBe(true);
    const duplicate = engine.execute({
      type: "evidence.add",
      actor: "human",
      origin: "ui",
      expectedVersion: 2,
      name: "Duplicate.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 10_000,
      localBlobKey: "local/duplicate",
      checksum: "sha256-uploaded-1234",
      source: "local-upload",
    });
    expect(duplicate).toMatchObject({ ok: false, error: { code: "DUPLICATE_EVIDENCE" } });

    expect(
      engine.execute({
        type: "evidence.link",
        actor: "agent",
        origin: "webmcp",
        expectedVersion: 2,
        requestId: "link-upload",
        evidenceId: "evidence-uploaded",
        targetType: "claim",
        targetId: "claim-initial-statement",
      }).ok,
    ).toBe(true);
    expect(
      engine.state.claims.find((claim) => claim.id === "claim-initial-statement")
        ?.linkedEvidenceIds,
    ).toContain("evidence-uploaded");
    expect(
      engine.state.evidence.find((asset) => asset.id === "evidence-uploaded")?.linkedClaimIds,
    ).toContain("claim-initial-statement");

    expect(
      engine.execute({
        type: "evidence.delete",
        actor: "human",
        origin: "ui",
        expectedVersion: 3,
        evidenceId: "evidence-uploaded",
        confirmed: true,
      }).ok,
    ).toBe(true);
    expect(engine.state.evidence.find((asset) => asset.id === "evidence-uploaded")?.deleted).toBe(
      true,
    );
    expect(
      engine.state.consistencyIssues.some(
        (issue) => issue.ruleId === "provenance.invalid-evidence-link",
      ),
    ).toBe(true);
  });
});

describe("hypothesis branches", () => {
  it("forks real branch state, preserves locks, compares differences, archives, and restores", () => {
    const engine = createEngine();
    engine.execute({
      type: "lock.set",
      actor: "human",
      origin: "ui",
      targetType: "trajectory",
      targetId: "trajectory-a-baseline",
      locked: true,
      reason: "Reviewed baseline path",
    });
    const fork = engine.execute({
      type: "hypothesis.fork",
      actor: "agent",
      origin: "webmcp",
      expectedVersion: 2,
      requestId: "fork-a",
      parentBranchId: "branch-baseline",
      branchId: "branch-vehicle-a-outward",
      name: "Vehicle A moved outward",
      description: "Alternative in which Vehicle A crossed toward the outer lane before contact.",
    });
    expect(fork.ok).toBe(true);
    const branch = engine.state.branches.find((item) => item.id === "branch-vehicle-a-outward")!;
    const clonedTrajectory = engine.state.trajectories.find(
      (item) => item.id === branch.trajectoryIds[0],
    )!;
    expect(clonedTrajectory.locked).toBe(true);
    expect(branch.sharedClaimIds).toContain("claim-damage-a");

    engine.execute({
      type: "lock.set",
      actor: "human",
      origin: "ui",
      targetType: "trajectory",
      targetId: clonedTrajectory.id,
      locked: false,
    });
    const branchState = engine.state;
    const updatedFrames = clonedTrajectory.keyframes.map((keyframe, index) => ({
      id: keyframe.id,
      timeMs: keyframe.timeMs,
      x: keyframe.x,
      y: keyframe.y + (index === 2 ? 2 : 0),
      rotationDeg: keyframe.rotationDeg,
    }));
    expect(
      engine.execute({
        type: "trajectory.set",
        actor: "human",
        origin: "ui",
        expectedVersion: branchState.caseVersion,
        trajectoryId: clonedTrajectory.id,
        actorId: clonedTrajectory.actorId,
        branchId: branch.id,
        keyframes: updatedFrames,
      }).ok,
    ).toBe(true);
    const comparison = compareHypotheses(engine.state, "branch-baseline", branch.id);
    expect(comparison.changedTrajectoryActorIds).toContain("actor-vehicle-a");
    expect(comparison.summaries[branch.id]).toContain("requires");

    expect(
      engine.execute({
        type: "hypothesis.archive",
        actor: "human",
        origin: "ui",
        branchId: branch.id,
      }).ok,
    ).toBe(true);
    expect(engine.state.branches.find((item) => item.id === branch.id)?.status).toBe("archived");
    expect(
      engine.execute({
        type: "hypothesis.restore",
        actor: "human",
        origin: "ui",
        branchId: branch.id,
      }).ok,
    ).toBe(true);
    expect(engine.state.branches.find((item) => item.id === branch.id)?.status).toBe("active");
  });
});

describe("evidence-bound reporting", () => {
  it("places only explicitly human-confirmed claims in the confirmed section", () => {
    const replayCase = createDemoCase();
    const preview = buildReportPreview(replayCase, { generatedAt: "2026-08-27T10:00:00.000Z" });
    const confirmed = preview.sections.find((section) => section.id === "confirmed-observations")!;
    expect(
      confirmed.statements.every((entry) => {
        const claim = replayCase.claims.find(
          (candidate) => candidate.id === entry.citations.claimIds[0],
        );
        return claim?.humanConfirmed && claim.status === "confirmed";
      }),
    ).toBe(true);
    expect(confirmed.statements.map((entry) => entry.citations.claimIds[0])).not.toContain(
      "claim-initial-statement",
    );
    expect(preview.disclaimer).toContain("not forensic analysis or legal advice");
  });

  it("excludes agent report notes until a human reviews them", () => {
    const engine = createEngine();
    expect(
      engine.execute({
        type: "report.add-note",
        actor: "agent",
        origin: "webmcp",
        requestId: "report-note-request",
        noteId: "report-note-agent",
        text: "The initial account is reported and remains unconfirmed.",
        claimIds: ["claim-initial-statement"],
        evidenceIds: ["evidence-overview"],
      }).ok,
    ).toBe(true);
    const beforeReview = buildReportPreview(engine.state, {
      generatedAt: "2026-08-27T10:00:00.000Z",
    });
    expect(
      beforeReview.sections
        .flatMap((section) => section.statements)
        .some((entry) => entry.id === "report-note-report-note-agent"),
    ).toBe(false);

    expect(
      engine.execute({
        type: "report.review-note",
        actor: "human",
        origin: "ui",
        noteId: "report-note-agent",
        approved: true,
      }).ok,
    ).toBe(true);
    const afterReview = buildReportPreview(engine.state, {
      generatedAt: "2026-08-27T10:00:00.000Z",
    });
    expect(
      afterReview.sections
        .flatMap((section) => section.statements)
        .some((entry) => entry.id === "report-note-report-note-agent"),
    ).toBe(true);
  });

  it("creates an immutable snapshot only from the manual human finalization command", () => {
    const engine = createEngine();
    const result = engine.execute({
      type: "report.finalize",
      actor: "human",
      origin: "ui",
      expectedVersion: 1,
      unresolvedQuestionsReviewed: true,
      limitationsAcknowledged: true,
      confirmedFactsReviewed: true,
      manualConfirmation: true,
    });
    expect(result.ok).toBe(true);
    expect(engine.state.reportSnapshots).toHaveLength(1);
    expect(engine.state.reportSnapshots[0]).toMatchObject({
      humanAcknowledged: true,
      immutable: true,
      caseVersion: 2,
    });
    const acknowledgement = engine.state.reportSnapshots[0]!.preview.sections.find(
      (section) => section.id === "human-review",
    )?.statements.find((statement) => statement.id === "report-human-review");
    expect(acknowledgement?.text).toContain("manually finalized");
    expect(acknowledgement?.text).not.toContain("not finalized");
    expect(engine.canUndo).toBe(false);
    expect(engine.undo()).toMatchObject({ ok: false, error: { code: "HISTORY_BARRIER" } });
  });

  it("preserves a source-attributed fault allegation without allowing it to become fact", () => {
    const engine = createEngine();
    expect(
      engine.execute({
        type: "claim.add",
        actor: "human",
        origin: "ui",
        claimId: "claim-fault-allegation",
        statement: "Vehicle B was at fault.",
        status: "reported",
        sourceType: "human-statement",
      }).ok,
    ).toBe(true);
    expect(
      engine.execute({
        type: "claim.confirm",
        actor: "human",
        origin: "ui",
        claimId: "claim-fault-allegation",
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN_ACTION" } });
    const preview = buildReportPreview(engine.state, {
      generatedAt: "2026-08-27T10:00:00.000Z",
    });
    const rendered = preview.sections
      .flatMap((section) => section.statements)
      .map((item) => item.text);
    expect(rendered.join(" ").toLowerCase()).not.toContain("vehicle b was at fault");
    expect(rendered.join(" ")).toContain("source supplied a fault or liability allegation");
  });
});
