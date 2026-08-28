import Dexie, { type EntityTable } from "dexie";

import { importReplayCase, type ReplayCase } from "../domain";

export interface PersistedCaseRecord {
  id: string;
  updatedAt: string;
  schemaVersion: number;
  seedVersion?: number;
  payload: ReplayCase;
}

export interface PersistedEvidenceBlob {
  key: string;
  caseId: string;
  checksum: string;
  mimeType: string;
  blob: Blob;
  createdAt: string;
}

export interface RetainedRecoveryRecord {
  vault: "current" | "legacy";
  /** The untouched IndexedDB value, including malformed outer wrappers. */
  record: unknown;
  reason: string;
}

export interface LocalVaultLoadResult {
  replayCase?: ReplayCase;
  retainedRecoveryRecords: RetainedRecoveryRecord[];
}

export interface SaveCaseOptions {
  expectedCaseVersion?: number;
  force?: boolean;
  writerId?: string;
}

export class LocalVaultConflictError extends Error {
  readonly code = "LOCAL_VAULT_CONFLICT" as const;
  readonly persistedCaseVersion: number;

  constructor(persistedCaseVersion: number) {
    super(
      `Another REPLAY page saved case version ${persistedCaseVersion}. Reload the latest local case before editing.`,
    );
    this.name = "LocalVaultConflictError";
    this.persistedCaseVersion = persistedCaseVersion;
  }
}

export class LocalVaultRecoveryRequiredError extends Error {
  readonly code = "LOCAL_VAULT_RECOVERY_REQUIRED" as const;

  constructor(reason: string) {
    super(
      `An unreadable local record already uses this case id. Download its raw recovery copy before clearing site data. ${reason}`,
    );
    this.name = "LocalVaultRecoveryRequiredError";
  }
}

export class EvidenceBlobIntegrityError extends Error {
  readonly code = "EVIDENCE_BLOB_INTEGRITY" as const;

  constructor(message: string) {
    super(message);
    this.name = "EvidenceBlobIntegrityError";
  }
}

export class ReplayDatabase extends Dexie {
  cases!: EntityTable<PersistedCaseRecord, "id">;
  evidenceBlobs!: EntityTable<PersistedEvidenceBlob, "key">;

  constructor(databaseName = "replay-local-vault") {
    super(databaseName);
    this.version(1).stores({
      cases: "&id, updatedAt, schemaVersion, seedVersion",
      evidenceBlobs: "&key, caseId, &checksum, createdAt",
    });
    this.version(2).stores({
      cases: "&id, updatedAt, schemaVersion, seedVersion",
      evidenceBlobs: "&key, caseId, checksum, createdAt",
    });
  }
}

/**
 * Schema-v2 data lives on a distinct origin-local database so rolling the app
 * back to a schema-v1 build can never reject or delete a newer record.
 */
export const replayDatabase = new ReplayDatabase("replay-local-vault-v2");
export const legacyReplayDatabase = new ReplayDatabase("replay-local-vault");

