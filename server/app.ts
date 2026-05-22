import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import Fastify from "fastify";

import { registerAuthRoutes } from "./routes/auth";
import { registerAdminRoutes } from "./routes/admin";
import { registerAssetRoutes } from "./routes/assets";
import { registerBoardRoutes } from "./routes/boards";
import { registerCodexAuthRoutes } from "./routes/codex-auth";
import { registerExportRoutes } from "./routes/exports";
import { registerGenerationJobRoutes } from "./routes/generation-jobs";
import { registerGeminiBridgeRoutes } from "./routes/gemini-bridge";
import { registerPromptAssistRoutes } from "./routes/prompt-assist";
import { registerPromptRecipeRoutes } from "./routes/prompt-recipes";
import { registerPromptSafetyRoutes } from "./routes/prompt-safety";
import { registerProviderSettingRoutes } from "./routes/provider-settings";
import { registerStoryboardRoutes } from "./routes/storyboards";
import { registerSystemRoutes } from "./routes/system";
import { registerStaticRoutes } from "./static";

function applyCorsHeaders(reply: { header: (name: string, value: string) => unknown }, origin: string) {
  reply.header("Access-Control-Allow-Origin", origin);
  reply.header("Access-Control-Allow-Credentials", "true");
  reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  reply.header("Vary", "Origin");
}

export async function createApp() {
  const app = Fastify({ logger: true });
  const allowedCorsOrigins = new Set(
    (process.env.CORS_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && allowedCorsOrigins.has(origin)) {
      applyCorsHeaders(reply, origin);
      if (request.method === "OPTIONS") {
        reply.code(204).send();
      }
    }
  });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
  await app.register(registerAuthRoutes);
  await app.register(registerBoardRoutes);
  await app.register(registerAdminRoutes);
  await app.register(registerCodexAuthRoutes);
  await app.register(registerGeminiBridgeRoutes);
  await app.register(registerProviderSettingRoutes);
  await app.register(registerSystemRoutes);
  await app.register(registerAssetRoutes);
  await app.register(registerExportRoutes);
  await app.register(registerGenerationJobRoutes);
  await app.register(registerPromptAssistRoutes);
  await app.register(registerPromptSafetyRoutes);
  await app.register(registerPromptRecipeRoutes);
  await app.register(registerStoryboardRoutes);
  await registerStaticRoutes(app);
  return app;
}
