import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { getAppVariant, getUpdateChannel } from "@/lib/app-variant";
import { prisma } from "@/lib/prisma";
import {
  type DeployPackageManifest,
  type UpdateManifest,
  deployPackageManifestSchema,
  parseUpdateManifest,
} from "@/lib/update-package-manifest";

export type CurrentVersion = {
  buildTime: string | null;
  commit: string | null;
  updateChannel: string;
  variant: string;
  version: string;
};

export type UpdateCheckResult = {
  applySupported: boolean;
  applyUnsupportedReason?: string;
  configured: boolean;
  current: CurrentVersion;
  manifest: UpdateManifest | null;
  reason?: string;
  updateAvailable: boolean;
};

export type UpdateJobStatus =
  | "queued"
  | "downloading"
  | "verifying"
  | "backing_up"
  | "staging"
  | "installing"
  | "restarting"
  | "health_checking"
  | "completed"
  | "failed"
  | "rolled_back";

export type RollbackStatus =
  | "not_needed"
  | "restored_runtime"
  | "restored_runtime_and_data"
  | "failed_manual_recovery_required";

export type UpdateFailureReason =
  | "backup_failed"
  | "install_failed"
  | "migration_failed"
  | "restart_failed"
  | "health_check_failed"
  | "version_mismatch"
  | "rollback_failed";

export type UpdateJobState = {
  channel: string;
  error?: string;
  failureReason?: UpdateFailureReason;
  fromVersion: string;
  id: string;
  lockExpiresAt: string;
  message: string;
  rollbackStatus: RollbackStatus;
  startedAt: string;
  status: UpdateJobStatus;
  step: string;
  toVersion: string;
  updatedAt: string;
  updaterPid?: number;
};

export type ApplyUpdateInput = {
  confirmedVersion?: string;
  forceReapply?: boolean;
};

const updateRoot = path.join(process.cwd(), "tmp", "updates");
const jobsDir = path.join(updateRoot, "jobs");
const packagesDir = path.join(updateRoot, "packages");
const stagingDir = path.join(updateRoot, "staging");
const currentJobPath = path.join(updateRoot, "current-update.json");
const lockPath = path.join(updateRoot, "update.lock");
const updaterScriptPath = path.join(process.cwd(), "scripts", "systemd-updater.mjs");
const terminalStatuses: UpdateJobStatus[] = ["completed", "failed", "rolled_back"];
const defaultManifestHosts = ["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"];
const defaultPackageHosts = ["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"];
const defaultUpdateLockTtlMs = 2 * 60 * 60 * 1000;

export async function getCurrentVersion(): Promise<CurrentVersion> {
  const metadata = await readBuildMetadata();
  return {
    buildTime: metadata.buildTime ?? process.env.BUILD_TIME ?? null,
    commit: metadata.commit ?? process.env.GIT_COMMIT ?? null,
    updateChannel: getUpdateChannel(),
    variant: getAppVariant(),
    version: metadata.version ?? process.env.npm_package_version ?? "0.0.0",
  };
}

export async function checkForUpdate(fetchImpl: typeof fetch = fetch): Promise<UpdateCheckResult> {
  const current = await getCurrentVersion();
  const applySupport = getUpdateApplySupport();
  const manifestUrl = process.env.UPDATE_MANIFEST_URL?.trim();
  if (!manifestUrl) {
    return {
      ...applySupport,
      configured: false,
      current,
      manifest: null,
      reason: "UPDATE_MANIFEST_URL is not configured",
      updateAvailable: false,
    };
  }

  try {
    assertAllowedUrl(manifestUrl, getAllowedManifestHosts(), "manifest");
  } catch (error) {
    return {
      ...applySupport,
      configured: true,
      manifest: null,
      current,
      reason: error instanceof Error ? error.message : "Manifest URL is not allowed",
      updateAvailable: false,
    };
  }

  const response = await fetchImpl(manifestUrl, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    return {
      ...applySupport,
      configured: true,
      current,
      manifest: null,
      reason: `Update manifest request failed with ${response.status}`,
      updateAvailable: false,
    };
  }

  let manifest: UpdateManifest;
  try {
    manifest = parseUpdateManifest(await response.json());
  } catch (error) {
    return {
      ...applySupport,
      configured: true,
      current,
      manifest: null,
      reason: error instanceof Error ? error.message : "Invalid update manifest",
      updateAvailable: false,
    };
  }

  if (manifest.channel !== current.updateChannel) {
    return {
      ...applySupport,
      configured: true,
      current,
      manifest,
      reason: `Manifest channel ${manifest.channel} does not match ${current.updateChannel}`,
      updateAvailable: false,
    };
  }

  try {
    assertAllowedUrl(manifest.packageUrl, getAllowedPackageHosts(), "package");
  } catch (error) {
    return {
      ...applySupport,
      configured: true,
      current,
      manifest,
      reason: error instanceof Error ? error.message : "Package URL is not allowed",
      updateAvailable: false,
    };
  }

  return {
    ...applySupport,
    configured: true,
    current,
    manifest,
    updateAvailable: isVersionGreater(manifest.version, current.version),
  };
}

