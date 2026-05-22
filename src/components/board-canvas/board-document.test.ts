import assert from "node:assert/strict";
import test from "node:test";

import {
  BOARD_DOCUMENT_VERSION,
  type BoardObject,
  type BoardDocument,
  type BoardRectObject,
  createEmptyBoardDocument,
  createPersistedBoardSnapshot,
  appendObjectsToCurrentPage,
  autoLayoutObjectsOnCurrentPage,
  getBoardDocumentFromSnapshot,
  groupObjectsOnCurrentPage,
  createBoardHistory,
  alignObjectsOnCurrentPage,
  duplicateObjectsOnCurrentPage,
  distributeObjectsOnCurrentPage,
  moveObjectsOnCurrentPage,
  reorderObjectsOnCurrentPage,
  pushBoardHistory,
  redoBoardHistory,
  removeUnlockedObjectsFromCurrentPage,
  resolveGroupedSelectionOnCurrentPage,
  toggleGroupCollapsedOnCurrentPage,
  ungroupObjectsOnCurrentPage,
  undoBoardHistory,
} from "./board-document";

test("createEmptyBoardDocument creates one empty page", () => {
  const document = createEmptyBoardDocument();

  assert.equal(document.version, BOARD_DOCUMENT_VERSION);
  assert.equal(document.pages.length, 1);
  assert.equal(document.currentPageId, document.pages[0]?.id);
  assert.equal(document.pages[0]?.name, "第 1 页");
  assert.deepEqual(document.pages[0]?.objects, []);
});

test("getBoardDocumentFromSnapshot reads app.boardDocument and parses an image object", () => {
  const document = getBoardDocumentFromSnapshot({
    app: {
      boardDocument: {
        version: 1,
        currentPageId: "page-main",
        pages: [
          {
            id: "page-main",
            name: "页面 1",
            objects: [
              {
                id: "image-1",
                type: "image",
                assetId: "asset-db-1",
                x: 12,
                y: 24,
                w: 320,
                h: 180,
                rotation: 0.25,
              },
            ],
          },
        ],
      },
      editImageSize: "2K",
    },
  });

  assert.equal(document.version, BOARD_DOCUMENT_VERSION);
  assert.equal(document.currentPageId, "page-main");
  assert.deepEqual(document.pages[0]?.objects[0], {
    id: "image-1",
    type: "image",
    assetId: "asset-db-1",
    x: 12,
    y: 24,
    w: 320,
    h: 180,
    rotation: 0.25,
  });
});

test("getBoardDocumentFromSnapshot preserves image layer metadata", () => {
  const document = getBoardDocumentFromSnapshot({
    app: {
      boardDocument: {
        version: 1,
        currentPageId: "page-main",
        pages: [
          {
            id: "page-main",
            name: "页面 1",
            objects: [
              {
                id: "image-1",
                type: "image",
                name: "  Product reference  ",
                hidden: true,
                locked: true,
                assetId: "asset-db-1",
                x: 12,
                y: 24,
                w: 320,
                h: 180,
                rotation: 0.25,
              },
            ],
          },
        ],
      },
    },
  });

  assert.deepEqual(document.pages[0]?.objects[0], {
    id: "image-1",
    type: "image",
    name: "Product reference",
    hidden: true,
    locked: true,
    assetId: "asset-db-1",
    x: 12,
    y: 24,
    w: 320,
    h: 180,
    rotation: 0.25,
  });
});

test("getBoardDocumentFromSnapshot falls back for non-positive new-format image dimensions", () => {
  const document = getBoardDocumentFromSnapshot({
    app: {
      boardDocument: {
        version: 1,
        currentPageId: "page-main",
        pages: [
          {
            id: "page-main",
            name: "页面 1",
            objects: [
              {
                id: "image-1",
                type: "image",
                assetId: "asset-db-1",
                x: 12,
                y: 24,
                w: -10,
                h: 0,
                rotation: 0,
              },
            ],
          },
        ],
      },
    },
  });

  const image = document.pages[0]?.objects[0];

  assert.equal(image?.type, "image");
  assert.ok(image.w > 0);
  assert.ok(image.h > 0);
});

test("createPersistedBoardSnapshot preserves app fields and stores only app.boardDocument", () => {
  const boardDocument = createEmptyBoardDocument();
  const snapshot = createPersistedBoardSnapshot(boardDocument, {
    editImageSize: "2K",
    generationCount: 3,
  });

  assert.deepEqual(snapshot, {
    app: {
      editImageSize: "2K",
      generationCount: 3,
      boardDocument,
    },
  });
  assert.equal("tldraw" in snapshot, false);
  assert.equal("document" in snapshot, false);
  assert.equal("store" in snapshot, false);
});

