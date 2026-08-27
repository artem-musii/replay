import { validateConsistency } from "./consistency";
import { REPLAY_SCHEMA_VERSION, REPLAY_SEED_VERSION } from "./models";
import type {
  ChangeRecord,
  Claim,
  EvidenceAsset,
  ReplayCase,
  TimelineEvent,
  Trajectory,
} from "./models";
import { parseReplayCase } from "./schema";

const CREATED_AT = "2026-05-17T15:42:00.000Z";

function initialChange(
  id: string,
  summary: string,
  author: "human" | "system" = "human",
): ChangeRecord {
  return {
    id: `change-${id}`,
    caseVersion: 1,
    author,
    origin: author === "human" ? "ui" : "system",
    summary,
    createdAt: CREATED_AT,
  };
}

function claim(
  id: string,
  statement: string,
  status: Claim["status"],
  sourceType: Claim["sourceType"],
  options: Partial<Claim> = {},
): Claim {
  const confirmed = status === "confirmed";
  return {
    id,
    statement,
    status,
    sourceType,
    sourceIds: [],
    linkedEvidenceIds: [],
    linkedEventIds: [],
    linkedSceneObjectIds: [],
    sharedAcrossBranches: true,
    createdBy: "human",
    humanConfirmed: confirmed,
    ...(confirmed ? { confirmedAt: CREATED_AT } : {}),
    locked: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    changeHistory: [
      initialChange(
        id,
        confirmed
          ? "Human confirmed this seeded demo observation."
          : "Human supplied this seeded demo detail.",
      ),
    ],
    ...options,
  };
}

function trajectory(
  id: string,
  actorId: string,
  points: [number, number, number, number][],
): Trajectory {
  return {
    id,
    actorId,
    branchId: "branch-baseline",
    keyframes: points.map(([timeMs, x, y, rotationDeg], index) => ({
      id: `${id}-keyframe-${String(index + 1)}`,
      actorId,
      timeMs,
      x,
      y,
      rotationDeg,
    })),
    visible: true,
    locked: false,
    createdBy: "human",
    changeHistory: [initialChange(id, "Created the initial incomplete demo trajectory.")],
  };
}

function event(
  id: string,
  timeMs: number,
  type: TimelineEvent["type"],
  title: string,
  linkedActorIds: string[],
  options: Partial<TimelineEvent> = {},
): TimelineEvent {
  return {
    id,
    branchId: "branch-baseline",
    timeMs,
    type,
    title,
    certainty: "reported",
    linkedActorIds,
    linkedClaimIds: [],
    linkedEvidenceIds: [],
    locked: false,
    createdBy: "human",
    changeHistory: [initialChange(id, `Added timeline event: ${title}.`)],
    ...options,
  };
}

function evidence(
  id: string,
  name: string,
  checksum: string,
  tags: string[],
  links: Partial<Pick<EvidenceAsset, "linkedClaimIds" | "linkedEventIds" | "linkedSceneObjectIds">>,
): EvidenceAsset {
  const generatedAssetMetadata: Record<string, { path: string; sizeBytes: number }> = {
    "evidence-overview": {
      path: "/assets/generated/demo-roundabout-wide.webp",
      sizeBytes: 239_890,
    },
    "evidence-damage-a": {
      path: "/assets/generated/demo-vehicle-a-damage.webp",
      sizeBytes: 136_452,
    },
    "evidence-damage-b": {
      path: "/assets/generated/demo-vehicle-b-damage.webp",
      sizeBytes: 154_638,
    },
    "evidence-road": { path: "/assets/generated/demo-road-condition.webp", sizeBytes: 389_932 },
  };
  const metadata = generatedAssetMetadata[id];
  if (!metadata) throw new Error(`Missing generated asset metadata for ${id}`);
  return {
    id,
    name,
    mimeType: "image/webp",
    sizeBytes: metadata.sizeBytes,
    localBlobKey: metadata.path,
    checksum,
    syntheticDemoAsset: true,
    source: "demo",
    capturedAt: "2026-05-17T15:44:00.000Z",
    createdAt: CREATED_AT,
    notes:
      "Synthetic demo evidence. Content is illustrative and must not be treated as independently verified.",
    tags,
    annotations: [],
    linkedClaimIds: links.linkedClaimIds ?? [],
    linkedEventIds: links.linkedEventIds ?? [],
    linkedSceneObjectIds: links.linkedSceneObjectIds ?? [],
    linkedBranchIds: ["branch-baseline"],
    deleted: false,
  };
}

