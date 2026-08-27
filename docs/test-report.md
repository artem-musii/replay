# REPLAY historical test report

Snapshot date: **2026-08-27**, application commit `f980d28`

Environment: macOS, Node.js 22+, Chromium desktop and mobile emulation

This report is immutable historical evidence for `f980d28`. It does **not** verify the current schema-v2/proposal candidate. The separately labelled appendix below records the candidate's 2026-08-28 clean local gate; see [testing.md](testing.md) for procedures and remaining external gates.

## Automated results

| Gate               | Result                                                         |
| ------------------ | -------------------------------------------------------------- |
| Prettier           | Passing after release formatting                               |
| ESLint             | Passing with zero warnings                                     |
| Strict TypeScript  | Passing                                                        |
| Vitest             | **53/53** tests across 6 files                                 |
| Playwright         | **32/32** project runs in 17.1 seconds: 16 desktop + 16 mobile |
| Axe via Playwright | Zero serious or critical violations in four principal states   |
| Lighthouse 13.4.1  | Local: **96/100/100/100**; public: **100/100/100/100**         |
| Production build   | Passing                                                        |
| `npm audit`        | Zero known vulnerabilities at the recorded snapshot            |

Vitest covers schemas and seed validity, domain authorization/version/idempotency/locks, undo and safe reversion, hypotheses/evidence/report rules, import/export references, interpolation, deterministic consistency, timeline behavior, and WebMCP registration/lifecycle/cancellation.

Playwright covers the landing and blank wizard, deterministic demo, synchronized playback, human confirmation, WebMCP polyfill mutation, evidence provenance and annotations, hypothesis comparison, human-only finalization, local persistence, ordinary-browser fallback, blank-case path/event/impact/damage authoring, lock enforcement, screenshots, mobile behavior, and axe checks.

## Historical direct Site Tools checks

The in-app browser loaded both the strict local preview and the public [GitHub Pages demo](https://artem-musii.github.io/replay-sol/#demo) and discovered the then-current 17 WebMCP tools. On the public origin, `get_case_summary` returned the seeded case, an `add_observation` call visibly advanced the case and activity, and `revert_agent_action` safely reversed it. `build_report_preview` changed that lifecycle to 18 tools, exposed `add_report_note`, and rendered one declarative `finalize_factual_report` form with no `toolautosubmit`.

A separate public-origin journey created a blank case, saved it to IndexedDB, reloaded, and restored the workspace. The landing page, demo route, generated hero, favicon, manifest, and 404 response all returned successfully.

This is historical direct browser/tool verification, not a claimed probabilistic model-eval pass rate or proof of the candidate's current 18/19-tool lifecycle.

## Performance snapshot

The seeded workspace was audited from the strict local production preview. Recorded Lighthouse lab metrics were FCP 2.0 s, LCP 2.4 s, Speed Index 2.0 s, total blocking time 10 ms, CLS 0, and time to interactive 2.4 s. The cache-busted public commit `f980d28` run recorded FCP 0.5 s, LCP 0.5 s, Speed Index 0.7 s, total blocking time 0 ms, CLS 0, and time to interactive 0.5 s. The public run also scored 100 for agentic browsing. Both final runs had no binary Lighthouse failures. These are lab measurements, not field data.

## Defects found during final E2E expansion

Two real integration defects were fixed and regression-covered:

1. Evidence annotation clicks stored 0–100 percentages while the canonical schema required normalized 0–1 coordinates.
2. UI trajectory edits leaked stored `actorId` fields into a strict keyframe command schema.

## Candidate coverage added after this report

The working candidate adds deterministic coverage for schema-v2 migration, raw-record recovery, compare-and-swap persistence, case/blob round-trip and packaged evidence-asset digest verification, staged adapter save/commit/compensation and semantic-intent idempotency, annotation links, coordinated agent proposals and human decisions, explicit human overrides, issue focus, dialog focus/Escape/restoration, 320px reflow, finalized JSON/PDF, saved-demo reset, and iframe/tool-registration blocking. Runtime corrupt-blob rejection is implemented but is not described here as a directly exercised database test.

## Current candidate clean local gate

On **2026-08-28**, the current working candidate completed a clean local dependency install and release gate:

| Gate                 | Recorded result                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| Node requirement     | Floor raised to Node.js **22.13**                                                                         |
| `npm ci`             | Passing; **287 packages** installed, with no deprecation warnings                                         |
| Dependency audit     | **0 vulnerabilities**                                                                                     |
| Prettier             | Passing                                                                                                   |
| ESLint               | Passing with **0 warnings**                                                                               |
| Strict TypeScript    | Passing                                                                                                   |
| Vitest               | **119/119** tests passed across **14 files**                                                              |
| Coverage             | Statements **52.9%**; branches **41.46%**; functions **49.43%**; lines **54.77%**                         |
| Playwright           | **78** project runs: **73 passed**, **5 intentional mobile screenshot-owner skips**, **0 failed**, 30.9 s |
| Screenshot baselines | **9** checked baselines                                                                                   |
| Production build     | Passing                                                                                                   |
| `git diff --check`   | Passing                                                                                                   |

The clean install followed upgrades to `eslint` 10.9.1, `@eslint/js` 10.0.1, and `eslint-plugin-react-hooks` 7.1.1, plus the addition of self-hosted Inter 5.3.0 for cross-platform typography. This is local deterministic evidence for the working candidate, not proof of a deployed commit, public URL, current Lighthouse score, supported-model behavior, or manual accessibility/export fidelity.

## Remaining manual/external gates

The candidate still needs a fixed final commit and workflow record, deployment/asset/header smoke, current Site Tools lifecycle, public Lighthouse rerun, screen-reader and cross-browser review, complete WCAG review, downloaded-file inspection, supported-model eval traces, the public demo video, and any production-like deployment proof from a dedicated header-capable origin. GitHub Pages was historically verified to ignore `_headers`. See [testing.md](testing.md) for exact procedures.
