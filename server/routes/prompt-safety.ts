import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { optimizePromptSafety } from "@/lib/prompt-safety";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "../auth";
import { jsonError, parseBody } from "../http";

const promptSafetySchema = z.object({
  boardId: z.string().min(1),
  mode: z.enum(["standard", "strict"]).default("standard"),
  prompt: z.string().trim().min(1).max(32000),
});

export async function registerPromptSafetyRoutes(app: FastifyInstance) {
  app.post("/api/prompt-safety/optimize", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;

    const parsed = parseBody(promptSafetySchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);

    const board = await prisma.board.findFirst({
      where: { id: parsed.data.boardId, userId: user.id },
      select: { id: true },
    });
    if (!board) return jsonError(reply, "Board not found", 404);

    return optimizePromptSafety(parsed.data.prompt, { mode: parsed.data.mode });
  });
}
