import { describe, expect, it, vi } from "vitest";

import {
  buildReportPreview,
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
  WEBMCP_READ_OUTPUT_LIMIT_BYTES,
  WEBMCP_SCENE_COORDINATE_LIMIT,
  type WebMCPToolName,
  WORKSPACE_SECTIONS,
} from "../../src/webmcp";

const CURRENT_DEMO_COMPACT_WORKSPACE_TARGET_BYTES = 32 * 1024;

function context(toolName: WebMCPToolName, signal = new AbortController().signal) {
  return { toolName, signal } as const;
}

function collectSpatialCoordinates(value: unknown): number[] {
  if (Array.isArray(value)) return value.flatMap((item) => collectSpatialCoordinates(item));
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => {
    if ((key === "x" || key === "y") && typeof item === "number") return [item];
    return collectSpatialCoordinates(item);
  });
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
      dimensions: { width: 1.82, length: 4.31 },
      expectedPoseTarget: { branchId: "branch-baseline", playheadTimeMs: 20_000 },
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
    getVisibleWorkspace: () => ({
      workspaceMode: engine.getState().workspaceMode,
      ...(engine.getState().selectedItem ? { selectedItem: engine.getState().selectedItem } : {}),
    }),
    getPlayheadTimeMs: () => engine.getState().timeRangeMs.end,
    getReportPreview: () => undefined,
    ...(persistCase ? { persistCase } : {}),
    setReportPreview: vi.fn(),
    setAgentWorking: vi.fn(),
    setMutationTransactionActive: vi.fn(),
    revealAffected: vi.fn(),
    focusWorkspaceItem: vi.fn(),
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
      getVisibleWorkspace: () => ({
        workspaceMode: engine.getState().workspaceMode,
        ...(engine.getState().selectedItem ? { selectedItem: engine.getState().selectedItem } : {}),
      }),
      getReportPreview: () => undefined,
      setReportPreview: () => undefined,
      setAgentWorking: () => undefined,
      revealAffected: () => undefined,
      focusWorkspaceItem: () => undefined,
      focusIssue: () => undefined,
      setComparison: () => undefined,
      getVisibleActivity: () => [...engine.getState().activity, sessionActivity],
    });

    const result = (await adapter.getRecentActivity(
      { limit: 2, author: "human" },
      { signal: new AbortController().signal, toolName: "get_recent_activity" },
    )) as (ActivityEvent & { revertEligible: boolean })[];

    expect(result.map((activity) => activity.id)).toEqual([
      "activity-human-session",
      "activity-human-middle",
    ]);
    expect(result.every((activity) => !activity.revertEligible)).toBe(true);
  });

  it("returns live revert eligibility and accepts the canonical activity id it exposes", async () => {
    const engine = createReplayEngine(createDemoCase());
    const adapter = createReplayWebMCPAdapter(engine, requiredUiBridge(engine));
    const mutation = await adapter.execute(actorMutation(), context("upsert_scene_actor"));
    if (!mutation.activityId) throw new Error("Expected mutation activity");
    const tools = createReplayWebMCPTools(adapter);
    const recentActivityTool = tools.find((tool) => tool.name === "get_recent_activity");
    const revertTool = tools.find((tool) => tool.name === "revert_agent_action");
    if (!recentActivityTool || !revertTool) throw new Error("Expected activity tools");

    const recentResult = (await recentActivityTool.execute(
      { limit: 20, author: "agent" },
      { signal: new AbortController().signal },
    )) as { data?: (ActivityEvent & { revertEligible: boolean })[] };
    const recent = recentResult.data ?? [];
    const activity = recent.find((item) => item.id === mutation.activityId);

    expect(activity).toMatchObject({
      id: mutation.activityId,
      requestId: "request-adapter-actor-0001",
      undoable: true,
      revertEligible: true,
    });
    if (!activity) throw new Error("Expected eligible recent activity");

    await expect(
      revertTool.execute(
        {
          activityId: activity.id,
          expectedVersion: mutation.caseVersion,
          requestId: "request-adapter-revert-activity-id",
        },
        { signal: new AbortController().signal },
      ),
    ).resolves.toMatchObject({ ok: true, caseVersion: mutation.caseVersion + 1 });
  });

  it("does not infer revert eligibility from persisted undoable metadata", async () => {
    const liveEngine = createReplayEngine(createDemoCase());
    const liveAdapter = createReplayWebMCPAdapter(liveEngine, requiredUiBridge(liveEngine));
    const mutation = await liveAdapter.execute(actorMutation(), context("upsert_scene_actor"));
    if (!mutation.ok || !mutation.activityId) throw new Error("Expected mutation to succeed");
    const rehydratedEngine = createReplayEngine(liveEngine.getState());
    const adapter = createReplayWebMCPAdapter(rehydratedEngine, requiredUiBridge(rehydratedEngine));

    const recent = (await adapter.getRecentActivity(
      { limit: 20, author: "agent" },
      context("get_recent_activity"),
    )) as (ActivityEvent & { revertEligible: boolean })[];

    expect(recent.find((item) => item.id === mutation.activityId)).toMatchObject({
      id: mutation.activityId,
      undoable: true,
      revertEligible: false,
    });
  });

  it("keeps workspace focus session-scoped and audits it without a durable version bump", async () => {
    const engine = createReplayEngine(createDemoCase());
    const before = engine.getState();
    const persistCase = vi.fn(() => Promise.resolve());
    const recordToolInvocation = vi.fn();
    const focusWorkspaceItem = vi.fn();
    let visibleWorkspace: {
      workspaceMode: "facts" | "scene";
      selectedItem?: { type: "actor"; id: string };
    } = { workspaceMode: "facts" };
    focusWorkspaceItem.mockImplementation((_: string, itemId: string) => {
      visibleWorkspace = {
        workspaceMode: "scene",
        selectedItem: { type: "actor", id: itemId },
      };
    });
    const adapter = createReplayWebMCPAdapter(engine, {
      ...requiredUiBridge(engine, persistCase),
      getVisibleWorkspace: () => visibleWorkspace,
      focusWorkspaceItem,
      recordToolInvocation,
    });
    const tool = createReplayWebMCPTools(adapter).find(
      (candidate) => candidate.name === "focus_workspace_item",
    );
    if (!tool) throw new Error("Missing focus tool");

    const result = await tool.execute(
      { itemType: "actor", itemId: "actor-vehicle-a" },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      ok: true,
      caseVersion: before.caseVersion,
      affectedIds: ["actor-vehicle-a"],
      visibleState: { workspaceMode: "scene", selectedItemId: "actor-vehicle-a" },
    });
    expect(result).not.toHaveProperty("activityId");
    expect(engine.getState()).toEqual(before);
    expect(persistCase).not.toHaveBeenCalled();
    expect(focusWorkspaceItem).toHaveBeenCalledOnce();
    expect(recordToolInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "focus_workspace_item",
        ok: true,
        caseVersion: before.caseVersion,
        affectedIds: ["actor-vehicle-a"],
      }),
    );
  });

  it("focuses inactive-branch events and trajectories only with explicit branch context", async () => {
    const engine = createReplayEngine(createDemoCase());
    expect(
      engine.execute({
        type: "hypothesis.fork",
        actor: "human",
        origin: "ui",
        expectedVersion: 1,
        branchId: "branch-focus-alternative",
        parentBranchId: "branch-baseline",
        name: "Alternative focus branch",
        description: "Neutral branch used to verify branch-specific workspace visibility.",
      }),
    ).toMatchObject({ ok: true, caseVersion: 2 });
    const bridge = requiredUiBridge(engine);
    const adapter = createReplayWebMCPAdapter(engine, bridge);

    expect(
      await adapter.focusWorkspaceItem(
        { itemType: "trajectory", itemId: "trajectory-a-baseline" },
        context("focus_workspace_item"),
      ),
    ).toMatchObject({ ok: false, code: "NOT_FOUND", caseVersion: 2 });
    expect(
      await adapter.focusWorkspaceItem(
        { itemType: "event", itemId: "event-impact" },
        context("focus_workspace_item"),
      ),
    ).toMatchObject({ ok: false, code: "NOT_FOUND", caseVersion: 2 });
    expect(bridge.focusWorkspaceItem).not.toHaveBeenCalled();

    expect(
      await adapter.focusWorkspaceItem(
        {
          itemType: "trajectory",
          itemId: "trajectory-a-baseline",
          branchId: "branch-baseline",
        },
        context("focus_workspace_item"),
      ),
    ).toMatchObject({
      ok: true,
      affectedIds: ["trajectory-a-baseline"],
      caseVersion: 2,
      data: {
        inspectedBranchId: "branch-baseline",
        activeBranchId: "branch-focus-alternative",
        activeBranchUnchanged: true,
      },
    });
    expect(
      await adapter.focusWorkspaceItem(
        { itemType: "event", itemId: "event-impact", branchId: "branch-baseline" },
        context("focus_workspace_item"),
      ),
    ).toMatchObject({
      ok: true,
      affectedIds: ["event-impact"],
      data: {
        inspectedBranchId: "branch-baseline",
        activeBranchId: "branch-focus-alternative",
        activeBranchUnchanged: true,
      },
    });
    expect(engine.getState().activeBranchId).toBe("branch-focus-alternative");
    expect(bridge.focusWorkspaceItem).toHaveBeenCalledTimes(2);

    expect(
      await adapter.focusWorkspaceItem(
        {
          itemType: "trajectory",
          itemId: "trajectory-a-baseline",
          branchId: "branch-focus-alternative",
        },
        context("focus_workspace_item"),
      ),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(
      await adapter.focusWorkspaceItem(
        {
          itemType: "trajectory",
          itemId: "trajectory-a-baseline",
          branchId: "branch-does-not-exist",
        },
        context("focus_workspace_item"),
      ),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });

    const activeBranch = engine
      .getState()
      .branches.find((branch) => branch.id === engine.getState().activeBranchId);
    const activeTrajectoryId = activeBranch?.trajectoryIds[0];
    if (!activeTrajectoryId) throw new Error("Forked branch has no active trajectory");
    expect(
      await adapter.focusWorkspaceItem(
        { itemType: "trajectory", itemId: activeTrajectoryId },
        context("focus_workspace_item"),
      ),
    ).toMatchObject({ ok: true, affectedIds: [activeTrajectoryId], caseVersion: 2 });
    expect(bridge.focusWorkspaceItem).toHaveBeenCalledTimes(3);
  });

  it("reads and compares normalized inactive-branch geometry without activating it", async () => {
    const engine = createReplayEngine(createDemoCase());
    expect(
      engine.execute({
        type: "hypothesis.fork",
        actor: "human",
        origin: "ui",
        expectedVersion: 1,
        branchId: "branch-inspection-alternative",
        parentBranchId: "branch-baseline",
        name: "Inspection alternative",
        description: "Alternative branch for branch-scoped WebMCP inspection.",
      }),
    ).toMatchObject({ ok: true, caseVersion: 2 });

    const alternativeBranch = engine
      .getState()
      .branches.find((branch) => branch.id === "branch-inspection-alternative");
    const alternativeTrajectory = engine
      .getState()
      .trajectories.find(
        (trajectory) =>
          trajectory.branchId === alternativeBranch?.id && trajectory.actorId === "actor-vehicle-a",
      );
    const changedFrame = alternativeTrajectory?.keyframes[2];
    if (!alternativeBranch || !alternativeTrajectory || !changedFrame) {
      throw new Error("The fork must clone Vehicle A's trajectory.");
    }
    expect(
      engine.execute({
        type: "trajectory.set",
        actor: "human",
        origin: "ui",
        expectedVersion: 2,
        trajectoryId: alternativeTrajectory.id,
        actorId: alternativeTrajectory.actorId,
        branchId: alternativeBranch.id,
        keyframes: alternativeTrajectory.keyframes.map((keyframe) => ({
          id: keyframe.id,
          timeMs: keyframe.timeMs,
          x: keyframe.id === changedFrame.id ? keyframe.x + 2 : keyframe.x,
          y: keyframe.y,
          rotationDeg: keyframe.rotationDeg,
        })),
        visible: alternativeTrajectory.visible,
      }),
    ).toMatchObject({ ok: true, caseVersion: 3 });

    const alternativeImpact = engine
      .getState()
      .timelineEvents.find(
        (event) => event.branchId === alternativeBranch.id && event.type === "impact",
      );
    if (!alternativeImpact?.location) throw new Error("The fork must clone the located impact.");
    expect(
      engine.execute({
        type: "timeline.upsert",
        actor: "human",
        origin: "ui",
        expectedVersion: 3,
        eventId: alternativeImpact.id,
        branchId: alternativeImpact.branchId,
        timeMs: alternativeImpact.timeMs + 250,
        eventType: alternativeImpact.type,
        title: alternativeImpact.title,
        certainty: alternativeImpact.certainty,
        linkedActorIds: [...alternativeImpact.linkedActorIds],
        location: { x: alternativeImpact.location.x + 3, y: alternativeImpact.location.y },
      }),
    ).toMatchObject({ ok: true, caseVersion: 4 });

    const bridge = requiredUiBridge(engine);
    const adapter = createReplayWebMCPAdapter(engine, bridge);
    type ProjectedTrajectory = {
      id: string;
      branchId: string;
      keyframes: Array<{
        id: string;
        timeMs: number;
        x: number;
        y: number;
        rotationDeg: number;
      }>;
    };
    type ProjectedEvent = {
      id: string;
      timeMs: number;
      location?: { x: number; y: number };
    };

    const baselineRead = (await adapter.getWorkspaceState(
      ["scene", "timeline"],
      context("get_workspace_state"),
      { branchId: "branch-baseline" },
    )) as {
      branchContext: {
        projectedBranchId: string;
        activeBranchId: string;
        activeBranchUnchanged: boolean;
      };
      scene: {
        branchId: string;
        activeBranchId: string;
        branchIsActive: boolean;
        trajectories: ProjectedTrajectory[];
      };
      timeline: {
        branchId: string;
        activeBranchId: string;
        branchIsActive: boolean;
        events: ProjectedEvent[];
      };
    };
    expect(baselineRead.branchContext).toEqual({
      projectedBranchId: "branch-baseline",
      activeBranchId: "branch-inspection-alternative",
      activeBranchUnchanged: true,
    });
    expect(baselineRead.scene).toMatchObject({
      branchId: "branch-baseline",
      activeBranchId: "branch-inspection-alternative",
      branchIsActive: false,
    });
    expect(baselineRead.timeline).toMatchObject({
      branchId: "branch-baseline",
      activeBranchId: "branch-inspection-alternative",
      branchIsActive: false,
    });
    expect(
      baselineRead.scene.trajectories.every(
        (trajectory) => trajectory.branchId === "branch-baseline",
      ),
    ).toBe(true);
    expect(baselineRead.timeline.events.some((event) => event.id === "event-impact")).toBe(true);
    expect(engine.getState().activeBranchId).toBe("branch-inspection-alternative");

    const comparison = (await adapter.compareHypotheses(
      { branchIds: ["branch-baseline", "branch-inspection-alternative"] },
      context("compare_hypotheses"),
    )) as {
      coordinateSystem: { type: string };
      activeBranchId: string;
      activeBranchUnchanged: boolean;
      pairwiseComparisons: Array<{
        geometryTimingDeltas: {
          trajectoryDeltas: {
            totalCount: number;
            returnedCount: number;
            truncated: boolean;
            items: Array<{
              actorId: string;
              branches: Record<string, ProjectedTrajectory | null>;
            }>;
          };
          eventDeltas: {
            totalCount: number;
            returnedCount: number;
            truncated: boolean;
            items: Array<{
              branches: Record<string, ProjectedEvent | null>;
            }>;
          };
        };
      }>;
    };
    const deltas = comparison.pairwiseComparisons[0]?.geometryTimingDeltas;
    const trajectoryDelta = deltas?.trajectoryDeltas.items.find(
      (item) => item.actorId === "actor-vehicle-a",
    );
    const eventDelta = deltas?.eventDeltas.items[0];
    const baselineTrajectory = trajectoryDelta?.branches["branch-baseline"];
    const projectedAlternativeTrajectory =
      trajectoryDelta?.branches["branch-inspection-alternative"];
    const baselineFrame = baselineTrajectory?.keyframes[2];
    const projectedChangedFrame = projectedAlternativeTrajectory?.keyframes.find(
      (keyframe) => keyframe.id === changedFrame.id,
    );
    const bounds = engine.getState().environment.bounds;
    const normalizeX = (x: number) => (x - bounds.minX) / (bounds.maxX - bounds.minX);
    expect(comparison).toMatchObject({
      coordinateSystem: { type: "normalized-scene" },
      activeBranchId: "branch-inspection-alternative",
      activeBranchUnchanged: true,
    });
    expect(deltas?.trajectoryDeltas).toMatchObject({
      totalCount: 1,
      returnedCount: 1,
      truncated: false,
    });
    expect(baselineFrame?.x).toBeCloseTo(normalizeX(changedFrame.x), 10);
    expect(projectedChangedFrame?.x).toBeCloseTo(normalizeX(changedFrame.x + 2), 10);
    expect(projectedChangedFrame?.timeMs).toBe(changedFrame.timeMs);
    expect(deltas?.eventDeltas).toMatchObject({
      totalCount: 1,
      returnedCount: 1,
      truncated: false,
    });
    expect(eventDelta?.branches["branch-baseline"]?.id).toBe("event-impact");
    expect(eventDelta?.branches["branch-inspection-alternative"]).toMatchObject({
      id: alternativeImpact.id,
      timeMs: alternativeImpact.timeMs + 250,
      location: { x: normalizeX(alternativeImpact.location.x + 3) },
    });
    expect(engine.getState()).toMatchObject({
      caseVersion: 4,
      activeBranchId: "branch-inspection-alternative",
    });
    expect(bridge.setComparison).not.toHaveBeenCalled();
    await adapter.revealHypothesisComparison?.(
      ["branch-baseline", "branch-inspection-alternative"],
      context("compare_hypotheses"),
    );
    expect(bridge.setComparison).toHaveBeenCalledWith([
      "branch-baseline",
      "branch-inspection-alternative",
    ]);

    const stateTool = createReplayWebMCPTools(adapter).find(
      (candidate) => candidate.name === "get_workspace_state",
    );
    if (!stateTool) throw new Error("Missing workspace-state tool.");
    await expect(
      stateTool.execute(
        { sections: ["scene"], branchId: "branch-does-not-exist" },
        { signal: new AbortController().signal },
      ),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND", caseVersion: 4 });
  });

  it("returns every compact demo workspace section below the target and hard output budgets", async () => {
    const engine = createReplayEngine(createDemoCase());
    const before = engine.getState();
    const bridge = requiredUiBridge(engine);
    const adapter = createReplayWebMCPAdapter(engine, bridge);
    const workspaceTool = createReplayWebMCPTools(adapter).find(
      (candidate) => candidate.name === "get_workspace_state",
    );
    if (!workspaceTool) throw new Error("Missing workspace-state tool.");

    const result = await workspaceTool.execute(
      { sections: [...WORKSPACE_SECTIONS] },
      { signal: new AbortController().signal },
    );
    const serialized = JSON.stringify(result);
    const outputBytes = new TextEncoder().encode(serialized).byteLength;
    const wireResult = JSON.parse(serialized) as typeof result;

    expect(wireResult).toMatchObject({
      ok: true,
      message: "Returned 8 requested workspace sections.",
      caseVersion: 1,
      affectedIds: [],
    });
    expect(Object.keys(wireResult.data as Record<string, unknown>).sort()).toEqual(
      ["coordinateSystem", ...WORKSPACE_SECTIONS].sort(),
    );
    expect((wireResult.data as Record<string, unknown>).selection).toBeNull();
    expect(outputBytes).toBeLessThanOrEqual(CURRENT_DEMO_COMPACT_WORKSPACE_TARGET_BYTES);
    expect(outputBytes).toBeLessThanOrEqual(WEBMCP_READ_OUTPUT_LIMIT_BYTES);
    expect(engine.getState()).toEqual(before);
    expect(bridge.setComparison).not.toHaveBeenCalled();
  });

  it("omits internal histories, blob keys, and immutable preview bodies without losing review data", async () => {
    const replayCase = createDemoCase();
    const lockedAt = "2026-08-29T10:00:00.000Z";
    const lock = {
      lockedBy: "human" as const,
      lockedAt,
      reason: "Preserve the reviewed fixture geometry.",
    };
    const sourceTrajectory = replayCase.trajectories[0];
    const sourceEvent = replayCase.timelineEvents.find((event) => event.id === "event-impact");
    const sourceClaim = replayCase.claims.find((claim) => claim.id === "claim-road-wet");
    const sourceEvidence = replayCase.evidence.find((asset) => asset.id === "evidence-road");
    if (!sourceTrajectory || !sourceEvent || !sourceClaim || !sourceEvidence) {
      throw new Error("The deterministic demo must contain the compact-read fixtures.");
    }
    sourceTrajectory.locked = true;
    sourceTrajectory.lock = lock;
    sourceEvent.locked = true;
    sourceEvent.lock = lock;
    sourceClaim.locked = true;
    sourceClaim.lock = lock;

    const snapshotCreatedAt = "2026-08-29T10:01:00.000Z";
    const snapshotPreview = buildReportPreview(replayCase, { generatedAt: snapshotCreatedAt });
    replayCase.caseVersion += 1;
    replayCase.updatedAt = snapshotCreatedAt;
    replayCase.reportSnapshots.push({
      id: "report-snapshot-compact-read",
      caseVersion: replayCase.caseVersion,
      createdAt: snapshotCreatedAt,
      confirmedClaimIds: replayCase.claims
        .filter((claim) => claim.status === "confirmed")
        .map((claim) => claim.id),
      includedEvidenceIds: [...snapshotPreview.includedEvidenceIds],
      unresolvedQuestionIds: [...snapshotPreview.unresolvedQuestionIds],
      branchIds: replayCase.branches
        .filter((branch) => branch.status === "active")
        .map((branch) => branch.id),
      humanAcknowledged: true,
      immutable: true,
      preview: snapshotPreview,
    });
    const engine = createReplayEngine(replayCase);
    const adapter = createReplayWebMCPAdapter(engine, {
      ...requiredUiBridge(engine),
      getReportPreview: () => snapshotPreview,
      getSelectedReportSnapshotId: () => "report-snapshot-compact-read",
    });

    const workspace = (await adapter.getWorkspaceState(
      [...WORKSPACE_SECTIONS],
      context("get_workspace_state"),
    )) as {
      scene: {
        trajectories: Array<{
          id: string;
          locked: boolean;
          lock?: typeof lock;
          keyframes: Array<{
            id: string;
            timeMs: number;
            x: number;
            y: number;
            rotationDeg: number;
          }>;
        }>;
      };
      timeline: { events: Array<Record<string, unknown>> };
      claims: Array<Record<string, unknown>>;
      evidence: Array<Record<string, unknown>>;
      hypotheses: { branches: Array<Record<string, unknown>> };
      report: {
        snapshots: Array<Record<string, unknown>>;
        visiblePreviewStatus: string;
        visiblePreviewSnapshotId?: string;
        visiblePreview: ReturnType<typeof buildReportPreview> | null;
      };
    };
    const serialized = JSON.stringify(workspace);

    expect(serialized).not.toContain('"changeHistory"');
    expect(serialized).not.toContain('"localBlobKey"');
    const projectedTrajectory = workspace.scene.trajectories.find(
      (trajectory) => trajectory.id === sourceTrajectory.id,
    );
    expect(projectedTrajectory).toMatchObject({
      id: sourceTrajectory.id,
      locked: true,
      lock,
    });
    expect(projectedTrajectory?.keyframes).toEqual(
      sourceTrajectory.keyframes.map((keyframe) => ({
        id: keyframe.id,
        timeMs: keyframe.timeMs,
        x:
          (keyframe.x - replayCase.environment.bounds.minX) /
          (replayCase.environment.bounds.maxX - replayCase.environment.bounds.minX),
        y:
          (keyframe.y - replayCase.environment.bounds.minY) /
          (replayCase.environment.bounds.maxY - replayCase.environment.bounds.minY),
        rotationDeg: keyframe.rotationDeg,
      })),
    );
    expect(workspace.timeline.events.find((event) => event.id === sourceEvent.id)).toMatchObject({
      id: sourceEvent.id,
      certainty: sourceEvent.certainty,
      linkedActorIds: sourceEvent.linkedActorIds,
      linkedClaimIds: sourceEvent.linkedClaimIds,
      linkedEvidenceIds: sourceEvent.linkedEvidenceIds,
      locked: true,
      lock,
    });
    expect(workspace.claims.find((claim) => claim.id === sourceClaim.id)).toMatchObject({
      id: sourceClaim.id,
      status: sourceClaim.status,
      sourceType: sourceClaim.sourceType,
      sourceIds: sourceClaim.sourceIds,
      linkedEvidenceIds: sourceClaim.linkedEvidenceIds,
      linkedEventIds: sourceClaim.linkedEventIds,
      linkedSceneObjectIds: sourceClaim.linkedSceneObjectIds,
      createdBy: sourceClaim.createdBy,
      humanConfirmed: sourceClaim.humanConfirmed,
      locked: true,
      lock,
    });
    expect(workspace.evidence.find((asset) => asset.id === sourceEvidence.id)).toMatchObject({
      id: sourceEvidence.id,
      checksum: sourceEvidence.checksum,
      source: sourceEvidence.source,
      capturedAt: sourceEvidence.capturedAt,
      annotations: sourceEvidence.annotations,
      annotationLinks: sourceEvidence.annotationLinks,
      linkedClaimIds: sourceEvidence.linkedClaimIds,
      linkedEventIds: sourceEvidence.linkedEventIds,
      linkedSceneObjectIds: sourceEvidence.linkedSceneObjectIds,
      linkedBranchIds: sourceEvidence.linkedBranchIds,
    });
    expect(workspace.hypotheses.branches[0]).toMatchObject({
      id: "branch-baseline",
      status: "active",
      trajectoryIds: replayCase.branches[0]?.trajectoryIds,
      eventIds: replayCase.branches[0]?.eventIds,
      sharedClaimIds: replayCase.branches[0]?.sharedClaimIds,
    });
    expect(workspace.report.snapshots[0]).toMatchObject({
      id: "report-snapshot-compact-read",
      immutable: true,
      humanAcknowledged: true,
      confirmedClaimIds: expect.any(Array),
      includedEvidenceIds: snapshotPreview.includedEvidenceIds,
      unresolvedQuestionIds: snapshotPreview.unresolvedQuestionIds,
      previewSummary: {
        caseId: snapshotPreview.caseId,
        caseVersion: snapshotPreview.caseVersion,
        generatedAt: snapshotPreview.generatedAt,
        title: snapshotPreview.title,
        reviewBinding: snapshotPreview.reviewBinding,
      },
    });
    expect(workspace.report.snapshots[0]).not.toHaveProperty("preview");
    expect(workspace.report).toMatchObject({
      visiblePreviewStatus: "finalized-snapshot",
      visiblePreviewSnapshotId: "report-snapshot-compact-read",
      visiblePreview: snapshotPreview,
    });
  });

  it("caps hypothesis event deltas and reports deterministic truncation metadata", async () => {
    const replayCase = createDemoCase();
    const baseline = replayCase.branches.find((branch) => branch.id === "branch-baseline");
    const eventTemplate = replayCase.timelineEvents[0];
    if (!baseline || !eventTemplate) throw new Error("The demo baseline is incomplete.");
    const alternativeEventIds: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      const baselineId = `event-budget-baseline-${String(index)}`;
      const alternativeId = `event-budget-alternative-${String(index)}`;
      const title = `Comparison event ${String(index)}`;
      replayCase.timelineEvents.push(
        {
          ...eventTemplate,
          id: baselineId,
          branchId: baseline.id,
          timeMs: 1_000 + index,
          type: "observation",
          title,
          linkedActorIds: [],
          linkedClaimIds: [],
          linkedEvidenceIds: [],
          locked: false,
          lock: undefined,
          changeHistory: [],
        },
        {
          ...eventTemplate,
          id: alternativeId,
          branchId: "branch-budget-alternative",
          timeMs: 1_100 + index,
          type: "observation",
          title,
          linkedActorIds: [],
          linkedClaimIds: [],
          linkedEvidenceIds: [],
          locked: false,
          lock: undefined,
          changeHistory: [],
        },
      );
      baseline.eventIds.push(baselineId);
      alternativeEventIds.push(alternativeId);
    }
    replayCase.branches.push({
      ...baseline,
      id: "branch-budget-alternative",
      name: "Delta budget alternative",
      description: "Synthetic branch with more event differences than one tool result returns.",
      parentBranchId: baseline.id,
      sharedClaimIds: [...baseline.sharedClaimIds],
      assumptions: [],
      trajectoryIds: [],
      eventIds: alternativeEventIds,
      claimIds: [],
      changeHistory: [],
    });

    const engine = createReplayEngine(replayCase);
    const adapter = createReplayWebMCPAdapter(engine, requiredUiBridge(engine));
    const result = (await adapter.compareHypotheses(
      { branchIds: ["branch-baseline", "branch-budget-alternative"] },
      context("compare_hypotheses"),
    )) as {
      pairwiseComparisons: Array<{
        geometryTimingDeltas: {
          eventDeltas: {
            totalCount: number;
            returnedCount: number;
            truncated: boolean;
            items: unknown[];
          };
        };
      }>;
    };
    const eventDeltas = result.pairwiseComparisons[0]?.geometryTimingDeltas.eventDeltas;
    expect(eventDeltas).toMatchObject({
      totalCount: expect.any(Number),
      returnedCount: 32,
      truncated: true,
    });
    expect(eventDeltas?.totalCount).toBeGreaterThan(32);
    expect(eventDeltas?.items).toHaveLength(32);
  });

  it("returns only consistency issues relevant to the focused item", async () => {
    const engine = createReplayEngine(createDemoCase());
    const bridge = requiredUiBridge(engine);
    const adapter = createReplayWebMCPAdapter(engine, bridge);
    const unrelatedIssue = engine.getState().consistencyIssues[0];
    if (!unrelatedIssue) throw new Error("The demo case must expose a consistency advisory");
    expect(unrelatedIssue.affectedIds).not.toContain("question-lane-change");

    expect(
      await adapter.focusWorkspaceItem(
        { itemType: "question", itemId: "question-lane-change" },
        context("focus_workspace_item"),
      ),
    ).toMatchObject({ ok: true, issues: [] });
    expect(
      await adapter.focusWorkspaceItem(
        { itemType: "issue", itemId: unrelatedIssue.id },
        context("focus_workspace_item"),
      ),
    ).toMatchObject({ ok: true, issues: [{ id: unrelatedIssue.id }] });
    expect(
      await adapter.focusWorkspaceItem(
        { itemType: "question", itemId: "question-does-not-exist" },
        context("focus_workspace_item"),
      ),
    ).toMatchObject({ ok: false, code: "NOT_FOUND", issues: [] });
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
    const bridge = requiredUiBridge(engine, persistCase);
    const adapter = createReplayWebMCPAdapter(engine, bridge);

    const execution = adapter.execute(actorMutation(), context("upsert_scene_actor")) as Promise<
      Awaited<ReturnType<typeof adapter.execute>>
    >;
    await started;

    expect(engine.getState()).toEqual(before);
    expect(engine.canUndo).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(bridge.setMutationTransactionActive).toHaveBeenCalledTimes(1);
    expect(bridge.setMutationTransactionActive).toHaveBeenLastCalledWith(true);
    expect(persistCase).toHaveBeenCalledWith(expect.objectContaining({ caseVersion: 2 }), {
      expectedCaseVersion: 1,
    });

    releasePersistence?.();
    const result = await execution;

    expect(result).toMatchObject({ ok: true, caseVersion: 2 });
    expect(engine.getState().caseVersion).toBe(2);
    expect(engine.canUndo).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(bridge.setMutationTransactionActive.mock.calls).toEqual([[true], [false]]);
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

  it("updates an existing actor with only changed fields and preserves trusted specifications", async () => {
    const engine = createReplayEngine(createDemoCase());
    const before = engine.getState().actors.find((actor) => actor.id === "actor-vehicle-a");
    if (!before) throw new Error("Demo actor is missing");
    const persistCase = vi.fn(() => Promise.resolve());
    const adapter = createReplayWebMCPAdapter(engine, requiredUiBridge(engine, persistCase));
    const tool = createReplayWebMCPTools(adapter).find(
      (candidate) => candidate.name === "upsert_scene_actor",
    );
    if (!tool) throw new Error("Missing actor tool");

    const result = await tool.execute(
      {
        actorId: before.id,
        position: { x: 0.64, y: 0.51 },
        expectedPoseTarget: { branchId: "branch-baseline", playheadTimeMs: 20_000 },
        expectedVersion: 1,
        requestId: "request-partial-actor-update",
      },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      ok: true,
      caseVersion: 2,
      affectedIds: expect.arrayContaining([before.id, "trajectory-a-baseline", "branch-baseline"]),
    });
    expect(engine.getState().actors.find((actor) => actor.id === before.id)).toMatchObject({
      label: before.label,
      dimensions: before.dimensions,
      dimensionsSource: before.dimensionsSource,
      wheelbaseMeters: before.wheelbaseMeters,
      vehicleClass: before.vehicleClass,
      pose: { x: 64, y: 51, rotationDeg: before.pose.rotationDeg },
    });
    expect(persistCase).toHaveBeenCalledTimes(1);

    const unknown = await tool.execute(
      {
        actorId: "actor-does-not-exist",
        position: { x: 0.5, y: 0.5 },
        expectedPoseTarget: { branchId: "branch-baseline", playheadTimeMs: 20_000 },
        expectedVersion: 2,
        requestId: "request-partial-unknown-actor",
      },
      { signal: new AbortController().signal },
    );
    expect(unknown).toMatchObject({ ok: false, code: "NOT_FOUND", caseVersion: 2 });
    expect(engine.getState().actors).toHaveLength(2);
    expect(persistCase).toHaveBeenCalledTimes(1);
  });

  it("rejects empty and semantically unchanged existing actor updates before staging", async () => {
    const engine = createReplayEngine(createDemoCase());
    const before = engine.getState();
    const actor = before.actors.find((candidate) => candidate.id === "actor-vehicle-a");
    if (!actor) throw new Error("Demo actor is missing");
    const persistCase = vi.fn(() => Promise.resolve());
    const adapter = createReplayWebMCPAdapter(engine, requiredUiBridge(engine, persistCase));
    const update = (requestId: string, payload: Record<string, unknown>): ReplayWebMCPCommand => ({
      type: "upsert_scene_actor",
      actor: "agent",
      origin: "webmcp",
      requestId,
      expectedVersion: before.caseVersion,
      payload: { actorId: actor.id, ...payload },
    });

    const actorIdOnly = await adapter.execute(
      update("request-actor-id-only-noop", {}),
      context("upsert_scene_actor"),
    );
    const unchangedLabel = await adapter.execute(
      update("request-actor-unchanged-label", { label: actor.label }),
      context("upsert_scene_actor"),
    );

    expect(actorIdOnly).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      caseVersion: before.caseVersion,
    });
    expect(actorIdOnly.message).toContain("requires at least one editable field");
    expect(unchangedLabel).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      caseVersion: before.caseVersion,
    });
    expect(unchangedLabel.message).toContain("does not change any editable field");
    expect(engine.getState()).toEqual(before);
    expect(persistCase).not.toHaveBeenCalled();
  });

  it("rejects first pose mutations when the visible branch or playhead differs from the explicit target", async () => {
    const engine = createReplayEngine(createDemoCase());
    const before = engine.getState();
    const persistCase = vi.fn(() => Promise.resolve());
    const adapter = createReplayWebMCPAdapter(engine, {
      ...requiredUiBridge(engine, persistCase),
      getPlayheadTimeMs: () => 7_000,
    });
    const tools = createReplayWebMCPTools(adapter);
    const actorTool = tools.find((candidate) => candidate.name === "upsert_scene_actor");
    const proposalTool = tools.find((candidate) => candidate.name === "propose_scene_changes");
    if (!actorTool || !proposalTool) throw new Error("Missing pose mutation tools");

    const stalePlayhead = await actorTool.execute(
      {
        actorId: "actor-vehicle-a",
        position: { x: 0.634, y: 0.47 },
        expectedPoseTarget: { branchId: "branch-baseline", playheadTimeMs: 6_000 },
        expectedVersion: before.caseVersion,
        requestId: "request-stale-playhead-actor-update",
      },
      { signal: new AbortController().signal },
    );
    const staleBranch = await proposalTool.execute(
      {
        title: "Stale branch pose proposal",
        rationale: "A changed visible target must block the preview before it reaches the ledger.",
        changes: [
          {
            kind: "actor-pose",
            actorId: "actor-vehicle-a",
            proposedPose: { x: 0.61, y: 0.47, rotationDeg: 8 },
          },
          {
            kind: "actor-pose",
            actorId: "actor-vehicle-b",
            proposedPose: { x: 0.55, y: 0.64, rotationDeg: 84 },
          },
        ],
        expectedPoseTarget: { branchId: "branch-other", playheadTimeMs: 7_000 },
        expectedVersion: before.caseVersion,
        requestId: "request-stale-branch-proposal",
      },
      { signal: new AbortController().signal },
    );

    expect(stalePlayhead).toMatchObject({
      ok: false,
      code: "VERSION_CONFLICT",
      caseVersion: before.caseVersion,
    });
    expect(stalePlayhead.message).toContain("visible target is branch-baseline at 7000 ms");
    expect(staleBranch).toMatchObject({
      ok: false,
      code: "VERSION_CONFLICT",
      caseVersion: before.caseVersion,
    });
    expect(engine.getState()).toEqual(before);
    expect(persistCase).not.toHaveBeenCalled();
  });

  it("applies an existing actor pose at the live playhead without changing other path points", async () => {
    const engine = createReplayEngine(createDemoCase());
    const before = engine.getState();
    const trajectoryBefore = before.trajectories.find(
      (trajectory) => trajectory.id === "trajectory-a-baseline",
    );
    if (!trajectoryBefore) throw new Error("Vehicle A trajectory is missing");
    const persistCase = vi.fn(() => Promise.resolve());
    let playheadTimeMs = 7_000;
    const adapter = createReplayWebMCPAdapter(engine, {
      ...requiredUiBridge(engine, persistCase),
      getPlayheadTimeMs: () => playheadTimeMs,
    });
    const tool = createReplayWebMCPTools(adapter).find(
      (candidate) => candidate.name === "upsert_scene_actor",
    );
    if (!tool) throw new Error("Missing actor tool");

    const result = await tool.execute(
      {
        actorId: "actor-vehicle-a",
        position: { x: 0.634, y: 0.47 },
        rotationDeg: 8,
        expectedPoseTarget: { branchId: "branch-baseline", playheadTimeMs: 7_000 },
        expectedVersion: before.caseVersion,
        requestId: "request-playhead-actor-update",
      },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      ok: true,
      caseVersion: before.caseVersion + 1,
      affectedIds: expect.arrayContaining([
        "actor-vehicle-a",
        trajectoryBefore.id,
        "branch-baseline",
      ]),
    });
    const trajectoryAfter = engine
      .getState()
      .trajectories.find((trajectory) => trajectory.id === trajectoryBefore.id);
    expect(trajectoryAfter?.keyframes[0]).toEqual(trajectoryBefore.keyframes[0]);
    expect(trajectoryAfter?.keyframes.at(-1)).toEqual(trajectoryBefore.keyframes.at(-1));
    expect(trajectoryAfter?.keyframes.find((keyframe) => keyframe.timeMs === 7_000)).toMatchObject({
      x: 63.4,
      y: 47,
      rotationDeg: 8,
    });
    expect(engine.getState().actors.find((actor) => actor.id === "actor-vehicle-a")?.pose).toEqual({
      x: trajectoryBefore.keyframes.at(-1)?.x,
      y: trajectoryBefore.keyframes.at(-1)?.y,
      rotationDeg: trajectoryBefore.keyframes.at(-1)?.rotationDeg,
    });
    const workspace = (await adapter.getWorkspaceState(
      ["scene"],
      context("get_workspace_state"),
    )) as {
      scene: {
        playheadTimeMs: number;
        actors: Array<{ id: string; pose: { x: number; y: number; rotationDeg: number } }>;
      };
    };
    expect(workspace.scene.playheadTimeMs).toBe(7_000);
    const projectedActorPose = workspace.scene.actors.find(
      (actor) => actor.id === "actor-vehicle-a",
    )?.pose;
    expect(projectedActorPose).toMatchObject({ x: 0.634, y: 0.47 });
    expect(projectedActorPose?.rotationDeg).toBeCloseTo(8, 10);
    expect(persistCase).toHaveBeenCalledOnce();

    playheadTimeMs = 9_000;
    const retry = await tool.execute(
      {
        actorId: "actor-vehicle-a",
        position: { x: 0.634, y: 0.47 },
        rotationDeg: 8,
        expectedPoseTarget: { branchId: "branch-baseline", playheadTimeMs: 7_000 },
        expectedVersion: before.caseVersion,
        requestId: "request-playhead-actor-update",
      },
      { signal: new AbortController().signal },
    );
    expect(retry).toMatchObject({
      ok: true,
      caseVersion: before.caseVersion + 1,
      idempotent: true,
      activityId: result.activityId,
    });
    expect(persistCase).toHaveBeenCalledOnce();
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

  it("does not collide derived proposal IDs for maximum-length request IDs", async () => {
    const engine = createReplayEngine(createDemoCase());
    const persistCase = vi.fn(() => Promise.resolve());
    const adapter = createReplayWebMCPAdapter(engine, requiredUiBridge(engine, persistCase));
    const commonPrefix = "x".repeat(122);
    const proposal = (requestId: string, expectedVersion: number, title: string) =>
      ({
        type: "propose_scene_changes",
        actor: "agent",
        origin: "webmcp",
        requestId,
        expectedVersion,
        payload: {
          title,
          rationale: "Keep derived IDs unique even when request IDs share a long prefix.",
          expectedPoseTarget: { branchId: "branch-baseline", playheadTimeMs: 20_000 },
          changes: [
            {
              kind: "actor-pose",
              actorId: "actor-vehicle-a",
              proposedPose: { x: 0.64, y: 0.51, rotationDeg: 6 },
            },
          ],
        },
      }) as const;

    expect(
      await adapter.execute(
        proposal(`${commonPrefix}aaaaaa`, 1, "Long request proposal A"),
        context("propose_scene_changes"),
      ),
    ).toMatchObject({ ok: true, caseVersion: 2 });
    expect(
      await adapter.execute(
        proposal(`${commonPrefix}bbbbbb`, 2, "Long request proposal B"),
        context("propose_scene_changes"),
      ),
    ).toMatchObject({ ok: true, caseVersion: 3 });

    const proposalIds = engine.getState().proposals.map((item) => item.id);
    expect(proposalIds).toHaveLength(2);
    expect(new Set(proposalIds).size).toBe(2);
    expect(proposalIds.every((proposalId) => proposalId.length <= 128)).toBe(true);
  });

  it("normalizes arbitrary imported scene bounds and reuses reads directly in narrow trajectory patches", async () => {
    const importedCase = createDemoCase();
    const sourceBounds = importedCase.environment.bounds;
    const importedBounds = { minX: -250, minY: 120, maxX: 350, maxY: 920 };
    const roundCoordinate = (value: number) => Math.round(value * 1_000_000_000) / 1_000_000_000;
    const remapX = (value: number) =>
      roundCoordinate(
        importedBounds.minX +
          ((value - sourceBounds.minX) / (sourceBounds.maxX - sourceBounds.minX)) *
            (importedBounds.maxX - importedBounds.minX),
      );
    const remapY = (value: number) =>
      roundCoordinate(
        importedBounds.minY +
          ((value - sourceBounds.minY) / (sourceBounds.maxY - sourceBounds.minY)) *
            (importedBounds.maxY - importedBounds.minY),
      );
    importedCase.environment.roadPolygon = importedCase.environment.roadPolygon.map((point) => ({
      x: remapX(point.x),
      y: remapY(point.y),
    }));
    importedCase.actors = importedCase.actors.map((actor) => ({
      ...actor,
      pose: { ...actor.pose, x: remapX(actor.pose.x), y: remapY(actor.pose.y) },
    }));
    importedCase.trajectories = importedCase.trajectories.map((trajectory) => ({
      ...trajectory,
      keyframes: trajectory.keyframes.map((keyframe) => ({
        ...keyframe,
        x: remapX(keyframe.x),
        y: remapY(keyframe.y),
      })),
    }));
    importedCase.timelineEvents = importedCase.timelineEvents.map((event) => ({
      ...event,
      ...(event.location === undefined
        ? {}
        : { location: { x: remapX(event.location.x), y: remapY(event.location.y) } }),
    }));
    importedCase.environment.bounds = importedBounds;

    const engine = createReplayEngine(importedCase);
    const before = engine.getState();
    const persistCase = vi.fn(() => Promise.resolve());
    const adapter = createReplayWebMCPAdapter(engine, requiredUiBridge(engine, persistCase));
    const workspace = (await adapter.getWorkspaceState(
      ["scene", "timeline", "hypotheses"],
      context("get_workspace_state"),
    )) as {
      coordinateSystem: {
        type: string;
        position: {
          minimum: number;
          maximum: number;
          inBoundsMinimum: number;
          inBoundsMaximum: number;
          xDirection: string;
          yDirection: string;
          reference: string;
          boundsPath: string;
          boundsRepresentation: string;
          outOfBoundsRepresentation: string;
        };
        rotation: { field: string; unit: string };
        time: { field: string; unit: string };
      };
      scene: {
        environment: {
          bounds: { minX: number; minY: number; maxX: number; maxY: number };
          roadPolygon: Array<{ x: number; y: number }>;
        };
        actors: Array<{ id: string; pose: { x: number; y: number; rotationDeg: number } }>;
        trajectories: Array<{
          id: string;
          actorId: string;
          branchId: string;
          keyframes: Array<{
            id: string;
            timeMs: number;
            x: number;
            y: number;
            rotationDeg: number;
          }>;
        }>;
      };
      timeline: { events: Array<{ id: string; location?: { x: number; y: number } }> };
      hypotheses: { proposals: unknown[] };
    };

    expect(workspace.coordinateSystem).toMatchObject({
      type: "normalized-scene",
      position: {
        minimum: -WEBMCP_SCENE_COORDINATE_LIMIT,
        maximum: WEBMCP_SCENE_COORDINATE_LIMIT,
        inBoundsMinimum: 0,
        inBoundsMaximum: 1,
        xDirection: "left-to-right",
        yDirection: "top-to-bottom",
        reference: "open-case-environment-bounds",
        boundsPath: "scene.environment.bounds",
        boundsRepresentation: "normalized-envelope",
        outOfBoundsRepresentation: "proportional-values-outside-0..1",
      },
      rotation: { field: "rotationDeg", unit: "degrees" },
      time: { field: "timeMs", unit: "milliseconds-from-reviewed-interval-start" },
    });
    expect(workspace.scene.environment.bounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: 1,
      maxY: 1,
    });
    expect(workspace.scene.environment.roadPolygon).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]);
    const sourceActorAPose = before.actors.find((actor) => actor.id === "actor-vehicle-a")?.pose;
    if (!sourceActorAPose) throw new Error("The demo must expose Vehicle A.");
    const normalizeX = (value: number) =>
      (value - importedBounds.minX) / (importedBounds.maxX - importedBounds.minX);
    const normalizeY = (value: number) =>
      (value - importedBounds.minY) / (importedBounds.maxY - importedBounds.minY);
    const projectedSourceActorAPose = workspace.scene.actors.find(
      (actor) => actor.id === "actor-vehicle-a",
    )?.pose;
    expect(projectedSourceActorAPose?.x).toBeCloseTo(normalizeX(sourceActorAPose.x), 10);
    expect(projectedSourceActorAPose?.y).toBeCloseTo(normalizeY(sourceActorAPose.y), 10);
    expect(projectedSourceActorAPose?.rotationDeg).toBeCloseTo(sourceActorAPose.rotationDeg, 10);
    const sourceImpactLocation = before.timelineEvents.find(
      (event) => event.id === "event-impact",
    )?.location;
    if (!sourceImpactLocation) throw new Error("The demo must expose an impact location.");
    expect(
      workspace.timeline.events.find((event) => event.id === "event-impact")?.location?.x,
    ).toBeCloseTo(normalizeX(sourceImpactLocation.x), 10);
    expect(
      workspace.timeline.events.find((event) => event.id === "event-impact")?.location?.y,
    ).toBeCloseTo(normalizeY(sourceImpactLocation.y), 10);
    expect(collectSpatialCoordinates(workspace)).not.toHaveLength(0);
    expect(collectSpatialCoordinates(workspace).every((value) => value >= 0 && value <= 1)).toBe(
      true,
    );

    const trajectoryA = workspace.scene.trajectories.find(
      (trajectory) => trajectory.actorId === "actor-vehicle-a",
    );
    const trajectoryB = workspace.scene.trajectories.find(
      (trajectory) => trajectory.actorId === "actor-vehicle-b",
    );
    const keyframeA = trajectoryA?.keyframes[2];
    const keyframeB = trajectoryB?.keyframes[3];
    if (!trajectoryA || !trajectoryB || !keyframeA || !keyframeB) {
      throw new Error("The demo must expose two trajectories with interior keyframes.");
    }
    const proposedXA = keyframeA.x + 0.005;
    const proposedYB = keyframeB.y - 0.004;
    const proposalTool = createReplayWebMCPTools(adapter).find(
      (candidate) => candidate.name === "propose_scene_changes",
    );
    if (!proposalTool) throw new Error("Missing proposal tool");

    const result = await proposalTool.execute(
      {
        title: "Review two interior lane positions",
        rationale:
          "Preserve the recorded endpoints and timing while exposing a bounded alternative for human review.",
        changes: [
          {
            kind: "trajectory-keyframe-patch",
            actorId: trajectoryA.actorId,
            branchId: trajectoryA.branchId,
            adjustments: [{ keyframeId: keyframeA.id, x: proposedXA, y: keyframeA.y }],
            visible: true,
          },
          {
            kind: "trajectory-keyframe-patch",
            actorId: trajectoryB.actorId,
            branchId: trajectoryB.branchId,
            adjustments: [{ keyframeId: keyframeB.id, x: keyframeB.x, y: proposedYB }],
            visible: true,
          },
        ],
        expectedVersion: before.caseVersion,
        requestId: "request-read-to-patch-0001",
      },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({ ok: true, caseVersion: before.caseVersion + 1 });
    const proposal = engine.getState().proposals.at(-1);
    const changes = proposal?.revisions.at(-1)?.changes;
    const changeA = changes?.find((change) => change.actorId === trajectoryA.actorId);
    const changeB = changes?.find((change) => change.actorId === trajectoryB.actorId);
    if (changeA?.kind !== "trajectory-set" || changeB?.kind !== "trajectory-set") {
      throw new Error("Keyframe patches must expand to canonical trajectory proposal changes.");
    }
    const proposedFrameA = changeA.proposedTrajectory.keyframes.find(
      (keyframe) => keyframe.id === keyframeA.id,
    );
    const proposedFrameB = changeB.proposedTrajectory.keyframes.find(
      (keyframe) => keyframe.id === keyframeB.id,
    );
    const domainX = (value: number) =>
      importedBounds.minX + value * (importedBounds.maxX - importedBounds.minX);
    const domainY = (value: number) =>
      importedBounds.minY + value * (importedBounds.maxY - importedBounds.minY);
    const sourceFrameA = before.trajectories
      .find((trajectory) => trajectory.id === trajectoryA.id)
      ?.keyframes.find((keyframe) => keyframe.id === keyframeA.id);
    const sourceFrameB = before.trajectories
      .find((trajectory) => trajectory.id === trajectoryB.id)
      ?.keyframes.find((keyframe) => keyframe.id === keyframeB.id);
    expect(proposedFrameA).toMatchObject({ x: domainX(proposedXA), y: sourceFrameA?.y });
    expect(proposedFrameB).toMatchObject({ x: sourceFrameB?.x, y: domainY(proposedYB) });
    expect(engine.getState().trajectories).toEqual(before.trajectories);
    expect(persistCase).toHaveBeenCalledOnce();

    const hypotheses = (await adapter.getWorkspaceState(
      ["hypotheses"],
      context("get_workspace_state"),
    )) as {
      hypotheses: {
        proposals: Array<{
          revisions: Array<{
            changes: Array<{
              kind: string;
              actorId: string;
              baseActorPose?: { x: number; y: number };
              baseTrajectory?: { keyframes: Array<{ id: string; x: number; y: number }> };
              proposedTrajectory?: { keyframes: Array<{ id: string; x: number; y: number }> };
            }>;
          }>;
        }>;
      };
    };
    const projectedChangeA = hypotheses.hypotheses.proposals
      .at(-1)
      ?.revisions.at(-1)
      ?.changes.find((change) => change.actorId === trajectoryA.actorId);
    expect(projectedChangeA?.baseActorPose?.x).toBeCloseTo(normalizeX(sourceActorAPose.x), 10);
    expect(projectedChangeA?.baseActorPose?.y).toBeCloseTo(normalizeY(sourceActorAPose.y), 10);
    expect(
      projectedChangeA?.baseTrajectory?.keyframes.find((keyframe) => keyframe.id === keyframeA.id),
    ).toMatchObject({ x: keyframeA.x, y: keyframeA.y });
    expect(
      projectedChangeA?.proposedTrajectory?.keyframes.find(
        (keyframe) => keyframe.id === keyframeA.id,
      ),
    ).toMatchObject({ x: proposedXA, y: keyframeA.y });
    expect(
      collectSpatialCoordinates(hypotheses.hypotheses).every((value) => value >= 0 && value <= 1),
    ).toBe(true);
  });

  it("preserves finite out-of-bounds diagnostic geometry in a direct impact read-write round trip", async () => {
    const replayCase = createDemoCase();
    const sourceBounds = replayCase.environment.bounds;
    const bounds = { minX: -1_000, minY: 50, maxX: 3_000, maxY: 5_050 };
    const remap = <T extends { x: number; y: number }>(point: T): T => ({
      ...point,
      x:
        bounds.minX +
        ((point.x - sourceBounds.minX) / (sourceBounds.maxX - sourceBounds.minX)) *
          (bounds.maxX - bounds.minX),
      y:
        bounds.minY +
        ((point.y - sourceBounds.minY) / (sourceBounds.maxY - sourceBounds.minY)) *
          (bounds.maxY - bounds.minY),
    });
    replayCase.environment.roadPolygon = replayCase.environment.roadPolygon.map(remap);
    replayCase.actors = replayCase.actors.map((actor) => ({
      ...actor,
      pose: remap(actor.pose),
    }));
    replayCase.trajectories = replayCase.trajectories.map((trajectory) => ({
      ...trajectory,
      keyframes: trajectory.keyframes.map(remap),
    }));
    replayCase.timelineEvents = replayCase.timelineEvents.map((event) => ({
      ...event,
      ...(event.location ? { location: remap(event.location) } : {}),
    }));
    replayCase.environment.bounds = bounds;
    const impact = replayCase.timelineEvents.find((event) => event.id === "event-impact");
    if (!impact) throw new Error("Missing seeded impact event");
    const diagnosticLocation = {
      x: Number("-1234.5678901234567"),
      y: Number("5432.1234567890123"),
    };
    impact.location = diagnosticLocation;

    const engine = createReplayEngine(replayCase);
    const adapter = createReplayWebMCPAdapter(engine, requiredUiBridge(engine));
    const workspace = (await adapter.getWorkspaceState(
      ["timeline"],
      context("get_workspace_state"),
    )) as {
      timeline: { events: Array<{ id: string; location?: { x: number; y: number } }> };
    };
    const projectedLocation = workspace.timeline.events.find(
      (event) => event.id === impact.id,
    )?.location;
    if (!projectedLocation) throw new Error("Impact location was not projected");
    expect(projectedLocation.x).toBeLessThan(0);
    expect(projectedLocation.y).toBeGreaterThan(1);

    const impactTool = createReplayWebMCPTools(adapter).find(
      (candidate) => candidate.name === "mark_impact_event",
    );
    if (!impactTool) throw new Error("Missing impact tool");
    const result = await impactTool.execute(
      {
        eventId: impact.id,
        branchId: impact.branchId,
        timeMs: impact.timeMs,
        location: projectedLocation,
        actorIds: impact.linkedActorIds,
        status: impact.certainty,
        expectedVersion: engine.getState().caseVersion,
        requestId: "request-outside-impact-roundtrip",
      },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({ ok: true });
    expect(
      engine.getState().timelineEvents.find((event) => event.id === impact.id)?.location,
    ).toEqual(diagnosticLocation);
  });

  it("preserves linked impact provenance when WebMCP updates only placement and status", async () => {
    const engine = createReplayEngine(createDemoCase());
    const before = engine.getState();
    const impactBefore = before.timelineEvents.find((event) => event.id === "event-impact");
    if (!impactBefore) throw new Error("Missing seeded impact event");
    const persistCase = vi.fn(() => Promise.resolve());
    const adapter = createReplayWebMCPAdapter(engine, requiredUiBridge(engine, persistCase));

    const result = await adapter.execute(
      {
        type: "mark_impact_event",
        actor: "agent",
        origin: "webmcp",
        requestId: "request-impact-provenance-preserved",
        expectedVersion: before.caseVersion,
        payload: {
          eventId: impactBefore.id,
          branchId: impactBefore.branchId,
          timeMs: 10_250,
          location: { x: 0.67, y: 0.59 },
          actorIds: [...impactBefore.linkedActorIds],
          status: "uncertain",
        },
      },
      context("mark_impact_event"),
    );

    expect(result).toMatchObject({
      ok: true,
      caseVersion: before.caseVersion + 1,
      affectedIds: expect.arrayContaining([
        impactBefore.id,
        ...impactBefore.linkedClaimIds,
        ...impactBefore.linkedEvidenceIds,
      ]),
    });
    const impactAfter = engine
      .getState()
      .timelineEvents.find((event) => event.id === impactBefore.id);
    expect(impactAfter).toMatchObject({
      timeMs: 10_250,
      location: { x: 67, y: 59 },
      linkedClaimIds: impactBefore.linkedClaimIds,
      linkedEvidenceIds: impactBefore.linkedEvidenceIds,
    });
    for (const claimId of impactBefore.linkedClaimIds) {
      expect(
        engine.getState().claims.find((claim) => claim.id === claimId)?.linkedEventIds,
      ).toContain(impactBefore.id);
    }
    for (const evidenceId of impactBefore.linkedEvidenceIds) {
      expect(
        engine.getState().evidence.find((asset) => asset.id === evidenceId)?.linkedEventIds,
      ).toContain(impactBefore.id);
    }
    expect(persistCase).toHaveBeenCalledOnce();
  });

  it("updates only an existing impact on the supplied branch and never reclassifies an event", async () => {
    const engine = createReplayEngine(createDemoCase());
    expect(
      engine.execute({
        type: "hypothesis.fork",
        actor: "human",
        origin: "ui",
        expectedVersion: 1,
        branchId: "branch-impact-alternative",
        parentBranchId: "branch-baseline",
        name: "Alternative impact branch",
        description: "A separate branch used to verify impact event ownership.",
      }),
    ).toMatchObject({ ok: true, caseVersion: 2 });
    const before = engine.getState();
    const impact = before.timelineEvents.find((event) => event.id === "event-impact");
    const maneuver = before.timelineEvents.find((event) => event.id === "event-maneuver");
    if (!impact || !maneuver) throw new Error("Demo impact or maneuver event is missing");
    const persistCase = vi.fn(() => Promise.resolve());
    const adapter = createReplayWebMCPAdapter(engine, requiredUiBridge(engine, persistCase));
    const update = (eventId: string, branchId: string, requestId: string): ReplayWebMCPCommand => ({
      type: "mark_impact_event",
      actor: "agent",
      origin: "webmcp",
      requestId,
      expectedVersion: before.caseVersion,
      payload: {
        eventId,
        branchId,
        timeMs: impact.timeMs,
        location: { x: 0.66, y: 0.59 },
        actorIds: [...impact.linkedActorIds],
        status: "uncertain",
      },
    });

    const missing = await adapter.execute(
      update("event-does-not-exist", impact.branchId, "request-impact-missing-event"),
      context("mark_impact_event"),
    );
    const wrongType = await adapter.execute(
      update(maneuver.id, maneuver.branchId, "request-impact-wrong-event-type"),
      context("mark_impact_event"),
    );
    const wrongBranch = await adapter.execute(
      update(impact.id, "branch-impact-alternative", "request-impact-wrong-event-branch"),
      context("mark_impact_event"),
    );

    expect(missing).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
      caseVersion: before.caseVersion,
    });
    expect(missing.message).toContain("Omit eventId to create a new impact");
    expect(wrongType).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      caseVersion: before.caseVersion,
    });
    expect(wrongType.message).toContain("cannot be reclassified");
    expect(wrongBranch).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      caseVersion: before.caseVersion,
    });
    expect(wrongBranch.message).toContain(`belongs to branch ${impact.branchId}`);
    expect(engine.getState()).toEqual(before);
    expect(engine.getState().timelineEvents.find((event) => event.id === maneuver.id)?.type).toBe(
      "maneuver",
    );
    expect(persistCase).not.toHaveBeenCalled();
  });

  it("rejects missing and endpoint keyframe patches and ambiguous source cases", async () => {
    const demoEngine = createReplayEngine(createDemoCase());
    const demoBefore = demoEngine.getState();
    const demoPersist = vi.fn(() => Promise.resolve());
    const demoAdapter = createReplayWebMCPAdapter(
      demoEngine,
      requiredUiBridge(demoEngine, demoPersist),
    );
    const trajectory = demoBefore.trajectories.find(
      (candidate) => candidate.actorId === "actor-vehicle-a",
    );
    if (!trajectory) throw new Error("Missing demo trajectory");
    const patchCommand = (requestId: string, keyframeId: string): ReplayWebMCPCommand => ({
      type: "propose_scene_changes",
      actor: "agent",
      origin: "webmcp",
      requestId,
      expectedVersion: demoBefore.caseVersion,
      payload: {
        title: "Review a bounded trajectory adjustment",
        rationale: "Keep the current path available while a human reviews one interior point.",
        changes: [
          {
            kind: "trajectory-keyframe-patch",
            actorId: trajectory.actorId,
            branchId: trajectory.branchId,
            adjustments: [{ keyframeId, x: 0.45 }],
            visible: true,
          },
        ],
      },
    });

    const endpoint = await demoAdapter.execute(
      patchCommand("request-patch-endpoint-0001", trajectory.keyframes[0]?.id ?? "missing"),
      context("propose_scene_changes"),
    );
    const missingKeyframe = await demoAdapter.execute(
      patchCommand("request-patch-missing-frame-0001", "keyframe-does-not-exist"),
      context("propose_scene_changes"),
    );
    expect(endpoint).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(endpoint.message).toContain("preserve first and last endpoints");
    expect(missingKeyframe).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(missingKeyframe.message).toContain("keyframe-does-not-exist");
    expect(demoEngine.getState()).toEqual(demoBefore);
    expect(demoPersist).not.toHaveBeenCalled();

    const blankEngine = createReplayEngine(
      createBlankCase(
        {
          title: "Missing trajectory patch test",
          sceneType: "roundabout",
          roadCondition: "unknown",
          vehicleCount: 2,
        },
        { caseId: "case-missing-patch-trajectory", now: "2026-08-29T10:00:00.000Z" },
      ),
    );
    const blankPersist = vi.fn(() => Promise.resolve());
    const blankAdapter = createReplayWebMCPAdapter(
      blankEngine,
      requiredUiBridge(blankEngine, blankPersist),
    );
    const missingTrajectory = await blankAdapter.execute(
      {
        type: "propose_scene_changes",
        actor: "agent",
        origin: "webmcp",
        requestId: "request-patch-missing-path-0001",
        expectedVersion: blankEngine.getState().caseVersion,
        payload: {
          title: "Review a missing path",
          rationale: "Verify that a narrow edit cannot invent an unrecorded trajectory.",
          changes: [
            {
              kind: "trajectory-keyframe-patch",
              actorId: "actor-vehicle-a",
              branchId: "branch-baseline",
              adjustments: [{ keyframeId: "keyframe-does-not-exist", x: 0.5 }],
              visible: true,
            },
          ],
        },
      },
      context("propose_scene_changes"),
    );
    expect(missingTrajectory).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(missingTrajectory.message).toContain("No trajectory exists");
    expect(blankPersist).not.toHaveBeenCalled();

    const ambiguousCase = createDemoCase();
    const original = ambiguousCase.trajectories.find(
      (candidate) => candidate.actorId === "actor-vehicle-a",
    );
    if (!original) throw new Error("Missing trajectory to duplicate");
    const duplicate = structuredClone(original);
    duplicate.id = "trajectory-a-ambiguous-copy";
    duplicate.keyframes = duplicate.keyframes.map((keyframe, index) => ({
      ...keyframe,
      id: `trajectory-a-ambiguous-keyframe-${String(index + 1)}`,
    }));
    duplicate.changeHistory = duplicate.changeHistory.map((change) => ({
      ...change,
      id: `${change.id}-ambiguous-copy`,
    }));
    ambiguousCase.trajectories.push(duplicate);
    const baseline = ambiguousCase.branches.find((branch) => branch.id === "branch-baseline");
    baseline?.trajectoryIds.push(duplicate.id);
    expect(() => createReplayEngine(ambiguousCase)).toThrow(
      "Initial case contains invalid references",
    );
  });

  it("rejects unknown damage sources instead of silently dropping them", async () => {
    const engine = createReplayEngine(createDemoCase());
    const before = engine.getState();
    const persistCase = vi.fn(() => Promise.resolve());
    const adapter = createReplayWebMCPAdapter(engine, requiredUiBridge(engine, persistCase));

    const unsourced = await adapter.execute(
      {
        type: "mark_vehicle_damage",
        actor: "agent",
        origin: "webmcp",
        requestId: "request-damage-unsourced-0001",
        expectedVersion: 1,
        payload: {
          actorId: "actor-vehicle-a",
          damageRegion: "front",
          description: "A provisional scrape without a source",
          sourceIds: [],
          status: "uncertain",
        },
      },
      context("mark_vehicle_damage"),
    );
    expect(unsourced).toMatchObject({ ok: false, code: "INVALID_INPUT", caseVersion: 1 });
    expect(unsourced.message).toContain("requires at least one active evidence or observation");

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

  it("rejects fabricated external provenance and preserves source/context distinctions", async () => {
    const engine = createReplayEngine(createDemoCase());
    const before = engine.getState();
    const persistCase = vi.fn(() => Promise.resolve());
    const adapter = createReplayWebMCPAdapter(engine, requiredUiBridge(engine, persistCase));

    const unsupportedSource = await adapter.execute(
      {
        type: "add_observation",
        actor: "agent",
        origin: "webmcp",
        requestId: "request-observation-provenance-unsupported-source",
        expectedVersion: 1,
        payload: {
          statement: "The agent presents a vehicle link as a human statement source.",
          sourceType: "human-statement",
          sourceIds: ["actor-vehicle-a"],
          relatedIds: [],
          status: "reported",
          sharedAcrossBranches: true,
        },
      },
      context("add_observation"),
    );

    expect(unsupportedSource).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      caseVersion: 1,
    });
    expect(unsupportedSource.message).toContain("actor-vehicle-a");

    const unsupportedRelation = await adapter.execute(
      {
        type: "add_observation",
        actor: "agent",
        origin: "webmcp",
        requestId: "request-observation-provenance-unsupported-relation",
        expectedVersion: 1,
        payload: {
          statement: "The branch is context, but not an observation relationship type.",
          sourceType: "agent-inference",
          sourceIds: [],
          relatedIds: ["branch-baseline"],
          status: "agent-hypothesis",
          sharedAcrossBranches: true,
        },
      },
      context("add_observation"),
    );

    expect(unsupportedRelation).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      caseVersion: 1,
    });
    expect(unsupportedRelation.message).toContain("branch-baseline");

    const unknownRelation = await adapter.execute(
      {
        type: "add_observation",
        actor: "agent",
        origin: "webmcp",
        requestId: "request-observation-provenance-unknown-relation",
        expectedVersion: 1,
        payload: {
          statement: "An unknown object cannot become observation context.",
          sourceType: "agent-inference",
          sourceIds: [],
          relatedIds: ["relation-does-not-exist"],
          status: "agent-hypothesis",
          sharedAcrossBranches: true,
        },
      },
      context("add_observation"),
    );

    expect(unknownRelation).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      caseVersion: 1,
    });
    expect(unknownRelation.message).toContain("relation-does-not-exist");

    const rejected = await adapter.execute(
      {
        type: "add_observation",
        actor: "agent",
        origin: "webmcp",
        requestId: "request-observation-provenance-rejected",
        expectedVersion: 1,
        payload: {
          statement: "The agent presents a human statement as a witness statement source.",
          sourceType: "witness-statement",
          sourceIds: ["claim-initial-statement"],
          relatedIds: ["actor-vehicle-a"],
          status: "reported",
          sharedAcrossBranches: true,
        },
      },
      context("add_observation"),
    );

    expect(rejected).toMatchObject({
      ok: false,
      code: "FORBIDDEN_ACTION",
      caseVersion: 1,
      data: {
        error: {
          details: {
            sourceType: "witness-statement",
            providedSourceIds: ["claim-initial-statement"],
          },
        },
      },
    });
    expect(engine.getState()).toEqual(before);
    expect(persistCase).not.toHaveBeenCalled();

    const accepted = await adapter.execute(
      {
        type: "add_observation",
        actor: "agent",
        origin: "webmcp",
        requestId: "request-observation-provenance-accepted",
        expectedVersion: 1,
        payload: {
          statement: "The indexed image is linked to the approximate impact event.",
          sourceType: "photo",
          sourceIds: ["evidence-overview"],
          relatedIds: ["event-impact"],
          status: "uncertain",
          sharedAcrossBranches: true,
        },
      },
      context("add_observation"),
    );

    expect(accepted).toMatchObject({ ok: true, caseVersion: 2 });
    const created = engine
      .getState()
      .claims.find(
        (claim) =>
          claim.statement === "The indexed image is linked to the approximate impact event.",
      );
    expect(created).toMatchObject({
      sourceIds: ["evidence-overview"],
      linkedEvidenceIds: ["evidence-overview"],
      linkedEventIds: ["event-impact"],
    });
    expect(
      engine.getState().evidence.find((asset) => asset.id === "evidence-overview")?.linkedClaimIds,
    ).toContain(created?.id);
    expect(persistCase).toHaveBeenCalledOnce();
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

    expect(question).toMatchObject({ ok: false, code: "INVALID_INPUT", caseVersion: 1 });
    expect(question.message).toContain("cannot relate directly to evidence IDs");
    expect(question.message).toContain("evidence-overview");
    expect(fork).toMatchObject({ ok: false, code: "NOT_FOUND", caseVersion: 1 });
    expect(fork.message).toContain("evidence-does-not-exist");
    expect(engine.getState()).toEqual(before);
    expect(persistCase).not.toHaveBeenCalled();
  });

  it("returns linked context IDs so new observations and questions reveal their relationships", async () => {
    const engine = createReplayEngine(createDemoCase());
    const persistCase = vi.fn(() => Promise.resolve());
    const adapter = createReplayWebMCPAdapter(engine, requiredUiBridge(engine, persistCase));

    const observation = await adapter.execute(
      {
        type: "add_observation",
        actor: "agent",
        origin: "webmcp",
        requestId: "request-linked-observation-0001",
        expectedVersion: 1,
        payload: {
          statement: "The two recorded paths support more than one lane explanation.",
          sourceType: "agent-inference",
          sourceIds: [],
          relatedIds: ["trajectory-a-baseline", "trajectory-b-baseline"],
          status: "agent-hypothesis",
          branchId: "branch-baseline",
          sharedAcrossBranches: false,
        },
      },
      context("add_observation"),
    );
    expect(observation).toMatchObject({
      ok: true,
      caseVersion: 2,
      affectedIds: expect.arrayContaining([
        "trajectory-a-baseline",
        "trajectory-b-baseline",
        "branch-baseline",
      ]),
    });
    expect(
      engine
        .getState()
        .claims.find(
          (claim) =>
            claim.statement === "The two recorded paths support more than one lane explanation.",
        ),
    ).toMatchObject({
      sourceIds: [],
      linkedSceneObjectIds: ["trajectory-a-baseline", "trajectory-b-baseline"],
    });

    const question = await adapter.execute(
      {
        type: "create_open_question",
        actor: "agent",
        origin: "webmcp",
        requestId: "request-linked-question-0001",
        expectedVersion: 2,
        payload: {
          question: "Which path best matches the lane account?",
          reason: "The answer would distinguish the recorded alternatives.",
          importance: "blocking",
          relatedIds: ["claim-lane-change", "trajectory-a-baseline", "branch-baseline"],
        },
      },
      context("create_open_question"),
    );
    expect(question).toMatchObject({
      ok: true,
      caseVersion: 3,
      affectedIds: expect.arrayContaining([
        "claim-lane-change",
        "trajectory-a-baseline",
        "branch-baseline",
      ]),
    });
    expect(persistCase).toHaveBeenCalledTimes(2);
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

  it("separates preview completeness from final/share readiness and exposes the visible preview", async () => {
    const engine = createReplayEngine(createDemoCase());
    const before = engine.getState();
    let visiblePreview: ReturnType<typeof buildReportPreview> | undefined;
    const adapter = createReplayWebMCPAdapter(engine, {
      ...requiredUiBridge(engine),
      getReportPreview: () => visiblePreview,
      setReportPreview: (preview) => {
        visiblePreview = preview;
      },
    });

    const initialState = (await adapter.getWorkspaceState(
      ["report"],
      context("get_workspace_state"),
    )) as {
      report: { visiblePreviewStatus: string; visiblePreview: unknown };
    };
    expect(initialState.report).toMatchObject({
      visiblePreviewStatus: "none",
      visiblePreview: null,
    });

    const result = await adapter.buildReportPreview(
      { expectedVersion: before.caseVersion },
      context("build_report_preview"),
    );
    expect(result).toMatchObject({
      ok: true,
      caseVersion: before.caseVersion,
      affectedIds: ["report-preview"],
      data: {
        readiness: {
          previewRequirementsComplete: true,
          finalized: false,
          shareReady: false,
          humanActionRequired: true,
          nextRequiredAction: "human-review-acknowledgement-and-finalization",
        },
        missingRequirements: [],
        unresolvedQuestionIds: expect.arrayContaining(["question-lane-change"]),
      },
    });
    expect(result.message).toContain("not finalized or share-ready");
    expect(result.message).toContain(
      "add_report_note is now available in the next Site Tools inventory",
    );

    const reportState = (await adapter.getWorkspaceState(
      ["report"],
      context("get_workspace_state"),
    )) as {
      report: {
        notes: unknown[];
        snapshots: unknown[];
        visiblePreviewStatus: string;
        visiblePreview: ReturnType<typeof buildReportPreview>;
      };
    };
    expect(reportState.report).toMatchObject({
      notes: [],
      snapshots: [],
      visiblePreviewStatus: "transient-human-review",
      visiblePreview: {
        caseId: before.id,
        caseVersion: before.caseVersion,
        sections: expect.any(Array),
      },
    });
    reportState.report.visiblePreview.title = "Mutated tool result";
    expect(visiblePreview?.title).not.toBe("Mutated tool result");
    expect(adapter.getLifecycle().reportPreviewAvailable).toBe(true);
    expect(engine.getState()).toEqual(before);
  });

  it("labels a visible finalized snapshot separately from a transient report preview", async () => {
    const replayCase = createDemoCase();
    const createdAt = "2026-08-29T09:00:00.000Z";
    const snapshotPreview = buildReportPreview(replayCase, { generatedAt: createdAt });
    replayCase.caseVersion += 1;
    replayCase.updatedAt = createdAt;
    replayCase.reportSnapshots.push({
      id: "report-snapshot-visible-test",
      caseVersion: replayCase.caseVersion,
      createdAt,
      confirmedClaimIds: replayCase.claims
        .filter((claim) => claim.status === "confirmed")
        .map((claim) => claim.id),
      includedEvidenceIds: snapshotPreview.includedEvidenceIds,
      unresolvedQuestionIds: snapshotPreview.unresolvedQuestionIds,
      branchIds: replayCase.branches
        .filter((branch) => branch.status === "active")
        .map((branch) => branch.id),
      humanAcknowledged: true,
      immutable: true,
      preview: snapshotPreview,
    });
    const engine = createReplayEngine(replayCase);
    const before = engine.getState();
    const persistCase = vi.fn(() => Promise.resolve());
    const adapter = createReplayWebMCPAdapter(engine, {
      ...requiredUiBridge(engine, persistCase),
      getReportPreview: () => snapshotPreview,
      getSelectedReportSnapshotId: () => "report-snapshot-visible-test",
    });

    const reportState = (await adapter.getWorkspaceState(
      ["report"],
      context("get_workspace_state"),
    )) as {
      report: { visiblePreviewStatus: string; visiblePreviewSnapshotId?: string };
    };
    expect(reportState.report).toMatchObject({
      visiblePreviewStatus: "finalized-snapshot",
      visiblePreviewSnapshotId: "report-snapshot-visible-test",
    });
    expect(adapter.getLifecycle().reportPreviewAvailable).toBe(false);

    const citedClaimId = replayCase.claims[0]?.id;
    if (!citedClaimId) throw new Error("The demo must include a claim for the report-note test.");
    const rejected = await adapter.execute(
      {
        type: "add_report_note",
        actor: "agent",
        origin: "webmcp",
        requestId: "request-snapshot-note-0001",
        expectedVersion: replayCase.caseVersion,
        payload: {
          note: "Keep this cited context available for human review.",
          claimIds: [citedClaimId],
          evidenceIds: [],
        },
      },
      context("add_report_note"),
    );
    expect(rejected).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(rejected.message).toContain("Finalized snapshots and closed previews are read-only");
    expect(engine.getState()).toEqual(before);
    expect(persistCase).not.toHaveBeenCalled();
  });
});
