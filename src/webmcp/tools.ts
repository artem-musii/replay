import type { z } from "zod";

import { toJSONSchema, webMCPInputSchemas } from "./schemas";
import { ReplayWebMCPContractError } from "./types";
import type {
  ReplayAdapterResult,
  ReplayInvocationContext,
  ReplayToolInvocationAudit,
  ReplayVisibleState,
  ReplayWebMCPAdapter,
  ReplayWebMCPCommand,
  WebMCPMutationToolName,
  WebMCPResult,
  WebMCPToolAnnotations,
  WebMCPToolDefinition,
  WebMCPToolGroup,
  WebMCPToolName,
  WorkspaceSection,
} from "./types";

export interface WebMCPToolInstrumentation {
  onStart?(toolName: WebMCPToolName, input: unknown): void;
  onFinish?(toolName: WebMCPToolName, result: unknown): void;
  onCancel?(toolName: WebMCPToolName, reason: unknown): void;
}

export const WEBMCP_READ_OUTPUT_LIMIT_BYTES = 512 * 1024;

interface ToolMetadata {
  title: string;
  description: string;
  annotations: WebMCPToolAnnotations;
}

const READ_UNTRUSTED = { readOnlyHint: true, untrustedContentHint: true } as const;
const WRITE_UNTRUSTED = { readOnlyHint: false, untrustedContentHint: true } as const;
const RESULT_CONTRACT =
  " Returns versioned {ok:boolean, data?, visibleState} with a machine-readable code on failure.";

