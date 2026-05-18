"use client";

import { AppIcon } from "@/components/ui/AppIcon";
import {
  IconCollapseDown,
  IconCollapseUp,
  IconDelete,
  IconImage,
  IconPower,
  IconQuota,
  IconRefresh,
  IconSave,
  IconUsage,
} from "@/components/ui/icons";
import { useState, useTransition } from "react";

import { apiFetch } from "@/lib/api-client";

export type AdminUsageImagePayload = {
  boardId: string;
  boardName: string;
  createdAt: string;
  height: number | null;
  id: string;
  jobMode: string | null;
  jobPrompt: string | null;
  publicUrl: string;
  width: number | null;
};

export type AdminUsageUserPayload = {
  boardCount: number;
  canUseAdminProvider: boolean;
  createdAt: string;
  failedJobCount: number;
  generationFiveHourLimit: number | null;
  generationFiveHourUsedCount: number;
  generationLimit: number | null;
  generatedImageCount: number;
  id: string;
  name: string | null;
  pendingJobCount: number;
  recentGeneratedImages: AdminUsageImagePayload[];
  role: string;
  status: string;
  succeededJobCount: number;
  totalJobCount: number;
  username: string | null;
};

export function AdminUsagePanel({
  initialUsers,
}: {
  initialUsers: AdminUsageUserPayload[];
}) {
  const [users, setUsers] = useState(initialUsers);
  const [selectedUserId, setSelectedUserId] = useState(initialUsers[0]?.id ?? "");
  const [totalLimitDrafts, setTotalLimitDrafts] = useState<Record<string, string>>(
    Object.fromEntries(initialUsers.map((user) => [user.id, user.generationLimit?.toString() ?? ""])),
  );
  const [fiveHourLimitDrafts, setFiveHourLimitDrafts] = useState<Record<string, string>>(
    Object.fromEntries(initialUsers.map((user) => [user.id, user.generationFiveHourLimit?.toString() ?? ""])),
  );
  const [message, setMessage] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const totalGeneratedImages = users.reduce((sum, user) => sum + user.generatedImageCount, 0);
  const totalJobs = users.reduce((sum, user) => sum + user.totalJobCount, 0);
  const selectedUser = users.find((user) => user.id === selectedUserId) ?? users[0] ?? null;

  function refreshUsage() {
    setMessage("");
    startTransition(async () => {
      const response = await apiFetch("/api/admin/usage");
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error ?? "刷新用量失败");
        return;
      }
      setUsers(payload.users);
      setTotalLimitDrafts(
        Object.fromEntries(
          (payload.users as AdminUsageUserPayload[]).map((user) => [
            user.id,
            user.generationLimit?.toString() ?? "",
          ]),
        ),
      );
      setFiveHourLimitDrafts(
        Object.fromEntries(
          (payload.users as AdminUsageUserPayload[]).map((user) => [
            user.id,
            user.generationFiveHourLimit?.toString() ?? "",
          ]),
        ),
      );
      const refreshedUsers = payload.users as AdminUsageUserPayload[];
      if (!refreshedUsers.some((user) => user.id === selectedUserId)) {
        setSelectedUserId(refreshedUsers[0]?.id ?? "");
      }
      setMessage("用量已刷新");
    });
  }

  function saveLimit(user: AdminUsageUserPayload) {
    const totalDraft = totalLimitDrafts[user.id]?.trim() ?? "";
    const fiveHourDraft = fiveHourLimitDrafts[user.id]?.trim() ?? "";
    const generationLimit = parseLimitDraft(totalDraft);
    const generationFiveHourLimit = parseLimitDraft(fiveHourDraft);
    if (generationLimit === false || generationFiveHourLimit === false) {
      setMessage("生成次数限制必须是 0 或正整数，留空表示不限量");
      return;
    }

    setMessage("");
    startTransition(async () => {
      const response = await apiFetch("/api/admin/usage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationFiveHourLimit, generationLimit, userId: user.id }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error ?? "保存用量限制失败");
        return;
      }
      setUsers((current) =>
        current.map((item) =>
          item.id === user.id
            ? {
                ...item,
                generationFiveHourLimit: payload.user.generationFiveHourLimit,
                generationLimit: payload.user.generationLimit,
              }
            : item,
        ),
      );
      setMessage("用量限制已保存");
    });
  }

  function manageUser(user: AdminUsageUserPayload, action: "enable" | "disable") {
    setMessage("");
    startTransition(async () => {
      const response = await apiFetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, userId: user.id }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error ?? "用户状态更新失败");
        return;
      }
      setUsers((current) =>
        current.map((item) => (item.id === user.id ? { ...item, status: payload.user.status } : item)),
      );
      setMessage(action === "enable" ? "用户已启用" : "用户已停用");
    });
  }

  function deleteUser(user: AdminUsageUserPayload) {
    if (!window.confirm(`确认删除用户 ${formatUserName(user)}？该用户的画板、素材和生成记录都会被删除。`)) {
      return;
    }
    setMessage("");
    startTransition(async () => {
      const response = await apiFetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error ?? "删除用户失败");
        return;
      }
      setUsers((current) => {
        const nextUsers = current.filter((item) => item.id !== payload.userId);
        if (selectedUserId === payload.userId) {
          setSelectedUserId(nextUsers[0]?.id ?? "");
        }
        return nextUsers;
      });
      setMessage("用户已删除");
    });
  }

  return (
    <section
      aria-label="用户用量"
      className={isExpanded ? "admin-usage is-expanded" : "admin-usage"}
      id="admin-usage"
    >
      <div className="section-title">
        <div>
          <h2>用户用量</h2>
          <p className="muted">选择用户后查看生成历史，并设置总额度和最近 5 小时额度。</p>
        </div>
        <div className="admin-usage-title-actions">
          <button disabled={isPending} onClick={refreshUsage} type="button">
            <AppIcon icon={IconRefresh} className={isPending ? "spin" : undefined} size="md" />
            同步
          </button>
          <button
            aria-controls="admin-usage-body"
            aria-expanded={isExpanded}
            disabled={users.length === 0}
            onClick={() => setIsExpanded((current) => !current)}
            type="button"
          >
            {isExpanded ? <AppIcon icon={IconCollapseUp} size="md" /> : <AppIcon icon={IconCollapseDown} size="md" />}
            {isExpanded ? "收起用户用量" : "展开用户用量"}
          </button>
        </div>
      </div>

      {message ? <p className="auth-success">{message}</p> : null}

      {isExpanded ? (
        <div className="admin-usage-body" id="admin-usage-body">
          <div className="admin-usage-overview">
            <div className="admin-usage-summary">
              <div>
                <AppIcon icon={IconUsage} size="lg" />
                <span>总任务</span>
                <strong>{totalJobs}</strong>
              </div>
              <div>
                <AppIcon icon={IconImage} size="lg" />
                <span>生成图片</span>
                <strong>{totalGeneratedImages}</strong>
              </div>
              <div>
                <AppIcon icon={IconQuota} size="lg" />
                <span>用户数</span>
                <strong>{users.length}</strong>
              </div>
            </div>

            <label className="admin-user-select">
              <span>用户名称</span>
              <select
                disabled={isPending || users.length === 0}
                onChange={(event) => setSelectedUserId(event.target.value)}
                value={selectedUser?.id ?? ""}
              >
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {formatUserName(user)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {selectedUser ? (
            <article className="admin-usage-row">
              <div className="admin-usage-main">
                <div className="admin-usage-user-copy">
                  <h3>{formatUserName(selectedUser)}</h3>
                  <p>
                    {selectedUser.role} · {selectedUser.status} · 注册于{" "}
                    {new Date(selectedUser.createdAt).toLocaleString("zh-CN")}
                  </p>
                </div>
                <div className="admin-usage-metrics" aria-label="用户用量指标">
                  <span>{selectedUser.boardCount} 个画板</span>
                  <span>{selectedUser.totalJobCount} 个任务</span>
                  <span>{selectedUser.succeededJobCount} 成功</span>
                  <span>{selectedUser.failedJobCount} 失败</span>
                  <span>{selectedUser.generatedImageCount} 张图</span>
                  <span>5小时内 {selectedUser.generationFiveHourUsedCount} 张</span>
                  <span>{formatRemaining("总剩余", selectedUser.generationLimit, selectedUser.generatedImageCount)}</span>
                  <span>
                    {formatRemaining(
                      "5小时剩余",
                      selectedUser.generationFiveHourLimit,
                      selectedUser.generationFiveHourUsedCount,
                    )}
                  </span>
                </div>
              </div>

              <div className="admin-usage-controls">
                <div className="admin-user-management-actions" aria-label="用户操作">
                  {selectedUser.status === "approved" ? (
                    <button disabled={isPending} onClick={() => manageUser(selectedUser, "disable")} type="button">
                      <AppIcon icon={IconPower} size="sm" />
                      停用用户
                    </button>
                  ) : (
                    <button disabled={isPending} onClick={() => manageUser(selectedUser, "enable")} type="button">
                      <AppIcon icon={IconPower} size="sm" />
                      启用用户
                    </button>
                  )}
                  <button
                    className="danger-action"
                    disabled={isPending}
                    onClick={() => deleteUser(selectedUser)}
                    type="button"
                  >
                    <AppIcon icon={IconDelete} size="sm" />
                    删除用户
                  </button>
                </div>

                <div className="admin-limit-control">
                  <label>
                    <span>总生成图片上限</span>
                    <input
                      disabled={isPending}
                      inputMode="numeric"
                      min={0}
                      onChange={(event) =>
                        setTotalLimitDrafts((current) => ({ ...current, [selectedUser.id]: event.target.value }))
                      }
                      placeholder="不限量"
                      type="number"
                      value={totalLimitDrafts[selectedUser.id] ?? ""}
                    />
                  </label>
                  <label>
                    <span>每 5 小时上限</span>
                    <input
                      disabled={isPending}
                      inputMode="numeric"
                      min={0}
                      onChange={(event) =>
                        setFiveHourLimitDrafts((current) => ({ ...current, [selectedUser.id]: event.target.value }))
                      }
                      placeholder="不限量"
                      type="number"
                      value={fiveHourLimitDrafts[selectedUser.id] ?? ""}
                    />
                  </label>
                  <button disabled={isPending} onClick={() => saveLimit(selectedUser)} type="button">
                    <AppIcon icon={IconSave} size="sm" />
                    保存限制
                  </button>
                </div>
              </div>

              <div className="admin-history">
                <div>
                  <h4>历史生成数据</h4>
                  <p className="muted">按生成时间倒序展示最近 40 张成功生成图片。</p>
                </div>
                {selectedUser.recentGeneratedImages.length === 0 ? (
                  <p className="muted">该用户还没有生成图片。</p>
                ) : (
                  <div className="admin-history-list">
                    {selectedUser.recentGeneratedImages.map((image) => (
                      <a href={image.publicUrl} key={image.id} target="_blank" title={image.jobPrompt ?? image.boardName}>
                        <img alt="" src={image.publicUrl} />
                        <span>
                          <strong>{image.boardName}</strong>
                          <em>{formatMode(image.jobMode)} · {new Date(image.createdAt).toLocaleString("zh-CN")}</em>
                          <small>{image.jobPrompt ?? "无提示词记录"}</small>
                        </span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </article>
          ) : (
            <p className="muted">暂无可查看用户。</p>
          )}
        </div>
      ) : (
        <p className="admin-usage-collapsed-summary">
          {users.length} 个用户 · {totalGeneratedImages} 张生成图片 · {totalJobs} 个生成任务
        </p>
      )}
    </section>
  );
}

function parseLimitDraft(value: string) {
  if (value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return false;
  }
  return parsed;
}

function formatUserName(user: AdminUsageUserPayload) {
  return user.username ?? user.name ?? "未命名用户";
}

function formatRemaining(label: string, limit: number | null, used: number) {
  return limit === null ? `${label}不限量` : `${label} ${Math.max(0, limit - used)}`;
}

function formatMode(mode: string | null) {
  if (mode === "text_to_image") {
    return "AI 生图";
  }
  if (mode === "inpaint") {
    return "AI 改图";
  }
  return "未知模式";
}
