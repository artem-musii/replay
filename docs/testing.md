# Testing REPLAY

Last source/test inventory reconciliation in this document: **2026-08-29**, Node.js 22.13+ toolchain. This guide distinguishes deterministic code tests, manual browser verification, and probabilistic agent evals. A result in one category is never presented as proof of another.

## Release command sequence

From a clean checkout:

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npx playwright install chromium firefox webkit
npm run test:e2e
VITE_BASE_PATH=/replay-sol/ npm run build
REPLAY_EXPECT_BASE_PATH=/replay-sol/ npm run verify:artifact:clean
npm audit --audit-level=moderate
npm audit --omit=dev --audit-level=moderate
git diff --check
```

Run the sequence against the exact commit to deploy. Do not reuse results from a dirty tree or a different dependency lockfile. If any command fails, record the failure and do not describe the release gate as passing.

Useful development commands:

```bash
npm run test:watch
npm run test:coverage
npm run preview
```

The Playwright command builds and serves `dist/` at `http://127.0.0.1:4173` automatically. The complete interaction suite runs in desktop/mobile Chromium; `release-smoke.spec.ts` additionally runs in Firefox and WebKit. Set `REPLAY_E2E_BASE_PATH=/replay-sol/`, `VITE_BASE_PATH=/replay-sol/`, and `REPLAY_E2E_SKIP_BUILD=true` to boot an already-built Pages-subpath artifact instead of rebuilding it.

## Current deterministic coverage

| Area                              | Test location                                                                                                                         | What is covered                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema and deterministic seed     | `tests/domain/schema-seed.test.ts`                                                                                                    | Runtime/cross-reference validation, schema-v2 migration/import behavior, deterministic reset, seeded certainty/evidence/issues.                                                                                                                                                                                                                                                                                                                                                       |
| Command engine                    | `tests/domain/engine.test.ts`                                                                                                         | Canonical mutations, versions/idempotency/locks, human-only boundaries, explicit override correlation, undo/redo, and safe agent-action reversion.                                                                                                                                                                                                                                                                                                                                    |
| Human completeness attestations   | `tests/domain/completeness-attestations.test.ts`                                                                                      | UI-only authorization; state-bound no-evidence, per-actor unknown/not-assessed damage, and uncertainty-review records; stale-state/import/undo trust behavior; `attested` report citations; and legitimate no-evidence finalization.                                                                                                                                                                                                                                                  |
| Coordinated proposals             | `tests/domain/agent-proposals.test.ts`                                                                                                | Agent-only proposal creation, preview isolation, human adjustment/accept/reject, stale/locked all-or-nothing acceptance, and unsigned-import trust reset.                                                                                                                                                                                                                                                                                                                             |
| Hypotheses, evidence, and reports | `tests/domain/hypotheses-evidence-report.test.ts`                                                                                     | Branch comparison, annotation/assumption links, structured transfer references, workspace-path citations, report requirements, note review, and snapshots.                                                                                                                                                                                                                                                                                                                            |
| Geometry and consistency          | `tests/domain/interpolation-consistency.test.ts`                                                                                      | Pose interpolation, rotation, clamping, trajectory/impact geometry, and deterministic timing/provenance/completeness rules.                                                                                                                                                                                                                                                                                                                                                           |
| Persistence and real adapter      | `tests/persistence/database.test.ts`, `tests/persistence/evidenceValidation.test.ts`, `tests/integration/replayWebMCPAdapter.test.ts` | Case/blob round-trip, Dexie index migration, malformed-record retention/recovery, newest-valid load, unreadable-record overwrite protection, evidence signature/decode/size/hash checks, stored-blob metadata/checksum rejection, compare-and-swap/BroadcastChannel behavior, plus staged adapter save/commit/compensation, semantic-intent idempotency, version/activity invariants, and author filtering before result limits.                                                      |
| Components                        | `tests/components/*.test.{ts,tsx}`                                                                                                    | Timeline behavior, app load recovery, onboarding progress, guide/tour rendering, completeness review, exact impact-pair controls, evidence relationship unlink controls, provenance-safe observation source selection, and packaged evidence-source asset path/size/SHA-256 checks.                                                                                                                                                                                                   |
| WebMCP registry                   | `tests/webmcp/registry.test.ts`                                                                                                       | Nineteen-tool inventory/schema/annotations, lifecycle, session-versus-canonical audit, proposal routing, cancellation, reconciliation, direct execution, and fallback.                                                                                                                                                                                                                                                                                                                |
| Browser regressions               | `tests/e2e/*.spec.ts`                                                                                                                 | Core workflows plus optional onboarding, manual/WebMCP guidance, path creation and point editing, vehicle movement/rotation, pointer ownership and overlap routing, proposals, exact editors, issue focus, human overrides, finalizable no-evidence review, stable local-case routing/listing, exact multi-vehicle impact-pair placement, finalized JSON/PDF, unique-run demo switching/resume, impact playback, dialog focus behavior, 320px reflow, axe checks, and frame blocking. |

