import type { ProviderSetting } from "@/generated/prisma/client";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type ProviderSettingPatch = Pick<ProviderSetting, "apiKey" | "baseUrl" | "displayName"> & {
  cliProxyApiKey?: string | null;
  cliProxyManagementKey?: string | null;
  cliProxyBaseUrl?: string | null;
};

const defaultCliProxyBaseUrl = "http://127.0.0.1:8327/v1";
const defaultCliProxyEnvPath = ".env";
const legacyDefaultCliProxyBaseUrls = new Set(["http://127.0.0.1:8317/v1"]);

export type CliProxyRuntimeConfig = {
  apiKeyPreview: string | null;
  apiKeySyncMessage: string;
  apiKeySyncStatus: "ok" | "skipped" | "warning";
  baseUrl: string;
  generatedApiKey: boolean;
  generatedBaseUrl: boolean;
  hasApiKey: boolean;
};

export function getCliProxyBaseUrl() {
  return process.env.CLIPROXY_BASE_URL?.trim()
    || process.env.CODEX_IMAGE_PROXY_BASE_URL?.trim()
    || process.env.CODEX_TEXT_PROXY_BASE_URL?.trim()
    || "";
}

export function resolveCliProxyBaseUrl(providerSetting?: Pick<ProviderSettingPatch, "cliProxyBaseUrl"> | null) {
  const savedBaseUrl = providerSetting?.cliProxyBaseUrl?.trim();
  if (savedBaseUrl && !isLegacyDefaultCliProxyBaseUrl(savedBaseUrl)) return savedBaseUrl;
  return getCliProxyBaseUrl();
}

export function getCliProxyApiKey(fallback = "cliproxy") {
  return process.env.CLIPROXY_API_KEY?.trim()
    || process.env.CODEX_IMAGE_PROXY_API_KEY?.trim()
    || process.env.CODEX_TEXT_PROXY_API_KEY?.trim()
    || fallback;
}

export function resolveCliProxyApiKey(providerSetting?: Pick<ProviderSettingPatch, "cliProxyApiKey"> | null, fallback = "cliproxy") {
  return providerSetting?.cliProxyApiKey?.trim() || getCliProxyApiKey(fallback);
}

export function getCliProxyManagementKey() {
  return process.env.MANAGEMENT_PASSWORD?.trim() || "";
}

export function resolveCliProxyManagementKey(providerSetting?: Pick<ProviderSettingPatch, "cliProxyManagementKey"> | null) {
  return providerSetting?.cliProxyManagementKey?.trim() || getCliProxyManagementKey();
}

export function getCliProxyEnvironmentStatus() {
  return {
    hasApiKey: Boolean(process.env.CLIPROXY_API_KEY?.trim()
      || process.env.CODEX_IMAGE_PROXY_API_KEY?.trim()
      || process.env.CODEX_TEXT_PROXY_API_KEY?.trim()),
    hasManagementKey: Boolean(getCliProxyManagementKey()),
    baseUrl: getCliProxyBaseUrl() || null,
  };
}

export async function ensureCliProxyRuntimeConfig(input: { rotateApiKey?: boolean } = {}): Promise<CliProxyRuntimeConfig> {
  const envPath = getCliProxyEnvPath();
  const envValues = parseEnvContent(await readFile(envPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  }));
  const existingBaseUrl = process.env.CLIPROXY_BASE_URL?.trim() || envValues.CLIPROXY_BASE_URL?.trim() || "";
  const existingApiKey = process.env.CLIPROXY_API_KEY?.trim() || envValues.CLIPROXY_API_KEY?.trim() || "";
  const generatedBaseUrl = !existingBaseUrl;
  const generatedApiKey = input.rotateApiKey === true || !existingApiKey;
  const baseUrl = existingBaseUrl || defaultCliProxyBaseUrl;
  const apiKey = generatedApiKey ? generateCliProxyApiKey() : existingApiKey;

  process.env.CLIPROXY_BASE_URL = baseUrl;
  process.env.CLIPROXY_API_KEY = apiKey;
  if (!process.env.MANAGEMENT_PASSWORD?.trim() || process.env.MANAGEMENT_PASSWORD === existingApiKey || input.rotateApiKey === true) {
    process.env.MANAGEMENT_PASSWORD = apiKey;
  }

  const nextValues: Record<string, string> = {
    CLIPROXY_API_KEY: apiKey,
    CLIPROXY_BASE_URL: baseUrl,
  };
  if (!envValues.MANAGEMENT_PASSWORD?.trim() || envValues.MANAGEMENT_PASSWORD === existingApiKey || input.rotateApiKey === true) {
    nextValues.MANAGEMENT_PASSWORD = apiKey;
  }
  await writeEnvValues(envPath, nextValues);
  const apiKeySync = await syncCliProxyApiKey({
    apiKey,
    baseUrl,
    managementKey: process.env.MANAGEMENT_PASSWORD?.trim() || apiKey,
  });

  return {
    apiKeyPreview: redactCliProxyApiKey(apiKey),
    apiKeySyncMessage: apiKeySync.message,
    apiKeySyncStatus: apiKeySync.status,
    baseUrl,
    generatedApiKey,
    generatedBaseUrl,
    hasApiKey: Boolean(apiKey),
  };
}

