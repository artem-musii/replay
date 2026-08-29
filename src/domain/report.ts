import type {
  Claim,
  ReplayCase,
  ReportPreview,
  ReportPreviewReviewBinding,
  ReportSection,
  ReportStatement,
} from "./models";
import { evidenceBoundText, truncateXmlSafeText } from "./languageSafety";
import {
  findCurrentCompletenessAttestation,
  isCompletenessAttestationCurrent,
} from "./completeness";
import { canonicalSerialize, sha256Hex } from "./fingerprint";

export const REPORT_DISCLAIMER =
  "REPLAY helps organize and visualize a factual account. Its consistency checks are informational and are not a forensic or legal determination. Geometry and motion checks use the recorded calibration, vehicle dimensions, timed poses, and declared advisory envelopes. This report is not forensic analysis or legal advice, a vehicle-dynamics reconstruction, lie detection, or a finding of fault or liability.";

export interface BuildReportOptions {
  generatedAt?: string;
  includeHypotheses?: boolean;
  branchIds?: string[];
}

export function createReportPreviewReviewBinding(
  preview: Omit<ReportPreview, "reviewBinding">,
  scope: Pick<ReportPreviewReviewBinding, "branchIds" | "includeHypotheses">,
): ReportPreviewReviewBinding {
  const branchIds = [...new Set(scope.branchIds)].sort();
  const canonical = canonicalSerialize({
    preview,
    branchIds,
    includeHypotheses: scope.includeHypotheses,
  });
  return {
    algorithm: "SHA-256",
    fingerprint: `sha256-${sha256Hex(canonical)}`,
    branchIds,
    includeHypotheses: scope.includeHypotheses,
  };
}

