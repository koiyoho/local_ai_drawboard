import type { FastifyInstance, FastifyPluginCallback } from "fastify";
import { z } from "zod";

import type { Asset, StoryboardProject, StoryboardShot } from "@/generated/prisma/client";
import { createOpenAIClient, getTextModel } from "@/lib/openai";
import { prisma } from "@/lib/prisma";
import {
  buildShotPromptInstruction,
  buildStoryboardGenerationInstruction,
  normalizeStoryboardBrief,
  normalizeStoryboardPromptLocks,
  normalizeStoryboardShotInput,
  parseShotPromptOutput,
  parseStoryboardGenerationOutput,
  reorderStoryboardShots,
  storyboardBriefPatchSchema,
  storyboardShotInputSchema,
  storyboardShotPatchSchema,
  type StoryboardFrameAssetContext,
  type StoryboardFrameContext,
  type StoryboardBrief,
  type StoryboardShot as NormalizedStoryboardShot,
} from "@/lib/storyboard";
import { requireCurrentUser } from "../auth";
import {
  createAndRunImageGenerationJob,
  imageGenerationInputSchema,
  type CreateGenerationJobInput,
} from "../generation-job-service";
import { getErrorMessage, jsonError, parseBody } from "../http";
import { getProviderSetting } from "../provider-settings-helper";

const upsertStoryboardSchema = z.object({
  brief: storyboardBriefPatchSchema.optional(),
  scriptText: z.string().trim().max(50000).optional(),
  title: z.string().trim().max(200).optional(),
});

const generateStoryboardSchema = z.object({
  brief: storyboardBriefPatchSchema.optional(),
  scriptText: z.string().trim().min(1).max(50000),
  title: z.string().trim().max(200).optional(),
});

const reorderShotsSchema = z.object({
  orderedShotIds: z.array(z.string().min(1)).min(1).max(200),
});

const generatePromptsSchema = z.object({
  overwrite: z.boolean().optional().default(false),
});

const generateFrameSchema = z.object({
  frame: z.enum(["start", "end"]),
  size: imageGenerationInputSchema.shape.size.default("1024x1024"),
});

export type StoryboardTextModelCaller = (
  providerSetting: NonNullable<Awaited<ReturnType<typeof getProviderSetting>>>,
  instruction: string,
  maxTokens: number,
  temperature: number,
) => Promise<string>;

export type StoryboardRoutesOptions = {
  callTextModel?: StoryboardTextModelCaller;
  runImageGenerationJob?: typeof createAndRunImageGenerationJob;
};

type StoryboardProjectRecord = StoryboardProject & { shots: StoryboardShot[] };
type FormattedStoryboardShot = NormalizedStoryboardShot & {
  id: string;
  createdAt: string;
  updatedAt: string;
};
type StoryboardFrameExportAsset = Pick<Asset, "height" | "id" | "kind" | "mimeType" | "publicUrl" | "sizeBytes" | "width"> & {
  tags: string[];
};

export function createStoryboardRoutes(options: StoryboardRoutesOptions = {}): FastifyPluginCallback {
  return async function registerInjectedStoryboardRoutes(app: FastifyInstance) {
    await registerStoryboardRoutes(app, options);
  };
}

