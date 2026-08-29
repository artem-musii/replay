import { expect, test, type Locator, type Page } from "@playwright/test";

import { inspectorTab, openDemo } from "./helpers";

async function openDetails(details: Locator): Promise<void> {
  if ((await details.getAttribute("open")) === null) {
    await details.locator("summary").click();
  }
}

async function selectVehicle(page: Page, label: "A" | "B"): Promise<void> {
  const target = page.getByRole("button", { name: new RegExp(`^Vehicle ${label}, position`) });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if ((await target.getAttribute("aria-pressed")) === "true") return;
    await page.getByRole("button", { name: /Select next vehicle\./ }).click();
  }
  throw new Error(`Could not select Vehicle ${label} through the overlap-safe picker.`);
}

test.describe("editor target and draft invariants", () => {
  test("keeps scene edits bound to canonical actors and a paused playhead", async ({ page }) => {
    await openDemo(page);
    await selectVehicle(page, "A");

    const actorEditor = page.locator(".scene-selection-editor");
    const specifications = actorEditor.locator("details.vehicle-spec-editor");
    await openDetails(specifications);
    await expect(specifications.getByLabel("Length m")).toHaveValue("4.31");
    await specifications.getByLabel("Length m").fill("9.99");

    await selectVehicle(page, "B");
    await openDetails(specifications);
    await expect(specifications.getByLabel("Length m")).toHaveValue("4.22");
    await specifications.getByLabel("Length m").fill("5.5");
    await specifications.getByRole("button", { name: "Apply vehicle specification" }).click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(specifications.getByLabel("Length m")).toHaveValue("4.22");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(specifications.getByLabel("Length m")).toHaveValue("5.5");

    await page.getByRole("button", { name: "Play reconstruction", exact: true }).click();
    const exactX = actorEditor.getByLabel("X position");
    await exactX.focus();
    await exactX.fill("40");
    await page.waitForTimeout(250);
    await expect(
      page.getByRole("button", { name: "Play reconstruction", exact: true }),
    ).toBeVisible();
    await expect(exactX).toHaveValue("40");
    await expect(exactX).toBeFocused();

    await selectVehicle(page, "A");
    await page.getByRole("button", { name: "Mark damage", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Neutral description" })
      .fill("Context-bound audit marker");
    await selectVehicle(page, "B");
    await expect(page.getByText("Mark damage on Vehicle A", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add marker", exact: true }).click();
    await expect(page.getByLabel("Case activity")).toContainText(
      "Marked unknown damage on Vehicle A.",
    );

    await page.getByRole("button", { name: "Play reconstruction", exact: true }).click();
    await page.waitForTimeout(120);
    await page
      .getByLabel("Incident scene editor")
      .getByRole("button", { name: "Mark impact", exact: true })
      .click();
    const capturedTime = await page.getByRole("slider", { name: "Timeline position" }).inputValue();
    await page.waitForTimeout(250);
    await expect(page.getByRole("slider", { name: "Timeline position" })).toHaveValue(capturedTime);
    await expect(
      page.getByRole("button", { name: "Play reconstruction", exact: true }),
    ).toBeVisible();
  });

  test("discards canceled drafts and closes stale question answers after Redo", async ({
    page,
  }) => {
    await openDemo(page);

    await inspectorTab(page, "Facts").click();
    await page.getByRole("button", { name: "Add observation", exact: true }).click();
    await page.getByRole("textbox", { name: "Observation", exact: true }).fill("Canceled fact");
    await page.getByRole("combobox", { name: "Status" }).selectOption("uncertain");
    await page.getByRole("combobox", { name: "Source" }).selectOption("photo");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Add observation", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Observation", exact: true })).toHaveValue("");
    await expect(page.getByRole("combobox", { name: "Status" })).toHaveValue("reported");
    await expect(page.getByRole("combobox", { name: "Source" })).toHaveValue("human-statement");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();

    await inspectorTab(page, "Questions").click();
    await page.getByRole("button", { name: "Add question", exact: true }).click();
    await page.getByRole("textbox", { name: "Question", exact: true }).fill("Canceled question?");
    await page.getByRole("textbox", { name: "Why it matters" }).fill("Canceled reason");
    await page.getByRole("combobox", { name: "Importance" }).selectOption("low");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Add question", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Question", exact: true })).toHaveValue("");
    await expect(page.getByRole("textbox", { name: "Why it matters" })).toHaveValue("");
    await expect(page.getByRole("combobox", { name: "Importance" })).toHaveValue("high");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();

    const question = page.locator("article.question-item").first();
    await question.getByRole("button", { name: "Answer", exact: true }).click();
    await question.getByRole("textbox", { name: "Answer", exact: true }).fill("Committed answer");
    await question.getByRole("button", { name: "Save answer" }).click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await question.getByRole("button", { name: "Answer", exact: true }).click();
    await question.getByRole("textbox", { name: "Answer", exact: true }).fill("Unsaved overwrite");
    await question.getByLabel("Also create a reported observation").check();
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(question.getByRole("textbox", { name: "Answer", exact: true })).toHaveCount(0);
    await expect(question).toContainText("Committed answer");

    await page.getByRole("button", { name: "Add timeline event" }).click();
    const eventDialog = page.getByRole("dialog", { name: "Add timeline event" });
    await eventDialog.getByRole("textbox", { name: "Event title" }).fill("Canceled event");
    await eventDialog.getByRole("combobox", { name: "Event type" }).selectOption("maneuver");
    await eventDialog.getByRole("combobox", { name: "Certainty" }).selectOption("disputed");
    await eventDialog.getByRole("combobox", { name: "Linked actor" }).selectOption({
      label: "Vehicle B",
    });
    await eventDialog.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Add timeline event" }).click();
    await expect(eventDialog.getByRole("textbox", { name: "Event title" })).toHaveValue("");
    await expect(eventDialog.getByRole("combobox", { name: "Event type" })).toHaveValue(
      "observation",
    );
    await expect(eventDialog.getByRole("combobox", { name: "Certainty" })).toHaveValue("reported");
    await expect(eventDialog.getByRole("combobox", { name: "Linked actor" })).toHaveValue("all");
  });

  test("rehydrates evidence metadata after Undo without shifting the captured instant", async ({
    page,
  }) => {
    await openDemo(page);
    await inspectorTab(page, "Evidence").click();
    const detail = page.locator("section.evidence-detail");
    const captured = detail.locator(".provenance-grid > div").filter({ hasText: "Captured" });
    const capturedBefore = await captured.locator("dd").textContent();

    await detail.getByRole("button", { name: /Edit capture time, notes and tags/ }).click();
    const notes = detail.getByRole("textbox", { name: "Notes" });
    const notesBefore = await notes.inputValue();
    await notes.fill("Temporary metadata edit");
    await detail.getByRole("button", { name: "Save evidence details" }).click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await detail.getByRole("button", { name: /Edit capture time, notes and tags/ }).click();

    await expect(detail.getByRole("textbox", { name: "Notes" })).toHaveValue(notesBefore);
    await expect(captured.locator("dd")).toHaveText(capturedBefore ?? "");
  });

  test("drops archived branches from every comparison surface without resuming on Undo", async ({
    page,
  }) => {
    await openDemo(page);
    await inspectorTab(page, "Hypotheses").click();

    const fork = async (name: string) => {
      await page.getByRole("button", { name: "Fork hypothesis" }).click();
      await page.getByRole("textbox", { name: "Branch name" }).fill(name);
      await page.getByRole("button", { name: "Fork reconstruction" }).click();
    };
    await fork("Fork one");
    await page
      .locator("article.branch-item")
      .filter({ has: page.getByRole("heading", { name: "Baseline reconstruction" }) })
      .getByRole("button", { name: "View branch" })
      .click();
    await fork("Fork two");

    await page.getByRole("button", { name: "Compare side by side" }).click();
    await expect(page.locator(".comparison-banner")).toContainText("Fork one");
    const forkOne = page
      .locator("article.branch-item")
      .filter({ has: page.getByRole("heading", { name: "Fork one", exact: true }) });
    await forkOne.getByRole("button", { name: "Archive" }).click();

    await expect(page.locator(".comparison-banner")).toHaveCount(0);
    await expect(page.locator(".timeline__comparison")).toHaveCount(0);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.locator(".comparison-banner")).toHaveCount(0);
    await expect(page.locator(".timeline__comparison")).toHaveCount(0);
  });
});
