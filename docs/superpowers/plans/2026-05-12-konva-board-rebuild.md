# Konva Board Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old runtime-dependent board canvas with a project-owned Konva image board that preserves the product's core workflows: asset loading, AI result insertion, edit-source selection, mask drawing, autosave, and PNG export.

**Architecture:** Keep the existing Fastify/Vite app, auth, database models, asset routes, generation routes, and board snapshot API. Introduce a project-owned `BoardDocument` JSON format stored inside the existing `snapshotJson`, render it with `react-konva`, and migrate legacy image snapshots into the new format on load.

**Tech Stack:** React 19, Vite, Fastify, Prisma SQLite, Konva, react-konva, Node test runner, Playwright.

---

## Current Root Cause

The production board disappears because the old canvas runtime hides production rendering when its runtime entitlement check fails. This is not a data-loss bug: the saved snapshot can contain image objects and matching asset records, but the runtime replaces the editor surface after its timeout.

The rebuild must not patch or bypass the old runtime. It must remove that runtime from the board canvas path.

## File Structure

- Create `src/components/board-canvas/board-document.ts`
  Owns the new persisted board document schema, empty document creation, validation, and legacy image migration.

- Create `src/components/board-canvas/board-document.test.ts`
  Unit tests for new snapshot parsing, persisted snapshot creation, and legacy image migration.

- Create `src/components/board-canvas/viewport.ts`
  Pure coordinate conversion, object bounds, fit-to-content, zoom, and pan helpers.

- Create `src/components/board-canvas/viewport.test.ts`
  Unit tests for viewport math.

- Create `src/components/board-canvas/types.ts`
  Shared UI-facing payload types extracted from `BoardWorkspace`, including `AssetPayload`, `BoardPayload`, `JobPayload`, and `ShapePlacement`. `KonvaBoardCanvas` must import shared types from here, never from `BoardWorkspace`.

- Create `src/components/board-canvas/KonvaBoardCanvas.tsx`
  The canvas UI component. It receives `BoardDocument`, assets, selection, mask state, and callbacks. It renders images, supports pan/zoom, selection, dragging, resizing, deleting, and mask strokes.

- Create `src/components/board-canvas/useKonvaImage.ts`
  Browser image loading hook for same-origin and API-backed asset URLs.

- Create `src/components/board-canvas/export-board.ts`
  Export selected objects or the full board to PNG from a Konva stage.

- Modify `src/components/BoardWorkspace.tsx`
  Remove old canvas runtime usage. Keep existing side panels, asset upload, AI generation, reference/source controls, and replace editor operations with `BoardDocument` state operations.
  Remove or disable toolbar actions that only worked through the old runtime until equivalent Konva workflows are implemented.

- Modify `src/lib/api-client.ts`
  Keep the same-origin `/api/assets/...` browser behavior already added for canvas image loading.

- Modify `package.json`
  Add `konva` and `react-konva`; remove the old canvas runtime packages after migration is complete.

- Modify `src/client/main.tsx`
  Remove the old canvas runtime stylesheet import after the canvas replacement no longer uses that runtime.

- Modify `src/app/globals.css`
  Remove old runtime-specific canvas styling that is no longer needed and add scoped `.konva-board-*` styles.

- Create `scripts/smoke-konva-board.mjs`
  Playwright smoke test that logs in, creates or opens a board, loads an asset to the board, waits past 6 seconds, and verifies the image remains visible.

---

### Task 1: Add Konva Dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install the canvas runtime packages**

Run:

```powershell
npm install konva react-konva
```

Expected:

```text
added ... packages
found 0 vulnerabilities
```

- [ ] **Step 2: Confirm dependencies are present**

Run:

```powershell
node -e "const p=require('./package.json'); console.log(Boolean(p.dependencies.konva), Boolean(p.dependencies['react-konva']))"
```

Expected:

```text
true true
```

- [ ] **Step 3: Commit dependency addition**

Run:

```powershell
git add package.json package-lock.json
git commit -m "chore: add konva board dependencies"
```

Expected: commit succeeds.

---

### Task 2: Define the New Board Document Format

**Files:**
- Create: `src/components/board-canvas/board-document.ts`
- Create: `src/components/board-canvas/board-document.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing document tests**

Create `src/components/board-canvas/board-document.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  BOARD_DOCUMENT_VERSION,
  createEmptyBoardDocument,
  createPersistedBoardSnapshot,
  getBoardDocumentFromSnapshot,
} from "./board-document";

test("createEmptyBoardDocument creates one empty page", () => {
  const doc = createEmptyBoardDocument();

  assert.equal(doc.version, BOARD_DOCUMENT_VERSION);
  assert.equal(doc.pages.length, 1);
  assert.equal(doc.pages[0].name, "第 1 页");
  assert.deepEqual(doc.pages[0].objects, []);
});

test("getBoardDocumentFromSnapshot reads the new app board document", () => {
  const snapshot = {
    app: {
      boardDocument: {
        version: 1,
        currentPageId: "page-1",
        pages: [
          {
            id: "page-1",
            name: "第 1 页",
            objects: [
              {
                assetId: "asset-1",
                h: 200,
                id: "obj-1",
                rotation: 0,
                type: "image",
                w: 300,
                x: 10,
                y: 20,
              },
            ],
          },
        ],
      },
    },
  };

  const doc = getBoardDocumentFromSnapshot(snapshot);

  assert.equal(doc.currentPageId, "page-1");
  assert.equal(doc.pages[0].objects[0].type, "image");
  assert.equal(doc.pages[0].objects[0].assetId, "asset-1");
});

