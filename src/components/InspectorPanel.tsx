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
  Plus,
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
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";

import { compareHypotheses } from "../domain/hypotheses";
import { getActorPoseAtTime } from "../domain/interpolation";
import { rankOpenQuestions } from "../domain/reducer";
import type {
  Claim,
  ClaimStatus,
  ConsistencyIssue,
  AgentProposal,
  EvidenceAnnotation,
  EvidenceAnnotationLink,
  EvidenceAsset,
  HypothesisBranch,
  OpenQuestion,
  ActorPose,
  ReplayCase,
  ReportPreview,
  WorkspaceMode,
} from "../domain/models";
import { resolveEvidenceImageSource } from "./evidenceSource";
import { useDialogFocus } from "./useDialogFocus";

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

type ProposalAdjustmentChange =
  | {
      kind: "actor-pose";
      actorId: string;
      proposedPose: ActorPose;
    }
  | {
      kind: "trajectory-set";
      trajectoryId: string;
      actorId: string;
      branchId: string;
      keyframes: Array<ActorPose & { id: string; timeMs: number }>;
      visible: boolean;
    };

interface InspectorPanelProps {
  replayCase: ReplayCase;
  currentTimeMs: number;
  activeTab: InspectorTab;
  selectedId?: string;
  reportPreview?: ReportPreview;
  evidenceUrls?: Record<string, string>;
  compareBranchIds: string[];
  focusedIssueId?: string;
  onTabChange: (tab: InspectorTab) => void;
  onSelect: (type: "claim" | "evidence" | "question" | "hypothesis" | "report", id: string) => void;
  onAddClaim: (
    statement: string,
    status: Exclude<ClaimStatus, "confirmed">,
    sourceType: Claim["sourceType"],
  ) => void;
  onConfirmClaim: (claimId: string) => void;
  onSetClaimStatus: (claimId: string, status: Exclude<ClaimStatus, "confirmed">) => void;
  onToggleLock: (type: "claim", id: string, locked: boolean) => void;
  onUpdateActorPose: (actorId: string, pose: ActorPose) => void;
  onUpdateTrajectoryKeyframe: (
    trajectoryId: string,
    keyframeId: string,
    update: ActorPose & { timeMs: number },
  ) => void;
  onSetTrajectoryVisible: (trajectoryId: string, visible: boolean) => void;
  onUpdateTimelineEvent: (
    eventId: string,
    update: {
      timeMs: number;
      certainty: Exclude<ClaimStatus, "confirmed" | "agent-hypothesis">;
      location?: { x: number; y: number };
    },
  ) => void;
  onToggleSceneItemLock: (
    type: "actor" | "trajectory" | "timeline-event",
    id: string,
    locked: boolean,
  ) => void;
  onAdjustProposal: (
    proposalId: string,
    summary: string,
    changes: ProposalAdjustmentChange[],
  ) => void;
  onAcceptProposal: (proposalId: string) => void;
  onRejectProposal: (proposalId: string) => void;
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
  ) => void;
  onLinkEvidence: (
    evidenceId: string,
    targetType: EvidenceLinkTargetType,
    targetId: string,
    annotationId?: string,
  ) => void;
  onAddQuestion: (question: string, reason: string, importance: OpenQuestion["importance"]) => void;
  onUpdateQuestion: (
    questionId: string,
    status: OpenQuestion["status"],
    answer?: string,
    convert?: boolean,
  ) => void;
  onForkBranch: (parentId: string, name: string, description: string) => void;
  onSetActiveBranch: (branchId: string) => void;
  onRenameBranch: (branchId: string, name: string, description: string) => void;
  onAddAssumption: (branchId: string, statement: string) => void;
  onUpdateAssumption: (
    branchId: string,
    assumptionId: string,
    update: { statement?: string; status?: "active" | "withdrawn" },
  ) => void;
  onToggleBranchArchive: (branch: HypothesisBranch) => void;
  onCompareBranches: (ids: string[]) => void;
  onValidate: () => void;
  onFocusIssue: (issue: ConsistencyIssue) => void;
  onBuildReport: () => void;
  onAddReportNote: (text: string, claimIds: string[], evidenceIds: string[]) => void;
  onReviewReportNote: (noteId: string, approved: boolean) => void;
  onFinalizeReport: () => void;
  onExportJson: () => void;
  onExportPdf: () => void;
  onExportScene: (format: "svg" | "png") => void;
}

