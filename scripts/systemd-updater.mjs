import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const modulePath = fileURLToPath(import.meta.url);
const serviceName = process.env.UPDATE_SERVICE_NAME || "tldraw-ai-board.service";
const appRoot = process.cwd();
const updateRoot = path.join(appRoot, "tmp", "updates");
const jobsDir = path.join(updateRoot, "jobs");
const packagesDir = path.join(updateRoot, "packages");
const stagingRoot = path.join(updateRoot, "staging");
const backupsRoot = path.join(updateRoot, "backups");
const currentJobPath = path.join(updateRoot, "current-update.json");
const lockPath = path.join(updateRoot, "update.lock");
const deployManifestName = "deploy-manifest.json";
const terminalStatuses = new Set(["completed", "failed", "rolled_back"]);
const allowedPackageHostsFallback = ["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"];
const defaultServicePort = "3333";
const dryRun = process.env.UPDATE_UPDATER_DRY_RUN === "1";
const geminiBridgeServiceName = process.env.UPDATE_GEMINI_BRIDGE_SERVICE_NAME || "tldraw-ai-board-gemini-bridge.service";

const allowedCommands = Object.freeze({
  installProductionDependencies: ["npm", ["ci", "--omit=dev"]],
  prismaGenerate: ["npx", ["prisma", "generate"]],
  initDatabase: [process.execPath, ["scripts/init-db.mjs"]],
  restartGeminiBridgeService: ["systemctl", ["try-restart", geminiBridgeServiceName]],
  restartService: ["systemctl", ["restart", serviceName]],
  stopService: ["systemctl", ["stop", serviceName]],
});

