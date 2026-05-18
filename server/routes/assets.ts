import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { removeBackgroundWithLocalAi } from "@/lib/ai-background-removal";
import { removePureColorBackground } from "@/lib/background-removal";
import { createProjectTimestampFilename } from "@/lib/filenames";
import type { Asset } from "@/generated/prisma/client";
import { createOpenAIClient, getTextModel } from "@/lib/openai";
import { getAdminUsername } from "@/lib/app-variant";
import { prisma } from "@/lib/prisma";
import { getEnabledProviderModels } from "@/lib/provider-models";
import { deleteLocalAssetFile, readAssetBytes, readOwnedAssetBytes, saveLocalAsset, type AssetKind } from "@/lib/storage";
import { requireCurrentUser } from "../auth";
import { getErrorMessage, jsonError, parseBody } from "../http";
import { getProviderSetting } from "../provider-settings-helper";
import sharp from "sharp";

const allowedKinds = new Set<AssetKind>(["upload", "mask", "source"]);
const listableKinds = new Set<AssetKind>(["upload", "generated", "source", "mask"]);
const reversePromptInstruction = `你是一名专业 AI 图像提示词分析师。请观察用户上传的参考图，只输出可直接复制到 AI 生图工具里的中文提示词正文。不要输出标题、前置说明、后置解释、引号、Markdown、编号列表或“以下是/提示词如下”等包装文案。`;
const MAX_ASSET_TAGS = 12;
const MAX_ASSET_TAG_LENGTH = 24;
const assetTagPattern = /^[\p{Script=Han}\p{L}\p{N}_ -]+$/u;
const assetMetadataSchema = z.object({
  isFavorite: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});
const reversePromptSchema = z.object({
  model: z.string().trim().min(1).max(120).optional(),
});

