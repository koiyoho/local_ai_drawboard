import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before, beforeEach } from "node:test";

const appModuleUrl = new URL("../dist/server/server/app.js", import.meta.url);
const prismaModuleUrl = new URL("../dist/server/src/lib/prisma.js", import.meta.url);
const authModuleUrl = new URL("../dist/server/server/auth.js", import.meta.url);

let tempDir;
let previousAuthSecret;
let previousCwd;
let previousDatabaseUrl;
let prisma;

before(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "admin-asset-integrity-test-"));
  previousAuthSecret = process.env.AUTH_SECRET;
  previousCwd = process.cwd();
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.AUTH_SECRET = "admin-asset-integrity-test-secret";
  process.env.DATABASE_URL = `file:${path.join(tempDir, "test.db")}`;
  process.chdir(tempDir);
  ({ prisma } = await import(prismaModuleUrl));
  await initializeDatabase(prisma);
});

beforeEach(async () => {
  await prisma.user.deleteMany();
  await rm(path.join(tempDir, "public"), { force: true, recursive: true });
});

after(async () => {
  process.chdir(previousCwd);
  if (prisma) {
    await prisma.$disconnect();
  }
  if (previousAuthSecret === undefined) {
    delete process.env.AUTH_SECRET;
  } else {
    process.env.AUTH_SECRET = previousAuthSecret;
  }
  if (previousDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = previousDatabaseUrl;
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

async function sessionCookieFor(userId) {
  const { signSession } = await import(authModuleUrl);
  const now = Date.now();
  return `ai_board_session=${signSession({
    expiresAt: now + 60_000,
    issuedAt: now,
    userId,
  })}`;
}

async function createUser({ role, username }) {
  return prisma.user.create({
    data: {
      canUseAdminProvider: role === "admin",
      generationFiveHourLimit: 10,
      generationLimit: 30,
      name: username,
      role,
      status: "approved",
      username,
    },
  });
}

async function seedAssetState() {
  const admin = await createUser({ role: "admin", username: "koiyoho" });
  const user = await createUser({ role: "user", username: "asset-owner" });
  const board = await prisma.board.create({ data: { name: "客户主视觉", userId: user.id } });
  const existingStorageKey = "uploads/board-a/generated/existing.png";
  const missingStorageKey = "uploads/board-a/generated/missing.png";
  await mkdir(path.join(tempDir, "public", "uploads", "board-a", "generated"), { recursive: true });
  await writeFile(path.join(tempDir, "public", existingStorageKey), Buffer.from("existing"));
  const existingAsset = await prisma.asset.create({
    data: {
      boardId: board.id,
      kind: "generated",
      mimeType: "image/png",
      publicUrl: "/api/assets/existing/file",
      sizeBytes: 8,
      storageKey: existingStorageKey,
    },
  });
  const missingAsset = await prisma.asset.create({
    data: {
      boardId: board.id,
      kind: "upload",
      mimeType: "image/png",
      publicUrl: "/api/assets/missing/file",
      sizeBytes: 12,
      storageKey: missingStorageKey,
    },
  });
  const job = await prisma.generationJob.create({
    data: {
      boardId: board.id,
      mode: "inpaint",
      prompt: "修复缺失素材引用",
      provider: "openai-compatible",
      sourceAssetId: missingAsset.id,
      status: "succeeded",
    },
  });
  await prisma.generationResult.create({ data: { assetId: missingAsset.id, jobId: job.id } });
  return { admin, board, existingAsset, job, missingAsset, user };
}

test("GET /api/admin/asset-integrity requires admin access", async () => {
  const app = await createTestApp();
  try {
    const { user } = await seedAssetState();
    const response = await app.inject({
      headers: { cookie: await sessionCookieFor(user.id) },
      method: "GET",
      url: "/api/admin/asset-integrity",
    });
    assert.equal(response.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("GET /api/admin/asset-integrity reports missing asset rows without absolute paths", async () => {
  const app = await createTestApp();
  try {
    const { admin, board, missingAsset, user } = await seedAssetState();
    const response = await app.inject({
      headers: { cookie: await sessionCookieFor(admin.id) },
      method: "GET",
      url: "/api/admin/asset-integrity",
    });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.report.totalAssetCount, 2);
    assert.equal(body.report.missingAssetCount, 1);
    assert.equal(body.report.missingAssets[0].id, missingAsset.id);
    assert.equal(body.report.missingAssets[0].boardId, board.id);
    assert.equal(body.report.missingAssets[0].boardName, "客户主视觉");
    assert.equal(body.report.missingAssets[0].username, user.username);
    assert.equal(body.report.missingAssets[0].storageKey, "uploads/board-a/generated/missing.png");
    assert.equal(JSON.stringify(body).includes(tempDir), false);
  } finally {
    await app.close();
  }
});

test("POST /api/admin/asset-integrity/cleanup removes only still-missing asset rows", async () => {
  const app = await createTestApp();
  try {
    const { admin, existingAsset, job, missingAsset } = await seedAssetState();
    const response = await app.inject({
      body: { assetIds: [existingAsset.id, missingAsset.id] },
      headers: { cookie: await sessionCookieFor(admin.id) },
      method: "POST",
      url: "/api/admin/asset-integrity/cleanup",
    });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.deepEqual(body.cleanedAssetIds, [missingAsset.id]);
    assert.equal(body.skippedAssetIds.includes(existingAsset.id), true);
    assert.equal(await prisma.asset.findUnique({ where: { id: missingAsset.id } }), null);
    assert.notEqual(await prisma.asset.findUnique({ where: { id: existingAsset.id } }), null);
    const updatedJob = await prisma.generationJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(updatedJob.sourceAssetId, null);
    assert.equal(await prisma.generationResult.count({ where: { assetId: missingAsset.id } }), 0);
  } finally {
    await app.close();
  }
});
