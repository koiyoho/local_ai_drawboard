import { prisma } from "@/lib/prisma";

export async function getProviderSetting(userId: string, canUseAdminProvider: boolean) {
  const ownProviderSetting = await prisma.providerSetting.findUnique({
    where: { userId_provider: { provider: "openai-compatible", userId } },
  });
  if (ownProviderSetting?.enabled) return ownProviderSetting;
  if (!canUseAdminProvider) return null;
  return prisma.providerSetting.findFirst({
    where: {
      enabled: true,
      provider: "openai-compatible",
      user: { role: "admin", status: "approved", username: "koiyoho" },
    },
  });
}