export async function registerStoryboardRoutes(app: FastifyInstance, options: StoryboardRoutesOptions = {}) {
  const callTextModel = options.callTextModel ?? callOpenAICompatibleTextModel;
  const runImageGenerationJob = options.runImageGenerationJob ?? createAndRunImageGenerationJob;

  app.get<{ Params: { boardId: string } }>("/api/boards/:boardId/storyboard", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const board = await findOwnedBoard(user.id, request.params.boardId);
    if (!board) return jsonError(reply, "Board not found", 404);
    const project = await ensureStoryboardProject(board.id);
    return { storyboard: formatStoryboardProject(project) };
  });

  app.put<{ Params: { boardId: string } }>("/api/boards/:boardId/storyboard", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const parsed = parseBody(upsertStoryboardSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const board = await findOwnedBoard(user.id, request.params.boardId);
    if (!board) return jsonError(reply, "Board not found", 404);
    const existing = await ensureStoryboardProject(board.id);
    const brief = mergeStoryboardBriefPatch(existing.brief, parsed.data.brief);
    const project = await prisma.storyboardProject.update({
      data: {
        briefJson: JSON.stringify(brief),
        scriptText: parsed.data.scriptText ?? existing.scriptText,
        title: parsed.data.title ?? existing.title,
      },
      include: storyboardProjectInclude,
      where: { id: existing.id },
    });
    return { storyboard: formatStoryboardProject(project) };
  });

  app.post<{ Params: { boardId: string } }>("/api/boards/:boardId/storyboard/generate", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const parsed = parseBody(generateStoryboardSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const board = await findOwnedBoard(user.id, request.params.boardId);
    if (!board) return jsonError(reply, "Board not found", 404);
    const providerSetting = await getProviderSetting(user.id, user.canUseAdminProvider);
    if (!providerSetting?.enabled) {
      return jsonError(reply, "请配置第三方 API 或联系管理员授权使用当前 API", 400);
    }
    const existing = await ensureStoryboardProject(board.id);
    const brief = mergeStoryboardBriefPatch(existing.brief, parsed.data.brief);
    const instruction = buildStoryboardGenerationInstruction({ brief, scriptText: parsed.data.scriptText });

    try {
      const text = await callTextModel(providerSetting, instruction, 3000, 0.4);
      const output = parseStoryboardGenerationOutput(text);
      if (output.shots.length === 0) {
        return jsonError(reply, "分镜生成未返回可用镜头", 502);
      }
      const project = await prisma.$transaction(async (tx) => {
        await tx.storyboardShot.deleteMany({ where: { projectId: existing.id } });
        await tx.storyboardProject.update({
          data: {
            briefJson: JSON.stringify(brief),
            scriptText: output.scriptText || parsed.data.scriptText,
            title: output.title || parsed.data.title || existing.title,
          },
          where: { id: existing.id },
        });
        for (const shot of output.shots) {
          await tx.storyboardShot.create({
            data: toStoryboardShotCreateData(existing.id, {
              ...shot,
              status: "script_ready",
            }),
          });
        }
        return tx.storyboardProject.findUniqueOrThrow({
          include: storyboardProjectInclude,
          where: { id: existing.id },
        });
      });
      return { storyboard: formatStoryboardProject(project) };
    } catch (error) {
      request.log.error({ err: error }, "storyboard generation failed");
      return jsonError(reply, getErrorMessage(error, "分镜生成失败"), 500);
    }
  });

  app.post<{ Params: { boardId: string } }>("/api/boards/:boardId/storyboard/shots", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const parsed = parseBody(storyboardShotInputSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const board = await findOwnedBoard(user.id, request.params.boardId);
    if (!board) return jsonError(reply, "Board not found", 404);
    const project = await ensureStoryboardProject(board.id);
    const assetError = await getStoryboardFrameAssetError(board.id, {
      startFrameAssetId: parsed.data.startFrameAssetId ?? null,
      endFrameAssetId: parsed.data.endFrameAssetId ?? null,
    });
    if (assetError) return jsonError(reply, assetError, 400);
    const nextIndex = project.shots.length + 1;
    const shot = await prisma.storyboardShot.create({
      data: toStoryboardShotCreateData(project.id, { ...parsed.data, shotIndex: parsed.data.shotIndex ?? nextIndex }),
    });
    return reply.status(201).send({ shot: formatStoryboardShot(shot) });
  });

  app.patch<{ Params: { boardId: string; shotId: string } }>("/api/boards/:boardId/storyboard/shots/:shotId", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const parsed = parseBody(storyboardShotPatchSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const board = await findOwnedBoard(user.id, request.params.boardId);
    if (!board) return jsonError(reply, "Board not found", 404);
    const shot = await findOwnedShot(board.id, request.params.shotId);
    if (!shot) return jsonError(reply, "Shot not found", 404);
    const normalized = normalizeStoryboardShotInput({
      ...formatStoryboardShot(shot),
      ...parsed.data,
      id: shot.id,
      shotIndex: shot.shotIndex,
    });
    const assetError = await getStoryboardFrameAssetError(board.id, normalized);
    if (assetError) return jsonError(reply, assetError, 400);
    const updated = await prisma.storyboardShot.update({
      data: toStoryboardShotUpdateData(normalized),
      where: { id: shot.id },
    });
    return { shot: formatStoryboardShot(updated) };
  });

  app.post<{ Params: { boardId: string; shotId: string } }>("/api/boards/:boardId/storyboard/shots/:shotId/duplicate", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const board = await findOwnedBoard(user.id, request.params.boardId);
    if (!board) return jsonError(reply, "Board not found", 404);
    const shot = await findOwnedShot(board.id, request.params.shotId);
    if (!shot) return jsonError(reply, "Shot not found", 404);
    const project = await ensureStoryboardProject(board.id);
    const duplicate = await prisma.storyboardShot.create({
      data: toStoryboardShotCreateData(project.id, {
        ...formatStoryboardShot(shot),
        id: undefined,
        shotIndex: project.shots.length + 1,
      }),
    });
    return reply.status(201).send({ shot: formatStoryboardShot(duplicate) });
  });

  app.delete<{ Params: { boardId: string; shotId: string } }>("/api/boards/:boardId/storyboard/shots/:shotId", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const board = await findOwnedBoard(user.id, request.params.boardId);
    if (!board) return jsonError(reply, "Board not found", 404);
    const shot = await findOwnedShot(board.id, request.params.shotId);
    if (!shot) return jsonError(reply, "Shot not found", 404);
    const project = await prisma.$transaction(async (tx) => {
      await tx.storyboardShot.delete({ where: { id: shot.id } });
      const remaining = await tx.storyboardShot.findMany({
        orderBy: [{ shotIndex: "asc" }, { createdAt: "asc" }],
        where: { projectId: shot.projectId },
      });
      for (const [index, item] of remaining.entries()) {
        await tx.storyboardShot.update({ data: { shotIndex: index + 1 }, where: { id: item.id } });
      }
      return tx.storyboardProject.findUniqueOrThrow({ include: storyboardProjectInclude, where: { id: shot.projectId } });
    });
    return { storyboard: formatStoryboardProject(project) };
  });

  app.post<{ Params: { boardId: string } }>("/api/boards/:boardId/storyboard/shots/reorder", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const parsed = parseBody(reorderShotsSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const board = await findOwnedBoard(user.id, request.params.boardId);
    if (!board) return jsonError(reply, "Board not found", 404);
    const project = await ensureStoryboardProject(board.id);
    let reordered: FormattedStoryboardShot[];
    try {
      reordered = reorderStoryboardShots(project.shots.map(formatStoryboardShot), parsed.data.orderedShotIds);
    } catch (error) {
      return jsonError(reply, getErrorMessage(error, "Invalid shot order"), 400);
    }
    const updatedProject = await prisma.$transaction(async (tx) => {
      for (const shot of reordered) {
        await tx.storyboardShot.update({ data: { shotIndex: shot.shotIndex }, where: { id: shot.id } });
      }
      return tx.storyboardProject.findUniqueOrThrow({ include: storyboardProjectInclude, where: { id: project.id } });
    });
    return { storyboard: formatStoryboardProject(updatedProject) };
  });

  app.post<{ Params: { boardId: string; shotId: string } }>("/api/boards/:boardId/storyboard/shots/:shotId/generate-prompts", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const parsed = parseBody(generatePromptsSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const board = await findOwnedBoard(user.id, request.params.boardId);
    if (!board) return jsonError(reply, "Board not found", 404);
    const shot = await findOwnedShot(board.id, request.params.shotId);
    if (!shot) return jsonError(reply, "Shot not found", 404);
    const promptUpdatePlan = getShotPromptUpdatePlan(formatStoryboardShot(shot), parsed.data.overwrite);
    if (promptUpdatePlan.length === 0) {
      return { shot: formatStoryboardShot(shot) };
    }
    const project = await prisma.storyboardProject.findUniqueOrThrow({ where: { id: shot.projectId } });
    const providerSetting = await getProviderSetting(user.id, user.canUseAdminProvider);
    if (!providerSetting?.enabled) {
      return jsonError(reply, "请配置第三方 API 或联系管理员授权使用当前 API", 400);
    }
    try {
      const updated = await generateAndUpdateShotPrompts({
        callTextModel,
        overwrite: parsed.data.overwrite,
        project,
        providerSetting,
        shot,
      });
      return { shot: formatStoryboardShot(updated) };
    } catch (error) {
      request.log.error({ err: error }, "storyboard prompt generation failed");
      return jsonError(reply, getErrorMessage(error, "提示词生成失败"), 500);
    }
  });

  app.post<{ Params: { boardId: string } }>("/api/boards/:boardId/storyboard/shots/generate-prompts", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const parsed = parseBody(generatePromptsSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const board = await findOwnedBoard(user.id, request.params.boardId);
    if (!board) return jsonError(reply, "Board not found", 404);
    const project = await ensureStoryboardProject(board.id);
    const targets = project.shots.filter((shot) => getShotPromptUpdatePlan(formatStoryboardShot(shot), parsed.data.overwrite).length > 0);
    if (targets.length === 0) {
      return { storyboard: formatStoryboardProject(project), updatedCount: 0 };
    }
    const providerSetting = await getProviderSetting(user.id, user.canUseAdminProvider);
    if (!providerSetting?.enabled) {
      return jsonError(reply, "请配置第三方 API 或联系管理员授权使用当前 API", 400);
    }
    try {
      for (const shot of targets) {
        await generateAndUpdateShotPrompts({
          callTextModel,
          overwrite: parsed.data.overwrite,
          project,
          providerSetting,
          shot,
        });
      }
      const updatedProject = await prisma.storyboardProject.findUniqueOrThrow({
        include: storyboardProjectInclude,
        where: { id: project.id },
      });
      return { storyboard: formatStoryboardProject(updatedProject), updatedCount: targets.length };
    } catch (error) {
      request.log.error({ err: error }, "storyboard batch prompt generation failed");
      return jsonError(reply, getErrorMessage(error, "批量提示词生成失败"), 500);
    }
  });

  app.post<{ Params: { boardId: string; shotId: string } }>("/api/boards/:boardId/storyboard/shots/:shotId/generate-frame", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const parsed = parseBody(generateFrameSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const board = await findOwnedBoard(user.id, request.params.boardId);
    if (!board) return jsonError(reply, "Board not found", 404);
    const shot = await findOwnedShot(board.id, request.params.shotId);
    if (!shot) return jsonError(reply, "Shot not found", 404);

    const prompt = parsed.data.frame === "start" ? shot.startFramePrompt : shot.endFramePrompt;
    if (!prompt.trim()) {
      return jsonError(reply, parsed.data.frame === "start" ? "请先生成或填写首帧提示词" : "请先生成或填写尾帧提示词", 400);
    }

    const result = await runImageGenerationJob({
      boardName: board.name,
      generation: {
        boardId: board.id,
        count: 1,
        mode: "text_to_image",
        prompt,
        referenceAssetIds: [],
        size: parsed.data.size,
      },
      log: request.log,
      paramsMetadata: {
        storyboardFrame: {
          frame: parsed.data.frame,
          shotId: shot.id,
          shotIndex: shot.shotIndex,
          storyboardProjectId: shot.projectId,
        },
      },
      user,
    } satisfies CreateGenerationJobInput);
    if (!result.ok) return jsonError(reply, result.error, result.statusCode);

    const asset = result.results[0];
    if (!asset) return jsonError(reply, "首尾帧生成没有返回图片素材", 502);

    const updated = await prisma.storyboardShot.update({
      data: parsed.data.frame === "start"
        ? { startFrameAssetId: asset.id, status: getFrameReadyStatus(shot, "start") }
        : { endFrameAssetId: asset.id, status: getFrameReadyStatus(shot, "end") },
      where: { id: shot.id },
    });
    return { asset, frame: parsed.data.frame, job: result.job, shot: formatStoryboardShot(updated) };
  });

  app.get<{ Params: { boardId: string } }>("/api/boards/:boardId/storyboard/export.md", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const board = await findOwnedBoard(user.id, request.params.boardId);
    if (!board) return jsonError(reply, "Board not found", 404);
    const project = await ensureStoryboardProject(board.id);
    const storyboard = formatStoryboardProject(project);
    const frameAssets = await getStoryboardFrameExportAssets(board.id, storyboard);
    return reply
      .header("content-disposition", `attachment; filename="${encodeURIComponent(board.name)}-storyboard.md"`)
      .type("text/markdown; charset=utf-8")
      .send(buildStoryboardMarkdown(board.name, storyboard, frameAssets));
  });

  app.get<{ Params: { boardId: string } }>("/api/boards/:boardId/storyboard/export.json", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const board = await findOwnedBoard(user.id, request.params.boardId);
    if (!board) return jsonError(reply, "Board not found", 404);
    const project = await ensureStoryboardProject(board.id);
    const storyboard = formatStoryboardProject(project);
    const frameAssets = await getStoryboardFrameExportAssets(board.id, storyboard);
    return reply
      .header("content-disposition", `attachment; filename="${encodeURIComponent(board.name)}-storyboard.json"`)
      .type("application/json; charset=utf-8")
      .send(JSON.stringify(buildStoryboardJson(board.name, storyboard, frameAssets), null, 2));
  });

  app.get<{ Params: { boardId: string } }>("/api/boards/:boardId/storyboard/export.csv", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const board = await findOwnedBoard(user.id, request.params.boardId);
    if (!board) return jsonError(reply, "Board not found", 404);
    const project = await ensureStoryboardProject(board.id);
    const storyboard = formatStoryboardProject(project);
    const frameAssets = await getStoryboardFrameExportAssets(board.id, storyboard);
    return reply
      .header("content-disposition", `attachment; filename="${encodeURIComponent(board.name)}-storyboard.csv"`)
      .type("text/csv; charset=utf-8")
      .send(buildStoryboardCsv(storyboard, frameAssets));
  });
}

