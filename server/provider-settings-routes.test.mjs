import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before, beforeEach } from "node:test";
import { promisify } from "node:util";

const appModuleUrl = new URL("../dist/server/server/app.js", import.meta.url);
const prismaModuleUrl = new URL("../dist/server/src/lib/prisma.js", import.meta.url);
const authModuleUrl = new URL("../dist/server/server/auth.js", import.meta.url);
const execFileAsync = promisify(execFile);

let tempDir;
let previousDatabaseUrl;
let previousAuthSecret;
let prisma;

before(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "provider-settings-routes-test-"));
  previousDatabaseUrl = process.env.DATABASE_URL;
  previousAuthSecret = process.env.AUTH_SECRET;
  process.env.DATABASE_URL = `file:${path.join(tempDir, "test.db")}`;
  process.env.AUTH_SECRET = "provider-settings-route-test-secret";
  await execFileAsync(process.execPath, ["scripts/init-db.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env },
  });
  ({ prisma } = await import(prismaModuleUrl));
});

beforeEach(async () => {
  await prisma.providerSettingHistory.deleteMany();
  await prisma.providerSetting.deleteMany();
  await prisma.user.deleteMany({ where: { id: { not: "local-user" } } });
});

after(async () => {
  if (prisma) await prisma.$disconnect();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  if (previousAuthSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = previousAuthSecret;
  if (tempDir) await rm(tempDir, { force: true, recursive: true });
});

async function createTestApp() {
  const { createApp } = await import(appModuleUrl);
  return createApp();
}

async function createUser(input = {}) {
  const username = input.username ?? `provider-user-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return prisma.user.create({
    data: {
      canUseAdminProvider: input.canUseAdminProvider ?? false,
      generationFiveHourLimit: null,
      generationLimit: null,
      name: username,
      role: input.role ?? "user",
      status: "approved",
      username,
    },
  });
}

async function sessionCookieFor(userId) {
  const { signSession } = await import(authModuleUrl);
  const now = Date.now();
  return `ai_board_session=${signSession({
    expiresAt: now + 60_000,
    issuedAt: now,
    userId,
  })}`;
}

test("provider settings save history and can be reapplied without exposing api keys", async () => {
  const app = await createTestApp();
  try {
    const user = await createUser();
    const cookie = await sessionCookieFor(user.id);

    const firstSave = await app.inject({
      body: {
        apiKey: "sk-first-secret",
        baseUrl: "https://api.first.example/v1",
        cliProxyApiKey: "cliproxy-first-secret",
        cliProxyBaseUrl: "https://cliproxy.first.example/v1",
        cliProxyManagementKey: "cliproxy-management-first-secret",
        displayName: "First API",
        enabledImageModels: [{ enabled: true, id: "gpt-image-2", label: "GPT Image" }],
        enabledReversePromptModels: [{ enabled: true, id: "gpt-5.5", label: "GPT 5.5" }],
        enabledVideoModels: [{ channel: "cliproxy", enabled: true, id: "grok-imagine-video", label: "Grok Video" }],
        imageModel: "gpt-image-2",
        textModel: "gpt-5.5",
        videoModel: "cliproxy:grok-imagine-video",
      },
      headers: { cookie },
      method: "PUT",
      url: "/api/provider-settings",
    });
    assert.equal(firstSave.statusCode, 200);
    const firstHistory = JSON.parse(firstSave.body).histories[0];
    assert.equal(firstHistory.displayName, "First API");
    assert.equal(JSON.stringify(firstHistory).includes("sk-first-secret"), false);
    assert.equal(JSON.stringify(firstHistory).includes("cliproxy-first-secret"), false);

    const secondSave = await app.inject({
      body: {
        apiKey: "sk-second-secret",
        baseUrl: "https://api.second.example/v1",
        displayName: "Second API",
        enabledImageModels: [{ enabled: true, id: "imagen-4", label: "Imagen 4" }],
        enabledReversePromptModels: [{ enabled: true, id: "gemini-web", label: "Gemini Web" }],
        imageModel: "imagen-4",
        textModel: "gemini-web",
      },
      headers: { cookie },
      method: "PUT",
      url: "/api/provider-settings",
    });
    assert.equal(secondSave.statusCode, 200);

    const applyResponse = await app.inject({
      body: { historyId: firstHistory.id },
      headers: { cookie },
      method: "POST",
      url: "/api/provider-settings/history/apply",
    });
    assert.equal(applyResponse.statusCode, 200);
    const applied = JSON.parse(applyResponse.body).providerSetting;
    assert.equal(applied.displayName, "First API");
    assert.equal(applied.imageModel, "gpt-image-2");
    assert.equal(applied.cliProxyBaseUrl, "https://cliproxy.first.example/v1");
    assert.equal(applied.videoModel, "cliproxy:grok-imagine-video");
    assert.equal(JSON.stringify(applied).includes("sk-first-secret"), false);
    assert.equal(JSON.stringify(applied).includes("cliproxy-first-secret"), false);

    const stored = await prisma.providerSetting.findUnique({ where: { userId_provider: { provider: "openai-compatible", userId: user.id } } });
    assert.equal(stored.apiKey, "sk-first-secret");
    assert.equal(stored.cliProxyApiKey, "cliproxy-first-secret");
    assert.equal(stored.cliProxyManagementKey, "cliproxy-management-first-secret");
  } finally {
    await app.close();
  }
});

test("admin can publish enabled model options for frontend selection", async () => {
  const app = await createTestApp();
  try {
    const admin = await createUser({ role: "admin", username: "admin" });
    const cookie = await sessionCookieFor(admin.id);

    await app.inject({
      body: {
        apiKey: "sk-admin-secret",
        baseUrl: "https://api.admin.example/v1",
        displayName: "Admin API",
        imageModel: "gpt-image-2",
        textModel: "gpt-5.5",
      },
      headers: { cookie },
      method: "PUT",
      url: "/api/provider-settings",
    });

    const modelsResponse = await app.inject({
      body: {
        enabledImageModels: [
          { enabled: false, id: "gpt-image-2", label: "GPT Image" },
          { enabled: true, id: "flux-kontext-pro", label: "Flux Kontext" },
        ],
        enabledReversePromptModels: [
          { enabled: true, id: "gpt-5.5", label: "GPT 5.5" },
          { enabled: false, id: "cheap-text", label: "Hidden Text" },
        ],
        enabledVideoModels: [
          { channel: "cliproxy", enabled: true, id: "grok-imagine-video", label: "Grok Video" },
        ],
        videoModel: "cliproxy:grok-imagine-video",
      },
      headers: { cookie },
      method: "PUT",
      url: "/api/admin/provider-models",
    });
    assert.equal(modelsResponse.statusCode, 200);

    const optionsResponse = await app.inject({
      headers: { cookie },
      method: "GET",
      url: "/api/provider-settings/model-options",
    });
    assert.equal(optionsResponse.statusCode, 200);
    const options = JSON.parse(optionsResponse.body);
    assert.deepEqual(options.imageModels, [{ channel: "provider", id: "flux-kontext-pro", label: "Flux Kontext" }]);
    assert.deepEqual(options.reversePromptModels, [{ channel: "provider", id: "gpt-5.5", label: "GPT 5.5" }]);
    assert.deepEqual(options.videoModels, [{ channel: "cliproxy", id: "grok-imagine-video", label: "Grok Video" }]);
    assert.equal(options.selectedImageModel, "provider:flux-kontext-pro");
    assert.equal(options.selectedVideoModel, "cliproxy:grok-imagine-video");
  } finally {
    await app.close();
  }
});

test("admin can fetch provider model catalog for local model pool editing", async () => {
  const app = await createTestApp();
  try {
    const anonymousResponse = await app.inject({
      method: "GET",
      url: "/api/admin/provider-models/catalog",
    });
    assert.equal(anonymousResponse.statusCode, 401);

    const user = await createUser();
    const userCookie = await sessionCookieFor(user.id);
    const userResponse = await app.inject({
      headers: { cookie: userCookie },
      method: "GET",
      url: "/api/admin/provider-models/catalog",
    });
    assert.equal(userResponse.statusCode, 403);

    const admin = await createUser({ role: "admin", username: "admin" });
    const adminCookie = await sessionCookieFor(admin.id);
    const response = await app.inject({
      headers: { cookie: adminCookie },
      method: "GET",
      url: "/api/admin/provider-models/catalog",
    });
    assert.equal(response.statusCode, 200);
    const catalog = JSON.parse(response.body);
    assert.ok(catalog.imageModels.provider.some((model) => model.id === "gpt-image-2"));
    assert.ok(catalog.imageModels.cliproxy.some((model) => model.id === "grok-imagine-image"));
    assert.ok(catalog.imageModels["gemini-bridge"].some((model) => model.id === "nano-banana"));
    assert.ok(catalog.reversePromptModels.codex.some((model) => model.id === "gpt-5.5"));
    assert.ok(catalog.videoModels.cliproxy.some((model) => model.id === "grok-imagine-video"));
  } finally {
    await app.close();
  }
});

test("provider settings reject channel-qualified defaults with an empty model id", async () => {
  const app = await createTestApp();
  try {
    const admin = await createUser({ role: "admin", username: "admin" });
    const cookie = await sessionCookieFor(admin.id);

    const saveResponse = await app.inject({
      body: {
        apiKey: "sk-admin-secret",
        baseUrl: "https://api.admin.example/v1",
        displayName: "Admin API",
        imageModel: "codex:",
        textModel: "provider:",
      },
      headers: { cookie },
      method: "PUT",
      url: "/api/provider-settings",
    });

    assert.equal(saveResponse.statusCode, 400);
    assert.match(JSON.parse(saveResponse.body).error, /模型 ID/);
  } finally {
    await app.close();
  }
});

test("frontend model options include channels when duplicate model ids are configured", async () => {
  const app = await createTestApp();
  try {
    const admin = await createUser({ role: "admin", username: "admin" });
    const cookie = await sessionCookieFor(admin.id);

    await app.inject({
      body: {
        apiKey: "sk-admin-secret",
        baseUrl: "https://api.admin.example/v1",
        displayName: "Admin API",
        enabledImageModels: [
          { channel: "provider", enabled: true, id: "gpt-image-2", label: "GPT Image 2 · Provider" },
          { channel: "codex", enabled: true, id: "gpt-image-2", label: "GPT Image 2" },
          { channel: "gemini-bridge", enabled: true, id: "nano-banana", label: "Nano Banana" },
        ],
        enabledReversePromptModels: [{ channel: "provider", enabled: true, id: "gpt-5.5", label: "GPT 5.5" }],
        imageModel: "gpt-image-2",
        textModel: "gpt-5.5",
      },
      headers: { cookie },
      method: "PUT",
      url: "/api/provider-settings",
    });

    const optionsResponse = await app.inject({
      headers: { cookie },
      method: "GET",
      url: "/api/provider-settings/model-options",
    });
    assert.equal(optionsResponse.statusCode, 200);
    const options = JSON.parse(optionsResponse.body);
    assert.deepEqual(options.imageModels, [
      { channel: "provider", id: "gpt-image-2", label: "GPT Image 2 · Provider" },
      { channel: "codex", id: "gpt-image-2", label: "GPT Image 2" },
      { channel: "gemini-bridge", id: "nano-banana", label: "Nano Banana" },
    ]);
  } finally {
    await app.close();
  }
});

test("admin model settings reject disabled default models", async () => {
  const app = await createTestApp();
  try {
    const admin = await createUser({ role: "admin", username: "admin" });
    const cookie = await sessionCookieFor(admin.id);

    await app.inject({
      body: {
        apiKey: "sk-admin-secret",
        baseUrl: "https://api.admin.example/v1",
        displayName: "Admin API",
        imageModel: "gpt-image-2",
        textModel: "gpt-5.5",
      },
      headers: { cookie },
      method: "PUT",
      url: "/api/provider-settings",
    });

    const saveResponse = await app.inject({
      body: {
        enabledImageModels: [
          { channel: "provider", enabled: false, id: "gpt-image-2", label: "GPT Image 2 · Provider" },
          { channel: "codex", enabled: true, id: "gpt-image-2", label: "GPT Image 2 · Codex" },
        ],
        enabledReversePromptModels: [
          { channel: "provider", enabled: false, id: "gpt-5.5", label: "GPT 5.5 · Provider" },
          { channel: "codex", enabled: true, id: "gpt-5.5", label: "GPT 5.5 · Codex" },
        ],
        imageModel: "provider:gpt-image-2",
        textModel: "provider:gpt-5.5",
      },
      headers: { cookie },
      method: "PUT",
      url: "/api/admin/provider-models",
    });

    assert.equal(saveResponse.statusCode, 400);
    assert.match(JSON.parse(saveResponse.body).error, /默认图像模型/);
  } finally {
    await app.close();
  }
});

test("provider settings reject defaults disabled by the existing model pool", async () => {
  const app = await createTestApp();
  try {
    const admin = await createUser({ role: "admin", username: "admin" });
    const cookie = await sessionCookieFor(admin.id);

    await app.inject({
      body: {
        apiKey: "sk-admin-secret",
        baseUrl: "https://api.admin.example/v1",
        displayName: "Admin API",
        imageModel: "gpt-image-2",
        textModel: "gpt-5.5",
      },
      headers: { cookie },
      method: "PUT",
      url: "/api/provider-settings",
    });

    const modelPoolResponse = await app.inject({
      body: {
        enabledImageModels: [
          { channel: "provider", enabled: false, id: "gpt-image-2", label: "GPT Image 2 · Provider" },
          { channel: "codex", enabled: true, id: "gpt-image-2", label: "GPT Image 2 · Codex" },
        ],
        enabledReversePromptModels: [
          { channel: "provider", enabled: false, id: "gpt-5.5", label: "GPT 5.5 · Provider" },
          { channel: "codex", enabled: true, id: "gpt-5.5", label: "GPT 5.5 · Codex" },
        ],
        imageModel: "codex:gpt-image-2",
        textModel: "codex:gpt-5.5",
      },
      headers: { cookie },
      method: "PUT",
      url: "/api/admin/provider-models",
    });
    assert.equal(modelPoolResponse.statusCode, 200);

    const saveResponse = await app.inject({
      body: {
        apiKey: "sk-admin-secret-2",
        baseUrl: "https://api.admin2.example/v1",
        displayName: "Admin API Updated",
        imageModel: "provider:gpt-image-2",
        textModel: "provider:gpt-5.5",
      },
      headers: { cookie },
      method: "PUT",
      url: "/api/provider-settings",
    });

    assert.equal(saveResponse.statusCode, 400);
    assert.match(JSON.parse(saveResponse.body).error, /默认图像模型/);
  } finally {
    await app.close();
  }
});

test("admin can save a channel-qualified default model without losing duplicate id routing", async () => {
  const app = await createTestApp();
  try {
    const admin = await createUser({ role: "admin", username: "admin" });
    const cookie = await sessionCookieFor(admin.id);

    await app.inject({
      body: {
        apiKey: "sk-admin-secret",
        baseUrl: "https://api.admin.example/v1",
        displayName: "Admin API",
        imageModel: "gpt-image-2",
        textModel: "gpt-5.5",
      },
      headers: { cookie },
      method: "PUT",
      url: "/api/provider-settings",
    });

    const saveResponse = await app.inject({
      body: {
        enabledImageModels: [
          { channel: "provider", enabled: true, id: "gpt-image-2", label: "GPT Image 2 · Provider" },
          { channel: "codex", enabled: true, id: "gpt-image-2", label: "GPT Image 2 · Codex" },
        ],
        enabledReversePromptModels: [
          { channel: "provider", enabled: true, id: "gpt-5.5", label: "GPT 5.5 · Provider" },
          { channel: "codex", enabled: true, id: "gpt-5.5", label: "GPT 5.5 · Codex" },
        ],
        imageModel: "codex:gpt-image-2",
        textModel: "codex:gpt-5.5",
      },
      headers: { cookie },
      method: "PUT",
      url: "/api/admin/provider-models",
    });
    assert.equal(saveResponse.statusCode, 200);
    const saved = JSON.parse(saveResponse.body).providerSetting;
    assert.equal(saved.imageModel, "codex:gpt-image-2");
    assert.equal(saved.textModel, "codex:gpt-5.5");

    const optionsResponse = await app.inject({
      headers: { cookie },
      method: "GET",
      url: "/api/provider-settings/model-options",
    });
    assert.equal(optionsResponse.statusCode, 200);
    const options = JSON.parse(optionsResponse.body);
    assert.equal(options.selectedImageModel, "codex:gpt-image-2");
    assert.equal(options.selectedReversePromptModel, "codex:gpt-5.5");
    assert.deepEqual(options.imageModels, [
      { channel: "provider", id: "gpt-image-2", label: "GPT Image 2 · Provider" },
      { channel: "codex", id: "gpt-image-2", label: "GPT Image 2 · Codex" },
    ]);
  } finally {
    await app.close();
  }
});

test("admin can save an explicit provider default model without losing its channel", async () => {
  const app = await createTestApp();
  try {
    const admin = await createUser({ role: "admin", username: "admin" });
    const cookie = await sessionCookieFor(admin.id);

    await app.inject({
      body: {
        apiKey: "sk-admin-secret",
        baseUrl: "https://api.admin.example/v1",
        displayName: "Admin API",
        imageModel: "gpt-image-2",
        textModel: "gpt-5.5",
      },
      headers: { cookie },
      method: "PUT",
      url: "/api/provider-settings",
    });

    const saveResponse = await app.inject({
      body: {
        enabledImageModels: [
          { channel: "codex", enabled: true, id: "gpt-image-2", label: "GPT Image 2 · Codex" },
          { channel: "provider", enabled: true, id: "gpt-image-2", label: "GPT Image 2 · Provider" },
        ],
        enabledReversePromptModels: [
          { channel: "codex", enabled: true, id: "gpt-5.5", label: "GPT 5.5 · Codex" },
          { channel: "provider", enabled: true, id: "gpt-5.5", label: "GPT 5.5 · Provider" },
        ],
        imageModel: "provider:gpt-image-2",
        textModel: "provider:gpt-5.5",
      },
      headers: { cookie },
      method: "PUT",
      url: "/api/admin/provider-models",
    });
    assert.equal(saveResponse.statusCode, 200);
    const saved = JSON.parse(saveResponse.body).providerSetting;
    assert.equal(saved.imageModel, "provider:gpt-image-2");
    assert.equal(saved.textModel, "provider:gpt-5.5");

    const optionsResponse = await app.inject({
      headers: { cookie },
      method: "GET",
      url: "/api/provider-settings/model-options",
    });
    assert.equal(optionsResponse.statusCode, 200);
    const options = JSON.parse(optionsResponse.body);
    assert.equal(options.selectedImageModel, "provider:gpt-image-2");
    assert.equal(options.selectedReversePromptModel, "provider:gpt-5.5");
  } finally {
    await app.close();
  }
});

test("saving api settings keeps admin model pool and backend channels unchanged", async () => {
  const app = await createTestApp();
  try {
    const admin = await createUser({ role: "admin", username: "admin" });
    const cookie = await sessionCookieFor(admin.id);

    await app.inject({
      body: {
        apiKey: "sk-admin-secret",
        baseUrl: "https://api.admin.example/v1",
        displayName: "Admin API",
        imageModel: "gpt-image-2",
        textModel: "gpt-5.5",
      },
      headers: { cookie },
      method: "PUT",
      url: "/api/provider-settings",
    });

    await app.inject({
      body: {
        enabledImageModels: [
          { channel: "codex", enabled: true, id: "gpt-image-2", label: "GPT Image 2" },
          { channel: "gemini-bridge", enabled: true, id: "nano-banana", label: "Nano Banana" },
        ],
        enabledReversePromptModels: [
          { channel: "gemini-bridge", enabled: true, id: "gemini-web", label: "Gemini Web" },
        ],
        imageModel: "nano-banana",
        textModel: "gemini-web",
      },
      headers: { cookie },
      method: "PUT",
      url: "/api/admin/provider-models",
    });

    const apiOnlySave = await app.inject({
      body: {
        apiKey: "sk-admin-secret-2",
        baseUrl: "https://api.admin2.example/v1",
        displayName: "Admin API Updated",
      },
      headers: { cookie },
      method: "PUT",
      url: "/api/provider-settings",
    });
    assert.equal(apiOnlySave.statusCode, 200);
    const providerSetting = JSON.parse(apiOnlySave.body).providerSetting;
    assert.equal(providerSetting.imageModel, "nano-banana");
    assert.equal(providerSetting.textModel, "gemini-web");
    assert.deepEqual(providerSetting.enabledImageModels, [
      { channel: "codex", enabled: true, id: "gpt-image-2", label: "GPT Image 2" },
      { channel: "gemini-bridge", enabled: true, id: "nano-banana", label: "Nano Banana" },
    ]);
  } finally {
    await app.close();
  }
});

test("CLIProxyAPI settings can be saved without a third-party API key and keep management key private", async () => {
  const app = await createTestApp();
  try {
    const user = await createUser();
    const cookie = await sessionCookieFor(user.id);

    const saveResponse = await app.inject({
      body: {
        cliProxyApiKey: "cliproxy-only-secret",
        cliProxyBaseUrl: "https://cliproxy-only.example/v1",
        cliProxyManagementKey: "cliproxy-only-management-secret",
      },
      headers: { cookie },
      method: "PUT",
      url: "/api/provider-settings/cliproxy",
    });

    assert.equal(saveResponse.statusCode, 200);
    const payload = JSON.parse(saveResponse.body);
    assert.equal(payload.providerSetting.enabled, false);
    assert.equal(payload.providerSetting.hasApiKey, false);
    assert.equal(payload.providerSetting.apiKeyPreview, null);
    assert.equal(payload.providerSetting.cliProxyBaseUrl, "https://cliproxy-only.example/v1");
    assert.equal(payload.providerSetting.hasCliProxyApiKey, true);
    assert.equal(payload.providerSetting.hasCliProxyManagementKey, true);
    assert.equal(JSON.stringify(payload).includes("cliproxy-only-secret"), false);
    assert.equal(JSON.stringify(payload).includes("cliproxy-only-management-secret"), false);

    const stored = await prisma.providerSetting.findUnique({ where: { userId_provider: { provider: "openai-compatible", userId: user.id } } });
    assert.equal(stored.cliProxyApiKey, "cliproxy-only-secret");
    assert.equal(stored.cliProxyManagementKey, "cliproxy-only-management-secret");
  } finally {
    await app.close();
  }
});

test("CLIProxyAPI OAuth start proxies official Claude management auth URL and rejects xAI management OAuth", async () => {
  const app = await createTestApp();
  const originalFetch = globalThis.fetch;
  try {
    const user = await createUser();
    const cookie = await sessionCookieFor(user.id);
    await app.inject({
      body: {
        cliProxyApiKey: "cliproxy-oauth-secret",
        cliProxyBaseUrl: "https://cliproxy-oauth.example/v1",
        cliProxyManagementKey: "cliproxy-management-secret",
      },
      headers: { cookie },
      method: "PUT",
      url: "/api/provider-settings/cliproxy",
    });

    const requested = [];
    globalThis.fetch = async (url, init = {}) => {
      requested.push({
        authorization: init.headers?.Authorization,
        managementKey: init.headers?.["X-Management-Key"],
        url: String(url),
      });
      return Response.json({ state: "state-123", url: "https://accounts.example/oauth" });
    };

    const xaiResponse = await app.inject({
      headers: { cookie },
      method: "POST",
      url: "/api/provider-settings/cliproxy/oauth/xai/start",
    });
    assert.equal(xaiResponse.statusCode, 400);
    assert.match(JSON.parse(xaiResponse.body).error, /不支持/);
    assert.equal(requested.length, 0);

    const claudeResponse = await app.inject({
      headers: { cookie },
      method: "POST",
      url: "/api/provider-settings/cliproxy/oauth/anthropic/start",
    });
    assert.equal(claudeResponse.statusCode, 200);
    assert.equal(JSON.parse(claudeResponse.body).url, "https://accounts.example/oauth");

    assert.deepEqual(requested.map((request) => request.url), [
      "https://cliproxy-oauth.example/v0/management/anthropic-auth-url",
    ]);
    assert.equal(requested[0].authorization, "Bearer cliproxy-management-secret");
    assert.equal(requested[0].managementKey, "cliproxy-management-secret");
    assert.equal(JSON.stringify(claudeResponse.json()).includes("cliproxy-management-secret"), false);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("CLIProxyAPI OAuth status polls management state and requires management key", async () => {
  const app = await createTestApp();
  const originalFetch = globalThis.fetch;
  const previousManagementPassword = process.env.MANAGEMENT_PASSWORD;
  try {
    delete process.env.MANAGEMENT_PASSWORD;
    const user = await createUser();
    const cookie = await sessionCookieFor(user.id);
    await app.inject({
      body: {
        cliProxyApiKey: "cliproxy-status-secret",
        cliProxyBaseUrl: "https://cliproxy-status.example/v1",
        cliProxyManagementKey: "cliproxy-status-management-secret",
      },
      headers: { cookie },
      method: "PUT",
      url: "/api/provider-settings/cliproxy",
    });

    const requested = [];
    globalThis.fetch = async (url, init = {}) => {
      requested.push({ authorization: init.headers?.Authorization, url: String(url) });
      return Response.json({ status: "wait" });
    };

    const statusResponse = await app.inject({
      headers: { cookie },
      method: "GET",
      url: "/api/provider-settings/cliproxy/oauth/anthropic/status?state=abc-123",
    });
    assert.equal(statusResponse.statusCode, 200);
    const payload = JSON.parse(statusResponse.body);
    assert.equal(payload.provider, "anthropic");
    assert.equal(payload.state, "abc-123");
    assert.equal(payload.status, "wait");
    assert.equal(requested[0].url, "https://cliproxy-status.example/v0/management/get-auth-status?state=abc-123");
    assert.equal(requested[0].authorization, "Bearer cliproxy-status-management-secret");

    await prisma.providerSetting.update({
      data: { cliProxyManagementKey: null },
      where: { userId_provider: { provider: "openai-compatible", userId: user.id } },
    });
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return Response.json({ status: "wait" });
    };
    const missingKeyResponse = await app.inject({
      headers: { cookie },
      method: "POST",
      url: "/api/provider-settings/cliproxy/oauth/anthropic/start",
    });
    assert.equal(missingKeyResponse.statusCode, 400);
    assert.match(JSON.parse(missingKeyResponse.body).error, /管理密钥/);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousManagementPassword === undefined) delete process.env.MANAGEMENT_PASSWORD;
    else process.env.MANAGEMENT_PASSWORD = previousManagementPassword;
    await app.close();
  }
});
