import Dexie, { type EntityTable } from "dexie";

import {
  importReplayCase,
  migrateReplayCase,
  ReplayImportError,
  validateCaseReferences,
} from "../domain/importExport";
import { REPLAY_SCHEMA_VERSION, type ReplayCase } from "../domain/models";
import { parseReplayCase } from "../domain/schema";

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

export interface PersistedEvidencePurge {
  key: string;
  caseId: string;
  createdAt: string;
}

export interface RetainedRecoveryRecord {
  vault: "current" | "legacy";
  /** The untouched IndexedDB value, including malformed outer wrappers. */
  record: unknown;
  reason: string;
}

export interface LocalCaseSummary {
  id: string;
  title: string;
  updatedAt: string;
  caseVersion: number;
}

export interface LocalVaultLoadResult {
  replayCase?: ReplayCase;
  /** Every readable local case, newest first and de-duplicated across vault versions. */
  localCases: LocalCaseSummary[];
  retainedRecoveryRecords: RetainedRecoveryRecord[];
  evidencePurgeCleanup: EvidencePurgeCleanupStatus;
}

export interface EvidencePurgeCleanupStatus {
  /** Durable purge markers processed during this reconciliation attempt. */
  attempted: number;
  /** Markers whose evidence bytes and queue entries were removed. */
  completed: number;
  /** Attempts that failed and were deliberately left queued. */
  failed: number;
  /** Durable purge markers still awaiting cleanup after the attempt. */
  pending: number;
}

export interface SaveCaseOptions {
  expectedCaseVersion?: number;
  force?: boolean;
  writerId?: string;
  purgeEvidenceBlobKeys?: readonly string[];
  attachEvidenceBlobs?: readonly PersistedEvidenceBlob[];
}

export class LocalVaultConflictError extends Error {
  readonly code = "LOCAL_VAULT_CONFLICT" as const;
  readonly persistedCaseVersion: number | undefined;

  constructor(persistedCaseVersion?: number) {
    super(
      persistedCaseVersion === undefined
        ? "This case no longer exists in the local vault. Another REPLAY page may have deleted or reset it. Reload or reopen a case before editing."
        : `Another REPLAY page saved case version ${persistedCaseVersion}. Reload the latest local case before editing.`,
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
  evidencePurges!: EntityTable<PersistedEvidencePurge, "key">;

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
    this.version(3).stores({
      cases: "&id, updatedAt, schemaVersion, seedVersion",
      evidenceBlobs: "&key, caseId, checksum, createdAt",
      evidencePurges: "&key, caseId, createdAt",
    });
  }
}

/**
 * Current-schema data lives on a distinct origin-local database so rolling the app
 * back to a schema-v1 build can never reject or delete a newer record.
 */
export const replayDatabase = new ReplayDatabase("replay-local-vault-v2");
export const legacyReplayDatabase = new ReplayDatabase("replay-local-vault");

function isReadableBlob(value: unknown): value is Blob {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "size") === "number" &&
    typeof Reflect.get(value, "type") === "string" &&
    typeof Reflect.get(value, "slice") === "function"
  );
}

function readBlobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error("Evidence reader returned a non-binary result."));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Evidence bytes could not be read."));
    });
    reader.readAsArrayBuffer(blob);
  });
}

