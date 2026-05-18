import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { Asset } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "../auth";
import {
  createAndRunImageGenerationJob,
  createImageGenerationJob,
  imageGenerationInputSchema,
  runCreatedImageGenerationJob,
} from "../generation-job-service";
import { jsonError, parseBody } from "../http";

const STALE_RUNNING_JOB_MINUTES = 30;
const STALE_RUNNING_JOB_MESSAGE = "任务运行超过 30 分钟，已在服务启动时标记为失败，请重新提交生成任务";
const generationJobRequestSchema = imageGenerationInputSchema.extend({
  waitForCompletion: z.boolean().default(true),
});
const activeGenerationStatuses = ["preparing", "calling_model", "saving_results", "running"];

export async function registerGenerationJobRoutes(app: FastifyInstance) {
  await markStaleRunningJobsFailed(app);

  app.post("/api/generation-jobs", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const parsed = parseBody(generationJobRequestSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const board = await prisma.board.findFirst({ where: { id: parsed.data.boardId, userId: user.id }, select: { name: true } });
    if (!board) return jsonError(reply, "Board not found", 404);
    if (!parsed.data.waitForCompletion) {
      const result = await createImageGenerationJob({
        boardName: board.name,
        generation: parsed.data,
        log: request.log,
        user,
      });
      if (!result.ok) return jsonError(reply, result.error, result.statusCode);
      void runCreatedImageGenerationJob({ ...result, log: request.log });
      reply.code(202);
      return { job: { ...result.job, results: [] }, model: result.model, results: [] };
    }
    const result = await createAndRunImageGenerationJob({
      boardName: board.name,
      generation: parsed.data,
      log: request.log,
      user,
    });
    if (!result.ok) return jsonError(reply, result.error, result.statusCode);
    return { job: result.job, model: result.model, results: result.results };
  });

  app.get<{ Params: { jobId: string } }>("/api/generation-jobs/:jobId", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const job = await prisma.generationJob.findFirst({
      where: { id: request.params.jobId, board: { userId: user.id } },
      include: { results: { include: { asset: true } } },
    });
    if (!job) return jsonError(reply, "Generation job not found", 404);
    return { job, results: job.results.map((result: { asset: Asset }) => result.asset) };
  });
}

async function markStaleRunningJobsFailed(app: FastifyInstance) {
  const cutoff = new Date(Date.now() - STALE_RUNNING_JOB_MINUTES * 60 * 1000);
  const result = await prisma.generationJob.updateMany({
    where: { createdAt: { lt: cutoff }, status: { in: activeGenerationStatuses } },
    data: { errorMessage: STALE_RUNNING_JOB_MESSAGE, status: "failed" },
  });
  if (result.count > 0) {
    app.log.warn({ count: result.count }, "marked stale running generation jobs as failed");
  }
}