export async function saveCase(
  replayCase: ReplayCase,
  options: SaveCaseOptions = {},
): Promise<void> {
  const record: PersistedCaseRecord = {
    id: replayCase.id,
    updatedAt: replayCase.updatedAt,
    schemaVersion: replayCase.schemaVersion,
    ...(replayCase.seedVersion === undefined ? {} : { seedVersion: replayCase.seedVersion }),
    payload: structuredClone(replayCase),
  };
  await replayDatabase.transaction("rw", replayDatabase.cases, async () => {
    const persisted = (await replayDatabase.cases.get(replayCase.id)) as unknown;
    let importedPersisted: ReplayCase | undefined;
    if (persisted !== undefined) {
      const validation = validatePersistedCaseRecord({
        vault: "current",
        record: persisted,
        sourceOrder: 0,
      });
      if (!validation.ok) throw new LocalVaultRecoveryRequiredError(validation.reason);
      try {
        importedPersisted = importValidatedCaseCandidate(validation.candidate);
      } catch (error) {
        throw new LocalVaultRecoveryRequiredError(
          error instanceof Error ? error.message : "The existing case record is invalid.",
        );
      }
      if (JSON.stringify(importedPersisted) === JSON.stringify(replayCase)) return;
    }
    if (!options.force && importedPersisted) {
      const expected = options.expectedCaseVersion;
      if (
        (expected !== undefined && importedPersisted.caseVersion !== expected) ||
        (expected === undefined && importedPersisted.caseVersion >= replayCase.caseVersion)
      ) {
        throw new LocalVaultConflictError(importedPersisted.caseVersion);
      }
    }
    await replayDatabase.cases.put(record);
  });
  if (typeof BroadcastChannel !== "undefined") {
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel("replay-local-vault-updates");
      channel.postMessage({
        caseId: replayCase.id,
        caseVersion: replayCase.caseVersion,
        updatedAt: replayCase.updatedAt,
        writerId: options.writerId,
      });
    } catch {
      // Cross-tab notification is advisory. Once the IndexedDB transaction
      // commits, a BroadcastChannel implementation failure must not report the
      // durable save as failed to the caller.
    } finally {
      try {
        channel?.close();
      } catch {
        // Closing the advisory channel cannot change persistence durability.
      }
    }
  }
}

export async function loadMostRecentCase(): Promise<ReplayCase | undefined> {
  return (await loadLocalVault()).replayCase;
}

export async function loadLocalVault(): Promise<LocalVaultLoadResult> {
  const [currentRecords, legacyRecords] = await Promise.all([
    replayDatabase.cases.toArray(),
    legacyReplayDatabase.cases.toArray(),
  ]);
  return inspectCaseRecords([
    ...currentRecords.map((record, index) => ({
      vault: "current" as const,
      record: record as unknown,
      sourceOrder: index,
    })),
    ...legacyRecords.map((record, index) => ({
      vault: "legacy" as const,
      record: record as unknown,
      sourceOrder: currentRecords.length + index,
    })),
  ]);
}

export async function loadCaseById(caseId: string): Promise<LocalVaultLoadResult> {
  const [currentRecord, legacyRecord] = await Promise.all([
    replayDatabase.cases.get(caseId),
    legacyReplayDatabase.cases.get(caseId),
  ]);
  return inspectCaseRecords([
    ...(currentRecord
      ? [{ vault: "current" as const, record: currentRecord as unknown, sourceOrder: 0 }]
      : []),
    ...(legacyRecord
      ? [{ vault: "legacy" as const, record: legacyRecord as unknown, sourceOrder: 1 }]
      : []),
  ]);
}

interface RawCaseCandidate {
  vault: "current" | "legacy";
  record: unknown;
  sourceOrder: number;
}

