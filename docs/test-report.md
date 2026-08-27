# REPLAY release test report

- Release date: **2026-08-28**
- Application commit: [`df599f37e59e562ffaee919fdc4072eec9265f51`](https://github.com/artem-musii/replay-sol/commit/df599f37e59e562ffaee919fdc4072eec9265f51)
- Public application: [https://artem-musii.github.io/replay-sol/](https://artem-musii.github.io/replay-sol/)

This report distinguishes deterministic source/CI evidence, public artifact verification, ordinary live-browser behavior, an injected WebMCP contract harness, and still-unrun native client/model/manual checks. Evidence in one category is not presented as proof of another.

## Exact workflow and artifact

[GitHub Actions run `33125071538`](https://github.com/artem-musii/replay-sol/actions/runs/33125071538) completed successfully for the application commit.

| Gate                           | Recorded result                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------- |
| Verify/build job               | `98701114804`, successful                                                         |
| Deploy job                     | `98701763882`, successful                                                         |
| Pages deployment               | `6132593328`, successful                                                          |
| Pages artifact                 | `9668071269`, 2,994,535 bytes                                                     |
| Artifact SHA-256               | `b35ee8311e9f94928ff3fc1a38e93d4d77282271874bb7481d2bae8cd4e9b8c4`                |
| `npm ci`                       | **287 packages**, no deprecation warnings; audit **0 vulnerabilities**            |
| Prettier / ESLint / TypeScript | Passing; lint **0 warnings**                                                      |
| Vitest                         | **119/119** across **14 files**                                                   |
| Coverage                       | Statements **52.9%**; branches **41.46%**; functions **49.43%**; lines **54.77%** |
| Playwright                     | **73 passed**, **5 intentional mobile screenshot-owner skips**, **0 failed**      |
| Visual baselines               | **9** checked screenshots                                                         |
| Production build / diff check  | Passing                                                                           |

The matching clean local gate produced the coverage figures above and completed all 78 Playwright project runs in 30.9 seconds. Before uploading the artifact, the workflow independently passed dependency installation, formatting, lint, typecheck, all 119 Vitest tests, the 73/5/0 Playwright outcome, and the production build.

## Public artifact verification

All 43 deployed files returned successfully and byte-matched Pages artifact `9668071269`, including the landing/404 documents, base-path bundles, metadata, current seed-v2 evidence images, and retained seed-v1 compatibility assets. Key public SHA-256 values were:

- cache-busted index: `42eb06ec840d3477ea6c18da952de6bc4807d4b90433e01723b4c3dfb689b581`;
- main JavaScript `index-Cki63kWO.js`: `a47e2b491b7887172709fd372ec16da8f0ec72595680a855b7cca84370652e31`; and
- stylesheet `index-DPk9q71M.css`: `a9469b787507d427a80504412adf092565077296178ea9f504d6a298ad8b0b57`.

An earlier workflow, `33124001324` for commit `54ccefcf0919be237916310dfb05b74dd3172ae3`, failed during verification before build/deploy. It is retained as a failed attempt and was never the public release.

## Live ordinary-browser verification

A fresh public browser session loaded the landing page and deterministic demo with:

- zero console errors and zero warnings;
- all observed requests returning 200;
- no off-origin requests;
- the bundled Inter font and all four current evidence images loading successfully; and
- no missing current asset.

An ordinary-UI observation advanced the case to version 2, showed **Saved locally**, and survived full navigation reload before explicit reset. In the separate WebMCP harness journey below, a cache-busted new-document navigation retained the durable tool-created observation at case version 2 with **Saved locally**, correctly cleared the transient report preview and injected registry, and exposed the client's native manual mode. The visible destructive reset confirmation then restored the seed-v2 fixture at case version 1, removed the audit observation, showed **Saved locally**, and left zero console errors/warnings.

This is evidence for current application load, same-origin networking, UI persistence/reload, and deterministic cleanup. It is not full manual cross-browser, assistive-technology, upload/delete/recovery, multi-tab, or export-fidelity evidence.

## Injected WebMCP contract smoke—not native Site Tools

The Playwright audit client exposed no native `document.modelContext`. A minimal standards-compatible registry was injected at runtime solely to execute the **deployed bundle's registration/tool contract**. This harness is not OpenAI Site Tools, native browser discovery, a supported-model evaluation, or declarative-form evidence.

The harness verified:

1. exactly 18 baseline imperative tools, including `propose_scene_changes`, with `untrustedContentHint: true` throughout and the expected boolean `readOnlyHint` values;
2. `get_case_summary` returned schema v2, four active evidence items, the expected certainty groups, and the seeded geometry warning without canonical mutation;
3. branch-scoped `add_observation` under request `live-audit-df599f3-002` succeeded at case version 2 and became visible/durable;
4. exact semantic replay returned the original activity/version with `idempotent: true` and no new version;
5. different intent under the same request ID returned `IDEMPOTENCY_CONFLICT` with no version increment;
6. a report preview built through the human UI produced the version-2 neutral report and raised the registry to 19 tools by adding `add_report_note` with `readOnlyHint: false` and `untrustedContentHint: true`;
7. a cache-busted new-document navigation preserved the durable observation at case version 2 with **Saved locally**, while correctly clearing the transient preview and injected registry; and
8. explicit visible UI reset removed the observation and restored the seed-v2 fixture at case version 1.

Native current-client Site Tools discovery/execution, supported-model traces, proposal/cancellation journeys, and compatible-Chrome declarative `toolactivated`/`toolcancel` remain separate gates.

## Public Lighthouse 13.4.1

The exact cache-busted audit URL was `https://artem-musii.github.io/replay-sol/?lighthouse=df599f37e59e562ffaee919fdc4072eec9265f51#demo`. It ran in Chrome 151.0.7922.175 at a 1350 × 940 desktop viewport with simulated 40 ms RTT, 10,240 Kbps throughput, and CPU ×1.

| Category / metric | Result     |
| ----------------- | ---------- |
| Performance       | **100**    |
| Accessibility     | **100**    |
| Best Practices    | **100**    |
| SEO               | **100**    |
| FCP               | 385.565 ms |
| LCP               | 505.565 ms |
| TBT               | 0 ms       |
| CLS               | 0          |
| Speed Index       | 565.156 ms |
| TTI               | 505.565 ms |

The report contained no binary audit failures, errors, warnings, or runtime error. Its SHA-256 is `dc66e723bd05dbda6ce2dad6d460a16d7507250305c395682d5b54b560f6f647`. These are lab measurements, not field data.

## Preserved historical baseline

Commit `f980d28` remains the immutable 2026-08-27 baseline: **53/53 Vitest tests across 6 files**, **32/32 Playwright project runs** across desktop/mobile Chromium, zero serious/critical axe findings in four states, public/local Lighthouse evidence, public persistence, and a direct then-native 17→18 Site Tools lifecycle smoke. It predates schema v2, proposals, CAS/recovery controls, the framing guard, and the current 19-tool inventory; it is not substituted for current release evidence.

## Remaining manual and external gates

- Run the eleven-scenario probabilistic matrix in each supported native Site Tools model/client and retain complete traces.
- Verify the current imperative lifecycle natively, and declarative activation/cancel in compatible Chrome.
- Complete screen-reader, cross-browser, 200% zoom, reduced-motion, upload/delete/reload, multi-tab, and downloaded PDF/JSON/SVG/PNG inspection.
- Deploy to a dedicated origin that honors `_headers` before making production-like response-policy/privacy claims; GitHub Pages ignores that file and shares its origin.
- Record and publish the public under-three-minute YouTube demo.

See [testing.md](testing.md) for repeatable procedures and evidence-boundary rules.
