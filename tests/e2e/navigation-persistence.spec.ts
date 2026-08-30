import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { inspectorTab, openDemo, openLanding, waitForLocalSave } from "./helpers";

async function createBlankCase(page: Parameters<typeof openLanding>[0], title: string) {
  await page.getByRole("button", { name: "Start a blank case" }).click();
  await page.getByLabel("Case title").fill(title);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create local case" }).click();
  await expect(page.locator("main.workspace")).toBeVisible();
  await expect(page).toHaveURL(/#case\/case-/);
  await waitForLocalSave(page);
  return page.url();
}

test("opens the blank-case wizard from a direct #new route", async ({ page }) => {
  await page.goto("./#new");

  await expect(page).toHaveURL(/#new$/);
  await expect(page.getByRole("heading", { name: "Name the case." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to REPLAY" })).toBeVisible();
});

test("browser history reopens the durable case instead of stale app memory", async ({ page }) => {
  await openDemo(page);
  await inspectorTab(page, "Facts").click();
  await page
    .getByRole("list", { name: "Claims" })
    .getByRole("button", {
      name: /Vehicle A was leaving the roundabout when Vehicle B made contact/,
    })
    .click();
  await page.getByRole("button", { name: "Confirm as human-reviewed" }).click();
  await waitForLocalSave(page);
  await expect(page.locator(".workspace-case-title")).toContainText("v2");
  const caseUrl = page.url();

  await page.goBack();
  await expect(
    page.getByRole("heading", {
      name: "A shared black box for incidents that did not have one.",
      level: 1,
    }),
  ).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(caseUrl);
  await expect(page.locator("main.workspace")).toBeVisible();
  await expect(page.locator(".workspace-case-title")).toContainText("v2");
  await inspectorTab(page, "Facts").click();
  const persistedClaim = page.getByRole("list", { name: "Claims" }).getByRole("button", {
    name: /Vehicle A was leaving the roundabout when Vehicle B made contact/,
  });
  await persistedClaim.click();
  await expect(persistedClaim).toContainText("Confirmed by human");
  await expect(page.locator(".selection-detail")).toContainText(
    "This status came from an explicit human action.",
  );
});

test("lists and reopens every retained local case by its stable route", async ({ page }) => {
  await openLanding(page);
  const alphaUrl = await createBlankCase(page, "Alpha");

  await page.getByRole("button", { name: "Back to REPLAY home" }).click();
  await expect(page.getByRole("heading", { name: "Your local cases" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open local case: Alpha/ })).toBeVisible();

  const betaUrl = await createBlankCase(page, "Beta");
  expect(betaUrl).not.toBe(alphaUrl);
  await page.getByRole("button", { name: "Back to REPLAY home" }).click();

  await page.reload();
  const localCases = page.getByRole("list", { name: "Local cases" });
  await expect(localCases.getByRole("button", { name: /Open local case: Alpha/ })).toBeVisible();
  await expect(localCases.getByRole("button", { name: /Open local case: Beta/ })).toBeVisible();
  expect(await localCases.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  expect(
    await localCases.getByRole("button").evaluateAll((rows) =>
      rows.every((row) => {
        const bounds = row.getBoundingClientRect();
        return bounds.height >= 44 && bounds.left >= 0 && bounds.right <= window.innerWidth;
      }),
    ),
  ).toBe(true);
  const accessibility = await new AxeBuilder({ page })
    .include(".local-case-library")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  expect(
    accessibility.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
  const targetSpacing = await new AxeBuilder({ page })
    .include(".local-case-library")
    .withRules(["target-size"])
    .options({ rules: { "target-size": { enabled: true } } })
    .analyze();
  expect(targetSpacing.violations).toEqual([]);

  await localCases.getByRole("button", { name: /Open local case: Alpha/ }).click();
  await expect(page).toHaveURL(alphaUrl);
  await expect(page.locator(".workspace-case-title")).toContainText("Alpha");

  await page.goBack();
  await expect(page.getByRole("heading", { name: "Your local cases" })).toBeVisible();
  await page.getByRole("button", { name: /Open local case: Beta/ }).click();
  await expect(page).toHaveURL(betaUrl);
  await expect(page.locator(".workspace-case-title")).toContainText("Beta");

  await page.goto(alphaUrl);
  await expect(page.locator(".workspace-case-title")).toContainText("Alpha");
  await page.goto(betaUrl);
  await expect(page.locator(".workspace-case-title")).toContainText("Beta");
});

test("deletes only the human-confirmed local case and keeps the other saved case", async ({
  page,
}) => {
  await openLanding(page);
  const removableUrl = await createBlankCase(page, "Remove this case");

  await page.getByRole("button", { name: "Back to REPLAY home" }).click();
  const retainedUrl = await createBlankCase(page, "Keep this case");
  await page.getByRole("button", { name: "Back to REPLAY home" }).click();

  const removableOpenButton = page.getByRole("button", {
    name: /Open local case: Remove this case/,
  });
  const deleteButton = page.getByRole("button", {
    name: "Delete local case: Remove this case",
  });
  await expect(removableOpenButton).toBeVisible();
  await deleteButton.click();

  const dialog = page.getByRole("alertdialog", { name: "Delete “Remove this case”?" });
  await expect(dialog).toBeVisible();
  await expect(page.locator(".dialog-backdrop")).toHaveCSS("position", "fixed");
  const viewport = page.viewportSize();
  const dialogBox = await dialog.boundingBox();
  if (!viewport || !dialogBox) throw new Error("The open deletion dialog must have geometry");
  expect(Math.abs(dialogBox.x + dialogBox.width / 2 - viewport.width / 2)).toBeLessThan(2);
  expect(Math.abs(dialogBox.y + dialogBox.height / 2 - viewport.height / 2)).toBeLessThan(2);
  await expect(
    dialog.getByText("Site Tools cannot request or confirm this deletion"),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Keep case" })).toBeFocused();
  await expect(removableOpenButton).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(deleteButton).toBeFocused();
  await expect(removableOpenButton).toBeVisible();

  await deleteButton.click();
  await dialog.getByRole("button", { name: "Delete local case" }).click();
  await expect(dialog).toBeHidden();
  await expect(removableOpenButton).toBeHidden();
  await expect(page.getByRole("status")).toContainText(
    "Deleted Remove this case from this browser.",
  );
  await expect(page.getByRole("status")).toBeFocused();
  await expect(page.getByRole("button", { name: /Open local case: Keep this case/ })).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("button", { name: /Open local case: Remove this case/ }),
  ).toBeHidden();
  await page.getByRole("button", { name: /Open local case: Keep this case/ }).click();
  await expect(page).toHaveURL(retainedUrl);
  await expect(page.locator(".workspace-case-title")).toContainText("Keep this case");

  await page.goto(removableUrl);
  await expect(page.getByRole("alert")).toContainText("Saved case unavailable");
  await expect(page.getByRole("alert")).toContainText(
    "That local case is not available in this browser",
  );
});