const metadata = {
  get_case_summary: {
    title: "Get case summary",
    description:
      "Reads compact open-case metadata, certainty counts, the active branch, and unresolved blockers. Use before planning or to refresh caseVersion after a human edit. Read-only: it changes neither case state nor visible workspace.",
    annotations: READ_UNTRUSTED,
  },
  get_workspace_state: {
    title: "Get workspace state",
    description:
      "Reads compact live sections without histories, blob addresses, or snapshot bodies. branchId projects scene/timeline but does not activate that branch. Results include coordinateSystem; in-bounds x/y are normalized scene coordinates from 0 to 1 and reusable in mutations. Reports include snapshot previewSummary metadata and the full current visiblePreview with visiblePreviewStatus. Read-only; no UI change.",
    annotations: READ_UNTRUSTED,
  },
  get_recent_activity: {
    title: "Get recent activity",
    description:
      "Reads bounded human, agent, system, and session activity. current revertEligible comes from live command history, not stored undoable metadata. Use after human corrections or agent writes; only an eligible canonical id can be reverted. Read-only with no UI change.",
    annotations: READ_UNTRUSTED,
  },
  validate_case_consistency: {
    title: "Validate case consistency",
    description:
      "Runs deterministic timeline, geometry, motion, damage, provenance, integrity, completeness, or report checks for a branch/scope. Results are review advisories with assumptions, not forensic or intent findings. Read-only; use after edits or before report review.",
    annotations: READ_UNTRUSTED,
  },
  focus_workspace_item: {
    title: "Focus workspace item",
    description:
      "Visibly selects one existing workspace item for shared review. Supply branchId for an inactive-branch trajectory/event; focus does not activate a branch. This is a session-only UI change: no caseVersion or canonical activity change. The invocation remains session-audited.",
    annotations: WRITE_UNTRUSTED,
  },
  revert_agent_action: {
    title: "Revert agent action",
    description:
      "Reverts the latest safely reversible agent/WebMCP mutation. Pass the canonical activity id—not requestId/session id—from a fresh activity item with current revertEligible=true. This mutates visible case state and appends activity; current caseVersion is required.",
    annotations: WRITE_UNTRUSTED,
  },
  upsert_scene_actor: {
    title: "Add or update scene actor",
    description:
      "Adds a vehicle or updates only the supplied fields of an existing actor. Existing-actor position/rotation edits require expectedPoseTarget copied from the latest scene read and fail if its active branch or playhead moved. Creation needs label, normalized pose, and metre dimensions. It mutates scene/activity; trusted measured specifications and locks remain protected. Current caseVersion is required.",
    annotations: WRITE_UNTRUSTED,
  },
  set_actor_trajectory: {
    title: "Set actor trajectory",
    description:
      "Directly creates or replaces canonical trajectory geometry for one actor/branch using ordered normalized keyframes. This applies immediately; use propose_scene_changes for coordinated human review. It mutates scene, timeline, and activity. Valid unlocked targets and current caseVersion are required.",
    annotations: WRITE_UNTRUSTED,
  },
  propose_scene_changes: {
    title: "Propose coordinated scene changes",
    description:
      "Creates a multi-actor preview without applying geometry. actor-pose requires expectedPoseTarget from the latest scene read and fails if branch/playhead moved. Prefer trajectory-keyframe-patch for 1–8 interior edits while preserving path, timing, IDs, and endpoints. Only the proposal ledger changes; a human must adjust, accept, or reject. Current version and unlocked targets are required.",
    annotations: WRITE_UNTRUSTED,
  },
  mark_impact_event: {
    title: "Mark impact event",
    description:
      "Creates a provisional impact or updates the supplied existing impact on its branch. It mutates scene, timeline, and activity at a normalized location/time. Agent impacts cannot be confirmed; valid actors, branch, and current caseVersion are required.",
    annotations: WRITE_UNTRUSTED,
  },
  mark_vehicle_damage: {
    title: "Mark vehicle damage",
    description:
      "Adds sourced, non-confirmed damage to an existing vehicle, separate from movement hypotheses. It mutates the damage ledger/activity and adds cited backlinks, but does not create or confirm a claim. At least one active evidence/observation source, an unlocked actor, and current caseVersion are required.",
    annotations: WRITE_UNTRUSTED,
  },
  add_observation: {
    title: "Add observation",
    description:
      "Adds an unconfirmed observation with provenance, context, certainty, and branch scope. sourceIds are canonical evidence/observation sources; relatedIds are inspectable context such as actors, paths, events, or damage. External attribution needs compatible provenance; agent reasoning uses agent-inference. It mutates facts/activity but cannot confirm. Current caseVersion is required.",
    annotations: WRITE_UNTRUSTED,
  },
  link_evidence: {
    title: "Link evidence",
    description:
      "Links existing evidence or one annotation to a claim, scene item, event, damage, hypothesis, or assumption. It mutates reciprocal relationships/activity and may invalidate an old exact-revision claim confirmation. Existing IDs and current caseVersion are required.",
    annotations: WRITE_UNTRUSTED,
  },
  create_open_question: {
    title: "Create open question",
    description:
      "Creates a prioritized unresolved question related to observations, actors, paths, events, damage, or hypotheses. Direct evidence links are rejected; relate the item that evidence supports. It mutates questions/activity but cannot answer or dismiss. Current caseVersion is required.",
    annotations: WRITE_UNTRUSTED,
  },
  fork_hypothesis: {
    title: "Fork hypothesis",
    description:
      "Forks an alternative branch with explicit assumptions while preserving shared locked facts. Assumption relatedIds accept active supporting evidence only. It mutates branches/activity and opens hypothesis review. A valid source branch and current caseVersion are required.",
    annotations: WRITE_UNTRUSTED,
  },
  update_hypothesis_assumption: {
    title: "Update hypothesis assumption",
    description:
      "Adds, edits, or withdraws one assumption in an active hypothesis. relatedIds accept active supporting evidence only. It mutates the branch/activity without changing shared confirmed facts. Operation-specific fields and current caseVersion are required.",
    annotations: WRITE_UNTRUSTED,
  },
  compare_hypotheses: {
    title: "Compare hypotheses",
    description:
      "Returns assumptions, evidence, issues, questions, and bounded trajectory and event deltas across distinct branches, then opens comparison. It is a session UI change only: it does not activate a branch, mutate facts, or increment caseVersion. Use before human review of alternatives.",
    annotations: WRITE_UNTRUSTED,
  },
  build_report_preview: {
    title: "Build report preview",
    description:
      "Builds and opens a neutral evidence-bound preview. add_report_note becomes available in the next Site Tools inventory. Results keep preview requirement completeness separate from finalized and share-ready status. This UI projection never confirms, shares, or finalizes; a human must review and finalize. Current caseVersion is required.",
    annotations: WRITE_UNTRUSTED,
  },
  add_report_note: {
    title: "Add supported report note",
    description:
      "Adds neutral agent-authored wording supported by existing claim/evidence IDs. The note stays human-unreviewed and mutates case/activity. That mutation invalidates the open preview, so this tool leaves the next inventory; build a fresh preview before another note or final review. Current caseVersion is required.",
    annotations: WRITE_UNTRUSTED,
  },
} as const satisfies Record<WebMCPToolName, ToolMetadata>;

