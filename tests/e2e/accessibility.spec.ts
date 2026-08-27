import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { inspectorTab, openDemo, openLanding } from "./helpers";

async function expectNoHighImpactViolations(page: Page, state: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
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

    await page.getByRole("button", { name: "Start a blank case" }).click();
    await expect(page.getByRole("heading", { name: "Name the account." })).toBeVisible();
    await expectNoHighImpactViolations(page, "blank-case wizard");
  });

  test("demo workspace and human finalization dialog have no serious or critical violations", async ({
    page,
  }) => {
    await openDemo(page);
    await expectNoHighImpactViolations(page, "demo workspace");

    await inspectorTab(page, "Report").click();
    await page.getByRole("button", { name: "Build report preview" }).click();
    await page.getByRole("button", { name: "Review and finalize" }).click();
    await expect(page.getByRole("dialog", { name: "Review before finalizing" })).toBeVisible();
    await expectNoHighImpactViolations(page, "human finalization dialog");
  });
});
