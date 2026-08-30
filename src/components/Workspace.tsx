import {
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  CircleHelp,
  CloudOff,
  Download,
  FileUp,
  Home,
  Pencil,
  Redo2,
  Route,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  Undo2,
  Wifi,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import "../styles/debug.css";
import "../styles/inspector.css";
import "../styles/scene.css";
import "../styles/simple-workspace.css";
import "../styles/workspace.css";

import {
  buildReportPreview,
  clampTimeToRange,
  createReplayEngine,
  editableKeyframeTimeBounds,
  DEMO_SCENARIO_METADATA,
  prepareReplayCaseImport,
  initialTrajectoryTimes,
  interpolateTrajectory,
  quantizeEditableTimeMs,
  quantizeTimeInRange,
  rankOpenQuestions,
  resolveProposalReviewRequest,
  sceneDeltaForMetricHeading,
  type ActivityEvent,
  type DemoScenarioId,
  type OpenQuestion,
  type ReplayCase,
  type ReplayCommandResult,
  type ReportPreview,
  type ReplayImportTrustResetSummary,
  type ProposalReviewTarget,
  type WorkspaceItemType,
} from "../domain";
import { clampScenePoint } from "../domain/sceneCoordinates";
import type { WorkspaceTourActionId } from "../onboarding/workspaceTour";
import {
  exportCaseJson,
  exportReportPdf,
  exportScenePng,
  exportSceneSvg,
} from "../export/exporters";
import { createReplayWebMCPAdapter } from "../integration/replayWebMCPAdapter";
import {
  completeEvidenceBlobPurge,
  loadEvidenceBlob,
  LocalVaultConflictError,
  saveCase,
  type PersistedEvidenceBlob,
  type SaveCaseOptions,
} from "../persistence/database";
import {
  EVIDENCE_IMAGE_TOO_LARGE_MESSAGE,
  MAX_EVIDENCE_IMAGE_DIMENSION,
  MAX_EVIDENCE_IMAGE_PIXELS,
  validateEvidenceImageDimensions,
  validateEvidenceImageSignature,
} from "../persistence/evidenceValidation";
import {
  ReplayWebMCPRegistry,
  type ReplayToolInvocationAudit,
  type WebMCPDebugState,
  type WebMCPToolName,
} from "../webmcp";
import { buildSimpleAgentReviewPrompt } from "../webmcp/prompts";
import { ActivityPanel } from "./ActivityPanel";
import { BrandMark } from "./BrandMark";
import { CaseDetailsDialog, type CaseDetailsInput } from "./CaseDetailsDialog";
import { copyTextToClipboard } from "./clipboard";
import { type EvidenceUploadInput, InspectorPanel, type InspectorTab } from "./InspectorPanel";
import {
  DEFAULT_PLAYBACK_SPEED,
  remainsAtAutomaticImpactPause,
  resumedPlayheadTime,
  type AutomaticImpactPause,
} from "./playback";
import { SceneCanvas } from "./SceneCanvas";
import { SimpleWorkspace } from "./SimpleWorkspace";
import { Timeline } from "./Timeline";
import { useDialogFocus } from "./useDialogFocus";
import { WebMCPDebugPanel } from "./WebMCPDebugPanel";
import { ReplayGuide, type GuideSectionId } from "./ReplayGuide";
import { WorkspaceTour } from "./WorkspaceTour";

interface WorkspaceProps {
  initialCase: ReplayCase;
  isDemo: boolean;
  experienceMode: ExperienceMode;
  onExperienceModeChange: (mode: ExperienceMode) => void;
  onHome: (latestCase: ReplayCase) => void;
  onResetDemo: () => boolean | Promise<boolean>;
  activeDemoScenarioId?: DemoScenarioId;
  onOpenDemoScenario?: (scenarioId: DemoScenarioId) => void;
  onRegisterLeaveGuard: (guard: (() => Promise<boolean>) | undefined) => void;
  onImportCase: (replayCase: ReplayCase) => void;
  startWithTour?: boolean;
  onTourStarted?: () => void;
}

type SaveState = "saving" | "saved" | "error";
type WriteAccess = "checking" | "writable" | "blocked";
type ExperienceMode = "simple" | "expert";

interface PendingCaseImport {
  replayCase: ReplayCase;
  fileName: string;
  trustResetSummary: ReplayImportTrustResetSummary;
}

const CASE_WRITE_LEASE_CONFLICT_MESSAGE =
  "Another page context still owns this case. It may be a hidden or recently closed tab. This copy is read-only. If no other copy is actively editing, take over and reload the latest saved case.";
const WEBMCP_MUTATION_IN_FLIGHT_MESSAGE =
  "A Site Tool change is being stored. Wait for it to finish, then retry this action.";
const EVIDENCE_ATTACHMENT_SAVE_PENDING_MESSAGE =
  "Evidence metadata and image bytes must finish saving together before another change. Wait for this save, or retry it if REPLAY reports a failure.";
const LEASE_HANDOFF_RETRY_DELAYS_MS = [25, 75, 150, 300] as const;
const IMPACT_REPLAY_CONTACT_HOLD_MS = 400;

function getLockManager(): LockManager | undefined {
  const candidate: unknown = Reflect.get(navigator, "locks");
  return typeof candidate === "object" && candidate !== null && "request" in candidate
    ? (candidate as LockManager)
    : undefined;
}

interface ToastState {
  kind: "success" | "error" | "info";
  message: string;
  detail?: string;
}

interface SaveFailure {
  caseVersion: number;
  expectedCaseVersion: number;
  message: string;
}

interface PendingEvidenceAttachment {
  evidenceId: string;
  record: PersistedEvidenceBlob;
}

type PendingEvidenceAttachmentDisposition = "active" | "purge" | "conflict";

function classifyPendingEvidenceAttachment(
  replayCase: ReplayCase,
  pending: PendingEvidenceAttachment,
): PendingEvidenceAttachmentDisposition {
  const activeKeyOwner = replayCase.evidence.find(
    (asset) => !asset.deleted && asset.localBlobKey === pending.record.key,
  );
  if (!activeKeyOwner) return "purge";
  if (
    activeKeyOwner.id === pending.evidenceId &&
    pending.record.caseId === replayCase.id &&
    activeKeyOwner.checksum === pending.record.checksum &&
    activeKeyOwner.mimeType === pending.record.mimeType &&
    activeKeyOwner.sizeBytes === pending.record.blob.size
  ) {
    return "active";
  }
  return "conflict";
}

class SaveCoordinator {
  private failure: SaveFailure | undefined;
  private conflictSource: "broadcast" | "lease" | "save" | undefined;
  private durableCaseVersion: number | undefined;
  private readonly initialPersistenceSettled: Promise<void>;
  private resolveInitialPersistence: (() => void) | undefined;
  private currentCaseVersion: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(initialCaseVersion: number) {
    this.currentCaseVersion = initialCaseVersion;
    this.initialPersistenceSettled = new Promise((resolve) => {
      this.resolveInitialPersistence = resolve;
    });
  }

  private settleInitialPersistence(): void {
    this.resolveInitialPersistence?.();
    this.resolveInitialPersistence = undefined;
  }

  getFailure(): SaveFailure | undefined {
    return this.failure;
  }

  setFailure(failure: SaveFailure | undefined): void {
    this.failure = failure;
    if (failure) this.settleInitialPersistence();
  }

  getConflictSource(): "broadcast" | "lease" | "save" | undefined {
    return this.conflictSource;
  }

  setConflictSource(source: "broadcast" | "lease" | "save" | undefined): void {
    this.conflictSource = source;
    if (source) this.settleInitialPersistence();
  }

  getDurableCaseVersion(): number | undefined {
    return this.durableCaseVersion;
  }

  recordDurableCaseVersion(caseVersion: number): void {
    this.durableCaseVersion = caseVersion;
    this.settleInitialPersistence();
  }

  getCurrentCaseVersion(): number {
    return this.currentCaseVersion;
  }

  setCurrentCaseVersion(caseVersion: number): void {
    this.currentCaseVersion = caseVersion;
  }

  enqueue(operation: () => Promise<void>): Promise<void> {
    const attempt = this.queue.then(operation);
    this.queue = attempt.catch(() => undefined);
    return attempt;
  }

  async whenIdle(): Promise<void> {
    // A newly mounted workspace can be visible before its editing lease has
    // resolved and therefore before the initial persistence check is queued.
    // Do not let route guards mistake that preflight window for an idle queue.
    // Success, failure, and conflict all settle this gate so callers can make
    // the normal durable-version decision without hanging on a failed save.
    await this.initialPersistenceSettled;
    // A user action can enqueue another save while an earlier write is still
    // settling. Drain until the queue reference is stable so navigation never
    // races a newly queued revision.
    let pending = this.queue;
    await pending;
    while (pending !== this.queue) {
      pending = this.queue;
      await pending;
    }
  }
}

const inspectorModes = new Set<InspectorTab>([
  "facts",
  "evidence",
  "questions",
  "hypotheses",
  "report",
]);

const TIME_EQUALITY_EPSILON_MS = 0.001;

function formatWorkspaceSeconds(timeMs: number): string {
  const normalizedTimeMs = Math.round(timeMs);
  return (normalizedTimeMs / 1000).toFixed(normalizedTimeMs % 100 === 0 ? 1 : 3);
}

function humanMeta() {
  return { actor: "human" as const, origin: "ui" as const };
}

function downloadErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The export could not be completed.";
}

function commandFailureDetail(
  result: Extract<ReplayCommandResult, { ok: false }>,
): string | undefined {
  if (result.error.lockedItem) {
    const alternatives = result.error.lockedItem.allowedAlternatives.join(", ");
    return `Locked by ${result.error.lockedItem.lockedBy}${result.error.lockedItem.reason ? `: ${result.error.lockedItem.reason}` : ""}. Available: ${alternatives}.`;
  }
  if (result.error.code === "VERSION_CONFLICT")
    return "The case changed since this action was prepared. Review the current state and try again.";
  return undefined;
}

function toTrajectoryKeyframeInput(frame: ReplayCase["trajectories"][number]["keyframes"][number]) {
  return {
    id: frame.id,
    timeMs: frame.timeMs,
    x: frame.x,
    y: frame.y,
    rotationDeg: frame.rotationDeg,
  };
}

function workspaceModeForItem(type: WorkspaceItemType): ReplayCase["workspaceMode"] {
  if (type === "actor" || type === "trajectory" || type === "timeline-event") return "scene";
  if (type === "claim") return "facts";
  if (type === "evidence") return "evidence";
  if (type === "question") return "questions";
  if (type === "hypothesis") return "hypotheses";
  return "report";
}

type VisibleWorkspaceSelection =
  NonNullable<ReplayCase["selectedItem"]> | Readonly<{ type: "issue"; id: string }>;

function workspaceModeForSelection(
  selection: VisibleWorkspaceSelection,
): ReplayCase["workspaceMode"] {
  return selection.type === "issue" ? "report" : workspaceModeForItem(selection.type);
}

class WorkspaceFocusStore {
  private workspaceMode: ReplayCase["workspaceMode"];
  private selectedItem: VisibleWorkspaceSelection | undefined;

  constructor(
    workspaceMode: ReplayCase["workspaceMode"],
    selectedItem: ReplayCase["selectedItem"],
  ) {
    this.workspaceMode = workspaceMode;
    this.selectedItem = selectedItem;
  }

  changeMode(workspaceMode: ReplayCase["workspaceMode"]): void {
    this.workspaceMode = workspaceMode;
    if (this.selectedItem && workspaceModeForSelection(this.selectedItem) !== workspaceMode) {
      this.selectedItem = undefined;
    }
  }

  focusItem(item: NonNullable<ReplayCase["selectedItem"]>): void {
    this.workspaceMode = workspaceModeForItem(item.type);
    this.selectedItem = item;
  }

  focusIssue(issueId: string): void {
    this.workspaceMode = "report";
    this.selectedItem = { type: "issue", id: issueId };
  }

  getSnapshot(): Readonly<{
    workspaceMode: ReplayCase["workspaceMode"];
    selectedItem?: VisibleWorkspaceSelection | undefined;
  }> {
    return {
      workspaceMode: this.workspaceMode,
      ...(this.selectedItem ? { selectedItem: this.selectedItem } : {}),
    };
  }
}

