import { getActorPoseAtTime, getBranchTrajectory, normalizeDegrees } from "./interpolation";
import type { ActorPose, Point, ReplayCase, SceneActor, Trajectory } from "./models";

const GEOMETRY_EPSILON_M = 1e-9;
const ANGLE_EPSILON_RAD = 1e-9;

export interface SceneBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Maps the scene's dimensionless coordinate space into a local metric plane.
 * The current built-in canvas uses 0..100 on both axes; its 1000 x 700 view
 * therefore falls back to a 100 m x 70 m local scene until a case supplies a
 * measured calibration.
 */
export interface SceneMetricCalibration {
  sceneBounds: SceneBounds;
  widthMeters: number;
  heightMeters: number;
}

export interface SceneMetricCalibrationInput {
  sceneBounds?: SceneBounds;
  widthMeters?: number;
  heightMeters?: number;
}

export interface MetricPoint {
  xM: number;
  yM: number;
}

export const DEFAULT_SCENE_METRIC_CALIBRATION: Readonly<SceneMetricCalibration> = Object.freeze({
  sceneBounds: Object.freeze({ minX: 0, minY: 0, maxX: 100, maxY: 100 }),
  widthMeters: 100,
  heightMeters: 70,
});

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return value;
}

function positive(value: number, label: string): number {
  finite(value, label);
  if (value <= 0) throw new RangeError(`${label} must be positive`);
  return value;
}

export function createSceneMetricCalibration(
  input: SceneMetricCalibrationInput = {},
): SceneMetricCalibration {
  const fallbackBounds = DEFAULT_SCENE_METRIC_CALIBRATION.sceneBounds;
  const sceneBounds = { ...(input.sceneBounds ?? fallbackBounds) };
  finite(sceneBounds.minX, "Scene minimum X");
  finite(sceneBounds.minY, "Scene minimum Y");
  finite(sceneBounds.maxX, "Scene maximum X");
  finite(sceneBounds.maxY, "Scene maximum Y");
  if (sceneBounds.maxX <= sceneBounds.minX || sceneBounds.maxY <= sceneBounds.minY) {
    throw new RangeError("Scene calibration bounds must have positive area");
  }
  return {
    sceneBounds,
    widthMeters: positive(
      input.widthMeters ?? DEFAULT_SCENE_METRIC_CALIBRATION.widthMeters,
      "Calibrated scene width",
    ),
    heightMeters: positive(
      input.heightMeters ?? DEFAULT_SCENE_METRIC_CALIBRATION.heightMeters,
      "Calibrated scene height",
    ),
  };
}

/** Converts a scene point without clamping, so out-of-bounds evidence remains diagnosable. */
export function normalizedScenePointToMeters(
  point: Point,
  calibration: SceneMetricCalibration = DEFAULT_SCENE_METRIC_CALIBRATION,
): MetricPoint {
  finite(point.x, "Scene X");
  finite(point.y, "Scene Y");
  const sceneWidth = positive(
    calibration.sceneBounds.maxX - calibration.sceneBounds.minX,
    "Scene bounds width",
  );
  const sceneHeight = positive(
    calibration.sceneBounds.maxY - calibration.sceneBounds.minY,
    "Scene bounds height",
  );
  return {
    xM:
      ((point.x - calibration.sceneBounds.minX) / sceneWidth) *
      positive(calibration.widthMeters, "Calibrated scene width"),
    yM:
      ((point.y - calibration.sceneBounds.minY) / sceneHeight) *
      positive(calibration.heightMeters, "Calibrated scene height"),
  };
}

export function normalizedSceneDistanceMeters(
  first: Point,
  second: Point,
  calibration: SceneMetricCalibration = DEFAULT_SCENE_METRIC_CALIBRATION,
): number {
  const firstMetric = normalizedScenePointToMeters(first, calibration);
  const secondMetric = normalizedScenePointToMeters(second, calibration);
  return Math.hypot(firstMetric.xM - secondMetric.xM, firstMetric.yM - secondMetric.yM);
}

export interface MetricVector {
  xM: number;
  yM: number;
}

