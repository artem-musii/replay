export const REPLAY_SCHEMA_VERSION = 2 as const;
export const REPLAY_SEED_VERSION = 3 as const;

export type ActorKind = "vehicle";

export type ClaimStatus =
  "confirmed" | "reported" | "likely" | "uncertain" | "disputed" | "unknown" | "agent-hypothesis";

export type ClaimSourceType =
  | "human-statement"
  | "witness-statement"
  | "photo"
  | "document"
  | "scene-observation"
  | "system-derived"
  | "agent-inference";

export type ActionAuthor = "human" | "agent" | "system";
export type ActionOrigin = "ui" | "webmcp" | "system";
export type DamageRegion =
  | "front"
  | "front-left"
  | "front-right"
  | "left-side"
  | "right-side"
  | "rear-left"
  | "rear-right"
  | "rear"
  | "unknown";

export type TimelineEventType =
  "actor-start" | "maneuver" | "impact" | "observation" | "evidence" | "actor-stop";

export type WorkspaceMode =
  "scene" | "timeline" | "facts" | "evidence" | "questions" | "hypotheses" | "report";

export type WorkspaceItemType =
  | "actor"
  | "trajectory"
  | "timeline-event"
  | "claim"
  | "evidence"
  | "question"
  | "hypothesis"
  | "report";

export interface Point {
  x: number;
  y: number;
}

export interface ActorPose extends Point {
  rotationDeg: number;
}

export interface ItemLock {
  lockedBy: ActionAuthor;
  lockedAt: string;
  reason?: string | undefined;
}

export interface ChangeRecord {
  id: string;
  caseVersion: number;
  author: ActionAuthor;
  origin: ActionOrigin;
  summary: string;
  createdAt: string;
  requestId?: string | undefined;
}

export interface EnvironmentState {
  sceneType: "roundabout" | "intersection";
  roadCondition: "wet" | "dry" | "unknown";
  weather: "clear" | "rain" | "overcast" | "unknown";
  lighting: "daylight" | "dusk" | "night" | "unknown";
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  roadPolygon: Point[];
}

export interface DamageMarker {
  id: string;
  actorId: string;
  region: DamageRegion;
  description: string;
  status: ClaimStatus;
  linkedClaimIds: string[];
  linkedEvidenceIds: string[];
  createdBy: ActionAuthor;
}

export interface SceneActor {
  id: string;
  label: string;
  kind: ActorKind;
  dimensions: {
    width: number;
    length: number;
  };
  colorToken: string;
  pose: ActorPose;
  locked: boolean;
  lock?: ItemLock | undefined;
  damageMarkers: DamageMarker[];
}

export interface ActorKeyframe extends ActorPose {
  id: string;
  actorId: string;
  timeMs: number;
}

export interface Trajectory {
  id: string;
  actorId: string;
  branchId: string;
  keyframes: ActorKeyframe[];
  visible: boolean;
  locked: boolean;
  lock?: ItemLock | undefined;
  createdBy: ActionAuthor;
  changeHistory: ChangeRecord[];
}

export interface TimelineEvent {
  id: string;
  branchId: string;
  timeMs: number;
  type: TimelineEventType;
  title: string;
  certainty: ClaimStatus;
  linkedActorIds: string[];
  linkedClaimIds: string[];
  linkedEvidenceIds: string[];
  location?: Point | undefined;
  locked: boolean;
  lock?: ItemLock | undefined;
  createdBy: ActionAuthor;
  changeHistory: ChangeRecord[];
}

export interface Claim {
  id: string;
  statement: string;
  subjectId?: string | undefined;
  status: ClaimStatus;
  sourceType: ClaimSourceType;
  sourceIds: string[];
  linkedEvidenceIds: string[];
  linkedEventIds: string[];
  linkedSceneObjectIds: string[];
  branchId?: string | undefined;
  sharedAcrossBranches: boolean;
  createdBy: ActionAuthor;
  humanConfirmed: boolean;
  confirmedAt?: string | undefined;
  locked: boolean;
  lock?: ItemLock | undefined;
  createdAt: string;
  updatedAt: string;
  changeHistory: ChangeRecord[];
}

