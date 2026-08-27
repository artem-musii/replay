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
  saveCase,
  saveEvidenceBlob,
} from "../persistence/database";
import { ReplayWebMCPRegistry, type WebMCPDebugState, type WebMCPToolName } from "../webmcp";
import { ActivityPanel } from "./ActivityPanel";
import { BrandMark } from "./BrandMark";
import { type EvidenceUploadInput, InspectorPanel, type InspectorTab } from "./InspectorPanel";
import { SceneCanvas } from "./SceneCanvas";
import { Timeline } from "./Timeline";
import { WebMCPDebugPanel } from "./WebMCPDebugPanel";

interface WorkspaceProps {
  initialCase: ReplayCase;
  isDemo: boolean;
  onHome: (latestCase: ReplayCase) => void;
  onResetDemo: () => void;
  onImportCase: (replayCase: ReplayCase) => void;
}

type SaveState = "saving" | "saved" | "error";

interface ToastState {
  kind: "success" | "error" | "info";
  message: string;
  detail?: string;
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
  const [toast, setToast] = useState<ToastState>();
  const [agentAction, setAgentAction] = useState<string>();
  const [activeAgentIds, setActiveAgentIds] = useState<string[]>([]);
  const [revertingActivityId, setRevertingActivityId] = useState<string>();
  const [showDebug, setShowDebug] = useState(false);
  const [evidenceUrls, setEvidenceUrls] = useState<Record<string, string>>({});
  const evidenceUrlsRef = useRef<Record<string, string>>({});
  const importInputRef = useRef<HTMLInputElement>(null);
  const registryRef = useRef<ReplayWebMCPRegistry | undefined>(undefined);

  useEffect(() => {
    void saveCase(engine.getState()).then(
      () => setSaveState("saved"),
      () => setSaveState("error"),
    );
    return engine.subscribe((state, result) => {
      replayCaseRef.current = state;
      setReplayCase(state);
      setSaveState("saving");
      if (inspectorModes.has(state.workspaceMode as InspectorTab))
        setActiveTab(state.workspaceMode as InspectorTab);
      const activity = state.activity.find((item) => item.id === result.activityId);
      if (activity?.actionType !== "workspace.focus") setReportPreview(undefined);
      void saveCase(state).then(
        () => {
          if (replayCaseRef.current.caseVersion === state.caseVersion) setSaveState("saved");
        },
        () => setSaveState("error"),
      );
    });
  }, [engine]);

