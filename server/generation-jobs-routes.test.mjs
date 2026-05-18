import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before, beforeEach } from "node:test";

const appModuleUrl = new URL("../dist/server/server/app.js", import.meta.url);
const generationJobServiceModuleUrl = new URL("../dist/server/server/generation-job-service.js", import.meta.url);
const prismaModuleUrl = new URL("../dist/server/src/lib/prisma.js", import.meta.url);
const authModuleUrl = new URL("../dist/server/server/auth.js", import.meta.url);

let tempDir;
let previousDatabaseUrl;
let previousAuthSecret;
let previousGeminiBridgeApiKey;
let previousGeminiBridgeHost;
let previousGeminiBridgePort;
let previousCodexImageProxyApiKey;
let previousCodexImageProxyBaseUrl;
let prisma;

before(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "generation-jobs-routes-test-"));
  previousDatabaseUrl = process.env.DATABASE_URL;
  previousAuthSecret = process.env.AUTH_SECRET;
  previousGeminiBridgeApiKey = process.env.GEMINI_BRIDGE_API_KEY;
  previousGeminiBridgeHost = process.env.GEMINI_BRIDGE_HOST;
  previousGeminiBridgePort = process.env.GEMINI_BRIDGE_PORT;
  previousCodexImageProxyApiKey = process.env.CODEX_IMAGE_PROXY_API_KEY;
  previousCodexImageProxyBaseUrl = process.env.CODEX_IMAGE_PROXY_BASE_URL;
  process.env.DATABASE_URL = `file:${path.join(tempDir, "test.db")}`;
  process.env.AUTH_SECRET = "generation-job-route-test-secret";
  ({ prisma } = await import(prismaModuleUrl));
  await initializeDatabase(prisma);
});

beforeEach(async () => {
  await prisma.user.deleteMany();
});

after(async () => {
  if (prisma) {
    await prisma.$disconnect();
  }
  if (previousDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = previousDatabaseUrl;
  }
  if (previousAuthSecret === undefined) {
    delete process.env.AUTH_SECRET;
  } else {
    process.env.AUTH_SECRET = previousAuthSecret;
  }
  restoreEnv("GEMINI_BRIDGE_API_KEY", previousGeminiBridgeApiKey);
  restoreEnv("GEMINI_BRIDGE_HOST", previousGeminiBridgeHost);
  restoreEnv("GEMINI_BRIDGE_PORT", previousGeminiBridgePort);
  restoreEnv("CODEX_IMAGE_PROXY_API_KEY", previousCodexImageProxyApiKey);
  restoreEnv("CODEX_IMAGE_PROXY_BASE_URL", previousCodexImageProxyBaseUrl);
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
  }
});

async function createTestApp() {
  const { createApp } = await import(appModuleUrl);
  return createApp();
}

