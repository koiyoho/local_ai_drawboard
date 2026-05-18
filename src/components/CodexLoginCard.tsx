"use client";

import { AppIcon } from "@/components/ui/AppIcon";
import {
  IconBot,
  IconCollapseDown,
  IconCollapseUp,
  IconCopy,
  IconExternalLink,
  IconRefresh,
  IconSave,
} from "@/components/ui/icons";
import { useEffect, useState } from "react";

import { apiFetch, apiUrl } from "@/lib/api-client";

export type CodexAuthStatus =
  | {
      connected: false;
      importSourceAvailable?: boolean;
      mode?: string;
      startAvailable?: boolean;
      startDisabledReason?: string | null;
    }
  | {
      accountId: string | null;
      connected: true;
      hasApiKey: boolean;
      importSourceAvailable?: boolean;
      lastLoginAt: string | null;
      mode?: string;
      organizationId: string | null;
      planType: string | null;
      projectId: string | null;
      startAvailable?: boolean;
      startDisabledReason?: string | null;
    };

export function useCodexAuthStatus() {
  const [status, setStatus] = useState<CodexAuthStatus>({ connected: false });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    apiFetch("/api/codex-auth/status")
      .then(async (response) => {
        if (!response.ok) return { connected: false as const };
        return (await response.json()) as CodexAuthStatus;
      })
      .then((payload) => {
        if (active) {
          setStatus(payload);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { isLoading, status };
}

export function getCodexAccountLabel(status: CodexAuthStatus) {
  if (!status.connected) {
    return "未授权";
  }
  return status.accountId || status.organizationId || status.projectId || "已授权";
}

function getCodexCapabilityLabel(status: CodexAuthStatus) {
  if (!status.connected) return "未连接";
  if (status.hasApiKey) return "Images API 可用";
  return "已保存凭据，图片 API 需代理";
}

export function CodexLoginCard() {
  const { isLoading, status } = useCodexAuthStatus();
  const [authJson, setAuthJson] = useState("");
  const [message, setMessage] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [isImportingJson, setIsImportingJson] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const accountLabel = getCodexAccountLabel(status);
  const startAvailable = Boolean(status.startAvailable);
  const importAvailable = Boolean(status.importSourceAvailable);
  const importCommand = "复制本机 C:\\Users\\<你的用户名>\\.codex\\auth.json 到当前项目 .codex\\codex-auth.json，或在同一台机器上点击导入。";
  const capabilityLabel = getCodexCapabilityLabel(status);

  async function importCliAuth() {
    setIsImporting(true);
    setMessage("");
    try {
      const response = await apiFetch("/api/codex-auth/import-cli", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "导入 Codex CLI 凭据失败");
      setMessage("已导入本机 Codex 凭据");
      window.setTimeout(() => window.location.reload(), 650);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入 Codex CLI 凭据失败");
    } finally {
      setIsImporting(false);
    }
  }

  async function importPastedAuthJson() {
    setIsImportingJson(true);
    setMessage("");
    try {
      const response = await apiFetch("/api/codex-auth/import-json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authJson }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "导入 Codex auth.json 失败");
      setAuthJson("");
      setMessage("已导入 Codex auth.json");
      window.setTimeout(() => window.location.reload(), 650);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入 Codex auth.json 失败");
    } finally {
      setIsImportingJson(false);
    }
  }

  async function importAuthFile(file: File | null) {
    if (!file) return;
    try {
      setAuthJson(await file.text());
      setMessage("已读取 auth.json，点击导入 auth.json 保存到当前项目");
    } catch {
      setMessage("读取 auth.json 文件失败");
    }
  }

  async function copyImportCommand() {
    try {
      await navigator.clipboard.writeText(importCommand);
      setMessage("已复制导入说明");
    } catch {
      setMessage("当前浏览器不允许复制，请手动查看说明");
    }
  }

  return (
    <section aria-label="官方 Codex 凭据" className="codex-login-card">
      <div className="codex-login-card-icon">
        <AppIcon icon={IconBot} size={20} />
      </div>
      <div className="codex-login-card-body">
        <div className="codex-login-title">
          <div>
            <p className="eyebrow">官方 Codex</p>
            <h2>OpenAI Codex</h2>
          </div>
          <div className="provider-title-actions">
            <span className={status.connected ? "provider-badge is-enabled" : "provider-badge"}>
              {isLoading ? "检查中" : capabilityLabel}
            </span>
            <button
              aria-controls="codex-login-body"
              aria-expanded={isExpanded}
              onClick={() => setIsExpanded((current) => !current)}
              type="button"
            >
              {isExpanded ? <AppIcon icon={IconCollapseUp} size="md" /> : <AppIcon icon={IconCollapseDown} size="md" />}
              {isExpanded ? "收起" : "展开"}
            </button>
          </div>
        </div>
        {!isExpanded ? (
          <p className="provider-collapsed-summary">
            {isLoading
              ? "正在检查连接状态"
              : status.connected
                ? `凭据 ${accountLabel}${status.planType ? ` · ${status.planType}` : ""} · ${capabilityLabel}`
                : startAvailable
                  ? "可通过官方 OAuth 保存凭据"
                  : "OAuth 回调不可用，可导入本机 CLI 凭据"}
          </p>
        ) : (
          <div className="codex-login-expanded" id="codex-login-body">
            <p>
              {isLoading
                ? "正在检查连接状态"
                : status.connected
                  ? `已保存凭据${status.planType ? ` · ${status.planType}` : ""}。${status.hasApiKey ? "当前可作为 OpenAI Images API 凭证使用。" : "官方 Codex OAuth 不等同于 OpenAI Images API key；图片模型请配置 Codex 兼容代理或改用其他通道。"}`
                  : startAvailable
                    ? "可通过官方 OAuth 保存本地凭据"
                    : "OAuth 回调不可用，请导入本机 Codex CLI 凭据"}
            </p>
            <span>{accountLabel}</span>
            {!status.connected && status.startDisabledReason ? (
              <small className="codex-login-note">{status.startDisabledReason}</small>
            ) : null}
            {message ? <small className="codex-login-note">{message}</small> : null}
          </div>
        )}
      </div>
      {isExpanded ? (
        <>
          <div className="codex-login-actions">
            <a
              aria-disabled={!startAvailable}
              className={!startAvailable ? "is-disabled" : undefined}
              href={startAvailable ? apiUrl("/api/codex-auth/start") : "#"}
              onClick={(event) => {
                if (!startAvailable) {
                  event.preventDefault();
                  setMessage(status.startDisabledReason ?? "当前环境未配置 OAuth 回调");
                }
              }}
              rel="noreferrer"
              target={startAvailable ? "_blank" : undefined}
            >
              {status.connected ? <AppIcon icon={IconRefresh} size="md" /> : <AppIcon icon={IconExternalLink} size="md" />}
              {status.connected ? "更新授权" : "OAuth 授权"}
            </a>
            <button disabled={isImporting || !importAvailable} onClick={() => void importCliAuth()} type="button">
              <AppIcon icon={IconSave} size="md" />
              {isImporting ? "导入中" : "导入本机 CLI"}
            </button>
            <button className="secondary-action" onClick={() => void copyImportCommand()} type="button">
              <AppIcon icon={IconCopy} size="md" />
              复制说明
            </button>
          </div>
          <div className="codex-auth-import-box">
            <label>
              上传本机 Codex auth.json
              <input accept="application/json,.json" onChange={(event) => void importAuthFile(event.target.files?.[0] ?? null)} type="file" />
            </label>
            <label>
              粘贴 auth.json 内容
              <textarea
                onChange={(event) => setAuthJson(event.target.value)}
                placeholder='{"authMode":"chatgpt","tokens":{...}} 或 {"auth_mode":"apikey","OPENAI_API_KEY":"..."}'
                value={authJson}
              />
            </label>
            <button disabled={isImportingJson || !authJson.trim()} onClick={() => void importPastedAuthJson()} type="button">
              <AppIcon icon={IconSave} size="md" />
              {isImportingJson ? "导入中" : "导入 auth.json"}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
