import { describe, expect, it, vi } from "vitest";

import {
  createBlankCase,
  createDemoCase,
  createReplayEngine,
  type ActivityEvent,
} from "../../src/domain";
import { createReplayWebMCPAdapter } from "../../src/integration/replayWebMCPAdapter";
import {
  createReplayWebMCPTools,
  type ReplayAdapterResult,
  type ReplayWebMCPCommand,
  type WebMCPToolName,
} from "../../src/webmcp";

function context(toolName: WebMCPToolName, signal = new AbortController().signal) {
  return { toolName, signal } as const;
}

function actorMutation(
  requestId = "request-adapter-actor-0001",
  expectedVersion = 1,
): ReplayWebMCPCommand {
  return {
    type: "upsert_scene_actor",
    actor: "agent",
    origin: "webmcp",
    requestId,
    expectedVersion,
    payload: {
      actorId: "actor-vehicle-a",
      label: "Vehicle A updated",
      position: { x: 0.7, y: 0.52 },
      rotationDeg: 8,
      dimensions: { width: 1.8, length: 4.5 },
    },
  };
}

function newActorMutation(
  requestId: string,
  expectedVersion: number,
  label: string,
): ReplayWebMCPCommand {
  return {
    type: "upsert_scene_actor",
    actor: "agent",
    origin: "webmcp",
    requestId,
    expectedVersion,
    payload: {
      label,
      position: { x: 0.4, y: 0.45 },
      rotationDeg: 12,
      dimensions: { width: 1.9, length: 4.6 },
    },
  };
}

function requiredUiBridge(
  engine: ReturnType<typeof createReplayEngine>,
  persistCase?: (
    replayCase: ReturnType<typeof engine.getState>,
    options: Readonly<{ expectedCaseVersion: number; compensation?: true }>,
  ) => Promise<void>,
) {
  return {
    getCase: () => engine.getState(),
    hasReportPreview: () => false,
    ...(persistCase ? { persistCase } : {}),
    setReportPreview: vi.fn(),
    setAgentWorking: vi.fn(),
    revealAffected: vi.fn(),
    focusIssue: vi.fn(),
    setComparison: vi.fn(),
  };
}

