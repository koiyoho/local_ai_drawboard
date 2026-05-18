export const BOARD_DOCUMENT_VERSION = 1;

export type BoardLayerMetadata = {
  groupCollapsed?: boolean;
  groupId?: string;
  groupName?: string;
  hidden?: boolean;
  locked?: boolean;
  name?: string;
};

export type BoardImageObject = BoardLayerMetadata & {
  id: string;
  type: "image";
  assetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
};

export type BoardRectObject = BoardLayerMetadata & {
  id: string;
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
};

export type BoardTextObject = BoardLayerMetadata & {
  id: string;
  type: "text";
  x: number;
  y: number;
  text: string;
  rotation: number;
};

export type BoardPathObject = BoardLayerMetadata & {
  id: string;
  type: "path";
  points: Array<{ x: number; y: number }>;
  rotation: number;
};

export type BoardObject = BoardImageObject | BoardRectObject | BoardTextObject | BoardPathObject;
export type BoardAlignment = "left" | "centerX" | "right" | "top" | "centerY" | "bottom";
export type BoardDistribution = "horizontal" | "vertical";
export type BoardReorderAction = "front" | "back" | "forward" | "backward";
export type BoardPoint = { x: number; y: number };
export type BoardAutoLayoutMode = "grid" | "beforeAfter";
export type BoardAutoLayoutOptions = {
  columns?: number;
  gap?: number;
  mode: BoardAutoLayoutMode;
  origin?: BoardPoint;
};

export type BoardPage = {
  id: string;
  name: string;
  objects: BoardObject[];
};

export type BoardDocument = {
  version: typeof BOARD_DOCUMENT_VERSION;
  currentPageId: string;
  pages: BoardPage[];
};

export type BoardHistory = {
  document: BoardDocument;
  past: BoardDocument[];
  future: BoardDocument[];
  canUndo: boolean;
  canRedo: boolean;
};

export type BoardAppSnapshot = Record<string, unknown>;

export type PersistedBoardSnapshot = {
  app: BoardAppSnapshot & {
    boardDocument: BoardDocument;
  };
};

const DEFAULT_PAGE_ID = "page:1";
const DEFAULT_PAGE_NAME = "第 1 页";
const DEFAULT_OBJECT_DIMENSION = 100;

// Historical runtime payload keys are intentionally not persisted under app.
const LEGACY_APP_SNAPSHOT_KEYS = new Set(["tldraw", "document", "store", "legacySnapshot"]);

export function createEmptyBoardDocument(): BoardDocument {
  return {
    version: BOARD_DOCUMENT_VERSION,
    currentPageId: DEFAULT_PAGE_ID,
    pages: [
      {
        id: DEFAULT_PAGE_ID,
        name: DEFAULT_PAGE_NAME,
        objects: [],
      },
    ],
  };
}

export function createPersistedBoardSnapshot(
  boardDocument: BoardDocument,
  appSnapshot: BoardAppSnapshot,
): PersistedBoardSnapshot {
  const persistableAppSnapshot = Object.fromEntries(
    Object.entries(appSnapshot).filter(([key]) => !LEGACY_APP_SNAPSHOT_KEYS.has(key)),
  );

  return {
    app: {
      ...persistableAppSnapshot,
      boardDocument,
    },
  };
}

export function getBoardDocumentFromSnapshot(snapshot: unknown): BoardDocument {
  const newFormatDocument = getNewFormatBoardDocument(snapshot);
  if (newFormatDocument) return newFormatDocument;

  const migratedDocument = migrateHistoricalImageSnapshot(snapshot);
  if (migratedDocument) return migratedDocument;

  return createEmptyBoardDocument();
}

export function createBoardHistory(document: BoardDocument): BoardHistory {
  return createHistory(document, [], []);
}

export function pushBoardHistory(history: BoardHistory, document: BoardDocument): BoardHistory {
  if (history.document === document || areBoardDocumentsEqual(history.document, document)) return history;
  return createHistory(document, [...history.past, history.document].slice(-50), []);
}

export function undoBoardHistory(history: BoardHistory): BoardHistory {
  const previousDocument = history.past.at(-1);
  if (!previousDocument) return history;
  return createHistory(previousDocument, history.past.slice(0, -1), [history.document, ...history.future]);
}

