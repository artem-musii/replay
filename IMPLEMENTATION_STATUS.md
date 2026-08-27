# REPLAY implementation status

Last updated: 2026-08-27

## Current milestone

The end-to-end application is implemented, published from a public repository, and verified on its GitHub Pages URL. Submission completion now depends on recording the public video, supported-model probabilistic eval runs, and the remaining manual accessibility and export checks.

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

## Recorded verification

The 2026-08-27 snapshot recorded in `docs/testing.md` reports:

- format check, lint, strict typecheck, and production build passed;
- Vitest: **53/53 tests across 6 files**;
- Playwright: **32/32 project runs** in 17.1 seconds, comprising 16 scenarios in desktop Chromium and the same 16 in mobile Chrome;
- automated axe checks found no serious or critical violations in the landing page, blank-case wizard, demo workspace, and human-finalization dialog.
- Lighthouse 13.4.1 scored the seeded strict production preview **96 performance, 100 accessibility, 100 best practices, and 100 SEO**, with 10 ms total blocking time and zero layout shift.
- The public GitHub Pages build scored **99 performance, 100 accessibility, 100 best practices, and 100 SEO**, with 0 ms total blocking time and zero layout shift.
- The public in-app browser discovered the 17-tool baseline, ran `get_case_summary`, visibly applied and safely reverted an `add_observation` mutation, built a report preview, discovered the 18th `add_report_note` tool, and found one declarative `finalize_factual_report` form with no `toolautosubmit`.
- A separate public-origin journey created a blank case, reloaded, and restored it from IndexedDB.

Vitest covers schema/seed/import behavior, engine invariants, hypotheses/evidence/report rules, interpolation/consistency, timeline components, and WebMCP registry lifecycle/schema/cancellation behavior. Playwright covers the primary manual and polyfilled-agent journeys, fallback mode, persistence reload, blank-case path/event/impact/damage/lock authoring, normalized evidence annotations, report finalization, screenshots, responsive projects, and the automated accessibility guardrails above.

The direct Site Tools checks prove the tool contracts work in the tested public in-app browser session; they are not a supported-model prompt-following pass rate, complete WCAG conformance claim, or cross-browser compatibility matrix.

## Known implementation limits

- Engine commit and IndexedDB persistence are sequential, not one cross-layer transaction. WebMCP mutations await a post-command save, but a storage failure cannot roll back an already-committed in-memory command.
- Exact request receipts and undo/redo snapshots are in memory. Request IDs persist in activity and prevent a duplicate mutation after reload, but exact prior result payloads are not stored in a separate durable journal.
- `ReplayCase.schemaVersion` is still 1 with no older case-shape migration pipeline. A corrupt most-recent case record is deleted rather than quarantined or offered for raw recovery.
- Structured JSON export excludes evidence blobs and retains the original case ID; it is not a complete evidence backup and has no import collision/re-key flow.
- PDF and scene exports use the currently visible scene. Exported-file fidelity and branch/time alignment require manual inspection.
- WebMCP result completion is not transactionally coupled to an actual browser paint. Real adapter + Dexie cancellation/storage-failure integration is not yet covered end to end.
- `evals/webmcp-evals.json` is an aligned evaluation specification, not an executable harness or evidence of model runs. Its injected setup/call fixtures and probabilistic journeys still need to be run against the exact deployed build with retained traces.

## Deployment status

Published from [github.com/artem-musii/replay-sol](https://github.com/artem-musii/replay-sol) to [artem-musii.github.io/replay-sol](https://artem-musii.github.io/replay-sol/) with GitHub Actions. The initial verified deployment used commit `c95df75` and workflow run `33105222174`; subsequent pushes to `main` use the same checked workflow.

The landing page, deterministic `#demo`, generated assets, favicon, manifest, 404 page, persistence, baseline/reviewed-report Site Tools lifecycles, and public Lighthouse audit have been verified. GitHub Pages does not honor `public/_headers`: the production HTML therefore includes a restrictive CSP and no-referrer meta policy, while response-only `Permissions-Policy`, COOP/COEP, `X-Content-Type-Options`, and `X-Frame-Options` require a host such as Cloudflare Pages or Netlify. Site Tools worked in the tested top-level GitHub Pages session despite that provider limitation.

## Manual and external gates

- If full response-policy enforcement is required, deploy the same artifact to a host that honors `public/_headers`, then inspect `Permissions-Policy: tools=(self)`, origin isolation, CSP, frame, referrer, and content-type headers.
- Verify invocation cancellation and the declarative `toolactivated`/`toolcancel` presentation path across additional current compatible browser/client versions.
- Run the human-agent demo and full probabilistic eval matrix with each currently supported Site Tools model/client; retain tool traces and do not aggregate away any safety failure.
- Complete keyboard-only and VoiceOver/NVDA review, dialog focus/escape/restoration checks, 200% zoom, reduced motion, and broader WCAG 2.2 AA inspection.
- Manually exercise pointer editing, local evidence upload/annotation/delete/reload, JSON import collision behavior, and open every downloaded PDF/JSON/SVG/PNG.
- Inspect generated imagery for accidental text, plates, people, trademarks, and implausible geometry.
- Complete the remaining production console/network/privacy matrix and manual export-file inspection.
- Record and publish the under-three-minute public YouTube demo, then replace its final submission placeholder.

## Release rule

Do not generalize the single verified public Site Tools session into cross-client compatibility, screen-reader conformance, export fidelity, or model-eval pass rates until each corresponding gate has a dated result for the exact public commit and URL.
