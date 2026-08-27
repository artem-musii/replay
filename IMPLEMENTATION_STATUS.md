# REPLAY implementation status

Last updated: 2026-08-27

## Current milestone

The end-to-end local application is implemented and has a passing recorded automated-test and performance snapshot. Release completion now depends on live hosting, supported-model probabilistic eval runs, and the remaining manual accessibility, export, and privacy checks.

## Implemented product

- React 19/Vite/strict TypeScript application with landing page, deterministic demo, blank-case wizard, local resume, and a recoverable root error boundary.
- Canonical `ReplayEngine` command layer with strict Zod validation, reference validation, deterministic consistency rules, version conflicts, request idempotency, locks, human-only confirmation/finalization, activity, undo/redo, and safe agent-action reversion.
- Local-first Dexie persistence for case JSON and separate uploaded evidence blobs. Dexie schema version 2 removes the former global checksum uniqueness constraint.
- Manual workspace for actor placement/rotation, trajectory creation/editing, playback, timeline events, impact and damage marking, and actor/trajectory/event/claim locks.
- Provenance-aware claims, local evidence upload/metadata/point-and-rectangle annotations/linking/deletion, questions, hypothesis forks/assumptions, branch overlays, and side-by-side comparison summaries.
- Deterministic report preview, human-reviewed report notes, three acknowledgements, second confirmation, immutable snapshots, and explicit local PDF/JSON/SVG/PNG export.
- Eighteen narrow imperative WebMCP tools with current `document.modelContext.registerTool(...)` feature detection, lifecycle groups, annotations, cancellation cleanup, compact results, agent-working state, visible highlighting, and an in-workspace inspector.
- Visible declarative `finalize_factual_report` form with no `toolautosubmit`; implemented `toolactivated` and `toolcancel` presentation states; only the human UI can dispatch `report.finalize`.
- Five optimized local WebP assets: one hero and four clearly labelled synthetic demo evidence images. There is no runtime image/model API dependency.
- README, MIT license, architecture/data/security/WebMCP/testing/deployment documentation, demo/submission materials, provider-neutral static-host files, and Cloudflare Pages configuration.
- Removed unused planning dependencies Zustand, Immer, `webmcp-types`, and `@testing-library/user-event`; current state uses `ReplayEngine` plus React, and WebMCP declarations are repository-owned.

## Recorded local verification

The 2026-08-27 snapshot recorded in `docs/testing.md` reports:

- format check, lint, strict typecheck, and production build passed;
- Vitest: **53/53 tests across 6 files**;
- Playwright: **32/32 project runs** in 14.7 seconds, comprising 16 scenarios in desktop Chromium and the same 16 in mobile Chrome;
- automated axe checks found no serious or critical violations in the landing page, blank-case wizard, demo workspace, and human-finalization dialog.
- Lighthouse 13.4.1 scored the seeded strict production preview **96 performance, 100 accessibility, 100 best practices, and 100 SEO**, with 10 ms total blocking time and zero layout shift.

Vitest covers schema/seed/import behavior, engine invariants, hypotheses/evidence/report rules, interpolation/consistency, timeline components, and WebMCP registry lifecycle/schema/cancellation behavior. Playwright covers the primary manual and polyfilled-agent journeys, fallback mode, persistence reload, blank-case path/event/impact/damage/lock authoring, normalized evidence annotations, report finalization, screenshots, responsive projects, and the automated accessibility guardrails above.

These results are a local snapshot, not proof of live hosting, real Site Tools behavior, complete WCAG conformance, or probabilistic model reliability.

## Known implementation limits

- Engine commit and IndexedDB persistence are sequential, not one cross-layer transaction. WebMCP mutations await a post-command save, but a storage failure cannot roll back an already-committed in-memory command.
- Exact request receipts and undo/redo snapshots are in memory. Request IDs persist in activity and prevent a duplicate mutation after reload, but exact prior result payloads are not stored in a separate durable journal.
- `ReplayCase.schemaVersion` is still 1 with no older case-shape migration pipeline. A corrupt most-recent case record is deleted rather than quarantined or offered for raw recovery.
- Structured JSON export excludes evidence blobs and retains the original case ID; it is not a complete evidence backup and has no import collision/re-key flow.
- PDF and scene exports use the currently visible scene. Exported-file fidelity and branch/time alignment require manual inspection.
- WebMCP result completion is not transactionally coupled to an actual browser paint. Real adapter + Dexie cancellation/storage-failure integration is not yet covered end to end.
- `evals/webmcp-evals.json` is an aligned evaluation specification, not an executable harness or evidence of model runs. Its injected setup/call fixtures and probabilistic journeys still need to be run against the exact deployed build with retained traces.

## Deployment status

Not deployed. The repository contains `wrangler.toml`, `public/_headers`, `public/_redirects`, and documented Cloudflare Pages/Netlify/Vercel instructions, but no authenticated provider, live URL, or live response-header result has been confirmed. The workspace is not currently a Git checkout, so creating and publishing the required public repository is also an external release step.

## Manual and external gates

- Deploy the exact verified build over HTTPS, then inspect `Permissions-Policy: tools=(self)`, origin isolation, CSP, frame, referrer, and content-type headers on the live response.
- Verify imperative registration, lifecycle, invocation cancellation, and the declarative `toolactivated`/`toolcancel` flow in a current compatible Chrome build.
- Run the human-agent demo and full probabilistic eval matrix with each currently supported Site Tools model/client; retain tool traces and do not aggregate away any safety failure.
- Complete keyboard-only and VoiceOver/NVDA review, dialog focus/escape/restoration checks, 200% zoom, reduced motion, and broader WCAG 2.2 AA inspection.
- Manually exercise pointer editing, local evidence upload/annotation/delete/reload, JSON import collision behavior, and open every downloaded PDF/JSON/SVG/PNG.
- Inspect generated imagery for accidental text, plates, people, trademarks, and implausible geometry.
- Complete production console/network/privacy audits and compare live-host performance with the recorded local Lighthouse baseline.
- Create the public repository, publish the live URL and under-three-minute public YouTube demo, then replace only verified submission placeholders.

## Release rule

Do not describe live deployment, current-browser Site Tools compatibility, screen-reader conformance, export fidelity, or model-eval pass rates as complete until the corresponding gate above has a dated result for the exact public commit and URL.
