/// <reference types="node" />

import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { inspectorTab, installModelContextPolyfill, openDemo, waitForLocalSave } from "./helpers";

interface SiteToolResult {
  ok: boolean;
  caseVersion: number;
  affectedIds: string[];
  issues: Array<{ id: string; title: string }>;
  visibleState: { workspaceMode: string };
  data?: unknown;
}

interface WorkspaceTrajectory {
  id: string;
  actorId: string;
  branchId: string;
  keyframes: Array<{
    id: string;
    timeMs: number;
    x: number;
    y: number;
    rotationDeg: number;
  }>;
}

async function invokeSiteTool(
  page: Page,
  name: string,
  input: Readonly<Record<string, unknown>>,
): Promise<SiteToolResult> {
  const serialized = await page.evaluate(
    async ({ toolName, payload }) => {
      const modelContext = (
        document as Document & {
          modelContext?: {
            getTools(): Promise<Array<{ name: string }>>;
            executeTool(
              tool: { name: string },
              input: Readonly<Record<string, unknown>>,
            ): Promise<string>;
          };
        }
      ).modelContext;
      if (!modelContext) throw new Error("Site Tools polyfill is unavailable.");
      const tool = (await modelContext.getTools()).find((candidate) => candidate.name === toolName);
      if (!tool) throw new Error(`${toolName} is not registered.`);
      return modelContext.executeTool(tool, payload);
    },
    { toolName: name, payload: input },
  );
  return JSON.parse(serialized) as SiteToolResult;
}

function trajectoryAtEightSeconds(trajectories: WorkspaceTrajectory[], actorId: string) {
  const trajectory = trajectories.find((candidate) => candidate.actorId === actorId);
  const keyframe = trajectory?.keyframes.find((candidate) => candidate.timeMs === 8_000);
  if (!trajectory || !keyframe) {
    throw new Error(`${actorId} must expose its existing 8,000 ms keyframe.`);
  }
  return { trajectory, keyframe };
}

