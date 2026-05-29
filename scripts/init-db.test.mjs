import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("init-db honors DATABASE_URL and backfills asset, snapshot, and recipe schema", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "init-db-test-"));
  const dbPath = path.join(tempDir, "custom.db");
  try {
    const db = new DatabaseSync(dbPath);
    db.exec(`
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
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
    db.exec(`
CREATE TABLE "BoardSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "boardId" TEXT NOT NULL,
  "snapshotJson" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
    db.close();

    await execFileAsync(process.execPath, ["scripts/init-db.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    });

    const migratedDb = new DatabaseSync(dbPath);
    try {
      const columns = migratedDb.prepare(`PRAGMA table_info("Asset")`).all().map((column) => column.name);
      assert.ok(columns.includes("isFavorite"));
      assert.ok(columns.includes("tagsJson"));
      const snapshotColumns = migratedDb.prepare(`PRAGMA table_info("BoardSnapshot")`).all().map((column) => column.name);
      assert.ok(snapshotColumns.includes("name"));
      assert.ok(snapshotColumns.includes("kind"));
      const recipeColumns = migratedDb.prepare(`PRAGMA table_info("PromptRecipe")`).all().map((column) => column.name);
      assert.deepEqual(
        ["id", "userId", "name", "mode", "prompt", "paramsJson", "createdAt", "updatedAt"].every((column) =>
          recipeColumns.includes(column),
        ),
        true,
      );
      const storyboardProjectColumns = migratedDb.prepare(`PRAGMA table_info("StoryboardProject")`).all().map((column) => column.name);
      assert.deepEqual(
        ["id", "boardId", "title", "briefJson", "scriptText", "metadataJson", "createdAt", "updatedAt"].every((column) =>
          storyboardProjectColumns.includes(column),
        ),
        true,
      );
      const storyboardShotColumns = migratedDb.prepare(`PRAGMA table_info("StoryboardShot")`).all().map((column) => column.name);
      assert.deepEqual(
        [
          "id",
          "projectId",
          "shotIndex",
          "durationSec",
          "scene",
          "camera",
          "action",
          "dialogue",
          "caption",
          "audio",
          "startFrameAssetId",
          "endFrameAssetId",
          "startFramePrompt",
          "endFramePrompt",
          "videoPrompt",
          "status",
          "metadataJson",
          "createdAt",
          "updatedAt",
        ].every((column) => storyboardShotColumns.includes(column)),
        true,
      );
    } finally {
      migratedDb.close();
    }
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("init-db backfills missing provider video defaults to CLIProxy", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "init-db-provider-test-"));
  const dbPath = path.join(tempDir, "custom.db");
  try {
    const db = new DatabaseSync(dbPath);
    db.exec(`
CREATE TABLE "ProviderSetting" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'openai-compatible',
  "displayName" TEXT NOT NULL,
  "apiKey" TEXT NOT NULL,
  "baseUrl" TEXT,
  "imageModel" TEXT NOT NULL,
  "textModel" TEXT NOT NULL DEFAULT 'gpt-5.5',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
    db.prepare(`
INSERT INTO "ProviderSetting" ("id", "userId", "displayName", "apiKey", "imageModel")
VALUES ('provider-1', 'user-1', 'OpenAI compatible', 'provider-secret', 'gpt-image-2')
`).run();
    db.close();

    await execFileAsync(process.execPath, ["scripts/init-db.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    });

    const migratedDb = new DatabaseSync(dbPath);
    try {
      const setting = migratedDb.prepare(`
SELECT "videoModel", "enabledVideoModels"
FROM "ProviderSetting"
WHERE "id" = 'provider-1'
`).get();
      assert.equal(setting.videoModel, "cliproxy:grok-imagine-video");
      assert.deepEqual(JSON.parse(setting.enabledVideoModels), [
        { channel: "cliproxy", enabled: true, id: "grok-imagine-video", label: "Grok Imagine Video" },
      ]);
    } finally {
      migratedDb.close();
    }
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});
