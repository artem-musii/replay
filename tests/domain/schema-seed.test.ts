/* eslint-disable @typescript-eslint/no-non-null-assertion -- fixture objects are asserted by these focused tests */
import { describe, expect, it } from "vitest";

import {
  buildReportPreview,
  createBlankCase,
  createDemoCase,
  exportReplayCase,
  importReplayCase,
  prepareReplayCaseImport,
  REPLAY_MAX_ROTATION_DEGREES,
  REPLAY_MAX_SCENE_COORDINATE,
  REPLAY_MAX_TIMELINE_MS,
  REPLAY_MIN_CALIBRATION_METERS,
  REPLAY_SEED_VERSION,
  ReplayEngine,
  ReplayCaseSchema,
  ReplayCommandSchema,
  ReplayImportError,
  validateCaseReferences,
  validateConsistency,
} from "../../src/domain";

type DemoCase = ReturnType<typeof createDemoCase>;

function addIndexTestBranch(replayCase: DemoCase, id = "branch-index-alternative") {
  const baseline = replayCase.branches.find((branch) => branch.id === "branch-baseline");
  if (!baseline) throw new Error("Demo baseline branch is missing");
  const branch = structuredClone(baseline);
  branch.id = id;
  branch.name = "Index validation alternative";
  branch.parentBranchId = baseline.id;
  branch.trajectoryIds = [];
  branch.eventIds = [];
  branch.claimIds = [];
  branch.assumptions = [];
  replayCase.branches.push(branch);
  return branch;
}

function addIndexTestBranchClaim(replayCase: DemoCase, indexed = true) {
  const source = replayCase.claims[0];
  const baseline = replayCase.branches.find((branch) => branch.id === "branch-baseline");
  if (!source || !baseline) throw new Error("Demo claim/index fixtures are incomplete");
  const claim = structuredClone(source);
  claim.id = "claim-index-branch-specific";
  claim.statement = "Branch-specific index validation claim.";
  claim.branchId = baseline.id;
  claim.sharedAcrossBranches = false;
  claim.linkedEvidenceIds = [];
  claim.linkedEventIds = [];
  claim.linkedSceneObjectIds = [];
  claim.sourceIds = [];
  claim.humanConfirmed = false;
  delete claim.confirmedAt;
  replayCase.claims.push(claim);
  if (indexed) baseline.claimIds.push(claim.id);
  return claim;
}