export async function registerAssetRoutes(app: FastifyInstance) {
  app.get<{ Params: { boardId: string } }>("/api/boards/:boardId/assets", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const board = await prisma.board.findFirst({ where: { id: request.params.boardId, userId: user.id }, select: { id: true } });
    if (!board) return jsonError(reply, "Board not found", 404);

    const query = parseAssetListQuery(request.query);
    if (!query.ok) return jsonError(reply, query.error);

    const assets = await prisma.asset.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      where: {
        boardId: board.id,
        ...(query.data.kind ? { kind: query.data.kind } : {}),
        ...(query.data.favoriteOnly ? { isFavorite: true } : {}),
      },
    });
    const typedAssets = assets as Asset[];
    const matchingAssets = typedAssets
      .map((asset) => ({ ...asset, tags: parseAssetTags(asset.tagsJson) }))
      .filter((asset) => assetMatchesTagFilter(asset.tags, query.data.tag))
      .filter((asset) => assetMatchesTextSearch(asset, query.data.q));
    const pageCandidates = matchingAssets.filter((asset) => assetIsAfterCursor(asset, query.data.cursor));
    const pageAssets = pageCandidates.slice(0, query.data.limit);
    const lastAsset = pageAssets.at(-1);
    const hasMore = pageCandidates.length > query.data.limit;
    return {
      assets: pageAssets.map(toPublicAssetListItem),
      nextCursor: hasMore && lastAsset ? encodeAssetCursor(lastAsset.createdAt, lastAsset.id) : null,
      totalMatching: matchingAssets.length,
    };
  });

  app.post("/api/assets", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const data = await request.file();
    if (!data) return jsonError(reply, "file is required");
    const boardId = String(data.fields.boardId && "value" in data.fields.boardId ? data.fields.boardId.value : "");
    const kind = String(data.fields.kind && "value" in data.fields.kind ? data.fields.kind.value : "upload") as AssetKind;
    const width = Number(data.fields.width && "value" in data.fields.width ? data.fields.width.value : "");
    const height = Number(data.fields.height && "value" in data.fields.height ? data.fields.height.value : "");
    if (!boardId) return jsonError(reply, "boardId is required");
    if (!allowedKinds.has(kind)) return jsonError(reply, "Unsupported asset kind");
    const board = await prisma.board.findFirst({ where: { id: boardId, userId: user.id }, select: { id: true } });
    if (!board) return jsonError(reply, "Board not found", 404);
    const bytes = await data.toBuffer();
    const mimeType = data.mimetype || inferImageMimeType(data.filename);
    if (!mimeType.startsWith("image/")) return jsonError(reply, "Only image files are supported");
    const metadata = await sharp(bytes, { limitInputPixels: false }).metadata().catch(() => null);
    const asset = await saveLocalAsset({
      boardId,
      kind,
      bytes,
      filename: data.filename,
      height: getPositiveDimension(height) ?? metadata?.height,
      mimeType,
      width: getPositiveDimension(width) ?? metadata?.width,
    });
    return reply.status(201).send({ asset });
  });

  app.patch<{ Params: { assetId: string } }>("/api/assets/:assetId", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const parsed = parseBody(assetMetadataSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    if (parsed.data.isFavorite === undefined && parsed.data.tags === undefined) {
      return jsonError(reply, "No asset metadata provided");
    }

    let normalizedTags: string[] | undefined;
    if (parsed.data.tags !== undefined) {
      try {
        normalizedTags = normalizeAssetTags(parsed.data.tags);
      } catch (error) {
        return jsonError(reply, getErrorMessage(error, "Invalid tags"));
      }
    }

    const existingAsset = await prisma.asset.findFirst({
      where: { id: request.params.assetId, board: { userId: user.id } },
      select: { id: true },
    });
    if (!existingAsset) return jsonError(reply, "Asset not found", 404);

    const updatedAsset = await prisma.asset.update({
      data: {
        ...(parsed.data.isFavorite !== undefined ? { isFavorite: parsed.data.isFavorite } : {}),
        ...(normalizedTags !== undefined ? { tagsJson: JSON.stringify(normalizedTags) } : {}),
      },
      where: { id: existingAsset.id },
    });
    return { asset: { ...updatedAsset, tags: parseAssetTags(updatedAsset.tagsJson) } };
  });

  app.get<{ Params: { assetId: string } }>("/api/assets/:assetId/file", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    try {
      const canReadAnyAsset = user.username === getAdminUsername() && user.role === "admin";
      const { asset, bytes } = canReadAnyAsset ? await readAssetBytes(request.params.assetId) : await readOwnedAssetBytes(request.params.assetId, user.id);
      reply.header("Cache-Control", "private, max-age=86400, stale-while-revalidate=604800");
      reply.header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(path.basename(asset.storageKey))}`);
      reply.header("Content-Length", String(bytes.byteLength));
      reply.type(asset.mimeType);
      return reply.send(bytes);
    } catch {
      return jsonError(reply, "Asset file not found", 404);
    }
  });

  app.delete<{ Params: { assetId: string } }>("/api/assets/:assetId", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const asset = await prisma.asset.findFirst({ where: { id: request.params.assetId, board: { userId: user.id } }, select: { boardId: true, id: true, storageKey: true } });
    if (!asset) return jsonError(reply, "Asset not found", 404);
    await prisma.$transaction([
      prisma.generationJob.updateMany({ where: { sourceAssetId: asset.id }, data: { sourceAssetId: null } }),
      prisma.generationJob.updateMany({ where: { maskAssetId: asset.id }, data: { maskAssetId: null } }),
      prisma.storyboardShot.updateMany({ where: { startFrameAssetId: asset.id }, data: { startFrameAssetId: null } }),
      prisma.storyboardShot.updateMany({ where: { endFrameAssetId: asset.id }, data: { endFrameAssetId: null } }),
      prisma.asset.delete({ where: { id: asset.id } }),
    ]);
    await deleteLocalAssetFile(asset.storageKey);
    return { ok: true, assetId: asset.id, boardId: asset.boardId };
  });

  app.post<{ Params: { assetId: string } }>("/api/assets/:assetId/remove-background", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    try {
      const { asset, bytes } = await readOwnedAssetBytes(request.params.assetId, user.id);
      const board = await prisma.board.findFirst({ where: { id: asset.boardId, userId: user.id }, select: { name: true } });
      if (!board) return jsonError(reply, "Board not found", 404);
      let output: Buffer;
      try { output = await removeBackgroundWithLocalAi(bytes); } catch { output = await removePureColorBackground(bytes); }
      const metadata = await sharp(output, { limitInputPixels: false }).metadata();
      const filename = createProjectTimestampFilename(board.name, "png", { username: user.username ?? user.name });
      const removedAsset = await saveLocalAsset({ boardId: asset.boardId, kind: "generated", bytes: output, filename, height: metadata.height, mimeType: "image/png", width: metadata.width });
      return { asset: removedAsset };
    } catch (error) {
      return jsonError(reply, getErrorMessage(error, "删除背景失败"), 500);
    }
  });

  app.post<{ Params: { assetId: string } }>("/api/assets/:assetId/reverse-prompt", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const parsed = parseBody(reversePromptSchema, request.body ?? {});
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const providerSetting = await getProviderSetting(user.id, user.canUseAdminProvider);
    if (!providerSetting?.enabled) return jsonError(reply, "请配置第三方 API 或联系管理员授权使用当前 API", 400);
    try {
      const { asset, bytes } = await readOwnedAssetBytes(request.params.assetId, user.id);
      if (!asset.mimeType.startsWith("image/")) return jsonError(reply, "仅支持图片素材反推提示词", 400);
      const openai = createOpenAIClient(providerSetting);
      const fallbackModel = getTextModel(providerSetting);
      const enabledModels = getEnabledProviderModels(providerSetting.enabledReversePromptModels, fallbackModel);
      const requestedModel = parsed.data.model;
      if (requestedModel && !enabledModels.some((model) => model.id === requestedModel)) {
        return jsonError(reply, "所选反推模型未在后台启用", 400);
      }
      const model = requestedModel || fallbackModel;
      const imageUrl = `data:${asset.mimeType};base64,${bytes.toString("base64")}`;
      let promptText = "";
      try {
        const response = await openai.responses.create({
          input: [
            {
              content: [
                { text: `${reversePromptInstruction}\n\n请反推这张参考图的生图提示词，只返回提示词正文。`, type: "input_text" },
                { detail: "auto", image_url: imageUrl, type: "input_image" },
              ],
              role: "user",
            },
          ],
          max_output_tokens: 1400,
          model,
          temperature: 0.2,
        });
        promptText = response.output_text?.trim() ?? "";
      } catch {
        const response = await openai.chat.completions.create({
          max_tokens: 1400,
          messages: [
            { content: reversePromptInstruction, role: "system" },
            { content: [{ text: "请反推这张参考图的生图提示词，只返回提示词正文。", type: "text" }, { image_url: { url: imageUrl }, type: "image_url" }], role: "user" },
          ],
          model,
          temperature: 0.2,
        });
        const chatPromptText = response.choices[0]?.message.content;
        promptText = typeof chatPromptText === "string" ? chatPromptText.trim() : "";
      }
      const cleanedPromptText = cleanReversePromptText(promptText);
      if (!cleanedPromptText) return jsonError(reply, "反推提示词失败：模型未返回可用文本", 502);
      return { promptText: cleanedPromptText };
    } catch (error) {
      return jsonError(reply, getErrorMessage(error, "反推提示词失败"), 500);
    }
  });
}

function cleanReversePromptText(value: string) {
  let text = value.trim();
  text = text.replace(/^```(?:\w+)?\s*/i, "").replace(/```$/i, "").trim();
  text = text.replace(/^["“”'`]+|["“”'`]+$/g, "").trim();
  const lines = text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*(?:[-*]|\d+[.)]|[一二三四五六七八九十]+[、.])\s*/, "")
        .trim(),
    )
    .filter(Boolean)
    .filter((line) => !/^(?:以下是|下面是|当然|好的|提示词(?:如下)?|反推提示词|生图提示词|说明|备注|可直接使用|希望这|如果你)/i.test(line));
  text = lines.join("\n").trim();
  text = text.replace(/^(?:提示词(?:如下)?|反推提示词|生图提示词)\s*[:：]\s*/i, "").trim();
  return text;
}

