import { toFile } from "openai/uploads";
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";

import { createProjectTimestampFilename } from "@/lib/filenames";
import type { Asset, GenerationJob, ProviderSetting, User } from "@/generated/prisma/client";
import { dimensionsFromSize, isValidImageSize, type ImageSize } from "@/lib/image";
import { saveGeneratedImageArchive, saveLocalExport } from "@/lib/local-export";
import { createOpenAIClient, getImageModel } from "@/lib/openai";
import { optimizePromptSafety } from "@/lib/prompt-safety";
import { prisma } from "@/lib/prisma";
import { getConfiguredModelError, getEnabledProviderModels, isConfiguredModelEnabled, normalizeConfiguredModels, parseConfiguredModelValue } from "@/lib/provider-models";
import { isReferenceRole, referenceRoleValues } from "@/lib/reference-roles";
import { AssetFileMissingError, readBoardAssetBytes, saveLocalAsset } from "@/lib/storage";
import { getProviderSetting } from "./provider-settings-helper";
import { readCodexApiKey } from "./lib/codex-oauth";
import { createCliProxyProviderSetting } from "./lib/cliproxy";

export const storyboardFrameValues = ["start", "end"] as const;
export type StoryboardFrameKind = (typeof storyboardFrameValues)[number];
export const imageModelChannelValues = ["provider", "gemini-bridge", "codex", "cliproxy"] as const;
export type ImageModelChannel = (typeof imageModelChannelValues)[number];

export const referenceItemSchema = z.object({
  assetId: z.string().min(1),
  role: z.string().refine(isReferenceRole, `Invalid reference role. Expected one of: ${referenceRoleValues.join(", ")}`).optional(),
  weight: z.enum(["low", "medium", "high"]).optional(),
});
const geminiBridgeImageModels = new Set(["gemini-web", "nano-banana"]);
const geminiBridgeDisplayName = "Gemini Web Bridge";
const providerNotConfiguredMessage = "请先在本地设置中配置第三方 API、Gemini Bridge 或 Codex 兼容代理";
const CANCELLED_GENERATION_MESSAGE = "生成任务已中止";

export const imageGenerationInputSchema = z.object({
  boardId: z.string().min(1),
  count: z.number().int().min(1).max(3).default(1),
  maskAssetId: z.string().optional(),
  mode: z.enum(["text_to_image", "inpaint"]),
  model: z.string().trim().min(1).max(120).optional(),
  prompt: z.string().trim().min(1).max(32000),
  referenceAssetIds: z.array(z.string().min(1)).max(8).default([]),
  referenceItems: z.array(referenceItemSchema).max(8).optional(),
  size: z.string().refine(isValidImageSize, "Invalid gpt-image-2 image size").default("1024x1024"),
  sourceAssetId: z.string().optional(),
  taskKind: z.enum(["standard", "variant", "multi_angle"]).default("standard"),
});

export type ImageGenerationInput = z.infer<typeof imageGenerationInputSchema>;
export type CreateImageGenerationInput = Omit<ImageGenerationInput, "taskKind"> & {
  taskKind?: ImageGenerationInput["taskKind"];
};

export type CreateGenerationJobInput = {
  boardName: string;
  generation: CreateImageGenerationInput;
  log?: FastifyBaseLogger;
  paramsMetadata?: Record<string, unknown>;
  user: Pick<User, "canUseAdminProvider" | "generationFiveHourLimit" | "generationLimit" | "id" | "name" | "username">;
};

export async function createAndRunImageGenerationJob(input: CreateGenerationJobInput) {
  const jobResult = await createImageGenerationJob(input);
  if (!jobResult.ok) return jobResult;
  return runCreatedImageGenerationJob({ ...jobResult, log: input.log });
}

