import type { FastifyInstance } from "fastify";

import { saveLocalExport } from "@/lib/local-export";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "../auth";
import { jsonError } from "../http";

export async function registerExportRoutes(app: FastifyInstance) {
  app.post("/api/exports", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;

    const data = await request.file();
    if (!data) return jsonError(reply, "file is required");

    const boardId = String(data.fields.boardId && "value" in data.fields.boardId ? data.fields.boardId.value : "");
    const filename = String(data.fields.filename && "value" in data.fields.filename ? data.fields.filename.value : "");
    if (!boardId) return jsonError(reply, "boardId is required");
    if (!filename) return jsonError(reply, "filename is required");

    const board = await prisma.board.findFirst({
      where: { id: boardId, userId: user.id },
      select: { name: true },
    });
    if (!board) return jsonError(reply, "Board not found", 404);

    const output = await saveLocalExport({
      bytes: await data.toBuffer(),
      filename,
      projectName: board.name,
    });

    return { output };
  });
}