export interface OrientedVehicleFootprint {
  center: MetricPoint;
  /** Compass heading: 0 degrees is up/north and 90 degrees is right/east. */
  headingDeg: number;
  widthM: number;
  lengthM: number;
  /** Ordered front-left, front-right, rear-right, rear-left. */
  corners: readonly [MetricPoint, MetricPoint, MetricPoint, MetricPoint];
  forwardAxis: MetricVector;
  rightAxis: MetricVector;
}

export interface VehicleFootprintInput {
  pose: ActorPose;
  dimensions: SceneActor["dimensions"];
}

export function createOrientedVehicleFootprint(
  pose: ActorPose,
  dimensions: SceneActor["dimensions"],
  calibration: SceneMetricCalibration = DEFAULT_SCENE_METRIC_CALIBRATION,
): OrientedVehicleFootprint {
  const widthM = positive(dimensions.width, "Vehicle width");
  const lengthM = positive(dimensions.length, "Vehicle length");
  const center = normalizedScenePointToMeters(pose, calibration);
  const headingDeg = normalizeDegrees(finite(pose.rotationDeg, "Vehicle heading"));
  const radians = (headingDeg * Math.PI) / 180;
  const forwardAxis = { xM: Math.sin(radians), yM: -Math.cos(radians) };
  const rightAxis = { xM: Math.cos(radians), yM: Math.sin(radians) };
  const halfLength = lengthM / 2;
  const halfWidth = widthM / 2;

  const corner = (forwardSign: -1 | 1, rightSign: -1 | 1): MetricPoint => ({
    xM:
      center.xM + forwardAxis.xM * halfLength * forwardSign + rightAxis.xM * halfWidth * rightSign,
    yM:
      center.yM + forwardAxis.yM * halfLength * forwardSign + rightAxis.yM * halfWidth * rightSign,
  });

  return {
    center,
    headingDeg,
    widthM,
    lengthM,
    corners: [corner(1, -1), corner(1, 1), corner(-1, 1), corner(-1, -1)],
    forwardAxis,
    rightAxis,
  };
}

export interface FootprintRelation {
  /** Boundary contact counts as overlap; penetrationDepthM is then zero. */
  overlaps: boolean;
  /** Exact minimum rectangle-to-rectangle distance when separated, otherwise zero. */
  separationM: number;
  /** Minimum separating-axis translation when overlapping, otherwise zero. */
  penetrationDepthM: number;
  centerDistanceM: number;
}

/** Shared visual/validation allowance for shallow modeled contact at an impact instant. */
export function impactPenetrationToleranceMeters(
  first: SceneActor["dimensions"],
  second: SceneActor["dimensions"],
): number {
  return Math.max(0.15, Math.min(first.width, second.width) * 0.1);
}

/** Shared gap allowance derived from the scene calibration uncertainty. */
export function impactSeparationToleranceMeters(uncertaintyMeters: number): number {
  return Math.max(0.25, Number.isFinite(uncertaintyMeters) ? uncertaintyMeters : 0.25);
}

function dot(point: MetricPoint, axis: MetricVector): number {
  return point.xM * axis.xM + point.yM * axis.yM;
}

function projection(
  footprint: OrientedVehicleFootprint,
  axis: MetricVector,
): { min: number; max: number } {
  const values = footprint.corners.map((corner) => dot(corner, axis));
  return { min: Math.min(...values), max: Math.max(...values) };
}

function pointToSegmentDistance(point: MetricPoint, start: MetricPoint, end: MetricPoint): number {
  const dx = end.xM - start.xM;
  const dy = end.yM - start.yM;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= GEOMETRY_EPSILON_M ** 2) {
    return Math.hypot(point.xM - start.xM, point.yM - start.yM);
  }
  const progress = Math.min(
    1,
    Math.max(0, ((point.xM - start.xM) * dx + (point.yM - start.yM) * dy) / lengthSquared),
  );
  return Math.hypot(point.xM - (start.xM + dx * progress), point.yM - (start.yM + dy * progress));
}