export function normalizeAssetTags(tags: string[]) {
  const output: string[] = [];
  const seenTags = new Set<string>();
  for (const tag of tags) {
    const normalizedTag = tag.trim().replace(/\s+/g, " ");
    if (!normalizedTag) continue;
    if (normalizedTag.length > MAX_ASSET_TAG_LENGTH) {
      throw new Error(`标签不能超过 ${MAX_ASSET_TAG_LENGTH} 个字符`);
    }
    if (!assetTagPattern.test(normalizedTag)) {
      throw new Error("标签只能包含文字、数字、空格、下划线或连字符");
    }
    const key = normalizedTag.toLocaleLowerCase();
    if (seenTags.has(key)) continue;
    seenTags.add(key);
    output.push(normalizedTag);
    if (output.length > MAX_ASSET_TAGS) {
      throw new Error(`最多 ${MAX_ASSET_TAGS} 个标签`);
    }
  }
  return output;
}

export function parseAssetTags(tagsJson: string | null | undefined) {
  if (!tagsJson) return [];
  try {
    const value = JSON.parse(tagsJson);
    return Array.isArray(value) ? normalizeAssetTags(value.filter((item): item is string => typeof item === "string")) : [];
  } catch {
    return [];
  }
}

type AssetListQuery = {
  cursor: { createdAt: Date; id: string } | null;
  favoriteOnly: boolean;
  kind: AssetKind | null;
  limit: number;
  q: string | null;
  tag: string | null;
};

