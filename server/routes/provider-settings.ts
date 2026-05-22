import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { ProviderSetting } from "@/generated/prisma/client";
import { createOpenAIClient, getImageModel, getTextModel } from "@/lib/openai";
import { prisma } from "@/lib/prisma";
import {
  defaultProviderModelChannel,
  filterImageModelOptions,
  getEnabledProviderModels,
  getConfiguredModelError,
  isConfiguredModelEnabled,
  normalizeConfiguredModels,
  providerImageModelCatalog,
  providerReversePromptModelCatalog,
  type ConfiguredProviderModel,
  type ProviderModelChannel,
} from "@/lib/provider-models";
import { requireAdminUser, requireCurrentUser } from "../auth";
import { jsonError, parseBody } from "../http";
import { getProviderSetting } from "../provider-settings-helper";

const provider = "openai-compatible";
const maxConfiguredModels = 24;
const providerNotConfiguredMessage = "请先在本地设置中配置第三方 API、Gemini Bridge 或 Codex 兼容代理";
const configuredModelSchema = z.object({
  channel: z.enum(["provider", "gemini-bridge", "codex"]).default(defaultProviderModelChannel),
  enabled: z.boolean().default(true),
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().max(120).optional(),
}).transform((model) => ({
  channel: model.channel,
  enabled: model.enabled,
  id: model.id,
  label: model.label?.trim() || model.id,
}));
const providerSettingSchema = z.object({
  apiKey: z.string().trim().max(4096).optional().transform((value) => value || undefined),
  baseUrl: z.string().trim().max(2048).optional().transform((value) => value || null).refine((value) => !value || isValidUrl(value), "Invalid base URL"),
  displayName: z.string().trim().min(1).max(80),
  imageModel: z.string().trim().min(1).max(120).optional(),
  textModel: z.string().trim().min(1).max(120).optional(),
  enabledImageModels: z.array(configuredModelSchema).max(maxConfiguredModels).optional(),
  enabledReversePromptModels: z.array(configuredModelSchema).max(maxConfiguredModels).optional(),
});
const applyHistorySchema = z.object({
  historyId: z.string().trim().min(1),
});

function getProviderSettingModelError(input: {
  enabledImageModels?: unknown;
  enabledReversePromptModels?: unknown;
  imageModel?: string;
  textModel?: string;
}) {
  if (input.imageModel) {
    const error = getConfiguredModelError(input.imageModel, "默认图像模型");
    if (error) return error;
  }
  if (input.textModel) {
    const error = getConfiguredModelError(input.textModel, "默认文本模型");
    if (error) return error;
  }
  if (input.imageModel && input.enabledImageModels && !isConfiguredModelEnabled(input.enabledImageModels, input.imageModel)) {
    return "默认图像模型必须在已启用模型中";
  }
  if (input.textModel && input.enabledReversePromptModels && !isConfiguredModelEnabled(input.enabledReversePromptModels, input.textModel)) {
    return "默认文本模型必须在已启用模型中";
  }
  return "";
}