  useEffect(() => {
    let disposed = false;
    const createdUrls: string[] = [];
    void Promise.all(
      initialCase.evidence
        .filter((asset) => !asset.deleted && asset.localBlobKey.startsWith("evidence:"))
        .map(async (asset) => {
          const blob = await loadEvidenceBlob(asset.localBlobKey);
          if (!blob || disposed) return;
          const url = URL.createObjectURL(blob);
          createdUrls.push(url);
          setEvidenceUrls((current) => {
            const next = { ...current, [asset.id]: url };
            evidenceUrlsRef.current = next;
            return next;
          });
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

  const adapter = useMemo(
    () =>
      createReplayWebMCPAdapter(engine, {
        getCase: () => engine.getState(),
        hasReportPreview: () => Boolean(reportPreview),
        persistCase: saveCase,
        setReportPreview: (preview) => {
          setReportPreview(preview);
          setActiveTab("report");
        },
        setAgentWorking: (active, toolName) =>
          setAgentAction(active ? toolName?.replaceAll("_", " ") : undefined),
        revealAffected,
        setComparison: setCompareBranchIds,
      }),
    [engine, reportPreview, revealAffected],
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
      const result = engine.execute({ ...humanMeta(), ...command });
      if (!result.ok) {
        const detail = commandFailureDetail(result);
        setToast({ kind: "error", message: result.message, ...(detail ? { detail } : {}) });
      } else if (!quiet) setToast({ kind: "success", message: result.message });
      return result;
    },
    [engine],
  );

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
    const evidenceId = `evidence-${checksum.slice(0, 16)}`;
    const blobKey = `evidence:${replayCaseRef.current.id}:${checksum}`;
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

  function deleteEvidence(evidenceId: string): void {
    const asset = replayCaseRef.current.evidence.find((item) => item.id === evidenceId);
    const result = runCommand({ type: "evidence.delete", evidenceId, confirmed: true });
    if (!result.ok || !asset) return;
    if (asset.localBlobKey.startsWith("evidence:")) void deleteEvidenceBlob(asset.localBlobKey);
    setEvidenceUrls((current) => {
      const url = current[evidenceId];
      if (url) URL.revokeObjectURL(url);
      const next = Object.fromEntries(Object.entries(current).filter(([id]) => id !== evidenceId));
      evidenceUrlsRef.current = next;
      return next;
    });
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
    if (file.size > 5 * 1024 * 1024) {
      setToast({ kind: "error", message: "Case imports must be 5 MB or smaller." });
      return;
    }
    try {
      onImportCase(importReplayCase(await file.text()));
    } catch (error) {
      setToast({
        kind: "error",
        message: error instanceof Error ? error.message : "The case backup is invalid.",
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
    const activity = replayCaseRef.current.activity.find((item) => item.id === activityId);
    if (!activity?.requestId) return;
    setRevertingActivityId(activityId);
    const result = engine.revertAgentAction(activity.requestId, humanMeta());
    if (!result.ok) setToast({ kind: "error", message: result.message });
    else setToast({ kind: "success", message: result.message });
    setRevertingActivityId(undefined);
  }

  const selectedId = replayCase.selectedItem?.id;
  const branchNames = Object.fromEntries(
    replayCase.branches.map((branch) => [branch.id, branch.name]),
  );

  return (
    <main className="workspace" id="main-content">
      <input
        ref={importInputRef}
        className="visually-hidden"
        type="file"
        accept="application/json,.json"
        aria-label="Import case JSON"
        onChange={(event) => void importFile(event.target.files?.[0])}
      />
      <WorkspaceHeader
        replayCase={replayCase}
        isDemo={isDemo}
        saveState={saveState}
        canUndo={engine.canUndo}
        canRedo={engine.canRedo}
        webMcpSupported={debugState.supported}
        registeredTools={debugState.registeredToolNames.length}
        agentWorking={Boolean(agentAction)}
        onHome={() => onHome(replayCaseRef.current)}
        onUndo={() => {
          const result = engine.undo();
          if (!result.ok) setToast({ kind: "error", message: result.message });
        }}
        onRedo={() => {
          const result = engine.redo();
          if (!result.ok) setToast({ kind: "error", message: result.message });
        }}
        onResetDemo={onResetDemo}
        onImport={() => importInputRef.current?.click()}
        onExport={() => exportCaseJson(replayCaseRef.current)}
        onDebug={() => setShowDebug(true)}
      />
      <div className="workspace-grid">
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
          activeTab={activeTab}
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
          onUploadEvidence={(input) => void uploadEvidence(input)}
          onDeleteEvidence={deleteEvidence}
          onUpdateEvidence={(evidenceId, update) =>
            runCommand({ type: "evidence.update", evidenceId, ...update })
          }
          onLinkEvidence={(evidenceId, targetType, targetId) =>
            runCommand({ type: "evidence.link", evidenceId, targetType, targetId })
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
          onAddAssumption={(branchId, statement) =>
            runCommand({
              type: "hypothesis.add-assumption",
              branchId,
              statement,
              supportingEvidenceIds: [],
              conflictingEvidenceIds: [],
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
            const state = replayCaseRef.current;
            const affectedId = issue.affectedIds[0];
            if (!affectedId) {
              setToast({ kind: "info", message: issue.explanation });
              return;
            }
            if (state.actors.some((item) => item.id === affectedId))
              selectItem("actor", affectedId);
            else if (state.trajectories.some((item) => item.id === affectedId))
              selectItem("trajectory", affectedId);
            else if (state.timelineEvents.some((item) => item.id === affectedId)) {
              selectItem("timeline-event", affectedId);
              const event = state.timelineEvents.find((item) => item.id === affectedId);
              if (event) setCurrentTimeMs(event.timeMs);
            } else if (state.claims.some((item) => item.id === affectedId))
              selectItem("claim", affectedId);
            else if (state.evidence.some((item) => item.id === affectedId))
              selectItem("evidence", affectedId);
            else if (state.questions.some((item) => item.id === affectedId))
              selectItem("question", affectedId);
            else if (state.branches.some((item) => item.id === affectedId))
              selectItem("hypothesis", affectedId);
            else setToast({ kind: "info", message: issue.explanation });
          }}
          onBuildReport={buildPreview}
          onAddReportNote={(text) => {
            const claimId =
              replayCaseRef.current.selectedItem?.type === "claim"
                ? replayCaseRef.current.selectedItem.id
                : replayCaseRef.current.claims.find((item) => item.humanConfirmed)?.id;
            const evidenceId =
              replayCaseRef.current.selectedItem?.type === "evidence"
                ? replayCaseRef.current.selectedItem.id
                : undefined;
            if (!claimId && !evidenceId) {
              setToast({
                kind: "error",
                message: "Select a claim or evidence item before adding an evidence-bound note.",
              });
              return;
            }
            runCommand({
              type: "report.add-note",
              text,
              claimIds: claimId ? [claimId] : [],
              evidenceIds: evidenceId ? [evidenceId] : [],
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
            activities={replayCase.activity}
            {...(agentAction ? { activeAgentAction: agentAction } : {})}
            {...(revertingActivityId ? { revertingActivityId } : {})}
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
    </main>
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
        <strong>{props.replayCase.title}</strong>
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
        aria-label={`Site Tools: ${props.webMcpSupported ? `${props.registeredTools} registered` : "manual browser mode"}`}
      >
        <span className="webmcp-status__dot" />
        {props.webMcpSupported ? (
          <Wifi size={14} aria-hidden="true" />
        ) : (
          <CloudOff size={14} aria-hidden="true" />
        )}
        <span>
          <strong>Site Tools</strong>
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
            <Download size={14} /> Export JSON backup
          </button>
          <button onClick={props.onImport}>
            <FileUp size={14} /> Import case backup
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
