import type { FastifyInstance } from "fastify";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { normalizeConfiguredModels } from "@/lib/provider-models";
import { requireAdminUser } from "../auth";
import { jsonError, parseBody } from "../http";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8317;
const DEFAULT_MODEL = "gemini-web";
const provider = "openai-compatible";

const geminiAuthSchema = z.object({
  secure1psid: z.string().trim().max(8192).optional().transform((value) => value || ""),
  secure1psidts: z.string().trim().max(8192).optional().transform((value) => value || ""),
  cookieImport: z.string().trim().max(200_000).optional().transform((value) => value || ""),
});

type SavedGeminiCookie = {
  domain?: string;
  expires?: number;
  name: string;
  path?: string;
  value: string;
};

export async function registerGeminiBridgeRoutes(app: FastifyInstance) {
  app.get("/api/gemini-bridge/status", async (request, reply) => {
    const user = await requireAdminUser(request, reply);
    if (!user) return;

    const savedAuth = await readSavedGeminiAuth();
    const bridgeHost = process.env.GEMINI_BRIDGE_HOST?.trim() || DEFAULT_HOST;
    const bridgePort = parseBridgePort(process.env.GEMINI_BRIDGE_PORT);
    const bridgeBaseUrl = `http://${bridgeHost}:${bridgePort}/v1`;
    const bridgeHealth = await checkBridgeHealth(bridgeHost, bridgePort);
    return {
      bridgeBaseUrl,
      bridgeHealth,
      bridgeHost,
      bridgePort,
      hasApiKey: Boolean(process.env.GEMINI_BRIDGE_API_KEY?.trim()),
      hasFullCookies: savedAuth.cookies.length > 0,
      hasSecure1psid: Boolean(savedAuth.secure1psid || process.env.GEMINI_SECURE_1PSID?.trim() || process.env.__SECURE_1PSID?.trim()),
      hasSecure1psidts: Boolean(savedAuth.secure1psidts || process.env.GEMINI_SECURE_1PSIDTS?.trim() || process.env.__SECURE_1PSIDTS?.trim()),
      imageModel: DEFAULT_MODEL,
      suggestedImageModels: [
        { id: "gemini-web", label: "Gemini Web" },
        { id: "nano-banana", label: "Nano Banana" },
      ],
      suggestedTextModels: [{ id: "gemini-web", label: "Gemini Web" }],
      textModel: DEFAULT_MODEL,
    };
  });

  app.put("/api/gemini-bridge/auth", async (request, reply) => {
    const user = await requireAdminUser(request, reply);
    if (!user) return;

    const parsed = parseBody(geminiAuthSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const cookies = parseCookieImport(parsed.data.cookieImport);
    const secure1psid = parsed.data.secure1psid || findCookieValue(cookies, "__Secure-1PSID");
    const secure1psidts = parsed.data.secure1psidts || findCookieValue(cookies, "__Secure-1PSIDTS");
    if (!secure1psid) return jsonError(reply, "请填写 __Secure-1PSID，或导入包含 __Secure-1PSID 的完整 Cookie", 400);
    await saveGeminiAuth({ cookies, secure1psid, secure1psidts });
    return {
      cookieCount: cookies.length,
      hasFullCookies: cookies.length > 0,
      hasSecure1psid: true,
      hasSecure1psidts: Boolean(secure1psidts),
      saved: true,
    };
  });

  app.post("/api/gemini-bridge/configure-provider", async (request, reply) => {
    const user = await requireAdminUser(request, reply);
    if (!user) return;

    const bridgeApiKey = process.env.GEMINI_BRIDGE_API_KEY?.trim();
    if (!bridgeApiKey) return jsonError(reply, "请先在 .env 设置 GEMINI_BRIDGE_API_KEY", 400);

    const bridgeHost = process.env.GEMINI_BRIDGE_HOST?.trim() || DEFAULT_HOST;
    const bridgePort = parseBridgePort(process.env.GEMINI_BRIDGE_PORT);
    const bridgeBaseUrl = `http://${bridgeHost}:${bridgePort}/v1`;
    const existing = await prisma.providerSetting.findUnique({ where: { userId_provider: { provider, userId: user.id } } });
    const nextImageModels = normalizeConfiguredModels(existing?.enabledImageModels, existing?.imageModel ?? DEFAULT_MODEL);
    const nextTextModels = normalizeConfiguredModels(existing?.enabledReversePromptModels, existing?.textModel ?? DEFAULT_MODEL);
    const imageModels = ensureModels(nextImageModels, [
      { channel: "gemini-bridge", enabled: true, id: "gemini-web", label: "Gemini Web" },
      { channel: "gemini-bridge", enabled: true, id: "nano-banana", label: "Nano Banana" },
    ]);
    const textModels = ensureModels(nextTextModels, [{ channel: "gemini-bridge", enabled: true, id: "gemini-web", label: "Gemini Web" }]);

    const providerSetting = existing
      ? await prisma.providerSetting.update({
        data: {
          apiKey: existing.apiKey,
          baseUrl: existing.baseUrl,
          displayName: existing.displayName,
          enabled: true,
          enabledImageModels: JSON.stringify(imageModels),
          enabledReversePromptModels: JSON.stringify(textModels),
          imageModel: existing.imageModel,
          textModel: existing.textModel,
        },
        where: { userId_provider: { provider, userId: user.id } },
      })
      : await prisma.providerSetting.create({
        data: {
          apiKey: bridgeApiKey,
          baseUrl: bridgeBaseUrl,
          displayName: "Gemini Web Bridge",
          enabled: true,
          enabledImageModels: JSON.stringify(imageModels),
          enabledReversePromptModels: JSON.stringify(textModels),
          imageModel: imageModels.find((model) => model.enabled)?.id ?? DEFAULT_MODEL,
          provider,
          textModel: textModels.find((model) => model.enabled)?.id ?? DEFAULT_MODEL,
          userId: user.id,
        },
      });

    return {
      configured: true,
      providerSetting: {
        baseUrl: providerSetting.baseUrl,
        displayName: providerSetting.displayName,
        imageModel: providerSetting.imageModel,
        textModel: providerSetting.textModel,
      },
    };
  });
}

function parseBridgePort(value: string | undefined) {
  if (!value) return DEFAULT_PORT;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

async function checkBridgeHealth(host: string, port: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetch(`http://${host}:${port}/health`, { signal: controller.signal });
    return response.ok ? "online" : "error";
  } catch {
    return "offline";
  } finally {
    clearTimeout(timeout);
  }
}

function getGeminiAuthPath() {
  return process.env.GEMINI_WEB_AUTH_PATH?.trim() || path.join(process.cwd(), ".codex", "gemini-web-auth.json");
}

async function readSavedGeminiAuth() {
  try {
    const raw = await readFile(getGeminiAuthPath(), "utf8");
    const parsed = JSON.parse(raw) as { "__Secure-1PSID"?: unknown; "__Secure-1PSIDTS"?: unknown; cookies?: unknown; secure1psid?: unknown; secure1psidts?: unknown };
    const secure1psid = parsed["__Secure-1PSID"] ?? parsed.secure1psid;
    const secure1psidts = parsed["__Secure-1PSIDTS"] ?? parsed.secure1psidts;
    return {
      cookies: normalizeSavedCookies(parsed.cookies),
      secure1psid: typeof secure1psid === "string" ? secure1psid.trim() : "",
      secure1psidts: typeof secure1psidts === "string" ? secure1psidts.trim() : "",
    };
  } catch {
    return { cookies: [], secure1psid: "", secure1psidts: "" };
  }
}

async function saveGeminiAuth(input: { cookies: SavedGeminiCookie[]; secure1psid: string; secure1psidts: string }) {
  const authPath = getGeminiAuthPath();
  await mkdir(path.dirname(authPath), { recursive: true });
  await writeFile(
    authPath,
    `${JSON.stringify({
      "__Secure-1PSID": input.secure1psid,
      "__Secure-1PSIDTS": input.secure1psidts,
      cookies: input.cookies,
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

function parseCookieImport(value: string): SavedGeminiCookie[] {
  if (!value.trim()) return [];
  const normalized = normalizeSavedCookies(parseCookieJson(value));
  if (normalized.length > 0) return normalized;
  return parseCookieHeader(value);
}

function parseCookieJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function normalizeSavedCookies(value: unknown): SavedGeminiCookie[] {
  const rawCookies = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.cookies)
      ? value.cookies
      : isRecord(value) && Array.isArray(value.cookieList)
        ? value.cookieList
        : [];

  const cookies: SavedGeminiCookie[] = [];
  for (const item of rawCookies) {
    if (!isRecord(item)) continue;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const cookieValue = typeof item.value === "string" ? item.value : "";
    if (!name || !cookieValue) continue;
    const domain = typeof item.domain === "string" && item.domain.trim() ? item.domain.trim() : ".google.com";
    const cookiePath = typeof item.path === "string" && item.path.trim() ? item.path.trim() : "/";
    const expires = typeof item.expirationDate === "number"
      ? item.expirationDate
      : typeof item.expires === "number"
        ? item.expires
        : undefined;
    cookies.push({
      domain,
      ...(expires ? { expires } : {}),
      name,
      path: cookiePath,
      value: cookieValue,
    });
  }
  return dedupeCookies(cookies);
}

function parseCookieHeader(value: string): SavedGeminiCookie[] {
  const cookieLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.includes("=") && !line.toLowerCase().startsWith("cookie:"))
    ?? value.replace(/^cookie:\s*/i, "");
  const cookies: SavedGeminiCookie[] = cookieLine
    .split(";")
    .map((part) => part.trim())
    .flatMap((part): SavedGeminiCookie[] => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex <= 0) return [];
      const cookie = {
        domain: ".google.com",
        name: part.slice(0, separatorIndex).trim(),
        path: "/",
        value: part.slice(separatorIndex + 1),
      };
      return cookie.name && cookie.value ? [cookie] : [];
    });
  return dedupeCookies(cookies);
}

function dedupeCookies(cookies: SavedGeminiCookie[]) {
  const byKey = new Map<string, SavedGeminiCookie>();
  for (const cookie of cookies) {
    byKey.set(`${cookie.name}|${cookie.domain ?? ""}|${cookie.path ?? ""}`, cookie);
  }
  return [...byKey.values()];
}

function findCookieValue(cookies: SavedGeminiCookie[], name: string) {
  return cookies.find((cookie) => cookie.name === name)?.value.trim() ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function ensureModels<T extends { channel?: string; enabled: boolean; id: string; label: string }>(existingModels: T[], modelsToAdd: T[]) {
  const next = [...existingModels];
  for (const model of modelsToAdd) {
    const index = next.findIndex((existing) => existing.id === model.id);
    if (index === -1) {
      next.push(model);
    } else {
      next[index] = { ...next[index], channel: next[index].channel ?? model.channel, enabled: true, label: next[index].label || model.label };
    }
  }
  return next;
}
