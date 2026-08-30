import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  currentDemoRunId,
  inspectorTab,
  installModelContextPolyfill,
  openDemo,
  openLanding,
  openWebMCPInspector,
} from "./helpers";

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

async function expectTimelineTargetSpacing(page: Page, state: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include(".timeline")
    .withRules(["target-size"])
    .options({ rules: { "target-size": { enabled: true } } })
    .analyze();
  const summary = results.violations
    .flatMap((violation) =>
      violation.nodes.map((node) => `${node.target.join(" ")}: ${node.failureSummary ?? "failed"}`),
    )
    .join("\n");
  expect(
    results.violations,
    `${state} has overlapping or undersized timeline targets:\n${summary}`,
  ).toEqual([]);
}

async function expectTimelineEventLabelsDoNotOverlap(page: Page, state: string): Promise<void> {
  const collisions = await page.locator(".timeline-event__label").evaluateAll((labels) => {
    const visible = labels.flatMap((label) => {
      const element = label as HTMLElement;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return [];
      const bounds = element.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0
        ? [
            {
              label: element.textContent.trim() || "unnamed event",
              left: bounds.left,
              right: bounds.right,
              top: bounds.top,
              bottom: bounds.bottom,
            },
          ]
        : [];
    });
    const overlaps: string[] = [];
    for (let firstIndex = 0; firstIndex < visible.length - 1; firstIndex += 1) {
      const first = visible[firstIndex];
      if (!first) continue;
      for (let secondIndex = firstIndex + 1; secondIndex < visible.length; secondIndex += 1) {
        const second = visible[secondIndex];
        if (!second) continue;
        const horizontalOverlap = first.left < second.right && first.right > second.left;
        const verticalOverlap = first.top < second.bottom && first.bottom > second.top;
        if (horizontalOverlap && verticalOverlap) {
          overlaps.push(`${first.label} overlaps ${second.label}`);
        }
      }
    }
    return overlaps;
  });
  expect(collisions, `${state} has colliding timeline event labels`).toEqual([]);
}

async function pauseEditingFromExternalVersion(page: Page): Promise<void> {
  await page.evaluate(
    ({ caseId }) => {
      const channel = new BroadcastChannel("replay-local-vault-updates");
      channel.postMessage({
        caseId,
        writerId: "external-accessibility-test-writer",
        caseVersion: 999,
        updatedAt: "2026-08-29T12:00:00.000Z",
      });
      window.setTimeout(() => channel.close(), 0);
    },
    { caseId: currentDemoRunId(page) },
  );
  await expect(page.locator(".workspace-conflict")).toBeVisible();
}

async function seedAgentProposal(page: Page, proposalNumber = 1): Promise<void> {
  await page.evaluate(async (sequence) => {
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
    const workspaceTool = tools.find((tool) => tool.name === "get_workspace_state");
    const proposalTool = tools.find((tool) => tool.name === "propose_scene_changes");
    if (!workspaceTool || !proposalTool) throw new Error("Required Site Tools are not registered.");
    const workspace = JSON.parse(
      await modelContext.executeTool(workspaceTool, { sections: ["scene"] }),
    ) as {
      caseVersion: number;
      data: { scene: { branchId: string; playheadTimeMs: number } };
    };
    const proposal = JSON.parse(
      await modelContext.executeTool(proposalTool, {
        title: "Draft-retention proposal",
        rationale: "Keep the human adjustment visible if the shared case rejects the command.",
        changes: [
          {
            kind: "actor-pose",
            actorId: "actor-vehicle-a",
            proposedPose: {
              x: 0.6 + sequence * 0.01,
              y: 0.47,
              rotationDeg: 7 + sequence,
            },
          },
          {
            kind: "actor-pose",
            actorId: "actor-vehicle-b",
            proposedPose: {
              x: 0.54 + sequence * 0.01,
              y: 0.64,
              rotationDeg: 83 + sequence,
            },
          },
        ],
        expectedPoseTarget: {
          branchId: workspace.data.scene.branchId,
          playheadTimeMs: workspace.data.scene.playheadTimeMs,
        },
        expectedVersion: workspace.caseVersion,
        requestId: `request-a11y-draft-retention-${String(sequence).padStart(4, "0")}`,
      }),
    ) as { ok?: boolean; message?: string };
    if (!proposal.ok) throw new Error(proposal.message ?? "Proposal setup failed.");
  }, proposalNumber);
  await expect(
    page.getByRole("heading", {
      name: `${String(proposalNumber)} change set${proposalNumber === 1 ? "" : "s"} awaiting you`,
    }),
  ).toBeVisible();
}

