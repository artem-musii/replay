import { expect, test } from "@playwright/test";

import { openLanding, waitForImages } from "./helpers";

test("captures stable landing and workspace views for each configured viewport", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openLanding(page);
  await waitForImages(page);
  await expect(page.locator(".landing-hero__visual img")).toHaveJSProperty("complete", true);
  await testInfo.attach(`${testInfo.project.name}-landing.png`, {
    body: await page.screenshot({ fullPage: true, animations: "disabled" }),
    contentType: "image/png",
  });

  await page.getByRole("button", { name: /Try the demo case/ }).click();
  await expect(page.locator("main.workspace")).toBeVisible();
  await testInfo.attach(`${testInfo.project.name}-workspace.png`, {
    body: await page.screenshot({ fullPage: true, animations: "disabled" }),
    contentType: "image/png",
  });
});
