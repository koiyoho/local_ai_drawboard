import "dotenv/config";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createApp } from "./app";

const port = Number(process.env.PORT ?? 3333);
const host = process.env.HOST ?? "0.0.0.0";
const execFileAsync = promisify(execFile);

async function main() {
  await execFileAsync(process.execPath, ["scripts/init-db.mjs"], { cwd: process.cwd() });
  const app = await createApp();
  await app.listen({ host, port });
}

void main();
