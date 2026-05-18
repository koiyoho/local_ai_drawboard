import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { normalizeStorageFilename } from "@/lib/filenames";
import { prisma } from "@/lib/prisma";

const uploadRoot = path.join(process.cwd(), "public", "uploads");

export type AssetKind = "upload" | "mask" | "generated" | "source";

export class AssetFileMissingError extends Error {
  constructor(message = "素材文件不存在，请重新上传或从素材页重新载入后再生成") {
    super(message);
    this.name = "AssetFileMissingError";
  }
}

const extensionByMime: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export async function saveLocalAsset(input: {
  boardId: string;
  kind: AssetKind;
  bytes: Buffer;
  mimeType: string;
  filename?: string;
  width?: number;
  height?: number;
}) {
  const filenameExtension = path.extname(input.filename ?? "").replace(".", "");
  const ext = extensionByMime[input.mimeType] || filenameExtension || "bin";
  const width = getPositiveDimension(input.width);
  const height = getPositiveDimension(input.height);
  const asset = await prisma.asset.create({
    data: {
      boardId: input.boardId,
      kind: input.kind,
      storageKey: "pending",
      publicUrl: "pending",
      mimeType: input.mimeType,
      width,
      height,
      sizeBytes: input.bytes.byteLength,
    },
  });
  const storageFilename = input.filename
    ? normalizeStorageFilename(input.filename, ext)
    : `${asset.id}.${ext}`;

  const relativePath = path.posix.join(
    "uploads",
    input.boardId,
    input.kind,
    storageFilename,
  );
  const absolutePath = path.join(process.cwd(), "public", relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, input.bytes);

  return prisma.asset.update({
    where: { id: asset.id },
    data: {
      storageKey: relativePath,
      publicUrl: assetFileUrl(asset.id),
    },
  });
}

export async function readAssetBytes(assetId: string) {
  const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
  const absolutePath = path.join(process.cwd(), "public", asset.storageKey);
  const bytes = await readLocalAssetFile(absolutePath);
  return { asset, bytes };
}

export async function readBoardAssetBytes(assetId: string, boardId: string) {
  const asset = await prisma.asset.findFirstOrThrow({ where: { id: assetId, boardId } });
  const absolutePath = path.join(process.cwd(), "public", asset.storageKey);
  const bytes = await readLocalAssetFile(absolutePath);
  return { asset, bytes };
}

export async function readOwnedAssetBytes(assetId: string, userId: string) {
  const asset = await prisma.asset.findFirstOrThrow({
    where: { id: assetId, board: { userId } },
  });
  const absolutePath = path.join(process.cwd(), "public", asset.storageKey);
  const bytes = await readLocalAssetFile(absolutePath);
  return { asset, bytes };
}

export function assetFileUrl(assetId: string) {
  return `/api/assets/${assetId}/file`;
}

export async function deleteLocalAssetFile(storageKey: string) {
  const targetPath = path.join(process.cwd(), "public", storageKey);
  const relativePath = path.relative(uploadRoot, targetPath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Invalid asset path");
  }
  await rm(targetPath, { force: true });
}

export async function ensureUploadRoot() {
  await mkdir(uploadRoot, { recursive: true });
}

export async function deleteLocalBoardAssets(boardId: string) {
  const targetPath = path.join(uploadRoot, boardId);
  const relativePath = path.relative(uploadRoot, targetPath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Invalid board asset path");
  }
  await rm(targetPath, { force: true, recursive: true });
}

function getPositiveDimension(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : undefined;
}

async function readLocalAssetFile(absolutePath: string) {
  try {
    return await readFile(absolutePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new AssetFileMissingError();
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
