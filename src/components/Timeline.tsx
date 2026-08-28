import { GitCompareArrows, Pause, Play, Plus, SkipBack, SkipForward, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import {
  clampTimeToRange,
  editableKeyframeTimeBounds,
  quantizeEditableTimeMs,
  quantizeTimeInRange,
  REPLAY_TIME_STEP_MS,
} from "../domain/interpolation";
import type { SceneActor, TimelineEvent, Trajectory } from "../domain/models";
import "../styles/timeline.css";
import { useDialogFocus } from "./useDialogFocus";

export interface TimelineComparison {
  /** Branches shown in addition to the active branch. */
  branchIds: string[];
  /** Human-readable branch names keyed by branch id. */
  branchNames?: Record<string, string>;
  onExit?: () => void;
}

export interface TimelineProps {
  timeRangeMs: { start: number; end: number };
  currentTimeMs: number;
  isPlaying: boolean;
  playbackSpeed: number;
  /** Optional incident clock start, either HH:mm or an ISO date-time. */
  absoluteClockStart?: string;
  activeBranchId: string;
  actors: SceneActor[];
  trajectories: Trajectory[];
  events: TimelineEvent[];
  selectedId?: string;
  selectedKeyframeId?: string;
  comparison?: TimelineComparison;
  onTimeChange: (timeMs: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onPlaybackSpeedChange: (speed: number) => void;
  onSelectEvent?: (eventId: string) => void;
  onSelectKeyframe?: (trajectoryId: string, keyframeId: string) => void;
  onMoveEvent?: (eventId: string, timeMs: number) => void;
  onMoveKeyframe?: (trajectoryId: string, keyframeId: string, timeMs: number) => void;
  onAddEvent?: (input: {
    title: string;
    eventType: "actor-start" | "maneuver" | "observation" | "evidence" | "actor-stop";
    certainty: "reported" | "likely" | "uncertain" | "disputed" | "unknown";
    linkedActorIds: string[];
  }) => void;
}

type DragTarget =
  | { kind: "event"; eventId: string }
  | { kind: "keyframe"; trajectoryId: string; keyframeId: string };

interface DragState {
  target: DragTarget;
  pointerId: number;
  initialPlayheadMs: number;
  previewTimeMs?: number;
}

const SPEED_OPTIONS = [0.5, 1, 2] as const;

function clampTime(timeMs: number, range: TimelineProps["timeRangeMs"]): number {
  return clampTimeToRange(timeMs, range);
}

function timeToPercent(timeMs: number, range: TimelineProps["timeRangeMs"]): number {
  const duration = range.end - range.start;
  if (duration <= 0) return 0;
  return ((clampTime(timeMs, range) - range.start) / duration) * 100;
}

function formatTime(timeMs: number, precise = false): string {
  const normalizedTimeMs = Math.max(0, Math.round(timeMs));
  const totalSeconds = normalizedTimeMs / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  const fractionDigits = precise ? (normalizedTimeMs % REPLAY_TIME_STEP_MS === 0 ? 1 : 3) : 0;
  const paddedLength = fractionDigits > 0 ? 3 + fractionDigits : 2;
  return `${String(minutes)}:${seconds.toFixed(fractionDigits).padStart(paddedLength, "0")}`;
}

function formatAbsoluteTime(start: string, elapsedMs: number): string | undefined {
  const clockMatch = /^(?<hours>[01]\d|2[0-3]):(?<minutes>[0-5]\d)$/.exec(start);
  if (clockMatch?.groups) {
    const initialSeconds =
      Number(clockMatch.groups.hours) * 3_600 + Number(clockMatch.groups.minutes) * 60;
    const secondsInDay = 24 * 3_600;
    const currentSeconds =
      (initialSeconds + Math.max(0, Math.round(elapsedMs / 1_000))) % secondsInDay;
    const hours = Math.floor(currentSeconds / 3_600);
    const minutes = Math.floor((currentSeconds % 3_600) / 60);
    const seconds = currentSeconds % 60;
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  }
  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) return undefined;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(startDate.getTime() + elapsedMs));
}

function actorName(actors: SceneActor[], actorId: string): string {
  return actors.find((actor) => actor.id === actorId)?.label ?? "Vehicle";
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLButtonElement ||
    target instanceof HTMLAnchorElement
  );
}

