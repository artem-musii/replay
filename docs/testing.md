# Testing REPLAY

Last source/test inventory reconciliation in this document: **2026-08-28**, Node.js 22.13+ toolchain. This guide distinguishes deterministic code tests, manual browser verification, and probabilistic agent evals. A result in one category is never presented as proof of another.

## Release command sequence

From a clean checkout:

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npm run test:e2e
npm run build
npm audit
git diff --check
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

| Area                              | Test location                                                                         | What is covered                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema and deterministic seed     | `tests/domain/schema-seed.test.ts`                                                    | Runtime/cross-reference validation, schema-v2 migration/import behavior, deterministic reset, seeded certainty/evidence/issues.                                                                                                                                                                                                                                                                                                                                |
| Command engine                    | `tests/domain/engine.test.ts`                                                         | Canonical mutations, versions/idempotency/locks, human-only boundaries, explicit override correlation, undo/redo, and safe agent-action reversion.                                                                                                                                                                                                                                                                                                             |
| Coordinated proposals             | `tests/domain/agent-proposals.test.ts`                                                | Agent-only proposal creation, preview isolation, human adjustment/accept/reject, stale/locked all-or-nothing acceptance, and unsigned-import trust reset.                                                                                                                                                                                                                                                                                                      |
| Hypotheses, evidence, and reports | `tests/domain/hypotheses-evidence-report.test.ts`                                     | Branch comparison, annotation/assumption links, structured transfer references, workspace-path citations, report requirements, note review, and snapshots.                                                                                                                                                                                                                                                                                                     |
| Geometry and consistency          | `tests/domain/interpolation-consistency.test.ts`                                      | Pose interpolation, rotation, clamping, trajectory/impact geometry, and deterministic timing/provenance/completeness rules.                                                                                                                                                                                                                                                                                                                                    |
| Persistence and real adapter      | `tests/persistence/database.test.ts`, `tests/integration/replayWebMCPAdapter.test.ts` | Case/blob round-trip, Dexie index migration, malformed-record retention/recovery, newest-valid load, unreadable-record overwrite protection, compare-and-swap/BroadcastChannel behavior, plus staged adapter save/commit/compensation, semantic-intent idempotency, version/activity invariants, and author filtering before result limits. Runtime corrupt-blob rejection remains implemented source behavior rather than a directly exercised database test. |
| Components                        | `tests/components/*.test.{ts,tsx}`                                                    | Timeline behavior, app load recovery, onboarding progress, guide/tour rendering, evidence annotation-link control, and packaged evidence-source asset path/size/SHA-256 checks.                                                                                                                                                                                                                                                                                |
| WebMCP registry                   | `tests/webmcp/registry.test.ts`                                                       | Nineteen-tool inventory/schema/annotations, lifecycle, session-versus-canonical audit, proposal routing, cancellation, reconciliation, direct execution, and fallback.                                                                                                                                                                                                                                                                                         |
| Browser regressions               | `tests/e2e/*.spec.ts`                                                                 | Core workflows plus optional onboarding, manual/WebMCP guidance, path creation and point editing, vehicle movement/rotation, pointer ownership and overlap routing, proposals, exact editors, issue focus, human overrides, finalized JSON/PDF, persisted demo reset, dialog focus behavior, 320px reflow, axe checks, and frame blocking.                                                                                                                     |

**Historical baseline:** commit `f980d28` recorded passing lint/typecheck/build, **53/53 Vitest tests across 6 files**, and **32/32 Playwright runs in 17.1 seconds** across desktop/mobile Chromium. That result predates the current schema-v2/proposal release.

### Current deployed release result

Application commit `00688d8a51fb783dbf147e08ece60470b8877544` completed the clean local sequence and then passed GitHub Actions run `33161848637` on **2026-08-28**:

| Check                | Result                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| Runtime/dependencies | Node.js floor **22.13**; `npm ci` installed **287 packages** with no deprecation warnings           |
| Dependency audit     | **0 vulnerabilities**                                                                               |
| Formatting/lint      | Prettier passed; ESLint passed with **0 warnings**                                                  |
| Typecheck/build      | Strict TypeScript and the production build passed                                                   |
| Vitest               | **136/136 passed across 15 files**                                                                  |
| Coverage             | Statements **52.67%**; branches **41.53%**; functions **49.55%**; lines **54.77%**                  |
| Playwright           | **108** project runs: **103 passed**, **5 intentional mobile screenshot-owner skips**, **0 failed** |
| Visual regression    | **10** checked screenshot baselines                                                                 |
| Diff integrity       | `git diff --check` passed                                                                           |

