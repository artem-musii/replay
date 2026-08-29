import { z } from "zod";

import {
  ActionAuthorSchema,
  ActionOriginSchema,
  ActorPoseSchema,
  ClaimSourceTypeSchema,
  ClaimStatusSchema,
  EnvironmentStateSchema,
  EvidenceAnnotationSchema,
  PointSchema,
  RotationDegreesSchema,
  SceneCoordinateSchema,
  SceneActorSchema,
  TimelineMillisecondsSchema,
  TimeRangeSchema,
  XmlSafeIdSchema,
  XmlSafeLongTextSchema,
  XmlSafeShortTextSchema,
  xmlSafeString,
} from "./schema";
import type { ConsistencyIssue } from "./models";

const id = XmlSafeIdSchema;
const shortText = XmlSafeShortTextSchema;
const longText = XmlSafeLongTextSchema;
const meta = {
  actor: ActionAuthorSchema,
  origin: ActionOriginSchema,
  requestId: id.optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
};

const createCommandSchema = <TType extends string, TShape extends z.ZodRawShape>(
  type: TType,
  shape: TShape,
) => z.object({ type: z.literal(type), ...meta, ...shape }).strict();

const KeyframeInputSchema = z
  .object({
    id: id.optional(),
    timeMs: TimelineMillisecondsSchema,
    x: SceneCoordinateSchema,
    y: SceneCoordinateSchema,
    rotationDeg: RotationDegreesSchema,
  })
  .strict();

const PoseAtTimeSchema = z
  .object({
    branchId: id,
    timeMs: TimelineMillisecondsSchema,
  })
  .strict();

export const CaseUpdateCommandSchema = createCommandSchema("case.update", {
  title: shortText.optional(),
  incidentDate: z.iso.date().nullable().optional(),
  approximateTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable()
    .optional(),
  sceneTemplateId: id.optional(),
  environment: EnvironmentStateSchema.optional(),
  timeRangeMs: TimeRangeSchema.optional(),
});

export const ActorUpsertCommandSchema = createCommandSchema("actor.upsert", {
  sceneActor: SceneActorSchema,
  poseAt: PoseAtTimeSchema.optional(),
});

export const ActorUpdatePoseCommandSchema = createCommandSchema("actor.update-pose", {
  actorId: id,
  pose: ActorPoseSchema,
  poseAt: PoseAtTimeSchema.optional(),
});

export const TrajectorySetCommandSchema = createCommandSchema("trajectory.set", {
  trajectoryId: id.optional(),
  actorId: id,
  branchId: id,
  keyframes: z.array(KeyframeInputSchema).min(1).max(2_000),
  visible: z.boolean().optional(),
});

const ProposalChangeInputSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("actor-pose"),
        actorId: id,
        branchId: id.optional(),
        targetTimeMs: TimelineMillisecondsSchema.optional(),
        proposedPose: ActorPoseSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("trajectory-set"),
        trajectoryId: id.optional(),
        actorId: id,
        branchId: id,
        keyframes: z.array(KeyframeInputSchema).min(1).max(2_000),
        visible: z.boolean().optional(),
      })
      .strict(),
  ])
  .superRefine((change, context) => {
    if (
      change.kind === "actor-pose" &&
      (change.branchId === undefined) !== (change.targetTimeMs === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "An actor pose proposal binding requires both branchId and targetTimeMs",
        path: change.branchId === undefined ? ["branchId"] : ["targetTimeMs"],
      });
    }
  });

export const ProposalCreateCommandSchema = createCommandSchema("proposal.create", {
  proposalId: id.optional(),
  title: shortText,
  rationale: longText,
  revisionSummary: shortText.optional(),
  poseAt: PoseAtTimeSchema,
  changes: z.array(ProposalChangeInputSchema).min(1).max(25),
});

export const ProposalAdjustCommandSchema = createCommandSchema("proposal.adjust", {
  proposalId: id,
  summary: shortText,
  poseAt: PoseAtTimeSchema,
  changes: z.array(ProposalChangeInputSchema).min(1).max(25),
});

export const ProposalAcceptCommandSchema = createCommandSchema("proposal.accept", {
  proposalId: id,
  poseAt: PoseAtTimeSchema,
  note: longText.optional(),
});

export const ProposalRejectCommandSchema = createCommandSchema("proposal.reject", {
  proposalId: id,
  note: longText.optional(),
});

