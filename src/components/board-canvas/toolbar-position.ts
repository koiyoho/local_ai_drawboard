import type { Point } from "./viewport";

const TOOLBAR_CANVAS_GAP = 24;

export type ToolbarSize = {
  h: number;
  w: number;
};

export function clampToolbarOffset({
  canvasSize,
  offset,
  toolbarSize,
}: {
  canvasSize: ToolbarSize;
  offset: Point;
  toolbarSize: ToolbarSize;
}): Point {
  const maxX = Math.max(0, (canvasSize.w - toolbarSize.w) / 2 - TOOLBAR_CANVAS_GAP);
  const maxY = Math.max(0, (canvasSize.h - toolbarSize.h) / 2 - TOOLBAR_CANVAS_GAP);
  return {
    x: clamp(offset.x, -maxX, maxX),
    y: clamp(offset.y, -maxY, maxY),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
