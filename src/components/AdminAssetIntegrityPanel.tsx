"use client";

import { useMemo, useState, useTransition } from "react";

import { apiFetch } from "@/lib/api-client";
import { AppIcon } from "@/components/ui/AppIcon";
import {
  IconApprove,
  IconCollapseDown,
  IconCollapseUp,
  IconDelete,
  IconImageFile,
  IconRefresh,
  IconReview,
} from "@/components/ui/icons";

export type AdminMissingAssetPayload = {
  boardId: string;
  boardName: string;
  createdAt: string;
  id: string;
  kind: string;
  storageKey: string;
  userId: string;
  username: string | null;
};

export type AdminAssetIntegrityReportPayload = {
  missingAssetCount: number;
  missingAssets: AdminMissingAssetPayload[];
  totalAssetCount: number;
};

export function AdminAssetIntegrityPanel({
  initialReport,
}: {
  initialReport: AdminAssetIntegrityReportPayload;
}) {
  const [report, setReport] = useState(initialReport);
  const [message, setMessage] = useState("");
  const [isExpanded, setIsExpanded] = useState(initialReport.missingAssetCount > 0);
  const [isPending, startTransition] = useTransition();
  const missingAssetIds = useMemo(() => report.missingAssets.map((asset) => asset.id), [report.missingAssets]);

  function refreshReport(nextMessage = "素材一致性已刷新") {
    setMessage("");
    startTransition(async () => {
      const response = await apiFetch("/api/admin/asset-integrity");
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error ?? "刷新素材一致性失败");
        return;
      }
      setReport(payload.report);
      setMessage(nextMessage);
    });
  }

  function cleanupMissingAssets() {
    if (missingAssetIds.length === 0) return;
    if (!window.confirm(`确认清理 ${missingAssetIds.length} 条缺失素材记录？只会删除文件已不存在的数据库记录。`)) {
      return;
    }
    setMessage("");
    startTransition(async () => {
      const response = await apiFetch("/api/admin/asset-integrity/cleanup", {
        body: JSON.stringify({ assetIds: missingAssetIds }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error ?? "清理缺失素材失败");
        return;
      }
      setMessage(`已清理 ${payload.cleanedAssetIds.length} 条缺失素材记录`);
      refreshReport(`已清理 ${payload.cleanedAssetIds.length} 条缺失素材记录`);
    });
  }

  return (
    <section
      aria-label="素材一致性"
      className={isExpanded ? "admin-usage admin-asset-integrity is-expanded" : "admin-usage admin-asset-integrity"}
      id="admin-asset-integrity"
    >
      <div className="section-title">
        <div>
          <h2>素材一致性</h2>
          <p className="muted">检查数据库素材记录是否还能找到对应上传文件，避免生成时命中缺失源图。</p>
        </div>
        <div className="admin-usage-title-actions">
          <button disabled={isPending} onClick={() => refreshReport()} type="button">
            <AppIcon icon={IconRefresh} className={isPending ? "spin" : undefined} size="md" />
            扫描
          </button>
          <button
            aria-controls="admin-asset-integrity-body"
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded((current) => !current)}
            type="button"
          >
            {isExpanded ? <AppIcon icon={IconCollapseUp} size="md" /> : <AppIcon icon={IconCollapseDown} size="md" />}
            {isExpanded ? "收起素材检查" : "展开素材检查"}
          </button>
        </div>
      </div>

      {message ? <p className="auth-success">{message}</p> : null}

      {isExpanded ? (
        <div className="admin-asset-integrity-body" id="admin-asset-integrity-body">
          <div className="admin-usage-summary">
            <div>
              <AppIcon icon={IconImageFile} size="lg" />
              <span>素材记录</span>
              <strong>{report.totalAssetCount}</strong>
            </div>
            <div>
              <AppIcon icon={IconReview} size="lg" />
              <span>缺失文件</span>
              <strong>{report.missingAssetCount}</strong>
            </div>
            <div>
              <AppIcon icon={IconApprove} size="lg" />
              <span>可用记录</span>
              <strong>{Math.max(0, report.totalAssetCount - report.missingAssetCount)}</strong>
            </div>
          </div>

          <div className="admin-asset-integrity-actions">
            <button
              className="danger-action"
              disabled={isPending || missingAssetIds.length === 0}
              onClick={cleanupMissingAssets}
              type="button"
            >
              <AppIcon icon={IconDelete} size="sm" />
              清理缺失记录
            </button>
            <span>{missingAssetIds.length === 0 ? "当前素材文件完整。" : "清理前会二次确认文件仍然缺失。"}</span>
          </div>

          {report.missingAssets.length > 0 ? (
            <div className="admin-asset-integrity-list">
              {report.missingAssets.map((asset) => (
                <article className="admin-asset-integrity-row" key={asset.id}>
                  <div>
                    <h3>{asset.boardName}</h3>
                    <p>
                      {asset.username ?? "未知用户"} · {formatAssetKind(asset.kind)} ·{" "}
                      {new Date(asset.createdAt).toLocaleString("zh-CN")}
                    </p>
                  </div>
                  <code>{asset.storageKey}</code>
                </article>
              ))}
            </div>
          ) : (
            <p className="admin-usage-collapsed-summary">没有发现缺失素材文件。</p>
          )}
        </div>
      ) : (
        <p className="admin-usage-collapsed-summary">
          {report.totalAssetCount} 条素材记录 · {report.missingAssetCount} 条缺失文件
        </p>
      )}
    </section>
  );
}

function formatAssetKind(kind: string) {
  if (kind === "generated") return "生成图";
  if (kind === "upload") return "上传图";
  if (kind === "source") return "源图";
  if (kind === "mask") return "蒙版";
  return kind;
}
