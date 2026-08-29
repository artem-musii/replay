# Devpost submission draft

## Project title

**REPLAY**

## One-line description

REPLAY uses WebMCP to let people and agents reconstruct road incidents together without turning uncertainty or inference into fact.

## Paste-ready submission description

**Problem and impact.**

After a minor no-injury collision, a driver and claims-intake reviewer need to turn photographs, damage, final positions, timing, and conflicting memories into a record they can inspect. Forms flatten those relationships into prose, while chat can quietly make an assumption sound settled. REPLAY keeps them in one local-first visual case and produces a cited, human-reviewed report with unanswered questions intact.

REPLAY makes uncertainty a first-class spatial object instead of flattening competing accounts into one AI-written narrative.

**Why WebMCP, and what becomes possible.**

A screenshot can show two vehicles, but it cannot reliably tell an agent which timed point belongs to which branch, whether a statement is photo-backed or disputed, whether a path is locked, or which case version is current. WebMCP exposes those exact live semantics and validated actions. The agent can run REPLAY's deterministic checks, focus an issue in the interface, create a reversible proposal for 1–10 distinct actors, preserve an inference as an inference, and prepare a cited report from the same domain command layer as the UI—never an agent-only shadow copy.

REPLAY feature-detects `document.modelContext`, registers through `modelContext.registerTool(...)` with fixed Zod-derived JSON schemas, and maintains a lifecycle-aware 18→19 tool inventory; every durable write is routed through the same `ReplayEngine` domain commands used by the visible interface.

**Better human-agent experience.**

**Agent: read, validate, propose, draft. Reviewer: attest, decide, finalize.** An agent proposal is a visible preview, not a silent geometry change. For a complete reconstruction path, its first timed pose is the start, its last is the final position, and intermediate poses can place the vehicle at described contact or maneuvers. Geometry alone does not create a semantic impact event; that remains a separate provisional timeline action. For a bounded refinement, an interior-keyframe patch preserves both endpoints. The UI lets a reviewer compare, adjust, accept, or reject either mode; a later UI correction becomes newer attributed history that the agent can reread. The agent may report a completeness gap, but no Site Tool can attest to the reviewed no-evidence, damage, or uncertainty state, confirm a claim, or finalize the report. Those commands require the visible UI review origin.

**Execution and boundaries.**

The result is useful before everyone agrees: REPLAY preserves what is observed, reported, disputed, inferred, and still unanswered, while allowing a legitimate no-evidence case to reach a visibly reviewed report without inventing content. Four deterministic synthetic scenarios make the workflow repeatable without using real incident data. REPLAY organizes an account and produces a cited structured PDF, a separate scene export, and a portable structured case transfer whose evidence bytes remain local; it does not decide collision physics, truth, fault, or liability.

## Links