export type EvidenceAnnotation =
  | {
      id: string;
      kind: "point";
      x: number;
      y: number;
      label?: string | undefined;
    }
  | {
      id: string;
      kind: "rectangle";
      x: number;
      y: number;
      width: number;
      height: number;
      label?: string | undefined;
    };

export interface EvidenceAnnotationLink {
  annotationId: string;
  targetType:
    "claim" | "timeline-event" | "actor" | "trajectory" | "damage" | "hypothesis" | "assumption";
  targetId: string;
}

export interface EvidenceAsset {
  id: string;
  name: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  sizeBytes: number;
  localBlobKey: string;
  checksum: string;
  syntheticDemoAsset: boolean;
  source: "demo" | "local-upload" | "import";
  capturedAt?: string | undefined;
  createdAt: string;
  notes?: string | undefined;
  tags: string[];
  annotations: EvidenceAnnotation[];
  annotationLinks: EvidenceAnnotationLink[];
  linkedClaimIds: string[];
  linkedEventIds: string[];
  linkedSceneObjectIds: string[];
  linkedBranchIds: string[];
  deleted: boolean;
  deletedAt?: string | undefined;
}

export interface HypothesisAssumption {
  id: string;
  statement: string;
  status: "active" | "withdrawn";
  supportingEvidenceIds: string[];
  conflictingEvidenceIds: string[];
  createdBy: ActionAuthor;
  createdAt: string;
  updatedAt: string;
}

export interface HypothesisBranch {
  id: string;
  name: string;
  description: string;
  parentBranchId?: string | undefined;
  sharedClaimIds: string[];
  assumptions: HypothesisAssumption[];
  trajectoryIds: string[];
  eventIds: string[];
  claimIds: string[];
  status: "active" | "archived";
  createdBy: ActionAuthor;
  createdAt: string;
  updatedAt: string;
  changeHistory: ChangeRecord[];
}

