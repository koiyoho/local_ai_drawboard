import type { ProviderSetting } from "@/generated/prisma/client";
import { createOpenAIClient, getTextModel } from "@/lib/openai";
import { getConfiguredModelError, isConfiguredModelEnabled, normalizeConfiguredModels, parseConfiguredModelValue, type ProviderModelChannel } from "@/lib/provider-models";
import { readCodexApiKey } from "./lib/codex-oauth";

const geminiBridgeTextModels = new Set([
  "gemini-web",
  "gemini-web-3.1-flash-lite",
  "gemini-web-3.5-flash",
  "gemini-web-3.1-pro-standard",
  "gemini-web-3.1-pro-extended",
]);
const geminiBridgeDisplayName = "Gemini Web Bridge";

export function resolveTextModelChannel(
  providerSetting: Pick<ProviderSetting, "enabledReversePromptModels" | "textModel">,
  model: string,
): ProviderModelChannel {
  const defaultModel = parseConfiguredModelValue(providerSetting.textModel);
  if (defaultModel.channel && defaultModel.id === model) return defaultModel.channel;
  return resolveRequestedTextModelChannel(providerSetting, model);
}

export function resolveRequestedTextModelChannel(
  providerSetting: Pick<ProviderSetting, "enabledReversePromptModels" | "textModel">,
  model: string,
): ProviderModelChannel {
  const configuredModels = normalizeConfiguredModels(providerSetting.enabledReversePromptModels, "");
  const configuredModel = configuredModels.find((item) => item.enabled && item.id === model && (item.channel ?? "provider") === "provider") ??
    configuredModels.find((item) => item.enabled && item.id === model);
  if (configuredModel?.channel) return configuredModel.channel;
  const defaultModel = parseConfiguredModelValue(providerSetting.textModel);
  if (defaultModel.channel && defaultModel.id === model) return defaultModel.channel;
  return geminiBridgeTextModels.has(model) ? "gemini-bridge" : "provider";
}

export async function getTextGenerationProviderSetting<T extends ProviderSetting | Pick<ProviderSetting, "apiKey" | "baseUrl" | "displayName" | "enabledReversePromptModels" | "textModel">>(
  providerSetting: T,
  model: string,
  modelChannel: ProviderModelChannel,
): Promise<T> {
  if (modelChannel === "provider") return { ...providerSetting, textModel: model };
  if (modelChannel === "codex") {
    const proxyBaseUrl = process.env.CODEX_TEXT_PROXY_BASE_URL?.trim();
    const proxyApiKey = process.env.CODEX_TEXT_PROXY_API_KEY?.trim() || "codex-text-proxy";
    if (proxyBaseUrl) {
      return {
        ...providerSetting,
        apiKey: proxyApiKey,
        baseUrl: proxyBaseUrl,
        displayName: "官方 Codex 文本代理",
        textModel: model,
      };
    }
    const apiKey = await readCodexApiKey();
    if (!apiKey) {
      throw new Error("官方 Codex 已登录的是账号 OAuth token，不是 OpenAI 兼容 API key。请配置 CODEX_TEXT_PROXY_BASE_URL 指向 OpenAI 兼容文本/视觉代理，或把该文本模型通道改为第三方 API/Gemini Bridge");
    }
    return {
      ...providerSetting,
      apiKey,
      baseUrl: null,
      displayName: "官方 Codex",
      textModel: model,
    };
  }
  const bridgeApiKey = process.env.GEMINI_BRIDGE_API_KEY?.trim();
  if (!bridgeApiKey) {
    throw new Error("Gemini Bridge 未配置 GEMINI_BRIDGE_API_KEY，无法调用 Gemini Web 文本模型");
  }
  const bridgeHost = process.env.GEMINI_BRIDGE_HOST?.trim() || "127.0.0.1";
  const bridgePort = parseBridgePort(process.env.GEMINI_BRIDGE_PORT);
  return {
    ...providerSetting,
    apiKey: bridgeApiKey,
    baseUrl: `http://${bridgeHost}:${bridgePort}/v1`,
    displayName: geminiBridgeDisplayName,
    textModel: model,
  };
}

export async function callOpenAICompatibleTextModel(
  providerSetting: ProviderSetting,
  instruction: string,
  maxTokens: number,
  temperature: number,
) {
  const textModelValue = providerSetting.textModel || getTextModel(providerSetting);
  const modelError = getConfiguredModelError(textModelValue, "默认文本模型");
  if (modelError) throw new Error(modelError);
  if (!isConfiguredModelEnabled(providerSetting.enabledReversePromptModels, textModelValue)) {
    throw new Error("默认文本模型未启用");
  }
  const parsedTextModel = parseConfiguredModelValue(textModelValue);
  const model = parsedTextModel.id;
  const modelChannel = parsedTextModel.channel ?? resolveTextModelChannel(providerSetting, model);
  const textProviderSetting = await getTextGenerationProviderSetting(providerSetting, model, modelChannel);
  const openai = createOpenAIClient(textProviderSetting);

  try {
    const response = await openai.responses.create({
      input: [{ content: [{ text: instruction, type: "input_text" }], role: "user" }],
      max_output_tokens: maxTokens,
      model,
      temperature,
    });
    return response.output_text?.trim() ?? "";
  } catch (responseError) {
    if (!shouldFallbackToChatCompletions(responseError)) {
      throw responseError;
    }
    const response = await openai.chat.completions.create({
      max_tokens: maxTokens,
      messages: [{ content: instruction, role: "user" }],
      model,
      temperature,
    });
    const content = response.choices[0]?.message.content;
    return typeof content === "string" ? content.trim() : "";
  }
}

export function shouldFallbackToChatCompletions(error: unknown) {
  const status = getErrorNumber(error, "status") ?? getErrorNumber(error, "statusCode");
  if (status !== 404 && status !== 405) return false;

  const code = getErrorString(error, "code").toLowerCase();
  if (
    code.includes("model_not_found") ||
    code.includes("resource_not_found") ||
    code.includes("unsupported_model") ||
    code.includes("unsupported_parameter")
  ) {
    return false;
  }
  if (
    code.includes("method_not_allowed") ||
    code.includes("endpoint_not_found") ||
    code.includes("route_not_found") ||
    code.includes("url_not_found") ||
    code.includes("not_implemented")
  ) {
    return true;
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (
    message.includes("model not found") ||
    message.includes("resource not found") ||
    message.includes("unsupported model") ||
    message.includes("unsupported parameter")
  ) {
    return false;
  }

  return [
    "method not allowed",
    "endpoint not found",
    "route not found",
    "unknown endpoint",
    "unknown url",
    "invalid url",
    "not implemented",
    "/responses",
    "/v1/responses",
    "responses endpoint",
  ].some((fallbackMessage) => message.includes(fallbackMessage));
}

function parseBridgePort(value: string | undefined) {
  if (!value) return 8317;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8317;
}

function getErrorNumber(error: unknown, key: string) {
  if (!isRecord(error)) return undefined;
  const value = error[key];
  return typeof value === "number" ? value : undefined;
}

function getErrorString(error: unknown, key: string) {
  if (!isRecord(error)) return "";
  const value = error[key];
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
