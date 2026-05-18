import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  deployManifestPath,
  deployPackageEntries,
  deployPackageExcludes,
  deployPackageManifestRequiredFields,
  isForbiddenDeployPackagePath,
} from "./deploy-package-manifest.mjs";

test("deploy package manifest includes runtime build outputs", () => {
  assert(deployPackageEntries.includes("dist"));
  assert(deployPackageEntries.includes(deployManifestPath));
  assert(deployPackageEntries.includes("package.json"));
  assert(deployPackageEntries.includes("package-lock.json"));
  assert(deployPackageEntries.includes("prisma"));
});

test("deploy package manifest records required package metadata fields", () => {
  assert.deepEqual(deployPackageManifestRequiredFields, [
    "appName",
    "version",
    "commit",
    "channel",
    "migrationMode",
    "entrypoint",
    "files",
  ]);
});

test("deploy package manifest excludes production data and generated local assets", () => {
  assert(deployPackageExcludes.includes("dist/client/uploads"));
  assert(deployPackageExcludes.includes("public/uploads"));
  assert(deployPackageExcludes.includes("prisma/*.db"));
  assert(deployPackageExcludes.includes(".env"));

  assert.equal(isForbiddenDeployPackagePath("dist/client/uploads/board/upload/a.png"), true);
  assert.equal(isForbiddenDeployPackagePath("public/uploads/board/generated/a.png"), true);
  assert.equal(isForbiddenDeployPackagePath("prisma/dev.db"), true);
  assert.equal(isForbiddenDeployPackagePath(".env"), true);
  assert.equal(isForbiddenDeployPackagePath("dist/client/assets/index.js"), false);
  assert.equal(isForbiddenDeployPackagePath("prisma/schema.prisma"), false);
});

test("system updater rejects protected package paths and arbitrary commands", async () => {
  const updater = await import("./systemd-updater.mjs");
  assert.throws(() => updater.getAllowedCommand("postinstallFromPackage"), /not allowed/);
  assert.deepEqual(updater.getAllowedCommand("restartGeminiBridgeService"), [
    "systemctl",
    ["try-restart", "local-ai-drawboard-gemini-bridge.service"],
  ]);

  const tempDir = await mkdtemp(path.join(tmpdir(), "aiboard-updater-test-"));
  try {
    await mkdir(path.join(tempDir, "prisma"), { recursive: true });
    await writeFile(path.join(tempDir, "deploy-manifest.json"), "{}");
    await writeFile(path.join(tempDir, "prisma", "dev.db"), "database");
    const packagePath = path.join(tempDir, "bad.tar.gz");
    await run("tar", ["-czf", packagePath, "-C", tempDir, "deploy-manifest.json", "prisma/dev.db"]);
    await assert.rejects(() => updater.validateArchiveListing(packagePath), /protected/);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("system updater defaults health and version checks to the production service port", async () => {
  const updater = await import("./systemd-updater.mjs");
  const originalPort = process.env.PORT;
  const originalHealthUrl = process.env.UPDATE_HEALTH_URL;
  const originalVersionUrl = process.env.UPDATE_VERSION_URL;
  try {
    delete process.env.PORT;
    delete process.env.UPDATE_HEALTH_URL;
    delete process.env.UPDATE_VERSION_URL;
    assert.equal(updater.getUpdaterHealthUrl(), "http://127.0.0.1:3333/api/system/health");
    assert.equal(updater.getUpdaterVersionUrl(), "http://127.0.0.1:3333/api/system/version");

    process.env.PORT = "3344";
    assert.equal(updater.getUpdaterHealthUrl(), "http://127.0.0.1:3344/api/system/health");
    assert.equal(updater.getUpdaterVersionUrl(), "http://127.0.0.1:3344/api/system/version");
  } finally {
    restoreEnv("PORT", originalPort);
    restoreEnv("UPDATE_HEALTH_URL", originalHealthUrl);
    restoreEnv("UPDATE_VERSION_URL", originalVersionUrl);
  }
});

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

test("system updater validates deploy manifest and extracted checksums", async () => {
  const updater = await import("./systemd-updater.mjs");
  const tempDir = await mkdtemp(path.join(tmpdir(), "aiboard-updater-test-"));
  try {
    const filePath = path.join(tempDir, "dist", "server", "server", "index.js");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "console.log('ok');\n");
    const sha256 = await sha256File(filePath);
    const updateManifest = {
      channel: "local",
      commit: "abc123",
      migrationMode: "none",
      packageUrl: "https://github.com/org/repo/releases/download/v1/aiboard.tar.gz",
      sha256: "a".repeat(64),
      version: "1.2.3",
    };
    await writeFile(path.join(tempDir, "deploy-manifest.json"), `${JSON.stringify({
      appName: "local-ai-drawboard",
      channel: "local",
      commit: "abc123",
      entrypoint: "dist/server/server/index.js",
      files: [{ path: "dist/server/server/index.js", sha256, size: (await readFile(filePath)).byteLength }],
      migrationMode: "none",
      version: "1.2.3",
    }, null, 2)}\n`);

    const manifest = await updater.readAndValidateDeployManifest(tempDir, updateManifest);
    assert.equal(manifest.version, "1.2.3");
    await updater.verifyExtractedFiles(tempDir, manifest);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

function run(command, args) {
  return new Promise((resolve, reject) => {
    import("node:child_process").then(({ spawn }) => {
      const child = spawn(command, args, { cwd: process.cwd(), shell: false, stdio: "ignore" });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${command} ${args.join(" ")} failed with ${code}`));
      });
    });
  });
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    import("node:crypto").then(({ createHash }) => {
      import("node:fs").then(({ createReadStream }) => {
        const hash = createHash("sha256");
        const stream = createReadStream(filePath);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolve(hash.digest("hex")));
      }).catch(reject);
    }).catch(reject);
  });
}
