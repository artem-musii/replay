import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { proposalAdjustmentFromForm } from "../../src/components/proposalAdjustment";
import { SceneCanvas } from "../../src/components/SceneCanvas";
import {
  createDemoCase,
  resolveProposalReviewRequest,
  type AgentProposal,
  type ProposalReviewTarget,
  type ReplayCase,
} from "../../src/domain";

function caseWithAlternativeProposal(proposalTimeMs: number): {
  replayCase: ReplayCase;
  target: ProposalReviewTarget;
} {
  const replayCase = createDemoCase();
  const baselineBranch = replayCase.branches[0];
  const baselineTrajectory = replayCase.trajectories.find(
    (trajectory) => trajectory.id === "trajectory-a-baseline",
  );
  if (!baselineBranch || !baselineTrajectory)
    throw new Error("The demo branch fixture is missing.");

  const alternativeBranchId = "branch-proposal-review";
  const alternativeTrajectory = structuredClone(baselineTrajectory);
  alternativeTrajectory.id = "trajectory-a-proposal-review";
  alternativeTrajectory.branchId = alternativeBranchId;
  alternativeTrajectory.keyframes = alternativeTrajectory.keyframes.map((keyframe) => ({
    ...keyframe,
    id: `${keyframe.id}-proposal-review`,
  }));
  replayCase.trajectories.push(alternativeTrajectory);
  replayCase.branches.push({
    ...structuredClone(baselineBranch),
    id: alternativeBranchId,
    name: "Alternative review hypothesis",
    parentBranchId: baselineBranch.id,
    trajectoryIds: [alternativeTrajectory.id],
    eventIds: [],
    claimIds: [],
  });

  const proposedKeyframes = structuredClone(alternativeTrajectory.keyframes);
  const proposedKeyframe =
    proposalTimeMs > replayCase.timeRangeMs.end
      ? proposedKeyframes.at(-1)
      : proposedKeyframes.find((keyframe) => keyframe.timeMs === 8_000);
  if (!proposedKeyframe) throw new Error("The review keyframe fixture is missing.");
  proposedKeyframe.timeMs = proposalTimeMs;
  proposedKeyframe.y += 1;
  const proposal: AgentProposal = {
    id: "proposal-review-branch-guard",
    title: "Review an alternative hypothesis path",
    rationale: "Keep the alternative branch distinct while a person reviews its geometry.",
    status: "pending",
    createdBy: "agent",
    origin: "webmcp",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    revisions: [
      {
        id: "proposal-review-revision",
        revisionNumber: 1,
        summary: "Proposed one alternative path point.",
        createdBy: "agent",
        origin: "webmcp",
        authorshipTrusted: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        changes: [
          {
            id: "proposal-review-change",
            kind: "trajectory-set",
            actorId: alternativeTrajectory.actorId,
            branchId: alternativeBranchId,
            trajectoryId: alternativeTrajectory.id,
            createsTrajectory: false,
            baseActorPose: structuredClone(
              replayCase.actors.find((actor) => actor.id === alternativeTrajectory.actorId)
                ?.pose ?? { x: 0, y: 0, rotationDeg: 0 },
            ),
            baseTrajectory: {
              keyframes: structuredClone(alternativeTrajectory.keyframes),
              visible: alternativeTrajectory.visible,
            },
            proposedTrajectory: {
              keyframes: proposedKeyframes,
              visible: alternativeTrajectory.visible,
            },
          },
        ],
      },
    ],
  };
  replayCase.proposals.push(proposal);
  const resolution = resolveProposalReviewRequest(
    {
      proposalId: proposal.id,
      revisionId: proposal.revisions[0]?.id ?? "missing",
      changeId: proposal.revisions[0]?.changes[0]?.id ?? "missing",
      branchId: alternativeBranchId,
      proposalTimeMs,
      keyframeId: proposedKeyframe.id,
    },
    {
      activeBranchId: alternativeBranchId,
      timeRangeMs: replayCase.timeRangeMs,
    },
  );
  if (!resolution.ok) throw new Error("The proposal review target did not resolve.");
  return { replayCase, target: resolution.target };
}

function sceneProps(
  replayCase: ReplayCase,
  currentTimeMs: number,
  proposalReviewTarget: ProposalReviewTarget,
): ComponentProps<typeof SceneCanvas> {
  return {
    replayCase,
    currentTimeMs,
    proposalReviewTarget,
    comparisonBranchIds: [],
    activeAgentIds: [],
    onSelect: vi.fn(),
    onSelectKeyframe: vi.fn(),
    onEditStart: vi.fn(),
    onMoveActor: vi.fn(),
    onMoveKeyframe: vi.fn(),
    onCreateTrajectory: vi.fn(),
    onMarkDamage: vi.fn(() => true),
    onMarkImpact: vi.fn(() => true),
    onToggleActorLock: vi.fn(),
    onToggleTrajectoryLock: vi.fn(),
    onToggleEventLock: vi.fn(),
    onUpdateEnvironment: vi.fn(),
  };
}

