# REPLAY WebMCP tool contract

Status: **implemented inventory with verification caveats**, last reconciled with the repository and the 2026-08-26 WebMCP draft on 2026-08-27. The 18 imperative tools and declarative final-review form exist; live Chrome/Site Tools compatibility remains unverified.

## Why WebMCP is fundamental here

REPLAY’s incident model is spatial, temporal, branched, versioned, and provenance-aware. Screen actuation can move a car or fill a field, but it cannot reliably tell an agent which branch a trajectory belongs to, whether a statement is confirmed or merely reported, which evidence supports it, or whether the human corrected the scene after the agent’s previous action. WebMCP exposes those meanings as narrow operations while the human and agent inspect the same live page.

The collaboration loop is therefore bidirectional:

```text
human UI or agent tool
  -> validate the same schema and permissions
  -> invoke the same query or canonical domain command
  -> run deterministic consistency rules
  -> append attributable activity
  -> commit canonical in-memory state
  -> update the visible workspace
  -> save the resulting case through Dexie
  -> return a compact, verifiable result
```

The UI remains complete when WebMCP is absent. WebMCP is a progressive enhancement that improves shared meaning and reliability, not a hidden second application.

## Inventory

“Domain entry point” names below reflect the current adapter. Query helpers are pure projections; writes dispatch the listed canonical command through `ReplayEngine`.

