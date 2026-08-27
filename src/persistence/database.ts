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

class ReplayDatabase extends Dexie {
  cases!: EntityTable<PersistedCaseRecord, "id">;
  evidenceBlobs!: EntityTable<PersistedEvidenceBlob, "key">;

  constructor() {
    super("replay-local-vault");
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

export const replayDatabase = new ReplayDatabase();

export async function saveCase(replayCase: ReplayCase): Promise<void> {
  await replayDatabase.cases.put({
    id: replayCase.id,
    updatedAt: replayCase.updatedAt,
    schemaVersion: replayCase.schemaVersion,
    ...(replayCase.seedVersion === undefined ? {} : { seedVersion: replayCase.seedVersion }),
    payload: structuredClone(replayCase),
  });
}

export async function loadMostRecentCase(): Promise<ReplayCase | undefined> {
  const records = await replayDatabase.cases.orderBy("updatedAt").reverse().limit(1).toArray();
  const record = records[0];
  if (!record) return undefined;
  try {
    return importReplayCase(record.payload);
  } catch {
    await replayDatabase.cases.delete(record.id);
    return undefined;
  }
}

export async function saveEvidenceBlob(record: PersistedEvidenceBlob): Promise<void> {
  await replayDatabase.evidenceBlobs.put(record);
}

export async function loadEvidenceBlob(key: string): Promise<Blob | undefined> {
  return (await replayDatabase.evidenceBlobs.get(key))?.blob;
}

export async function deleteEvidenceBlob(key: string): Promise<void> {
  await replayDatabase.evidenceBlobs.delete(key);
}

export async function deleteCaseLocally(caseId: string): Promise<void> {
  await replayDatabase.transaction(
    "rw",
    replayDatabase.cases,
    replayDatabase.evidenceBlobs,
    async () => {
      await replayDatabase.cases.delete(caseId);
      await replayDatabase.evidenceBlobs.where("caseId").equals(caseId).delete();
    },
  );
}

export async function resetLocalVault(): Promise<void> {
  await replayDatabase.transaction(
    "rw",
    replayDatabase.cases,
    replayDatabase.evidenceBlobs,
    async () => {
      await replayDatabase.cases.clear();
      await replayDatabase.evidenceBlobs.clear();
    },
  );
}
