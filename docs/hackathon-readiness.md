# REPLAY WebMCP Challenge readiness

Status reviewed: **2026-08-31, Europe/Madrid**

## Decision

REPLAY is submission-ready at the product-and-required-materials level. The current source presents a coherent product rather than only a technical proof of concept: it has a shared human-agent case model, four deterministic road scenarios including a path-derived 65–80 km/h straight-road case, calibrated vehicle footprints, exact actor-pair impact placement in multi-vehicle cases, transparent motion and geometry checks, stable local-case resume/listing, provenance, attributable agent work, and state-bound human-only completeness, claim-confirmation, and report-finalization controls.

The required public video is published at [https://www.youtube.com/watch?v=0INcRPRIR04](https://www.youtube.com/watch?v=0INcRPRIR04): 2:21, English audio, and visible WebMCP collaboration. A retained uncoached **Recently used/Sources** trace remains a recommended judging-strength artifact, not a rule-level submission blocker. The live `release-evidence.json` identifies the exact deployed clean commit and byte-verified payload.

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

| Requirement                                                                                                  | Current evidence                                                                                                                                                                                                                                                                 | Status / release action                                                                                                         |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| WebMCP-powered web app for humans and agents                                                                 | Nineteen narrow imperative Site Tools are defined through `document.modelContext.registerTool(...)`. The UI and WebMCP adapter share the validated domain command layer.                                                                                                         | **Implemented and deployed.** Capture an uncoached supported-model invocation, not only registration or operator bridge calls.  |
| Working, coherent experience matching the description and video                                              | The deployed release contains stable case routing/listing, scenario selection, exact multi-vehicle contact authoring, scene/timeline editing, facts/evidence/questions/hypotheses, consistency and human completeness review, activity, report review, persistence, and exports. | **Ready.** The final video and text must show only behavior present at the final URL.                                           |
| Challenge-period project provenance                                                                          | The repository's first commit, `c95df75`, is dated August 27, 2026, after the August 25 submission opening; the project and its WebMCP implementation were created within the window.                                                                                            | **Ready.** Preserve the dated public history and this provenance statement with the final submission.                           |
| Working live URL accessible in ChatGPT's in-app browser or WebMCP-enabled Chrome                             | The unauthenticated HTTPS URL serves the exact seed-v6 release; `release-evidence.json`, hosted verification, and an independent fetch matched all 46 payload files.                                                                                                             | **Ready.** Repeat the supported-model trace and final signed-out judge journey against this URL.                                |
| English description explaining WebMCP fit, UX improvement, newly possible collaboration, and implementation  | `README.md`, `docs/devpost-submission.md`, and the architecture/tool docs cover these topics and link the deployed release evidence.                                                                                                                                             | **Ready.**                                                                                                                      |
| Public repository with all source/assets/instructions and a visible open-source license                      | The repository is public, the release tree is clean and tracked, the root MIT `LICENSE` is present, and GitHub identifies the license as MIT.                                                                                                                                    | **Ready.** Retain public visibility through judging and confirm the About-panel presentation during final manual submission QA. |
| Public YouTube demo, less than three minutes, with audio, showing the working project and how WebMCP is used | [Public 2:21 YouTube demo](https://www.youtube.com/watch?v=0INcRPRIR04), verified through public embed metadata and local media inspection.                                                                                                                                      | **Ready.** Keep it public and unchanged through judging.                                                                        |
| Authorized third-party code, assets, marks, music, and data                                                  | Dependencies and generated demo assets are documented; demo case content is synthetic.                                                                                                                                                                                           | **Final review required.** Use no unlicensed music or incident material and keep unrelated third-party branding out of frame.   |
| Free judge access through the judging period; credentials supplied if needed                                 | The intended demo is unauthenticated and synthetic.                                                                                                                                                                                                                              | **Verify on the final URL** in a clean profile and leave it free and unrestricted through September 21, 2026 at 5:00 p.m. PDT.  |
| English submission materials                                                                                 | Repository, narration, description, and testing instructions are English.                                                                                                                                                                                                        | **Ready.**                                                                                                                      |

The final local release audit passed **463/463 Vitest tests across 38 files** on Node 22.13.0 and **232 Playwright project runs with 223 passed, 9 intentional mobile screenshot-owner skips, and 0 failed**. V8 coverage was **63.21% statements, 53.25% branches, 61.21% functions, and 65.24% lines**. Format checking, ESLint with zero warnings, strict TypeScript checking, the `/replay/` production build, both dependency audits with zero vulnerabilities, and `git diff --check` passed.

The Node 22.13.0 `/replay/` artifact contains **46 public payload files / 5,322,811 bytes**, plus the deployment-control `.nojekyll`. That exact already-built configured-base artifact passed **12/12** focused runs: release/high-speed/impact **8/8**, handler contract **2/2**, and submission story **2/2** on desktop and mobile. The deterministic handler used the E2E imperative `document.modelContext` polyfill and registered 18 lifecycle-eligible tools without churn. Registry and adapter tests additionally prove a complete start-to-final proposal remains a preview until human acceptance; the submission story proves lifecycle behavior, proposal/rejection, impact response, provenance-safe inference, human confirmation/finalization, and PDF export. The live release evidence supplies the authoritative deployed digest.

An operator opened the preceding `cd88755b` payload in the Codex in-app browser and invoked summary, scene/questions state, all-scope validation, and question focus through the native Site Tools bridge. All four calls returned `ok: true` at case v1; validation returned only `integrity.calibration-source`, focus visibly opened it, four session-only activity entries each said **No case change · observed v1**, and browser logs had no warning or error. This remains historical bridge/UI-agreement evidence for those exact bytes, not current-deployment or supported-model choice, **Recently used/Sources**, mutation/lifecycle, or broad cross-client evidence.

A cache-busted operator smoke of a historical public deployment selected the exact 10.000 s impact marker and advanced to 17.7 s after one Play click; from 9.5 s it auto-paused once at 10.0 s, then advanced to 15.9 s and remained playing after one resume. The public technical inspector visibly showed `propose_scene_changes`, `changes.minItems=1`, full `trajectory-set` start/final semantics, and separate `mark_impact_event` semantics. No console error or failed dynamic request occurred. An ordinary Playwright browser emitted expected unsupported origin-trial `Permissions-Policy` warnings because `document.modelContext` was absent. This remains product/published-contract evidence for those bytes, not native Site Tools execution, model selection, or **Recently used/Sources**.

Lighthouse 13.4.1 with Chrome 151 completed three warning-free runs per profile against the preceding `cd88755b` configured-base payload. The mobile runs scored **89/91/90 performance**, all with **100 accessibility / 100 best practices / 100 SEO**, and every desktop run scored **100/100/100/100**. Those lab measurements and the accompanying manual layout/export review remain historical evidence for that payload rather than a current-payload performance claim. The current release retains automated visual, reflow, impact, and export regressions and passed its clean-tree verifier and hosted CI before deployment.

The earlier operator-directed native Chrome `ModelContext` trace remains historical main-world constructor and mutation/human-gate evidence for the pre-polish 5,229,846-byte artifact. The later `70323dbd1...` trace is likewise historical bridge evidence for `cd88755b`; it did not inspect the constructor or exercise a mutation. Only an uncoached supported model on the final deployment can supply model-choice evidence.

## Stage 2 scorecard

All four criteria are equally weighted. WebMCP Leverage is also the first tie-breaker. [Official rules, Section 7](https://webmcp.devpost.com/rules)

| Criterion                 | Current case for REPLAY                                                                                                                                                                                                                                                                            | Evidence to put in the demo/submission                                                                                                                              | Principal risk                                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WebMCP Leverage**       | The agent reads live structured state, runs deterministic validation, focuses shared objects, creates attributable facts/questions/hypotheses, proposes coordinated scene changes without applying them, and prepares a report preview. Human and agent use the same case and authorization layer. | Show `get_workspace_state` and `validate_case_consistency` as real Site Tools calls; then show a proposal, an agent inference, and the human-only boundaries.       | Registration, polyfill tests, or inspector execution alone do not prove a supported agent actually chose and invoked the tools.                                   |
| **Execution**             | The product combines stable local-case recovery, five road types, metric calibration, sourced vehicle sizes, timed trajectories, exact actor-pair contact authoring, footprint checks, provenance, human completeness review, persistence, and exports in one coherent workspace.                  | Keep the main video on one calibrated roundabout through the finalized in-app snapshot and export controls; use the labelled high-speed cutaway as the range proof. | The immutable release is verified; the remaining risk is showing the strongest path clearly in the supported-model trace and video.                               |
| **Potential Impact**      | Minor incidents produce fragmented memories, photographs, damage records, timing, and disputes. REPLAY makes those inputs inspectable, lets a legitimate no-evidence case close through explicit human review, and catches review-worthy inconsistencies without deciding why they exist.          | Name the audience, show one coherent realistic case, and end with its neutral human-reviewed output; keep the parking contradiction as optional extra evidence.     | Overclaiming forensic realism, truthfulness, fault, or production readiness would weaken credibility. The demo must show the actual benefit, not only explain it. |
| **Creativity & Ambition** | “A shared black box for incidents that did not have one” is distinct from a chat or static claims form. The proposal ledger, provenance separation, local-first evidence, and human decision gates make WebMCP collaboration visible.                                                              | Show one state shared between canvas, Site Tools, activity, and report rather than presenting WebMCP as a hidden chatbot integration.                               | Too many features in three minutes can obscure the core story. Keep the narrative to inspect → validate → propose/infer → human decide.                           |

## Final evidence and submission QA

### Complete — Public demo video

Exit evidence:

- public YouTube URL;
- uploaded duration **below 3:00**;
- intelligible English audio explaining the product and WebMCP use;
- visible, successful Site Tools calls against the submitted live URL;
- no statement that registration alone, ordinary browser automation, or a debug-panel call is the agent/WebMCP demo; and
- video content matching the submitted commit and live application.

The public **2:21** video is available at [https://www.youtube.com/watch?v=0INcRPRIR04](https://www.youtube.com/watch?v=0INcRPRIR04), using one roundabout proof and one brief, clearly labelled high-speed cutaway. The parking contradiction remains optional gallery evidence outside the main video. [Video requirements](https://webmcp.devpost.com/rules)

### Recommended — Retained supported-model live invocation

OpenAI currently documents Site Tools support for **GPT-5.6 Sol** and **GPT-5.6 Terra**; **GPT-5.6 Luna has WebMCP disabled**. Site Tools also depend on rollout, the latest desktop app, workspace type, and the tools exposed by the open page. [OpenAI Site Tools](https://learn.chatgpt.com/docs/webmcp)

Exit evidence:

- exact model, ChatGPT/Codex desktop build, date/time, final URL, and final commit;
- native discovery of the page's tools;
- successful `get_workspace_state` and `validate_case_consistency` invocations with their inputs/results retained;
- visible agreement among returned issue IDs, the workspace issue list, and activity/invocation audit;
- at least one WebMCP mutation or proposal showing attribution and the human authorization boundary; and
- every failure retained rather than averaged away or omitted.

The previously documented tool-discovery smoke and deterministic registry tests remain useful engineering evidence, but they are not this exit evidence.

### Complete — Final commit, CI, deployment, and live verification

The live [`release-evidence.json`](https://artem-musii.github.io/replay/release-evidence.json) identifies the exact clean commit, package lock, base path, file count, byte count, and manifest used by the automated post-deploy verifier. The hosted deterministic suite covers collision response, the high-speed case, WebMCP proposal semantics, and the configured-base release journey. The public video closes the required media gate; a fresh supported-model trace remains recommended evidence.

## Submission-day sequence

1. Confirm entrant eligibility, Devpost registration, Challenge membership, and the submitting representative/team details.
2. Recheck the [rules](https://webmcp.devpost.com/rules), [Challenge page](https://webmcp.devpost.com/), [FAQ](https://webmcp.devpost.com/resources), and [OpenAI Site Tools availability](https://learn.chatgpt.com/docs/webmcp).
3. Reconfirm the immutable release evidence above and avoid product changes after recording begins.
4. Run the supported-model demo once from a clean synthetic case and retain the full trace.
5. Recheck public playback, audio, legibility, and the displayed 2:21 duration.
6. Paste the exact live URL, public repository, YouTube URL, testing instructions, eligible-period work summary, and final release-evidence link into Devpost.
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

Before submitting, confirm the public app, repository, video, and `release-evidence.json` all resolve and describe the same release. If native supported-model invocation is unavailable, do not disguise manual mode, Chrome debug execution, or registration as a successful Site Tools run; preserve that limitation honestly.