const tabs: Array<{ id: InspectorTab; label: string; Icon: typeof FileText }> = [
  { id: "facts", label: "Facts", Icon: SearchCheck },
  { id: "evidence", label: "Evidence", Icon: Camera },
  { id: "questions", label: "Questions", Icon: CircleHelp },
  { id: "hypotheses", label: "Hypotheses", Icon: GitFork },
  { id: "report", label: "Report", Icon: FileText },
];

const statusLabels: Record<ClaimStatus, string> = {
  confirmed: "Confirmed by human",
  reported: "Reported",
  likely: "Likely, not confirmed",
  uncertain: "Uncertain",
  disputed: "Disputed",
  unknown: "Unknown",
  "agent-hypothesis": "Agent hypothesis",
};

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
  return (
    <aside className="inspector-panel" aria-label="Case inspector">
      <nav className="inspector-tabs" aria-label="Case workspaces">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={props.activeTab === id ? "inspector-tab is-active" : "inspector-tab"}
            onClick={() => props.onTabChange(id)}
            aria-current={props.activeTab === id ? "page" : undefined}
            title={label}
          >
            <Icon size={16} />
            <span>{label}</span>
            {id === "questions" &&
              props.replayCase.questions.filter((item) => item.status === "open").length > 0 && (
                <em>
                  {props.replayCase.questions.filter((item) => item.status === "open").length}
                </em>
              )}
          </button>
        ))}
      </nav>
      <div className="inspector-content">
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

function proposalAdjustmentFromForm(
  proposal: AgentProposal,
  form: FormData,
): ProposalAdjustmentChange[] {
  const revision = proposal.revisions.at(-1);
  if (!revision) throw new Error(`Proposal ${proposal.id} has no revision.`);
  return revision.changes.map((change, changeIndex) => {
    if (change.kind === "actor-pose") {
      return {
        kind: "actor-pose" as const,
        actorId: change.actorId,
        proposedPose: {
          x: requiredNumber(form, `change-${String(changeIndex)}-x`),
          y: requiredNumber(form, `change-${String(changeIndex)}-y`),
          rotationDeg: requiredNumber(form, `change-${String(changeIndex)}-rotation`),
        },
      };
    }
    return {
      kind: "trajectory-set" as const,
      trajectoryId: change.trajectoryId,
      actorId: change.actorId,
      branchId: change.branchId,
      visible: form.get(`change-${String(changeIndex)}-visible`) === "on",
      keyframes: change.proposedTrajectory.keyframes.map((frame, frameIndex) => ({
        id: frame.id,
        timeMs: Math.round(
          requiredNumber(form, `change-${String(changeIndex)}-frame-${String(frameIndex)}-time`) *
            1000,
        ),
        x: requiredNumber(form, `change-${String(changeIndex)}-frame-${String(frameIndex)}-x`),
        y: requiredNumber(form, `change-${String(changeIndex)}-frame-${String(frameIndex)}-y`),
        rotationDeg: requiredNumber(
          form,
          `change-${String(changeIndex)}-frame-${String(frameIndex)}-rotation`,
        ),
      })),
    };
  });
}

