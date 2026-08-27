# Deploying REPLAY

Last verified public status (**2026-08-27**): the historical `f980d28` build is public and verified on GitHub Pages. The schema-v2/proposal release candidate completed its clean local gate on **2026-08-28** but is **not yet deployed or publicly verified**.

- Landing: [https://artem-musii.github.io/replay-sol/](https://artem-musii.github.io/replay-sol/)
- Deterministic demo: [https://artem-musii.github.io/replay-sol/#demo](https://artem-musii.github.io/replay-sol/#demo)
- Repository: [https://github.com/artem-musii/replay-sol](https://github.com/artem-musii/replay-sol)
- Historical audited application: commit `f980d28`, warning-free GitHub Actions run `33108322846`

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

## GitHub Pages workflow and historical release

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

For historical commit `f980d28`, the public release was checked for successful HTTPS responses, base-path assets, favicon, manifest, sitemap, 404 page, deterministic demo loading, IndexedDB persistence after reload, and direct Site Tools behavior. A cache-busted Lighthouse 13.4.1 run against that exact commit scored **100 performance, 100 accessibility, 100 best practices, 100 SEO, and 100 agentic browsing**, with no binary failures.

That historical in-app browser run discovered 17 baseline tools. `get_case_summary`, `add_observation`, and `revert_agent_action` completed against visible shared state. Building a report preview registered the 18th `add_report_note` tool and exposed one declarative `finalize_factual_report` form with no `toolautosubmit`. This is historical direct contract evidence, not a supported-model evaluation pass and not proof of the candidate's current 18/19-tool lifecycle.

The current candidate adds schema-v2 storage/migration, versioned evidence assets, `propose_scene_changes`, session invocation audit, proposal review, semantic-intent idempotency, staged WebMCP compare-and-swap save/live commit/compensation behavior, ordinary-UI persistence pause/recovery controls, and a runtime framing guard. Its final SHA, workflow run, route/assets, current Site Tools lifecycle, persistence/migration behavior, console/network audit, and Lighthouse scores are pending.

### Current local deployment-readiness gate

On 2026-08-28, a clean `npm ci` installed 287 packages with no deprecation warnings and the audit reported 0 vulnerabilities. This followed upgrades to `eslint` 10.9.1, `@eslint/js` 10.0.1, and `eslint-plugin-react-hooks` 7.1.1, the addition of self-hosted Inter 5.3.0, and a Node.js floor of 22.13.

Formatting, lint with 0 warnings, strict typecheck, production build, and `git diff --check` passed. Vitest passed **119/119 tests across 14 files**; coverage was **52.9% statements, 41.46% branches, 49.43% functions, and 54.77% lines**. Playwright completed **78 project runs in 30.9 seconds: 73 passed, 5 intentional mobile screenshot-owner skips, and 0 failed**, with 9 checked screenshot baselines.

This record establishes local build/test readiness only. It does not establish the final commit/workflow, candidate deployment, route/assets/headers, current public Lighthouse, Site Tools or supported-model behavior, manual screen-reader/cross-browser/export fidelity, YouTube publication, or a header-capable production origin.

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

GitHub Pages does **not** consume `_headers`. The historically verified response therefore did not contain the application’s `Permissions-Policy`, CSP, COOP/COEP, `X-Content-Type-Options`, or `X-Frame-Options` values. The build mitigates representable policies by injecting restrictive Content Security Policy and no-referrer meta elements. Meta CSP cannot express `frame-ancestors`, and it cannot replace response-level origin isolation or permissions policy. The current app also refuses to render its workspace or register tools while framed; that runtime guard is defense in depth rather than response-header proof.

Site Tools worked in the historical top-level GitHub Pages session under the browser’s default top-level policy. Do not generalize that observation into candidate compatibility, framed/cross-origin support, or a complete Chrome compatibility claim.

GitHub Pages is also a shared-origin host: IndexedDB is scoped to `artem-musii.github.io`, not to the `/replay-sol/` path. The public URL is a synthetic/non-sensitive challenge demo, not a private incident vault. Use a dedicated origin for sensitive or production-like evaluation.

## Header-capable hosting alternative

Use a dedicated origin on Cloudflare Pages, Netlify, or another static host that honors the full response policy when origin isolation and defense in depth are required. The exact CSP must continue to allow local evidence previews (`blob:`) and explicit scene/image export (`data:`/`blob:`) while blocking remote scripts, frames, connections, and objects. Do not set `document.domain` or `Origin-Agent-Cluster: ?0`.

For Cloudflare Pages, authenticate outside the repository, create a project, run `npm run build`, and deploy `dist/`. For Netlify, use build command `npm run build` and publish directory `dist`. Both should consume the included `_headers` and `_redirects` files; verify that they actually do. Vercel requires equivalent values in `vercel.json` because it does not consume the provider-neutral file.

## Candidate live checks (pending deployment)

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

These commands are the candidate acceptance check, not evidence that the versioned v2 asset is already public. Record their output only after the exact candidate is deployed.

Inspect the returned HTML for its title, description, canonical URL, favicon, absolute social image, CSP meta, and referrer meta. Confirm no generated source PNG is present in the clean build or loaded by the UI.

### Product journey

1. Open the [public demo](https://artem-musii.github.io/replay-sol/#demo) using only synthetic/non-sensitive data, then explicitly choose **Case options → Reset deterministic demo**. Opening the route alone can resume a saved seed-v1 or seed-v2 fixture.
2. Complete scene/timeline editing, facts, evidence, questions, hypotheses, report review, and exports in manual browser mode.
3. Reload and verify IndexedDB case persistence on the same origin.
4. Reset the demo and verify deterministic state.
5. Create a blank case, close the workspace, and resume it from the landing page.
6. Inspect console and network logs for errors, missing assets, and unexpected external requests.

### WebMCP and Site Tools

1. Open the public demo in the ChatGPT/Codex built-in browser or another currently compatible top-level Site Tools context.
2. Confirm REPLAY detects `document.modelContext` and registers each lifecycle tool once.
3. Confirm 18 baseline tools, including `propose_scene_changes`, and 19 after report preview.
4. Run a read and verify session audit changes without canonical version/activity/persistence mutation.
5. Create a coordinated proposal and verify geometry stays preview-only until a human UI acceptance; test stale/locked all-or-nothing rejection.
6. Run a safe direct mutation and verify the staged case is durably compare-and-swap saved before it becomes live; confirm the resulting engine state, persistence, durable activity, and compact result agree. Record browser-paint timing separately.
7. Repeat that completed request with the same semantic intent and verify `idempotent: true`, the original receipt `caseVersion`, and no new save/activity. Reuse the request ID for different intent and verify `IDEMPOTENCY_CONFLICT` with no mutation.
8. Build a report preview and verify `add_report_note` joins the lifecycle.
9. Verify the agent can build and open the report preview but does not finalize it. Test the declarative form lifecycle separately in compatible Chrome because OpenAI's current Site Tools browser does not expose declarative HTML form tools. Ordinary browser interaction is a separate, non-WebMCP capability and must not operate the human-only confirmation controls.
10. Run [demo-script.md](demo-script.md) from a fresh reset for supported-model behavior evidence.

For a strict WebMCP-enabled Chrome header/isolation test, use the local preview or a header-capable deployment rather than treating GitHub Pages as proof of the complete response policy.

## Remaining release evidence

- Fix the final commit SHA, complete the new workflow, and verify all current seed-v2 plus retained seed-v1 compatibility assets/routes on the public URL.
- Capture current headers, framing behavior, console/network, persistence/migration/recovery, and Lighthouse results.
- Record the under-three-minute public YouTube demo.
- Run the eleven-scenario supported-model matrix and retain tool traces.
- Complete the screen-reader and cross-browser manual matrix.
- Open and inspect every exported PDF/JSON/SVG/PNG.
- If migrated to a header-capable host, capture its exact response headers.

## Rollback

GitHub Pages deployments retain workflow history. If the final release has a P0/P1 defect, revert the defective commit with a normal audited Git revert, push `main`, wait for the Pages workflow, and rerun the live checks. Do not leave the public submission link on a known-broken artifact.
