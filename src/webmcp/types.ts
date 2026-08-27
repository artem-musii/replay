import type { z } from "zod";

export type Awaitable<T> = T | Promise<T>;

export type ReplayIssue = Readonly<Record<string, unknown>>;

export class ReplayWebMCPContractError extends Error {
  readonly code: "INVALID_INPUT" | "NOT_FOUND";

  constructor(code: "INVALID_INPUT" | "NOT_FOUND", message: string) {
    super(message);
    this.name = "ReplayWebMCPContractError";
    this.code = code;
  }
}

export interface ReplayVisibleState {
  workspaceMode: string;
  selectedItemId?: string;
}

export interface WebMCPResult<T = unknown> {
  ok: boolean;
  message: string;
  caseVersion: number;
  activityId?: string;
  idempotent?: boolean;
  affectedIds: string[];
  issues: ReplayIssue[];
  visibleState: ReplayVisibleState;
  data?: T;
  code?: string;
}

/**
 * Stable, coarse-grained lifecycle inputs. Selection and other transient UI
 * changes intentionally do not affect registration eligibility.
 */
export interface ReplayWebMCPLifecycle {
  caseOpen: boolean;
  sceneExists: boolean;
  factsAvailable: boolean;
  baselineExists: boolean;
  reportPreviewAvailable: boolean;
  caseVersion: number;
  workspaceMode: string;
  selectedItemId?: string;
}

export interface ReplayWebMCPCommand {
  type: WebMCPMutationToolName;
  payload: Readonly<Record<string, unknown>>;
  actor: "agent";
  origin: "webmcp";
  requestId: string;
  expectedVersion: number;
}

export interface ReplayAdapterResult {
  ok: boolean;
  message: string;
  caseVersion: number;
  activityId?: string;
  idempotent?: boolean;
  affectedIds?: readonly string[];
  issues?: readonly ReplayIssue[];
  code?: string;
  data?: unknown;
}

export interface ReplayInvocationContext {
  signal: AbortSignal;
  toolName: WebMCPToolName;
}

export interface ReplayAgentWorkingState {
  active: boolean;
  toolName: WebMCPToolName;
  requestId?: string;
}

/**
 * A visible, session-scoped audit entry for a tool call that did not create a
 * canonical domain activity of its own. Keeping this outside ReplayCase
 * preserves read-only tool semantics.
 */
export interface ReplayToolInvocationAudit {
  toolName: WebMCPToolName;
  ok: boolean;
  message: string;
  caseVersion: number;
  affectedIds: readonly string[];
  requestId?: string;
}

/**
 * The UI/domain integration boundary. Implementations must resolve mutations
 * only after canonical state, persistence, activity, and visible UI agree.
 * Mutating methods must treat the supplied signal transactionally: cancellation
 * before commit leaves both case state and the activity log unchanged.
 */
export interface ReplayWebMCPAdapter {
  getLifecycle(): ReplayWebMCPLifecycle;
  subscribe(listener: () => void): () => void;

  getCaseSummary(context: ReplayInvocationContext): Awaitable<unknown>;
  getWorkspaceState(
    sections: readonly WorkspaceSection[],
    context: ReplayInvocationContext,
  ): Awaitable<unknown>;
  getRecentActivity(
    input: Readonly<{ limit: number; author: ActivityAuthorFilter }>,
    context: ReplayInvocationContext,
  ): Awaitable<unknown>;
  validateConsistency(
    input: Readonly<{ branchId?: string; scope: ConsistencyScope }>,
    context: ReplayInvocationContext,
  ): Awaitable<readonly ReplayIssue[]>;
  compareHypotheses(
    input: Readonly<{ branchIds: readonly string[] }>,
    context: ReplayInvocationContext,
  ): Awaitable<unknown>;

  focusWorkspaceItem(
    input: Readonly<{
      itemType: WorkspaceItemType;
      itemId: string;
      workspaceMode?: string;
    }>,
    context: ReplayInvocationContext,
  ): Awaitable<ReplayAdapterResult>;
  revertAgentAction(
    input: Readonly<{
      activityId: string;
      expectedVersion: number;
      requestId: string;
    }>,
    context: ReplayInvocationContext,
  ): Awaitable<ReplayAdapterResult>;
  execute(
    command: ReplayWebMCPCommand,
    context: ReplayInvocationContext,
  ): Awaitable<ReplayAdapterResult>;
  buildReportPreview(
    input: Readonly<{
      branchId?: string;
      expectedVersion: number;
    }>,
    context: ReplayInvocationContext,
  ): Awaitable<ReplayAdapterResult>;

  setAgentWorking?(state: ReplayAgentWorkingState): Awaitable<void>;
  revealAffected?(affectedIds: readonly string[]): Awaitable<void>;
  recordToolInvocation?(audit: ReplayToolInvocationAudit): Awaitable<void>;
}

