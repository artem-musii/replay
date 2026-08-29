import { getActorPoseAtTime, interpolateTrajectory, pointInPolygon } from "./interpolation";
import { containsLiabilityConclusion } from "./languageSafety";
import { findCurrentCompletenessAttestation } from "./completeness";
import {
  agentObservationSourceRequirement,
  compatibleAgentObservationSourceIds,
  isExternallyAttributedClaimSourceType,
} from "./claimProvenance";
import type {
  ActorPose,
  ConsistencyIssue,
  ConsistencyScope,
  DamageRegion,
  Point,
  ReplayCase,
  ReportPreview,
  SceneActor,
  TimelineEvent,
  Trajectory,
} from "./models";
import {
  analyzeImpactAdjacentPaths,
  analyzeTrajectoryMotion,
  analyzeVehicleFootprintRelation,
  createOrientedVehicleFootprint,
  createSceneMetricCalibration,
  impactPenetrationToleranceMeters,
  impactSeparationToleranceMeters,
  normalizedSceneDistanceMeters,
  normalizedScenePointToMeters,
  type MetricPoint,
  type MotionAdvisory,
  type MotionAdvisoryThresholds,
  type OrientedVehicleFootprint,
  type SceneMetricCalibration,
} from "./physics";
import { validWorkspaceCitationPaths } from "./report";
import { getRoadTemplate, isPointOnTemplateRoad } from "./roadTemplates";

export type ConsistencyValidationScope =
  | "all"
  | "scene"
  | "timeline"
  | "geometry"
  | "motion"
  | "damage"
  | "integrity"
  | "provenance"
  | "completeness"
  | "report";

export interface ConsistencyValidationOptions {
  scope?: ConsistencyValidationScope;
  branchId?: string;
}

const severityOrder: Record<ConsistencyIssue["severity"], number> = {
  error: 0,
  warning: 1,
  question: 2,
};

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function issue(
  ruleId: string,
  scope: ConsistencyScope,
  severity: ConsistencyIssue["severity"],
  title: string,
  explanation: string,
  affectedIds: string[],
  suggestedActions: string[],
): ConsistencyIssue {
  const stableAffectedIds = [...new Set(affectedIds)].sort();
  const suffix = stableAffectedIds.length > 0 ? stableAffectedIds.join("|") : "case";
  return {
    id: `issue-${ruleId}-${stableHash(suffix)}`.replace(/[^a-zA-Z0-9_-]/g, "-"),
    ruleId,
    scope,
    severity,
    title,
    explanation,
    affectedIds: stableAffectedIds.slice(0, 5_000),
    suggestedActions,
  };
}

function branchEvents(replayCase: ReplayCase, branchId: string): TimelineEvent[] {
  const branch = replayCase.branches.find((candidate) => candidate.id === branchId);
  if (!branch) return [];
  return replayCase.timelineEvents
    .filter((event) => event.branchId === branchId && branch.eventIds.includes(event.id))
    .sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id));
}

function timelineIssues(replayCase: ReplayCase, branchIds: string[]): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  for (const branchId of branchIds) {
    const events = branchEvents(replayCase, branchId);
    for (const event of events) {
      if (
        event.timeMs < replayCase.timeRangeMs.start ||
        event.timeMs > replayCase.timeRangeMs.end
      ) {
        issues.push(
          issue(
            "timeline.event-out-of-range",
            "timeline",
            "error",
            "Timeline event is outside the case range",
            `“${event.title}” occurs at ${String(event.timeMs)} ms, outside the configured incident range.`,
            [branchId, event.id],
            ["Move the event inside the incident range", "Extend the reviewed incident range"],
          ),
        );
      }
    }

    const impacts = events.filter((event) => event.type === "impact");
    if (impacts.length > 1) {
      issues.push(
        issue(
          "timeline.duplicate-impact",
          "timeline",
          "warning",
          "Multiple impact events are present",
          "This branch contains more than one impact marker. Confirm whether these represent separate contacts.",
          [branchId, ...impacts.map((event) => event.id)],
          ["Keep the reviewed impact event", "Rename genuine separate contacts clearly"],
        ),
      );
    }
    for (const impact of impacts) {
      if (new Set(impact.linkedActorIds).size >= 2) continue;
      issues.push(
        issue(
          "timeline.impact-actors-incomplete",
          "timeline",
          "question",
          "Impact does not identify both vehicles",
          `“${impact.title}” links fewer than two distinct vehicles. REPLAY needs both vehicle links before it can compare footprint contact or authored motion around this marker. This is missing structure, not evidence that contact did or did not occur.`,
          [branchId, impact.id, ...impact.linkedActorIds],
          ["Link both involved vehicles", "Keep the event unresolved until they are identified"],
        ),
      );
    }

    for (const actor of replayCase.actors) {
      const actorEvents = events.filter((event) => event.linkedActorIds.includes(actor.id));
      const starts = actorEvents.filter((event) => event.type === "actor-start");
      const stops = actorEvents.filter((event) => event.type === "actor-stop");
      if (starts.length === 0) {
        issues.push(
          issue(
            "timeline.actor-start-missing",
            "timeline",
            "warning",
            "Actor start event is missing",
            `${actor.label} has no start event in this branch.`,
            [branchId, actor.id],
            ["Add an approximate actor start event"],
          ),
        );
      }
      if (stops.length === 0) {
        issues.push(
          issue(
            "timeline.actor-stop-missing",
            "timeline",
            "warning",
            "Actor final-position event is missing",
            `${actor.label} has no final-position event in this branch.`,
            [branchId, actor.id],
            ["Add an actor stop or final-position event"],
          ),
        );
      }

      for (const impact of impacts.filter((event) => event.linkedActorIds.includes(actor.id))) {
        if (!starts.some((start) => start.timeMs < impact.timeMs)) {
          issues.push(
            issue(
              "timeline.impact-before-start",
              "timeline",
              "error",
              "Impact does not follow actor start",
              `${actor.label} has no start event before the impact.`,
              [branchId, actor.id, impact.id],
              ["Move the impact after the actor start", "Add the missing start event"],
            ),
          );
        }
        if (!stops.some((stop) => stop.timeMs > impact.timeMs)) {
          issues.push(
            issue(
              "timeline.final-before-impact",
              "timeline",
              "error",
              "Final position does not follow impact",
              `${actor.label} has no final-position event after the impact.`,
              [branchId, actor.id, impact.id],
              [
                "Move the final-position event after impact",
                "Add the missing final-position event",
              ],
            ),
          );
        }
      }

      const firstStart = starts[0];
      const lastStop = stops[stops.length - 1];
      if (firstStart && lastStop && firstStart.timeMs >= lastStop.timeMs) {
        issues.push(
          issue(
            "timeline.invalid-actor-order",
            "timeline",
            "error",
            "Actor event order is invalid",
            `${actor.label} stops before or at its start time.`,
            [branchId, actor.id, firstStart.id, lastStop.id],
            ["Put actor events into chronological order"],
          ),
        );
      }
    }
  }
  return issues;
}

const FOOTPRINT_SAMPLE_SPACING_M = 0.5;
const SWEEP_SAMPLE_SPACING_M = 0.75;
const SWEEP_HEADING_STEP_DEG = 5;
const MAX_SWEEP_SAMPLES_PER_SEGMENT = 256;
const CONTACT_SWEEP_SPACING_M = 0.25;
const CONTACT_SWEEP_HEADING_STEP_DEG = 2;
const MAX_CONTACT_PAIR_SAMPLES = 4_096;
const CONTACT_PENETRATION_TOLERANCE_M = 0.1;
const UNMARKED_CONTACT_MIN_DURATION_MS = 50;
const CONTACT_ADJACENT_SAMPLE_OFFSETS_MS = [1, 10, 50] as const;
const SPEED_REVIEW_BUFFER = 1.35;

interface MotionAdvisoryContext {
  thresholds: MotionAdvisoryThresholds;
  referenceSpeedLimitKph: number;
  speedLimitSource: "posted" | "template-default";
  roadCondition: ReplayCase["environment"]["roadCondition"];
}

const roadConditionMotionEnvelope = {
  dry: {
    maxAccelerationMps2: 5,
    maxDecelerationMps2: 9,
    maxLateralAccelerationMps2: 6,
  },
  wet: {
    maxAccelerationMps2: 4,
    maxDecelerationMps2: 7,
    maxLateralAccelerationMps2: 4,
  },
  unknown: {
    maxAccelerationMps2: 4.5,
    maxDecelerationMps2: 8,
    maxLateralAccelerationMps2: 5,
  },
} as const satisfies Record<
  ReplayCase["environment"]["roadCondition"],
  Pick<
    Required<MotionAdvisoryThresholds>,
    "maxAccelerationMps2" | "maxDecelerationMps2" | "maxLateralAccelerationMps2"
  >
>;

function metricCalibrationForCase(replayCase: ReplayCase): SceneMetricCalibration {
  return createSceneMetricCalibration({
    sceneBounds: replayCase.environment.bounds,
    widthMeters: replayCase.environment.calibration.widthMeters,
    heightMeters: replayCase.environment.calibration.heightMeters,
  });
}

