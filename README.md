# REPLAY

REPLAY is a browser-based workspace for reviewing minor road incidents with an AI agent. I built it around a simple rule: a useful agent should help organize the record without turning an assumption into a fact.

[Live app](https://artem-musii.github.io/replay/) · [Roundabout demo](https://artem-musii.github.io/replay/#demo) · [Video demo](https://www.youtube.com/watch?v=0INcRPRIR04) · [MIT License](LICENSE)

![REPLAY showing a two-vehicle proposal waiting for human review](docs/images/replay-devpost-thumbnail.jpg)

After a minor collision, the available information is usually incomplete: a few photographs, final vehicle positions, damage, rough timing, and two accounts that may not agree. REPLAY puts those pieces into one visual case. It keeps confirmed observations, reported memories, open questions, disputes, and agent inference separate.

REPLAY is not a forensic simulator and does not decide truth, fault, or liability. Its geometry and motion checks are deterministic review aids based on the information entered into the case.

## Try the demo

Open the [roundabout case](https://artem-musii.github.io/replay/#demo). It uses synthetic data and does not require an account.

The main workflow works in an ordinary browser. To try the WebMCP integration, open the same URL in ChatGPT or Codex's built-in browser and wait for **Site Tools · 18 registered**. Then ask:

> Use this page's Site Tools to review the unresolved lane-position question. Read the live scene, evidence relationships, and consistency results; focus the blocker; then create the smallest coordinated two-car alternative for review. Keep the baseline, endpoints, timing, and unrelated geometry unchanged. Do not apply anything, confirm claims, or infer fault.

The expected result is a pending proposal. The agent can prepare it, but only the person using the visible interface can adjust, accept, or reject it.

The public build is for synthetic or non-sensitive testing. It stores cases in browser IndexedDB on the shared `artem-musii.github.io` origin. Use a dedicated origin and an appropriate security review before working with sensitive records.

## What is in the workspace

- A calibrated SVG road scene with movable vehicles and timed paths
- A timeline for events, contact, and final positions
- Observations with source and certainty labels
- Local image evidence and explicit relationships to case items
- Open questions and comparable hypothesis branches
- Deterministic geometry, motion, provenance, and completeness checks
- A visible activity trail for human, agent, and system actions
- JSON, SVG, PNG, and PDF exports

There are four synthetic scenarios: a calibrated roundabout, a high-speed straight-road review, a T-junction crossing account, and a parking-area contradiction. They are deliberately different so the consistency checks surface different kinds of missing information instead of producing the same canned result.

## How WebMCP is used

REPLAY detects `document.modelContext` and registers narrow tools with `modelContext.registerTool(...)`. The normal workspace exposes 18 tools. A nineteenth, `add_report_note`, is available only while a current report preview exists.

The UI and the Site Tools call the same domain command layer. There is no agent-only copy of the case. Reads return the current case version; writes use optimistic version checks and idempotency keys. A WebMCP mutation is staged, saved, and only then adopted by the live workspace.

The tools cover:

| Area                     | Examples                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| Read and validate        | `get_case_summary`, `get_workspace_state`, `validate_case_consistency`                     |
| Shared focus and history | `focus_workspace_item`, `get_recent_activity`, `revert_agent_action`                       |
| Scene work               | `upsert_scene_actor`, `set_actor_trajectory`, `propose_scene_changes`, `mark_impact_event` |
| Facts and evidence       | `add_observation`, `link_evidence`, `create_open_question`                                 |
| Hypotheses               | `fork_hypothesis`, `update_hypothesis_assumption`, `compare_hypotheses`                    |
| Reporting                | `build_report_preview` and the temporary `add_report_note`                                 |

The important boundary is enforced below the UI:

- An agent may read, validate, focus, propose, and draft.
- An agent may not confirm a claim or its own inference.
- An agent may not record that a human completed an evidence, damage, or uncertainty review.
- An agent may not accept or reject a scene proposal.
- An agent may not create the final report snapshot.

Those actions require an explicit human action in the visible interface. A later edit also makes stale confirmations and review attestations lose their authority instead of silently carrying them forward.

The complete schemas and behavior are documented in [docs/webmcp-tools.md](docs/webmcp-tools.md). The model-behavior cases in [evals/webmcp-evals.json](evals/webmcp-evals.json) are evaluation cases, not claimed model-run results.

## Implementation

REPLAY is a static React 19 application written in strict TypeScript and built with Vite. Zod defines the case and command schemas. Dexie stores cases and evidence blobs in IndexedDB. The scene is semantic SVG, and jsPDF produces the report export.

The main directories are:

- `src/domain/` — case model, commands, geometry, interpolation, consistency, hypotheses, and reports
- `src/components/` — the scene, timeline, inspectors, activity, onboarding, and report review
- `src/webmcp/` — tool schemas, registration, lifecycle handling, and instrumentation
- `src/integration/` — the adapter between Site Tools and domain commands
- `src/persistence/` — IndexedDB storage and recovery
- `src/export/` — JSON, SVG, PNG, and PDF exports
- `tests/` and `evals/` — automated tests and the WebMCP evaluation specification

More detail is available in [docs/architecture.md](docs/architecture.md) and [docs/data-model.md](docs/data-model.md).

## Run locally

Requirements: Node.js 22.13 or newer and npm.

```bash
npm ci
npm run dev
```

Open [http://localhost:5173/](http://localhost:5173/) or go directly to [http://localhost:5173/#demo](http://localhost:5173/#demo).

For a production build:

```bash
npm run build
npm run preview
```

For a GitHub Pages-style `/replay/` build:

```bash
VITE_BASE_PATH=/replay/ npm run build
REPLAY_EXPECT_BASE_PATH=/replay/ npm run verify:artifact:clean
```

## Test it

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test
npx playwright install chromium firefox webkit
npm run test:e2e
```

The current release audit passed 463 Vitest tests and 232 Playwright project runs: 223 passed, 9 intentional mobile screenshot-owner skips, and no failures. The suite covers the command engine, persistence conflicts, import trust reset, proposal review, human-only controls, geometry and motion checks, accessibility, responsive layouts, exports, WebMCP registration, and the full submission journey.

The deployed build is tied to a clean commit through [release-evidence.json](https://artem-musii.github.io/replay/release-evidence.json), and the deployment verifier checks every public payload file against that manifest.

For manual browser and Site Tools checks, see:

- [Testing guide](docs/testing.md)
- [Testing in ChatGPT](docs/testing-in-chatgpt.md)
- [WebMCP evaluation notes](docs/webmcp-evals.md)

## Data, privacy, and limitations

- Manual-mode cases and uploaded evidence stay in the current browser unless the user exports a file.
- When a Site Tool is called, the connected client may process the structured text and metadata returned by that tool. REPLAY does not return evidence image bytes through its Site Tools.
- The application has no REPLAY-operated backend, analytics, location lookup, evidence-upload service, or runtime model API.
- Case text, filenames, notes, and evidence metadata are treated as untrusted data, not as instructions.
- “Confirmed” means a person confirmed the item in REPLAY. It does not mean an independent authority verified it.
- JSON export is a structured transfer, not a full backup; evidence bytes are excluded, and unsigned imports cannot preserve trusted confirmations or finalized reports.
- Local browser storage is not application-level encrypted.

See [docs/security-and-privacy-notes.md](docs/security-and-privacy-notes.md) for the full threat model and remaining risks.

## Assets and deployment

The landing image and four demo evidence images are original synthetic assets created for this project. They are labelled as demo material and are never presented as real incident evidence. The application does not send user evidence to an image model. Asset details and checksums are in [docs/generated-assets.md](docs/generated-assets.md).

GitHub Actions publishes `main` to [GitHub Pages](https://artem-musii.github.io/replay/). GitHub Pages does not apply the checked-in `_headers` file, so the public demo cannot claim the full response-header policy available on Cloudflare Pages or Netlify. The exact deployment procedure and stricter-host option are documented in [docs/deployment.md](docs/deployment.md).

## Documentation

- [Architecture](docs/architecture.md)
- [Data model](docs/data-model.md)
- [WebMCP tools](docs/webmcp-tools.md)
- [Testing](docs/testing.md)
- [Security and privacy](docs/security-and-privacy-notes.md)
- [Dependency and license notes](docs/dependency-notes.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License

REPLAY is available under the [MIT License](LICENSE). The source, runtime assets, and build instructions are included in this repository.