export async function createImageGenerationJob(input: CreateGenerationJobInput) {
  const providerSetting = await getProviderSetting(input.user.id, input.user.canUseAdminProvider);
  const providerOwner = providerSetting?.userId === input.user.id ? "self" : "admin";
  if (!providerSetting?.enabled) {
    return { ok: false as const, error: providerNotConfiguredMessage, statusCode: 400 };
  }

  const defaultImageModel = parseConfiguredModelValue(providerSetting.imageModel || getImageModel(providerSetting));
  const defaultImageModelError = getConfiguredModelError(providerSetting.imageModel || getImageModel(providerSetting), "默认图像模型");
  if (defaultImageModelError) return { ok: false as const, error: defaultImageModelError, statusCode: 400 };
  if (!isConfiguredModelEnabled(providerSetting.enabledImageModels, providerSetting.imageModel || getImageModel(providerSetting))) {
    return { ok: false as const, error: "默认图像模型未启用", statusCode: 400 };
  }
  const requestedModel = input.generation.model ? parseConfiguredModelValue(input.generation.model) : null;
  const requestedModelError = input.generation.model ? getConfiguredModelError(input.generation.model, "所选图像模型") : "";
  if (requestedModelError) return { ok: false as const, error: requestedModelError, statusCode: 400 };
  const model = requestedModel?.id ?? defaultImageModel.id;
  const requestedChannel = requestedModel?.channel;
  if (requestedModel && !getEnabledProviderModels(providerSetting.enabledImageModels, providerSetting.imageModel || getImageModel(providerSetting)).some((enabledModel) =>
    enabledModel.id === requestedModel.id &&
    (!requestedChannel || (enabledModel.channel ?? "provider") === requestedChannel))) {
    return { ok: false as const, error: "所选图像模型未在后台启用", statusCode: 400 };
  }
  const modelChannel = requestedModel
    ? requestedChannel ?? resolveRequestedImageModelChannel(providerSetting, model)
    : defaultImageModel.channel ?? resolveImageModelChannel(providerSetting, model);
  let generationProviderSetting: ProviderSetting;
  try {
    generationProviderSetting = await getImageGenerationProviderSetting(providerSetting, model, modelChannel);
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "图片模型通道配置无效", statusCode: 400 };
  }
  const quotaError = await getGenerationQuotaError({
    count: input.generation.count,
    generationFiveHourLimit: input.user.generationFiveHourLimit,
    generationLimit: input.user.generationLimit,
    userId: input.user.id,
  });
  if (quotaError) return { ok: false as const, error: quotaError, statusCode: 429 };

  const referenceItems = input.generation.referenceItems?.length
    ? input.generation.referenceItems
    : input.generation.referenceAssetIds.map((assetId) => ({ assetId }));
  const referenceAssetIds = referenceItems.map((item) => item.assetId);
  if (input.generation.mode === "inpaint" && !input.generation.sourceAssetId) {
    return { ok: false as const, error: "sourceAssetId is required for image edit mode", statusCode: 400 };
  }

  const promptSafety = optimizePromptSafety(input.generation.prompt);
  const safeGeneration = {
    ...input.generation,
    prompt: promptSafety.prompt,
    taskKind: input.generation.taskKind ?? "standard",
  };

  const linkedAssetIds = Array.from(new Set([
    safeGeneration.sourceAssetId,
    safeGeneration.maskAssetId,
    ...referenceAssetIds,
  ].filter((assetId): assetId is string => Boolean(assetId))));

  if (linkedAssetIds.length > 0) {
    const linkedAssetCount = await prisma.asset.count({
      where: { boardId: input.generation.boardId, id: { in: linkedAssetIds } },
    });
    if (linkedAssetCount !== linkedAssetIds.length) {
      return { ok: false as const, error: "Referenced asset not found", statusCode: 404 };
    }
  }

  const paramsJson = JSON.stringify({
    size: input.generation.size,
    count: input.generation.count,
    model,
    modelChannel,
    providerSettingId: generationProviderSetting.id,
    providerDisplayName: generationProviderSetting.displayName,
    providerOwner,
    providerBaseUrl: generationProviderSetting.baseUrl ? "configured" : "default",
    providerRoute: getProviderRoute(modelChannel),
    promptSafety: {
      applied: promptSafety.applied,
      mode: promptSafety.mode,
      originalPromptChanged: promptSafety.applied,
      reasons: promptSafety.reasons,
    },
    referenceAssetIds,
    referenceItems,
    taskKind: safeGeneration.taskKind,
    ...input.paramsMetadata,
  });

  const job = await prisma.generationJob.create({
    data: {
      boardId: input.generation.boardId,
      maskAssetId: safeGeneration.maskAssetId,
      mode: safeGeneration.mode,
      paramsJson,
      prompt: safeGeneration.prompt,
      provider: providerSetting.provider,
      sourceAssetId: safeGeneration.sourceAssetId,
      status: "preparing",
    },
  });

  return {
    ok: true as const,
    boardName: input.boardName,
    generation: { ...safeGeneration, referenceAssetIds },
    job,
    model,
    modelChannel,
    providerSetting: generationProviderSetting,
    user: { id: input.user.id, name: input.user.name, username: input.user.username },
  };
}

