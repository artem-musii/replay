import { distance, getActorPoseAtTime, pointInPolygon } from "./interpolation";
import { containsLiabilityConclusion } from "./languageSafety";
import type {
  ConsistencyIssue,
  ConsistencyScope,
  DamageRegion,
  ReplayCase,
  TimelineEvent,
} from "./models";
import { validWorkspaceCitationPaths } from "./report";

export type ConsistencyValidationScope =
  "all" | "scene" | "timeline" | "geometry" | "damage" | "provenance" | "completeness" | "report";

export interface ConsistencyValidationOptions {
  scope?: ConsistencyValidationScope;
  branchId?: string;
}

const severityOrder: Record<ConsistencyIssue["severity"], number> = {
  error: 0,
  warning: 1,
  question: 2,
};

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function issue(
  ruleId: string,
  scope: ConsistencyScope,
  severity: ConsistencyIssue["severity"],
  title: string,
  explanation: string,
  affectedIds: string[],
  suggestedActions: string[],
): ConsistencyIssue {
  const stableAffectedIds = [...new Set(affectedIds)].sort();
  const suffix = stableAffectedIds.length > 0 ? stableAffectedIds.join("|") : "case";
  return {
    id: `issue-${ruleId}-${stableHash(suffix)}`.replace(/[^a-zA-Z0-9_-]/g, "-"),
    ruleId,
    scope,
    severity,
    title,
    explanation,
    affectedIds: stableAffectedIds.slice(0, 5_000),
    suggestedActions,
  };
}

function branchEvents(replayCase: ReplayCase, branchId: string): TimelineEvent[] {
  const branch = replayCase.branches.find((candidate) => candidate.id === branchId);
  if (!branch) return [];
  return replayCase.timelineEvents
    .filter((event) => event.branchId === branchId && branch.eventIds.includes(event.id))
    .sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id));
}

function timelineIssues(replayCase: ReplayCase, branchIds: string[]): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  for (const branchId of branchIds) {
    const events = branchEvents(replayCase, branchId);
    for (const event of events) {
      if (
        event.timeMs < replayCase.timeRangeMs.start ||
        event.timeMs > replayCase.timeRangeMs.end
      ) {
        issues.push(
          issue(
            "timeline.event-out-of-range",
            "timeline",
            "error",
            "Timeline event is outside the case range",
            `“${event.title}” occurs at ${String(event.timeMs)} ms, outside the configured incident range.`,
            [branchId, event.id],
            ["Move the event inside the incident range", "Extend the reviewed incident range"],
          ),
        );
      }
    }

    const impacts = events.filter((event) => event.type === "impact");
    if (impacts.length > 1) {
      issues.push(
        issue(
          "timeline.duplicate-impact",
          "timeline",
          "warning",
          "Multiple impact events are present",
          "This branch contains more than one impact marker. Confirm whether these represent separate contacts.",
          [branchId, ...impacts.map((event) => event.id)],
          ["Keep the reviewed impact event", "Rename genuine separate contacts clearly"],
        ),
      );
    }

    for (const actor of replayCase.actors) {
      const actorEvents = events.filter((event) => event.linkedActorIds.includes(actor.id));
      const starts = actorEvents.filter((event) => event.type === "actor-start");
      const stops = actorEvents.filter((event) => event.type === "actor-stop");
      if (starts.length === 0) {
        issues.push(
          issue(
            "timeline.actor-start-missing",
            "timeline",
            "warning",
            "Actor start event is missing",
            `${actor.label} has no start event in this branch.`,
            [branchId, actor.id],
            ["Add an approximate actor start event"],
          ),
        );
      }
      if (stops.length === 0) {
        issues.push(
          issue(
            "timeline.actor-stop-missing",
            "timeline",
            "warning",
            "Actor final-position event is missing",
            `${actor.label} has no final-position event in this branch.`,
            [branchId, actor.id],
            ["Add an actor stop or final-position event"],
          ),
        );
      }

      for (const impact of impacts.filter((event) => event.linkedActorIds.includes(actor.id))) {
        if (!starts.some((start) => start.timeMs < impact.timeMs)) {
          issues.push(
            issue(
              "timeline.impact-before-start",
              "timeline",
              "error",
              "Impact does not follow actor start",
              `${actor.label} has no start event before the impact.`,
              [branchId, actor.id, impact.id],
              ["Move the impact after the actor start", "Add the missing start event"],
            ),
          );
        }
        if (!stops.some((stop) => stop.timeMs > impact.timeMs)) {
          issues.push(
            issue(
              "timeline.final-before-impact",
              "timeline",
              "error",
              "Final position does not follow impact",
              `${actor.label} has no final-position event after the impact.`,
              [branchId, actor.id, impact.id],
              [
                "Move the final-position event after impact",
                "Add the missing final-position event",
              ],
            ),
          );
        }
      }

      const firstStart = starts[0];
      const lastStop = stops[stops.length - 1];
      if (firstStart && lastStop && firstStart.timeMs >= lastStop.timeMs) {
        issues.push(
          issue(
            "timeline.invalid-actor-order",
            "timeline",
            "error",
            "Actor event order is invalid",
            `${actor.label} stops before or at its start time.`,
            [branchId, actor.id, firstStart.id, lastStop.id],
            ["Put actor events into chronological order"],
          ),
        );
      }
    }
  }
  return issues;
}

