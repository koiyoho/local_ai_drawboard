import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const dbPath = resolveSqlitePath(process.env.DATABASE_URL);
mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
const localUserId = "local-user";

db.exec(`
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "User" (
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
);

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

INSERT OR IGNORE INTO "User" ("id", "username", "name", "role", "status", "canUseAdminProvider")
VALUES ('${localUserId}', 'local', 'Local User', 'admin', 'approved', true);

CREATE TABLE IF NOT EXISTS "Board" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL DEFAULT '${localUserId}',
  "name" TEXT NOT NULL,
  "snapshotJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Board_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "BoardSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "boardId" TEXT NOT NULL,
  "snapshotJson" TEXT NOT NULL,
  "name" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'auto',
  "version" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BoardSnapshot_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "StoryboardProject" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "boardId" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT '',
  "briefJson" TEXT NOT NULL,
  "scriptText" TEXT NOT NULL DEFAULT '',
  "metadataJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StoryboardProject_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "StoryboardShot" (
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
);

CREATE TABLE IF NOT EXISTS "Asset" (
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
);

CREATE TABLE IF NOT EXISTS "GenerationJob" (
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
);

CREATE TABLE IF NOT EXISTS "GenerationResult" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "jobId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GenerationResult_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GenerationResult_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Account" (
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
);

CREATE TABLE IF NOT EXISTS "Session" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionToken" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expires" DATETIME NOT NULL,
  CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "VerificationToken" (
  "identifier" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "expires" DATETIME NOT NULL,
  PRIMARY KEY ("identifier", "token")
);

CREATE TABLE IF NOT EXISTS "ProviderSetting" (
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
);

CREATE TABLE IF NOT EXISTS "ProviderSettingHistory" (
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
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderSettingHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "PromptRecipe" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "paramsJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PromptRecipe_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");
CREATE INDEX IF NOT EXISTS "Account_userId_idx" ON "Account"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "Session_sessionToken_key" ON "Session"("sessionToken");
CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "ProviderSetting_userId_provider_key" ON "ProviderSetting"("userId", "provider");
CREATE INDEX IF NOT EXISTS "ProviderSetting_userId_enabled_idx" ON "ProviderSetting"("userId", "enabled");
CREATE INDEX IF NOT EXISTS "ProviderSettingHistory_userId_updatedAt_idx" ON "ProviderSettingHistory"("userId", "updatedAt");
CREATE INDEX IF NOT EXISTS "ProviderSettingHistory_userId_provider_idx" ON "ProviderSettingHistory"("userId", "provider");
CREATE INDEX IF NOT EXISTS "BoardSnapshot_boardId_version_idx" ON "BoardSnapshot"("boardId", "version");
CREATE UNIQUE INDEX IF NOT EXISTS "StoryboardProject_boardId_key" ON "StoryboardProject"("boardId");
CREATE INDEX IF NOT EXISTS "StoryboardProject_boardId_updatedAt_idx" ON "StoryboardProject"("boardId", "updatedAt");
CREATE INDEX IF NOT EXISTS "StoryboardShot_projectId_shotIndex_idx" ON "StoryboardShot"("projectId", "shotIndex");
CREATE INDEX IF NOT EXISTS "StoryboardShot_projectId_status_idx" ON "StoryboardShot"("projectId", "status");
CREATE INDEX IF NOT EXISTS "Asset_boardId_kind_idx" ON "Asset"("boardId", "kind");
CREATE INDEX IF NOT EXISTS "GenerationJob_boardId_status_idx" ON "GenerationJob"("boardId", "status");
CREATE INDEX IF NOT EXISTS "GenerationResult_jobId_idx" ON "GenerationResult"("jobId");
CREATE INDEX IF NOT EXISTS "PromptRecipe_userId_updatedAt_idx" ON "PromptRecipe"("userId", "updatedAt");
CREATE INDEX IF NOT EXISTS "PromptRecipe_userId_mode_idx" ON "PromptRecipe"("userId", "mode");
`);

