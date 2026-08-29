# REPLAY architecture

Status: current-source architecture snapshot, reconciled with the repository on 2026-08-29. The calibrated-scene, motion-envelope, integrity, attestation, exact branch/provenance indexing, seed-v6, and four-scenario work described here is implemented and deterministically tested in the working tree but has not yet been deployed or exercised by a supported Site Tools model. The verification section preserves the narrower evidence for the last deployed commit.

## Architectural objective

REPLAY keeps evidence, human-confirmed facts, reported information, human completeness review, uncertainty, disputes, and agent inference distinct in one local incident model. Human UI actions and imperative WebMCP factual mutations reach the same domain command layer, while presentation-only focus is validated against canonical IDs and stays in the shared UI session. WebMCP may create a reversible coordinated-scene proposal, surface completeness gaps, or prepare report review, but only the human UI can adjust/accept/reject a proposal, confirm a claim, create/withdraw a completeness attestation, delete evidence, or finalize an immutable report snapshot.

```text
Human UI                                WebMCP / Site Tools
   |                                             |
   +------- same validated command or query -----+
   |                                             |
engine.execute(...)                    engine.stage(...)
live commit + notify                   isolated complete engine copy
   |                                             |
React + queued CAS save                CAS save staged ReplayCase
   |                                             |
Dexie / IndexedDB                      stage.commit() + notify React
                                                 |
                              post-save abort/conflict -> compensation
```

The paths share command semantics but deliberately differ in persistence order. The human UI can commit live before its queued save; WebMCP keeps a mutation isolated until its staged case saves successfully. The current application does not claim one physical transaction spanning React state, the command engine, browser paint, and Dexie.

## Runtime and dependencies

| Concern                  | Implemented technology                                 | Role                                                                                                                                 |
| ------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Build/runtime            | Vite 8, React 19, strict TypeScript                    | Static client application with no required backend.                                                                                  |
| Canonical state          | `ReplayEngine` plus React component state              | The engine owns and validates the current `ReplayCase`; React subscribes to committed results and owns transient presentation state. |
| Runtime validation       | Zod 4                                                  | Strict validation for case data, commands, imports, and WebMCP inputs.                                                               |
| Persistence              | Dexie 4 / IndexedDB                                    | Local case records and a separate local evidence-blob table.                                                                         |
| Functional scene         | Application-generated SVG                              | Selectable vehicles, trajectories, impact/damage markers, keyboard controls, and local export.                                       |
| Export                   | Browser SVG/Canvas pipeline plus jsPDF                 | Explicit local PDF, PNG, SVG, and structured JSON downloads with computed colors normalized to portable sRGB.                        |
| Unit/component tests     | Vitest, Testing Library, jsdom, fake-indexeddb         | Domain, timeline, WebMCP lifecycle, and component verification.                                                                      |
| End to end/accessibility | Playwright and axe-core                                | Desktop/mobile journeys, screenshots, and serious/critical automated accessibility guardrails.                                       |
| WebMCP typing            | Repository-owned declarations in `src/webmcp/types.ts` | Current proposed API shape with runtime feature detection; no `webmcp-types` dependency.                                             |

There is no Zustand or Immer store. `package.json` contains neither package.

## Layer boundaries

### Domain model and validation

`src/domain/models.ts` defines the TypeScript vocabulary for cases, calibrated road environments, actors with explicit dimension-source labels, trajectories, events, evidence and annotation links, claims, branches, questions, agent proposals/revisions/decisions, issues, activity, human completeness attestations, report notes, and snapshots. The current seed-v6 fixture records scene width/height in metres, calibration source and uncertainty, vehicle class, metre-scale length/width, dimension source, optional wheelbase, and an explicitly illustrative post-contact path change. `src/domain/schema.ts` supplies strict persisted-shape validation. `src/domain/importExport.ts` performs migration, unsigned-import trust reset, and cross-record checks for exact branch ownership, one actor/branch trajectory, and duplicate-free reciprocal provenance before seed, import, engine, or new persistence state is accepted.

Pure projections and deterministic rules stay outside React:

- `src/domain/roadTemplates.ts` defines calibrated roundabout, intersection, T-junction, straight-road, and parking-area templates;
- `src/domain/interpolation.ts` derives actor poses with exact linear interpolation for a two-point path and a time-aware cubic Hermite curve for three or more timed poses, with shortest-angle heading interpolation;
- `src/domain/physics.ts` converts normalized scene coordinates to metres, constructs oriented vehicle footprints, calculates contact/separation, and derives deterministic speed, acceleration, deceleration, yaw-rate, heading-mismatch, turn-radius, and lateral-acceleration metrics;
- `src/domain/consistency.ts` emits calibrated geometry, motion, damage, integrity, provenance, completeness, timeline, and report issues without deciding fault or intent;
- `src/domain/completeness.ts` fingerprints human/UI-only no-evidence, actor-damage, and uncertainty-review records against the exact state reviewed;
- `src/domain/demoScenarios.ts` provides four deterministic synthetic accounts for roundabout, straight-road rear-end, T-junction crossing, and parking-area contradiction review;
- `src/domain/report.ts` builds the evidence-bound preview;
- `src/domain/hypotheses.ts` compares branches without ranking one as true.

### ReplayEngine command boundary

`src/domain/engine.ts` is the canonical mutation boundary. UI handlers in `Workspace.tsx` construct domain commands and call `engine.execute(...)`. The adapter constructs the same commands and evaluates them through `engine.stage(...)` (or `stageAgentActionRevert(...)`) so WebMCP persistence can complete before the staged engine state becomes live.

For a normal direct/UI mutation, the engine currently:

1. checks an already-aborted signal;
2. validates the command with `ReplayCommandSchema`;
3. binds the request ID to the validated caller intent, then returns an exact in-memory receipt or a synthesized persisted-activity match for the same semantic fingerprint;
4. rejects an `expectedVersion` mismatch;
5. applies authorization, lock, provenance, and branch rules in the reducer;
6. recomputes deterministic consistency issues and attributable activity;
7. validates references and the complete next case;
8. replaces the in-memory case, records undo/receipt state, and notifies subscribers.

`engine.stage(...)` runs that same validation/reduction path on a cloned case, undo/redo history, and receipt map. Its returned state is isolated until `stage.commit()` verifies the live baseline version, adopts the full staged engine state, and notifies subscribers. Discarding a stage leaves the live engine untouched.

Every successful engine command increments `caseVersion`, including proposal creation/revision/decision and explicit validation commands. Workspace selection/focus, playback time, hover, menus, toasts, comparison selection, the replaceable report preview, and session invocation audit are presentation state and do not.

`proposal.create` is authorized only for agent/WebMCP origin. It stores immutable baseline and proposed geometry in a pending proposal without applying it. `proposal.adjust`, `proposal.accept`, and `proposal.reject` require a human/UI origin. Acceptance first validates every target baseline and lock, then applies the whole latest revision or rejects without a partial scene change.

A human confirmation is an attestation to one exact claim revision, including statement, source type/IDs, evidence links, event links, scene-object links, and any annotation-level provenance. A substantive change to any of those fields, newly linking an evidence item or annotation to the claim, changing/removing a linked annotation, or deleting linked/source evidence demotes the claim to `reported`, clears `humanConfirmed`/`confirmedAt`, and appends an explicit claim change record. A semantic no-op preserves the attestation. Reconfirmation remains a human/UI-only command.

Completeness attestations are separate canonical records for **no evidence supplied**, each actor's damage as **unknown** or **not assessed**, and **uncertainty review completed**. The reducer accepts their create/withdraw commands only from a human/UI origin. A canonical SHA-256 fingerprint binds each record to the relevant evidence index and tombstones, actor damage markers and selected outcome, or question register. Relevant later changes make the record stale without deleting history; imported records lose local human trust, and agent undo/revert cannot restore that authority. Current records can clear readiness and enter reports only as `attested` statements with canonical workspace citations, never as evidence or confirmed facts.

History snapshots and the fast request-receipt map are process-memory features. Activity persists each request ID with its semantic caller-intent fingerprint, original activity `caseVersion`, summary, activity ID, and affected IDs. After reload, a matching request/intent returns a synthesized `idempotent: true` response at that original version; a different intent with the same ID returns `IDEMPOTENCY_CONFLICT`. Legacy activity without a fingerprint retains action-type-only compatibility. Exact prior result payloads are not stored in a separate durable receipt table.

### React state and UI projections

`Workspace.tsx` creates one engine for the open case and subscribes React state to engine commits. React owns transient state including workspace selection/focus, playback time/speed, open inspector tab, report preview, comparison overlay, agent-working presentation, toasts, debug UI, and evidence object URLs.

