# REPLAY architecture

Status: implemented architecture snapshot, reconciled with the repository on 2026-08-27. This document distinguishes current behavior from release work that still requires manual or external verification.

## Architectural objective

REPLAY keeps evidence, human-confirmed facts, reported information, uncertainty, disputes, and agent inference distinct in one local incident model. Human UI actions and imperative WebMCP tools both reach the same `ReplayEngine` command layer. WebMCP may prepare a report review, but only the human UI can confirm a claim or finalize an immutable report snapshot.

```text
Human UI                                WebMCP / Site Tools
   |                                             |
   +-------------- command or query -------------+
                         |
                ReplayEngine / projections
                         |
       Zod validation -> reducer -> consistency
                         |
              committed in-memory ReplayCase
                    /                   \
          React subscription       post-command save
                    |                   |
 SVG scene / timeline / inspector   Dexie / IndexedDB
```

The engine commit and IndexedDB save are deliberately shown as separate steps. The current application does not claim a single transaction spanning React state, the command engine, and Dexie.

## Runtime and dependencies

| Concern                  | Implemented technology                                 | Role                                                                                                                                 |
| ------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Build/runtime            | Vite 8, React 19, strict TypeScript                    | Static client application with no required backend.                                                                                  |
| Canonical state          | `ReplayEngine` plus React component state              | The engine owns and validates the current `ReplayCase`; React subscribes to committed results and owns transient presentation state. |
| Runtime validation       | Zod 4                                                  | Strict validation for case data, commands, imports, and WebMCP inputs.                                                               |
| Persistence              | Dexie 4 / IndexedDB                                    | Local case records and a separate local evidence-blob table.                                                                         |
| Functional scene         | Application-generated SVG                              | Selectable vehicles, trajectories, impact/damage markers, keyboard controls, and local export.                                       |
| Export                   | jsPDF and `html-to-image`                              | Explicit local PDF, PNG, SVG, and structured JSON downloads.                                                                         |
| Unit/component tests     | Vitest, Testing Library, jsdom, fake-indexeddb         | Domain, timeline, WebMCP lifecycle, and component verification.                                                                      |
| End to end/accessibility | Playwright and axe-core                                | Desktop/mobile journeys, screenshots, and serious/critical automated accessibility guardrails.                                       |
| WebMCP typing            | Repository-owned declarations in `src/webmcp/types.ts` | Current proposed API shape with runtime feature detection; no `webmcp-types` dependency.                                             |

There is no Zustand or Immer store. `package.json` contains neither package.

## Layer boundaries

### Domain model and validation

`src/domain/models.ts` defines the TypeScript vocabulary for cases, actors, trajectories, events, evidence and annotations, claims, branches, questions, issues, activity, report notes, and snapshots. `src/domain/schema.ts` supplies strict persisted-shape validation. `src/domain/importExport.ts` performs cross-record reference checks for seed, import, engine state, and persistence loads.

Pure projections and deterministic rules stay outside React:

- `src/domain/interpolation.ts` derives an actor pose at a time;
- `src/domain/consistency.ts` emits structured issues without deciding fault;
- `src/domain/report.ts` builds the evidence-bound preview;
- `src/domain/compare.ts` compares branches without ranking one as true.

### ReplayEngine command boundary

`src/domain/engine.ts` is the canonical mutation boundary. Both UI handlers in `Workspace.tsx` and the adapter in `src/integration/replayWebMCPAdapter.ts` construct domain commands and call `engine.execute(...)`.

For a normal mutation, the engine currently:

1. checks an already-aborted signal;
2. validates the command with `ReplayCommandSchema`;
3. returns an in-memory receipt or persisted activity match for a repeated request ID;
4. rejects an `expectedVersion` mismatch;
5. applies authorization, lock, provenance, and branch rules in the reducer;
6. recomputes deterministic consistency issues and attributable activity;
7. validates references and the complete next case;
8. replaces the in-memory case, records undo/receipt state, and notifies subscribers.

Every successful engine command currently increments `caseVersion`, including persisted workspace focus and explicit validation commands. Playback time, hover, menus, toasts, comparison selection, and other React-only state do not.

History snapshots and the fast request-receipt map are process-memory features. Activity, including request IDs, is stored in the `ReplayCase`; after reload, that activity provides bounded duplicate-request recognition, but exact prior result payloads are not stored in a separate durable receipt table.

### React state and UI projections

`Workspace.tsx` creates one engine for the open case and subscribes React state to engine commits. React owns transient state including playback time/speed, open inspector tab, report preview, comparison overlay, agent-working presentation, toasts, debug UI, and evidence object URLs.

The implemented manual path includes:

- landing page, deterministic demo, blank-case wizard, and local resume;
- actor placement and rotation, trajectory creation/editing, impact and damage marking, locks, timeline event creation/editing, and playback;
- claims with explicit certainty and human confirmation;
- local evidence upload, metadata, point/rectangle annotations, linking, and deletion;
- questions, hypothesis forks/assumptions, branch overlay, and side-by-side summaries;
- consistency review, evidence-bound preview, reviewed report notes, human-only finalization, and local exports;
- activity, undo/redo, safe agent-action reversion, and an in-workspace WebMCP inspector.

Report previews are replaceable React state and are invalidated after content mutations. Finalized previews live inside immutable `ReportSnapshot` records.