export function redoBoardHistory(history: BoardHistory): BoardHistory {
  const nextDocument = history.future[0];
  if (!nextDocument) return history;
  return createHistory(nextDocument, [...history.past, history.document].slice(-50), history.future.slice(1));
}

export function removeUnlockedObjectsFromCurrentPage(document: BoardDocument, objectIds: string[]) {
  const selectedIds = new Set(objectIds);
  const removedObjectIds: string[] = [];
  const nextDocument = {
    ...document,
    pages: document.pages.map((page) => {
      if (page.id !== document.currentPageId) return page;
      return {
        ...page,
        objects: page.objects.filter((object) => {
          if (!selectedIds.has(object.id) || object.locked) return true;
          removedObjectIds.push(object.id);
          return false;
        }),
      };
    }),
  };

  return { document: nextDocument, removedObjectIds };
}

export function alignObjectsOnCurrentPage(
  document: BoardDocument,
  objectIds: string[],
  alignment: BoardAlignment,
) {
  const selectedIds = new Set(objectIds);
  const editableObjects = getCurrentPageEditableBoxObjects(document).filter((object) => selectedIds.has(object.id));
  if (editableObjects.length < 2) return { changedObjectIds: [], document };
  const bounds = getObjectsBounds(editableObjects);
  const changedObjectIds: string[] = [];
  const nextDocument = updateCurrentPageObjectsForDocument(document, (objects) =>
    objects.map((object) => {
      if (!selectedIds.has(object.id) || object.locked || !hasObjectBox(object)) return object;
      const nextPosition = getAlignedPosition(object, bounds, alignment);
      if (nextPosition.x === object.x && nextPosition.y === object.y) return object;
      changedObjectIds.push(object.id);
      return { ...object, ...nextPosition };
    }),
  );
  return { changedObjectIds, document: nextDocument };
}

export function distributeObjectsOnCurrentPage(
  document: BoardDocument,
  objectIds: string[],
  distribution: BoardDistribution,
) {
  const selectedIds = new Set(objectIds);
  const editableObjects = getCurrentPageEditableBoxObjects(document).filter((object) => selectedIds.has(object.id));
  if (editableObjects.length < 3) return { changedObjectIds: [], document };
  const sortedObjects = [...editableObjects].sort((left, right) =>
    distribution === "horizontal" ? left.x - right.x : left.y - right.y,
  );
  const first = sortedObjects[0];
  const last = sortedObjects.at(-1);
  if (!first || !last) return { changedObjectIds: [], document };
  const firstCenter = distribution === "horizontal" ? first.x + first.w / 2 : first.y + first.h / 2;
  const lastCenter = distribution === "horizontal" ? last.x + last.w / 2 : last.y + last.h / 2;
  const gap = (lastCenter - firstCenter) / (sortedObjects.length - 1);
  const nextPositions = new Map<string, { x: number; y: number }>();
  sortedObjects.forEach((object, index) => {
    const center = firstCenter + gap * index;
    nextPositions.set(object.id, {
      x: distribution === "horizontal" ? center - object.w / 2 : object.x,
      y: distribution === "vertical" ? center - object.h / 2 : object.y,
    });
  });

  const changedObjectIds: string[] = [];
  const nextDocument = updateCurrentPageObjectsForDocument(document, (objects) =>
    objects.map((object) => {
      const nextPosition = nextPositions.get(object.id);
      if (!nextPosition || !hasObjectBox(object)) return object;
      if (nextPosition.x === object.x && nextPosition.y === object.y) return object;
      changedObjectIds.push(object.id);
      return { ...object, ...nextPosition };
    }),
  );
  return { changedObjectIds, document: nextDocument };
}

export function reorderObjectsOnCurrentPage(
  document: BoardDocument,
  objectIds: string[],
  action: BoardReorderAction,
) {
  const selectedIds = new Set(objectIds);
  let changedObjectIds: string[] = [];
  const nextDocument = updateCurrentPageObjectsForDocument(document, (objects) => {
    const selectedObjects = objects.filter((object) => selectedIds.has(object.id) && !object.locked);
    if (selectedObjects.length === 0) return objects;
    const selectedObjectIds = new Set(selectedObjects.map((object) => object.id));
    const remainingObjects = objects.filter((object) => !selectedObjectIds.has(object.id));
    const reorderedObjects =
      action === "front"
        ? [...remainingObjects, ...selectedObjects]
        : action === "back"
          ? [...selectedObjects, ...remainingObjects]
          : moveSelectedObjectsOneLayer(objects, selectedObjectIds, action);
    if (haveObjectOrdersEqual(objects, reorderedObjects)) return objects;
    changedObjectIds = selectedObjects.map((object) => object.id);
    return reorderedObjects;
  });
  if (changedObjectIds.length === 0) return { changedObjectIds, document };
  return { changedObjectIds, document: nextDocument };
}

