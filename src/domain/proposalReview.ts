import type { ActorKeyframe, AgentProposalTrajectoryChange, EnvironmentState } from "./models";
import { clampTimeToRange } from "./interpolation";

export interface ProposalReviewRequest {
  proposalId: string;
  revisionId: string;
  changeId: string;
  branchId: string;
  /** Timestamp authored on the proposal change before timeline normalization. */
  proposalTimeMs: number;
  keyframeId?: string;
}

export interface ProposalReviewTarget extends ProposalReviewRequest {
  /** Playhead timestamp after millisecond normalization and case-range clamping. */
  reviewTimeMs: number;
}

export type ProposalReviewResolution =
  | { ok: true; target: ProposalReviewTarget }
  | {
      ok: false;
      code: "BRANCH_MISMATCH";
      activeBranchId: string;
      proposalBranchId: string;
    };

/**
 * Resolves a transient human-review request without changing the canonical case.
 * A proposal must be reviewed in its own active hypothesis, while the playhead
 * uses the same integer/clamped semantics as every other workspace time change.
 */
export function resolveProposalReviewRequest(
  request: ProposalReviewRequest,
  context: {
    activeBranchId: string;
    timeRangeMs: { start: number; end: number };
  },
): ProposalReviewResolution {
  if (request.branchId !== context.activeBranchId) {
    return {
      ok: false,
      code: "BRANCH_MISMATCH",
      activeBranchId: context.activeBranchId,
      proposalBranchId: request.branchId,
    };
  }
  return {
    ok: true,
    target: {
      ...request,
      reviewTimeMs: clampTimeToRange(request.proposalTimeMs, context.timeRangeMs),
    },
  };
}
import { createSceneMetricCalibration, normalizedScenePointToMeters } from "./physics";

export type ProposalKeyframeDeltaKind = "modified" | "added" | "removed";

export interface ProposalKeyframeDelta {
  keyframeId: string;
  kind: ProposalKeyframeDeltaKind;
  /** The proposed time when available, otherwise the removed baseline time. */
  reviewTimeMs: number;
  baseKeyframe?: ActorKeyframe | undefined;
  proposedKeyframe?: ActorKeyframe | undefined;
  baseXMeters?: number | undefined;
  baseYMeters?: number | undefined;
  proposedXMeters?: number | undefined;
  proposedYMeters?: number | undefined;
  deltaXMeters?: number | undefined;
  deltaYMeters?: number | undefined;
  deltaRotationDeg?: number | undefined;
}

export interface ProposalTrajectoryDiff {
  keyframeDeltas: ProposalKeyframeDelta[];
  visibilityChanged: boolean;
  endpointsPreserved: boolean;
}

function shortestSignedAngleDelta(fromDegrees: number, toDegrees: number): number {
  const normalizedDifference = (toDegrees - fromDegrees) % 360;
  const delta = ((normalizedDifference + 540) % 360) - 180;
  return Object.is(delta, -0) ? 0 : delta;
}

function sameEndpoint(left: ActorKeyframe, right: ActorKeyframe): boolean {
  return (
    left.timeMs === right.timeMs &&
    left.x === right.x &&
    left.y === right.y &&
    shortestSignedAngleDelta(left.rotationDeg, right.rotationDeg) === 0
  );
}

/**
 * Builds a stable-ID diff for human proposal review. This mirrors the reducer's
 * exact field comparison so every stored trajectory change remains visible,
 * while coordinates are converted through the case's declared calibration.
 */
export function diffProposalTrajectory(
  change: AgentProposalTrajectoryChange,
  environment: EnvironmentState,
): ProposalTrajectoryDiff {
  const baseKeyframes = change.baseTrajectory?.keyframes ?? [];
  const proposedKeyframes = change.proposedTrajectory.keyframes;
  const baseById = new Map(baseKeyframes.map((keyframe) => [keyframe.id, keyframe]));
  const proposedById = new Map(proposedKeyframes.map((keyframe) => [keyframe.id, keyframe]));
  const calibration = createSceneMetricCalibration({
    sceneBounds: environment.bounds,
    widthMeters: environment.calibration.widthMeters,
    heightMeters: environment.calibration.heightMeters,
  });
  const keyframeDeltas: ProposalKeyframeDelta[] = [];

  for (const proposedKeyframe of proposedKeyframes) {
    const baseKeyframe = baseById.get(proposedKeyframe.id);
    if (!baseKeyframe) {
      const proposedMetric = normalizedScenePointToMeters(proposedKeyframe, calibration);
      keyframeDeltas.push({
        keyframeId: proposedKeyframe.id,
        kind: "added",
        reviewTimeMs: proposedKeyframe.timeMs,
        proposedKeyframe,
        proposedXMeters: proposedMetric.xM,
        proposedYMeters: proposedMetric.yM,
      });
      continue;
    }
    if (
      baseKeyframe.actorId === proposedKeyframe.actorId &&
      baseKeyframe.timeMs === proposedKeyframe.timeMs &&
      baseKeyframe.x === proposedKeyframe.x &&
      baseKeyframe.y === proposedKeyframe.y &&
      baseKeyframe.rotationDeg === proposedKeyframe.rotationDeg
    ) {
      continue;
    }
    const baseMetric = normalizedScenePointToMeters(baseKeyframe, calibration);
    const proposedMetric = normalizedScenePointToMeters(proposedKeyframe, calibration);
    keyframeDeltas.push({
      keyframeId: proposedKeyframe.id,
      kind: "modified",
      reviewTimeMs: proposedKeyframe.timeMs,
      baseKeyframe,
      proposedKeyframe,
      baseXMeters: baseMetric.xM,
      baseYMeters: baseMetric.yM,
      proposedXMeters: proposedMetric.xM,
      proposedYMeters: proposedMetric.yM,
      deltaXMeters: proposedMetric.xM - baseMetric.xM,
      deltaYMeters: proposedMetric.yM - baseMetric.yM,
      deltaRotationDeg: shortestSignedAngleDelta(
        baseKeyframe.rotationDeg,
        proposedKeyframe.rotationDeg,
      ),
    });
  }

  for (const baseKeyframe of baseKeyframes) {
    if (proposedById.has(baseKeyframe.id)) continue;
    const baseMetric = normalizedScenePointToMeters(baseKeyframe, calibration);
    keyframeDeltas.push({
      keyframeId: baseKeyframe.id,
      kind: "removed",
      reviewTimeMs: baseKeyframe.timeMs,
      baseKeyframe,
      baseXMeters: baseMetric.xM,
      baseYMeters: baseMetric.yM,
    });
  }

  keyframeDeltas.sort(
    (left, right) =>
      left.reviewTimeMs - right.reviewTimeMs || left.keyframeId.localeCompare(right.keyframeId),
  );

  const baseFirst = baseKeyframes[0];
  const baseLast = baseKeyframes.at(-1);
  const proposedFirst = proposedKeyframes[0];
  const proposedLast = proposedKeyframes.at(-1);
  return {
    keyframeDeltas,
    visibilityChanged:
      change.baseTrajectory !== undefined &&
      change.baseTrajectory.visible !== change.proposedTrajectory.visible,
    endpointsPreserved: Boolean(
      baseFirst &&
      baseLast &&
      proposedFirst &&
      proposedLast &&
      sameEndpoint(baseFirst, proposedFirst) &&
      sameEndpoint(baseLast, proposedLast),
    ),
  };
}
