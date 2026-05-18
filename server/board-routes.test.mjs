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
  tempDir = await mkdtemp(path.join(tmpdir(), "board-routes-test-"));
  previousDatabaseUrl = process.env.DATABASE_URL;
  previousAuthSecret = process.env.AUTH_SECRET;
  process.env.DATABASE_URL = `file:${path.join(tempDir, "test.db")}`;
  process.env.AUTH_SECRET = "board-route-test-secret";
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
  "name" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'auto',
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

async function withTestUser(prisma, fn) {
  const username = `board-route-user-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

test("GET /api/boards/recent returns no_board without creating a board", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(prisma, async (user) => {
      const cookie = await sessionCookieFor(user.id);
      const response = await app.inject({
        headers: { cookie },
        method: "GET",
        url: "/api/boards/recent",
      });

      assert.equal(response.statusCode, 404);
      assert.deepEqual(JSON.parse(response.body), { error: "no_board" });
      assert.equal(await prisma.board.count({ where: { userId: user.id } }), 0);
    });
  } finally {
    await app.close();
  }
});

test("POST /api/boards/ensure-recent creates a default board when none exists", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(prisma, async (user) => {
      const cookie = await sessionCookieFor(user.id);
      const response = await app.inject({
        headers: { cookie },
        method: "POST",
        url: "/api/boards/ensure-recent",
      });

      assert.equal(response.statusCode, 201);
      const body = JSON.parse(response.body);
      assert.equal(body.board.name, "未命名画板");
      assert.deepEqual(body.board._count, { assets: 0, jobs: 0 });
      assert.equal(await prisma.board.count({ where: { userId: user.id } }), 1);
    });
  } finally {
    await app.close();
  }
});

test("GET /api/board-templates returns static templates without authentication", async () => {
  const app = await createTestApp();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/board-templates",
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.ok(body.templates.length >= 6);
    assert.ok(body.templates.some((template) => template.id === "ecommerce-main"));
    assert.ok(body.templates.every((template) => template.name && template.snapshot && template.defaultPrompt));
  } finally {
    await app.close();
  }
});

test("POST /api/boards creates a board from a template snapshot and prompt", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(prisma, async (user) => {
      const cookie = await sessionCookieFor(user.id);
      const response = await app.inject({
        body: { name: "商品主图项目", templateId: "ecommerce-main" },
        headers: { cookie },
        method: "POST",
        url: "/api/boards",
      });

      assert.equal(response.statusCode, 201);
      const body = JSON.parse(response.body);
      assert.equal(body.board.name, "商品主图项目");
      const persisted = await prisma.board.findUniqueOrThrow({ where: { id: body.board.id } });
      const snapshot = JSON.parse(persisted.snapshotJson);
      assert.equal(snapshot.app.sourcePrompt.includes("商品"), true);
      assert.equal(snapshot.app.boardDocument.pages[0].objects.some((object) => object.type === "text"), true);
      const snapshotCount = await prisma.boardSnapshot.count({ where: { boardId: body.board.id, kind: "manual" } });
      assert.equal(snapshotCount, 1);
    });
  } finally {
    await app.close();
  }
});

test("GET /api/boards/:boardId includes formatted storyboard payload", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(prisma, async (user) => {
      const board = await prisma.board.create({ data: { name: "Storyboard board", userId: user.id } });
      const project = await prisma.storyboardProject.create({
        data: {
          boardId: board.id,
          briefJson: JSON.stringify({ targetPlatform: "tiktok", topic: "portable blender" }),
          scriptText: "Show the blender.",
          title: "Storyboard",
        },
      });
      await prisma.storyboardShot.create({
        data: {
          action: "Show blender",
          caption: "Blend anywhere",
          metadataJson: JSON.stringify({ source: "test" }),
          projectId: project.id,
          shotIndex: 1,
          videoPrompt: "Push in",
        },
      });

      const response = await app.inject({
        headers: { cookie: await sessionCookieFor(user.id) },
        method: "GET",
        url: `/api/boards/${board.id}`,
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.board.storyboardProject.title, "Storyboard");
      assert.equal(body.board.storyboardProject.brief.targetPlatform, "tiktok");
      assert.equal(body.board.storyboardProject.brief.locale, "en-US");
      assert.equal(body.board.storyboardProject.shots[0].metadata.source, "test");
      assert.equal(body.board.storyboardProject.shots[0].startFrameAssetId, null);
      assert.equal(body.board.storyboardProject.shots[0].endFrameAssetId, null);
      assert.equal(body.board.storyboardProject.shots[0].videoPrompt, "Push in");
      assert.equal("briefJson" in body.board.storyboardProject, false);
      assert.equal("metadataJson" in body.board.storyboardProject.shots[0], false);
    });
  } finally {
    await app.close();
  }
});

test("POST /api/boards/ensure-recent creates one default board for concurrent empty-account requests", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(prisma, async (user) => {
      const cookie = await sessionCookieFor(user.id);
      const [firstResponse, secondResponse] = await Promise.all([
        app.inject({
          headers: { cookie },
          method: "POST",
          url: "/api/boards/ensure-recent",
        }),
        app.inject({
          headers: { cookie },
          method: "POST",
          url: "/api/boards/ensure-recent",
        }),
      ]);

      assert.ok([200, 201].includes(firstResponse.statusCode));
      assert.ok([200, 201].includes(secondResponse.statusCode));
      const firstBody = JSON.parse(firstResponse.body);
      const secondBody = JSON.parse(secondResponse.body);
      assert.equal(firstBody.board.id, secondBody.board.id);
      assert.equal(await prisma.board.count({ where: { userId: user.id } }), 1);
    });
  } finally {
    await app.close();
  }
});

test("GET /api/boards/recent returns the most recently updated board", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(prisma, async (user) => {
      const older = await prisma.board.create({
        data: { name: "Older board", userId: user.id },
      });
      const newer = await prisma.board.create({
        data: { name: "Newer board", userId: user.id },
      });
      await prisma.board.update({ data: { name: "Older board renamed" }, where: { id: older.id } });

      const cookie = await sessionCookieFor(user.id);
      const response = await app.inject({
        headers: { cookie },
        method: "GET",
        url: "/api/boards/recent",
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.board.id, older.id);
      assert.equal(body.board.name, "Older board renamed");
      assert.notEqual(body.board.id, newer.id);
      assert.deepEqual(body.board._count, { assets: 0, jobs: 0 });
    });
  } finally {
    await app.close();
  }
});

test("POST /api/boards/ensure-recent returns an existing recent board without creating another", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(prisma, async (user) => {
      const board = await prisma.board.create({
        data: { name: "Existing board", userId: user.id },
      });
      const cookie = await sessionCookieFor(user.id);
      const response = await app.inject({
        headers: { cookie },
        method: "POST",
        url: "/api/boards/ensure-recent",
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.board.id, board.id);
      assert.deepEqual(body.board._count, { assets: 0, jobs: 0 });
      assert.equal(await prisma.board.count({ where: { userId: user.id } }), 1);
    });
  } finally {
    await app.close();
  }
});

test("POST /api/boards/:boardId/duplicate preserves asset favorites and tags", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(prisma, async (user) => {
      const board = await prisma.board.create({
        data: { name: "Source board", userId: user.id },
      });
      const storageKey = `uploads/${board.id}/upload/source.png`;
      const absolutePath = path.join(process.cwd(), "public", storageKey);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, Buffer.from("asset-bytes"));
      const sourceAsset = await prisma.asset.create({
        data: {
          boardId: board.id,
          height: 1,
          isFavorite: true,
          kind: "upload",
          mimeType: "image/png",
          publicUrl: "/api/assets/source-asset/file",
          sizeBytes: 11,
          storageKey,
          tagsJson: JSON.stringify(["hero", "draft"]),
          width: 1,
        },
      });

      const cookie = await sessionCookieFor(user.id);
      const response = await app.inject({
        headers: { cookie },
        method: "POST",
        url: `/api/boards/${board.id}/duplicate`,
      });

      assert.equal(response.statusCode, 201);
      const body = JSON.parse(response.body);
      const copiedAsset = await prisma.asset.findFirstOrThrow({
        where: { boardId: body.board.id },
      });
      assert.notEqual(copiedAsset.id, sourceAsset.id);
      assert.equal(copiedAsset.isFavorite, true);
      assert.equal(copiedAsset.tagsJson, JSON.stringify(["hero", "draft"]));
      await rm(path.join(process.cwd(), "public", "uploads", board.id), { force: true, recursive: true });
      await rm(path.join(process.cwd(), "public", "uploads", body.board.id), { force: true, recursive: true });
    });
  } finally {
    await app.close();
  }
});

test("PUT /api/boards/:boardId/snapshot can create a named manual version", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(prisma, async (user) => {
      const board = await prisma.board.create({ data: { name: "Versioned board", userId: user.id } });
      const cookie = await sessionCookieFor(user.id);
      const response = await app.inject({
        headers: { cookie },
        method: "PUT",
        payload: {
          kind: "manual",
          name: "Before retouch",
          snapshot: { app: { boardDocument: { currentPageId: "page-1", pages: [{ id: "page-1", name: "Page 1", objects: [] }] } } },
        },
        url: `/api/boards/${board.id}/snapshot?allowEmpty=1`,
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.version, 1);
      const snapshot = await prisma.boardSnapshot.findFirstOrThrow({ where: { boardId: board.id } });
      assert.equal(snapshot.kind, "manual");
      assert.equal(snapshot.name, "Before retouch");
    });
  } finally {
    await app.close();
  }
});

test("PUT /api/boards/:boardId/snapshot keeps named versions while pruning older automatic versions", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(prisma, async (user) => {
      const board = await prisma.board.create({ data: { name: "Pruned board", userId: user.id } });
      const cookie = await sessionCookieFor(user.id);
      for (let index = 1; index <= 31; index += 1) {
        const response = await app.inject({
          headers: { cookie },
          method: "PUT",
          payload: { snapshot: { app: { index } } },
          url: `/api/boards/${board.id}/snapshot?allowEmpty=1`,
        });
        assert.equal(response.statusCode, 200);
      }
      await app.inject({
        headers: { cookie },
        method: "PUT",
        payload: { kind: "manual", name: "Pinned", snapshot: { app: { pinned: true } } },
        url: `/api/boards/${board.id}/snapshot?allowEmpty=1`,
      });

      const snapshots = await prisma.boardSnapshot.findMany({
        orderBy: { version: "asc" },
        where: { boardId: board.id },
      });
      const automaticSnapshots = snapshots.filter((snapshot) => snapshot.kind === "auto");
      assert.equal(automaticSnapshots.length, 30);
      assert.equal(automaticSnapshots[0].version, 2);
      assert.ok(snapshots.some((snapshot) => snapshot.kind === "manual" && snapshot.name === "Pinned"));
    });
  } finally {
    await app.close();
  }
});

test("GET /api/boards/:boardId/snapshots lists version metadata without large snapshot payloads", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(prisma, async (user) => {
      const board = await prisma.board.create({ data: { name: "List board", userId: user.id } });
      await prisma.$executeRawUnsafe(
        `INSERT INTO "BoardSnapshot" ("id", "boardId", "snapshotJson", "name", "kind", "version") VALUES (?, ?, ?, ?, ?, ?)`,
        "snapshot-list-1",
        board.id,
        JSON.stringify({ app: { value: 1 } }),
        "Named",
        "manual",
        1,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "BoardSnapshot" ("id", "boardId", "snapshotJson", "kind", "version") VALUES (?, ?, ?, ?, ?)`,
        "snapshot-list-2",
        board.id,
        JSON.stringify({ app: { value: 2 } }),
        "auto",
        2,
      );

      const response = await app.inject({
        headers: { cookie: await sessionCookieFor(user.id) },
        method: "GET",
        url: `/api/boards/${board.id}/snapshots`,
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.snapshots.length, 2);
      assert.equal(body.snapshots[0].version, 2);
      assert.equal(body.snapshots[1].name, "Named");
      assert.equal(body.snapshots[1].kind, "manual");
      assert.equal("snapshotJson" in body.snapshots[0], false);
      assert.equal("snapshot" in body.snapshots[0], false);
    });
  } finally {
    await app.close();
  }
});