function abortError(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) {
    return signal.reason;
  }
  if (typeof DOMException === "function") {
    return new DOMException("The WebMCP execution was cancelled.", "AbortError");
  }
  const error = new Error("The WebMCP execution was cancelled.");
  error.name = "AbortError";
  return error;
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortError(signal);
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException === "function" &&
      error instanceof DOMException &&
      error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function visibleState(adapter: ReplayWebMCPAdapter): ReplayVisibleState {
  const lifecycle = adapter.getLifecycle();
  return {
    workspaceMode: lifecycle.workspaceMode,
    ...(lifecycle.selectedItemId === undefined ? {} : { selectedItemId: lifecycle.selectedItemId }),
  };
}

function readResult(
  adapter: ReplayWebMCPAdapter,
  message: string,
  caseVersion: number,
  data: unknown,
  issues: readonly Readonly<Record<string, unknown>>[] = [],
): WebMCPResult {
  const result: WebMCPResult = {
    ok: true,
    message,
    caseVersion,
    affectedIds: [],
    issues: [...issues],
    visibleState: visibleState(adapter),
    data,
  };
  let serialized: string;
  try {
    serialized = JSON.stringify(result);
  } catch {
    throw new ReplayWebMCPContractError(
      "OUTPUT_BUDGET_EXCEEDED",
      "The Site Tools read result could not be serialized safely. Request a narrower read.",
    );
  }
  const outputBytes = new TextEncoder().encode(serialized).byteLength;
  if (outputBytes > WEBMCP_READ_OUTPUT_LIMIT_BYTES) {
    throw new ReplayWebMCPContractError(
      "OUTPUT_BUDGET_EXCEEDED",
      `The Site Tools read result is ${String(outputBytes)} bytes, above the ${String(WEBMCP_READ_OUTPUT_LIMIT_BYTES)}-byte safety budget. Request fewer workspace sections or a narrower targeted read.`,
    );
  }
  return result;
}

const STABLE_READ_ATTEMPTS = 2;

async function readStableCaseSnapshot<T>(
  adapter: ReplayWebMCPAdapter,
  context: ReplayInvocationContext,
  read: () => T | Promise<T>,
): Promise<Readonly<{ caseVersion: number; data: T }>> {
  for (let attempt = 0; attempt < STABLE_READ_ATTEMPTS; attempt += 1) {
    const caseVersion = adapter.getLifecycle().caseVersion;
    const data = await read();
    throwIfAborted(context.signal);
    if (adapter.getLifecycle().caseVersion === caseVersion) {
      return { caseVersion, data };
    }
  }
  throw new ReplayWebMCPContractError(
    "VERSION_CONFLICT",
    "The case changed while the read snapshot was being assembled. Retry the read against the current caseVersion.",
  );
}

function adapterResult(adapter: ReplayWebMCPAdapter, result: ReplayAdapterResult): WebMCPResult {
  const complete: WebMCPResult = {
    ok: result.ok,
    message: result.message,
    caseVersion: result.caseVersion,
    ...(result.activityId === undefined ? {} : { activityId: result.activityId }),
    ...(result.idempotent ? { idempotent: true } : {}),
    affectedIds: [...(result.affectedIds ?? [])],
    issues: [...(result.issues ?? [])],
    visibleState: visibleState(adapter),
    ...(result.code === undefined ? {} : { code: result.code }),
    ...(result.data === undefined ? {} : { data: result.data }),
  };
  try {
    if (
      new TextEncoder().encode(JSON.stringify(complete)).byteLength <=
      WEBMCP_READ_OUTPUT_LIMIT_BYTES
    ) {
      return complete;
    }
  } catch {
    // Preserve the canonical outcome and replace only non-contract-safe detail.
  }
  return {
    ...complete,
    message: `${complete.message} Response details were truncated to stay within the Site Tools output safety budget.`,
    affectedIds: complete.affectedIds.slice(0, 50),
    issues: [],
    data: {
      resultTruncated: true,
      totalAffectedIds: complete.affectedIds.length,
      totalIssues: complete.issues.length,
      originalDataOmitted: complete.data !== undefined,
      nextAction:
        "Use get_workspace_state with targeted sections or validate_case_consistency for current detail.",
    },
  };
}

