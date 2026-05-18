import assert from "node:assert/strict";
import test from "node:test";

import { clampToolbarOffset } from "./toolbar-position";

test("clampToolbarOffset keeps the toolbar inside the canvas area", () => {
  const result = clampToolbarOffset({
    canvasSize: { h: 600, w: 900 },
    offset: { x: 700, y: 500 },
    toolbarSize: { h: 72, w: 360 },
  });

  assert.deepEqual(result, { x: 246, y: 240 });
});

test("clampToolbarOffset preserves a visible top gap above the canvas content", () => {
  const result = clampToolbarOffset({
    canvasSize: { h: 600, w: 900 },
    offset: { x: -700, y: -500 },
    toolbarSize: { h: 72, w: 360 },
  });

  assert.deepEqual(result, { x: -246, y: -240 });
});
