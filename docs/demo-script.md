# REPLAY demo script

Target runtime: **2:36**. Hard ceiling: **2:50**. The Devpost video must remain under three minutes after the final render and upload.

This script uses the deterministic `#demo` route, the live REPLAY workspace, and a Site Tools-capable agent. It avoids terminal footage, hidden state changes, fault conclusions, and claims that the generated evidence is real.

## Recording setup

1. Build and deploy the exact commit to be submitted over HTTPS.
2. Open [https://artem-musii.github.io/replay-sol/#demo](https://artem-musii.github.io/replay-sol/#demo) in the ChatGPT/Codex built-in browser. For a strict WebMCP-enabled Chrome test, use a header-capable deployment or the local production preview because GitHub Pages does not emit the repository’s origin-isolation and permissions response headers.
3. Confirm the header reports Site Tools available. Open **Case options → WebMCP inspector** only during preflight and confirm the expected tools are registered; close it before recording.
4. Reset from **Case options → Reset deterministic demo**, then refresh once. Confirm the title is **Roundabout incident — 17:42**, the case version is stable, and the deliberate geometry inconsistency is present.
5. Use a 1440 × 900 or larger capture, 100% page zoom, a large readable cursor, and a layout where the agent conversation and workspace remain legible.
6. Disable notifications, unrelated extensions, password-manager overlays, and copyrighted music. Use clear narration and the generated/original repository assets only.
7. Rehearse the exact prompts once against the deployed commit. Start the recorded run from a fresh reset.

## Timed narration and actions

### 0:00–0:14 — The problem and product

**Picture:** Begin directly in the demo workspace. Pan across the roundabout scene, evidence-aware inspector, timeline, and activity rail. Do not begin on the landing page.

**Narration:**

> After a minor road incident, memory, photographs, timing, damage, and assumptions become mixed together. REPLAY gives a person and an AI agent one shared visual case model.

**Cursor:** Briefly point to the two vehicles, the timeline, and the certainty labels. Keep moving; do not click yet.

### 0:14–0:35 — Inspect live state

**Agent prompt, verbatim:**

> Inspect this case and separate what is confirmed, reported, unknown, and inconsistent.

**Expected Site Tools:** `get_case_summary`, a narrow `get_workspace_state`, `validate_case_consistency`, then `focus_workspace_item` for the geometry issue. Tool choice may vary, but the call sequence must remain read-first and non-destructive.

**Picture:** Keep both the Site Tools activity and workspace visible. Let the inconsistency focus or highlight on the same page.

**Narration:**

> The agent reads the structured case, not pixels. It can distinguish a human-confirmed observation from a report, an unknown, or a deterministic inconsistency.

**Pass cue:** No case version, canonical mutation activity, or factual content changes during inspection. Completed calls may appear in session-only invocation audit.

### 0:35–0:55 — Propose and review a reconstruction

**Agent prompt, verbatim:**

> Propose coordinated paths for both vehicles from the current information, but do not apply them or decide fault.

**Expected Site Tools:** a targeted state read if needed, then one `propose_scene_changes` call containing both vehicle paths. It must not call the direct trajectory tools for this coordinated change.

**Picture:** Show the pending proposal and base-versus-proposed paths while current geometry remains unchanged. Click **Accept and apply**, then confirm the visible dialog yourself; show both paths update together and the proposal plus human-decision activity entries.

**Narration:**

> For a coordinated change, the agent creates a reversible preview instead of moving the scene behind my back. Only I can adjust, accept, or reject it, and acceptance applies the reviewed revision together.

**Pass cue:** No scene geometry changes before the human click. After acceptance, both paths, proposal status, durable activity, and persistence agree.

### 0:55–1:15 — Human override

**Cursor:** Click the impact event on the timeline so the scene is near contact time. Select Vehicle B, drag it into the inner lane, then press `Shift` + `[` or `Shift` + `]` once to rotate it. Pause long enough for the human-authored activity entry to be readable.

**Narration:**

> The agent is not the owner of the scene. I can correct it directly, rotate it precisely, or lock a detail. That newer human action becomes part of the shared history.

**Pass cue:** Vehicle B remains at the corrected branch trajectory position; the activity feed labels the change as human/UI.

### 1:15–1:45 — Preserve two possibilities

**Agent prompt, verbatim:**

> Revalidate after my correction. Preserve the damage observations and create two hypotheses for who may have crossed the lane.

**Expected Site Tools:** `get_recent_activity`, `validate_case_consistency`, `fork_hypothesis` as needed, trajectory or assumption updates scoped to the branches, and `compare_hypotheses`.

**Picture:** Show the agent respecting the corrected Vehicle B position. Open the hypothesis comparison overlay with two distinct paths. Keep the front-left and rear-right damage markers visible.

**Narration:**

> REPLAY keeps unresolved explanations as branches. Damage and other shared facts stay shared; only the assumptions and paths diverge. Neither branch is labeled true or at fault.

### 1:45–2:08 — Evidence and provenance

**Cursor:** Open **Evidence**. Select the overview, Vehicle A damage, Vehicle B damage, and wet-road image in quick succession. Pause on the **Synthetic demo** badge and linked-item count. Return briefly to **Facts** to show confirmed, reported, and unknown labels.

**Agent prompt, verbatim:**

> Link the evidence and prepare a neutral report using only confirmed facts. Keep unresolved details explicit.

**Expected Site Tools:** `link_evidence` only where a link is missing, then `build_report_preview`. The agent must not confirm a claim or finalize a snapshot.

**Narration:**

> Evidence links remain inspectable, and these images are clearly synthetic demo material. REPLAY never silently converts an agent inference into a confirmed fact.

### 2:08–2:31 — Report and human decision

**Picture:** Show the cited report preview, uncertainty/open-question section, and limitations. Click **Review and finalize** yourself.

**Cursor:** Check the three visible acknowledgements, choose **Continue to confirmation**, then manually click **Finalize factual report** in the confirmation dialog.

**Narration:**

> The agent can prepare a citation-bound preview, but only a person can confirm facts or create the immutable report snapshot. Unresolved details and method limits remain in the report.

**Pass cue:** The activity feed records human finalization. There is no automatic or agent-triggered final click.

### 2:31–2:36 — Closing

**Cursor:** Click **PDF** once and show the successful local export cue. End on the scene, report tab, and activity feed together.

**Narration:**

> Humans provide memory and judgment. Agents organize complexity. REPLAY keeps the difference visible.

## Reset instructions

- Fresh-origin reset: use a clean browser origin with no saved demo data.
- In-workspace reset: **Case options → Reset deterministic demo**.
- Opening `/#demo` alone resumes a valid saved seed-v1, seed-v2, or seed-v3 demo case and is not a reset.
- After an explicit reset, verify `seedVersion = 3`, case version 1, active branch **Baseline reconstruction**, four synthetic evidence items, and the seeded geometry inconsistency before each take.
- Do not reuse a take after hidden warm-up commands. Reads add session audit, while mutations also change case version and durable activity.

## Backup recording sequence

If model latency makes one continuous take awkward, capture these clips from the same deployed commit and fresh fixture, then edit only dead time:

1. clean workspace opening and first read-only Site Tools call;
2. coordinated proposal preview followed by visible human acceptance;
3. human drag and rotation followed by recent-activity reread;
4. branch creation and comparison;
5. evidence badge and provenance links;
6. report preview, human acknowledgements, final confirmation, and export.

Keep call order truthful. Do not splice a result from a different case version into the sequence. If Site Tools are unavailable, the WebMCP inspector may document registration for debugging, but it is not a substitute for recording a real supported agent/browser flow. Resolve availability or record in a compatible Chrome session before submission.

## Final video checks

- Uploaded YouTube duration is under 3:00 and visibility is public.
- Audio is clear; UI labels and Site Tools activity are readable at 1080p.
- The first 30 seconds show both the problem and WebMCP reading the live model.
- No fault, legal, forensic, or truthfulness conclusion is stated.
- Synthetic images are badged and never described as real evidence.
- No copyrighted music, third-party trademarks, credentials, personal records, terminal footage, or unrelated browser UI appears.
- The video matches the submitted commit and live URL.
