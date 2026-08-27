import { z } from "zod";

import { REPLAY_SCHEMA_VERSION, REPLAY_SEED_VERSION } from "./models";
import type { ReplayCase } from "./models";

const id = z.string().trim().min(1).max(128);
const shortText = z.string().trim().min(1).max(500);
const longText = z.string().trim().min(1).max(10_000);
const isoDateTime = z.iso.datetime({ offset: true });
const finite = z.number();

export const ActionAuthorSchema = z.enum(["human", "agent", "system"]);
export const ActionOriginSchema = z.enum(["ui", "webmcp", "system"]);
export const ClaimStatusSchema = z.enum([
  "confirmed",
  "reported",
  "likely",
  "uncertain",
  "disputed",
  "unknown",
  "agent-hypothesis",
]);
export const ClaimSourceTypeSchema = z.enum([
  "human-statement",
  "witness-statement",
  "photo",
  "document",
  "scene-observation",
  "system-derived",
  "agent-inference",
]);

export const PointSchema = z.object({ x: finite, y: finite }).strict();

export const ActorPoseSchema = PointSchema.extend({
  rotationDeg: finite,
}).strict();

export const ItemLockSchema = z
  .object({
    lockedBy: ActionAuthorSchema,
    lockedAt: isoDateTime,
    reason: z.string().trim().max(1_000).optional(),
  })
  .strict();

export const ChangeRecordSchema = z
  .object({
    id,
    caseVersion: z.number().int().nonnegative(),
    author: ActionAuthorSchema,
    origin: ActionOriginSchema,
    summary: shortText,
    createdAt: isoDateTime,
    requestId: id.optional(),
  })
  .strict();

export const EnvironmentStateSchema = z
  .object({
    sceneType: z.enum(["roundabout", "intersection"]),
    roadCondition: z.enum(["wet", "dry", "unknown"]),
    weather: z.enum(["clear", "rain", "overcast", "unknown"]),
    lighting: z.enum(["daylight", "dusk", "night", "unknown"]),
    bounds: z
      .object({ minX: finite, minY: finite, maxX: finite, maxY: finite })
      .strict()
      .refine((bounds) => bounds.maxX > bounds.minX && bounds.maxY > bounds.minY, {
        message: "Environment bounds must have positive area",
      }),
    roadPolygon: z.array(PointSchema).min(3).max(1_000),
  })
  .strict();

export const DamageMarkerSchema = z
  .object({
    id,
    actorId: id,
    region: z.enum([
      "front",
      "front-left",
      "front-right",
      "left-side",
      "right-side",
      "rear-left",
      "rear-right",
      "rear",
      "unknown",
    ]),
    description: shortText,
    status: ClaimStatusSchema,
    linkedClaimIds: z.array(id).max(500),
    linkedEvidenceIds: z.array(id).max(500),
    createdBy: ActionAuthorSchema,
  })
  .strict();

export const SceneActorSchema = z
  .object({
    id,
    label: shortText,
    kind: z.literal("vehicle"),
    dimensions: z.object({ width: finite.positive(), length: finite.positive() }).strict(),
    colorToken: z.string().trim().min(1).max(100),
    pose: ActorPoseSchema,
    locked: z.boolean(),
    lock: ItemLockSchema.optional(),
    damageMarkers: z.array(DamageMarkerSchema).max(100),
  })
  .strict()
  .superRefine((actor, ctx) => {
    if (actor.locked !== Boolean(actor.lock)) {
      ctx.addIssue({
        code: "custom",
        path: ["lock"],
        message: "Lock metadata must match locked state",
      });
    }
  });

export const ActorKeyframeSchema = ActorPoseSchema.extend({
  id,
  actorId: id,
  timeMs: finite.nonnegative(),
}).strict();