export async function runCreatedImageGenerationJob(input: {
  boardName: string;
  generation: ImageGenerationInput & { referenceAssetIds: string[] };
  job: GenerationJob;
  log?: FastifyBaseLogger;
  model: string;
  modelChannel: ImageModelChannel;
  providerSetting: ProviderSetting;
  user: { id: string; name: string | null; username: string | null };
}) {
  const paramsJson = input.job.paramsJson;

  try {
    const savedAssets = await runGenerationJob({
      boardName: input.boardName,
      input: input.generation,
      job: input.job,
      log: input.log,
      model: input.model,
      modelChannel: input.modelChannel,
      providerSetting: input.providerSetting,
      user: input.user,
    });
    const updatedJob = await prisma.generationJob.findUnique({
      where: { id: input.job.id },
      include: { results: { include: { asset: true } } },
    });
    return {
      ok: true as const,
      job: updatedJob ?? {
        ...input.job,
        paramsJson,
        results: savedAssets.map((asset: Asset) => ({ asset })),
        status: "succeeded",
        updatedAt: new Date(),
      },
      model: input.model,
      results: savedAssets,
    };
  } catch (error) {
    if (isGenerationCancelledError(error)) {
      return { ok: false as const, error: CANCELLED_GENERATION_MESSAGE, statusCode: 409 };
    }
    const message = formatGenerationError(error, {
      model: input.model,
      providerBaseUrl: input.providerSetting.baseUrl,
      providerBaseUrlConfigured: Boolean(input.providerSetting.baseUrl),
      providerDisplayName: input.providerSetting.displayName,
    });
    await prisma.generationJob.update({ where: { id: input.job.id }, data: { errorMessage: message, status: "failed" } });
    input.log?.error({ err: error, jobId: input.job.id }, "image generation failed");
    return { ok: false as const, error: message, statusCode: 500 };
  }
}

