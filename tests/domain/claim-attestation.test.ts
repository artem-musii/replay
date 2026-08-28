import { describe, expect, it } from "vitest";

import { createDemoCase, ReplayEngine } from "../../src/domain";
import type { ReplayCase } from "../../src/domain";

const NOW = "2026-08-28T12:00:00.000Z";
const INVALIDATION_SUMMARY =
  "Prior human confirmation invalidated because claim content or provenance changed.";

function createEngine(replayCase: ReplayCase = createDemoCase()): ReplayEngine {
  let counter = 0;
  return new ReplayEngine(replayCase, {
    now: () => NOW,
    idFactory: (prefix) => `${prefix}-claim-attestation-${++counter}`,
  });
}

function expectInvalidated(
  engine: ReplayEngine,
  claimId: string,
  author: "human" | "agent" = "human",
): void {
  const claim = engine.state.claims.find((candidate) => candidate.id === claimId);
  expect(claim).toBeDefined();
  expect(claim).toMatchObject({
    status: "reported",
    humanConfirmed: false,
    updatedAt: NOW,
  });
  expect(claim).not.toHaveProperty("confirmedAt");
  expect(claim?.changeHistory).toContainEqual(
    expect.objectContaining({
      author,
      origin: author === "agent" ? "webmcp" : "ui",
      summary: INVALIDATION_SUMMARY,
    }),
  );
}

describe("confirmed claim attestations", () => {
  it.each([
    ["statement", { statement: "The road surface appeared wet after light rain." }],
    ["source type", { sourceType: "document" as const }],
    ["source IDs", { sourceIds: ["evidence-overview"] }],
    ["linked evidence", { linkedEvidenceIds: ["evidence-road", "evidence-overview"] }],
    ["linked events", { linkedEventIds: ["event-evidence"] }],
    ["linked scene objects", { linkedSceneObjectIds: ["actor-vehicle-a"] }],
  ])("invalidates confirmation when %s changes", (_label, patch) => {
    const engine = createEngine();
    const result = engine.execute({
      type: "claim.update",
      actor: "human",
      origin: "ui",
      expectedVersion: 1,
      claimId: "claim-road-wet",
      ...patch,
    });

    expect(result).toMatchObject({ ok: true, caseVersion: 2 });
    expectInvalidated(engine, "claim-road-wet");
  });

  it("keeps confirmation for a semantic no-op update", () => {
    const engine = createEngine();
    const before = engine.state.claims.find((claim) => claim.id === "claim-damage-a");
    if (!before) throw new Error("Expected seeded confirmed claim");
    const confirmedAt = before.confirmedAt;

    const result = engine.execute({
      type: "claim.update",
      actor: "human",
      origin: "ui",
      expectedVersion: 1,
      claimId: before.id,
      statement: before.statement,
      sourceType: before.sourceType,
      sourceIds: [...before.sourceIds],
      linkedEvidenceIds: [...before.linkedEvidenceIds],
      linkedEventIds: [...before.linkedEventIds],
      linkedSceneObjectIds: [...before.linkedSceneObjectIds],
    });

    expect(result).toMatchObject({ ok: true, caseVersion: 2 });
    const after = engine.state.claims.find((claim) => claim.id === before.id);
    expect(after).toMatchObject({
      status: "confirmed",
      humanConfirmed: true,
      confirmedAt,
    });
    expect(after?.changeHistory.map((change) => change.summary)).not.toContain(
      INVALIDATION_SUMMARY,
    );
  });

  it("invalidates when evidence is added, but not for a repeated link", () => {
    const repeated = createEngine();
    expect(
      repeated.execute({
        type: "evidence.link",
        actor: "agent",
        origin: "webmcp",
        expectedVersion: 1,
        requestId: "repeat-existing-evidence-link",
        evidenceId: "evidence-road",
        targetType: "claim",
        targetId: "claim-road-wet",
      }),
    ).toMatchObject({ ok: true, caseVersion: 2 });
    expect(repeated.state.claims.find((claim) => claim.id === "claim-road-wet")).toMatchObject({
      status: "confirmed",
      humanConfirmed: true,
    });

    const added = createEngine();
    expect(
      added.execute({
        type: "evidence.link",
        actor: "agent",
        origin: "webmcp",
        expectedVersion: 1,
        requestId: "add-confirmed-claim-evidence",
        evidenceId: "evidence-overview",
        targetType: "claim",
        targetId: "claim-road-wet",
      }),
    ).toMatchObject({ ok: true, caseVersion: 2 });
    expectInvalidated(added, "claim-road-wet", "agent");
  });

  it("invalidates when linked or source evidence is deleted, including a source-only claim", () => {
    const linked = createEngine();
    expect(
      linked.execute({
        type: "evidence.delete",
        actor: "human",
        origin: "ui",
        expectedVersion: 1,
        evidenceId: "evidence-road",
        confirmed: true,
      }),
    ).toMatchObject({ ok: true, caseVersion: 2 });
    expectInvalidated(linked, "claim-road-wet");
    expect(linked.state.claims.find((claim) => claim.id === "claim-road-wet")).toMatchObject({
      sourceIds: [],
      linkedEvidenceIds: [],
    });

    const sourceOnlyCase = createDemoCase();
    const sourceOnlyClaim = sourceOnlyCase.claims.find((claim) => claim.id === "claim-no-injuries");
    if (!sourceOnlyClaim) throw new Error("Expected seeded source-only test claim");
    sourceOnlyClaim.sourceIds = ["evidence-overview"];
    const sourceOnly = createEngine(sourceOnlyCase);
    const deletion = sourceOnly.execute({
      type: "evidence.delete",
      actor: "human",
      origin: "ui",
      expectedVersion: 1,
      evidenceId: "evidence-overview",
      confirmed: true,
    });

    expect(deletion).toMatchObject({
      ok: true,
      caseVersion: 2,
      affectedIds: expect.arrayContaining(["claim-no-injuries"]),
    });
    expectInvalidated(sourceOnly, "claim-no-injuries");
    expect(
      sourceOnly.state.claims.find((claim) => claim.id === "claim-no-injuries")?.sourceIds,
    ).toEqual([]);
  });

  it("still requires a human UI action to reconfirm an invalidated claim", () => {
    const engine = createEngine();
    expect(
      engine.execute({
        type: "claim.update",
        actor: "human",
        origin: "ui",
        expectedVersion: 1,
        claimId: "claim-road-wet",
        statement: "The road surface appeared wet after light rain.",
      }).ok,
    ).toBe(true);

    expect(
      engine.execute({
        type: "claim.confirm",
        actor: "agent",
        origin: "webmcp",
        expectedVersion: 2,
        requestId: "agent-reconfirm-invalidated-claim",
        claimId: "claim-road-wet",
      }),
    ).toMatchObject({ ok: false, error: { code: "HUMAN_CONFIRMATION_REQUIRED" } });
    expect(
      engine.execute({
        type: "claim.confirm",
        actor: "human",
        origin: "ui",
        expectedVersion: 2,
        claimId: "claim-road-wet",
      }),
    ).toMatchObject({ ok: true, caseVersion: 3 });
    expect(engine.state.claims.find((claim) => claim.id === "claim-road-wet")).toMatchObject({
      status: "confirmed",
      humanConfirmed: true,
      confirmedAt: NOW,
    });
  });
});
