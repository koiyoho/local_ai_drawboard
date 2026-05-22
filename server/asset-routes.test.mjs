import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before, beforeEach } from "node:test";

const appModuleUrl = new URL("../dist/server/server/app.js", import.meta.url);
const prismaModuleUrl = new URL("../dist/server/src/lib/prisma.js", import.meta.url);
const authModuleUrl = new URL("../dist/server/server/auth.js", import.meta.url);

let tempDir;
let previousDatabaseUrl;
let previousAuthSecret;
let prisma;

before(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "asset-routes-test-"));
  previousDatabaseUrl = process.env.DATABASE_URL;
  previousAuthSecret = process.env.AUTH_SECRET;
  process.env.DATABASE_URL = `file:${path.join(tempDir, "test.db")}`;
  process.env.AUTH_SECRET = "asset-route-test-secret";
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
CREATE TABLE "StoryboardProject" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "boardId" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT '',
  "briefJson" TEXT NOT NULL,
  "scriptText" TEXT NOT NULL DEFAULT '',
  "metadataJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StoryboardProject_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`);
  await prisma.$executeRawUnsafe(`
CREATE TABLE "StoryboardShot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "shotIndex" INTEGER NOT NULL,
  "durationSec" INTEGER NOT NULL DEFAULT 3,
  "scene" TEXT NOT NULL DEFAULT '',
  "camera" TEXT NOT NULL DEFAULT '',
  "action" TEXT NOT NULL DEFAULT '',
  "dialogue" TEXT NOT NULL DEFAULT '',
  "caption" TEXT NOT NULL DEFAULT '',
  "audio" TEXT NOT NULL DEFAULT '',
  "startFrameAssetId" TEXT,
  "endFrameAssetId" TEXT,
  "startFramePrompt" TEXT NOT NULL DEFAULT '',
  "endFramePrompt" TEXT NOT NULL DEFAULT '',
  "videoPrompt" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "metadataJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StoryboardShot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "StoryboardProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
}

async function withTestAsset(prisma, fn) {
  const username = `asset-route-user-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      canUseAdminProvider: false,
      generationFiveHourLimit: 10,
      generationLimit: 30,
      name: username,
      role: "user",
      status: "approved",
      username,
    },
  });
  const board = await prisma.board.create({
    data: { name: "Asset route board", userId: user.id },
  });
  const asset = await prisma.asset.create({
    data: {
      boardId: board.id,
      kind: "upload",
      mimeType: "image/png",
      publicUrl: "/api/assets/test/file",
      sizeBytes: 128,
      storageKey: `uploads/${board.id}/upload/test.png`,
    },
  });
  return fn({ asset, board, user });
}

