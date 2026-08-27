import {
  CircleAlert,
  Crosshair,
  Focus,
  Grid3X3,
  LockKeyhole,
  Minus,
  Move,
  Plus,
  Route,
  Unlock,
  X,
} from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import type {
  ActorPose,
  DamageRegion,
  DamageMarker,
  ReplayCase,
  SceneActor,
  TimelineEvent,
  Trajectory,
} from "../domain/models";

interface SceneCanvasProps {
  replayCase: ReplayCase;
  currentTimeMs: number;
  selectedId?: string;
  comparisonBranchIds?: string[];
  activeAgentIds?: string[];
  onSelect: (type: "actor" | "trajectory" | "timeline-event", id: string) => void;
  onMoveActor: (actorId: string, pose: ActorPose) => void;
  onMoveKeyframe: (trajectoryId: string, keyframeId: string, x: number, y: number) => void;
  onCreateTrajectory: (actorId: string) => void;
  onMarkDamage: (actorId: string, region: DamageRegion, description: string) => void;
  onMarkImpact: (location: { x: number; y: number }) => void;
  onToggleActorLock: (actorId: string) => void;
  onToggleTrajectoryLock: (trajectoryId: string) => void;
  onToggleEventLock: (eventId: string) => void;
}

interface DragState {
  kind: "actor" | "keyframe" | "pan";
  id: string;
  moved?: boolean;
  trajectoryId?: string;
  previewPose?: ActorPose;
  previewX?: number;
  previewY?: number;
  offsetX?: number;
  offsetY?: number;
  startClientX?: number;
  startClientY?: number;
  startPanX?: number;
  startPanY?: number;
}

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 700;

function toView(x: number, y: number) {
  return { x: x * 10, y: y * 7 };
}

function toNormalized(x: number, y: number) {
  return { x: Math.max(0, Math.min(100, x / 10)), y: Math.max(0, Math.min(100, y / 7)) };
}

function poseAtTime(
  trajectory: Trajectory | undefined,
  fallback: ActorPose,
  timeMs: number,
): ActorPose {
  if (!trajectory?.keyframes.length) return fallback;
  const frames = [...trajectory.keyframes].sort((a, b) => a.timeMs - b.timeMs);
  const first = frames[0];
  const last = frames.at(-1);
  if (!first || !last) return fallback;
  if (timeMs <= first.timeMs) return first;
  if (timeMs >= last.timeMs) return last;
  const nextIndex = frames.findIndex((frame) => frame.timeMs >= timeMs);
  const next = frames[nextIndex];
  const previous = frames[nextIndex - 1];
  if (!next || !previous) return fallback;
  const amount = (timeMs - previous.timeMs) / (next.timeMs - previous.timeMs || 1);
  const rotationDelta = ((next.rotationDeg - previous.rotationDeg + 540) % 360) - 180;
  return {
    x: previous.x + (next.x - previous.x) * amount,
    y: previous.y + (next.y - previous.y) * amount,
    rotationDeg: previous.rotationDeg + rotationDelta * amount,
  };
}

function snapToRoundabout(x: number, y: number) {
  const dx = x - 50;
  const dy = y - 50;
  const distance = Math.hypot(dx, dy) || 1;
  const radius = distance < 28 ? 23 : 31;
  return { x: 50 + (dx / distance) * radius, y: 50 + (dy / distance) * radius };
}

