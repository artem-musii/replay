import type { EnvironmentState, Point } from "./models";

export type SceneBounds = EnvironmentState["bounds"];

export interface SceneCoordinateMapper {
  readonly bounds: SceneBounds;
  readonly center: Point;
  readonly spanX: number;
  readonly spanY: number;
  toView(point: Point): Point;
  fromView(point: Point): Point;
  toTemplate(point: Point): Point;
  fromTemplate(point: Point): Point;
  clamp(point: Point): Point;
  keyboardStep(axis: "x" | "y", coarse?: boolean): number;
}

export function clampScenePoint(point: Point, bounds: SceneBounds): Point {
  return {
    x: Math.max(bounds.minX, Math.min(bounds.maxX, point.x)),
    y: Math.max(bounds.minY, Math.min(bounds.maxY, point.y)),
  };
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return value;
}

/**
 * Creates the UI mapping between an imported scene's coordinate domain and the
 * fixed SVG/template viewport. Mapping is affine and intentionally unclamped;
 * callers can keep out-of-bounds source geometry visible for diagnosis, then
 * clamp only direct human edits.
 */
export function createSceneCoordinateMapper(
  inputBounds: SceneBounds,
  viewWidth: number,
  viewHeight: number,
): SceneCoordinateMapper {
  const bounds = {
    minX: finite(inputBounds.minX, "Scene minimum X"),
    minY: finite(inputBounds.minY, "Scene minimum Y"),
    maxX: finite(inputBounds.maxX, "Scene maximum X"),
    maxY: finite(inputBounds.maxY, "Scene maximum Y"),
  };
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  if (spanX <= 0 || spanY <= 0) throw new RangeError("Scene bounds must have positive area");
  finite(viewWidth, "Scene view width");
  finite(viewHeight, "Scene view height");
  if (viewWidth <= 0 || viewHeight <= 0) {
    throw new RangeError("Scene view dimensions must be positive");
  }

  const toTemplate = (point: Point): Point => ({
    x: ((point.x - bounds.minX) / spanX) * 100,
    y: ((point.y - bounds.minY) / spanY) * 100,
  });
  const fromTemplate = (point: Point): Point => ({
    x: bounds.minX + (point.x / 100) * spanX,
    y: bounds.minY + (point.y / 100) * spanY,
  });

  return {
    bounds,
    center: { x: bounds.minX + spanX / 2, y: bounds.minY + spanY / 2 },
    spanX,
    spanY,
    toView(point) {
      const templatePoint = toTemplate(point);
      return {
        x: (templatePoint.x / 100) * viewWidth,
        y: (templatePoint.y / 100) * viewHeight,
      };
    },
    fromView(point) {
      return fromTemplate({
        x: (point.x / viewWidth) * 100,
        y: (point.y / viewHeight) * 100,
      });
    },
    toTemplate,
    fromTemplate,
    clamp(point) {
      return clampScenePoint(point, bounds);
    },
    keyboardStep(axis, coarse = false) {
      const span = axis === "x" ? spanX : spanY;
      return span * (coarse ? 0.02 : 0.005);
    },
  };
}

export function formatSceneCoordinate(value: number): string {
  const rounded = Number(value.toFixed(3));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}
