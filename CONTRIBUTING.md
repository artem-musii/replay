# Contributing to REPLAY

REPLAY welcomes focused improvements to incident reconstruction, WebMCP interoperability, accessibility, safety, and documentation. Keep the product’s central distinction intact: evidence, memory, uncertainty, dispute, and agent inference must remain visibly separate, and only a human UI action may confirm a claim or finalize a report.

## Local setup

Use Node.js 22 or newer.

```bash
npm ci
npm run dev
```

Open `http://localhost:5173/` or the deterministic fixture at `http://localhost:5173/#demo`.

## Before proposing a change

1. Open an issue for a substantial product, schema, or WebMCP contract change.
2. Do not add real incident records, personal data, license plates, secrets, or provider credentials to fixtures or screenshots.
3. Keep UI and WebMCP mutations on the canonical `ReplayEngine` command path.
4. Preserve runtime validation, version checks, locks, activity attribution, uncertainty labels, and human-only confirmation/finalization.
5. Treat imported text, filenames, evidence metadata, and model output as untrusted data.

## Verification

Run the complete local gate before opening a pull request:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test -- --run
npm run test:e2e
npm run build
npm audit
```

Changes to WebMCP tools must update the fixed schema, description, annotations, lifecycle tests, [tool contract](docs/webmcp-tools.md), and relevant [eval specification](evals/webmcp-evals.json). UI changes should include desktop and mobile coverage where the behavior differs. Accessibility fixes should state both the automated and manual checks performed.

## Pull requests

Keep each pull request narrow and explain:

- the user-visible outcome;
- the domain or safety invariant affected;
- test evidence;
- migration or compatibility impact; and
- screenshots for material interface changes.

Do not include generated build output, Playwright reports, local evidence, or source PNG generation artifacts. See [SECURITY.md](SECURITY.md) for private vulnerability reporting.