test.describe("hackathon submission story", () => {
  test("rehearses the complete Site Tools to human-finalized PDF journey", async ({ page }) => {
    test.slow();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => {
      failedRequests.push(
        `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "failed"}`,
      );
    });

    await installModelContextPolyfill(page);
    await openDemo(page);
    const siteToolsStatus = page.locator("button.webmcp-status");
    await expect(siteToolsStatus).toContainText("18 registered", { timeout: 10_000 });

    const workspace = await invokeSiteTool(page, "get_workspace_state", {
      sections: ["scene", "questions"],
    });
    const validation = await invokeSiteTool(page, "validate_case_consistency", { scope: "all" });
    expect(workspace).toMatchObject({ ok: true, caseVersion: 1 });
    expect(validation).toMatchObject({ ok: true, caseVersion: 1 });
    expect(validation.issues.length).toBeGreaterThan(0);
    const focused = await invokeSiteTool(page, "focus_workspace_item", {
      itemType: "question",
      itemId: "question-lane-change",
    });
    expect(focused).toMatchObject({ ok: true, caseVersion: 1 });
    await expect(inspectorTab(page, "Questions")).toHaveAttribute("aria-current", "page");

    const trajectories = (workspace.data as { scene: { trajectories: WorkspaceTrajectory[] } })
      .scene.trajectories;
    const vehicleA = trajectoryAtEightSeconds(trajectories, "actor-vehicle-a");
    const vehicleB = trajectoryAtEightSeconds(trajectories, "actor-vehicle-b");
    const proposal = await invokeSiteTool(page, "propose_scene_changes", {
      title: "Review a coordinated lane alternative",
      rationale:
        "Preserve the authored baseline while a person reviews two bounded interior path changes.",
      changes: [
        {
          kind: "trajectory-keyframe-patch",
          actorId: vehicleA.trajectory.actorId,
          branchId: vehicleA.trajectory.branchId,
          adjustments: [{ keyframeId: vehicleA.keyframe.id, y: vehicleA.keyframe.y + 0.008 }],
          visible: true,
        },
        {
          kind: "trajectory-keyframe-patch",
          actorId: vehicleB.trajectory.actorId,
          branchId: vehicleB.trajectory.branchId,
          adjustments: [{ keyframeId: vehicleB.keyframe.id, y: vehicleB.keyframe.y - 0.008 }],
          visible: true,
        },
      ],
      expectedVersion: 1,
      requestId: "submission-story-proposal-0001",
    });
    expect(proposal).toMatchObject({ ok: true, caseVersion: 2 });
    await expect(page.getByRole("heading", { name: "1 change set awaiting you" })).toBeVisible();
    await expect(page.locator(".proposal-scene-path")).toHaveCount(2);
    const proposalSummary = page.getByRole("list", { name: "Proposed change summary" });
    const vehicleASummary = proposalSummary
      .getByRole("listitem")
      .filter({ has: page.getByText("Vehicle A", { exact: true }) });
    const vehicleBSummary = proposalSummary
      .getByRole("listitem")
      .filter({ has: page.getByText("Vehicle B", { exact: true }) });
    await expect(vehicleASummary).toContainText(/1 of \d+ points changed/);
    await expect(vehicleASummary).toContainText("Endpoints preserved");
    await expect(vehicleBSummary).toContainText(/1 of \d+ points changed/);
    await expect(vehicleBSummary).toContainText("Endpoints preserved");

    const vehicleAToggle = vehicleASummary.getByRole("button", {
      name: /Vehicle A proposal details/,
    });
    const vehicleBToggle = vehicleBSummary.getByRole("button", {
      name: /Vehicle B proposal details/,
    });
    await expect(vehicleAToggle).toHaveAttribute("aria-expanded", "true");
    await expect(vehicleBToggle).toHaveAttribute("aria-expanded", "false");
    const vehicleADetails = page.locator("#proposal-target-details-0-0");
    const vehicleBDetails = page.locator("#proposal-target-details-0-1");
    await expect(vehicleADetails).toContainText("ΔX 0.00 m · ΔY +0.56 m · Δ rotation 0.0 °");
    await expect(vehicleADetails).toContainText(
      "Calibrated deltas · template · declared scene uncertainty ±1 m",
    );
    await vehicleBToggle.click();
    await expect(vehicleAToggle).toHaveAttribute("aria-expanded", "false");
    await expect(vehicleBToggle).toHaveAttribute("aria-expanded", "true");
    await expect(vehicleADetails).toHaveCount(0);
    await expect(vehicleBDetails).toContainText("ΔX 0.00 m · ΔY −0.56 m · Δ rotation 0.0 °");
    await vehicleAToggle.click();

    const reviewVehicleA = vehicleADetails.getByRole("button", {
      name: /Review Vehicle A proposal at 8\.000 s/,
    });
    await reviewVehicleA.click();
    await expect(page.getByRole("slider", { name: "Timeline position" })).toHaveValue("8000");
    await expect(page.getByLabel("Current timeline position")).toContainText("0:08.0");
    await expect(reviewVehicleA).toHaveAttribute("aria-current", "time");
    const proposalSceneReview = page.getByTestId("proposal-scene-review");
    await expect(proposalSceneReview).toHaveCount(1);
    await expect(proposalSceneReview).toContainText("Proposed Vehicle A · 8.0 s");

    const sceneWhilePending = await invokeSiteTool(page, "get_workspace_state", {
      sections: ["scene"],
    });
    expect(sceneWhilePending).toMatchObject({ ok: true, caseVersion: 2 });
    const pendingTrajectories = (
      sceneWhilePending.data as { scene: { trajectories: WorkspaceTrajectory[] } }
    ).scene.trajectories;
    expect(trajectoryAtEightSeconds(pendingTrajectories, "actor-vehicle-a").keyframe.y).toBe(
      vehicleA.keyframe.y,
    );
    expect(trajectoryAtEightSeconds(pendingTrajectories, "actor-vehicle-b").keyframe.y).toBe(
      vehicleB.keyframe.y,
    );

    await page.getByRole("button", { name: "Reject" }).click();
    await page
      .getByRole("alertdialog", { name: "Reject this proposal?" })
      .getByRole("button", { name: "Reject proposal" })
      .click();
    await expect(page.locator(".proposal-scene-path")).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Durable case changes" })).toContainText(
      "Human rejected agent proposal: Review a coordinated lane alternative.",
    );
    await waitForLocalSave(page);
    const afterRejection = await invokeSiteTool(page, "get_case_summary", {});
    expect(afterRejection).toMatchObject({ ok: true, caseVersion: 3 });

    await page.getByRole("button", { name: /Approximate impact at 10\.0 seconds/ }).click();
    const impactReadout = page.getByTestId("impact-adjacent-paths");
    await expect(impactReadout).toContainText("23.9 → 18.1 km/h");
    await expect(impactReadout).toContainText("23.3 → 18.1 km/h");
    await page.getByLabel("Playback speed").selectOption("2");
    await page.getByRole("button", { name: "Play authored motion around impact" }).click();
    const scrubber = page.getByRole("slider", { name: "Timeline position" });
    await expect.poll(async () => Number(await scrubber.inputValue())).toBe(14_000);
    await expect(page.locator(".scene-contact-readout")).toContainText("Vehicle footprints clear");

    const inferenceStatement =
      "The available paths may permit more than one lane-crossing explanation.";
    const observation = await invokeSiteTool(page, "add_observation", {
      statement: inferenceStatement,
      sourceType: "agent-inference",
      sourceIds: [],
      relatedIds: [vehicleA.trajectory.id, vehicleB.trajectory.id],
      status: "agent-hypothesis",
      branchId: vehicleA.trajectory.branchId,
      sharedAcrossBranches: false,
      expectedVersion: 3,
      requestId: "submission-story-inference-0001",
    });
    expect(observation).toMatchObject({ ok: true, caseVersion: 4 });
    await inspectorTab(page, "Facts").click();
    await page.getByRole("button", { name: new RegExp(inferenceStatement) }).click();
    const inferenceDetail = page.getByLabel("Selected observation");
    await expect(inferenceDetail.locator(".status-pill")).toHaveText("Agent hypothesis");
    await expect(
      inferenceDetail.getByRole("button", { name: "Confirm as human-reviewed" }),
    ).toHaveCount(0);

    await page
      .getByRole("button", {
        name: /The exact lane positions immediately before contact are unknown/,
      })
      .click();
    await page.getByRole("button", { name: "Confirm as human-reviewed" }).click();
    await expect(page.getByText("This status came from an explicit human action.")).toBeVisible();
    await waitForLocalSave(page);
    const beforeReport = await invokeSiteTool(page, "get_case_summary", {});
    expect(beforeReport).toMatchObject({ ok: true, caseVersion: 5 });

    const preview = await invokeSiteTool(page, "build_report_preview", { expectedVersion: 5 });
    expect(preview).toMatchObject({ ok: true, caseVersion: 5 });
    await expect(siteToolsStatus).toContainText("19 registered", { timeout: 10_000 });
    await expect(page.locator(".report-preview__status")).toContainText("Draft — not finalized");
    await page.getByRole("button", { name: "Review and finalize" }).click();
    const review = page.getByRole("dialog", { name: "Review before finalizing" });
    await expect(
      review.getByText("The agent can prepare this screen but cannot complete it."),
    ).toBeVisible();
    await review.getByLabel("I reviewed unresolved questions.").check();
    await review.getByLabel("I acknowledge the method and limitations.").check();
    await review.getByLabel("I reviewed every confirmed fact.").check();
    await expect(
      review.getByRole("heading", { name: "Unconfirmed and hypothesis content" }),
    ).toBeVisible();
    await review
      .getByLabel("I reviewed every included unconfirmed and hypothesis statement.")
      .check();
    await review.getByRole("button", { name: "Continue to confirmation" }).click();
    await page
      .getByRole("alertdialog", { name: "Create an immutable report snapshot?" })
      .getByRole("button", { name: "Finalize factual report" })
      .click();
    await expect(page.locator(".report-preview__status")).toContainText(
      "Finalized immutable snapshot",
    );
    await expect(siteToolsStatus).toContainText("18 registered", { timeout: 10_000 });
    await waitForLocalSave(page);

    const [pdfDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "PDF snapshot", exact: true }).click(),
    ]);
    const pdfPath = await pdfDownload.path();
    if (!pdfPath) throw new Error("Playwright did not retain the finalized PDF.");
    const pdf = await readFile(pdfPath);
    expect(pdf.byteLength).toBeGreaterThan(1_000);
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");

    const finalSummary = await invokeSiteTool(page, "get_case_summary", {});
    expect(finalSummary).toMatchObject({ ok: true, caseVersion: 6 });
    const browserContract = await page.evaluate(async () => {
      const scopedDocument = document as Document & {
        modelContext?: { getTools(): Promise<Array<{ name: string }>> };
      };
      const scopedWindow = window as unknown as Window & {
        __replayWebMCPRegistrationAudit: {
          calls: string[];
          aborted: string[];
          executions: Array<{ name: string }>;
        };
      };
      return {
        tools: (await scopedDocument.modelContext?.getTools())?.map((tool) => tool.name) ?? [],
        audit: structuredClone(scopedWindow.__replayWebMCPRegistrationAudit),
      };
    });
    expect(browserContract.tools).not.toContain("finalize_factual_report");
    expect(browserContract.tools).not.toContain("add_report_note");
    expect(browserContract.audit.aborted).toEqual(["add_report_note"]);
    expect(browserContract.audit.executions.map((entry) => entry.name)).toEqual([
      "get_workspace_state",
      "validate_case_consistency",
      "focus_workspace_item",
      "propose_scene_changes",
      "get_workspace_state",
      "get_case_summary",
      "add_observation",
      "get_case_summary",
      "build_report_preview",
      "get_case_summary",
    ]);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });
});