async function validateEvidenceAttachments(
  replayCase: ReplayCase,
  attachments: readonly PersistedEvidenceBlob[],
): Promise<void> {
  const keys = new Set<string>();
  for (const attachment of attachments) {
    if (keys.has(attachment.key)) {
      throw new EvidenceBlobIntegrityError("The same evidence attachment key was supplied twice.");
    }
    keys.add(attachment.key);
    const asset = replayCase.evidence.find(
      (candidate) => !candidate.deleted && candidate.localBlobKey === attachment.key,
    );
    if (!asset) {
      throw new EvidenceBlobIntegrityError(
        "Attached evidence bytes have no active metadata in the case being saved.",
      );
    }
    if (
      !attachment.key.startsWith("evidence:") ||
      attachment.caseId !== replayCase.id ||
      attachment.checksum !== asset.checksum ||
      attachment.mimeType !== asset.mimeType ||
      !isReadableBlob(attachment.blob) ||
      attachment.blob.type !== asset.mimeType ||
      attachment.blob.size !== asset.sizeBytes
    ) {
      throw new EvidenceBlobIntegrityError(
        "Attached evidence bytes do not match their case metadata.",
      );
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await readBlobBytes(attachment.blob);
    } catch {
      throw new EvidenceBlobIntegrityError("Attached evidence bytes could not be read safely.");
    }
    // Pass an explicit BufferSource view instead of the raw ArrayBuffer. This
    // keeps WebCrypto interoperable when Blob/FileReader bytes originate in a
    // different browser or jsdom realm (notably Node 22's stricter brand check).
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
    const checksum = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    if (checksum !== attachment.checksum) {
      throw new EvidenceBlobIntegrityError(
        "Attached evidence bytes failed checksum verification before saving.",
      );
    }
  }
}

