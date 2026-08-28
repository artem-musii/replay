import { z } from "zod";

import type { WorkspaceMode } from "../domain/models";
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
  .regex(REQUEST_ID_PATTERN, "Use an opaque request ID of at least 8 safe characters.");

const shortTextSchema = z.string().trim().min(1).max(160);
const statementSchema = z.string().trim().min(1).max(2_000);
const descriptionSchema = z.string().trim().min(1).max(1_000);
const expectedVersionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const normalizedCoordinateSchema = z.number().min(0).max(1);

const WORKSPACE_MODES = [
  "scene",
  "timeline",
  "facts",
  "evidence",
  "questions",
  "hypotheses",
  "report",
] as const satisfies readonly WorkspaceMode[];

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
    relatedIds: z.array(replayIdSchema).max(32).default([]),
  })
  .strict();

const proposedKeyframeSchema = z
  .object({
    id: replayIdSchema.optional(),
    timeMs: z.number().int().nonnegative().max(86_400_000),
    x: normalizedCoordinateSchema,
    y: normalizedCoordinateSchema,
    rotationDeg: z.number().min(-360).max(360),
  })
  .strict();

const proposalChangeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("actor-pose"),
      actorId: replayIdSchema,
      proposedPose: normalizedPositionSchema.extend({
        rotationDeg: z.number().min(-360).max(360),
      }),
    })
    .strict(),
  z
    .object({
      kind: z.literal("trajectory-set"),
      trajectoryId: replayIdSchema.optional(),
      actorId: replayIdSchema,
      branchId: replayIdSchema,
      keyframes: z.array(proposedKeyframeSchema).min(2).max(100),
      visible: z.boolean().default(true),
    })
    .strict(),
]);

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
      workspaceMode: z.enum(WORKSPACE_MODES).optional(),
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
          width: z.number().min(0.4).max(4),
          length: z.number().min(1.5).max(20),
        })
        .strict(),
      vehicleClass: z
        .enum(["compact-car", "saloon", "suv", "van", "pickup", "motorcycle", "unknown"])
        .optional(),
      dimensionsSource: z.enum(["template", "estimated", "unknown"]).optional(),
      wheelbaseMeters: z.number().min(0.8).max(12).optional(),
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

  propose_scene_changes: z
    .object({
      proposalId: replayIdSchema.optional(),
      title: shortTextSchema,
      rationale: descriptionSchema,
      changes: z.array(proposalChangeSchema).min(2).max(10),
      ...mutationMetadataShape,
    })
    .strict()
    .superRefine(({ changes }, context) => {
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
      eventId: replayIdSchema.optional(),
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
