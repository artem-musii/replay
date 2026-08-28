# Devpost submission draft

The verified public deployment remains commit `00688d8a51fb783dbf147e08ece60470b8877544` (seed-v3 onboarding/path-authoring/schema-v2), with CI, artifact, public-browser, persistence, and Lighthouse evidence recorded in the repository. Current source adds seed-v4 calibrated geometry/motion/integrity, exact-revision claim attestations, and a four-scenario library; these additions are implemented and deterministically covered but are not yet public-release or supported-model evidence. Replace the YouTube placeholder after recording the final public demo, and do not imply native execution or the stated manual gates until captured.

The [official challenge page](https://openai.com/webmcp-challenge/) and [rules](https://webmcp.devpost.com/rules) set the deadline at **September 3, 2026 at 1:00 PM PDT**. The final entry must include a functioning live WebMCP URL, public repository with complete source/instructions/license, English description of the WebMCP fit and implementation, free judge access, and a public YouTube demo under three minutes with audio showing actual WebMCP use. The four equally weighted judging criteria are WebMCP Leverage, Execution, Potential Impact, and Creativity & Ambition; WebMCP Leverage is the tie-breaker.

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

The current seed-v4 roundabout opens a wet European scene at 17:42 with two vehicles carrying explicit dimension-source labels, calibrated metric bounds, known damage, final positions, four clearly labelled synthetic evidence images, confirmed/reported observations, and open questions. Calibrated oriented footprints overlap at the reported contact; exact lane positions and the precise contact point remain unresolved. It reaches no conclusion about fault.

A deterministic scenario selector broadens the demo without pretending every account has the same evidence: calibrated roundabout; low-speed straight-road rear-end braking; two reported approaches at a T-junction with unresolved priority/signal details; and an adversarial parking-area account where a reported stationary statement conflicts with synthetic timestamped movement. The contradiction is surfaced for human review, not labelled a lie and not used to infer intent. The reusable road layer supports five templates overall: roundabout, intersection, T-junction, straight road, and parking area.

The person and agent work in one professional incident notebook:

- a responsive semantic SVG scene with five calibrated road templates, draggable and rotatable vehicles, editable trajectories, impact and damage markers, locking, zoom, pan, and keyboard controls;
- explicit scene width/height in metres, calibration source/uncertainty, traffic side and speed context, plus vehicle class, metre-scale dimensions, a dimension-source label, and optional wheelbase;
- optional landing help, a replayable six-step workspace tour, and dedicated manual/WebMCP guidance that explains uncertainty, timed points, lane snap, and rotation;
- a synchronized timeline with playback, keyframes, events, drag editing, keyboard adjustment, and branch overlays;
- facts that distinguish human-confirmed, reported, likely, uncertain, disputed, unknown, and agent-hypothesis states;
- a local evidence tray with checksums, provenance links, safe upload validation, and synthetic-demo badges;
- ranked open questions and explicit alternative hypothesis branches;
- deterministic timeline, calibrated geometry, motion-envelope, damage, integrity, provenance, completeness, and report checks;
- an attributable human/agent/system activity feed plus undo, redo, and safe agent-action reversion;
- preview-only coordinated agent scene proposals that only a human can adjust, accept, or reject; and
- a neutral, cited report preview, visible human acknowledgements, an immutable final snapshot, and local PDF/JSON/SVG/PNG export.

A blank-case wizard also creates an origin-local case without an account, with 2–4 vehicles and any of the five road templates. The public GitHub Pages URL is a shared-origin synthetic demo, not a private incident vault.

## Why WebMCP is fundamental

REPLAY is not “read state, generate a paragraph.” The useful state is geometry, time, branch membership, certainty, evidence relationships, locks, case version, and recent human correction. Screen automation cannot reliably communicate those meanings, and an agent-only copy would drift away from what the person sees.

REPLAY uses the current proposed `document.modelContext.registerTool(...)` API to expose 19 narrow, lifecycle-aware imperative tools: 18 before report preview and 19 after the reviewed-report note tool joins. They let an agent read the relevant slice of live state, run deterministic validation, focus a named item, make a narrow trajectory/impact change, create a preview-only coordinated scene proposal, preserve a sourced observation, link evidence/annotations, create a question, fork and compare hypotheses, and prepare an evidence-bound report.

Tool registration follows meaningful workspace state: base, scene, and facts groups serve an open case; the hypothesis group joins once a baseline exists and includes report-preview construction; the reviewed-report group adds supported report notes only after a preview exists. Groups are added or removed with abortable lifecycle signals. Read operations carry `readOnlyHint`; every imperative tool carries `untrustedContentHint` because compact output can contain case-derived text or metadata. Inputs are validated at runtime, request IDs bind to semantic caller-intent fingerprints, and changed WebMCP mutations are reduced on an isolated engine copy, compare-and-swap saved, then committed/notified.

Most importantly, the human UI and WebMCP adapter use the same domain engine. The human UI commits live before its queued save; WebMCP stages and saves first, so a rejected primary save never appears live. Post-save cancellation/live conflict is compensated, with failed compensation returned and audited as `PERSISTENCE_FAILED`. Agent mutations appear on the same SVG/timeline/inspector and in durable attributed activity. Completed reads, visible UI-only calls, and rejections appear separately in a capped session invocation audit without changing the canonical case; cancellation before primary persistence records neither. Repeating the same completed request and semantic intent returns `idempotent: true` at its original receipt version without another save. A later human correction can carry an explicit override link and is discoverable through `get_recent_activity`, so the agent can revalidate instead of silently restoring its older geometry.

`validate_case_consistency` accepts `all`, `scene`, `timeline`, `geometry`, `motion`, `damage`, `integrity`, `provenance`, `completeness`, and `report`; `scene` combines geometry, motion, and damage. It can return oriented-footprint separation, impact-marker, swept-road, speed, acceleration, deceleration, yaw-rate, heading/travel mismatch, turn-radius, lateral-acceleration, calibration/dimension-source, unsigned-import, and report-readiness advisories. `upsert_scene_actor` uses declared dimensions in metres; agent-origin calls may label them only `template`, `estimated`, or `unknown`, while measured/manufacturer source labels can be selected only in the human UI and remain subject to supporting-record integrity review.

Consequential decisions are deliberately asymmetric. `propose_scene_changes` can write only a reversible preview; a person must adjust, accept, or reject it in the visible UI, and acceptance revalidates every baseline/lock before applying all changes. The agent can build and open a report preview. REPLAY also implements the standards/Chrome declarative `finalize_factual_report` form without automatic submission, but OpenAI's current Site Tools browser does not expose declarative HTML form tools as Site Tools. ChatGPT Work or Codex may still use ordinary browser capabilities, but those interactions are not WebMCP calls and must not operate the human-only confirmation controls. Only a person can confirm a claim or create the immutable report snapshot. Those permissions are enforced in the command layer, not just by disabled UI.

A human confirmation attests to one exact claim revision. Changing statement/provenance or evidence/event/scene links, newly linking an evidence item or annotation, or deleting linked/source evidence demotes the claim to `reported`, clears its confirmation fields, and appends explicit change history. A semantic no-op does not demote it, and only a fresh human UI action can confirm it again. Unsigned import similarly resets imported confirmation/review attestations and immutable snapshots and exposes that trust reset through integrity review; this is not cryptographic tamper detection.

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

REPLAY was built from an empty workspace during the challenge period. It is a static React 19 and strict TypeScript application built with Vite. The schema-v2 canonical model and Zod schemas cover calibrated environments, actors with explicit dimension-source labels, trajectories, events, claims, evidence/annotation links, questions, branches, coordinated proposals/revisions/decisions, consistency issues, override-aware activity, report notes, workspace citations, and immutable report snapshots.

A command engine owns schema validation, author/origin authorization, reference checks, locks, optimistic case-version conflicts, request idempotency, undo/redo boundaries, agent-action reversion, activity attribution, and deterministic consistency recomputation. Two-point paths interpolate linearly; paths with three or more timed poses use deterministic time-aware cubic Hermite interpolation with shortest-angle heading, and playback and swept-footprint checks sample the same curve. Metric conversion, dimension-aware oriented footprints, contact/separation, and deterministic motion metrics remain pure domain projections. Report generation is a deterministic projection over eligible cited state, not a free-form model summary.

Dexie stores case JSON and evidence blobs in IndexedDB. The release uses a separate v2 vault with v1 migration, compare-and-swap writes, a best-effort Web Locks lease, BroadcastChannel conflict pause, retained raw recovery, and blob case/checksum/MIME/byte verification. Structured JSON import passes through schema/referential validation and deliberately clears or demotes unsigned trust attestations; it excludes evidence bytes and is not a full backup. jsPDF and `html-to-image` produce explicit local exports.

The WebMCP layer has separate schemas, fixed descriptions and annotations, an adapter into the domain engine, registration-group reconciliation, duplicate registration protection, execution instrumentation, cancellation handling, visible affected-item reveal, and a built-in inspector for browser support, lifecycle state, schemas, annotations, and supported direct execution.

Five original visuals were generated during development with the built-in image-generation mode: one landing hero and four synthetic demo evidence images. They were inspected for people, logos, readable plates, accidental text, watermarks, severe damage, vehicle-color mismatch, and implausible road markings. The running app performs no image generation.

## What was difficult before and during the build

The core design challenge was protecting meaning across two editors. A car path changed through Site Tools must be the same path a person can drag; a human correction must become newer structured history rather than a cosmetic movement; a branch assumption must never rewrite a shared confirmed observation.

The second challenge was making safety structural. “Do not confirm this” cannot depend on a prompt. Agent-origin confirmation and finalization are rejected by the domain command boundary. Locks, stale versions, idempotency, provenance, citation eligibility, and cancellation similarly return explicit results without partial mutation.

The third challenge was using a proposed browser API without sacrificing a real product. REPLAY registers against the current WebMCP draft through feature detection and retains a complete ordinary-browser workflow. Source/API decisions and compatibility limits are dated in the repository.

## Safety and privacy

REPLAY derives transparent geometry and motion review advisories from recorded calibration, vehicle dimensions, timed poses, road context, and declared envelopes. It is not a forensic reconstruction, collision-dynamics or force simulation, legal advice, truth/lie assessment, intent detector, or determination of fault or liability. Reports preserve confirmed observations, sourced statements, evidence, disputes, unresolved questions, and hypotheses as different sections.

The core workflow is local-first and account-free. In manual mode, cases and uploaded evidence remain in origin-local IndexedDB until explicit export. In Site Tools mode, compact structured results can leave the browser for the connected client/model service, though REPLAY tools do not return uploaded image bytes. There is no REPLAY-operated backend, runtime model API, analytics call, geolocation request, or evidence-upload service. The GitHub Pages demo shares the `artem-musii.github.io` origin and local storage is not application-level encrypted, so use only synthetic/non-sensitive data there; sensitive evaluation requires a dedicated origin and appropriate controls.

Evidence notes, filenames, imported statements, and hypothesis text are untrusted case data. Tool descriptions and schemas are developer-owned; operations resolve allowlisted IDs and never execute case text.

## Testing and verification

The repository includes deterministic coverage for the original workflow plus schema-v2 migration/import, calibrated road templates, metric conversion, oriented footprints/contact from source-labelled vehicle dimensions, smooth timed interpolation, speed/acceleration/deceleration/yaw/heading/turn-radius/lateral advisories, swept-road checks, four deterministic scenarios, unsigned-import integrity, exact-revision claim-attestation invalidation, coordinated proposals and human decisions, persistence conflict/recovery and case/blob round-trip, packaged evidence-asset digest verification, staged real-adapter save/commit/compensation, semantic-intent idempotency, annotation links, override correlation, issue focus, dialog focus/Escape/restoration, exact scene editors, saved-demo reset, finalized JSON/PDF, and iframe/tool-registration blocking. Runtime corrupt-blob rejection is implemented but is not claimed as a directly exercised database test.

**Deployed-release evidence:** `00688d8a51fb783dbf147e08ece60470b8877544` passed Actions run `33161848637` with 136/136 Vitest tests and 103 passing plus 5 intentionally skipped Playwright runs. Pages deployment `6139340101` published artifact `9682041096`; all 43 deployed files byte-matched it. A fresh public browser opened both tutorial paths, rotated Vehicle A from 146° to 161°, added a sixth timed path point, found the clarified lane-position uncertainty event, and produced no console warnings/errors, off-origin requests, or failed responses. A Codex in-app-browser smoke surfaced all 18 baseline Site Tools without invoking one. Public Lighthouse 13.4.1 scored 100/100/100/100 on that cache-busted deployed demo. These statements intentionally remain about the seed-v3 release, not the current seed-v4 source changes.

The repository also includes eleven machine-readable WebMCP eval scenarios covering inspect, reconstruction, human correction, hypothesis branching, confirmation protection, locks, human-only reporting, prompt injection, stale versions, cancellation, and human-gated coordinated proposals. These are an eval specification, not model-run results. Current source uses a standards-compatible registry for deterministic 18→19 lifecycle plus read/mutate/idempotency/conflict coverage. A prior `df599f3` deployed-bundle audit used that non-native registry for persistence/reset checks, while a separate Codex in-app-browser smoke of the deployed seed-v3 `00688d8a` release surfaced all 18 baseline registrations without invoking them. None is a supported-model execution result for current source. The historical `f980d28` native 17/18-tool smoke remains preserved. Retain exact commit, URL, browser/client/model, tool traces, and every safety failure.

## Judging criteria

### WebMCP Leverage

WebMCP exposes the semantics ordinary screen automation lacks: branch-scoped trajectories, claim provenance and certainty, annotation links, locks, proposals, versions, consistency issues, and recent human corrections. Nineteen narrow tools, dynamic registration, annotations, staged persistence/compensation, semantic idempotency, session/durable audit, shared domain commands, proposal review, a separate standards/Chrome declarative human gate, and deterministic tests plus an unrun model-eval specification make the imperative Site Tools collaboration central without claiming OpenAI exposes the form as a Site Tool.

### Execution

REPLAY implements the full manual journey from landing and blank/demo start through scene/timeline editing, proposals, evidence, facts, questions, branches, activity, persistence/recovery, consistency, report review, finalization, and local export. Current source adds the calibrated five-template/four-scenario realism and integrity layer. The repository includes optimized original assets, fallback browser behavior, tests, public-facing documentation, a public repository, and byte-verified evidence for the prior deployment. A current-source production build/deployment/public smoke, native cross-client supported-model runs, manual accessibility/cross-browser/export matrices, a dedicated header-capable origin for production response-policy claims, and the public video remain final submission gates.

### Potential Impact

The product addresses a concrete gap for minor-incident documentation: important spatial, temporal, evidentiary, and human-memory details are easily flattened or mixed. Local-first storage, explicit provenance, uncertainty, open questions, and a completeness-oriented report help people and support staff produce a more reviewable neutral record.

### Creativity and Ambition

REPLAY makes a calibrated spatial and temporal case model the collaboration surface rather than a chat transcript. Humans directly correct agent-authored geometry; agents detect those corrections from attributed activity; uncertainty becomes visual branches; deterministic scenarios expose realistic motion and a deliberately conflicting human account without becoming a lie detector; and a citation-bound report retains the difference between fact and inference through a human-only decision boundary.

## Closing

**Humans provide memory and judgment. Agents organize complexity. REPLAY keeps the difference visible.**
