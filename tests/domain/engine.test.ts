import { describe, expect, it } from "vitest";

import { createDemoCase, ReplayEngine } from "../../src/domain";

function createEngine(): ReplayEngine {
  let counter = 0;
  return new ReplayEngine(createDemoCase(), {
    now: () => "2026-08-27T10:00:00.000Z",
    idFactory: (prefix) => `${prefix}-test-${++counter}`,
  });
}

describe("ReplayEngine command guarantees", () => {
  it("increments every successful mutation and applies a request ID only once", () => {
    const engine = createEngine();
    const command = {
      type: "actor.update-pose",
      actor: "agent",
      origin: "webmcp",
      expectedVersion: 1,
      requestId: "request-move-a",
      actorId: "actor-vehicle-a",
      pose: { x: 65, y: 49, rotationDeg: 6 },
    } as const;

    const first = engine.execute(command);
    const retry = engine.execute(command);

    expect(first).toMatchObject({ ok: true, caseVersion: 2, idempotent: false });
    expect(retry).toMatchObject({ ok: true, caseVersion: 2, idempotent: true });
    expect(
      engine.state.activity.filter((event) => event.requestId === "request-move-a"),
    ).toHaveLength(1);
  });

  it("rejects stale versions without changing state", () => {
    const engine = createEngine();
    const result = engine.execute({
      type: "actor.update-pose",
      actor: "agent",
      origin: "webmcp",
      expectedVersion: 0,
      requestId: "request-stale",
      actorId: "actor-vehicle-a",
      pose: { x: 99, y: 99, rotationDeg: 0 },
    });
    expect(result).toMatchObject({
      ok: false,
      caseVersion: 1,
      error: { code: "VERSION_CONFLICT" },
    });
    expect(engine.state.actors.find((actor) => actor.id === "actor-vehicle-a")?.pose.x).toBe(64);
  });

  it("returns a structured lock error and leaves locked geometry untouched", () => {
    const engine = createEngine();
    expect(
      engine.execute({
        type: "lock.set",
        actor: "human",
        origin: "ui",
        expectedVersion: 1,
        targetType: "actor",
        targetId: "actor-vehicle-b",
        locked: true,
        reason: "Final position reviewed against the photograph",
      }).ok,
    ).toBe(true);

    const result = engine.execute({
      type: "actor.update-pose",
      actor: "agent",
      origin: "webmcp",
      expectedVersion: 2,
      requestId: "request-move-locked",
      actorId: "actor-vehicle-b",
      pose: { x: 50, y: 50, rotationDeg: 0 },
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "LOCKED_ITEM",
        lockedItem: {
          id: "actor-vehicle-b",
          lockedBy: "human",
          reason: "Final position reviewed against the photograph",
        },
      },
    });
    expect(engine.state.caseVersion).toBe(2);
    expect(engine.state.actors.find((actor) => actor.id === "actor-vehicle-b")?.pose).toMatchObject(
      { x: 57, y: 62 },
    );
  });

  it("enforces human-only confirmation in the domain layer", () => {
    const engine = createEngine();
    const agentResult = engine.execute({
      type: "claim.confirm",
      actor: "agent",
      origin: "webmcp",
      requestId: "request-confirm",
      expectedVersion: 1,
      claimId: "claim-initial-statement",
    });
    expect(agentResult).toMatchObject({
      ok: false,
      error: { code: "HUMAN_CONFIRMATION_REQUIRED" },
    });

    const humanResult = engine.execute({
      type: "claim.confirm",
      actor: "human",
      origin: "ui",
      expectedVersion: 1,
      claimId: "claim-initial-statement",
    });
    expect(humanResult.ok).toBe(true);
    expect(
      engine.state.claims.find((claim) => claim.id === "claim-initial-statement"),
    ).toMatchObject({
      status: "confirmed",
      humanConfirmed: true,
    });
  });

  it("prohibits agent finalization even with complete acknowledgement payload", () => {
    const engine = createEngine();
    const result = engine.execute({
      type: "report.finalize",
      actor: "agent",
      origin: "webmcp",
      requestId: "request-finalize",
      expectedVersion: 1,
      unresolvedQuestionsReviewed: true,
      limitationsAcknowledged: true,
      confirmedFactsReviewed: true,
      manualConfirmation: true,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_FINALIZATION_FORBIDDEN" } });
    expect(engine.state.reportSnapshots).toHaveLength(0);
  });

  it("checks cancellation before the atomic commit", () => {
    const engine = createEngine();
    const controller = new AbortController();
    controller.abort("test cancellation");
    const result = engine.execute(
      {
        type: "actor.update-pose",
        actor: "human",
        origin: "ui",
        actorId: "actor-vehicle-a",
        pose: { x: 20, y: 20, rotationDeg: 20 },
      },
      { signal: controller.signal },
    );
    expect(result).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
    expect(engine.state.caseVersion).toBe(1);
  });

  it("allows an agent pose upsert to preserve unchanged confirmed damage", () => {
    const engine = createEngine();
    const actor = engine.state.actors.find((candidate) => candidate.id === "actor-vehicle-a");
    expect(actor).toBeDefined();
    if (!actor) throw new Error("Demo actor is missing");
    const result = engine.execute({
      type: "actor.upsert",
      actor: "agent",
      origin: "webmcp",
      expectedVersion: 1,
      requestId: "agent-upsert-a",
      sceneActor: {
        ...actor,
        pose: { x: 63, y: 49, rotationDeg: 4 },
      },
    });
    expect(result.ok).toBe(true);
    expect(
      engine.state.actors.find((candidate) => candidate.id === actor.id)?.damageMarkers,
    ).toEqual(actor.damageMarkers);
  });

  it("does not report failure after a UI subscriber throws post-commit", () => {
    const engine = createEngine();
    engine.subscribe(() => {
      throw new Error("render failed");
    });
    const result = engine.execute({
      type: "actor.update-pose",
      actor: "human",
      origin: "ui",
      actorId: "actor-vehicle-a",
      pose: { x: 65, y: 49, rotationDeg: 5 },
    });
    expect(result).toMatchObject({ ok: true, caseVersion: 2 });
    expect(engine.state.caseVersion).toBe(2);
  });

  it("records deterministic issue changes as system validation activity", () => {
    const engine = createEngine();
    expect(
      engine.execute({
        type: "actor.update-pose",
        actor: "human",
        origin: "ui",
        actorId: "actor-vehicle-a",
        pose: { x: 150, y: 49, rotationDeg: 5 },
      }).ok,
    ).toBe(true);
    const systemActivity = engine.state.activity.find(
      (activity) => activity.caseVersion === 2 && activity.actionType === "consistency.updated",
    );
    expect(systemActivity).toMatchObject({
      author: "system",
      origin: "system",
      undoable: false,
    });
    expect(systemActivity?.summary).toContain("detected");
  });
});

describe("command history", () => {
  it("undoes and redoes mutations while retaining an accurate activity feed", () => {
    const engine = createEngine();
    engine.execute({
      type: "actor.update-pose",
      actor: "human",
      origin: "ui",
      actorId: "actor-vehicle-a",
      pose: { x: 70, y: 50, rotationDeg: 10 },
    });
    expect(engine.canUndo).toBe(true);

    const undo = engine.undo();
    expect(undo).toMatchObject({ ok: true, caseVersion: 3 });
    expect(engine.state.actors.find((actor) => actor.id === "actor-vehicle-a")?.pose.x).toBe(64);
    expect(engine.state.activity.some((event) => event.actionType === "history.undo")).toBe(true);

    const redo = engine.redo();
    expect(redo).toMatchObject({ ok: true, caseVersion: 4 });
    expect(engine.state.actors.find((actor) => actor.id === "actor-vehicle-a")?.pose.x).toBe(70);
    expect(engine.state.activity.some((event) => event.actionType === "history.redo")).toBe(true);
  });

  it("reverts an agent request only while it is the latest safe action", () => {
    const engine = createEngine();
    engine.execute({
      type: "actor.update-pose",
      actor: "agent",
      origin: "webmcp",
      requestId: "agent-action-1",
      actorId: "actor-vehicle-a",
      pose: { x: 66, y: 50, rotationDeg: 5 },
    });
    expect(
      engine.revertAgentAction("agent-action-1", {
        actor: "agent",
        origin: "webmcp",
        requestId: "agent-revert-1",
      }).ok,
    ).toBe(true);

    engine.execute({
      type: "actor.update-pose",
      actor: "agent",
      origin: "webmcp",
      requestId: "agent-action-2",
      actorId: "actor-vehicle-a",
      pose: { x: 67, y: 50, rotationDeg: 5 },
    });
    engine.execute({
      type: "actor.update-pose",
      actor: "human",
      origin: "ui",
      actorId: "actor-vehicle-b",
      pose: { x: 58, y: 62, rotationDeg: 88 },
    });
    expect(engine.revertAgentAction("agent-action-2")).toMatchObject({
      ok: false,
      error: { code: "UNSAFE_REVERT" },
    });
  });
});
