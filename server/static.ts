import staticPlugin from "@fastify/static";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";

import { getAppVariant, getUpdateChannel } from "@/lib/app-variant";

const runtimeConfigMarker = "</head>";

export function getPublicRuntimeConfigScript() {
  const config = {
    apiBaseUrl: process.env.VITE_API_BASE_URL ?? "",
    appVariant: getAppVariant(),
    updateChannel: getUpdateChannel(),
  };
  return `<script>window.__AIBOARD_RUNTIME_CONFIG__=${JSON.stringify(config).replace(/</g, "\\u003c")};</script>`;
}

export function injectPublicRuntimeConfig(html: string) {
  const script = getPublicRuntimeConfigScript();
  if (!html.includes(runtimeConfigMarker)) return `${script}${html}`;
  return html.replace(runtimeConfigMarker, `${script}\n  ${runtimeConfigMarker}`);
}

export async function registerStaticRoutes(app: FastifyInstance) {
  const root = path.join(process.cwd(), "dist", "client");
  if (existsSync(root)) {
    await app.register(staticPlugin, { root, prefix: "/" });
  }

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.status(404).send({ error: "Not found" });
    }
    const indexPath = path.join(root, "index.html");
    if (!existsSync(indexPath)) {
      return reply.status(503).send("Client build not found. Run npm run build first.");
    }
    reply.type("text/html");
    return injectPublicRuntimeConfig(await readFile(indexPath, "utf8"));
  });
}
