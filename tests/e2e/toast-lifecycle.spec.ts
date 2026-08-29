import { expect, test } from "@playwright/test";

import { openDemo } from "./helpers";

test.describe("toast lifecycle", () => {
  test("an error persists until its accessible dismissal control is used", async ({ page }) => {
    await openDemo(page);
    await page.getByLabel("Import case JSON").setInputFiles({
      name: "invalid-replay.json",
      mimeType: "application/json",
      buffer: Buffer.from("not valid JSON"),
    });

    const alert = page.locator('.toast[role="alert"]');
    await expect(alert).toBeVisible();
    const dismiss = alert.getByRole("button", { name: "Dismiss notification" });
    await expect(dismiss).toBeVisible();

    const isCoarsePointer = await page.evaluate(
      () => matchMedia("(pointer: coarse), (any-pointer: coarse)").matches,
    );
    if (isCoarsePointer) {
      const box = await dismiss.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }

    await page.waitForTimeout(4_500);
    await expect(alert).toBeVisible();
    await dismiss.click();
    await expect(alert).toHaveCount(0);
  });
});
