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
import { interpolateTrajectory } from "../domain/interpolation";
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
  selectedKeyframeId?: string;
  comparisonBranchIds?: string[];
  activeAgentIds?: string[];
  onSelect: (type: "actor" | "trajectory" | "timeline-event", id: string) => void;
  onSelectKeyframe: (trajectoryId: string, keyframeId: string) => void;
  onEditStart: () => void;
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
  kind: "actor" | "rotation" | "keyframe" | "pan";
  id: string;
  pointerId: number;
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

function formatSceneSeconds(timeMs: number): string {
  const normalizedTimeMs = Math.round(timeMs);
  return (normalizedTimeMs / 1000).toFixed(normalizedTimeMs % 100 === 0 ? 1 : 3);
}

/** Projects onto the lane centers actually drawn by RoundaboutTemplate. */
function snapToRoundaboutLane(x: number, y: number) {
  const captureDistance = 28;
  const point = toView(x, y);
  const dx = point.x - VIEW_WIDTH / 2;
  const dy = point.y - VIEW_HEIGHT / 2;
  const distance = Math.hypot(dx, dy) || 1;
  const circularCandidates: Array<{ x: number; y: number; distance: number }> = [];

  if (Math.abs(dx) >= 180 && Math.abs(dy) <= 100) {
    const approachCandidates = [-45, 45].map((laneOffset) => ({
      x: point.x,
      y: VIEW_HEIGHT / 2 + laneOffset,
      distance: Math.abs(point.y - (VIEW_HEIGHT / 2 + laneOffset)),
    }));
    const closest = approachCandidates.sort((left, right) => left.distance - right.distance)[0];
    if (closest && closest.distance <= captureDistance) return toNormalized(closest.x, closest.y);
  }

  if (Math.abs(dy) >= 130 && Math.abs(dx) <= 110) {
    const approachCandidates = [-45, 45].map((laneOffset) => ({
      x: VIEW_WIDTH / 2 + laneOffset,
      y: point.y,
      distance: Math.abs(point.x - (VIEW_WIDTH / 2 + laneOffset)),
    }));
    const closest = approachCandidates.sort((left, right) => left.distance - right.distance)[0];
    if (closest && closest.distance <= captureDistance) return toNormalized(closest.x, closest.y);
  }

  for (const radius of [134, 180]) {
    const offset = Math.abs(distance - radius);
    if (offset <= captureDistance) {
      circularCandidates.push({
        x: VIEW_WIDTH / 2 + (dx / distance) * radius,
        y: VIEW_HEIGHT / 2 + (dy / distance) * radius,
        distance: offset,
      });
    }
  }

  const closest = circularCandidates.sort((left, right) => left.distance - right.distance)[0];
  return closest ? toNormalized(closest.x, closest.y) : { x, y };
}

