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