The dependency install followed upgrades to `eslint` 10.9.1, `@eslint/js` 10.0.1, and `eslint-plugin-react-hooks` 7.1.1, plus the addition of self-hosted Inter 5.3.0 for cross-platform typography. Verify job `98817932649` independently passed dependency installation, formatting, lint, typecheck, Vitest, Playwright, and the production build; deploy job `98818739202` published Pages deployment `6139340101`. Public artifact/browser/Lighthouse evidence is recorded below and in [test-report.md](test-report.md). Native Site Tools execution/supported-model traces, manual screen-reader/cross-browser review, complete WCAG conformance, YouTube publication, header-capable-origin verification, and downloaded-file fidelity remain separate gates.

## End-to-end coverage

Playwright is configured for 1440 × 900 Chromium and a Pixel 7-sized mobile project. The 2026-08-28 clean local run collected 108 project runs: 103 passed, 5 intentional mobile screenshot-owner skips, and 0 failed; CI repeated the same 103/5/0 outcome. The release scenarios cover the historical core plus:

1. landing contract, both start actions, and the optional guide entry point;
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
14. checked visual-regression baselines for the judge-facing landing/workspace/report states;
15. axe analysis of landing and blank wizard; and
16. axe analysis of workspace and finalization dialog;
17. 320px reflow and skip-link behavior;
18. timeline, WebMCP, evidence-deletion, review, and confirmation dialog focus/Escape/restoration behavior;
19. preview-only coordinated proposals followed by explicit human acceptance;
20. exact numeric editors for scene/path/event geometry;
21. real consistency-issue focus and affected-ID highlighting;
22. explicit human-override correlation that preserves the original agent mutation;
23. parseable finalized JSON and non-empty PDF download; and
24. saved-demo resume, explicit reset, and iframe/tool-registration blocking;
25. the six-step workspace tour, standalone guide, manual/WebMCP explanation, responsive presentation, and focus restoration; and
26. path creation and a sixth point, selected-point dragging beneath vehicles, lane-snap behavior, direct rotation, impact-placement priority, nearest-vehicle routing at 320px, and secondary-pointer isolation.

Full local user-evidence upload/delete/reload, raw-recovery handling, downloaded SVG/PNG visual fidelity, screen readers, broader multi-touch/device coverage, and a cross-client WebMCP matrix remain explicit manual gates below. Automated dialog and scene-pointer regressions exist, but assistive-technology behavior still requires manual review. The ordinary-browser portion of the public smoke below is not native Site Tools; the separate Codex in-app-browser run establishes discovery only, and neither is a probabilistic model-eval pass. The repository includes ten checked `toHaveScreenshot` visual-regression baselines across the required desktop/mobile dimensions; they are automated layout evidence, not a substitute for manual visual review.

## Deterministic demo fixture

Use `case-demo-roundabout` from `src/domain/seed.ts` for automated and manual journeys. The current fixture has `seedVersion = 3`; schema v2 deliberately accepts saved positive seed versions through 3 for resume compatibility.

Reset methods:

- use a fresh browser origin with no saved demo;
- use **Case options → Reset deterministic demo**; or
- call `createDemoCase()` in an isolated deterministic test.

Opening `/#demo` resumes a valid saved seed-v1, seed-v2, or seed-v3 demo case when present; navigation alone is not a reset. An explicit reset replaces it with seed v3.

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
6. If the browser exposes `getTools()` and `executeTool()`, directly run `get_case_summary` with `{}` and confirm no case-version, canonical activity, or persistence mutation. A session-only invocation audit entry is expected.
7. Run `validate_case_consistency` and confirm it returns the seeded issue without changing facts.
8. Directly execute a versioned test mutation through a test fixture, then confirm its staged case is compare-and-swap saved before the live engine commits/notifies; verify persisted state, engine state, activity, and the compact result agree. Record browser-paint timing separately.
9. Repeat an already completed request with the same semantic intent and verify `idempotent: true`, the original receipt `caseVersion`, no new save/activity, and no mutation-pause rejection. Reuse its request ID for different intent and verify `IDEMPOTENCY_CONFLICT` with no state change.
10. Abort an invocation before primary persistence begins and verify no case version, persistence, canonical/session activity, or visible committed geometry changes; the working state must clear. A cancellation while a real save is pending, successful compensation, and compensation failure remain separate controlled fault-injection/browser gates.
11. Navigate away/close the workspace and verify lifecycle registrations disappear.

Use a disposable demo fixture for direct mutation tests. Never use personal evidence.

