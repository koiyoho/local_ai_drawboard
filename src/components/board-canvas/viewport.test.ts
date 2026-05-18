import assert from "node:assert/strict";
import test from "node:test";

import type { BoardObject } from "./board-document";
import {
  clampZoom,
  fitBoundsToViewport,
  getCombinedBounds,
  getObjectBounds,
  MIN_BOARD_ZOOM,
  screenToWorld,
  worldToScreen,
  zoomAtPoint,
} from "./viewport";

function assertBoundsAlmostEqual(
  actual: { x: number; y: number; w: number; h: number },
  expected: { x: number; y: number; w: number; h: number },
) {
  assert.equal(Math.round(actual.x * 1000) / 1000, Math.round(expected.x * 1000) / 1000);
  assert.equal(Math.round(actual.y * 1000) / 1000, Math.round(expected.y * 1000) / 1000);
  assert.equal(Math.round(actual.w * 1000) / 1000, Math.round(expected.w * 1000) / 1000);
  assert.equal(Math.round(actual.h * 1000) / 1000, Math.round(expected.h * 1000) / 1000);
}

test("worldToScreen and screenToWorld are inverse operations", () => {
  const viewport = { x: 40, y: 20, zoom: 2 };
  const worldPoint = { x: 100, y: 80 };

  const screenPoint = worldToScreen(worldPoint, viewport);
  const restoredWorldPoint = screenToWorld(screenPoint, viewport);

  assert.deepEqual(screenPoint, { x: 240, y: 180 });
  assert.deepEqual(restoredWorldPoint, worldPoint);
});

test("worldToScreen and screenToWorld preserve fractional coordinates", () => {
  const viewport = { x: 10.25, y: -4.5, zoom: 1.5 };
  const worldPoint = { x: 7.25, y: 3.75 };

  const screenPoint = worldToScreen(worldPoint, viewport);
  const restoredWorldPoint = screenToWorld(screenPoint, viewport);

  assert.deepEqual(screenPoint, { x: 21.125, y: 1.125 });
  assert.deepEqual(restoredWorldPoint, worldPoint);
});

test("zoomAtPoint keeps the world point under the cursor stable", () => {
  const viewport = { x: 0, y: 0, zoom: 1 };
  const cursorPoint = { x: 500, y: 300 };
  const worldPointBeforeZoom = screenToWorld(cursorPoint, viewport);

  const zoomedViewport = zoomAtPoint(viewport, cursorPoint, 2);
  const worldPointAfterZoom = screenToWorld(cursorPoint, zoomedViewport);

  assert.deepEqual(worldPointBeforeZoom, { x: 500, y: 300 });
  assert.deepEqual(zoomedViewport, { x: -500, y: -300, zoom: 2 });
  assert.deepEqual(worldPointAfterZoom, worldPointBeforeZoom);
});

test("zoomAtPoint preserves fractional cursor world position", () => {
  const viewport = { x: 12.5, y: -3.25, zoom: 1.25 };
  const cursorPoint = { x: 33.75, y: 80.5 };
  const worldPointBeforeZoom = screenToWorld(cursorPoint, viewport);

  const zoomedViewport = zoomAtPoint(viewport, cursorPoint, 2.5);
  const worldPointAfterZoom = screenToWorld(cursorPoint, zoomedViewport);

  assert.deepEqual(zoomedViewport, { x: -8.75, y: -87, zoom: 2.5 });
  assert.deepEqual(worldPointAfterZoom, worldPointBeforeZoom);
});

test("zoomAtPoint keeps cursor world position stable when zoom is clamped", () => {
  const viewport = { x: 5, y: 10, zoom: 2 };
  const cursorPoint = { x: 120, y: 90 };
  const worldPointBeforeZoom = screenToWorld(cursorPoint, viewport);

  const zoomedViewport = zoomAtPoint(viewport, cursorPoint, 10);
  const worldPointAfterZoom = screenToWorld(cursorPoint, zoomedViewport);

  assert.deepEqual(zoomedViewport, { x: -110, y: -70, zoom: 4 });
  assert.deepEqual(worldPointAfterZoom, worldPointBeforeZoom);
});

test("getObjectBounds returns bounds for image objects", () => {
  const image: BoardObject = {
    id: "image-1",
    type: "image",
    assetId: "asset-1",
    x: 10,
    y: 20,
    w: 300,
    h: 200,
    rotation: 0,
  };

  assert.deepEqual(getObjectBounds(image), { x: 10, y: 20, w: 300, h: 200 });
});

test("getObjectBounds includes rotated corners for 90 degrees", () => {
  const image: BoardObject = {
    id: "image-1",
    type: "image",
    assetId: "asset-1",
    x: 100,
    y: 50,
    w: 10,
    h: 20,
    rotation: 90,
  };

  assert.deepEqual(getObjectBounds(image), { x: 80, y: 50, w: 20, h: 10 });
});

