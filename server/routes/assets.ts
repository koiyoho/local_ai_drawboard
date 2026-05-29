import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { removeBackgroundWithLocalAi } from "@/lib/ai-background-removal";
import { removePureColorBackground } from "@/lib/background-removal";
import { createProjectTimestampFilename } from "@/lib/filenames";
import type { Asset, ProviderSetting } from "@/generated/prisma/client";
import { createOpenAIClient, getTextModel } from "@/lib/openai";
import { getAdminUsername } from "@/lib/app-variant";
import { prisma } from "@/lib/prisma";
import { getConfiguredModelError, getEnabledProviderModels, isConfiguredModelEnabled, parseConfiguredModelValue, type ProviderModelChannel } from "@/lib/provider-models";
import { deleteLocalAssetFile, readAssetBytes, readOwnedAssetBytes, saveLocalAsset, type AssetKind } from "@/lib/storage";
import { requireCurrentUser } from "../auth";
import { getErrorMessage, jsonError, parseBody } from "../http";
import { getProviderSetting } from "../provider-settings-helper";
import { getTextGenerationProviderSetting, resolveRequestedTextModelChannel, resolveTextModelChannel } from "../text-model-service";
import sharp from "sharp";

const allowedKinds = new Set<AssetKind>(["upload", "mask", "source"]);
const listableKinds = new Set<AssetKind>(["upload", "generated", "source", "mask"]);
const reversePromptInstruction = `你是一名专业 AI 图像提示词分析师。请观察用户上传的参考图，只输出可直接复制到 AI 生图工具里的提示词内容。默认不要输出前置说明、后置解释、引号或“以下是/提示词如下”等包装文案；当用户要求结构化模板标准时，必须按指定栏目输出。`;
const MAX_ASSET_TAGS = 12;
const MAX_ASSET_TAG_LENGTH = 24;
const ASSET_FILE_CACHE_CONTROL = "private, max-age=604800, stale-while-revalidate=2592000";
const ASSET_THUMBNAIL_CACHE_CONTROL = "private, max-age=604800, stale-while-revalidate=2592000";
const ASSET_THUMBNAIL_MAX_SIZE = 512;
const providerNotConfiguredMessage = "请先在本地设置中配置第三方 API、Gemini Bridge 或 Codex 兼容代理";
const assetTagPattern = /^[\p{Script=Han}\p{L}\p{N}_ -]+$/u;
const assetMetadataSchema = z.object({
  isFavorite: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});
