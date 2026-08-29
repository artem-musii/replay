import { z } from "zod";

import { REPLAY_MAX_SCENE_COORDINATE, REPLAY_MIN_SCENE_SPAN } from "../domain";
import {
  ACTIVITY_AUTHOR_FILTERS,
  CONSISTENCY_SCOPES,
  WORKSPACE_ITEM_TYPES,
  WORKSPACE_SECTIONS,
  type WebMCPToolName,
} from "./types";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export const replayIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(ID_PATTERN, "Use a stable alphanumeric ID; '.', '_', ':', and '-' are allowed.");

export const requestIdSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(REQUEST_ID_PATTERN, "Use an opaque request ID of at least 8 safe characters.")
  .describe(
    "Client-generated idempotency key for this mutation. Reuse it only when retrying the exact same intent; use a new value for a changed request.",
  );

const shortTextSchema = z.string().trim().min(1).max(160);
const statementSchema = z.string().trim().min(1).max(2_000);
const descriptionSchema = z.string().trim().min(1).max(1_000);
export const WEBMCP_SCENE_COORDINATE_LIMIT =
  (REPLAY_MAX_SCENE_COORDINATE * 2) / REPLAY_MIN_SCENE_SPAN;
const expectedVersionSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .describe(
    "Current caseVersion from the latest read result. The mutation fails with VERSION_CONFLICT if the live case has changed.",
  );
const normalizedCoordinateSchema = z
  .number()
  .min(-WEBMCP_SCENE_COORDINATE_LIMIT)
  .max(WEBMCP_SCENE_COORDINATE_LIMIT)
  .describe(
    "Affine scene coordinate normalized against the open case bounds. In-bounds values are 0..1; finite values outside 0..1 preserve schema-valid diagnostic geometry outside those bounds.",
  );

const normalizedPositionSchema = z
  .object({
    x: normalizedCoordinateSchema,
    y: normalizedCoordinateSchema,
  })
  .strict()
  .describe(
    "Affine scene position: for in-bounds geometry, x runs left (0) to right (1) and y runs top (0) to bottom (1). Out-of-bounds diagnostic values remain proportionally outside 0..1. Values can be reused directly from get_workspace_state.",
  );

const expectedPoseTargetSchema = z
  .object({
    branchId: replayIdSchema.describe(
      "Exact active branchId copied from the latest get_workspace_state scene read.",
    ),
    playheadTimeMs: z
      .number()
      .int()
      .nonnegative()
      .max(86_400_000)
      .describe("Exact playheadTimeMs copied from the latest get_workspace_state scene read."),
  })
  .strict()
  .describe(
    "Optimistic target guard for a path-bound pose. The mutation fails with VERSION_CONFLICT if the visible active branch or playhead has moved since the scene read.",
  );

const mutationMetadataShape = {
  expectedVersion: expectedVersionSchema,
  requestId: requestIdSchema,
} as const;

const agentClaimStatusSchema = z.enum([
  "reported",
  "likely",
  "uncertain",
  "disputed",
  "unknown",
  "agent-hypothesis",
]);

const agentImpactStatusSchema = z.enum(["reported", "uncertain", "agent-hypothesis"]);

const impactActorIdsSchema = z
  .array(replayIdSchema)
  .min(2)
  .max(4)
  .refine((actorIds) => new Set(actorIds).size === actorIds.length, {
    message: "Impact actor IDs must be distinct.",
  })
  .meta({ uniqueItems: true });

const sourceTypeSchema = z.enum([
  "human-statement",
  "witness-statement",
  "photo",
  "document",
  "scene-observation",
  "system-derived",
  "agent-inference",
]);

const assumptionSchema = z
  .object({
    statement: statementSchema,
    relatedIds: z
      .array(replayIdSchema)
      .max(32)
      .default([])
      .describe(
        "Existing active evidence IDs that support this assumption. Other workspace item types are not accepted here.",
      ),
  })
  .strict();

const proposedKeyframeSchema = z
  .object({
    id: replayIdSchema
      .optional()
      .describe("Existing keyframe ID when replacing a trajectory; omit only for a new keyframe."),
    timeMs: z
      .number()
      .int()
      .nonnegative()
      .max(86_400_000)
      .describe("Milliseconds from the start of the reviewed interval."),
    x: normalizedCoordinateSchema,
    y: normalizedCoordinateSchema,
    rotationDeg: z.number().min(-360).max(360).describe("Vehicle rotation in degrees."),
  })
  .strict()
  .describe(
    "One pose in a complete ordered trajectory. The first keyframe is the starting pose and the last is the final pose; intermediate poses describe geometry only and do not create timeline events.",
  );

