/* eslint-disable @typescript-eslint/no-non-null-assertion -- fixture objects are asserted by these focused tests */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildReportPreview,
  compareHypotheses,
  containsLiabilityConclusion,
  createDemoCase,
  importReplayCase,
  ReplayImportError,
  ReplayEngine,
  reportPreviewHasValidReviewBinding,
  truncateXmlSafeText,
  validateCaseReferences,
  validateConsistency,
  XmlSafeIdSchema,
  XmlSafeLongTextSchema,
  XmlSafeShortTextSchema,
} from "../../src/domain";
import type { ReportPreview } from "../../src/domain";

function createEngine(): ReplayEngine {
  let counter = 0;
  return new ReplayEngine(createDemoCase(), {
    now: () => "2026-08-27T10:00:00.000Z",
    idFactory: (prefix) => `${prefix}-test-${++counter}`,
  });
}

function reviewedPreview(preview: ReportPreview) {
  const binding = preview.reviewBinding;
  if (!binding) throw new Error("Expected a bound report preview");
  return {
    caseId: preview.caseId,
    caseVersion: preview.caseVersion,
    generatedAt: preview.generatedAt,
    fingerprint: binding.fingerprint,
    branchIds: binding.branchIds,
    includeHypotheses: binding.includeHypotheses,
  };
}

