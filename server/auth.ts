import { compare, hash } from "bcryptjs";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

import { getAdminUsername, isLocalVariant, localUserId } from "@/lib/app-variant";
import { prisma } from "@/lib/prisma";
import { jsonError } from "./http";

const sessionCookieName = "ai_board_session";
const sessionDurationMs = 30 * 24 * 60 * 60 * 1000;
const sessionCookieDomain = process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined;

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

type SessionPayload = {
  expiresAt: number;
  issuedAt: number;
  userId: string;
};

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured");
  return secret;
}

export function signSession(payload: SessionPayload, secret = getAuthSecret()) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifySession(token: string | undefined, secret = getAuthSecret()) {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(signatureBuffer, expectedBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.userId || payload.expiresAt < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function setSessionCookie(reply: FastifyReply, userId: string) {
  const now = Date.now();
  const token = signSession({ expiresAt: now + sessionDurationMs, issuedAt: now, userId });
  reply.setCookie(sessionCookieName, token, {
    domain: sessionCookieDomain,
    httpOnly: true,
    maxAge: Math.floor(sessionDurationMs / 1000),
    path: "/",
    sameSite: "lax",
    secure: process.env.AUTH_URL?.startsWith("https://") ?? false,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(sessionCookieName, { domain: sessionCookieDomain, path: "/" });
}

export async function getCurrentUser(request: FastifyRequest) {
  if (isLocalVariant()) return ensureLocalUser();
  const session = verifySession(request.cookies[sessionCookieName]);
  if (!session) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      canUseAdminProvider: true,
      email: true,
      generationFiveHourLimit: true,
      generationLimit: true,
      id: true,
      image: true,
      name: true,
      role: true,
      status: true,
      username: true,
    },
  });
  if (!user || (user.role !== "admin" && user.status !== "approved")) return null;
  return user;
}

export async function requireCurrentUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await getCurrentUser(request);
  if (!user) {
    jsonError(reply, "Authentication required", 401);
    return null;
  }
  return user;
}

export async function requireAdminUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await requireCurrentUser(request, reply);
  if (!user) return null;
  if (isLocalVariant()) return user;
  if (user.username !== getAdminUsername() || user.role !== "admin") {
    jsonError(reply, "Admin access required", 403);
    return null;
  }
  return user;
}

export async function ensureLocalUser() {
  return prisma.user.upsert({
    create: {
      canUseAdminProvider: true,
      generationFiveHourLimit: null,
      generationLimit: null,
      id: localUserId,
      name: "Local User",
      role: "admin",
      status: "approved",
      username: "local",
    },
    select: {
      canUseAdminProvider: true,
      email: true,
      generationFiveHourLimit: true,
      generationLimit: true,
      id: true,
      image: true,
      name: true,
      role: true,
      status: true,
      username: true,
    },
    update: {
      canUseAdminProvider: true,
      generationFiveHourLimit: null,
      generationLimit: null,
      name: "Local User",
      role: "admin",
      status: "approved",
      username: "local",
    },
    where: { id: localUserId },
  });
}

export async function validatePasswordLogin(username: string, password: string) {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user?.passwordHash) return { ok: false as const, reason: "invalid" };
  const valid = await compare(password, user.passwordHash);
  if (!valid) return { ok: false as const, reason: "invalid" };
  if (user.role !== "admin" && user.status !== "approved") {
    return { ok: false as const, reason: user.status === "rejected" || user.status === "disabled" ? "rejected" : "pending" };
  }
  return { ok: true as const, user };
}

export async function createPendingUser(username: string, password: string) {
  const passwordHash = await hash(password, 12);
  return prisma.user.create({
    data: {
      canUseAdminProvider: false,
      generationFiveHourLimit: 10,
      generationLimit: 30,
      name: username,
      passwordHash,
      role: "user",
      status: "pending",
      username,
    },
  });
}

export function publicUser(user: CurrentUser) {
  return {
    canUseAdminProvider: user.canUseAdminProvider,
    email: user.email,
    generationFiveHourLimit: user.generationFiveHourLimit,
    generationLimit: user.generationLimit,
    id: user.id,
    image: user.image,
    name: user.name,
    role: user.role,
    status: user.status,
    username: user.username,
  };
}
