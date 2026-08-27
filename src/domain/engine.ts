import type {
  ReplayCommand,
  ReplayCommandFailure,
  ReplayCommandResult,
  ReplayCommandSuccess,
  ReplayMutationCommand,
} from "./commandSchemas";
import { ReplayCommandSchema } from "./commandSchemas";
import { validateConsistency } from "./consistency";
import { validateCaseReferences } from "./importExport";
import type { ActivityEvent, ConsistencyIssue, ReplayCase } from "./models";
import { applyReplayMutation, DomainCommandError } from "./reducer";
import { parseReplayCase } from "./schema";

type UndoCommand = Extract<ReplayCommand, { type: "history.undo" }>;
type RedoCommand = Extract<ReplayCommand, { type: "history.redo" }>;
type HistoryCommand = UndoCommand | RedoCommand;

const NON_MATERIAL_ACTIVITY_TYPES = new Set([
  "case.validate",
  "consistency.updated",
  "workspace.focus",
  "proposal.adjust",
  "proposal.accept",
  "proposal.reject",
]);

interface HistoryEntry {
  before: ReplayCase;
  after: ReplayCase;
  command: ReplayMutationCommand;
  summary: string;
  affectedIds: string[];
  undoable: boolean;
  barrier: boolean;
}

interface RequestIntent {
  activityType: string;
  fingerprint: string;
}

interface RequestReceipt {
  intent: RequestIntent;
  result: ReplayCommandSuccess;
}

export interface ReplayEngineOptions {
  now?: () => string;
  idFactory?: (prefix: string) => string;
  maxHistory?: number;
}

export interface ExecuteReplayCommandOptions {
  signal?: AbortSignal;
}

/**
 * A caller-level, already-validated request intent. Adapters use this when
 * materializing a domain command depends on current state, so request identity
 * stays bound to what the caller actually submitted.
 */
export interface ReplayRequestIntentOverride {
  operation: string;
  type: string;
  actor: string;
  origin: string;
  payload: unknown;
}

export type ReplayStateListener = (state: ReplayCase, result: ReplayCommandSuccess) => void;

/**
 * A command evaluated against an isolated copy of the complete engine state.
 * The live case, history stacks, request receipts, and subscribers are untouched
 * until commit succeeds.
 */
