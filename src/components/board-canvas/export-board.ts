"use client";

import Konva from "konva";
import { apiUrl } from "@/lib/api-client";
import { formatDateTimeNumber, sanitizeFilenameSegment } from "@/lib/filenames";
import type { BoardObject } from "./board-document";
import type { AssetPayload } from "./types";
import { getCombinedBounds } from "./viewport";

type ExportObjectsToPngInput = {
  assets: AssetPayload[];
  objects: BoardObject[];
  pixelRatio?: number;
};
export type BatchExportMode = "groups" | "page" | "selection";
export type BatchExportBatch = {
  id: string;
  label: string;
  objects: BoardObject[];
};

const EXPORT_PADDING = 32;
const DEFAULT_RECT_FILL = "rgba(59, 130, 246, 0.16)";
const DEFAULT_RECT_STROKE = "#2563eb";
const DEFAULT_TEXT_FILL = "#111827";
const DEFAULT_TEXT_FONT_SIZE = 24;
const DEFAULT_TEXT_WIDTH = 320;
const DEFAULT_TEXT_HEIGHT = 40;
const DEFAULT_PATH_STROKE = "#111827";
const DEFAULT_PATH_STROKE_WIDTH = 3;

export async function exportObjectsToPng({
  assets,
  objects,
  pixelRatio = 2,
}: ExportObjectsToPngInput) {
  const exportableObjects = getExportableObjects(objects);
  const bounds = getCombinedBounds(exportableObjects);
  if (!bounds) throw new Error("画板为空，无法导出");

  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "-10000px";
  container.style.width = "1px";
  container.style.height = "1px";
  document.body.appendChild(container);

  const stage = new Konva.Stage({
    container,
    width: Math.max(1, Math.ceil(bounds.w + EXPORT_PADDING * 2)),
    height: Math.max(1, Math.ceil(bounds.h + EXPORT_PADDING * 2)),
  });

  try {
    const layer = new Konva.Layer();
    const group = new Konva.Group({
      x: EXPORT_PADDING - bounds.x,
      y: EXPORT_PADDING - bounds.y,
    });

    for (const object of exportableObjects) {
      if (object.type === "image") {
        const asset = assetsById.get(object.assetId);
        if (!asset) continue;
        group.add(new Konva.Image({
          height: object.h,
          image: await loadHtmlImage(apiUrl(asset.publicUrl)),
          rotation: object.rotation,
          width: object.w,
          x: object.x,
          y: object.y,
        }));
        continue;
      }

      if (object.type === "rect") {
        group.add(new Konva.Rect({
          fill: DEFAULT_RECT_FILL,
          height: object.h,
          rotation: object.rotation,
          stroke: DEFAULT_RECT_STROKE,
          strokeWidth: 2,
          width: object.w,
          x: object.x,
          y: object.y,
        }));
        continue;
      }

      if (object.type === "text") {
        group.add(new Konva.Text({
          fill: DEFAULT_TEXT_FILL,
          fontSize: DEFAULT_TEXT_FONT_SIZE,
          height: DEFAULT_TEXT_HEIGHT,
          rotation: object.rotation,
          text: object.text,
          width: DEFAULT_TEXT_WIDTH,
          x: object.x,
          y: object.y,
        }));
        continue;
      }

      group.add(new Konva.Line({
        lineCap: "round",
        lineJoin: "round",
        points: object.points.flatMap((point) => [point.x, point.y]),
        rotation: object.rotation,
        stroke: DEFAULT_PATH_STROKE,
        strokeWidth: DEFAULT_PATH_STROKE_WIDTH,
      }));
    }

    layer.add(group);
    stage.add(layer);
    layer.draw();

    return stage.toDataURL({
      mimeType: "image/png",
      pixelRatio,
    });
  } finally {
    stage.destroy();
    container.remove();
  }
}

export function getExportableObjects(objects: BoardObject[]) {
  return objects.filter((object) => !object.hidden);
}

export function getBatchExportBatches(input: {
  mode: BatchExportMode;
  objects: BoardObject[];
  selectedObjectIds: string[];
}): BatchExportBatch[] {
  const exportableObjects = getExportableObjects(input.objects);
  if (input.mode === "page") {
    return exportableObjects.length > 0 ? [{ id: "page", label: "整页", objects: exportableObjects }] : [];
  }

  if (input.mode === "selection") {
    const selectedIds = new Set(input.selectedObjectIds);
    const selectedObjects = exportableObjects.filter((object) => selectedIds.has(object.id));
    return selectedObjects.length > 0 ? [{ id: "selection", label: "选区", objects: selectedObjects }] : [];
  }

  const selectedIds = new Set(input.selectedObjectIds);
  const selectedGroupIds = new Set(
    exportableObjects
      .filter((object) => selectedIds.has(object.id) && object.groupId)
      .map((object) => object.groupId)
      .filter((groupId): groupId is string => Boolean(groupId)),
  );
  const groups = new Map<string, BatchExportBatch>();
  for (const object of exportableObjects) {
    if (!object.groupId) continue;
    if (selectedGroupIds.size > 0 && !selectedGroupIds.has(object.groupId)) continue;
    const group = groups.get(object.groupId) ?? {
      id: object.groupId,
      label: object.groupName || object.groupId,
      objects: [],
    };
    group.objects.push(object);
    groups.set(object.groupId, group);
  }
  return Array.from(groups.values()).filter((group) => group.objects.length > 0);
}

export function createBatchExportFilename(
  boardName: string,
  extension: string,
  options: {
    date?: Date;
    index: number;
    label: string;
    mode: BatchExportMode;
  },
) {
  const safeBoardName = sanitizeFilenameSegment(boardName) || "未命名项目";
  const safeMode = sanitizeFilenameSegment(options.mode) || "export";
  const safeLabel = sanitizeFilenameSegment(options.label) || "batch";
  const timestamp = formatDateTimeNumber(options.date ?? new Date());
  const indexSuffix = `_${String(options.index + 1).padStart(2, "0")}`;
  const normalizedExtension = extension.replace(/^\.+/, "").toLowerCase() || "png";
  return `${safeBoardName}_${safeMode}_${safeLabel}_${timestamp}${indexSuffix}.${normalizedExtension}`;
}

function loadHtmlImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败，无法导出"));
    image.src = src;
  });
}
