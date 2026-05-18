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
let previousAuthSecret;
let previousGeminiAuthPath;
let prisma;

before(async () => {
  tempDbDir = await mkdtemp(path.join(tmpdir(), "gemini-bridge-routes-db-test-"));
  previousDatabaseUrl = process.env.DATABASE_URL;
  previousAuthSecret = process.env.AUTH_SECRET;
  previousGeminiAuthPath = process.env.GEMINI_WEB_AUTH_PATH;
  process.env.DATABASE_URL = `file:${path.join(tempDbDir, "test.db")}`;
  process.env.AUTH_SECRET = "gemini-bridge-route-test-secret";
  process.env.GEMINI_WEB_AUTH_PATH = path.join(tempDbDir, "gemini-web-auth.json");
  await execFileAsync(process.execPath, ["scripts/init-db.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env },
  });
  ({ prisma } = await import(prismaModuleUrl));
});

after(async () => {
  if (prisma) await prisma.$disconnect();
  restoreEnv("DATABASE_URL", previousDatabaseUrl);
  restoreEnv("AUTH_SECRET", previousAuthSecret);
  restoreEnv("GEMINI_WEB_AUTH_PATH", previousGeminiAuthPath);
  if (tempDbDir) await rm(tempDbDir, { force: true, recursive: true });
});

async function createTestApp() {
  const { createApp } = await import(appModuleUrl);
  return createApp();
}

