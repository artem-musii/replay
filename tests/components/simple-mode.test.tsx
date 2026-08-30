import { describe, expect, it } from "vitest";

import { isProposalStale, simpleStageForCase } from "../../src/components/simpleWorkspaceState";
import { createDemoCase, type AgentProposal } from "../../src/domain";
import { buildSimpleAgentReviewPrompt } from "../../src/webmcp/prompts";

function pendingProposal(): AgentProposal {
  const replayCase = createDemoCase();
  const trajectory = replayCase.trajectories[0];
  if (!trajectory) throw new Error("Demo trajectory missing.");
  return {
    id: "proposal-simple-test",
    title: "Review one path",
    rationale: "Keep the alternative separate.",
    status: "pending",
    createdBy: "agent",
    origin: "webmcp",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    revisions: [
      {
        id: "proposal-simple-test-revision",
        revisionNumber: 1,
        summary: "Move one interior point.",
        createdBy: "agent",
        origin: "webmcp",
        authorshipTrusted: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        changes: [
          {
            id: "proposal-simple-test-change",
            kind: "trajectory-set",
            actorId: trajectory.actorId,
            branchId: trajectory.branchId,
            trajectoryId: trajectory.id,
            createsTrajectory: false,
            baseActorPose: structuredClone(
              replayCase.actors[0]?.pose ?? { x: 0, y: 0, rotationDeg: 0 },
            ),
            baseTrajectory: {
              keyframes: structuredClone(trajectory.keyframes),
              visible: trajectory.visible,
            },
            proposedTrajectory: {
              keyframes: trajectory.keyframes.map((keyframe, index) =>
                index === 1 ? { ...keyframe, y: keyframe.y + 0.01 } : { ...keyframe },
              ),
              visible: trajectory.visible,
            },
          },
        ],
      },
    ],
  };
}

describe("Simple mode state", () => {
  it("keeps copied requests on native Site Tools and forbids computer control", () => {
    const prompt = buildSimpleAgentReviewPrompt("Which vehicle crossed the lane boundary?");
    expect(prompt).toContain("native Site Tools (WebMCP)");
    expect(prompt).toContain("Do not use computer use or browser UI controls");
    expect(prompt).toContain("do not click, type, scroll, inspect screenshots");
    expect(prompt).toContain("If the page's Site Tools are not available, stop");
    expect(prompt).toContain('review this unresolved question: "Which vehicle crossed');
    expect(prompt).toContain("create the smallest reversible scene proposal");
  });

  it("moves from review to decide to report without storing a second workflow state", () => {
    const replayCase = createDemoCase();
    expect(simpleStageForCase(replayCase)).toBe("review");
    const proposal = pendingProposal();
    replayCase.proposals.push(proposal);
    expect(simpleStageForCase(replayCase)).toBe("decide");
    proposal.status = "rejected";
    proposal.decision = {
      outcome: "rejected",
      revisionId: proposal.revisions[0]?.id ?? "missing",
      decidedBy: "human",
      origin: "ui",
      decidedAt: "2026-01-01T00:01:00.000Z",
      humanAttestationTrusted: true,
    };
    expect(simpleStageForCase(replayCase)).toBe("report");
  });

  it("marks a pending proposal stale when its reviewed baseline changes", () => {
    const replayCase = createDemoCase();
    const proposal = pendingProposal();
    replayCase.proposals.push(proposal);
    expect(isProposalStale(replayCase, proposal)).toBe(false);
    const targetId = proposal.revisions[0]?.changes[0];
    if (targetId?.kind !== "trajectory-set") throw new Error("Proposal fixture invalid.");
    const reviewedTrajectory = replayCase.trajectories.find(
      (candidate) => candidate.id === targetId.trajectoryId,
    );
    if (!reviewedTrajectory?.keyframes[1]) throw new Error("Reviewed trajectory missing.");
    reviewedTrajectory.keyframes[1].y += 0.02;
    expect(isProposalStale(replayCase, proposal)).toBe(true);
  });
});
