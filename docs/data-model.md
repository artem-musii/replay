# REPLAY canonical data model

Status: implemented model snapshot aligned to `src/domain/models.ts`, `src/domain/schema.ts`, `src/domain/importExport.ts`, and the `ReplayEngine` command layer as inspected on 2026-08-27. Known persistence and migration limits are recorded below.

## Two independent versions

- `schemaVersion` identifies the persisted JSON shape and drives migrations. The initial constant is `REPLAY_SCHEMA_VERSION = 1`.
- `seedVersion` identifies the deterministic demo fixture independently from user-case migrations. The initial constant is `REPLAY_SEED_VERSION = 1`.
- `caseVersion` is the monotonically increasing optimistic-concurrency revision. The current engine increments it once for every successful command, including persisted `workspace.focus` and `case.validate` commands. Hover, playback time, menus, and other React-only presentation state do not change it.

Keeping these numbers separate prevents a demo refresh, data migration, and concurrent edit from being mistaken for one another.

## Aggregate and references

`ReplayCase` is the only durable aggregate exposed to the application. Collections are normalized enough to preserve stable IDs and explicit links:

```text
ReplayCase
├── environment / sceneTemplateId / timeRangeMs
├── actors[]
│   └── damageMarkers[]
├── branches[]
│   ├── sharedClaimIds[]
│   ├── trajectoryIds[] ───────────────┐
│   ├── eventIds[] ────────────────┐  │
│   ├── claimIds[] ─────────────┐  │  │
│   └── assumptions[]           │  │  │
├── trajectories[] <────────────┼──┼──┘
│   └── keyframes[]             │  │
├── timelineEvents[] <──────────┼──┘
├── claims[] <──────────────────┘
├── evidence[] <── links from claims/events/branches/annotations
├── questions[] <── related claims, scene objects, branches
├── consistencyIssues[] <── affected IDs
├── activity[] <── version, author, origin, affected IDs, request ID
├── reportNotes[] <── supporting claim/evidence IDs
└── reportSnapshots[] <── immutable versioned preview + included IDs
```

All references use stable opaque string IDs. Display labels, filenames, statements, and assumption text are never identifiers and never executable instructions.

## Root shape

The implemented TypeScript contract is conceptually:

```ts
interface ReplayCase {
  schemaVersion: 1;
  seedVersion?: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  caseVersion: number;
  incidentDate?: string;
  approximateTime?: string;
  sceneTemplateId: string;
  environment: EnvironmentState;
  timeRangeMs: { start: number; end: number };
  actors: SceneActor[];
  trajectories: Trajectory[];
  timelineEvents: TimelineEvent[];
  branches: HypothesisBranch[];
  activeBranchId: string;
  claims: Claim[];
  evidence: EvidenceAsset[];
  questions: OpenQuestion[];
  activity: ActivityEvent[];
  consistencyIssues: ConsistencyIssue[];
  reportNotes: ReportNote[];
  reportSnapshots: ReportSnapshot[];
  selectedItem?: WorkspaceSelection;
  workspaceMode: WorkspaceMode;
}
```

`selectedItem` and `workspaceMode` are persisted in the current shape for workspace recovery. Transient hover, drag previews, playback time, toasts, and agent-working state should remain outside the durable aggregate.

## Scene and time

### Environment

`EnvironmentState` contains:

- scene type: `roundabout | intersection`;
- road condition: `wet | dry | unknown`;
- weather: `clear | rain | overcast | unknown`;
- lighting: `daylight | dusk | night | unknown`;
- finite scene bounds with positive area;
- a road polygon with at least three points.

The demo focuses on a European roundabout, while the additional enum value supports the blank-case wizard without turning REPLAY into a universal simulator.

### Actors and poses

The only actor kind is `vehicle`. A `SceneActor` owns label, dimensions, color token, fallback pose, lock metadata, and damage markers. A vehicle’s animated branch pose comes from its branch trajectory; its fallback `pose` is used when no trajectory exists.

`ActorPose` contains finite `x`, `y`, and `rotationDeg`. Commands—not the local shape alone—must normalize positions to the scene coordinate system, normalize rotation, enforce road bounds where appropriate, and reject invalid dimensions.

`DamageRegion` is an explicit enum:

```text
front, front-left, front-right, left-side, right-side,
rear-left, rear-right, rear, unknown
```

A damage marker records its actor, region, description, claim/evidence links, status, and author. Agent-origin commands may create only non-confirmed statuses.

### Trajectories and keyframes

A `Trajectory` belongs to exactly one actor and branch and contains one or more keyframes. Each keyframe repeats `actorId` deliberately so validation can catch accidental cross-actor insertion. Keyframe times must be strictly increasing. Locks carry author, timestamp, and optional reason.

Playback uses deterministic interpolation. Rotation follows the shortest angular path. Interpolation clamps before the first and after the final keyframe, and does not mutate the source trajectory.

### Timeline events

Event types are:

```text
actor-start, maneuver, impact, observation, evidence, actor-stop
```

Each event is branch-scoped, time-based, and may link actors, claims, evidence, and a scene location. The rules engine—not an LLM—checks ordering, required start/stop/impact relationships, duplicates, time range, geometry proximity, and locked state.

## Provenance and certainty

### Claim status

```ts
type ClaimStatus =
  "confirmed" | "reported" | "likely" | "uncertain" | "disputed" | "unknown" | "agent-hypothesis";
```

These values are not a probability scale. In particular, `confirmed` means a person explicitly reviewed and confirmed the claim in REPLAY; it does not mean independently verified or legally proven.

### Claim source

```ts
type ClaimSourceType =
  | "human-statement"
  | "witness-statement"
  | "photo"
  | "document"
  | "scene-observation"
  | "system-derived"
  | "agent-inference";
```

A `Claim` records its statement, source type/IDs, linked evidence/events/scene objects, optional branch, shared-across-branch flag, author, human-confirmation state, locks, timestamps, and change history.

Required invariants:

- `status === "confirmed"` requires `humanConfirmed === true` and `confirmedAt`.
- A non-confirmed claim cannot set `humanConfirmed`.
- WebMCP/agent commands cannot set confirmed/human-confirmed fields; only a human review command can do so.
- Agent inference is never confirmed automatically.
- A branch-scoped claim cannot also masquerade as a shared fact.
- Every linked ID must exist and have the expected entity type.
- Deleted evidence cannot remain an eligible report citation.

Zod enforces the local shape invariants. The reducer enforces actor/origin authorization, locks, and human-only confirmation, while import/engine validation checks cross-record references before accepting the case.

## Evidence

`EvidenceAsset` stores metadata and a `localBlobKey`; binary data belongs in a separate IndexedDB blob record. The current schema permits JPEG, PNG, and WebP images up to 20 MiB and requires a checksum. Source is `demo | local-upload | import`.

Important fields:

- `syntheticDemoAsset` distinguishes generated demonstration imagery;
- `notes` and `name` are untrusted text;
- tags and point/rectangle annotations remain structured;
- annotation coordinates are normalized to `0..1`;
- claim, event, scene-object, and branch links are explicit;
- deletion is soft (`deleted` plus `deletedAt`) so dangling citations can be detected before permanent cleanup.

Object URLs, decoded image elements, and thumbnails are presentation cache, not canonical data. The application must never store an object URL as evidence identity.

## Hypotheses

`HypothesisBranch` has a parent, shared claim IDs, branch-local assumption objects, trajectory/event/claim IDs, lifecycle status, author, timestamps, and change history.

An assumption records statement, active/withdrawn status, supporting/conflicting evidence IDs, author, and timestamps. Assumptions are explanatory inputs, never confirmed facts.

Branch invariants:

- `activeBranchId` references an existing non-archived branch.
- A branch’s referenced trajectories/events/claims exist and point back to that branch.
- Parent links are acyclic.
- Shared confirmed/locked claims are not copied and overwritten during a fork.
- Archiving does not delete branch evidence relationships or report history.
- Comparisons report differences and issue counts; they do not label a branch true, correct, or at fault.

`HypothesisComparison` is a derived projection containing changed actor trajectories/events, assumptions, supporting/conflicting evidence, unresolved questions, issues, and neutral summaries by branch.

## Questions and deterministic issues

An `OpenQuestion` has importance (`blocking | high | medium | low`) and one or more ranking reasons:

```text
blocks-report, resolves-contradiction, distinguishes-hypotheses,
required-field, contextual-detail
```