const storyboardProjectInclude = {
  shots: { orderBy: [{ shotIndex: "asc" as const }, { createdAt: "asc" as const }] },
};

async function findOwnedBoard(userId: string, boardId: string) {
  return prisma.board.findFirst({
    select: { id: true, name: true },
    where: { id: boardId, userId },
  });
}

async function ensureStoryboardProject(boardId: string) {
  const existing = await prisma.storyboardProject.findUnique({
    include: storyboardProjectInclude,
    where: { boardId },
  });
  if (existing) {
    return {
      ...existing,
      brief: normalizeStoryboardBrief(parseJsonObject(existing.briefJson)),
    };
  }
  const brief = normalizeStoryboardBrief({});
  const created = await prisma.storyboardProject.create({
    data: {
      boardId,
      briefJson: JSON.stringify(brief),
    },
    include: storyboardProjectInclude,
  });
  return {
    ...created,
    brief,
  };
}

async function findOwnedShot(boardId: string, shotId: string) {
  return prisma.storyboardShot.findFirst({
    where: {
      id: shotId,
      project: { boardId },
    },
  });
}

function formatStoryboardProject(project: StoryboardProjectRecord & { brief?: StoryboardBrief }) {
  return {
    boardId: project.boardId,
    brief: project.brief ?? normalizeStoryboardBrief(parseJsonObject(project.briefJson)),
    createdAt: project.createdAt.toISOString(),
    id: project.id,
    scriptText: project.scriptText,
    shots: project.shots.map(formatStoryboardShot),
    title: project.title,
    updatedAt: project.updatedAt.toISOString(),
  };
}

