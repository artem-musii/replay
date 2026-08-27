import { expect, test, type Locator, type Page } from "@playwright/test";

import { inspectorTab, openDemo } from "./helpers";

function definitionFor(scope: Locator, term: string): Locator {
  return scope
    .locator("dt")
    .filter({ hasText: new RegExp(`^${term}$`) })
    .locator("..")
    .locator("dd");
}

function claimRow(page: Page, statement: string): Locator {
  return page
    .getByRole("list", { name: "Claims" })
    .getByRole("button")
    .filter({ hasText: statement });
}

test.describe("explicit human workspace journeys", () => {
  test.describe.configure({ mode: "serial" });

  test("answers an open question and creates a reported observation", async ({ page }) => {
    const question = "Which vehicle, if either, crossed the lane boundary before contact?";
    const answer = "Neither driver could reliably identify a lane crossing before contact.";

    await openDemo(page);
    await page
      .getByRole("navigation", { name: "Case workspaces" })
      .getByRole("button", { name: /^Questions/ })
      .click();

    const questionCard = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: question, exact: true }),
    });
    await questionCard.getByRole("button", { name: "Answer", exact: true }).click();
    await questionCard.getByLabel("Answer", { exact: true }).fill(answer);
    await questionCard.getByLabel("Also create a reported observation").check();
    await questionCard.getByRole("button", { name: "Save answer", exact: true }).click();

    await expect(questionCard.getByText("answered", { exact: true })).toBeVisible();
    await expect(questionCard.locator("blockquote")).toContainText(answer);
    await expect(page.getByLabel("Case activity")).toContainText(`Updated question: ${question}`);

    await inspectorTab(page, "Facts").click();
    const observation = claimRow(page, answer);
    await expect(observation).toHaveCount(1);
    await expect(observation).toContainText("Reported · human statement");
    await observation.click();
    await expect(page.getByLabel("Selected observation").getByLabel("Classification")).toHaveValue(
      "reported",
    );
  });

  test("links evidence to an observation and exposes the link on both records", async ({
    page,
  }) => {
    const targetObservation = "The exact lane positions immediately before contact are unknown.";

    await openDemo(page);
    await inspectorTab(page, "Facts").click();
    await claimRow(page, targetObservation).click();
    await expect(definitionFor(page.getByLabel("Selected observation"), "Evidence")).toHaveText(
      "None linked",
    );

    await inspectorTab(page, "Evidence").click();
    await page.getByRole("button", { name: /^Wet road markings.*Demo$/ }).click();
    const evidenceDetail = page.locator("section.evidence-detail");
    await expect(definitionFor(evidenceDetail, "Links")).toHaveText("2");
    await evidenceDetail.getByLabel("Link to case item").selectOption({ label: targetObservation });
    await evidenceDetail.getByRole("button", { name: "Link", exact: true }).click();

    await expect(definitionFor(evidenceDetail, "Links")).toHaveText("3");
    await expect(page.getByLabel("Case activity")).toContainText(
      "Linked evidence Wet road markings — synthetic demo.webp.",
    );

    await inspectorTab(page, "Facts").click();
    await claimRow(page, targetObservation).click();
    await expect(definitionFor(page.getByLabel("Selected observation"), "Evidence")).toHaveText(
      "1",
    );
  });

  test("undoes and redoes a visible human observation with state and activity restored", async ({
    page,
  }) => {
    const statement = "A witness reported that both vehicles stopped immediately after contact.";

    await openDemo(page);
    await inspectorTab(page, "Facts").click();
    await page.getByRole("button", { name: "Add observation", exact: true }).click();
    const observationInput = page.getByRole("textbox", { name: "Observation", exact: true });
    const addForm = page.locator("form").filter({ has: observationInput });
    await observationInput.fill(statement);
    await addForm.getByRole("button", { name: "Add observation", exact: true }).click();

    const observation = claimRow(page, statement);
    const undo = page.getByRole("button", { name: "Undo", exact: true });
    const redo = page.getByRole("button", { name: "Redo", exact: true });
    await expect(observation).toHaveCount(1);
    await expect(observation).toContainText("Reported · human statement");
    await expect(undo).toBeEnabled();
    await expect(redo).toBeDisabled();

    await undo.click();
    await expect(observation).toHaveCount(0);
    await expect(page.getByLabel("Case activity")).toContainText("Undid: Added an observation.");
    await expect(redo).toBeEnabled();

    await redo.click();
    await expect(observation).toHaveCount(1);
    await expect(observation).toContainText("Reported · human statement");
    await expect(page.getByLabel("Case activity")).toContainText("Redid: Added an observation.");
    await expect(redo).toBeDisabled();

    await observation.click();
    await expect(page.getByLabel("Selected observation").getByLabel("Classification")).toHaveValue(
      "reported",
    );
  });
});