function motionAdvisoryContextForCase(
  replayCase: ReplayCase,
  actor: SceneActor,
): MotionAdvisoryContext {
  const template = getRoadTemplate(replayCase.environment.sceneType);
  const hasPostedLimit = replayCase.environment.postedSpeedLimitKph !== undefined;
  const referenceSpeedLimitKph =
    replayCase.environment.postedSpeedLimitKph ?? template.defaultSpeedLimitKph;
  const conditionEnvelope = roadConditionMotionEnvelope[replayCase.environment.roadCondition];
  const suppliedWheelbase = actor.wheelbaseMeters;
  const effectiveWheelbaseM =
    suppliedWheelbase !== undefined && Number.isFinite(suppliedWheelbase) && suppliedWheelbase > 0
      ? suppliedWheelbase
      : actor.dimensions.length * 0.6;

  return {
    referenceSpeedLimitKph,
    speedLimitSource: hasPostedLimit ? "posted" : "template-default",
    roadCondition: replayCase.environment.roadCondition,
    thresholds: {
      // Speed limits are a legal/context signal, not a physical maximum. The
      // 35% buffer deliberately makes this a conservative review trigger.
      maxSpeedMps: (referenceSpeedLimitKph / 3.6) * SPEED_REVIEW_BUFFER,
      ...conditionEnvelope,
      maxYawRateDegPerSecond: replayCase.environment.sceneType === "parking-area" ? 120 : 90,
      maxHeadingMismatchDeg: 25,
      // A 40 degree steering envelope is intentionally generous. Manufacturer
      // data can replace this derived review threshold when available.
      minTurnRadiusM: Math.max(1.5, effectiveWheelbaseM / Math.tan((40 * Math.PI) / 180)),
    },
  };
}

/**
 * Returns the exact deterministic motion-review profile used by consistency
 * validation. These thresholds surface cases for human review; they are not
 * forensic limits and do not establish how a vehicle actually moved.
 */
export function motionAdvisoryThresholdsForCase(
  replayCase: ReplayCase,
  actor: SceneActor,
): MotionAdvisoryThresholds {
  return { ...motionAdvisoryContextForCase(replayCase, actor).thresholds };
}

function metricPointToScene(point: MetricPoint, calibration: SceneMetricCalibration): Point {
  const sceneWidth = calibration.sceneBounds.maxX - calibration.sceneBounds.minX;
  const sceneHeight = calibration.sceneBounds.maxY - calibration.sceneBounds.minY;
  return {
    x: calibration.sceneBounds.minX + (point.xM / calibration.widthMeters) * sceneWidth,
    y: calibration.sceneBounds.minY + (point.yM / calibration.heightMeters) * sceneHeight,
  };
}

function scenePointToTemplate(replayCase: ReplayCase, point: Point): Point {
  const { bounds } = replayCase.environment;
  return {
    x: ((point.x - bounds.minX) / (bounds.maxX - bounds.minX)) * 100,
    y: ((point.y - bounds.minY) / (bounds.maxY - bounds.minY)) * 100,
  };
}

function pointOnSegment(point: Point, start: Point, end: Point): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const cross = Math.abs((point.x - start.x) * dy - (point.y - start.y) * dx);
  if (cross > Math.max(1, length) * 1e-8) return false;
  const projection = (point.x - start.x) * dx + (point.y - start.y) * dy;
  return projection >= -1e-8 && projection <= dx * dx + dy * dy + 1e-8;
}

function pointInPolygonInclusive(point: Point, polygon: Point[]): boolean {
  if (pointInPolygon(point, polygon)) return true;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (start && end && pointOnSegment(point, start, end)) return true;
  }
  return false;
}

function isPointOnConfiguredRoad(replayCase: ReplayCase, point: Point): boolean {
  const { bounds, roadPolygon, sceneType } = replayCase.environment;
  const coordinateTolerance = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 1e-9;
  if (
    point.x < bounds.minX - coordinateTolerance ||
    point.x > bounds.maxX + coordinateTolerance ||
    point.y < bounds.minY - coordinateTolerance ||
    point.y > bounds.maxY + coordinateTolerance
  ) {
    return false;
  }
  return (
    pointInPolygonInclusive(point, roadPolygon) &&
    isPointOnTemplateRoad(sceneType, scenePointToTemplate(replayCase, point))
  );
}

function footprintIsOnConfiguredRoad(
  replayCase: ReplayCase,
  footprint: OrientedVehicleFootprint,
  calibration: SceneMetricCalibration,
): boolean {
  const longitudinalSteps = Math.max(1, Math.ceil(footprint.lengthM / FOOTPRINT_SAMPLE_SPACING_M));
  const lateralSteps = Math.max(1, Math.ceil(footprint.widthM / FOOTPRINT_SAMPLE_SPACING_M));

  // The lattice covers corners, edges, and interior rather than treating a
  // vehicle as a point. Resolution stays below the built-in template surveys'
  // stated uncertainty and is deterministic across UI and WebMCP calls.
  for (let longitudinalIndex = 0; longitudinalIndex <= longitudinalSteps; longitudinalIndex += 1) {
    const forwardOffsetM =
      -footprint.lengthM / 2 + (footprint.lengthM * longitudinalIndex) / longitudinalSteps;
    for (let lateralIndex = 0; lateralIndex <= lateralSteps; lateralIndex += 1) {
      const rightOffsetM = -footprint.widthM / 2 + (footprint.widthM * lateralIndex) / lateralSteps;
      const metricPoint = {
        xM:
          footprint.center.xM +
          footprint.forwardAxis.xM * forwardOffsetM +
          footprint.rightAxis.xM * rightOffsetM,
        yM:
          footprint.center.yM +
          footprint.forwardAxis.yM * forwardOffsetM +
          footprint.rightAxis.yM * rightOffsetM,
      };
      if (!isPointOnConfiguredRoad(replayCase, metricPointToScene(metricPoint, calibration))) {
        return false;
      }
    }
  }
  return true;
}

function hasPositiveDimensions(actor: SceneActor): boolean {
  return (
    Number.isFinite(actor.dimensions.width) &&
    actor.dimensions.width > 0 &&
    Number.isFinite(actor.dimensions.length) &&
    actor.dimensions.length > 0
  );
}

function footprintForPose(
  actor: SceneActor,
  pose: ActorPose,
  calibration: SceneMetricCalibration,
): OrientedVehicleFootprint {
  return createOrientedVehicleFootprint(pose, actor.dimensions, calibration);
}

function shortestHeadingDifference(first: number, second: number): number {
  return Math.abs(((second - first + 540) % 360) - 180);
}

function estimatedSegmentTravelMeters(
  trajectory: Trajectory,
  startTimeMs: number,
  endTimeMs: number,
  calibration: SceneMetricCalibration,
): number {
  const estimateDivisions = 8;
  let distanceMeters = 0;
  let previous = interpolateTrajectory(trajectory, startTimeMs);
  for (let index = 1; index <= estimateDivisions; index += 1) {
    const sample = interpolateTrajectory(
      trajectory,
      startTimeMs + ((endTimeMs - startTimeMs) * index) / estimateDivisions,
    );
    distanceMeters += normalizedSceneDistanceMeters(previous, sample, calibration);
    previous = sample;
  }
  return distanceMeters;
}

function sweptFootprintLeavesRoad(
  replayCase: ReplayCase,
  actor: SceneActor,
  trajectory: Trajectory,
  fromIndex: number,
  calibration: SceneMetricCalibration,
): boolean {
  const from = trajectory.keyframes[fromIndex];
  const to = trajectory.keyframes[fromIndex + 1];
  if (!from || !to || to.timeMs <= from.timeMs) return false;
  const travelMeters = estimatedSegmentTravelMeters(
    trajectory,
    from.timeMs,
    to.timeMs,
    calibration,
  );
  const headingChange = shortestHeadingDifference(from.rotationDeg, to.rotationDeg);
  const sampleCount = Math.min(
    MAX_SWEEP_SAMPLES_PER_SEGMENT,
    Math.max(
      1,
      Math.ceil(travelMeters / SWEEP_SAMPLE_SPACING_M),
      Math.ceil(headingChange / SWEEP_HEADING_STEP_DEG),
    ),
  );

  for (let sampleIndex = 1; sampleIndex < sampleCount; sampleIndex += 1) {
    const pose = interpolateTrajectory(
      trajectory,
      from.timeMs + ((to.timeMs - from.timeMs) * sampleIndex) / sampleCount,
    );
    const footprint = footprintForPose(actor, pose, calibration);
    if (!footprintIsOnConfiguredRoad(replayCase, footprint, calibration)) return true;
  }
  return false;
}

function distanceFromPointToFootprint(
  point: MetricPoint,
  footprint: OrientedVehicleFootprint,
): number {
  const deltaX = point.xM - footprint.center.xM;
  const deltaY = point.yM - footprint.center.yM;
  const forwardDistance = Math.abs(
    deltaX * footprint.forwardAxis.xM + deltaY * footprint.forwardAxis.yM,
  );
  const rightDistance = Math.abs(deltaX * footprint.rightAxis.xM + deltaY * footprint.rightAxis.yM);
  return Math.hypot(
    Math.max(0, forwardDistance - footprint.lengthM / 2),
    Math.max(0, rightDistance - footprint.widthM / 2),
  );
}