export function SceneCanvas({
  replayCase,
  currentTimeMs,
  selectedId,
  selectedKeyframeId,
  comparisonBranchIds = [],
  activeAgentIds = [],
  onSelect,
  onSelectKeyframe,
  onEditStart,
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
  const suppressSceneClickRef = useRef(false);
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
        if (
          (drag?.kind === "actor" || drag?.kind === "rotation") &&
          drag.id === actor.id &&
          drag.previewPose
        ) {
          return [actor.id, drag.previewPose];
        }
        const trajectory = replayCase.trajectories.find(
          (item) => item.actorId === actor.id && item.branchId === replayCase.activeBranchId,
        );
        return [
          actor.id,
          trajectory?.keyframes.length
            ? interpolateTrajectory(trajectory, currentTimeMs)
            : actor.pose,
        ];
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

  function isActorEditLocked(actor: SceneActor): boolean {
    const activeTrajectory = replayCase.trajectories.find(
      (trajectory) =>
        trajectory.actorId === actor.id && trajectory.branchId === replayCase.activeBranchId,
    );
    return actor.locked || Boolean(activeTrajectory?.locked);
  }

  function isTrajectoryEditLocked(trajectory: Trajectory): boolean {
    const actor = replayCase.actors.find((item) => item.id === trajectory.actorId);
    return trajectory.locked || Boolean(actor?.locked);
  }

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

  function startActorDrag(event: React.PointerEvent<SVGElement>, actor: SceneActor) {
    if (dragRef.current || isActorEditLocked(actor)) return;
    onEditStart();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointer = clientToSvg(event.clientX, event.clientY);
    const pose = actorPoses[actor.id] ?? actor.pose;
    const position = toView(pose.x, pose.y);
    updateDrag({
      kind: "actor",
      id: actor.id,
      pointerId: event.pointerId,
      offsetX: pointer.x - position.x,
      offsetY: pointer.y - position.y,
      previewPose: pose,
    });
  }

  function startRotationDrag(event: React.PointerEvent<SVGCircleElement>, actor: SceneActor) {
    if (dragRef.current || isActorEditLocked(actor)) return;
    onEditStart();
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    updateDrag({
      kind: "rotation",
      id: actor.id,
      pointerId: event.pointerId,
      previewPose: actorPoses[actor.id] ?? actor.pose,
    });
  }

  function startKeyframeDrag(
    event: React.PointerEvent<SVGElement>,
    trajectory: Trajectory,
    frame: Trajectory["keyframes"][number],
  ) {
    if (dragRef.current || isTrajectoryEditLocked(trajectory)) return;
    onEditStart();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectKeyframe(trajectory.id, frame.id);
    updateDrag({
      kind: "keyframe",
      id: frame.id,
      pointerId: event.pointerId,
      trajectoryId: trajectory.id,
      previewX: frame.x,
      previewY: frame.y,
    });
  }

  function nearestActor(point: { x: number; y: number }): SceneActor | undefined {
    let nearest: SceneActor | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;

    replayCase.actors.forEach((actor) => {
      const pose = actorPoses[actor.id];
      if (!pose) return;
      const actorPoint = toView(pose.x, pose.y);
      const distance = Math.hypot(actorPoint.x - point.x, actorPoint.y - point.y);
      if (distance < nearestDistance) {
        nearest = actor;
        nearestDistance = distance;
      }
    });

    return nearest;
  }

  function nearestSelectedKeyframe(point: { x: number; y: number }) {
    if (
      !showPaths ||
      !selectedTrajectory?.visible ||
      !displayedTrajectories.some((trajectory) => trajectory.id === selectedTrajectory.id)
    ) {
      return undefined;
    }

    let nearestFrame: Trajectory["keyframes"][number] | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    selectedTrajectory.keyframes.forEach((frame) => {
      const framePoint = toView(frame.x, frame.y);
      const distance = Math.hypot(framePoint.x - point.x, framePoint.y - point.y);
      if (distance < nearestDistance) {
        nearestFrame = frame;
        nearestDistance = distance;
      }
    });

    return nearestDistance <= 34 && nearestFrame
      ? { trajectory: selectedTrajectory, frame: nearestFrame }
      : undefined;
  }

  function startNearestSceneDrag(event: React.PointerEvent<SVGGElement>) {
    if (placingImpact || dragRef.current) return;
    const point = clientToSvg(event.clientX, event.clientY);
    const keyframe = nearestSelectedKeyframe(point);
    if (keyframe) {
      startKeyframeDrag(event, keyframe.trajectory, keyframe.frame);
      return;
    }

    const actor = nearestActor(point);
    if (actor) startActorDrag(event, actor);
  }

  function startRotationControlDrag(
    event: React.PointerEvent<SVGCircleElement>,
    rotationActor: SceneActor,
  ) {
    if (placingImpact || dragRef.current) return;
    startRotationDrag(event, rotationActor);
  }

  function consumeSuppressedSceneClick(): boolean {
    if (!suppressSceneClickRef.current) return false;
    suppressSceneClickRef.current = false;
    return true;
  }

  function selectNearestSceneObject(event: React.MouseEvent<SVGGElement>) {
    if (consumeSuppressedSceneClick()) return;
    const point = clientToSvg(event.clientX, event.clientY);
    const actor = nearestActor(point);
    if (actor) onSelect("actor", actor.id);
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const activeDrag = dragRef.current;
    if (activeDrag?.pointerId !== event.pointerId) return;
    if (activeDrag.kind === "pan") {
      const factor = 1 / zoom;
      setPan({
        x: (activeDrag.startPanX ?? 0) + (event.clientX - (activeDrag.startClientX ?? 0)) * factor,
        y: (activeDrag.startPanY ?? 0) + (event.clientY - (activeDrag.startClientY ?? 0)) * factor,
      });
      return;
    }
    const pointer = clientToSvg(event.clientX, event.clientY);
    if (activeDrag.kind === "rotation") {
      const actor = replayCase.actors.find((item) => item.id === activeDrag.id);
      if (!actor) return;
      const pose = activeDrag.previewPose ?? actorPoses[actor.id] ?? actor.pose;
      const center = toView(pose.x, pose.y);
      let rotationDeg =
        ((Math.atan2(pointer.x - center.x, -(pointer.y - center.y)) * 180) / Math.PI + 360) % 360;
      if (event.shiftKey) rotationDeg = Math.round(rotationDeg / 15) * 15;
      updateDrag({
        ...activeDrag,
        moved: true,
        previewPose: { ...pose, rotationDeg },
      });
      return;
    }
    const normalized = toNormalized(
      pointer.x - (activeDrag.offsetX ?? 0),
      pointer.y - (activeDrag.offsetY ?? 0),
    );
    const position =
      snapToLane && replayCase.environment.sceneType === "roundabout"
        ? snapToRoundaboutLane(normalized.x, normalized.y)
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

  function commitDrag(event: React.PointerEvent<SVGSVGElement>) {
    const completedDrag = dragRef.current;
    if (completedDrag?.pointerId !== event.pointerId) return;
    if (
      completedDrag.moved &&
      (completedDrag.kind === "rotation" || completedDrag.kind === "keyframe")
    ) {
      suppressSceneClickRef.current = true;
    }
    updateDrag(undefined);
    if (
      (completedDrag.kind === "actor" || completedDrag.kind === "rotation") &&
      completedDrag.moved &&
      completedDrag.previewPose
    ) {
      onMoveActor(completedDrag.id, completedDrag.previewPose);
    } else if (
      completedDrag.kind === "keyframe" &&
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
    const next = { ...pose };
    if (event.key === "ArrowLeft") next.x -= step;
    else if (event.key === "ArrowRight") next.x += step;
    else if (event.key === "ArrowUp") next.y -= step;
    else if (event.key === "ArrowDown") next.y += step;
    else if (event.key === "[" || event.key === ",") next.rotationDeg -= event.shiftKey ? 15 : 3;
    else if (event.key === "]" || event.key === ".") next.rotationDeg += event.shiftKey ? 15 : 3;
    else return;
    event.preventDefault();
    if (isActorEditLocked(actor)) return;
    next.x = Math.max(0, Math.min(100, next.x));
    next.y = Math.max(0, Math.min(100, next.y));
    next.rotationDeg = ((next.rotationDeg % 360) + 360) % 360;
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
    <section
      className="scene-panel"
      aria-label="Incident scene editor"
      data-onboarding-id="scene-editor"
    >
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
            className={`tool-button ${snapToLane && replayCase.environment.sceneType === "roundabout" ? "is-active" : ""}`}
            onClick={() => setSnapToLane((value) => !value)}
            disabled={replayCase.environment.sceneType !== "roundabout"}
            aria-pressed={replayCase.environment.sceneType === "roundabout" ? snapToLane : false}
            title={
              replayCase.environment.sceneType === "roundabout"
                ? "While dragging, snap nearby positions to the nearest drawn lane center. Heading is unchanged."
                : "Lane snap is available for the roundabout template"
            }
            aria-label={
              replayCase.environment.sceneType === "roundabout"
                ? "Lane snap while dragging. Moves nearby positions to the nearest drawn lane center; it does not simulate steering."
                : "Lane snap unavailable for this scene template"
            }
          >
            <Crosshair size={15} /> <span>Lane snap</span>
          </button>
          <button
            className={`tool-button ${placingImpact ? "is-active" : ""}`}
            onClick={() => setPlacingImpact((value) => !value)}
            aria-pressed={placingImpact}
            aria-label={placingImpact ? "Cancel impact placement" : "Mark impact"}
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
            {replayCase.environment.roadCondition} surface · {formatSceneSeconds(currentTimeMs)}s
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
          className={`scene-svg${placingImpact ? " is-placing-impact" : ""}`}
          viewBox={viewBox}
          role="application"
          aria-label="Editable road scene. Use Tab to select a vehicle, arrow keys to move it, and bracket keys to rotate it."
          onPointerMove={onPointerMove}
          onPointerUp={commitDrag}
          onPointerCancel={(event) => {
            if (dragRef.current?.pointerId === event.pointerId) updateDrag(undefined);
          }}
          onPointerDown={(event) => {
            if (placingImpact || dragRef.current) return;
            if (
              event.target === event.currentTarget ||
              (event.target as Element).classList.contains("scene-pan-target")
            ) {
              event.currentTarget.setPointerCapture(event.pointerId);
              updateDrag({
                kind: "pan",
                id: "canvas",
                pointerId: event.pointerId,
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
              const owningActor = replayCase.actors.find(
                (actor) => actor.id === trajectory.actorId,
              );
              const pathLocked = trajectory.locked || Boolean(owningActor?.locked);
              return (
                <g
                  key={trajectory.id}
                  className={`trajectory trajectory--branch-${branchIndex % 3}${selected ? " is-selected" : ""}${active ? " is-active" : " is-overlay"}`}
                >
                  <path
                    className="trajectory__hit"
                    d={path}
                    tabIndex={placingImpact ? -1 : 0}
                    role="button"
                    aria-label={`Select path for ${replayCase.actors.find((actor) => actor.id === trajectory.actorId)?.label ?? "vehicle"}`}
                    aria-pressed={selected}
                    onClick={() => {
                      if (!placingImpact) onSelect("trajectory", trajectory.id);
                    }}
                    onKeyDown={(event) => {
                      if (placingImpact) return;
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
                            className="trajectory__handle-hit"
                            r="34"
                            tabIndex={placingImpact ? -1 : 0}
                            role="button"
                            aria-label={`Path point ${index + 1} for ${replayCase.actors.find((actor) => actor.id === trajectory.actorId)?.label ?? "vehicle"} at ${formatSceneSeconds(frame.timeMs)} seconds`}
                            aria-pressed={selectedKeyframeId === frame.id}
                            onClick={(event) => {
                              if (consumeSuppressedSceneClick()) {
                                event.stopPropagation();
                                return;
                              }
                              if (placingImpact) return;
                              event.stopPropagation();
                              onSelectKeyframe(trajectory.id, frame.id);
                            }}
                            onPointerDown={(event) => {
                              if (placingImpact || pathLocked) return;
                              startKeyframeDrag(event, trajectory, frame);
                            }}
                            onKeyDown={(event) => {
                              if (placingImpact) return;
                              const step = event.shiftKey ? 2 : 0.5;
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                onSelectKeyframe(trajectory.id, frame.id);
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
                              if (!pathLocked) {
                                onSelectKeyframe(trajectory.id, frame.id);
                                const bounded = {
                                  x: Math.max(0, Math.min(100, x)),
                                  y: Math.max(0, Math.min(100, y)),
                                };
                                onMoveKeyframe(trajectory.id, frame.id, bounded.x, bounded.y);
                              }
                            }}
                          />
                          <circle
                            className={`trajectory__handle${selectedKeyframeId === frame.id ? " is-active" : ""}`}
                            r="11"
                            aria-hidden="true"
                          />
                          <text
                            className="trajectory__handle-number"
                            textAnchor="middle"
                            y="4"
                            aria-hidden="true"
                          >
                            {index + 1}
                          </text>
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
                  {pathLocked && points[1] && <LockGlyph x={points[1].x} y={points[1].y} />}
                </g>
              );
            })}

          {impact?.location && (
            <ImpactMarker
              event={impact}
              selected={selectedId === impact.id}
              placementMode={placingImpact}
              onSelect={() => onSelect("timeline-event", impact.id)}
            />
          )}

          {[...replayCase.actors]
            .sort(
              (first, second) => Number(first.id === selectedId) - Number(second.id === selectedId),
            )
            .map((actor) => {
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
                  editLocked={isActorEditLocked(actor)}
                  agentActive={activeAgentIds.includes(actor.id)}
                  placementMode={placingImpact}
                  onPointerDown={startNearestSceneDrag}
                  onRotatePointerDown={(event) => {
                    startRotationControlDrag(event, actor);
                  }}
                  onClick={selectNearestSceneObject}
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
          <Move size={13} /> Cars show the pose at the playhead. Select one to move or rotate it.
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
              <span>Drag the round handle to rotate · Arrow keys move · [ ] rotate</span>
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
                Drag a numbered point to reshape the path · Timeline diamonds change timing
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
                {selectedEvent.title} · {formatSceneSeconds(selectedEvent.timeMs)}s ·{" "}
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
  editLocked: boolean;
  agentActive: boolean;
  placementMode: boolean;
  onPointerDown: (event: React.PointerEvent<SVGGElement>) => void;
  onRotatePointerDown: (event: React.PointerEvent<SVGCircleElement>) => void;
  onClick: (event: React.MouseEvent<SVGGElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<SVGGElement>) => void;
}

function Vehicle({
  actor,
  x,
  y,
  rotation,
  selected,
  editLocked,
  agentActive,
  placementMode,
  onPointerDown,
  onRotatePointerDown,
  onClick,
  onKeyDown,
}: VehicleProps) {
  const blue = actor.colorToken.includes("blue");
  const damage = actor.damageMarkers;
  return (
    <g
      className={`scene-vehicle${selected ? " is-selected" : ""}${editLocked ? " is-locked" : ""}${agentActive ? " is-agent-active" : ""}`}
      transform={`translate(${x} ${y}) rotate(${rotation})`}
      tabIndex={0}
      role="button"
      aria-label={`${actor.label}, position ${(x / 10).toFixed(1)}, ${(y / 7).toFixed(1)}, orientation ${Math.round(rotation)} degrees${editLocked ? ", locked. Unlock the vehicle and its path to edit" : ". Use arrow keys to move and bracket keys to rotate"}.`}
      aria-pressed={selected}
      onPointerDown={onPointerDown}
      onClick={(event) => {
        if (placementMode) return;
        event.stopPropagation();
        onClick(event);
      }}
      onKeyDown={onKeyDown}
    >
      <rect className="vehicle-hit" x="-42" y="-58" width="84" height="126" rx="24" />
      <rect className="vehicle-selection" x="-25" y="-50" width="50" height="100" rx="18" />
      {selected && !editLocked && (
        <g className="vehicle-rotation-control" aria-hidden="true">
          <line x1="0" y1="-49" x2="0" y2="-76" />
          <circle
            className="vehicle-rotation-control__hit"
            cx="0"
            cy="-82"
            r="34"
            onPointerDown={onRotatePointerDown}
          />
          <circle className="vehicle-rotation-control__knob" cx="0" cy="-82" r="10" />
          <path d="M-4-83a5 5 0 0 1 8 0M4-83l-1-5 5 2" />
        </g>
      )}
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
      {editLocked && <LockGlyph x={23} y={-49} />}
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
  placementMode,
  onSelect,
}: {
  event: TimelineEvent;
  selected: boolean;
  placementMode: boolean;
  onSelect: () => void;
}) {
  if (!event.location) return null;
  const point = toView(event.location.x, event.location.y);
  return (
    <g
      className={`impact-marker certainty--${event.certainty}${selected ? " is-selected" : ""}`}
      transform={`translate(${point.x} ${point.y})`}
      tabIndex={placementMode ? -1 : 0}
      role="button"
      aria-label={`Approximate impact at ${formatSceneSeconds(event.timeMs)} seconds, ${event.certainty}`}
      onClick={() => {
        if (!placementMode) onSelect();
      }}
      onKeyDown={(keyboardEvent) => {
        if (placementMode) return;
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
