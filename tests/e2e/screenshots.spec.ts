import { expect, test, type Page, type TestInfo } from "@playwright/test";

import {
  inspectorTab,
  installModelContextPolyfill,
  openDemo,
  openLanding,
  waitForImages,
} from "./helpers";

function requireBaselineProject(testInfo: TestInfo): void {
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "One deterministic Chromium project owns the shared cross-platform baselines.",
  );
}

async function settle(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

async function expectVisual(
  page: Page,
  name: string,
  options: { maskSaveStatus?: boolean } = {},
): Promise<void> {
  await settle(page);
  const mask = [page.locator(".activity-item__meta time")];
  if (options.maskSaveStatus !== false) mask.unshift(page.locator(".save-status"));
  await expect(page).toHaveScreenshot(name, {
    animations: "disabled",
    caret: "hide",
    mask,
    maskColor: "#ff00ff",
    maxDiffPixelRatio: 0.035,
    threshold: 0.25,
  });
}

async function invokeSiteTool(
  page: Page,
  name: string,
  input: Readonly<Record<string, unknown>>,
): Promise<{ caseVersion: number; data?: unknown }> {
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
      if (!modelContext) throw new Error("Site Tools are unavailable.");
      const tool = (await modelContext.getTools()).find((candidate) => candidate.name === toolName);
      if (!tool) throw new Error(`${toolName} is not registered.`);
      return modelContext.executeTool(tool, payload);
    },
    { toolName: name, payload: input },
  );
  return JSON.parse(serialized) as { caseVersion: number; data?: unknown };
}

