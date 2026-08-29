# REPLAY WebMCP Challenge readiness

Status reviewed: **2026-08-29, Europe/Madrid**

## Decision

REPLAY is a credible Stage 2 contender, but it is **not submission-ready yet**. The current source presents a coherent product rather than only a technical proof of concept: it has a shared human-agent case model, four deterministic road scenarios including a path-derived 65–80 km/h straight-road case, calibrated vehicle footprints, exact actor-pair impact placement in multi-vehicle cases, transparent motion and geometry checks, stable local-case resume/listing, provenance, attributable agent work, and state-bound human-only completeness, claim-confirmation, and report-finalization controls.

The remaining risks are proof and release risks, not a missing product thesis. Three hard blockers remain:

1. a public YouTube demo under three minutes, with audio, that visibly includes actual WebMCP calls;
2. a retained live invocation trace from a currently supported Site Tools model; and
3. one immutable final commit whose tests, deployed artifact, and live URL are verified as the same release.

This document is an audit and release plan. It does **not** assert that the final video has been recorded, that the supported-model run has passed, or that the current working tree has been deployed.

Separate entrant-owned submission checks also remain manual: confirm eligibility, join the Challenge with the submitting Devpost account, identify the authorized representative if entering as a team or organization, and confirm the final public repository's About panel visibly detects the MIT license. Repository documentation cannot perform or prove those account-level actions.

## Authority, deadline, and source order

The governing sources are:

- [Official Challenge rules](https://webmcp.devpost.com/rules) — dates, eligibility, project and submission requirements, judging, and post-deadline modification rules.
- [OpenAI WebMCP Challenge page and FAQ](https://openai.com/webmcp-challenge/) — OpenAI's summary of the purpose, deadline, required deliverables, testing path, and judging criteria.
- [Devpost Challenge page](https://webmcp.devpost.com/) — current submission checklist and the four judging criteria.
- [Devpost resources and FAQ](https://webmcp.devpost.com/resources) — practical submission, testing, existing-project, and freeze guidance.
- [OpenAI Site Tools documentation](https://learn.chatgpt.com/docs/webmcp) — current ChatGPT/Codex WebMCP availability and supported models.

If these sources conflict, the official rules and Challenge website govern. Recheck them immediately before submitting.

The submission deadline is **Thursday, September 3, 2026 at 1:00 p.m. PDT**, which is **22:00 CEST in Madrid**. The rules define the judging period as September 4 at 10:00 a.m. PDT through September 21 at 5:00 p.m. PDT and say winners are expected around September 23. Keep the submitted project available free of charge and without restriction through the end of that judging period. [Official rules](https://webmcp.devpost.com/rules)

## What “real-world value” means here

The rules do not require a certified forensic simulator or “100% realism.” Stage 2 Potential Impact asks whether the project makes a credible, specific case for a real problem and real audience, and whether the demonstrated solution actually addresses that problem. Execution separately asks for a complete, coherent, working product rather than a technical proof of concept. [Judging criteria](https://webmcp.devpost.com/)

For REPLAY, the defensible real-world claim is:

> Drivers, fleet and rental support teams, claims-intake staff, and neutral reviewers need to turn fragmented accounts of minor, no-injury road incidents into one inspectable record. REPLAY lets a person and an agent organize timed geometry, vehicle dimensions, claims, evidence, uncertainty, contradictions, and open questions without silently converting inference into fact or deciding fault.

That is useful even when inputs are approximate. Calibration source, uncertainty, vehicle-dimension source, and deterministic rule assumptions remain visible. The safe claim is **review support and contradiction discovery**, not forensic truth, lie detection, collision causation, or legal liability. A bounded, inspectable model is more credible under the rules than an unsupported promise of perfect physics.

No user adoption, insurer validation, forensic certification, or production security review is evidenced in the repository. Do not claim any of those in the submission.

## Stage 1 and submission compliance map

Stage 1 is pass/fail: the project must reasonably fit the human-agent web theme and genuinely use WebMCP. A submission that misses a required deliverable may never reach Stage 2. [Official rules, Sections 4 and 7](https://webmcp.devpost.com/rules)

| Requirement                                                                                                  | Current evidence                                                                                                                                                                                                                                                       | Status / release action                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebMCP-powered web app for humans and agents                                                                 | Nineteen narrow imperative Site Tools are defined through `document.modelContext.registerTool(...)`. The UI and WebMCP adapter share the validated domain command layer.                                                                                               | **Implemented locally.** Capture a native invocation, not only registration or the debug inspector.                                                             |
| Working, coherent experience matching the description and video                                              | The source contains stable case routing/listing, scenario selection, exact multi-vehicle contact authoring, scene/timeline editing, facts/evidence/questions/hypotheses, consistency and human completeness review, activity, report review, persistence, and exports. | **Strong locally.** The final video and text must show only behavior present at the final URL.                                                                  |
| Challenge-period project provenance                                                                          | The repository's first commit, `c95df75`, is dated August 27, 2026, after the August 25 submission opening; the project and its WebMCP implementation were created within the window.                                                                                  | **Ready.** Preserve the dated public history and this provenance statement with the final submission.                                                           |
| Working live URL accessible in ChatGPT's in-app browser or WebMCP-enabled Chrome                             | The unauthenticated HTTPS URL returned 200 on 2026-08-29, but it still serves the earlier committed release while the final seed-v6 candidate remains in the working tree.                                                                                             | **Partial.** Public access works; deploying and verifying the exact final commit remains a hard blocker.                                                        |
| English description explaining WebMCP fit, UX improvement, newly possible collaboration, and implementation  | `README.md`, `docs/devpost-submission.md`, and the architecture/tool docs cover these topics.                                                                                                                                                                          | **Near-ready.** Reconcile them with the four scenarios and final video; remove historical counts or claims that no longer match.                                |
| Public repository with all source/assets/instructions and a visible open-source license                      | The working tree contains the root MIT `LICENSE`, runtime assets, generated-asset disclosure, dependency/license notes, and setup/testing instructions.                                                                                                                | **Local structure ready.** After the final push, confirm the repository is public, every release file is tracked, and GitHub's About panel visibly detects MIT. |
| Public YouTube demo, less than three minutes, with audio, showing the working project and how WebMCP is used | `docs/demo-script.md` is a recording runbook only.                                                                                                                                                                                                                     | **Hard blocker.** Record, upload publicly, play the uploaded result, and confirm its displayed duration is below 3:00.                                          |
| Authorized third-party code, assets, marks, music, and data                                                  | Dependencies and generated demo assets are documented; demo case content is synthetic.                                                                                                                                                                                 | **Final review required.** Use no unlicensed music or incident material and keep unrelated third-party branding out of frame.                                   |
| Free judge access through the judging period; credentials supplied if needed                                 | The intended demo is unauthenticated and synthetic.                                                                                                                                                                                                                    | **Verify on the final URL** in a clean profile and leave it free and unrestricted through September 21, 2026 at 5:00 p.m. PDT.                                  |
| English submission materials                                                                                 | Repository and planned narration are English.                                                                                                                                                                                                                          | **Ready**, subject to final video captions/audio review.                                                                                                        |

The settled dirty current-source audit passed **457/457 Vitest tests across 37 files** on Node 22.13.0 and **230 Playwright project runs with 221 passed, 9 intentional mobile screenshot-owner skips, and 0 failed**, plus 20 checked visual baselines. The browser split was 114/114 desktop Chromium, 105 passed plus 9 intentional skips in mobile Chrome, and 1/1 release smoke in both Firefox and WebKit. V8 coverage was **63.81% statements (6,765/10,601), 54.21% branches (4,479/8,261), 61.89% functions (1,624/2,624), and 65.88% lines (6,262/9,504)**; statement coverage was 84.99% in the domain layer, including 99.46% in `demoScenarios.ts` and 95.47% in physics, plus 84.68% in integration and 89.78% in WebMCP. Format checking, ESLint with zero warnings, strict TypeScript checking, default and `/replay-sol/` production builds on the declared runtime, both dependency audits with zero vulnerabilities, dependency-tree resolution, and `git diff --check` passed.

The Node 22.13.0 root artifact contains **46 public payload files / 5,295,476 bytes**, plus the deployment-control `.nojekyll`, with manifest SHA-256 `4f91a8a4ee753e15ee8fb63d9f14736612dc91fc1f7318b8641685062aa9dd9d`. The `/replay-sol/` artifact contains **46 public payload files / 5,295,872 bytes**, plus `.nojekyll`, with manifest SHA-256 `70323dbd1cd355dd3415a242e6c58a361d8617e35dd84a5cf3b1bc161b8e4e5c`. That exact already-built configured-base artifact passed **12/12** focused runs: release/high-speed/impact **8/8**, handler contract **2/2**, and submission story **2/2** on desktop and mobile. The deterministic handler used the E2E imperative `document.modelContext` polyfill, registered 18 lifecycle-eligible tools without churn, and returned the complete eight-section response in **18,970 bytes**, below the **32,768-byte compact target** and 524,288-byte hard cap; the submission story proved the 18→19→18 lifecycle, proposal/rejection, impact response, provenance-safe inference, human confirmation/finalization, and PDF export.

An operator also opened that exact artifact in the Codex in-app browser and invoked summary, scene/questions state, all-scope validation, and question focus through the native Site Tools bridge. All four calls returned `ok: true` at case v1; validation returned only `integrity.calibration-source`, focus visibly opened it, four session-only activity entries each said **No case change · observed v1**, and browser logs had no warning or error. This is exact-artifact native bridge/UI-agreement evidence, not clean-commit, deployment, supported-model-choice, **Recently used/Sources**, mutation/lifecycle, or cross-client evidence.

Lighthouse 13.4.1 with Chrome 151 completed three warning-free runs per profile against the exact configured-base artifact. The mobile runs scored **89/91/90 performance**, all with **100 accessibility / 100 best practices / 100 SEO**, for median performance **90** and medians of FCP **2.032 s**, LCP **3.308 s**, TBT **17 ms**, CLS **0.00004**, Speed Index **2.032 s**, and TTI **3.308 s**; every desktop run scored **100/100/100/100**, with medians of FCP **0.445 s**, LCP **0.686 s**, TBT **0 ms**, CLS **0.0149**, Speed Index **0.529 s**, and TTI **0.686 s**. Browser and rendered-export review verified desktop/768 px/390 px/320 px presentation without page overflow, arbitrary imported bounds, visible post-contact separation, one-click resume after the impact pause, portable SVG/PNG colors, and a clean four-page PDF with a readable citation and reviewer handoff key. The exact candidate passed the clean-tree artifact verifier from an isolated committed snapshot; hosted CI must repeat the matrix and verifier before deployment.

The earlier operator-directed native Chrome `ModelContext` trace remains historical main-world constructor and mutation/human-gate evidence for the pre-polish 5,229,846-byte artifact. The newer `70323dbd1...` trace is current exact-artifact native bridge evidence but did not inspect the constructor or exercise a mutation. Only an uncoached supported model on the final deployment can supply model-choice evidence.

## Stage 2 scorecard

All four criteria are equally weighted. WebMCP Leverage is also the first tie-breaker. [Official rules, Section 7](https://webmcp.devpost.com/rules)

| Criterion                 | Current case for REPLAY                                                                                                                                                                                                                                                                            | Evidence to put in the demo/submission                                                                                                                              | Principal risk                                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WebMCP Leverage**       | The agent reads live structured state, runs deterministic validation, focuses shared objects, creates attributable facts/questions/hypotheses, proposes coordinated scene changes without applying them, and prepares a report preview. Human and agent use the same case and authorization layer. | Show `get_workspace_state` and `validate_case_consistency` as real Site Tools calls; then show a proposal, an agent inference, and the human-only boundaries.       | Registration, polyfill tests, or inspector execution alone do not prove a supported agent actually chose and invoked the tools.                                   |
| **Execution**             | The product combines stable local-case recovery, five road types, metric calibration, sourced vehicle sizes, timed trajectories, exact actor-pair contact authoring, footprint checks, provenance, human completeness review, persistence, and exports in one coherent workspace.                  | Keep the main video on one calibrated roundabout through the finalized in-app snapshot and export controls; use the labelled high-speed cutaway as the range proof. | The final scenario/physics source is not yet tied to an immutable verified deployment; clean-checkout CI and live current-source evidence are pending.            |
| **Potential Impact**      | Minor incidents produce fragmented memories, photographs, damage records, timing, and disputes. REPLAY makes those inputs inspectable, lets a legitimate no-evidence case close through explicit human review, and catches review-worthy inconsistencies without deciding why they exist.          | Name the audience, show one coherent realistic case, and end with its neutral human-reviewed output; keep the parking contradiction as optional extra evidence.     | Overclaiming forensic realism, truthfulness, fault, or production readiness would weaken credibility. The demo must show the actual benefit, not only explain it. |
| **Creativity & Ambition** | “A shared black box for incidents that did not have one” is distinct from a chat or static claims form. The proposal ledger, provenance separation, local-first evidence, and human decision gates make WebMCP collaboration visible.                                                              | Show one state shared between canvas, Site Tools, activity, and report rather than presenting WebMCP as a hidden chatbot integration.                               | Too many features in three minutes can obscure the core story. Keep the narrative to inspect → validate → propose/infer → human decide.                           |

## Hard blockers and exact exit evidence

### P0 — Public demo video

Exit evidence:

- public YouTube URL;
- uploaded duration **below 3:00**;
- intelligible English audio explaining the product and WebMCP use;
- visible, successful Site Tools calls against the submitted live URL;
- no statement that registration alone, ordinary browser automation, or a debug-panel call is the agent/WebMCP demo; and
- video content matching the submitted commit and live application.

Use [the recording runbook](demo-script.md). The rules say judges need not watch beyond three minutes; the current focused script targets **2:34** with a hard ceiling of **2:45**, using one roundabout proof and one brief, clearly labelled high-speed cutaway. The parking contradiction is optional gallery evidence outside the main video. [Video requirements](https://webmcp.devpost.com/rules)

### P0 — Supported-model live invocation

OpenAI currently documents Site Tools support for **GPT-5.6 Sol** and **GPT-5.6 Terra**; **GPT-5.6 Luna has WebMCP disabled**. Site Tools also depend on rollout, the latest desktop app, workspace type, and the tools exposed by the open page. [OpenAI Site Tools](https://learn.chatgpt.com/docs/webmcp)

Exit evidence:

- exact model, ChatGPT/Codex desktop build, date/time, final URL, and final commit;
- native discovery of the page's tools;
- successful `get_workspace_state` and `validate_case_consistency` invocations with their inputs/results retained;
- visible agreement among returned issue IDs, the workspace issue list, and activity/invocation audit;
- at least one WebMCP mutation or proposal showing attribution and the human authorization boundary; and
- every failure retained rather than averaged away or omitted.

The previously documented tool-discovery smoke and deterministic registry tests remain useful engineering evidence, but they are not this exit evidence.

### P0 — Final commit, CI, deployment, and live verification

The current working tree contains uncommitted realism/scenario work, so no final release commit exists for this audit.

Exit evidence:

1. freeze one commit and release tag;
2. run formatting, lint, typecheck, all Vitest, full Playwright, and production build from a clean checkout;
3. deploy the artifact produced from that commit;
4. verify the final URL in a clean browser and a supported Site Tools client;
5. confirm the scenario lab, roundabout physical model, parking contradiction, tool inventory, safety copy, and report gates are present;
6. retain the commit hash, CI run, artifact/deployment identifiers, final URL, and a cache-busted smoke record; and
7. record the YouTube demo against that same URL and commit.

A historical deployment record cannot be substituted for newly added source, and a local build cannot be described as deployed evidence.

## Submission-day sequence

1. Confirm entrant eligibility, Devpost registration, Challenge membership, and the submitting representative/team details.
2. Recheck the [rules](https://webmcp.devpost.com/rules), [Challenge page](https://webmcp.devpost.com/), [FAQ](https://webmcp.devpost.com/resources), and [OpenAI Site Tools availability](https://learn.chatgpt.com/docs/webmcp).
3. Freeze the release candidate and complete the final clean CI/deployment evidence above.
4. Run the supported-model demo once from a clean synthetic case and retain the full trace.
5. Record and upload the video; verify public playback, audio, legibility, and duration.
6. Update the Devpost text with the exact live URL, public repository, YouTube URL, testing instructions, eligible-period work summary, and final commit.
7. Confirm the final repository is public, GitHub visibly detects the MIT license in its About panel, and all release source/assets/instructions are tracked.
8. Test every submitted link and the complete judge prompt while signed out or in a clean profile.
9. Submit before **September 3, 2026, 13:00 PDT / 22:00 CEST** and retain the confirmation receipt.

## Freeze after the deadline

The official rules prohibit changes to the submitted entry after the Submission Period except narrow changes specifically permitted by the Sponsor/Devpost. The Devpost FAQ is more operationally explicit: after the deadline, do not touch the Devpost submission, submitted repository, or live site until winners are announced; continuing work should happen in a separate fork/copy. [Rules, Section 6](https://webmcp.devpost.com/rules) · [FAQ](https://webmcp.devpost.com/resources)

At the deadline:

- retain the submitted commit/tag, deployed artifact, URL checks, video URL, and Devpost receipt;
- disable automatic production deploys from unrelated pushes;
- do not rewrite history, change repository visibility, replace the video, modify the submitted live build, or edit the Devpost entry;
- monitor uptime without mutating content; and
- if development must continue, fork to an unsubmitted repository and separate deployment that judges cannot confuse with the frozen entry.

## Final go/no-go

Submit only when all three P0 blockers have exit evidence and the live product can complete the exact flow in `docs/demo-script.md`. If native supported-model invocation is unavailable, do not disguise manual mode, Chrome debug execution, or registration as a successful Site Tools run. Escalate through the official Discord/discussion route and preserve the failure honestly.
