import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { getAdminUsageUsers } from "@/lib/admin-usage";
import { cleanupMissingAssets, getAssetIntegrityReport } from "@/lib/asset-integrity";
import { deleteGeneratedImageArchive } from "@/lib/local-export";
import { prisma } from "@/lib/prisma";
import { deleteLocalBoardAssets } from "@/lib/storage";
import { requireAdminUser } from "../auth";
import { jsonError, parseBody } from "../http";

const reviewSchema = z.object({ action: z.enum(["approve", "reject"]), canUseAdminProvider: z.boolean().default(false), userId: z.string().min(1) });
const manageUserSchema = z.object({ action: z.enum(["enable", "disable"]), userId: z.string().min(1) });
const deleteUserSchema = z.object({ userId: z.string().min(1) });
const updateUsageLimitSchema = z.object({ generationFiveHourLimit: z.number().int().min(0).nullable(), generationLimit: z.number().int().min(0).nullable(), userId: z.string().min(1) });
const cleanupMissingAssetsSchema = z.object({ assetIds: z.array(z.string().min(1)).max(200) });

export async function registerAdminRoutes(app: FastifyInstance) {
  app.get("/api/admin/users", async (request, reply) => {
    const admin = await requireAdminUser(request, reply);
    if (!admin) return;
    const users = await prisma.user.findMany({
      where: { role: "user", status: "pending" },
      orderBy: { createdAt: "asc" },
      select: { canUseAdminProvider: true, createdAt: true, generationFiveHourLimit: true, generationLimit: true, id: true, name: true, status: true, username: true },
    });
    return { users };
  });

  app.post("/api/admin/users", async (request, reply) => {
    const admin = await requireAdminUser(request, reply);
    if (!admin) return;
    const parsed = parseBody(reviewSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    if (parsed.data.userId === admin.id) return jsonError(reply, "Cannot review current admin user", 400);
    const existingUser = await prisma.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true, role: true } });
    if (!existingUser || existingUser.role === "admin") return jsonError(reply, "User not found", 404);
    const user = await prisma.user.update({
      where: { id: parsed.data.userId },
      data: parsed.data.action === "approve"
        ? { approvedAt: new Date(), approvedByUserId: admin.id, canUseAdminProvider: parsed.data.canUseAdminProvider, status: "approved" }
        : { approvedAt: null, approvedByUserId: admin.id, canUseAdminProvider: false, status: "rejected" },
      select: { canUseAdminProvider: true, createdAt: true, generationFiveHourLimit: true, generationLimit: true, id: true, name: true, status: true, username: true },
    });
    return { user };
  });

  app.patch("/api/admin/users", async (request, reply) => {
    const admin = await requireAdminUser(request, reply);
    if (!admin) return;
    const parsed = parseBody(manageUserSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    if (parsed.data.userId === admin.id) return jsonError(reply, "Cannot manage current admin user", 400);
    const existingUser = await prisma.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true, role: true } });
    if (!existingUser || existingUser.role === "admin") return jsonError(reply, "User not found", 404);
    const user = await prisma.user.update({
      where: { id: parsed.data.userId },
      data: parsed.data.action === "enable" ? { approvedAt: new Date(), approvedByUserId: admin.id, status: "approved" } : { approvedByUserId: admin.id, canUseAdminProvider: false, status: "disabled" },
      select: { canUseAdminProvider: true, createdAt: true, generationFiveHourLimit: true, generationLimit: true, id: true, name: true, status: true, username: true },
    });
    return { user };
  });

  app.delete("/api/admin/users", async (request, reply) => {
    const admin = await requireAdminUser(request, reply);
    if (!admin) return;
    const parsed = parseBody(deleteUserSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    if (parsed.data.userId === admin.id) return jsonError(reply, "Cannot delete current admin user", 400);
    const existingUser = await prisma.user.findUnique({ where: { id: parsed.data.userId }, select: { boards: { select: { id: true } }, id: true, role: true, username: true } });
    if (!existingUser || existingUser.role === "admin") return jsonError(reply, "User not found", 404);
    for (const board of existingUser.boards) await deleteLocalBoardAssets(board.id);
    await deleteGeneratedImageArchive(existingUser.username);
    await prisma.user.delete({ where: { id: parsed.data.userId } });
    return { userId: parsed.data.userId };
  });

  app.get("/api/admin/usage", async (request, reply) => {
    const admin = await requireAdminUser(request, reply);
    if (!admin) return;
    return { users: await getAdminUsageUsers() };
  });

  app.patch("/api/admin/usage", async (request, reply) => {
    const admin = await requireAdminUser(request, reply);
    if (!admin) return;
    const parsed = parseBody(updateUsageLimitSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const targetUser = await prisma.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true } });
    if (!targetUser) return jsonError(reply, "User not found", 404);
    const user = await prisma.user.update({ where: { id: parsed.data.userId }, data: { generationFiveHourLimit: parsed.data.generationFiveHourLimit, generationLimit: parsed.data.generationLimit }, select: { generationFiveHourLimit: true, generationLimit: true, id: true } });
    return { user };
  });

  app.get("/api/admin/asset-integrity", async (request, reply) => {
    const admin = await requireAdminUser(request, reply);
    if (!admin) return;
    return { report: await getAssetIntegrityReport() };
  });

  app.post("/api/admin/asset-integrity/cleanup", async (request, reply) => {
    const admin = await requireAdminUser(request, reply);
    if (!admin) return;
    const parsed = parseBody(cleanupMissingAssetsSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    return cleanupMissingAssets(parsed.data.assetIds);
  });
}
