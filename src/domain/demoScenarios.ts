import { createBlankCase } from "./blankCase";
import { validateConsistency } from "./consistency";
import type {
  ActivityEvent,
  ChangeRecord,
  Claim,
  DamageRegion,
  HypothesisBranch,
  OpenQuestion,
  ReplayCase,
  RoadSceneType,
  SceneActor,
  TimelineEvent,
  Trajectory,
} from "./models";
import { parseReplayCase } from "./schema";
import { createDemoCase } from "./seed";

export const DEMO_SCENARIO_IDS = [
  "roundabout-calibrated",
  "straight-road-rear-end",
  "t-junction-crossing",
  "parking-account-contradiction",
] as const;

export type DemoScenarioId = (typeof DEMO_SCENARIO_IDS)[number];

export interface DemoScenarioMetadata {
  id: DemoScenarioId;
  title: string;
  sceneType: RoadSceneType;
  summary: string;
  synthetic: true;
  adversarial: boolean;
  highSpeed: boolean;
  validationFocus: readonly ("geometry" | "motion" | "provenance")[];
}

export const DEMO_SCENARIO_METADATA: readonly DemoScenarioMetadata[] = Object.freeze([
  {
    id: "roundabout-calibrated",
    title: "Roundabout reconstruction",
    sceneType: "roundabout",
    summary:
      "The existing calibrated roundabout account with synthetic evidence, reported uncertainty, and dimension-aware contact geometry.",
    synthetic: true,
    adversarial: false,
    highSpeed: false,
    validationFocus: ["geometry", "provenance"],
  },
  {
    id: "straight-road-rear-end",
    title: "High-speed braking account",
    sceneType: "straight-road",
    summary:
      "A 65–80 km/h synthetic approach with explicit braking, low closing speed, calibrated spacing, and authored post-contact motion.",
    synthetic: true,
    adversarial: false,
    highSpeed: true,
    validationFocus: ["geometry", "motion"],
  },
  {
    id: "t-junction-crossing",
    title: "T-junction crossing account",
    sceneType: "t-junction",
    summary:
      "Two reported approaches meet at a calibrated T-junction while priority and signal details remain unresolved.",
    synthetic: true,
    adversarial: false,
    highSpeed: false,
    validationFocus: ["geometry", "motion", "provenance"],
  },
  {
    id: "parking-account-contradiction",
    title: "Parking-area account contradiction",
    sceneType: "parking-area",
    summary:
      "A reported stationary account conflicts with synthetic timestamped movement and is surfaced for human review without inferring intent.",
    synthetic: true,
    adversarial: true,
    highSpeed: false,
    validationFocus: ["motion", "provenance"],
  },
]);

type ScenarioKey = "rear-end" | "t-junction" | "parking-contradiction";
type KeyframeTuple = readonly [timeMs: number, x: number, y: number, rotationDeg: number];

interface ScenarioBaseOptions {
  key: ScenarioKey;
  title: string;
  now: string;
  incidentDate: string;
  approximateTime: string;
  sceneType: Exclude<RoadSceneType, "roundabout" | "intersection">;
  roadCondition: ReplayCase["environment"]["roadCondition"];
}

interface ScenarioBase {
  replayCase: ReplayCase;
  branch: HypothesisBranch;
  actorA: SceneActor;
  actorB: SceneActor;
  branchId: string;
}

function requireItem<T>(item: T | undefined, message: string): T {
  if (!item) throw new Error(message);
  return item;
}

function objectId(kind: string, key: ScenarioKey, suffix: string): string {
  return `${kind}-${key}-${suffix}`;
}

function changeRecord(
  key: ScenarioKey,
  objectSuffix: string,
  summary: string,
  createdAt: string,
  author: "human" | "system" = "human",
): ChangeRecord {
  return {
    id: objectId("change", key, objectSuffix),
    caseVersion: 1,
    author,
    origin: author === "human" ? "ui" : "system",
    summary,
    createdAt,
  };
}

