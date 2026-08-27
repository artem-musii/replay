# REPLAY test report

Snapshot date: **2026-08-27**

Environment: macOS, Node.js 22+, Chromium desktop and mobile emulation

## Automated results

| Gate               | Result                                                                |
| ------------------ | --------------------------------------------------------------------- |
| Prettier           | Passing after release formatting                                      |
| ESLint             | Passing with zero warnings                                            |
| Strict TypeScript  | Passing                                                               |
| Vitest             | **53/53** tests across 6 files                                        |
| Playwright         | **32/32** project runs in 14.7 seconds: 16 desktop + 16 mobile        |
| Axe via Playwright | Zero serious or critical violations in four principal states          |
| Lighthouse 13.4.1  | **96 performance / 100 accessibility / 100 best practices / 100 SEO** |
| Production build   | Passing                                                               |
| `npm audit`        | Zero known vulnerabilities at the recorded snapshot                   |

Vitest covers schemas and seed validity, domain authorization/version/idempotency/locks, undo and safe reversion, hypotheses/evidence/report rules, import/export references, interpolation, deterministic consistency, timeline behavior, and WebMCP registration/lifecycle/cancellation.

Playwright covers the landing and blank wizard, deterministic demo, synchronized playback, human confirmation, WebMCP polyfill mutation, evidence provenance and annotations, hypothesis comparison, human-only finalization, local persistence, ordinary-browser fallback, blank-case path/event/impact/damage authoring, lock enforcement, screenshots, mobile behavior, and axe checks.

## Live local Site Tools check

The in-app browser loaded the strict production preview and discovered 17 WebMCP tools. `get_case_summary` returned the seeded case, an `add_observation` call visibly advanced the case and activity, and `revert_agent_action` safely reversed it. `build_report_preview` changed the lifecycle to 18 tools, exposed `add_report_note`, and rendered one declarative `finalize_factual_report` form with no `toolautosubmit`.

This is direct browser/tool verification, not a claimed probabilistic model-eval pass rate.

## Performance snapshot

The seeded workspace was audited from the strict local production preview. Recorded Lighthouse lab metrics were FCP 2.0 s, LCP 2.4 s, Speed Index 2.0 s, total blocking time 10 ms, CLS 0, and time to interactive 2.4 s. The final run had no binary Lighthouse failures. These are local lab measurements, not field data.

## Defects found during final E2E expansion

Two real integration defects were fixed and regression-covered:

1. Evidence annotation clicks stored 0–100 percentages while the canonical schema required normalized 0–1 coordinates.
2. UI trajectory edits leaked stored `actorId` fields into a strict keyframe command schema.

## Remaining manual/external gates

Screen-reader review, complete WCAG conformance, exported-file inspection, supported-model eval runs, and final public-host response-policy verification remain separate release evidence. See [testing.md](testing.md) for exact procedures.