function isWithinScene(replayCase: ReplayCase, x: number, y: number): boolean {
  const { bounds, roadPolygon } = replayCase.environment;
  const insideBounds = x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
  if (!insideBounds || !pointInPolygon({ x, y }, roadPolygon)) return false;

  if (replayCase.environment.sceneType === "intersection") {
    // Mirrors the functional SVG template: a 21%-wide north/south road
    // crossing a 30%-high east/west road.
    return (x >= 39.5 && x <= 60.5) || (y >= 35 && y <= 65);
  }

  // The roundabout template is the union of its approach roads and outer
  // ellipse, excluding the central island. SVG uses a 1000×700 viewBox, so
  // the normalized horizontal and vertical radii differ.
  const dx = x - 50;
  const dy = y - 50;
  const insideOuterRoundabout = (dx / 20.5) ** 2 + (dy / 29.3) ** 2 <= 1;
  const insideIsland = (dx / 11.4) ** 2 + (dy / 16.3) ** 2 < 1;
  const onHorizontalApproach = y >= 37.1 && y <= 62.9;
  const onVerticalApproach = x >= 41 && x <= 59;
  return !insideIsland && (insideOuterRoundabout || onHorizontalApproach || onVerticalApproach);
}

function geometryIssues(replayCase: ReplayCase, branchIds: string[]): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const actorIds = new Set(replayCase.actors.map((actor) => actor.id));
  const knownBranchIds = new Set(replayCase.branches.map((branch) => branch.id));

  for (const actor of replayCase.actors) {
    if (actor.dimensions.width <= 0 || actor.dimensions.length <= 0) {
      issues.push(
        issue(
          "geometry.invalid-actor-dimensions",
          "geometry",
          "error",
          "Actor dimensions are invalid",
          `${actor.label} must have positive width and length.`,
          [actor.id],
          ["Set realistic positive vehicle dimensions"],
        ),
      );
    }
    if (!isWithinScene(replayCase, actor.pose.x, actor.pose.y)) {
      issues.push(
        issue(
          "geometry.actor-outside-scene",
          "geometry",
          "warning",
          "Vehicle is outside the road scene",
          `${actor.label}’s current position is outside the configured road area.`,
          [actor.id],
          ["Move the vehicle onto the road", "Review the scene template"],
        ),
      );
    }
  }

  for (const trajectory of replayCase.trajectories.filter((item) =>
    branchIds.includes(item.branchId),
  )) {
    if (!actorIds.has(trajectory.actorId) || !knownBranchIds.has(trajectory.branchId)) {
      issues.push(
        issue(
          "geometry.dangling-trajectory-reference",
          "geometry",
          "error",
          "Trajectory references a missing object",
          "The trajectory’s actor or branch no longer exists.",
          [trajectory.id, trajectory.actorId, trajectory.branchId],
          ["Relink the trajectory", "Remove the invalid trajectory"],
        ),
      );
    }
    for (const keyframe of trajectory.keyframes) {
      if (!isWithinScene(replayCase, keyframe.x, keyframe.y)) {
        issues.push(
          issue(
            "geometry.keyframe-outside-scene",
            "geometry",
            "warning",
            "Trajectory leaves the road scene",
            "A trajectory keyframe lies outside the configured road area.",
            [trajectory.id, keyframe.id],
            ["Move the keyframe onto the road", "Review whether free placement is intentional"],
          ),
        );
      }
    }
    for (let index = 1; index < trajectory.keyframes.length; index += 1) {
      const previous = trajectory.keyframes[index - 1];
      const current = trajectory.keyframes[index];
      if (!previous || !current) continue;
      const elapsedSeconds = (current.timeMs - previous.timeMs) / 1_000;
      const speed = elapsedSeconds > 0 ? distance(previous, current) / elapsedSeconds : Infinity;
      if (!Number.isFinite(speed) || speed > 55) {
        issues.push(
          issue(
            "geometry.trajectory-teleport",
            "geometry",
            "error",
            "Trajectory contains an abrupt jump",
            `Adjacent keyframes imply ${Number.isFinite(speed) ? speed.toFixed(1) : "an infinite"} scene units per second. This is treated as a continuity error, not a physics conclusion.`,
            [trajectory.id, previous.id, current.id],
            ["Add an intermediate keyframe", "Correct the keyframe time or position"],
          ),
        );
      }
    }
  }

  for (const branchId of branchIds) {
    const impacts = branchEvents(replayCase, branchId).filter((event) => event.type === "impact");
    for (const impact of impacts) {
      const linkedActors = impact.linkedActorIds
        .map((actorId) => replayCase.actors.find((actor) => actor.id === actorId))
        .filter((actor): actor is ReplayCase["actors"][number] => Boolean(actor));
      if (linkedActors.length >= 2) {
        for (let firstIndex = 0; firstIndex < linkedActors.length - 1; firstIndex += 1) {
          for (
            let secondIndex = firstIndex + 1;
            secondIndex < linkedActors.length;
            secondIndex += 1
          ) {
            const first = linkedActors[firstIndex];
            const second = linkedActors[secondIndex];
            if (!first || !second) continue;
            const firstPose = getActorPoseAtTime(replayCase, first.id, impact.timeMs, branchId);
            const secondPose = getActorPoseAtTime(replayCase, second.id, impact.timeMs, branchId);
            if (!firstPose || !secondPose) continue;
            const separation = distance(firstPose, secondPose);
            const contactThreshold = (first.dimensions.width + second.dimensions.width) / 2 + 0.75;
            if (separation > contactThreshold) {
              issues.push(
                issue(
                  "geometry.impact-separation",
                  "geometry",
                  "warning",
                  "Vehicles do not meet at the impact time",
                  `The vehicle centers are ${separation.toFixed(1)} m apart at the impact marker; current widths imply contact should be closer. This is a consistency check, not a forensic conclusion.`,
                  [branchId, impact.id, first.id, second.id],
                  [
                    "Review the impact timestamp",
                    "Adjust a trajectory",
                    "Keep the discrepancy explicitly unresolved",
                  ],
                ),
              );
            }
          }
        }
      }

      if (impact.location) {
        for (const actor of linkedActors) {
          const pose = getActorPoseAtTime(replayCase, actor.id, impact.timeMs, branchId);
          if (pose && distance(pose, impact.location) > actor.dimensions.length / 2 + 2) {
            issues.push(
              issue(
                "geometry.impact-marker-distance",
                "geometry",
                "warning",
                "Impact marker is not near a linked vehicle",
                `The impact marker is not close to ${actor.label} at the selected time.`,
                [branchId, impact.id, actor.id],
                ["Move the impact marker", "Review the actor trajectory or timestamp"],
              ),
            );
          }
        }
      }
    }
  }
  return issues;
}