export function SceneCanvas({
  replayCase,
  currentTimeMs,
  selectedId,
  comparisonBranchIds = [],
  activeAgentIds = [],
  onSelect,
  onMoveActor,
  onMoveKeyframe,
  onCreateTrajectory,
  onMarkDamage,
  onMarkImpact,
  onToggleActorLock,
  onToggleTrajectoryLock,
  onToggleEventLock,
}: SceneCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragState>();
  const dragRef = useRef<DragState | undefined>(undefined);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [snapToLane, setSnapToLane] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [showPaths, setShowPaths] = useState(true);
  const [placingImpact, setPlacingImpact] = useState(false);
  const [damageEditorOpen, setDamageEditorOpen] = useState(false);
  const [damageRegion, setDamageRegion] = useState<DamageRegion>("unknown");
  const [damageDescription, setDamageDescription] = useState("");

  const displayedBranchIds = comparisonBranchIds.length
    ? new Set([replayCase.activeBranchId, ...comparisonBranchIds])
    : new Set([replayCase.activeBranchId]);
  const displayedTrajectories = replayCase.trajectories.filter(
    (trajectory) => displayedBranchIds.has(trajectory.branchId) && trajectory.visible,
  );
  const pendingProposalChanges = replayCase.proposals
    .filter((proposal) => proposal.status === "pending")
    .flatMap((proposal) => proposal.revisions.at(-1)?.changes ?? []);

  const actorPoses = useMemo(() => {
    return Object.fromEntries(
      replayCase.actors.map((actor) => {
        if (drag?.kind === "actor" && drag.id === actor.id && drag.previewPose) {
          return [actor.id, drag.previewPose];
        }
        const trajectory = replayCase.trajectories.find(
          (item) => item.actorId === actor.id && item.branchId === replayCase.activeBranchId,
        );
        return [actor.id, poseAtTime(trajectory, actor.pose, currentTimeMs)];
      }),
    ) as Record<string, ActorPose>;
  }, [currentTimeMs, drag, replayCase.activeBranchId, replayCase.actors, replayCase.trajectories]);

  const impact = replayCase.timelineEvents.find(
    (event) => event.branchId === replayCase.activeBranchId && event.type === "impact",
  );
  const selectedActor = replayCase.actors.find((actor) => actor.id === selectedId);
  const selectedTrajectory = replayCase.trajectories.find(
    (trajectory) => trajectory.id === selectedId,
  );
  const selectedEvent = replayCase.timelineEvents.find((event) => event.id === selectedId);

  function clientToSvg(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const matrix = svg.getScreenCTM()?.inverse();
    if (!matrix) return { x: 0, y: 0 };
    return point.matrixTransform(matrix);
  }

  function updateDrag(next: DragState | undefined): void {
    dragRef.current = next;
    setDrag(next);
  }

  function startActorDrag(event: React.PointerEvent, actor: SceneActor) {
    if (actor.locked) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointer = clientToSvg(event.clientX, event.clientY);
    const pose = actorPoses[actor.id] ?? actor.pose;
    const position = toView(pose.x, pose.y);
    updateDrag({
      kind: "actor",
      id: actor.id,
      offsetX: pointer.x - position.x,
      offsetY: pointer.y - position.y,
      previewPose: pose,
    });
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const activeDrag = dragRef.current;
    if (!activeDrag) return;
    if (activeDrag.kind === "pan") {
      const factor = 1 / zoom;
      setPan({
        x: (activeDrag.startPanX ?? 0) + (event.clientX - (activeDrag.startClientX ?? 0)) * factor,
        y: (activeDrag.startPanY ?? 0) + (event.clientY - (activeDrag.startClientY ?? 0)) * factor,
      });
      return;
    }
    const pointer = clientToSvg(event.clientX, event.clientY);
    const normalized = toNormalized(
      pointer.x - (activeDrag.offsetX ?? 0),
      pointer.y - (activeDrag.offsetY ?? 0),
    );
    const position =
      snapToLane && replayCase.environment.sceneType === "roundabout"
        ? snapToRoundabout(normalized.x, normalized.y)
        : normalized;
    if (activeDrag.kind === "actor") {
      const actor = replayCase.actors.find((item) => item.id === activeDrag.id);
      if (!actor) return;
      const pose = actorPoses[actor.id] ?? actor.pose;
      updateDrag({
        ...activeDrag,
        moved: true,
        previewPose: { ...position, rotationDeg: pose.rotationDeg },
      });
    } else if (activeDrag.trajectoryId) {
      updateDrag({
        ...activeDrag,
        moved: true,
        previewX: position.x,
        previewY: position.y,
      });
    }
  }

  function commitDrag() {
    const completedDrag = dragRef.current;
    updateDrag(undefined);
    if (completedDrag?.kind === "actor" && completedDrag.moved && completedDrag.previewPose) {
      onMoveActor(completedDrag.id, completedDrag.previewPose);
    } else if (
      completedDrag?.kind === "keyframe" &&
      completedDrag.moved &&
      completedDrag.trajectoryId &&
      completedDrag.previewX !== undefined &&
      completedDrag.previewY !== undefined
    ) {
      onMoveKeyframe(
        completedDrag.trajectoryId,
        completedDrag.id,
        completedDrag.previewX,
        completedDrag.previewY,
      );
    }
  }

  function moveActorWithKeyboard(event: React.KeyboardEvent, actor: SceneActor) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect("actor", actor.id);
      return;
    }
    const step = event.shiftKey ? 2 : 0.5;
    const pose = actorPoses[actor.id] ?? actor.pose;
    let next = { ...pose };
    if (event.key === "ArrowLeft") next.x -= step;
    else if (event.key === "ArrowRight") next.x += step;
    else if (event.key === "ArrowUp") next.y -= step;
    else if (event.key === "ArrowDown") next.y += step;
    else if (event.key === "[" || event.key === ",") next.rotationDeg -= event.shiftKey ? 15 : 3;
    else if (event.key === "]" || event.key === ".") next.rotationDeg += event.shiftKey ? 15 : 3;
    else return;
    event.preventDefault();
    if (actor.locked) return;
    next.x = Math.max(0, Math.min(100, next.x));
    next.y = Math.max(0, Math.min(100, next.y));
    if (
      snapToLane &&
      replayCase.environment.sceneType === "roundabout" &&
      event.key.startsWith("Arrow")
    ) {
      next = { ...next, ...snapToRoundabout(next.x, next.y) };
    }
    onMoveActor(actor.id, next);
  }

  function placeImpactByCoordinates(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const x = Number(data.get("impact-x"));
    const y = Number(data.get("impact-y"));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    onMarkImpact({
      x: Math.max(0, Math.min(100, x)),
      y: Math.max(0, Math.min(100, y)),
    });
    setPlacingImpact(false);
  }

  const viewBox = `${-pan.x + (VIEW_WIDTH - VIEW_WIDTH / zoom) / 2} ${-pan.y + (VIEW_HEIGHT - VIEW_HEIGHT / zoom) / 2} ${VIEW_WIDTH / zoom} ${VIEW_HEIGHT / zoom}`;

  return (
    <section className="scene-panel" aria-label="Incident scene editor">
      <div className="scene-toolbar">
        <div className="scene-toolbar__group">
          <button
            className={`tool-button ${showPaths ? "is-active" : ""}`}
            onClick={() => setShowPaths((value) => !value)}
            aria-pressed={showPaths}
            title="Show trajectories"
          >
            <Route size={15} /> <span>Paths</span>
          </button>
          <button
            className={`tool-button ${snapToLane ? "is-active" : ""}`}
            onClick={() => setSnapToLane((value) => !value)}
            aria-pressed={snapToLane}
            title="Snap vehicle movement to lane"
          >
            <Crosshair size={15} /> <span>Lane snap</span>
          </button>
          <button
            className={`tool-button ${placingImpact ? "is-active" : ""}`}
            onClick={() => setPlacingImpact((value) => !value)}
            aria-pressed={placingImpact}
            title="Place the approximate impact on the scene"
          >
            <CircleAlert size={15} /> <span>Mark impact</span>
          </button>
          <button
            className={`tool-button ${showGrid ? "is-active" : ""}`}
            onClick={() => setShowGrid((value) => !value)}
            aria-pressed={showGrid}
            title="Show placement grid"
          >
            <Grid3X3 size={15} />
          </button>
        </div>
        <div className="scene-toolbar__label">
          <span>
            {replayCase.environment.sceneType === "roundabout"
              ? "European roundabout"
              : "Four-way intersection"}
          </span>
          <small>
            {replayCase.environment.roadCondition} surface · {(currentTimeMs / 1000).toFixed(1)}s
          </small>
        </div>
        <div className="scene-toolbar__group">
          <button
            className="tool-button tool-button--icon"
            onClick={() => setZoom((value) => Math.max(0.7, value - 0.15))}
            title="Zoom out"
          >
            <Minus size={15} />
          </button>
          <span className="zoom-value">{Math.round(zoom * 100)}%</span>
          <button
            className="tool-button tool-button--icon"
            onClick={() => setZoom((value) => Math.min(2.2, value + 0.15))}
            title="Zoom in"
          >
            <Plus size={15} />
          </button>
          <button
            className="tool-button tool-button--icon"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            title="Fit scene"
          >
            <Focus size={15} />
          </button>
        </div>
      </div>

      <div
        className={`scene-stage${replayCase.environment.roadCondition === "wet" ? " is-wet" : ""}`}
      >
        <svg
          ref={svgRef}
          className="scene-svg"
          viewBox={viewBox}
          role="application"
          aria-label="Editable road scene. Use Tab to select a vehicle, arrow keys to move it, and bracket keys to rotate it."
          onPointerMove={onPointerMove}
          onPointerUp={commitDrag}
          onPointerCancel={() => updateDrag(undefined)}
          onPointerDown={(event) => {
            if (placingImpact) return;
            if (
              event.target === event.currentTarget ||
              (event.target as Element).classList.contains("scene-pan-target")
            ) {
              updateDrag({
                kind: "pan",
                id: "canvas",
                startClientX: event.clientX,
                startClientY: event.clientY,
                startPanX: pan.x,
                startPanY: pan.y,
              });
            }
          }}
          onClick={(event) => {
            if (!placingImpact) return;
            const point = clientToSvg(event.clientX, event.clientY);
            onMarkImpact(toNormalized(point.x, point.y));
            setPlacingImpact(false);
          }}
        >
          <defs>
            <pattern id="placement-grid" width="35" height="35" patternUnits="userSpaceOnUse">
              <path
                d="M 35 0 L 0 0 0 35"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.65"
                opacity="0.25"
              />
            </pattern>
            <pattern id="wet-texture" width="24" height="24" patternUnits="userSpaceOnUse">
              <path
                d="M2 5h7M12 17h9"
                stroke="oklch(0.78 0.018 210)"
                strokeWidth="0.8"
                opacity="0.2"
              />
            </pattern>
            <filter id="vehicle-shadow" x="-40%" y="-40%" width="180%" height="180%">
              <feDropShadow
                dx="0"
                dy="4"
                stdDeviation="4"
                floodColor="oklch(0.18 0.02 210)"
                floodOpacity="0.24"
              />
            </filter>
            <filter id="agent-pulse" x="-80%" y="-80%" width="260%" height="260%">
              <feDropShadow
                dx="0"
                dy="0"
                stdDeviation="8"
                floodColor="oklch(0.57 0.105 275)"
                floodOpacity="0.75"
              />
            </filter>
          </defs>

          <rect
            className="scene-pan-target scene-ground"
            width={VIEW_WIDTH}
            height={VIEW_HEIGHT}
            rx="10"
          />
          {replayCase.environment.sceneType === "roundabout" ? (
            <RoundaboutTemplate />
          ) : (
            <IntersectionTemplate />
          )}
          {replayCase.environment.roadCondition === "wet" && (
            <rect
              className="scene-pan-target"
              width={VIEW_WIDTH}
              height={VIEW_HEIGHT}
              fill="url(#wet-texture)"
              pointerEvents="none"
            />
          )}
          {showGrid && (
            <rect
              width={VIEW_WIDTH}
              height={VIEW_HEIGHT}
              fill="url(#placement-grid)"
              className="placement-grid"
            />
          )}

          {pendingProposalChanges.map((change) => {
            const actor = replayCase.actors.find((candidate) => candidate.id === change.actorId);
            if (change.kind === "actor-pose") {
              const point = toView(change.proposedPose.x, change.proposedPose.y);
              return (
                <g
                  key={change.id}
                  className="proposal-scene-actor"
                  transform={`translate(${point.x} ${point.y}) rotate(${change.proposedPose.rotationDeg})`}
                  aria-hidden="true"
                >
                  <rect x="-23" y="-48" width="46" height="96" rx="16" />
                  <path d="M-15-22Q0-33 15-22L14 14Q0 23-14 14Z" />
                  <text
                    x="0"
                    y="66"
                    textAnchor="middle"
                    transform={`rotate(${-change.proposedPose.rotationDeg} 0 66)`}
                  >
                    Proposed {actor?.label ?? "vehicle"}
                  </text>
                </g>
              );
            }
            const path = change.proposedTrajectory.keyframes
              .map((frame, index) => {
                const point = toView(frame.x, frame.y);
                return `${index === 0 ? "M" : "L"}${point.x},${point.y}`;
              })
              .join(" ");
            return (
              <g key={change.id} className="proposal-scene-path" aria-hidden="true">
                <path d={path} />
                {change.proposedTrajectory.keyframes.map((frame) => {
                  const point = toView(frame.x, frame.y);
                  return <circle key={frame.id} cx={point.x} cy={point.y} r="5" />;
                })}
              </g>
            );
          })}

          {showPaths &&
            displayedTrajectories.map((trajectory) => {
              const branchIndex = Math.max(
                0,
                replayCase.branches.findIndex((branch) => branch.id === trajectory.branchId),
              );
              const points = trajectory.keyframes.map((frame) =>
                toView(
                  drag?.kind === "keyframe" &&
                    drag.trajectoryId === trajectory.id &&
                    drag.id === frame.id &&
                    drag.previewX !== undefined
                    ? drag.previewX
                    : frame.x,
                  drag?.kind === "keyframe" &&
                    drag.trajectoryId === trajectory.id &&
                    drag.id === frame.id &&
                    drag.previewY !== undefined
                    ? drag.previewY
                    : frame.y,
                ),
              );
              const path = points
                .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
                .join(" ");
              const selected = selectedId === trajectory.id;
              const active = trajectory.branchId === replayCase.activeBranchId;
              return (
                <g
                  key={trajectory.id}
                  className={`trajectory trajectory--branch-${branchIndex % 3}${selected ? " is-selected" : ""}${active ? " is-active" : " is-overlay"}`}
                >
                  <path
                    className="trajectory__hit"
                    d={path}
                    tabIndex={0}
                    role="button"
                    aria-label={`Select path for ${replayCase.actors.find((actor) => actor.id === trajectory.actorId)?.label ?? "vehicle"}`}
                    aria-pressed={selected}
                    onClick={() => onSelect("trajectory", trajectory.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect("trajectory", trajectory.id);
                      }
                    }}
                  />
                  <path className="trajectory__line" d={path} />
                  {selected &&
                    trajectory.keyframes.map((frame, index) => {
                      const point = points[index] ?? toView(frame.x, frame.y);
                      return (
                        <g key={frame.id} transform={`translate(${point.x} ${point.y})`}>
                          <circle
                            className="trajectory__handle"
                            r="7"
                            tabIndex={0}
                            role="button"
                            aria-label={`Path point ${index + 1} for ${replayCase.actors.find((actor) => actor.id === trajectory.actorId)?.label ?? "vehicle"} at ${(frame.timeMs / 1000).toFixed(1)} seconds`}
                            onPointerDown={(event) => {
                              if (trajectory.locked) return;
                              event.stopPropagation();
                              event.currentTarget.setPointerCapture(event.pointerId);
                              updateDrag({
                                kind: "keyframe",
                                id: frame.id,
                                trajectoryId: trajectory.id,
                                previewX: frame.x,
                                previewY: frame.y,
                              });
                            }}
                            onKeyDown={(event) => {
                              const step = event.shiftKey ? 2 : 0.5;
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                onSelect("trajectory", trajectory.id);
                                return;
                              }
                              let x = frame.x;
                              let y = frame.y;
                              if (event.key === "ArrowLeft") x -= step;
                              else if (event.key === "ArrowRight") x += step;
                              else if (event.key === "ArrowUp") y -= step;
                              else if (event.key === "ArrowDown") y += step;
                              else return;
                              event.preventDefault();
                              if (!trajectory.locked)
                                onMoveKeyframe(
                                  trajectory.id,
                                  frame.id,
                                  Math.max(0, Math.min(100, x)),
                                  Math.max(0, Math.min(100, y)),
                                );
                            }}
                          />
                          {index === 0 && (
                            <text className="path-marker-label" x="11" y="4">
                              START
                            </text>
                          )}
                          {index === trajectory.keyframes.length - 1 && (
                            <text className="path-marker-label" x="11" y="4">
                              FINAL
                            </text>
                          )}
                        </g>
                      );
                    })}
                  {trajectory.locked && points[1] && <LockGlyph x={points[1].x} y={points[1].y} />}
                </g>
              );
            })}

          {impact?.location && (
            <ImpactMarker
              event={impact}
              selected={selectedId === impact.id}
              onSelect={() => onSelect("timeline-event", impact.id)}
            />
          )}

          {replayCase.actors.map((actor) => {
            const pose = actorPoses[actor.id] ?? actor.pose;
            const point = toView(pose.x, pose.y);
            return (
              <Vehicle
                key={actor.id}
                actor={actor}
                x={point.x}
                y={point.y}
                rotation={pose.rotationDeg}
                selected={selectedId === actor.id}
                agentActive={activeAgentIds.includes(actor.id)}
                onPointerDown={(event) => startActorDrag(event, actor)}
                onClick={() => onSelect("actor", actor.id)}
                onKeyDown={(event) => moveActorWithKeyboard(event, actor)}
              />
            );
          })}
        </svg>

        <div className="scene-legend" aria-label="Scene legend">
          <span>
            <i className="legend-line legend-line--solid" /> Current branch
          </span>
          {comparisonBranchIds.length > 0 && (
            <span>
              <i className="legend-line legend-line--dashed" /> Compared branch
            </span>
          )}
          {pendingProposalChanges.length > 0 && (
            <span>
              <i className="legend-line legend-line--proposal" /> Agent proposal
            </span>
          )}
          <span>
            <i className="legend-dot legend-dot--impact" /> Approx. impact
          </span>
        </div>
        <div className="scene-hint">
          <Move size={13} /> Drag background to pan. Select a vehicle for precise controls.
        </div>
        {placingImpact && (
          <div className="scene-placement-prompt">
            <p role="status">
              <Crosshair size={14} /> Click the scene or enter exact coordinates. The marker remains
              uncertain until evidence supports it.
            </p>
            <form
              aria-label="Place approximate impact by coordinates"
              onSubmit={placeImpactByCoordinates}
            >
              <label>
                <span>X</span>
                <input
                  name="impact-x"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  defaultValue={impact?.location?.x ?? 50}
                  required
                />
              </label>
              <label>
                <span>Y</span>
                <input
                  name="impact-y"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  defaultValue={impact?.location?.y ?? 50}
                  required
                />
              </label>
              <button className="button button--primary">Place</button>
              <button type="button" className="text-button" onClick={() => setPlacingImpact(false)}>
                Cancel
              </button>
            </form>
          </div>
        )}
      </div>

      {Boolean(selectedActor ?? selectedTrajectory ?? selectedEvent) && (
        <div className="scene-quick-actions">
          {selectedActor && (
            <>
              <button className="tool-button" onClick={() => onCreateTrajectory(selectedActor.id)}>
                <Route size={14} />
                {replayCase.trajectories.some(
                  (trajectory) =>
                    trajectory.actorId === selectedActor.id &&
                    trajectory.branchId === replayCase.activeBranchId,
                )
                  ? "Edit path"
                  : "Create path"}
              </button>
              <button className="tool-button" onClick={() => setDamageEditorOpen(true)}>
                <CircleAlert size={14} /> Mark damage
              </button>
              <button className="tool-button" onClick={() => onToggleActorLock(selectedActor.id)}>
                {selectedActor.locked ? <Unlock size={14} /> : <LockKeyhole size={14} />}
                {selectedActor.locked ? "Unlock object" : "Lock object"}
              </button>
              <span>Arrow keys move · [ ] rotate · Shift for larger steps</span>
            </>
          )}
          {selectedTrajectory && (
            <>
              <button
                className="tool-button"
                onClick={() => onToggleTrajectoryLock(selectedTrajectory.id)}
              >
                {selectedTrajectory.locked ? <Unlock size={14} /> : <LockKeyhole size={14} />}
                {selectedTrajectory.locked ? "Unlock path" : "Lock path"}
              </button>
              <span>
                {selectedTrajectory.keyframes.length} editable path points · Arrow keys adjust a
                selected point
              </span>
            </>
          )}
          {selectedEvent && (
            <>
              <button className="tool-button" onClick={() => onToggleEventLock(selectedEvent.id)}>
                {selectedEvent.locked ? <Unlock size={14} /> : <LockKeyhole size={14} />}
                {selectedEvent.locked ? "Unlock event" : "Lock event"}
              </button>
              <span>
                {selectedEvent.title} · {(selectedEvent.timeMs / 1000).toFixed(1)}s ·{" "}
                {selectedEvent.certainty}
              </span>
            </>
          )}
        </div>
      )}

      {damageEditorOpen && selectedActor && (
        <form
          className="scene-popover"
          onSubmit={(event) => {
            event.preventDefault();
            if (!damageDescription.trim()) return;
            onMarkDamage(selectedActor.id, damageRegion, damageDescription.trim());
            setDamageDescription("");
            setDamageEditorOpen(false);
          }}
        >
          <header>
            <div>
              <small>Vehicle observation</small>
              <strong>Mark damage on {selectedActor.label}</strong>
            </div>
            <button
              type="button"
              onClick={() => setDamageEditorOpen(false)}
              aria-label="Close damage editor"
            >
              <X size={15} />
            </button>
          </header>
          <label>
            <span>Body region</span>
            <select
              value={damageRegion}
              onChange={(event) => setDamageRegion(event.target.value as DamageRegion)}
            >
              <option value="front">Front</option>
              <option value="front-left">Front left</option>
              <option value="front-right">Front right</option>
              <option value="left-side">Left side</option>
              <option value="right-side">Right side</option>
              <option value="rear-left">Rear left</option>
              <option value="rear-right">Rear right</option>
              <option value="rear">Rear</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <label>
            <span>Neutral description</span>
            <input
              value={damageDescription}
              onChange={(event) => setDamageDescription(event.target.value)}
              placeholder="e.g. light scraping at wheel arch"
              required
              autoFocus
            />
          </label>
          <footer>
            <span>Recorded as reported, not confirmed.</span>
            <button className="button button--primary">Add marker</button>
          </footer>
        </form>
      )}
    </section>
  );
}

