import type { FastifyReply } from "fastify";
import type { ZodType } from "zod";

export function jsonError(reply: FastifyReply, message: string, status = 400) {
  return reply.status(status).send({ error: message });
}

export function parseBody<T>(schema: ZodType<T>, value: unknown) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }
  return { ok: true as const, data: parsed.data };
}

export function getErrorMessage(error: unknown, fallback = "Request failed") {
  return error instanceof Error ? error.message : fallback;
}