interface ValidatedCaseCandidate extends RawCaseCandidate {
  record: PersistedCaseRecord;
  updatedAtMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validatePersistedCaseRecord(
  candidate: RawCaseCandidate,
): { ok: true; candidate: ValidatedCaseCandidate } | { ok: false; reason: string } {
  if (!isRecord(candidate.record)) {
    return { ok: false, reason: "The local case wrapper is not an object." };
  }
  const { id, updatedAt, schemaVersion, seedVersion, payload } = candidate.record;
  if (typeof id !== "string" || id.trim().length === 0) {
    return { ok: false, reason: "The local case wrapper has no valid case id." };
  }
  const updatedAtMs = typeof updatedAt === "string" ? Date.parse(updatedAt) : Number.NaN;
  if (!Number.isFinite(updatedAtMs)) {
    return { ok: false, reason: "The local case wrapper has no valid update time." };
  }
  if (!Number.isInteger(schemaVersion) || (schemaVersion as number) < 1) {
    return { ok: false, reason: "The local case wrapper has no valid schema version." };
  }
  if (
    seedVersion !== undefined &&
    (!Number.isInteger(seedVersion) || (seedVersion as number) < 1)
  ) {
    return { ok: false, reason: "The local case wrapper has no valid seed version." };
  }
  if (!isRecord(payload)) {
    return { ok: false, reason: "The local case wrapper has no structured case payload." };
  }
  return {
    ok: true,
    candidate: {
      ...candidate,
      record: candidate.record as unknown as PersistedCaseRecord,
      updatedAtMs,
    },
  };
}

function inspectCaseRecords(candidates: RawCaseCandidate[]): LocalVaultLoadResult {
  const retainedRecoveryRecords: RetainedRecoveryRecord[] = [];
  const validWrappers: ValidatedCaseCandidate[] = [];

  for (const candidate of candidates) {
    const validation = validatePersistedCaseRecord(candidate);
    if (!validation.ok) {
      retainedRecoveryRecords.push({
        vault: candidate.vault,
        record: candidate.record,
        reason: validation.reason,
      });
    } else {
      validWrappers.push(validation.candidate);
    }
  }

  validWrappers.sort(
    (left, right) => right.updatedAtMs - left.updatedAtMs || left.sourceOrder - right.sourceOrder,
  );

  let replayCase: ReplayCase | undefined;
  for (const candidate of validWrappers) {
    try {
      const imported = importValidatedCaseCandidate(candidate);
      replayCase ??= imported;
    } catch (error) {
      retainedRecoveryRecords.push({
        vault: candidate.vault,
        record: candidate.record,
        reason: error instanceof Error ? error.message : "The local case record is invalid.",
      });
    }
  }

  return {
    ...(replayCase ? { replayCase } : {}),
    retainedRecoveryRecords,
  };
}

function importValidatedCaseCandidate(candidate: ValidatedCaseCandidate): ReplayCase {
  const imported = importReplayCase(candidate.record.payload, {
    trustHumanAttestations: true,
  });
  if (imported.id !== candidate.record.id) {
    throw new Error("The local case wrapper id does not match its payload.");
  }
  if (imported.updatedAt !== candidate.record.updatedAt) {
    throw new Error("The local case wrapper update time does not match its payload.");
  }
  if (imported.schemaVersion !== candidate.record.schemaVersion) {
    throw new Error("The local case wrapper schema version does not match its payload.");
  }
  if (imported.seedVersion !== candidate.record.seedVersion) {
    throw new Error("The local case wrapper seed version does not match its payload.");
  }
  return imported;
}

export async function saveEvidenceBlob(record: PersistedEvidenceBlob): Promise<void> {
  await replayDatabase.evidenceBlobs.put(record);
}

export async function loadEvidenceBlob(
  key: string,
  expected?: { caseId: string; checksum: string; mimeType: string },
): Promise<Blob | undefined> {
  const record =
    (await replayDatabase.evidenceBlobs.get(key)) ??
    (await legacyReplayDatabase.evidenceBlobs.get(key));
  if (!record) return undefined;
  if (expected) {
    if (
      record.caseId !== expected.caseId ||
      record.checksum !== expected.checksum ||
      record.mimeType !== expected.mimeType ||
      record.blob.type !== expected.mimeType
    ) {
      throw new EvidenceBlobIntegrityError("Stored evidence metadata does not match this case.");
    }
    const digest = await crypto.subtle.digest("SHA-256", await record.blob.arrayBuffer());
    const checksum = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    if (checksum !== expected.checksum) {
      throw new EvidenceBlobIntegrityError("Stored evidence bytes failed checksum verification.");
    }
  }
  return record.blob;
}

export async function deleteEvidenceBlob(key: string): Promise<void> {
  await Promise.all([
    replayDatabase.evidenceBlobs.delete(key),
    legacyReplayDatabase.evidenceBlobs.delete(key),
  ]);
}

export async function deleteCaseLocally(caseId: string): Promise<void> {
  await Promise.all(
    [replayDatabase, legacyReplayDatabase].map((database) =>
      database.transaction("rw", database.cases, database.evidenceBlobs, async () => {
        await database.cases.delete(caseId);
        await database.evidenceBlobs.where("caseId").equals(caseId).delete();
      }),
    ),
  );
}

export async function resetLocalVault(): Promise<void> {
  await Promise.all(
    [replayDatabase, legacyReplayDatabase].map((database) =>
      database.transaction("rw", database.cases, database.evidenceBlobs, async () => {
        await database.cases.clear();
        await database.evidenceBlobs.clear();
      }),
    ),
  );
}
