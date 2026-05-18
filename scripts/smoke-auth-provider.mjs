import { access, mkdir, rm } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { hash } from "bcryptjs";
import { chromium } from "playwright";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3010";
const dbPath = path.join(process.cwd(), "prisma", "dev.db");
const runId = `smoke-${Date.now()}`;
const adminUsername = process.env.ADMIN_USERNAME?.trim() || "admin";
const adminPassword = `${runId}-admin-password`;
const sharedPassword = "local-password-123";
const userWithAdminApi = `${runId}-api-user`;
const userWithoutAdminApi = `${runId}-own-api-user`;
const rejectedUser = `${runId}-rejected-user`;
const smokeUsernames = [userWithAdminApi, userWithoutAdminApi, rejectedUser];
const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

await mkdir(path.join(process.cwd(), "tmp"), { recursive: true });
const fakeOpenAi = await startFakeOpenAi();
const db = new DatabaseSync(dbPath);
let browser;
let originalAdmin;
let originalAdminProvider;
let adminId;
let createdAdmin = false;
const createdBoardIds = [];

try {
  await seedAdmin(fakeOpenAi.url);

  const unauthBoards = await fetch(`${baseUrl}/api/boards`);
  assert(unauthBoards.status === 401, `expected unauth /api/boards 401, got ${unauthBoards.status}`);

  const unauthProvider = await fetch(`${baseUrl}/api/provider-settings`);
  assert(
    unauthProvider.status === 401,
    `expected unauth /api/provider-settings 401, got ${unauthProvider.status}`,
  );

  browser = await chromium.launch();
  const registrationContext = await browser.newContext();
  const registrationPage = await registrationContext.newPage();
  await registerUser(registrationPage, userWithAdminApi);
  await registerUser(registrationPage, userWithoutAdminApi);
  await registerUser(registrationPage, rejectedUser);

  await attemptLogin(registrationPage, userWithAdminApi, sharedPassword, /\/login\?error=pending/);

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await login(adminPage, adminUsername, adminPassword);
  await expectProviderSettingsVisible(adminPage);
  await expectText(adminPage, "用户审核");
  await expectText(adminPage, userWithAdminApi);

  const adminProviderResponse = await adminContext.request.get(`${baseUrl}/api/provider-settings`);
  assert(adminProviderResponse.ok(), `expected admin provider GET ok, got ${adminProviderResponse.status()}`);
  const adminProviderPayload = await adminProviderResponse.json();
  assert(adminProviderPayload.providerSetting.hasApiKey === true, "expected admin provider key marker");
  assert(!("apiKey" in adminProviderPayload.providerSetting), "provider response must not expose apiKey");
  const updateProviderWithoutKey = await adminContext.request.put(`${baseUrl}/api/provider-settings`, {
    data: {
      apiKey: "",
      baseUrl: fakeOpenAi.url,
      displayName: "Smoke Admin Provider Updated",
      imageModel: "gpt-image-2",
      textModel: "gpt-5.5-mini",
    },
  });
  assert(
    updateProviderWithoutKey.ok(),
    `expected provider update without re-entering key ok, got ${updateProviderWithoutKey.status()}`,
  );
  const updateProviderPayload = await updateProviderWithoutKey.json();
  assert(updateProviderPayload.providerSetting.hasApiKey === true, "expected provider key to be preserved");
  assert(
    updateProviderPayload.providerSetting.imageModel === "gpt-image-2",
    "expected provider image model to update without re-entering key",
  );
  assert(
    updateProviderPayload.providerSetting.textModel === "gpt-5.5-mini",
    "expected provider text model to update without re-entering key",
  );
  assert(
    updateProviderPayload.providerSetting.displayName === "Smoke Admin Provider Updated",
    "expected provider display name to update without re-entering key",
  );
  assert(!("apiKey" in updateProviderPayload.providerSetting), "provider update response must not expose apiKey");

  const pendingList = await adminContext.request.get(`${baseUrl}/api/admin/users`);
  assert(pendingList.ok(), `expected pending user list ok, got ${pendingList.status()}`);
  const pendingPayload = await pendingList.json();
  const pendingByUsername = new Map(pendingPayload.users.map((user) => [user.username, user]));
  for (const username of smokeUsernames) {
    assert(pendingByUsername.has(username), `expected ${username} in pending review list`);
  }

  await reviewUser(adminContext, pendingByUsername.get(userWithAdminApi).id, "approve", true);
  await reviewUser(adminContext, pendingByUsername.get(userWithoutAdminApi).id, "approve", false);
  await reviewUser(adminContext, pendingByUsername.get(rejectedUser).id, "reject", false);

  await attemptLogin(registrationPage, rejectedUser, sharedPassword, /\/login\?error=rejected/);
  const deletedRejectedUserResponse = await adminContext.request.delete(`${baseUrl}/api/admin/users`, {
    data: { userId: pendingByUsername.get(rejectedUser).id },
  });
  assert(
    deletedRejectedUserResponse.ok(),
    `expected rejected user delete ok, got ${deletedRejectedUserResponse.status()}`,
  );

  const apiUserContext = await browser.newContext();
  const apiUserPage = await apiUserContext.newPage();
  await login(apiUserPage, userWithAdminApi, sharedPassword);
  await expectProviderSettingsHidden(apiUserPage);

  const normalUserAdminCall = await apiUserContext.request.get(`${baseUrl}/api/admin/users`);
  assert(normalUserAdminCall.status() === 403, `expected normal user admin API 403, got ${normalUserAdminCall.status()}`);

  const boardWithAdminApi = await createBoard(apiUserContext, "Smoke Admin API Board");
  const generationResponse = await apiUserContext.request.post(`${baseUrl}/api/generation-jobs`, {
    data: {
      boardId: boardWithAdminApi.id,
      count: 1,
      mode: "text_to_image",
      prompt: "test image",
      size: "1024x1024",
    },
  });
  assert(generationResponse.ok(), `expected generation ok, got ${generationResponse.status()}`);
  const generationPayload = await generationResponse.json();
  const params = JSON.parse(generationPayload.job.paramsJson);
  assert(params.providerOwner === "admin", "expected job metadata to record admin provider owner");
  assert(params.providerSettingId === adminProviderPayload.providerSetting.id, "expected job metadata to use admin provider setting id");
  assert(!JSON.stringify(params).includes("smoke-admin-provider-key"), "job metadata must not include apiKey");
  assert(
    generationPayload.results[0].storageKey.includes(`${userWithAdminApi}_Smoke_Admin_API_Board_`),
    `expected generated filename to include username and project, got ${generationPayload.results[0].storageKey}`,
  );
  const generatedArchivePath = path.join(
    process.cwd(),
    "generated-images",
    userWithAdminApi,
    path.basename(generationPayload.results[0].storageKey),
  );
  await access(generatedArchivePath);
  assert(fakeOpenAi.requestCount === 1, `expected fake OpenAI to receive 1 request, got ${fakeOpenAi.requestCount}`);

  const usageResponse = await adminContext.request.get(`${baseUrl}/api/admin/usage`);
  assert(usageResponse.ok(), `expected admin usage GET ok, got ${usageResponse.status()}`);
  const usagePayload = await usageResponse.json();
  const apiUserUsage = usagePayload.users.find((user) => user.username === userWithAdminApi);
  assert(apiUserUsage, "expected generated user in admin usage list");
  assert(apiUserUsage.generationLimit === 30, `expected default total limit 30, got ${apiUserUsage.generationLimit}`);
  assert(
    apiUserUsage.generationFiveHourLimit === 10,
    `expected default 5 hour limit 10, got ${apiUserUsage.generationFiveHourLimit}`,
  );
  assert(apiUserUsage.generatedImageCount === 1, `expected usage count 1, got ${apiUserUsage.generatedImageCount}`);
  assert(
    apiUserUsage.generationFiveHourUsedCount === 1,
    `expected 5 hour usage count 1, got ${apiUserUsage.generationFiveHourUsedCount}`,
  );
  assert(apiUserUsage.recentGeneratedImages.length === 1, "expected recent generated image in usage list");

  const windowLimitResponse = await adminContext.request.patch(`${baseUrl}/api/admin/usage`, {
    data: { generationFiveHourLimit: 1, generationLimit: 10, userId: apiUserUsage.id },
  });
  assert(windowLimitResponse.ok(), `expected admin usage window limit PATCH ok, got ${windowLimitResponse.status()}`);

  const windowLimitedGenerationResponse = await apiUserContext.request.post(`${baseUrl}/api/generation-jobs`, {
    data: {
      boardId: boardWithAdminApi.id,
      count: 1,
      mode: "text_to_image",
      prompt: "test image after limit",
      size: "1024x1024",
    },
  });
  assert(
    windowLimitedGenerationResponse.status() === 429,
    `expected generation window limit 429, got ${windowLimitedGenerationResponse.status()}`,
  );
  const windowLimitedGenerationPayload = await windowLimitedGenerationResponse.json();
  assert(windowLimitedGenerationPayload.error.includes("5 小时"), "expected 5 hour generation limit error message");
  assert(fakeOpenAi.requestCount === 1, "window limited generation must not call upstream image API");

  const totalLimitResponse = await adminContext.request.patch(`${baseUrl}/api/admin/usage`, {
    data: { generationFiveHourLimit: null, generationLimit: 1, userId: apiUserUsage.id },
  });
  assert(totalLimitResponse.ok(), `expected admin usage total limit PATCH ok, got ${totalLimitResponse.status()}`);

  const totalLimitedGenerationResponse = await apiUserContext.request.post(`${baseUrl}/api/generation-jobs`, {
    data: {
      boardId: boardWithAdminApi.id,
      count: 1,
      mode: "text_to_image",
      prompt: "test image after total limit",
      size: "1024x1024",
    },
  });
  assert(
    totalLimitedGenerationResponse.status() === 429,
    `expected generation total limit 429, got ${totalLimitedGenerationResponse.status()}`,
  );
  const totalLimitedGenerationPayload = await totalLimitedGenerationResponse.json();
  assert(totalLimitedGenerationPayload.error.includes("总生成次数"), "expected total generation limit error message");
  assert(fakeOpenAi.requestCount === 1, "total limited generation must not call upstream image API");

  const ownApiUserContext = await browser.newContext();
  const ownApiUserPage = await ownApiUserContext.newPage();
  await login(ownApiUserPage, userWithoutAdminApi, sharedPassword);
  await expectProviderSettingsVisible(ownApiUserPage);
  const boardWithoutAdminApi = await createBoard(ownApiUserContext, "Smoke Own API Required Board");
  const missingProviderGeneration = await ownApiUserContext.request.post(`${baseUrl}/api/generation-jobs`, {
    data: {
      boardId: boardWithoutAdminApi.id,
      count: 1,
      mode: "text_to_image",
      prompt: "test image",
      size: "1024x1024",
    },
  });
  assert(
    missingProviderGeneration.status() === 400,
    `expected missing provider generation 400, got ${missingProviderGeneration.status()}`,
  );
  const missingProviderPayload = await missingProviderGeneration.json();
  assert(
    missingProviderPayload.error.includes("请配置第三方 API"),
    "expected generation error to ask for third-party API or admin authorization",
  );

  const disableUserResponse = await adminContext.request.patch(`${baseUrl}/api/admin/users`, {
    data: { action: "disable", userId: pendingByUsername.get(userWithoutAdminApi).id },
  });
  assert(disableUserResponse.ok(), `expected user disable ok, got ${disableUserResponse.status()}`);
  const disabledUserBoards = await ownApiUserContext.request.get(`${baseUrl}/api/boards`);
  assert(disabledUserBoards.status() === 401, `expected disabled user boards 401, got ${disabledUserBoards.status()}`);
  const enableUserResponse = await adminContext.request.patch(`${baseUrl}/api/admin/users`, {
    data: { action: "enable", userId: pendingByUsername.get(userWithoutAdminApi).id },
  });
  assert(enableUserResponse.ok(), `expected user enable ok, got ${enableUserResponse.status()}`);
  const enabledUserBoards = await ownApiUserContext.request.get(`${baseUrl}/api/boards`);
  assert(enabledUserBoards.ok(), `expected enabled user boards ok, got ${enabledUserBoards.status()}`);

  console.log("auth/provider admin-review smoke passed");
} finally {
  if (browser) {
    await browser.close();
  }
  cleanupDatabase();
  for (const boardId of createdBoardIds) {
    await rm(path.join(process.cwd(), "public", "uploads", boardId), { force: true, recursive: true });
  }
  for (const username of smokeUsernames) {
    await rm(path.join(process.cwd(), "generated-images", username), { force: true, recursive: true });
  }
  await fakeOpenAi.close();
  db.close();
}

