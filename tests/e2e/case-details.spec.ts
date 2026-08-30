import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { openLanding, waitForLocalSave } from "./helpers";

test("edits case identity through an accessible, durable human UI command", async ({ page }) => {
  await openLanding(page);
  await page.getByRole("button", { name: "Start a blank case" }).click();
  await page.getByLabel("Case title").fill("Draft incident title");
  await page.getByLabel(/Incident date/).fill("2026-08-29");
  await page.getByLabel(/Approximate time/).fill("17:42");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create local case" }).click();
  await page.getByRole("button", { name: "Expert", exact: true }).click();
  await waitForLocalSave(page);

  const editButton = page.getByRole("button", { name: "Edit case details" }).first();
  await editButton.click();
  let dialog = page.getByRole("dialog", { name: "Edit case details" });
  await expect(dialog.getByRole("textbox", { name: "Case title" })).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Save details" })).toBeDisabled();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");

  const accessibility = await new AxeBuilder({ page })
    .include(".case-details-dialog")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  expect(
    accessibility.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(editButton).toBeFocused();

  await editButton.click();
  dialog = page.getByRole("dialog", { name: "Edit case details" });
  await dialog.getByRole("textbox", { name: "Case title" }).fill("Corrected incident title");
  await dialog.getByLabel(/Incident date/).fill("2026-08-30");
  await dialog.getByLabel(/Approximate time/).fill("18:05");
  await dialog.getByRole("button", { name: "Save details" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".workspace-case-title")).toContainText("Corrected incident title");
  await expect(page.locator(".workspace-case-title")).toContainText("v2");
  await expect(page.getByRole("region", { name: "Case changes" })).toContainText(
    "Updated case details.",
  );
  await waitForLocalSave(page);

  await page.getByRole("button", { name: "Back to REPLAY home" }).click();
  await page.reload();
  await page.getByRole("button", { name: /Open local case: Corrected incident title/ }).click();
  await expect(page.locator(".workspace-case-title")).toContainText("v2");

  await page.getByRole("button", { name: "Edit case details" }).first().click();
  dialog = page.getByRole("dialog", { name: "Edit case details" });
  await expect(dialog.getByRole("textbox", { name: "Case title" })).toHaveValue(
    "Corrected incident title",
  );
  await expect(dialog.getByLabel(/Incident date/)).toHaveValue("2026-08-30");
  await expect(dialog.getByLabel(/Approximate time/)).toHaveValue("18:05");
});
