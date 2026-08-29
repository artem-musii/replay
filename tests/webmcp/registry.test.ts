import { describe, expect, it, vi } from "vitest";

import { ReplayWebMCPRegistry } from "../../src/webmcp/registry";
import { WEBMCP_READ_OUTPUT_LIMIT_BYTES } from "../../src/webmcp/tools";
import {
  BASE_TOOL_NAMES,
  FACT_TOOL_NAMES,
  HYPOTHESIS_TOOL_NAMES,
  SCENE_TOOL_NAMES,
  TOOL_NAMES,
  type ActivityAuthorFilter,
  type ConsistencyScope,
  type ReplayAdapterResult,
  type ReplayInvocationContext,
  type ReplayIssue,
  type ReplayToolInvocationAudit,
  type ReplayWebMCPAdapter,
  type ReplayWebMCPCommand,
  type ReplayWebMCPLifecycle,
  type WebMCPResult,
  type WorkspaceItemType,
  type WorkspaceSection,
} from "../../src/webmcp/types";
import { ModelContextPolyfill } from "./model-context-polyfill";

const INITIAL_VERSION = 7;

function cancellationError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  const error = new Error("Cancelled");
  error.name = "AbortError";
  return error;
}

function successResult(version: number, affectedIds: readonly string[] = []): ReplayAdapterResult {
  return {
    ok: true,
    message: "Applied the canonical command and synchronized the visible workspace.",
    caseVersion: version,
    activityId: `activity-${String(version)}`,
    affectedIds,
    issues: [],
  };
}

class TestAdapter implements ReplayWebMCPAdapter {
  lifecycle: ReplayWebMCPLifecycle = {
    caseOpen: true,
    sceneExists: false,
    factsAvailable: false,
    baselineExists: false,
    reportPreviewAvailable: false,
    caseVersion: INITIAL_VERSION,
    workspaceMode: "scene",
  };

  readonly listeners = new Set<() => void>();
  readonly executeCalls: ReplayWebMCPCommand[] = [];
  readonly committedRequestIds: string[] = [];
  readonly workingStates: { active: boolean; toolName: string; requestId?: string }[] = [];
  readonly revealedIds: string[][] = [];
  readonly revealedComparisons: string[][] = [];
  readonly readCalls: string[] = [];
  readonly invocationAudits: ReplayToolInvocationAudit[] = [];
  readonly requestResults = new Map<string, ReplayAdapterResult>();

  executeHook:
    | ((
        command: ReplayWebMCPCommand,
        context: ReplayInvocationContext,
      ) => Promise<ReplayAdapterResult>)
    | undefined;

  getLifecycle(): ReplayWebMCPLifecycle {
    return this.lifecycle;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(): void {
    for (const listener of this.listeners) listener();
  }

  getCaseSummary(context: ReplayInvocationContext): unknown {
    this.readCalls.push(context.toolName);
    return {
      title: "Demo collision",
      categories: { confirmed: 2, reported: 3, disputed: 1, hypothetical: 0 },
      activeBranchId: "branch-main",
      unresolvedBlockers: 1,
    };
  }

  getWorkspaceState(
    sections: readonly WorkspaceSection[],
    context: ReplayInvocationContext,
  ): unknown {
    this.readCalls.push(context.toolName);
    return Object.fromEntries(sections.map((section) => [section, { available: true }]));
  }

  getRecentActivity(
    input: Readonly<{ limit: number; author: ActivityAuthorFilter }>,
    context: ReplayInvocationContext,
  ): unknown {
    this.readCalls.push(context.toolName);
    return { input, activity: [] };
  }

  validateConsistency(
    input: Readonly<{ branchId?: string; scope: ConsistencyScope }>,
    context: ReplayInvocationContext,
  ): readonly ReplayIssue[] {
    this.readCalls.push(context.toolName);
    return [{ id: "issue-1", code: `test-${input.scope}`, severity: "warning" }];
  }

  compareHypotheses(
    input: Readonly<{ branchIds: readonly string[] }>,
    context: ReplayInvocationContext,
  ): unknown {
    this.readCalls.push(context.toolName);
    return { ...input, differences: [] };
  }

  revealHypothesisComparison(branchIds: readonly string[]): void {
    this.revealedComparisons.push([...branchIds]);
  }

  focusWorkspaceItem(
    input: Readonly<{ itemType: WorkspaceItemType; itemId: string; workspaceMode?: string }>,
  ): ReplayAdapterResult {
    this.lifecycle = {
      ...this.lifecycle,
      workspaceMode: input.workspaceMode ?? this.lifecycle.workspaceMode,
      selectedItemId: input.itemId,
    };
    return {
      ok: true,
      message: "Focused the existing workspace item.",
      caseVersion: this.lifecycle.caseVersion,
      affectedIds: [input.itemId],
      issues: [],
    };
  }

  revertAgentAction(
    input: Readonly<{ activityId: string; expectedVersion: number; requestId: string }>,
    context: ReplayInvocationContext,
  ): Promise<ReplayAdapterResult> | ReplayAdapterResult {
    return this.execute(
      {
        type: "add_report_note",
        payload: { revertedActivityId: input.activityId },
        actor: "agent",
        origin: "webmcp",
        expectedVersion: input.expectedVersion,
        requestId: input.requestId,
      },
      context,
    );
  }

  async execute(
    command: ReplayWebMCPCommand,
    context: ReplayInvocationContext,
  ): Promise<ReplayAdapterResult> {
    this.executeCalls.push(command);
    if (this.executeHook !== undefined) return this.executeHook(command, context);
    if (context.signal.aborted) throw context.signal.reason;

    const existing = this.requestResults.get(command.requestId);
    if (existing !== undefined) return existing;
    if (command.expectedVersion !== this.lifecycle.caseVersion) {
      return {
        ok: false,
        code: "VERSION_CONFLICT",
        message: `Expected version ${String(command.expectedVersion)}; current version is ${String(this.lifecycle.caseVersion)}.`,
        caseVersion: this.lifecycle.caseVersion,
        affectedIds: [],
        issues: [],
      };
    }

    const affectedId =
      typeof command.payload.actorId === "string"
        ? command.payload.actorId
        : `${command.type}-result`;
    this.lifecycle = {
      ...this.lifecycle,
      caseVersion: this.lifecycle.caseVersion + 1,
      ...(command.type === "add_report_note" ? { reportPreviewAvailable: false } : {}),
    };
    this.committedRequestIds.push(command.requestId);
    const result = successResult(this.lifecycle.caseVersion, [affectedId]);
    this.requestResults.set(command.requestId, result);
    this.emit();
    return result;
  }

  buildReportPreview(
    input: Readonly<{ branchId?: string; expectedVersion: number }>,
  ): ReplayAdapterResult {
    if (input.expectedVersion !== this.lifecycle.caseVersion) {
      return {
        ok: false,
        code: "VERSION_CONFLICT",
        message: "The report preview version is stale.",
        caseVersion: this.lifecycle.caseVersion,
        affectedIds: [],
        issues: [],
      };
    }
    this.lifecycle = {
      ...this.lifecycle,
      reportPreviewAvailable: true,
      workspaceMode: "report",
    };
    this.emit();
    return {
      ok: true,
      message: "Built the report preview.",
      caseVersion: this.lifecycle.caseVersion,
      affectedIds: ["report-preview"],
      issues: [],
    };
  }

  setAgentWorking(state: {
    active: boolean;
    toolName: (typeof TOOL_NAMES)[number];
    requestId?: string;
  }): void {
    this.workingStates.push({ ...state });
  }

  revealAffected(affectedIds: readonly string[]): void {
    this.revealedIds.push([...affectedIds]);
    this.lifecycle = {
      ...this.lifecycle,
      ...(affectedIds[0] === undefined ? {} : { selectedItemId: affectedIds[0] }),
    };
  }

  recordToolInvocation(audit: ReplayToolInvocationAudit): void {
    this.invocationAudits.push(audit);
  }
}

function allContexts(adapter: TestAdapter): void {
  adapter.lifecycle = {
    ...adapter.lifecycle,
    sceneExists: true,
    factsAvailable: true,
    baselineExists: true,
    reportPreviewAvailable: true,
  };
}

function validActorInput(requestId = "request-actor-0001", expectedVersion = INITIAL_VERSION) {
  return {
    actorId: "vehicle-b",
    label: "Vehicle B",
    position: { x: 0.58, y: 0.42 },
    rotationDeg: 18,
    dimensions: { width: 1.8, length: 4.3 },
    expectedPoseTarget: { branchId: "branch-main", playheadTimeMs: 0 },
    expectedVersion,
    requestId,
  };
}

class NativeStringInputModelContext extends ModelContextPolyfill {
  readonly rawExecutionInputs: unknown[] = [];

