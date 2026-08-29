# REPLAY demo storyboard

Visual companion to the canonical [under-three-minute demo script](demo-script.md). Target edited runtime: **2:34**. Hard ceiling: **2:45** so the public upload remains safely below the three-minute rule.

The script is the source of truth for narration, exact prompts, expected calls, and pass cues. This storyboard deliberately references those prompt blocks instead of duplicating them, preventing recording instructions from drifting apart again.

## Frame plan

| Time      | Composition                                                                                                              | Human action                                                                                                              | Agent/Site Tools beat                                                                                                      | Visual pass cue                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:07 | Begin directly in the roundabout workspace. Scene, timeline, inspector, and attributed activity fit on screen.           | Rest the cursor near the scene and point once across scene → timeline → provenance.                                       | None.                                                                                                                      | The product and shared-case thesis are understandable before the first prompt.                                          |
| 0:07–0:36 | Alternate a full-screen native Site Tools crop with an unobscured REPLAY crop; remove only idle latency.                 | Submit the script's **outcome-driven Site Tools proof**, then stop moving the cursor.                                     | Read scene/questions/claims/evidence, validate, focus the blocker, and choose the smallest conservative two-path proposal. | Reads/focus say **No case change**; one pending proposal appears; the base paths stay unchanged.                        |
| 0:36–0:50 | Proposal overlay/card, scene, and the two activity lanes remain visible together.                                        | Open the proposal, reveal the UI controls, and click **Reject**.                                                          | None after the proposal; Site Tools expose no accept/reject action.                                                        | The visible UI-origin rejection records why evidence does not establish either lane explanation.                        |
| 0:50–1:07 | Keep the approximate-contact marker, both vehicles, timeline, and adjacent-path readout legible.                         | Select **Approximate contact**, click **Play authored motion around impact**, and let the 2× clip finish.                 | None.                                                                                                                      | Both paths visibly slow/separate; before→after speeds and the non-simulation disclaimer can be read.                    |
| 1:07–1:31 | Facts, activity, then report preview; preserve legible attribution, path links, open questions, and limitations.         | Submit the script's combined **inference and review** prompt, select the inference briefly, then show the opened preview. | Refresh, preserve one branch-scoped agent inference, and build one neutral preview. No report-note/finalization call.      | Inference remains unconfirmed and source-free; preview preserves questions/limitations and is ready for visible review. |
| 1:31–1:58 | Centered review and confirmation dialogs, ending on the finalized in-app snapshot and export controls.                   | Check all acknowledgements in the UI, continue, and finalize.                                                             | None; no Site Tool can operate these commands.                                                                             | Both review steps and the version-bound snapshot are visibly UI-originated.                                             |
| 1:58–2:15 | Full-screen native **Recently used/Sources** recap with the deployed REPLAY origin and legible input/result summaries.   | Expand the native trace; do not substitute REPLAY's registered-tool badge.                                                | Recap the same roundabout run's read, validation, proposal, inference, and preview calls.                                  | Native invocation proof is tied to the same deployed page and case shown in REPLAY.                                     |
| 2:15–2:27 | One labelled same-release high-speed cutaway with path-derived range, visible braking reduction, and telemetry question. | Show the prepared synthetic case without presenting it as part of the roundabout trace.                                   | None; this is a product-range view, not a substituted tool result.                                                         | “Path-derived, not measured” remains readable.                                                                          |
| 2:27–2:34 | Return to the landing scenario lab and end on all four synthetic scenario cards and the REPLAY mark.                     | Use the existing in-product navigation; rest the cursor for the closing contract.                                         | None.                                                                                                                      | The final frame is unobstructed and the visible-review contract is clear.                                               |

## Screen arrangement

Record one 16:9 canvas at 2560 × 1440 or higher and export at 1440p. Alternate full-screen crops rather than keeping a permanent split view:

```text
┌────────────────────────────────────────────────────────────────┐
│ Full-screen REPLAY: scene + inspector + timeline + activity    │
├────────────────────────────────────────────────────────────────┤
│ hard cut, preserving order and continuity                      │
├────────────────────────────────────────────────────────────────┤
│ Full-screen native Site Tools / Recently used / Sources crop   │
└────────────────────────────────────────────────────────────────┘
```

The REPLAY page must stay large enough to read status, provenance chips, proposal state, and impact metrics after YouTube compression. In preflight, verify that the native call trace can be expanded full-screen and that the model-selected conservative proposal remains visible in a cropped or zoomed base-versus-proposal view.

## Prompt source of truth

Copy these two prompt blocks verbatim from [demo-script.md](demo-script.md):

1. **0:07–0:36 — The outcome-driven Site Tools proof**
2. **1:07–1:31 — Preserve the reason and prepare review**

Do not substitute the shorter historical prompts that asked for a direct vehicle correction, two new branches, evidence relinking, or “only confirmed facts.” Those belonged to an older storyboard and do not match the final proof. The current recording intentionally demonstrates an outcome-driven review-only proposal, a human rejection grounded in missing evidence, authored impact response, one attributed inference, and a human-finalized report that preserves unresolved material. The guide's exact-coordinate prompt is a whole-take fallback only if the supported model cannot reliably produce the bounded outcome during preflight.

## Edit points and overlays

- Use hard cuts only to remove model latency during the main roundabout proof. Preserve truthful tool order and case version. Label the closing high-speed view as a separate synthetic case from the same release.
- A small static lower-third may identify **Human action** and **Agent via Site Tools** during the proposal decision and finalization, but REPLAY's own activity lanes remain the primary evidence.
- Avoid animated title cards; the working product is the opening shot.
- If native call results contain long JSON, collapse them to the tool name, arguments summary, success, and case version. Keep the visible app result in frame.
- Use no third-party music, marks, incident imagery, notifications, account details, or unrelated browser history. Silence under clear narration is preferable to uncertain licensing.

## Continuity checklist

- The entire main proof uses the same final deployed commit, synthetic roundabout run, model, and native Site Tools client; the closing cutaways use that same commit and are explicitly labelled as separate cases.
- The proposal changes only existing interior path points for both vehicles, preserves endpoints/IDs/times, explains its assumptions, and is visibly rejected before any later step.
- The impact playback starts from the untouched baseline and visibly completes after contact.
- The agent hypothesis has both paths as inspectable context (not provenance sources), is branch-scoped, attributed, and never confirmed.
- The report preview follows those actions and still lists every unresolved question and limitation.
- The agent never confirms a claim, decides a proposal, clicks acknowledgements, finalizes a report, or exports the file.
- The finalized in-app snapshot and export controls are visible; an external PDF flash is omitted so native Sources remains legible.
- The closing high-speed cutaway is explicitly a separate synthetic case from the same deployed release and is never presented as part of the roundabout trace.
- Every incident detail and image remains visibly synthetic; no narration claims fault, truth, causation, or simulated collision dynamics.
