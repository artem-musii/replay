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
      path: "/assets/generated/demo-roundabout-wide-v2.webp",
      sizeBytes: 302_658,
    },
    "evidence-damage-a": {
      path: "/assets/generated/demo-vehicle-a-damage-v2.webp",
      sizeBytes: 281_286,
    },
    "evidence-damage-b": {
      path: "/assets/generated/demo-vehicle-b-damage-v2.webp",
      sizeBytes: 211_696,
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
    annotationLinks: [],
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
      [0, 28, 50, 146],
      [6_000, 35, 65, 125],
      [8_000, 50, 72, 78],
      [10_000, 62, 57, 62],
      [16_000, 74, 54, 80],
    ]),
    trajectory("trajectory-b-baseline", "actor-vehicle-b", [
      [0, 34, 61, 133],
      [6_000, 43, 73, 109],
      [8_000, 56, 72, 59],
      [10_000, 65, 54, 60],
      [16_000, 80, 52, 85],
    ]),
  ];

  const timelineEvents: TimelineEvent[] = [
    event(
      "event-start-a",
      0,
      "actor-start",
      "Vehicle A enters the reviewed interval",
      ["actor-vehicle-a"],
      { linkedEvidenceIds: ["evidence-overview"] },
    ),
    event(
      "event-start-b",
      0,
      "actor-start",
      "Vehicle B enters the reviewed interval",
      ["actor-vehicle-b"],
      { linkedEvidenceIds: ["evidence-overview"] },
    ),
    event(
      "event-maneuver",
      7_000,
      "maneuver",
      "Exact lane positions are not established from this point",
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
        location: { x: 64, y: 57 },
      },
    ),
    event("event-stop-a", 16_000, "actor-stop", "Vehicle A final position", ["actor-vehicle-a"], {
      linkedEvidenceIds: ["evidence-overview"],
    }),
    event("event-stop-b", 16_000, "actor-stop", "Vehicle B final position", ["actor-vehicle-b"], {
      linkedEvidenceIds: ["evidence-overview"],
    }),
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
      "3cfb45061b48ffc5e04bb8299c5e558c07d1e21df772045f9b60e3006a810295",
      ["overview", "final-positions", "synthetic-demo"],
      {
        linkedClaimIds: ["claim-initial-statement"],
        linkedEventIds: [
          "event-start-a",
          "event-start-b",
          "event-impact",
          "event-stop-a",
          "event-stop-b",
          "event-evidence",
        ],
        linkedSceneObjectIds: ["actor-vehicle-a", "actor-vehicle-b"],
      },
    ),
    evidence(
      "evidence-damage-a",
      "Vehicle A front-left damage — synthetic demo.webp",
      "f8e2a6110ac39c65133b7b25542472ef3ea8a5dd5c2eb0c331305defa3f551e6",
      ["vehicle-a", "damage", "synthetic-demo"],
      { linkedClaimIds: ["claim-damage-a"], linkedSceneObjectIds: ["actor-vehicle-a"] },
    ),
    evidence(
      "evidence-damage-b",
      "Vehicle B rear-right damage — synthetic demo.webp",
      "382f6f38420934d265529ef1b3588dc852580274cc07b7d4c514d056ad6c8326",
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
        pose: { x: 74, y: 54, rotationDeg: 80 },
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
        pose: { x: 80, y: 52, rotationDeg: 85 },
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
    proposals: [],
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
