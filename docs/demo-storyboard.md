# REPLAY demo storyboard

Companion to [demo-script.md](demo-script.md). Target runtime: **2:36**.

## Frame plan

| Time      | Composition                                                                                                                                                | Cursor and interface action                                                                           | Agent/tool beat                                                              | Narration objective                                                        | Visual pass cue                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 0:00–0:14 | Workspace fills most of frame; agent panel remains visible at the side. Roundabout, vehicles, timeline, inspector, and activity all fit without scrolling. | Slow point across scene, timeline, provenance labels.                                                 | None.                                                                        | Establish the fragmented-record problem and one shared visual model.       | Judge understands the product before 0:14.                                                 |
| 0:14–0:35 | Agent prompt and compact Site Tools call activity occupy one side; scene remains unobscured.                                                               | Submit the inspect prompt, then stop moving the cursor.                                               | Read summary/state, run deterministic validation, focus the inconsistency.   | Prove semantic state access rather than pixel automation.                  | Read-only calls create no factual activity/version change; the issue highlights visibly.   |
| 0:35–0:55 | Scene and proposal review are both visible; timeline/activity remain in frame.                                                                             | Submit proposal prompt; show preview-only deltas, then click human **Accept and apply** and confirm.  | Create one `propose_scene_changes` preview for both actors; stop for review. | Show useful agent coordination without silently applying geometry.         | No path moves before confirmation; both paths and human decision apply together afterward. |
| 0:55–1:15 | Zoom stays wide enough to show Vehicle B and the activity rail.                                                                                            | Click impact time, drag Vehicle B inward, use one shifted bracket key to rotate.                      | None during the edit.                                                        | Prove direct human control over the shared model.                          | Vehicle remains corrected and a human/UI activity item appears.                            |
| 1:15–1:45 | Hypothesis inspector and canvas overlay share the frame.                                                                                                   | Submit revalidation/branch prompt; activate the comparison overlay if the tool only creates branches. | Read recent activity, validate, fork/update alternatives, compare.           | Preserve uncertainty instead of forcing one story.                         | Two visibly different branch paths; shared damage stays fixed; no truth/fault label.       |
| 1:45–2:08 | Evidence inspector uses the full side panel; scene remains context.                                                                                        | Select four images quickly; pause on Synthetic demo and link count. Submit report prompt.             | Link any missing relationships and build report preview.                     | Show provenance and protect synthetic/evidence boundaries.                 | Demo badges, source/links, and certainty classes are readable.                             |
| 2:08–2:31 | Report preview, then centered finalization dialogs.                                                                                                        | Open review; check all acknowledgements; continue; manually confirm.                                  | Agent does not click or call finalization.                                   | Demonstrate evidence-bound reporting and the human-only decision boundary. | Cited preview and open limitations remain visible; final activity author is human.         |
| 2:31–2:36 | Return to a balanced scene/report/activity frame.                                                                                                          | Click PDF once; rest cursor.                                                                          | None.                                                                        | Land the one-line thesis.                                                  | Successful local export cue, no dead time.                                                 |

## Screen arrangement

Use a single 16:9 recording canvas:

```text
┌───────────────────────────────────────────┬────────────────────┐
│                                           │ Agent conversation │
│             REPLAY live page              │ and Site Tools     │
│       scene + inspector + timeline         │ call activity      │
│                                           │                    │
├───────────────────────────────────────────┴────────────────────┤
│ Keep OS dock, terminal, notifications, and personal tabs out.  │
└────────────────────────────────────────────────────────────────┘
```

The REPLAY page should always be large enough to read case status and provenance chips. If the agent panel reduces the app below its desktop editing breakpoint, record at a wider display resolution rather than browser-zooming below 90%.

## Exact prompts on screen

1. `Inspect this case and separate what is confirmed, reported, unknown, and inconsistent.`
2. `Create a first reconstruction from the current information, but do not decide fault.`
3. `Revalidate after my correction. Preserve the damage observations and create two hypotheses for who may have crossed the lane.`
4. `Link the evidence and prepare a neutral report using only confirmed facts. Keep unresolved details explicit.`

Do not mention internal tool names in the prompt. The recording should prove that the tool descriptions and current page context are sufficient for correct selection.

## Edit points and overlays

- Use hard cuts only to remove waiting time. Do not add artificial zooms, fake cursor movements, or reconstructed tool outputs.
- A small static lower-third may identify **Human action** and **Agent via WebMCP** during the override sequence, but the product’s own activity feed must remain the primary evidence.
- Avoid animated title cards. The workspace itself is the opening shot.
- If call results contain long JSON, keep them collapsed or cropped to the operation name and success/version summary; the visible product change is more important.
- Use no background music unless it is original and clearly licensed. Silence under clear narration is preferred.

## Continuity checklist

- Vehicle colors remain muted blue and silver in every shot.
- The corrected Vehicle B position persists into revalidation.
- Both hypotheses derive from the same corrected case version.
- Damage observations remain shared and unchanged across branch comparison.
- Evidence cards remain visibly synthetic.
- The agent never creates a confirmed claim or immutable snapshot.
- The final report corresponds to the same run and case version shown earlier.
- Export happens only after the human confirmation sequence.
