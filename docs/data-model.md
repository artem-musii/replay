# REPLAY canonical data model

Status: implemented model snapshot aligned to `src/domain/models.ts`, `src/domain/schema.ts`, `src/domain/importExport.ts`, and the `ReplayEngine` command layer as inspected on 2026-08-29. Known persistence and migration limits are recorded below.

## Two independent versions

- `schemaVersion` identifies the persisted JSON shape and drives migrations. The current constant is `REPLAY_SCHEMA_VERSION = 2`; v1 is migrated on import/load.
- `seedVersion` identifies the deterministic demo fixture independently from user-case migrations. The current constant is `REPLAY_SEED_VERSION = 6`. Schema v2 accepts historical positive seed versions through 6 so an older saved demo can resume from its case-specific URL while every new demo action starts a separate current fixture.
- `caseVersion` is the monotonically increasing optimistic-concurrency revision. The current engine increments it once for every successful canonical command, including `case.validate`. Workspace selection/focus, hover, playback time, menus, and other React-only presentation state do not change it.

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
├── proposals[] <── immutable revisions + human decision record
├── consistencyIssues[] <── affected IDs
├── activity[] <── durable version, author/origin, override correlation, request ID + semantic fingerprint
├── completenessAttestations[] <── human/UI-only readiness records bound to exact reviewed state
├── reportNotes[] <── supporting claim/evidence IDs
└── reportSnapshots[] <── immutable versioned preview + included IDs
```

All references use stable opaque string IDs. Display labels, filenames, statements, and assumption text are never identifiers and never executable instructions.

## Root shape

The implemented TypeScript contract is conceptually:

```ts
interface ReplayCase {
  schemaVersion: 2;
  seedVersion?: number; // positive integer <= REPLAY_SEED_VERSION (currently 6)
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
  proposals: AgentProposal[];
  activity: ActivityEvent[];
  consistencyIssues: ConsistencyIssue[];
  completenessAttestations: CompletenessAttestation[];
  reportNotes: ReportNote[];
  reportSnapshots: ReportSnapshot[];
  selectedItem?: WorkspaceSelection;
  workspaceMode: WorkspaceMode;
}
```

`selectedItem` and `workspaceMode` remain in schema v2 for backward compatibility and provide only the initial workspace hint when a case opens. Current UI and WebMCP focus changes are session-only: they do not increment `caseVersion`, append durable activity, or promise to survive reload/export. Transient hover, drag previews, playback time, toasts, and agent-working state likewise remain outside durable case mutation.

## Scene and time

### Environment

`EnvironmentState` contains:

- scene type: `roundabout | intersection | t-junction | straight-road | parking-area`;
- road condition: `wet | dry | unknown`;
- weather: `clear | rain | overcast | unknown`;
- lighting: `daylight | dusk | night | unknown`;
- finite scene bounds with positive area;
- a road polygon with at least three points.

The deterministic scenario library exercises the roundabout, T-junction, straight-road, and parking-area contexts; the blank-case wizard exposes all five bounded templates. These are calibrated authoring surfaces, not a universal road or collision simulator.

### Actors and poses

The only actor kind is `vehicle`. A `SceneActor` owns label, dimensions, color token, fallback pose, lock metadata, and damage markers. A vehicle’s animated branch pose comes from its branch trajectory; its fallback `pose` is used when no trajectory exists.

`ActorPose` contains bounded finite `x`, `y`, and `rotationDeg`. Coordinates are limited to ±1,000,000 scene units and rotation to ±1,000,000 degrees before downstream arithmetic. Commands—not the local shape alone—must normalize positions to the scene coordinate system, normalize rotation, enforce road bounds where appropriate, and reject invalid dimensions.

`DamageRegion` is an explicit enum:

```text
front, front-left, front-right, left-side, right-side,
rear-left, rear-right, rear, unknown
```

A damage marker records its actor, region, description, claim/evidence links, status, and author. Agent-origin commands may create only non-confirmed statuses. Marker↔evidence and marker↔claim links are duplicate-free reciprocal pairs; updating or deleting one side uses the canonical relation helpers so stale reverse links cannot survive. Damage relationships do not implicitly manufacture a direct claim↔evidence citation.

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
- Damage marker↔evidence, damage marker↔claim, direct claim↔evidence, event↔claim, and event↔evidence pairs are reciprocal and duplicate-free.
- Deleted evidence cannot remain an eligible report citation.

Zod enforces the local shape invariants. The reducer enforces actor/origin authorization, locks, and human-only claim confirmation and completeness attestation, while import/engine validation checks cross-record references before accepting the case.

## Evidence

`EvidenceAsset` stores metadata and a `localBlobKey`; binary data belongs in a separate IndexedDB blob record. The current schema permits JPEG, PNG, and WebP images up to 20 MiB and requires a checksum. Source is `demo | local-upload | import`.

Important fields:

- `syntheticDemoAsset` distinguishes generated demonstration imagery;
- `notes` and `name` are untrusted text;
- tags and point/rectangle annotations remain structured;
- annotation coordinates are normalized to `0..1`;
- asset-level claim/event/scene-object/branch links are explicit;
- `annotationLinks[]` can bind a specific annotation to a claim, timeline event, actor, trajectory, damage marker, hypothesis, or assumption; an assumption link also records the asset as supporting evidence; and
- deletion scrubs active metadata/links and leaves a minimal `deleted`/`deletedAt` tombstone so historical attribution survives without retaining the original blob details.

Object URLs, decoded image elements, and thumbnails are presentation cache, not canonical data. The application must never store an object URL as evidence identity.

## Hypotheses

`HypothesisBranch` has a parent, shared claim IDs, branch-local assumption objects, trajectory/event/claim IDs, lifecycle status, author, timestamps, and change history.

An assumption records statement, active/withdrawn status, supporting/conflicting evidence IDs, author, and timestamps. Assumptions are explanatory inputs, never confirmed facts.

Branch invariants:

- `activeBranchId` references an existing non-archived branch.
- Every trajectory, event, and non-shared claim appears exactly once in its owning branch index and in no other branch index; every global shared claim appears once in every branch’s shared index.
- Each actor has at most one trajectory in a branch; imports and commands reject ambiguous duplicates.
- Parent links are acyclic.
- Shared confirmed/locked claims are not copied and overwritten during a fork.
- Archiving does not delete branch evidence relationships or report history.
- Comparisons report differences and issue counts; they do not label a branch true, correct, or at fault.

`HypothesisComparison` is a derived projection containing changed actor trajectories/events, assumptions, supporting/conflicting evidence, unresolved questions, issues, and neutral summaries by branch.

## Coordinated scene proposals

`AgentProposal` is a durable, reviewable ledger entry with title, rationale, `pending | accepted | rejected` status, immutable revisions, and an optional human decision. It is intentionally separate from actors and trajectories: creating or revising a proposal does not apply its geometry.

Each `AgentProposalRevision` records a revision number, summary, agent/human author, WebMCP/UI origin, trust marker, timestamp, and one or more changes:

- `actor-pose` stores the actor’s base pose and proposed pose, the reviewed branch and exact playhead time, and the complete reviewed trajectory baseline when one exists;
- `trajectory-set` stores actor/branch/trajectory identity, whether the trajectory would be created, base actor pose, optional base trajectory, and proposed keyframes/visibility.

Required invariants:

- only agent/WebMCP origin can create a proposal;
- only human/UI origin can adjust, accept, or reject it;
- only the latest pending revision can be decided;
- acceptance checks every actor/trajectory baseline and lock before applying any change, including actor-pose branch/playhead drift or trajectory replacement, so a stale, ambiguous, or locked target rejects the whole decision without a partial scene update;
- accepted/rejected proposals require a human decision record tied to the exact revision; and
- unsigned import preserves proposal and decision history but sets revision authorship and human-attestation trust markers to false until reviewed locally.

## Questions and deterministic issues

An `OpenQuestion` has importance (`blocking | high | medium | low`) and one or more ranking reasons:

```text
blocks-report, resolves-contradiction, distinguishes-hypotheses,
required-field, contextual-detail
```

An answered question requires both an answer and `answerSource`. Agent-created questions are allowed; the agent may not invent a human answer.

A `ConsistencyIssue` records stable `ruleId`, scope, severity, explanation, affected IDs, and suggested actions. Scopes are timeline, geometry, damage, provenance, completeness, and report. Issues are recomputed outputs of deterministic rules, not authoritative forensic findings.

## Human completeness attestations

`CompletenessAttestation[]` lets a person close a legitimate readiness gap without inventing evidence or silently converting an unknown into a fact. The supported subjects are:

```text
no-evidence-supplied
actor-damage + actorId + outcome (unknown | not-assessed)
uncertainty-review-completed
```

Each record carries a stable ID, `attestedBy: "human"`, `origin: "ui"`, timestamp, `humanAttestationTrusted`, and a `completeness-v1-sha256-…` basis fingerprint. The fingerprint binds the no-evidence decision to the evidence index and deletion tombstones, actor damage review to that actor's damage markers and chosen outcome, and uncertainty review to the question register. A relevant later change makes the record stale without deleting its audit history; only a fresh human UI action can make it current again. Agent/WebMCP commands may surface missing requirements but cannot create or withdraw these records, and agent undo/revert cannot restore their authority.

Unsigned import preserves completeness records only as untrusted history. A fresh local UI review is required before they satisfy consistency/report readiness. Current records appear in reports with `certainty: "attested"`, a **Human attestation** label, and a canonical `completenessAttestations.<id>` citation. The copy explicitly distinguishes a reviewed completeness outcome from evidence of absence or proof that unknown information is certain.

## Activity, change history, and idempotency

`ActivityEvent` records resulting `caseVersion`, author (`human | agent | system`), origin (`ui | webmcp | system`), action type, concise summary, affected IDs, optional request ID and `requestIntentFingerprint`, undo eligibility, and timestamp. The fingerprint binds a WebMCP request ID to the validated caller intent—tool type, actor/origin, and full semantic payload, excluding `requestId` and `expectedVersion`; revert intent includes its requested activity target. A human UI correction that directly overrides an eligible agent mutation may additionally set `classification: "human-override"` and `overridesActivityId`; both fields must appear together and must reference an earlier agent/WebMCP activity.

Entity `ChangeRecord[]` provides local history for trajectories, events, claims, and branches. The visible activity log remains append-only: undo adds a new activity event rather than erasing the original.

The engine keeps exact completed-request receipts in memory. Repeating a request with the same fingerprint returns that exact receipt with `idempotent: true` and its original `caseVersion`, even if the supplied `expectedVersion` is now stale; it performs no new save or activity. Persisted `ActivityEvent` records let a reload synthesize the same safety outcome using the original activity version, ID, summary, and affected IDs. Reusing the request ID for different semantic intent returns `IDEMPOTENCY_CONFLICT`. Legacy activity without a fingerprint retains action-type-only compatibility. There is no separate durable receipt table containing the exact original result payload, and the in-memory receipt/history bounds reset with the engine.

The workspace also maintains up to 100 session-only Site Tools invocation entries outside `ReplayCase` for successful/rejected reads and UI-only calls that have no canonical activity ID. `get_recent_activity` merges that session view with durable case activity and filters by author before limiting. Session audit does not increment `caseVersion`, affect report eligibility, or persist across reload. A WebMCP mutation canceled before primary persistence records neither canonical nor session activity; a failed post-save compensation is session-audited with `PERSISTENCE_FAILED`.

## Reports

A `ReportPreview` is a projection tied to `caseId` and `caseVersion`. It contains ordered sections and statements. Each statement has a certainty class and citations split into claim IDs, evidence IDs, and validated `workspacePaths`.

Rules:

- confirmed-section statements cite only human-confirmed claims;
- reported/uncertain/hypothesis content retains its class;
- claim-derived substantive factual statements cite valid, non-deleted support; structural scene, method, and table statements may instead cite allowlisted workspace paths such as case metadata, environment, actor poses, trajectories, events, damage, branches, questions, and deterministic issues;
- hypotheses stay in a labeled appendix;
- missing requirements and unresolved questions remain visible;
- the disclaimer states that the report is not forensic or legal advice.

Finalization creates a `ReportSnapshot` with `humanAcknowledged: true` and `immutable: true`, exact preview, source IDs, included branches, case version, and time. Later edits create a newer preview/snapshot; they never mutate an older snapshot.

`ReportNote` stores text, supporting claim/evidence IDs, author, `reviewedByHuman`, and creation time. Human-authored notes are reviewed by definition. Agent notes begin unreviewed, are visibly labelled as drafts, and enter the report projection only after a human approval command; rejection removes the note.

## Runtime validation boundaries

Zod strict objects reject unknown keys. Local limits include bounded IDs/text/arrays, XML 1.0-serializable strings, scene coordinates/rotation, one-year maximum timeline values, minimum non-zero scene/time spans, centimetre-or-larger calibration, ISO timestamps, positive dimensions, ordered keyframes, valid MIME types, and coherent lock/deletion/answer flags.

Validation occurs at four boundaries:

1. deterministic seed creation;
2. IndexedDB load (plus the implemented Dexie table/index upgrade);
3. structured JSON import/transfer;
4. every UI and WebMCP command payload.

Shape validation is necessary but insufficient. The implemented reference and command passes verify global and per-index ID uniqueness, typed references, exact branch ownership, one trajectory per actor/branch, reciprocal provenance pairs, report citations, author permissions, locks, affine scene values, and request/version semantics.

## Current migration, import, and recovery behavior

- `ReplayCase.schemaVersion` is 2. The v1→v2 migration adds empty `proposals`/`annotationLinks` and empty report `workspacePaths`, then applies strict current-schema and cross-reference validation. Other unsupported versions are not guessed into shape.
- Current cases live in origin-local `replay-local-vault-v2`; the legacy vault remains readable for migration/recovery. Dexie table version 2 changes the evidence checksum index from globally unique to non-unique so different cases may store identical bytes. Version 3 adds a durable evidence-purge queue: evidence tombstoning, queue insertion, and current-vault byte deletion share the case save transaction, while startup reconciliation completes any legacy or interrupted cleanup without losing the original blob key.
- Invalid/unsupported local records are skipped without deletion and retained for explicit raw-recovery download. A raw copy is not validated or safe merely because it was retained. Ambiguous duplicate actor/branch trajectories and unclear ownership remain quarantined rather than guessed.
- The IndexedDB read path alone can deterministically repair the released duplicate/asymmetric reciprocal indexes and the proven legacy no-branch/false-shared claim shape. That narrow repair preserves direct claim citations, removes the old damage-derived claim/evidence cross-product, increments `caseVersion`, and appends one system migration activity before the first canonical save. Structured imports, direct engine construction, and every new persistence write remain strict and receive no repair fallback.
- Local evidence blobs are checked against case ID, checksum, metadata MIME, blob MIME, and SHA-256 bytes before display.
- Case saves use compare-and-swap inside a Dexie transaction. Ordinary UI commands commit live before their queued save and pause on failure until a durable retry succeeds. A structured-transfer download remains available while paused, but it excludes evidence bytes, resets trust when imported, and does not resume mutations. WebMCP reduces on an isolated engine copy, saves the staged case first, then adopts/notifies; a rejected primary save leaves live state untouched, while post-save cancellation/live conflict compensates and a failed compensation returns/audits `PERSISTENCE_FAILED`. A best-effort exclusive Web Locks lease and BroadcastChannel notices pause competing tabs where supported; none of these controls creates one physical engine/Dexie/browser-paint transaction.
- Structured JSON carries only `ReplayCase`, not evidence blobs, and contains the source case ID. The visible import flow supplies a fresh `case-import-*` root ID and rewrites root-case references before save; stable entity IDs inside the new local copy remain unchanged.
- An unsigned external import is intentionally untrusted: confirmed claims/events are demoted, answered questions reopen, reviewed notes become unreviewed, finalized snapshots are removed, activity is relabelled system/unverified and loses request/override attestations, proposal trust markers are cleared, completeness attestations lose local human trust, and missing local blobs are tombstoned. Trusted local-vault migration does not perform this trust reset.
- Demo runs have unique root case IDs. Bare `/#demo`, landing scenario cards, and **Start fresh demo copy** create a new seed-v6 run without deleting or overwriting an earlier run, then rewrite the location to `#case/<encoded-case-id>`. The landing page lists every retained run under **Your local cases**; only its stable route resumes that case in the same browser origin/profile, and an unavailable route reports the problem instead of substituting another case. Valid legacy seed-v1 through seed-v6 records remain accepted by the current schema.

## Safety interpretation

This model preserves what was stated, observed, linked, disputed, unknown, or hypothesized. It does not encode liability, truthfulness, legal conclusions, or forensic confidence. Geometry and damage rules yield consistency hints only.

## Related authoritative references

- [WebMCP Draft Community Group Report, 2026-08-26](https://webmachinelearning.github.io/webmcp/)
- [Chrome WebMCP tool security, updated 2026-07-01](https://developer.chrome.com/docs/ai/webmcp/secure-tools)
- [OpenAI Site Tools, retrieved 2026-08-28](https://learn.chatgpt.com/docs/webmcp)