export function duplicateObjectsOnCurrentPage(
  document: BoardDocument,
  objectIds: string[],
  options: { idPrefix?: string; offset?: BoardPoint } = {},
) {
  const selectedIds = new Set(objectIds);
  const offset = options.offset ?? { x: 24, y: 24 };
  const idPrefix = options.idPrefix ?? "copy";
  const createdObjectIds: string[] = [];
  const nextDocument = updateCurrentPageObjectsForDocument(document, (objects) => {
    const selectedObjects = objects.filter((object) => selectedIds.has(object.id) && !object.locked);
    if (selectedObjects.length === 0) return objects;
    const existingIds = new Set(objects.map((object) => object.id));
    const copies = selectedObjects.map((object) => {
      const id = getNextObjectId(existingIds, idPrefix);
      existingIds.add(id);
      createdObjectIds.push(id);
      return cloneBoardObjectWithOffset(object, id, offset);
    });
    return [...objects, ...copies];
  });
  if (createdObjectIds.length === 0) return { createdObjectIds, document };
  return { createdObjectIds, document: nextDocument };
}

export function moveObjectsOnCurrentPage(document: BoardDocument, objectIds: string[], delta: BoardPoint) {
  if (delta.x === 0 && delta.y === 0) return { changedObjectIds: [], document };
  const selectedIds = new Set(objectIds);
  const changedObjectIds: string[] = [];
  const nextDocument = updateCurrentPageObjectsForDocument(document, (objects) =>
    objects.map((object) => {
      if (!selectedIds.has(object.id) || object.locked) return object;
      changedObjectIds.push(object.id);
      return moveBoardObject(object, delta);
    }),
  );
  if (changedObjectIds.length === 0) return { changedObjectIds, document };
  return { changedObjectIds, document: nextDocument };
}

export function groupObjectsOnCurrentPage(
  document: BoardDocument,
  objectIds: string[],
  options: { groupId?: string; name?: string } = {},
) {
  const selectedIds = new Set(objectIds);
  const editableObjects = getCurrentPageObjects(document).filter((object) => selectedIds.has(object.id) && !object.locked);
  if (editableObjects.length < 2) return { changedObjectIds: [], document, groupId: "" };
  const existingIds = new Set(getCurrentPageObjects(document).map((object) => object.groupId).filter(isNonEmptyString));
  const groupId = options.groupId ?? getNextObjectId(existingIds, "group");
  const groupName = normalizeGroupName(options.name) ?? `分组 ${existingIds.size + 1}`;
  const changedObjectIds: string[] = [];
  const nextDocument = updateCurrentPageObjectsForDocument(document, (objects) =>
    objects.map((object) => {
      if (!selectedIds.has(object.id) || object.locked) return object;
      changedObjectIds.push(object.id);
      const nextObject = { ...object, groupId, groupName };
      delete nextObject.groupCollapsed;
      return nextObject;
    }),
  );
  return { changedObjectIds, document: nextDocument, groupId };
}

export function ungroupObjectsOnCurrentPage(document: BoardDocument, objectIds: string[]) {
  const selectedIds = new Set(objectIds);
  const groupIds = new Set(
    getCurrentPageObjects(document)
      .filter((object) => selectedIds.has(object.id) && object.groupId)
      .map((object) => object.groupId)
      .filter(isNonEmptyString),
  );
  if (groupIds.size === 0) return { changedObjectIds: [], document };
  const changedObjectIds: string[] = [];
  const nextDocument = updateCurrentPageObjectsForDocument(document, (objects) =>
    objects.map((object) => {
      if (!object.groupId || !groupIds.has(object.groupId) || object.locked) return object;
      changedObjectIds.push(object.id);
      const nextObject = { ...object };
      delete nextObject.groupCollapsed;
      delete nextObject.groupId;
      delete nextObject.groupName;
      return nextObject;
    }),
  );
  return { changedObjectIds, document: nextDocument };
}

