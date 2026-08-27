import { createReplayWebMCPTools, groupReplayWebMCPTools, throwIfAborted } from "./tools";
import {
  TOOL_GROUPS,
  type ModelContextLike,
  type ReplayWebMCPAdapter,
  type ReplayWebMCPLifecycle,
  type WebMCPDebugInvocation,
  type WebMCPDebugState,
  type WebMCPDebugToolState,
  type WebMCPExecuteOptions,
  type WebMCPResult,
  type WebMCPToolDefinition,
  type WebMCPToolGroup,
  type WebMCPToolName,
} from "./types";

export interface ReplayWebMCPRegistryOptions {
  /** Pass null to force the progressive-enhancement fallback in tests or UI. */
  modelContext?: ModelContextLike | null;
  /** Aborting this signal tears down every registration owned by the registry. */
  signal?: AbortSignal;
}

export interface WebMCPSupportState {
  available: boolean;
  canSimulate: boolean;
  reason?: string;
}

interface ActiveGroup {
  controller: AbortController;
  names: WebMCPToolName[];
}

interface MergedSignal {
  signal: AbortSignal;
  dispose(): void;
}

const toolOwners = new WeakMap<object, Map<string, symbol>>();

function contextOwners(modelContext: ModelContextLike): Map<string, symbol> {
  let owners = toolOwners.get(modelContext);
  if (owners === undefined) {
    owners = new Map<string, symbol>();
    toolOwners.set(modelContext, owners);
  }
  return owners;
}

function claimToolName(modelContext: ModelContextLike, name: string, owner: symbol): boolean {
  const owners = contextOwners(modelContext);
  const existingOwner = owners.get(name);
  if (existingOwner !== undefined && existingOwner !== owner) {
    return false;
  }
  owners.set(name, owner);
  return true;
}

function releaseToolName(modelContext: ModelContextLike, name: string, owner: symbol): void {
  const owners = contextOwners(modelContext);
  if (owners.get(name) === owner) {
    owners.delete(name);
  }
}

function resolveGlobalModelContext(): ModelContextLike | undefined {
  const candidateDocument = (globalThis as { document?: { modelContext?: unknown } }).document;
  const candidate = candidateDocument?.modelContext;
  if (
    typeof candidate === "object" &&
    candidate !== null &&
    "registerTool" in candidate &&
    typeof candidate.registerTool === "function"
  ) {
    return candidate as ModelContextLike;
  }
  return undefined;
}

export function detectWebMCPSupport(modelContext?: ModelContextLike | null): WebMCPSupportState {
  const resolved =
    modelContext === undefined ? resolveGlobalModelContext() : (modelContext ?? undefined);
  if (resolved === undefined) {
    return {
      available: false,
      canSimulate: false,
      reason: "document.modelContext is unavailable; manual REPLAY features remain usable.",
    };
  }
  return {
    available: true,
    canSimulate:
      typeof resolved.getTools === "function" && typeof resolved.executeTool === "function",
  };
}

function lifecycleMode(lifecycle: ReplayWebMCPLifecycle): string {
  if (!lifecycle.caseOpen) return "closed";
  if (lifecycle.reportPreviewAvailable) return "report";
  if (lifecycle.baselineExists) return "hypothesis";
  if (lifecycle.sceneExists) return "scene";
  return "base";
}

function eligibleGroups(lifecycle: ReplayWebMCPLifecycle): ReadonlySet<WebMCPToolGroup> {
  const eligible = new Set<WebMCPToolGroup>();
  if (!lifecycle.caseOpen) return eligible;
  eligible.add("base");
  if (lifecycle.sceneExists) eligible.add("scene");
  if (lifecycle.factsAvailable) eligible.add("facts");
  if (lifecycle.baselineExists) eligible.add("hypothesis");
  if (lifecycle.reportPreviewAvailable) eligible.add("report");
  return eligible;
}