test("createPersistedBoardSnapshot preserves board object layer metadata", () => {
  const boardDocument = getBoardDocumentFromSnapshot({
    app: {
      boardDocument: {
        version: 1,
        currentPageId: "page-main",
        pages: [
          {
            id: "page-main",
            name: "页面 1",
            objects: [
              {
                id: "image-1",
                type: "image",
                name: "Product reference",
                hidden: true,
                locked: true,
                assetId: "asset-db-1",
                x: 12,
                y: 24,
                w: 320,
                h: 180,
                rotation: 0.25,
              },
            ],
          },
        ],
      },
    },
  });

  const snapshot = createPersistedBoardSnapshot(boardDocument, {});

  assert.deepEqual(snapshot.app.boardDocument.pages[0]?.objects[0], {
    id: "image-1",
    type: "image",
    name: "Product reference",
    hidden: true,
    locked: true,
    assetId: "asset-db-1",
    x: 12,
    y: 24,
    w: 320,
    h: 180,
    rotation: 0.25,
  });
});

test("getExportableObjects excludes hidden layers", async () => {
  (globalThis as typeof globalThis & { __AIBOARD_API_BASE_URL__?: string }).__AIBOARD_API_BASE_URL__ = "";
  const { getExportableObjects } = await import("./export-board");
  const objects: BoardObject[] = [
    { hidden: true, id: "rect-hidden", rotation: 0, type: "rect", w: 10, h: 10, x: 0, y: 0 },
    { id: "rect-visible", rotation: 0, type: "rect", w: 10, h: 10, x: 0, y: 0 },
  ];

  assert.deepEqual(getExportableObjects(objects).map((object) => object.id), ["rect-visible"]);
});

test("createPersistedBoardSnapshot strips legacy runtime snapshot fields from app", () => {
  const boardDocument = createEmptyBoardDocument();
  const snapshot = createPersistedBoardSnapshot(boardDocument, {
    prompt: "make a product sketch",
    sourceAssetId: "asset-db-source",
    tldraw: { document: { store: {} } },
    document: { store: {} },
    store: {},
    legacySnapshot: { tldraw: {} },
  });

  assert.deepEqual(snapshot.app, {
    prompt: "make a product sketch",
    sourceAssetId: "asset-db-source",
    boardDocument,
  });
  assert.equal("tldraw" in snapshot.app, false);
  assert.equal("document" in snapshot.app, false);
  assert.equal("store" in snapshot.app, false);
  assert.equal("legacySnapshot" in snapshot.app, false);
});

test("getBoardDocumentFromSnapshot migrates historical wrapped runtime image snapshots", () => {
  const historicalStore = {
    "page:page": {
      id: "page:page",
      typeName: "page",
      name: "Page 1",
      index: "a1",
    },
    "camera:page": {
      id: "camera:page",
      typeName: "camera",
      x: 10,
      y: 20,
      z: 1,
    },
    "instance_page_state:page": {
      id: "instance_page_state:page",
      typeName: "instance_page_state",
      pageId: "page:page",
      selectedShapeIds: ["shape:image-1"],
    },
    "shape:note-1": {
      id: "shape:note-1",
      typeName: "shape",
      type: "geo",
      x: 10,
      y: 12,
      rotation: 0,
      props: {
        w: 120,
        h: 80,
        geo: "rectangle",
      },
    },
    "asset:runtime-1": {
      id: "asset:runtime-1",
      typeName: "asset",
      type: "image",
      meta: {
        dbAssetId: "db-asset-1",
      },
    },
    "shape:image-1": {
      id: "shape:image-1",
      typeName: "shape",
      type: "image",
      x: 40,
      y: 80,
      rotation: 0.5,
      props: {
        assetId: "asset:runtime-1",
        w: 640,
        h: 360,
      },
    },
  };

  const document = getBoardDocumentFromSnapshot({
    tldraw: {
      document: {
        store: historicalStore,
      },
    },
  });

  const images = document.pages.flatMap((page) =>
    page.objects.filter((object) => object.type === "image"),
  );

  assert.equal(images.length, 1);
  assert.deepEqual(images[0], {
    id: "shape:image-1",
    type: "image",
    assetId: "db-asset-1",
    x: 40,
    y: 80,
    w: 640,
    h: 360,
    rotation: 0.5,
  });
});

