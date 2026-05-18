import { useEffect, useState } from "react";

import { AccountActions } from "@/components/AccountActions";
import { AdminAssetIntegrityPanel, type AdminAssetIntegrityReportPayload } from "@/components/AdminAssetIntegrityPanel";
import { AdminUsagePanel, type AdminUsageUserPayload } from "@/components/AdminUsagePanel";
import { AdminUserReview, type AdminReviewUser } from "@/components/AdminUserReview";
import { CodexLoginCard } from "@/components/CodexLoginCard";
import { GeminiBridgeCard } from "@/components/GeminiBridgeCard";
import { ProviderModelPoolSettings, ProviderSettingsForm, type ProviderSettingHistoryPayload, type ProviderSettingPayload } from "@/components/ProviderSettingsForm";
import { SystemUpdatePanel } from "@/components/SystemUpdatePanel";
import { AppIcon } from "@/components/ui/AppIcon";
import { IconApiKey, IconAssets, IconReview, IconUsage, IconVersion } from "@/components/ui/icons";
import { canAccessAdmin } from "@/lib/admin-access";
import { getClientAppVariant } from "@/lib/api-client";
import { apiJson, ensureRecentBoard, getCurrentUser, type CurrentUserPayload } from "../api";
import { ErrorState, LoadingState } from "./LoadingState";

type AdminPayload = {
  assetIntegrityReport: AdminAssetIntegrityReportPayload;
  adminUsageUsers: AdminUsageUserPayload[];
  providerHistories: ProviderSettingHistoryPayload[];
  pendingReviewUsers: AdminReviewUser[];
  providerSetting: ProviderSettingPayload | null;
  user: CurrentUserPayload;
};

