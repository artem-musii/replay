import {
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  CloudOff,
  Download,
  FileUp,
  Home,
  Redo2,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  Undo2,
  Wifi,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildReportPreview,
  createReplayEngine,
  importReplayCase,
  type ActivityEvent,
  type OpenQuestion,
  type ReplayCase,
  type ReplayCommandResult,
  type ReportPreview,
  type WorkspaceItemType,
} from "../domain";
import {
  exportCaseJson,
  exportReportPdf,
  exportScenePng,
  exportSceneSvg,
} from "../export/exporters";
import { createReplayWebMCPAdapter } from "../integration/replayWebMCPAdapter";
import {
  deleteEvidenceBlob,
  loadEvidenceBlob,
  LocalVaultConflictError,
  saveCase,
  saveEvidenceBlob,
  type SaveCaseOptions,
} from "../persistence/database";
import {
  ReplayWebMCPRegistry,
  type ReplayToolInvocationAudit,
  type WebMCPDebugState,
  type WebMCPToolName,
} from "../webmcp";
import { ActivityPanel } from "./ActivityPanel";
import { BrandMark } from "./BrandMark";
import { type EvidenceUploadInput, InspectorPanel, type InspectorTab } from "./InspectorPanel";
import { SceneCanvas } from "./SceneCanvas";
import { Timeline } from "./Timeline";
import { useDialogFocus } from "./useDialogFocus";
import { WebMCPDebugPanel } from "./WebMCPDebugPanel";

interface WorkspaceProps {
  initialCase: ReplayCase;
  isDemo: boolean;
  onHome: (latestCase: ReplayCase) => void;
  onResetDemo: () => Promise<boolean>;
  onImportCase: (replayCase: ReplayCase) => void;
}

type SaveState = "saving" | "saved" | "error";
type WriteAccess = "checking" | "writable" | "blocked";

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
  message: string;
}

class SaveCoordinator {
  private failure: SaveFailure | undefined;
  private conflictSource: "broadcast" | "lease" | "save" | undefined;
  private durableCaseVersion: number | undefined;
  private currentCaseVersion: number;
  private recoveryResumeFromVersion: number | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(initialCaseVersion: number) {
    this.currentCaseVersion = initialCaseVersion;
  }

  getFailure(): SaveFailure | undefined {
    return this.failure;
  }

  setFailure(failure: SaveFailure | undefined): void {
    this.failure = failure;
  }

  getConflictSource(): "broadcast" | "lease" | "save" | undefined {
    return this.conflictSource;
  }

  setConflictSource(source: "broadcast" | "lease" | "save" | undefined): void {
    this.conflictSource = source;
  }

  getDurableCaseVersion(): number | undefined {
    return this.durableCaseVersion;
  }

  recordDurableCaseVersion(caseVersion: number): void {
    this.durableCaseVersion = caseVersion;
    if (
      this.recoveryResumeFromVersion !== undefined &&
      caseVersion >= this.recoveryResumeFromVersion
    ) {
      this.recoveryResumeFromVersion = undefined;
    }
  }

  allowRecoveryResumeFrom(caseVersion: number): void {
    this.recoveryResumeFromVersion = caseVersion;
  }