describe("proposal review scene", () => {
  it("does not leak an inactive hypothesis path or scoped ghost into the active scene", () => {
    const { replayCase, target } = caseWithAlternativeProposal(8_000.5);
    const { container, rerender } = render(
      <SceneCanvas {...sceneProps(replayCase, target.reviewTimeMs, target)} />,
    );

    expect(container.querySelectorAll(".proposal-scene-path")).toHaveLength(0);
    expect(screen.queryByTestId("proposal-scene-review")).not.toBeInTheDocument();

    const activeAlternative = structuredClone(replayCase);
    activeAlternative.activeBranchId = target.branchId;
    rerender(<SceneCanvas {...sceneProps(activeAlternative, target.reviewTimeMs, target)} />);

    expect(container.querySelectorAll(".proposal-scene-path")).toHaveLength(1);
    expect(screen.getByTestId("proposal-scene-review")).toBeVisible();
  });

  it("shows an out-of-range point at its truthful clamped review time", () => {
    const { replayCase, target } = caseWithAlternativeProposal(30_000.25);
    replayCase.activeBranchId = target.branchId;

    render(<SceneCanvas {...sceneProps(replayCase, target.reviewTimeMs, target)} />);

    expect(target.reviewTimeMs).toBe(replayCase.timeRangeMs.end);
    expect(screen.getByTestId("proposal-scene-review")).toHaveTextContent(
      `Proposed Vehicle A · point 30.0 s · viewed ${(replayCase.timeRangeMs.end / 1_000).toFixed(1)} s`,
    );
  });
});

describe("proposal exact adjustment form", () => {
  it("preserves pose binding and every untouched domain-valid number byte-for-byte", () => {
    const replayCase = createDemoCase();
    const vehicleA = replayCase.actors.find((actor) => actor.id === "actor-vehicle-a");
    const vehicleATrajectory = replayCase.trajectories.find(
      (trajectory) => trajectory.id === "trajectory-a-baseline",
    );
    const vehicleB = replayCase.actors.find((actor) => actor.id === "actor-vehicle-b");
    const vehicleBTrajectory = replayCase.trajectories.find(
      (trajectory) => trajectory.id === "trajectory-b-baseline",
    );
    if (!vehicleA || !vehicleATrajectory || !vehicleB || !vehicleBTrajectory) {
      throw new Error("The demo actors and trajectories are unavailable.");
    }
    const proposedTrajectory = structuredClone(vehicleBTrajectory.keyframes);
    const preciseFrame = proposedTrajectory.find((frame) => frame.timeMs === 8_000);
    if (!preciseFrame) throw new Error("The Vehicle B 8 s keyframe is unavailable.");
    preciseFrame.timeMs = 8_000.125;
    preciseFrame.x = -999_999.5;
    preciseFrame.y = 999_999.25;
    preciseFrame.rotationDeg = -999_999.75;
    const proposal: AgentProposal = {
      id: "proposal-exact-round-trip",
      title: "Exact round-trip",
      rationale: "Keep domain-valid proposal geometry exact during human review.",
      status: "pending",
      createdBy: "agent",
      origin: "webmcp",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      revisions: [
        {
          id: "proposal-exact-round-trip-revision",
          revisionNumber: 1,
          summary: "Mixed pose and path proposal.",
          createdBy: "agent",
          origin: "webmcp",
          authorshipTrusted: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          changes: [
            {
              id: "proposal-exact-pose-change",
              kind: "actor-pose",
              actorId: vehicleA.id,
              basePose: structuredClone(vehicleA.pose),
              proposedPose: {
                x: 999_999.125,
                y: -999_999.25,
                rotationDeg: 999_999.5,
              },
              branchId: vehicleATrajectory.branchId,
              targetTimeMs: 7_000.625,
              baseTrajectory: {
                trajectoryId: vehicleATrajectory.id,
                keyframes: structuredClone(vehicleATrajectory.keyframes),
                visible: vehicleATrajectory.visible,
              },
            },
            {
              id: "proposal-exact-trajectory-change",
              kind: "trajectory-set",
              actorId: vehicleB.id,
              branchId: vehicleBTrajectory.branchId,
              trajectoryId: vehicleBTrajectory.id,
              createsTrajectory: false,
              baseActorPose: structuredClone(vehicleB.pose),
              baseTrajectory: {
                keyframes: structuredClone(vehicleBTrajectory.keyframes),
                visible: vehicleBTrajectory.visible,
              },
              proposedTrajectory: {
                keyframes: proposedTrajectory,
                visible: vehicleBTrajectory.visible,
              },
            },
          ],
        },
      ],
    };
    const form = new FormData();
    form.set("change-0-x", "999998.875");
    form.set("change-0-y", "-999999.25");
    form.set("change-0-rotation", "999999.5");
    if (vehicleBTrajectory.visible) form.set("change-1-visible", "on");
    proposedTrajectory.forEach((frame, frameIndex) => {
      const prefix = `change-1-frame-${String(frameIndex)}`;
      form.set(`${prefix}-time`, String(frame.timeMs));
      form.set(`${prefix}-x`, String(frame.x));
      form.set(`${prefix}-y`, String(frame.y));
      form.set(`${prefix}-rotation`, String(frame.rotationDeg));
    });

    const changes = proposalAdjustmentFromForm(proposal, form);
    expect(changes[0]).toEqual({
      kind: "actor-pose",
      actorId: vehicleA.id,
      branchId: vehicleATrajectory.branchId,
      targetTimeMs: 7_000.625,
      proposedPose: {
        x: 999_998.875,
        y: -999_999.25,
        rotationDeg: 999_999.5,
      },
    });
    const expectedKeyframes = proposedTrajectory.map(({ id, timeMs, x, y, rotationDeg }) => ({
      id,
      timeMs,
      x,
      y,
      rotationDeg,
    }));
    expect(JSON.stringify(changes[1])).toBe(
      JSON.stringify({
        kind: "trajectory-set",
        trajectoryId: vehicleBTrajectory.id,
        actorId: vehicleB.id,
        branchId: vehicleBTrajectory.branchId,
        visible: vehicleBTrajectory.visible,
        keyframes: expectedKeyframes,
      }),
    );
  });
});