function mergeSignals(first: AbortSignal, second: AbortSignal): MergedSignal {
  const controller = new AbortController();
  const forwardAbort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason);
    }
  };
  const onFirstAbort = () => forwardAbort(first);
  const onSecondAbort = () => forwardAbort(second);

  if (first.aborted) {
    forwardAbort(first);
  } else if (second.aborted) {
    forwardAbort(second);
  } else {
    first.addEventListener("abort", onFirstAbort, { once: true });
    second.addEventListener("abort", onSecondAbort, { once: true });
  }

  return {
    signal: controller.signal,
    dispose() {
      first.removeEventListener("abort", onFirstAbort);
      second.removeEventListener("abort", onSecondAbort);
    },
  };
}

function registrationDescriptor(
  tool: WebMCPToolDefinition,
  lifecycleSignal: AbortSignal,
): Omit<WebMCPToolDefinition, "validationSchema" | "group"> {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
    async execute(input: unknown, options?: WebMCPExecuteOptions): Promise<WebMCPResult> {
      const fallbackController = new AbortController();
      const executionSignal = options?.signal ?? fallbackController.signal;
      const merged = mergeSignals(executionSignal, lifecycleSignal);
      try {
        return await tool.execute(input, { signal: merged.signal });
      } finally {
        merged.dispose();
      }
    },
  };
}

function safeMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim().slice(0, 500);
  }
  return "Unknown WebMCP registration error.";
}

function redactDebugValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth limit]";
  if (typeof value === "string") return value.slice(0, 500);
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    const result = value.slice(0, 40).map((item) => redactDebugValue(item, depth + 1));
    if (value.length > 40) result.push(`[${String(value.length - 40)} more items]`);
    return result;
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value).slice(0, 60)) {
      if (
        /(?:blob|base64|dataurl|localblobkey|filebytes|rawcontent|evidencecontent)/i.test(key) ||
        /^(?:note|notes|statement|statements|answer|answers|content)$/.test(key.toLowerCase())
      ) {
        result[key] = "[redacted]";
      } else {
        result[key] = redactDebugValue(child, depth + 1);
      }
    }
    return result;
  }
  if (typeof value === "bigint") return value.toString().slice(0, 200);
  if (typeof value === "symbol") return `[symbol ${value.description ?? "anonymous"}]`;
  if (typeof value === "function") return `[function ${value.name || "anonymous"}]`;
  return "[unsupported value]";
}

function parseExecuteToolResult(result: string): unknown {
  try {
    return JSON.parse(result) as unknown;
  } catch {
    return result;
  }
}

export class ReplayWebMCPRegistry {
  readonly support: WebMCPSupportState;

  private readonly adapter: ReplayWebMCPAdapter;
  private readonly modelContext: ModelContextLike | undefined;
  private readonly owner = Symbol("replay-webmcp-registry");
  private readonly groupedTools: Readonly<Record<WebMCPToolGroup, readonly WebMCPToolDefinition[]>>;
  private readonly toolState = new Map<WebMCPToolName, WebMCPDebugToolState>();
  private readonly activeGroups = new Map<WebMCPToolGroup, ActiveGroup>();
  private readonly failedGroups = new Set<WebMCPToolGroup>();
  private readonly debugListeners = new Set<(state: WebMCPDebugState) => void>();
  private readonly externalSignal: AbortSignal | undefined;

  private unsubscribeAdapter: (() => void) | undefined;
  private removeExternalAbortListener: (() => void) | undefined;
  private started = false;
  private disposed = false;
  private reconciliation: Promise<void> = Promise.resolve();
  private lastInvocation?: WebMCPDebugInvocation;
  private lastResult?: unknown;