test("createPersistedBoardSnapshot preserves app fields and stores boardDocument", () => {
  const doc = createEmptyBoardDocument();
  const snapshot = createPersistedBoardSnapshot(doc, {
    prompt: "product photo",
    sourceAssetId: "asset-1",
  });

  assert.equal(snapshot.app.prompt, "product photo");
  assert.equal(snapshot.app.sourceAssetId, "asset-1");
  assert.deepEqual(snapshot.app.boardDocument, doc);
  assert.equal("legacySnapshot" in snapshot, false);
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```powershell
npx tsx src/components/board-canvas/board-document.test.ts
```

Expected: fails because `board-document.ts` does not exist.

- [ ] **Step 3: Implement the document module**

Create `src/components/board-canvas/board-document.ts`:

```ts
export const BOARD_DOCUMENT_VERSION = 1;

export type BoardImageObject = {
  assetId: string;
  h: number;
  id: string;
  rotation: number;
  type: "image";
  w: number;
  x: number;
  y: number;
};

export type BoardRectObject = {
  fill: string;
  h: number;
  id: string;
  rotation: number;
  stroke: string;
  strokeWidth: number;
  type: "rect";
  w: number;
  x: number;
  y: number;
};

export type BoardTextObject = {
  fill: string;
  fontSize: number;
  h: number;
  id: string;
  rotation: number;
  text: string;
  type: "text";
  w: number;
  x: number;
  y: number;
};

export type BoardPathObject = {
  id: string;
  points: number[];
  stroke: string;
  strokeWidth: number;
  type: "path";
};

export type BoardObject = BoardImageObject | BoardRectObject | BoardTextObject | BoardPathObject;

export type BoardPage = {
  id: string;
  name: string;
  objects: BoardObject[];
};

export type BoardDocument = {
  currentPageId: string;
  pages: BoardPage[];
  version: typeof BOARD_DOCUMENT_VERSION;
};

export type BoardAppSnapshot = Record<string, unknown> & {
  boardDocument?: BoardDocument;
};

export type PersistedBoardSnapshot = {
  app: BoardAppSnapshot;
};

export function createEmptyBoardDocument(): BoardDocument {
  return {
    currentPageId: "page-1",
    pages: [{ id: "page-1", name: "第 1 页", objects: [] }],
    version: BOARD_DOCUMENT_VERSION,
  };
}

export function createPersistedBoardSnapshot(
  boardDocument: BoardDocument,
  appSnapshot: Record<string, unknown>,
): PersistedBoardSnapshot {
  return {
    app: {
      ...appSnapshot,
      boardDocument,
    },
  };
}

export function getBoardDocumentFromSnapshot(snapshot: unknown): BoardDocument {
  const app = isRecord(snapshot) && isRecord(snapshot.app) ? snapshot.app : {};
  const candidate = isRecord(app.boardDocument) ? app.boardDocument : null;
  if (candidate) {
    const parsed = parseBoardDocument(candidate);
    if (parsed) return parsed;
  }
  const migrated = migrateLegacyCanvasImages(snapshot);
  return migrated ?? createEmptyBoardDocument();
}

function parseBoardDocument(value: Record<string, unknown>): BoardDocument | null {
  if (value.version !== BOARD_DOCUMENT_VERSION || !Array.isArray(value.pages)) return null;
  const pages = value.pages
    .map(parsePage)
    .filter((page): page is BoardPage => Boolean(page));
  if (pages.length === 0) return null;
  const currentPageId =
    typeof value.currentPageId === "string" && pages.some((page) => page.id === value.currentPageId)
      ? value.currentPageId
      : pages[0].id;
  return { currentPageId, pages, version: BOARD_DOCUMENT_VERSION };
}

function parsePage(value: unknown): BoardPage | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name : "第 1 页",
    objects: Array.isArray(value.objects) ? value.objects.map(parseObject).filter(Boolean) : [],
  } as BoardPage;
}

function parseObject(value: unknown): BoardObject | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.type !== "string") return null;
  if (value.type === "image") {
    if (typeof value.assetId !== "string") return null;
    return {
      assetId: value.assetId,
      h: safeNumber(value.h, 1024),
      id: value.id,
      rotation: safeNumber(value.rotation, 0),
      type: "image",
      w: safeNumber(value.w, 1024),
      x: safeNumber(value.x, 0),
      y: safeNumber(value.y, 0),
    };
  }
  if (value.type === "rect") {
    return {
      fill: typeof value.fill === "string" ? value.fill : "transparent",
      h: safeNumber(value.h, 120),
      id: value.id,
      rotation: safeNumber(value.rotation, 0),
      stroke: typeof value.stroke === "string" ? value.stroke : "#111827",
      strokeWidth: safeNumber(value.strokeWidth, 2),
      type: "rect",
      w: safeNumber(value.w, 160),
      x: safeNumber(value.x, 0),
      y: safeNumber(value.y, 0),
    };
  }
  if (value.type === "text") {
    return {
      fill: typeof value.fill === "string" ? value.fill : "#111827",
      fontSize: safeNumber(value.fontSize, 24),
      h: safeNumber(value.h, 80),
      id: value.id,
      rotation: safeNumber(value.rotation, 0),
      text: typeof value.text === "string" ? value.text : "",
      type: "text",
      w: safeNumber(value.w, 240),
      x: safeNumber(value.x, 0),
      y: safeNumber(value.y, 0),
    };
  }
  if (value.type === "path" && Array.isArray(value.points)) {
    return {
      id: value.id,
      points: value.points.filter((item): item is number => typeof item === "number" && Number.isFinite(item)),
      stroke: typeof value.stroke === "string" ? value.stroke : "#2563eb",
      strokeWidth: safeNumber(value.strokeWidth, 8),
      type: "path",
    };
  }
  return null;
}

function migrateLegacyCanvasImages(snapshot: unknown): BoardDocument | null {
  const legacyCanvas = getLegacyCanvasSnapshot(snapshot);
  const document = isRecord(legacyCanvas) && isRecord(legacyCanvas.document) ? legacyCanvas.document : legacyCanvas;
  const store = isRecord(document) && isRecord(document.store) ? document.store : null;
  if (!store) return null;

  const assets = new Map<string, string>();
  for (const record of Object.values(store)) {
    if (!isRecord(record) || record.typeName !== "asset" || record.type !== "image") continue;
    const dbAssetId = isRecord(record.meta) && typeof record.meta.dbAssetId === "string" ? record.meta.dbAssetId : "";
    if (typeof record.id === "string" && dbAssetId) assets.set(record.id, dbAssetId);
  }

  const objects: BoardObject[] = [];
  for (const record of Object.values(store)) {
    if (!isRecord(record) || record.typeName !== "shape" || record.type !== "image") continue;
    const props = isRecord(record.props) ? record.props : {};
    const assetId = typeof props.assetId === "string" ? assets.get(props.assetId) : undefined;
    if (!assetId || typeof record.id !== "string") continue;
    objects.push({
      assetId,
      h: safeNumber(props.h, 1024),
      id: record.id.replace(/^shape:/, "obj-"),
      rotation: safeNumber(record.rotation, 0),
      type: "image",
      w: safeNumber(props.w, 1024),
      x: safeNumber(record.x, 0),
      y: safeNumber(record.y, 0),
    });
  }

  if (objects.length === 0) return null;
  return {
    currentPageId: "page-1",
    pages: [{ id: "page-1", name: "第 1 页", objects }],
    version: BOARD_DOCUMENT_VERSION,
  };
}

function getLegacyCanvasSnapshot(snapshot: unknown): unknown {
  // Move the existing historical snapshot-key handling here from the current codebase.
  // Keep the real persisted key unchanged so old boards can still migrate.
  throw new Error("Move the existing historical snapshot-key handling here before enabling migration");
}

function safeNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
```

- [ ] **Step 4: Port historical snapshot-key handling**

Before running the document tests, replace the throwing `getLegacyCanvasSnapshot` placeholder with the existing historical snapshot-key handling from the current codebase. Add a fixture-based test that passes a real historical snapshot shape into `getBoardDocumentFromSnapshot` and asserts at least one image object is migrated.

Expected: `getLegacyCanvasSnapshot` no longer throws, and old boards can migrate on load.

- [ ] **Step 5: Add the test script entry**

Modify `package.json` test script so the beginning includes the new test:

```json
"test": "tsx src/components/board-canvas/board-document.test.ts && tsx src/lib/api-client.test.ts && node server/codex-oauth.test.mjs && node server/codex-auth-routes.test.mjs && node server/static.test.mjs"
```

- [ ] **Step 6: Run tests**

Run:

```powershell
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

Run:

```powershell
git add package.json src/components/board-canvas/board-document.ts src/components/board-canvas/board-document.test.ts
git commit -m "feat: add board document format"
```

Expected: commit succeeds.

---

### Task 3: Add Viewport Math

**Files:**
- Create: `src/components/board-canvas/viewport.ts`
- Create: `src/components/board-canvas/viewport.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing viewport tests**

Create `src/components/board-canvas/viewport.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { clampZoom, getObjectBounds, screenToWorld, worldToScreen, zoomAtPoint } from "./viewport";

test("worldToScreen and screenToWorld are inverse operations", () => {
  const viewport = { x: 40, y: 20, zoom: 2 };
  const screen = worldToScreen({ x: 100, y: 80 }, viewport);
  const world = screenToWorld(screen, viewport);

  assert.deepEqual(world, { x: 100, y: 80 });
});

test("zoomAtPoint keeps the world point under the cursor stable", () => {
  const viewport = { x: 0, y: 0, zoom: 1 };
  const screenPoint = { x: 500, y: 300 };
  const next = zoomAtPoint(viewport, screenPoint, 2);
  const world = screenToWorld(screenPoint, next);

  assert.deepEqual(world, { x: 500, y: 300 });
});

test("getObjectBounds returns bounds for image objects", () => {
  const bounds = getObjectBounds({
    assetId: "asset-1",
    h: 200,
    id: "obj-1",
    rotation: 0,
    type: "image",
    w: 300,
    x: 10,
    y: 20,
  });

  assert.deepEqual(bounds, { h: 200, w: 300, x: 10, y: 20 });
});

test("getObjectBounds includes rotated corners", () => {
  const bounds = getObjectBounds({
    assetId: "asset-1",
    h: 20,
    id: "obj-rotated",
    rotation: 90,
    type: "image",
    w: 10,
    x: 100,
    y: 50,
  });

  assert.deepEqual(bounds, { h: 10, w: 20, x: 80, y: 50 });
});

test("getObjectBounds handles diagonal rotation with rounded bounds", () => {
  const bounds = getObjectBounds({
    assetId: "asset-1",
    h: 10,
    id: "obj-diagonal",
    rotation: 45,
    type: "image",
    w: 10,
    x: 0,
    y: 0,
  });

  assertAlmostEqual(bounds.x, -7.071);
  assertAlmostEqual(bounds.y, 0);
  assertAlmostEqual(bounds.w, 14.142);
  assertAlmostEqual(bounds.h, 14.142);
});

function assertAlmostEqual(actual: number, expected: number, epsilon = 0.001) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not within ${epsilon} of ${expected}`);
}