  override executeTool(
    registeredTool: Parameters<ModelContextPolyfill["executeTool"]>[0],
    input: Readonly<Record<string, unknown>> | string = {},
    options: Parameters<ModelContextPolyfill["executeTool"]>[2] = {},
  ): Promise<string> {
    this.rawExecutionInputs.push(input);
    if (typeof input !== "string") {
      return Promise.reject(new DOMException("Failed to parse input arguments", "UnknownError"));
    }
    return super.executeTool(registeredTool, input, options);
  }
}

class FailFirstRegistrationModelContext extends ModelContextPolyfill {
  failureCount = 0;

  override registerTool(
    tool: Parameters<ModelContextPolyfill["registerTool"]>[0],
    options: Parameters<ModelContextPolyfill["registerTool"]>[1] = {},
  ): Promise<void> {
    if (this.failureCount === 0) {
      this.failureCount += 1;
      return Promise.reject(
        new DOMException("Temporary browser registration failure.", "UnknownError"),
      );
    }
    return super.registerTool(tool, options);
  }
}

describe("ReplayWebMCPRegistry", () => {
  it("feature-detects a document.modelContext polyfill after client hydration", async () => {
    const adapter = new TestAdapter();
    const modelContext = new ModelContextPolyfill();
    const previous = Object.getOwnPropertyDescriptor(document, "modelContext");
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: modelContext,
    });

    try {
      const registry = new ReplayWebMCPRegistry(adapter);
      const state = await registry.start();
      expect(state.supported).toBe(true);
      expect(state.canSimulate).toBe(true);
      expect(modelContext.registeredNames()).toEqual([...BASE_TOOL_NAMES].sort());
      registry.stop();
    } finally {
      if (previous === undefined) {
        Reflect.deleteProperty(document, "modelContext");
      } else {
        Object.defineProperty(document, "modelContext", previous);
      }
    }
  });

  it("progressively falls back when document.modelContext is unavailable", async () => {
    const adapter = new TestAdapter();
    const registry = new ReplayWebMCPRegistry(adapter, { modelContext: null });

    const state = await registry.start();

    expect(state.supported).toBe(false);
    expect(state.registeredToolNames).toEqual([]);
    expect(state.tools.every((tool) => tool.registrationState === "unsupported")).toBe(true);
    expect(adapter.listeners.size).toBe(1);
    registry.stop();
    expect(adapter.listeners.size).toBe(0);
  });

  it("fails closed when a read exceeds the Site Tools output budget", async () => {
    const adapter = new TestAdapter();
    vi.spyOn(adapter, "getWorkspaceState").mockReturnValue({
      scene: { oversizedText: "x".repeat(WEBMCP_READ_OUTPUT_LIMIT_BYTES) },
    });
    const modelContext = new ModelContextPolyfill();
    const registry = new ReplayWebMCPRegistry(adapter, { modelContext });
    await registry.start();

    const first = (await registry.simulateTool("get_workspace_state", {
      sections: ["scene"],
    })) as { ok: boolean; code: string; message: string };
    const second = (await registry.simulateTool("get_workspace_state", {
      sections: ["scene"],
    })) as { ok: boolean; code: string; message: string };

    expect(first).toMatchObject({ ok: false, code: "OUTPUT_BUDGET_EXCEEDED" });
    expect(first.message).toContain(`${String(WEBMCP_READ_OUTPUT_LIMIT_BYTES)}-byte safety budget`);
    expect(first.message).toContain("Request fewer workspace sections");
    expect(second).toEqual(first);
    expect(adapter.executeCalls).toEqual([]);
    expect(adapter.lifecycle.caseVersion).toBe(INITIAL_VERSION);
    registry.stop();
  });

  it("counts consistency issues as part of the complete read-output budget", async () => {
    const adapter = new TestAdapter();
    vi.spyOn(adapter, "validateConsistency").mockReturnValue([
      { id: "issue-oversized", detail: "x".repeat(WEBMCP_READ_OUTPUT_LIMIT_BYTES) },
    ]);
    const modelContext = new ModelContextPolyfill();
    const registry = new ReplayWebMCPRegistry(adapter, { modelContext });
    await registry.start();

    const result = await registry.simulateTool("validate_case_consistency", { scope: "all" });

    expect(result).toMatchObject({ ok: false, code: "OUTPUT_BUDGET_EXCEEDED" });
    expect(adapter.executeCalls).toEqual([]);
    expect(adapter.lifecycle.caseVersion).toBe(INITIAL_VERSION);
    registry.stop();
  });

  it("retries a read rather than pairing stale data with a newer caseVersion", async () => {
    const adapter = new TestAdapter();
    const getCaseSummary = vi
      .spyOn(adapter, "getCaseSummary")
      .mockImplementationOnce(() => {
        const snapshotVersion = adapter.lifecycle.caseVersion;
        adapter.lifecycle = { ...adapter.lifecycle, caseVersion: snapshotVersion + 1 };
        return { snapshotVersion };
      })
      .mockImplementationOnce(() => ({ snapshotVersion: adapter.lifecycle.caseVersion }));
    const registry = new ReplayWebMCPRegistry(adapter, {
      modelContext: new ModelContextPolyfill(),
    });
    await registry.start();

    const result = await registry.simulateTool("get_case_summary", {});

    expect(result).toMatchObject({
      ok: true,
      caseVersion: INITIAL_VERSION + 1,
      data: { snapshotVersion: INITIAL_VERSION + 1 },
    });
    expect(getCaseSummary).toHaveBeenCalledTimes(2);
    registry.stop();
  });

