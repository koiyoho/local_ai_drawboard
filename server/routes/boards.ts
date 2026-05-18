import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { boardTemplates, getBoardTemplate } from "@/lib/board-templates";
import type { BoardSnapshot } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { deleteLocalBoardAssets, readAssetBytes, saveLocalAsset } from "@/lib/storage";
import { normalizeStoryboardBrief, normalizeStoryboardShotInput } from "@/lib/storyboard";
import { requireCurrentUser } from "../auth";
import { getErrorMessage, jsonError, parseBody } from "../http";

const createBoardSchema = z.object({
  name: z.string().trim().min(1).max(80),
  templateId: z.string().trim().min(1).max(80).optional(),
});
const snapshotSchema = z.object({
  kind: z.enum(["auto", "manual"]).optional(),
  name: z.string().trim().max(80).optional(),
  snapshot: z.unknown(),
});
const DEFAULT_BOARD_NAME = "未命名画板";
const MAX_AUTO_SNAPSHOTS_PER_BOARD = 30;

type AssetReference = { id: string; publicUrl: string };

function findRecentBoard(userId: string) {
  return prisma.board.findFirst({
    where: { userId },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    include: { _count: { select: { assets: true, jobs: true } } },
  });
}

export async function registerBoardRoutes(app: FastifyInstance) {
  app.get("/api/board-templates", async () => ({
    templates: boardTemplates.map((template) => ({
      defaultPrompt: template.defaultPrompt,
      description: template.description,
      id: template.id,
      name: template.name,
      snapshot: template.snapshot,
    })),
  }));

  app.get("/api/boards", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const boards = await prisma.board.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { assets: true, jobs: true } } },
    });
    return { boards };
  });

  app.get("/api/boards/recent", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const board = await findRecentBoard(user.id);
    if (!board) return jsonError(reply, "no_board", 404);
    return { board };
  });

  app.post("/api/boards", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const parsed = parseBody(createBoardSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const template = getBoardTemplate(parsed.data.templateId);
    if (parsed.data.templateId && !template) return jsonError(reply, "Board template not found", 404);
    const snapshotJson = template ? JSON.stringify(template.snapshot) : undefined;
    const board = await prisma.board.create({
      data: {
        name: parsed.data.name,
        snapshotJson,
        userId: user.id,
      },
    });
    if (snapshotJson) {
      await prisma.boardSnapshot.create({
        data: {
          boardId: board.id,
          kind: "manual",
          name: template?.name ?? null,
          snapshotJson,
          version: 1,
        },
      });
    }
    return reply.status(201).send({ board });
  });

  app.post("/api/boards/ensure-recent", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const recentBoard = await findRecentBoard(user.id);
    if (recentBoard) return { board: recentBoard };
    try {
      const board = await prisma.board.create({
        data: { id: `default-${user.id}`, name: DEFAULT_BOARD_NAME, userId: user.id },
        include: { _count: { select: { assets: true, jobs: true } } },
      });
      return reply.status(201).send({ board });
    } catch (error) {
      const board = await findRecentBoard(user.id);
      if (board) return { board };
      throw error;
    }
  });

  app.get<{ Params: { boardId: string } }>("/api/boards/:boardId", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const board = await prisma.board.findFirst({
      where: { id: request.params.boardId, userId: user.id },
      include: {
        assets: { orderBy: { createdAt: "desc" }, take: 50 },
        jobs: { orderBy: { createdAt: "desc" }, take: 20, include: { results: { include: { asset: true } } } },
        storyboardProject: {
          include: { shots: { orderBy: [{ shotIndex: "asc" }, { createdAt: "asc" }] } },
        },
      },
    });
    if (!board) return jsonError(reply, "Board not found", 404);
    return { board: formatBoardPayload(board), snapshot: board.snapshotJson ? JSON.parse(board.snapshotJson) : null };
  });

  app.patch<{ Params: { boardId: string } }>("/api/boards/:boardId", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const parsed = parseBody(createBoardSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const existing = await prisma.board.findFirst({ where: { id: request.params.boardId, userId: user.id }, select: { id: true } });
    if (!existing) return jsonError(reply, "Board not found", 404);
    const board = await prisma.board.update({ where: { id: existing.id }, data: { name: parsed.data.name } });
    return { board };
  });

  app.delete<{ Params: { boardId: string } }>("/api/boards/:boardId", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const board = await prisma.board.findFirst({ where: { id: request.params.boardId, userId: user.id }, select: { id: true } });
    if (!board) return jsonError(reply, "Board not found", 404);
    await prisma.$transaction([
      prisma.generationResult.deleteMany({ where: { job: { boardId: board.id } } }),
      prisma.generationJob.deleteMany({ where: { boardId: board.id } }),
      prisma.boardSnapshot.deleteMany({ where: { boardId: board.id } }),
      prisma.asset.deleteMany({ where: { boardId: board.id } }),
      prisma.board.delete({ where: { id: board.id } }),
    ]);
    await deleteLocalBoardAssets(board.id);
    return { ok: true };
  });

  app.get<{ Params: { boardId: string } }>("/api/boards/:boardId/snapshot", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const board = await prisma.board.findFirst({ where: { id: request.params.boardId, userId: user.id } });
    if (!board) return jsonError(reply, "Board not found", 404);
    return { snapshot: board.snapshotJson ? JSON.parse(board.snapshotJson) : null };
  });

  app.put<{ Params: { boardId: string } }>("/api/boards/:boardId/snapshot", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const parsed = parseBody(snapshotSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const board = await prisma.board.findFirst({ where: { id: request.params.boardId, userId: user.id } });
    if (!board) return jsonError(reply, "Board not found", 404);
    const allowEmptyOverwrite =
      isRecord(request.query) && request.query.allowEmpty === "1";
    if (
      board.snapshotJson &&
      !allowEmptyOverwrite &&
      hasCanvasShapes(JSON.parse(board.snapshotJson)) &&
      !hasCanvasShapes(parsed.data.snapshot)
    ) {
      return jsonError(reply, "Refusing to overwrite a non-empty board with an empty snapshot", 409);
    }
    const snapshotJson = JSON.stringify(parsed.data.snapshot);
    const version = await getNextSnapshotVersion(board.id);
    const kind = parsed.data.kind ?? (parsed.data.name ? "manual" : "auto");
    const name = kind === "manual" ? parsed.data.name?.trim() || null : null;
    await prisma.$transaction([
      prisma.board.update({ where: { id: board.id }, data: { snapshotJson } }),
      prisma.boardSnapshot.create({ data: { boardId: board.id, kind, name, snapshotJson, version } }),
    ]);
    if (kind === "auto") {
      await pruneAutomaticSnapshots(board.id);
    }
    return { ok: true, version };
  });

  app.get<{ Params: { boardId: string } }>("/api/boards/:boardId/snapshots", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const board = await prisma.board.findFirst({ where: { id: request.params.boardId, userId: user.id }, select: { id: true } });
    if (!board) return jsonError(reply, "Board not found", 404);
    const snapshots = await prisma.boardSnapshot.findMany({
      orderBy: [{ version: "desc" }],
      select: { createdAt: true, id: true, kind: true, name: true, version: true },
      where: { boardId: board.id },
    });
    return { snapshots };
  });

  app.get<{ Params: { boardId: string; snapshotId: string } }>("/api/boards/:boardId/snapshots/:snapshotId", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const snapshot = await findOwnedSnapshot(user.id, request.params.boardId, request.params.snapshotId);
    if (!snapshot) return jsonError(reply, "Snapshot not found", 404);
    return {
      snapshot: JSON.parse(snapshot.snapshotJson),
      version: {
        createdAt: snapshot.createdAt,
        id: snapshot.id,
        kind: snapshot.kind,
        name: snapshot.name,
        version: snapshot.version,
      },
    };
  });

  app.post<{ Params: { boardId: string; snapshotId: string } }>("/api/boards/:boardId/snapshots/:snapshotId/restore", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const snapshot = await findOwnedSnapshot(user.id, request.params.boardId, request.params.snapshotId);
    if (!snapshot) return jsonError(reply, "Snapshot not found", 404);
    const version = await getNextSnapshotVersion(snapshot.boardId);
    await prisma.$transaction([
      prisma.board.update({ where: { id: snapshot.boardId }, data: { snapshotJson: snapshot.snapshotJson } }),
      prisma.boardSnapshot.create({
        data: {
          boardId: snapshot.boardId,
          kind: "auto",
          name: null,
          snapshotJson: snapshot.snapshotJson,
          version,
        },
      }),
    ]);
    await pruneAutomaticSnapshots(snapshot.boardId);
    return { ok: true, snapshot: JSON.parse(snapshot.snapshotJson), version };
  });

  app.post<{ Params: { boardId: string; snapshotId: string } }>("/api/boards/:boardId/snapshots/:snapshotId/duplicate", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const snapshot = await findOwnedSnapshot(user.id, request.params.boardId, request.params.snapshotId);
    if (!snapshot) return jsonError(reply, "Snapshot not found", 404);
    const copyName = snapshot.name?.trim() || `版本 ${snapshot.version}`;
    const copiedBoard = await prisma.board.create({
      data: {
        name: `${snapshot.board.name} - ${copyName}`.slice(0, 80),
        snapshotJson: snapshot.snapshotJson,
        userId: user.id,
      },
      include: { _count: { select: { assets: true, jobs: true } } },
    });
    await prisma.boardSnapshot.create({
      data: {
        boardId: copiedBoard.id,
        kind: "manual",
        name: snapshot.name,
        snapshotJson: snapshot.snapshotJson,
        version: 1,
      },
    });
    return reply.status(201).send({ board: copiedBoard });
  });

  app.post<{ Params: { boardId: string } }>("/api/boards/:boardId/duplicate", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const sourceBoard = await prisma.board.findFirst({ where: { id: request.params.boardId, userId: user.id }, include: { assets: { orderBy: { createdAt: "asc" } } } });
    if (!sourceBoard) return jsonError(reply, "Board not found", 404);
    const copiedBoard = await prisma.board.create({ data: { name: `${sourceBoard.name} 副本`, userId: user.id } });
    const assetReferences = new Map<string, AssetReference>();
    try {
      for (const asset of sourceBoard.assets) {
        const source = await readAssetBytes(asset.id);
        const copiedAsset = await saveLocalAsset({
          boardId: copiedBoard.id,
          kind: asset.kind as "upload" | "mask" | "generated" | "source",
          bytes: Buffer.from(source.bytes),
          filename: asset.storageKey.split("/").at(-1),
          height: asset.height ?? undefined,
          mimeType: asset.mimeType,
          width: asset.width ?? undefined,
        });
        const copiedAssetWithMetadata = await prisma.asset.update({
          data: { isFavorite: asset.isFavorite, tagsJson: asset.tagsJson },
          where: { id: copiedAsset.id },
        });
        assetReferences.set(asset.id, { id: copiedAssetWithMetadata.id, publicUrl: copiedAssetWithMetadata.publicUrl });
      }
      const snapshot = sourceBoard.snapshotJson ? rewriteSnapshotAssetReferences(JSON.parse(sourceBoard.snapshotJson), assetReferences) : null;
      if (snapshot) {
        const snapshotJson = JSON.stringify(snapshot);
        await prisma.$transaction([
          prisma.board.update({ where: { id: copiedBoard.id }, data: { snapshotJson } }),
          prisma.boardSnapshot.create({ data: { boardId: copiedBoard.id, kind: "manual", name: "复制时版本", snapshotJson, version: 1 } }),
        ]);
      }
      const board = await prisma.board.findUniqueOrThrow({ where: { id: copiedBoard.id }, include: { _count: { select: { assets: true, jobs: true } } } });
      return reply.status(201).send({ board });
    } catch (error) {
      await prisma.board.delete({ where: { id: copiedBoard.id } }).catch(() => null);
      await deleteLocalBoardAssets(copiedBoard.id).catch(() => null);
      return jsonError(reply, getErrorMessage(error, "无法复制画板"), 500);
    }
  });
}

