import { Blob as NodeBlob } from "node:buffer";

import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildReportPreview,
  createDemoCase,
  importReplayCase,
  ReplayImportError,
  validateCaseReferences,
  type ReplayCase,
} from "../../src/domain";
import {
  completeEvidenceBlobPurge,
  deleteCaseLocally,
  legacyReplayDatabase,
  loadEvidenceBlob,
  loadLocalVault,
  loadMostRecentCase,
  ReplayDatabase,
  replayDatabase,
  resetLocalVault,
  saveCase,
  saveEvidenceBlob,
  type PersistedEvidenceBlob,
} from "../../src/persistence/database";

async function caseWithLocalEvidence(
  replayCase: ReplayCase,
  key: string,
): Promise<{ nextCase: ReplayCase; attachment: PersistedEvidenceBlob }> {
  const bytes = new TextEncoder().encode(`atomic evidence for ${key}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const checksum = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const blob = new Blob([bytes], { type: "image/png" });
  const nextCase = structuredClone(replayCase);
  nextCase.caseVersion += 1;
  nextCase.updatedAt = "2026-08-29T11:00:00.000Z";
  nextCase.evidence.push({
    id: `asset-${key.replace("evidence:", "")}`,
    name: "Atomic local evidence.png",
    mimeType: "image/png",
    sizeBytes: blob.size,
    localBlobKey: key,
    checksum,
    syntheticDemoAsset: false,
    source: "local-upload",
    createdAt: "2026-08-29T11:00:00.000Z",
    tags: [],
    annotations: [],
    annotationLinks: [],
    linkedClaimIds: [],
    linkedEventIds: [],
    linkedSceneObjectIds: [],
    linkedBranchIds: [],
    deleted: false,
  });
  return {
    nextCase,
    attachment: {
      key,
      caseId: replayCase.id,
      checksum,
      mimeType: "image/png",
      blob,
      createdAt: "2026-08-29T11:00:00.000Z",
    },
  };
}

function schemaVersionOnePayload(replayCase: ReplayCase): Record<string, unknown> {
  const payload = structuredClone(replayCase) as unknown as Record<string, unknown>;
  payload.schemaVersion = 1;
  delete payload.proposals;
  payload.evidence = replayCase.evidence.map((asset) => {
    const legacyAsset = structuredClone(asset) as Partial<typeof asset>;
    delete legacyAsset.annotationLinks;
    return legacyAsset;
  });
  return payload;
}

describe("local vault persistence and recovery", () => {
  beforeEach(async () => {
    await resetLocalVault();
  });

  afterEach(async () => {
    await resetLocalVault();
  });

  it("round-trips the most recent valid case and its local evidence blob", async () => {
    const replayCase = createDemoCase();
    await saveCase(replayCase);
    const blob = new Blob(["local evidence"], { type: "image/png" });
    await saveEvidenceBlob({
      key: "evidence:test-local",
      caseId: replayCase.id,
      checksum: "sha256-test-local",
      mimeType: "image/png",
      blob,
      createdAt: "2026-08-27T10:00:00.000Z",
    });

    expect(await loadMostRecentCase()).toEqual(replayCase);
    const restoredBlob = await loadEvidenceBlob("evidence:test-local");
    expect(restoredBlob).toBeDefined();
    expect(await replayDatabase.evidenceBlobs.get("evidence:test-local")).toMatchObject({
      caseId: replayCase.id,
      checksum: "sha256-test-local",
      mimeType: "image/png",
    });

    await deleteCaseLocally(replayCase.id);
    expect(await loadMostRecentCase()).toBeUndefined();
    expect(await loadEvidenceBlob("evidence:test-local")).toBeUndefined();
  });

  it("indexes every readable local case newest-first without duplicating legacy copies", async () => {
    const alpha = createDemoCase();
    alpha.id = "case-local-alpha";
    alpha.title = "Alpha";
    alpha.createdAt = "2026-08-29T09:00:00.000Z";
    alpha.updatedAt = "2026-08-29T09:00:00.000Z";
    const beta = createDemoCase();
    beta.id = "case-local-beta";
    beta.title = "Beta";
    beta.createdAt = "2026-08-29T10:00:00.000Z";
    beta.updatedAt = "2026-08-29T10:00:00.000Z";

    await saveCase(alpha);
    await saveCase(beta);
    await legacyReplayDatabase.cases.put({
      id: alpha.id,
      updatedAt: alpha.updatedAt,
      schemaVersion: alpha.schemaVersion,
      ...(alpha.seedVersion === undefined ? {} : { seedVersion: alpha.seedVersion }),
      payload: structuredClone(alpha),
    });

    const result = await loadLocalVault();

    expect(result.replayCase?.id).toBe(beta.id);
    expect(result.localCases).toEqual([
      {
        id: beta.id,
        title: beta.title,
        updatedAt: beta.updatedAt,
        caseVersion: beta.caseVersion,
      },
      {
        id: alpha.id,
        title: alpha.title,
        updatedAt: alpha.updatedAt,
        caseVersion: alpha.caseVersion,
      },
    ]);
  });

  it("loads and trusts an authentic schema-v1 local wrapper after migrating its payload to v2", async () => {
    const current = createDemoCase();
    const legacyPayload = schemaVersionOnePayload(current);
    await legacyReplayDatabase.cases.put({
      id: current.id,
      updatedAt: current.updatedAt,
      schemaVersion: 1,
      ...(current.seedVersion === undefined ? {} : { seedVersion: current.seedVersion }),
      payload: legacyPayload as never,
    });

    const result = await loadLocalVault();

    expect(result.retainedRecoveryRecords).toEqual([]);
    expect(result.replayCase).toMatchObject({
      id: current.id,
      schemaVersion: 2,
      updatedAt: current.updatedAt,
      proposals: [],
    });
    expect(result.replayCase?.evidence.every((asset) => asset.annotationLinks.length === 0)).toBe(
      true,
    );
    expect(result.replayCase?.claims.find((claim) => claim.id === "claim-road-wet")).toMatchObject({
      status: "confirmed",
      humanConfirmed: true,
      confirmedAt: current.claims.find((claim) => claim.id === "claim-road-wet")?.confirmedAt,
    });
  });

  it("repairs legacy local reciprocal links once while file imports and persistence writes stay strict", async () => {
    const legacy = createDemoCase();
    const marker = legacy.actors[0]?.damageMarkers[0];
    const markerClaim = legacy.claims.find((claim) => claim.id === "claim-damage-a");
    const legacyGlobalClaim = legacy.claims.find((claim) => claim.id === "claim-indicator");
    const markerEvidence = legacy.evidence.find((asset) => asset.id === "evidence-damage-a");
    const unrelatedEvidence = legacy.evidence.find((asset) => asset.id === "evidence-road");
    const evidenceEvent = legacy.timelineEvents.find((event) => event.id === "event-evidence");
    if (
      !marker ||
      !markerClaim ||
      !legacyGlobalClaim ||
      !markerEvidence ||
      !unrelatedEvidence ||
      !evidenceEvent
    ) {
      throw new Error("Legacy reciprocal-link fixtures are incomplete");
    }

    markerEvidence.linkedSceneObjectIds = markerEvidence.linkedSceneObjectIds.filter(
      (sceneObjectId) => sceneObjectId !== marker.id,
    );
    markerClaim.linkedSceneObjectIds = markerClaim.linkedSceneObjectIds.filter(
      (sceneObjectId) => sceneObjectId !== marker.id,
    );
    const duplicatedEvidenceId = marker.linkedEvidenceIds[0];
    if (!duplicatedEvidenceId) throw new Error("Legacy marker evidence fixture is empty");
    marker.linkedEvidenceIds.push(duplicatedEvidenceId);
    unrelatedEvidence.linkedClaimIds.push(markerClaim.id);
    unrelatedEvidence.linkedEventIds = unrelatedEvidence.linkedEventIds.filter(
      (eventId) => eventId !== evidenceEvent.id,
    );
    legacyGlobalClaim.sharedAcrossBranches = false;

    expect(() =>
      importReplayCase(JSON.stringify(legacy), { trustHumanAttestations: true }),
    ).toThrow(ReplayImportError);
    // No record owns this ID yet: the write boundary rejects the malformed
    // incoming state rather than relying on validation of an existing wrapper.
    await expect(saveCase(legacy)).rejects.toBeInstanceOf(ReplayImportError);
    await expect(replayDatabase.cases.get(legacy.id)).resolves.toBeUndefined();
    await replayDatabase.cases.put({
      id: legacy.id,
      updatedAt: legacy.updatedAt,
      schemaVersion: legacy.schemaVersion,
      ...(legacy.seedVersion === undefined ? {} : { seedVersion: legacy.seedVersion }),
      payload: legacy,
    });

    const loaded = await loadLocalVault();
    const repaired = loaded.replayCase;
    expect(loaded.retainedRecoveryRecords).toEqual([]);
    expect(repaired).toBeDefined();
    if (!repaired) throw new Error("Expected the local legacy record to be repaired");
    expect(repaired.caseVersion).toBe(legacy.caseVersion + 1);
    expect(
      repaired.activity.filter(
        (activity) => activity.actionType === "case.local-reciprocal-links-repaired",
      ),
    ).toHaveLength(1);
    expect(
      repaired.actors[0]?.damageMarkers[0]?.linkedEvidenceIds.filter(
        (evidenceId) => evidenceId === markerEvidence.id,
      ),
    ).toEqual([markerEvidence.id]);
    expect(
      repaired.evidence
        .find((asset) => asset.id === markerEvidence.id)
        ?.linkedSceneObjectIds.includes(marker.id),
    ).toBe(true);
    expect(
      repaired.claims
        .find((claim) => claim.id === markerClaim.id)
        ?.linkedSceneObjectIds.includes(marker.id),
    ).toBe(true);
    expect(
      repaired.evidence.find((asset) => asset.id === unrelatedEvidence.id)?.linkedClaimIds,
    ).toEqual(["claim-road-wet"]);
    expect(repaired.claims.find((claim) => claim.id === markerClaim.id)?.linkedEvidenceIds).toEqual(
      [markerEvidence.id],
    );
    expect(
      repaired.evidence.find((asset) => asset.id === unrelatedEvidence.id)?.linkedEventIds,
    ).toContain(evidenceEvent.id);
    expect(
      repaired.claims.find((claim) => claim.id === legacyGlobalClaim.id)?.sharedAcrossBranches,
    ).toBe(true);
    expect(repaired.branches[0]?.sharedClaimIds).toContain(legacyGlobalClaim.id);
    expect(validateCaseReferences(repaired)).toEqual([]);

    await saveCase(repaired);
    const canonicalRecord = await replayDatabase.cases.get(legacy.id);
    expect(canonicalRecord?.payload).toEqual(repaired);
    expect(() =>
      importReplayCase(canonicalRecord?.payload, { trustHumanAttestations: true }),
    ).not.toThrow();

    const secondLoad = await loadLocalVault();
    expect(secondLoad.replayCase).toEqual(repaired);
    expect(
      secondLoad.replayCase?.activity.filter(
        (activity) => activity.actionType === "case.local-reciprocal-links-repaired",
      ),
    ).toHaveLength(1);
  });

  it("retains a v1 payload whose wrapper falsely claims the current schema", async () => {
    const current = createDemoCase();
    await replayDatabase.cases.put({
      id: current.id,
      updatedAt: current.updatedAt,
      schemaVersion: 2,
      ...(current.seedVersion === undefined ? {} : { seedVersion: current.seedVersion }),
      payload: schemaVersionOnePayload(current) as never,
    });

    const result = await loadLocalVault();

    expect(result.replayCase).toBeUndefined();
    expect(result.retainedRecoveryRecords).toHaveLength(1);
    expect(result.retainedRecoveryRecords[0]?.reason).toContain(
      "wrapper schema version does not match its payload",
    );
    await expect(replayDatabase.cases.get(current.id)).resolves.toBeDefined();
  });

  it("retains malformed persisted data for recovery instead of deleting it", async () => {
    const replayCase = createDemoCase();
    await replayDatabase.cases.put({
      id: replayCase.id,
      updatedAt: replayCase.updatedAt,
      schemaVersion: replayCase.schemaVersion,
      ...(replayCase.seedVersion === undefined ? {} : { seedVersion: replayCase.seedVersion }),
      payload: { ...replayCase, schemaVersion: 999 } as never,
    });

    const result = await loadLocalVault();
    expect(result.replayCase).toBeUndefined();
    expect(result.retainedRecoveryRecords).toHaveLength(1);
    expect(result.retainedRecoveryRecords[0]).toMatchObject({
      vault: "current",
      record: { id: replayCase.id },
    });
    await expect(replayDatabase.cases.get(replayCase.id)).resolves.toBeDefined();
  });

  it("retains a case with a tampered bound snapshot for recovery while accepting legacy unbound snapshots", async () => {
    const tampered = createDemoCase();
    const preview = buildReportPreview(tampered, {
      generatedAt: "2026-08-29T12:00:00.000Z",
    });
    tampered.reportSnapshots.push({
      id: "report-snapshot-bound-integrity-test",
      caseVersion: tampered.caseVersion,
      createdAt: "2026-08-29T12:05:00.000Z",
      confirmedClaimIds: preview.includedClaimIds.filter((claimId) =>
        tampered.claims.some(
          (claim) => claim.id === claimId && claim.status === "confirmed" && claim.humanConfirmed,
        ),
      ),
      includedEvidenceIds: preview.includedEvidenceIds,
      unresolvedQuestionIds: preview.unresolvedQuestionIds,
      branchIds: preview.reviewBinding?.branchIds ?? ["branch-baseline"],
      humanAcknowledged: true,
      immutable: true,
      preview,
    });
    const boundSnapshot = tampered.reportSnapshots[0];
    if (!boundSnapshot) throw new Error("Expected the bound snapshot fixture");
    boundSnapshot.preview.title = "Tampered after the review binding was created";
    await replayDatabase.cases.put({
      id: tampered.id,
      updatedAt: tampered.updatedAt,
      schemaVersion: tampered.schemaVersion,
      ...(tampered.seedVersion === undefined ? {} : { seedVersion: tampered.seedVersion }),
      payload: tampered,
    });

    const rejected = await loadLocalVault();
    expect(rejected.replayCase).toBeUndefined();
    expect(rejected.retainedRecoveryRecords).toHaveLength(1);
    expect(rejected.retainedRecoveryRecords[0]?.reason).toContain("invalid object references");
    await expect(replayDatabase.cases.get(tampered.id)).resolves.toBeDefined();

    await resetLocalVault();
    const legacy = createDemoCase();
    const legacyPreview = buildReportPreview(legacy, {
      generatedAt: "2026-08-29T12:00:00.000Z",
    });
    delete legacyPreview.reviewBinding;
    legacy.reportSnapshots.push({
      id: "report-snapshot-legacy-unbound-test",
      caseVersion: legacy.caseVersion,
      createdAt: "2026-08-29T12:05:00.000Z",
      confirmedClaimIds: legacyPreview.includedClaimIds.filter((claimId) =>
        legacy.claims.some(
          (claim) => claim.id === claimId && claim.status === "confirmed" && claim.humanConfirmed,
        ),
      ),
      includedEvidenceIds: legacyPreview.includedEvidenceIds,
      unresolvedQuestionIds: legacyPreview.unresolvedQuestionIds,
      branchIds: legacy.branches.map((branch) => branch.id),
      humanAcknowledged: true,
      immutable: true,
      preview: legacyPreview,
    });
    await saveCase(legacy);
    await expect(loadMostRecentCase()).resolves.toEqual(legacy);
  });

  it("surfaces missing or malformed evidence bytes when case metadata expects them", async () => {
    const replayCase = createDemoCase();
    const expected = {
      caseId: replayCase.id,
      checksum: "a".repeat(64),
      mimeType: "image/png",
    };

    await expect(loadEvidenceBlob("evidence:missing", expected)).rejects.toMatchObject({
      code: "EVIDENCE_BLOB_INTEGRITY",
      message: expect.stringContaining("missing"),
    });

    await replayDatabase.evidenceBlobs.put({
      key: "evidence:malformed",
      caseId: replayCase.id,
      checksum: expected.checksum,
      mimeType: expected.mimeType,
      blob: "not-a-blob",
      createdAt: "2026-08-27T10:00:00.000Z",
    } as never);
    await expect(loadEvidenceBlob("evidence:malformed", expected)).rejects.toMatchObject({
      code: "EVIDENCE_BLOB_INTEGRITY",
      message: expect.stringContaining("readable image blob"),
    });
  });

  it("verifies persisted evidence bytes against their SHA-256 checksum", async () => {
    const replayCase = createDemoCase();
    const original = new NodeBlob(["verified evidence"], { type: "image/png" });
    const checksum = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", await original.arrayBuffer())),
    ]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const expected = { caseId: replayCase.id, checksum, mimeType: "image/png" };
    await saveEvidenceBlob({
      key: "evidence:verified",
      ...expected,
      blob: original as unknown as Blob,
      createdAt: "2026-08-27T10:00:00.000Z",
    });

    await expect(loadEvidenceBlob("evidence:verified", expected)).resolves.toBeDefined();

    await replayDatabase.evidenceBlobs.update("evidence:verified", {
      blob: new NodeBlob(["tampered evidence"], { type: "image/png" }) as unknown as Blob,
    });
    await expect(loadEvidenceBlob("evidence:verified", expected)).rejects.toMatchObject({
      code: "EVIDENCE_BLOB_INTEGRITY",
      message: expect.stringContaining("checksum"),
    });
  });

  it("loads the newest valid case while retaining every malformed outer wrapper and payload", async () => {
    const replayCase = createDemoCase();
    await saveCase(replayCase);
    const invalidPayload = structuredClone(replayCase);
    invalidPayload.id = "case-invalid-payload";
    invalidPayload.updatedAt = "2026-08-27T11:00:00.000Z";
    invalidPayload.schemaVersion = 999 as never;

    await replayDatabase.cases.bulkPut([
      {
        id: "case-invalid-wrapper",
        updatedAt: 42,
        schemaVersion: replayCase.schemaVersion,
        payload: replayCase,
      } as never,
      {
        id: invalidPayload.id,
        updatedAt: invalidPayload.updatedAt,
        schemaVersion: 999,
        payload: invalidPayload,
      } as never,
    ]);

    const result = await loadLocalVault();
    expect(result.replayCase).toEqual(replayCase);
    expect(result.retainedRecoveryRecords).toHaveLength(2);
    expect(result.retainedRecoveryRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          vault: "current",
          record: expect.objectContaining({ id: "case-invalid-wrapper" }),
          reason: expect.stringContaining("update time"),
        }),
        expect.objectContaining({
          vault: "current",
          record: expect.objectContaining({ id: "case-invalid-payload" }),
        }),
      ]),
    );
  });

  it("never overwrites an unreadable record that already owns the case id", async () => {
    const replayCase = createDemoCase();
    await replayDatabase.cases.put({
      id: replayCase.id,
      updatedAt: 42,
      schemaVersion: replayCase.schemaVersion,
      payload: { id: replayCase.id },
    } as never);

    await expect(saveCase(replayCase)).rejects.toMatchObject({
      code: "LOCAL_VAULT_RECOVERY_REQUIRED",
    });
    await expect(replayDatabase.cases.get(replayCase.id)).resolves.toMatchObject({
      updatedAt: 42,
      payload: { id: replayCase.id },
    });
  });

  it("rejects a stale tab write with compare-and-swap semantics", async () => {
    const first = createDemoCase();
    await saveCase(first);
    const newer = structuredClone(first);
    newer.caseVersion = 2;
    newer.updatedAt = "2026-08-27T10:01:00.000Z";
    await saveCase(newer, { expectedCaseVersion: 1 });

    const stale = structuredClone(first);
    stale.caseVersion = 2;
    stale.updatedAt = "2026-08-27T10:02:00.000Z";
    stale.title = "Stale tab overwrite";
    await expect(saveCase(stale, { expectedCaseVersion: 1 })).rejects.toMatchObject({
      code: "LOCAL_VAULT_CONFLICT",
      persistedCaseVersion: 2,
    });
    await expect(loadMostRecentCase()).resolves.toMatchObject({
      title: first.title,
      caseVersion: 2,
    });
  });

  it("rejects a compare-and-swap save when its baseline case was removed", async () => {
    const baseline = createDemoCase();
    await saveCase(baseline);
    await deleteCaseLocally(baseline.id);
    const stale = structuredClone(baseline);
    stale.caseVersion = 2;
    stale.updatedAt = "2026-08-29T10:10:00.000Z";

    await expect(saveCase(stale, { expectedCaseVersion: 1 })).rejects.toMatchObject({
      code: "LOCAL_VAULT_CONFLICT",
      persistedCaseVersion: undefined,
      message: expect.stringContaining("no longer exists in the local vault"),
    });
    await expect(replayDatabase.cases.get(stale.id)).resolves.toBeUndefined();
    await expect(replayDatabase.evidenceBlobs.count()).resolves.toBe(0);
    await expect(replayDatabase.evidencePurges.count()).resolves.toBe(0);
  });

  it("leaves no case or evidence bytes when an upload baseline was removed", async () => {
    const baseline = createDemoCase();
    await saveCase(baseline);
    await resetLocalVault();
    const { nextCase, attachment } = await caseWithLocalEvidence(
      baseline,
      "evidence:removed-upload-baseline",
    );

    await expect(
      saveCase(nextCase, {
        expectedCaseVersion: baseline.caseVersion,
        attachEvidenceBlobs: [attachment],
      }),
    ).rejects.toMatchObject({
      code: "LOCAL_VAULT_CONFLICT",
      persistedCaseVersion: undefined,
    });
    await expect(replayDatabase.cases.get(baseline.id)).resolves.toBeUndefined();
    await expect(replayDatabase.evidenceBlobs.get(attachment.key)).resolves.toBeUndefined();
    await expect(replayDatabase.evidencePurges.get(attachment.key)).resolves.toBeUndefined();
  });

  it("leaves evidence bytes untouched when a purge baseline was removed", async () => {
    const baseline = createDemoCase();
    await saveCase(baseline);
    const key = "evidence:removed-purge-baseline";
    const persistedBlob = {
      key,
      caseId: baseline.id,
      checksum: "f".repeat(64),
      mimeType: "image/png",
      blob: new Blob(["retained local evidence"], { type: "image/png" }),
      createdAt: "2026-08-29T10:20:00.000Z",
    };
    await saveEvidenceBlob(persistedBlob);
    await replayDatabase.cases.delete(baseline.id);
    const staleTombstone = structuredClone(baseline);
    staleTombstone.caseVersion = 2;
    staleTombstone.updatedAt = "2026-08-29T10:21:00.000Z";

    await expect(
      saveCase(staleTombstone, {
        expectedCaseVersion: baseline.caseVersion,
        purgeEvidenceBlobKeys: [key],
      }),
    ).rejects.toMatchObject({
      code: "LOCAL_VAULT_CONFLICT",
      persistedCaseVersion: undefined,
    });
    await expect(replayDatabase.cases.get(baseline.id)).resolves.toBeUndefined();
    await expect(replayDatabase.evidenceBlobs.get(key)).resolves.toMatchObject({
      key,
      caseId: baseline.id,
      checksum: persistedBlob.checksum,
      mimeType: persistedBlob.mimeType,
      createdAt: persistedBlob.createdAt,
    });
    await expect(replayDatabase.evidenceBlobs.count()).resolves.toBe(1);
    await expect(replayDatabase.evidencePurges.get(key)).resolves.toBeUndefined();
  });

  it("atomically commits uploaded evidence metadata and bytes", async () => {
    const replayCase = createDemoCase();
    await saveCase(replayCase);
    const { nextCase, attachment } = await caseWithLocalEvidence(
      replayCase,
      "evidence:atomic-upload",
    );

    await saveCase(nextCase, {
      expectedCaseVersion: replayCase.caseVersion,
      attachEvidenceBlobs: [attachment],
    });

    await expect(loadMostRecentCase()).resolves.toEqual(nextCase);
    await expect(replayDatabase.evidenceBlobs.get(attachment.key)).resolves.toMatchObject({
      caseId: replayCase.id,
      checksum: attachment.checksum,
    });
  });

  it("leaves neither metadata nor bytes when an upload CAS fails", async () => {
    const replayCase = createDemoCase();
    await saveCase(replayCase);
    const concurrent = structuredClone(replayCase);
    concurrent.caseVersion += 1;
    concurrent.updatedAt = "2026-08-29T10:30:00.000Z";
    concurrent.title = "Concurrent durable edit";
    await saveCase(concurrent, { expectedCaseVersion: replayCase.caseVersion });
    const { nextCase, attachment } = await caseWithLocalEvidence(
      replayCase,
      "evidence:cas-rejected-upload",
    );

    await expect(
      saveCase(nextCase, {
        expectedCaseVersion: replayCase.caseVersion,
        attachEvidenceBlobs: [attachment],
      }),
    ).rejects.toMatchObject({ code: "LOCAL_VAULT_CONFLICT" });
    await expect(replayDatabase.evidenceBlobs.get(attachment.key)).resolves.toBeUndefined();
    await expect(loadMostRecentCase()).resolves.toMatchObject({
      caseVersion: concurrent.caseVersion,
      title: concurrent.title,
    });
  });

  it("rolls back upload metadata when the byte write fails mid-transaction", async () => {
    const replayCase = createDemoCase();
    await saveCase(replayCase);
    const { nextCase, attachment } = await caseWithLocalEvidence(
      replayCase,
      "evidence:interrupted-upload",
    );
    const byteWrite = vi
      .spyOn(replayDatabase.evidenceBlobs, "bulkPut")
      .mockRejectedValueOnce(new Error("Simulated evidence byte write interruption."));

    try {
      await expect(
        saveCase(nextCase, {
          expectedCaseVersion: replayCase.caseVersion,
          attachEvidenceBlobs: [attachment],
        }),
      ).rejects.toThrow("Simulated evidence byte write interruption");
    } finally {
      byteWrite.mockRestore();
    }
    await expect(replayDatabase.evidenceBlobs.get(attachment.key)).resolves.toBeUndefined();
    await expect(loadMostRecentCase()).resolves.toEqual(replayCase);
  });

  it("does not reject a durable save when advisory cross-tab notification fails", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "BroadcastChannel");
    function FailingBroadcastChannel(this: unknown): never {
      throw new Error("Simulated BroadcastChannel failure.");
    }
    Object.defineProperty(globalThis, "BroadcastChannel", {
      configurable: true,
      value: FailingBroadcastChannel as unknown as typeof BroadcastChannel,
    });

    const replayCase = createDemoCase();
    try {
      await expect(saveCase(replayCase)).resolves.toBeUndefined();
      await expect(loadMostRecentCase()).resolves.toEqual(replayCase);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, "BroadcastChannel", originalDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "BroadcastChannel");
      }
    }
  });

  it("atomically saves a tombstone with a durable purge and reconciles legacy bytes on startup", async () => {
    const replayCase = createDemoCase();
    await saveCase(replayCase);
    const key = "evidence:crash-safe-purge";
    const persistedBlob = {
      key,
      caseId: replayCase.id,
      checksum: "c".repeat(64),
      mimeType: "image/png",
      blob: new Blob(["local evidence"], { type: "image/png" }),
      createdAt: "2026-08-29T10:00:00.000Z",
    };
    await Promise.all([
      saveEvidenceBlob(persistedBlob),
      legacyReplayDatabase.evidenceBlobs.put(persistedBlob),
    ]);
    const tombstone = structuredClone(replayCase);
    tombstone.caseVersion = 2;
    tombstone.updatedAt = "2026-08-29T10:01:00.000Z";

    await saveCase(tombstone, {
      expectedCaseVersion: 1,
      purgeEvidenceBlobKeys: [key],
    });

    await expect(replayDatabase.evidenceBlobs.get(key)).resolves.toBeUndefined();
    await expect(legacyReplayDatabase.evidenceBlobs.get(key)).resolves.toBeDefined();
    await expect(replayDatabase.evidencePurges.get(key)).resolves.toMatchObject({
      key,
      caseId: replayCase.id,
    });

    await expect(loadLocalVault()).resolves.toMatchObject({
      replayCase: tombstone,
      evidencePurgeCleanup: {
        attempted: 1,
        completed: 1,
        failed: 0,
        pending: 0,
      },
    });
    await expect(legacyReplayDatabase.evidenceBlobs.get(key)).resolves.toBeUndefined();
    await expect(replayDatabase.evidencePurges.get(key)).resolves.toBeUndefined();
  });

  it("reports queued evidence bytes that startup cleanup could not remove and clears the warning state after recovery", async () => {
    const replayCase = createDemoCase();
    await saveCase(replayCase);
    const key = "evidence:private-cleanup-target";
    const persistedBlob = {
      key,
      caseId: "case-unrelated-owner",
      checksum: "e".repeat(64),
      mimeType: "image/png",
      blob: new Blob(["private local evidence"], { type: "image/png" }),
      createdAt: "2026-08-29T10:00:00.000Z",
    };
    await legacyReplayDatabase.evidenceBlobs.put(persistedBlob);
    await replayDatabase.evidencePurges.put({
      key,
      caseId: replayCase.id,
      createdAt: "2026-08-29T10:01:00.000Z",
    });

    const failedStartupCleanup = await loadLocalVault();

    expect(failedStartupCleanup.evidencePurgeCleanup).toEqual({
      attempted: 1,
      completed: 0,
      failed: 1,
      pending: 1,
    });
    await expect(legacyReplayDatabase.evidenceBlobs.get(key)).resolves.toBeDefined();
    await expect(replayDatabase.evidencePurges.get(key)).resolves.toBeDefined();

    await legacyReplayDatabase.evidenceBlobs.update(key, { caseId: replayCase.id });

    const recoveredStartupCleanup = await loadLocalVault();

    expect(recoveredStartupCleanup.evidencePurgeCleanup).toEqual({
      attempted: 1,
      completed: 1,
      failed: 0,
      pending: 0,
    });
    await expect(legacyReplayDatabase.evidenceBlobs.get(key)).resolves.toBeUndefined();
    await expect(replayDatabase.evidencePurges.get(key)).resolves.toBeUndefined();
  });

  it("keeps evidence bytes when tombstone compare-and-swap fails", async () => {
    const replayCase = createDemoCase();
    await saveCase(replayCase);
    const key = "evidence:failed-tombstone";
    await saveEvidenceBlob({
      key,
      caseId: replayCase.id,
      checksum: "d".repeat(64),
      mimeType: "image/png",
      blob: new Blob(["local evidence"], { type: "image/png" }),
      createdAt: "2026-08-29T10:00:00.000Z",
    });
    const concurrent = structuredClone(replayCase);
    concurrent.caseVersion = 2;
    concurrent.updatedAt = "2026-08-29T10:01:00.000Z";
    await saveCase(concurrent, { expectedCaseVersion: 1 });
    const staleTombstone = structuredClone(replayCase);
    staleTombstone.caseVersion = 3;
    staleTombstone.updatedAt = "2026-08-29T10:02:00.000Z";

    await expect(
      saveCase(staleTombstone, {
        expectedCaseVersion: 1,
        purgeEvidenceBlobKeys: [key],
      }),
    ).rejects.toMatchObject({ code: "LOCAL_VAULT_CONFLICT" });
    await expect(replayDatabase.evidenceBlobs.get(key)).resolves.toBeDefined();
    await expect(replayDatabase.evidencePurges.get(key)).resolves.toBeUndefined();

    await completeEvidenceBlobPurge(key, replayCase.id);
  });
});

describe("IndexedDB schema migration", () => {
  it("upgrades v1 without data loss and removes the legacy unique checksum constraint", async () => {
    const databaseName = `replay-migration-${crypto.randomUUID()}`;
    const legacy = new Dexie(databaseName);
    legacy.version(1).stores({
      cases: "&id, updatedAt, schemaVersion, seedVersion",
      evidenceBlobs: "&key, caseId, &checksum, createdAt",
    });
    await legacy.open();
    await legacy.table("evidenceBlobs").add({
      key: "evidence:legacy-a",
      caseId: "case-a",
      checksum: "shared-checksum",
      mimeType: "image/png",
      blob: new Blob(["a"], { type: "image/png" }),
      createdAt: "2026-08-27T10:00:00.000Z",
    });
    legacy.close();

    const upgraded = new ReplayDatabase(databaseName);
    try {
      await upgraded.open();
      await upgraded.evidenceBlobs.add({
        key: "evidence:legacy-b",
        caseId: "case-b",
        checksum: "shared-checksum",
        mimeType: "image/png",
        blob: new Blob(["b"], { type: "image/png" }),
        createdAt: "2026-08-27T10:01:00.000Z",
      });

      expect(await upgraded.evidenceBlobs.toArray()).toHaveLength(2);
      expect(await upgraded.evidencePurges.toArray()).toEqual([]);
      expect(upgraded.verno).toBe(3);
    } finally {
      upgraded.close();
      await Dexie.delete(databaseName);
    }
  });
});
