# Deploying REPLAY

Deployment status at **2026-08-27**: **public and verified on GitHub Pages**.

- Landing: [https://artem-musii.github.io/replay-sol/](https://artem-musii.github.io/replay-sol/)
- Deterministic demo: [https://artem-musii.github.io/replay-sol/#demo](https://artem-musii.github.io/replay-sol/#demo)
- Repository: [https://github.com/artem-musii/replay-sol](https://github.com/artem-musii/replay-sol)
- Initial verified deployment: commit `c95df75`, GitHub Actions run `33105222174`

REPLAY is a client-only Vite application. The core demo needs no runtime secret, server function, database, account, analytics service, or model API.

## Build artifact

Requirements: Node.js 22 or newer and npm.

```bash
npm ci
npm run build
```

The deployable output is `dist/`. GitHub Pages uses the repository subpath, so its build sets the base explicitly:

```bash
VITE_BASE_PATH=/replay-sol/ npm run build
```

Test a root-hosted artifact locally with `npm run preview -- --host 127.0.0.1 --port 4173`, then open `http://127.0.0.1:4173/#demo`. REPLAY uses hash navigation, so `#demo` is never sent to the server.

## Current GitHub Pages release

Every push to `main` runs `.github/workflows/deploy-pages.yml`. The workflow:

1. checks out the public source;
2. installs the lockfile with Node.js 22;
3. runs ESLint and the deterministic Vitest suite;
4. builds with `VITE_BASE_PATH=/replay-sol/`; and
5. uploads and deploys `dist/` through GitHub Pages.

The public release was checked for successful HTTPS responses, base-path assets, favicon, manifest, sitemap, 404 page, deterministic demo loading, IndexedDB persistence after reload, and direct Site Tools behavior. Lighthouse 13.4.1 scored the deployed workspace **99 performance, 100 accessibility, 100 best practices, and 100 SEO**.

The in-app browser discovered 17 baseline tools on the public origin. `get_case_summary`, `add_observation`, and `revert_agent_action` completed against visible shared state. Building a report preview registered the 18th `add_report_note` tool and exposed one declarative `finalize_factual_report` form with no `toolautosubmit`. This is a direct tool-contract smoke result, not a supported-model evaluation pass.

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

GitHub Pages does **not** consume `_headers`. Its verified response therefore does not contain the application’s `Permissions-Policy`, CSP, COOP/COEP, `X-Content-Type-Options`, or `X-Frame-Options` values. The production build mitigates the policies representable in markup by injecting restrictive Content Security Policy and no-referrer meta elements. Meta CSP cannot express `frame-ancestors`, and it cannot replace response-level origin isolation or permissions policy.

Site Tools worked in the tested top-level GitHub Pages session under the browser’s default top-level policy. Do not generalize that observation into framed/cross-origin support or a complete Chrome compatibility claim.

## Header-capable hosting alternative

Use Cloudflare Pages, Netlify, or another static host that honors the full response policy when response-level isolation and defense in depth are required. The exact CSP must continue to allow local evidence previews (`blob:`) and explicit scene/image export (`data:`/`blob:`) while blocking remote scripts, frames, connections, and objects. Do not set `document.domain` or `Origin-Agent-Cluster: ?0`.

For Cloudflare Pages, authenticate outside the repository, create a project, run `npm run build`, and deploy `dist/`. For Netlify, use build command `npm run build` and publish directory `dist`. Both should consume the included `_headers` and `_redirects` files; verify that they actually do. Vercel requires equivalent values in `vercel.json` because it does not consume the provider-neutral file.

## Reproduce the live checks

### Responses, assets, and metadata

```bash
curl -sS -D - -o /dev/null https://artem-musii.github.io/replay-sol/
curl -fsS -o /dev/null https://artem-musii.github.io/replay-sol/assets/generated/replay-hero.webp
curl -fsS -o /dev/null https://artem-musii.github.io/replay-sol/assets/generated/demo-roundabout-wide.webp
curl -fsS -o /dev/null https://artem-musii.github.io/replay-sol/site.webmanifest
curl -fsS -o /dev/null https://artem-musii.github.io/replay-sol/sitemap.xml
```

Inspect the returned HTML for its title, description, canonical URL, favicon, absolute social image, CSP meta, and referrer meta. Confirm no generated source PNG is present in the clean build or loaded by the UI.

### Product journey

1. Open the [public demo](https://artem-musii.github.io/replay-sol/#demo) in a clean context.
2. Complete scene/timeline editing, facts, evidence, questions, hypotheses, report review, and exports in manual browser mode.
3. Reload and verify IndexedDB case persistence on the same origin.
4. Reset the demo and verify deterministic state.
5. Create a blank case, close the workspace, and resume it from the landing page.
6. Inspect console and network logs for errors, missing assets, and unexpected external requests.

### WebMCP and Site Tools

1. Open the public demo in the ChatGPT/Codex built-in browser or another currently compatible top-level Site Tools context.
2. Confirm REPLAY detects `document.modelContext` and registers each lifecycle tool once.
3. Run a read and a safe versioned mutation; verify the visible state and activity feed update before success is accepted.
4. Build a report preview and verify `add_report_note` joins the lifecycle.
5. Verify the declarative report form can be prepared but not automatically submitted.
6. Run [demo-script.md](demo-script.md) from a fresh reset for supported-model behavior evidence.

For a strict WebMCP-enabled Chrome header/isolation test, use the local preview or a header-capable deployment rather than treating GitHub Pages as proof of the complete response policy.

## Remaining release evidence

- Record the under-three-minute public YouTube demo.
- Run the ten-scenario supported-model matrix and retain tool traces.
- Complete the screen-reader and cross-browser manual matrix.
- Open and inspect every exported PDF/JSON/SVG/PNG.
- If migrated to a header-capable host, capture its exact response headers.

## Rollback

GitHub Pages deployments retain workflow history. If the final release has a P0/P1 defect, revert the defective commit with a normal audited Git revert, push `main`, wait for the Pages workflow, and rerun the live checks. Do not leave the public submission link on a known-broken artifact.
