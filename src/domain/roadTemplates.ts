import type { ActorPose, Point, RoadSceneType } from "./models";

export const SCENE_VIEW_WIDTH = 1_000;
export const SCENE_VIEW_HEIGHT = 700;

export interface RoadTemplateDefinition {
  id: string;
  sceneType: RoadSceneType;
  label: string;
  shortLabel: string;
  description: string;
  calibration: {
    widthMeters: number;
    heightMeters: number;
    uncertaintyMeters: number;
  };
  defaultSpeedLimitKph: number;
  initialActorPoses: ActorPose[];
}

export const ROAD_TEMPLATES: readonly RoadTemplateDefinition[] = [
  {
    id: "scene-european-roundabout",
    sceneType: "roundabout",
    label: "European two-lane roundabout",
    shortLabel: "Roundabout",
    description: "Four approaches, two circulating lanes, and a central island.",
    calibration: { widthMeters: 100, heightMeters: 70, uncertaintyMeters: 1 },
    defaultSpeedLimitKph: 40,
    initialActorPoses: [
      { x: 24, y: 56.4, rotationDeg: 90 },
      { x: 76, y: 43.6, rotationDeg: 270 },
      { x: 45.5, y: 20, rotationDeg: 180 },
      { x: 54.5, y: 80, rotationDeg: 0 },
      { x: 35, y: 65, rotationDeg: 125 },
      { x: 65, y: 35, rotationDeg: 305 },
    ],
  },
  {
    id: "scene-four-way-intersection",
    sceneType: "intersection",
    label: "Four-way urban intersection",
    shortLabel: "Intersection",
    description: "Two-way crossing roads with stop lines and pedestrian crossings.",
    calibration: { widthMeters: 100, heightMeters: 70, uncertaintyMeters: 1 },
    defaultSpeedLimitKph: 50,
    initialActorPoses: [
      { x: 24, y: 56.4, rotationDeg: 90 },
      { x: 76, y: 43.6, rotationDeg: 270 },
      { x: 45.5, y: 20, rotationDeg: 180 },
      { x: 54.5, y: 80, rotationDeg: 0 },
    ],
  },
  {
    id: "scene-t-junction",
    sceneType: "t-junction",
    label: "Urban T-junction",
    shortLabel: "T-junction",
    description: "A minor two-way road meeting a continuous two-way road.",
    calibration: { widthMeters: 100, heightMeters: 70, uncertaintyMeters: 1 },
    defaultSpeedLimitKph: 50,
    initialActorPoses: [
      { x: 25, y: 38, rotationDeg: 90 },
      { x: 50, y: 82, rotationDeg: 0 },
      { x: 75, y: 32, rotationDeg: 270 },
      { x: 54, y: 64, rotationDeg: 180 },
    ],
  },
  {
    id: "scene-straight-two-way-road",
    sceneType: "straight-road",
    label: "Straight two-way road",
    shortLabel: "Straight road",
    description: "A calibrated two-way segment for rear-end, passing, and lane-change accounts.",
    calibration: { widthMeters: 100, heightMeters: 70, uncertaintyMeters: 1.5 },
    defaultSpeedLimitKph: 80,
    initialActorPoses: [
      { x: 24, y: 56, rotationDeg: 90 },
      { x: 68, y: 44, rotationDeg: 270 },
      { x: 42, y: 56, rotationDeg: 90 },
      { x: 82, y: 44, rotationDeg: 270 },
    ],
  },
  {
    id: "scene-parking-aisle",
    sceneType: "parking-area",
    label: "Car park aisle",
    shortLabel: "Parking area",
    description: "Low-speed drive aisle with opposing parking bays and reversing space.",
    calibration: { widthMeters: 70, heightMeters: 49, uncertaintyMeters: 0.75 },
    defaultSpeedLimitKph: 15,
    initialActorPoses: [
      { x: 28, y: 50, rotationDeg: 90 },
      { x: 72, y: 50, rotationDeg: 270 },
      { x: 42, y: 22, rotationDeg: 180 },
      { x: 58, y: 78, rotationDeg: 0 },
    ],
  },
] as const;

export function getRoadTemplate(sceneType: RoadSceneType): RoadTemplateDefinition {
  const template = ROAD_TEMPLATES.find((candidate) => candidate.sceneType === sceneType);
  if (!template) throw new Error(`Unknown road scene type: ${sceneType}`);
  return template;
}

export function normalizedToView(point: Point): Point {
  return { x: point.x * 10, y: point.y * 7 };
}