export const TrajectorySchema = z
  .object({
    id,
    actorId: id,
    branchId: id,
    keyframes: z.array(ActorKeyframeSchema).min(1).max(2_000),
    visible: z.boolean(),
    locked: z.boolean(),
    lock: ItemLockSchema.optional(),
    createdBy: ActionAuthorSchema,
    changeHistory: z.array(ChangeRecordSchema).max(10_000),
  })
  .strict()
  .superRefine((trajectory, ctx) => {
    if (trajectory.locked !== Boolean(trajectory.lock)) {
      ctx.addIssue({
        code: "custom",
        path: ["lock"],
        message: "Lock metadata must match locked state",
      });
    }
    const ids = new Set<string>();
    let previous = -Infinity;
    trajectory.keyframes.forEach((keyframe, index) => {
      if (keyframe.actorId !== trajectory.actorId) {
        ctx.addIssue({
          code: "custom",
          path: ["keyframes", index, "actorId"],
          message: "Keyframe actor must match trajectory actor",
        });
      }
      if (ids.has(keyframe.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["keyframes", index, "id"],
          message: "Duplicate keyframe ID",
        });
      }
      ids.add(keyframe.id);
      if (keyframe.timeMs <= previous) {
        ctx.addIssue({
          code: "custom",
          path: ["keyframes", index, "timeMs"],
          message: "Keyframe times must be strictly increasing",
        });
      }
      previous = keyframe.timeMs;
    });
  });

export const TimelineEventSchema = z
  .object({
    id,
    branchId: id,
    timeMs: finite.nonnegative(),
    type: z.enum(["actor-start", "maneuver", "impact", "observation", "evidence", "actor-stop"]),
    title: shortText,
    certainty: ClaimStatusSchema,
    linkedActorIds: z.array(id).max(500),
    linkedClaimIds: z.array(id).max(500),
    linkedEvidenceIds: z.array(id).max(500),
    location: PointSchema.optional(),
    locked: z.boolean(),
    lock: ItemLockSchema.optional(),
    createdBy: ActionAuthorSchema,
    changeHistory: z.array(ChangeRecordSchema).max(10_000),
  })
  .strict()
  .superRefine((event, ctx) => {
    if (event.locked !== Boolean(event.lock)) {
      ctx.addIssue({
        code: "custom",
        path: ["lock"],
        message: "Lock metadata must match locked state",
      });
    }
  });

export const ClaimSchema = z
  .object({
    id,
    statement: longText,
    subjectId: id.optional(),
    status: ClaimStatusSchema,
    sourceType: ClaimSourceTypeSchema,
    sourceIds: z.array(id).max(500),
    linkedEvidenceIds: z.array(id).max(500),
    linkedEventIds: z.array(id).max(500),
    linkedSceneObjectIds: z.array(id).max(500),
    branchId: id.optional(),
    sharedAcrossBranches: z.boolean(),
    createdBy: ActionAuthorSchema,
    humanConfirmed: z.boolean(),
    confirmedAt: isoDateTime.optional(),
    locked: z.boolean(),
    lock: ItemLockSchema.optional(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
    changeHistory: z.array(ChangeRecordSchema).max(10_000),
  })
  .strict()
  .superRefine((claim, ctx) => {
    if (claim.status === "confirmed" && (!claim.humanConfirmed || !claim.confirmedAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["status"],
        message: "Confirmed claims require explicit human confirmation",
      });
    }
    if (claim.status !== "confirmed" && claim.humanConfirmed) {
      ctx.addIssue({
        code: "custom",
        path: ["humanConfirmed"],
        message: "Only confirmed claims may be human-confirmed",
      });
    }
    if (claim.locked !== Boolean(claim.lock)) {
      ctx.addIssue({
        code: "custom",
        path: ["lock"],
        message: "Lock metadata must match locked state",
      });
    }
  });

const AnnotationBaseSchema = z.object({ id });
export const EvidenceAnnotationSchema = z.discriminatedUnion("kind", [
  AnnotationBaseSchema.extend({
    kind: z.literal("point"),
    x: finite.min(0).max(1),
    y: finite.min(0).max(1),
    label: z.string().trim().max(500).optional(),
  }).strict(),
  AnnotationBaseSchema.extend({
    kind: z.literal("rectangle"),
    x: finite.min(0).max(1),
    y: finite.min(0).max(1),
    width: finite.positive().max(1),
    height: finite.positive().max(1),
    label: z.string().trim().max(500).optional(),
  }).strict(),
]);