function RoundaboutTemplate() {
  return (
    <g className="road-template" aria-hidden="true">
      <rect x="0" y="260" width="1000" height="180" className="road-surface" />
      <rect x="410" y="0" width="180" height="700" className="road-surface" />
      <circle cx="500" cy="350" r="205" className="road-surface" />
      <circle cx="500" cy="350" r="114" className="roundabout-island" />
      <circle cx="500" cy="350" r="154" className="lane-boundary" />
      <circle cx="500" cy="350" r="199" className="road-edge" />
      <circle cx="500" cy="350" r="111" className="road-edge" />
      <path className="lane-boundary" d="M0 350h292M708 350h292M500 0v143M500 557v143" />
      <path
        className="direction-arrow"
        d="M188 325l28 25-28 25M812 375l-28-25 28-25M475 95l25 28 25-28M525 605l-25-28-25 28"
      />
      <path
        className="direction-arrow"
        d="M376 190c-40 29-62 61-70 102l-12-19m12 19 18-13M624 510c40-29 62-61 70-102l12 19m-12-19-18 13"
      />
      <circle cx="500" cy="350" r="82" className="island-green" />
      <circle cx="475" cy="330" r="9" className="island-shrub" />
      <circle cx="528" cy="370" r="13" className="island-shrub" />
      <circle cx="520" cy="315" r="7" className="island-shrub" />
    </g>
  );
}

