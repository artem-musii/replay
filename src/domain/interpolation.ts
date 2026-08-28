import type { ActorPose, Point, ReplayCase, Trajectory } from "./models";

export const REPLAY_TIME_STEP_MS = 100;
export const REPLAY_SCENE_X_SCALE = 10;
export const REPLAY_SCENE_Y_SCALE = 7;

export function sceneDeltaForCompassHeading(rotationDeg: number, distancePx: number): Point {
  const radians = (rotationDeg * Math.PI) / 180;
  return {
    x: (Math.sin(radians) * distancePx) / REPLAY_SCENE_X_SCALE,
    y: (-Math.cos(radians) * distancePx) / REPLAY_SCENE_Y_SCALE,
  };
}

/** Converts a real local-scene distance into scene-coordinate deltas. */
export function sceneDeltaForMetricHeading(
  rotationDeg: number,
  distanceMeters: number,
  calibration: Pick<ReplayCase["environment"], "bounds" | "calibration">,
): Point {
  const radians = (rotationDeg * Math.PI) / 180;
  const sceneWidth = calibration.bounds.maxX - calibration.bounds.minX;
  const sceneHeight = calibration.bounds.maxY - calibration.bounds.minY;
  return {
    x: (Math.sin(radians) * distanceMeters * sceneWidth) / calibration.calibration.widthMeters,
    y: (-Math.cos(radians) * distanceMeters * sceneHeight) / calibration.calibration.heightMeters,
  };
}

export function quantizeTimeMs(timeMs: number, originMs = 0): number {
  return originMs + Math.round((timeMs - originMs) / REPLAY_TIME_STEP_MS) * REPLAY_TIME_STEP_MS;
}

export function clampTimeToRange(timeMs: number, range: ReplayCase["timeRangeMs"]): number {
  return clamp(Math.round(timeMs), range.start, range.end);
}

/**
 * Snaps ordinary timeline editing to tenths of a second relative to the case
 * start. Very short imported ranges retain millisecond precision instead of
 * being collapsed onto a grid point outside their range.
 */
export function quantizeTimeInRange(timeMs: number, range: ReplayCase["timeRangeMs"]): number {
  const bounded = clampTimeToRange(timeMs, range);
  if (range.end - range.start < REPLAY_TIME_STEP_MS) return bounded;
  return clamp(quantizeTimeMs(bounded, range.start), range.start, range.end);
}

/**
 * Applies the timeline grid only when the editable gap can contain it. This
 * preserves valid imported keyframes that are less than 100 ms apart.
 */
export function quantizeEditableTimeMs(
  timeMs: number,
  bounds: { min: number; max: number },
  range: ReplayCase["timeRangeMs"],
): number {
  const bounded = clamp(Math.round(timeMs), bounds.min, bounds.max);
  if (bounds.max - bounds.min < REPLAY_TIME_STEP_MS) return bounded;
  return clamp(quantizeTimeMs(bounded, range.start), bounds.min, bounds.max);
}

