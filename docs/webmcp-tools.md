# REPLAY WebMCP tool contract

Status: **implemented, CI-verified, and deployed with client-evidence caveats**, last reconciled on 2026-08-28 with application commit `00688d8a51fb783dbf147e08ece60470b8877544` and the 2026-08-26 WebMCP draft. The release defines 19 imperative tools plus the declarative final-review form: 18 before report preview and 19 after `add_report_note` joins. Current deterministic browser tests use a standards-compatible registry to verify the 18→19 lifecycle plus read, mutate, idempotency, conflict, cancellation, and human-gate behavior. A prior `df599f3` deployed-bundle audit used that non-native registry to verify durable observation persistence across a cache-busted new-document navigation, transient-preview clearing, and reset; that historical live audit is not attributed to the current artifact or presented as a supported-model run. A separate current-release smoke in the Codex in-app browser surfaced all 18 baseline tools from the deployed page and the workspace reported `18 registered`; this is native discovery/registration evidence, not a supported-model execution trace. OpenAI's current Site Tools browser exposes top-level imperative JavaScript tools, not declarative HTML form tools. Ordinary browser interaction with a form is not a WebMCP call or authorization to operate REPLAY's human confirmation controls. The preserved `f980d28` native 17/18-tool smoke remains historical; current supported-model execution proof is pending.

## Why WebMCP is fundamental here

REPLAY’s incident model is spatial, temporal, branched, versioned, and provenance-aware. Screen actuation can move a car or fill a field, but it cannot reliably tell an agent which branch a trajectory belongs to, whether a statement is confirmed or merely reported, which evidence supports it, or whether the human corrected the scene after the agent’s previous action. WebMCP exposes those meanings as narrow operations while the human and agent inspect the same live page.

The collaboration loop is therefore bidirectional:

```text
human UI or agent tool
  -> validate the same schema and permissions
  -> invoke the same query or canonical domain command
  -> run deterministic consistency rules where applicable
  -> human mutation: live commit + notify, then queued CAS save
  -> WebMCP mutation: isolated stage -> CAS save -> live commit + notify
       post-save abort/live conflict -> compensating CAS restore
  -> read/UI-only/rejection: render a capped session audit only
  -> return a compact, verifiable result

cancellation before primary persistence begins -> neither mutation nor audit entry
```

The UI remains complete when WebMCP is absent. WebMCP is a progressive enhancement that improves shared meaning and reliability, not a hidden second application.

## Inventory

“Domain entry point” names below reflect the current adapter. Query helpers are pure projections; writes dispatch the listed canonical command through `ReplayEngine`.

