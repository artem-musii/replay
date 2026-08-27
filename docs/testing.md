# Testing REPLAY

Last local snapshot in this document: **2026-08-27**, Node.js 22+ toolchain. This guide distinguishes deterministic code tests, manual browser verification, and probabilistic agent evals. A result in one category is never presented as proof of another.

## Release command sequence

From a clean checkout:

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

Run the sequence against the exact commit to deploy. Do not reuse results from a dirty tree or a different dependency lockfile. If any command fails, record the failure and do not describe the release gate as passing.

Useful development commands:

```bash
npm run test:watch
npm run test:coverage
npm run preview
```

The Playwright command builds and serves `dist/` at `http://127.0.0.1:4173` automatically.

## Current deterministic coverage

| Area                          | Test location                                     | What is covered                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema and deterministic seed | `tests/domain/schema-seed.test.ts`                | Runtime shape validation, cross-reference validity, deterministic demo reset, seeded certainty/evidence/issue expectations.                                                       |
| Command engine                | `tests/domain/engine.test.ts`                     | Canonical mutations, case-version changes, stale-version rejection, request idempotency, locks, human-only confirmation/finalization, undo/redo, and safe agent-action reversion. |
| Hypotheses, evidence, reports | `tests/domain/hypotheses-evidence-report.test.ts` | Branching/comparison, evidence relationships and import/export references, evidence-bound report behavior, reviewed agent notes, final snapshot rules.                            |
| Geometry and consistency      | `tests/domain/interpolation-consistency.test.ts`  | Pose interpolation, rotation, clamping, trajectory/impact geometry, timing/provenance/completeness checks.                                                                        |
| Timeline component            | `tests/components/timeline.test.tsx`              | Playback controls and keyboard/event interaction at the component boundary.                                                                                                       |
| WebMCP registry               | `tests/webmcp/registry.test.ts`                   | Feature detection, tool inventory/schema/annotations, lifecycle groups, duplicate protection, direct execution, cancellation/reconciliation behavior, and fallback.               |

At the documentation snapshot, lint and strict typecheck passed, Vitest reported **53/53 tests across 6 files**, Playwright reported **32/32 runs in 17.1 seconds** across `chromium-desktop` (16/16) and `mobile-chrome` (16/16), and the production build passed. The Playwright run included blank-case path/event/impact/damage authoring, lock behavior, evidence annotations, and axe checks of the landing page, blank-case wizard, demo workspace, and human-finalization dialog with no serious or critical violations. This is not a claim that screen-reader review, complete WCAG conformance, or the supported-model eval matrix has passed. See `IMPLEMENTATION_STATUS.md` for the most recent project-wide status.

## End-to-end coverage

Playwright is configured for 1440 × 900 Chromium and a Pixel 7-sized mobile project. The current 16 scenarios run once in each project and cover:

1. landing contract and both start actions;
2. deterministic demo scene, time, and provenance;
3. synchronized timeline scrubbing and playback geometry;
4. explicit human-only confirmation;
5. a WebMCP-polyfilled agent observation remaining visibly hypothetical and non-confirmable;
6. all four generated demo evidence assets and synthetic provenance;
7. point/rectangle evidence annotation creation and removal;
8. hypothesis fork and non-conclusive visual comparison;
9. report preview, three acknowledgements, declarative-form attributes, second confirmation, and cancellation;
10. blank-case wizard certainty behavior;
11. blank-case path/event/impact/damage authoring and lock enforcement;
12. local persistence and restoration after reload;
13. complete manual fallback when WebMCP is absent;
14. success screenshots of landing and workspace at both viewports;
15. axe analysis of landing and blank wizard; and
16. axe analysis of workspace and finalization dialog.

Pointer drag/rotation, local user-evidence upload/delete, downloaded-file opening, full JSON import/export recovery, dialog focus behavior, screen readers, and a cross-client WebMCP matrix remain explicit manual or future automated gates below. A direct public Site Tools smoke run is recorded later in this document, but it is not a probabilistic model-eval pass. Playwright screenshot PNGs are success artifacts in `playwright-report`; they are not visual-regression baselines.

## Deterministic demo fixture

Use `case-demo-roundabout` from `src/domain/seed.ts` for automated and manual journeys.

Reset methods:

- open `/#demo` in a clean navigation;
- use **Case options → Reset deterministic demo**; or
- call `createDemoCase()` in an isolated deterministic test.

Before every run, capture:

- seed/schema version and case version;
- active branch and relevant stable IDs;
- current consistency issues;
- activity count and latest activity ID;
- registered Site Tools for that lifecycle state.

Never let one agent-eval run reuse mutations from the previous run.

## Ordinary browser manual test

Run `npm run dev`, open `http://localhost:5173/#demo`, and verify the header reports manual mode when `document.modelContext` is absent.

Complete this path without an agent:

1. Select and edit both vehicles and their path/timeline data.
2. Add and explicitly confirm one human observation; verify an agent-style status cannot be selected as confirmed.
3. Upload a harmless local image, link it to a claim, reload, then delete it through the confirmation dialog.
4. Fork a branch, add an assumption, compare it with baseline, and exit comparison.
5. Build a report, review any pending notes, open final review, test cancellation, then finalize manually.
6. Export JSON, PDF, scene SVG, and scene PNG; open every downloaded file.
7. Reload and verify the latest case persists without a network request.
8. Reset the demo and confirm seeded state is restored.

Repeat the fallback path in current Chromium, Firefox, and Safari if available. Record exact browser versions.

## WebMCP-enabled Chrome test