test("POST /api/boards/:boardId/snapshots/:snapshotId/restore restores the snapshot as the current board", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(prisma, async (user) => {
      const board = await prisma.board.create({
        data: { name: "Restore board", snapshotJson: JSON.stringify({ app: { value: "current" } }), userId: user.id },
      });
      await prisma.$executeRawUnsafe(
        `INSERT INTO "BoardSnapshot" ("id", "boardId", "snapshotJson", "name", "kind", "version") VALUES (?, ?, ?, ?, ?, ?)`,
        "snapshot-restore-1",
        board.id,
        JSON.stringify({ app: { value: "restored" } }),
        "Good version",
        "manual",
        1,
      );

      const response = await app.inject({
        headers: { cookie: await sessionCookieFor(user.id) },
        method: "POST",
        url: `/api/boards/${board.id}/snapshots/snapshot-restore-1/restore`,
      });

      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.deepEqual(body.snapshot, { app: { value: "restored" } });
      const restoredBoard = await prisma.board.findUniqueOrThrow({ where: { id: board.id } });
      assert.equal(restoredBoard.snapshotJson, JSON.stringify({ app: { value: "restored" } }));
      assert.equal(await prisma.boardSnapshot.count({ where: { boardId: board.id } }), 2);
    });
  } finally {
    await app.close();
  }
});

