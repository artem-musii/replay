import {
  AlertTriangle,
  Archive,
  Camera,
  CarFront,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Eye,
  FileImage,
  FileJson,
  FileText,
  GitCompareArrows,
  GitFork,
  Image as ImageIcon,
  Link2,
  LockKeyhole,
  MessageSquareText,
  Play,
  Plus,
  RotateCw,
  RotateCcw,
  Route,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unlock,
  Upload,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { compareHypotheses } from "../domain/hypotheses";
import { compatibleAgentObservationSourceIds } from "../domain/claimProvenance";
import { getActorPoseAtTime, normalizeDegrees } from "../domain/interpolation";
import {
  findCompletenessAttestation,
  isCompletenessAttestationCurrent,
} from "../domain/completeness";
import { validateCurrentReportPreview } from "../domain/consistency";
import {
  analyzeImpactAdjacentPaths,
  analyzeTrajectoryMotion,
  createSceneMetricCalibration,
} from "../domain/physics";
import {
  diffProposalTrajectory,
  resolveProposalReviewRequest,
  type ProposalKeyframeDelta,
  type ProposalReviewRequest,
  type ProposalReviewTarget,
} from "../domain/proposalReview";
import { rankOpenQuestions } from "../domain/reducer";
import { reportPreviewHasValidReviewBinding } from "../domain/report";
import { isSharedGitHubPagesHostname } from "../privacy/sharedOrigin";
import {
  getAcceptedProposalGeometryTrust,
  getProposalDecisionTrust,
} from "../domain/proposalProvenance";
import type {
  Claim,
  ClaimStatus,
  CompletenessAttestationInput,
  ConsistencyIssue,
  EvidenceAnnotation,
  EvidenceAnnotationLink,
  EvidenceAsset,
  HypothesisBranch,
  OpenQuestion,
  ActorPose,
  MeasurementSource,
  ReplayCase,
  ReportPreview,
  ReportSnapshot,
  ReportStatement,
  VehicleClass,
  WorkspaceItemType,
  WorkspaceMode,
} from "../domain/models";
import { resolveEvidenceImageSource } from "./evidenceSource";
import { evidenceCurrentLinks } from "./evidenceRelationships";
import { isoDateTimeToLocalInput } from "./localDateTime";
import { proposalAdjustmentFromForm, type ProposalAdjustmentChange } from "./proposalAdjustment";
import { useDialogFocus } from "./useDialogFocus";
import {
  REPLAY_MAX_ROTATION_DEGREES,
  REPLAY_MAX_SCENE_COORDINATE,
  REPLAY_MAX_TIMELINE_MS,
} from "../domain/schema";

export type InspectorTab = Extract<
  WorkspaceMode,
  "facts" | "evidence" | "questions" | "hypotheses" | "report"
>;

export interface EvidenceUploadInput {
  file: File;
  notes?: string;
  capturedAt?: string;
}

type EvidenceLinkTargetType = EvidenceAnnotationLink["targetType"];

interface InspectorPanelProps {
  replayCase: ReplayCase;
  currentTimeMs: number;
  activeTab: InspectorTab;
  selectedId?: string;
  reportPreview?: ReportPreview;
  selectedReportSnapshotId?: string;
  evidenceUrls?: Record<string, string>;
  compareBranchIds: string[];
  focusedIssueId?: string;
  proposalReviewTarget?: ProposalReviewTarget;
  onEditStart: () => void;
  onTabChange: (tab: InspectorTab) => void;
  onSelect: (type: WorkspaceItemType, id: string) => void;
  onAddClaim: (
    statement: string,
    status: Exclude<ClaimStatus, "confirmed">,
    sourceType: Claim["sourceType"],
    sourceIds: string[],
  ) => boolean;
  onUpdateClaim: (
    claimId: string,
    update: {
      statement?: string;
      sourceType?: Claim["sourceType"];
      sourceIds?: string[];
      linkedEvidenceIds?: string[];
    },
  ) => boolean;
  onConfirmClaim: (claimId: string) => void;
  onSetClaimStatus: (claimId: string, status: Exclude<ClaimStatus, "confirmed">) => void;
  onToggleLock: (type: "claim", id: string, locked: boolean) => void;
  onUpdateActorPose: (actorId: string, pose: ActorPose) => void;
  onUpdateActorSpecs: (
    actorId: string,
    update: {
      dimensions: { length: number; width: number };
      vehicleClass: VehicleClass;
      dimensionsSource: MeasurementSource;
      wheelbaseMeters?: number;
    },
  ) => void;
  onUpdateTrajectoryKeyframe: (
    trajectoryId: string,
    keyframeId: string,
    update: ActorPose & { timeMs: number },
  ) => void;
  onAddTrajectoryKeyframe: (trajectoryId: string) => void;
  onRemoveTrajectoryKeyframe: (trajectoryId: string, keyframeId: string) => void;
  selectedKeyframeId?: string;
  onSelectTrajectoryKeyframe: (trajectoryId: string, keyframeId: string) => void;
  onSetTrajectoryVisible: (trajectoryId: string, visible: boolean) => void;
  onUpdateTimelineEvent: (
    eventId: string,
    update: {
      timeMs: number;
      certainty: Exclude<ClaimStatus, "confirmed" | "agent-hypothesis">;
      location?: { x: number; y: number };
    },
  ) => void;
  onReplayImpact: (eventId: string) => void;
  onToggleSceneItemLock: (
    type: "actor" | "trajectory" | "timeline-event",
    id: string,
    locked: boolean,
  ) => void;
  onAdjustProposal: (
    proposalId: string,
    summary: string,
    changes: ProposalAdjustmentChange[],
  ) => boolean;
  onAcceptProposal: (proposalId: string) => boolean;
  onRejectProposal: (proposalId: string) => boolean;
  onReviewProposalAtTime: (target: ProposalReviewTarget) => boolean;
  onUploadEvidence: (input: EvidenceUploadInput) => void;
  onDeleteEvidence: (evidenceId: string) => void | Promise<void>;
  onUpdateEvidence: (
    evidenceId: string,
    update: {
      capturedAt?: string | null;
      notes?: string | null;
      tags?: string[];
      annotations?: EvidenceAnnotation[];
    },
  ) => boolean;
  onLinkEvidence: (
    evidenceId: string,
    targetType: EvidenceLinkTargetType,
    targetId: string,
    annotationId?: string,
  ) => boolean;
  onUnlinkEvidence: (
    evidenceId: string,
    targetType: EvidenceLinkTargetType,
    targetId: string,
    annotationId?: string,
  ) => boolean;
  onAddQuestion: (
    question: string,
    reason: string,
    importance: OpenQuestion["importance"],
  ) => boolean;
  onUpdateQuestion: (
    questionId: string,
    status: OpenQuestion["status"],
    answer?: string,
    convert?: boolean,
  ) => boolean;
  onForkBranch: (parentId: string, name: string, description: string) => boolean;
  onSetActiveBranch: (branchId: string) => void;
  onRenameBranch: (branchId: string, name: string, description: string) => boolean;
  onAddAssumption: (branchId: string, statement: string) => boolean;
  onUpdateAssumption: (
    branchId: string,
    assumptionId: string,
    update: { statement?: string; status?: "active" | "withdrawn" },
  ) => boolean;
  onToggleBranchArchive: (branch: HypothesisBranch) => void;
  onCompareBranches: (ids: string[]) => void;
  onValidate: () => void;
  onFocusIssue: (issue: ConsistencyIssue) => void;
  onAttestCompleteness: (attestation: CompletenessAttestationInput) => boolean;
  onWithdrawCompleteness: (attestationId: string) => boolean;
  onBuildReport: () => void;
  onOpenReportSnapshot: (snapshotId: string) => void;
  onExportReportSnapshot: (snapshotId: string) => void;
  onAddReportNote: (text: string, claimIds: string[], evidenceIds: string[]) => boolean;
  onReviewReportNote: (noteId: string, approved: boolean) => void;
  onFinalizeReport: (reviewedPreview: ReportPreview) => boolean;
  onExportJson: () => void;
  onExportPdf: () => void;
  onExportScene: (format: "svg" | "png") => void;
  exportInFlight?: "pdf" | "scene";
}

const tabs: Array<{ id: InspectorTab; label: string; Icon: typeof FileText }> = [
  { id: "facts", label: "Facts", Icon: SearchCheck },
  { id: "evidence", label: "Evidence", Icon: Camera },
  { id: "questions", label: "Questions", Icon: CircleHelp },
  { id: "hypotheses", label: "Hypotheses", Icon: GitFork },
  { id: "report", label: "Report", Icon: FileText },
];

const REPORT_NOTE_MAX_LENGTH = 10_000;

const statusLabels: Record<ClaimStatus, string> = {
  confirmed: "Confirmed by human",
  reported: "Reported",
  likely: "Likely, not confirmed",
  uncertain: "Uncertain",
  disputed: "Disputed",
  unknown: "Unknown",
  "agent-hypothesis": "Agent hypothesis",
};

function formatSeconds(timeMs: number): string {
  const normalizedTimeMs = Math.round(timeMs);
  const fractionDigits = normalizedTimeMs % 100 === 0 ? 1 : 3;
  return `${(normalizedTimeMs / 1000).toFixed(fractionDigits)}s`;
}

function formatExactSeconds(timeMs: number): string {
  return `${(Math.round(timeMs) / 1000).toFixed(3)} s`;
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

function StatusGlyph({ status }: { status: ClaimStatus }) {
  if (status === "confirmed") return <Check size={12} strokeWidth={3} />;
  if (status === "disputed") return <X size={12} strokeWidth={3} />;
  if (status === "unknown") return <CircleHelp size={12} />;
  if (status === "agent-hypothesis") return <Sparkles size={12} />;
  return <span aria-hidden="true">•</span>;
}

function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof FileText;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="inspector-empty">
      <Icon size={23} />
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}

export function InspectorPanel(props: InspectorPanelProps) {
  const openQuestionCount = props.replayCase.questions.filter(
    (item) => item.status === "open",
  ).length;

  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
      return;
    event.preventDefault();
    const currentIndex = tabs.findIndex((tab) => tab.id === props.activeTab);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : event.key === "ArrowLeft" || event.key === "ArrowUp"
            ? (currentIndex - 1 + tabs.length) % tabs.length
            : (currentIndex + 1) % tabs.length;
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;
    props.onTabChange(nextTab.id);
    event.currentTarget
      .querySelector<HTMLButtonElement>(`[data-inspector-tab="${nextTab.id}"]`)
      ?.focus();
  }

  return (
    <aside
      className="inspector-panel"
      aria-label="Case inspector"
      data-onboarding-id="case-inspector"
    >
      <div
        className="inspector-tabs"
        role="tablist"
        aria-label="Case workspaces"
        onKeyDown={handleTabKeyDown}
      >
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            id={`inspector-tab-${id}`}
            type="button"
            role="tab"
            data-inspector-tab={id}
            className={props.activeTab === id ? "inspector-tab is-active" : "inspector-tab"}
            onClick={() => props.onTabChange(id)}
            aria-current={props.activeTab === id ? "page" : undefined}
            aria-selected={props.activeTab === id}
            aria-controls="inspector-active-panel"
            tabIndex={props.activeTab === id ? 0 : -1}
            title={label}
          >
            <Icon size={16} />
            <span>{label}</span>
            {id === "questions" && openQuestionCount > 0 && (
              <em>
                {openQuestionCount}
                <span className="visually-hidden">
                  {` open ${openQuestionCount === 1 ? "question" : "questions"}`}
                </span>
              </em>
            )}
          </button>
        ))}
      </div>
      <div
        className="inspector-content"
        id="inspector-active-panel"
        role="tabpanel"
        aria-labelledby={`inspector-tab-${props.activeTab}`}
        tabIndex={0}
      >
        <ProposalReviewPanel {...props} />
        <SceneSelectionEditor {...props} />
        {props.activeTab === "facts" && <FactsView {...props} />}
        {props.activeTab === "evidence" && <EvidenceView {...props} />}
        {props.activeTab === "questions" && <QuestionsView {...props} />}
        {props.activeTab === "hypotheses" && <HypothesesView {...props} />}
        {props.activeTab === "report" && <ReportView {...props} />}
      </div>
    </aside>
  );
}

function requiredNumber(form: FormData, name: string): number {
  const raw = form.get(name);
  const value = typeof raw === "string" && raw.trim().length > 0 ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number.`);
  return value;
}

const eventCertainties = ["reported", "likely", "uncertain", "disputed", "unknown"] as const;

function requiredEventCertainty(form: FormData): (typeof eventCertainties)[number] {
  const value = form.get("certainty");
  if (typeof value !== "string" || !eventCertainties.some((candidate) => candidate === value)) {
    throw new Error("Choose a valid event certainty.");
  }
  return value as (typeof eventCertainties)[number];
}

function editableNumber(value: number, maximumFractionDigits = 3): number {
  return Number(value.toFixed(maximumFractionDigits));
}

function formatSignedDelta(value: number, unit: "m" | "°"): string {
  if (value === 0 || Object.is(value, -0)) return unit === "°" ? "0.0 °" : "0.00 m";
  const absolute = Math.abs(value);
  if (unit === "m" && absolute < 0.00001) return `${value < 0 ? "−" : "+"}<0.00001 m`;
  if (unit === "°" && absolute < 0.001) return `${value < 0 ? "−" : "+"}<0.001 °`;
  const maximumFractionDigits = unit === "°" ? 2 : absolute < 0.01 ? 5 : 3;
  const fixed = absolute.toFixed(maximumFractionDigits);
  const [integer = "0", fraction = ""] = fixed.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "").padEnd(unit === "°" ? 1 : 2, "0");
  const amount = trimmedFraction ? `${integer}.${trimmedFraction}` : integer;
  return `${value < 0 ? "−" : "+"}${amount} ${unit}`;
}

function proposalDeltaDescription(delta: ProposalKeyframeDelta): string {
  if (delta.kind === "added") {
    return `Point added · X ${editableNumber(delta.proposedXMeters ?? 0, 3)} m · Y ${editableNumber(delta.proposedYMeters ?? 0, 3)} m · rotation ${editableNumber(delta.proposedKeyframe?.rotationDeg ?? 0, 2)}°`;
  }
  if (delta.kind === "removed") {
    return `Point removed · X ${editableNumber(delta.baseXMeters ?? 0, 3)} m · Y ${editableNumber(delta.baseYMeters ?? 0, 3)} m · rotation ${editableNumber(delta.baseKeyframe?.rotationDeg ?? 0, 2)}°`;
  }
  const details: string[] = [];
  if (
    delta.baseKeyframe &&
    delta.proposedKeyframe &&
    delta.baseKeyframe.timeMs !== delta.proposedKeyframe.timeMs
  ) {
    details.push(`moved from ${formatSeconds(delta.baseKeyframe.timeMs)}`);
  }
  details.push(`ΔX ${formatSignedDelta(delta.deltaXMeters ?? 0, "m")}`);
  details.push(`ΔY ${formatSignedDelta(delta.deltaYMeters ?? 0, "m")}`);
  details.push(`Δ rotation ${formatSignedDelta(delta.deltaRotationDeg ?? 0, "°")}`);
  return details.join(" · ");
}

function ProposalDeltaReviewButton({
  actorLabel,
  delta,
  onReview,
  reviewActive,
  target,
}: {
  actorLabel: string;
  delta: ProposalKeyframeDelta;
  onReview: (target: ProposalReviewRequest) => void;
  reviewActive: boolean;
  target: ProposalReviewRequest;
}) {
  const description = proposalDeltaDescription(delta);
  const reviewTime = formatExactSeconds(delta.reviewTimeMs);
  return (
    <button
      type="button"
      className={`proposal-delta-button${reviewActive ? " is-current" : ""}`}
      onClick={() => onReview(target)}
      aria-label={`Review ${actorLabel} proposal at ${reviewTime}. ${description}`}
      aria-current={reviewActive ? "time" : undefined}
    >
      <Clock3 size={14} aria-hidden="true" />
      <span>
        <strong>{reviewTime}</strong>
        <small>{description}</small>
      </span>
      <em>{reviewActive ? "Reviewing" : "Review in scene"}</em>
    </button>
  );
}

function ProposalTargetDisclosure({
  actorLabel,
  detailsId,
  expanded,
  onToggle,
  stateClassName,
  stateLabel,
  summary,
}: {
  actorLabel: string;
  detailsId: string;
  expanded: boolean;
  onToggle: () => void;
  stateClassName?: string;
  stateLabel: string;
  summary: string;
}) {
  const toggleId = `${detailsId}-toggle`;
  return (
    <li className={`proposal-target${expanded ? " is-expanded" : ""}`}>
      <button
        type="button"
        id={toggleId}
        className="proposal-target__toggle"
        aria-controls={detailsId}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Hide" : "Show"} ${actorLabel} proposal details. ${summary}. ${stateLabel}.`}
        onClick={onToggle}
      >
        <span>
          <strong>{actorLabel}</strong>
          <small>{summary}</small>
        </span>
        <em className={stateClassName}>{stateLabel}</em>
        <ChevronRight size={15} aria-hidden="true" />
      </button>
    </li>
  );
}

