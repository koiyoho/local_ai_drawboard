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
        displayName: "First API",
        enabledImageModels: [{ enabled: true, id: "gpt-image-2", label: "GPT Image" }],
        enabledReversePromptModels: [{ enabled: true, id: "gpt-5.5", label: "GPT 5.5" }],
        imageModel: "gpt-image-2",
        textModel: "gpt-5.5",
      },
      headers: { cookie },
      method: "PUT",
      url: "/api/provider-settings",
    });
    assert.equal(firstSave.statusCode, 200);
    const firstHistory = JSON.parse(firstSave.body).histories[0];
    assert.equal(firstHistory.displayName, "First API");
    assert.equal(JSON.stringify(firstHistory).includes("sk-first-secret"), false);

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
    assert.equal(JSON.stringify(applied).includes("sk-first-secret"), false);

    const stored = await prisma.providerSetting.findUnique({ where: { userId_provider: { provider: "openai-compatible", userId: user.id } } });
    assert.equal(stored.apiKey, "sk-first-secret");
  } finally {
    await app.close();
  }
});

test("admin can publish enabled model options for frontend selection", async () => {
  const app = await createTestApp();
  try {
    const admin = await createUser({ role: "admin", username: "koiyoho" });
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
    assert.deepEqual(options.imageModels, [{ id: "flux-kontext-pro", label: "Flux Kontext" }]);
    assert.deepEqual(options.reversePromptModels, [{ id: "gpt-5.5", label: "GPT 5.5" }]);
    assert.equal(options.selectedImageModel, "flux-kontext-pro");
  } finally {
    await app.close();
  }
});

test("frontend model options stay model-only when backend channels are configured", async () => {
  const app = await createTestApp();
  try {
    const admin = await createUser({ role: "admin", username: "koiyoho" });
    const cookie = await sessionCookieFor(admin.id);

    await app.inject({
      body: {
        apiKey: "sk-admin-secret",
        baseUrl: "https://api.admin.example/v1",
        displayName: "Admin API",
        enabledImageModels: [
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
      { id: "gpt-image-2", label: "GPT Image 2" },
      { id: "nano-banana", label: "Nano Banana" },
    ]);
    assert.equal(JSON.stringify(options.imageModels).includes("channel"), false);
  } finally {
    await app.close();
  }
});

test("saving api settings keeps admin model pool and backend channels unchanged", async () => {
  const app = await createTestApp();
  try {
    const admin = await createUser({ role: "admin", username: "koiyoho" });
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