### Current-source local candidate result

The merged working tree completed the following local matrix on **2026-08-29**. It must still be repeated from a frozen clean commit in CI before becoming release evidence.

| Check                   | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting/lint         | Prettier passed; ESLint passed with **0 warnings**                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Typecheck               | Strict TypeScript passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Vitest                  | **457/457 passed across 37 files** on the declared Node **22.13.0** runtime                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Coverage                | Statements **63.81% (6,765/10,601)**; branches **54.21% (4,479/8,261)**; functions **61.89% (1,624/2,624)**; lines **65.88% (6,262/9,504)**                                                                                                                                                                                                                                                                                                                                                                                |
| Domain/demo/physics     | Statements: domain **84.99%**; `demoScenarios.ts` **99.46%**; physics **95.47%**; integration **84.68%**; WebMCP **89.78%**                                                                                                                                                                                                                                                                                                                                                                                                |
| Playwright              | **230** project runs: **221 passed**, **9 intentional mobile screenshot-owner skips**, **0 failed**                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Browser split           | Desktop Chromium **114/114**; mobile Chrome **105 passed + 9 skipped**; Firefox smoke **1/1**; WebKit smoke **1/1**                                                                                                                                                                                                                                                                                                                                                                                                        |
| Focused artifact matrix | Exact configured-base candidate artifact: **12/12**—release/high-speed/impact **8/8**, handler contract **2/2**, and submission story **2/2** on desktop and mobile                                                                                                                                                                                                                                                                                                                                                        |
| Handler-contract read   | Exact configured-base artifact with the deterministic E2E imperative `document.modelContext` polyfill: **18** lifecycle-eligible registrations without churn; all **8** sections including `selection: null`; **18,970 / 32,768-byte compact target**, with a **524,288-byte hard cap**; case v1 unchanged                                                                                                                                                                                                                 |
| Visual regression       | **20** checked screenshot baselines                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Lighthouse              | Exact configured-base artifact, Lighthouse 13.4.1/Chrome 151, three successful runs per profile: mobile performance **89/91/90**, with **100/100/100** accessibility/best-practices/SEO on every run, median performance **90**, median FCP **2.032 s**, LCP **3.308 s**, TBT **17 ms**, CLS **0.00004**, Speed Index **2.032 s**, and TTI **3.308 s**; desktop **100/100/100/100** on every run, with median FCP **0.445 s**, LCP **0.686 s**, TBT **0 ms**, CLS **0.0149**, Speed Index **0.529 s**, and TTI **0.686 s** |
| Dependencies            | Full and production-only audits reported **0 vulnerabilities**; `npm ls --all` resolved cleanly                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Production artifacts    | Root: **46 public payload files / 5,295,427 bytes**, plus `.nojekyll`, manifest SHA-256 `0544048ef3d96a43683393dd5f3be4d2fdd8f169739334a18636ee1d6d833025`; `/replay-sol/`: **46 / 5,295,823 bytes**, plus `.nojekyll`, SHA-256 `1b4063e0d1a78f691ed78729db5004c017f2f1ae20d7cc2677845e943d7ba9b5`                                                                                                                                                                                                                         |
| Diff integrity          | `git diff --check` passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Clean-tree release gate | Intentionally fails while the candidate remains an uncommitted working tree; rerun from the frozen commit before release                                                                                                                                                                                                                                                                                                                                                                                                   |

**Historical baseline:** commit `f980d28` recorded passing lint/typecheck/build, **53/53 Vitest tests across 6 files**, and **32/32 Playwright runs in 17.1 seconds** across desktop/mobile Chromium. That result predates the current schema-v2/proposal release.

