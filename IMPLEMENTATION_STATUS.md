# REPLAY implementation status

Last updated: 2026-08-28

## Current milestone

The end-to-end challenge application and its schema-v2/proposal release candidate are implemented locally. The current working candidate completed a clean local release gate on 2026-08-28. An older public GitHub Pages build has dated verification evidence, but the candidate has not yet been committed, deployed, or reverified at the public URL. Submission completion therefore still depends on a fixed final commit and workflow record, candidate deployment/smoke evidence, supported-model eval traces, manual accessibility/cross-browser/export review, a current public Lighthouse run, and the public demo video.

## Implemented product

- React 19/Vite/strict TypeScript application with landing page, deterministic demo, blank-case wizard, local resume/reset, malformed-record recovery, a cross-tab conflict pause, a framing guard, and a recoverable root error boundary.
- Canonical `ReplayEngine` command layer with strict Zod/reference validation, deterministic consistency rules, version conflicts, request idempotency, locks, human-only confirmation/finalization, explicit human-override correlation, activity, undo/redo, and safe agent-action reversion.
- `ReplayCase.schemaVersion = 2`, including a v1→v2 migration for annotation links, report workspace paths, and the proposal ledger. The current deterministic fixture is `seedVersion = 2`; schema v2 accepts saved positive seed versions through 2 until explicit demo reset. Schema-v2 state uses a distinct local vault while retaining legacy records for migration/recovery.
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

### Current candidate

The repository now contains additional proposal, persistence, semantic-intent idempotency, staged WebMCP save/commit/compensation, dialog, iframe, evidence-link, override/focus, reset, and export regression coverage. The clean 2026-08-28 local gate recorded:

- `npm ci` passing for 286 packages with no deprecation warnings and `npm audit` reporting 0 vulnerabilities after upgrades to `eslint` 10.9.1, `@eslint/js` 10.0.1, and `eslint-plugin-react-hooks` 7.1.1; the Node.js floor is 22.13;
- format, lint with 0 warnings, strict typecheck, production build, and `git diff --check` passing;
- **119/119 Vitest tests across 14 files**, with coverage of **52.9% statements, 41.46% branches, 49.43% functions, and 54.77% lines**; and
- **78 Playwright project runs in 30.8 seconds: 73 passed, 5 intentional mobile screenshot-owner skips, and 0 failed**, with 9 checked screenshot baselines.

This is current local deterministic evidence for the working candidate. It is not a deployed-commit, public-browser, Lighthouse, manual accessibility/export, or supported-model result.

The current candidate also still needs a dated public record for:

- final commit SHA and workflow run;
- GitHub Pages asset and route availability;
- current 18-tool baseline/19-tool reviewed-report lifecycle and declarative form behavior;
- browser console/network/persistence/export smoke;
- current public Lighthouse and manual accessibility/cross-browser evidence; and
- supported-model probabilistic eval traces.

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

The historical public application is available at [artem-musii.github.io/replay-sol](https://artem-musii.github.io/replay-sol/). Initial deployment evidence used commit `c95df75` and workflow run `33105222174`; the historical audited baseline used `f980d28` and workflow run `33108322846`.

The schema-v2/proposal candidate and its versioned v2 evidence assets are not yet proven at that URL. GitHub Pages also shares the `artem-musii.github.io` storage origin with other projects and does not honor `public/_headers`; use the public build only with synthetic/non-sensitive data. The application-level framing guard helps at runtime, while response-level `Permissions-Policy`, COOP/COEP, `X-Content-Type-Options`, and frame policy still require a dedicated header-capable origin.

## Manual and external gates

- Preserve the 2026-08-28 clean local-gate record, fix the final SHA, and rerun the workflow in CI if the candidate changes; bind any release claim to that exact commit.
- Deploy the exact candidate, verify every route/versioned asset, and retain response headers plus console/network evidence.
- Exercise the 18/19-tool imperative lifecycle, proposal review path, cancellation, and report finalization in current compatible clients. Test declarative activation/cancel separately in compatible Chrome; the current OpenAI Site Tools browser does not expose declarative form tools, and any ordinary browser interaction is not a WebMCP call.
- Run the full probabilistic eval matrix with each supported Site Tools model/client and retain traces without aggregating away safety failures.
- Complete keyboard-only and VoiceOver/NVDA review, 200% zoom, reduced motion, pointer editing, upload/annotation/delete/reload, multi-tab conflict/recovery, and downloaded-file inspection.
- Deploy to a dedicated origin/host honoring `public/_headers` if production-like privacy and response-policy claims are required.
- Record and publish the under-three-minute YouTube demo and replace its submission placeholder.

## Release rule

Only evidence recorded against the exact final commit, built artifact, URL, browser/client, and model may be called current. Preserve older results as historical baselines; do not generalize them into current cross-browser compatibility, screen-reader conformance, export fidelity, or model-eval pass rates.