function separatedFootprintDistance(
  first: OrientedVehicleFootprint,
  second: OrientedVehicleFootprint,
): number {
  let minimum = Number.POSITIVE_INFINITY;
  const compareVerticesToEdges = (
    vertices: OrientedVehicleFootprint["corners"],
    edges: OrientedVehicleFootprint["corners"],
  ) => {
    for (const vertex of vertices) {
      for (let index = 0; index < edges.length; index += 1) {
        const start = edges[index];
        const end = edges[(index + 1) % edges.length];
        if (!start || !end) continue;
        minimum = Math.min(minimum, pointToSegmentDistance(vertex, start, end));
      }
    }
  };
  compareVerticesToEdges(first.corners, second.corners);
  compareVerticesToEdges(second.corners, first.corners);
  return minimum;
}

/** Uses the separating-axis theorem, then exact edge distance when separated. */
export function analyzeFootprintRelation(
  first: OrientedVehicleFootprint,
  second: OrientedVehicleFootprint,
): FootprintRelation {
  const axes = [first.forwardAxis, first.rightAxis, second.forwardAxis, second.rightAxis];
  let overlaps = true;
  let minimumOverlap = Number.POSITIVE_INFINITY;
  for (const axis of axes) {
    const firstProjection = projection(first, axis);
    const secondProjection = projection(second, axis);
    const overlap =
      Math.min(firstProjection.max, secondProjection.max) -
      Math.max(firstProjection.min, secondProjection.min);
    if (overlap < -GEOMETRY_EPSILON_M) overlaps = false;
    else minimumOverlap = Math.min(minimumOverlap, Math.max(0, overlap));
  }
  const centerDistanceM = Math.hypot(
    first.center.xM - second.center.xM,
    first.center.yM - second.center.yM,
  );
  return {
    overlaps,
    separationM: overlaps ? 0 : separatedFootprintDistance(first, second),
    penetrationDepthM: overlaps && Number.isFinite(minimumOverlap) ? minimumOverlap : 0,
    centerDistanceM,
  };
}

export function analyzeVehicleFootprintRelation(
  first: VehicleFootprintInput,
  second: VehicleFootprintInput,
  calibration: SceneMetricCalibration = DEFAULT_SCENE_METRIC_CALIBRATION,
): FootprintRelation {
  return analyzeFootprintRelation(
    createOrientedVehicleFootprint(first.pose, first.dimensions, calibration),
    createOrientedVehicleFootprint(second.pose, second.dimensions, calibration),
  );
}

export interface TrajectorySegmentMetrics {
  segmentIndex: number;
  fromKeyframeId: string;
  toKeyframeId: string;
  startTimeMs: number;
  endTimeMs: number;
  durationSeconds: number;
  distanceM: number;
  /** Chord-derived average speed; a fitted curved path can only be longer. */
  speedMps: number;
  accelerationMps2: number | null;
  pathHeadingDeg: number | null;
  headingDeltaDeg: number;
  yawRateDegPerSecond: number;
  headingMismatchDeg: number | null;
  /** Null represents a straight segment with no measurable heading change. */
  turnRadiusM: number | null;
  lateralAccelerationMps2: number | null;
}

export interface MotionAdvisoryThresholds {
  maxSpeedMps?: number;
  maxAccelerationMps2?: number;
  /** Positive magnitude applied to negative acceleration. */
  maxDecelerationMps2?: number;
  maxYawRateDegPerSecond?: number;
  maxHeadingMismatchDeg?: number;
  minTurnRadiusM?: number;
  maxLateralAccelerationMps2?: number;
}

export type MotionAdvisoryCode =
  | "motion.speed"
  | "motion.acceleration"
  | "motion.deceleration"
  | "motion.yaw-rate"
  | "motion.heading-mismatch"
  | "motion.turn-radius"
  | "motion.lateral-acceleration";

export interface MotionAdvisory {
  code: MotionAdvisoryCode;
  trajectoryId: string;
  actorId: string;
  segmentIndex: number;
  fromKeyframeId: string;
  toKeyframeId: string;
  observed: number;
  threshold: number;
  unit: "m/s" | "m/s²" | "deg/s" | "deg" | "m";
  message: string;
}

export interface TrajectoryMotionSummary {
  trajectoryId: string;
  actorId: string;
  branchId: string;
  segmentCount: number;
  durationSeconds: number;
  totalDistanceM: number;
  maxSpeedMps: number;
  maxAbsAccelerationMps2: number;
  maxAbsYawRateDegPerSecond: number;
  minimumTurnRadiusM: number | null;
  advisoryCount: number;
}