async function createTestUserAndBoard(prisma, namePrefix = "asset-list") {
  const username = `${namePrefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      canUseAdminProvider: false,
      generationFiveHourLimit: 10,
      generationLimit: 30,
      name: username,
      role: "user",
      status: "approved",
      username,
    },
  });
  const board = await prisma.board.create({
    data: { name: `${namePrefix} board`, userId: user.id },
  });
  return { board, user };
}

function assetData(boardId, index, overrides = {}) {
  const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, index));
  return {
    boardId,
    createdAt,
    kind: "upload",
    mimeType: "image/png",
    publicUrl: `/api/assets/${index}/file`,
    sizeBytes: 128 + index,
    storageKey: `asset-${index}.png`,
    ...overrides,
  };
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

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

test("PATCH /api/assets/:assetId updates favorite and normalized tags", async () => {
  const app = await createTestApp();
  try {
    await withTestAsset(prisma, async ({ asset, user }) => {
      const cookie = await sessionCookieFor(user.id);
      const response = await app.inject({
        body: {
          isFavorite: true,
          tags: [" 产品 ", "产品", "bg_1"],
        },
        headers: { cookie },
        method: "PATCH",
        url: `/api/assets/${asset.id}`,
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.asset.isFavorite, true);
      assert.deepEqual(body.asset.tags, ["产品", "bg_1"]);

      const persisted = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } });
      assert.equal(persisted.isFavorite, true);
      assert.equal(persisted.tagsJson, JSON.stringify(["产品", "bg_1"]));
    });
  } finally {
    await app.close();
  }
});

test("reverse prompt provider resolution uses configured local model channels", async () => {
  const previousProxyApiKey = process.env.CODEX_TEXT_PROXY_API_KEY;
  const previousProxyBaseUrl = process.env.CODEX_TEXT_PROXY_BASE_URL;
  process.env.CODEX_TEXT_PROXY_API_KEY = "codex-text-proxy-secret";
  process.env.CODEX_TEXT_PROXY_BASE_URL = "http://127.0.0.1:8081/v1";

  try {
    const {
      getReversePromptProviderSetting,
      resolveReversePromptModelChannel,
    } = await import(new URL("../dist/server/server/routes/assets.js", import.meta.url));
    const providerSetting = {
      apiKey: "third-party-secret",
      baseUrl: "https://example.test/v1",
      displayName: "OpenAI 兼容接口",
      enabledReversePromptModels: JSON.stringify([
        { channel: "codex", enabled: true, id: "gpt-5.4-mini", label: "GPT 5.4 Mini" },
      ]),
      imageModel: "gpt-image-2",
      textModel: "gpt-5.5",
    };

    const channel = resolveReversePromptModelChannel(providerSetting, "gpt-5.4-mini");
    const resolved = await getReversePromptProviderSetting(providerSetting, "gpt-5.4-mini", channel);

    assert.equal(channel, "codex");
    assert.equal(resolved.displayName, "官方 Codex 文本代理");
    assert.equal(resolved.baseUrl, "http://127.0.0.1:8081/v1");
    assert.equal(resolved.apiKey, "codex-text-proxy-secret");
    assert.equal(resolved.textModel, "gpt-5.4-mini");
  } finally {
    restoreEnv("CODEX_TEXT_PROXY_API_KEY", previousProxyApiKey);
    restoreEnv("CODEX_TEXT_PROXY_BASE_URL", previousProxyBaseUrl);
  }
});

test("reverse prompt provider resolution honors explicit provider defaults with duplicate ids", async () => {
  const {
    getReversePromptProviderSetting,
    resolveReversePromptModelChannel,
  } = await import(new URL("../dist/server/server/routes/assets.js", import.meta.url));
  const providerSetting = {
    apiKey: "third-party-secret",
    baseUrl: "https://example.test/v1",
    displayName: "OpenAI 兼容接口",
    enabledReversePromptModels: JSON.stringify([
      { channel: "codex", enabled: true, id: "gpt-5.5", label: "GPT 5.5 · Codex" },
      { channel: "provider", enabled: true, id: "gpt-5.5", label: "GPT 5.5 · Provider" },
    ]),
    imageModel: "gpt-image-2",
    textModel: "provider:gpt-5.5",
  };

  const channel = resolveReversePromptModelChannel(providerSetting, "gpt-5.5");
  const resolved = await getReversePromptProviderSetting(providerSetting, "gpt-5.5", channel);

  assert.equal(channel, "provider");
  assert.equal(resolved.displayName, "OpenAI 兼容接口");
  assert.equal(resolved.baseUrl, "https://example.test/v1");
  assert.equal(resolved.apiKey, "third-party-secret");
  assert.equal(resolved.textModel, "gpt-5.5");
});

test("reverse prompt provider resolution accepts channel-qualified defaults when the text model pool is empty", async () => {
  const previousProxyApiKey = process.env.CODEX_TEXT_PROXY_API_KEY;
  const previousProxyBaseUrl = process.env.CODEX_TEXT_PROXY_BASE_URL;
  process.env.CODEX_TEXT_PROXY_API_KEY = "codex-text-proxy-secret";
  process.env.CODEX_TEXT_PROXY_BASE_URL = "http://127.0.0.1:8086/v1";

  try {
    const {
      getReversePromptProviderSetting,
      resolveReversePromptModelChannel,
    } = await import(new URL("../dist/server/server/routes/assets.js", import.meta.url));
    const providerSetting = {
      apiKey: "third-party-secret",
      baseUrl: "https://example.test/v1",
      displayName: "OpenAI 兼容接口",
      enabledReversePromptModels: null,
      imageModel: "gpt-image-2",
      textModel: "codex:gpt-5.5",
    };

    const channel = resolveReversePromptModelChannel(providerSetting, "gpt-5.5");
    const resolved = await getReversePromptProviderSetting(providerSetting, "gpt-5.5", channel);

    assert.equal(channel, "codex");
    assert.equal(resolved.displayName, "官方 Codex 文本代理");
    assert.equal(resolved.baseUrl, "http://127.0.0.1:8086/v1");
    assert.equal(resolved.apiKey, "codex-text-proxy-secret");
    assert.equal(resolved.textModel, "gpt-5.5");
  } finally {
    restoreEnv("CODEX_TEXT_PROXY_API_KEY", previousProxyApiKey);
    restoreEnv("CODEX_TEXT_PROXY_BASE_URL", previousProxyBaseUrl);
  }
});

test("reverse prompt requested model resolution keeps legacy unqualified requests on provider when the duplicate default is Codex", async () => {
  const {
    getReversePromptProviderSetting,
    resolveReversePromptRequestedModelChannel,
  } = await import(new URL("../dist/server/server/routes/assets.js", import.meta.url));
  const providerSetting = {
    apiKey: "third-party-secret",
    baseUrl: "https://example.test/v1",
    displayName: "OpenAI 兼容接口",
    enabledReversePromptModels: JSON.stringify([
      { channel: "provider", enabled: true, id: "gpt-5.5", label: "GPT 5.5 · Provider" },
      { channel: "codex", enabled: true, id: "gpt-5.5", label: "GPT 5.5 · Codex" },
    ]),
    imageModel: "gpt-image-2",
    textModel: "codex:gpt-5.5",
  };

  const channel = resolveReversePromptRequestedModelChannel(providerSetting, "gpt-5.5");
  const resolved = await getReversePromptProviderSetting(providerSetting, "gpt-5.5", channel);

  assert.equal(channel, "provider");
  assert.equal(resolved.displayName, "OpenAI 兼容接口");
  assert.equal(resolved.baseUrl, "https://example.test/v1");
  assert.equal(resolved.apiKey, "third-party-secret");
  assert.equal(resolved.textModel, "gpt-5.5");
});

test("reverse prompt requested model resolution keeps legacy unqualified requests on a channel-qualified default when the text model pool is empty", async () => {
  const previousProxyApiKey = process.env.CODEX_TEXT_PROXY_API_KEY;
  const previousProxyBaseUrl = process.env.CODEX_TEXT_PROXY_BASE_URL;
  process.env.CODEX_TEXT_PROXY_API_KEY = "codex-text-proxy-secret";
  process.env.CODEX_TEXT_PROXY_BASE_URL = "http://127.0.0.1:8089/v1";

  try {
    const {
      getReversePromptProviderSetting,
      resolveReversePromptRequestedModelChannel,
    } = await import(new URL("../dist/server/server/routes/assets.js", import.meta.url));
    const providerSetting = {
      apiKey: "third-party-secret",
      baseUrl: "https://example.test/v1",
      displayName: "OpenAI 兼容接口",
      enabledReversePromptModels: null,
      imageModel: "gpt-image-2",
      textModel: "codex:gpt-5.5",
    };

    const channel = resolveReversePromptRequestedModelChannel(providerSetting, "gpt-5.5");
    const resolved = await getReversePromptProviderSetting(providerSetting, "gpt-5.5", channel);

    assert.equal(channel, "codex");
    assert.equal(resolved.displayName, "官方 Codex 文本代理");
    assert.equal(resolved.baseUrl, "http://127.0.0.1:8089/v1");
    assert.equal(resolved.apiKey, "codex-text-proxy-secret");
    assert.equal(resolved.textModel, "gpt-5.5");
  } finally {
    restoreEnv("CODEX_TEXT_PROXY_API_KEY", previousProxyApiKey);
    restoreEnv("CODEX_TEXT_PROXY_BASE_URL", previousProxyBaseUrl);
  }
});

test("style reverse prompt mode formats visible image details for editing", async () => {
  const { buildReversePromptUserInstruction } = await import(new URL("../dist/server/server/routes/assets.js", import.meta.url));
  const fullInstruction = buildReversePromptUserInstruction({
    analysisMode: "full",
    format: "natural",
    language: "zh",
    maxLength: "long",
    mode: "preset",
  });
  const styleInstruction = buildReversePromptUserInstruction({
    analysisMode: "style",
    format: "json",
    language: "zh",
    maxLength: "long",
    mode: "preset",
  });

  assert.match(styleInstruction, /模板体系标准/);
  assert.match(styleInstruction, /当前图片的具体观察结果/);
  assert.match(styleInstruction, /图像定位/);
  assert.match(styleInstruction, /主体细节/);
  assert.match(styleInstruction, /机位与角度/);
  assert.match(styleInstruction, /负向约束/);
  assert.match(styleInstruction, /\[方括号变量\]/);
  assert.doesNotMatch(fullInstruction, /模板体系标准/);
  assert.notEqual(styleInstruction, fullInstruction);
});

test("reverse prompt error formatter explains model/backend 404 failures", async () => {
  const { formatReversePromptError } = await import(new URL("../dist/server/server/routes/assets.js", import.meta.url));
  const message = formatReversePromptError(new Error("Not found"), {
    model: "gpt-5.4-mini",
    providerDisplayName: "OpenAI 兼容接口",
    route: "provider-setting",
  });

  assert.match(message, /gpt-5\.4-mini/);
  assert.match(message, /OpenAI 兼容接口/);
  assert.match(message, /本地模型通道/);
  assert.notEqual(message, "Not found");
});

test("GET /api/assets/:assetId/thumbnail returns a cached webp thumbnail", async () => {
  const app = await createTestApp();
  try {
    await withTestAsset(prisma, async ({ asset, board, user }) => {
      const assetPath = path.join(process.cwd(), "public", asset.storageKey);
      await mkdir(path.dirname(assetPath), { recursive: true });
      await writeFile(assetPath, Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
        "base64",
      ));
      await prisma.asset.update({
        data: {
          boardId: board.id,
          height: 1,
          mimeType: "image/png",
          sizeBytes: 70,
          width: 1,
        },
        where: { id: asset.id },
      });
      const cookie = await sessionCookieFor(user.id);

      const response = await app.inject({
        headers: { cookie },
        method: "GET",
        url: `/api/assets/${asset.id}/thumbnail`,
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.headers["content-type"], "image/webp");
      assert.match(String(response.headers["cache-control"]), /max-age=604800/);
      assert.ok(response.rawPayload.byteLength > 0);
    });
  } finally {
    await app.close();
  }
});

test("DELETE /api/assets/:assetId clears storyboard frame bindings", async () => {
  const app = await createTestApp();
  try {
    await withTestAsset(prisma, async ({ asset, board, user }) => {
      const project = await prisma.storyboardProject.create({
        data: {
          boardId: board.id,
          briefJson: "{}",
        },
      });
      const shot = await prisma.storyboardShot.create({
        data: {
          endFrameAssetId: asset.id,
          projectId: project.id,
          shotIndex: 1,
          startFrameAssetId: asset.id,
        },
      });
      const cookie = await sessionCookieFor(user.id);

      const response = await app.inject({
        headers: { cookie },
        method: "DELETE",
        url: `/api/assets/${asset.id}`,
      });

      assert.equal(response.statusCode, 200);
      const updatedShot = await prisma.storyboardShot.findUniqueOrThrow({ where: { id: shot.id } });
      assert.equal(updatedShot.startFrameAssetId, null);
      assert.equal(updatedShot.endFrameAssetId, null);
    });
  } finally {
    await app.close();
  }
});

test("GET /api/boards/:boardId/assets paginates beyond 50 assets until exhausted", async () => {
  const app = await createTestApp();
  try {
    const { board, user } = await createTestUserAndBoard(prisma, "asset-pagination");
    await prisma.asset.createMany({
      data: Array.from({ length: 55 }, (_, index) => assetData(board.id, index)),
    });
    const cookie = await sessionCookieFor(user.id);

    const firstResponse = await app.inject({
      headers: { cookie },
      method: "GET",
      url: `/api/boards/${board.id}/assets?limit=50`,
    });

    assert.equal(firstResponse.statusCode, 200);
    const firstBody = JSON.parse(firstResponse.body);
    assert.equal(firstBody.assets.length, 50);
    assert.equal(firstBody.totalMatching, 55);
    assert.equal(typeof firstBody.nextCursor, "string");
    assert.deepEqual(firstBody.assets.map((asset) => asset.kind).slice(0, 3), ["upload", "upload", "upload"]);
    assert.match(firstBody.assets[0].thumbnailUrl, /^\/api\/assets\/.+\/thumbnail$/);
    assert.ok(new Date(firstBody.assets[0].createdAt) > new Date(firstBody.assets[1].createdAt));

    const secondResponse = await app.inject({
      headers: { cookie },
      method: "GET",
      url: `/api/boards/${board.id}/assets?limit=50&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
    });

    assert.equal(secondResponse.statusCode, 200);
    const secondBody = JSON.parse(secondResponse.body);
    assert.equal(secondBody.assets.length, 5);
    assert.equal(secondBody.totalMatching, 55);
    assert.equal(secondBody.nextCursor, null);
  } finally {
    await app.close();
  }
});

