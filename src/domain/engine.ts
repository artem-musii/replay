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

interface HistoryEntry {
  before: ReplayCase;
  after: ReplayCase;
  command: ReplayMutationCommand;
  summary: string;
  affectedIds: string[];
  undoable: boolean;
  barrier: boolean;
}

export interface ReplayEngineOptions {
  now?: () => string;
  idFactory?: (prefix: string) => string;
  maxHistory?: number;
}

export interface ExecuteReplayCommandOptions {
  signal?: AbortSignal;
}

export type ReplayStateListener = (state: ReplayCase, result: ReplayCommandSuccess) => void;

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
  private readonly receipts = new Map<string, ReplayCommandSuccess>();
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

  subscribe(listener: ReplayStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  execute(input: unknown, options: ExecuteReplayCommandOptions = {}): ReplayCommandResult {
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
    const idempotent = this.findIdempotentReceipt(command.requestId);
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
      return this.executeHistory(command);
    }
    return this.executeMutation(command);
  }

  undo(meta: Omit<UndoCommand, "type"> = { actor: "human", origin: "ui" }): ReplayCommandResult {
    return this.execute({ type: "history.undo", ...meta });
  }

  redo(meta: Omit<RedoCommand, "type"> = { actor: "human", origin: "ui" }): ReplayCommandResult {
    return this.execute({ type: "history.redo", ...meta });
  }

  revertAgentAction(
    targetRequestId: string,
    meta: Omit<UndoCommand, "type"> = { actor: "agent", origin: "webmcp" },
  ): ReplayCommandResult {
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
    if (
      entry.command.actor !== "agent" ||
      !entry.undoable ||
      entry.barrier ||
      index !== this.undoStack.length - 1
    ) {
      return this.failure(
        "UNSAFE_REVERT",
        "The requested agent action is no longer the latest safely reversible mutation",
        { targetRequestId },
      );
    }
    return this.undo(meta);
  }

  private executeMutation(command: ReplayMutationCommand): ReplayCommandResult {
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
      this.recordReceipt(command.requestId, result);
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

  private executeHistory(command: HistoryCommand): ReplayCommandResult {
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
    const restored = clone(direction === "undo" ? entry.before : entry.after);
    restored.activity = currentActivity;
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
      this.recordReceipt(command.requestId, result);
      this.notify(result);
      return result;
    } catch (error) {
      return this.failure(
        "INVALID_STATE",
        error instanceof Error ? error.message : `Cannot ${direction}`,
      );
    }
  }

  private findIdempotentReceipt(requestId: string | undefined): ReplayCommandSuccess | undefined {
    if (!requestId) return undefined;
    const receipt = this.receipts.get(requestId);
    if (receipt) {
      return {
        ...clone(receipt),
        caseVersion: this.replayCase.caseVersion,
        issues: clone(this.replayCase.consistencyIssues),
        idempotent: true,
      };
    }
    const activity = this.replayCase.activity.find((event) => event.requestId === requestId);
    if (!activity) return undefined;
    return {
      ok: true,
      caseVersion: this.replayCase.caseVersion,
      activityId: activity.id,
      affectedIds: clone(activity.affectedIds),
      issues: clone(this.replayCase.consistencyIssues),
      message: "Request was already applied; no duplicate mutation was made.",
      idempotent: true,
    };
  }

  private recordReceipt(requestId: string | undefined, result: ReplayCommandSuccess): void {
    if (requestId) this.receipts.set(requestId, clone(result));
  }

  private createActivity(
    command: ReplayCommand,
    caseVersion: number,
    summary: string,
    affectedIds: string[],
    undoable: boolean,
    createdAt: string,
  ): ActivityEvent {
    const isValidation = command.type === "case.validate";
    return {
      id: this.allocateId("activity"),
      caseVersion,
      author: isValidation ? "system" : command.actor,
      origin: isValidation ? "system" : command.origin,
      actionType: command.type,
      summary: summary.slice(0, 500),
      affectedIds: unique(affectedIds).slice(0, 5_000),
      ...(command.requestId ? { requestId: command.requestId } : {}),
      undoable,
      createdAt,
    };
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