export interface TrajectoryMotionAnalysis {
  summary: TrajectoryMotionSummary;
  segments: TrajectorySegmentMetrics[];
  advisories: MotionAdvisory[];
}

export interface TrajectoryMotionAnalysisOptions {
  calibration?: SceneMetricCalibration;
  thresholds?: MotionAdvisoryThresholds;
}

function shortestSignedAngleDegrees(from: number, to: number): number {
  return ((normalizeDegrees(to) - normalizeDegrees(from) + 540) % 360) - 180;
}

function absoluteAngleDifference(first: number, second: number): number {
  return Math.abs(shortestSignedAngleDegrees(first, second));
}

function compassHeadingDegrees(dx: number, dy: number): number {
  return normalizeDegrees((Math.atan2(dx, -dy) * 180) / Math.PI);
}

function validateThresholds(thresholds: MotionAdvisoryThresholds): void {
  const entries: Array<[keyof MotionAdvisoryThresholds, number | undefined]> = [
    ["maxSpeedMps", thresholds.maxSpeedMps],
    ["maxAccelerationMps2", thresholds.maxAccelerationMps2],
    ["maxDecelerationMps2", thresholds.maxDecelerationMps2],
    ["maxYawRateDegPerSecond", thresholds.maxYawRateDegPerSecond],
    ["maxHeadingMismatchDeg", thresholds.maxHeadingMismatchDeg],
    ["minTurnRadiusM", thresholds.minTurnRadiusM],
    ["maxLateralAccelerationMps2", thresholds.maxLateralAccelerationMps2],
  ];
  for (const [name, value] of entries) {
    if (value === undefined) continue;
    finite(value, `Motion threshold ${name}`);
    if (value < 0) throw new RangeError(`Motion threshold ${name} cannot be negative`);
  }
}

function buildSegmentMetrics(
  trajectory: Trajectory,
  calibration: SceneMetricCalibration,
): TrajectorySegmentMetrics[] {
  const segments: TrajectorySegmentMetrics[] = [];
  for (let index = 1; index < trajectory.keyframes.length; index += 1) {
    const from = trajectory.keyframes[index - 1];
    const to = trajectory.keyframes[index];
    if (!from || !to) continue;
    const durationSeconds = (to.timeMs - from.timeMs) / 1_000;
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new RangeError(
        `Trajectory ${trajectory.id} has non-increasing time at segment ${index}`,
      );
    }
    const fromMetric = normalizedScenePointToMeters(from, calibration);
    const toMetric = normalizedScenePointToMeters(to, calibration);
    const dx = toMetric.xM - fromMetric.xM;
    const dy = toMetric.yM - fromMetric.yM;
    const distanceM = Math.hypot(dx, dy);
    const speedMps = distanceM / durationSeconds;
    const headingDeltaDeg = shortestSignedAngleDegrees(from.rotationDeg, to.rotationDeg);
    const deltaRadians = Math.abs((headingDeltaDeg * Math.PI) / 180);
    const turnRadiusM =
      deltaRadians <= ANGLE_EPSILON_RAD
        ? null
        : distanceM / (2 * Math.sin(Math.min(Math.PI, deltaRadians) / 2));
    const pathHeadingDeg = distanceM <= GEOMETRY_EPSILON_M ? null : compassHeadingDegrees(dx, dy);
    const meanHeadingDeg = normalizeDegrees(from.rotationDeg + headingDeltaDeg / 2);
    const headingMismatchDeg =
      pathHeadingDeg === null ? null : absoluteAngleDifference(pathHeadingDeg, meanHeadingDeg);
    const previous = segments.at(-1);
    const accelerationMps2 = previous
      ? (speedMps - previous.speedMps) /
        Math.max(GEOMETRY_EPSILON_M, (previous.durationSeconds + durationSeconds) / 2)
      : null;
    const lateralAccelerationMps2 =
      turnRadiusM === null || turnRadiusM <= GEOMETRY_EPSILON_M
        ? turnRadiusM === null
          ? null
          : 0
        : (speedMps * speedMps) / turnRadiusM;
    segments.push({
      segmentIndex: index - 1,
      fromKeyframeId: from.id,
      toKeyframeId: to.id,
      startTimeMs: from.timeMs,
      endTimeMs: to.timeMs,
      durationSeconds,
      distanceM,
      speedMps,
      accelerationMps2,
      pathHeadingDeg,
      headingDeltaDeg,
      yawRateDegPerSecond: headingDeltaDeg / durationSeconds,
      headingMismatchDeg,
      turnRadiusM,
      lateralAccelerationMps2,
    });
  }
  return segments;
}

