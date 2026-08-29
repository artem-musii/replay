import { describe, expect, it } from "vitest";

import {
  buildReportPreview,
  createDemoCase,
  findCurrentCompletenessAttestation,
  importReplayCase,
  migrateReplayCase,
  ReplayEngine,
  validateCaseReferences,
  validateCurrentReportPreview,
  type CompletenessAttestationInput,
  type ReplayCase,
} from "../../src/domain";

const NOW = "2026-08-29T10:00:00.000Z";

function noDamageFixture(): ReplayCase {
  const replayCase = createDemoCase();
  const evidenceEventIds = new Set(
    replayCase.timelineEvents.filter((event) => event.type === "evidence").map((event) => event.id),
  );
  const damageMarkerIds = new Set(
    replayCase.actors.flatMap((actor) => actor.damageMarkers.map((marker) => marker.id)),
  );
  replayCase.actors.forEach((actor) => {
    actor.damageMarkers = [];
  });
  replayCase.claims.forEach((claim) => {
    claim.linkedSceneObjectIds = claim.linkedSceneObjectIds.filter(
      (id) => !damageMarkerIds.has(id),
    );
    claim.linkedEventIds = claim.linkedEventIds.filter((id) => !evidenceEventIds.has(id));
  });
  replayCase.evidence.forEach((asset) => {
    asset.linkedSceneObjectIds = asset.linkedSceneObjectIds.filter(
      (id) => !damageMarkerIds.has(id),
    );
    asset.linkedEventIds = asset.linkedEventIds.filter((id) => !evidenceEventIds.has(id));
  });
  replayCase.questions = [];
  replayCase.timelineEvents = replayCase.timelineEvents.filter(
    (event) => !evidenceEventIds.has(event.id),
  );
  replayCase.branches.forEach((branch) => {
    branch.eventIds = branch.eventIds.filter((id) => !evidenceEventIds.has(id));
  });
  expect(validateCaseReferences(replayCase)).toEqual([]);
  return replayCase;
}

function createEngine(replayCase: ReplayCase = noDamageFixture()): ReplayEngine {
  let sequence = 0;
  return new ReplayEngine(replayCase, {
    now: () => NOW,
    idFactory: (prefix) => `${prefix}-completeness-${String(++sequence)}`,
  });
}

function humanAttest(engine: ReplayEngine, attestation: CompletenessAttestationInput) {
  return engine.execute({
    type: "completeness.attest",
    actor: "human",
    origin: "ui",
    expectedVersion: engine.state.caseVersion,
    attestation,
  });
}

function deleteAllEvidence(engine: ReplayEngine): void {
  for (const asset of engine.state.evidence.filter((candidate) => !candidate.deleted)) {
    expect(
      engine.execute({
        type: "evidence.delete",
        actor: "human",
        origin: "ui",
        expectedVersion: engine.state.caseVersion,
        evidenceId: asset.id,
        confirmed: true,
      }),
    ).toMatchObject({ ok: true });
  }
  for (const claim of engine.state.claims.filter(
    (candidate) =>
      (candidate.sourceType === "photo" || candidate.sourceType === "document") &&
      candidate.sourceIds.length === 0,
  )) {
    expect(
      engine.execute({
        type: "claim.update",
        actor: "human",
        origin: "ui",
        expectedVersion: engine.state.caseVersion,
        claimId: claim.id,
        sourceType: "scene-observation",
        sourceIds: [],
        linkedEvidenceIds: [],
      }),
    ).toMatchObject({ ok: true });
  }
}

function attestAllCompleteness(engine: ReplayEngine): void {
  expect(humanAttest(engine, { kind: "no-evidence-supplied" })).toMatchObject({ ok: true });
  engine.state.actors.forEach((actor, index) => {
    expect(
      humanAttest(engine, {
        kind: "actor-damage",
        actorId: actor.id,
        outcome: index === 0 ? "unknown" : "not-assessed",
      }),
    ).toMatchObject({ ok: true });
  });
  expect(humanAttest(engine, { kind: "uncertainty-review-completed" })).toMatchObject({
    ok: true,
  });
}