function expectRejectedReferenceIssue(
  replayCase: DemoCase,
  expected: { path: string; message: string },
): void {
  expect(validateCaseReferences(replayCase)).toContainEqual(expected);
  try {
    importReplayCase(replayCase, { trustHumanAttestations: true });
    expect.unreachable(`Expected import to reject ${expected.message}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ReplayImportError);
    expect((error as ReplayImportError).issues).toContainEqual(expected);
  }
}

function createTrustResetFixture(): DemoCase {
  let sequence = 0;
  const engine = new ReplayEngine(createDemoCase(), {
    now: () => `2026-08-29T08:${String(sequence).padStart(2, "0")}:00.000Z`,
    idFactory: (prefix) => `${prefix}-import-summary-${String(++sequence)}`,
  });
  const poseAt = { branchId: "branch-baseline", timeMs: 7_000 } as const;

  const firstProposal = engine.execute({
    type: "proposal.create",
    actor: "agent",
    origin: "webmcp",
    proposalId: "proposal-import-summary-trusted",
    title: "Reviewed geometry alternative",
    rationale: "This proposal supplies trusted history for the import-reset fixture.",
    poseAt,
    changes: [
      {
        kind: "actor-pose",
        actorId: "actor-vehicle-a",
        proposedPose: { x: 65, y: 54, rotationDeg: 12 },
      },
    ],
  });
  if (!firstProposal.ok) throw new Error(firstProposal.error.message);
  const adjustedProposal = engine.execute({
    type: "proposal.adjust",
    actor: "human",
    origin: "ui",
    proposalId: "proposal-import-summary-trusted",
    summary: "Refined the alternative after checking the scene overlay.",
    poseAt,
    changes: [
      {
        kind: "actor-pose",
        actorId: "actor-vehicle-a",
        proposedPose: { x: 66, y: 53, rotationDeg: 10 },
      },
    ],
  });
  if (!adjustedProposal.ok) throw new Error(adjustedProposal.error.message);
  const firstDecision = engine.execute({
    type: "proposal.reject",
    actor: "human",
    origin: "ui",
    proposalId: "proposal-import-summary-trusted",
    note: "Kept only as reviewed history for this fixture.",
  });
  if (!firstDecision.ok) throw new Error(firstDecision.error.message);

  const secondProposal = engine.execute({
    type: "proposal.create",
    actor: "agent",
    origin: "webmcp",
    proposalId: "proposal-import-summary-already-untrusted",
    title: "Previously imported alternative",
    rationale: "This proposal proves the summary excludes history that is already untrusted.",
    poseAt,
    changes: [
      {
        kind: "actor-pose",
        actorId: "actor-vehicle-b",
        proposedPose: { x: 67, y: 48, rotationDeg: 22 },
      },
    ],
  });
  if (!secondProposal.ok) throw new Error(secondProposal.error.message);
  const secondDecision = engine.execute({
    type: "proposal.reject",
    actor: "human",
    origin: "ui",
    proposalId: "proposal-import-summary-already-untrusted",
  });
  if (!secondDecision.ok) throw new Error(secondDecision.error.message);

  const replayCase = structuredClone(engine.state);
  const alreadyUntrustedProposal = replayCase.proposals.find(
    (proposal) => proposal.id === "proposal-import-summary-already-untrusted",
  );
  if (!alreadyUntrustedProposal?.decision) throw new Error("Proposal decision fixture is missing");
  alreadyUntrustedProposal.revisions.forEach((revision) => {
    revision.authorshipTrusted = false;
  });
  alreadyUntrustedProposal.decision.humanAttestationTrusted = false;

  const [firstEvidence, secondEvidence, alreadyDeletedEvidence] = replayCase.evidence;
  if (!firstEvidence || !secondEvidence || !alreadyDeletedEvidence) {
    throw new Error("Evidence fixture is incomplete");
  }
  [firstEvidence, secondEvidence].forEach((asset, index) => {
    asset.localBlobKey = `evidence:active-import-file-${String(index + 1)}`;
    asset.source = "local-upload";
    asset.syntheticDemoAsset = false;
  });
  alreadyDeletedEvidence.localBlobKey = "evidence:already-deleted-import-file";
  alreadyDeletedEvidence.source = "local-upload";
  alreadyDeletedEvidence.syntheticDemoAsset = false;
  alreadyDeletedEvidence.deleted = true;
  alreadyDeletedEvidence.deletedAt = "2026-08-28T12:00:00.000Z";

  const answeredQuestion = replayCase.questions[0];
  if (!answeredQuestion) throw new Error("Question fixture is missing");
  answeredQuestion.status = "answered";
  answeredQuestion.answer = "The available account does not establish a lane crossing.";
  answeredQuestion.answerSource = "human-statement";

  replayCase.reportNotes.push(
    {
      id: "report-note-import-summary-reviewed",
      text: "Reviewed note that must return to pending review after unsigned import.",
      claimIds: ["claim-initial-statement"],
      evidenceIds: [firstEvidence.id],
      createdBy: "agent",
      reviewedByHuman: true,
      createdAt: "2026-08-29T09:00:00.000Z",
    },
    {
      id: "report-note-import-summary-pending",
      text: "Pending note that must not inflate the trust-reset summary.",
      claimIds: ["claim-initial-statement"],
      evidenceIds: [],
      createdBy: "agent",
      reviewedByHuman: false,
      createdAt: "2026-08-29T09:00:00.000Z",
    },
  );
  replayCase.completenessAttestations.push(
    {
      id: "completeness-import-summary-trusted",
      kind: "uncertainty-review-completed",
      attestedBy: "human",
      origin: "ui",
      attestedAt: "2026-08-29T09:01:00.000Z",
      basisFingerprint: `completeness-v1-sha256-${"a".repeat(64)}`,
      humanAttestationTrusted: true,
    },
    {
      id: "completeness-import-summary-already-untrusted",
      kind: "uncertainty-review-completed",
      attestedBy: "human",
      origin: "ui",
      attestedAt: "2026-08-29T09:02:00.000Z",
      basisFingerprint: `completeness-v1-sha256-${"b".repeat(64)}`,
      humanAttestationTrusted: false,
    },
  );

  const preview = buildReportPreview(replayCase, {
    generatedAt: "2026-08-29T09:10:00.000Z",
  });
  replayCase.caseVersion += 1;
  replayCase.updatedAt = "2026-08-29T09:11:00.000Z";
  replayCase.reportSnapshots.push({
    id: "snapshot-import-summary",
    caseVersion: replayCase.caseVersion,
    createdAt: replayCase.updatedAt,
    confirmedClaimIds: preview.includedClaimIds.filter((claimId) =>
      replayCase.claims.some(
        (claim) => claim.id === claimId && claim.status === "confirmed" && claim.humanConfirmed,
      ),
    ),
    includedEvidenceIds: preview.includedEvidenceIds,
    unresolvedQuestionIds: preview.unresolvedQuestionIds,
    branchIds: preview.reviewBinding?.branchIds ?? [],
    humanAcknowledged: true,
    immutable: true,
    preview,
  });
  replayCase.consistencyIssues = validateConsistency(replayCase);
  return replayCase;
}

describe("versioned case schemas and seeds", () => {
  it("creates the exact same validated demo case on every reset", () => {
    const first = createDemoCase();
    const second = createDemoCase();

    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe(2);
    expect(first.seedVersion).toBe(REPLAY_SEED_VERSION);
    expect(ReplayCaseSchema.parse(first)).toEqual(first);
    expect(validateCaseReferences(first)).toEqual([]);
  });

  it("keeps every supported persisted seed version schema-compatible", () => {
    for (let seedVersion = 1; seedVersion <= REPLAY_SEED_VERSION; seedVersion += 1) {
      const replayCase = createDemoCase();
      replayCase.seedVersion = seedVersion;
      expect(ReplayCaseSchema.parse(replayCase).seedVersion).toBe(seedVersion);
    }
  });

  it("uses calibrated footprints without a false impact-separation warning or fault conclusion", () => {
    const replayCase = createDemoCase();
    const ruleIds = replayCase.consistencyIssues.map((issue) => issue.ruleId);
    expect(
      replayCase.consistencyIssues.some((issue) => issue.ruleId === "geometry.impact-separation"),
    ).toBe(false);
    expect(ruleIds).not.toContain("geometry.actor-outside-scene");
    expect(ruleIds).not.toContain("geometry.keyframe-outside-scene");
    expect(ruleIds).not.toContain("geometry.impact-excessive-penetration");
    expect(ruleIds).not.toContain("geometry.unmarked-footprint-overlap");
    expect(ruleIds).not.toContain("damage.contact-direction-hint");
    expect(JSON.stringify(replayCase).toLowerCase()).not.toContain("at fault");
    expect(replayCase.evidence.every((asset) => asset.syntheticDemoAsset)).toBe(true);
  });

  it("keeps both demo vehicles moving counter-clockwise in the same traffic flow", () => {
    const replayCase = createDemoCase();
    const vehicleA = replayCase.trajectories.find(
      (trajectory) => trajectory.id === "trajectory-a-baseline",
    )!;
    const vehicleB = replayCase.trajectories.find(
      (trajectory) => trajectory.id === "trajectory-b-baseline",
    )!;

    expect(vehicleA.interpolationMode).toBe("smooth");
    expect(vehicleB.interpolationMode).toBe("smooth");
    expect(vehicleA.keyframes).toHaveLength(12);
    expect(vehicleB.keyframes).toHaveLength(12);
    expect(vehicleB.keyframes.map((keyframe) => keyframe.timeMs)).toEqual(
      vehicleA.keyframes.map((keyframe) => keyframe.timeMs),
    );
    expect(vehicleB.keyframes.map((keyframe) => keyframe.x)).toEqual(
      [...vehicleB.keyframes.map((keyframe) => keyframe.x)].sort((first, second) => first - second),
    );
    expect(vehicleA.keyframes.map((keyframe) => keyframe.x)).toEqual(
      [...vehicleA.keyframes.map((keyframe) => keyframe.x)].sort((first, second) => first - second),
    );

    const impactIndex = vehicleA.keyframes.findIndex((keyframe) => keyframe.timeMs === 10_000);
    expect(impactIndex).toBeGreaterThan(0);
    expect(vehicleB.keyframes[impactIndex]!.x).toBeGreaterThan(vehicleA.keyframes[impactIndex]!.x);
    expect(
      Math.abs(
        vehicleB.keyframes[impactIndex]!.rotationDeg - vehicleA.keyframes[impactIndex]!.rotationDeg,
      ),
    ).toBe(0);
  });

  it("rejects unknown persisted fields", () => {
    const raw = { ...createDemoCase(), injected: "ignored?" };
    expect(() => ReplayCaseSchema.parse(raw)).toThrow();
  });

  it("creates a strict but intentionally incomplete blank case", () => {
    const blank = createBlankCase(
      {
        title: "Parking exit incident",
        sceneType: "intersection",
        roadCondition: "dry",
        vehicleCount: 2,
        initialStatement: "Vehicle A was stopped near the exit.",
      },
      { now: "2026-08-27T10:00:00.000Z", caseId: "case-blank-test" },
    );

    expect(blank.id).toBe("case-blank-test");
    expect(blank.actors).toHaveLength(2);
    expect(blank.actors.map((actor) => actor.pose)).toEqual([
      { x: 24, y: 56.4, rotationDeg: 90 },
      { x: 76, y: 43.6, rotationDeg: 270 },
    ]);
    expect(blank.environment.postedSpeedLimitKph).toBeUndefined();
    expect(blank.claims[0]?.status).toBe("reported");
    expect(blank.consistencyIssues.some((issue) => issue.ruleId === "completeness.timeline")).toBe(
      true,
    );
    expect(ReplayCaseSchema.parse(blank)).toEqual(blank);
  });
});

describe("case import and export", () => {
  it("round-trips a case through strict JSON validation", () => {
    const original = createDemoCase();
    const json = exportReplayCase(original);
    const restored = importReplayCase(json, { trustHumanAttestations: true });
    expect(restored).toEqual(original);
  });

  it("preflights the exact trust and local-file effects of an unsigned import", () => {
    const original = createTrustResetFixture();
    expect(validateCaseReferences(original)).toEqual([]);
    const originalVersion = original.caseVersion;

    const prepared = prepareReplayCaseImport(exportReplayCase(original), {
      now: "2026-08-29T12:00:00.000Z",
    });

    expect(prepared.trustResetSummary).toEqual({
      confirmedClaims: 4,
      confirmedDamageMarkers: 2,
      confirmedTimelineEvents: 1,
      answeredQuestions: 1,
      evidenceFilesUnavailable: 2,
      reviewedReportNotes: 1,
      completenessAttestations: 1,
      finalizedSnapshots: 1,
      proposalRevisions: 2,
      proposalDecisions: 1,
    });

    const imported = prepared.replayCase;
    expect(imported.caseVersion).toBe(originalVersion + 1);
    expect(imported.updatedAt).toBe("2026-08-29T12:00:00.000Z");
    expect(imported.claims.every((claim) => claim.status !== "confirmed")).toBe(true);
    expect(
      imported.claims.every((claim) => !claim.humanConfirmed && claim.confirmedAt === undefined),
    ).toBe(true);
    expect(
      imported.claims
        .flatMap((claim) => claim.changeHistory)
        .every(
          (change) =>
            change.author === "system" &&
            change.origin === "system" &&
            change.summary.startsWith("Imported history (unverified):"),
        ),
    ).toBe(true);
    expect(
      imported.actors
        .flatMap((actor) => actor.damageMarkers)
        .every((marker) => marker.status !== "confirmed"),
    ).toBe(true);
    expect(imported.timelineEvents.every((event) => event.certainty !== "confirmed")).toBe(true);
    expect(imported.questions[0]).toMatchObject({ status: "open" });
    expect(imported.questions[0]?.answer).toBeUndefined();
    expect(imported.questions[0]?.answerSource).toBeUndefined();

    const importedLocalFiles = imported.evidence.filter((asset) =>
      asset.localBlobKey.startsWith("evidence:"),
    );
    expect(importedLocalFiles).toHaveLength(3);
    expect(
      importedLocalFiles.every(
        (asset) =>
          asset.deleted &&
          asset.deletedAt === "2026-08-29T12:00:00.000Z" &&
          asset.source === "import",
      ),
    ).toBe(true);
    expect(imported.reportNotes.every((note) => !note.reviewedByHuman)).toBe(true);
    expect(
      imported.completenessAttestations.every(
        (attestation) => !attestation.humanAttestationTrusted,
      ),
    ).toBe(true);
    expect(imported.reportSnapshots).toEqual([]);
    expect(
      imported.proposals
        .flatMap((proposal) => proposal.revisions)
        .every((revision) => !revision.authorshipTrusted),
    ).toBe(true);
    expect(
      imported.proposals.every((proposal) => !proposal.decision?.humanAttestationTrusted),
    ).toBe(true);
    expect(imported.activity.at(-1)).toMatchObject({
      caseVersion: originalVersion + 1,
      author: "system",
      origin: "system",
      actionType: "case.imported-untrusted",
      affectedIds: [original.id],
      undoable: false,
      createdAt: "2026-08-29T12:00:00.000Z",
    });
    expect(validateCaseReferences(imported)).toEqual([]);

    // Preparing an import must not mutate the parsed source or promote already-untrusted history.
    expect(original.reportSnapshots).toHaveLength(1);
    expect(original.completenessAttestations.map((item) => item.humanAttestationTrusted)).toEqual([
      true,
      false,
    ]);
    expect(original.proposals[1]?.decision?.humanAttestationTrusted).toBe(false);
  });

  it("reports no resets and preserves attestations for an explicitly trusted internal import", () => {
    const original = createTrustResetFixture();
    expect(validateCaseReferences(original)).toEqual([]);

    const prepared = prepareReplayCaseImport(exportReplayCase(original), {
      trustHumanAttestations: true,
      now: "2026-08-29T12:00:00.000Z",
    });

    expect(prepared.trustResetSummary).toEqual({
      confirmedClaims: 0,
      confirmedDamageMarkers: 0,
      confirmedTimelineEvents: 0,
      answeredQuestions: 0,
      evidenceFilesUnavailable: 0,
      reviewedReportNotes: 0,
      completenessAttestations: 0,
      finalizedSnapshots: 0,
      proposalRevisions: 0,
      proposalDecisions: 0,
    });
    expect(prepared.replayCase).toEqual(original);
    expect(prepared.replayCase.reportSnapshots).toHaveLength(1);
    expect(prepared.replayCase.questions[0]).toMatchObject({ status: "answered" });
    expect(
      prepared.replayCase.evidence.filter(
        (asset) => !asset.deleted && asset.localBlobKey.startsWith("evidence:"),
      ),
    ).toHaveLength(2);
    expect(
      prepared.replayCase.proposals[0]?.revisions.every((revision) => revision.authorshipTrusted),
    ).toBe(true);
    expect(prepared.replayCase.proposals[0]?.decision?.humanAttestationTrusted).toBe(true);
  });

  it("keeps reset import history valid at a surrogate-pair truncation boundary", () => {
    const original = createDemoCase();
    original.activity[0]!.summary = `${"A".repeat(468)}😀`;

    const restored = importReplayCase(exportReplayCase(original), {
      now: "2026-08-29T12:00:00.000Z",
    });

    expect(restored.activity[0]!.summary).toBe(`Imported history (unverified): ${"A".repeat(468)}`);
    expect(restored.activity[0]!.summary.length).toBe(499);
  });

  it("can re-key an imported transfer so it cannot overwrite its source case", () => {
    const original = createDemoCase();
    original.claims[0]!.sourceIds = [original.id];
    original.activity[0]!.affectedIds = [original.id];
    original.consistencyIssues[0]!.affectedIds = [original.id];
    original.selectedItem = { type: "report", id: original.id };
    const preview = buildReportPreview(original, {
      generatedAt: "2026-08-27T10:00:00.000Z",
    });
    original.caseVersion += 1;
    original.updatedAt = "2026-08-27T10:01:00.000Z";
    original.reportSnapshots.push({
      id: "snapshot-rekey-test",
      caseVersion: original.caseVersion,
      createdAt: "2026-08-27T10:01:00.000Z",
      confirmedClaimIds: preview.includedClaimIds,
      includedEvidenceIds: preview.includedEvidenceIds,
      unresolvedQuestionIds: preview.unresolvedQuestionIds,
      branchIds: original.branches.map((branch) => branch.id),
      humanAcknowledged: true,
      immutable: true,
      preview,
    });

    const restored = importReplayCase(exportReplayCase(original), {
      trustHumanAttestations: true,
      rekeyCaseId: "case-import-copy",
    });

    expect(restored.id).toBe("case-import-copy");
    expect(restored.claims[0]!.sourceIds).toEqual(["case-import-copy"]);
    expect(restored.activity[0]!.affectedIds).toEqual(["case-import-copy"]);
    expect(
      restored.consistencyIssues.every((issue) => !issue.affectedIds.includes(original.id)),
    ).toBe(true);
    expect(restored.selectedItem).toEqual({ type: "report", id: "case-import-copy" });
    expect(restored.reportSnapshots[0]!.preview.caseId).toBe("case-import-copy");
    expect(validateCaseReferences(restored)).toEqual([]);
  });

  it("migrates a version 1 backup to the current annotation-link shape", () => {
    const current = createDemoCase();
    const legacy = {
      ...current,
      schemaVersion: 1,
      evidence: current.evidence.map((asset) => {
        const legacyAsset: Partial<typeof asset> = structuredClone(asset);
        delete legacyAsset.annotationLinks;
        return legacyAsset;
      }),
    };

    const restored = importReplayCase(JSON.stringify(legacy));

    expect(restored.schemaVersion).toBe(2);
    expect(restored.evidence.every((asset) => asset.annotationLinks.length === 0)).toBe(true);
    expect(ReplayCaseSchema.parse(restored)).toEqual(restored);
  });

  it("rejects malformed JSON, unsupported versions, and dangling references", () => {
    expect(() => importReplayCase("{nope")).toThrow(ReplayImportError);
    expect(() => importReplayCase({ ...createDemoCase(), schemaVersion: 999 })).toThrow(
      /Unsupported/,
    );

    const dangling = createDemoCase();
    dangling.claims[0]!.linkedEvidenceIds.push("evidence-missing");
    expect(() => importReplayCase(dangling)).toThrow(ReplayImportError);
  });

  it("enforces a bounded JSON import size", () => {
    expect(() => importReplayCase(JSON.stringify(createDemoCase()), { maxBytes: 10 })).toThrow(
      /exceeds/,
    );
  });

  it("rejects hostile scene, rotation, and timing magnitudes before conversion", () => {
    const hostileCases: Array<{
      path: string;
      message: string;
      mutate: (replayCase: ReturnType<typeof createDemoCase>) => void;
    }> = [
      {
        path: "actors.0.pose.x",
        message: "Scene coordinate magnitude must not exceed 1,000,000",
        mutate: (replayCase) => {
          replayCase.actors[0]!.pose.x = 1e308;
        },
      },
      {
        path: "actors.0.pose.rotationDeg",
        message: "Rotation magnitude must not exceed 1,000,000 degrees",
        mutate: (replayCase) => {
          replayCase.actors[0]!.pose.rotationDeg = Number.MAX_VALUE;
        },
      },
      {
        path: "environment.bounds.minX",
        message: "Scene coordinate magnitude must not exceed 1,000,000",
        mutate: (replayCase) => {
          replayCase.environment.bounds.minX = -Number.MAX_VALUE;
          replayCase.environment.bounds.maxX = Number.MAX_VALUE;
        },
      },
      {
        path: "timelineEvents.0.timeMs",
        message: "Timeline value must not exceed 31,536,000,000 milliseconds",
        mutate: (replayCase) => {
          replayCase.timelineEvents[0]!.timeMs = 1e308;
        },
      },
      {
        path: "environment.calibration.widthMeters",
        message: "Calibrated scene width must be at least 0.01 metres",
        mutate: (replayCase) => {
          replayCase.environment.calibration.widthMeters = Number.MIN_VALUE;
        },
      },
      {
        path: "environment.bounds",
        message: "Environment bounds must span at least 0.001 scene units on each axis",
        mutate: (replayCase) => {
          replayCase.environment.bounds.maxX = Number.MIN_VALUE;
        },
      },
      {
        path: "timeRangeMs",
        message: "Time range must span at least 1 millisecond",
        mutate: (replayCase) => {
          replayCase.timeRangeMs.end = Number.MIN_VALUE;
        },
      },
    ];

    for (const hostileCase of hostileCases) {
      const replayCase = createDemoCase();
      hostileCase.mutate(replayCase);
      try {
        importReplayCase(JSON.stringify(replayCase), { trustHumanAttestations: true });
        expect.unreachable(`Expected ${hostileCase.path} to fail schema validation.`);
      } catch (error) {
        expect(error).toBeInstanceOf(ReplayImportError);
        expect((error as Error).message).toContain(hostileCase.path);
        expect((error as Error).message).toContain(hostileCase.message);
      }
    }
  });

  it("accepts safe numeric boundaries and XML-safe whitespace in a schema-v2 import", () => {
    const replayCase = createDemoCase();
    replayCase.title = "Boundary case\twith allowed XML whitespace";
    replayCase.claims[0]!.statement = "Line one\nLine two\r\nEmoji remains valid: 😀";
    replayCase.environment.bounds = {
      minX: -REPLAY_MAX_SCENE_COORDINATE,
      minY: -REPLAY_MAX_SCENE_COORDINATE,
      maxX: REPLAY_MAX_SCENE_COORDINATE,
      maxY: REPLAY_MAX_SCENE_COORDINATE,
    };
    replayCase.environment.calibration.widthMeters = REPLAY_MIN_CALIBRATION_METERS;
    replayCase.environment.calibration.heightMeters = REPLAY_MIN_CALIBRATION_METERS;
    replayCase.actors[0]!.pose = {
      x: REPLAY_MAX_SCENE_COORDINATE,
      y: -REPLAY_MAX_SCENE_COORDINATE,
      rotationDeg: REPLAY_MAX_ROTATION_DEGREES,
    };
    replayCase.timeRangeMs.end = REPLAY_MAX_TIMELINE_MS;
    replayCase.trajectories[0]!.keyframes.at(-1)!.timeMs = REPLAY_MAX_TIMELINE_MS;
    replayCase.timelineEvents.at(-1)!.timeMs = REPLAY_MAX_TIMELINE_MS;

    expect(ReplayCaseSchema.parse(replayCase)).toEqual(replayCase);
    const restored = importReplayCase(JSON.stringify(replayCase), {
      trustHumanAttestations: true,
    });
    expect(restored.title).toBe(replayCase.title);
    expect(restored.claims[0]!.statement).toBe(replayCase.claims[0]!.statement);
    expect(restored.actors[0]!.pose).toEqual(replayCase.actors[0]!.pose);
    expect(restored.timeRangeMs.end).toBe(REPLAY_MAX_TIMELINE_MS);
    expect(restored.environment.calibration).toMatchObject({
      widthMeters: REPLAY_MIN_CALIBRATION_METERS,
      heightMeters: REPLAY_MIN_CALIBRATION_METERS,
    });
  });

  it.each([
    {
      name: "case title NUL",
      path: "title",
      mutate: (replayCase: ReturnType<typeof createDemoCase>) => {
        replayCase.title = "Unsafe\u0000title";
      },
    },
    {
      name: "actor label vertical tab",
      path: "actors.0.label",
      mutate: (replayCase: ReturnType<typeof createDemoCase>) => {
        replayCase.actors[0]!.label = "Unsafe\u000Blabel";
      },
    },
    {
      name: "claim statement form feed",
      path: "claims.0.statement",
      mutate: (replayCase: ReturnType<typeof createDemoCase>) => {
        replayCase.claims[0]!.statement = "Unsafe\u000Cstatement";
      },
    },
    {
      name: "evidence notes unit separator",
      path: "evidence.0.notes",
      mutate: (replayCase: ReturnType<typeof createDemoCase>) => {
        replayCase.evidence[0]!.notes = "Unsafe\u001Fnotes";
      },
    },
  ])("rejects XML 1.0-invalid controls in $name", ({ path, mutate }) => {
    const replayCase = createDemoCase();
    mutate(replayCase);

    try {
      importReplayCase(JSON.stringify(replayCase), { trustHumanAttestations: true });
      expect.unreachable(`Expected ${path} to reject XML-invalid text.`);
    } catch (error) {
      expect(error).toBeInstanceOf(ReplayImportError);
      expect((error as Error).message).toContain(path);
      expect((error as Error).message).toContain(
        "Text contains a character that XML 1.0 cannot serialize",
      );
    }
  });

  it("applies the same numeric and XML-safe text bounds to canonical commands", () => {
    const unsafeText = ReplayCommandSchema.safeParse({
      type: "claim.add",
      actor: "human",
      origin: "ui",
      statement: "Unsafe\u0000claim",
      status: "reported",
      sourceType: "human-statement",
    });
    const unsafePose = ReplayCommandSchema.safeParse({
      type: "actor.update-pose",
      actor: "human",
      origin: "ui",
      actorId: "actor-vehicle-a",
      pose: { x: 1e308, y: 50, rotationDeg: 0 },
    });

    expect(unsafeText.success).toBe(false);
    expect(unsafeText.error?.issues[0]?.message).toContain("XML 1.0");
    expect(unsafePose.success).toBe(false);
    expect(unsafePose.error?.issues[0]?.message).toContain("1,000,000");
  });

  it("keeps malformed schema diagnostics concise", () => {
    const malformed = {
      ...createDemoCase(),
      actors: Array.from({ length: 100 }, () => "not-an-actor"),
    };

    try {
      importReplayCase(JSON.stringify(malformed));
      expect.unreachable("The malformed case should have been rejected.");
    } catch (error) {
      expect(error).toBeInstanceOf(ReplayImportError);
      expect((error as Error).message).toContain("Case import failed schema validation");
      expect((error as Error).message.length).toBeLessThan(1_500);
      expect((error as Error).message).toContain("more issues omitted");
    }
  });

  it("caps reference diagnostics from adversarial but schema-valid arrays", () => {
    const malformed = createDemoCase();
    const missingIds = Array.from({ length: 500 }, (_, index) => `missing-${String(index)}`);
    const claim = malformed.claims[0]!;
    claim.linkedEvidenceIds = missingIds;
    claim.linkedEventIds = missingIds;
    claim.linkedSceneObjectIds = missingIds;
    claim.sourceIds = missingIds;

    try {
      importReplayCase(JSON.stringify(malformed), { trustHumanAttestations: true });
      expect.unreachable("The malformed references should have been rejected.");
    } catch (error) {
      expect(error).toBeInstanceOf(ReplayImportError);
      expect((error as ReplayImportError).issues).toHaveLength(1_000);
      expect((error as ReplayImportError).issues[0]?.message).toContain(
        "Missing referenced object",
      );
    }
  });

  it("rejects IDs reused by different object kinds", () => {
    const replayCase = createDemoCase();
    replayCase.evidence[0]!.id = replayCase.actors[0]!.id;
    expect(() => importReplayCase(replayCase)).toThrow(/invalid object references/i);
  });

  it("rejects omitted reverse branch indexes for trajectories, events, and both claim scopes", () => {
    const omittedTrajectory = createDemoCase();
    omittedTrajectory.branches[0]!.trajectoryIds =
      omittedTrajectory.branches[0]!.trajectoryIds.filter((id) => id !== "trajectory-a-baseline");
    expectRejectedReferenceIssue(omittedTrajectory, {
      path: "branches.0.trajectoryIds",
      message:
        "Trajectory trajectory-a-baseline is missing from owning branch branch-baseline.trajectoryIds",
    });

    const omittedEvent = createDemoCase();
    omittedEvent.branches[0]!.eventIds = omittedEvent.branches[0]!.eventIds.filter(
      (id) => id !== "event-impact",
    );
    expectRejectedReferenceIssue(omittedEvent, {
      path: "branches.0.eventIds",
      message: "Timeline event event-impact is missing from owning branch branch-baseline.eventIds",
    });

    const omittedBranchClaim = createDemoCase();
    const branchClaim = addIndexTestBranchClaim(omittedBranchClaim, false);
    expectRejectedReferenceIssue(omittedBranchClaim, {
      path: "branches.0.claimIds",
      message: `Branch claim ${branchClaim.id} is missing from owning branch branch-baseline.claimIds`,
    });

    const omittedSharedClaim = createDemoCase();
    omittedSharedClaim.branches[0]!.sharedClaimIds =
      omittedSharedClaim.branches[0]!.sharedClaimIds.filter(
        (id) => id !== "claim-initial-statement",
      );
    expectRejectedReferenceIssue(omittedSharedClaim, {
      path: "branches.0.sharedClaimIds",
      message:
        "Shared claim claim-initial-statement is missing from branch branch-baseline.sharedClaimIds",
    });
  });

  it("rejects child IDs indexed by a non-owning branch", () => {
    const wrongTrajectoryOwner = createDemoCase();
    addIndexTestBranch(wrongTrajectoryOwner).trajectoryIds.push("trajectory-a-baseline");
    expectRejectedReferenceIssue(wrongTrajectoryOwner, {
      path: "branches.1.trajectoryIds.0",
      message: "Trajectory belongs to a different branch",
    });

    const wrongEventOwner = createDemoCase();
    addIndexTestBranch(wrongEventOwner).eventIds.push("event-impact");
    expectRejectedReferenceIssue(wrongEventOwner, {
      path: "branches.1.eventIds.0",
      message: "Timeline event belongs to a different branch",
    });

    const wrongClaimOwner = createDemoCase();
    const branchClaim = addIndexTestBranchClaim(wrongClaimOwner);
    addIndexTestBranch(wrongClaimOwner).claimIds.push(branchClaim.id);
    expectRejectedReferenceIssue(wrongClaimOwner, {
      path: "branches.1.claimIds.0",
      message: "Claim is not a non-shared claim owned by this branch",
    });
  });

  it("rejects duplicate IDs in every branch ownership index", () => {
    const duplicateCases: Array<{
      collection: "sharedClaimIds" | "trajectoryIds" | "eventIds" | "claimIds";
      label: string;
      objectId: string;
      createCase: () => DemoCase;
    }> = [
      {
        collection: "sharedClaimIds",
        label: "shared claim ID",
        objectId: "claim-initial-statement",
        createCase: createDemoCase,
      },
      {
        collection: "trajectoryIds",
        label: "trajectory ID",
        objectId: "trajectory-a-baseline",
        createCase: createDemoCase,
      },
      {
        collection: "eventIds",
        label: "timeline event ID",
        objectId: "event-impact",
        createCase: createDemoCase,
      },
      {
        collection: "claimIds",
        label: "branch claim ID",
        objectId: "claim-index-branch-specific",
        createCase: () => {
          const replayCase = createDemoCase();
          addIndexTestBranchClaim(replayCase);
          return replayCase;
        },
      },
    ];

    duplicateCases.forEach(({ collection, label, objectId, createCase }) => {
      const replayCase = createCase();
      const index = replayCase.branches[0]![collection].length;
      const firstIndex = replayCase.branches[0]![collection].indexOf(objectId);
      replayCase.branches[0]![collection].push(objectId);
      expectRejectedReferenceIssue(replayCase, {
        path: `branches.0.${collection}.${String(index)}`,
        message: `Duplicate ${label} ${objectId}; first indexed at branches.0.${collection}.${String(firstIndex)}`,
      });
    });
  });

  it("rejects contradictory global and branch-scoped claim ownership flags", () => {
    const nonSharedWithoutBranch = createDemoCase();
    nonSharedWithoutBranch.claims[0]!.sharedAcrossBranches = false;
    expectRejectedReferenceIssue(nonSharedWithoutBranch, {
      path: "claims.0.branchId",
      message: "Non-shared claim claim-initial-statement requires an owning branchId",
    });

    const branchScopedAndShared = createDemoCase();
    branchScopedAndShared.claims[0]!.branchId = "branch-baseline";
    expectRejectedReferenceIssue(branchScopedAndShared, {
      path: "claims.0.sharedAcrossBranches",
      message:
        "Claim claim-initial-statement cannot be both branch-scoped and shared across branches",
    });
  });

  it("rejects asymmetric damage, claim, event, and evidence provenance pairs", () => {
    const missingEvidenceSceneBacklink = createDemoCase();
    missingEvidenceSceneBacklink.evidence.find(
      (asset) => asset.id === "evidence-damage-a",
    )!.linkedSceneObjectIds = ["actor-vehicle-a"];
    expectRejectedReferenceIssue(missingEvidenceSceneBacklink, {
      path: "actors.0.damageMarkers.0.linkedEvidenceIds.0",
      message:
        "Evidence evidence-damage-a is missing its reverse scene link to damage marker damage-a-front-left",
    });

    const missingMarkerEvidenceBacklink = createDemoCase();
    missingMarkerEvidenceBacklink.actors[0]!.damageMarkers[0]!.linkedEvidenceIds = [];
    expectRejectedReferenceIssue(missingMarkerEvidenceBacklink, {
      path: "evidence.1.linkedSceneObjectIds.1",
      message:
        "Damage marker damage-a-front-left is missing its reverse link to evidence evidence-damage-a",
    });

    const missingClaimSceneBacklink = createDemoCase();
    missingClaimSceneBacklink.claims.find(
      (claim) => claim.id === "claim-damage-a",
    )!.linkedSceneObjectIds = ["actor-vehicle-a"];
    expectRejectedReferenceIssue(missingClaimSceneBacklink, {
      path: "actors.0.damageMarkers.0.linkedClaimIds.0",
      message:
        "Claim claim-damage-a is missing its reverse scene link to damage marker damage-a-front-left",
    });

    const missingMarkerClaimBacklink = createDemoCase();
    missingMarkerClaimBacklink.actors[0]!.damageMarkers[0]!.linkedClaimIds = [];
    expectRejectedReferenceIssue(missingMarkerClaimBacklink, {
      path: "claims.3.linkedSceneObjectIds.1",
      message:
        "Damage marker damage-a-front-left is missing its reverse link to claim claim-damage-a",
    });

    const missingEvidenceClaimBacklink = createDemoCase();
    missingEvidenceClaimBacklink.evidence.find(
      (asset) => asset.id === "evidence-road",
    )!.linkedClaimIds = [];
    expectRejectedReferenceIssue(missingEvidenceClaimBacklink, {
      path: "claims.1.linkedEvidenceIds.0",
      message: "Evidence evidence-road is missing its reverse link to claim claim-road-wet",
    });

    const missingClaimEvidenceBacklink = createDemoCase();
    missingClaimEvidenceBacklink.claims.find(
      (claim) => claim.id === "claim-road-wet",
    )!.linkedEvidenceIds = [];
    expectRejectedReferenceIssue(missingClaimEvidenceBacklink, {
      path: "evidence.3.linkedClaimIds.0",
      message: "Claim claim-road-wet is missing its reverse link to evidence evidence-road",
    });

    const missingEvidenceEventBacklink = createDemoCase();
    missingEvidenceEventBacklink.evidence.find(
      (asset) => asset.id === "evidence-road",
    )!.linkedEventIds = [];
    expectRejectedReferenceIssue(missingEvidenceEventBacklink, {
      path: "timelineEvents.7.linkedEvidenceIds.3",
      message:
        "Evidence evidence-road is missing its reverse link to timeline event event-evidence",
    });

    const missingEventEvidenceBacklink = createDemoCase();
    missingEventEvidenceBacklink.timelineEvents.find(
      (event) => event.id === "event-evidence",
    )!.linkedEvidenceIds = ["evidence-overview", "evidence-damage-a", "evidence-damage-b"];
    expectRejectedReferenceIssue(missingEventEvidenceBacklink, {
      path: "evidence.3.linkedEventIds.0",
      message:
        "Timeline event event-evidence is missing its reverse link to evidence evidence-road",
    });
  });

  it("rejects duplicate IDs in every reciprocal provenance array", () => {
    type DuplicateTarget = {
      ids: string[];
      path: string;
      label: string;
    };
    const targets: Array<(replayCase: DemoCase) => DuplicateTarget> = [
      (replayCase) => ({
        ids: replayCase.actors[0]!.damageMarkers[0]!.linkedClaimIds,
        path: "actors.0.damageMarkers.0.linkedClaimIds",
        label: "linked claim ID",
      }),
      (replayCase) => ({
        ids: replayCase.actors[0]!.damageMarkers[0]!.linkedEvidenceIds,
        path: "actors.0.damageMarkers.0.linkedEvidenceIds",
        label: "linked evidence ID",
      }),
      (replayCase) => ({
        ids: replayCase.timelineEvents[3]!.linkedClaimIds,
        path: "timelineEvents.3.linkedClaimIds",
        label: "linked claim ID",
      }),
      (replayCase) => ({
        ids: replayCase.timelineEvents[7]!.linkedEvidenceIds,
        path: "timelineEvents.7.linkedEvidenceIds",
        label: "linked evidence ID",
      }),
      (replayCase) => ({
        ids: replayCase.claims[0]!.linkedEvidenceIds,
        path: "claims.0.linkedEvidenceIds",
        label: "linked evidence ID",
      }),
      (replayCase) => ({
        ids: replayCase.claims[0]!.linkedEventIds,
        path: "claims.0.linkedEventIds",
        label: "linked event ID",
      }),
      (replayCase) => ({
        ids: replayCase.claims[0]!.linkedSceneObjectIds,
        path: "claims.0.linkedSceneObjectIds",
        label: "linked scene object ID",
      }),
      (replayCase) => ({
        ids: replayCase.evidence[0]!.linkedClaimIds,
        path: "evidence.0.linkedClaimIds",
        label: "linked claim ID",
      }),
      (replayCase) => ({
        ids: replayCase.evidence[0]!.linkedEventIds,
        path: "evidence.0.linkedEventIds",
        label: "linked event ID",
      }),
      (replayCase) => ({
        ids: replayCase.evidence[0]!.linkedSceneObjectIds,
        path: "evidence.0.linkedSceneObjectIds",
        label: "linked scene object ID",
      }),
    ];

    targets.forEach((selectTarget) => {
      const replayCase = createDemoCase();
      const { ids, path, label } = selectTarget(replayCase);
      const duplicateId = ids[0];
      if (!duplicateId) throw new Error(`Duplicate test fixture ${path} is empty`);
      const firstIndex = ids.indexOf(duplicateId);
      const duplicateIndex = ids.length;
      ids.push(duplicateId);
      expectRejectedReferenceIssue(replayCase, {
        path: `${path}.${String(duplicateIndex)}`,
        message: `Duplicate ${label} ${duplicateId}; first indexed at ${path}.${String(firstIndex)}`,
      });
    });
  });

  it("rejects imported actor-branch trajectory ambiguity", () => {
    const replayCase = createDemoCase();
    const original = replayCase.trajectories.find(
      (trajectory) =>
        trajectory.actorId === "actor-vehicle-a" && trajectory.branchId === "branch-baseline",
    );
    const branch = replayCase.branches.find((candidate) => candidate.id === "branch-baseline");
    if (!original || !branch) throw new Error("Demo trajectory fixture is incomplete");
    const duplicate = structuredClone(original);
    duplicate.id = "trajectory-a-ambiguous-import";
    duplicate.keyframes = duplicate.keyframes.map((keyframe, index) => ({
      ...keyframe,
      id: `keyframe-a-ambiguous-import-${String(index)}`,
    }));
    duplicate.changeHistory = duplicate.changeHistory.map((change, index) => ({
      ...change,
      id: `change-a-ambiguous-import-${String(index)}`,
    }));
    replayCase.trajectories.push(duplicate);
    branch.trajectoryIds.push(duplicate.id);

    expect(validateCaseReferences(replayCase)).toContainEqual({
      path: `trajectories.${String(replayCase.trajectories.length - 1)}`,
      message: `Actor ${original.actorId} has more than one trajectory in branch ${original.branchId}: ${original.id} and ${duplicate.id}`,
    });
    try {
      importReplayCase(replayCase);
      expect.unreachable("The ambiguous trajectories should have been rejected.");
    } catch (error) {
      expect(error).toBeInstanceOf(ReplayImportError);
      expect((error as ReplayImportError).issues).toContainEqual(
        expect.objectContaining({ message: expect.stringMatching(/more than one trajectory/i) }),
      );
    }
  });

  it("does not trust forged human attestations from an unsigned JSON file", () => {
    const forged = createDemoCase();
    const claim = forged.claims.find((item) => item.id === "claim-initial-statement");
    if (!claim) throw new Error("Fixture claim is missing");
    claim.status = "confirmed";
    claim.humanConfirmed = true;
    claim.confirmedAt = "2026-08-27T10:00:00.000Z";
    const preview = buildReportPreview(forged, {
      generatedAt: "2026-08-27T10:01:00.000Z",
    });
    forged.reportSnapshots.push({
      id: "snapshot-forged-human-review",
      caseVersion: forged.caseVersion,
      createdAt: "2026-08-27T10:01:00.000Z",
      confirmedClaimIds: forged.claims
        .filter((item) => item.status === "confirmed")
        .map((item) => item.id),
      includedEvidenceIds: preview.includedEvidenceIds,
      unresolvedQuestionIds: preview.unresolvedQuestionIds,
      branchIds: forged.branches.map((branch) => branch.id),
      humanAcknowledged: true,
      immutable: true,
      preview,
    });

    const restored = importReplayCase(JSON.stringify(forged), {
      now: "2026-08-27T12:00:00.000Z",
    });

    expect(restored.claims.every((item) => !item.humanConfirmed)).toBe(true);
    expect(restored.claims.every((item) => item.status !== "confirmed")).toBe(true);
    expect(restored.reportSnapshots).toEqual([]);
    expect(restored.activity.at(-1)).toMatchObject({
      author: "system",
      actionType: "case.imported-untrusted",
    });
  });
});