test.describe("judge-facing visual regression", () => {
  test("landing page at desktop and mobile widths", async ({ page }, testInfo) => {
    requireBaselineProject(testInfo);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLanding(page);
    await waitForImages(page);
    await expectVisual(page, "landing-1440x900.png");

    const scenarioLab = page.getByRole("region", {
      name: "Test the model on roads that behave differently.",
    });
    await scenarioLab.scrollIntoViewIfNeeded();
    await expect(page.locator(".scenario-card.is-high-speed")).toContainText("High-speed review");
    await expectVisual(page, "scenario-lab-1440x900.png");

    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectVisual(page, "landing-390x844.png");

    await page.locator(".scenario-card.is-high-speed").scrollIntoViewIfNeeded();
    await expectVisual(page, "scenario-lab-390x844.png");
  });

  test("seeded workspace and selected vehicle", async ({ page }, testInfo) => {
    requireBaselineProject(testInfo);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDemo(page);
    await expect(page.locator(".save-status")).toContainText("Saved locally");
    await expectVisual(page, "workspace-seeded-1440x900.png");

    await page.setViewportSize({ width: 1280, height: 800 });
    const vehicle = page.getByRole("button", { name: /^Vehicle A, position/ });
    await vehicle.focus();
    await vehicle.press("Enter");
    await expect(page.getByRole("region", { name: "Vehicle A" })).toBeVisible();
    await expectVisual(page, "workspace-selected-vehicle-1280x800.png");

    await page.getByRole("button", { name: "Edit path" }).click();
    await expect(
      page.getByText("A path point is the vehicle’s pose at a specific time."),
    ).toBeVisible();
    await expectVisual(page, "workspace-selected-trajectory-1280x800.png");

    await page.getByRole("button", { name: /Approximate impact at 10\.0 seconds/ }).click();
    await expect(
      page.getByRole("button", { name: "Play authored motion around impact" }),
    ).toBeVisible();
    await expectVisual(page, "workspace-impact-review-1280x800.png");
  });

  test("mobile workspace keeps case context and readable tabs", async ({ page }, testInfo) => {
    requireBaselineProject(testInfo);
    await page.setViewportSize({ width: 390, height: 844 });
    await openDemo(page);
    await expect(page.locator(".workspace-case-title")).toContainText(
      "Roundabout incident — 17:42",
    );
    await expect(page.locator(".workspace-case-title")).toContainText("v1");
    await expect(page.locator(".save-status")).toContainText("Saved locally");
    await expectVisual(page, "workspace-seeded-390x844.png", { maskSaveStatus: false });
  });

  test("mobile impact review and report finalization remain reachable", async ({
    page,
  }, testInfo) => {
    requireBaselineProject(testInfo);
    await page.setViewportSize({ width: 390, height: 844 });
    await openDemo(page);

    await page.getByRole("button", { name: /Approximate impact at 10\.0 seconds/ }).click();
    const impactReview = page.getByTestId("impact-adjacent-paths");
    await impactReview.scrollIntoViewIfNeeded();
    await expect(impactReview).toContainText("23.9 → 18.1 km/h");
    await expect(impactReview).toContainText("23.3 → 18.1 km/h");
    await expect(impactReview).not.toContainText(/(?:12|13)\.\d+ km\/h/);
    await expectVisual(page, "workspace-impact-review-390x844.png");

    await inspectorTab(page, "Report").click();
    await page.getByRole("button", { name: "Build report preview" }).click();
    const preview = page.locator(".report-preview");
    await preview.scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "Review and finalize" })).toBeVisible();
    await expectVisual(page, "report-preview-390x844.png");

    await page.getByRole("button", { name: "Review and finalize" }).click();
    await expect(page.getByRole("dialog", { name: "Review before finalizing" })).toBeVisible();
    await expectVisual(page, "report-finalization-390x844.png");
  });

  test("focused inconsistency and unsupported Site Tools state", async ({ page }, testInfo) => {
    requireBaselineProject(testInfo);
    await page.setViewportSize({ width: 1024, height: 768 });
    await openDemo(page);
    await inspectorTab(page, "Report").click();
    await page.locator(".issue-row").first().click();
    await expect(page.locator(".issue-row.is-focused")).toBeVisible();
    await expectVisual(page, "workspace-focused-inconsistency-1024x768.png");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator("button.webmcp-status").click();
    await expect(page.getByRole("dialog", { name: "Learn REPLAY" })).toBeVisible();
    await expectVisual(page, "site-tools-guide-manual-1440x900.png");
  });

  test("supported Site Tools guide exposes the fast proof", async ({ page }, testInfo) => {
    requireBaselineProject(testInfo);
    await installModelContextPolyfill(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDemo(page);
    const status = page.locator("button.webmcp-status");
    await expect(status).toContainText(/\d+ registered/);
    await status.click();
    await expect(
      page.getByRole("heading", { name: "30 seconds from structured read to review" }),
    ).toBeVisible();
    await expectVisual(page, "site-tools-guide-ready-1440x900.png");
  });

  test("coordinated proposal review exposes calibrated deltas and a scoped ghost", async ({
    page,
  }, testInfo) => {
    requireBaselineProject(testInfo);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installModelContextPolyfill(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDemo(page);
    type Trajectory = {
      actorId: string;
      branchId: string;
      keyframes: Array<{ id: string; timeMs: number; y: number }>;
    };
    const workspace = await invokeSiteTool(page, "get_workspace_state", { sections: ["scene"] });
    const trajectories = (workspace.data as { scene: { trajectories: Trajectory[] } }).scene
      .trajectories;
    const targetFor = (actorId: string) => {
      const trajectory = trajectories.find((candidate) => candidate.actorId === actorId);
      const keyframe = trajectory?.keyframes.find((candidate) => candidate.timeMs === 8_000);
      if (!trajectory || !keyframe) throw new Error(`Missing 8 s path point for ${actorId}.`);
      return { trajectory, keyframe };
    };
    const vehicleA = targetFor("actor-vehicle-a");
    const vehicleB = targetFor("actor-vehicle-b");
    await invokeSiteTool(page, "propose_scene_changes", {
      title: "Review a coordinated lane alternative",
      rationale:
        "Preserve the authored baseline while a person reviews two bounded interior path changes.",
      changes: [
        {
          kind: "trajectory-keyframe-patch",
          actorId: vehicleA.trajectory.actorId,
          branchId: vehicleA.trajectory.branchId,
          adjustments: [{ keyframeId: vehicleA.keyframe.id, y: vehicleA.keyframe.y + 0.008 }],
        },
        {
          kind: "trajectory-keyframe-patch",
          actorId: vehicleB.trajectory.actorId,
          branchId: vehicleB.trajectory.branchId,
          adjustments: [{ keyframeId: vehicleB.keyframe.id, y: vehicleB.keyframe.y - 0.008 }],
        },
      ],
      expectedVersion: workspace.caseVersion,
      requestId: "visual-proposal-review-0001",
    });
    const summary = page.getByRole("list", { name: "Proposed change summary" });
    const vehicleASummary = summary
      .getByRole("listitem")
      .filter({ has: page.getByText("Vehicle A", { exact: true }) });
    await page.getByRole("button", { name: /Review Vehicle A proposal at 8\.000 s/ }).click();
    await expect(page.getByTestId("proposal-scene-review")).toContainText(
      "Proposed Vehicle A · 8.0 s",
    );
    await expectVisual(page, "proposal-review-1440x900.png");

    await page.setViewportSize({ width: 390, height: 844 });
    await vehicleASummary.scrollIntoViewIfNeeded();
    await expectVisual(page, "proposal-review-390x844.png");
  });

  test("hypothesis comparison", async ({ page }, testInfo) => {
    requireBaselineProject(testInfo);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDemo(page);
    await inspectorTab(page, "Hypotheses").click();
    await page.getByRole("button", { name: "Fork hypothesis" }).click();
    await page.getByLabel("Branch name").fill("Outer-lane alternative");
    await page
      .getByLabel("What changes")
      .fill("Vehicle B follows an outward path while shared observations remain unchanged.");
    await page.getByRole("button", { name: "Fork reconstruction" }).click();
    await page.getByRole("button", { name: "Compare side by side" }).click();
    await expect(page.locator(".comparison-banner")).toBeVisible();
    await expectVisual(page, "hypothesis-comparison-1440x900.png");
  });

  test("report preview and finalization review", async ({ page }, testInfo) => {
    requireBaselineProject(testInfo);
    await page.setViewportSize({ width: 1280, height: 800 });
    await openDemo(page);
    await inspectorTab(page, "Report").click();
    await page.getByRole("button", { name: "Build report preview" }).click();
    await expect(page.locator(".report-preview")).toBeVisible();
    await expectVisual(page, "report-preview-1280x800.png");

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.getByRole("button", { name: "Review and finalize" }).click();
    await expect(page.getByRole("dialog", { name: "Review before finalizing" })).toBeVisible();
    await expectVisual(page, "report-finalization-1024x768.png");
  });
});