function cappedSortedTimes(times: Set<number>): number[] {
  const sorted = [...times].sort((first, second) => first - second);
  if (sorted.length <= MAX_CONTACT_PAIR_SAMPLES) return sorted;
  const capped = new Set<number>();
  for (let index = 0; index < MAX_CONTACT_PAIR_SAMPLES; index += 1) {
    const sourceIndex = Math.round(
      (index * (sorted.length - 1)) / Math.max(1, MAX_CONTACT_PAIR_SAMPLES - 1),
    );
    const timeMs = sorted[sourceIndex];
    if (timeMs !== undefined) capped.add(timeMs);
  }
  return [...capped].sort((first, second) => first - second);
}

function pairContactScanTimes(
  replayCase: ReplayCase,
  firstTrajectory: Trajectory | undefined,
  secondTrajectory: Trajectory | undefined,
  matchingImpacts: TimelineEvent[],
  calibration: SceneMetricCalibration,
): number[] {
  const { start, end } = replayCase.timeRangeMs;
  const boundaries = new Set<number>([start, end]);
  for (const trajectory of [firstTrajectory, secondTrajectory]) {
    if (!trajectory) continue;
    for (const keyframe of trajectory.keyframes) {
      if (keyframe.timeMs >= start && keyframe.timeMs <= end) boundaries.add(keyframe.timeMs);
    }
  }
  for (const event of matchingImpacts) {
    boundaries.add(event.timeMs);
    for (const offsetMs of CONTACT_ADJACENT_SAMPLE_OFFSETS_MS) {
      boundaries.add(Math.max(start, event.timeMs - offsetMs));
      boundaries.add(Math.min(end, event.timeMs + offsetMs));
    }
  }

  const orderedBoundaries = [...boundaries]
    .filter((timeMs) => timeMs >= start && timeMs <= end)
    .sort((first, second) => first - second);
  const times = new Set(orderedBoundaries);
  for (let index = 0; index < orderedBoundaries.length - 1; index += 1) {
    const fromTimeMs = orderedBoundaries[index];
    const toTimeMs = orderedBoundaries[index + 1];
    if (fromTimeMs === undefined || toTimeMs === undefined || toTimeMs <= fromTimeMs) continue;
    const firstTravelM = firstTrajectory
      ? estimatedSegmentTravelMeters(firstTrajectory, fromTimeMs, toTimeMs, calibration)
      : 0;
    const secondTravelM = secondTrajectory
      ? estimatedSegmentTravelMeters(secondTrajectory, fromTimeMs, toTimeMs, calibration)
      : 0;
    const firstHeadingChange = firstTrajectory
      ? shortestHeadingDifference(
          interpolateTrajectory(firstTrajectory, fromTimeMs).rotationDeg,
          interpolateTrajectory(firstTrajectory, toTimeMs).rotationDeg,
        )
      : 0;
    const secondHeadingChange = secondTrajectory
      ? shortestHeadingDifference(
          interpolateTrajectory(secondTrajectory, fromTimeMs).rotationDeg,
          interpolateTrajectory(secondTrajectory, toTimeMs).rotationDeg,
        )
      : 0;
    const divisions = Math.min(
      MAX_SWEEP_SAMPLES_PER_SEGMENT,
      Math.max(
        1,
        Math.ceil((firstTravelM + secondTravelM) / CONTACT_SWEEP_SPACING_M),
        Math.ceil((firstHeadingChange + secondHeadingChange) / CONTACT_SWEEP_HEADING_STEP_DEG),
      ),
    );
    for (let division = 1; division < divisions; division += 1) {
      times.add(fromTimeMs + ((toTimeMs - fromTimeMs) * division) / divisions);
    }
  }
  return cappedSortedTimes(times);
}

function unmarkedFootprintOverlapIssues(
  replayCase: ReplayCase,
  branchId: string,
  calibration: SceneMetricCalibration,
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const actors = replayCase.actors.filter(hasPositiveDimensions);
  const impacts = branchEvents(replayCase, branchId).filter((event) => event.type === "impact");
  const branch = replayCase.branches.find((candidate) => candidate.id === branchId);
  const trajectoryByActor = new Map<string, Trajectory>();
  if (branch) {
    const trajectoryIds = new Set(branch.trajectoryIds);
    for (const trajectory of replayCase.trajectories) {
      if (trajectory.branchId === branchId && trajectoryIds.has(trajectory.id)) {
        trajectoryByActor.set(trajectory.actorId, trajectory);
      }
    }
  }

  for (let firstIndex = 0; firstIndex < actors.length - 1; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < actors.length; secondIndex += 1) {
      const first = actors[firstIndex];
      const second = actors[secondIndex];
      if (!first || !second) continue;
      const matchingImpacts = impacts.filter(
        (event) =>
          event.linkedActorIds.includes(first.id) && event.linkedActorIds.includes(second.id),
      );
      const firstTrajectory = trajectoryByActor.get(first.id);
      const secondTrajectory = trajectoryByActor.get(second.id);
      const sampleTimes = pairContactScanTimes(
        replayCase,
        firstTrajectory,
        secondTrajectory,
        matchingImpacts,
        calibration,
      );
      const recordedContactTimes = new Set(matchingImpacts.map((event) => event.timeMs));
      let firstUnmarkedTimeMs: number | undefined;
      let lastUnmarkedTimeMs: number | undefined;
      let maximumPenetrationM = 0;
      let currentTouchStartMs: number | undefined;
      let currentTouchEndMs: number | undefined;
      let longestTouchStartMs: number | undefined;
      let longestTouchEndMs: number | undefined;

      const finishTouchRun = () => {
        if (currentTouchStartMs === undefined || currentTouchEndMs === undefined) return;
        const currentDuration = currentTouchEndMs - currentTouchStartMs;
        const longestDuration =
          longestTouchStartMs === undefined || longestTouchEndMs === undefined
            ? -1
            : longestTouchEndMs - longestTouchStartMs;
        if (currentDuration > longestDuration) {
          longestTouchStartMs = currentTouchStartMs;
          longestTouchEndMs = currentTouchEndMs;
        }
        currentTouchStartMs = undefined;
        currentTouchEndMs = undefined;
      };

      for (const timeMs of sampleTimes) {
        if (recordedContactTimes.has(timeMs)) {
          finishTouchRun();
          continue;
        }
        const firstPose = firstTrajectory
          ? interpolateTrajectory(firstTrajectory, timeMs)
          : first.pose;
        const secondPose = secondTrajectory
          ? interpolateTrajectory(secondTrajectory, timeMs)
          : second.pose;
        const relation = analyzeVehicleFootprintRelation(
          { pose: firstPose, dimensions: first.dimensions },
          { pose: secondPose, dimensions: second.dimensions },
          calibration,
        );
        if (relation.overlaps) {
          currentTouchStartMs ??= timeMs;
          currentTouchEndMs = timeMs;
        } else {
          finishTouchRun();
        }
        if (!relation.overlaps || relation.penetrationDepthM <= CONTACT_PENETRATION_TOLERANCE_M) {
          continue;
        }
        firstUnmarkedTimeMs ??= timeMs;
        lastUnmarkedTimeMs = timeMs;
        maximumPenetrationM = Math.max(maximumPenetrationM, relation.penetrationDepthM);
      }
      finishTouchRun();

      if (firstUnmarkedTimeMs !== undefined && lastUnmarkedTimeMs !== undefined) {
        const timeDescription =
          firstUnmarkedTimeMs === lastUnmarkedTimeMs
            ? `${(firstUnmarkedTimeMs / 1_000).toFixed(3)} s`
            : `${(firstUnmarkedTimeMs / 1_000).toFixed(3)}–${(lastUnmarkedTimeMs / 1_000).toFixed(3)} s`;
        issues.push(
          issue(
            "geometry.unmarked-footprint-overlap",
            "geometry",
            "warning",
            "Vehicle footprints overlap outside a recorded contact instant",
            `${first.label} and ${second.label} have intersecting oriented footprints around ${timeDescription}, outside the exact timestamp of any impact event linked to both vehicles. The adaptive sweep targets no more than ${CONTACT_SWEEP_SPACING_M.toFixed(2)} m of combined travel or ${String(CONTACT_SWEEP_HEADING_STEP_DEG)}° of combined heading change between samples; its observed maximum overlap depth is ${maximumPenetrationM.toFixed(2)} m. This usually means the timed paths pass through one another or an impact event is missing; it is a deterministic geometry warning, not proof that physical contact occurred.`,
            [branchId, first.id, second.id],
            [
              "Correct the timed trajectories so the footprints do not pass through one another",
              "Add a source-supported contact event if a separate impact occurred",
              "Keep the conflict visibly unresolved if the source material is insufficient",
            ],
          ),
        );
        continue;
      }

      if (
        longestTouchStartMs !== undefined &&
        longestTouchEndMs !== undefined &&
        longestTouchEndMs - longestTouchStartMs >= UNMARKED_CONTACT_MIN_DURATION_MS
      ) {
        issues.push(
          issue(
            "geometry.unmarked-footprint-contact",
            "geometry",
            "warning",
            "Vehicle footprints remain in contact outside a recorded impact instant",
            `${first.label} and ${second.label} have touching oriented-footprint boundaries from approximately ${(longestTouchStartMs / 1_000).toFixed(3)}–${(longestTouchEndMs / 1_000).toFixed(3)} s without a linked impact at those timestamps. Sustained boundary contact can indicate that one path slides along another vehicle or that a separate contact event is missing; it is a deterministic geometry warning, not proof that physical contact occurred.`,
            [branchId, first.id, second.id],
            [
              "Separate the timed footprints after the recorded impact",
              "Add a source-supported contact event if sustained contact was reported",
              "Preserve the uncertainty if the available evidence cannot resolve it",
            ],
          ),
        );
      }
    }
  }
  return issues;
}

