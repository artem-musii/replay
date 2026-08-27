import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDemoCase } from "../../src/domain";
import {
  deleteCaseLocally,
  loadEvidenceBlob,
  loadLocalVault,
  loadMostRecentCase,
  ReplayDatabase,
  replayDatabase,
  resetLocalVault,
  saveCase,
  saveEvidenceBlob,
} from "../../src/persistence/database";

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
      expect(upgraded.verno).toBe(2);
    } finally {
      upgraded.close();
      await Dexie.delete(databaseName);
    }
  });
});
