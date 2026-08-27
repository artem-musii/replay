import type { ActorPose, Point, ReplayCase, Trajectory } from "./models";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

/**
 * Returns a deterministic, clamped linear pose for a trajectory. Keyframes are
 * not mutated and rotation follows the shortest angular path.
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

  let lower = first;
  let upper = last;
  for (let index = 1; index < trajectory.keyframes.length; index += 1) {
    const candidate = trajectory.keyframes[index];
    if (!candidate) continue;
    if (candidate.timeMs >= timeMs) {
      upper = candidate;
      lower = trajectory.keyframes[index - 1] ?? first;
      break;
    }
  }

  const duration = upper.timeMs - lower.timeMs;
  const progress = duration === 0 ? 0 : clamp((timeMs - lower.timeMs) / duration, 0, 1);
  return {
    x: lower.x + (upper.x - lower.x) * progress,
    y: lower.y + (upper.y - lower.y) * progress,
    rotationDeg: interpolateRotation(lower.rotationDeg, upper.rotationDeg, progress),
  };
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
