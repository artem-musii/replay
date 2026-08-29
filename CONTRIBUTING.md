# Contributing to REPLAY

REPLAY welcomes focused improvements to incident reconstruction, WebMCP interoperability, accessibility, safety, and documentation. Keep the product’s central distinction intact: evidence, memory, uncertainty, dispute, and agent inference must remain visibly separate, and only a human UI action may confirm a claim or finalize a report.

## Local setup

Use Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

Open `http://localhost:5173/` or the deterministic fixture at `http://localhost:5173/#demo`.

## Before proposing a change

1. Open an issue for a substantial product, schema, or WebMCP contract change.
2. Do not add real incident records, personal data, license plates, secrets, or provider credentials to fixtures or screenshots.
3. Keep UI and WebMCP mutations on the canonical `ReplayEngine` command path.
4. Preserve runtime validation, version checks, locks, activity attribution, uncertainty labels, and human-only confirmation, proposal decision, evidence deletion, and finalization boundaries.
5. Treat imported text, filenames, evidence metadata, and model output as untrusted data.
6. Keep durable domain activity distinct from capped session-only tool invocation audit. WebMCP cancellation before primary persistence must create neither a mutation nor an audit entry; if cancellation follows a resolved staged save, compensation must restore durability or the failure must surface as audited `PERSISTENCE_FAILED`.

## Verification

Run the complete local gate before opening a pull request:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test -- --run
npx playwright install chromium firefox webkit
npm run test:e2e
npm audit --audit-level=moderate
npm audit --omit=dev --audit-level=moderate
VITE_BASE_PATH=/replay-sol/ npm run build
REPLAY_EXPECT_BASE_PATH=/replay-sol/ npm run verify:artifact:clean
```

The clean verifier fails unless the source tree is clean and records that state in `dist/release-evidence.json`. Use `npm run verify:artifact` only for deliberately dirty local diagnostics.

Changes to WebMCP tools must update the fixed schema, description, annotations, lifecycle tests, [tool contract](docs/webmcp-tools.md), and relevant [eval specification](evals/webmcp-evals.json). UI changes should include desktop and mobile coverage where the behavior differs. Accessibility fixes should state both the automated and manual checks performed.

A persisted-model change must bump `schemaVersion` when compatibility requires it and include migration coverage, current-schema validation, trusted local-load coverage, unsigned-import trust-reset coverage, and matching updates to the architecture, data model, privacy/security, testing, and release-status documents. Persistence changes must test conflict, recovery, and evidence-integrity behavior. Do not delete or rewrite an incompatible local record merely to make a migration pass; retain it for explicit recovery when safe parsing cannot succeed.

Treat deployment, browser, Lighthouse, accessibility, and model-eval results as commit-and-URL-specific evidence. Preserve an older result as a dated historical baseline, but never relabel it as proof for a changed release candidate.

## Pull requests

Keep each pull request narrow and explain:

- the user-visible outcome;
- the domain or safety invariant affected;
- test evidence;
- migration or compatibility impact; and
- screenshots for material interface changes.

Do not include generated build output, Playwright reports, local evidence, or source PNG generation artifacts. See [SECURITY.md](SECURITY.md) for private vulnerability reporting.