export function Workspace({
  initialCase,
  isDemo,
  experienceMode,
  onExperienceModeChange,
  onHome,
  onResetDemo,
  activeDemoScenarioId,
  onOpenDemoScenario,
  onRegisterLeaveGuard,
  onImportCase,
  startWithTour = false,
  onTourStarted,
}: WorkspaceProps) {
  const [engine] = useState(() => createReplayEngine(initialCase));
  const [replayCase, setReplayCase] = useState(() => engine.getState());
  const replayCaseRef = useRef(replayCase);
  const [currentTimeMs, setCurrentTimeMs] = useState(initialCase.timeRangeMs.start);
  const currentTimeMsRef = useRef(initialCase.timeRangeMs.start);
  const automaticImpactPauseRef = useRef<AutomaticImpactPause | undefined>(undefined);
  const resumedImpactEventIdRef = useRef<string | undefined>(undefined);
  const playbackSessionRef = useRef(0);
  const setPlayheadTime = useCallback((timeMs: number) => {
    const automaticImpactPause = automaticImpactPauseRef.current;
    if (!remainsAtAutomaticImpactPause(timeMs, automaticImpactPause)) {
      automaticImpactPauseRef.current = undefined;
    }
    currentTimeMsRef.current = timeMs;
    setCurrentTimeMs(timeMs);
  }, []);
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(DEFAULT_PLAYBACK_SPEED);
  const [activeTab, setActiveTab] = useState<InspectorTab>(() =>
    inspectorModes.has(initialCase.workspaceMode as InspectorTab)
      ? (initialCase.workspaceMode as InspectorTab)
      : "facts",
  );
  const [workspaceFocusStore] = useState(
    () => new WorkspaceFocusStore(initialCase.workspaceMode, initialCase.selectedItem),
  );
  const [selectedItem, setSelectedItem] = useState<ReplayCase["selectedItem"]>(
    initialCase.selectedItem,
  );
  const changeWorkspaceMode = useCallback(
    (mode: ReplayCase["workspaceMode"]) => {
      workspaceFocusStore.changeMode(mode);
      const nextSelection = workspaceFocusStore.getSnapshot().selectedItem;
      setSelectedItem(nextSelection?.type === "issue" ? undefined : nextSelection);
      if (inspectorModes.has(mode as InspectorTab)) setActiveTab(mode as InspectorTab);
    },
    [workspaceFocusStore],
  );
  const [compareBranchIds, setCompareBranchIds] = useState<string[]>([]);
  const changeExperienceMode = useCallback(
    (mode: ExperienceMode) => {
      onExperienceModeChange(mode);
      if (mode === "simple") {
        setCompareBranchIds([]);
        setShowDebug(false);
      }
    },
    [onExperienceModeChange],
  );
  const activeBranchIds = useMemo(
    () =>
      new Set(
        replayCase.branches
          .filter((branch) => branch.status === "active")
          .map((branch) => branch.id),
      ),
    [replayCase.branches],
  );
  const validCompareBranchIds = compareBranchIds.filter((branchId) =>
    activeBranchIds.has(branchId),
  );
  const displayedCompareBranchIds = validCompareBranchIds.length >= 2 ? validCompareBranchIds : [];
  useEffect(() => {
    if (compareBranchIds.length > 0 && validCompareBranchIds.length < 2) {
      setCompareBranchIds([]);
    }
  }, [compareBranchIds, validCompareBranchIds.length]);
  const [reportPreview, setReportPreview] = useState<ReportPreview>();
  const [selectedReportSnapshotId, setSelectedReportSnapshotId] = useState<string>();
  const reportPreviewRef = useRef<ReportPreview | undefined>(undefined);
  const selectedReportSnapshotIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    reportPreviewRef.current = reportPreview;
    selectedReportSnapshotIdRef.current = selectedReportSnapshotId;
  }, [reportPreview, selectedReportSnapshotId]);
  const [saveState, setSaveState] = useState<SaveState>("saving");
  const [saveFailure, setSaveFailure] = useState<SaveFailure>();
  const [saveCoordinator] = useState(() => new SaveCoordinator(initialCase.caseVersion));
  const [toast, setToast] = useState<ToastState>();
  const [agentAction, setAgentAction] = useState<string>();
  const [webMCPMutationActive, setWebMCPMutationActive] = useState(false);
  const [evidenceAttachmentSavePending, setEvidenceAttachmentSavePending] = useState(false);
  const [exportInFlight, setExportInFlight] = useState<"pdf" | "scene">();
  const exportInFlightRef = useRef(false);
  const [toolInvocationActivity, setToolInvocationActivity] = useState<ActivityEvent[]>([]);
  const [toolActivityStore] = useState<{ items: ActivityEvent[] }>(() => ({ items: [] }));
  const [activeAgentIds, setActiveAgentIds] = useState<string[]>([]);
  const [focusedIssueId, setFocusedIssueId] = useState<string>();
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string>();
  const [proposalReviewTarget, setProposalReviewTarget] = useState<ProposalReviewTarget>();
  const proposalSceneRef = useRef<HTMLDivElement>(null);
  const proposalReviewScrollFrameRef = useRef<number | undefined>(undefined);
  const changeInspectorTab = useCallback(
    (tab: InspectorTab) => {
      if (tab !== "report") setFocusedIssueId(undefined);
      setSelectedKeyframeId(undefined);
      changeWorkspaceMode(tab);
    },
    [changeWorkspaceMode],
  );
  const [revertingActivityId, setRevertingActivityId] = useState<string>();
  const [showDebug, setShowDebug] = useState(false);
  const [guideSection, setGuideSection] = useState<GuideSectionId>();
  const [tourStep, setTourStep] = useState<number | null>(() => (startWithTour ? 0 : null));
  const [confirmingDemoReset, setConfirmingDemoReset] = useState(false);
  const [confirmingLeaseTakeover, setConfirmingLeaseTakeover] = useState(false);
  const [pendingCaseImport, setPendingCaseImport] = useState<PendingCaseImport>();
  const [editingCaseDetails, setEditingCaseDetails] = useState(false);
  const [evidenceUrls, setEvidenceUrls] = useState<Record<string, string>>({});
  const evidenceUrlsRef = useRef<Record<string, string>>({});
  const activeImpactTimelineRef = useRef(
    initialCase.timelineEvents
      .filter((event) => event.branchId === initialCase.activeBranchId && event.type === "impact")
      .sort((left, right) => left.timeMs - right.timeMs),
  );
  const impactReplayWindowRef = useRef<
    | {
        eventId: string;
        startTimeMs: number;
        stopTimeMs: number;
        contactRendered: boolean;
        holdUntilPerformanceMs?: number;
      }
    | undefined
  >(undefined);
  const stopPlayback = useCallback(() => {
    playbackSessionRef.current += 1;
    impactReplayWindowRef.current = undefined;
    resumedImpactEventIdRef.current = undefined;
    isPlayingRef.current = false;
    setIsPlaying(false);
  }, []);
  const setPlaybackActive = useCallback(
    (playing: boolean) => {
      if (!playing) {
        stopPlayback();
        return;
      }
      if (!isPlayingRef.current) playbackSessionRef.current += 1;
      const impactAtPlayhead = activeImpactTimelineRef.current.find((event) =>
        remainsAtAutomaticImpactPause(currentTimeMsRef.current, {
          eventId: event.id,
          timeMs: event.timeMs,
        }),
      );
      const impactPauseAtPlayhead = impactAtPlayhead
        ? { eventId: impactAtPlayhead.id, timeMs: impactAtPlayhead.timeMs }
        : undefined;
      const resumeTimeMs = resumedPlayheadTime(
        currentTimeMsRef.current,
        automaticImpactPauseRef.current ?? impactPauseAtPlayhead,
        replayCaseRef.current.timeRangeMs.end,
      );
      if (resumeTimeMs !== undefined) {
        resumedImpactEventIdRef.current = (automaticImpactPauseRef.current ?? impactPauseAtPlayhead)
          ?.eventId;
        automaticImpactPauseRef.current = undefined;
        setPlayheadTime(resumeTimeMs);
      }
      isPlayingRef.current = true;
      setIsPlaying(true);
    },
    [setPlayheadTime, stopPlayback],
  );
  const pendingEvidenceBlobDeletionsRef = useRef(
    new Map<string, { evidenceId: string; blobKey: string }>(),
  );
  const pendingEvidenceAttachmentsRef = useRef(new Map<string, PendingEvidenceAttachment>());
  const pendingAutomaticSaveRef = useRef<ReplayCase | undefined>(undefined);
  const automaticSaveRunnerRef = useRef<Promise<void> | undefined>(undefined);
  const skipNextAutomaticSaveRef = useRef(false);
  const webMCPMutationDepthRef = useRef(0);
  const evidenceAttachmentSavePendingRef = useRef(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const registryRef = useRef<ReplayWebMCPRegistry | undefined>(undefined);
  const workspaceSessionActiveRef = useRef(true);
  const workspaceTransitionPendingRef = useRef(false);
  const [writerId] = useState(() => `writer-${crypto.randomUUID()}`);
  const [writeAccess, setWriteAccess] = useState<WriteAccess>(() =>
    getLockManager() ? "checking" : "writable",
  );
  const [leaseTakeoverPending, setLeaseTakeoverPending] = useState(false);
  const [externalConflict, setExternalConflict] = useState<string>();
  const saveFailureIsBlocking = Boolean(saveFailure);
  const mutationBlockReason =
    externalConflict ??
    (writeAccess === "checking"
      ? "REPLAY is acquiring the local editing lease. Try again in a moment."
      : writeAccess === "blocked"
        ? "Another page context owns this case. Reload after closing it, or use the visible takeover action if no other copy is actively editing."
        : saveFailureIsBlocking
          ? `Local saving failed at case version ${saveFailure?.caseVersion}. Editing and Site Tools are paused until local saving succeeds.`
          : undefined);
  const humanMutationBlockReason = webMCPMutationActive
    ? WEBMCP_MUTATION_IN_FLIGHT_MESSAGE
    : (mutationBlockReason ??
      (evidenceAttachmentSavePending ? EVIDENCE_ATTACHMENT_SAVE_PENDING_MESSAGE : undefined));
  const mutationBlockReasonRef = useRef(mutationBlockReason);
  const humanMutationBlockReasonRef = useRef(humanMutationBlockReason);

  useEffect(() => {
    mutationBlockReasonRef.current = mutationBlockReason;
  }, [mutationBlockReason]);

  useEffect(() => {
    humanMutationBlockReasonRef.current = humanMutationBlockReason;
  }, [humanMutationBlockReason]);

  useEffect(() => {
    if (!proposalReviewTarget) return;
    const proposal = replayCase.proposals.find(
      (candidate) =>
        candidate.id === proposalReviewTarget.proposalId && candidate.status === "pending",
    );
    const revision = proposal?.revisions.at(-1);
    const change = revision?.changes.find(
      (candidate) => candidate.id === proposalReviewTarget.changeId,
    );
    const reviewedKeyframe =
      change?.kind === "trajectory-set" && proposalReviewTarget.keyframeId
        ? (change.proposedTrajectory.keyframes.find(
            (keyframe) => keyframe.id === proposalReviewTarget.keyframeId,
          ) ??
          change.baseTrajectory?.keyframes.find(
            (keyframe) => keyframe.id === proposalReviewTarget.keyframeId,
          ))
        : undefined;
    const expectedProposalTimeMs =
      change?.kind === "actor-pose" ? change.targetTimeMs : reviewedKeyframe?.timeMs;
    if (
      revision?.id !== proposalReviewTarget.revisionId ||
      !change?.branchId ||
      change.branchId !== proposalReviewTarget.branchId ||
      expectedProposalTimeMs === undefined ||
      expectedProposalTimeMs !== proposalReviewTarget.proposalTimeMs ||
      (proposalReviewTarget.keyframeId !== undefined && !reviewedKeyframe)
    ) {
      setProposalReviewTarget(undefined);
      return;
    }
    const resolved = resolveProposalReviewRequest(proposalReviewTarget, {
      activeBranchId: replayCase.activeBranchId,
      timeRangeMs: replayCase.timeRangeMs,
    });
    if (!resolved.ok) {
      setProposalReviewTarget(undefined);
      return;
    }
    if (resolved.target.reviewTimeMs !== proposalReviewTarget.reviewTimeMs) {
      setProposalReviewTarget(resolved.target);
      setPlayheadTime(resolved.target.reviewTimeMs);
    }
  }, [proposalReviewTarget, replayCase, setPlayheadTime]);

  useEffect(
    () => () => {
      if (proposalReviewScrollFrameRef.current !== undefined) {
        window.cancelAnimationFrame(proposalReviewScrollFrameRef.current);
      }
    },
    [],
  );

  function synchronizePendingEvidenceAttachmentGate(): void {
    const pending = pendingEvidenceAttachmentsRef.current.size > 0;
    evidenceAttachmentSavePendingRef.current = pending;
    humanMutationBlockReasonRef.current =
      webMCPMutationDepthRef.current > 0
        ? WEBMCP_MUTATION_IN_FLIGHT_MESSAGE
        : (mutationBlockReasonRef.current ??
          (pending ? EVIDENCE_ATTACHMENT_SAVE_PENDING_MESSAGE : undefined));
    setEvidenceAttachmentSavePending(pending);
  }

  useEffect(() => {
    if (startWithTour) onTourStarted?.();
  }, [onTourStarted, startWithTour]);

  useEffect(() => {
    workspaceSessionActiveRef.current = true;
    return () => {
      workspaceSessionActiveRef.current = false;
    };
  }, []);

  useEffect(() => {
    const guard = async (): Promise<boolean> => {
      if (workspaceTransitionPendingRef.current) return false;
      workspaceTransitionPendingRef.current = true;
      try {
        await saveCoordinator.whenIdle();
        const currentVersion = replayCaseRef.current.caseVersion;
        const durableVersion = saveCoordinator.getDurableCaseVersion();
        const safeToLeave =
          workspaceSessionActiveRef.current &&
          !saveCoordinator.getFailure() &&
          !saveCoordinator.getConflictSource() &&
          durableVersion === currentVersion;
        if (!safeToLeave && workspaceSessionActiveRef.current) {
          setToast({
            kind: "error",
            message:
              "Navigation was cancelled because the current case is not safely stored. Resolve the local save or editing-conflict notice first.",
            detail:
              durableVersion === undefined
                ? "Wait for the initial local save, then try again."
                : `The open case is v${String(currentVersion)}, but only v${String(durableVersion)} is confirmed in the local vault.`,
          });
        }
        return safeToLeave;
      } finally {
        workspaceTransitionPendingRef.current = false;
      }
    };
    onRegisterLeaveGuard(guard);
    return () => onRegisterLeaveGuard(undefined);
  }, [onRegisterLeaveGuard, saveCoordinator]);

  useEffect(() => {
    if (saveState === "saved" && !saveFailure) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [saveFailure, saveState]);

  const recordSaveSuccess = useCallback(
    (caseVersion: number) => {
      saveCoordinator.recordDurableCaseVersion(caseVersion);
      const activeFailure = saveCoordinator.getFailure();
      const resolvesFailure = (failure: SaveFailure) =>
        caseVersion >= failure.caseVersion ||
        caseVersion === saveCoordinator.getCurrentCaseVersion();
      if (activeFailure && resolvesFailure(activeFailure)) {
        saveCoordinator.setFailure(undefined);
      }
      setSaveFailure((current) => (current && resolvesFailure(current) ? undefined : current));
      if (saveCoordinator.getCurrentCaseVersion() <= caseVersion) setSaveState("saved");
    },
    [saveCoordinator],
  );

  const recordSaveFailure = useCallback(
    (error: unknown, caseVersion: number) => {
      if (saveCoordinator.getDurableCaseVersion() === caseVersion) return;
      setSaveState("error");
      if (error instanceof LocalVaultConflictError) {
        saveCoordinator.setConflictSource("save");
        setExternalConflict(error.message);
        setWriteAccess("blocked");
        return;
      }
      const detail =
        error instanceof Error ? error.message : "The browser did not provide a failure reason.";
      const failure = {
        caseVersion,
        expectedCaseVersion:
          saveCoordinator.getDurableCaseVersion() ?? Math.max(0, caseVersion - 1),
        message: `Browser storage is not confirmed for the current case at version ${caseVersion}. ${detail}`,
      };
      saveCoordinator.setFailure(failure);
      setSaveFailure(failure);
    },
    [saveCoordinator],
  );

  const performCaseSave = useCallback(
    (
      state: ReplayCase,
      options: SaveCaseOptions,
      { allowWhilePaused = false }: { allowWhilePaused?: boolean } = {},
    ): Promise<void> => {
      const activeConflict = saveCoordinator.getConflictSource();
      if (activeConflict) {
        throw new Error(
          `Local saving is paused after a ${activeConflict} conflict. Reload the latest saved case before writing again.`,
        );
      }
      const activeFailure = saveCoordinator.getFailure();
      if (activeFailure && !allowWhilePaused) {
        throw new Error(
          `Local saving is paused after case version ${activeFailure.caseVersion} failed.`,
        );
      }
      setSaveState("saving");
      return saveCase(state, options).then(
        () => recordSaveSuccess(state.caseVersion),
        (error: unknown) => {
          recordSaveFailure(error, state.caseVersion);
          throw error;
        },
      );
    },
    [recordSaveFailure, recordSaveSuccess, saveCoordinator],
  );

  const enqueueCaseSave = useCallback(
    (
      state: ReplayCase,
      options: SaveCaseOptions,
      controls: { allowWhilePaused?: boolean } = {},
    ): Promise<void> => saveCoordinator.enqueue(() => performCaseSave(state, options, controls)),
    [performCaseSave, saveCoordinator],
  );

  const enqueueAutomaticCaseSave = useCallback(
    function enqueueAutomaticCaseSave(state: ReplayCase): void {
      pendingAutomaticSaveRef.current = state;
      if (automaticSaveRunnerRef.current) return;
      const runner = saveCoordinator.enqueue(async () => {
        while (pendingAutomaticSaveRef.current) {
          const latest = pendingAutomaticSaveRef.current;
          pendingAutomaticSaveRef.current = undefined;
          const durableCaseVersion = saveCoordinator.getDurableCaseVersion();
          if (durableCaseVersion !== undefined && latest.caseVersion <= durableCaseVersion) {
            continue;
          }
          await performCaseSave(latest, {
            writerId,
            ...(durableCaseVersion === undefined
              ? {}
              : { expectedCaseVersion: durableCaseVersion }),
          });
        }
      });
      automaticSaveRunnerRef.current = runner;
      void runner
        .catch(() => {
          // A failed write pauses editing and retry persists the newest live
          // snapshot. Do not retain obsolete intermediate revisions in memory.
          pendingAutomaticSaveRef.current = undefined;
        })
        .finally(() => {
          if (automaticSaveRunnerRef.current === runner) {
            automaticSaveRunnerRef.current = undefined;
          }
          const pending = pendingAutomaticSaveRef.current;
          if (pending && !saveCoordinator.getFailure() && !saveCoordinator.getConflictSource()) {
            enqueueAutomaticCaseSave(pending);
          }
        });
    },
    [performCaseSave, saveCoordinator, writerId],
  );

  useEffect(() => {
    const locks = getLockManager();
    if (!locks) return;
    let disposed = false;
    let releaseLease: (() => void) | undefined;
    let retryTimer: number | undefined;

    const acquireLease = (attempt: number): void => {
      void locks
        .request(
          `replay-case-writer:${initialCase.id}`,
          { mode: "exclusive", ifAvailable: true },
          async (lock) => {
            if (disposed) return;
            if (!lock) {
              const retryDelay = LEASE_HANDOFF_RETRY_DELAYS_MS[attempt];
              if (retryDelay !== undefined) {
                retryTimer = window.setTimeout(() => acquireLease(attempt + 1), retryDelay);
                return;
              }
              saveCoordinator.setConflictSource("lease");
              setExternalConflict(CASE_WRITE_LEASE_CONFLICT_MESSAGE);
              setWriteAccess("blocked");
              return;
            }
            setWriteAccess("writable");
            await new Promise<void>((resolve) => {
              releaseLease = resolve;
            });
          },
        )
        .catch((error: unknown) => {
          if (disposed) return;
          if (error instanceof DOMException && error.name === "AbortError") {
            saveCoordinator.setConflictSource("lease");
            setExternalConflict(CASE_WRITE_LEASE_CONFLICT_MESSAGE);
            setWriteAccess("blocked");
            return;
          }
          // A browser implementation failure must not make the complete manual
          // workspace unusable; CAS persistence remains the fallback guard.
          setWriteAccess("writable");
        });
    };

    acquireLease(0);
    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      releaseLease?.();
    };
  }, [initialCase.id, saveCoordinator]);

  const takeOverWriteLease = useCallback(() => {
    const locks = getLockManager();
    if (!locks) {
      window.location.reload();
      return;
    }
    setLeaseTakeoverPending(true);
    setWriteAccess("checking");
    void locks
      .request(
        `replay-case-writer:${initialCase.id}`,
        { mode: "exclusive", steal: true },
        async () => {
          // Reload only after the browser has transferred ownership. App
          // hydration then reads the newest durable case, while IndexedDB CAS
          // remains the backstop for a previous editor's in-flight save.
          await new Promise<void>((resolve) => {
            window.addEventListener("pagehide", () => resolve(), { once: true });
            window.location.reload();
          });
        },
      )
      .catch((error: unknown) => {
        setLeaseTakeoverPending(false);
        setConfirmingLeaseTakeover(false);
        setWriteAccess("blocked");
        const detail =
          error instanceof Error ? error.message : "The browser did not provide a reason.";
        setExternalConflict(
          `REPLAY could not take over the editing lease. ${detail} Close any other REPLAY window and try again.`,
        );
      });
  }, [initialCase.id]);

  useEffect(() => {
    if (writeAccess !== "writable") return;
    void enqueueCaseSave(engine.getState(), { writerId }).catch(() => undefined);
    return engine.subscribe((state, result) => {
      saveCoordinator.setCurrentCaseVersion(state.caseVersion);
      replayCaseRef.current = state;
      activeImpactTimelineRef.current = state.timelineEvents
        .filter((event) => event.branchId === state.activeBranchId && event.type === "impact")
        .sort((left, right) => left.timeMs - right.timeMs);
      setReplayCase(state);
      const activity = state.activity.find((item) => item.id === result.activityId);
      if (activity) {
        setReportPreview(undefined);
        setSelectedReportSnapshotId(undefined);
      }
      const skipAutomaticSave = skipNextAutomaticSaveRef.current;
      skipNextAutomaticSaveRef.current = false;
      if (!skipAutomaticSave) {
        enqueueAutomaticCaseSave(state);
      }
    });
  }, [engine, enqueueAutomaticCaseSave, enqueueCaseSave, saveCoordinator, writeAccess, writerId]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const handleMessage = (event: MessageEvent<unknown>) => {
      const update =
        typeof event.data === "object" && event.data !== null && !Array.isArray(event.data)
          ? (event.data as Record<string, unknown>)
          : undefined;
      if (
        update?.caseId !== initialCase.id ||
        update.writerId === writerId ||
        !Number.isInteger(update.caseVersion) ||
        (update.caseVersion as number) < 0 ||
        typeof update.updatedAt !== "string" ||
        !Number.isFinite(Date.parse(update.updatedAt)) ||
        (update.caseVersion === replayCaseRef.current.caseVersion &&
          update.updatedAt === replayCaseRef.current.updatedAt)
      )
        return;
      const message = `Another REPLAY page saved case version ${update.caseVersion as number}. Reload before editing so no human or agent work is overwritten.`;
      saveCoordinator.setConflictSource("broadcast");
      setExternalConflict(message);
      setWriteAccess("blocked");
    };
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel("replay-local-vault-updates");
      channel.addEventListener("message", handleMessage);
    } catch {
      // IndexedDB compare-and-swap remains the write-safety backstop when the
      // browser exposes BroadcastChannel but cannot construct or subscribe it.
      try {
        channel?.close();
      } catch {
        // The advisory channel is already unusable.
      }
      return;
    }
    return () => {
      try {
        channel.close();
      } catch {
        // Closing an advisory channel must not affect the workspace.
      }
    };
  }, [initialCase.id, saveCoordinator, writerId]);

  useEffect(() => {
    let disposed = false;
    const createdUrls: string[] = [];
    void Promise.all(
      initialCase.evidence
        .filter((asset) => !asset.deleted && asset.localBlobKey.startsWith("evidence:"))
        .map(async (asset) => {
          try {
            const blob = await loadEvidenceBlob(asset.localBlobKey, {
              caseId: initialCase.id,
              checksum: asset.checksum,
              mimeType: asset.mimeType,
            });
            if (!blob || disposed) return;
            const url = URL.createObjectURL(blob);
            createdUrls.push(url);
            setEvidenceUrls((current) => {
              const next = { ...current, [asset.id]: url };
              evidenceUrlsRef.current = next;
              return next;
            });
          } catch {
            if (!disposed) {
              setToast({
                kind: "error",
                message: `Evidence integrity check failed for ${asset.name}. The image was not displayed.`,
              });
            }
          }
        }),
    );
    return () => {
      disposed = true;
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [initialCase.evidence, initialCase.id]);

  useEffect(
    () => () => {
      for (const url of new Set(Object.values(evidenceUrlsRef.current))) URL.revokeObjectURL(url);
    },
    [],
  );

  useEffect(() => {
    if (!toast || toast.kind === "error") return;
    const timer = window.setTimeout(() => setToast(undefined), 4_200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!isPlaying) impactReplayWindowRef.current = undefined;
  }, [isPlaying]);

  useEffect(() => {
    if (!isPlaying) return;
    let animationFrame = 0;
    let previous = performance.now();
    const playbackSession = playbackSessionRef.current;
    const tick = (now: number) => {
      if (playbackSessionRef.current !== playbackSession) return;
      const elapsed = (now - previous) * playbackSpeed;
      previous = now;
      const current = currentTimeMsRef.current;
      const next = current + elapsed;
      const impactReplayWindow = impactReplayWindowRef.current;
      if (
        impactReplayWindow?.holdUntilPerformanceMs !== undefined &&
        now < impactReplayWindow.holdUntilPerformanceMs
      ) {
        if (playbackSessionRef.current === playbackSession) {
          animationFrame = requestAnimationFrame(tick);
        }
        return;
      }
      const activeImpacts = activeImpactTimelineRef.current;
      const replayImpact = impactReplayWindow
        ? activeImpacts.find((event) => event.id === impactReplayWindow.eventId)
        : undefined;
      if (
        impactReplayWindow &&
        replayImpact &&
        !impactReplayWindow.contactRendered &&
        current < replayImpact.timeMs &&
        next >= replayImpact.timeMs
      ) {
        impactReplayWindow.contactRendered = true;
        impactReplayWindow.holdUntilPerformanceMs = now + IMPACT_REPLAY_CONTACT_HOLD_MS;
        setPlayheadTime(replayImpact.timeMs);
        if (playbackSessionRef.current === playbackSession) {
          animationFrame = requestAnimationFrame(tick);
        }
        return;
      }
      if (impactReplayWindow && next >= impactReplayWindow.stopTimeMs) {
        setPlayheadTime(impactReplayWindow.stopTimeMs);
        stopPlayback();
        setToast({
          kind: "info",
          message: "Authored impact sequence complete.",
          detail:
            "The motion shown is authored timed geometry for review, not a generated collision response or finding of cause.",
        });
        return;
      }
      let lowerBound = 0;
      let upperBound = activeImpacts.length;
      while (lowerBound < upperBound) {
        const midpoint = Math.floor((lowerBound + upperBound) / 2);
        if ((activeImpacts[midpoint]?.timeMs ?? Number.POSITIVE_INFINITY) <= current + 0.5) {
          lowerBound = midpoint + 1;
        } else {
          upperBound = midpoint;
        }
      }
      let crossedImpact = activeImpacts[lowerBound];
      if (crossedImpact && crossedImpact.timeMs > next) crossedImpact = undefined;
      if (crossedImpact?.id === resumedImpactEventIdRef.current) {
        resumedImpactEventIdRef.current = undefined;
        crossedImpact = activeImpacts[lowerBound + 1];
        if (crossedImpact && crossedImpact.timeMs > next) crossedImpact = undefined;
      }
      if (crossedImpact) {
        automaticImpactPauseRef.current = {
          eventId: crossedImpact.id,
          timeMs: crossedImpact.timeMs,
        };
        setPlayheadTime(crossedImpact.timeMs);
        stopPlayback();
        setToast({
          kind: "info",
          message: "Paused at the impact event for geometry review.",
          detail: "Press play again to continue through the authored post-impact positions.",
        });
        return;
      }
      if (next >= replayCaseRef.current.timeRangeMs.end) {
        setPlayheadTime(replayCaseRef.current.timeRangeMs.end);
        stopPlayback();
        return;
      }
      setPlayheadTime(next);
      const resumedImpactEventId = resumedImpactEventIdRef.current;
      if (resumedImpactEventId) {
        const resumedImpact = activeImpacts.find((event) => event.id === resumedImpactEventId);
        if (!resumedImpact || next > resumedImpact.timeMs) {
          resumedImpactEventIdRef.current = undefined;
        }
      }
      if (playbackSessionRef.current === playbackSession) {
        animationFrame = requestAnimationFrame(tick);
      }
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [isPlaying, playbackSpeed, setPlayheadTime, stopPlayback]);

  const revealAffected = useCallback((ids: readonly string[]) => {
    setActiveAgentIds([...ids]);
    window.setTimeout(
      () => setActiveAgentIds((current) => (current.some((id) => ids.includes(id)) ? [] : current)),
      1_800,
    );
  }, []);

  const focusConsistencyIssue = useCallback(
    (issueId: string, affectedIds: readonly string[]) => {
      workspaceFocusStore.focusIssue(issueId);
      setFocusedIssueId(issueId);
      changeWorkspaceMode("report");
      revealAffected(affectedIds);
    },
    [changeWorkspaceMode, revealAffected, workspaceFocusStore],
  );

  const focusVisibleItem = useCallback(
    (type: WorkspaceItemType, itemId: string, keyframeId?: string) => {
      setSelectedKeyframeId(keyframeId);
      if (type === "timeline-event") {
        const event = replayCaseRef.current.timelineEvents.find((item) => item.id === itemId);
        if (event) {
          stopPlayback();
          setPlayheadTime(event.timeMs);
        }
      }
      setFocusedIssueId(undefined);
      const current = workspaceFocusStore.getSnapshot().selectedItem;
      const next = { type, id: itemId };
      workspaceFocusStore.focusItem(next);
      if (current?.type !== type || current.id !== itemId) {
        setSelectedItem(next);
      }
      changeWorkspaceMode(workspaceModeForItem(type));
    },
    [changeWorkspaceMode, setPlayheadTime, stopPlayback, workspaceFocusStore],
  );

  const recordToolInvocation = useCallback(
    (audit: ReplayToolInvocationAudit) => {
      const label = audit.toolName.replaceAll("_", " ");
      const activity: ActivityEvent = {
        id: `activity-tool-${crypto.randomUUID()}`,
        caseVersion: audit.caseVersion,
        author: "agent",
        origin: "webmcp",
        actionType: `webmcp.${audit.toolName}`,
        summary: `${audit.ok ? "Ran" : "Failed"} ${label}: ${audit.message}`,
        affectedIds: [...audit.affectedIds],
        ...(audit.requestId === undefined ? {} : { requestId: audit.requestId }),
        undoable: false,
        createdAt: new Date().toISOString(),
      };
      setToolInvocationActivity((current) => {
        const next = [...current, activity].slice(-100);
        toolActivityStore.items = next;
        return next;
      });
    },
    [toolActivityStore],
  );

  const [debugState, setDebugState] = useState<WebMCPDebugState>({
    supported: false,
    canSimulate: false,
    lifecycleMode: "closed",
    caseVersion: initialCase.caseVersion,
    registeredToolNames: [],
    tools: [],
  });

  useEffect(() => {
    const adapter = createReplayWebMCPAdapter(engine, {
      getCase: () => engine.getState(),
      getVisibleWorkspace: () => workspaceFocusStore.getSnapshot(),
      getPlayheadTimeMs: () => currentTimeMsRef.current,
      getReportPreview: () => reportPreviewRef.current,
      getSelectedReportSnapshotId: () => selectedReportSnapshotIdRef.current,
      persistCase: async (state, options) => {
        await enqueueCaseSave(
          state,
          {
            writerId,
            expectedCaseVersion: options.expectedCaseVersion,
          },
          {
            allowWhilePaused: options.compensation === true,
          },
        );
        if (options.compensation && saveCoordinator.getConflictSource() === "save") {
          saveCoordinator.setConflictSource(undefined);
          setExternalConflict(undefined);
          setWriteAccess("writable");
        }
      },
      setReportPreview: (preview) => {
        setReportPreview(preview);
        setSelectedReportSnapshotId(undefined);
        changeWorkspaceMode("report");
      },
      setAgentWorking: (active, toolName) =>
        setAgentAction(active ? toolName?.replaceAll("_", " ") : undefined),
      setMutationTransactionActive: (active) => {
        webMCPMutationDepthRef.current = Math.max(
          0,
          webMCPMutationDepthRef.current + (active ? 1 : -1),
        );
        const transactionActive = webMCPMutationDepthRef.current > 0;
        humanMutationBlockReasonRef.current = transactionActive
          ? WEBMCP_MUTATION_IN_FLIGHT_MESSAGE
          : (mutationBlockReasonRef.current ??
            (evidenceAttachmentSavePendingRef.current
              ? EVIDENCE_ATTACHMENT_SAVE_PENDING_MESSAGE
              : undefined));
        setWebMCPMutationActive(transactionActive);
      },
      revealAffected,
      focusWorkspaceItem: (itemType, itemId, workspaceMode) => {
        focusVisibleItem(itemType === "event" ? "timeline-event" : itemType, itemId);
        changeWorkspaceMode(workspaceMode);
      },
      focusIssue: focusConsistencyIssue,
      setComparison: setCompareBranchIds,
      getVisibleActivity: () => [...engine.getState().activity, ...toolActivityStore.items],
      recordToolInvocation,
      getMutationBlockReason: () =>
        mutationBlockReasonRef.current ??
        (evidenceAttachmentSavePendingRef.current
          ? EVIDENCE_ATTACHMENT_SAVE_PENDING_MESSAGE
          : undefined),
    });
    const activeRegistry = new ReplayWebMCPRegistry(adapter);
    registryRef.current = activeRegistry;
    const unsubscribe = activeRegistry.subscribeDebug(setDebugState);
    void activeRegistry.start();
    return () => {
      unsubscribe();
      activeRegistry.stop();
      if (registryRef.current === activeRegistry) registryRef.current = undefined;
    };
  }, [
    engine,
    changeWorkspaceMode,
    enqueueCaseSave,
    focusConsistencyIssue,
    focusVisibleItem,
    recordToolInvocation,
    revealAffected,
    saveCoordinator,
    toolActivityStore,
    workspaceFocusStore,
    writerId,
  ]);

  useEffect(() => {
    // Preview/snapshot visibility changes only affect the report tool group.
    // Keep the registry alive so in-flight base tools are never aborted or
    // needlessly re-registered during this UI-only lifecycle transition.
    void registryRef.current?.reconcile();
  }, [reportPreview, selectedReportSnapshotId]);

  const runCommand = useCallback(
    (
      command: Record<string, unknown>,
      quiet = false,
      persistence: "automatic" | "manual" = "automatic",
    ): ReplayCommandResult => {
      const blockedReason = humanMutationBlockReasonRef.current;
      if (blockedReason) {
        setToast({ kind: "error", message: blockedReason });
        return {
          ok: false,
          caseVersion: replayCaseRef.current.caseVersion,
          affectedIds: [],
          issues: replayCaseRef.current.consistencyIssues,
          message: blockedReason,
          error: { code: "VERSION_CONFLICT", message: blockedReason },
        };
      }
      if (persistence === "manual") skipNextAutomaticSaveRef.current = true;
      const result = engine.execute({ ...humanMeta(), ...command });
      if (!result.ok && persistence === "manual") skipNextAutomaticSaveRef.current = false;
      if (!result.ok) {
        const detail = commandFailureDetail(result);
        setToast({ kind: "error", message: result.message, ...(detail ? { detail } : {}) });
      } else if (!quiet) setToast({ kind: "success", message: result.message });
      return result;
    },
    [engine],
  );

  function removeEvidenceUrl(evidenceId: string): void {
    setEvidenceUrls((current) => {
      const url = current[evidenceId];
      if (url) URL.revokeObjectURL(url);
      const next = Object.fromEntries(Object.entries(current).filter(([id]) => id !== evidenceId));
      evidenceUrlsRef.current = next;
      return next;
    });
  }

  function registerEvidenceUrl(evidenceId: string, blob: Blob): void {
    const url = URL.createObjectURL(blob);
    setEvidenceUrls((current) => {
      const previous = current[evidenceId];
      if (previous) URL.revokeObjectURL(previous);
      const next = { ...current, [evidenceId]: url };
      evidenceUrlsRef.current = next;
      return next;
    });
  }

  async function flushPendingEvidenceBlobDeletions(): Promise<boolean> {
    let complete = true;
    for (const pending of [...pendingEvidenceBlobDeletionsRef.current.values()]) {
      const activeKeyOwner = replayCaseRef.current.evidence.some(
        (asset) => !asset.deleted && asset.localBlobKey === pending.blobKey,
      );
      if (activeKeyOwner) continue;
      try {
        await completeEvidenceBlobPurge(pending.blobKey, replayCaseRef.current.id);
        pendingEvidenceBlobDeletionsRef.current.delete(pending.blobKey);
        removeEvidenceUrl(pending.evidenceId);
      } catch {
        complete = false;
      }
    }
    return complete;
  }

  async function retryLocalSave(): Promise<void> {
    try {
      const failedSave = saveCoordinator.getFailure();
      if (!failedSave) return;
      const pendingAttachments = [...pendingEvidenceAttachmentsRef.current.values()];
      const attachmentDispositions = pendingAttachments.map((pending) => ({
        pending,
        disposition: classifyPendingEvidenceAttachment(replayCaseRef.current, pending),
      }));
      const conflictingAttachment = attachmentDispositions.find(
        ({ disposition }) => disposition === "conflict",
      );
      if (conflictingAttachment) {
        setToast({
          kind: "error",
          message: "The pending evidence bytes no longer match the active evidence metadata.",
          detail:
            "REPLAY kept the bytes in this tab and did not overwrite or purge an active attachment. Reload the latest saved case before trying again.",
        });
        return;
      }
      const activeAttachments = attachmentDispositions.flatMap(({ pending, disposition }) =>
        disposition === "active" ? [pending] : [],
      );
      const activeAttachmentKeys = new Set(activeAttachments.map(({ record }) => record.key));
      for (const { pending, disposition } of attachmentDispositions) {
        if (disposition === "active") {
          pendingEvidenceBlobDeletionsRef.current.delete(pending.record.key);
          continue;
        }
        pendingEvidenceBlobDeletionsRef.current.set(pending.record.key, {
          evidenceId: pending.evidenceId,
          blobKey: pending.record.key,
        });
      }
      const pendingPurgeKeys = [...pendingEvidenceBlobDeletionsRef.current.keys()].filter(
        (key) => !activeAttachmentKeys.has(key),
      );
      await enqueueCaseSave(
        replayCaseRef.current,
        {
          writerId,
          expectedCaseVersion: failedSave.expectedCaseVersion,
          purgeEvidenceBlobKeys: pendingPurgeKeys,
          attachEvidenceBlobs: activeAttachments.map(({ record }) => record),
        },
        { allowWhilePaused: true },
      );
      for (const pending of activeAttachments) {
        registerEvidenceUrl(pending.evidenceId, pending.record.blob);
      }
      for (const pending of pendingAttachments) {
        pendingEvidenceAttachmentsRef.current.delete(pending.record.key);
      }
      synchronizePendingEvidenceAttachmentGate();
      const evidenceCleanupComplete = await flushPendingEvidenceBlobDeletions();
      setToast(
        evidenceCleanupComplete
          ? { kind: "success", message: "The current case is saved in the local vault." }
          : {
              kind: "error",
              message: "The case is saved. Deleted evidence bytes are queued for cleanup.",
              detail:
                "Reload REPLAY to retry cleanup. If cleanup repeatedly fails, clear this site's data before leaving the device.",
            },
      );
    } catch (error) {
      setToast({
        kind: "error",
        message:
          error instanceof LocalVaultConflictError
            ? error.message
            : "The local save still cannot be completed. Your in-tab case remains available.",
      });
    }
  }

  function downloadFailedSaveStructuredTransfer(): void {
    try {
      const state = replayCaseRef.current;
      exportCaseJson(state);
      setToast({
        kind: "info",
        message: `Downloaded a structured case transfer for case version ${state.caseVersion}.`,
        detail:
          "This file excludes evidence bytes and resets local trust attestations when imported. Editing remains paused until local saving succeeds.",
      });
    } catch (error) {
      setToast({ kind: "error", message: downloadErrorMessage(error) });
    }
  }

  function runHistoryAction(direction: "undo" | "redo"): void {
    const blockedReason = humanMutationBlockReasonRef.current;
    if (blockedReason) {
      setToast({ kind: "error", message: blockedReason });
      return;
    }
    const result = direction === "undo" ? engine.undo() : engine.redo();
    if (!result.ok) setToast({ kind: "error", message: result.message });
  }

  function selectItem(type: WorkspaceItemType, itemId: string, keyframeId?: string): void {
    focusVisibleItem(type, itemId, keyframeId);
  }

  function moveKeyframePosition(
    trajectoryId: string,
    keyframeId: string,
    x: number,
    y: number,
  ): void {
    stopPlayback();
    const state = engine.getState();
    const trajectory = state.trajectories.find((item) => item.id === trajectoryId);
    if (!trajectory) return;
    const position = clampScenePoint({ x, y }, state.environment.bounds);
    runCommand(
      {
        type: "trajectory.set",
        trajectoryId,
        actorId: trajectory.actorId,
        branchId: trajectory.branchId,
        keyframes: trajectory.keyframes.map((frame) => {
          const input = toTrajectoryKeyframeInput(frame);
          return frame.id === keyframeId ? { ...input, ...position } : input;
        }),
        visible: trajectory.visible,
      },
      true,
    );
  }

  function moveActorAtCurrentTime(
    actorId: string,
    pose: { x: number; y: number; rotationDeg: number },
  ): void {
    stopPlayback();
    const state = engine.getState();
    const boundedPose = {
      ...pose,
      ...clampScenePoint(pose, state.environment.bounds),
    };
    runCommand(
      {
        type: "actor.update-pose",
        actorId,
        pose: boundedPose,
        poseAt: {
          branchId: state.activeBranchId,
          timeMs: clampTimeToRange(currentTimeMs, state.timeRangeMs),
        },
      },
      true,
    );
  }

  function updateActorSpecs(
    actorId: string,
    update: {
      dimensions: { length: number; width: number };
      vehicleClass: ReplayCase["actors"][number]["vehicleClass"];
      dimensionsSource: ReplayCase["actors"][number]["dimensionsSource"];
      wheelbaseMeters?: number;
    },
  ): void {
    const actor = engine.getState().actors.find((item) => item.id === actorId);
    if (!actor) return;
    const sceneActor = structuredClone(actor);
    sceneActor.dimensions = structuredClone(update.dimensions);
    sceneActor.vehicleClass = update.vehicleClass;
    sceneActor.dimensionsSource = update.dimensionsSource;
    if (update.wheelbaseMeters === undefined) delete sceneActor.wheelbaseMeters;
    else sceneActor.wheelbaseMeters = update.wheelbaseMeters;
    runCommand({ type: "actor.upsert", sceneActor }, true);
  }

  function createTrajectory(actorId: string): void {
    const state = engine.getState();
    const actor = state.actors.find((item) => item.id === actorId);
    if (!actor) return;
    const existing = state.trajectories.find(
      (item) => item.actorId === actorId && item.branchId === state.activeBranchId,
    );
    if (existing) {
      selectItem("trajectory", existing.id);
      return;
    }
    const { start, end } = initialTrajectoryTimes(currentTimeMs, state.timeRangeMs);
    // Start with an eight-metre physical preview in the actor's heading. The
    // calibrated scene converts that distance back to editable coordinates.
    const { x: dx, y: dy } = sceneDeltaForMetricHeading(
      actor.pose.rotationDeg,
      8,
      state.environment,
    );
    const result = runCommand({
      type: "trajectory.set",
      actorId,
      branchId: state.activeBranchId,
      keyframes: [
        { timeMs: start, ...actor.pose },
        {
          timeMs: end,
          ...clampScenePoint(
            { x: actor.pose.x + dx, y: actor.pose.y + dy },
            state.environment.bounds,
          ),
          rotationDeg: actor.pose.rotationDeg,
        },
      ],
      visible: true,
    });
    if (result.ok) {
      const created = engine
        .getState()
        .trajectories.find(
          (item) => item.actorId === actorId && item.branchId === state.activeBranchId,
        );
      if (created) selectItem("trajectory", created.id);
    }
  }

  function markImpact(
    location: { x: number; y: number },
    context: { branchId: string; timeMs: number; actorIds: [string, string] },
  ): boolean {
    const state = engine.getState();
    const branch = state.branches.find(
      (candidate) => candidate.id === context.branchId && candidate.status === "active",
    );
    if (!branch || state.activeBranchId !== context.branchId) return false;
    const [firstActorId, secondActorId] = context.actorIds;
    if (
      firstActorId === secondActorId ||
      !state.actors.some((actor) => actor.id === firstActorId) ||
      !state.actors.some((actor) => actor.id === secondActorId)
    ) {
      return false;
    }
    const boundedLocation = clampScenePoint(location, state.environment.bounds);
    const branchImpacts = state.timelineEvents.filter(
      (item) => item.branchId === context.branchId && item.type === "impact",
    );
    const existingPairImpact = branchImpacts.find((item) => {
      const linkedActorIds = [...new Set(item.linkedActorIds)];
      return (
        linkedActorIds.length === 2 &&
        linkedActorIds.includes(firstActorId) &&
        linkedActorIds.includes(secondActorId)
      );
    });
    const onlyBranchImpact = branchImpacts.length === 1 ? branchImpacts[0] : undefined;
    const legacyImpact =
      !existingPairImpact && onlyBranchImpact && new Set(onlyBranchImpact.linkedActorIds).size > 2
        ? onlyBranchImpact
        : undefined;
    const existing = existingPairImpact ?? legacyImpact;
    return runCommand({
      type: "timeline.upsert",
      ...(existing ? { eventId: existing.id } : {}),
      branchId: context.branchId,
      timeMs: clampTimeToRange(context.timeMs, state.timeRangeMs),
      eventType: "impact",
      title: existing?.title ?? "Approximate contact",
      certainty: existing?.certainty ?? "uncertain",
      linkedActorIds: [firstActorId, secondActorId],
      linkedClaimIds: existing?.linkedClaimIds ?? [],
      linkedEvidenceIds: existing?.linkedEvidenceIds ?? [],
      location: boundedLocation,
    }).ok;
  }

  function addTimelineEvent(input: {
    branchId: string;
    timeMs: number;
    title: string;
    eventType: "actor-start" | "maneuver" | "observation" | "evidence" | "actor-stop";
    certainty: "reported" | "likely" | "uncertain" | "disputed" | "unknown";
    linkedActorIds: string[];
  }): boolean {
    const state = replayCaseRef.current;
    const branch = state.branches.find(
      (candidate) => candidate.id === input.branchId && candidate.status === "active",
    );
    if (!branch) return false;
    return runCommand({
      type: "timeline.upsert",
      ...input,
      branchId: input.branchId,
      timeMs: clampTimeToRange(input.timeMs, state.timeRangeMs),
      linkedClaimIds: [],
      linkedEvidenceIds: [],
    }).ok;
  }

  function moveKeyframeTime(trajectoryId: string, keyframeId: string, timeMs: number): void {
    const state = engine.getState();
    const trajectory = state.trajectories.find((item) => item.id === trajectoryId);
    if (!trajectory) return;
    const index = trajectory.keyframes.findIndex((frame) => frame.id === keyframeId);
    if (index < 0) return;
    const previous = trajectory.keyframes[index - 1];
    const next = trajectory.keyframes[index + 1];
    const bounds = editableKeyframeTimeBounds(previous?.timeMs, next?.timeMs, state.timeRangeMs);
    const safeTime = Math.max(bounds.min, Math.min(bounds.max, Math.round(timeMs)));
    runCommand(
      {
        type: "trajectory.set",
        trajectoryId,
        actorId: trajectory.actorId,
        branchId: trajectory.branchId,
        keyframes: trajectory.keyframes.map((frame) => {
          const input = toTrajectoryKeyframeInput(frame);
          return frame.id === keyframeId ? { ...input, timeMs: safeTime } : input;
        }),
        visible: trajectory.visible,
      },
      true,
    );
  }

  function updateTrajectoryKeyframeExact(
    trajectoryId: string,
    keyframeId: string,
    update: { timeMs: number; x: number; y: number; rotationDeg: number },
  ): void {
    const state = engine.getState();
    const trajectory = state.trajectories.find((item) => item.id === trajectoryId);
    if (!trajectory) return;
    const index = trajectory.keyframes.findIndex((frame) => frame.id === keyframeId);
    if (index < 0) return;
    const previous = trajectory.keyframes[index - 1];
    const next = trajectory.keyframes[index + 1];
    const bounds = editableKeyframeTimeBounds(previous?.timeMs, next?.timeMs, state.timeRangeMs);
    const currentFrame = trajectory.keyframes[index];
    const safeTime =
      currentFrame && Math.abs(update.timeMs - currentFrame.timeMs) < TIME_EQUALITY_EPSILON_MS
        ? currentFrame.timeMs
        : quantizeEditableTimeMs(update.timeMs, bounds, state.timeRangeMs);
    runCommand({
      type: "trajectory.set",
      trajectoryId,
      actorId: trajectory.actorId,
      branchId: trajectory.branchId,
      keyframes: trajectory.keyframes.map((frame) => {
        const input = toTrajectoryKeyframeInput(frame);
        return frame.id === keyframeId
          ? {
              ...input,
              timeMs: safeTime,
              ...clampScenePoint(update, state.environment.bounds),
              rotationDeg: update.rotationDeg,
            }
          : input;
      }),
      visible: trajectory.visible,
    });
  }

  function addTrajectoryKeyframeAtPlayhead(trajectoryId: string): void {
    stopPlayback();
    const state = engine.getState();
    const trajectory = state.trajectories.find((item) => item.id === trajectoryId);
    if (!trajectory) return;
    const targetTime = clampTimeToRange(currentTimeMs, state.timeRangeMs);
    const existing = trajectory.keyframes.find((frame) => frame.timeMs === targetTime);
    if (existing) {
      setSelectedKeyframeId(existing.id);
      setToast({
        kind: "info",
        message: `Point already exists at ${formatWorkspaceSeconds(targetTime)}s.`,
        detail: "Move the timeline playhead to another time before adding a point.",
      });
      return;
    }
    const pose = interpolateTrajectory(trajectory, targetTime);
    const keyframeId = `keyframe-${crypto.randomUUID()}`;
    const result = runCommand({
      type: "trajectory.set",
      trajectoryId,
      actorId: trajectory.actorId,
      branchId: trajectory.branchId,
      keyframes: [
        ...trajectory.keyframes.map(toTrajectoryKeyframeInput),
        { id: keyframeId, timeMs: targetTime, ...pose },
      ].sort((left, right) => left.timeMs - right.timeMs),
      visible: trajectory.visible,
    });
    if (result.ok) setSelectedKeyframeId(keyframeId);
  }

  function removeTrajectoryKeyframe(trajectoryId: string, keyframeId: string): void {
    stopPlayback();
    const trajectory = engine.getState().trajectories.find((item) => item.id === trajectoryId);
    if (!trajectory) return;
    if (trajectory.keyframes.length <= 2) {
      setToast({ kind: "info", message: "A path needs at least two points." });
      return;
    }
    const result = runCommand({
      type: "trajectory.set",
      trajectoryId,
      actorId: trajectory.actorId,
      branchId: trajectory.branchId,
      keyframes: trajectory.keyframes
        .filter((frame) => frame.id !== keyframeId)
        .map(toTrajectoryKeyframeInput),
      visible: trajectory.visible,
    });
    if (result.ok) setSelectedKeyframeId(undefined);
  }

  function setTrajectoryVisible(trajectoryId: string, visible: boolean): void {
    const trajectory = engine.getState().trajectories.find((item) => item.id === trajectoryId);
    if (!trajectory) return;
    runCommand({
      type: "trajectory.set",
      trajectoryId,
      actorId: trajectory.actorId,
      branchId: trajectory.branchId,
      keyframes: trajectory.keyframes.map(toTrajectoryKeyframeInput),
      visible,
    });
  }

  function updateEnvironment(environment: ReplayCase["environment"]): void {
    runCommand({
      type: "case.update",
      environment,
    });
  }

  function updateCaseDetails(input: CaseDetailsInput): boolean {
    const current = replayCaseRef.current;
    const command: Record<string, unknown> = { type: "case.update" };
    if (input.title !== current.title) command.title = input.title;
    if ((input.incidentDate ?? "") !== (current.incidentDate ?? "")) {
      command.incidentDate = input.incidentDate ?? null;
    }
    if ((input.approximateTime ?? "") !== (current.approximateTime ?? "")) {
      command.approximateTime = input.approximateTime ?? null;
    }
    if (Object.keys(command).length === 1) return true;
    return runCommand(command).ok;
  }

  function moveTimelineEvent(eventId: string, timeMs: number): void {
    const state = engine.getState();
    const timelineEvent = state.timelineEvents.find((item) => item.id === eventId);
    if (!timelineEvent) return;
    runCommand(
      {
        type: "timeline.upsert",
        eventId,
        branchId: timelineEvent.branchId,
        timeMs: clampTimeToRange(timeMs, state.timeRangeMs),
        eventType: timelineEvent.type,
        title: timelineEvent.title,
        certainty: timelineEvent.certainty,
        linkedActorIds: timelineEvent.linkedActorIds,
        linkedClaimIds: timelineEvent.linkedClaimIds,
        linkedEvidenceIds: timelineEvent.linkedEvidenceIds,
        ...(timelineEvent.location ? { location: timelineEvent.location } : {}),
      },
      true,
    );
  }

  function updateTimelineEventExact(
    eventId: string,
    update: {
      timeMs: number;
      certainty: "reported" | "likely" | "uncertain" | "disputed" | "unknown";
      location?: { x: number; y: number };
    },
  ): void {
    const state = engine.getState();
    const timelineEvent = state.timelineEvents.find((item) => item.id === eventId);
    if (!timelineEvent) return;
    const location = update.location
      ? clampScenePoint(update.location, state.environment.bounds)
      : timelineEvent.location;
    runCommand({
      type: "timeline.upsert",
      eventId,
      branchId: timelineEvent.branchId,
      timeMs:
        Math.abs(update.timeMs - timelineEvent.timeMs) < TIME_EQUALITY_EPSILON_MS
          ? timelineEvent.timeMs
          : quantizeTimeInRange(update.timeMs, state.timeRangeMs),
      eventType: timelineEvent.type,
      title: timelineEvent.title,
      certainty: update.certainty,
      linkedActorIds: timelineEvent.linkedActorIds,
      linkedClaimIds: timelineEvent.linkedClaimIds,
      linkedEvidenceIds: timelineEvent.linkedEvidenceIds,
      ...(location ? { location } : {}),
    });
  }

  function replayImpactMotion(eventId: string): void {
    const state = replayCaseRef.current;
    const impactEvent = state.timelineEvents.find(
      (event) =>
        event.id === eventId && event.branchId === state.activeBranchId && event.type === "impact",
    );
    if (!impactEvent) {
      setToast({ kind: "error", message: "That impact is not available on the active branch." });
      return;
    }
    const startTimeMs = Math.max(state.timeRangeMs.start, impactEvent.timeMs - 2_000);
    const stopTimeMs = Math.min(state.timeRangeMs.end, impactEvent.timeMs + 4_000);
    impactReplayWindowRef.current = {
      eventId,
      startTimeMs,
      stopTimeMs,
      contactRendered: false,
    };
    setPlayheadTime(startTimeMs);
    setPlaybackActive(true);
  }

  function runWorkspaceTourAction(actionId: WorkspaceTourActionId): void {
    const state = replayCaseRef.current;
    const impact = state.timelineEvents
      .filter((event) => event.branchId === state.activeBranchId && event.type === "impact")
      .sort((left, right) => left.timeMs - right.timeMs)[0];
    if (actionId === "build-report-preview") {
      buildPreview();
      return;
    }
    if (actionId === "open-site-tools-proof") {
      setTourStep(null);
      setGuideSection("site-tools");
      return;
    }
    if (!impact) {
      setToast({
        kind: "info",
        message: "Add an approximate contact before trying impact playback in this case.",
      });
      return;
    }
    if (actionId === "jump-impact") {
      selectItem("timeline-event", impact.id);
      stopPlayback();
      setPlayheadTime(impact.timeMs);
      return;
    }
    replayImpactMotion(impact.id);
  }

  async function runAfterCurrentCaseSaved(
    action: () => void | Promise<void>,
    blockedMessage: string,
  ): Promise<boolean> {
    if (workspaceTransitionPendingRef.current) return false;
    workspaceTransitionPendingRef.current = true;
    try {
      await saveCoordinator.whenIdle();
      if (!workspaceSessionActiveRef.current) return false;
      const currentVersion = replayCaseRef.current.caseVersion;
      const durableVersion = saveCoordinator.getDurableCaseVersion();
      if (
        saveCoordinator.getFailure() ||
        saveCoordinator.getConflictSource() ||
        durableVersion !== currentVersion
      ) {
        setToast({
          kind: "error",
          message: blockedMessage,
          detail:
            durableVersion === undefined
              ? "Wait for the initial local save, then try again."
              : `The open case is v${String(currentVersion)}, but only v${String(durableVersion)} is confirmed in the local vault.`,
        });
        return false;
      }
      await action();
      return true;
    } finally {
      workspaceTransitionPendingRef.current = false;
    }
  }

  async function openDemoScenario(scenarioId: DemoScenarioId): Promise<void> {
    if (!onOpenDemoScenario) return;
    await runAfterCurrentCaseSaved(
      () => onOpenDemoScenario(scenarioId),
      "The scenario was not opened because this run is not safely stored. Resolve the local save or editing-conflict notice first.",
    );
  }

  async function closeWorkspace(): Promise<void> {
    await runAfterCurrentCaseSaved(
      () => onHome(replayCaseRef.current),
      "The workspace stayed open because the current case is not safely stored. Resolve the local save or editing-conflict notice first.",
    );
  }

  async function waitForCurrentCaseSave(): Promise<boolean> {
    await saveCoordinator.whenIdle();
    return (
      !saveCoordinator.getFailure() &&
      !saveCoordinator.getConflictSource() &&
      saveCoordinator.getDurableCaseVersion() === replayCaseRef.current.caseVersion
    );
  }

  function toggleSceneItemLock(
    targetType: "actor" | "trajectory" | "timeline-event",
    targetId: string,
    locked: boolean,
  ): void {
    const label =
      targetType === "actor"
        ? "scene position"
        : targetType === "trajectory"
          ? "reconstructed path"
          : "event time and location";
    runCommand({
      type: "lock.set",
      targetType,
      targetId,
      locked,
      ...(locked ? { reason: `Human protected this ${label}.` } : {}),
    });
  }

  async function uploadEvidence(input: EvidenceUploadInput): Promise<void> {
    const uploadCaseId = replayCaseRef.current.id;
    const uploadTargetIsCurrent = () =>
      workspaceSessionActiveRef.current && replayCaseRef.current.id === uploadCaseId;
    const initialBlockReason = humanMutationBlockReasonRef.current;
    if (initialBlockReason) {
      setToast({ kind: "error", message: initialBlockReason });
      return;
    }
    if (input.file.size > 20 * 1024 * 1024) {
      setToast({ kind: "error", message: "Evidence images must be 20 MB or smaller." });
      return;
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await input.file.arrayBuffer();
    } catch {
      setToast({ kind: "error", message: "The selected image could not be read." });
      return;
    }
    const signature = validateEvidenceImageSignature(
      new Uint8Array(bytes),
      input.file.type.trim().toLowerCase(),
    );
    if (!signature.ok) {
      setToast({ kind: "error", message: signature.message });
      return;
    }
    const dimensions = validateEvidenceImageDimensions(new Uint8Array(bytes), signature.mimeType);
    if (!dimensions.ok) {
      setToast({ kind: "error", message: dimensions.message });
      return;
    }
    const evidenceBlob: Blob =
      input.file.type === signature.mimeType
        ? input.file
        : new Blob([bytes], { type: signature.mimeType });
    try {
      const bitmap = await createImageBitmap(evidenceBlob);
      if (
        bitmap.width > MAX_EVIDENCE_IMAGE_DIMENSION ||
        bitmap.height > MAX_EVIDENCE_IMAGE_DIMENSION ||
        bitmap.width * bitmap.height > MAX_EVIDENCE_IMAGE_PIXELS
      ) {
        bitmap.close();
        setToast({
          kind: "error",
          message: EVIDENCE_IMAGE_TOO_LARGE_MESSAGE,
        });
        return;
      }
      bitmap.close();
    } catch {
      setToast({ kind: "error", message: "This file does not contain a readable image." });
      return;
    }
    let digest: ArrayBuffer;
    try {
      digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
    } catch {
      setToast({
        kind: "error",
        message: "The browser could not calculate an integrity checksum for this image.",
      });
      return;
    }
    const checksum = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    if (!uploadTargetIsCurrent()) {
      if (workspaceSessionActiveRef.current) {
        setToast({
          kind: "info",
          message: "The open case changed while the image was being prepared. Add it again here.",
        });
      }
      return;
    }
    if (
      replayCaseRef.current.evidence.some((asset) => asset.checksum === checksum && !asset.deleted)
    ) {
      setToast({ kind: "error", message: "This image is already in the evidence tray." });
      return;
    }
    const currentBlockReason = humanMutationBlockReasonRef.current;
    if (currentBlockReason) {
      setToast({ kind: "error", message: currentBlockReason });
      return;
    }
    let capturedAt: string | undefined;
    if (input.capturedAt) {
      const capturedDate = new Date(input.capturedAt);
      if (!Number.isFinite(capturedDate.getTime())) {
        setToast({ kind: "error", message: "The evidence capture time is not a valid date." });
        return;
      }
      capturedAt = capturedDate.toISOString();
    }
    const evidenceId = `evidence-${crypto.randomUUID()}`;
    const blobKey = `evidence:${crypto.randomUUID()}`;
    if (!uploadTargetIsCurrent()) {
      setToast({
        kind: "info",
        message: "The open case changed while the image was being prepared. Add it again here.",
      });
      return;
    }
    const attachment: PersistedEvidenceBlob = {
      key: blobKey,
      caseId: uploadCaseId,
      checksum,
      mimeType: signature.mimeType,
      blob: evidenceBlob,
      createdAt: new Date().toISOString(),
    };
    const previousCaseVersion = replayCaseRef.current.caseVersion;
    const result = runCommand(
      {
        type: "evidence.add",
        evidenceId,
        name: input.file.name,
        mimeType: signature.mimeType,
        sizeBytes: evidenceBlob.size,
        localBlobKey: blobKey,
        checksum,
        syntheticDemoAsset: false,
        source: "local-upload",
        ...(input.notes ? { notes: input.notes } : {}),
        ...(capturedAt ? { capturedAt } : {}),
        tags: [],
      },
      true,
      "manual",
    );
    if (!result.ok) return;
    const pendingAttachment = { evidenceId, record: attachment };
    pendingEvidenceAttachmentsRef.current.set(blobKey, pendingAttachment);
    synchronizePendingEvidenceAttachmentGate();
    try {
      await enqueueCaseSave(engine.getState(), {
        expectedCaseVersion: previousCaseVersion,
        writerId,
        attachEvidenceBlobs: [attachment],
      });
    } catch {
      setToast({
        kind: "error",
        message: "The evidence attachment was not saved. Editing remains paused.",
        detail:
          "Its metadata and image bytes remain only in this tab until a local save retry succeeds; a failed CAS writes neither one.",
      });
      return;
    }
    if (!uploadTargetIsCurrent()) {
      pendingEvidenceAttachmentsRef.current.delete(blobKey);
      evidenceAttachmentSavePendingRef.current = pendingEvidenceAttachmentsRef.current.size > 0;
      return;
    }
    const disposition = classifyPendingEvidenceAttachment(replayCaseRef.current, pendingAttachment);
    if (disposition === "active") {
      pendingEvidenceAttachmentsRef.current.delete(blobKey);
      synchronizePendingEvidenceAttachmentGate();
      registerEvidenceUrl(evidenceId, evidenceBlob);
      setToast({ kind: "success", message: `Added evidence: ${input.file.name}.` });
      selectItem("evidence", evidenceId);
      return;
    }
    if (disposition === "conflict") {
      pendingEvidenceAttachmentsRef.current.delete(blobKey);
      synchronizePendingEvidenceAttachmentGate();
      setToast({
        kind: "error",
        message:
          "The evidence bytes were saved, but the active metadata changed before completion.",
        detail:
          "REPLAY did not display mismatched bytes or overwrite an active attachment. Delete the affected evidence or reload the latest saved case.",
      });
      return;
    }

    pendingEvidenceBlobDeletionsRef.current.set(blobKey, { evidenceId, blobKey });
    try {
      await enqueueCaseSave(replayCaseRef.current, {
        expectedCaseVersion: saveCoordinator.getDurableCaseVersion() ?? result.caseVersion,
        writerId,
        purgeEvidenceBlobKeys: [blobKey],
      });
    } catch {
      setToast({
        kind: "error",
        message: "The evidence was removed before its image save finished.",
        detail:
          "Its local byte cleanup remains queued. Retry the failed local save before leaving this case.",
      });
      return;
    }
    pendingEvidenceAttachmentsRef.current.delete(blobKey);
    synchronizePendingEvidenceAttachmentGate();
    const evidenceCleanupComplete = await flushPendingEvidenceBlobDeletions();
    setToast(
      evidenceCleanupComplete
        ? {
            kind: "info",
            message:
              "The evidence was removed before its image save finished. No attachment remains.",
          }
        : {
            kind: "error",
            message: "Evidence metadata and links were scrubbed. Local byte cleanup is queued.",
            detail:
              "Reload REPLAY to retry cleanup. If cleanup repeatedly fails, clear this site's data before leaving the device.",
          },
    );
  }

  async function deleteEvidence(evidenceId: string): Promise<void> {
    const asset = replayCaseRef.current.evidence.find((item) => item.id === evidenceId);
    const previousCaseVersion = replayCaseRef.current.caseVersion;
    const result = runCommand(
      { type: "evidence.delete", evidenceId, confirmed: true },
      true,
      "manual",
    );
    if (!result.ok || !asset) return;
    const deletedCaseVersion = engine.getState().caseVersion;
    try {
      await enqueueCaseSave(
        engine.getState(),
        {
          expectedCaseVersion: previousCaseVersion,
          writerId,
          ...(asset.localBlobKey.startsWith("evidence:")
            ? { purgeEvidenceBlobKeys: [asset.localBlobKey] }
            : {}),
        },
        { allowWhilePaused: false },
      );
    } catch {
      if (saveCoordinator.getDurableCaseVersion() !== deletedCaseVersion) {
        if (asset.localBlobKey.startsWith("evidence:")) {
          pendingEvidenceBlobDeletionsRef.current.set(asset.localBlobKey, {
            evidenceId,
            blobKey: asset.localBlobKey,
          });
        }
        setToast({
          kind: "error",
          message: "Evidence deletion was not saved. The image bytes remain in the local vault.",
          detail:
            "Retry the local case save before editing again. You may separately download a structured case transfer, but it does not include evidence bytes.",
        });
        return;
      }
    }
    if (asset.localBlobKey.startsWith("evidence:")) {
      try {
        await completeEvidenceBlobPurge(asset.localBlobKey, replayCaseRef.current.id);
      } catch {
        pendingEvidenceBlobDeletionsRef.current.set(asset.localBlobKey, {
          evidenceId,
          blobKey: asset.localBlobKey,
        });
        setToast({
          kind: "error",
          message: "Evidence metadata and links were scrubbed. Local byte cleanup is queued.",
          detail:
            "Reload REPLAY to retry cleanup. If cleanup repeatedly fails, clear this site's data before leaving the device.",
        });
        return;
      }
    }
    removeEvidenceUrl(evidenceId);
    setToast({ kind: "success", message: "Evidence and its local image bytes were deleted." });
  }

  function updateQuestion(
    questionId: string,
    status: OpenQuestion["status"],
    answer?: string,
    convert = false,
  ): boolean {
    return runCommand({
      type: "question.update",
      questionId,
      status,
      ...(status === "answered" && answer
        ? { answer, answerSource: "human-statement", convertAnswerToObservation: convert }
        : {}),
    }).ok;
  }

  function buildPreview(): void {
    const preview = buildReportPreview(replayCaseRef.current);
    setReportPreview(preview);
    setSelectedReportSnapshotId(undefined);
    changeWorkspaceMode("report");
    setToast({
      kind: "info",
      message: "Built a fresh report preview from the current structured case.",
    });
  }

  async function askAgentToReview(): Promise<void> {
    const state = replayCaseRef.current;
    const question = rankOpenQuestions(
      state.questions.filter(
        (candidate) => candidate.status === "open" || candidate.status === "deferred",
      ),
    )[0];
    if (!question) {
      setToast({ kind: "info", message: "There is no unresolved question to send for review." });
      return;
    }
    const prompt = buildSimpleAgentReviewPrompt(question.question);
    try {
      await copyTextToClipboard(prompt);
      setToast({
        kind: "success",
        message: "Agent review request copied.",
        detail: debugState.supported
          ? "Paste it into the connected conversation. Site Tools will work against this same live case."
          : "Open this case in a supported client, then paste the request into the conversation.",
      });
    } catch {
      setToast({
        kind: "error",
        message: "The review request could not be copied.",
        detail:
          "Clipboard access is unavailable. Switch to Expert mode and open the Site Tools guide to copy a prompt manually.",
      });
    }
  }

  function acceptProposal(proposalId: string): boolean {
    const state = engine.getState();
    return runCommand({
      type: "proposal.accept",
      proposalId,
      poseAt: {
        branchId: state.activeBranchId,
        timeMs: clampTimeToRange(currentTimeMs, state.timeRangeMs),
      },
    }).ok;
  }

  function rejectProposal(proposalId: string): boolean {
    return runCommand({ type: "proposal.reject", proposalId }).ok;
  }

  function finalizeReport(reviewedPreview: ReportPreview): boolean {
    const binding = reviewedPreview.reviewBinding;
    if (!binding) {
      setToast({
        kind: "error",
        message: "This preview is not bound to a reviewable case state. Build it again.",
      });
      return false;
    }
    const result = runCommand({
      type: "report.finalize",
      expectedVersion: reviewedPreview.caseVersion,
      unresolvedQuestionsReviewed: true,
      limitationsAcknowledged: true,
      confirmedFactsReviewed: true,
      includedUnconfirmedContentReviewed: true,
      manualConfirmation: true,
      reviewedPreview: {
        caseId: reviewedPreview.caseId,
        caseVersion: reviewedPreview.caseVersion,
        generatedAt: reviewedPreview.generatedAt,
        fingerprint: binding.fingerprint,
        branchIds: binding.branchIds,
        includeHypotheses: binding.includeHypotheses,
      },
    });
    if (result.ok) {
      const snapshot = engine.getState().reportSnapshots.at(-1);
      if (snapshot) {
        setSelectedReportSnapshotId(snapshot.id);
        setReportPreview(snapshot.preview);
      }
    }
    return result.ok;
  }

  async function importFile(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) {
        setToast({ kind: "error", message: "Structured case imports must be 20 MB or smaller." });
        return;
      }
      const prepared = prepareReplayCaseImport(await file.text(), {
        rekeyCaseId: `case-import-${crypto.randomUUID()}`,
      });
      setPendingCaseImport({
        replayCase: prepared.replayCase,
        fileName: file.name,
        trustResetSummary: prepared.trustResetSummary,
      });
    } catch (error) {
      setToast({
        kind: "error",
        message: error instanceof Error ? error.message : "The structured case export is invalid.",
      });
    } finally {
      // Permit retrying the same corrected or temporarily unreadable file.
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  function openReportSnapshot(snapshotId: string): void {
    const snapshot = replayCaseRef.current.reportSnapshots.find((item) => item.id === snapshotId);
    if (!snapshot) {
      setToast({ kind: "error", message: "That finalized snapshot is no longer available." });
      return;
    }
    setSelectedReportSnapshotId(snapshot.id);
    setReportPreview(structuredClone(snapshot.preview));
    changeWorkspaceMode("report");
    setToast({
      kind: "info",
      message: `Opened immutable snapshot ${snapshot.id}.`,
      detail: "PDF export now uses this historical snapshot, not the current draft case.",
    });
  }

  async function exportPdf(snapshotId?: string): Promise<void> {
    if (exportInFlightRef.current) {
      setToast({ kind: "info", message: "Another export is already being prepared." });
      return;
    }
    exportInFlightRef.current = true;
    setExportInFlight("pdf");
    try {
      const state = replayCaseRef.current;
      const requestedSnapshotId = snapshotId ?? selectedReportSnapshotId;
      const snapshot = requestedSnapshotId
        ? state.reportSnapshots.find((item) => item.id === requestedSnapshotId)
        : undefined;
      if (requestedSnapshotId && !snapshot) {
        throw new Error("The selected finalized snapshot is no longer available.");
      }
      await exportReportPdf(
        state,
        snapshot?.preview ?? reportPreview ?? buildReportPreview(state),
        {
          playheadTimeMs: currentTimeMs,
          comparisonBranchIds: displayedCompareBranchIds,
          ...(snapshot ? { finalizedSnapshot: snapshot } : {}),
        },
      );
    } catch (error) {
      setToast({ kind: "error", message: downloadErrorMessage(error) });
    } finally {
      exportInFlightRef.current = false;
      setExportInFlight(undefined);
    }
  }

  async function exportScene(format: "svg" | "png"): Promise<void> {
    if (exportInFlightRef.current) {
      setToast({ kind: "info", message: "Another export is already being prepared." });
      return;
    }
    exportInFlightRef.current = true;
    setExportInFlight("scene");
    try {
      const context = {
        playheadTimeMs: currentTimeMs,
        comparisonBranchIds: displayedCompareBranchIds,
      };
      if (format === "svg") exportSceneSvg(replayCaseRef.current, context);
      else await exportScenePng(replayCaseRef.current, context);
    } catch (error) {
      setToast({ kind: "error", message: downloadErrorMessage(error) });
    } finally {
      exportInFlightRef.current = false;
      setExportInFlight(undefined);
    }
  }

  function focusActivity(activity: ActivityEvent): void {
    const id = activity.affectedIds.find((affectedId) => {
      const state = replayCaseRef.current;
      return (
        state.actors.some((item) => item.id === affectedId) ||
        state.trajectories.some((item) => item.id === affectedId) ||
        state.timelineEvents.some((item) => item.id === affectedId) ||
        state.claims.some((item) => item.id === affectedId) ||
        state.evidence.some((item) => item.id === affectedId) ||
        state.questions.some((item) => item.id === affectedId) ||
        state.branches.some((item) => item.id === affectedId)
      );
    });
    if (!id) return;
    const state = replayCaseRef.current;
    const type: WorkspaceItemType = state.actors.some((item) => item.id === id)
      ? "actor"
      : state.trajectories.some((item) => item.id === id)
        ? "trajectory"
        : state.timelineEvents.some((item) => item.id === id)
          ? "timeline-event"
          : state.claims.some((item) => item.id === id)
            ? "claim"
            : state.evidence.some((item) => item.id === id)
              ? "evidence"
              : state.questions.some((item) => item.id === id)
                ? "question"
                : "hypothesis";
    selectItem(type, id);
  }

  function revertActivity(activityId: string): void {
    const blockedReason = humanMutationBlockReasonRef.current;
    if (blockedReason) {
      setToast({ kind: "error", message: blockedReason });
      return;
    }
    const activity = replayCaseRef.current.activity.find((item) => item.id === activityId);
    if (!activity?.requestId) return;
    setRevertingActivityId(activityId);
    const result = engine.revertAgentAction(activity.requestId, humanMeta());
    if (!result.ok) setToast({ kind: "error", message: result.message });
    else setToast({ kind: "success", message: result.message });
    setRevertingActivityId(undefined);
  }

  const selectedId = selectedItem?.id;
  const revertibleActivityIds = humanMutationBlockReason
    ? []
    : replayCase.activity.flatMap((activity) =>
        activity.requestId && engine.canRevertAgentAction(activity.requestId) ? [activity.id] : [],
      );
  const branchNames = Object.fromEntries(
    replayCase.branches.map((branch) => [branch.id, branch.name]),
  );

  return (
    <main className={`workspace is-${experienceMode}`}>
      <input
        ref={importInputRef}
        className="visually-hidden"
        type="file"
        tabIndex={-1}
        accept="application/json,.json"
        aria-label="Import case JSON"
        onChange={(event) => void importFile(event.target.files?.[0])}
      />
      <WorkspaceHeader
        replayCase={replayCase}
        mode={experienceMode}
        onModeChange={changeExperienceMode}
        isDemo={isDemo}
        saveState={saveState}
        canUndo={engine.canUndo && !humanMutationBlockReason}
        canRedo={engine.canRedo && !humanMutationBlockReason}
        webMcpSupported={debugState.supported}
        registeredTools={debugState.registeredToolNames.length}
        reportPreviewOpen={reportPreview !== undefined && selectedReportSnapshotId === undefined}
        reportSnapshotOpen={selectedReportSnapshotId !== undefined}
        reportNoteToolRegistered={debugState.registeredToolNames.includes("add_report_note")}
        agentWorking={Boolean(agentAction)}
        {...(activeDemoScenarioId ? { activeDemoScenarioId } : {})}
        {...(onOpenDemoScenario
          ? {
              onOpenDemoScenario: (scenarioId: DemoScenarioId) => void openDemoScenario(scenarioId),
            }
          : {})}
        onHome={() => void closeWorkspace()}
        onUndo={() => runHistoryAction("undo")}
        onRedo={() => runHistoryAction("redo")}
        onResetDemo={() => {
          const blockedReason = humanMutationBlockReasonRef.current;
          if (blockedReason) setToast({ kind: "error", message: blockedReason });
          else setConfirmingDemoReset(true);
        }}
        onEditCaseDetails={() => {
          const blockedReason = humanMutationBlockReasonRef.current;
          if (blockedReason) setToast({ kind: "error", message: blockedReason });
          else setEditingCaseDetails(true);
        }}
        onImport={() => {
          const blockedReason = humanMutationBlockReasonRef.current;
          if (blockedReason) setToast({ kind: "error", message: blockedReason });
          else importInputRef.current?.click();
        }}
        onExport={() => exportCaseJson(replayCaseRef.current)}
        onGuide={() => setGuideSection("quick-start")}
        onSiteToolsHelp={() => setGuideSection("site-tools")}
        onDebug={() => setShowDebug(true)}
      />
      {externalConflict && (
        <div className="workspace-conflict" role="alert">
          <CircleAlert size={18} />
          <div>
            <strong>Editing paused to protect local work</strong>
            <span>{externalConflict}</span>
          </div>
          {saveCoordinator.getConflictSource() === "lease" ? (
            <button
              className="button button--secondary"
              disabled={leaseTakeoverPending}
              onClick={() => setConfirmingLeaseTakeover(true)}
            >
              Take over & reload
            </button>
          ) : (
            <button className="button button--secondary" onClick={() => window.location.reload()}>
              Reload latest
            </button>
          )}
        </div>
      )}
      {saveFailure && (
        <div
          className={`workspace-save-failure${saveFailureIsBlocking ? " is-blocking" : ""}`}
          role={saveFailureIsBlocking ? "alert" : "status"}
        >
          <CircleAlert size={18} aria-hidden="true" />
          <div>
            <strong>Local save failed. Editing is paused.</strong>
            <span>{saveFailure.message}</span>
          </div>
          <div className="workspace-save-failure__actions">
            <button
              className="button button--secondary"
              disabled={saveState === "saving"}
              onClick={() => void retryLocalSave()}
            >
              {saveState === "saving" ? "Retrying…" : "Retry local save"}
            </button>
            <button
              className="button button--secondary"
              onClick={downloadFailedSaveStructuredTransfer}
            >
              <Download size={14} aria-hidden="true" /> Download structured transfer
            </button>
          </div>
        </div>
      )}
      {experienceMode === "expert" && (
        <div className="mobile-edit-guidance" role="note">
          <CircleAlert size={16} aria-hidden="true" />
          <span>
            Compact view prioritizes review. Use a larger screen for precise dragging; exact numeric
            controls remain available after selecting a scene item.
          </span>
        </div>
      )}
      <div
        className={`workspace-grid${displayedCompareBranchIds.length > 0 ? " is-comparing" : ""}`}
        id="main-content"
        tabIndex={-1}
      >
        <div className="workspace-scene" ref={proposalSceneRef}>
          {displayedCompareBranchIds.length > 0 && (
            <div className="comparison-banner">
              <Bot size={14} />
              <span>
                Overlaying{" "}
                {displayedCompareBranchIds
                  .map((id) => branchNames[id])
                  .filter(Boolean)
                  .join(" and ")}
                . Alternative paths are visual comparisons, not conclusions.
              </span>
              <button onClick={() => setCompareBranchIds([])}>Exit</button>
            </div>
          )}
          <SceneCanvas
            replayCase={replayCase}
            currentTimeMs={currentTimeMs}
            {...(selectedId ? { selectedId } : {})}
            {...(selectedKeyframeId ? { selectedKeyframeId } : {})}
            comparisonBranchIds={displayedCompareBranchIds}
            activeAgentIds={activeAgentIds}
            {...(proposalReviewTarget ? { proposalReviewTarget } : {})}
            onSelect={(type, id) => selectItem(type, id)}
            onSelectKeyframe={(_trajectoryId, keyframeId) => setSelectedKeyframeId(keyframeId)}
            onEditStart={stopPlayback}
            onMoveActor={moveActorAtCurrentTime}
            onMoveKeyframe={moveKeyframePosition}
            onCreateTrajectory={createTrajectory}
            onMarkDamage={(actorId, region, description) =>
              runCommand({
                type: "damage.mark",
                actorId,
                region,
                description,
                status: "reported",
                linkedClaimIds: [],
                linkedEvidenceIds: [],
              }).ok
            }
            onMarkImpact={markImpact}
            onUpdateEnvironment={updateEnvironment}
            onToggleActorLock={(actorId) => {
              const actor = replayCaseRef.current.actors.find((item) => item.id === actorId);
              if (actor)
                runCommand({
                  type: "lock.set",
                  targetType: "actor",
                  targetId: actorId,
                  locked: !actor.locked,
                  ...(!actor.locked ? { reason: "Human protected this scene position." } : {}),
                });
            }}
            onToggleTrajectoryLock={(trajectoryId) => {
              const trajectory = replayCaseRef.current.trajectories.find(
                (item) => item.id === trajectoryId,
              );
              if (trajectory)
                runCommand({
                  type: "lock.set",
                  targetType: "trajectory",
                  targetId: trajectoryId,
                  locked: !trajectory.locked,
                  ...(!trajectory.locked
                    ? { reason: "Human protected this reconstructed path." }
                    : {}),
                });
            }}
            onToggleEventLock={(eventId) => {
              const event = replayCaseRef.current.timelineEvents.find(
                (item) => item.id === eventId,
              );
              if (event)
                runCommand({
                  type: "lock.set",
                  targetType: "timeline-event",
                  targetId: eventId,
                  locked: !event.locked,
                  ...(!event.locked
                    ? { reason: "Human protected this event time and location." }
                    : {}),
                });
            }}
          />
        </div>
        {experienceMode === "simple" ? (
          <SimpleWorkspace
            replayCase={replayCase}
            {...(reportPreview ? { reportPreview } : {})}
            {...(agentAction ? { agentWorking: agentAction } : {})}
            siteToolsSupported={debugState.supported}
            siteToolsError={debugState.tools.some((tool) => tool.registrationState === "error")}
            {...(humanMutationBlockReason ? { mutationBlocked: humanMutationBlockReason } : {})}
            onAskAgent={askAgentToReview}
            onAcceptProposal={acceptProposal}
            onRejectProposal={rejectProposal}
            onBuildReport={buildPreview}
            onFinalizeReport={finalizeReport}
          />
        ) : (
          <InspectorPanel
            replayCase={replayCase}
            currentTimeMs={currentTimeMs}
            activeTab={activeTab}
            {...(focusedIssueId ? { focusedIssueId } : {})}
            {...(selectedId ? { selectedId } : {})}
            {...(selectedKeyframeId ? { selectedKeyframeId } : {})}
            {...(reportPreview ? { reportPreview } : {})}
            {...(selectedReportSnapshotId ? { selectedReportSnapshotId } : {})}
            evidenceUrls={evidenceUrls}
            compareBranchIds={displayedCompareBranchIds}
            {...(proposalReviewTarget ? { proposalReviewTarget } : {})}
            onEditStart={stopPlayback}
            onTabChange={changeInspectorTab}
            onSelect={(type, id) => selectItem(type, id)}
            onAddClaim={(statement, status, sourceType, sourceIds) =>
              runCommand({
                type: "claim.add",
                statement,
                status,
                sourceType,
                sourceIds,
                linkedEvidenceIds: sourceIds.filter((id) =>
                  replayCase.evidence.some((asset) => asset.id === id && !asset.deleted),
                ),
                linkedEventIds: [],
                linkedSceneObjectIds: [],
                sharedAcrossBranches: true,
              }).ok
            }
            onUpdateClaim={(claimId, update) =>
              runCommand({ type: "claim.update", claimId, ...update }).ok
            }
            onConfirmClaim={(claimId) => runCommand({ type: "claim.confirm", claimId })}
            onSetClaimStatus={(claimId, status) =>
              runCommand({ type: "claim.update", claimId, status })
            }
            onToggleLock={(_, id, locked) =>
              runCommand({
                type: "lock.set",
                targetType: "claim",
                targetId: id,
                locked,
                ...(locked ? { reason: "Human protected this observation." } : {}),
              })
            }
            onUpdateActorPose={moveActorAtCurrentTime}
            onUpdateActorSpecs={updateActorSpecs}
            onUpdateTrajectoryKeyframe={updateTrajectoryKeyframeExact}
            onAddTrajectoryKeyframe={addTrajectoryKeyframeAtPlayhead}
            onRemoveTrajectoryKeyframe={removeTrajectoryKeyframe}
            onSelectTrajectoryKeyframe={(_trajectoryId, keyframeId) =>
              setSelectedKeyframeId(keyframeId)
            }
            onSetTrajectoryVisible={setTrajectoryVisible}
            onUpdateTimelineEvent={updateTimelineEventExact}
            onReplayImpact={replayImpactMotion}
            onToggleSceneItemLock={toggleSceneItemLock}
            onAdjustProposal={(proposalId, summary, changes) => {
              const state = engine.getState();
              return runCommand({
                type: "proposal.adjust",
                proposalId,
                summary,
                changes,
                poseAt: {
                  branchId: state.activeBranchId,
                  timeMs: clampTimeToRange(currentTimeMs, state.timeRangeMs),
                },
              }).ok;
            }}
            onAcceptProposal={acceptProposal}
            onRejectProposal={rejectProposal}
            onReviewProposalAtTime={(target) => {
              const state = replayCaseRef.current;
              const proposal = state.proposals.find(
                (candidate) => candidate.id === target.proposalId && candidate.status === "pending",
              );
              const revision = proposal?.revisions.at(-1);
              const change = revision?.changes.find(
                (candidate) => candidate.id === target.changeId,
              );
              if (
                revision?.id !== target.revisionId ||
                !change?.branchId ||
                change.branchId !== target.branchId
              )
                return false;
              if (
                target.keyframeId &&
                change.kind === "trajectory-set" &&
                !change.proposedTrajectory.keyframes.some(
                  (keyframe) => keyframe.id === target.keyframeId,
                ) &&
                !change.baseTrajectory?.keyframes.some(
                  (keyframe) => keyframe.id === target.keyframeId,
                )
              ) {
                return false;
              }
              const resolved = resolveProposalReviewRequest(target, {
                activeBranchId: state.activeBranchId,
                timeRangeMs: state.timeRangeMs,
              });
              if (!resolved.ok) return false;
              stopPlayback();
              setProposalReviewTarget(resolved.target);
              setPlayheadTime(resolved.target.reviewTimeMs);
              if (window.matchMedia("(max-width: 900px)").matches) {
                if (proposalReviewScrollFrameRef.current !== undefined) {
                  window.cancelAnimationFrame(proposalReviewScrollFrameRef.current);
                }
                proposalReviewScrollFrameRef.current = window.requestAnimationFrame(() => {
                  proposalReviewScrollFrameRef.current = undefined;
                  proposalSceneRef.current?.scrollIntoView({
                    block: "center",
                    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                      ? "auto"
                      : "smooth",
                  });
                });
              }
              return true;
            }}
            onUploadEvidence={(input) => void uploadEvidence(input)}
            onDeleteEvidence={deleteEvidence}
            onUpdateEvidence={(evidenceId, update) =>
              runCommand({ type: "evidence.update", evidenceId, ...update }).ok
            }
            onLinkEvidence={(evidenceId, targetType, targetId, annotationId) =>
              runCommand({
                type: "evidence.link",
                evidenceId,
                targetType,
                targetId,
                ...(annotationId ? { annotationId } : {}),
              }).ok
            }
            onUnlinkEvidence={(evidenceId, targetType, targetId, annotationId) =>
              runCommand({
                type: "evidence.unlink",
                evidenceId,
                targetType,
                targetId,
                ...(annotationId ? { annotationId } : {}),
              }).ok
            }
            onAddQuestion={(question, reason, importance) =>
              runCommand({
                type: "question.add",
                question,
                reason,
                importance,
                rankingReasons:
                  importance === "blocking"
                    ? ["blocks-report"]
                    : importance === "high"
                      ? ["resolves-contradiction"]
                      : ["contextual-detail"],
                relatedClaimIds: [],
                relatedSceneObjectIds: [],
                relatedBranchIds: [replayCaseRef.current.activeBranchId],
              }).ok
            }
            onUpdateQuestion={updateQuestion}
            onForkBranch={(parentBranchId, name, description) =>
              runCommand({ type: "hypothesis.fork", parentBranchId, name, description }).ok
            }
            onSetActiveBranch={(branchId) =>
              runCommand({ type: "hypothesis.set-active", branchId })
            }
            onRenameBranch={(branchId, name, description) =>
              runCommand({ type: "hypothesis.rename", branchId, name, description }).ok
            }
            onAddAssumption={(branchId, statement) =>
              runCommand({
                type: "hypothesis.add-assumption",
                branchId,
                statement,
                supportingEvidenceIds: [],
                conflictingEvidenceIds: [],
              }).ok
            }
            onUpdateAssumption={(branchId, assumptionId, update) =>
              runCommand({
                type: "hypothesis.update-assumption",
                branchId,
                assumptionId,
                ...update,
              }).ok
            }
            onToggleBranchArchive={(branch) =>
              runCommand({
                type: branch.status === "archived" ? "hypothesis.restore" : "hypothesis.archive",
                branchId: branch.id,
              })
            }
            onCompareBranches={setCompareBranchIds}
            onValidate={() => runCommand({ type: "case.validate", scope: "all" })}
            onFocusIssue={(issue) => {
              focusConsistencyIssue(issue.id, issue.affectedIds);
              setToast({ kind: "info", message: issue.title, detail: issue.explanation });
            }}
            onAttestCompleteness={(attestation) =>
              runCommand({ type: "completeness.attest", attestation }).ok
            }
            onWithdrawCompleteness={(attestationId) =>
              runCommand({ type: "completeness.withdraw", attestationId }).ok
            }
            onBuildReport={buildPreview}
            onOpenReportSnapshot={openReportSnapshot}
            onExportReportSnapshot={(snapshotId) => void exportPdf(snapshotId)}
            onAddReportNote={(text, claimIds, evidenceIds) =>
              runCommand({
                type: "report.add-note",
                text,
                claimIds,
                evidenceIds,
              }).ok
            }
            onReviewReportNote={(noteId, approved) =>
              runCommand({ type: "report.review-note", noteId, approved })
            }
            onFinalizeReport={finalizeReport}
            onExportJson={() => exportCaseJson(replayCaseRef.current)}
            onExportPdf={() => void exportPdf()}
            onExportScene={(format) => void exportScene(format)}
            {...(exportInFlight ? { exportInFlight } : {})}
          />
        )}
        <Timeline
          timeRangeMs={replayCase.timeRangeMs}
          currentTimeMs={currentTimeMs}
          isPlaying={isPlaying}
          playbackSpeed={playbackSpeed}
          {...(replayCase.approximateTime
            ? { absoluteClockStart: replayCase.approximateTime }
            : {})}
          activeBranchId={replayCase.activeBranchId}
          actors={replayCase.actors}
          trajectories={replayCase.trajectories}
          events={replayCase.timelineEvents}
          {...(selectedId ? { selectedId } : {})}
          {...(selectedKeyframeId ? { selectedKeyframeId } : {})}
          {...(displayedCompareBranchIds.length > 0
            ? {
                comparison: {
                  branchIds: displayedCompareBranchIds.filter(
                    (id) => id !== replayCase.activeBranchId,
                  ),
                  branchNames,
                  onExit: () => setCompareBranchIds([]),
                },
              }
            : {})}
          onTimeChange={(time) => {
            stopPlayback();
            setPlayheadTime(time);
          }}
          onPlayingChange={setPlaybackActive}
          onPlaybackSpeedChange={setPlaybackSpeed}
          onSelectEvent={(eventId) => selectItem("timeline-event", eventId)}
          onSelectKeyframe={(trajectoryId, keyframeId) =>
            selectItem("trajectory", trajectoryId, keyframeId)
          }
          onMoveEvent={moveTimelineEvent}
          onMoveKeyframe={moveKeyframeTime}
          onAddEvent={addTimelineEvent}
        />
        {experienceMode === "expert" && (
          <div className="workspace-activity" data-onboarding-id="case-activity">
            <ActivityPanel
              activities={replayCase.activity}
              sessionActivities={toolInvocationActivity}
              {...(agentAction ? { activeAgentAction: agentAction } : {})}
              {...(revertingActivityId ? { revertingActivityId } : {})}
              revertibleActivityIds={revertibleActivityIds}
              maxItems={20}
              onRevert={revertActivity}
              onSelectActivity={focusActivity}
            />
          </div>
        )}
      </div>
      {toast && (
        <div
          className={`toast is-${toast.kind}`}
          role={toast.kind === "error" ? "alert" : "status"}
        >
          <span>{toast.kind === "error" ? <CircleAlert size={16} /> : <Check size={16} />}</span>
          <div>
            <strong>{toast.message}</strong>
            {toast.detail && <p>{toast.detail}</p>}
          </div>
          <button
            type="button"
            onClick={() => setToast(undefined)}
            aria-label="Dismiss notification"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      {showDebug && (
        <WebMCPDebugPanel
          state={debugState}
          onClose={() => setShowDebug(false)}
          onSimulate={(name: WebMCPToolName, input, signal) =>
            registryRef.current?.simulateTool(name, input, { signal }) ??
            Promise.resolve({
              ok: false,
              code: "REGISTRY_UNAVAILABLE",
              message: "The WebMCP registry is restarting.",
            })
          }
          onRetryRegistrations={async () => {
            await registryRef.current?.retryFailedRegistrations();
          }}
        />
      )}
      {editingCaseDetails && (
        <CaseDetailsDialog
          replayCase={replayCase}
          onCancel={() => setEditingCaseDetails(false)}
          onSave={updateCaseDetails}
        />
      )}
      {guideSection && (
        <ReplayGuide
          key={guideSection}
          context="workspace"
          webMcpSupported={debugState.supported}
          isDemo={isDemo}
          {...(activeDemoScenarioId ? { demoScenarioId: activeDemoScenarioId } : {})}
          registeredTools={debugState.registeredToolNames.length}
          toolRegistrationStatus={
            debugState.tools.some((tool) => tool.registrationState === "error")
              ? "error"
              : debugState.registeredToolNames.length > 0
                ? "ready"
                : "registering"
          }
          initialSection={guideSection}
          onClose={() => setGuideSection(undefined)}
          onOpenProofDemo={() => void openDemoScenario("roundabout-calibrated")}
          onStartWorkspaceTour={() => setTourStep(0)}
          onOpenTechnicalInspector={() => {
            setGuideSection(undefined);
            setShowDebug(true);
          }}
        />
      )}
      {tourStep !== null && (
        <WorkspaceTour
          step={tourStep}
          onStepChange={setTourStep}
          onExit={() => setTourStep(null)}
          onFinish={() => setTourStep(null)}
          {...(isDemo ? { onTryAction: runWorkspaceTourAction } : {})}
        />
      )}
      {confirmingDemoReset && (
        <DemoResetDialog
          onCancel={() => setConfirmingDemoReset(false)}
          onConfirm={async () => {
            if (!(await waitForCurrentCaseSave())) {
              setConfirmingDemoReset(false);
              setToast({
                kind: "error",
                message:
                  "The demo was not reset because the current case is not safely stored. Resolve the local save or editing-conflict notice first.",
              });
              return;
            }
            const reset = await onResetDemo();
            if (!reset) setConfirmingDemoReset(false);
          }}
        />
      )}
      {pendingCaseImport && (
        <CaseImportReviewDialog
          pendingImport={pendingCaseImport}
          onCancel={() => setPendingCaseImport(undefined)}
          onConfirm={async () => {
            const opened = await runAfterCurrentCaseSaved(
              () => onImportCase(pendingCaseImport.replayCase),
              "The import was not opened because the current case is not safely stored. Resolve the local save or editing-conflict notice first.",
            );
            if (opened) setPendingCaseImport(undefined);
            return opened;
          }}
        />
      )}
      {confirmingLeaseTakeover && (
        <LeaseTakeoverDialog
          pending={leaseTakeoverPending}
          onCancel={() => setConfirmingLeaseTakeover(false)}
          onConfirm={takeOverWriteLease}
        />
      )}
    </main>
  );
}

function CaseImportReviewDialog({
  pendingImport,
  onCancel,
  onConfirm,
}: {
  pendingImport: PendingCaseImport;
  onCancel: () => void;
  onConfirm: () => Promise<boolean>;
}) {
  const [opening, setOpening] = useState(false);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogFocus<HTMLElement>({
    initialFocusRef: cancelButtonRef,
    onEscape: () => {
      if (!opening) onCancel();
    },
  });
  const summary = pendingImport.trustResetSummary;
  const resetItems = [
    [summary.confirmedClaims, "confirmed observation"],
    [summary.confirmedDamageMarkers, "confirmed damage marker"],
    [summary.confirmedTimelineEvents, "confirmed timeline event"],
    [summary.answeredQuestions, "answered question"],
    [summary.reviewedReportNotes, "reviewed report note"],
    [summary.completenessAttestations, "completeness attestation"],
    [summary.finalizedSnapshots, "finalized report snapshot"],
    [summary.proposalRevisions, "trusted proposal revision"],
    [summary.proposalDecisions, "trusted proposal decision"],
  ] as const;
  const visibleResetItems = resetItems.filter(([count]) => count > 0);

  async function confirmImport(): Promise<void> {
    if (opening) return;
    setOpening(true);
    try {
      await onConfirm();
    } finally {
      setOpening(false);
    }
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (!opening && event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="dialog confirm-dialog import-review-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="import-review-title"
        aria-describedby="import-review-description import-review-boundary"
        aria-busy={opening}
        tabIndex={-1}
      >
        <div className="dialog-icon">
          <FileUp size={20} aria-hidden="true" />
        </div>
        <h2 id="import-review-title">Review this structured transfer</h2>
        <p id="import-review-description">
          “{pendingImport.fileName}” will open as a new local case named “
          {pendingImport.replayCase.title}”. The current case stays saved and available.
        </p>
        <div className="import-review-dialog__summary">
          <strong>Fresh local review required</strong>
          {visibleResetItems.length > 0 ? (
            <ul>
              {visibleResetItems.map(([count, label]) => (
                <li key={label}>
                  <span>{count}</span> {label}
                  {count === 1 ? "" : "s"} reset or removed
                </li>
              ))}
            </ul>
          ) : (
            <p>No saved confirmations, answers, or snapshots were present in this transfer.</p>
          )}
          {summary.evidenceFilesUnavailable > 0 && (
            <p>
              {summary.evidenceFilesUnavailable} local evidence image
              {summary.evidenceFilesUnavailable === 1 ? " is" : "s are"} unavailable because JSON
              transfers do not contain image bytes.
            </p>
          )}
        </div>
        <p id="import-review-boundary" className="import-review-dialog__boundary">
          The transfer is unsigned. REPLAY preserves its structure and history as unverified, then
          clears local trust so imported statements cannot inherit this browser’s human authority.
        </p>
        <footer>
          <button
            ref={cancelButtonRef}
            className="button button--quiet"
            disabled={opening}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="button button--primary"
            disabled={opening}
            onClick={() => void confirmImport()}
          >
            {opening ? "Opening…" : "Open as new local case"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function LeaseTakeoverDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogFocus<HTMLElement>({
    initialFocusRef: cancelButtonRef,
    onEscape: () => {
      if (!pending) onCancel();
    },
  });

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (!pending && event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="dialog confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="take-over-lease-title"
        aria-describedby="take-over-lease-description"
        tabIndex={-1}
      >
        <div className="dialog-icon">
          <CircleAlert size={20} aria-hidden="true" />
        </div>
        <h2 id="take-over-lease-title">Take over editing?</h2>
        <p id="take-over-lease-description">
          This stops another REPLAY page context from editing and reloads the newest saved copy.
          Work that the other page has not finished saving could be lost. Continue only if no other
          copy is actively editing this case.
        </p>
        <footer>
          <button
            ref={cancelButtonRef}
            className="button button--quiet"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button className="button button--danger" disabled={pending} onClick={onConfirm}>
            {pending ? "Taking over…" : "Take over & reload"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function DemoResetDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [resetting, setResetting] = useState(false);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogFocus<HTMLElement>({
    initialFocusRef: cancelButtonRef,
    onEscape: () => {
      if (!resetting) onCancel();
    },
  });

  async function confirmReset(): Promise<void> {
    if (resetting) return;
    setResetting(true);
    try {
      await onConfirm();
    } finally {
      setResetting(false);
    }
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (!resetting && event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="dialog confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="reset-demo-title"
        aria-describedby="reset-demo-description"
        tabIndex={-1}
      >
        <div className="dialog-icon is-destructive">
          <RotateCcw size={20} aria-hidden="true" />
        </div>
        <h2 id="reset-demo-title">Start a fresh demo copy?</h2>
        <p id="reset-demo-description">
          REPLAY will save this run and open a new deterministic copy. Your current demo work stays
          available as a local case, and browser Back returns to this exact run.
        </p>
        <footer>
          <button
            ref={cancelButtonRef}
            className="button button--quiet"
            disabled={resetting}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="button button--primary"
            disabled={resetting}
            onClick={() => void confirmReset()}
          >
            {resetting ? "Opening…" : "Start fresh copy"}
          </button>
        </footer>
      </section>
    </div>
  );
}

interface WorkspaceHeaderProps {
  replayCase: ReplayCase;
  mode: ExperienceMode;
  onModeChange: (mode: ExperienceMode) => void;
  isDemo: boolean;
  saveState: SaveState;
  canUndo: boolean;
  canRedo: boolean;
  webMcpSupported: boolean;
  registeredTools: number;
  reportPreviewOpen: boolean;
  reportSnapshotOpen: boolean;
  reportNoteToolRegistered: boolean;
  agentWorking: boolean;
  activeDemoScenarioId?: DemoScenarioId;
  onOpenDemoScenario?: (scenarioId: DemoScenarioId) => void;
  onHome: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onResetDemo: () => void;
  onEditCaseDetails: () => void;
  onImport: () => void;
  onExport: () => void;
  onGuide: () => void;
  onSiteToolsHelp: () => void;
  onDebug: () => void;
}

function WorkspaceHeader(props: WorkspaceHeaderProps) {
  const siteToolsRegistrationExplanation = props.reportNoteToolRegistered
    ? `${String(props.registeredTools)} tools registered. This includes the contextual report note tool because a report preview is open.`
    : props.reportPreviewOpen
      ? `${String(props.registeredTools)} tools registered. The report preview is open, but its contextual report note tool did not register; open the technical inspector for details.`
      : props.reportSnapshotOpen
        ? `${String(props.registeredTools)} tools registered. Historical report snapshots are immutable; build a current draft preview to make the contextual report note tool eligible.`
        : `${String(props.registeredTools)} tools registered. Opening a report preview makes one contextual report note tool eligible, so this count may increase by one.`;

  function runMenuAction(event: MouseEvent<HTMLButtonElement>, action: () => void): void {
    const menu = event.currentTarget.closest("details");
    menu?.removeAttribute("open");
    menu?.querySelector<HTMLElement>("summary")?.focus();
    action();
  }

  return (
    <header className="workspace-header">
      <button
        className="workspace-header__brand"
        onClick={props.onHome}
        aria-label="Back to REPLAY home"
      >
        <BrandMark compact />
      </button>
      <div className="workspace-case-context">
        <div className="workspace-case-title">
          <span>{props.isDemo ? "Demo run" : "Local case"}</span>
          <h1>{props.replayCase.title}</h1>
          <button
            className="workspace-case-title__edit"
            type="button"
            onClick={props.onEditCaseDetails}
            aria-label="Edit case details"
            title="Edit case details"
          >
            <Pencil size={12} aria-hidden="true" />
          </button>
          <small>v{props.replayCase.caseVersion}</small>
        </div>
        <div className={`save-status is-${props.saveState}`} role="status">
          {props.saveState === "saving" ? (
            <Save size={13} />
          ) : props.saveState === "error" ? (
            <CloudOff size={13} />
          ) : (
            <Check size={13} />
          )}
          <span>
            {props.saveState === "saving"
              ? "Saving locally"
              : props.saveState === "error"
                ? "Local save failed"
                : "Saved locally"}
          </span>
        </div>
      </div>
      <div className="workspace-header__spacer" />
      <div className="mode-switch" role="group" aria-label="Workspace mode">
        <button
          type="button"
          aria-pressed={props.mode === "simple"}
          onClick={() => props.onModeChange("simple")}
        >
          Simple
        </button>
        <button
          type="button"
          aria-pressed={props.mode === "expert"}
          onClick={() => props.onModeChange("expert")}
        >
          Expert
        </button>
      </div>
      {props.mode === "expert" ? (
        <>
          <div className="history-controls">
            <button onClick={props.onUndo} disabled={!props.canUndo} title="Undo">
              <Undo2 size={15} />
              <span>Undo</span>
            </button>
            <button onClick={props.onRedo} disabled={!props.canRedo} title="Redo">
              <Redo2 size={15} />
              <span>Redo</span>
            </button>
          </div>
          <button className="workspace-help" onClick={props.onGuide} aria-label="Open REPLAY guide">
            <CircleHelp size={15} aria-hidden="true" /> <span>Guide</span>
          </button>
          <button
            className={`webmcp-status${props.webMcpSupported ? " is-supported" : ""}${props.agentWorking ? " is-working" : ""}`}
            onClick={props.onSiteToolsHelp}
            data-onboarding-id="site-tools-status"
            {...(props.webMcpSupported
              ? {
                  "aria-label": `Site Tools. ${siteToolsRegistrationExplanation}`,
                  title: siteToolsRegistrationExplanation,
                }
              : {})}
          >
            <span className="webmcp-status__dot" />
            {props.webMcpSupported ? (
              <Wifi size={14} aria-hidden="true" />
            ) : (
              <CloudOff size={14} aria-hidden="true" />
            )}
            <span className="webmcp-status__compact" aria-hidden="true">
              Tools
            </span>
            <span className="webmcp-status__text">
              <strong>Site Tools</strong>{" "}
              <small>
                {props.webMcpSupported ? `${props.registeredTools} registered` : "Manual mode"}
              </small>
            </span>
          </button>
          <details className="workspace-menu" data-onboarding-id="case-options">
            <summary aria-label="Case options">
              <Settings2 size={16} />
              <ChevronDown size={12} />
            </summary>
            <div>
              <button onClick={(event) => runMenuAction(event, props.onEditCaseDetails)}>
                <Pencil size={14} /> Edit case details
              </button>
              <button onClick={(event) => runMenuAction(event, props.onExport)}>
                <Download size={14} /> Export structured case JSON
              </button>
              <button onClick={(event) => runMenuAction(event, props.onImport)}>
                <FileUp size={14} /> Import structured case JSON
              </button>
              {props.isDemo && (
                <button onClick={(event) => runMenuAction(event, props.onResetDemo)}>
                  <RotateCcw size={14} /> Start fresh demo copy
                </button>
              )}
              {props.isDemo && props.onOpenDemoScenario && (
                <>
                  <span className="workspace-menu__section-label">Demo scenarios</span>
                  {DEMO_SCENARIO_METADATA.map((scenario) => {
                    const isCurrent = scenario.id === props.activeDemoScenarioId;
                    return (
                      <button
                        key={scenario.id}
                        disabled={isCurrent}
                        aria-current={isCurrent ? "page" : undefined}
                        aria-label={`Open demo scenario: ${scenario.title}${isCurrent ? " (current)" : ""}`}
                        onClick={(event) =>
                          runMenuAction(event, () => props.onOpenDemoScenario?.(scenario.id))
                        }
                      >
                        {isCurrent ? <Check size={14} /> : <Route size={14} />}
                        {scenario.title}
                      </button>
                    );
                  })}
                </>
              )}
              <button onClick={(event) => runMenuAction(event, props.onDebug)}>
                <ShieldCheck size={14} /> WebMCP inspector
              </button>
              <button onClick={(event) => runMenuAction(event, props.onHome)}>
                <Home size={14} /> Close workspace
              </button>
            </div>
          </details>
        </>
      ) : (
        <button
          className="workspace-simple-home"
          type="button"
          onClick={props.onHome}
          aria-label="Close workspace"
          title="Close workspace"
        >
          <Home size={16} aria-hidden="true" />
        </button>
      )}
    </header>
  );
}
