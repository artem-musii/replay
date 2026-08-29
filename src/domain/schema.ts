import { z } from "zod";

import { REPLAY_SCHEMA_VERSION, REPLAY_SEED_VERSION } from "./models";
import type { ReplayCase } from "./models";

// These envelopes are deliberately wider than REPLAY's authored 0..100 scenes
// and seconds-long timelines, while keeping every subtract/multiply/divide in
// canvas, calibrated-geometry, and timeline conversion comfortably finite.
export const REPLAY_MAX_SCENE_COORDINATE = 1_000_000;
export const REPLAY_MAX_ROTATION_DEGREES = 1_000_000;
export const REPLAY_MAX_TIMELINE_MS = 31_536_000_000;
export const REPLAY_MIN_SCENE_SPAN = 0.001;
export const REPLAY_MIN_CALIBRATION_METERS = 0.01;
export const REPLAY_MIN_TIMELINE_SPAN_MS = 1;

function isXml10Serializable(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) return false;
    if (codePoint > 0xffff) index += 1;
    if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) continue;
    if (codePoint >= 0x20 && codePoint <= 0xd7ff) continue;
    if (codePoint >= 0xe000 && codePoint <= 0xfffd) continue;
    if (codePoint >= 0x10000 && codePoint <= 0x10ffff) continue;
    return false;
  }
  return true;
}

/** Validates raw text before any trimming so unsafe controls are rejected, never normalized away. */
export function xmlSafeString<TSchema extends z.ZodType<string, string>>(schema: TSchema) {
  return z
    .string()
    .refine(isXml10Serializable, {
      message: "Text contains a character that XML 1.0 cannot serialize",
    })
    .pipe(schema);
}

export const XmlSafeIdSchema = xmlSafeString(z.string().trim().min(1).max(128));
export const XmlSafeShortTextSchema = xmlSafeString(z.string().trim().min(1).max(500));
export const XmlSafeLongTextSchema = xmlSafeString(z.string().trim().min(1).max(10_000));
export const SceneCoordinateSchema = z
  .number()
  .refine((value) => Math.abs(value) <= REPLAY_MAX_SCENE_COORDINATE, {
    message: "Scene coordinate magnitude must not exceed 1,000,000",
  });
export const RotationDegreesSchema = z
  .number()
  .refine((value) => Math.abs(value) <= REPLAY_MAX_ROTATION_DEGREES, {
    message: "Rotation magnitude must not exceed 1,000,000 degrees",
  });
export const TimelineMillisecondsSchema = z.number().nonnegative().max(REPLAY_MAX_TIMELINE_MS, {
  message: "Timeline value must not exceed 31,536,000,000 milliseconds",
});

const id = XmlSafeIdSchema;
const shortText = XmlSafeShortTextSchema;
const longText = XmlSafeLongTextSchema;
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

export const RoadSceneTypeSchema = z.enum([
  "roundabout",
  "intersection",
  "t-junction",
  "straight-road",
  "parking-area",
]);

export const MeasurementSourceSchema = z.enum([
  "measured",
  "manufacturer",
  "template",
  "estimated",
  "unknown",
]);
export const CalibrationSourceSchema = z.enum([
  "measured",
  "survey",
  "map",
  "template",
  "estimated",
  "unknown",
]);

export const PointSchema = z
  .object({ x: SceneCoordinateSchema, y: SceneCoordinateSchema })
  .strict();

export const ActorPoseSchema = PointSchema.extend({
  rotationDeg: RotationDegreesSchema,
}).strict();

