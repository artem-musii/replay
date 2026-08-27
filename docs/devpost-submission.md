# Devpost submission draft

The application and repository links below are verified. Replace the remaining YouTube placeholder after recording the final public demo; do not submit with that placeholder.

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
- an attributable human/agent/system activity feed plus undo, redo, and safe agent-action reversion; and
- a neutral, cited report preview, visible human acknowledgements, an immutable final snapshot, and local PDF/JSON/SVG/PNG export.

A blank-case wizard also creates a private local case without an account.

## Why WebMCP is fundamental

REPLAY is not “read state, generate a paragraph.” The useful state is geometry, time, branch membership, certainty, evidence relationships, locks, case version, and recent human correction. Screen automation cannot reliably communicate those meanings, and an agent-only copy would drift away from what the person sees.

REPLAY uses the current proposed `document.modelContext.registerTool(...)` API to expose 18 narrow, lifecycle-aware imperative tools. They let an agent read the relevant slice of live state, run deterministic validation, focus a named item, update a trajectory or provisional impact, preserve a sourced observation, link evidence, create a question, fork and compare hypotheses, and prepare an evidence-bound report.

Tool registration follows meaningful workspace state: base, scene, and facts groups serve an open case; the hypothesis group joins once a baseline exists and includes report-preview construction; the reviewed-report group adds supported report notes only after a preview exists. Groups are added or removed with abortable lifecycle signals. Read operations carry `readOnlyHint`; outputs containing user or evidence content carry `untrustedContentHint`. Inputs are validated at runtime, mutations use case versions and request IDs, and cancellation is checked before canonical command commit.

Most importantly, the human UI and WebMCP adapter call the same domain engine. Agent changes appear on the same SVG/timeline/inspector and in the same attributed activity feed. A later human correction is discoverable through `get_recent_activity`, so the agent can revalidate instead of silently restoring its older geometry.

Finalization is deliberately asymmetric. The agent can build a report preview and prepare the visible declarative `finalize_factual_report` form, but the form has no automatic submission. Only a person can review the acknowledgements, click through the confirmation dialog, confirm a claim, or create the immutable report snapshot. Those permissions are enforced in the command layer, not just by disabled UI.

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
- Responds to newer human corrections.
- Preserves alternative explanations as explicit branches and assumptions.
- Links existing evidence and prepares neutral, citation-bound report material.

The agent cannot confirm a fact, bypass a lock, auto-finalize, determine liability, delete the whole case, send evidence externally, or treat evidence text as executable instruction.

## How it was built

REPLAY was built from an empty workspace during the challenge period. It is a static React 19 and strict TypeScript application built with Vite. The canonical domain model and Zod schemas cover actors, trajectories, events, claims, evidence, questions, branches, consistency issues, activity, report notes, and immutable report snapshots.

A command engine owns schema validation, author/origin authorization, reference checks, locks, optimistic case-version conflicts, request idempotency, undo/redo boundaries, agent-action reversion, activity attribution, and deterministic consistency recomputation. Pure interpolation drives the SVG scene and timeline. Report generation is a deterministic projection over eligible cited state, not a free-form model summary.

Dexie stores case JSON and evidence blobs in IndexedDB. Uploaded evidence is MIME-, size-, decode-, duplicate-, and checksum-validated. JSON import passes through schema and referential validation. jsPDF and `html-to-image` produce local exports.

The WebMCP layer has separate schemas, fixed descriptions and annotations, an adapter into the domain engine, registration-group reconciliation, duplicate registration protection, execution instrumentation, cancellation handling, visible affected-item reveal, and a built-in inspector for browser support, lifecycle state, schemas, annotations, and supported direct execution.

Five original visuals were generated during development with the built-in image-generation mode: one landing hero and four synthetic demo evidence images. They were inspected for people, logos, readable plates, accidental text, watermarks, severe damage, vehicle-color mismatch, and implausible road markings. The running app performs no image generation.

## What was difficult before and during the build

The core design challenge was protecting meaning across two editors. A car path changed through Site Tools must be the same path a person can drag; a human correction must become newer structured history rather than a cosmetic movement; a branch assumption must never rewrite a shared confirmed observation.