describe("Replay WebMCP adapter activity", () => {
  it("filters by author before applying the requested limit", async () => {
    const replayCase = createDemoCase();
    const template = replayCase.activity[0];
    if (!template) throw new Error("The deterministic demo must include seed activity.");
    replayCase.activity = [
      {
        ...template,
        id: "activity-human-old",
        author: "human",
        createdAt: "2026-08-27T10:00:00.000Z",
      },
      {
        ...template,
        id: "activity-human-middle",
        author: "human",
        createdAt: "2026-08-27T10:01:00.000Z",
      },
      {
        ...template,
        id: "activity-agent-new",
        author: "agent",
        createdAt: "2026-08-27T10:02:00.000Z",
      },
    ];
    const engine = createReplayEngine(replayCase);
    const sessionActivity: ActivityEvent = {
      ...template,
      id: "activity-human-session",
      author: "human",
      actionType: "webmcp.get_workspace_state",
      summary: "Human-visible session audit",
      undoable: false,
      createdAt: "2026-08-27T10:03:00.000Z",
    };
    const adapter = createReplayWebMCPAdapter(engine, {
      getCase: () => engine.getState(),
      hasReportPreview: () => false,
      setReportPreview: () => undefined,
      setAgentWorking: () => undefined,
      revealAffected: () => undefined,
      focusIssue: () => undefined,
      setComparison: () => undefined,
      getVisibleActivity: () => [...engine.getState().activity, sessionActivity],
    });

    const result = (await adapter.getRecentActivity(
      { limit: 2, author: "human" },
      { signal: new AbortController().signal, toolName: "get_recent_activity" },
    )) as ActivityEvent[];

    expect(result.map((activity) => activity.id)).toEqual([
      "activity-human-session",
      "activity-human-middle",
    ]);
  });

  it("keeps live state, activity, history, receipts, and listeners staged until persistence resolves", async () => {
    const engine = createReplayEngine(createDemoCase());
    const before = engine.getState();
    let releasePersistence: (() => void) | undefined;
    let persistenceStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      persistenceStarted = resolve;
    });
    const persisted = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    const persistCase = vi.fn(async () => {
      persistenceStarted?.();
      await persisted;
    });
    const listener = vi.fn();
    engine.subscribe(listener);
    const adapter = createReplayWebMCPAdapter(engine, requiredUiBridge(engine, persistCase));

    const execution = adapter.execute(actorMutation(), context("upsert_scene_actor")) as Promise<
      Awaited<ReturnType<typeof adapter.execute>>
    >;
    await started;

    expect(engine.getState()).toEqual(before);
    expect(engine.canUndo).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(persistCase).toHaveBeenCalledWith(expect.objectContaining({ caseVersion: 2 }), {
      expectedCaseVersion: 1,
    });

    releasePersistence?.();
    const result = await execution;

    expect(result).toMatchObject({ ok: true, caseVersion: 2 });
    expect(engine.getState().caseVersion).toBe(2);
    expect(engine.canUndo).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("leaves staged state untouched and does not compensate a rejected primary save", async () => {
    const engine = createReplayEngine(createDemoCase());
    const before = engine.getState();
    const persistCase = vi
      .fn<
        (
          replayCase: ReturnType<typeof engine.getState>,
          options: Readonly<{ expectedCaseVersion: number; compensation?: true }>,
        ) => Promise<void>
      >()
      .mockRejectedValueOnce(new Error("IndexedDB quota exceeded"))
      .mockResolvedValue(undefined);
    const listener = vi.fn();
    engine.subscribe(listener);
    const adapter = createReplayWebMCPAdapter(engine, requiredUiBridge(engine, persistCase));

    const failed = await adapter.execute(actorMutation(), context("upsert_scene_actor"));

    expect(failed).toMatchObject({ ok: false, code: "PERSISTENCE_FAILED", caseVersion: 1 });
    expect(engine.getState()).toEqual(before);
    expect(engine.canUndo).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(persistCase).toHaveBeenCalledTimes(1);

    const retry = await adapter.execute(actorMutation(), context("upsert_scene_actor"));
    expect(retry).toMatchObject({ ok: true, caseVersion: 2 });
    expect(
      engine.getState().activity.filter((item) => item.requestId === actorMutation().requestId),
    ).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite a newer durable writer after the primary CAS rejects", async () => {
    const engine = createReplayEngine(createDemoCase());
    const before = engine.getState();
    const durable = structuredClone(before);
    durable.caseVersion = 2;
    const durableActor = durable.actors[0];
    if (!durableActor) throw new Error("Demo actor is missing");
    durable.actors[0] = { ...durableActor, label: "Newer writer's vehicle" };
    const persistCase = vi.fn(
      (
        state: ReturnType<typeof engine.getState>,
        options: Readonly<{ expectedCaseVersion: number; compensation?: true }>,
      ): Promise<void> => {
        if (durable.caseVersion !== options.expectedCaseVersion) {
          return Promise.reject(new Error(`LOCAL_VAULT_CONFLICT:${String(durable.caseVersion)}`));
        }
        Object.assign(durable, structuredClone(state));
        return Promise.resolve();
      },
    );
    const adapter = createReplayWebMCPAdapter(engine, requiredUiBridge(engine, persistCase));

    const failed = await adapter.execute(actorMutation(), context("upsert_scene_actor"));

    expect(failed).toMatchObject({ ok: false, code: "PERSISTENCE_FAILED", caseVersion: 1 });
    expect(engine.getState()).toEqual(before);
    expect(durable.caseVersion).toBe(2);
    expect(durable.actors[0].label).toBe("Newer writer's vehicle");
    expect(persistCase).toHaveBeenCalledTimes(1);
    expect(persistCase).toHaveBeenCalledWith(expect.objectContaining({ caseVersion: 2 }), {
      expectedCaseVersion: 1,
    });
  });

  it("uses the compensation path even when ordinary saves become paused after an abort", async () => {
    const engine = createReplayEngine(createDemoCase());
    const before = engine.getState();
    const controller = new AbortController();
    const persistedStates: ReturnType<typeof engine.getState>[] = [];
    const persistenceOptions: Array<
      Readonly<{ expectedCaseVersion: number; compensation?: true }>
    > = [];
    let paused = false;
    const persistCase = vi.fn((state, options) => {
      if (paused && options.compensation !== true) {
        return Promise.reject(new Error("Ordinary persistence is paused"));
      }
      persistedStates.push(structuredClone(state));
      persistenceOptions.push(options);
      if (persistedStates.length === 1) {
        paused = true;
        controller.abort(new DOMException("Cancelled after save", "AbortError"));
      }
      return Promise.resolve();
    });
    const listener = vi.fn();
    engine.subscribe(listener);
    const adapter = createReplayWebMCPAdapter(engine, requiredUiBridge(engine, persistCase));

    await expect(
      adapter.execute(actorMutation(), context("upsert_scene_actor", controller.signal)),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(engine.getState()).toEqual(before);
    expect(engine.canUndo).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(persistedStates.map((state) => state.caseVersion)).toEqual([2, 1]);
    expect(persistenceOptions).toEqual([
      { expectedCaseVersion: 1 },
      { expectedCaseVersion: 2, compensation: true },
    ]);
  });

  it("keeps an abort during persistence staged until the save settles, then compensates it", async () => {
    const engine = createReplayEngine(createDemoCase());
    const before = engine.getState();
    const controller = new AbortController();
    let releasePersistence: (() => void) | undefined;
    let persistenceStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      persistenceStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    const persistedVersions: number[] = [];
    const persistCase = vi.fn(async (state: ReturnType<typeof engine.getState>) => {
      persistedVersions.push(state.caseVersion);
      if (persistedVersions.length === 1) {
        persistenceStarted?.();
        await gate;
      }
    });
    const listener = vi.fn();
    engine.subscribe(listener);
    const adapter = createReplayWebMCPAdapter(engine, requiredUiBridge(engine, persistCase));

    let settled = false;
    const pending = adapter.execute(
      actorMutation(),
      context("upsert_scene_actor", controller.signal),
    ) as Promise<ReplayAdapterResult>;
    const execution = pending.finally(() => {
      settled = true;
    });
    await started;
    controller.abort(new DOMException("Cancelled while saving", "AbortError"));
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(engine.getState()).toEqual(before);
    expect(listener).not.toHaveBeenCalled();

    releasePersistence?.();
    await expect(execution).rejects.toMatchObject({ name: "AbortError" });
    expect(engine.getState()).toEqual(before);
    expect(engine.canUndo).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(persistedVersions).toEqual([2, 1]);
    expect(persistCase).toHaveBeenNthCalledWith(2, before, {
      expectedCaseVersion: 2,
      compensation: true,
    });
  });

  it("surfaces and audits rollback failure even when the invocation was aborted", async () => {
    const engine = createReplayEngine(createDemoCase());
    const before = engine.getState();
    const controller = new AbortController();
    const recordToolInvocation = vi.fn();
    let persistenceCount = 0;
    const persistCase = vi.fn(
      (
        _state: ReturnType<typeof engine.getState>,
        options: Readonly<{ expectedCaseVersion: number; compensation?: true }>,
      ): Promise<void> => {
        persistenceCount += 1;
        if (persistenceCount === 1) {
          controller.abort(new DOMException("Cancelled after durable save", "AbortError"));
          return Promise.resolve();
        }
        expect(options).toEqual({ expectedCaseVersion: 2, compensation: true });
        return Promise.reject(new Error("Compensating save was rejected"));
      },
    );
    const adapter = createReplayWebMCPAdapter(engine, {
      ...requiredUiBridge(engine, persistCase),
      recordToolInvocation,
    });
    const tool = createReplayWebMCPTools(adapter).find(
      (candidate) => candidate.name === "upsert_scene_actor",
    );
    if (!tool) throw new Error("Missing actor tool");
    const mutation = actorMutation();

    const result = await tool.execute(
      {
        ...mutation.payload,
        requestId: mutation.requestId,
        expectedVersion: mutation.expectedVersion,
      },
      { signal: controller.signal },
    );

    expect(result).toMatchObject({
      ok: false,
      code: "PERSISTENCE_FAILED",
      caseVersion: 1,
    });
    expect(result.message).toContain("durable rollback could not be confirmed");
    expect(engine.getState()).toEqual(before);
    expect(persistCase).toHaveBeenCalledTimes(2);
    expect(recordToolInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "upsert_scene_actor",
        ok: false,
        caseVersion: 1,
        requestId: mutation.requestId,
      }),
    );
  });

  it("awaits revert persistence and returns the original revert success on request retry", async () => {
    const engine = createReplayEngine(createDemoCase());
    let releaseRevert: (() => void) | undefined;
    let revertSaveStarted: (() => void) | undefined;
    const revertStarted = new Promise<void>((resolve) => {
      revertSaveStarted = resolve;
    });
    const revertGate = new Promise<void>((resolve) => {
      releaseRevert = resolve;
    });
    let persistenceCount = 0;
    const persistCase = vi.fn(async () => {
      persistenceCount += 1;
      if (persistenceCount === 2) {
        revertSaveStarted?.();
        await revertGate;
      }
    });
    const adapter = createReplayWebMCPAdapter(engine, requiredUiBridge(engine, persistCase));
    const mutation = await adapter.execute(actorMutation(), context("upsert_scene_actor"));
    expect(mutation.ok).toBe(true);
    if (!mutation.activityId) throw new Error("Expected mutation activity");

    const input = {
      activityId: mutation.activityId,
      expectedVersion: 2,
      requestId: "request-adapter-revert-0001",
    };
    const reverting = adapter.revertAgentAction(input, context("revert_agent_action")) as Promise<
      Awaited<ReturnType<typeof adapter.revertAgentAction>>
    >;
    await revertStarted;

    expect(engine.getState().caseVersion).toBe(2);
    expect(engine.getState().actors.find((actor) => actor.id === "actor-vehicle-a")?.label).toBe(
      "Vehicle A updated",
    );

    releaseRevert?.();
    const first = await reverting;
    const retry = await adapter.revertAgentAction(input, context("revert_agent_action"));

    expect(first).toMatchObject({ ok: true, caseVersion: 3 });
    expect(retry).toMatchObject({
      ok: true,
      caseVersion: 3,
      idempotent: true,
      activityId: first.activityId,
      message: first.message,
    });
    expect(engine.getState().actors.find((actor) => actor.id === "actor-vehicle-a")?.label).toBe(
      "Vehicle A",
    );
    expect(
      engine.getState().activity.filter((item) => item.requestId === input.requestId),
    ).toHaveLength(1);
    expect(persistCase).toHaveBeenCalledTimes(2);

    const secondMutation = await adapter.execute(
      actorMutation("request-adapter-actor-0002", 3),
      context("upsert_scene_actor"),
    );
    if (!secondMutation.activityId) throw new Error("Expected second mutation activity");
    const mismatchedTarget = await adapter.revertAgentAction(
      {
        activityId: secondMutation.activityId,
        expectedVersion: 4,
        requestId: input.requestId,
      },
      context("revert_agent_action"),
    );
    expect(mismatchedTarget).toMatchObject({
      ok: false,
      code: "IDEMPOTENCY_CONFLICT",
      caseVersion: 4,
    });
    expect(persistCase).toHaveBeenCalledTimes(3);
  });

  it("returns a completed receipt even while new mutations are paused", async () => {
    const engine = createReplayEngine(createDemoCase());
    const persistCase = vi.fn(() => Promise.resolve());
    const persistenceGate: { blockedReason?: string } = {};
    const adapter = createReplayWebMCPAdapter(engine, {
      ...requiredUiBridge(engine, persistCase),
      getMutationBlockReason: () => persistenceGate.blockedReason,
    });
    const command = actorMutation("request-retry-while-paused", 1);

    const first = await adapter.execute(command, context("upsert_scene_actor"));
    persistenceGate.blockedReason = "Ordinary persistence is paused.";
    const retry = await adapter.execute(command, context("upsert_scene_actor"));
    const mismatched = await adapter.execute(
      {
        ...command,
        payload: { ...command.payload, label: "Different intent" },
      },
      context("upsert_scene_actor"),
    );

    expect(retry).toMatchObject({
      ok: true,
      caseVersion: 2,
      activityId: first.activityId,
      message: first.message,
      idempotent: true,
    });
    expect(mismatched).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
    expect(persistCase).toHaveBeenCalledTimes(1);
    expect(engine.getState().caseVersion).toBe(2);
  });

  it("binds a new trajectory retry to the validated WebMCP intent and exposes the replay", async () => {
    const replayCase = createBlankCase(
      {
        title: "Trajectory idempotency test",
        sceneType: "roundabout",
        roadCondition: "unknown",
        vehicleCount: 2,
      },
      { caseId: "case-trajectory-idempotency", now: "2026-08-27T10:00:00.000Z" },
    );
    const engine = createReplayEngine(replayCase);
    const persistCase = vi.fn(() => Promise.resolve());
    const adapter = createReplayWebMCPAdapter(engine, requiredUiBridge(engine, persistCase));
    const tool = createReplayWebMCPTools(adapter).find(
      (candidate) => candidate.name === "set_actor_trajectory",
    );
    if (!tool) throw new Error("Missing trajectory tool");
    const input = {
      actorId: "actor-vehicle-a",
      branchId: "branch-baseline",
      keyframes: [
        { timeMs: 0, x: 0.2, y: 0.3, rotationDeg: 4 },
        { timeMs: 1_000, x: 0.4, y: 0.5, rotationDeg: 8 },
      ],
      expectedVersion: 1,
      requestId: "request-new-trajectory-0001",
    };

    const first = await tool.execute(input, { signal: new AbortController().signal });
    const retry = await tool.execute(input, { signal: new AbortController().signal });

    expect(first).not.toHaveProperty("idempotent");
    expect(retry).toEqual({ ...first, idempotent: true });
    expect(engine.getState().trajectories).toHaveLength(1);
    expect(persistCase).toHaveBeenCalledTimes(1);
  });

  it("replays an actor request after inherited actor state changes without overwriting it", async () => {
    const engine = createReplayEngine(createDemoCase());
    const persistCase = vi.fn(() => Promise.resolve());
    const adapter = createReplayWebMCPAdapter(engine, requiredUiBridge(engine, persistCase));
    const command = actorMutation("request-inherited-actor-state", 1);

    const first = await adapter.execute(command, context("upsert_scene_actor"));
    expect(first).toMatchObject({ ok: true, caseVersion: 2 });
    expect(
      engine.execute({
        type: "damage.mark",
        actor: "human",
        origin: "ui",
        actorId: "actor-vehicle-a",
        region: "rear",
        description: "Human-recorded damage after the agent request",
        status: "reported",
        linkedClaimIds: [],
        linkedEvidenceIds: [],
      }),
    ).toMatchObject({ ok: true, caseVersion: 3 });
    const beforeRetry = engine.getState();

    const retry = await adapter.execute(command, context("upsert_scene_actor"));

    expect(retry).toMatchObject({
      ok: true,
      caseVersion: 2,
      activityId: first.activityId,
      message: first.message,
      idempotent: true,
    });
    expect(engine.getState()).toEqual(beforeRetry);
    expect(persistCase).toHaveBeenCalledTimes(1);
  });

  it("creates a new actor when an omitted actor ID resembles a seeded actor", async () => {
    const engine = createReplayEngine(createDemoCase());
    const persistCase = vi.fn(() => Promise.resolve());
    const adapter = createReplayWebMCPAdapter(engine, requiredUiBridge(engine, persistCase));
    const command = newActorMutation("vehicle-a", 1, "New witness vehicle");

    const first = await adapter.execute(command, context("upsert_scene_actor"));
    const retry = await adapter.execute(command, context("upsert_scene_actor"));

    expect(first).toMatchObject({ ok: true, caseVersion: 2 });
    expect(first.affectedIds).not.toContain("actor-vehicle-a");
    expect(retry).toMatchObject({
      ok: true,
      caseVersion: 2,
      activityId: first.activityId,
      affectedIds: first.affectedIds,
      idempotent: true,
    });
    expect(engine.getState().actors).toHaveLength(3);
    expect(engine.getState().actors.find((actor) => actor.id === "actor-vehicle-a")?.label).toBe(
      "Vehicle A",
    );
    expect(persistCase).toHaveBeenCalledTimes(1);
  });

  it("does not collide omitted actor IDs for long request IDs with the same prefix", async () => {
    const engine = createReplayEngine(createDemoCase());
    const persistCase = vi.fn(() => Promise.resolve());
    const adapter = createReplayWebMCPAdapter(engine, requiredUiBridge(engine, persistCase));
    const commonPrefix = "x".repeat(122);

    const first = await adapter.execute(
      newActorMutation(`${commonPrefix}aaaaaa`, 1, "Long request actor A"),
      context("upsert_scene_actor"),
    );
    const second = await adapter.execute(
      newActorMutation(`${commonPrefix}bbbbbb`, 2, "Long request actor B"),
      context("upsert_scene_actor"),
    );

    expect(first).toMatchObject({ ok: true, caseVersion: 2 });
    expect(second).toMatchObject({ ok: true, caseVersion: 3 });
    expect(first.affectedIds).toHaveLength(1);
    expect(second.affectedIds).toHaveLength(1);
    expect(first.affectedIds?.[0]).not.toBe(second.affectedIds?.[0]);
    expect(engine.getState().actors.map((actor) => actor.label)).toEqual(
      expect.arrayContaining(["Vehicle A", "Long request actor A", "Long request actor B"]),
    );
    expect(engine.getState().actors).toHaveLength(4);
    expect(persistCase).toHaveBeenCalledTimes(2);
  });

  it("rejects unknown damage sources instead of silently dropping them", async () => {
    const engine = createReplayEngine(createDemoCase());
    const before = engine.getState();
    const persistCase = vi.fn(() => Promise.resolve());
    const adapter = createReplayWebMCPAdapter(engine, requiredUiBridge(engine, persistCase));

    const result = await adapter.execute(
      {
        type: "mark_vehicle_damage",
        actor: "agent",
        origin: "webmcp",
        requestId: "request-damage-source-0001",
        expectedVersion: 1,
        payload: {
          actorId: "actor-vehicle-a",
          damageRegion: "front",
          description: "A new provisional scrape",
          sourceIds: ["evidence-does-not-exist"],
          status: "uncertain",
        },
      },
      context("mark_vehicle_damage"),
    );

    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND", caseVersion: 1 });
    expect(result.message).toContain("evidence-does-not-exist");
    expect(engine.getState()).toEqual(before);
    expect(persistCase).not.toHaveBeenCalled();
  });

  it("rejects unsupported question targets and unknown hypothesis evidence", async () => {
    const engine = createReplayEngine(createDemoCase());
    const before = engine.getState();
    const persistCase = vi.fn(() => Promise.resolve());
    const adapter = createReplayWebMCPAdapter(engine, requiredUiBridge(engine, persistCase));

    const question = await adapter.execute(
      {
        type: "create_open_question",
        actor: "agent",
        origin: "webmcp",
        requestId: "request-question-unsupported-related",
        expectedVersion: 1,
        payload: {
          question: "Could this evidence clarify the lane position?",
          reason: "The current reconstruction leaves the lane position unresolved.",
          importance: "high",
          relatedIds: ["evidence-overview"],
        },
      },
      context("create_open_question"),
    );
    const fork = await adapter.execute(
      {
        type: "fork_hypothesis",
        actor: "agent",
        origin: "webmcp",
        requestId: "request-fork-unknown-related",
        expectedVersion: 1,
        payload: {
          sourceBranchId: "branch-baseline",
          name: "Alternative lane path",
          description: "A neutral alternative path for human review.",
          assumptions: [
            {
              statement: "A different lane path may have been used.",
              relatedIds: ["evidence-does-not-exist"],
            },
          ],
        },
      },
      context("fork_hypothesis"),
    );

    expect(question).toMatchObject({ ok: false, code: "NOT_FOUND", caseVersion: 1 });
    expect(question.message).toContain("evidence-overview");
    expect(fork).toMatchObject({ ok: false, code: "NOT_FOUND", caseVersion: 1 });
    expect(fork.message).toContain("evidence-does-not-exist");
    expect(engine.getState()).toEqual(before);
    expect(persistCase).not.toHaveBeenCalled();
  });

  it("returns structured branch contract errors for validation, comparison, and report preview", async () => {
    const engine = createReplayEngine(createDemoCase());
    const adapter = createReplayWebMCPAdapter(engine, requiredUiBridge(engine));
    const tools = createReplayWebMCPTools(adapter);
    const execute = async (name: WebMCPToolName, input: unknown) => {
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`Missing tool ${name}`);
      return tool.execute(input, { signal: new AbortController().signal });
    };

    await expect(
      execute("validate_case_consistency", {
        branchId: "branch-does-not-exist",
        scope: "all",
      }),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    await expect(
      execute("compare_hypotheses", {
        branchIds: ["branch-baseline", "branch-does-not-exist"],
      }),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    await expect(
      execute("build_report_preview", {
        branchId: "branch-does-not-exist",
        expectedVersion: 1,
      }),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});