function createScenarioBase(options: ScenarioBaseOptions): ScenarioBase {
  const caseId = objectId("case-demo", options.key, "account");
  const replayCase = createBlankCase(
    {
      title: options.title,
      incidentDate: options.incidentDate,
      approximateTime: options.approximateTime,
      sceneType: options.sceneType,
      roadCondition: options.roadCondition,
      vehicleCount: 2,
    },
    { now: options.now, caseId },
  );
  const actorA = requireItem(replayCase.actors[0], "Scenario requires Vehicle A");
  const actorB = requireItem(replayCase.actors[1], "Scenario requires Vehicle B");
  const branch = requireItem(replayCase.branches[0], "Scenario requires a baseline branch");
  const branchId = objectId("branch", options.key, "baseline");

  actorA.id = objectId("actor", options.key, "vehicle-a");
  actorB.id = objectId("actor", options.key, "vehicle-b");
  branch.id = branchId;
  branch.name = "Synthetic baseline reconstruction";
  branch.description =
    "A deterministic synthetic demo account. Geometry and statements remain reported inputs for review.";
  branch.sharedClaimIds = [];
  branch.trajectoryIds = [];
  branch.eventIds = [];
  branch.claimIds = [];
  branch.createdBy = "system";
  branch.changeHistory = [
    changeRecord(
      options.key,
      "baseline",
      "Created the deterministic synthetic baseline reconstruction.",
      options.now,
      "system",
    ),
  ];

  replayCase.activeBranchId = branchId;
  replayCase.timeRangeMs = { start: 0, end: 20_000 };
  replayCase.claims = [];
  replayCase.evidence = [];
  replayCase.questions = [];
  replayCase.trajectories = [];
  replayCase.timelineEvents = [];
  replayCase.proposals = [];
  replayCase.activity = [];
  replayCase.consistencyIssues = [];
  replayCase.reportNotes = [];
  replayCase.reportSnapshots = [];
  replayCase.workspaceMode = "scene";

  return { replayCase, branch, actorA, actorB, branchId };
}

function trajectory(
  key: ScenarioKey,
  suffix: string,
  actorId: string,
  branchId: string,
  points: readonly KeyframeTuple[],
  createdAt: string,
): Trajectory {
  const id = objectId("trajectory", key, suffix);
  return {
    id,
    actorId,
    branchId,
    interpolationMode: "linear",
    keyframes: points.map(([timeMs, x, y, rotationDeg], index) => ({
      id: objectId("keyframe", key, `${suffix}-${String(index + 1)}`),
      actorId,
      timeMs,
      x,
      y,
      rotationDeg,
    })),
    visible: true,
    locked: false,
    createdBy: "human",
    changeHistory: [
      changeRecord(
        key,
        `trajectory-${suffix}`,
        "Added a synthetic reported trajectory for deterministic review.",
        createdAt,
      ),
    ],
  };
}

interface EventOptions {
  linkedClaimIds?: string[];
  location?: { x: number; y: number };
}

function timelineEvent(
  key: ScenarioKey,
  branchId: string,
  suffix: string,
  timeMs: number,
  type: TimelineEvent["type"],
  title: string,
  linkedActorIds: string[],
  createdAt: string,
  options: EventOptions = {},
): TimelineEvent {
  return {
    id: objectId("event", key, suffix),
    branchId,
    timeMs,
    type,
    title,
    certainty: "reported",
    linkedActorIds,
    linkedClaimIds: options.linkedClaimIds ?? [],
    linkedEvidenceIds: [],
    ...(options.location ? { location: options.location } : {}),
    locked: false,
    createdBy: "human",
    changeHistory: [
      changeRecord(
        key,
        `event-${suffix}`,
        `Added synthetic reported timeline event: ${title}.`,
        createdAt,
      ),
    ],
  };
}

interface ClaimOptions {
  subjectId?: string;
  sourceIds?: string[];
  linkedEventIds?: string[];
  linkedSceneObjectIds?: string[];
  createdBy?: "human" | "system";
}

