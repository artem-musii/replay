import { expect, test } from "@playwright/test";

import {
  inspectorTab,
  installModelContextPolyfill,
  openDemo,
  openLanding,
  openWebMCPInspector,
  waitForLocalSave,
} from "./helpers";

test.describe("REPLAY primary journey", () => {
  test("landing presents the deterministic demo and local-first contract", async ({ page }) => {
    await openLanding(page);

    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open a clean demo" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Start a blank case" })).toBeEnabled();
    await expect(page.getByText("Local-first", { exact: true })).toBeVisible();
    await expect(page.getByText("No account", { exact: true })).toBeVisible();
    await expect(page.getByText("Human-approved reports", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Local by default, explicit when shared." }),
    ).toBeVisible();
  });

  test("opens the byte-stable roundabout demo with scene, time, and provenance", async ({
    page,
  }) => {
    await openDemo(page);

    await expect(page.locator(".workspace-case-title")).toContainText("Demo run");
    await expect(page.locator(".workspace-case-title")).toContainText("v1");
    await expect(page.getByLabel("Incident scene editor")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Vehicle A, position/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Vehicle B, position/ })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Approximate impact at 10\.0 seconds/ }),
    ).toBeVisible();
    await expect(page.getByLabel("Incident timeline")).toBeVisible();
    await expect(page.getByLabel("Case inspector")).toBeVisible();
    await expect(page.getByLabel("Case activity")).toBeVisible();

    await inspectorTab(page, "Facts").click();
    await expect(page.getByText("4 confirmed", { exact: true })).toBeVisible();
    await expect(page.getByText("5 unresolved", { exact: true })).toBeVisible();
  });

  test("impact focus exposes boundary contact and playback pauses for geometry review", async ({
    page,
  }) => {
    await openDemo(page);

    const vehicleA = page.getByRole("button", { name: /^Vehicle A, position/ });
    const scrubber = page.getByRole("slider", { name: "Timeline position" });
    const output = page.getByLabel("Current timeline position");
    const contactReadout = page.locator(".scene-contact-readout");
    const initialTransform = await vehicleA.getAttribute("transform");

    await expect(contactReadout).toHaveAttribute("data-contact-state", "clear");
    await expect(contactReadout).toContainText("Vehicle footprints clear");

    await page.getByRole("button", { name: /Approximate impact at 10\.0 seconds/ }).click();
    await expect(scrubber).toHaveValue("10000");
    await expect(output).toContainText("0:10.0");
    await expect(vehicleA).not.toHaveAttribute("transform", initialTransform ?? "");
    const impactTransform = await vehicleA.getAttribute("transform");
    await expect(contactReadout).toHaveAttribute("data-contact-state", "recorded");
    await expect(contactReadout).toContainText("Impact event geometry · footprints meet");
    await expect(contactReadout).toContainText("event status: uncertain");
    await expect(contactReadout).toContainText("modeled penetration 0.00 m");

    const timeline = page.getByLabel("Incident timeline");
    await timeline.getByRole("button", { name: "Go to start", exact: true }).click();
    await expect(output).toContainText("0:00.0");
    await expect(vehicleA).toHaveAttribute("transform", initialTransform ?? "");
    await expect(contactReadout).toHaveAttribute("data-contact-state", "clear");

    await scrubber.fill("9500");
    await page.getByLabel("Playback speed").selectOption("2");
    await timeline.getByRole("button", { name: "Play reconstruction", exact: true }).click();
    await expect(
      timeline.getByRole("button", { name: "Pause reconstruction", exact: true }),
    ).toBeVisible();
    await expect.poll(async () => Number(await scrubber.inputValue())).toBe(10_000);
    await expect(
      timeline.getByRole("button", { name: "Play reconstruction", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".toast")).toContainText(
      "Paused at the impact event for geometry review.",
    );
    await expect(contactReadout).toHaveAttribute("data-contact-state", "recorded");

    await timeline.getByRole("button", { name: "Play reconstruction", exact: true }).click();
    await expect.poll(async () => Number(await scrubber.inputValue())).toBeGreaterThan(10_000);
    await timeline.getByRole("button", { name: "Pause reconstruction", exact: true }).click();
    await expect(vehicleA).not.toHaveAttribute("transform", impactTransform ?? "");
  });

  test("only an explicit human UI action confirms an eligible observation", async ({ page }) => {
    await openDemo(page);
    await inspectorTab(page, "Facts").click();

    await page
      .getByRole("button", {
        name: /Vehicle A was leaving the roundabout when Vehicle B made contact/,
      })
      .click();
    const confirm = page.getByRole("button", { name: "Confirm as human-reviewed" });
    await expect(confirm).toBeVisible();
    await confirm.click();

    await expect(page.getByText("5 confirmed", { exact: true })).toBeVisible();
    await expect(page.getByText("4 unresolved", { exact: true })).toBeVisible();
    await expect(page.getByText("This status came from an explicit human action.")).toBeVisible();
    await expect(page.locator(".activity-list")).toContainText(
      /Human confirmed: Vehicle A was leaving the roundabout/,
    );
  });

  test("an agent hypothesis remains visibly distinct and cannot expose a confirm action", async ({
    page,
  }) => {
    await installModelContextPolyfill(page);
    await openDemo(page);

    const siteToolsButton = page.locator("button.webmcp-status");
    await expect(siteToolsButton).toContainText(/\d+ registered/, { timeout: 10_000 });
    const { dialog } = await openWebMCPInspector(page);
    await expect(dialog.getByText("Browser Site Tools available")).toBeVisible();
    await dialog.locator(".debug-tool-list button").filter({ hasText: "add_observation" }).click();
    await dialog.getByLabel("Simulation input").fill(
      JSON.stringify(
        {
          statement: "Vehicle B may have moved outward before contact.",
          sourceType: "agent-inference",
          linkedIds: [],
          status: "agent-hypothesis",
          sharedAcrossBranches: true,
          expectedVersion: 1,
          requestId: "e2e-agent-observation-001",
        },
        null,
        2,
      ),
    );
    await dialog.getByRole("button", { name: "Run through browser" }).click();
    await expect(dialog.locator(".debug-result")).toContainText('"ok": true');
    await dialog.getByRole("button", { name: "Close WebMCP inspector" }).click();

    await inspectorTab(page, "Facts").click();
    await page
      .getByRole("button", { name: /Vehicle B may have moved outward before contact/ })
      .click();
    const detail = page.getByLabel("Selected observation");
    await expect(detail.locator(".status-pill")).toHaveText("Agent hypothesis");
    await expect(detail.getByText("agent", { exact: true })).toBeVisible();
    await expect(detail.getByRole("button", { name: "Confirm as human-reviewed" })).toHaveCount(0);
  });

  test("the evidence tray uses all four generated demo assets with explicit provenance", async ({
    page,
  }) => {
    await openDemo(page);
    await inspectorTab(page, "Evidence").click();

    const tray = page.getByRole("list", { name: "Evidence images" });
    await expect(tray.getByRole("listitem")).toHaveCount(4);
    const sources = await tray
      .locator("img")
      .evaluateAll((images) =>
        images.map((image) => new URL((image as HTMLImageElement).src).pathname).sort(),
      );
    expect(sources).toEqual(
      [
        "/assets/generated/demo-road-condition.webp",
        "/assets/generated/demo-roundabout-wide-v2.webp",
        "/assets/generated/demo-vehicle-a-damage-v2.webp",
        "/assets/generated/demo-vehicle-b-damage-v2.webp",
      ].sort(),
    );
    await expect(page.getByText("Synthetic demo", { exact: true })).toBeVisible();
    await expect(
      page.getByText(/not a calibrated scene photograph and is not registered/),
    ).toBeVisible();
    await expect(
      page.getByRole("img", { name: /Preview of Roundabout incident overview/ }),
    ).toBeVisible();
  });

  test("adds and removes point and rectangle evidence annotations", async ({ page }) => {
    await openDemo(page);
    await inspectorTab(page, "Evidence").click();

    const annotationTools = page.getByLabel("Evidence annotation tools");
    await expect(annotationTools.getByText("0 marked", { exact: true })).toBeVisible();

    await annotationTools.getByRole("button", { name: "Point", exact: true }).click();
    const pointPreview = page.getByLabel("Click the image to add a point annotation");
    await pointPreview.click({ position: { x: 80, y: 80 } });

    const annotations = page.getByRole("list", { name: "Evidence annotations" });
    await expect(annotations).toContainText("Point 1");
    await expect(annotationTools.getByText("1 marked", { exact: true })).toBeVisible();
    await expect(page.locator(".evidence-annotation--point")).toHaveCount(1);

    await annotationTools.getByRole("button", { name: "Rectangle", exact: true }).click();
    const rectanglePreview = page.getByLabel("Click the image to add a rectangle annotation");
    await rectanglePreview.click({ position: { x: 160, y: 100 } });

    await expect(annotations).toContainText("Area 2");
    await expect(annotationTools.getByText("2 marked", { exact: true })).toBeVisible();
    await expect(page.locator(".evidence-annotation--rectangle")).toHaveCount(1);

    await annotations.getByRole("button", { name: "Remove Point 1" }).click();
    await expect(annotationTools.getByText("1 marked", { exact: true })).toBeVisible();
    await expect(page.locator(".evidence-annotation--point")).toHaveCount(0);
    await expect(annotations).toContainText("Area 2");
  });

  test("forks an alternative hypothesis and compares it without presenting a conclusion", async ({
    page,
  }) => {
    await openDemo(page);
    await inspectorTab(page, "Hypotheses").click();
    await page.getByRole("button", { name: "Fork hypothesis" }).click();

    await page.getByLabel("Branch name").fill("Outer-lane alternative");
    await page
      .getByLabel("What changes")
      .fill("Vehicle B follows an outward path while the shared observations remain unchanged.");
    await page.getByRole("button", { name: "Fork reconstruction" }).click();

    await expect(page.getByRole("heading", { name: "Outer-lane alternative" })).toBeVisible();
    let alternative = page.locator(".branch-item").filter({ hasText: "Outer-lane alternative" });
    await alternative.getByRole("button", { name: "Edit branch" }).click();
    const branchEditor = page.getByRole("form", { name: "Edit Outer-lane alternative" });
    await branchEditor.getByLabel("Branch name").fill("Outer-lane path");
    await branchEditor
      .getByLabel("Description")
      .fill("Vehicle B follows an outward path while shared observations remain unchanged.");
    await branchEditor.getByRole("button", { name: "Save branch" }).click();

    alternative = page.locator(".branch-item").filter({ hasText: "Outer-lane path" });
    await alternative.getByRole("button", { name: "Assumption" }).click();
    await alternative
      .getByLabel("Alternative assumption")
      .fill("Vehicle B may have remained in the outer lane before contact.");
    await alternative.getByRole("button", { name: "Save assumption" }).click();
    const assumption = alternative.locator(".assumption").last();
    await expect(assumption).toContainText("Vehicle B may have remained");
    await assumption.getByRole("button", { name: "Edit" }).click();
    await assumption
      .getByLabel("Assumption statement")
      .fill("Vehicle B may have followed the outer lane before contact.");
    await assumption.getByRole("button", { name: "Save assumption" }).click();
    await assumption.getByRole("button", { name: "Withdraw" }).click();
    await expect(assumption).toHaveClass(/is-withdrawn/);
    await assumption.getByRole("button", { name: "Restore" }).click();
    await expect(assumption).not.toHaveClass(/is-withdrawn/);

    await expect(page.getByText("Branches are alternatives, not conclusions.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Compare paths" })).toBeVisible();
    await page.getByRole("button", { name: "Compare side by side" }).click();

    await expect(page.locator(".comparison-banner")).toContainText(
      "Alternative paths are visual comparisons, not conclusions.",
    );
    await expect(page.locator(".timeline__comparison")).toContainText("Comparing");
    await expect(page.getByRole("button", { name: "Stop comparison" })).toBeVisible();
  });

  test("report finalization requires visible review and a second manual confirmation", async ({
    page,
  }) => {
    await openDemo(page);
    await inspectorTab(page, "Report").click();

    const toolForm = page.locator("form.finalize-tool-form");
    await expect(toolForm).toHaveAttribute("toolname", "finalize_factual_report");
    await expect(toolForm).not.toHaveAttribute("toolautosubmit", /.*/);
    const reviewButton = toolForm.getByRole("button", { name: "Review and finalize" });
    await expect(reviewButton).toBeDisabled();
    await page.getByRole("button", { name: "Build report preview" }).click();
    await expect(
      page.locator(".report-preview").getByRole("heading", {
        name: "Roundabout incident — 17:42",
      }),
    ).toBeVisible();
    await expect(reviewButton).toBeEnabled();
    await reviewButton.click();

    const reviewDialog = page.getByRole("dialog", { name: "Review before finalizing" });
    await expect(
      reviewDialog.getByText("The agent can prepare this screen but cannot complete it."),
    ).toBeVisible();
    const continueButton = reviewDialog.getByRole("button", { name: "Continue to confirmation" });
    await expect(continueButton).toBeDisabled();

    await reviewDialog.getByLabel("I reviewed unresolved questions.").check();
    await reviewDialog.getByLabel("I acknowledge the method and limitations.").check();
    await expect(continueButton).toBeDisabled();
    await reviewDialog.getByLabel("I reviewed every confirmed fact.").check();
    await expect(continueButton).toBeEnabled();
    await continueButton.click();

    const confirmation = page.getByRole("alertdialog", {
      name: "Create an immutable report snapshot?",
    });
    await expect(
      confirmation.getByRole("button", { name: "Finalize factual report" }),
    ).toBeVisible();
    await expect(confirmation).toContainText(
      "You can continue editing later without changing this snapshot.",
    );
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });

  test("blank-case wizard records optional context as reported rather than confirmed", async ({
    page,
  }) => {
    await openLanding(page);
    await page.getByRole("button", { name: "Start a blank case" }).click();

    await expect(page.getByRole("heading", { name: "Name the account." })).toBeVisible();
    await page.getByLabel("Case title").fill("Evening intersection account");
    await page.getByLabel(/Incident date/).fill("2026-08-26");
    await page.getByLabel(/Approximate time/).fill("19:05");
    await page.getByRole("button", { name: "Continue" }).click();

    await page.locator("label.choice-tile").filter({ hasText: "Intersection" }).click();
    await expect(page.getByLabel(/Intersection/)).toBeChecked();
    await page.getByLabel(/Road condition/).selectOption("wet");
    await page.getByLabel("Vehicles").selectOption("3");
    await page.getByRole("button", { name: "Continue" }).click();

    await page
      .getByLabel(/Initial factual statement/)
      .fill("Vehicle A and Vehicle B were present; the exact movement is not yet established.");
    await page.getByRole("button", { name: "Create local case" }).click();

    await expect(page.locator(".workspace-case-title")).toContainText("Local case");
    await expect(page.getByText("Evening intersection account", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Vehicle C, position/ })).toBeVisible();
    await inspectorTab(page, "Facts").click();
    await expect(page.getByText("0 confirmed", { exact: true })).toBeVisible();
    await expect(page.getByText("1 unresolved", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /exact movement is not yet established.*Reported/ }),
    ).toBeVisible();
  });

  test("authors paths, events, impact, and damage in a blank reconstruction", async ({ page }) => {
    await openLanding(page);
    await page.getByRole("button", { name: "Start a blank case" }).click();
    await page.getByLabel("Case title").fill("Authoring controls account");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Create local case" }).click();

    const vehicleA = page.getByRole("button", { name: /^Vehicle A, position/ });
    await vehicleA.click();
    await page.getByRole("button", { name: "Create path", exact: true }).click();
    await expect(page.getByRole("button", { name: "Lock path", exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Vehicle A path keyframe at 0:00.0" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Vehicle A path keyframe at 0:04.0" }),
    ).toBeVisible();

    const firstKeyframe = page.getByRole("button", {
      name: "Vehicle A path keyframe at 0:00.0",
    });
    await page.getByRole("button", { name: "Lock path", exact: true }).click();
    await expect(page.getByRole("button", { name: "Unlock path", exact: true })).toBeVisible();
    await expect(firstKeyframe).not.toHaveClass(/is-editable/);
    await firstKeyframe.press("ArrowRight");
    await expect(firstKeyframe).toBeVisible();

    await page.getByRole("button", { name: "Unlock path", exact: true }).click();
    await expect(firstKeyframe).toHaveClass(/is-editable/);
    await firstKeyframe.press("ArrowRight");
    await expect(
      page.getByRole("button", { name: "Vehicle A path keyframe at 0:00.1" }),
    ).toBeVisible();

    await vehicleA.click();
    await page.getByRole("button", { name: "Lock object", exact: true }).click();
    await expect(vehicleA).toHaveAccessibleName(/Vehicle A.*locked/);
    const lockedVehicleTransform = (await vehicleA.getAttribute("transform")) ?? "";
    await vehicleA.press("ArrowRight");
    await expect(vehicleA).toHaveAttribute("transform", lockedVehicleTransform);
    await page.getByRole("button", { name: "Unlock object", exact: true }).click();

    const scrubber = page.getByRole("slider", { name: "Timeline position" });
    await scrubber.fill("5000");
    await page.getByRole("button", { name: "Add timeline event" }).click();
    const eventEditor = page.getByRole("dialog", { name: "Add timeline event" });
    await eventEditor.getByLabel("Event title").fill("Vehicle positions documented");
    await eventEditor.getByLabel("Event type").selectOption("observation");
    await eventEditor.getByLabel("Certainty").selectOption("reported");
    await eventEditor.getByLabel("Linked actor").selectOption({ label: "Vehicle A" });
    await eventEditor.getByRole("button", { name: "Add at 0:05.0" }).click();

    const authoredEvent = page.getByRole("button", {
      name: "Vehicle positions documented at 0:05.0. reported.",
    });
    await expect(authoredEvent).toBeVisible();
    await authoredEvent.click();
    await page.getByRole("button", { name: "Lock event", exact: true }).click();
    await expect(page.getByRole("button", { name: "Unlock event", exact: true })).toBeVisible();
    await authoredEvent.press("ArrowRight");
    await expect(authoredEvent).toBeVisible();
    await page.getByRole("button", { name: "Unlock event", exact: true }).click();

    await page
      .getByLabel("Incident scene editor")
      .getByRole("button", { name: /Mark impact|Place the approximate impact/ })
      .click();
    await expect(page.getByText(/Click the scene or enter exact coordinates/)).toBeVisible();
    const scene = page.getByRole("application", { name: /Editable road scene/ });
    const sceneBounds = await scene.boundingBox();
    if (!sceneBounds) throw new Error("Scene is not measurable");
    await page.mouse.click(
      sceneBounds.x + sceneBounds.width * 0.72,
      sceneBounds.y + sceneBounds.height * 0.5,
    );
    const impact = page.getByRole("button", {
      name: "Approximate impact at 5.0 seconds, uncertain",
    });
    await expect(impact).toBeVisible();
    await impact.press("Enter");
    await page.getByRole("button", { name: "Lock event", exact: true }).click();
    await expect(page.getByRole("button", { name: "Unlock event", exact: true })).toBeVisible();

    await vehicleA.click();
    await page.getByRole("button", { name: "Mark damage", exact: true }).click();
    await page.getByLabel("Body region").selectOption("front-left");
    await page.getByLabel("Neutral description").fill("Light scrape at front-left bumper");
    await page.getByRole("button", { name: "Add marker", exact: true }).click();
    await expect(vehicleA.locator(".damage-glyph")).toHaveCount(1);
    await expect(page.locator(".activity-list")).toContainText(
      "Marked front-left damage on Vehicle A.",
    );
  });

  test("persists human changes and restores the most recent local case after reload", async ({
    page,
  }) => {
    await openLanding(page);
    await page.getByRole("button", { name: "Start a blank case" }).click();
    await page.getByLabel("Case title").fill("Persistent local account");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page
      .getByLabel(/Initial factual statement/)
      .fill("Vehicle A was stopped after the incident.");
    await page.getByRole("button", { name: "Create local case" }).click();
    await inspectorTab(page, "Facts").click();
    await page.getByRole("button", { name: /Vehicle A was stopped after the incident/ }).click();
    await page.getByRole("button", { name: "Confirm as human-reviewed" }).click();
    await waitForLocalSave(page);

    await page.reload();
    await expect(page.locator("main.workspace")).toBeVisible();
    await expect(page.getByText("Persistent local account", { exact: true })).toBeVisible();
    await expect(page.getByText("1 confirmed", { exact: true })).toBeVisible();
    await expect(page.getByText("This status came from an explicit human action.")).toBeVisible();
  });

  test("normal browsers retain the complete manual workspace when WebMCP is unavailable", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(document, "modelContext", { value: undefined, configurable: true });
    });
    await openLanding(page);
    await expect(page.getByText("Manual mode ready", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Open a clean demo" }).click();
    await expect(page.locator("main.workspace")).toBeVisible();
    const siteToolsButton = page.locator("button.webmcp-status");
    await expect(siteToolsButton).toContainText("Manual mode");
    await expect(siteToolsButton).toHaveAccessibleName("Site Tools Manual mode");
    await siteToolsButton.click();
    const dialog = page.getByRole("dialog", { name: "Learn REPLAY" });
    await expect(dialog.getByText("Manual mode is active")).toBeVisible();
    await expect(dialog.getByText(/Every visible case workflow remains available/)).toBeVisible();
    await dialog.getByRole("button", { name: "Close REPLAY guide" }).click();

    await inspectorTab(page, "Evidence").click();
    await expect(page.getByRole("list", { name: "Evidence images" })).toBeVisible();
  });
});