async function withTestUser(input, fn) {
  const username = input.exactUsername
    ? input.username
    : `${input.username}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const existingUser = input.exactUsername ? await prisma.user.findUnique({ where: { username } }) : null;
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

test("Gemini bridge status requires an authenticated admin", async () => {
  const app = await createTestApp();
  try {
    const anonymous = await app.inject({ method: "GET", url: "/api/gemini-bridge/status" });
    assert.equal(anonymous.statusCode, 401);

    await withTestUser({ role: "user", username: "regular-user" }, async (user) => {
      const cookie = await sessionCookieFor(user.id);
      const response = await app.inject({
        headers: { cookie },
        method: "GET",
        url: "/api/gemini-bridge/status",
      });
      assert.equal(response.statusCode, 403);
    });
  } finally {
    await app.close();
  }
});

test("Gemini bridge status returns non-sensitive local configuration hints", async () => {
  const previousApiKey = process.env.GEMINI_BRIDGE_API_KEY;
  const previousHost = process.env.GEMINI_BRIDGE_HOST;
  const previousPort = process.env.GEMINI_BRIDGE_PORT;
  const previous1psid = process.env.GEMINI_SECURE_1PSID;
  const previous1psidts = process.env.GEMINI_SECURE_1PSIDTS;
  process.env.GEMINI_BRIDGE_API_KEY = "local-secret";
  process.env.GEMINI_BRIDGE_HOST = "127.0.0.1";
  process.env.GEMINI_BRIDGE_PORT = "1";
  process.env.GEMINI_SECURE_1PSID = "cookie-secret";
  process.env.GEMINI_SECURE_1PSIDTS = "";

  const app = await createTestApp();
  try {
    await withTestUser({ exactUsername: true, role: "admin", username: "koiyoho" }, async (user) => {
      const cookie = await sessionCookieFor(user.id);
      const response = await app.inject({
        headers: { cookie },
        method: "GET",
        url: "/api/gemini-bridge/status",
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), {
        bridgeBaseUrl: "http://127.0.0.1:1/v1",
        bridgeHealth: "offline",
        bridgeHost: "127.0.0.1",
        bridgePort: 1,
        hasApiKey: true,
        hasFullCookies: false,
        hasSecure1psid: true,
        hasSecure1psidts: false,
        imageModel: "gemini-web",
        suggestedImageModels: [
          { id: "gemini-web", label: "Gemini Web" },
          { id: "nano-banana", label: "Nano Banana" },
        ],
        suggestedTextModels: [{ id: "gemini-web", label: "Gemini Web" }],
        textModel: "gemini-web",
      });
      assert.equal(response.body.includes("cookie-secret"), false);
      assert.equal(response.body.includes("local-secret"), false);
    });
  } finally {
    await app.close();
    restoreEnv("GEMINI_BRIDGE_API_KEY", previousApiKey);
    restoreEnv("GEMINI_BRIDGE_HOST", previousHost);
    restoreEnv("GEMINI_BRIDGE_PORT", previousPort);
    restoreEnv("GEMINI_SECURE_1PSID", previous1psid);
    restoreEnv("GEMINI_SECURE_1PSIDTS", previous1psidts);
  }
});

test("Gemini bridge auth import stores cookies locally without returning secrets", async () => {
  const app = await createTestApp();
  try {
    await withTestUser({ exactUsername: true, role: "admin", username: "koiyoho" }, async (user) => {
      const cookie = await sessionCookieFor(user.id);
      const saveResponse = await app.inject({
        headers: { cookie },
        method: "PUT",
        payload: {
          secure1psid: "imported-cookie-secret",
          secure1psidts: "imported-ts-secret",
        },
        url: "/api/gemini-bridge/auth",
      });
      assert.equal(saveResponse.statusCode, 200);
      assert.deepEqual(saveResponse.json(), {
        cookieCount: 0,
        hasFullCookies: false,
        hasSecure1psid: true,
        hasSecure1psidts: true,
        saved: true,
      });
      assert.equal(saveResponse.body.includes("imported-cookie-secret"), false);

      const saved = JSON.parse(await readFile(process.env.GEMINI_WEB_AUTH_PATH, "utf8"));
      assert.equal(saved["__Secure-1PSID"], "imported-cookie-secret");
      assert.equal(saved["__Secure-1PSIDTS"], "imported-ts-secret");
      assert.deepEqual(saved.cookies, []);

      const statusResponse = await app.inject({
        headers: { cookie },
        method: "GET",
        url: "/api/gemini-bridge/status",
      });
      assert.equal(statusResponse.statusCode, 200);
      assert.equal(statusResponse.json().hasSecure1psid, true);
      assert.equal(statusResponse.json().hasSecure1psidts, true);
      assert.equal(statusResponse.body.includes("imported-cookie-secret"), false);
    });
  } finally {
    await app.close();
  }
});

test("Gemini bridge auth import accepts a full browser cookie JSON export", async () => {
  const app = await createTestApp();
  try {
    await withTestUser({ exactUsername: true, role: "admin", username: "koiyoho" }, async (user) => {
      const cookie = await sessionCookieFor(user.id);
      const cookieImport = JSON.stringify([
        { domain: ".google.com", name: "__Secure-1PSID", path: "/", value: "json-cookie-secret" },
        { domain: ".google.com", name: "__Secure-1PSIDTS", path: "/", value: "json-ts-secret" },
        { domain: "accounts.google.com", name: "__Host-GAPS", path: "/", value: "host-gaps-secret" },
      ]);
      const saveResponse = await app.inject({
        headers: { cookie },
        method: "PUT",
        payload: {
          cookieImport,
          secure1psid: "",
          secure1psidts: "",
        },
        url: "/api/gemini-bridge/auth",
      });
      assert.equal(saveResponse.statusCode, 200);
      assert.deepEqual(saveResponse.json(), {
        cookieCount: 3,
        hasFullCookies: true,
        hasSecure1psid: true,
        hasSecure1psidts: true,
        saved: true,
      });
      assert.equal(saveResponse.body.includes("json-cookie-secret"), false);

      const saved = JSON.parse(await readFile(process.env.GEMINI_WEB_AUTH_PATH, "utf8"));
      assert.equal(saved["__Secure-1PSID"], "json-cookie-secret");
      assert.equal(saved["__Secure-1PSIDTS"], "json-ts-secret");
      assert.equal(saved.cookies.length, 3);

      const statusResponse = await app.inject({
        headers: { cookie },
        method: "GET",
        url: "/api/gemini-bridge/status",
      });
      assert.equal(statusResponse.statusCode, 200);
      assert.equal(statusResponse.json().hasFullCookies, true);
      assert.equal(statusResponse.body.includes("host-gaps-secret"), false);
    });
  } finally {
    await app.close();
  }
});

test("Gemini bridge can create provider settings when no OpenAI-compatible API exists", async () => {
  const previousApiKey = process.env.GEMINI_BRIDGE_API_KEY;
  const previousHost = process.env.GEMINI_BRIDGE_HOST;
  const previousPort = process.env.GEMINI_BRIDGE_PORT;
  process.env.GEMINI_BRIDGE_API_KEY = "gemini-local-secret";
  process.env.GEMINI_BRIDGE_HOST = "127.0.0.1";
  process.env.GEMINI_BRIDGE_PORT = "8317";

  const app = await createTestApp();
  try {
    await withTestUser({ exactUsername: true, role: "admin", username: "koiyoho" }, async (user) => {
      const cookie = await sessionCookieFor(user.id);
      const response = await app.inject({
        headers: { cookie },
        method: "POST",
        url: "/api/gemini-bridge/configure-provider",
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().providerSetting.baseUrl, "http://127.0.0.1:8317/v1");

      const stored = await prisma.providerSetting.findUniqueOrThrow({
        where: { userId_provider: { provider: "openai-compatible", userId: user.id } },
      });
      assert.equal(stored.apiKey, "gemini-local-secret");
      assert.equal(stored.imageModel, "gemini-web");
      assert.equal(stored.textModel, "gemini-web");
      assert.deepEqual(JSON.parse(stored.enabledImageModels).map((model) => model.id), ["gemini-web", "nano-banana"]);
      assert.deepEqual(JSON.parse(stored.enabledReversePromptModels).map((model) => model.id), ["gemini-web"]);
    });
  } finally {
    await app.close();
    restoreEnv("GEMINI_BRIDGE_API_KEY", previousApiKey);
    restoreEnv("GEMINI_BRIDGE_HOST", previousHost);
    restoreEnv("GEMINI_BRIDGE_PORT", previousPort);
  }
});

test("Gemini bridge adds Gemini models without replacing an existing OpenAI-compatible API", async () => {
  const previousApiKey = process.env.GEMINI_BRIDGE_API_KEY;
  const previousHost = process.env.GEMINI_BRIDGE_HOST;
  const previousPort = process.env.GEMINI_BRIDGE_PORT;
  process.env.GEMINI_BRIDGE_API_KEY = "gemini-local-secret";
  process.env.GEMINI_BRIDGE_HOST = "127.0.0.1";
  process.env.GEMINI_BRIDGE_PORT = "8317";

  const app = await createTestApp();
  try {
    await withTestUser({ exactUsername: true, role: "admin", username: "koiyoho" }, async (user) => {
      await prisma.providerSetting.upsert({
        create: {
          apiKey: "third-party-secret",
          baseUrl: "https://sub.aipowers.site/v1",
          displayName: "OpenAI 兼容接口",
          enabled: true,
          enabledImageModels: JSON.stringify([{ enabled: true, id: "gpt-image-2", label: "GPT Image 2" }]),
          enabledReversePromptModels: JSON.stringify([{ enabled: true, id: "gpt-5.5", label: "GPT 5.5" }]),
          imageModel: "gpt-image-2",
          provider: "openai-compatible",
          textModel: "gpt-5.5",
          userId: user.id,
        },
        update: {
          apiKey: "third-party-secret",
          baseUrl: "https://sub.aipowers.site/v1",
          displayName: "OpenAI 兼容接口",
          enabled: true,
          enabledImageModels: JSON.stringify([{ enabled: true, id: "gpt-image-2", label: "GPT Image 2" }]),
          enabledReversePromptModels: JSON.stringify([{ enabled: true, id: "gpt-5.5", label: "GPT 5.5" }]),
          imageModel: "gpt-image-2",
          textModel: "gpt-5.5",
        },
        where: { userId_provider: { provider: "openai-compatible", userId: user.id } },
      });

      const cookie = await sessionCookieFor(user.id);
      const response = await app.inject({
        headers: { cookie },
        method: "POST",
        url: "/api/gemini-bridge/configure-provider",
      });
      assert.equal(response.statusCode, 200);

      const stored = await prisma.providerSetting.findUniqueOrThrow({
        where: { userId_provider: { provider: "openai-compatible", userId: user.id } },
      });
      assert.equal(stored.apiKey, "third-party-secret");
      assert.equal(stored.baseUrl, "https://sub.aipowers.site/v1");
      assert.equal(stored.displayName, "OpenAI 兼容接口");
      assert.equal(stored.imageModel, "gpt-image-2");
      assert.equal(stored.textModel, "gpt-5.5");
      assert.deepEqual(JSON.parse(stored.enabledImageModels).map((model) => model.id), ["gpt-image-2", "gemini-web", "nano-banana"]);
      assert.deepEqual(JSON.parse(stored.enabledReversePromptModels).map((model) => model.id), ["gpt-5.5", "gemini-web"]);
    });
  } finally {
    await app.close();
    restoreEnv("GEMINI_BRIDGE_API_KEY", previousApiKey);
    restoreEnv("GEMINI_BRIDGE_HOST", previousHost);
    restoreEnv("GEMINI_BRIDGE_PORT", previousPort);
  }
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
