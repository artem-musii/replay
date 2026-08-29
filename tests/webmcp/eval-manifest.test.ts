import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { REPLAY_SEED_VERSION } from "../../src/domain/models";
import { webMCPInputSchemas } from "../../src/webmcp/schemas";
import { TOOL_NAMES } from "../../src/webmcp/types";

interface EvalScenario {
  id: string;
  evalType: string;
  prompt: string;
  promptUse?: string;
  toolSetRef: string;
  injectedCall?: {
    evidenceUse?: string;
    countsTowardModelToolSelection?: boolean;
    tool: keyof typeof webMCPInputSchemas;
    arguments: Record<string, unknown>;
  };
  expectedPlan?: Record<string, unknown>;
  deterministicHarnessPlan?: Record<string, unknown>;
  oracles: Record<string, string[]>;
}

interface EvalManifest {
  schemaVersion: string;
  status: string;
  sources: string[];
  implementationContract: {
    toolSets: {
      openDemo: string[];
      reportPreviewOpen: string[];
      declarativeReportForm: string[];
    };
  };
  evidencePolicy: {
    behavioralToolSelectionClass: string;
    classes: Record<string, { countsTowardBehavioralToolSelection: boolean }>;
  };
  execution: {
    models: string[];
    siteToolsSupportSnapshot: {
      source: string;
      supportedModels: string[];
      knownUnsupportedModels: string[];
    };
    supportedModelBehavioralScenarioIds: string[];
    deterministicOnlyScenarioIds: string[];
    capture: string[];
  };
  observedAttempts: Array<{
    evidenceClass: string;
    model: string;
    nativeDocumentModelContext: boolean;
    toolSelected: boolean;
    toolInvoked: boolean;
    caseChanged: boolean;
    outcome: string;
  }>;
  fixtures: { seedVersion: number };
  scenarios: EvalScenario[];
}

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), "evals/webmcp-evals.json"), "utf8"),
) as EvalManifest;

function resolveVersionPlaceholders(value: unknown): unknown {
  if (value === "$STALE_VERSION") return 1;
  if (value === "$CURRENT_VERSION") return 2;
  if (Array.isArray(value)) return value.map(resolveVersionPlaceholders);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, resolveVersionPlaceholders(nested)]),
  );
}