export async function runUpdateJob(jobId) {
  assertSafeJobId(jobId);
  await ensureDirs();

  const context = {
    dataBackupPath: path.join(backupsRoot, jobId, "data"),
    failedCommand: "",
    job: await readJson(jobPath(jobId)),
    lastSuccessfulPhase: "queued",
    manifest: await readJson(manifestSnapshotPath(jobId)),
    packagePath: path.join(packagesDir, `${jobId}.tar.gz`),
    recoveryPath: path.join(jobsDir, `${jobId}-recovery.md`),
    runtimeBackupPath: path.join(backupsRoot, jobId, "runtime"),
    stagePath: path.join(stagingRoot, jobId),
  };

  try {
    await refreshRecoveryFile(context, "downloading");
    await patchJob(context.job.id, {
      message: "Downloading release package",
      status: "downloading",
      step: "download",
      updaterPid: process.pid,
    });
    await downloadPackage(context.manifest.packageUrl, context.packagePath, getAllowedPackageHosts());
    context.lastSuccessfulPhase = "downloaded package";

    await patchJob(context.job.id, {
      message: "Verifying package checksum",
      status: "verifying",
      step: "checksum",
    });
    const actualSha = await sha256File(context.packagePath);
    if (actualSha.toLowerCase() !== context.manifest.sha256.toLowerCase()) {
      throw withReason(new Error("Downloaded package checksum does not match manifest"), "install_failed");
    }
    context.lastSuccessfulPhase = "verified package checksum";

    await patchJob(context.job.id, {
      message: "Validating package contents",
      status: "staging",
      step: "package_validation",
    });
    await validateArchiveListing(context.packagePath);
    await rm(context.stagePath, { force: true, recursive: true });
    await mkdir(context.stagePath, { recursive: true });
    await runCommand("tar", ["-xzf", context.packagePath, "-C", context.stagePath], { failedCommandLabel: "tar extract" });
    const packageManifest = await readAndValidateDeployManifest(context.stagePath, context.manifest);
    await verifyExtractedFiles(context.stagePath, packageManifest);
    context.lastSuccessfulPhase = "validated staging package";

    await refreshRecoveryFile(context, "runtime backup");
    await patchJob(context.job.id, {
      message: "Creating runtime backup",
      status: "backing_up",
      step: "runtime_backup",
    });
    await backupRuntime(context.runtimeBackupPath, packageManifest);
    context.lastSuccessfulPhase = "created runtime backup";

    if (context.manifest.migrationMode === "reversible") {
      await refreshRecoveryFile(context, "data backup");
      await patchJob(context.job.id, {
        message: "Creating SQLite snapshot",
        status: "backing_up",
        step: "data_backup",
      });
      if (!dryRun) await runAllowedCommand("stopService", { failedCommandLabel: "systemctl stop" });
      await backupSqliteFiles(context.dataBackupPath);
      context.lastSuccessfulPhase = "created data backup";
    }

    await refreshRecoveryFile(context, "runtime install");
    await patchJob(context.job.id, {
      message: dryRun ? "Dry-run install validation complete" : "Installing release package",
      status: "installing",
      step: "install",
    });
    if (!dryRun) {
      await installStagedRuntime(context.stagePath, packageManifest);
      await runAllowedCommand("installProductionDependencies", { failedCommandLabel: "npm ci --omit=dev" });
      await runAllowedCommand("prismaGenerate", { failedCommandLabel: "npx prisma generate" });
      if (context.manifest.migrationMode === "reversible") {
        await refreshRecoveryFile(context, "database migration");
        await runAllowedCommand("initDatabase", { failedCommandLabel: "node scripts/init-db.mjs" });
      }
    }
    context.lastSuccessfulPhase = dryRun ? "completed dry-run install" : "installed runtime";

    await refreshRecoveryFile(context, "service restart");
    await patchJob(context.job.id, {
      message: dryRun ? "Dry-run skipped service restart" : "Restarting service",
      status: "restarting",
      step: "restart",
    });
    if (!dryRun) await runAllowedCommand("restartService", { failedCommandLabel: "systemctl restart" });
    context.lastSuccessfulPhase = dryRun ? "skipped restart in dry-run" : "restarted service";

    await patchJob(context.job.id, {
      message: dryRun ? "Dry-run health check skipped" : "Checking service health",
      status: "health_checking",
      step: "health_check",
    });
    if (!dryRun) {
      await waitForHealth();
      await assertRunningVersion(context.manifest.version);
      await restartGeminiBridgeIfConfigured(context);
    }

    await patchJob(context.job.id, {
      message: dryRun ? "Update dry-run completed" : "Update completed",
      rollbackStatus: "not_needed",
      status: "completed",
      step: "completed",
    });
  } catch (error) {
    await handleFailure(context, error);
  } finally {
    await releaseLockIfCurrent(jobId);
  }
}

async function restartGeminiBridgeIfConfigured(context) {
  if (process.env.UPDATE_RESTART_GEMINI_BRIDGE === "0") return;

  await patchJob(context.job.id, {
    message: "Restarting Gemini Bridge service if installed",
    status: "health_checking",
    step: "gemini_bridge_restart",
  });

  try {
    await runAllowedCommand("restartGeminiBridgeService", {
      capture: true,
      failedCommandLabel: "systemctl try-restart gemini bridge",
    });
  } catch (error) {
    const currentJob = await readJson(jobPath(context.job.id));
    const warning = `Gemini Bridge service was not restarted: ${error instanceof Error ? error.message : String(error)}`;
    await patchJob(context.job.id, {
      warnings: [...(Array.isArray(currentJob.warnings) ? currentJob.warnings : []), warning],
    });
  }
}