test("getBoardDocumentFromSnapshot migrates historical document and store wrappers", () => {
  const historicalStore = {
    "asset:runtime-1": {
      id: "asset:runtime-1",
      typeName: "asset",
      type: "image",
      meta: {
        dbAssetId: "db-asset-1",
      },
    },
    "shape:image-1": {
      id: "shape:image-1",
      typeName: "shape",
      type: "image",
      props: {
        assetId: "asset:runtime-1",
        w: 100,
        h: 80,
      },
    },
  };

  for (const snapshot of [{ document: { store: historicalStore } }, { store: historicalStore }]) {
    const document = getBoardDocumentFromSnapshot(snapshot);
    const image = document.pages[0]?.objects[0];

    assert.equal(image?.type, "image");
    assert.equal(image?.assetId, "db-asset-1");
  }
});

test("getBoardDocumentFromSnapshot falls back for malformed historical image dimensions", () => {
  const historicalStore = {
    "asset:runtime-1": {
      id: "asset:runtime-1",
      typeName: "asset",
      type: "image",
      meta: {
        dbAssetId: "db-asset-1",
      },
    },
    "shape:image-1": {
      id: "shape:image-1",
      typeName: "shape",
      type: "image",
      props: {
        assetId: "asset:runtime-1",
        w: -10,
      },
    },
  };

  const document = getBoardDocumentFromSnapshot({ store: historicalStore });
  const image = document.pages[0]?.objects[0];

  assert.equal(image?.type, "image");
  assert.ok(image.w > 0);
  assert.ok(image.h > 0);
});

test("board history undoes and redoes document changes", () => {
  const initialDocument = createDocumentWithObjects([
    { id: "rect-1", rotation: 0, type: "rect", w: 10, h: 10, x: 0, y: 0 },
  ]);
  const changedDocument = createDocumentWithObjects([
    { id: "rect-1", rotation: 0, type: "rect", w: 10, h: 10, x: 24, y: 0 },
  ]);
  const history = pushBoardHistory(createBoardHistory(initialDocument), changedDocument);

  const undone = undoBoardHistory(history);
  assert.equal((undone.document.pages[0]?.objects[0] as BoardRectObject | undefined)?.x, 0);
  assert.equal(undone.canRedo, true);

  const redone = redoBoardHistory(undone);
  assert.equal((redone.document.pages[0]?.objects[0] as BoardRectObject | undefined)?.x, 24);
  assert.equal(redone.canUndo, true);
});

test("removeUnlockedObjectsFromCurrentPage removes selected objects but preserves locked objects", () => {
  const document = createDocumentWithObjects([
    { id: "rect-1", rotation: 0, type: "rect", w: 10, h: 10, x: 0, y: 0 },
    { id: "rect-locked", locked: true, rotation: 0, type: "rect", w: 10, h: 10, x: 20, y: 0 },
    { id: "rect-2", rotation: 0, type: "rect", w: 10, h: 10, x: 40, y: 0 },
  ]);

  const result = removeUnlockedObjectsFromCurrentPage(document, ["rect-1", "rect-locked"]);

  assert.deepEqual(result.removedObjectIds, ["rect-1"]);
  assert.deepEqual(result.document.pages[0]?.objects.map((object) => object.id), ["rect-locked", "rect-2"]);
});

test("alignObjectsOnCurrentPage aligns selected objects to the left edge", () => {
  const document = createDocumentWithObjects([
    { id: "rect-1", rotation: 0, type: "rect", w: 10, h: 10, x: 40, y: 0 },
    { id: "rect-2", rotation: 0, type: "rect", w: 20, h: 10, x: 10, y: 20 },
    { id: "rect-3", rotation: 0, type: "rect", w: 10, h: 10, x: 90, y: 40 },
  ]);

  const result = alignObjectsOnCurrentPage(document, ["rect-1", "rect-2"], "left");

  assert.deepEqual(result.changedObjectIds, ["rect-1"]);
  assert.deepEqual(
    result.document.pages[0]?.objects.map((object) => ("x" in object ? object.x : 0)),
    [10, 10, 90],
  );
});

