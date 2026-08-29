import { expect, test, type Locator, type Page } from "@playwright/test";

import { openLanding } from "./helpers";

const SHORT_VIEWPORTS = [
  { width: 320, height: 480 },
  { width: 568, height: 320 },
] as const;

async function expectInsideViewport(page: Page, locator: Locator): Promise<void> {
  const viewport = page.viewportSize();
  const box = await locator.boundingBox();
  if (!viewport || !box) throw new Error("Onboarding control geometry is unavailable.");
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

test.describe("short viewport onboarding", () => {
  test("keeps guide content scrollable and every fixed control reachable at 200% text", async ({
    page,
  }) => {
    for (const viewport of SHORT_VIEWPORTS) {
      await page.setViewportSize(viewport);
      await openLanding(page);
      await page.addStyleTag({ content: "html { font-size: 32px !important; }" });
      await page.getByRole("button", { name: "How to use REPLAY" }).click();

      const guide = page.getByRole("dialog", { name: "Learn REPLAY" });
      await expect(
        guide.getByRole("heading", { name: "See one account from several useful angles" }),
      ).toBeVisible();
      const geometry = await guide.evaluate((dialog) => {
        const nav = dialog.querySelector<HTMLElement>(".guide-topics");
        const content = dialog.querySelector<HTMLElement>(".guide-content");
        const footer = dialog.querySelector<HTMLElement>(".guide-panel__footer");
        if (!nav || !content || !footer) throw new Error("Guide regions are unavailable.");
        const navBox = nav.getBoundingClientRect();
        const contentBox = content.getBoundingClientRect();
        const footerBox = footer.getBoundingClientRect();
        return {
          contentHeight: content.clientHeight,
          contentScrollHeight: content.scrollHeight,
          navBottom: navBox.bottom,
          contentTop: contentBox.top,
          contentBottom: contentBox.bottom,
          footerTop: footerBox.top,
        };
      });

      expect(geometry.contentHeight).toBeGreaterThanOrEqual(96);
      expect(geometry.contentScrollHeight).toBeGreaterThan(geometry.contentHeight);
      expect(geometry.contentTop).toBeGreaterThanOrEqual(geometry.navBottom - 1);
      expect(geometry.contentBottom).toBeLessThanOrEqual(geometry.footerTop + 1);

      const fixedControls = guide.locator(".guide-panel__close, .guide-panel__footer button");
      await expect(fixedControls).toHaveCount(4);
      for (let index = 0; index < (await fixedControls.count()); index += 1) {
        await expectInsideViewport(page, fixedControls.nth(index));
      }

      await guide.getByRole("button", { name: "Close REPLAY guide" }).click();
    }
  });

  test("keeps fixed tour controls onscreen and try actions reachable at 200% text", async ({
    page,
  }) => {
    for (const viewport of SHORT_VIEWPORTS) {
      await page.setViewportSize(viewport);
      await openLanding(page);
      await page.addStyleTag({ content: "html { font-size: 32px !important; }" });
      await page.getByRole("button", { name: "Take the 6-step guided tour" }).click();

      const tour = page.locator(".workspace-tour");
      for (let step = 1; step <= 6; step += 1) {
        await expect(tour.getByText(`Step ${String(step)} of 6`)).toBeVisible();
        await expectInsideViewport(page, tour);
        const fixedControls = tour.locator(":scope > header button, :scope > footer button");
        for (let index = 0; index < (await fixedControls.count()); index += 1) {
          await expectInsideViewport(page, fixedControls.nth(index));
        }
        const tryAction = tour.locator(".workspace-tour__try");
        if ((await tryAction.count()) > 0) {
          await tryAction.scrollIntoViewIfNeeded();
          await expectInsideViewport(page, tryAction);
        }
        if (step < 6) await tour.getByRole("button", { name: "Next" }).click();
      }

      await tour.getByRole("button", { name: "Finish tour" }).click();
    }
  });
});