const damageAngles: Partial<Record<DamageRegion, number>> = {
  front: 0,
  "front-right": 45,
  "right-side": 90,
  "rear-right": 135,
  rear: 180,
  "rear-left": 225,
  "left-side": 270,
  "front-left": 315,
};

function angularDifference(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function damageIssues(replayCase: ReplayCase, branchIds: string[]): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const allDamage = replayCase.actors.flatMap((actor) => actor.damageMarkers);
  if (allDamage.length === 0) {
    issues.push(
      issue(
        "damage.none-recorded",
        "damage",
        "question",
        "No vehicle damage is recorded",
        "Neither vehicle has a marked damage location.",
        replayCase.actors.map((actor) => actor.id),
        ["Mark known damage", "Record that damage location is unknown"],
      ),
    );
  }

  for (const branchId of branchIds) {
    for (const impact of branchEvents(replayCase, branchId).filter(
      (event) => event.type === "impact",
    )) {
      const actors = impact.linkedActorIds
        .map((actorId) => replayCase.actors.find((actor) => actor.id === actorId))
        .filter((actor): actor is ReplayCase["actors"][number] => Boolean(actor));
      for (const actor of actors) {
        if (actor.damageMarkers.length === 0) {
          issues.push(
            issue(
              "damage.impact-without-marker",
              "damage",
              "question",
              "Impact has no linked damage location",
              `${actor.label} is linked to the impact but has no damage marker.`,
              [branchId, impact.id, actor.id],
              ["Mark the observed damage side", "Record the damage location as unknown"],
            ),
          );
        }
      }

      if (actors.length === 2) {
        const first = actors[0];
        const second = actors[1];
        if (!first || !second) continue;
        const firstPose = getActorPoseAtTime(replayCase, first.id, impact.timeMs, branchId);
        const secondPose = getActorPoseAtTime(replayCase, second.id, impact.timeMs, branchId);
        if (firstPose && secondPose) {
          const pairs = [
            { actor: first, pose: firstPose, otherPose: secondPose },
            { actor: second, pose: secondPose, otherPose: firstPose },
          ];
          for (const pair of pairs) {
            const contactWorldAngle =
              (Math.atan2(pair.otherPose.y - pair.pose.y, pair.otherPose.x - pair.pose.x) * 180) /
              Math.PI;
            const localContactAngle =
              (((contactWorldAngle - pair.pose.rotationDeg) % 360) + 360) % 360;
            for (const marker of pair.actor.damageMarkers) {
              const expected = damageAngles[marker.region];
              if (expected !== undefined && angularDifference(localContactAngle, expected) > 100) {
                issues.push(
                  issue(
                    "damage.contact-direction-hint",
                    "damage",
                    "question",
                    "Damage side may not match the contact direction",
                    `${pair.actor.label}’s ${marker.region} marker differs from the broad contact direction in this branch. This is only a consistency hint, not a physical conclusion.`,
                    [branchId, impact.id, pair.actor.id, marker.id],
                    [
                      "Review the vehicle orientation",
                      "Review the damage side",
                      "Keep the discrepancy unresolved",
                    ],
                  ),
                );
              }
            }
          }
        }
      }
    }
  }
  return issues;
}