The implemented manual path includes:

- landing page, optional replayable guide and guided workspace tour, deterministic demo, blank-case wizard, stable `#case/<encoded-case-id>` routes, and a landing list of retained local cases;
- actor placement and direct/exact rotation, timed trajectory-point creation/editing with smooth time-aware interpolation, exact impact-pair selection for multi-vehicle cases, damage marking, locks, timeline event creation/editing, and playback;
- claims with explicit certainty and human confirmation;
- local evidence upload, metadata, point/rectangle annotations, linking, and deletion;
- questions, hypothesis forks/assumptions, branch overlay, and side-by-side summaries;
- visible proposal review with human-only adjustment, acceptance, and rejection;
- consistency and human-only completeness review, evidence-bound preview, reviewed report notes, human-only finalization, and local exports;
- activity, undo/redo, safe agent-action reversion, and an in-workspace WebMCP inspector.

Report previews are replaceable React state and are invalidated after content mutations. Finalized previews live inside immutable `ReportSnapshot` records.

### Persistence sequencing, migration, and recovery

`src/persistence/database.ts` stores cases, evidence blobs, and durable evidence-purge intents in separate Dexie tables. Case records contain validated JSON metadata and blob keys, never object URLs. Evidence tombstoning, purge intent, and current-vault byte deletion share one transaction; startup reconciliation completes interrupted or legacy-vault deletion without depending on an in-memory queue. A visible landing-page human control can delete one whole local case across the current and legacy vaults; this direct storage lifecycle operation is deliberately absent from WebMCP and is not a domain fact mutation. Current schema-v2 state uses `replay-local-vault-v2`; the former `replay-local-vault` remains readable for migration/recovery so a rolled-back schema-v1 build cannot reject or delete newer state. Seed version and persistence schema version are separate concepts: the current deterministic fixture is seed-v6 while the persisted `ReplayCase` shape remains schema version 2.

Current sequencing is:

- on workspace mount, request persistent browser storage where supported, acquire a best-effort exclusive Web Locks editing lease, and save only after write access is available;
- after each direct/UI engine notification, update React immediately and queue compare-and-swap `saveCase(state)` with the prior case version; the header reports saving, saved, conflict, or error, and a failure pauses further mutations until retry succeeds while allowing an explicitly incomplete structured-transfer download;
- for imperative WebMCP mutations, reduce the same engine command on an isolated complete engine copy, call `persistCase(stagedState)` with the live baseline as the expected version, then adopt/notify only after that save resolves and the live baseline still matches;
- if a WebMCP primary save rejects, discard the stage and return `PERSISTENCE_FAILED` without changing live state; if cancellation or a live conflict occurs after a resolved save, compare-and-swap the pre-mutation live case back as explicit compensation, and return/audit `PERSISTENCE_FAILED` if compensation cannot be confirmed;
- for local evidence upload, validate/decode/hash the image, apply `evidence.add` as a manual-persistence command, then commit the resulting case metadata and blob bytes in one compare-and-swap IndexedDB transaction; a failed CAS or byte write leaves neither durable metadata nor an orphan blob, and a paused retry carries the in-memory attachment through the same transaction;
- for evidence load, verify case ID, checksum, MIME metadata, blob MIME, and SHA-256 bytes before display;
- treat `evidence.add` and `evidence.delete` as history barriers: removing local evidence must use the explicit delete command, whose scrubbed tombstone, durable purge intent, and current-vault byte deletion commit atomically; startup reconciliation removes any legacy-vault copy left after a crash; and
- use `BroadcastChannel` to pause a stale tab after another writer saves the same case.

The engine and Dexie do not share a physical rollback transaction. On the human UI path, a post-commit save failure can leave the in-memory case newer than the durable record. On the WebMCP path, staging prevents a rejected primary save from changing live state, and compensation normally reconciles a resolved save followed by cancellation or a live-version conflict; failed compensation is the explicit residual risk. Web Locks are not universal, compare-and-swap is the final local-write guard, and browser paint is not transactionally coupled to the tool promise.

Dexie table version 2 removes the former global uniqueness constraint from evidence checksums so the same bytes can exist in different cases. The `ReplayCase` JSON shape is schema version 2. Import/load migrates v1 by adding the v2 proposal, annotation-link, report-workspace-path, and completeness-attestation defaults. Malformed or unsupported local records are retained and can be downloaded as raw recovery JSON rather than silently deleted.

