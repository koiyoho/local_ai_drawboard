import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before, beforeEach } from "node:test";

const prismaModuleUrl = new URL("../dist/server/src/lib/prisma.js", import.meta.url);
const videoGenerationServiceModuleUrl = new URL("../dist/server/server/video-generation-service.js", import.meta.url);

let tempDir;
let previousDatabaseUrl;
let previousPollInterval;
let previousMaxPollAttempts;
let prisma;

before(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "video-generation-service-test-"));
  previousDatabaseUrl = process.env.DATABASE_URL;
  previousPollInterval = process.env.VIDEO_GENERATION_POLL_INTERVAL_MS;
  previousMaxPollAttempts = process.env.VIDEO_GENERATION_MAX_POLL_ATTEMPTS;
  process.env.DATABASE_URL = `file:${path.join(tempDir, "test.db")}`;
  process.env.VIDEO_GENERATION_POLL_INTERVAL_MS = "1";
  process.env.VIDEO_GENERATION_MAX_POLL_ATTEMPTS = "2";
  ({ prisma } = await import(prismaModuleUrl));
  await initializeDatabase(prisma);
});

beforeEach(async () => {
  await prisma.user.deleteMany();
});

after(async () => {
  if (prisma) await prisma.$disconnect();
  restoreEnv("DATABASE_URL", previousDatabaseUrl);
  restoreEnv("VIDEO_GENERATION_POLL_INTERVAL_MS", previousPollInterval);
  restoreEnv("VIDEO_GENERATION_MAX_POLL_ATTEMPTS", previousMaxPollAttempts);
  if (tempDir) await rm(tempDir, { force: true, recursive: true });
});