| Tool                           | Purpose                                                                                                                        | State availability                               | Read/write                 | Annotations                                                          | Visible UI effect                                                                                                                                                  | Domain entry point                                                             | Principal failure cases                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | -------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_case_summary`             | Return compact metadata, active branch, blockers, and separate confirmed/reported/disputed/hypothetical counts.                | Any open case.                                   | Read                       | `readOnlyHint: true`; `untrustedContentHint: true`                   | None; may show transient tool activity only.                                                                                                                       | `getCaseSummary`                                                               | No open case; corrupt/migration-blocked state; aborted read.                                                                                             |
| `get_workspace_state`          | Return only requested `scene`, `timeline`, `claims`, `evidence`, `questions`, `hypotheses`, `report`, or `selection` sections. | Any open case.                                   | Read                       | `true`; `true`                                                       | None.                                                                                                                                                              | `getWorkspaceState(section)`                                                   | Empty/unknown section; output budget exceeded; invalid references; abort.                                                                                |
| `get_recent_activity`          | Read recent human, agent, and system actions so the agent detects corrections.                                                 | Any open case.                                   | Read                       | `true`; `true`                                                       | None.                                                                                                                                                              | `getRecentActivity`                                                            | Invalid limit/author; no open case; abort.                                                                                                               |
| `validate_case_consistency`    | Run deterministic scene, timeline, provenance, or report checks; return issues, not speculation.                               | Any open case; optional valid branch.            | Read                       | `true`; `false`                                                      | Issue panel refresh/focus may be requested separately; case facts are unchanged.                                                                                   | `validateConsistency`                                                          | Unknown branch/scope; corrupt references; cancellation during long validation.                                                                           |
| `focus_workspace_item`         | Select and reveal a named actor, trajectory, event, claim, evidence item, question, hypothesis, or issue.                      | Any open case containing the item.               | UI write only              | `false`; `false`                                                     | Changes persisted workspace mode/selection and increments the current case version; it does not alter factual entities.                                            | `engine.execute("workspace.focus")`                                            | Unknown/type-mismatched ID; item not visible in active branch; invalid mode.                                                                             |
| `revert_agent_action`          | Safely undo one still-undoable agent activity.                                                                                 | Open case with eligible activity.                | Write                      | `false`; `false`                                                     | Reverts visible state and appends attributable undo activity.                                                                                                      | `engine.revertAgentAction(...)`                                                | Human/system activity; stale version; already reverted; dependency makes undo unsafe; duplicate request; locked/finalized boundary; abort before commit. |
| `upsert_scene_actor`           | Add or update a vehicle’s label, normalized pose, rotation, and dimensions.                                                    | Scene exists.                                    | Write                      | `false`; `true`                                                      | Vehicle appears/moves on SVG canvas; selection and activity update.                                                                                                | `engine.execute("actor.upsert")`                                               | Unknown actor on update; out-of-range pose/dimensions; locked actor; stale version; duplicate request; abort.                                            |
| `set_actor_trajectory`         | Replace a branch-scoped actor trajectory with ordered normalized keyframes.                                                    | Scene and referenced actor/branch exist.         | Write                      | `false`; `true`                                                      | Path and playback update; actor/path highlights; activity and issues refresh.                                                                                      | `engine.execute("trajectory.set")`                                             | Missing actor/branch; unordered/out-of-range keyframes; locked trajectory; stale/duplicate request; cancellation before commit.                          |
| `mark_impact_event`            | Add or update a branch impact location/time for named actors without confirming it as fact.                                    | Scene and referenced branch/actors exist.        | Write                      | `false`; `true`                                                      | Impact marker and timeline event appear; issues/activity refresh.                                                                                                  | `engine.execute("timeline.upsert")`                                            | `confirmed` status requested; missing actor/branch; invalid time/location; locked marker; duplicate impact rule; stale/duplicate request; abort.         |
| `mark_vehicle_damage`          | Add a sourced, non-confirmed damage marker to a vehicle region.                                                                | Scene and referenced actor exist.                | Write                      | `false`; `true`                                                      | Damage marker appears on vehicle/inspector; links, activity, and hints refresh.                                                                                    | `engine.execute("damage.mark")`                                                | `confirmed` requested; invalid region/source ID; actor locked; stale/duplicate request; abort.                                                           |
| `add_observation`              | Add a sourced claim with branch scope and a status other than confirmed.                                                       | Facts workspace available.                       | Write                      | `false`; `true`                                                      | New fact card appears as agent-authored and unconfirmed; activity/issues update.                                                                                   | `engine.execute("claim.add")`                                                  | Confirmed/human-confirmed requested; blank/oversized text; invalid source/link/branch; stale/duplicate request; abort.                                   |
| `link_evidence`                | Link existing evidence to an existing target, optionally requiring a valid annotation ID on that asset.                        | Evidence workspace available and both IDs exist. | Write                      | `false`; `true`                                                      | Evidence card and target both show the asset-level link; activity/issues update.                                                                                   | `engine.execute("evidence.link")`                                              | Missing/deleted evidence or target; annotation mismatch; duplicate link; stale/duplicate request; abort.                                                 |
| `create_open_question`         | Add a targeted unresolved question with reason, importance, and related IDs.                                                   | Facts/questions workspace available.             | Write                      | `false`; `true`                                                      | Question appears and related items highlight; activity updates.                                                                                                    | `engine.execute("question.add")`                                               | Blank/oversized question; invalid importance or related IDs; stale/duplicate request; abort.                                                             |
| `fork_hypothesis`              | Clone a baseline branch while preserving shared locked facts and recording explicit assumptions.                               | Baseline reconstruction exists.                  | Write                      | `false`; `true`                                                      | New branch tab/card appears and becomes reviewable; activity updates.                                                                                              | `engine.execute("hypothesis.fork")`                                            | Missing/archived source; name collision; invalid assumption refs; stale/duplicate request; abort.                                                        |
| `update_hypothesis_assumption` | Add, edit, or remove one branch-specific assumption.                                                                           | Referenced active hypothesis exists.             | Write                      | `false`; `true`                                                      | Assumption list and branch comparison update; activity/issues refresh.                                                                                             | `engine.execute("hypothesis.add-assumption" / "hypothesis.update-assumption")` | Missing branch/assumption; attempt to overwrite shared confirmed fact; invalid operation; stale/duplicate request; abort.                                |
| `compare_hypotheses`           | Return differences in assumptions, geometry, timing, evidence links, issue counts, and unresolved questions.                   | At least two valid branches exist.               | Read                       | `true`; `true`                                                       | Comparison view/overlay may be opened; facts and branches are unchanged.                                                                                           | `compareHypotheses`                                                            | Fewer than two/distinct branches; archived/missing branch; oversized request; abort.                                                                     |
| `build_report_preview`         | Build a provenance-bound preview, list missing requirements, and navigate to report review; never finalize.                    | A baseline branch exists.                        | Derived/UI write           | `false`; `true`                                                      | Report panel opens with preview, citations, blockers, and agent-working/result states; no activity/version mutation.                                               | `buildReportPreview`                                                           | Version conflict; invalid branch/state; abort before projection; unexpected projection failure.                                                          |
| `add_report_note`              | Propose neutral wording supported by explicit existing claim/evidence IDs; mark it agent-authored and unreviewed.              | Report preview exists.                           | Write                      | `false`; `true`                                                      | Proposed note appears in review state with support links and review badge.                                                                                         | `engine.execute("report.add-note")`                                            | Unsupported/missing IDs; uncited assertion; prohibited fault/legal conclusion; stale/duplicate request; abort.                                           |
| `finalize_factual_report`      | Declarative form action that prepares and opens the visible final review. It does not submit or create a snapshot.             | Visible final review form exists.                | Human-gated UI preparation | Declarative form; no imperative annotations and no `toolautosubmit`. | `toolactivated` marks the form prepared and opens review; `toolcancel` clears prepared state. A person completes three acknowledgements and a second confirmation. | Visible form; the later human control dispatches `report.finalize`.            | Missing preview/acknowledgements; `toolcancel`; human declines; attempt to programmatically finalize.                                                    |

Annotation pairs in the table list `readOnlyHint` first and `untrustedContentHint` second. A write tool can still accept untrusted input; `untrustedContentHint` specifically describes its **output**. Every input is validated regardless of hints.

## Result contract

Imperative tools return compact structured results. Successful mutations await the adapter's post-command `saveCase` call before returning, and the engine notification has already reached React. The tool promise is not transactionally coupled to browser paint, and the save cannot roll back an already-committed engine mutation.

```ts
interface WebMCPResult<T = unknown> {
  ok: boolean;
  message: string;
  caseVersion: number;
  activityId?: string;
  affectedIds: string[];
  issues: ConsistencyIssue[];
  visibleState: {
    workspaceMode: string;
    selectedItemId?: string;
  };
  data?: T;
  code?: string;
}
```

Local tool-schema rejection uses top-level `code: "INVALID_INPUT"` and has no domain error payload. A real domain failure is propagated at top level and also nested at `data.error`, for example:

```ts
{
  ok: false,
  code: "LOCKED_ITEM",
  caseVersion: 8,
  data: {
    error: {
      code: "LOCKED_ITEM",
      message: "timeline-event event-impact is locked",
      lockedItem: {
        id: "event-impact",
        type: "timeline-event",
        lockedBy: "human",
        allowedAlternatives: ["request-human-unlock", "fork-hypothesis"],
      },
    },
  },
}
```

For `VERSION_CONFLICT`, the current version is always the top-level `caseVersion` and is also available at `data.error.details.currentVersion` when the failure came from the engine. There is no `retryable` field. Other current domain codes include `HUMAN_CONFIRMATION_REQUIRED`, `AGENT_FINALIZATION_FORBIDDEN`, `FORBIDDEN_ACTION`, `NOT_FOUND`, `DUPLICATE_EVIDENCE`, and `UNSAFE_REVERT`. Unexpected thrown failures become top-level `EXECUTION_FAILED`; cancellation normally rejects with `AbortError`.

No mutation returns a full case dump. Text derived from users/evidence is covered by `untrustedContentHint: true` and bounded projections.

## Shared commands and human control

- A factual-mutation button and its equivalent tool call the same canonical engine command. The adapter may update presentation-only state, such as report preview or comparison, and calls the shared `saveCase` bridge after a successful engine mutation; it does not append shadow activity or mutate case arrays directly.
- Agent mutations set author `agent`, origin `webmcp`, and the call’s `requestId`. They are visible, attributable, focusable, and undoable when safe.
- The command layer rejects `status: "confirmed"` or `humanConfirmed: true` from any agent origin. Only an explicit human UI review command can confirm a claim.
- Locks, finalized snapshots, and shared confirmed facts are enforced in the domain layer, not merely disabled in UI controls.
- `finalize_factual_report` prepares a visible form. It has no automatic submit attribute and cannot create the immutable snapshot. Finalization requires manual acknowledgements, a click, and a confirmation dialog.

## Version conflicts and idempotency

Every content mutation accepts `expectedVersion` and `requestId`:

1. Validate tool input. Invalid input returns `INVALID_INPUT` before the adapter is called.
2. Check cancellation and translate the payload into a canonical domain command.
3. If `expectedVersion !== caseVersion`, return `VERSION_CONFLICT` and no state/activity change.
4. If `requestId` already completed, return the in-memory receipt or a result synthesized from persisted activity without replaying the command.
5. Validate/reduce the command, increment `caseVersion`, append activity, commit the in-memory case, and notify React subscribers.
6. Await `saveCase` for a successful WebMCP mutation.
7. Reveal affected IDs and return the compact result with freshly read visible-state metadata.

Steps 5 and 6 are not one cross-layer transaction. If step 6 fails, the wrapper can report `EXECUTION_FAILED` even though step 5 already changed the open in-memory case. Exact receipts are in memory; only activity/request IDs persist in the case.

An agent receiving a conflict should reread the smallest necessary state—usually recent activity plus the affected section—and decide again. It must not overwrite the human’s newer correction.

## Lifecycle and cancellation

Register with the current API only after hydration:

```ts
await document.modelContext.registerTool(tool, {
  signal: lifecycleController.signal,
});
```

- One lifecycle controller owns each deterministic registration group (base, scene, facts, hypothesis, report).
- Abort the group when its meaningful state disappears or the workspace unmounts.
- Do not churn registrations when selection or other minor state changes.
- The separate `execute(_input, { signal })` signal is checked before adapter and engine work; fake-adapter tests also cover in-flight rejection and cleanup.
- Cancellation before the engine command produces no domain mutation, persistence write, version increment, or activity event. Cancellation after the synchronous engine commit does not roll back state, and Dexie persistence does not currently accept the invocation signal.

## Prompt-injection boundary

Evidence notes, imported statements, filenames, witness text, and agent-authored hypotheses are case **data**, never instructions. Tools:

- use fixed developer-owned descriptions and allowlisted schemas;
- resolve opaque IDs instead of executing text;
- never interpret evidence text as a command or interpolate it into executable HTML/SVG;
- mark read outputs containing that content with `untrustedContentHint: true`;
- do not expose whole-case deletion, external sharing/sending, third-party evidence upload, fault determination, or automatic finalization tools.

## Current API references

- [WebMCP Draft Community Group Report, 2026-08-26](https://webmachinelearning.github.io/webmcp/)
- [Chrome Imperative API, updated 2026-08-20](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
- [Chrome Declarative API, published 2026-05-18](https://developer.chrome.com/docs/ai/webmcp/declarative-api)
- [Chrome WebMCP best practices](https://developer.chrome.com/docs/ai/webmcp/best-practices)
- [Chrome WebMCP tool security, updated 2026-07-01](https://developer.chrome.com/docs/ai/webmcp/secure-tools)
- [OpenAI Site Tools, retrieved 2026-08-27](https://learn.chatgpt.com/docs/webmcp)
