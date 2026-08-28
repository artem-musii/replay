# REPLAY implementation status

Last updated: 2026-08-28

## Current milestone

The schema-v2/proposal application is implemented, CI-verified, and deployed to GitHub Pages. Application commit [`df599f37e59e562ffaee919fdc4072eec9265f51`](https://github.com/artem-musii/replay-sol/commit/df599f37e59e562ffaee919fdc4072eec9265f51) passed [Actions run `33125071538`](https://github.com/artem-musii/replay-sol/actions/runs/33125071538), produced the verified Pages artifact, and is live at the public URL. Submission completion now depends on supported-model/native Site Tools traces, manual accessibility/cross-browser/export review, a dedicated header-capable origin for production-like response-policy claims, and the public demo video.

## Implemented product

- React 19/Vite/strict TypeScript application with landing page, deterministic demo, blank-case wizard, local resume/reset, malformed-record recovery, a cross-tab conflict pause, a framing guard, and a recoverable root error boundary.
- Canonical `ReplayEngine` command layer with strict Zod/reference validation, deterministic consistency rules, version conflicts, request idempotency, locks, human-only confirmation/finalization, explicit human-override correlation, activity, undo/redo, and safe agent-action reversion.
- `ReplayCase.schemaVersion = 2`, including a v1→v2 migration for annotation links, report workspace paths, and the proposal ledger. The current deterministic fixture is `seedVersion = 3`; schema v2 accepts saved positive seed versions through 3 until explicit demo reset. Schema-v2 state uses a distinct local vault while retaining legacy records for migration/recovery.
- Optional, replayable onboarding is available from the landing page and workspace: a seven-topic guide, a mutation-free six-step tour, live Site Tools readiness guidance, copyable collaboration prompts, and versioned preference-only progress. Scene/path help explains timed points, straight-line interpolation, lane snap, uncertainty markers, exact controls, and the absence of collision-physics or fault modeling.
- Compare-and-swap IndexedDB writes, a best-effort Web Locks edit lease where supported, BroadcastChannel conflict notices, retained raw recovery records, and evidence-blob case/checksum/MIME verification.
- Manual scene/timeline authoring; provenance-aware claims; local evidence and annotation-level links; ranked questions; hypothesis branches/assumptions; report preview/review/finalization; and explicit JSON/PDF/SVG/PNG downloads.
- Reversible coordinated-scene proposals: only an agent/WebMCP call can create a preview; only a human UI action can adjust, accept, or reject it. Acceptance validates every recorded baseline and lock before applying any proposed geometry.
- Nineteen defined imperative WebMCP tools with lifecycle groups, fixed schemas/annotations, cancellation cleanup, compact results, visible UI coordination, and an inspector: 18 are present for the baseline workspace and `add_report_note` makes 19 after report preview. `propose_scene_changes` is the coordinated-scene proposal entry point.
- Visible declarative `finalize_factual_report` form with no `toolautosubmit`; only the human UI can dispatch `report.finalize`. OpenAI's built-in Site Tools browser currently does not expose declarative form tools. Its ordinary browser interaction is a separate capability, not a WebMCP call or authorization to operate the human confirmation controls.
- Durable canonical activity for domain mutations plus a separate capped, session-only audit for successful/rejected read or UI-only tool invocations. A cancellation before primary persistence begins creates neither entry; a cancellation after a staged save resolves is reconciled through a compensating save before the invocation settles when compensation succeeds.
- Five active optimized local WebP assets: one hero and four clearly labelled synthetic demo evidence images. There is no runtime image/model API dependency.

## Verification evidence

### Historical public baseline

The 2026-08-27 baseline for commit `f980d28` remains preserved in `docs/testing.md` and `docs/deployment.md`. It recorded passing format/lint/typecheck/build, **53/53 Vitest tests across 6 files**, **32/32 Playwright project runs** across desktop/mobile Chromium, automated axe checks, Lighthouse results, a public persistence journey, and a direct Site Tools lifecycle smoke. That evidence is historical: it predates schema v2, proposals, recovery/CAS controls, the framing guard, new export/accessibility regressions, and the current 19-tool inventory.

### Current deployed release

The release contains proposal, persistence, semantic-intent idempotency, staged WebMCP save/commit/compensation, dialog, iframe, evidence-link, override/focus, reset, and export regression coverage. The clean 2026-08-28 local gate recorded:

- `npm ci` passing for 287 packages with no deprecation warnings and `npm audit` reporting 0 vulnerabilities after upgrades to `eslint` 10.9.1, `@eslint/js` 10.0.1, and `eslint-plugin-react-hooks` 7.1.1 plus a self-hosted Inter 5.3.0 font dependency; the Node.js floor is 22.13;
- format, lint with 0 warnings, strict typecheck, production build, and `git diff --check` passing;
- **119/119 Vitest tests across 14 files**, with coverage of **52.9% statements, 41.46% branches, 49.43% functions, and 54.77% lines**; and
- **78 Playwright project runs in 30.9 seconds: 73 passed, 5 intentional mobile screenshot-owner skips, and 0 failed**, with 9 checked screenshot baselines.

GitHub Actions verify job `98701114804` independently passed dependency installation, formatting, lint, typecheck, **119/119 Vitest tests**, **73 passing and 5 intentionally skipped Playwright project runs**, and the production build. Deploy job `98701763882` published Pages deployment `6132593328` from artifact `9668071269` (SHA-256 `b35ee8311e9f94928ff3fc1a38e93d4d77282271874bb7481d2bae8cd4e9b8c4`). All 43 deployed files returned successfully and byte-matched the workflow artifact.

A cache-busted public Lighthouse 13.4.1 run scored **100 performance, 100 accessibility, 100 best practices, and 100 SEO**, with FCP 385.565 ms, LCP/TTI 505.565 ms, Speed Index 565.156 ms, TBT 0 ms, and CLS 0. A fresh live browser loaded the application and four active evidence images with 200 responses, made no off-origin requests, emitted no console warnings/errors, preserved a human UI observation across a full reload, and returned to deterministic seed-v2 state after explicit reset.

An injected standards-compatible `document.modelContext` registry harness verified the deployed bundle's 18→19 imperative lifecycle and expected annotations. `get_case_summary` read schema v2 without canonical mutation; a branch-scoped `add_observation` durably advanced to case version 2; exact replay returned the original receipt with `idempotent: true`; changed intent under that request ID returned `IDEMPOTENCY_CONFLICT` without a version increment; and an ordinary-UI report preview added `add_report_note`. A cache-busted new-document navigation retained the durable version-2 observation with **Saved locally**, correctly cleared the transient preview and injected registry, and exposed the client's native manual mode; visible UI reset then removed the observation and restored seed-v2 case version 1. This was a **runtime-polyfilled contract smoke**, not native OpenAI Site Tools discovery, a supported-model trace, or declarative-form activation. Native current-client evidence remains outstanding.

## Known implementation limits

- Ordinary human-UI commands commit to the live engine before their queued compare-and-swap IndexedDB save; a save failure can therefore leave live memory newer than storage, pause further mutations, and require retry or recovery export. WebMCP mutations instead reduce on an isolated engine copy, compare-and-swap save the staged case, and only then adopt/notify the live engine. A rejected primary save leaves live state untouched; cancellation or a live-version conflict after a resolved save triggers compensation, while failed compensation returns and audits `PERSISTENCE_FAILED`. These paths still do not form one physical transaction with IndexedDB or browser paint.
- Exact request receipts and undo/redo snapshots are in memory. Persisted activity records the request ID, semantic caller-intent fingerprint, original case version, activity ID, summary, and affected IDs used to prevent replay and synthesize an `idempotent: true` response after reload. The exact prior result payload is not stored in a separate durable journal.
- Web Locks availability is browser-dependent. Compare-and-swap remains the final local-write guard, and multi-tab recovery can still require a reload.
- Structured JSON is a case transfer, not a complete backup: it excludes evidence bytes and contains the source case ID. The visible import flow opens a re-keyed local copy; unsigned import intentionally demotes or clears human attestations, reviewed state, and immutable report snapshots.
- Malformed/unsupported local records are retained for explicit raw recovery, not made safe by that retention. Recovery JSON can contain sensitive or invalid content.
- Scene SVG/PNG reflects the visible scene. PDF embeds scene geometry only when its preview version still matches the open case; otherwise it omits the newer geometry. Downloaded-file fidelity still requires manual inspection.
- WebMCP result completion is not transactionally coupled to browser paint. Deterministic real-adapter staging/compensation tests and separate Dexie persistence tests exist, but a combined real-adapter + actual-Dexie cancellation/storage-failure/compensation journey is still pending.
- `evals/webmcp-evals.json` is a specification, not an executable harness or evidence of supported-model runs.

## Deployment status

The current schema-v2/proposal application is available at [artem-musii.github.io/replay-sol](https://artem-musii.github.io/replay-sol/) from commit `df599f37e59e562ffaee919fdc4072eec9265f51`. Initial deployment evidence used commit `c95df75`; the historical audited baseline used `f980d28` and remains preserved without being conflated with the current release.

GitHub Pages shares the `artem-musii.github.io` storage origin with other projects and does not honor `public/_headers`; use the public build only with synthetic/non-sensitive data. The application-level framing guard helps at runtime, while response-level `Permissions-Policy`, COOP/COEP, `X-Content-Type-Options`, and frame policy still require a dedicated header-capable origin.

## Manual and external gates

- Exercise the 18/19-tool imperative lifecycle, proposal review path, cancellation, and report finalization through native current compatible clients. Test declarative activation/cancel separately in compatible Chrome; the current OpenAI Site Tools browser does not expose declarative form tools, and any ordinary browser interaction is not a WebMCP call.
- Run the full probabilistic eval matrix with each supported Site Tools model/client and retain traces without aggregating away safety failures.
- Complete keyboard-only and VoiceOver/NVDA review, 200% zoom, reduced motion, pointer editing, upload/annotation/delete/reload, multi-tab conflict/recovery, and downloaded-file inspection.
- Deploy to a dedicated origin/host honoring `public/_headers` if production-like privacy and response-policy claims are required.
- Record and publish the under-three-minute YouTube demo and replace its submission placeholder.

## Release rule

Only evidence recorded against the exact final commit, built artifact, URL, browser/client, and model may be called current. Preserve older results as historical baselines; do not generalize them into current cross-browser compatibility, screen-reader conformance, export fidelity, or model-eval pass rates.
