import { useEffect, useRef, useState } from "react";

import { apiJson } from "@/client/api";
import { AppIcon } from "@/components/ui/AppIcon";
import { IconCollapseDown, IconCollapseUp, IconRefresh } from "@/components/ui/icons";
import { formatUpdateError, isTerminalUpdateJobStatus, shouldSurfaceUpdatePollingError } from "@/lib/system-update-ui";
import type { UpdateCheckPayload, UpdateJobPayload, UpdateJobResponse, UpdateManifestPayload } from "@/components/system-update-types";

const completionRefreshDelaysMs = [1000, 2500, 5000, 8000];

export function SystemUpdatePanel() {
  const [payload, setPayload] = useState<UpdateCheckPayload | null>(null);
  const [job, setJob] = useState<UpdateJobPayload | null>(null);
  const [error, setError] = useState("");
  const [isApplying, setIsApplying] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const jobRef = useRef<UpdateJobPayload | null>(null);

  function updateJob(nextJob: UpdateJobPayload | null) {
    jobRef.current = nextJob;
    setJob(nextJob);
  }

  async function checkUpdate(options: { setChecking?: boolean; surfaceError?: boolean } = {}) {
    const setChecking = options.setChecking ?? true;
    const surfaceError = options.surfaceError ?? true;
    if (setChecking) setIsChecking(true);
    if (surfaceError) setError("");
    try {
      setPayload(await apiJson<UpdateCheckPayload>("/api/system/update/check"));
      setError("");
      return true;
    } catch (error) {
      if (surfaceError) {
        setError(formatUpdateError(error, "检查更新失败"));
      }
      return false;
    } finally {
      if (setChecking) setIsChecking(false);
    }
  }

  async function refreshUpdateAfterCompletion() {
    for (const delayMs of completionRefreshDelaysMs) {
      await wait(delayMs);
      if (await checkUpdate({ setChecking: false, surfaceError: false })) return;
    }
  }

  async function applyLatestUpdate(options: { forceReapply?: boolean } = {}) {
    if (!payload?.manifest) return;
    setIsApplying(true);
    setError("");
    try {
      const result = await apiJson<{ jobId: string }>("/api/system/update/apply", {
        body: JSON.stringify({ confirmedVersion: payload.manifest.version, forceReapply: options.forceReapply }),
        method: "POST",
      });
      const nextJob = await apiJson<UpdateJobResponse>(`/api/system/update/jobs/${result.jobId}`);
      updateJob(nextJob.job);
    } catch (error) {
      setError(formatUpdateError(error, "启动升级失败"));
    } finally {
      setIsApplying(false);
    }
  }

  useEffect(() => {
    void checkUpdate();
  }, []);

  useEffect(() => {
    if (!job || isTerminalUpdateJobStatus(job.status)) return;
    const polledJobId = job.id;
    const timer = window.setInterval(() => {
      void apiJson<UpdateJobResponse>(`/api/system/update/jobs/${polledJobId}`)
        .then((payload) => {
          setError("");
          updateJob(payload.job);
          if (payload.job.status === "completed") {
            void refreshUpdateAfterCompletion();
          }
        })
        .catch((error) => {
          if (!shouldSurfaceUpdatePollingError(jobRef.current, polledJobId)) return;
          setError(formatUpdateError(error, "读取升级进度失败"));
        });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [job]);

  const current = payload?.current;
  const manifest = payload?.manifest;
  const canApply = Boolean(payload?.updateAvailable && manifest && manifest.migrationMode !== "manual_required");
  const canReapplyCurrent = Boolean(
    payload
    && !payload.updateAvailable
    && manifest
    && current?.version === manifest.version
    && manifest.migrationMode !== "manual_required",
  );

  return (
    <section className="admin-card" id="system-update">
      <div className="admin-card-header">
        <div>
          <p className="eyebrow">系统</p>
          <h2>在线升级</h2>
        </div>
        <div className="provider-title-actions">
          <button disabled={isChecking} onClick={() => void checkUpdate()} type="button">
            <AppIcon icon={IconRefresh} className={isChecking ? "spin" : undefined} size="md" />
            {isChecking ? "检查中" : "检查更新"}
          </button>
          <button
            aria-controls="system-update-body"
            aria-expanded={isExpanded}
            onClick={() => setIsExpanded((current) => !current)}
            type="button"
          >
            {isExpanded ? <AppIcon icon={IconCollapseUp} size="md" /> : <AppIcon icon={IconCollapseDown} size="md" />}
            {isExpanded ? "收起" : "展开"}
          </button>
        </div>
      </div>
      <div className="settings-summary">
        <span>当前版本</span>
        <strong>{current?.version ?? "读取中"}</strong>
      </div>
      {payload?.manifest ? (
        <div className="settings-summary">
          <span>最新版本</span>
          <strong>{payload.manifest.version}</strong>
        </div>
      ) : null}
      {isExpanded ? (
        <>
          <div className="settings-summary">
            <span>发布通道</span>
            <strong>{current?.updateChannel ?? "读取中"}</strong>
          </div>
          <div className="settings-summary">
            <span>运行版本</span>
            <strong>{current?.variant ?? "读取中"}</strong>
          </div>
          {manifest ? (
            <>
              <div className="settings-summary">
                <span>迁移策略</span>
                <strong>{formatMigrationMode(manifest.migrationMode)}</strong>
              </div>
              <div className="settings-summary">
                <span>校验摘要</span>
                <strong>{manifest.sha256.slice(0, 12)}...</strong>
              </div>
              {manifest.releaseNotes ? <p className="form-hint">{manifest.releaseNotes}</p> : null}
            </>
          ) : null}
          {payload ? (
            <p className="form-hint">
              {payload.updateAvailable
                ? "检测到新版本。升级会先下载并校验发布包，服务重启期间页面可能短暂断开。"
                : canReapplyCurrent
                  ? "当前已是最新版本。如本地文件或依赖状态异常，可重新应用当前发布包。"
                  : payload.reason ?? "当前已是最新版本。"}
            </p>
          ) : null}
          {payload?.updateAvailable ? (
            <button disabled={!canApply || isApplying} onClick={() => void applyLatestUpdate()} type="button">
              {isApplying ? "启动中" : manifest?.migrationMode === "manual_required" ? "需要手动升级" : "下载并升级"}
            </button>
          ) : null}
          {canReapplyCurrent ? (
            <button disabled={isApplying} onClick={() => void applyLatestUpdate({ forceReapply: true })} type="button">
              {isApplying ? "启动中" : "重新应用当前发布包"}
            </button>
          ) : null}
        </>
      ) : (
        <p className="admin-usage-collapsed-summary">
          {payload?.updateAvailable ? "检测到新版本，展开后可执行升级。" : payload?.reason ?? "展开查看发布通道、校验摘要和升级操作。"}
        </p>
      )}
      {job ? (
        <div className="settings-summary" aria-live="polite">
          <span>升级任务</span>
          <strong>{formatJobStatus(job.status)} · {job.message}</strong>
        </div>
      ) : null}
      {job?.error ? <p className="form-error">{job.error}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}

function wait(delayMs: number) {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

function formatMigrationMode(mode: UpdateManifestPayload["migrationMode"]) {
  if (mode === "manual_required") return "需要手动处理";
  if (mode === "reversible") return "可回滚迁移";
  return "无需迁移";
}

function formatJobStatus(status: string) {
  const labels: Record<string, string> = {
    completed: "已完成",
    downloading: "下载中",
    failed: "失败",
    queued: "排队中",
    rolled_back: "已回滚",
    verifying: "校验中",
  };
  return labels[status] ?? status;
}