export const TimelineUpsertCommandSchema = createCommandSchema("timeline.upsert", {
  eventId: id.optional(),
  branchId: id,
  timeMs: TimelineMillisecondsSchema,
  eventType: z.enum(["actor-start", "maneuver", "impact", "observation", "evidence", "actor-stop"]),
  title: shortText,
  certainty: ClaimStatusSchema,
  linkedActorIds: z.array(id).max(500),
  linkedClaimIds: z.array(id).max(500).optional(),
  linkedEvidenceIds: z.array(id).max(500).optional(),
  location: PointSchema.optional(),
});

export const DamageMarkCommandSchema = createCommandSchema("damage.mark", {
  actorId: id,
  markerId: id.optional(),
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
  linkedClaimIds: z.array(id).max(500).optional(),
  linkedEvidenceIds: z.array(id).max(500).optional(),
});

export const ClaimAddCommandSchema = createCommandSchema("claim.add", {
  claimId: id.optional(),
  statement: longText,
  subjectId: id.optional(),
  status: ClaimStatusSchema,
  sourceType: ClaimSourceTypeSchema,
  sourceIds: z.array(id).max(500).optional(),
  linkedEvidenceIds: z.array(id).max(500).optional(),
  linkedEventIds: z.array(id).max(500).optional(),
  linkedSceneObjectIds: z.array(id).max(500).optional(),
  branchId: id.optional(),
  sharedAcrossBranches: z.boolean().optional(),
});

export const ClaimUpdateCommandSchema = createCommandSchema("claim.update", {
  claimId: id,
  statement: longText.optional(),
  status: z
    .enum(["reported", "likely", "uncertain", "disputed", "unknown", "agent-hypothesis"])
    .optional(),
  sourceType: ClaimSourceTypeSchema.optional(),
  sourceIds: z.array(id).max(500).optional(),
  linkedEvidenceIds: z.array(id).max(500).optional(),
  linkedEventIds: z.array(id).max(500).optional(),
  linkedSceneObjectIds: z.array(id).max(500).optional(),
});

export const ClaimConfirmCommandSchema = createCommandSchema("claim.confirm", {
  claimId: id,
});

export const LockSetCommandSchema = createCommandSchema("lock.set", {
  targetType: z.enum(["actor", "trajectory", "timeline-event", "claim"]),
  targetId: id,
  locked: z.boolean(),
  reason: xmlSafeString(z.string().trim().max(1_000)).optional(),
});

export const EvidenceAddCommandSchema = createCommandSchema("evidence.add", {
  evidenceId: id.optional(),
  name: xmlSafeString(z.string().trim().min(1).max(255)),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024),
  localBlobKey: xmlSafeString(z.string().trim().min(1).max(500)),
  checksum: xmlSafeString(z.string().trim().min(8).max(256)),
  syntheticDemoAsset: z.boolean().optional(),
  source: z.enum(["demo", "local-upload", "import"]),
  capturedAt: z.iso.datetime({ offset: true }).optional(),
  notes: xmlSafeString(z.string().max(10_000)).optional(),
  tags: z
    .array(xmlSafeString(z.string().trim().min(1).max(100)))
    .max(100)
    .optional(),
  annotations: z.array(EvidenceAnnotationSchema).max(1_000).optional(),
});

export const EvidenceUpdateCommandSchema = createCommandSchema("evidence.update", {
  evidenceId: id,
  capturedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  notes: xmlSafeString(z.string().max(10_000)).nullable().optional(),
  tags: z
    .array(xmlSafeString(z.string().trim().min(1).max(100)))
    .max(100)
    .optional(),
  annotations: z.array(EvidenceAnnotationSchema).max(1_000).optional(),
});

export const EvidenceLinkCommandSchema = createCommandSchema("evidence.link", {
  evidenceId: id,
  annotationId: id.optional(),
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
});

export const EvidenceUnlinkCommandSchema = createCommandSchema("evidence.unlink", {
  evidenceId: id,
  annotationId: id.optional(),
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
});

export const EvidenceDeleteCommandSchema = createCommandSchema("evidence.delete", {
  evidenceId: id,
  confirmed: z.literal(true),
});