test("distributeObjectsOnCurrentPage distributes selected objects horizontally", () => {
  const document = createDocumentWithObjects([
    { id: "rect-left", rotation: 0, type: "rect", w: 10, h: 10, x: 0, y: 0 },
    { id: "rect-middle", rotation: 0, type: "rect", w: 10, h: 10, x: 30, y: 0 },
    { id: "rect-right", rotation: 0, type: "rect", w: 10, h: 10, x: 100, y: 0 },
  ]);

  const result = distributeObjectsOnCurrentPage(document, ["rect-left", "rect-middle", "rect-right"], "horizontal");

  assert.deepEqual(
    result.document.pages[0]?.objects.map((object) => ("x" in object ? object.x : 0)),
    [0, 50, 100],
  );
});

test("reorderObjectsOnCurrentPage moves selected objects to front preserving their relative order", () => {
  const document = createDocumentWithObjects([
    { id: "bottom", rotation: 0, type: "rect", w: 10, h: 10, x: 0, y: 0 },
    { id: "selected-1", rotation: 0, type: "rect", w: 10, h: 10, x: 10, y: 0 },
    { id: "middle", rotation: 0, type: "rect", w: 10, h: 10, x: 20, y: 0 },
    { id: "selected-2", rotation: 0, type: "rect", w: 10, h: 10, x: 30, y: 0 },
  ]);

  const result = reorderObjectsOnCurrentPage(document, ["selected-1", "selected-2"], "front");

  assert.deepEqual(result.document.pages[0]?.objects.map((object) => object.id), [
    "bottom",
    "middle",
    "selected-1",
    "selected-2",
  ]);
});

test("reorderObjectsOnCurrentPage reports no changes when selected object is already at front", () => {
  const document = createDocumentWithObjects([
    { id: "bottom", rotation: 0, type: "rect", w: 10, h: 10, x: 0, y: 0 },
    { id: "front", rotation: 0, type: "rect", w: 10, h: 10, x: 10, y: 0 },
  ]);

  const result = reorderObjectsOnCurrentPage(document, ["front"], "front");

  assert.deepEqual(result.changedObjectIds, []);
  assert.equal(result.document, document);
});

test("duplicateObjectsOnCurrentPage copies selected unlocked objects with new ids and offset", () => {
  const document = createDocumentWithObjects([
    { id: "rect-1", rotation: 0, type: "rect", w: 10, h: 10, x: 0, y: 0 },
    { id: "rect-locked", locked: true, rotation: 0, type: "rect", w: 10, h: 10, x: 20, y: 0 },
    { id: "text-1", rotation: 0, text: "Label", type: "text", x: 40, y: 8 },
  ]);

  const result = duplicateObjectsOnCurrentPage(document, ["rect-1", "rect-locked", "text-1"], {
    idPrefix: "copy",
    offset: { x: 16, y: 12 },
  });

  assert.deepEqual(result.createdObjectIds, ["copy-1", "copy-2"]);
  assert.deepEqual(result.document.pages[0]?.objects, [
    { id: "rect-1", rotation: 0, type: "rect", w: 10, h: 10, x: 0, y: 0 },
    { id: "rect-locked", locked: true, rotation: 0, type: "rect", w: 10, h: 10, x: 20, y: 0 },
    { id: "text-1", rotation: 0, text: "Label", type: "text", x: 40, y: 8 },
    { id: "copy-1", rotation: 0, type: "rect", w: 10, h: 10, x: 16, y: 12 },
    { id: "copy-2", rotation: 0, text: "Label", type: "text", x: 56, y: 20 },
  ]);
});

test("moveObjectsOnCurrentPage moves selected unlocked objects and path points", () => {
  const document = createDocumentWithObjects([
    { id: "rect-1", rotation: 0, type: "rect", w: 10, h: 10, x: 0, y: 0 },
    { id: "path-1", points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], rotation: 0, type: "path" },
    { id: "rect-locked", locked: true, rotation: 0, type: "rect", w: 10, h: 10, x: 20, y: 0 },
  ]);

  const result = moveObjectsOnCurrentPage(document, ["rect-1", "path-1", "rect-locked"], { x: 5, y: -2 });

  assert.deepEqual(result.changedObjectIds, ["rect-1", "path-1"]);
  assert.deepEqual(result.document.pages[0]?.objects, [
    { id: "rect-1", rotation: 0, type: "rect", w: 10, h: 10, x: 5, y: -2 },
    { id: "path-1", points: [{ x: 6, y: 0 }, { x: 8, y: 2 }], rotation: 0, type: "path" },
    { id: "rect-locked", locked: true, rotation: 0, type: "rect", w: 10, h: 10, x: 20, y: 0 },
  ]);
});

