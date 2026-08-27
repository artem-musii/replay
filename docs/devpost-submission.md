# Devpost submission draft

The application and repository links below currently resolve to the historical public build. The schema-v2/proposal candidate must be deployed and reverified before submission. Replace the remaining YouTube placeholder after recording the final public demo; do not submit with that placeholder.

## Project title

**REPLAY**

## One-line description

REPLAY is a local-first visual workspace where a person and an AI agent reconstruct a minor road incident together while keeping evidence, memory, uncertainty, dispute, and agent inference visibly distinct.

## Links

- Live app: [https://artem-musii.github.io/replay-sol/](https://artem-musii.github.io/replay-sol/)
- Deterministic demo: [https://artem-musii.github.io/replay-sol/#demo](https://artem-musii.github.io/replay-sol/#demo)
- Public repository: [https://github.com/artem-musii/replay-sol](https://github.com/artem-musii/replay-sol)
- Public YouTube demo, under three minutes: **[ADD YOUTUBE URL]**

## Inspiration and problem

After a minor collision, the record quickly fragments across photographs, approximate timing, vehicle damage, final positions, imperfect memory, and unresolved disagreement. Existing forms flatten those relationships into prose and a crude sketch. A chat can organize text, but it can also blur what a person reported, what a photograph supports, and what the model inferred.

REPLAY treats the incident as one inspectable spatial, temporal, and provenance-aware model. A person can see and correct the same geometry the agent reads. Uncertainty remains explicit instead of being forced into one confident story.

The focused audience is people documenting minor no-injury two-vehicle incidents and the support professionals who help them: claims intake staff, fleet managers, rental support teams, and neutral mediators.

## What REPLAY does

The deterministic demo opens a wet European roundabout at 17:42 with two generic vehicles, known damage, final positions, four clearly labeled synthetic evidence images, a reported initial statement, unresolved questions, and one deliberate trajectory/impact contradiction. It reaches no conclusion about fault.

The person and agent work in one professional incident notebook:

- a responsive semantic SVG scene with draggable and rotatable vehicles, editable trajectories, impact and damage markers, locking, zoom, pan, and keyboard controls;
- a synchronized timeline with playback, keyframes, events, drag editing, keyboard adjustment, and branch overlays;
- facts that distinguish human-confirmed, reported, likely, uncertain, disputed, unknown, and agent-hypothesis states;
- a local evidence tray with checksums, provenance links, safe upload validation, and synthetic-demo badges;
- ranked open questions and explicit alternative hypothesis branches;
- deterministic geometry, timing, provenance, and completeness checks;
- an attributable human/agent/system activity feed plus undo, redo, and safe agent-action reversion;
- preview-only coordinated agent scene proposals that only a human can adjust, accept, or reject; and
- a neutral, cited report preview, visible human acknowledgements, an immutable final snapshot, and local PDF/JSON/SVG/PNG export.

A blank-case wizard also creates an origin-local case without an account. The public GitHub Pages URL is a shared-origin synthetic demo, not a private incident vault.

## Why WebMCP is fundamental

REPLAY is not “read state, generate a paragraph.” The useful state is geometry, time, branch membership, certainty, evidence relationships, locks, case version, and recent human correction. Screen automation cannot reliably communicate those meanings, and an agent-only copy would drift away from what the person sees.

REPLAY uses the current proposed `document.modelContext.registerTool(...)` API to expose 19 narrow, lifecycle-aware imperative tools: 18 before report preview and 19 after the reviewed-report note tool joins. They let an agent read the relevant slice of live state, run deterministic validation, focus a named item, make a narrow trajectory/impact change, create a preview-only coordinated scene proposal, preserve a sourced observation, link evidence/annotations, create a question, fork and compare hypotheses, and prepare an evidence-bound report.

Tool registration follows meaningful workspace state: base, scene, and facts groups serve an open case; the hypothesis group joins once a baseline exists and includes report-preview construction; the reviewed-report group adds supported report notes only after a preview exists. Groups are added or removed with abortable lifecycle signals. Read operations carry `readOnlyHint`; every imperative tool carries `untrustedContentHint` because compact output can contain case-derived text or metadata. Inputs are validated at runtime, request IDs bind to semantic caller-intent fingerprints, and changed WebMCP mutations are reduced on an isolated engine copy, compare-and-swap saved, then committed/notified.

Most importantly, the human UI and WebMCP adapter use the same domain engine. The human UI commits live before its queued save; WebMCP stages and saves first, so a rejected primary save never appears live. Post-save cancellation/live conflict is compensated, with failed compensation returned and audited as `PERSISTENCE_FAILED`. Agent mutations appear on the same SVG/timeline/inspector and in durable attributed activity. Completed reads, visible UI-only calls, and rejections appear separately in a capped session invocation audit without changing the canonical case; cancellation before primary persistence records neither. Repeating the same completed request and semantic intent returns `idempotent: true` at its original receipt version without another save. A later human correction can carry an explicit override link and is discoverable through `get_recent_activity`, so the agent can revalidate instead of silently restoring its older geometry.

Consequential decisions are deliberately asymmetric. `propose_scene_changes` can write only a reversible preview; a person must adjust, accept, or reject it in the visible UI, and acceptance revalidates every baseline/lock before applying all changes. The agent can build and open a report preview. REPLAY also implements the standards/Chrome declarative `finalize_factual_report` form without automatic submission, but OpenAI's current Site Tools browser does not expose declarative HTML form tools as Site Tools. ChatGPT Work or Codex may still use ordinary browser capabilities, but those interactions are not WebMCP calls and must not operate the human-only confirmation controls. Only a person can confirm a claim or create the immutable report snapshot. Those permissions are enforced in the command layer, not just by disabled UI.

When WebMCP is unavailable, feature detection leaves the complete manual product working.

## What the human does

- Supplies or reviews statements and local evidence.
- Directly moves, rotates, edits, locks, confirms, disputes, or rejects case items.
- Decides which uncertainties remain open and whether alternatives are useful.
- Reviews every confirmed claim and report note.
- Manually finalizes and explicitly exports the factual report.

## What the agent does

- Reads compact structured state and recent activity through Site Tools.
- Runs deterministic checks and focuses a visible inconsistency.
- Builds visible provisional trajectories and impact geometry without deciding fault.
- Uses a coordinated proposal instead of directly applying a major multi-actor reconstruction; waits for the human decision.
- Responds to newer human corrections.
- Preserves alternative explanations as explicit branches and assumptions.
- Links existing evidence and prepares neutral, citation-bound report material.

The agent cannot confirm a fact, accept/reject/adjust a proposal, bypass a lock, auto-finalize, determine liability, delete evidence/the whole case, send evidence bytes externally, or treat evidence text as executable instruction. Tool-returned structured text and metadata can still be processed by the connected client/model service.

## How it was built

REPLAY was built from an empty workspace during the challenge period. It is a static React 19 and strict TypeScript application built with Vite. The schema-v2 canonical model and Zod schemas cover actors, trajectories, events, claims, evidence/annotation links, questions, branches, coordinated proposals/revisions/decisions, consistency issues, override-aware activity, report notes, workspace citations, and immutable report snapshots.

A command engine owns schema validation, author/origin authorization, reference checks, locks, optimistic case-version conflicts, request idempotency, undo/redo boundaries, agent-action reversion, activity attribution, and deterministic consistency recomputation. Pure interpolation drives the SVG scene and timeline. Report generation is a deterministic projection over eligible cited state, not a free-form model summary.

Dexie stores case JSON and evidence blobs in IndexedDB. The candidate uses a separate v2 vault with v1 migration, compare-and-swap writes, a best-effort Web Locks lease, BroadcastChannel conflict pause, retained raw recovery, and blob case/checksum/MIME/byte verification. Structured JSON import passes through schema/referential validation and deliberately clears or demotes unsigned trust attestations; it excludes evidence bytes and is not a full backup. jsPDF and `html-to-image` produce explicit local exports.

The WebMCP layer has separate schemas, fixed descriptions and annotations, an adapter into the domain engine, registration-group reconciliation, duplicate registration protection, execution instrumentation, cancellation handling, visible affected-item reveal, and a built-in inspector for browser support, lifecycle state, schemas, annotations, and supported direct execution.

Five original visuals were generated during development with the built-in image-generation mode: one landing hero and four synthetic demo evidence images. They were inspected for people, logos, readable plates, accidental text, watermarks, severe damage, vehicle-color mismatch, and implausible road markings. The running app performs no image generation.

## What was difficult before and during the build

The core design challenge was protecting meaning across two editors. A car path changed through Site Tools must be the same path a person can drag; a human correction must become newer structured history rather than a cosmetic movement; a branch assumption must never rewrite a shared confirmed observation.

The second challenge was making safety structural. “Do not confirm this” cannot depend on a prompt. Agent-origin confirmation and finalization are rejected by the domain command boundary. Locks, stale versions, idempotency, provenance, citation eligibility, and cancellation similarly return explicit results without partial mutation.

The third challenge was using a proposed browser API without sacrificing a real product. REPLAY registers against the current WebMCP draft through feature detection and retains a complete ordinary-browser workflow. Source/API decisions and compatibility limits are dated in the repository.

## Safety and privacy

REPLAY helps organize and visualize a factual account. It is not a forensic-certified reconstruction, a collision-physics calculator, legal advice, a truth assessment, or a determination of fault or liability. Reports preserve confirmed observations, sourced statements, evidence, disputes, unresolved questions, and hypotheses as different sections.

The core workflow is local-first and account-free. In manual mode, cases and uploaded evidence remain in origin-local IndexedDB until explicit export. In Site Tools mode, compact structured results can leave the browser for the connected client/model service, though REPLAY tools do not return uploaded image bytes. There is no REPLAY-operated backend, runtime model API, analytics call, geolocation request, or evidence-upload service. The GitHub Pages demo shares the `artem-musii.github.io` origin and local storage is not application-level encrypted, so use only synthetic/non-sensitive data there; sensitive evaluation requires a dedicated origin and appropriate controls.

Evidence notes, filenames, imported statements, and hypothesis text are untrusted case data. Tool descriptions and schemas are developer-owned; operations resolve allowlisted IDs and never execute case text.

## Testing and verification

The repository includes deterministic coverage for the original workflow plus schema-v2 migration/import, coordinated proposals and human decisions, persistence conflict/recovery and case/blob round-trip, packaged evidence-asset digest verification, staged real-adapter save/commit/compensation, semantic-intent idempotency, annotation links, override correlation, issue focus, dialog focus/Escape/restoration, exact scene editors, saved-demo reset, finalized JSON/PDF, and iframe/tool-registration blocking. Runtime corrupt-blob rejection is implemented but is not claimed as a directly exercised database test.

**Historical evidence:** `f980d28` recorded passing lint/typecheck/build, 53/53 Vitest tests, 32/32 desktop/mobile Playwright runs, four-state axe checks, Lighthouse, and a direct public Site Tools smoke. Those results predate the current candidate. The final clean gate, exact candidate counts, public deployment/assets/headers/Lighthouse, current 18/19-tool lifecycle, and browser/manual matrix are pending and must not be claimed as completed in the final submission until recorded.

The repository also includes eleven machine-readable WebMCP eval scenarios covering inspect, reconstruction, human correction, hypothesis branching, confirmation protection, locks, human-only reporting, prompt injection, stale versions, cancellation, and human-gated coordinated proposals. These are an eval specification, not model-run results. The historical public build has a 17/18-tool direct smoke; the current 18/19-tool candidate and supported-model matrix remain pending. Retain exact commit, URL, browser/client/model, tool traces, and every safety failure.

## Judging criteria

### WebMCP Leverage

WebMCP exposes the semantics ordinary screen automation lacks: branch-scoped trajectories, claim provenance and certainty, annotation links, locks, proposals, versions, consistency issues, and recent human corrections. Nineteen narrow tools, dynamic registration, annotations, staged persistence/compensation, semantic idempotency, session/durable audit, shared domain commands, proposal review, a separate standards/Chrome declarative human gate, and deterministic tests plus an unrun model-eval specification make the imperative Site Tools collaboration central without claiming OpenAI exposes the form as a Site Tool.

### Execution

REPLAY implements the full manual journey from landing and blank/demo start through scene/timeline editing, proposals, evidence, facts, questions, branches, activity, persistence/recovery, consistency, report review, finalization, and local export. It includes optimized original assets, fallback browser behavior, tests, public-facing documentation, and a public repository. The current candidate deployment, cross-client supported-model runs, manual matrices, and public video remain final submission gates; only the older baseline deployment is verified today.

### Potential Impact

The product addresses a concrete gap for minor-incident documentation: important spatial, temporal, evidentiary, and human-memory details are easily flattened or mixed. Local-first storage, explicit provenance, uncertainty, open questions, and a completeness-oriented report help people and support staff produce a more reviewable neutral record.

### Creativity and Ambition

REPLAY makes a spatial and temporal case model the collaboration surface rather than a chat transcript. Humans directly correct agent-authored geometry; agents detect those corrections from attributed activity; uncertainty becomes visual branches; and a citation-bound report retains the difference between fact and inference through a human-only decision boundary.

## Closing

**Humans provide memory and judgment. Agents organize complexity. REPLAY keeps the difference visible.**