export const WORKSPACE_SECTIONS = [
  "scene",
  "timeline",
  "claims",
  "evidence",
  "questions",
  "hypotheses",
  "report",
  "selection",
] as const;

export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number];

export const WORKSPACE_ITEM_TYPES = [
  "actor",
  "trajectory",
  "event",
  "claim",
  "evidence",
  "question",
  "hypothesis",
  "issue",
] as const;

export type WorkspaceItemType = (typeof WORKSPACE_ITEM_TYPES)[number];

export const ACTIVITY_AUTHOR_FILTERS = ["human", "agent", "system", "all"] as const;
export type ActivityAuthorFilter = (typeof ACTIVITY_AUTHOR_FILTERS)[number];

export const CONSISTENCY_SCOPES = ["all", "scene", "timeline", "provenance", "report"] as const;
export type ConsistencyScope = (typeof CONSISTENCY_SCOPES)[number];

export const TOOL_GROUPS = ["base", "scene", "facts", "hypothesis", "report"] as const;
export type WebMCPToolGroup = (typeof TOOL_GROUPS)[number];

export const BASE_TOOL_NAMES = [
  "get_case_summary",
  "get_workspace_state",
  "get_recent_activity",
  "validate_case_consistency",
  "focus_workspace_item",
  "revert_agent_action",
] as const;

export const SCENE_TOOL_NAMES = [
  "upsert_scene_actor",
  "set_actor_trajectory",
  "propose_scene_changes",
  "mark_impact_event",
  "mark_vehicle_damage",
] as const;

export const FACT_TOOL_NAMES = [
  "add_observation",
  "link_evidence",
  "create_open_question",
] as const;

export const HYPOTHESIS_TOOL_NAMES = [
  "fork_hypothesis",
  "update_hypothesis_assumption",
  "compare_hypotheses",
] as const;

export const REPORT_TOOL_NAMES = ["build_report_preview", "add_report_note"] as const;

export const TOOL_NAMES = [
  ...BASE_TOOL_NAMES,
  ...SCENE_TOOL_NAMES,
  ...FACT_TOOL_NAMES,
  ...HYPOTHESIS_TOOL_NAMES,
  ...REPORT_TOOL_NAMES,
] as const;

export type WebMCPToolName = (typeof TOOL_NAMES)[number];

export type WebMCPMutationToolName = Exclude<
  WebMCPToolName,
  | "get_case_summary"
  | "get_workspace_state"
  | "get_recent_activity"
  | "validate_case_consistency"
  | "focus_workspace_item"
  | "revert_agent_action"
  | "compare_hypotheses"
  | "build_report_preview"
>;

export interface WebMCPToolAnnotations {
  readOnlyHint: boolean;
  untrustedContentHint: boolean;
}

export interface WebMCPExecuteOptions {
  signal: AbortSignal;
}

export interface WebMCPToolDefinition<TInput = unknown> {
  name: WebMCPToolName;
  title: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
  annotations: WebMCPToolAnnotations;
  execute(input: unknown, options: WebMCPExecuteOptions): Promise<WebMCPResult>;
  /** Kept locally for defense-in-depth validation after browser validation. */
  validationSchema: z.ZodType<TInput>;
  group: WebMCPToolGroup;
}

export interface ModelContextRegisteredTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Readonly<Record<string, unknown>>;
  annotations?: WebMCPToolAnnotations;
  window?: unknown;
  origin?: string;
}

export interface ModelContextLike {
  registerTool(
    tool: Omit<WebMCPToolDefinition, "validationSchema" | "group">,
    options?: { signal?: AbortSignal; exposedTo?: readonly string[] },
  ): Promise<void>;
  getTools?(options?: {
    fromOrigins?: readonly string[];
  }): Promise<readonly ModelContextRegisteredTool[]>;
  executeTool?(
    tool: ModelContextRegisteredTool,
    input?: Readonly<Record<string, unknown>>,
    options?: { signal?: AbortSignal },
  ): Promise<string>;
}

export type WebMCPRegistrationStatus =
  "inactive" | "registering" | "registered" | "error" | "unsupported";

export interface WebMCPDebugToolState {
  name: WebMCPToolName;
  title: string;
  group: WebMCPToolGroup;
  description: string;
  annotations: WebMCPToolAnnotations;
  inputSchema: Readonly<Record<string, unknown>>;
  registrationState: WebMCPRegistrationStatus;
  registrationError?: string;
}

export interface WebMCPDebugInvocation {
  toolName: WebMCPToolName;
  input: unknown;
  startedAt: string;
  finishedAt?: string;
  cancelled?: boolean;
}

export interface WebMCPDebugState {
  supported: boolean;
  canSimulate: boolean;
  lifecycleMode: string;
  caseVersion: number;
  registeredToolNames: WebMCPToolName[];
  tools: WebMCPDebugToolState[];
  lastInvocation?: WebMCPDebugInvocation;
  lastResult?: unknown;
}