export const EvidenceAssetSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(255),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(20 * 1024 * 1024),
    localBlobKey: z.string().trim().min(1).max(500),
    checksum: z.string().trim().min(8).max(256),
    syntheticDemoAsset: z.boolean(),
    source: z.enum(["demo", "local-upload", "import"]),
    capturedAt: isoDateTime.optional(),
    createdAt: isoDateTime,
    notes: z.string().max(10_000).optional(),
    tags: z.array(z.string().trim().min(1).max(100)).max(100),
    annotations: z.array(EvidenceAnnotationSchema).max(1_000),
    linkedClaimIds: z.array(id).max(500),
    linkedEventIds: z.array(id).max(500),
    linkedSceneObjectIds: z.array(id).max(500),
    linkedBranchIds: z.array(id).max(500),
    deleted: z.boolean(),
    deletedAt: isoDateTime.optional(),
  })
  .strict()
  .superRefine((asset, ctx) => {
    if (asset.deleted !== Boolean(asset.deletedAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["deletedAt"],
        message: "Deleted evidence requires a deletion timestamp",
      });
    }
  });

export const HypothesisAssumptionSchema = z
  .object({
    id,
    statement: longText,
    status: z.enum(["active", "withdrawn"]),
    supportingEvidenceIds: z.array(id).max(500),
    conflictingEvidenceIds: z.array(id).max(500),
    createdBy: ActionAuthorSchema,
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .strict();

export const HypothesisBranchSchema = z
  .object({
    id,
    name: shortText,
    description: longText,
    parentBranchId: id.optional(),
    sharedClaimIds: z.array(id).max(5_000),
    assumptions: z.array(HypothesisAssumptionSchema).max(1_000),
    trajectoryIds: z.array(id).max(5_000),
    eventIds: z.array(id).max(5_000),
    claimIds: z.array(id).max(5_000),
    status: z.enum(["active", "archived"]),
    createdBy: ActionAuthorSchema,
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
    changeHistory: z.array(ChangeRecordSchema).max(10_000),
  })
  .strict();

export const OpenQuestionSchema = z
  .object({
    id,
    question: longText,
    reason: longText,
    importance: z.enum(["blocking", "high", "medium", "low"]),
    rankingReasons: z
      .array(
        z.enum([
          "blocks-report",
          "resolves-contradiction",
          "distinguishes-hypotheses",
          "required-field",
          "contextual-detail",
        ]),
      )
      .max(5),
    relatedClaimIds: z.array(id).max(500),
    relatedSceneObjectIds: z.array(id).max(500),
    relatedBranchIds: z.array(id).max(500),
    status: z.enum(["open", "answered", "deferred", "dismissed"]),
    answer: z.string().trim().min(1).max(10_000).optional(),
    answerSource: ClaimSourceTypeSchema.optional(),
    createdBy: ActionAuthorSchema,
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .strict()
  .superRefine((question, ctx) => {
    if (question.status === "answered" && (!question.answer || !question.answerSource)) {
      ctx.addIssue({
        code: "custom",
        path: ["answer"],
        message: "Answered questions require an answer and source",
      });
    }
  });

export const ActivityEventSchema = z
  .object({
    id,
    caseVersion: z.number().int().nonnegative(),
    author: ActionAuthorSchema,
    origin: ActionOriginSchema,
    actionType: z.string().trim().min(1).max(200),
    summary: shortText,
    affectedIds: z.array(id).max(5_000),
    requestId: id.optional(),
    undoable: z.boolean(),
    createdAt: isoDateTime,
  })
  .strict();

export const ConsistencyIssueSchema = z
  .object({
    id,
    ruleId: id,
    scope: z.enum(["timeline", "geometry", "damage", "provenance", "completeness", "report"]),
    severity: z.enum(["error", "warning", "question"]),
    title: shortText,
    explanation: longText,
    affectedIds: z.array(id).max(5_000),
    suggestedActions: z.array(shortText).max(100),
  })
  .strict();

export const ReportCitationSchema = z
  .object({ claimIds: z.array(id).max(5_000), evidenceIds: z.array(id).max(5_000) })
  .strict();

export const ReportStatementSchema = z
  .object({
    id,
    text: longText,
    certainty: z.enum(["confirmed", "reported", "uncertain", "hypothesis", "system"]),
    citations: ReportCitationSchema,
  })
  .strict();

export const ReportSectionSchema = z
  .object({ id, title: shortText, statements: z.array(ReportStatementSchema).max(10_000) })
  .strict();

export const ReportPreviewSchema = z
  .object({
    caseId: id,
    caseVersion: z.number().int().nonnegative(),
    generatedAt: isoDateTime,
    title: shortText,
    sections: z.array(ReportSectionSchema).min(1).max(100),
    includedClaimIds: z.array(id).max(10_000),
    includedEvidenceIds: z.array(id).max(10_000),
    unresolvedQuestionIds: z.array(id).max(10_000),
    missingRequirements: z.array(shortText).max(100),
    disclaimer: longText,
  })
  .strict();

export const ReportSnapshotSchema = z
  .object({
    id,
    caseVersion: z.number().int().nonnegative(),
    createdAt: isoDateTime,
    confirmedClaimIds: z.array(id).max(10_000),
    includedEvidenceIds: z.array(id).max(10_000),
    unresolvedQuestionIds: z.array(id).max(10_000),
    branchIds: z.array(id).max(1_000),
    humanAcknowledged: z.literal(true),
    immutable: z.literal(true),
    preview: ReportPreviewSchema,
  })
  .strict();

export const ReportNoteSchema = z
  .object({
    id,
    text: longText,
    claimIds: z.array(id).max(5_000),
    evidenceIds: z.array(id).max(5_000),
    createdBy: ActionAuthorSchema,
    reviewedByHuman: z.boolean(),
    createdAt: isoDateTime,
  })
  .strict()
  .superRefine((note, ctx) => {
    if (note.createdBy === "human" && !note.reviewedByHuman) {
      ctx.addIssue({
        code: "custom",
        path: ["reviewedByHuman"],
        message: "Human-authored notes are reviewed by definition",
      });
    }
  });

export const WorkspaceSelectionSchema = z
  .object({
    type: z.enum([
      "actor",
      "trajectory",
      "timeline-event",
      "claim",
      "evidence",
      "question",
      "hypothesis",
      "report",
    ]),
    id,
  })
  .strict();

export const ReplayCaseSchema = z
  .object({
    schemaVersion: z.literal(REPLAY_SCHEMA_VERSION),
    seedVersion: z.literal(REPLAY_SEED_VERSION).optional(),
    id,
    title: shortText,
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
    caseVersion: z.number().int().nonnegative(),
    incidentDate: z.iso.date().optional(),
    approximateTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    sceneTemplateId: id,
    environment: EnvironmentStateSchema,
    timeRangeMs: z
      .object({ start: finite.nonnegative(), end: finite.positive() })
      .strict()
      .refine((range) => range.end > range.start, { message: "Time range end must follow start" }),
    actors: z.array(SceneActorSchema).min(1).max(100),
    trajectories: z.array(TrajectorySchema).max(10_000),
    timelineEvents: z.array(TimelineEventSchema).max(10_000),
    branches: z.array(HypothesisBranchSchema).min(1).max(1_000),
    activeBranchId: id,
    claims: z.array(ClaimSchema).max(10_000),
    evidence: z.array(EvidenceAssetSchema).max(10_000),
    questions: z.array(OpenQuestionSchema).max(10_000),
    activity: z.array(ActivityEventSchema).max(100_000),
    consistencyIssues: z.array(ConsistencyIssueSchema).max(100_000),
    reportNotes: z.array(ReportNoteSchema).max(10_000),
    reportSnapshots: z.array(ReportSnapshotSchema).max(1_000),
    selectedItem: WorkspaceSelectionSchema.optional(),
    workspaceMode: z.enum([
      "scene",
      "timeline",
      "facts",
      "evidence",
      "questions",
      "hypotheses",
      "report",
    ]),
  })
  .strict();

export function parseReplayCase(input: unknown): ReplayCase {
  return ReplayCaseSchema.parse(input);
}

export function safeParseReplayCase(input: unknown) {
  return ReplayCaseSchema.safeParse(input);
}