export function editableKeyframeTimeBounds(
  previousTimeMs: number | undefined,
  nextTimeMs: number | undefined,
  range: ReplayCase["timeRangeMs"],
): { min: number; max: number } {
  const preferred = {
    min: previousTimeMs === undefined ? range.start : previousTimeMs + REPLAY_TIME_STEP_MS,
    max: nextTimeMs === undefined ? range.end : nextTimeMs - REPLAY_TIME_STEP_MS,
  };
  if (preferred.min <= preferred.max) return preferred;
  return {
    min: previousTimeMs === undefined ? range.start : previousTimeMs + 1,
    max: nextTimeMs === undefined ? range.end : nextTimeMs - 1,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Chooses two valid times for a newly-created trajectory. Short cases use the
 * entire available range; longer cases keep at least one second between the
 * points and prefer a four-second preview from the current playhead.
 */
export function initialTrajectoryTimes(
  currentTimeMs: number,
  range: ReplayCase["timeRangeMs"],
): { start: number; end: number } {
  const availableDuration = range.end - range.start;
  if (availableDuration <= 0) {
    throw new RangeError("A trajectory requires a case time range with positive duration");
  }

  const minimumDuration = Math.min(1_000, availableDuration);
  const start = clamp(
    quantizeTimeInRange(currentTimeMs, range),
    range.start,
    range.end - minimumDuration,
  );
  const end = Math.min(range.end, start + 4_000);
  return { start, end };
}

export function normalizeDegrees(degrees: number): number {
  const normalized = degrees % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function interpolateRotation(from: number, to: number, progress: number): number {
  const start = normalizeDegrees(from);
  const delta = ((normalizeDegrees(to) - start + 540) % 360) - 180;
  return normalizeDegrees(start + delta * clamp(progress, 0, 1));
}

function hermitePosition(
  trajectory: Trajectory,
  lowerIndex: number,
  upperIndex: number,
  progress: number,
): Point {
  const lower = trajectory.keyframes[lowerIndex];
  const upper = trajectory.keyframes[upperIndex];
  if (!lower || !upper) throw new Error(`Trajectory ${trajectory.id} has an invalid segment`);
  const previous = trajectory.keyframes[lowerIndex - 1];
  const next = trajectory.keyframes[upperIndex + 1];
  const duration = upper.timeMs - lower.timeMs;
  if (duration <= 0) return { x: lower.x, y: lower.y };

  const lowerSpan = previous ? upper.timeMs - previous.timeMs : duration;
  const upperSpan = next ? next.timeMs - lower.timeMs : duration;
  const lowerDerivative = {
    x: (upper.x - (previous?.x ?? lower.x)) / Math.max(1, lowerSpan),
    y: (upper.y - (previous?.y ?? lower.y)) / Math.max(1, lowerSpan),
  };
  const upperDerivative = {
    x: ((next?.x ?? upper.x) - lower.x) / Math.max(1, upperSpan),
    y: ((next?.y ?? upper.y) - lower.y) / Math.max(1, upperSpan),
  };
  const t = clamp(progress, 0, 1);
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return {
    x:
      h00 * lower.x +
      h10 * lowerDerivative.x * duration +
      h01 * upper.x +
      h11 * upperDerivative.x * duration,
    y:
      h00 * lower.y +
      h10 * lowerDerivative.y * duration +
      h01 * upper.y +
      h11 * upperDerivative.y * duration,
  };
}

/**
 * Returns a deterministic, clamped pose. Position follows a time-aware cubic
 * Hermite curve through three or more timed points; a two-point path remains
 * exactly linear. Keyframes are not mutated and rotation follows the shortest
 * angular path. This is an interpolation model, not a vehicle dynamics model.
 */
export function interpolateTrajectory(trajectory: Trajectory, timeMs: number): ActorPose {
  if (trajectory.keyframes.length === 0) {
    throw new Error(`Trajectory ${trajectory.id} has no keyframes`);
  }

  const first = trajectory.keyframes[0];
  if (!first) throw new Error(`Trajectory ${trajectory.id} has no keyframes`);
  const last = trajectory.keyframes.at(-1) ?? first;
  if (timeMs <= first.timeMs) {
    return { x: first.x, y: first.y, rotationDeg: normalizeDegrees(first.rotationDeg) };
  }
  if (timeMs >= last.timeMs) {
    return { x: last.x, y: last.y, rotationDeg: normalizeDegrees(last.rotationDeg) };
  }

  let lowerBound = 1;
  let upperBound = trajectory.keyframes.length - 1;
  while (lowerBound < upperBound) {
    const midpoint = Math.floor((lowerBound + upperBound) / 2);
    const candidate = trajectory.keyframes[midpoint];
    if (candidate && candidate.timeMs < timeMs) lowerBound = midpoint + 1;
    else upperBound = midpoint;
  }
  const upperIndex = lowerBound;
  const lowerIndex = upperIndex - 1;
  const lower = trajectory.keyframes[lowerIndex] ?? first;
  const upper = trajectory.keyframes[upperIndex] ?? last;

  const duration = upper.timeMs - lower.timeMs;
  const progress = duration === 0 ? 0 : clamp((timeMs - lower.timeMs) / duration, 0, 1);
  const position =
    trajectory.interpolationMode === "linear"
      ? {
          x: lower.x + (upper.x - lower.x) * progress,
          y: lower.y + (upper.y - lower.y) * progress,
        }
      : hermitePosition(trajectory, lowerIndex, upperIndex, progress);
  return {
    ...position,
    rotationDeg: interpolateRotation(lower.rotationDeg, upper.rotationDeg, progress),
  };
}

/** Samples the same curve used by playback for SVG rendering and swept checks. */
export function sampleTrajectory(trajectory: Trajectory, samplesPerSegment = 12): ActorPose[] {
  if (trajectory.keyframes.length === 0) return [];
  if (trajectory.keyframes.length === 1) return [interpolateTrajectory(trajectory, 0)];
  const samples: ActorPose[] = [];
  const divisions = Math.max(1, Math.min(100, Math.round(samplesPerSegment)));
  for (let index = 1; index < trajectory.keyframes.length; index += 1) {
    const from = trajectory.keyframes[index - 1];
    const to = trajectory.keyframes[index];
    if (!from || !to) continue;
    for (let sampleIndex = index === 1 ? 0 : 1; sampleIndex <= divisions; sampleIndex += 1) {
      const progress = sampleIndex / divisions;
      samples.push(
        interpolateTrajectory(trajectory, from.timeMs + (to.timeMs - from.timeMs) * progress),
      );
    }
  }
  return samples;
}

export function getBranchTrajectory(
  replayCase: ReplayCase,
  branchId: string,
  actorId: string,
): Trajectory | undefined {
  const branch = replayCase.branches.find((candidate) => candidate.id === branchId);
  if (!branch) return undefined;
  return replayCase.trajectories.find(
    (trajectory) =>
      trajectory.actorId === actorId &&
      trajectory.branchId === branchId &&
      branch.trajectoryIds.includes(trajectory.id),
  );
}

export function getActorPoseAtTime(
  replayCase: ReplayCase,
  actorId: string,
  timeMs: number,
  branchId = replayCase.activeBranchId,
): ActorPose | undefined {
  const trajectory = getBranchTrajectory(replayCase, branchId, actorId);
  if (trajectory) return interpolateTrajectory(trajectory, timeMs);
  return replayCase.actors.find((actor) => actor.id === actorId)?.pose;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    if (!currentPoint || !previousPoint) continue;
    const crosses =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y || Number.EPSILON) +
          currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}