Availability changes as the proposal evolves; follow the current [Chrome WebMCP overview](https://developer.chrome.com/docs/ai/webmcp) and the dated repository [source of truth](source-of-truth.md).

1. Use a Chrome build supporting the current WebMCP API. If provided in that build, enable `chrome://flags/#enable-webmcp-testing` and restart.
2. Run `npm run dev` and open `http://localhost:5173/#demo`.
3. Open **Case options → WebMCP inspector**.
4. Verify support is detected, lifecycle mode is correct, and the expected tools are registered exactly once.
5. Inspect the JSON Schema and both annotations for representative read and write tools.
6. If the browser exposes `getTools()` and `executeTool()`, directly run `get_case_summary` with `{}` and confirm no case/activity mutation.
7. Run `validate_case_consistency` and confirm it returns the seeded issue without changing facts.
8. Directly execute a versioned test mutation through a test fixture, then confirm scene/timeline/activity all agree before success is surfaced.
9. Abort an invocation before commit and verify no case version, persistence, activity, or visible committed geometry changes; the working state must clear.
10. Navigate away/close the workspace and verify lifecycle registrations disappear.

Use a disposable demo fixture for direct mutation tests. Never use personal evidence.

## ChatGPT/Codex Site Tools test

Use a deployed HTTPS URL because that is the submission environment. At the source-of-truth date, the official OpenAI Site Tools documentation lists GPT-5.6 Sol and GPT-5.6 Terra as supported and notes rollout/workspace limitations; recheck before the final run.

1. Open [https://artem-musii.github.io/replay-sol/#demo](https://artem-musii.github.io/replay-sol/#demo) in the desktop app’s built-in browser.
2. Confirm REPLAY’s page status says Site Tools available.
3. Ask the four prompts in [demo-script.md](demo-script.md) without naming internal tools.
4. Capture tool names, arguments, order, results, case versions, activity IDs, and visible UI effects.
5. Verify the agent reads recent activity after the human correction and does not restore its older geometry.
6. Verify both hypotheses remain alternatives, shared damage stays unchanged, and no fault conclusion appears.
7. Verify the agent prepares but cannot complete the declarative finalization flow.
8. Reset and repeat every scenario in `evals/webmcp-evals.json` at least five times per currently supported target model, recording exact model/client/build/commit.

The machine-readable eval suite and scoring rules are documented in [webmcp-evals.md](webmcp-evals.md). A 2026-08-27 public smoke run discovered 17 baseline tools, called `get_case_summary`, visibly added and safely reverted an observation, built the report preview, discovered the 18th `add_report_note` tool, and verified one non-autosubmitting `finalize_factual_report` form. A separate blank-case journey survived reload through IndexedDB. Do not publish this direct contract verification as an aggregate model-eval rate, or publish an aggregate that hides any confirmation, finalization, lock, stale-version, cancellation, or prompt-injection safety failure.

## Accessibility verification

Automated axe results are a starting point, not a substitute for interaction review.

- Navigate landing, wizard, workspace, each inspector tab, menus, dialogs, timeline, and scene using keyboard only.
- Verify a visible focus indicator never disappears and focus returns to the invoking control after a dialog closes.
- Confirm the skip link reaches `#main-content`.
- Move/rotate a selected vehicle with arrows/brackets and adjust timeline handles with arrows; verify labels announce the object, position/orientation or time, certainty, and lock state.
- Check every status has text/icon/pattern information in addition to color.
- Test 200% zoom and the mobile breakpoint without lost review/report content.
- Enable `prefers-reduced-motion: reduce` and confirm pulses/smooth motion stop without suppressing state changes.
- Inspect landing, forms, tabs, evidence preview, report, and activity with VoiceOver or NVDA.
- Verify dialog focus trap, Escape/cancel behavior, and focus restoration manually. If any are missing, record and fix them before claiming WCAG 2.2 AA.

## Privacy and security verification

1. Clear site data, load demo, and inspect the Network panel. The core demo should request only same-origin static assets.
2. Upload a safe test image and verify its bytes are in IndexedDB, not a remote request.
3. Test incorrect MIME type, extension spoofing, unreadable bytes, file over 20 MiB, duplicate checksum, and corrupt JSON import.
4. Use HTML/SVG/script-like strings in statement, filename, note, and imported text fields; verify they render as text and do not execute.
5. Put an instruction-like sentence in evidence notes; confirm Site Tools treat it as untrusted case content.
6. Verify rejected, stale, locked, duplicate, and cancelled mutations add no unintended activity or content change.
7. Check deployed response headers with:

```bash
curl -sS -D - -o /dev/null https://artem-musii.github.io/replay-sol/
```

The response must be HTTPS. GitHub Pages does not consume `public/_headers`, so its live response lacks the intended `Permissions-Policy`, origin isolation, CSP, frame restriction, content-type, and referrer response policies. The production document mitigates the policies representable in HTML with restrictive CSP and no-referrer meta elements; use Cloudflare Pages, Netlify, or another header-capable host when the complete response contract is required. Hash fragments are client-side and are not sent to the server, so header checks target `/`.

## Performance and visual verification

- Record interaction responsiveness while dragging, scrubbing, playing at 2×, and overlaying two branches.
- Lighthouse 13.4.1 audited the seeded workspace from the strict production preview: **96 performance, 100 accessibility, 100 best practices, and 100 SEO**. Recorded lab metrics were FCP 2.0 s, LCP 2.4 s, Speed Index 2.0 s, total blocking time 10 ms, CLS 0, and interactive 2.4 s.
- The same Lighthouse version audited the cache-busted public application commit at **100 performance, 100 accessibility, 100 best practices, 100 SEO, and 100 agentic browsing**, with no binary failures. Public lab metrics were FCP 0.5 s, LCP 0.5 s, Speed Index 0.7 s, total blocking time 0 ms, CLS 0, and interactive 0.5 s.
- Confirm no broken generated image, layout shift, clipped focus ring, unreadable status, or horizontal overflow at 1440 × 900, 1024 × 768, 390 × 844, and 200% zoom.
- Inspect the five generated images for the criteria in [generated-assets.md](generated-assets.md).
- Check the console for errors, unhandled rejections, hydration warnings, missing assets/source maps affecting users, and failed requests.
- Search production paths for placeholders and TODOs:

```bash
rg -n "TODO|FIXME|PLACEHOLDER|example\.com|ADD VERIFIED|ADD PUBLIC|<live-app-url>|<deployment-host>" src public index.html README.md docs
```

The published app and repository must have no remaining placeholders. Before the video is recorded, the only intentional submission token is `[ADD YOUTUBE URL]` in the Devpost draft.

## Result record template

For the final shipped commit, record:

```text
Commit:
Node/npm:
OS:
Date/time zone:
npm ci:
format:check:
lint:
typecheck:
unit/component tests:
Playwright desktop/mobile:
axe/manual accessibility:
Chrome WebMCP version and flag/origin-trial state:
ChatGPT/Codex client, workspace, and model:
WebMCP eval runs:
Lighthouse/performance:
Console/network audit:
Exports opened:
Persistence reload:
Live URL and headers:
Known limitations:
```
