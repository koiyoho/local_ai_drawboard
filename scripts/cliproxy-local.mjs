import { createHash, randomBytes } from "node:crypto";
import { closeSync, createWriteStream, openSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const repoOwner = "router-for-me";
const repoName = "CLIProxyAPI";
const defaultVersion = "7.1.44";
const defaultPort = "8327";
const installRoot = path.resolve(".local", "cliproxy");
const binDir = path.join(installRoot, "bin");
const configPath = path.join(installRoot, "config.yaml");
const pidPath = path.join(installRoot, "cliproxy.pid");
const stdoutLogPath = path.join(installRoot, "cliproxy.out.log");
const stderrLogPath = path.join(installRoot, "cliproxy.err.log");
const envPath = path.resolve(".env");

if (isCliEntryPoint()) {
  const command = process.argv[2] || "ensure";

  if (command === "ensure") {
    await ensureCliProxyLocal({ start: false });
  } else if (command === "start") {
    await ensureCliProxyLocal({ start: true });
  } else if (command === "status") {
    const status = await getStatus();
    console.log(JSON.stringify(status, null, 2));
    process.exit(status.ready ? 0 : 1);
  } else {
    console.error(`Unknown CLIProxyAPI local command: ${command}`);
    console.error("Usage: node scripts/cliproxy-local.mjs ensure|start|status");
    process.exit(1);
  }
}

export async function ensureCliProxyLocal(options = {}) {
  const envValues = parseEnvContent(await readFile(envPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  }));
  const port = readPort(envValues);
  const baseUrl = envValues.CLIPROXY_BASE_URL?.trim() || `http://127.0.0.1:${port}/v1`;
  const apiKey = envValues.CLIPROXY_API_KEY?.trim() || generateCliProxyApiKey();
  const managementKey = envValues.MANAGEMENT_PASSWORD?.trim() || apiKey;

  await mkdir(installRoot, { recursive: true });
  await ensureBinary();
  await writeConfig({ apiKey, managementKey, port });
  await writeEnvValues(envPath, {
    CLIPROXY_API_KEY: apiKey,
    CLIPROXY_BASE_URL: baseUrl,
    MANAGEMENT_PASSWORD: managementKey,
  });

  if (options.start) {
    await startCliProxy({ apiKey, baseUrl, managementKey });
  } else {
    console.log(`CLIProxyAPI local runtime ready at ${baseUrl}`);
  }
}

async function ensureBinary() {
  const binaryPath = getBinaryPath();
  if (await exists(binaryPath)) return;

  const platform = getPlatformAssetPart();
  const extension = process.platform === "win32" ? "zip" : "tar.gz";
  const assetName = `CLIProxyAPI_${defaultVersion}_${platform}.${extension}`;
  const assetUrl = `https://github.com/${repoOwner}/${repoName}/releases/download/v${defaultVersion}/${assetName}`;
  const archivePath = path.join(installRoot, assetName);
  const extractPath = path.join(installRoot, "extract");

  console.log(`Downloading CLIProxyAPI ${defaultVersion} for ${platform}...`);
  await downloadFile(assetUrl, archivePath);
  await verifyArchiveChecksum(assetName, archivePath).catch((error) => {
    console.warn(`CLIProxyAPI checksum verification skipped: ${error instanceof Error ? error.message : String(error)}`);
  });

  await rm(extractPath, { force: true, recursive: true });
  await mkdir(extractPath, { recursive: true });
  if (process.platform === "win32") {
    await run("powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "& { param($ArchivePath, $ExtractPath) Expand-Archive -LiteralPath $ArchivePath -DestinationPath $ExtractPath -Force }",
      archivePath,
      extractPath,
    ]);
  } else {
    await run("tar", ["-xzf", archivePath, "-C", extractPath]);
  }

  const extractedBinary = path.join(extractPath, getBinaryName());
  await mkdir(binDir, { recursive: true });
  await copyFile(extractedBinary, binaryPath);
  if (process.platform !== "win32") await chmod(binaryPath, 0o755);
  console.log(`Installed CLIProxyAPI binary at ${binaryPath}`);
}