export async function applyUpdate(input: ApplyUpdateInput = {}): Promise<{ jobId: string }> {
  const result = await checkForUpdate();
  if (!result.configured) throw new Error(result.reason ?? "Update manifest is not configured");
  if (!result.manifest) throw new Error(result.reason ?? "Update manifest is invalid");
  if (!result.updateAvailable && !input.forceReapply) throw new Error(result.reason ?? "No update is available");
  if (input.confirmedVersion && input.confirmedVersion !== result.manifest.version) {
    throw new Error("Confirmed version does not match latest update version");
  }
  if (!result.applySupported) {
    throw new Error(result.applyUnsupportedReason ?? "Automatic update apply is not supported in this environment");
  }
  if (result.manifest.migrationMode === "manual_required") {
    throw new Error("This update requires a manual upgrade");
  }

  await ensureUpdateDirs();
  await recoverStaleLock();

  const now = new Date();
  const jobId = `update-${formatJobTimestamp(now)}-${randomUUID().slice(0, 8)}`;
  const job: UpdateJobState = {
    channel: result.manifest.channel,
    fromVersion: result.current.version,
    id: jobId,
    lockExpiresAt: new Date(now.getTime() + getUpdateLockTtlMs()).toISOString(),
    message: "Update job queued",
    rollbackStatus: "not_needed",
    startedAt: now.toISOString(),
    status: "queued",
    step: "queued",
    toVersion: result.manifest.version,
    updatedAt: now.toISOString(),
  };

  const lockHandle = await acquireUpdateLock(job);
  try {
    await writeJson(jobPath(jobId), job);
    await writeJson(currentJobPath, job);
    await writeJson(manifestSnapshotPath(jobId), result.manifest);
    await lockHandle.close().catch(() => null);
    const updaterPid = startUpdaterProcess(jobId);
    await updateJob(jobId, {
      message: "Update handoff started",
      status: "queued",
      step: "handoff",
      updaterPid,
    });
    return { jobId };
  } catch (error) {
    await releaseUpdateLock();
    throw error;
  } finally {
    await lockHandle.close().catch(() => null);
  }
}

export async function getUpdateJob(jobId: string): Promise<UpdateJobState | null> {
  try {
    const job = JSON.parse(await readFile(jobPath(jobId), "utf8")) as UpdateJobState;
    return reconcileCompletedUpdateJob(job);
  } catch {
    return null;
  }
}

async function reconcileCompletedUpdateJob(job: UpdateJobState) {
  if (terminalStatuses.includes(job.status)) return job;
  if (job.fromVersion === job.toVersion) return job;
  const current = await getCurrentVersion();
  if (current.version !== job.toVersion) return job;
  const completedJob: UpdateJobState = {
    ...job,
    message: "Update completed; running version confirmed",
    status: "completed",
    step: "completed",
    updatedAt: new Date().toISOString(),
  };
  await writeJson(jobPath(job.id), completedJob);
  await writeJson(currentJobPath, completedJob);
  await releaseUpdateLock();
  return completedJob;
}

