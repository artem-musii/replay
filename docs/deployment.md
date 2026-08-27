# Deploying REPLAY

Deployment status at **2026-08-27**: **not deployed**. No authenticated hosting provider or live URL has been confirmed in this workspace. Do not replace the README/Devpost placeholders until the exact deployed commit passes the checks below.

REPLAY is a client-only Vite application. The core demo needs no runtime secret, server function, database, account, analytics service, or model API. A host only needs to serve the contents of `dist/` over HTTPS with the required response headers.

## Build artifact

Requirements: Node.js 22 or newer and npm.

```bash
npm ci
npm run build
```

The deployable output is `dist/`. Test that exact output locally:

```bash
npm run preview -- --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173/#demo`. REPLAY uses hash navigation, so the deterministic demo does not require a server-side rewrite for `#demo`; the server receives `/`.

## Included hosting contract

Vite’s `server.headers` and `preview.headers` apply only to local development/preview. The repository therefore includes `public/_headers` and `public/_redirects`; Vite copies them into `dist/`. Cloudflare Pages and Netlify can apply the headers file and use the rewrite as a static-app fallback. The current header contract is:

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

The exact CSP must continue to allow local evidence previews (`blob:`) and explicit scene/image export (`data:`/`blob:`) while blocking remote scripts, frames, connections, and objects. Do not set `document.domain` or `Origin-Agent-Cluster: ?0`; either conflicts with the WebMCP eligibility boundary documented by Chrome.

Vercel requires equivalent values in `vercel.json`; it does not consume the provider-neutral file. Confirm the selected provider actually applies every intended value. A committed `_headers` file alone is not proof of a live response policy.

## Recommended path: Cloudflare Pages direct upload

Cloudflare credentials are an external prerequisite. Authenticate through the provider’s supported local login or environment variables; never commit a token.

One-time project creation:

```bash
npx wrangler pages project create replay-webmcp
```

Build and deploy:

```bash
npm ci
npm run build
npx wrangler pages deploy dist --project-name replay-webmcp
```

Record the immutable deployment URL and any configured production alias. The required public routes are:

```text
https://<deployment-host>/
https://<deployment-host>/#demo
```

If the Pages dashboard is used instead, configure:

```text
Build command: npm run build
Build output directory: dist
Node version: 22 or newer
Environment secrets: none for the core app
```

## Alternatives

### Netlify

Configure build command `npm run build` and publish directory `dist`. Ensure the final `dist/_headers` file is deployed and honored. A CLI release can use `npx netlify deploy --prod --dir=dist` after authenticated project linkage.

### Vercel

Import the repository as a Vite project or use `npx vercel --prod`. The output directory is `dist`. Add and verify a `vercel.json` headers configuration equivalent to the required policy above; Vite preview headers do not carry into Vercel automatically.

Do not maintain multiple provider configurations unless they are kept semantically equivalent and tested. The public documentation should name the provider actually used.

## Live verification

Run these checks against both the deployment URL returned by the provider and the final public alias.

### 1. Response and headers

```bash
curl -sS -D - -o /dev/null https://<deployment-host>/
```

Confirm:

- HTTPS returns a successful response with no authentication or geographic restriction;
- `Permissions-Policy` includes `tools=(self)`;
- `Origin-Agent-Cluster` is `?1`, never `?0`;
- CSP, frame restriction, content-type, referrer, opener, and resource policies are present as intended;
- redirects retain HTTPS and do not discard the path before the hash is applied by the browser.

### 2. Static assets and metadata

```bash
curl -fsS -o /dev/null https://<deployment-host>/assets/generated/replay-hero.webp
curl -fsS -o /dev/null https://<deployment-host>/assets/generated/demo-roundabout-wide.webp
```

Open the landing page and verify title, description, favicon, social image, hero, all four evidence images, and no failed network request. Confirm no generated source PNG is present in the clean build or loaded by the UI.

### 3. Product journey

1. Open `https://<deployment-host>/#demo` in a clean context.
2. Complete scene/timeline editing, facts, evidence, questions, hypotheses, report review, and all exports in manual browser mode.
3. Reload and verify IndexedDB case persistence on the same origin.
4. Reset the demo and verify deterministic state.
5. Create a blank case, close the workspace, and resume it from the landing page.
6. Inspect console and network logs for errors, unhandled rejections, missing assets, and unexpected external requests.

### 4. WebMCP and Site Tools

1. Open the live `#demo` route in a currently compatible WebMCP-enabled Chrome session.
2. Confirm REPLAY detects `document.modelContext`, registers the correct lifecycle tools once, and unregisters them after leaving the workspace.
3. Run a read and a safe versioned mutation; verify the same visible state and activity feed update.
4. Open the URL in the ChatGPT/Codex built-in browser with a currently supported Site Tools model/workspace.
5. Execute [demo-script.md](demo-script.md) from a fresh reset.
6. Verify the declarative report form can be prepared but not automatically submitted.

Record the exact browser/app/model versions, deployed commit, and tool snapshot. API rollout limitations are not equivalent to a product defect, but they must be disclosed accurately.

### 5. Accessibility and performance

Run the production checks in [testing.md](testing.md), including keyboard, screen reader, reduced motion, axe, responsive sizes, export opening, Lighthouse/equivalent, and console/network audits.

## Release record

Add a completed record to the implementation/test status documents:

```text
Git commit:
Provider/project:
Deploy command:
Immutable deploy URL:
Public landing URL:
Public demo URL:
Deployment time/time zone:
HTTP/header result:
Asset checks:
Persistence/reset checks:
Manual fallback checks:
Chrome WebMCP check:
ChatGPT/Codex Site Tools check:
Accessibility/performance result:
Known limitations:
```

Then update README, Devpost copy, demo script placeholders, and the judging matrix with the verified URLs only.

## Rollback

Keep the previous known-good immutable deployment. If the final release has a P0/P1 defect, broken asset, missing header, persistence regression, or WebMCP registration failure:

1. move the production alias back to the previous deployment through the host;
2. record the rollback and affected commit;
3. fix and rerun the entire release command and live-verification sequence;
4. do not leave the submission link pointing at an unverified preview.
