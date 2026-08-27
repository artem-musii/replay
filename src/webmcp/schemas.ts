import { z } from "zod";

import {
  ACTIVITY_AUTHOR_FILTERS,
  CONSISTENCY_SCOPES,
  HYPOTHESIS_COMPARISON_MODES,
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
  .regex(REQUEST_ID_PATTERN, "Use an opaque request ID of at least 8 safe characters.");

const shortTextSchema = z.string().trim().min(1).max(160);
const statementSchema = z.string().trim().min(1).max(2_000);
const descriptionSchema = z.string().trim().min(1).max(1_000);
const expectedVersionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const normalizedCoordinateSchema = z.number().min(0).max(1);

const normalizedPositionSchema = z
  .object({
    x: normalizedCoordinateSchema,
    y: normalizedCoordinateSchema,
  })
  .strict();

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
    relatedIds: z.array(replayIdSchema).max(32).default([]),
  })
  .strict();

export const webMCPInputSchemas = {
  get_case_summary: z.object({}).strict(),

  get_workspace_state: z
    .object({
      sections: z.array(z.enum(WORKSPACE_SECTIONS)).min(1).max(WORKSPACE_SECTIONS.length),
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
      workspaceMode: z.string().trim().min(1).max(64).optional(),
    })
    .strict(),

  revert_agent_action: z
    .object({
      activityId: replayIdSchema,
      ...mutationMetadataShape,
    })
    .strict(),

  upsert_scene_actor: z
    .object({
      actorId: replayIdSchema.optional(),
      label: shortTextSchema,
      position: normalizedPositionSchema,
      rotationDeg: z.number().min(-360).max(360),
      dimensions: z
        .object({
          width: z.number().positive().max(20),
          length: z.number().positive().max(20),
        })
        .strict(),
      colorToken: z.string().trim().min(1).max(64).optional(),
      ...mutationMetadataShape,
    })
    .strict(),

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

  mark_impact_event: z
    .object({
      eventId: replayIdSchema.optional(),
      branchId: replayIdSchema,
      timeMs: z.number().int().nonnegative().max(86_400_000),
      location: normalizedPositionSchema,
      actorIds: z.array(replayIdSchema).min(2).max(4),
      status: agentClaimStatusSchema,
      confidence: z.number().min(0).max(1).optional(),
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
      sourceIds: z.array(replayIdSchema).max(32).default([]),
      status: agentClaimStatusSchema,
      ...mutationMetadataShape,
    })
    .strict(),

  add_observation: z
    .object({
      statement: statementSchema,
      sourceType: sourceTypeSchema,
      linkedIds: z.array(replayIdSchema).max(64).default([]),
      status: agentClaimStatusSchema,
      branchId: replayIdSchema.optional(),
      sharedAcrossBranches: z.boolean().default(false),
      ...mutationMetadataShape,
    })
    .strict()
    .superRefine((value, context) => {
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
      targetType: z.enum(["actor", "trajectory", "event", "claim", "hypothesis", "damage"]),
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
      relatedIds: z.array(replayIdSchema).max(64).default([]),
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
      assumptionId: replayIdSchema.optional(),
      operation: z.enum(["add", "update", "remove"]),
      assumption: assumptionSchema.optional(),
      ...mutationMetadataShape,
    })
    .strict()
    .superRefine((value, context) => {
      if (value.operation === "add" && value.assumption === undefined) {
        context.addIssue({
          code: "custom",
          path: ["assumption"],
          message: "Add requires an assumption.",
        });
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
      if (value.operation === "remove" && value.assumptionId === undefined) {
        context.addIssue({
          code: "custom",
          path: ["assumptionId"],
          message: "Remove requires assumptionId.",
        });
      }
    }),

  compare_hypotheses: z
    .object({
      branchIds: z.array(replayIdSchema).min(2).max(8),
      comparisonMode: z.enum(HYPOTHESIS_COMPARISON_MODES).default("full"),
    })
    .strict()
    .refine((value) => new Set(value.branchIds).size >= 2, {
      path: ["branchIds"],
      message: "Compare at least two distinct hypotheses.",
    }),

  build_report_preview: z
    .object({
      branchId: replayIdSchema.optional(),
      ...mutationMetadataShape,
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
