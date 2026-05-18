import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { test } from "node:test";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
process.env.APP_VARIANT = "local";
process.env.UPDATE_CHANNEL = "local";
process.env.npm_package_version = packageJson.version;
delete process.env.UPDATE_MANIFEST_URL;
delete process.env.UPDATE_MANIFEST_ALLOWED_HOSTS;
delete process.env.UPDATE_PACKAGE_ALLOWED_HOSTS;
delete process.env.UPDATE_DISABLE_UPDATER_START;
await rm(new URL("../tmp/updates", import.meta.url), { force: true, recursive: true });

const {
  applyUpdate,
  assertAllowedUrl,
  checkForUpdate,
  getAllowedPackageHosts,
  getCurrentVersion,
  getUpdateJob,
  validateDeployPackageManifest,
} = await import("../dist/server/server/system-update.js");

test("getCurrentVersion exposes variant and update channel", async () => {
  const version = await getCurrentVersion();
  assert.equal(version.variant, "local");
  assert.equal(version.updateChannel, "local");
  assert.equal(version.version, packageJson.version);
});

test("checkForUpdate reports configuration status when manifest URL is missing", async () => {
  const result = await checkForUpdate();
  assert.equal(result.configured, false);
  assert.equal(result.updateAvailable, false);
  assert.match(result.reason, /UPDATE_MANIFEST_URL/);
});

test("checkForUpdate rejects disallowed manifest hosts before fetching", async () => {
  process.env.UPDATE_MANIFEST_URL = "https://updates.example.com/manifest.json";
  process.env.UPDATE_MANIFEST_ALLOWED_HOSTS = "github.com";
  let called = false;
  const result = await checkForUpdate(async () => {
    called = true;
    throw new Error("should not fetch");
  });
  assert.equal(called, false);
  assert.equal(result.updateAvailable, false);
  assert.match(result.reason, /not allowed/);
  delete process.env.UPDATE_MANIFEST_URL;
  delete process.env.UPDATE_MANIFEST_ALLOWED_HOSTS;
});

test("checkForUpdate rejects wrong channel and manual migration metadata parses", async () => {
  process.env.UPDATE_MANIFEST_URL = "https://github.com/org/repo/releases/latest/download/manifest.json";
  const result = await checkForUpdate(async () => Response.json({
    channel: "stable",
    commit: "abc123",
    migrationMode: "manual_required",
    packageUrl: "https://github.com/org/repo/releases/download/v1/aiboard.tar.gz",
    sha256: "a".repeat(64),
    version: "0.2.0",
  }));
  assert.equal(result.updateAvailable, false);
  assert.match(result.reason, /does not match/);
  delete process.env.UPDATE_MANIFEST_URL;
});

test("checkForUpdate reports available update with allowed package host", async () => {
  process.env.UPDATE_MANIFEST_URL = "https://github.com/org/repo/releases/latest/download/manifest.json";
  const result = await checkForUpdate(async () => Response.json({
    channel: "local",
    commit: "abc123",
    migrationMode: "none",
    packageUrl: "https://github.com/org/repo/releases/download/v1/aiboard.tar.gz",
    sha256: "b".repeat(64),
    version: "0.2.0",
  }));
  assert.equal(result.updateAvailable, true);
  assert.equal(result.manifest.migrationMode, "none");
  delete process.env.UPDATE_MANIFEST_URL;
});

test("applyUpdate blocks manual_required migration packages", async () => {
  process.env.UPDATE_MANIFEST_URL = "https://github.com/org/repo/releases/latest/download/manifest.json";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    channel: "local",
    commit: "abc123",
    migrationMode: "manual_required",
    packageUrl: "https://github.com/org/repo/releases/download/v1/aiboard.tar.gz",
    sha256: "f".repeat(64),
    version: "0.2.0",
  });
  try {
    await assert.rejects(
      () => applyUpdate(),
      /manual upgrade/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.UPDATE_MANIFEST_URL;
  }
});