function canonicalSerialize(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalSerialize).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined && key !== "reviewBinding")
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalSerialize(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
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

  it("lets only the human remove a mistaken evidence relationship without deleting the asset", () => {
    const engine = createEngine();
    expect(
      engine.execute({
        type: "evidence.link",
        actor: "agent",
        origin: "webmcp",
        expectedVersion: 1,
        requestId: "link-mistaken-evidence",
        evidenceId: "evidence-overview",
        targetType: "claim",
        targetId: "claim-road-wet",
      }),
    ).toMatchObject({ ok: true, caseVersion: 2 });
    expect(
      engine.execute({
        type: "evidence.unlink",
        actor: "agent",
        origin: "webmcp",
        expectedVersion: 2,
        requestId: "agent-cannot-unlink-evidence",
        evidenceId: "evidence-overview",
        targetType: "claim",
        targetId: "claim-road-wet",
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN_ACTION" } });

    expect(
      engine.execute({
        type: "evidence.unlink",
        actor: "human",
        origin: "ui",
        expectedVersion: 2,
        evidenceId: "evidence-overview",
        targetType: "claim",
        targetId: "claim-road-wet",
      }),
    ).toMatchObject({ ok: true, caseVersion: 3 });
    expect(engine.state.evidence.find((asset) => asset.id === "evidence-overview")).toMatchObject({
      deleted: false,
    });
    expect(
      engine.state.evidence.find((asset) => asset.id === "evidence-overview")?.linkedClaimIds,
    ).not.toContain("claim-road-wet");
    expect(
      engine.state.claims.find((claim) => claim.id === "claim-road-wet")?.linkedEvidenceIds,
    ).not.toContain("evidence-overview");
  });

  it("removes one annotation relationship while preserving the whole-evidence relationship", () => {
    const engine = createEngine();
    const annotationId = "annotation-unlink-test";
    expect(
      engine.execute({
        type: "evidence.update",
        actor: "human",
        origin: "ui",
        expectedVersion: 1,
        evidenceId: "evidence-overview",
        annotations: [{ id: annotationId, kind: "point", x: 0.5, y: 0.5 }],
      }),
    ).toMatchObject({ ok: true, caseVersion: 2 });
    expect(
      engine.execute({
        type: "evidence.link",
        actor: "human",
        origin: "ui",
        expectedVersion: 2,
        evidenceId: "evidence-overview",
        annotationId,
        targetType: "timeline-event",
        targetId: "event-impact",
      }),
    ).toMatchObject({ ok: true, caseVersion: 3 });
    expect(
      engine.execute({
        type: "evidence.unlink",
        actor: "human",
        origin: "ui",
        expectedVersion: 3,
        evidenceId: "evidence-overview",
        annotationId,
        targetType: "timeline-event",
        targetId: "event-impact",
      }),
    ).toMatchObject({ ok: true, caseVersion: 4 });
    const asset = engine.state.evidence.find((candidate) => candidate.id === "evidence-overview");
    expect(asset?.annotationLinks).not.toContainEqual(
      expect.objectContaining({ annotationId, targetId: "event-impact" }),
    );
    expect(asset?.linkedEventIds).toContain("event-impact");
    expect(
      engine.state.timelineEvents.find((event) => event.id === "event-impact")?.linkedEvidenceIds,
    ).toContain("evidence-overview");
  });

  it("replaces damage evidence and claim links without erasing unrelated direct citations", () => {
    const engine = createEngine();
    const markerId = "damage-a-front-left";

    expect(
      engine.execute({
        type: "damage.mark",
        actor: "human",
        origin: "ui",
        expectedVersion: 1,
        markerId,
        actorId: "actor-vehicle-a",
        region: "front-left",
        description: "Minor scraping at the front-left bumper and wheel arch.",
        status: "confirmed",
        linkedClaimIds: ["claim-damage-a"],
        linkedEvidenceIds: ["evidence-road"],
      }),
    ).toMatchObject({ ok: true, caseVersion: 2 });

    let state = engine.state;
    expect(state.actors[0]?.damageMarkers.find((marker) => marker.id === markerId)).toMatchObject({
      linkedClaimIds: ["claim-damage-a"],
      linkedEvidenceIds: ["evidence-road"],
    });
    expect(
      state.evidence.find((asset) => asset.id === "evidence-damage-a")?.linkedSceneObjectIds,
    ).not.toContain(markerId);
    expect(
      state.evidence.find((asset) => asset.id === "evidence-damage-a")?.linkedClaimIds,
    ).toContain("claim-damage-a");
    expect(
      state.claims.find((claim) => claim.id === "claim-damage-a")?.linkedEvidenceIds,
    ).toContain("evidence-damage-a");
    expect(
      state.evidence.find((asset) => asset.id === "evidence-road")?.linkedSceneObjectIds,
    ).toContain(markerId);
    expect(
      state.evidence.find((asset) => asset.id === "evidence-road")?.linkedClaimIds,
    ).not.toContain("claim-damage-a");
    expect(
      state.claims.find((claim) => claim.id === "claim-damage-a")?.linkedEvidenceIds,
    ).not.toContain("evidence-road");

    expect(
      engine.execute({
        type: "damage.mark",
        actor: "human",
        origin: "ui",
        expectedVersion: 2,
        markerId,
        actorId: "actor-vehicle-a",
        region: "front-left",
        description: "Minor scraping at the front-left bumper and wheel arch.",
        status: "confirmed",
        linkedClaimIds: ["claim-lane-change"],
        linkedEvidenceIds: ["evidence-road"],
      }),
    ).toMatchObject({ ok: true, caseVersion: 3 });

    state = engine.state;
    expect(
      state.claims.find((claim) => claim.id === "claim-damage-a")?.linkedSceneObjectIds,
    ).not.toContain(markerId);
    expect(state.claims.find((claim) => claim.id === "claim-damage-a")).toMatchObject({
      status: "reported",
      humanConfirmed: false,
    });
    expect(
      state.claims.find((claim) => claim.id === "claim-lane-change")?.linkedSceneObjectIds,
    ).toContain(markerId);
    expect(
      state.evidence.find((asset) => asset.id === "evidence-road")?.linkedClaimIds,
    ).not.toContain("claim-lane-change");
    expect(validateCaseReferences(state)).toEqual([]);
  });

  it("uses the same exact damage-evidence relation for evidence linking without claim widening", () => {
    const engine = createEngine();
    const markerId = "damage-reported-link-test";
    expect(
      engine.execute({
        type: "damage.mark",
        actor: "human",
        origin: "ui",
        markerId,
        actorId: "actor-vehicle-a",
        region: "unknown",
        description: "Reported damage location awaiting review.",
        status: "reported",
        linkedClaimIds: ["claim-lane-change"],
        linkedEvidenceIds: [],
      }).ok,
    ).toBe(true);

    expect(
      engine.execute({
        type: "evidence.link",
        actor: "agent",
        origin: "webmcp",
        requestId: "link-reported-damage-evidence",
        expectedVersion: 2,
        evidenceId: "evidence-road",
        targetType: "damage",
        targetId: markerId,
      }),
    ).toMatchObject({ ok: true, caseVersion: 3 });

    const state = engine.state;
    expect(
      state.actors[0]?.damageMarkers.find((marker) => marker.id === markerId)?.linkedEvidenceIds,
    ).toEqual(["evidence-road"]);
    expect(
      state.evidence.find((asset) => asset.id === "evidence-road")?.linkedSceneObjectIds,
    ).toContain(markerId);
    expect(
      state.evidence.find((asset) => asset.id === "evidence-road")?.linkedClaimIds,
    ).not.toContain("claim-lane-change");
    expect(
      state.claims.find((claim) => claim.id === "claim-lane-change")?.linkedEvidenceIds,
    ).not.toContain("evidence-road");
    expect(validateCaseReferences(state)).toEqual([]);
  });

  it("scrubs a deleted evidence asset from damage markers while preserving marker-claim links", () => {
    const engine = createEngine();
    const markerId = "damage-a-front-left";
    expect(
      engine.execute({
        type: "evidence.delete",
        actor: "human",
        origin: "ui",
        expectedVersion: 1,
        evidenceId: "evidence-damage-a",
        confirmed: true,
      }),
    ).toMatchObject({ ok: true, caseVersion: 2 });

    const state = engine.state;
    const marker = state.actors[0]?.damageMarkers.find((candidate) => candidate.id === markerId);
    const claim = state.claims.find((candidate) => candidate.id === "claim-damage-a");
    const deletedEvidence = state.evidence.find(
      (candidate) => candidate.id === "evidence-damage-a",
    );
    expect(marker?.linkedEvidenceIds).not.toContain("evidence-damage-a");
    expect(marker?.linkedClaimIds).toContain("claim-damage-a");
    expect(claim?.linkedEvidenceIds).not.toContain("evidence-damage-a");
    expect(claim?.linkedSceneObjectIds).toContain(markerId);
    expect(deletedEvidence).toMatchObject({
      deleted: true,
      linkedClaimIds: [],
      linkedEventIds: [],
      linkedSceneObjectIds: [],
    });
    expect(validateCaseReferences(state)).toEqual([]);
  });

  it("keeps claim-side damage backlinks exact across add and update", () => {
    const engine = createEngine();
    const markerId = "damage-a-front-left";
    expect(
      engine.execute({
        type: "claim.add",
        actor: "human",
        origin: "ui",
        expectedVersion: 1,
        claimId: "claim-damage-context-test",
        statement: "A human linked this reported detail to the recorded damage location.",
        status: "reported",
        sourceType: "human-statement",
        linkedSceneObjectIds: [markerId],
        sharedAcrossBranches: true,
      }),
    ).toMatchObject({ ok: true, caseVersion: 2 });
    expect(
      engine.state.actors[0]?.damageMarkers.find((marker) => marker.id === markerId)
        ?.linkedClaimIds,
    ).toContain("claim-damage-context-test");

    expect(
      engine.execute({
        type: "claim.update",
        actor: "human",
        origin: "ui",
        expectedVersion: 2,
        claimId: "claim-damage-context-test",
        linkedSceneObjectIds: [],
      }),
    ).toMatchObject({ ok: true, caseVersion: 3 });
    expect(
      engine.state.actors[0]?.damageMarkers.find((marker) => marker.id === markerId)
        ?.linkedClaimIds,
    ).not.toContain("claim-damage-context-test");
    expect(validateCaseReferences(engine.state)).toEqual([]);
  });

  it("rejects confirmed, locked, and deleted-source damage rewrites atomically", () => {
    const confirmedMarkerEngine = createEngine();
    const beforeConfirmedMarkerLink = confirmedMarkerEngine.state;
    expect(
      confirmedMarkerEngine.execute({
        type: "evidence.link",
        actor: "agent",
        origin: "webmcp",
        requestId: "agent-link-confirmed-damage-marker",
        expectedVersion: 1,
        evidenceId: "evidence-road",
        targetType: "damage",
        targetId: "damage-a-front-left",
      }),
    ).toMatchObject({ ok: false, error: { code: "HUMAN_CONFIRMATION_REQUIRED" } });
    expect(confirmedMarkerEngine.state).toEqual(beforeConfirmedMarkerLink);

    const confirmedEngine = createEngine();
    const markerId = "damage-claim-attestation-test";
    expect(
      confirmedEngine.execute({
        type: "damage.mark",
        actor: "human",
        origin: "ui",
        markerId,
        actorId: "actor-vehicle-a",
        region: "unknown",
        description: "Reported damage marker for attestation testing.",
        status: "reported",
        linkedClaimIds: ["claim-lane-change"],
        linkedEvidenceIds: ["evidence-overview"],
      }).ok,
    ).toBe(true);
    expect(
      confirmedEngine.execute({
        type: "claim.confirm",
        actor: "human",
        origin: "ui",
        expectedVersion: 2,
        claimId: "claim-lane-change",
      }).ok,
    ).toBe(true);
    const beforeAgentRewrite = confirmedEngine.state;
    expect(
      confirmedEngine.execute({
        type: "damage.mark",
        actor: "agent",
        origin: "webmcp",
        requestId: "agent-rewrite-confirmed-damage-claim",
        expectedVersion: 3,
        markerId,
        actorId: "actor-vehicle-a",
        region: "unknown",
        description: "Agent attempted to replace the attested relationship.",
        status: "reported",
        linkedClaimIds: [],
        linkedEvidenceIds: ["evidence-road"],
      }),
    ).toMatchObject({ ok: false, error: { code: "HUMAN_CONFIRMATION_REQUIRED" } });
    expect(confirmedEngine.state).toEqual(beforeAgentRewrite);

    const lockedEngine = createEngine();
    expect(
      lockedEngine.execute({
        type: "lock.set",
        actor: "human",
        origin: "ui",
        targetType: "claim",
        targetId: "claim-damage-a",
        locked: true,
        reason: "Keep the reviewed damage provenance fixed.",
      }).ok,
    ).toBe(true);
    const beforeLockedRewrite = lockedEngine.state;
    expect(
      lockedEngine.execute({
        type: "damage.mark",
        actor: "human",
        origin: "ui",
        expectedVersion: 2,
        markerId: "damage-a-front-left",
        actorId: "actor-vehicle-a",
        region: "front-left",
        description: "Attempted locked provenance replacement.",
        status: "confirmed",
        linkedClaimIds: [],
        linkedEvidenceIds: ["evidence-road"],
      }),
    ).toMatchObject({ ok: false, error: { code: "LOCKED_ITEM" } });
    expect(lockedEngine.state).toEqual(beforeLockedRewrite);

    const deletedEngine = createEngine();
    expect(
      deletedEngine.execute({
        type: "evidence.add",
        actor: "human",
        origin: "ui",
        evidenceId: "evidence-deleted-damage-source",
        name: "Temporary damage source.png",
        mimeType: "image/png",
        sizeBytes: 64,
        localBlobKey: "evidence:evidence-deleted-damage-source",
        checksum: "sha256-deleted-damage-source",
        source: "local-upload",
      }).ok,
    ).toBe(true);
    expect(
      deletedEngine.execute({
        type: "evidence.delete",
        actor: "human",
        origin: "ui",
        expectedVersion: 2,
        evidenceId: "evidence-deleted-damage-source",
        confirmed: true,
      }).ok,
    ).toBe(true);
    const beforeDeletedRewrite = deletedEngine.state;
    expect(
      deletedEngine.execute({
        type: "damage.mark",
        actor: "human",
        origin: "ui",
        expectedVersion: 3,
        markerId: "damage-a-front-left",
        actorId: "actor-vehicle-a",
        region: "front-left",
        description: "Attempted deleted-source replacement.",
        status: "confirmed",
        linkedClaimIds: ["claim-damage-a"],
        linkedEvidenceIds: ["evidence-deleted-damage-source"],
      }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(deletedEngine.state).toEqual(beforeDeletedRewrite);
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

describe("claim and timeline provenance", () => {
  it("keeps event backlinks symmetric when a claim is added and relinked", () => {
    const engine = createEngine();
    expect(
      engine.execute({
        type: "claim.add",
        actor: "agent",
        origin: "webmcp",
        expectedVersion: 1,
        requestId: "request-add-event-linked-claim",
        claimId: "claim-event-linked-test",
        statement: "The impact placement remains an agent hypothesis pending human review.",
        status: "agent-hypothesis",
        sourceType: "agent-inference",
        linkedEventIds: ["event-impact"],
        sharedAcrossBranches: true,
      }),
    ).toMatchObject({ ok: true, caseVersion: 2 });
    expect(
      engine.state.timelineEvents.find((event) => event.id === "event-impact")?.linkedClaimIds,
    ).toContain("claim-event-linked-test");

    expect(
      engine.execute({
        type: "claim.update",
        actor: "agent",
        origin: "webmcp",
        expectedVersion: 2,
        requestId: "request-relink-event-linked-claim",
        claimId: "claim-event-linked-test",
        linkedEventIds: ["event-maneuver"],
      }),
    ).toMatchObject({ ok: true, caseVersion: 3 });
    expect(
      engine.state.timelineEvents.find((event) => event.id === "event-impact")?.linkedClaimIds,
    ).not.toContain("claim-event-linked-test");
    expect(
      engine.state.timelineEvents.find((event) => event.id === "event-maneuver")?.linkedClaimIds,
    ).toContain("claim-event-linked-test");
    expect(validateCaseReferences(engine.state)).toEqual([]);
  });

  it("rejects imported claim-event links that are not symmetric", () => {
    const missingEventBacklink = createDemoCase();
    const impact = missingEventBacklink.timelineEvents.find((event) => event.id === "event-impact");
    if (!impact) throw new Error("Missing seeded impact event");
    impact.linkedClaimIds = impact.linkedClaimIds.filter(
      (claimId) => claimId !== "claim-initial-statement",
    );

    expect(() =>
      importReplayCase(JSON.stringify(missingEventBacklink), { trustHumanAttestations: true }),
    ).toThrowError(ReplayImportError);
    try {
      importReplayCase(JSON.stringify(missingEventBacklink), { trustHumanAttestations: true });
    } catch (error) {
      expect(error).toBeInstanceOf(ReplayImportError);
      expect((error as ReplayImportError).issues).toContainEqual(
        expect.objectContaining({
          message:
            "Event event-impact is missing its reverse link to claim claim-initial-statement",
        }),
      );
    }

    const missingClaimBacklink = createDemoCase();
    const initialClaim = missingClaimBacklink.claims.find(
      (claim) => claim.id === "claim-initial-statement",
    );
    if (!initialClaim) throw new Error("Missing seeded initial claim");
    initialClaim.linkedEventIds = [];
    try {
      importReplayCase(JSON.stringify(missingClaimBacklink), { trustHumanAttestations: true });
      throw new Error("Expected asymmetric import to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ReplayImportError);
      expect((error as ReplayImportError).issues).toContainEqual(
        expect.objectContaining({
          message:
            "Claim claim-initial-statement is missing its reverse link to event event-impact",
        }),
      );
    }
  });
});

describe("hypothesis branches", () => {
  it("remaps branch claim-event links and extends shared backlinks when forking", () => {
    const engine = createEngine();
    expect(
      engine.execute({
        type: "claim.add",
        actor: "human",
        origin: "ui",
        expectedVersion: 1,
        claimId: "claim-baseline-impact-context",
        statement: "The baseline records an uncertain impact context for comparison.",
        status: "reported",
        sourceType: "human-statement",
        linkedEventIds: ["event-impact"],
        branchId: "branch-baseline",
        sharedAcrossBranches: false,
      }),
    ).toMatchObject({ ok: true, caseVersion: 2 });

    expect(
      engine.execute({
        type: "hypothesis.fork",
        actor: "agent",
        origin: "webmcp",
        expectedVersion: 2,
        requestId: "request-fork-symmetric-provenance",
        parentBranchId: "branch-baseline",
        branchId: "branch-symmetric-provenance",
        name: "Alternative impact context",
        description: "A neutral alternative used to verify branch provenance links.",
      }),
    ).toMatchObject({ ok: true, caseVersion: 3 });

    const branch = engine.state.branches.find(
      (candidate) => candidate.id === "branch-symmetric-provenance",
    );
    if (!branch) throw new Error("Forked branch was not created");
    const clonedImpact = engine.state.timelineEvents.find(
      (event) => branch.eventIds.includes(event.id) && event.type === "impact",
    );
    const clonedClaim = engine.state.claims.find(
      (claim) =>
        branch.claimIds.includes(claim.id) &&
        claim.statement === "The baseline records an uncertain impact context for comparison.",
    );
    if (!clonedImpact || !clonedClaim) throw new Error("Forked provenance objects are missing");

    expect(clonedImpact.linkedClaimIds).toContain(clonedClaim.id);
    expect(clonedImpact.linkedClaimIds).not.toContain("claim-baseline-impact-context");
    expect(clonedClaim.linkedEventIds).toContain(clonedImpact.id);
    expect(
      engine.state.claims.find((claim) => claim.id === "claim-initial-statement")?.linkedEventIds,
    ).toContain(clonedImpact.id);
    expect(validateCaseReferences(engine.state)).toEqual([]);
  });

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
  it("keeps every persisted report truncation on a complete Unicode code point", () => {
    expect(truncateXmlSafeText(`${"a".repeat(9_999)}😀suffix`, 10_000)).toBe("a".repeat(9_999));
    expect(
      XmlSafeLongTextSchema.safeParse(truncateXmlSafeText(`${"a".repeat(9_999)}😀`, 10_000))
        .success,
    ).toBe(true);

    const replayCase = createDemoCase();
    const titlePrefix = "Factual incident report — ";
    replayCase.title = `${"t".repeat(500 - titlePrefix.length - 1)}😀`;
    const statementIdPrefix = "report-event-";
    const unicodeEventId = `${"e".repeat(118 - statementIdPrefix.length - 1)}😀-suffix`;
    replayCase.timelineEvents.push({
      ...structuredClone(replayCase.timelineEvents[0]!),
      id: unicodeEventId,
      title: "Unicode ID boundary event",
    });
    replayCase.branches
      .find((branch) => branch.id === replayCase.timelineEvents[0]?.branchId)
      ?.eventIds.push(unicodeEventId);

    const preview = buildReportPreview(replayCase, {
      generatedAt: "2026-08-27T10:00:00.000Z",
    });
    expect(XmlSafeShortTextSchema.safeParse(preview.title).success).toBe(true);
    expect(preview.title.length).toBeLessThanOrEqual(500);
    const unicodeEventStatement = preview.sections
      .flatMap((section) => section.statements)
      .find((entry) => entry.citations.workspacePaths.includes(`timelineEvents.${unicodeEventId}`));
    expect(unicodeEventStatement).toBeDefined();
    expect(XmlSafeIdSchema.safeParse(unicodeEventStatement?.id).success).toBe(true);
    expect(reportPreviewHasValidReviewBinding(preview)).toBe(true);
  });

  it("uses a browser-safe SHA-256 binding over canonical preview content and scope", () => {
    const preview = buildReportPreview(createDemoCase(), {
      generatedAt: "2026-08-27T10:00:00.000Z",
      branchIds: ["branch-baseline"],
      includeHypotheses: false,
    });
    const binding = preview.reviewBinding!;
    const unboundPreview = structuredClone(preview);
    delete unboundPreview.reviewBinding;
    const canonical = canonicalSerialize({
      preview: unboundPreview,
      branchIds: binding.branchIds,
      includeHypotheses: binding.includeHypotheses,
    });
    expect(binding.fingerprint).toBe(
      `sha256-${createHash("sha256").update(canonical).digest("hex")}`,
    );
    expect(reportPreviewHasValidReviewBinding(preview)).toBe(true);

    const tampered = structuredClone(preview);
    tampered.sections[0]!.statements[0]!.text = "Content changed after review.";
    expect(reportPreviewHasValidReviewBinding(tampered)).toBe(false);

    const withHypotheses = buildReportPreview(createDemoCase(), {
      generatedAt: preview.generatedAt,
      branchIds: ["branch-baseline"],
      includeHypotheses: true,
    });
    expect(withHypotheses.reviewBinding?.fingerprint).not.toBe(binding.fingerprint);
  });

  it("preserves each timeline event's recorded certainty without citation-based promotion", () => {
    const preview = buildReportPreview(createDemoCase(), {
      generatedAt: "2026-08-27T10:00:00.000Z",
    });
    const timeline = preview.sections.find((section) => section.id === "timeline")!;

    expect(
      timeline.statements.find((statement) => statement.id === "report-event-event-impact"),
    ).toMatchObject({ certainty: "uncertain" });
    expect(
      timeline.statements.find((statement) => statement.id === "report-event-event-evidence"),
    ).toMatchObject({ certainty: "confirmed" });
  });

  it("labels the hypothesis branch introduction as hypothesis content for human review", () => {
    const preview = buildReportPreview(createDemoCase(), {
      generatedAt: "2026-08-27T10:00:00.000Z",
    });
    const appendix = preview.sections.find((section) => section.id === "hypothesis-appendix")!;

    expect(
      appendix.statements.find(
        (statement) => statement.id === "report-branch-label-branch-baseline",
      ),
    ).toMatchObject({
      certainty: "hypothesis",
      text: expect.stringContaining("Hypothesis — Baseline reconstruction"),
    });
  });

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
    const preview = buildReportPreview(engine.state, {
      generatedAt: "2026-08-27T10:00:00.000Z",
    });
    const missingContentReview = engine.execute({
      type: "report.finalize",
      actor: "human",
      origin: "ui",
      expectedVersion: 1,
      unresolvedQuestionsReviewed: true,
      limitationsAcknowledged: true,
      confirmedFactsReviewed: true,
      manualConfirmation: true,
      reviewedPreview: reviewedPreview(preview),
    } as never);
    expect(missingContentReview).toMatchObject({
      ok: false,
      error: { code: "INVALID_COMMAND" },
    });
    expect(engine.state.reportSnapshots).toHaveLength(0);

    const result = engine.execute({
      type: "report.finalize",
      actor: "human",
      origin: "ui",
      expectedVersion: 1,
      unresolvedQuestionsReviewed: true,
      limitationsAcknowledged: true,
      confirmedFactsReviewed: true,
      includedUnconfirmedContentReviewed: true,
      manualConfirmation: true,
      reviewedPreview: reviewedPreview(preview),
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

  it("keeps edits and later finalization valid when the system clock moves backward", () => {
    let currentTime = "2026-08-29T12:05:00.000Z";
    let idCounter = 0;
    const engine = new ReplayEngine(createDemoCase(), {
      now: () => currentTime,
      idFactory: (prefix) => `${prefix}-clock-${++idCounter}`,
    });
    const firstPreview = buildReportPreview(engine.state, { generatedAt: currentTime });
    expect(
      engine.execute({
        type: "report.finalize",
        actor: "human",
        origin: "ui",
        expectedVersion: 1,
        unresolvedQuestionsReviewed: true,
        limitationsAcknowledged: true,
        confirmedFactsReviewed: true,
        includedUnconfirmedContentReviewed: true,
        manualConfirmation: true,
        reviewedPreview: reviewedPreview(firstPreview),
      }),
    ).toMatchObject({ ok: true, caseVersion: 2 });

    currentTime = "2026-08-29T12:04:00.000Z";
    expect(
      engine.execute({
        type: "case.update",
        actor: "human",
        origin: "ui",
        expectedVersion: 2,
        title: "Case remains editable after clock rollback",
      }),
    ).toMatchObject({ ok: true, caseVersion: 3 });
    expect(engine.state.updatedAt).toBe("2026-08-29T12:05:00.000Z");

    const secondPreview = buildReportPreview(engine.state, { generatedAt: currentTime });
    expect(
      engine.execute({
        type: "report.finalize",
        actor: "human",
        origin: "ui",
        expectedVersion: 3,
        unresolvedQuestionsReviewed: true,
        limitationsAcknowledged: true,
        confirmedFactsReviewed: true,
        includedUnconfirmedContentReviewed: true,
        manualConfirmation: true,
        reviewedPreview: reviewedPreview(secondPreview),
      }),
    ).toMatchObject({ ok: true, caseVersion: 4 });
    expect(engine.state.reportSnapshots.map((snapshot) => snapshot.createdAt)).toEqual([
      "2026-08-29T12:05:00.000Z",
      "2026-08-29T12:05:00.000Z",
    ]);
    expect(validateCaseReferences(engine.state)).toEqual([]);
  });

  it("rejects impossible outer history metadata on bound snapshots", () => {
    const engine = createEngine();
    const preview = buildReportPreview(engine.state, {
      generatedAt: "2026-08-27T10:00:00.000Z",
    });
    expect(
      engine.execute({
        type: "report.finalize",
        actor: "human",
        origin: "ui",
        unresolvedQuestionsReviewed: true,
        limitationsAcknowledged: true,
        confirmedFactsReviewed: true,
        includedUnconfirmedContentReviewed: true,
        manualConfirmation: true,
        reviewedPreview: reviewedPreview(preview),
      }).ok,
    ).toBe(true);
    const finalized = engine.state;
    expect(validateCaseReferences(finalized)).toEqual([]);

    const wrongCase = structuredClone(finalized);
    wrongCase.reportSnapshots[0]!.preview.caseId = "case-other";
    expect(validateCaseReferences(wrongCase)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "reportSnapshots.0.preview.caseId" }),
      ]),
    );

    const wrongVersion = structuredClone(finalized);
    wrongVersion.reportSnapshots[0]!.caseVersion = preview.caseVersion;
    expect(validateCaseReferences(wrongVersion)).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "reportSnapshots.0.caseVersion" })]),
    );

    const impossibleTime = structuredClone(finalized);
    impossibleTime.reportSnapshots[0]!.createdAt = "2026-08-27T09:59:59.000Z";
    expect(validateCaseReferences(impossibleTime)).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "reportSnapshots.0.createdAt" })]),
    );

    const twoSnapshots = structuredClone(finalized);
    const secondPreview = buildReportPreview(twoSnapshots, {
      generatedAt: "2026-08-27T10:01:00.000Z",
    });
    twoSnapshots.caseVersion = secondPreview.caseVersion + 1;
    twoSnapshots.updatedAt = "2026-08-27T10:02:00.000Z";
    twoSnapshots.reportSnapshots.push({
      id: "report-snapshot-history-order-test",
      caseVersion: twoSnapshots.caseVersion,
      createdAt: twoSnapshots.updatedAt,
      confirmedClaimIds: secondPreview.includedClaimIds.filter((claimId) =>
        twoSnapshots.claims.some(
          (claim) => claim.id === claimId && claim.status === "confirmed" && claim.humanConfirmed,
        ),
      ),
      includedEvidenceIds: secondPreview.includedEvidenceIds,
      unresolvedQuestionIds: secondPreview.unresolvedQuestionIds,
      branchIds: secondPreview.reviewBinding?.branchIds ?? [],
      humanAcknowledged: true,
      immutable: true,
      preview: secondPreview,
    });
    expect(validateCaseReferences(twoSnapshots)).toEqual([]);

    const reordered = structuredClone(twoSnapshots);
    reordered.reportSnapshots.reverse();
    expect(validateCaseReferences(reordered)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "reportSnapshots.1.caseVersion",
          message: expect.stringContaining("increasing"),
        }),
        expect.objectContaining({
          path: "reportSnapshots.1.createdAt",
          message: expect.stringContaining("chronological"),
        }),
      ]),
    );
  });

  it("binds human acknowledgement to the exact preview content, version, and branch scope", () => {
    const engine = createEngine();
    const preview = buildReportPreview(engine.state, {
      generatedAt: "2026-08-27T10:00:00.000Z",
      branchIds: ["branch-baseline"],
      includeHypotheses: false,
    });
    expect(preview.reviewBinding).toMatchObject({
      algorithm: "SHA-256",
      branchIds: ["branch-baseline"],
      includeHypotheses: false,
    });
    expect(preview.reviewBinding?.fingerprint).toMatch(/^sha256-[a-f0-9]{64}$/);

    const staleState = engine.execute({
      type: "case.update",
      actor: "human",
      origin: "ui",
      title: "Roundabout incident — title changed after review opened",
    });
    expect(staleState.ok).toBe(true);
    expect(
      engine.execute({
        type: "report.finalize",
        actor: "human",
        origin: "ui",
        unresolvedQuestionsReviewed: true,
        limitationsAcknowledged: true,
        confirmedFactsReviewed: true,
        includedUnconfirmedContentReviewed: true,
        manualConfirmation: true,
        reviewedPreview: reviewedPreview(preview),
      }),
    ).toMatchObject({ ok: false, error: { code: "REPORT_PREVIEW_STALE" } });
    expect(engine.state.reportSnapshots).toHaveLength(0);

    expect(
      engine.execute({
        type: "hypothesis.fork",
        actor: "agent",
        origin: "webmcp",
        expectedVersion: engine.state.caseVersion,
        requestId: "fork-after-stale-review",
        parentBranchId: "branch-baseline",
        branchId: "branch-not-reviewed",
        name: "Alternative not included in review",
        description: "A second active branch that the scoped report preview did not include.",
      }).ok,
    ).toBe(true);
    expect(engine.state.branches.filter((branch) => branch.status === "active")).toHaveLength(2);

    const scopedPreview = buildReportPreview(engine.state, {
      generatedAt: "2026-08-27T10:00:00.000Z",
      branchIds: ["branch-baseline"],
      includeHypotheses: false,
    });
    expect(
      engine.execute({
        type: "report.finalize",
        actor: "human",
        origin: "ui",
        expectedVersion: scopedPreview.caseVersion,
        unresolvedQuestionsReviewed: true,
        limitationsAcknowledged: true,
        confirmedFactsReviewed: true,
        includedUnconfirmedContentReviewed: true,
        manualConfirmation: true,
        reviewedPreview: reviewedPreview(scopedPreview),
      }).ok,
    ).toBe(true);
    expect(engine.state.reportSnapshots[0]?.branchIds).toEqual(["branch-baseline"]);
    expect(engine.state.reportSnapshots[0]?.preview.caseVersion).toBe(scopedPreview.caseVersion);
    expect(
      engine.state.reportSnapshots[0]?.preview.sections.find(
        (section) => section.id === "hypothesis-appendix",
      )?.statements,
    ).toEqual([]);
  });

  it("keeps finalized snapshot citations historical after live evidence changes", () => {
    const engine = createEngine();
    const preview = buildReportPreview(engine.state, {
      generatedAt: "2026-08-27T10:00:00.000Z",
    });
    expect(
      engine.execute({
        type: "report.finalize",
        actor: "human",
        origin: "ui",
        unresolvedQuestionsReviewed: true,
        limitationsAcknowledged: true,
        confirmedFactsReviewed: true,
        includedUnconfirmedContentReviewed: true,
        manualConfirmation: true,
        reviewedPreview: reviewedPreview(preview),
      }).ok,
    ).toBe(true);
    const historicalPreview = structuredClone(engine.state.reportSnapshots[0]!.preview);

    const deletion = engine.execute({
      type: "evidence.delete",
      actor: "human",
      origin: "ui",
      evidenceId: "evidence-overview",
      confirmed: true,
    });
    expect(deletion.ok).toBe(true);
    expect(engine.state.reportSnapshots[0]!.preview).toEqual(historicalPreview);
    expect(validateCaseReferences(engine.state)).toEqual([]);
    expect(
      validateConsistency(engine.state, { scope: "report" }).filter(
        (issue) => issue.ruleId === "report.invalid-evidence-citation",
      ),
    ).toEqual([]);
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