test("POST /api/boards/:boardId/snapshots/:snapshotId/duplicate creates a new board from that version", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(prisma, async (user) => {
      const board = await prisma.board.create({ data: { name: "Source board", userId: user.id } });
      await prisma.$executeRawUnsafe(
        `INSERT INTO "BoardSnapshot" ("id", "boardId", "snapshotJson", "name", "kind", "version") VALUES (?, ?, ?, ?, ?, ?)`,
        "snapshot-copy-1",
        board.id,
        JSON.stringify({ app: { value: "copied" } }),
        "Copy point",
        "manual",
        1,
      );

      const response = await app.inject({
        headers: { cookie: await sessionCookieFor(user.id) },
        method: "POST",
        url: `/api/boards/${board.id}/snapshots/snapshot-copy-1/duplicate`,
      });

      assert.equal(response.statusCode, 201);
      const body = JSON.parse(response.body);
      assert.notEqual(body.board.id, board.id);
      assert.equal(body.board.name, "Source board - Copy point");
      const copiedBoard = await prisma.board.findUniqueOrThrow({ where: { id: body.board.id } });
      assert.equal(copiedBoard.snapshotJson, JSON.stringify({ app: { value: "copied" } }));
      const copiedSnapshot = await prisma.boardSnapshot.findFirstOrThrow({ where: { boardId: copiedBoard.id } });
      assert.equal(copiedSnapshot.version, 1);
      assert.equal(copiedSnapshot.kind, "manual");
      assert.equal(copiedSnapshot.name, "Copy point");
    });
  } finally {
    await app.close();
  }
});