  it("fails a read with VERSION_CONFLICT when no stable snapshot can be assembled", async () => {
    const adapter = new TestAdapter();
    const getCaseSummary = vi.spyOn(adapter, "getCaseSummary").mockImplementation(() => {
      const snapshotVersion = adapter.lifecycle.caseVersion;
      adapter.lifecycle = { ...adapter.lifecycle, caseVersion: snapshotVersion + 1 };
      return { snapshotVersion };
    });
    const registry = new ReplayWebMCPRegistry(adapter, {
      modelContext: new ModelContextPolyfill(),
    });
    await registry.start();

    const result = await registry.simulateTool("get_case_summary", {});

    expect(result).toMatchObject({
      ok: false,
      code: "VERSION_CONFLICT",
      caseVersion: INITIAL_VERSION + 2,
    });
    expect(result).not.toHaveProperty("data");
    expect(getCaseSummary).toHaveBeenCalledTimes(2);
    registry.stop();
  });

  it("keeps a committed mutation successful while bounding oversized response details", async () => {
    const adapter = new TestAdapter();
    allContexts(adapter);
    adapter.executeHook = () => {
      adapter.lifecycle = { ...adapter.lifecycle, caseVersion: INITIAL_VERSION + 1 };
      return Promise.resolve({
        ok: true,
        message: "Committed the large canonical mutation.",
        caseVersion: INITIAL_VERSION + 1,
        activityId: "activity-large-mutation",
        affectedIds: Array.from({ length: 5_000 }, (_, index) => `actor-${String(index)}`),
        issues: [
          {
            id: "issue-oversized-mutation",
            detail: "x".repeat(WEBMCP_READ_OUTPUT_LIMIT_BYTES),
          },
        ],
        data: { oversizedText: "x".repeat(WEBMCP_READ_OUTPUT_LIMIT_BYTES) },
      });
    };
    const modelContext = new ModelContextPolyfill();
    const registry = new ReplayWebMCPRegistry(adapter, { modelContext });
    await registry.start();

    const result = (await registry.simulateTool(
      "upsert_scene_actor",
      validActorInput(),
    )) as WebMCPResult<{
      resultTruncated: boolean;
      totalAffectedIds: number;
      totalIssues: number;
    }>;

    expect(result).toMatchObject({
      ok: true,
      caseVersion: INITIAL_VERSION + 1,
      activityId: "activity-large-mutation",
      issues: [],
      data: {
        resultTruncated: true,
        totalAffectedIds: 5_000,
        totalIssues: 1,
      },
    });
    expect(result.affectedIds).toHaveLength(50);
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(
      WEBMCP_READ_OUTPUT_LIMIT_BYTES,
    );
    registry.stop();
  });

  it("does not reveal hypothesis comparison when its output exceeds the budget", async () => {
    const adapter = new TestAdapter();
    allContexts(adapter);
    vi.spyOn(adapter, "compareHypotheses")
      .mockReturnValueOnce({
        oversizedText: "x".repeat(WEBMCP_READ_OUTPUT_LIMIT_BYTES),
      })
      .mockReturnValueOnce({ differences: [] });
    const modelContext = new ModelContextPolyfill();
    const registry = new ReplayWebMCPRegistry(adapter, { modelContext });
    await registry.start();

    const result = await registry.simulateTool("compare_hypotheses", {
      branchIds: ["branch-baseline", "branch-alternative"],
    });

    expect(result).toMatchObject({ ok: false, code: "OUTPUT_BUDGET_EXCEEDED" });
    expect(adapter.revealedComparisons).toEqual([]);
    expect(adapter.executeCalls).toEqual([]);
    expect(adapter.lifecycle.caseVersion).toBe(INITIAL_VERSION);

    const recovered = await registry.simulateTool("compare_hypotheses", {
      branchIds: ["branch-baseline", "branch-alternative"],
    });
    expect(recovered).toMatchObject({ ok: true, caseVersion: INITIAL_VERSION });
    expect(adapter.revealedComparisons).toEqual([["branch-baseline", "branch-alternative"]]);
    registry.stop();
  });

  it("registers stable base tools and only coarse contextual groups", async () => {
    const adapter = new TestAdapter();
    const modelContext = new ModelContextPolyfill();
    const registry = new ReplayWebMCPRegistry(adapter, { modelContext });

    await registry.start();
    expect(modelContext.registeredNames()).toEqual([...BASE_TOOL_NAMES].sort());
    expect(modelContext.registrationCalls).toEqual([...BASE_TOOL_NAMES]);

    adapter.lifecycle = {
      ...adapter.lifecycle,
      caseVersion: 8,
      selectedItemId: "vehicle-a",
      workspaceMode: "claims",
    };
    adapter.emit();
    await registry.reconcile();
    expect(modelContext.registrationCalls).toEqual([...BASE_TOOL_NAMES]);

    adapter.lifecycle = { ...adapter.lifecycle, sceneExists: true };
    adapter.emit();
    await registry.reconcile();
    expect(modelContext.registeredNames()).toEqual(
      [...BASE_TOOL_NAMES, ...SCENE_TOOL_NAMES].sort(),
    );

    adapter.lifecycle = { ...adapter.lifecycle, factsAvailable: true, baselineExists: true };
    adapter.emit();
    await registry.reconcile();
    expect(modelContext.registeredNames()).toEqual(
      [
        ...BASE_TOOL_NAMES,
        ...SCENE_TOOL_NAMES,
        ...FACT_TOOL_NAMES,
        ...HYPOTHESIS_TOOL_NAMES,
        "build_report_preview",
      ].sort(),
    );

    adapter.lifecycle = { ...adapter.lifecycle, reportPreviewAvailable: true };
    adapter.emit();
    await registry.reconcile();
    expect(modelContext.registeredNames()).toEqual([...TOOL_NAMES].sort());

    adapter.lifecycle = { ...adapter.lifecycle, reportPreviewAvailable: false, sceneExists: false };
    adapter.emit();
    await registry.reconcile();
    expect(modelContext.registeredNames()).toEqual(
      [
        ...BASE_TOOL_NAMES,
        ...FACT_TOOL_NAMES,
        ...HYPOTHESIS_TOOL_NAMES,
        "build_report_preview",
      ].sort(),
    );
    expect(modelContext.abortedRegistrations).toEqual(
      expect.arrayContaining(["add_report_note", ...SCENE_TOOL_NAMES]),
    );
  });

