import type { CompletenessAttestation, CompletenessAttestationInput, ReplayCase } from "./models";
import { canonicalSerialize, sha256Hex } from "./fingerprint";

export function completenessAttestationKey(
  subject: CompletenessAttestationInput | CompletenessAttestation,
): string {
  return subject.kind === "actor-damage" ? `${subject.kind}:${subject.actorId}` : subject.kind;
}

export function completenessBasisFingerprint(
  replayCase: ReplayCase,
  subject: CompletenessAttestationInput | CompletenessAttestation,
): string {
  let basis: unknown;
  if (subject.kind === "no-evidence-supplied") {
    basis = replayCase.evidence
      .map((asset) => ({
        id: asset.id,
        createdAt: asset.createdAt,
        deleted: asset.deleted,
        deletedAt: asset.deletedAt ?? null,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  } else if (subject.kind === "actor-damage") {
    const actor = replayCase.actors.find((candidate) => candidate.id === subject.actorId);
    basis = {
      actorId: subject.actorId,
      damageMarkers: (actor?.damageMarkers ?? [])
        .map((marker) => ({
          id: marker.id,
          region: marker.region,
          description: marker.description,
          status: marker.status,
          linkedClaimIds: [...marker.linkedClaimIds].sort(),
          linkedEvidenceIds: [...marker.linkedEvidenceIds].sort(),
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    };
  } else {
    basis = replayCase.questions
      .map((question) => ({
        id: question.id,
        question: question.question,
        reason: question.reason,
        status: question.status,
        answer: question.answer ?? null,
        updatedAt: question.updatedAt,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }
  return `completeness-v1-sha256-${sha256Hex(
    canonicalSerialize({
      subject:
        subject.kind === "actor-damage"
          ? {
              kind: subject.kind,
              actorId: subject.actorId,
              outcome: subject.outcome,
            }
          : { kind: subject.kind },
      basis,
    }),
  )}`;
}

export function isCompletenessAttestationCurrent(
  replayCase: ReplayCase,
  attestation: CompletenessAttestation,
): boolean {
  return (
    attestation.humanAttestationTrusted &&
    attestation.basisFingerprint === completenessBasisFingerprint(replayCase, attestation)
  );
}

export function findCompletenessAttestation(
  replayCase: ReplayCase,
  subject: CompletenessAttestationInput,
): CompletenessAttestation | undefined {
  const key = completenessAttestationKey(subject);
  return replayCase.completenessAttestations.find(
    (attestation) => completenessAttestationKey(attestation) === key,
  );
}

export function findCurrentCompletenessAttestation(
  replayCase: ReplayCase,
  subject: CompletenessAttestationInput,
): CompletenessAttestation | undefined {
  const attestation = findCompletenessAttestation(replayCase, subject);
  return attestation && isCompletenessAttestationCurrent(replayCase, attestation)
    ? attestation
    : undefined;
}
