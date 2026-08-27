import { expect, test } from "@playwright/test";

test("blocks the application UI and Site Tools when embedded in a frame", async ({ page }) => {
  // Simulate GitHub Pages, which ignores public/_headers. The normal preview server
  // already blocks framing at the response layer with CSP and X-Frame-Options.
  await page.route("**/*", async (route) => {
    const response = await route.fetch();
    const headers = Object.fromEntries(
      Object.entries(response.headers()).filter(
        ([name]) => name !== "content-security-policy" && name !== "x-frame-options",
      ),
    );
    await route.fulfill({ response, headers });
  });
  await page.goto("/");
  await page.evaluate(() => {
    const appUrl = window.location.href;
    document.body.replaceChildren();
    const frame = document.createElement("iframe");
    frame.title = "Embedded REPLAY";
    frame.src = appUrl;
    document.body.append(frame);
  });

  const embedded = page.frameLocator('iframe[title="Embedded REPLAY"]');
  await expect(embedded.getByRole("heading", { name: "Open REPLAY directly" })).toBeVisible();
  await expect(embedded.locator("main.workspace")).toHaveCount(0);
  await expect(embedded.getByRole("link", { name: "Open REPLAY" })).toHaveAttribute(
    "target",
    "_top",
  );
});