test("groupObjectsOnCurrentPage assigns a shared group id and name to unlocked selected objects", () => {
  const document = createDocumentWithObjects([
    { id: "rect-1", rotation: 0, type: "rect", w: 10, h: 10, x: 0, y: 0 },
    { id: "rect-locked", locked: true, rotation: 0, type: "rect", w: 10, h: 10, x: 20, y: 0 },
    { id: "image-1", assetId: "asset-1", h: 20, rotation: 0, type: "image", w: 30, x: 40, y: 0 },
  ]);

  const result = groupObjectsOnCurrentPage(document, ["rect-1", "rect-locked", "image-1"], {
    groupId: "group-fixed",
    name: "方案 A",
  });

  assert.deepEqual(result.changedObjectIds, ["rect-1", "image-1"]);
  assert.equal(result.groupId, "group-fixed");
  assert.deepEqual(result.document.pages[0]?.objects, [
    { groupId: "group-fixed", groupName: "方案 A", id: "rect-1", rotation: 0, type: "rect", w: 10, h: 10, x: 0, y: 0 },
    { id: "rect-locked", locked: true, rotation: 0, type: "rect", w: 10, h: 10, x: 20, y: 0 },
    { assetId: "asset-1", groupId: "group-fixed", groupName: "方案 A", h: 20, id: "image-1", rotation: 0, type: "image", w: 30, x: 40, y: 0 },
  ]);
});

test("ungroupObjectsOnCurrentPage clears group metadata from selected groups", () => {
  const document = createDocumentWithObjects([
    { groupId: "group-a", groupName: "方案 A", id: "rect-1", rotation: 0, type: "rect", w: 10, h: 10, x: 0, y: 0 },
    { groupId: "group-a", groupName: "方案 A", id: "rect-2", rotation: 0, type: "rect", w: 10, h: 10, x: 20, y: 0 },
    { groupId: "group-b", groupName: "方案 B", id: "rect-3", rotation: 0, type: "rect", w: 10, h: 10, x: 40, y: 0 },
  ]);

  const result = ungroupObjectsOnCurrentPage(document, ["rect-1"]);

  assert.deepEqual(result.changedObjectIds, ["rect-1", "rect-2"]);
  assert.deepEqual(result.document.pages[0]?.objects, [
    { id: "rect-1", rotation: 0, type: "rect", w: 10, h: 10, x: 0, y: 0 },
    { id: "rect-2", rotation: 0, type: "rect", w: 10, h: 10, x: 20, y: 0 },
    { groupId: "group-b", groupName: "方案 B", id: "rect-3", rotation: 0, type: "rect", w: 10, h: 10, x: 40, y: 0 },
  ]);
});

test("toggleGroupCollapsedOnCurrentPage hides and shows non-selected grouped objects", () => {
  const document = createDocumentWithObjects([
    { groupId: "group-a", groupName: "方案 A", id: "rect-1", rotation: 0, type: "rect", w: 10, h: 10, x: 0, y: 0 },
    { groupId: "group-a", groupName: "方案 A", id: "rect-2", rotation: 0, type: "rect", w: 10, h: 10, x: 20, y: 0 },
  ]);

  const collapsed = toggleGroupCollapsedOnCurrentPage(document, "group-a", true, "rect-1");
  assert.deepEqual(collapsed.changedObjectIds, ["rect-1", "rect-2"]);
  assert.deepEqual(collapsed.document.pages[0]?.objects, [
    { groupCollapsed: true, groupId: "group-a", groupName: "方案 A", id: "rect-1", rotation: 0, type: "rect", w: 10, h: 10, x: 0, y: 0 },
    { groupCollapsed: true, groupId: "group-a", groupName: "方案 A", hidden: true, id: "rect-2", rotation: 0, type: "rect", w: 10, h: 10, x: 20, y: 0 },
  ]);

  const expanded = toggleGroupCollapsedOnCurrentPage(collapsed.document, "group-a", false);
  assert.deepEqual(expanded.document.pages[0]?.objects, [
    { groupId: "group-a", groupName: "方案 A", id: "rect-1", rotation: 0, type: "rect", w: 10, h: 10, x: 0, y: 0 },
    { groupId: "group-a", groupName: "方案 A", id: "rect-2", rotation: 0, type: "rect", w: 10, h: 10, x: 20, y: 0 },
  ]);
});