export function toggleGroupCollapsedOnCurrentPage(
  document: BoardDocument,
  groupId: string,
  collapsed: boolean,
  visibleObjectId?: string,
) {
  if (!groupId) return { changedObjectIds: [], document };
  const groupObjects = getCurrentPageObjects(document).filter((object) => object.groupId === groupId);
  if (groupObjects.length === 0) return { changedObjectIds: [], document };
  const fallbackVisibleObjectId = visibleObjectId ?? groupObjects[0]?.id;
  const changedObjectIds: string[] = [];
  const nextDocument = updateCurrentPageObjectsForDocument(document, (objects) =>
    objects.map((object) => {
      if (object.groupId !== groupId) return object;
      changedObjectIds.push(object.id);
      if (collapsed) {
        const nextObject = { ...object, groupCollapsed: true };
        if (object.id === fallbackVisibleObjectId) delete nextObject.hidden;
        else nextObject.hidden = true;
        return nextObject;
      }
      const nextObject = { ...object };
      delete nextObject.groupCollapsed;
      delete nextObject.hidden;
      return nextObject;
    }),
  );
  return { changedObjectIds, document: nextDocument };
}

export function resolveGroupedSelectionOnCurrentPage(document: BoardDocument, objectIds: string[]) {
  const currentObjects = getCurrentPageObjects(document);
  const selectedIds = new Set(objectIds);
  const selectedGroupIds = new Set(
    currentObjects
      .filter((object) => selectedIds.has(object.id) && object.groupId && !object.hidden && !object.locked)
      .map((object) => object.groupId)
      .filter(isNonEmptyString),
  );
  const resolvedIds: string[] = [];
  for (const object of currentObjects) {
    const isSelectedGroupMember = Boolean(object.groupId && selectedGroupIds.has(object.groupId));
    const isDirectlySelected = selectedIds.has(object.id);
    if (!isDirectlySelected && !isSelectedGroupMember) continue;
    if (object.hidden || object.locked) continue;
    if (!resolvedIds.includes(object.id)) resolvedIds.push(object.id);
  }
  return resolvedIds;
}

export function autoLayoutObjectsOnCurrentPage(
  document: BoardDocument,
  objectIds: string[],
  options: BoardAutoLayoutOptions,
) {
  const selectedIds = new Set(objectIds);
  const layoutObjects = getCurrentPageEditableBoxObjects(document).filter(
    (object) => selectedIds.has(object.id) && object.type === "image",
  );
  if (layoutObjects.length < (options.mode === "beforeAfter" ? 2 : 1)) {
    return { changedObjectIds: [], document };
  }

  const gap = Math.max(0, options.gap ?? 32);
  const origin = options.origin ?? getAutoLayoutOrigin(layoutObjects);
  const nextObjects = options.mode === "beforeAfter"
    ? getBeforeAfterLayoutObjects(layoutObjects.slice(0, 2), origin, gap)
    : getGridLayoutObjects(layoutObjects, origin, gap, options.columns);
  const nextObjectById = new Map(nextObjects.map((object) => [object.id, object]));
  const changedObjectIds: string[] = [];
  const nextDocument = updateCurrentPageObjectsForDocument(document, (objects) =>
    objects.map((object) => {
      const nextObject = nextObjectById.get(object.id);
      if (!nextObject) return object;
      if (JSON.stringify(object) === JSON.stringify(nextObject)) return object;
      changedObjectIds.push(object.id);
      return nextObject;
    }),
  );
  return { changedObjectIds, document: nextDocument };
}

export function appendObjectsToCurrentPage(document: BoardDocument, objects: BoardObject[]) {
  if (objects.length === 0) return { createdObjectIds: [], document };
  const createdObjectIds = objects.map((object) => object.id);
  const nextDocument = updateCurrentPageObjectsForDocument(document, (currentObjects) => [...currentObjects, ...objects]);
  return { createdObjectIds, document: nextDocument };
}

function createHistory(document: BoardDocument, past: BoardDocument[], future: BoardDocument[]): BoardHistory {
  return {
    canRedo: future.length > 0,
    canUndo: past.length > 0,
    document,
    future,
    past,
  };
}