test("applyUpdate blocks confirmedVersion mismatch", async () => {
  process.env.UPDATE_MANIFEST_URL = "https://github.com/org/repo/releases/latest/download/manifest.json";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    channel: "local",
    commit: "abc123",
    migrationMode: "none",
    packageUrl: "https://github.com/org/repo/releases/download/v1/aiboard.tar.gz",
    sha256: "c".repeat(64),
    version: "0.2.0",
  });
  try {
    await assert.rejects(
      () => applyUpdate({ confirmedVersion: "0.3.0" }),
      /Confirmed version/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.UPDATE_MANIFEST_URL;
  }
});

test("applyUpdate creates a handoff job without starting updater when disabled", async () => {
  process.env.UPDATE_MANIFEST_URL = "https://github.com/org/repo/releases/latest/download/manifest.json";
  process.env.UPDATE_DISABLE_UPDATER_START = "1";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    channel: "local",
    commit: "abc123",
    migrationMode: "none",
    packageUrl: "https://github.com/org/repo/releases/download/v1/aiboard.tar.gz",
    sha256: "c".repeat(64),
    version: "0.2.0",
  });
  try {
    const { jobId } = await applyUpdate({ confirmedVersion: "0.2.0" });
    const job = await getUpdateJob(jobId);
    assert.equal(job.status, "queued");
    assert.equal(job.step, "handoff");
    assert.equal(job.updaterPid, process.pid);
    const manifest = JSON.parse(await readFile(new URL(`../tmp/updates/jobs/${jobId}-manifest.json`, import.meta.url), "utf8"));
    assert.equal(manifest.version, "0.2.0");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.UPDATE_MANIFEST_URL;
    delete process.env.UPDATE_DISABLE_UPDATER_START;
    await rm(new URL("../tmp/updates", import.meta.url), { force: true, recursive: true });
  }
});

test("allowed package hosts can be narrowed by environment", () => {
  process.env.UPDATE_PACKAGE_ALLOWED_HOSTS = "downloads.example.com";
  assert.deepEqual(getAllowedPackageHosts(), ["downloads.example.com"]);
  assert.doesNotThrow(() => assertAllowedUrl("https://downloads.example.com/app.tar.gz", getAllowedPackageHosts(), "package"));
  assert.throws(() => assertAllowedUrl("https://github.com/app.tar.gz", getAllowedPackageHosts(), "package"), /not allowed/);
  delete process.env.UPDATE_PACKAGE_ALLOWED_HOSTS;
});

test("validateDeployPackageManifest rejects protected file paths and manifest mismatch", () => {
  const updateManifest = {
    channel: "local",
    commit: "abc123",
    migrationMode: "none",
    packageUrl: "https://github.com/org/repo/releases/download/v1/aiboard.tar.gz",
    sha256: "d".repeat(64),
    version: "0.2.0",
  };
  assert.throws(
    () => validateDeployPackageManifest({
      appName: "tldraw-ai-board",
      channel: "local",
      commit: "abc123",
      entrypoint: "dist/server/server/index.js",
      files: [{ path: "prisma/dev.db", sha256: "e".repeat(64), size: 12 }],
      migrationMode: "none",
      version: "0.2.0",
    }, updateManifest),
    /protected/,
  );
  assert.throws(
    () => validateDeployPackageManifest({
      appName: "tldraw-ai-board",
      channel: "stable",
      commit: "abc123",
      entrypoint: "dist/server/server/index.js",
      files: [{ path: "dist/server/server/index.js", sha256: "e".repeat(64), size: 12 }],
      migrationMode: "none",
      version: "0.2.0",
    }, updateManifest),
    /does not match/,
  );
});

test("getSystemHealth returns current version payload", async () => {
  const { getSystemHealth } = await import("../dist/server/server/system-update.js");
  const health = await getSystemHealth();
  assert.equal(health.ok, true);
  assert.equal(health.version.updateChannel, "local");
});
