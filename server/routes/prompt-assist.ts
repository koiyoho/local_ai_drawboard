import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  buildPromptAssistInstruction,
  parsePromptAssistOutput,
  promptAssistActions,
  promptAssistImageTypes,
} from "@/lib/prompt-assist";
import { createOpenAIClient, getTextModel } from "@/lib/openai";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "../auth";
import { jsonError, parseBody } from "../http";
import { getProviderSetting } from "../provider-settings-helper";

const promptAssistSchema = z.object({
  action: z.enum(promptAssistActions),
  artStyle: z.string().trim().max(80).optional(),
  artStyleInstruction: z.string().trim().max(1000).optional(),
  artStyleLabel: z.string().trim().max(80).optional(),
  boardId: z.string().min(1),
  imageType: z.enum(promptAssistImageTypes).default("auto"),
  prompt: z.string().trim().min(1).max(20000),
  referenceContext: z.string().trim().max(2000).optional(),
});

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
      return jsonError(reply, "请配置第三方 API 或联系管理员授权使用当前 API", 400);
    }

    try {
      const openai = createOpenAIClient(providerSetting);
      const model = getTextModel(providerSetting);
      const instruction = buildPromptAssistInstruction({
        action: parsed.data.action,
        artStyle: parsed.data.artStyle,
        artStyleInstruction: parsed.data.artStyleInstruction,
        artStyleLabel: parsed.data.artStyleLabel,
        imageType: parsed.data.imageType,
        prompt: parsed.data.prompt,
        referenceContext: parsed.data.referenceContext,
      });
      let text = "";

      try {
        const response = await openai.responses.create({
          input: [{ content: [{ text: instruction, type: "input_text" }], role: "user" }],
          max_output_tokens: parsed.data.action === "variations" ? 1800 : 1200,
          model,
          temperature: parsed.data.action === "variations" ? 0.8 : 0.3,
        });
        text = response.output_text?.trim() ?? "";
      } catch (responseError) {
        if (!shouldFallbackToChatCompletions(responseError)) {
          throw responseError;
        }

        const response = await openai.chat.completions.create({
          max_tokens: parsed.data.action === "variations" ? 1800 : 1200,
          messages: [{ content: instruction, role: "user" }],
          model,
          temperature: parsed.data.action === "variations" ? 0.8 : 0.3,
        });
        const content = response.choices[0]?.message.content;
        text = typeof content === "string" ? content.trim() : "";
      }

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

function shouldFallbackToChatCompletions(error: unknown) {
  const status = getErrorNumber(error, "status") ?? getErrorNumber(error, "statusCode");
  if (status !== 404 && status !== 405) return false;

  const code = getErrorString(error, "code").toLowerCase();
  if (
    code.includes("model_not_found") ||
    code.includes("resource_not_found") ||
    code.includes("unsupported_model") ||
    code.includes("unsupported_parameter")
  ) {
    return false;
  }
  if (
    code.includes("method_not_allowed") ||
    code.includes("endpoint_not_found") ||
    code.includes("route_not_found") ||
    code.includes("url_not_found") ||
    code.includes("not_implemented")
  ) {
    return true;
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (
    message.includes("model not found") ||
    message.includes("resource not found") ||
    message.includes("unsupported model") ||
    message.includes("unsupported parameter")
  ) {
    return false;
  }

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

function getErrorString(error: unknown, key: string) {
  if (!isRecord(error)) return "";
  const value = error[key];
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