function areBoardDocumentsEqual(left: BoardDocument, right: BoardDocument) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function updateCurrentPageObjectsForDocument(
  document: BoardDocument,
  update: (objects: BoardObject[]) => BoardObject[],
): BoardDocument {
  return {
    ...document,
    pages: document.pages.map((page) =>
      page.id === document.currentPageId ? { ...page, objects: update(page.objects) } : page,
    ),
  };
}

function getCurrentPageObjects(document: BoardDocument) {
  return document.pages.find((page) => page.id === document.currentPageId)?.objects ?? [];
}

function getCurrentPageEditableBoxObjects(document: BoardDocument) {
  return document.pages
    .find((page) => page.id === document.currentPageId)
    ?.objects.filter((object): object is BoardImageObject | BoardRectObject => hasObjectBox(object) && !object.locked) ?? [];
}

function hasObjectBox(object: BoardObject): object is BoardImageObject | BoardRectObject {
  return (object.type === "image" || object.type === "rect") && "w" in object && "h" in object;
}

function getObjectsBounds(objects: Array<BoardImageObject | BoardRectObject>) {
  const left = Math.min(...objects.map((object) => object.x));
  const top = Math.min(...objects.map((object) => object.y));
  const right = Math.max(...objects.map((object) => object.x + object.w));
  const bottom = Math.max(...objects.map((object) => object.y + object.h));
  return { bottom, left, right, top };
}

function getAlignedPosition(
  object: BoardImageObject | BoardRectObject,
  bounds: { bottom: number; left: number; right: number; top: number },
  alignment: BoardAlignment,
) {
  if (alignment === "left") return { x: bounds.left, y: object.y };
  if (alignment === "centerX") return { x: (bounds.left + bounds.right) / 2 - object.w / 2, y: object.y };
  if (alignment === "right") return { x: bounds.right - object.w, y: object.y };
  if (alignment === "top") return { x: object.x, y: bounds.top };
  if (alignment === "centerY") return { x: object.x, y: (bounds.top + bounds.bottom) / 2 - object.h / 2 };
  return { x: object.x, y: bounds.bottom - object.h };
}

function getAutoLayoutOrigin(objects: Array<BoardImageObject | BoardRectObject>) {
  const bounds = getObjectsBounds(objects);
  return { x: bounds.left, y: bounds.top };
}

function getGridLayoutObjects(
  objects: Array<BoardImageObject | BoardRectObject>,
  origin: BoardPoint,
  gap: number,
  requestedColumns?: number,
) {
  const columns = Math.max(1, requestedColumns ?? Math.ceil(Math.sqrt(objects.length)));
  const cellWidth = Math.max(...objects.map((object) => object.w));
  const cellHeight = Math.max(...objects.map((object) => object.h));
  return objects.map((object, index) => ({
    ...object,
    x: origin.x + (index % columns) * (cellWidth + gap),
    y: origin.y + Math.floor(index / columns) * (cellHeight + gap),
  }));
}

function getBeforeAfterLayoutObjects(
  objects: Array<BoardImageObject | BoardRectObject>,
  origin: BoardPoint,
  gap: number,
) {
  const [before, after] = objects;
  if (!before || !after) return [];
  const width = before.w;
  const height = before.h;
  return [
    { ...before, name: "Before", x: origin.x, y: origin.y },
    { ...after, h: height, name: "After", w: width, x: origin.x + width + gap, y: origin.y },
  ];
}

function moveSelectedObjectsOneLayer(
  objects: BoardObject[],
  selectedIds: Set<string>,
  action: Extract<BoardReorderAction, "forward" | "backward">,
) {
  const nextObjects = [...objects];
  if (action === "forward") {
    for (let index = nextObjects.length - 2; index >= 0; index -= 1) {
      if (!selectedIds.has(nextObjects[index]?.id ?? "")) continue;
      if (selectedIds.has(nextObjects[index + 1]?.id ?? "")) continue;
      [nextObjects[index], nextObjects[index + 1]] = [nextObjects[index + 1], nextObjects[index]];
    }
    return nextObjects;
  }
  for (let index = 1; index < nextObjects.length; index += 1) {
    if (!selectedIds.has(nextObjects[index]?.id ?? "")) continue;
    if (selectedIds.has(nextObjects[index - 1]?.id ?? "")) continue;
    [nextObjects[index - 1], nextObjects[index]] = [nextObjects[index], nextObjects[index - 1]];
  }
  return nextObjects;
}

