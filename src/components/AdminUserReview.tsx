"use client";

import { AppIcon } from "@/components/ui/AppIcon";
import {
  IconApprove,
  IconCollapseDown,
  IconCollapseUp,
  IconClose,
} from "@/components/ui/icons";
import { useState, useTransition } from "react";

import { apiFetch } from "@/lib/api-client";

export type AdminReviewUser = {
  canUseAdminProvider: boolean;
  createdAt: string;
  generationFiveHourLimit: number | null;
  generationLimit: number | null;
  id: string;
  name: string | null;
  status: string;
  username: string | null;
};

export function AdminUserReview({
  initialUsers,
}: {
  initialUsers: AdminReviewUser[];
}) {
  const [users, setUsers] = useState(initialUsers);
  const [apiAccess, setApiAccess] = useState<Record<string, boolean>>(
    Object.fromEntries(initialUsers.map((user) => [user.id, user.canUseAdminProvider])),
  );
  const [message, setMessage] = useState("");
  const [isExpanded, setIsExpanded] = useState(initialUsers.length > 0);
  const [isPending, startTransition] = useTransition();

  function reviewUser(user: AdminReviewUser, action: "approve" | "reject") {
    setMessage("");
    startTransition(async () => {
      const response = await apiFetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          canUseAdminProvider: action === "approve" ? Boolean(apiAccess[user.id]) : false,
          userId: user.id,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error ?? "审核操作失败");
        return;
      }
      setUsers((current) => current.filter((item) => item.id !== user.id));
      setMessage(action === "approve" ? "用户已通过审核" : "用户已拒绝");
    });
  }

  return (
    <section aria-label="用户审核" className="admin-review" id="admin-review">
      <div className="section-title">
        <div>
          <h2>用户审核</h2>
          <p className="muted">只有管理员可以处理新用户注册和当前 API 授权。</p>
        </div>
        <div className="provider-title-actions">
          <span className="provider-badge">{users.length} 个待审核</span>
          <button
            aria-controls="admin-review-body"
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded((current) => !current)}
            type="button"
          >
            {isExpanded ? <AppIcon icon={IconCollapseUp} size="md" /> : <AppIcon icon={IconCollapseDown} size="md" />}
            {isExpanded ? "收起" : "展开"}
          </button>
        </div>
      </div>
      {message ? <p className="auth-success">{message}</p> : null}
      {!isExpanded ? (
        <p className="admin-usage-collapsed-summary">
          {users.length === 0 ? "当前没有待审核用户。" : `${users.length} 个用户等待处理`}
        </p>
      ) : (
        <div id="admin-review-body">
          {users.length === 0 ? (
            <p className="muted">当前没有待审核用户。</p>
          ) : (
            <div className="admin-review-list">
              {users.map((user) => (
                <article className="admin-review-row" key={user.id}>
                  <div>
                    <h3>{user.username ?? user.name ?? "未命名用户"}</h3>
                    <p>注册于 {new Date(user.createdAt).toLocaleString("zh-CN")}</p>
                  </div>
                  <label className="admin-api-toggle">
                    <input
                      checked={Boolean(apiAccess[user.id])}
                      disabled={isPending}
                      onChange={(event) =>
                        setApiAccess((current) => ({
                          ...current,
                          [user.id]: event.target.checked,
                        }))
                      }
                      type="checkbox"
                    />
                    允许使用当前 API
                  </label>
                  <div className="admin-review-actions">
                    <button disabled={isPending} onClick={() => reviewUser(user, "approve")} type="button">
                      <AppIcon icon={IconApprove} size="md" />
                      通过
                    </button>
                    <button
                      className="danger-action"
                      disabled={isPending}
                      onClick={() => reviewUser(user, "reject")}
                      type="button"
                    >
                      <AppIcon icon={IconClose} size="md" />
                      拒绝
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
