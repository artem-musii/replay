import type { ActivityEvent, ClaimStatus, ReplayCase, WorkspaceMode } from "./models";
import { rankOpenQuestions } from "./reducer";

export interface ReplayCaseSummary {
  id: string;
  title: string;
  caseVersion: number;
  schemaVersion: number;
  activeBranchId: string;
  actorLabels: string[];
  claimIdsByStatus: Record<ClaimStatus, string[]>;
  activeEvidenceCount: number;
  unresolvedQuestionIds: string[];
  blockingQuestionIds: string[];
  consistencyIssueIds: {
    errors: string[];
    warnings: string[];
    questions: string[];
  };
  finalizedSnapshotCount: number;
  safetyNotice: string;
}

export function getCaseSummary(replayCase: ReplayCase): ReplayCaseSummary {
  const statuses: ClaimStatus[] = [
    "confirmed",
    "reported",
    "likely",
    "uncertain",
    "disputed",
    "unknown",
    "agent-hypothesis",
  ];
  const claimIdsByStatus = Object.fromEntries(
    statuses.map((status) => [
      status,
      replayCase.claims
        .filter((claim) => claim.status === status)
        .map((claim) => claim.id)
        .sort(),
    ]),
  ) as Record<ClaimStatus, string[]>;
  const unresolvedQuestions = rankOpenQuestions(
    replayCase.questions.filter(
      (question) => question.status === "open" || question.status === "deferred",
    ),
  );
  return {
    id: replayCase.id,
    title: replayCase.title,
    caseVersion: replayCase.caseVersion,
    schemaVersion: replayCase.schemaVersion,
    activeBranchId: replayCase.activeBranchId,
    actorLabels: replayCase.actors.map((actor) => actor.label),
    claimIdsByStatus,
    activeEvidenceCount: replayCase.evidence.filter((asset) => !asset.deleted).length,
    unresolvedQuestionIds: unresolvedQuestions.map((question) => question.id),
    blockingQuestionIds: unresolvedQuestions
      .filter((question) => question.importance === "blocking")
      .map((question) => question.id),
    consistencyIssueIds: {
      errors: replayCase.consistencyIssues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.id),
      warnings: replayCase.consistencyIssues
        .filter((issue) => issue.severity === "warning")
        .map((issue) => issue.id),
      questions: replayCase.consistencyIssues
        .filter((issue) => issue.severity === "question")
        .map((issue) => issue.id),
    },
    finalizedSnapshotCount: replayCase.reportSnapshots.length,
    safetyNotice:
      "Geometry and motion results are deterministic review advisories based on recorded calibration, dimensions, timed poses, and declared envelopes. They are not forensic findings, lie detection, or fault and liability determinations.",
  };
}

export type WorkspaceStateSection =
  | "case"
  | "scene"
  | "timeline"
  | "facts"
  | "evidence"
  | "questions"
  | "hypotheses"
  | "report"
  | "activity";

/** Returns an isolated section snapshot suitable for UI or read-only agent tools. */
export function getWorkspaceState(replayCase: ReplayCase, section: WorkspaceStateSection): unknown {
  switch (section) {
    case "case":
      return structuredClone(getCaseSummary(replayCase));
    case "scene":
      return structuredClone({
        environment: replayCase.environment,
        sceneTemplateId: replayCase.sceneTemplateId,
        actors: replayCase.actors,
        trajectories: replayCase.trajectories.filter(
          (trajectory) => trajectory.branchId === replayCase.activeBranchId,
        ),
        activeBranchId: replayCase.activeBranchId,
      });
    case "timeline":
      return structuredClone({
        timeRangeMs: replayCase.timeRangeMs,
        events: replayCase.timelineEvents.filter(
          (event) => event.branchId === replayCase.activeBranchId,
        ),
        activeBranchId: replayCase.activeBranchId,
      });
    case "facts":
      return structuredClone(replayCase.claims);
    case "evidence":
      return structuredClone(replayCase.evidence.filter((asset) => !asset.deleted));
    case "questions":
      return structuredClone(rankOpenQuestions(replayCase.questions));
    case "hypotheses":
      return structuredClone({
        branches: replayCase.branches,
        activeBranchId: replayCase.activeBranchId,
        proposals: replayCase.proposals,
      });
    case "report":
      return structuredClone({
        completenessAttestations: replayCase.completenessAttestations,
        notes: replayCase.reportNotes,
        snapshots: replayCase.reportSnapshots,
      });
    case "activity":
      return structuredClone(replayCase.activity);
  }
}

export function getRecentActivity(replayCase: ReplayCase, limit = 20): ActivityEvent[] {
  return structuredClone(replayCase.activity.slice(-Math.max(0, limit)).reverse());
}

export function workspaceModeForSection(section: WorkspaceStateSection): WorkspaceMode {
  if (section === "case" || section === "scene" || section === "activity") return "scene";
  return section;
}
