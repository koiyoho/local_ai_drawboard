import staticPlugin from "@fastify/static";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";

import { getAppVariant, getUpdateChannel } from "@/lib/app-variant";

const runtimeConfigMarker = "</head>";
const immutableCacheControl = "public, max-age=31536000, immutable";
const noCacheControl = "no-cache";
const shortStaticCacheControl = "public, max-age=3600, stale-while-revalidate=86400";
const immutableStaticPrefixes = [
  "assets/",
  "style-previews/",
  "tldraw-translations/",
];

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

export function getStaticCacheControl(filePath: string, root = path.join(process.cwd(), "dist", "client")) {
  const relativePath = path.relative(root, filePath).replaceAll("\\", "/").replace(/^\/+/, "");
  const extension = path.extname(relativePath).toLowerCase();

  if (!relativePath || relativePath === "index.html" || extension === ".html") {
    return noCacheControl;
  }

  if (immutableStaticPrefixes.some((prefix) => relativePath.startsWith(prefix))) {
    return immutableCacheControl;
  }

  return shortStaticCacheControl;
}

function getServingRoot(filePath: string, roots: string[]) {
  const normalizedPath = path.resolve(filePath);
  return roots.find((root) => {
    const relativePath = path.relative(path.resolve(root), normalizedPath);
    return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
  });
}

export async function registerStaticRoutes(app: FastifyInstance) {
  const root = path.join(process.cwd(), "dist", "client");
  const publicRoot = path.join(process.cwd(), "public");
  const staticRoots = [publicRoot, root].filter((staticRoot) => existsSync(staticRoot));

  if (staticRoots.length > 0) {
    await app.register(staticPlugin, {
      cacheControl: false,
      prefix: "/",
      root: staticRoots,
      setHeaders(response, filePath) {
        response.setHeader("Cache-Control", getStaticCacheControl(filePath, getServingRoot(filePath, staticRoots)));
      },
    });
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
    reply.header("Cache-Control", noCacheControl);
    return injectPublicRuntimeConfig(await readFile(indexPath, "utf8"));
  });
}
