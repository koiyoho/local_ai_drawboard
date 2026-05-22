import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  buildPromptAssistInstruction,
  parsePromptAssistOutput,
  promptAssistActions,
  promptAssistEngines,
  promptAssistImageTypes,
} from "@/lib/prompt-assist";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "../auth";
import { jsonError, parseBody } from "../http";
import { getProviderSetting } from "../provider-settings-helper";
import { callOpenAICompatibleTextModel } from "../text-model-service";

const promptAssistSchema = z.object({
  action: z.enum(promptAssistActions),
  artStyle: z.string().trim().max(80).optional(),
  artStyleInstruction: z.string().trim().max(1000).optional(),
  artStyleLabel: z.string().trim().max(80).optional(),
  boardId: z.string().min(1),
  engine: z.enum(promptAssistEngines).default("standard"),
  imageType: z.enum(promptAssistImageTypes).default("auto"),
  prompt: z.string().trim().min(1).max(20000),
  referenceContext: z.string().trim().max(2000).optional(),
});
const providerNotConfiguredMessage = "请先在本地设置中配置第三方 API、Gemini Bridge 或 Codex 兼容代理";

export async function registerPromptAssistRoutes(app: FastifyInstance) {
  app.post("/api/prompt-assist", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;

    const parsed = parseBody(promptAssistSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);

    const board = await prisma.board.findFirst({
      where: { id: parsed.data.boardId, userId: user.id },
      select: { id: true },
    });
    if (!board) return jsonError(reply, "Board not found", 404);

    const providerSetting = await getProviderSetting(user.id, user.canUseAdminProvider);
    if (!providerSetting?.enabled) {
      return jsonError(reply, providerNotConfiguredMessage, 400);
    }

    try {
      const instruction = buildPromptAssistInstruction({
        action: parsed.data.action,
        artStyle: parsed.data.artStyle,
        artStyleInstruction: parsed.data.artStyleInstruction,
        artStyleLabel: parsed.data.artStyleLabel,
        engine: parsed.data.engine,
        imageType: parsed.data.imageType,
        prompt: parsed.data.prompt,
        referenceContext: parsed.data.referenceContext,
      });
      const text = await callOpenAICompatibleTextModel(
        providerSetting,
        instruction,
        parsed.data.action === "variations" ? 1800 : 1200,
        parsed.data.action === "variations" ? 0.8 : 0.3,
      );

      if (!text) return jsonError(reply, "提示词助手未返回可用内容", 502);
      const parsedOutput = parsePromptAssistOutput(parsed.data.action, text);
      if (!isUsablePromptAssistOutput(parsed.data.action, parsedOutput)) {
        return jsonError(reply, "提示词助手未返回可用内容", 502);
      }

      return reply.send(parsedOutput);
    } catch (error) {
      request.log.error({ err: error }, "prompt assist failed");
      return jsonError(reply, "提示词辅助失败", 500);
    }
  });
}

function isUsablePromptAssistOutput(
  action: (typeof promptAssistActions)[number],
  output: ReturnType<typeof parsePromptAssistOutput>,
) {
  if (action === "variations") {
    return output.variations.filter((variation) => variation.trim().length > 0).length === 3;
  }

  return output.prompt.trim().length > 0;
}