type AssetWithParsedTags = Awaited<ReturnType<typeof prisma.asset.findMany>>[number] & { tags: string[] };

function toPublicAssetListItem(asset: AssetWithParsedTags) {
  return {
    id: asset.id,
    boardId: asset.boardId,
    kind: asset.kind,
    publicUrl: asset.publicUrl,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    sizeBytes: asset.sizeBytes,
    isFavorite: asset.isFavorite,
    tagsJson: asset.tagsJson,
    createdAt: asset.createdAt,
    tags: asset.tags,
  };
}

function parseAssetListQuery(queryValue: unknown): { data: AssetListQuery; ok: true } | { error: string; ok: false } {
  const query = isRecord(queryValue) ? queryValue : {};
  const limit = parseAssetListLimit(query.limit);
  if (limit === null) return { error: "limit must be an integer from 1 to 100", ok: false };
  const kind = parseOptionalString(query.kind);
  if (!kind.ok) return { error: "kind must be a single value", ok: false };
  if (kind.value !== null && !listableKinds.has(kind.value as AssetKind)) return { error: "Unsupported asset kind", ok: false };
  const tag = parseOptionalString(query.tag);
  if (!tag.ok) return { error: "tag must be a single value", ok: false };
  const q = parseOptionalString(query.q);
  if (!q.ok) return { error: "q must be a single value", ok: false };
  const cursorText = parseOptionalString(query.cursor);
  if (!cursorText.ok) return { error: "cursor must be a single value", ok: false };
  const cursor = cursorText.value ? decodeAssetCursor(cursorText.value) : null;
  if (cursorText.value && !cursor) return { error: "Invalid cursor", ok: false };
  const favorite = parseFavoriteFilter(query.favorite);
  if (!favorite.ok) return { error: favorite.error, ok: false };
  return {
    data: {
      cursor,
      favoriteOnly: favorite.value,
      kind: kind.value as AssetKind | null,
      limit,
      q: q.value,
      tag: tag.value ? normalizeSearchText(tag.value) : null,
    },
    ok: true,
  };
}

function parseAssetListLimit(value: unknown) {
  if (value === undefined) return 50;
  if (Array.isArray(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : null;
}

function parseOptionalString(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined) return { ok: true, value: null };
  if (Array.isArray(value)) return { ok: false };
  const text = String(value).trim();
  return { ok: true, value: text ? text : null };
}

function parseFavoriteFilter(value: unknown): { ok: true; value: boolean } | { error: string; ok: false } {
  if (value === undefined) return { ok: true, value: false };
  if (Array.isArray(value)) return { error: "favorite must be 1, true, 0, or false", ok: false };
  if (value === "1" || value === "true") return { ok: true, value: true };
  if (value === "0" || value === "false") return { ok: true, value: false };
  return { error: "favorite must be 1, true, 0, or false", ok: false };
}

function encodeAssetCursor(createdAt: Date, id: string) {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id }), "utf8").toString("base64url");
}

function decodeAssetCursor(value: string) {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!isRecord(parsed) || typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") return null;
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime()) || !parsed.id) return null;
    return { createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

function assetIsAfterCursor(asset: AssetWithParsedTags, cursor: AssetListQuery["cursor"]) {
  if (!cursor) return true;
  const assetTime = asset.createdAt.getTime();
  const cursorTime = cursor.createdAt.getTime();
  return assetTime < cursorTime || (assetTime === cursorTime && asset.id < cursor.id);
}

function assetMatchesTagFilter(tags: string[], normalizedTag: string | null) {
  if (!normalizedTag) return true;
  return tags.some((tag) => normalizeSearchText(tag) === normalizedTag);
}

function assetMatchesTextSearch(asset: AssetWithParsedTags, query: string | null) {
  if (!query) return true;
  const normalizedQuery = normalizeSearchText(query);
  const searchableText = [
    asset.kind,
    asset.mimeType,
    asset.createdAt.toISOString(),
    ...asset.tags,
  ].map(normalizeSearchText);
  return searchableText.some((text) => text.includes(normalizedQuery));
}

function normalizeSearchText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inferImageMimeType(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function getPositiveDimension(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}
