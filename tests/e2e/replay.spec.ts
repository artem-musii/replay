import { expect, test } from "@playwright/test";

import {
  currentDemoRunId,
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
    await expect(page.getByRole("button", { name: "Open Roundabout demo" })).toBeEnabled();
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
    await expect(page.getByText("6 unresolved", { exact: true })).toBeVisible();
  });

  test("switches deterministic demo scenarios without overwriting the current run", async ({
    page,
  }) => {
    await openDemo(page);
    await waitForLocalSave(page);
    const roundaboutRunUrl = page.url();

    await page.getByLabel("Case options").click();
    await page
      .getByRole("button", { name: "Open demo scenario: Parking-area account contradiction" })
      .click();

    await expect(page.locator(".workspace-case-title")).toContainText(
      "Parking-area account contradiction",
    );
    await expect(page).not.toHaveURL(roundaboutRunUrl);
    await waitForLocalSave(page);

    await page.goBack();
    await expect(page.locator(".workspace-case-title")).toContainText(
      "Roundabout incident — 17:42",
    );
    await expect(page).toHaveURL(roundaboutRunUrl);
  });

  test("opens the high-speed scenario with explicit reconstructed-speed context", async ({
    page,
  }) => {
    await openLanding(page);

    const highSpeedCard = page.locator(".scenario-card.is-high-speed");
    await expect(highSpeedCard).toContainText("High-speed review");
    await expect(highSpeedCard).toContainText("65–80 km/h synthetic approach");
    await highSpeedCard
      .getByRole("button", { name: "Open case: High-speed braking account" })
      .click();

    await expect(page.locator(".workspace-case-title")).toContainText("High-speed braking account");
    await page.getByRole("button", { name: /Approximate impact at 3\.0 seconds/ }).click();

    const adjacentPaths = page.getByTestId("impact-adjacent-paths");
    await expect(adjacentPaths).toContainText("64.8 → 51.0 km/h");
    await expect(adjacentPaths).toContainText("76.8 → 50.1 km/h");
    await expect(adjacentPaths).toContainText("Leg-average speed · not simulated");
    await inspectorTab(page, "Facts").click();
    await expect(
      page.getByText(/These reconstruction values are not measured speeds/i),
    ).toBeVisible();
  });

  test("keeps the 12.6 km/h example in the parking demo and separates motion after contact", async ({
    page,
  }) => {
    await openLanding(page);
    await page
      .getByRole("button", { name: "Open case: Parking-area account contradiction" })
      .click();

    await expect(page.locator(".parking-speed-label")).toHaveText("15");
    await page.getByRole("button", { name: /Approximate impact at 1\.0 seconds/ }).click();
    const adjacentPaths = page.getByTestId("impact-adjacent-paths");
    await expect(adjacentPaths).toContainText("12.6 → 2.5 km/h");
    await expect(adjacentPaths).toContainText("0.0 → 3.1 km/h");
    await expect(page.locator(".scene-contact-readout")).toContainText(
      "Impact event geometry · footprints meet",
    );

    await page.getByRole("slider", { name: "Timeline position" }).fill("2000");
    await expect(page.locator(".scene-contact-readout")).toHaveAttribute(
      "data-contact-state",
      "clear",
    );
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
    const timelineScroll = page.locator(".timeline__scroll");
    const timelineOverflows = await timelineScroll.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    );
    if (timelineOverflows) {
      await expect
        .poll(() => timelineScroll.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(0);
    }
    await expect(vehicleA).not.toHaveAttribute("transform", initialTransform ?? "");
    const impactTransform = await vehicleA.getAttribute("transform");
    await expect(contactReadout).toHaveAttribute("data-contact-state", "recorded");
    await expect(contactReadout).toContainText("Impact event geometry · footprints meet");
    await expect(contactReadout).toContainText("event status: uncertain");
    await expect(contactReadout).toContainText("footprint overlap depth 0.00 m");
    const adjacentPaths = page.getByTestId("impact-adjacent-paths");
    await expect(adjacentPaths).toContainText("Authored path: before → after");
    await expect(adjacentPaths).toContainText("Leg-average speed · not simulated");
    await expect(adjacentPaths).toContainText("23.9 → 18.1 km/h");
    await expect(adjacentPaths).toContainText("23.3 → 18.1 km/h");
    await expect(adjacentPaths).toContainText("course shift 17.1° left");
    await expect(adjacentPaths).toContainText("does not calculate a collision response");

    const timeline = page.getByLabel("Incident timeline");
    await expect(page.getByLabel("Playback speed")).toHaveValue("1.25");

    // Starting from an impact selected by the event marker or scrubber must
    // consume that boundary immediately. This is separate from resuming after
    // playback itself crossed the impact and triggered the automatic pause.
    await timeline.getByRole("button", { name: "Play reconstruction", exact: true }).click();
    await expect.poll(async () => Number(await scrubber.inputValue())).toBeGreaterThan(10_050);
    await timeline.getByRole("button", { name: "Pause reconstruction", exact: true }).click();
    await scrubber.fill("10000");
    await timeline.getByRole("button", { name: "Play reconstruction", exact: true }).click();
    await expect.poll(async () => Number(await scrubber.inputValue())).toBeGreaterThan(10_050);
    await timeline.getByRole("button", { name: "Pause reconstruction", exact: true }).click();

    // Replaying the authored impact while ordinary playback is already active
    // must replace that motion cleanly instead of invalidating its only RAF loop.
    await scrubber.fill("4000");
    await page.getByLabel("Playback speed").selectOption("2");
    await timeline.getByRole("button", { name: "Play reconstruction", exact: true }).click();
    await expect(
      timeline.getByRole("button", { name: "Pause reconstruction", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Play authored motion around impact" }).click();
    await expect(
      timeline.getByRole("button", { name: "Pause reconstruction", exact: true }),
    ).toBeVisible();
    await expect.poll(async () => Number(await scrubber.inputValue())).toBeLessThan(10_000);
    await expect(contactReadout).toHaveAttribute("data-contact-state", "clear");
    await expect
      .poll(() => contactReadout.getAttribute("data-contact-state"), {
        intervals: [25],
        timeout: 3_000,
      })
      .toBe("recorded");
    await expect(scrubber).toHaveValue("10000");
    await expect.poll(async () => Number(await scrubber.inputValue())).toBeGreaterThan(10_000);
    await expect.poll(async () => Number(await scrubber.inputValue())).toBe(14_000);
    await expect(
      timeline.getByRole("button", { name: "Play reconstruction", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".toast")).toContainText("Authored impact sequence complete.");
    await expect(page.locator(".toast")).toContainText(
      "authored timed geometry for review, not a generated collision response",
    );
    await expect(vehicleA).not.toHaveAttribute("transform", impactTransform ?? "");

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
    await expect(page.locator(".toast")).toContainText("authored post-impact positions");
    await expect(contactReadout).toHaveAttribute("data-contact-state", "recorded");

    await timeline.getByRole("button", { name: "Play reconstruction", exact: true }).click();
    await expect.poll(async () => Number(await scrubber.inputValue())).toBeGreaterThan(10_100);
    const pauseAfterImpact = timeline.getByRole("button", {
      name: "Pause reconstruction",
      exact: true,
    });
    if (await pauseAfterImpact.isVisible()) await pauseAfterImpact.click();
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
    await expect(page.getByText("5 unresolved", { exact: true })).toBeVisible();
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
          sourceIds: [],
          relatedIds: ["trajectory-a-baseline", "trajectory-b-baseline"],
          status: "agent-hypothesis",
          branchId: "branch-baseline",
          sharedAcrossBranches: false,
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
    const links = detail.getByLabel("Observation links");
    await expect(links.getByRole("button", { name: "Path · Vehicle A" })).toBeVisible();
    await expect(links.getByRole("button", { name: "Path · Vehicle B" })).toBeVisible();
    await expect(links.getByRole("button", { name: "Hypothesis · Baseline" })).toBeVisible();
    await links.getByRole("button", { name: "Path · Vehicle A" }).click();
    await expect(page.locator(".scene-selection-editor")).toContainText("Vehicle A");
  });

  test("a shared agent-recorded observation remains eligible for explicit human confirmation", async ({
    page,
  }) => {
    await installModelContextPolyfill(page);
    await openDemo(page);

    const statement = "The overview image shows both vehicles near the recorded contact area.";
    const { dialog } = await openWebMCPInspector(page);
    await dialog.locator(".debug-tool-list button").filter({ hasText: "add_observation" }).click();
    await dialog.getByLabel("Simulation input").fill(
      JSON.stringify(
        {
          statement,
          sourceType: "scene-observation",
          sourceIds: ["evidence-overview"],
          relatedIds: [],
          status: "reported",
          sharedAcrossBranches: true,
          expectedVersion: 1,
          requestId: "e2e-agent-shared-observation-001",
        },
        null,
        2,
      ),
    );
    await dialog.getByRole("button", { name: "Run through browser" }).click();
    await expect(dialog.locator(".debug-result")).toContainText('"ok": true');
    await dialog.getByRole("button", { name: "Close WebMCP inspector" }).click();

    await inspectorTab(page, "Facts").click();
    await page.getByRole("button", { name: new RegExp(statement) }).click();
    const detail = page.getByLabel("Selected observation");
    await expect(detail.getByText("agent", { exact: true })).toBeVisible();
    await expect(detail.getByRole("note")).toContainText(
      "Confirm only after independently reviewing its wording, scope, and cited sources.",
    );
    const confirm = detail.getByRole("button", { name: "Confirm as human-reviewed" });
    await expect(confirm).toBeVisible();
    await confirm.click();
    await expect(detail.getByText("This status came from an explicit human action.")).toBeVisible();
    await expect(page.locator(".activity-list")).toContainText(`Human confirmed: ${statement}`);
  });

  test("the evidence tray uses all four generated demo assets with explicit provenance", async ({
    page,
  }, testInfo) => {
    await openDemo(page);
    await inspectorTab(page, "Evidence").click();

    const tray = page.getByRole("list", { name: "Evidence images" });
    await expect(tray.getByRole("listitem")).toHaveCount(4);
    const sources = await tray
      .locator("img")
      .evaluateAll((images) =>
        images.map((image) => new URL((image as HTMLImageElement).src).pathname).sort(),
      );
    const configuredBaseUrl = new URL(String(testInfo.project.use.baseURL));
    expect(sources).toEqual(
      [
        "assets/generated/demo-road-condition.webp",
        "assets/generated/demo-roundabout-wide-v2.webp",
        "assets/generated/demo-vehicle-a-damage-v2.webp",
        "assets/generated/demo-vehicle-b-damage-v2.webp",
      ]
        .map((path) => new URL(path, configuredBaseUrl).pathname)
        .sort(),
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
  }, testInfo) => {
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

    if (testInfo.project.name === "chromium-desktop") {
      const trajectoryLaneLayout = await page.locator(".timeline__scroll").evaluate((viewport) => {
        const viewportBounds = viewport.getBoundingClientRect();
        return [...viewport.querySelectorAll<HTMLElement>(".timeline__keyframe-lane")].map(
          (lane) => {
            const bounds = lane.getBoundingClientRect();
            return {
              top: bounds.top,
              bottom: bounds.bottom,
              viewportTop: viewportBounds.top,
              viewportBottom: viewportBounds.bottom,
            };
          },
        );
      });
      expect(trajectoryLaneLayout).toHaveLength(4);
      for (const lane of trajectoryLaneLayout) {
        expect(lane.top).toBeGreaterThanOrEqual(lane.viewportTop - 1);
        expect(lane.bottom).toBeLessThanOrEqual(lane.viewportBottom + 1);
      }
    }
  });

  test("report finalization requires visible review and a second manual confirmation", async ({
    page,
  }) => {
    await openDemo(page);
    await inspectorTab(page, "Report").click();

    const toolForm = page.locator("form.finalize-tool-form");
    await expect(toolForm).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Finalized snapshot history" })).toBeVisible();
    await expect(page.getByText("No immutable snapshots yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "PDF draft", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Build report preview" }).click();
    await expect(toolForm).toHaveAttribute("toolname", "finalize_factual_report");
    await expect(toolForm).not.toHaveAttribute("toolautosubmit", /.*/);
    const reviewButton = toolForm.getByRole("button", { name: "Review and finalize" });
    const reportPreview = page.locator(".report-preview");
    await expect(reportPreview.locator(".report-preview__status")).toContainText(
      "Draft — not finalized",
    );
    await expect
      .poll(() =>
        page.evaluate(() => {
          const action = document.querySelector(".finalize-action");
          const preview = document.querySelector(".report-preview");
          return Boolean(
            action &&
            preview &&
            (preview.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
          );
        }),
      )
      .toBe(true);
    const overviewSources = reportPreview
      .getByRole("heading", { name: "Case overview" })
      .locator("..")
      .locator("details.report-citations");
    await expect(
      overviewSources.getByText("Sources: 3 case details", { exact: true }),
    ).toBeVisible();
    await expect(overviewSources.locator("code")).not.toBeVisible();
    await overviewSources.locator("summary").click();
    await expect(overviewSources.locator("code")).toContainText("case.approximateTime");
    await expect(
      reportPreview.getByRole("heading", {
        name: "Roundabout incident — 17:42",
      }),
    ).toBeVisible();
    await expect(reportPreview.locator(".report-certainty.is-confirmed").first()).toHaveText(
      "Confirmed",
    );
    await reportPreview.getByRole("button", { name: /Show all \d+ sections/ }).click();
    await expect(reportPreview.locator(".report-certainty.is-reported").first()).toHaveText(
      "Reported",
    );
    await expect(reportPreview.locator(".report-certainty.is-uncertain").first()).toHaveText(
      "Uncertain",
    );
    await expect(reportPreview.locator(".report-certainty.is-system").first()).toHaveText("System");
    await expect(reportPreview.locator(".certainty-dot").first()).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await expect(reviewButton).toBeEnabled();
    await reviewButton.click();

    const reviewDialog = page.getByRole("dialog", { name: "Review before finalizing" });
    await expect(
      reviewDialog.getByText("The agent can prepare this screen but cannot complete it."),
    ).toBeVisible();
    const reviewMaterial = reviewDialog.getByRole("group", { name: "Report content to review" });
    await expect(
      reviewMaterial.getByRole("heading", { name: "Unresolved questions" }),
    ).toBeVisible();
    await expect(reviewMaterial).toContainText(
      "Which vehicle, if either, crossed the lane boundary before contact?",
    );
    await expect(reviewMaterial).toContainText("The road surface was wet after light rain.");
    await expect(reviewMaterial).toContainText("T+17.0 s — Post-incident photographs recorded.");
    await expect(reviewMaterial).toContainText(
      "Vehicle A: front-left — Minor scraping at the front-left bumper and wheel arch. [confirmed].",
    );
    await expect(reviewMaterial).toContainText(
      "This report is not forensic analysis or legal advice",
    );
    await expect(reviewMaterial).toContainText("Hypothesis — Baseline reconstruction");
    const continueButton = reviewDialog.getByRole("button", { name: "Continue to confirmation" });
    await expect(continueButton).toBeDisabled();
    await expect(reviewDialog.getByRole("status")).toHaveText(/0 of 4 acknowledged/);

    await reviewDialog.getByLabel("I reviewed unresolved questions.").check();
    await expect(reviewDialog.getByRole("status")).toHaveText(/1 of 4 acknowledged/);
    await reviewDialog.getByLabel("I acknowledge the method and limitations.").check();
    await expect(continueButton).toBeDisabled();
    await reviewDialog.getByLabel("I reviewed every confirmed fact.").check();
    await expect(continueButton).toBeDisabled();
    await reviewDialog
      .getByLabel("I reviewed every included unconfirmed and hypothesis statement.")
      .check();
    await expect(reviewDialog.getByRole("status")).toHaveText(/4 of 4 acknowledged/);
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

  test("keeps finalization progress and actions reachable with 200% mobile text", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDemo(page);
    await inspectorTab(page, "Report").click();
    await page.getByRole("button", { name: "Build report preview" }).click();
    await page.getByRole("button", { name: "Review and finalize" }).click();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });

    const review = page.getByRole("dialog", { name: "Review before finalizing" });
    const body = review.locator(".finalization-dialog__body");
    const actions = review.locator(".finalization-dialog__actions");
    await expect(actions).toBeVisible();
    await expect
      .poll(() =>
        actions.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= window.innerHeight + 1;
        }),
      )
      .toBe(true);
    await expect
      .poll(() => review.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
      .toBe(true);
    await expect
      .poll(() => body.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true);

    await review.getByLabel("I reviewed unresolved questions.").check();
    await review.getByLabel("I acknowledge the method and limitations.").check();
    await review.getByLabel("I reviewed every confirmed fact.").check();
    await review
      .getByLabel("I reviewed every included unconfirmed and hypothesis statement.")
      .check();
    await expect(review.getByRole("status")).toHaveText(/4 of 4 acknowledged/);
    const continueButton = review.getByRole("button", { name: "Continue to confirmation" });
    await expect(continueButton).toBeVisible();
    await expect(continueButton).toBeEnabled();
    await continueButton.click();
    await expect(
      page.getByRole("alertdialog", { name: "Create an immutable report snapshot?" }),
    ).toBeVisible();
  });

  test("keeps a failed finalization review open with its human acknowledgements", async ({
    page,
  }) => {
    await openDemo(page);
    const caseId = currentDemoRunId(page);
    await inspectorTab(page, "Report").click();
    await page.getByRole("button", { name: "Build report preview" }).click();
    await page.getByRole("button", { name: "Review and finalize" }).click();
    const review = page.getByRole("dialog", { name: "Review before finalizing" });
    await review.getByLabel("I reviewed unresolved questions.").check();
    await review.getByLabel("I acknowledge the method and limitations.").check();
    await review.getByLabel("I reviewed every confirmed fact.").check();
    await review
      .getByLabel("I reviewed every included unconfirmed and hypothesis statement.")
      .check();
    await review.getByRole("button", { name: "Continue to confirmation" }).click();
    const confirmation = page.getByRole("alertdialog", {
      name: "Create an immutable report snapshot?",
    });

    await page.evaluate(
      ({ replayCaseId }) => {
        const channel = new BroadcastChannel("replay-local-vault-updates");
        channel.postMessage({
          caseId: replayCaseId,
          writerId: "e2e-competing-writer",
          caseVersion: 2,
          updatedAt: "2026-08-29T18:00:00.000Z",
        });
        channel.close();
      },
      { replayCaseId: caseId },
    );
    await expect(page.locator(".workspace-conflict")).toContainText(
      "Another REPLAY page saved case version 2",
    );
    await confirmation.getByRole("button", { name: "Finalize factual report" }).click();

    await expect(confirmation).toHaveCount(0);
    await expect(review).toBeVisible();
    await expect(review.getByLabel("I reviewed unresolved questions.")).toBeChecked();
    await expect(review.getByLabel("I acknowledge the method and limitations.")).toBeChecked();
    await expect(review.getByLabel("I reviewed every confirmed fact.")).toBeChecked();
    await expect(
      review.getByLabel("I reviewed every included unconfirmed and hypothesis statement."),
    ).toBeChecked();
    await expect(page.locator(".toast")).toContainText("Another REPLAY page saved case version 2");
  });

  test("explains visible report requirements before enabling human review", async ({ page }) => {
    await openLanding(page);
    await page.getByRole("button", { name: "Start a blank case" }).click();
    await page.getByLabel("Case title").fill("Incomplete report readiness account");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Create local case" }).click();

    await expect(page.getByText("No observations yet", { exact: true })).toBeVisible();
    await expect(
      page.getByText(/select a vehicle in the scene and choose Create path/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Open REPLAY guide" }).click();
    const localGuide = page.getByRole("dialog", { name: "Learn REPLAY" });
    await expect(
      localGuide.getByRole("button", { name: "Start 6-step workspace tour" }),
    ).toHaveCount(0);
    await expect(localGuide.getByText(/playback tour uses the calibrated demo/)).toBeVisible();
    await localGuide.getByRole("button", { name: "Close REPLAY guide" }).click();

    await inspectorTab(page, "Report").click();
    await page.getByRole("button", { name: "Build report preview" }).click();
    const preview = page.locator(".report-preview");
    await expect(preview.getByText("Not ready to finalize", { exact: true })).toBeVisible();
    await expect(preview.locator(".report-missing li")).not.toHaveCount(0);
    await expect(page.getByRole("button", { name: "Review and finalize" })).toBeDisabled();
    await expect(page.locator(".finalize-help")).toContainText(
      /Resolve the \d+ missing requirement/,
    );
  });

  test("a case mutation closes stale human review and requires a fresh report preview", async ({
    page,
  }) => {
    await installModelContextPolyfill(page);
    await openDemo(page);
    await inspectorTab(page, "Report").click();
    await page.getByRole("button", { name: "Build report preview" }).click();
    await page.getByRole("button", { name: "Review and finalize" }).click();
    const review = page.getByRole("dialog", { name: "Review before finalizing" });
    await review.getByLabel("I reviewed unresolved questions.").check();

    const result = await page.evaluate(async () => {
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
      const tool = (await modelContext.getTools()).find(
        (candidate) => candidate.name === "add_observation",
      );
      if (!tool) throw new Error("add_observation is not registered.");
      return modelContext.executeTool(tool, {
        statement: "A sourced observation arrived while the review dialog was open.",
        sourceType: "scene-observation",
        sourceIds: ["evidence-overview"],
        relatedIds: [],
        status: "reported",
        sharedAcrossBranches: true,
        expectedVersion: 1,
        requestId: "e2e-stale-finalization-review",
      });
    });
    expect(JSON.parse(result)).toMatchObject({ ok: true, caseVersion: 2 });
    await expect(page.getByRole("dialog", { name: "Review before finalizing" })).toHaveCount(0);

    await inspectorTab(page, "Report").click();
    await expect(page.getByRole("button", { name: "Build report preview" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Review and finalize" })).toHaveCount(0);
  });

  test("blank-case wizard records optional context as reported rather than confirmed", async ({
    page,
  }) => {
    await openLanding(page);
    await page.getByRole("button", { name: "Start a blank case" }).click();

    await expect(page.getByRole("heading", { name: "Name the case." })).toBeVisible();
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

    const physicalModel = page.locator(".scene-calibration-popover");
    await physicalModel.locator("summary").click();
    const postedLimit = physicalModel.getByLabel("Posted limit km/h (optional)");
    const sceneWidth = physicalModel.getByLabel("Width m");
    const sceneUncertainty = physicalModel.getByLabel("Uncertainty ±m");
    const initialWidth = await sceneWidth.inputValue();
    const initialUncertainty = await sceneUncertainty.inputValue();
    const nextUncertainty = initialUncertainty === "2" ? "3" : "2";
    await expect(postedLimit).toHaveValue("");
    await expect(physicalModel).toContainText(
      "template default without recording that value as a posted limit",
    );
    await postedLimit.fill("50");
    await sceneWidth.fill("120");
    await physicalModel.getByRole("button", { name: "Apply scene settings" }).click();
    await waitForLocalSave(page);
    await physicalModel.locator("summary").click();
    await expect(physicalModel.getByLabel("Posted limit km/h (optional)")).toHaveValue("50");
    await expect(physicalModel.getByLabel("Width m")).toHaveValue("120");

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(physicalModel.getByLabel("Posted limit km/h (optional)")).toHaveValue("");
    await expect(physicalModel.getByLabel("Width m")).toHaveValue(initialWidth);

    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(physicalModel.getByLabel("Posted limit km/h (optional)")).toHaveValue("50");
    await expect(physicalModel.getByLabel("Width m")).toHaveValue("120");

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(physicalModel.getByLabel("Posted limit km/h (optional)")).toHaveValue("");
    await expect(physicalModel.getByLabel("Width m")).toHaveValue(initialWidth);
    await physicalModel.getByLabel("Uncertainty ±m").fill(nextUncertainty);
    await physicalModel.getByRole("button", { name: "Apply scene settings" }).click();
    await waitForLocalSave(page);
    await physicalModel.locator("summary").click();
    await expect(physicalModel.getByLabel("Posted limit km/h (optional)")).toHaveValue("");
    await expect(physicalModel.getByLabel("Width m")).toHaveValue(initialWidth);
    await expect(physicalModel.getByLabel("Uncertainty ±m")).toHaveValue(nextUncertainty);

    await physicalModel.getByLabel("Posted limit km/h (optional)").fill("50");
    await physicalModel.getByRole("button", { name: "Apply scene settings" }).click();
    await waitForLocalSave(page);
    await physicalModel.locator("summary").click();
    await physicalModel.getByLabel("Posted limit km/h (optional)").fill("");
    await physicalModel.getByRole("button", { name: "Apply scene settings" }).click();
    await waitForLocalSave(page);
    await physicalModel.locator("summary").click();
    await expect(physicalModel.getByLabel("Posted limit km/h (optional)")).toHaveValue("");

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
    const scene = page.getByRole("group", { name: /Editable road scene/ });
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
    await page
      .getByLabel("Case inspector")
      .getByRole("button", { name: /Vehicle A was stopped after the incident/ })
      .click();
    await page.getByRole("button", { name: "Confirm as human-reviewed" }).click();
    await waitForLocalSave(page);

    await page.reload();
    await expect(page.locator("main.workspace")).toBeVisible();
    await expect(page.getByText("Persistent local account", { exact: true })).toBeVisible();
    await expect(page.getByText("1 confirmed", { exact: true })).toBeVisible();
    await page
      .getByLabel("Case inspector")
      .getByRole("button", { name: /Vehicle A was stopped after the incident/ })
      .click();
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

    await page.getByRole("button", { name: "Open Roundabout demo" }).click();
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