function geometryIssues(replayCase: ReplayCase, branchIds: string[]): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const actorIds = new Set(replayCase.actors.map((actor) => actor.id));
  const knownBranchIds = new Set(replayCase.branches.map((branch) => branch.id));
  const calibration = metricCalibrationForCase(replayCase);
  const actorsById = new Map(replayCase.actors.map((actor) => [actor.id, actor]));

  for (const actor of replayCase.actors) {
    const validDimensions = hasPositiveDimensions(actor);
    if (!validDimensions) {
      issues.push(
        issue(
          "geometry.invalid-actor-dimensions",
          "geometry",
          "error",
          "Actor dimensions are invalid",
          `${actor.label} must have positive width and length.`,
          [actor.id],
          ["Set realistic positive vehicle dimensions"],
        ),
      );
    }
    if (
      validDimensions &&
      !footprintIsOnConfiguredRoad(
        replayCase,
        footprintForPose(actor, actor.pose, calibration),
        calibration,
      )
    ) {
      issues.push(
        issue(
          "geometry.actor-outside-scene",
          "geometry",
          "warning",
          "Vehicle footprint is outside the road scene",
          `${actor.label}’s full ${actor.dimensions.length.toFixed(1)} m × ${actor.dimensions.width.toFixed(1)} m oriented footprint is not contained by the configured ${replayCase.environment.sceneType} road area. The check uses a ${FOOTPRINT_SAMPLE_SPACING_M.toFixed(2)} m footprint lattice and is a geometry review aid, not map-survey evidence.`,
          [actor.id],
          [
            "Move the full vehicle footprint onto the road",
            "Review the scene calibration and road template",
            "Preserve the discrepancy if the source material supports it",
          ],
        ),
      );
    }
  }

  for (const trajectory of replayCase.trajectories.filter((item) =>
    branchIds.includes(item.branchId),
  )) {
    if (!actorIds.has(trajectory.actorId) || !knownBranchIds.has(trajectory.branchId)) {
      issues.push(
        issue(
          "geometry.dangling-trajectory-reference",
          "geometry",
          "error",
          "Trajectory references a missing object",
          "The trajectory’s actor or branch no longer exists.",
          [trajectory.id, trajectory.actorId, trajectory.branchId],
          ["Relink the trajectory", "Remove the invalid trajectory"],
        ),
      );
    }
    const actor = actorsById.get(trajectory.actorId);
    for (const keyframe of trajectory.keyframes) {
      if (
        actor &&
        hasPositiveDimensions(actor) &&
        !footprintIsOnConfiguredRoad(
          replayCase,
          footprintForPose(actor, keyframe, calibration),
          calibration,
        )
      ) {
        issues.push(
          issue(
            "geometry.keyframe-outside-scene",
            "geometry",
            "warning",
            "Trajectory footprint leaves the road scene",
            `The full oriented footprint for ${actor.label} at a keyframe is not contained by the configured ${replayCase.environment.sceneType} road area. This is a deterministic template check, not map-survey or forensic evidence.`,
            [trajectory.branchId, trajectory.id, actor.id, keyframe.id],
            [
              "Move the full vehicle footprint onto the road",
              "Review the scene calibration or template",
              "Keep intentional off-road placement explicitly unresolved",
            ],
          ),
        );
      }
    }
    for (let index = 1; index < trajectory.keyframes.length; index += 1) {
      const previous = trajectory.keyframes[index - 1];
      const current = trajectory.keyframes[index];
      if (!previous || !current) continue;
      const elapsedSeconds = (current.timeMs - previous.timeMs) / 1_000;
      const speedMps =
        elapsedSeconds > 0
          ? normalizedSceneDistanceMeters(previous, current, calibration) / elapsedSeconds
          : Infinity;
      const continuityThresholdMps = actor
        ? (motionAdvisoryThresholdsForCase(replayCase, actor).maxSpeedMps ?? 55) * 4
        : 220;
      if (!Number.isFinite(speedMps) || speedMps > continuityThresholdMps) {
        issues.push(
          issue(
            "geometry.trajectory-teleport",
            "geometry",
            "error",
            "Trajectory contains an abrupt jump",
            `Adjacent keyframes imply ${Number.isFinite(speedMps) ? `${speedMps.toFixed(1)} m/s` : "an infinite speed"} after applying the ${calibration.widthMeters.toFixed(1)} m × ${calibration.heightMeters.toFixed(1)} m scene calibration. The structural continuity threshold is ${continuityThresholdMps.toFixed(1)} m/s (four times the conservative motion-review speed threshold); this is not a forensic conclusion.`,
            [trajectory.id, previous.id, current.id],
            ["Add an intermediate keyframe", "Correct the keyframe time or position"],
          ),
        );
      }

      if (
        actor &&
        hasPositiveDimensions(actor) &&
        sweptFootprintLeavesRoad(replayCase, actor, trajectory, index - 1, calibration)
      ) {
        issues.push(
          issue(
            "geometry.trajectory-footprint-off-road",
            "geometry",
            "warning",
            "Swept vehicle footprint leaves the road",
            `${actor.label}’s interpolated full footprint leaves the configured ${replayCase.environment.sceneType} road area between adjacent keyframes. The deterministic sweep targets intervals no greater than ${SWEEP_SAMPLE_SPACING_M.toFixed(2)} m or ${String(SWEEP_HEADING_STEP_DEG)}°, with a transparent ${String(MAX_SWEEP_SAMPLES_PER_SEGMENT)}-sample per-segment safety cap, and samples each footprint at no more than ${FOOTPRINT_SAMPLE_SPACING_M.toFixed(2)} m; it is a review aid, not forensic truth.`,
            [trajectory.branchId, trajectory.id, actor.id, previous.id, current.id],
            [
              "Add source-supported intermediate keyframes",
              "Review the road template and calibration",
              "Keep uncertainty visible if the exact path is unknown",
            ],
          ),
        );
      }
    }
  }

  for (const branchId of branchIds) {
    issues.push(...unmarkedFootprintOverlapIssues(replayCase, branchId, calibration));
    const impacts = branchEvents(replayCase, branchId).filter((event) => event.type === "impact");
    for (const impact of impacts) {
      const linkedActors = [...new Set(impact.linkedActorIds)]
        .map((actorId) => replayCase.actors.find((actor) => actor.id === actorId))
        .filter((actor): actor is ReplayCase["actors"][number] => Boolean(actor));
      if (linkedActors.length >= 2) {
        for (let firstIndex = 0; firstIndex < linkedActors.length - 1; firstIndex += 1) {
          for (
            let secondIndex = firstIndex + 1;
            secondIndex < linkedActors.length;
            secondIndex += 1
          ) {
            const first = linkedActors[firstIndex];
            const second = linkedActors[secondIndex];
            if (
              !first ||
              !second ||
              !hasPositiveDimensions(first) ||
              !hasPositiveDimensions(second)
            ) {
              continue;
            }
            const firstPose = getActorPoseAtTime(replayCase, first.id, impact.timeMs, branchId);
            const secondPose = getActorPoseAtTime(replayCase, second.id, impact.timeMs, branchId);
            if (!firstPose || !secondPose) continue;
            const relation = analyzeVehicleFootprintRelation(
              { pose: firstPose, dimensions: first.dimensions },
              { pose: secondPose, dimensions: second.dimensions },
              calibration,
            );
            const calibrationToleranceM = impactSeparationToleranceMeters(
              replayCase.environment.calibration.uncertaintyMeters,
            );
            if (!relation.overlaps && relation.separationM > calibrationToleranceM) {
              issues.push(
                issue(
                  "geometry.impact-separation",
                  "geometry",
                  "warning",
                  "Vehicle footprints do not meet at the impact time",
                  `The ${first.dimensions.length.toFixed(1)} m × ${first.dimensions.width.toFixed(1)} m and ${second.dimensions.length.toFixed(1)} m × ${second.dimensions.width.toFixed(1)} m oriented vehicle footprints have a ${relation.separationM.toFixed(2)} m gap at the impact time. That exceeds the ${calibrationToleranceM.toFixed(2)} m calibration-uncertainty allowance (${replayCase.environment.calibration.source} source). This is a deterministic consistency review, not a forensic conclusion or proof that contact did not occur.`,
                  [branchId, impact.id, first.id, second.id],
                  [
                    "Review the impact timestamp",
                    "Adjust a trajectory",
                    "Keep the discrepancy explicitly unresolved",
                  ],
                ),
              );
            }
            const maximumReasonablePenetrationM = impactPenetrationToleranceMeters(
              first.dimensions,
              second.dimensions,
            );
            if (relation.overlaps && relation.penetrationDepthM > maximumReasonablePenetrationM) {
              issues.push(
                issue(
                  "geometry.impact-excessive-penetration",
                  "geometry",
                  "warning",
                  "Vehicle footprints interpenetrate too deeply at impact",
                  `At the recorded impact time, ${first.label} and ${second.label} overlap by ${relation.penetrationDepthM.toFixed(2)} m in the oriented-footprint model. That exceeds the ${maximumReasonablePenetrationM.toFixed(2)} m visual-contact allowance (10% of the narrower vehicle width, with a 0.15 m floor). Calibration uncertainty can move a possible pose; it does not make visible rigid-body interpenetration physically plausible. Timed reconstruction paths should meet at contact, not pass through each other; this remains a geometry advisory rather than a collision-dynamics conclusion.`,
                  [branchId, impact.id, first.id, second.id],
                  [
                    "Reduce the overlap at the impact keyframes",
                    "Review the impact timestamp and vehicle dimensions",
                    "Preserve the discrepancy if the source evidence requires it",
                  ],
                ),
              );
            }
          }
        }
      }

      if (impact.location) {
        for (const actor of linkedActors) {
          const pose = getActorPoseAtTime(replayCase, actor.id, impact.timeMs, branchId);
          if (!pose || !hasPositiveDimensions(actor)) continue;
          const footprint = footprintForPose(actor, pose, calibration);
          const markerGapM = distanceFromPointToFootprint(
            normalizedScenePointToMeters(impact.location, calibration),
            footprint,
          );
          const markerToleranceM = Math.max(
            0.5,
            replayCase.environment.calibration.uncertaintyMeters,
          );
          if (markerGapM > markerToleranceM) {
            issues.push(
              issue(
                "geometry.impact-marker-distance",
                "geometry",
                "warning",
                "Impact marker is not near a linked vehicle",
                `The impact marker is ${markerGapM.toFixed(2)} m outside ${actor.label}’s oriented footprint at the selected time, beyond the ${markerToleranceM.toFixed(2)} m calibration-uncertainty allowance. This is a review aid, not a forensic contact-location conclusion.`,
                [branchId, impact.id, actor.id],
                ["Move the impact marker", "Review the actor trajectory or timestamp"],
              ),
            );
          }
        }
      }
    }
  }
  return issues;
}