const trajectoryKeyframeAdjustmentSchema = z
  .object({
    keyframeId: replayIdSchema.describe(
      "Existing interior keyframe ID from get_workspace_state.scene.trajectories[].keyframes[].id.",
    ),
    x: normalizedCoordinateSchema
      .optional()
      .describe("Replacement normalized x coordinate; omit to preserve the current value."),
    y: normalizedCoordinateSchema
      .optional()
      .describe("Replacement normalized y coordinate; omit to preserve the current value."),
    rotationDeg: z
      .number()
      .min(-360)
      .max(360)
      .optional()
      .describe("Replacement rotation in degrees; omit to preserve the current value."),
  })
  .strict()
  .refine(
    (adjustment) =>
      adjustment.x !== undefined ||
      adjustment.y !== undefined ||
      adjustment.rotationDeg !== undefined,
    {
      path: ["x"],
      message: "A keyframe adjustment requires at least one of x, y, or rotationDeg.",
    },
  );

const trajectoryKeyframeAdjustmentsSchema = z
  .array(trajectoryKeyframeAdjustmentSchema)
  .min(1)
  .max(8)
  .refine(
    (adjustments) =>
      new Set(adjustments.map((adjustment) => adjustment.keyframeId)).size === adjustments.length,
    { message: "Keyframe adjustment IDs must be unique." },
  )
  .meta({ uniqueItems: true })
  .describe(
    "One to eight edits to existing interior keyframes. First and last trajectory keyframes are protected to preserve endpoints.",
  );

const proposalChangeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("actor-pose"),
      actorId: replayIdSchema,
      proposedPose: normalizedPositionSchema
        .extend({
          rotationDeg: z.number().min(-360).max(360),
        })
        .describe(
          "Pose at the currently visible playhead. Review binds it to that exact branch, time, and trajectory baseline.",
        ),
    })
    .strict(),
  z
    .object({
      kind: z.literal("trajectory-set"),
      trajectoryId: replayIdSchema
        .optional()
        .describe("Existing trajectory ID from the scene read, or omit when proposing a new path."),
      actorId: replayIdSchema.describe("Existing scene actor ID."),
      branchId: replayIdSchema.describe("Existing active hypothesis branch ID."),
      keyframes: z
        .array(proposedKeyframeSchema)
        .min(2)
        .max(100)
        .describe(
          "Complete ordered reconstruction path. The first keyframe sets the starting pose and the last sets the final pose; include intermediate geometry as needed. A keyframe does not create an impact event—use mark_impact_event separately. Reuse existing keyframe IDs when replacing a path, or omit IDs for new points.",
        ),
      visible: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      kind: z.literal("trajectory-keyframe-patch"),
      actorId: replayIdSchema.describe("Existing scene actor ID."),
      branchId: replayIdSchema.describe("Existing active hypothesis branch ID."),
      adjustments: trajectoryKeyframeAdjustmentsSchema,
      visible: z
        .literal(true)
        .default(true)
        .describe("The patched trajectory remains visible in the human review preview."),
    })
    .strict(),
]);

