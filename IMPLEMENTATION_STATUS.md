# REPLAY implementation status

Last updated: 2026-08-28

## Current milestone

The onboarding/path-authoring/schema-v2 application is implemented, CI-verified, and deployed to GitHub Pages. Application commit [`00688d8a51fb783dbf147e08ece60470b8877544`](https://github.com/artem-musii/replay-sol/commit/00688d8a51fb783dbf147e08ece60470b8877544) passed [Actions run `33161848637`](https://github.com/artem-musii/replay-sol/actions/runs/33161848637), produced the verified Pages artifact, and is live at the public URL. Submission completion now depends on supported-model/native Site Tools execution traces, manual accessibility/cross-browser/export review, a dedicated header-capable origin for production-like response-policy claims, and the public demo video.

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

The release contains proposal, persistence, semantic-intent idempotency, staged WebMCP save/commit/compensation, onboarding, timed path/range/heading editing, narrow and 200%-text reflow, dialog, iframe, evidence-link, override/focus, reset, and export regression coverage. The clean 2026-08-28 local gate recorded:

- `npm ci` passing for 287 packages with no deprecation warnings and `npm audit` reporting 0 vulnerabilities after upgrades to `eslint` 10.9.1, `@eslint/js` 10.0.1, and `eslint-plugin-react-hooks` 7.1.1 plus a self-hosted Inter 5.3.0 font dependency; the Node.js floor is 22.13;
- format, lint with 0 warnings, strict typecheck, production build, and `git diff --check` passing;
- **136/136 Vitest tests across 15 files**, with coverage of **52.67% statements, 41.53% branches, 49.55% functions, and 54.77% lines**; and
- **108 Playwright project runs: 103 passed, 5 intentional mobile screenshot-owner skips, and 0 failed**, with 10 checked screenshot baselines.

GitHub Actions verify job `98817932649` independently passed dependency installation, formatting, lint, typecheck, **136/136 Vitest tests**, **103 passing and 5 intentionally skipped Playwright project runs**, and the production build. Deploy job `98818739202` published Pages deployment `6139340101` from artifact `9682041096` (3,009,246 bytes; SHA-256 `9fae713230ec290ca8255641b1d13c89d59b155041aa9a68403d3231caff645e`). All 43 public files returned successfully and byte-matched the workflow artifact.

A cache-busted public Lighthouse 13.4.1 run scored **100 performance, 100 accessibility, 100 best practices, and 100 SEO**, with FCP 503.479 ms, LCP/TTI 623.479 ms, Speed Index 745.184 ms, TBT 0 ms, and CLS 0; the report SHA-256 is `7c903b69675faa5e70283876434cca6da501a56d8c44d058706c5c90262714e4`.

A fresh cache-busted live smoke opened the optional guide, checked the WebMCP experience, loaded the deterministic seed-v3 case, and exercised vehicle rotation, trajectory-point addition, uncertainty editing, and retained-recovery onboarding access. It recorded zero console warnings/errors, failed requests, and off-origin requests. A separate current Codex in-app-browser smoke surfaced all 18 baseline tools and the visible `18 registered` state without invoking one. Supported-model execution, declarative-form activation, and broad native-client compatibility remain outstanding.

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

The current schema-v2/proposal application is available at [artem-musii.github.io/replay-sol](https://artem-musii.github.io/replay-sol/) from commit `00688d8a51fb783dbf147e08ece60470b8877544`. Initial deployment evidence used commit `c95df75`; the historical audited baseline used `f980d28` and remains preserved without being conflated with the current release.

GitHub Pages shares the `artem-musii.github.io` storage origin with other projects and does not honor `public/_headers`; use the public build only with synthetic/non-sensitive data. The application-level framing guard helps at runtime, while response-level `Permissions-Policy`, COOP/COEP, `X-Content-Type-Options`, and frame policy still require a dedicated header-capable origin.

## Manual and external gates

- Exercise the 18/19-tool imperative lifecycle, proposal review path, cancellation, and report finalization through native current compatible clients. Test declarative activation/cancel separately in compatible Chrome; the current OpenAI Site Tools browser does not expose declarative form tools, and any ordinary browser interaction is not a WebMCP call.
- Run the full probabilistic eval matrix with each supported Site Tools model/client and retain traces without aggregating away safety failures.
- Complete keyboard-only and VoiceOver/NVDA review, 200% zoom, reduced motion, pointer editing, upload/annotation/delete/reload, multi-tab conflict/recovery, and downloaded-file inspection.
- Deploy to a dedicated origin/host honoring `public/_headers` if production-like privacy and response-policy claims are required.
- Record and publish the under-three-minute YouTube demo and replace its submission placeholder.

## Release rule

Only evidence recorded against the exact final commit, built artifact, URL, browser/client, and model may be called current. Preserve older results as historical baselines; do not generalize them into current cross-browser compatibility, screen-reader conformance, export fidelity, or model-eval pass rates.
