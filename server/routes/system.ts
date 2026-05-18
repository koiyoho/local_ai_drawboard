import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAdminUser } from "../auth";
import { jsonError, parseBody } from "../http";
import { applyUpdate, checkForUpdate, getCurrentVersion, getSystemHealth, getUpdateJob } from "../system-update";

const applyUpdateBodySchema = z.object({
  confirmedVersion: z.string().trim().min(1).optional(),
});

export async function registerSystemRoutes(app: FastifyInstance) {
  app.get("/api/system/version", async () => getCurrentVersion());

  app.get("/api/system/health", async () => getSystemHealth());

  app.get("/api/system/update/check", async (request, reply) => {
    const user = await requireAdminUser(request, reply);
    if (!user) return;
    return checkForUpdate();
  });

  app.post("/api/system/update/apply", async (request, reply) => {
    const user = await requireAdminUser(request, reply);
    if (!user) return;
    const parsed = parseBody(applyUpdateBodySchema, request.body ?? {});
    if (!parsed.ok) return jsonError(reply, parsed.error);
    try {
      return applyUpdate(parsed.data);
    } catch (error) {
      return jsonError(reply, error instanceof Error ? error.message : "Update apply failed");
    }
  });

  app.get<{ Params: { jobId: string } }>("/api/system/update/jobs/:jobId", async (request, reply) => {
    const user = await requireAdminUser(request, reply);
    if (!user) return;
    const job = await getUpdateJob(request.params.jobId);
    if (!job) return jsonError(reply, "Update job not found", 404);
    return { job };
  });
}
