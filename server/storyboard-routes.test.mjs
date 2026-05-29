import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before, beforeEach } from "node:test";

const prismaModuleUrl = new URL("../dist/server/src/lib/prisma.js", import.meta.url);
const authModuleUrl = new URL("../dist/server/server/auth.js", import.meta.url);

let tempDir;
let previousDatabaseUrl;
let previousAuthSecret;
let prisma;
let fakeTextResponse = "";
let fakeTextResponses = [];
let capturedTextInstructions = [];
let fakeImageGenerationResult;
let capturedImageGenerationInputs = [];

before(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "storyboard-routes-test-"));
  previousDatabaseUrl = process.env.DATABASE_URL;
  previousAuthSecret = process.env.AUTH_SECRET;
  process.env.DATABASE_URL = `file:${path.join(tempDir, "test.db")}`;
  process.env.AUTH_SECRET = "storyboard-route-test-secret";
  ({ prisma } = await import(prismaModuleUrl));
  await initializeDatabase(prisma);
});

beforeEach(async () => {
  fakeTextResponse = "";
  fakeTextResponses = [];
  capturedTextInstructions = [];
  fakeImageGenerationResult = undefined;
  capturedImageGenerationInputs = [];
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

async function createTestApp(options = {}) {
  const fastify = (await import("fastify")).default;
  const cookie = (await import("@fastify/cookie")).default;
  const { registerAuthRoutes } = await import(new URL("../dist/server/server/routes/auth.js", import.meta.url));
  const { createStoryboardRoutes } = await import(new URL("../dist/server/server/routes/storyboards.js", import.meta.url));
  const app = fastify();
  await app.register(cookie);
  await app.register(registerAuthRoutes);
  await app.register(createStoryboardRoutes({
    callTextModel: async (_providerSetting, instruction) => {
      capturedTextInstructions.push(instruction);
      return fakeTextResponses.shift() ?? fakeTextResponse;
    },
    runImageGenerationJob: options.runImageGenerationJob ?? (async (input) => {
      capturedImageGenerationInputs.push(input);
      return fakeImageGenerationResult ?? { error: "fake image generation result not configured", ok: false, statusCode: 500 };
    }),
  }));
  return app;
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
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "StoryboardProject_boardId_key" ON "StoryboardProject"("boardId")`);
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
  "cliProxyApiKey" TEXT,
  "cliProxyManagementKey" TEXT,
  "cliProxyBaseUrl" TEXT,
  "imageModel" TEXT NOT NULL,
  "textModel" TEXT NOT NULL DEFAULT 'gpt-5.5',
  "videoModel" TEXT,
  "enabledImageModels" TEXT,
  "enabledReversePromptModels" TEXT,
  "enabledVideoModels" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "ProviderSetting_userId_provider_key" ON "ProviderSetting"("userId", "provider")`);
  await prisma.$executeRawUnsafe(`
CREATE TABLE "Account" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "refresh_token" TEXT,
  "access_token" TEXT,
  "expires_at" INTEGER,
  "token_type" TEXT,
  "scope" TEXT,
  "id_token" TEXT,
  "session_state" TEXT,
  CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`);
  await prisma.$executeRawUnsafe(`
CREATE TABLE "Session" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionToken" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expires" DATETIME NOT NULL,
  CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`);
  await prisma.$executeRawUnsafe(`
CREATE TABLE "VerificationToken" (
  "identifier" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "expires" DATETIME NOT NULL,
  PRIMARY KEY ("identifier", "token")
)`);
}

async function withTestUser(fn) {
  const username = `storyboard-user-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  return fn(user);
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

function createBoardFor(userId, name = "分镜测试画板") {
  return prisma.board.create({ data: { name, userId } });
}

function createAssetFor(boardId, id = `asset-${Date.now()}-${Math.random().toString(16).slice(2)}`) {
  return prisma.asset.create({
    data: {
      boardId,
      id,
      kind: "upload",
      mimeType: "image/png",
      publicUrl: `/api/assets/${id}/file`,
      sizeBytes: 68,
      storageKey: `uploads/${boardId}/upload/${id}.png`,
    },
  });
}

function createGeneratedAssetPayload(id, boardId = "generated-frame-board") {
  return {
    boardId,
    createdAt: new Date("2026-05-18T00:00:00.000Z"),
    height: 1024,
    id,
    isFavorite: false,
    kind: "generated",
    mimeType: "image/png",
    publicUrl: `/api/assets/${id}/file`,
    sizeBytes: 256,
    storageKey: `generated/${boardId}/${id}.png`,
    tagsJson: null,
    width: 1024,
  };
}

function createGeneratedJobPayload(id, asset, prompt = "frame prompt") {
  return {
    boardId: asset.boardId,
    createdAt: new Date("2026-05-18T00:00:00.000Z"),
    errorMessage: null,
    id,
    maskAssetId: null,
    mode: "text_to_image",
    negativePrompt: null,
    paramsJson: "{}",
    prompt,
    provider: "openai-compatible",
    results: [{ asset }],
    sourceAssetId: null,
    status: "succeeded",
    updatedAt: new Date("2026-05-18T00:00:01.000Z"),
  };
}

test("GET /api/boards/:boardId/storyboard creates an empty storyboard project", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(async (user) => {
      const board = await createBoardFor(user.id);
      const response = await app.inject({
        headers: { cookie: await sessionCookieFor(user.id) },
        method: "GET",
        url: `/api/boards/${board.id}/storyboard`,
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.storyboard.boardId, board.id);
      assert.equal(body.storyboard.brief.targetPlatform, "douyin");
      assert.equal(body.storyboard.shots.length, 0);
    });
  } finally {
    await app.close();
  }
});

test("storyboard routes reject boards owned by another user", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(async (owner) => {
      await withTestUser(async (otherUser) => {
        const board = await createBoardFor(owner.id);
        const response = await app.inject({
          headers: { cookie: await sessionCookieFor(otherUser.id) },
          method: "GET",
          url: `/api/boards/${board.id}/storyboard`,
        });

        assert.equal(response.statusCode, 404);
      });
    });
  } finally {
    await app.close();
  }
});

test("PUT /api/boards/:boardId/storyboard persists brief and script", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(async (user) => {
      const board = await createBoardFor(user.id);
      const response = await app.inject({
        headers: { cookie: await sessionCookieFor(user.id) },
        method: "PUT",
        payload: {
          brief: { targetPlatform: "tiktok", topic: "portable blender" },
          scriptText: "Show the problem, then the blender solves it.",
          title: "Portable blender short",
        },
        url: `/api/boards/${board.id}/storyboard`,
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.storyboard.title, "Portable blender short");
      assert.equal(body.storyboard.brief.targetPlatform, "tiktok");
      assert.equal(body.storyboard.brief.locale, "en-US");
      assert.equal(body.storyboard.scriptText, "Show the problem, then the blender solves it.");
    });
  } finally {
    await app.close();
  }
});

test("POST /api/boards/:boardId/storyboard/generate creates generated shots", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(async (user) => {
      const board = await createBoardFor(user.id);
      await prisma.providerSetting.create({
        data: {
          apiKey: "test-key",
          displayName: "Test",
          imageModel: "gpt-image-2",
          provider: "openai-compatible",
          textModel: "gpt-5.5",
          userId: user.id,
        },
      });
      fakeTextResponse = JSON.stringify({
        title: "新品短视频",
        scriptText: "开头制造痛点，结尾引导购买。",
        shots: [
          { durationSec: 2, scene: "厨房台面", action: "手拿产品入镜", caption: "早八也能快速搞定" },
          { durationSec: 4, scene: "杯子特写", action: "液体起泡", caption: "细腻泡沫" },
        ],
      });
      const response = await app.inject({
        headers: { cookie: await sessionCookieFor(user.id) },
        method: "POST",
        payload: {
          brief: { targetPlatform: "douyin", topic: "便携榨汁杯" },
          scriptText: "早八来不及做果汁。",
        },
        url: `/api/boards/${board.id}/storyboard/generate`,
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.storyboard.title, "新品短视频");
      assert.deepEqual(body.storyboard.shots.map((shot) => shot.shotIndex), [1, 2]);
      assert.equal(body.storyboard.shots[0].status, "script_ready");
    });
  } finally {
    await app.close();
  }
});

test("storyboard shot CRUD and reorder persist normalized shots", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(async (user) => {
      const board = await createBoardFor(user.id);
      const asset = await createAssetFor(board.id);
      const cookie = await sessionCookieFor(user.id);
      const first = await app.inject({
        headers: { cookie },
        method: "POST",
        payload: { action: "A", caption: "first", durationSec: 0, startFrameAssetId: asset.id },
        url: `/api/boards/${board.id}/storyboard/shots`,
      });
      const second = await app.inject({
        headers: { cookie },
        method: "POST",
        payload: { action: "B", caption: "second" },
        url: `/api/boards/${board.id}/storyboard/shots`,
      });
      const firstShot = JSON.parse(first.body).shot;
      const secondShot = JSON.parse(second.body).shot;
      assert.equal(firstShot.startFrameAssetId, asset.id);
      assert.equal(firstShot.endFrameAssetId, null);

      const patch = await app.inject({
        headers: { cookie },
        method: "PATCH",
        payload: { endFrameAssetId: asset.id, status: "approved", videoPrompt: "Move from A to B" },
        url: `/api/boards/${board.id}/storyboard/shots/${firstShot.id}`,
      });
      assert.equal(patch.statusCode, 200);
      assert.equal(JSON.parse(patch.body).shot.status, "approved");
      assert.equal(JSON.parse(patch.body).shot.startFrameAssetId, asset.id);
      assert.equal(JSON.parse(patch.body).shot.endFrameAssetId, asset.id);

      const duplicate = await app.inject({
        headers: { cookie },
        method: "POST",
        url: `/api/boards/${board.id}/storyboard/shots/${firstShot.id}/duplicate`,
      });
      assert.equal(duplicate.statusCode, 201);

      const reorderedIds = [secondShot.id, firstShot.id, JSON.parse(duplicate.body).shot.id];
      const reorder = await app.inject({
        headers: { cookie },
        method: "POST",
        payload: { orderedShotIds: reorderedIds },
        url: `/api/boards/${board.id}/storyboard/shots/reorder`,
      });
      assert.equal(reorder.statusCode, 200);
      assert.deepEqual(JSON.parse(reorder.body).storyboard.shots.map((shot) => `${shot.id}:${shot.shotIndex}`), [
        `${secondShot.id}:1`,
        `${firstShot.id}:2`,
        `${JSON.parse(duplicate.body).shot.id}:3`,
      ]);

      const incomplete = await app.inject({
        headers: { cookie },
        method: "POST",
        payload: { orderedShotIds: [firstShot.id] },
        url: `/api/boards/${board.id}/storyboard/shots/reorder`,
      });
      assert.equal(incomplete.statusCode, 400);

      const deleted = await app.inject({
        headers: { cookie },
        method: "DELETE",
        url: `/api/boards/${board.id}/storyboard/shots/${secondShot.id}`,
      });
      assert.equal(deleted.statusCode, 200);
      assert.equal(JSON.parse(deleted.body).storyboard.shots.length, 2);
    });
  } finally {
    await app.close();
  }
});

test("storyboard shot frame asset binding rejects assets from another board", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(async (user) => {
      const board = await createBoardFor(user.id);
      const otherBoard = await createBoardFor(user.id, "其他画板");
      const otherAsset = await createAssetFor(otherBoard.id);
      const cookie = await sessionCookieFor(user.id);
      const create = await app.inject({
        headers: { cookie },
        method: "POST",
        payload: { action: "A", caption: "first" },
        url: `/api/boards/${board.id}/storyboard/shots`,
      });
      const shot = JSON.parse(create.body).shot;

      const patch = await app.inject({
        headers: { cookie },
        method: "PATCH",
        payload: { startFrameAssetId: otherAsset.id },
        url: `/api/boards/${board.id}/storyboard/shots/${shot.id}`,
      });
      assert.equal(patch.statusCode, 400);
      assert.match(JSON.parse(patch.body).error, /Frame asset not found/);
    });
  } finally {
    await app.close();
  }
});

test("POST /api/boards/:boardId/storyboard/shots/:shotId/generate-frame requires a frame prompt", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(async (user) => {
      const board = await createBoardFor(user.id);
      const project = await prisma.storyboardProject.create({
        data: { boardId: board.id, briefJson: JSON.stringify({ targetPlatform: "douyin" }), title: "Frames" },
      });
      const shot = await prisma.storyboardShot.create({
        data: { action: "展示产品", projectId: project.id, shotIndex: 1 },
      });

      const response = await app.inject({
        headers: { cookie: await sessionCookieFor(user.id) },
        method: "POST",
        payload: { frame: "start" },
        url: `/api/boards/${board.id}/storyboard/shots/${shot.id}/generate-frame`,
      });

      assert.equal(response.statusCode, 400);
      assert.match(JSON.parse(response.body).error, /首帧提示词/);
      assert.equal(capturedImageGenerationInputs.length, 0);
    });
  } finally {
    await app.close();
  }
});

test("POST /api/boards/:boardId/storyboard/shots/:shotId/generate-frame rejects shots owned by another user", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(async (owner) => {
      await withTestUser(async (otherUser) => {
        const board = await createBoardFor(owner.id);
        const project = await prisma.storyboardProject.create({
          data: { boardId: board.id, briefJson: JSON.stringify({ targetPlatform: "douyin" }), title: "Frames" },
        });
        const shot = await prisma.storyboardShot.create({
          data: { projectId: project.id, shotIndex: 1, startFramePrompt: "start prompt" },
        });

        const response = await app.inject({
          headers: { cookie: await sessionCookieFor(otherUser.id) },
          method: "POST",
          payload: { frame: "start" },
          url: `/api/boards/${board.id}/storyboard/shots/${shot.id}/generate-frame`,
        });

        assert.equal(response.statusCode, 404);
        assert.equal(capturedImageGenerationInputs.length, 0);
      });
    });
  } finally {
    await app.close();
  }
});

test("POST /api/boards/:boardId/storyboard/shots/:shotId/generate-frame binds generated start frame", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(async (user) => {
      const board = await createBoardFor(user.id);
      const asset = createGeneratedAssetPayload("generated-start", board.id);
      fakeImageGenerationResult = {
        job: createGeneratedJobPayload("job-start", asset, "start prompt"),
        model: "gpt-image-2",
        ok: true,
        results: [asset],
      };
      const project = await prisma.storyboardProject.create({
        data: { boardId: board.id, briefJson: JSON.stringify({ targetPlatform: "douyin" }), title: "Frames" },
      });
      const shot = await prisma.storyboardShot.create({
        data: { projectId: project.id, shotIndex: 1, startFramePrompt: "start prompt" },
      });

      const response = await app.inject({
        headers: { cookie: await sessionCookieFor(user.id) },
        method: "POST",
        payload: { frame: "start", size: "1024x1024" },
        url: `/api/boards/${board.id}/storyboard/shots/${shot.id}/generate-frame`,
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.frame, "start");
      assert.equal(body.asset.id, "generated-start");
      assert.equal(body.job.id, "job-start");
      assert.equal(body.shot.startFrameAssetId, "generated-start");
      assert.equal(body.shot.endFrameAssetId, null);
      assert.equal(body.shot.status, "draft");
      assert.equal(capturedImageGenerationInputs.length, 1);
      assert.equal(capturedImageGenerationInputs[0].generation.prompt, "start prompt");
      assert.equal(capturedImageGenerationInputs[0].paramsMetadata.storyboardFrame.frame, "start");
      assert.equal(capturedImageGenerationInputs[0].paramsMetadata.storyboardFrame.shotId, shot.id);
    });
  } finally {
    await app.close();
  }
});

test("POST /api/boards/:boardId/storyboard/shots/:shotId/generate-frame binds generated end frame and marks frames ready", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(async (user) => {
      const board = await createBoardFor(user.id);
      const startAsset = await createAssetFor(board.id, "existing-start-frame");
      const endAsset = createGeneratedAssetPayload("generated-end", board.id);
      fakeImageGenerationResult = {
        job: createGeneratedJobPayload("job-end", endAsset, "end prompt"),
        model: "gpt-image-2",
        ok: true,
        results: [endAsset],
      };
      const project = await prisma.storyboardProject.create({
        data: { boardId: board.id, briefJson: JSON.stringify({ targetPlatform: "douyin" }), title: "Frames" },
      });
      const shot = await prisma.storyboardShot.create({
        data: {
          endFramePrompt: "end prompt",
          projectId: project.id,
          shotIndex: 1,
          startFrameAssetId: startAsset.id,
          status: "prompts_ready",
        },
      });

      const response = await app.inject({
        headers: { cookie: await sessionCookieFor(user.id) },
        method: "POST",
        payload: { frame: "end" },
        url: `/api/boards/${board.id}/storyboard/shots/${shot.id}/generate-frame`,
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.frame, "end");
      assert.equal(body.shot.startFrameAssetId, startAsset.id);
      assert.equal(body.shot.endFrameAssetId, "generated-end");
      assert.equal(body.shot.status, "frames_ready");
      assert.equal(capturedImageGenerationInputs[0].generation.prompt, "end prompt");
      assert.equal(capturedImageGenerationInputs[0].paramsMetadata.storyboardFrame.frame, "end");
    });
  } finally {
    await app.close();
  }
});

test("POST /api/boards/:boardId/storyboard/shots/:shotId/generate-prompts saves prompts", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(async (user) => {
      const board = await createBoardFor(user.id);
      await prisma.providerSetting.create({
        data: {
          apiKey: "test-key",
          displayName: "Test",
          imageModel: "gpt-image-2",
          provider: "openai-compatible",
          textModel: "gpt-5.5",
          userId: user.id,
        },
      });
      const project = await prisma.storyboardProject.create({
        data: {
          boardId: board.id,
          briefJson: JSON.stringify({ targetPlatform: "douyin", topic: "便携榨汁杯" }),
          scriptText: "展示产品。",
        },
      });
      const shot = await prisma.storyboardShot.create({
        data: { action: "产品从包里拿出", caption: "早八也能喝新鲜果汁", projectId: project.id, shotIndex: 1 },
      });
      fakeTextResponse = JSON.stringify({
        startFramePrompt: "办公室桌面产品特写",
        endFramePrompt: "用户拿起产品露出结果",
        videoPrompt: "镜头从产品推到用户动作",
        notes: ["保持主体一致"],
      });
      const response = await app.inject({
        headers: { cookie: await sessionCookieFor(user.id) },
        method: "POST",
        payload: { overwrite: false },
        url: `/api/boards/${board.id}/storyboard/shots/${shot.id}/generate-prompts`,
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.shot.startFramePrompt, "办公室桌面产品特写");
      assert.equal(body.shot.endFramePrompt, "用户拿起产品露出结果");
      assert.equal(body.shot.videoPrompt, "镜头从产品推到用户动作");
      assert.equal(body.shot.status, "prompts_ready");
    });
  } finally {
    await app.close();
  }
});

test("POST /api/boards/:boardId/storyboard/shots/:shotId/generate-prompts includes bound frame asset context", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(async (user) => {
      const board = await createBoardFor(user.id);
      await prisma.providerSetting.create({
        data: {
          apiKey: "test-key",
          displayName: "Test",
          imageModel: "gpt-image-2",
          provider: "openai-compatible",
          textModel: "gpt-5.5",
          userId: user.id,
        },
      });
      const startAsset = await createAssetFor(board.id, "bound-start-asset");
      const endAsset = await prisma.asset.create({
        data: {
          boardId: board.id,
          height: 1920,
          id: "bound-end-asset",
          kind: "generated",
          mimeType: "image/png",
          publicUrl: "/api/assets/bound-end-asset/file",
          sizeBytes: 128,
          storageKey: `uploads/${board.id}/upload/bound-end-asset.png`,
          tagsJson: JSON.stringify(["产品", "结尾"]),
          width: 1080,
        },
      });
      const project = await prisma.storyboardProject.create({
        data: {
          boardId: board.id,
          briefJson: JSON.stringify({ targetPlatform: "douyin", topic: "便携榨汁杯" }),
          scriptText: "展示产品。",
        },
      });
      const shot = await prisma.storyboardShot.create({
        data: {
          action: "产品从包里拿出",
          caption: "早八也能喝新鲜果汁",
          endFrameAssetId: endAsset.id,
          projectId: project.id,
          shotIndex: 1,
          startFrameAssetId: startAsset.id,
        },
      });
      fakeTextResponse = JSON.stringify({
        startFramePrompt: "办公室桌面产品特写",
        endFramePrompt: "用户拿起产品露出结果",
        videoPrompt: "镜头从产品推到用户动作",
        notes: [],
      });

      const response = await app.inject({
        headers: { cookie: await sessionCookieFor(user.id) },
        method: "POST",
        payload: { overwrite: false },
        url: `/api/boards/${board.id}/storyboard/shots/${shot.id}/generate-prompts`,
      });

      assert.equal(response.statusCode, 200);
      const instruction = capturedTextInstructions.at(-1) ?? "";
      assert.match(instruction, /已绑定首帧参考素材/);
      assert.match(instruction, /bound-start-asset/);
      assert.match(instruction, /已绑定尾帧参考素材/);
      assert.match(instruction, /bound-end-asset/);
      assert.match(instruction, /1080x1920/);
      assert.match(instruction, /标签：产品, 结尾/);
    });
  } finally {
    await app.close();
  }
});

test("POST /api/boards/:boardId/storyboard/shots/:shotId/generate-prompts preserves locked prompts", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(async (user) => {
      const board = await createBoardFor(user.id);
      await prisma.providerSetting.create({
        data: {
          apiKey: "test-key",
          displayName: "Test",
          imageModel: "gpt-image-2",
          provider: "openai-compatible",
          textModel: "gpt-5.5",
          userId: user.id,
        },
      });
      const project = await prisma.storyboardProject.create({
        data: {
          boardId: board.id,
          briefJson: JSON.stringify({ targetPlatform: "douyin", topic: "便携榨汁杯" }),
          scriptText: "展示产品。",
        },
      });
      const shot = await prisma.storyboardShot.create({
        data: {
          action: "产品从包里拿出",
          endFramePrompt: "用户手改尾帧",
          metadataJson: JSON.stringify({
            promptLocks: {
              endFramePrompt: true,
              startFramePrompt: false,
              videoPrompt: false,
            },
          }),
          projectId: project.id,
          shotIndex: 1,
          startFramePrompt: "用户手改首帧",
        },
      });
      fakeTextResponse = JSON.stringify({
        startFramePrompt: "模型首帧",
        endFramePrompt: "模型尾帧",
        videoPrompt: "模型视频提示词",
        notes: [],
      });
      const response = await app.inject({
        headers: { cookie: await sessionCookieFor(user.id) },
        method: "POST",
        payload: { overwrite: false },
        url: `/api/boards/${board.id}/storyboard/shots/${shot.id}/generate-prompts`,
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.shot.startFramePrompt, "用户手改首帧");
      assert.equal(body.shot.endFramePrompt, "用户手改尾帧");
      assert.equal(body.shot.videoPrompt, "模型视频提示词");
      assert.equal(body.shot.status, "prompts_ready");
      assert.deepEqual(body.shot.metadata.promptLocks, {
        startFramePrompt: false,
        endFramePrompt: true,
        videoPrompt: false,
      });
    });
  } finally {
    await app.close();
  }
});

test("POST /api/boards/:boardId/storyboard/shots/generate-prompts fills missing unlocked prompts", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(async (user) => {
      const board = await createBoardFor(user.id);
      await prisma.providerSetting.create({
        data: {
          apiKey: "test-key",
          displayName: "Test",
          imageModel: "gpt-image-2",
          provider: "openai-compatible",
          textModel: "gpt-5.5",
          userId: user.id,
        },
      });
      const project = await prisma.storyboardProject.create({
        data: {
          boardId: board.id,
          briefJson: JSON.stringify({ targetPlatform: "douyin", topic: "便携榨汁杯" }),
          scriptText: "展示产品。",
        },
      });
      await prisma.storyboardShot.create({
        data: {
          action: "镜头一",
          caption: "补齐全部",
          projectId: project.id,
          shotIndex: 1,
        },
      });
      await prisma.storyboardShot.create({
        data: {
          action: "镜头二",
          caption: "保留已有首帧和锁定尾帧",
          endFramePrompt: "锁定尾帧",
          metadataJson: JSON.stringify({ promptLocks: { endFramePrompt: true } }),
          projectId: project.id,
          shotIndex: 2,
          startFramePrompt: "已有首帧",
        },
      });
      await prisma.storyboardShot.create({
        data: {
          action: "镜头三",
          caption: "无需更新",
          endFramePrompt: "已有尾帧",
          projectId: project.id,
          shotIndex: 3,
          startFramePrompt: "已有首帧",
          videoPrompt: "已有视频",
        },
      });
      fakeTextResponses = [
        JSON.stringify({
          startFramePrompt: "模型一首帧",
          endFramePrompt: "模型一尾帧",
          videoPrompt: "模型一视频",
          notes: [],
        }),
        JSON.stringify({
          startFramePrompt: "模型二首帧",
          endFramePrompt: "模型二尾帧",
          videoPrompt: "模型二视频",
          notes: [],
        }),
      ];

      const response = await app.inject({
        headers: { cookie: await sessionCookieFor(user.id) },
        method: "POST",
        payload: { overwrite: false },
        url: `/api/boards/${board.id}/storyboard/shots/generate-prompts`,
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.updatedCount, 2);
      assert.equal(fakeTextResponses.length, 0);
      assert.deepEqual(body.storyboard.shots.map((shot) => shot.startFramePrompt), [
        "模型一首帧",
        "已有首帧",
        "已有首帧",
      ]);
      assert.deepEqual(body.storyboard.shots.map((shot) => shot.endFramePrompt), [
        "模型一尾帧",
        "锁定尾帧",
        "已有尾帧",
      ]);
      assert.deepEqual(body.storyboard.shots.map((shot) => shot.videoPrompt), [
        "模型一视频",
        "模型二视频",
        "已有视频",
      ]);
    });
  } finally {
    await app.close();
  }
});

test("POST /api/boards/:boardId/storyboard/shots/generate-prompts overwrites only unlocked prompts", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(async (user) => {
      const board = await createBoardFor(user.id);
      await prisma.providerSetting.create({
        data: {
          apiKey: "test-key",
          displayName: "Test",
          imageModel: "gpt-image-2",
          provider: "openai-compatible",
          textModel: "gpt-5.5",
          userId: user.id,
        },
      });
      const project = await prisma.storyboardProject.create({
        data: {
          boardId: board.id,
          briefJson: JSON.stringify({ targetPlatform: "douyin", topic: "便携榨汁杯" }),
          scriptText: "展示产品。",
        },
      });
      await prisma.storyboardShot.create({
        data: {
          action: "镜头一",
          caption: "重生成未锁定",
          endFramePrompt: "锁定尾帧",
          metadataJson: JSON.stringify({ promptLocks: { endFramePrompt: true } }),
          projectId: project.id,
          shotIndex: 1,
          startFramePrompt: "旧首帧",
          videoPrompt: "旧视频",
        },
      });
      fakeTextResponse = JSON.stringify({
        startFramePrompt: "新首帧",
        endFramePrompt: "新尾帧",
        videoPrompt: "新视频",
        notes: [],
      });

      const response = await app.inject({
        headers: { cookie: await sessionCookieFor(user.id) },
        method: "POST",
        payload: { overwrite: true },
        url: `/api/boards/${board.id}/storyboard/shots/generate-prompts`,
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.updatedCount, 1);
      assert.equal(body.storyboard.shots[0].startFramePrompt, "新首帧");
      assert.equal(body.storyboard.shots[0].endFramePrompt, "锁定尾帧");
      assert.equal(body.storyboard.shots[0].videoPrompt, "新视频");
    });
  } finally {
    await app.close();
  }
});

test("GET /api/boards/:boardId/storyboard/export.md returns markdown", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(async (user) => {
      const board = await createBoardFor(user.id, "导出画板");
      await createAssetFor(board.id, "asset-start-md");
      await prisma.asset.create({
        data: {
          boardId: board.id,
          height: 1920,
          id: "asset-end-md",
          kind: "generated",
          mimeType: "image/png",
          publicUrl: "/api/assets/asset-end-md/file",
          sizeBytes: 128,
          storageKey: `uploads/${board.id}/upload/asset-end-md.png`,
          tagsJson: JSON.stringify(["收尾", "产品"]),
          width: 1080,
        },
      });
      const project = await prisma.storyboardProject.create({
        data: {
          boardId: board.id,
          briefJson: JSON.stringify({ targetPlatform: "douyin", topic: "便携榨汁杯" }),
          scriptText: "展示产品。",
          title: "导出标题",
        },
      });
      await prisma.storyboardShot.create({
        data: {
          action: "展示产品",
          caption: "快速清洗",
          endFrameAssetId: "asset-end-md",
          projectId: project.id,
          shotIndex: 1,
          startFrameAssetId: "asset-start-md",
          videoPrompt: "平移镜头",
        },
      });

      const response = await app.inject({
        headers: { cookie: await sessionCookieFor(user.id) },
        method: "GET",
        url: `/api/boards/${board.id}/storyboard/export.md`,
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.headers["content-type"].includes("text/markdown"), true);
      assert.match(response.body, /# 导出画板/);
      assert.match(response.body, /## 分镜/);
      assert.match(response.body, /- 首帧素材: asset-start-md \| upload \| \/api\/assets\/asset-start-md\/file/);
      assert.match(response.body, /- 尾帧素材: asset-end-md \| generated \| 1080x1920 \| \/api\/assets\/asset-end-md\/file \| tags=收尾\/产品/);
      assert.match(response.body, /平移镜头/);
    });
  } finally {
    await app.close();
  }
});

test("GET /api/boards/:boardId/storyboard/export.json returns structured payload", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(async (user) => {
      const board = await createBoardFor(user.id, "JSON 导出画板");
      await createAssetFor(board.id, "json-start-asset");
      const project = await prisma.storyboardProject.create({
        data: {
          boardId: board.id,
          briefJson: JSON.stringify({ targetPlatform: "tiktok", topic: "portable blender" }),
          scriptText: "Show the product.",
          title: "Export title",
        },
      });
      await prisma.storyboardShot.create({
        data: {
          action: "Show product",
          caption: "Fast cleanup",
          projectId: project.id,
          shotIndex: 1,
          startFrameAssetId: "json-start-asset",
          videoPrompt: "Push in",
        },
      });

      const response = await app.inject({
        headers: { cookie: await sessionCookieFor(user.id) },
        method: "GET",
        url: `/api/boards/${board.id}/storyboard/export.json`,
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.headers["content-type"].includes("application/json"), true);
      assert.equal(response.headers["content-disposition"].includes("-storyboard.json"), true);
      const body = JSON.parse(response.body);
      assert.equal(body.boardName, "JSON 导出画板");
      assert.equal(body.storyboard.title, "Export title");
      assert.equal(body.storyboard.brief.targetPlatform, "tiktok");
      assert.equal(body.storyboard.shots[0].videoPrompt, "Push in");
      assert.equal(body.frameAssets[0].id, "json-start-asset");
      assert.equal(body.frameAssets[0].publicUrl, "/api/assets/json-start-asset/file");
      assert.equal(typeof body.exportedAt, "string");
    });
  } finally {
    await app.close();
  }
});

test("GET /api/boards/:boardId/storyboard/export.csv returns shot table", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(async (user) => {
      const board = await createBoardFor(user.id, "CSV 导出画板");
      await prisma.asset.create({
        data: {
          boardId: board.id,
          height: 1024,
          id: "asset-start-csv",
          kind: "upload",
          mimeType: "image/png",
          publicUrl: "/api/assets/asset-start-csv/file",
          sizeBytes: 256,
          storageKey: `uploads/${board.id}/upload/asset-start-csv.png`,
          tagsJson: JSON.stringify(["首帧"]),
          width: 1024,
        },
      });
      await createAssetFor(board.id, "asset-end-csv");
      const project = await prisma.storyboardProject.create({
        data: {
          boardId: board.id,
          briefJson: JSON.stringify({ targetPlatform: "douyin", topic: "便携榨汁杯" }),
          scriptText: "展示产品。",
          title: "导出标题",
        },
      });
      await prisma.storyboardShot.create({
        data: {
          action: "展示, 产品",
          caption: "快速清洗",
          endFrameAssetId: "asset-end-csv",
          projectId: project.id,
          shotIndex: 1,
          startFrameAssetId: "asset-start-csv",
          startFramePrompt: '带有 "高光" 的产品特写',
          videoPrompt: "平移镜头",
        },
      });

      const response = await app.inject({
        headers: { cookie: await sessionCookieFor(user.id) },
        method: "GET",
        url: `/api/boards/${board.id}/storyboard/export.csv`,
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.headers["content-type"].includes("text/csv"), true);
      assert.equal(response.headers["content-disposition"].includes("-storyboard.csv"), true);
      assert.match(response.body, /^shotIndex,durationSec,status,scene,camera,action,dialogue,caption,audio,startFrameAssetId,startFrameAssetUrl,startFrameAssetMeta,endFrameAssetId,endFrameAssetUrl,endFrameAssetMeta,/);
      assert.match(response.body, /asset-start-csv,\/api\/assets\/asset-start-csv\/file,upload \| image\/png \| 1024x1024 \| 256 bytes \| tags=首帧,asset-end-csv,\/api\/assets\/asset-end-csv\/file/);
      assert.match(response.body, /"展示, 产品"/);
      assert.match(response.body, /"带有 ""高光"" 的产品特写"/);
      assert.match(response.body, /平移镜头/);
    });
  } finally {
    await app.close();
  }
});