test("getObjectBounds handles 45 degree diagonal rotation with almost equal bounds", () => {
  const image: BoardObject = {
    id: "image-1",
    type: "image",
    assetId: "asset-1",
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    rotation: 45,
  };

  assertBoundsAlmostEqual(getObjectBounds(image), {
    x: -7.071,
    y: 0,
    w: 14.142,
    h: 14.142,
  });
});

test("getObjectBounds returns path bounds from points", () => {
  const path: BoardObject = {
    id: "path-1",
    type: "path",
    points: [
      { x: 20, y: 30 },
      { x: -10, y: 50 },
      { x: 15, y: 5 },
    ],
    rotation: 0,
  };

  assert.deepEqual(getObjectBounds(path), { x: -10, y: 5, w: 30, h: 45 });
});

test("getObjectBounds returns empty bounds for paths with no points", () => {
  const path: BoardObject = {
    id: "path-1",
    type: "path",
    points: [],
    rotation: 0,
  };

  assert.deepEqual(getObjectBounds(path), { x: 0, y: 0, w: 0, h: 0 });
});

test("getObjectBounds ignores non-finite path points", () => {
  const path: BoardObject = {
    id: "path-1",
    type: "path",
    points: [
      { x: Number.NaN, y: 10 },
      { x: 12, y: Number.POSITIVE_INFINITY },
      { x: 20, y: -5 },
      { x: -4, y: 15 },
    ],
    rotation: 0,
  };

  assert.deepEqual(getObjectBounds(path), { x: -4, y: -5, w: 24, h: 20 });
});

test("getObjectBounds returns empty bounds when all path points are non-finite", () => {
  const path: BoardObject = {
    id: "path-1",
    type: "path",
    points: [
      { x: Number.NaN, y: 10 },
      { x: 12, y: Number.NEGATIVE_INFINITY },
    ],
    rotation: 0,
  };

  assert.deepEqual(getObjectBounds(path), { x: 0, y: 0, w: 0, h: 0 });
});

test("getCombinedBounds combines two objects correctly", () => {
  const objects: BoardObject[] = [
    {
      id: "image-1",
      type: "image",
      assetId: "asset-1",
      x: 10,
      y: 20,
      w: 100,
      h: 50,
      rotation: 0,
    },
    {
      id: "path-1",
      type: "path",
      points: [
        { x: -20, y: 30 },
        { x: 40, y: 120 },
      ],
      rotation: 0,
    },
  ];

  assert.deepEqual(getCombinedBounds(objects), { x: -20, y: 20, w: 130, h: 100 });
});

test("getCombinedBounds returns null for empty array", () => {
  assert.equal(getCombinedBounds([]), null);
});

test("getCombinedBounds returns null for empty path", () => {
  const objects: BoardObject[] = [
    {
      id: "path-empty",
      type: "path",
      points: [],
      rotation: 0,
    },
  ];

  assert.equal(getCombinedBounds(objects), null);
});

test("getCombinedBounds includes a vertical path with zero width", () => {
  const objects: BoardObject[] = [
    {
      id: "path-vertical",
      type: "path",
      points: [
        { x: 20, y: 10 },
        { x: 20, y: 70 },
      ],
      rotation: 0,
    },
  ];

  assert.deepEqual(getCombinedBounds(objects), { x: 20, y: 10, w: 0, h: 60 });
});

test("getCombinedBounds includes a horizontal path with zero height", () => {
  const objects: BoardObject[] = [
    {
      id: "path-horizontal",
      type: "path",
      points: [
        { x: -15, y: 30 },
        { x: 25, y: 30 },
      ],
      rotation: 0,
    },
  ];

  assert.deepEqual(getCombinedBounds(objects), { x: -15, y: 30, w: 40, h: 0 });
});

test("fitBoundsToViewport centers bounds with Stage-compatible translation", () => {
  const viewport = fitBoundsToViewport({ x: 100, y: 50, w: 200, h: 100 }, { w: 600, h: 400 });

  assert.deepEqual(viewport, { x: -140, y: -20, zoom: 2.2 });
});

test("fitBoundsToViewport clamps tiny viewport zoom no lower than MIN_BOARD_ZOOM", () => {
  const viewport = fitBoundsToViewport({ x: 0, y: 0, w: 1_000, h: 1_000 }, { w: 1, h: 1 });

  assert.equal(viewport.zoom, MIN_BOARD_ZOOM);
});

test("clampZoom keeps zoom in range", () => {
  assert.equal(clampZoom(0.01), 0.1);
  assert.equal(clampZoom(10), 4);
  assert.equal(clampZoom(1.25), 1.25);
});