function motionAdvisories(
  trajectory: Trajectory,
  segments: TrajectorySegmentMetrics[],
  thresholds: MotionAdvisoryThresholds,
): MotionAdvisory[] {
  const advisories: MotionAdvisory[] = [];
  const add = (
    segment: TrajectorySegmentMetrics,
    code: MotionAdvisoryCode,
    observed: number,
    threshold: number,
    unit: MotionAdvisory["unit"],
    message: string,
  ) => {
    advisories.push({
      code,
      trajectoryId: trajectory.id,
      actorId: trajectory.actorId,
      segmentIndex: segment.segmentIndex,
      fromKeyframeId: segment.fromKeyframeId,
      toKeyframeId: segment.toKeyframeId,
      observed,
      threshold,
      unit,
      message,
    });
  };

  for (const segment of segments) {
    if (thresholds.maxSpeedMps !== undefined && segment.speedMps > thresholds.maxSpeedMps) {
      add(
        segment,
        "motion.speed",
        segment.speedMps,
        thresholds.maxSpeedMps,
        "m/s",
        "Average segment speed exceeds the supplied advisory profile.",
      );
    }
    if (
      thresholds.maxAccelerationMps2 !== undefined &&
      segment.accelerationMps2 !== null &&
      segment.accelerationMps2 > thresholds.maxAccelerationMps2
    ) {
      add(
        segment,
        "motion.acceleration",
        segment.accelerationMps2,
        thresholds.maxAccelerationMps2,
        "m/s²",
        "Speed increase exceeds the supplied advisory profile.",
      );
    }
    if (
      thresholds.maxDecelerationMps2 !== undefined &&
      segment.accelerationMps2 !== null &&
      -segment.accelerationMps2 > thresholds.maxDecelerationMps2
    ) {
      add(
        segment,
        "motion.deceleration",
        -segment.accelerationMps2,
        thresholds.maxDecelerationMps2,
        "m/s²",
        "Speed decrease exceeds the supplied advisory profile.",
      );
    }
    if (
      thresholds.maxYawRateDegPerSecond !== undefined &&
      Math.abs(segment.yawRateDegPerSecond) > thresholds.maxYawRateDegPerSecond
    ) {
      add(
        segment,
        "motion.yaw-rate",
        Math.abs(segment.yawRateDegPerSecond),
        thresholds.maxYawRateDegPerSecond,
        "deg/s",
        "Heading change exceeds the supplied advisory profile.",
      );
    }
    if (
      thresholds.maxHeadingMismatchDeg !== undefined &&
      segment.headingMismatchDeg !== null &&
      segment.headingMismatchDeg > thresholds.maxHeadingMismatchDeg
    ) {
      add(
        segment,
        "motion.heading-mismatch",
        segment.headingMismatchDeg,
        thresholds.maxHeadingMismatchDeg,
        "deg",
        "Vehicle heading differs from its direction of travel.",
      );
    }
    if (
      thresholds.minTurnRadiusM !== undefined &&
      segment.turnRadiusM !== null &&
      segment.turnRadiusM < thresholds.minTurnRadiusM
    ) {
      add(
        segment,
        "motion.turn-radius",
        segment.turnRadiusM,
        thresholds.minTurnRadiusM,
        "m",
        "Implied turn radius is below the supplied advisory profile.",
      );
    }
    if (
      thresholds.maxLateralAccelerationMps2 !== undefined &&
      segment.lateralAccelerationMps2 !== null &&
      segment.lateralAccelerationMps2 > thresholds.maxLateralAccelerationMps2
    ) {
      add(
        segment,
        "motion.lateral-acceleration",
        segment.lateralAccelerationMps2,
        thresholds.maxLateralAccelerationMps2,
        "m/s²",
        "Implied lateral acceleration exceeds the supplied advisory profile.",
      );
    }
  }
  return advisories;
}