export interface ReplayStagedCommand {
  readonly result: ReplayCommandResult;
  readonly state: ReplayCase;
  readonly changed: boolean;
  commit(options?: ExecuteReplayCommandOptions): ReplayCommandResult;
  discard(): void;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function defaultIdFactory(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class ReplayEngine {
  private replayCase: ReplayCase;
  private readonly now: () => string;
  private readonly idFactory: (prefix: string) => string;
  private readonly maxHistory: number;
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private readonly receipts = new Map<string, RequestReceipt>();
  private readonly listeners = new Set<ReplayStateListener>();

  constructor(initialCase: ReplayCase, options: ReplayEngineOptions = {}) {
    const parsed = parseReplayCase(initialCase);
    const referenceIssues = validateCaseReferences(parsed);
    if (referenceIssues.length > 0) {
      throw new DomainCommandError("INVALID_STATE", "Initial case contains invalid references", {
        details: { issues: referenceIssues },
      });
    }
    parsed.consistencyIssues = validateConsistency(parsed);
    this.replayCase = parseReplayCase(parsed);
    this.now = options.now ?? defaultNow;
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.maxHistory = options.maxHistory ?? 200;
  }

  get state(): ReplayCase {
    return clone(this.replayCase);
  }

  getState(): ReplayCase {
    return this.state;
  }

  get canUndo(): boolean {
    const entry = this.undoStack[this.undoStack.length - 1];
    return Boolean(entry?.undoable && !entry.barrier);
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  canRevertAgentAction(targetRequestId: string): boolean {
    const entry = this.undoStack[this.undoStack.length - 1];
    return (
      entry?.command.requestId === targetRequestId &&
      entry.command.actor === "agent" &&
      entry.undoable &&
      !entry.barrier
    );
  }

  subscribe(listener: ReplayStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  execute(input: unknown, options: ExecuteReplayCommandOptions = {}): ReplayCommandResult {
    return this.executeWithIntent(input, options);
  }

  private executeWithIntent(
    input: unknown,
    options: ExecuteReplayCommandOptions,
    intentOverride?: RequestIntent,
    requestIntentOverride?: ReplayRequestIntentOverride,
  ): ReplayCommandResult {
    if (options.signal?.aborted) return this.cancelledResult(options.signal.reason);
    const parsed = ReplayCommandSchema.safeParse(input);
    if (!parsed.success) {
      return this.failure("INVALID_COMMAND", "Command failed runtime validation", {
        validationIssues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    const command = parsed.data;
    const intent =
      intentOverride ??
      (requestIntentOverride
        ? callerRequestIntent(command.type, requestIntentOverride)
        : commandIntent(command));
    const idempotent = this.findIdempotentReceipt(command.requestId, intent);
    if (idempotent) return idempotent;
    if (
      command.expectedVersion !== undefined &&
      command.expectedVersion !== this.replayCase.caseVersion
    ) {
      return this.failure(
        "VERSION_CONFLICT",
        `Expected case version ${String(command.expectedVersion)}, but the current version is ${String(this.replayCase.caseVersion)}`,
        { expectedVersion: command.expectedVersion, currentVersion: this.replayCase.caseVersion },
      );
    }
    if (options.signal?.aborted) return this.cancelledResult(options.signal.reason);
    if (command.type === "history.undo" || command.type === "history.redo") {
      return this.executeHistory(command, intent);
    }
    return this.executeMutation(command, intent);
  }

  undo(meta: Omit<UndoCommand, "type"> = { actor: "human", origin: "ui" }): ReplayCommandResult {
    return this.execute({ type: "history.undo", ...meta });
  }

  redo(meta: Omit<RedoCommand, "type"> = { actor: "human", origin: "ui" }): ReplayCommandResult {
    return this.execute({ type: "history.redo", ...meta });
  }

  stage(
    input: unknown,
    options: ExecuteReplayCommandOptions = {},
    requestIntentOverride?: ReplayRequestIntentOverride,
  ): ReplayStagedCommand {
    return this.stageOperation((staged) =>
      staged.executeWithIntent(input, options, undefined, requestIntentOverride),
    );
  }

  stageAgentActionRevert(
    targetRequestId: string,
    meta: Omit<UndoCommand, "type"> = { actor: "agent", origin: "webmcp" },
    options: ExecuteReplayCommandOptions = {},
    requestIntentOverride?: ReplayRequestIntentOverride,
  ): ReplayStagedCommand {
    return this.stageOperation((staged) => {
      if (options.signal?.aborted) return staged.cancelledResult(options.signal.reason);
      return staged.revertAgentAction(targetRequestId, meta, requestIntentOverride);
    });
  }

  revertAgentAction(
    targetRequestId: string,
    meta: Omit<UndoCommand, "type"> = { actor: "agent", origin: "webmcp" },
    requestIntentOverride?: ReplayRequestIntentOverride,
  ): ReplayCommandResult {
    const intent = requestIntentOverride
      ? callerRequestIntent("history.undo", requestIntentOverride)
      : revertIntent(targetRequestId, meta);
    const idempotent = this.findIdempotentReceipt(meta.requestId, intent);
    if (idempotent) return idempotent;
    if (
      meta.expectedVersion !== undefined &&
      meta.expectedVersion !== this.replayCase.caseVersion
    ) {
      return this.failure(
        "VERSION_CONFLICT",
        `Expected case version ${String(meta.expectedVersion)}, but the current version is ${String(this.replayCase.caseVersion)}`,
        {
          expectedVersion: meta.expectedVersion,
          currentVersion: this.replayCase.caseVersion,
        },
      );
    }
    const index = this.undoStack.findIndex((entry) => entry.command.requestId === targetRequestId);
    if (index < 0) {
      return this.failure(
        "UNSAFE_REVERT",
        `No safely undoable agent action matches request ${targetRequestId}`,
        {
          targetRequestId,
        },
      );
    }
    const entry = this.undoStack[index];
    if (!entry) {
      return this.failure(
        "UNSAFE_REVERT",
        `No safely undoable agent action matches request ${targetRequestId}`,
      );
    }
    if (!this.canRevertAgentAction(targetRequestId) || index !== this.undoStack.length - 1) {
      return this.failure(
        "UNSAFE_REVERT",
        "The requested agent action is no longer the latest safely reversible mutation",
        { targetRequestId },
      );
    }
    return this.executeWithIntent({ type: "history.undo", ...meta }, {}, intent);
  }

  private stageOperation(
    operation: (staged: ReplayEngine) => ReplayCommandResult,
  ): ReplayStagedCommand {
    const baselineVersion = this.replayCase.caseVersion;
    const staged = this.forkForStaging();
    const stagedResult = operation(staged);
    const changed = stagedResult.ok && staged.replayCase.caseVersion !== baselineVersion;
    let open = true;

    return {
      result: clone(stagedResult),
      state: staged.state,
      changed,
      commit: (options = {}) => {
        if (!open) {
          return this.failure("INVALID_STATE", "This staged command is already closed");
        }
        open = false;
        if (!stagedResult.ok || !changed) return clone(stagedResult);
        if (options.signal?.aborted) return this.cancelledResult(options.signal.reason);
        if (this.replayCase.caseVersion !== baselineVersion) {
          return this.failure(
            "VERSION_CONFLICT",
            `The case changed from version ${String(baselineVersion)} to ${String(this.replayCase.caseVersion)} while the command was being persisted`,
            {
              expectedVersion: baselineVersion,
              currentVersion: this.replayCase.caseVersion,
            },
          );
        }

        this.adoptStagedState(staged);
        this.notify(stagedResult);
        return clone(stagedResult);
      },
      discard: () => {
        open = false;
      },
    };
  }

  private forkForStaging(): ReplayEngine {
    const staged = new ReplayEngine(this.replayCase, {
      now: this.now,
      idFactory: this.idFactory,
      maxHistory: this.maxHistory,
    });
    staged.undoStack.push(...clone(this.undoStack));
    staged.redoStack.push(...clone(this.redoStack));
    for (const [requestId, receipt] of this.receipts) {
      staged.receipts.set(requestId, clone(receipt));
    }
    return staged;
  }

  private adoptStagedState(staged: ReplayEngine): void {
    this.replayCase = clone(staged.replayCase);
    this.undoStack.splice(0, this.undoStack.length, ...clone(staged.undoStack));
    this.redoStack.splice(0, this.redoStack.length, ...clone(staged.redoStack));
    this.receipts.clear();
    for (const [requestId, receipt] of staged.receipts) {
      this.receipts.set(requestId, clone(receipt));
    }
  }

  private executeMutation(
    command: ReplayMutationCommand,
    intent: RequestIntent,
  ): ReplayCommandResult {
    const before = clone(this.replayCase);
    const createdAt = this.now();
    try {
      const outcome = applyReplayMutation(before, command, {
        now: createdAt,
        nextVersion: this.replayCase.caseVersion + 1,
        makeId: this.allocateId,
      });
      const nextState = outcome.nextState;
      nextState.caseVersion = this.replayCase.caseVersion + 1;
      nextState.updatedAt = createdAt;
      nextState.consistencyIssues = validateConsistency(nextState);
      const activity = this.createActivity(
        command,
        nextState.caseVersion,
        outcome.summary,
        outcome.affectedIds,
        outcome.undoable,
        createdAt,
        intent,
      );
      nextState.activity.push(activity);
      const consistencyActivity = this.createConsistencyActivity(
        this.replayCase.consistencyIssues,
        nextState.consistencyIssues,
        nextState.caseVersion,
        createdAt,
      );
      if (consistencyActivity) nextState.activity.push(consistencyActivity);
      const referenceIssues = validateCaseReferences(nextState);
      if (referenceIssues.length > 0) {
        throw new DomainCommandError(
          "INVALID_STATE",
          "Command would create invalid object references",
          {
            details: { issues: referenceIssues },
          },
        );
      }
      const validated = parseReplayCase(nextState);
      const entry: HistoryEntry = {
        before: clone(this.replayCase),
        after: clone(validated),
        command: clone(command),
        summary: outcome.summary,
        affectedIds: unique(outcome.affectedIds),
        undoable: outcome.undoable,
        barrier: outcome.historyBarrier ?? false,
      };
      this.replayCase = validated;
      if (outcome.undoable || outcome.historyBarrier) {
        this.undoStack.push(entry);
        if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
      }
      if (command.type !== "case.validate") this.redoStack.length = 0;
      const result: ReplayCommandSuccess = {
        ok: true,
        caseVersion: validated.caseVersion,
        activityId: activity.id,
        affectedIds: unique(outcome.affectedIds),
        issues: clone(validated.consistencyIssues),
        message: outcome.summary,
        idempotent: false,
      };
      this.recordReceipt(command.requestId, intent, result);
      this.notify(result);
      return result;
    } catch (error) {
      if (error instanceof DomainCommandError) {
        return this.failure(error.code, error.message, error.details, error.lockedItem);
      }
      return this.failure(
        "INVALID_STATE",
        error instanceof Error ? error.message : "Command failed",
      );
    }
  }

  private executeHistory(command: HistoryCommand, intent: RequestIntent): ReplayCommandResult {
    const direction = command.type === "history.undo" ? "undo" : "redo";
    const source = direction === "undo" ? this.undoStack : this.redoStack;
    const destination = direction === "undo" ? this.redoStack : this.undoStack;
    const entry = source[source.length - 1];
    if (!entry) return this.failure("HISTORY_EMPTY", `There is nothing to ${direction}`);
    if (direction === "undo" && (!entry.undoable || entry.barrier)) {
      return this.failure(
        "HISTORY_BARRIER",
        "History cannot cross an immutable finalized report snapshot",
        { commandType: entry.command.type },
      );
    }

    const createdAt = this.now();
    const currentActivity = clone(this.replayCase.activity);
    const currentIssues = clone(this.replayCase.consistencyIssues);
    const currentWorkspaceMode = this.replayCase.workspaceMode;
    const currentSelection = clone(this.replayCase.selectedItem);
    const restored = clone(direction === "undo" ? entry.before : entry.after);
    restored.activity = currentActivity;
    restored.workspaceMode = currentWorkspaceMode;
    if (currentSelection) restored.selectedItem = currentSelection;
    else delete restored.selectedItem;
    restored.caseVersion = this.replayCase.caseVersion + 1;
    restored.updatedAt = createdAt;
    restored.consistencyIssues = validateConsistency(restored);
    const summary = `${direction === "undo" ? "Undid" : "Redid"}: ${entry.summary}`;
    const activity = this.createActivity(
      command,
      restored.caseVersion,
      summary,
      entry.affectedIds,
      false,
      createdAt,
      intent,
    );
    restored.activity.push(activity);
    const consistencyActivity = this.createConsistencyActivity(
      currentIssues,
      restored.consistencyIssues,
      restored.caseVersion,
      createdAt,
    );
    if (consistencyActivity) restored.activity.push(consistencyActivity);
    try {
      const referenceIssues = validateCaseReferences(restored);
      if (referenceIssues.length > 0) {
        return this.failure(
          "INVALID_STATE",
          `Cannot ${direction}; restored state has invalid references`,
          {
            issues: referenceIssues,
          },
        );
      }
      this.replayCase = parseReplayCase(restored);
      source.pop();
      destination.push(entry);
      const result: ReplayCommandSuccess = {
        ok: true,
        caseVersion: restored.caseVersion,
        activityId: activity.id,
        affectedIds: clone(entry.affectedIds),
        issues: clone(restored.consistencyIssues),
        message: summary,
        idempotent: false,
      };
      this.recordReceipt(command.requestId, intent, result);
      this.notify(result);
      return result;
    } catch (error) {
      return this.failure(
        "INVALID_STATE",
        error instanceof Error ? error.message : `Cannot ${direction}`,
      );
    }
  }

  private findIdempotentReceipt(
    requestId: string | undefined,
    intent: RequestIntent,
  ): ReplayCommandResult | undefined {
    if (!requestId) return undefined;
    const receipt = this.receipts.get(requestId);
    if (receipt) {
      if (receipt.intent.fingerprint !== intent.fingerprint) {
        return this.idempotencyConflict(
          requestId,
          receipt.intent.activityType,
          intent.activityType,
        );
      }
      return {
        ...clone(receipt.result),
        idempotent: true,
      };
    }
    const activity = this.replayCase.activity.find((event) => event.requestId === requestId);
    if (!activity) return undefined;
    if (
      activity.requestIntentFingerprint !== undefined
        ? activity.requestIntentFingerprint !== intent.fingerprint
        : activity.actionType !== intent.activityType
    ) {
      return this.idempotencyConflict(requestId, activity.actionType, intent.activityType);
    }
    return {
      ok: true,
      caseVersion: activity.caseVersion,
      activityId: activity.id,
      affectedIds: clone(activity.affectedIds),
      issues: clone(this.replayCase.consistencyIssues),
      message: activity.summary,
      idempotent: true,
    };
  }

  private recordReceipt(
    requestId: string | undefined,
    intent: RequestIntent,
    result: ReplayCommandSuccess,
  ): void {
    if (requestId) this.receipts.set(requestId, clone({ intent, result }));
  }

  private idempotencyConflict(
    requestId: string,
    completedActivityType: string,
    requestedActivityType: string,
  ): ReplayCommandFailure {
    return this.failure(
      "IDEMPOTENCY_CONFLICT",
      `Request ID ${requestId} was already used for a different operation`,
      { requestId, completedActivityType, requestedActivityType },
    );
  }

  private createActivity(
    command: ReplayCommand,
    caseVersion: number,
    summary: string,
    affectedIds: string[],
    undoable: boolean,
    createdAt: string,
    intent: RequestIntent,
  ): ActivityEvent {
    const isValidation = command.type === "case.validate";
    const stableAffectedIds = unique(affectedIds).slice(0, 5_000);
    const overriddenActivity = this.findOverriddenAgentActivity(command, stableAffectedIds);
    const stableSummary = overriddenActivity ? `Human override: ${summary}` : summary;
    return {
      id: this.allocateId("activity"),
      caseVersion,
      author: isValidation ? "system" : command.actor,
      origin: isValidation ? "system" : command.origin,
      actionType: command.type,
      ...(overriddenActivity
        ? {
            classification: "human-override" as const,
            overridesActivityId: overriddenActivity.id,
          }
        : {}),
      summary: stableSummary.slice(0, 500),
      affectedIds: stableAffectedIds,
      ...(command.requestId ? { requestId: command.requestId } : {}),
      ...(command.requestId ? { requestIntentFingerprint: intent.fingerprint } : {}),
      undoable,
      createdAt,
    };
  }

  private findOverriddenAgentActivity(
    command: ReplayCommand,
    affectedIds: readonly string[],
  ): ActivityEvent | undefined {
    if (
      command.actor !== "human" ||
      command.origin !== "ui" ||
      NON_MATERIAL_ACTIVITY_TYPES.has(command.type) ||
      affectedIds.length === 0
    ) {
      return undefined;
    }

    const affectedIdSet = new Set(affectedIds);
    for (let index = this.replayCase.activity.length - 1; index >= 0; index -= 1) {
      const activity = this.replayCase.activity[index];
      if (
        !activity ||
        activity.author === "system" ||
        NON_MATERIAL_ACTIVITY_TYPES.has(activity.actionType) ||
        !activity.affectedIds.some((affectedId) => affectedIdSet.has(affectedId))
      ) {
        continue;
      }
      return activity.author === "agent" && activity.origin === "webmcp" ? activity : undefined;
    }
    return undefined;
  }

  private createConsistencyActivity(
    before: ConsistencyIssue[],
    after: ConsistencyIssue[],
    caseVersion: number,
    createdAt: string,
  ): ActivityEvent | undefined {
    const beforeIds = new Set(before.map((issue) => issue.id));
    const afterIds = new Set(after.map((issue) => issue.id));
    const detected = after.filter((issue) => !beforeIds.has(issue.id));
    const resolved = before.filter((issue) => !afterIds.has(issue.id));
    if (detected.length === 0 && resolved.length === 0) return undefined;
    const parts = [
      ...(detected.length > 0
        ? [
            `detected ${String(detected.length)} consistency ${detected.length === 1 ? "item" : "items"}`,
          ]
        : []),
      ...(resolved.length > 0
        ? [
            `resolved ${String(resolved.length)} consistency ${resolved.length === 1 ? "item" : "items"}`,
          ]
        : []),
    ];
    return {
      id: this.allocateId("activity"),
      caseVersion,
      author: "system",
      origin: "system",
      actionType: "consistency.updated",
      summary: `System ${parts.join(" and ")}.`,
      affectedIds: unique([...detected, ...resolved].flatMap((issue) => issue.affectedIds)).slice(
        0,
        5_000,
      ),
      undoable: false,
      createdAt,
    };
  }

  private readonly allocateId = (prefix: string): string => {
    const knownActivityIds = new Set(this.replayCase.activity.map((activity) => activity.id));
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = this.idFactory(prefix);
      if (!knownActivityIds.has(candidate)) return candidate;
    }
    throw new DomainCommandError("INVALID_STATE", `Unable to allocate a unique ${prefix} ID`);
  };

  private failure(
    code: ReplayCommandFailure["error"]["code"],
    message: string,
    details?: Record<string, unknown>,
    lockedItem?: ReplayCommandFailure["error"]["lockedItem"],
  ): ReplayCommandFailure {
    return {
      ok: false,
      caseVersion: this.replayCase.caseVersion,
      affectedIds: [],
      issues: clone(this.replayCase.consistencyIssues),
      message,
      error: {
        code,
        message,
        ...(details ? { details } : {}),
        ...(lockedItem ? { lockedItem } : {}),
      },
    };
  }

  private cancelledResult(reason: unknown): ReplayCommandFailure {
    return this.failure("CANCELLED", "Command was cancelled before commit", {
      ...(reason === undefined ? {} : { reason: describeUnknown(reason) }),
    });
  }

  private notify(result: ReplayCommandSuccess): void {
    const state = this.state;
    for (const listener of this.listeners) {
      try {
        listener(state, clone(result));
      } catch {
        // A UI subscriber must not turn an already committed domain mutation
        // into an apparent command failure.
      }
    }
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function commandIntent(command: ReplayCommand): RequestIntent {
  const semanticCommand = Object.fromEntries(
    Object.entries(command).filter(([key]) => key !== "requestId" && key !== "expectedVersion"),
  );
  return {
    activityType: command.type,
    fingerprint: fingerprintIntent({ operation: "command", command: semanticCommand }),
  };
}

function callerRequestIntent(
  activityType: string,
  requestIntentOverride: ReplayRequestIntentOverride,
): RequestIntent {
  return {
    activityType,
    fingerprint: fingerprintIntent({
      operation: "caller-request-intent",
      intent: requestIntentOverride,
    }),
  };
}

function revertIntent(targetRequestId: string, meta: Omit<UndoCommand, "type">): RequestIntent {
  const semanticMeta = Object.fromEntries(
    Object.entries(meta).filter(([key]) => key !== "requestId" && key !== "expectedVersion"),
  );
  return {
    activityType: "history.undo",
    fingerprint: fingerprintIntent({
      operation: "agent-action-revert",
      type: "history.undo",
      targetRequestId,
      meta: semanticMeta,
    }),
  };
}

function fingerprintIntent(value: unknown): string {
  const serialized = stableSerialize(value);
  let first = 1_779_033_703;
  let second = 3_144_134_277;
  let third = 1_013_904_242;
  let fourth = 2_773_480_762;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    first = second ^ Math.imul(first ^ code, 597_399_067);
    second = third ^ Math.imul(second ^ code, 2_869_860_233);
    third = fourth ^ Math.imul(third ^ code, 951_274_213);
    fourth = first ^ Math.imul(fourth ^ code, 2_716_044_179);
  }
  first = Math.imul(third ^ (first >>> 18), 597_399_067);
  second = Math.imul(fourth ^ (second >>> 22), 2_869_860_233);
  third = Math.imul(first ^ (third >>> 17), 951_274_213);
  fourth = Math.imul(second ^ (fourth >>> 19), 2_716_044_179);
  const words = [first ^ second ^ third ^ fourth, second ^ first, third ^ first, fourth ^ first];
  return `intent-v1-${words.map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("")}`;
}

function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(",")}}`;
  }
  if (typeof value === "bigint") return `bigint:${value.toString()}`;
  if (typeof value === "symbol" || typeof value === "function") {
    throw new TypeError("Command intent contains a non-serializable value");
  }
  return JSON.stringify(value);
}

function describeUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
    return String(value);
  try {
    const serialized: unknown = JSON.stringify(value);
    return typeof serialized === "string" ? serialized : "Unknown cancellation reason";
  } catch {
    return "Unknown cancellation reason";
  }
}

export function createReplayEngine(
  initialCase: ReplayCase,
  options?: ReplayEngineOptions,
): ReplayEngine {
  return new ReplayEngine(initialCase, options);
}
