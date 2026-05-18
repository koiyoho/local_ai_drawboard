import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireAdminUser } from "../auth";
import { jsonError, parseBody } from "../http";
import {
  CodexOAuthConfigError,
  createCodexAuthorizeUrl,
  getCodexOAuthStartDisabledReason,
  handleCodexCallback,
  importCodexAuthJson,
  importCodexCliAuth,
  isCodexOAuthStartAvailable,
  readCodexAuthStatus,
} from "../lib/codex-oauth";

const importCodexAuthBodySchema = z.object({
  authJson: z.string().trim().min(2).max(200_000),
});

export async function registerCodexAuthRoutes(app: FastifyInstance) {
  app.get("/api/codex-auth/start", async (request, reply) => {
    const user = await requireAdminUser(request, reply);
    if (!user) return;
    if (!isCodexOAuthStartAvailable()) {
      return jsonError(reply, getCodexOAuthStartDisabledReason() ?? "Codex OAuth is not configured", 400);
    }

    try {
      const requestOrigin = getRequestOrigin(request);
      const authorizeUrl = await createCodexAuthorizeUrl({
        adminUserId: user.id,
        requestOrigin,
      });
      return reply.redirect(authorizeUrl, 302);
    } catch (error) {
      if (error instanceof CodexOAuthConfigError) {
        return jsonError(reply, error.message, 500);
      }
      request.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Codex OAuth start failed");
      return jsonError(reply, "Codex OAuth start failed", 500);
    }
  });

  app.get("/api/codex-auth/status", async (request, reply) => {
    const user = await requireAdminUser(request, reply);
    if (!user) return;
    return readCodexAuthStatus();
  });

  app.post("/api/codex-auth/import-cli", async (request, reply) => {
    const user = await requireAdminUser(request, reply);
    if (!user) return;
    try {
      return await importCodexCliAuth();
    } catch (error) {
      request.log.warn({ errorType: error instanceof Error ? error.name : "unknown" }, "Codex CLI auth import failed");
      return jsonError(reply, error instanceof Error ? error.message : "Codex CLI auth import failed", 400);
    }
  });

  app.post("/api/codex-auth/import-json", async (request, reply) => {
    const user = await requireAdminUser(request, reply);
    if (!user) return;
    const parsed = parseBody(importCodexAuthBodySchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    try {
      return await importCodexAuthJson(parsed.data.authJson);
    } catch (error) {
      request.log.warn({ errorType: error instanceof Error ? error.name : "unknown" }, "Codex auth.json import failed");
      return jsonError(reply, error instanceof Error ? error.message : "Codex auth.json import failed", 400);
    }
  });

  app.get("/api/codex-auth/callback", async (request, reply) => {
    const callbackUrl = new URL(request.url, getRequestOrigin(request));
    const result = await handleCodexCallback(callbackUrl);
    return reply.code(result.status).type("text/html; charset=utf-8").send(result.body);
  });
}

function getRequestOrigin(request: FastifyRequest) {
  const forwardedProto = firstHeader(request.headers["x-forwarded-proto"]);
  const forwardedHost = firstHeader(request.headers["x-forwarded-host"]);
  const host = forwardedHost || firstHeader(request.headers.host) || request.hostname || "localhost";
  const protocol = forwardedProto || request.protocol || "http";
  return `${protocol}://${host}`;
}

function firstHeader(value: unknown) {
  if (Array.isArray(value)) return value[0];
  return typeof value === "string" && value ? value : null;
}
