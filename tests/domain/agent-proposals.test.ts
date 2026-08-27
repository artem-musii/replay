import { describe, expect, it } from "vitest";

import {
  createDemoCase,
  exportReplayCase,
  importReplayCase,
  parseReplayCase,
  ReplayEngine,
} from "../../src/domain";

function createEngine(): ReplayEngine {
  let counter = 0;
  let minute = 0;
  return new ReplayEngine(createDemoCase(), {
    now: () => `2026-08-27T10:${String(minute++).padStart(2, "0")}:00.000Z`,
    idFactory: (prefix) => `${prefix}-proposal-test-${++counter}`,
  });
}

function actorPose(engine: ReplayEngine, actorId: string) {
  const actor = engine.state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new Error(`Missing actor ${actorId}`);
  return actor.pose;
}

describe("agent proposal command workflow", () => {
  it("allows only a WebMCP agent to create a proposal and does not apply its targets", () => {
    const engine = createEngine();
    const before = actorPose(engine, "actor-vehicle-a");
    const result = engine.execute({
      type: "proposal.create",
      actor: "agent",
      origin: "webmcp",
      requestId: "proposal-request-a",
      proposalId: "proposal-position-a",
      title: "Alternative final position",
      rationale: "The scene geometry supports reviewing a nearby position as an alternative.",
      changes: [
        {
          kind: "actor-pose",
          actorId: "actor-vehicle-a",
          proposedPose: { x: 68, y: 52, rotationDeg: 8 },
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      affectedIds: expect.arrayContaining(["proposal-position-a", "actor-vehicle-a"]),
    });
    expect(actorPose(engine, "actor-vehicle-a")).toEqual(before);
    expect(engine.state.proposals[0]).toMatchObject({
      id: "proposal-position-a",
      status: "pending",
      createdBy: "agent",
      origin: "webmcp",
      revisions: [
        {
          revisionNumber: 1,
          createdBy: "agent",
          origin: "webmcp",
          authorshipTrusted: true,
          changes: [
            {
              kind: "actor-pose",
              basePose: before,
              proposedPose: { x: 68, y: 52, rotationDeg: 8 },
            },
          ],
        },
      ],
    });

    const forbidden = engine.execute({
      type: "proposal.create",
      actor: "human",
      origin: "ui",
      title: "Human-created proposal",
      rationale: "This command must remain agent-originated.",
      changes: [
        {
          kind: "actor-pose",
          actorId: "actor-vehicle-b",
          proposedPose: { x: 58, y: 63, rotationDeg: 88 },
        },
      ],
    });
    expect(forbidden).toMatchObject({ ok: false, error: { code: "FORBIDDEN_ACTION" } });
  });

  it("accepts a multi-object proposal atomically through a human UI decision", () => {
    const engine = createEngine();
    const trajectory = engine.state.trajectories.find(
      (candidate) => candidate.id === "trajectory-b-baseline",
    );
    if (!trajectory) throw new Error("Missing demo trajectory");
    const proposedKeyframes = trajectory.keyframes.map((keyframe, index) => ({
      id: `proposal-b-keyframe-${index}`,
      timeMs: keyframe.timeMs,
      x: keyframe.x + 2,
      y: keyframe.y + 1,
      rotationDeg: keyframe.rotationDeg,
    }));
    const createResult = engine.execute({
      type: "proposal.create",
      actor: "agent",
      origin: "webmcp",
      proposalId: "proposal-two-actors",
      title: "Two-vehicle geometry alternative",
      rationale: "This alternative keeps both proposed positions visibly reviewable before use.",
      changes: [
        {
          kind: "actor-pose",
          actorId: "actor-vehicle-a",
          proposedPose: { x: 66, y: 51, rotationDeg: 7 },
        },
        {
          kind: "trajectory-set",
          trajectoryId: trajectory.id,
          actorId: trajectory.actorId,
          branchId: trajectory.branchId,
          keyframes: proposedKeyframes,
          visible: true,
        },
      ],
    });
    expect(createResult.ok).toBe(true);
    expect(actorPose(engine, "actor-vehicle-a")).toEqual({ x: 74, y: 54, rotationDeg: 5 });

    const acceptResult = engine.execute({
      type: "proposal.accept",
      actor: "human",
      origin: "ui",
      expectedVersion: 2,
      proposalId: "proposal-two-actors",
      note: "Reviewed both overlays against the available scene material.",
    });

    expect(acceptResult).toMatchObject({ ok: true, caseVersion: 3 });
    expect(actorPose(engine, "actor-vehicle-a")).toEqual({ x: 66, y: 51, rotationDeg: 7 });
    expect(actorPose(engine, "actor-vehicle-b")).toEqual({
      x: proposedKeyframes.at(-1)?.x,
      y: proposedKeyframes.at(-1)?.y,
      rotationDeg: proposedKeyframes.at(-1)?.rotationDeg,
    });
    expect(engine.state.proposals[0]).toMatchObject({
      status: "accepted",
      decision: {
        outcome: "accepted",
        decidedBy: "human",
        origin: "ui",
        humanAttestationTrusted: true,
      },
    });
    const activity = engine.state.activity.find(
      (candidate) => candidate.actionType === "proposal.accept",
    );
    expect(activity).toMatchObject({
      author: "human",
      origin: "ui",
      affectedIds: expect.arrayContaining([
        "proposal-two-actors",
        "actor-vehicle-a",
        "actor-vehicle-b",
        "trajectory-b-baseline",
        "branch-baseline",
      ]),
    });
    expect(activity?.classification).toBeUndefined();
  });

  it("rejects without applying and forbids agent decisions", () => {
    const engine = createEngine();
    const before = actorPose(engine, "actor-vehicle-a");
    expect(
      engine.execute({
        type: "proposal.create",
        actor: "agent",
        origin: "webmcp",
        proposalId: "proposal-reject",
        title: "Position alternative for review",
        rationale: "This nearby position is an alternative, not a factual conclusion.",
        changes: [
          {
            kind: "actor-pose",
            actorId: "actor-vehicle-a",
            proposedPose: { x: 70, y: 54, rotationDeg: 10 },
          },
        ],
      }).ok,
    ).toBe(true);

    const forbidden = engine.execute({
      type: "proposal.reject",
      actor: "agent",
      origin: "webmcp",
      proposalId: "proposal-reject",
    });
    expect(forbidden).toMatchObject({ ok: false, error: { code: "FORBIDDEN_ACTION" } });

    const rejected = engine.execute({
      type: "proposal.reject",
      actor: "human",
      origin: "ui",
      proposalId: "proposal-reject",
      note: "The overlay does not align with the reviewed final-position photograph.",
    });
    expect(rejected.ok).toBe(true);
    expect(actorPose(engine, "actor-vehicle-a")).toEqual(before);
    expect(engine.state.proposals[0]).toMatchObject({
      status: "rejected",
      decision: { outcome: "rejected", humanAttestationTrusted: true },
    });
    expect(engine.state.activity.at(-1)).toMatchObject({
      actionType: "proposal.reject",
      affectedIds: expect.arrayContaining(["proposal-reject", "actor-vehicle-a"]),
    });
  });

  it("preserves a human manual adjustment as a new revision before acceptance", () => {
    const engine = createEngine();
    expect(
      engine.execute({
        type: "proposal.create",
        actor: "agent",
        origin: "webmcp",
        proposalId: "proposal-adjust",
        title: "Vehicle A position alternative",
        rationale: "A nearby alternative may better align with the scene layout.",
        changes: [
          {
            kind: "actor-pose",
            actorId: "actor-vehicle-a",
            proposedPose: { x: 68, y: 50, rotationDeg: 6 },
          },
        ],
      }).ok,
    ).toBe(true);
    const adjusted = engine.execute({
      type: "proposal.adjust",
      actor: "human",
      origin: "ui",
      proposalId: "proposal-adjust",
      summary: "Aligned the preview with the photographed road marking.",
      changes: [
        {
          kind: "actor-pose",
          actorId: "actor-vehicle-a",
          proposedPose: { x: 67, y: 51, rotationDeg: 7 },
        },
      ],
    });
    expect(adjusted.ok).toBe(true);
    expect(actorPose(engine, "actor-vehicle-a")).toEqual({ x: 74, y: 54, rotationDeg: 5 });
    expect(engine.state.proposals[0]?.revisions).toMatchObject([
      { revisionNumber: 1, createdBy: "agent", origin: "webmcp" },
      { revisionNumber: 2, createdBy: "human", origin: "ui", authorshipTrusted: true },
    ]);

    expect(
      engine.execute({
        type: "proposal.accept",
        actor: "human",
        origin: "ui",
        proposalId: "proposal-adjust",
      }).ok,
    ).toBe(true);
    expect(actorPose(engine, "actor-vehicle-a")).toEqual({ x: 67, y: 51, rotationDeg: 7 });
  });

  it("aborts every target mutation when any proposal baseline is stale", () => {
    const engine = createEngine();
    const originalA = actorPose(engine, "actor-vehicle-a");
    expect(
      engine.execute({
        type: "proposal.create",
        actor: "agent",
        origin: "webmcp",
        proposalId: "proposal-stale",
        title: "Two-position alternative",
        rationale: "Both positions must be reviewed and accepted as one coherent alternative.",
        changes: [
          {
            kind: "actor-pose",
            actorId: "actor-vehicle-a",
            proposedPose: { x: 70, y: 55, rotationDeg: 10 },
          },
          {
            kind: "actor-pose",
            actorId: "actor-vehicle-b",
            proposedPose: { x: 60, y: 64, rotationDeg: 90 },
          },
        ],
      }).ok,
    ).toBe(true);
    expect(
      engine.execute({
        type: "actor.update-pose",
        actor: "human",
        origin: "ui",
        actorId: "actor-vehicle-b",
        pose: { x: 58, y: 62, rotationDeg: 88 },
      }).ok,
    ).toBe(true);

    const result = engine.execute({
      type: "proposal.accept",
      actor: "human",
      origin: "ui",
      proposalId: "proposal-stale",
    });
    expect(result).toMatchObject({ ok: false, error: { code: "VERSION_CONFLICT" } });
    expect(actorPose(engine, "actor-vehicle-a")).toEqual(originalA);
    expect(engine.state.proposals[0]?.status).toBe("pending");
    expect(
      engine.state.activity.some((activity) => activity.actionType === "proposal.accept"),
    ).toBe(false);
  });

  it("aborts every target mutation when any reviewed target becomes locked", () => {
    const engine = createEngine();
    const originalA = actorPose(engine, "actor-vehicle-a");
    expect(
      engine.execute({
        type: "proposal.create",
        actor: "agent",
        origin: "webmcp",
        proposalId: "proposal-locked",
        title: "Lock-sensitive position alternative",
        rationale: "Both positions are offered together for explicit human review.",
        changes: [
          {
            kind: "actor-pose",
            actorId: "actor-vehicle-a",
            proposedPose: { x: 69, y: 53, rotationDeg: 9 },
          },
          {
            kind: "actor-pose",
            actorId: "actor-vehicle-b",
            proposedPose: { x: 59, y: 63, rotationDeg: 89 },
          },
        ],
      }).ok,
    ).toBe(true);
    expect(
      engine.execute({
        type: "lock.set",
        actor: "human",
        origin: "ui",
        targetType: "actor",
        targetId: "actor-vehicle-b",
        locked: true,
        reason: "Final position is under manual review.",
      }).ok,
    ).toBe(true);

    const result = engine.execute({
      type: "proposal.accept",
      actor: "human",
      origin: "ui",
      proposalId: "proposal-locked",
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "LOCKED_ITEM", lockedItem: { id: "actor-vehicle-b" } },
    });
    expect(actorPose(engine, "actor-vehicle-a")).toEqual(originalA);
    expect(engine.state.proposals[0]?.status).toBe("pending");
  });
});

describe("proposal persistence trust boundaries", () => {
  it("preserves unsigned proposal decisions as inspectable but untrusted history", () => {
    const engine = createEngine();
    expect(
      engine.execute({
        type: "proposal.create",
        actor: "agent",
        origin: "webmcp",
        proposalId: "proposal-imported",
        title: "Imported position alternative",
        rationale: "This position remains an explicitly proposed alternative.",
        changes: [
          {
            kind: "actor-pose",
            actorId: "actor-vehicle-a",
            proposedPose: { x: 65, y: 50, rotationDeg: 6 },
          },
        ],
      }).ok,
    ).toBe(true);
    expect(
      engine.execute({
        type: "proposal.accept",
        actor: "human",
        origin: "ui",
        proposalId: "proposal-imported",
      }).ok,
    ).toBe(true);

    const restored = importReplayCase(exportReplayCase(engine.state), {
      now: "2026-08-27T13:00:00.000Z",
    });
    expect(restored.proposals[0]).toMatchObject({
      status: "accepted",
      decision: { outcome: "accepted", humanAttestationTrusted: false },
      revisions: [{ authorshipTrusted: false }],
    });
  });

  it("defaults proposals for schema-v2 cases saved before proposal support", () => {
    const previousV2 = structuredClone(createDemoCase()) as unknown as Record<string, unknown>;
    delete previousV2.proposals;
    expect(parseReplayCase(previousV2).proposals).toEqual([]);
  });
});