function reportedClaim(
  key: ScenarioKey,
  suffix: string,
  statement: string,
  sourceType: Claim["sourceType"],
  createdAt: string,
  options: ClaimOptions = {},
): Claim {
  const createdBy = options.createdBy ?? "human";
  return {
    id: objectId("claim", key, suffix),
    statement,
    ...(options.subjectId ? { subjectId: options.subjectId } : {}),
    status: "reported",
    sourceType,
    sourceIds: options.sourceIds ?? [],
    linkedEvidenceIds: [],
    linkedEventIds: options.linkedEventIds ?? [],
    linkedSceneObjectIds: options.linkedSceneObjectIds ?? [],
    sharedAcrossBranches: true,
    createdBy,
    humanConfirmed: false,
    locked: false,
    createdAt,
    updatedAt: createdAt,
    changeHistory: [
      changeRecord(
        key,
        `claim-${suffix}`,
        "Recorded a synthetic demo detail as reported, not confirmed.",
        createdAt,
        createdBy,
      ),
    ],
  };
}

function openQuestion(
  key: ScenarioKey,
  branchId: string,
  suffix: string,
  question: string,
  reason: string,
  relatedClaimIds: string[],
  relatedSceneObjectIds: string[],
  createdAt: string,
  importance: OpenQuestion["importance"] = "high",
): OpenQuestion {
  return {
    id: objectId("question", key, suffix),
    question,
    reason,
    importance,
    rankingReasons: ["resolves-contradiction", "distinguishes-hypotheses"],
    relatedClaimIds,
    relatedSceneObjectIds,
    relatedBranchIds: [branchId],
    status: "open",
    createdBy: "system",
    createdAt,
    updatedAt: createdAt,
  };
}

function damageMarker(
  key: ScenarioKey,
  suffix: string,
  actorId: string,
  region: DamageRegion,
  description: string,
  claimId: string,
): SceneActor["damageMarkers"][number] {
  return {
    id: objectId("damage", key, suffix),
    actorId,
    region,
    description,
    status: "reported",
    linkedClaimIds: [claimId],
    linkedEvidenceIds: [],
    createdBy: "human",
  };
}

function activity(
  key: ScenarioKey,
  suffix: string,
  summary: string,
  affectedIds: string[],
  createdAt: string,
  author: ActivityEvent["author"] = "system",
): ActivityEvent {
  return {
    id: objectId("activity", key, suffix),
    caseVersion: 1,
    author,
    origin: author === "human" ? "ui" : "system",
    actionType: `demo.${suffix}`,
    summary,
    affectedIds,
    undoable: false,
    createdAt,
  };
}

function finalizeScenario(replayCase: ReplayCase): ReplayCase {
  replayCase.consistencyIssues = [];
  const parsed = parseReplayCase(replayCase);
  parsed.consistencyIssues = validateConsistency(parsed);
  return parseReplayCase(parsed);
}