function IntersectionTemplate() {
  return (
    <g className="road-template" aria-hidden="true">
      <rect x="0" y="245" width="1000" height="210" className="road-surface" />
      <rect x="395" y="0" width="210" height="700" className="road-surface" />
      <path className="lane-boundary" d="M0 350h395M605 350h395M500 0v245M500 455v245" />
      <path className="stop-line" d="M355 245v210M645 245v210M395 205h210M395 495h210" />
      <path
        className="direction-arrow"
        d="M185 325l28 25-28 25M815 375l-28-25 28-25M475 105l25 28 25-28M525 595l-25-28-25 28"
      />
      {[0, 1, 2, 3, 4].map((index) => (
        <rect
          key={`north-${index}`}
          x={405 + index * 38}
          y="218"
          width="22"
          height="48"
          className="crosswalk"
        />
      ))}
      {[0, 1, 2, 3, 4].map((index) => (
        <rect
          key={`south-${index}`}
          x={405 + index * 38}
          y="434"
          width="22"
          height="48"
          className="crosswalk"
        />
      ))}
    </g>
  );
}

interface VehicleProps {
  actor: SceneActor;
  x: number;
  y: number;
  rotation: number;
  selected: boolean;
  agentActive: boolean;
  onPointerDown: (event: React.PointerEvent<SVGGElement>) => void;
  onClick: () => void;
  onKeyDown: (event: React.KeyboardEvent<SVGGElement>) => void;
}