const motionIssueTitles: Record<MotionAdvisory["code"], string> = {
  "motion.speed": "Segment speed exceeds the review envelope",
  "motion.acceleration": "Acceleration exceeds the review envelope",
  "motion.deceleration": "Deceleration exceeds the review envelope",
  "motion.yaw-rate": "Heading changes unusually quickly",
  "motion.heading-mismatch": "Vehicle heading differs from travel direction",
  "motion.turn-radius": "Implied turn radius is unusually tight",
  "motion.lateral-acceleration": "Lateral acceleration exceeds the review envelope",
};

function motionIssues(replayCase: ReplayCase, branchIds: string[]): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const calibration = metricCalibrationForCase(replayCase);
  const actorsById = new Map(replayCase.actors.map((actor) => [actor.id, actor]));

  for (const trajectory of replayCase.trajectories.filter((item) =>
    branchIds.includes(item.branchId),
  )) {
    const actor = actorsById.get(trajectory.actorId);
    if (!actor || !hasPositiveDimensions(actor)) continue;
    const hasStrictlyIncreasingTimes = trajectory.keyframes.every(
      (keyframe, index) =>
        index === 0 || keyframe.timeMs > (trajectory.keyframes[index - 1]?.timeMs ?? 0),
    );
    if (!hasStrictlyIncreasingTimes) continue;

    const context = motionAdvisoryContextForCase(replayCase, actor);
    const analysis = analyzeTrajectoryMotion(trajectory, {
      calibration,
      thresholds: context.thresholds,
    });
    const speedSource =
      context.speedLimitSource === "posted"
        ? `posted ${context.referenceSpeedLimitKph.toFixed(0)} km/h limit`
        : `${context.referenceSpeedLimitKph.toFixed(0)} km/h ${replayCase.environment.sceneType} template default`;

    for (const advisory of analysis.advisories) {
      const isMinimum = advisory.code === "motion.turn-radius";
      const thresholdRelation = isMinimum ? "minimum review threshold" : "review threshold";
      issues.push(
        issue(
          advisory.code,
          "motion",
          "warning",
          motionIssueTitles[advisory.code],
          `${actor.label} implies ${advisory.observed.toFixed(2)} ${advisory.unit} between the cited keyframes; the ${thresholdRelation} is ${advisory.threshold.toFixed(2)} ${advisory.unit}. The exact deterministic profile uses the ${speedSource} with a ${Math.round((SPEED_REVIEW_BUFFER - 1) * 100)}% speed buffer, a ${context.roadCondition} road envelope (${String(context.thresholds.maxAccelerationMps2)} m/s² acceleration, ${String(context.thresholds.maxDecelerationMps2)} m/s² deceleration, ${String(context.thresholds.maxLateralAccelerationMps2)} m/s² lateral acceleration), and ${replayCase.environment.calibration.widthMeters.toFixed(1)} m × ${replayCase.environment.calibration.heightMeters.toFixed(1)} m ${replayCase.environment.calibration.source} scene calibration (±${replayCase.environment.calibration.uncertaintyMeters.toFixed(2)} m stated uncertainty). This is a deterministic review advisory, not a forensic finding, conclusion, or proof of actual motion.`,
          [
            trajectory.branchId,
            actor.id,
            trajectory.id,
            advisory.fromKeyframeId,
            advisory.toKeyframeId,
          ],
          [
            "Review keyframe positions and timing against source evidence",
            "Review vehicle dimensions, heading, and scene calibration",
            "Keep unsupported motion details explicitly uncertain",
          ],
        ),
      );
    }
  }

  for (const branchId of branchIds) {
    for (const impact of branchEvents(replayCase, branchId).filter(
      (event) => event.type === "impact",
    )) {
      for (const transition of analyzeImpactAdjacentPaths(replayCase, impact.id, calibration)) {
        const actor = actorsById.get(transition.actorId);
        if (!transition.trajectoryId) {
          issues.push(
            issue(
              "motion.impact-path-missing",
              "motion",
              "question",
              "Linked vehicle has no authored path at impact",
              `${actor?.label ?? transition.actorId} has no authored trajectory on this branch, so REPLAY cannot compare motion before and after the marker. Add timed positions only when source-supported; a missing path does not imply stationary motion or a collision response.`,
              [branchId, impact.id, transition.actorId],
              [
                "Add a source-supported trajectory for the linked vehicle",
                "Keep pre-impact and post-impact motion explicitly unresolved",
              ],
            ),
          );
          continue;
        }
        if (!transition.incoming || !transition.outgoing) {
          issues.push(
            issue(
              "motion.impact-path-coverage",
              "motion",
              "question",
              "Authored path does not cover both sides of impact",
              `${actor?.label ?? transition.actorId}'s path has no timed leg on both sides of ${(impact.timeMs / 1_000).toFixed(3)} s. Extend the path only if the available account supports positions before and after the marker. REPLAY does not infer the missing motion or a collision response.`,
              [branchId, impact.id, transition.actorId, transition.trajectoryId],
              [
                "Add source-supported timed positions on the missing side",
                "Keep the unavailable motion explicitly unresolved",
              ],
            ),
          );
          continue;
        }
        if (transition.authoredImpactKeyframe) continue;
        issues.push(
          issue(
            "motion.impact-between-keyframes",
            "motion",
            "question",
            "Impact time is between authored path points",
            `${actor?.label ?? transition.actorId}'s pose at ${(impact.timeMs / 1_000).toFixed(3)} s is interpolated inside one path segment. Add a timed pose at the impact marker if the incoming and outgoing path legs need to be reviewed or authored independently. This does not assume that contact must change motion and is not a collision-dynamics conclusion.`,
            [branchId, impact.id, transition.actorId, transition.trajectoryId],
            [
              "Add a source-supported path point at the impact time",
              "Keep the continuous interpolated segment if that matches the available account",
            ],
          ),
        );
      }
    }
  }
  return issues;
}