function buildRearEndScenario(): ReplayCase {
  const key = "rear-end" as const;
  const now = "2026-06-14T07:15:00.000Z";
  const { replayCase, branch, actorA, actorB, branchId } = createScenarioBase({
    key,
    title: "High-speed braking account — synthetic demo",
    now,
    incidentDate: "2026-06-14",
    approximateTime: "09:15",
    sceneType: "straight-road",
    roadCondition: "dry",
  });

  replayCase.environment.weather = "clear";
  replayCase.environment.lighting = "daylight";
  replayCase.environment.trafficSide = "right";
  replayCase.environment.calibration = {
    widthMeters: 100,
    heightMeters: 70,
    source: "measured",
    uncertaintyMeters: 0.25,
  };
  replayCase.environment.postedSpeedLimitKph = 80;

  actorA.label = "Lead vehicle";
  actorA.dimensions = { width: 1.89, length: 4.72 };
  actorA.vehicleClass = "suv";
  actorA.dimensionsSource = "manufacturer";
  actorA.wheelbaseMeters = 2.79;
  actorA.pose = { x: 97, y: 56, rotationDeg: 90 };

  actorB.label = "Following vehicle";
  actorB.dimensions = { width: 1.78, length: 4.31 };
  actorB.vehicleClass = "compact-car";
  actorB.dimensionsSource = "manufacturer";
  actorB.wheelbaseMeters = 2.61;
  actorB.pose = { x: 92.2, y: 56, rotationDeg: 90 };

  const trajectoryA = trajectory(
    key,
    "lead",
    actorA.id,
    branchId,
    [
      [0, 15, 56, 90],
      [1_500, 48, 56, 90],
      [3_000, 75, 56, 90],
      [4_200, 92, 56, 90],
      [4_600, 97, 56, 90],
    ],
    now,
  );
  const trajectoryB = trajectory(
    key,
    "following",
    actorB.id,
    branchId,
    [
      [0, 5, 56, 90],
      [1_500, 38.5, 56, 90],
      [3_000, 70.485, 56, 90],
      [4_200, 87.2, 56, 90],
      [4_600, 92.2, 56, 90],
    ],
    now,
  );

  const brakingClaimId = objectId("claim", key, "braking-account");
  const speedContextClaimId = objectId("claim", key, "speed-context");
  const contactClaimId = objectId("claim", key, "contact-account");
  const leadDamageClaimId = objectId("claim", key, "lead-damage");
  const followingDamageClaimId = objectId("claim", key, "following-damage");
  const impactEventId = objectId("event", key, "impact");
  const brakingEventId = objectId("event", key, "braking");

  replayCase.claims = [
    reportedClaim(
      key,
      "braking-account",
      "Synthetic demo account: the lead vehicle was reported to brake from a higher-speed eastbound approach before contact.",
      "human-statement",
      now,
      {
        subjectId: actorA.id,
        linkedEventIds: [brakingEventId],
        linkedSceneObjectIds: [actorA.id, trajectoryA.id],
      },
    ),
    reportedClaim(
      key,
      "speed-context",
      "Synthetic demo timing model: the calibrated authored paths imply approximately 65 km/h for the lead vehicle and 77 km/h for the following vehicle immediately before contact. These reconstruction values are not measured speeds.",
      "scene-observation",
      now,
      {
        linkedEventIds: [impactEventId],
        linkedSceneObjectIds: [trajectoryA.id, trajectoryB.id],
        createdBy: "system",
      },
    ),
    reportedClaim(
      key,
      "contact-account",
      "Synthetic demo account: contact was reported between the lead vehicle's rear and the following vehicle's front.",
      "human-statement",
      now,
      {
        linkedEventIds: [impactEventId],
        linkedSceneObjectIds: [actorA.id, actorB.id, trajectoryA.id, trajectoryB.id],
      },
    ),
    reportedClaim(
      key,
      "lead-damage",
      "Synthetic demo account: light rear-bumper marking was reported on the lead vehicle.",
      "human-statement",
      now,
      {
        subjectId: actorA.id,
        linkedSceneObjectIds: [actorA.id, objectId("damage", key, "lead-rear")],
      },
    ),
    reportedClaim(
      key,
      "following-damage",
      "Synthetic demo account: light front-bumper marking was reported on the following vehicle.",
      "human-statement",
      now,
      {
        subjectId: actorB.id,
        linkedSceneObjectIds: [actorB.id, objectId("damage", key, "following-front")],
      },
    ),
  ];
  actorA.damageMarkers = [
    damageMarker(
      key,
      "lead-rear",
      actorA.id,
      "rear",
      "Synthetic reported light marking at the rear bumper.",
      leadDamageClaimId,
    ),
  ];
  actorB.damageMarkers = [
    damageMarker(
      key,
      "following-front",
      actorB.id,
      "front",
      "Synthetic reported light marking at the front bumper.",
      followingDamageClaimId,
    ),
  ];

  replayCase.trajectories = [trajectoryA, trajectoryB];
  replayCase.timelineEvents = [
    timelineEvent(
      key,
      branchId,
      "start-lead",
      0,
      "actor-start",
      "Lead vehicle interval starts",
      [actorA.id],
      now,
    ),
    timelineEvent(
      key,
      branchId,
      "start-following",
      0,
      "actor-start",
      "Following vehicle interval starts",
      [actorB.id],
      now,
    ),
    timelineEvent(
      key,
      branchId,
      "braking",
      1_500,
      "maneuver",
      "Reported braking begins",
      [actorA.id, actorB.id],
      now,
      { linkedClaimIds: [brakingClaimId] },
    ),
    timelineEvent(
      key,
      branchId,
      "impact",
      3_000,
      "impact",
      "Approximate reported contact",
      [actorA.id, actorB.id],
      now,
      {
        linkedClaimIds: [contactClaimId, speedContextClaimId],
        location: { x: 72.7425, y: 56 },
      },
    ),
    timelineEvent(
      key,
      branchId,
      "stop-lead",
      4_600,
      "actor-stop",
      "Lead vehicle final position",
      [actorA.id],
      now,
    ),
    timelineEvent(
      key,
      branchId,
      "stop-following",
      4_600,
      "actor-stop",
      "Following vehicle final position",
      [actorB.id],
      now,
    ),
  ];
  replayCase.questions = [
    openQuestion(
      key,
      branchId,
      "brake-onset",
      "What independent telemetry, video, or roadway evidence supports the reconstructed approach speeds, braking onset, and initial following distance?",
      "The high-speed values come from calibrated authored path timing, not a speed sensor, collision simulation, or verified measurement.",
      [brakingClaimId, contactClaimId, speedContextClaimId],
      [trajectoryA.id, trajectoryB.id, impactEventId],
      now,
    ),
  ];

  branch.sharedClaimIds = replayCase.claims.map((claim) => claim.id);
  branch.trajectoryIds = replayCase.trajectories.map((item) => item.id);
  branch.eventIds = replayCase.timelineEvents.map((item) => item.id);
  replayCase.activity = [
    activity(
      key,
      "fixture-loaded",
      "Loaded a deterministic synthetic high-speed rear-end account with calibrated dimensions and timing.",
      [replayCase.id, branchId],
      now,
    ),
    activity(
      key,
      "reported-account-added",
      "Recorded the synthetic braking and contact account as reported, not confirmed.",
      [brakingClaimId, contactClaimId],
      now,
      "human",
    ),
  ];

  return finalizeScenario(replayCase);
}