### Persistence sequencing

`src/persistence/database.ts` stores cases and evidence blobs in separate Dexie tables. Case records contain validated JSON metadata and blob keys, never object URLs.

Current sequencing is:

- on workspace mount, save the opened case;
- after each engine notification, update React immediately and start `saveCase(state)`; the header reports saving, saved, or error;
- for imperative WebMCP mutations, execute the same engine command and then await the adapter's `persistCase` callback before returning a successful tool result;
- for local evidence upload, validate/decode/hash the image, write the blob first, then add domain metadata; delete the just-written blob if the metadata command fails;
- for evidence deletion, tombstone/unlink domain metadata, then delete the local blob and revoke its object URL.

The engine and Dexie do not share a rollback transaction. If a post-command save fails, the in-memory case can be newer than the durable record. The UI exposes a save error, and a WebMCP call can surface execution failure, but neither path rolls back the already-committed engine state. This is a known integrity/recovery limitation, not an atomicity claim.

Dexie schema version 2 removes the former global uniqueness constraint from evidence checksums so the same bytes can exist in different cases. The `ReplayCase` JSON shape remains schema version 1. Unsupported JSON schema versions are rejected; a general case-shape migration/quarantine UI is not implemented.

### WebMCP adapter and lifecycle

The client feature-detects `document.modelContext.registerTool`. Unsupported browsers retain the ordinary UI. `ReplayWebMCPRegistry` owns stable base, scene, facts, hypothesis, and report groups and registers/unregisters them with lifecycle `AbortController`s. Invocation signals are distinct from registration signals.

Imperative handlers:

- validate narrow Zod/JSON Schema input;
- set and clear visible agent-working state;
- call a query or the canonical engine command;
- await post-command case persistence for successful mutations;
- reveal affected objects where applicable;
- return a compact result with current version, affected IDs, issues, and visible state.

Cancellation is checked before adapter work and before the synchronous engine command. A cancellation before engine commit leaves the case unchanged. Once the engine has committed, a later cancellation or persistence failure does not roll the command back. Cancellable fake-adapter lifecycle behavior is covered by registry tests; real-browser cancellation during storage remains a manual integration gate.

The visible declarative form is named `finalize_factual_report`, includes `tooldescription`, and intentionally omits `toolautosubmit`. `toolactivated` marks the form as Site Tools-prepared and opens the visible review; `toolcancel` clears the prepared state. The person must still check all acknowledgements, continue to a second confirmation, and click the final human control. No imperative finalization tool is registered.

### Reports and exports

Reports are deterministic projections over a case version. Confirmed sections draw only from human-confirmed claims; reported, uncertain, disputed, and hypothetical material remains labelled. Human-reviewed report notes can enter a preview, while unreviewed agent notes remain excluded.

Finalization creates an immutable snapshot through `report.finalize`, which the reducer rejects for agent/WebMCP origin. PDF, SVG, PNG, and JSON exports are explicit local UI actions. The JSON export contains the structured `ReplayCase`; it is not a complete binary-evidence backup. PDF and scene image exports render the currently visible scene, so final release verification must confirm that the visible branch/time matches the intended preview.

## Error and recovery behavior

- A root React error boundary offers reload or return home and does not upload error data.
- Invalid commands return structured domain failures; UI failures become toasts or save status.
- Imports are size-bounded, strictly parsed, version-checked, and reference-validated.
- Evidence upload rejects unsupported MIME types, files over 20 MiB, unreadable images, duplicates within the case, and images over the implemented decoded-dimension/pixel limits.
- Invalid most-recent persisted cases are currently deleted after failed import validation rather than quarantined; there is no raw-record recovery UI.
- Export failures leave the case open and display an error.

## Deployment boundary

The production artifact is a static application. The repository includes Vite preview headers, provider-neutral `_headers`/`_redirects`, and a Cloudflare Pages `wrangler.toml`. HTTPS hosting and live response-header checks remain external release gates; committed configuration is not proof of a deployed URL.

## Verification status

The recorded 2026-08-27 local snapshot reports:

- lint, strict typecheck, and production build passed;
- Vitest: **53/53 tests across 6 files**;
- Playwright: **32/32 project runs in 14.7 seconds** (16 scenarios in desktop Chromium and 16 in mobile Chrome);
- automated axe checks found no serious or critical violations in the four covered states.

The deterministic suite covers engine invariants, schema/seed/import behavior, hypotheses/evidence/reports, interpolation/consistency, timeline components, and WebMCP registry behavior. It does not establish live Site Tools compatibility, durable cross-layer atomicity, complete screen-reader/WCAG conformance, production header correctness, exported-file fidelity, Lighthouse performance, or the probabilistic model eval matrix.

## External architecture references

- [WebMCP Draft Community Group Report, 2026-08-26](https://webmachinelearning.github.io/webmcp/)
- [Chrome WebMCP overview, updated 2026-08-07](https://developer.chrome.com/docs/ai/webmcp)
- [Chrome Imperative API, updated 2026-08-20](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
- [Chrome Declarative API, published 2026-05-18](https://developer.chrome.com/docs/ai/webmcp/declarative-api)
- [OpenAI Site Tools, retrieved 2026-08-27](https://learn.chatgpt.com/docs/webmcp)
