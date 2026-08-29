import { expect, test, type Locator } from "@playwright/test";

import { exportReplayCase } from "../../src/domain/importExport";
import type { Point } from "../../src/domain/models";
import { createDemoCase } from "../../src/domain/seed";
import { confirmStructuredCaseImport, openDemo } from "./helpers";

const SHIFTED_BOUNDS = { minX: -50, minY: 200, maxX: 150, maxY: 500 } as const;

function shiftPoint(point: Point): void {
  point.x = SHIFTED_BOUNDS.minX + point.x * 2;
  point.y = SHIFTED_BOUNDS.minY + point.y * 3;
}

async function svgPointToClient(
  svg: Locator,
  point: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  return svg.evaluate((element, viewPoint) => {
    const svgElement = element as SVGSVGElement;
    const matrix = svgElement.getScreenCTM();
    if (!matrix) throw new Error("The scene SVG has no screen transform");
    const svgPoint = svgElement.createSVGPoint();
    svgPoint.x = viewPoint.x;
    svgPoint.y = viewPoint.y;
    const clientPoint = svgPoint.matrixTransform(matrix);
    return { x: clientPoint.x, y: clientPoint.y };
  }, point);
}

test("renders and edits an imported scene with negative, nonzero bounds", async ({ page }) => {
  await openDemo(page);

  const imported = createDemoCase();
  imported.title = "Shifted coordinate incident";
  imported.environment.roadPolygon.forEach(shiftPoint);
  imported.environment.roadPolygon = [
    { x: -40, y: 215 },
    { x: 140, y: 215 },
    { x: 130, y: 485 },
    { x: -30, y: 485 },
  ];
  imported.actors.forEach((actor) => shiftPoint(actor.pose));
  imported.trajectories.forEach((trajectory) => trajectory.keyframes.forEach(shiftPoint));
  imported.timelineEvents.forEach((event) => {
    if (event.location) shiftPoint(event.location);
  });
  imported.environment.bounds = { ...SHIFTED_BOUNDS };

  await page.getByLabel("Import case JSON").setInputFiles({
    name: "shifted-coordinate-incident.replay.json",
    mimeType: "application/json",
    buffer: Buffer.from(exportReplayCase(imported)),
  });
  await confirmStructuredCaseImport(page);

  await expect(page.getByText("Shifted coordinate incident", { exact: true })).toBeVisible();
  const scene = page.locator(".scene-svg");
  await expect(scene).toHaveAccessibleName(
    /Scene coordinates span X -50 through 150 and Y 200 through 500/,
  );
  await expect(page.getByTestId("configured-road-boundary")).toHaveAttribute(
    "points",
    "50,35 950,35 900,665 100,665",
  );
  await expect(page.getByText("Configured road boundary", { exact: true })).toBeVisible();

  const vehicleA = page.getByRole("button", { name: /^Vehicle A, position/ });
  await expect(vehicleA).toHaveAttribute("transform", "translate(280 350)");
  await expect(vehicleA).toHaveAccessibleName(/scene coordinate X 6 and Y 350/);

  await page.getByRole("button", { name: "Fit scene" }).click();
  await expect(scene).toHaveAttribute("viewBox", "0 0 1000 700");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(scene).not.toHaveAttribute("viewBox", "0 0 1000 700");
  await page.getByRole("button", { name: "Fit scene" }).click();
  if (test.info().project.name === "chromium-desktop") {
    const panStart = await svgPointToClient(scene, { x: 60, y: 60 });
    await page.mouse.move(panStart.x, panStart.y);
    await page.mouse.down();
    await page.mouse.move(panStart.x + 40, panStart.y + 20, { steps: 3 });
    await page.mouse.up();
    await expect(scene).not.toHaveAttribute("viewBox", "0 0 1000 700");
    await page.getByRole("button", { name: "Fit scene" }).click();
  }
  await expect(scene).toHaveAttribute("viewBox", "0 0 1000 700");

  await vehicleA.focus();
  await vehicleA.press("Enter");
  const vehicleEditor = page.getByRole("region", { name: "Vehicle A" });
  const actorX = vehicleEditor.getByLabel("X position");
  const actorY = vehicleEditor.getByLabel("Y position");
  await expect(actorX).toHaveAttribute("min", "-50");
  await expect(actorX).toHaveAttribute("max", "150");
  await expect(actorY).toHaveAttribute("min", "200");
  await expect(actorY).toHaveAttribute("max", "500");
  await actorX.fill("-42.5");
  await actorY.fill("488.5");
  await vehicleEditor.getByRole("button", { name: "Apply exact pose" }).click();
  await expect(vehicleA).toHaveAccessibleName(/scene coordinate X -42\.5 and Y 488\.5/);

  await vehicleA.focus();
  await vehicleA.press("ArrowRight");
  await expect(vehicleA).toHaveAccessibleName(/scene coordinate X -41\.5 and Y 488\.5/);

  if (test.info().project.name === "chromium-desktop") {
    const laneSnap = page.getByRole("button", { name: /Lane snap while dragging/i });
    if ((await laneSnap.getAttribute("aria-pressed")) === "true") await laneSnap.click();
    const body = vehicleA.locator(".vehicle-body");
    const bodyBox = await body.boundingBox();
    if (!bodyBox) throw new Error("Vehicle A did not render a draggable body");
    const dragTarget = await svgPointToClient(scene, { x: 150, y: 525 });
    await page.mouse.move(bodyBox.x + bodyBox.width / 2, bodyBox.y + bodyBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(dragTarget.x, dragTarget.y, { steps: 4 });
    await page.mouse.up();
    await expect(vehicleA).toHaveAccessibleName(/scene coordinate X -20 and Y 425/);
  }

  await vehicleA.focus();
  await vehicleA.press("Enter");
  await page.getByRole("button", { name: "Edit path" }).click();
  const firstPoint = page.locator(".keyframe-editor").first();
  const pointX = firstPoint.getByLabel("X", { exact: true });
  const pointY = firstPoint.getByLabel("Y", { exact: true });
  await expect(pointX).toHaveAttribute("min", "-50");
  await expect(pointX).toHaveAttribute("max", "150");
  await expect(pointY).toHaveAttribute("min", "200");
  await expect(pointY).toHaveAttribute("max", "500");
  await pointX.fill("-45");
  await pointY.fill("225");
  await firstPoint.getByRole("button", { name: "Apply point" }).click();
  await expect(pointX).toHaveValue("-45");
  await expect(pointY).toHaveValue("225");

  await page.getByRole("button", { name: "Fit scene" }).click();
  await page.getByRole("button", { name: "Mark impact", exact: true }).click();
  const impactClientPoint = await svgPointToClient(scene, { x: 200, y: 525 });
  await page.mouse.click(impactClientPoint.x, impactClientPoint.y);
  const impact = page.getByRole("button", { name: /^Approximate impact at/ });
  await expect(impact).toHaveAccessibleName(/scene coordinate X -10/);
  await impact.focus();
  await impact.press("Enter");
  const eventEditor = page.getByRole("region", { name: "Approximate contact" });
  await expect(eventEditor.getByLabel("X location")).toHaveAttribute("min", "-50");
  await expect(eventEditor.getByLabel("X location")).toHaveAttribute("max", "150");
  await expect(eventEditor.getByLabel("Y location")).toHaveAttribute("min", "200");
  await expect(eventEditor.getByLabel("Y location")).toHaveAttribute("max", "500");
  await expect
    .poll(async () =>
      Math.abs(Number(await eventEditor.getByLabel("X location").inputValue()) + 10),
    )
    .toBeLessThan(1);
  await expect
    .poll(async () =>
      Math.abs(Number(await eventEditor.getByLabel("Y location").inputValue()) - 425),
    )
    .toBeLessThan(1);
});