function isSameDragTarget(left: DragTarget, right: DragTarget): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "event" && right.kind === "event") return left.eventId === right.eventId;
  return (
    left.kind === "keyframe" &&
    right.kind === "keyframe" &&
    left.trajectoryId === right.trajectoryId &&
    left.keyframeId === right.keyframeId
  );
}

/**
 * A synchronized, domain-agnostic timeline. Every edit is surfaced through a
 * callback so the app shell can route it through the canonical command layer.
 */
export function Timeline({
  timeRangeMs,
  currentTimeMs,
  isPlaying,
  playbackSpeed,
  absoluteClockStart,
  activeBranchId,
  actors,
  trajectories,
  events,
  selectedId,
  selectedKeyframeId,
  comparison,
  onTimeChange,
  onPlayingChange,
  onPlaybackSpeedChange,
  onSelectEvent,
  onSelectKeyframe,
  onMoveEvent,
  onMoveKeyframe,
  onAddEvent,
}: TimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState | undefined>(undefined);
  const [dragState, setDragState] = useState<DragState>();
  const [eventEditorOpen, setEventEditorOpen] = useState(false);
  const [eventTitle, setEventTitle] = useState("");
  const [eventType, setEventType] = useState<
    "actor-start" | "maneuver" | "observation" | "evidence" | "actor-stop"
  >("observation");
  const [eventCertainty, setEventCertainty] = useState<
    "reported" | "likely" | "uncertain" | "disputed" | "unknown"
  >("reported");
  const [eventActorId, setEventActorId] = useState("all");
  const eventTitleRef = useRef<HTMLInputElement>(null);
  const eventDialogRef = useDialogFocus<HTMLElement>({
    active: eventEditorOpen,
    initialFocusRef: eventTitleRef,
    onEscape: () => setEventEditorOpen(false),
  });
  const visibleBranchIds = useMemo(
    () => new Set([activeBranchId, ...(comparison?.branchIds ?? [])]),
    [activeBranchId, comparison?.branchIds],
  );
  const visibleEvents = useMemo(
    () =>
      events
        .filter((event) => visibleBranchIds.has(event.branchId))
        .sort((left, right) => left.timeMs - right.timeMs || left.id.localeCompare(right.id)),
    [events, visibleBranchIds],
  );
  const visibleTrajectories = useMemo(
    () =>
      trajectories.filter(
        (trajectory) => visibleBranchIds.has(trajectory.branchId) && trajectory.visible,
      ),
    [trajectories, visibleBranchIds],
  );
  const ticks = useMemo(() => {
    const count = 5;
    const duration = Math.max(0, timeRangeMs.end - timeRangeMs.start);
    return Array.from({ length: count + 1 }, (_, index) => {
      const timeMs = timeRangeMs.start + (duration * index) / count;
      return { timeMs, percent: (index / count) * 100 };
    });
  }, [timeRangeMs.end, timeRangeMs.start]);

  const comparisonNames = (comparison?.branchIds ?? []).map((branchId) => ({
    branchId,
    name: comparison?.branchNames?.[branchId] ?? "Alternative",
  }));

  function timeFromPointer(clientX: number): number | undefined {
    const track = trackRef.current;
    if (!track) return undefined;
    const bounds = track.getBoundingClientRect();
    const trackInset = 12;
    const usableWidth = Math.max(1, bounds.width - trackInset * 2);
    const ratio = Math.max(0, Math.min(1, (clientX - bounds.left - trackInset) / usableWidth));
    return clampTime(
      timeRangeMs.start + ratio * (timeRangeMs.end - timeRangeMs.start),
      timeRangeMs,
    );
  }

  function moveDragTarget(target: DragTarget, timeMs: number): void {
    if (target.kind === "event") onMoveEvent?.(target.eventId, timeMs);
    else onMoveKeyframe?.(target.trajectoryId, target.keyframeId, timeMs);
  }

  function editableTimeFor(target: DragTarget, requestedTimeMs: number): number {
    if (target.kind !== "keyframe") return quantizeTimeInRange(requestedTimeMs, timeRangeMs);
    const trajectory = trajectories.find((item) => item.id === target.trajectoryId);
    const index = trajectory?.keyframes.findIndex((item) => item.id === target.keyframeId) ?? -1;
    if (!trajectory || index < 0) return quantizeTimeInRange(requestedTimeMs, timeRangeMs);
    const previous = trajectory.keyframes[index - 1];
    const next = trajectory.keyframes[index + 1];
    const bounds = editableKeyframeTimeBounds(previous?.timeMs, next?.timeMs, timeRangeMs);
    return quantizeEditableTimeMs(requestedTimeMs, bounds, timeRangeMs);
  }

  function boundedEditableTimeFor(target: DragTarget, requestedTimeMs: number): number {
    if (target.kind !== "keyframe") return clampTime(requestedTimeMs, timeRangeMs);
    const trajectory = trajectories.find((item) => item.id === target.trajectoryId);
    const index = trajectory?.keyframes.findIndex((item) => item.id === target.keyframeId) ?? -1;
    if (!trajectory || index < 0) return clampTime(requestedTimeMs, timeRangeMs);
    const previous = trajectory.keyframes[index - 1];
    const next = trajectory.keyframes[index + 1];
    const bounds = editableKeyframeTimeBounds(previous?.timeMs, next?.timeMs, timeRangeMs);
    return Math.max(bounds.min, Math.min(bounds.max, Math.round(requestedTimeMs)));
  }

  function startDrag(target: DragTarget, pointerId: number): void {
    const nextState: DragState = { target, pointerId, initialPlayheadMs: currentTimeMs };
    dragStateRef.current = nextState;
    setDragState(nextState);
  }

  function clearDrag(): void {
    dragStateRef.current = undefined;
    setDragState(undefined);
  }

  function handleTrackPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const activeDrag = dragStateRef.current;
    if (activeDrag?.pointerId !== event.pointerId) return;
    const requestedTimeMs = timeFromPointer(event.clientX);
    if (requestedTimeMs === undefined) return;
    const timeMs = editableTimeFor(activeDrag.target, requestedTimeMs);
    event.preventDefault();
    const nextState = { ...activeDrag, previewTimeMs: timeMs };
    dragStateRef.current = nextState;
    setDragState(nextState);
    onTimeChange(timeMs);
  }

  function handleTrackPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    const activeDrag = dragStateRef.current;
    if (activeDrag?.pointerId !== event.pointerId) return;
    if (activeDrag.previewTimeMs !== undefined) {
      moveDragTarget(activeDrag.target, activeDrag.previewTimeMs);
    }
    clearDrag();
  }

  function handleTrackPointerCancel(event: ReactPointerEvent<HTMLDivElement>): void {
    const activeDrag = dragStateRef.current;
    if (activeDrag?.pointerId !== event.pointerId) return;
    onTimeChange(activeDrag.initialPlayheadMs);
    clearDrag();
  }

  function previewTimeFor(target: DragTarget, committedTimeMs: number): number {
    if (dragState?.previewTimeMs !== undefined && isSameDragTarget(dragState.target, target)) {
      return dragState.previewTimeMs;
    }
    return committedTimeMs;
  }

  function handleHandleKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    target: DragTarget,
    timeMs: number,
  ): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const step = event.shiftKey ? 1_000 : 100;
    const nextTime = boundedEditableTimeFor(target, timeMs + direction * step);
    if (target.kind === "keyframe") onSelectKeyframe?.(target.trajectoryId, target.keyframeId);
    else onSelectEvent?.(target.eventId);
    moveDragTarget(target, nextTime);
    onTimeChange(nextTime);
  }

  function handleTimelineKeyboard(event: ReactKeyboardEvent<HTMLElement>): void {
    if (isInteractiveTarget(event.target)) return;
    let nextTime: number | undefined;
    if (event.key === " ") {
      event.preventDefault();
      onPlayingChange(!isPlaying);
      return;
    }
    if (event.key === "Home") nextTime = timeRangeMs.start;
    else if (event.key === "End") nextTime = timeRangeMs.end;
    else if (event.key === "ArrowLeft") nextTime = currentTimeMs - (event.shiftKey ? 1_000 : 100);
    else if (event.key === "ArrowRight") nextTime = currentTimeMs + (event.shiftKey ? 1_000 : 100);
    if (nextTime === undefined) return;
    event.preventDefault();
    onTimeChange(clampTime(nextTime, timeRangeMs));
  }

  const cursorPercent = timeToPercent(currentTimeMs, timeRangeMs);
  const showsMillisecondScale = timeRangeMs.end - timeRangeMs.start < REPLAY_TIME_STEP_MS;
  const absoluteTime = absoluteClockStart
    ? formatAbsoluteTime(absoluteClockStart, currentTimeMs - timeRangeMs.start)
    : undefined;
  const timelineStepMs =
    timeRangeMs.end - timeRangeMs.start < REPLAY_TIME_STEP_MS ? 1 : REPLAY_TIME_STEP_MS;

  function submitEvent(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!onAddEvent || !eventTitle.trim()) return;
    onAddEvent({
      title: eventTitle.trim(),
      eventType,
      certainty: eventCertainty,
      linkedActorIds: eventActorId === "all" ? actors.map((actor) => actor.id) : [eventActorId],
    });
    setEventTitle("");
    setEventEditorOpen(false);
  }

  return (
    <section
      className={`timeline${comparison && comparison.branchIds.length > 0 ? " is-comparing" : ""}`}
      aria-label="Incident timeline"
      data-onboarding-id="incident-timeline"
      tabIndex={0}
      onKeyDown={handleTimelineKeyboard}
    >
      <header className="timeline__controls">
        <div className="timeline__transport" aria-label="Playback controls">
          <button
            className="timeline-icon-button"
            type="button"
            onClick={() => onTimeChange(timeRangeMs.start)}
            aria-label="Go to start"
          >
            <SkipBack size={15} aria-hidden="true" />
          </button>
          <button
            className="timeline-icon-button timeline-icon-button--play"
            type="button"
            onClick={() => onPlayingChange(!isPlaying)}
            aria-label={isPlaying ? "Pause reconstruction" : "Play reconstruction"}
            aria-pressed={isPlaying}
          >
            {isPlaying ? (
              <Pause size={15} aria-hidden="true" />
            ) : (
              <Play size={15} aria-hidden="true" />
            )}
          </button>
          <button
            className="timeline-icon-button"
            type="button"
            onClick={() => onTimeChange(timeRangeMs.end)}
            aria-label="Go to end"
          >
            <SkipForward size={15} aria-hidden="true" />
          </button>
          <output className="timeline__time" aria-live="off" aria-label="Current timeline position">
            <strong>{formatTime(currentTimeMs, true)}</strong>
            <span>/ {formatTime(timeRangeMs.end, showsMillisecondScale)}</span>
            {absoluteTime && (
              <span className="timeline__absolute-time" title="Approximate incident clock time">
                {absoluteTime}
              </span>
            )}
          </output>
        </div>

        <div className="timeline__title">
          <span>Incident timeline</span>
          <small>Space to play · Shift + arrows for 1 second</small>
        </div>

        <div className="timeline__right-controls">
          <label className="timeline__speed">
            <span>Speed</span>
            <select
              id="playback-speed"
              name="playback-speed"
              value={playbackSpeed}
              onChange={(event) => onPlaybackSpeedChange(Number(event.target.value))}
              aria-label="Playback speed"
            >
              {SPEED_OPTIONS.map((speed) => (
                <option key={speed} value={speed}>
                  {speed}×
                </option>
              ))}
            </select>
          </label>
          {onAddEvent && (
            <button
              className="timeline-icon-button"
              type="button"
              onClick={() => setEventEditorOpen(true)}
              aria-label="Add timeline event"
              title="Add event at the current time"
            >
              <Plus size={15} />
            </button>
          )}
        </div>
      </header>

      {comparison && comparison.branchIds.length > 0 && (
        <div className="timeline__comparison" role="status">
          <GitCompareArrows size={14} aria-hidden="true" />
          <span>
            Comparing <strong>{comparison.branchNames?.[activeBranchId] ?? "Baseline"}</strong>
            {comparisonNames.map(({ branchId, name }) => (
              <span className="timeline__comparison-name" key={branchId}>
                {" "}
                + {name}
              </span>
            ))}
          </span>
          {comparison.onExit && (
            <button type="button" onClick={comparison.onExit}>
              Exit compare
            </button>
          )}
        </div>
      )}

      <div className="timeline__scroll" aria-label="Timeline tracks">
        <div className="timeline__track-label timeline__track-label--events">Events</div>
        <div
          className="timeline__tracks"
          ref={trackRef}
          onPointerMove={handleTrackPointerMove}
          onPointerUp={handleTrackPointerUp}
          onPointerCancel={handleTrackPointerCancel}
          onPointerLeave={(event) => {
            if (event.buttons === 0) clearDrag();
          }}
        >
          <div className="timeline__ruler" aria-hidden="true">
            {ticks.map((tick) => (
              <div
                className="timeline__tick"
                key={tick.percent}
                style={{ left: `${String(tick.percent)}%` }}
              >
                <span>{formatTime(tick.timeMs, showsMillisecondScale)}</span>
              </div>
            ))}
          </div>

          <div className="timeline__event-lane">
            {visibleEvents.map((timelineEvent, index) => {
              const target: DragTarget = { kind: "event", eventId: timelineEvent.id };
              const editable = Boolean(onMoveEvent) && !timelineEvent.locked;
              const displayTimeMs = previewTimeFor(target, timelineEvent.timeMs);
              return (
                <button
                  className={`timeline-event timeline-event--${timelineEvent.type} certainty--${timelineEvent.certainty}${selectedId === timelineEvent.id ? " is-selected" : ""}${timelineEvent.branchId !== activeBranchId ? " is-comparison" : ""}${editable ? " is-editable" : ""}`}
                  key={timelineEvent.id}
                  type="button"
                  style={{
                    left: `${String(timeToPercent(displayTimeMs, timeRangeMs))}%`,
                    top: `${String(6 + (index % 3) * 18)}px`,
                  }}
                  title={`${timelineEvent.title}, ${formatTime(displayTimeMs, true)}${editable ? ". Drag or use arrow keys to adjust." : ""}`}
                  aria-label={`${timelineEvent.title} at ${formatTime(displayTimeMs, true)}. ${timelineEvent.certainty}.`}
                  aria-pressed={selectedId === timelineEvent.id}
                  onClick={() => {
                    onSelectEvent?.(timelineEvent.id);
                    onTimeChange(timelineEvent.timeMs);
                  }}
                  onPointerDown={(event) => {
                    if (!editable) return;
                    event.preventDefault();
                    onSelectEvent?.(timelineEvent.id);
                    event.currentTarget.setPointerCapture(event.pointerId);
                    startDrag(target, event.pointerId);
                  }}
                  onKeyDown={(event) => {
                    if (editable) handleHandleKeyDown(event, target, timelineEvent.timeMs);
                  }}
                >
                  <span className="timeline-event__stem" aria-hidden="true" />
                  <span className="timeline-event__dot" aria-hidden="true" />
                  <span className="timeline-event__label">{timelineEvent.title}</span>
                </button>
              );
            })}
          </div>

          {visibleTrajectories.map((trajectory) => (
            <div
              className={`timeline__keyframe-lane${trajectory.branchId !== activeBranchId ? " is-comparison" : ""}`}
              key={trajectory.id}
              aria-label={`${actorName(actors, trajectory.actorId)} path keyframes`}
            >
              <span className="timeline__track-line" aria-hidden="true" />
              {trajectory.keyframes.map((keyframe) => {
                const target: DragTarget = {
                  kind: "keyframe",
                  trajectoryId: trajectory.id,
                  keyframeId: keyframe.id,
                };
                const editable =
                  Boolean(onMoveKeyframe) &&
                  !trajectory.locked &&
                  !actors.find((actor) => actor.id === trajectory.actorId)?.locked;
                const displayTimeMs = previewTimeFor(target, keyframe.timeMs);
                return (
                  <button
                    className={`timeline-keyframe${selectedKeyframeId === keyframe.id ? " is-selected" : ""}${editable ? " is-editable" : ""}`}
                    key={keyframe.id}
                    type="button"
                    style={{
                      left: `${String(timeToPercent(displayTimeMs, timeRangeMs))}%`,
                    }}
                    title={`${actorName(actors, trajectory.actorId)} keyframe at ${formatTime(displayTimeMs, true)}${editable ? ". Drag or use arrow keys to adjust." : ""}`}
                    aria-label={`${actorName(actors, trajectory.actorId)} path keyframe at ${formatTime(displayTimeMs, true)}`}
                    aria-pressed={selectedKeyframeId === keyframe.id}
                    onClick={() => {
                      onSelectKeyframe?.(trajectory.id, keyframe.id);
                      onTimeChange(keyframe.timeMs);
                    }}
                    onPointerDown={(event) => {
                      if (!editable) return;
                      event.preventDefault();
                      onSelectKeyframe?.(trajectory.id, keyframe.id);
                      event.currentTarget.setPointerCapture(event.pointerId);
                      startDrag(target, event.pointerId);
                    }}
                    onKeyDown={(event) => {
                      if (editable) handleHandleKeyDown(event, target, keyframe.timeMs);
                    }}
                  >
                    <span aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          ))}

          <div
            className="timeline__cursor"
            style={{
              left: `calc(12px + (100% - 24px) * ${String(cursorPercent / 100)})`,
            }}
            aria-hidden="true"
          >
            <span />
          </div>

          <input
            className="timeline__scrubber"
            type="range"
            min={timeRangeMs.start}
            max={timeRangeMs.end}
            step={timelineStepMs}
            value={clampTime(currentTimeMs, timeRangeMs)}
            onChange={(event) => onTimeChange(Number(event.target.value))}
            aria-label="Timeline position"
            aria-valuetext={formatTime(currentTimeMs, true)}
          />
        </div>

        <div className="timeline__lane-labels" aria-hidden="true">
          {visibleTrajectories.map((trajectory) => (
            <div
              key={trajectory.id}
              className={trajectory.branchId !== activeBranchId ? "is-comparison" : ""}
            >
              <span
                className={`actor-swatch actor-swatch--${trajectory.actorId.endsWith("b") ? "silver" : "blue"}`}
              />
              <span>{actorName(actors, trajectory.actorId)}</span>
              {trajectory.branchId !== activeBranchId && <small>Alt</small>}
            </div>
          ))}
        </div>
      </div>
      {eventEditorOpen && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setEventEditorOpen(false);
          }}
        >
          <section
            ref={eventDialogRef}
            className="dialog timeline-event-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="timeline-event-title"
            tabIndex={-1}
          >
            <header>
              <div>
                <p>At {formatTime(currentTimeMs, true)}</p>
                <h2 id="timeline-event-title">Add timeline event</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setEventEditorOpen(false)}
                aria-label="Close event editor"
              >
                <X size={18} />
              </button>
            </header>
            <form className="inline-form" onSubmit={submitEvent}>
              <label>
                <span>Event title</span>
                <input
                  ref={eventTitleRef}
                  value={eventTitle}
                  onChange={(event) => setEventTitle(event.target.value)}
                  placeholder="Describe only what is known"
                  required
                />
              </label>
              <div className="inline-form__row">
                <label>
                  <span>Event type</span>
                  <select
                    value={eventType}
                    onChange={(event) => setEventType(event.target.value as typeof eventType)}
                  >
                    <option value="observation">Observation</option>
                    <option value="maneuver">Maneuver</option>
                    <option value="evidence">Evidence recorded</option>
                    <option value="actor-start">Actor starts</option>
                    <option value="actor-stop">Actor stops</option>
                  </select>
                </label>
                <label>
                  <span>Certainty</span>
                  <select
                    value={eventCertainty}
                    onChange={(event) =>
                      setEventCertainty(event.target.value as typeof eventCertainty)
                    }
                  >
                    <option value="reported">Reported</option>
                    <option value="likely">Likely</option>
                    <option value="uncertain">Uncertain</option>
                    <option value="disputed">Disputed</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </label>
              </div>
              <label>
                <span>Linked actor</span>
                <select
                  value={eventActorId}
                  onChange={(event) => setEventActorId(event.target.value)}
                >
                  <option value="all">All vehicles</option>
                  {actors.map((actor) => (
                    <option key={actor.id} value={actor.id}>
                      {actor.label}
                    </option>
                  ))}
                </select>
              </label>
              <footer>
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => setEventEditorOpen(false)}
                >
                  Cancel
                </button>
                <button className="button button--primary">
                  Add at {formatTime(currentTimeMs, true)}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
