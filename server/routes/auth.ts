import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  clearSessionCookie,
  createPendingUser,
  getCurrentUser,
  publicUser,
  setSessionCookie,
  validatePasswordLogin,
} from "../auth";
import { isLocalVariant } from "@/lib/app-variant";
import { jsonError, parseBody } from "../http";
import { prisma } from "@/lib/prisma";

const credentialsSchema = z.object({
  password: z.string().min(1).max(128),
  username: z.string().trim().min(1).max(40),
});

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get("/api/auth/me", async (request, reply) => {
    const user = await getCurrentUser(request);
    if (!user) return jsonError(reply, "Authentication required", 401);
    return { user: publicUser(user) };
  });

  app.post("/api/auth/login", async (request, reply) => {
    if (isLocalVariant()) return jsonError(reply, "Password login is disabled in local mode", 404);
    const parsed = parseBody(credentialsSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const result = await validatePasswordLogin(parsed.data.username, parsed.data.password);
    if (!result.ok) return jsonError(reply, result.reason, 401);
    setSessionCookie(reply, result.user.id);
    return { user: publicUser(result.user) };
  });

  app.post("/api/auth/register", async (request, reply) => {
    if (isLocalVariant()) return jsonError(reply, "Registration is disabled in local mode", 404);
    const parsed = parseBody(credentialsSchema, request.body);
    if (!parsed.ok) return jsonError(reply, "invalid_registration");
    const existing = await prisma.user.findUnique({ where: { username: parsed.data.username } });
    if (existing) return jsonError(reply, "username_exists", 409);
    await createPendingUser(parsed.data.username, parsed.data.password);
    return reply.status(201).send({ ok: true });
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });
}