test("clampZoom keeps zoom in supported range", () => {
  assert.equal(clampZoom(0.01), 0.1);
  assert.equal(clampZoom(10), 4);
  assert.equal(clampZoom(1.25), 1.25);
});
```

- [ ] **Step 2: Run viewport tests to verify they fail**

Run:

```powershell
npx tsx src/components/board-canvas/viewport.test.ts
```

Expected: fails because `viewport.ts` does not exist.

- [ ] **Step 3: Implement viewport helpers**

Create `src/components/board-canvas/viewport.ts`:

```ts
import type { BoardObject } from "./board-document";

export type Point = { x: number; y: number };
export type Bounds = { h: number; w: number; x: number; y: number };
export type BoardViewport = { x: number; y: number; zoom: number };

export const MIN_BOARD_ZOOM = 0.1;
export const MAX_BOARD_ZOOM = 4;

export function clampZoom(value: number) {
  return Math.min(MAX_BOARD_ZOOM, Math.max(MIN_BOARD_ZOOM, round(value)));
}

export function worldToScreen(point: Point, viewport: BoardViewport): Point {
  return {
    x: round(point.x * viewport.zoom + viewport.x),
    y: round(point.y * viewport.zoom + viewport.y),
  };
}

export function screenToWorld(point: Point, viewport: BoardViewport): Point {
  return {
    x: round((point.x - viewport.x) / viewport.zoom),
    y: round((point.y - viewport.y) / viewport.zoom),
  };
}

export function zoomAtPoint(
  viewport: BoardViewport,
  screenPoint: Point,
  nextZoomValue: number,
): BoardViewport {
  const nextZoom = clampZoom(nextZoomValue);
  const world = screenToWorld(screenPoint, viewport);
  return {
    x: round(screenPoint.x - world.x * nextZoom),
    y: round(screenPoint.y - world.y * nextZoom),
    zoom: nextZoom,
  };
}

export function getObjectBounds(object: BoardObject): Bounds {
  if (object.type === "path") {
    const xs = object.points.filter((_, index) => index % 2 === 0);
    const ys = object.points.filter((_, index) => index % 2 === 1);
    const minX = xs.length ? Math.min(...xs) : 0;
    const minY = ys.length ? Math.min(...ys) : 0;
    const maxX = xs.length ? Math.max(...xs) : minX;
    const maxY = ys.length ? Math.max(...ys) : minY;
    return { h: maxY - minY, w: maxX - minX, x: minX, y: minY };
  }
  return getRotatedBounds({
    h: object.h,
    rotation: object.rotation,
    w: object.w,
    x: object.x,
    y: object.y,
  });
}