async function initializeDatabase(prisma) {
  await prisma.$executeRawUnsafe(`PRAGMA foreign_keys = ON`);
  await prisma.$executeRawUnsafe(`
CREATE TABLE "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "username" TEXT,
  "passwordHash" TEXT,
  "role" TEXT NOT NULL DEFAULT 'user',
  "status" TEXT NOT NULL DEFAULT 'approved',
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
  CONSTRAINT "GenerationJob_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "Asset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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

test("video generation falls back to CLIProxyAPI video endpoints with data URI references", async () => {
  const user = await prisma.user.create({
    data: {
      name: "Video generation user",
      role: "user",
      status: "approved",
      username: `video-generation-user-${Date.now()}`,
    },
  });
  const board = await prisma.board.create({ data: { name: "Video board", userId: user.id } });
  const assetBytes = Buffer.from("reference-image");
  const storageKey = `uploads/${board.id}/upload/reference.png`;
  const assetPath = path.join(process.cwd(), "public", storageKey);
  await mkdir(path.dirname(assetPath), { recursive: true });
  await writeFile(assetPath, assetBytes);
  const referenceAsset = await prisma.asset.create({
    data: {
      boardId: board.id,
      height: 16,
      kind: "upload",
      mimeType: "image/png",
      publicUrl: "/api/assets/reference/file",
      sizeBytes: assetBytes.byteLength,
      storageKey,
      width: 16,
    },
  });
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const pathname = new URL(String(url)).pathname;
    calls.push({ body: parseJsonBody(init.body), headers: init.headers, method: init.method, url: String(url) });
    if (pathname === "/v1/videos") {
      return Response.json({ error: { message: "not found" } }, { status: 404 });
    }
    if (pathname === "/v1/videos/generations") {
      return Response.json({ id: "video-job-1", status: "queued" });
    }
    if (pathname === "/v1/videos/video-job-1") {
      return Response.json({ id: "video-job-1", metadata: { url: "https://cdn.example.test/generated.mp4" }, status: "completed" });
    }
    if (String(url) === "https://cdn.example.test/generated.mp4") {
      return new Response(Buffer.from("video-bytes"), { headers: { "content-type": "video/mp4" }, status: 200 });
    }
    return Response.json({ error: "unexpected request" }, { status: 500 });
  };

  try {
    const { createAndRunVideoGenerationJob } = await import(videoGenerationServiceModuleUrl);
    const result = await createAndRunVideoGenerationJob({
      boardId: board.id,
      boardName: board.name,
      model: "grok-imagine-video",
      prompt: "让产品旋转展示",
      videoOptions: {
        aspectRatio: "2:3",
        durationSec: 10,
        resolution: "480p",
      },
      providerSetting: {
        apiKey: "provider-secret",
        baseUrl: "https://provider.example.test/v1",
        displayName: "CLIProxyAPI",
        enabled: true,
        id: "provider-setting-id",
        imageModel: "gpt-image-2",
        provider: "openai-compatible",
        scriptWritingModel: null,
        textModel: "gpt-5.5",
        userId: user.id,
        videoModel: "grok-imagine-video",
        createdAt: new Date(),
        updatedAt: new Date(),
        enabledImageModels: null,
        enabledReversePromptModels: null,
        enabledScriptWritingModels: null,
        enabledVideoModels: null,
      },
      referenceAssetIds: [referenceAsset.id],
      user,
    });

    assert.equal(result.ok, true, result.error);
    assert.equal(result.asset.mimeType, "video/mp4");
    assert.equal(result.providerJobId, "video-job-1");
    const fallbackCall = calls.find((call) => call.url === "https://provider.example.test/v1/videos/generations");
    assert.ok(fallbackCall);
    assert.equal(fallbackCall.body.model, "grok-imagine-video");
    assert.equal(fallbackCall.body.duration, 10);
    assert.equal(fallbackCall.body.resolution, "480p");
    assert.equal(fallbackCall.body.aspect_ratio, "2:3");
    assert.deepEqual(fallbackCall.body.image, { url: `data:image/png;base64,${assetBytes.toString("base64")}` });
    const downloadCall = calls.find((call) => call.url === "https://cdn.example.test/generated.mp4");
    assert.ok(downloadCall);
    assert.equal(JSON.stringify(downloadCall.headers ?? {}).includes("provider-secret"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("video generation sends multiple references as CLIProxyAPI reference-to-video images", async () => {
  const user = await prisma.user.create({
    data: {
      name: "CLIProxy reference video user",
      role: "user",
      status: "approved",
      username: `cliproxy-reference-video-user-${Date.now()}`,
    },
  });
  const board = await prisma.board.create({ data: { name: "CLIProxy reference video board", userId: user.id } });
  const firstAssetBytes = Buffer.from("cliproxy-first-frame-image");
  const firstStorageKey = `uploads/${board.id}/upload/cliproxy-first-frame.png`;
  const firstAssetPath = path.join(process.cwd(), "public", firstStorageKey);
  await mkdir(path.dirname(firstAssetPath), { recursive: true });
  await writeFile(firstAssetPath, firstAssetBytes);
  const firstReferenceAsset = await prisma.asset.create({
    data: {
      boardId: board.id,
      height: 16,
      kind: "upload",
      mimeType: "image/png",
      publicUrl: "/api/assets/cliproxy-reference/file",
      sizeBytes: firstAssetBytes.byteLength,
      storageKey: firstStorageKey,
      width: 16,
    },
  });
  const secondAssetBytes = Buffer.from("cliproxy-continuity-reference-image");
  const secondStorageKey = `uploads/${board.id}/upload/cliproxy-continuity-reference.png`;
  const secondAssetPath = path.join(process.cwd(), "public", secondStorageKey);
  await writeFile(secondAssetPath, secondAssetBytes);
  const secondReferenceAsset = await prisma.asset.create({
    data: {
      boardId: board.id,
      height: 16,
      kind: "upload",
      mimeType: "image/png",
      publicUrl: "/api/assets/cliproxy-continuity-reference/file",
      sizeBytes: secondAssetBytes.byteLength,
      storageKey: secondStorageKey,
      width: 16,
    },
  });
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const pathname = new URL(String(url)).pathname;
    calls.push({ body: parseJsonBody(init.body), headers: init.headers, method: init.method, url: String(url) });
    if (pathname === "/v1/videos") {
      return Response.json({ id: "direct-video-job-without-reference", status: "queued" });
    }
    if (pathname === "/v1/videos/generations") {
      return Response.json({ request_id: "cliproxy-reference-video-job-1", status: "queued" });
    }
    if (pathname === "/v1/videos/cliproxy-reference-video-job-1") {
      return Response.json({
        request_id: "cliproxy-reference-video-job-1",
        status: "done",
        video: { url: "https://cdn.example.test/cliproxy-reference-video.mp4" },
      });
    }
    if (String(url) === "https://cdn.example.test/cliproxy-reference-video.mp4") {
      return new Response(Buffer.from("cliproxy-reference-video-bytes"), { headers: { "content-type": "video/mp4" }, status: 200 });
    }
    return Response.json({ error: "unexpected request" }, { status: 500 });
  };

  try {
    const { createAndRunVideoGenerationJob } = await import(videoGenerationServiceModuleUrl);
    const result = await createAndRunVideoGenerationJob({
      boardId: board.id,
      boardName: board.name,
      model: "grok-imagine-video",
      prompt: "使用参考帧中的产品生成短视频",
      providerSetting: {
        apiKey: "provider-secret",
        baseUrl: "https://provider.example.test/v1",
        cliProxyApiKey: "cliproxy-secret",
        cliProxyBaseUrl: "https://cliproxy.example.test/v1",
        displayName: "Third Party",
        enabled: true,
        id: "provider-setting-id",
        imageModel: "gpt-image-2",
        provider: "openai-compatible",
        scriptWritingModel: null,
        textModel: "gpt-5.5",
        userId: user.id,
        videoModel: "grok-imagine-video",
        createdAt: new Date(),
        updatedAt: new Date(),
        enabledImageModels: null,
        enabledReversePromptModels: null,
        enabledScriptWritingModels: null,
        enabledVideoModels: JSON.stringify([
          { channel: "cliproxy", enabled: true, id: "grok-imagine-video", label: "Grok Imagine Video" },
        ]),
      },
      referenceMode: "reference_images",
      referenceAssetIds: [firstReferenceAsset.id, secondReferenceAsset.id],
      user,
      videoOptions: {
        aspectRatio: "16:9",
        durationSec: 6,
        resolution: "720p",
      },
    });

    assert.equal(result.ok, true, result.error);
    assert.equal(result.providerJobId, "cliproxy-reference-video-job-1");
    assert.equal(calls.some((call) => call.url === "https://provider.example.test/v1/videos"), false);
    assert.equal(calls.some((call) => call.url === "https://cliproxy.example.test/v1/videos"), false);
    const videoCall = calls.find((call) => call.url === "https://cliproxy.example.test/v1/videos/generations");
    assert.ok(videoCall);
    assert.equal(videoCall.body.prompt, "使用参考帧中的产品生成短视频");
    assert.equal(videoCall.body.image, undefined);
    assert.deepEqual(videoCall.body.reference_images, [
      { url: `data:image/png;base64,${firstAssetBytes.toString("base64")}` },
      { url: `data:image/png;base64,${secondAssetBytes.toString("base64")}` },
    ]);
    assert.equal(calls.some((call) => call.url === "https://cliproxy.example.test/v1/videos/cliproxy-reference-video-job-1"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("video generation handles CLIProxyAPI request ids and done video payloads", async () => {
  const user = await prisma.user.create({
    data: {
      name: "CLIProxy video generation user",
      role: "user",
      status: "approved",
      username: `cliproxy-video-generation-user-${Date.now()}`,
    },
  });
  const board = await prisma.board.create({ data: { name: "CLIProxy video board", userId: user.id } });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const pathname = new URL(String(url)).pathname;
    if (pathname === "/v1/videos") {
      return Response.json({ error: { message: "not found" } }, { status: 404 });
    }
    if (pathname === "/v1/videos/generations") {
      return Response.json({ request_id: "cliproxy-video-request-1" });
    }
    if (pathname === "/v1/videos/cliproxy-video-request-1") {
      return Response.json({
        model: "grok-imagine-video",
        progress: 100,
        status: "done",
        video: {
          duration: 3,
          url: "https://cdn.example.test/cliproxy-video.mp4",
        },
      });
    }
    if (String(url) === "https://cdn.example.test/cliproxy-video.mp4") {
      return new Response(Buffer.from("cliproxy-video-bytes"), { headers: { "content-type": "video/mp4" }, status: 200 });
    }
    return Response.json({ error: "unexpected request" }, { status: 500 });
  };

  try {
    const { createAndRunVideoGenerationJob } = await import(videoGenerationServiceModuleUrl);
    const result = await createAndRunVideoGenerationJob({
      boardId: board.id,
      boardName: board.name,
      model: "grok-imagine-video",
      prompt: "cliproxy video provider job",
      providerSetting: {
        apiKey: "provider-secret",
        baseUrl: "https://provider.example.test/v1",
        displayName: "CLIProxyAPI",
        enabled: true,
        id: "provider-setting-id",
        imageModel: "gpt-image-2",
        provider: "openai-compatible",
        scriptWritingModel: null,
        textModel: "gpt-5.5",
        userId: user.id,
        videoModel: "grok-imagine-video",
        createdAt: new Date(),
        updatedAt: new Date(),
        enabledImageModels: null,
        enabledReversePromptModels: null,
        enabledScriptWritingModels: null,
        enabledVideoModels: null,
      },
      user,
    });

    assert.equal(result.ok, true, result.error);
    assert.equal(result.providerJobId, "cliproxy-video-request-1");
    assert.equal(result.asset.mimeType, "video/mp4");
    assert.ok(calls.includes("https://provider.example.test/v1/videos/cliproxy-video-request-1"));
    const job = await prisma.generationJob.findFirstOrThrow({ where: { boardId: board.id } });
    const params = JSON.parse(job.paramsJson);
    assert.equal(params.providerJobId, "cliproxy-video-request-1");
    assert.equal(params.providerStatus, "done");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("video generation keeps cancelled jobs cancelled after provider completion", async () => {
  const user = await prisma.user.create({
    data: {
      name: "Cancelled video generation user",
      role: "user",
      status: "approved",
      username: `cancelled-video-generation-user-${Date.now()}`,
    },
  });
  const board = await prisma.board.create({ data: { name: "Cancelled video board", userId: user.id } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname === "/v1/videos/generations") {
      return Response.json({ request_id: "cancelled-video-request-1" });
    }
    if (pathname === "/v1/videos/cancelled-video-request-1") {
      await prisma.generationJob.updateMany({
        data: { errorMessage: "用户已中止生成任务", status: "cancelled" },
        where: { boardId: board.id },
      });
      return Response.json({
        request_id: "cancelled-video-request-1",
        status: "done",
        video: { url: "https://cdn.example.test/cancelled-video.mp4" },
      });
    }
    if (String(url) === "https://cdn.example.test/cancelled-video.mp4") {
      return new Response(Buffer.from("cancelled-video-bytes"), { headers: { "content-type": "video/mp4" }, status: 200 });
    }
    return Response.json({ error: "unexpected request" }, { status: 500 });
  };

  try {
    const { createAndRunVideoGenerationJob } = await import(videoGenerationServiceModuleUrl);
    const result = await createAndRunVideoGenerationJob({
      boardId: board.id,
      boardName: board.name,
      model: "grok-imagine-video",
      prompt: "cancelled video provider job",
      providerSetting: {
        apiKey: "cliproxy-secret",
        baseUrl: "https://cliproxy.example.test/v1",
        cliProxyApiKey: "cliproxy-secret",
        cliProxyBaseUrl: "https://cliproxy.example.test/v1",
        displayName: "CLIProxyAPI",
        enabled: true,
        id: "provider-setting-id",
        imageModel: "gpt-image-2",
        provider: "openai-compatible",
        scriptWritingModel: null,
        textModel: "gpt-5.5",
        userId: user.id,
        videoModel: "cliproxy:grok-imagine-video",
        createdAt: new Date(),
        updatedAt: new Date(),
        enabledImageModels: null,
        enabledReversePromptModels: null,
        enabledScriptWritingModels: null,
        enabledVideoModels: JSON.stringify([
          { channel: "cliproxy", enabled: true, id: "grok-imagine-video", label: "Grok Imagine Video" },
        ]),
      },
      user,
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /已中止/);
    const job = await prisma.generationJob.findFirstOrThrow({ where: { boardId: board.id } });
    assert.equal(job.status, "cancelled");
    const resultCount = await prisma.generationResult.count({ where: { jobId: job.id } });
    assert.equal(resultCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function parseJsonBody(body) {
  if (typeof body !== "string") return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}