export async function registerProviderSettingRoutes(app: FastifyInstance) {
  app.get("/api/provider-settings", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const providerSetting = await prisma.providerSetting.findUnique({ where: { userId_provider: { provider, userId: user.id } } });
    const histories = await prisma.providerSettingHistory.findMany({
      orderBy: { updatedAt: "desc" },
      take: 10,
      where: { provider, userId: user.id },
    });
    return {
      histories: histories.map(redactProviderSettingHistory),
      providerSetting: redactProviderSetting(providerSetting),
    };
  });

  app.get("/api/provider-settings/image-models", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const providerSetting = await getProviderSetting(user.id, user.canUseAdminProvider);
    if (!providerSetting?.enabled) {
      return jsonError(reply, providerNotConfiguredMessage, 400);
    }
    const fallbackModel = getImageModel(providerSetting);
    const selectedModel = providerSetting.imageModel || fallbackModel;
    const configuredModels = providerSetting.enabledImageModels
      ? getEnabledProviderModels(providerSetting.enabledImageModels, selectedModel)
      : [];
    if (configuredModels.length > 0) return { models: configuredModels, selectedModel };
    try {
      const openai = createOpenAIClient(providerSetting);
      const page = await openai.models.list();
      const models = filterImageModelOptions(page.data, fallbackModel);
      return { models, selectedModel: fallbackModel };
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法读取模型列表";
      request.log.warn({ err: error }, "failed to list provider image models");
      return {
        error: `无法读取第三方模型列表，已回退到当前图片模型：${message}`,
        models: filterImageModelOptions([], fallbackModel),
        selectedModel,
      };
    }
  });

  app.get("/api/provider-settings/model-options", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const providerSetting = await getProviderSetting(user.id, user.canUseAdminProvider);
    if (!providerSetting?.enabled) {
      return {
        error: providerNotConfiguredMessage,
        imageModels: [{ id: "gpt-image-2", label: "gpt-image-2" }],
        reversePromptModels: [{ id: "gpt-5.5", label: "gpt-5.5" }],
        selectedImageModel: "gpt-image-2",
        selectedReversePromptModel: "gpt-5.5",
      };
    }
    const imageFallback = getImageModel(providerSetting);
    const reverseFallback = getTextModel(providerSetting);
    return {
      imageModels: getEnabledProviderModels(providerSetting.enabledImageModels, providerSetting.imageModel || imageFallback),
      reversePromptModels: getEnabledProviderModels(providerSetting.enabledReversePromptModels, providerSetting.textModel || reverseFallback),
      selectedImageModel: providerSetting.imageModel || imageFallback,
      selectedReversePromptModel: providerSetting.textModel || reverseFallback,
    };
  });

  app.get("/api/admin/provider-models/catalog", async (request, reply) => {
    const user = await requireAdminUser(request, reply);
    if (!user) return;
    return {
      imageModels: providerImageModelCatalog,
      reversePromptModels: providerReversePromptModelCatalog,
    };
  });

  app.put("/api/provider-settings", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const parsed = parseBody(providerSettingSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const modelError = getProviderSettingModelError(parsed.data);
    if (modelError) return jsonError(reply, modelError, 400);
    const existing = await prisma.providerSetting.findUnique({ where: { userId_provider: { provider, userId: user.id } } });
    const apiKey = parsed.data.apiKey ?? existing?.apiKey;
    if (!apiKey) return jsonError(reply, "API Key is required");
    const imageModel = parsed.data.imageModel ?? existing?.imageModel ?? "gpt-image-2";
    const textModel = parsed.data.textModel ?? existing?.textModel ?? "gpt-5.5";
    const enabledImageModels = parsed.data.enabledImageModels === undefined
      ? existing?.enabledImageModels ?? serializeConfiguredModels([], imageModel)
      : serializeConfiguredModels(parsed.data.enabledImageModels, imageModel);
    const enabledReversePromptModels = parsed.data.enabledReversePromptModels === undefined
      ? existing?.enabledReversePromptModels ?? serializeConfiguredModels([], textModel)
      : serializeConfiguredModels(parsed.data.enabledReversePromptModels, textModel);
    const finalModelError = getProviderSettingModelError({
      enabledImageModels,
      enabledReversePromptModels,
      imageModel,
      textModel,
    });
    if (finalModelError) return jsonError(reply, finalModelError, 400);
    const providerSetting = await prisma.providerSetting.upsert({
      where: { userId_provider: { provider, userId: user.id } },
      create: { apiKey, baseUrl: parsed.data.baseUrl, displayName: parsed.data.displayName, enabled: true, enabledImageModels, enabledReversePromptModels, imageModel, provider, textModel, userId: user.id },
      update: { apiKey, baseUrl: parsed.data.baseUrl, displayName: parsed.data.displayName, enabled: true, enabledImageModels, enabledReversePromptModels, imageModel, textModel },
    });
    await recordProviderSettingHistory(providerSetting);
    const histories = await prisma.providerSettingHistory.findMany({
      orderBy: { updatedAt: "desc" },
      take: 10,
      where: { provider, userId: user.id },
    });
    return { histories: histories.map(redactProviderSettingHistory), providerSetting: redactProviderSetting(providerSetting) };
  });

  app.post("/api/provider-settings/history/apply", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const parsed = parseBody(applyHistorySchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const history = await prisma.providerSettingHistory.findFirst({
      where: { id: parsed.data.historyId, provider, userId: user.id },
    });
    if (!history) return jsonError(reply, "API 设置历史不存在", 404);
    const modelError = getProviderSettingModelError({
      enabledImageModels: history.enabledImageModels,
      enabledReversePromptModels: history.enabledReversePromptModels,
      imageModel: history.imageModel,
      textModel: history.textModel,
    });
    if (modelError) return jsonError(reply, modelError, 400);
    const providerSetting = await prisma.providerSetting.upsert({
      where: { userId_provider: { provider, userId: user.id } },
      create: {
        apiKey: history.apiKey,
        baseUrl: history.baseUrl,
        displayName: history.displayName,
        enabled: true,
        enabledImageModels: history.enabledImageModels,
        enabledReversePromptModels: history.enabledReversePromptModels,
        imageModel: history.imageModel,
        provider,
        textModel: history.textModel,
        userId: user.id,
      },
      update: {
        apiKey: history.apiKey,
        baseUrl: history.baseUrl,
        displayName: history.displayName,
        enabled: true,
        enabledImageModels: history.enabledImageModels,
        enabledReversePromptModels: history.enabledReversePromptModels,
        imageModel: history.imageModel,
        textModel: history.textModel,
      },
    });
    await prisma.providerSettingHistory.update({ data: { updatedAt: new Date() }, where: { id: history.id } });
    const histories = await prisma.providerSettingHistory.findMany({
      orderBy: { updatedAt: "desc" },
      take: 10,
      where: { provider, userId: user.id },
    });
    return { histories: histories.map(redactProviderSettingHistory), providerSetting: redactProviderSetting(providerSetting) };
  });

  app.delete("/api/provider-settings", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const existing = await prisma.providerSetting.findUnique({ where: { userId_provider: { provider, userId: user.id } } });
    if (!existing) return { providerSetting: null };
    const providerSetting = await prisma.providerSetting.update({ where: { userId_provider: { provider, userId: user.id } }, data: { enabled: false } });
    return { providerSetting: redactProviderSetting(providerSetting) };
  });

  app.put("/api/admin/provider-models", async (request, reply) => {
    const user = await requireAdminUser(request, reply);
    if (!user) return;
    const parsed = parseBody(z.object({
      enabledImageModels: z.array(configuredModelSchema).max(maxConfiguredModels),
      enabledReversePromptModels: z.array(configuredModelSchema).max(maxConfiguredModels),
      imageModel: z.string().trim().min(1).max(120).optional(),
      textModel: z.string().trim().min(1).max(120).optional(),
    }), request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const existing = await prisma.providerSetting.findUnique({ where: { userId_provider: { provider, userId: user.id } } });
    if (!existing) return jsonError(reply, "请先保存 API 设置，再配置前台可选模型", 400);
    const imageModel = parsed.data.imageModel ?? encodeConfiguredModelFallback(parsed.data.enabledImageModels.find((model) => model.enabled)) ?? existing.imageModel;
    const textModel = parsed.data.textModel ?? encodeConfiguredModelFallback(parsed.data.enabledReversePromptModels.find((model) => model.enabled)) ?? existing.textModel;
    const modelError = getProviderSettingModelError({
      enabledImageModels: parsed.data.enabledImageModels,
      enabledReversePromptModels: parsed.data.enabledReversePromptModels,
      imageModel,
      textModel,
    });
    if (modelError) return jsonError(reply, modelError, 400);
    const providerSetting = await prisma.providerSetting.update({
      data: {
        enabledImageModels: serializeConfiguredModels(parsed.data.enabledImageModels, imageModel),
        enabledReversePromptModels: serializeConfiguredModels(parsed.data.enabledReversePromptModels, textModel),
        imageModel,
        textModel,
      },
      where: { userId_provider: { provider, userId: user.id } },
    });
    await recordProviderSettingHistory(providerSetting);
    return { providerSetting: redactProviderSetting(providerSetting) };
  });
}