async function registerUser(page, username) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  const registerForm = page.locator(".login-form").nth(1);
  await registerForm.locator('input[name="username"]').fill(username);
  await registerForm.locator('input[name="password"]').fill(sharedPassword);
  await registerForm.locator('button[type="submit"]').click();
  await page.waitForURL(/\/login\?registered=1/, { timeout: 30000 });
}

async function login(page, username, password) {
  await attemptLogin(page, username, password, new RegExp(`${escapeRegExp(baseUrl)}/?$`));
}

async function attemptLogin(page, username, password, expectedUrl) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  const loginForm = page.locator(".login-form").first();
  await loginForm.locator('input[name="username"]').fill(username);
  await loginForm.locator('input[name="password"]').fill(password);
  await loginForm.locator('button[type="submit"]').click();
  await page.waitForURL(expectedUrl, { timeout: 30000 });
}

async function expectText(page, text) {
  await page.locator("body").getByText(text).first().waitFor({ timeout: 30000 });
}

async function expectProviderSettingsVisible(page) {
  const providerSettingsCount = await page.locator("#provider-settings").count();
  assert(providerSettingsCount === 1, `expected provider settings card to be visible, got ${providerSettingsCount}`);
}

async function expectProviderSettingsHidden(page) {
  const providerSettingsCount = await page.locator("#provider-settings").count();
  assert(providerSettingsCount === 0, `expected provider settings card to be hidden, got ${providerSettingsCount}`);
}