  constructor(adapter: ReplayWebMCPAdapter, options: ReplayWebMCPRegistryOptions = {}) {
    this.adapter = adapter;
    this.modelContext =
      options.modelContext === undefined
        ? resolveGlobalModelContext()
        : (options.modelContext ?? undefined);
    this.externalSignal = options.signal;
    this.support = detectWebMCPSupport(this.modelContext ?? null);

    const tools = createReplayWebMCPTools(adapter, {
      onStart: (toolName, input) => {
        this.lastInvocation = {
          toolName,
          input: redactDebugValue(input),
          startedAt: new Date().toISOString(),
        };
        this.lastResult = undefined;
        this.emitDebugState();
      },
      onFinish: (toolName, result) => {
        if (this.lastInvocation?.toolName === toolName) {
          this.lastInvocation = {
            ...this.lastInvocation,
            finishedAt: new Date().toISOString(),
          };
        }
        this.lastResult = redactDebugValue(result);
        this.emitDebugState();
      },
      onCancel: (toolName, reason) => {
        if (this.lastInvocation?.toolName === toolName) {
          this.lastInvocation = {
            ...this.lastInvocation,
            finishedAt: new Date().toISOString(),
            cancelled: true,
          };
        }
        this.lastResult = {
          ok: false,
          code: "CANCELLED",
          message: safeMessage(reason),
        };
        this.emitDebugState();
      },
    });
    this.groupedTools = groupReplayWebMCPTools(tools);

    for (const tool of tools) {
      this.toolState.set(tool.name, {
        name: tool.name,
        title: tool.title,
        group: tool.group,
        description: tool.description,
        annotations: { ...tool.annotations },
        inputSchema: tool.inputSchema,
        registrationState: this.support.available ? "inactive" : "unsupported",
      });
    }
  }

  async start(): Promise<WebMCPDebugState> {
    if (this.disposed) {
      throw new Error("A stopped ReplayWebMCPRegistry cannot be restarted; create a new registry.");
    }
    if (!this.started) {
      this.started = true;
      this.unsubscribeAdapter = this.adapter.subscribe(() => {
        void this.reconcile();
      });
      if (this.externalSignal !== undefined) {
        const stop = () => this.stop();
        if (this.externalSignal.aborted) {
          stop();
        } else {
          this.externalSignal.addEventListener("abort", stop, { once: true });
          this.removeExternalAbortListener = () =>
            this.externalSignal?.removeEventListener("abort", stop);
        }
      }
    }

    await this.reconcile();
    return this.getDebugState();
  }

  async reconcile(): Promise<void> {
    if (!this.started || this.disposed || !this.support.available) {
      this.emitDebugState();
      return;
    }
    this.reconciliation = this.reconciliation.then(
      () => this.performReconciliation(),
      () => this.performReconciliation(),
    );
    await this.reconciliation;
  }

  stop(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeAdapter?.();
    this.unsubscribeAdapter = undefined;
    this.removeExternalAbortListener?.();
    this.removeExternalAbortListener = undefined;

    for (const group of [...TOOL_GROUPS].reverse()) {
      this.unregisterGroup(group);
    }
    this.failedGroups.clear();
    this.emitDebugState();
  }

  subscribeDebug(listener: (state: WebMCPDebugState) => void): () => void {
    this.debugListeners.add(listener);
    listener(this.getDebugState());
    return () => this.debugListeners.delete(listener);
  }

  getDebugState(): WebMCPDebugState {
    const lifecycle = this.adapter.getLifecycle();
    const tools = [...this.toolState.values()].map((tool) => ({
      ...tool,
      annotations: { ...tool.annotations },
      inputSchema: tool.inputSchema,
    }));
    return {
      supported: this.support.available,
      canSimulate: this.support.canSimulate,
      lifecycleMode: lifecycleMode(lifecycle),
      caseVersion: lifecycle.caseVersion,
      registeredToolNames: tools
        .filter((tool) => tool.registrationState === "registered")
        .map((tool) => tool.name),
      tools,
      ...(this.lastInvocation === undefined
        ? {}
        : {
            lastInvocation: {
              ...this.lastInvocation,
              input: redactDebugValue(this.lastInvocation.input),
            },
          }),
      ...(this.lastResult === undefined ? {} : { lastResult: redactDebugValue(this.lastResult) }),
    };
  }