async function initializeDatabase(prisma) {
  await prisma.$executeRawUnsafe(`PRAGMA foreign_keys = ON`);
  await prisma.$executeRawUnsafe(`
CREATE TABLE "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "username" TEXT,
  "passwordHash" TEXT,
  "role" TEXT NOT NULL DEFAULT 'user',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "canUseAdminProvider" BOOLEAN NOT NULL DEFAULT false,
  "generationLimit" INTEGER DEFAULT 30,
  "generationFiveHourLimit" INTEGER DEFAULT 10,
  "approvedAt" DATETIME,
  "approvedByUserId" TEXT,
  "name" TEXT,
  "email" TEXT,
  "emailVerified" DATETIME,
  "image" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
  await prisma.$executeRawUnsafe(`
CREATE TABLE "Board" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "snapshotJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Board_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`);
  await prisma.$executeRawUnsafe(`
CREATE TABLE "Asset" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "boardId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "publicUrl" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "sizeBytes" INTEGER NOT NULL,
  "isFavorite" BOOLEAN NOT NULL DEFAULT false,
  "tagsJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Asset_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`);
  await prisma.$executeRawUnsafe(`
CREATE TABLE "BoardSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "boardId" TEXT NOT NULL,
  "snapshotJson" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BoardSnapshot_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`);
  await prisma.$executeRawUnsafe(`
CREATE TABLE "GenerationJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "boardId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "negativePrompt" TEXT,
  "sourceAssetId" TEXT,
  "maskAssetId" TEXT,
  "paramsJson" TEXT,
  "errorMessage" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GenerationJob_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GenerationJob_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "Asset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "GenerationJob_maskAssetId_fkey" FOREIGN KEY ("maskAssetId") REFERENCES "Asset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
)`);
  await prisma.$executeRawUnsafe(`
CREATE TABLE "GenerationResult" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "jobId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GenerationResult_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GenerationResult_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`);
  await prisma.$executeRawUnsafe(`
CREATE TABLE "ProviderSetting" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'openai-compatible',
  "displayName" TEXT NOT NULL,
  "apiKey" TEXT NOT NULL,
  "baseUrl" TEXT,
  "imageModel" TEXT NOT NULL,
  "textModel" TEXT NOT NULL DEFAULT 'gpt-5.5',
  "enabledImageModels" TEXT,
  "enabledReversePromptModels" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "ProviderSetting_userId_provider_key" ON "ProviderSetting"("userId", "provider")`);
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

test("POST /api/generation-jobs reports a missing source file without leaking server paths", async () => {
  const app = await createTestApp();
  try {
    const user = await prisma.user.create({
      data: {
        canUseAdminProvider: false,
        generationFiveHourLimit: 10,
        generationLimit: 30,
        name: "generation-test-user",
        role: "user",
        status: "approved",
        username: `generation-test-user-${Date.now()}`,
      },
    });
    await prisma.providerSetting.create({
      data: {
        apiKey: "test-key",
        displayName: "OpenAI 兼容接口",
        imageModel: "gpt-image-2",
        provider: "openai-compatible",
        textModel: "gpt-5.5",
        userId: user.id,
      },
    });
    const board = await prisma.board.create({
      data: { name: "Missing asset board", userId: user.id },
    });
    const asset = await prisma.asset.create({
      data: {
        boardId: board.id,
        kind: "upload",
        mimeType: "image/jpeg",
        publicUrl: "/api/assets/missing-source/file",
        sizeBytes: 128,
        storageKey: `uploads/${board.id}/upload/missing.jpg`,
      },
    });

    const response = await app.inject({
      body: {
        boardId: board.id,
        mode: "inpaint",
        prompt: "换一件衣服",
        size: "1024x1024",
        sourceAssetId: asset.id,
      },
      headers: { cookie: await sessionCookieFor(user.id) },
      method: "POST",
      url: "/api/generation-jobs",
    });

    assert.equal(response.statusCode, 500);
    const body = JSON.parse(response.body);
    assert.match(body.error, /素材文件不存在|重新上传|重新载入/);
    assert.doesNotMatch(body.error, /\/srv|ENOENT|public\/uploads|open/i);
  } finally {
    await app.close();
  }
});

test("POST /api/generation-jobs can start an async job and expose progress by polling", async () => {
  const app = await createTestApp();
  try {
    const user = await prisma.user.create({
      data: {
        canUseAdminProvider: false,
        generationFiveHourLimit: 10,
        generationLimit: 30,
        name: "generation-async-user",
        role: "user",
        status: "approved",
        username: `generation-async-user-${Date.now()}`,
      },
    });
    await prisma.providerSetting.create({
      data: {
        apiKey: "test-key",
        displayName: "OpenAI 兼容接口",
        imageModel: "gpt-image-2",
        provider: "openai-compatible",
        textModel: "gpt-5.5",
        userId: user.id,
      },
    });
    const board = await prisma.board.create({
      data: { name: "Async missing asset board", userId: user.id },
    });
    const asset = await prisma.asset.create({
      data: {
        boardId: board.id,
        kind: "upload",
        mimeType: "image/jpeg",
        publicUrl: "/api/assets/missing-source/file",
        sizeBytes: 128,
        storageKey: `uploads/${board.id}/upload/missing-async.jpg`,
      },
    });
    const cookie = await sessionCookieFor(user.id);

    const response = await app.inject({
      body: {
        boardId: board.id,
        mode: "inpaint",
        prompt: "换一件衣服",
        size: "1024x1024",
        sourceAssetId: asset.id,
        waitForCompletion: false,
      },
      headers: { cookie },
      method: "POST",
      url: "/api/generation-jobs",
    });

    assert.equal(response.statusCode, 202);
    const started = JSON.parse(response.body);
    assert.equal(started.job.status, "preparing");
    assert.equal(started.results.length, 0);

    let polled;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const pollResponse = await app.inject({
        headers: { cookie },
        method: "GET",
        url: `/api/generation-jobs/${started.job.id}`,
      });
      assert.equal(pollResponse.statusCode, 200);
      polled = JSON.parse(pollResponse.body);
      if (polled.job.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    assert.equal(polled.job.status, "failed");
    assert.match(polled.job.errorMessage, /素材文件不存在|重新上传|重新载入/);
    assert.doesNotMatch(polled.job.errorMessage, /\/srv|ENOENT|public\/uploads|open/i);
  } finally {
    await app.close();
  }
});

test("createImageGenerationJob routes Gemini image models to the Gemini bridge", async () => {
  process.env.GEMINI_BRIDGE_API_KEY = "gemini-bridge-secret";
  process.env.GEMINI_BRIDGE_HOST = "127.0.0.1";
  process.env.GEMINI_BRIDGE_PORT = "8317";

  const user = await prisma.user.create({
    data: {
      canUseAdminProvider: false,
      generationFiveHourLimit: 10,
      generationLimit: 30,
      name: "generation-gemini-user",
      role: "user",
      status: "approved",
      username: `generation-gemini-user-${Date.now()}`,
    },
  });
  await prisma.providerSetting.create({
    data: {
      apiKey: "third-party-secret",
      baseUrl: "https://sub.aipowers.site/v1",
      displayName: "OpenAI 兼容接口",
      enabledImageModels: JSON.stringify([
        { enabled: true, id: "gpt-image-2", label: "GPT Image" },
        { enabled: true, id: "nano-banana", label: "Nano Banana" },
      ]),
      imageModel: "gpt-image-2",
      provider: "openai-compatible",
      textModel: "gpt-5.5",
      userId: user.id,
    },
  });
  const board = await prisma.board.create({
    data: { name: "Gemini route board", userId: user.id },
  });

  const { createImageGenerationJob } = await import(generationJobServiceModuleUrl);
  const result = await createImageGenerationJob({
    boardName: board.name,
    generation: {
      boardId: board.id,
      count: 1,
      mode: "text_to_image",
      model: "nano-banana",
      prompt: "生成一张测试图片",
      referenceAssetIds: [],
      size: "1024x1024",
    },
    user,
  });

  assert.equal(result.ok, true);
  assert.equal(result.providerSetting.displayName, "Gemini Web Bridge");
  assert.equal(result.providerSetting.baseUrl, "http://127.0.0.1:8317/v1");
  assert.equal(result.providerSetting.apiKey, "gemini-bridge-secret");
  const params = JSON.parse(result.job.paramsJson);
  assert.equal(params.model, "nano-banana");
  assert.equal(params.providerDisplayName, "Gemini Web Bridge");
  assert.equal(params.providerBaseUrl, "configured");
});

test("createImageGenerationJob keeps gpt-image-2 on the configured provider when Gemini models are enabled", async () => {
  process.env.GEMINI_BRIDGE_API_KEY = "gemini-bridge-secret";
  process.env.GEMINI_BRIDGE_HOST = "127.0.0.1";
  process.env.GEMINI_BRIDGE_PORT = "8317";

  const user = await prisma.user.create({
    data: {
      canUseAdminProvider: false,
      generationFiveHourLimit: 10,
      generationLimit: 30,
      name: "generation-openai-user",
      role: "user",
      status: "approved",
      username: `generation-openai-user-${Date.now()}`,
    },
  });
  await prisma.providerSetting.create({
    data: {
      apiKey: "third-party-secret",
      baseUrl: "https://sub.aipowers.site/v1",
      displayName: "OpenAI 兼容接口",
      enabledImageModels: JSON.stringify([
        { enabled: true, id: "gpt-image-2", label: "GPT Image" },
        { enabled: true, id: "nano-banana", label: "Nano Banana" },
      ]),
      imageModel: "gpt-image-2",
      provider: "openai-compatible",
      textModel: "gpt-5.5",
      userId: user.id,
    },
  });
  const board = await prisma.board.create({
    data: { name: "OpenAI route board", userId: user.id },
  });

  const { createImageGenerationJob } = await import(generationJobServiceModuleUrl);
  const result = await createImageGenerationJob({
    boardName: board.name,
    generation: {
      boardId: board.id,
      count: 1,
      mode: "text_to_image",
      model: "gpt-image-2",
      prompt: "生成一张测试图片",
      referenceAssetIds: [],
      size: "1024x1024",
    },
    user,
  });

  assert.equal(result.ok, true);
  assert.equal(result.providerSetting.displayName, "OpenAI 兼容接口");
  assert.equal(result.providerSetting.baseUrl, "https://sub.aipowers.site/v1");
  assert.equal(result.providerSetting.apiKey, "third-party-secret");
  const params = JSON.parse(result.job.paramsJson);
  assert.equal(params.model, "gpt-image-2");
  assert.equal(params.providerDisplayName, "OpenAI 兼容接口");
  assert.equal(params.providerRoute, "provider-setting");
  assert.equal(params.providerBaseUrl, "configured");
});

test("createImageGenerationJob routes a model through the backend configured Codex channel", async () => {
  const previousDataDir = process.env.CODEX_OAUTH_DATA_DIR;
  const codexDir = await mkdtemp(path.join(tmpdir(), "generation-codex-auth-test-"));
  process.env.CODEX_OAUTH_DATA_DIR = codexDir;

  try {
    await writeFile(
      path.join(codexDir, "codex-auth.json"),
      JSON.stringify({
        OPENAI_API_KEY: "sk-codex-image-secret",
        auth_mode: "apikey",
      }),
      "utf8",
    );

    const user = await prisma.user.create({
      data: {
        canUseAdminProvider: false,
        generationFiveHourLimit: 10,
        generationLimit: 30,
        name: "generation-codex-user",
        role: "user",
        status: "approved",
        username: `generation-codex-user-${Date.now()}`,
      },
    });
    await prisma.providerSetting.create({
      data: {
        apiKey: "third-party-secret",
        baseUrl: "https://sub.aipowers.site/v1",
        displayName: "OpenAI 兼容接口",
        enabledImageModels: JSON.stringify([
          { channel: "codex", enabled: true, id: "gpt-image-2", label: "GPT Image 2" },
        ]),
        imageModel: "gpt-image-2",
        provider: "openai-compatible",
        textModel: "gpt-5.5",
        userId: user.id,
      },
    });
    const board = await prisma.board.create({
      data: { name: "Codex route board", userId: user.id },
    });

    const { createImageGenerationJob } = await import(generationJobServiceModuleUrl);
    const result = await createImageGenerationJob({
      boardName: board.name,
      generation: {
        boardId: board.id,
        count: 1,
        mode: "text_to_image",
        model: "gpt-image-2",
        prompt: "生成一张测试图片",
        referenceAssetIds: [],
        size: "1024x1024",
      },
      user,
    });

    assert.equal(result.ok, true);
    assert.equal(result.providerSetting.displayName, "官方 Codex");
    assert.equal(result.providerSetting.baseUrl, null);
    assert.equal(result.providerSetting.apiKey, "sk-codex-image-secret");
    const params = JSON.parse(result.job.paramsJson);
    assert.equal(params.model, "gpt-image-2");
    assert.equal(params.modelChannel, "codex");
    assert.equal(params.providerDisplayName, "官方 Codex");
    assert.equal(params.providerRoute, "codex");
    assert.equal(params.providerBaseUrl, "default");
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.CODEX_OAUTH_DATA_DIR;
    } else {
      process.env.CODEX_OAUTH_DATA_DIR = previousDataDir;
    }
    await rm(codexDir, { force: true, recursive: true });
  }
});

test("createImageGenerationJob rejects Codex OAuth-only auth without a Codex image proxy", async () => {
  const previousDataDir = process.env.CODEX_OAUTH_DATA_DIR;
  const previousProxyBaseUrl = process.env.CODEX_IMAGE_PROXY_BASE_URL;
  const codexDir = await mkdtemp(path.join(tmpdir(), "generation-codex-oauth-only-test-"));
  process.env.CODEX_OAUTH_DATA_DIR = codexDir;
  delete process.env.CODEX_IMAGE_PROXY_BASE_URL;

  try {
    await writeFile(
      path.join(codexDir, "codex-auth.json"),
      JSON.stringify({
        authMode: "chatgpt",
        clientId: "app-test",
        issuer: "https://auth.openai.com",
        lastLoginAt: "2026-05-19T00:00:00.000Z",
        tokens: {
          accessToken: "oauth-access-token",
          idToken: "oauth-id-token",
          idTokenClaims: {},
          refreshToken: "oauth-refresh-token",
        },
      }),
      "utf8",
    );

    const user = await prisma.user.create({
      data: {
        canUseAdminProvider: false,
        generationFiveHourLimit: 10,
        generationLimit: 30,
        name: "generation-codex-oauth-user",
        role: "user",
        status: "approved",
        username: `generation-codex-oauth-user-${Date.now()}`,
      },
    });
    await prisma.providerSetting.create({
      data: {
        apiKey: "third-party-secret",
        baseUrl: "https://sub.aipowers.site/v1",
        displayName: "OpenAI 兼容接口",
        enabledImageModels: JSON.stringify([
          { channel: "codex", enabled: true, id: "gpt-image-2", label: "GPT Image 2" },
        ]),
        imageModel: "gpt-image-2",
        provider: "openai-compatible",
        textModel: "gpt-5.5",
        userId: user.id,
      },
    });
    const board = await prisma.board.create({
      data: { name: "Codex OAuth only board", userId: user.id },
    });

    const { createImageGenerationJob } = await import(generationJobServiceModuleUrl);
    const result = await createImageGenerationJob({
      boardName: board.name,
      generation: {
        boardId: board.id,
        count: 1,
        mode: "text_to_image",
        model: "gpt-image-2",
        prompt: "生成一张测试图片",
        referenceAssetIds: [],
        size: "1024x1024",
      },
      user,
    });

    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 400);
    assert.match(result.error, /账号 OAuth token/);
    assert.match(result.error, /CODEX_IMAGE_PROXY_BASE_URL/);
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.CODEX_OAUTH_DATA_DIR;
    } else {
      process.env.CODEX_OAUTH_DATA_DIR = previousDataDir;
    }
    restoreEnv("CODEX_IMAGE_PROXY_BASE_URL", previousProxyBaseUrl);
    await rm(codexDir, { force: true, recursive: true });
  }
});

