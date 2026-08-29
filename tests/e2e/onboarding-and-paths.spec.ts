import { expect, test, type Locator, type Page } from "@playwright/test";

import { installModelContextPolyfill, openDemo, openLanding } from "./helpers";

async function expectInsideViewport(page: Page, locator: Locator): Promise<void> {
  const viewport = page.viewportSize();
  const box = await locator.boundingBox();
  if (!viewport || !box) throw new Error("Responsive control geometry is unavailable.");
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function openVehicleAPath(page: Page): Promise<Locator> {
  const vehicle = page.getByRole("button", { name: /^Vehicle A, position/ });
  await vehicle.focus();
  await vehicle.press("Enter");
  await page.getByRole("button", { name: "Edit path" }).click();
  const editor = page.getByRole("region", { name: "Vehicle A" });
  await expect(
    editor.getByText("A path point is the vehicle’s pose at a specific time."),
  ).toBeVisible();
  return editor;
}

async function expectTrajectoryFieldsFit(editor: Locator): Promise<void> {
  const editorGeometry = await editor.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      left: rect.left,
      right: rect.right,
    };
  });
  const geometry = await editor.locator(".keyframe-editor").evaluateAll((forms) =>
    forms.map((form) => {
      const formRect = form.getBoundingClientRect();
      const inputs = [...form.querySelectorAll<HTMLInputElement>("input")].map((input) => {
        const rect = input.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
      return {
        clientWidth: form.clientWidth,
        scrollWidth: form.scrollWidth,
        formLeft: formRect.left,
        formRight: formRect.right,
        inputs,
      };
    }),
  );

  expect(editorGeometry.scrollWidth).toBeLessThanOrEqual(editorGeometry.clientWidth + 1);
  expect(geometry.length).toBeGreaterThan(1);
  for (const form of geometry) {
    expect(form.formLeft).toBeGreaterThanOrEqual(editorGeometry.left - 1);
    expect(form.formRight).toBeLessThanOrEqual(editorGeometry.right + 1);
    expect(form.scrollWidth).toBeLessThanOrEqual(form.clientWidth + 1);
    for (const input of form.inputs) {
      expect(input.left).toBeGreaterThanOrEqual(form.formLeft - 1);
      expect(input.right).toBeLessThanOrEqual(form.formRight + 1);
    }
    for (let leftIndex = 0; leftIndex < form.inputs.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < form.inputs.length; rightIndex += 1) {
        const left = form.inputs[leftIndex];
        const right = form.inputs[rightIndex];
        if (!left || !right) continue;
        const overlapsHorizontally = left.left < right.right && left.right > right.left;
        const overlapsVertically = left.top < right.bottom && left.bottom > right.top;
        expect(overlapsHorizontally && overlapsVertically).toBe(false);
      }
    }
  }
}

