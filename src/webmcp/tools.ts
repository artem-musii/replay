import type { z } from "zod";

import { toJSONSchema, webMCPInputSchemas } from "./schemas";
import type {
  ReplayAdapterResult,
  ReplayInvocationContext,
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

interface ToolMetadata {
  title: string;
  description: string;
  annotations: WebMCPToolAnnotations;
}

const READ_UNTRUSTED = { readOnlyHint: true, untrustedContentHint: true } as const;
const READ_DETERMINISTIC = { readOnlyHint: true, untrustedContentHint: false } as const;
const WRITE_TRUSTED = { readOnlyHint: false, untrustedContentHint: false } as const;
const WRITE_UNTRUSTED = { readOnlyHint: false, untrustedContentHint: true } as const;

const metadata = {
  get_case_summary: {
    title: "Get case summary",
    description:
      "Reads compact metadata for the open case, separating confirmed, reported, disputed, and hypothetical information and identifying the active branch and unresolved blockers. Use before planning work. It does not mutate state or change the visible workspace. An open case is required.",
    annotations: READ_UNTRUSTED,
  },
  get_workspace_state: {
    title: "Get workspace state",
    description:
      "Reads only the requested live scene, timeline, claims, evidence, questions, hypotheses, report, or selection sections. Use to inspect geometry, timing, provenance, or the human's latest correction without retrieving the full case. It does not mutate state or change the visible workspace. An open case is required.",
    annotations: READ_UNTRUSTED,
  },
  get_recent_activity: {
    title: "Get recent activity",
    description:
      "Reads a bounded list of recent human, agent, and system activity. Use after an agent action to detect human overrides and subsequent validation. It does not mutate state or change the visible workspace. An open case is required.",
    annotations: READ_UNTRUSTED,
  },
  validate_case_consistency: {
    title: "Validate case consistency",
    description:
      "Runs deterministic consistency rules for a branch and scope and returns structured issues rather than speculation. Use after reconstruction changes or before report review. It does not mutate factual case content or navigate the workspace. An open case is required.",
    annotations: READ_DETERMINISTIC,
  },
  focus_workspace_item: {
    title: "Focus workspace item",
    description:
      "Selects and visibly reveals one existing actor, trajectory, event, claim, evidence item, question, hypothesis, or issue so the human and agent can discuss the same object. Use after identifying a specific item. It changes UI focus only and does not alter factual case content. The item must exist.",
    annotations: WRITE_TRUSTED,
  },
  revert_agent_action: {
    title: "Revert agent action",
    description:
      "Reverses one identified agent activity when the canonical command layer still considers it safely undoable. Use to honor a human correction or retract an agent change. It visibly restores the prior case state and appends activity, so it mutates the case. The activity must be agent-authored, undoable, and at the expected case version.",
    annotations: WRITE_TRUSTED,
  },
  upsert_scene_actor: {
    title: "Add or update scene actor",
    description:
      "Adds a vehicle actor or updates one existing actor's label, normalized position, rotation, dimensions, and optional color. Use to construct or correct the visible scene. It mutates canonical case content, updates the canvas and activity feed, and requires a scene plus the current case version; locked actors remain protected.",
    annotations: WRITE_UNTRUSTED,
  },
  set_actor_trajectory: {
    title: "Set actor trajectory",
    description:
      "Sets ordered normalized keyframes for one existing actor in one existing hypothesis branch. Use to make a proposed movement path visible on the scene and timeline. It mutates canonical case content and activity, and requires an unlocked trajectory, valid actor and branch, and the current case version.",
    annotations: WRITE_UNTRUSTED,
  },
  mark_impact_event: {
    title: "Mark impact event",
    description:
      "Creates or updates an impact event at a normalized location and timeline position for identified actors in a branch. Use when the current information supports placing a provisional impact. It visibly updates scene, timeline, and activity and mutates case content. Agent-created impacts cannot be confirmed and require the current case version.",
    annotations: WRITE_UNTRUSTED,
  },
  mark_vehicle_damage: {
    title: "Mark vehicle damage",
    description:
      "Adds a sourced, non-confirmed damage observation to a region of an existing vehicle. Use to preserve visible damage separately from movement hypotheses. It mutates the actor, claims, and activity feed and requires valid source IDs, an unlocked actor, and the current case version.",
    annotations: WRITE_UNTRUSTED,
  },
  add_observation: {
    title: "Add observation",
    description:
      "Adds a sourced observation with explicit uncertainty and shared or branch scope. Use to record a statement without converting agent inference into confirmed fact. It visibly updates facts and activity and mutates case content. Confirmed status is unavailable and the current case version is required.",
    annotations: WRITE_UNTRUSTED,
  },
  link_evidence: {
    title: "Link evidence",
    description:
      "Links one existing evidence asset or annotation to one existing claim, scene item, event, damage marker, or hypothesis. Use to make provenance inspectable. It visibly updates both evidence and target plus activity and mutates relationships. All referenced IDs and the current case version are required.",
    annotations: WRITE_UNTRUSTED,
  },
  create_open_question: {
    title: "Create open question",
    description:
      "Creates a prioritized unresolved question tied to relevant case items. Use when missing information blocks or would materially improve the reconstruction or report. It visibly updates the questions panel and activity and mutates case content. It cannot answer or dismiss a question and requires the current case version.",
    annotations: WRITE_UNTRUSTED,
  },
  fork_hypothesis: {
    title: "Fork hypothesis",
    description:
      "Creates a visible alternative branch from an existing reconstruction with explicit assumptions while preserving shared locked facts. Use when more than one explanation remains plausible. It mutates branches and activity and changes the visible hypothesis workspace. A baseline branch and current case version are required.",
    annotations: WRITE_UNTRUSTED,
  },
  update_hypothesis_assumption: {
    title: "Update hypothesis assumption",
    description:
      "Adds, edits, or removes one explicit assumption in an existing hypothesis branch. Use to refine an alternative without changing shared confirmed facts. It visibly updates branch comparison and activity and mutates case content. The branch, operation-specific fields, and current case version are required.",
    annotations: WRITE_UNTRUSTED,
  },
  compare_hypotheses: {
    title: "Compare hypotheses",
    description:
      "Reads deterministic differences across two or more branches, including assumptions, geometry, timing, evidence relationships, issue counts, and unresolved questions. Use before asking the human to choose or refine an explanation. It does not mutate or navigate case state. Existing distinct branches are required.",
    annotations: READ_UNTRUSTED,
  },
  build_report_preview: {
    title: "Build report preview",
    description:
      "Builds a neutral evidence-bound preview from current structured state, identifies missing requirements, and visibly opens report review. Use only when the case is ready for meaningful review. It updates preview and UI state but never finalizes or marks facts confirmed. The current case version is required.",
    annotations: WRITE_UNTRUSTED,
  },
  add_report_note: {
    title: "Add supported report note",
    description:
      "Proposes neutral report wording supported by explicit existing claim or evidence IDs. Use to add evidence-bound context for human review. It visibly adds an agent-authored, human-unreviewed note and activity, so it mutates case content. References must exist and the current case version is required.",
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
  data: unknown,
  issues: readonly Readonly<Record<string, unknown>>[] = [],
): WebMCPResult {
  return {
    ok: true,
    message,
    caseVersion: adapter.getLifecycle().caseVersion,
    affectedIds: [],
    issues: [...issues],
    visibleState: visibleState(adapter),
    data,
  };
}

function adapterResult(adapter: ReplayWebMCPAdapter, result: ReplayAdapterResult): WebMCPResult {
  return {
    ok: result.ok,
    message: result.message,
    caseVersion: result.caseVersion,
    ...(result.activityId === undefined ? {} : { activityId: result.activityId }),
    affectedIds: [...(result.affectedIds ?? [])],
    issues: [...(result.issues ?? [])],
    visibleState: visibleState(adapter),
    ...(result.code === undefined ? {} : { code: result.code }),
    ...(result.data === undefined ? {} : { data: result.data }),
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
    description: toolMetadata.description,
    inputSchema: toJSONSchema(schema),
    annotations: toolMetadata.annotations,
    validationSchema: schema,
    group,
    async execute(rawInput, options) {
      const signal = options.signal;
      instrumentation.onStart?.(name, rawInput);
      let workingStarted = false;
      try {
        throwIfAborted(signal);
        const parsed = schema.safeParse(rawInput);
        if (!parsed.success) {
          const result = failureResult(adapter, validationMessage(parsed.error), "INVALID_INPUT");
          instrumentation.onFinish?.(name, result);
          return result;
        }

        const requestId = requestIdFromInput(parsed.data);
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
        instrumentation.onFinish?.(name, result);
        return result;
      } catch (error) {
        if (signal.aborted || isAbortError(error)) {
          instrumentation.onCancel?.(name, error);
          throw error;
        }
        const result = failureResult(adapter, errorMessage(error), "EXECUTION_FAILED");
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
        const data = await adapter.getCaseSummary(context);
        throwIfAborted(context.signal);
        return readResult(adapter, "Returned the compact live case summary.", data);
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
        const data = await adapter.getWorkspaceState(sections, context);
        throwIfAborted(context.signal);
        return readResult(
          adapter,
          `Returned ${String(sections.length)} requested workspace section${sections.length === 1 ? "" : "s"}.`,
          data,
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
        const data = await adapter.getRecentActivity(
          { limit: input.limit, author: input.author },
          context,
        );
        throwIfAborted(context.signal);
        return readResult(adapter, "Returned bounded recent case activity.", data);
      },
    ),

    defineTool(
      adapter,
      instrumentation,
      "validate_case_consistency",
      "base",
      webMCPInputSchemas.validate_case_consistency,
      async (input, context) => {
        const issues = await adapter.validateConsistency(
          {
            ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
            scope: input.scope,
          },
          context,
        );
        throwIfAborted(context.signal);
        return readResult(
          adapter,
          `Consistency validation found ${String(issues.length)} deterministic issue${issues.length === 1 ? "" : "s"}.`,
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
            ...(input.workspaceMode === undefined ? {} : { workspaceMode: input.workspaceMode }),
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
        const data = await adapter.compareHypotheses(
          { branchIds, comparisonMode: input.comparisonMode },
          context,
        );
        throwIfAborted(context.signal);
        return readResult(
          adapter,
          `Compared ${String(branchIds.length)} hypotheses without changing case state.`,
          data,
        );
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
            requestId: input.requestId,
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
      (input, context) => executeMutation(adapter, "add_report_note", input, context),
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
