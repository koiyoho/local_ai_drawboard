"use client";

import { AppIcon } from "@/components/ui/AppIcon";
import {
  IconAi,
  IconApiKey,
  IconBoards,
  IconCopy,
  IconCreateBoard,
  IconDelete,
  IconImage,
  IconOpen,
  IconQuota,
  IconRename,
  IconReview,
  IconUsers,
} from "@/components/ui/icons";
import { type ReactNode, useState, useTransition } from "react";

import {
  ProviderModelPoolSettings,
  ProviderSettingsForm,
  type ProviderSettingPayload,
} from "@/components/ProviderSettingsForm";
import { AdminUserReview, type AdminReviewUser } from "@/components/AdminUserReview";
import { AdminUsagePanel, type AdminUsageUserPayload } from "@/components/AdminUsagePanel";
import { CodexLoginCard } from "@/components/CodexLoginCard";
import { apiFetch } from "@/lib/api-client";

export type BoardListItem = {
  id: string;
  name: string;
  updatedAt: string;
  _count: {
    assets: number;
    jobs: number;
  };
};

export function BoardList({
  accountSlot,
  initialBoards,
  initialAdminUsageUsers,
  initialPendingReviewUsers,
  initialProviderSetting,
  showProviderSettings,
}: {
  accountSlot?: ReactNode;
  initialBoards: BoardListItem[];
  initialAdminUsageUsers?: AdminUsageUserPayload[] | null;
  initialPendingReviewUsers?: AdminReviewUser[] | null;
  initialProviderSetting: ProviderSettingPayload | null;
  showProviderSettings: boolean;
}) {
  const [boards, setBoards] = useState(initialBoards);
  const [name, setName] = useState("未命名画板");
  const [isPending, startTransition] = useTransition();
  const assetCount = boards.reduce((sum, board) => sum + board._count.assets, 0);
  const jobCount = boards.reduce((sum, board) => sum + board._count.jobs, 0);
  const isMultiUserAdminSettings = Boolean(initialAdminUsageUsers || initialPendingReviewUsers);
  const pendingReviewCount = initialPendingReviewUsers?.length ?? 0;
  const adminUserCount = initialAdminUsageUsers?.length ?? 0;
  const [providerSetting, setProviderSetting] = useState(initialProviderSetting);
  const providerStatus = providerSetting?.enabled ? "启用" : "配置";
  const [isProviderSettingsExpanded, setIsProviderSettingsExpanded] = useState(
    !initialProviderSetting?.enabled,
  );
  const [isModelPoolExpanded, setIsModelPoolExpanded] = useState(false);

  function createBoard() {
    startTransition(async () => {
      const response = await apiFetch("/api/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = await response.json();
      if (!response.ok) {
        alert(payload.error ?? "无法创建画板");
        return;
      }
      window.location.href = `/boards/${payload.board.id}`;
    });
  }

  function renameBoard(board: BoardListItem) {
    const nextName = window.prompt("画板名称", board.name)?.trim();
    if (!nextName || nextName === board.name) return;

    startTransition(async () => {
      const response = await apiFetch(`/api/boards/${board.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName }),
      });
      const payload = await response.json();
      if (!response.ok) {
        alert(payload.error ?? "无法重命名画板");
        return;
      }
      setBoards((current) =>
        current.map((item) =>
          item.id === board.id ? { ...item, name: payload.board.name } : item,
        ),
      );
    });
  }

  function duplicateBoard(board: BoardListItem) {
    startTransition(async () => {
      const response = await apiFetch(`/api/boards/${board.id}/duplicate`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) {
        alert(payload.error ?? "无法复制画板");
        return;
      }
      setBoards((current) => [payload.board, ...current]);
    });
  }

  function deleteBoard(board: BoardListItem) {
    const confirmed = window.confirm(`确定删除“${board.name}”？此操作会移除画板和本地素材。`);
    if (!confirmed) return;

    startTransition(async () => {
      const response = await apiFetch(`/api/boards/${board.id}`, {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok) {
        alert(payload.error ?? "无法删除画板");
        return;
      }
      setBoards((current) => current.filter((item) => item.id !== board.id));
    });
  }

  return (
    <main className="home-shell">
      <header className="home-topbar">
        <div className="home-brand">
          <span className="home-brand-mark">AI</span>
          <strong>AI Board</strong>
          <span>工作台</span>
        </div>
        {accountSlot}
      </header>

      <section className="home-content">
        <section className="home-main-column">
          <div className="home-title-block">
            <p className="eyebrow">本地 AI 画布</p>
            <h1>项目工作台</h1>
          </div>

          <section className="create-board">
            <label htmlFor="board-name">新建画板</label>
            <div className="inline-form">
              <input
                id="board-name"
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
              <button disabled={isPending || !name.trim()} onClick={createBoard}>
                <AppIcon icon={IconCreateBoard} size="lg" />
                创建
              </button>
            </div>
          </section>

          <section aria-label="项目概览" className="home-metric-strip">
            <div className="home-metric-card">
              <AppIcon icon={IconBoards} size="xl" />
              <span>画板</span>
              <strong>{boards.length}</strong>
            </div>
            <div className="home-metric-card">
              <AppIcon icon={IconImage} size="xl" />
              <span>素材</span>
              <strong>{assetCount}</strong>
            </div>
            <div className="home-metric-card">
              <AppIcon icon={IconAi} size="xl" />
              <span>任务</span>
              <strong>{jobCount}</strong>
            </div>
            <div className="home-metric-card">
              <AppIcon icon={IconQuota} size="xl" />
              <span>接口</span>
              <strong>{providerStatus}</strong>
            </div>
          </section>

          <section aria-label="画板列表" className="board-list-panel">
            <div className="section-title">
              <div>
                <h2>最近画板</h2>
              </div>
              <span className="home-sort-pill">按更新时间</span>
            </div>
            <div className="board-grid">
              {boards.length === 0 ? (
                <div className="empty-state">
                  <h2>还没有画板</h2>
                  <p>创建一个画板，开始草图绘制和图像生成。</p>
                </div>
              ) : (
                boards.map((board) => (
                  <article className="board-card" key={board.id}>
                    <div className="board-preview" aria-hidden="true" />
                    <div className="board-meta">
                      <div>
                        <h2>{board.name}</h2>
                        <p>
                          {board._count.assets} 个素材 · {board._count.jobs} 个任务
                        </p>
                        <span>更新于 {new Date(board.updatedAt).toLocaleString("zh-CN")}</span>
                      </div>
                      <div className="board-actions">
                        <button
                          disabled={isPending}
                          aria-label={`重命名 ${board.name}`}
                          onClick={() => renameBoard(board)}
                          type="button"
                        >
                          <AppIcon icon={IconRename} size="md" />
                        </button>
                        <button
                          aria-label={`复制 ${board.name}`}
                          disabled={isPending}
                          onClick={() => duplicateBoard(board)}
                          type="button"
                        >
                          <AppIcon icon={IconCopy} size="md" />
                        </button>
                        <button
                          aria-label={`删除 ${board.name}`}
                          className="danger-action"
                          disabled={isPending}
                          onClick={() => deleteBoard(board)}
                          type="button"
                        >
                          <AppIcon icon={IconDelete} size="md" />
                        </button>
                        <a aria-label={`打开 ${board.name}`} href={`/boards/${board.id}`}>
                          <AppIcon icon={IconOpen} size="lg" />
                        </a>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </section>

        <aside className="home-side-column">
          <section aria-label="管理设置" className="admin-settings-landing">
            <div>
              <h2>本地设置</h2>
            </div>
            <div className="admin-settings-landing-grid">
              {showProviderSettings ? (
                <a
                  href="#provider-settings"
                  onClick={() => setIsProviderSettingsExpanded(true)}
                >
                  <AppIcon icon={IconApiKey} size="lg" />
                  <span>API 设置</span>
                  <strong>{providerSetting?.enabled ? "已启用" : "未配置"}</strong>
                </a>
              ) : null}
              {showProviderSettings ? (
                <a
                  href="#provider-model-pool"
                  onClick={() => setIsModelPoolExpanded(true)}
                >
                  <AppIcon icon={IconAi} size="lg" />
                  <span>模型池</span>
                  <strong>{providerSetting?.enabled ? "可配置" : "待配置 API"}</strong>
                </a>
              ) : null}
              {isMultiUserAdminSettings ? (
                <>
                  <a href="#admin-review">
                    <AppIcon icon={IconReview} size="lg" />
                    <span>用户审核</span>
                    <strong>{pendingReviewCount} 个待审核</strong>
                  </a>
                  <a href="#admin-usage">
                    <AppIcon icon={IconUsers} size="lg" />
                    <span>用户管理</span>
                    <strong>{adminUserCount} 个用户</strong>
                  </a>
                </>
              ) : null}
              {!showProviderSettings && !isMultiUserAdminSettings ? (
                <div className="admin-settings-placeholder">
                  <AppIcon icon={IconReview} size="lg" />
                  <span>API 已授权</span>
                  <strong>可生成</strong>
                </div>
              ) : null}
            </div>
          </section>

          {showProviderSettings ? (
            <>
              <ProviderSettingsForm
                initialSetting={providerSetting}
                isExpanded={isProviderSettingsExpanded}
                onExpandedChange={setIsProviderSettingsExpanded}
                onSettingChange={setProviderSetting}
              />
              <ProviderModelPoolSettings
                initialSetting={providerSetting}
                isExpanded={isModelPoolExpanded}
                onExpandedChange={setIsModelPoolExpanded}
                onSettingChange={setProviderSetting}
              />
            </>
          ) : null}

          {isMultiUserAdminSettings ? <CodexLoginCard /> : null}

          {initialPendingReviewUsers ? (
            <AdminUserReview initialUsers={initialPendingReviewUsers} />
          ) : null}
        </aside>

        {initialAdminUsageUsers ? (
          <div className="home-admin-usage-row">
            <AdminUsagePanel initialUsers={initialAdminUsageUsers} />
          </div>
        ) : null}
      </section>
    </main>
  );
}