export const ItemLockSchema = z
  .object({
    lockedBy: ActionAuthorSchema,
    lockedAt: isoDateTime,
    reason: xmlSafeString(z.string().trim().max(1_000)).optional(),
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
    sceneType: RoadSceneTypeSchema,
    roadCondition: z.enum(["wet", "dry", "unknown"]),
    weather: z.enum(["clear", "rain", "overcast", "unknown"]),
    lighting: z.enum(["daylight", "dusk", "night", "unknown"]),
    trafficSide: z.enum(["right", "left", "unknown"]).default("unknown"),
    calibration: z
      .object({
        widthMeters: finite
          .min(REPLAY_MIN_CALIBRATION_METERS, {
            message: "Calibrated scene width must be at least 0.01 metres",
          })
          .max(10_000),
        heightMeters: finite
          .min(REPLAY_MIN_CALIBRATION_METERS, {
            message: "Calibrated scene height must be at least 0.01 metres",
          })
          .max(10_000),
        source: CalibrationSourceSchema,
        uncertaintyMeters: finite.nonnegative().max(1_000),
      })
      .strict()
      .default({
        widthMeters: 100,
        heightMeters: 70,
        source: "template",
        uncertaintyMeters: 1,
      }),
    postedSpeedLimitKph: finite.positive().max(300).optional(),
    bounds: z
      .object({
        minX: SceneCoordinateSchema,
        minY: SceneCoordinateSchema,
        maxX: SceneCoordinateSchema,
        maxY: SceneCoordinateSchema,
      })
      .strict()
      .refine((bounds) => bounds.maxX > bounds.minX && bounds.maxY > bounds.minY, {
        message: "Environment bounds must have positive area",
      })
      .refine(
        (bounds) =>
          bounds.maxX - bounds.minX >= REPLAY_MIN_SCENE_SPAN &&
          bounds.maxY - bounds.minY >= REPLAY_MIN_SCENE_SPAN,
        {
          message: "Environment bounds must span at least 0.001 scene units on each axis",
        },
      ),
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
    dimensions: z
      .object({ width: finite.min(0.4).max(4), length: finite.min(1.5).max(20) })
      .strict(),
    vehicleClass: z
      .enum(["compact-car", "saloon", "suv", "van", "pickup", "motorcycle", "unknown"])
      .default("unknown"),
    dimensionsSource: MeasurementSourceSchema.default("unknown"),
    wheelbaseMeters: finite.positive().max(20).optional(),
    colorToken: xmlSafeString(z.string().trim().min(1).max(100)),
    pose: ActorPoseSchema,
    lastEditedBy: ActionAuthorSchema.optional(),
    lastEditedAt: z.iso.datetime().optional(),
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
    if (actor.wheelbaseMeters !== undefined && actor.wheelbaseMeters >= actor.dimensions.length) {
      ctx.addIssue({
        code: "custom",
        path: ["wheelbaseMeters"],
        message: "Wheelbase must be shorter than overall vehicle length",
      });
    }
  });

export const ActorKeyframeSchema = ActorPoseSchema.extend({
  id,
  actorId: id,
  timeMs: TimelineMillisecondsSchema,
}).strict();