function summarizeTrajectory(
  trajectory: Trajectory,
  segments: TrajectorySegmentMetrics[],
  advisoryCount: number,
): TrajectoryMotionSummary {
  const accelerations = segments.flatMap((segment) =>
    segment.accelerationMps2 === null ? [] : [Math.abs(segment.accelerationMps2)],
  );
  const turnRadii = segments.flatMap((segment) =>
    segment.turnRadiusM === null ? [] : [segment.turnRadiusM],
  );
  return {
    trajectoryId: trajectory.id,
    actorId: trajectory.actorId,
    branchId: trajectory.branchId,
    segmentCount: segments.length,
    durationSeconds:
      trajectory.keyframes.length < 2
        ? 0
        : ((trajectory.keyframes.at(-1)?.timeMs ?? 0) - (trajectory.keyframes[0]?.timeMs ?? 0)) /
          1_000,
    totalDistanceM: segments.reduce((total, segment) => total + segment.distanceM, 0),
    maxSpeedMps: Math.max(0, ...segments.map((segment) => segment.speedMps)),
    maxAbsAccelerationMps2: Math.max(0, ...accelerations),
    maxAbsYawRateDegPerSecond: Math.max(
      0,
      ...segments.map((segment) => Math.abs(segment.yawRateDegPerSecond)),
    ),
    minimumTurnRadiusM: turnRadii.length > 0 ? Math.min(...turnRadii) : null,
    advisoryCount,
  };
}

export function analyzeTrajectoryMotion(
  trajectory: Trajectory,
  options: TrajectoryMotionAnalysisOptions = {},
): TrajectoryMotionAnalysis {
  const calibration = options.calibration ?? DEFAULT_SCENE_METRIC_CALIBRATION;
  const thresholds = options.thresholds ?? {};
  validateThresholds(thresholds);
  const segments = buildSegmentMetrics(trajectory, calibration);
  const advisories = motionAdvisories(trajectory, segments, thresholds);
  return {
    summary: summarizeTrajectory(trajectory, segments, advisories.length),
    segments,
    advisories,
  };
}

export interface BranchImpactFootprintAnalysis extends FootprintRelation {
  eventId: string;
  timeMs: number;
  actorIds: readonly [string, string];
}

export interface ImpactAdjacentPathLeg {
  startTimeMs: number;
  endTimeMs: number;
  durationSeconds: number;
  /** Straight-line displacement between the two sampled timed poses. */
  distanceM: number;
  /** Chord-derived average over this leg; not instantaneous or dynamics-derived speed. */
  speedMps: number;
  /** Direction of travel in compass degrees; null when the sampled leg is stationary. */
  courseDeg: number | null;
}

/**
 * Describes the authored path immediately before and after an impact marker.
 * Values are derived from timed poses and metric calibration only. They do not
 * model an impulse, attribute a path change to contact, or infer collision dynamics.
 */
export interface ImpactAdjacentPathAnalysis {
  eventId: string;
  timeMs: number;
  actorId: string;
  trajectoryId: string | null;
  /** True only when the author placed a trajectory keyframe at the event time. */
  authoredImpactKeyframe: boolean;
  incoming: ImpactAdjacentPathLeg | null;
  outgoing: ImpactAdjacentPathLeg | null;
  /** Outgoing minus incoming speed; null when either adjacent leg is unavailable. */
  speedChangeMps: number | null;
  /** Signed shortest change in travel course; null for a missing or stationary leg. */
  courseChangeDeg: number | null;
}

