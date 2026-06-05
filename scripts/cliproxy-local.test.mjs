import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

const execFileAsync = promisify(execFile);

test("cliproxy local ensure writes embedded runtime config and env", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "cliproxy-local-test-"));
  const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const scriptPath = path.join(repoRoot, "scripts", "cliproxy-local.mjs");
  const binaryName = process.platform === "win32" ? "cli-proxy-api.exe" : "cli-proxy-api";
  const binaryPath = path.join(tempDir, ".local", "cliproxy", "bin", binaryName);

  await writeFile(path.join(tempDir, ".env"), [
    'DATABASE_URL="file:./prisma/local-board.db"',
    'CLIPROXY_BASE_URL="http://127.0.0.1:9327/v1"',
    'CLIPROXY_API_KEY="clp_existing"',
    'MANAGEMENT_PASSWORD="management_existing"',
    "",
  ].join("\n"));
  await mkdir(path.dirname(binaryPath), { recursive: true });
  await writeFile(binaryPath, "placeholder");

  try {
    const { stdout } = await execFileAsync(process.execPath, [scriptPath, "ensure"], {
      cwd: tempDir,
      timeout: 30000,
    });
    assert.match(stdout, /CLIProxyAPI local runtime ready/);

    const env = await readFile(path.join(tempDir, ".env"), "utf8");
    assert.match(env, /CLIPROXY_BASE_URL="http:\/\/127\.0\.0\.1:9327\/v1"/);
    assert.match(env, /CLIPROXY_API_KEY="clp_existing"/);
    assert.match(env, /MANAGEMENT_PASSWORD="management_existing"/);

    const config = await readFile(path.join(tempDir, ".local", "cliproxy", "config.yaml"), "utf8");
    assert.match(config, /host: "127\.0\.0\.1"/);
    assert.match(config, /port: 9327/);
    assert.match(config, /secret-key: "management_existing"/);
    assert.match(config, /- "clp_existing"/);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("cliproxy local system downloader times out instead of hanging", async () => {
  if (process.platform !== "win32") return;

  const tempDir = await mkdtemp(path.join(tmpdir(), "cliproxy-local-timeout-test-"));
  const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const scriptPath = path.join(repoRoot, "scripts", "cliproxy-local.mjs");
  const fakeBinDir = path.join(tempDir, "fake-bin");
  const fakePowershellPath = path.join(fakeBinDir, "powershell.cmd");

  await writeFile(path.join(tempDir, ".env"), [
    'DATABASE_URL="file:./prisma/local-board.db"',
    'CLIPROXY_BASE_URL="http://127.0.0.1:9327/v1"',
    "",
  ].join("\n"));
  await mkdir(fakeBinDir, { recursive: true });
  await writeFile(fakePowershellPath, [
    "@echo off",
    "ping -n 30 127.0.0.1 >nul",
    "",
  ].join("\r\n"));

  try {
    await assert.rejects(
      () => execFileAsync(process.execPath, [scriptPath, "ensure"], {
        cwd: tempDir,
        env: {
          ...process.env,
          CLIPROXY_FORCE_SYSTEM_DOWNLOAD: "1",
          CLIPROXY_SYSTEM_DOWNLOAD_TIMEOUT_MS: "100",
          Path: `${fakeBinDir};${process.env.Path || ""}`,
        },
        timeout: 5000,
      }),
      /timed out after 100ms/,
    );
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("cliproxy local system downloader uses curl for socks5 proxies on Windows", async () => {
  if (process.platform !== "win32") return;

  const tempDir = await mkdtemp(path.join(tmpdir(), "cliproxy-local-proxy-test-"));
  const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const scriptPath = path.join(repoRoot, "scripts", "cliproxy-local.mjs");
  const fakeBinDir = path.join(tempDir, "fake-bin");
  const fakeCurlPath = path.join(fakeBinDir, "curl.cmd");
  const fakePowershellPath = path.join(fakeBinDir, "powershell.cmd");
  const curlArgsPath = path.join(tempDir, "curl-args.txt");
  const powershellArgsPath = path.join(tempDir, "powershell-args.txt");

  await writeFile(path.join(tempDir, ".env"), [
    'DATABASE_URL="file:./prisma/local-board.db"',
    'CLIPROXY_BASE_URL="http://127.0.0.1:9327/v1"',
    "",
  ].join("\n"));
  await mkdir(fakeBinDir, { recursive: true });
  await writeFile(fakeCurlPath, [
    "@echo off",
    `echo %* > "${curlArgsPath}"`,
    "exit /b 42",
    "",
  ].join("\r\n"));
  await writeFile(fakePowershellPath, [
    "@echo off",
    `echo %* > "${powershellArgsPath}"`,
    "exit /b 43",
    "",
  ].join("\r\n"));

  try {
    await assert.rejects(
      () => execFileAsync(process.execPath, [scriptPath, "ensure"], {
        cwd: tempDir,
        env: {
          ...process.env,
          CLIPROXY_DOWNLOAD_PROXY: "socks5h://127.0.0.1:10808",
          CLIPROXY_CURL_BINARY: fakeCurlPath,
          CLIPROXY_FORCE_SYSTEM_DOWNLOAD: "1",
          Path: `${fakeBinDir};${process.env.Path || ""}`,
        },
        timeout: 5000,
      }),
      /curl(?:\.cmd)? .* failed with exit code 42/,
    );

    const curlArgs = await readFile(curlArgsPath, "utf8");
    assert.match(curlArgs, /--proxy socks5h:\/\/127\.0\.0\.1:10808/);
    await assert.rejects(() => readFile(powershellArgsPath, "utf8"), /ENOENT/);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});
