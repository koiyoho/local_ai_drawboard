import { access } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";

export type MissingAssetReportItem = {
  boardId: string;
  boardName: string;
  createdAt: Date;
  id: string;
  kind: string;
  storageKey: string;
  userId: string;
  username: string | null;
};

export type AssetIntegrityReport = {
  missingAssetCount: number;
  missingAssets: MissingAssetReportItem[];
  totalAssetCount: number;
};

type AssetForIntegrity = {
  board: {
    id: string;
    name: string;
    user: {
      id: string;
      username: string | null;
    };
  };
  createdAt: Date;
  id: string;
  kind: string;
  storageKey: string;
};

export async function getAssetIntegrityReport(): Promise<AssetIntegrityReport> {
  const assets = await prisma.asset.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      board: { select: { id: true, name: true, user: { select: { id: true, username: true } } } },
      createdAt: true,
      id: true,
      kind: true,
      storageKey: true,
    },
  });
  const typedAssets = assets as AssetForIntegrity[];
  const missingAssets: MissingAssetReportItem[] = [];
  for (const asset of typedAssets) {
    if (!(await assetFileExists(asset.storageKey))) {
      missingAssets.push(formatMissingAsset(asset));
    }
  }
  return {
    missingAssetCount: missingAssets.length,
    missingAssets,
    totalAssetCount: typedAssets.length,
  };
}

export async function cleanupMissingAssets(assetIds: string[]) {
  const uniqueAssetIds = Array.from(new Set(assetIds.map((assetId) => assetId.trim()).filter(Boolean)));
  if (uniqueAssetIds.length === 0) return { cleanedAssetIds: [] as string[], skippedAssetIds: [] as string[] };

  const assets = await prisma.asset.findMany({
    where: { id: { in: uniqueAssetIds } },
    select: { id: true, storageKey: true },
  });
  const assetById = new Map((assets as Array<{ id: string; storageKey: string }>).map((asset) => [asset.id, asset]));
  const cleanedAssetIds: string[] = [];
  const skippedAssetIds: string[] = [];

  for (const assetId of uniqueAssetIds) {
    const asset = assetById.get(assetId);
    if (!asset || (await assetFileExists(asset.storageKey))) {
      skippedAssetIds.push(assetId);
      continue;
    }
    await prisma.$transaction([
      prisma.generationJob.updateMany({ where: { sourceAssetId: asset.id }, data: { sourceAssetId: null } }),
      prisma.generationJob.updateMany({ where: { maskAssetId: asset.id }, data: { maskAssetId: null } }),
      prisma.asset.delete({ where: { id: asset.id } }),
    ]);
    cleanedAssetIds.push(asset.id);
  }

  return { cleanedAssetIds, skippedAssetIds };
}

async function assetFileExists(storageKey: string) {
  const absolutePath = assetStoragePath(storageKey);
  if (!absolutePath) return false;
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function assetStoragePath(storageKey: string) {
  const publicRoot = path.join(process.cwd(), "public");
  const absolutePath = path.join(publicRoot, storageKey);
  const relativePath = path.relative(publicRoot, absolutePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }
  return absolutePath;
}

function formatMissingAsset(asset: AssetForIntegrity): MissingAssetReportItem {
  return {
    boardId: asset.board.id,
    boardName: asset.board.name,
    createdAt: asset.createdAt,
    id: asset.id,
    kind: asset.kind,
    storageKey: asset.storageKey,
    userId: asset.board.user.id,
    username: asset.board.user.username,
  };
}