export async function saveCase(
  replayCase: ReplayCase,
  options: SaveCaseOptions = {},
): Promise<void> {
  // Persistence is a strict boundary. Legacy backlink repair is intentionally
  // confined to reads of an existing IndexedDB wrapper below.
  const parsedForPersistence = parseReplayCase(replayCase);
  const incomingReferenceIssues = validateCaseReferences(parsedForPersistence);
  if (incomingReferenceIssues.length > 0) {
    throw new ReplayImportError(
      "Cannot persist a case with invalid object references",
      incomingReferenceIssues,
    );
  }
  const record: PersistedCaseRecord = {
    id: replayCase.id,
    updatedAt: replayCase.updatedAt,
    schemaVersion: replayCase.schemaVersion,
    ...(replayCase.seedVersion === undefined ? {} : { seedVersion: replayCase.seedVersion }),
    payload: structuredClone(replayCase),
  };
  const purgeEvidenceBlobKeys = [...new Set(options.purgeEvidenceBlobKeys ?? [])];
  const attachEvidenceBlobs = [...(options.attachEvidenceBlobs ?? [])];
  await validateEvidenceAttachments(replayCase, attachEvidenceBlobs);
  if (attachEvidenceBlobs.some((attachment) => purgeEvidenceBlobKeys.includes(attachment.key))) {
    throw new EvidenceBlobIntegrityError(
      "Evidence bytes cannot be attached and purged in the same case save.",
    );
  }
  await replayDatabase.transaction(
    "rw",
    replayDatabase.cases,
    replayDatabase.evidenceBlobs,
    replayDatabase.evidencePurges,
    async () => {
      const persisted = (await replayDatabase.cases.get(replayCase.id)) as unknown;
      if (!options.force && options.expectedCaseVersion !== undefined && persisted === undefined) {
        throw new LocalVaultConflictError();
      }
      let importedPersisted: ReplayCase | undefined;
      let persistedRequiresCanonicalRewrite = false;
      if (persisted !== undefined) {
        const validation = validatePersistedCaseRecord({
          vault: "current",
          record: persisted,
          sourceOrder: 0,
        });
        if (!validation.ok) throw new LocalVaultRecoveryRequiredError(validation.reason);
        try {
          importedPersisted = importValidatedCaseCandidate(validation.candidate);
          persistedRequiresCanonicalRewrite =
            JSON.stringify(validation.candidate.record.payload) !==
            JSON.stringify(importedPersisted);
        } catch (error) {
          throw new LocalVaultRecoveryRequiredError(
            error instanceof Error ? error.message : "The existing case record is invalid.",
          );
        }
        if (JSON.stringify(importedPersisted) === JSON.stringify(replayCase)) {
          importedPersisted = undefined;
        }
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
      if (
        importedPersisted !== undefined ||
        persisted === undefined ||
        persistedRequiresCanonicalRewrite
      ) {
        await replayDatabase.cases.put(record);
      }
      if (attachEvidenceBlobs.length > 0) {
        for (const attachment of attachEvidenceBlobs) {
          const existingBlob = await replayDatabase.evidenceBlobs.get(attachment.key);
          if (
            existingBlob &&
            (existingBlob.caseId !== attachment.caseId ||
              existingBlob.checksum !== attachment.checksum ||
              existingBlob.mimeType !== attachment.mimeType)
          ) {
            throw new EvidenceBlobIntegrityError(
              "An existing local evidence key belongs to different bytes.",
            );
          }
        }
        await replayDatabase.evidenceBlobs.bulkPut(attachEvidenceBlobs);
      }
      if (purgeEvidenceBlobKeys.length > 0) {
        const createdAt = new Date().toISOString();
        for (const key of purgeEvidenceBlobKeys) {
          const existingBlob = await replayDatabase.evidenceBlobs.get(key);
          if (existingBlob && existingBlob.caseId !== replayCase.id) {
            throw new EvidenceBlobIntegrityError(
              "The requested evidence purge belongs to a different local case.",
            );
          }
        }
        await replayDatabase.evidencePurges.bulkPut(
          purgeEvidenceBlobKeys.map((key) => ({ key, caseId: replayCase.id, createdAt })),
        );
        await replayDatabase.evidenceBlobs.bulkDelete(purgeEvidenceBlobKeys);
      }
    },
  );
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
  const evidencePurgeCleanup = await reconcilePendingEvidencePurges();
  const [currentRecords, legacyRecords] = await Promise.all([
    replayDatabase.cases.toArray(),
    legacyReplayDatabase.cases.toArray(),
  ]);
  return {
    ...inspectCaseRecords([
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
    ]),
    evidencePurgeCleanup,
  };
}

export async function loadCaseById(caseId: string): Promise<LocalVaultLoadResult> {
  const evidencePurgeCleanup = await reconcilePendingEvidencePurges();
  const [currentRecord, legacyRecord] = await Promise.all([
    replayDatabase.cases.get(caseId),
    legacyReplayDatabase.cases.get(caseId),
  ]);
  return {
    ...inspectCaseRecords([
      ...(currentRecord
        ? [{ vault: "current" as const, record: currentRecord as unknown, sourceOrder: 0 }]
        : []),
      ...(legacyRecord
        ? [{ vault: "legacy" as const, record: legacyRecord as unknown, sourceOrder: 1 }]
        : []),
    ]),
    evidencePurgeCleanup,
  };
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

function inspectCaseRecords(
  candidates: RawCaseCandidate[],
): Omit<LocalVaultLoadResult, "evidencePurgeCleanup"> {
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
  const localCases: LocalCaseSummary[] = [];
  const indexedCaseIds = new Set<string>();
  for (const candidate of validWrappers) {
    try {
      const imported = importValidatedCaseCandidate(candidate);
      replayCase ??= imported;
      if (!indexedCaseIds.has(imported.id)) {
        indexedCaseIds.add(imported.id);
        localCases.push({
          id: imported.id,
          title: imported.title,
          updatedAt: imported.updatedAt,
          caseVersion: imported.caseVersion,
        });
      }
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
    localCases,
    retainedRecoveryRecords,
  };
}

interface LocalIndexRepairResult {
  replayCase: ReplayCase;
  repaired: boolean;
}

function sameOrderedIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function stableRepairIdFragment(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function collectNestedIds(value: unknown, ids: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectNestedIds(item, ids));
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value.id === "string") ids.add(value.id);
  Object.values(value).forEach((item) => collectNestedIds(item, ids));
}

/**
 * Normalizes only ownership/provenance indexes that older local command/seed
 * versions could persist asymmetrically. It is deliberately private to the
 * IndexedDB read path: structured transfers and writes continue to reject the
 * same malformed graph.
 */
function repairLegacyLocalIndexes(replayCase: ReplayCase): LocalIndexRepairResult {
  const repaired = structuredClone(replayCase);
  const changedIds = new Set<string>();
  const recordChange = (...ids: string[]): void => ids.forEach((id) => changedIds.add(id));
  const dedupe = (values: string[], ownerId: string): string[] => {
    const next = [...new Set(values)];
    if (!sameOrderedIds(values, next)) recordChange(ownerId);
    return next;
  };
  const add = (values: string[], id: string, ...affectedIds: string[]): void => {
    if (values.includes(id)) return;
    values.push(id);
    recordChange(...affectedIds);
  };

  repaired.actors.forEach((actor) => {
    actor.damageMarkers.forEach((marker) => {
      marker.linkedClaimIds = dedupe(marker.linkedClaimIds, marker.id);
      marker.linkedEvidenceIds = dedupe(marker.linkedEvidenceIds, marker.id);
    });
  });
  repaired.timelineEvents.forEach((event) => {
    event.linkedClaimIds = dedupe(event.linkedClaimIds, event.id);
    event.linkedEvidenceIds = dedupe(event.linkedEvidenceIds, event.id);
  });
  repaired.claims.forEach((claim) => {
    claim.linkedEvidenceIds = dedupe(claim.linkedEvidenceIds, claim.id);
    claim.linkedEventIds = dedupe(claim.linkedEventIds, claim.id);
    claim.linkedSceneObjectIds = dedupe(claim.linkedSceneObjectIds, claim.id);
  });
  repaired.evidence.forEach((asset) => {
    asset.linkedClaimIds = dedupe(asset.linkedClaimIds, asset.id);
    asset.linkedEventIds = dedupe(asset.linkedEventIds, asset.id);
    asset.linkedSceneObjectIds = dedupe(asset.linkedSceneObjectIds, asset.id);
  });

  // The released claim.add command treated this exact shape as global by adding
  // it to every sharedClaimIds index even when the explicit flag was false. Its
  // branch ownership is therefore unambiguous; any other malformed shape remains
  // a strict recovery error.
  repaired.claims.forEach((claim) => {
    if (claim.branchId || claim.sharedAcrossBranches) return;
    const indexedAsGlobal =
      repaired.branches.every((branch) => branch.sharedClaimIds.includes(claim.id)) &&
      repaired.branches.every((branch) => !branch.claimIds.includes(claim.id));
    if (!indexedAsGlobal) return;
    claim.sharedAcrossBranches = true;
    recordChange(claim.id, ...repaired.branches.map((branch) => branch.id));
  });

  const markers = repaired.actors.flatMap((actor) => actor.damageMarkers);
  const markerById = new Map(markers.map((marker) => [marker.id, marker]));
  const claimById = new Map(repaired.claims.map((claim) => [claim.id, claim]));
  const evidenceById = new Map(repaired.evidence.map((asset) => [asset.id, asset]));
  const eventById = new Map(repaired.timelineEvents.map((event) => [event.id, event]));

  // Damage relations are a union: historical commands could author either side,
  // and both sides represented the same explicit marker relation.
  markers.forEach((marker) => {
    marker.linkedEvidenceIds.forEach((evidenceId) => {
      const asset = evidenceById.get(evidenceId);
      if (asset) add(asset.linkedSceneObjectIds, marker.id, marker.id, asset.id);
    });
  });
  repaired.evidence.forEach((asset) => {
    asset.linkedSceneObjectIds.forEach((sceneObjectId) => {
      const marker = markerById.get(sceneObjectId);
      if (marker) add(marker.linkedEvidenceIds, asset.id, marker.id, asset.id);
    });
  });
  markers.forEach((marker) => {
    marker.linkedClaimIds.forEach((claimId) => {
      const claim = claimById.get(claimId);
      if (claim) add(claim.linkedSceneObjectIds, marker.id, marker.id, claim.id);
    });
  });
  repaired.claims.forEach((claim) => {
    claim.linkedSceneObjectIds.forEach((sceneObjectId) => {
      const marker = markerById.get(sceneObjectId);
      if (marker) add(marker.linkedClaimIds, claim.id, marker.id, claim.id);
    });
  });

  // Direct claim citations are claim-authored. Older damage commands widened only
  // evidence.linkedClaimIds via a cross-product; never promote that derived index
  // into a direct claim citation during recovery.
  repaired.evidence.forEach((asset) => {
    const nextClaimIds = asset.linkedClaimIds.filter((claimId) => {
      const claim = claimById.get(claimId);
      return !claim || claim.linkedEvidenceIds.includes(asset.id);
    });
    if (!sameOrderedIds(asset.linkedClaimIds, nextClaimIds)) {
      asset.linkedClaimIds
        .filter((claimId) => !nextClaimIds.includes(claimId))
        .forEach((claimId) => recordChange(asset.id, claimId));
      asset.linkedClaimIds = nextClaimIds;
    }
  });
  repaired.claims.forEach((claim) => {
    claim.linkedEvidenceIds.forEach((evidenceId) => {
      const asset = evidenceById.get(evidenceId);
      if (asset) add(asset.linkedClaimIds, claim.id, claim.id, asset.id);
    });
  });

  // Timeline-event evidence membership is event-authored in historical commands.
  repaired.evidence.forEach((asset) => {
    const nextEventIds = asset.linkedEventIds.filter((eventId) => {
      const event = eventById.get(eventId);
      return !event || event.linkedEvidenceIds.includes(asset.id);
    });
    if (!sameOrderedIds(asset.linkedEventIds, nextEventIds)) {
      asset.linkedEventIds
        .filter((eventId) => !nextEventIds.includes(eventId))
        .forEach((eventId) => recordChange(asset.id, eventId));
      asset.linkedEventIds = nextEventIds;
    }
  });
  repaired.timelineEvents.forEach((event) => {
    event.linkedEvidenceIds.forEach((evidenceId) => {
      const asset = evidenceById.get(evidenceId);
      if (asset) add(asset.linkedEventIds, event.id, event.id, asset.id);
    });
  });

  if (changedIds.size === 0) return { replayCase, repaired: false };
  if (repaired.activity.length >= 100_000) {
    throw new Error(
      "The local case needs reciprocal-link repair, but its activity log has no room for migration provenance.",
    );
  }
  repaired.caseVersion += 1;
  const occupiedIds = new Set<string>();
  collectNestedIds(repaired, occupiedIds);
  const baseActivityId = `activity-local-reciprocal-repair-${stableRepairIdFragment(repaired.id)}`;
  let activityId = baseActivityId;
  let suffix = 2;
  while (occupiedIds.has(activityId)) activityId = `${baseActivityId}-${String(suffix++)}`;
  repaired.activity.push({
    id: activityId,
    caseVersion: repaired.caseVersion,
    author: "system",
    origin: "system",
    actionType: "case.local-reciprocal-links-repaired",
    summary:
      "Local persistence migration repaired canonical claim ownership and reciprocal provenance indexes for damage, claims, evidence, and timeline events.",
    affectedIds: [repaired.id, ...[...changedIds].filter((id) => id !== repaired.id)].slice(
      0,
      5_000,
    ),
    undoable: false,
    createdAt: repaired.updatedAt,
  });
  return { replayCase: repaired, repaired: true };
}

function importValidatedCaseCandidate(candidate: ValidatedCaseCandidate): ReplayCase {
  const rawPayload = candidate.record.payload as unknown as Record<string, unknown>;
  if (rawPayload.id !== candidate.record.id) {
    throw new Error("The local case wrapper id does not match its payload.");
  }
  if (rawPayload.updatedAt !== candidate.record.updatedAt) {
    throw new Error("The local case wrapper update time does not match its payload.");
  }
  if (rawPayload.schemaVersion !== candidate.record.schemaVersion) {
    throw new Error("The local case wrapper schema version does not match its payload.");
  }
  if (rawPayload.seedVersion !== candidate.record.seedVersion) {
    throw new Error("The local case wrapper seed version does not match its payload.");
  }

  let imported: ReplayCase;
  try {
    imported = importReplayCase(candidate.record.payload, {
      trustHumanAttestations: true,
    });
  } catch (strictError) {
    let parsed: ReplayCase;
    try {
      parsed = parseReplayCase(migrateReplayCase(candidate.record.payload));
    } catch {
      throw strictError;
    }
    const localRepair = repairLegacyLocalIndexes(parsed);
    if (!localRepair.repaired) throw strictError;
    imported = importReplayCase(localRepair.replayCase, {
      trustHumanAttestations: true,
    });
  }
  if (imported.id !== candidate.record.id) {
    throw new Error("The local case wrapper id does not match its payload.");
  }
  if (imported.updatedAt !== candidate.record.updatedAt) {
    throw new Error("The local case wrapper update time does not match its payload.");
  }
  const expectedImportedSchemaVersion =
    candidate.record.schemaVersion === 1 ? REPLAY_SCHEMA_VERSION : candidate.record.schemaVersion;
  if (imported.schemaVersion !== expectedImportedSchemaVersion) {
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
  if (!record) {
    if (expected) {
      throw new EvidenceBlobIntegrityError(
        "The case references evidence bytes that are missing from local storage.",
      );
    }
    return undefined;
  }
  if (expected) {
    if (!isReadableBlob(record.blob)) {
      throw new EvidenceBlobIntegrityError(
        "Stored evidence does not contain a readable image blob.",
      );
    }
    if (
      record.caseId !== expected.caseId ||
      record.checksum !== expected.checksum ||
      record.mimeType !== expected.mimeType ||
      record.blob.type !== expected.mimeType
    ) {
      throw new EvidenceBlobIntegrityError("Stored evidence metadata does not match this case.");
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await readBlobBytes(record.blob);
    } catch {
      throw new EvidenceBlobIntegrityError("Stored evidence bytes could not be read safely.");
    }
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
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

export async function completeEvidenceBlobPurge(key: string, caseId: string): Promise<void> {
  for (const database of [replayDatabase, legacyReplayDatabase]) {
    const existingBlob = await database.evidenceBlobs.get(key);
    if (existingBlob && existingBlob.caseId !== caseId) {
      throw new EvidenceBlobIntegrityError(
        "The queued evidence purge belongs to a different local case.",
      );
    }
  }
  await Promise.all(
    [replayDatabase, legacyReplayDatabase].map((database) => database.evidenceBlobs.delete(key)),
  );
  await replayDatabase.evidencePurges.delete(key);
}

let activeEvidencePurgeReconciliation: Promise<EvidencePurgeCleanupStatus> | undefined;

async function performEvidencePurgeReconciliation(): Promise<EvidencePurgeCleanupStatus> {
  const pending = await replayDatabase.evidencePurges.toArray();
  let completed = 0;
  let failed = 0;
  for (const purge of pending) {
    try {
      await completeEvidenceBlobPurge(purge.key, purge.caseId);
      completed += 1;
    } catch {
      // The durable queue is intentionally retained for the next startup/save.
      failed += 1;
    }
  }
  return {
    attempted: pending.length,
    completed,
    failed,
    pending: await replayDatabase.evidencePurges.count(),
  };
}

export async function reconcilePendingEvidencePurges(): Promise<EvidencePurgeCleanupStatus> {
  activeEvidencePurgeReconciliation ??= performEvidencePurgeReconciliation();
  const reconciliation = activeEvidencePurgeReconciliation;
  try {
    return await reconciliation;
  } finally {
    if (activeEvidencePurgeReconciliation === reconciliation) {
      activeEvidencePurgeReconciliation = undefined;
    }
  }
}

export async function deleteCaseLocally(caseId: string): Promise<void> {
  await Promise.all(
    [replayDatabase, legacyReplayDatabase].map((database) =>
      database.transaction(
        "rw",
        database.cases,
        database.evidenceBlobs,
        database.evidencePurges,
        async () => {
          await database.cases.delete(caseId);
          await database.evidenceBlobs.where("caseId").equals(caseId).delete();
          await database.evidencePurges.where("caseId").equals(caseId).delete();
        },
      ),
    ),
  );
}

export async function resetLocalVault(): Promise<void> {
  await Promise.all(
    [replayDatabase, legacyReplayDatabase].map((database) =>
      database.transaction(
        "rw",
        database.cases,
        database.evidenceBlobs,
        database.evidencePurges,
        async () => {
          await database.cases.clear();
          await database.evidenceBlobs.clear();
          await database.evidencePurges.clear();
        },
      ),
    ),
  );
}