async function getNextSnapshotVersion(boardId: string) {
  const latestSnapshot = await prisma.boardSnapshot.findFirst({
    orderBy: { version: "desc" },
    select: { version: true },
    where: { boardId },
  });
  return (latestSnapshot?.version ?? 0) + 1;
}

async function pruneAutomaticSnapshots(boardId: string) {
  const automaticSnapshots = await prisma.boardSnapshot.findMany({
    orderBy: [{ version: "desc" }],
    select: { id: true },
    where: { boardId, kind: "auto" },
  });
  const staleSnapshots = (automaticSnapshots as Pick<BoardSnapshot, "id">[]).slice(MAX_AUTO_SNAPSHOTS_PER_BOARD);
  if (staleSnapshots.length === 0) return;
  await prisma.boardSnapshot.deleteMany({
    where: { id: { in: staleSnapshots.map((snapshot) => snapshot.id) } },
  });
}

function findOwnedSnapshot(userId: string, boardId: string, snapshotId: string) {
  return prisma.boardSnapshot.findFirst({
    include: { board: { select: { id: true, name: true, userId: true } } },
    where: { boardId, id: snapshotId, board: { userId } },
  });
}

function hasCanvasShapes(snapshot: unknown) {
  const boardDocument = getBoardDocumentSnapshot(snapshot);
  if (boardDocument) {
    return boardDocument.pages.some((page) => page.objects.length > 0);
  }
  const historicalSnapshot = getHistoricalCanvasSnapshot(snapshot);
  const documentSnapshot = getHistoricalDocumentSnapshot(historicalSnapshot);
  if (!documentSnapshot) return false;
  return Object.values(documentSnapshot.store).some((record) => isRecord(record) && record.typeName === "shape");
}