function provenanceIssues(replayCase: ReplayCase): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const evidenceById = new Map(replayCase.evidence.map((asset) => [asset.id, asset]));
  const eventIds = new Set(replayCase.timelineEvents.map((event) => event.id));
  const actorIds = new Set(replayCase.actors.map((actor) => actor.id));

  for (const claim of replayCase.claims) {
    if (claim.status === "confirmed" && containsLiabilityConclusion(claim.statement)) {
      issues.push(
        issue(
          "provenance.liability-as-fact",
          "provenance",
          "error",
          "Fault or liability language is presented as confirmed",
          "REPLAY may preserve a source-attributed allegation, but it cannot confirm fault or legal liability.",
          [claim.id],
          ["Return the statement to reported", "Rewrite it as a neutral factual observation"],
        ),
      );
    }
    if (claim.status === "confirmed" && (!claim.humanConfirmed || !claim.confirmedAt)) {
      issues.push(
        issue(
          "provenance.confirmation-missing",
          "provenance",
          "error",
          "Confirmed claim lacks human confirmation",
          "Only an explicit human action may make a claim confirmed.",
          [claim.id],
          ["Return the claim to reported", "Ask a human to review and confirm it"],
        ),
      );
    }
    if (
      claim.status === "confirmed" &&
      claim.createdBy === "agent" &&
      !claim.changeHistory.some(
        (change) => change.author === "human" && /confirm/i.test(change.summary),
      )
    ) {
      issues.push(
        issue(
          "provenance.agent-confirmation",
          "provenance",
          "error",
          "Agent-created claim lacks a human confirmation event",
          "An agent-created observation can be confirmed only through a recorded human review action.",
          [claim.id],
          [
            "Return the claim to an unconfirmed status",
            "Ask a human to confirm it in the interface",
          ],
        ),
      );
    }
    if (
      claim.status === "unknown" &&
      (claim.humanConfirmed || claim.statement.trim().length === 0)
    ) {
      issues.push(
        issue(
          "provenance.unknown-as-fact",
          "provenance",
          "error",
          "Unknown detail is represented as a fact",
          "Unknown details must remain unconfirmed and explicitly labelled unknown.",
          [claim.id],
          ["Remove confirmation", "Rewrite the statement as an unresolved detail"],
        ),
      );
    }
    if (claim.branchId && claim.status === "confirmed") {
      issues.push(
        issue(
          "provenance.hypothesis-as-fact",
          "provenance",
          "error",
          "Branch-specific claim is presented as confirmed",
          "Hypothesis-specific claims cannot appear as factual conclusions.",
          [claim.id, claim.branchId],
          [
            "Mark the claim as a hypothesis",
            "Move a genuinely shared confirmed fact outside the branch",
          ],
        ),
      );
    }
    for (const evidenceId of claim.linkedEvidenceIds) {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence || evidence.deleted) {
        issues.push(
          issue(
            "provenance.invalid-evidence-link",
            "provenance",
            "error",
            "Claim cites unavailable evidence",
            `The claim links to ${evidence ? "deleted" : "missing"} evidence.`,
            [claim.id, evidenceId],
            ["Restore or relink the evidence", "Remove the invalid citation"],
          ),
        );
      }
    }
    for (const eventId of claim.linkedEventIds) {
      if (!eventIds.has(eventId)) {
        issues.push(
          issue(
            "provenance.invalid-event-link",
            "provenance",
            "error",
            "Claim cites a missing timeline event",
            "A linked timeline event no longer exists.",
            [claim.id, eventId],
            ["Relink the claim", "Remove the invalid event link"],
          ),
        );
      }
    }
    for (const sceneId of claim.linkedSceneObjectIds) {
      if (
        !actorIds.has(sceneId) &&
        !replayCase.trajectories.some((trajectory) => trajectory.id === sceneId)
      ) {
        issues.push(
          issue(
            "provenance.invalid-scene-link",
            "provenance",
            "error",
            "Claim cites a missing scene object",
            "A linked scene object no longer exists.",
            [claim.id, sceneId],
            ["Relink the claim", "Remove the invalid scene link"],
          ),
        );
      }
    }
  }

  const evidenceLinks: { ownerId: string; evidenceId: string }[] = [];
  for (const event of replayCase.timelineEvents) {
    event.linkedEvidenceIds.forEach((evidenceId) =>
      evidenceLinks.push({ ownerId: event.id, evidenceId }),
    );
  }
  for (const actor of replayCase.actors) {
    for (const marker of actor.damageMarkers) {
      marker.linkedEvidenceIds.forEach((evidenceId) =>
        evidenceLinks.push({ ownerId: marker.id, evidenceId }),
      );
    }
  }
  for (const note of replayCase.reportNotes) {
    note.evidenceIds.forEach((evidenceId) => evidenceLinks.push({ ownerId: note.id, evidenceId }));
  }
  for (const link of evidenceLinks) {
    const evidence = evidenceById.get(link.evidenceId);
    if (!evidence || evidence.deleted) {
      issues.push(
        issue(
          "provenance.deleted-evidence-cited",
          "provenance",
          "error",
          "Unavailable evidence remains cited",
          "A timeline, damage, or report item cites missing or deleted evidence.",
          [link.ownerId, link.evidenceId],
          ["Restore the evidence", "Remove the citation"],
        ),
      );
    }
  }
  return issues;
}

