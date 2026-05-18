import "dotenv/config";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createApp } from "./app";

const port = Number(process.env.PORT ?? getArgValue("--port") ?? 3333);
const host = process.env.HOST ?? "0.0.0.0";
const execFileAsync = promisify(execFile);

async function main() {
  await execFileAsync(process.execPath, ["scripts/init-db.mjs"], { cwd: process.cwd() });
  const app = await createApp();
  await app.listen({ host, port });
}

void main();

function getArgValue(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}
