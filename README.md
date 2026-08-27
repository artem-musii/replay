# REPLAY

**A shared black box for incidents that did not have one.** REPLAY is a local-first visual workspace where a person and an AI agent reconstruct a minor two-vehicle road incident together while keeping evidence, memory, uncertainty, dispute, and inference visibly distinct.

![Generated REPLAY product visual showing a roundabout reconstruction, trajectories, evidence, timeline, and provenance](public/assets/generated/replay-hero.webp)

> REPLAY organizes and visualizes a factual account. Its consistency checks are informational, not a forensic or legal determination. It does not determine fault or liability.

## Workspace preview

![REPLAY deterministic demo workspace showing the roundabout scene, fact inspector, synchronized timeline, and attributed activity feed](docs/images/replay-workspace.webp)

_Actual 1440 × 900 Playwright capture of the deterministic demo workspace. The product visual above is generated; this workspace image is a real application screenshot._

## Try it

| Destination        | Link                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| Live app           | [https://artem-musii.github.io/replay-sol/](https://artem-musii.github.io/replay-sol/)           |
| Deterministic demo | [https://artem-musii.github.io/replay-sol/#demo](https://artem-musii.github.io/replay-sol/#demo) |
| Public repository  | [https://github.com/artem-musii/replay-sol](https://github.com/artem-musii/replay-sol)           |
| Demo video         | **Not recorded yet.** Add the public YouTube URL before the final Devpost submission.            |

To start without WebMCP, run the app locally and choose **Try the demo case**. Every core workspace feature remains available in an ordinary browser.

## The problem

After a minor collision, the useful record is usually fragmented across approximate memories, photographs, vehicle damage, final positions, incomplete timing, and unresolved disagreement. A form flattens those relationships into prose. A chat can quietly blur a statement into an assumption.

REPLAY gives the case a shared, inspectable structure:

- an accessible SVG road scene with vehicles, trajectories, impact, damage, and locks;
- a synchronized, editable timeline;
- claims with explicit source and certainty labels;
- local evidence with visible links into the case;
- ranked open questions and alternative hypothesis branches;
- deterministic consistency issues instead of model speculation;
- attributable human, agent, and system activity; and
- a citation-bound factual report that only a person can finalize.

It is designed for drivers, claims-support teams, fleet managers, insurance intake staff, rental support teams, and neutral mediators handling minor no-injury incidents.

## Human and agent share one model

The human interface and WebMCP tools do not maintain separate versions of the incident. Both call the same validated domain command engine.

```text
Human edits scene or facts              Agent calls a Site Tool
              \                              /
               same canonical command/query layer
                            |
           validation, locks, versioning, activity
                            |
         one visible case model + local persistence
                            |
       scene, timeline, inspector, report, activity
```

A useful collaboration cycle looks like this:

1. The agent reads the live scene, claims, evidence, questions, and recent activity.
2. It adds or changes visible geometry through narrow WebMCP tools.
3. The person directly corrects, locks, confirms, disputes, or rejects that work.
4. The agent rereads the newer activity and revalidates rather than overwriting it.
5. Multiple unresolved explanations stay as comparable branches.
6. The agent may prepare a cited report preview, but a visible human review and manual confirmation create the immutable snapshot.

## Product tour

The seeded **Roundabout incident — 17:42** case includes two generic vehicles, four clearly labeled synthetic demo photographs, confirmed and reported observations, known damage, final positions, open questions, and a deliberate trajectory/impact inconsistency. It never identifies a vehicle at fault.

In the workspace you can:

- drag and rotate vehicles, edit trajectory points, scrub or play time, and compare branch overlays;
- use keyboard controls for the scene and timeline;
- add, classify, confirm, dispute, or lock observations;
- upload JPEG, PNG, or WebP evidence locally, link it, and remove it with confirmation;
- answer ranked questions and optionally turn an answer into a reported observation;
- fork, annotate, activate, archive, restore, and compare hypotheses;
- inspect deterministic consistency findings and attributed activity;
- undo, redo, or safely revert an eligible agent action;
- build and human-review a neutral report; and
- export the case as JSON, the scene as SVG or PNG, and the report as PDF.

## WebMCP implementation

REPLAY uses the current proposed imperative API, `document.modelContext.registerTool(...)`, behind runtime feature detection. Registration begins only while a workspace is open and is divided into lifecycle groups for base, scene, facts, hypothesis, and reviewed-report capabilities. Once a baseline exists, the hypothesis group includes `build_report_preview`; `add_report_note` joins only after a preview exists. Aborting a group unregisters it. Each invocation also receives its own cancellation signal.

The current implementation defines 18 narrow imperative tools:

| Group                | Tools                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Read and context     | `get_case_summary`, `get_workspace_state`, `get_recent_activity`, `validate_case_consistency`, `compare_hypotheses` |
| Visible coordination | `focus_workspace_item`, `revert_agent_action`                                                                       |
| Scene                | `upsert_scene_actor`, `set_actor_trajectory`, `mark_impact_event`, `mark_vehicle_damage`                            |
| Facts and evidence   | `add_observation`, `link_evidence`, `create_open_question`                                                          |
| Hypotheses           | `fork_hypothesis`, `update_hypothesis_assumption`                                                                   |
| Report preview       | `build_report_preview` once a baseline reconstruction exists                                                        |
| Reviewed report      | `add_report_note` after a preview exists                                                                            |

The visible final-review form is a declarative Site Tool named `finalize_factual_report`. It intentionally omits automatic submission. Agent-origin commands cannot confirm claims or finalize reports; those boundaries are also enforced in the domain layer.

Read the complete contracts in [WebMCP tools](docs/webmcp-tools.md), [WebMCP evals](docs/webmcp-evals.md), and the dated [source of truth](docs/source-of-truth.md).

Primary external references: the [WebMCP Draft Community Group Report](https://webmachinelearning.github.io/webmcp/), [Chrome WebMCP documentation](https://developer.chrome.com/docs/ai/webmcp), [OpenAI Site Tools documentation](https://learn.chatgpt.com/docs/webmcp), the [WebMCP Challenge](https://webmcp.devpost.com/), and its [official rules](https://webmcp.devpost.com/rules). WebMCP is a proposed, evolving standard; the repository source of truth records the retrieval dates and implementation consequences.

## Architecture

REPLAY is a static React 19 + strict TypeScript application built with Vite. The core workflow needs no server, account, analytics, location access, or runtime model API.

- `src/domain/`: versioned model, Zod schemas, command engine, locks, optimistic versioning, idempotency, undo/redo, consistency, hypotheses, import/export, and report projections.
- `src/components/`: landing page, blank-case wizard, SVG scene, timeline, inspector, activity, report review, and WebMCP inspector.
- `src/webmcp/`: schemas, tool definitions, annotations, instrumentation, registration lifecycle, feature detection, and debug state.
- `src/integration/`: adapter from WebMCP operations to canonical domain queries and commands.
- `src/persistence/`: IndexedDB case and evidence-blob storage through Dexie.
- `src/export/`: local JSON, SVG, PNG, and PDF exports.
- `tests/` and `evals/`: deterministic tests and the model-behavior evaluation specification.

See [architecture](docs/architecture.md) and [data model](docs/data-model.md) for the deeper design.

## Local setup

Requirements: Node.js 22 or newer and npm.

```bash
npm ci
npm run dev
```

Open [http://localhost:5173/](http://localhost:5173/) or go directly to the deterministic demo at [http://localhost:5173/#demo](http://localhost:5173/#demo).

For a production-equivalent local build:

```bash
npm run build
npm run preview
```

Vite prints the preview URL, normally `http://localhost:4173/`.

## Exact browser testing paths

### Ordinary browser fallback

1. Run `npm run dev`.
2. Open `http://localhost:5173/#demo` in a current Chromium, Firefox, or Safari build.
3. Confirm the header says manual browser mode when `document.modelContext` is absent.
4. Complete scene editing, facts, evidence, questions, hypotheses, report review, and exports through visible controls.

### WebMCP-enabled Chrome

1. Use the current Chrome WebMCP availability path documented by Chrome. For local testing, enable `chrome://flags/#enable-webmcp-testing` when that flag is present, then restart Chrome.
2. Run `npm run dev` and open `http://localhost:5173/#demo` in the same Chrome profile.
3. Open **Case options → WebMCP inspector**.
4. Confirm `document.modelContext` is detected and the expected lifecycle tools are registered.
5. Inspect annotations and schemas. If the browser exposes `getTools()` and `executeTool()`, run a read-only tool from the inspector and confirm the returned case version and visible state.
6. Execute the sequence in [docs/demo-script.md](docs/demo-script.md). Verify agent changes appear in the scene and activity feed before the result is treated as complete.

### ChatGPT/Codex Site Tools

1. Deploy the app to HTTPS first; use the final URL ending in `/#demo`.
2. In the ChatGPT desktop app or Codex, choose a model/workspace combination currently supported by Site Tools and open that URL in the built-in browser.
3. Keep the page open and ask: “Inspect this case and separate what is confirmed, reported, unknown, and inconsistent.”
4. Confirm the agent discovers REPLAY’s page tools, calls the read-only operations, and focuses the live inconsistency.
5. Continue with the prompts in [docs/demo-script.md](docs/demo-script.md).

WebMCP and Site Tools remain evolving and rollout-dependent. A fallback status does not disable the manual product. Current external API and availability notes are recorded with dates and official links in [docs/source-of-truth.md](docs/source-of-truth.md).

## Testing

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

The repository contains deterministic coverage for the domain engine, seed/schema/report rules, consistency and interpolation, timeline behavior, and WebMCP registry. The model-behavior cases in `evals/webmcp-evals.json` are an evaluation specification; they are not presented as captured model-run results.

Verification on 2026-08-27 completed with lint and strict typecheck passing, **53/53 Vitest tests**, **32/32 Playwright runs** across desktop and mobile Chromium, and a successful production build. The Playwright run included blank-case path, event, impact, damage, lock, and evidence-annotation journeys plus axe checks of the landing page, blank wizard, workspace, and finalization dialog with no serious or critical violations. Lighthouse 13.4.1 scored the seeded strict local production preview **96 performance, 100 accessibility, 100 best practices, and 100 SEO**; the exact public application commit scored **100/100/100/100**, plus 100 for agentic browsing, with no binary failures. A direct public in-app browser run discovered the 17-tool baseline, executed read/mutate/revert operations, built the report preview, observed the 18-tool reviewed-report lifecycle, and verified the non-autosubmitting human finalization form. Supported-model probabilistic evals and screen-reader review remain separate release gates.

See [docs/testing.md](docs/testing.md) for fixtures, exact results, manual checks, Site Tools steps, and how to record results without conflating deterministic tests with probabilistic evals.

## Privacy, safety, and limitations

- Cases and uploaded evidence stay in this browser’s IndexedDB unless the person explicitly exports a file.
- The core demo performs no evidence upload, analytics call, geolocation lookup, or runtime AI request.
- User statements, filenames, notes, and evidence metadata are treated as untrusted case data, not executable instructions.
- “Confirmed” means explicitly confirmed by a person in REPLAY; it does not mean independently verified.
- Consistency checks organize contradictions and missing information. They are not collision physics, truth assessment, legal advice, or a fault decision.
- Local browser storage is not application-level encrypted. Do not use the prototype for highly sensitive production records without an appropriate security review and retention policy.

Read [security and privacy notes](docs/security-and-privacy-notes.md) for the threat model and residual risks.

## Generated assets

The landing hero and four demo evidence images are original synthetic assets generated during development with the built-in image-generation mode. They are used only for the product visual and clearly labeled demo evidence; functional scene geometry remains semantic SVG. No user evidence is sent to an image model at runtime.

Prompts, dimensions, file sizes, visual-review criteria, and SHA-256 checksums are disclosed in [docs/generated-assets.md](docs/generated-assets.md).

## Deployment

`npm run build` creates the static application in `dist/`. GitHub Actions publishes `main` to [GitHub Pages](https://artem-musii.github.io/replay-sol/) over HTTPS. The deployed build injects a restrictive CSP and no-referrer policy in HTML; provider-neutral `_headers` are also included for hosts such as Cloudflare Pages or Netlify that support full response policies.

GitHub Pages does not apply the repository’s `_headers` file, so response-only defenses such as `Permissions-Policy`, COOP/COEP, and `X-Frame-Options` are documented deployment limitations. Site Tools registration and invocation were nevertheless verified in the public top-level page. See [docs/deployment.md](docs/deployment.md) for the exact release record and the stricter-host alternative.

## Project documents

- [Demo script](docs/demo-script.md) and [storyboard](docs/demo-storyboard.md)
- [Devpost submission draft](docs/devpost-submission.md)
- [Judging matrix](docs/judging-matrix.md)
- [Testing guide](docs/testing.md)
- [Dependency and license notes](docs/dependency-notes.md)
- [Implementation status](IMPLEMENTATION_STATUS.md)

## License

Source code in this repository is available under the [MIT License](LICENSE). Generated asset use remains subject to the applicable generation service terms; do not present the synthetic demo images as real incident evidence.