test("resolveGroupedSelectionOnCurrentPage expands selected group members to the full unlocked group", () => {
  const document = createDocumentWithObjects([
    { groupId: "group-a", groupName: "方案 A", id: "rect-1", rotation: 0, type: "rect", w: 10, h: 10, x: 0, y: 0 },
    { groupId: "group-a", groupName: "方案 A", id: "rect-2", rotation: 0, type: "rect", w: 10, h: 10, x: 20, y: 0 },
    { groupId: "group-a", groupName: "方案 A", hidden: true, id: "rect-hidden", rotation: 0, type: "rect", w: 10, h: 10, x: 40, y: 0 },
    { groupId: "group-b", groupName: "方案 B", locked: true, id: "rect-locked", rotation: 0, type: "rect", w: 10, h: 10, x: 60, y: 0 },
    { id: "rect-free", rotation: 0, type: "rect", w: 10, h: 10, x: 80, y: 0 },
  ]);

  assert.deepEqual(resolveGroupedSelectionOnCurrentPage(document, ["rect-1", "rect-free", "missing"]), [
    "rect-1",
    "rect-2",
    "rect-free",
  ]);
});

test("autoLayoutObjectsOnCurrentPage arranges selected images into a grid", () => {
  const document = createDocumentWithObjects([
    { assetId: "asset-1", h: 100, id: "image-1", rotation: 0, type: "image", w: 100, x: 500, y: 500 },
    { assetId: "asset-2", h: 100, id: "image-2", rotation: 0, type: "image", w: 100, x: 0, y: 0 },
    { assetId: "asset-3", h: 100, id: "image-3", rotation: 0, type: "image", w: 100, x: 0, y: 0 },
    { assetId: "asset-4", h: 100, id: "image-4", rotation: 0, type: "image", w: 100, x: 0, y: 0 },
  ]);

  const result = autoLayoutObjectsOnCurrentPage(document, ["image-1", "image-2", "image-3", "image-4"], {
    columns: 2,
    gap: 20,
    origin: { x: 10, y: 30 },
    mode: "grid",
  });

  assert.deepEqual(result.changedObjectIds, ["image-1", "image-2", "image-3", "image-4"]);
  assert.deepEqual(
    result.document.pages[0]?.objects.map((object) => ("x" in object && "y" in object ? [object.x, object.y] : null)),
    [[10, 30], [130, 30], [10, 150], [130, 150]],
  );
});

test("autoLayoutObjectsOnCurrentPage creates a before after comparison layout", () => {
  const document = createDocumentWithObjects([
    { assetId: "source", h: 200, id: "source-image", rotation: 0, type: "image", w: 300, x: 100, y: 100 },
    { assetId: "result", h: 180, id: "result-image", rotation: 0, type: "image", w: 240, x: 0, y: 0 },
  ]);

  const result = autoLayoutObjectsOnCurrentPage(document, ["source-image", "result-image"], {
    gap: 24,
    origin: { x: 0, y: 0 },
    mode: "beforeAfter",
  });

  assert.deepEqual(result.changedObjectIds, ["source-image", "result-image"]);
  assert.deepEqual(result.document.pages[0]?.objects, [
    { assetId: "source", h: 200, id: "source-image", name: "Before", rotation: 0, type: "image", w: 300, x: 0, y: 0 },
    { assetId: "result", h: 200, id: "result-image", name: "After", rotation: 0, type: "image", w: 300, x: 324, y: 0 },
  ]);
});

test("appendObjectsToCurrentPage appends a batch and reports created ids", () => {
  const document = createDocumentWithObjects([
    { id: "existing", rotation: 0, type: "rect", w: 10, h: 10, x: 0, y: 0 },
  ]);
  const objects: BoardObject[] = [
    { id: "image-1", assetId: "asset-1", h: 100, rotation: 0, type: "image", w: 100, x: 20, y: 20 },
    { id: "image-2", assetId: "asset-2", h: 100, rotation: 0, type: "image", w: 100, x: 140, y: 20 },
  ];

  const result = appendObjectsToCurrentPage(document, objects);

  assert.deepEqual(result.createdObjectIds, ["image-1", "image-2"]);
  assert.deepEqual(result.document.pages[0]?.objects.map((object) => object.id), ["existing", "image-1", "image-2"]);
});

function createDocumentWithObjects(objects: BoardObject[]): BoardDocument {
  const document = createEmptyBoardDocument();
  return {
    ...document,
    pages: document.pages.map((page) => ({ ...page, objects })),
  };
}
