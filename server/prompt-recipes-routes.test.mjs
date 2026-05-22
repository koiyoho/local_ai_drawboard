import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
  tempDir = await mkdtemp(path.join(tmpdir(), "prompt-recipes-routes-test-"));
  previousDatabaseUrl = process.env.DATABASE_URL;
  previousAuthSecret = process.env.AUTH_SECRET;
  process.env.DATABASE_URL = `file:${path.join(tempDir, "test.db")}`;
  process.env.AUTH_SECRET = "prompt-recipe-route-test-secret";
  ({ prisma } = await import(prismaModuleUrl));
  await initializeDatabase(prisma);
});

beforeEach(async () => {
  await prisma.user.deleteMany();
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
  "name" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'auto',
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
CREATE TABLE "PromptRecipe" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "paramsJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PromptRecipe_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`);
}

async function createUser(username) {
  return prisma.user.create({
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

test("prompt recipes can be created, listed, duplicated, and deleted for the current user", async () => {
  const app = await createTestApp();
  try {
    const user = await createUser("recipe-owner");
    const otherUser = await createUser("recipe-other");
    const cookie = await sessionCookieFor(user.id);
    await prisma.promptRecipe.create({
      data: {
        mode: "text_to_image",
        name: "Other recipe",
        paramsJson: JSON.stringify({ size: "1024x1024" }),
        prompt: "Hidden",
        userId: otherUser.id,
      },
    });

    const createResponse = await app.inject({
      body: {
        mode: "inpaint",
        name: "人物换装",
        params: {
          artStyle: "realistic",
          count: 2,
          referenceRoles: ["clothing"],
          size: "2048x1152",
        },
        prompt: "保持人物姿态，只替换上衣",
      },
      headers: { cookie },
      method: "POST",
      url: "/api/prompt-recipes",
    });
    assert.equal(createResponse.statusCode, 201);
    const created = JSON.parse(createResponse.body).recipe;
    assert.equal(created.name, "人物换装");
    assert.equal(created.mode, "inpaint");
    assert.deepEqual(created.params.referenceRoles, ["clothing"]);

    const listResponse = await app.inject({
      headers: { cookie },
      method: "GET",
      url: "/api/prompt-recipes",
    });
    assert.equal(listResponse.statusCode, 200);
    const listBody = JSON.parse(listResponse.body);
    assert.deepEqual(listBody.recipes.map((recipe) => recipe.name), ["人物换装"]);

    const duplicateResponse = await app.inject({
      body: { name: "人物换装副本" },
      headers: { cookie },
      method: "POST",
      url: `/api/prompt-recipes/${created.id}/duplicate`,
    });
    assert.equal(duplicateResponse.statusCode, 201);
    assert.equal(JSON.parse(duplicateResponse.body).recipe.name, "人物换装副本");

    const deleteResponse = await app.inject({
      headers: { cookie },
      method: "DELETE",
      url: `/api/prompt-recipes/${created.id}`,
    });
    assert.equal(deleteResponse.statusCode, 200);

    const remaining = await prisma.promptRecipe.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    assert.deepEqual(remaining.map((recipe) => recipe.name), ["人物换装副本"]);
  } finally {
    await app.close();
  }
});

test("prompt recipe names and params are validated before persistence", async () => {
  const app = await createTestApp();
  try {
    const user = await createUser("recipe-validator");
    const cookie = await sessionCookieFor(user.id);
    const response = await app.inject({
      body: {
        mode: "text_to_image",
        name: " ",
        params: "not-object",
        prompt: "",
      },
      headers: { cookie },
      method: "POST",
      url: "/api/prompt-recipes",
    });

    assert.equal(response.statusCode, 400);
    assert.equal(await prisma.promptRecipe.count({ where: { userId: user.id } }), 0);
  } finally {
    await app.close();
  }
});
