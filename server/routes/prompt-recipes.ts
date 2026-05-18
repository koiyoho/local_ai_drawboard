import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "../auth";
import { jsonError, parseBody } from "../http";

const promptRecipeModeSchema = z.enum(["text_to_image", "inpaint"]);
const promptRecipeSchema = z.object({
  mode: promptRecipeModeSchema,
  name: z.string().trim().min(1).max(80),
  params: z.record(z.string(), z.unknown()).default({}),
  prompt: z.string().trim().min(1).max(32000),
});
const renameRecipeSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
});

export async function registerPromptRecipeRoutes(app: FastifyInstance) {
  app.get("/api/prompt-recipes", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const recipes = await prisma.promptRecipe.findMany({
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      where: { userId: user.id },
    });
    return { recipes: recipes.map(formatPromptRecipe) };
  });

  app.post("/api/prompt-recipes", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const parsed = parseBody(promptRecipeSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const recipe = await prisma.promptRecipe.create({
      data: {
        mode: parsed.data.mode,
        name: parsed.data.name,
        paramsJson: JSON.stringify(parsed.data.params),
        prompt: parsed.data.prompt,
        userId: user.id,
      },
    });
    return reply.status(201).send({ recipe: formatPromptRecipe(recipe) });
  });

  app.patch<{ Params: { recipeId: string } }>("/api/prompt-recipes/:recipeId", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const parsed = parseBody(promptRecipeSchema.partial().merge(renameRecipeSchema), request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const existing = await prisma.promptRecipe.findFirst({
      select: { id: true },
      where: { id: request.params.recipeId, userId: user.id },
    });
    if (!existing) return jsonError(reply, "Prompt recipe not found", 404);
    const recipe = await prisma.promptRecipe.update({
      data: {
        ...(parsed.data.mode ? { mode: parsed.data.mode } : {}),
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...(parsed.data.params ? { paramsJson: JSON.stringify(parsed.data.params) } : {}),
        ...(parsed.data.prompt ? { prompt: parsed.data.prompt } : {}),
      },
      where: { id: existing.id },
    });
    return { recipe: formatPromptRecipe(recipe) };
  });

  app.post<{ Params: { recipeId: string } }>("/api/prompt-recipes/:recipeId/duplicate", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const parsed = parseBody(renameRecipeSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const source = await prisma.promptRecipe.findFirst({
      where: { id: request.params.recipeId, userId: user.id },
    });
    if (!source) return jsonError(reply, "Prompt recipe not found", 404);
    const recipe = await prisma.promptRecipe.create({
      data: {
        mode: source.mode,
        name: parsed.data.name ?? `${source.name} 副本`.slice(0, 80),
        paramsJson: source.paramsJson,
        prompt: source.prompt,
        userId: user.id,
      },
    });
    return reply.status(201).send({ recipe: formatPromptRecipe(recipe) });
  });

  app.delete<{ Params: { recipeId: string } }>("/api/prompt-recipes/:recipeId", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const existing = await prisma.promptRecipe.findFirst({
      select: { id: true },
      where: { id: request.params.recipeId, userId: user.id },
    });
    if (!existing) return jsonError(reply, "Prompt recipe not found", 404);
    await prisma.promptRecipe.delete({ where: { id: existing.id } });
    return { ok: true };
  });
}

function formatPromptRecipe(recipe: {
  createdAt: Date;
  id: string;
  mode: string;
  name: string;
  paramsJson: string;
  prompt: string;
  updatedAt: Date;
}) {
  return {
    createdAt: recipe.createdAt,
    id: recipe.id,
    mode: recipe.mode,
    name: recipe.name,
    params: parseParamsJson(recipe.paramsJson),
    prompt: recipe.prompt,
    updatedAt: recipe.updatedAt,
  };
}

function parseParamsJson(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