function buildTJunctionScenario(): ReplayCase {
  const key = "t-junction" as const;
  const now = "2026-07-02T14:08:00.000Z";
  const { replayCase, branch, actorA, actorB, branchId } = createScenarioBase({
    key,
    title: "T-junction crossing account — synthetic demo",
    now,
    incidentDate: "2026-07-02",
    approximateTime: "16:08",
    sceneType: "t-junction",
    roadCondition: "dry",
  });

  replayCase.environment.weather = "overcast";
  replayCase.environment.lighting = "daylight";
  replayCase.environment.trafficSide = "right";
  replayCase.environment.calibration = {
    widthMeters: 100,
    heightMeters: 70,
    source: "template",
    uncertaintyMeters: 1,
  };
  replayCase.environment.postedSpeedLimitKph = 50;

  actorA.label = "Main-road vehicle";
  actorA.dimensions = { width: 1.98, length: 5.15 };
  actorA.vehicleClass = "van";
  actorA.dimensionsSource = "manufacturer";
  actorA.wheelbaseMeters = 3.1;
  actorA.pose = { x: 50.515, y: 42, rotationDeg: 90 };

  actorB.label = "Side-road vehicle";
  actorB.dimensions = { width: 1.82, length: 4.58 };
  actorB.vehicleClass = "saloon";
  actorB.dimensionsSource = "manufacturer";
  actorB.wheelbaseMeters = 2.72;
  actorB.pose = { x: 56.5, y: 30, rotationDeg: 19.65 };

  const trajectoryA = trajectory(
    key,
    "main-road",
    actorA.id,
    branchId,
    [
      [0, 20, 42, 90],
      [2_000, 35, 42, 90],
      [4_000, 50.515, 42, 90],
      [4_500, 50.515, 42, 90],
    ],
    now,
  );
  const trajectoryB = trajectory(
    key,
    "side-road",
    actorB.id,
    branchId,
    [
      [0, 54, 82, 0],
      [2_000, 54, 65, 0],
      [4_000, 54, 42, 0],
      [5_000, 55.5, 34, 15],
      [5_500, 56.5, 30, 19.65],
    ],
    now,
  );

  const approachClaimId = objectId("claim", key, "approach-account");
  const contactClaimId = objectId("claim", key, "contact-account");
  const mainDamageClaimId = objectId("claim", key, "main-damage");
  const sideDamageClaimId = objectId("claim", key, "side-damage");
  const impactEventId = objectId("event", key, "impact");
  const approachEventId = objectId("event", key, "approach");

  replayCase.claims = [
    reportedClaim(
      key,
      "approach-account",
      "Synthetic demo account: one vehicle was reported eastbound on the main road while the other approached northbound from the side road.",
      "human-statement",
      now,
      {
        linkedEventIds: [approachEventId],
        linkedSceneObjectIds: [actorA.id, actorB.id, trajectoryA.id, trajectoryB.id],
      },
    ),
    reportedClaim(
      key,
      "contact-account",
      "Synthetic demo account: contact was reported inside the T-junction crossing area.",
      "human-statement",
      now,
      {
        linkedEventIds: [impactEventId],
        linkedSceneObjectIds: [actorA.id, actorB.id],
      },
    ),
    reportedClaim(
      key,
      "main-damage",
      "Synthetic demo account: front-area marking was reported on the main-road vehicle.",
      "human-statement",
      now,
      {
        subjectId: actorA.id,
        linkedSceneObjectIds: [actorA.id, objectId("damage", key, "main-front")],
      },
    ),
    reportedClaim(
      key,
      "side-damage",
      "Synthetic demo account: left-side marking was reported on the side-road vehicle.",
      "human-statement",
      now,
      {
        subjectId: actorB.id,
        linkedSceneObjectIds: [actorB.id, objectId("damage", key, "side-left")],
      },
    ),
  ];
  actorA.damageMarkers = [
    damageMarker(
      key,
      "main-front",
      actorA.id,
      "front",
      "Synthetic reported marking near the front area.",
      mainDamageClaimId,
    ),
  ];
  actorB.damageMarkers = [
    damageMarker(
      key,
      "side-left",
      actorB.id,
      "left-side",
      "Synthetic reported marking on the left side.",
      sideDamageClaimId,
    ),
  ];

  replayCase.trajectories = [trajectoryA, trajectoryB];
  replayCase.timelineEvents = [
    timelineEvent(
      key,
      branchId,
      "start-main",
      0,
      "actor-start",
      "Main-road vehicle interval starts",
      [actorA.id],
      now,
    ),
    timelineEvent(
      key,
      branchId,
      "start-side",
      0,
      "actor-start",
      "Side-road vehicle interval starts",
      [actorB.id],
      now,
    ),
    timelineEvent(
      key,
      branchId,
      "approach",
      2_000,
      "maneuver",
      "Reported approaches continue",
      [actorA.id, actorB.id],
      now,
      { linkedClaimIds: [approachClaimId] },
    ),
    timelineEvent(
      key,
      branchId,
      "impact",
      4_000,
      "impact",
      "Approximate reported crossing contact",
      [actorA.id, actorB.id],
      now,
      { linkedClaimIds: [contactClaimId], location: { x: 53.09, y: 42 } },
    ),
    timelineEvent(
      key,
      branchId,
      "stop-main",
      4_500,
      "actor-stop",
      "Main-road vehicle final position",
      [actorA.id],
      now,
    ),
    timelineEvent(
      key,
      branchId,
      "stop-side",
      5_500,
      "actor-stop",
      "Side-road vehicle final position",
      [actorB.id],
      now,
    ),
  ];
  replayCase.questions = [
    openQuestion(
      key,
      branchId,
      "priority-context",
      "What source establishes the applicable priority control and each vehicle's signal state?",
      "The synthetic geometry does not establish traffic priority, intent, or a legal conclusion.",
      [approachClaimId, contactClaimId],
      [trajectoryA.id, trajectoryB.id, impactEventId],
      now,
    ),
  ];

  branch.sharedClaimIds = replayCase.claims.map((claim) => claim.id);
  branch.trajectoryIds = replayCase.trajectories.map((item) => item.id);
  branch.eventIds = replayCase.timelineEvents.map((item) => item.id);
  replayCase.activity = [
    activity(
      key,
      "fixture-loaded",
      "Loaded a deterministic synthetic T-junction account with calibrated paths and dimensions.",
      [replayCase.id, branchId],
      now,
    ),
    activity(
      key,
      "reported-account-added",
      "Recorded both synthetic approach descriptions as reported, not confirmed.",
      [approachClaimId, contactClaimId],
      now,
      "human",
    ),
  ];

  return finalizeScenario(replayCase);
}