## ChatGPT/Codex Site Tools test

Use a deployed HTTPS URL because that is the submission environment. At the source-of-truth date, the official OpenAI Site Tools documentation lists GPT-5.6 Sol and GPT-5.6 Terra as supported and notes rollout/workspace limitations; recheck before the final run.

The public URL serves application commit `00688d8a51fb783dbf147e08ece60470b8877544`. Record the exact browser/client/model and confirm native `document.modelContext` before calling any result Site Tools evidence.

1. Open [https://artem-musii.github.io/replay-sol/#demo](https://artem-musii.github.io/replay-sol/#demo) in the desktop app’s built-in browser.
2. Confirm REPLAY’s page status says Site Tools available.
3. Ask the four prompts in [demo-script.md](demo-script.md) without naming internal tools.
4. Capture tool names, arguments, order, results, case versions, activity IDs, and visible UI effects.
5. Verify the agent reads recent activity after the human correction and does not restore its older geometry.
6. Verify both hypotheses remain alternatives, shared damage stays unchanged, and no fault conclusion appears.
7. Verify the agent builds and opens the report preview but does not complete finalization. OpenAI's current client does not expose declarative HTML form tools as Site Tools. It may still use ordinary browser capabilities, but those interactions are not WebMCP calls and must not operate the human-only acknowledgements or final confirmation. Verify the native declarative form lifecycle separately in compatible Chrome.
8. Reset and repeat every scenario in `evals/webmcp-evals.json` at least five times per currently supported target model, recording exact model/client/build/commit.

The machine-readable eval suite and scoring rules are documented in [webmcp-evals.md](webmcp-evals.md). **Historical native evidence only:** a 2026-08-27 `f980d28` public smoke discovered its then-current 17-tool baseline, called `get_case_summary`, visibly added/reverted an observation, transitioned to 18 tools after report preview, verified the non-autosubmitting form, and restored a blank case after reload.

**Current live contract smoke:** a fresh public session opened the optional guide and WebMCP explanation, loaded the seed-v3 demo with Vehicle A at 146°, rotated it through the visible UI to 161°, added a sixth trajectory point, and verified the new uncertainty explanation remained visible. The run observed zero console warnings/errors, failed requests, or off-origin requests. This is ordinary-browser/manual-fallback evidence. A separate current Codex in-app-browser smoke surfaced all 18 baseline tools and the visible `18 registered` state without invoking one; native execution and supported-model results remain pending. Do not publish either smoke as an aggregate model-eval rate or hide any safety failure.

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
6. Verify rejected, stale, and locked calls add no canonical mutation activity or content change but do leave a session-only failed-invocation entry. Cancellation before primary persistence begins leaves both audit layers unchanged; a post-save cancellation must compensate or surface/audit `PERSISTENCE_FAILED`. A repeated completed request with the same semantic intent must return `idempotent: true` at the original receipt version without another save, while different intent under that ID must return `IDEMPOTENCY_CONFLICT`.
7. Check deployed response headers with:

```bash
curl -sS -D - -o /dev/null https://artem-musii.github.io/replay-sol/
```

The response must be HTTPS. GitHub Pages does not consume `public/_headers`, so its live response lacks the intended `Permissions-Policy`, origin isolation, CSP, frame restriction, content-type, and referrer response policies. The document mitigates representable policies with CSP/no-referrer meta elements, and the app refuses to render/register tools while framed, but neither replaces response headers. GitHub Pages also scopes IndexedDB to the shared `artem-musii.github.io` origin, not `/replay-sol/`; test there only with synthetic/non-sensitive data. Use a dedicated origin on Cloudflare Pages, Netlify, or another header-capable host when the complete response/privacy contract is required. Hash fragments are client-side and are not sent to the server, so header checks target `/`.

## Performance and visual verification

- Record interaction responsiveness while dragging, scrubbing, playing at 2×, and overlaying two branches.
- Current `00688d8a51fb783dbf147e08ece60470b8877544` evidence: Lighthouse 13.4.1 audited the public `#demo` at **100 performance, 100 accessibility, 100 best practices, and 100 SEO**, with FCP 503.479 ms, LCP/TTI 623.479 ms, Speed Index 745.184 ms, TBT 0 ms, and CLS 0. The report SHA-256 is `7c903b69675faa5e70283876434cca6da501a56d8c44d058706c5c90262714e4`; the evidence boundary and metrics are retained in [test-report.md](test-report.md).
- Historical `f980d28` local/public Lighthouse evidence remains preserved but is not substituted for the current audit.
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