function failureResult(adapter: ReplayWebMCPAdapter, message: string, code: string): WebMCPResult {
  return {
    ok: false,
    message,
    code,
    caseVersion: adapter.getLifecycle().caseVersion,
    affectedIds: [],
    issues: [],
    visibleState: visibleState(adapter),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim().slice(0, 500);
  }
  return "The operation could not be completed.";
}

function validationMessage(error: z.ZodError): string {
  const details = error.issues.slice(0, 4).map((issue) => {
    const path = issue.path.length === 0 ? "input" : issue.path.join(".");
    return `${path}: ${issue.message}`;
  });
  return `Invalid tool input. ${details.join("; ")}`;
}

function requestIdFromInput(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null || !("requestId" in input)) {
    return undefined;
  }
  return typeof input.requestId === "string" ? input.requestId : undefined;
}

function withFreshVisibleState(adapter: ReplayWebMCPAdapter, result: WebMCPResult): WebMCPResult {
  return { ...result, visibleState: visibleState(adapter) };
}

async function recordInvocationWithoutCanonicalActivity(
  adapter: ReplayWebMCPAdapter,
  toolName: WebMCPToolName,
  result: WebMCPResult,
  requestId?: string,
): Promise<void> {
  if (result.activityId !== undefined || adapter.recordToolInvocation === undefined) return;
  const audit: ReplayToolInvocationAudit = {
    toolName,
    ok: result.ok,
    message: result.message,
    caseVersion: result.caseVersion,
    affectedIds: result.affectedIds,
    ...(requestId === undefined ? {} : { requestId }),
  };
  try {
    await adapter.recordToolInvocation(audit);
  } catch {
    // A transient audit presentation failure must not replace the tool result.
  }
}

function defineTool<TSchema extends z.ZodType>(
  adapter: ReplayWebMCPAdapter,
  instrumentation: WebMCPToolInstrumentation,
  name: WebMCPToolName,
  group: WebMCPToolGroup,
  schema: TSchema,
  handler: (
    input: z.output<TSchema>,
    context: ReplayInvocationContext,
  ) => Promise<WebMCPResult> | WebMCPResult,
): WebMCPToolDefinition {
  const toolMetadata = metadata[name];
  return {
    name,
    title: toolMetadata.title,
    description: `${toolMetadata.description}${RESULT_CONTRACT}`,
    inputSchema: toJSONSchema(schema),
    annotations: toolMetadata.annotations,
    validationSchema: schema,
    group,
    async execute(rawInput, options) {
      const signal = options.signal;
      instrumentation.onStart?.(name, rawInput);
      let workingStarted = false;
      let requestId: string | undefined;
      try {
        throwIfAborted(signal);
        const parsed = schema.safeParse(rawInput);
        if (!parsed.success) {
          const result = failureResult(adapter, validationMessage(parsed.error), "INVALID_INPUT");
          await recordInvocationWithoutCanonicalActivity(adapter, name, result);
          instrumentation.onFinish?.(name, result);
          return result;
        }

        requestId = requestIdFromInput(parsed.data);
        workingStarted = true;
        await adapter.setAgentWorking?.({
          active: true,
          toolName: name,
          ...(requestId === undefined ? {} : { requestId }),
        });
        throwIfAborted(signal);

        let result = await handler(parsed.data, { signal, toolName: name });
        if (result.ok && result.affectedIds.length > 0) {
          try {
            await adapter.revealAffected?.(result.affectedIds);
          } catch {
            // Canonical success is not converted to failure by a transient highlight animation.
          }
        }
        result = withFreshVisibleState(adapter, result);
        await recordInvocationWithoutCanonicalActivity(adapter, name, result, requestId);
        instrumentation.onFinish?.(name, result);
        return result;
      } catch (error) {
        if (signal.aborted || isAbortError(error)) {
          instrumentation.onCancel?.(name, error);
          throw error;
        }
        const result = failureResult(
          adapter,
          errorMessage(error),
          error instanceof ReplayWebMCPContractError ? error.code : "EXECUTION_FAILED",
        );
        await recordInvocationWithoutCanonicalActivity(adapter, name, result, requestId);
        instrumentation.onFinish?.(name, result);
        return result;
      } finally {
        if (workingStarted) {
          try {
            await adapter.setAgentWorking?.({ active: false, toolName: name });
          } catch {
            // Clearing transient UI must not replace the canonical tool result.
          }
        }
      }
    },
  };
}

