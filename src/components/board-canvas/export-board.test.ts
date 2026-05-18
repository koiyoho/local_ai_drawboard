import assert from "node:assert/strict";
import test from "node:test";

import type { BoardObject } from "./board-document";

(globalThis as typeof globalThis & { __AIBOARD_API_BASE_URL__?: string }).__AIBOARD_API_BASE_URL__ = "";

type BatchExportMode = "groups" | "page" | "selection";
type ExportBoardModule = typeof import("./export-board");

const objects: BoardObject[] = [
  { id: "rect-1", rotation: 0, type: "rect", w: 100, h: 100, x: 0, y: 0 },
  { id: "rect-hidden", hidden: true, rotation: 0, type: "rect", w: 100, h: 100, x: 120, y: 0 },
  { groupId: "group-a", groupName: "方案 A", id: "rect-2", rotation: 0, type: "rect", w: 100, h: 100, x: 240, y: 0 },
  { groupId: "group-a", groupName: "方案 A", id: "rect-3", rotation: 0, type: "rect", w: 100, h: 100, x: 360, y: 0 },
];

test("getBatchExportBatches exports current page as one visible-object batch", async () => {
  const { getBatchExportBatches } = await getExportBoardModule();
  const batches = getBatchExportBatches({
    mode: "page",
    objects,
    selectedObjectIds: ["rect-1"],
  });

  assert.equal(batches.length, 1);
  assert.equal(batches[0]?.label, "整页");
  assert.deepEqual(batches[0]?.objects.map((object) => object.id), ["rect-1", "rect-2", "rect-3"]);
});

test("getBatchExportBatches exports selected visible objects as one batch", async () => {
  const { getBatchExportBatches } = await getExportBoardModule();
  const batches = getBatchExportBatches({
    mode: "selection",
    objects,
    selectedObjectIds: ["rect-hidden", "rect-2"],
  });

  assert.equal(batches.length, 1);
  assert.equal(batches[0]?.label, "选区");
  assert.deepEqual(batches[0]?.objects.map((object) => object.id), ["rect-2"]);
});

test("getBatchExportBatches exports layer groups separately", async () => {
  const { getBatchExportBatches } = await getExportBoardModule();
  const batches = getBatchExportBatches({
    mode: "groups",
    objects,
    selectedObjectIds: [],
  });

  assert.equal(batches.length, 1);
  assert.equal(batches[0]?.label, "方案 A");
  assert.deepEqual(batches[0]?.objects.map((object) => object.id), ["rect-2", "rect-3"]);
});

test("getBatchExportBatches limits group export to selected groups when a grouped object is selected", async () => {
  const { getBatchExportBatches } = await getExportBoardModule();
  const batches = getBatchExportBatches({
    mode: "groups",
    objects: [
      ...objects,
      { groupId: "group-b", groupName: "方案 B", id: "rect-4", rotation: 0, type: "rect", w: 100, h: 100, x: 480, y: 0 },
    ],
    selectedObjectIds: ["rect-4"],
  });

  assert.equal(batches.length, 1);
  assert.equal(batches[0]?.label, "方案 B");
  assert.deepEqual(batches[0]?.objects.map((object) => object.id), ["rect-4"]);
});

test("createBatchExportFilename appends mode and batch index", async () => {
  const { createBatchExportFilename } = await getExportBoardModule();
  const date = new Date("2026-05-14T12:34:56Z");
  const cases: Array<[BatchExportMode, string]> = [
    ["page", "整页"],
    ["selection", "选区"],
    ["groups", "方案 A"],
  ];

  assert.deepEqual(
    cases.map(([mode, label], index) =>
      createBatchExportFilename("春季主图", "png", {
        date,
        index,
        label,
        mode,
      }),
    ),
    [
      "春季主图_page_整页_20260514203456_01.png",
      "春季主图_selection_选区_20260514203456_02.png",
      "春季主图_groups_方案_A_20260514203456_03.png",
    ],
  );
});

async function getExportBoardModule(): Promise<ExportBoardModule> {
  return import("./export-board");
}