function integrityIssues(replayCase: ReplayCase): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const calibration = replayCase.environment.calibration;
  if (["template", "estimated", "unknown"].includes(calibration.source)) {
    issues.push(
      issue(
        "integrity.calibration-source",
        "integrity",
        "question",
        "Scene scale is not survey verified",
        `The ${calibration.widthMeters.toFixed(1)} m × ${calibration.heightMeters.toFixed(1)} m scene scale is labelled ${calibration.source} with ±${calibration.uncertaintyMeters.toFixed(2)} m stated uncertainty. Geometry and motion results remain review aids until a measured, surveyed, or scaled-map calibration is recorded.`,
        [replayCase.id],
        [
          "Record a measured, surveyed, or scaled-map calibration when available",
          "Keep the template or estimate and its uncertainty visible",
        ],
      ),
    );
  }
  if (calibration.uncertaintyMeters === 0 && calibration.source !== "measured") {
    issues.push(
      issue(
        "integrity.zero-calibration-uncertainty",
        "integrity",
        "question",
        "Calibration declares no uncertainty",
        `A ${calibration.source} calibration declares zero uncertainty. That precision may not match the recorded source and should be reviewed rather than treated as exact.`,
        [replayCase.id],
        ["Record a supported uncertainty value", "Document why zero uncertainty is appropriate"],
      ),
    );
  }

  const availableEvidence = replayCase.evidence.filter((asset) => !asset.deleted);
  for (const actor of replayCase.actors) {
    if (["template", "estimated", "unknown"].includes(actor.dimensionsSource)) {
      issues.push(
        issue(
          "integrity.vehicle-dimension-source",
          "integrity",
          "question",
          "Vehicle dimensions are not source verified",
          `${actor.label}'s ${actor.dimensions.length.toFixed(2)} m × ${actor.dimensions.width.toFixed(2)} m footprint is labelled ${actor.dimensionsSource}. Contact and road-clearance checks use it as an explicit assumption, not as measured evidence.`,
          [actor.id],
          [
            "Record measured or manufacturer dimensions when available",
            "Keep estimated dimensions and their source visibly labelled",
          ],
        ),
      );
    } else if (!availableEvidence.some((asset) => asset.linkedSceneObjectIds.includes(actor.id))) {
      issues.push(
        issue(
          "integrity.vehicle-dimension-evidence",
          "integrity",
          "question",
          "Vehicle dimension source is not linked",
          `${actor.label}'s dimensions are labelled ${actor.dimensionsSource}, but no available evidence record is linked to the vehicle. The label is preserved, but its supporting record is not inspectable in this case.`,
          [actor.id],
          [
            "Link the supporting specification or measurement record",
            "Relabel the dimensions as estimated",
          ],
        ),
      );
    }
    if (actor.lastEditedBy === "agent") {
      issues.push(
        issue(
          "integrity.agent-authored-actor-geometry",
          "integrity",
          "question",
          "Vehicle geometry was last edited by an agent",
          `${actor.label}'s position or specification is visibly agent-authored. It remains an attributable reconstruction input and has not become evidence or a confirmed fact.`,
          [actor.id],
          [
            "Review or correct the geometry in the human interface",
            "Keep the agent-authored input visibly unresolved",
          ],
        ),
      );
    }
  }

  for (const trajectory of replayCase.trajectories) {
    if (trajectory.createdBy === "agent" || trajectory.changeHistory.at(-1)?.author === "agent") {
      issues.push(
        issue(
          "integrity.agent-authored-trajectory",
          "integrity",
          "question",
          "Trajectory was last authored by an agent",
          "This path is visibly agent-authored geometry. Deterministic checks can test its internal consistency, but only source review and human action can accept, correct, or reject it.",
          [trajectory.branchId, trajectory.actorId, trajectory.id],
          [
            "Review the path against recorded sources",
            "Use a coordinated proposal for material multi-actor changes",
          ],
        ),
      );
    }
  }

  const importedActivity = replayCase.activity.filter(
    (activity) => activity.actionType === "case.imported-untrusted",
  );
  if (importedActivity.length > 0) {
    issues.push(
      issue(
        "integrity.unsigned-import",
        "integrity",
        "warning",
        "Case history came from an unsigned import",
        "This local case was opened from an unsigned structured export. REPLAY preserved its history as unverified, removed imported final snapshots, and requires fresh local human review. This detects an untrusted transfer boundary, not who changed it or why.",
        [replayCase.id, ...importedActivity.map((activity) => activity.id)],
        [
          "Review imported sources and claims locally",
          "Reconfirm eligible claims only after human review",
        ],
      ),
    );
  }

  const malformedEvidence = availableEvidence.filter(
    (asset) => !/^[a-f0-9]{64}$/i.test(asset.checksum),
  );
  if (malformedEvidence.length > 0) {
    issues.push(
      issue(
        "integrity.evidence-checksum-format",
        "integrity",
        "warning",
        "Evidence checksum is not a SHA-256 digest",
        "One or more available evidence records do not carry the expected 64-character SHA-256 digest. This is a local integrity-format check and does not authenticate the original content or its author.",
        malformedEvidence.map((asset) => asset.id),
        [
          "Re-add the source file to compute a local digest",
          "Keep origin and authenticity unresolved",
        ],
      ),
    );
  }

  const futureActivity = replayCase.activity.filter(
    (activity) => activity.caseVersion > replayCase.caseVersion,
  );
  if (futureActivity.length > 0) {
    issues.push(
      issue(
        "integrity.future-activity-version",
        "integrity",
        "error",
        "Activity version exceeds the case version",
        "The activity ledger contains an entry from a later case version than the open state. The record is internally inconsistent and should not be used for final reporting.",
        [replayCase.id, ...futureActivity.map((activity) => activity.id)],
        [
          "Restore a matching case revision",
          "Export the raw record for review before further edits",
        ],
      ),
    );
  }

  for (const claim of replayCase.claims.filter(
    (candidate) => candidate.status === "confirmed" && Boolean(candidate.confirmedAt),
  )) {
    const confirmedAt = claim.confirmedAt ?? "";
    const laterSubstantiveChange = claim.changeHistory.find(
      (change) => change.createdAt > confirmedAt && !/confirm/i.test(change.summary),
    );
    if (!laterSubstantiveChange) continue;
    issues.push(
      issue(
        "integrity.stale-claim-attestation",
        "integrity",
        "error",
        "Confirmed claim changed after attestation",
        "The claim has a substantive change record after its recorded human confirmation. It must return to review before it can appear as confirmed.",
        [claim.id, laterSubstantiveChange.id],
        ["Return the claim to reported", "Ask a human to review the changed content and sources"],
      ),
    );
  }

  const untrustedProposalIds = replayCase.proposals
    .filter(
      (proposal) =>
        proposal.revisions.some((revision) => !revision.authorshipTrusted) ||
        proposal.decision?.humanAttestationTrusted === false,
    )
    .map((proposal) => proposal.id);
  if (untrustedProposalIds.length > 0) {
    issues.push(
      issue(
        "integrity.untrusted-proposal-history",
        "integrity",
        "warning",
        "Proposal history requires local review",
        "Imported proposal authorship or a human decision attestation is untrusted in this local copy. The recorded decision is history, not a fresh local confirmation.",
        untrustedProposalIds,
        [
          "Review the proposal and current geometry locally",
          "Do not treat the imported decision as local human attestation",
        ],
      ),
    );
  }
  return issues;
}

const damageAngles: Partial<Record<DamageRegion, number>> = {
  front: 0,
  "front-right": 45,
  "right-side": 90,
  "rear-right": 135,
  rear: 180,
  "rear-left": 225,
  "left-side": 270,
  "front-left": 315,
};

function angularDifference(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function damageIssues(replayCase: ReplayCase, branchIds: string[]): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const calibration = metricCalibrationForCase(replayCase);
  const actorsWithoutDamageRecord = replayCase.actors.filter(
    (actor) =>
      actor.damageMarkers.length === 0 &&
      !findCurrentCompletenessAttestation(replayCase, {
        kind: "actor-damage",
        actorId: actor.id,
        outcome: "unknown",
      }),
  );
  if (actorsWithoutDamageRecord.length > 0) {
    issues.push(
      issue(
        "damage.none-recorded",
        "damage",
        "question",
        "Vehicle damage review is incomplete",
        `${actorsWithoutDamageRecord.map((actor) => actor.label).join(", ")} ${actorsWithoutDamageRecord.length === 1 ? "has" : "have"} neither a damage marker nor a current human completeness record.`,
        actorsWithoutDamageRecord.map((actor) => actor.id),
        ["Mark known damage", "Record damage as unknown or not assessed for each vehicle"],
      ),
    );
  }

  for (const branchId of branchIds) {
    for (const impact of branchEvents(replayCase, branchId).filter(
      (event) => event.type === "impact",
    )) {
      const actors = [...new Set(impact.linkedActorIds)]
        .map((actorId) => replayCase.actors.find((actor) => actor.id === actorId))
        .filter((actor): actor is ReplayCase["actors"][number] => Boolean(actor));
      for (const actor of actors) {
        if (
          actor.damageMarkers.length === 0 &&
          !findCurrentCompletenessAttestation(replayCase, {
            kind: "actor-damage",
            actorId: actor.id,
            outcome: "unknown",
          })
        ) {
          issues.push(
            issue(
              "damage.impact-without-marker",
              "damage",
              "question",
              "Impact has no linked damage location",
              `${actor.label} is linked to the impact but has no damage marker.`,
              [branchId, impact.id, actor.id],
              ["Mark the observed damage side", "Record the damage location as unknown"],
            ),
          );
        }
      }

      if (actors.length === 2) {
        const first = actors[0];
        const second = actors[1];
        if (!first || !second) continue;
        const firstPose = getActorPoseAtTime(replayCase, first.id, impact.timeMs, branchId);
        const secondPose = getActorPoseAtTime(replayCase, second.id, impact.timeMs, branchId);
        if (firstPose && secondPose) {
          const firstMetricPose = normalizedScenePointToMeters(firstPose, calibration);
          const secondMetricPose = normalizedScenePointToMeters(secondPose, calibration);
          const pairs = [
            {
              actor: first,
              pose: firstPose,
              metricPose: firstMetricPose,
              otherMetricPose: secondMetricPose,
            },
            {
              actor: second,
              pose: secondPose,
              metricPose: secondMetricPose,
              otherMetricPose: firstMetricPose,
            },
          ];
          for (const pair of pairs) {
            const contactWorldAngle =
              (Math.atan2(
                pair.otherMetricPose.xM - pair.metricPose.xM,
                -(pair.otherMetricPose.yM - pair.metricPose.yM),
              ) *
                180) /
              Math.PI;
            const localContactAngle =
              (((contactWorldAngle - pair.pose.rotationDeg) % 360) + 360) % 360;
            for (const marker of pair.actor.damageMarkers) {
              const expected = damageAngles[marker.region];
              if (expected !== undefined && angularDifference(localContactAngle, expected) > 100) {
                issues.push(
                  issue(
                    "damage.contact-direction-hint",
                    "damage",
                    "question",
                    "Damage side may not match the contact direction",
                    `${pair.actor.label}’s ${marker.region} marker differs from the broad contact direction in this branch. This is only a consistency hint, not a physical conclusion.`,
                    [branchId, impact.id, pair.actor.id, marker.id],
                    [
                      "Review the vehicle orientation",
                      "Review the damage side",
                      "Keep the discrepancy unresolved",
                    ],
                  ),
                );
              }
            }
          }
        }
      }
    }
  }
  return issues;
}

