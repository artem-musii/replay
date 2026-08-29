import { describe, expect, it } from "vitest";

import {
  createDemoCase,
  exportReplayCase,
  getAcceptedProposalGeometryTrust,
  getActorPoseAtTime,
  getProposalDecisionTrust,
  importReplayCase,
  parseReplayCase,
  ReplayEngine,
} from "../../src/domain";

const REVIEWED_POSE_AT = { branchId: "branch-baseline", timeMs: 7_000 } as const;

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
      poseAt: REVIEWED_POSE_AT,
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
              branchId: REVIEWED_POSE_AT.branchId,
              targetTimeMs: REVIEWED_POSE_AT.timeMs,
              baseTrajectory: expect.objectContaining({
                trajectoryId: "trajectory-a-baseline",
              }),
            },
          ],
        },
      ],
    });
    const forbidden = engine.execute({
      type: "proposal.create",
      actor: "human",
      origin: "ui",
      poseAt: REVIEWED_POSE_AT,
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
    const originalActorPose = actorPose(engine, "actor-vehicle-a");
    const originalTrajectoryA = engine.state.trajectories.find(
      (candidate) => candidate.id === "trajectory-a-baseline",
    );
    if (!originalTrajectoryA) throw new Error("Missing Vehicle A demo trajectory");
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
      poseAt: REVIEWED_POSE_AT,
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
    expect(actorPose(engine, "actor-vehicle-a")).toEqual(originalActorPose);

    const acceptResult = engine.execute({
      type: "proposal.accept",
      actor: "human",
      origin: "ui",
      poseAt: REVIEWED_POSE_AT,
      expectedVersion: 2,
      proposalId: "proposal-two-actors",
      note: "Reviewed both overlays against the available scene material.",
    });

    expect(acceptResult).toMatchObject({ ok: true, caseVersion: 3 });
    expect(actorPose(engine, "actor-vehicle-a")).toEqual(originalActorPose);
    const acceptedVehicleAPose = getActorPoseAtTime(
      engine.state,
      "actor-vehicle-a",
      REVIEWED_POSE_AT.timeMs,
    );
    if (!acceptedVehicleAPose) throw new Error("Accepted Vehicle A pose is missing.");
    expect(acceptedVehicleAPose).toMatchObject({ x: 66, y: 51 });
    expect(acceptedVehicleAPose.rotationDeg).toBeCloseTo(7, 10);
    const updatedTrajectoryA = engine.state.trajectories.find(
      (candidate) => candidate.id === originalTrajectoryA.id,
    );
    expect(updatedTrajectoryA?.keyframes[0]).toEqual(originalTrajectoryA.keyframes[0]);
    expect(updatedTrajectoryA?.keyframes.at(-1)).toEqual(originalTrajectoryA.keyframes.at(-1));
    expect(updatedTrajectoryA?.keyframes.find((frame) => frame.timeMs === 7_000)).toMatchObject({
      x: 66,
      y: 51,
      rotationDeg: 7,
    });
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
    const acceptedGeometryTrust = getAcceptedProposalGeometryTrust(engine.state);
    expect(acceptedGeometryTrust.actorIds.get("actor-vehicle-a")).toBe("local-human-attested");
    expect(acceptedGeometryTrust.trajectoryIds.get("trajectory-a-baseline")).toBe(
      "local-human-attested",
    );
    expect(acceptedGeometryTrust.trajectoryIds.get("trajectory-b-baseline")).toBe(
      "local-human-attested",
    );
    const acceptedProposal = engine.state.proposals[0];
    if (!acceptedProposal) throw new Error("Accepted proposal is missing");
    expect(getProposalDecisionTrust(acceptedProposal)).toBe("local-human-attested");
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
        poseAt: REVIEWED_POSE_AT,
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
    const originalActorPose = actorPose(engine, "actor-vehicle-a");
    expect(
      engine.execute({
        type: "proposal.create",
        actor: "agent",
        origin: "webmcp",
        poseAt: REVIEWED_POSE_AT,
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
      poseAt: REVIEWED_POSE_AT,
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
    expect(actorPose(engine, "actor-vehicle-a")).toEqual(originalActorPose);
    expect(engine.state.proposals[0]?.revisions).toMatchObject([
      { revisionNumber: 1, createdBy: "agent", origin: "webmcp" },
      { revisionNumber: 2, createdBy: "human", origin: "ui", authorshipTrusted: true },
    ]);

    expect(
      engine.execute({
        type: "proposal.accept",
        actor: "human",
        origin: "ui",
        poseAt: REVIEWED_POSE_AT,
        proposalId: "proposal-adjust",
      }).ok,
    ).toBe(true);
    expect(actorPose(engine, "actor-vehicle-a")).toEqual(originalActorPose);
    const acceptedAdjustedPose = getActorPoseAtTime(
      engine.state,
      "actor-vehicle-a",
      REVIEWED_POSE_AT.timeMs,
    );
    if (!acceptedAdjustedPose) throw new Error("Accepted adjusted pose is missing.");
    expect(acceptedAdjustedPose).toMatchObject({ x: 67, y: 51 });
    expect(acceptedAdjustedPose.rotationDeg).toBeCloseTo(7, 10);
  });

  it("keeps a mixed pose adjustment bound to its original branch and time after the human scrubs", () => {
    const engine = createEngine();
    const vehicleBPath = engine.state.trajectories.find(
      (trajectory) => trajectory.id === "trajectory-b-baseline",
    );
    if (!vehicleBPath) throw new Error("Missing Vehicle B baseline trajectory.");
    const proposedVehicleBPath = vehicleBPath.keyframes.map(
      ({ id, timeMs, x, y, rotationDeg }) => ({ id, timeMs, x, y, rotationDeg }),
    );
    const preciseFrame = proposedVehicleBPath.find((keyframe) => keyframe.timeMs === 8_000);
    if (!preciseFrame) throw new Error("Missing Vehicle B 8 s keyframe.");
    preciseFrame.timeMs = 8_000.125;
    preciseFrame.x = -999_999.5;
    preciseFrame.y = 999_999.25;
    preciseFrame.rotationDeg = -999_999.75;

    expect(
      engine.execute({
        type: "proposal.create",
        actor: "agent",
        origin: "webmcp",
        poseAt: REVIEWED_POSE_AT,
        proposalId: "proposal-adjust-mixed-binding",
        title: "Mixed position and path alternative",
        rationale: "Review the pose and path together without changing their hypothesis binding.",
        changes: [
          {
            kind: "actor-pose",
            actorId: "actor-vehicle-a",
            proposedPose: { x: 999_999.125, y: -999_999.25, rotationDeg: 999_999.5 },
          },
          {
            kind: "trajectory-set",
            trajectoryId: vehicleBPath.id,
            actorId: vehicleBPath.actorId,
            branchId: vehicleBPath.branchId,
            keyframes: proposedVehicleBPath,
            visible: vehicleBPath.visible,
          },
        ],
      }).ok,
    ).toBe(true);
    expect(
      engine.execute({
        type: "hypothesis.fork",
        actor: "agent",
        origin: "webmcp",
        parentBranchId: REVIEWED_POSE_AT.branchId,
        branchId: "branch-scrubbed-during-review",
        name: "Scrubbed review branch",
        description: "A separate branch used to verify proposal adjustment binding.",
      }).ok,
    ).toBe(true);

    const firstRevision = engine.state.proposals[0]?.revisions.at(-1);
    const firstPose = firstRevision?.changes.find((change) => change.kind === "actor-pose");
    const firstPath = firstRevision?.changes.find((change) => change.kind === "trajectory-set");
    if (!firstPose || !firstPath) throw new Error("The mixed proposal revision is incomplete.");
    const untouchedPathBytes = JSON.stringify(firstPath.proposedTrajectory);
    const adjustedPose = { ...firstPose.proposedPose, x: 999_998.875 };
    const scrubbedPoseAt = {
      branchId: "branch-scrubbed-during-review",
      timeMs: 12_345.625,
    } as const;

    expect(
      engine.execute({
        type: "proposal.adjust",
        actor: "human",
        origin: "ui",
        poseAt: scrubbedPoseAt,
        proposalId: "proposal-adjust-mixed-binding",
        summary: "Attempted to move the reviewed binding.",
        changes: [
          {
            kind: "actor-pose",
            actorId: firstPose.actorId,
            branchId: scrubbedPoseAt.branchId,
            targetTimeMs: scrubbedPoseAt.timeMs,
            proposedPose: adjustedPose,
          },
        ],
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });

    const adjusted = engine.execute({
      type: "proposal.adjust",
      actor: "human",
      origin: "ui",
      poseAt: scrubbedPoseAt,
      proposalId: "proposal-adjust-mixed-binding",
      summary: "Adjusted only the proposed X coordinate after inspecting another time and branch.",
      changes: [
        {
          kind: "actor-pose",
          actorId: firstPose.actorId,
          proposedPose: adjustedPose,
        },
        {
          kind: "trajectory-set",
          trajectoryId: firstPath.trajectoryId,
          actorId: firstPath.actorId,
          branchId: firstPath.branchId,
          keyframes: firstPath.proposedTrajectory.keyframes.map(
            ({ id, timeMs, x, y, rotationDeg }) => ({ id, timeMs, x, y, rotationDeg }),
          ),
          visible: firstPath.proposedTrajectory.visible,
        },
      ],
    });
    expect(adjusted.ok).toBe(true);

    const secondRevision = engine.state.proposals[0]?.revisions.at(-1);
    const secondPose = secondRevision?.changes.find((change) => change.kind === "actor-pose");
    const secondPath = secondRevision?.changes.find((change) => change.kind === "trajectory-set");
    expect(secondPose).toMatchObject({
      branchId: REVIEWED_POSE_AT.branchId,
      targetTimeMs: REVIEWED_POSE_AT.timeMs,
      proposedPose: adjustedPose,
    });
    expect(JSON.stringify(secondPath?.proposedTrajectory)).toBe(untouchedPathBytes);

    expect(
      engine.execute({
        type: "proposal.accept",
        actor: "human",
        origin: "ui",
        poseAt: scrubbedPoseAt,
        proposalId: "proposal-adjust-mixed-binding",
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
    expect(
      engine.execute({
        type: "proposal.accept",
        actor: "human",
        origin: "ui",
        poseAt: REVIEWED_POSE_AT,
        proposalId: "proposal-adjust-mixed-binding",
      }).ok,
    ).toBe(true);
  });

  it("rejects an incomplete actor-pose review binding", () => {
    const engine = createEngine();
    expect(
      engine.execute({
        type: "proposal.create",
        actor: "agent",
        origin: "webmcp",
        poseAt: REVIEWED_POSE_AT,
        proposalId: "proposal-incomplete-binding",
        title: "Incomplete binding",
        rationale: "This malformed request should not enter the proposal history.",
        changes: [
          {
            kind: "actor-pose",
            actorId: "actor-vehicle-a",
            branchId: REVIEWED_POSE_AT.branchId,
            proposedPose: { x: 68, y: 50, rotationDeg: 6 },
          },
        ],
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
  });

  it("aborts every target mutation when any proposal baseline is stale", () => {
    const engine = createEngine();
    const originalA = actorPose(engine, "actor-vehicle-a");
    expect(
      engine.execute({
        type: "proposal.create",
        actor: "agent",
        origin: "webmcp",
        poseAt: REVIEWED_POSE_AT,
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
      poseAt: REVIEWED_POSE_AT,
      proposalId: "proposal-stale",
    });
    expect(result).toMatchObject({ ok: false, error: { code: "VERSION_CONFLICT" } });
    expect(actorPose(engine, "actor-vehicle-a")).toEqual(originalA);
    expect(engine.state.proposals[0]?.status).toBe("pending");
    expect(
      engine.state.activity.some((activity) => activity.actionType === "proposal.accept"),
    ).toBe(false);
  });

  it("rejects a pose proposal atomically when its reviewed trajectory changed", () => {
    const engine = createEngine();
    expect(
      engine.execute({
        type: "proposal.create",
        actor: "agent",
        origin: "webmcp",
        poseAt: REVIEWED_POSE_AT,
        proposalId: "proposal-stale-trajectory",
        title: "Playhead position alternative",
        rationale: "The proposed pose must stay bound to the path reviewed by the human.",
        changes: [
          {
            kind: "actor-pose",
            actorId: "actor-vehicle-a",
            proposedPose: { x: 63, y: 50, rotationDeg: 12 },
          },
        ],
      }).ok,
    ).toBe(true);
    const trajectory = engine.state.trajectories.find(
      (candidate) => candidate.id === "trajectory-a-baseline",
    );
    if (!trajectory) throw new Error("Missing Vehicle A demo trajectory");
    expect(
      engine.execute({
        type: "trajectory.set",
        actor: "human",
        origin: "ui",
        trajectoryId: trajectory.id,
        actorId: trajectory.actorId,
        branchId: trajectory.branchId,
        keyframes: trajectory.keyframes.map((keyframe) => ({
          id: keyframe.id,
          timeMs: keyframe.timeMs,
          x: keyframe.timeMs === 8_000 ? keyframe.x + 0.5 : keyframe.x,
          y: keyframe.y,
          rotationDeg: keyframe.rotationDeg,
        })),
        visible: trajectory.visible,
      }).ok,
    ).toBe(true);
    const beforeAccept = engine.state;

    const result = engine.execute({
      type: "proposal.accept",
      actor: "human",
      origin: "ui",
      poseAt: REVIEWED_POSE_AT,
      proposalId: "proposal-stale-trajectory",
    });

    expect(result).toMatchObject({ ok: false, error: { code: "VERSION_CONFLICT" } });
    expect(engine.state).toEqual(beforeAccept);
    expect(engine.state.proposals[0]?.status).toBe("pending");
  });

  it("keeps a pose proposal bound to its reviewed playhead", () => {
    const engine = createEngine();
    expect(
      engine.execute({
        type: "proposal.create",
        actor: "agent",
        origin: "webmcp",
        poseAt: REVIEWED_POSE_AT,
        proposalId: "proposal-time-bound",
        title: "Time-bound position alternative",
        rationale: "The human must accept the pose at the same time that was previewed.",
        changes: [
          {
            kind: "actor-pose",
            actorId: "actor-vehicle-a",
            proposedPose: { x: 63, y: 50, rotationDeg: 12 },
          },
        ],
      }).ok,
    ).toBe(true);
    const beforeAccept = engine.state;

    const result = engine.execute({
      type: "proposal.accept",
      actor: "human",
      origin: "ui",
      poseAt: { ...REVIEWED_POSE_AT, timeMs: REVIEWED_POSE_AT.timeMs + 100 },
      proposalId: "proposal-time-bound",
    });

    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
    expect(engine.state).toEqual(beforeAccept);
  });

  it("aborts every target mutation when any reviewed target becomes locked", () => {
    const engine = createEngine();
    const originalA = actorPose(engine, "actor-vehicle-a");
    expect(
      engine.execute({
        type: "proposal.create",
        actor: "agent",
        origin: "webmcp",
        poseAt: REVIEWED_POSE_AT,
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
      poseAt: REVIEWED_POSE_AT,
      proposalId: "proposal-locked",
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "LOCKED_ITEM", lockedItem: { id: "actor-vehicle-b" } },
    });
    expect(actorPose(engine, "actor-vehicle-a")).toEqual(originalA);
    expect(engine.state.proposals[0]?.status).toBe("pending");
  });

  it("rejects a full trajectory proposal that would create a second actor-branch path", () => {
    const engine = createEngine();
    const before = engine.state;
    const trajectory = before.trajectories.find(
      (candidate) =>
        candidate.actorId === "actor-vehicle-a" && candidate.branchId === "branch-baseline",
    );
    if (!trajectory) throw new Error("Vehicle A baseline trajectory is missing");

    const result = engine.execute({
      type: "proposal.create",
      actor: "agent",
      origin: "webmcp",
      poseAt: REVIEWED_POSE_AT,
      requestId: "proposal-request-second-trajectory",
      proposalId: "proposal-second-trajectory",
      title: "Second path must remain unambiguous",
      rationale: "A full path replacement must target the actor's existing branch trajectory.",
      changes: [
        {
          kind: "trajectory-set",
          trajectoryId: "trajectory-a-proposed-second",
          actorId: trajectory.actorId,
          branchId: trajectory.branchId,
          keyframes: trajectory.keyframes.map((keyframe, index) => ({
            id: `proposal-second-keyframe-${String(index)}`,
            timeMs: keyframe.timeMs,
            x: keyframe.x + 1,
            y: keyframe.y,
            rotationDeg: keyframe.rotationDeg,
          })),
          visible: true,
        },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_COMMAND",
        message: expect.stringContaining(`must update existing trajectory ${trajectory.id}`),
      },
    });
    expect(engine.state).toEqual(before);
  });

  it("rejects trajectory creation acceptance when the actor gained a path after review", () => {
    const engine = createEngine();
    const sourceActor = engine.state.actors.find((candidate) => candidate.id === "actor-vehicle-a");
    if (!sourceActor) throw new Error("Vehicle A is missing");
    const actor = {
      ...structuredClone(sourceActor),
      id: "actor-proposal-path-race",
      label: "Vehicle C",
      pose: { x: 40, y: 40, rotationDeg: 0 },
      locked: false,
      damageMarkers: [],
    };
    delete actor.lock;
    expect(
      engine.execute({
        type: "actor.upsert",
        actor: "human",
        origin: "ui",
        expectedVersion: 1,
        sceneActor: actor,
      }).ok,
    ).toBe(true);

    expect(
      engine.execute({
        type: "proposal.create",
        actor: "agent",
        origin: "webmcp",
        poseAt: REVIEWED_POSE_AT,
        expectedVersion: 2,
        requestId: "proposal-request-new-path",
        proposalId: "proposal-new-path",
        title: "New Vehicle C path",
        rationale: "The proposed path is reviewable only while the actor has no branch trajectory.",
        changes: [
          {
            kind: "trajectory-set",
            trajectoryId: "trajectory-c-proposed",
            actorId: actor.id,
            branchId: "branch-baseline",
            keyframes: [
              { id: "keyframe-c-proposed-start", timeMs: 0, x: 35, y: 40, rotationDeg: 0 },
              { id: "keyframe-c-proposed-end", timeMs: 16_000, ...actor.pose },
            ],
            visible: true,
          },
        ],
      }).ok,
    ).toBe(true);
    expect(engine.state.proposals[0]?.revisions[0]?.changes[0]).toMatchObject({
      kind: "trajectory-set",
      createsTrajectory: true,
      trajectoryId: "trajectory-c-proposed",
    });

    expect(
      engine.execute({
        type: "trajectory.set",
        actor: "human",
        origin: "ui",
        expectedVersion: 3,
        trajectoryId: "trajectory-c-competing",
        actorId: actor.id,
        branchId: "branch-baseline",
        keyframes: [
          { id: "keyframe-c-competing-start", timeMs: 0, x: 38, y: 40, rotationDeg: 0 },
          { id: "keyframe-c-competing-end", timeMs: 16_000, ...actor.pose },
        ],
        visible: true,
      }).ok,
    ).toBe(true);
    const beforeAccept = engine.state;

    const result = engine.execute({
      type: "proposal.accept",
      actor: "human",
      origin: "ui",
      poseAt: REVIEWED_POSE_AT,
      expectedVersion: 4,
      proposalId: "proposal-new-path",
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "VERSION_CONFLICT",
        message: expect.stringContaining(
          `gained trajectory trajectory-c-competing in branch branch-baseline`,
        ),
      },
    });
    expect(engine.state).toEqual(beforeAccept);
    expect(engine.state.proposals[0]?.status).toBe("pending");
    expect(engine.state.trajectories.some((item) => item.id === "trajectory-c-proposed")).toBe(
      false,
    );
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
        poseAt: REVIEWED_POSE_AT,
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
        poseAt: REVIEWED_POSE_AT,
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
    const importedGeometryTrust = getAcceptedProposalGeometryTrust(restored);
    expect(importedGeometryTrust.actorIds.get("actor-vehicle-a")).toBe("unverified-import");
    expect(importedGeometryTrust.trajectoryIds.get("trajectory-a-baseline")).toBe(
      "unverified-import",
    );
    const importedProposal = restored.proposals[0];
    if (!importedProposal) throw new Error("Imported proposal history is missing");
    expect(getProposalDecisionTrust(importedProposal)).toBe("unverified-import");
  });

  it("defaults proposals for schema-v2 cases saved before proposal support", () => {
    const previousV2 = structuredClone(createDemoCase()) as unknown as Record<string, unknown>;
    delete previousV2.proposals;
    expect(parseReplayCase(previousV2).proposals).toEqual([]);
  });
});