export const webMCPInputSchemas = {
  get_case_summary: z.object({}).strict(),

  get_workspace_state: z
    .object({
      sections: z
        .array(z.enum(WORKSPACE_SECTIONS))
        .min(1)
        .max(WORKSPACE_SECTIONS.length)
        .describe(
          "Requested live sections. Spatial x/y values are affine coordinates normalized against the open case bounds: in-bounds geometry is 0..1, while diagnostic out-of-bounds geometry remains proportionally outside that range.",
        ),
      branchId: replayIdSchema
        .optional()
        .describe(
          "Optional hypothesis branch to project in scene and timeline. Omit to read the active branch. Reading another branch does not activate it or mutate the case.",
        ),
    })
    .strict(),

  get_recent_activity: z
    .object({
      limit: z.number().int().min(1).max(100).default(20),
      author: z.enum(ACTIVITY_AUTHOR_FILTERS).default("all"),
    })
    .strict(),

  validate_case_consistency: z
    .object({
      branchId: replayIdSchema.optional(),
      scope: z.enum(CONSISTENCY_SCOPES).default("all"),
    })
    .strict(),

  focus_workspace_item: z
    .object({
      itemType: z.enum(WORKSPACE_ITEM_TYPES),
      itemId: replayIdSchema,
      branchId: replayIdSchema
        .optional()
        .describe(
          "Owning branch for a trajectory or timeline event. Supply it to inspect an inactive-branch item without activating that branch; omit it for active-branch items and all other item types.",
        ),
    })
    .strict()
    .superRefine((value, context) => {
      if (
        value.branchId !== undefined &&
        value.itemType !== "trajectory" &&
        value.itemType !== "event"
      ) {
        context.addIssue({
          code: "custom",
          path: ["branchId"],
          message: "branchId is accepted only when focusing a trajectory or timeline event.",
        });
      }
    }),

  revert_agent_action: z
    .object({
      activityId: replayIdSchema.describe(
        "Canonical activity id returned in get_recent_activity for an item whose current revertEligible value is true. Do not pass its requestId or a session-only tool-invocation id.",
      ),
      ...mutationMetadataShape,
    })
    .strict(),

  upsert_scene_actor: z
    .object({
      actorId: replayIdSchema
        .optional()
        .describe("Existing actor ID to update. Omit to create a new actor."),
      label: shortTextSchema
        .optional()
        .describe("New label. Required when actorId is omitted; otherwise unchanged if omitted."),
      position: normalizedPositionSchema
        .optional()
        .describe(
          "New normalized position. For an existing actor, expectedPoseTarget binds a path edit to the branch/playhead read by the caller. Required when actorId is omitted; otherwise unchanged if omitted.",
        ),
      rotationDeg: z
        .number()
        .min(-360)
        .max(360)
        .optional()
        .describe(
          "New rotation in degrees. For an existing actor, expectedPoseTarget binds a path edit to the branch/playhead read by the caller. Required when actorId is omitted; otherwise unchanged if omitted.",
        ),
      dimensions: z
        .object({
          width: z.number().min(0.4).max(4),
          length: z.number().min(1.5).max(20),
        })
        .strict()
        .optional()
        .describe(
          "Vehicle width and length in metres. Required when actorId is omitted; otherwise unchanged if omitted.",
        ),
      vehicleClass: z
        .enum(["compact-car", "saloon", "suv", "van", "pickup", "motorcycle", "unknown"])
        .optional(),
      dimensionsSource: z.enum(["template", "estimated", "unknown"]).optional(),
      wheelbaseMeters: z.number().min(0.8).max(12).optional(),
      colorToken: z.string().trim().min(1).max(64).optional(),
      expectedPoseTarget: expectedPoseTargetSchema.optional(),
      ...mutationMetadataShape,
    })
    .strict()
    .superRefine((value, context) => {
      if (value.actorId !== undefined) {
        const hasUpdate = [
          value.label,
          value.position,
          value.rotationDeg,
          value.dimensions,
          value.vehicleClass,
          value.dimensionsSource,
          value.wheelbaseMeters,
          value.colorToken,
        ].some((field) => field !== undefined);
        if (!hasUpdate) {
          context.addIssue({
            code: "custom",
            path: ["actorId"],
            message: "Updating a scene actor requires at least one editable field.",
          });
        }
        if (
          (value.position !== undefined || value.rotationDeg !== undefined) &&
          value.expectedPoseTarget === undefined
        ) {
          context.addIssue({
            code: "custom",
            path: ["expectedPoseTarget"],
            message:
              "expectedPoseTarget is required when changing an existing actor position or rotation.",
          });
        }
        return;
      }
      for (const field of ["label", "position", "rotationDeg", "dimensions"] as const) {
        if (value[field] !== undefined) continue;
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} is required when creating a scene actor.`,
        });
      }
    }),

  set_actor_trajectory: z
    .object({
      actorId: replayIdSchema,
      branchId: replayIdSchema,
      keyframes: z
        .array(
          z
            .object({
              id: replayIdSchema.optional(),
              timeMs: z.number().int().nonnegative().max(86_400_000),
              x: normalizedCoordinateSchema,
              y: normalizedCoordinateSchema,
              rotationDeg: z.number().min(-360).max(360),
            })
            .strict(),
        )
        .min(2)
        .max(100),
      ...mutationMetadataShape,
    })
    .strict()
    .superRefine(({ keyframes }, context) => {
      for (let index = 1; index < keyframes.length; index += 1) {
        const current = keyframes[index];
        const previous = keyframes[index - 1];
        if (current !== undefined && previous !== undefined && current.timeMs <= previous.timeMs) {
          context.addIssue({
            code: "custom",
            path: ["keyframes", index, "timeMs"],
            message: "Trajectory keyframe times must be strictly increasing.",
          });
        }
      }
    }),

  propose_scene_changes: z
    .object({
      proposalId: replayIdSchema
        .optional()
        .describe("Optional new proposal ID; omit to derive one from requestId."),
      title: shortTextSchema,
      rationale: descriptionSchema,
      changes: z
        .array(proposalChangeSchema)
        .min(1)
        .max(10)
        .describe(
          "One preview change per affected actor. A single-actor proposal is allowed; group multiple actors when their reconstruction should be reviewed atomically. Read current scene and timeline sections first for actor/branch IDs, coordinates, and timeline.timeRangeMs.",
        ),
      expectedPoseTarget: expectedPoseTargetSchema
        .optional()
        .describe(
          "Required when any change has kind actor-pose; omitted for trajectory-only proposals.",
        ),
      ...mutationMetadataShape,
    })
    .strict()
    .superRefine(({ changes, expectedPoseTarget }, context) => {
      if (
        changes.some((change) => change.kind === "actor-pose") &&
        expectedPoseTarget === undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["expectedPoseTarget"],
          message: "expectedPoseTarget is required when proposing an actor-pose change.",
        });
      }
      const actorIds = new Set<string>();
      changes.forEach((change, changeIndex) => {
        if (actorIds.has(change.actorId)) {
          context.addIssue({
            code: "custom",
            path: ["changes", changeIndex, "actorId"],
            message: "A proposal may contain only one change per actor.",
          });
        }
        actorIds.add(change.actorId);
        if (change.kind !== "trajectory-set") return;
        for (let frameIndex = 1; frameIndex < change.keyframes.length; frameIndex += 1) {
          const current = change.keyframes[frameIndex];
          const previous = change.keyframes[frameIndex - 1];
          if (current && previous && current.timeMs <= previous.timeMs) {
            context.addIssue({
              code: "custom",
              path: ["changes", changeIndex, "keyframes", frameIndex, "timeMs"],
              message: "Proposed keyframe times must be strictly increasing.",
            });
          }
        }
      });
    }),

  mark_impact_event: z
    .object({
      eventId: replayIdSchema
        .optional()
        .describe(
          "Exact ID of an existing impact event on branchId to update. Omit eventId to create a new impact; an ID for another event type or branch is rejected and never reclassified or moved.",
        ),
      branchId: replayIdSchema,
      timeMs: z.number().int().nonnegative().max(86_400_000),
      location: normalizedPositionSchema,
      actorIds: impactActorIdsSchema,
      status: agentImpactStatusSchema,
      ...mutationMetadataShape,
    })
    .strict(),

  mark_vehicle_damage: z
    .object({
      actorId: replayIdSchema,
      damageRegion: z.enum([
        "front",
        "front-left",
        "front-right",
        "left",
        "right",
        "rear",
        "rear-left",
        "rear-right",
        "other",
      ]),
      description: descriptionSchema,
      sourceIds: z
        .array(replayIdSchema)
        .min(1, "At least one source ID is required for a damage record.")
        .max(32)
        .describe(
          "One or more existing active evidence or observation IDs that source this non-confirmed damage record.",
        ),
      status: agentClaimStatusSchema,
      ...mutationMetadataShape,
    })
    .strict(),

  add_observation: z
    .object({
      statement: statementSchema,
      sourceType: sourceTypeSchema.describe(
        "Provenance category. Use agent-inference for the agent's own reasoning; externally attributed categories require a compatible canonical source in sourceIds.",
      ),
      sourceIds: z
        .array(replayIdSchema)
        .max(64)
        .default([])
        .describe(
          "Existing active evidence or observation IDs used as canonical provenance. Human/witness/document attribution needs a same-type human-attributed observation; photo attribution needs active image evidence or a human-attributed photo observation.",
        ),
      relatedIds: z
        .array(replayIdSchema)
        .max(64)
        .default([])
        .describe(
          "Existing active evidence, timeline-event, actor, trajectory, or damage-marker IDs that provide inspectable context without becoming provenance sources.",
        ),
      status: agentClaimStatusSchema,
      branchId: replayIdSchema.optional(),
      sharedAcrossBranches: z.boolean().default(false),
      ...mutationMetadataShape,
    })
    .strict()
    .superRefine((value, context) => {
      if (
        ["human-statement", "witness-statement", "photo", "document"].includes(value.sourceType) &&
        value.sourceIds.length === 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["sourceIds"],
          message:
            "Externally attributed observations require at least one compatible canonical source ID.",
        });
      }
      if (!value.sharedAcrossBranches && value.branchId === undefined) {
        context.addIssue({
          code: "custom",
          path: ["branchId"],
          message: "A branch-scoped observation requires branchId.",
        });
      }
    }),

  link_evidence: z
    .object({
      evidenceId: replayIdSchema,
      targetType: z.enum([
        "actor",
        "trajectory",
        "event",
        "claim",
        "hypothesis",
        "assumption",
        "damage",
      ]),
      targetId: replayIdSchema,
      annotationId: replayIdSchema.optional(),
      ...mutationMetadataShape,
    })
    .strict(),

  create_open_question: z
    .object({
      question: z.string().trim().min(1).max(1_000),
      reason: descriptionSchema,
      importance: z.enum(["blocking", "high", "medium", "low"]),
      relatedIds: z
        .array(replayIdSchema)
        .max(64)
        .default([])
        .describe(
          "Existing observation, actor, trajectory, timeline event, damage marker, or hypothesis branch IDs. Evidence IDs are not accepted as question relations; connect the related observation or scene item instead.",
        ),
      ...mutationMetadataShape,
    })
    .strict(),

  fork_hypothesis: z
    .object({
      sourceBranchId: replayIdSchema,
      name: shortTextSchema,
      description: descriptionSchema,
      assumptions: z.array(assumptionSchema).min(1).max(32),
      ...mutationMetadataShape,
    })
    .strict(),

  update_hypothesis_assumption: z
    .object({
      branchId: replayIdSchema,
      assumptionId: replayIdSchema
        .optional()
        .describe("Required for update or remove; omit for add."),
      operation: z
        .enum(["add", "update", "remove"])
        .describe(
          "Operation discriminator: add accepts only assumption, update requires assumptionId and assumption, and remove accepts only assumptionId.",
        ),
      assumption: assumptionSchema
        .optional()
        .describe("Required for add or update; omit for remove."),
      ...mutationMetadataShape,
    })
    .strict()
    .superRefine((value, context) => {
      if (value.operation === "add") {
        if (value.assumption === undefined) {
          context.addIssue({
            code: "custom",
            path: ["assumption"],
            message: "Add requires an assumption.",
          });
        }
        if (value.assumptionId !== undefined) {
          context.addIssue({
            code: "custom",
            path: ["assumptionId"],
            message: "Add does not accept assumptionId.",
          });
        }
      }
      if (
        value.operation === "update" &&
        (value.assumptionId === undefined || value.assumption === undefined)
      ) {
        context.addIssue({
          code: "custom",
          path: ["assumption"],
          message: "Update requires assumptionId and assumption.",
        });
      }
      if (value.operation === "remove") {
        if (value.assumptionId === undefined) {
          context.addIssue({
            code: "custom",
            path: ["assumptionId"],
            message: "Remove requires assumptionId.",
          });
        }
        if (value.assumption !== undefined) {
          context.addIssue({
            code: "custom",
            path: ["assumption"],
            message: "Remove does not accept assumption.",
          });
        }
      }
    }),

  compare_hypotheses: z
    .object({
      branchIds: z
        .array(replayIdSchema)
        .min(2)
        .max(8)
        .describe(
          "Two to eight distinct hypothesis branches. The first is the comparison baseline; remaining branches are compared with it without changing the active branch.",
        ),
    })
    .strict()
    .refine((value) => new Set(value.branchIds).size >= 2, {
      path: ["branchIds"],
      message: "Compare at least two distinct hypotheses.",
    }),

  build_report_preview: z
    .object({
      branchId: replayIdSchema.optional(),
      expectedVersion: expectedVersionSchema,
    })
    .strict(),

  add_report_note: z
    .object({
      note: z.string().trim().min(1).max(2_000),
      claimIds: z.array(replayIdSchema).max(64).default([]),
      evidenceIds: z.array(replayIdSchema).max(64).default([]),
      ...mutationMetadataShape,
    })
    .strict()
    .refine((value) => value.claimIds.length + value.evidenceIds.length > 0, {
      path: ["claimIds"],
      message: "A report note requires at least one supporting claim or evidence ID.",
    }),
} as const satisfies Record<WebMCPToolName, z.ZodType>;

export type WebMCPInputSchemaMap = typeof webMCPInputSchemas;

export function toJSONSchema(schema: z.ZodType): Readonly<Record<string, unknown>> {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-2020-12" });
  return jsonSchema;
}