function formatStoryboardShot(shot: StoryboardShot): FormattedStoryboardShot {
  const normalized = normalizeStoryboardShotInput({
    action: shot.action,
    audio: shot.audio,
    camera: shot.camera,
    caption: shot.caption,
    dialogue: shot.dialogue,
    durationSec: shot.durationSec,
    endFrameAssetId: shot.endFrameAssetId,
    endFramePrompt: shot.endFramePrompt,
    id: shot.id,
    metadata: parseJsonObject(shot.metadataJson),
    scene: shot.scene,
    shotIndex: shot.shotIndex,
    startFrameAssetId: shot.startFrameAssetId,
    startFramePrompt: shot.startFramePrompt,
    status: shot.status,
    videoPrompt: shot.videoPrompt,
  });
  return {
    ...normalized,
    id: shot.id,
    createdAt: shot.createdAt.toISOString(),
    updatedAt: shot.updatedAt.toISOString(),
  };
}

function mergeStoryboardBriefPatch(current: StoryboardBrief, patch: Partial<StoryboardBrief> | undefined) {
  if (!patch) return current;
  const merged = { ...current, ...patch };
  if (patch.targetPlatform && !patch.locale && patch.targetPlatform !== current.targetPlatform) {
    delete (merged as Partial<StoryboardBrief>).locale;
  }
  return normalizeStoryboardBrief(merged);
}