function getBoardDocumentSnapshot(snapshot: unknown): { pages: Array<{ objects: unknown[] }> } | null {
  if (!isRecord(snapshot) || !isRecord(snapshot.app) || !isRecord(snapshot.app.boardDocument)) return null;
  const boardDocument = snapshot.app.boardDocument;
  if (!Array.isArray(boardDocument.pages)) return null;
  return {
    pages: boardDocument.pages.map((page) =>
      isRecord(page) && Array.isArray(page.objects) ? { objects: page.objects } : { objects: [] },
    ),
  };
}

function getHistoricalCanvasSnapshot(snapshot: unknown) {
  return isRecord(snapshot) && "tldraw" in snapshot ? snapshot.tldraw : snapshot;
}

function getHistoricalDocumentSnapshot(snapshot: unknown): { store: Record<string, unknown> } | null {
  if (!isRecord(snapshot)) return null;
  if (isRecord(snapshot.document) && isRecord(snapshot.document.store)) {
    return { store: snapshot.document.store };
  }
  if (isRecord(snapshot.store)) {
    return { store: snapshot.store };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

type BoardStoryboardShotRecord = {
  action: string;
  audio: string;
  camera: string;
  caption: string;
  createdAt: Date;
  dialogue: string;
  durationSec: number;
  endFramePrompt: string;
  id: string;
  metadataJson: string | null;
  scene: string;
  shotIndex: number;
  startFramePrompt: string;
  status: string;
  updatedAt: Date;
  videoPrompt: string;
};

type BoardStoryboardProjectRecord = {
  boardId: string;
  briefJson: string;
  createdAt: Date;
  id: string;
  scriptText: string;
  shots: BoardStoryboardShotRecord[];
  title: string;
  updatedAt: Date;
};

function formatBoardPayload<T extends { storyboardProject?: BoardStoryboardProjectRecord | null }>(board: T) {
  const { storyboardProject, ...rest } = board;
  return {
    ...rest,
    storyboardProject: storyboardProject ? formatStoryboardProjectForBoard(storyboardProject) : null,
  };
}

function formatStoryboardProjectForBoard(project: BoardStoryboardProjectRecord) {
  return {
    boardId: project.boardId,
    brief: normalizeStoryboardBrief(parseJsonObject(project.briefJson)),
    createdAt: project.createdAt.toISOString(),
    id: project.id,
    scriptText: project.scriptText,
    shots: project.shots.map((shot) => {
      const normalized = normalizeStoryboardShotInput({
        action: shot.action,
        audio: shot.audio,
        camera: shot.camera,
        caption: shot.caption,
        dialogue: shot.dialogue,
        durationSec: shot.durationSec,
        endFramePrompt: shot.endFramePrompt,
        id: shot.id,
        metadata: parseJsonObject(shot.metadataJson),
        scene: shot.scene,
        shotIndex: shot.shotIndex,
        startFramePrompt: shot.startFramePrompt,
        status: shot.status,
        videoPrompt: shot.videoPrompt,
      });
      return {
        ...normalized,
        id: shot.id,
        createdAt: shot.createdAt.toISOString(),
        updatedAt: shot.updatedAt.toISOString(),
      };
    }),
    title: project.title,
    updatedAt: project.updatedAt.toISOString(),
  };
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function rewriteSnapshotAssetReferences(value: unknown, assetReferences: Map<string, AssetReference>): unknown {
  if (typeof value === "string") {
    let nextValue = assetReferences.get(value)?.id ?? value;
    for (const [sourceId, target] of assetReferences) {
      nextValue = nextValue.replaceAll(`/api/assets/${sourceId}/file`, target.publicUrl);
    }
    return nextValue;
  }
  if (Array.isArray(value)) return value.map((item) => rewriteSnapshotAssetReferences(item, assetReferences));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteSnapshotAssetReferences(item, assetReferences)]));
  }
  return value;
}