const boardColumns = db.prepare(`PRAGMA table_info("Board")`).all();
const hasBoardUserId = boardColumns.some((column) => column.name === "userId");
if (!hasBoardUserId) {
  db.exec(`
  ALTER TABLE "Board" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '${localUserId}';
  UPDATE "Board" SET "userId" = '${localUserId}' WHERE "userId" IS NULL OR "userId" = '';
  `);
}

const userColumns = db.prepare(`PRAGMA table_info("User")`).all();
const hasUsername = userColumns.some((column) => column.name === "username");
const hasPasswordHash = userColumns.some((column) => column.name === "passwordHash");
const hasRole = userColumns.some((column) => column.name === "role");
const hasStatus = userColumns.some((column) => column.name === "status");
const hasCanUseAdminProvider = userColumns.some((column) => column.name === "canUseAdminProvider");
const hasGenerationLimit = userColumns.some((column) => column.name === "generationLimit");
const hasGenerationFiveHourLimit = userColumns.some((column) => column.name === "generationFiveHourLimit");
const hasApprovedAt = userColumns.some((column) => column.name === "approvedAt");
const hasApprovedByUserId = userColumns.some((column) => column.name === "approvedByUserId");
const hasCreatedAt = userColumns.some((column) => column.name === "createdAt");
const hasUpdatedAt = userColumns.some((column) => column.name === "updatedAt");
if (!hasUsername) {
  db.exec(`ALTER TABLE "User" ADD COLUMN "username" TEXT;`);
}
if (!hasPasswordHash) {
  db.exec(`ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;`);
}
if (!hasRole) {
  db.exec(`ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';`);
}
if (!hasStatus) {
  db.exec(`ALTER TABLE "User" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending';`);
}
if (!hasCanUseAdminProvider) {
  db.exec(`ALTER TABLE "User" ADD COLUMN "canUseAdminProvider" BOOLEAN NOT NULL DEFAULT false;`);
}
if (!hasGenerationLimit) {
  db.exec(`ALTER TABLE "User" ADD COLUMN "generationLimit" INTEGER DEFAULT 30;`);
}
if (!hasGenerationFiveHourLimit) {
  db.exec(`ALTER TABLE "User" ADD COLUMN "generationFiveHourLimit" INTEGER DEFAULT 10;`);
}
if (!hasApprovedAt) {
  db.exec(`ALTER TABLE "User" ADD COLUMN "approvedAt" DATETIME;`);
}
if (!hasApprovedByUserId) {
  db.exec(`ALTER TABLE "User" ADD COLUMN "approvedByUserId" TEXT;`);
}
if (!hasCreatedAt) {
  db.exec(`
  ALTER TABLE "User" ADD COLUMN "createdAt" DATETIME;
  UPDATE "User" SET "createdAt" = CURRENT_TIMESTAMP WHERE "createdAt" IS NULL;
  `);
}
if (!hasUpdatedAt) {
  db.exec(`
  ALTER TABLE "User" ADD COLUMN "updatedAt" DATETIME;
  UPDATE "User" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "updatedAt" IS NULL;
  `);
}

const providerSettingColumns = db.prepare(`PRAGMA table_info("ProviderSetting")`).all();
const hasTextModel = providerSettingColumns.some((column) => column.name === "textModel");
const hasEnabledImageModels = providerSettingColumns.some((column) => column.name === "enabledImageModels");
const hasEnabledReversePromptModels = providerSettingColumns.some((column) => column.name === "enabledReversePromptModels");
if (!hasTextModel) {
  db.exec(`ALTER TABLE "ProviderSetting" ADD COLUMN "textModel" TEXT NOT NULL DEFAULT 'gpt-5.5';`);
}
if (!hasEnabledImageModels) {
  db.exec(`ALTER TABLE "ProviderSetting" ADD COLUMN "enabledImageModels" TEXT;`);
}
if (!hasEnabledReversePromptModels) {
  db.exec(`ALTER TABLE "ProviderSetting" ADD COLUMN "enabledReversePromptModels" TEXT;`);
}

db.exec(`
CREATE TABLE IF NOT EXISTS "ProviderSettingHistory" (
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
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderSettingHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ProviderSettingHistory_userId_updatedAt_idx" ON "ProviderSettingHistory"("userId", "updatedAt");
CREATE INDEX IF NOT EXISTS "ProviderSettingHistory_userId_provider_idx" ON "ProviderSettingHistory"("userId", "provider");
`);