function withDefaultChannel<T extends { channel?: ProviderModelChannel }>(model: T): T & { channel: ProviderModelChannel } {
  return { ...model, channel: model.channel ?? defaultProviderModelChannel };
}

function encodeConfiguredModelFallback(model: ConfiguredProviderModel | undefined) {
  return model ? `${model.channel ?? defaultProviderModelChannel}:${model.id}` : undefined;
}

function redactProviderSetting(setting: ProviderSetting | null) {
  if (!setting) return null;
  return {
    id: setting.id,
    provider: setting.provider,
    displayName: setting.displayName,
    baseUrl: setting.baseUrl,
    imageModel: setting.imageModel,
    textModel: setting.textModel,
    enabledImageModels: normalizeConfiguredModels(setting.enabledImageModels, setting.imageModel).map(withDefaultChannel),
    enabledReversePromptModels: normalizeConfiguredModels(setting.enabledReversePromptModels, setting.textModel).map(withDefaultChannel),
    enabled: setting.enabled,
    hasApiKey: true,
    apiKeyPreview: redactApiKey(setting.apiKey),
    updatedAt: setting.updatedAt,
  };
}

function redactProviderSettingHistory(setting: {
  baseUrl: string | null;
  displayName: string;
  enabledImageModels: string | null;
  enabledReversePromptModels: string | null;
  id: string;
  imageModel: string;
  apiKey: string;
  provider: string;
  textModel: string;
  updatedAt: Date;
}) {
  return {
    id: setting.id,
    provider: setting.provider,
    displayName: setting.displayName,
    baseUrl: setting.baseUrl,
    imageModel: setting.imageModel,
    textModel: setting.textModel,
    enabledImageModels: normalizeConfiguredModels(setting.enabledImageModels, setting.imageModel).map(withDefaultChannel),
    enabledReversePromptModels: normalizeConfiguredModels(setting.enabledReversePromptModels, setting.textModel).map(withDefaultChannel),
    apiKeyPreview: redactApiKey(setting.apiKey),
    updatedAt: setting.updatedAt,
  };
}

function redactApiKey(apiKey: string) {
  return apiKey.length <= 8 ? "已保存" : `${apiKey.slice(0, 3)}...${apiKey.slice(-4)}`;
}

async function recordProviderSettingHistory(setting: ProviderSetting) {
  const existingHistory = await prisma.providerSettingHistory.findFirst({
    where: {
      baseUrl: setting.baseUrl,
      displayName: setting.displayName,
      provider: setting.provider,
      userId: setting.userId,
    },
  });
  const data = {
    apiKey: setting.apiKey,
    baseUrl: setting.baseUrl,
    displayName: setting.displayName,
    enabledImageModels: setting.enabledImageModels,
    enabledReversePromptModels: setting.enabledReversePromptModels,
    imageModel: setting.imageModel,
    provider: setting.provider,
    textModel: setting.textModel,
    userId: setting.userId,
  };
  if (existingHistory) {
    await prisma.providerSettingHistory.update({ data, where: { id: existingHistory.id } });
    return;
  }
  await prisma.providerSettingHistory.create({ data });
}

function serializeConfiguredModels(models: ConfiguredProviderModel[] | undefined, fallbackModel: string) {
  return JSON.stringify(normalizeConfiguredModels(models ?? [], fallbackModel));
}

function isValidUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