function getRotatedBounds(box: Bounds & { rotation: number }): Bounds {
  const radians = degreesToRadians(box.rotation);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const corners = [
    { x: 0, y: 0 },
    { x: box.w, y: 0 },
    { x: box.w, y: box.h },
    { x: 0, y: box.h },
  ].map((point) => ({
    x: box.x + point.x * cos - point.y * sin,
    y: box.y + point.x * sin + point.y * cos,
  }));
  const minX = Math.min(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  const maxX = Math.max(...corners.map((point) => point.x));
  const maxY = Math.max(...corners.map((point) => point.y));
  return {
    h: round(maxY - minY),
    w: round(maxX - minX),
    x: round(minX),
    y: round(minY),
  };
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function fitBoundsToViewport(bounds: Bounds, viewportSize: { h: number; w: number }): BoardViewport {
  const padding = 80;
  const zoom = clampZoom(Math.min(
    (viewportSize.w - padding * 2) / Math.max(bounds.w, 1),
    (viewportSize.h - padding * 2) / Math.max(bounds.h, 1),
  ));
  return {
    x: round((viewportSize.w - bounds.w * zoom) / 2 - bounds.x * zoom),
    y: round((viewportSize.h - bounds.h * zoom) / 2 - bounds.y * zoom),
    zoom,
  };
}

export function getCombinedBounds(objects: BoardObject[]): Bounds | null {
  if (objects.length === 0) return null;
  const bounds = objects.map(getObjectBounds);
  const minX = Math.min(...bounds.map((item) => item.x));
  const minY = Math.min(...bounds.map((item) => item.y));
  const maxX = Math.max(...bounds.map((item) => item.x + item.w));
  const maxY = Math.max(...bounds.map((item) => item.y + item.h));
  return { h: maxY - minY, w: maxX - minX, x: minX, y: minY };
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
```

- [ ] **Step 4: Add viewport test to package test script**

Modify `package.json`:

```json
"test": "tsx src/components/board-canvas/board-document.test.ts && tsx src/components/board-canvas/viewport.test.ts && tsx src/lib/api-client.test.ts && node server/codex-oauth.test.mjs && node server/codex-auth-routes.test.mjs && node server/static.test.mjs"
```

- [ ] **Step 5: Run tests**

Run:

```powershell
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add package.json src/components/board-canvas/viewport.ts src/components/board-canvas/viewport.test.ts
git commit -m "feat: add board viewport math"
```

Expected: commit succeeds.

---

### Task 4: Build the Konva Canvas Component

**Files:**
- Create: `src/components/board-canvas/types.ts`
- Create: `src/components/board-canvas/useKonvaImage.ts`
- Create: `src/components/board-canvas/KonvaBoardCanvas.tsx`

- [ ] **Step 1: Extract shared payload types**

Create `src/components/board-canvas/types.ts` and move the UI payload types that are currently declared in `BoardWorkspace` into this shared module:

```ts
export type AssetPayload = {
  createdAt: string;
  height: number | null;
  id: string;
  kind: string;
  mimeType: string;
  name: string;
  publicUrl: string;
  size: number;
  width: number | null;
};

export type BoardPayload = {
  assets: AssetPayload[];
  createdAt: string;
  id: string;
  name: string;
  snapshotJson: unknown;
  updatedAt: string;
};

export type JobPayload = Record<string, unknown>;

export type ShapePlacement = {
  h?: number;
  w?: number;
  x?: number;
  y?: number;
};
```

Then update `BoardWorkspace` to import these types from `./board-canvas/types`. `KonvaBoardCanvas` must also import `AssetPayload` from this shared file, not from `BoardWorkspace`.

- [ ] **Step 2: Create the image loading hook**

Create `src/components/board-canvas/useKonvaImage.ts`:

```ts
import { useEffect, useState } from "react";

export function useKonvaImage(src: string | undefined) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!src) {
      setImage(null);
      setError(false);
      return;
    }
    let cancelled = false;
    const nextImage = new Image();
    nextImage.onload = () => {
      if (!cancelled) {
        setImage(nextImage);
        setError(false);
      }
    };
    nextImage.onerror = () => {
      if (!cancelled) {
        setImage(null);
        setError(true);
      }
    };
    nextImage.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  return { error, image };
}
```

- [ ] **Step 3: Create the Konva canvas shell**

Create `src/components/board-canvas/KonvaBoardCanvas.tsx` with these required implementation points:

- Measure `.konva-board-canvas` with `ResizeObserver`; do not use a fixed `1200 x 900` stage.
- Keep a `Map<string, Konva.Node>` ref registry keyed by board object id.
- Attach `Transformer` to selected nodes with `transformer.nodes(selectedNodes)` and call `transformer.getLayer()?.batchDraw()` whenever selection or page objects change.
- In mask mode, collect pointer down/move/up points over the selected source image, convert each point from screen coordinates to source-image pixel coordinates, render a draft `<Line />` on top of the board image, and call `onMaskStrokeComplete(points)` on pointer up.
- Expose the mounted stage through `onStageReady`.

Use this skeleton as the implementation target:

```tsx
import type Konva from "konva";
import { useEffect, useMemo, useRef, useState } from "react";
import { Image as KonvaImage, Layer, Line, Rect, Stage, Text, Transformer } from "react-konva";

import { apiUrl } from "@/lib/api-client";
import type { AssetPayload } from "./types";
import type { BoardDocument, BoardImageObject, BoardObject } from "./board-document";
import {
  fitBoundsToViewport,
  getCombinedBounds,
  screenToWorld,
  zoomAtPoint,
  type BoardViewport,
  type Point,
} from "./viewport";
import { useKonvaImage } from "./useKonvaImage";

type KonvaBoardCanvasProps = {
  assets: AssetPayload[];
  document: BoardDocument;
  isMaskMode: boolean;
  maskBrushSize: number;
  sourceAssetId: string;
  onChange: (document: BoardDocument) => void;
  onMaskStrokeComplete: (stroke: Point[]) => void;
  onSelectionChange: (ids: string[]) => void;
  onStageReady: (stage: Konva.Stage | null) => void;
  onViewportChange: (viewport: BoardViewport) => void;
  selectedObjectIds: string[];
  viewport: BoardViewport;
};

export function KonvaBoardCanvas(props: KonvaBoardCanvasProps) {
  const {
    assets,
    document,
    isMaskMode,
    maskBrushSize,
    sourceAssetId,
    onChange,
    onMaskStrokeComplete,
    onSelectionChange,
    onStageReady,
    onViewportChange,
    selectedObjectIds,
    viewport,
  } = props;
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const nodeRefs = useRef(new Map<string, Konva.Node>());
  const [stageSize, setStageSize] = useState({ h: 1, w: 1 });
  const [maskDraft, setMaskDraft] = useState<Point[] | null>(null);
  const page = document.pages.find((item) => item.id === document.currentPageId) ?? document.pages[0];
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const sourceObject = page.objects.find(
    (object) => object.type === "image" && object.assetId === sourceAssetId,
  );
  const sourceAsset = sourceObject?.type === "image" ? assetById.get(sourceObject.assetId) : undefined;

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({
        h: Math.max(1, Math.round(entry.contentRect.height)),
        w: Math.max(1, Math.round(entry.contentRect.width)),
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    const selected = selectedObjectIds
      .map((id) => nodeRefs.current.get(id))
      .filter((node): node is Konva.Node => Boolean(node));
    transformer.nodes(selected);
    transformer.getLayer()?.batchDraw();
  }, [page.objects, selectedObjectIds]);

  function setNodeRef(id: string, node: Konva.Node | null) {
    if (node) nodeRefs.current.set(id, node);
    else nodeRefs.current.delete(id);
  }

  function updateObject(nextObject: BoardObject) {
    onChange({
      ...document,
      pages: document.pages.map((item) =>
        item.id === page.id
          ? { ...item, objects: item.objects.map((object) => (object.id === nextObject.id ? nextObject : object)) }
          : item,
      ),
    });
  }

  function getPointerWorldPoint() {
    const pointer = stageRef.current?.getPointerPosition();
    return pointer ? screenToWorld(pointer, viewport) : null;
  }

  function getPointerMaskPoint() {
    const worldPoint = getPointerWorldPoint();
    if (!worldPoint || !sourceObject || sourceObject.type !== "image" || !sourceAsset) return null;
    const naturalWidth = sourceAsset.width ?? sourceObject.w;
    const naturalHeight = sourceAsset.height ?? sourceObject.h;
    const rotation = degreesToRadians(-sourceObject.rotation);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const dx = worldPoint.x - sourceObject.x;
    const dy = worldPoint.y - sourceObject.y;
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;
    if (localX < 0 || localY < 0 || localX > sourceObject.w || localY > sourceObject.h) return null;
    return {
      x: Math.round((localX / sourceObject.w) * naturalWidth),
      y: Math.round((localY / sourceObject.h) * naturalHeight),
    };
  }

  function maskPointToWorld(point: Point) {
    if (!sourceObject || sourceObject.type !== "image" || !sourceAsset) return point;
    const naturalWidth = sourceAsset.width ?? sourceObject.w;
    const naturalHeight = sourceAsset.height ?? sourceObject.h;
    const localX = (point.x / naturalWidth) * sourceObject.w;
    const localY = (point.y / naturalHeight) * sourceObject.h;
    const rotation = degreesToRadians(sourceObject.rotation);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return {
      x: sourceObject.x + localX * cos - localY * sin,
      y: sourceObject.y + localX * sin + localY * cos,
    };
  }

  function degreesToRadians(value: number) {
    return (value * Math.PI) / 180;
  }

  return (
    <div ref={wrapperRef} className="konva-board-canvas" tabIndex={0}>
      <Stage
        ref={(node) => {
          stageRef.current = node;
          onStageReady(node);
        }}
        width={stageSize.w}
        height={stageSize.h}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.zoom}
        scaleY={viewport.zoom}
        onPointerDown={(event) => {
          if (!isMaskMode) {
            if (event.target === event.target.getStage()) onSelectionChange([]);
            return;
          }
          const point = getPointerMaskPoint();
          if (point) setMaskDraft([point]);
        }}
        onPointerMove={() => {
          if (!isMaskMode || !maskDraft) return;
          const point = getPointerMaskPoint();
          if (point) setMaskDraft((current) => (current ? [...current, point] : [point]));
        }}
        onPointerUp={() => {
          if (!isMaskMode || !maskDraft) return;
          onMaskStrokeComplete(maskDraft);
          setMaskDraft(null);
        }}
        onWheel={(event) => {
          event.evt.preventDefault();
          const pointer = event.target.getStage()?.getPointerPosition();
          if (!pointer) return;
          const factor = event.evt.deltaY > 0 ? 0.92 : 1.08;
          onViewportChange(zoomAtPoint(viewport, pointer, viewport.zoom * factor));
        }}
      >
        <Layer>
          <Rect fill="#f8fafc" height={20000} width={20000} x={-10000} y={-10000} listening={false} />
          {page.objects.map((object) => {
            if (object.type === "image") {
              const asset = assetById.get(object.assetId);
              return (
                <BoardImage
                  assetUrl={asset ? apiUrl(asset.publicUrl) : undefined}
                  isMaskMode={isMaskMode}
                  key={object.id}
                  object={object}
                  onChange={updateObject}
                  onSelect={() => onSelectionChange([object.id])}
                  setNodeRef={setNodeRef}
                />
              );
            }
            return null;
          })}
          {maskDraft ? (
            <Line
              points={maskDraft.flatMap((point) => {
                const worldPoint = maskPointToWorld(point);
                return [worldPoint.x, worldPoint.y];
              })}
              stroke="#2563eb"
              strokeWidth={maskBrushSize}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
          ) : null}
          <Transformer ref={transformerRef} rotateEnabled />
        </Layer>
      </Stage>
      <button
        className="konva-board-fit"
        onClick={() => {
          const bounds = getCombinedBounds(page.objects);
          if (bounds) onViewportChange(fitBoundsToViewport(bounds, stageSize));
        }}
        type="button"
      >
        适应全部
      </button>
    </div>
  );
}

function BoardImage({
  assetUrl,
  isMaskMode,
  object,
  onChange,
  onSelect,
  setNodeRef,
}: {
  assetUrl: string | undefined;
  isMaskMode: boolean;
  object: BoardImageObject;
  onChange: (object: BoardImageObject) => void;
  onSelect: () => void;
  setNodeRef: (id: string, node: Konva.Node | null) => void;
}) {
  const { image } = useKonvaImage(assetUrl);
  return (
    <>
      <KonvaImage
        ref={(node) => setNodeRef(object.id, node)}
        draggable={!isMaskMode}
        height={object.h}
        image={image ?? undefined}
        onClick={onSelect}
        onDragEnd={(event) => onChange({ ...object, x: event.target.x(), y: event.target.y() })}
        onTransformEnd={(event) => {
          const node = event.target;
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          node.scaleX(1);
          node.scaleY(1);
          onChange({
            ...object,
            h: Math.max(10, node.height() * scaleY),
            rotation: node.rotation(),
            w: Math.max(10, node.width() * scaleX),
            x: node.x(),
            y: node.y(),
          });
        }}
        rotation={object.rotation}
        width={object.w}
        x={object.x}
        y={object.y}
      />
      {!image ? (
        <Rect
          dash={[8, 6]}
          height={object.h}
          listening={false}
          stroke="#94a3b8"
          width={object.w}
          x={object.x}
          y={object.y}
        />
      ) : null}
    </>
  );
}
```

- [ ] **Step 4: Run typecheck through build**

Run:

```powershell
npm run build
```

Expected: build fails only on unused props or exact Konva typings if any field needs adjustment.

- [ ] **Step 4: Fix type errors without changing behavior**

Apply the minimum type fixes reported by `npm run build`. Keep public props unchanged:

```ts
type KonvaBoardCanvasProps = {
  assets: AssetPayload[];
  document: BoardDocument;
  isMaskMode: boolean;
  onChange: (document: BoardDocument) => void;
  onSelectionChange: (ids: string[]) => void;
  onViewportChange: (viewport: BoardViewport) => void;
  selectedObjectIds: string[];
  viewport: BoardViewport;
};
```

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/components/board-canvas/useKonvaImage.ts src/components/board-canvas/KonvaBoardCanvas.tsx
git commit -m "feat: add konva board canvas"
```

