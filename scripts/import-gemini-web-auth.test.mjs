import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("imports Gemini Web cookies from environment without printing secrets", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gemini-web-auth-import-test-"));
  const authPath = path.join(dir, "gemini-web-auth.json");
  try {
    const { stdout } = await execFileAsync(process.execPath, ["scripts/import-gemini-web-auth.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GEMINI_IMPORT_SECURE_1PSID: "imported-cookie-secret",
        GEMINI_IMPORT_SECURE_1PSIDTS: "imported-ts-secret",
        GEMINI_WEB_AUTH_PATH: authPath,
      },
    });
    const saved = JSON.parse(await readFile(authPath, "utf8"));

    assert.equal(saved["__Secure-1PSID"], "imported-cookie-secret");
    assert.equal(saved["__Secure-1PSIDTS"], "imported-ts-secret");
    assert.deepEqual(saved.cookies, []);
    assert.match(stdout, /Gemini Web auth saved/);
    assert.equal(stdout.includes("imported-cookie-secret"), false);
    assert.equal(stdout.includes("imported-ts-secret"), false);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("imports Gemini Web cookies from a browser cookie JSON export", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gemini-web-auth-import-json-test-"));
  const authPath = path.join(dir, "gemini-web-auth.json");
  try {
    const cookieImport = JSON.stringify([
      { domain: ".google.com", name: "__Secure-1PSID", path: "/", value: "json-cookie-secret" },
      { domain: ".google.com", name: "__Secure-1PSIDTS", path: "/", value: "json-ts-secret" },
      { domain: "accounts.google.com", name: "__Host-GAPS", path: "/", value: "host-gaps-secret" },
    ]);
    const { stdout } = await execFileAsync(process.execPath, ["scripts/import-gemini-web-auth.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GEMINI_IMPORT_COOKIES: cookieImport,
        GEMINI_IMPORT_SECURE_1PSID: "",
        GEMINI_IMPORT_SECURE_1PSIDTS: "",
        GEMINI_WEB_AUTH_PATH: authPath,
      },
    });
    const saved = JSON.parse(await readFile(authPath, "utf8"));

    assert.equal(saved["__Secure-1PSID"], "json-cookie-secret");
    assert.equal(saved["__Secure-1PSIDTS"], "json-ts-secret");
    assert.equal(saved.cookies.length, 3);
    assert.match(stdout, /3 saved/);
    assert.equal(stdout.includes("json-cookie-secret"), false);
    assert.equal(stdout.includes("host-gaps-secret"), false);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("refuses to import without required secure 1PSID cookie", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gemini-web-auth-import-missing-test-"));
  const authPath = path.join(dir, "gemini-web-auth.json");
  try {
    await assert.rejects(
      execFileAsync(process.execPath, ["scripts/import-gemini-web-auth.mjs"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          __SECURE_1PSID: "",
          __SECURE_1PSIDTS: "",
          GEMINI_IMPORT_SECURE_1PSID: "",
          GEMINI_IMPORT_SECURE_1PSIDTS: "",
          GEMINI_SECURE_1PSID: "",
          GEMINI_SECURE_1PSIDTS: "",
          GEMINI_WEB_AUTH_PATH: authPath,
        },
      }),
      /GEMINI_IMPORT_SECURE_1PSID or GEMINI_IMPORT_COOKIES/,
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});