export function AdminApp() {
  const [payload, setPayload] = useState<AdminPayload | null>(null);
  const [error, setError] = useState("");
  const [isProviderSettingsExpanded, setIsProviderSettingsExpanded] = useState(true);
  const [isModelPoolExpanded, setIsModelPoolExpanded] = useState(false);
  const isLocal = getClientAppVariant() === "local";

  useEffect(() => {
    async function load() {
      try {
        const { user } = await getCurrentUser();
        if (!canAccessAdmin(user)) {
          const { board } = await ensureRecentBoard();
          window.location.replace(`/boards/${board.id}`);
          return;
        }

        const [providerPayload, pending, usage, assetIntegrity] = await Promise.all([
          apiJson<{ histories?: ProviderSettingHistoryPayload[]; providerSetting: ProviderSettingPayload | null }>("/api/provider-settings"),
          isLocal ? Promise.resolve({ users: [] }) : apiJson<{ users: AdminReviewUser[] }>("/api/admin/users"),
          isLocal ? Promise.resolve({ users: [] }) : apiJson<{ users: AdminUsageUserPayload[] }>("/api/admin/usage"),
          isLocal
            ? Promise.resolve({ report: { missingAssets: [] } as unknown as AdminAssetIntegrityReportPayload })
            : apiJson<{ report: AdminAssetIntegrityReportPayload }>("/api/admin/asset-integrity"),
        ]);
        setPayload({
          assetIntegrityReport: assetIntegrity.report,
          adminUsageUsers: usage.users,
          pendingReviewUsers: pending.users,
          providerHistories: providerPayload.histories ?? [],
          providerSetting: providerPayload.providerSetting,
          user,
        });
        setIsProviderSettingsExpanded(!providerPayload.providerSetting?.enabled);
      } catch (error) {
        const message = error instanceof Error ? error.message : "加载失败";
        if (message.includes("Authentication")) {
          if (isLocal) window.location.href = "/";
          else window.location.href = "/login";
          return;
        }
        setError(message);
      }
    }
    void load();
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!payload) return <LoadingState />;

  const pendingReviewCount = payload.pendingReviewUsers.length;
  const missingAssetCount = payload.assetIntegrityReport.missingAssetCount ?? 0;
  const providerEnabled = Boolean(payload.providerSetting?.enabled);
  const adminStats = isLocal
    ? [
        { label: "API 状态", value: providerEnabled ? "已启用" : "未配置" },
        { label: "运行模式", value: "本地" },
        { label: "用户模式", value: "单用户" },
        { label: "更新通道", value: "Local" },
      ]
    : [
        { label: "API 状态", value: providerEnabled ? "已启用" : "未配置" },
        { label: "待审核", value: pendingReviewCount },
        { label: "生成任务", value: payload.adminUsageUsers.reduce((sum, user) => sum + user.totalJobCount, 0) },
        { label: "生成图片", value: payload.adminUsageUsers.reduce((sum, user) => sum + user.generatedImageCount, 0) },
        { label: "缺失素材", value: missingAssetCount },
      ];

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div className="admin-topbar-main">
          <a href="/">返回画板</a>
          <div>
            <strong>{isLocal ? "本地设置" : "管理中心"}</strong>
            <span>{isLocal ? "单用户本地环境" : "生产管理环境"}</span>
          </div>
        </div>
        <AccountActions email={payload.user.email} name={payload.user.name ?? payload.user.username} />
      </header>
      <section className="admin-overview" aria-labelledby="admin-overview-title">
        <div className="admin-overview-copy">
          <p className="eyebrow">{isLocal ? "Local Settings" : "Admin Console"}</p>
          <h1 id="admin-overview-title">{isLocal ? "本地模型、接口和系统设置" : "系统、模型和用户运营"}</h1>
          <p>
            {isLocal
              ? "配置本机使用的第三方接口、模型池、Gemini Bridge、Codex 凭据和更新流程。"
              : "集中处理第三方接口、官方登录、在线升级、用户审核、生成额度和素材一致性。"}
          </p>
          <nav className="admin-quick-nav" aria-label={isLocal ? "本地设置快捷入口" : "管理快捷入口"}>
            <a href="#provider-settings">
              <AppIcon icon={IconApiKey} size="sm" />
              接口配置
            </a>
            <a href="#provider-model-pool">
              <AppIcon icon={IconApiKey} size="sm" />
              模型池
            </a>
            <a href="#system-update">
              <AppIcon icon={IconVersion} size="sm" />
              在线升级
            </a>
            {!isLocal ? (
              <>
                <a href="#admin-review">
                  <AppIcon icon={IconReview} size="sm" />
                  用户审核
                </a>
                <a href="#admin-usage">
                  <AppIcon icon={IconUsage} size="sm" />
                  用户用量
                </a>
              </>
            ) : null}
          </nav>
        </div>
        <div className="admin-overview-stats">
          {adminStats.map((item) => (
            <div key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </section>
      <section className={isLocal ? "admin-content admin-content-local" : "admin-content"}>
        <div className="admin-content-main">
          <ProviderSettingsForm
            initialHistories={payload.providerHistories}
            initialSetting={payload.providerSetting}
            isExpanded={isProviderSettingsExpanded}
            onSettingChange={(providerSetting) =>
              setPayload((current) => current ? { ...current, providerSetting } : current)
            }
            onExpandedChange={setIsProviderSettingsExpanded}
          />
          <ProviderModelPoolSettings
            initialSetting={payload.providerSetting}
            isExpanded={isModelPoolExpanded}
            onExpandedChange={setIsModelPoolExpanded}
            onSettingChange={(providerSetting) =>
              setPayload((current) => current ? { ...current, providerSetting } : current)
            }
          />
          <GeminiBridgeCard />
          <CodexLoginCard />
          <section className="admin-card-group" aria-label="系统升级">
            <div className="admin-card-group-heading">
              <AppIcon icon={IconVersion} size="md" />
              <div>
                <h2>版本与发布</h2>
                <p>检查更新包、校验发布摘要并启动在线升级。</p>
              </div>
            </div>
            <SystemUpdatePanel />
          </section>
        </div>
        {!isLocal ? (
          <aside className="admin-content-side" aria-label="用户与素材管理">
            <AdminUserReview initialUsers={payload.pendingReviewUsers} />
            <AdminUsagePanel initialUsers={payload.adminUsageUsers} />
            <AdminAssetIntegrityPanel initialReport={payload.assetIntegrityReport} />
          </aside>
        ) : (
          <aside className="admin-local-note" aria-label="本地管理说明">
            <AppIcon icon={IconAssets} size="lg" />
            <div>
              <h2>单用户本地版</h2>
              <p>当前工作区只服务本机使用者，不启用登录、注册审核、用户配额或多用户运营面板；画板、素材和配置保存在这台机器上。</p>
            </div>
          </aside>
        )}
      </section>
    </main>
  );
}