| Tool                           | Purpose                                                                                                                        | State availability                               | Read/write                 | Annotations                                                          | Visible UI effect                                                                                                                                                  | Domain entry point                                                           | Principal failure cases                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | -------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_case_summary`             | Return compact metadata, active branch, blockers, and separate confirmed/reported/disputed/hypothetical counts.                | Any open case.                                   | Read                       | `readOnlyHint: true`; `untrustedContentHint: true`                   | Session invocation entry only; canonical case/selection are unchanged.                                                                                             | `getCaseSummary`                                                             | No open case; corrupt/migration-blocked state; aborted read.                                                                                                                    |
| `get_workspace_state`          | Return only requested `scene`, `timeline`, `claims`, `evidence`, `questions`, `hypotheses`, `report`, or `selection` sections. | Any open case.                                   | Read                       | `true`; `true`                                                       | Session invocation entry only; canonical case/selection are unchanged.                                                                                             | `getWorkspaceState(section)`                                                 | Empty/unknown section; output budget exceeded; invalid references; abort.                                                                                                       |
| `get_recent_activity`          | Read recent human, agent, and system actions so the agent detects corrections.                                                 | Any open case.                                   | Read                       | `true`; `true`                                                       | Returns the pre-entry merged view, then adds this completed call to session audit; canonical case is unchanged.                                                    | `getRecentActivity`                                                          | Invalid limit/author; no open case; abort.                                                                                                                                      |
| `validate_case_consistency`    | Run deterministic scene, timeline, provenance, or report checks; return issues, not speculation.                               | Any open case; optional valid branch.            | Read                       | `true`; `true`                                                       | Session invocation entry only; issue focus requires a separate call and case facts are unchanged.                                                                  | `validateConsistency`                                                        | Unknown branch/scope; corrupt references; cancellation during long validation.                                                                                                  |
| `focus_workspace_item`         | Select and reveal a named actor, trajectory, event, claim, evidence item, question, hypothesis, or issue.                      | Any open case containing the item.               | UI write only              | `false`; `true`                                                      | Changes persisted workspace mode/selection and increments the current case version; it does not alter factual entities.                                            | `engine.stage("workspace.focus")`                                            | Unknown/type-mismatched ID; item not visible in active branch; invalid mode.                                                                                                    |
| `revert_agent_action`          | Safely undo one still-undoable agent activity.                                                                                 | Open case with eligible activity.                | Write                      | `false`; `true`                                                      | Reverts visible state and appends attributable undo activity.                                                                                                      | `engine.stageAgentActionRevert(...)`                                         | Human/system activity; stale version; already reverted; dependency makes undo unsafe; duplicate request; locked/finalized boundary; abort before primary save or staged commit. |
| `upsert_scene_actor`           | Add or update a vehicle’s label, normalized pose, rotation, and dimensions.                                                    | Scene exists.                                    | Write                      | `false`; `true`                                                      | Vehicle appears/moves on SVG canvas; selection and activity update.                                                                                                | `engine.stage("actor.upsert")`                                               | Unknown actor on update; out-of-range pose/dimensions; locked actor; stale version; duplicate request; abort.                                                                   |
| `set_actor_trajectory`         | Replace a branch-scoped actor trajectory with ordered normalized keyframes.                                                    | Scene and referenced actor/branch exist.         | Write                      | `false`; `true`                                                      | Path and playback update; actor/path highlights; activity and issues refresh.                                                                                      | `engine.stage("trajectory.set")`                                             | Missing actor/branch; unordered/out-of-range keyframes; locked trajectory; stale/duplicate request; cancellation before primary save or staged commit.                          |
| `propose_scene_changes`        | Create a coordinated, preview-only position/trajectory proposal for at least two distinct actors.                              | Referenced actors/branches exist.                | Proposal-ledger write      | `false`; `true`                                                      | Proposal card and geometry deltas appear; current scene geometry is unchanged until a human UI decision.                                                           | `engine.stage("proposal.create")`                                            | Duplicate actor change; invalid geometry/reference; locked/stale target; stale/duplicate request; abort.                                                                        |
| `mark_impact_event`            | Add or update a branch impact location/time for named actors without confirming it as fact.                                    | Scene and referenced branch/actors exist.        | Write                      | `false`; `true`                                                      | Impact marker and timeline event appear; issues/activity refresh.                                                                                                  | `engine.stage("timeline.upsert")`                                            | `confirmed` status requested; missing actor/branch; invalid time/location; locked marker; duplicate impact rule; stale/duplicate request; abort.                                |
| `mark_vehicle_damage`          | Add a sourced, non-confirmed damage marker to a vehicle region.                                                                | Scene and referenced actor exist.                | Write                      | `false`; `true`                                                      | Damage marker appears on vehicle/inspector; links, activity, and hints refresh.                                                                                    | `engine.stage("damage.mark")`                                                | `confirmed` requested; invalid region/source ID; actor locked; stale/duplicate request; abort.                                                                                  |
| `add_observation`              | Add a sourced claim with branch scope and a status other than confirmed.                                                       | Facts workspace available.                       | Write                      | `false`; `true`                                                      | New fact card appears as agent-authored and unconfirmed; activity/issues update.                                                                                   | `engine.stage("claim.add")`                                                  | Confirmed/human-confirmed requested; blank/oversized text; invalid source/link/branch; stale/duplicate request; abort.                                                          |
| `link_evidence`                | Link an evidence asset or one annotation to a claim, event, actor, trajectory, damage, hypothesis, or assumption.              | Evidence workspace available and both IDs exist. | Write                      | `false`; `true`                                                      | Asset/annotation relationship is visible on both sides; an assumption link becomes supporting evidence; activity/issues update.                                    | `engine.stage("evidence.link")`                                              | Missing/deleted evidence or target; annotation mismatch; duplicate link; stale/duplicate request; abort.                                                                        |
| `create_open_question`         | Add a targeted unresolved question with reason, importance, and related IDs.                                                   | Facts/questions workspace available.             | Write                      | `false`; `true`                                                      | Question appears and related items highlight; activity updates.                                                                                                    | `engine.stage("question.add")`                                               | Blank/oversized question; invalid importance or related IDs; stale/duplicate request; abort.                                                                                    |
| `fork_hypothesis`              | Clone a baseline branch while preserving shared locked facts and recording explicit assumptions.                               | Baseline reconstruction exists.                  | Write                      | `false`; `true`                                                      | New branch tab/card appears and becomes reviewable; activity updates.                                                                                              | `engine.stage("hypothesis.fork")`                                            | Missing/archived source; name collision; invalid assumption refs; stale/duplicate request; abort.                                                                               |
| `update_hypothesis_assumption` | Add, edit, or remove one branch-specific assumption.                                                                           | Referenced active hypothesis exists.             | Write                      | `false`; `true`                                                      | Assumption list and branch comparison update; activity/issues refresh.                                                                                             | `engine.stage("hypothesis.add-assumption" / "hypothesis.update-assumption")` | Missing branch/assumption; attempt to overwrite shared confirmed fact; invalid operation; stale/duplicate request; abort.                                                       |
| `compare_hypotheses`           | Return deterministic branch differences and visibly open the comparison.                                                       | At least two valid branches exist.               | UI write only              | `false`; `true`                                                      | Comparison view/overlay opens; factual entities, case version, canonical activity, and persistence are unchanged; session audit records invocation.                | `compareHypotheses`                                                          | Fewer than two/distinct branches; archived/missing branch; oversized request; abort.                                                                                            |
| `build_report_preview`         | Build a provenance-bound preview, return missing requirements/unresolved question IDs, and open report review; never finalize. | A baseline branch exists.                        | Derived/UI write           | `false`; `true`                                                      | Report panel opens with preview/citations/blockers; no canonical activity/version mutation; session audit records invocation.                                      | `buildReportPreview`                                                         | Version conflict; invalid branch/state; abort before projection; unexpected projection failure.                                                                                 |
| `add_report_note`              | Propose neutral wording supported by explicit existing claim/evidence IDs; mark it agent-authored and unreviewed.              | Report preview exists.                           | Write                      | `false`; `true`                                                      | Proposed note appears in review state with support links and review badge.                                                                                         | `engine.stage("report.add-note")`                                            | Unsupported/missing IDs; uncited assertion; prohibited fault/legal conclusion; stale/duplicate request; abort.                                                                  |
| `finalize_factual_report`      | Declarative form action that prepares and opens the visible final review. It does not submit or create a snapshot.             | Visible final review form exists.                | Human-gated UI preparation | Declarative form; no imperative annotations and no `toolautosubmit`. | `toolactivated` marks the form prepared and opens review; `toolcancel` clears prepared state. A person completes three acknowledgements and a second confirmation. | Visible form; the later human control dispatches `report.finalize`.          | Missing preview/acknowledgements; `toolcancel`; human declines; attempt to programmatically finalize.                                                                           |

Annotation pairs in the table list `readOnlyHint` first and `untrustedContentHint` second. All 19 imperative tools set `untrustedContentHint: true` because even compact success or failure results can contain case-derived text or metadata. A write tool can also accept untrusted input; the hint describes its **output**, and every input is validated regardless of hints.

All noncancelled tool calls without a canonical domain activity ID—including successful reads/UI-only calls and rejected calls—may add one visible, capped session audit entry. That entry lives outside `ReplayCase`, disappears on reload, and changes neither case version nor persistence. `get_recent_activity` merges canonical and session entries, sorts newest first, filters the requested author, and only then applies the requested limit.

## Result contract

Imperative tools return compact structured results. A successful mutation is first evaluated against an isolated copy of the complete engine state, including history and request receipts. The adapter then awaits a version-checked `saveCase`; only after that resolves does it adopt the staged state and notify React. If cancellation or a live-version conflict occurs after the save resolves, the adapter explicitly compensates the durable write before returning. The tool promise is not transactionally coupled to browser paint.

```ts
interface WebMCPResult<T = unknown> {
  ok: boolean;
  message: string;
  caseVersion: number;
  activityId?: string;
  idempotent?: boolean;
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

For `VERSION_CONFLICT`, the current version is always the top-level `caseVersion` and is also available at `data.error.details.currentVersion` when the failure came from the engine. There is no `retryable` field. Other current domain codes include `IDEMPOTENCY_CONFLICT`, `HUMAN_CONFIRMATION_REQUIRED`, `AGENT_FINALIZATION_FORBIDDEN`, `FORBIDDEN_ACTION`, `NOT_FOUND`, `DUPLICATE_EVIDENCE`, and `UNSAFE_REVERT`. A rejected primary save or an unconfirmed compensation returns `PERSISTENCE_FAILED`. Unexpected thrown failures become top-level `EXECUTION_FAILED`; cancellation normally rejects with `AbortError`.

No mutation returns a full case dump. Every imperative tool sets `untrustedContentHint: true`, and text derived from users/evidence is limited to bounded projections.

Invoking a tool discloses its compact structured result to the connected Site Tools client/model service. That can include case text and metadata, but the tools do not return uploaded evidence image bytes. This external processing boundary is distinct from REPLAY's browser-local storage.

## Shared commands and human control

- A factual-mutation button and its equivalent tool call the same canonical engine command. The adapter may update presentation-only state, such as report preview or comparison, and uses the shared `saveCase` bridge while the engine mutation remains staged. It never mutates canonical case arrays directly; the workspace separately owns session-only invocation audit.
- Agent mutations set author `agent`, origin `webmcp`, and the call’s `requestId`. They are visible, attributable, focusable, and undoable when safe.
- The command layer rejects `status: "confirmed"` or `humanConfirmed: true` from any agent origin. Only an explicit human UI review command can confirm a claim.
- `propose_scene_changes` can write only a proposal ledger entry. Only human/UI `proposal.adjust`, `proposal.accept`, or `proposal.reject` may decide it. Acceptance revalidates every saved baseline and lock before applying the latest revision, so failure cannot partially move the scene.
- Locks, finalized snapshots, and shared confirmed facts are enforced in the domain layer, not merely disabled in UI controls.
- `finalize_factual_report` prepares a visible form in declarative-compatible Chrome. OpenAI's current Site Tools browser does not expose declarative HTML form tools as Site Tools. ChatGPT Work or Codex may still interact with forms through ordinary browser capabilities, but those interactions are not WebMCP calls and must not operate REPLAY's human-only acknowledgement or confirmation controls. The form has no automatic submit attribute and cannot create the immutable snapshot; finalization requires the human review path.

## Version conflicts and idempotency

Every content mutation accepts `expectedVersion` and `requestId`:

1. Validate tool input. Invalid input returns `INVALID_INPUT` before the adapter is called.
2. Check cancellation, retain the validated caller intent, and translate the payload into a canonical domain command. State-derived adapter enrichment is not part of the caller intent.
3. Bind `requestId` to a compact fingerprint of tool type, actor/origin, and the full validated semantic payload; `requestId` and `expectedVersion` themselves are excluded. Revert fingerprints include the requested activity target.
4. If the same request already completed with the same fingerprint, return the exact in-memory receipt with `idempotent: true` without requiring the stale `expectedVersion`, honoring a mutation pause, or performing another save. After reload, persisted activity synthesizes an idempotent response with the original activity ID, activity `caseVersion`, summary, and affected IDs. Reusing the ID for a different intent returns `IDEMPOTENCY_CONFLICT` with no mutation. Legacy activity without a fingerprint retains action-type-only compatibility.
5. If a new request has `expectedVersion !== caseVersion`, return `VERSION_CONFLICT` with no canonical state/activity change; the noncancelled failed call can appear in session audit.
6. Validate and reduce the command against an isolated engine copy, including its activity, history, and receipt state.
7. Await the bridge's durable compare-and-swap save against the live baseline version. A rejected primary save occurs before live commit and is never compensated.
8. Commit and notify subscribers only if the live engine still matches the staged baseline. Cancellation or a live conflict after a resolved save first triggers an explicit compensation save.
9. Reveal affected IDs and return the compact result with freshly read visible-state metadata.

The engine and Dexie are not one physical transaction. Staging plus durable compare-and-swap gives normal success and rejected-primary-save paths all-or-nothing live/durable behavior, while compensation reconciles a resolved save followed by cancellation or a live conflict. If that compensation fails, the adapter cannot guarantee cross-layer atomicity: it leaves the live mutation uncommitted, returns `PERSISTENCE_FAILED`, and retains the failure in session audit so durable recovery is explicit. Exact receipts remain in memory; persisted activity stores the fingerprint and enough receipt metadata to prevent replay after reload, but not a separate copy of the full original result payload.

An agent receiving a conflict should reread the smallest necessary state—usually recent activity plus the affected section—and decide again. It must not overwrite the human’s newer correction. Human UI corrections that directly replace eligible agent work can be durably classified `human-override` with the overridden agent activity ID, so both records remain inspectable.

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
- Cancellation before primary persistence begins produces no domain mutation, persistence write, version increment, canonical activity, or session invocation audit. Cancellation while the primary save is pending waits for its outcome because Dexie does not accept the invocation signal. If the save resolves, the adapter compensates it before rejecting with `AbortError`; if compensation fails, the more actionable `PERSISTENCE_FAILED` result is returned and audited.

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
- [OpenAI Site Tools, retrieved 2026-08-28](https://learn.chatgpt.com/docs/webmcp)