const providerSettingHistoryColumns = db.prepare(`PRAGMA table_info("ProviderSettingHistory")`).all();
const historyHasEnabledImageModels = providerSettingHistoryColumns.some((column) => column.name === "enabledImageModels");
const historyHasEnabledReversePromptModels = providerSettingHistoryColumns.some((column) => column.name === "enabledReversePromptModels");
if (!historyHasEnabledImageModels) {
  db.exec(`ALTER TABLE "ProviderSettingHistory" ADD COLUMN "enabledImageModels" TEXT;`);
}
if (!historyHasEnabledReversePromptModels) {
  db.exec(`ALTER TABLE "ProviderSettingHistory" ADD COLUMN "enabledReversePromptModels" TEXT;`);
}

const boardSnapshotColumns = db.prepare(`PRAGMA table_info("BoardSnapshot")`).all();
const hasBoardSnapshotName = boardSnapshotColumns.some((column) => column.name === "name");
const hasBoardSnapshotKind = boardSnapshotColumns.some((column) => column.name === "kind");
if (!hasBoardSnapshotName) {
  db.exec(`ALTER TABLE "BoardSnapshot" ADD COLUMN "name" TEXT;`);
}
if (!hasBoardSnapshotKind) {
  db.exec(`ALTER TABLE "BoardSnapshot" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'auto';`);
}
db.exec(`CREATE INDEX IF NOT EXISTS "BoardSnapshot_boardId_kind_idx" ON "BoardSnapshot"("boardId", "kind");`);

const storyboardShotColumns = db.prepare(`PRAGMA table_info("StoryboardShot")`).all();
const hasStartFrameAssetId = storyboardShotColumns.some((column) => column.name === "startFrameAssetId");
const hasEndFrameAssetId = storyboardShotColumns.some((column) => column.name === "endFrameAssetId");
if (!hasStartFrameAssetId) {
  db.exec(`ALTER TABLE "StoryboardShot" ADD COLUMN "startFrameAssetId" TEXT;`);
}
if (!hasEndFrameAssetId) {
  db.exec(`ALTER TABLE "StoryboardShot" ADD COLUMN "endFrameAssetId" TEXT;`);
}

const assetColumns = db.prepare(`PRAGMA table_info("Asset")`).all();
const hasAssetIsFavorite = assetColumns.some((column) => column.name === "isFavorite");
const hasAssetTagsJson = assetColumns.some((column) => column.name === "tagsJson");
if (!hasAssetIsFavorite) {
  db.exec(`ALTER TABLE "Asset" ADD COLUMN "isFavorite" BOOLEAN NOT NULL DEFAULT false;`);
}
if (!hasAssetTagsJson) {
  db.exec(`ALTER TABLE "Asset" ADD COLUMN "tagsJson" TEXT;`);
}

db.exec(`CREATE INDEX IF NOT EXISTS "Board_userId_updatedAt_idx" ON "Board"("userId", "updatedAt");`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");`);
db.exec(`
UPDATE "User"
SET "role" = 'admin',
    "status" = 'approved',
    "approvedAt" = COALESCE("approvedAt", CURRENT_TIMESTAMP)
WHERE "username" = 'koiyoho';
`);
db.exec(`
UPDATE "User"
SET "username" = 'local',
    "name" = 'Local User',
    "role" = 'admin',
    "status" = 'approved',
    "canUseAdminProvider" = true,
    "generationLimit" = NULL,
    "generationFiveHourLimit" = NULL
WHERE "id" = '${localUserId}';
`);

db.close();
console.log(`Initialized SQLite database at ${dbPath}`);

function resolveSqlitePath(databaseUrl) {
  const fallbackPath = path.join(process.cwd(), "prisma", "dev.db");
  if (!databaseUrl) return fallbackPath;
  if (!databaseUrl.startsWith("file:")) return fallbackPath;
  const rawPath = databaseUrl.slice("file:".length);
  if (!rawPath) return fallbackPath;
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
}