test("createImageGenerationJob routes Codex image models through a configured OpenAI-compatible proxy", async () => {
  const previousProxyApiKey = process.env.CODEX_IMAGE_PROXY_API_KEY;
  const previousProxyBaseUrl = process.env.CODEX_IMAGE_PROXY_BASE_URL;
  process.env.CODEX_IMAGE_PROXY_API_KEY = "codex-proxy-secret";
  process.env.CODEX_IMAGE_PROXY_BASE_URL = "http://127.0.0.1:8080/v1";

  try {
    const user = await prisma.user.create({
      data: {
        canUseAdminProvider: false,
        generationFiveHourLimit: 10,
        generationLimit: 30,
        name: "generation-codex-proxy-user",
        role: "user",
        status: "approved",
        username: `generation-codex-proxy-user-${Date.now()}`,
      },
    });
    await prisma.providerSetting.create({
      data: {
        apiKey: "third-party-secret",
        baseUrl: "https://sub.aipowers.site/v1",
        displayName: "OpenAI 兼容接口",
        enabledImageModels: JSON.stringify([
          { channel: "codex", enabled: true, id: "gpt-image-2", label: "GPT Image 2" },
        ]),
        imageModel: "gpt-image-2",
        provider: "openai-compatible",
        textModel: "gpt-5.5",
        userId: user.id,
      },
    });
    const board = await prisma.board.create({
      data: { name: "Codex proxy route board", userId: user.id },
    });

    const { createImageGenerationJob } = await import(generationJobServiceModuleUrl);
    const result = await createImageGenerationJob({
      boardName: board.name,
      generation: {
        boardId: board.id,
        count: 1,
        mode: "text_to_image",
        model: "gpt-image-2",
        prompt: "生成一张测试图片",
        referenceAssetIds: [],
        size: "1024x1024",
      },
      user,
    });

    assert.equal(result.ok, true);
    assert.equal(result.providerSetting.displayName, "官方 Codex 代理");
    assert.equal(result.providerSetting.baseUrl, "http://127.0.0.1:8080/v1");
    assert.equal(result.providerSetting.apiKey, "codex-proxy-secret");
    const params = JSON.parse(result.job.paramsJson);
    assert.equal(params.modelChannel, "codex");
    assert.equal(params.providerDisplayName, "官方 Codex 代理");
    assert.equal(params.providerRoute, "codex");
    assert.equal(params.providerBaseUrl, "configured");
  } finally {
    restoreEnv("CODEX_IMAGE_PROXY_API_KEY", previousProxyApiKey);
    restoreEnv("CODEX_IMAGE_PROXY_BASE_URL", previousProxyBaseUrl);
  }
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