async function reviewUser(context, userId, action, canUseAdminProvider) {
  const response = await context.request.post(`${baseUrl}/api/admin/users`, {
    data: { action, canUseAdminProvider, userId },
  });
  assert(response.ok(), `expected ${action} review ok, got ${response.status()}`);
}

async function createBoard(context, name) {
  const response = await context.request.post(`${baseUrl}/api/boards`, {
    data: { name },
  });
  assert(response.status() === 201, `expected board create 201, got ${response.status()}`);
  const payload = await response.json();
  createdBoardIds.push(payload.board.id);
  return payload.board;
}

async function seedAdmin(baseUrlForProvider) {
  db.exec("PRAGMA foreign_keys = ON");
  originalAdmin = db
    .prepare(`SELECT * FROM "User" WHERE "username" = ?`)
    .get(adminUsername);
  const passwordHash = await hash(adminPassword, 12);

  if (originalAdmin) {
    adminId = originalAdmin.id;
    db.prepare(
      `UPDATE "User"
       SET "passwordHash" = ?, "role" = 'admin', "status" = 'approved', "approvedAt" = COALESCE("approvedAt", CURRENT_TIMESTAMP)
       WHERE "id" = ?`,
    ).run(passwordHash, adminId);
  } else {
    createdAdmin = true;
    adminId = `${runId}-admin`;
    db.prepare(
      `INSERT INTO "User" ("id", "username", "passwordHash", "name", "email", "role", "status", "approvedAt")
       VALUES (?, ?, ?, ?, ?, 'admin', 'approved', CURRENT_TIMESTAMP)`,
    ).run(adminId, adminUsername, passwordHash, adminUsername, `${runId}-admin@example.invalid`);
  }

  originalAdminProvider = db
    .prepare(`SELECT * FROM "ProviderSetting" WHERE "userId" = ? AND "provider" = 'openai-compatible'`)
    .get(adminId);
  if (originalAdminProvider) {
    db.prepare(
      `UPDATE "ProviderSetting"
       SET "displayName" = 'Smoke Admin Provider', "apiKey" = 'smoke-admin-provider-key', "baseUrl" = ?, "imageModel" = 'gpt-image-1', "textModel" = 'gpt-5.5', "enabled" = true
       WHERE "id" = ?`,
    ).run(baseUrlForProvider, originalAdminProvider.id);
  } else {
    db.prepare(
      `INSERT INTO "ProviderSetting" ("id", "userId", "provider", "displayName", "apiKey", "baseUrl", "imageModel", "textModel", "enabled")
       VALUES (?, ?, 'openai-compatible', 'Smoke Admin Provider', 'smoke-admin-provider-key', ?, 'gpt-image-1', 'gpt-5.5', true)`,
    ).run(`${runId}-admin-provider`, adminId, baseUrlForProvider);
  }
}