test("GET /api/boards/:boardId/assets filters by kind and favorite within the owned board", async () => {
  const app = await createTestApp();
  try {
    const { board, user } = await createTestUserAndBoard(prisma, "asset-filter-owner");
    const { board: otherBoard } = await createTestUserAndBoard(prisma, "asset-filter-other");
    await prisma.asset.createMany({
      data: [
        assetData(board.id, 1, { kind: "upload" }),
        assetData(board.id, 2, { isFavorite: true, kind: "generated" }),
        assetData(board.id, 3, { isFavorite: false, kind: "generated" }),
        assetData(board.id, 4, { isFavorite: true, kind: "mask" }),
        assetData(otherBoard.id, 5, { isFavorite: true, kind: "generated" }),
      ],
    });
    const cookie = await sessionCookieFor(user.id);

    const response = await app.inject({
      headers: { cookie },
      method: "GET",
      url: `/api/boards/${board.id}/assets?kind=generated&favorite=true`,
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.totalMatching, 1);
    assert.equal(body.assets.length, 1);
    assert.equal(body.assets[0].boardId, board.id);
    assert.equal(body.assets[0].kind, "generated");
    assert.equal(body.assets[0].isFavorite, true);
  } finally {
    await app.close();
  }
});

test("GET /api/boards/:boardId/assets filters tags and searches kind, tags, and created date without storageKey", async () => {
  const app = await createTestApp();
  try {
    const { board, user } = await createTestUserAndBoard(prisma, "asset-search");
    await prisma.asset.createMany({
      data: [
        assetData(board.id, 1, {
          createdAt: new Date(Date.UTC(2026, 4, 14, 10, 0, 0)),
          kind: "source",
          storageKey: "hidden-key-needle.png",
          tagsJson: JSON.stringify(["产品", "bg_1"]),
        }),
        assetData(board.id, 2, {
          createdAt: new Date(Date.UTC(2026, 4, 15, 10, 0, 0)),
          kind: "mask",
          tagsJson: JSON.stringify(["Draft"]),
        }),
      ],
    });
    const cookie = await sessionCookieFor(user.id);

    const tagResponse = await app.inject({
      headers: { cookie },
      method: "GET",
      url: `/api/boards/${board.id}/assets?tag=${encodeURIComponent(" 产品 ")}`,
    });
    assert.equal(tagResponse.statusCode, 200);
    const tagBody = JSON.parse(tagResponse.body);
    assert.equal(tagBody.assets.length, 1);
    assert.deepEqual(tagBody.assets[0].tags, ["产品", "bg_1"]);
    assert.equal(Object.hasOwn(tagBody.assets[0], "storageKey"), false);

    const kindSearchResponse = await app.inject({
      headers: { cookie },
      method: "GET",
      url: `/api/boards/${board.id}/assets?q=source`,
    });
    assert.equal(JSON.parse(kindSearchResponse.body).assets.length, 1);

    const tagSearchResponse = await app.inject({
      headers: { cookie },
      method: "GET",
      url: `/api/boards/${board.id}/assets?q=${encodeURIComponent(" BG_1 ")}`,
    });
    assert.equal(JSON.parse(tagSearchResponse.body).assets.length, 1);

    const typeSearchResponse = await app.inject({
      headers: { cookie },
      method: "GET",
      url: `/api/boards/${board.id}/assets?q=image%2Fpng`,
    });
    assert.equal(JSON.parse(typeSearchResponse.body).assets.length, 2);

    const dateSearchResponse = await app.inject({
      headers: { cookie },
      method: "GET",
      url: `/api/boards/${board.id}/assets?q=2026-05-14`,
    });
    assert.equal(JSON.parse(dateSearchResponse.body).assets.length, 1);

    const storageKeySearchResponse = await app.inject({
      headers: { cookie },
      method: "GET",
      url: `/api/boards/${board.id}/assets?q=hidden-key-needle`,
    });
    assert.equal(storageKeySearchResponse.statusCode, 200);
    assert.equal(JSON.parse(storageKeySearchResponse.body).assets.length, 0);
  } finally {
    await app.close();
  }
});

test("GET /api/boards/:boardId/assets returns 404 for missing or unauthorized boards", async () => {
  const app = await createTestApp();
  try {
    const { user } = await createTestUserAndBoard(prisma, "asset-unauthorized-user");
    const { board: otherBoard } = await createTestUserAndBoard(prisma, "asset-unauthorized-other");
    const cookie = await sessionCookieFor(user.id);

    const missingResponse = await app.inject({
      headers: { cookie },
      method: "GET",
      url: "/api/boards/missing-board/assets",
    });
    assert.equal(missingResponse.statusCode, 404);

    const unauthorizedResponse = await app.inject({
      headers: { cookie },
      method: "GET",
      url: `/api/boards/${otherBoard.id}/assets`,
    });
    assert.equal(unauthorizedResponse.statusCode, 404);
  } finally {
    await app.close();
  }
});

test("GET /api/boards/:boardId/assets rejects invalid query inputs", async () => {
  const app = await createTestApp();
  try {
    const { board, user } = await createTestUserAndBoard(prisma, "asset-invalid-query");
    const cookie = await sessionCookieFor(user.id);
    const invalidQueries = [
      "limit=0",
      "kind=other",
      "cursor=not-a-cursor",
      "favorite=yes",
      "favorite=true&favorite=false",
      "kind=upload&kind=mask",
      "cursor=abc&cursor=def",
      "tag=product&tag=draft",
      "q=png&q=mask",
    ];

    for (const query of invalidQueries) {
      const response = await app.inject({
        headers: { cookie },
        method: "GET",
        url: `/api/boards/${board.id}/assets?${query}`,
      });
      assert.equal(response.statusCode, 400, query);
    }
  } finally {
    await app.close();
  }
});

test("PATCH /api/assets/:assetId rejects too many or too long tags", async () => {
  const app = await createTestApp();
  try {
    await withTestAsset(prisma, async ({ asset, user }) => {
      const cookie = await sessionCookieFor(user.id);
      const dedupedResponse = await app.inject({
        body: { tags: Array.from({ length: 13 }, () => "same-tag") },
        headers: { cookie },
        method: "PATCH",
        url: `/api/assets/${asset.id}`,
      });
      assert.equal(dedupedResponse.statusCode, 200);
      assert.deepEqual(JSON.parse(dedupedResponse.body).asset.tags, ["same-tag"]);

      const tooManyResponse = await app.inject({
        body: { tags: Array.from({ length: 13 }, (_, index) => `tag-${index}`) },
        headers: { cookie },
        method: "PATCH",
        url: `/api/assets/${asset.id}`,
      });
      assert.equal(tooManyResponse.statusCode, 400);

      const tooLongResponse = await app.inject({
        body: { tags: ["abcdefghijklmnopqrstuvwxy"] },
        headers: { cookie },
        method: "PATCH",
        url: `/api/assets/${asset.id}`,
      });
      assert.equal(tooLongResponse.statusCode, 400);
    });
  } finally {
    await app.close();
  }
});