function completenessIssues(replayCase: ReplayCase): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  if (!replayCase.incidentDate) {
    issues.push(
      issue(
        "completeness.incident-date",
        "completeness",
        "warning",
        "Incident date is missing",
        "A date or approximate date is required for a complete factual report.",
        [replayCase.id],
        ["Add the incident date or clearly state that it is unknown"],
      ),
    );
  }
  if (!replayCase.sceneTemplateId) {
    issues.push(
      issue(
        "completeness.scene",
        "completeness",
        "error",
        "Scene type is missing",
        "A scene template is required.",
        [replayCase.id],
        ["Select a scene template"],
      ),
    );
  }
  if (replayCase.actors.length < 2) {
    issues.push(
      issue(
        "completeness.actors",
        "completeness",
        "warning",
        "Involved actors are incomplete",
        "This workflow expects the two involved vehicles to be represented.",
        [replayCase.id, ...replayCase.actors.map((actor) => actor.id)],
        ["Add the missing vehicle"],
      ),
    );
  }
  if (!replayCase.actors.some((actor) => actor.damageMarkers.length > 0)) {
    issues.push(
      issue(
        "completeness.damage",
        "completeness",
        "warning",
        "Known damage has not been recorded",
        "Record damage locations or explicitly record that they are unknown.",
        replayCase.actors.map((actor) => actor.id),
        ["Add damage markers", "Add an unknown-damage observation"],
      ),
    );
  }
  if (replayCase.timelineEvents.length === 0 || replayCase.trajectories.length === 0) {
    issues.push(
      issue(
        "completeness.timeline",
        "completeness",
        "warning",
        "Timeline reconstruction is incomplete",
        "At least one trajectory and timeline event are required for reconstruction.",
        [replayCase.id],
        ["Add actor trajectories and timeline events"],
      ),
    );
  }
  if (
    !replayCase.questions.some(
      (question) => question.status === "open" || question.status === "deferred",
    )
  ) {
    issues.push(
      issue(
        "completeness.unresolved-section",
        "completeness",
        "question",
        "No unresolved details are recorded",
        "Review whether uncertainty has been explicitly captured before reporting.",
        [replayCase.id],
        ["Add unresolved questions or confirm that none remain"],
      ),
    );
  }
  if (!replayCase.evidence.some((asset) => !asset.deleted)) {
    issues.push(
      issue(
        "completeness.evidence-index",
        "completeness",
        "warning",
        "Evidence index is empty",
        "No available evidence is indexed for the report.",
        [replayCase.id],
        ["Add available evidence", "Record that no evidence was supplied"],
      ),
    );
  }
  // ReportSnapshotSchema requires humanAcknowledged=true, so malformed review
  // state is rejected before a persisted/imported case reaches this engine.
  return issues;
}