export function viewToNormalized(point: Point): Point {
  return {
    x: Math.max(0, Math.min(100, point.x / 10)),
    y: Math.max(0, Math.min(100, point.y / 7)),
  };
}

function nearestCandidate(point: Point, candidates: Point[], captureDistanceView = 32): Point {
  const viewPoint = normalizedToView(point);
  const closest = candidates
    .map((candidate) => ({
      candidate,
      distance: Math.hypot(
        normalizedToView(candidate).x - viewPoint.x,
        normalizedToView(candidate).y - viewPoint.y,
      ),
    }))
    .sort((left, right) => left.distance - right.distance)[0];
  return closest && closest.distance <= captureDistanceView ? closest.candidate : point;
}

/** Returns a nearby lane-centre projection without changing heading. */
export function snapPointToRoadLane(sceneType: RoadSceneType, point: Point): Point {
  if (sceneType === "roundabout") {
    const viewPoint = normalizedToView(point);
    const dx = viewPoint.x - SCENE_VIEW_WIDTH / 2;
    const dy = viewPoint.y - SCENE_VIEW_HEIGHT / 2;
    const radialDistance = Math.hypot(dx, dy) || 1;
    const candidates: Point[] = [];
    if (Math.abs(dx) >= 180 && Math.abs(dy) <= 105) {
      candidates.push(
        viewToNormalized({ x: viewPoint.x, y: SCENE_VIEW_HEIGHT / 2 - 45 }),
        viewToNormalized({ x: viewPoint.x, y: SCENE_VIEW_HEIGHT / 2 + 45 }),
      );
    }
    if (Math.abs(dy) >= 130 && Math.abs(dx) <= 115) {
      candidates.push(
        viewToNormalized({ x: SCENE_VIEW_WIDTH / 2 - 45, y: viewPoint.y }),
        viewToNormalized({ x: SCENE_VIEW_WIDTH / 2 + 45, y: viewPoint.y }),
      );
    }
    for (const radius of [134, 180]) {
      candidates.push(
        viewToNormalized({
          x: SCENE_VIEW_WIDTH / 2 + (dx / radialDistance) * radius,
          y: SCENE_VIEW_HEIGHT / 2 + (dy / radialDistance) * radius,
        }),
      );
    }
    return nearestCandidate(point, candidates, 30);
  }

  if (sceneType === "intersection") {
    return nearestCandidate(point, [
      { x: point.x, y: 43.6 },
      { x: point.x, y: 56.4 },
      { x: 45.5, y: point.y },
      { x: 54.5, y: point.y },
    ]);
  }

  if (sceneType === "t-junction") {
    return nearestCandidate(point, [
      { x: point.x, y: 34 },
      { x: point.x, y: 42 },
      { x: 46, y: point.y },
      { x: 54, y: point.y },
    ]);
  }

  if (sceneType === "straight-road") {
    return nearestCandidate(point, [
      { x: point.x, y: 44 },
      { x: point.x, y: 56 },
    ]);
  }

  return nearestCandidate(point, [
    { x: point.x, y: 46 },
    { x: point.x, y: 54 },
    { x: 42, y: point.y },
    { x: 58, y: point.y },
  ]);
}

/** Template-level drivable-area check. This is a plausibility aid, not map-survey evidence. */
export function isPointOnTemplateRoad(sceneType: RoadSceneType, point: Point): boolean {
  const { x, y } = point;
  if (x < 0 || x > 100 || y < 0 || y > 100) return false;

  if (sceneType === "intersection") {
    return (x >= 39.5 && x <= 60.5) || (y >= 35 && y <= 65);
  }
  if (sceneType === "t-junction") {
    return (y >= 26 && y <= 50) || (x >= 41 && x <= 59 && y >= 38);
  }
  if (sceneType === "straight-road") {
    return y >= 35 && y <= 65;
  }
  if (sceneType === "parking-area") {
    return x >= 6 && x <= 94 && y >= 8 && y <= 92;
  }

  const viewPoint = normalizedToView(point);
  const dx = viewPoint.x - SCENE_VIEW_WIDTH / 2;
  const dy = viewPoint.y - SCENE_VIEW_HEIGHT / 2;
  const insideOuterRoundabout = Math.hypot(dx, dy) <= 205;
  const insideIsland = Math.hypot(dx, dy) < 114;
  const onHorizontalApproach = Math.abs(dy) <= 90;
  const onVerticalApproach = Math.abs(dx) <= 90;
  return !insideIsland && (insideOuterRoundabout || onHorizontalApproach || onVerticalApproach);
}