function provenanceIssues(replayCase: ReplayCase): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const evidenceById = new Map(replayCase.evidence.map((asset) => [asset.id, asset]));
  const eventIds = new Set(replayCase.timelineEvents.map((event) => event.id));
  const actorIds = new Set(replayCase.actors.map((actor) => actor.id));
  const damageIds = new Set(
    replayCase.actors.flatMap((actor) => actor.damageMarkers.map((marker) => marker.id)),
  );

  for (const claim of replayCase.claims) {
    if (
      claim.createdBy === "agent" &&
      isExternallyAttributedClaimSourceType(claim.sourceType) &&
      compatibleAgentObservationSourceIds(replayCase, claim.sourceType, claim.sourceIds).length ===
        0
    ) {
      issues.push(
        issue(
          "provenance.agent-external-source-missing",
          "provenance",
          "error",
          "Agent observation overstates its provenance",
          `This agent-authored observation is classified as ${claim.sourceType} but does not cite ${agentObservationSourceRequirement(claim.sourceType)}.`,
          [claim.id, ...claim.sourceIds],
          ["Link a compatible canonical source", "Reclassify the observation as agent inference"],
        ),
      );
    }
    if (
      claim.createdBy === "human" &&
      (claim.sourceType === "photo" || claim.sourceType === "document") &&
      compatibleAgentObservationSourceIds(replayCase, claim.sourceType, claim.sourceIds).length ===
        0
    ) {
      issues.push(
        issue(
          "provenance.human-external-source-missing",
          "provenance",
          "error",
          "Observation is missing its cited source",
          `This human-authored observation is classified as ${claim.sourceType} but does not cite ${agentObservationSourceRequirement(claim.sourceType)}.`,
          [claim.id, ...claim.sourceIds],
          ["Attach a compatible source", "Change the observation source classification"],
        ),
      );
    }
    if (claim.status === "confirmed" && containsLiabilityConclusion(claim.statement)) {
      issues.push(
        issue(
          "provenance.liability-as-fact",
          "provenance",
          "error",
          "Fault or liability language is presented as confirmed",
          "REPLAY may preserve a source-attributed allegation, but it cannot confirm fault or legal liability.",
          [claim.id],
          ["Return the statement to reported", "Rewrite it as a neutral factual observation"],
        ),
      );
    }
    if (claim.status === "confirmed" && (!claim.humanConfirmed || !claim.confirmedAt)) {
      issues.push(
        issue(
          "provenance.confirmation-missing",
          "provenance",
          "error",
          "Confirmed claim lacks human confirmation",
          "Only an explicit human action may make a claim confirmed.",
          [claim.id],
          ["Return the claim to reported", "Ask a human to review and confirm it"],
        ),
      );
    }
    if (
      claim.status === "confirmed" &&
      claim.createdBy === "agent" &&
      !claim.changeHistory.some(
        (change) => change.author === "human" && /confirm/i.test(change.summary),
      )
    ) {
      issues.push(
        issue(
          "provenance.agent-confirmation",
          "provenance",
          "error",
          "Agent-created claim lacks a human confirmation event",
          "An agent-created observation can be confirmed only through a recorded human review action.",
          [claim.id],
          [
            "Return the claim to an unconfirmed status",
            "Ask a human to confirm it in the interface",
          ],
        ),
      );
    }
    if (
      claim.status === "unknown" &&
      (claim.humanConfirmed || claim.statement.trim().length === 0)
    ) {
      issues.push(
        issue(
          "provenance.unknown-as-fact",
          "provenance",
          "error",
          "Unknown detail is represented as a fact",
          "Unknown details must remain unconfirmed and explicitly labelled unknown.",
          [claim.id],
          ["Remove confirmation", "Rewrite the statement as an unresolved detail"],
        ),
      );
    }
    if (claim.branchId && claim.status === "confirmed") {
      issues.push(
        issue(
          "provenance.hypothesis-as-fact",
          "provenance",
          "error",
          "Branch-specific claim is presented as confirmed",
          "Hypothesis-specific claims cannot appear as factual conclusions.",
          [claim.id, claim.branchId],
          [
            "Mark the claim as a hypothesis",
            "Move a genuinely shared confirmed fact outside the branch",
          ],
        ),
      );
    }
    for (const evidenceId of claim.linkedEvidenceIds) {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence || evidence.deleted) {
        issues.push(
          issue(
            "provenance.invalid-evidence-link",
            "provenance",
            "error",
            "Claim cites unavailable evidence",
            `The claim links to ${evidence ? "deleted" : "missing"} evidence.`,
            [claim.id, evidenceId],
            ["Restore or relink the evidence", "Remove the invalid citation"],
          ),
        );
      }
    }
    for (const eventId of claim.linkedEventIds) {
      if (!eventIds.has(eventId)) {
        issues.push(
          issue(
            "provenance.invalid-event-link",
            "provenance",
            "error",
            "Claim cites a missing timeline event",
            "A linked timeline event no longer exists.",
            [claim.id, eventId],
            ["Relink the claim", "Remove the invalid event link"],
          ),
        );
      }
    }
    for (const sceneId of claim.linkedSceneObjectIds) {
      if (
        !actorIds.has(sceneId) &&
        !replayCase.trajectories.some((trajectory) => trajectory.id === sceneId) &&
        !damageIds.has(sceneId)
      ) {
        issues.push(
          issue(
            "provenance.invalid-scene-link",
            "provenance",
            "error",
            "Claim cites a missing scene object",
            "A linked scene object no longer exists.",
            [claim.id, sceneId],
            ["Relink the claim", "Remove the invalid scene link"],
          ),
        );
      }
    }
  }

  const evidenceLinks: { ownerId: string; evidenceId: string }[] = [];
  for (const event of replayCase.timelineEvents) {
    event.linkedEvidenceIds.forEach((evidenceId) =>
      evidenceLinks.push({ ownerId: event.id, evidenceId }),
    );
  }
  for (const actor of replayCase.actors) {
    for (const marker of actor.damageMarkers) {
      marker.linkedEvidenceIds.forEach((evidenceId) =>
        evidenceLinks.push({ ownerId: marker.id, evidenceId }),
      );
    }
  }
  for (const note of replayCase.reportNotes) {
    note.evidenceIds.forEach((evidenceId) => evidenceLinks.push({ ownerId: note.id, evidenceId }));
  }
  for (const link of evidenceLinks) {
    const evidence = evidenceById.get(link.evidenceId);
    if (!evidence || evidence.deleted) {
      issues.push(
        issue(
          "provenance.deleted-evidence-cited",
          "provenance",
          "error",
          "Unavailable evidence remains cited",
          "A timeline, damage, or report item cites missing or deleted evidence.",
          [link.ownerId, link.evidenceId],
          ["Restore the evidence", "Remove the citation"],
        ),
      );
    }
  }
  return issues;
}