test.describe("onboarding and path authoring", () => {
  test("opens complete help from the landing page and starts a mutation-free tour", async ({
    page,
  }) => {
    await openLanding(page);
    await page.getByRole("button", { name: "How to use REPLAY" }).click();

    let guide = page.getByRole("dialog", { name: "Learn REPLAY" });
    await expect(
      guide.getByRole("heading", { name: "See one account from several useful angles" }),
    ).toBeVisible();
    await guide.getByRole("button", { name: "Site Tools" }).click();
    await expect(
      guide.getByRole("heading", { name: "Work manually or invite an agent into the same case" }),
    ).toBeVisible();
    await expect(guide.getByText(/WebMCP is the browser bridge behind Site Tools/)).toBeVisible();
    await expect(guide.getByRole("button", { name: /^Copy prompt:/ })).toHaveCount(3);
    await guide.getByRole("button", { name: "Close REPLAY guide" }).click();

    await page.getByRole("button", { name: "Take the 6-step guided tour" }).click();
    await expect(page.locator("main.workspace")).toBeVisible();
    const tour = page.locator(".workspace-tour");
    await expect(tour.getByText("Step 1 of 6")).toBeVisible();
    await expect(page.locator('[data-onboarding-id="scene-editor"]')).toHaveAttribute(
      "data-onboarding-active",
      "true",
    );
    await expect(page.locator(".workspace-case-title small")).toHaveText("v1");

    for (let step = 2; step <= 6; step += 1) {
      await tour.getByRole("button", { name: "Next" }).click();
      await expect(tour.getByText(`Step ${String(step)} of 6`)).toBeVisible();
    }
    await tour.getByRole("button", { name: "Finish tour" }).click();
    await expect(tour).toHaveCount(0);
    await expect(page.locator(".workspace-case-title small")).toHaveText("v1");

    await page.getByRole("button", { name: "Open REPLAY guide" }).click();
    guide = page.getByRole("dialog", { name: "Learn REPLAY" });
    await expect(guide.getByRole("button", { name: "Start 6-step workspace tour" })).toBeVisible();
  });

  test("turns the guided demo into a mutation-free impact, report, and Site Tools tryout", async ({
    page,
  }) => {
    await installModelContextPolyfill(page);
    await openLanding(page);
    await page.getByRole("button", { name: "Take the 6-step guided tour" }).click();
    const tour = page.locator(".workspace-tour");
    const version = page.locator(".workspace-case-title small");

    await tour.getByRole("button", { name: "Jump to approximate contact" }).click();
    await expect(page.getByRole("status", { name: "Current timeline position" })).toContainText(
      "0:10.0",
    );
    await expect(version).toHaveText("v1");

    await tour.getByRole("button", { name: "Next" }).click();
    await tour.getByRole("button", { name: "Play authored impact response" }).click();
    await expect(page.getByRole("button", { name: "Pause reconstruction" })).toBeVisible();
    await expect(version).toHaveText("v1");

    await tour.getByRole("button", { name: "Next" }).click();
    await tour.getByRole("button", { name: "Build report preview" }).click();
    await expect(page.getByRole("tabpanel", { name: "Report" })).toContainText(
      "Draft — not finalized",
    );
    await expect(version).toHaveText("v1");

    await tour.getByRole("button", { name: "Next" }).click();
    await tour.getByRole("button", { name: "Next" }).click();
    await tour.getByRole("button", { name: "Open Site Tools proof" }).click();
    await expect(tour).toHaveCount(0);
    const guide = page.getByRole("dialog", { name: "Learn REPLAY" });
    await expect(
      guide.getByRole("heading", { name: "30 seconds from structured read to review" }),
    ).toBeVisible();
    await expect(
      guide.getByRole("button", { name: "Copy prompt: Review the unresolved lane question" }),
    ).toBeVisible();
    await expect(version).toHaveText("v1");
  });

  test("explains a live WebMCP connection where the user expects to find it", async ({ page }) => {
    await installModelContextPolyfill(page);
    await openDemo(page);
    const status = page.locator("button.webmcp-status");
    await expect(status).toContainText(/\d+ registered/, { timeout: 10_000 });
    await status.click();

    const guide = page.getByRole("dialog", { name: "Learn REPLAY" });
    await expect(guide.getByText(/\d+ Site Tools registered/)).toBeVisible();
    await expect(
      guide.getByText(/Confirm discovery in Available Site Tools and real calls/),
    ).toBeVisible();
    await expect(
      guide.getByRole("heading", { name: "30 seconds from structured read to review" }),
    ).toBeVisible();
    await expect(
      guide.getByRole("button", { name: "Copy prompt: Review the unresolved lane question" }),
    ).toBeVisible();
    await expect(
      guide.getByText(/Ask in that client’s conversation, not on the REPLAY page/),
    ).toBeVisible();
    await expect(
      guide.getByRole("button", { name: "Open technical Site Tools inspector" }),
    ).toBeVisible();
  });

  test("adds, synchronizes, and removes an explicit path point", async ({ page }) => {
    await openDemo(page);
    let editor = await openVehicleAPath(page);
    const initialPointCount = await editor.locator(".keyframe-editor").count();
    expect(initialPointCount).toBeGreaterThan(5);
    const versionBefore = Number(
      (await page.locator(".workspace-case-title small").textContent())?.replace("v", ""),
    );

    await page.getByRole("slider", { name: "Timeline position" }).fill("7000");
    await editor.getByRole("button", { name: "Add point at 7.0s" }).click();
    editor = page.getByRole("region", { name: "Vehicle A" });
    await expect(editor.locator(".keyframe-editor")).toHaveCount(initialPointCount + 1);
    await expect(editor.locator(".keyframe-editor.is-active")).toContainText("7.0s");
    await expect(page.locator(".timeline-keyframe.is-selected")).toHaveCount(1);
    await expect(page.locator(".trajectory__handle.is-active")).toHaveCount(1);

    await editor
      .locator(".keyframe-editor.is-active")
      .getByRole("button", { name: /Remove point/ })
      .click();
    await expect(editor.locator(".keyframe-editor")).toHaveCount(initialPointCount);
    await expect(page.locator(".workspace-case-title small")).toHaveText(
      `v${String(versionBefore + 2)}`,
    );
  });

  test("keeps trajectory fields contained at narrow widths and 200% text", async ({ page }) => {
    await openDemo(page);
    const editor = await openVehicleAPath(page);
    await expectTrajectoryFieldsFit(editor);

    await page.setViewportSize({ width: 320, height: 900 });
    await expectTrajectoryFieldsFit(editor);

    await page.setViewportSize({ width: 546, height: 900 });
    await page.addStyleTag({ content: "html { font-size: 32px !important; }" });
    await expectTrajectoryFieldsFit(editor);
    const firstInputWidths = await editor
      .locator(".keyframe-editor")
      .first()
      .locator("input")
      .evaluateAll((inputs) => inputs.map((input) => input.getBoundingClientRect().width));
    expect(Math.min(...firstInputWidths)).toBeGreaterThan(180);

    await page.setViewportSize({ width: 320, height: 900 });
    await expectTrajectoryFieldsFit(editor);
  });

  test("reflows the complete landing page at 320px with 200% text", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await openLanding(page);
    await page.addStyleTag({ content: "html { font-size: 32px !important; }" });

    const geometry = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth;
      const containedSelectors = [
        ".landing",
        ".landing-nav",
        ".landing-hero",
        ".landing-hero__copy",
        ".landing-steps",
        ".landing-step",
        ".collaboration-section",
        ".collaboration-loop li",
        ".privacy-section",
        ".landing-closing",
        ".landing-footer",
      ].join(",");
      const visibleSelectors = [
        containedSelectors,
        ".landing-hero__visual",
        ".landing-hero__frame",
        ".landing-step > *",
        ".collaboration-loop li > *",
        ".landing-footer > *",
      ].join(",");
      const measure = (element: Element) => {
        const htmlElement = element as HTMLElement;
        const rect = htmlElement.getBoundingClientRect();
        return {
          className:
            typeof htmlElement.className === "string" ? htmlElement.className : htmlElement.tagName,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
          clientWidth: htmlElement.clientWidth,
          scrollWidth: htmlElement.scrollWidth,
        };
      };
      return {
        viewportWidth,
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        contained: [...document.querySelectorAll(containedSelectors)].map(measure),
        visible: [...document.querySelectorAll(visibleSelectors)].map(measure),
      };
    });

    expect(geometry.documentScrollWidth).toBeLessThanOrEqual(geometry.documentClientWidth);
    for (const element of geometry.contained) {
      expect(
        element.scrollWidth,
        `${element.className} should not hide horizontal content`,
      ).toBeLessThanOrEqual(element.clientWidth + 1);
    }
    for (const element of geometry.visible) {
      if (element.width === 0 || element.height === 0) continue;
      expect(
        element.left,
        `${element.className} should start inside the viewport`,
      ).toBeGreaterThanOrEqual(-1);
      expect(
        element.right,
        `${element.className} should end inside the viewport`,
      ).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    }
  });

  test("keeps the primary demo action and Site Tools discoverable on compact screens", async ({
    page,
  }) => {
    await installModelContextPolyfill(page);

    for (const viewport of [
      { width: 320, height: 568 },
      { width: 375, height: 667 },
    ]) {
      await page.setViewportSize(viewport);
      await openLanding(page);
      await expectInsideViewport(page, page.getByRole("button", { name: "Open Roundabout demo" }));
    }

    await page.setViewportSize({ width: 768, height: 900 });
    await openDemo(page);
    const status = page.locator("button.webmcp-status");
    const compactLabel = status.locator(".webmcp-status__compact");
    await expect(compactLabel).toBeVisible();
    await expect(compactLabel).toHaveText("Tools");
    await expect(page.getByRole("note")).toContainText("Compact view prioritizes review.");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(compactLabel).toBeVisible();
    await expectInsideViewport(page, status);
  });

  test("keeps retained-recovery controls clear of landing help", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await openLanding(page);
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open("replay-local-vault-v2");
          request.onerror = () => reject(request.error ?? new Error("Could not open local vault."));
          request.onsuccess = () => {
            const database = request.result;
            const transaction = database.transaction("cases", "readwrite");
            transaction.objectStore("cases").put({
              id: "case-retained-recovery",
              updatedAt: 42,
              schemaVersion: 2,
              payload: { id: "case-retained-recovery" },
            });
            transaction.oncomplete = () => {
              database.close();
              resolve();
            };
            transaction.onerror = () =>
              reject(transaction.error ?? new Error("Could not seed retained recovery."));
          };
        }),
    );

    await page.reload();
    await page.addStyleTag({ content: "html { font-size: 32px !important; }" });
    const notice = page.getByRole("alert");
    const navigation = page.getByRole("navigation", { name: "Primary navigation" });
    const help = page.getByRole("button", { name: "How to use REPLAY" });
    await expect(notice).toBeVisible();

    const [noticeBox, navigationBox, helpBox] = await Promise.all([
      notice.boundingBox(),
      navigation.boundingBox(),
      help.boundingBox(),
    ]);
    if (!noticeBox || !navigationBox || !helpBox) {
      throw new Error("Recovery-notice geometry is unavailable.");
    }
    expect(noticeBox.y).toBeGreaterThanOrEqual(navigationBox.y + navigationBox.height);
    expect(helpBox.x + helpBox.width).toBeLessThanOrEqual(320);

    await help.click();
    await expect(page.getByRole("dialog", { name: "Learn REPLAY" })).toBeVisible();
  });

  test("keeps mobile help and every tour control visible at 200% text", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await openLanding(page);
    await page.addStyleTag({ content: "html { font-size: 32px !important; }" });

    const guidedDemo = page.getByRole("button", { name: "Take the 6-step guided tour" });
    const guidedBox = await guidedDemo.boundingBox();
    if (!guidedBox) throw new Error("Guided tour control is unavailable.");
    expect(guidedBox.x).toBeGreaterThanOrEqual(0);
    expect(guidedBox.x + guidedBox.width).toBeLessThanOrEqual(320);
    expect(guidedBox.height).toBeGreaterThanOrEqual(44);

    await page.getByRole("button", { name: "How to use REPLAY" }).click();
    const guide = page.getByRole("dialog", { name: "Learn REPLAY" });
    const closeGuide = guide.getByRole("button", { name: "Close REPLAY guide" });
    const [closeBox, guideBox] = await Promise.all([closeGuide.boundingBox(), guide.boundingBox()]);
    if (!closeBox || !guideBox) throw new Error("Guide close control is unavailable.");
    expect(closeBox.width).toBeGreaterThanOrEqual(44);
    expect(closeBox.height).toBeGreaterThanOrEqual(44);
    expect(closeBox.x).toBeGreaterThanOrEqual(guideBox.x - 1);
    expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(guideBox.x + guideBox.width + 1);

    for (let index = 0; index < 5; index += 1) {
      await guide.getByRole("button", { name: "Next topic" }).click();
    }
    await expect(
      guide.getByRole("heading", { name: "Work manually or invite an agent into the same case" }),
    ).toBeVisible();
    await expect(guide.getByRole("button", { name: "Previous" })).toBeVisible();
    const topicNav = guide.getByRole("navigation", { name: "REPLAY help topics" });
    const activeTopic = topicNav.getByRole("button", { name: "Site Tools" });
    const [navBox, activeBox] = await Promise.all([
      topicNav.boundingBox(),
      activeTopic.boundingBox(),
    ]);
    if (!navBox || !activeBox) throw new Error("Guide topic geometry is unavailable.");
    expect(activeBox.x).toBeGreaterThanOrEqual(navBox.x - 1);
    expect(activeBox.x + activeBox.width).toBeLessThanOrEqual(navBox.x + navBox.width + 1);
    const footerGeometry = await guide.locator(".guide-panel__footer").evaluate((footer) => {
      const footerRect = footer.getBoundingClientRect();
      return {
        clientWidth: footer.clientWidth,
        scrollWidth: footer.scrollWidth,
        left: footerRect.left,
        right: footerRect.right,
        buttons: [...footer.querySelectorAll("button")].map((button) => {
          const rect = button.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        }),
      };
    });
    expect(footerGeometry.scrollWidth).toBeLessThanOrEqual(footerGeometry.clientWidth + 1);
    for (const button of footerGeometry.buttons) {
      expect(button.left).toBeGreaterThanOrEqual(footerGeometry.left - 1);
      expect(button.right).toBeLessThanOrEqual(footerGeometry.right + 1);
    }
    await closeGuide.click();

    await guidedDemo.click();
    const tour = page.locator(".workspace-tour");
    await expect(tour).toBeFocused();
    for (let step = 1; step <= 6; step += 1) {
      await expect(tour.getByText(`Step ${String(step)} of 6`)).toBeVisible();
      const [tourBox, headerBox, footerBox] = await Promise.all([
        tour.boundingBox(),
        tour.locator(":scope > header").boundingBox(),
        tour.locator(":scope > footer").boundingBox(),
      ]);
      if (!tourBox || !headerBox || !footerBox) throw new Error("Tour geometry is unavailable.");
      expect(headerBox.y).toBeGreaterThanOrEqual(tourBox.y - 1);
      expect(footerBox.y + footerBox.height).toBeLessThanOrEqual(tourBox.y + tourBox.height + 1);
      if (step < 6) {
        const next = tour.getByRole("button", { name: "Next" });
        await next.click();
        if (step < 5) await expect(next).toBeFocused();
        else await expect(tour.getByRole("button", { name: "Finish tour" })).toBeFocused();
      }
    }
    await tour.getByRole("button", { name: "Finish tour" }).click();
    await expect(page.getByRole("button", { name: "Open REPLAY guide" })).toBeFocused();
  });

  test("supports quick and direct pointer rotation with compass headings", async ({ page }) => {
    await openDemo(page);
    const vehicle = page.getByRole("button", { name: /^Vehicle A, position/ });
    await vehicle.focus();
    await vehicle.press("Enter");
    const editor = page.getByRole("region", { name: "Vehicle A" });
    const rotationInput = editor.getByLabel("Rotation °");
    const initialRotation = Number(await rotationInput.inputValue());

    await editor.getByRole("button", { name: "Rotate Vehicle A right 15 degrees" }).click();
    await expect
      .poll(async () => Number(await rotationInput.inputValue()))
      .toBeCloseTo(initialRotation + 15, 5);
    await expect(
      page.getByRole("button", { name: /Vehicle A, position.*orientation 161 degrees/ }),
    ).toBeVisible();

    const knob = page.locator(".scene-vehicle.is-selected .vehicle-rotation-control__hit");
    const body = page.locator(".scene-vehicle.is-selected .vehicle-body");
    await knob.scrollIntoViewIfNeeded();
    const knobBox = await knob.boundingBox();
    const bodyBox = await body.boundingBox();
    if (!knobBox || !bodyBox) throw new Error("Vehicle rotation geometry is unavailable.");
    await page.mouse.move(knobBox.x + knobBox.width / 2, knobBox.y + knobBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(bodyBox.x + bodyBox.width / 2 + 120, bodyBox.y + bodyBox.height / 2);
    await page.mouse.up();

    const rotation = Number(await editor.getByLabel("Rotation °").inputValue());
    expect(rotation).toBeGreaterThanOrEqual(88);
    expect(rotation).toBeLessThanOrEqual(92);
  });

  test("keeps keyboard nudges precise even when drag lane snap is enabled", async ({ page }) => {
    await openDemo(page);
    const vehicle = page.getByRole("button", { name: /^Vehicle A, position/ });
    await vehicle.focus();
    await vehicle.press("ArrowRight");
    await expect(
      page.getByRole("button", {
        name: /Vehicle A, position 28\.5 metres east and 35\.0 metres south/,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^Vehicle A, position/ }).press("ArrowLeft");
    await expect(
      page.getByRole("button", {
        name: /Vehicle A, position 28\.0 metres east and 35\.0 metres south/,
      }),
    ).toBeVisible();
  });
});
