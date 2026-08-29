import { describe, expect, it } from "vitest";

import {
  buildReportPreview,
  createDemoCase,
  exportReplayCase,
  importReplayCase,
  ReplayEngine,
  validateCaseReferences,
} from "../../src/domain";

function createEngine(): ReplayEngine {
  let counter = 0;
  return new ReplayEngine(createDemoCase(), {
    now: () => "2026-08-27T10:00:00.000Z",
    idFactory: (prefix) => `${prefix}-test-${++counter}`,
  });
}

describe("ReplayEngine command guarantees", () => {
  it("rejects spoofed author/origin attribution before executing a command", () => {
    const engine = createEngine();
    const before = engine.state;
    const result = engine.execute({
      type: "actor.update-pose",
      actor: "human",
      origin: "webmcp",
      requestId: "spoofed-human-origin",
      actorId: "actor-vehicle-a",
      pose: { x: 65, y: 49, rotationDeg: 6 },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
    expect(engine.state).toEqual(before);
  });

  it("increments every successful mutation and applies a request ID only once", () => {
    const engine = createEngine();
    const command = {
      type: "actor.update-pose",
      actor: "agent",
      origin: "webmcp",
      expectedVersion: 1,
      requestId: "request-move-a",
      actorId: "actor-vehicle-a",
      pose: { x: 65, y: 49, rotationDeg: 6 },
    } as const;

    const first = engine.execute(command);
    const retry = engine.execute(command);

    expect(first).toMatchObject({ ok: true, caseVersion: 2, idempotent: false });
    expect(retry).toMatchObject({ ok: true, caseVersion: 2, idempotent: true });
    expect(
      engine.state.activity.filter((event) => event.requestId === "request-move-a"),
    ).toHaveLength(1);

    expect(
      engine.execute({
        type: "actor.update-pose",
        actor: "human",
        origin: "ui",
        actorId: "actor-vehicle-b",
        pose: { x: 58, y: 62, rotationDeg: 88 },
      }),
    ).toMatchObject({ ok: true, caseVersion: 3 });
    const lateRetry = engine.execute({ ...command, expectedVersion: 0 });
    expect(lateRetry).toMatchObject({
      ok: true,
      caseVersion: 2,
      activityId: first.ok ? first.activityId : undefined,
      message: first.message,
      idempotent: true,
    });
  });

  it("binds a request ID to the validated command intent across retries and reloads", () => {
    const engine = createEngine();
    const command = {
      type: "actor.update-pose",
      actor: "agent",
      origin: "webmcp",
      expectedVersion: 1,
      requestId: "request-bound-intent",
      actorId: "actor-vehicle-a",
      pose: { x: 65, y: 49, rotationDeg: 6 },
    } as const;

    expect(engine.execute(command)).toMatchObject({ ok: true, caseVersion: 2 });
    expect(
      engine.execute({
        ...command,
        expectedVersion: 2,
        pose: { x: 25, y: 35, rotationDeg: 90 },
      }),
    ).toMatchObject({
      ok: false,
      caseVersion: 2,
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
    expect(engine.state.actors.find((actor) => actor.id === command.actorId)?.pose).toEqual(
      command.pose,
    );

    const activity = engine.state.activity.find((event) => event.requestId === command.requestId);
    expect(activity?.requestIntentFingerprint).toMatch(/^intent-v1-[a-f0-9]{32}$/);

    const rehydrated = new ReplayEngine(engine.state);
    expect(rehydrated.execute({ ...command, expectedVersion: 0 })).toMatchObject({
      ok: true,
      caseVersion: 2,
      idempotent: true,
    });
    expect(
      rehydrated.execute({
        ...command,
        expectedVersion: 2,
        pose: { x: 25, y: 35, rotationDeg: 90 },
      }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  });

  it("keeps action-type idempotency compatibility for legacy activity without a fingerprint", () => {
    const engine = createEngine();
    const command = {
      type: "actor.update-pose",
      actor: "agent",
      origin: "webmcp",
      expectedVersion: 1,
      requestId: "request-legacy-receipt",
      actorId: "actor-vehicle-a",
      pose: { x: 65, y: 49, rotationDeg: 6 },
    } as const;
    expect(engine.execute(command).ok).toBe(true);
    const legacyState = engine.state;
    const activity = legacyState.activity.find((event) => event.requestId === command.requestId);
    if (!activity) throw new Error("Expected request activity");
    delete activity.requestIntentFingerprint;

    const rehydrated = new ReplayEngine(legacyState);
    expect(rehydrated.execute({ ...command, expectedVersion: 0 })).toMatchObject({
      ok: true,
      idempotent: true,
    });
    expect(
      rehydrated.execute({
        type: "claim.add",
        actor: "agent",
        origin: "webmcp",
        requestId: command.requestId,
        statement: "A different operation attempted to reuse the same request ID.",
        status: "agent-hypothesis",
        sourceType: "agent-inference",
        sourceIds: [],
        linkedEvidenceIds: [],
        linkedEventIds: [],
        linkedSceneObjectIds: [],
        sharedAcrossBranches: true,
      }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  });

  it("rejects stale versions without changing state", () => {
    const engine = createEngine();
    const originalPose = engine.state.actors.find((actor) => actor.id === "actor-vehicle-a")?.pose;
    const result = engine.execute({
      type: "actor.update-pose",
      actor: "agent",
      origin: "webmcp",
      expectedVersion: 0,
      requestId: "request-stale",
      actorId: "actor-vehicle-a",
      pose: { x: 99, y: 99, rotationDeg: 0 },
    });
    expect(result).toMatchObject({
      ok: false,
      caseVersion: 1,
      error: { code: "VERSION_CONFLICT" },
    });
    expect(engine.state.actors.find((actor) => actor.id === "actor-vehicle-a")?.pose).toEqual(
      originalPose,
    );
  });

  it("requires an owning branch for non-shared claims and indexes branch claims exactly once", () => {
    const engine = createEngine();
    const before = engine.state;
    const rejected = engine.execute({
      type: "claim.add",
      actor: "human",
      origin: "ui",
      expectedVersion: before.caseVersion,
      claimId: "claim-missing-owner",
      statement: "This non-shared observation has no branch owner.",
      status: "reported",
      sourceType: "human-statement",
      sharedAcrossBranches: false,
    });

    expect(rejected).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_COMMAND",
        message: "A non-shared claim requires an owning branchId",
      },
    });
    expect(engine.state).toEqual(before);

    const accepted = engine.execute({
      type: "claim.add",
      actor: "human",
      origin: "ui",
      expectedVersion: before.caseVersion,
      claimId: "claim-owned-by-baseline",
      statement: "This observation belongs only to the baseline hypothesis.",
      status: "reported",
      sourceType: "human-statement",
      branchId: "branch-baseline",
      sharedAcrossBranches: false,
    });

    expect(accepted).toMatchObject({ ok: true, caseVersion: before.caseVersion + 1 });
    expect(
      engine.state.claims.find((claim) => claim.id === "claim-owned-by-baseline"),
    ).toMatchObject({
      branchId: "branch-baseline",
      sharedAcrossBranches: false,
    });
    expect(
      engine.state.branches.find((branch) => branch.id === "branch-baseline")?.claimIds,
    ).toEqual(expect.arrayContaining(["claim-owned-by-baseline"]));
    expect(engine.state.branches.flatMap((branch) => branch.sharedClaimIds)).not.toContain(
      "claim-owned-by-baseline",
    );
    expect(validateCaseReferences(engine.state)).toEqual([]);
  });

  it("returns a structured lock error and leaves locked geometry untouched", () => {
    const engine = createEngine();
    const originalPose = engine.state.actors.find((actor) => actor.id === "actor-vehicle-b")?.pose;
    expect(
      engine.execute({
        type: "lock.set",
        actor: "human",
        origin: "ui",
        expectedVersion: 1,
        targetType: "actor",
        targetId: "actor-vehicle-b",
        locked: true,
        reason: "Final position reviewed against the photograph",
      }).ok,
    ).toBe(true);

    const result = engine.execute({
      type: "actor.update-pose",
      actor: "agent",
      origin: "webmcp",
      expectedVersion: 2,
      requestId: "request-move-locked",
      actorId: "actor-vehicle-b",
      pose: { x: 50, y: 50, rotationDeg: 0 },
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "LOCKED_ITEM",
        lockedItem: {
          id: "actor-vehicle-b",
          lockedBy: "human",
          reason: "Final position reviewed against the photograph",
        },
      },
    });
    expect(engine.state.caseVersion).toBe(2);
    expect(engine.state.actors.find((actor) => actor.id === "actor-vehicle-b")?.pose).toEqual(
      originalPose,
    );
  });

  it("enforces human-only confirmation in the domain layer", () => {
    const engine = createEngine();
    const agentResult = engine.execute({
      type: "claim.confirm",
      actor: "agent",
      origin: "webmcp",
      requestId: "request-confirm",
      expectedVersion: 1,
      claimId: "claim-initial-statement",
    });
    expect(agentResult).toMatchObject({
      ok: false,
      error: { code: "HUMAN_CONFIRMATION_REQUIRED" },
    });

    const humanResult = engine.execute({
      type: "claim.confirm",
      actor: "human",
      origin: "ui",
      expectedVersion: 1,
      claimId: "claim-initial-statement",
    });
    expect(humanResult.ok).toBe(true);
    expect(
      engine.state.claims.find((claim) => claim.id === "claim-initial-statement"),
    ).toMatchObject({
      status: "confirmed",
      humanConfirmed: true,
    });
  });

  it("never leaves a dangling surrogate when bounding activity summaries", () => {
    const engine = createEngine();
    const statement = `${"A".repeat(482)}😀`;
    expect(
      engine.execute({
        type: "claim.update",
        actor: "human",
        origin: "ui",
        expectedVersion: 1,
        claimId: "claim-initial-statement",
        statement,
      }),
    ).toMatchObject({ ok: true, caseVersion: 2 });
    expect(
      engine.execute({
        type: "claim.confirm",
        actor: "human",
        origin: "ui",
        expectedVersion: 2,
        claimId: "claim-initial-statement",
      }),
    ).toMatchObject({ ok: true, caseVersion: 3 });

    const summary = engine.state.activity.at(-1)?.summary;
    expect(summary).toBe(`Human confirmed: ${"A".repeat(482)}`);
    expect(summary?.length).toBe(499);
  });

  it("prohibits agent finalization even with complete acknowledgement payload", () => {
    const engine = createEngine();
    const preview = buildReportPreview(engine.state, {
      generatedAt: "2026-08-27T10:00:00.000Z",
    });
    const binding = preview.reviewBinding;
    if (!binding) throw new Error("Expected a bound report preview");
    const result = engine.execute({
      type: "report.finalize",
      actor: "agent",
      origin: "webmcp",
      requestId: "request-finalize",
      expectedVersion: 1,
      unresolvedQuestionsReviewed: true,
      limitationsAcknowledged: true,
      confirmedFactsReviewed: true,
      includedUnconfirmedContentReviewed: true,
      manualConfirmation: true,
      reviewedPreview: {
        caseId: preview.caseId,
        caseVersion: preview.caseVersion,
        generatedAt: preview.generatedAt,
        fingerprint: binding.fingerprint,
        branchIds: binding.branchIds,
        includeHypotheses: binding.includeHypotheses,
      },
    });
    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_FINALIZATION_FORBIDDEN" } });
    expect(engine.state.reportSnapshots).toHaveLength(0);
  });

  it("checks cancellation before the atomic commit", () => {
    const engine = createEngine();
    const controller = new AbortController();
    controller.abort("test cancellation");
    const result = engine.execute(
      {
        type: "actor.update-pose",
        actor: "human",
        origin: "ui",
        actorId: "actor-vehicle-a",
        pose: { x: 20, y: 20, rotationDeg: 20 },
      },
      { signal: controller.signal },
    );
    expect(result).toMatchObject({ ok: false, error: { code: "CANCELLED" } });
    expect(engine.state.caseVersion).toBe(1);
  });

  it("allows an agent pose upsert to preserve unchanged confirmed damage", () => {
    const engine = createEngine();
    const actor = engine.state.actors.find((candidate) => candidate.id === "actor-vehicle-a");
    expect(actor).toBeDefined();
    if (!actor) throw new Error("Demo actor is missing");
    const result = engine.execute({
      type: "actor.upsert",
      actor: "agent",
      origin: "webmcp",
      expectedVersion: 1,
      requestId: "agent-upsert-a",
      sceneActor: {
        ...actor,
        pose: { x: 63, y: 49, rotationDeg: 4 },
      },
    });
    expect(result.ok).toBe(true);
    expect(
      engine.state.actors.find((candidate) => candidate.id === actor.id)?.damageMarkers,
    ).toEqual(actor.damageMarkers);
  });

  it("rejects damage provenance changes through actor upsert atomically", () => {
    const engine = createEngine();
    const actor = engine.state.actors.find((candidate) => candidate.id === "actor-vehicle-a");
    if (!actor) throw new Error("Demo actor is missing");
    const incoming = structuredClone(actor);
    const incomingMarker = incoming.damageMarkers[0];
    if (!incomingMarker) throw new Error("Demo damage marker is missing");
    incomingMarker.linkedEvidenceIds = ["evidence-road"];
    const before = engine.state;

    expect(
      engine.execute({
        type: "actor.upsert",
        actor: "human",
        origin: "ui",
        expectedVersion: before.caseVersion,
        sceneActor: incoming,
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
    expect(engine.state).toEqual(before);
  });

  it("rejects a second trajectory for one actor and branch while preserving normal updates", () => {
    const engine = createEngine();
    const before = engine.state;
    const trajectory = before.trajectories.find(
      (candidate) =>
        candidate.actorId === "actor-vehicle-a" && candidate.branchId === "branch-baseline",
    );
    if (!trajectory) throw new Error("Vehicle A baseline trajectory is missing");
    const originalSecondKeyframe = trajectory.keyframes[1];
    if (!originalSecondKeyframe) throw new Error("Vehicle A trajectory needs a second keyframe");

    const duplicate = engine.execute({
      type: "trajectory.set",
      actor: "agent",
      origin: "webmcp",
      expectedVersion: before.caseVersion,
      requestId: "request-second-actor-branch-trajectory",
      trajectoryId: "trajectory-a-second-baseline",
      actorId: trajectory.actorId,
      branchId: trajectory.branchId,
      keyframes: trajectory.keyframes.map((keyframe, index) => ({
        id: `keyframe-a-second-${String(index)}`,
        timeMs: keyframe.timeMs,
        x: keyframe.x + 1,
        y: keyframe.y,
        rotationDeg: keyframe.rotationDeg,
      })),
      visible: true,
    });

    expect(duplicate).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_COMMAND",
        message: expect.stringContaining(
          `already has trajectory ${trajectory.id} in branch ${trajectory.branchId}`,
        ),
      },
    });
    expect(engine.state).toEqual(before);

    const updated = engine.execute({
      type: "trajectory.set",
      actor: "human",
      origin: "ui",
      expectedVersion: before.caseVersion,
      trajectoryId: trajectory.id,
      actorId: trajectory.actorId,
      branchId: trajectory.branchId,
      keyframes: trajectory.keyframes.map((keyframe, index) => ({
        id: keyframe.id,
        timeMs: keyframe.timeMs,
        x: index === 1 ? keyframe.x + 0.25 : keyframe.x,
        y: keyframe.y,
        rotationDeg: keyframe.rotationDeg,
      })),
      visible: trajectory.visible,
    });

    expect(updated).toMatchObject({ ok: true, caseVersion: before.caseVersion + 1 });
    expect(
      engine.state.trajectories.filter(
        (candidate) =>
          candidate.actorId === trajectory.actorId && candidate.branchId === trajectory.branchId,
      ),
    ).toHaveLength(1);
    expect(
      engine.state.trajectories.find((candidate) => candidate.id === trajectory.id)?.keyframes[1]
        ?.x,
    ).toBe(originalSecondKeyframe.x + 0.25);
  });

  it("preserves omitted timeline provenance and applies explicit replacements symmetrically", () => {
    const engine = createEngine();
    const before = engine.state.timelineEvents.find((event) => event.id === "event-impact");
    if (!before) throw new Error("Missing seeded impact event");
    const originalClaimIds = [...before.linkedClaimIds];
    const originalEvidenceIds = [...before.linkedEvidenceIds];

    expect(
      engine.execute({
        type: "timeline.upsert",
        actor: "agent",
        origin: "webmcp",
        expectedVersion: 1,
        requestId: "request-impact-preserve-provenance",
        eventId: before.id,
        branchId: before.branchId,
        timeMs: 10_250,
        eventType: "impact",
        title: "Approximate contact",
        certainty: "uncertain",
        linkedActorIds: [...before.linkedActorIds],
        location: { x: 67, y: 59 },
      }),
    ).toMatchObject({ ok: true, caseVersion: 2 });

    const preserved = engine.state.timelineEvents.find((event) => event.id === before.id);
    expect(preserved).toMatchObject({
      linkedClaimIds: originalClaimIds,
      linkedEvidenceIds: originalEvidenceIds,
    });
    for (const claimId of originalClaimIds) {
      expect(engine.state.claims.find((claim) => claim.id === claimId)?.linkedEventIds).toContain(
        before.id,
      );
    }
    for (const evidenceId of originalEvidenceIds) {
      expect(
        engine.state.evidence.find((asset) => asset.id === evidenceId)?.linkedEventIds,
      ).toContain(before.id);
    }

    expect(
      engine.execute({
        type: "timeline.upsert",
        actor: "human",
        origin: "ui",
        expectedVersion: 2,
        eventId: before.id,
        branchId: before.branchId,
        timeMs: 10_250,
        eventType: "impact",
        title: "Approximate contact",
        certainty: "uncertain",
        linkedActorIds: [...before.linkedActorIds],
        linkedClaimIds: ["claim-lane-change"],
        linkedEvidenceIds: ["evidence-road"],
        location: { x: 67, y: 59 },
      }),
    ).toMatchObject({ ok: true, caseVersion: 3 });

    expect(engine.state.timelineEvents.find((event) => event.id === before.id)).toMatchObject({
      linkedClaimIds: ["claim-lane-change"],
      linkedEvidenceIds: ["evidence-road"],
    });
    expect(
      engine.state.claims.find((claim) => claim.id === "claim-lane-change")?.linkedEventIds,
    ).toContain(before.id);
    for (const claimId of originalClaimIds) {
      expect(
        engine.state.claims.find((claim) => claim.id === claimId)?.linkedEventIds,
      ).not.toContain(before.id);
    }
    expect(
      engine.state.evidence.find((asset) => asset.id === "evidence-road")?.linkedEventIds,
    ).toContain(before.id);
    for (const evidenceId of originalEvidenceIds) {
      expect(
        engine.state.evidence.find((asset) => asset.id === evidenceId)?.linkedEventIds,
      ).not.toContain(before.id);
    }
  });

  it("prevents agents from creating or modifying trusted vehicle-dimension attestations", () => {
    const engine = createEngine();
    const actor = engine.state.actors.find((candidate) => candidate.id === "actor-vehicle-a");
    if (!actor) throw new Error("Demo actor is missing");

    const modified = structuredClone(actor);
    modified.dimensions.width += 0.1;
    expect(
      engine.execute({
        type: "actor.upsert",
        actor: "agent",
        origin: "webmcp",
        expectedVersion: 1,
        requestId: "agent-spoof-trusted-dimensions-update",
        sceneActor: modified,
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN_ACTION" } });

    const created = structuredClone(actor);
    created.id = "actor-agent-trusted-dimensions";
    created.label = "Agent-created vehicle";
    created.damageMarkers = [];
    created.locked = false;
    delete created.lock;
    expect(
      engine.execute({
        type: "actor.upsert",
        actor: "agent",
        origin: "webmcp",
        expectedVersion: 1,
        requestId: "agent-spoof-trusted-dimensions-create",
        sceneActor: created,
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN_ACTION" } });
    expect(engine.state.caseVersion).toBe(1);
  });

  it.each(["human-statement", "witness-statement", "photo", "document"] as const)(
    "prevents an agent from asserting %s provenance without a compatible source",
    (sourceType) => {
      const engine = createEngine();
      const before = engine.state;

      const result = engine.execute({
        type: "claim.add",
        actor: "agent",
        origin: "webmcp",
        expectedVersion: 1,
        requestId: `agent-provenance-${sourceType}`,
        statement: `Agent-authored ${sourceType} claim without a compatible source.`,
        status: "reported",
        sourceType,
        sourceIds: ["actor-vehicle-a"],
        linkedSceneObjectIds: ["actor-vehicle-a"],
        sharedAcrossBranches: true,
      });

      expect(result).toMatchObject({
        ok: false,
        caseVersion: 1,
        error: {
          code: "FORBIDDEN_ACTION",
          details: { sourceType, providedSourceIds: ["actor-vehicle-a"] },
        },
      });
      expect(engine.state).toEqual(before);
    },
  );

  it.each(["photo", "document"] as const)(
    "requires a human-authored %s observation to cite active image evidence",
    (sourceType) => {
      const engine = createEngine();
      expect(
        engine.execute({
          type: "claim.add",
          actor: "human",
          origin: "ui",
          expectedVersion: 1,
          statement: `This ${sourceType} observation has no attached source.`,
          status: "reported",
          sourceType,
          sourceIds: [],
          sharedAcrossBranches: true,
        }),
      ).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });

      expect(
        engine.execute({
          type: "claim.add",
          actor: "human",
          origin: "ui",
          expectedVersion: 1,
          statement: `This ${sourceType} observation cites its local image.`,
          status: "reported",
          sourceType,
          sourceIds: ["evidence-overview"],
          linkedEvidenceIds: ["evidence-overview"],
          sharedAcrossBranches: true,
        }),
      ).toMatchObject({ ok: true, caseVersion: 2 });
      expect(engine.state.claims.at(-1)).toMatchObject({
        sourceType,
        sourceIds: ["evidence-overview"],
        linkedEvidenceIds: ["evidence-overview"],
      });
    },
  );

  it("blocks confirmation of a legacy photo claim until its source is repaired", () => {
    const replayCase = createDemoCase();
    const claim = replayCase.claims.find((candidate) => candidate.id === "claim-initial-statement");
    if (!claim) throw new Error("Missing claim fixture");
    claim.sourceType = "photo";
    claim.sourceIds = [];
    const engine = new ReplayEngine(replayCase);

    expect(
      engine.execute({
        type: "claim.confirm",
        actor: "human",
        origin: "ui",
        expectedVersion: 1,
        claimId: claim.id,
      }),
    ).toMatchObject({ ok: false, error: { code: "HUMAN_CONFIRMATION_REQUIRED" } });
    expect(
      engine.state.consistencyIssues.some(
        (issue) => issue.ruleId === "provenance.human-external-source-missing",
      ),
    ).toBe(true);

    expect(
      engine.execute({
        type: "claim.update",
        actor: "human",
        origin: "ui",
        expectedVersion: 1,
        claimId: claim.id,
        sourceIds: ["evidence-overview"],
        linkedEvidenceIds: ["evidence-overview"],
      }),
    ).toMatchObject({ ok: true, caseVersion: 2 });
    expect(
      engine.execute({
        type: "claim.confirm",
        actor: "human",
        origin: "ui",
        expectedVersion: 2,
        claimId: claim.id,
      }),
    ).toMatchObject({ ok: true, caseVersion: 3 });
  });

  it("keeps context links distinct from compatible agent observation provenance", () => {
    const humanStatementEngine = createEngine();
    expect(
      humanStatementEngine.execute({
        type: "claim.add",
        actor: "agent",
        origin: "webmcp",
        expectedVersion: 1,
        requestId: "agent-sourced-human-statement",
        statement: "The existing human account identifies both vehicles.",
        status: "reported",
        sourceType: "human-statement",
        sourceIds: ["actor-vehicle-a", "claim-initial-statement"],
        linkedSceneObjectIds: ["actor-vehicle-a"],
        sharedAcrossBranches: true,
      }),
    ).toMatchObject({ ok: true, caseVersion: 2 });
    expect(
      humanStatementEngine.state.claims.find(
        (claim) => claim.statement === "The existing human account identifies both vehicles.",
      ),
    ).toMatchObject({
      sourceIds: ["claim-initial-statement"],
      linkedSceneObjectIds: ["actor-vehicle-a"],
      createdBy: "agent",
      humanConfirmed: false,
    });

    const photoEngine = createEngine();
    expect(
      photoEngine.execute({
        type: "claim.add",
        actor: "agent",
        origin: "webmcp",
        expectedVersion: 1,
        requestId: "agent-sourced-photo-observation",
        statement: "The indexed overview image shows the marked scene context.",
        status: "uncertain",
        sourceType: "photo",
        sourceIds: ["event-impact", "evidence-overview"],
        linkedEvidenceIds: ["evidence-overview"],
        linkedEventIds: ["event-impact"],
        sharedAcrossBranches: true,
      }),
    ).toMatchObject({ ok: true, caseVersion: 2 });
    expect(
      photoEngine.state.claims.find(
        (claim) => claim.statement === "The indexed overview image shows the marked scene context.",
      ),
    ).toMatchObject({
      sourceIds: ["evidence-overview"],
      linkedEvidenceIds: ["evidence-overview"],
      linkedEventIds: ["event-impact"],
    });
  });

  it.each(["witness-statement", "document"] as const)(
    "accepts an agent's %s attribution only through a same-type human source claim",
    (sourceType) => {
      const engine = createEngine();
      const humanSourceId = `claim-human-${sourceType}`;
      expect(
        engine.execute({
          type: "claim.add",
          actor: "human",
          origin: "ui",
          expectedVersion: 1,
          claimId: humanSourceId,
          statement: `A person supplied this ${sourceType} account.`,
          status: "reported",
          sourceType,
          ...(sourceType === "document"
            ? {
                sourceIds: ["evidence-overview"],
                linkedEvidenceIds: ["evidence-overview"],
              }
            : {}),
          sharedAcrossBranches: true,
        }),
      ).toMatchObject({ ok: true, caseVersion: 2 });

      expect(
        engine.execute({
          type: "claim.add",
          actor: "agent",
          origin: "webmcp",
          expectedVersion: 2,
          requestId: `request-agent-sourced-${sourceType}`,
          statement: `The agent preserves the linked ${sourceType} account as reported.`,
          status: "reported",
          sourceType,
          sourceIds: [humanSourceId],
          sharedAcrossBranches: true,
        }),
      ).toMatchObject({ ok: true, caseVersion: 3 });
      expect(engine.state.claims.at(-1)).toMatchObject({ sourceType, sourceIds: [humanSourceId] });
    },
  );

  it("does not launder external provenance through an agent claim or unsigned import", () => {
    const forgedSourceCase = createDemoCase();
    const humanSource = forgedSourceCase.claims.find(
      (claim) => claim.id === "claim-initial-statement",
    );
    if (!humanSource) throw new Error("Missing seeded human statement");
    forgedSourceCase.claims.push({
      ...structuredClone(humanSource),
      id: "claim-agent-fabricated-human-source",
      statement: "An agent-authored claim cannot become human provenance for another agent claim.",
      linkedEvidenceIds: [],
      linkedEventIds: [],
      createdBy: "agent",
      humanConfirmed: false,
      changeHistory: [
        {
          id: "change-agent-fabricated-human-source",
          caseVersion: 1,
          author: "agent",
          origin: "webmcp",
          summary: "Created claim.",
          createdAt: "2026-08-27T10:00:00.000Z",
          requestId: "request-agent-fabricated-human-source",
        },
      ],
    });
    forgedSourceCase.branches.forEach((branch) => {
      branch.sharedClaimIds.push("claim-agent-fabricated-human-source");
    });
    const forgedSourceEngine = new ReplayEngine(forgedSourceCase);
    expect(
      forgedSourceEngine.execute({
        type: "claim.add",
        actor: "agent",
        origin: "webmcp",
        requestId: "request-agent-provenance-chain",
        statement: "A second agent claim attempts to cite the first as human provenance.",
        status: "reported",
        sourceType: "human-statement",
        sourceIds: ["claim-agent-fabricated-human-source"],
        sharedAcrossBranches: true,
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN_ACTION" } });

    const agentAlteredHumanSourceCase = createDemoCase();
    const agentAlteredSource = agentAlteredHumanSourceCase.claims.find(
      (claim) => claim.id === "claim-initial-statement",
    );
    if (!agentAlteredSource) throw new Error("Missing seeded source to alter");
    agentAlteredSource.sourceType = "witness-statement";
    agentAlteredSource.changeHistory.push({
      id: "change-agent-altered-source-type",
      caseVersion: 1,
      author: "agent",
      origin: "webmcp",
      summary: "Updated an observation.",
      createdAt: "2026-08-27T10:00:00.000Z",
      requestId: "request-agent-altered-source-type",
    });
    const agentAlteredSourceEngine = new ReplayEngine(agentAlteredHumanSourceCase);
    expect(
      agentAlteredSourceEngine.execute({
        type: "claim.add",
        actor: "agent",
        origin: "webmcp",
        requestId: "request-agent-altered-source-chain",
        statement: "A human-created claim altered by an agent is not a witness source.",
        status: "reported",
        sourceType: "witness-statement",
        sourceIds: ["claim-initial-statement"],
        sharedAcrossBranches: true,
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN_ACTION" } });

    const unsignedImport = importReplayCase(exportReplayCase(createDemoCase()), {
      now: "2026-08-27T11:00:00.000Z",
    });
    const unsignedImportEngine = new ReplayEngine(unsignedImport);
    expect(
      unsignedImportEngine.execute({
        type: "claim.add",
        actor: "agent",
        origin: "webmcp",
        expectedVersion: unsignedImport.caseVersion,
        requestId: "request-agent-unsigned-import-source",
        statement: "Unsigned imported authorship cannot be reused as trusted human provenance.",
        status: "reported",
        sourceType: "human-statement",
        sourceIds: ["claim-initial-statement"],
        sharedAcrossBranches: true,
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN_ACTION" } });
  });

  it.each(["manufacturer", "measured"] as const)(
    "prevents agents from downgrading or editing existing %s vehicle specifications",
    (trustedSource) => {
      const replayCase = createDemoCase();
      const actor = replayCase.actors.find((candidate) => candidate.id === "actor-vehicle-a");
      if (!actor) throw new Error("Demo actor is missing");
      actor.dimensionsSource = trustedSource;
      const engine = new ReplayEngine(replayCase);
      const attempts = [
        {
          requestId: `agent-downgrade-${trustedSource}-source`,
          sceneActor: { ...structuredClone(actor), dimensionsSource: "estimated" as const },
        },
        {
          requestId: `agent-downgrade-${trustedSource}-dimensions`,
          sceneActor: {
            ...structuredClone(actor),
            dimensions: { ...actor.dimensions, width: actor.dimensions.width + 0.1 },
            dimensionsSource: "estimated" as const,
          },
        },
        {
          requestId: `agent-downgrade-${trustedSource}-wheelbase`,
          sceneActor: {
            ...structuredClone(actor),
            dimensionsSource: "estimated" as const,
            wheelbaseMeters: (actor.wheelbaseMeters ?? 2.5) + 0.1,
          },
        },
      ];

      for (const attempt of attempts) {
        expect(
          engine.execute({
            type: "actor.upsert",
            actor: "agent",
            origin: "webmcp",
            expectedVersion: 1,
            requestId: attempt.requestId,
            sceneActor: attempt.sceneActor,
          }),
        ).toMatchObject({ ok: false, error: { code: "FORBIDDEN_ACTION" } });
      }
      expect(engine.state.actors.find((candidate) => candidate.id === actor.id)).toMatchObject({
        dimensions: actor.dimensions,
        dimensionsSource: trustedSource,
        wheelbaseMeters: actor.wheelbaseMeters,
      });
      expect(engine.state.caseVersion).toBe(1);
    },
  );

  it("does not report failure after a UI subscriber throws post-commit", () => {
    const engine = createEngine();
    engine.subscribe(() => {
      throw new Error("render failed");
    });
    const result = engine.execute({
      type: "actor.update-pose",
      actor: "human",
      origin: "ui",
      actorId: "actor-vehicle-a",
      pose: { x: 65, y: 49, rotationDeg: 5 },
    });
    expect(result).toMatchObject({ ok: true, caseVersion: 2 });
    expect(engine.state.caseVersion).toBe(2);
  });

  it("records deterministic issue changes as system validation activity", () => {
    const engine = createEngine();
    expect(
      engine.execute({
        type: "actor.update-pose",
        actor: "human",
        origin: "ui",
        actorId: "actor-vehicle-a",
        pose: { x: 150, y: 49, rotationDeg: 5 },
      }).ok,
    ).toBe(true);
    const systemActivity = engine.state.activity.find(
      (activity) => activity.caseVersion === 2 && activity.actionType === "consistency.updated",
    );
    expect(systemActivity).toMatchObject({
      author: "system",
      origin: "system",
      undoable: false,
    });
    expect(systemActivity?.summary).toContain("detected");
  });

  it("classifies a human edit of the latest agent-edited object as an explicit override", () => {
    const engine = createEngine();
    const agentResult = engine.execute({
      type: "actor.update-pose",
      actor: "agent",
      origin: "webmcp",
      requestId: "agent-position-a",
      actorId: "actor-vehicle-a",
      pose: { x: 67, y: 50, rotationDeg: 5 },
    });
    expect(agentResult.ok).toBe(true);
    if (!agentResult.ok) throw new Error("Agent pose update failed");

    const humanResult = engine.execute({
      type: "actor.update-pose",
      actor: "human",
      origin: "ui",
      actorId: "actor-vehicle-a",
      pose: { x: 61, y: 53, rotationDeg: 12 },
    });
    expect(humanResult.ok).toBe(true);
    if (!humanResult.ok) throw new Error("Human pose update failed");

    const activities = engine.state.activity;
    const agentActivity = activities.find((activity) => activity.id === agentResult.activityId);
    const humanActivity = activities.find((activity) => activity.id === humanResult.activityId);
    expect(agentActivity).toMatchObject({
      author: "agent",
      origin: "webmcp",
      actionType: "actor.update-pose",
      affectedIds: expect.arrayContaining(["actor-vehicle-a"]),
    });
    expect(humanActivity).toMatchObject({
      author: "human",
      origin: "ui",
      actionType: "actor.update-pose",
      classification: "human-override",
      overridesActivityId: agentResult.activityId,
      affectedIds: expect.arrayContaining(["actor-vehicle-a"]),
    });
    expect(humanActivity?.summary).toMatch(/^Human override:/);
  });

  it("does not misclassify ordinary human edits or validation as overrides", () => {
    const engine = createEngine();
    expect(
      engine.execute({
        type: "actor.update-pose",
        actor: "agent",
        origin: "webmcp",
        requestId: "agent-position-a",
        actorId: "actor-vehicle-a",
        pose: { x: 67, y: 50, rotationDeg: 5 },
      }).ok,
    ).toBe(true);

    const unrelatedHumanResult = engine.execute({
      type: "actor.update-pose",
      actor: "human",
      origin: "ui",
      actorId: "actor-vehicle-b",
      pose: { x: 58, y: 62, rotationDeg: 88 },
    });
    expect(unrelatedHumanResult.ok).toBe(true);
    if (!unrelatedHumanResult.ok) throw new Error("Unrelated human pose update failed");
    expect(
      engine.state.activity.find((activity) => activity.id === unrelatedHumanResult.activityId)
        ?.classification,
    ).toBeUndefined();

    const validationResult = engine.execute({
      type: "case.validate",
      actor: "human",
      origin: "ui",
      scope: "all",
    });
    expect(validationResult.ok).toBe(true);
    if (!validationResult.ok) throw new Error("Consistency validation failed");
    expect(
      engine.state.activity.find((activity) => activity.id === validationResult.activityId),
    ).toMatchObject({ author: "system", actionType: "case.validate" });
    expect(
      engine.state.activity.find((activity) => activity.id === validationResult.activityId)
        ?.classification,
    ).toBeUndefined();

    const secondHumanResult = engine.execute({
      type: "actor.update-pose",
      actor: "human",
      origin: "ui",
      actorId: "actor-vehicle-b",
      pose: { x: 59, y: 62, rotationDeg: 89 },
    });
    expect(secondHumanResult.ok).toBe(true);
    if (!secondHumanResult.ok) throw new Error("Second human pose update failed");
    expect(
      engine.state.activity.find((activity) => activity.id === secondHumanResult.activityId)
        ?.classification,
    ).toBeUndefined();
  });
});

describe("command history", () => {
  it("undoes and redoes mutations while retaining an accurate activity feed", () => {
    const engine = createEngine();
    const originalX = engine.state.actors.find((actor) => actor.id === "actor-vehicle-a")?.pose.x;
    engine.execute({
      type: "actor.update-pose",
      actor: "human",
      origin: "ui",
      actorId: "actor-vehicle-a",
      pose: { x: 70, y: 50, rotationDeg: 10 },
    });
    expect(engine.canUndo).toBe(true);

    const undo = engine.undo();
    expect(undo).toMatchObject({ ok: true, caseVersion: 3 });
    expect(engine.state.actors.find((actor) => actor.id === "actor-vehicle-a")?.pose.x).toBe(
      originalX,
    );
    expect(engine.state.activity.some((event) => event.actionType === "history.undo")).toBe(true);

    const redo = engine.redo();
    expect(redo).toMatchObject({ ok: true, caseVersion: 4 });
    expect(engine.state.actors.find((actor) => actor.id === "actor-vehicle-a")?.pose.x).toBe(70);
    expect(engine.state.activity.some((event) => event.actionType === "history.redo")).toBe(true);
  });

  it("keeps an evidence-deletion tombstone across later undo operations", () => {
    const engine = createEngine();
    expect(
      engine.execute({
        type: "actor.update-pose",
        actor: "human",
        origin: "ui",
        expectedVersion: 1,
        actorId: "actor-vehicle-a",
        pose: { x: 70, y: 50, rotationDeg: 10 },
      }),
    ).toMatchObject({ ok: true, caseVersion: 2 });
    expect(
      engine.execute({
        type: "evidence.delete",
        actor: "human",
        origin: "ui",
        expectedVersion: 2,
        evidenceId: "evidence-road",
        confirmed: true,
      }),
    ).toMatchObject({ ok: true, caseVersion: 3 });

    expect(engine.canUndo).toBe(false);
    expect(engine.undo()).toMatchObject({
      ok: false,
      error: {
        code: "HISTORY_BARRIER",
        details: { commandType: "evidence.delete" },
      },
    });

    expect(
      engine.execute({
        type: "actor.update-pose",
        actor: "human",
        origin: "ui",
        expectedVersion: 3,
        actorId: "actor-vehicle-b",
        pose: { x: 58, y: 62, rotationDeg: 88 },
      }),
    ).toMatchObject({ ok: true, caseVersion: 4 });
    expect(engine.undo()).toMatchObject({ ok: true, caseVersion: 5 });
    expect(engine.canUndo).toBe(false);
    expect(engine.undo()).toMatchObject({
      ok: false,
      error: {
        code: "HISTORY_BARRIER",
        details: { commandType: "evidence.delete" },
      },
    });
    expect(engine.state.evidence.find((asset) => asset.id === "evidence-road")).toMatchObject({
      name: "Deleted evidence",
      localBlobKey: "deleted:evidence-road",
      deleted: true,
      deletedAt: "2026-08-27T10:00:00.000Z",
      annotations: [],
      annotationLinks: [],
      linkedClaimIds: [],
      linkedEventIds: [],
      linkedSceneObjectIds: [],
      linkedBranchIds: [],
    });
    expect(engine.state.actors.find((actor) => actor.id === "actor-vehicle-a")?.pose.x).toBe(70);
  });

  it("requires explicit byte-aware deletion instead of undoing an evidence attachment", () => {
    const engine = createEngine();
    expect(
      engine.execute({
        type: "evidence.add",
        actor: "human",
        origin: "ui",
        expectedVersion: 1,
        evidenceId: "evidence-history-barrier",
        name: "Locally attached evidence.png",
        mimeType: "image/png",
        sizeBytes: 128,
        localBlobKey: "evidence:history-barrier",
        checksum: "a".repeat(64),
        source: "local-upload",
        tags: [],
      }),
    ).toMatchObject({ ok: true, caseVersion: 2 });

    expect(engine.canUndo).toBe(false);
    expect(engine.undo()).toMatchObject({
      ok: false,
      error: {
        code: "HISTORY_BARRIER",
        details: { commandType: "evidence.add" },
      },
    });
    expect(engine.state.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "evidence-history-barrier",
          localBlobKey: "evidence:history-barrier",
          deleted: false,
        }),
      ]),
    );
  });

  it("does not let agent history commands undo or redo human confirmation", () => {
    const engine = createEngine();
    expect(
      engine.execute({
        type: "claim.add",
        actor: "human",
        origin: "ui",
        expectedVersion: 1,
        claimId: "claim-history-boundary",
        statement: "A human supplied this test observation.",
        status: "reported",
        sourceType: "photo",
        sourceIds: ["evidence-overview"],
        linkedEvidenceIds: ["evidence-overview"],
        linkedEventIds: [],
        linkedSceneObjectIds: [],
        sharedAcrossBranches: true,
      }),
    ).toMatchObject({ ok: true, caseVersion: 2 });
    expect(
      engine.execute({
        type: "claim.confirm",
        actor: "human",
        origin: "ui",
        expectedVersion: 2,
        claimId: "claim-history-boundary",
      }),
    ).toMatchObject({ ok: true, caseVersion: 3 });

    expect(
      engine.execute({
        type: "history.undo",
        actor: "agent",
        origin: "webmcp",
        expectedVersion: 3,
        requestId: "agent-generic-undo-human-confirmation",
      }),
    ).toMatchObject({ ok: false, error: { code: "UNSAFE_REVERT" } });
    expect(
      engine.state.claims.find((claim) => claim.id === "claim-history-boundary"),
    ).toMatchObject({ status: "confirmed", humanConfirmed: true });

    expect(engine.undo({ actor: "human", origin: "ui" })).toMatchObject({
      ok: true,
      caseVersion: 4,
    });
    expect(
      engine.execute({
        type: "history.redo",
        actor: "agent",
        origin: "webmcp",
        expectedVersion: 4,
        requestId: "agent-generic-redo-human-confirmation",
      }),
    ).toMatchObject({ ok: false, error: { code: "UNSAFE_REVERT" } });
    expect(
      engine.state.claims.find((claim) => claim.id === "claim-history-boundary"),
    ).toMatchObject({ status: "reported", humanConfirmed: false });
    expect(engine.redo({ actor: "human", origin: "ui" })).toMatchObject({
      ok: true,
      caseVersion: 5,
    });
  });

  it("does not let an agent revert indirectly restore a human confirmation", () => {
    const engine = createEngine();
    expect(engine.state.claims.find((claim) => claim.id === "claim-road-wet")).toMatchObject({
      status: "confirmed",
      humanConfirmed: true,
    });

    expect(
      engine.execute({
        type: "evidence.link",
        actor: "agent",
        origin: "webmcp",
        expectedVersion: 1,
        requestId: "agent-invalidates-confirmation",
        evidenceId: "evidence-overview",
        targetType: "claim",
        targetId: "claim-road-wet",
      }),
    ).toMatchObject({ ok: true, caseVersion: 2 });
    expect(engine.state.claims.find((claim) => claim.id === "claim-road-wet")).toMatchObject({
      status: "reported",
      humanConfirmed: false,
    });
    expect(engine.canRevertAgentAction("agent-invalidates-confirmation")).toBe(false);
    const beforeRevert = engine.state;

    expect(
      engine.revertAgentAction("agent-invalidates-confirmation", {
        actor: "agent",
        origin: "webmcp",
        expectedVersion: 2,
        requestId: "agent-revert-invalidated-confirmation",
      }),
    ).toMatchObject({
      ok: false,
      caseVersion: 2,
      error: {
        code: "UNSAFE_REVERT",
        details: {
          restoredClaimIds: ["claim-road-wet"],
          restoredReportSnapshotIds: [],
        },
      },
    });
    expect(engine.state).toEqual(beforeRevert);

    expect(engine.undo()).toMatchObject({ ok: true, caseVersion: 3 });
    expect(engine.state.claims.find((claim) => claim.id === "claim-road-wet")).toMatchObject({
      status: "confirmed",
      humanConfirmed: true,
    });
  });

  it("exposes agent revert availability only in the live engine session", () => {
    const engine = createEngine();
    const mutation = engine.execute({
      type: "actor.update-pose",
      actor: "agent",
      origin: "webmcp",
      requestId: "agent-action-before-focus",
      actorId: "actor-vehicle-a",
      pose: { x: 66, y: 50, rotationDeg: 5 },
    });
    expect(mutation).toMatchObject({ ok: true, caseVersion: 2 });
    expect(engine.canRevertAgentAction("agent-action-before-focus")).toBe(true);

    expect(engine.canUndo).toBe(true);
    expect(engine.canRevertAgentAction("agent-action-before-focus")).toBe(true);

    const rehydrated = new ReplayEngine(engine.state);
    expect(rehydrated.canRevertAgentAction("agent-action-before-focus")).toBe(false);

    expect(
      engine.revertAgentAction("agent-action-before-focus", {
        actor: "human",
        origin: "ui",
        requestId: "human-revert-after-focus",
      }),
    ).toMatchObject({ ok: true, caseVersion: 3 });
  });

  it("reverts an agent request only while it is the latest safe action", () => {
    const engine = createEngine();
    engine.execute({
      type: "actor.update-pose",
      actor: "agent",
      origin: "webmcp",
      requestId: "agent-action-1",
      actorId: "actor-vehicle-a",
      pose: { x: 66, y: 50, rotationDeg: 5 },
    });
    expect(
      engine.revertAgentAction("agent-action-1", {
        actor: "agent",
        origin: "webmcp",
        requestId: "agent-action-1",
      }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect(engine.state.actors.find((actor) => actor.id === "actor-vehicle-a")?.pose.x).toBe(66);

    const firstRevert = engine.revertAgentAction("agent-action-1", {
      actor: "agent",
      origin: "webmcp",
      requestId: "agent-revert-1",
    });
    expect(firstRevert.ok).toBe(true);
    const retriedRevert = engine.revertAgentAction("agent-action-1", {
      actor: "agent",
      origin: "webmcp",
      requestId: "agent-revert-1",
    });
    expect(retriedRevert).toMatchObject({
      ok: true,
      idempotent: true,
      activityId: firstRevert.ok ? firstRevert.activityId : undefined,
      message: firstRevert.message,
    });
    expect(
      engine.state.activity.filter((activity) => activity.requestId === "agent-revert-1"),
    ).toHaveLength(1);
    const rehydrated = new ReplayEngine(engine.state);
    expect(
      rehydrated.revertAgentAction("agent-action-1", {
        actor: "agent",
        origin: "webmcp",
        requestId: "agent-revert-1",
      }),
    ).toMatchObject({
      ok: true,
      idempotent: true,
      activityId: firstRevert.ok ? firstRevert.activityId : undefined,
      message: firstRevert.message,
    });

    engine.execute({
      type: "actor.update-pose",
      actor: "agent",
      origin: "webmcp",
      requestId: "agent-action-2",
      actorId: "actor-vehicle-a",
      pose: { x: 67, y: 50, rotationDeg: 5 },
    });
    expect(
      engine.revertAgentAction("agent-action-2", {
        actor: "agent",
        origin: "webmcp",
        requestId: "agent-revert-1",
      }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect(engine.state.actors.find((actor) => actor.id === "actor-vehicle-a")?.pose.x).toBe(67);
    engine.execute({
      type: "actor.update-pose",
      actor: "human",
      origin: "ui",
      actorId: "actor-vehicle-b",
      pose: { x: 58, y: 62, rotationDeg: 88 },
    });
    expect(engine.revertAgentAction("agent-action-2")).toMatchObject({
      ok: false,
      error: { code: "UNSAFE_REVERT" },
    });
  });
});
