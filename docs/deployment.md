# Deploying REPLAY

Last verified public status (**2026-08-28**): application commit [`00688d8a51fb783dbf147e08ece60470b8877544`](https://github.com/artem-musii/replay-sol/commit/00688d8a51fb783dbf147e08ece60470b8877544) is deployed and verified on GitHub Pages.

- Landing: [https://artem-musii.github.io/replay-sol/](https://artem-musii.github.io/replay-sol/)
- Deterministic demo: [https://artem-musii.github.io/replay-sol/#demo](https://artem-musii.github.io/replay-sol/#demo)
- Repository: [https://github.com/artem-musii/replay-sol](https://github.com/artem-musii/replay-sol)
- Current application: commit `00688d8a51fb783dbf147e08ece60470b8877544`, successful [GitHub Actions run `33161848637`](https://github.com/artem-musii/replay-sol/actions/runs/33161848637)

REPLAY is a client-only Vite application. The core demo needs no runtime secret, server function, database, account, analytics service, or model API.

## Build artifact

Requirements: Node.js 22.13 or newer and npm.

```bash
npm ci
npm run build
```

The deployable output is `dist/`. GitHub Pages uses the repository subpath, so its build sets the base explicitly:

```bash
VITE_BASE_PATH=/replay-sol/ npm run build
```

Test a root-hosted artifact locally with `npm run preview -- --host 127.0.0.1 --port 4173`, then open `http://127.0.0.1:4173/#demo`. REPLAY uses hash navigation, so `#demo` is never sent to the server.

## GitHub Pages workflow and current release

Every push to `main` runs `.github/workflows/deploy-pages.yml`. The workflow:

1. checks out the public source without persisting Git credentials;
2. installs dependencies from the lockfile with the latest Node.js 22 release (22.13 or newer), including normal package lifecycle scripts;
3. gates the release on formatting, ESLint, TypeScript, and the full Vitest suite;
4. installs Playwright Chromium and runs the complete desktop/mobile Playwright suite;
5. retains JUnit, Playwright HTML, trace, screenshot, and video diagnostics when produced;
6. builds the final artifact with `VITE_BASE_PATH=/replay-sol/`;
7. uploads the verified `dist/` Pages artifact; and
8. deploys it from a separate job that alone receives `pages: write` and `id-token: write`.

All third-party workflow actions are pinned to immutable full commit SHAs. The verification/build job has only `contents: read`; the deploy job has no source checkout or repository-content permission. In-progress Pages deployments are allowed to finish so a newer push cannot interrupt a release mid-deployment.

The successful release record is:

| Item               | Exact result                                                                          |
| ------------------ | ------------------------------------------------------------------------------------- |
| Application commit | `00688d8a51fb783dbf147e08ece60470b8877544`                                            |
| Actions workflow   | `33161848637`, successful                                                             |
| Verify/build job   | `98817932649`, successful                                                             |
| Deploy job         | `98818739202`, successful                                                             |
| Pages artifact     | `9682041096`, 3,009,246 bytes                                                         |
| Artifact SHA-256   | `9fae713230ec290ca8255641b1d13c89d59b155041aa9a68403d3231caff645e`                    |
| Pages deployment   | `6139340101`, successful                                                              |
| Vitest             | **136/136** across 15 files                                                           |
| Playwright         | **103 passed, 5 intentional mobile screenshot-owner skips, 0 failed** across 108 runs |

Every one of the 43 deployed files returned successfully and byte-matched the workflow artifact. The public cache-busted index SHA-256 is `8c093e4ccd730ae8a55075c2f1039194ae77a0c237a81431d642f7a3ee302759`; the referenced main JavaScript is `f1616816495d837a42c63709c468872abab4968bbc053ff91600f65f015a96af`; and the referenced CSS is `c63c0bc237611e92a1c849984aa2ee777d6b26c5f99750ce15eeb74ff590efd1`.

An earlier run, `33124001324` for commit `54ccefcf0919be237916310dfb05b74dd3172ae3`, failed during verification before build/deploy. It never became the public release. Commit `f980d28` remains a preserved historical baseline with its own dated evidence; none of those older results are attributed to the current application.

The historical `f980d28` in-app browser run discovered 17 baseline tools. `get_case_summary`, `add_observation`, and `revert_agent_action` completed against visible shared state. Building a report preview registered the 18th `add_report_note` tool and exposed one declarative `finalize_factual_report` form with no `toolautosubmit`. This remains historical direct contract evidence, not a supported-model evaluation pass.

The current release adds the optional landing/workspace guide, clearer manual/WebMCP and uncertainty explanations, production path-point creation/editing, improved vehicle movement/rotation and scene-pointer routing, schema-v2 storage/migration, versioned evidence assets, `propose_scene_changes`, session invocation audit, proposal review, semantic-intent idempotency, staged WebMCP compare-and-swap save/live commit/compensation behavior, ordinary-UI persistence pause/recovery controls, and a runtime framing guard.

### Local release gate

On 2026-08-28, a clean `npm ci` installed 287 packages with no deprecation warnings and the audit reported 0 vulnerabilities. This followed upgrades to `eslint` 10.9.1, `@eslint/js` 10.0.1, and `eslint-plugin-react-hooks` 7.1.1, the addition of self-hosted Inter 5.3.0, and a Node.js floor of 22.13.

Formatting, lint with 0 warnings, strict typecheck, production build, and `git diff --check` passed. Vitest passed **136/136 tests across 15 files**; coverage was **52.67% statements, 41.53% branches, 49.55% functions, and 54.77% lines**. Playwright completed **108 project runs: 103 passed, 5 intentional mobile screenshot-owner skips, and 0 failed**, with 10 checked screenshot baselines.

Against the exact deployed commit, the workflow independently passed dependency installation, formatting, lint, typecheck, Vitest, Playwright, and the production build. Manual screen-reader/cross-browser/export fidelity, native compatible Site Tools/supported-model behavior, YouTube publication, and a header-capable production origin remain separate evidence boundaries.

## Security-policy result

The strict local production-preview server emits the intended security headers; the development server emits only the WebMCP eligibility headers needed for iteration. `public/_headers` carries the complete provider-neutral contract for Cloudflare Pages and Netlify:

```text
Permissions-Policy: tools=(self), camera=(), microphone=(), geolocation=(), payment=(), usb=()
Origin-Agent-Cluster: ?1
Content-Security-Policy: default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

GitHub Pages does **not** consume `_headers`. The current verified response therefore does not contain the application’s `Permissions-Policy`, CSP, COOP/COEP, `X-Content-Type-Options`, or `X-Frame-Options` values. The build mitigates representable policies by injecting restrictive Content Security Policy and no-referrer meta elements. Meta CSP cannot express `frame-ancestors`, and it cannot replace response-level origin isolation or permissions policy. The current app also refuses to render its workspace or register tools while framed; that runtime guard is defense in depth rather than response-header proof.

Site Tools worked in the historical `f980d28` top-level GitHub Pages session under the browser’s default top-level policy. A separate current Codex in-app-browser smoke surfaced all 18 baseline tools and the visible `18 registered` state without invoking a tool. This is discovery-only evidence; do not generalize it into native execution, supported-model, framed/cross-origin, or complete Chrome compatibility.

GitHub Pages is also a shared-origin host: IndexedDB is scoped to `artem-musii.github.io`, not to the `/replay-sol/` path. The public URL is a synthetic/non-sensitive challenge demo, not a private incident vault. Use a dedicated origin for sensitive or production-like evaluation.

## Header-capable hosting alternative

Use a dedicated origin on Cloudflare Pages, Netlify, or another static host that honors the full response policy when origin isolation and defense in depth are required. The exact CSP must continue to allow local evidence previews (`blob:`) and explicit scene/image export (`data:`/`blob:`) while blocking remote scripts, frames, connections, and objects. Do not set `document.domain` or `Origin-Agent-Cluster: ?0`.

For Cloudflare Pages, authenticate outside the repository, create a project, run `npm run build`, and deploy `dist/`. For Netlify, use build command `npm run build` and publish directory `dist`. Both should consume the included `_headers` and `_redirects` files; verify that they actually do. Vercel requires equivalent values in `vercel.json` because it does not consume the provider-neutral file.

## Current live verification

### Responses, assets, and metadata

```bash
curl -sS -D - -o /dev/null https://artem-musii.github.io/replay-sol/
curl -fsS -o /dev/null https://artem-musii.github.io/replay-sol/assets/generated/replay-hero.webp
curl -fsS -o /dev/null https://artem-musii.github.io/replay-sol/assets/generated/demo-roundabout-wide-v2.webp
curl -fsS -o /dev/null https://artem-musii.github.io/replay-sol/assets/generated/demo-vehicle-a-damage-v2.webp
curl -fsS -o /dev/null https://artem-musii.github.io/replay-sol/assets/generated/demo-vehicle-b-damage-v2.webp
curl -fsS -o /dev/null https://artem-musii.github.io/replay-sol/assets/generated/demo-road-condition.webp
# Retained because saved seed-v1 demos may still reference them:
curl -fsS -o /dev/null https://artem-musii.github.io/replay-sol/assets/generated/demo-roundabout-wide.webp
curl -fsS -o /dev/null https://artem-musii.github.io/replay-sol/assets/generated/demo-vehicle-a-damage.webp
curl -fsS -o /dev/null https://artem-musii.github.io/replay-sol/assets/generated/demo-vehicle-b-damage.webp
curl -fsS -o /dev/null https://artem-musii.github.io/replay-sol/site.webmanifest
curl -fsS -o /dev/null https://artem-musii.github.io/replay-sol/sitemap.xml
```

The acceptance audit fetched the landing route, generated hero, every current seed-v3 evidence asset, all retained seed-v1 compatibility assets, manifest, sitemap, and the remaining deployment artifact paths. All 43 files returned successfully and were byte-identical to artifact `9682041096`; the exact missing-route response matched the deployed 404 artifact.

Inspect the returned HTML for its title, description, canonical URL, favicon, absolute social image, CSP meta, and referrer meta. Confirm no generated source PNG is present in the clean build or loaded by the UI.

### Product journey and network

A fresh live browser loaded the landing, optional guide, WebMCP explanation, and deterministic seed-v3 demo with no console errors or warnings, no failed requests, and no off-origin requests. All four active evidence images returned 200. It verified Vehicle A's seeded 146° heading, rotated it to 161° through the visible UI, added a sixth trajectory point, confirmed the new uncertainty explanation remained visible, and kept landing help reachable at 320 px and 200% text beneath a retained-recovery notice.

This journey verifies current app load, same-origin assets, guide/manual-WebMCP discoverability, seed-v3 scene editing, trajectory extension, uncertainty copy, and recovery-notice access to landing help. It does not replace native Site Tools execution, supported-model traces, or the remaining screen-reader, cross-browser, upload/delete/reload, multi-tab recovery, persistence/reset, and downloaded-export inspections.

### WebMCP evidence boundary

The current live smoke verified the public WebMCP explanation and that manual mode remained available, while deterministic tests exercised the registry and command contract. A separate Codex in-app-browser smoke surfaced all 18 baseline tools and the visible `18 registered` state without invoking one. Native execution, supported-model traces, proposal/cancellation behavior in a live client, and declarative-form behavior remain separate evidence gates. OpenAI's current Site Tools browser does not expose declarative HTML form tools; ordinary browser interaction is a separate, non-WebMCP capability and must not operate the human-only confirmation controls.

For a strict WebMCP-enabled Chrome header/isolation test, use the local preview or a header-capable deployment rather than treating GitHub Pages as proof of the complete response policy.

## Remaining external evidence

- Record the under-three-minute public YouTube demo.
- Run the eleven-scenario supported-model matrix and retain tool traces.
- Verify the current imperative lifecycle in a native compatible Site Tools client and the declarative lifecycle in compatible Chrome.
- Complete the screen-reader and cross-browser manual matrix, including upload/delete/reload and multi-tab recovery.
- Open and inspect every exported PDF/JSON/SVG/PNG.
- Deploy to a dedicated header-capable origin and capture its exact response headers if production-like privacy/security claims are required.

## Rollback

GitHub Pages deployments retain workflow history. If the final release has a P0/P1 defect, revert the defective commit with a normal audited Git revert, push `main`, wait for the Pages workflow, and rerun the live checks. Do not leave the public submission link on a known-broken artifact.