function mutationCommand(
  type: WebMCPMutationToolName,
  input: Readonly<Record<string, unknown>>,
): ReplayWebMCPCommand {
  const { expectedVersion, requestId, ...payload } = input;
  return {
    type,
    payload,
    actor: "agent",
    origin: "webmcp",
    requestId: requestId as string,
    expectedVersion: expectedVersion as number,
  };
}

async function executeMutation(
  adapter: ReplayWebMCPAdapter,
  type: WebMCPMutationToolName,
  input: Readonly<Record<string, unknown>>,
  context: ReplayInvocationContext,
): Promise<WebMCPResult> {
  throwIfAborted(context.signal);
  const result = await adapter.execute(mutationCommand(type, input), context);
  return adapterResult(adapter, result);
}

export function createReplayWebMCPTools(
  adapter: ReplayWebMCPAdapter,
  instrumentation: WebMCPToolInstrumentation = {},
): readonly WebMCPToolDefinition[] {
  return [
    defineTool(
      adapter,
      instrumentation,
      "get_case_summary",
      "base",
      webMCPInputSchemas.get_case_summary,
      async (_, context) => {
        const snapshot = await readStableCaseSnapshot(adapter, context, () =>
          adapter.getCaseSummary(context),
        );
        return readResult(
          adapter,
          "Returned the compact live case summary.",
          snapshot.caseVersion,
          snapshot.data,
        );
      },
    ),

    defineTool(
      adapter,
      instrumentation,
      "get_workspace_state",
      "base",
      webMCPInputSchemas.get_workspace_state,
      async (input, context) => {
        const sections = [...new Set(input.sections)] as WorkspaceSection[];
        const snapshot = await readStableCaseSnapshot(adapter, context, () =>
          adapter.getWorkspaceState(
            sections,
            context,
            input.branchId === undefined ? undefined : { branchId: input.branchId },
          ),
        );
        return readResult(
          adapter,
          `Returned ${String(sections.length)} requested workspace section${sections.length === 1 ? "" : "s"}.`,
          snapshot.caseVersion,
          snapshot.data,
        );
      },
    ),

    defineTool(
      adapter,
      instrumentation,
      "get_recent_activity",
      "base",
      webMCPInputSchemas.get_recent_activity,
      async (input, context) => {
        const snapshot = await readStableCaseSnapshot(adapter, context, () =>
          adapter.getRecentActivity({ limit: input.limit, author: input.author }, context),
        );
        return readResult(
          adapter,
          "Returned bounded recent case activity.",
          snapshot.caseVersion,
          snapshot.data,
        );
      },
    ),

    defineTool(
      adapter,
      instrumentation,
      "validate_case_consistency",
      "base",
      webMCPInputSchemas.validate_case_consistency,
      async (input, context) => {
        const snapshot = await readStableCaseSnapshot(adapter, context, () =>
          adapter.validateConsistency(
            {
              ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
              scope: input.scope,
            },
            context,
          ),
        );
        const issues = snapshot.data;
        return readResult(
          adapter,
          `Consistency validation found ${String(issues.length)} deterministic issue${issues.length === 1 ? "" : "s"}.`,
          snapshot.caseVersion,
          { branchId: input.branchId, scope: input.scope, issueCount: issues.length },
          issues,
        );
      },
    ),

    defineTool(
      adapter,
      instrumentation,
      "focus_workspace_item",
      "base",
      webMCPInputSchemas.focus_workspace_item,
      async (input, context) => {
        const result = await adapter.focusWorkspaceItem(
          {
            itemType: input.itemType,
            itemId: input.itemId,
            ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
          },
          context,
        );
        return adapterResult(adapter, result);
      },
    ),

    defineTool(
      adapter,
      instrumentation,
      "revert_agent_action",
      "base",
      webMCPInputSchemas.revert_agent_action,
      async (input, context) => {
        throwIfAborted(context.signal);
        const result = await adapter.revertAgentAction(input, context);
        return adapterResult(adapter, result);
      },
    ),

    defineTool(
      adapter,
      instrumentation,
      "upsert_scene_actor",
      "scene",
      webMCPInputSchemas.upsert_scene_actor,
      (input, context) => executeMutation(adapter, "upsert_scene_actor", input, context),
    ),
    defineTool(
      adapter,
      instrumentation,
      "set_actor_trajectory",
      "scene",
      webMCPInputSchemas.set_actor_trajectory,
      (input, context) => executeMutation(adapter, "set_actor_trajectory", input, context),
    ),
    defineTool(
      adapter,
      instrumentation,
      "propose_scene_changes",
      "scene",
      webMCPInputSchemas.propose_scene_changes,
      (input, context) => executeMutation(adapter, "propose_scene_changes", input, context),
    ),
    defineTool(
      adapter,
      instrumentation,
      "mark_impact_event",
      "scene",
      webMCPInputSchemas.mark_impact_event,
      (input, context) => executeMutation(adapter, "mark_impact_event", input, context),
    ),
    defineTool(
      adapter,
      instrumentation,
      "mark_vehicle_damage",
      "scene",
      webMCPInputSchemas.mark_vehicle_damage,
      (input, context) => executeMutation(adapter, "mark_vehicle_damage", input, context),
    ),

    defineTool(
      adapter,
      instrumentation,
      "add_observation",
      "facts",
      webMCPInputSchemas.add_observation,
      (input, context) => executeMutation(adapter, "add_observation", input, context),
    ),
    defineTool(
      adapter,
      instrumentation,
      "link_evidence",
      "facts",
      webMCPInputSchemas.link_evidence,
      (input, context) => executeMutation(adapter, "link_evidence", input, context),
    ),
    defineTool(
      adapter,
      instrumentation,
      "create_open_question",
      "facts",
      webMCPInputSchemas.create_open_question,
      (input, context) => executeMutation(adapter, "create_open_question", input, context),
    ),

    defineTool(
      adapter,
      instrumentation,
      "fork_hypothesis",
      "hypothesis",
      webMCPInputSchemas.fork_hypothesis,
      (input, context) => executeMutation(adapter, "fork_hypothesis", input, context),
    ),
    defineTool(
      adapter,
      instrumentation,
      "update_hypothesis_assumption",
      "hypothesis",
      webMCPInputSchemas.update_hypothesis_assumption,
      (input, context) => executeMutation(adapter, "update_hypothesis_assumption", input, context),
    ),
    defineTool(
      adapter,
      instrumentation,
      "compare_hypotheses",
      "hypothesis",
      webMCPInputSchemas.compare_hypotheses,
      async (input, context) => {
        const branchIds = [...new Set(input.branchIds)];
        const snapshot = await readStableCaseSnapshot(adapter, context, () =>
          adapter.compareHypotheses({ branchIds }, context),
        );
        const result = readResult(
          adapter,
          `Compared ${String(branchIds.length)} hypotheses and opened the visible comparison.`,
          snapshot.caseVersion,
          snapshot.data,
        );
        throwIfAborted(context.signal);
        await adapter.revealHypothesisComparison?.(branchIds, context);
        return result;
      },
    ),

    defineTool(
      adapter,
      instrumentation,
      "build_report_preview",
      "hypothesis",
      webMCPInputSchemas.build_report_preview,
      async (input, context) => {
        throwIfAborted(context.signal);
        const result = await adapter.buildReportPreview(
          {
            ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
            expectedVersion: input.expectedVersion,
          },
          context,
        );
        return adapterResult(adapter, result);
      },
    ),
    defineTool(
      adapter,
      instrumentation,
      "add_report_note",
      "report",
      webMCPInputSchemas.add_report_note,
      async (input, context) => {
        throwIfAborted(context.signal);
        const result = await adapter.execute(mutationCommand("add_report_note", input), context);
        return adapterResult(
          adapter,
          result.ok
            ? {
                ...result,
                message: `${result.message} The prior report preview is now invalid and closed; add_report_note leaves the next Site Tools inventory. Build a fresh preview before another note or final review.`,
              }
            : result,
        );
      },
    ),
  ];
}

export function groupReplayWebMCPTools(
  tools: readonly WebMCPToolDefinition[],
): Readonly<Record<WebMCPToolGroup, readonly WebMCPToolDefinition[]>> {
  return {
    base: tools.filter((tool) => tool.group === "base"),
    scene: tools.filter((tool) => tool.group === "scene"),
    facts: tools.filter((tool) => tool.group === "facts"),
    hypothesis: tools.filter((tool) => tool.group === "hypothesis"),
    report: tools.filter((tool) => tool.group === "report"),
  };
}