export const TrajectorySchema = z
  .object({
    id,
    actorId: id,
    branchId: id,
    interpolationMode: z.enum(["linear", "smooth"]).optional(),
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

export const AgentProposalChangeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id,
      kind: z.literal("actor-pose"),
      actorId: id,
      basePose: ActorPoseSchema,
      proposedPose: ActorPoseSchema,
      branchId: id.optional(),
      targetTimeMs: TimelineMillisecondsSchema.optional(),
      baseTrajectory: z
        .object({
          trajectoryId: id,
          keyframes: z.array(ActorKeyframeSchema).min(1).max(2_000),
          visible: z.boolean(),
        })
        .strict()
        .optional(),
    })
    .strict()
    .superRefine((change, ctx) => {
      if (change.baseTrajectory && (!change.branchId || change.targetTimeMs === undefined)) {
        ctx.addIssue({
          code: "custom",
          path: [change.branchId ? "targetTimeMs" : "branchId"],
          message: "A reviewed trajectory baseline requires its hypothesis branch and target time",
        });
      }
      const keyframes = change.baseTrajectory?.keyframes;
      if (!keyframes) return;
      const ids = new Set<string>();
      let previousTime = -Infinity;
      keyframes.forEach((keyframe, index) => {
        if (keyframe.actorId !== change.actorId) {
          ctx.addIssue({
            code: "custom",
            path: ["baseTrajectory", "keyframes", index, "actorId"],
            message: "Proposal keyframe actor must match the changed actor",
          });
        }
        if (ids.has(keyframe.id)) {
          ctx.addIssue({
            code: "custom",
            path: ["baseTrajectory", "keyframes", index, "id"],
            message: "Proposal keyframe IDs must be unique",
          });
        }
        ids.add(keyframe.id);
        if (keyframe.timeMs <= previousTime) {
          ctx.addIssue({
            code: "custom",
            path: ["baseTrajectory", "keyframes", index, "timeMs"],
            message: "Proposal keyframe times must be strictly increasing",
          });
        }
        previousTime = keyframe.timeMs;
      });
    }),
  z
    .object({
      id,
      kind: z.literal("trajectory-set"),
      actorId: id,
      branchId: id,
      trajectoryId: id,
      createsTrajectory: z.boolean(),
      baseActorPose: ActorPoseSchema,
      baseTrajectory: z
        .object({
          keyframes: z.array(ActorKeyframeSchema).min(1).max(2_000),
          visible: z.boolean(),
        })
        .strict()
        .optional(),
      proposedTrajectory: z
        .object({
          keyframes: z.array(ActorKeyframeSchema).min(1).max(2_000),
          visible: z.boolean(),
        })
        .strict(),
    })
    .strict()
    .superRefine((change, ctx) => {
      if (change.createsTrajectory === Boolean(change.baseTrajectory)) {
        ctx.addIssue({
          code: "custom",
          path: ["baseTrajectory"],
          message:
            "New trajectory proposals cannot have a base trajectory, and updates require one",
        });
      }
      const validateKeyframes = (
        keyframes: (typeof change.proposedTrajectory)["keyframes"],
        path: string,
      ) => {
        const ids = new Set<string>();
        let previousTime = -Infinity;
        keyframes.forEach((keyframe, index) => {
          if (keyframe.actorId !== change.actorId) {
            ctx.addIssue({
              code: "custom",
              path: [path, "keyframes", index, "actorId"],
              message: "Proposal keyframe actor must match the changed actor",
            });
          }
          if (ids.has(keyframe.id)) {
            ctx.addIssue({
              code: "custom",
              path: [path, "keyframes", index, "id"],
              message: "Proposal keyframe IDs must be unique",
            });
          }
          ids.add(keyframe.id);
          if (keyframe.timeMs <= previousTime) {
            ctx.addIssue({
              code: "custom",
              path: [path, "keyframes", index, "timeMs"],
              message: "Proposal keyframe times must be strictly increasing",
            });
          }
          previousTime = keyframe.timeMs;
        });
      };
      validateKeyframes(change.proposedTrajectory.keyframes, "proposedTrajectory");
      if (change.baseTrajectory)
        validateKeyframes(change.baseTrajectory.keyframes, "baseTrajectory");
    }),
]);

export const AgentProposalRevisionSchema = z
  .object({
    id,
    revisionNumber: z.number().int().positive().max(100),
    summary: shortText,
    createdBy: z.enum(["agent", "human"]),
    origin: z.enum(["webmcp", "ui"]),
    authorshipTrusted: z.boolean(),
    createdAt: isoDateTime,
    changes: z.array(AgentProposalChangeSchema).min(1).max(25),
  })
  .strict()
  .superRefine((revision, ctx) => {
    if (
      (revision.createdBy === "agent" && revision.origin !== "webmcp") ||
      (revision.createdBy === "human" && revision.origin !== "ui")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["origin"],
        message: "Proposal revision authorship must match its origin",
      });
    }
    const changeIds = new Set<string>();
    const actorIds = new Set<string>();
    revision.changes.forEach((change, index) => {
      if (changeIds.has(change.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["changes", index, "id"],
          message: "Proposal change IDs must be unique within a revision",
        });
      }
      changeIds.add(change.id);
      if (actorIds.has(change.actorId)) {
        ctx.addIssue({
          code: "custom",
          path: ["changes", index, "actorId"],
          message: "A proposal revision cannot contain ambiguous changes for the same actor",
        });
      }
      actorIds.add(change.actorId);
    });
  });

export const AgentProposalDecisionSchema = z
  .object({
    outcome: z.enum(["accepted", "rejected"]),
    revisionId: id,
    decidedBy: z.literal("human"),
    origin: z.literal("ui"),
    decidedAt: isoDateTime,
    note: longText.optional(),
    humanAttestationTrusted: z.boolean(),
  })
  .strict();