Expected: commit succeeds.

---

### Task 5: Integrate BoardDocument Into BoardWorkspace

**Files:**
- Modify: `src/components/BoardWorkspace.tsx`

- [ ] **Step 1: Replace old canvas state with board document state**

In `src/components/BoardWorkspace.tsx`, remove old canvas store/editor state and add:

```tsx
import { KonvaBoardCanvas } from "./board-canvas/KonvaBoardCanvas";
import {
  createPersistedBoardSnapshot,
  getBoardDocumentFromSnapshot,
  type BoardDocument,
  type BoardObject,
} from "./board-canvas/board-document";
import type { BoardViewport } from "./board-canvas/viewport";
```

Add state near the existing board state:

```tsx
const konvaStageRef = useRef<Konva.Stage | null>(null);
const [boardDocument, setBoardDocument] = useState<BoardDocument>(() =>
  getBoardDocumentFromSnapshot(initialSnapshot),
);
const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
const [viewport, setViewport] = useState<BoardViewport>({ x: 0, y: 0, zoom: 1 });
const currentPage =
  boardDocument.pages.find((page) => page.id === boardDocument.currentPageId) ??
  boardDocument.pages[0];
```

Add a helper that always reads the latest app fields before saving. This prevents inserts and autosaves from persisting a stale snapshot after React state updates have been scheduled:

```tsx
const buildAppSnapshot = useCallback((overrides: Partial<AppSnapshot> = {}): AppSnapshot => ({
  editImageSize,
  generationCount,
  maskBrushRatio,
  maskFeatherRatio,
  maskState,
  preserveStrength,
  prompt,
  referenceAssetIds,
  referenceAssetIdsByRole,
  referenceFit,
  referenceItems,
  replacementType,
  sourceAssetId,
  sourceImageSize,
  sourcePrompt,
  toolbarPinnedActionIds,
  ...overrides,
}), [
  editImageSize,
  generationCount,
  maskBrushRatio,
  maskFeatherRatio,
  maskState,
  preserveStrength,
  prompt,
  referenceAssetIds,
  referenceAssetIdsByRole,
  referenceFit,
  referenceItems,
  replacementType,
  sourceAssetId,
  sourceImageSize,
  sourcePrompt,
  toolbarPinnedActionIds,
]);
```

- [ ] **Step 2: Replace page/selection info derivation**

Replace editor-driven `updateSelectionInfo` calls with this derived state:

```tsx
const selectedObjects = currentPage.objects.filter((object) => selectedObjectIds.includes(object.id));
const selectionInfo = {
  hasLockedShape: false,
  hasSelectedGroup: false,
  pageShapeCount: currentPage.objects.length,
  selectedCount: selectedObjects.length,
};
const pages = boardDocument.pages.map((page, index) => ({
  id: page.id,
  index,
  name: page.name,
}));
const currentPageId = boardDocument.currentPageId;
```

- [ ] **Step 3: Replace saveSnapshot implementation**

Replace old canvas snapshot creation with:

```tsx
const saveSnapshot = useCallback(async (options: {
  allowEmptyOverwrite?: boolean;
  appSnapshot?: AppSnapshot;
  document?: BoardDocument;
} = {}) => {
  const nextDocument = options.document ?? boardDocument;
  setStatus("正在保存");
  const appSnapshot = options.appSnapshot ?? buildAppSnapshot();
  const snapshot = createPersistedBoardSnapshot(nextDocument, appSnapshot);
  const response = await apiFetch(
    `/api/boards/${board.id}/snapshot${options.allowEmptyOverwrite ? "?allowEmpty=1" : ""}`,
    {
      body: JSON.stringify({ snapshot }),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    },
  );
  setStatus(response.ok ? "已保存" : "保存失败");
}, [
  board.id,
  boardDocument,
  buildAppSnapshot,
]);
```

- [ ] **Step 4: Replace the canvas render**

Replace the old canvas component block with:

```tsx
<KonvaBoardCanvas
  assets={board.assets}
  document={boardDocument}
  isMaskMode={currentToolId === "mask"}
  maskBrushSize={Math.max(1, Math.round(maskBrushRatio * 80))}
  sourceAssetId={sourceAssetId}
  onChange={(nextDocument) => {
    setBoardDocument(nextDocument);
    scheduleSave(nextDocument);
  }}
  onMaskStrokeComplete={(stroke) => {
    if (!sourceAssetId || stroke.length === 0) return;
    setMaskState((current) => ({
      assetId: sourceAssetId,
      strokes: current?.assetId === sourceAssetId ? [...current.strokes, stroke] : [stroke],
    }));
  }}
  onSelectionChange={setSelectedObjectIds}
  onStageReady={(stage) => {
    konvaStageRef.current = stage;
  }}
  onViewportChange={setViewport}
  selectedObjectIds={selectedObjectIds}
  viewport={viewport}
/>
```

Adjust `scheduleSave` to accept an optional document:

```tsx
const scheduleSave = useCallback((document?: BoardDocument) => {
  if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  saveTimerRef.current = setTimeout(() => {
    void saveSnapshot({ document });
  }, 900);
}, [saveSnapshot]);
```

- [ ] **Step 5: Run build**

Run:

```powershell
npm run build
```

Expected: build reports remaining old editor references. Keep the error list for Task 6.

- [ ] **Step 6: Commit the partial integration only when build is clean**

After Task 6 removes remaining editor references and build passes, commit both tasks together if Task 5 alone cannot compile.

---

### Task 6: Replace Old Editor Operations With BoardDocument Operations

**Files:**
- Modify: `src/components/BoardWorkspace.tsx`

- [ ] **Step 1: Add document mutation helpers**

Add these helpers inside `BoardWorkspace`:

```tsx
function updateBoardDocument(nextDocument: BoardDocument) {
  setBoardDocument(nextDocument);
  scheduleSave(nextDocument);
  return nextDocument;
}

function updateCurrentPageObjects(updater: (objects: BoardObject[]) => BoardObject[]) {
  const nextDocument = {
    ...boardDocument,
    pages: boardDocument.pages.map((page) =>
      page.id === boardDocument.currentPageId
        ? { ...page, objects: updater(page.objects) }
        : page,
    ),
  };
  return updateBoardDocument(nextDocument);
}

function createObjectId(prefix = "obj") {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
```

- [ ] **Step 2: Replace `insertAsset`**

Replace `insertAsset` with:

```tsx
async function insertAsset(asset: AssetPayload, placement?: ShapePlacement, batchCount = 1) {
  const width = getSafeAssetDimension(asset.width);
  const height = getSafeAssetDimension(asset.height);
  const targetWidth = placement?.w ?? Math.min(width, 640);
  const displayWidth = batchCount > 1 ? Math.min(targetWidth, 300) : targetWidth;
  const targetHeight = placement?.h ?? Math.round((targetWidth / width) * height);
  const displayHeight = batchCount > 1
    ? Math.round((displayWidth / targetWidth) * targetHeight)
    : targetHeight;
  const object = {
    assetId: asset.id,
    h: displayHeight,
    id: createObjectId("image"),
    rotation: 0,
    type: "image" as const,
    w: displayWidth,
    x: placement?.x ?? DEFAULT_IMAGE_INSERT_X,
    y: placement?.y ?? DEFAULT_IMAGE_INSERT_Y,
  };
  const nextDocument = updateCurrentPageObjects((objects) => [...objects, object]);
  setSelectedObjectIds([object.id]);
  setSourceAssetId(asset.id);
  await saveSnapshot({
    appSnapshot: buildAppSnapshot({ sourceAssetId: asset.id }),
    document: nextDocument,
  });
  return { h: displayHeight, w: displayWidth, x: object.x, y: object.y };
}
```

- [ ] **Step 3: Replace selection helpers**

Replace `getSelectedImageAsset(editorRef.current, board.assets)` call sites with:

```tsx
function getSelectedImageAssetFromDocument() {
  const selected = currentPage.objects.find(
    (object) => selectedObjectIds.includes(object.id) && object.type === "image",
  );
  if (!selected || selected.type !== "image") return null;
  return board.assets.find((asset) => asset.id === selected.assetId) ?? null;
}
```

Use it in source/edit actions:

```tsx
const selected = getSelectedImageAssetFromDocument();
if (!selected) {
  setStatus("请先选择一张画板图片");
  return;
}
setSourceAssetId(selected.id);
```

- [ ] **Step 4: Replace delete/duplicate/select-all**

Use these implementations:

```tsx
function selectAllShapes() {
  setSelectedObjectIds(currentPage.objects.map((object) => object.id));
}

function duplicateSelectedShapes() {
  const selected = new Set(selectedObjectIds);
  const copies = currentPage.objects
    .filter((object) => selected.has(object.id))
    .map((object): BoardObject => {
      if (object.type === "path") {
        return {
          ...object,
          id: createObjectId("path"),
          points: object.points.map((point, index) => point + (index % 2 === 0 ? 32 : 32)),
        };
      }
      return {
        ...object,
        id: createObjectId(object.type),
        x: object.x + 32,
        y: object.y + 32,
      };
    });
  updateCurrentPageObjects((objects) => [...objects, ...copies]);
  setSelectedObjectIds(copies.map((object) => object.id));
}

function deleteSelectedShapes() {
  const selected = new Set(selectedObjectIds);
  updateCurrentPageObjects((objects) => objects.filter((object) => !selected.has(object.id)));
  setSelectedObjectIds([]);
}
```

- [ ] **Step 5: Replace clear current page**

Use:

```tsx
function clearCurrentPage() {
  updateCurrentPageObjects(() => []);
  setSelectedObjectIds([]);
  setSourceAssetId("");
  setReferenceAssetIds([]);
  setReferenceItems([]);
  setReferenceAssetIdsByRole({});
  setMaskState(null);
  setStatus(currentPage.objects.length > 0 ? "已清空当前页面" : "当前页面已是空白");
}
```

- [ ] **Step 6: Run build**

Run:

```powershell
npm run build
```

Expected: no TypeScript errors from removed editor references.

- [ ] **Step 7: Commit**

Run:

```powershell
git add src/components/BoardWorkspace.tsx
git commit -m "feat: integrate konva board document"
```

Expected: commit succeeds.

---

### Task 7: Restore Export and Mask Workflows

**Files:**
- Create: `src/components/board-canvas/export-board.ts`
- Modify: `src/components/board-canvas/KonvaBoardCanvas.tsx`
- Modify: `src/components/BoardWorkspace.tsx`

- [ ] **Step 1: Add export helper**

Create `src/components/board-canvas/export-board.ts`:

```ts
import Konva from "konva";
import { apiUrl } from "@/lib/api-client";
import type { BoardObject } from "./board-document";
import { getCombinedBounds } from "./viewport";
import type { AssetPayload } from "./types";

type ExportOptions = {
  assets: AssetPayload[];
  objects: BoardObject[];
  pixelRatio?: number;
};

export async function exportObjectsToPng({ assets, objects, pixelRatio = 2 }: ExportOptions) {
  const bounds = getCombinedBounds(objects);
  if (!bounds) {
    throw new Error("画板为空，无法导出");
  }

  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const stage = new Konva.Stage({
    container: document.createElement("div"),
    height: Math.max(1, bounds.h),
    width: Math.max(1, bounds.w),
  });
  const layer = new Konva.Layer();
  const group = new Konva.Group({
    x: -bounds.x,
    y: -bounds.y,
  });
  stage.add(layer);
  layer.add(group);

  for (const object of objects) {
    if (object.type === "image") {
      const asset = assetById.get(object.assetId);
      if (!asset) continue;
      const image = await loadImage(apiUrl(asset.publicUrl));
      group.add(new Konva.Image({
        height: object.h,
        image,
        rotation: object.rotation,
        width: object.w,
        x: object.x,
        y: object.y,
      }));
    }
    if (object.type === "rect") {
      group.add(new Konva.Rect({
        fill: object.fill,
        height: object.h,
        rotation: object.rotation,
        stroke: object.stroke,
        strokeWidth: object.strokeWidth,
        width: object.w,
        x: object.x,
        y: object.y,
      }));
    }
    if (object.type === "text") {
      group.add(new Konva.Text({
        fill: object.fill,
        fontSize: object.fontSize,
        height: object.h,
        rotation: object.rotation,
        text: object.text,
        width: object.w,
        x: object.x,
        y: object.y,
      }));
    }
    if (object.type === "path") {
      group.add(new Konva.Line({
        points: object.points,
        stroke: object.stroke,
        strokeWidth: object.strokeWidth,
      }));
    }
  }

  layer.draw();
  const dataUrl = stage.toDataURL({
    mimeType: "image/png",
    pixelRatio,
  });
  stage.destroy();
  return dataUrl;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败，无法导出"));
    image.src = src;
  });
}
```

- [ ] **Step 2: Confirm mask drawing is implemented in KonvaBoardCanvas**

Task 4 must already include this behavior in `KonvaBoardCanvas`:

- `onMaskStrokeComplete: (stroke: Point[]) => void` in props.
- Pointer down starts a draft stroke only when `isMaskMode` is true.
- Pointer move appends source-image pixel points by converting screen coordinates through viewport and source image transform.
- Pointer up calls `onMaskStrokeComplete(maskDraft)` and clears the draft.
- The in-progress stroke is converted back to world/page coordinates and rendered as a non-listening `Line` preview.

- [ ] **Step 3: Rewrite PNG export in BoardWorkspace**

Replace PNG export logic with:

```tsx
async function exportSelectionAsPng() {
  const selected = new Set(selectedObjectIds);
  const exportObjects =
    selectedObjectIds.length > 0
      ? currentPage.objects.filter((object) => selected.has(object.id))
      : currentPage.objects;
  try {
    const dataUrl = await exportObjectsToPng({
      assets: board.assets,
      objects: exportObjects,
    });
    const blob = await (await fetch(dataUrl)).blob();
    const filename = createBoardImageFilename("png");
    const output = await saveBlobToLocalExport(blob, filename);
    downloadBlob(blob, filename);
    setStatus(`已导出 PNG，并保存到 ${output.relativePath}`);
  } catch (error) {
    setStatus(getFriendlyErrorMessage(error, "导出 PNG 失败"));
  }
}
```

- [ ] **Step 4: Keep mask state independent from the old canvas runtime**

In `BoardWorkspace`, pass the callback already shown in Task 5:

```tsx
onMaskStrokeComplete={(stroke) => {
  if (!sourceAssetId || stroke.length === 0) return;
  setMaskState((current) => ({
    assetId: sourceAssetId,
    strokes: current?.assetId === sourceAssetId ? [...current.strokes, stroke] : [stroke],
  }));
}}
```

- [ ] **Step 5: Run build and lint**

Run:

```powershell
npm run build
npm run lint
```