function reportIssues(replayCase: ReplayCase): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const claims = new Map(replayCase.claims.map((claim) => [claim.id, claim]));
  const evidence = new Map(replayCase.evidence.map((asset) => [asset.id, asset]));
  const workspacePaths = validWorkspaceCitationPaths(replayCase);
  const previews = replayCase.reportSnapshots.map((snapshot) => ({
    ownerId: snapshot.id,
    preview: snapshot.preview,
  }));
  for (const { ownerId, preview } of previews) {
    for (const section of preview.sections) {
      for (const statement of section.statements) {
        const hasClaimOrEvidenceCitation =
          statement.citations.claimIds.length > 0 || statement.citations.evidenceIds.length > 0;
        if (containsLiabilityConclusion(statement.text)) {
          issues.push(
            issue(
              "report.liability-language",
              "report",
              "error",
              "Report contains a fault or liability conclusion",
              "A factual report may preserve source attribution but cannot determine fault or legal liability.",
              [ownerId, statement.id],
              ["Rewrite the statement as a neutral, evidence-bound observation"],
            ),
          );
        }
        if (
          (statement.certainty !== "system" && !hasClaimOrEvidenceCitation) ||
          (statement.certainty === "system" &&
            !hasClaimOrEvidenceCitation &&
            statement.citations.workspacePaths.length === 0)
        ) {
          issues.push(
            issue(
              "report.statement-without-citation",
              "report",
              "error",
              "Report statement lacks provenance",
              "Every substantive report statement must cite a claim or evidence item.",
              [ownerId, statement.id],
              ["Add source citations", "Remove the unsupported statement"],
            ),
          );
        }
        for (const workspacePath of statement.citations.workspacePaths) {
          if (!workspacePaths.has(workspacePath)) {
            issues.push(
              issue(
                "report.invalid-workspace-citation",
                "report",
                "error",
                "Report workspace citation is unavailable",
                "A structured report source no longer resolves to an inspectable case object.",
                [ownerId, statement.id],
                ["Restore the referenced case object", "Remove the unsupported statement"],
              ),
            );
          }
        }
        for (const claimId of statement.citations.claimIds) {
          const claim = claims.get(claimId);
          if (
            !claim ||
            (statement.certainty === "confirmed" &&
              (claim.status !== "confirmed" || !claim.humanConfirmed))
          ) {
            issues.push(
              issue(
                "report.invalid-claim-citation",
                "report",
                "error",
                "Report claim citation is not allowed",
                "The cited claim is missing or is not eligible for this report section.",
                [ownerId, statement.id, claimId],
                ["Cite an eligible claim", "Move the statement to the correct certainty section"],
              ),
            );
          }
        }
        for (const evidenceId of statement.citations.evidenceIds) {
          const asset = evidence.get(evidenceId);
          if (!asset || asset.deleted) {
            issues.push(
              issue(
                "report.invalid-evidence-citation",
                "report",
                "error",
                "Report evidence citation is unavailable",
                "The statement cites missing or deleted evidence.",
                [ownerId, statement.id, evidenceId],
                ["Restore or replace the evidence citation"],
              ),
            );
          }
        }
      }
    }
  }

  for (const note of replayCase.reportNotes) {
    if (containsLiabilityConclusion(note.text)) {
      issues.push(
        issue(
          "report.liability-language",
          "report",
          "error",
          "Report note contains a fault or liability conclusion",
          "REPLAY reports may organize evidence but must not determine fault or legal liability.",
          [note.id],
          ["Rewrite the note as a neutral, evidence-bound observation"],
        ),
      );
    }
  }
  return issues;
}

