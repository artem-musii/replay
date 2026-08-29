import type { EvidenceAnnotationLink, EvidenceAsset, ReplayCase } from "../domain/models";

type EvidenceLinkTargetType = EvidenceAnnotationLink["targetType"];

export interface EvidenceCurrentLink {
  key: string;
  targetType: EvidenceLinkTargetType;
  targetId: string;
  label: string;
  annotationId?: string;
  scope: string;
}

function compactText(value: string, maxLength = 96): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function evidenceTargetLabel(
  replayCase: ReplayCase,
  targetType: EvidenceLinkTargetType,
  targetId: string,
): string {
  if (targetType === "assumption") {
    for (const branch of replayCase.branches) {
      const assumption = branch.assumptions.find((candidate) => candidate.id === targetId);
      if (assumption) return `Assumption · ${compactText(assumption.statement)}`;
    }
  }
  if (targetType === "actor") {
    const actor = replayCase.actors.find((candidate) => candidate.id === targetId);
    if (actor) return `Vehicle · ${actor.label}`;
  }
  if (targetType === "trajectory") {
    const trajectory = replayCase.trajectories.find((candidate) => candidate.id === targetId);
    if (trajectory) {
      const actor = replayCase.actors.find((candidate) => candidate.id === trajectory.actorId);
      return `Path · ${actor?.label ?? trajectory.actorId}`;
    }
  }
  if (targetType === "timeline-event") {
    const event = replayCase.timelineEvents.find((candidate) => candidate.id === targetId);
    if (event) return `Event · ${event.title}`;
  }
  if (targetType === "claim") {
    const claim = replayCase.claims.find((candidate) => candidate.id === targetId);
    if (claim) return `Observation · ${claim.statement}`;
  }
  if (targetType === "damage") {
    for (const actor of replayCase.actors) {
      const marker = actor.damageMarkers.find((candidate) => candidate.id === targetId);
      if (marker) {
        return `Damage · ${actor.label} · ${marker.region.replaceAll("-", " ")}`;
      }
    }
  }
  if (targetType === "hypothesis") {
    const branch = replayCase.branches.find((candidate) => candidate.id === targetId);
    if (branch) return `Hypothesis · ${branch.name}`;
  }
  return targetId;
}

export function evidenceCurrentLinks(
  asset: EvidenceAsset,
  replayCase: ReplayCase,
): EvidenceCurrentLink[] {
  const links: EvidenceCurrentLink[] = [];
  const seen = new Set<string>();
  function add(
    targetType: EvidenceLinkTargetType,
    targetId: string,
    scope: string,
    annotationId?: string,
  ): void {
    const key = `${targetType}:${targetId}:${annotationId ?? "asset"}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({
      key,
      targetType,
      targetId,
      label: evidenceTargetLabel(replayCase, targetType, targetId),
      scope,
      ...(annotationId ? { annotationId } : {}),
    });
  }

  const claimIds = new Set(asset.linkedClaimIds);
  for (const claim of replayCase.claims) {
    if (claim.linkedEvidenceIds.includes(asset.id) || claim.sourceIds.includes(asset.id)) {
      claimIds.add(claim.id);
    }
  }
  for (const claimId of claimIds) {
    const claim = replayCase.claims.find((candidate) => candidate.id === claimId);
    add(
      "claim",
      claimId,
      claim?.sourceIds.includes(asset.id) ? "Cited source" : "Whole evidence asset",
    );
  }

  const eventIds = new Set(asset.linkedEventIds);
  for (const event of replayCase.timelineEvents) {
    if (event.linkedEvidenceIds.includes(asset.id)) eventIds.add(event.id);
  }
  for (const eventId of eventIds) add("timeline-event", eventId, "Whole evidence asset");

  for (const sceneId of asset.linkedSceneObjectIds) {
    if (replayCase.actors.some((actor) => actor.id === sceneId)) {
      add("actor", sceneId, "Whole evidence asset");
      continue;
    }
    if (replayCase.trajectories.some((trajectory) => trajectory.id === sceneId)) {
      add("trajectory", sceneId, "Whole evidence asset");
      continue;
    }
    if (
      replayCase.actors.some((actor) => actor.damageMarkers.some((marker) => marker.id === sceneId))
    ) {
      add("damage", sceneId, "Whole evidence asset");
    }
  }

  const derivedBranchIds = new Set<string>();
  for (const eventId of eventIds) {
    const branchId = replayCase.timelineEvents.find((event) => event.id === eventId)?.branchId;
    if (branchId) derivedBranchIds.add(branchId);
  }
  for (const sceneId of asset.linkedSceneObjectIds) {
    const branchId = replayCase.trajectories.find(
      (trajectory) => trajectory.id === sceneId,
    )?.branchId;
    if (branchId) derivedBranchIds.add(branchId);
  }
  for (const branch of replayCase.branches) {
    for (const assumption of branch.assumptions) {
      if (assumption.supportingEvidenceIds.includes(asset.id)) {
        add("assumption", assumption.id, "Supporting evidence");
        derivedBranchIds.add(branch.id);
      }
    }
  }
  for (const branchId of asset.linkedBranchIds) {
    if (!derivedBranchIds.has(branchId)) add("hypothesis", branchId, "Whole evidence asset");
  }

  for (const annotationLink of asset.annotationLinks) {
    const annotation = asset.annotations.find(
      (candidate) => candidate.id === annotationLink.annotationId,
    );
    add(
      annotationLink.targetType,
      annotationLink.targetId,
      `Annotation · ${annotation?.label ?? annotationLink.annotationId}`,
      annotationLink.annotationId,
    );
  }
  return links;
}
