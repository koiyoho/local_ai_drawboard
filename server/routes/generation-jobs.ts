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
import { getProviderSetting } from "../provider-settings-helper";
import {
  createAndRunVideoGenerationJob,
  createVideoGenerationJob,
  resolveVideoModelSelection,
  runCreatedVideoGenerationJob as runCreatedVideoGenerationJobDefault,
} from "../video-generation-service";

const STALE_RUNNING_JOB_MINUTES = 30;
const STALE_RUNNING_JOB_MESSAGE = "任务运行超过 30 分钟，已在服务启动时标记为失败，请重新提交生成任务";
const CANCELLED_JOB_MESSAGE = "用户已中止生成任务";
const generationJobRequestSchema = imageGenerationInputSchema.extend({
  waitForCompletion: z.boolean().default(true),
});
const videoGenerationJobRequestSchema = z.object({
  boardId: z.string().min(1),
  model: z.string().trim().min(1).max(120).optional(),
  prompt: z.string().trim().min(1).max(32000),
  referenceAssetIds: z.array(z.string().min(1)).max(7).default([]),
  referenceMode: z.enum(["image", "reference_images"]).default("image"),
  videoOptions: z.object({
    aspectRatio: z.enum(["2:3", "3:2", "1:1", "9:16", "16:9"]).default("9:16"),
    durationSec: z.union([z.literal(6), z.literal(10)]).default(6),
    resolution: z.enum(["480p", "720p"]).default("720p"),
  }).default({ aspectRatio: "9:16", durationSec: 6, resolution: "720p" }),
  waitForCompletion: z.boolean().default(true),
});
const activeGenerationStatuses = ["preparing", "calling_model", "saving_results", "running"];
let runCreatedVideoGenerationJob = runCreatedVideoGenerationJobDefault;

export function setBoardVideoGenerationRunnerForTest(runner: typeof runCreatedVideoGenerationJobDefault | null) {
  runCreatedVideoGenerationJob = runner ?? runCreatedVideoGenerationJobDefault;
}

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

  app.post("/api/video-generation-jobs", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const parsed = parseBody(videoGenerationJobRequestSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const board = await prisma.board.findFirst({ where: { id: parsed.data.boardId, userId: user.id }, select: { id: true, name: true } });
    if (!board) return jsonError(reply, "Board not found", 404);
    const providerSetting = await getProviderSetting(user.id, user.canUseAdminProvider);
    if (!providerSetting?.enabled) {
      return jsonError(reply, "请配置第三方 API 或联系管理员授权使用当前 API", 400);
    }
    const fallbackVideoModel = getVideoModel(providerSetting);
    const selectedModel = parsed.data.model ?? fallbackVideoModel;
    try {
      resolveVideoModelSelection(providerSetting, selectedModel);
    } catch (error) {
      return jsonError(reply, error instanceof Error ? error.message : "所选视频模型未在后台启用", 400);
    }
    const videoInput = {
      boardId: board.id,
      boardName: board.name,
      model: selectedModel,
      prompt: parsed.data.prompt,
      providerSetting,
      referenceAssetIds: parsed.data.referenceAssetIds,
      referenceMode: parsed.data.referenceMode,
      user: { id: user.id, name: user.name, username: user.username },
      videoOptions: parsed.data.videoOptions,
    };
    if (!parsed.data.waitForCompletion) {
      const result = await createVideoGenerationJob(videoInput);
      if (!result.ok) return jsonError(reply, result.error, result.statusCode);
      void runCreatedVideoGenerationJob(result);
      reply.code(202);
      return { asset: null, job: { ...result.job, results: [] }, providerJobId: null };
    }
    const result = await createAndRunVideoGenerationJob(videoInput);
    if (!result.ok) return jsonError(reply, result.error, result.statusCode);
    return { asset: result.asset, job: result.job, providerJobId: result.providerJobId };
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

  app.post<{ Params: { jobId: string } }>("/api/generation-jobs/:jobId/cancel", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const job = await prisma.generationJob.findFirst({
      where: { id: request.params.jobId, board: { userId: user.id } },
      include: { results: { include: { asset: true } } },
    });
    if (!job) return jsonError(reply, "Generation job not found", 404);
    if (!activeGenerationStatuses.includes(job.status)) {
      return { job, results: job.results.map((result: { asset: Asset }) => result.asset) };
    }
    const cancelledJob = await prisma.generationJob.update({
      where: { id: job.id },
      data: { errorMessage: CANCELLED_JOB_MESSAGE, status: "cancelled" },
      include: { results: { include: { asset: true } } },
    });
    return { job: cancelledJob, results: cancelledJob.results.map((result: { asset: Asset }) => result.asset) };
  });
}

function getVideoModel(setting: { videoModel?: string | null }) {
  return setting.videoModel?.trim() || "cliproxy:grok-imagine-video";
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