async function runGenerationJob(input: {
  boardName: string;
  input: ImageGenerationInput & { referenceAssetIds: string[] };
  job: Pick<GenerationJob, "createdAt" | "id">;
  log?: FastifyBaseLogger;
  model: string;
  modelChannel: ImageModelChannel;
  providerSetting: ProviderSetting;
  user: { id: string; name: string | null; username: string | null };
}) {
  const openai = createOpenAIClient(input.providerSetting);
  const results = [];
  for (let index = 0; index < input.input.count; index += 1) {
    await updateGenerationJobStage(input.job.id, "calling_model");
    const result = input.input.mode === "text_to_image"
      ? input.input.referenceAssetIds.length > 0
        ? await generateReferencedTextToImage({ boardId: input.input.boardId, model: input.model, modelChannel: input.modelChannel, openai, prompt: input.input.prompt, referenceAssetIds: input.input.referenceAssetIds, size: input.input.size as ImageSize })
        : await openai.images.generate(toImageGenerationRequest({ model: input.model, modelChannel: input.modelChannel, prompt: input.input.prompt, size: input.input.size as ImageSize }) as never)
      : await generateInpaint({ boardId: input.input.boardId, maskAssetId: input.input.maskAssetId, model: input.model, modelChannel: input.modelChannel, openai, prompt: input.input.prompt, referenceAssetIds: input.input.referenceAssetIds, size: input.input.size as ImageSize, sourceAssetId: input.input.sourceAssetId! });
    results.push(result);
  }

  const images = results.flatMap((result) => result.data ?? []);
  if (images.length !== input.input.count) throw new Error(`OpenAI returned ${images.length} of ${input.input.count} requested images`);
  const { width, height } = dimensionsFromSize(input.input.size as ImageSize);
  await updateGenerationJobStage(input.job.id, "saving_results");
  await assertGenerationJobActive(input.job.id);
  const savedAssets = await Promise.all(images.map(async (image, index) => {
    if (!image.b64_json) throw new Error("OpenAI returned an image without b64_json");
    const bytes = Buffer.from(image.b64_json, "base64");
    const filename = createProjectTimestampFilename(input.boardName, "png", {
      date: input.job.createdAt,
      index: images.length > 1 ? index : undefined,
      username: input.user.username ?? input.user.name,
    });
    await saveLocalExport({ bytes, filename, projectName: input.boardName });
    await saveGeneratedImageArchive({ bytes, filename, username: input.user.username ?? input.user.id });
    await assertGenerationJobActive(input.job.id);
    return saveLocalAsset({ boardId: input.input.boardId, kind: "generated", bytes, filename, height, mimeType: "image/png", width });
  }));

  await assertGenerationJobActive(input.job.id);
  await prisma.$transaction(async (tx) => {
    const update = await tx.generationJob.updateMany({
      where: { id: input.job.id, status: { not: "cancelled" } },
      data: { status: "succeeded" },
    });
    if (update.count === 0) throw new Error(CANCELLED_GENERATION_MESSAGE);
    await Promise.all(savedAssets.map((asset: Asset) =>
      tx.generationResult.create({ data: { assetId: asset.id, jobId: input.job.id } })));
  });
  return savedAssets;
}

async function updateGenerationJobStage(jobId: string, status: string) {
  const update = await prisma.generationJob.updateMany({
    where: { id: jobId, status: { not: "cancelled" } },
    data: { status },
  });
  if (update.count === 0) throw new Error(CANCELLED_GENERATION_MESSAGE);
}

async function assertGenerationJobActive(jobId: string) {
  const job = await prisma.generationJob.findUnique({ select: { status: true }, where: { id: jobId } });
  if (job?.status === "cancelled") throw new Error(CANCELLED_GENERATION_MESSAGE);
}

async function generateReferencedTextToImage(input: { boardId: string; model: string; modelChannel: ImageModelChannel; openai: ReturnType<typeof createOpenAIClient>; prompt: string; referenceAssetIds: string[]; size: ImageSize }) {
  const references = await Promise.all(input.referenceAssetIds.map((assetId) => readBoardAssetBytes(assetId, input.boardId)));
  const imageFiles = await Promise.all(references.map((reference, index) => toFile(reference.bytes, `source-reference-${index + 1}.png`, { type: reference.asset.mimeType })));
  return input.openai.images.edit({
    ...toImageGenerationRequest({ model: input.model, modelChannel: input.modelChannel, prompt: input.prompt, size: input.size }),
    image: toImageInput(imageFiles),
  } as never);
}

async function generateInpaint(input: { boardId: string; maskAssetId?: string; model: string; modelChannel: ImageModelChannel; openai: ReturnType<typeof createOpenAIClient>; prompt: string; referenceAssetIds: string[]; size: ImageSize; sourceAssetId: string }) {
  const [source, ...references] = await Promise.all([readBoardAssetBytes(input.sourceAssetId, input.boardId), ...input.referenceAssetIds.map((assetId) => readBoardAssetBytes(assetId, input.boardId))]);
  const mask = input.maskAssetId ? await readBoardAssetBytes(input.maskAssetId, input.boardId) : undefined;
  const imageFiles = await Promise.all([toFile(source.bytes, "source.png", { type: source.asset.mimeType }), ...references.map((reference, index) => toFile(reference.bytes, `reference-${index + 1}.png`, { type: reference.asset.mimeType }))]);
  const request = {
    ...toImageGenerationRequest({ model: input.model, modelChannel: input.modelChannel, prompt: input.prompt, size: input.size }),
    image: toImageInput(imageFiles),
  };
  if (mask) Object.assign(request, { mask: await toFile(mask.bytes, "mask.png", { type: mask.asset.mimeType }) });
  return input.openai.images.edit(request as never);
}

