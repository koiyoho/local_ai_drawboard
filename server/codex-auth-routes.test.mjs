import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { promisify } from "node:util";

const appModuleUrl = new URL("../dist/server/server/app.js", import.meta.url);
const prismaModuleUrl = new URL("../dist/server/src/lib/prisma.js", import.meta.url);
const authModuleUrl = new URL("../dist/server/server/auth.js", import.meta.url);
const execFileAsync = promisify(execFile);

let tempDbDir;
let previousDatabaseUrl;
let prisma;

before(async () => {
  tempDbDir = await mkdtemp(path.join(tmpdir(), "codex-auth-routes-db-test-"));
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${path.join(tempDbDir, "test.db")}`;
  await execFileAsync(process.execPath, ["scripts/init-db.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env },
  });
  ({ prisma } = await import(prismaModuleUrl));
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
  if (tempDbDir) {
    await rm(tempDbDir, { force: true, recursive: true });
  }
});

async function withTempCodexDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "codex-auth-routes-test-"));
  const previousDataDir = process.env.CODEX_OAUTH_DATA_DIR;
  const previousAuthSecret = process.env.AUTH_SECRET;
  process.env.CODEX_OAUTH_DATA_DIR = dir;
  process.env.AUTH_SECRET = "codex-auth-route-test-secret";
  try {
    return await fn(dir);
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.CODEX_OAUTH_DATA_DIR;
    } else {
      process.env.CODEX_OAUTH_DATA_DIR = previousDataDir;
    }
    if (previousAuthSecret === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = previousAuthSecret;
    }
    await rm(dir, { force: true, recursive: true });
  }
}

async function createTestApp() {
  const { createApp } = await import(appModuleUrl);
  const app = await createApp();
  return app;
}

async function withTestUser(input, fn) {
  if (!prisma) {
    ({ prisma } = await import(prismaModuleUrl));
  }
  const username = input.exactUsername
    ? input.username
    : `${input.username}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const existingUser = input.exactUsername
    ? await prisma.user.findUnique({ where: { username } })
    : null;
  if (existingUser) {
    const user = await prisma.user.update({
      data: {
        role: input.role,
        status: "approved",
      },
      where: { id: existingUser.id },
    });
    try {
      return await fn(user);
    } finally {
      await prisma.user.update({
        data: {
          role: existingUser.role,
          status: existingUser.status,
        },
        where: { id: existingUser.id },
      }).catch(() => null);
    }
  }

  const user = await prisma.user.create({
    data: {
      canUseAdminProvider: false,
      generationFiveHourLimit: 10,
      generationLimit: 30,
      name: input.username,
      role: input.role,
      status: "approved",
      username,
    },
  });
  try {
    return await fn(user);
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => null);
  }
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

test("Codex auth routes require an authenticated admin", async () => {
  await withTempCodexDir(async () => {
    const app = await createTestApp();
    try {
      const anonymousStatus = await app.inject({ method: "GET", url: "/api/codex-auth/status" });
      assert.equal(anonymousStatus.statusCode, 401);

      const anonymousStart = await app.inject({ method: "GET", url: "/api/codex-auth/start" });
      assert.equal(anonymousStart.statusCode, 401);

      await withTestUser({ role: "user", username: "regular-user" }, async (user) => {
        const cookie = await sessionCookieFor(user.id);
        const response = await app.inject({
          headers: { cookie },
          method: "GET",
          url: "/api/codex-auth/status",
        });
        assert.equal(response.statusCode, 403);
      });
    } finally {
      await app.close();
    }
  });
});

test("Codex auth status returns a non-sensitive disconnected state for an admin", async () => {
  await withTempCodexDir(async () => {
    const app = await createTestApp();
    try {
      await withTestUser({ exactUsername: true, role: "admin", username: "koiyoho" }, async (user) => {
        const cookie = await sessionCookieFor(user.id);
        const response = await app.inject({
          headers: { cookie },
          method: "GET",
          url: "/api/codex-auth/status",
        });
        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.equal(body.connected, false);
        assert.equal(typeof body.startAvailable, "boolean");
      });
    } finally {
      await app.close();
    }
  });
});

test("Codex auth start reports missing remote callback configuration", async () => {
  await withTempCodexDir(async () => {
    const previousLocalCallback = process.env.CODEX_OAUTH_LOCAL_CALLBACK;
    const previousRedirectUri = process.env.CODEX_OAUTH_REDIRECT_URI;
    delete process.env.CODEX_OAUTH_LOCAL_CALLBACK;
    delete process.env.CODEX_OAUTH_REDIRECT_URI;
    const app = await createTestApp();
    try {
      await withTestUser({ exactUsername: true, role: "admin", username: "koiyoho" }, async (user) => {
        const cookie = await sessionCookieFor(user.id);
        const response = await app.inject({
          headers: { cookie },
          method: "GET",
          url: "/api/codex-auth/start",
        });
        assert.equal(response.statusCode, 400);
        assert.match(JSON.parse(response.body).error, /auth\.json|公网回调不可用/);
      });
    } finally {
      if (previousLocalCallback === undefined) delete process.env.CODEX_OAUTH_LOCAL_CALLBACK;
      else process.env.CODEX_OAUTH_LOCAL_CALLBACK = previousLocalCallback;
      if (previousRedirectUri === undefined) delete process.env.CODEX_OAUTH_REDIRECT_URI;
      else process.env.CODEX_OAUTH_REDIRECT_URI = previousRedirectUri;
      await app.close();
    }
  });
});

test("Codex auth callback rejects forged state without writing auth", async () => {
  await withTempCodexDir(async (dir) => {
    const app = await createTestApp();
    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/codex-auth/callback?state=forged&code=abc",
      });
      assert.equal(response.statusCode, 400);
      await assert.rejects(readFile(path.join(dir, "codex-auth.json"), "utf8"));
    } finally {
      await app.close();
    }
  });
});

