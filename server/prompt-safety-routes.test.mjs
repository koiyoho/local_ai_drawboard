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
  tempDir = await mkdtemp(path.join(tmpdir(), "prompt-safety-routes-test-"));
  previousDatabaseUrl = process.env.DATABASE_URL;
  previousAuthSecret = process.env.AUTH_SECRET;
  process.env.DATABASE_URL = `file:${path.join(tempDir, "test.db")}`;
  process.env.AUTH_SECRET = "prompt-safety-route-test-secret";
  await execFileAsync(process.execPath, ["scripts/init-db.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env },
  });
  ({ prisma } = await import(prismaModuleUrl));
});

beforeEach(async () => {
  await prisma.board.deleteMany();
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

async function createUser() {
  const username = `prompt-safety-user-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

async function createBoard(userId) {
  return prisma.board.create({
    data: {
      name: "提示词安全测试画板",
      snapshotJson: "{}",
      userId,
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

test("prompt safety optimizer requires an authenticated board owner", async () => {
  const app = await createTestApp();
  try {
    const anonymous = await app.inject({
      body: { boardId: "missing-board", prompt: "性感美女" },
      method: "POST",
      url: "/api/prompt-safety/optimize",
    });
    assert.equal(anonymous.statusCode, 401);

    const user = await createUser();
    const cookie = await sessionCookieFor(user.id);
    const missingBoard = await app.inject({
      body: { boardId: "missing-board", prompt: "性感美女" },
      headers: { cookie },
      method: "POST",
      url: "/api/prompt-safety/optimize",
    });
    assert.equal(missingBoard.statusCode, 404);
  } finally {
    await app.close();
  }
});

test("prompt safety optimizer rewrites risky wording for the current board", async () => {
  const app = await createTestApp();
  try {
    const user = await createUser();
    const board = await createBoard(user.id);
    const cookie = await sessionCookieFor(user.id);

    const response = await app.inject({
      body: {
        boardId: board.id,
        mode: "strict",
        prompt: "可爱小女孩，性感女仆装，诱惑眼神",
      },
      headers: { cookie },
      method: "POST",
      url: "/api/prompt-safety/optimize",
    });
    assert.equal(response.statusCode, 200);
    const payload = JSON.parse(response.body);
    assert.equal(payload.applied, true);
    assert.equal(payload.mode, "strict");
    assert.match(payload.prompt, /20岁成年女性角色|成年女性角色/);
    assert.match(payload.prompt, /干净克制的商业质感/);
    assert.ok(payload.reasons.includes("removed_minor_adult_conflict"));
    assert.ok(payload.reasons.includes("added_strict_constraints"));
  } finally {
    await app.close();
  }
});