async function handleFailure(context, error) {
  const failureReason = getFailureReason(error);
  const message = error instanceof Error ? error.message : String(error);
  await refreshRecoveryFile(context, "rollback", context.failedCommand || message);

  if (dryRun || !(await exists(context.runtimeBackupPath))) {
    await patchJob(context.job.id, {
      error: message,
      failureReason,
      message: "Update failed before rollback was needed",
      rollbackStatus: "not_needed",
      status: "failed",
      step: "failed",
    });
    return;
  }

  try {
    await restoreRuntimeBackup(context.runtimeBackupPath);
    let rollbackStatus = "restored_runtime";
    if (failureReason === "migration_failed" && await exists(context.dataBackupPath)) {
      await restoreDataBackup(context.dataBackupPath);
      rollbackStatus = "restored_runtime_and_data";
    }
    await runAllowedCommand("restartService", { failedCommandLabel: "systemctl restart rollback" });
    await patchJob(context.job.id, {
      error: message,
      failureReason,
      message: "Update failed; previous runtime was restored",
      rollbackStatus,
      status: "rolled_back",
      step: "rolled_back",
    });
  } catch (rollbackError) {
    await patchJob(context.job.id, {
      error: `${message}; rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
      failureReason: "rollback_failed",
      message: "Update failed and manual recovery is required",
      rollbackStatus: "failed_manual_recovery_required",
      status: "failed",
      step: "rollback_failed",
    });
  }
}

export async function downloadPackage(rawUrl, outputPath, allowedHosts) {
  let currentUrl = rawUrl;
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    assertAllowedPackageUrl(currentUrl, allowedHosts);
    const response = await fetch(currentUrl, {
      headers: { Accept: "application/octet-stream" },
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Package download redirect did not include a location");
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (!response.ok || !response.body) {
      throw new Error(`Package download failed with ${response.status}`);
    }

    await mkdir(path.dirname(outputPath), { recursive: true });
    await pipeline(Readable.fromWeb(response.body), createWriteStream(outputPath));
    return currentUrl;
  }
  throw new Error("Package download exceeded redirect limit");
}

export async function validateArchiveListing(packagePath) {
  const listing = await runCommand("tar", ["-tzf", packagePath], { capture: true, failedCommandLabel: "tar list" });
  const entries = listing.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  if (!entries.includes(deployManifestName)) {
    throw new Error(`Package is missing ${deployManifestName}`);
  }
  for (const entry of entries) {
    validatePackagePath(entry);
  }
  return entries;
}

export async function readAndValidateDeployManifest(stagePath, updateManifest) {
  const manifest = await readJson(path.join(stagePath, deployManifestName));
  if (manifest.appName !== "tldraw-ai-board") throw new Error("Deploy package appName is invalid");
  for (const key of ["version", "commit", "channel", "migrationMode", "entrypoint"]) {
    if (typeof manifest[key] !== "string" || manifest[key].trim() === "") {
      throw new Error(`Deploy package manifest field ${key} is invalid`);
    }
  }
  if (
    manifest.version !== updateManifest.version ||
    manifest.commit !== updateManifest.commit ||
    manifest.channel !== updateManifest.channel ||
    manifest.migrationMode !== updateManifest.migrationMode
  ) {
    throw new Error("Deploy package manifest does not match update manifest");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("Deploy package manifest files must be a non-empty array");
  }
  for (const file of manifest.files) {
    if (!file || typeof file.path !== "string" || typeof file.sha256 !== "string" || typeof file.size !== "number") {
      throw new Error("Deploy package manifest file entry is invalid");
    }
    if (!/^[a-fA-F0-9]{64}$/.test(file.sha256)) throw new Error(`Deploy file ${file.path} sha256 is invalid`);
    if (!Number.isInteger(file.size) || file.size < 0) throw new Error(`Deploy file ${file.path} size is invalid`);
    validatePackagePath(file.path);
  }
  validatePackagePath(manifest.entrypoint);
  await access(safeJoin(stagePath, manifest.entrypoint));
  return manifest;
}

export async function verifyExtractedFiles(stagePath, packageManifest) {
  const expected = new Map(packageManifest.files.map((file) => [normalizePackagePath(file.path), file]));
  for (const file of packageManifest.files) {
    const filePath = safeJoin(stagePath, file.path);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error(`Deploy file ${file.path} is not a file`);
    if (fileStat.size !== file.size) throw new Error(`Deploy file ${file.path} size mismatch`);
    const actualSha = await sha256File(filePath);
    if (actualSha.toLowerCase() !== file.sha256.toLowerCase()) {
      throw new Error(`Deploy file ${file.path} checksum mismatch`);
    }
  }

  const actualFiles = await listFiles(stagePath);
  for (const actualPath of actualFiles) {
    const relative = normalizePackagePath(path.relative(stagePath, actualPath));
    if (relative === deployManifestName) continue;
    validatePackagePath(relative);
    if (!expected.has(relative)) throw new Error(`Deploy package contains unlisted file ${relative}`);
  }
}

async function backupRuntime(runtimeBackupPath, packageManifest) {
  await rm(runtimeBackupPath, { force: true, recursive: true });
  await mkdir(runtimeBackupPath, { recursive: true });
  const roots = new Set(packageManifest.files.map((file) => normalizePackagePath(file.path).split("/")[0]));
  roots.add("deploy-manifest.json");
  for (const root of roots) {
    validatePackagePath(root);
    const source = path.join(appRoot, root);
    if (!await exists(source)) continue;
    const target = path.join(runtimeBackupPath, root);
    await copyPathFiltered(source, target);
  }
}

async function backupSqliteFiles(dataBackupPath) {
  await rm(dataBackupPath, { force: true, recursive: true });
  await mkdir(dataBackupPath, { recursive: true });
  const prismaDir = path.join(appRoot, "prisma");
  if (!await exists(prismaDir)) return;
  const entries = await readdir(prismaDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\.db(?:-(?:wal|shm))?$/.test(entry.name)) continue;
    await copyFile(path.join(prismaDir, entry.name), path.join(dataBackupPath, entry.name));
  }
}

async function installStagedRuntime(stagePath, packageManifest) {
  const roots = new Set(packageManifest.files.map((file) => normalizePackagePath(file.path).split("/")[0]));
  roots.add(deployManifestName);
  for (const root of roots) {
    validatePackagePath(root);
    await removePathFiltered(path.join(appRoot, root));
  }
  for (const file of packageManifest.files) {
    validatePackagePath(file.path);
    const source = safeJoin(stagePath, file.path);
    const target = safeJoin(appRoot, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  await copyFile(path.join(stagePath, deployManifestName), path.join(appRoot, deployManifestName));
}

async function restoreRuntimeBackup(runtimeBackupPath) {
  const files = await listFiles(runtimeBackupPath);
  for (const filePath of files) {
    const relative = normalizePackagePath(path.relative(runtimeBackupPath, filePath));
    validatePackagePath(relative);
    const target = safeJoin(appRoot, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(filePath, target);
  }
}

async function restoreDataBackup(dataBackupPath) {
  const prismaDir = path.join(appRoot, "prisma");
  await mkdir(prismaDir, { recursive: true });
  const entries = await readdir(dataBackupPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !/\.db(?:-(?:wal|shm))?$/.test(entry.name)) continue;
    await copyFile(path.join(dataBackupPath, entry.name), path.join(prismaDir, entry.name));
  }
}

export async function refreshRecoveryFile(context, activePhase, failedCommand = "") {
  await mkdir(jobsDir, { recursive: true });
  await writeFile(
    context.recoveryPath,
    `# Update Recovery ${context.job.id}

- Source version: ${context.job.fromVersion}
- Target version: ${context.job.toVersion}
- Active phase: ${activePhase}
- Last successful phase: ${context.lastSuccessfulPhase}
- Failed command: ${failedCommand || "none"}
- Runtime backup: ${context.runtimeBackupPath}
- Data backup: ${context.dataBackupPath}
- Dry run: ${dryRun ? "yes" : "no"}

Manual outline:

1. Inspect ${jobPath(context.job.id)}.
2. Inspect service logs with \`journalctl -u ${serviceName} -n 200 --no-pager\`.
3. Restore runtime backup from ${context.runtimeBackupPath} if it exists.
4. Restore SQLite files from ${context.dataBackupPath} if migration failed.
5. Restart with \`systemctl restart ${serviceName}\`.
`,
  );
}

export function getAllowedCommand(name) {
  const command = allowedCommands[name];
  if (!command) throw new Error(`Updater command ${name} is not allowed`);
  return command;
}

export function runAllowedCommand(name, options = {}) {
  const [command, args] = getAllowedCommand(name);
  return runCommand(command, args, options);
}

async function waitForHealth() {
  const healthUrl = getUpdaterHealthUrl();
  const deadline = Date.now() + Number.parseInt(process.env.UPDATE_HEALTH_TIMEOUT_MS || "90000", 10);
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl, { headers: { Accept: "application/json" } });
      if (response.ok) {
        const payload = await response.json();
        if (payload?.ok === true) return;
      }
      lastError = `health returned ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(2000);
  }
  throw withReason(new Error(`Health check failed: ${lastError || "timeout"}`), "health_check_failed");
}

async function assertRunningVersion(expectedVersion) {
  const versionUrl = getUpdaterVersionUrl();
  const response = await fetch(versionUrl, { headers: { Accept: "application/json" } });
  if (!response.ok) throw withReason(new Error(`Version check failed with ${response.status}`), "version_mismatch");
  const payload = await response.json();
  const actualVersion = payload?.version ?? payload?.current?.version;
  if (actualVersion !== expectedVersion) {
    throw withReason(new Error(`Version mismatch after update: expected ${expectedVersion}, got ${actualVersion || "unknown"}`), "version_mismatch");
  }
}

export function getUpdaterHealthUrl() {
  return process.env.UPDATE_HEALTH_URL || `http://127.0.0.1:${process.env.PORT || defaultServicePort}/api/system/health`;
}

export function getUpdaterVersionUrl() {
  return process.env.UPDATE_VERSION_URL || `http://127.0.0.1:${process.env.PORT || defaultServicePort}/api/system/version`;
}

async function patchJob(jobId, patch) {
  const existing = await readJson(jobPath(jobId));
  const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  await writeJsonAtomic(jobPath(jobId), next);
  await writeJsonAtomic(currentJobPath, next);
  return next;
}

async function releaseLockIfCurrent(jobId) {
  try {
    const lock = await readJson(lockPath);
    if (!lock?.jobId || lock.jobId === jobId) await unlink(lockPath);
  } catch {
    // Lock may already be removed during manual recovery.
  }
}

async function ensureDirs() {
  await mkdir(jobsDir, { recursive: true });
  await mkdir(packagesDir, { recursive: true });
  await mkdir(stagingRoot, { recursive: true });
  await mkdir(backupsRoot, { recursive: true });
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: appRoot,
      shell: false,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (child.stdout) child.stdout.on("data", (chunk) => { stdout += chunk; });
    if (child.stderr) child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      reject(withReason(error, reasonForCommand(options.failedCommandLabel || command)));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(withReason(
        new Error(`${command} ${args.join(" ")} failed with exit code ${code}${stderr ? `\n${stderr}` : ""}`),
        reasonForCommand(options.failedCommandLabel || command),
      ));
    });
  });
}

