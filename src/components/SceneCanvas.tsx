import {
  CarFront,
  CircleAlert,
  Crosshair,
  Focus,
  Grid3X3,
  LockKeyhole,
  Minus,
  Move,
  Plus,
  Route,
  Ruler,
  Unlock,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { clampTimeToRange, interpolateTrajectory, sampleTrajectory } from "../domain/interpolation";
import {
  analyzeVehicleFootprintRelation,
  createSceneMetricCalibration,
  impactPenetrationToleranceMeters,
  impactSeparationToleranceMeters,
  type FootprintRelation,
} from "../domain/physics";
import {
  getRoadTemplate,
  SCENE_VIEW_HEIGHT,
  SCENE_VIEW_WIDTH,
  snapPointToRoadLane,
} from "../domain/roadTemplates";
import { createSceneCoordinateMapper, formatSceneCoordinate } from "../domain/sceneCoordinates";
import { getAcceptedProposalGeometryTrust } from "../domain/proposalProvenance";
import { resolveProposalReviewRequest, type ProposalReviewTarget } from "../domain/proposalReview";
import type {
  ActorPose,
  DamageRegion,
  DamageMarker,
  Point,
  ReplayCase,
  RoadSceneType,
  SceneActor,
  TimelineEvent,
  Trajectory,
} from "../domain/models";

type ImpactActorPair = [string, string];

interface ImpactPlacementContext {
  branchId: string;
  timeMs: number;
  actorIds: ImpactActorPair;
}

interface SceneCanvasProps {
  replayCase: ReplayCase;
  currentTimeMs: number;
  selectedId?: string;
  selectedKeyframeId?: string;
  comparisonBranchIds?: string[];
  activeAgentIds?: string[];
  proposalReviewTarget?: ProposalReviewTarget;
  onSelect: (type: "actor" | "trajectory" | "timeline-event", id: string) => void;
  onSelectKeyframe: (trajectoryId: string, keyframeId: string) => void;
  onEditStart: () => void;
  onMoveActor: (actorId: string, pose: ActorPose) => void;
  onMoveKeyframe: (trajectoryId: string, keyframeId: string, x: number, y: number) => void;
  onCreateTrajectory: (actorId: string) => void;
  onMarkDamage: (actorId: string, region: DamageRegion, description: string) => boolean;
  onMarkImpact: (location: { x: number; y: number }, context: ImpactPlacementContext) => boolean;
  onToggleActorLock: (actorId: string) => void;
  onToggleTrajectoryLock: (trajectoryId: string) => void;
  onToggleEventLock: (eventId: string) => void;
  onUpdateEnvironment: (environment: ReplayCase["environment"]) => void;
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

const VIEW_WIDTH = SCENE_VIEW_WIDTH;
const VIEW_HEIGHT = SCENE_VIEW_HEIGHT;
const IMPACT_ALIGNMENT_WINDOW_MS = 50;
const CONTACT_VISUAL_TOLERANCE_M = 0.1;
const CONTACT_SEPARATION_EPSILON_M = 0.01;

type ContactDisplayState =
  "clear" | "recorded" | "touching" | "unmarked" | "excessive" | "calibration-gap" | "impact-gap";

interface CurrentPairGeometry {
  first: SceneActor;
  second: SceneActor;
  firstPose: ActorPose;
  secondPose: ActorPose;
  relation: FootprintRelation;
  matchingImpact?: TimelineEvent | undefined;
  state: Exclude<ContactDisplayState, "clear" | "calibration-gap" | "impact-gap"> | "clear";
}

interface VehicleViewGeometry {
  bodyMatrix: string;
  corners: readonly [Point, Point, Point, Point];
  forwardPerMeter: Point;
  rightPerMeter: Point;
  forwardUnit: Point;
  halfLengthPixels: number;
}

function vehicleViewGeometry(
  dimensions: SceneActor["dimensions"],
  rotationDeg: number,
  pixelsPerMeterX: number,
  pixelsPerMeterY: number,
): VehicleViewGeometry {
  const radians = (rotationDeg * Math.PI) / 180;
  const forwardPerMeter = {
    x: Math.sin(radians) * pixelsPerMeterX,
    y: -Math.cos(radians) * pixelsPerMeterY,
  };
  const rightPerMeter = {
    x: Math.cos(radians) * pixelsPerMeterX,
    y: Math.sin(radians) * pixelsPerMeterY,
  };
  const halfLengthM = dimensions.length / 2;
  const halfWidthM = dimensions.width / 2;
  const corner = (forwardSign: -1 | 1, rightSign: -1 | 1): Point => ({
    x: forwardPerMeter.x * halfLengthM * forwardSign + rightPerMeter.x * halfWidthM * rightSign,
    y: forwardPerMeter.y * halfLengthM * forwardSign + rightPerMeter.y * halfWidthM * rightSign,
  });
  const forwardLength = Math.hypot(forwardPerMeter.x, forwardPerMeter.y);
  return {
    bodyMatrix: [
      rightPerMeter.x * (dimensions.width / 40),
      rightPerMeter.y * (dimensions.width / 40),
      -forwardPerMeter.x * (dimensions.length / 86),
      -forwardPerMeter.y * (dimensions.length / 86),
      0,
      0,
    ].join(" "),
    corners: [corner(1, -1), corner(1, 1), corner(-1, 1), corner(-1, -1)],
    forwardPerMeter,
    rightPerMeter,
    forwardUnit:
      forwardLength > 0
        ? { x: forwardPerMeter.x / forwardLength, y: forwardPerMeter.y / forwardLength }
        : { x: 0, y: -1 },
    halfLengthPixels: forwardLength * halfLengthM,
  };
}

function polygonPoints(points: readonly Point[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function roadPolygonMatchesBounds(
  points: readonly Point[],
  bounds: ReplayCase["environment"]["bounds"],
): boolean {
  if (points.length !== 4) return false;
  const tolerance = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 1e-9;
  const corners = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ];
  return corners.every((corner) =>
    points.some(
      (point) =>
        Math.abs(point.x - corner.x) <= tolerance && Math.abs(point.y - corner.y) <= tolerance,
    ),
  );
}

function formatSceneSeconds(timeMs: number): string {
  const normalizedTimeMs = Math.round(timeMs);
  return (normalizedTimeMs / 1000).toFixed(normalizedTimeMs % 100 === 0 ? 1 : 3);
}

function actorBadge(label: string): string {
  const vehicleSuffix = /\bvehicle\s+([a-z0-9]{1,3})\b/i.exec(label)?.[1];
  if (vehicleSuffix) return vehicleSuffix.toUpperCase();
  const initials = label
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
  return initials || "V";
}

function exactImpactActorPair(event: TimelineEvent): ImpactActorPair | undefined {
  const actorIds = [...new Set(event.linkedActorIds)];
  const first = actorIds[0];
  const second = actorIds[1];
  return actorIds.length === 2 && first && second ? [first, second] : undefined;
}

function impactActorPairMatches(event: TimelineEvent, actorIds: ImpactActorPair): boolean {
  const pair = exactImpactActorPair(event);
  return Boolean(pair && pair.includes(actorIds[0]) && pair.includes(actorIds[1]));
}

function defaultImpactActorPair(actors: readonly SceneActor[]): ImpactActorPair | undefined {
  const first = actors[0];
  const second = actors[1];
  return first && second ? [first.id, second.id] : undefined;
}

function actorLabelForId(actors: readonly SceneActor[], actorId: string): string {
  return actors.find((actor) => actor.id === actorId)?.label ?? actorId;
}

function listActorLabels(labels: readonly string[]): string {
  if (labels.length === 0) return "unidentified vehicles";
  if (labels.length === 1) return labels[0] ?? "unidentified vehicle";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

function impactActorDescription(
  actorIds: readonly string[],
  actors: readonly SceneActor[],
): string {
  const labels = [...new Set(actorIds)].map((actorId) => actorLabelForId(actors, actorId));
  return labels.length === 2
    ? `between ${listActorLabels(labels)}`
    : `involving ${listActorLabels(labels)}`;
}

function contactReadout(
  state: ContactDisplayState,
  pair: CurrentPairGeometry | undefined,
  currentTimeMs: number,
  actorCount: number,
): { title: string; detail: string } {
  const time = `${formatSceneSeconds(currentTimeMs)} s`;
  const labels = pair ? `${pair.first.label} ↔ ${pair.second.label}` : "Vehicle footprints";
  if (state === "recorded" && pair) {
    const certainty = pair.matchingImpact?.certainty ?? "unknown";
    return {
      title: "Impact event geometry · footprints meet",
      detail: `${labels} · event status: ${certainty} · footprint overlap depth ${pair.relation.penetrationDepthM.toFixed(2)} m at ${time}`,
    };
  }
  if (state === "excessive" && pair) {
    const certainty = pair.matchingImpact?.certainty ?? "unknown";
    return {
      title: "Geometry conflict at impact event",
      detail: `${labels} interpenetrate by ${pair.relation.penetrationDepthM.toFixed(2)} m at ${time} · event status: ${certainty}`,
    };
  }
  if (state === "unmarked" && pair) {
    return {
      title: "Unmarked vehicle overlap",
      detail: `${labels} interpenetrate by ${pair.relation.penetrationDepthM.toFixed(2)} m at ${time}`,
    };
  }
  if (state === "touching" && pair) {
    return {
      title: "Footprints touch without a contact event",
      detail: `${labels} · ${pair.relation.penetrationDepthM.toFixed(2)} m overlap depth at ${time}`,
    };
  }
  if (state === "impact-gap" && pair) {
    const certainty = pair.matchingImpact?.certainty ?? "unknown";
    return {
      title: "Impact event has no footprint contact",
      detail: `${labels} have a ${pair.relation.separationM.toFixed(2)} m gap at ${time} · event status: ${certainty}`,
    };
  }
  if (state === "calibration-gap" && pair) {
    return {
      title: "Impact geometry remains calibration-dependent",
      detail: `${labels} have a ${pair.relation.separationM.toFixed(2)} m modeled gap at ${time}; review the scene calibration before treating it as a conflict`,
    };
  }
  return {
    title: "Vehicle footprints clear",
    detail: `${String(actorCount)} configured vehicle ${actorCount === 1 ? "footprint" : "footprints"} checked at ${time}; no modeled overlap`,
  };
}

export function SceneCanvas({
  replayCase,
  currentTimeMs,
  selectedId,
  selectedKeyframeId,
  comparisonBranchIds = [],
  activeAgentIds = [],
  proposalReviewTarget,
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
  onUpdateEnvironment,
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
  const [impactPlacementContext, setImpactPlacementContext] = useState<ImpactPlacementContext>();
  const placingImpact = impactPlacementContext?.branchId === replayCase.activeBranchId;
  const [damageActorId, setDamageActorId] = useState<string>();
  const [damageRegion, setDamageRegion] = useState<DamageRegion>("unknown");
  const [damageDescription, setDamageDescription] = useState("");
  const roadTemplate = getRoadTemplate(replayCase.environment.sceneType);
  const physicalModelFormStateKey = JSON.stringify([
    replayCase.environment.sceneType,
    replayCase.environment.calibration.widthMeters,
    replayCase.environment.calibration.heightMeters,
    replayCase.environment.calibration.uncertaintyMeters,
    replayCase.environment.calibration.source,
    replayCase.environment.postedSpeedLimitKph ?? null,
    replayCase.environment.roadCondition,
    replayCase.environment.trafficSide,
  ]);
  const sceneBounds = replayCase.environment.bounds;
  const sceneCoordinates = useMemo(
    () => createSceneCoordinateMapper(sceneBounds, VIEW_WIDTH, VIEW_HEIGHT),
    [sceneBounds],
  );
  const configuredRoadBoundary = useMemo(() => {
    if (roadPolygonMatchesBounds(replayCase.environment.roadPolygon, sceneBounds)) return undefined;
    return polygonPoints(
      replayCase.environment.roadPolygon.map((point) => sceneCoordinates.toView(point)),
    );
  }, [replayCase.environment.roadPolygon, sceneBounds, sceneCoordinates]);
  const toView = (x: number, y: number): Point => sceneCoordinates.toView({ x, y });
  const pixelsPerMeterX = VIEW_WIDTH / replayCase.environment.calibration.widthMeters;
  const pixelsPerMeterY = VIEW_HEIGHT / replayCase.environment.calibration.heightMeters;

  const displayedBranchIds = comparisonBranchIds.length
    ? new Set([replayCase.activeBranchId, ...comparisonBranchIds])
    : new Set([replayCase.activeBranchId]);
  const displayedTrajectories = replayCase.trajectories.filter(
    (trajectory) => displayedBranchIds.has(trajectory.branchId) && trajectory.visible,
  );
  const acceptedProposalGeometryTrust = getAcceptedProposalGeometryTrust(replayCase);
  const hasAgentAuthoredPath = displayedTrajectories.some(
    (trajectory) =>
      !acceptedProposalGeometryTrust.trajectoryIds.has(trajectory.id) &&
      (trajectory.createdBy === "agent" || trajectory.changeHistory.at(-1)?.author === "agent"),
  );
  const hasAcceptedAgentGeometry =
    [...acceptedProposalGeometryTrust.actorIds.values()].includes("local-human-attested") ||
    [...acceptedProposalGeometryTrust.trajectoryIds.values()].includes("local-human-attested");
  const hasUnverifiedImportedGeometry =
    [...acceptedProposalGeometryTrust.actorIds.values()].includes("unverified-import") ||
    [...acceptedProposalGeometryTrust.trajectoryIds.values()].includes("unverified-import");
  const hasDirectAgentActorGeometry = replayCase.actors.some(
    (actor) =>
      !acceptedProposalGeometryTrust.actorIds.has(actor.id) && actor.lastEditedBy === "agent",
  );
  const pendingProposalChanges = replayCase.proposals
    .filter((proposal) => proposal.status === "pending")
    .flatMap((proposal) => proposal.revisions.at(-1)?.changes ?? []);
  const displayedPendingProposalChanges = pendingProposalChanges.filter(
    (change) => change.branchId === replayCase.activeBranchId,
  );
  const unverifiedPendingChangeIds = new Set(
    replayCase.proposals
      .filter((proposal) => proposal.status === "pending")
      .flatMap((proposal) => {
        const revision = proposal.revisions.at(-1);
        return revision && !revision.authorshipTrusted
          ? revision.changes.map((change) => change.id)
          : [];
      }),
  );
  const hasTrustedPendingProposal = displayedPendingProposalChanges.some(
    (change) => !unverifiedPendingChangeIds.has(change.id),
  );
  const hasUnverifiedPendingProposal = displayedPendingProposalChanges.some((change) =>
    unverifiedPendingChangeIds.has(change.id),
  );
  const resolvedProposalReview = proposalReviewTarget
    ? resolveProposalReviewRequest(proposalReviewTarget, {
        activeBranchId: replayCase.activeBranchId,
        timeRangeMs: replayCase.timeRangeMs,
      })
    : undefined;
  const activeProposalReviewTarget =
    resolvedProposalReview?.ok === true &&
    resolvedProposalReview.target.reviewTimeMs === proposalReviewTarget?.reviewTimeMs
      ? resolvedProposalReview.target
      : undefined;
  const reviewedProposal = activeProposalReviewTarget
    ? replayCase.proposals.find(
        (proposal) =>
          proposal.id === activeProposalReviewTarget.proposalId && proposal.status === "pending",
      )
    : undefined;
  const reviewedRevision = reviewedProposal?.revisions.at(-1);
  const reviewedChange =
    activeProposalReviewTarget && reviewedRevision?.id === activeProposalReviewTarget.revisionId
      ? reviewedRevision.changes.find(
          (change) =>
            change.id === activeProposalReviewTarget.changeId &&
            change.branchId === activeProposalReviewTarget.branchId,
        )
      : undefined;
  const reviewedTrajectoryPoint =
    reviewedChange?.kind === "trajectory-set" &&
    activeProposalReviewTarget?.keyframeId &&
    currentTimeMs === activeProposalReviewTarget.reviewTimeMs
      ? {
          change: reviewedChange,
          target: activeProposalReviewTarget,
          proposedKeyframe: reviewedChange.proposedTrajectory.keyframes.find(
            (keyframe) => keyframe.id === activeProposalReviewTarget.keyframeId,
          ),
          baseKeyframe: reviewedChange.baseTrajectory?.keyframes.find(
            (keyframe) => keyframe.id === activeProposalReviewTarget.keyframeId,
          ),
          actor: replayCase.actors.find((actor) => actor.id === reviewedChange.actorId),
        }
      : undefined;

  const activeTrajectoryByActorId = useMemo(() => {
    const byActorId = new Map<string, Trajectory>();
    for (const trajectory of replayCase.trajectories) {
      if (trajectory.branchId === replayCase.activeBranchId && !byActorId.has(trajectory.actorId)) {
        byActorId.set(trajectory.actorId, trajectory);
      }
    }
    return byActorId;
  }, [replayCase.activeBranchId, replayCase.trajectories]);

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
        const trajectory = activeTrajectoryByActorId.get(actor.id);
        return [
          actor.id,
          trajectory?.keyframes.length
            ? interpolateTrajectory(trajectory, currentTimeMs)
            : actor.pose,
        ];
      }),
    ) as Record<string, ActorPose>;
  }, [activeTrajectoryByActorId, currentTimeMs, drag, replayCase.actors]);

  const damageActor = replayCase.actors.find((actor) => actor.id === damageActorId);
  const activeImpacts = useMemo(
    () =>
      replayCase.timelineEvents.filter(
        (event) => event.branchId === replayCase.activeBranchId && event.type === "impact",
      ),
    [replayCase.activeBranchId, replayCase.timelineEvents],
  );
  const matchingImpactByActorPair = useMemo(() => {
    const byPair = new Map<string, TimelineEvent>();
    for (const event of activeImpacts) {
      if (Math.abs(event.timeMs - currentTimeMs) > IMPACT_ALIGNMENT_WINDOW_MS) continue;
      const pair = exactImpactActorPair(event);
      if (!pair) continue;
      const [firstId, secondId] = pair;
      const forwardKey = `${firstId}\u0000${secondId}`;
      const reverseKey = `${secondId}\u0000${firstId}`;
      if (!byPair.has(forwardKey)) byPair.set(forwardKey, event);
      if (!byPair.has(reverseKey)) byPair.set(reverseKey, event);
    }
    return byPair;
  }, [activeImpacts, currentTimeMs]);
  const onlyActiveImpact = activeImpacts.length === 1 ? activeImpacts[0] : undefined;
  const legacyImpactForCorrection =
    onlyActiveImpact && new Set(onlyActiveImpact.linkedActorIds).size > 2
      ? onlyActiveImpact
      : undefined;
  const placementImpact = impactPlacementContext
    ? (activeImpacts.find((event) =>
        impactActorPairMatches(event, impactPlacementContext.actorIds),
      ) ?? legacyImpactForCorrection)
    : undefined;
  const impactPlacementPairLabel = impactPlacementContext
    ? listActorLabels(
        impactPlacementContext.actorIds.map((actorId) =>
          actorLabelForId(replayCase.actors, actorId),
        ),
      )
    : undefined;
  const currentPairGeometry = useMemo<CurrentPairGeometry[]>(() => {
    const calibration = createSceneMetricCalibration({
      sceneBounds: replayCase.environment.bounds,
      widthMeters: replayCase.environment.calibration.widthMeters,
      heightMeters: replayCase.environment.calibration.heightMeters,
    });
    const relations: CurrentPairGeometry[] = [];
    for (let firstIndex = 0; firstIndex < replayCase.actors.length - 1; firstIndex += 1) {
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < replayCase.actors.length;
        secondIndex += 1
      ) {
        const first = replayCase.actors[firstIndex];
        const second = replayCase.actors[secondIndex];
        if (!first || !second) continue;
        const firstPose = actorPoses[first.id];
        const secondPose = actorPoses[second.id];
        if (!firstPose || !secondPose) continue;
        const relation = analyzeVehicleFootprintRelation(
          { pose: firstPose, dimensions: first.dimensions },
          { pose: secondPose, dimensions: second.dimensions },
          calibration,
        );
        const matchingImpact = matchingImpactByActorPair.get(`${first.id}\u0000${second.id}`);
        const penetrationToleranceM = matchingImpact
          ? impactPenetrationToleranceMeters(first.dimensions, second.dimensions)
          : CONTACT_VISUAL_TOLERANCE_M;
        const materialOverlap =
          relation.overlaps && relation.penetrationDepthM > penetrationToleranceM;
        const state: CurrentPairGeometry["state"] = materialOverlap
          ? matchingImpact
            ? "excessive"
            : "unmarked"
          : relation.overlaps
            ? matchingImpact
              ? "recorded"
              : "touching"
            : "clear";
        relations.push({
          first,
          second,
          firstPose,
          secondPose,
          relation,
          ...(matchingImpact ? { matchingImpact } : {}),
          state,
        });
      }
    }
    return relations;
  }, [actorPoses, matchingImpactByActorPair, replayCase.actors, replayCase.environment]);
  const pairStatePriority: Record<CurrentPairGeometry["state"], number> = {
    clear: 0,
    touching: 1,
    recorded: 2,
    unmarked: 3,
    excessive: 4,
  };
  const primaryPairGeometry = [...currentPairGeometry].sort(
    (first, second) => pairStatePriority[second.state] - pairStatePriority[first.state],
  )[0];
  const nearbyImpact = activeImpacts.find(
    (event) => Math.abs(event.timeMs - currentTimeMs) <= IMPACT_ALIGNMENT_WINDOW_MS,
  );
  const impactPairGeometry = nearbyImpact
    ? currentPairGeometry.find(
        (pair) =>
          nearbyImpact.linkedActorIds.includes(pair.first.id) &&
          nearbyImpact.linkedActorIds.includes(pair.second.id),
      )
    : undefined;
  const contactDisplayState: ContactDisplayState =
    primaryPairGeometry && primaryPairGeometry.state !== "clear"
      ? primaryPairGeometry.state
      : nearbyImpact && impactPairGeometry && !impactPairGeometry.relation.overlaps
        ? impactPairGeometry.relation.separationM >
          impactSeparationToleranceMeters(replayCase.environment.calibration.uncertaintyMeters)
          ? "impact-gap"
          : impactPairGeometry.relation.separationM > CONTACT_SEPARATION_EPSILON_M
            ? "calibration-gap"
            : "clear"
        : "clear";
  const contactDisplayPair =
    contactDisplayState === "impact-gap" || contactDisplayState === "calibration-gap"
      ? impactPairGeometry
      : primaryPairGeometry;
  const focusedImpactIdRef = useRef<string | undefined>(undefined);
  const nearbyImpactId = nearbyImpact?.id;
  const nearbyImpactX = nearbyImpact?.location?.x;
  const nearbyImpactY = nearbyImpact?.location?.y;
  const shouldFocusImpact = impactPairGeometry?.relation.overlaps === true;
  useEffect(() => {
    if (
      !shouldFocusImpact ||
      nearbyImpactId === undefined ||
      nearbyImpactX === undefined ||
      nearbyImpactY === undefined
    ) {
      focusedImpactIdRef.current = undefined;
      return;
    }
    if (focusedImpactIdRef.current === nearbyImpactId) return;
    const point = sceneCoordinates.toView({ x: nearbyImpactX, y: nearbyImpactY });
    focusedImpactIdRef.current = nearbyImpactId;
    setZoom((current) => Math.max(current, 2.2));
    setPan({ x: VIEW_WIDTH / 2 - point.x, y: VIEW_HEIGHT / 2 - point.y });
  }, [nearbyImpactId, nearbyImpactX, nearbyImpactY, sceneCoordinates, shouldFocusImpact]);
  const contactStateByActor = new Map<string, CurrentPairGeometry["state"]>();
  const labelDirectionByActor = new Map<string, -1 | 1>();
  for (const pair of currentPairGeometry) {
    if (pair.state === "clear") continue;
    for (const actor of [pair.first, pair.second]) {
      const existing = contactStateByActor.get(actor.id) ?? "clear";
      if (pairStatePriority[pair.state] > pairStatePriority[existing]) {
        contactStateByActor.set(actor.id, pair.state);
      }
    }
    labelDirectionByActor.set(pair.first.id, -1);
    labelDirectionByActor.set(pair.second.id, 1);
  }
  const selectedActor = replayCase.actors.find((actor) => actor.id === selectedId);
  const selectedTrajectory = replayCase.trajectories.find(
    (trajectory) => trajectory.id === selectedId,
  );
  const selectedEvent = replayCase.timelineEvents.find((event) => event.id === selectedId);
  const activeBranch = replayCase.branches.find(
    (branch) => branch.id === replayCase.activeBranchId,
  );

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
    const boundedPosition = sceneCoordinates.clamp(
      sceneCoordinates.fromView({
        x: pointer.x - (activeDrag.offsetX ?? 0),
        y: pointer.y - (activeDrag.offsetY ?? 0),
      }),
    );
    const position = snapToLane
      ? sceneCoordinates.fromTemplate(
          snapPointToRoadLane(
            replayCase.environment.sceneType,
            sceneCoordinates.toTemplate(boundedPosition),
          ),
        )
      : boundedPosition;
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
    const pose = actorPoses[actor.id] ?? actor.pose;
    const next = { ...pose };
    if (event.key === "ArrowLeft") next.x -= sceneCoordinates.keyboardStep("x", event.shiftKey);
    else if (event.key === "ArrowRight")
      next.x += sceneCoordinates.keyboardStep("x", event.shiftKey);
    else if (event.key === "ArrowUp") next.y -= sceneCoordinates.keyboardStep("y", event.shiftKey);
    else if (event.key === "ArrowDown")
      next.y += sceneCoordinates.keyboardStep("y", event.shiftKey);
    else if (event.key === "[" || event.key === ",") next.rotationDeg -= event.shiftKey ? 15 : 3;
    else if (event.key === "]" || event.key === ".") next.rotationDeg += event.shiftKey ? 15 : 3;
    else return;
    event.preventDefault();
    if (isActorEditLocked(actor)) return;
    const bounded = sceneCoordinates.clamp(next);
    next.x = bounded.x;
    next.y = bounded.y;
    next.rotationDeg = ((next.rotationDeg % 360) + 360) % 360;
    onMoveActor(actor.id, next);
  }

  function beginImpactPlacement(): void {
    if (placingImpact) {
      setImpactPlacementContext(undefined);
      return;
    }
    const selectedImpactPair =
      selectedEvent?.type === "impact" && selectedEvent.branchId === replayCase.activeBranchId
        ? exactImpactActorPair(selectedEvent)
        : undefined;
    const actorIds = selectedImpactPair ?? defaultImpactActorPair(replayCase.actors);
    if (!actorIds) return;
    onEditStart();
    setImpactPlacementContext({
      branchId: replayCase.activeBranchId,
      timeMs: currentTimeMs,
      actorIds,
    });
  }

  function selectNextVehicle(): void {
    if (replayCase.actors.length === 0) return;
    const currentIndex = replayCase.actors.findIndex((actor) => actor.id === selectedActor?.id);
    const nextActor = replayCase.actors[(currentIndex + 1) % replayCase.actors.length];
    if (nextActor) onSelect("actor", nextActor.id);
  }

  function updateImpactPlacementActor(index: 0 | 1, actorId: string): void {
    if (!replayCase.actors.some((actor) => actor.id === actorId)) return;
    setImpactPlacementContext((current) => {
      if (!current) return current;
      const [firstId, secondId] = current.actorIds;
      const actorIds: ImpactActorPair =
        index === 0
          ? actorId === secondId
            ? [secondId, firstId]
            : [actorId, secondId]
          : actorId === firstId
            ? [secondId, firstId]
            : [firstId, actorId];
      return { ...current, actorIds };
    });
  }

  function placeImpactByCoordinates(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!impactPlacementContext || !placingImpact) return;
    const data = new FormData(event.currentTarget);
    const x = Number(data.get("impact-x"));
    const y = Number(data.get("impact-y"));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const marked = onMarkImpact(sceneCoordinates.clamp({ x, y }), impactPlacementContext);
    if (marked) setImpactPlacementContext(undefined);
  }

  const viewBox = `${-pan.x + (VIEW_WIDTH - VIEW_WIDTH / zoom) / 2} ${-pan.y + (VIEW_HEIGHT - VIEW_HEIGHT / zoom) / 2} ${VIEW_WIDTH / zoom} ${VIEW_HEIGHT / zoom}`;
  const contactReadoutContent = contactReadout(
    contactDisplayState,
    contactDisplayPair,
    currentTimeMs,
    replayCase.actors.length,
  );

  return (
    <section
      className="scene-panel"
      aria-label="Incident scene editor"
      data-onboarding-id="scene-editor"
    >
      <div className="scene-toolbar">
        <div className="scene-toolbar__group">
          <button
            type="button"
            className={`tool-button ${showPaths ? "is-active" : ""}`}
            onClick={() => setShowPaths((value) => !value)}
            aria-pressed={showPaths}
            aria-label={`Paths — ${showPaths ? "hide" : "show"} trajectories`}
            title={showPaths ? "Hide trajectories" : "Show trajectories"}
          >
            <Route size={15} aria-hidden="true" /> <span>Paths</span>
          </button>
          <button
            type="button"
            className={`tool-button ${snapToLane ? "is-active" : ""}`}
            onClick={() => setSnapToLane((value) => !value)}
            aria-pressed={snapToLane}
            title="While dragging, snap nearby positions to the nearest template lane centre. Heading is unchanged."
            aria-label="Lane snap while dragging. Moves nearby positions to the nearest template lane centre; it does not simulate steering."
          >
            <Crosshair size={15} aria-hidden="true" /> <span>Lane snap</span>
          </button>
          <button
            type="button"
            className={`tool-button ${placingImpact ? "is-active" : ""}`}
            onClick={beginImpactPlacement}
            disabled={replayCase.actors.length < 2}
            aria-pressed={placingImpact}
            aria-label={
              placingImpact && impactPlacementPairLabel
                ? `Cancel impact placement between ${impactPlacementPairLabel}`
                : "Mark impact"
            }
            title={
              replayCase.actors.length < 2
                ? "Add a second vehicle before marking contact"
                : "Place the approximate impact on the scene"
            }
          >
            <CircleAlert size={15} aria-hidden="true" /> <span>Mark impact</span>
          </button>
          <button
            type="button"
            className="tool-button scene-select-next"
            onClick={selectNextVehicle}
            disabled={replayCase.actors.length === 0 || placingImpact}
            aria-label={`Select next vehicle. ${selectedActor ? `${selectedActor.label} is selected` : "No vehicle selected"}. Useful when vehicles overlap.`}
            title="Select the next vehicle, including vehicles hidden under an overlap"
          >
            <CarFront size={15} aria-hidden="true" />
            <span>{selectedActor?.label ?? "Vehicle"}</span>
          </button>
          <button
            type="button"
            className={`tool-button ${showGrid ? "is-active" : ""}`}
            onClick={() => setShowGrid((value) => !value)}
            aria-pressed={showGrid}
            aria-label={showGrid ? "Hide placement grid" : "Show placement grid"}
            title="Show placement grid"
          >
            <Grid3X3 size={15} aria-hidden="true" />
          </button>
          <details className="scene-calibration-popover">
            <summary
              className="tool-button"
              title="Review scene measurements, sources, and road context"
            >
              <Ruler size={15} aria-hidden="true" /> <span>Scene calibration</span>
            </summary>
            <form
              key={physicalModelFormStateKey}
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                const widthMeters = Number(data.get("scene-width"));
                const heightMeters = Number(data.get("scene-height"));
                const uncertaintyMeters = Number(data.get("scene-uncertainty"));
                const speedLimitValue = data.get("speed-limit");
                if (speedLimitValue !== null && typeof speedLimitValue !== "string") return;
                const speedLimitInput = speedLimitValue?.trim() ?? "";
                const postedSpeedLimitKph =
                  speedLimitInput === "" ? undefined : Number(speedLimitInput);
                if (
                  ![widthMeters, heightMeters, uncertaintyMeters].every(Number.isFinite) ||
                  (postedSpeedLimitKph !== undefined && !Number.isFinite(postedSpeedLimitKph))
                ) {
                  return;
                }
                const nextEnvironment = structuredClone(replayCase.environment);
                nextEnvironment.roadCondition = data.get(
                  "road-condition",
                ) as ReplayCase["environment"]["roadCondition"];
                nextEnvironment.trafficSide = data.get(
                  "traffic-side",
                ) as ReplayCase["environment"]["trafficSide"];
                nextEnvironment.calibration = {
                  widthMeters,
                  heightMeters,
                  uncertaintyMeters,
                  source: data.get(
                    "calibration-source",
                  ) as ReplayCase["environment"]["calibration"]["source"],
                };
                if (postedSpeedLimitKph === undefined) {
                  delete nextEnvironment.postedSpeedLimitKph;
                } else {
                  nextEnvironment.postedSpeedLimitKph = postedSpeedLimitKph;
                }
                onUpdateEnvironment(nextEnvironment);
                event.currentTarget.closest("details")?.removeAttribute("open");
              }}
            >
              <header>
                <strong>Scene measurements and context</strong>
                <small>Values and sources remain inspectable in the case.</small>
              </header>
              <div className="scene-calibration-popover__content">
                <div className="scene-calibration-popover__grid">
                  <label>
                    <span>Width m</span>
                    <input
                      name="scene-width"
                      type="number"
                      min="10"
                      max="5000"
                      step="0.1"
                      defaultValue={replayCase.environment.calibration.widthMeters}
                      required
                    />
                  </label>
                  <label>
                    <span>Height m</span>
                    <input
                      name="scene-height"
                      type="number"
                      min="10"
                      max="5000"
                      step="0.1"
                      defaultValue={replayCase.environment.calibration.heightMeters}
                      required
                    />
                  </label>
                  <label>
                    <span>Uncertainty ±m</span>
                    <input
                      name="scene-uncertainty"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      defaultValue={replayCase.environment.calibration.uncertaintyMeters}
                      required
                    />
                  </label>
                  <label>
                    <span>Posted limit km/h (optional)</span>
                    <input
                      name="speed-limit"
                      type="number"
                      min="1"
                      max="300"
                      step="1"
                      defaultValue={replayCase.environment.postedSpeedLimitKph ?? ""}
                      placeholder={`Unknown · review default ${String(roadTemplate.defaultSpeedLimitKph)}`}
                      aria-describedby="speed-limit-source-hint"
                    />
                  </label>
                </div>
                <p id="speed-limit-source-hint">
                  Leave the posted limit blank unless a source establishes it. Motion review then
                  uses the {roadTemplate.defaultSpeedLimitKph} km/h template default without
                  recording that value as a posted limit.
                </p>
                <label>
                  <span>Calibration source</span>
                  <select
                    name="calibration-source"
                    defaultValue={replayCase.environment.calibration.source}
                  >
                    <option value="measured">Measured scene</option>
                    <option value="survey">Survey or measured plan</option>
                    <option value="map">Scaled map or aerial image</option>
                    <option value="template">Road template</option>
                    <option value="estimated">Human estimate</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </label>
                <div className="scene-calibration-popover__grid">
                  <label>
                    <span>Road condition</span>
                    <select
                      name="road-condition"
                      defaultValue={replayCase.environment.roadCondition}
                    >
                      <option value="dry">Dry</option>
                      <option value="wet">Wet</option>
                      <option value="unknown">Unknown</option>
                    </select>
                  </label>
                  <label>
                    <span>Traffic side</span>
                    <select name="traffic-side" defaultValue={replayCase.environment.trafficSide}>
                      <option value="right">Right</option>
                      <option value="left">Left</option>
                      <option value="unknown">Unknown</option>
                    </select>
                  </label>
                </div>
                <p>
                  Motion and contact checks use these values. Template or estimated calibration is
                  never presented as survey-grade evidence.
                </p>
              </div>
              <footer>
                <button className="button button--primary">Apply scene settings</button>
              </footer>
            </form>
          </details>
        </div>
        <div className="scene-toolbar__label">
          <span>
            {roadTemplate.label} · {activeBranch?.name ?? "Active reconstruction"}
          </span>
          <small>
            {replayCase.environment.calibration.widthMeters} ×{" "}
            {replayCase.environment.calibration.heightMeters} m ·{" "}
            {replayCase.environment.roadCondition} · {formatSceneSeconds(currentTimeMs)}s
          </small>
        </div>
        <div className="scene-toolbar__group">
          <button
            type="button"
            className="tool-button tool-button--icon"
            onClick={() => setZoom((value) => Math.max(0.7, value - 0.15))}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <Minus size={15} aria-hidden="true" />
          </button>
          <span className="zoom-value">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="tool-button tool-button--icon"
            onClick={() => setZoom((value) => Math.min(2.2, value + 0.15))}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <Plus size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="tool-button tool-button--icon"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            aria-label="Fit scene"
            title="Fit scene"
          >
            <Focus size={15} aria-hidden="true" />
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
          role="group"
          aria-label={`Editable road scene. Scene coordinates span X ${formatSceneCoordinate(sceneCoordinates.bounds.minX)} through ${formatSceneCoordinate(sceneCoordinates.bounds.maxX)} and Y ${formatSceneCoordinate(sceneCoordinates.bounds.minY)} through ${formatSceneCoordinate(sceneCoordinates.bounds.maxY)}. Use Tab to select a vehicle, arrow keys to move it, and bracket keys to rotate it.`}
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
            const marked = onMarkImpact(
              sceneCoordinates.clamp(sceneCoordinates.fromView(point)),
              impactPlacementContext,
            );
            if (marked) setImpactPlacementContext(undefined);
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
          <RoadTemplate
            sceneType={replayCase.environment.sceneType}
            {...(replayCase.environment.postedSpeedLimitKph !== undefined
              ? { postedSpeedLimitKph: replayCase.environment.postedSpeedLimitKph }
              : {})}
          />
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
          {configuredRoadBoundary && (
            <polygon
              className="configured-road-boundary"
              data-testid="configured-road-boundary"
              points={configuredRoadBoundary}
              aria-hidden="true"
            />
          )}

          {displayedPendingProposalChanges.map((change) => {
            const actor = replayCase.actors.find((candidate) => candidate.id === change.actorId);
            if (change.kind === "actor-pose") {
              if (
                change.targetTimeMs !== undefined &&
                currentTimeMs !== clampTimeToRange(change.targetTimeMs, replayCase.timeRangeMs)
              ) {
                return null;
              }
              const point = toView(change.proposedPose.x, change.proposedPose.y);
              const dimensions = actor?.dimensions ?? { width: 1.8, length: 4.3 };
              const geometry = vehicleViewGeometry(
                dimensions,
                change.proposedPose.rotationDeg,
                pixelsPerMeterX,
                pixelsPerMeterY,
              );
              return (
                <g
                  key={change.id}
                  className={`proposal-scene-actor${unverifiedPendingChangeIds.has(change.id) ? " is-unverified-import" : ""}`}
                  transform={`translate(${point.x} ${point.y})`}
                  aria-hidden="true"
                >
                  <polygon points={polygonPoints(geometry.corners)} />
                  <text x="0" y={geometry.halfLengthPixels + 22} textAnchor="middle">
                    Proposed {actor?.label ?? "vehicle"}
                    {change.targetTimeMs === undefined
                      ? ""
                      : ` at ${formatSceneSeconds(change.targetTimeMs)} s`}
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
              <g
                key={change.id}
                className={`proposal-scene-path${unverifiedPendingChangeIds.has(change.id) ? " is-unverified-import" : ""}`}
                aria-hidden="true"
              >
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
              const sampledPoints =
                drag?.kind === "keyframe" && drag.trajectoryId === trajectory.id
                  ? points
                  : sampleTrajectory(trajectory).map((pose) => toView(pose.x, pose.y));
              const path = sampledPoints
                .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
                .join(" ");
              const selected = selectedId === trajectory.id;
              const active = trajectory.branchId === replayCase.activeBranchId;
              const owningActor = replayCase.actors.find(
                (actor) => actor.id === trajectory.actorId,
              );
              const pathLocked = trajectory.locked || Boolean(owningActor?.locked);
              const acceptedProposalTrust = acceptedProposalGeometryTrust.trajectoryIds.get(
                trajectory.id,
              );
              const agentAuthored =
                (!acceptedProposalTrust && trajectory.createdBy === "agent") ||
                trajectory.changeHistory.at(-1)?.author === "agent";
              const provenanceLabel =
                acceptedProposalTrust === "local-human-attested"
                  ? "human-accepted agent proposal "
                  : acceptedProposalTrust === "unverified-import"
                    ? "unverified imported proposal "
                    : agentAuthored
                      ? "agent-authored "
                      : "";
              return (
                <g
                  key={trajectory.id}
                  className={`trajectory trajectory--branch-${branchIndex % 3}${selected ? " is-selected" : ""}${active ? " is-active" : " is-overlay"}${agentAuthored ? " is-agent-authored" : ""}${acceptedProposalTrust === "local-human-attested" ? " is-accepted-agent-proposal" : ""}${acceptedProposalTrust === "unverified-import" ? " is-unverified-imported-proposal" : ""}`}
                >
                  <path
                    className="trajectory__hit"
                    d={path}
                    tabIndex={placingImpact ? -1 : 0}
                    role="button"
                    aria-label={`Select ${provenanceLabel}path for ${replayCase.actors.find((actor) => actor.id === trajectory.actorId)?.label ?? "vehicle"}`}
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
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                onSelectKeyframe(trajectory.id, frame.id);
                                return;
                              }
                              let x = frame.x;
                              let y = frame.y;
                              if (event.key === "ArrowLeft")
                                x -= sceneCoordinates.keyboardStep("x", event.shiftKey);
                              else if (event.key === "ArrowRight")
                                x += sceneCoordinates.keyboardStep("x", event.shiftKey);
                              else if (event.key === "ArrowUp")
                                y -= sceneCoordinates.keyboardStep("y", event.shiftKey);
                              else if (event.key === "ArrowDown")
                                y += sceneCoordinates.keyboardStep("y", event.shiftKey);
                              else return;
                              event.preventDefault();
                              if (!pathLocked) {
                                onSelectKeyframe(trajectory.id, frame.id);
                                const bounded = sceneCoordinates.clamp({ x, y });
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
                  worldX={
                    ((pose.x - replayCase.environment.bounds.minX) /
                      (replayCase.environment.bounds.maxX - replayCase.environment.bounds.minX)) *
                    replayCase.environment.calibration.widthMeters
                  }
                  worldY={
                    ((pose.y - replayCase.environment.bounds.minY) /
                      (replayCase.environment.bounds.maxY - replayCase.environment.bounds.minY)) *
                    replayCase.environment.calibration.heightMeters
                  }
                  sceneX={pose.x}
                  sceneY={pose.y}
                  pixelsPerMeterX={pixelsPerMeterX}
                  pixelsPerMeterY={pixelsPerMeterY}
                  rotation={pose.rotationDeg}
                  selected={selectedId === actor.id}
                  editLocked={isActorEditLocked(actor)}
                  agentActive={activeAgentIds.includes(actor.id)}
                  authorship={
                    acceptedProposalGeometryTrust.actorIds.get(actor.id) === "local-human-attested"
                      ? "accepted-proposal"
                      : acceptedProposalGeometryTrust.actorIds.get(actor.id) === "unverified-import"
                        ? "unverified-proposal"
                        : actor.lastEditedBy === "agent"
                          ? "agent"
                          : actor.lastEditedBy === "human"
                            ? "human"
                            : "legacy"
                  }
                  contactState={contactStateByActor.get(actor.id) ?? "clear"}
                  labelDirection={labelDirectionByActor.get(actor.id) ?? 1}
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

          {reviewedTrajectoryPoint && (
            <g
              className={`proposal-scene-review${unverifiedPendingChangeIds.has(reviewedTrajectoryPoint.change.id) ? " is-unverified-import" : ""}`}
              aria-hidden="true"
              data-testid="proposal-scene-review"
            >
              {reviewedTrajectoryPoint.baseKeyframe && reviewedTrajectoryPoint.proposedKeyframe && (
                <line
                  x1={
                    toView(
                      reviewedTrajectoryPoint.baseKeyframe.x,
                      reviewedTrajectoryPoint.baseKeyframe.y,
                    ).x
                  }
                  y1={
                    toView(
                      reviewedTrajectoryPoint.baseKeyframe.x,
                      reviewedTrajectoryPoint.baseKeyframe.y,
                    ).y
                  }
                  x2={
                    toView(
                      reviewedTrajectoryPoint.proposedKeyframe.x,
                      reviewedTrajectoryPoint.proposedKeyframe.y,
                    ).x
                  }
                  y2={
                    toView(
                      reviewedTrajectoryPoint.proposedKeyframe.x,
                      reviewedTrajectoryPoint.proposedKeyframe.y,
                    ).y
                  }
                />
              )}
              {reviewedTrajectoryPoint.baseKeyframe &&
                (() => {
                  const point = toView(
                    reviewedTrajectoryPoint.baseKeyframe.x,
                    reviewedTrajectoryPoint.baseKeyframe.y,
                  );
                  return (
                    <circle
                      className="proposal-scene-review__base"
                      cx={point.x}
                      cy={point.y}
                      r="8"
                    />
                  );
                })()}
              {reviewedTrajectoryPoint.proposedKeyframe &&
                (() => {
                  const point = toView(
                    reviewedTrajectoryPoint.proposedKeyframe.x,
                    reviewedTrajectoryPoint.proposedKeyframe.y,
                  );
                  const dimensions = reviewedTrajectoryPoint.actor?.dimensions ?? {
                    width: 1.8,
                    length: 4.3,
                  };
                  const geometry = vehicleViewGeometry(
                    dimensions,
                    reviewedTrajectoryPoint.proposedKeyframe.rotationDeg,
                    pixelsPerMeterX,
                    pixelsPerMeterY,
                  );
                  return (
                    <g
                      className="proposal-scene-actor proposal-scene-actor--review"
                      transform={`translate(${point.x} ${point.y})`}
                    >
                      <circle className="proposal-scene-review__point" r="10" />
                      <polygon points={polygonPoints(geometry.corners)} />
                      <text x="0" y={geometry.halfLengthPixels + 22} textAnchor="middle">
                        Proposed {reviewedTrajectoryPoint.actor?.label ?? "vehicle"} ·{" "}
                        {reviewedTrajectoryPoint.target.reviewTimeMs !==
                        Math.round(reviewedTrajectoryPoint.target.proposalTimeMs)
                          ? `point ${formatSceneSeconds(reviewedTrajectoryPoint.target.proposalTimeMs)} s · viewed ${formatSceneSeconds(reviewedTrajectoryPoint.target.reviewTimeMs)} s`
                          : `${formatSceneSeconds(reviewedTrajectoryPoint.target.reviewTimeMs)} s`}
                      </text>
                    </g>
                  );
                })()}
              {!reviewedTrajectoryPoint.proposedKeyframe &&
                reviewedTrajectoryPoint.baseKeyframe &&
                (() => {
                  const point = toView(
                    reviewedTrajectoryPoint.baseKeyframe.x,
                    reviewedTrajectoryPoint.baseKeyframe.y,
                  );
                  return (
                    <path
                      className="proposal-scene-review__removed"
                      d={`M${String(point.x - 8)},${String(point.y - 8)}L${String(point.x + 8)},${String(point.y + 8)}M${String(point.x + 8)},${String(point.y - 8)}L${String(point.x - 8)},${String(point.y + 8)}`}
                    />
                  );
                })()}
            </g>
          )}

          {activeImpacts.map((impactEvent) => {
            if (!impactEvent.location) return null;
            const point = toView(impactEvent.location.x, impactEvent.location.y);
            const linkedActorLabels = [...new Set(impactEvent.linkedActorIds)].map((actorId) =>
              actorLabelForId(replayCase.actors, actorId),
            );
            return (
              <ImpactMarker
                key={impactEvent.id}
                event={impactEvent}
                x={point.x}
                y={point.y}
                selected={selectedId === impactEvent.id}
                showLabel={selectedId === impactEvent.id && contactDisplayState === "clear"}
                zoom={zoom}
                placementMode={placingImpact}
                actorDescription={impactActorDescription(
                  impactEvent.linkedActorIds,
                  replayCase.actors,
                )}
                compactActorLabel={linkedActorLabels.map(actorBadge).join("/")}
                onSelect={() => onSelect("timeline-event", impactEvent.id)}
              />
            );
          })}

          {currentPairGeometry
            .filter(
              (pair) =>
                pair.state !== "clear" && !(pair.state === "recorded" && pair.matchingImpact),
            )
            .map((pair) => {
              const first = toView(pair.firstPose.x, pair.firstPose.y);
              const second = toView(pair.secondPose.x, pair.secondPose.y);
              const marker = pair.matchingImpact?.location
                ? toView(pair.matchingImpact.location.x, pair.matchingImpact.location.y)
                : { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
              return (
                <ContactGeometryMarker
                  key={`${pair.first.id}-${pair.second.id}`}
                  x={marker.x}
                  y={marker.y}
                  state={pair.state}
                  zoom={zoom}
                />
              );
            })}
        </svg>

        <div
          className={`scene-contact-readout is-${contactDisplayState}${selectedId ? " has-selection-actions" : ""}`}
          data-contact-state={contactDisplayState}
          role="group"
          aria-label={`${contactReadoutContent.title}. ${contactReadoutContent.detail}. Geometry only; not proof of physical contact.`}
        >
          <i aria-hidden="true" />
          <span>
            <strong>{contactReadoutContent.title}</strong>
            <small>{contactReadoutContent.detail}</small>
          </span>
        </div>
        <span className="visually-hidden" role="status" aria-live="polite">
          {contactReadoutContent.title}
        </span>

        <div className="scene-legend" role="group" aria-label="Scene legend">
          <span>
            <i className="legend-line legend-line--solid" /> Current branch
          </span>
          {configuredRoadBoundary && (
            <span>
              <i className="legend-line legend-line--road-boundary" /> Configured road boundary
            </span>
          )}
          {comparisonBranchIds.length > 0 && (
            <span>
              <i className="legend-line legend-line--dashed" /> Compared branch
            </span>
          )}
          {hasTrustedPendingProposal && (
            <span>
              <i className="legend-line legend-line--proposal" /> Agent proposal
            </span>
          )}
          {hasUnverifiedPendingProposal && (
            <span>
              <i className="legend-line legend-line--unverified" /> Unverified imported proposal
            </span>
          )}
          {hasAgentAuthoredPath && (
            <span>
              <i className="legend-line legend-line--agent" /> Agent-authored geometry
            </span>
          )}
          {hasDirectAgentActorGeometry && (
            <span>
              <i className="legend-box legend-box--agent" /> Agent-authored vehicle geometry
            </span>
          )}
          {hasAcceptedAgentGeometry && (
            <span>
              <i className="legend-line legend-line--accepted" /> Human-accepted agent proposal
            </span>
          )}
          {hasUnverifiedImportedGeometry && (
            <span>
              <i className="legend-line legend-line--unverified" /> Unverified imported proposal
              geometry
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
              <Crosshair size={14} /> Contact: {impactPlacementPairLabel}. Click the scene or enter
              exact coordinates. The marker remains uncertain until evidence supports it.
            </p>
            <form
              key={JSON.stringify([
                impactPlacementContext.branchId,
                impactPlacementContext.timeMs,
                ...impactPlacementContext.actorIds,
                placementImpact?.id ?? null,
                placementImpact?.location?.x ?? sceneCoordinates.center.x,
                placementImpact?.location?.y ?? sceneCoordinates.center.y,
              ])}
              aria-label={`Place approximate impact by coordinates for ${impactPlacementPairLabel ?? "the selected vehicles"}`}
              onSubmit={placeImpactByCoordinates}
            >
              {replayCase.actors.length > 2 && (
                <fieldset className="scene-impact-pair">
                  <legend>Vehicles involved</legend>
                  <label>
                    <span>First vehicle</span>
                    <select
                      value={impactPlacementContext.actorIds[0]}
                      onChange={(event) => updateImpactPlacementActor(0, event.target.value)}
                    >
                      {replayCase.actors.map((actor) => (
                        <option key={actor.id} value={actor.id}>
                          {actor.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Second vehicle</span>
                    <select
                      value={impactPlacementContext.actorIds[1]}
                      onChange={(event) => updateImpactPlacementActor(1, event.target.value)}
                    >
                      {replayCase.actors.map((actor) => (
                        <option key={actor.id} value={actor.id}>
                          {actor.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </fieldset>
              )}
              <label>
                <span>X</span>
                <input
                  name="impact-x"
                  type="number"
                  min={sceneCoordinates.bounds.minX}
                  max={sceneCoordinates.bounds.maxX}
                  step="any"
                  defaultValue={placementImpact?.location?.x ?? sceneCoordinates.center.x}
                  required
                />
              </label>
              <label>
                <span>Y</span>
                <input
                  name="impact-y"
                  type="number"
                  min={sceneCoordinates.bounds.minY}
                  max={sceneCoordinates.bounds.maxY}
                  step="any"
                  defaultValue={placementImpact?.location?.y ?? sceneCoordinates.center.y}
                  required
                />
              </label>
              <button
                className="button button--primary"
                aria-label={`Place contact between ${impactPlacementPairLabel ?? "the selected vehicles"}`}
              >
                Place
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => setImpactPlacementContext(undefined)}
              >
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
              <button
                className="tool-button"
                onClick={() => {
                  setDamageActorId(selectedActor.id);
                  setDamageRegion("unknown");
                  setDamageDescription("");
                }}
              >
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

      {damageActor && (
        <form
          className="scene-popover"
          onSubmit={(event) => {
            event.preventDefault();
            if (!damageDescription.trim()) return;
            const marked = onMarkDamage(damageActor.id, damageRegion, damageDescription.trim());
            if (!marked) return;
            setDamageDescription("");
            setDamageActorId(undefined);
          }}
        >
          <header>
            <div>
              <small>Vehicle observation</small>
              <strong>Mark damage on {damageActor.label}</strong>
            </div>
            <button
              type="button"
              onClick={() => setDamageActorId(undefined)}
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

function RoadTemplate({
  sceneType,
  postedSpeedLimitKph,
}: {
  sceneType: RoadSceneType;
  postedSpeedLimitKph?: number;
}) {
  if (sceneType === "roundabout") return <RoundaboutTemplate />;
  if (sceneType === "intersection") return <IntersectionTemplate />;
  if (sceneType === "t-junction") return <TJunctionTemplate />;
  if (sceneType === "straight-road") return <StraightRoadTemplate />;
  return (
    <ParkingAreaTemplate {...(postedSpeedLimitKph !== undefined ? { postedSpeedLimitKph } : {})} />
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

function TJunctionTemplate() {
  return (
    <g className="road-template" aria-hidden="true">
      <rect x="0" y="182" width="1000" height="168" className="road-surface" />
      <rect x="410" y="266" width="180" height="434" className="road-surface" />
      <path className="lane-boundary" d="M0 266h410M590 266h410M500 350v350" />
      <path className="stop-line" d="M410 382h180" />
      <path
        className="direction-arrow"
        d="M180 240l28 26-28 26M820 292l-28-26 28-26M470 560l30-28 30 28"
      />
      {[0, 1, 2, 3, 4].map((index) => (
        <rect
          key={`junction-crosswalk-${String(index)}`}
          x={415 + index * 36}
          y="333"
          width="20"
          height="44"
          className="crosswalk"
        />
      ))}
    </g>
  );
}

function StraightRoadTemplate() {
  return (
    <g className="road-template" aria-hidden="true">
      <rect x="0" y="245" width="1000" height="210" className="road-surface" />
      <path className="road-edge" d="M0 245h1000M0 455h1000" />
      <path className="lane-boundary" d="M0 350h1000" />
      <path className="direction-arrow" d="M180 315l30 35-30 35M820 385l-30-35 30-35" />
      <path className="stop-line" d="M330 245v210M670 245v210" opacity="0.28" />
    </g>
  );
}

function ParkingAreaTemplate({ postedSpeedLimitKph }: { postedSpeedLimitKph?: number }) {
  const bayColumns = Array.from({ length: 10 }, (_, index) => 85 + index * 83);
  return (
    <g className="road-template parking-template" aria-hidden="true">
      <rect x="60" y="56" width="880" height="588" rx="12" className="road-surface" />
      <rect x="60" y="280" width="880" height="140" className="parking-aisle" />
      <path className="lane-boundary" d="M60 350h880" />
      {bayColumns.map((x) => (
        <g key={`parking-bays-${String(x)}`}>
          <path className="parking-bay" d={`M${String(x)} 76v170h62V76`} />
          <path className="parking-bay" d={`M${String(x)} 624V454h62v170`} />
        </g>
      ))}
      <path className="direction-arrow" d="M235 325l28 25-28 25M765 375l-28-25 28-25" />
      {postedSpeedLimitKph !== undefined && (
        <text x="82" y="342" className="parking-speed-label">
          {postedSpeedLimitKph}
        </text>
      )}
    </g>
  );
}

interface VehicleProps {
  actor: SceneActor;
  x: number;
  y: number;
  worldX: number;
  worldY: number;
  sceneX: number;
  sceneY: number;
  pixelsPerMeterX: number;
  pixelsPerMeterY: number;
  rotation: number;
  selected: boolean;
  editLocked: boolean;
  agentActive: boolean;
  authorship: "human" | "agent" | "accepted-proposal" | "unverified-proposal" | "legacy";
  contactState: CurrentPairGeometry["state"];
  labelDirection: -1 | 1;
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
  worldX,
  worldY,
  sceneX,
  sceneY,
  pixelsPerMeterX,
  pixelsPerMeterY,
  rotation,
  selected,
  editLocked,
  agentActive,
  authorship,
  contactState,
  labelDirection,
  placementMode,
  onPointerDown,
  onRotatePointerDown,
  onClick,
  onKeyDown,
}: VehicleProps) {
  const blue = actor.colorToken.includes("blue");
  const damage = actor.damageMarkers;
  const geometry = vehicleViewGeometry(
    actor.dimensions,
    rotation,
    pixelsPerMeterX,
    pixelsPerMeterY,
  );
  const labelSide = -labelDirection;
  const badgeDistance = geometry.halfLengthPixels + 20;
  const labelDistance = geometry.halfLengthPixels + 48;
  const badgePoint = {
    x: geometry.forwardUnit.x * badgeDistance * labelSide,
    y: geometry.forwardUnit.y * badgeDistance * labelSide,
  };
  const labelPoint = {
    x: geometry.forwardUnit.x * labelDistance * labelSide,
    y: geometry.forwardUnit.y * labelDistance * labelSide,
  };
  const rotationLineStart = {
    x: geometry.forwardUnit.x * (geometry.halfLengthPixels + 5),
    y: geometry.forwardUnit.y * (geometry.halfLengthPixels + 5),
  };
  const rotationHandle = {
    x: geometry.forwardUnit.x * (geometry.halfLengthPixels + 38),
    y: geometry.forwardUnit.y * (geometry.halfLengthPixels + 38),
  };
  const viewOffset = (forwardM: number, rightM: number): Point => ({
    x: geometry.forwardPerMeter.x * forwardM + geometry.rightPerMeter.x * rightM,
    y: geometry.forwardPerMeter.y * forwardM + geometry.rightPerMeter.y * rightM,
  });
  const halfLengthM = actor.dimensions.length / 2;
  const halfWidthM = actor.dimensions.width / 2;
  const damageOffsetByRegion: Record<DamageMarker["region"], Point> = {
    front: viewOffset(halfLengthM, 0),
    "front-left": viewOffset(halfLengthM * 0.82, -halfWidthM),
    "front-right": viewOffset(halfLengthM * 0.82, halfWidthM),
    "left-side": viewOffset(0, -halfWidthM),
    "right-side": viewOffset(0, halfWidthM),
    "rear-left": viewOffset(-halfLengthM * 0.82, -halfWidthM),
    "rear-right": viewOffset(-halfLengthM * 0.82, halfWidthM),
    rear: viewOffset(-halfLengthM, 0),
    unknown: { x: 0, y: 0 },
  };
  const authorshipPoint = viewOffset(halfLengthM, 0);
  const lockPoint = geometry.corners[1];
  return (
    <g
      className={`scene-vehicle${selected ? " is-selected" : ""}${editLocked ? " is-locked" : ""}${agentActive ? " is-agent-active" : ""}${authorship === "agent" ? " is-agent-authored" : ""}${authorship === "accepted-proposal" ? " is-accepted-agent-proposal" : ""}${authorship === "unverified-proposal" ? " is-unverified-imported-proposal" : ""}${contactState !== "clear" ? ` has-contact-state is-contact-${contactState}` : ""}`}
      transform={`translate(${x} ${y})`}
      tabIndex={0}
      role="button"
      aria-label={`${actor.label}, position ${worldX.toFixed(1)} metres east and ${worldY.toFixed(1)} metres south of the calibrated scene origin, scene coordinate X ${formatSceneCoordinate(sceneX)} and Y ${formatSceneCoordinate(sceneY)}, ${actor.dimensions.length.toFixed(2)} by ${actor.dimensions.width.toFixed(2)} metres, orientation ${Math.round(rotation)} degrees${authorship === "accepted-proposal" ? ", geometry from a human-accepted agent proposal" : authorship === "unverified-proposal" ? ", geometry from an unverified imported proposal" : authorship === "agent" ? ", agent-authored geometry" : ""}${editLocked ? ", locked. Unlock the vehicle and its path to edit" : ". Use arrow keys to move and bracket keys to rotate"}.`}
      aria-pressed={selected}
      onPointerDown={onPointerDown}
      onClick={(event) => {
        if (placementMode) return;
        event.stopPropagation();
        onClick(event);
      }}
      onKeyDown={onKeyDown}
    >
      <title>{actor.label}</title>
      <polygon
        className="vehicle-hit"
        points={polygonPoints(geometry.corners)}
        aria-hidden="true"
      />
      <polygon className="vehicle-selection" points={polygonPoints(geometry.corners)} />
      {selected && !editLocked && (
        <g className="vehicle-rotation-control" aria-hidden="true">
          <line
            x1={rotationLineStart.x}
            y1={rotationLineStart.y}
            x2={rotationHandle.x - geometry.forwardUnit.x * 6}
            y2={rotationHandle.y - geometry.forwardUnit.y * 6}
          />
          <circle
            className="vehicle-rotation-control__hit"
            cx={rotationHandle.x}
            cy={rotationHandle.y}
            r="22"
            onPointerDown={onRotatePointerDown}
          />
          <circle
            className="vehicle-rotation-control__knob"
            cx={rotationHandle.x}
            cy={rotationHandle.y}
            r="10"
          />
          <path
            d="M-4-1a5 5 0 0 1 8 0M4-1l-1-5 5 2"
            transform={`translate(${rotationHandle.x} ${rotationHandle.y})`}
          />
        </g>
      )}
      <g filter="url(#vehicle-shadow)" transform={`matrix(${geometry.bodyMatrix})`}>
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
      <g
        className="vehicle-identity-badge"
        transform={`translate(${badgePoint.x} ${badgePoint.y})`}
      >
        <circle r="12" />
        <text x="0" y="4" textAnchor="middle">
          {actorBadge(actor.label)}
        </text>
      </g>
      {selected && (
        <text className="vehicle-label" x={labelPoint.x} y={labelPoint.y} textAnchor="middle">
          {actor.label}
        </text>
      )}
      {(authorship === "agent" ||
        authorship === "accepted-proposal" ||
        authorship === "unverified-proposal") && (
        <text
          className="vehicle-authorship-badge"
          x={authorshipPoint.x + geometry.forwardUnit.x * 11}
          y={authorshipPoint.y + geometry.forwardUnit.y * 11}
          textAnchor="middle"
        >
          {authorship === "agent"
            ? "AGENT"
            : authorship === "accepted-proposal"
              ? "HUMAN ACCEPTED"
              : "UNVERIFIED"}
        </text>
      )}
      {damage.map((marker) => (
        <DamageGlyph
          key={marker.id}
          x={damageOffsetByRegion[marker.region].x}
          y={damageOffsetByRegion[marker.region].y}
        />
      ))}
      {editLocked && <LockGlyph x={lockPoint.x + 5} y={lockPoint.y - 6} />}
    </g>
  );
}

function DamageGlyph({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle className="damage-glyph" r="6" />
      <path d="m-2-1 3-2-1 3 3 1-3 1 1 3-3-2-2 2 1-3-3-1 3-1Z" className="damage-glyph__mark" />
    </g>
  );
}

function ContactGeometryMarker({
  x,
  y,
  state,
  zoom,
}: {
  x: number;
  y: number;
  state: CurrentPairGeometry["state"];
  zoom: number;
}) {
  const label =
    state === "recorded"
      ? "CONTACT"
      : state === "touching"
        ? "TOUCHING"
        : state === "excessive"
          ? "DEEP OVERLAP"
          : "UNMARKED OVERLAP";
  return (
    <g
      className={`contact-geometry-marker is-${state}`}
      transform={`translate(${x} ${y}) scale(${1 / zoom})`}
      aria-hidden="true"
    >
      <circle r="31" />
      <circle r="9" />
      <path d="M-18 0h36M0-18v36" />
      {state !== "recorded" && (
        <text x="38" y="5">
          {label}
        </text>
      )}
    </g>
  );
}

function ImpactMarker({
  event,
  x,
  y,
  selected,
  showLabel,
  zoom,
  placementMode,
  actorDescription,
  compactActorLabel,
  onSelect,
}: {
  event: TimelineEvent;
  x: number;
  y: number;
  selected: boolean;
  showLabel: boolean;
  zoom: number;
  placementMode: boolean;
  actorDescription: string;
  compactActorLabel: string;
  onSelect: () => void;
}) {
  if (!event.location) return null;
  return (
    <g
      className={`impact-marker certainty--${event.certainty}${selected ? " is-selected" : ""}`}
      transform={`translate(${x} ${y}) scale(${1 / zoom})`}
      tabIndex={placementMode ? -1 : 0}
      role="button"
      aria-label={`Approximate impact at ${formatSceneSeconds(event.timeMs)} seconds, ${event.certainty}, ${actorDescription}, scene coordinate X ${formatSceneCoordinate(event.location.x)} and Y ${formatSceneCoordinate(event.location.y)}`}
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
      <path className="impact-marker__hit" d="M0 0h0.01" aria-hidden="true" />
      {showLabel && (
        <text x="30" y="-13">
          Impact · {formatSceneSeconds(event.timeMs)}s
          {compactActorLabel ? ` · ${compactActorLabel}` : ""}
        </text>
      )}
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