export function createCliProxyProviderSetting<T extends ProviderSettingPatch>(providerSetting: T, model: string): T {
  const baseUrl = resolveCliProxyBaseUrl(providerSetting);
  if (!baseUrl) {
    throw new Error("CLIProxyAPI 未配置 Base URL，无法调用 CLIProxyAPI 模型");
  }
  return {
    ...providerSetting,
    apiKey: resolveCliProxyApiKey(providerSetting),
    baseUrl,
    displayName: "CLIProxyAPI",
    imageModel: model,
    scriptWritingModel: model,
    textModel: model,
    videoModel: model,
  } as T;
}

function generateCliProxyApiKey() {
  return `clp_${randomBytes(24).toString("base64url")}`;
}

function getCliProxyEnvPath() {
  return path.resolve(process.env.CLIPROXY_ENV_PATH?.trim() || defaultCliProxyEnvPath);
}

function redactCliProxyApiKey(apiKey: string) {
  return apiKey.length <= 8 ? "已保存" : `${apiKey.slice(0, 3)}...${apiKey.slice(-4)}`;
}

function isLegacyDefaultCliProxyBaseUrl(baseUrl: string) {
  return legacyDefaultCliProxyBaseUrls.has(baseUrl.replace(/\/+$/, ""));
}

function parseEnvContent(content: string) {
  const values: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    values[match[1]] = parseEnvValue(match[2]);
  }
  return values;
}

function parseEnvValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function writeEnvValues(envPath: string, values: Record<string, string>) {
  const content = await readFile(envPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  });
  const nextContent = Object.entries(values).reduce((current, [key, value]) => {
    const escapedValue = JSON.stringify(value);
    const linePattern = new RegExp(`^${escapeRegExp(key)}=.*$`, "m");
    return linePattern.test(current)
      ? current.replace(linePattern, `${key}=${escapedValue}`)
      : `${current.replace(/\s*$/, "")}${current.trim() ? "\n" : ""}${key}=${escapedValue}\n`;
  }, content);
  const normalizedContent = nextContent.endsWith("\n") ? nextContent : `${nextContent}\n`;
  if (content === normalizedContent) return;
  await writeFile(envPath, normalizedContent, "utf8");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function syncCliProxyApiKey(input: { apiKey: string; baseUrl: string; managementKey: string }): Promise<{ message: string; status: "ok" | "skipped" | "warning" }> {
  const managementBaseUrl = resolveCliProxyManagementBaseUrl(input.baseUrl);
  if (!managementBaseUrl) return { message: "CLIProxyAPI Base URL 无效，已跳过 api-keys 同步", status: "skipped" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const currentResponse = await fetch(`${managementBaseUrl}/api-keys`, {
      headers: getCliProxyManagementHeaders(input.managementKey),
      signal: controller.signal,
    });
    if (!currentResponse.ok) return { message: `CLIProxyAPI api-keys 读取返回 ${currentResponse.status}，请确认服务已启动并使用同一管理密钥`, status: "warning" };
    const currentPayload = await readJsonSafely(currentResponse);
    const apiKeys = extractCliProxyApiKeys(currentPayload);
    if (apiKeys.includes(input.apiKey)) return { message: "CLIProxyAPI api-keys 已包含当前密钥", status: "ok" };
    const nextApiKeys = [...apiKeys, input.apiKey];
    const updateResponse = await fetch(`${managementBaseUrl}/api-keys`, {
      body: JSON.stringify(nextApiKeys),
      headers: {
        ...getCliProxyManagementHeaders(input.managementKey),
        "Content-Type": "application/json",
      },
      method: "PUT",
      signal: controller.signal,
    });
    if (!updateResponse.ok) return { message: `CLIProxyAPI api-keys 写入返回 ${updateResponse.status}，请到 CLIProxyAPI 服务端检查管理密钥`, status: "warning" };
    return { message: "CLIProxyAPI api-keys 已同步当前密钥", status: "ok" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "同步 api-keys 失败";
    return { message: `CLIProxyAPI 服务暂不可连接，已保留本地初始化配置：${message}`, status: "warning" };
  } finally {
    clearTimeout(timeout);
  }
}

function resolveCliProxyManagementBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim();
  if (!trimmed) return "";
  const withoutSlash = trimmed.replace(/\/+$/, "");
  return `${withoutSlash.replace(/\/v1$/i, "")}/v0/management`;
}

function getCliProxyManagementHeaders(apiKey: string) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
    "X-Management-Key": apiKey,
  };
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

function extractCliProxyApiKeys(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  const rawApiKeys = record["api-keys"] ?? record.apiKeys ?? record.keys;
  return Array.isArray(rawApiKeys)
    ? rawApiKeys.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}