async function copyPathFiltered(source, target) {
  const sourceStat = await stat(source);
  const relative = normalizePackagePath(path.relative(appRoot, source));
  if (relative && isProtectedPackagePath(relative)) return;
  if (sourceStat.isDirectory()) {
    await mkdir(target, { recursive: true });
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      await copyPathFiltered(path.join(source, entry.name), path.join(target, entry.name));
    }
    return;
  }
  if (sourceStat.isFile()) {
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
}

async function removePathFiltered(targetPath) {
  if (!await exists(targetPath)) return;
  const relative = normalizePackagePath(path.relative(appRoot, targetPath));
  if (relative && isProtectedPackagePath(relative)) return;
  const targetStat = await stat(targetPath);
  if (targetStat.isDirectory()) {
    const entries = await readdir(targetPath, { withFileTypes: true });
    for (const entry of entries) {
      await removePathFiltered(path.join(targetPath, entry.name));
    }
    await rm(targetPath, { force: true, recursive: false }).catch(() => null);
    return;
  }
  if (targetStat.isFile()) {
    await rm(targetPath, { force: true });
  }
}

async function listFiles(root) {
  const rootStat = await stat(root);
  if (rootStat.isFile()) return [root];
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function assertAllowedPackageUrl(rawUrl, allowedHosts) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid package URL");
  }
  if (parsed.protocol !== "https:" && process.env.NODE_ENV === "production") {
    throw new Error("Package URL must use HTTPS");
  }
  if (!allowedHosts.includes(parsed.hostname)) {
    throw new Error(`Package URL host ${parsed.hostname} is not allowed`);
  }
}