describe("human completeness attestations", () => {
  it("rejects agent and non-UI attempts without changing canonical state", () => {
    const engine = createEngine();
    deleteAllEvidence(engine);
    const before = engine.state;

    const result = engine.execute({
      type: "completeness.attest",
      actor: "agent",
      origin: "webmcp",
      requestId: "agent-cannot-attest-completeness",
      expectedVersion: before.caseVersion,
      attestation: { kind: "no-evidence-supplied" },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "HUMAN_CONFIRMATION_REQUIRED" },
    });
    expect(engine.state).toEqual(before);
  });

  it("clears every supported readiness gap and emits visibly attested report statements", () => {
    const engine = createEngine();
    deleteAllEvidence(engine);

    expect(engine.state.consistencyIssues.map((issue) => issue.ruleId)).toEqual(
      expect.arrayContaining([
        "completeness.damage",
        "completeness.evidence-index",
        "completeness.unresolved-section",
      ]),
    );

    attestAllCompleteness(engine);

    const state = engine.state;
    expect(state.consistencyIssues.map((issue) => issue.ruleId)).not.toEqual(
      expect.arrayContaining([
        "completeness.damage",
        "completeness.evidence-index",
        "completeness.unresolved-section",
      ]),
    );
    expect(state.completenessAttestations).toHaveLength(state.actors.length + 2);
    expect(state.completenessAttestations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "no-evidence-supplied",
          attestedBy: "human",
          origin: "ui",
          basisFingerprint: expect.stringMatching(/^completeness-v1-sha256-[a-f0-9]{64}$/),
          humanAttestationTrusted: true,
        }),
        expect.objectContaining({ kind: "actor-damage", outcome: "unknown" }),
        expect.objectContaining({ kind: "actor-damage", outcome: "not-assessed" }),
        expect.objectContaining({ kind: "uncertainty-review-completed" }),
      ]),
    );

    const preview = buildReportPreview(state, { generatedAt: NOW });
    expect(preview.missingRequirements).toEqual([]);
    expect(preview.missingRequirements).not.toContain(
      "Evidence index or explicit no-evidence record",
    );
    const attestedStatements = preview.sections
      .flatMap((section) => section.statements)
      .filter((statement) => statement.certainty === "attested");
    expect(attestedStatements).toHaveLength(state.actors.length + 2);
    expect(attestedStatements.map((statement) => statement.text).join(" ")).toContain(
      "does not establish that evidence does not exist",
    );
    expect(
      attestedStatements.every((statement) => statement.citations.workspacePaths.length > 0),
    ).toBe(true);
    expect(validateCurrentReportPreview(state, preview)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: "report.statement-without-citation" }),
      ]),
    );
    const binding = preview.reviewBinding;
    if (!binding) throw new Error("Expected a review-bound report preview");
    expect(
      engine.execute({
        type: "report.finalize",
        actor: "human",
        origin: "ui",
        expectedVersion: engine.state.caseVersion,
        unresolvedQuestionsReviewed: true,
        limitationsAcknowledged: true,
        confirmedFactsReviewed: true,
        includedUnconfirmedContentReviewed: true,
        manualConfirmation: true,
        reviewedPreview: {
          caseId: preview.caseId,
          caseVersion: preview.caseVersion,
          generatedAt: preview.generatedAt,
          fingerprint: binding.fingerprint,
          branchIds: binding.branchIds,
          includeHypotheses: binding.includeHypotheses,
        },
      }),
    ).toMatchObject({ ok: true });
    expect(engine.state.reportSnapshots).toHaveLength(1);
  });

  it("invalidates a no-evidence record after the evidence index changes, even after deletion", () => {
    const engine = createEngine();
    deleteAllEvidence(engine);
    expect(humanAttest(engine, { kind: "no-evidence-supplied" })).toMatchObject({ ok: true });
    const original = engine.state.completenessAttestations[0];
    expect(original).toBeDefined();

    expect(
      engine.execute({
        type: "evidence.add",
        actor: "human",
        origin: "ui",
        expectedVersion: engine.state.caseVersion,
        evidenceId: "evidence-later-supplied",
        name: "Later supplied image.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 100,
        localBlobKey: "local:evidence-later-supplied",
        checksum: "sha256-later-supplied",
        source: "local-upload",
      }),
    ).toMatchObject({ ok: true });
    expect(
      findCurrentCompletenessAttestation(engine.state, { kind: "no-evidence-supplied" }),
    ).toBeUndefined();

    expect(
      engine.execute({
        type: "evidence.delete",
        actor: "human",
        origin: "ui",
        expectedVersion: engine.state.caseVersion,
        evidenceId: "evidence-later-supplied",
        confirmed: true,
      }),
    ).toMatchObject({ ok: true });
    expect(
      findCurrentCompletenessAttestation(engine.state, { kind: "no-evidence-supplied" }),
    ).toBeUndefined();
    expect(engine.state.consistencyIssues).toEqual(
      expect.arrayContaining([expect.objectContaining({ ruleId: "completeness.evidence-index" })]),
    );
    expect(engine.state.completenessAttestations[0]?.id).toBe(original?.id);
    expect(humanAttest(engine, { kind: "no-evidence-supplied" })).toMatchObject({ ok: true });
    expect(
      findCurrentCompletenessAttestation(engine.state, { kind: "no-evidence-supplied" }),
    ).toBeDefined();
  });

  it("binds an actor damage record to the exact human-selected outcome", () => {
    const engine = createEngine();
    expect(
      humanAttest(engine, {
        kind: "actor-damage",
        actorId: "actor-vehicle-a",
        outcome: "unknown",
      }),
    ).toMatchObject({ ok: true });
    const tampered = engine.state;
    const record = tampered.completenessAttestations.find(
      (attestation) => attestation.kind === "actor-damage",
    );
    if (!record) {
      throw new Error("Expected an actor damage completeness record");
    }
    record.outcome = "not-assessed";

    const imported = importReplayCase(tampered, { trustHumanAttestations: true });
    expect(
      findCurrentCompletenessAttestation(imported, {
        kind: "actor-damage",
        actorId: "actor-vehicle-a",
        outcome: "unknown",
      }),
    ).toBeUndefined();
    expect(imported.consistencyIssues).toEqual(
      expect.arrayContaining([expect.objectContaining({ ruleId: "completeness.damage" })]),
    );
  });

  it("allows human history but prevents agent undo from restoring human completeness authority", () => {
    const engine = createEngine();
    deleteAllEvidence(engine);
    expect(humanAttest(engine, { kind: "uncertainty-review-completed" })).toMatchObject({
      ok: true,
    });

    expect(
      engine.execute({
        type: "question.add",
        actor: "agent",
        origin: "webmcp",
        requestId: "agent-adds-open-question",
        expectedVersion: engine.state.caseVersion,
        question: "Was any additional evidence withheld?",
        reason: "Keep an unresolved possibility visible.",
        importance: "medium",
        rankingReasons: ["contextual-detail"],
        relatedClaimIds: [],
        relatedSceneObjectIds: [],
        relatedBranchIds: [engine.state.activeBranchId],
      }),
    ).toMatchObject({ ok: true });
    expect(engine.canRevertAgentAction("agent-adds-open-question")).toBe(false);
    expect(
      engine.execute({
        type: "history.undo",
        actor: "agent",
        origin: "webmcp",
        requestId: "agent-undo-question",
        expectedVersion: engine.state.caseVersion,
      }),
    ).toMatchObject({ ok: false, error: { code: "UNSAFE_REVERT" } });

    expect(
      engine.execute({
        type: "history.undo",
        actor: "human",
        origin: "ui",
        expectedVersion: engine.state.caseVersion,
      }),
    ).toMatchObject({ ok: true });
    expect(
      findCurrentCompletenessAttestation(engine.state, {
        kind: "uncertainty-review-completed",
      }),
    ).toBeDefined();
    expect(
      engine.execute({
        type: "history.redo",
        actor: "human",
        origin: "ui",
        expectedVersion: engine.state.caseVersion,
      }),
    ).toMatchObject({ ok: true });
    expect(
      findCurrentCompletenessAttestation(engine.state, {
        kind: "uncertainty-review-completed",
      }),
    ).toBeUndefined();
  });

  it("preserves imported records as history but trusts them only with explicit import authority", () => {
    const engine = createEngine();
    deleteAllEvidence(engine);
    attestAllCompleteness(engine);
    const exported = engine.state;

    const untrusted = importReplayCase(exported, {
      trustHumanAttestations: false,
      now: "2026-08-29T11:00:00.000Z",
    });
    expect(untrusted.completenessAttestations.every((item) => !item.humanAttestationTrusted)).toBe(
      true,
    );
    expect(untrusted.consistencyIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: "completeness.evidence-index" }),
        expect.objectContaining({ ruleId: "completeness.damage" }),
        expect.objectContaining({ ruleId: "completeness.unresolved-section" }),
      ]),
    );

    const trusted = importReplayCase(exported, { trustHumanAttestations: true });
    expect(trusted.completenessAttestations.every((item) => item.humanAttestationTrusted)).toBe(
      true,
    );
    expect(trusted.consistencyIssues.map((issue) => issue.ruleId)).not.toEqual(
      expect.arrayContaining([
        "completeness.evidence-index",
        "completeness.damage",
        "completeness.unresolved-section",
      ]),
    );
  });

  it("migrates current structured exports that predate the additive attestation field", () => {
    const legacyCurrent = structuredClone(createDemoCase()) as unknown as Record<string, unknown>;
    delete legacyCurrent.completenessAttestations;

    expect(migrateReplayCase(legacyCurrent)).toMatchObject({ completenessAttestations: [] });
    expect(
      importReplayCase(legacyCurrent, { trustHumanAttestations: true }).completenessAttestations,
    ).toEqual([]);
  });
});