### Current deployed release result

Application commit `2855f0bc50da2916128b2278a46f0d0a8a4e2bbd` passed GitHub Actions run `33184281134` and was deployed on **2026-08-29**:

| Check                 | Result                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| Verify/build job      | `98893121004`, successful                                                                           |
| Formatting/type/build | The configured clean-release formatting, lint, strict typecheck, and production-build gates passed  |
| Vitest                | **196/196 passed across 20 files**                                                                  |
| Playwright            | **114** project runs: **109 passed**, **5 intentional mobile screenshot-owner skips**, **0 failed** |
| Deploy job            | `98894240126`, successful                                                                           |
| Pages deployment      | `6143728209`, successful                                                                            |
| Pages artifact        | `9691136611`; **3,032,328 compressed bytes**                                                        |
| Artifact SHA-256      | `27c2bf89662de9280ddca52f9d2cb922545a913a27f819b855110f184e924da9`                                  |
| Live payload          | **43 files / 4,248,606 bytes**, all byte-matched                                                    |
| Payload manifest hash | `6eb13acc1eec75d60298a3979009a175e2ba94bc8e9ad00382d4a274bdcc6ba4`                                  |

The 43-file result is an independent 2026-08-29 comparison of the downloaded Pages artifact with cache-busted public paths. The deployed commit predates the current automated `release-evidence.json` and `verify-deployment` workflow gate, so the live evidence endpoint is absent; the next frozen release must exercise that new gate before it is credited.

Formal exact-deployment ChatGPT native Site Tools traces, a current public product-browser smoke, manual screen-reader/real-Safari review, complete WCAG conformance, YouTube publication, header-capable-origin verification, and platform-native export review remain separate gates.

**Superseded deployed result:** commit `00688d8a51fb783dbf147e08ece60470b8877544` passed **136/136 Vitest tests across 15 files** and **108 Playwright runs: 103 passed, 5 intentional skips, 0 failed** before Pages deployment `6139340101`. Its 2026-08-28 coverage, artifact, browser, and Lighthouse record remains preserved in [test-report.md](test-report.md) and [deployment.md](deployment.md); it is historical evidence, not a current-release result.

## End-to-end coverage

Playwright is configured for the complete suite at 1440 × 900 Chromium and a Pixel 7-sized mobile project. A bounded release journey also runs at 1440 × 900 in Firefox and Playwright WebKit: it boots the configured static-host base, checks same-origin packaged images and runtime errors, parses and renders the self-contained 1600 × 1280 review SVG, and decodes its 3200 × 2560 PNG. Export bytes are attached to Playwright results for inspection. The settled dirty current-source run completed 230 project runs: 114/114 desktop Chromium, 105 passing plus 9 intentional screenshot-owner skips in mobile Chrome, and 1/1 release smoke in both Firefox and WebKit, for 221 passed, 9 skipped, and 0 failed overall. The exact already-built configured-base candidate artifact passed a separate **12/12** focused matrix through the CI-equivalent skip-build path: 4/4 release smoke across desktop Chromium, mobile Chrome, Firefox, and WebKit, 2/2 high-speed, and 2/2 impact journeys, plus the handler contract 2/2 and submission story 2/2 on desktop/mobile. The handler contract is a complete eight-section, mutation-free read under the deterministic imperative `document.modelContext` polyfill; the submission story is a coherent Site Tools-to-human-finalized-PDF journey. These are later dirty local-candidate results, not deployment evidence; the deployed `2855f0bc` CI result remains the separately scoped 109/5/0 outcome above. The current scenarios cover the historical core plus:

1. landing contract, both start actions, and the optional guide entry point;
2. deterministic demo scene, time, and provenance;
3. synchronized timeline scrubbing and playback geometry;
4. explicit human-only confirmation;
5. a WebMCP-polyfilled agent observation remaining visibly hypothetical and non-confirmable;
6. all four generated demo evidence assets and synthetic provenance;
7. point/rectangle evidence annotation creation and removal;
8. hypothesis fork and non-conclusive visual comparison;
9. report preview, four acknowledgements including labelled unconfirmed/hypothesis content, declarative-form attributes, second confirmation, and cancellation;
10. blank-case wizard certainty behavior;
11. blank-case path/event/impact/damage authoring, exact actor-pair contact placement in multi-vehicle cases, and lock enforcement;
12. local persistence and restoration after reload;
13. complete manual fallback when WebMCP is absent;
14. source-required photo/document observations, human-only relationship unlinking without deleting the evidence asset, and a cancel-first structured-transfer trust-reset review;
15. checked visual-regression baselines for the judge-facing landing/workspace/report states;
16. axe analysis of landing and blank wizard; and
17. axe analysis of workspace and finalization dialog;
18. 320px reflow and skip-link behavior;
19. timeline, WebMCP, evidence-deletion, review, and confirmation dialog focus/Escape/restoration behavior;
20. preview-only coordinated proposals followed by explicit human acceptance;
21. exact numeric editors for scene/path/event geometry;
22. real consistency-issue focus and affected-ID highlighting;
23. explicit human-override correlation that preserves the original agent mutation;
24. parseable finalized JSON and structurally complete PDF downloads, retained as inspectable test attachments; and
25. stable `#case/<encoded-case-id>` resume, landing-page local-case listing, fresh-copy isolation, unavailable-route handling, and iframe/tool-registration blocking;
26. the six-step workspace tour, standalone guide, manual/WebMCP explanation, responsive presentation, and focus restoration; and
27. path creation and a sixth point, selected-point dragging beneath vehicles, lane-snap behavior, direct rotation, impact-placement priority, nearest-vehicle routing at 320px, and secondary-pointer isolation;
28. exact impact contact plus authored pre/post speed and course readouts, bounded playback through the impact window, and the non-simulation disclaimer; and
29. unique-run scenario switching that preserves the earlier run and supports browser Back restoration; and
30. cross-engine packaged-asset loading plus parseable/renderable SVG and decodable PNG export under the release CSP and configured static-host base path;
31. exact branch ownership indexes, duplicate actor/branch trajectory rejection, and proposal acceptance races that cannot split rendered paths from interpolation or physics; and
32. duplicate-free reciprocal marker/evidence, marker/claim, claim/evidence, and event/evidence provenance across add/update/delete/fork paths, strict imports/new saves, deterministic audited repair of the narrow released local-vault defects, and human-only completeness records that become stale after relevant state changes or unsigned import and can make a legitimate no-evidence case finalizable after fresh review.

Automated Chromium journeys now cover local evidence upload/delete/reload durability, failed-save and failed-delete retention/retry behavior, case-switch gating, navigation restoration, multi-tab conflict paths, keyboard annotation interaction, dialog focus/scroll locking, and exact export structure. Physical screen-reader review, shipping Safari and real-device behavior, broader multi-touch/file-picker coverage, the raw-recovery UI journey, cross-profile stress, platform-native export-reader review, and a cross-client WebMCP matrix remain explicit manual or external gates below. The candidate SVG/PNG passed parse, render, dimension, portable-color, and non-black-pixel checks; the PNG was visually reviewed, and all four PDF pages were rendered with Poppler and visually checked for color, clipping, overlap, orphan headings, and pagination. Playwright WebKit is useful engine coverage but is not a claim about every shipping Safari integration. Automated dialog and scene-pointer regressions exist, but assistive-technology behavior still requires manual review. An uncoached GPT-5.6 Sol local Codex in-app-browser run selected and invoked the current-source tools successfully, but it is not the exact deployed commit in ChatGPT desktop's native Site Tools runtime and receives no formal model-eval score. The repository includes 20 checked `toHaveScreenshot` visual-regression baselines across the required desktop/mobile dimensions, including the impact-review, Site Tools guide, report-preview, and finalization compositions; they are automated layout evidence, not a substitute for manual visual review.

## Deterministic demo fixture

Use `case-demo-roundabout` from `src/domain/seed.ts` for automated and manual journeys. The current fixture has `seedVersion = 6`; schema v2 deliberately accepts saved positive seed versions through 6 for resume compatibility.

Reset methods:

- open bare `/#demo`, which creates a fresh unique roundabout run and rewrites the URL to that run's stable `#case/<encoded-case-id>` hash;
- use **Case options → Start fresh demo copy** for the active scenario; or
- call `createDemoCase()` in an isolated deterministic test.