function getAllowedPackageHosts() {
  const hosts = process.env.UPDATE_PACKAGE_ALLOWED_HOSTS?.split(",").map((host) => host.trim()).filter(Boolean);
  return hosts?.length ? hosts : allowedPackageHostsFallback;
}

function validatePackagePath(filePath) {
  const normalized = normalizePackagePath(filePath);
  if (!normalized || normalized === "." || normalized === deployManifestName) return normalized;
  if (path.isAbsolute(filePath) || normalized.startsWith("/") || normalized.includes("../") || normalized === "..") {
    throw new Error(`Invalid package file path ${filePath}`);
  }
  if (isProtectedPackagePath(normalized)) {
    throw new Error(`Package file path ${filePath} is protected`);
  }
  return normalized;
}

function isProtectedPackagePath(normalizedPath) {
  const forbiddenPatterns = [
    /^\.env$/,
    /^prisma\/.*\.db(?:-.+)?$/,
    /^public\/uploads(?:\/|$)/,
    /^dist\/client\/uploads(?:\/|$)/,
    /^generated-images(?:\/|$)/,
    /^exports(?:\/|$)/,
    /^local-exports(?:\/|$)/,
    /^tmp\/updates(?:\/|$)/,
    /^node_modules(?:\/|$)/,
  ];
  return forbiddenPatterns.some((pattern) => pattern.test(normalizedPath));
}