Expected: both pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/components/board-canvas/export-board.ts src/components/board-canvas/KonvaBoardCanvas.tsx src/components/BoardWorkspace.tsx
git commit -m "feat: restore export and mask workflows"
```

Expected: commit succeeds.

---

### Manual Gate: Confirm Old Runtime Packages

Before starting Task 8, a human/operator must identify the exact direct dependency names to remove:

```powershell
npm ls --depth=0
rg -n "from .*canvas|from .*draw|from .*editor|from .*state|from .*schema" src package.json
```

Record the confirmed package names in the Task 8 `$packagesToRemove` array. Do not let a sub-agent proceed into Task 8 until this gate is complete.

---

### Task 8: Remove Old Canvas Runtime Surface

**Files:**
- Modify: `src/components/BoardWorkspace.tsx`
- Modify: `server/routes/boards.ts`
- Modify: `src/client/main.tsx`
- Modify: `src/app/globals.css`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Remove or disable unsupported old-runtime-only UI actions**

Before uninstalling the old runtime packages, audit every toolbar/menu action that previously delegated to `editorRef.current` or old editor commands. For this rebuild MVP, keep only the image-board core:

- Asset insertion from 素材.
- AI generated or edited image insertion.
- Select, drag, resize, rotate, duplicate, delete, select-all, clear page.
- Page list display and current-page switching only if backed by `BoardDocument`.
- Source image selection and mask drawing.
- PNG export of full board or current selection.

Remove or disable these actions until Konva equivalents are explicitly rebuilt and tested:

- old snapshot import/export.
- SVG export.
- group/ungroup.
- align/distribute/pack/stretch.
- lock/unlock.
- stack/order commands if not implemented against `BoardDocument`.
- selection-region export if it depended on old editor bounds APIs.

Acceptance criteria:

```powershell
rg -n "editorRef|group|ungroup|align|distribute|pack|stretch|exportSvg|SVG" src/components/BoardWorkspace.tsx
```

Expected: no live old-runtime-only action remains wired in the UI. Any unsupported feature either has no button/menu entry or is visibly disabled with no runtime call path.

- [ ] **Step 2: Remove old runtime imports and constants**

In `src/components/BoardWorkspace.tsx`, remove imports from:

```powershell
rg -n "from .*canvas|from .*state|from .*schema|AiMaskBrushTool|editorRef" src/components/BoardWorkspace.tsx
```

Remove the imports, constants, and custom tool bridge code reported by that scan. The resulting file must not import any old editor runtime package, old editor state package, or old editor schema package.

Remove constants with these responsibilities:

```ts
declare const __AIBOARD_OLD_CANVAS_LICENSE_KEY__: string | undefined;
const oldCanvasLicenseKey = __AIBOARD_OLD_CANVAS_LICENSE_KEY__ || undefined;
const runtimeOldCanvasLicenseKey = getRuntimeConfig().oldCanvasLicenseKey || undefined;
const oldCanvasAssetUrls = { ... };
const aiMaskTools = [AiMaskBrushTool] as const;
```

- [ ] **Step 3: Update server snapshot helpers to the BoardDocument structure**

In `server/routes/boards.ts`, replace old canvas-shape detection with `BoardDocument`-aware object-count logic:

- `allowEmpty` overwrite protection must check `snapshot.app.boardDocument.pages[].objects.length`, not old shape records.
- keep the existing generic recursive asset reference rewrite if present; confirm it covers `app.boardDocument.pages[].objects[].assetId` and any asset URLs in app metadata.
- historical snapshot migration remains a frontend/load concern unless the server needs to inspect object counts.

Acceptance criteria:

```powershell
rg -n "hasCanvasShapes|getLegacy.*Snapshot|getOld.*Snapshot|typeName.*shape|shape.*image" server/routes/boards.ts
```

Expected: no server route decision depends on old shape-store records. `getBoardDocumentFromSnapshot` is allowed if the server imports the new BoardDocument parser. Generic recursive asset reference rewriting should remain if it already covers `app.boardDocument`.

- [ ] **Step 4: Remove old runtime CSS import**

In `src/client/main.tsx`, remove:

```powershell
rg -n "runtime\\.css|canvas.*\\.css|editor.*\\.css" src/client/main.tsx
```

Remove any old editor runtime stylesheet import found by this scan.

- [ ] **Step 5: Verify old runtime dependency removal list**

Use the package names confirmed in the manual gate:

```powershell
$packagesToRemove = @(
  # "exact-package-name-1",
  # "exact-package-name-2"
)
if ($packagesToRemove.Count -eq 0) { throw "Manual gate incomplete: packagesToRemove is empty." }
Write-Output $packagesToRemove
```

Expected: the exact package names to uninstall are printed.

- [ ] **Step 6: Remove old runtime dependencies after confirmation**

Run only after Step 5 has been confirmed:

```powershell
npm uninstall @packagesToRemove
```

Expected: `package.json` and `package-lock.json` no longer include the direct dependencies that provided the old board editor runtime.

- [ ] **Step 7: Remove old runtime CSS selectors**

In `src/app/globals.css`, delete rules scoped to:

```css
.old-canvas-container
.old-canvas-surface
.old-canvas-background
.old-runtime-ui
```

Add Konva scoped shell styles:

```css
.konva-board-canvas {
  height: 100%;
  min-height: 0;
  outline: none;
  position: relative;
  width: 100%;
}

.konva-board-fit {
  bottom: 18px;
  position: absolute;
  right: 18px;
  z-index: 5;
}
```

- [ ] **Step 8: Search for remaining old runtime references**

Run:

```powershell
rg -n "oldCanvasLicenseKey|oldCanvasAssetUrls|AiMaskBrushTool|editorRef|runtime\\.css|editor.*\\.css" src package.json
```

Expected: no runtime imports, old editor refs, old tool classes, or old runtime constants remain. Legacy snapshot migration code can remain only if it is isolated in `src/components/board-canvas/board-document.ts` and has no runtime package import.

- [ ] **Step 9: Run validation**

Run:

```powershell
npm run build
npm test
npm run lint
```

Expected: all pass.

- [ ] **Step 10: Commit**

Run:

```powershell
git add package.json package-lock.json server/routes/boards.ts src/client/main.tsx src/components/BoardWorkspace.tsx src/app/globals.css
git commit -m "refactor: remove old canvas runtime"
```

Expected: commit succeeds.

---

### Task 9: Add Browser Smoke Coverage

**Files:**
- Create: `scripts/smoke-konva-board.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create the smoke script**

Create `scripts/smoke-konva-board.mjs`:

```js
import { chromium } from "playwright";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3333";
const username = process.env.SMOKE_USERNAME;
const password = process.env.SMOKE_PASSWORD;
const boardId = process.env.SMOKE_BOARD_ID;

if (!username || !password || !boardId) {
  throw new Error("Set SMOKE_USERNAME, SMOKE_PASSWORD, and SMOKE_BOARD_ID");
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});

await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
await page.fill('input[name="username"]', username);
await page.fill('input[name="password"]', password);
await page.click('form button[type="submit"]');
await page.waitForURL("**/", { timeout: 10000 }).catch(() => undefined);
await page.goto(`${baseUrl}/boards/${boardId}`, { waitUntil: "networkidle" });
await page.waitForSelector(".konva-board-canvas canvas", { timeout: 15000 });
await page.waitForTimeout(7000);

const result = await page.evaluate(() => {
  const canvases = Array.from(document.querySelectorAll(".konva-board-canvas canvas"));
  const sample = canvases
    .map((canvas) => {
      const context = canvas.getContext("2d");
      if (!context || canvas.width === 0 || canvas.height === 0) return false;
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let index = 0; index < imageData.length; index += 4) {
        const alpha = imageData[index + 3];
        const red = imageData[index];
        const green = imageData[index + 1];
        const blue = imageData[index + 2];
        if (alpha > 0 && (red < 245 || green < 245 || blue < 245)) return true;
      }
      return false;
    })
    .some(Boolean);
  return {
    canvasCount: canvases.length,
    hasNonBlankCanvasPixels: sample,
    hasObjectCount: /1\s*个对象|[1-9]\d*\s*个对象/.test(document.body.innerText),
    text: document.body.innerText,
  };
});

if (result.canvasCount === 0) {
  throw new Error("Konva canvas did not render");
}
if (!result.hasObjectCount) {
  throw new Error("Board object count is missing from page text");
}
if (!result.hasNonBlankCanvasPixels) {
  throw new Error("Konva canvas rendered but no non-blank pixels were detected");
}
if (consoleErrors.length > 0) {
  throw new Error(`Browser console errors: ${consoleErrors.join("\\n")}`);
}

await browser.close();
console.log(JSON.stringify(result, null, 2));
```

- [ ] **Step 2: Add npm script**

Modify `package.json`:

```json
"smoke:konva-board": "node scripts/smoke-konva-board.mjs"
```

- [ ] **Step 3: Run local smoke against a prepared board**

Run:

```powershell
$env:SMOKE_BASE_URL="http://127.0.0.1:3333"
$env:SMOKE_USERNAME="<local approved username>"
$env:SMOKE_PASSWORD="<local password>"
$env:SMOKE_BOARD_ID="<local board id with at least one image asset>"
npm run smoke:konva-board
```

Expected:

```json
{
  "canvasCount": 2,
  "hasNonBlankCanvasPixels": true,
  "hasObjectCount": true,
  "text": "..."
}
```

- [ ] **Step 4: Commit**

Run:

```powershell
git add package.json scripts/smoke-konva-board.mjs
git commit -m "test: add konva board smoke test"
```

Expected: commit succeeds.

---

### Task 10: Fix Asset Library Listing and Preview Actions

