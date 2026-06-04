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
  providerVideoModelCatalog,
  type ConfiguredProviderModel,
  type ProviderModelChannel,
} from "@/lib/provider-models";
import { requireAdminUser, requireCurrentUser } from "../auth";
import { formatGenerationError } from "../generation-job-service";
import { jsonError, parseBody } from "../http";
import { createCliProxyProviderSetting, ensureCliProxyRuntimeConfig, getCliProxyEnvironmentStatus, getCliProxyManagementKey, resolveCliProxyBaseUrl, resolveCliProxyManagementKey } from "../lib/cliproxy";
import { getProviderSetting } from "../provider-settings-helper";

const provider = "openai-compatible";
const maxConfiguredModels = 24;
const providerNotConfiguredMessage = "请先在本地设置中配置第三方 API、Gemini Bridge 或 Codex 兼容代理";
const configuredModelSchema = z.object({
  channel: z.enum(["provider", "gemini-bridge", "codex", "cliproxy"]).default(defaultProviderModelChannel),
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
  cliProxyApiKey: z.string().trim().max(4096).optional().transform((value) => value || undefined),
  cliProxyManagementKey: z.string().trim().max(4096).optional().transform((value) => value || undefined),
  cliProxyBaseUrl: z.string().trim().max(2048).optional().transform((value) => value || null).refine((value) => !value || isValidUrl(value), "Invalid CLIProxyAPI Base URL"),
  displayName: z.string().trim().min(1).max(80),
  imageModel: z.string().trim().min(1).max(120).optional(),
  textModel: z.string().trim().min(1).max(120).optional(),
  videoModel: z.string().trim().min(1).max(120).optional(),
  enabledImageModels: z.array(configuredModelSchema).max(maxConfiguredModels).optional(),
  enabledReversePromptModels: z.array(configuredModelSchema).max(maxConfiguredModels).optional(),
  enabledVideoModels: z.array(configuredModelSchema).max(maxConfiguredModels).optional(),
});
const applyHistorySchema = z.object({
  historyId: z.string().trim().min(1),
});
const cliProxySettingSchema = z.object({
  cliProxyApiKey: z.string().trim().max(4096).optional().transform((value) => value || undefined),
  cliProxyManagementKey: z.string().trim().max(4096).optional().transform((value) => value || undefined),
  cliProxyBaseUrl: z.string().trim().max(2048).optional().transform((value) => value || null).refine((value) => !value || isValidUrl(value), "Invalid CLIProxyAPI Base URL"),
});
const cliProxyInitializeSchema = z.object({
  rotateApiKey: z.boolean().optional().default(false),
});
const cliProxyOAuthProviderSchema = z.enum(["gemini-cli", "codex", "anthropic", "antigravity"]);
const cliProxyOAuthParamsSchema = z.object({
  providerName: cliProxyOAuthProviderSchema,
});
const cliProxyOAuthStatusQuerySchema = z.object({
  state: z.string().trim().min(1).max(128),
});
const cliProxyOnlyApiKey = "__cliproxy_only_provider_placeholder__";