function normalizePackagePath(filePath) {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function safeJoin(root, relativePath) {
  const normalized = validatePackagePath(relativePath);
  const resolved = path.resolve(root, normalized);
  const resolvedRoot = path.resolve(root);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Path ${relativePath} escapes ${root}`);
  }
  return resolved;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tempPath, filePath);
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function assertSafeJobId(jobId) {
  if (!/^update-[a-zA-Z0-9-]+$/.test(jobId)) throw new Error("Invalid update job id");
}

function jobPath(jobId) {
  assertSafeJobId(jobId);
  return path.join(jobsDir, `${jobId}.json`);
}

function manifestSnapshotPath(jobId) {
  assertSafeJobId(jobId);
  return path.join(jobsDir, `${jobId}-manifest.json`);
}

function reasonForCommand(label) {
  if (/init-db|migration/i.test(label)) return "migration_failed";
  if (/restart|stop|systemctl/i.test(label)) return "restart_failed";
  return "install_failed";
}

function withReason(error, reason) {
  error.updateFailureReason = reason;
  return error;
}

function getFailureReason(error) {
  return error?.updateFailureReason || "install_failed";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === modulePath;
if (isMain) {
  const jobId = process.argv[2];
  if (!jobId) {
    throw new Error("Usage: node scripts/systemd-updater.mjs <jobId>");
  }
  if (terminalStatuses.size === 0) throw new Error("Updater terminal status set is unavailable");
  runUpdateJob(jobId).catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