function toStoryboardShotCreateData(projectId: string, input: unknown) {
  const shot = normalizeStoryboardShotInput(input);
  return {
    action: shot.action,
    audio: shot.audio,
    camera: shot.camera,
    caption: shot.caption,
    dialogue: shot.dialogue,
    durationSec: shot.durationSec,
    endFrameAssetId: shot.endFrameAssetId,
    endFramePrompt: shot.endFramePrompt,
    metadataJson: JSON.stringify(shot.metadata),
    projectId,
    scene: shot.scene,
    shotIndex: shot.shotIndex,
    startFrameAssetId: shot.startFrameAssetId,
    startFramePrompt: shot.startFramePrompt,
    status: shot.status,
    videoPrompt: shot.videoPrompt,
  };
}

function toStoryboardShotUpdateData(shot: NormalizedStoryboardShot) {
  return {
    action: shot.action,
    audio: shot.audio,
    camera: shot.camera,
    caption: shot.caption,
    dialogue: shot.dialogue,
    durationSec: shot.durationSec,
    endFrameAssetId: shot.endFrameAssetId,
    endFramePrompt: shot.endFramePrompt,
    metadataJson: JSON.stringify(shot.metadata),
    scene: shot.scene,
    startFrameAssetId: shot.startFrameAssetId,
    startFramePrompt: shot.startFramePrompt,
    status: shot.status,
    videoPrompt: shot.videoPrompt,
  };
}