function getProviderSettingModelError(input: {
  enabledImageModels?: unknown;
  enabledReversePromptModels?: unknown;
  enabledVideoModels?: unknown;
  imageModel?: string;
  textModel?: string;
  videoModel?: string;
}) {
  if (input.imageModel) {
    const error = getConfiguredModelError(input.imageModel, "默认图像模型");
    if (error) return error;
  }
  if (input.textModel) {
    const error = getConfiguredModelError(input.textModel, "默认文本模型");
    if (error) return error;
  }
  if (input.videoModel) {
    const error = getConfiguredModelError(input.videoModel, "默认视频模型");
    if (error) return error;
  }
  if (input.imageModel && input.enabledImageModels && !isConfiguredModelEnabled(input.enabledImageModels, input.imageModel)) {
    return "默认图像模型必须在已启用模型中";
  }
  if (input.textModel && input.enabledReversePromptModels && !isConfiguredModelEnabled(input.enabledReversePromptModels, input.textModel)) {
    return "默认文本模型必须在已启用模型中";
  }
  if (input.videoModel && input.enabledVideoModels && !isConfiguredModelEnabled(input.enabledVideoModels, input.videoModel)) {
    return "默认视频模型必须在已启用模型中";
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

  app.get("/api/provider-settings/cliproxy", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const providerSetting = await prisma.providerSetting.findUnique({ where: { userId_provider: { provider, userId: user.id } } });
    return {
      providerSetting: redactProviderSetting(providerSetting) ?? redactCliProxyOnlySetting(user.id),
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
        videoModels: [{ channel: "cliproxy", id: "grok-imagine-video", label: "Grok Imagine Video" }],
        selectedImageModel: "gpt-image-2",
        selectedReversePromptModel: "gpt-5.5",
        selectedVideoModel: "cliproxy:grok-imagine-video",
      };
    }
    const imageFallback = getImageModel(providerSetting);
    const reverseFallback = getTextModel(providerSetting);
    const videoFallback = getVideoModel(providerSetting);
    return {
      imageModels: getEnabledProviderModels(providerSetting.enabledImageModels, providerSetting.imageModel || imageFallback),
      reversePromptModels: getEnabledProviderModels(providerSetting.enabledReversePromptModels, providerSetting.textModel || reverseFallback),
      videoModels: getEnabledProviderModels(providerSetting.enabledVideoModels, videoFallback),
      selectedImageModel: providerSetting.imageModel || imageFallback,
      selectedReversePromptModel: providerSetting.textModel || reverseFallback,
      selectedVideoModel: videoFallback,
    };
  });

  app.get("/api/admin/provider-models/catalog", async (request, reply) => {
    const user = await requireAdminUser(request, reply);
    if (!user) return;
    return {
      imageModels: providerImageModelCatalog,
      reversePromptModels: providerReversePromptModelCatalog,
      videoModels: providerVideoModelCatalog,
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
    const apiKey = parsed.data.apiKey ?? (existing && !isCliProxyOnlyApiKey(existing.apiKey) ? existing.apiKey : undefined);
    if (!apiKey) return jsonError(reply, "API Key is required");
    const cliProxyApiKey = parsed.data.cliProxyApiKey ?? existing?.cliProxyApiKey ?? null;
    const cliProxyManagementKey = parsed.data.cliProxyManagementKey ?? existing?.cliProxyManagementKey ?? null;
    const cliProxyBaseUrl = hasOwnBodyField(request.body, "cliProxyBaseUrl")
      ? parsed.data.cliProxyBaseUrl
      : existing?.cliProxyBaseUrl ?? null;
    const imageModel = parsed.data.imageModel ?? existing?.imageModel ?? "gpt-image-2";
    const textModel = parsed.data.textModel ?? existing?.textModel ?? "gpt-5.5";
    const videoModel = parsed.data.videoModel ?? existing?.videoModel ?? "cliproxy:grok-imagine-video";
    const enabledImageModels = parsed.data.enabledImageModels === undefined
      ? existing?.enabledImageModels ?? serializeConfiguredModels([], imageModel)
      : serializeConfiguredModels(parsed.data.enabledImageModels, imageModel);
    const enabledReversePromptModels = parsed.data.enabledReversePromptModels === undefined
      ? existing?.enabledReversePromptModels ?? serializeConfiguredModels([], textModel)
      : serializeConfiguredModels(parsed.data.enabledReversePromptModels, textModel);
    const enabledVideoModels = parsed.data.enabledVideoModels === undefined
      ? existing?.enabledVideoModels ?? serializeConfiguredModels([], videoModel)
      : serializeConfiguredModels(parsed.data.enabledVideoModels, videoModel);
    const finalModelError = getProviderSettingModelError({
      enabledImageModels,
      enabledReversePromptModels,
      enabledVideoModels,
      imageModel,
      textModel,
      videoModel,
    });
    if (finalModelError) return jsonError(reply, finalModelError, 400);
    const providerSetting = await prisma.providerSetting.upsert({
      where: { userId_provider: { provider, userId: user.id } },
      create: { apiKey, baseUrl: parsed.data.baseUrl, cliProxyApiKey, cliProxyManagementKey, cliProxyBaseUrl, displayName: parsed.data.displayName, enabled: true, enabledImageModels, enabledReversePromptModels, enabledVideoModels, imageModel, provider, textModel, userId: user.id, videoModel },
      update: { apiKey, baseUrl: parsed.data.baseUrl, cliProxyApiKey, cliProxyManagementKey, cliProxyBaseUrl, displayName: parsed.data.displayName, enabled: true, enabledImageModels, enabledReversePromptModels, enabledVideoModels, imageModel, textModel, videoModel },
    });
    await recordProviderSettingHistory(providerSetting);
    const histories = await prisma.providerSettingHistory.findMany({
      orderBy: { updatedAt: "desc" },
      take: 10,
      where: { provider, userId: user.id },
    });
    return { histories: histories.map(redactProviderSettingHistory), providerSetting: redactProviderSetting(providerSetting) };
  });

  app.put("/api/provider-settings/cliproxy", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const parsed = parseBody(cliProxySettingSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const existing = await prisma.providerSetting.findUnique({ where: { userId_provider: { provider, userId: user.id } } });
    const cliProxyApiKey = parsed.data.cliProxyApiKey ?? existing?.cliProxyApiKey ?? null;
    const cliProxyManagementKey = parsed.data.cliProxyManagementKey ?? existing?.cliProxyManagementKey ?? null;
    const cliProxyBaseUrl = hasOwnBodyField(request.body, "cliProxyBaseUrl")
      ? parsed.data.cliProxyBaseUrl
      : existing?.cliProxyBaseUrl ?? null;
    const providerSetting = existing
      ? await prisma.providerSetting.update({
        data: { cliProxyApiKey, cliProxyManagementKey, cliProxyBaseUrl },
        where: { userId_provider: { provider, userId: user.id } },
      })
      : await prisma.providerSetting.create({
        data: {
          ...createCliProxyOnlyProviderSettingData(user.id),
          cliProxyApiKey,
          cliProxyManagementKey,
          cliProxyBaseUrl,
        },
      });
    return { providerSetting: redactProviderSetting(providerSetting) };
  });

  app.post("/api/provider-settings/cliproxy/initialize", async (request, reply) => {
    const user = await requireAdminUser(request, reply);
    if (!user) return;
    const parsed = parseBody(cliProxyInitializeSchema, request.body ?? {});
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const initialization = await ensureCliProxyRuntimeConfig({ rotateApiKey: parsed.data.rotateApiKey });
    const existing = await prisma.providerSetting.findUnique({ where: { userId_provider: { provider, userId: user.id } } });
    const providerSetting = existing
      ? await prisma.providerSetting.update({
        data: {
          cliProxyApiKey: process.env.CLIPROXY_API_KEY ?? null,
          cliProxyManagementKey: getCliProxyManagementKey() || null,
          cliProxyBaseUrl: initialization.baseUrl,
        },
        where: { userId_provider: { provider, userId: user.id } },
      })
      : await prisma.providerSetting.create({
        data: {
          ...createCliProxyOnlyProviderSettingData(user.id),
          cliProxyApiKey: process.env.CLIPROXY_API_KEY ?? null,
          cliProxyManagementKey: getCliProxyManagementKey() || null,
          cliProxyBaseUrl: initialization.baseUrl,
        },
      });
    return {
      initialization,
      providerSetting: redactProviderSetting(providerSetting),
    };
  });

  app.post("/api/provider-settings/cliproxy/oauth/:providerName/start", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const params = cliProxyOAuthParamsSchema.safeParse(request.params);
    if (!params.success) return jsonError(reply, "不支持的 CLIProxyAPI OAuth 登录类型", 400);
    const providerSetting = await getCliProxyDiagnosticsSetting(user.id, user.canUseAdminProvider);
    const oauth = await startCliProxyOAuth(providerSetting, params.data.providerName);
    if ("error" in oauth) return jsonError(reply, oauth.error, oauth.statusCode);
    return oauth;
  });

  app.get("/api/provider-settings/cliproxy/oauth/:providerName/status", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const params = cliProxyOAuthParamsSchema.safeParse(request.params);
    if (!params.success) return jsonError(reply, "不支持的 CLIProxyAPI OAuth 登录类型", 400);
    const query = cliProxyOAuthStatusQuerySchema.safeParse(request.query);
    if (!query.success) return jsonError(reply, "OAuth state 无效或缺失", 400);
    const providerSetting = await getCliProxyDiagnosticsSetting(user.id, user.canUseAdminProvider);
    const oauth = await getCliProxyOAuthStatus(providerSetting, params.data.providerName, query.data.state);
    if ("error" in oauth) return jsonError(reply, oauth.error, oauth.statusCode);
    return oauth;
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
      enabledVideoModels: history.enabledVideoModels,
      imageModel: history.imageModel,
      textModel: history.textModel,
      videoModel: history.videoModel ?? undefined,
    });
    if (modelError) return jsonError(reply, modelError, 400);
    const providerSetting = await prisma.providerSetting.upsert({
      where: { userId_provider: { provider, userId: user.id } },
      create: {
        apiKey: history.apiKey,
        baseUrl: history.baseUrl,
        cliProxyApiKey: history.cliProxyApiKey,
        cliProxyManagementKey: history.cliProxyManagementKey,
        cliProxyBaseUrl: history.cliProxyBaseUrl,
        displayName: history.displayName,
        enabled: true,
        enabledImageModels: history.enabledImageModels,
        enabledReversePromptModels: history.enabledReversePromptModels,
        enabledVideoModels: history.enabledVideoModels,
        imageModel: history.imageModel,
        provider,
        textModel: history.textModel,
        userId: user.id,
        videoModel: history.videoModel,
      },
      update: {
        apiKey: history.apiKey,
        baseUrl: history.baseUrl,
        cliProxyApiKey: history.cliProxyApiKey,
        cliProxyManagementKey: history.cliProxyManagementKey,
        cliProxyBaseUrl: history.cliProxyBaseUrl,
        displayName: history.displayName,
        enabled: true,
        enabledImageModels: history.enabledImageModels,
        enabledReversePromptModels: history.enabledReversePromptModels,
        enabledVideoModels: history.enabledVideoModels,
        imageModel: history.imageModel,
        textModel: history.textModel,
        videoModel: history.videoModel,
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

  app.post("/api/provider-settings/cliproxy/diagnostics", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const providerSetting = await getCliProxyDiagnosticsSetting(user.id, user.canUseAdminProvider);
    const checks = await checkCliProxyDiagnostics(providerSetting);
    const overall = getOverallHealthStatus(checks);
    return {
      checkedAt: new Date().toISOString(),
      checks,
      overall,
      summary: getCliProxyDiagnosticSummary(checks, overall),
    };
  });

  app.put("/api/admin/provider-models", async (request, reply) => {
    const user = await requireAdminUser(request, reply);
    if (!user) return;
    const parsed = parseBody(z.object({
      enabledImageModels: z.array(configuredModelSchema).max(maxConfiguredModels),
      enabledReversePromptModels: z.array(configuredModelSchema).max(maxConfiguredModels),
      enabledVideoModels: z.array(configuredModelSchema).max(maxConfiguredModels).optional(),
      imageModel: z.string().trim().min(1).max(120).optional(),
      textModel: z.string().trim().min(1).max(120).optional(),
      videoModel: z.string().trim().min(1).max(120).optional(),
    }), request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const existing = await prisma.providerSetting.findUnique({ where: { userId_provider: { provider, userId: user.id } } });
    if (!existing) return jsonError(reply, "请先保存 API 设置，再配置前台可选模型", 400);
    const imageModel = parsed.data.imageModel ?? encodeConfiguredModelFallback(parsed.data.enabledImageModels.find((model) => model.enabled)) ?? existing.imageModel;
    const textModel = parsed.data.textModel ?? encodeConfiguredModelFallback(parsed.data.enabledReversePromptModels.find((model) => model.enabled)) ?? existing.textModel;
    const videoModel = parsed.data.videoModel ?? encodeConfiguredModelFallback(parsed.data.enabledVideoModels?.find((model) => model.enabled)) ?? existing.videoModel ?? "cliproxy:grok-imagine-video";
    const modelError = getProviderSettingModelError({
      enabledImageModels: parsed.data.enabledImageModels,
      enabledReversePromptModels: parsed.data.enabledReversePromptModels,
      enabledVideoModels: parsed.data.enabledVideoModels,
      imageModel,
      textModel,
      videoModel,
    });
    if (modelError) return jsonError(reply, modelError, 400);
    const providerSetting = await prisma.providerSetting.update({
      data: {
        enabledImageModels: serializeConfiguredModels(parsed.data.enabledImageModels, imageModel),
        enabledReversePromptModels: serializeConfiguredModels(parsed.data.enabledReversePromptModels, textModel),
        enabledVideoModels: serializeConfiguredModels(parsed.data.enabledVideoModels ?? [], videoModel),
        imageModel,
        textModel,
        videoModel,
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

type ProviderHealthCheckStatus = "ok" | "error" | "not_configured";
type CliProxyDiagnosticCheck = {
  label: string;
  message: string;
  status: ProviderHealthCheckStatus;
  target: string;
};
type CliProxyOAuthProvider = z.infer<typeof cliProxyOAuthProviderSchema>;
type CliProxyOAuthError = { error: string; statusCode: number };
type CliProxyManagementSettingResult =
  | { success: false; error: string; statusCode: number }
  | { success: true; value: { managementBaseUrl: string; managementKey: string } };
type ModelListCheckResult = {
  check: CliProxyDiagnosticCheck;
  modelIds: string[];
};

async function startCliProxyOAuth(
  providerSetting: ProviderSetting,
  providerName: CliProxyOAuthProvider,
): Promise<{ provider: CliProxyOAuthProvider; state: string; status: "wait"; url: string } | CliProxyOAuthError> {
  const cliProxySetting = resolveCliProxyManagementSetting(providerSetting);
  if (!cliProxySetting.success) return { error: cliProxySetting.error, statusCode: cliProxySetting.statusCode };
  const response = await requestCliProxyManagementJson(
    cliProxySetting.value,
    getCliProxyOAuthStartPath(providerName),
  );
  if ("error" in response) return response;
  if (!isRecord(response.payload)) return { error: "CLIProxyAPI OAuth 返回格式无效", statusCode: 502 };
  const url = readStringField(response.payload, ["url", "auth_url", "authorization_url"]);
  const state = readStringField(response.payload, ["state"]);
  if (!url || !state) return { error: "CLIProxyAPI OAuth 未返回授权 URL 或 state", statusCode: 502 };
  return { provider: providerName, state, status: "wait", url };
}

async function getCliProxyOAuthStatus(
  providerSetting: ProviderSetting,
  providerName: CliProxyOAuthProvider,
  state: string,
): Promise<{ errorMessage?: string; provider: CliProxyOAuthProvider; state: string; status: "ok" | "wait" | "error" } | CliProxyOAuthError> {
  const cliProxySetting = resolveCliProxyManagementSetting(providerSetting);
  if (!cliProxySetting.success) return { error: cliProxySetting.error, statusCode: cliProxySetting.statusCode };
  const response = await requestCliProxyManagementJson(
    cliProxySetting.value,
    `get-auth-status?state=${encodeURIComponent(state)}`,
  );
  if ("error" in response) return response;
  if (!isRecord(response.payload)) return { error: "CLIProxyAPI OAuth 状态返回格式无效", statusCode: 502 };
  const rawStatus = readStringField(response.payload, ["status"]).toLowerCase();
  const status = rawStatus === "ok" || rawStatus === "wait" || rawStatus === "error" ? rawStatus : "error";
  const errorMessage = readStringField(response.payload, ["error", "message"]);
  return { errorMessage: errorMessage || undefined, provider: providerName, state, status };
}

function resolveCliProxyManagementSetting(providerSetting: ProviderSetting): CliProxyManagementSettingResult {
  const baseUrl = resolveCliProxyBaseUrl(providerSetting);
  if (!baseUrl) return { error: "CLIProxyAPI 未配置 Base URL", statusCode: 400, success: false };
  const managementBaseUrl = resolveCliProxyManagementBaseUrl(baseUrl);
  const managementKey = resolveCliProxyManagementKey(providerSetting);
  if (!managementKey) {
    return {
      error: "CLIProxyAPI 未配置管理密钥，请填写 MANAGEMENT_PASSWORD 对应的管理密钥。注意它不是 /v1 调用 API Key。",
      statusCode: 400,
      success: false,
    };
  }
  return { success: true, value: { managementBaseUrl, managementKey } };
}

async function requestCliProxyManagementJson(
  setting: { managementBaseUrl: string; managementKey: string },
  requestPath: string,
): Promise<{ payload: unknown } | CliProxyOAuthError> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const url = `${setting.managementBaseUrl}/${requestPath.replace(/^\/+/, "")}`;
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${setting.managementKey}`,
        "X-Management-Key": setting.managementKey,
      },
      signal: controller.signal,
    });
    const payload = await readJsonSafely(response);
    if (!response.ok) {
      const providerMessage = readProviderResponseError(payload, `CLIProxyAPI 管理接口返回 ${response.status}`);
      return { error: `CLIProxyAPI 管理接口 ${response.status}：${providerMessage}`, statusCode: 502 };
    }
    return { payload };
  } catch (error) {
    return {
      error: formatGenerationError(error, {
        model: "management",
        providerBaseUrl: setting.managementBaseUrl,
        providerBaseUrlConfigured: true,
        providerDisplayName: "CLIProxyAPI",
      }),
      statusCode: 502,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getCliProxyOAuthEndpoint(providerName: CliProxyOAuthProvider) {
  switch (providerName) {
    case "gemini-cli":
      return "gemini-cli-auth-url";
    case "codex":
      return "codex-auth-url";
    case "anthropic":
      return "anthropic-auth-url";
    case "antigravity":
      return "antigravity-auth-url";
  }
}

function getCliProxyOAuthStartPath(providerName: CliProxyOAuthProvider) {
  const endpoint = getCliProxyOAuthEndpoint(providerName);
  return providerName === "anthropic" ? endpoint : `${endpoint}?is_webui=true`;
}

function resolveCliProxyManagementBaseUrl(baseUrl: string) {
  const withoutSlash = trimTrailingSlash(baseUrl.trim());
  return `${withoutSlash.replace(/\/v1$/i, "")}/v0/management`;
}

function readStringField(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const item = value[key];
    if (typeof item === "string" && item.trim()) return item.trim();
  }
  return "";
}

async function getCliProxyDiagnosticsSetting(userId: string, canUseAdminProvider: boolean): Promise<ProviderSetting> {
  const ownProviderSetting = await prisma.providerSetting.findUnique({
    where: { userId_provider: { provider, userId } },
  });
  if (ownProviderSetting) return ownProviderSetting;
  if (canUseAdminProvider) {
    const adminProviderSetting = await prisma.providerSetting.findFirst({
      where: { enabled: true, provider, user: { role: "admin", status: "approved" } },
    });
    if (adminProviderSetting) return adminProviderSetting;
  }
  return createCliProxyOnlyProviderSetting(userId);
}

async function checkCliProxyDiagnostics(providerSetting: ProviderSetting): Promise<CliProxyDiagnosticCheck[]> {
  let cliProxySetting: ProviderSetting;
  try {
    cliProxySetting = createCliProxyProviderSetting(providerSetting, getVideoModel(providerSetting));
  } catch (error) {
    return [{
      label: "配置",
      message: error instanceof Error ? error.message : "CLIProxyAPI 配置无效",
      status: "not_configured",
      target: "CLIProxyAPI",
    }];
  }

  const checks: CliProxyDiagnosticCheck[] = [{
    label: "配置",
    message: `${cliProxySetting.baseUrl} 已配置，密钥来源已确认`,
    status: "ok",
    target: cliProxySetting.baseUrl ?? "CLIProxyAPI",
  }];
  const modelList = await checkCliProxyModelsEndpoint(cliProxySetting);
  checks.push(modelList.check);
  checks.push(checkCliProxyConfiguredModel("图片模型", providerSetting.enabledImageModels, providerSetting.imageModel, "cliproxy", modelList.modelIds));
  checks.push(checkCliProxyConfiguredModel("视频模型", providerSetting.enabledVideoModels, getVideoModel(providerSetting), "cliproxy", modelList.modelIds));
  return checks;
}

async function checkCliProxyModelsEndpoint(providerSetting: ProviderSetting): Promise<ModelListCheckResult> {
  try {
    const response = await fetch(`${trimTrailingSlash(providerSetting.baseUrl || "https://api.openai.com/v1")}/models`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${providerSetting.apiKey}`,
      },
    });
    const payload = await readJsonSafely(response);
    if (!response.ok) {
      return {
        check: {
          label: "模型列表",
          message: readProviderResponseError(payload, `模型列表返回 ${response.status}`),
          status: "error",
          target: providerSetting.baseUrl ?? "CLIProxyAPI",
        },
        modelIds: [],
      };
    }
    const modelIds = extractModelIds(payload);
    return {
      check: {
        label: "模型列表",
        message: modelIds.length ? `已读取 ${modelIds.length} 个模型` : "接口可连接，但未返回模型列表",
        status: "ok",
        target: providerSetting.baseUrl ?? "CLIProxyAPI",
      },
      modelIds,
    };
  } catch (error) {
    return {
      check: {
        label: "模型列表",
        message: formatGenerationError(error, {
          model: "models",
          providerBaseUrl: providerSetting.baseUrl,
          providerBaseUrlConfigured: Boolean(providerSetting.baseUrl),
          providerDisplayName: "CLIProxyAPI",
        }),
        status: "error",
        target: providerSetting.baseUrl ?? "CLIProxyAPI",
      },
      modelIds: [],
    };
  }
}

function checkCliProxyConfiguredModel(
  label: "图片模型" | "视频模型",
  rawModels: unknown,
  fallbackModel: string,
  channel: ProviderModelChannel,
  availableModelIds: string[],
): CliProxyDiagnosticCheck {
  const models = normalizeConfiguredModels(rawModels, fallbackModel).filter((model) => model.enabled && (model.channel ?? defaultProviderModelChannel) === channel);
  if (models.length === 0) return { label, message: "未启用 CLIProxyAPI 通道模型", status: "not_configured", target: "CLIProxyAPI" };
  const missingModels = availableModelIds.length ? models.filter((model) => !availableModelIds.includes(model.id)) : [];
  if (missingModels.length > 0) {
    return {
      label,
      message: `模型列表中未发现：${missingModels.map((model) => model.id).join(", ")}`,
      status: "error",
      target: "CLIProxyAPI",
    };
  }
  return {
    label,
    message: `${models.map((model) => model.id).join(", ")} 已启用${availableModelIds.length ? "并存在于模型列表" : ""}`,
    status: "ok",
    target: "CLIProxyAPI",
  };
}

function getCliProxyDiagnosticSummary(checks: CliProxyDiagnosticCheck[], overall: ProviderHealthCheckStatus) {
  if (overall === "ok") return "CLIProxyAPI 配置、模型列表、图片模型和视频模型均可检查";
  if (overall === "not_configured") return "CLIProxyAPI 尚未配置完整";
  const failedCount = checks.filter((check) => check.status === "error").length;
  return `CLIProxyAPI 自检发现 ${failedCount} 个异常`;
}

function getOverallHealthStatus(checks: Array<{ status: ProviderHealthCheckStatus }>): ProviderHealthCheckStatus {
  if (checks.length === 0) return "not_configured";
  if (checks.some((check) => check.status === "error")) return "error";
  if (checks.every((check) => check.status === "not_configured")) return "not_configured";
  return "ok";
}

async function readJsonSafely(response: Response) {
  const text = await response.text().catch(() => "");
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

function extractModelIds(value: unknown): string[] {
  const items = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.data) ? value.data : [];
  return items
    .map((item) => {
      if (typeof item === "string") return item;
      if (!isRecord(item)) return "";
      return typeof item.id === "string" ? item.id : typeof item.name === "string" ? item.name : "";
    })
    .filter((id, index, all): id is string => Boolean(id) && all.indexOf(id) === index);
}

function readProviderResponseError(value: unknown, fallback: string) {
  if (!isRecord(value)) return fallback;
  if (typeof value.error === "string") return value.error;
  if (isRecord(value.error) && typeof value.error.message === "string") return value.error.message;
  if (typeof value.message === "string") return value.message;
  return fallback;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactProviderSetting(setting: ProviderSetting | null) {
  if (!setting) return null;
  const cliProxyEnvironment = getCliProxyEnvironmentStatus();
  const cliProxyBaseUrl = resolveCliProxyBaseUrl(setting) || null;
  const isCliProxyOnly = isCliProxyOnlyApiKey(setting.apiKey);
  return {
    id: setting.id,
    provider: setting.provider,
    displayName: setting.displayName,
    baseUrl: setting.baseUrl,
    cliProxyBaseUrl,
    imageModel: setting.imageModel,
    textModel: setting.textModel,
    videoModel: getVideoModel(setting),
    enabledImageModels: normalizeConfiguredModels(setting.enabledImageModels, setting.imageModel).map(withDefaultChannel),
    enabledReversePromptModels: normalizeConfiguredModels(setting.enabledReversePromptModels, setting.textModel).map(withDefaultChannel),
    enabledVideoModels: normalizeConfiguredModels(setting.enabledVideoModels, getVideoModel(setting)).map(withDefaultChannel),
    enabled: setting.enabled && !isCliProxyOnly,
    hasApiKey: !isCliProxyOnly,
    hasCliProxyApiKey: Boolean(setting.cliProxyApiKey),
    hasCliProxyManagementKey: Boolean(setting.cliProxyManagementKey),
    apiKeyPreview: isCliProxyOnly ? null : redactApiKey(setting.apiKey),
    cliProxyApiKeyPreview: setting.cliProxyApiKey ? redactApiKey(setting.cliProxyApiKey) : null,
    cliProxyManagementKeyPreview: setting.cliProxyManagementKey ? redactApiKey(setting.cliProxyManagementKey) : null,
    cliProxyEnvironmentBaseUrl: cliProxyEnvironment.baseUrl,
    cliProxyEnvironmentHasApiKey: cliProxyEnvironment.hasApiKey,
    cliProxyEnvironmentHasManagementKey: cliProxyEnvironment.hasManagementKey,
    updatedAt: setting.updatedAt,
  };
}

function redactProviderSettingHistory(setting: {
  baseUrl: string | null;
  cliProxyApiKey: string | null;
  cliProxyManagementKey?: string | null;
  cliProxyBaseUrl: string | null;
  displayName: string;
  enabledImageModels: string | null;
  enabledReversePromptModels: string | null;
  enabledVideoModels: string | null;
  id: string;
  imageModel: string;
  apiKey: string;
  provider: string;
  textModel: string;
  videoModel: string | null;
  updatedAt: Date;
}) {
  return {
    id: setting.id,
    provider: setting.provider,
    displayName: setting.displayName,
    baseUrl: setting.baseUrl,
    cliProxyBaseUrl: setting.cliProxyBaseUrl,
    imageModel: setting.imageModel,
    textModel: setting.textModel,
    videoModel: getVideoModel(setting),
    enabledImageModels: normalizeConfiguredModels(setting.enabledImageModels, setting.imageModel).map(withDefaultChannel),
    enabledReversePromptModels: normalizeConfiguredModels(setting.enabledReversePromptModels, setting.textModel).map(withDefaultChannel),
    enabledVideoModels: normalizeConfiguredModels(setting.enabledVideoModels, getVideoModel(setting)).map(withDefaultChannel),
    apiKeyPreview: redactApiKey(setting.apiKey),
    cliProxyApiKeyPreview: setting.cliProxyApiKey ? redactApiKey(setting.cliProxyApiKey) : null,
    cliProxyManagementKeyPreview: setting.cliProxyManagementKey ? redactApiKey(setting.cliProxyManagementKey) : null,
    updatedAt: setting.updatedAt,
  };
}

function redactCliProxyOnlySetting(userId: string) {
  return redactProviderSetting(createCliProxyOnlyProviderSetting(userId));
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
    cliProxyApiKey: setting.cliProxyApiKey,
    cliProxyManagementKey: setting.cliProxyManagementKey,
    cliProxyBaseUrl: setting.cliProxyBaseUrl,
    displayName: setting.displayName,
    enabledImageModels: setting.enabledImageModels,
    enabledReversePromptModels: setting.enabledReversePromptModels,
    enabledVideoModels: setting.enabledVideoModels,
    imageModel: setting.imageModel,
    provider: setting.provider,
    textModel: setting.textModel,
    userId: setting.userId,
    videoModel: setting.videoModel,
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

function createCliProxyOnlyProviderSetting(userId: string): ProviderSetting {
  const now = new Date();
  return {
    ...createCliProxyOnlyProviderSettingData(userId),
    createdAt: now,
    id: "cliproxy-only",
    updatedAt: now,
  };
}

function createCliProxyOnlyProviderSettingData(userId: string) {
  return {
    apiKey: cliProxyOnlyApiKey,
    baseUrl: null,
    cliProxyApiKey: null,
    cliProxyManagementKey: null,
    cliProxyBaseUrl: null,
    displayName: "OpenAI 兼容接口",
    enabled: false,
    enabledImageModels: serializeConfiguredModels([{ channel: "cliproxy", enabled: true, id: "grok-imagine-image", label: "Grok Imagine Image" }], "cliproxy:grok-imagine-image"),
    enabledReversePromptModels: serializeConfiguredModels([], "gpt-5.5"),
    enabledVideoModels: serializeConfiguredModels([{ channel: "cliproxy", enabled: true, id: "grok-imagine-video", label: "Grok Imagine Video" }], "cliproxy:grok-imagine-video"),
    imageModel: "cliproxy:grok-imagine-image",
    provider,
    textModel: "gpt-5.5",
    userId,
    videoModel: "cliproxy:grok-imagine-video",
  };
}

function isCliProxyOnlyApiKey(apiKey: string) {
  return apiKey === cliProxyOnlyApiKey;
}

function getVideoModel(setting: Pick<ProviderSetting, "videoModel"> | { videoModel?: string | null }) {
  return setting.videoModel?.trim() || "cliproxy:grok-imagine-video";
}

function hasOwnBodyField(body: unknown, field: string) {
  return typeof body === "object" && body !== null && Object.prototype.hasOwnProperty.call(body, field);
}

function isValidUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