### WebMCP adapter and lifecycle

The client feature-detects `document.modelContext.registerTool`. Unsupported browsers retain the ordinary UI. `ReplayWebMCPRegistry` owns stable base, scene, facts, hypothesis, and report groups and registers/unregisters them with lifecycle `AbortController`s. Invocation signals are distinct from registration signals.

Imperative handlers:

- validate narrow Zod/JSON Schema input;
- set and clear visible agent-working state;
- call a query or stage the canonical engine command and its complete engine-side history/receipt effects;
- compare-and-swap save a changed staged case, then commit/notify it; compensate a resolved save when a later cancellation/live conflict prevents commit;
- reveal affected objects where applicable;
- return a compact result with current version, affected IDs, issues, and visible state.

The `validate_case_consistency` tool accepts `all`, `scene`, `timeline`, `geometry`, `motion`, `damage`, `integrity`, `provenance`, `completeness`, and `report`. The composite `scene` scope runs geometry, motion, and damage. Geometry uses metric calibration, oriented footprints from source-labelled vehicle dimensions, calibration uncertainty, and sampled swept footprints against the configured road. Motion applies deterministic review envelopes for speed, acceleration, deceleration, yaw rate, heading/travel mismatch, turn radius, and lateral acceleration. Integrity covers calibration/dimension-source quality and unsigned-import signals. These outputs test internal consistency with recorded inputs and declared assumptions; they are not forensic findings, truth or lie detection, proof of actual motion, or intent attribution.

Successful domain mutations already contain durable canonical activity. A successful/rejected read or UI-only invocation without a canonical activity ID is added to a separate capped session audit outside `ReplayCase`; `get_recent_activity` merges both views and filters by author before applying its limit. This preserves invocation visibility without changing case version, persistence, report eligibility, or canonical history.

Cancellation is checked before adapter work, before staging, before the primary save, and before staged commit. A cancellation before primary persistence begins leaves live state, durable state, and both audit layers unchanged. If it arrives while a non-cancellable primary save is pending, the adapter waits for that save's outcome; a resolved save is compensated before `AbortError` is surfaced, while failed compensation returns/audits `PERSISTENCE_FAILED`. Deterministic adapter tests cover these branches; combined real-adapter + actual-Dexie/browser timing remains a manual integration gate.

The visible declarative form is named `finalize_factual_report`, includes `tooldescription`, and intentionally omits `toolautosubmit`. In a compatible declarative client, `toolactivated` marks the form prepared and opens the visible review; `toolcancel` clears the prepared state. OpenAI's built-in Site Tools browser currently does not expose declarative form tools, although its ordinary browser capabilities may still interact with forms outside WebMCP. REPLAY's acknowledgements, second confirmation, and final control remain human-only policy boundaries, and no imperative finalization tool is registered.

### Reports and exports

Reports are deterministic projections over a case version. Confirmed sections draw only from human-confirmed claims; reported, uncertain, disputed, and hypothetical material remains labelled. Human-reviewed report notes can enter a preview, while unreviewed agent notes remain excluded.

Finalization creates an immutable snapshot through `report.finalize`, which the reducer rejects for agent/WebMCP origin. PDF, SVG, PNG, and JSON exports are explicit local UI actions. JSON is a structured case transfer, not a full-fidelity backup: it excludes evidence blobs and contains the source case ID. The visible import flow creates a re-keyed local copy, deliberately clears or demotes human confirmations, completeness-attestation trust, answers, reviewed notes, and immutable snapshots because the transfer is unsigned, and records an import trust-reset signal for integrity review. A fresh local UI review is required before imported completeness history can satisfy readiness. A save-failure transfer does not clear the mutation pause; only a successful durable retry does. SVG/PNG preserve the current semantic scene layers while removing transient edit state, resetting pan/zoom, visibly labelling every impact with an ordinal/time/certainty key, and appending a non-overlapping review band with case version, branch, playhead, certainty/authorship, comparison/proposal context, and the non-simulation disclaimer. A current draft PDF can embed a synchronously frozen copy of that labelled scene. Finalized PDFs explicitly omit the live scene because report snapshots do not yet bind an immutable image, playhead, or comparison selection. Report paragraphs, citations, and long titles paginate or wrap; directly rendered PDF text uses bundled Unicode fonts with glyph-coverage checks; and scene rasterization has a bounded timeout with cleanup. Final release verification must still inspect downloaded files.