const reversePromptSchema = z.object({
  model: z.string().trim().min(1).max(120).optional(),
});
const reversePromptUploadSchema = z.object({
  analysisMode: z.enum(["full", "style"]).default("full"),
  customInstruction: z.string().trim().max(2000).optional(),
  format: z.enum(["natural", "json"]).default("natural"),
  language: z.enum(["zh", "en"]).default("zh"),
  maxLength: z.enum(["short", "medium", "long"]).default("long"),
  mode: z.enum(["preset", "custom"]).default("preset"),
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
        ...(query.data.media === "image" ? { mimeType: { startsWith: "image/" } } : {}),
        ...(query.data.media === "video" ? { mimeType: { startsWith: "video/" } } : {}),
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
      reply.header("Cache-Control", ASSET_FILE_CACHE_CONTROL);
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
    if (!providerSetting?.enabled) return jsonError(reply, providerNotConfiguredMessage, 400);
    try {
      const { asset, bytes } = await readOwnedAssetBytes(request.params.assetId, user.id);
      if (!asset.mimeType.startsWith("image/")) return jsonError(reply, "仅支持图片素材反推提示词", 400);
      const cleanedPromptText = await reversePromptFromImage({
        bytes,
        mimeType: asset.mimeType,
        providerSetting,
        requestedModel: parsed.data.model,
      });
      return { promptText: cleanedPromptText };
    } catch (error) {
      const message = getErrorMessage(error, "反推提示词失败");
      return jsonError(reply, message, message.includes("未在后台启用") ? 400 : 500);
    }
  });

  app.get<{ Params: { assetId: string } }>("/api/assets/:assetId/thumbnail", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    try {
      const canReadAnyAsset = user.username === getAdminUsername() && user.role === "admin";
      const { asset, bytes } = canReadAnyAsset ? await readAssetBytes(request.params.assetId) : await readOwnedAssetBytes(request.params.assetId, user.id);
      if (!asset.mimeType.startsWith("image/")) return jsonError(reply, "Asset thumbnail not found", 404);
      const thumbnail = await createAssetThumbnail(bytes);
      reply.header("Cache-Control", ASSET_THUMBNAIL_CACHE_CONTROL);
      reply.header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(`${path.parse(asset.storageKey).name}-thumb.webp`)}`);
      reply.header("Content-Length", String(thumbnail.byteLength));
      reply.type("image/webp");
      return reply.send(thumbnail);
    } catch {
      return jsonError(reply, "Asset thumbnail not found", 404);
    }
  });

  app.post("/api/reverse-prompt", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const data = await request.file();
    if (!data) return jsonError(reply, "file is required");
    const options = parseReversePromptUploadFields(data.fields);
    if (!options.ok) return jsonError(reply, options.error);
    const providerSetting = await getProviderSetting(user.id, user.canUseAdminProvider);
    if (!providerSetting?.enabled) return jsonError(reply, providerNotConfiguredMessage, 400);
    const mimeType = data.mimetype || inferImageMimeType(data.filename);
    if (!mimeType.startsWith("image/")) return jsonError(reply, "仅支持图片反推提示词", 400);
    try {
      const bytes = await data.toBuffer();
      const promptText = await reversePromptFromImage({
        bytes,
        mimeType,
        options: options.data,
        providerSetting,
        requestedModel: options.data.model,
      });
      return { promptText };
    } catch (error) {
      const message = getErrorMessage(error, "反推提示词失败");
      return jsonError(reply, message, message.includes("未在后台启用") ? 400 : 500);
    }
  });
}

async function reversePromptFromImage(input: {
  bytes: Buffer;
  mimeType: string;
  options?: z.infer<typeof reversePromptUploadSchema>;
  providerSetting: NonNullable<Awaited<ReturnType<typeof getProviderSetting>>>;
  requestedModel?: string;
}) {
  const defaultTextModelValue = input.providerSetting.textModel || getTextModel(input.providerSetting);
  const defaultTextModelError = getConfiguredModelError(defaultTextModelValue, "默认反推模型");
  if (defaultTextModelError) throw new Error(defaultTextModelError);
  if (!isConfiguredModelEnabled(input.providerSetting.enabledReversePromptModels, defaultTextModelValue)) {
    throw new Error("默认反推模型未启用");
  }
  const defaultTextModel = parseConfiguredModelValue(defaultTextModelValue);
  const requestedModel = input.requestedModel ? parseConfiguredModelValue(input.requestedModel) : null;
  const requestedModelError = input.requestedModel ? getConfiguredModelError(input.requestedModel, "所选反推模型") : "";
  if (requestedModelError) throw new Error(requestedModelError);
  const enabledModels = getEnabledProviderModels(input.providerSetting.enabledReversePromptModels, defaultTextModelValue);
  if (requestedModel && !enabledModels.some((model) =>
    model.id === requestedModel.id &&
    (!requestedModel.channel || (model.channel ?? "provider") === requestedModel.channel))) {
    throw new Error("所选反推模型未在后台启用");
  }
  const model = requestedModel?.id || defaultTextModel.id;
  const modelChannel = requestedModel
    ? requestedModel.channel ?? resolveReversePromptRequestedModelChannel(input.providerSetting, model)
    : defaultTextModel.channel ?? resolveReversePromptModelChannel(input.providerSetting, model);
  const reversePromptProviderSetting = await getReversePromptProviderSetting(input.providerSetting, model, modelChannel);
  const openai = createOpenAIClient(reversePromptProviderSetting);
  const imageUrl = `data:${input.mimeType};base64,${input.bytes.toString("base64")}`;
  const userInstruction = buildReversePromptUserInstruction(input.options);
  let promptText = "";
  try {
    const response = await openai.responses.create({
      input: [
        {
          content: [
            { text: `${reversePromptInstruction}\n\n${userInstruction}`, type: "input_text" },
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
  } catch (responsesError) {
    try {
      const response = await openai.chat.completions.create({
        max_tokens: 1400,
        messages: [
          { content: reversePromptInstruction, role: "system" },
          {
            content: [
              { text: userInstruction, type: "text" },
              { image_url: { url: imageUrl }, type: "image_url" },
            ],
            role: "user",
          },
        ],
        model,
        temperature: 0.2,
      });
      const chatPromptText = response.choices[0]?.message.content;
      promptText = typeof chatPromptText === "string" ? chatPromptText.trim() : "";
    } catch (chatError) {
      throw new Error(formatReversePromptError(chatError, {
        model,
        providerDisplayName: reversePromptProviderSetting.displayName,
        route: getReversePromptProviderRoute(modelChannel),
      }), { cause: responsesError });
    }
  }
  const cleanedPromptText = cleanReversePromptText(promptText);
  if (!cleanedPromptText) throw new Error("反推提示词失败：模型未返回可用文本");
  return cleanedPromptText;
}

export function resolveReversePromptModelChannel(
  providerSetting: Pick<ProviderSetting, "enabledReversePromptModels" | "textModel">,
  model: string,
): ProviderModelChannel {
  return resolveTextModelChannel(providerSetting, model);
}

export function resolveReversePromptRequestedModelChannel(
  providerSetting: Pick<ProviderSetting, "enabledReversePromptModels" | "textModel">,
  model: string,
): ProviderModelChannel {
  return resolveRequestedTextModelChannel(providerSetting, model);
}

export async function getReversePromptProviderSetting<T extends ProviderSetting | Pick<ProviderSetting, "apiKey" | "baseUrl" | "displayName" | "enabledReversePromptModels" | "imageModel" | "textModel">>(
  providerSetting: T,
  model: string,
  modelChannel: ProviderModelChannel,
): Promise<T> {
  return getTextGenerationProviderSetting(providerSetting, model, modelChannel);
}

export function formatReversePromptError(error: unknown, context: { model: string; providerDisplayName: string; route: string }) {
  const message = getErrorMessage(error, "反推提示词失败");
  const lowerMessage = message.toLowerCase();
  const contextText = `模型：${context.model}，后端：${context.providerDisplayName}，通道：${context.route}`;
  if (message === "Not found" || lowerMessage.includes("404") || lowerMessage.includes("not found")) {
    return `反推提示词失败：当前本地模型通道没有找到可用的视觉文本接口或模型（${contextText}）。请在本地设置中确认该模型的通道配置，或改选已接入的反推 / 提示词模型。`;
  }
  if (lowerMessage.includes("unsupported") || lowerMessage.includes("model")) {
    return `反推提示词失败：当前模型或接口不支持图片理解（${contextText}）：${message}`;
  }
  return `反推提示词服务返回错误（${contextText}）：${message}`;
}

function getReversePromptProviderRoute(modelChannel: ProviderModelChannel) {
  if (modelChannel === "codex") return "codex";
  if (modelChannel === "gemini-bridge") return "gemini-bridge";
  return "provider-setting";
}

export function buildReversePromptUserInstruction(options?: z.infer<typeof reversePromptUploadSchema>) {
  if (!options) return "请反推这张参考图的生图提示词，只返回提示词正文。";
  const language = options.language === "en" ? "英文" : "中文";
  const format = options.format === "json" ? "JSON 结构" : "自然语言";
  const length = options.maxLength === "short" ? "80-200字" : options.maxLength === "medium" ? "120-300字" : "201-500字";
  const customInstruction = options.mode === "custom" && options.customInstruction ? `\n附加要求：${options.customInstruction}` : "";
  if (options.analysisMode === "style") {
    return [
      "请把参考图拆解成可编辑的细节调整提示词结构。目标不是写抽象风格总结，而是按照图片里实际可见的细节进行格式化，方便用户后续替换、增删或微调局部描述。",
      `输出语言：${language}。字数限制：${length}。`,
      "输出必须参考模板体系标准的拆解方式，但栏目内容必须来自当前图片的具体观察结果。",
      "按以下栏目输出：",
      "图像定位：用 1 句话说明这张图属于什么类型、主要用途和整体观感。",
      "主体细节：拆解主体身份/物体类型、姿态/形态、表情/动作、服饰/包装/结构、关键装饰、文字或标识、可替换元素。人物图必须包含面部朝向、身体朝向、手势、视线和服装层次；产品图必须包含结构、边缘、屏幕/标签、接口、包装和摆放状态。",
      "场景与背景：拆解环境、空间层次、前中后景、道具、背景纹理、留白和遮挡关系。风景/建筑图必须包含地平线位置、天空/地面比例、远中近景层次、天气、季节、时间段和空间尺度。",
      "机位与角度：拆解相机高度、拍摄方向、俯仰角、水平/斜角、人物或物体的面向、视线方向、地平线位置、透视强度。必须明确是平视、俯视、仰视、鸟瞰、低机位、过肩、侧面、正面、三分之二侧面等。",
      "构图与镜头：拆解画幅比例、景别、主体占比、中心/对称/三分/引导线/框景/留白、焦距感、景深、虚化、畸变和裁切边界。",
      "动态与叙事：拆解画面是否有运动方向、风吹/水流/光线移动/人物动作趋势、事件前后关系、情绪张力和视觉焦点转移。静物或 UI 图可以说明为“稳定展示，无明显动作”。",
      "光影与色彩：拆解主光方向、补光/轮廓光、光质、阴影、反光/高光、曝光、对比度、主色、辅色、点缀色、饱和度、色温和调色倾向。",
      "材质与纹理：拆解皮肤、布料、金属、玻璃、塑料、纸张、建筑表面、颗粒、噪点、笔触等可见质感。",
      "风格与渲染：拆解摄影/插画/3D/UI/信息图/海报等风格、渲染精度、后期质感、清晰度、画质要求和模型容易误解的关键约束。",
      "负向约束：列出 3-6 条为了保持这张图观感需要避免的内容，例如错误机位、主体比例漂移、五官/手部变形、文字乱码、材质混乱、过曝、背景喧宾夺主等。",
      "可调整项：列出 8-12 个最适合用户后续修改的变量，格式为“[变量名]：当前值 -> 可替换方向”。变量必须优先覆盖主体、场景、机位角度、镜头景别、光影、色彩、材质、动作/情绪。",
      `细节调整提示词：输出一段${format}，把以上细节组织成可直接复制的生图/改图提示词；保留当前图片的关键细节，但用 [方括号变量] 标出适合替换的局部。`,
      "不要只输出宽泛词汇，例如“高级感、电影感、精致、写实”；每个风格词都要落到图片中可见的细节、材质、光影、构图或颜色上。",
      customInstruction.trim(),
    ].filter(Boolean).join("\n");
  }
  const analysisMode = "完整描述画面主体、服饰/物体、环境、构图、光影、材质和风格。";
  return `请反推这张参考图的生图提示词，只返回可直接复制的提示词正文。输出语言：${language}。输出格式：${format}。字数限制：${length}。分析模式：${analysisMode}${customInstruction}`;
}

function parseReversePromptUploadFields(fields: Record<string, unknown>) {
  const parsed = reversePromptUploadSchema.safeParse({
    analysisMode: getMultipartFieldValue(fields.analysisMode),
    customInstruction: getMultipartFieldValue(fields.customInstruction),
    format: getMultipartFieldValue(fields.format),
    language: getMultipartFieldValue(fields.language),
    maxLength: getMultipartFieldValue(fields.maxLength),
    mode: getMultipartFieldValue(fields.mode),
    model: getMultipartFieldValue(fields.model),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "反推参数无效", ok: false as const };
  return { data: parsed.data, ok: true as const };
}

function getMultipartFieldValue(field: unknown) {
  if (!field || typeof field !== "object" || !("value" in field)) return undefined;
  const value = (field as { value?: unknown }).value;
  return typeof value === "string" ? value : undefined;
}

export function cleanReversePromptText(value: string) {
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
  media: "all" | "image" | "video";
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
    thumbnailUrl: assetThumbnailUrl(asset.id),
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

function assetThumbnailUrl(assetId: string) {
  return `/api/assets/${assetId}/thumbnail`;
}

async function createAssetThumbnail(bytes: Buffer) {
  return sharp(bytes, { limitInputPixels: false })
    .rotate()
    .resize({
      fit: "inside",
      height: ASSET_THUMBNAIL_MAX_SIZE,
      withoutEnlargement: true,
      width: ASSET_THUMBNAIL_MAX_SIZE,
    })
    .webp({ effort: 4, quality: 78 })
    .toBuffer();
}

function parseAssetListQuery(queryValue: unknown): { data: AssetListQuery; ok: true } | { error: string; ok: false } {
  const query = isRecord(queryValue) ? queryValue : {};
  const limit = parseAssetListLimit(query.limit);
  if (limit === null) return { error: "limit must be an integer from 1 to 100", ok: false };
  const kind = parseOptionalString(query.kind);
  if (!kind.ok) return { error: "kind must be a single value", ok: false };
  if (kind.value !== null && !listableKinds.has(kind.value as AssetKind)) return { error: "Unsupported asset kind", ok: false };
  const media = parseMediaFilter(query.media);
  if (!media.ok) return { error: media.error, ok: false };
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
      media: media.value,
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

function parseMediaFilter(value: unknown): { ok: true; value: AssetListQuery["media"] } | { error: string; ok: false } {
  if (value === undefined) return { ok: true, value: "all" };
  if (Array.isArray(value)) return { error: "media must be image, video, or all", ok: false };
  const text = String(value).trim();
  if (text === "image" || text === "video" || text === "all") return { ok: true, value: text };
  return { error: "media must be image, video, or all", ok: false };
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