- Live app: [https://artem-musii.github.io/replay/](https://artem-musii.github.io/replay/)
- Deterministic demo: [https://artem-musii.github.io/replay/#demo](https://artem-musii.github.io/replay/#demo)
- Public repository: [https://github.com/artem-musii/replay](https://github.com/artem-musii/replay)
- Open-source license: [MIT](https://github.com/artem-musii/replay/blob/main/LICENSE)
- Build and testing instructions: [README](https://github.com/artem-musii/replay#local-setup)
- Public YouTube demo, under three minutes: **BLOCKED — replace this line with the final public YouTube URL.**

## Paste-ready Devpost media and tags

- Built with: `WebMCP`, `React`, `TypeScript`, `Vite`, `Zod`, `Dexie`, `IndexedDB`, `SVG`, `Playwright`, `Vitest`, `jsPDF`
- Thumbnail: `docs/images/replay-devpost-thumbnail.jpg`—a real 1280 × 720 capture of the current deployed release payload, under 5 MB.
- Gallery lead: the same real workspace capture, followed by the high-speed scenario and native **Recently used/Sources** stills captured from the exact final deployment.
- Keep every gallery image tied to the final release; do not substitute the generated hero for native WebMCP proof.

Do not submit while the video line above is blocked. The final live URL, video, repository, testing instructions, commit, and screenshots must all describe the same deployed release.

## Paste-ready testing instructions

REPLAY itself requires no account or credentials. Open the deterministic demo in ChatGPT's built-in browser, start a fresh Roundabout run, and wait for the header to show **Site Tools · 18 registered**. Then ask:

> Use this page's Site Tools to review the unresolved lane-position question. Read the live scene, evidence relationships, and full consistency results; focus the blocker; then create the smallest coordinated two-car alternative for review from the existing timed paths. Keep the baseline, claims, endpoints, point IDs, times, and unrelated geometry unchanged. Explain the missing evidence, your assumptions, the before/after versions, and what remains unresolved. Do not apply anything, confirm or answer claims, or infer fault.

The read, validation, and focus calls should report no case change. One attributed proposal should appear with two path targets, explicit assumptions, preserved endpoints/IDs/times, and an unchanged live baseline. The agent receives structured evidence metadata and links, not image bytes. Site Tools expose no accept/reject action; use the visible proposal card to make that decision as the human reviewer. For a strictly repeatable fallback, copy the exact-coordinate prompt from REPLAY's Site Tools guide and start a fresh demo run. **Manual mode** means the current browser session did not expose Site Tools; the complete non-agent workflow remains available, but native WebMCP testing requires a supported client.

## Internal release gate — do not paste into Devpost

The verified public deployment is application commit `b2e93905ff349a29f21b0b544a59e3afc738671d`, the complete seed-v6 release containing calibrated geometry/motion/integrity review, physically coherent authored contact geometry, impact/playback polish, four deterministic scenarios, explicit review-only start-to-final WebMCP reconstruction, and the trust, persistence, accessibility, reporting, and release-verification work described below. Its clean CI, Pages artifact, automated post-deploy gate, and independent public-byte comparison are recorded below. No supported-model **Recently used/Sources** result is claimed. Replace the YouTube placeholder after recording the final public demo, and do not imply completion of any uncaptured manual gate.

REPLAY was created during the Challenge window. Its first repository commit, `c95df75`, is dated August 27, 2026, after submissions opened on August 25; the dated history records the product and WebMCP implementation from its initial build onward.

The [official challenge page](https://openai.com/webmcp-challenge/) and [rules](https://webmcp.devpost.com/rules) set the deadline at **September 3, 2026 at 1:00 PM PDT**. The final entry must include a functioning live WebMCP URL, public repository with complete source/instructions/license, English description of the WebMCP fit and implementation, free judge access, and a public YouTube demo under three minutes with audio showing actual WebMCP use. The four equally weighted judging criteria are WebMCP Leverage, Execution, Potential Impact, and Creativity & Ambition; WebMCP Leverage is the tie-breaker.

The sections below are supporting source material for individual Devpost fields and repository evidence. Do not paste the entire technical appendix into the public project story.

## Inspiration and problem

After a minor collision, the record quickly fragments across photographs, approximate timing, vehicle damage, final positions, imperfect memory, and unresolved disagreement. Existing forms flatten those relationships into prose and a crude sketch. A chat can organize text, but it can also blur what a person reported, what a photograph supports, and what the model inferred.

REPLAY treats the incident as one inspectable spatial, temporal, and provenance-aware model. A person can see and correct the same geometry the agent reads. Uncertainty remains explicit instead of being forced into one confident story.

The primary audience is a driver documenting a minor no-injury incident and the claims-intake reviewer turning that account into a reviewable record—especially for common two-vehicle cases, with bounded 2–4 vehicle authoring. Fleet, rental-support, and neutral-mediation teams are adjacent users of the same workflow.

## What REPLAY does

The current seed-v6 roundabout opens a wet European scene at 17:42 with two vehicles carrying explicit dimension-source labels, calibrated metric bounds, known damage, final positions, four clearly labelled synthetic evidence images, confirmed/reported observations, and open questions. Calibrated oriented footprints meet at the reported contact, then the authored paths visibly slow and diverge. The interface labels those post-contact points as illustrative authoring—not collision-simulation output or causation—and exact lane positions and the precise contact point remain unresolved. It reaches no conclusion about fault.

A deterministic scenario selector broadens the demo without pretending every account has the same evidence. The high-speed straight-road case derives a 65–80 km/h approach from authored path timing, labels it as unmeasured, and asks what telemetry or roadway evidence could support it. The parking-area case contrasts a reported stationary account with positions 3.5 metres apart one second apart—an authored 12.6 km/h leg. The same consistency command therefore distinguishes a missing-measurement question from a low-speed record conflict without treating either as truth, intent, or fault. The calibrated roundabout and road-speed T-junction complete the four-case set; the reusable road layer supports roundabout, intersection, T-junction, straight road, and parking area.

The practical loop is deliberately short: open a synthetic case, let the agent inspect and validate the live structured record, review its provisional geometry and attributed hypothesis, make the consequential decisions as a person, then export a citation-bound factual report. REPLAY is useful before anyone agrees on one story because it preserves the disagreement and the missing information instead of resolving them by tone.

The person and agent work in one professional incident notebook:

- a responsive semantic SVG scene with five calibrated road templates, draggable and rotatable vehicles, editable trajectories, impact and damage markers, locking, zoom, pan, and keyboard controls;
- explicit scene width/height in metres, calibration source/uncertainty, traffic side and speed context, plus vehicle class, metre-scale dimensions, a dimension-source label, and optional wheelbase;
- optional landing help, a replayable six-step workspace tour, and dedicated manual/WebMCP guidance that explains uncertainty, timed points, lane snap, and rotation;
- a synchronized timeline with playback, keyframes, events, drag editing, keyboard adjustment, and branch overlays;
- exact impact placement by selected actor pair in three- and four-vehicle cases, preserving contacts already recorded for other pairs;
- facts that distinguish human-confirmed, reported, likely, uncertain, disputed, unknown, and agent-hypothesis states;
- a local evidence tray with checksums, provenance links, safe upload validation, and synthetic-demo badges;
- ranked open questions and explicit alternative hypothesis branches; observation/question relationship chips open their supporting evidence, scene, event, and branch context;
- deterministic timeline, calibrated geometry, motion-envelope, damage, integrity, provenance, completeness, and report checks;
- a human-only completeness review for no evidence supplied, damage unknown/not assessed per actor, and completed uncertainty review;
- an attributable human/agent/system activity feed plus undo, redo, and safe agent-action reversion;
- preview-only agent scene proposals for 1–10 distinct actors, including complete start-to-final paths and endpoint-preserving interior patches, that Site Tools cannot adjust, accept, or reject; and
- a neutral, cited report preview, visible human acknowledgements, an immutable final snapshot, and local PDF/JSON/SVG/PNG export.

A blank-case wizard also creates an origin-local case without an account, with 2–4 vehicles and any of the five road templates. The public GitHub Pages URL is a shared-origin synthetic demo, not a private incident vault.

Every fresh demo or blank case receives a stable `#case/<encoded-case-id>` route. The landing page lists retained runs under **Your local cases**, making judge/demo recovery practical without silently replacing one case with another.

## Why WebMCP is fundamental

REPLAY is not “read state, generate a paragraph.” The useful state is geometry, time, branch membership, certainty, evidence relationships, locks, case version, and recent human correction. Pixels or copied prose cannot reliably communicate those meanings, and an agent-only copy would drift away from what the person sees.

WebMCP is therefore the product contract, not an integration badge. It gives the agent typed access to the exact live objects a person is reviewing, lets it invoke REPLAY's deterministic checks and validated commands, and makes every durable mutation appear in the same scene, timeline, inspector, and activity history. The judge-visible loop is **read → validate → propose → human decision → report preview → human finalization**.

REPLAY uses the current proposed `document.modelContext.registerTool(...)` API to expose 19 narrow, lifecycle-aware imperative tools: 18 before report preview and 19 after the reviewed-report note tool joins. They let an agent read the relevant slice of live state, run deterministic validation, focus a named item, make a narrow trajectory/impact change, create a preview-only coordinated scene proposal, preserve a sourced observation or damage marker, link evidence/annotations, create a question, fork and compare hypotheses, and prepare an evidence-bound report.

Every workspace-state read includes root coordinate-system metadata and returns spatial geometry as normalized `0..1` x/y values that can be reused directly in tool inputs. For the judge path, one coordinated proposal carries one `trajectory-keyframe-patch` per vehicle. Each patch changes only 1–8 identified interior keyframes; the adapter preserves every endpoint, keyframe ID, and time, expands the patch through the canonical full-trajectory command shape, and leaves the live paths untouched until a person decides in the UI.

An agent cannot manufacture provenance merely by choosing a source label. External categories such as human statement, witness statement, photo, or document require a compatible canonical source; damage requires at least one active evidence or observation source. Otherwise the shared command layer rejects the write and directs the agent to use `agent-inference` where appropriate. Open questions can relate to observations, actors, trajectories, events, damage markers, or hypotheses, but not directly to evidence; the supported observation or scene item carries that context. Human-readable relationship chips make those links inspectable in the same workspace. Context links remain links rather than being laundered into source IDs, and legacy violations surface as explicit provenance errors.

Tool registration follows meaningful workspace state: base, scene, and facts groups serve an open case; the hypothesis group joins once a baseline exists and includes report-preview construction; the reviewed-report group adds supported report notes only after a preview exists. Groups are added or removed with abortable lifecycle signals. Read operations carry `readOnlyHint`; every imperative tool carries `untrustedContentHint` because compact output can contain case-derived text or metadata. Inputs are validated at runtime, request IDs bind to semantic caller-intent fingerprints, and changed WebMCP mutations are reduced on an isolated engine copy, compare-and-swap saved, then committed/notified.

Most importantly, the human UI and WebMCP adapter use the same domain engine. The human UI commits live before its queued save; WebMCP stages and saves first, so a rejected primary save never appears live. Post-save cancellation/live conflict is compensated, with failed compensation returned and audited as `PERSISTENCE_FAILED`. Agent mutations appear on the same SVG/timeline/inspector and in durable attributed activity. Completed reads, visible UI-only calls, and rejections appear separately in a capped session invocation audit without changing the canonical case; cancellation before primary persistence records neither. Repeating the same completed request and semantic intent returns `idempotent: true` at its original receipt version without another save. A later human correction can carry an explicit override link and is discoverable through `get_recent_activity`, so the agent can revalidate instead of silently restoring its older geometry.

`validate_case_consistency` accepts `all`, `scene`, `timeline`, `geometry`, `motion`, `damage`, `integrity`, `provenance`, `completeness`, and `report`; `scene` combines geometry, motion, and damage. It can return oriented-footprint separation, impact-marker, swept-road, speed, acceleration, deceleration, yaw-rate, heading/travel mismatch, turn-radius, lateral-acceleration, calibration/dimension-source, unsigned-import, and report-readiness advisories. `upsert_scene_actor` requires the complete label/pose/specification when creating an actor, but an existing `actorId` can be updated with only the fields that should change; omitted trusted specifications are preserved and an unknown ID fails. Agent-origin calls may label dimensions only `template`, `estimated`, or `unknown`, while measured/manufacturer source labels can be selected only in the human UI and remain subject to supporting-record integrity review.

Consequential decisions are deliberately asymmetric. `propose_scene_changes` can write only a reversible preview; even its narrow keyframe patches become canonical proposal changes rather than live geometry. The visible UI review flow must adjust, accept, or reject the proposal, and acceptance revalidates every baseline/lock before applying all changes. The agent can build and open a report preview or report missing readiness requirements, but no Site Tool can create/withdraw a completeness attestation. REPLAY also implements the standards/Chrome declarative `finalize_factual_report` form without automatic submission, but OpenAI's current Site Tools browser does not expose declarative HTML form tools as Site Tools. Ordinary browser interaction is outside WebMCP and is not represented as a Site Tool authorization. No Site Tool can record reviewed completeness, confirm a claim, or create the immutable report snapshot; those actor/origin permissions are enforced in the command layer, not just by disabled UI.

A human confirmation attests to one exact claim revision. Changing statement/provenance or evidence/event/scene links, newly linking an evidence item or annotation, or deleting linked/source evidence demotes the claim to `reported`, clears its confirmation fields, and appends explicit change history. A semantic no-op does not demote it, and only a fresh human UI action can confirm it again. Unsigned import similarly resets imported confirmation/review attestations and immutable snapshots and exposes that trust reset through integrity review; this is not cryptographic tamper detection.

Completeness attestations are separate auditable records, fingerprinted to the exact relevant evidence index, actor-damage state, or question register. A relevant edit makes an old record stale; unsigned import preserves it only as untrusted history; and agent undo cannot restore its authority. Reports label current records **Human attestation**, cite their canonical paths, and state that they do not prove evidence or damage absence or make unknown information certain.

When WebMCP is unavailable, feature detection leaves the complete manual product working.

## What the human does

- Supplies or reviews statements and local evidence.
- Directly moves, rotates, edits, locks, confirms, disputes, or rejects case items.
- Decides which uncertainties remain open and whether alternatives are useful.
- Records reviewed completeness only when no evidence was supplied, an actor's damage is unknown/not assessed, or the uncertainty register is complete.
- Reviews every confirmed claim and report note.
- Manually finalizes and explicitly exports the factual report.

## What the agent does

- Reads compact structured state and recent activity through Site Tools.
- Runs deterministic checks and focuses a visible inconsistency.
- Reports completeness gaps but does not attest that a human review occurred.
- Builds visible provisional trajectories and impact geometry without deciding fault.
- Uses a coordinated proposal instead of directly applying a major multi-actor reconstruction; waits for the human decision.
- Responds to newer human corrections.
- Preserves alternative explanations as explicit branches and assumptions.
- Links existing evidence and prepares neutral, citation-bound report material.

The agent cannot confirm a fact, create/withdraw a completeness attestation, accept/reject/adjust a proposal, bypass a lock, auto-finalize, determine liability, delete evidence/the whole case, send evidence bytes externally, or treat evidence text as executable instruction. Tool-returned structured text and metadata can still be processed by the connected client/model service.

## How it was built

REPLAY was built from an empty workspace during the challenge period. It is a static React 19 and strict TypeScript application built with Vite. The schema-v2 canonical model and Zod schemas cover calibrated environments, actors with explicit dimension-source labels, trajectories, events, claims, evidence/annotation links, questions, branches, coordinated proposals/revisions/decisions, consistency issues, override-aware activity, state-bound completeness attestations, report notes, workspace citations including `attested` report statements, and immutable report snapshots.

A command engine owns schema validation, author/origin authorization, reference checks, locks, optimistic case-version conflicts, request idempotency, undo/redo boundaries, agent-action reversion, activity attribution, and deterministic consistency recomputation. Two-point paths interpolate linearly; paths with three or more timed poses use deterministic time-aware cubic Hermite interpolation with shortest-angle heading, and playback and swept-footprint checks sample the same curve. Metric conversion, dimension-aware oriented footprints, contact/separation, and deterministic motion metrics remain pure domain projections. Report generation is a deterministic projection over eligible cited state, not a free-form model summary.

Dexie stores case JSON and evidence blobs in IndexedDB. The release uses a separate v2 vault with v1 migration, compare-and-swap writes, a best-effort Web Locks lease, BroadcastChannel conflict pause, retained raw recovery, and blob case/checksum/MIME/byte verification. Structured JSON import passes through schema/referential validation, then presents a cancel-first review of unavailable evidence bytes and every unsigned trust reset before opening a re-keyed copy; it excludes evidence bytes and is not a full backup. Explicit local scene exports use the application-generated SVG and a browser Canvas rasterization path with portable sRGB colors; jsPDF creates the factual report.

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

The repository includes deterministic coverage for the original workflow plus schema-v2 migration/import, cancel-first trust-reset review, calibrated road templates, metric conversion, oriented footprints/contact from source-labelled vehicle dimensions, smooth timed interpolation, speed/acceleration/deceleration/yaw/heading/turn-radius/lateral advisories, swept-road checks, four deterministic scenarios, unsigned-import integrity, exact-revision claim-attestation invalidation, source-enforced photo/document observations, human-only evidence unlinking without asset deletion, state-bound human completeness attestations and legitimate no-evidence finalization, coordinated proposals and human decisions, persistence conflict/recovery and case/blob round-trip, packaged evidence-asset digest verification, runtime evidence-blob checksum and metadata rejection, staged real-adapter save/commit/compensation, semantic-intent idempotency, annotation links, override correlation, issue focus, dialog focus/Escape/restoration, exact scene editors, stable local-case routes/listing, unique-run demo switching/resume, exact multi-vehicle impact-pair placement, impact playback, finalized JSON/PDF, and iframe/tool-registration blocking.

**Deployed application-payload evidence:** payload-origin commit `b2e93905ff349a29f21b0b544a59e3afc738671d` passed Actions run `33272807674`, including verify/build job `99154232692`, deploy job `99155253861`, and post-deploy byte-verification job `99155282304`, with 460/460 Vitest tests across 37 files, 230 Playwright project runs (221 passed, 9 intentional mobile screenshot-owner skips, 0 failed), and a 12/12 configured-base matrix. Pages deployment `6159696063` published artifact `9720702224` (3,655,213 compressed bytes; SHA-256 `17357bb96e0ac622b190377e81a415df47704c9b7a42dc78763b1aa0293b7fbe`). Retained release-evidence artifact `9720702014` has SHA-256 `08190cf5f735812766331a5fd4c7110e919515c9a7756962f23991d5a65640ab`. The live `release-evidence.json` identifies the latest clean wrapper commit and attests the same 46 public payload files / 5,297,260 bytes with manifest SHA-256 `586c81a32c8b0d15deed08ecd99ebd069697a2158aa0ca047d87cdd0f0e6bb87`; hosted CI and an independent verifier fetched every file and matched every byte.

**Superseded public-browser evidence:** the preceding seed-v6 `cd88755b` operator bridge/product and Lighthouse checks remain historical to those exact bytes. The earlier seed-v3 commit `00688d8a51fb783dbf147e08ece60470b8877544` retains its public guide/scene-editing/recovery smoke, native discovery of 18 baseline tools without invocation, and cache-busted Lighthouse 13.4.1 score of 100/100/100/100. None is attributed to the current release or any supported-model run. The seed-v5 `2855f0bc` deployment evidence is likewise historical.

**Current-release evidence:** the release passed 460/460 Vitest tests across 37 files on Node 22.13.0 and 230 Playwright project runs with 221 passed, 9 intentional mobile screenshot-owner skips, and 0 failed, plus 20 checked visual baselines. The browser split was 114/114 desktop Chromium, 105 passed plus 9 skipped in mobile Chrome, and 1/1 release smoke in both Firefox and WebKit. Hosted V8 coverage was 63.78% statements (6,781/10,631), 54.28% branches (4,500/8,289), 62.04% functions (1,628/2,624), and 65.85% lines (6,276/9,530). In a separate post-fix local stress run, the final playback guard passed 50/50 repeated exact-impact resume checks across desktop/mobile and 20/20 mixed critical journeys without a flake. Formatting, zero-warning lint, strict typecheck, both dependency audits with 0 vulnerabilities, dependency-tree resolution, root and `/replay/` production builds on the declared runtime, and `git diff --check` passed.

The Node 22.13.0 root artifact contains 46 public payload files / 5,296,864 bytes, plus the deployment-control `.nojekyll`, with manifest SHA-256 `1928042d80975e5f2680e2a87504b9a231a80264ea6d1ff648cabb5c5e166df3`. The `/replay/` artifact contains 46 public payload files / 5,297,260 bytes, plus `.nojekyll`, with manifest SHA-256 `586c81a32c8b0d15deed08ecd99ebd069697a2158aa0ca047d87cdd0f0e6bb87`. That exact already-built configured-base artifact passed 12/12 focused runs: release/high-speed/impact 8/8, handler contract 2/2, and submission story 2/2 on desktop and mobile. The deterministic handler used the E2E imperative `document.modelContext` polyfill, registered 18 lifecycle-eligible tools without churn, and returned all eight requested workspace sections, including `selection: null`, in a complete 18,970-byte case-v1 response, below the 32,768-byte compact target and 524,288-byte hard cap. Registry/adapter coverage proves that a one-actor complete start-to-final proposal remains preview-only until human acceptance; the submission story proves the 18→19→18 lifecycle, canonical-geometry-safe proposal/rejection, impact response, provenance-safe agent inference, human confirmation/finalization, and PDF export.

The preceding `cd88755b` configured-base payload passed an operator-directed native in-app-browser Site Tools trace. `get_case_summary`, `get_workspace_state` for scene/questions, all-scope validation, and focus for `question-lane-change` all returned `ok: true` at v1. Validation returned the single `integrity.calibration-source` question; focus visibly opened it; REPLAY showed one durable seed change plus four session-only calls labelled **No case change · observed v1**; and browser runtime logs had no warning or error. This remains historical native bridge and UI/session-audit evidence for those exact bytes, not current-release or supported-model choice, **Recently used/Sources**, mutation/lifecycle, or broad cross-client behavior.

Lighthouse 13.4.1 with Chrome 151 completed three warning-free runs per profile against the preceding `cd88755b` configured-base payload. The mobile runs scored 89/91/90 performance, all with 100 accessibility / 100 best practices / 100 SEO, for median performance 90 and medians of FCP 2.032 s, LCP 3.308 s, TBT 17 ms, CLS 0.00004, Speed Index 2.032 s, and TTI 3.308 s; every desktop run scored 100/100/100/100, with medians of FCP 0.445 s, LCP 0.686 s, TBT 0 ms, CLS 0.0149, Speed Index 0.529 s, and TTI 0.686 s. Browser/Poppler review for that payload verified the authored impact response, one-click resume after the impact pause, arbitrary scene-bound interactions, responsive reflow, portable scene colors, and the clean four-page PDF. Those measurements remain historical; the current release retains automated impact, layout, and export regressions.

**Earlier native browser evidence:** the operator-directed Chrome `ModelContext` trace belongs to the pre-polish 45-payload `/replay/` artifact at 5,229,846 bytes with manifest SHA-256 `356be07e17a995608cfd558c685ba1fc9bf582b2f2fd530a9644604a8f2bd6ee`. It remains historical main-world constructor and mutation/human-gate evidence for that earlier artifact. The later `cd88755b` bridge trace above did not inspect the constructor or exercise a mutation; neither trace is formal supported-model choice on the live deployment, **Recently used/Sources**, or video evidence.

The repository also includes twelve machine-readable WebMCP eval scenarios covering inspect, reconstruction, human correction, hypothesis branching, positive branch-scoped agent inference, confirmation protection, locks, human-only reporting, prompt injection, stale versions, cancellation, and human-gated coordinated proposals. Eleven are supported-model behavioral journeys; the precise cancellation hook is deterministic-only. These are an eval specification, not model-run results. Current source uses a standards-compatible registry for deterministic 18→19 and report-note 18→19→18→19 lifecycle coverage plus read/mutate/idempotency/conflict checks. A prior `df599f3` deployed-bundle audit used that non-native registry for persistence/reset checks, while a separate Codex in-app-browser smoke of the now-superseded seed-v3 `00688d8a` release surfaced all 18 baseline registrations without invoking them. None is a supported-model execution result for current source. The historical `f980d28` native 17/18-tool smoke remains preserved.

For the final submission, only an uncoached GPT-5.6 Sol or Terra run in ChatGPT's built-in browser—with the exact deployed commit, full **Available site tools** list, native **Recently used/Sources** trace, arguments/results, visible REPLAY audit, and final response captured together—counts as model tool-selection evidence. Native discovery without invocation, inspector/page-bridge direct calls, polyfilled tests, and ordinary browser UI runs remain useful but separate evidence classes and receive no model-choice credit.

A 2026-08-29 signed-in GPT-5.6 Sol (low) attempt against the historical public build was blocked because that ChatGPT Work cloud-browser session reported `document.modelContext` unavailable. It selected and invoked no Site Tool and changed no case state, so it is recorded only as a client-capability failure—not as native discovery, execution, or a model-eval result.

A separate uncoached GPT-5.6 Sol run exercised a historical pre-`b2e93905` local seed-v6 source state through the Codex in-app browser. It independently chose seven relevant read, validation, focus, preview, and audit calls; preserved the three unresolved questions, calibration advisory, and synthetic-evidence labels; opened a neutral cited preview; and never confirmed a claim, applied a proposal, changed canonical case version 1, or finalized the report. This is useful historical local-source evidence, but it is not current-release or scoring evidence and must be repeated against the exact deployed commit in ChatGPT desktop's native Site Tools client with its native trace captured.

## Judging criteria

### WebMCP Leverage

A screenshot can show the road and vehicles, but not the branch ownership, certainty, provenance, evidence relationships, locks, or current version needed for a safe edit. WebMCP exposes those semantics as typed live state and narrow validated actions; because Site Tools and the UI share domain commands, the resulting proposal, audit, and report preview stay visible in the same case. Nineteen lifecycle-aware tools, normalized spatial round trips, version/lock/idempotency/cancellation protections, deterministic tests, and a separately labelled unrun model-eval specification support that judge-visible collaboration without claiming OpenAI exposes the finalization form as a Site Tool.

### Execution

REPLAY implements the full manual journey from landing and stable local-case resume through blank/demo start, exact multi-vehicle contact authoring, scene/timeline editing, proposals, evidence, facts, questions, branches, activity, persistence/recovery, consistency, human completeness review, report finalization, and local export. The deployed release includes the calibrated five-template/four-scenario realism and integrity layer, optimized original assets, fallback browser behavior, full tests, public-facing documentation, and byte-verified artifact/public identity. Native supported-model evidence, the final video, remaining manual real-device/assistive-technology spot checks, and a dedicated header-capable origin only for full production response-policy claims remain external gates.

### Potential Impact

The product addresses a concrete job after a minor incident: a driver and claims-intake reviewer need to turn spatial, temporal, evidentiary, and human-memory fragments into a record another person can inspect. Local-first storage, explicit provenance, uncertainty, open questions, and a cited report make the output useful without pretending disagreement has disappeared.

### Creativity and Ambition

REPLAY makes a calibrated spatial and temporal case model the collaboration surface rather than a chat transcript. Humans directly correct agent-authored geometry; agents detect those corrections from attributed activity; uncertainty becomes visual branches; deterministic scenarios expose realistic motion and a deliberately conflicting human account without becoming a lie detector; and a citation-bound report retains the difference between fact and inference through a human-only decision boundary.

## Closing

**Agent: read, validate, propose, draft. Reviewer: attest, decide, finalize. REPLAY keeps the difference visible.**