function toImageGenerationRequest(input: { model: string; modelChannel: ImageModelChannel; prompt: string; size: ImageSize }) {
  const request: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    size: input.size,
    quality: "auto",
    output_format: "png",
    n: 1,
  };
  const aspectRatio = input.modelChannel === "cliproxy" ? aspectRatioFromImageSize(input.size) : undefined;
  if (aspectRatio) {
    request.aspect_ratio = aspectRatio;
    request.aspectRatio = aspectRatio;
  }
  return request;
}

function aspectRatioFromImageSize(size: ImageSize) {
  const { width, height } = dimensionsFromSize(size);
  if (!width || !height) return undefined;
  const ratio = width / height;
  const candidates = ["21:9", "2:1", "16:9", "3:2", "4:3", "1:1", "4:5", "3:4", "2:3", "9:16", "1:2", "9:21"] as const;
  return candidates.reduce((best, candidate) => {
    const candidateRatio = ratioFromAspectRatio(candidate);
    return Math.abs(candidateRatio - ratio) < Math.abs(ratioFromAspectRatio(best) - ratio) ? candidate : best;
  }, "1:1" as typeof candidates[number]);
}

function ratioFromAspectRatio(aspectRatio: string) {
  const [width, height] = aspectRatio.split(":").map((part) => Number(part));
  return width / height;
}

function toImageInput<T>(files: T[]) {
  return (files.length === 1 ? files[0] : files) as never;
}

async function getGenerationQuotaError(input: { count: number; generationFiveHourLimit: number | null; generationLimit: number | null; userId: string }) {
  if (input.generationLimit !== null) {
    const totalUsedCount = await prisma.generationResult.count({ where: { job: { board: { userId: input.userId } } } });
    const remainingTotalCount = input.generationLimit - totalUsedCount;
    if (remainingTotalCount <= 0) return "当前生成次数已用完，请调整本地使用上限或清理生成记录";
    if (input.count > remainingTotalCount) return `当前生成次数剩余 ${remainingTotalCount} 张，请降低生成张数`;
  }
  if (input.generationFiveHourLimit !== null) {
    const fiveHourWindowStart = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const windowUsedCount = await prisma.generationResult.count({ where: { createdAt: { gte: fiveHourWindowStart }, job: { board: { userId: input.userId } } } });
    const remainingWindowCount = input.generationFiveHourLimit - windowUsedCount;
    if (remainingWindowCount <= 0) return "最近 5 小时生成次数已用完，请稍后再试或调整本地使用上限";
    if (input.count > remainingWindowCount) return `最近 5 小时生成次数剩余 ${remainingWindowCount} 张，请降低生成张数`;
  }
  return null;
}

export function formatGenerationError(error: unknown, context: { model: string; providerBaseUrl?: string | null; providerBaseUrlConfigured: boolean; providerDisplayName: string }) {
  if (error instanceof AssetFileMissingError) return error.message;
  const message = error instanceof Error ? error.message : "Generation failed";
  if (message === CANCELLED_GENERATION_MESSAGE) return message;
  const lowerMessage = message.toLowerCase();
  const baseUrlText = context.providerBaseUrl ?? (context.providerBaseUrlConfigured ? "已配置" : "默认 OpenAI");
  const contextText = `本应用请求模型：${context.model}；接口：${context.providerDisplayName}；Base URL：${baseUrlText}`;
  if (lowerMessage.includes("fetch failed") || lowerMessage.includes("failed to fetch") || lowerMessage.includes("connection error") || lowerMessage.includes("network") || lowerMessage.includes("econnrefused") || lowerMessage.includes("enotfound") || lowerMessage.includes("etimedout")) {
    return `无法连接图像生成服务，请检查第三方 API 地址、网络连接或服务可用性（${contextText}）`;
  }
  if (lowerMessage.includes("404 status code")) return `当前第三方 API 地址没有提供 OpenAI Images API，请改为支持 /v1/images/generations 和 /v1/images/edits 的图片生成接口（${contextText}）：${message}`;
  return `图像生成服务返回错误（${contextText}）：${message}`;
}