function impactAdjacentPathLeg(
  start: ActorPose,
  startTimeMs: number,
  end: ActorPose,
  endTimeMs: number,
  calibration: SceneMetricCalibration,
): ImpactAdjacentPathLeg | null {
  const durationSeconds = (endTimeMs - startTimeMs) / 1_000;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  const startMetric = normalizedScenePointToMeters(start, calibration);
  const endMetric = normalizedScenePointToMeters(end, calibration);
  const dx = endMetric.xM - startMetric.xM;
  const dy = endMetric.yM - startMetric.yM;
  const distanceM = Math.hypot(dx, dy);
  return {
    startTimeMs,
    endTimeMs,
    durationSeconds,
    distanceM,
    speedMps: distanceM / durationSeconds,
    courseDeg: distanceM <= GEOMETRY_EPSILON_M ? null : compassHeadingDegrees(dx, dy),
  };
}

/**
 * Compares each linked actor's authored trajectory on either side of an impact.
 * A marker inside one uninterrupted segment is still reported, but
 * authoredImpactKeyframe remains false so the UI can distinguish interpolation
 * from an explicitly authored transition. Markers outside the timed path return
 * no adjacent legs rather than deriving motion from a clamped endpoint pose.
 */
export function analyzeImpactAdjacentPaths(
  replayCase: ReplayCase,
  eventId: string,
  calibration: SceneMetricCalibration = createSceneMetricCalibration({
    sceneBounds: replayCase.environment.bounds,
    widthMeters: replayCase.environment.calibration.widthMeters,
    heightMeters: replayCase.environment.calibration.heightMeters,
  }),
): ImpactAdjacentPathAnalysis[] {
  const event = replayCase.timelineEvents.find((candidate) => candidate.id === eventId);
  if (!event) throw new RangeError(`Unknown timeline event ${eventId}`);
  if (event.type !== "impact") throw new RangeError(`Timeline event ${eventId} is not an impact`);
  return [...new Set(event.linkedActorIds)].map((actorId) => {
    const trajectory = getBranchTrajectory(replayCase, event.branchId, actorId);
    if (!trajectory || trajectory.keyframes.length === 0) {
      return {
        eventId: event.id,
        timeMs: event.timeMs,
        actorId,
        trajectoryId: null,
        authoredImpactKeyframe: false,
        incoming: null,
        outgoing: null,
        speedChangeMps: null,
        courseChangeDeg: null,
      };
    }
    const first = trajectory.keyframes[0];
    const last = trajectory.keyframes.at(-1);
    const withinTrajectoryCoverage =
      first !== undefined &&
      last !== undefined &&
      event.timeMs >= first.timeMs &&
      event.timeMs <= last.timeMs;
    const impactPose = withinTrajectoryCoverage
      ? getActorPoseAtTime(replayCase, actorId, event.timeMs, event.branchId)
      : undefined;
    const previous = trajectory.keyframes
      .filter((keyframe) => keyframe.timeMs < event.timeMs)
      .at(-1);
    const next = trajectory.keyframes.find((keyframe) => keyframe.timeMs > event.timeMs);
    const incoming =
      previous && impactPose
        ? impactAdjacentPathLeg(previous, previous.timeMs, impactPose, event.timeMs, calibration)
        : null;
    const outgoing =
      next && impactPose
        ? impactAdjacentPathLeg(impactPose, event.timeMs, next, next.timeMs, calibration)
        : null;
    return {
      eventId: event.id,
      timeMs: event.timeMs,
      actorId,
      trajectoryId: trajectory.id,
      authoredImpactKeyframe: trajectory.keyframes.some(
        (keyframe) => keyframe.timeMs === event.timeMs,
      ),
      incoming,
      outgoing,
      speedChangeMps: incoming && outgoing ? outgoing.speedMps - incoming.speedMps : null,
      courseChangeDeg:
        incoming?.courseDeg !== null &&
        incoming?.courseDeg !== undefined &&
        outgoing?.courseDeg !== null &&
        outgoing?.courseDeg !== undefined
          ? shortestSignedAngleDegrees(incoming.courseDeg, outgoing.courseDeg)
          : null,
    };
  });
}

export interface BranchMotionAnalysis {
  branchId: string;
  calibration: SceneMetricCalibration;
  thresholds: MotionAdvisoryThresholds;
  trajectories: TrajectoryMotionSummary[];
  advisories: MotionAdvisory[];
  impactFootprints: BranchImpactFootprintAnalysis[];
  impactAdjacentPaths: ImpactAdjacentPathAnalysis[];
  totals: {
    trajectoryCount: number;
    segmentCount: number;
    advisoryCount: number;
    impactPairCount: number;
    overlappingImpactPairCount: number;
  };
}

