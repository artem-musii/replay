import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { inspectorTab, installModelContextPolyfill, openDemo, openLanding } from "./helpers";

async function expectNoHighImpactViolations(page: Page, state: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  const violations = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  const summary = violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact ?? "unknown"}): ${violation.help}\n${violation.nodes
          .map((node) => `  ${node.target.join(" ")}: ${node.failureSummary ?? "failed"}`)
          .join("\n")}`,
    )
    .join("\n\n");
  expect(violations, `${state} has serious or critical axe violations:\n${summary}`).toEqual([]);
}

test.describe("accessibility guardrails", () => {
  test("landing and blank-case wizard have no serious or critical violations", async ({ page }) => {
    await openLanding(page);
    await expectNoHighImpactViolations(page, "landing page");

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();

    await page.getByRole("button", { name: "Start a blank case" }).click();
    await expect(page.getByRole("heading", { name: "Name the account." })).toBeVisible();
    await expectNoHighImpactViolations(page, "blank-case wizard");
  });

  test("demo workspace and human finalization dialog have no serious or critical violations", async ({
    page,
  }) => {
    await openDemo(page);
    await expectNoHighImpactViolations(page, "demo workspace");

    await inspectorTab(page, "Evidence").click();
    await expectNoHighImpactViolations(page, "evidence workspace");
    await inspectorTab(page, "Hypotheses").click();
    await expectNoHighImpactViolations(page, "hypothesis workspace");

    await inspectorTab(page, "Report").click();
    await page.getByRole("button", { name: "Build report preview" }).click();
    await page.getByRole("button", { name: "Review and finalize" }).click();
    await expect(page.getByRole("dialog", { name: "Review before finalizing" })).toBeVisible();
    await expectNoHighImpactViolations(page, "human finalization dialog");
  });

  test("workspace skip link bypasses the header and the 320px layout reflows", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    // Direct route entry starts sequential focus navigation at the document
    // boundary without inheriting focus from the landing-page launch control.
    await page.goto("/#demo");
    await expect(page.locator("main.workspace")).toBeVisible();
    await expect(page.locator(".save-status")).toContainText("Saved locally");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
    await expect(inspectorTab(page, "Report")).toBeVisible();

    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });

  test("agent proposal, debug inspector, comparison, and confirmation states pass axe", async ({
    page,
  }) => {
    await installModelContextPolyfill(page);
    await openDemo(page);
    await page.evaluate(async () => {
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
      const tools = await modelContext.getTools();
      const summaryTool = tools.find((tool) => tool.name === "get_case_summary");
      const proposalTool = tools.find((tool) => tool.name === "propose_scene_changes");
      if (!summaryTool || !proposalTool) throw new Error("Required Site Tools are not registered.");
      const summary = JSON.parse(await modelContext.executeTool(summaryTool, {})) as {
        caseVersion: number;
      };
      await modelContext.executeTool(proposalTool, {
        title: "Accessible two-vehicle preview",
        rationale: "Preview both positions together for explicit human review.",
        changes: [
          {
            kind: "actor-pose",
            actorId: "actor-vehicle-a",
            proposedPose: { x: 0.61, y: 0.47, rotationDeg: 8 },
          },
          {
            kind: "actor-pose",
            actorId: "actor-vehicle-b",
            proposedPose: { x: 0.55, y: 0.64, rotationDeg: 84 },
          },
        ],
        expectedVersion: summary.caseVersion,
        requestId: "request-a11y-proposal-0001",
      });
    });
    await expect(page.getByRole("heading", { name: "1 change set awaiting you" })).toBeVisible();
    await expectNoHighImpactViolations(page, "agent proposal workspace");

    await page.locator("button.webmcp-status").click();
    await expect(page.getByRole("dialog", { name: "WebMCP Site Tools" })).toBeVisible();
    await expectNoHighImpactViolations(page, "WebMCP debug inspector");
    await page.getByRole("button", { name: "Close WebMCP inspector" }).click();

    await page.getByRole("button", { name: "Reject" }).click();
    await page
      .getByRole("alertdialog", { name: "Reject this proposal?" })
      .getByRole("button", { name: "Reject proposal" })
      .click();

    await inspectorTab(page, "Hypotheses").click();
    await page.getByRole("button", { name: "Fork hypothesis" }).click();
    await page.getByLabel("Branch name").fill("Accessibility comparison");
    await page
      .getByLabel("What changes")
      .fill("A second possible path that preserves every shared confirmed observation.");
    await page.getByRole("button", { name: "Fork reconstruction" }).click();
    await page.getByRole("button", { name: "Compare side by side" }).click();
    await expectNoHighImpactViolations(page, "hypothesis comparison");

    await inspectorTab(page, "Evidence").click();
    await page.getByRole("button", { name: "Delete local evidence" }).click();
    await expectNoHighImpactViolations(page, "evidence deletion confirmation");
    await page
      .getByRole("alertdialog", { name: "Delete this evidence?" })
      .getByRole("button", { name: "Cancel" })
      .click();

    await inspectorTab(page, "Report").click();
    await page.getByRole("button", { name: "Build report preview" }).click();
    await page.getByRole("button", { name: "Review and finalize" }).click();
    const review = page.getByRole("dialog", { name: "Review before finalizing" });
    await review.getByLabel("I reviewed unresolved questions.").check();
    await review.getByLabel("I acknowledge the method and limitations.").check();
    await review.getByLabel("I reviewed every confirmed fact.").check();
    await review.getByRole("button", { name: "Continue to confirmation" }).click();
    await expectNoHighImpactViolations(page, "final report confirmation");
  });
});
