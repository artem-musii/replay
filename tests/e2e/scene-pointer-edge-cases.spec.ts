import { expect, test, type Locator, type Page } from "@playwright/test";

import { openDemo } from "./helpers";

async function centerOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Expected element to have a bounding box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function editVehicleAPath(page: Page): Promise<Locator> {
  const vehicle = page.getByRole("button", { name: /^Vehicle A, position/ });
  await vehicle.focus();
  await vehicle.press("Enter");
  await page.getByRole("button", { name: "Edit path" }).click();
  const point = page.getByRole("button", { name: /^Path point 1 for Vehicle A/ });
  await expect(point).toBeVisible();
  return point;
}

test.describe("scene pointer edge cases", () => {
  test("impact placement wins over a path point under a vehicle", async ({ page }) => {
    await openDemo(page);
    const point = await editVehicleAPath(page);
    const impact = page.locator(".impact-marker");
    const impactBefore = await impact.getAttribute("transform");
    const pointCenter = await centerOf(point);

    await page.getByRole("button", { name: "Mark impact" }).click();
    await page.mouse.click(pointCenter.x, pointCenter.y);

    await expect(impact).not.toHaveAttribute("transform", impactBefore ?? "");
    await expect(page.locator(".scene-svg")).not.toHaveClass(/is-placing-impact/);
    await expect(point).toHaveAttribute("aria-pressed", "false");
  });

  test("overlapping vehicle hit areas select the nearest vehicle at 320px", async ({ page }) => {
    await openDemo(page);
    await page.setViewportSize({ width: 320, height: 900 });

    const vehicleA = page.getByRole("button", { name: /^Vehicle A, position/ });
    const vehicleB = page.getByRole("button", { name: /^Vehicle B, position/ });

    const aCenter = await centerOf(vehicleA.locator(".vehicle-body"));
    await page.mouse.click(aCenter.x, aCenter.y);
    await expect(vehicleA).toHaveAttribute("aria-pressed", "true");

    const bCenter = await centerOf(vehicleB.locator(".vehicle-body"));
    await page.mouse.click(bCenter.x, bCenter.y);
    await expect(vehicleB).toHaveAttribute("aria-pressed", "true");
  });

  test("a selected path point remains draggable when a vehicle covers it", async ({ page }) => {
    await openDemo(page);
    const point = await editVehicleAPath(page);
    await page.getByRole("button", { name: /Lane snap while dragging/i }).click();

    const pointGroup = point.locator("xpath=..");
    const before = await pointGroup.getAttribute("transform");
    const start = await centerOf(point);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 48, start.y + 24, { steps: 4 });
    await page.mouse.up();

    await expect(pointGroup).not.toHaveAttribute("transform", before ?? "");
    await expect(point).toHaveAttribute("aria-pressed", "true");
  });

  test("a secondary pointer cannot move or end the active drag", async ({ page }) => {
    await openDemo(page);
    await page.getByRole("button", { name: /Lane snap while dragging/i }).click();

    const vehicle = page.getByRole("button", { name: /^Vehicle A, position/ });
    const before = await vehicle.getAttribute("transform");
    const start = await centerOf(vehicle.locator(".vehicle-body"));
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();

    await page.locator(".scene-svg").evaluate((svg, point) => {
      svg.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          buttons: 1,
          clientX: point.x + 180,
          clientY: point.y + 100,
          isPrimary: false,
          pointerId: 22,
          pointerType: "touch",
        }),
      );
      svg.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: point.x + 180,
          clientY: point.y + 100,
          isPrimary: false,
          pointerId: 22,
          pointerType: "touch",
        }),
      );
    }, start);

    await expect(vehicle).toHaveAttribute("transform", before ?? "");
    await page.mouse.move(start.x + 40, start.y + 20, { steps: 3 });
    await page.mouse.up();
    await expect(vehicle).not.toHaveAttribute("transform", before ?? "");
  });
});
