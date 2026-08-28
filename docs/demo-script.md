# REPLAY under-three-minute demo script

Target edited runtime: **2:52**. Hard ceiling: **2:55**. The uploaded public YouTube video must remain below three minutes and include clear audio. [Official video requirements](https://webmcp.devpost.com/rules)

This is a recording runbook, not evidence that a video or final deployment exists. Record only after the release gates in [hackathon-readiness.md](hackathon-readiness.md) pass.

## Preflight — not part of the video

1. Use the exact final HTTPS URL and commit named in the Devpost submission. Start from the landing page in a clean browser profile with only synthetic demo data.
2. Use the latest ChatGPT/Codex desktop app with **GPT-5.6 Sol or GPT-5.6 Terra**. OpenAI currently says Luna has WebMCP disabled; Site Tools availability remains rollout- and workspace-dependent. [OpenAI Site Tools](https://learn.chatgpt.com/docs/webmcp)
3. Confirm the page reports Site Tools available. In preflight only, inspect the registered tools and verify that native `get_workspace_state` and `validate_case_consistency` calls succeed. Close the technical inspector before recording.
4. From the scenario lab, open **Roundabout reconstruction**. If a saved demo exists, use **Case options → Reset deterministic demo**. Confirm the fixture is synthetic, the scene is calibrated, and no personal data is present.
5. Rehearse the prompts below against a disposable reset. The final take must begin from another clean reset because WebMCP mutations change case version and activity.
6. Keep the agent conversation, Site Tools call activity, and REPLAY workspace legible at 1080p or better. Disable notifications, unrelated extensions, credentials, copyrighted music, and unrelated third-party branding.
7. You may edit out model latency, but preserve truthful call order and one coherent case version. Never splice a result from a different build, scenario state, or model into the sequence.

## Timed script

### 0:00–0:12 — Real problem, real product

**Picture:** Start on the landing scenario lab. Show the four cards, then click **Open case** on **Roundabout reconstruction**.

**Narration:**

> Minor road incidents leave fragments: memory, damage, photos, timing, and disagreement. REPLAY gives a person and an agent one inspectable case instead of flattening everything into chat.

### 0:12–0:30 — Calibrated physical model

**Picture:** In the roundabout workspace, open **Physical model**. Show scene width/height, uncertainty, calibration source, road condition, and speed limit. Close it, select Vehicle A, open **Vehicle size and measurement**, then select its path to show distance, peak speed, turn radius, and advisory count.

**Narration:**

> Road scale, uncertainty, vehicle footprints, wheelbase, and measurement source stay visible. Timed poses produce transparent motion and contact advisories—not a claim of perfect physics or fault.

**Pass cue:** The displayed values and source labels match the final fixture. No value is presented as measured when its source is template or estimated.

### 0:30–0:56 — Actual WebMCP read and validation

**Agent prompt — use verbatim:**

> Use this page's Site Tools to read the scene, claims, and timeline. Run the full consistency check. Summarize the calibration, vehicle dimension sources, confirmed versus reported information, and the top review advisory. Do not change the case or infer fault.

**Expected native calls:** `get_workspace_state`, then `validate_case_consistency` with `scope: "all"`; `focus_workspace_item` is optional if the agent identifies one issue.

**Picture:** Keep Site Tools activity and the workspace visible. Briefly reveal the returned tool names and let the selected issue appear in REPLAY.

**Narration:**

> The agent is reading the same structured scene I see, then asking REPLAY's deterministic engine to validate it. The result preserves confirmed, reported, unknown, and advisory information separately.

**Pass cue:** Both calls are native WebMCP/Site Tools calls. A registered-tool count, ordinary browser automation, or debug-inspector execution is not a substitute.

### 0:56–1:20 — Proposal versus inference

**Agent prompt — use verbatim:**

> With Site Tools, create a review-only coordinated proposal for both current vehicle paths; keep it inside the road and do not apply it. Separately add one branch-scoped agent hypothesis: “The available paths may permit more than one lane-crossing explanation.” Link it to the two paths. Do not claim fault or intent.

**Expected native calls:** a narrow state read if needed, `propose_scene_changes`, and `add_observation` with agent-hypothesis status, agent-inference source, the active branch, and both trajectory IDs.

**Picture:** Show the pending proposal overlay and proposal card while the base geometry remains unchanged. Then open **Facts** and select the new hypothesis.

**Narration:**

> These are two different agent contributions. Geometry is a preview that only a person can accept or reject. The text is stored as an attributable agent hypothesis, never as a confirmed fact.

**Pass cue:** The proposal remains pending; no proposed geometry is applied. Activity attributes the calls to agent/WebMCP. The new fact shows **Agent hypothesis**, source **agent inference**, and no human-confirm button.

### 1:20–1:39 — Human-only confirmation

**Picture:** Still in **Facts**, select the human-authored reported statement beginning “Vehicle A was leaving the roundabout…” and click **Confirm as human-reviewed**. Pause on its **Confirmed by human** badge and human/UI activity entry.

**Narration:**

> The agent cannot confirm its own inference. I can explicitly review a human statement, and REPLAY records that exact human action and provenance.

**Pass cue:** Only the selected human-authored statement becomes confirmed. The agent hypothesis remains unconfirmed and the proposal remains pending.

### 1:39–2:07 — Agent preview, human finalization

**Agent prompt — use verbatim:**

> Build a neutral cited report preview from the current case. Keep the agent hypothesis in the hypothesis appendix, keep open questions explicit, and do not confirm or finalize anything.

**Expected native call:** `build_report_preview`, preceded by a compact state/version read if needed. There must be no WebMCP report-finalization call.

**Picture:** Show the cited preview and its limitations. Click **Review and finalize** yourself, check the three acknowledgements, choose **Continue to confirmation**, then manually click **Finalize factual report**.

**Narration:**

> Site Tools can prepare a citation-bound preview. Finalization is deliberately human-only: I review open questions, acknowledge the method limits, review confirmed facts, and make the final click.

**Pass cue:** The immutable snapshot and activity entry are human/UI-authored. If the preview shows a missing requirement, stop the take and fix the fixture or prompt; never edit around a failed finalization.

### 2:07–2:20 — Open the adversarial case

**Picture:** Click **Close workspace** from Case options, scroll to the scenario lab, and open **Parking-area account contradiction**.

**Narration:**

> Plausible cases should stay quiet. This synthetic adversarial case tests whether the same product can surface a contradictory record without accusing a person.

### 2:20–2:46 — Motion and integrity review

**Agent prompt — use verbatim:**

> Use this page's Site Tools to read the parking scene, claims, and timeline and run the full consistency check. State the reported stationary account separately from the timestamped movement. Name the motion and integrity rule IDs and their assumptions. Do not characterize any person's truthfulness, fault, or intent.

**Expected native calls:** `get_workspace_state`, `validate_case_consistency` with `scope: "all"`, and optionally `focus_workspace_item` for the most relevant trajectory or issue.

**Picture:** Show the reported stationary claim beside the timestamped path, then cut to the visible issue list. Focus the speed/deceleration advisory. Briefly expose the integrity questions about estimated calibration or dimension sourcing.

**Narration:**

> REPLAY does not call anyone dishonest. It shows the conflict: one account is reported as stationary, while the timestamped path implies movement outside the declared envelope. Integrity advisories expose which scale and vehicle inputs are estimated or unsupported.

**Expected current fixture:** motion includes `motion.speed` and `motion.deceleration`; integrity includes calibration and/or dimension-source questions. The structural `geometry.trajectory-teleport` issue may also appear. Reconfirm exact rule IDs and numerical thresholds on the final committed build before recording.

### 2:46–2:52 — Close on value

**Picture:** End with the parking path, focused advisory, neutral question, and attributed activity visible together.

**Narration:**

> REPLAY turns disputed incident fragments into a reviewable record—agents organize complexity, while people keep authority over facts and the final report.

## Recording evidence checklist

### WebMCP proof

- The video visibly shows actual native Site Tools/WebMCP invocations, not only tool registration, the manual fallback, DevTools, or REPLAY's inspector.
- The trace includes successful `get_workspace_state` and `validate_case_consistency` calls in both cases.
- The trace includes `propose_scene_changes`, `add_observation`, and `build_report_preview`, or the narration/script is revised truthfully if a supported model chooses a different valid path.
- The Site Tools “Recently used”/sources view or equivalent retains tool names, inputs, and results for the final evidence bundle.
- The exact model, desktop client/build, timestamp, final live URL, and commit are recorded outside the video and in submission testing notes.

### Product and safety proof

- Roundabout calibration, uncertainty, vehicle dimensions, dimension sources, and metric path summary are readable.
- The proposal is visibly pending and does not alter geometry before a human decision.
- The agent inference is visibly attributed and unconfirmed; it cannot be confirmed through the agent flow.
- The human-reported statement is confirmed only by the presenter's visible UI action.
- The report preview is agent-prepared, but all three acknowledgements, second confirmation, and final click are visibly human actions.
- The parking result separates the reported stationary statement, timestamped movement, deterministic motion findings, and input-integrity questions.
- No narration or UI claim describes the output as lie detection, cheating detection, fault assignment, forensic certification, legal advice, or proof of actual motion.
- Every incident, claim, and image shown is explicitly synthetic demo material; no personal case data appears.

### Submission proof

- Uploaded YouTube visibility is **Public**, not unlisted or private.
- Uploaded duration is below **3:00**; target 2:50–2:55 leaves encoding/title-card margin.
- Audio is intelligible and UI/tool text is readable at 1080p playback.
- The final video shows the same behavior, scenario labels, rules, commit, and URL submitted to Devpost.
- No credentials, notifications, private tabs, unrelated browser history, unlicensed music, or unauthorized incident material appear.
- Play the uploaded video from beginning to end while signed out and test the final live URL in a clean supported client before submission.

## Failure policy

Do not record a manual fallback and describe it as WebMCP. If the supported model does not invoke the intended tools, inspect the full trace, reset the synthetic case, refine only the prompt or tool metadata truthfully, and rerun. If Site Tools are unavailable, document the exact model/client/build and escalate through the [Challenge FAQ support routes](https://webmcp.devpost.com/resources); do not manufacture a successful trace.