async function getStoryboardFrameAssetError(
  boardId: string,
  shot: Pick<NormalizedStoryboardShot, "endFrameAssetId" | "startFrameAssetId">,
) {
  const assetIds = Array.from(
    new Set(
      [shot.startFrameAssetId, shot.endFrameAssetId].filter(
        (assetId): assetId is string => typeof assetId === "string" && assetId.length > 0,
      ),
    ),
  );
  if (assetIds.length === 0) return "";
  const matchingCount = await prisma.asset.count({
    where: {
      boardId,
      id: { in: assetIds },
    },
  });
  return matchingCount === assetIds.length ? "" : "Frame asset not found";
}

function getShotPromptUpdatePlan(shot: FormattedStoryboardShot, overwrite: boolean) {
  const locks = normalizeStoryboardPromptLocks(shot.metadata.promptLocks);
  return (["startFramePrompt", "endFramePrompt", "videoPrompt"] as const).filter((field) => {
    if (locks[field]) return false;
    return overwrite || !shot[field];
  });
}

function getFrameReadyStatus(shot: StoryboardShot, generatedFrame: "end" | "start") {
  const hasStart = generatedFrame === "start" || Boolean(shot.startFrameAssetId);
  const hasEnd = generatedFrame === "end" || Boolean(shot.endFrameAssetId);
  return hasStart && hasEnd ? "frames_ready" : shot.status;
}

async function generateAndUpdateShotPrompts({
  callTextModel,
  overwrite,
  project,
  providerSetting,
  shot,
}: {
  callTextModel: StoryboardTextModelCaller;
  overwrite: boolean;
  project: StoryboardProject;
  providerSetting: NonNullable<Awaited<ReturnType<typeof getProviderSetting>>>;
  shot: StoryboardShot;
}) {
  const formattedShot = formatStoryboardShot(shot);
  const promptUpdatePlan = getShotPromptUpdatePlan(formattedShot, overwrite);
  if (promptUpdatePlan.length === 0) return shot;
  const brief = normalizeStoryboardBrief(parseJsonObject(project.briefJson));
  const frameContext = await getShotFrameContext(formattedShot);
  const instruction = buildShotPromptInstruction({ brief, frameContext, shot: formattedShot });
  const text = await callTextModel(providerSetting, instruction, 1800, 0.3);
  const output = parseShotPromptOutput(text);
  if (!output.startFramePrompt || !output.endFramePrompt || !output.videoPrompt) {
    throw new Error("提示词生成未返回可用内容");
  }
  const updateData: Partial<Pick<StoryboardShot, "endFramePrompt" | "startFramePrompt" | "status" | "videoPrompt">> = {
    status: "prompts_ready",
  };
  for (const field of promptUpdatePlan) {
    updateData[field] = output[field];
  }
  return prisma.storyboardShot.update({
    data: updateData,
    where: { id: shot.id },
  });
}