export const AgentProposalSchema = z
  .object({
    id,
    title: shortText,
    rationale: longText,
    status: z.enum(["pending", "accepted", "rejected"]),
    createdBy: z.literal("agent"),
    origin: z.literal("webmcp"),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
    revisions: z.array(AgentProposalRevisionSchema).min(1).max(100),
    decision: AgentProposalDecisionSchema.optional(),
  })
  .strict()
  .superRefine((proposal, ctx) => {
    const revisionIds = new Set<string>();
    proposal.revisions.forEach((revision, index) => {
      if (revisionIds.has(revision.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["revisions", index, "id"],
          message: "Proposal revision IDs must be unique",
        });
      }
      revisionIds.add(revision.id);
      if (revision.revisionNumber !== index + 1) {
        ctx.addIssue({
          code: "custom",
          path: ["revisions", index, "revisionNumber"],
          message: "Proposal revision numbers must be contiguous and ordered",
        });
      }
      if (index === 0 && (revision.createdBy !== "agent" || revision.origin !== "webmcp")) {
        ctx.addIssue({
          code: "custom",
          path: ["revisions", index, "createdBy"],
          message: "The initial proposal revision must come from a WebMCP agent",
        });
      }
    });
    const latestRevision = proposal.revisions.at(-1);
    if (proposal.status === "pending" && proposal.decision) {
      ctx.addIssue({
        code: "custom",
        path: ["decision"],
        message: "Pending proposals cannot have a decision",
      });
    }
    if (proposal.status !== "pending") {
      if (!proposal.decision) {
        ctx.addIssue({
          code: "custom",
          path: ["decision"],
          message: "Accepted and rejected proposals require a human decision record",
        });
      } else {
        if (proposal.decision.outcome !== proposal.status) {
          ctx.addIssue({
            code: "custom",
            path: ["decision", "outcome"],
            message: "Proposal decision outcome must match proposal status",
          });
        }
        if (latestRevision && proposal.decision.revisionId !== latestRevision.id) {
          ctx.addIssue({
            code: "custom",
            path: ["decision", "revisionId"],
            message: "A proposal decision must identify the reviewed latest revision",
          });
        }
      }
    }
  });

export const TimelineEventSchema = z
  .object({
    id,
    branchId: id,
    timeMs: TimelineMillisecondsSchema,
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
    label: xmlSafeString(z.string().trim().max(500)).optional(),
  }).strict(),
  AnnotationBaseSchema.extend({
    kind: z.literal("rectangle"),
    x: finite.min(0).max(1),
    y: finite.min(0).max(1),
    width: finite.positive().max(1),
    height: finite.positive().max(1),
    label: xmlSafeString(z.string().trim().max(500)).optional(),
  }).strict(),
]);

export const EvidenceAnnotationLinkSchema = z
  .object({
    annotationId: id,
    targetType: z.enum([
      "claim",
      "timeline-event",
      "actor",
      "trajectory",
      "damage",
      "hypothesis",
      "assumption",
    ]),
    targetId: id,
  })
  .strict();

export const EvidenceAssetSchema = z
  .object({
    id,
    name: xmlSafeString(z.string().trim().min(1).max(255)),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(20 * 1024 * 1024),
    localBlobKey: xmlSafeString(z.string().trim().min(1).max(500)),
    checksum: xmlSafeString(z.string().trim().min(8).max(256)),
    syntheticDemoAsset: z.boolean(),
    source: z.enum(["demo", "local-upload", "import"]),
    capturedAt: isoDateTime.optional(),
    createdAt: isoDateTime,
    notes: xmlSafeString(z.string().max(10_000)).optional(),
    tags: z.array(xmlSafeString(z.string().trim().min(1).max(100))).max(100),
    annotations: z.array(EvidenceAnnotationSchema).max(1_000),
    annotationLinks: z.array(EvidenceAnnotationLinkSchema).max(10_000),
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
    answer: xmlSafeString(z.string().trim().min(1).max(10_000)).optional(),
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
    actionType: xmlSafeString(z.string().trim().min(1).max(200)),
    classification: z.literal("human-override").optional(),
    overridesActivityId: id.optional(),
    summary: shortText,
    affectedIds: z.array(id).max(5_000),
    requestId: id.optional(),
    requestIntentFingerprint: z
      .string()
      .regex(/^intent-v1-[a-f0-9]{32}$/)
      .optional(),
    undoable: z.boolean(),
    createdAt: isoDateTime,
  })
  .strict()
  .superRefine((activity, ctx) => {
    if (activity.classification === "human-override" && !activity.overridesActivityId) {
      ctx.addIssue({
        code: "custom",
        path: ["overridesActivityId"],
        message: "Human override activity must identify the overridden agent activity",
      });
    }
    if (
      activity.classification === "human-override" &&
      (activity.author !== "human" || activity.origin !== "ui")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["classification"],
        message: "Human override activity must be authored by a human through the UI",
      });
    }
    if (activity.overridesActivityId && activity.classification !== "human-override") {
      ctx.addIssue({
        code: "custom",
        path: ["classification"],
        message: "An overridden activity ID requires human-override classification",
      });
    }
  });