  /** Uses the current draft's in-page getTools + executeTool path; it never bypasses the browser registry. */
  async simulateTool(
    name: WebMCPToolName,
    input: Readonly<Record<string, unknown>>,
    options: { signal?: AbortSignal } = {},
  ): Promise<unknown> {
    const modelContext = this.modelContext;
    if (modelContext?.getTools === undefined || modelContext.executeTool === undefined) {
      return {
        ok: false,
        code: "SIMULATION_UNAVAILABLE",
        message: "This browser does not expose document.modelContext.getTools and executeTool.",
      };
    }
    const fallbackController = new AbortController();
    const signal = options.signal ?? fallbackController.signal;
    throwIfAborted(signal);
    const tools = await modelContext.getTools();
    const registered = tools.find((tool) => tool.name === name);
    if (registered === undefined) {
      return {
        ok: false,
        code: "TOOL_NOT_REGISTERED",
        message: `${name} is not registered in the current lifecycle state.`,
      };
    }
    const result = await modelContext.executeTool(registered, input, { signal });
    return parseExecuteToolResult(result);
  }

  private async performReconciliation(): Promise<void> {
    if (this.disposed || this.modelContext === undefined) return;
    const desired = eligibleGroups(this.adapter.getLifecycle());

    for (const group of [...TOOL_GROUPS].reverse()) {
      if (!desired.has(group) && this.activeGroups.has(group)) {
        this.unregisterGroup(group);
      }
      if (!desired.has(group) && this.failedGroups.delete(group)) {
        for (const tool of this.groupedTools[group]) {
          this.updateToolState(tool.name, "inactive");
        }
      }
    }
    for (const group of TOOL_GROUPS) {
      if (desired.has(group) && !this.activeGroups.has(group) && !this.failedGroups.has(group)) {
        await this.registerGroup(group);
      }
    }
    this.emitDebugState();
  }

  private async registerGroup(group: WebMCPToolGroup): Promise<void> {
    const modelContext = this.modelContext;
    if (modelContext === undefined || this.activeGroups.has(group)) return;

    const controller = new AbortController();
    const active: ActiveGroup = { controller, names: [] };
    this.activeGroups.set(group, active);
    const tools = this.groupedTools[group];

    try {
      for (const tool of tools) {
        if (this.disposed || controller.signal.aborted) {
          throw controller.signal.reason ?? new Error("Registration lifecycle ended.");
        }
        if (!claimToolName(modelContext, tool.name, this.owner)) {
          throw new Error(`Duplicate WebMCP tool registration prevented for ${tool.name}.`);
        }
        active.names.push(tool.name);
        this.updateToolState(tool.name, "registering");
        await modelContext.registerTool(registrationDescriptor(tool, controller.signal), {
          signal: controller.signal,
        });
        throwIfAborted(controller.signal);
        this.updateToolState(tool.name, "registered");
      }
      this.failedGroups.delete(group);
    } catch (error) {
      controller.abort(error);
      this.activeGroups.delete(group);
      if (!this.disposed) this.failedGroups.add(group);
      for (const name of active.names) {
        releaseToolName(modelContext, name, this.owner);
      }
      const state = this.disposed ? "inactive" : "error";
      for (const tool of tools) {
        this.updateToolState(tool.name, state, this.disposed ? undefined : safeMessage(error));
      }
    }
  }

  private unregisterGroup(group: WebMCPToolGroup): void {
    const active = this.activeGroups.get(group);
    if (active === undefined) return;
    active.controller.abort(new DOMException("REPLAY WebMCP lifecycle ended.", "AbortError"));
    this.activeGroups.delete(group);
    if (this.modelContext !== undefined) {
      for (const name of active.names) {
        releaseToolName(this.modelContext, name, this.owner);
      }
    }
    for (const tool of this.groupedTools[group]) {
      this.updateToolState(tool.name, "inactive");
    }
  }

  private updateToolState(
    name: WebMCPToolName,
    registrationState: WebMCPDebugToolState["registrationState"],
    registrationError?: string,
  ): void {
    const previous = this.toolState.get(name);
    if (previous === undefined) return;
    const next: WebMCPDebugToolState = {
      ...previous,
      registrationState,
    };
    delete next.registrationError;
    if (registrationError !== undefined) next.registrationError = registrationError;
    this.toolState.set(name, next);
    this.emitDebugState();
  }

  private emitDebugState(): void {
    if (this.debugListeners.size === 0) return;
    const state = this.getDebugState();
    for (const listener of this.debugListeners) listener(state);
  }
}