## Error and recovery behavior

- A root React error boundary offers reload or return home and does not upload error data.
- Invalid commands return structured domain failures; UI failures become toasts or save status.
- Imports are size-bounded, strictly parsed, version-checked, and reference-validated.
- Evidence upload rejects unsupported signatures/MIME mismatches, files over 20 MiB, unreadable images, duplicates within the case, and images over the implemented 12,000-pixel-per-side or 16-megapixel limits. PNG, JPEG, and WebP container dimensions are checked before browser decode allocation and checked again after decode. The asynchronous upload remains pinned to its starting case identity so a case switch cannot cross-link blob bytes.
- Invalid/unsupported persisted records are skipped without deletion and offered through a raw-recovery download. The raw payload is not trusted or automatically repaired.
- Export failures leave the case open and display an error.

## Deployment boundary

The artifact is a static application publishable over HTTPS. The repository includes Vite preview headers, provider-neutral `_headers`/`_redirects`, production CSP/referrer meta policies, and a Cloudflare Pages `wrangler.toml`. GitHub Pages does not honor `_headers` and shares the `artem-musii.github.io` storage origin with other projects. The application refuses to render/register tools inside a frame, but the full response-header and dedicated-origin contract remains a separate header-capable-host gate.

## Verification status

The current working tree adds seed-v6 calibration/dimensions, five road templates, smooth timed interpolation, oriented contact and swept-road checks, explicit authored post-contact geometry, motion advisories, four deterministic scenarios including the path-derived 65–80 km/h straight-road case, exact actor-pair impact placement for multi-vehicle cases, stable local-case routes/listing, exact branch/provenance indexing, narrow audited local-vault repair, unsigned-import integrity reporting, exact-revision claim-attestation invalidation, and state-bound human completeness attestations. Those additions have focused deterministic coverage in the repository, but this document does not treat them as deployed, native-client, or supported-model evidence. A fresh frozen-commit CI/deployment and live supported-model traces remain pending.

Application commit `00688d8a51fb783dbf147e08ece60470b8877544` passed the 2026-08-28 local and CI release gates: **136/136 Vitest tests across 15 files**, **103 passing plus 5 intentionally skipped Playwright project runs**, strict typecheck/lint/build, and 10 screenshot baselines. GitHub Actions run `33161848637` (verify job `98817932649`; deploy job `98818739202`) published Pages deployment `6139340101` from artifact `9682041096` (3,009,246 bytes; SHA-256 `9fae713230ec290ca8255641b1d13c89d59b155041aa9a68403d3231caff645e`), and all 43 public files byte-matched it. The public demo then passed a **100/100/100/100** Lighthouse 13.4.1 audit with FCP 503.479 ms, LCP/TTI 623.479 ms, Speed Index 745.184 ms, TBT 0 ms, and CLS 0; the report SHA-256 is `7c903b69675faa5e70283876434cca6da501a56d8c44d058706c5c90262714e4`.

A fresh cache-busted live smoke of that deployed commit opened the guide, checked the WebMCP experience, loaded its seed-v3 fixture, and exercised vehicle rotation, trajectory-point addition, and uncertainty editing with zero console warnings/errors, failed requests, or off-origin requests. This historical release evidence does not cover the current-source seed-v6 realism/integrity additions and does not establish broad native-client compatibility, declarative behavior, or a supported-model trace.

The historical `f980d28` snapshot remains preserved with **53/53 Vitest tests**, **32/32 Playwright runs**, axe/Lighthouse evidence, and its then-native 17→18 Site Tools smoke. Broad current native-client compatibility, complete screen-reader/WCAG conformance, dedicated-origin headers, exported-file fidelity, and supported-model eval traces remain external gates.

## External architecture references

- [WebMCP Draft Community Group Report, 2026-08-26](https://webmachinelearning.github.io/webmcp/)
- [Chrome WebMCP overview, updated 2026-08-07](https://developer.chrome.com/docs/ai/webmcp)
- [Chrome Imperative API, updated 2026-08-20](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
- [Chrome Declarative API, published 2026-05-18](https://developer.chrome.com/docs/ai/webmcp/declarative-api)
- [OpenAI Site Tools, retrieved 2026-08-28](https://learn.chatgpt.com/docs/webmcp)
