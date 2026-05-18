import type { BoardObject } from "./board-document";

export type Point = {
  x: number;
  y: number;
};

export type Bounds = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type BoardViewport = {
  x: number;
  y: number;
  zoom: number;
};

export const MIN_BOARD_ZOOM = 0.1;
export const MAX_BOARD_ZOOM = 4;

export function clampZoom(zoom: number) {
  return Math.min(MAX_BOARD_ZOOM, Math.max(MIN_BOARD_ZOOM, zoom));
}

export function worldToScreen(point: Point, viewport: BoardViewport): Point {
  return {
    x: point.x * viewport.zoom + viewport.x,
    y: point.y * viewport.zoom + viewport.y,
  };
}

export function screenToWorld(point: Point, viewport: BoardViewport): Point {
  return {
    x: (point.x - viewport.x) / viewport.zoom,
    y: (point.y - viewport.y) / viewport.zoom,
  };
}

export function zoomAtPoint(viewport: BoardViewport, screenPoint: Point, nextZoom: number): BoardViewport {
  const zoom = clampZoom(nextZoom);
  const worldPoint = screenToWorld(screenPoint, viewport);

  return {
    x: screenPoint.x - worldPoint.x * zoom,
    y: screenPoint.y - worldPoint.y * zoom,
    zoom,
  };
}

export function fitBoundsToViewport(bounds: Bounds, viewportSize: { h: number; w: number }): BoardViewport {
  const padding = 80;
  const availableWidth = viewportSize.w - padding * 2;
  const availableHeight = viewportSize.h - padding * 2;
  const zoom = clampZoom(Math.min(availableWidth / bounds.w, availableHeight / bounds.h));

  return {
    x: round((viewportSize.w - bounds.w * zoom) / 2 - bounds.x * zoom),
    y: round((viewportSize.h - bounds.h * zoom) / 2 - bounds.y * zoom),
    zoom,
  };
}

export function getCombinedBounds(objects: BoardObject[]): Bounds | null {
  const objectBounds = objects.map(getObjectBoundsForFitting).filter((bounds): bounds is Bounds => bounds !== null);
  if (objectBounds.length === 0) return null;

  const minX = Math.min(...objectBounds.map((bounds) => bounds.x));
  const minY = Math.min(...objectBounds.map((bounds) => bounds.y));
  const maxX = Math.max(...objectBounds.map((bounds) => bounds.x + bounds.w));
  const maxY = Math.max(...objectBounds.map((bounds) => bounds.y + bounds.h));

  return {
    x: round(minX),
    y: round(minY),
    w: round(maxX - minX),
    h: round(maxY - minY),
  };
}

function getObjectBoundsForFitting(object: BoardObject): Bounds | null {
  if (object.type === "path") {
    const validPoints = object.points.filter(isFinitePoint);
    if (validPoints.length === 0) return null;
    return getPointsBounds(validPoints);
  }

  const bounds = getObjectBounds(object);
  return isFiniteBounds(bounds) ? bounds : null;
}

export function getObjectBounds(object: BoardObject): Bounds {
  if (object.type === "path") {
    return getPathBounds(object.points);
  }

  if (!("w" in object) || !("h" in object)) {
    return { x: object.x, y: object.y, w: 0, h: 0 };
  }

  const points = rotateRectCorners(object.x, object.y, object.w, object.h, object.rotation);
  return getPointsBounds(points);
}

function getPathBounds(points: Point[]): Bounds {
  const validPoints = points.filter(isFinitePoint);
  if (validPoints.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  return getPointsBounds(validPoints);
}

function rotateRectCorners(x: number, y: number, w: number, h: number, rotation: number): Point[] {
  const radians = degreesToRadians(rotation);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const corners = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];

  return corners.map((corner) => ({
    x: round(x + corner.x * cos - corner.y * sin),
    y: round(y + corner.x * sin + corner.y * cos),
  }));
}

function getPointsBounds(points: Point[]): Bounds {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return {
    x: round(minX),
    y: round(minY),
    w: round(maxX - minX),
    h: round(maxY - minY),
  };
}

function degreesToRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function round(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function isFinitePoint(point: Point): point is Point {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function isFiniteBounds(bounds: Bounds) {
  return (
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.w) &&
    Number.isFinite(bounds.h)
  );
}