async function startCliProxy({ apiKey, baseUrl, managementKey }) {
  const status = await getStatus(apiKey);
  if (status.ready) {
    console.log(`CLIProxyAPI already running at ${baseUrl}`);
    await syncApiKey({ apiKey, baseUrl, managementKey });
    return;
  }

  const binaryPath = getBinaryPath();
  const outFd = openSync(stdoutLogPath, "a");
  const errFd = openSync(stderrLogPath, "a");
  let child;
  try {
    child = spawn(binaryPath, ["-config", configPath], {
      cwd: installRoot,
      detached: true,
      env: {
        ...process.env,
        MANAGEMENT_PASSWORD: managementKey,
      },
      stdio: ["ignore", outFd, errFd],
      windowsHide: true,
    });
  } finally {
    closeSync(outFd);
    closeSync(errFd);
  }
  child.unref();
  await writeFile(pidPath, `${child.pid}\n`);

  const ready = await waitForReady(baseUrl, apiKey, 15000);
  if (!ready) {
    console.warn(`CLIProxyAPI started as PID ${child.pid}, but ${baseUrl} did not become ready within 15s. See ${stderrLogPath}`);
    return;
  }
  console.log(`CLIProxyAPI started at ${baseUrl}`);
  await syncApiKey({ apiKey, baseUrl, managementKey });
}

export async function getStatus(apiKey = "") {
  const envValues = parseEnvContent(await readFile(envPath, "utf8").catch(() => ""));
  const port = readPort(envValues);
  const baseUrl = envValues.CLIPROXY_BASE_URL?.trim() || `http://127.0.0.1:${port}/v1`;
  return {
    baseUrl,
    binaryInstalled: await exists(getBinaryPath()),
    configPath,
    pid: await readPid(),
    ready: await waitForReady(baseUrl, apiKey || envValues.CLIPROXY_API_KEY?.trim() || "cliproxy", 500),
  };
}

async function syncApiKey({ apiKey, baseUrl, managementKey }) {
  const managementBaseUrl = baseUrl.replace(/\/+$/, "").replace(/\/v1$/i, "/v0/management");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const currentResponse = await fetch(`${managementBaseUrl}/api-keys`, {
      headers: getManagementHeaders(managementKey),
      signal: controller.signal,
    });
    if (!currentResponse.ok) {
      console.warn(`CLIProxyAPI api-keys read returned ${currentResponse.status}; local config was still saved.`);
      return;
    }
    const payload = await currentResponse.json().catch(() => ({}));
    const currentKeys = extractApiKeys(payload);
    if (currentKeys.includes(apiKey)) {
      console.log("CLIProxyAPI API key already synced.");
      return;
    }
    const updateResponse = await fetch(`${managementBaseUrl}/api-keys`, {
      body: JSON.stringify([...currentKeys, apiKey]),
      headers: {
        ...getManagementHeaders(managementKey),
        "Content-Type": "application/json",
      },
      method: "PUT",
      signal: controller.signal,
    });
    if (!updateResponse.ok) {
      console.warn(`CLIProxyAPI api-keys update returned ${updateResponse.status}; local config was still saved.`);
      return;
    }
    console.log("CLIProxyAPI API key synced.");
  } catch (error) {
    console.warn(`CLIProxyAPI API key sync skipped: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function writeConfig({ apiKey, managementKey, port }) {
  await writeFile(
    configPath,
    [
      'host: "127.0.0.1"',
      `port: ${port}`,
      "tls:",
      "  enable: false",
      "  cert: \"\"",
      "  key: \"\"",
      "remote-management:",
      "  allow-remote: false",
      `  secret-key: ${JSON.stringify(managementKey)}`,
      "  disable-control-panel: false",
      "  disable-auto-update-panel: true",
      "auth-dir: \"./auth\"",
      "api-keys:",
      `  - ${JSON.stringify(apiKey)}`,
      "debug: false",
      "logging-to-file: true",
      "usage-statistics-enabled: false",
      "",
    ].join("\n"),
    "utf8",
  );
}

async function downloadFile(url, outputPath) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  if (process.env.CLIPROXY_FORCE_SYSTEM_DOWNLOAD === "1") {
    await downloadFileWithSystemTool(url, outputPath);
    return;
  }
  try {
    const response = await fetch(url, { headers: { Accept: "application/octet-stream" }, signal: AbortSignal.timeout(30000) });
    if (!response.ok || !response.body) throw new Error(`Download failed with ${response.status}: ${url}`);
    await pipeline(response.body, createWriteStream(outputPath));
  } catch (error) {
    console.warn(`Node download failed, falling back to system downloader: ${error instanceof Error ? error.message : String(error)}`);
    await downloadFileWithSystemTool(url, outputPath);
  }
}

async function downloadFileWithSystemTool(url, outputPath) {
  const timeoutMs = readPositiveIntEnv("CLIPROXY_SYSTEM_DOWNLOAD_TIMEOUT_MS", 120000);
  if (process.platform === "win32") {
    await run("powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "& { param($Uri, $OutFile) Invoke-WebRequest -Uri $Uri -OutFile $OutFile -TimeoutSec 120 }",
      url,
      outputPath,
    ], { timeoutMs });
    return;
  }
  await run("curl", ["-fL", "--connect-timeout", "30", "--max-time", "120", "-o", outputPath, url], { timeoutMs });
}

async function verifyArchiveChecksum(assetName, archivePath) {
  const checksumsUrl = `https://github.com/${repoOwner}/${repoName}/releases/download/v${defaultVersion}/checksums.txt`;
  const response = await fetch(checksumsUrl, { headers: { Accept: "text/plain" } });
  if (!response.ok) throw new Error(`checksums.txt returned ${response.status}`);
  const checksums = await response.text();
  const expected = checksums
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts.includes(assetName))?.[0];
  if (!expected) throw new Error(`checksum not found for ${assetName}`);
  const actual = await sha256File(archivePath);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    await rm(archivePath, { force: true });
    throw new Error(`checksum mismatch for ${assetName}`);
  }
}