export type BranchMotionAnalysisOptions = TrajectoryMotionAnalysisOptions;

/**
 * Produces a compact, reproducible branch summary. It reports supplied-threshold
 * advisories and footprint geometry; it does not decide whether a reconstruction
 * is true, physically impossible, or attributable to either participant.
 */
export function analyzeBranchMotion(
  replayCase: ReplayCase,
  branchId: string,
  options: BranchMotionAnalysisOptions = {},
): BranchMotionAnalysis {
  const branch = replayCase.branches.find((candidate) => candidate.id === branchId);
  if (!branch) throw new RangeError(`Unknown branch ${branchId}`);
  const calibration =
    options.calibration ??
    createSceneMetricCalibration({
      sceneBounds: replayCase.environment.bounds,
      widthMeters: replayCase.environment.calibration.widthMeters,
      heightMeters: replayCase.environment.calibration.heightMeters,
    });
  const thresholds = { ...(options.thresholds ?? {}) };
  validateThresholds(thresholds);
  const trajectoryAnalyses = replayCase.trajectories
    .filter(
      (trajectory) =>
        trajectory.branchId === branchId && branch.trajectoryIds.includes(trajectory.id),
    )
    .sort(
      (left, right) => left.actorId.localeCompare(right.actorId) || left.id.localeCompare(right.id),
    )
    .map((trajectory) => analyzeTrajectoryMotion(trajectory, { calibration, thresholds }));
  const advisories = trajectoryAnalyses.flatMap((analysis) => analysis.advisories);
  const impactFootprints: BranchImpactFootprintAnalysis[] = [];
  const impactAdjacentPaths: ImpactAdjacentPathAnalysis[] = [];
  const impactEvents = replayCase.timelineEvents
    .filter(
      (event) =>
        event.branchId === branchId &&
        branch.eventIds.includes(event.id) &&
        event.type === "impact",
    )
    .sort((left, right) => left.timeMs - right.timeMs || left.id.localeCompare(right.id));

  for (const event of impactEvents) {
    impactAdjacentPaths.push(...analyzeImpactAdjacentPaths(replayCase, event.id, calibration));
    const linkedActorIds = [...new Set(event.linkedActorIds)];
    for (let firstIndex = 0; firstIndex < linkedActorIds.length - 1; firstIndex += 1) {
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < linkedActorIds.length;
        secondIndex += 1
      ) {
        const firstId = linkedActorIds[firstIndex];
        const secondId = linkedActorIds[secondIndex];
        if (!firstId || !secondId) continue;
        const firstActor = replayCase.actors.find((actor) => actor.id === firstId);
        const secondActor = replayCase.actors.find((actor) => actor.id === secondId);
        const firstPose = getActorPoseAtTime(replayCase, firstId, event.timeMs, branchId);
        const secondPose = getActorPoseAtTime(replayCase, secondId, event.timeMs, branchId);
        if (!firstActor || !secondActor || !firstPose || !secondPose) continue;
        impactFootprints.push({
          eventId: event.id,
          timeMs: event.timeMs,
          actorIds: [firstId, secondId],
          ...analyzeVehicleFootprintRelation(
            { pose: firstPose, dimensions: firstActor.dimensions },
            { pose: secondPose, dimensions: secondActor.dimensions },
            calibration,
          ),
        });
      }
    }
  }

  return {
    branchId,
    calibration: createSceneMetricCalibration(calibration),
    thresholds,
    trajectories: trajectoryAnalyses.map((analysis) => analysis.summary),
    advisories,
    impactFootprints,
    impactAdjacentPaths,
    totals: {
      trajectoryCount: trajectoryAnalyses.length,
      segmentCount: trajectoryAnalyses.reduce(
        (total, analysis) => total + analysis.summary.segmentCount,
        0,
      ),
      advisoryCount: advisories.length,
      impactPairCount: impactFootprints.length,
      overlappingImpactPairCount: impactFootprints.filter((impact) => impact.overlaps).length,
    },
  };
}