test.describe("accessibility guardrails", () => {
  test("timeline event labels remain distinct at compact desktop and mobile widths", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openDemo(page);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await expectTimelineEventLabelsDoNotOverlap(page, "1024 px demo workspace");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    const compactImpact = page
      .locator(".timeline-event")
      .filter({ hasText: "Approximate contact" });
    await compactImpact.focus();
    await page.keyboard.press("Shift");
    await expect(compactImpact.locator(".timeline-event__label")).toBeVisible();
    await expectTimelineEventLabelsDoNotOverlap(page, "390 px demo workspace");
    await expectTimelineTargetSpacing(page, "390 px demo workspace");

    const compactGeometry = await page.locator(".timeline__scroll").evaluate((scroll) => ({
      hasVerticalOverflow: scroll.scrollHeight > scroll.clientHeight,
      coarsePointer: matchMedia("(pointer: coarse)").matches,
      eventTargets: [...scroll.querySelectorAll<HTMLElement>(".timeline-event")].map((event) => {
        const bounds = event.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      }),
    }));
    expect(compactGeometry.hasVerticalOverflow).toBe(false);
    if (compactGeometry.coarsePointer) {
      expect(
        compactGeometry.eventTargets.every(({ width, height }) => width >= 44 && height >= 44),
      ).toBe(true);
    }
  });

  test("landing and blank-case wizard have no serious or critical violations", async ({ page }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await openLanding(page);
    await expectNoHighImpactViolations(page, "landing page");

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();

    await page.getByRole("button", { name: "Start a blank case" }).click();
    await expect(page.getByRole("heading", { name: "Name the case." })).toBeVisible();
    const title = page.getByRole("textbox", { name: "Case title" });
    await expect(title).toBeFocused();
    await title.fill("   ");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("alert")).toHaveText("Enter a case title before continuing.");
    await expect(title).toHaveAttribute("aria-invalid", "true");
    await expect(title).toBeFocused();
    await expectNoHighImpactViolations(page, "blank-case title validation");

    await title.fill("  Accessible local case  ");
    await page.getByRole("button", { name: "Continue" }).click();
    let sceneHeading = page.getByRole("heading", { name: "Choose the scene." });
    await expect(sceneHeading).toBeFocused();
    await expect(page.locator(".wizard-step-announcement")).toHaveText("Step 2 of 3");
    await expectNoHighImpactViolations(page, "blank-case scene selection");

    await sceneHeading.press("Tab");
    const roundabout = page.getByRole("radio", { name: /Roundabout/ });
    await expect(roundabout).toBeFocused();
    const focusedTileAppearance = await roundabout.locator("..").evaluate((tile) => {
      const style = getComputedStyle(tile);
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth),
      };
    });
    expect(focusedTileAppearance.outlineStyle).not.toBe("none");
    expect(focusedTileAppearance.outlineWidth).toBeGreaterThanOrEqual(2);

    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio", { name: /Intersection/ })).toBeFocused();
    await expect(page.getByRole("radio", { name: /Intersection/ })).toBeChecked();
    await page.getByRole("button", { name: "Continue" }).focus();
    await page.keyboard.press("Enter");

    let statementHeading = page.getByRole("heading", {
      name: "Record a first statement, if known.",
    });
    await expect(statementHeading).toBeFocused();
    await expect(page.locator(".wizard-step-announcement")).toHaveText("Step 3 of 3");
    await expectNoHighImpactViolations(page, "blank-case optional statement");

    await page.getByRole("button", { name: "Previous" }).focus();
    await page.keyboard.press("Enter");
    sceneHeading = page.getByRole("heading", { name: "Choose the scene." });
    await expect(sceneHeading).toBeFocused();
    await page.getByRole("button", { name: "Continue" }).focus();
    await page.keyboard.press("Enter");
    statementHeading = page.getByRole("heading", {
      name: "Record a first statement, if known.",
    });
    await expect(statementHeading).toBeFocused();

    await page.getByRole("textbox", { name: /Initial factual statement/ }).fill(" \n\t ");
    await page.getByRole("button", { name: "Create local case" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("main.workspace")).toBeVisible();
    await expect(page.locator(".workspace-case-title h1")).toHaveText("Accessible local case");

    const editTarget = await page
      .getByRole("button", { name: "Edit case details" })
      .first()
      .evaluate((button) => {
        const bounds = button.getBoundingClientRect();
        return {
          coarsePointer: matchMedia("(pointer: coarse), (any-pointer: coarse)").matches,
          width: bounds.width,
          height: bounds.height,
        };
      });
    if (editTarget.coarsePointer) {
      expect(editTarget.width).toBeGreaterThanOrEqual(44);
      expect(editTarget.height).toBeGreaterThanOrEqual(44);
    }

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("demo workspace and human finalization dialog have no serious or critical violations", async ({
    page,
  }) => {
    await openDemo(page);
    await expectNoHighImpactViolations(page, "demo workspace");
    await expectTimelineTargetSpacing(page, "demo workspace");
    const timelineLayout = await page.locator(".timeline__scroll").evaluate((scroll) => ({
      clientHeight: scroll.clientHeight,
      scrollHeight: scroll.scrollHeight,
      laneHeights: [...scroll.querySelectorAll(".timeline__keyframe-lane")].map(
        (lane) => lane.getBoundingClientRect().height,
      ),
      labelHeights: [...scroll.querySelectorAll(".timeline__lane-labels > div")].map(
        (label) => label.getBoundingClientRect().height,
      ),
    }));
    expect(timelineLayout.laneHeights).toEqual(timelineLayout.labelHeights);
    expect(timelineLayout.scrollHeight).toBeLessThanOrEqual(timelineLayout.clientHeight);

    await page.getByRole("button", { name: /Approximate impact at 10\.0 seconds/ }).click();
    await expect(
      page.getByRole("button", { name: "Play authored motion around impact" }),
    ).toBeVisible();
    await expectNoHighImpactViolations(page, "impact review workspace");

    await inspectorTab(page, "Evidence").click();
    await expectNoHighImpactViolations(page, "evidence workspace");
    await inspectorTab(page, "Hypotheses").click();
    await expectNoHighImpactViolations(page, "hypothesis workspace");

    await inspectorTab(page, "Report").click();
    await page.getByRole("button", { name: "Build report preview" }).click();
    await expect(page.locator(".validation-summary strong")).toHaveText("1 consistency item");
    await expect(page.locator(".validation-summary span")).toHaveText(
      "0 errors · 0 warnings · 1 question",
    );
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
    await page.getByRole("button", { name: "Expert", exact: true }).click();
    await page.reload();
    await expect(page.locator("main.workspace")).toBeVisible();
    await expect(page.locator(".save-status")).toContainText("Saved locally");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
    await expect(inspectorTab(page, "Report")).toBeVisible();
    await expect(page.locator(".workspace-case-title")).toContainText(
      "Roundabout incident — 17:42",
    );
    await expect(page.locator(".workspace-case-title")).toContainText("v1");
    await expect(page.locator(".save-status")).toContainText("Saved locally");

    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

    const compactToolbar = await page.locator(".scene-toolbar").evaluate((toolbar) => {
      const groups = [...toolbar.querySelectorAll(":scope > .scene-toolbar__group")].map((group) =>
        group.getBoundingClientRect(),
      );
      return {
        height: toolbar.getBoundingClientRect().height,
        groupRows: new Set(groups.map((group) => Math.round(group.top))).size,
        groupHeights: groups.map((group) => group.height),
      };
    });
    expect(compactToolbar.groupRows).toBe(2);
    expect(Math.max(...compactToolbar.groupHeights)).toBeLessThanOrEqual(44);
    expect(compactToolbar.height).toBeLessThanOrEqual(112);

    await page.setViewportSize({ width: 1105, height: 625 });
    await expect(page.locator(".scene-toolbar__label")).toBeHidden();
    const splitViewToolbarHeight = await page
      .locator(".scene-toolbar")
      .evaluate((toolbar) => toolbar.getBoundingClientRect().height);
    expect(splitViewToolbarHeight).toBeLessThanOrEqual(60);

    await page.setViewportSize({ width: 390, height: 900 });
    const hypothesesLabel = inspectorTab(page, "Hypotheses").locator("span").first();
    await expect(hypothesesLabel).toBeVisible();
    const labelMetrics = await hypothesesLabel.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        height: element.getBoundingClientRect().height,
        lineHeight: Number.parseFloat(style.lineHeight),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      };
    });
    expect(labelMetrics.height).toBeLessThanOrEqual(labelMetrics.lineHeight + 1);
    expect(labelMetrics.scrollWidth).toBeLessThanOrEqual(labelMetrics.clientWidth + 1);
  });

  test("scene calibration keeps its primary action visible on desktop and mobile", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDemo(page);

    const calibration = page.locator(".scene-calibration-popover");
    const summary = calibration.locator("summary");
    const apply = calibration.getByRole("button", { name: "Apply scene settings" });

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await summary.click();
      await expect(apply).toBeVisible();
      const placement = await apply.evaluate((button) => {
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return {
          fullyInViewport:
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.right <= window.innerWidth &&
            rect.bottom <= window.innerHeight,
          unobstructed: hit === button || button.contains(hit),
        };
      });
      expect(placement).toEqual({ fullyInViewport: true, unobstructed: true });
      await summary.click();
    }
  });

  test("inspector tabs use roving focus and arrow-key activation", async ({ page }) => {
    await openDemo(page);
    const facts = inspectorTab(page, "Facts");
    const evidence = inspectorTab(page, "Evidence");
    await facts.focus();
    await facts.press("ArrowRight");
    await expect(evidence).toBeFocused();
    await expect(evidence).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel", { name: "Evidence" })).toBeVisible();

    await evidence.press("End");
    const report = inspectorTab(page, "Report");
    await expect(report).toBeFocused();
    await expect(report).toHaveAttribute("aria-selected", "true");
    await report.press("Home");
    await expect(facts).toBeFocused();
    await expect(facts).toHaveAttribute("aria-selected", "true");
  });

  test("evidence annotation mode exposes an axe-clean keyboard target and exact coordinate form", async ({
    page,
  }) => {
    await openDemo(page);
    await inspectorTab(page, "Evidence").click();
    const annotationTools = page.getByRole("group", { name: "Evidence annotation tools" });

    const pointMode = annotationTools.getByRole("button", { name: "Point", exact: true });
    await pointMode.click();
    const pointTarget = page.getByRole("button", {
      name: "Click the image to add a point annotation",
    });
    await expect(pointTarget).toBeFocused();
    await expect(pointTarget).toHaveAttribute("tabindex", "0");
    await expect(
      page.getByRole("form", { name: "Place point annotation by coordinates" }),
    ).toBeVisible();
    await expectNoHighImpactViolations(page, "active point annotation mode");
    await pointTarget.press("Enter");
    await expect(page.getByRole("list", { name: "Evidence annotations" })).toContainText("Point 1");
    await expect(pointMode).toBeFocused();

    const rectangleMode = annotationTools.getByRole("button", {
      name: "Rectangle",
      exact: true,
    });
    await rectangleMode.click();
    const rectangleTarget = page.getByRole("button", {
      name: "Click the image to add a rectangle annotation",
    });
    await expect(rectangleTarget).toBeFocused();
    const coordinateForm = page.getByRole("form", {
      name: "Place rectangle annotation by coordinates",
    });
    await expect(coordinateForm.getByRole("spinbutton", { name: "X %" })).toHaveValue("50");
    await expect(coordinateForm.getByRole("spinbutton", { name: "Y %" })).toHaveValue("50");
    await expect(coordinateForm.getByRole("spinbutton", { name: "Width %" })).toHaveValue("20");
    await expect(coordinateForm.getByRole("spinbutton", { name: "Height %" })).toHaveValue("16");
    await rectangleTarget.press("Space");
    await expect(page.getByRole("list", { name: "Evidence annotations" })).toContainText("Area 2");
    await expect(rectangleMode).toBeFocused();
  });

  test("agent proposal, debug inspector, comparison, and confirmation states pass axe", async ({
    page,
  }) => {
    test.setTimeout(60_000);
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
      const workspaceTool = tools.find((tool) => tool.name === "get_workspace_state");
      const proposalTool = tools.find((tool) => tool.name === "propose_scene_changes");
      if (!summaryTool || !workspaceTool || !proposalTool) {
        throw new Error("Required Site Tools are not registered.");
      }
      const summary = JSON.parse(await modelContext.executeTool(summaryTool, {})) as {
        caseVersion: number;
      };
      const workspace = JSON.parse(
        await modelContext.executeTool(workspaceTool, { sections: ["scene"] }),
      ) as {
        data: {
          scene: {
            trajectories: Array<{
              actorId: string;
              branchId: string;
              keyframes: Array<{ id: string; timeMs: number; y: number }>;
            }>;
          };
        };
      };
      const targetFor = (actorId: string) => {
        const trajectory = workspace.data.scene.trajectories.find(
          (candidate) => candidate.actorId === actorId,
        );
        const keyframe = trajectory?.keyframes.find((candidate) => candidate.timeMs === 8_000);
        if (!trajectory || !keyframe) throw new Error(`Missing 8 s path point for ${actorId}.`);
        return { trajectory, keyframe };
      };
      const vehicleA = targetFor("actor-vehicle-a");
      const vehicleB = targetFor("actor-vehicle-b");
      await modelContext.executeTool(proposalTool, {
        title: "Accessible two-vehicle preview",
        rationale: "Preview both path adjustments together for explicit human review.",
        changes: [
          {
            kind: "trajectory-keyframe-patch",
            actorId: vehicleA.trajectory.actorId,
            branchId: vehicleA.trajectory.branchId,
            adjustments: [{ keyframeId: vehicleA.keyframe.id, y: vehicleA.keyframe.y + 0.008 }],
          },
          {
            kind: "trajectory-keyframe-patch",
            actorId: vehicleB.trajectory.actorId,
            branchId: vehicleB.trajectory.branchId,
            adjustments: [{ keyframeId: vehicleB.keyframe.id, y: vehicleB.keyframe.y - 0.008 }],
          },
        ],
        expectedVersion: summary.caseVersion,
        requestId: "request-a11y-proposal-0001",
      });
    });
    await expect(page.getByRole("heading", { name: "1 change set awaiting you" })).toBeVisible();
    await page.getByRole("button", { name: /Review Vehicle A proposal at 8\.000 s/ }).click();
    await expect(page.getByTestId("proposal-scene-review")).toBeVisible();
    await expectNoHighImpactViolations(page, "agent proposal workspace");

    await page.locator("button.webmcp-status").click();
    const guide = page.getByRole("dialog", { name: "Learn REPLAY" });
    await expect(
      guide.getByRole("heading", { name: "Work manually or invite an agent into the same case" }),
    ).toBeVisible();
    await expectNoHighImpactViolations(page, "Site Tools guide");
    await guide.getByRole("button", { name: "Close REPLAY guide" }).click();

    const { dialog } = await openWebMCPInspector(page);
    await expectNoHighImpactViolations(page, "WebMCP debug inspector");
    await dialog.getByRole("button", { name: "Close WebMCP inspector" }).click();

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
    await expectTimelineTargetSpacing(page, "hypothesis comparison");

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
    await review
      .getByLabel("I reviewed every included unconfirmed and hypothesis statement.")
      .check();
    await review.getByRole("button", { name: "Continue to confirmation" }).click();
    await expectNoHighImpactViolations(page, "final report confirmation");
  });

  test("proposal confirmation restores focus after its card is removed", async ({ page }) => {
    await installModelContextPolyfill(page);
    await openDemo(page);
    await seedAgentProposal(page);
    await seedAgentProposal(page, 2);

    await page.locator(".proposal-card").first().getByRole("button", { name: "Reject" }).click();
    await page
      .getByRole("alertdialog", { name: "Reject this proposal?" })
      .getByRole("button", { name: "Reject proposal" })
      .click();

    const nextProposalReject = page
      .locator(".proposal-card")
      .first()
      .getByRole("button", { name: "Reject" });
    await expect(nextProposalReject).toBeFocused();
    await nextProposalReject.click();
    await page
      .getByRole("alertdialog", { name: "Reject this proposal?" })
      .getByRole("button", { name: "Reject proposal" })
      .click();

    await expect(page.getByText("Recent proposal decisions · showing newest 2 of 2")).toBeFocused();
  });

  test("a rejected report note keeps the human draft and exposes its length limit", async ({
    page,
  }) => {
    await openDemo(page);
    await inspectorTab(page, "Report").click();

    const note = page.getByRole("textbox", { name: "Add a review note" });
    const observation = page.getByRole("combobox", { name: "Supporting observation" });
    await expect(note).toHaveAttribute("maxlength", "10000");
    await note.fill("Retain this evidence-bound note if the local write is rejected.");
    await expect(page.getByText("9,937 characters remaining", { exact: true })).toBeVisible();
    await observation.selectOption({ index: 1 });
    const selectedObservation = await observation.inputValue();

    await pauseEditingFromExternalVersion(page);

    await page.getByRole("button", { name: "Add note" }).click();
    await expect(note).toHaveValue(
      "Retain this evidence-bound note if the local write is rejected.",
    );
    await expect(observation).toHaveValue(selectedObservation);
    await expect(page.getByRole("alert").last()).toContainText(/reload|editing is paused/i);
  });

  test("rejected workspace commands keep human-entered drafts open", async ({ page }) => {
    test.setTimeout(60_000);
    await installModelContextPolyfill(page);
    await openDemo(page);
    await seedAgentProposal(page);

    await inspectorTab(page, "Hypotheses").click();
    const initialActiveBranch = page.locator(".branch-item.is-active");
    await initialActiveBranch.getByRole("button", { name: "Assumption" }).click();
    await initialActiveBranch
      .getByRole("textbox", { name: "Alternative assumption" })
      .fill("Seed assumption for edit-retention coverage.");
    await initialActiveBranch.getByRole("button", { name: "Save assumption" }).click();
    await expect(
      initialActiveBranch.getByText("Seed assumption for edit-retention coverage."),
    ).toBeVisible();

    await pauseEditingFromExternalVersion(page);

    const proposalCard = page.locator(".proposal-card");
    await proposalCard.getByText("Adjust exact coordinates", { exact: false }).click();
    const proposedX = proposalCard.getByRole("spinbutton", { name: "X" }).first();
    await proposedX.fill("63.4");
    await proposalCard.getByRole("button", { name: "Save adjustment" }).click();
    await expect(proposedX).toHaveValue("63.4");
    await proposalCard.getByRole("button", { name: "Accept and apply" }).click();
    await expect(page.getByRole("alertdialog", { name: "Apply this proposal?" })).toHaveCount(0);
    await expect(proposedX).toHaveValue("63.4");
    await expect(page.getByRole("alert").last()).toContainText(/reload|editing is paused/i);

    await inspectorTab(page, "Facts").click();
    await page.getByRole("button", { name: "Add observation" }).click();
    const observation = page.getByRole("textbox", { name: "Observation" });
    const observationForm = page.locator("form").filter({ has: observation });
    await observation.fill("Keep this observation while editing is paused.");
    await observationForm.getByRole("button", { name: "Add observation", exact: true }).click();
    await expect(observation).toHaveValue("Keep this observation while editing is paused.");

    await inspectorTab(page, "Questions").click();
    await page.getByRole("button", { name: "Add question" }).click();
    const question = page.getByRole("textbox", { name: "Question" });
    const reason = page.getByRole("textbox", { name: "Why it matters" });
    const questionForm = page.locator("form").filter({ has: question });
    await question.fill("Which source resolves the lane position?");
    await reason.fill("It changes which alternatives remain plausible.");
    await questionForm.getByRole("button", { name: "Add question", exact: true }).click();
    await expect(question).toHaveValue("Which source resolves the lane position?");
    await expect(reason).toHaveValue("It changes which alternatives remain plausible.");

    await page.getByRole("button", { name: "Cancel" }).click();
    const firstOpenQuestion = page.locator(".question-item.is-open").first();
    await firstOpenQuestion.getByRole("button", { name: "Answer" }).click();
    const answer = firstOpenQuestion.getByRole("textbox", { name: "Answer" });
    await answer.fill("Retain this answer until the case can accept it.");
    await firstOpenQuestion.getByRole("button", { name: "Save answer" }).click();
    await expect(answer).toHaveValue("Retain this answer until the case can accept it.");

    await inspectorTab(page, "Hypotheses").click();
    await page.getByRole("button", { name: "Fork hypothesis" }).click();
    const forkName = page.getByRole("textbox", { name: "Branch name" });
    const forkDescription = page.getByRole("textbox", { name: "What changes" });
    await forkName.fill("Retained alternative");
    await forkDescription.fill("Keep this alternative draft after a rejected command.");
    await page.getByRole("button", { name: "Fork reconstruction" }).click();
    await expect(forkName).toHaveValue("Retained alternative");
    await expect(forkDescription).toHaveValue(
      "Keep this alternative draft after a rejected command.",
    );
    await page.getByRole("button", { name: "Cancel" }).click();

    const activeBranch = page.locator(".branch-item.is-active");
    await activeBranch.getByRole("button", { name: "Edit branch" }).click();
    const renamedBranch = activeBranch.getByRole("textbox", { name: "Branch name" });
    await renamedBranch.fill("Retained branch rename");
    await activeBranch.getByRole("button", { name: "Save branch" }).click();
    await expect(renamedBranch).toHaveValue("Retained branch rename");
    await activeBranch.getByRole("button", { name: "Cancel" }).click();

    const existingAssumption = activeBranch.locator(".assumption").first();
    await existingAssumption.getByRole("button", { name: "Edit" }).click();
    const editedAssumption = existingAssumption.getByRole("textbox", {
      name: "Assumption statement",
    });
    await editedAssumption.fill("Retain this edited assumption.");
    await existingAssumption.getByRole("button", { name: "Save assumption" }).click();
    await expect(editedAssumption).toHaveValue("Retain this edited assumption.");
    await existingAssumption.getByRole("button", { name: "Cancel" }).click();

    await activeBranch.getByRole("button", { name: "Assumption" }).click();
    const newAssumption = activeBranch.getByRole("textbox", { name: "Alternative assumption" });
    await newAssumption.fill("Retain this new assumption.");
    await activeBranch.getByRole("button", { name: "Save assumption" }).click();
    await expect(newAssumption).toHaveValue("Retain this new assumption.");

    await page.getByRole("button", { name: "Add timeline event" }).click();
    const eventDialog = page.getByRole("dialog", { name: "Add timeline event" });
    const eventTitle = eventDialog.getByRole("textbox", { name: "Event title" });
    await eventTitle.fill("Retain this timeline event.");
    await eventDialog.getByRole("button", { name: /^Add at / }).click();
    await expect(eventDialog).toBeVisible();
    await expect(eventTitle).toHaveValue("Retain this timeline event.");
    await eventDialog.getByRole("button", { name: "Close event editor" }).click();

    await page.getByRole("button", { name: "Mark impact", exact: true }).click();
    const impactForm = page.getByRole("form", {
      name: "Place approximate impact by coordinates",
    });
    await impactForm.getByRole("spinbutton", { name: "X" }).fill("62.5");
    await impactForm.getByRole("spinbutton", { name: "Y" }).fill("41.5");
    await impactForm.getByRole("button", { name: "Place" }).click();
    await expect(impactForm).toBeVisible();
    await expect(impactForm.getByRole("spinbutton", { name: "X" })).toHaveValue("62.5");
    await expect(impactForm.getByRole("spinbutton", { name: "Y" })).toHaveValue("41.5");
    await impactForm.getByRole("button", { name: "Cancel" }).click();

    const vehicleA = page.getByRole("button", { name: /^Vehicle A, position/ });
    await vehicleA.focus();
    await vehicleA.press("Enter");
    await page.getByRole("button", { name: "Mark damage", exact: true }).click();
    const damageDescription = page.getByRole("textbox", { name: "Neutral description" });
    await damageDescription.fill("Retain this neutral damage description.");
    await page.getByRole("button", { name: "Add marker", exact: true }).click();
    await expect(damageDescription).toHaveValue("Retain this neutral damage description.");
    await page.getByRole("button", { name: "Close damage editor" }).click();

    await inspectorTab(page, "Evidence").click();
    const evidenceDetail = page.locator("section.evidence-detail");
    await evidenceDetail.getByRole("button", { name: /Edit capture time, notes and tags/ }).click();
    const evidenceNotes = evidenceDetail.getByRole("textbox", { name: "Notes" });
    await evidenceNotes.fill("Retain these evidence details.");
    await evidenceDetail.getByRole("button", { name: "Save evidence details" }).click();
    await expect(evidenceNotes).toHaveValue("Retain these evidence details.");
    await evidenceDetail.getByRole("button", { name: "Cancel" }).click();

    const evidenceTarget = evidenceDetail.getByRole("combobox", { name: "Link to case item" });
    await evidenceTarget.selectOption({ index: 1 });
    const selectedEvidenceTarget = await evidenceTarget.inputValue();
    await evidenceDetail.getByRole("button", { name: "Link", exact: true }).click();
    await expect(evidenceTarget).toHaveValue(selectedEvidenceTarget);
  });
});
