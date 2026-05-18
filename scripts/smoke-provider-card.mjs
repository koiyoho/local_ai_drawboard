import { DatabaseSync } from "node:sqlite";
import { hash } from "bcryptjs";
import { chromium } from "playwright";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://taki999.f3322.org:3333";
const adminUsername = process.env.ADMIN_USERNAME?.trim() || "admin";
const adminPassword = `provider-card-${Date.now()}`;
const db = new DatabaseSync("prisma/dev.db");
let browser;
let originalPasswordHash;

try {
  const admin = db.prepare("select passwordHash from User where username = ?").get(adminUsername);
  if (!admin?.passwordHash) {
    throw new Error(`Admin user ${adminUsername} was not found`);
  }
  originalPasswordHash = admin.passwordHash;
  const passwordHash = await hash(adminPassword, 12);
  db.prepare("update User set passwordHash = ? where username = ?").run(passwordHash, adminUsername);

  const host = new URL(baseUrl).hostname;
  browser = await chromium.launch({
    args: [`--host-resolver-rules=MAP ${host} 127.0.0.1`],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleMessages = [];
  page.on("console", (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));

  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByLabel("用户名").fill(adminUsername);
  await page.getByLabel("密码").fill(adminPassword);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL(`${baseUrl}/`, { timeout: 30000 });

  await page.getByRole("link", { name: /API 设置/ }).click();
  await page.getByRole("button", { name: /保存 API 设置/ }).waitFor({ timeout: 3000 });

  console.log("provider settings card opens the editable form");
  if (consoleMessages.length) {
    console.log(consoleMessages.join("\n"));
  }
} finally {
  if (browser) {
    await browser.close();
  }
  if (originalPasswordHash) {
    db.prepare("update User set passwordHash = ? where username = ?").run(originalPasswordHash, adminUsername);
  }
  db.close();
}