export function getUpdateLockTtlMs() {
  const rawValue = process.env.UPDATE_LOCK_TTL_MS?.trim();
  if (!rawValue) return defaultUpdateLockTtlMs;
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 5 * 60 * 1000) return defaultUpdateLockTtlMs;
  return parsed;
}

export async function getSystemHealth() {
  const current = await getCurrentVersion();
  await prisma.$queryRaw`SELECT 1`;
  return {
    ok: true,
    version: current,
  };
}

export function assertAllowedUrl(rawUrl: string, allowedHosts: string[], label: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid ${label} URL`);
  }
  if (parsed.protocol !== "https:" && process.env.NODE_ENV === "production") {
    throw new Error(`${label} URL must use HTTPS`);
  }
  if (!allowedHosts.includes(parsed.hostname)) {
    throw new Error(`${label} URL host ${parsed.hostname} is not allowed`);
  }
}

export function getAllowedManifestHosts() {
  return parseHostList(process.env.UPDATE_MANIFEST_ALLOWED_HOSTS, defaultManifestHosts);
}

export function getAllowedPackageHosts() {
  return parseHostList(process.env.UPDATE_PACKAGE_ALLOWED_HOSTS, defaultPackageHosts);
}

export function getUpdateApplySupport() {
  if (process.env.UPDATE_ALLOW_UNSUPPORTED_PLATFORM_APPLY === "1") {
    return { applySupported: true };
  }
  if (process.platform === "linux") {
    return { applySupported: true };
  }
  return {
    applySupported: false,
    applyUnsupportedReason: "Automatic update apply requires a systemd-managed Linux service. Re-run the local installer to update this installation.",
  };
}

export function validateDeployPackageManifest(value: unknown, updateManifest: UpdateManifest): DeployPackageManifest {
  const manifest = deployPackageManifestSchema.parse(value);
  if (
    manifest.version !== updateManifest.version ||
    manifest.commit !== updateManifest.commit ||
    manifest.channel !== updateManifest.channel ||
    manifest.migrationMode !== updateManifest.migrationMode
  ) {
    throw new Error("Deploy package manifest does not match update manifest");
  }
  for (const file of manifest.files) {
    validateRelativePackagePath(file.path);
  }
  return manifest;
}

async function readBuildMetadata() {
  const metadataPath = path.join(process.cwd(), "dist", "server", "version.json");
  try {
    return JSON.parse(await readFile(metadataPath, "utf8")) as Partial<CurrentVersion>;
  } catch {
    return {};
  }
}

async function ensureUpdateDirs() {
  await mkdir(jobsDir, { recursive: true });
  await mkdir(packagesDir, { recursive: true });
  await mkdir(stagingDir, { recursive: true });
}

async function acquireUpdateLock(job: UpdateJobState) {
  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(`${JSON.stringify(
      {
        jobId: job.id,
        lockExpiresAt: job.lockExpiresAt,
        startedAt: job.startedAt,
      },
      null,
      2,
    )}\n`);
    return handle;
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw new Error("Another update job is already active");
    }
    throw error;
  }
}

async function releaseUpdateLock() {
  await unlink(lockPath).catch(() => null);
}

async function recoverStaleLock() {
  let lock: { jobId?: string; lockExpiresAt?: string };
  try {
    lock = JSON.parse(await readFile(lockPath, "utf8")) as typeof lock;
  } catch {
    return;
  }
  const lockExpiresAt = lock.lockExpiresAt ? Date.parse(lock.lockExpiresAt) : Number.NaN;
  if (Number.isFinite(lockExpiresAt) && lockExpiresAt > Date.now()) {
    throw new Error("Another update job is already active");
  }
  if (lock.jobId) {
    const staleJob = await getUpdateJob(lock.jobId);
    if (staleJob && !terminalStatuses.includes(staleJob.status)) {
      await updateJob(staleJob.id, {
        error: "Update lock expired before the job reached a terminal state",
        failureReason: "install_failed",
        message: "Update job marked failed after stale lock recovery",
        status: "failed",
        step: "failed",
      });
    }
  }
  await unlink(lockPath).catch(() => null);
}

async function updateJob(jobId: string, patch: Partial<UpdateJobState>) {
  const existing = await getUpdateJob(jobId);
  if (!existing) throw new Error(`Update job ${jobId} not found`);
  const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  await writeJson(jobPath(jobId), next);
  await writeJson(currentJobPath, next);
  return next;
}

function startUpdaterProcess(jobId: string) {
  assertSafeJobId(jobId);
  if (process.env.UPDATE_DISABLE_UPDATER_START === "1") {
    return process.pid;
  }
  if (process.platform === "linux" && process.env.UPDATE_USE_SYSTEMD_RUN !== "0") {
    const child = spawn("systemd-run", [
      "--collect",
      `--unit=local-ai-drawboard-updater-${jobId}`,
      `--working-directory=${process.cwd()}`,
      ...getSystemdRunEnvironmentArgs(),
      process.execPath,
      updaterScriptPath,
      jobId,
    ], {
      detached: true,
      env: process.env,
      stdio: "ignore",
    });
    child.unref();
    return child.pid;
  }

  const child = spawn(process.execPath, [updaterScriptPath, jobId], {
    detached: true,
    env: process.env,
    stdio: "ignore",
  });
  child.unref();
  return child.pid;
}

function getSystemdRunEnvironmentArgs() {
  const passthroughPrefixes = ["UPDATE_", "APP_VARIANT", "DATABASE_URL", "NODE_ENV", "PORT"];
  return Object.entries(process.env)
    .filter(([key, value]) => Boolean(value) && passthroughPrefixes.some((prefix) => key === prefix || key.startsWith(prefix)))
    .flatMap(([key, value]) => (value ? ["--setenv", `${key}=${value}`] : []));
}

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  await renameWithRetry(tempPath, filePath);
}

async function renameWithRetry(source: string, target: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      if (!isRetriableRenameError(error) || attempt === 4) throw error;
      await sleep(25 * (attempt + 1));
    }
  }
}

function isRetriableRenameError(error: unknown) {
  if (!isNodeError(error) || typeof error.code !== "string") return false;
  return ["EACCES", "EPERM", "EBUSY"].includes(error.code);
}

function jobPath(jobId: string) {
  assertSafeJobId(jobId);
  return path.join(jobsDir, `${jobId}.json`);
}

function manifestSnapshotPath(jobId: string) {
  assertSafeJobId(jobId);
  return path.join(jobsDir, `${jobId}-manifest.json`);
}

function assertSafeJobId(jobId: string) {
  if (!/^update-[a-zA-Z0-9-]+$/.test(jobId)) throw new Error("Invalid update job id");
}

function formatJobTimestamp(date: Date) {
  return date.toISOString().replace(/\D/g, "").slice(0, 14);
}

function parseHostList(value: string | undefined, fallback: string[]) {
  const hosts = value?.split(",").map((host) => host.trim()).filter(Boolean);
  return hosts?.length ? hosts : fallback;
}

function validateRelativePackagePath(filePath: string) {
  const normalized = filePath.replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.includes("../") || normalized === "..") {
    throw new Error(`Invalid package file path ${filePath}`);
  }
  const forbiddenPatterns = [
    /^\.env$/,
    /^prisma\/.*\.db(?:-.+)?$/,
    /^public\/uploads(?:\/|$)/,
    /^dist\/client\/uploads(?:\/|$)/,
    /^generated-images(?:\/|$)/,
    /^exports(?:\/|$)/,
    /^local-exports(?:\/|$)/,
    /^tmp\/updates(?:\/|$)/,
  ];
  if (forbiddenPatterns.some((pattern) => pattern.test(normalized))) {
    throw new Error(`Package file path ${filePath} is protected`);
  }
}

function isVersionGreater(candidate: string, current: string) {
  const candidateParts = parseVersion(candidate);
  const currentParts = parseVersion(current);
  for (let index = 0; index < Math.max(candidateParts.length, currentParts.length); index += 1) {
    const candidatePart = candidateParts[index] ?? 0;
    const currentPart = currentParts[index] ?? 0;
    if (candidatePart > currentPart) return true;
    if (candidatePart < currentPart) return false;
  }
  return false;
}

function parseVersion(version: string) {
  return version
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