export function reportPreviewHasValidReviewBinding(preview: ReportPreview): boolean {
  const binding = preview.reviewBinding;
  if (!binding) return false;
  const unboundPreview = structuredClone(preview);
  delete unboundPreview.reviewBinding;
  return (
    binding.fingerprint === createReportPreviewReviewBinding(unboundPreview, binding).fingerprint
  );
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function reportStatementId(kind: string, sourceId: string): string {
  const raw = `report-${kind}-${sourceId}`;
  return raw.length <= 128 ? raw : `${truncateXmlSafeText(raw, 118)}-${stableHash(raw)}`;
}

function statement(
  id: string,
  text: string,
  certainty: ReportStatement["certainty"],
  claimIds: string[] = [],
  evidenceIds: string[] = [],
  workspacePaths: string[] = [],
): ReportStatement {
  return {
    id,
    text: truncateXmlSafeText(text, 10_000),
    certainty,
    citations: {
      claimIds: [...new Set(claimIds)].sort(),
      evidenceIds: [...new Set(evidenceIds)].sort(),
      workspacePaths: [...new Set(workspacePaths)].sort(),
    },
  };
}

function section(id: string, title: string, statements: ReportStatement[] = []): ReportSection {
  return { id, title, statements };
}

function claimCertainty(claim: Claim): ReportStatement["certainty"] {
  if (claim.status === "confirmed" && claim.humanConfirmed) return "confirmed";
  if (claim.status === "agent-hypothesis" || claim.branchId) return "hypothesis";
  if (claim.status === "reported") return "reported";
  return "uncertain";
}

function isAllowedConfirmedClaim(claim: Claim): boolean {
  return (
    claim.status === "confirmed" &&
    claim.humanConfirmed &&
    Boolean(claim.confirmedAt) &&
    !claim.branchId
  );
}

function isUnconfirmedFactualClaim(claim: Claim): boolean {
  return !claim.branchId && claim.status !== "confirmed" && claim.status !== "agent-hypothesis";
}

function linkedAvailableEvidence(replayCase: ReplayCase, ids: string[]): string[] {
  const available = new Set(
    replayCase.evidence.filter((asset) => !asset.deleted).map((asset) => asset.id),
  );
  return ids.filter((id) => available.has(id));
}

export function validWorkspaceCitationPaths(replayCase: ReplayCase): Set<string> {
  return new Set([
    "case.title",
    "case.incidentDate",
    "case.approximateTime",
    "case.sceneTemplateId",
    "case.activeBranchId",
    "case.environment",
    "system.report-generator",
    "system.human-review",
    ...replayCase.completenessAttestations
      .filter((attestation) => isCompletenessAttestationCurrent(replayCase, attestation))
      .map((attestation) => `completenessAttestations.${attestation.id}`),
    ...replayCase.actors.flatMap((actor) => [
      `actors.${actor.id}`,
      ...actor.damageMarkers.map((marker) => `actors.${actor.id}.damageMarkers.${marker.id}`),
    ]),
    ...replayCase.timelineEvents.map((event) => `timelineEvents.${event.id}`),
    ...replayCase.questions.map((question) => `questions.${question.id}`),
    ...replayCase.branches.flatMap((branch) => [
      `branches.${branch.id}`,
      ...branch.assumptions.map(
        (assumption) => `branches.${branch.id}.assumptions.${assumption.id}`,
      ),
    ]),
  ]);
}

/**
 * Builds an evidence-bound preview without mutating the case. Confirmed material
 * is filtered in code and can never be promoted by generated prose.
 */
export function buildReportPreview(
  replayCase: ReplayCase,
  options: BuildReportOptions = {},
): ReportPreview {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const requestedBranches = options.branchIds ?? replayCase.branches.map((branch) => branch.id);
  const branches = replayCase.branches.filter(
    (branch) => requestedBranches.includes(branch.id) && branch.status === "active",
  );
  const activeEvidence = replayCase.evidence.filter((asset) => !asset.deleted);
  const noEvidenceAttestation = findCurrentCompletenessAttestation(replayCase, {
    kind: "no-evidence-supplied",
  });
  const uncertaintyReviewAttestation = findCurrentCompletenessAttestation(replayCase, {
    kind: "uncertainty-review-completed",
  });
  const claimsById = new Map(replayCase.claims.map((claim) => [claim.id, claim]));
  const confirmedClaims = replayCase.claims.filter(isAllowedConfirmedClaim);
  const unconfirmedClaims = replayCase.claims.filter(isUnconfirmedFactualClaim);
  const reviewedFactualNotes = replayCase.reportNotes.filter(
    (note) =>
      note.reviewedByHuman &&
      note.claimIds.every((claimId) => {
        const claim = claimsById.get(claimId);
        return !claim?.branchId && claim?.status !== "agent-hypothesis";
      }),
  );
  const reviewedHypothesisNotes = replayCase.reportNotes.filter(
    (note) => note.reviewedByHuman && !reviewedFactualNotes.includes(note),
  );
  const missingRequirements: string[] = [];

  if (!replayCase.incidentDate) missingRequirements.push("Incident date or approximate date");
  if (replayCase.actors.length < 2) missingRequirements.push("Both involved vehicles");
  if (replayCase.timelineEvents.length === 0) missingRequirements.push("Timeline events");
  if (activeEvidence.length === 0 && !noEvidenceAttestation)
    missingRequirements.push("Evidence index or explicit no-evidence record");
  if (confirmedClaims.length === 0)
    missingRequirements.push("At least one human-confirmed observation");
  if (replayCase.consistencyIssues.some((issue) => issue.severity === "error")) {
    missingRequirements.push("Resolution or acknowledgement of consistency errors");
  }

  const sections: ReportSection[] = [];
  sections.push(
    section("case-overview", "Case overview", [
      statement(
        "report-overview",
        `${evidenceBoundText(replayCase.title)}. Incident date: ${replayCase.incidentDate ?? "unknown"}; approximate time: ${replayCase.approximateTime ?? "unknown"}.`,
        "system",
        [],
        [],
        ["case.title", "case.incidentDate", "case.approximateTime"],
      ),
    ]),
  );

  sections.push(
    section(
      "participants",
      "Participants or anonymous vehicle labels",
      replayCase.actors.map((actor) =>
        statement(
          reportStatementId("actor", actor.id),
          `${evidenceBoundText(actor.label)} is represented as an anonymous ${actor.vehicleClass.replaceAll("-", " ")} (${actor.dimensions.length.toFixed(2)} m × ${actor.dimensions.width.toFixed(2)} m; dimensions source: ${actor.dimensionsSource.replaceAll("-", " ")}${actor.wheelbaseMeters === undefined ? "" : `; wheelbase: ${actor.wheelbaseMeters.toFixed(2)} m`}).`,
          "system",
          [],
          [],
          [`actors.${actor.id}`],
        ),
      ),
    ),
  );

  sections.push(
    section("environment", "Environment and road conditions", [
      statement(
        "report-environment",
        `Scene: ${replayCase.environment.sceneType}; road condition: ${replayCase.environment.roadCondition}; weather: ${replayCase.environment.weather}; lighting: ${replayCase.environment.lighting}; traffic side: ${replayCase.environment.trafficSide}. Local calibration: ${replayCase.environment.calibration.widthMeters.toFixed(1)} m × ${replayCase.environment.calibration.heightMeters.toFixed(1)} m, source ${replayCase.environment.calibration.source.replaceAll("-", " ")}, stated uncertainty ±${replayCase.environment.calibration.uncertaintyMeters.toFixed(1)} m${replayCase.environment.postedSpeedLimitKph === undefined ? "" : `; posted speed limit ${replayCase.environment.postedSpeedLimitKph.toFixed(0)} km/h`}.`,
        "system",
        [],
        [],
        ["case.environment"],
      ),
    ]),
  );

  sections.push(
    section(
      "confirmed-observations",
      "Confirmed observations",
      confirmedClaims.map((claim) =>
        statement(
          reportStatementId("confirmed", claim.id),
          evidenceBoundText(claim.statement),
          "confirmed",
          [claim.id],
          linkedAvailableEvidence(replayCase, claim.linkedEvidenceIds),
        ),
      ),
    ),
  );

  sections.push(
    section("reported-details", "Reported but unconfirmed details", [
      ...unconfirmedClaims.map((claim) =>
        statement(
          reportStatementId("unconfirmed", claim.id),
          `${evidenceBoundText(claim.statement)} [${claim.status}]`,
          claimCertainty(claim),
          [claim.id],
          linkedAvailableEvidence(replayCase, claim.linkedEvidenceIds),
        ),
      ),
      ...reviewedFactualNotes.map((note) =>
        statement(
          reportStatementId("note", note.id),
          evidenceBoundText(note.text),
          note.claimIds.length > 0 &&
            note.claimIds.every((claimId) => {
              const cited = claimsById.get(claimId);
              return cited ? isAllowedConfirmedClaim(cited) : false;
            })
            ? "confirmed"
            : "reported",
          note.claimIds.filter((id) => claimsById.has(id)),
          linkedAvailableEvidence(replayCase, note.evidenceIds),
        ),
      ),
    ]),
  );

  const timelineStatements = replayCase.timelineEvents
    .filter((event) =>
      branches.some((branch) => branch.id === event.branchId && branch.eventIds.includes(event.id)),
    )
    .sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id))
    .map((event) => {
      const citedClaims = event.linkedClaimIds.filter((id) => claimsById.has(id));
      const citedEvidence = linkedAvailableEvidence(replayCase, event.linkedEvidenceIds);
      return statement(
        reportStatementId("event", event.id),
        `T+${(event.timeMs / 1_000).toFixed(1)} s — ${evidenceBoundText(event.title)}.`,
        event.certainty === "confirmed"
          ? "confirmed"
          : event.certainty === "agent-hypothesis"
            ? "hypothesis"
            : event.certainty === "reported"
              ? "reported"
              : "uncertain",
        citedClaims,
        citedEvidence,
        [`timelineEvents.${event.id}`],
      );
    });
  sections.push(section("timeline", "Timeline", timelineStatements));

  sections.push(
    section("scene-diagram", "Scene diagram", [
      statement(
        "report-scene-diagram",
        `The case includes a structured ${replayCase.environment.sceneType} scene reconstruction. Export its scene review snapshot separately and read it with its certainty and branch labels.`,
        "system",
        [],
        [],
        ["case.sceneTemplateId", "case.activeBranchId"],
      ),
    ]),
  );

  sections.push(
    section(
      "damage-summary",
      "Vehicle damage summary",
      replayCase.actors.flatMap((actor) => {
        const recordedMarkers = actor.damageMarkers.map((marker) =>
          statement(
            reportStatementId("damage", marker.id),
            `${evidenceBoundText(actor.label)}: ${marker.region} — ${evidenceBoundText(marker.description)} [${marker.status}].`,
            marker.status === "confirmed"
              ? "confirmed"
              : marker.status === "agent-hypothesis"
                ? "hypothesis"
                : "reported",
            marker.linkedClaimIds.filter((id) => claimsById.has(id)),
            linkedAvailableEvidence(replayCase, marker.linkedEvidenceIds),
            [`actors.${actor.id}.damageMarkers.${marker.id}`],
          ),
        );
        if (recordedMarkers.length > 0) return recordedMarkers;
        const attestation = findCurrentCompletenessAttestation(replayCase, {
          kind: "actor-damage",
          actorId: actor.id,
          outcome: "unknown",
        });
        if (attestation?.kind !== "actor-damage") return [];
        return [
          statement(
            reportStatementId("damage-attestation", attestation.id),
            attestation.outcome === "unknown"
              ? `${evidenceBoundText(actor.label)}: a human recorded that the damage location is unknown. This completeness record is not evidence that damage did or did not occur.`
              : `${evidenceBoundText(actor.label)}: a human recorded that damage was not assessed. This completeness record is not evidence that no damage occurred.`,
            "attested",
            [],
            [],
            [`completenessAttestations.${attestation.id}`],
          ),
        ];
      }),
    ),
  );

  sections.push(
    section(
      "evidence-index",
      "Evidence index",
      activeEvidence.length > 0
        ? activeEvidence.map((asset) =>
            statement(
              reportStatementId("evidence", asset.id),
              `${evidenceBoundText(asset.name)} (${asset.mimeType}${asset.syntheticDemoAsset ? "; synthetic demo evidence" : ""}).`,
              "reported",
              [],
              [asset.id],
            ),
          )
        : noEvidenceAttestation
          ? [
              statement(
                reportStatementId("evidence-attestation", noEvidenceAttestation.id),
                "A human recorded that no evidence was supplied for this local case. This completeness record does not establish that evidence does not exist.",
                "attested",
                [],
                [],
                [`completenessAttestations.${noEvidenceAttestation.id}`],
              ),
            ]
          : [],
    ),
  );

  const unresolvedQuestions = replayCase.questions
    .filter((question) => question.status === "open" || question.status === "deferred")
    .sort((a, b) => a.id.localeCompare(b.id));
  sections.push(
    section(
      "unresolved-questions",
      "Unresolved questions",
      unresolvedQuestions.length > 0
        ? unresolvedQuestions.map((question) =>
            statement(
              reportStatementId("question", question.id),
              `${evidenceBoundText(question.question)} (${question.status}; ${question.importance}).`,
              "system",
              question.relatedClaimIds.filter((id) => claimsById.has(id)),
              [],
              [`questions.${question.id}`],
            ),
          )
        : uncertaintyReviewAttestation
          ? [
              statement(
                reportStatementId("uncertainty-attestation", uncertaintyReviewAttestation.id),
                "A human completed the uncertainty review and recorded that no unresolved details remain at this case revision. This completeness record does not make unknown information certain.",
                "attested",
                [],
                [],
                [`completenessAttestations.${uncertaintyReviewAttestation.id}`],
              ),
            ]
          : [],
    ),
  );

  const hypothesisStatements: ReportStatement[] = [];
  if (options.includeHypotheses !== false) {
    for (const branch of branches) {
      const branchClaims = replayCase.claims.filter((claim) => claim.branchId === branch.id);
      hypothesisStatements.push(
        statement(
          reportStatementId("branch-label", branch.id),
          `Hypothesis — ${evidenceBoundText(branch.name)}: ${evidenceBoundText(branch.description)}`,
          "hypothesis",
          [],
          [],
          [`branches.${branch.id}`],
        ),
      );
      for (const assumption of branch.assumptions.filter((item) => item.status === "active")) {
        const relatedClaimIds = branchClaims.map((claim) => claim.id);
        const evidenceIds = linkedAvailableEvidence(replayCase, [
          ...assumption.supportingEvidenceIds,
          ...assumption.conflictingEvidenceIds,
        ]);
        if (relatedClaimIds.length === 0 && evidenceIds.length === 0) {
          missingRequirements.push(`Provenance for hypothesis assumption ${assumption.id}`);
        }
        hypothesisStatements.push(
          statement(
            reportStatementId("assumption", assumption.id),
            `${evidenceBoundText(assumption.statement)} This is an alternative assumption, not a factual conclusion.`,
            "hypothesis",
            relatedClaimIds,
            evidenceIds,
            [`branches.${branch.id}.assumptions.${assumption.id}`],
          ),
        );
      }
      for (const claim of branchClaims) {
        hypothesisStatements.push(
          statement(
            reportStatementId("hypothesis-claim", claim.id),
            `${claim.statement} This branch-specific detail is not confirmed.`,
            "hypothesis",
            [claim.id],
            linkedAvailableEvidence(replayCase, claim.linkedEvidenceIds),
          ),
        );
      }
    }
    for (const note of reviewedHypothesisNotes) {
      hypothesisStatements.push(
        statement(
          reportStatementId("note", note.id),
          `${evidenceBoundText(note.text)} This reviewed note remains in the hypothesis appendix and is not a factual conclusion.`,
          "hypothesis",
          note.claimIds.filter((id) => claimsById.has(id)),
          linkedAvailableEvidence(replayCase, note.evidenceIds),
        ),
      );
    }
  }
  sections.push(
    section(
      "hypothesis-appendix",
      "Hypothesis appendix — not factual conclusions",
      hypothesisStatements,
    ),
  );

  sections.push(
    section("method-limitations", "Method and limitations", [
      statement("report-method", REPORT_DISCLAIMER, "system", [], [], ["system.report-generator"]),
      statement(
        "report-method-version",
        `Generated from structured local case data at case version ${String(replayCase.caseVersion)}. Geometry and damage checks are informational consistency hints only.`,
        "system",
        [],
        [],
        ["system.report-generator"],
      ),
    ]),
  );

  sections.push(
    section("human-review", "Human review acknowledgement", [
      statement(
        "report-human-review",
        "This preview is not finalized. A human must review unresolved questions, acknowledge the limitations, review confirmed facts and every included unconfirmed or hypothesis statement, and manually finalize the factual report.",
        "system",
        [],
        [],
        ["system.human-review"],
      ),
    ]),
  );

  for (const reportSection of sections) {
    for (const reportStatement of reportSection.statements) {
      const hasClaimOrEvidenceCitation =
        reportStatement.citations.claimIds.length > 0 ||
        reportStatement.citations.evidenceIds.length > 0;
      const hasWorkspaceCitation = reportStatement.citations.workspacePaths.length > 0;
      if (
        (reportStatement.certainty === "confirmed" && !hasClaimOrEvidenceCitation) ||
        (reportStatement.certainty !== "confirmed" &&
          !hasClaimOrEvidenceCitation &&
          !hasWorkspaceCitation)
      ) {
        missingRequirements.push(`Claim or evidence provenance for ${reportStatement.id}`);
      }
    }
  }

  const includedClaimIds = [
    ...new Set(
      sections.flatMap((item) => item.statements.flatMap((entry) => entry.citations.claimIds)),
    ),
  ].sort();
  const includedEvidenceIds = [
    ...new Set(
      sections.flatMap((item) => item.statements.flatMap((entry) => entry.citations.evidenceIds)),
    ),
  ].sort();

  const preview: Omit<ReportPreview, "reviewBinding"> = {
    caseId: replayCase.id,
    caseVersion: replayCase.caseVersion,
    generatedAt,
    title: truncateXmlSafeText(
      `Factual incident report — ${evidenceBoundText(replayCase.title)}`,
      500,
    ),
    sections,
    includedClaimIds,
    includedEvidenceIds,
    unresolvedQuestionIds: unresolvedQuestions.map((question) => question.id),
    missingRequirements: [...new Set(missingRequirements)].sort(),
    disclaimer: REPORT_DISCLAIMER,
  };
  return {
    ...preview,
    reviewBinding: createReportPreviewReviewBinding(preview, {
      branchIds: branches.map((branch) => branch.id),
      includeHypotheses: options.includeHypotheses !== false,
    }),
  };
}

export function getReportSection(
  preview: ReportPreview,
  sectionId: string,
): ReportSection | undefined {
  return preview.sections.find((item) => item.id === sectionId);
}
