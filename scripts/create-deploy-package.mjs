import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  deployManifestPath,
  deployPackageEntries,
  deployPackageExcludes,
  isForbiddenDeployPackagePath,
} from "./deploy-package-manifest.mjs";

const defaultOutputPath = path.join("tmp", "aiboard-runtime-deploy.tar.gz");
const outputPath = getOutputPath(process.argv.slice(2));

await mkdir(path.dirname(outputPath), { recursive: true });
await rm(outputPath, { force: true });
await writeDeployManifest();

const createArgs = [
  ...deployPackageExcludes.map((pattern) => `--exclude=${pattern}`),
  "-czf",
  outputPath,
  ...deployPackageEntries,
];

await run("tar", createArgs);

const listing = await run("tar", ["-tzf", outputPath], { capture: true });
const packageEntries = listing
  .split(/\r?\n/)
  .map((entry) => entry.trim())
  .filter(Boolean);
const forbiddenEntries = packageEntries.filter(isForbiddenDeployPackagePath);
if (forbiddenEntries.length > 0) {
  await rm(outputPath, { force: true });
  throw new Error(`Deploy package contains forbidden production data:\n${forbiddenEntries.join("\n")}`);
}
if (!packageEntries.includes(deployManifestPath)) {
  await rm(outputPath, { force: true });
  throw new Error(`Deploy package is missing ${deployManifestPath}`);
}

console.log(`Created ${outputPath}`);
console.log(`Entries: ${packageEntries.length}`);

function getOutputPath(args) {
  const outputIndex = args.findIndex((arg) => arg === "--output" || arg === "-o");
  if (outputIndex === -1) return defaultOutputPath;
  const value = args[outputIndex + 1];
  if (!value) throw new Error("--output requires a path");
  return value;
}

async function writeDeployManifest() {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const versionMetadata = await readVersionMetadata();
  const files = [];
  for (const entry of deployPackageEntries.filter((entry) => entry !== deployManifestPath)) {
    const listed = await listFiles(entry);
    for (const filePath of listed) {
      const normalizedPath = filePath.replaceAll("\\", "/");
      if (isForbiddenDeployPackagePath(normalizedPath)) continue;
      files.push({
        path: normalizedPath,
        sha256: await sha256File(filePath),
        size: (await stat(filePath)).size,
      });
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  await writeFile(
    deployManifestPath,
    `${JSON.stringify(
      {
        appName: "local-ai-drawboard",
        channel: versionMetadata.updateChannel,
        commit: versionMetadata.commit ?? "unknown",
        entrypoint: "dist/server/server/index.js",
        files,
        migrationMode: process.env.UPDATE_MIGRATION_MODE || "none",
        version: packageJson.version,
      },
      null,
      2,
    )}\n`,
  );
}

async function readVersionMetadata() {
  try {
    return JSON.parse(await readFile(path.join("dist", "server", "version.json"), "utf8"));
  } catch {
    return {
      commit: process.env.GIT_COMMIT || "unknown",
      updateChannel: process.env.UPDATE_CHANNEL || (process.env.APP_VARIANT === "local" ? "local" : "stable"),
    };
  }
}

async function listFiles(entry) {
  const stats = await stat(entry);
  if (stats.isFile()) return [entry];
  if (!stats.isDirectory()) return [];
  const children = await readdir(entry);
  const nested = await Promise.all(children.map((name) => listFiles(path.join(entry, name))));
  return nested.flat();
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

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      shell: false,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (child.stdout) child.stdout.on("data", (chunk) => { stdout += chunk; });
    if (child.stderr) child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}${stderr ? `\n${stderr}` : ""}`));
    });
  });
}