  expectedVersionFor(
    stateCaseVersion: number,
    requestedExpectedVersion: number | undefined,
  ): number | undefined {
    if (
      this.recoveryResumeFromVersion !== undefined &&
      stateCaseVersion > this.recoveryResumeFromVersion &&
      this.durableCaseVersion !== undefined
    ) {
      return this.durableCaseVersion;
    }
    return requestedExpectedVersion;
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

  whenIdle(): Promise<void> {
    return this.queue;
  }
}

const inspectorModes = new Set<InspectorTab>([
  "facts",
  "evidence",
  "questions",
  "hypotheses",
  "report",
]);

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

export function Workspace({
  initialCase,
  isDemo,
  onHome,
  onResetDemo,
  onImportCase,
}: WorkspaceProps) {
  const [engine] = useState(() => createReplayEngine(initialCase));
  const [replayCase, setReplayCase] = useState(() => engine.getState());
  const replayCaseRef = useRef(replayCase);
  const [currentTimeMs, setCurrentTimeMs] = useState(initialCase.timeRangeMs.start);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [activeTab, setActiveTab] = useState<InspectorTab>("facts");
  const [compareBranchIds, setCompareBranchIds] = useState<string[]>([]);
  const [reportPreview, setReportPreview] = useState<ReportPreview>();
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveFailure, setSaveFailure] = useState<SaveFailure>();
  const [recoveryBackupVersion, setRecoveryBackupVersion] = useState<number>();
  const [saveCoordinator] = useState(() => new SaveCoordinator(initialCase.caseVersion));
  const [toast, setToast] = useState<ToastState>();
  const [agentAction, setAgentAction] = useState<string>();
  const [toolInvocationActivity, setToolInvocationActivity] = useState<ActivityEvent[]>([]);
  const [toolActivityStore] = useState<{ items: ActivityEvent[] }>(() => ({ items: [] }));
  const [activeAgentIds, setActiveAgentIds] = useState<string[]>([]);
  const [focusedIssueId, setFocusedIssueId] = useState<string>();
  const [revertingActivityId, setRevertingActivityId] = useState<string>();
  const [showDebug, setShowDebug] = useState(false);
  const [confirmingDemoReset, setConfirmingDemoReset] = useState(false);
  const [evidenceUrls, setEvidenceUrls] = useState<Record<string, string>>({});
  const evidenceUrlsRef = useRef<Record<string, string>>({});
  const pendingEvidenceBlobDeletionsRef = useRef(
    new Map<string, { evidenceId: string; blobKey: string }>(),
  );
  const importInputRef = useRef<HTMLInputElement>(null);
  const registryRef = useRef<ReplayWebMCPRegistry | undefined>(undefined);
  const [writerId] = useState(() => `writer-${crypto.randomUUID()}`);
  const [writeAccess, setWriteAccess] = useState<WriteAccess>(() =>
    getLockManager() ? "checking" : "writable",
  );
  const [externalConflict, setExternalConflict] = useState<string>();
  const saveFailureIsBlocking = Boolean(
    saveFailure && (recoveryBackupVersion ?? -1) < replayCase.caseVersion,
  );
  const mutationBlockReason =
    externalConflict ??
    (writeAccess === "checking"
      ? "REPLAY is acquiring the local editing lease. Try again in a moment."
      : writeAccess === "blocked"
        ? "Another tab is editing this case. Reload after closing the other editor."
        : saveFailureIsBlocking
          ? `Local saving failed at case version ${saveFailure?.caseVersion}. Editing and Site Tools are paused until you retry the save or download a recovery backup.`
          : undefined);

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
        message: `Browser storage is not confirmed for the current case at version ${caseVersion}. ${detail}`,
      };
      saveCoordinator.setFailure(failure);
      setSaveFailure(failure);
    },
    [saveCoordinator],
  );

  const enqueueCaseSave = useCallback(
    (
      state: ReplayCase,
      options: SaveCaseOptions,
      { allowWhilePaused = false }: { allowWhilePaused?: boolean } = {},
    ): Promise<void> => {
      return saveCoordinator.enqueue(async () => {
        const activeFailure = saveCoordinator.getFailure();
        if (activeFailure && !allowWhilePaused) {
          throw new Error(
            `Local saving is paused after case version ${activeFailure.caseVersion} failed.`,
          );
        }
        setSaveState("saving");
        try {
          const expectedCaseVersion = saveCoordinator.expectedVersionFor(
            state.caseVersion,
            options.expectedCaseVersion,
          );
          await saveCase(state, {
            ...options,
            ...(expectedCaseVersion === undefined ? {} : { expectedCaseVersion }),
          });
          recordSaveSuccess(state.caseVersion);
        } catch (error) {
          recordSaveFailure(error, state.caseVersion);
          throw error;
        }
      });
    },
    [recordSaveFailure, recordSaveSuccess, saveCoordinator],
  );

  useEffect(() => {
    const locks = getLockManager();
    if (!locks) return;
    let disposed = false;
    let releaseLease: (() => void) | undefined;
    const acquisition = new AbortController();
    const acquisitionTimeout = window.setTimeout(() => acquisition.abort(), 500);
    void locks
      .request(
        `replay-case-writer:${initialCase.id}`,
        { mode: "exclusive", signal: acquisition.signal },
        async (lock) => {
          window.clearTimeout(acquisitionTimeout);
          if (disposed) return;
          if (!lock) {
            const message =
              "Another tab is editing this case. This copy is read-only until you reload.";
            saveCoordinator.setConflictSource("lease");
            setExternalConflict(message);
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
        window.clearTimeout(acquisitionTimeout);
        if (disposed) return;
        if (error instanceof DOMException && error.name === "AbortError") {
          const message =
            "Another tab is editing this case. This copy is read-only until you reload.";
          saveCoordinator.setConflictSource("lease");
          setExternalConflict(message);
          setWriteAccess("blocked");
          return;
        }
        // A browser implementation failure must not make the complete manual
        // workspace unusable; CAS persistence remains the fallback guard.
        setWriteAccess("writable");
      });
    return () => {
      disposed = true;
      window.clearTimeout(acquisitionTimeout);
      acquisition.abort();
      releaseLease?.();
    };
  }, [initialCase.id, saveCoordinator]);

  useEffect(() => {
    if (writeAccess !== "writable") return;
    void enqueueCaseSave(engine.getState(), { writerId }).catch(() => undefined);
    return engine.subscribe((state, result) => {
      saveCoordinator.setCurrentCaseVersion(state.caseVersion);
      replayCaseRef.current = state;
      setReplayCase(state);
      if (inspectorModes.has(state.workspaceMode as InspectorTab))
        setActiveTab(state.workspaceMode as InspectorTab);
      const activity = state.activity.find((item) => item.id === result.activityId);
      if (activity?.actionType !== "workspace.focus") setReportPreview(undefined);
      void enqueueCaseSave(state, {
        expectedCaseVersion: state.caseVersion - 1,
        writerId,
      }).catch(() => undefined);
    });
  }, [engine, enqueueCaseSave, saveCoordinator, writeAccess, writerId]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("replay-local-vault-updates");
    channel.addEventListener("message", (event: MessageEvent<unknown>) => {
      const update = event.data as
        | {
            caseId?: unknown;
            caseVersion?: unknown;
            updatedAt?: unknown;
            writerId?: unknown;
          }
        | undefined;
      if (
        update?.caseId !== initialCase.id ||
        update.writerId === writerId ||
        (update.caseVersion === replayCaseRef.current.caseVersion &&
          update.updatedAt === replayCaseRef.current.updatedAt)
      )
        return;
      const message = `Another tab saved case version ${String(update.caseVersion)}. Reload before editing so no human or agent work is overwritten.`;
      saveCoordinator.setConflictSource("broadcast");
      setExternalConflict(message);
      setWriteAccess("blocked");
    });
    return () => channel.close();
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
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(undefined), 4_200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!isPlaying) return;
    let animationFrame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - previous) * playbackSpeed;
      previous = now;
      setCurrentTimeMs((current) => {
        const next = current + elapsed;
        if (next >= replayCaseRef.current.timeRangeMs.end) {
          window.setTimeout(() => setIsPlaying(false), 0);
          return replayCaseRef.current.timeRangeMs.end;
        }
        return next;
      });
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [isPlaying, playbackSpeed]);

  const revealAffected = useCallback((ids: readonly string[]) => {
    setActiveAgentIds([...ids]);
    window.setTimeout(
      () => setActiveAgentIds((current) => (current.some((id) => ids.includes(id)) ? [] : current)),
      1_800,
    );
  }, []);

  const focusConsistencyIssue = useCallback(
    (issueId: string, affectedIds: readonly string[]) => {
      setFocusedIssueId(issueId);
      setActiveTab("report");
      revealAffected(affectedIds);
    },
    [revealAffected],
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

  const adapter = useMemo(
    () =>
      createReplayWebMCPAdapter(engine, {
        getCase: () => engine.getState(),
        hasReportPreview: () => Boolean(reportPreview),
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
          setActiveTab("report");
        },
        setAgentWorking: (active, toolName) =>
          setAgentAction(active ? toolName?.replaceAll("_", " ") : undefined),
        revealAffected,
        focusIssue: focusConsistencyIssue,
        setComparison: setCompareBranchIds,
        getVisibleActivity: () => [...engine.getState().activity, ...toolActivityStore.items],
        recordToolInvocation,
        getMutationBlockReason: () => mutationBlockReason,
      }),
    [
      engine,
      enqueueCaseSave,
      focusConsistencyIssue,
      mutationBlockReason,
      recordToolInvocation,
      reportPreview,
      revealAffected,
      saveCoordinator,
      toolActivityStore,
      writerId,
    ],
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
    const activeRegistry = new ReplayWebMCPRegistry(adapter);
    registryRef.current = activeRegistry;
    const unsubscribe = activeRegistry.subscribeDebug(setDebugState);
    void activeRegistry.start();
    return () => {
      unsubscribe();
      activeRegistry.stop();
      if (registryRef.current === activeRegistry) registryRef.current = undefined;
    };
  }, [adapter]);

  const runCommand = useCallback(
    (command: Record<string, unknown>, quiet = false): ReplayCommandResult => {
      const blockedReason = mutationBlockReason;
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
      const result = engine.execute({ ...humanMeta(), ...command });
      if (!result.ok) {
        const detail = commandFailureDetail(result);
        setToast({ kind: "error", message: result.message, ...(detail ? { detail } : {}) });
      } else if (!quiet) setToast({ kind: "success", message: result.message });
      return result;
    },
    [engine, mutationBlockReason],
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

  async function flushPendingEvidenceBlobDeletions(): Promise<boolean> {
    let complete = true;
    for (const pending of [...pendingEvidenceBlobDeletionsRef.current.values()]) {
      const tombstone = replayCaseRef.current.evidence.find(
        (asset) => asset.id === pending.evidenceId,
      );
      if (!tombstone?.deleted) continue;
      try {
        await deleteEvidenceBlob(pending.blobKey);
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
      await enqueueCaseSave(replayCaseRef.current, { writerId }, { allowWhilePaused: true });
      const evidenceCleanupComplete = await flushPendingEvidenceBlobDeletions();
      setToast(
        evidenceCleanupComplete
          ? { kind: "success", message: "The current case is saved in the local vault." }
          : {
              kind: "error",
              message: "The case is saved, but some deleted evidence bytes remain in storage.",
              detail: "Retry once more or clear this site's data before leaving the device.",
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

  function downloadSaveRecoveryBackup(): void {
    try {
      const state = replayCaseRef.current;
      exportCaseJson(state);
      setRecoveryBackupVersion(state.caseVersion);
      // This exact in-memory version is now recoverable outside IndexedDB. Let
      // the next mutation try browser persistence again; a new failure creates
      // a fresh block for any changes not covered by this backup.
      saveCoordinator.setFailure(undefined);
      saveCoordinator.allowRecoveryResumeFrom(state.caseVersion);
      setToast({
        kind: "info",
        message: `Downloaded a recovery backup for case version ${state.caseVersion}.`,
        detail:
          "Editing can continue, but retry local saving before relying on browser storage again.",
      });
    } catch (error) {
      setToast({ kind: "error", message: downloadErrorMessage(error) });
    }
  }

  function runHistoryAction(direction: "undo" | "redo"): void {
    if (mutationBlockReason) {
      setToast({ kind: "error", message: mutationBlockReason });
      return;
    }
    const result = direction === "undo" ? engine.undo() : engine.redo();
    if (!result.ok) setToast({ kind: "error", message: result.message });
  }

  function selectItem(type: WorkspaceItemType, itemId: string): void {
    runCommand(
      {
        type: "workspace.focus",
        itemType: type,
        itemId,
        workspaceMode: workspaceModeForItem(type),
      },
      true,
    );
  }

  function moveKeyframePosition(
    trajectoryId: string,
    keyframeId: string,
    x: number,
    y: number,
  ): void {
    const state = engine.getState();
    const trajectory = state.trajectories.find((item) => item.id === trajectoryId);
    if (!trajectory) return;
    runCommand(
      {
        type: "trajectory.set",
        trajectoryId,
        actorId: trajectory.actorId,
        branchId: trajectory.branchId,
        keyframes: trajectory.keyframes.map((frame) => {
          const input = toTrajectoryKeyframeInput(frame);
          return frame.id === keyframeId ? { ...input, x, y } : input;
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
    const state = engine.getState();
    const trajectory = state.trajectories.find(
      (item) => item.actorId === actorId && item.branchId === state.activeBranchId,
    );
    if (!trajectory) {
      runCommand({ type: "actor.update-pose", actorId, pose }, true);
      return;
    }
    const targetTime = Math.round(currentTimeMs);
    const nearest = trajectory.keyframes.reduce<{ index: number; distance: number } | undefined>(
      (best, frame, index) => {
        const distance = Math.abs(frame.timeMs - targetTime);
        return !best || distance < best.distance ? { index, distance } : best;
      },
      undefined,
    );
    const keyframes = trajectory.keyframes.map(toTrajectoryKeyframeInput);
    if (nearest && nearest.distance <= 150) {
      const currentFrame = keyframes[nearest.index];
      if (currentFrame) keyframes[nearest.index] = { ...currentFrame, ...pose };
    } else {
      keyframes.push({ timeMs: targetTime, ...pose, id: `keyframe-${crypto.randomUUID()}` });
      keyframes.sort((left, right) => left.timeMs - right.timeMs);
    }
    runCommand(
      {
        type: "trajectory.set",
        trajectoryId: trajectory.id,
        actorId,
        branchId: trajectory.branchId,
        keyframes,
        visible: trajectory.visible,
      },
      true,
    );
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
    const start = Math.min(Math.round(currentTimeMs), state.timeRangeMs.end - 1_000);
    const end = Math.min(state.timeRangeMs.end, Math.max(start + 1_000, start + 4_000));
    const radians = (actor.pose.rotationDeg * Math.PI) / 180;
    const dx = Math.sin(radians) * 12;
    const dy = -Math.cos(radians) * 12;
    const result = runCommand({
      type: "trajectory.set",
      actorId,
      branchId: state.activeBranchId,
      keyframes: [
        { timeMs: start, ...actor.pose },
        {
          timeMs: end,
          x: Math.max(0, Math.min(100, actor.pose.x + dx)),
          y: Math.max(0, Math.min(100, actor.pose.y + dy)),
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

  function markImpact(location: { x: number; y: number }): void {
    const state = engine.getState();
    const existing = state.timelineEvents.find(
      (item) => item.branchId === state.activeBranchId && item.type === "impact",
    );
    runCommand({
      type: "timeline.upsert",
      ...(existing ? { eventId: existing.id } : {}),
      branchId: state.activeBranchId,
      timeMs: Math.round(currentTimeMs),
      eventType: "impact",
      title: existing?.title ?? "Approximate contact",
      certainty: existing?.certainty ?? "uncertain",
      linkedActorIds: existing?.linkedActorIds.length
        ? existing.linkedActorIds
        : state.actors.map((actor) => actor.id),
      linkedClaimIds: existing?.linkedClaimIds ?? [],
      linkedEvidenceIds: existing?.linkedEvidenceIds ?? [],
      location,
    });
  }

  function addTimelineEvent(input: {
    title: string;
    eventType: "actor-start" | "maneuver" | "observation" | "evidence" | "actor-stop";
    certainty: "reported" | "likely" | "uncertain" | "disputed" | "unknown";
    linkedActorIds: string[];
  }): void {
    runCommand({
      type: "timeline.upsert",
      branchId: replayCaseRef.current.activeBranchId,
      timeMs: Math.round(currentTimeMs),
      ...input,
      linkedClaimIds: [],
      linkedEvidenceIds: [],
    });
  }

  function moveKeyframeTime(trajectoryId: string, keyframeId: string, timeMs: number): void {
    const state = engine.getState();
    const trajectory = state.trajectories.find((item) => item.id === trajectoryId);
    if (!trajectory) return;
    const index = trajectory.keyframes.findIndex((frame) => frame.id === keyframeId);
    if (index < 0) return;
    const previous = trajectory.keyframes[index - 1];
    const next = trajectory.keyframes[index + 1];
    const safeTime = Math.max(
      previous ? previous.timeMs + 1 : state.timeRangeMs.start,
      Math.min(next ? next.timeMs - 1 : state.timeRangeMs.end, timeMs),
    );
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
    const safeTime = Math.max(
      previous ? previous.timeMs + 1 : state.timeRangeMs.start,
      Math.min(next ? next.timeMs - 1 : state.timeRangeMs.end, update.timeMs),
    );
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
              x: Math.max(0, Math.min(100, update.x)),
              y: Math.max(0, Math.min(100, update.y)),
              rotationDeg: update.rotationDeg,
            }
          : input;
      }),
      visible: trajectory.visible,
    });
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

  function moveTimelineEvent(eventId: string, timeMs: number): void {
    const timelineEvent = engine.getState().timelineEvents.find((item) => item.id === eventId);
    if (!timelineEvent) return;
    runCommand(
      {
        type: "timeline.upsert",
        eventId,
        branchId: timelineEvent.branchId,
        timeMs,
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
      ? {
          x: Math.max(0, Math.min(100, update.location.x)),
          y: Math.max(0, Math.min(100, update.location.y)),
        }
      : timelineEvent.location;
    runCommand({
      type: "timeline.upsert",
      eventId,
      branchId: timelineEvent.branchId,
      timeMs: Math.max(state.timeRangeMs.start, Math.min(state.timeRangeMs.end, update.timeMs)),
      eventType: timelineEvent.type,
      title: timelineEvent.title,
      certainty: update.certainty,
      linkedActorIds: timelineEvent.linkedActorIds,
      linkedClaimIds: timelineEvent.linkedClaimIds,
      linkedEvidenceIds: timelineEvent.linkedEvidenceIds,
      ...(location ? { location } : {}),
    });
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
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowed.has(input.file.type)) {
      setToast({ kind: "error", message: "Choose a JPEG, PNG, or WebP image." });
      return;
    }
    if (input.file.size > 20 * 1024 * 1024) {
      setToast({ kind: "error", message: "Evidence images must be 20 MB or smaller." });
      return;
    }
    try {
      const bitmap = await createImageBitmap(input.file);
      if (
        bitmap.width > 12_000 ||
        bitmap.height > 12_000 ||
        bitmap.width * bitmap.height > 50_000_000
      ) {
        bitmap.close();
        setToast({
          kind: "error",
          message: "This image is too large to inspect safely. Use an image under 50 megapixels.",
        });
        return;
      }
      bitmap.close();
    } catch {
      setToast({ kind: "error", message: "This file does not contain a readable image." });
      return;
    }
    const bytes = await input.file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const checksum = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    if (
      replayCaseRef.current.evidence.some((asset) => asset.checksum === checksum && !asset.deleted)
    ) {
      setToast({ kind: "error", message: "This image is already in the evidence tray." });
      return;
    }
    const evidenceId = `evidence-${crypto.randomUUID()}`;
    const blobKey = `evidence:${crypto.randomUUID()}`;
    try {
      await saveEvidenceBlob({
        key: blobKey,
        caseId: replayCaseRef.current.id,
        checksum,
        mimeType: input.file.type,
        blob: input.file,
        createdAt: new Date().toISOString(),
      });
    } catch {
      setToast({
        kind: "error",
        message: "The image could not be written to the local evidence vault.",
      });
      return;
    }
    const result = runCommand({
      type: "evidence.add",
      evidenceId,
      name: input.file.name,
      mimeType: input.file.type,
      sizeBytes: input.file.size,
      localBlobKey: blobKey,
      checksum,
      syntheticDemoAsset: false,
      source: "local-upload",
      ...(input.notes ? { notes: input.notes } : {}),
      ...(input.capturedAt ? { capturedAt: new Date(input.capturedAt).toISOString() } : {}),
      tags: [],
    });
    if (!result.ok) {
      await deleteEvidenceBlob(blobKey);
      return;
    }
    const url = URL.createObjectURL(input.file);
    setEvidenceUrls((current) => {
      const next = { ...current, [evidenceId]: url };
      evidenceUrlsRef.current = next;
      return next;
    });
    selectItem("evidence", evidenceId);
  }

  async function deleteEvidence(evidenceId: string): Promise<void> {
    const asset = replayCaseRef.current.evidence.find((item) => item.id === evidenceId);
    const previousCaseVersion = replayCaseRef.current.caseVersion;
    const result = runCommand({ type: "evidence.delete", evidenceId, confirmed: true }, true);
    if (!result.ok || !asset) return;
    const deletedCaseVersion = engine.getState().caseVersion;
    try {
      await enqueueCaseSave(
        engine.getState(),
        { expectedCaseVersion: previousCaseVersion, writerId },
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
          detail: "Retry the local case save or download a recovery backup before editing again.",
        });
        return;
      }
    }
    if (asset.localBlobKey.startsWith("evidence:")) {
      try {
        await deleteEvidenceBlob(asset.localBlobKey);
      } catch {
        pendingEvidenceBlobDeletionsRef.current.set(asset.localBlobKey, {
          evidenceId,
          blobKey: asset.localBlobKey,
        });
        setToast({
          kind: "error",
          message:
            "Evidence metadata and links were scrubbed, but browser storage could not remove the image bytes. Clear this site's data before leaving the device.",
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
  ): void {
    runCommand({
      type: "question.update",
      questionId,
      status,
      ...(status === "answered" && answer
        ? { answer, answerSource: "human-statement", convertAnswerToObservation: convert }
        : {}),
    });
  }

  function buildPreview(): void {
    const preview = buildReportPreview(replayCaseRef.current);
    setReportPreview(preview);
    setActiveTab("report");
    setToast({
      kind: "info",
      message: "Built a fresh report preview from the current structured case.",
    });
  }

  async function importFile(file: File | undefined): Promise<void> {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setToast({ kind: "error", message: "Structured case imports must be 20 MB or smaller." });
      return;
    }
    try {
      onImportCase(
        importReplayCase(await file.text(), {
          rekeyCaseId: `case-import-${crypto.randomUUID()}`,
        }),
      );
    } catch (error) {
      setToast({
        kind: "error",
        message: error instanceof Error ? error.message : "The structured case export is invalid.",
      });
    }
  }

  async function exportPdf(): Promise<void> {
    try {
      await exportReportPdf(
        replayCaseRef.current,
        reportPreview ?? buildReportPreview(replayCaseRef.current),
      );
    } catch (error) {
      setToast({ kind: "error", message: downloadErrorMessage(error) });
    }
  }

  async function exportScene(format: "svg" | "png"): Promise<void> {
    try {
      if (format === "svg") exportSceneSvg(replayCaseRef.current);
      else await exportScenePng(replayCaseRef.current);
    } catch (error) {
      setToast({ kind: "error", message: downloadErrorMessage(error) });
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
    if (mutationBlockReason) {
      setToast({ kind: "error", message: mutationBlockReason });
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

  const selectedId = replayCase.selectedItem?.id;
  const revertibleActivityIds = mutationBlockReason
    ? []
    : replayCase.activity.flatMap((activity) =>
        activity.requestId && engine.canRevertAgentAction(activity.requestId) ? [activity.id] : [],
      );
  const branchNames = Object.fromEntries(
    replayCase.branches.map((branch) => [branch.id, branch.name]),
  );

  return (
    <main className="workspace">
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
        isDemo={isDemo}
        saveState={saveState}
        canUndo={engine.canUndo && !mutationBlockReason}
        canRedo={engine.canRedo && !mutationBlockReason}
        webMcpSupported={debugState.supported}
        registeredTools={debugState.registeredToolNames.length}
        agentWorking={Boolean(agentAction)}
        onHome={() => onHome(replayCaseRef.current)}
        onUndo={() => runHistoryAction("undo")}
        onRedo={() => runHistoryAction("redo")}
        onResetDemo={() => {
          if (mutationBlockReason) setToast({ kind: "error", message: mutationBlockReason });
          else setConfirmingDemoReset(true);
        }}
        onImport={() => {
          if (mutationBlockReason) setToast({ kind: "error", message: mutationBlockReason });
          else importInputRef.current?.click();
        }}
        onExport={() => exportCaseJson(replayCaseRef.current)}
        onDebug={() => setShowDebug(true)}
      />
      {externalConflict && (
        <div className="workspace-conflict" role="alert">
          <CircleAlert size={18} />
          <div>
            <strong>Editing paused to protect local work</strong>
            <span>{externalConflict}</span>
          </div>
          <button className="button button--secondary" onClick={() => window.location.reload()}>
            Reload latest
          </button>
        </div>
      )}
      {saveFailure && (
        <div
          className={`workspace-save-failure${saveFailureIsBlocking ? " is-blocking" : ""}`}
          role={saveFailureIsBlocking ? "alert" : "status"}
        >
          <CircleAlert size={18} aria-hidden="true" />
          <div>
            <strong>
              {saveFailureIsBlocking
                ? "Local save failed. Editing is paused."
                : "Local save failed. Recovery backup downloaded."}
            </strong>
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
            <button className="button button--secondary" onClick={downloadSaveRecoveryBackup}>
              <Download size={14} aria-hidden="true" /> Download recovery backup
            </button>
          </div>
        </div>
      )}
      <div className="mobile-edit-guidance" role="note">
        <CircleAlert size={16} aria-hidden="true" />
        <span>
          Phone view prioritizes review. Use a larger screen for precise dragging; exact numeric
          controls remain available after selecting a scene item.
        </span>
      </div>
      <div className="workspace-grid" id="main-content" tabIndex={-1}>
        <div className="workspace-scene">
          {compareBranchIds.length > 0 && (
            <div className="comparison-banner">
              <Bot size={14} />
              <span>
                Overlaying{" "}
                {compareBranchIds
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
            comparisonBranchIds={compareBranchIds}
            activeAgentIds={activeAgentIds}
            onSelect={(type, id) => selectItem(type, id)}
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
              })
            }
            onMarkImpact={markImpact}
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
        <InspectorPanel
          replayCase={replayCase}
          currentTimeMs={currentTimeMs}
          activeTab={activeTab}
          {...(focusedIssueId ? { focusedIssueId } : {})}
          {...(selectedId ? { selectedId } : {})}
          {...(reportPreview ? { reportPreview } : {})}
          evidenceUrls={evidenceUrls}
          compareBranchIds={compareBranchIds}
          onTabChange={setActiveTab}
          onSelect={(type, id) => selectItem(type, id)}
          onAddClaim={(statement, status, sourceType) =>
            runCommand({
              type: "claim.add",
              statement,
              status,
              sourceType,
              sourceIds: [],
              linkedEvidenceIds: [],
              linkedEventIds: [],
              linkedSceneObjectIds: [],
              sharedAcrossBranches: true,
            })
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
          onUpdateTrajectoryKeyframe={updateTrajectoryKeyframeExact}
          onSetTrajectoryVisible={setTrajectoryVisible}
          onUpdateTimelineEvent={updateTimelineEventExact}
          onToggleSceneItemLock={toggleSceneItemLock}
          onAdjustProposal={(proposalId, summary, changes) =>
            runCommand({ type: "proposal.adjust", proposalId, summary, changes })
          }
          onAcceptProposal={(proposalId) => runCommand({ type: "proposal.accept", proposalId })}
          onRejectProposal={(proposalId) => runCommand({ type: "proposal.reject", proposalId })}
          onUploadEvidence={(input) => void uploadEvidence(input)}
          onDeleteEvidence={deleteEvidence}
          onUpdateEvidence={(evidenceId, update) =>
            runCommand({ type: "evidence.update", evidenceId, ...update })
          }
          onLinkEvidence={(evidenceId, targetType, targetId, annotationId) =>
            runCommand({
              type: "evidence.link",
              evidenceId,
              targetType,
              targetId,
              ...(annotationId ? { annotationId } : {}),
            })
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
            })
          }
          onUpdateQuestion={updateQuestion}
          onForkBranch={(parentBranchId, name, description) =>
            runCommand({ type: "hypothesis.fork", parentBranchId, name, description })
          }
          onSetActiveBranch={(branchId) => runCommand({ type: "hypothesis.set-active", branchId })}
          onRenameBranch={(branchId, name, description) =>
            runCommand({ type: "hypothesis.rename", branchId, name, description })
          }
          onAddAssumption={(branchId, statement) =>
            runCommand({
              type: "hypothesis.add-assumption",
              branchId,
              statement,
              supportingEvidenceIds: [],
              conflictingEvidenceIds: [],
            })
          }
          onUpdateAssumption={(branchId, assumptionId, update) =>
            runCommand({
              type: "hypothesis.update-assumption",
              branchId,
              assumptionId,
              ...update,
            })
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
          onBuildReport={buildPreview}
          onAddReportNote={(text, claimIds, evidenceIds) => {
            runCommand({
              type: "report.add-note",
              text,
              claimIds,
              evidenceIds,
            });
          }}
          onReviewReportNote={(noteId, approved) =>
            runCommand({ type: "report.review-note", noteId, approved })
          }
          onFinalizeReport={() => {
            const result = runCommand({
              type: "report.finalize",
              unresolvedQuestionsReviewed: true,
              limitationsAcknowledged: true,
              confirmedFactsReviewed: true,
              manualConfirmation: true,
              includeHypotheses: true,
            });
            if (result.ok) {
              const snapshot = engine.getState().reportSnapshots.at(-1);
              if (snapshot) setReportPreview(snapshot.preview);
            }
          }}
          onExportJson={() => exportCaseJson(replayCaseRef.current)}
          onExportPdf={() => void exportPdf()}
          onExportScene={(format) => void exportScene(format)}
        />
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
          {...(compareBranchIds.length > 0
            ? {
                comparison: {
                  branchIds: compareBranchIds.filter((id) => id !== replayCase.activeBranchId),
                  branchNames,
                  onExit: () => setCompareBranchIds([]),
                },
              }
            : {})}
          onTimeChange={(time) => {
            setCurrentTimeMs(time);
            setIsPlaying(false);
          }}
          onPlayingChange={setIsPlaying}
          onPlaybackSpeedChange={setPlaybackSpeed}
          onSelectEvent={(eventId) => selectItem("timeline-event", eventId)}
          onSelectKeyframe={(trajectoryId) => selectItem("trajectory", trajectoryId)}
          onMoveEvent={moveTimelineEvent}
          onMoveKeyframe={moveKeyframeTime}
          onAddEvent={addTimelineEvent}
        />
        <div className="workspace-activity">
          <ActivityPanel
            activities={[...replayCase.activity, ...toolInvocationActivity]}
            {...(agentAction ? { activeAgentAction: agentAction } : {})}
            {...(revertingActivityId ? { revertingActivityId } : {})}
            revertibleActivityIds={revertibleActivityIds}
            maxItems={20}
            onRevert={revertActivity}
            onSelectActivity={focusActivity}
          />
        </div>
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
          <button onClick={() => setToast(undefined)} aria-label="Dismiss notification">
            ×
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
        />
      )}
      {confirmingDemoReset && (
        <DemoResetDialog
          onCancel={() => setConfirmingDemoReset(false)}
          onConfirm={async () => {
            await saveCoordinator.whenIdle();
            if (saveCoordinator.getFailure() || saveCoordinator.getConflictSource()) {
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
    </main>
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
        <h2 id="reset-demo-title">Reset the deterministic demo?</h2>
        <p id="reset-demo-description">
          This permanently removes the saved demo case and its local evidence, then opens the
          original deterministic seed. Export anything you need before continuing.
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
            className="button button--danger"
            disabled={resetting}
            onClick={() => void confirmReset()}
          >
            {resetting ? "Resetting…" : "Reset demo"}
          </button>
        </footer>
      </section>
    </div>
  );
}

interface WorkspaceHeaderProps {
  replayCase: ReplayCase;
  isDemo: boolean;
  saveState: SaveState;
  canUndo: boolean;
  canRedo: boolean;
  webMcpSupported: boolean;
  registeredTools: number;
  agentWorking: boolean;
  onHome: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onResetDemo: () => void;
  onImport: () => void;
  onExport: () => void;
  onDebug: () => void;
}

function WorkspaceHeader(props: WorkspaceHeaderProps) {
  return (
    <header className="workspace-header">
      <button
        className="workspace-header__brand"
        onClick={props.onHome}
        aria-label="Back to REPLAY home"
      >
        <BrandMark compact />
      </button>
      <div className="workspace-case-title">
        <span>{props.isDemo ? "Demo case" : "Local case"}</span>
        <h1>{props.replayCase.title}</h1>
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
      <div className="workspace-header__spacer" />
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
      <button
        className={`webmcp-status${props.webMcpSupported ? " is-supported" : ""}${props.agentWorking ? " is-working" : ""}`}
        onClick={props.onDebug}
      >
        <span className="webmcp-status__dot" />
        {props.webMcpSupported ? (
          <Wifi size={14} aria-hidden="true" />
        ) : (
          <CloudOff size={14} aria-hidden="true" />
        )}
        <span className="webmcp-status__text">
          <strong>Site Tools</strong>{" "}
          <small>
            {props.webMcpSupported ? `${props.registeredTools} registered` : "Manual mode"}
          </small>
        </span>
      </button>
      <details className="workspace-menu">
        <summary aria-label="Case options">
          <Settings2 size={16} />
          <ChevronDown size={12} />
        </summary>
        <div>
          <button onClick={props.onExport}>
            <Download size={14} /> Export structured case JSON
          </button>
          <button onClick={props.onImport}>
            <FileUp size={14} /> Import structured case JSON
          </button>
          {props.isDemo && (
            <button onClick={props.onResetDemo}>
              <RotateCcw size={14} /> Reset deterministic demo
            </button>
          )}
          <button onClick={props.onDebug}>
            <ShieldCheck size={14} /> WebMCP inspector
          </button>
          <button onClick={props.onHome}>
            <Home size={14} /> Close workspace
          </button>
        </div>
      </details>
    </header>
  );
}