export const QuestionAddCommandSchema = createCommandSchema("question.add", {
  questionId: id.optional(),
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
    .max(5)
    .optional(),
  relatedClaimIds: z.array(id).max(500).optional(),
  relatedSceneObjectIds: z.array(id).max(500).optional(),
  relatedBranchIds: z.array(id).max(500).optional(),
});

export const QuestionUpdateCommandSchema = createCommandSchema("question.update", {
  questionId: id,
  status: z.enum(["open", "answered", "deferred", "dismissed"]),
  answer: xmlSafeString(z.string().trim().min(1).max(10_000)).optional(),
  answerSource: ClaimSourceTypeSchema.optional(),
  convertAnswerToObservation: z.boolean().optional(),
  observationClaimId: id.optional(),
});

export const HypothesisForkCommandSchema = createCommandSchema("hypothesis.fork", {
  parentBranchId: id,
  branchId: id.optional(),
  name: shortText,
  description: longText,
  assumptions: z
    .array(
      z
        .object({
          statement: longText,
          supportingEvidenceIds: z.array(id).max(500).optional(),
          conflictingEvidenceIds: z.array(id).max(500).optional(),
        })
        .strict(),
    )
    .max(32)
    .optional(),
});

export const HypothesisRenameCommandSchema = createCommandSchema("hypothesis.rename", {
  branchId: id,
  name: shortText,
  description: longText.optional(),
});

export const HypothesisAddAssumptionCommandSchema = createCommandSchema(
  "hypothesis.add-assumption",
  {
    branchId: id,
    assumptionId: id.optional(),
    statement: longText,
    supportingEvidenceIds: z.array(id).max(500).optional(),
    conflictingEvidenceIds: z.array(id).max(500).optional(),
  },
);

export const HypothesisUpdateAssumptionCommandSchema = createCommandSchema(
  "hypothesis.update-assumption",
  {
    branchId: id,
    assumptionId: id,
    statement: longText.optional(),
    status: z.enum(["active", "withdrawn"]).optional(),
    supportingEvidenceIds: z.array(id).max(500).optional(),
    conflictingEvidenceIds: z.array(id).max(500).optional(),
  },
);

export const HypothesisArchiveCommandSchema = createCommandSchema("hypothesis.archive", {
  branchId: id,
});

export const HypothesisRestoreCommandSchema = createCommandSchema("hypothesis.restore", {
  branchId: id,
});

export const HypothesisSetActiveCommandSchema = createCommandSchema("hypothesis.set-active", {
  branchId: id,
});

export const ReportAddNoteCommandSchema = createCommandSchema("report.add-note", {
  noteId: id.optional(),
  text: longText,
  claimIds: z.array(id).max(5_000),
  evidenceIds: z.array(id).max(5_000),
});

export const ReportReviewNoteCommandSchema = createCommandSchema("report.review-note", {
  noteId: id,
  approved: z.boolean(),
});

const CompletenessAttestationInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("no-evidence-supplied") }).strict(),
  z
    .object({
      kind: z.literal("actor-damage"),
      actorId: id,
      outcome: z.enum(["unknown", "not-assessed"]),
    })
    .strict(),
  z.object({ kind: z.literal("uncertainty-review-completed") }).strict(),
]);

export const CompletenessAttestCommandSchema = createCommandSchema("completeness.attest", {
  attestation: CompletenessAttestationInputSchema,
});

export const CompletenessWithdrawCommandSchema = createCommandSchema("completeness.withdraw", {
  attestationId: id,
});

export const ReportFinalizeCommandSchema = createCommandSchema("report.finalize", {
  unresolvedQuestionsReviewed: z.literal(true),
  limitationsAcknowledged: z.literal(true),
  confirmedFactsReviewed: z.literal(true),
  includedUnconfirmedContentReviewed: z.literal(true),
  manualConfirmation: z.literal(true),
  reviewedPreview: z
    .object({
      caseId: id,
      caseVersion: z.number().int().nonnegative(),
      generatedAt: z.iso.datetime({ offset: true }),
      fingerprint: z.string().regex(/^sha256-[a-f0-9]{64}$/),
      branchIds: z.array(id).max(1_000),
      includeHypotheses: z.boolean(),
    })
    .strict(),
});

export const CaseValidateCommandSchema = createCommandSchema("case.validate", {
  scope: z
    .enum([
      "all",
      "scene",
      "timeline",
      "geometry",
      "motion",
      "damage",
      "integrity",
      "provenance",
      "completeness",
      "report",
    ])
    .optional(),
});