Landing scenario cards and the in-workspace scenario switcher also create unique seed-v6 runs and leave earlier runs intact. The landing page lists retained runs under **Your local cases**. A saved run resumes only from its stable route in the same browser origin/profile; an unavailable route must show recovery guidance rather than silently opening another case. The schema continues to accept valid legacy seed-v1 through seed-v6 records for that resume path.

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
5. For a disposable blank case with no evidence/damage markers/questions, use **Completeness review** to record no evidence supplied, damage unknown or not assessed for every actor, and uncertainty review complete. Confirm the report labels these items **Human attestation**, then open final review, test cancellation, and finalize manually. Change one relevant evidence/damage/question input and verify the associated record becomes stale; an unsigned import must require fresh local review.
6. Export JSON, PDF, scene SVG, and scene PNG; open every downloaded file.
7. Reload and verify the latest case persists without a network request.
8. Return home, reopen retained cases from **Your local cases**, and verify their stable routes; then reset the demo and confirm seeded state is restored.

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

The public URL serves application commit `2855f0bc50da2916128b2278a46f0d0a8a4e2bbd`. Record the exact browser/client/model and confirm native `document.modelContext` before calling any result Site Tools evidence.

1. Open [https://artem-musii.github.io/replay-sol/#demo](https://artem-musii.github.io/replay-sol/#demo) in the desktop app’s built-in browser.
2. Confirm REPLAY’s page status says Site Tools available.
3. Ask the four prompts in [demo-script.md](demo-script.md) without naming internal tools.
4. Capture tool names, arguments, order, results, case versions, activity IDs, and visible UI effects.
5. Verify the agent reads recent activity after the human correction and does not restore its older geometry.
6. Verify both hypotheses remain alternatives, shared damage stays unchanged, and no fault conclusion appears.
7. Verify the agent builds and opens the report preview but does not complete finalization. OpenAI's current client does not expose declarative HTML form tools as Site Tools. It may still use ordinary browser capabilities, but those interactions are not WebMCP calls and must not operate the human-only acknowledgements or final confirmation. Verify the native declarative form lifecycle separately in compatible Chrome.
8. Reset and repeat every scenario in `evals/webmcp-evals.json` at least five times per currently supported target model, recording exact model/client/build/commit.

The machine-readable eval suite and scoring rules are documented in [webmcp-evals.md](webmcp-evals.md). **Historical native evidence only:** a 2026-08-27 `f980d28` public smoke discovered its then-current 17-tool baseline, called `get_case_summary`, visibly added/reverted an observation, transitioned to 18 tools after report preview, verified the non-autosubmitting form, and restored a blank case after reload.

**Superseded `00688d8a` live contract smoke:** a fresh public session opened the optional guide and WebMCP explanation, loaded the seed-v3 demo with Vehicle A at 146°, rotated it through the visible UI to 161°, added a sixth trajectory point, and verified the new uncertainty explanation remained visible. The run observed zero console warnings/errors, failed requests, or off-origin requests. This is historical ordinary-browser/manual-fallback evidence for that exact release. A separate Codex in-app-browser smoke surfaced its 18 baseline tools and the visible `18 registered` state without invoking one. Neither result is attributed to `2855f0bc`; exact-current-deployment native execution and supported-model results remain pending. Do not publish any smoke as an aggregate model-eval rate or hide any safety failure.

**Current-source local runtime smoke (2026-08-28):** a fresh in-app-browser session executed the page-defined `get_case_summary`, `get_workspace_state`, `validate_case_consistency`, `focus_workspace_item`, and `build_report_preview` tools against a disposable seed-v6 run. It verified the 18→19 lifecycle, live selection after focus, unchanged case v1 and no durable factual activity for session focus, visible report review with human-only finalization, exact contact at 10.0 s, separated authored positions at 16.0 s, desktop and 390 px reflow without horizontal overflow, and no console warnings/errors. This confirms the local page/runtime contract; it is not evidence that a supported model independently chose the tools, and it is not deployed-release evidence.

**Current exact-artifact native bridge smoke (2026-08-29):** the dirty local 46-payload `/replay-sol/` artifact at 5,295,823 bytes with manifest SHA-256 `1b4063e0d1a78f691ed78729db5004c017f2f1ae20d7cc2677845e943d7ba9b5` exposed 18 page-defined Site Tools in the Codex in-app browser. An operator invoked `get_case_summary`, `get_workspace_state` for scene/questions, all-scope `validate_case_consistency`, and `focus_workspace_item` for `question-lane-change`. All four returned `ok: true` at v1; validation returned exactly one issue, `integrity.calibration-source`; focus visibly opened the blocking question; and the activity panel showed one durable seed change plus four **Session only** entries, each labelled **No case change · observed v1**. Browser runtime logs had no warning or error. A direct UI playback check on the same artifact paused once at 10.0 s, then advanced beyond 11.7 s and kept playing after one Play click. This proves native bridge execution and visible UI/session-audit agreement for the exact local artifact. It does not inspect a main-world `document.modelContext` constructor, exercise mutation/lifecycle behavior, establish supported-model choice, capture **Recently used/Sources**, or prove a clean commit, deployment, or cross-client behavior.

**Earlier pre-polish native Chrome smoke (2026-08-29):** the 45-payload `/replay-sol/` artifact at 5,229,846 bytes with manifest SHA-256 `356be07e17a995608cfd558c685ba1fc9bf582b2f2fd530a9644604a8f2bd6ee` exposed a native main-world `ModelContext` and 18 tools with no console warning or error. In case `case-demo-roundabout-calibrated-run-9cd0d1c1-c522-4e01-9d23-e10c88f92810`, an operator invoked the four-call judge opening: scene/questions read, all-scope validation, blocking-question focus, then request `native-current-final-20260829-1` for a two-keyframe review proposal. The first three calls stayed session-only at v1; validation returned exactly one question, `integrity.calibration-source`; the pending proposal alone created v2; and the visible human UI rejected it at v3. A subsequent native read found no proposal and confirmed Vehicle A/B's original 8,000 ms poses remained unchanged. This remains historical main-world constructor, mutation, and human-gate evidence for that earlier artifact only.

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
- Current exact-artifact dirty local production-preview evidence comes from Lighthouse 13.4.1 with Chrome 151 and three warning-free runs per profile: mobile performance was **89/91/90**, with **100 accessibility, 100 best practices, and 100 SEO** on every run, median performance **90**, and median FCP 2.032 s, LCP 3.308 s, TBT 17 ms, CLS 0.00004, Speed Index 2.032 s, and TTI 3.308 s; every desktop run scored **100/100/100/100**, with median FCP 0.445 s, LCP 0.686 s, TBT 0 ms, CLS 0.0149, Speed Index 0.529 s, and TTI 0.686 s. These are local lab measurements, not field data or deployed-release evidence.
- Superseded `00688d8a51fb783dbf147e08ece60470b8877544` evidence: Lighthouse 13.4.1 audited its public `#demo` at **100 performance, 100 accessibility, 100 best practices, and 100 SEO**, with FCP 503.479 ms, LCP/TTI 623.479 ms, Speed Index 745.184 ms, TBT 0 ms, and CLS 0. The report SHA-256 is `7c903b69675faa5e70283876434cca6da501a56d8c44d058706c5c90262714e4`; the historical evidence boundary and metrics remain in [test-report.md](test-report.md). No Lighthouse result is yet attributed to `2855f0bc`.
- Historical `f980d28` local/public Lighthouse evidence remains preserved but is not substituted for the current audit.
- Confirm no broken generated image, layout shift, clipped focus ring, unreadable status, or horizontal overflow at 1440 × 900, 1024 × 768, 390 × 844, and 200% zoom.
- Inspect the five generated images for the criteria in [generated-assets.md](generated-assets.md).
- Check the console for errors, unhandled rejections, hydration warnings, missing assets/source maps affecting users, and failed requests.
- Search production paths for placeholders and TODOs:

```bash
rg -n "TODO|FIXME|PLACEHOLDER|example\.com|ADD VERIFIED|ADD PUBLIC|<live-app-url>|<deployment-host>|BLOCKED — replace" src public index.html README.md docs
```

The published app and repository must have no remaining placeholders. Before the video is recorded, the only intentional placeholder matched by this search is the explicit **BLOCKED — replace this line with the final public YouTube URL** entry in the Devpost draft. Replace it before submission, then require the search above to return no unexplained result. The separate clean-tree, deployment, and native supported-model release gates remain in force even though they are not placeholder strings.

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