function Vehicle({
  actor,
  x,
  y,
  rotation,
  selected,
  agentActive,
  onPointerDown,
  onClick,
  onKeyDown,
}: VehicleProps) {
  const blue = actor.colorToken.includes("blue");
  const damage = actor.damageMarkers;
  return (
    <g
      className={`scene-vehicle${selected ? " is-selected" : ""}${actor.locked ? " is-locked" : ""}${agentActive ? " is-agent-active" : ""}`}
      transform={`translate(${x} ${y}) rotate(${rotation})`}
      tabIndex={0}
      role="button"
      aria-label={`${actor.label}, position ${(x / 10).toFixed(1)}, ${(y / 7).toFixed(1)}, orientation ${Math.round(rotation)} degrees${actor.locked ? ", locked" : ""}. Use arrow keys to move and bracket keys to rotate.`}
      aria-pressed={selected}
      onPointerDown={onPointerDown}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onKeyDown={onKeyDown}
    >
      <rect className="vehicle-selection" x="-25" y="-50" width="50" height="100" rx="18" />
      <g filter="url(#vehicle-shadow)">
        <rect
          className={blue ? "vehicle-body vehicle-body--blue" : "vehicle-body vehicle-body--silver"}
          x="-20"
          y="-43"
          width="40"
          height="86"
          rx="14"
        />
        <path className="vehicle-window" d="M-15-21Q0-31 15-21L14 13Q0 22-14 13Z" />
        <path className="vehicle-divider" d="M-14-1h28" />
        <path className="vehicle-front" d="M-12-36Q0-43 12-36" />
        <rect className="vehicle-light" x="-14" y="-38" width="7" height="3" rx="1" />
        <rect className="vehicle-light" x="7" y="-38" width="7" height="3" rx="1" />
        <rect className="vehicle-tail" x="-14" y="35" width="7" height="3" rx="1" />
        <rect className="vehicle-tail" x="7" y="35" width="7" height="3" rx="1" />
      </g>
      <text
        className="vehicle-label"
        x="0"
        y="66"
        textAnchor="middle"
        transform={`rotate(${-rotation} 0 66)`}
      >
        {actor.label}
      </text>
      {damage.map((marker) => (
        <DamageGlyph key={marker.id} marker={marker} />
      ))}
      {actor.locked && <LockGlyph x={23} y={-49} />}
    </g>
  );
}

