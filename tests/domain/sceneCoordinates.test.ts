import { describe, expect, it } from "vitest";

import {
  clampScenePoint,
  createSceneCoordinateMapper,
  formatSceneCoordinate,
} from "../../src/domain/sceneCoordinates";

describe("scene coordinate mapping", () => {
  it("preserves the legacy 0..100 canvas mapping", () => {
    const mapper = createSceneCoordinateMapper(
      { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      1_000,
      700,
    );

    expect(mapper.toView({ x: 28, y: 50 })).toEqual({ x: 280, y: 350 });
    const roundTrip = mapper.fromView({ x: 280, y: 350 });
    expect(roundTrip.x).toBeCloseTo(28, 12);
    expect(roundTrip.y).toBeCloseTo(50, 12);
    expect(mapper.keyboardStep("x")).toBe(0.5);
    expect(mapper.keyboardStep("y", true)).toBe(2);
  });

  it("round-trips negative, nonzero bounds through view and template coordinates", () => {
    const mapper = createSceneCoordinateMapper(
      { minX: -50, minY: 200, maxX: 150, maxY: 500 },
      1_000,
      700,
    );
    const point = { x: -10, y: 425 };

    expect(mapper.toTemplate(point)).toEqual({ x: 20, y: 75 });
    expect(mapper.toView(point)).toEqual({ x: 200, y: 525 });
    expect(mapper.fromView({ x: 200, y: 525 })).toEqual(point);
    expect(mapper.fromTemplate({ x: 20, y: 75 })).toEqual(point);
    expect(mapper.center).toEqual({ x: 50, y: 350 });
    expect(mapper.keyboardStep("x")).toBe(1);
    expect(mapper.keyboardStep("y", true)).toBe(6);
  });

  it("clamps human edits against each imported axis without normalizing source geometry", () => {
    const bounds = { minX: -50, minY: 200, maxX: 150, maxY: 500 };
    const mapper = createSceneCoordinateMapper(bounds, 1_000, 700);

    expect(clampScenePoint({ x: -80, y: 900 }, bounds)).toEqual({ x: -50, y: 500 });
    const diagnosticViewPoint = mapper.toView({ x: -80, y: 900 });
    expect(diagnosticViewPoint.x).toBe(-150);
    expect(diagnosticViewPoint.y).toBeCloseTo(1_633.333, 3);
  });

  it("rejects unusable bounds and formats accessible coordinate values compactly", () => {
    expect(() =>
      createSceneCoordinateMapper({ minX: 4, minY: 0, maxX: 4, maxY: 10 }, 1_000, 700),
    ).toThrow("positive area");
    expect(formatSceneCoordinate(-0.0001)).toBe("0");
    expect(formatSceneCoordinate(-42.12549)).toBe("-42.125");
  });
});