function haveObjectOrdersEqual(left: BoardObject[], right: BoardObject[]) {
  return left.length === right.length && left.every((object, index) => object.id === right[index]?.id);
}

function cloneBoardObjectWithOffset(object: BoardObject, id: string, offset: BoardPoint): BoardObject {
  if (object.type === "path") {
    const copyableObject = getUnlockedCopyableObject(object);
    return {
      ...copyableObject,
      id,
      points: object.points.map((point) => ({ x: point.x + offset.x, y: point.y + offset.y })),
    };
  }
  const copyableObject = getUnlockedCopyableObject(object);
  return {
    ...copyableObject,
    id,
    x: object.x + offset.x,
    y: object.y + offset.y,
  };
}

function moveBoardObject(object: BoardObject, delta: BoardPoint): BoardObject {
  if (object.type === "path") {
    return {
      ...object,
      points: object.points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y })),
    };
  }
  return {
    ...object,
    x: object.x + delta.x,
    y: object.y + delta.y,
  };
}

function getNextObjectId(existingIds: Set<string>, prefix: string) {
  let index = 1;
  let id = `${prefix}-${index}`;
  while (existingIds.has(id)) {
    index += 1;
    id = `${prefix}-${index}`;
  }
  return id;
}

function getUnlockedCopyableObject<TObject extends BoardObject>(object: TObject) {
  const copy = { ...object };
  delete copy.locked;
  return copy;
}

function getNewFormatBoardDocument(snapshot: unknown): BoardDocument | null {
  if (!isRecord(snapshot) || !isRecord(snapshot.app)) return null;
  if (!isRecord(snapshot.app.boardDocument)) return null;
  return parseBoardDocument(snapshot.app.boardDocument);
}

function parseBoardDocument(value: Record<string, unknown>): BoardDocument | null {
  if (value.version !== BOARD_DOCUMENT_VERSION) return null;
  if (!Array.isArray(value.pages)) return null;

  const pages = value.pages.map(parseBoardPage).filter((page): page is BoardPage => Boolean(page));
  if (pages.length === 0) return null;

  const fallbackPageId = pages[0]?.id ?? DEFAULT_PAGE_ID;
  const requestedPageId = typeof value.currentPageId === "string" ? value.currentPageId : fallbackPageId;
  const currentPageId = pages.some((page) => page.id === requestedPageId) ? requestedPageId : fallbackPageId;

  return {
    version: BOARD_DOCUMENT_VERSION,
    currentPageId,
    pages,
  };
}

function parseBoardPage(value: unknown): BoardPage | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || value.id.length === 0) return null;

  return {
    id: value.id,
    name: typeof value.name === "string" && value.name.length > 0 ? value.name : DEFAULT_PAGE_NAME,
    objects: Array.isArray(value.objects) ? value.objects.map(parseBoardObject).filter(isBoardObject) : [],
  };
}

function parseBoardObject(value: unknown): BoardObject | null {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) return null;
  if (value.type === "image") return parseBoardImageObject(value);
  if (value.type === "rect") return parseBoardRectObject(value);
  if (value.type === "text") return parseBoardTextObject(value);
  if (value.type === "path") return parseBoardPathObject(value);
  return null;
}

function parseBoardImageObject(value: Record<string, unknown>): BoardImageObject | null {
  if (typeof value.assetId !== "string" || value.assetId.length === 0) return null;
  return {
    id: value.id as string,
    type: "image",
    ...getLayerMetadata(value),
    assetId: value.assetId,
    x: getNumber(value.x),
    y: getNumber(value.y),
    w: getPositiveDimension(value.w),
    h: getPositiveDimension(value.h),
    rotation: getNumber(value.rotation),
  };
}

function parseBoardRectObject(value: Record<string, unknown>): BoardRectObject | null {
  return {
    id: value.id as string,
    type: "rect",
    ...getLayerMetadata(value),
    x: getNumber(value.x),
    y: getNumber(value.y),
    w: getPositiveDimension(value.w),
    h: getPositiveDimension(value.h),
    rotation: getNumber(value.rotation),
  };
}