function DamageGlyph({ marker }: { marker: DamageMarker }) {
  const positionByRegion: Record<DamageMarker["region"], [number, number]> = {
    front: [0, -43],
    "front-left": [-18, -36],
    "front-right": [18, -36],
    "left-side": [-21, 0],
    "right-side": [21, 0],
    "rear-left": [-18, 36],
    "rear-right": [18, 36],
    rear: [0, 43],
    unknown: [0, 0],
  };
  const [x, y] = positionByRegion[marker.region];
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle className="damage-glyph" r="6" />
      <path d="m-2-1 3-2-1 3 3 1-3 1 1 3-3-2-2 2 1-3-3-1 3-1Z" className="damage-glyph__mark" />
    </g>
  );
}

function ImpactMarker({
  event,
  selected,
  onSelect,
}: {
  event: TimelineEvent;
  selected: boolean;
  onSelect: () => void;
}) {
  if (!event.location) return null;
  const point = toView(event.location.x, event.location.y);
  return (
    <g
      className={`impact-marker certainty--${event.certainty}${selected ? " is-selected" : ""}`}
      transform={`translate(${point.x} ${point.y})`}
      tabIndex={0}
      role="button"
      aria-label={`Approximate impact at ${(event.timeMs / 1000).toFixed(1)} seconds, ${event.certainty}`}
      onClick={onSelect}
      onKeyDown={(keyboardEvent) => {
        if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
          keyboardEvent.preventDefault();
          onSelect();
        }
      }}
    >
      <circle r="22" />
      <circle r="9" />
      <path d="M-28 0h56M0-28v56" />
      <text x="30" y="-13">
        Approximate impact
      </text>
    </g>
  );
}

function LockGlyph({ x, y }: { x: number; y: number }) {
  return (
    <g className="lock-glyph" transform={`translate(${x} ${y})`}>
      <circle r="9" />
      <path d="M-3-1v-2a3 3 0 0 1 6 0v2M-4-1h8v6h-8z" />
    </g>
  );
}