export const ConsistencyIssueSchema = z
  .object({
    id,
    ruleId: id,
    scope: z.enum([
      "timeline",
      "geometry",
      "motion",
      "damage",
      "integrity",
      "provenance",
      "completeness",
      "report",
    ]),
    severity: z.enum(["error", "warning", "question"]),
    title: shortText,
    explanation: longText,
    affectedIds: z.array(id).max(5_000),
    suggestedActions: z.array(shortText).max(100),
  })
  .strict();

export const ReportCitationSchema = z
  .object({
    claimIds: z.array(id).max(5_000),
    evidenceIds: z.array(id).max(5_000),
    workspacePaths: z.array(xmlSafeString(z.string().trim().min(1).max(500))).max(10_000),
  })
  .strict();

export const ReportStatementSchema = z
  .object({
    id,
    text: longText,
    certainty: z.enum(["confirmed", "reported", "uncertain", "hypothesis", "attested", "system"]),
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
    reviewBinding: z
      .object({
        algorithm: z.literal("SHA-256"),
        fingerprint: z.string().regex(/^sha256-[a-f0-9]{64}$/),
        branchIds: z.array(id).max(1_000),
        includeHypotheses: z.boolean(),
      })
      .strict()
      .optional(),
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

const CompletenessAttestationBaseSchema = z.object({
  id,
  attestedBy: z.literal("human"),
  origin: z.literal("ui"),
  attestedAt: isoDateTime,
  basisFingerprint: z.string().regex(/^completeness-v1-sha256-[a-f0-9]{64}$/),
  humanAttestationTrusted: z.boolean(),
});

export const CompletenessAttestationSchema = z.discriminatedUnion("kind", [
  CompletenessAttestationBaseSchema.extend({
    kind: z.literal("no-evidence-supplied"),
  }).strict(),
  CompletenessAttestationBaseSchema.extend({
    kind: z.literal("actor-damage"),
    actorId: id,
    outcome: z.enum(["unknown", "not-assessed"]),
  }).strict(),
  CompletenessAttestationBaseSchema.extend({
    kind: z.literal("uncertainty-review-completed"),
  }).strict(),
]);

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

export const TimeRangeSchema = z
  .object({
    start: TimelineMillisecondsSchema,
    end: TimelineMillisecondsSchema.positive(),
  })
  .strict()
  .refine((range) => range.end > range.start, {
    message: "Time range end must follow start",
  })
  .refine((range) => range.end - range.start >= REPLAY_MIN_TIMELINE_SPAN_MS, {
    message: "Time range must span at least 1 millisecond",
  });

export const ReplayCaseSchema = z
  .object({
    schemaVersion: z.literal(REPLAY_SCHEMA_VERSION),
    // Historical deterministic demo seeds remain loadable so a saved local
    // account is never discarded merely because the bundled demo improved.
    seedVersion: z.number().int().positive().max(REPLAY_SEED_VERSION).optional(),
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
    timeRangeMs: TimeRangeSchema,
    actors: z.array(SceneActorSchema).min(1).max(100),
    trajectories: z.array(TrajectorySchema).max(10_000),
    timelineEvents: z.array(TimelineEventSchema).max(10_000),
    branches: z.array(HypothesisBranchSchema).min(1).max(1_000),
    activeBranchId: id,
    claims: z.array(ClaimSchema).max(10_000),
    evidence: z.array(EvidenceAssetSchema).max(10_000),
    questions: z.array(OpenQuestionSchema).max(10_000),
    proposals: z
      .array(AgentProposalSchema)
      .max(500)
      .default(() => []),
    activity: z.array(ActivityEventSchema).max(100_000),
    consistencyIssues: z.array(ConsistencyIssueSchema).max(100_000),
    completenessAttestations: z
      .array(CompletenessAttestationSchema)
      .max(1_000)
      .default(() => []),
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
