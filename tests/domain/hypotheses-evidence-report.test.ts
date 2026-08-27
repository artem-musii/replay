/* eslint-disable @typescript-eslint/no-non-null-assertion -- fixture objects are asserted by these focused tests */
import { describe, expect, it } from "vitest";

import {
  buildReportPreview,
  compareHypotheses,
  containsLiabilityConclusion,
  createDemoCase,
  ReplayEngine,
  validateCaseReferences,
} from "../../src/domain";

function createEngine(): ReplayEngine {
  let counter = 0;
  return new ReplayEngine(createDemoCase(), {
    now: () => "2026-08-27T10:00:00.000Z",
    idFactory: (prefix) => `${prefix}-test-${++counter}`,
  });
}

describe("evidence lifecycle", () => {
  it("validates duplicates, creates bidirectional claim links, and scrubs deletion", () => {
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
      engine.state.claims.find((claim) => claim.id === "claim-initial-statement")
        ?.linkedEvidenceIds,
    ).not.toContain("evidence-uploaded");
    expect(engine.state.evidence.find((asset) => asset.id === "evidence-uploaded")).toMatchObject({
      name: "Deleted evidence",
      tags: [],
      annotations: [],
      annotationLinks: [],
      linkedClaimIds: [],
      linkedEventIds: [],
      linkedSceneObjectIds: [],
      linkedBranchIds: [],
      deleted: true,
    });
    expect(
      engine.state.consistencyIssues.some(
        (issue) => issue.ruleId === "provenance.invalid-evidence-link",
      ),
    ).toBe(false);
    expect(JSON.stringify(engine.state)).not.toContain("Uploaded damage.jpg");
  });

  it("preserves an annotation-level link instead of silently widening it to the whole asset", () => {
    const engine = createEngine();
    const update = engine.execute({
      type: "evidence.update",
      actor: "human",
      origin: "ui",
      evidenceId: "evidence-overview",
      annotations: [{ id: "annotation-contact", kind: "point", x: 0.52, y: 0.48 }],
    });
    expect(update.ok).toBe(true);

    const link = engine.execute({
      type: "evidence.link",
      actor: "agent",
      origin: "webmcp",
      expectedVersion: 2,
      requestId: "link-annotation-contact",
      evidenceId: "evidence-overview",
      annotationId: "annotation-contact",
      targetType: "claim",
      targetId: "claim-impact-location",
    });

    expect(link).toMatchObject({
      ok: true,
      affectedIds: ["evidence-overview", "annotation-contact", "claim-impact-location"],
    });
    expect(
      engine.state.evidence.find((asset) => asset.id === "evidence-overview")?.annotationLinks,
    ).toContainEqual({
      annotationId: "annotation-contact",
      targetType: "claim",
      targetId: "claim-impact-location",
    });
    expect(
      engine.state.claims.find((claim) => claim.id === "claim-impact-location")?.linkedEvidenceIds,
    ).toContain("evidence-overview");

    expect(
      engine.execute({
        type: "evidence.update",
        actor: "human",
        origin: "ui",
        evidenceId: "evidence-overview",
        annotations: [],
      }).ok,
    ).toBe(true);
    expect(
      engine.state.evidence.find((asset) => asset.id === "evidence-overview")?.annotationLinks,
    ).toEqual([]);
  });

  it("repairs a source-less assumption with annotation-level supporting evidence", () => {
    const engine = createEngine();
    const assumptionId = "assumption-inside-edge";
    const annotationId = "annotation-inside-edge";

    expect(
      engine.execute({
        type: "hypothesis.add-assumption",
        actor: "human",
        origin: "ui",
        branchId: "branch-baseline",
        assumptionId,
        statement: "Vehicle A may have followed the inside edge before contact.",
        supportingEvidenceIds: [],
        conflictingEvidenceIds: [],
      }).ok,
    ).toBe(true);
    expect(
      engine.execute({
        type: "evidence.update",
        actor: "human",
        origin: "ui",
        evidenceId: "evidence-overview",
        annotations: [{ id: annotationId, kind: "point", x: 0.48, y: 0.52 }],
      }).ok,
    ).toBe(true);

    const beforeLink = buildReportPreview(engine.state, {
      generatedAt: "2026-08-27T10:00:00.000Z",
    });
    expect(beforeLink.missingRequirements).toContain(
      `Provenance for hypothesis assumption ${assumptionId}`,
    );

    const link = engine.execute({
      type: "evidence.link",
      actor: "human",
      origin: "ui",
      expectedVersion: engine.state.caseVersion,
      evidenceId: "evidence-overview",
      annotationId,
      targetType: "assumption",
      targetId: assumptionId,
    });

    expect(link).toMatchObject({
      ok: true,
      affectedIds: ["evidence-overview", annotationId, assumptionId, "branch-baseline"],
    });
    const branch = engine.state.branches.find((item) => item.id === "branch-baseline")!;
    expect(
      branch.assumptions.find((assumption) => assumption.id === assumptionId)
        ?.supportingEvidenceIds,
    ).toContain("evidence-overview");
    expect(
      engine.state.evidence.find((asset) => asset.id === "evidence-overview")?.linkedBranchIds,
    ).toContain(branch.id);
    expect(
      engine.state.evidence.find((asset) => asset.id === "evidence-overview")?.annotationLinks,
    ).toContainEqual({
      annotationId,
      targetType: "assumption",
      targetId: assumptionId,
    });
    expect(validateCaseReferences(engine.state)).toEqual([]);

    const afterLink = buildReportPreview(engine.state, {
      generatedAt: "2026-08-27T10:00:00.000Z",
    });
    expect(afterLink.missingRequirements).not.toContain(
      `Provenance for hypothesis assumption ${assumptionId}`,
    );

    const broken = engine.state;
    const brokenAssumption = broken.branches
      .flatMap((item) => item.assumptions)
      .find((assumption) => assumption.id === assumptionId)!;
    brokenAssumption.supportingEvidenceIds = [];
    expect(validateCaseReferences(broken)).toContainEqual(
      expect.objectContaining({
        message: `Assumption ${assumptionId} is missing its reverse link to evidence evidence-overview`,
      }),
    );
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

  it("detects common adopted-liability wording while allowing explicit negation", () => {
    for (const statement of [
      "Vehicle A is guilty.",
      "Vehicle B was culpable.",
      "Vehicle A bears responsibility.",
      "Vehicle B committed negligence.",
      "Vehicle A is legally liable.",
      "Liability rests with Vehicle B.",
    ]) {
      expect(containsLiabilityConclusion(statement), statement).toBe(true);
    }

    for (const statement of [
      "REPLAY does not determine fault or legal liability.",
      "Vehicle A was not guilty.",
      "Vehicle B did not bear responsibility.",
      "A source supplied a fault or liability allegation.",
    ]) {
      expect(containsLiabilityConclusion(statement), statement).toBe(false);
    }
  });
});