  it("cycles report-note eligibility 18 to 19 to 18 to 19 as previews become stale", async () => {
    const adapter = new TestAdapter();
    adapter.lifecycle = {
      ...adapter.lifecycle,
      sceneExists: true,
      factsAvailable: true,
      baselineExists: true,
      reportPreviewAvailable: false,
    };
    const modelContext = new ModelContextPolyfill();
    const registry = new ReplayWebMCPRegistry(adapter, { modelContext });
    await registry.start();
    expect(modelContext.registeredNames()).toHaveLength(18);
    expect(modelContext.registeredNames()).not.toContain("add_report_note");

    const firstPreview = await registry.simulateTool("build_report_preview", {
      expectedVersion: INITIAL_VERSION,
    });
    expect(firstPreview).toMatchObject({ ok: true, caseVersion: INITIAL_VERSION });
    await registry.reconcile();
    expect(modelContext.registeredNames()).toHaveLength(19);
    expect(modelContext.registeredNames()).toContain("add_report_note");

    const note = (await registry.simulateTool("add_report_note", {
      note: "Keep this cited context visible for human review.",
      claimIds: ["claim-human-statement"],
      evidenceIds: [],
      expectedVersion: INITIAL_VERSION,
      requestId: "request-report-note-cycle-0001",
    })) as WebMCPResult;
    expect(note).toMatchObject({ ok: true, caseVersion: INITIAL_VERSION + 1 });
    expect(note.message).toContain("prior report preview is now invalid and closed");
    expect(note.message).toContain("leaves the next Site Tools inventory");
    await registry.reconcile();
    expect(modelContext.registeredNames()).toHaveLength(18);
    expect(modelContext.registeredNames()).not.toContain("add_report_note");

    const secondPreview = await registry.simulateTool("build_report_preview", {
      expectedVersion: INITIAL_VERSION + 1,
    });
    expect(secondPreview).toMatchObject({ ok: true, caseVersion: INITIAL_VERSION + 1 });
    await registry.reconcile();
    expect(modelContext.registeredNames()).toHaveLength(19);
    expect(modelContext.registeredNames()).toContain("add_report_note");
    registry.stop();
  });

  it("removes base tools when the workspace closes and restores them on a new case boundary", async () => {
    const adapter = new TestAdapter();
    const modelContext = new ModelContextPolyfill();
    const registry = new ReplayWebMCPRegistry(adapter, { modelContext });
    await registry.start();

    adapter.lifecycle = { ...adapter.lifecycle, caseOpen: false };
    adapter.emit();
    await registry.reconcile();
    expect(modelContext.registeredNames()).toEqual([]);
    expect(registry.getDebugState().lifecycleMode).toBe("closed");

    adapter.lifecycle = { ...adapter.lifecycle, caseOpen: true, caseVersion: 0 };
    adapter.emit();
    await registry.reconcile();
    expect(modelContext.registeredNames()).toEqual([...BASE_TOOL_NAMES].sort());
    expect(modelContext.registrationCalls).toHaveLength(BASE_TOOL_NAMES.length * 2);
  });

  it("aborts every registration on teardown and does not duplicate on repeated start", async () => {
    const adapter = new TestAdapter();
    allContexts(adapter);
    const modelContext = new ModelContextPolyfill();
    const registry = new ReplayWebMCPRegistry(adapter, { modelContext });

    await registry.start();
    await registry.start();
    expect(modelContext.registrationCalls).toHaveLength(TOOL_NAMES.length);

    registry.stop();
    expect(modelContext.registeredNames()).toEqual([]);
    expect(modelContext.abortedRegistrations).toHaveLength(TOOL_NAMES.length);
    expect(registry.getDebugState().registeredToolNames).toEqual([]);
  });

  it("manually retries a failed eligible registration group without duplicating tools", async () => {
    const adapter = new TestAdapter();
    const modelContext = new FailFirstRegistrationModelContext();
    const registry = new ReplayWebMCPRegistry(adapter, { modelContext });

    const failed = await registry.start();
    expect(modelContext.registeredNames()).toEqual([]);
    expect(
      failed.tools
        .filter((tool) => tool.group === "base")
        .every((tool) => tool.registrationState === "error"),
    ).toBe(true);

    const recovered = await registry.retryFailedRegistrations();
    expect(recovered.registeredToolNames).toEqual([...BASE_TOOL_NAMES]);
    expect(modelContext.registeredNames()).toEqual([...BASE_TOOL_NAMES].sort());
    expect(modelContext.registrationCalls).toEqual([...BASE_TOOL_NAMES]);

    await registry.retryFailedRegistrations();
    expect(modelContext.registrationCalls).toEqual([...BASE_TOOL_NAMES]);
    registry.stop();
  });

  it("prevents duplicate ownership across registry instances", async () => {
    const adapter = new TestAdapter();
    const modelContext = new ModelContextPolyfill();
    const first = new ReplayWebMCPRegistry(adapter, { modelContext });
    const second = new ReplayWebMCPRegistry(adapter, { modelContext });

    await first.start();
    await second.start();

    expect(modelContext.registrationCalls).toEqual([...BASE_TOOL_NAMES]);
    expect(modelContext.registeredNames()).toEqual([...BASE_TOOL_NAMES].sort());
    expect(
      second
        .getDebugState()
        .tools.filter((tool) => tool.group === "base")
        .every((tool) => tool.registrationState === "error"),
    ).toBe(true);

    await second.retryFailedRegistrations();
    expect(modelContext.registrationCalls).toEqual([...BASE_TOOL_NAMES]);
    expect(
      second
        .getDebugState()
        .tools.filter((tool) => tool.group === "base")
        .every((tool) => tool.registrationState === "error"),
    ).toBe(true);

    first.stop();
    await second.retryFailedRegistrations();
    expect(modelContext.registeredNames()).toEqual([...BASE_TOOL_NAMES].sort());
    expect(second.getDebugState().registeredToolNames).toEqual([...BASE_TOOL_NAMES]);
    second.stop();
  });