function ProposalReviewPanel(props: InspectorPanelProps) {
  const pending = props.replayCase.proposals.filter((proposal) => proposal.status === "pending");
  const resolved = props.replayCase.proposals
    .filter((proposal) => proposal.status !== "pending")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const [decision, setDecision] = useState<{
    proposalId: string;
    outcome: "accepted" | "rejected";
  }>();
  if (pending.length === 0 && resolved.length === 0) return null;

  return (
    <section className="proposal-review" aria-label="Agent change proposals">
      {pending.length > 0 && (
        <header className="proposal-review__heading">
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
      {pending.map((proposal) => {
        const revision = proposal.revisions.at(-1);
        if (!revision) return null;
        return (
          <form
            className="proposal-card"
            key={`${proposal.id}-${revision.id}`}
            onSubmit={(event) => {
              event.preventDefault();
              props.onAdjustProposal(
                proposal.id,
                "Human adjusted the proposed geometry before deciding.",
                proposalAdjustmentFromForm(proposal, new FormData(event.currentTarget)),
              );
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
              <span>{revision.changes.length} changes</span>
            </header>
            <p>{proposal.rationale}</p>
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
                            min="0"
                            max="100"
                            step="0.1"
                            defaultValue={change.proposedPose.x}
                            required
                          />
                        </label>
                        <label>
                          <span>Y</span>
                          <input
                            name={`change-${String(changeIndex)}-y`}
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            defaultValue={change.proposedPose.y}
                            required
                          />
                        </label>
                        <label>
                          <span>Angle °</span>
                          <input
                            name={`change-${String(changeIndex)}-rotation`}
                            type="number"
                            min="-360"
                            max="360"
                            step="1"
                            defaultValue={change.proposedPose.rotationDeg}
                            required
                          />
                        </label>
                      </div>
                      <small>
                        Current {change.basePose.x.toFixed(1)}, {change.basePose.y.toFixed(1)} at{" "}
                        {Math.round(change.basePose.rotationDeg)}°
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
                          <strong>Point {frameIndex + 1}</strong>
                          <div className="scene-numeric-form__grid scene-numeric-form__grid--four">
                            <label>
                              <span>Time s</span>
                              <input
                                name={`change-${String(changeIndex)}-frame-${String(frameIndex)}-time`}
                                type="number"
                                min={props.replayCase.timeRangeMs.start / 1000}
                                max={props.replayCase.timeRangeMs.end / 1000}
                                step="0.1"
                                defaultValue={frame.timeMs / 1000}
                                required
                              />
                            </label>
                            <label>
                              <span>X</span>
                              <input
                                name={`change-${String(changeIndex)}-frame-${String(frameIndex)}-x`}
                                type="number"
                                min="0"
                                max="100"
                                step="0.1"
                                defaultValue={frame.x}
                                required
                              />
                            </label>
                            <label>
                              <span>Y</span>
                              <input
                                name={`change-${String(changeIndex)}-frame-${String(frameIndex)}-y`}
                                type="number"
                                min="0"
                                max="100"
                                step="0.1"
                                defaultValue={frame.y}
                                required
                              />
                            </label>
                            <label>
                              <span>Angle °</span>
                              <input
                                name={`change-${String(changeIndex)}-frame-${String(frameIndex)}-rotation`}
                                type="number"
                                min="-360"
                                max="360"
                                step="1"
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
            <footer>
              <button
                type="button"
                className="button button--quiet"
                onClick={() => setDecision({ proposalId: proposal.id, outcome: "rejected" })}
              >
                Reject
              </button>
              <button className="button button--secondary">Save adjustment</button>
              <button
                type="button"
                className="button button--primary"
                onClick={() => setDecision({ proposalId: proposal.id, outcome: "accepted" })}
              >
                Accept and apply
              </button>
            </footer>
          </form>
        );
      })}
      {resolved.length > 0 && (
        <details className="proposal-history">
          <summary>Recent proposal decisions ({resolved.length})</summary>
          <ul>
            {resolved.slice(0, 5).map((proposal) => (
              <li key={proposal.id}>
                <span>{proposal.title}</span>
                <strong>{proposal.status}</strong>
              </li>
            ))}
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
            if (decision.outcome === "accepted") props.onAcceptProposal(decision.proposalId);
            else props.onRejectProposal(decision.proposalId);
            setDecision(undefined);
          }}
        />
      )}
    </section>
  );
}

function SceneSelectionEditor(props: InspectorPanelProps) {
  const actor = props.replayCase.actors.find((item) => item.id === props.selectedId);
  const trajectory = props.replayCase.trajectories.find((item) => item.id === props.selectedId);
  const timelineEvent = props.replayCase.timelineEvents.find(
    (item) => item.id === props.selectedId,
  );
  const branch = trajectory
    ? props.replayCase.branches.find((item) => item.id === trajectory.branchId)
    : undefined;
  const actorPose = actor
    ? (getActorPoseAtTime(props.replayCase, actor.id, props.currentTimeMs) ?? actor.pose)
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
          Exact pose at the playhead. Values use the scene’s 0–100 coordinate system.
        </p>
        <form
          key={`${actor.id}-${String(actorPose.x)}-${String(actorPose.y)}-${String(actorPose.rotationDeg)}`}
          className="scene-numeric-form"
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
                min="0"
                max="100"
                step="0.1"
                defaultValue={actorPose.x}
                required
                disabled={actor.locked}
              />
            </label>
            <label>
              <span>Y position</span>
              <input
                name="y"
                type="number"
                min="0"
                max="100"
                step="0.1"
                defaultValue={actorPose.y}
                required
                disabled={actor.locked}
              />
            </label>
            <label>
              <span>Rotation °</span>
              <input
                name="rotation"
                type="number"
                min="-360"
                max="360"
                step="1"
                defaultValue={actorPose.rotationDeg}
                required
                disabled={actor.locked}
              />
            </label>
          </div>
          <button className="button button--secondary" disabled={actor.locked}>
            Apply exact pose
          </button>
        </form>
        <dl className="scene-selection-facts">
          <div>
            <dt>Dimensions</dt>
            <dd>
              {actor.dimensions.length.toFixed(1)} × {actor.dimensions.width.toFixed(1)}
            </dd>
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
            <h2 id="scene-selection-title">
              {props.replayCase.actors.find((item) => item.id === trajectory.actorId)?.label ??
                "Vehicle path"}
            </h2>
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
          <label>
            <input
              type="checkbox"
              checked={trajectory.visible}
              disabled={trajectory.locked}
              onChange={(event) =>
                props.onSetTrajectoryVisible(trajectory.id, event.target.checked)
              }
            />
            Show path
          </label>
        </div>
        <div className="keyframe-editor-list" aria-label="Exact trajectory points">
          {trajectory.keyframes.map((frame, index) => (
            <form
              key={`${frame.id}-${String(frame.timeMs)}-${String(frame.x)}-${String(frame.y)}-${String(frame.rotationDeg)}`}
              className="keyframe-editor"
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
                <strong>Point {index + 1}</strong>
                <button className="text-button" disabled={trajectory.locked}>
                  Apply point
                </button>
              </header>
              <div className="scene-numeric-form__grid scene-numeric-form__grid--four">
                <label>
                  <span>Time s</span>
                  <input
                    name="time"
                    type="number"
                    min={props.replayCase.timeRangeMs.start / 1000}
                    max={props.replayCase.timeRangeMs.end / 1000}
                    step="0.1"
                    defaultValue={frame.timeMs / 1000}
                    required
                    disabled={trajectory.locked}
                  />
                </label>
                <label>
                  <span>X</span>
                  <input
                    name="x"
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    defaultValue={frame.x}
                    required
                    disabled={trajectory.locked}
                  />
                </label>
                <label>
                  <span>Y</span>
                  <input
                    name="y"
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    defaultValue={frame.y}
                    required
                    disabled={trajectory.locked}
                  />
                </label>
                <label>
                  <span>Angle °</span>
                  <input
                    name="rotation"
                    type="number"
                    min="-360"
                    max="360"
                    step="1"
                    defaultValue={frame.rotationDeg}
                    required
                    disabled={trajectory.locked}
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
              step="0.1"
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
                  min="0"
                  max="100"
                  step="0.1"
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
                  min="0"
                  max="100"
                  step="0.1"
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
  const ordered = useMemo(
    () =>
      [...props.replayCase.claims].sort(
        (a, b) => Number(b.humanConfirmed) - Number(a.humanConfirmed),
      ),
    [props.replayCase.claims],
  );
  const selected = props.replayCase.claims.find((claim) => claim.id === props.selectedId);

  return (
    <>
      <SectionHeading
        kicker="Provenance ledger"
        title="Facts and observations"
        action={
          <button
            className="icon-button"
            onClick={() => setAdding((value) => !value)}
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

      {adding && (
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!statement.trim()) return;
            props.onAddClaim(statement.trim(), status, sourceType);
            setStatement("");
            setAdding(false);
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
                onChange={(event) => setSourceType(event.target.value as Claim["sourceType"])}
              >
                <option value="human-statement">Human statement</option>
                <option value="witness-statement">Witness statement</option>
                <option value="photo">Photo</option>
                <option value="document">Document</option>
                <option value="scene-observation">Scene observation</option>
              </select>
            </label>
          </div>
          <div className="inline-form__actions">
            <button type="button" className="text-button" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className="button button--primary">Add observation</button>
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
          {selected.createdBy !== "agent" &&
            selected.status !== "confirmed" &&
            !selected.locked && (
              <button
                className="button button--primary button--full"
                onClick={() => props.onConfirmClaim(selected.id)}
              >
                <ShieldCheck size={15} /> Confirm as human-reviewed
              </button>
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

function EvidenceView(props: InspectorPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string>();
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
        onChange={(event) => process(event.target.files)}
      />
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
          Images remain in this browser unless you export the case.
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
              <dd>
                {selected.linkedClaimIds.length +
                  selected.linkedEventIds.length +
                  selected.linkedSceneObjectIds.length}
              </dd>
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
            key={`metadata-${selected.id}`}
            asset={selected}
            onUpdate={props.onUpdateEvidence}
          />
          <EvidenceLinkControl
            key={`link-${selected.id}`}
            asset={selected}
            replayCase={props.replayCase}
            onLink={props.onLinkEvidence}
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
    onUpdate(asset.id, { annotations: [...asset.annotations, annotation] });
    setAnnotationMode(undefined);
  }

  function addAnnotation(event: React.PointerEvent<HTMLDivElement>) {
    if (!annotationMode) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    if (annotationMode === "point") addAnnotationAt(x, y);
    else addAnnotationAt(x - 0.1, y - 0.08);
  }

  return (
    <>
      <div
        className={`evidence-preview${annotationMode ? " is-annotating" : ""}`}
        onPointerDown={addAnnotation}
        aria-label={
          annotationMode ? `Click the image to add a ${annotationMode} annotation` : undefined
        }
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
          <span className="annotation-instruction">
            Click to place {annotationMode === "point" ? "a point" : "an area"}
          </span>
        )}
      </div>
      <div className="annotation-tools" aria-label="Evidence annotation tools">
        <button
          className={annotationMode === "point" ? "is-active" : ""}
          onClick={() =>
            setAnnotationMode((current) => (current === "point" ? undefined : "point"))
          }
        >
          Point
        </button>
        <button
          className={annotationMode === "rectangle" ? "is-active" : ""}
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
    asset.capturedAt ? asset.capturedAt.slice(0, 16) : "",
  );
  const [notes, setNotes] = useState(asset.notes ?? "");
  const [tags, setTags] = useState(asset.tags.join(", "));

  if (!editing)
    return (
      <button className="text-button evidence-edit-button" onClick={() => setEditing(true)}>
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
        onUpdate(asset.id, {
          capturedAt: capturedAt ? new Date(capturedAt).toISOString() : null,
          notes: notes.trim() || null,
          tags: parsedTags,
        });
        setEditing(false);
      }}
    >
      <label>
        <span>Capture time</span>
        <input
          type="datetime-local"
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
          <select value={annotationId} onChange={(event) => setAnnotationId(event.target.value)}>
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
          onLink(
            asset.id,
            selectedTarget.targetType,
            selectedTarget.targetId,
            annotationId || undefined,
          );
          setTarget("");
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
  return (
    <>
      <SectionHeading
        kicker="Uncertainty register"
        title="Open questions"
        action={
          <button
            className="icon-button"
            onClick={() => setAdding((value) => !value)}
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
            props.onAddQuestion(question, reason, importance);
            setQuestion("");
            setReason("");
            setAdding(false);
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
            <button type="button" className="text-button" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className="button button--primary">Add question</button>
          </div>
        </form>
      )}
      <div className="question-list">
        {ordered.map((item, index) => (
          <QuestionItem
            key={item.id}
            question={item}
            rank={index + 1}
            onUpdate={props.onUpdateQuestion}
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
}: {
  question: OpenQuestion;
  rank: number;
  onUpdate: InspectorPanelProps["onUpdateQuestion"];
}) {
  const [answering, setAnswering] = useState(false);
  const [answer, setAnswer] = useState(question.answer ?? "");
  const [convert, setConvert] = useState(false);
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
      {question.answer && (
        <blockquote>
          <strong>Answer:</strong> {question.answer}
        </blockquote>
      )}
      {question.status === "open" && !answering && (
        <div className="question-actions">
          <button onClick={() => setAnswering(true)}>Answer</button>
          <button onClick={() => onUpdate(question.id, "deferred")}>Defer</button>
          <button onClick={() => onUpdate(question.id, "dismissed")}>Dismiss</button>
        </div>
      )}
      {answering && (
        <form
          className="question-answer"
          onSubmit={(event) => {
            event.preventDefault();
            onUpdate(question.id, "answered", answer, convert);
            setAnswering(false);
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
            <button type="button" onClick={() => setAnswering(false)}>
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
  const [forking, setForking] = useState(false);
  const [name, setName] = useState("Alternative path");
  const [description, setDescription] = useState(
    "An alternative reconstruction that preserves shared facts while changing one uncertain movement.",
  );
  const active =
    props.replayCase.branches.find((branch) => branch.id === props.replayCase.activeBranchId) ??
    props.replayCase.branches[0];
  return (
    <>
      <SectionHeading
        kicker="Alternative reconstructions"
        title="Hypotheses"
        action={
          <button
            className="icon-button"
            onClick={() => setForking((value) => !value)}
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
      {forking && active && (
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            props.onForkBranch(active.id, name, description);
            setForking(false);
          }}
        >
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
            <button type="button" className="text-button" onClick={() => setForking(false)}>
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
  onRename: (id: string, name: string, description: string) => void;
  onAddAssumption: (id: string, text: string) => void;
  onUpdateAssumption: (
    branchId: string,
    assumptionId: string,
    update: { statement?: string; status?: "active" | "withdrawn" },
  ) => void;
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
            onRename(branch.id, branchName, branchDescription);
            setEditingBranch(false);
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
                    onUpdateAssumption(branch.id, item.id, { statement: assumptionText });
                    setEditingAssumptionId(undefined);
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
            onAddAssumption(branch.id, text);
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
  const firstSelected = selected[0];
  const secondSelected = selected[1];
  const comparison =
    firstSelected && secondSelected
      ? compareHypotheses(replayCase, firstSelected, secondSelected)
      : undefined;
  return (
    <section className="compare-control">
      <h3>
        <GitCompareArrows size={15} /> Compare paths
      </h3>
      <div>
        <select aria-label="First branch" value={a} onChange={(event) => setA(event.target.value)}>
          {branches.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <span>with</span>
        <select aria-label="Second branch" value={b} onChange={(event) => setB(event.target.value)}>
          {branches.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      <button
        className="button button--secondary button--full"
        disabled={!a || !b || a === b}
        onClick={() => onCompare(selected.length ? [] : [a, b])}
      >
        {selected.length ? "Stop comparison" : "Compare side by side"}
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
    rowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
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
        <strong>{issue.title}</strong>
        <p>{issue.explanation}</p>
      </div>
    </button>
  );
}

function ReportView(props: InspectorPanelProps) {
  const [note, setNote] = useState("");
  const [noteClaimId, setNoteClaimId] = useState("");
  const [noteEvidenceId, setNoteEvidenceId] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [toolPrepared, setToolPrepared] = useState(false);
  const preview = props.reportPreview;
  const finalizationToolRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = finalizationToolRef.current;
    if (!form) return;
    const activated = () => {
      setToolPrepared(true);
      setReviewOpen(true);
    };
    const cancelled = () => setToolPrepared(false);
    form.addEventListener("toolactivated", activated);
    form.addEventListener("toolcancel", cancelled);
    return () => {
      form.removeEventListener("toolactivated", activated);
      form.removeEventListener("toolcancel", cancelled);
    };
  }, [preview]);
  return (
    <>
      <SectionHeading
        kicker="Neutral factual account"
        title="Report"
        action={
          <button
            className="icon-button"
            onClick={props.onValidate}
            aria-label="Run consistency check"
          >
            <SearchCheck size={17} />
          </button>
        }
      />
      <div
        className={`validation-summary${props.replayCase.consistencyIssues.some((item) => item.severity === "error") ? " has-errors" : ""}`}
      >
        <AlertTriangle size={17} />
        <div>
          <strong>{props.replayCase.consistencyIssues.length} consistency items</strong>
          <span>
            {props.replayCase.consistencyIssues.filter((item) => item.severity === "error").length}{" "}
            errors ·{" "}
            {
              props.replayCase.consistencyIssues.filter((item) => item.severity === "warning")
                .length
            }{" "}
            warnings ·{" "}
            {
              props.replayCase.consistencyIssues.filter((item) => item.severity === "question")
                .length
            }{" "}
            questions
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
        <ReportPreviewView preview={preview} />
      )}
      <form
        className="report-note-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!note.trim() || (!noteClaimId && !noteEvidenceId)) return;
          props.onAddReportNote(
            note.trim(),
            noteClaimId ? [noteClaimId] : [],
            noteEvidenceId ? [noteEvidenceId] : [],
          );
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
            placeholder="Add context without changing the underlying facts"
          />
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
        <small>Choose at least one source. REPLAY never attaches a citation silently.</small>
        <button
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
                    <button onClick={() => props.onReviewReportNote(item.id, true)}>Approve</button>
                    <button onClick={() => props.onReviewReportNote(item.id, false)}>Reject</button>
                  </>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}
      <section className="export-section">
        <h3>Export local case</h3>
        <div className="export-grid">
          <button onClick={props.onExportPdf}>
            <FileText size={16} /> PDF
          </button>
          <button onClick={props.onExportJson}>
            <FileJson size={16} /> JSON
          </button>
          <button onClick={() => props.onExportScene("svg")}>
            <FileImage size={16} /> SVG
          </button>
          <button onClick={() => props.onExportScene("png")}>
            <ImageIcon size={16} /> PNG
          </button>
        </div>
      </section>
      <form
        ref={finalizationToolRef}
        className={`finalize-tool-form${toolPrepared ? " is-tool-prepared" : ""}`}
        toolname="finalize_factual_report"
        tooldescription="Prepare and focus the visible REPLAY human review. Never submit, confirm, or finalize automatically."
        onSubmit={(event) => {
          event.preventDefault();
          setReviewOpen(true);
        }}
      >
        <button className="button button--primary button--full finalize-button" disabled={!preview}>
          <ShieldCheck size={16} /> Review and finalize
        </button>
        {toolPrepared && (
          <span role="status">
            <Sparkles size={12} /> Site Tools prepared this review. A person must complete every
            next step.
          </span>
        )}
      </form>
      <p className="finalize-help">
        Finalization always requires a visible human review and a manual click.
      </p>
      {reviewOpen && (
        <FinalizationDialog
          replayCase={props.replayCase}
          onCancel={() => setReviewOpen(false)}
          onFinalize={() => {
            props.onFinalizeReport();
            setReviewOpen(false);
          }}
        />
      )}
    </>
  );
}

function ReportPreviewView({ preview }: { preview: ReportPreview }) {
  const [expanded, setExpanded] = useState(false);
  const sections = expanded ? preview.sections : preview.sections.slice(0, 4);
  return (
    <article className="report-preview">
      <header>
        <div>
          <small>Version {preview.caseVersion}</small>
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
            section.statements.slice(0, expanded ? undefined : 2).map((statement) => (
              <p key={statement.id}>
                <span className={`certainty-dot is-${statement.certainty}`} />
                {statement.text}
                {(statement.citations.claimIds.length > 0 ||
                  statement.citations.evidenceIds.length > 0 ||
                  statement.citations.workspacePaths.length > 0) && (
                  <small>
                    [
                    {[
                      ...statement.citations.claimIds,
                      ...statement.citations.evidenceIds,
                      ...statement.citations.workspacePaths,
                    ].join(", ")}
                    ]
                  </small>
                )}
              </p>
            ))
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

function FinalizationDialog({
  replayCase,
  onCancel,
  onFinalize,
}: {
  replayCase: ReplayCase;
  onCancel: () => void;
  onFinalize: () => void;
}) {
  const [checks, setChecks] = useState({ unresolved: false, limitations: false, facts: false });
  const [confirming, setConfirming] = useState(false);
  const firstCheckRef = useRef<HTMLInputElement>(null);
  const dialogRef = useDialogFocus<HTMLElement>({
    active: !confirming,
    initialFocusRef: firstCheckRef,
    onEscape: onCancel,
  });
  const ready = checks.unresolved && checks.limitations && checks.facts;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (ready) setConfirming(true);
  }
  if (confirming)
    return (
      <ConfirmDialog
        title="Create an immutable report snapshot?"
        description={`This records case version ${replayCase.caseVersion}. You can continue editing later without changing this snapshot.`}
        confirmLabel="Finalize factual report"
        onCancel={() => setConfirming(false)}
        onConfirm={onFinalize}
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
            <h2 id="finalize-title">Review before finalizing</h2>
          </div>
          <button className="icon-button" onClick={onCancel} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <p>
          The agent can prepare this screen but cannot complete it. Review each acknowledgement
          yourself.
        </p>
        <form onSubmit={submit}>
          <label>
            <input
              ref={firstCheckRef}
              name="unresolvedQuestionsReviewed"
              type="checkbox"
              checked={checks.unresolved}
              onChange={(event) => setChecks({ ...checks, unresolved: event.target.checked })}
            />
            <span>
              <strong>I reviewed unresolved questions.</strong>
              <small>
                {
                  replayCase.questions.filter(
                    (item) => item.status === "open" || item.status === "deferred",
                  ).length
                }{" "}
                remain open or deferred.
              </small>
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
              <small>This is not forensic analysis or legal advice.</small>
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
                {replayCase.claims.filter((item) => item.humanConfirmed).length} claims are
                currently human-confirmed.
              </small>
            </span>
          </label>
          <footer>
            <button type="button" className="button button--quiet" onClick={onCancel}>
              Cancel
            </button>
            <button className="button button--primary" disabled={!ready}>
              Continue to confirmation
            </button>
          </footer>
        </form>
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