export const HistoryUndoCommandSchema = createCommandSchema("history.undo", {});
export const HistoryRedoCommandSchema = createCommandSchema("history.redo", {});

export const ReplayMutationCommandSchema = z.discriminatedUnion("type", [
  CaseUpdateCommandSchema,
  ActorUpsertCommandSchema,
  ActorUpdatePoseCommandSchema,
  TrajectorySetCommandSchema,
  ProposalCreateCommandSchema,
  ProposalAdjustCommandSchema,
  ProposalAcceptCommandSchema,
  ProposalRejectCommandSchema,
  TimelineUpsertCommandSchema,
  DamageMarkCommandSchema,
  ClaimAddCommandSchema,
  ClaimUpdateCommandSchema,
  ClaimConfirmCommandSchema,
  LockSetCommandSchema,
  EvidenceAddCommandSchema,
  EvidenceUpdateCommandSchema,
  EvidenceLinkCommandSchema,
  EvidenceUnlinkCommandSchema,
  EvidenceDeleteCommandSchema,
  QuestionAddCommandSchema,
  QuestionUpdateCommandSchema,
  HypothesisForkCommandSchema,
  HypothesisRenameCommandSchema,
  HypothesisAddAssumptionCommandSchema,
  HypothesisUpdateAssumptionCommandSchema,
  HypothesisArchiveCommandSchema,
  HypothesisRestoreCommandSchema,
  HypothesisSetActiveCommandSchema,
  ReportAddNoteCommandSchema,
  ReportReviewNoteCommandSchema,
  CompletenessAttestCommandSchema,
  CompletenessWithdrawCommandSchema,
  ReportFinalizeCommandSchema,
  CaseValidateCommandSchema,
]);

export const ReplayCommandSchema = z
  .discriminatedUnion("type", [
    ...ReplayMutationCommandSchema.options,
    HistoryUndoCommandSchema,
    HistoryRedoCommandSchema,
  ])
  .superRefine((command, ctx) => {
    const trustedPair =
      (command.actor === "human" && command.origin === "ui") ||
      (command.actor === "agent" && command.origin === "webmcp") ||
      (command.actor === "system" && command.origin === "system");
    if (!trustedPair) {
      ctx.addIssue({
        code: "custom",
        path: ["origin"],
        message:
          "Command author and origin must be a trusted pair: human/ui, agent/webmcp, or system/system.",
      });
    }
  });

export type ReplayMutationCommand = z.infer<typeof ReplayMutationCommandSchema>;
export type ReplayCommand = z.infer<typeof ReplayCommandSchema>;

export type ReplayCommandErrorCode =
  | "INVALID_COMMAND"
  | "CANCELLED"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "NOT_FOUND"
  | "DUPLICATE_ID"
  | "DUPLICATE_EVIDENCE"
  | "LOCKED_ITEM"
  | "HUMAN_CONFIRMATION_REQUIRED"
  | "AGENT_FINALIZATION_FORBIDDEN"
  | "HUMAN_FINALIZATION_REQUIRED"
  | "FORBIDDEN_ACTION"
  | "INVALID_STATE"
  | "ARCHIVED_BRANCH"
  | "REPORT_REQUIREMENTS_MISSING"
  | "REPORT_PREVIEW_STALE"
  | "HISTORY_EMPTY"
  | "HISTORY_BARRIER"
  | "UNSAFE_REVERT";

export interface ReplayCommandError {
  code: ReplayCommandErrorCode;
  message: string;
  details?: Record<string, unknown>;
  lockedItem?: {
    id: string;
    type: string;
    lockedBy: "human" | "agent" | "system";
    reason?: string | undefined;
    allowedAlternatives: string[];
  };
}

export interface ReplayCommandSuccess {
  ok: true;
  caseVersion: number;
  activityId?: string;
  affectedIds: string[];
  issues: ConsistencyIssue[];
  message: string;
  idempotent: boolean;
}

export interface ReplayCommandFailure {
  ok: false;
  caseVersion: number;
  affectedIds: string[];
  issues: ConsistencyIssue[];
  message: string;
  error: ReplayCommandError;
}

export type ReplayCommandResult = ReplayCommandSuccess | ReplayCommandFailure;