function completenessIssues(replayCase: ReplayCase): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  if (!replayCase.incidentDate) {
    issues.push(
      issue(
        "completeness.incident-date",
        "completeness",
        "warning",
        "Incident date is missing",
        "A date or approximate date is required for a complete factual report.",
        [replayCase.id],
        ["Add the incident date or clearly state that it is unknown"],
      ),
    );
  }
  if (!replayCase.sceneTemplateId) {
    issues.push(
      issue(
        "completeness.scene",
        "completeness",
        "error",
        "Scene type is missing",
        "A scene template is required.",
        [replayCase.id],
        ["Select a scene template"],
      ),
    );
  }
  if (replayCase.actors.length < 2) {
    issues.push(
      issue(
        "completeness.actors",
        "completeness",
        "warning",
        "Involved actors are incomplete",
        "This workflow expects the two involved vehicles to be represented.",
        [replayCase.id, ...replayCase.actors.map((actor) => actor.id)],
        ["Add the missing vehicle"],
      ),
    );
  }
  const actorsWithoutDamageReview = replayCase.actors.filter(
    (actor) =>
      actor.damageMarkers.length === 0 &&
      !findCurrentCompletenessAttestation(replayCase, {
        kind: "actor-damage",
        actorId: actor.id,
        outcome: "unknown",
      }),
  );
  if (actorsWithoutDamageReview.length > 0) {
    issues.push(
      issue(
        "completeness.damage",
        "completeness",
        "warning",
        "Damage completeness is not recorded",
        "Each vehicle needs a damage marker or an explicit human record that damage is unknown or was not assessed.",
        actorsWithoutDamageReview.map((actor) => actor.id),
        ["Add damage markers", "Complete the human damage review for each listed vehicle"],
      ),
    );
  }
  if (replayCase.timelineEvents.length === 0 || replayCase.trajectories.length === 0) {
    issues.push(
      issue(
        "completeness.timeline",
        "completeness",
        "warning",
        "Timeline reconstruction is incomplete",
        "At least one trajectory and timeline event are required for reconstruction.",
        [replayCase.id],
        ["Add actor trajectories and timeline events"],
      ),
    );
  }
  if (
    !replayCase.questions.some(
      (question) => question.status === "open" || question.status === "deferred",
    ) &&
    !findCurrentCompletenessAttestation(replayCase, {
      kind: "uncertainty-review-completed",
    })
  ) {
    issues.push(
      issue(
        "completeness.unresolved-section",
        "completeness",
        "question",
        "No unresolved details are recorded",
        "Review whether uncertainty has been explicitly captured before reporting.",
        [replayCase.id],
        ["Add unresolved questions or confirm that none remain"],
      ),
    );
  }
  if (
    !replayCase.evidence.some((asset) => !asset.deleted) &&
    !findCurrentCompletenessAttestation(replayCase, { kind: "no-evidence-supplied" })
  ) {
    issues.push(
      issue(
        "completeness.evidence-index",
        "completeness",
        "warning",
        "Evidence index is empty",
        "No available evidence is indexed for the report.",
        [replayCase.id],
        ["Add available evidence", "Record that no evidence was supplied"],
      ),
    );
  }
  // ReportSnapshotSchema requires humanAcknowledged=true, so malformed review
  // state is rejected before a persisted/imported case reaches this engine.
  return issues;
}

function reportPreviewIssues(
  replayCase: ReplayCase,
  preview: ReportPreview,
  ownerId: string,
  validateLiveSources: boolean,
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const claims = new Map(replayCase.claims.map((claim) => [claim.id, claim]));
  const evidence = new Map(replayCase.evidence.map((asset) => [asset.id, asset]));
  const workspacePaths = validWorkspaceCitationPaths(replayCase);
  const includedClaimIds = new Set(preview.includedClaimIds);
  const includedEvidenceIds = new Set(preview.includedEvidenceIds);
  for (const section of preview.sections) {
    for (const statement of section.statements) {
      const hasClaimOrEvidenceCitation =
        statement.citations.claimIds.length > 0 || statement.citations.evidenceIds.length > 0;
      const permitsInspectableWorkspaceProvenance = statement.certainty !== "confirmed";
      if (containsLiabilityConclusion(statement.text)) {
        issues.push(
          issue(
            "report.liability-language",
            "report",
            "error",
            "Report contains a fault or liability conclusion",
            "A factual report may preserve source attribution but cannot determine fault or legal liability.",
            [ownerId, statement.id],
            ["Rewrite the statement as a neutral, evidence-bound observation"],
          ),
        );
      }
      if (
        statement.certainty === "attested" &&
        (hasClaimOrEvidenceCitation ||
          statement.citations.workspacePaths.length === 0 ||
          statement.citations.workspacePaths.some(
            (path) => !path.startsWith("completenessAttestations."),
          ))
      ) {
        issues.push(
          issue(
            "report.invalid-attestation-citation",
            "report",
            "error",
            "Human attestation statement cites the wrong source type",
            "A human attestation statement must cite only a current, inspectable completeness record.",
            [ownerId, statement.id],
            [
              "Cite the matching completeness record",
              "Move the statement to the correct certainty section",
            ],
          ),
        );
      }
      if (
        (!permitsInspectableWorkspaceProvenance && !hasClaimOrEvidenceCitation) ||
        (permitsInspectableWorkspaceProvenance &&
          !hasClaimOrEvidenceCitation &&
          statement.citations.workspacePaths.length === 0)
      ) {
        issues.push(
          issue(
            "report.statement-without-citation",
            "report",
            "error",
            "Report statement lacks provenance",
            "Every substantive report statement must cite a claim, evidence item, or eligible inspectable workspace record.",
            [ownerId, statement.id],
            ["Add source citations", "Remove the unsupported statement"],
          ),
        );
      }
      for (const workspacePath of statement.citations.workspacePaths) {
        if (validateLiveSources && !workspacePaths.has(workspacePath)) {
          issues.push(
            issue(
              "report.invalid-workspace-citation",
              "report",
              "error",
              "Report workspace citation is unavailable",
              "A structured report source no longer resolves to an inspectable case object.",
              [ownerId, statement.id],
              ["Restore the referenced case object", "Remove the unsupported statement"],
            ),
          );
        }
      }
      for (const claimId of statement.citations.claimIds) {
        const claim = claims.get(claimId);
        if (
          (validateLiveSources &&
            (!claim ||
              (statement.certainty === "confirmed" &&
                (claim.status !== "confirmed" || !claim.humanConfirmed)))) ||
          (!validateLiveSources && !includedClaimIds.has(claimId))
        ) {
          issues.push(
            issue(
              "report.invalid-claim-citation",
              "report",
              "error",
              "Report claim citation is not allowed",
              validateLiveSources
                ? "The cited claim is missing or is not eligible for this report section."
                : "The historical statement citation is absent from its immutable preview index.",
              [ownerId, statement.id, claimId],
              ["Cite an eligible claim", "Move the statement to the correct certainty section"],
            ),
          );
        }
      }
      for (const evidenceId of statement.citations.evidenceIds) {
        const asset = evidence.get(evidenceId);
        if (
          (validateLiveSources && (!asset || asset.deleted)) ||
          (!validateLiveSources && !includedEvidenceIds.has(evidenceId))
        ) {
          issues.push(
            issue(
              "report.invalid-evidence-citation",
              "report",
              "error",
              "Report evidence citation is unavailable",
              validateLiveSources
                ? "The statement cites missing or deleted evidence."
                : "The historical statement citation is absent from its immutable preview index.",
              [ownerId, statement.id, evidenceId],
              ["Restore or replace the evidence citation"],
            ),
          );
        }
      }
    }
  }
  return issues;
}

/** Validates a transient candidate against the sources that are live right now. */
export function validateCurrentReportPreview(
  replayCase: ReplayCase,
  preview: ReportPreview,
): ConsistencyIssue[] {
  return reportPreviewIssues(replayCase, preview, "report-preview", true);
}

function reportIssues(replayCase: ReplayCase): ConsistencyIssue[] {
  const issues = replayCase.reportSnapshots.flatMap((snapshot) =>
    reportPreviewIssues(replayCase, snapshot.preview, snapshot.id, false),
  );

  for (const note of replayCase.reportNotes) {
    if (containsLiabilityConclusion(note.text)) {
      issues.push(
        issue(
          "report.liability-language",
          "report",
          "error",
          "Report note contains a fault or liability conclusion",
          "REPLAY reports may organize evidence but must not determine fault or legal liability.",
          [note.id],
          ["Rewrite the note as a neutral, evidence-bound observation"],
        ),
      );
    }
  }
  return issues;
}

function requestedScopes(scope: ConsistencyValidationScope): Set<ConsistencyScope> {
  if (scope === "all") {
    return new Set([
      "timeline",
      "geometry",
      "motion",
      "damage",
      "integrity",
      "provenance",
      "completeness",
      "report",
    ]);
  }
  if (scope === "scene") return new Set(["geometry", "motion", "damage"]);
  return new Set([scope]);
}

/** Runs deterministic application rules. No language model output participates. */
export function validateConsistency(
  replayCase: ReplayCase,
  options: ConsistencyValidationOptions = {},
): ConsistencyIssue[] {
  const scopes = requestedScopes(options.scope ?? "all");
  const branchIds = options.branchId
    ? [options.branchId]
    : replayCase.branches.filter((branch) => branch.status === "active").map((branch) => branch.id);
  const issues: ConsistencyIssue[] = [];
  if (scopes.has("timeline")) issues.push(...timelineIssues(replayCase, branchIds));
  if (scopes.has("geometry")) issues.push(...geometryIssues(replayCase, branchIds));
  if (scopes.has("motion")) issues.push(...motionIssues(replayCase, branchIds));
  if (scopes.has("damage")) issues.push(...damageIssues(replayCase, branchIds));
  if (scopes.has("integrity")) issues.push(...integrityIssues(replayCase));
  if (scopes.has("provenance")) issues.push(...provenanceIssues(replayCase));
  if (scopes.has("completeness")) issues.push(...completenessIssues(replayCase));
  if (scopes.has("report")) issues.push(...reportIssues(replayCase));

  return [...new Map(issues.map((item) => [item.id, item])).values()].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.id.localeCompare(b.id),
  );
}