An answered question requires both an answer and `answerSource`. Agent-created questions are allowed; the agent may not invent a human answer.

A `ConsistencyIssue` records stable `ruleId`, scope, severity, explanation, affected IDs, and suggested actions. Scopes are timeline, geometry, damage, provenance, completeness, and report. Issues are recomputed outputs of deterministic rules, not authoritative forensic findings.

## Activity, change history, and idempotency

`ActivityEvent` records resulting `caseVersion`, author (`human | agent | system`), origin (`ui | webmcp | system`), action type, concise summary, affected IDs, optional request/correlation ID, undo eligibility, and timestamp.

Entity `ChangeRecord[]` provides local history for trajectories, events, claims, and branches. The visible activity log remains append-only: undo adds a new activity event rather than erasing the original.

The engine keeps exact completed-request receipts in memory. Request IDs are also written to `ActivityEvent` records inside the persisted case. After a reload, the activity match prevents the same request ID from applying the mutation again and yields a synthesized idempotent result. There is no separate durable receipt table containing the exact original result payload, and the in-memory receipt/history bounds reset with the engine.

## Reports

A `ReportPreview` is a projection tied to `caseId` and `caseVersion`. It contains ordered sections and statements. Each statement has a certainty class and citations split into claim IDs and evidence IDs.

Rules:

- confirmed-section statements cite only human-confirmed claims;
- reported/uncertain/hypothesis content retains its class;
- claim-derived factual statements cite valid, non-deleted support; structural scene, method, and table statements can be system-derived without a claim citation;
- hypotheses stay in a labeled appendix;
- missing requirements and unresolved questions remain visible;
- the disclaimer states that the report is not forensic or legal advice.

Finalization creates a `ReportSnapshot` with `humanAcknowledged: true` and `immutable: true`, exact preview, source IDs, included branches, case version, and time. Later edits create a newer preview/snapshot; they never mutate an older snapshot.

`ReportNote` stores text, supporting claim/evidence IDs, author, `reviewedByHuman`, and creation time. Human-authored notes are reviewed by definition. Agent notes begin unreviewed, are visibly labelled as drafts, and enter the report projection only after a human approval command; rejection removes the note.

## Runtime validation boundaries

Zod strict objects reject unknown keys. Local limits include bounded IDs/text/arrays, finite numbers, ISO timestamps, positive dimensions, ordered keyframes, valid MIME types, and coherent lock/deletion/answer flags.

Validation occurs at four boundaries:

1. deterministic seed creation;
2. IndexedDB load (plus the implemented Dexie table/index upgrade);
3. JSON import/backup restore;
4. every UI and WebMCP command payload.

Shape validation is necessary but insufficient. The implemented reference and command passes verify ID uniqueness, typed references, active branch, trajectory ownership, report citations, author permissions, locks, normalized scene values, and request/version semantics.

## Current migration and recovery behavior

- `ReplayCase.schemaVersion` is currently 1. Import accepts that version and rejects unsupported versions; there is no older case-shape migration pipeline yet.
- Dexie has database versions 1 and 2. Version 2 changes the evidence checksum index from globally unique to non-unique so different cases may store identical bytes.
- A failed parse of the most recent persisted case currently deletes that case record and returns to an empty landing state. Raw-record quarantine/export recovery is not implemented.
- JSON import is strict and size/reference validated, but it carries only structured `ReplayCase` data, not evidence blobs. Imported IDs are not re-keyed, and later save-by-ID can replace an existing local record with the same ID.
- A demo reset recreates the deterministic demo case ID; the database helper used by that path does not clear unrelated case records.

## Safety interpretation

This model preserves what was stated, observed, linked, disputed, unknown, or hypothesized. It does not encode liability, truthfulness, legal conclusions, or forensic confidence. Geometry and damage rules yield consistency hints only.

## Related authoritative references

- [WebMCP Draft Community Group Report, 2026-08-26](https://webmachinelearning.github.io/webmcp/)
- [Chrome WebMCP tool security, updated 2026-07-01](https://developer.chrome.com/docs/ai/webmcp/secure-tools)
- [OpenAI Site Tools, retrieved 2026-08-27](https://learn.chatgpt.com/docs/webmcp)