function cleanupDatabase() {
  db.exec("PRAGMA foreign_keys = ON");
  const smokeUsers = db
    .prepare(`SELECT "id" FROM "User" WHERE "username" IN (${smokeUsernames.map(() => "?").join(", ")})`)
    .all(...smokeUsernames);
  const smokeUserIds = smokeUsers.map((user) => user.id);
  const boardIds = [
    ...createdBoardIds,
    ...selectIds(`SELECT "id" FROM "Board" WHERE "userId" IN (${smokeUserIds.map(() => "?").join(", ")})`, smokeUserIds),
  ];
  deleteBoards(boardIds);
  deleteByIds("ProviderSetting", "userId", smokeUserIds);
  deleteByIds("Session", "userId", smokeUserIds);
  deleteByIds("Account", "userId", smokeUserIds);
  deleteByIds("User", "id", smokeUserIds);

  if (createdAdmin) {
    deleteBoards(selectIds(`SELECT "id" FROM "Board" WHERE "userId" = ?`, [adminId]));
    db.prepare(`DELETE FROM "ProviderSetting" WHERE "userId" = ?`).run(adminId);
    db.prepare(`DELETE FROM "User" WHERE "id" = ?`).run(adminId);
    return;
  }

  if (originalAdminProvider) {
    db.prepare(
      `UPDATE "ProviderSetting"
       SET "displayName" = ?, "apiKey" = ?, "baseUrl" = ?, "imageModel" = ?, "textModel" = ?, "enabled" = ?, "createdAt" = ?, "updatedAt" = ?
       WHERE "id" = ?`,
    ).run(
      originalAdminProvider.displayName,
      originalAdminProvider.apiKey,
      originalAdminProvider.baseUrl,
      originalAdminProvider.imageModel,
      originalAdminProvider.textModel,
      originalAdminProvider.enabled,
      originalAdminProvider.createdAt,
      originalAdminProvider.updatedAt,
      originalAdminProvider.id,
    );
  } else {
    db.prepare(`DELETE FROM "ProviderSetting" WHERE "userId" = ? AND "provider" = 'openai-compatible'`).run(adminId);
  }

  if (originalAdmin) {
    db.prepare(
      `UPDATE "User"
       SET "passwordHash" = ?, "role" = ?, "status" = ?, "canUseAdminProvider" = ?,
           "generationLimit" = ?, "generationFiveHourLimit" = ?, "approvedAt" = ?, "approvedByUserId" = ?, "name" = ?, "email" = ?,
           "emailVerified" = ?, "image" = ?, "createdAt" = ?, "updatedAt" = ?
       WHERE "id" = ?`,
    ).run(
      originalAdmin.passwordHash,
      originalAdmin.role,
      originalAdmin.status,
      originalAdmin.canUseAdminProvider,
      originalAdmin.generationLimit,
      originalAdmin.generationFiveHourLimit,
      originalAdmin.approvedAt,
      originalAdmin.approvedByUserId,
      originalAdmin.name,
      originalAdmin.email,
      originalAdmin.emailVerified,
      originalAdmin.image,
      originalAdmin.createdAt,
      originalAdmin.updatedAt,
      originalAdmin.id,
    );
  }
}