async function getShotFrameContext(shot: FormattedStoryboardShot): Promise<StoryboardFrameContext> {
  const assetIds = Array.from(
    new Set(
      [shot.startFrameAssetId, shot.endFrameAssetId].filter(
        (assetId): assetId is string => typeof assetId === "string" && assetId.length > 0,
      ),
    ),
  );
  if (assetIds.length === 0) return {};
  const assets = await prisma.asset.findMany({
    include: {
      generationResults: {
        include: { job: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    where: { id: { in: assetIds } },
  });
  const contextByAssetId = new Map(assets.map((asset) => [asset.id, formatFrameAssetContext(asset)]));
  return {
    ...(shot.startFrameAssetId && contextByAssetId.has(shot.startFrameAssetId)
      ? { startFrameAsset: contextByAssetId.get(shot.startFrameAssetId) }
      : {}),
    ...(shot.endFrameAssetId && contextByAssetId.has(shot.endFrameAssetId)
      ? { endFrameAsset: contextByAssetId.get(shot.endFrameAssetId) }
      : {}),
  };
}

function formatFrameAssetContext(asset: Awaited<ReturnType<typeof prisma.asset.findMany>>[number] & {
  generationResults?: Array<{ job: { prompt: string } }>;
}): StoryboardFrameAssetContext {
  return {
    assetId: asset.id,
    height: asset.height,
    kind: asset.kind,
    sourcePrompt: asset.generationResults?.[0]?.job.prompt ?? "",
    tags: parseStringArray(asset.tagsJson),
    width: asset.width,
  };
}

async function getStoryboardFrameExportAssets(
  boardId: string,
  storyboard: ReturnType<typeof formatStoryboardProject>,
): Promise<Map<string, StoryboardFrameExportAsset>> {
  const assetIds = Array.from(
    new Set(
      storyboard.shots
        .flatMap((shot) => [shot.startFrameAssetId, shot.endFrameAssetId])
        .filter((assetId): assetId is string => typeof assetId === "string" && assetId.length > 0),
    ),
  );
  if (assetIds.length === 0) return new Map();
  const assets = await prisma.asset.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    where: {
      boardId,
      id: { in: assetIds },
    },
  });
  return new Map(
    assets.map((asset) => [
      asset.id,
      {
        height: asset.height,
        id: asset.id,
        kind: asset.kind,
        mimeType: asset.mimeType,
        publicUrl: asset.publicUrl,
        sizeBytes: asset.sizeBytes,
        tags: parseStringArray(asset.tagsJson),
        width: asset.width,
      },
    ]),
  );
}

function parseStringArray(value: string | null) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  } catch {
    return [];
  }
}

async function callOpenAICompatibleTextModel(
  providerSetting: NonNullable<Awaited<ReturnType<typeof getProviderSetting>>>,
  instruction: string,
  maxTokens: number,
  temperature: number,
) {
  const openai = createOpenAIClient(providerSetting);
  const model = getTextModel(providerSetting);

  try {
    const response = await openai.responses.create({
      input: [{ content: [{ text: instruction, type: "input_text" }], role: "user" }],
      max_output_tokens: maxTokens,
      model,
      temperature,
    });
    return response.output_text?.trim() ?? "";
  } catch (responseError) {
    if (!shouldFallbackToChatCompletions(responseError)) {
      throw responseError;
    }
    const response = await openai.chat.completions.create({
      max_tokens: maxTokens,
      messages: [{ content: instruction, role: "user" }],
      model,
      temperature,
    });
    const content = response.choices[0]?.message.content;
    return typeof content === "string" ? content.trim() : "";
  }
}

function shouldFallbackToChatCompletions(error: unknown) {
  const status = getErrorNumber(error, "status") ?? getErrorNumber(error, "statusCode");
  if (status !== 404 && status !== 405) return false;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return [
    "method not allowed",
    "endpoint not found",
    "route not found",
    "unknown endpoint",
    "unknown url",
    "invalid url",
    "not implemented",
    "/responses",
    "/v1/responses",
    "responses endpoint",
  ].some((fallbackMessage) => message.includes(fallbackMessage));
}

function getErrorNumber(error: unknown, key: string) {
  if (!isRecord(error)) return undefined;
  const value = error[key];
  return typeof value === "number" ? value : undefined;
}