function getPlatformAssetPart() {
  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "amd64" : "";
  if (!arch) throw new Error(`Unsupported CPU architecture for CLIProxyAPI: ${process.arch}`);
  if (process.platform === "win32") return `windows_${arch}`;
  if (process.platform === "darwin") return `darwin_${arch}`;
  if (process.platform === "linux") return `linux_${arch}`;
  if (process.platform === "freebsd") return `freebsd_${arch}`;
  throw new Error(`Unsupported platform for CLIProxyAPI: ${process.platform}`);
}

function getBinaryName() {
  return process.platform === "win32" ? "cli-proxy-api.exe" : "cli-proxy-api";
}

function getBinaryPath() {
  return path.join(binDir, getBinaryName());
}

function readPort(envValues) {
  const rawBaseUrl = envValues.CLIPROXY_BASE_URL?.trim();
  if (rawBaseUrl) {
    try {
      const parsed = new URL(rawBaseUrl);
      if (parsed.port) return parsed.port;
    } catch {
      // Fall back to default below.
    }
  }
  return envValues.CLIPROXY_PORT?.trim() || defaultPort;
}

async function waitForReady(baseUrl, apiKey, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
        headers: { Authorization: `Bearer ${apiKey || "cliproxy"}` },
      });
      if (response.status < 500) return true;
    } catch {
      // Retry until deadline.
    }
    await sleep(250);
  } while (Date.now() < deadline);
  return false;
}

async function readPid() {
  const raw = await readFile(pidPath, "utf8").catch(() => "");
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseEnvContent(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    values[match[1]] = parseEnvValue(match[2]);
  }
  return values;
}

function parseEnvValue(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
}

async function writeEnvValues(targetPath, values) {
  const content = await readFile(targetPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  });
  const nextContent = Object.entries(values).reduce((current, [key, value]) => {
    const linePattern = new RegExp(`^${escapeRegExp(key)}=.*$`, "m");
    const nextLine = `${key}=${JSON.stringify(value)}`;
    return linePattern.test(current)
      ? current.replace(linePattern, nextLine)
      : `${current.replace(/\s*$/, "")}${current.trim() ? "\n" : ""}${nextLine}\n`;
  }, content);
  const normalized = nextContent.endsWith("\n") ? nextContent : `${nextContent}\n`;
  if (normalized !== content) await writeFile(targetPath, normalized, "utf8");
}

function extractApiKeys(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string" && item.trim());
  if (!value || typeof value !== "object") return [];
  const raw = value["api-keys"] ?? value.apiKeys ?? value.keys;
  return Array.isArray(raw) ? raw.filter((item) => typeof item === "string" && item.trim()) : [];
}

function getManagementHeaders(key) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${key}`,
    "X-Management-Key": key,
  };
}

function generateCliProxyApiKey() {
  return `clp_${randomBytes(24).toString("base64url")}`;
}

function readPositiveIntEnv(key, fallback) {
  const parsed = Number.parseInt(process.env[key] || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    import("node:fs").then(({ createReadStream }) => {
      const stream = createReadStream(filePath);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("error", reject);
      stream.on("end", () => resolve(hash.digest("hex")));
    }, reject);
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: "inherit", windowsHide: true });
    let timedOut = false;
    const timer = options.timeoutMs
      ? setTimeout(() => {
        timedOut = true;
        killProcessTree(child);
      }, options.timeoutMs)
      : null;
    child.on("error", reject);
    child.on("exit", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${command} ${args.join(" ")} timed out after ${options.timeoutMs}ms`));
        return;
      }
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

function killProcessTree(child) {
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    }).on("error", () => {
      child.kill();
    });
    return;
  }
  child.kill();
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCliEntryPoint() {
  return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
}