function buildDemoCase(): ReplayCase {
  const claims: Claim[] = [
    claim(
      "claim-initial-statement",
      "Vehicle A was leaving the roundabout when Vehicle B made contact with Vehicle A’s front-left side.",
      "reported",
      "human-statement",
      {
        subjectId: "actor-vehicle-a",
        linkedEvidenceIds: ["evidence-overview"],
        linkedEventIds: ["event-impact"],
        linkedSceneObjectIds: ["actor-vehicle-a", "actor-vehicle-b"],
      },
    ),
    claim("claim-road-wet", "The road surface was wet after light rain.", "confirmed", "photo", {
      sourceIds: ["evidence-road"],
      linkedEvidenceIds: ["evidence-road"],
    }),
    claim(
      "claim-no-injuries",
      "No injuries were reported in this minor incident.",
      "confirmed",
      "human-statement",
    ),
    claim(
      "claim-damage-a",
      "Vehicle A had scraping at the front-left bumper and wheel arch.",
      "confirmed",
      "photo",
      {
        subjectId: "actor-vehicle-a",
        sourceIds: ["evidence-damage-a"],
        linkedEvidenceIds: ["evidence-damage-a"],
        linkedSceneObjectIds: ["actor-vehicle-a"],
      },
    ),
    claim(
      "claim-damage-b",
      "Vehicle B had scraping at the rear-right side and bumper.",
      "confirmed",
      "photo",
      {
        subjectId: "actor-vehicle-b",
        sourceIds: ["evidence-damage-b"],
        linkedEvidenceIds: ["evidence-damage-b"],
        linkedSceneObjectIds: ["actor-vehicle-b"],
      },
    ),
    claim(
      "claim-lane-positions",
      "The exact lane positions immediately before contact are unknown.",
      "unknown",
      "human-statement",
    ),
    claim(
      "claim-lane-change",
      "It is unknown which vehicle, if either, crossed the lane boundary.",
      "unknown",
      "human-statement",
    ),
    claim(
      "claim-indicator",
      "Indicator status for both vehicles is unknown.",
      "unknown",
      "human-statement",
    ),
    claim(
      "claim-impact-location",
      "The impact occurred near the east side of the roundabout exit.",
      "uncertain",
      "human-statement",
      {
        linkedEventIds: ["event-impact"],
      },
    ),
  ];

  const trajectories: Trajectory[] = [
    trajectory("trajectory-a-baseline", "actor-vehicle-a", [
      [0, 35, 50, 0],
      [8_000, 48, 50, 0],
      [10_000, 52, 50, 2],
      [16_000, 64, 49, 5],
    ]),
    trajectory("trajectory-b-baseline", "actor-vehicle-b", [
      [0, 52, 35, 90],
      [8_000, 55, 44, 88],
      [10_000, 56, 50, 90],
      [16_000, 57, 62, 88],
    ]),
  ];

  const timelineEvents: TimelineEvent[] = [
    event("event-start-a", 0, "actor-start", "Vehicle A enters the reviewed interval", [
      "actor-vehicle-a",
    ]),
    event("event-start-b", 0, "actor-start", "Vehicle B enters the reviewed interval", [
      "actor-vehicle-b",
    ]),
    event(
      "event-maneuver",
      7_000,
      "maneuver",
      "Lane positions become uncertain",
      ["actor-vehicle-a", "actor-vehicle-b"],
      {
        certainty: "unknown",
        linkedClaimIds: ["claim-lane-positions", "claim-lane-change"],
      },
    ),
    event(
      "event-impact",
      10_000,
      "impact",
      "Approximate contact",
      ["actor-vehicle-a", "actor-vehicle-b"],
      {
        certainty: "uncertain",
        linkedClaimIds: ["claim-initial-statement", "claim-impact-location"],
        linkedEvidenceIds: ["evidence-overview"],
        location: { x: 54, y: 50 },
      },
    ),
    event("event-stop-a", 16_000, "actor-stop", "Vehicle A final position", ["actor-vehicle-a"]),
    event("event-stop-b", 16_000, "actor-stop", "Vehicle B final position", ["actor-vehicle-b"]),
    event(
      "event-evidence",
      17_000,
      "evidence",
      "Post-incident photographs recorded",
      ["actor-vehicle-a", "actor-vehicle-b"],
      {
        certainty: "confirmed",
        linkedEvidenceIds: [
          "evidence-overview",
          "evidence-damage-a",
          "evidence-damage-b",
          "evidence-road",
        ],
      },
    ),
  ];

  const evidenceAssets: EvidenceAsset[] = [
    evidence(
      "evidence-overview",
      "Roundabout incident overview — synthetic demo.webp",
      "8d97209032313b37ffaf3a92142d4d254339c5d6ed19bd354888dae8c4c1b5ea",
      ["overview", "final-positions", "synthetic-demo"],
      {
        linkedClaimIds: ["claim-initial-statement"],
        linkedEventIds: ["event-impact", "event-evidence"],
        linkedSceneObjectIds: ["actor-vehicle-a", "actor-vehicle-b"],
      },
    ),
    evidence(
      "evidence-damage-a",
      "Vehicle A front-left damage — synthetic demo.webp",
      "27da729bfd9efdf78931d15423ef17253aa4d681faec7c6aaa03f2a4b9d5f0e9",
      ["vehicle-a", "damage", "synthetic-demo"],
      { linkedClaimIds: ["claim-damage-a"], linkedSceneObjectIds: ["actor-vehicle-a"] },
    ),
    evidence(
      "evidence-damage-b",
      "Vehicle B rear-right damage — synthetic demo.webp",
      "b527745e962d163610cac7f3f6c529b35b9df28f32613165e2165307565cdeac",
      ["vehicle-b", "damage", "synthetic-demo"],
      { linkedClaimIds: ["claim-damage-b"], linkedSceneObjectIds: ["actor-vehicle-b"] },
    ),
    evidence(
      "evidence-road",
      "Wet road markings — synthetic demo.webp",
      "e2179643bfd0bc5ebb74247abb839b8d3bb1a635ad8620846fd525c7ea3c8cc5",
      ["road-condition", "wet", "synthetic-demo"],
      { linkedClaimIds: ["claim-road-wet"], linkedEventIds: ["event-evidence"] },
    ),
  ];

  const replayCase: ReplayCase = {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    seedVersion: REPLAY_SEED_VERSION,
    id: "case-demo-roundabout",
    title: "Roundabout incident — 17:42",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    caseVersion: 1,
    incidentDate: "2026-05-17",
    approximateTime: "17:42",
    sceneTemplateId: "scene-european-roundabout",
    environment: {
      sceneType: "roundabout",
      roadCondition: "wet",
      weather: "overcast",
      lighting: "dusk",
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      roadPolygon: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
    },
    timeRangeMs: { start: 0, end: 20_000 },
    actors: [
      {
        id: "actor-vehicle-a",
        label: "Vehicle A",
        kind: "vehicle",
        dimensions: { width: 1.82, length: 4.31 },
        colorToken: "vehicle-muted-blue",
        pose: { x: 64, y: 49, rotationDeg: 5 },
        locked: false,
        damageMarkers: [
          {
            id: "damage-a-front-left",
            actorId: "actor-vehicle-a",
            region: "front-left",
            description: "Minor scraping at the front-left bumper and wheel arch.",
            status: "confirmed",
            linkedClaimIds: ["claim-damage-a"],
            linkedEvidenceIds: ["evidence-damage-a"],
            createdBy: "human",
          },
        ],
      },
      {
        id: "actor-vehicle-b",
        label: "Vehicle B",
        kind: "vehicle",
        dimensions: { width: 1.79, length: 4.22 },
        colorToken: "vehicle-silver",
        pose: { x: 57, y: 62, rotationDeg: 88 },
        locked: false,
        damageMarkers: [
          {
            id: "damage-b-rear-right",
            actorId: "actor-vehicle-b",
            region: "rear-right",
            description: "Minor scraping at the rear-right side and bumper.",
            status: "confirmed",
            linkedClaimIds: ["claim-damage-b"],
            linkedEvidenceIds: ["evidence-damage-b"],
            createdBy: "human",
          },
        ],
      },
    ],
    trajectories,
    timelineEvents,
    branches: [
      {
        id: "branch-baseline",
        name: "Baseline reconstruction",
        description:
          "Shared starting reconstruction based on the known final positions and approximate contact time.",
        sharedClaimIds: claims.map((item) => item.id),
        assumptions: [],
        trajectoryIds: trajectories.map((item) => item.id),
        eventIds: timelineEvents.map((item) => item.id),
        claimIds: [],
        status: "active",
        createdBy: "human",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        changeHistory: [initialChange("branch-baseline", "Created the baseline reconstruction.")],
      },
    ],
    activeBranchId: "branch-baseline",
    claims,
    evidence: evidenceAssets,
    questions: [
      {
        id: "question-lane-change",
        question: "Which vehicle, if either, crossed the lane boundary before contact?",
        reason:
          "The alternatives require different pre-impact trajectories and this detail is not established.",
        importance: "blocking",
        rankingReasons: ["distinguishes-hypotheses", "resolves-contradiction", "blocks-report"],
        relatedClaimIds: ["claim-lane-change", "claim-lane-positions"],
        relatedSceneObjectIds: ["trajectory-a-baseline", "trajectory-b-baseline"],
        relatedBranchIds: ["branch-baseline"],
        status: "open",
        createdBy: "system",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
      {
        id: "question-impact-location",
        question: "Where was the exact point of contact?",
        reason: "The current marker is approximate and the seeded paths do not meet there.",
        importance: "high",
        rankingReasons: ["resolves-contradiction"],
        relatedClaimIds: ["claim-impact-location"],
        relatedSceneObjectIds: ["event-impact"],
        relatedBranchIds: ["branch-baseline"],
        status: "open",
        createdBy: "system",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
      {
        id: "question-indicator",
        question: "Is either vehicle’s indicator status known?",
        reason:
          "Indicator status may add context but does not by itself establish a trajectory or fault.",
        importance: "medium",
        rankingReasons: ["contextual-detail"],
        relatedClaimIds: ["claim-indicator"],
        relatedSceneObjectIds: [],
        relatedBranchIds: ["branch-baseline"],
        status: "open",
        createdBy: "system",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
    ],
    activity: [
      {
        id: "activity-seed-loaded",
        caseVersion: 1,
        author: "system",
        origin: "system",
        actionType: "case.demo-loaded",
        summary:
          "Loaded deterministic demo case with an intentionally inconsistent impact position.",
        affectedIds: ["case-demo-roundabout", "branch-baseline"],
        undoable: false,
        createdAt: CREATED_AT,
      },
    ],
    consistencyIssues: [],
    reportNotes: [],
    reportSnapshots: [],
    workspaceMode: "scene",
  };
  replayCase.consistencyIssues = validateConsistency(replayCase);
  return replayCase;
}

const DEMO_CASE = buildDemoCase();

/** Returns a validated deep clone so each demo reset is byte-for-byte stable. */
export function createDemoCase(): ReplayCase {
  return parseReplayCase(structuredClone(DEMO_CASE));
}