test("Codex auth can import pasted auth.json without exposing secrets", async () => {
  await withTempCodexDir(async (dir) => {
    const app = await createTestApp();
    try {
      await withTestUser({ exactUsername: true, role: "admin", username: "koiyoho" }, async (user) => {
        const cookie = await sessionCookieFor(user.id);
        const response = await app.inject({
          body: {
            authJson: JSON.stringify({
              OPENAI_API_KEY: "sk-codex-import-secret",
              auth_mode: "apikey",
            }),
          },
          headers: { cookie },
          method: "POST",
          url: "/api/codex-auth/import-json",
        });
        assert.equal(response.statusCode, 200);
        assert.equal(response.body.includes("sk-codex-import-secret"), false);
        const saved = JSON.parse(await readFile(path.join(dir, "codex-auth.json"), "utf8"));
        assert.equal(saved.OPENAI_API_KEY, "sk-codex-import-secret");
        assert.equal(saved.auth_mode, "apikey");
      });
    } finally {
      await app.close();
    }
  });
});

test("Codex auth can import official API key auth.json without auth_mode", async () => {
  await withTempCodexDir(async (dir) => {
    const app = await createTestApp();
    try {
      await withTestUser({ exactUsername: true, role: "admin", username: "koiyoho" }, async (user) => {
        const cookie = await sessionCookieFor(user.id);
        const response = await app.inject({
          body: {
            authJson: JSON.stringify({
              OPENAI_API_KEY: "sk-codex-official-json",
            }),
          },
          headers: { cookie },
          method: "POST",
          url: "/api/codex-auth/import-json",
        });
        assert.equal(response.statusCode, 200);
        assert.equal(response.body.includes("sk-codex-official-json"), false);
        const saved = JSON.parse(await readFile(path.join(dir, "codex-auth.json"), "utf8"));
        assert.equal(saved.OPENAI_API_KEY, "sk-codex-official-json");
        assert.equal(saved.auth_mode, "apikey");
      });
    } finally {
      await app.close();
    }
  });
});

test("Codex auth can import pasted ChatGPT auth.json from Codex CLI", async () => {
  await withTempCodexDir(async (dir) => {
    const app = await createTestApp();
    try {
      await withTestUser({ exactUsername: true, role: "admin", username: "koiyoho" }, async (user) => {
        const cookie = await sessionCookieFor(user.id);
        const response = await app.inject({
          body: {
            authJson: JSON.stringify({
              auth_mode: "chatgpt",
              tokens: {
                access_token: "codex-access-secret",
                id_token: fakeJwt({
                  "https://api.openai.com/auth": {
                    chatgpt_account_id: "acct_route",
                    chatgpt_plan_type: "team",
                    organization_id: "org_route",
                    project_id: "proj_route",
                  },
                }),
                refresh_token: "codex-refresh-secret",
              },
            }),
          },
          headers: { cookie },
          method: "POST",
          url: "/api/codex-auth/import-json",
        });
        assert.equal(response.statusCode, 200);
        assert.equal(response.body.includes("codex-access-secret"), false);
        assert.equal(response.body.includes("codex-refresh-secret"), false);
        const saved = JSON.parse(await readFile(path.join(dir, "codex-auth.json"), "utf8"));
        assert.equal(saved.authMode, "chatgpt");
        assert.equal(saved.tokens.accountId, "acct_route");
        assert.equal(saved.tokens.accessToken, "codex-access-secret");
        assert.equal(saved.tokens.refreshToken, "codex-refresh-secret");
      });
    } finally {
      await app.close();
    }
  });
});

function fakeJwt(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".");
}