The second challenge was making safety structural. “Do not confirm this” cannot depend on a prompt. Agent-origin confirmation and finalization are rejected by the domain command boundary. Locks, stale versions, idempotency, provenance, citation eligibility, and cancellation similarly return explicit results without partial mutation.

The third challenge was using a proposed browser API without sacrificing a real product. REPLAY registers against the current WebMCP draft through feature detection and retains a complete ordinary-browser workflow. Source/API decisions and compatibility limits are dated in the repository.

## Safety and privacy

REPLAY helps organize and visualize a factual account. It is not a forensic-certified reconstruction, a collision-physics calculator, legal advice, a truth assessment, or a determination of fault or liability. Reports preserve confirmed observations, sourced statements, evidence, disputes, unresolved questions, and hypotheses as different sections.

The core workflow is local-first and account-free. Cases and uploaded evidence remain in that browser’s IndexedDB unless the person explicitly exports a file. There is no runtime model call, analytics call, geolocation request, or external evidence upload. Local storage is not application-level encrypted, so the prototype is not positioned as a production repository for highly sensitive records.

Evidence notes, filenames, imported statements, and hypothesis text are untrusted case data. Tool descriptions and schemas are developer-owned; operations resolve allowlisted IDs and never execute case text.

## Testing and verification

The repository includes deterministic Vitest coverage for schemas and seed validity, domain commands, versioning, idempotency, locks, human-only confirmation/finalization, undo/redo, report filtering, import/export references, interpolation, consistency rules, timeline behavior, and WebMCP registration/lifecycle. At the 2026-08-27 documentation snapshot, lint and strict typecheck passed, Vitest passed 53/53 tests across six files, Playwright passed 32/32 runs across desktop and mobile Chromium, and the production build passed. The Playwright run includes manual-browser fallback, a WebMCP polyfill mutation, persistence, blank-case authoring and lock controls, evidence annotations, the main product journey, screenshots, and axe checks of four principal UI states with no serious or critical violations.

The repository also includes ten machine-readable WebMCP eval scenarios covering inspect, reconstruction, human correction, hypothesis branching, confirmation protection, locks, human-only reporting, prompt injection, stale versions, and cancellation. These are an eval specification, not fabricated model-run results. The public deployment has a direct Site Tools smoke record: 17 baseline tools, read/mutate/revert behavior, an 18-tool reviewed-report lifecycle, a non-autosubmitting finalization form, and persisted blank-case reload. Capture the supported-model prompt/eval matrix before final Devpost submission and retain the exact commit and client versions.

## Judging criteria

### WebMCP Leverage

WebMCP exposes the semantics ordinary screen automation lacks: branch-scoped trajectories, claim provenance and certainty, evidence links, locks, versions, consistency issues, and recent human corrections. Eighteen narrow tools, dynamic registration groups, annotations, cancellation, visible activity, shared domain commands, a declarative human-gated final review, and deterministic plus model eval coverage make Site Tools central to the collaboration.

### Execution

REPLAY implements the full manual journey from landing and blank/demo start through scene/timeline editing, evidence, facts, questions, branches, activity, persistence, consistency, report review, finalization, and local export. It includes optimized original assets, fallback browser behavior, tests, public-facing documentation, a public GitHub repository, and a verified GitHub Pages deployment. Cross-client supported-model runs and the public video remain final submission gates.

### Potential Impact

The product addresses a concrete gap for minor-incident documentation: important spatial, temporal, evidentiary, and human-memory details are easily flattened or mixed. Local-first storage, explicit provenance, uncertainty, open questions, and a completeness-oriented report help people and support staff produce a more reviewable neutral record.

### Creativity and Ambition

REPLAY makes a spatial and temporal case model the collaboration surface rather than a chat transcript. Humans directly correct agent-authored geometry; agents detect those corrections from attributed activity; uncertainty becomes visual branches; and a citation-bound report retains the difference between fact and inference through a human-only decision boundary.

## Closing

**Humans provide memory and judgment. Agents organize complexity. REPLAY keeps the difference visible.**
