import { z } from "zod";

import { validateConsistency } from "./consistency";
import { REPLAY_SCHEMA_VERSION } from "./models";
import type { Claim, ReplayCase, SceneActor } from "./models";
import { parseReplayCase } from "./schema";

export const BlankCaseInputSchema = z
  .object({
    caseId: z.string().trim().min(1).max(128).optional(),
    title: z.string().trim().min(1).max(500),
    incidentDate: z.iso.date().optional(),
    approximateTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    sceneType: z.enum(["roundabout", "intersection"]),
    roadCondition: z.enum(["wet", "dry", "unknown"]),
    vehicleCount: z.number().int().min(1).max(6),
    initialStatement: z.string().trim().min(1).max(10_000).optional(),
  })
  .strict();

export interface BlankCaseInput {
  caseId?: string | undefined;
  title: string;
  incidentDate?: string | undefined;
  approximateTime?: string | undefined;
  sceneType: "roundabout" | "intersection";
  roadCondition: "wet" | "dry" | "unknown";
  vehicleCount: number;
  initialStatement?: string | undefined;
}

export interface CreateBlankCaseOptions {
  now?: string;
  caseId?: string;
}

function actorLabel(index: number): string {
  return `Vehicle ${String.fromCharCode(65 + index)}`;
}

/** Creates a fully valid, intentionally incomplete local case for the start wizard. */
export function createBlankCase(
  input: BlankCaseInput,
  options: CreateBlankCaseOptions = {},
): ReplayCase {
  const parsed = BlankCaseInputSchema.parse(input);
  const now = options.now ?? new Date().toISOString();
  const caseId = options.caseId ?? parsed.caseId ?? `case-${crypto.randomUUID()}`;
  const actors: SceneActor[] = Array.from({ length: parsed.vehicleCount }, (_, index) => ({
    id: `actor-vehicle-${String.fromCharCode(97 + index)}`,
    label: actorLabel(index),
    kind: "vehicle",
    dimensions: { width: 1.8, length: 4.3 },
    colorToken:
      index === 0
        ? "vehicle-muted-blue"
        : index === 1
          ? "vehicle-silver"
          : `vehicle-neutral-${String(index + 1)}`,
    pose: { x: 35 + index * 10, y: 50, rotationDeg: index % 2 === 0 ? 0 : 180 },
    locked: false,
    damageMarkers: [],
  }));
  const claims: Claim[] = parsed.initialStatement
    ? [
        {
          id: "claim-initial-statement",
          statement: parsed.initialStatement,
          status: "reported",
          sourceType: "human-statement",
          sourceIds: [],
          linkedEvidenceIds: [],
          linkedEventIds: [],
          linkedSceneObjectIds: [],
          sharedAcrossBranches: true,
          createdBy: "human",
          humanConfirmed: false,
          locked: false,
          createdAt: now,
          updatedAt: now,
          changeHistory: [
            {
              id: "change-initial-statement",
              caseVersion: 1,
              author: "human",
              origin: "ui",
              summary: "Human supplied the initial unconfirmed statement.",
              createdAt: now,
            },
          ],
        },
      ]
    : [];
  const replayCase: ReplayCase = {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    id: caseId,
    title: parsed.title,
    createdAt: now,
    updatedAt: now,
    caseVersion: 1,
    ...(parsed.incidentDate ? { incidentDate: parsed.incidentDate } : {}),
    ...(parsed.approximateTime ? { approximateTime: parsed.approximateTime } : {}),
    sceneTemplateId:
      parsed.sceneType === "roundabout"
        ? "scene-european-roundabout"
        : "scene-four-way-intersection",
    environment: {
      sceneType: parsed.sceneType,
      roadCondition: parsed.roadCondition,
      weather: "unknown",
      lighting: "unknown",
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      roadPolygon: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
    },
    timeRangeMs: { start: 0, end: 20_000 },
    actors,
    trajectories: [],
    timelineEvents: [],
    branches: [
      {
        id: "branch-baseline",
        name: "Baseline reconstruction",
        description:
          "Initial reconstruction. No trajectory or factual conclusion has been added yet.",
        sharedClaimIds: claims.map((claim) => claim.id),
        assumptions: [],
        trajectoryIds: [],
        eventIds: [],
        claimIds: [],
        status: "active",
        createdBy: "human",
        createdAt: now,
        updatedAt: now,
        changeHistory: [
          {
            id: "change-branch-baseline",
            caseVersion: 1,
            author: "human",
            origin: "ui",
            summary: "Created a blank baseline reconstruction.",
            createdAt: now,
          },
        ],
      },
    ],
    activeBranchId: "branch-baseline",
    claims,
    evidence: [],
    questions: [],
    activity: [
      {
        id: "activity-case-created",
        caseVersion: 1,
        author: "human",
        origin: "ui",
        actionType: "case.created",
        summary: "Created a blank local incident case.",
        affectedIds: [caseId],
        undoable: false,
        createdAt: now,
      },
    ],
    consistencyIssues: [],
    reportNotes: [],
    reportSnapshots: [],
    workspaceMode: "scene",
  };
  replayCase.consistencyIssues = validateConsistency(replayCase);
  return parseReplayCase(replayCase);
}