export interface OpenQuestion {
  id: string;
  question: string;
  reason: string;
  importance: "blocking" | "high" | "medium" | "low";
  rankingReasons: (
    | "blocks-report"
    | "resolves-contradiction"
    | "distinguishes-hypotheses"
    | "required-field"
    | "contextual-detail"
  )[];
  relatedClaimIds: string[];
  relatedSceneObjectIds: string[];
  relatedBranchIds: string[];
  status: "open" | "answered" | "deferred" | "dismissed";
  answer?: string | undefined;
  answerSource?: ClaimSourceType | undefined;
  createdBy: ActionAuthor;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityEvent {
  id: string;
  caseVersion: number;
  author: ActionAuthor;
  origin: ActionOrigin;
  actionType: string;
  classification?: "human-override" | undefined;
  overridesActivityId?: string | undefined;
  summary: string;
  affectedIds: string[];
  requestId?: string | undefined;
  requestIntentFingerprint?: string | undefined;
  undoable: boolean;
  createdAt: string;
}

export interface AgentProposalActorPoseChange {
  id: string;
  kind: "actor-pose";
  actorId: string;
  basePose: ActorPose;
  proposedPose: ActorPose;
}

export interface AgentProposalTrajectoryChange {
  id: string;
  kind: "trajectory-set";
  actorId: string;
  branchId: string;
  trajectoryId: string;
  createsTrajectory: boolean;
  baseActorPose: ActorPose;
  baseTrajectory?:
    | {
        keyframes: ActorKeyframe[];
        visible: boolean;
      }
    | undefined;
  proposedTrajectory: {
    keyframes: ActorKeyframe[];
    visible: boolean;
  };
}

export type AgentProposalChange = AgentProposalActorPoseChange | AgentProposalTrajectoryChange;

export interface AgentProposalRevision {
  id: string;
  revisionNumber: number;
  summary: string;
  createdBy: "agent" | "human";
  origin: "webmcp" | "ui";
  /** False after an unsigned import until the history is reviewed locally. */
  authorshipTrusted: boolean;
  createdAt: string;
  changes: AgentProposalChange[];
}

export interface AgentProposalDecision {
  outcome: "accepted" | "rejected";
  revisionId: string;
  decidedBy: "human";
  origin: "ui";
  decidedAt: string;
  note?: string | undefined;
  /** Unsigned imports preserve the decision as history without treating it as a local attestation. */
  humanAttestationTrusted: boolean;
}

export interface AgentProposal {
  id: string;
  title: string;
  rationale: string;
  status: "pending" | "accepted" | "rejected";
  createdBy: "agent";
  origin: "webmcp";
  createdAt: string;
  updatedAt: string;
  revisions: AgentProposalRevision[];
  decision?: AgentProposalDecision | undefined;
}

export type ConsistencyScope =
  "timeline" | "geometry" | "damage" | "provenance" | "completeness" | "report";

export interface ConsistencyIssue {
  [key: string]: unknown;
  id: string;
  ruleId: string;
  scope: ConsistencyScope;
  severity: "error" | "warning" | "question";
  title: string;
  explanation: string;
  affectedIds: string[];
  suggestedActions: string[];
}

export interface ReportCitation {
  claimIds: string[];
  evidenceIds: string[];
  workspacePaths: string[];
}

export interface ReportStatement {
  id: string;
  text: string;
  certainty: "confirmed" | "reported" | "uncertain" | "hypothesis" | "system";
  citations: ReportCitation;
}

export interface ReportSection {
  id: string;
  title: string;
  statements: ReportStatement[];
}

export interface ReportPreview {
  caseId: string;
  caseVersion: number;
  generatedAt: string;
  title: string;
  sections: ReportSection[];
  includedClaimIds: string[];
  includedEvidenceIds: string[];
  unresolvedQuestionIds: string[];
  missingRequirements: string[];
  disclaimer: string;
}

export interface ReportSnapshot {
  id: string;
  caseVersion: number;
  createdAt: string;
  confirmedClaimIds: string[];
  includedEvidenceIds: string[];
  unresolvedQuestionIds: string[];
  branchIds: string[];
  humanAcknowledged: true;
  immutable: true;
  preview: ReportPreview;
}

export interface ReportNote {
  id: string;
  text: string;
  claimIds: string[];
  evidenceIds: string[];
  createdBy: ActionAuthor;
  reviewedByHuman: boolean;
  createdAt: string;
}

export interface WorkspaceSelection {
  type: WorkspaceItemType;
  id: string;
}

export interface ReplayCase {
  schemaVersion: typeof REPLAY_SCHEMA_VERSION;
  seedVersion?: number | undefined;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  caseVersion: number;
  incidentDate?: string | undefined;
  approximateTime?: string | undefined;
  sceneTemplateId: string;
  environment: EnvironmentState;
  timeRangeMs: { start: number; end: number };
  actors: SceneActor[];
  trajectories: Trajectory[];
  timelineEvents: TimelineEvent[];
  branches: HypothesisBranch[];
  activeBranchId: string;
  claims: Claim[];
  evidence: EvidenceAsset[];
  questions: OpenQuestion[];
  proposals: AgentProposal[];
  activity: ActivityEvent[];
  consistencyIssues: ConsistencyIssue[];
  reportNotes: ReportNote[];
  reportSnapshots: ReportSnapshot[];
  selectedItem?: WorkspaceSelection | undefined;
  workspaceMode: WorkspaceMode;
}

export interface HypothesisComparison {
  branchIds: [string, string];
  changedTrajectoryActorIds: string[];
  changedEventIds: string[];
  assumptions: Record<string, HypothesisAssumption[]>;
  supportingEvidenceIds: Record<string, string[]>;
  conflictingEvidenceIds: Record<string, string[]>;
  unresolvedQuestionIds: Record<string, string[]>;
  issues: Record<string, ConsistencyIssue[]>;
  summaries: Record<string, string>;
}
