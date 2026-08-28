import { expect, test } from "@playwright/test";

import { inspectorTab, openDemo, openWebMCPInspector } from "./helpers";

test.describe("Dialog keyboard accessibility", () => {
  test("timeline, guide, and WebMCP dialogs trap focus and restore their invokers", async ({
    page,
  }) => {
    await openDemo(page);

    const addEvent = page.getByRole("button", { name: "Add timeline event" });
    await addEvent.focus();
    await page.keyboard.press("Enter");
    const eventDialog = page.getByRole("dialog", { name: "Add timeline event" });
    const eventTitle = eventDialog.getByRole("textbox", { name: "Event title" });
    const closeEvent = eventDialog.getByRole("button", { name: "Close event editor" });
    const submitEvent = eventDialog.getByRole("button", { name: "Add at 0:00.0" });
    await expect(eventTitle).toBeFocused();

    await closeEvent.focus();
    await closeEvent.press("Shift+Tab");
    await expect(submitEvent).toBeFocused();
    await submitEvent.press("Tab");
    await expect(closeEvent).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(eventDialog).toHaveCount(0);
    await expect(addEvent).toBeFocused();

    const siteTools = page.locator("button.webmcp-status");
    await siteTools.focus();
    await page.keyboard.press("Enter");
    const guideDialog = page.getByRole("dialog", { name: "Learn REPLAY" });
    const closeGuide = guideDialog.getByRole("button", { name: "Close REPLAY guide" });
    const lastGuideButton = guideDialog.getByRole("button").last();
    await expect(closeGuide).toBeFocused();
    await closeGuide.press("Shift+Tab");
    await expect(lastGuideButton).toBeFocused();
    await lastGuideButton.press("Tab");
    await expect(closeGuide).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(guideDialog).toHaveCount(0);
    await expect(siteTools).toBeFocused();

    const { dialog: webMcpDialog, invoker } = await openWebMCPInspector(page);
    const closeWebMcp = webMcpDialog.getByRole("button", { name: "Close WebMCP inspector" });
    const copyInput = webMcpDialog.getByRole("button", { name: "Copy input" });
    await expect(closeWebMcp).toBeFocused();
    await closeWebMcp.press("Shift+Tab");
    await expect(copyInput).toBeFocused();
    await copyInput.press("Tab");
    await expect(closeWebMcp).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(webMcpDialog).toHaveCount(0);
    await expect(invoker).toBeFocused();
  });

  test("evidence deletion defaults to cancel and Escape returns to the delete control", async ({
    page,
  }) => {
    await openDemo(page);
    await inspectorTab(page, "Evidence").click();

    const deleteEvidence = page.getByRole("button", { name: "Delete local evidence" });
    await deleteEvidence.click();
    const confirmation = page.getByRole("alertdialog", { name: "Delete this evidence?" });
    const cancel = confirmation.getByRole("button", { name: "Cancel" });
    const confirm = confirmation.getByRole("button", { name: "Delete evidence" });
    await expect(cancel).toBeFocused();

    await cancel.press("Shift+Tab");
    await expect(confirm).toBeFocused();
    await confirm.press("Tab");
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    await expect(deleteEvidence).toBeFocused();
  });

  test("report review preserves the deliberate second confirmation and restores focus", async ({
    page,
  }) => {
    await openDemo(page);
    await inspectorTab(page, "Report").click();
    await page.getByRole("button", { name: "Build report preview" }).click();

    const reviewButton = page.getByRole("button", { name: "Review and finalize" });
    await reviewButton.click();
    let reviewDialog = page.getByRole("dialog", { name: "Review before finalizing" });
    const unresolved = reviewDialog.getByLabel("I reviewed unresolved questions.");
    await expect(unresolved).toBeFocused();

    await unresolved.check();
    await reviewDialog.getByLabel("I acknowledge the method and limitations.").check();
    await reviewDialog.getByLabel("I reviewed every confirmed fact.").check();
    await reviewDialog.getByRole("button", { name: "Continue to confirmation" }).click();

    const confirmation = page.getByRole("alertdialog", {
      name: "Create an immutable report snapshot?",
    });
    const cancelConfirmation = confirmation.getByRole("button", { name: "Cancel" });
    const finalize = confirmation.getByRole("button", { name: "Finalize factual report" });
    await expect(cancelConfirmation).toBeFocused();
    await cancelConfirmation.press("Shift+Tab");
    await expect(finalize).toBeFocused();
    await page.keyboard.press("Escape");

    await expect(confirmation).toHaveCount(0);
    reviewDialog = page.getByRole("dialog", { name: "Review before finalizing" });
    await expect(reviewDialog).toBeVisible();
    await expect(reviewDialog.getByLabel("I reviewed unresolved questions.")).toBeChecked();
    await expect(reviewDialog.getByLabel("I reviewed unresolved questions.")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(reviewDialog).toHaveCount(0);
    await expect(reviewButton).toBeFocused();
  });
});
