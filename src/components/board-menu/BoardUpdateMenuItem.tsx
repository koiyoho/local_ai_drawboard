import { useEffect, useRef, useState } from "react";

import { apiJson } from "@/client/api";
import type { UpdateCheckPayload, UpdateJobPayload, UpdateJobResponse } from "@/components/system-update-types";
import { AppIcon } from "@/components/ui/AppIcon";
import { IconRefresh, IconVersion } from "@/components/ui/icons";
import { isTerminalUpdateJobStatus, shouldSurfaceUpdatePollingError } from "@/lib/system-update-ui";

const completionRefreshDelaysMs = [1000, 2500, 5000, 8000];

export function BoardUpdateMenuItem({ isAdmin }: { isAdmin: boolean }) {
  const [payload, setPayload] = useState<UpdateCheckPayload | null>(null);
  const [job, setJob] = useState<UpdateJobPayload | null>(null);
  const [message, setMessage] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const jobRef = useRef<UpdateJobPayload | null>(null);

  function updateJob(nextJob: UpdateJobPayload | null) {
    jobRef.current = nextJob;
    setJob(nextJob);
  }

  async function loadVersion() {
    try {
      const current = await apiJson<UpdateCheckPayload["current"]>("/api/system/version");
      setPayload((currentPayload) => currentPayload ? { ...currentPayload, current } : {
        configured: false,
        current,
        manifest: null,
        updateAvailable: false,
      });
    } catch {
      setMessage("版本读取失败");
    }
  }

  async function checkUpdate(options: { surfaceError?: boolean } = {}) {
    if (!isAdmin) {
      await loadVersion();
      return false;
    }
    const surfaceError = options.surfaceError ?? false;
    setIsChecking(true);
    try {
      const nextPayload = await apiJson<UpdateCheckPayload>("/api/system/update/check");
      setPayload(nextPayload);
      setMessage(nextPayload.updateAvailable ? `发现 v${nextPayload.manifest?.version}` : "已是最新版本");
      return true;
    } catch (error) {
      if (surfaceError) setMessage(error instanceof Error ? error.message : "检查更新失败");
      await loadVersion();
      return false;
    } finally {
      setIsChecking(false);
    }
  }

  async function refreshUpdateAfterCompletion() {
    for (const delayMs of completionRefreshDelaysMs) {
      await wait(delayMs);
      if (await checkUpdate()) return;
    }
  }

  async function applyLatestUpdate() {
    if (!payload?.manifest || payload.manifest.migrationMode === "manual_required") return;
    setIsApplying(true);
    setMessage("");
    try {
      const result = await apiJson<{ jobId: string }>("/api/system/update/apply", {
        body: JSON.stringify({ confirmedVersion: payload.manifest.version }),
        method: "POST",
      });
      const nextJob = await apiJson<UpdateJobResponse>(`/api/system/update/jobs/${result.jobId}`);
      updateJob(nextJob.job);
      setMessage("升级任务已启动");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "启动升级失败");
    } finally {
      setIsApplying(false);
    }
  }

  useEffect(() => {
    void checkUpdate();
  }, [isAdmin]);

  useEffect(() => {
    if (!job || isTerminalUpdateJobStatus(job.status)) return;
    const polledJobId = job.id;
    const timer = window.setInterval(() => {
      void apiJson<UpdateJobResponse>(`/api/system/update/jobs/${polledJobId}`)
        .then((nextPayload) => {
          updateJob(nextPayload.job);
          if (nextPayload.job.status === "completed") {
            void refreshUpdateAfterCompletion();
          }
        })
        .catch((error) => {
          if (!shouldSurfaceUpdatePollingError(jobRef.current, polledJobId)) return;
          setMessage(error instanceof Error ? error.message : "读取升级进度失败");
        });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [job]);

  const currentVersion = payload?.current.version ?? "读取中";
  const latestVersion = payload?.manifest?.version ?? "";
  const canApply = Boolean(isAdmin && payload?.updateAvailable && payload.manifest?.migrationMode !== "manual_required");
  const buttonText = job && !isTerminalUpdateJobStatus(job.status)
    ? "升级中"
    : isApplying
      ? "启动中"
      : payload?.updateAvailable
        ? `升级到 ${latestVersion}`
        : isChecking
          ? "检查中"
          : "检查";
  const detailText = job
    ? `${formatJobStatus(job.status)} · ${job.message}`
    : message || (payload?.updateAvailable ? "有新版本可直接升级" : payload?.reason ?? "自动检查更新");

  return (
    <div className={payload?.updateAvailable ? "board-global-menu-version has-update" : "board-global-menu-version"} role="none">
      <div>
        <AppIcon icon={payload?.updateAvailable ? IconRefresh : IconVersion} className={isChecking ? "spin" : undefined} size="md" />
        <span>版本 v{currentVersion}</span>
        {latestVersion ? <em>最新 v{latestVersion}</em> : null}
        <small>{detailText}</small>
      </div>
      <button
        aria-label={payload?.updateAvailable ? `升级到 ${latestVersion}` : "检查更新"}
        disabled={!isAdmin || isApplying || isChecking || Boolean(job && !isTerminalUpdateJobStatus(job.status)) || (payload?.updateAvailable && !canApply)}
        onClick={() => payload?.updateAvailable ? void applyLatestUpdate() : void checkUpdate({ surfaceError: true })}
        type="button"
      >
        {buttonText}
      </button>
    </div>
  );
}

function wait(delayMs: number) {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

function formatJobStatus(status: string) {
  const labels: Record<string, string> = {
    backing_up: "备份中",
    completed: "已完成",
    downloading: "下载中",
    failed: "失败",
    health_checking: "健康检查",
    installing: "安装中",
    queued: "排队中",
    restarting: "重启中",
    rolled_back: "已回滚",
    staging: "准备中",
    verifying: "校验中",
  };
  return labels[status] ?? status;
}