function parseBoardTextObject(value: Record<string, unknown>): BoardTextObject | null {
  return {
    id: value.id as string,
    type: "text",
    ...getLayerMetadata(value),
    x: getNumber(value.x),
    y: getNumber(value.y),
    text: typeof value.text === "string" ? value.text : "",
    rotation: getNumber(value.rotation),
  };
}

function parseBoardPathObject(value: Record<string, unknown>): BoardPathObject | null {
  return {
    id: value.id as string,
    type: "path",
    ...getLayerMetadata(value),
    points: Array.isArray(value.points) ? value.points.map(parsePoint).filter(isPoint) : [],
    rotation: getNumber(value.rotation),
  };
}

function getLayerMetadata(value: Record<string, unknown>): BoardLayerMetadata {
  return {
    ...(typeof value.groupId === "string" && value.groupId.trim()
      ? { groupId: value.groupId.trim().slice(0, 80) }
      : {}),
    ...(typeof value.groupName === "string" && value.groupName.trim()
      ? { groupName: value.groupName.trim().slice(0, 80) }
      : {}),
    ...(value.groupCollapsed === true ? { groupCollapsed: true } : {}),
    ...(typeof value.name === "string" && value.name.trim()
      ? { name: value.name.trim().slice(0, 80) }
      : {}),
    ...(value.hidden === true ? { hidden: true } : {}),
    ...(value.locked === true ? { locked: true } : {}),
  };
}

function normalizeGroupName(value: string | undefined) {
  const name = value?.trim();
  return name ? name.slice(0, 80) : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function migrateHistoricalImageSnapshot(snapshot: unknown): BoardDocument | null {
  const documentSnapshot = getHistoricalCanvasDocumentSnapshot(snapshot);
  if (!documentSnapshot) return null;

  const assetDbIds = new Map<string, string>();
  for (const record of Object.values(documentSnapshot.store)) {
    if (!isRecord(record) || record.typeName !== "asset" || record.type !== "image") continue;
    if (!isRecord(record.meta) || typeof record.meta.dbAssetId !== "string") continue;
    assetDbIds.set(String(record.id), record.meta.dbAssetId);
  }

  const images: BoardImageObject[] = [];
  for (const record of Object.values(documentSnapshot.store)) {
    if (!isRecord(record) || record.typeName !== "shape" || record.type !== "image") continue;
    if (!isRecord(record.props) || typeof record.props.assetId !== "string") continue;

    const dbAssetId = assetDbIds.get(record.props.assetId);
    if (!dbAssetId) continue;

    images.push({
      id: typeof record.id === "string" && record.id.length > 0 ? record.id : `image:${images.length + 1}`,
      type: "image",
      assetId: dbAssetId,
      x: getNumber(record.x),
      y: getNumber(record.y),
      w: getPositiveDimension(record.props.w),
      h: getPositiveDimension(record.props.h),
      rotation: getNumber(record.rotation),
    });
  }

  if (images.length === 0) return null;

  return {
    version: BOARD_DOCUMENT_VERSION,
    currentPageId: DEFAULT_PAGE_ID,
    pages: [
      {
        id: DEFAULT_PAGE_ID,
        name: DEFAULT_PAGE_NAME,
        objects: images,
      },
    ],
  };
}

function getHistoricalCanvasDocumentSnapshot(snapshot: unknown): { store: Record<string, unknown> } | null {
  const canvasSnapshot = getHistoricalCanvasSnapshot(snapshot);
  if (!isRecord(canvasSnapshot)) return null;
  if (isRecord(canvasSnapshot.document) && isRecord(canvasSnapshot.document.store)) {
    return { store: canvasSnapshot.document.store };
  }
  if (isRecord(canvasSnapshot.store)) {
    return { store: canvasSnapshot.store };
  }
  return null;
}

function getHistoricalCanvasSnapshot(snapshot: unknown): unknown {
  return isRecord(snapshot) && "tldraw" in snapshot ? snapshot.tldraw : snapshot;
}

function parsePoint(value: unknown): { x: number; y: number } | null {
  if (!isRecord(value)) return null;
  return {
    x: getNumber(value.x),
    y: getNumber(value.y),
  };
}

function getNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getPositiveDimension(value: unknown, fallback = DEFAULT_OBJECT_DIMENSION) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function isBoardObject(value: BoardObject | null): value is BoardObject {
  return Boolean(value);
}

function isPoint(value: { x: number; y: number } | null): value is { x: number; y: number } {
  return Boolean(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