describe("WebMCP eval manifest", () => {
  it("stays aligned with the current seed and imperative lifecycle tool sets", () => {
    const imperativeTools = [...TOOL_NAMES];

    expect(manifest.schemaVersion).toBe("1.5");
    expect(manifest.status).toBe("specification-not-results");
    expect(manifest.fixtures.seedVersion).toBe(REPLAY_SEED_VERSION);
    expect(manifest.implementationContract.toolSets.openDemo).toEqual(
      imperativeTools.filter((name) => name !== "add_report_note"),
    );
    expect(manifest.implementationContract.toolSets.reportPreviewOpen).toEqual(imperativeTools);
    expect(manifest.implementationContract.toolSets.declarativeReportForm).toEqual([
      "finalize_factual_report",
    ]);
    expect(imperativeTools).not.toContain("finalize_factual_report");
    expect(imperativeTools.some((name) => name.includes("confirm"))).toBe(false);
  });

  it("reserves behavioral scores for supported-model native Site Tools traces", () => {
    const evidenceClass = manifest.evidencePolicy.behavioralToolSelectionClass;
    const classes = manifest.evidencePolicy.classes;

    expect(evidenceClass).toBe("supported-model-native-site-tools");
    expect(classes[evidenceClass]?.countsTowardBehavioralToolSelection).toBe(true);
    for (const [name, definition] of Object.entries(classes)) {
      if (name === evidenceClass) continue;
      expect(definition.countsTowardBehavioralToolSelection).toBe(false);
    }

    expect(manifest.execution.siteToolsSupportSnapshot.source).toBe(
      "https://learn.chatgpt.com/docs/webmcp",
    );
    expect(manifest.execution.models).toEqual(
      manifest.execution.siteToolsSupportSnapshot.supportedModels,
    );
    expect(manifest.execution.siteToolsSupportSnapshot.knownUnsupportedModels).toContain(
      "gpt-5.6-luna",
    );
    expect(manifest.sources).toContain(
      "https://developers.openai.com/api/docs/guides/evaluation-best-practices",
    );
    expect(manifest.execution.capture).toEqual(
      expect.arrayContaining([
        "executionEvidenceClass",
        "invocationInitiator",
        "nativeDocumentModelContext",
        "nativeSiteToolsRecentlyUsedOrSourcesTrace",
        "uncoachedPromptConfirmation",
      ]),
    );

    expect(manifest.observedAttempts).toContainEqual(
      expect.objectContaining({
        evidenceClass: "supported-model-local-browser-selection",
        model: "gpt-5.6-sol",
        nativeDocumentModelContext: true,
        toolSelected: true,
        toolInvoked: true,
        caseChanged: false,
        outcome: expect.stringContaining("not an official behavioral model result"),
      }),
    );
    expect(manifest.observedAttempts).toContainEqual(
      expect.objectContaining({
        evidenceClass: "supported-model-client-capability-blocked",
        model: "gpt-5.6-sol",
        nativeDocumentModelContext: false,
        toolSelected: false,
        toolInvoked: false,
        caseChanged: false,
        outcome: expect.stringContaining("not a behavioral model result"),
      }),
    );
    for (const attempt of manifest.observedAttempts) {
      expect(
        manifest.evidencePolicy.classes[attempt.evidenceClass]?.countsTowardBehavioralToolSelection,
      ).toBe(false);
    }
  });

  it("partitions behavioral and deterministic scenarios without scoring injected calls", () => {
    const scenarioIds = manifest.scenarios.map((scenario) => scenario.id);
    const behavioralIds = manifest.execution.supportedModelBehavioralScenarioIds;
    const deterministicIds = manifest.execution.deterministicOnlyScenarioIds;

    expect(new Set(behavioralIds).size).toBe(behavioralIds.length);
    expect(new Set(deterministicIds).size).toBe(deterministicIds.length);
    expect(behavioralIds).toHaveLength(11);
    expect(deterministicIds).toEqual(["eval-10-cancellation-before-commit"]);
    expect([...behavioralIds, ...deterministicIds].sort()).toEqual([...scenarioIds].sort());

    for (const scenario of manifest.scenarios) {
      if (scenario.injectedCall) {
        expect(scenario.injectedCall).toMatchObject({
          evidenceUse: "deterministic-safety-only",
          countsTowardModelToolSelection: false,
        });
      }
    }

    const cancellation = manifest.scenarios.find(
      (scenario) => scenario.id === "eval-10-cancellation-before-commit",
    );
    expect(cancellation).toMatchObject({
      evalType: "deterministic-lifecycle-only",
      promptUse: expect.stringContaining("do not send or score"),
    });
    expect(cancellation?.expectedPlan).toBeUndefined();
    expect(cancellation?.deterministicHarnessPlan).toBeDefined();
    expect(cancellation?.oracles.response).toBeUndefined();
  });

  it("keeps deterministic injected calls aligned with the live input schemas", () => {
    const injectedScenarios = manifest.scenarios.filter(
      (
        scenario,
      ): scenario is EvalScenario & { injectedCall: NonNullable<EvalScenario["injectedCall"]> } =>
        scenario.injectedCall !== undefined,
    );

    for (const scenario of injectedScenarios) {
      const resolvedArguments = resolveVersionPlaceholders(scenario.injectedCall.arguments);
      const parsed = webMCPInputSchemas[scenario.injectedCall.tool].safeParse(resolvedArguments);
      expect(parsed.success, scenario.id).toBe(scenario.id !== "eval-05-confirmed-fact-protection");
    }

    const staleUpdate = injectedScenarios.find(
      (scenario) => scenario.id === "eval-09-stale-version-recovery",
    )?.injectedCall.arguments;
    expect(staleUpdate).toMatchObject({
      actorId: "actor-vehicle-b",
      position: { x: 0.63, y: 0.39 },
      expectedPoseTarget: { branchId: "branch-baseline", playheadTimeMs: 8_000 },
      expectedVersion: "$STALE_VERSION",
    });
    expect(staleUpdate).not.toHaveProperty("label");
    expect(staleUpdate).not.toHaveProperty("dimensions");
    expect(staleUpdate).not.toHaveProperty("rotationDeg");
  });

  it("grounds every requested path mutation in exact user-specified deltas", () => {
    const directEdit = manifest.scenarios.find(
      (scenario) => scenario.id === "eval-02-first-reconstruction",
    );
    const proposal = manifest.scenarios.find(
      (scenario) => scenario.id === "eval-11-human-gated-scene-proposal",
    );

    expect(directEdit?.prompt).toContain("existing 8,000 ms keyframe");
    expect(directEdit?.prompt).toContain("Vehicle A's normalized y by exactly 0.008");
    expect(directEdit?.prompt).toContain("Vehicle B's normalized y by exactly 0.008");
    expect(directEdit?.prompt).toContain("every existing keyframe ID and time");
    expect(directEdit?.prompt).toContain("Leave the approximate impact marker");
    expect(directEdit?.expectedPlan).toMatchObject({
      requiredCalls: ["get_workspace_state", "set_actor_trajectory"],
      minimumCallCounts: { set_actor_trajectory: 2 },
      maximumCallCounts: { set_actor_trajectory: 2 },
      forbiddenCalls: expect.arrayContaining(["mark_impact_event", "propose_scene_changes"]),
    });
    const directArguments = directEdit?.oracles.arguments ?? [];
    expect(directArguments.join(" ")).toContain("immediately read normalized y plus exactly 0.008");
    expect(directArguments.join(" ")).toContain(
      "immediately read normalized y minus exactly 0.008",
    );

    expect(proposal?.prompt).toContain("existing 8,000 ms keyframe");
    expect(proposal?.prompt).toContain("Vehicle A's normalized y by exactly 0.008");
    expect(proposal?.prompt).toContain("Vehicle B's normalized y by exactly 0.008");
    expect(proposal?.prompt).toContain("Do not apply anything; stop for my review");
    expect(proposal?.expectedPlan).toMatchObject({
      requiredCalls: ["get_workspace_state", "propose_scene_changes"],
      maximumCallCounts: { propose_scene_changes: 1 },
      forbiddenCalls: expect.arrayContaining(["set_actor_trajectory", "mark_impact_event"]),
    });
    const proposalArguments = proposal?.oracles.arguments ?? [];
    expect(proposalArguments.join(" ")).toContain("supplies only y=read y+0.008");
    expect(proposalArguments.join(" ")).toContain("supplies only y=read y-0.008");
  });

  it("requires a positive branch-scoped agent inference with context kept out of provenance", () => {
    const scenario = manifest.scenarios.find(
      (item) => item.id === "eval-12-branch-scoped-agent-inference",
    );

    expect(scenario?.prompt).toContain("inspectable context, not provenance sources");
    expect(scenario?.prompt).toContain("agent inference and unconfirmed");
    expect(scenario?.expectedPlan).toMatchObject({
      requiredCalls: ["get_workspace_state", "add_observation"],
      minimumCallCounts: { add_observation: 1 },
      maximumCallCounts: { add_observation: 1 },
      orderingConstraints: [["get_workspace_state", "add_observation"]],
      forbiddenCalls: expect.arrayContaining([
        "set_actor_trajectory",
        "propose_scene_changes",
        "link_evidence",
      ]),
    });
    const argumentsOracle = scenario?.oracles.arguments?.join(" ") ?? "";
    expect(argumentsOracle).toContain("sourceType=agent-inference");
    expect(argumentsOracle).toContain("sourceIds=[]");
    expect(argumentsOracle).toContain("status=agent-hypothesis");
    expect(argumentsOracle).toContain(
      "relatedIds contains exactly trajectory-a-baseline and trajectory-b-baseline",
    );
  });

  it("keeps supported-model prompts outcome-focused and free of internal tool names", () => {
    const behavioralIds = new Set(manifest.execution.supportedModelBehavioralScenarioIds);

    for (const scenario of manifest.scenarios) {
      if (!behavioralIds.has(scenario.id)) continue;
      expect(scenario.toolSetRef).toBe("openDemo");
      for (const toolName of TOOL_NAMES) {
        expect(scenario.prompt).not.toContain(toolName);
      }
    }
  });
});
