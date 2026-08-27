import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { inspectorTab, openDemo, openLanding, waitForImages } from "./helpers";

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

async function expectVisual(page: Page, name: string): Promise<void> {
  await settle(page);
  await expect(page).toHaveScreenshot(name, {
    animations: "disabled",
    caret: "hide",
    mask: [page.locator(".save-status"), page.locator(".activity-item__meta time")],
    maskColor: "#ff00ff",
    maxDiffPixelRatio: 0.035,
    threshold: 0.25,
  });
}

test.describe("judge-facing visual regression", () => {
  test("landing page at desktop and mobile widths", async ({ page }, testInfo) => {
    requireBaselineProject(testInfo);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLanding(page);
    await waitForImages(page);
    await expectVisual(page, "landing-1440x900.png");

    await page.setViewportSize({ width: 390, height: 844 });
    await expectVisual(page, "landing-390x844.png");
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
    await expect(page.getByRole("dialog", { name: "WebMCP Site Tools" })).toBeVisible();
    await expectVisual(page, "webmcp-unsupported-1440x900.png");
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