function ProposalTargetDetails({
  change,
  currentTimeMs,
  detailsId,
  onReview,
  proposalId,
  proposalReviewTarget,
  replayCase,
  revisionId,
}: {
  change: ReplayCase["proposals"][number]["revisions"][number]["changes"][number];
  currentTimeMs: number;
  detailsId: string;
  onReview: (request: ProposalReviewRequest, actorLabel: string) => void;
  proposalId: string;
  proposalReviewTarget?: ProposalReviewTarget;
  replayCase: ReplayCase;
  revisionId: string;
}) {
  const actor = replayCase.actors.find((candidate) => candidate.id === change.actorId);
  const actorLabel = actor?.label ?? change.actorId;
  const branch = change.branchId
    ? replayCase.branches.find((candidate) => candidate.id === change.branchId)
    : undefined;
  const branchLabel = change.branchId
    ? (branch?.name ?? change.branchId)
    : "Legacy proposal without a bound hypothesis";
  const targetMatchesChange =
    proposalReviewTarget?.proposalId === proposalId &&
    proposalReviewTarget.revisionId === revisionId &&
    proposalReviewTarget.changeId === change.id &&
    proposalReviewTarget.branchId === change.branchId;

  if (change.kind === "actor-pose") {
    const reviewRequest =
      change.targetTimeMs !== undefined && change.branchId
        ? {
            proposalId,
            revisionId,
            changeId: change.id,
            branchId: change.branchId,
            proposalTimeMs: change.targetTimeMs,
          }
        : undefined;
    const reviewActive = targetMatchesChange && currentTimeMs === proposalReviewTarget.reviewTimeMs;
    return (
      <div
        className="proposal-target__details"
        id={detailsId}
        role="region"
        aria-labelledby={`${detailsId}-toggle`}
      >
        <small className="proposal-branch-note">Hypothesis · {branchLabel}</small>
        {reviewRequest && (
          <button
            type="button"
            className={`proposal-review-time-button${reviewActive ? " is-current" : ""}`}
            aria-current={reviewActive ? "time" : undefined}
            onClick={() => onReview(reviewRequest, actorLabel)}
          >
            <Eye size={13} aria-hidden="true" /> Review at{" "}
            {formatExactSeconds(reviewRequest.proposalTimeMs)}
          </button>
        )}
      </div>
    );
  }

  const trajectoryDiff = diffProposalTrajectory(change, replayCase.environment);
  const shownDeltas = trajectoryDiff.keyframeDeltas.slice(0, 2);
  const additionalDeltas = trajectoryDiff.keyframeDeltas.slice(2);
  return (
    <div
      className="proposal-target__details"
      id={detailsId}
      role="region"
      aria-labelledby={`${detailsId}-toggle`}
    >
      <small className="proposal-branch-note">Hypothesis · {branchLabel}</small>
      {trajectoryDiff.keyframeDeltas.length > 0 && (
        <small className="proposal-calibration-note">
          Calibrated deltas · {replayCase.environment.calibration.source.replaceAll("-", " ")} ·
          declared scene uncertainty ±
          {editableNumber(replayCase.environment.calibration.uncertaintyMeters, 2)} m
        </small>
      )}
      {shownDeltas.length > 0 && (
        <div className="proposal-delta-list" aria-label={`${actorLabel} changed path points`}>
          {shownDeltas.map((delta) => (
            <ProposalDeltaReviewButton
              key={`${change.id}-${delta.keyframeId}`}
              actorLabel={actorLabel}
              delta={delta}
              onReview={(target) => onReview(target, actorLabel)}
              reviewActive={
                targetMatchesChange &&
                proposalReviewTarget.keyframeId === delta.keyframeId &&
                currentTimeMs === proposalReviewTarget.reviewTimeMs
              }
              target={{
                proposalId,
                revisionId,
                changeId: change.id,
                branchId: change.branchId,
                keyframeId: delta.keyframeId,
                proposalTimeMs: delta.reviewTimeMs,
              }}
            />
          ))}
          {additionalDeltas.length > 0 && (
            <details>
              <summary>
                Show {additionalDeltas.length} more changed point
                {additionalDeltas.length === 1 ? "" : "s"}
              </summary>
              <div>
                {additionalDeltas.map((delta) => (
                  <ProposalDeltaReviewButton
                    key={`${change.id}-${delta.keyframeId}`}
                    actorLabel={actorLabel}
                    delta={delta}
                    onReview={(target) => onReview(target, actorLabel)}
                    reviewActive={
                      targetMatchesChange &&
                      proposalReviewTarget.keyframeId === delta.keyframeId &&
                      currentTimeMs === proposalReviewTarget.reviewTimeMs
                    }
                    target={{
                      proposalId,
                      revisionId,
                      changeId: change.id,
                      branchId: change.branchId,
                      keyframeId: delta.keyframeId,
                      proposalTimeMs: delta.reviewTimeMs,
                    }}
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

interface WorkspaceRelation {
  id: string;
  targetId?: string;
  label: string;
  type?: WorkspaceItemType;
}

function workspaceRelation(replayCase: ReplayCase, id: string): WorkspaceRelation {
  const actor = replayCase.actors.find((candidate) => candidate.id === id);
  if (actor) return { id, label: `Vehicle · ${actor.label}`, type: "actor" };

  const trajectory = replayCase.trajectories.find((candidate) => candidate.id === id);
  if (trajectory) {
    const owner = replayCase.actors.find((candidate) => candidate.id === trajectory.actorId);
    return {
      id,
      label: `Path · ${owner?.label ?? trajectory.actorId}`,
      type: "trajectory",
    };
  }

  const timelineEvent = replayCase.timelineEvents.find((candidate) => candidate.id === id);
  if (timelineEvent) {
    return {
      id,
      label: `Event · ${timelineEvent.title}`,
      type: "timeline-event",
    };
  }

  const claim = replayCase.claims.find((candidate) => candidate.id === id);
  if (claim) return { id, label: `Observation · ${claim.statement}`, type: "claim" };

  const evidence = replayCase.evidence.find(
    (candidate) => candidate.id === id && !candidate.deleted,
  );
  if (evidence) return { id, label: `Evidence · ${evidence.name}`, type: "evidence" };

  const question = replayCase.questions.find((candidate) => candidate.id === id);
  if (question) return { id, label: `Question · ${question.question}`, type: "question" };

  const branch = replayCase.branches.find((candidate) => candidate.id === id);
  if (branch) return { id, label: `Hypothesis · ${branch.name}`, type: "hypothesis" };

  for (const owner of replayCase.actors) {
    const marker = owner.damageMarkers.find((candidate) => candidate.id === id);
    if (marker) {
      return {
        id,
        targetId: owner.id,
        label: `Damage · ${owner.label} · ${marker.region.replaceAll("-", " ")}`,
        type: "actor",
      };
    }
  }

  return { id, label: id };
}

function RelationLinks({
  label,
  ids,
  replayCase,
  onSelect,
}: {
  label: string;
  ids: readonly string[];
  replayCase: ReplayCase;
  onSelect: InspectorPanelProps["onSelect"];
}) {
  const relations = [...new Set(ids)].map((id) => workspaceRelation(replayCase, id));
  if (relations.length === 0) return null;
  return (
    <div className="relation-group">
      <strong>{label}</strong>
      <div>
        {relations.map((relation) => {
          const relationType = relation.type;
          return relationType ? (
            <button
              key={relation.id}
              type="button"
              onClick={() => onSelect(relationType, relation.targetId ?? relation.id)}
              title={relation.label}
            >
              <Link2 size={12} aria-hidden="true" />
              <span>{relation.label}</span>
            </button>
          ) : (
            <span className="relation-chip" key={relation.id} title={relation.label}>
              <Link2 size={12} aria-hidden="true" />
              <span>{relation.label}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ProposalReviewPanel(props: InspectorPanelProps) {
  const pending = props.replayCase.proposals.filter((proposal) => proposal.status === "pending");
  const resolved = props.replayCase.proposals
    .filter((proposal) => proposal.status !== "pending")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const reviewRef = useRef<HTMLElement>(null);
  const firstPendingActionsRef = useRef<HTMLElement>(null);
  const historyRef = useRef<HTMLDetailsElement>(null);
  const decisionFocusFrameRef = useRef<number | undefined>(undefined);
  const previousPendingKeyRef = useRef("");
  const pendingKey = pending
    .map((proposal) => `${proposal.id}:${proposal.revisions.at(-1)?.id ?? "missing"}`)
    .join("|");
  const [decision, setDecision] = useState<{
    proposalId: string;
    outcome: "accepted" | "rejected";
  }>();
  const [dirtyProposalIds, setDirtyProposalIds] = useState<ReadonlySet<string>>(() => new Set());
  const [expandedTargetByProposal, setExpandedTargetByProposal] = useState<
    Readonly<Record<string, string>>
  >({});
  const [reviewAnnouncement, setReviewAnnouncement] = useState("");
  const [reviewFeedback, setReviewFeedback] = useState("");
  const firstPendingDirty = pending[0] ? dirtyProposalIds.has(pending[0].id) : false;

  useEffect(() => {
    if (!pendingKey || previousPendingKeyRef.current === pendingKey) return;
    previousPendingKeyRef.current = pendingKey;
    const frame = window.requestAnimationFrame(() => {
      reviewRef.current?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingKey]);

  useEffect(() => {
    if (!firstPendingDirty) return;
    const frame = window.requestAnimationFrame(() => {
      firstPendingActionsRef.current?.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [firstPendingDirty]);

  useEffect(
    () => () => {
      if (decisionFocusFrameRef.current !== undefined) {
        window.cancelAnimationFrame(decisionFocusFrameRef.current);
      }
    },
    [],
  );

  if (pending.length === 0 && resolved.length === 0) return null;

  function reviewProposalAtTime(request: ProposalReviewRequest, actorLabel: string): void {
    const resolved = resolveProposalReviewRequest(request, {
      activeBranchId: props.replayCase.activeBranchId,
      timeRangeMs: props.replayCase.timeRangeMs,
    });
    if (!resolved.ok) {
      const branch = props.replayCase.branches.find(
        (candidate) => candidate.id === resolved.proposalBranchId,
      );
      const message = `Activate the “${branch?.name ?? resolved.proposalBranchId}” hypothesis before reviewing the ${actorLabel} proposal. The active scene was not changed.`;
      setReviewFeedback(message);
      setReviewAnnouncement(message);
      return;
    }
    if (!props.onReviewProposalAtTime(resolved.target)) {
      const message = `This ${actorLabel} review target changed before it could be opened. Review the latest proposal revision and try again.`;
      setReviewFeedback(message);
      setReviewAnnouncement(message);
      return;
    }
    setReviewFeedback("");
    const proposalTimeWasClamped =
      resolved.target.reviewTimeMs !== Math.round(resolved.target.proposalTimeMs);
    setReviewAnnouncement(
      proposalTimeWasClamped
        ? `Playhead moved to ${formatExactSeconds(resolved.target.reviewTimeMs)}, the nearest in-range view of the ${actorLabel} proposal point authored at ${formatExactSeconds(resolved.target.proposalTimeMs)}.`
        : `Playhead moved to ${formatExactSeconds(resolved.target.reviewTimeMs)} for the ${actorLabel} proposal.`,
    );
  }

  return (
    <section
      className="proposal-review"
      aria-label="Agent change proposals"
      ref={reviewRef}
      tabIndex={-1}
    >
      <span className="visually-hidden" role="status" aria-live="polite">
        {reviewFeedback ? "" : reviewAnnouncement}
      </span>
      {reviewFeedback && (
        <p className="proposal-review-feedback" role="status">
          <AlertTriangle size={14} aria-hidden="true" /> {reviewFeedback}
        </p>
      )}
      {pending.length > 0 && (
        <header className="proposal-review__heading" aria-live="polite">
          <div>
            <span>
              <Sparkles size={13} aria-hidden="true" /> Agent proposal
            </span>
            <h2>
              {pending.length} change set{pending.length === 1 ? "" : "s"} awaiting you
            </h2>
          </div>
          <strong>{pending.length}</strong>
        </header>
      )}
      {pending.map((proposal, proposalIndex) => {
        const revision = proposal.revisions.at(-1);
        if (!revision) return null;
        const hasStoredTarget = Object.prototype.hasOwnProperty.call(
          expandedTargetByProposal,
          proposal.id,
        );
        const storedTargetId = expandedTargetByProposal[proposal.id];
        const storedTargetIsValid =
          storedTargetId === "" || revision.changes.some((change) => change.id === storedTargetId);
        const reviewedTargetId =
          props.proposalReviewTarget?.proposalId === proposal.id &&
          props.proposalReviewTarget.revisionId === revision.id
            ? props.proposalReviewTarget.changeId
            : undefined;
        const expandedTargetId =
          hasStoredTarget && storedTargetIsValid
            ? storedTargetId
            : (reviewedTargetId ?? revision.changes[0]?.id);
        const expandedTargetIndex = revision.changes.findIndex(
          (change) => change.id === expandedTargetId,
        );
        const expandedTarget = revision.changes[expandedTargetIndex];
        return (
          <form
            className="proposal-card"
            key={`${proposal.id}-${revision.id}`}
            onChange={() => {
              setDirtyProposalIds((current) => {
                if (current.has(proposal.id)) return current;
                const next = new Set(current);
                next.add(proposal.id);
                return next;
              });
            }}
            onSubmit={(event) => {
              event.preventDefault();
              const submitter = (event.nativeEvent as SubmitEvent).submitter;
              const intent =
                submitter instanceof HTMLButtonElement && submitter.value === "accept"
                  ? "accept"
                  : "save";
              if (dirtyProposalIds.has(proposal.id)) {
                const adjusted = props.onAdjustProposal(
                  proposal.id,
                  "Human adjusted the proposed geometry before deciding.",
                  proposalAdjustmentFromForm(proposal, new FormData(event.currentTarget)),
                );
                if (!adjusted) return;
                setDirtyProposalIds((current) => {
                  const next = new Set(current);
                  next.delete(proposal.id);
                  return next;
                });
              }
              if (intent === "accept") {
                setDecision({ proposalId: proposal.id, outcome: "accepted" });
              }
            }}
          >
            <header>
              <div>
                <small>
                  Revision {revision.revisionNumber} · {revision.createdBy}
                  {!revision.authorshipTrusted ? " · unverified import" : ""}
                </small>
                <h3>{proposal.title}</h3>
              </div>
              <span>
                {revision.changes.length} target{revision.changes.length === 1 ? "" : "s"}
              </span>
            </header>
            <p>{proposal.rationale}</p>
            <p className="proposal-review-boundary">
              <ShieldCheck size={14} aria-hidden="true" /> Review only. The authored baseline stays
              unchanged until you accept every target together.
            </p>
            <ul className="proposal-summary-list" aria-label="Proposed change summary">
              {revision.changes.map((change, changeIndex) => {
                const actor = props.replayCase.actors.find(
                  (candidate) => candidate.id === change.actorId,
                );
                const actorLabel = actor?.label ?? change.actorId;
                const targetDetailsId = `proposal-target-details-${String(proposalIndex)}-${String(changeIndex)}`;
                const targetExpanded = expandedTargetId === change.id;
                const toggleTarget = () => {
                  setExpandedTargetByProposal((current) => ({
                    ...current,
                    [proposal.id]: targetExpanded ? "" : change.id,
                  }));
                };
                if (change.kind === "actor-pose") {
                  const poseSummary = `Pose${
                    change.targetTimeMs === undefined
                      ? ""
                      : ` at ${formatSeconds(change.targetTimeMs)}`
                  } · ${String(editableNumber(change.proposedPose.x, 1))}, ${String(
                    editableNumber(change.proposedPose.y, 1),
                  )} · ${String(editableNumber(change.proposedPose.rotationDeg, 1))}°`;
                  return (
                    <ProposalTargetDisclosure
                      key={`summary-${change.id}`}
                      actorLabel={actorLabel}
                      detailsId={targetDetailsId}
                      expanded={targetExpanded}
                      onToggle={toggleTarget}
                      stateLabel="Pose"
                      summary={poseSummary}
                    />
                  );
                }
                const first = change.proposedTrajectory.keyframes[0];
                const last = change.proposedTrajectory.keyframes.at(-1);
                const trajectoryDiff = diffProposalTrajectory(change, props.replayCase.environment);
                const pointCount = trajectoryDiff.keyframeDeltas.length;
                const addedPointCount = trajectoryDiff.keyframeDeltas.filter(
                  (delta) => delta.kind === "added",
                ).length;
                const removedPointCount = trajectoryDiff.keyframeDeltas.filter(
                  (delta) => delta.kind === "removed",
                ).length;
                const modifiedPointCount = pointCount - addedPointCount - removedPointCount;
                const pathSummary = `Path · ${
                  change.createsTrajectory
                    ? `${String(change.proposedTrajectory.keyframes.length)} new points`
                    : addedPointCount || removedPointCount
                      ? `${String(modifiedPointCount)} modified · ${String(addedPointCount)} added · ${String(removedPointCount)} removed`
                      : `${String(pointCount)} of ${String(change.proposedTrajectory.keyframes.length)} points changed`
                }${
                  first && last
                    ? ` · ${String(editableNumber(first.timeMs / 1000))}–${String(editableNumber(last.timeMs / 1000))} s`
                    : ""
                }${
                  trajectoryDiff.visibilityChanged
                    ? ` · visibility ${change.proposedTrajectory.visible ? "shown" : "hidden"}`
                    : ""
                }`;
                const pathStateLabel = change.createsTrajectory
                  ? "New path"
                  : trajectoryDiff.endpointsPreserved
                    ? "Endpoints preserved"
                    : "Endpoints changed";
                const pathStateClassName = change.createsTrajectory
                  ? "is-new"
                  : trajectoryDiff.endpointsPreserved
                    ? "is-preserved"
                    : "is-changed";
                return (
                  <ProposalTargetDisclosure
                    key={`summary-${change.id}`}
                    actorLabel={actorLabel}
                    detailsId={targetDetailsId}
                    expanded={targetExpanded}
                    onToggle={toggleTarget}
                    stateClassName={pathStateClassName}
                    stateLabel={pathStateLabel}
                    summary={pathSummary}
                  />
                );
              })}
            </ul>
            {expandedTarget && expandedTargetIndex >= 0 && (
              <ProposalTargetDetails
                change={expandedTarget}
                currentTimeMs={props.currentTimeMs}
                detailsId={`proposal-target-details-${String(proposalIndex)}-${String(expandedTargetIndex)}`}
                onReview={reviewProposalAtTime}
                proposalId={proposal.id}
                {...(props.proposalReviewTarget
                  ? { proposalReviewTarget: props.proposalReviewTarget }
                  : {})}
                replayCase={props.replayCase}
                revisionId={revision.id}
              />
            )}
            <details className="proposal-exact-editor">
              <summary>
                Adjust exact coordinates <span>Optional</span>
              </summary>
              <div className="proposal-change-list">
                {revision.changes.map((change, changeIndex) => {
                  const actor = props.replayCase.actors.find(
                    (candidate) => candidate.id === change.actorId,
                  );
                  if (change.kind === "actor-pose") {
                    return (
                      <fieldset key={change.id} className="proposal-change">
                        <legend>{actor?.label ?? change.actorId} · proposed pose</legend>
                        <div className="scene-numeric-form__grid">
                          <label>
                            <span>X</span>
                            <input
                              name={`change-${String(changeIndex)}-x`}
                              type="number"
                              min={-REPLAY_MAX_SCENE_COORDINATE}
                              max={REPLAY_MAX_SCENE_COORDINATE}
                              step="any"
                              defaultValue={change.proposedPose.x}
                              required
                            />
                          </label>
                          <label>
                            <span>Y</span>
                            <input
                              name={`change-${String(changeIndex)}-y`}
                              type="number"
                              min={-REPLAY_MAX_SCENE_COORDINATE}
                              max={REPLAY_MAX_SCENE_COORDINATE}
                              step="any"
                              defaultValue={change.proposedPose.y}
                              required
                            />
                          </label>
                          <label>
                            <span>Angle °</span>
                            <input
                              name={`change-${String(changeIndex)}-rotation`}
                              type="number"
                              min={-REPLAY_MAX_ROTATION_DEGREES}
                              max={REPLAY_MAX_ROTATION_DEGREES}
                              step="any"
                              defaultValue={change.proposedPose.rotationDeg}
                              required
                            />
                          </label>
                        </div>
                        <small>
                          {change.targetTimeMs === undefined
                            ? "Legacy pose proposal. Save an exact adjustment before accepting."
                            : `Bound to ${formatSeconds(change.targetTimeMs)} on the reviewed path. Return the playhead to that time before accepting; any path change blocks acceptance.`}
                        </small>
                      </fieldset>
                    );
                  }
                  return (
                    <fieldset key={change.id} className="proposal-change">
                      <legend>{actor?.label ?? change.actorId} · proposed path</legend>
                      <label className="proposal-change__visibility">
                        <input
                          name={`change-${String(changeIndex)}-visible`}
                          type="checkbox"
                          defaultChecked={change.proposedTrajectory.visible}
                        />
                        Show path when applied
                      </label>
                      <div className="proposal-keyframes">
                        {change.proposedTrajectory.keyframes.map((frame, frameIndex) => (
                          <div className="proposal-keyframe" key={frame.id}>
                            <strong>
                              {frameIndex === 0
                                ? "Start"
                                : frameIndex === change.proposedTrajectory.keyframes.length - 1
                                  ? "Final"
                                  : `Point ${String(frameIndex + 1)}`}
                            </strong>
                            <div className="scene-numeric-form__grid scene-numeric-form__grid--four">
                              <label>
                                <span>Time ms</span>
                                <input
                                  name={`change-${String(changeIndex)}-frame-${String(frameIndex)}-time`}
                                  type="number"
                                  min="0"
                                  max={REPLAY_MAX_TIMELINE_MS}
                                  step="any"
                                  defaultValue={frame.timeMs}
                                  required
                                />
                              </label>
                              <label>
                                <span>X</span>
                                <input
                                  name={`change-${String(changeIndex)}-frame-${String(frameIndex)}-x`}
                                  type="number"
                                  min={-REPLAY_MAX_SCENE_COORDINATE}
                                  max={REPLAY_MAX_SCENE_COORDINATE}
                                  step="any"
                                  defaultValue={frame.x}
                                  required
                                />
                              </label>
                              <label>
                                <span>Y</span>
                                <input
                                  name={`change-${String(changeIndex)}-frame-${String(frameIndex)}-y`}
                                  type="number"
                                  min={-REPLAY_MAX_SCENE_COORDINATE}
                                  max={REPLAY_MAX_SCENE_COORDINATE}
                                  step="any"
                                  defaultValue={frame.y}
                                  required
                                />
                              </label>
                              <label>
                                <span>Angle °</span>
                                <input
                                  name={`change-${String(changeIndex)}-frame-${String(frameIndex)}-rotation`}
                                  type="number"
                                  min={-REPLAY_MAX_ROTATION_DEGREES}
                                  max={REPLAY_MAX_ROTATION_DEGREES}
                                  step="any"
                                  defaultValue={frame.rotationDeg}
                                  required
                                />
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>
                    </fieldset>
                  );
                })}
              </div>
            </details>
            {dirtyProposalIds.has(proposal.id) && (
              <p className="proposal-dirty-note" role="status">
                Unsaved exact edits will be saved before the acceptance review.
              </p>
            )}
            <footer ref={proposalIndex === 0 ? firstPendingActionsRef : undefined}>
              <button
                type="button"
                className="button button--quiet"
                onClick={() => setDecision({ proposalId: proposal.id, outcome: "rejected" })}
              >
                Reject
              </button>
              <button
                type="submit"
                name="proposalIntent"
                value="save"
                className="button button--secondary"
                disabled={!dirtyProposalIds.has(proposal.id)}
              >
                Save adjustment
              </button>
              <button
                type="submit"
                name="proposalIntent"
                value="accept"
                className="button button--primary"
              >
                Accept and apply
              </button>
            </footer>
          </form>
        );
      })}
      {resolved.length > 0 && (
        <details className="proposal-history" ref={historyRef}>
          <summary>
            Recent proposal decisions · showing newest {Math.min(5, resolved.length)} of{" "}
            {resolved.length}
          </summary>
          <ul>
            {resolved.slice(0, 5).map((proposal) => {
              const decisionTrust = getProposalDecisionTrust(proposal);
              return (
                <li key={proposal.id}>
                  <span>{proposal.title}</span>
                  <strong>
                    {proposal.status} ·{" "}
                    {decisionTrust === "local-human-attested"
                      ? "local human decision"
                      : "unverified imported decision"}
                  </strong>
                </li>
              );
            })}
          </ul>
        </details>
      )}
      {decision && (
        <ConfirmDialog
          title={decision.outcome === "accepted" ? "Apply this proposal?" : "Reject this proposal?"}
          description={
            decision.outcome === "accepted"
              ? "All listed changes will be applied together. If any target changed or became locked, nothing will be applied."
              : "The proposed geometry will remain unapplied and the human decision will be recorded."
          }
          confirmLabel={decision.outcome === "accepted" ? "Accept and apply" : "Reject proposal"}
          destructive={decision.outcome === "rejected"}
          onCancel={() => setDecision(undefined)}
          onConfirm={() => {
            const decided =
              decision.outcome === "accepted"
                ? props.onAcceptProposal(decision.proposalId)
                : props.onRejectProposal(decision.proposalId);
            if (decided) {
              setDecision(undefined);
              decisionFocusFrameRef.current = window.requestAnimationFrame(() => {
                decisionFocusFrameRef.current = undefined;
                const nextProposalAction =
                  firstPendingActionsRef.current?.querySelector<HTMLButtonElement>(
                    "button:not([disabled])",
                  );
                if (nextProposalAction) {
                  nextProposalAction.focus();
                  return;
                }
                const historySummary = historyRef.current?.querySelector<HTMLElement>("summary");
                (historySummary ?? reviewRef.current)?.focus();
              });
            }
          }}
        />
      )}
    </section>
  );
}

function SceneSelectionEditor(props: InspectorPanelProps) {
  const acceptedProposalGeometryTrust = getAcceptedProposalGeometryTrust(props.replayCase);
  const sceneBounds = props.replayCase.environment.bounds;
  const actor = props.replayCase.actors.find((item) => item.id === props.selectedId);
  const trajectory = props.replayCase.trajectories.find((item) => item.id === props.selectedId);
  const timelineEvent = props.replayCase.timelineEvents.find(
    (item) => item.id === props.selectedId,
  );
  const branch = trajectory
    ? props.replayCase.branches.find((item) => item.id === trajectory.branchId)
    : undefined;
  const trajectoryActor = trajectory
    ? props.replayCase.actors.find((item) => item.id === trajectory.actorId)
    : undefined;
  const trajectoryEditLocked = [trajectory?.locked, trajectoryActor?.locked].some(Boolean);
  const actorTrajectory = actor
    ? props.replayCase.trajectories.find(
        (item) => item.actorId === actor.id && item.branchId === props.replayCase.activeBranchId,
      )
    : undefined;
  const actorEditLocked = [actor?.locked, actorTrajectory?.locked].some(Boolean);
  const actorPose = actor
    ? (getActorPoseAtTime(props.replayCase, actor.id, props.currentTimeMs) ?? actor.pose)
    : undefined;
  const trajectoryMotion = trajectory
    ? analyzeTrajectoryMotion(trajectory, {
        calibration: createSceneMetricCalibration({
          sceneBounds: props.replayCase.environment.bounds,
          widthMeters: props.replayCase.environment.calibration.widthMeters,
          heightMeters: props.replayCase.environment.calibration.heightMeters,
        }),
      })
    : undefined;
  const trajectoryMotionIssues = trajectory
    ? props.replayCase.consistencyIssues.filter(
        (item) => item.scope === "motion" && item.affectedIds.includes(trajectory.id),
      )
    : [];
  const impactAdjacentPaths =
    timelineEvent?.type === "impact"
      ? analyzeImpactAdjacentPaths(props.replayCase, timelineEvent.id)
      : [];
  const trajectoryAgentAuthored = trajectory
    ? trajectory.createdBy === "agent" || trajectory.changeHistory.at(-1)?.author === "agent"
    : false;
  const trajectoryProposalTrust = trajectory
    ? acceptedProposalGeometryTrust.trajectoryIds.get(trajectory.id)
    : undefined;
  const actorProposalTrust = actor
    ? acceptedProposalGeometryTrust.actorIds.get(actor.id)
    : undefined;
  if (!actor && !trajectory && !timelineEvent) return null;

  if (actor && actorPose) {
    return (
      <section className="scene-selection-editor" aria-labelledby="scene-selection-title">
        <header>
          <span className="scene-selection-editor__icon">
            <CarFront size={16} aria-hidden="true" />
          </span>
          <div>
            <small>Selected vehicle</small>
            <h2 id="scene-selection-title">{actor.label}</h2>
          </div>
          <button
            className="icon-button icon-button--small"
            type="button"
            onClick={() => props.onToggleSceneItemLock("actor", actor.id, !actor.locked)}
            aria-label={actor.locked ? `Unlock ${actor.label}` : `Lock ${actor.label}`}
          >
            {actor.locked ? <Unlock size={14} /> : <LockKeyhole size={14} />}
          </button>
        </header>
        <p className="scene-selection-editor__hint">
          This is the vehicle pose at {formatSeconds(props.currentTimeMs)}. Cars follow their path
          as the playhead moves. Moving or rotating one here updates a nearby path point, or creates
          one at this time.
        </p>
        <p
          className={`scene-selection-editor__provenance${actorProposalTrust === "unverified-import" ? " is-unverified" : ""}`}
        >
          Geometry provenance:{" "}
          {actorProposalTrust === "local-human-attested"
            ? "Human-accepted agent proposal"
            : actorProposalTrust === "unverified-import"
              ? "Unverified imported proposal geometry"
              : (actor.lastEditedBy ?? "legacy record")}
          {actor.lastEditedAt ? ` · ${new Date(actor.lastEditedAt).toLocaleString()}` : ""}
        </p>
        {actorTrajectory?.locked && !actor.locked && (
          <p className="scene-selection-editor__hint" role="note">
            {actor.label} follows a locked path, so its pose is read-only until that path is
            unlocked.
          </p>
        )}
        <form
          key={`${actor.id}-${String(actorPose.x)}-${String(actorPose.y)}-${String(actorPose.rotationDeg)}`}
          className="scene-numeric-form"
          onFocusCapture={props.onEditStart}
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            props.onUpdateActorPose(actor.id, {
              x: requiredNumber(data, "x"),
              y: requiredNumber(data, "y"),
              rotationDeg: requiredNumber(data, "rotation"),
            });
          }}
        >
          <div className="scene-numeric-form__grid">
            <label>
              <span>X position</span>
              <input
                name="x"
                type="number"
                min={sceneBounds.minX}
                max={sceneBounds.maxX}
                step="any"
                defaultValue={actorPose.x}
                required
                disabled={actorEditLocked}
              />
            </label>
            <label>
              <span>Y position</span>
              <input
                name="y"
                type="number"
                min={sceneBounds.minY}
                max={sceneBounds.maxY}
                step="any"
                defaultValue={actorPose.y}
                required
                disabled={actorEditLocked}
              />
            </label>
            <label>
              <span>Rotation °</span>
              <input
                name="rotation"
                type="number"
                min="-360"
                max="360"
                step="any"
                defaultValue={actorPose.rotationDeg}
                required
                disabled={actorEditLocked}
              />
            </label>
          </div>
          <button className="button button--secondary" disabled={actorEditLocked}>
            Apply exact pose
          </button>
        </form>
        <div className="rotation-controls" role="group" aria-label={`Rotate ${actor.label}`}>
          <span>Quick rotation</span>
          <div>
            <button
              type="button"
              className="button button--secondary"
              disabled={actorEditLocked}
              onClick={() =>
                props.onUpdateActorPose(actor.id, {
                  ...actorPose,
                  rotationDeg: normalizeDegrees(actorPose.rotationDeg - 15),
                })
              }
              aria-label={`Rotate ${actor.label} left 15 degrees`}
            >
              <RotateCcw size={14} aria-hidden="true" /> −15°
            </button>
            <button
              type="button"
              className="button button--secondary"
              disabled={actorEditLocked}
              onClick={() =>
                props.onUpdateActorPose(actor.id, {
                  ...actorPose,
                  rotationDeg: normalizeDegrees(actorPose.rotationDeg + 15),
                })
              }
              aria-label={`Rotate ${actor.label} right 15 degrees`}
            >
              <RotateCw size={14} aria-hidden="true" /> +15°
            </button>
          </div>
          <small>
            Drag the round handle above the car. 0° points up, 90° right, 180° down, and 270° left.
          </small>
        </div>
        <details className="vehicle-spec-editor">
          <summary>Vehicle size and measurement</summary>
          <form
            key={JSON.stringify([
              actor.id,
              actor.dimensions.length,
              actor.dimensions.width,
              actor.wheelbaseMeters ?? null,
              actor.vehicleClass,
              actor.dimensionsSource,
            ])}
            className="scene-numeric-form"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const wheelbaseValue = data.get("wheelbase");
              const wheelbaseMeters =
                typeof wheelbaseValue === "string" && wheelbaseValue.trim().length > 0
                  ? Number(wheelbaseValue)
                  : undefined;
              props.onUpdateActorSpecs(actor.id, {
                dimensions: {
                  length: requiredNumber(data, "vehicle-length"),
                  width: requiredNumber(data, "vehicle-width"),
                },
                vehicleClass: data.get("vehicle-class") as VehicleClass,
                dimensionsSource: data.get("dimensions-source") as MeasurementSource,
                ...(wheelbaseMeters === undefined ? {} : { wheelbaseMeters }),
              });
            }}
          >
            <div className="scene-numeric-form__grid">
              <label>
                <span>Length m</span>
                <input
                  name="vehicle-length"
                  type="number"
                  min="1.5"
                  max="20"
                  step="0.01"
                  defaultValue={actor.dimensions.length}
                  required
                  disabled={actor.locked}
                />
              </label>
              <label>
                <span>Width m</span>
                <input
                  name="vehicle-width"
                  type="number"
                  min="0.4"
                  max="4"
                  step="0.01"
                  defaultValue={actor.dimensions.width}
                  required
                  disabled={actor.locked}
                />
              </label>
              <label>
                <span>Wheelbase m</span>
                <input
                  name="wheelbase"
                  type="number"
                  min="0.8"
                  max="12"
                  step="0.01"
                  defaultValue={actor.wheelbaseMeters ?? ""}
                  disabled={actor.locked}
                />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>Vehicle class</span>
                <select
                  name="vehicle-class"
                  defaultValue={actor.vehicleClass}
                  disabled={actor.locked}
                >
                  <option value="compact-car">Compact car</option>
                  <option value="saloon">Saloon</option>
                  <option value="suv">SUV</option>
                  <option value="van">Van</option>
                  <option value="pickup">Pickup</option>
                  <option value="motorcycle">Motorcycle</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              <label className="field">
                <span>Dimension source</span>
                <select
                  name="dimensions-source"
                  defaultValue={actor.dimensionsSource}
                  disabled={actor.locked}
                >
                  <option value="measured">Measured</option>
                  <option value="manufacturer">Manufacturer specification</option>
                  <option value="template">Template estimate</option>
                  <option value="estimated">Human estimate</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
            </div>
            <p className="scene-selection-editor__hint">
              The scene renders these metres to scale. Record the source so an estimate never looks
              like a measurement.
            </p>
            <button className="button button--secondary" disabled={actor.locked}>
              Apply vehicle specification
            </button>
          </form>
        </details>
        <dl className="scene-selection-facts">
          <div>
            <dt>Dimensions</dt>
            <dd>
              {actor.dimensions.length.toFixed(1)} × {actor.dimensions.width.toFixed(1)}
              {" m"}
            </dd>
          </div>
          <div>
            <dt>Dimension source</dt>
            <dd>{actor.dimensionsSource.replaceAll("-", " ")}</dd>
          </div>
          <div>
            <dt>Damage markers</dt>
            <dd>{actor.damageMarkers.length || "None"}</dd>
          </div>
        </dl>
      </section>
    );
  }

  if (trajectory) {
    return (
      <section className="scene-selection-editor" aria-labelledby="scene-selection-title">
        <header>
          <span className="scene-selection-editor__icon">
            <Route size={16} aria-hidden="true" />
          </span>
          <div>
            <small>Selected trajectory</small>
            <h2 id="scene-selection-title">{trajectoryActor?.label ?? "Vehicle path"}</h2>
          </div>
          <button
            className="icon-button icon-button--small"
            type="button"
            onClick={() =>
              props.onToggleSceneItemLock("trajectory", trajectory.id, !trajectory.locked)
            }
            aria-label={trajectory.locked ? "Unlock trajectory" : "Lock trajectory"}
          >
            {trajectory.locked ? <Unlock size={14} /> : <LockKeyhole size={14} />}
          </button>
        </header>
        <div className="scene-selection-editor__meta">
          <span>{branch?.name ?? trajectory.branchId}</span>
          <span
            className={
              trajectoryProposalTrust === "unverified-import"
                ? "provenance-chip is-unverified"
                : trajectoryAgentAuthored || trajectoryProposalTrust
                  ? "provenance-chip is-agent"
                  : "provenance-chip"
            }
          >
            {trajectoryProposalTrust === "local-human-attested"
              ? "Human-accepted agent proposal"
              : trajectoryProposalTrust === "unverified-import"
                ? "Unverified imported proposal geometry"
                : trajectoryAgentAuthored
                  ? "Agent-authored geometry"
                  : "Human-authored geometry"}
          </span>
          <label>
            <input
              type="checkbox"
              checked={trajectory.visible}
              disabled={trajectoryEditLocked}
              onChange={(event) =>
                props.onSetTrajectoryVisible(trajectory.id, event.target.checked)
              }
            />
            Show path
          </label>
        </div>
        {trajectoryActor?.locked && !trajectory.locked && (
          <p className="scene-selection-editor__hint" role="note">
            {trajectoryActor.label} is locked, so its path is read-only until the vehicle is
            unlocked.
          </p>
        )}
        <div className="trajectory-model-note">
          <strong>Authored timed poses are scaled through the calibrated local scene.</strong>
          <p>
            A path point is the vehicle’s pose at a specific time. REPLAY interpolates between
            points and derives speed, acceleration, heading, yaw, turn radius, and footprint
            contact. Those values are reconstruction outputs, not measurements unless an independent
            source establishes them. They are transparent review advisories, not a full
            vehicle-dynamics simulation or a fault finding.
          </p>
          {trajectoryMotion && (
            <dl className="trajectory-metrics">
              <div>
                <dt>Path distance</dt>
                <dd>{trajectoryMotion.summary.totalDistanceM.toFixed(1)} m</dd>
              </div>
              <div>
                <dt>Peak segment speed</dt>
                <dd>{(trajectoryMotion.summary.maxSpeedMps * 3.6).toFixed(1)} km/h</dd>
              </div>
              <div>
                <dt>Minimum turn radius</dt>
                <dd>
                  {trajectoryMotion.summary.minimumTurnRadiusM === null
                    ? "Straight"
                    : `${trajectoryMotion.summary.minimumTurnRadiusM.toFixed(1)} m`}
                </dd>
              </div>
              <div>
                <dt>Review advisories</dt>
                <dd>{trajectoryMotionIssues.length}</dd>
              </div>
            </dl>
          )}
          <small>
            Calibration: {props.replayCase.environment.calibration.widthMeters} ×{" "}
            {props.replayCase.environment.calibration.heightMeters} m ·{" "}
            {props.replayCase.environment.calibration.source.replaceAll("-", " ")} · ±
            {props.replayCase.environment.calibration.uncertaintyMeters} m
          </small>
          <button
            type="button"
            className="button button--secondary"
            disabled={trajectoryEditLocked}
            onClick={() => props.onAddTrajectoryKeyframe(trajectory.id)}
          >
            <Plus size={14} aria-hidden="true" /> Add point at {formatSeconds(props.currentTimeMs)}
          </button>
          <small>Move the timeline playhead first to add a point at a different time.</small>
        </div>
        <div className="keyframe-editor-list" role="group" aria-label="Exact trajectory points">
          {trajectory.keyframes.map((frame, index) => (
            <form
              key={`${frame.id}-${String(frame.timeMs)}-${String(frame.x)}-${String(frame.y)}-${String(frame.rotationDeg)}`}
              className={`keyframe-editor scene-numeric-form${props.selectedKeyframeId === frame.id ? " is-active" : ""}`}
              aria-labelledby={`keyframe-editor-${frame.id}`}
              onFocusCapture={() => props.onSelectTrajectoryKeyframe(trajectory.id, frame.id)}
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                props.onUpdateTrajectoryKeyframe(trajectory.id, frame.id, {
                  timeMs: Math.round(requiredNumber(data, "time") * 1000),
                  x: requiredNumber(data, "x"),
                  y: requiredNumber(data, "y"),
                  rotationDeg: requiredNumber(data, "rotation"),
                });
              }}
            >
              <header>
                <strong id={`keyframe-editor-${frame.id}`}>
                  Point {index + 1} <small>{formatSeconds(frame.timeMs)}</small>
                </strong>
                <div>
                  <button
                    type="button"
                    className="text-button keyframe-remove"
                    disabled={trajectoryEditLocked || trajectory.keyframes.length <= 2}
                    onClick={() => props.onRemoveTrajectoryKeyframe(trajectory.id, frame.id)}
                    aria-label={`Remove point ${index + 1}`}
                    title={
                      trajectory.keyframes.length <= 2
                        ? "A path needs at least two points"
                        : `Remove point ${index + 1}`
                    }
                  >
                    <Trash2 size={13} aria-hidden="true" /> Remove
                  </button>
                  <button
                    className="text-button"
                    disabled={trajectoryEditLocked}
                    aria-label={`Apply point ${index + 1}`}
                  >
                    Apply point
                  </button>
                </div>
              </header>
              <div className="scene-numeric-form__grid scene-numeric-form__grid--four">
                <label>
                  <span>Time s</span>
                  <input
                    name="time"
                    type="number"
                    min={props.replayCase.timeRangeMs.start / 1000}
                    max={props.replayCase.timeRangeMs.end / 1000}
                    step="0.001"
                    defaultValue={frame.timeMs / 1000}
                    required
                    disabled={trajectoryEditLocked}
                  />
                </label>
                <label>
                  <span>X</span>
                  <input
                    name="x"
                    type="number"
                    min={sceneBounds.minX}
                    max={sceneBounds.maxX}
                    step="any"
                    defaultValue={frame.x}
                    required
                    disabled={trajectoryEditLocked}
                  />
                </label>
                <label>
                  <span>Y</span>
                  <input
                    name="y"
                    type="number"
                    min={sceneBounds.minY}
                    max={sceneBounds.maxY}
                    step="any"
                    defaultValue={frame.y}
                    required
                    disabled={trajectoryEditLocked}
                  />
                </label>
                <label>
                  <span>Angle °</span>
                  <input
                    name="rotation"
                    type="number"
                    min="-360"
                    max="360"
                    step="any"
                    defaultValue={frame.rotationDeg}
                    required
                    disabled={trajectoryEditLocked}
                  />
                </label>
              </div>
            </form>
          ))}
        </div>
      </section>
    );
  }

  if (!timelineEvent) return null;
  const isUncertaintyMarker =
    timelineEvent.certainty === "unknown" ||
    timelineEvent.linkedClaimIds.some((claimId) => {
      const linkedClaim = props.replayCase.claims.find((claim) => claim.id === claimId);
      return linkedClaim?.status === "unknown";
    });
  return (
    <section className="scene-selection-editor" aria-labelledby="scene-selection-title">
      <header>
        <span className="scene-selection-editor__icon">
          <Clock3 size={16} aria-hidden="true" />
        </span>
        <div>
          <small>Selected timeline event</small>
          <h2 id="scene-selection-title">{timelineEvent.title}</h2>
        </div>
        <button
          className="icon-button icon-button--small"
          type="button"
          onClick={() =>
            props.onToggleSceneItemLock("timeline-event", timelineEvent.id, !timelineEvent.locked)
          }
          aria-label={timelineEvent.locked ? "Unlock selected event" : "Lock selected event"}
        >
          {timelineEvent.locked ? <Unlock size={14} /> : <LockKeyhole size={14} />}
        </button>
      </header>
      <p className="scene-selection-editor__hint">
        {isUncertaintyMarker
          ? "This is an uncertainty marker, not a simulated change in motion. From this time, the available information does not establish which lane either vehicle occupied."
          : "Edit the event at the playhead. Certainty describes how the detail is supported, not how likely the motion is in a physics model."}
      </p>
      {timelineEvent.type === "impact" && (
        <div className="trajectory-model-note" data-testid="impact-adjacent-paths">
          <strong>Authored path: before → after</strong>
          <small>Leg-average speed · not simulated</small>
          <ul className="impact-adjacent-list" aria-label="Authored path changes by vehicle">
            {impactAdjacentPaths.map((transition) => {
              const actorLabel =
                props.replayCase.actors.find((candidate) => candidate.id === transition.actorId)
                  ?.label ?? transition.actorId;
              const speed =
                transition.incoming && transition.outgoing
                  ? `${(transition.incoming.speedMps * 3.6).toFixed(1)} → ${(transition.outgoing.speedMps * 3.6).toFixed(1)} km/h`
                  : "Needs timed points on both sides";
              const course =
                transition.courseChangeDeg === null
                  ? "Not available"
                  : Math.abs(transition.courseChangeDeg) < 0.05
                    ? "No course change"
                    : `${Math.abs(transition.courseChangeDeg).toFixed(1)}° ${transition.courseChangeDeg > 0 ? "right" : "left"}`;
              return (
                <li key={transition.actorId}>
                  <strong>{actorLabel}</strong>
                  <span>
                    {speed} · course shift {course.toLowerCase()}
                  </span>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="button button--primary impact-replay-button"
            onClick={() => props.onReplayImpact(timelineEvent.id)}
          >
            <Play size={14} aria-hidden="true" /> Play authored motion around impact
          </button>
          <p>
            Immediate before-and-after timed path legs. REPLAY does not calculate a collision
            response or establish causation.
          </p>
          <small>
            The event time is an explicit path point for{" "}
            {impactAdjacentPaths.filter((transition) => transition.authoredImpactKeyframe).length}{" "}
            of {impactAdjacentPaths.length} linked vehicles.
          </small>
        </div>
      )}
      <form
        key={`${timelineEvent.id}-${String(timelineEvent.timeMs)}-${timelineEvent.certainty}-${String(timelineEvent.location?.x)}-${String(timelineEvent.location?.y)}`}
        className="scene-numeric-form"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const location = timelineEvent.location
            ? { x: requiredNumber(data, "x"), y: requiredNumber(data, "y") }
            : undefined;
          props.onUpdateTimelineEvent(timelineEvent.id, {
            timeMs: Math.round(requiredNumber(data, "time") * 1000),
            certainty: requiredEventCertainty(data),
            ...(location ? { location } : {}),
          });
        }}
      >
        <div className="scene-numeric-form__grid">
          <label>
            <span>Time s</span>
            <input
              name="time"
              type="number"
              min={props.replayCase.timeRangeMs.start / 1000}
              max={props.replayCase.timeRangeMs.end / 1000}
              step="0.001"
              defaultValue={timelineEvent.timeMs / 1000}
              required
              disabled={timelineEvent.locked}
            />
          </label>
          {timelineEvent.location && (
            <>
              <label>
                <span>X location</span>
                <input
                  name="x"
                  type="number"
                  min={sceneBounds.minX}
                  max={sceneBounds.maxX}
                  step="any"
                  defaultValue={timelineEvent.location.x}
                  required
                  disabled={timelineEvent.locked}
                />
              </label>
              <label>
                <span>Y location</span>
                <input
                  name="y"
                  type="number"
                  min={sceneBounds.minY}
                  max={sceneBounds.maxY}
                  step="any"
                  defaultValue={timelineEvent.location.y}
                  required
                  disabled={timelineEvent.locked}
                />
              </label>
            </>
          )}
        </div>
        <label className="scene-certainty-field">
          <span>Certainty</span>
          <select
            name="certainty"
            defaultValue={timelineEvent.certainty}
            disabled={timelineEvent.locked}
          >
            <option value="reported">Reported</option>
            <option value="likely">Likely</option>
            <option value="uncertain">Uncertain</option>
            <option value="disputed">Disputed</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <button className="button button--secondary" disabled={timelineEvent.locked}>
          Apply event details
        </button>
      </form>
    </section>
  );
}

function SectionHeading({
  kicker,
  title,
  action,
}: {
  kicker: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="inspector-heading">
      <div>
        <p>{kicker}</p>
        <h2>{title}</h2>
      </div>
      {action}
    </header>
  );
}

function FactsView(props: InspectorPanelProps) {
  const [adding, setAdding] = useState(false);
  const [statement, setStatement] = useState("");
  const [status, setStatus] = useState<Exclude<ClaimStatus, "confirmed">>("reported");
  const [sourceType, setSourceType] = useState<Claim["sourceType"]>("human-statement");
  const [sourceId, setSourceId] = useState("");
  const activeEvidence = props.replayCase.evidence.filter((asset) => !asset.deleted);
  const sourceRequiresEvidence = sourceType === "photo" || sourceType === "document";
  const ordered = useMemo(
    () =>
      [...props.replayCase.claims].sort(
        (a, b) => Number(b.humanConfirmed) - Number(a.humanConfirmed),
      ),
    [props.replayCase.claims],
  );
  const selected = props.replayCase.claims.find((claim) => claim.id === props.selectedId);

  function resetObservationDraft(): void {
    setStatement("");
    setStatus("reported");
    setSourceType("human-statement");
    setSourceId("");
  }

  function closeObservationDraft(): void {
    resetObservationDraft();
    setAdding(false);
  }

  return (
    <>
      <SectionHeading
        kicker="Provenance ledger"
        title="Facts and observations"
        action={
          <button
            className="icon-button"
            onClick={() => {
              if (adding) {
                closeObservationDraft();
                return;
              }
              resetObservationDraft();
              setAdding(true);
            }}
            aria-label="Add observation"
          >
            <Plus size={17} />
          </button>
        }
      />
      <div className="inspector-summary-line">
        <span>
          <strong>{ordered.filter((item) => item.humanConfirmed).length}</strong> confirmed
        </span>
        <span>
          <strong>{ordered.filter((item) => !item.humanConfirmed).length}</strong> unresolved
        </span>
      </div>

      {ordered.length === 0 && !adding && (
        <EmptyState icon={MessageSquareText} title="No observations yet">
          Add what was reported or remains unknown. Then select a vehicle in the scene and choose
          Create path to reconstruct movement; confirmation always remains a human action.
        </EmptyState>
      )}

      {adding && (
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!statement.trim()) return;
            const sourceIds = sourceRequiresEvidence && sourceId ? [sourceId] : [];
            const added = props.onAddClaim(statement.trim(), status, sourceType, sourceIds);
            if (!added) return;
            closeObservationDraft();
          }}
        >
          <label>
            <span>Observation</span>
            <textarea
              value={statement}
              onChange={(event) => setStatement(event.target.value)}
              rows={3}
              required
              autoFocus
            />
          </label>
          <div className="inline-form__row">
            <label>
              <span>Status</span>
              <select
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as Exclude<ClaimStatus, "confirmed">)
                }
              >
                <option value="reported">Reported</option>
                <option value="uncertain">Uncertain</option>
                <option value="unknown">Unknown</option>
                <option value="disputed">Disputed</option>
                <option value="likely">Likely</option>
              </select>
            </label>
            <label>
              <span>Source</span>
              <select
                value={sourceType}
                onChange={(event) => {
                  setSourceType(event.target.value as Claim["sourceType"]);
                  setSourceId("");
                }}
              >
                <option value="human-statement">Human statement</option>
                <option value="witness-statement">Witness statement</option>
                <option value="photo">Photo</option>
                <option value="document">Document</option>
                <option value="scene-observation">Scene observation</option>
              </select>
            </label>
          </div>
          {sourceRequiresEvidence && (
            <label>
              <span>{sourceType === "photo" ? "Cited photo" : "Cited document image"}</span>
              <select
                value={sourceId}
                onChange={(event) => setSourceId(event.target.value)}
                required
              >
                <option value="">Choose local evidence</option>
                {activeEvidence.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </select>
              <small>
                {activeEvidence.length > 0
                  ? "The cited image stays local; its structured metadata can be referenced in the case."
                  : "Add an image in Evidence before using this source classification."}
              </small>
            </label>
          )}
          <div className="inline-form__actions">
            <button type="button" className="text-button" onClick={closeObservationDraft}>
              Cancel
            </button>
            <button
              className="button button--primary"
              disabled={sourceRequiresEvidence && !sourceId}
            >
              Add observation
            </button>
          </div>
        </form>
      )}

      <div className="claim-list" role="list" aria-label="Claims">
        {ordered.map((claim) => (
          <div key={claim.id} role="listitem">
            <button
              className={`claim-row status-${claim.status}${props.selectedId === claim.id ? " is-selected" : ""}`}
              onClick={() => props.onSelect("claim", claim.id)}
            >
              <span className="status-glyph">
                <StatusGlyph status={claim.status} />
              </span>
              <span className="claim-row__body">
                <strong>{claim.statement}</strong>
                <small>
                  {statusLabels[claim.status]} · {claim.sourceType.replaceAll("-", " ")}
                </small>
              </span>
              {claim.locked ? (
                <LockKeyhole size={13} aria-label="Locked" />
              ) : (
                <ChevronRight size={14} aria-hidden="true" />
              )}
            </button>
          </div>
        ))}
      </div>

      {selected && (
        <section className="selection-detail" aria-label="Selected observation">
          <div className="selection-detail__top">
            <span className={`status-pill status-${selected.status}`}>
              <StatusGlyph status={selected.status} />
              {statusLabels[selected.status]}
            </span>
            <button
              className="icon-button icon-button--small"
              onClick={() => props.onToggleLock("claim", selected.id, !selected.locked)}
              aria-label={selected.locked ? "Unlock observation" : "Lock observation"}
            >
              {selected.locked ? <Unlock size={14} /> : <LockKeyhole size={14} />}
            </button>
          </div>
          <dl className="provenance-grid">
            <div>
              <dt>Author</dt>
              <dd>{selected.createdBy}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{selected.sourceType.replaceAll("-", " ")}</dd>
            </div>
            <div>
              <dt>Evidence</dt>
              <dd>{selected.linkedEvidenceIds.length || "None linked"}</dd>
            </div>
            <div>
              <dt>Scope</dt>
              <dd>{selected.sharedAcrossBranches ? "All branches" : "This branch"}</dd>
            </div>
          </dl>
          <div className="relation-groups" role="group" aria-label="Observation links">
            <RelationLinks
              label="Cited sources"
              ids={selected.sourceIds}
              replayCase={props.replayCase}
              onSelect={props.onSelect}
            />
            <RelationLinks
              label="Evidence context"
              ids={selected.linkedEvidenceIds.filter((id) => !selected.sourceIds.includes(id))}
              replayCase={props.replayCase}
              onSelect={props.onSelect}
            />
            <RelationLinks
              label="Event context"
              ids={selected.linkedEventIds.filter((id) => !selected.sourceIds.includes(id))}
              replayCase={props.replayCase}
              onSelect={props.onSelect}
            />
            <RelationLinks
              label="Scene context"
              ids={selected.linkedSceneObjectIds.filter((id) => !selected.sourceIds.includes(id))}
              replayCase={props.replayCase}
              onSelect={props.onSelect}
            />
            <RelationLinks
              label="Branch scope"
              ids={selected.branchId ? [selected.branchId] : []}
              replayCase={props.replayCase}
              onSelect={props.onSelect}
            />
          </div>
          {!selected.locked && (
            <ObservationDetailsEditor
              key={`${selected.id}:${selected.updatedAt}`}
              claim={selected}
              replayCase={props.replayCase}
              onUpdate={props.onUpdateClaim}
            />
          )}
          {!selected.branchId &&
            selected.status !== "agent-hypothesis" &&
            selected.status !== "confirmed" &&
            !selected.locked && (
              <>
                {(selected.sourceType === "photo" || selected.sourceType === "document") &&
                  compatibleAgentObservationSourceIds(
                    props.replayCase,
                    selected.sourceType,
                    selected.sourceIds,
                  ).length === 0 && (
                    <p className="safety-note is-source-missing" role="note">
                      <AlertTriangle size={14} /> Attach a cited source before confirming this
                      observation.
                    </p>
                  )}
                {selected.createdBy === "agent" && (
                  <p className="safety-note is-agent-review" role="note">
                    <Sparkles size={14} /> An agent recorded this observation. Confirm only after
                    independently reviewing its wording, scope, and cited sources.
                  </p>
                )}
                <button
                  className="button button--primary button--full"
                  onClick={() => props.onConfirmClaim(selected.id)}
                  disabled={
                    (selected.sourceType === "photo" || selected.sourceType === "document") &&
                    compatibleAgentObservationSourceIds(
                      props.replayCase,
                      selected.sourceType,
                      selected.sourceIds,
                    ).length === 0
                  }
                >
                  <ShieldCheck size={15} /> Confirm as human-reviewed
                </button>
              </>
            )}
          {selected.status === "confirmed" && (
            <p className="safety-note">
              <ShieldCheck size={14} /> This status came from an explicit human action.
            </p>
          )}
          <label className="compact-field">
            <span>Classification</span>
            <select
              disabled={selected.locked}
              value={selected.status === "confirmed" ? "confirmed" : selected.status}
              onChange={(event) =>
                props.onSetClaimStatus(
                  selected.id,
                  event.target.value as Exclude<ClaimStatus, "confirmed">,
                )
              }
            >
              <option value="confirmed" disabled>
                Confirmed by human
              </option>
              <option value="reported">Reported</option>
              <option value="likely">Likely</option>
              <option value="uncertain">Uncertain</option>
              <option value="disputed">Disputed</option>
              <option value="unknown">Unknown</option>
              <option value="agent-hypothesis">Agent hypothesis</option>
            </select>
          </label>
        </section>
      )}
    </>
  );
}

function ObservationDetailsEditor({
  claim,
  replayCase,
  onUpdate,
}: {
  claim: Claim;
  replayCase: ReplayCase;
  onUpdate: InspectorPanelProps["onUpdateClaim"];
}) {
  const activeEvidence = replayCase.evidence.filter((asset) => !asset.deleted);
  const activeEvidenceIds = new Set(activeEvidence.map((asset) => asset.id));
  const [statement, setStatement] = useState(claim.statement);
  const [sourceType, setSourceType] = useState<Claim["sourceType"]>(claim.sourceType);
  const [sourceId, setSourceId] = useState(
    claim.sourceIds.find((id) => activeEvidenceIds.has(id)) ?? "",
  );
  const sourceRequiresEvidence = sourceType === "photo" || sourceType === "document";

  return (
    <details className="observation-editor">
      <summary>Edit wording and source</summary>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          const nextSourceIds = sourceRequiresEvidence
            ? sourceId
              ? [sourceId]
              : []
            : sourceType === claim.sourceType
              ? claim.sourceIds
              : [];
          const linkedEvidenceIds = sourceRequiresEvidence
            ? [...new Set([...claim.linkedEvidenceIds, ...nextSourceIds])]
            : claim.linkedEvidenceIds;
          onUpdate(claim.id, {
            statement: statement.trim(),
            sourceType,
            sourceIds: nextSourceIds,
            linkedEvidenceIds,
          });
        }}
      >
        <label>
          <span>Observation</span>
          <textarea
            rows={3}
            value={statement}
            onChange={(event) => setStatement(event.target.value)}
            required
          />
        </label>
        <label>
          <span>Provenance source</span>
          <select
            value={sourceType}
            onChange={(event) => {
              setSourceType(event.target.value as Claim["sourceType"]);
              setSourceId("");
            }}
          >
            <option value="human-statement">Human statement</option>
            <option value="witness-statement">Witness statement</option>
            <option value="photo">Photo</option>
            <option value="document">Document</option>
            <option value="scene-observation">Scene observation</option>
            {claim.sourceType === "agent-inference" && (
              <option value="agent-inference">Agent inference</option>
            )}
          </select>
        </label>
        {sourceRequiresEvidence && (
          <label>
            <span>{sourceType === "photo" ? "Cited photo" : "Cited document image"}</span>
            <select value={sourceId} onChange={(event) => setSourceId(event.target.value)} required>
              <option value="">Choose local evidence</option>
              {activeEvidence.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {claim.status === "confirmed" && (
          <p className="inline-form__note">
            Changing wording or provenance returns this observation to reported until a person
            reviews it again.
          </p>
        )}
        <div className="inline-form__actions">
          <button
            className="button button--secondary"
            disabled={!statement.trim() || (sourceRequiresEvidence && !sourceId)}
          >
            Save observation details
          </button>
        </div>
      </form>
    </details>
  );
}

function EvidenceView(props: InspectorPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string>();
  const isSharedGitHubPagesOrigin = isSharedGitHubPagesHostname(window.location.hostname);
  const evidence = props.replayCase.evidence.filter((item) => !item.deleted);
  const selected = evidence.find((item) => item.id === props.selectedId) ?? evidence[0];
  const selectedImageUrl = selected
    ? resolveEvidenceImageSource(selected, props.evidenceUrls?.[selected.id])
    : undefined;

  function process(files: FileList | null) {
    const file = files?.[0];
    if (file) props.onUploadEvidence({ file });
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    process(event.dataTransfer.files);
  }

  return (
    <>
      <SectionHeading
        kicker="Local evidence"
        title="Evidence tray"
        action={
          <button
            className="icon-button"
            onClick={() => inputRef.current?.click()}
            aria-label="Upload evidence"
          >
            <Upload size={17} />
          </button>
        }
      />
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        tabIndex={-1}
        aria-label="Choose evidence image"
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => {
          process(event.target.files);
          // Let the same file be selected again after a rejection or deletion.
          // Browsers do not dispatch change when a file input keeps that value.
          event.currentTarget.value = "";
        }}
      />
      {isSharedGitHubPagesOrigin && (
        <aside
          className="origin-privacy-warning origin-privacy-warning--evidence"
          aria-label="Public demo evidence warning"
        >
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            <strong>Use synthetic or non-sensitive images on this public demo.</strong> Its browser
            storage shares the owner’s <code>github.io</code> origin; use a dedicated origin for
            private evidence.
          </span>
        </aside>
      )}
      <button
        className={`drop-zone${dragging ? " is-dragging" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
      >
        <Upload size={17} />
        <span>
          <strong>Add a local image</strong>
          <small>JPEG, PNG or WebP · 20 MB maximum</small>
        </span>
      </button>
      {evidence.length === 0 ? (
        <EmptyState icon={FileImage} title="No evidence yet">
          Images stay in this browser. Structured exports do not include image bytes; keep source
          files separately.
        </EmptyState>
      ) : (
        <div className="evidence-grid" role="list" aria-label="Evidence images">
          {evidence.map((asset) => (
            <div key={asset.id} role="listitem">
              <EvidenceTile
                asset={asset}
                {...(props.evidenceUrls?.[asset.id]
                  ? { imageUrl: props.evidenceUrls[asset.id] }
                  : {})}
                selected={asset.id === selected?.id}
                onSelect={() => props.onSelect("evidence", asset.id)}
              />
            </div>
          ))}
        </div>
      )}
      {selected && (
        <section className="evidence-detail">
          <EvidencePreviewEditor
            key={`preview-${selected.id}`}
            asset={selected}
            {...(selectedImageUrl ? { imageUrl: selectedImageUrl } : {})}
            onUpdate={props.onUpdateEvidence}
          />
          <h3>{selected.name}</h3>
          <p>{selected.notes ?? "No notes recorded."}</p>
          <dl className="provenance-grid">
            <div>
              <dt>Type</dt>
              <dd>{selected.mimeType.replace("image/", "").toUpperCase()}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{(selected.sizeBytes / 1024).toFixed(0)} KB</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{selected.source.replaceAll("-", " ")}</dd>
            </div>
            <div>
              <dt>Links</dt>
              <dd>{evidenceCurrentLinks(selected, props.replayCase).length}</dd>
            </div>
            <div>
              <dt>Captured</dt>
              <dd>
                {selected.capturedAt
                  ? new Date(selected.capturedAt).toLocaleString()
                  : "Not recorded"}
              </dd>
            </div>
            <div>
              <dt>Annotations</dt>
              <dd>{selected.annotations.length}</dd>
            </div>
            <div>
              <dt>Annotation links</dt>
              <dd>{selected.annotationLinks.length}</dd>
            </div>
          </dl>
          <EvidenceMetadataEditor
            key={JSON.stringify([
              "metadata",
              selected.id,
              selected.capturedAt ?? null,
              selected.notes ?? null,
              selected.tags,
            ])}
            asset={selected}
            onUpdate={props.onUpdateEvidence}
          />
          <EvidenceLinkControl
            key={`link-${selected.id}`}
            asset={selected}
            replayCase={props.replayCase}
            onLink={props.onLinkEvidence}
          />
          <EvidenceCurrentLinks
            asset={selected}
            replayCase={props.replayCase}
            onUnlink={props.onUnlinkEvidence}
          />
          <button className="danger-text-button" onClick={() => setPendingDelete(selected.id)}>
            <Trash2 size={14} /> Delete local evidence
          </button>
        </section>
      )}
      {pendingDelete && (
        <ConfirmDialog
          title="Delete this evidence?"
          description="The local image and its active links will be removed. The historical activity record remains."
          confirmLabel="Delete evidence"
          destructive
          onCancel={() => setPendingDelete(undefined)}
          onConfirm={() => {
            void props.onDeleteEvidence(pendingDelete);
            setPendingDelete(undefined);
          }}
        />
      )}
    </>
  );
}

function EvidencePreviewEditor({
  asset,
  imageUrl,
  onUpdate,
}: {
  asset: EvidenceAsset;
  imageUrl?: string | undefined;
  onUpdate: InspectorPanelProps["onUpdateEvidence"];
}) {
  const [annotationMode, setAnnotationMode] = useState<"point" | "rectangle">();
  const previewRef = useRef<HTMLDivElement>(null);
  const pointModeButtonRef = useRef<HTMLButtonElement>(null);
  const rectangleModeButtonRef = useRef<HTMLButtonElement>(null);
  const annotationInstructionId = useId();

  useEffect(() => {
    if (annotationMode) previewRef.current?.focus();
  }, [annotationMode]);

  function addAnnotationAt(x: number, y: number, width = 0.2, height = 0.16) {
    if (!annotationMode) return;
    const safeX = Math.max(0, Math.min(1, x));
    const safeY = Math.max(0, Math.min(1, y));
    const id = `annotation-${crypto.randomUUID()}`;
    const annotation: EvidenceAnnotation =
      annotationMode === "point"
        ? {
            id,
            kind: "point",
            x: safeX,
            y: safeY,
            label: `Point ${asset.annotations.length + 1}`,
          }
        : {
            id,
            kind: "rectangle",
            x: safeX,
            y: safeY,
            width: Math.max(0.01, Math.min(width, 1 - safeX)),
            height: Math.max(0.01, Math.min(height, 1 - safeY)),
            label: `Area ${asset.annotations.length + 1}`,
          };
    const added = onUpdate(asset.id, { annotations: [...asset.annotations, annotation] });
    if (added) {
      const completedMode = annotationMode;
      setAnnotationMode(undefined);
      (completedMode === "point" ? pointModeButtonRef : rectangleModeButtonRef).current?.focus();
    }
  }

  function addAnnotation(event: React.PointerEvent<HTMLDivElement>) {
    if (!annotationMode) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    if (annotationMode === "point") addAnnotationAt(x, y);
    else addAnnotationAt(x - 0.1, y - 0.08);
  }

  function addAnnotationWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!annotationMode || event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    if (annotationMode === "point") addAnnotationAt(0.5, 0.5);
    else addAnnotationAt(0.4, 0.42);
  }

  return (
    <>
      <div
        ref={previewRef}
        className={`evidence-preview${annotationMode ? " is-annotating" : ""}`}
        role={annotationMode ? "button" : undefined}
        tabIndex={annotationMode ? 0 : undefined}
        aria-label={
          annotationMode ? `Click the image to add a ${annotationMode} annotation` : undefined
        }
        aria-describedby={annotationMode ? annotationInstructionId : undefined}
        onPointerDown={addAnnotation}
        onKeyDown={addAnnotationWithKeyboard}
      >
        {imageUrl ? (
          <img src={imageUrl} alt={`Preview of ${asset.name}`} />
        ) : (
          <ImageIcon size={34} />
        )}
        {asset.annotations.map((annotation) =>
          annotation.kind === "point" ? (
            <span
              key={annotation.id}
              className="evidence-annotation evidence-annotation--point"
              style={{ left: `${annotation.x * 100}%`, top: `${annotation.y * 100}%` }}
              title={annotation.label ?? "Point annotation"}
            />
          ) : (
            <span
              key={annotation.id}
              className="evidence-annotation evidence-annotation--rectangle"
              style={{
                left: `${annotation.x * 100}%`,
                top: `${annotation.y * 100}%`,
                width: `${annotation.width * 100}%`,
                height: `${annotation.height * 100}%`,
              }}
              title={annotation.label ?? "Rectangle annotation"}
            />
          ),
        )}
        {asset.syntheticDemoAsset && <span className="demo-badge">Synthetic demo</span>}
        {annotationMode && (
          <span id={annotationInstructionId} className="annotation-instruction">
            Click or press Enter/Space to place {annotationMode === "point" ? "a point" : "an area"}
          </span>
        )}
      </div>
      <div className="annotation-tools" role="group" aria-label="Evidence annotation tools">
        <button
          ref={pointModeButtonRef}
          type="button"
          className={annotationMode === "point" ? "is-active" : ""}
          aria-pressed={annotationMode === "point"}
          onClick={() =>
            setAnnotationMode((current) => (current === "point" ? undefined : "point"))
          }
        >
          Point
        </button>
        <button
          ref={rectangleModeButtonRef}
          type="button"
          className={annotationMode === "rectangle" ? "is-active" : ""}
          aria-pressed={annotationMode === "rectangle"}
          onClick={() =>
            setAnnotationMode((current) => (current === "rectangle" ? undefined : "rectangle"))
          }
        >
          Rectangle
        </button>
        <span>{asset.annotations.length} marked</span>
      </div>
      {annotationMode && (
        <form
          className="annotation-coordinate-form"
          aria-label={`Place ${annotationMode} annotation by coordinates`}
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const x = requiredNumber(data, "annotation-x") / 100;
            const y = requiredNumber(data, "annotation-y") / 100;
            if (annotationMode === "point") addAnnotationAt(x, y);
            else
              addAnnotationAt(
                x,
                y,
                requiredNumber(data, "annotation-width") / 100,
                requiredNumber(data, "annotation-height") / 100,
              );
          }}
        >
          <label>
            <span>X %</span>
            <input
              name="annotation-x"
              type="number"
              min="0"
              max="100"
              step="0.1"
              defaultValue="50"
              required
            />
          </label>
          <label>
            <span>Y %</span>
            <input
              name="annotation-y"
              type="number"
              min="0"
              max="100"
              step="0.1"
              defaultValue="50"
              required
            />
          </label>
          {annotationMode === "rectangle" && (
            <>
              <label>
                <span>Width %</span>
                <input
                  name="annotation-width"
                  type="number"
                  min="1"
                  max="100"
                  step="0.1"
                  defaultValue="20"
                  required
                />
              </label>
              <label>
                <span>Height %</span>
                <input
                  name="annotation-height"
                  type="number"
                  min="1"
                  max="100"
                  step="0.1"
                  defaultValue="16"
                  required
                />
              </label>
            </>
          )}
          <button className="button button--secondary">Add annotation</button>
        </form>
      )}
      {asset.annotations.length > 0 && (
        <div className="annotation-list" role="list" aria-label="Evidence annotations">
          {asset.annotations.map((annotation) => (
            <div role="listitem" key={annotation.id}>
              <span>{annotation.label ?? annotation.kind}</span>
              <button
                aria-label={`Remove ${annotation.label ?? annotation.kind}`}
                onClick={() =>
                  onUpdate(asset.id, {
                    annotations: asset.annotations.filter((item) => item.id !== annotation.id),
                  })
                }
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function EvidenceMetadataEditor({
  asset,
  onUpdate,
}: {
  asset: EvidenceAsset;
  onUpdate: InspectorPanelProps["onUpdateEvidence"];
}) {
  const [editing, setEditing] = useState(false);
  const [capturedAt, setCapturedAt] = useState(
    asset.capturedAt ? isoDateTimeToLocalInput(asset.capturedAt) : "",
  );
  const [notes, setNotes] = useState(asset.notes ?? "");
  const [tags, setTags] = useState(asset.tags.join(", "));

  function startEditing(): void {
    setCapturedAt(asset.capturedAt ? isoDateTimeToLocalInput(asset.capturedAt) : "");
    setNotes(asset.notes ?? "");
    setTags(asset.tags.join(", "));
    setEditing(true);
  }

  if (!editing)
    return (
      <button className="text-button evidence-edit-button" onClick={startEditing}>
        Edit capture time, notes and tags
      </button>
    );
  return (
    <form
      className="inline-form evidence-metadata-form"
      onSubmit={(event) => {
        event.preventDefault();
        const parsedTags = tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean);
        const updated = onUpdate(asset.id, {
          capturedAt: capturedAt ? new Date(capturedAt).toISOString() : null,
          notes: notes.trim() || null,
          tags: parsedTags,
        });
        if (updated) setEditing(false);
      }}
    >
      <label>
        <span>Capture time</span>
        <input
          type="datetime-local"
          step="0.001"
          value={capturedAt}
          onChange={(event) => setCapturedAt(event.target.value)}
        />
      </label>
      <label>
        <span>Notes</span>
        <textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <label>
        <span>
          Tags <small>comma separated</small>
        </span>
        <input value={tags} onChange={(event) => setTags(event.target.value)} />
      </label>
      <div className="inline-form__actions">
        <button type="button" className="text-button" onClick={() => setEditing(false)}>
          Cancel
        </button>
        <button className="button button--secondary">Save evidence details</button>
      </div>
    </form>
  );
}

function EvidenceTile({
  asset,
  imageUrl,
  selected,
  onSelect,
}: {
  asset: EvidenceAsset;
  imageUrl?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const image = resolveEvidenceImageSource(asset, imageUrl);
  return (
    <button className={`evidence-tile${selected ? " is-selected" : ""}`} onClick={onSelect}>
      {image ? (
        <img src={image} alt="" loading="lazy" width="320" height="240" />
      ) : (
        <FileImage size={24} />
      )}
      <span>{asset.name.replace(/\s*[—-]\s*synthetic demo\.(?:jpg|webp)$/i, "")}</span>
      {asset.syntheticDemoAsset && <em>Demo</em>}
    </button>
  );
}

interface EvidenceLinkOption {
  key: string;
  targetType: EvidenceLinkTargetType;
  targetId: string;
  label: string;
}

interface EvidenceLinkOptionGroup {
  label: string;
  items: EvidenceLinkOption[];
}

function EvidenceCurrentLinks({
  asset,
  replayCase,
  onUnlink,
}: {
  asset: EvidenceAsset;
  replayCase: ReplayCase;
  onUnlink: InspectorPanelProps["onUnlinkEvidence"];
}) {
  const headingId = useId();
  const links = evidenceCurrentLinks(asset, replayCase);
  return (
    <section className="evidence-current-links" aria-labelledby={headingId}>
      <div className="evidence-current-links__heading">
        <strong id={headingId}>Current relationships</strong>
        <span>{links.length} · removable without deleting the image</span>
      </div>
      {links.length === 0 ? (
        <p>No case relationships yet.</p>
      ) : (
        <ul>
          {links.map((link) => (
            <li key={link.key}>
              <Link2 size={13} aria-hidden="true" />
              <span>
                <strong>{link.label}</strong>
                <small>{link.scope}</small>
              </span>
              <button
                type="button"
                aria-label={`Remove ${link.scope.toLowerCase()} link to ${link.label}`}
                title="Remove relationship; the evidence file stays local"
                onClick={() =>
                  onUnlink(asset.id, link.targetType, link.targetId, link.annotationId)
                }
              >
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function compactOptionText(value: string, maxLength = 96): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export function EvidenceLinkControl({
  asset,
  replayCase,
  onLink,
}: {
  asset: EvidenceAsset;
  replayCase: ReplayCase;
  onLink: InspectorPanelProps["onLinkEvidence"];
}) {
  const [target, setTarget] = useState("");
  const [annotationId, setAnnotationId] = useState("");
  const validAnnotationId = asset.annotations.some((annotation) => annotation.id === annotationId)
    ? annotationId
    : "";
  const optionGroups: EvidenceLinkOptionGroup[] = [
    {
      label: "Facts",
      items: replayCase.claims.map((claim) => ({
        key: `claim:${claim.id}`,
        targetType: "claim",
        targetId: claim.id,
        label: compactOptionText(claim.statement),
      })),
    },
    {
      label: "Timeline events",
      items: replayCase.timelineEvents.map((timelineEvent) => ({
        key: `timeline-event:${timelineEvent.id}`,
        targetType: "timeline-event",
        targetId: timelineEvent.id,
        label: compactOptionText(timelineEvent.title),
      })),
    },
    {
      label: "Vehicles",
      items: replayCase.actors.map((actor) => ({
        key: `actor:${actor.id}`,
        targetType: "actor",
        targetId: actor.id,
        label: actor.label,
      })),
    },
    {
      label: "Trajectories",
      items: replayCase.trajectories.map((trajectory) => {
        const actor = replayCase.actors.find((candidate) => candidate.id === trajectory.actorId);
        const branch = replayCase.branches.find(
          (candidate) => candidate.id === trajectory.branchId,
        );
        return {
          key: `trajectory:${trajectory.id}`,
          targetType: "trajectory" as const,
          targetId: trajectory.id,
          label: `${actor?.label ?? trajectory.actorId} · ${branch?.name ?? trajectory.branchId}`,
        };
      }),
    },
    {
      label: "Damage markers",
      items: replayCase.actors.flatMap((actor) =>
        actor.damageMarkers.map((marker) => ({
          key: `damage:${marker.id}`,
          targetType: "damage" as const,
          targetId: marker.id,
          label: compactOptionText(
            `${actor.label} · ${marker.region.replaceAll("-", " ")} · ${marker.description}`,
          ),
        })),
      ),
    },
    {
      label: "Hypothesis branches",
      items: replayCase.branches
        .filter((branch) => branch.status === "active")
        .map((branch) => ({
          key: `hypothesis:${branch.id}`,
          targetType: "hypothesis" as const,
          targetId: branch.id,
          label: branch.name,
        })),
    },
    {
      label: "Assumptions (supporting evidence)",
      items: replayCase.branches
        .filter((branch) => branch.status === "active")
        .flatMap((branch) =>
          branch.assumptions
            .filter((assumption) => assumption.status === "active")
            .map((assumption) => ({
              key: `assumption:${assumption.id}`,
              targetType: "assumption" as const,
              targetId: assumption.id,
              label: compactOptionText(`${branch.name} · ${assumption.statement}`),
            })),
        ),
    },
  ];
  const selectedTarget = optionGroups
    .flatMap((group) => group.items)
    .find((option) => option.key === target);
  return (
    <div className="link-evidence">
      {asset.annotations.length > 0 && (
        <label className="compact-field">
          <span>Evidence scope</span>
          <select
            value={validAnnotationId}
            onChange={(event) => setAnnotationId(event.target.value)}
          >
            <option value="">Whole evidence asset</option>
            {asset.annotations.map((annotation, index) => (
              <option key={annotation.id} value={annotation.id}>
                {annotation.label ??
                  `${annotation.kind === "point" ? "Point" : "Area"} ${index + 1}`}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="compact-field">
        <span>
          <Link2 size={13} /> Link to case item
        </span>
        <select value={target} onChange={(event) => setTarget(event.target.value)}>
          <option value="">Choose an item</option>
          {optionGroups
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.items.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </optgroup>
            ))}
        </select>
      </label>
      <button
        className="button button--secondary"
        disabled={!selectedTarget}
        onClick={() => {
          if (!selectedTarget) return;
          const linked = onLink(
            asset.id,
            selectedTarget.targetType,
            selectedTarget.targetId,
            validAnnotationId || undefined,
          );
          if (linked) setTarget("");
        }}
      >
        {selectedTarget?.targetType === "assumption" ? "Link as supporting evidence" : "Link"}
      </button>
    </div>
  );
}

function QuestionsView(props: InspectorPanelProps) {
  const [adding, setAdding] = useState(false);
  const [question, setQuestion] = useState("");
  const [reason, setReason] = useState("");
  const [importance, setImportance] = useState<OpenQuestion["importance"]>("high");
  const ordered = rankOpenQuestions(props.replayCase.questions);

  function resetQuestionDraft(): void {
    setQuestion("");
    setReason("");
    setImportance("high");
  }

  function closeQuestionDraft(): void {
    resetQuestionDraft();
    setAdding(false);
  }
  return (
    <>
      <SectionHeading
        kicker="Uncertainty register"
        title="Open questions"
        action={
          <button
            className="icon-button"
            onClick={() => {
              if (adding) {
                closeQuestionDraft();
                return;
              }
              resetQuestionDraft();
              setAdding(true);
            }}
            aria-label="Add question"
          >
            <Plus size={17} />
          </button>
        }
      />
      <p className="inspector-intro">
        Ranked by what blocks the report, resolves a conflict, or distinguishes hypotheses.
      </p>
      {adding && (
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            const added = props.onAddQuestion(question, reason, importance);
            if (!added) return;
            closeQuestionDraft();
          }}
        >
          <label>
            <span>Question</span>
            <textarea
              rows={2}
              required
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              autoFocus
            />
          </label>
          <label>
            <span>Why it matters</span>
            <textarea
              rows={2}
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <label>
            <span>Importance</span>
            <select
              value={importance}
              onChange={(event) => setImportance(event.target.value as OpenQuestion["importance"])}
            >
              <option value="blocking">Blocking</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <div className="inline-form__actions">
            <button type="button" className="text-button" onClick={closeQuestionDraft}>
              Cancel
            </button>
            <button className="button button--primary">Add question</button>
          </div>
        </form>
      )}
      <div className="question-list">
        {ordered.map((item, index) => (
          <QuestionItem
            key={JSON.stringify([item.id, item.status, item.answer ?? null])}
            question={item}
            rank={index + 1}
            onUpdate={props.onUpdateQuestion}
            replayCase={props.replayCase}
            onSelect={props.onSelect}
          />
        ))}
        {ordered.length === 0 && (
          <EmptyState icon={CircleHelp} title="No questions recorded">
            Add uncertainties instead of letting missing details become assumptions.
          </EmptyState>
        )}
      </div>
    </>
  );
}

function QuestionItem({
  question,
  rank,
  onUpdate,
  replayCase,
  onSelect,
}: {
  question: OpenQuestion;
  rank: number;
  onUpdate: InspectorPanelProps["onUpdateQuestion"];
  replayCase: ReplayCase;
  onSelect: InspectorPanelProps["onSelect"];
}) {
  const [answering, setAnswering] = useState(false);
  const [answer, setAnswer] = useState(question.answer ?? "");
  const [convert, setConvert] = useState(false);

  function startAnswering(): void {
    setAnswer(question.answer ?? "");
    setConvert(false);
    setAnswering(true);
  }

  function cancelAnswering(): void {
    setAnswer(question.answer ?? "");
    setConvert(false);
    setAnswering(false);
  }
  return (
    <article className={`question-item is-${question.status}`}>
      <header>
        <span className={`importance-badge is-${question.importance}`}>
          #{rank} · {question.importance}
        </span>
        <span className="question-state">{question.status}</span>
      </header>
      <h3>{question.question}</h3>
      <p>{question.reason}</p>
      {question.rankingReasons.length > 0 && (
        <div className="tag-row">
          {question.rankingReasons.map((item) => (
            <span key={item}>{item.replaceAll("-", " ")}</span>
          ))}
        </div>
      )}
      <div
        className="relation-groups relation-groups--question"
        role="group"
        aria-label="Related case items"
      >
        <RelationLinks
          label="Observations"
          ids={question.relatedClaimIds}
          replayCase={replayCase}
          onSelect={onSelect}
        />
        <RelationLinks
          label="Scene and timeline"
          ids={question.relatedSceneObjectIds}
          replayCase={replayCase}
          onSelect={onSelect}
        />
        <RelationLinks
          label="Hypotheses"
          ids={question.relatedBranchIds}
          replayCase={replayCase}
          onSelect={onSelect}
        />
      </div>
      {question.answer && (
        <blockquote>
          <strong>Answer:</strong> {question.answer}
        </blockquote>
      )}
      {question.status === "open" && !answering && (
        <div className="question-actions">
          <button onClick={startAnswering}>Answer</button>
          <button onClick={() => onUpdate(question.id, "deferred")}>Defer</button>
          <button onClick={() => onUpdate(question.id, "dismissed")}>Dismiss</button>
        </div>
      )}
      {question.status === "open" && answering && (
        <form
          className="question-answer"
          onSubmit={(event) => {
            event.preventDefault();
            if (question.status !== "open") return;
            const updated = onUpdate(question.id, "answered", answer, convert);
            if (updated) setAnswering(false);
          }}
        >
          <textarea
            aria-label="Answer"
            rows={3}
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            required
            autoFocus
          />
          <label>
            <input
              type="checkbox"
              checked={convert}
              onChange={(event) => setConvert(event.target.checked)}
            />{" "}
            Also create a reported observation
          </label>
          <div>
            <button type="button" onClick={cancelAnswering}>
              Cancel
            </button>
            <button className="button button--primary">Save answer</button>
          </div>
        </form>
      )}
      {(question.status === "deferred" || question.status === "dismissed") && (
        <button className="text-button" onClick={() => onUpdate(question.id, "open")}>
          <RotateCcw size={13} /> Reopen
        </button>
      )}
    </article>
  );
}

function HypothesesView(props: InspectorPanelProps) {
  const [forkParentId, setForkParentId] = useState<string>();
  const [name, setName] = useState("Alternative path");
  const [description, setDescription] = useState(
    "An alternative reconstruction that preserves shared facts while changing one uncertain movement.",
  );
  const active =
    props.replayCase.branches.find((branch) => branch.id === props.replayCase.activeBranchId) ??
    props.replayCase.branches[0];
  const forkParent = props.replayCase.branches.find(
    (branch) => branch.id === forkParentId && branch.status === "active",
  );
  return (
    <>
      <SectionHeading
        kicker="Alternative reconstructions"
        title="Hypotheses"
        action={
          <button
            className="icon-button"
            onClick={() => {
              if (forkParent) {
                setForkParentId(undefined);
                return;
              }
              if (!active) return;
              setName("Alternative path");
              setDescription(
                "An alternative reconstruction that preserves shared facts while changing one uncertain movement.",
              );
              setForkParentId(active.id);
            }}
            aria-label="Fork hypothesis"
          >
            <GitFork size={17} />
          </button>
        }
      />
      <div className="neutral-callout">
        <Sparkles size={15} />
        <p>Branches are alternatives, not conclusions. Shared confirmed facts remain shared.</p>
      </div>
      {forkParent && (
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            const forked = props.onForkBranch(forkParent.id, name, description);
            if (forked) setForkParentId(undefined);
          }}
        >
          <p>
            Forking from <strong>{forkParent.name}</strong>. Changing the viewed branch will not
            retarget this draft.
          </p>
          <label>
            <span>Branch name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              autoFocus
            />
          </label>
          <label>
            <span>What changes</span>
            <textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              required
            />
          </label>
          <div className="inline-form__actions">
            <button
              type="button"
              className="text-button"
              onClick={() => setForkParentId(undefined)}
            >
              Cancel
            </button>
            <button className="button button--primary">Fork reconstruction</button>
          </div>
        </form>
      )}
      <div className="branch-list">
        {props.replayCase.branches.map((branch, index) => (
          <BranchItem
            key={branch.id}
            branch={branch}
            active={branch.id === props.replayCase.activeBranchId}
            index={index}
            onActivate={props.onSetActiveBranch}
            onRename={props.onRenameBranch}
            onAddAssumption={props.onAddAssumption}
            onUpdateAssumption={props.onUpdateAssumption}
            onArchive={props.onToggleBranchArchive}
          />
        ))}
      </div>
      {props.replayCase.branches.filter((item) => item.status === "active").length >= 2 && (
        <CompareControl
          replayCase={props.replayCase}
          branches={props.replayCase.branches.filter((item) => item.status === "active")}
          selected={props.compareBranchIds}
          onCompare={props.onCompareBranches}
        />
      )}
    </>
  );
}

function BranchItem({
  branch,
  active,
  index,
  onActivate,
  onRename,
  onAddAssumption,
  onUpdateAssumption,
  onArchive,
}: {
  branch: HypothesisBranch;
  active: boolean;
  index: number;
  onActivate: (id: string) => void;
  onRename: (id: string, name: string, description: string) => boolean;
  onAddAssumption: (id: string, text: string) => boolean;
  onUpdateAssumption: (
    branchId: string,
    assumptionId: string,
    update: { statement?: string; status?: "active" | "withdrawn" },
  ) => boolean;
  onArchive: (branch: HypothesisBranch) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [editingBranch, setEditingBranch] = useState(false);
  const [branchName, setBranchName] = useState(branch.name);
  const [branchDescription, setBranchDescription] = useState(branch.description);
  const [editingAssumptionId, setEditingAssumptionId] = useState<string>();
  const [assumptionText, setAssumptionText] = useState("");
  return (
    <article
      className={`branch-item branch-color-${index % 3}${active ? " is-active" : ""}${branch.status === "archived" ? " is-archived" : ""}`}
    >
      <header>
        <span className="branch-swatch" />
        <div>
          <small>{branch.parentBranchId ? "Forked hypothesis" : "Baseline"}</small>
          <h3>{branch.name}</h3>
        </div>
        {active && (
          <span className="active-label">
            <Eye size={12} /> Active
          </span>
        )}
      </header>
      {editingBranch ? (
        <form
          className="inline-form"
          aria-label={`Edit ${branch.name}`}
          onSubmit={(event) => {
            event.preventDefault();
            const renamed = onRename(branch.id, branchName, branchDescription);
            if (renamed) setEditingBranch(false);
          }}
        >
          <label>
            <span>Branch name</span>
            <input
              value={branchName}
              onChange={(event) => setBranchName(event.target.value)}
              required
              autoFocus
            />
          </label>
          <label>
            <span>Description</span>
            <textarea
              rows={3}
              value={branchDescription}
              onChange={(event) => setBranchDescription(event.target.value)}
              required
            />
          </label>
          <div className="inline-form__actions">
            <button type="button" className="text-button" onClick={() => setEditingBranch(false)}>
              Cancel
            </button>
            <button className="button button--primary">Save branch</button>
          </div>
        </form>
      ) : (
        <p>{branch.description}</p>
      )}
      {branch.assumptions.map((item) => {
        const evidenceCount = new Set([
          ...item.supportingEvidenceIds,
          ...item.conflictingEvidenceIds,
        ]).size;
        return (
          <div
            className={`assumption${item.status === "withdrawn" ? " is-withdrawn" : ""}`}
            key={item.id}
          >
            <Sparkles size={12} />
            <div>
              {editingAssumptionId === item.id ? (
                <form
                  className="assumption-form"
                  aria-label={`Edit assumption in ${branch.name}`}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const updated = onUpdateAssumption(branch.id, item.id, {
                      statement: assumptionText,
                    });
                    if (updated) setEditingAssumptionId(undefined);
                  }}
                >
                  <input
                    value={assumptionText}
                    onChange={(event) => setAssumptionText(event.target.value)}
                    aria-label="Assumption statement"
                    required
                    autoFocus
                  />
                  <button className="icon-button icon-button--small" aria-label="Save assumption">
                    <Check size={14} />
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setEditingAssumptionId(undefined)}
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <span>{item.statement}</span>
              )}
              <small
                className={`assumption__provenance${evidenceCount === 0 ? " is-missing" : ""}`}
              >
                {evidenceCount === 0 ? (
                  <>
                    <AlertTriangle size={12} /> No evidence linked. Add support from Evidence.
                  </>
                ) : (
                  <>
                    <ShieldCheck size={12} /> {evidenceCount} evidence{" "}
                    {evidenceCount === 1 ? "source" : "sources"}
                  </>
                )}
              </small>
              {branch.status === "active" && editingAssumptionId !== item.id && (
                <span className="assumption__actions">
                  <button
                    className="text-button"
                    onClick={() => {
                      setAssumptionText(item.statement);
                      setEditingAssumptionId(item.id);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="text-button"
                    onClick={() =>
                      onUpdateAssumption(branch.id, item.id, {
                        status: item.status === "withdrawn" ? "active" : "withdrawn",
                      })
                    }
                  >
                    {item.status === "withdrawn" ? "Restore" : "Withdraw"}
                  </button>
                </span>
              )}
            </div>
          </div>
        );
      })}
      {adding && (
        <form
          className="assumption-form"
          onSubmit={(event) => {
            event.preventDefault();
            const added = onAddAssumption(branch.id, text);
            if (!added) return;
            setText("");
            setAdding(false);
          }}
        >
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="State the alternative assumption"
            aria-label="Alternative assumption"
            required
            autoFocus
          />
          <button className="icon-button icon-button--small" aria-label="Save assumption">
            <Check size={14} />
          </button>
        </form>
      )}
      <footer>
        {branch.status === "active" && (
          <button
            onClick={() => {
              setBranchName(branch.name);
              setBranchDescription(branch.description);
              setEditingBranch(true);
            }}
          >
            Edit branch
          </button>
        )}
        {branch.status === "active" && !active && (
          <button onClick={() => onActivate(branch.id)}>View branch</button>
        )}
        {branch.status === "active" && (
          <button onClick={() => setAdding(true)}>
            <Plus size={12} /> Assumption
          </button>
        )}
        <button onClick={() => onArchive(branch)}>
          {branch.status === "archived" ? <RotateCcw size={12} /> : <Archive size={12} />}
          {branch.status === "archived" ? "Restore" : "Archive"}
        </button>
      </footer>
    </article>
  );
}

function CompareControl({
  replayCase,
  branches,
  selected,
  onCompare,
}: {
  replayCase: ReplayCase;
  branches: HypothesisBranch[];
  selected: string[];
  onCompare: (ids: string[]) => void;
}) {
  const [a, setA] = useState(selected[0] ?? branches[0]?.id ?? "");
  const [b, setB] = useState(selected[1] ?? branches[1]?.id ?? "");
  const activeBranchIds = new Set(branches.map((branch) => branch.id));
  const firstSelected = activeBranchIds.has(selected[0] ?? "") ? selected[0] : undefined;
  const secondSelected = activeBranchIds.has(selected[1] ?? "") ? selected[1] : undefined;
  const effectiveA = activeBranchIds.has(a) ? a : (firstSelected ?? branches[0]?.id ?? "");
  const effectiveB =
    activeBranchIds.has(b) && b !== effectiveA
      ? b
      : secondSelected && secondSelected !== effectiveA
        ? secondSelected
        : (branches.find((branch) => branch.id !== effectiveA)?.id ?? "");
  const comparisonActive =
    Boolean(firstSelected) && Boolean(secondSelected) && firstSelected !== secondSelected;
  const comparison =
    comparisonActive && firstSelected && secondSelected
      ? compareHypotheses(replayCase, firstSelected, secondSelected)
      : undefined;
  return (
    <section className="compare-control">
      <h3>
        <GitCompareArrows size={15} /> Compare paths
      </h3>
      <div>
        <select
          aria-label="First branch"
          value={effectiveA}
          onChange={(event) => setA(event.target.value)}
        >
          {branches.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <span>with</span>
        <select
          aria-label="Second branch"
          value={effectiveB}
          onChange={(event) => setB(event.target.value)}
        >
          {branches.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      <button
        className="button button--secondary button--full"
        disabled={!comparisonActive && (!effectiveA || !effectiveB || effectiveA === effectiveB)}
        onClick={() => onCompare(comparisonActive ? [] : [effectiveA, effectiveB])}
      >
        {comparisonActive ? "Stop comparison" : "Compare side by side"}
      </button>
      {comparison && (
        <>
          <div className="comparison-columns">
            {comparison.branchIds.map((branchId) => {
              const branch = replayCase.branches.find((item) => item.id === branchId);
              return (
                <article key={branchId}>
                  <small>{branch?.name ?? branchId}</small>
                  <p>{comparison.summaries[branchId]}</p>
                  <dl>
                    <div>
                      <dt>Support</dt>
                      <dd>{comparison.supportingEvidenceIds[branchId]?.length ?? 0}</dd>
                    </div>
                    <div>
                      <dt>Conflicts</dt>
                      <dd>{comparison.conflictingEvidenceIds[branchId]?.length ?? 0}</dd>
                    </div>
                    <div>
                      <dt>Questions</dt>
                      <dd>{comparison.unresolvedQuestionIds[branchId]?.length ?? 0}</dd>
                    </div>
                  </dl>
                </article>
              );
            })}
          </div>
          <p className="comparison-differences">
            Different geometry for {comparison.changedTrajectoryActorIds.length} actor
            {comparison.changedTrajectoryActorIds.length === 1 ? "" : "s"};{" "}
            {comparison.changedEventIds.length} event record
            {comparison.changedEventIds.length === 1 ? "" : "s"} differ. The canvas overlays both
            paths without ranking either one.
          </p>
        </>
      )}
    </section>
  );
}

function ConsistencyIssueRow({
  issue,
  focused,
  onFocus,
}: {
  issue: ConsistencyIssue;
  focused: boolean;
  onFocus: (issue: ConsistencyIssue) => void;
}) {
  const rowRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!focused) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rowRef.current?.scrollIntoView({
      block: "nearest",
      behavior: reduceMotion ? "auto" : "smooth",
    });
    rowRef.current?.focus({ preventScroll: true });
  }, [focused]);
  return (
    <button
      ref={rowRef}
      className={`issue-row is-${issue.severity}${focused ? " is-focused" : ""}`}
      aria-current={focused ? "true" : undefined}
      onClick={() => onFocus(issue)}
    >
      <span>{issue.severity === "error" ? "!" : issue.severity === "warning" ? "△" : "?"}</span>
      <div>
        <small className="issue-row__scope">
          {issue.scope} · {issue.ruleId}
        </small>
        <strong>{issue.title}</strong>
        <p>{issue.explanation}</p>
      </div>
    </button>
  );
}

interface CompletenessReviewProps {
  replayCase: ReplayCase;
  onAttest: (attestation: CompletenessAttestationInput) => boolean;
  onWithdraw: (attestationId: string) => boolean;
}

function attestationTime(value: string): string {
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function CompletenessReview({ replayCase, onAttest, onWithdraw }: CompletenessReviewProps) {
  const activeEvidenceCount = replayCase.evidence.filter((asset) => !asset.deleted).length;
  const unresolvedQuestionCount = replayCase.questions.filter(
    (question) => question.status === "open" || question.status === "deferred",
  ).length;
  const noEvidenceSubject = { kind: "no-evidence-supplied" } as const;
  const uncertaintySubject = { kind: "uncertainty-review-completed" } as const;
  const noEvidenceRecord = findCompletenessAttestation(replayCase, noEvidenceSubject);
  const currentNoEvidenceRecord =
    noEvidenceRecord && isCompletenessAttestationCurrent(replayCase, noEvidenceRecord)
      ? noEvidenceRecord
      : undefined;
  const uncertaintyRecord = findCompletenessAttestation(replayCase, uncertaintySubject);
  const currentUncertaintyRecord =
    uncertaintyRecord && isCompletenessAttestationCurrent(replayCase, uncertaintyRecord)
      ? uncertaintyRecord
      : undefined;

  return (
    <section className="completeness-review" aria-labelledby="completeness-review-title">
      <header>
        <div>
          <small>Human actions only</small>
          <h3 id="completeness-review-title">Completeness review</h3>
        </div>
        <ShieldCheck size={18} aria-hidden="true" />
      </header>
      <p className="completeness-review__intro">
        Close legitimate gaps without inventing evidence. These records document what a person
        reviewed; they are not evidence or factual findings.
      </p>

      <article className="completeness-review__item">
        <div className="completeness-review__item-heading">
          <strong>Evidence supplied</strong>
          {activeEvidenceCount > 0 ? (
            <span className="completeness-review__status is-complete">
              <Check size={12} aria-hidden="true" /> {formatCount(activeEvidenceCount, "item")}{" "}
              indexed
            </span>
          ) : currentNoEvidenceRecord ? (
            <span className="completeness-review__status is-attested">
              <ShieldCheck size={12} aria-hidden="true" /> Human recorded
            </span>
          ) : (
            <span className="completeness-review__status is-pending">Needs human review</span>
          )}
        </div>
        {activeEvidenceCount > 0 ? (
          <p>The evidence index is populated. A no-evidence record is not available.</p>
        ) : currentNoEvidenceRecord ? (
          <>
            <p>
              No evidence was supplied for this local case, recorded by a human on{" "}
              {attestationTime(currentNoEvidenceRecord.attestedAt)}. This does not establish that
              evidence does not exist.
            </p>
            <button
              type="button"
              className="text-button"
              onClick={() => onWithdraw(currentNoEvidenceRecord.id)}
            >
              Withdraw no-evidence record
            </button>
          </>
        ) : (
          <>
            <p>
              No evidence is indexed. Record this only if none was supplied; it does not mean
              evidence does not exist.
            </p>
            {noEvidenceRecord && (
              <p className="completeness-review__stale" role="status">
                A previous or imported record is not current. Review this case again locally.
              </p>
            )}
            <button
              type="button"
              className="button button--secondary"
              onClick={() => onAttest(noEvidenceSubject)}
            >
              {noEvidenceRecord ? "Review and record again" : "Record no evidence supplied"}
            </button>
          </>
        )}
      </article>

      <article className="completeness-review__item">
        <div className="completeness-review__item-heading">
          <strong>Damage review</strong>
          <span className="completeness-review__status">
            {formatCount(replayCase.actors.length, "vehicle")}
          </span>
        </div>
        <div className="completeness-review__actors">
          {replayCase.actors.map((actor) => {
            const subject = {
              kind: "actor-damage",
              actorId: actor.id,
              outcome: "unknown",
            } as const;
            const record = findCompletenessAttestation(replayCase, subject);
            const currentRecord =
              record &&
              isCompletenessAttestationCurrent(replayCase, record) &&
              record.kind === "actor-damage"
                ? record
                : undefined;
            return (
              <section key={actor.id} aria-label={`${actor.label} damage review`}>
                <strong>{actor.label}</strong>
                {actor.damageMarkers.length > 0 ? (
                  <p>
                    {formatCount(actor.damageMarkers.length, "damage marker")} recorded. No
                    completeness attestation is needed.
                  </p>
                ) : currentRecord ? (
                  <>
                    <p>
                      A human recorded damage as{" "}
                      <b>{currentRecord.outcome === "unknown" ? "unknown" : "not assessed"}</b> on{" "}
                      {attestationTime(currentRecord.attestedAt)}.
                    </p>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => onWithdraw(currentRecord.id)}
                    >
                      Withdraw {actor.label} damage record
                    </button>
                  </>
                ) : (
                  <>
                    <p>
                      No damage marker is recorded. Choose “unknown” when available information does
                      not establish damage location or state. Choose “not assessed” when no damage
                      assessment was performed.
                    </p>
                    {record && (
                      <p className="completeness-review__stale" role="status">
                        A previous or imported record needs fresh local review.
                      </p>
                    )}
                    <div className="completeness-review__actions">
                      <button
                        type="button"
                        className="button button--secondary"
                        onClick={() =>
                          onAttest({ kind: "actor-damage", actorId: actor.id, outcome: "unknown" })
                        }
                      >
                        Record {actor.label} damage as unknown
                      </button>
                      <button
                        type="button"
                        className="button button--secondary"
                        onClick={() =>
                          onAttest({
                            kind: "actor-damage",
                            actorId: actor.id,
                            outcome: "not-assessed",
                          })
                        }
                      >
                        Record {actor.label} damage as not assessed
                      </button>
                    </div>
                  </>
                )}
              </section>
            );
          })}
        </div>
      </article>

      <article className="completeness-review__item">
        <div className="completeness-review__item-heading">
          <strong>Uncertainty review</strong>
          {unresolvedQuestionCount > 0 ? (
            <span className="completeness-review__status is-complete">
              {formatCount(unresolvedQuestionCount, "open or deferred question")}
            </span>
          ) : currentUncertaintyRecord ? (
            <span className="completeness-review__status is-attested">
              <ShieldCheck size={12} aria-hidden="true" /> Human reviewed
            </span>
          ) : (
            <span className="completeness-review__status is-pending">Needs human review</span>
          )}
        </div>
        {unresolvedQuestionCount > 0 ? (
          <p>Open or deferred questions already keep unresolved details visible in the report.</p>
        ) : currentUncertaintyRecord ? (
          <>
            <p>
              A human completed the uncertainty review on{" "}
              {attestationTime(currentUncertaintyRecord.attestedAt)}. This record does not make
              unknown information certain.
            </p>
            <button
              type="button"
              className="text-button"
              onClick={() => onWithdraw(currentUncertaintyRecord.id)}
            >
              Withdraw uncertainty review
            </button>
          </>
        ) : (
          <>
            <p>
              Review Facts, Evidence, and Questions first. Record completion only when no unresolved
              detail still needs an open or deferred question.
            </p>
            {uncertaintyRecord && (
              <p className="completeness-review__stale" role="status">
                A previous or imported review is not current. Review the register again locally.
              </p>
            )}
            <button
              type="button"
              className="button button--secondary"
              onClick={() => onAttest(uncertaintySubject)}
            >
              {uncertaintyRecord
                ? "Review and record uncertainty again"
                : "Record uncertainty review complete"}
            </button>
          </>
        )}
      </article>
    </section>
  );
}

function ReportView(props: InspectorPanelProps) {
  const [note, setNote] = useState("");
  const [noteClaimId, setNoteClaimId] = useState("");
  const [noteEvidenceId, setNoteEvidenceId] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewFingerprint, setReviewFingerprint] = useState<string>();
  const [toolPrepared, setToolPrepared] = useState(false);
  const preview = props.reportPreview;
  const selectedSnapshot = props.selectedReportSnapshotId
    ? props.replayCase.reportSnapshots.find(
        (snapshot) => snapshot.id === props.selectedReportSnapshotId,
      )
    : undefined;
  const reviewBindingFingerprint = preview?.reviewBinding?.fingerprint;
  const blockingConsistencyErrors = props.replayCase.consistencyIssues.filter(
    (issue) => issue.severity === "error",
  );
  const currentPreviewErrors = useMemo(
    () =>
      preview && !selectedSnapshot
        ? validateCurrentReportPreview(props.replayCase, preview).filter(
            (issue) => issue.severity === "error",
          )
        : [],
    [preview, props.replayCase, selectedSnapshot],
  );
  const previewHasValidBinding = preview ? reportPreviewHasValidReviewBinding(preview) : false;
  const previewCanBeFinalized = preview
    ? !selectedSnapshot &&
      previewHasValidBinding &&
      preview.missingRequirements.length === 0 &&
      blockingConsistencyErrors.length === 0 &&
      currentPreviewErrors.length === 0
    : false;
  const finalizationHelp = selectedSnapshot
    ? "This immutable snapshot is historical and cannot be finalized again."
    : !preview
      ? "Build a current preview before starting the human finalization review."
      : !previewHasValidBinding
        ? "Build a fresh preview before review. This preview is not securely bound to its visible content."
        : preview.missingRequirements.length > 0
          ? `Resolve the ${String(preview.missingRequirements.length)} missing requirement${preview.missingRequirements.length === 1 ? "" : "s"} listed in the preview before review.`
          : blockingConsistencyErrors.length > 0
            ? `Resolve the ${String(blockingConsistencyErrors.length)} consistency error${blockingConsistencyErrors.length === 1 ? "" : "s"} above before review.`
            : currentPreviewErrors.length > 0
              ? `Resolve the ${String(currentPreviewErrors.length)} invalid report citation${currentPreviewErrors.length === 1 ? "" : "s"} before review.`
              : "Finalization requires a visible human review and a manual confirmation.";
  const finalizationToolRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = finalizationToolRef.current;
    if (!form) return;
    const activated = () => {
      setToolPrepared(true);
      setReviewFingerprint(reviewBindingFingerprint);
      setReviewOpen(true);
    };
    const cancelled = () => setToolPrepared(false);
    form.addEventListener("toolactivated", activated);
    form.addEventListener("toolcancel", cancelled);
    return () => {
      form.removeEventListener("toolactivated", activated);
      form.removeEventListener("toolcancel", cancelled);
    };
  }, [reviewBindingFingerprint]);
  return (
    <>
      <SectionHeading
        kicker="Neutral factual account"
        title="Report"
        action={
          selectedSnapshot ? undefined : (
            <button
              className="icon-button"
              onClick={props.onValidate}
              aria-label="Run consistency check"
            >
              <SearchCheck size={17} />
            </button>
          )
        }
      />
      {selectedSnapshot ? (
        <section className="snapshot-view-boundary" role="note">
          <LockKeyhole size={17} />
          <div>
            <strong>Historical snapshot view</strong>
            <p>
              Current-case validation and review notes are hidden here. Build a current draft to
              inspect or change the live case; this snapshot will remain unchanged.
            </p>
          </div>
        </section>
      ) : (
        <>
          <CompletenessReview
            replayCase={props.replayCase}
            onAttest={props.onAttestCompleteness}
            onWithdraw={props.onWithdrawCompleteness}
          />
          <div
            className={`validation-summary${props.replayCase.consistencyIssues.some((item) => item.severity === "error") ? " has-errors" : ""}`}
          >
            <AlertTriangle size={17} />
            <div>
              <strong>
                {formatCount(props.replayCase.consistencyIssues.length, "consistency item")}
              </strong>
              <span>
                {formatCount(
                  props.replayCase.consistencyIssues.filter((item) => item.severity === "error")
                    .length,
                  "error",
                )}{" "}
                ·{" "}
                {formatCount(
                  props.replayCase.consistencyIssues.filter((item) => item.severity === "warning")
                    .length,
                  "warning",
                )}{" "}
                ·{" "}
                {formatCount(
                  props.replayCase.consistencyIssues.filter((item) => item.severity === "question")
                    .length,
                  "question",
                )}
              </span>
            </div>
            <button onClick={props.onValidate}>Run again</button>
          </div>
          <div className="issue-list">
            {props.replayCase.consistencyIssues.map((issue) => (
              <ConsistencyIssueRow
                key={issue.id}
                issue={issue}
                focused={props.focusedIssueId === issue.id}
                onFocus={props.onFocusIssue}
              />
            ))}
          </div>
        </>
      )}
      <ReportSnapshotHistory
        snapshots={props.replayCase.reportSnapshots}
        selectedSnapshotId={props.selectedReportSnapshotId}
        onOpen={props.onOpenReportSnapshot}
        onExport={props.onExportReportSnapshot}
        exportDisabled={props.exportInFlight !== undefined}
      />
      {!preview ? (
        <div className="report-build">
          <FileText size={25} />
          <h3>Build an evidence-bound preview</h3>
          <p>
            Confirmed observations are limited to human-confirmed claims. Uncertainty and hypotheses
            stay labelled.
          </p>
          <button className="button button--primary button--full" onClick={props.onBuildReport}>
            Build report preview
          </button>
        </div>
      ) : (
        <>
          <ReportPreviewView preview={preview} snapshot={selectedSnapshot} />
          {selectedSnapshot && (
            <button className="text-button report-build-current" onClick={props.onBuildReport}>
              Build a current draft preview
            </button>
          )}
        </>
      )}
      {preview && !selectedSnapshot && (
        <div className="finalize-action">
          <form
            ref={finalizationToolRef}
            className={`finalize-tool-form${toolPrepared && reviewFingerprint === reviewBindingFingerprint ? " is-tool-prepared" : ""}`}
            toolname="finalize_factual_report"
            tooldescription="Prepare and focus the visible REPLAY human review. Never submit, confirm, or finalize automatically."
            onSubmit={(event) => {
              event.preventDefault();
              setReviewFingerprint(reviewBindingFingerprint);
              setReviewOpen(true);
            }}
          >
            <button
              className="button button--primary button--full finalize-button"
              disabled={!previewCanBeFinalized}
            >
              <ShieldCheck size={16} /> Review and finalize
            </button>
            {toolPrepared && reviewFingerprint === reviewBindingFingerprint && (
              <span role="status">
                <Sparkles size={12} /> Site Tools prepared this review. A person must complete every
                next step.
              </span>
            )}
          </form>
          <p className="finalize-help">{finalizationHelp}</p>
        </div>
      )}
      {!selectedSnapshot && (
        <>
          <form
            className="report-note-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!note.trim() || (!noteClaimId && !noteEvidenceId)) return;
              const added = props.onAddReportNote(
                note.trim(),
                noteClaimId ? [noteClaimId] : [],
                noteEvidenceId ? [noteEvidenceId] : [],
              );
              if (!added) return;
              setNote("");
              setNoteClaimId("");
              setNoteEvidenceId("");
            }}
          >
            <label>
              <span>Add a review note</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                maxLength={REPORT_NOTE_MAX_LENGTH}
                aria-describedby="report-note-character-count report-note-source-requirement"
                placeholder="Add context without changing the underlying facts"
              />
              <small id="report-note-character-count" className="report-note-character-count">
                {(REPORT_NOTE_MAX_LENGTH - note.length).toLocaleString()} characters remaining
              </small>
            </label>
            <label>
              <span>Supporting observation</span>
              <select value={noteClaimId} onChange={(event) => setNoteClaimId(event.target.value)}>
                <option value="">None selected</option>
                {props.replayCase.claims.map((claim) => (
                  <option key={claim.id} value={claim.id}>
                    {claim.statement}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Supporting evidence</span>
              <select
                value={noteEvidenceId}
                onChange={(event) => setNoteEvidenceId(event.target.value)}
              >
                <option value="">None selected</option>
                {props.replayCase.evidence
                  .filter((asset) => !asset.deleted)
                  .map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}
                    </option>
                  ))}
              </select>
            </label>
            <small id="report-note-source-requirement">
              Choose at least one source. REPLAY never attaches a citation silently.
            </small>
            <button
              type="submit"
              className="button button--secondary"
              disabled={!note.trim() || (!noteClaimId && !noteEvidenceId)}
            >
              <MessageSquareText size={14} /> Add note
            </button>
          </form>
          {props.replayCase.reportNotes.length > 0 && (
            <div className="report-notes">
              <h3>Review notes</h3>
              {props.replayCase.reportNotes.map((item) => (
                <article key={item.id}>
                  <p>{item.text}</p>
                  <p className="report-note-citations">
                    Sources: {[...item.claimIds, ...item.evidenceIds].join(", ")}
                  </p>
                  <footer>
                    <span>
                      {item.createdBy === "agent" ? (
                        <>
                          <Sparkles size={11} /> Agent draft
                        </>
                      ) : (
                        "Human note"
                      )}
                    </span>
                    {item.reviewedByHuman ? (
                      <span className="reviewed-label">
                        <Check size={11} /> Human reviewed
                      </span>
                    ) : (
                      <>
                        <button onClick={() => props.onReviewReportNote(item.id, true)}>
                          Approve
                        </button>
                        <button onClick={() => props.onReviewReportNote(item.id, false)}>
                          Reject
                        </button>
                      </>
                    )}
                  </footer>
                </article>
              ))}
            </div>
          )}
        </>
      )}
      <section
        className="export-section"
        aria-busy={props.exportInFlight === undefined ? undefined : true}
      >
        <h3>Export local case</h3>
        <p className="structured-transfer-note">
          JSON transfer contains structured case data only; evidence image files are not included.
        </p>
        {selectedSnapshot && (
          <p className="snapshot-export-note">
            Snapshot PDF includes only the reviewed report. The live scene is intentionally
            excluded; export the current scene separately as SVG or PNG if needed.
          </p>
        )}
        <div className="export-grid">
          <button onClick={props.onExportPdf} disabled={props.exportInFlight !== undefined}>
            <FileText size={16} />
            {props.exportInFlight === "pdf"
              ? "Preparing PDF…"
              : selectedSnapshot
                ? "PDF snapshot"
                : "PDF draft"}
          </button>
          <button onClick={props.onExportJson} disabled={props.exportInFlight !== undefined}>
            <FileJson size={16} /> JSON transfer
          </button>
          <button
            onClick={() => props.onExportScene("svg")}
            disabled={props.exportInFlight !== undefined}
          >
            <FileImage size={16} /> SVG
          </button>
          <button
            onClick={() => props.onExportScene("png")}
            disabled={props.exportInFlight !== undefined}
          >
            <ImageIcon size={16} />
            {props.exportInFlight === "scene" ? "Preparing image…" : "PNG"}
          </button>
        </div>
      </section>
      {reviewOpen &&
        preview &&
        previewCanBeFinalized &&
        reviewFingerprint === reviewBindingFingerprint && (
          <FinalizationDialog
            preview={preview}
            onCancel={() => setReviewOpen(false)}
            onFinalize={() => {
              const finalized = props.onFinalizeReport(preview);
              if (finalized) setReviewOpen(false);
              return finalized;
            }}
          />
        )}
    </>
  );
}

function ReportSnapshotHistory({
  snapshots,
  selectedSnapshotId,
  onOpen,
  onExport,
  exportDisabled,
}: {
  snapshots: ReportSnapshot[];
  selectedSnapshotId?: string | undefined;
  onOpen: (snapshotId: string) => void;
  onExport: (snapshotId: string) => void;
  exportDisabled: boolean;
}) {
  const ordered = [...snapshots].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
  return (
    <section className="report-history" aria-labelledby="report-history-title">
      <header>
        <h3 id="report-history-title">Finalized snapshot history</h3>
        <span>{ordered.length}</span>
      </header>
      {ordered.length === 0 ? (
        <p>No immutable snapshots yet. PDF export is visibly marked as a draft.</p>
      ) : (
        <div className="report-history__list" role="list">
          {ordered.map((snapshot) => {
            const selected = snapshot.id === selectedSnapshotId;
            return (
              <article
                key={snapshot.id}
                className={selected ? "is-selected" : undefined}
                role="listitem"
                aria-current={selected ? "true" : undefined}
              >
                <div>
                  <strong>{snapshot.id}</strong>
                  <small>
                    Finalized {new Date(snapshot.createdAt).toISOString()} · reviewed v
                    {snapshot.preview.caseVersion} · {snapshot.branchIds.length} branch
                    {snapshot.branchIds.length === 1 ? "" : "es"}
                  </small>
                </div>
                <div className="report-history__actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => onOpen(snapshot.id)}
                    aria-label={`Open finalized snapshot ${snapshot.id}`}
                  >
                    {selected ? "Viewing" : "Open"}
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => onExport(snapshot.id)}
                    aria-label={`Export finalized snapshot ${snapshot.id} as PDF`}
                    disabled={exportDisabled}
                  >
                    {exportDisabled ? "Preparing…" : "Export PDF"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ReportPreviewView({
  preview,
  snapshot,
}: {
  preview: ReportPreview;
  snapshot?: ReportSnapshot | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const sections = expanded ? preview.sections : preview.sections.slice(0, 4);
  return (
    <article className="report-preview">
      <div
        className={`report-preview__status${snapshot ? " is-finalized" : " is-draft"}`}
        role="status"
      >
        <strong>{snapshot ? "Finalized immutable snapshot" : "Draft — not finalized"}</strong>
        <span>
          {snapshot
            ? `${snapshot.id} · finalized ${new Date(snapshot.createdAt).toISOString()}`
            : "Human review and manual finalization are still required before this is share-ready."}
        </span>
      </div>
      <header>
        <div>
          <small>
            {snapshot ? "Reviewed" : "Draft"} version {preview.caseVersion}
          </small>
          <h3>{preview.title}</h3>
        </div>
        <span>{preview.includedClaimIds.length} cited claims</span>
      </header>
      {preview.missingRequirements.length > 0 && (
        <section className="report-missing" role="status">
          <strong>Not ready to finalize</strong>
          <ul>
            {preview.missingRequirements.map((requirement) => (
              <li key={requirement}>{requirement}</li>
            ))}
          </ul>
        </section>
      )}
      {sections.map((section) => (
        <section key={section.id}>
          <h4>{section.title}</h4>
          {section.statements.length ? (
            section.statements.slice(0, expanded ? undefined : 2).map((statement) => {
              const technicalReferences = [
                ...statement.citations.claimIds,
                ...statement.citations.evidenceIds,
                ...statement.citations.workspacePaths,
              ];
              return (
                <div className="report-statement" key={statement.id}>
                  <p>
                    <span className={`report-certainty is-${statement.certainty}`}>
                      <span
                        className={`certainty-dot is-${statement.certainty}`}
                        aria-hidden="true"
                      />
                      {reportCertaintyLabels[statement.certainty]}
                    </span>
                    <span>{statement.text}</span>
                  </p>
                  {technicalReferences.length > 0 && (
                    <details className="report-citations">
                      <summary>{reportCitationSummary(statement.citations)}</summary>
                      <div>
                        <span>Technical references</span>
                        <code>{technicalReferences.join(", ")}</code>
                      </div>
                    </details>
                  )}
                </div>
              );
            })
          ) : (
            <p className="empty-copy">Nothing recorded.</p>
          )}
        </section>
      ))}
      <button className="text-button" onClick={() => setExpanded((value) => !value)}>
        {expanded ? "Show concise preview" : `Show all ${preview.sections.length} sections`}
      </button>
      <footer>{preview.disclaimer}</footer>
    </article>
  );
}

const reportCertaintyLabels: Record<ReportStatement["certainty"], string> = {
  confirmed: "Confirmed",
  reported: "Reported",
  uncertain: "Uncertain",
  hypothesis: "Hypothesis",
  attested: "Human attestation",
  system: "System",
};

function pluralizedSource(count: number, singular: string, plural = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

function workspaceCitationLabel(path: string): string {
  if (path.startsWith("case.")) return "case detail";
  if (path.startsWith("actors.")) return "vehicle record";
  if (path.startsWith("timelineEvents.")) return "timeline event";
  if (path.startsWith("questions.")) return "open question";
  if (path.startsWith("system.")) return "method note";
  return "structured case reference";
}

function reportCitationSummary(citations: ReportStatement["citations"]): string {
  const sources: string[] = [];
  if (citations.claimIds.length > 0) {
    sources.push(pluralizedSource(citations.claimIds.length, "observation"));
  }
  if (citations.evidenceIds.length > 0) {
    sources.push(pluralizedSource(citations.evidenceIds.length, "evidence item"));
  }
  const workspaceGroups = new Map<string, number>();
  for (const path of citations.workspacePaths) {
    const label = workspaceCitationLabel(path);
    workspaceGroups.set(label, (workspaceGroups.get(label) ?? 0) + 1);
  }
  for (const [label, count] of workspaceGroups) {
    sources.push(pluralizedSource(count, label));
  }
  return `Sources: ${sources.join(", ")}`;
}

export function FinalizationDialog({
  preview,
  onCancel,
  onFinalize,
}: {
  preview: ReportPreview;
  onCancel: () => void;
  onFinalize: () => boolean;
}) {
  const [checks, setChecks] = useState({
    unresolved: false,
    limitations: false,
    facts: false,
    unconfirmed: false,
  });
  const [confirming, setConfirming] = useState(false);
  const completedCheckCount = Object.values(checks).filter(Boolean).length;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useDialogFocus<HTMLElement>({
    active: !confirming,
    initialFocusRef: titleRef,
    onEscape: onCancel,
  });
  const ready = checks.unresolved && checks.limitations && checks.facts && checks.unconfirmed;
  const uncertaintySectionStatements =
    preview.sections.find((section) => section.id === "unresolved-questions")?.statements ?? [];
  const unresolvedStatements = uncertaintySectionStatements.filter(
    (statement) => statement.certainty !== "attested",
  );
  const uncertaintyReviewStatements = uncertaintySectionStatements.filter(
    (statement) => statement.certainty === "attested",
  );
  const limitationStatements =
    preview.sections.find((section) => section.id === "method-limitations")?.statements ?? [];
  const confirmedStatements = preview.sections.flatMap((section) =>
    section.statements.filter((statement) => statement.certainty === "confirmed"),
  );
  const includedUnconfirmedStatements = preview.sections.flatMap((section) =>
    section.statements.filter(
      (statement) =>
        statement.certainty === "reported" ||
        statement.certainty === "uncertain" ||
        statement.certainty === "hypothesis",
    ),
  );
  function submit(event: FormEvent) {
    event.preventDefault();
    if (ready) setConfirming(true);
  }
  if (confirming)
    return (
      <ConfirmDialog
        title="Create an immutable report snapshot?"
        description={`This records the reviewed case version ${preview.caseVersion} and ${String(preview.reviewBinding?.branchIds.length ?? 0)} included branch${preview.reviewBinding?.branchIds.length === 1 ? "" : "es"}. You can continue editing later without changing this snapshot.`}
        confirmLabel="Finalize factual report"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          if (!onFinalize()) setConfirming(false);
        }}
      />
    );
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="dialog finalization-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="finalize-title"
        tabIndex={-1}
      >
        <header>
          <div>
            <p>Human decision</p>
            <h2 ref={titleRef} id="finalize-title" tabIndex={-1}>
              Review before finalizing
            </h2>
          </div>
          <button className="icon-button" onClick={onCancel} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <form id="finalization-review-form" className="finalization-dialog__body" onSubmit={submit}>
          <p>
            The agent can prepare this screen but cannot complete it. Review each acknowledgement
            yourself.
          </p>
          <div
            className="finalization-review-material"
            role="group"
            aria-label="Report content to review"
          >
            <section aria-labelledby="finalize-unresolved-title">
              <header>
                <h3 id="finalize-unresolved-title">Unresolved questions</h3>
                <span>{unresolvedStatements.length}</span>
              </header>
              {unresolvedStatements.length > 0 ? (
                <ul>
                  {unresolvedStatements.map((statement) => (
                    <li key={statement.id}>{statement.text}</li>
                  ))}
                </ul>
              ) : (
                <p>None remain open or deferred.</p>
              )}
              {uncertaintyReviewStatements.map((statement) => (
                <aside className="finalization-attestation" role="note" key={statement.id}>
                  <strong>Human completeness record</strong>
                  <span>{statement.text}</span>
                </aside>
              ))}
            </section>
            <section aria-labelledby="finalize-limitations-title">
              <header>
                <h3 id="finalize-limitations-title">Method and limitations</h3>
                <span>{limitationStatements.length}</span>
              </header>
              <ul>
                {limitationStatements.map((statement) => (
                  <li key={statement.id}>{statement.text}</li>
                ))}
              </ul>
            </section>
            <section aria-labelledby="finalize-confirmed-title">
              <header>
                <h3 id="finalize-confirmed-title">Confirmed facts</h3>
                <span>{confirmedStatements.length}</span>
              </header>
              {confirmedStatements.length > 0 ? (
                <ul>
                  {confirmedStatements.map((statement) => (
                    <li key={statement.id}>{statement.text}</li>
                  ))}
                </ul>
              ) : (
                <p>No confirmed report statements are included.</p>
              )}
            </section>
            <section aria-labelledby="finalize-unconfirmed-title">
              <header>
                <h3 id="finalize-unconfirmed-title">Unconfirmed and hypothesis content</h3>
                <span>{includedUnconfirmedStatements.length}</span>
              </header>
              {includedUnconfirmedStatements.length > 0 ? (
                <ul>
                  {includedUnconfirmedStatements.map((statement) => (
                    <li key={statement.id}>
                      <strong>{reportCertaintyLabels[statement.certainty]}</strong> —{" "}
                      {statement.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No unconfirmed or hypothesis statements are included.</p>
              )}
            </section>
          </div>
          <fieldset className="finalization-acknowledgements">
            <legend>Required acknowledgements</legend>
            <label>
              <input
                name="unresolvedQuestionsReviewed"
                type="checkbox"
                checked={checks.unresolved}
                onChange={(event) => setChecks({ ...checks, unresolved: event.target.checked })}
              />
              <span>
                <strong>I reviewed unresolved questions.</strong>
                <small>{unresolvedStatements.length} listed above remain open or deferred.</small>
              </span>
            </label>
            <label>
              <input
                name="limitationsAcknowledged"
                type="checkbox"
                checked={checks.limitations}
                onChange={(event) => setChecks({ ...checks, limitations: event.target.checked })}
              />
              <span>
                <strong>I acknowledge the method and limitations.</strong>
                <small>I read the method statements listed above.</small>
              </span>
            </label>
            <label>
              <input
                name="confirmedFactsReviewed"
                type="checkbox"
                checked={checks.facts}
                onChange={(event) => setChecks({ ...checks, facts: event.target.checked })}
              />
              <span>
                <strong>I reviewed every confirmed fact.</strong>
                <small>
                  {confirmedStatements.length} confirmed report statements are listed above.
                </small>
              </span>
            </label>
            <label>
              <input
                name="includedUnconfirmedContentReviewed"
                type="checkbox"
                checked={checks.unconfirmed}
                onChange={(event) => setChecks({ ...checks, unconfirmed: event.target.checked })}
              />
              <span>
                <strong>I reviewed every included unconfirmed and hypothesis statement.</strong>
                <small>
                  {includedUnconfirmedStatements.length} labelled statements are listed above,
                  including any agent-authored hypotheses. This acknowledges their inclusion and
                  labels; it does not confirm them.
                </small>
              </span>
            </label>
          </fieldset>
        </form>
        <footer className="finalization-dialog__actions">
          <div className="finalization-dialog__progress" role="status" aria-live="polite">
            <strong>{completedCheckCount} of 4 acknowledged</strong>
            <small>All four are required for human confirmation.</small>
          </div>
          <div className="finalization-dialog__buttons">
            <button type="button" className="button button--quiet" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="submit"
              form="finalization-review-form"
              className="button button--primary"
              disabled={!ready}
            >
              Continue to confirmation
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  destructive = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogFocus<HTMLElement>({
    initialFocusRef: cancelButtonRef,
    onEscape: onCancel,
  });
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="dialog confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        tabIndex={-1}
      >
        <div className={`dialog-icon${destructive ? " is-destructive" : ""}`}>
          {destructive ? <Trash2 size={20} /> : <ShieldCheck size={20} />}
        </div>
        <h2 id="confirm-title">{title}</h2>
        <p>{description}</p>
        <footer>
          <button ref={cancelButtonRef} className="button button--quiet" onClick={onCancel}>
            Cancel
          </button>
          <button
            className={`button ${destructive ? "button--danger" : "button--primary"}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
