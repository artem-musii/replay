import { describe, expect, it } from "vitest";

import { createDemoCase, getWorkspaceState, ReplayEngine } from "../../src/domain";

describe("workspace selectors", () => {
  it("includes the complete proposal ledger in the compact hypotheses projection", () => {
    let idCounter = 0;
    const engine = new ReplayEngine(createDemoCase(), {
      now: () => "2026-08-28T12:00:00.000Z",
      idFactory: (prefix) => `${prefix}-selector-test-${++idCounter}`,
    });

    const createResult = engine.execute({
      type: "proposal.create",
      actor: "agent",
      origin: "webmcp",
      poseAt: { branchId: "branch-baseline", timeMs: 7_000 },
      requestId: "selector-proposal-request",
      proposalId: "proposal-selector-test",
      title: "Reviewable position alternative",
      rationale: "The proposal should remain visible with its complete review history.",
      changes: [
        {
          kind: "actor-pose",
          actorId: "actor-vehicle-a",
          proposedPose: { x: 68, y: 52, rotationDeg: 8 },
        },
      ],
    });
    expect(createResult.ok).toBe(true);

    const rejectResult = engine.execute({
      type: "proposal.reject",
      actor: "human",
      origin: "ui",
      expectedVersion: engine.state.caseVersion,
      proposalId: "proposal-selector-test",
    });
    expect(rejectResult.ok).toBe(true);

    const projection = getWorkspaceState(engine.state, "hypotheses") as {
      activeBranchId: string;
      branches: unknown[];
      proposals: typeof engine.state.proposals;
    };

    expect(Object.keys(projection).sort()).toEqual(["activeBranchId", "branches", "proposals"]);
    expect(projection.proposals).toEqual(engine.state.proposals);
    expect(projection.proposals).not.toBe(engine.state.proposals);
    expect(projection.proposals[0]).toMatchObject({
      id: "proposal-selector-test",
      status: "rejected",
      revisions: [
        expect.objectContaining({
          revisionNumber: 1,
          createdBy: "agent",
          origin: "webmcp",
        }),
      ],
      decision: expect.objectContaining({
        outcome: "rejected",
        decidedBy: "human",
        origin: "ui",
      }),
    });
  });
});
