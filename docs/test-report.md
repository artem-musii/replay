# REPLAY historical release test report

- Release date: **2026-08-28**
- Application commit: [`00688d8a51fb783dbf147e08ece60470b8877544`](https://github.com/artem-musii/replay-sol/commit/00688d8a51fb783dbf147e08ece60470b8877544)
- Public application: [https://artem-musii.github.io/replay-sol/](https://artem-musii.github.io/replay-sol/)

> **Historical evidence only.** This report is permanently scoped to superseded commit `00688d8a`; use [testing.md](testing.md) and [deployment.md](deployment.md) for the current deployed release.

This report distinguishes deterministic source/CI evidence, public artifact verification, ordinary live-browser and manual/WebMCP-guidance behavior, and still-unrun native execution, supported-model, and manual checks. Evidence in one category is not presented as proof of another.

## Exact workflow and artifact

[GitHub Actions run `33161848637`](https://github.com/artem-musii/replay-sol/actions/runs/33161848637) completed successfully for the application commit.

| Gate                           | Recorded result                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| Verify/build job               | `98817932649`, successful                                                          |
| Deploy job                     | `98818739202`, successful                                                          |
| Pages deployment               | `6139340101`, successful                                                           |
| Pages artifact                 | `9682041096`, 3,009,246 bytes                                                      |
| Artifact SHA-256               | `9fae713230ec290ca8255641b1d13c89d59b155041aa9a68403d3231caff645e`                 |
| `npm ci`                       | **287 packages**, no deprecation warnings; audit **0 vulnerabilities**             |
| Prettier / ESLint / TypeScript | Passing; lint **0 warnings**                                                       |
| Vitest                         | **136/136** across **15 files**                                                    |
| Coverage                       | Statements **52.67%**; branches **41.53%**; functions **49.55%**; lines **54.77%** |
| Playwright                     | **103 passed**, **5 intentional mobile screenshot-owner skips**, **0 failed**      |
| Visual baselines               | **10** checked screenshots                                                         |
| Production build / diff check  | Passing                                                                            |

The matching clean local gate produced the coverage figures above and completed all 108 Playwright project runs. Before uploading the artifact, the workflow independently passed dependency installation, formatting, lint, typecheck, all 136 Vitest tests, the 103/5/0 Playwright outcome, and the production build.

## Public artifact verification

All 43 deployed files returned successfully and byte-matched Pages artifact `9682041096`, including the landing/404 documents, base-path bundles, metadata, current seed-v3 evidence images, and retained seed-v1 compatibility assets. Key public SHA-256 values were:

- cache-busted index: `8c093e4ccd730ae8a55075c2f1039194ae77a0c237a81431d642f7a3ee302759`;
- referenced main JavaScript: `f1616816495d837a42c63709c468872abab4968bbc053ff91600f65f015a96af`; and
- referenced stylesheet: `c63c0bc237611e92a1c849984aa2ee777d6b26c5f99750ce15eeb74ff590efd1`.

An earlier workflow, `33124001324` for commit `54ccefcf0919be237916310dfb05b74dd3172ae3`, failed during verification before build/deploy. It is retained as a failed attempt and was never the public release.

## Live ordinary-browser verification

A fresh public browser session loaded the landing page, optional guide, WebMCP explanation, and deterministic seed-v3 demo with:

- zero console errors and zero warnings;
- all observed requests returning 200;
- no off-origin requests;
- the bundled Inter font and all four current evidence images loading successfully;
- no missing current asset;
- Vehicle A's seeded 146° heading rotating to 161° through the visible UI;
- a sixth trajectory point being added successfully;
- the new uncertainty explanation remaining visible; and
- landing help remaining reachable at 320 px and 200% text beneath a retained-recovery notice.

This is evidence for that historical release's application load, same-origin networking, guide/manual-WebMCP discoverability, seed-v3 scene editing, trajectory extension, uncertainty copy, and recovery-notice access to landing help. It is not a supported-model trace or full manual cross-browser, assistive-technology, upload/delete, multi-tab, persistence/reset, or export-fidelity evidence.

## WebMCP evidence boundary

That release's live smoke verified the public WebMCP explanation and that manual mode remained available, while deterministic tests exercised the registry and command contract. A separate Codex in-app-browser smoke surfaced all 18 deployed baseline tools and the workspace's `18 registered` state without invoking one. Native execution, supported-model traces, proposal/cancellation journeys, and compatible-Chrome declarative `toolactivated`/`toolcancel` remain separate gates.

## Public Lighthouse 13.4.1

Lighthouse 13.4.1 audited the current public `#demo` for application commit `00688d8a51fb783dbf147e08ece60470b8877544`.

| Category / metric | Result     |
| ----------------- | ---------- |
| Performance       | **100**    |
| Accessibility     | **100**    |
| Best Practices    | **100**    |
| SEO               | **100**    |
| FCP               | 503.479 ms |
| LCP               | 623.479 ms |
| TBT               | 0 ms       |
| CLS               | 0          |
| Speed Index       | 745.184 ms |
| TTI               | 623.479 ms |

The report contained no binary audit failures, errors, warnings, or runtime error. Its SHA-256 is `7c903b69675faa5e70283876434cca6da501a56d8c44d058706c5c90262714e4`. These are lab measurements, not field data.

## Preserved historical baseline

Commit `f980d28` remains the immutable 2026-08-27 baseline: **53/53 Vitest tests across 6 files**, **32/32 Playwright project runs** across desktop/mobile Chromium, zero serious/critical axe findings in four states, public/local Lighthouse evidence, public persistence, and a direct then-native 17→18 Site Tools lifecycle smoke. It predates schema v2, proposals, CAS/recovery controls, the framing guard, and the current 19-tool inventory; it is not substituted for current release evidence.

## Remaining manual and external gates

- Run the eleven-scenario probabilistic matrix in each supported native Site Tools model/client and retain complete traces.
- Verify the current imperative lifecycle natively, and declarative activation/cancel in compatible Chrome.
- Complete screen-reader, cross-browser, 200% zoom, reduced-motion, upload/delete/reload, multi-tab, and downloaded PDF/JSON/SVG/PNG inspection.
- Deploy to a dedicated origin that honors `_headers` before making production-like response-policy/privacy claims; GitHub Pages ignores that file and shares its origin.
- Record and publish the public under-three-minute YouTube demo.

See [testing.md](testing.md) for repeatable procedures and evidence-boundary rules.