  it("publishes valid JSON schemas and precise trust annotations", async () => {
    const adapter = new TestAdapter();
    allContexts(adapter);
    const modelContext = new ModelContextPolyfill();
    const registry = new ReplayWebMCPRegistry(adapter, { modelContext });
    await registry.start();

    const state = registry.getDebugState();
    expect(TOOL_NAMES).toHaveLength(19);
    expect(modelContext.registeredNames()).toHaveLength(19);
    expect(state.tools).toHaveLength(TOOL_NAMES.length);
    for (const tool of state.tools) {
      expect(() => {
        JSON.parse(JSON.stringify(tool.inputSchema));
      }).not.toThrow();
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.annotations.untrustedContentHint).toBe(true);
      const definition = modelContext.definition(tool.name);
      expect(definition?.description).toContain("ok:boolean");
      expect(definition?.description).toContain("machine-readable code");
    }

    expect(modelContext.definition("get_case_summary")?.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    });
    expect(modelContext.definition("validate_case_consistency")?.annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    });
    expect(modelContext.definition("compare_hypotheses")?.annotations).toEqual({
      readOnlyHint: false,
      untrustedContentHint: true,
    });
    expect(modelContext.definition("focus_workspace_item")?.annotations.readOnlyHint).toBe(false);
    expect(modelContext.definition("focus_workspace_item")?.annotations.untrustedContentHint).toBe(
      true,
    );
    expect(modelContext.definition("revert_agent_action")?.annotations.untrustedContentHint).toBe(
      true,
    );
    expect(modelContext.definition("get_recent_activity")?.description).toContain(
      "current revertEligible",
    );
    const revertProperties = modelContext.definition("revert_agent_action")?.inputSchema
      .properties as Record<string, { description?: string }>;
    expect(revertProperties.activityId?.description).toContain(
      "Canonical activity id returned in get_recent_activity",
    );
    expect(revertProperties.activityId?.description).toContain("revertEligible value is true");
    expect(modelContext.definition("build_report_preview")?.annotations).toEqual({
      readOnlyHint: false,
      untrustedContentHint: true,
    });
    expect(modelContext.definition("build_report_preview")?.description).toContain(
      "preview requirement completeness separate from finalized and share-ready status",
    );
    expect(modelContext.definition("build_report_preview")?.description).toContain(
      "add_report_note becomes available in the next Site Tools inventory",
    );
    expect(modelContext.definition("get_workspace_state")?.description).toContain(
      "visiblePreviewStatus",
    );
    expect(modelContext.definition("get_workspace_state")?.description).toContain("visiblePreview");
    expect(modelContext.definition("get_workspace_state")?.description).toContain(
      "normalized scene coordinates from 0 to 1",
    );
    expect(modelContext.definition("get_workspace_state")?.description).toContain(
      "does not activate that branch",
    );
    const workspaceProperties = modelContext.definition("get_workspace_state")?.inputSchema
      .properties as Record<string, Record<string, unknown>>;
    expect(workspaceProperties.branchId?.description).toContain(
      "Reading another branch does not activate it",
    );

    const focusProperties = modelContext.definition("focus_workspace_item")?.inputSchema
      .properties as Record<string, Record<string, unknown>>;
    expect(focusProperties.workspaceMode).toBeUndefined();
    expect(focusProperties.branchId?.description).toContain("inactive-branch item");

    const impactProperties = modelContext.definition("mark_impact_event")?.inputSchema
      .properties as Record<string, Record<string, unknown>>;
    expect(impactProperties.actorIds?.uniqueItems).toBe(true);
    expect(impactProperties.status?.enum).toEqual(["reported", "uncertain", "agent-hypothesis"]);
    expect(impactProperties.eventId?.description).toContain("existing impact event on branchId");
    expect(impactProperties.eventId?.description).toContain("never reclassified or moved");

    const actorDefinition = modelContext.definition("upsert_scene_actor");
    const actorProperties = actorDefinition?.inputSchema.properties as Record<
      string,
      Record<string, unknown>
    >;
    const actorRequired = actorDefinition?.inputSchema.required as string[];
    expect(actorRequired).toEqual(expect.arrayContaining(["expectedVersion", "requestId"]));
    expect(actorRequired).not.toEqual(
      expect.arrayContaining(["label", "position", "rotationDeg", "dimensions"]),
    );
    expect(actorProperties.actorId?.description).toContain("Existing actor ID");
    expect(actorProperties.expectedVersion?.description).toContain("Current caseVersion");
    expect(actorProperties.requestId?.description).toContain("idempotency key");
    expect(actorProperties.expectedPoseTarget?.description).toContain("VERSION_CONFLICT");
    expect(actorDefinition?.description).toContain("updates only the supplied fields");
    expect(actorDefinition?.description).toContain("expectedPoseTarget");
    expect(modelContext.definition("set_actor_trajectory")?.description).toContain(
      "Directly creates or replaces canonical trajectory geometry",
    );
    expect(modelContext.definition("set_actor_trajectory")?.description).toContain(
      "use propose_scene_changes",
    );
    expect(modelContext.definition("propose_scene_changes")?.description).toContain(
      "trajectory-keyframe-patch",
    );
    expect(modelContext.definition("propose_scene_changes")?.description).toContain(
      "preserving path, timing, IDs, and endpoints",
    );
    expect(modelContext.definition("propose_scene_changes")?.description).toContain(
      "expectedPoseTarget",
    );
    expect(modelContext.definition("compare_hypotheses")?.description).toContain(
      "bounded trajectory and event deltas",
    );
    expect(modelContext.definition("compare_hypotheses")?.description).toContain(
      "does not activate a branch",
    );
    const damageProperties = modelContext.definition("mark_vehicle_damage")?.inputSchema
      .properties as Record<string, Record<string, unknown>>;
    expect(damageProperties.sourceIds?.minItems).toBe(1);
    expect(damageProperties.sourceIds?.description).toContain("source this non-confirmed damage");
    const observationProperties = modelContext.definition("add_observation")?.inputSchema
      .properties as Record<string, Record<string, unknown>>;
    expect(observationProperties.sourceIds?.description).toContain("used as canonical provenance");
    expect(observationProperties.relatedIds?.description).toContain(
      "provide inspectable context without becoming provenance sources",
    );
    expect(observationProperties.linkedIds).toBeUndefined();
    const assumptionProperties = modelContext.definition("update_hypothesis_assumption")
      ?.inputSchema.properties as Record<string, Record<string, unknown>>;
    expect(assumptionProperties.operation?.description).toContain("Operation discriminator");
    expect(assumptionProperties.assumptionId?.description).toContain("omit for add");
    expect(assumptionProperties.assumption?.description).toContain("omit for remove");
  });

  it("keeps registered tool descriptions within the discovery budget", async () => {
    const adapter = new TestAdapter();
    allContexts(adapter);
    const modelContext = new ModelContextPolyfill();
    const registry = new ReplayWebMCPRegistry(adapter, { modelContext });
    await registry.start();

    for (const toolName of TOOL_NAMES) {
      const description = modelContext.definition(toolName)?.description;
      expect(description, toolName).toBeDefined();
      expect(description?.length, toolName).toBeLessThanOrEqual(500);
    }
    registry.stop();
  });

  it("validates inputs locally before calling the canonical adapter", async () => {
    const adapter = new TestAdapter();
    allContexts(adapter);
    const modelContext = new ModelContextPolyfill();
    const registry = new ReplayWebMCPRegistry(adapter, { modelContext });
    await registry.start();

    const invalidActor = (await registry.simulateTool("upsert_scene_actor", {
      ...validActorInput(),
      position: { x: 1.2, y: 0.4 },
      unexpected: true,
    })) as { ok: boolean; code: string };
    expect(invalidActor).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    const incompleteNewActor = (await registry.simulateTool("upsert_scene_actor", {
      position: { x: 0.4, y: 0.4 },
      expectedVersion: INITIAL_VERSION,
      requestId: "request-incomplete-new-actor",
    })) as { ok: boolean; code: string; message: string };
    expect(incompleteNewActor).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(incompleteNewActor.message).toContain("required when creating");

    const actorIdOnly = (await registry.simulateTool("upsert_scene_actor", {
      actorId: "vehicle-a",
      expectedVersion: INITIAL_VERSION,
      requestId: "request-empty-actor-update",
    })) as { ok: boolean; code: string; message: string };
    expect(actorIdOnly).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(actorIdOnly.message).toContain("requires at least one editable field");

    const unboundActorPose = (await registry.simulateTool("upsert_scene_actor", {
      actorId: "vehicle-a",
      position: { x: 0.5, y: 0.5 },
      expectedVersion: INITIAL_VERSION,
      requestId: "request-unbound-actor-pose",
    })) as { ok: boolean; code: string; message: string };
    expect(unboundActorPose).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(unboundActorPose.message).toContain("expectedPoseTarget is required");

    const unboundProposalPose = (await registry.simulateTool("propose_scene_changes", {
      title: "Unbound actor pose proposal",
      rationale: "A pose preview must name the reviewed branch and playhead.",
      changes: [
        {
          kind: "actor-pose",
          actorId: "vehicle-a",
          proposedPose: { x: 0.4, y: 0.4, rotationDeg: 0 },
        },
        {
          kind: "actor-pose",
          actorId: "vehicle-b",
          proposedPose: { x: 0.5, y: 0.5, rotationDeg: 5 },
        },
      ],
      expectedVersion: INITIAL_VERSION,
      requestId: "request-unbound-proposal-pose",
    })) as { ok: boolean; code: string; message: string };
    expect(unboundProposalPose).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(unboundProposalPose.message).toContain("expectedPoseTarget is required");

    const invalidTrajectory = (await registry.simulateTool("set_actor_trajectory", {
      actorId: "vehicle-b",
      branchId: "branch-main",
      keyframes: [
        { timeMs: 1000, x: 0.2, y: 0.4, rotationDeg: 0 },
        { timeMs: 1000, x: 0.4, y: 0.4, rotationDeg: 0 },
      ],
      expectedVersion: INITIAL_VERSION,
      requestId: "request-path-0001",
    })) as { ok: boolean; code: string; message: string };
    expect(invalidTrajectory).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(invalidTrajectory.message).toContain("strictly increasing");

    const confirmedObservation = (await registry.simulateTool("add_observation", {
      statement: "The agent says this is certain.",
      sourceType: "agent-inference",
      sourceIds: [],
      relatedIds: [],
      status: "confirmed",
      branchId: "branch-main",
      sharedAcrossBranches: false,
      expectedVersion: INITIAL_VERSION,
      requestId: "request-claim-0001",
    })) as { ok: boolean; code: string };
    expect(confirmedObservation).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    const unsourcedExternalObservation = (await registry.simulateTool("add_observation", {
      statement: "The agent cannot invent a witness statement source.",
      sourceType: "witness-statement",
      sourceIds: [],
      relatedIds: [],
      status: "reported",
      branchId: "branch-main",
      sharedAcrossBranches: false,
      expectedVersion: INITIAL_VERSION,
      requestId: "request-claim-provenance-0001",
    })) as { ok: boolean; code: string; message: string };
    expect(unsourcedExternalObservation).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(unsourcedExternalObservation.message).toContain("compatible canonical source ID");

    const ambiguousProposal = (await registry.simulateTool("propose_scene_changes", {
      title: "Ambiguous same-actor proposal",
      rationale: "This must be rejected before the canonical adapter is called.",
      changes: [
        {
          kind: "actor-pose",
          actorId: "vehicle-b",
          proposedPose: { x: 0.4, y: 0.4, rotationDeg: 0 },
        },
        {
          kind: "actor-pose",
          actorId: "vehicle-b",
          proposedPose: { x: 0.5, y: 0.5, rotationDeg: 5 },
        },
      ],
      expectedPoseTarget: { branchId: "branch-main", playheadTimeMs: 0 },
      expectedVersion: INITIAL_VERSION,
      requestId: "request-proposal-0001",
    })) as { ok: boolean; code: string };
    expect(ambiguousProposal).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    const emptyKeyframePatch = (await registry.simulateTool("propose_scene_changes", {
      title: "Incomplete trajectory patch",
      rationale: "This must be rejected before reaching the canonical adapter.",
      changes: [
        {
          kind: "trajectory-keyframe-patch",
          actorId: "vehicle-a",
          branchId: "branch-main",
          adjustments: [{ keyframeId: "keyframe-a-2" }],
        },
        {
          kind: "trajectory-keyframe-patch",
          actorId: "vehicle-b",
          branchId: "branch-main",
          adjustments: [{ keyframeId: "keyframe-b-2", x: 0.45 }],
        },
      ],
      expectedVersion: INITIAL_VERSION,
      requestId: "request-empty-keyframe-patch-0001",
    })) as { ok: boolean; code: string; message: string };
    expect(emptyKeyframePatch).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(emptyKeyframePatch.message).toContain("at least one of x, y, or rotationDeg");

    const duplicateKeyframePatch = (await registry.simulateTool("propose_scene_changes", {
      title: "Duplicate trajectory patch",
      rationale: "This must be rejected before reaching the canonical adapter.",
      changes: [
        {
          kind: "trajectory-keyframe-patch",
          actorId: "vehicle-a",
          branchId: "branch-main",
          adjustments: [
            { keyframeId: "keyframe-a-2", x: 0.45 },
            { keyframeId: "keyframe-a-2", y: 0.55 },
          ],
        },
        {
          kind: "trajectory-keyframe-patch",
          actorId: "vehicle-b",
          branchId: "branch-main",
          adjustments: [{ keyframeId: "keyframe-b-2", x: 0.45 }],
        },
      ],
      expectedVersion: INITIAL_VERSION,
      requestId: "request-duplicate-keyframe-patch-0001",
    })) as { ok: boolean; code: string; message: string };
    expect(duplicateKeyframePatch).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(duplicateKeyframePatch.message).toContain("must be unique");

    const unsourcedDamage = (await registry.simulateTool("mark_vehicle_damage", {
      actorId: "vehicle-a",
      damageRegion: "front",
      description: "A provisional mark without a cited source.",
      sourceIds: [],
      status: "uncertain",
      expectedVersion: INITIAL_VERSION,
      requestId: "request-unsourced-damage-0001",
    })) as { ok: boolean; code: string; message: string };
    expect(unsourcedDamage).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(unsourcedDamage.message).toContain("At least one source ID");

    const ignoredConfidence = (await registry.simulateTool("mark_impact_event", {
      branchId: "branch-main",
      timeMs: 5_000,
      location: { x: 0.5, y: 0.5 },
      actorIds: ["vehicle-a", "vehicle-b"],
      status: "uncertain",
      confidence: 0.75,
      expectedVersion: INITIAL_VERSION,
      requestId: "request-impact-0001",
    })) as { ok: boolean; code: string };
    expect(ignoredConfidence).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    const invalidWorkspaceMode = (await registry.simulateTool("focus_workspace_item", {
      itemType: "actor",
      itemId: "vehicle-a",
      workspaceMode: "overview",
    })) as { ok: boolean; code: string };
    expect(invalidWorkspaceMode).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    const invalidActorBranchContext = (await registry.simulateTool("focus_workspace_item", {
      itemType: "actor",
      itemId: "vehicle-a",
      branchId: "branch-main",
    })) as { ok: boolean; code: string; message: string };
    expect(invalidActorBranchContext).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(invalidActorBranchContext.message).toContain(
      "branchId is accepted only when focusing a trajectory or timeline event",
    );

    const duplicateImpactActors = (await registry.simulateTool("mark_impact_event", {
      branchId: "branch-main",
      timeMs: 5_000,
      location: { x: 0.5, y: 0.5 },
      actorIds: ["vehicle-a", "vehicle-a"],
      status: "uncertain",
      expectedVersion: INITIAL_VERSION,
      requestId: "request-impact-0002",
    })) as { ok: boolean; code: string; message: string };
    expect(duplicateImpactActors).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(duplicateImpactActors.message).toContain("distinct");

    const unsupportedImpactStatus = (await registry.simulateTool("mark_impact_event", {
      branchId: "branch-main",
      timeMs: 5_000,
      location: { x: 0.5, y: 0.5 },
      actorIds: ["vehicle-a", "vehicle-b"],
      status: "likely",
      expectedVersion: INITIAL_VERSION,
      requestId: "request-impact-0003",
    })) as { ok: boolean; code: string };
    expect(unsupportedImpactStatus).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    const addWithAssumptionId = (await registry.simulateTool("update_hypothesis_assumption", {
      branchId: "branch-main",
      operation: "add",
      assumptionId: "assumption-existing",
      assumption: {
        statement: "An added assumption must not name an existing assumption.",
        relatedIds: [],
      },
      expectedVersion: INITIAL_VERSION,
      requestId: "request-assumption-add-extra-id",
    })) as { ok: boolean; code: string; message: string };
    expect(addWithAssumptionId).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(addWithAssumptionId.message).toContain("Add does not accept assumptionId");

    const removeWithAssumption = (await registry.simulateTool("update_hypothesis_assumption", {
      branchId: "branch-main",
      operation: "remove",
      assumptionId: "assumption-existing",
      assumption: {
        statement: "A removed assumption must not accept replacement content.",
        relatedIds: [],
      },
      expectedVersion: INITIAL_VERSION,
      requestId: "request-assumption-remove-extra-body",
    })) as { ok: boolean; code: string; message: string };
    expect(removeWithAssumption).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(removeWithAssumption.message).toContain("Remove does not accept assumption");

    const ignoredComparisonMode = (await registry.simulateTool("compare_hypotheses", {
      branchIds: ["branch-main", "branch-alternative"],
      comparisonMode: "summary",
    })) as { ok: boolean; code: string };
    expect(ignoredComparisonMode).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    const ignoredPreviewRequest = (await registry.simulateTool("build_report_preview", {
      expectedVersion: INITIAL_VERSION,
      requestId: "request-preview-0001",
    })) as { ok: boolean; code: string };
    expect(ignoredPreviewRequest).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(adapter.executeCalls).toEqual([]);
  });

  it("accepts bounded keyed trajectory patches and applies schema defaults", async () => {
    const adapter = new TestAdapter();
    allContexts(adapter);
    const modelContext = new ModelContextPolyfill();
    const registry = new ReplayWebMCPRegistry(adapter, { modelContext });
    await registry.start();

    const result = (await registry.simulateTool("propose_scene_changes", {
      title: "Review two interior positions",
      rationale: "Keep both endpoints fixed while a human reviews an alternative lane path.",
      changes: [
        {
          kind: "trajectory-keyframe-patch",
          actorId: "vehicle-a",
          branchId: "branch-main",
          adjustments: [{ keyframeId: "keyframe-a-2", x: 0.45, y: 0.52 }],
        },
        {
          kind: "trajectory-keyframe-patch",
          actorId: "vehicle-b",
          branchId: "branch-main",
          adjustments: [{ keyframeId: "keyframe-b-2", rotationDeg: 12 }],
        },
      ],
      expectedVersion: INITIAL_VERSION,
      requestId: "request-valid-keyframe-patch-0001",
    })) as { ok: boolean; caseVersion: number };

    expect(result).toMatchObject({ ok: true, caseVersion: INITIAL_VERSION + 1 });
    expect(adapter.executeCalls).toHaveLength(1);
    expect(adapter.executeCalls[0]).toMatchObject({
      type: "propose_scene_changes",
      payload: {
        changes: [
          {
            kind: "trajectory-keyframe-patch",
            actorId: "vehicle-a",
            visible: true,
          },
          {
            kind: "trajectory-keyframe-patch",
            actorId: "vehicle-b",
            visible: true,
          },
        ],
      },
    });
  });

  it("keeps reads non-mutating and uses executeTool for debug simulation", async () => {
    const adapter = new TestAdapter();
    const modelContext = new ModelContextPolyfill();
    const registry = new ReplayWebMCPRegistry(adapter, { modelContext });
    await registry.start();

    const result = (await registry.simulateTool("get_case_summary", {})) as {
      ok: boolean;
      caseVersion: number;
      affectedIds: string[];
      data: unknown;
    };

    expect(result).toMatchObject({ ok: true, caseVersion: INITIAL_VERSION, affectedIds: [] });
    expect(result.data).toBeDefined();
    expect(adapter.executeCalls).toEqual([]);
    expect(adapter.lifecycle.caseVersion).toBe(INITIAL_VERSION);
    expect(modelContext.executionCalls).toEqual([{ name: "get_case_summary", input: {} }]);
    expect(adapter.invocationAudits).toEqual([
      expect.objectContaining({
        toolName: "get_case_summary",
        ok: true,
        caseVersion: INITIAL_VERSION,
        affectedIds: [],
      }),
    ]);
    expect(registry.getDebugState().lastInvocation?.toolName).toBe("get_case_summary");
    expect(registry.getDebugState().lastResult).toMatchObject({ ok: true });
  });

  it("retries native pre-dispatch input parsing once with serialized JSON", async () => {
    const adapter = new TestAdapter();
    allContexts(adapter);
    const modelContext = new NativeStringInputModelContext();
    const registry = new ReplayWebMCPRegistry(adapter, { modelContext });
    await registry.start();

    const input = validActorInput();
    const result = await registry.simulateTool("upsert_scene_actor", input);

    expect(result).toMatchObject({ ok: true, caseVersion: INITIAL_VERSION + 1 });
    expect(modelContext.rawExecutionInputs).toEqual([input, JSON.stringify(input)]);
    expect(modelContext.executionCalls).toEqual([{ name: "upsert_scene_actor", input }]);
    expect(adapter.executeCalls).toHaveLength(1);
    expect(adapter.committedRequestIds).toEqual(["request-actor-0001"]);
  });

  it("does not retry executeTool failures that are not the native input parse error", async () => {
    const adapter = new TestAdapter();
    const modelContext = new ModelContextPolyfill();
    const executeTool = vi
      .spyOn(modelContext, "executeTool")
      .mockRejectedValue(new DOMException("Tool execution failed.", "UnknownError"));
    const registry = new ReplayWebMCPRegistry(adapter, { modelContext });
    await registry.start();

    await expect(registry.simulateTool("get_case_summary", {})).rejects.toMatchObject({
      name: "UnknownError",
      message: "Tool execution failed.",
    });
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it("routes mutations through one canonical command and returns a compact synchronized result", async () => {
    const adapter = new TestAdapter();
    allContexts(adapter);
    const modelContext = new ModelContextPolyfill();
    const registry = new ReplayWebMCPRegistry(adapter, { modelContext });
    await registry.start();

    const result = (await registry.simulateTool("upsert_scene_actor", validActorInput())) as Record<
      string,
      unknown
    >;

    expect(adapter.executeCalls).toHaveLength(1);
    expect(adapter.executeCalls[0]).toEqual({
      type: "upsert_scene_actor",
      payload: {
        actorId: "vehicle-b",
        label: "Vehicle B",
        position: { x: 0.58, y: 0.42 },
        rotationDeg: 18,
        dimensions: { width: 1.8, length: 4.3 },
        expectedPoseTarget: { branchId: "branch-main", playheadTimeMs: 0 },
      },
      actor: "agent",
      origin: "webmcp",
      expectedVersion: INITIAL_VERSION,
      requestId: "request-actor-0001",
    });
    expect(result).toMatchObject({
      ok: true,
      caseVersion: 8,
      activityId: "activity-8",
      affectedIds: ["vehicle-b"],
      visibleState: { workspaceMode: "scene", selectedItemId: "vehicle-b" },
    });
    expect(Object.keys(result).sort()).toEqual(
      [
        "activityId",
        "affectedIds",
        "caseVersion",
        "issues",
        "message",
        "ok",
        "visibleState",
      ].sort(),
    );
    expect(adapter.revealedIds).toEqual([["vehicle-b"]]);
    expect(adapter.workingStates.at(0)).toMatchObject({
      active: true,
      requestId: "request-actor-0001",
    });
    expect(adapter.workingStates.at(-1)).toMatchObject({ active: false });
    expect(adapter.invocationAudits).toEqual([]);
  });

  it("surfaces version conflicts and delegates request idempotency without duplicate commits", async () => {
    const adapter = new TestAdapter();
    allContexts(adapter);
    const modelContext = new ModelContextPolyfill();
    const registry = new ReplayWebMCPRegistry(adapter, { modelContext });
    await registry.start();

    const first = (await registry.simulateTool("upsert_scene_actor", validActorInput())) as {
      ok: boolean;
      caseVersion: number;
    };
    const retry = (await registry.simulateTool("upsert_scene_actor", validActorInput())) as {
      ok: boolean;
      caseVersion: number;
    };
    const stale = (await registry.simulateTool(
      "upsert_scene_actor",
      validActorInput("request-actor-0002", INITIAL_VERSION),
    )) as { ok: boolean; code: string; caseVersion: number };

    expect(first).toMatchObject({ ok: true, caseVersion: 8 });
    expect(retry).toMatchObject({ ok: true, caseVersion: 8 });
    expect(adapter.committedRequestIds).toEqual(["request-actor-0001"]);
    expect(stale).toMatchObject({ ok: false, code: "VERSION_CONFLICT", caseVersion: 8 });
  });

  it("preserves domain lock failures and exposes no imperative finalization tool", async () => {
    const adapter = new TestAdapter();
    allContexts(adapter);
    adapter.executeHook = () =>
      Promise.resolve({
        ok: false,
        code: "LOCKED",
        message: "Vehicle B is locked and cannot be changed by the agent.",
        caseVersion: INITIAL_VERSION,
        affectedIds: ["vehicle-b"],
        issues: [],
      });
    const modelContext = new ModelContextPolyfill();
    const registry = new ReplayWebMCPRegistry(adapter, { modelContext });
    await registry.start();

    const result = await registry.simulateTool("upsert_scene_actor", validActorInput());

    expect(result).toMatchObject({ ok: false, code: "LOCKED", caseVersion: INITIAL_VERSION });
    expect(adapter.committedRequestIds).toEqual([]);
    expect(adapter.invocationAudits).toEqual([
      expect.objectContaining({
        toolName: "upsert_scene_actor",
        ok: false,
        requestId: "request-actor-0001",
      }),
    ]);
    expect(modelContext.registeredNames()).not.toContain("finalize_factual_report");
  });

  it("propagates execution cancellation and leaves no partial command or activity", async () => {
    const adapter = new TestAdapter();
    allContexts(adapter);
    const modelContext = new ModelContextPolyfill();
    const registry = new ReplayWebMCPRegistry(adapter, { modelContext });
    await registry.start();

    let executionStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      executionStarted = resolve;
    });
    adapter.executeHook = (command, context) =>
      new Promise<ReplayAdapterResult>((resolve, reject) => {
        executionStarted?.();
        context.signal.addEventListener(
          "abort",
          () => reject(cancellationError(context.signal.reason)),
          { once: true },
        );
        void resolve;
        void command;
      });

    const controller = new AbortController();
    const execution = registry.simulateTool("upsert_scene_actor", validActorInput(), {
      signal: controller.signal,
    });
    await started;
    controller.abort(new DOMException("Developer cancelled simulation.", "AbortError"));

    await expect(execution).rejects.toMatchObject({ name: "AbortError" });
    expect(adapter.lifecycle.caseVersion).toBe(INITIAL_VERSION);
    expect(adapter.committedRequestIds).toEqual([]);
    expect(adapter.invocationAudits).toEqual([]);
    expect(adapter.workingStates.at(-1)).toMatchObject({ active: false });
    expect(registry.getDebugState().lastInvocation).toMatchObject({
      toolName: "upsert_scene_actor",
      cancelled: true,
    });
  });

  it("cancels in-flight work when the registration lifecycle is aborted", async () => {
    const adapter = new TestAdapter();
    allContexts(adapter);
    const modelContext = new ModelContextPolyfill();
    const registry = new ReplayWebMCPRegistry(adapter, { modelContext });
    await registry.start();

    let executionStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      executionStarted = resolve;
    });
    adapter.executeHook = (_command, context) =>
      new Promise<ReplayAdapterResult>((_resolve, reject) => {
        executionStarted?.();
        context.signal.addEventListener(
          "abort",
          () => reject(cancellationError(context.signal.reason)),
          { once: true },
        );
      });

    const execution = registry.simulateTool("upsert_scene_actor", validActorInput());
    await started;
    registry.stop();

    await expect(execution).rejects.toMatchObject({ name: "AbortError" });
    expect(adapter.lifecycle.caseVersion).toBe(INITIAL_VERSION);
    expect(adapter.committedRequestIds).toEqual([]);
    expect(modelContext.registeredNames()).toEqual([]);
  });

  it("supports an external lifecycle signal", async () => {
    const adapter = new TestAdapter();
    const modelContext = new ModelContextPolyfill();
    const controller = new AbortController();
    const registry = new ReplayWebMCPRegistry(adapter, {
      modelContext,
      signal: controller.signal,
    });
    await registry.start();
    expect(modelContext.registeredNames()).toHaveLength(BASE_TOOL_NAMES.length);

    controller.abort();
    expect(modelContext.registeredNames()).toEqual([]);
    expect(adapter.listeners.size).toBe(0);
  });

  it("does not offer debug execution for a contextual tool outside its lifecycle", async () => {
    const adapter = new TestAdapter();
    const modelContext = new ModelContextPolyfill();
    const registry = new ReplayWebMCPRegistry(adapter, { modelContext });
    await registry.start();

    await expect(
      registry.simulateTool("upsert_scene_actor", validActorInput()),
    ).resolves.toMatchObject({
      ok: false,
      code: "TOOL_NOT_REGISTERED",
    });
    expect(modelContext.executionCalls).toEqual([]);
  });

  it("notifies debug subscribers with registration and invocation state", async () => {
    const adapter = new TestAdapter();
    const modelContext = new ModelContextPolyfill();
    const registry = new ReplayWebMCPRegistry(adapter, { modelContext });
    const listener = vi.fn();
    const unsubscribe = registry.subscribeDebug(listener);

    await registry.start();
    await registry.simulateTool("get_case_summary", {});

    expect(listener).toHaveBeenCalled();
    expect(listener.mock.calls.at(-1)?.[0]).toMatchObject({
      supported: true,
      lifecycleMode: "base",
      caseVersion: INITIAL_VERSION,
      lastInvocation: { toolName: "get_case_summary" },
      lastResult: { ok: true },
    });
    unsubscribe();
  });
});