function isGenerationCancelledError(error: unknown) {
  return error instanceof Error && error.message === CANCELLED_GENERATION_MESSAGE;
}

function resolveImageModelChannel(providerSetting: ProviderSetting, model: string): ImageModelChannel {
  const defaultModel = parseConfiguredModelValue(providerSetting.imageModel);
  if (defaultModel.channel && defaultModel.id === model) return defaultModel.channel;
  return resolveRequestedImageModelChannel(providerSetting, model);
}

function resolveRequestedImageModelChannel(providerSetting: ProviderSetting, model: string): ImageModelChannel {
  const configuredModels = normalizeConfiguredModels(providerSetting.enabledImageModels, "");
  const configuredModel = configuredModels.find((item) => item.enabled && item.id === model && (item.channel ?? "provider") === "provider") ??
    configuredModels.find((item) => item.enabled && item.id === model);
  if (configuredModel?.channel) return configuredModel.channel;
  const defaultModel = parseConfiguredModelValue(providerSetting.imageModel);
  if (defaultModel.channel && defaultModel.id === model) return defaultModel.channel;
  return geminiBridgeImageModels.has(model) ? "gemini-bridge" : "provider";
}

function getProviderRoute(modelChannel: ImageModelChannel) {
  if (modelChannel === "codex") return "codex";
  if (modelChannel === "cliproxy") return "cliproxy";
  if (modelChannel === "gemini-bridge") return "gemini-bridge";
  return "provider-setting";
}

async function getImageGenerationProviderSetting(providerSetting: ProviderSetting, model: string, modelChannel: ImageModelChannel): Promise<ProviderSetting> {
  if (modelChannel === "provider") return providerSetting;
  if (modelChannel === "cliproxy") return createCliProxyProviderSetting(providerSetting, model);
  if (modelChannel === "codex") {
    const proxyBaseUrl = process.env.CODEX_IMAGE_PROXY_BASE_URL?.trim();
    const proxyApiKey = process.env.CODEX_IMAGE_PROXY_API_KEY?.trim() || "codex-proxy";
    if (proxyBaseUrl) {
      return {
        ...providerSetting,
        apiKey: proxyApiKey,
        baseUrl: proxyBaseUrl,
        displayName: "官方 Codex 代理",
        imageModel: model,
      };
    }
    const apiKey = await readCodexApiKey();
    if (!apiKey) {
      throw new Error("官方 Codex 已登录的是账号 OAuth token，不是 OpenAI Images API key。请在本机配置 CODEX_IMAGE_PROXY_BASE_URL 指向 CLIProxyAPI 等 OpenAI 兼容代理，或把该模型通道改为第三方 API/Gemini Bridge");
    }
    return {
      ...providerSetting,
      apiKey,
      baseUrl: null,
      displayName: "官方 Codex",
      imageModel: model,
    };
  }
  const bridgeApiKey = process.env.GEMINI_BRIDGE_API_KEY?.trim();
  if (!bridgeApiKey) {
    throw new Error("Gemini Bridge 未配置 GEMINI_BRIDGE_API_KEY，无法调用 gemini-web/nano-banana 模型");
  }
  const bridgeHost = process.env.GEMINI_BRIDGE_HOST?.trim() || "127.0.0.1";
  const bridgePort = parseBridgePort(process.env.GEMINI_BRIDGE_PORT);
  return {
    ...providerSetting,
    apiKey: bridgeApiKey,
    baseUrl: `http://${bridgeHost}:${bridgePort}/v1`,
    displayName: geminiBridgeDisplayName,
    imageModel: model,
  };
}

function parseBridgePort(value: string | undefined) {
  if (!value) return 8317;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8317;
}