function buildParkingContradictionScenario(): ReplayCase {
  const key = "parking-contradiction" as const;
  const now = "2026-07-19T09:30:00.000Z";
  const { replayCase, branch, actorA, actorB, branchId } = createScenarioBase({
    key,
    title: "Parking-area account contradiction — synthetic demo",
    now,
    incidentDate: "2026-07-19",
    approximateTime: "11:30",
    sceneType: "parking-area",
    roadCondition: "dry",
  });

  replayCase.environment.weather = "clear";
  replayCase.environment.lighting = "daylight";
  replayCase.environment.trafficSide = "right";
  replayCase.environment.calibration = {
    widthMeters: 70,
    heightMeters: 49,
    source: "estimated",
    uncertaintyMeters: 0.5,
  };
  replayCase.environment.postedSpeedLimitKph = 15;

  actorA.label = "Aisle vehicle";
  actorA.dimensions = { width: 1.76, length: 4.12 };
  actorA.vehicleClass = "compact-car";
  actorA.dimensionsSource = "estimated";
  actorA.wheelbaseMeters = 2.55;
  actorA.pose = { x: 81, y: 50, rotationDeg: 90 };

  actorB.label = "Parked vehicle";
  actorB.dimensions = { width: 1.9, length: 4.65 };
  actorB.vehicleClass = "suv";
  actorB.dimensionsSource = "manufacturer";
  actorB.wheelbaseMeters = 2.78;
  actorB.pose = { x: 87.5, y: 53.5, rotationDeg: 90 };

  // At 1 s the two eastbound vehicle footprints meet exactly at their
  // front/rear boundaries. The parked vehicle then moves away slightly so
  // the authored paths do not remain interpenetrated after the contact.
  const parkedContactCenterX = 86.26428571428572;
  const contactBoundaryX = 82.94285714285715;

  const trajectoryA = trajectory(
    key,
    "aisle",
    actorA.id,
    branchId,
    [
      [0, 75, 50, 90],
      [1_000, 80, 50, 90],
      [2_000, 81, 50, 90],
      [16_000, 81, 50, 90],
    ],
    now,
  );
  const trajectoryB = trajectory(
    key,
    "parked",
    actorB.id,
    branchId,
    [
      [0, parkedContactCenterX, 53.5, 90],
      [1_000, parkedContactCenterX, 53.5, 90],
      [2_000, 87.5, 53.5, 90],
      [16_000, 87.5, 53.5, 90],
    ],
    now,
  );

  const stationaryClaimId = objectId("claim", key, "stationary-account");
  const timingClaimId = objectId("claim", key, "timing-record");
  const contactClaimId = objectId("claim", key, "contact-account");
  const aisleDamageClaimId = objectId("claim", key, "aisle-damage");
  const parkedDamageClaimId = objectId("claim", key, "parked-damage");
  const impactEventId = objectId("event", key, "impact");
  const positionSampleEventId = objectId("event", key, "position-sample");

  replayCase.claims = [
    reportedClaim(
      key,
      "stationary-account",
      "Synthetic demo account: the aisle vehicle was reported to have remained stationary during the reviewed one-second interval.",
      "human-statement",
      now,
      {
        subjectId: actorA.id,
        linkedEventIds: [positionSampleEventId],
        linkedSceneObjectIds: [actorA.id, trajectoryA.id],
      },
    ),
    reportedClaim(
      key,
      "timing-record",
      "Synthetic demo timing record: the aisle vehicle is represented at positions 3.5 metres apart one second apart, implying a low-speed 12.6 km/h parking-area leg.",
      "system-derived",
      now,
      {
        subjectId: actorA.id,
        sourceIds: [trajectoryA.id],
        linkedEventIds: [positionSampleEventId],
        linkedSceneObjectIds: [actorA.id, trajectoryA.id],
        createdBy: "system",
      },
    ),
    reportedClaim(
      key,
      "contact-account",
      "Synthetic demo account: low-speed parking-area contact was reported near the parked vehicle.",
      "human-statement",
      now,
      {
        linkedEventIds: [impactEventId],
        linkedSceneObjectIds: [actorA.id, actorB.id],
      },
    ),
    reportedClaim(
      key,
      "aisle-damage",
      "Synthetic demo account: front-area marking was reported on the aisle vehicle.",
      "human-statement",
      now,
      {
        subjectId: actorA.id,
        linkedSceneObjectIds: [actorA.id, objectId("damage", key, "aisle-front")],
      },
    ),
    reportedClaim(
      key,
      "parked-damage",
      "Synthetic demo account: rear-area marking was reported on the parked vehicle.",
      "human-statement",
      now,
      {
        subjectId: actorB.id,
        linkedSceneObjectIds: [actorB.id, objectId("damage", key, "parked-rear")],
      },
    ),
  ];
  actorA.damageMarkers = [
    damageMarker(
      key,
      "aisle-front",
      actorA.id,
      "front",
      "Synthetic reported marking near the front area.",
      aisleDamageClaimId,
    ),
  ];
  actorB.damageMarkers = [
    damageMarker(
      key,
      "parked-rear",
      actorB.id,
      "rear",
      "Synthetic reported marking near the rear area.",
      parkedDamageClaimId,
    ),
  ];

  replayCase.trajectories = [trajectoryA, trajectoryB];
  replayCase.timelineEvents = [
    timelineEvent(
      key,
      branchId,
      "start-aisle",
      0,
      "actor-start",
      "Aisle vehicle interval starts",
      [actorA.id],
      now,
    ),
    timelineEvent(
      key,
      branchId,
      "start-parked",
      0,
      "actor-start",
      "Parked vehicle interval starts",
      [actorB.id],
      now,
    ),
    timelineEvent(
      key,
      branchId,
      "position-sample",
      1_000,
      "observation",
      "Synthetic timestamped position sample",
      [actorA.id],
      now,
      { linkedClaimIds: [stationaryClaimId, timingClaimId] },
    ),
    timelineEvent(
      key,
      branchId,
      "impact",
      1_000,
      "impact",
      "Approximate reported parking-area contact",
      [actorA.id, actorB.id],
      now,
      { linkedClaimIds: [contactClaimId], location: { x: contactBoundaryX, y: 51.68 } },
    ),
    timelineEvent(
      key,
      branchId,
      "stop-aisle",
      16_000,
      "actor-stop",
      "Aisle vehicle final position",
      [actorA.id],
      now,
    ),
    timelineEvent(
      key,
      branchId,
      "stop-parked",
      16_000,
      "actor-stop",
      "Parked vehicle final position",
      [actorB.id],
      now,
    ),
  ];
  replayCase.questions = [
    openQuestion(
      key,
      branchId,
      "reconcile-account",
      "How should the reported stationary account be reconciled with the synthetic timestamped position change?",
      "The structured records conflict; the discrepancy requires source review and does not establish why either input differs.",
      [stationaryClaimId, timingClaimId],
      [actorA.id, trajectoryA.id, impactEventId],
      now,
      "blocking",
    ),
  ];

  branch.sharedClaimIds = replayCase.claims.map((claim) => claim.id);
  branch.trajectoryIds = replayCase.trajectories.map((item) => item.id);
  branch.eventIds = replayCase.timelineEvents.map((item) => item.id);
  replayCase.activity = [
    activity(
      key,
      "fixture-loaded",
      "Loaded a deterministic synthetic parking-area account with an unresolved record contradiction.",
      [replayCase.id, branchId],
      now,
    ),
    activity(
      key,
      "stationary-account-added",
      "Recorded the synthetic stationary account as reported, not confirmed.",
      [stationaryClaimId, actorA.id],
      now,
      "human",
    ),
    activity(
      key,
      "timing-record-added",
      "Added the synthetic timestamped trajectory for deterministic consistency review.",
      [timingClaimId, trajectoryA.id],
      now,
    ),
  ];

  return finalizeScenario(replayCase);
}

export function isDemoScenarioId(value: string): value is DemoScenarioId {
  return (DEMO_SCENARIO_IDS as readonly string[]).includes(value);
}

export function createDemoScenario(id: DemoScenarioId): ReplayCase {
  switch (id) {
    case "roundabout-calibrated":
      return createDemoCase();
    case "straight-road-rear-end":
      return buildRearEndScenario();
    case "t-junction-crossing":
      return buildTJunctionScenario();
    case "parking-account-contradiction":
      return buildParkingContradictionScenario();
    default:
      throw new RangeError(`Unknown demo scenario: ${id}`);
  }
}