function deleteBoards(boardIds) {
  const uniqueBoardIds = Array.from(new Set(boardIds.filter(Boolean)));
  if (uniqueBoardIds.length === 0) return;
  const placeholders = uniqueBoardIds.map(() => "?").join(", ");
  db.prepare(
    `DELETE FROM "GenerationResult" WHERE "jobId" IN (SELECT "id" FROM "GenerationJob" WHERE "boardId" IN (${placeholders}))`,
  ).run(...uniqueBoardIds);
  db.prepare(`DELETE FROM "GenerationJob" WHERE "boardId" IN (${placeholders})`).run(...uniqueBoardIds);
  db.prepare(`DELETE FROM "Asset" WHERE "boardId" IN (${placeholders})`).run(...uniqueBoardIds);
  db.prepare(`DELETE FROM "BoardSnapshot" WHERE "boardId" IN (${placeholders})`).run(...uniqueBoardIds);
  db.prepare(`DELETE FROM "Board" WHERE "id" IN (${placeholders})`).run(...uniqueBoardIds);
}

function deleteByIds(table, column, ids) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return;
  const placeholders = uniqueIds.map(() => "?").join(", ");
  db.prepare(`DELETE FROM "${table}" WHERE "${column}" IN (${placeholders})`).run(...uniqueIds);
}

function selectIds(sql, params) {
  if (params.length === 0) return [];
  return db.prepare(sql).all(...params).map((row) => row.id);
}

function startFakeOpenAi() {
  let requestCount = 0;
  const server = http.createServer((request, response) => {
    if (request.method !== "POST" || !request.url?.endsWith("/images/generations")) {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
      return;
    }
    requestCount += 1;
    request.resume();
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ data: [{ b64_json: pngBase64 }] }));
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Unable to start fake OpenAI server");
      }
      resolve({
        get requestCount() {
          return requestCount;
        },
        url: `http://127.0.0.1:${address.port}/v1`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