**Files:**
- Modify: `server/routes/boards.ts`
- Modify: `src/components/BoardWorkspace.tsx`
- Modify: `scripts/smoke-konva-board.mjs`

- [ ] **Step 1: Diagnose the material library visibility limit**

Do not assume the root cause is the server query. First add stable test hooks to the material list in `BoardWorkspace`:

```tsx
<div className="asset-list" data-testid="asset-list" data-asset-count={imageAssets.length}>
  {imageAssets.map((asset) => (
    <div
      className={existingAssetCardClassName}
      data-testid="asset-card"
      key={asset.id}
    >
      {/* keep the existing asset preview trigger and labels here */}
    </div>
  ))}
</div>
```

Then use Playwright evaluation to compare these counts on a board with at least 9 image assets:

```js
const counts = await page.evaluate(() => ({
  listAssetCount: Number(document.querySelector("[data-testid='asset-list']")?.getAttribute("data-asset-count") ?? 0),
  domAssetCards: document.querySelectorAll("[data-testid='asset-card']").length,
  visibleAssetCards: Array.from(document.querySelectorAll("[data-testid='asset-card']")).filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }).length,
}));
```

Keep `data-testid="asset-list"`, `data-asset-count`, and `data-testid="asset-card"` as permanent smoke selectors. The diagnosis must identify whether the limit comes from API data, `imageAssets`, DOM rendering, CSS overflow, mobile tab state, or pagination.

- [ ] **Step 2: Remove the server-side asset cap if API data is capped**

If `/api/boards/:id` returns fewer assets than exist in the database, update `server/routes/boards.ts`:

```ts
assets: { orderBy: { createdAt: "desc" } },
```

This removes the board-detail asset cap. Keep this change only if the diagnosis confirms the API was truncating data.

- [ ] **Step 3: Keep generated job history capped separately**

Do not remove the `jobs: { ... take: 20 }` cap unless the UI explicitly adds pagination. The bug is about the material library showing too few usable assets, not about the generation-history summary.

- [ ] **Step 4: Audit client-side asset rendering for accidental caps**

Search:

```powershell
rg -n "imageAssets\\.(slice|filter|map)|board\\.assets\\.(slice|filter|map)|take:|limit|slice\\(0, 8\\)|slice\\(0, 6\\)" src/components/BoardWorkspace.tsx server/routes
```

Expected:

- The current material grid renders all `imageAssets`, not `imageAssets.slice(0, 8)`.
- Any remaining `slice(0, 6)` is limited to generated-history summaries, not the material grid.
- Reference-image caps still use `MAX_REFERENCE_ASSETS = 8`; that is a selection limit, not the material library display limit.

- [ ] **Step 5: Preserve asset preview modal actions**

When replacing old editor operations, keep the preview modal buttons wired to document-based actions:

```tsx
<button onClick={() => loadAssetToCanvas(assetPreviewAsset)} type="button">
  载入画板
</button>
<button onClick={() => downloadAsset(assetPreviewAsset)} type="button">
  下载
</button>
```

`loadAssetToCanvas` must call the Task 6 `insertAsset` document helper. `downloadAsset` must fetch `apiUrl(asset.publicUrl)` and call the existing `downloadBlob` path; it must not depend on old editor state.

- [ ] **Step 6: Add material library and download coverage to smoke**

Extend `scripts/smoke-konva-board.mjs` to assert that a board with more than 8 assets can render more than 8 asset cards in the material panel. Use a prepared board id with at least 9 image assets:

```js
const assetCards = await page.locator("[data-testid='asset-card']").count();
if (assetCards <= 8) {
  throw new Error(`Expected more than 8 visible asset cards, got ${assetCards}`);
}
```

The smoke must rely only on `data-testid="asset-card"` and `data-testid="asset-list"` for material-library assertions.

Also verify the preview modal download button works:

```js
await page.locator("[data-testid='asset-card']").first().click();
const downloadPromise = page.waitForEvent("download");
await page.getByRole("button", { name: "下载" }).click();
const download = await downloadPromise;
if (!download.suggestedFilename()) {
  throw new Error("Asset download did not provide a filename");
}
```

- [ ] **Step 7: Run validation**

Run:

```powershell
npm run build
npm test
```

Expected: both pass.

- [ ] **Step 8: Commit**

Run:

```powershell
git add server/routes/boards.ts src/components/BoardWorkspace.tsx scripts/smoke-konva-board.mjs
git commit -m "fix: show full material library"
```

Expected: commit succeeds.

---

### Task 11: Deploy and Verify Production

**Files:**
- No source files changed in this task.

- [ ] **Step 1: Build locally**

Run:

```powershell
npm run build
```

Expected: build passes and outputs `dist/client` plus `dist/server`.

- [ ] **Step 2: Deploy without changing production data**

Use the existing deployment method for `aiboard.aipowers.site`. First resolve the service directory from the current production unit:

```powershell
$serviceName = (
  systemctl list-units --type=service --all --no-legend |
    Select-String "ai-board|board" |
    Select-Object -First 1
).ToString().Trim().Split(" ", [System.StringSplitOptions]::RemoveEmptyEntries)[0]
if (-not $serviceName) { throw "Unable to infer service name; inspect docs/*.service and the remote unit list manually." }
systemctl cat $serviceName
```

Preserve the app's production data paths under that resolved service directory:

```text
<service-dir>/.env
<service-dir>/prisma/dev.db
<service-dir>/public/uploads
<service-dir>/local-exports
<service-dir>/generated-images
```

Expected: service restarts with the new build.

- [ ] **Step 3: Check service status**

Run on the server:

```powershell
systemctl is-active $serviceName
systemctl show -p MainPID -p ActiveState -p SubState $serviceName
```

Expected:

```text
active
ActiveState=active
SubState=running
```

- [ ] **Step 4: Run production smoke**

Run locally:

```powershell
$env:SMOKE_BASE_URL="https://aiboard.aipowers.site"
$env:SMOKE_USERNAME="<approved production test username>"
$env:SMOKE_PASSWORD="<production test password>"
$env:SMOKE_BOARD_ID="<production test board id>"
npm run smoke:konva-board
```

Expected: the smoke test passes after waiting beyond the previous disappearance window.

- [ ] **Step 5: Confirm old bug is gone**

Manual browser checks:

```text
1. Open a board.
2. Open 素材.
3. Click an image.
4. Click 载入画板.
5. Wait 10 seconds.
6. Confirm the image remains visible.
7. Refresh the page.
8. Confirm the image remains visible.
9. Trigger autosave by moving the image.
10. Confirm the image remains visible after status changes to 已保存.
```

Expected: the image remains visible throughout.

- [ ] **Step 6: Commit deployment notes if this repo tracks verification**

Append to `verification.md`:

```md
## Konva Board Rebuild Verification

- `npm run build`: pass
- `npm test`: pass
- `npm run lint`: pass
- `npm run smoke:konva-board`: pass against production
- Production service: active
- Manual check: image remains visible after load, autosave, and refresh
```

Run:

```powershell
git add verification.md
git commit -m "docs: record konva board verification"
```

Expected: commit succeeds if `verification.md` is updated.

---

## Self-Review

**Spec coverage:**

- Replace old runtime-gated canvas: covered by Tasks 4, 5, 6, and 8.
- Preserve image asset loading from 素材: covered by Tasks 5, 6, and 9.
- Preserve full material library visibility beyond 8 historical assets: covered by Task 10.
- Preserve asset preview download: covered by Task 10.
- Preserve AI generated/edited image insertion: covered by Task 6 through `insertAsset`.
- Preserve autosave: covered by Task 5 through `BoardDocument` persistence.
- Preserve refresh visibility: covered by Tasks 2 and 10.
- Preserve PNG export and mask workflow: covered by Task 7.
- Avoid bypassing the old runtime: covered by Task 8 removal rather than patching.

**Completeness scan:**

Every new source file has concrete code or a concrete discovery command. Deployment resolves `$serviceName` and the service directory before changing remote files.

**Type consistency:**

`BoardDocument`, `BoardObject`, `BoardViewport`, `AssetPayload`, and callback names are consistent across tasks. Shared payload types live in `src/components/board-canvas/types.ts` so `KonvaBoardCanvas` does not depend on `BoardWorkspace`. The integration plan uses `BoardWorkspace` as the owner of business state and `KonvaBoardCanvas` as a controlled rendering component.
