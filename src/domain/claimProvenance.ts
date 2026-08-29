import type { Claim, ClaimSourceType, ReplayCase } from "./models";

export const EXTERNALLY_ATTRIBUTED_CLAIM_SOURCE_TYPES = [
  "human-statement",
  "witness-statement",
  "photo",
  "document",
] as const satisfies readonly ClaimSourceType[];

export type ExternallyAttributedClaimSourceType =
  (typeof EXTERNALLY_ATTRIBUTED_CLAIM_SOURCE_TYPES)[number];

const externallyAttributedSourceTypes = new Set<ClaimSourceType>(
  EXTERNALLY_ATTRIBUTED_CLAIM_SOURCE_TYPES,
);

export function isExternallyAttributedClaimSourceType(
  sourceType: ClaimSourceType,
): sourceType is ExternallyAttributedClaimSourceType {
  return externallyAttributedSourceTypes.has(sourceType);
}

function hasTrustedHumanAttribution(claim: Claim): boolean {
  const lastAgentChangeIndex = claim.changeHistory.findLastIndex(
    (change) => change.author === "agent",
  );
  const lastHumanConfirmationIndex = claim.changeHistory.findLastIndex(
    (change) =>
      change.author === "human" && change.origin === "ui" && /confirm/i.test(change.summary),
  );
  if (claim.humanConfirmed && lastHumanConfirmationIndex > lastAgentChangeIndex) return true;
  return (
    claim.createdBy === "human" &&
    lastAgentChangeIndex === -1 &&
    claim.changeHistory.some((change) => change.author === "human" && change.origin === "ui")
  );
}

function isCompatibleSourceClaim(
  claim: Claim,
  sourceType: ExternallyAttributedClaimSourceType,
): boolean {
  return claim.sourceType === sourceType && hasTrustedHumanAttribution(claim);
}

/**
 * Returns only canonical sources that can support an agent's external-source
 * attribution. Context links may still refer to other case objects, but those
 * objects must not be stored as the claim's asserted provenance.
 */
export function compatibleAgentObservationSourceIds(
  replayCase: ReplayCase,
  sourceType: ClaimSourceType,
  candidateIds: readonly string[],
): string[] {
  const uniqueCandidateIds = [...new Set(candidateIds)];
  if (!isExternallyAttributedClaimSourceType(sourceType)) return uniqueCandidateIds;

  const claimsById = new Map(replayCase.claims.map((claim) => [claim.id, claim]));
  const activeImageEvidenceIds = new Set(
    replayCase.evidence
      .filter((asset) => !asset.deleted && asset.mimeType.startsWith("image/"))
      .map((asset) => asset.id),
  );

  return uniqueCandidateIds.filter((candidateId) => {
    if (
      (sourceType === "photo" || sourceType === "document") &&
      activeImageEvidenceIds.has(candidateId)
    )
      return true;
    const sourceClaim = claimsById.get(candidateId);
    return sourceClaim ? isCompatibleSourceClaim(sourceClaim, sourceType) : false;
  });
}

export function agentObservationSourceRequirement(
  sourceType: ExternallyAttributedClaimSourceType,
): string {
  if (sourceType === "photo") {
    return "active image evidence or an existing human-attributed photo observation";
  }
  if (sourceType === "document") {
    return "an active image of the document or an existing human-attributed document observation";
  }
  return `an existing human-attributed ${sourceType.replaceAll("-", " ")} observation`;
}
