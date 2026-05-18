import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";

await ensureEnvFile();
await run("npm", ["ci"]);
await run("npm", ["run", "db:generate"]);
await run("npm", ["run", "db:init"]);
await run("npm", ["run", "build"]);

console.log("");
console.log("Local setup complete.");
console.log("Start the app with:");
console.log("  npm run start -- --port 3010");
console.log("");
console.log("Then open http://localhost:3010");

async function ensureEnvFile() {
  if (existsSync(".env")) {
    console.log("Found existing .env, leaving it unchanged.");
    return;
  }

  if (existsSync(".env.local_board.example")) {
    await cp(".env.local_board.example", ".env");
    const secret = randomBytes(32).toString("hex");
    let envText = await readFile(".env", "utf8");
    envText = envText.replace(/^AUTH_SECRET=.*$/m, `AUTH_SECRET="${secret}"`);
    envText = ensureEnvLine(envText, "ADMIN_USERNAME", "local");
    await writeFile(".env", envText);
    console.log("Created .env from .env.local_board.example.");
    return;
  }

  const secret = randomBytes(32).toString("hex");
  await writeFile(
    ".env",
    [
      'DATABASE_URL="file:./prisma/local-board.db"',
      'APP_VARIANT="local"',
      `AUTH_SECRET="${secret}"`,
      'AUTH_URL="http://localhost:3010"',
      'ADMIN_USERNAME="local"',
      'UPDATE_CHANNEL="local"',
      'UPDATE_MANIFEST_URL=""',
      "",
    ].join("\n"),
  );
  console.log("Created .env with local defaults.");
}

function ensureEnvLine(envText, key, value) {
  if (new RegExp(`^${key}=`, "m").test(envText)) return envText;
  const suffix = envText.endsWith("\n") ? "" : "\n";
  return `${envText}${suffix}${key}="${value}"\n`;
}

function run(command, args) {
  const executable = isWindows ? `${command}.cmd` : command;
  const display = [command, ...args].join(" ");
  console.log(`\n> ${display}`);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${display} failed with exit code ${code}`));
    });
  });
}
