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
      .getByRole("tablist", { name: "Case workspaces" })
      .getByRole("tab", { name: /^Questions/ })
      .click();

    const questionCard = page.getByRole("article").filter({
      has: page.getByRole("heading", { name: question, exact: true }),
    });
    const relatedItems = questionCard.getByLabel("Related case items");
    await expect(relatedItems.getByRole("button", { name: "Path · Vehicle A" })).toBeVisible();
    await expect(relatedItems.getByRole("button", { name: "Path · Vehicle B" })).toBeVisible();
    await expect(relatedItems.getByRole("button", { name: "Hypothesis · Baseline" })).toBeVisible();
    const relatedObservation = relatedItems.getByRole("button", {
      name: /Observation · The exact lane positions immediately before contact are unknown/,
    });
    await expect(relatedObservation).toHaveAttribute(
      "title",
      "Observation · The exact lane positions immediately before contact are unknown.",
    );
    await expect(relatedObservation).not.toHaveAttribute("title", "claim-lane-positions");
    const relationOverflow = await relatedItems.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(relationOverflow.scrollWidth).toBeLessThanOrEqual(relationOverflow.clientWidth);
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

  test("removes a mistaken evidence relationship without deleting the local image", async ({
    page,
  }) => {
    const sourceStatement = "The road surface was wet after light rain.";

    await openDemo(page);
    await inspectorTab(page, "Evidence").click();
    await page.getByRole("button", { name: /^Wet road markings.*Demo$/ }).click();
    const evidenceDetail = page.locator("section.evidence-detail");
    const removeSource = evidenceDetail.getByRole("button", {
      name: new RegExp(`Remove cited source link to Observation · ${sourceStatement}`),
    });
    await expect(removeSource).toBeVisible();
    await removeSource.click();

    await expect(page.locator(".workspace-case-title small")).toHaveText("v2");
    await expect(removeSource).toHaveCount(0);
    await expect(evidenceDetail.getByText("Wet road markings", { exact: false })).toBeVisible();
    await expect(page.locator(".save-status")).toContainText("Saved locally");

    await inspectorTab(page, "Facts").click();
    const observation = claimRow(page, sourceStatement);
    await expect(observation).toContainText("Reported · photo");

    await page.reload();
    await inspectorTab(page, "Evidence").click();
    await page.getByRole("button", { name: /^Wet road markings.*Demo$/ }).click();
    await expect(
      page.locator("section.evidence-detail").getByRole("button", {
        name: new RegExp(`Remove cited source link to Observation · ${sourceStatement}`),
      }),
    ).toHaveCount(0);
  });

  test("requires and preserves a cited image for photo and document observations", async ({
    page,
  }) => {
    const statement = "The overview image shows both vehicles near the roundabout exit.";

    await openDemo(page);
    await inspectorTab(page, "Facts").click();
    await page.getByRole("button", { name: "Add observation", exact: true }).click();
    const observationInput = page.getByRole("textbox", { name: "Observation", exact: true });
    const addForm = page.locator("form").filter({ has: observationInput });
    await observationInput.fill(statement);
    await addForm.getByLabel("Source").selectOption("photo");
    await expect(
      addForm.getByRole("button", { name: "Add observation", exact: true }),
    ).toBeDisabled();
    await addForm.getByLabel("Cited photo").selectOption({ index: 1 });
    await addForm.getByRole("button", { name: "Add observation", exact: true }).click();

    const observation = claimRow(page, statement);
    await expect(observation).toContainText("Reported · photo");
    await observation.click();
    const detail = page.getByLabel("Selected observation");
    await expect(detail.getByText("Cited sources")).toBeVisible();
    await expect(detail.getByRole("button", { name: /^Evidence ·/ })).toHaveCount(1);
    await expect(detail.getByRole("button", { name: "Confirm as human-reviewed" })).toBeEnabled();
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