function buildStoryboardMarkdown(
  boardName: string,
  storyboard: ReturnType<typeof formatStoryboardProject>,
  frameAssets: Map<string, StoryboardFrameExportAsset> = new Map(),
) {
  const lines = [
    `# ${boardName}`,
    "",
    "## Brief",
    "",
    `- 平台: ${storyboard.brief.targetPlatform}`,
    `- 类型: ${storyboard.brief.contentType}`,
    `- 时长: ${storyboard.brief.durationSec}s`,
    `- 主题: ${storyboard.brief.topic}`,
    `- 受众: ${storyboard.brief.audience}`,
    `- 卖点: ${storyboard.brief.sellingPoints}`,
    "",
    "## 文案",
    "",
    storyboard.scriptText || "暂无文案",
    "",
    "## 分镜",
    "",
  ];
  for (const shot of storyboard.shots) {
    lines.push(
      `### ${shot.shotIndex}. ${shot.caption || shot.action || "未命名镜头"}`,
      "",
      `- 时长: ${shot.durationSec}s`,
      `- 状态: ${shot.status}`,
      `- 场景: ${shot.scene}`,
      `- 机位: ${shot.camera}`,
      `- 动作: ${shot.action}`,
      `- 台词: ${shot.dialogue}`,
      `- 字幕: ${shot.caption}`,
      `- 音频: ${shot.audio}`,
      `- 首帧素材: ${formatStoryboardFrameAssetLine(shot.startFrameAssetId, frameAssets)}`,
      `- 尾帧素材: ${formatStoryboardFrameAssetLine(shot.endFrameAssetId, frameAssets)}`,
      "",
      "#### 首帧提示词",
      "",
      shot.startFramePrompt || "未生成",
      "",
      "#### 尾帧提示词",
      "",
      shot.endFramePrompt || "未生成",
      "",
      "#### 视频提示词",
      "",
      shot.videoPrompt || "未生成",
      "",
    );
  }
  return lines.join("\n");
}

function buildStoryboardJson(
  boardName: string,
  storyboard: ReturnType<typeof formatStoryboardProject>,
  frameAssets: Map<string, StoryboardFrameExportAsset> = new Map(),
) {
  return {
    boardName,
    exportedAt: new Date().toISOString(),
    frameAssets: Array.from(frameAssets.values()),
    storyboard,
  };
}

function buildStoryboardCsv(
  storyboard: ReturnType<typeof formatStoryboardProject>,
  frameAssets: Map<string, StoryboardFrameExportAsset> = new Map(),
) {
  const rows = [
    [
      "shotIndex",
      "durationSec",
      "status",
      "scene",
      "camera",
      "action",
      "dialogue",
      "caption",
      "audio",
      "startFrameAssetId",
      "startFrameAssetUrl",
      "startFrameAssetMeta",
      "endFrameAssetId",
      "endFrameAssetUrl",
      "endFrameAssetMeta",
      "startFramePrompt",
      "endFramePrompt",
      "videoPrompt",
    ],
  ];
  for (const shot of storyboard.shots) {
    const startFrameAsset = shot.startFrameAssetId ? frameAssets.get(shot.startFrameAssetId) : undefined;
    const endFrameAsset = shot.endFrameAssetId ? frameAssets.get(shot.endFrameAssetId) : undefined;
    rows.push([
      String(shot.shotIndex),
      String(shot.durationSec),
      shot.status,
      shot.scene,
      shot.camera,
      shot.action,
      shot.dialogue,
      shot.caption,
      shot.audio,
      shot.startFrameAssetId ?? "",
      startFrameAsset?.publicUrl ?? "",
      formatStoryboardFrameAssetMeta(startFrameAsset),
      shot.endFrameAssetId ?? "",
      endFrameAsset?.publicUrl ?? "",
      formatStoryboardFrameAssetMeta(endFrameAsset),
      shot.startFramePrompt,
      shot.endFramePrompt,
      shot.videoPrompt,
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function formatStoryboardFrameAssetLine(assetId: string | null, frameAssets: Map<string, StoryboardFrameExportAsset>) {
  if (!assetId) return "未绑定";
  const asset = frameAssets.get(assetId);
  if (!asset) return `${assetId} (素材记录缺失)`;
  const parts = [asset.id, asset.kind, formatAssetDimensions(asset), asset.publicUrl].filter(Boolean);
  if (asset.tags.length > 0) parts.push(`tags=${asset.tags.join("/")}`);
  return parts.join(" | ");
}

function formatStoryboardFrameAssetMeta(asset: StoryboardFrameExportAsset | undefined) {
  if (!asset) return "";
  const parts = [asset.kind, asset.mimeType, formatAssetDimensions(asset), `${asset.sizeBytes} bytes`].filter(Boolean);
  if (asset.tags.length > 0) parts.push(`tags=${asset.tags.join("/")}`);
  return parts.join(" | ");
}

function formatAssetDimensions(asset: Pick<Asset, "height" | "width">) {
  return asset.width && asset.height ? `${asset.width}x${asset.height}` : "";
}

function csvCell(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!/[",\n]/.test(normalized)) return normalized;
  return `"${normalized.replace(/"/g, '""')}"`;
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
