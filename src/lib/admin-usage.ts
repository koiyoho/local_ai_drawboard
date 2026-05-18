import { prisma } from "@/lib/prisma";
import type { User } from "@/generated/prisma/client";

export type AdminUsageImage = {
  boardId: string;
  boardName: string;
  createdAt: Date;
  height: number | null;
  id: string;
  jobMode: string | null;
  jobPrompt: string | null;
  publicUrl: string;
  width: number | null;
};

export type AdminUsageUser = {
  boardCount: number;
  canUseAdminProvider: boolean;
  createdAt: Date;
  failedJobCount: number;
  generationFiveHourLimit: number | null;
  generationFiveHourUsedCount: number;
  generationLimit: number | null;
  generatedImageCount: number;
  id: string;
  name: string | null;
  pendingJobCount: number;
  recentGeneratedImages: AdminUsageImage[];
  role: string;
  status: string;
  succeededJobCount: number;
  totalJobCount: number;
  username: string | null;
};

export async function getAdminUsageUsers(): Promise<AdminUsageUser[]> {
  const fiveHourWindowStart = new Date(Date.now() - 5 * 60 * 60 * 1000);
  const users = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { createdAt: "desc" }],
    select: {
      canUseAdminProvider: true,
      createdAt: true,
      generationFiveHourLimit: true,
      generationLimit: true,
      id: true,
      name: true,
      role: true,
      status: true,
      username: true,
    },
  });

  return Promise.all(
    (users as User[]).map(async (user) => {
      const [
        boardCount,
        totalJobCount,
        succeededJobCount,
        failedJobCount,
        pendingJobCount,
        generatedImageCount,
        generationFiveHourUsedCount,
        recentGeneratedAssets,
      ] = await Promise.all([
        prisma.board.count({ where: { userId: user.id } }),
        prisma.generationJob.count({ where: { board: { userId: user.id } } }),
        prisma.generationJob.count({ where: { board: { userId: user.id }, status: "succeeded" } }),
        prisma.generationJob.count({ where: { board: { userId: user.id }, status: "failed" } }),
        prisma.generationJob.count({ where: { board: { userId: user.id }, status: "running" } }),
        prisma.generationResult.count({ where: { job: { board: { userId: user.id } } } }),
        prisma.generationResult.count({
          where: {
            createdAt: { gte: fiveHourWindowStart },
            job: { board: { userId: user.id } },
          },
        }),
        prisma.asset.findMany({
          where: { board: { userId: user.id }, kind: "generated" },
          orderBy: { createdAt: "desc" },
          take: 40,
          select: {
            board: { select: { id: true, name: true } },
            createdAt: true,
            generationResults: {
              orderBy: { createdAt: "desc" },
              select: {
                job: {
                  select: {
                    mode: true,
                    prompt: true,
                  },
                },
              },
              take: 1,
            },
            height: true,
            id: true,
            publicUrl: true,
            width: true,
          },
        }),
      ]);

      return {
        ...user,
        boardCount,
        failedJobCount,
        generationFiveHourUsedCount,
        generatedImageCount,
        pendingJobCount,
        recentGeneratedImages: (recentGeneratedAssets as Array<{
          board: { id: string; name: string };
          createdAt: Date;
          generationResults: Array<{ job: { mode: string; prompt: string } }>;
          height: number | null;
          id: string;
          publicUrl: string;
          width: number | null;
        }>).map((asset) => ({
          boardId: asset.board.id,
          boardName: asset.board.name,
          createdAt: asset.createdAt,
          height: asset.height,
          id: asset.id,
          jobMode: asset.generationResults[0]?.job.mode ?? null,
          jobPrompt: asset.generationResults[0]?.job.prompt ?? null,
          publicUrl: asset.publicUrl,
          width: asset.width,
        })),
        succeededJobCount,
        totalJobCount,
      };
    }),
  );
}