function requestedScopes(scope: ConsistencyValidationScope): Set<ConsistencyScope> {
  if (scope === "all") {
    return new Set(["timeline", "geometry", "damage", "provenance", "completeness", "report"]);
  }
  if (scope === "scene") return new Set(["geometry", "damage"]);
  return new Set([scope]);
}

/** Runs deterministic application rules. No language model output participates. */
export function validateConsistency(
  replayCase: ReplayCase,
  options: ConsistencyValidationOptions = {},
): ConsistencyIssue[] {
  const scopes = requestedScopes(options.scope ?? "all");
  const branchIds = options.branchId
    ? [options.branchId]
    : replayCase.branches.filter((branch) => branch.status === "active").map((branch) => branch.id);
  const issues: ConsistencyIssue[] = [];
  if (scopes.has("timeline")) issues.push(...timelineIssues(replayCase, branchIds));
  if (scopes.has("geometry")) issues.push(...geometryIssues(replayCase, branchIds));
  if (scopes.has("damage")) issues.push(...damageIssues(replayCase, branchIds));
  if (scopes.has("provenance")) issues.push(...provenanceIssues(replayCase));
  if (scopes.has("completeness")) issues.push(...completenessIssues(replayCase));
  if (scopes.has("report")) issues.push(...reportIssues(replayCase));

  return [...new Map(issues.map((item) => [item.id, item])).values()].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.id.localeCompare(b.id),
  );
}
