import type { ActorPose, AgentProposal } from "../domain/models";

export type ProposalAdjustmentChange =
  | {
      kind: "actor-pose";
      actorId: string;
      branchId?: string;
      targetTimeMs?: number;
      proposedPose: ActorPose;
    }
  | {
      kind: "trajectory-set";
      trajectoryId: string;
      actorId: string;
      branchId: string;
      keyframes: Array<ActorPose & { id: string; timeMs: number }>;
      visible: boolean;
    };

function requiredNumber(form: FormData, name: string): number {
  const raw = form.get(name);
  const value = typeof raw === "string" && raw.trim().length > 0 ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number.`);
  return value;
}

export function proposalAdjustmentFromForm(
  proposal: AgentProposal,
  form: FormData,
): ProposalAdjustmentChange[] {
  const revision = proposal.revisions.at(-1);
  if (!revision) throw new Error(`Proposal ${proposal.id} has no revision.`);
  return revision.changes.map((change, changeIndex) => {
    if (change.kind === "actor-pose") {
      return {
        kind: "actor-pose" as const,
        actorId: change.actorId,
        ...(change.branchId && change.targetTimeMs !== undefined
          ? { branchId: change.branchId, targetTimeMs: change.targetTimeMs }
          : {}),
        proposedPose: {
          x: requiredNumber(form, `change-${String(changeIndex)}-x`),
          y: requiredNumber(form, `change-${String(changeIndex)}-y`),
          rotationDeg: requiredNumber(form, `change-${String(changeIndex)}-rotation`),
        },
      };
    }
    return {
      kind: "trajectory-set" as const,
      trajectoryId: change.trajectoryId,
      actorId: change.actorId,
      branchId: change.branchId,
      visible: form.get(`change-${String(changeIndex)}-visible`) === "on",
      keyframes: change.proposedTrajectory.keyframes.map((frame, frameIndex) => ({
        id: frame.id,
        timeMs: requiredNumber(
          form,
          `change-${String(changeIndex)}-frame-${String(frameIndex)}-time`,
        ),
        x: requiredNumber(form, `change-${String(changeIndex)}-frame-${String(frameIndex)}-x`),
        y: requiredNumber(form, `change-${String(changeIndex)}-frame-${String(frameIndex)}-y`),
        rotationDeg: requiredNumber(
          form,
          `change-${String(changeIndex)}-frame-${String(frameIndex)}-rotation`,
        ),
      })),
    };
  });
}
