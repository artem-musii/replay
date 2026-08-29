# Deploying REPLAY

Last verified public status (**2026-08-29**): application commit [`2855f0bc50da2916128b2278a46f0d0a8a4e2bbd`](https://github.com/artem-musii/replay-sol/commit/2855f0bc50da2916128b2278a46f0d0a8a4e2bbd) is deployed and byte-verified on GitHub Pages.

- Landing: [https://artem-musii.github.io/replay-sol/](https://artem-musii.github.io/replay-sol/)
- Deterministic demo: [https://artem-musii.github.io/replay-sol/#demo](https://artem-musii.github.io/replay-sol/#demo)
- Repository: [https://github.com/artem-musii/replay-sol](https://github.com/artem-musii/replay-sol)
- Current application: commit `2855f0bc50da2916128b2278a46f0d0a8a4e2bbd`, successful [GitHub Actions run `33184281134`](https://github.com/artem-musii/replay-sol/actions/runs/33184281134)

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
REPLAY_EXPECT_BASE_PATH=/replay-sol/ npm run verify:artifact:clean
```

The verifier checks that local entrypoint, icon, manifest, SPA fallback, 404 return link, CSP fallback, response-policy contract, and compiled assets agree with the configured build base. Independently, it treats `package.json.homepage` as the production URL source of truth and rejects drift in the canonical URL, `og:url`, `og:image` origin/base, sitemap locations, or the robots Sitemap URL. It also rejects source maps, source files, unresolved build tokens, missing assets, and symlinks, then writes `dist/release-evidence.json` with the source commit, clean/dirty tree status, Node/package-manager versions, lockfile digest, and stable SHA-256/byte evidence. Publicly retrievable payload files are recorded separately from the required `.nojekyll` deployment control file, which GitHub Pages consumes but does not serve. The evidence file deliberately does not hash itself.

Preview the artifact at the same base path used for its build. For a normal root build, run `npm run build`, then `npm run preview -- --host 127.0.0.1 --port 4173` and open `http://127.0.0.1:4173/#demo`. For the Pages build above, keep the configured artifact, run `VITE_BASE_PATH=/replay-sol/ npm run preview -- --host 127.0.0.1 --port 4173`, and open `http://127.0.0.1:4173/replay-sol/#demo`. Vite's preview server reads the base configuration too; the build and preview commands must therefore agree. REPLAY uses hash navigation, so `#demo` is never sent to the server. The build rewrites the copied 404 page's return link to the configured base path; unsupported or ambiguous `VITE_BASE_PATH` values fail the build instead of producing a partially broken artifact.

## Current-source GitHub Pages workflow

The workflow now in the working tree was added after public commit `2855f0bc`. Every pull request to `main` runs its read-only verification job. Every push to `main`, plus an explicit manual dispatch of `main`, runs verification and then deploys. A manual dispatch of any other ref remains verification-only. The current-source workflow:

1. checks out the public source without persisting Git credentials;
2. installs dependencies from the lockfile with Node.js 22.13.0, including normal package lifecycle scripts, and audits both the complete and production-only dependency trees;
3. gates the release on formatting, ESLint, TypeScript, and the full Vitest suite with coverage;
4. installs Chromium, Firefox, and WebKit, runs the complete desktop/mobile Chromium suite, and runs the bounded release/export smoke in Firefox and WebKit;
5. retains coverage, dependency-audit, JUnit, Playwright HTML, trace, screenshot, video, and downloaded export diagnostics when produced;
6. builds the final artifact with `VITE_BASE_PATH=/replay-sol/`;
7. verifies the configured subpath and writes the machine-readable release evidence;
8. boots that exact already-built artifact at `/replay-sol/` without rebuilding and runs a 12-case focused matrix: the release/export smoke in desktop and mobile Chromium, Firefox, and WebKit, plus the high-speed, authored-impact, handler-contract, and submission-story journeys in desktop and mobile Chromium;
9. retains the release evidence for 90 days and focused configured-base diagnostics for 30 days;
10. uploads the verified `dist/` Pages artifact for non-PR runs;
11. deploys it from a separate non-PR job that alone receives `pages: write` and `id-token: write`; and
12. exports the verified build's manifest digest across the privilege-separated jobs, fetches the deployed `release-evidence.json`, waits through bounded Pages propagation retries, and independently byte/hash-verifies every public payload file against both that exact clean commit and the build artifact's digest.

All third-party workflow actions are pinned to immutable full commit SHAs. The verification/build job has only `contents: read`; the deploy job has no source checkout or repository-content permission. In-progress Pages deployments are allowed to finish so a newer push cannot interrupt a release mid-deployment.

For an explicit live check outside Actions against a deployment produced by this new attested workflow, point the same verifier at its deployed base URL and full source commit:

```bash
REPLAY_DEPLOYED_URL=https://artem-musii.github.io/replay-sol/ \
REPLAY_DEPLOYED_COMMIT=<full-commit-sha> \
REPLAY_EXPECT_PAYLOAD_MANIFEST_SHA256=<artifact-manifest-sha256> \
npm run verify:deployment
```

The deployed verifier requires an expected full commit and build-manifest digest for every remote target. It refuses non-HTTPS remote targets, credentials, query strings, unsafe manifest paths, oversized payloads, redirects, stale commits, dirty-tree evidence, build-manifest drift, byte-count drift, and per-file or aggregate hash mismatches. It validates the release evidence for `.nojekyll` but does not request that host-consumed control file from the public URL. Downloads have per-request and whole-attempt deadlines, bounded concurrency, coordinated cancellation, and streaming size limits; the complete worst-case retry budget stays below the workflow timeout. Loopback HTTP is permitted only for local artifact testing.

## Current public release record

The current public release was produced by the preceding workflow, which stopped after the Pages deployment and did not publish `release-evidence.json` or run `verify-deployment`. Its CI/deployment metadata and the later independent payload comparison are:

| Item                  | Exact result                                                                          |
| --------------------- | ------------------------------------------------------------------------------------- |
| Application commit    | `2855f0bc50da2916128b2278a46f0d0a8a4e2bbd`                                            |
| Actions workflow      | `33184281134`, successful                                                             |
| Verify/build job      | `98893121004`, successful                                                             |
| Deploy job            | `98894240126`, successful                                                             |
| Pages artifact        | `9691136611`, 3,032,328 compressed bytes                                              |
| Artifact SHA-256      | `27c2bf89662de9280ddca52f9d2cb922545a913a27f819b855110f184e924da9`                    |
| Pages deployment      | `6143728209`, successful                                                              |
| Vitest                | **196/196** across 20 files                                                           |
| Playwright            | **109 passed, 5 intentional mobile screenshot-owner skips, 0 failed** across 114 runs |
| Live payload          | **43 files**, **4,248,606 bytes**, all byte-matched                                   |
| Payload manifest hash | `6eb13acc1eec75d60298a3979009a175e2ba94bc8e9ad00382d4a274bdcc6ba4`                    |

An independent 2026-08-29 acceptance audit downloaded the Pages artifact and cache-busted every public payload path. All 43 deployed files returned successfully and byte-matched the artifact; the remote payload totalled 4,248,606 bytes and its stable manifest SHA-256 was `6eb13acc1eec75d60298a3979009a175e2ba94bc8e9ad00382d4a274bdcc6ba4`, distinct from the compressed Pages artifact digest above. Commit `2855f0bc` was deployed by the preceding workflow, before the current source added `release-evidence.json` and the automatic `verify-deployment` job; consequently `https://artem-musii.github.io/replay-sol/release-evidence.json` currently returns 404 for this older release. The next frozen release must pass the current workflow before its automated attestation is claimed.

### Superseded `00688d8a` release evidence

The previous seed-v3 application commit `00688d8a51fb783dbf147e08ece60470b8877544` passed Actions run `33161848637`, verify job `98817932649`, and deploy job `98818739202`. Pages deployment `6139340101` published artifact `9682041096` (3,009,246 bytes; SHA-256 `9fae713230ec290ca8255641b1d13c89d59b155041aa9a68403d3231caff645e`) after **136/136 Vitest tests across 15 files** and **108 Playwright runs: 103 passed, 5 intentional skips, 0 failed**. Its public cache-busted index SHA-256 was `8c093e4ccd730ae8a55075c2f1039194ae77a0c237a81431d642f7a3ee302759`; the referenced main JavaScript was `f1616816495d837a42c63709c468872abab4968bbc053ff91600f65f015a96af`; and the referenced CSS was `c63c0bc237611e92a1c849984aa2ee777d6b26c5f99750ce15eeb74ff590efd1`. These values remain historical evidence and are not attributed to the current deployment.

An earlier run, `33124001324` for commit `54ccefcf0919be237916310dfb05b74dd3172ae3`, failed during verification before build/deploy. It never became the public release. Commit `f980d28` remains a preserved historical baseline with its own dated evidence; none of those older results are attributed to the current application.

The historical `f980d28` in-app browser run discovered 17 baseline tools. `get_case_summary`, `add_observation`, and `revert_agent_action` completed against visible shared state. Building a report preview registered the 18th `add_report_note` tool and exposed one declarative `finalize_factual_report` form with no `toolautosubmit`. This remains historical direct contract evidence, not a supported-model evaluation pass.

The current release contains the optional landing/workspace guide, clearer manual/WebMCP and uncertainty explanations, production path-point creation/editing, improved vehicle movement/rotation and scene-pointer routing, schema-v2 storage/migration, versioned evidence assets, `propose_scene_changes`, session invocation audit, proposal review, semantic-intent idempotency, staged WebMCP compare-and-swap save/live commit/compensation behavior, ordinary-UI persistence pause/recovery controls, a runtime framing guard, seed-v5 calibrated geometry/motion/integrity review, four deterministic scenarios, and physically coherent authored contact geometry.

The later working-tree candidate additionally contains stable `#case/<encoded-case-id>` routes with a landing-page local-case list, exact actor-pair impact placement for three- and four-vehicle cases, the path-derived 65–80 km/h straight-road demo, and canonical human/UI-only completeness attestations. Those attestations can make a legitimate no-evidence case finalizable after explicit review, become stale after relevant evidence/damage/question changes, and lose authority on unsigned import. These behaviors must not be described as deployed until the final candidate passes the release workflow and public byte verification.

### Current release CI gate

Against exact commit `2855f0bc50da2916128b2278a46f0d0a8a4e2bbd`, the workflow passed its dependency installation, formatting, lint, strict typecheck, Vitest, Playwright, and production-build gates. The exact test and deployment results are in the release table above. Manual screen-reader/cross-browser/export fidelity, native compatible Site Tools/supported-model behavior, YouTube publication, and a header-capable production origin remain separate evidence boundaries.

### Superseded `00688d8a` local gate

On 2026-08-28, a clean `npm ci` installed 287 packages with no deprecation warnings and the audit reported 0 vulnerabilities. This followed upgrades to `eslint` 10.9.1, `@eslint/js` 10.0.1, and `eslint-plugin-react-hooks` 7.1.1, the addition of self-hosted Inter 5.3.0, and a Node.js floor of 22.13.

Formatting, lint with 0 warnings, strict typecheck, production build, and `git diff --check` passed. Vitest passed **136/136 tests across 15 files**; coverage was **52.67% statements, 41.53% branches, 49.55% functions, and 54.77% lines**. Playwright completed **108 project runs: 103 passed, 5 intentional mobile screenshot-owner skips, and 0 failed**, with 10 checked screenshot baselines.

These local metrics and coverage values belong to the superseded `00688d8a` release. They are retained for historical reproducibility, not substituted for the current release table above.

## Security-policy result

The strict local production-preview server emits the intended security headers; the development server emits only the WebMCP eligibility headers needed for iteration. `public/_headers` carries the complete provider-neutral contract for Cloudflare Pages and Netlify:

```text
Permissions-Policy: tools=(self), camera=(), microphone=(), geolocation=(), payment=(), usb=()
Origin-Agent-Cluster: ?1
Content-Security-Policy: default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

The policy intentionally omits `upgrade-insecure-requests`. Production assets are relative and therefore inherit HTTPS, while `'self'` blocks absolute cross-scheme HTTP resources. Omitting the redundant upgrade keeps the documented HTTP loopback preview usable in Safari/WebKit, which otherwise rewrites its own `http://127.0.0.1` scripts and styles to unavailable HTTPS URLs.

GitHub Pages does **not** consume `_headers`. The current verified response therefore does not contain the application’s `Permissions-Policy`, CSP, COOP/COEP, `X-Content-Type-Options`, or `X-Frame-Options` values. The build mitigates representable policies by injecting restrictive Content Security Policy and no-referrer meta elements. Meta CSP cannot express `frame-ancestors`, and it cannot replace response-level origin isolation or permissions policy. The current app also refuses to render its workspace or register tools while framed; that runtime guard is defense in depth rather than response-header proof.

Site Tools worked in the historical `f980d28` top-level GitHub Pages session under the browser’s default top-level policy. A separate current Codex in-app-browser smoke surfaced all 18 baseline tools and the visible `18 registered` state without invoking a tool. This is discovery-only evidence; do not generalize it into native execution, supported-model, framed/cross-origin, or complete Chrome compatibility.

GitHub Pages is also a shared-origin host: IndexedDB is scoped to `artem-musii.github.io`, not to the `/replay-sol/` path. The public URL is a synthetic/non-sensitive challenge demo, not a private incident vault. Use a dedicated origin for sensitive or production-like evaluation.

“Local-first” describes the case/evidence data boundary, not guaranteed offline installation. REPLAY does not register a service worker: an already loaded workspace can continue without a network connection, but a cold start or reload still needs the static host unless the browser happens to retain those assets. The web manifest supplies install presentation metadata only. Browser storage can also be evicted when the best-effort persistent-storage request is denied, so the saved indicator and explicit exports remain the durability boundary; do not claim an offline-capable PWA or permanent browser storage.

## Header-capable hosting alternative

Use a dedicated origin on Cloudflare Pages, Netlify, or another static host that honors the full response policy when origin isolation and defense in depth are required. The exact CSP must continue to allow local evidence previews (`blob:`) and explicit scene/image export (`data:`/`blob:`) while blocking remote scripts, frames, connections, and objects. Do not set `document.domain` or `Origin-Agent-Cluster: ?0`.

For Cloudflare Pages, authenticate outside the repository, create a project, run `npm run build`, and deploy `dist/`. For Netlify, use build command `npm run build` and publish directory `dist`. Both should consume the included `_headers` and `_redirects` files; verify that they actually do. Vercel requires equivalent values in `vercel.json` because it does not consume the provider-neutral file.

The checked-in production identity is intentionally pinned to the challenge’s GitHub Pages URL. Before publishing a different canonical origin, update `package.json` `homepage`, the canonical/`og:url`/`og:image` values in `index.html`, the Sitemap URL in `public/robots.txt`, and every `<loc>` in `public/sitemap.xml` as one reviewed change. Then rebuild and run `npm run verify:artifact`; the verifier rejects a mixed-origin artifact. A root-hosted deployment also uses `VITE_BASE_PATH=/` (or omits the variable), while a subpath deployment must set its exact leading-and-trailing-slash base.

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

The current acceptance audit fetched the landing route, generated hero, every seed-v5 evidence asset, all retained seed-v1 compatibility assets, manifest, sitemap, and the remaining deployment paths. All 43 files / 4,248,606 bytes returned successfully and were byte-identical to artifact `9691136611`; the stable live manifest SHA-256 was `6eb13acc1eec75d60298a3979009a175e2ba94bc8e9ad00382d4a274bdcc6ba4`.

Inspect the returned HTML for its title, description, canonical URL, favicon, absolute social image, CSP meta, and referrer meta. Confirm no generated source PNG is present in the clean build or loaded by the UI.

### Superseded `00688d8a` product journey and network

A fresh live browser against the then-current `00688d8a` release loaded the landing, optional guide, WebMCP explanation, and deterministic seed-v3 demo with no console errors or warnings, no failed requests, and no off-origin requests. All four active evidence images returned 200. It verified Vehicle A's seeded 146° heading, rotated it to 161° through the visible UI, added a sixth trajectory point, confirmed the new uncertainty explanation remained visible, and kept landing help reachable at 320 px and 200% text beneath a retained-recovery notice.

This journey is historical evidence for `00688d8a`: it verified app load, same-origin assets, guide/manual-WebMCP discoverability, seed-v3 scene editing, trajectory extension, uncertainty copy, and recovery-notice access to landing help. It is not a product-browser smoke of `2855f0bc` and does not replace native Site Tools execution, supported-model traces, or the remaining screen-reader, cross-browser, upload/delete/reload, multi-tab recovery, persistence/reset, and downloaded-export inspections.

### WebMCP evidence boundary

The superseded `00688d8a` live smoke verified the public WebMCP explanation and that manual mode remained available, while its deterministic tests exercised the registry and command contract. A separate Codex in-app-browser smoke surfaced all 18 baseline tools and the visible `18 registered` state without invoking one. The current `2855f0bc` artifact is deployed and byte-verified, but an exact-current-deployment product-browser/native trace has not yet been recorded. Native execution, supported-model traces, proposal/cancellation behavior in a live client, and declarative-form behavior remain separate evidence gates. OpenAI's current Site Tools browser does not expose declarative HTML form tools; ordinary browser interaction is a separate, non-WebMCP capability and must not operate the human-only confirmation controls.

For a strict WebMCP-enabled Chrome header/isolation test, use the local preview or a header-capable deployment rather than treating GitHub Pages as proof of the complete response policy.

## Remaining external evidence

- Record the under-three-minute public YouTube demo.
- Run the eleven-scenario supported-model matrix and retain tool traces.
- Verify the current imperative lifecycle in a native compatible Site Tools client and the declarative lifecycle in compatible Chrome.
- Complete the screen-reader and real-Safari manual matrix, including upload/delete/reload and multi-tab recovery; the automated Firefox/WebKit release journey is a bounded smoke, not the whole product matrix.
- Repeat the retained PDF/JSON/SVG/PNG inspection in platform-native readers. The current candidate already passed browser decode/render checks plus visual PNG and four-page Poppler PDF review, but that does not substitute for final-platform inspection.
- Deploy to a dedicated header-capable origin and capture its exact response headers if production-like privacy/security claims are required.

## Rollback

GitHub Pages deployments retain workflow history. If the final release has a P0/P1 defect, revert the defective commit with a normal audited Git revert, push `main`, wait for the Pages workflow, and rerun the live checks. Do not leave the public submission link on a known-broken artifact.
