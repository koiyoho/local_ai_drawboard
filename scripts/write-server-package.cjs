const childProcess = require("node:child_process");
const { readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
const variant = process.env.APP_VARIANT === "local" ? "local" : "main";

writeFileSync("dist/server/package.json", `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);
writeFileSync(
  "dist/server/version.json",
  `${JSON.stringify(
    {
      buildTime: new Date().toISOString(),
      commit: getGitCommit(),
      updateChannel: process.env.UPDATE_CHANNEL || (variant === "local" ? "local" : "stable"),
      variant,
      version: packageJson.version,
    },
    null,
    2,
  )}\n`,
);

function getGitCommit() {
  try {
    return childProcess.execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.env.GIT_COMMIT || null;
  }
}
