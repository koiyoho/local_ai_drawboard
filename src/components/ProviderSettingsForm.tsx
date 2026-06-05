"use client";

import { AppIcon } from "@/components/ui/AppIcon";
import {
  IconApiKey,
  IconCollapseDown,
  IconCollapseUp,
  IconCopy,
  IconRefresh,
  IconPlus,
  IconSave,
  IconDelete,
} from "@/components/ui/icons";
import { useEffect, useRef, useState, useTransition } from "react";

import { apiFetch } from "@/lib/api-client";
import {
  defaultProviderModelChannel,
  encodeConfiguredModelValue,
  getProviderModelOptionValue,
  getProviderModelChannelLabel,
  parseConfiguredModelValue,
  providerImageModelCatalog,
  providerReversePromptModelCatalog,
  providerVideoModelCatalog,
  type ConfiguredProviderModel,
  type ProviderModelCatalog,
  type ProviderModelChannel,
  type ProviderVideoModelCatalog,
} from "@/lib/provider-models";

export type ProviderSettingPayload = {
  id: string;
  provider: string;
  displayName: string;
  baseUrl: string | null;
  cliProxyBaseUrl: string | null;
  imageModel: string;
  textModel: string;
  videoModel: string;
  enabledImageModels: ConfiguredProviderModel[];
  enabledReversePromptModels: ConfiguredProviderModel[];
  enabledVideoModels: ConfiguredProviderModel[];
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyPreview: string | null;
  hasCliProxyApiKey: boolean;
  cliProxyApiKeyPreview: string | null;
  hasCliProxyManagementKey: boolean;
  cliProxyManagementKeyPreview: string | null;
  cliProxyEnvironmentBaseUrl: string | null;
  cliProxyEnvironmentHasApiKey: boolean;
  cliProxyEnvironmentHasManagementKey: boolean;
  updatedAt: string;
};

export type ProviderSettingHistoryPayload = Omit<ProviderSettingPayload, "enabled" | "hasApiKey"> & {
  apiKeyPreview: string | null;
};

type CliProxyDiagnosticCheck = {
  label: string;
  message: string;
  status: "ok" | "error" | "not_configured";
  target: string;
};

type CliProxyDiagnosticPayload = {
  checkedAt: string;
  checks: CliProxyDiagnosticCheck[];
  overall: "ok" | "error" | "not_configured";
  summary: string;
};

type CliProxyInitializationPayload = {
  apiKeyPreview: string | null;
  apiKeySyncMessage: string;
  apiKeySyncStatus: "ok" | "skipped" | "warning";
  baseUrl: string;
  generatedApiKey: boolean;
  generatedBaseUrl: boolean;
  hasApiKey: boolean;
};

type CliProxyOAuthProvider = "gemini-cli" | "codex" | "anthropic" | "antigravity";
type CliProxyOAuthStatus = "idle" | "opening" | "wait" | "ok" | "error";
type CliProxyOAuthState = {
  errorMessage?: string;
  state?: string;
  status: CliProxyOAuthStatus;
};

const cliProxyOAuthProviders: Array<{
  description: string;
  provider: CliProxyOAuthProvider;
  title: string;
}> = [
  { provider: "gemini-cli", title: "Gemini CLI", description: "通过 CLIProxyAPI 管理端启动 Gemini CLI OAuth。" },
  { provider: "codex", title: "OpenAI Codex", description: "通过 CLIProxyAPI 管理端启动 Codex OAuth。" },
  { provider: "anthropic", title: "Claude Code", description: "通过 CLIProxyAPI 管理端启动 Anthropic / Claude Code OAuth。" },
  { provider: "antigravity", title: "Antigravity", description: "通过 CLIProxyAPI 管理端启动 Antigravity OAuth。" },
];

export function ProviderSettingsForm({
  initialHistories,
  initialSetting,
  isExpanded,
  onSettingChange,
  onExpandedChange,
}: {
  initialHistories?: ProviderSettingHistoryPayload[];
  initialSetting: ProviderSettingPayload | null;
  isExpanded: boolean;
  onSettingChange?: (setting: ProviderSettingPayload | null) => void;
  onExpandedChange: (isExpanded: boolean) => void;
}) {
  const [displayName, setDisplayName] = useState(initialSetting?.displayName ?? "OpenAI 兼容接口");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(initialSetting?.baseUrl ?? "");
  const [cliProxyApiKey, setCliProxyApiKey] = useState("");
  const [cliProxyBaseUrl, setCliProxyBaseUrl] = useState(initialSetting?.cliProxyBaseUrl ?? "");
  const [imageModel, setImageModel] = useState(initialSetting?.imageModel ?? "gpt-image-2");
  const [textModel, setTextModel] = useState(initialSetting?.textModel ?? "gpt-5.5");
  const [setting, setSetting] = useState(initialSetting);
  const [histories, setHistories] = useState<ProviderSettingHistoryPayload[]>(initialHistories ?? []);
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();

  async function refreshProviderSettings() {
    const response = await apiFetch("/api/provider-settings");
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      histories?: ProviderSettingHistoryPayload[];
      providerSetting?: ProviderSettingPayload | null;
    };
    if (!response.ok) throw new Error(payload.error ?? "无法刷新 API 设置");
    applySettingToForm(payload.providerSetting ?? null);
    setHistories(payload.histories ?? []);
  }

  function saveProviderSetting() {
    startTransition(async () => {
      setStatus("");
      const response = await apiFetch("/api/provider-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          baseUrl,
          cliProxyApiKey,
          cliProxyBaseUrl,
          displayName,
          imageModel,
          textModel,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setStatus(payload.error ?? "无法保存 API 设置");
        return;
      }
      applySettingToForm(payload.providerSetting);
      setHistories(payload.histories ?? []);
      setApiKey("");
      setCliProxyApiKey("");
      setStatus("API 设置已保存");
    });
  }

  function applyHistory(historyId: string) {
    startTransition(async () => {
      setStatus("");
      const response = await apiFetch("/api/provider-settings/history/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ historyId }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setStatus(payload.error ?? "无法复用历史 API 设置");
        return;
      }
      applySettingToForm(payload.providerSetting);
      setHistories(payload.histories ?? []);
      setApiKey("");
      setCliProxyApiKey("");
      setStatus("已复用历史 API 设置");
    });
  }

  function disableProviderSetting() {
    startTransition(async () => {
      const response = await apiFetch("/api/provider-settings", { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) {
        setStatus(payload.error ?? "无法停用 API 设置");
        return;
      }
      applySettingToForm(payload.providerSetting);
      setStatus("API 设置已停用");
    });
  }

  function applySettingToForm(nextSetting: ProviderSettingPayload | null) {
    setSetting(nextSetting);
    onSettingChange?.(nextSetting);
    if (!nextSetting) {
      return;
    }
    setDisplayName(nextSetting.displayName);
    setBaseUrl(nextSetting.baseUrl ?? "");
    setCliProxyBaseUrl(nextSetting.cliProxyBaseUrl ?? "");
    setImageModel(nextSetting.imageModel);
    setTextModel(nextSetting.textModel);
  }

  return (
    <section className="provider-settings" id="provider-settings">
      <div className="section-title">
        <div>
          <p className="eyebrow">第三方 API</p>
          <h2>OpenAI 兼容接口</h2>
        </div>
        <div className="provider-title-actions">
          <span className={setting?.enabled ? "provider-badge is-enabled" : "provider-badge"}>
            {setting?.enabled ? "已启用" : "未配置"}
          </span>
          <button
            aria-controls="provider-settings-body"
            aria-expanded={isExpanded}
            onClick={() => onExpandedChange(!isExpanded)}
            type="button"
          >
            {isExpanded ? <AppIcon icon={IconCollapseUp} size="md" /> : <AppIcon icon={IconCollapseDown} size="md" />}
            {isExpanded ? "收起 API 设置" : "展开 API 设置"}
          </button>
        </div>
      </div>
      {isExpanded ? (
        <div className="provider-settings-main" id="provider-settings-body">
          <div className="provider-actions provider-refresh-row">
            <button disabled={isPending} onClick={() => void refreshProviderSettings().catch((error) => setStatus(error instanceof Error ? error.message : "刷新失败"))} type="button">
              <AppIcon icon={IconCopy} size="md" />
              刷新历史
            </button>
            <span className="provider-field-hint">历史记录只显示密钥预览，点击复用时由服务端恢复完整密钥。</span>
          </div>
          <div className="provider-grid">
            <label>
              显示名称
              <input
                maxLength={80}
                onChange={(event) => setDisplayName(event.target.value)}
                value={displayName}
              />
            </label>
            <label>
              API Key
              <input
                autoComplete="off"
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={setting?.apiKeyPreview ? `当前 ${setting.apiKeyPreview}` : "sk-..."}
                type="password"
                value={apiKey}
              />
            </label>
            <label>
              Base URL
              <input
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://api.example.com/v1"
                value={baseUrl}
              />
              <span className="provider-field-hint">
                第三方生图接口必须支持 OpenAI Images API，通常需要填写到 /v1。
              </span>
            </label>
          </div>
          <div className="provider-cliproxy-panel">
            <div className="provider-subsection-title">
              <h3>CLIProxyAPI</h3>
              <span>{setting?.cliProxyBaseUrl ? "已配置独立通道" : "未配置"}</span>
            </div>
            <p className="provider-field-hint">
              Grok 生图和视频模型使用这里的 Base URL 与 API Key，不复用上方第三方 API 地址。
            </p>
            <div className="provider-grid">
              <label>
                CLIProxyAPI Base URL
                <input
                  onChange={(event) => setCliProxyBaseUrl(event.target.value)}
                  placeholder="https://cliproxy.example.com/v1"
                  value={cliProxyBaseUrl}
                />
              </label>
              <label>
                CLIProxyAPI Key
                <input
                  autoComplete="off"
                  onChange={(event) => setCliProxyApiKey(event.target.value)}
                  placeholder={setting?.cliProxyApiKeyPreview ? `当前 ${setting.cliProxyApiKeyPreview}` : "可留空使用服务端环境变量"}
                  type="password"
                  value={cliProxyApiKey}
                />
              </label>
            </div>
          </div>
          <div className="provider-actions">
            <button
              disabled={isPending || (!setting?.hasApiKey && !apiKey.trim())}
              onClick={saveProviderSetting}
              type="button"
            >
              <AppIcon icon={IconSave} size="md" />
              保存 API 设置
            </button>
            <button
              className="secondary-action"
              disabled={isPending || !setting?.enabled}
              onClick={disableProviderSetting}
              type="button"
            >
              <AppIcon icon={IconApiKey} size="md" />
              停用
            </button>
            {status ? <span className="muted">{status}</span> : null}
          </div>
          <ProviderHistoryList
            histories={histories}
            isPending={isPending}
            onApply={applyHistory}
          />
        </div>
      ) : (
        <p className="provider-collapsed-summary">
          {setting?.enabled
            ? `${setting.displayName} · ${setting.baseUrl || "默认 OpenAI Base URL"} · ${setting.apiKeyPreview ?? "已保存密钥"}`
            : "API 尚未配置，展开后填写接口信息。"}
        </p>
      )}
    </section>
  );
}

export function CliProxySettingsCard({
  initialSetting,
  onSettingChange,
}: {
  initialSetting: ProviderSettingPayload | null;
  onSettingChange?: (setting: ProviderSettingPayload | null) => void;
}) {
  const [setting, setSetting] = useState(initialSetting);
  const [cliProxyApiKey, setCliProxyApiKey] = useState("");
  const [cliProxyManagementKey, setCliProxyManagementKey] = useState("");
  const [cliProxyBaseUrl, setCliProxyBaseUrl] = useState(initialSetting?.cliProxyBaseUrl ?? "");
  const [diagnostics, setDiagnostics] = useState<CliProxyDiagnosticPayload | null>(null);
  const [initializationStatus, setInitializationStatus] = useState<CliProxyInitializationPayload | null>(null);
  const [oauthStates, setOauthStates] = useState<Record<CliProxyOAuthProvider, CliProxyOAuthState>>(() => createInitialCliProxyOAuthStates());
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();
  const oauthPollersRef = useRef<Record<string, number>>({});

  useEffect(() => {
    setSetting(initialSetting);
    setCliProxyBaseUrl(initialSetting?.cliProxyBaseUrl ?? "");
  }, [initialSetting]);

  useEffect(() => () => {
    Object.values(oauthPollersRef.current).forEach((poller) => window.clearInterval(poller));
    oauthPollersRef.current = {};
  }, []);

  const hasSavedBaseUrl = Boolean(setting?.cliProxyBaseUrl);
  const hasEnvBaseUrl = Boolean(setting?.cliProxyEnvironmentBaseUrl);
  const hasSavedKey = Boolean(setting?.hasCliProxyApiKey);
  const hasEnvKey = Boolean(setting?.cliProxyEnvironmentHasApiKey);
  const hasSavedManagementKey = Boolean(setting?.hasCliProxyManagementKey);
  const hasEnvManagementKey = Boolean(setting?.cliProxyEnvironmentHasManagementKey);
  const hasCliProxyConfig = hasSavedBaseUrl || hasEnvBaseUrl;
  const hasCliProxyOAuthConfig = hasCliProxyConfig && (hasSavedManagementKey || hasEnvManagementKey);
  const baseUrlStatus = hasSavedBaseUrl
    ? `用户已保存：${setting?.cliProxyBaseUrl}`
    : hasEnvBaseUrl
      ? `服务端已配置：${setting?.cliProxyEnvironmentBaseUrl}`
      : "未配置";
  const keyStatus = hasSavedKey
    ? `用户已保存：${setting?.cliProxyApiKeyPreview ?? "已保存"}`
    : hasEnvKey
      ? "服务端已配置环境变量"
      : "未配置";
  const managementKeyStatus = hasSavedManagementKey
    ? `用户已保存：${setting?.cliProxyManagementKeyPreview ?? "已保存"}`
    : hasEnvManagementKey
      ? "服务端已配置环境变量"
      : "未配置";

  function saveCliProxySetting() {
    startTransition(async () => {
      setStatus("");
      const response = await apiFetch("/api/provider-settings/cliproxy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliProxyApiKey, cliProxyBaseUrl, cliProxyManagementKey }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; providerSetting?: ProviderSettingPayload };
      if (!response.ok || !payload.providerSetting) {
        setStatus(payload.error ?? "无法保存 CLIProxyAPI 设置");
        return;
      }
      setSetting(payload.providerSetting);
      onSettingChange?.(payload.providerSetting);
      setCliProxyApiKey("");
      setCliProxyManagementKey("");
      setCliProxyBaseUrl(payload.providerSetting.cliProxyBaseUrl ?? "");
      setStatus("CLIProxyAPI 设置已保存");
    });
  }

  function initializeCliProxy(rotateApiKey = false) {
    startTransition(async () => {
      setStatus("");
      const response = await apiFetch("/api/provider-settings/cliproxy/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rotateApiKey }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        initialization?: CliProxyInitializationPayload;
        providerSetting?: ProviderSettingPayload;
      };
      if (!response.ok || !payload.providerSetting || !payload.initialization) {
        setStatus(payload.error ?? "无法初始化 CLIProxyAPI");
        return;
      }
      setSetting(payload.providerSetting);
      onSettingChange?.(payload.providerSetting);
      setCliProxyApiKey("");
      setCliProxyManagementKey("");
      setCliProxyBaseUrl(payload.providerSetting.cliProxyBaseUrl ?? payload.initialization.baseUrl);
      setInitializationStatus(payload.initialization);
      setStatus(`${rotateApiKey ? "CLIProxyAPI API Key 已轮换" : "CLIProxyAPI 已初始化"}；${payload.initialization.apiKeySyncMessage}`);
    });
  }

  function checkCliProxyDiagnostics() {
    startTransition(async () => {
      setStatus("");
      const response = await apiFetch("/api/provider-settings/cliproxy/diagnostics", { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as Partial<CliProxyDiagnosticPayload> & { error?: string };
      if (!response.ok || !payload.overall || !payload.checks) {
        setStatus(payload.error ?? "无法验证 CLIProxyAPI");
        return;
      }
      setDiagnostics(payload as CliProxyDiagnosticPayload);
      setStatus(payload.summary ?? "CLIProxyAPI 自检完成");
    });
  }

  function startCliProxyOAuth(providerName: CliProxyOAuthProvider) {
    if (!hasCliProxyOAuthConfig) {
      setStatus("请先保存 CLIProxyAPI Base URL 和管理密钥。管理密钥是 MANAGEMENT_PASSWORD，不是 /v1 调用 API Key。");
      return;
    }
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      const errorMessage = "浏览器阻止了授权窗口，请允许弹窗后重试";
      setOauthStates((current) => ({ ...current, [providerName]: { errorMessage, status: "error" } }));
      setStatus(errorMessage);
      return;
    }
    popup.opener = null;
    startTransition(async () => {
      setStatus("");
      setOauthStates((current) => ({ ...current, [providerName]: { status: "opening" } }));
      const response = await apiFetch(`/api/provider-settings/cliproxy/oauth/${providerName}/start`, {
        body: "{}",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; state?: string; url?: string };
      if (!response.ok || !payload.url || !payload.state) {
        const errorMessage = payload.error ?? "无法启动 CLIProxyAPI OAuth 登录";
        popup.close();
        setOauthStates((current) => ({ ...current, [providerName]: { errorMessage, status: "error" } }));
        setStatus(errorMessage);
        return;
      }
      popup.location.href = payload.url;
      setOauthStates((current) => ({ ...current, [providerName]: { state: payload.state, status: "wait" } }));
      setStatus(`${getCliProxyOAuthProviderTitle(providerName)} 授权窗口已打开，等待 CLIProxyAPI 返回登录状态`);
      beginCliProxyOAuthPolling(providerName, payload.state);
    });
  }

  function beginCliProxyOAuthPolling(providerName: CliProxyOAuthProvider, state: string) {
    const pollerKey = `${providerName}:${state}`;
    if (oauthPollersRef.current[pollerKey]) window.clearInterval(oauthPollersRef.current[pollerKey]);
    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      const response = await apiFetch(`/api/provider-settings/cliproxy/oauth/${providerName}/status?state=${encodeURIComponent(state)}`);
      const payload = (await response.json().catch(() => ({}))) as { error?: string; errorMessage?: string; status?: "ok" | "wait" | "error" };
      if (!response.ok || payload.status === "error") {
        window.clearInterval(oauthPollersRef.current[pollerKey]);
        delete oauthPollersRef.current[pollerKey];
        const errorMessage = payload.errorMessage ?? payload.error ?? "CLIProxyAPI OAuth 登录失败";
        setOauthStates((current) => ({ ...current, [providerName]: { errorMessage, state, status: "error" } }));
        setStatus(errorMessage);
        return;
      }
      if (payload.status === "ok") {
        window.clearInterval(oauthPollersRef.current[pollerKey]);
        delete oauthPollersRef.current[pollerKey];
        setOauthStates((current) => ({ ...current, [providerName]: { state, status: "ok" } }));
        setStatus(`${getCliProxyOAuthProviderTitle(providerName)} 已完成登录`);
        return;
      }
      if (attempts >= 60) {
        window.clearInterval(oauthPollersRef.current[pollerKey]);
        delete oauthPollersRef.current[pollerKey];
        setOauthStates((current) => ({ ...current, [providerName]: { errorMessage: "等待授权超时，请重新发起登录", state, status: "error" } }));
        setStatus("等待授权超时，请重新发起登录");
      }
    };
    oauthPollersRef.current[pollerKey] = window.setInterval(() => void poll(), 2000);
    void poll();
  }

  return (
    <section className="provider-settings cliproxy-settings-card" id="cliproxy-settings">
      <div className="section-title">
        <div>
          <p className="eyebrow">CLIProxyAPI</p>
          <h2>模型路由与 CLI 登录</h2>
        </div>
        <div className="provider-title-actions">
          <span className={hasCliProxyConfig ? "provider-badge is-enabled" : "provider-badge"}>
            {hasSavedBaseUrl ? "用户已保存" : hasEnvBaseUrl ? "服务端已配置" : "未配置"}
          </span>
        </div>
      </div>
      <p className="provider-field-hint">
        CLIProxyAPI 负责 Grok、Claude、Codex、Gemini CLI、Antigravity 等本机代理通道；本地启动会自动安装并拉起内置 CLIProxyAPI。
      </p>
      <div className="settings-summary cliproxy-source-summary">
        <span>Base URL 来源</span>
        <strong>{baseUrlStatus}</strong>
        <small>API Key 来源</small>
        <em>{keyStatus}</em>
        <small>管理密钥来源</small>
        <em>{managementKeyStatus}</em>
      </div>
      {initializationStatus ? (
        <div className={`cliproxy-init-status is-${initializationStatus.apiKeySyncStatus}`} aria-label="CLIProxyAPI 初始化状态">
          <div>
            <span>api-keys 同步</span>
            <strong>{getCliProxySyncStatusLabel(initializationStatus.apiKeySyncStatus)}</strong>
          </div>
          <p>{initializationStatus.apiKeySyncMessage}</p>
          <small>
            Base URL：{initializationStatus.baseUrl}
            {initializationStatus.apiKeyPreview ? ` · API Key：${initializationStatus.apiKeyPreview}` : ""}
          </small>
        </div>
      ) : null}
      <div className="provider-grid">
        <label>
          CLIProxyAPI Base URL
          <input
            onChange={(event) => setCliProxyBaseUrl(event.target.value)}
            placeholder={setting?.cliProxyEnvironmentBaseUrl ? `服务端 ${setting.cliProxyEnvironmentBaseUrl}` : "http://127.0.0.1:8327/v1"}
            value={cliProxyBaseUrl}
          />
          <span className="provider-field-hint">内置 CLIProxyAPI 默认使用 8327 端口，模型调用地址会自动写入到 /v1。</span>
        </label>
        <label>
          CLIProxyAPI /v1 调用 API Key
          <input
            autoComplete="off"
            onChange={(event) => setCliProxyApiKey(event.target.value)}
            placeholder={hasSavedKey ? `当前 ${setting?.cliProxyApiKeyPreview}` : hasEnvKey ? "服务端已配置，可留空" : "可留空使用服务端环境变量"}
            type="password"
            value={cliProxyApiKey}
          />
          <span className="provider-field-hint">用于 OpenAI-compatible /v1 模型调用和模型列表鉴权。</span>
        </label>
        <label>
          CLIProxyAPI 管理密钥
          <input
            autoComplete="off"
            onChange={(event) => setCliProxyManagementKey(event.target.value)}
            placeholder={hasSavedManagementKey ? `当前 ${setting?.cliProxyManagementKeyPreview}` : hasEnvManagementKey ? "服务端已配置，可留空" : "填写 MANAGEMENT_PASSWORD"}
            type="password"
            value={cliProxyManagementKey}
          />
          <span className="provider-field-hint">启动脚本会自动生成；用于 /v0/management 管理路由、api-keys 同步和官方 OAuth 登录。</span>
        </label>
      </div>
      <div className="provider-actions">
        <button disabled={isPending || (!cliProxyBaseUrl.trim() && !hasEnvBaseUrl)} onClick={saveCliProxySetting} type="button">
          <AppIcon icon={IconSave} size="md" />
          保存 CLIProxyAPI
        </button>
        <button disabled={isPending} onClick={() => initializeCliProxy(false)} type="button">
          <AppIcon icon={IconApiKey} size="md" />
          初始化本地配置
        </button>
        <button className="secondary-action" disabled={isPending} onClick={() => initializeCliProxy(true)} type="button">
          <AppIcon icon={IconRefresh} size="md" />
          轮换 API Key
        </button>
        <button className="secondary-action" disabled={isPending || !hasCliProxyConfig} onClick={checkCliProxyDiagnostics} type="button">
          <AppIcon icon={IconRefresh} size="md" />
          自检
        </button>
      </div>
      <div className="cliproxy-auth-panel">
        <div className="provider-subsection-title">
          <h3>官方管理 OAuth</h3>
          <span>{hasCliProxyOAuthConfig ? "可发起" : "需要管理密钥"}</span>
        </div>
        <div className="cliproxy-auth-grid is-compact">
          {cliProxyOAuthProviders.map(({ description, provider: providerName, title }) => (
            <article key={providerName}>
              <strong>{title}</strong>
              <span>{description}</span>
              <small>{getCliProxyOAuthStatusText(oauthStates[providerName])}</small>
              <button disabled={isPending || !hasCliProxyOAuthConfig || oauthStates[providerName]?.status === "wait" || oauthStates[providerName]?.status === "opening"} onClick={() => startCliProxyOAuth(providerName)} type="button">
                {oauthStates[providerName]?.status === "wait" ? "等待授权" : oauthStates[providerName]?.status === "opening" ? "打开中" : "开始登录"}
              </button>
            </article>
          ))}
        </div>
        <div className="cliproxy-auth-command">
          <span>Grok / xAI</span>
          <code>./cli-proxy-api --xai-login</code>
          <em>当前 CLIProxyAPI 文档未提供 xAI 的管理 OAuth auth-url；请在 CLIProxyAPI 本机进程执行登录命令，登录完成后仍通过本页的 /v1 Base URL 和模型池路由调用 Grok 图像、视频模型。</em>
        </div>
      </div>
      {diagnostics ? (
        <div className="cliproxy-diagnostics" aria-label="CLIProxyAPI 自检结果">
          <div className="provider-subsection-title">
            <h3>自检结果</h3>
            <span>{diagnostics.summary}</span>
          </div>
          {diagnostics.checks.map((check) => (
            <div className={`cliproxy-diagnostic-row is-${check.status}`} key={`${check.label}-${check.target}`}>
              <strong>{check.label}</strong>
              <span>{check.message}</span>
              <em>{check.target}</em>
            </div>
          ))}
        </div>
      ) : null}
      {status ? <span className="muted">{status}</span> : null}
    </section>
  );
}

export function ProviderModelPoolSettings({
  initialSetting,
  isExpanded,
  onExpandedChange,
  onSettingChange,
}: {
  initialSetting: ProviderSettingPayload | null;
  isExpanded: boolean;
  onExpandedChange: (isExpanded: boolean) => void;
  onSettingChange?: (setting: ProviderSettingPayload | null) => void;
}) {
  const [setting, setSetting] = useState(initialSetting);
  const [imageModel, setImageModel] = useState(initialSetting?.imageModel ?? "gpt-image-2");
  const [textModel, setTextModel] = useState(initialSetting?.textModel ?? "gpt-5.5");
  const [videoModel, setVideoModel] = useState(initialSetting?.videoModel ?? "cliproxy:grok-imagine-video");
  const [imageModels, setImageModels] = useState<ConfiguredProviderModel[]>(getInitialImageModels(initialSetting));
  const [reversePromptModels, setReversePromptModels] = useState<ConfiguredProviderModel[]>(getInitialReversePromptModels(initialSetting));
  const [videoModels, setVideoModels] = useState<ConfiguredProviderModel[]>(getInitialVideoModels(initialSetting));
  const [modelCatalog, setModelCatalog] = useState<{
    imageModels: ProviderModelCatalog;
    reversePromptModels: ProviderModelCatalog;
    videoModels: ProviderVideoModelCatalog;
  }>({ imageModels: providerImageModelCatalog, reversePromptModels: providerReversePromptModelCatalog, videoModels: providerVideoModelCatalog });
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();
  const imageEnabledCount = imageModels.filter((model) => model.enabled).length;
  const textEnabledCount = reversePromptModels.filter((model) => model.enabled).length;
  const videoEnabledCount = videoModels.filter((model) => model.enabled).length;

  useEffect(() => {
    setSetting(initialSetting);
    setImageModel(initialSetting?.imageModel ?? "gpt-image-2");
    setTextModel(initialSetting?.textModel ?? "gpt-5.5");
    setVideoModel(initialSetting?.videoModel ?? "cliproxy:grok-imagine-video");
    setImageModels(getInitialImageModels(initialSetting));
    setReversePromptModels(getInitialReversePromptModels(initialSetting));
    setVideoModels(getInitialVideoModels(initialSetting));
  }, [initialSetting?.id, initialSetting?.updatedAt]);

  useEffect(() => {
    let isMounted = true;
    apiFetch("/api/admin/provider-models/catalog")
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as Partial<typeof modelCatalog>;
        if (!response.ok) return;
        if (isMounted && payload.imageModels && payload.reversePromptModels) {
          setModelCatalog({
            imageModels: payload.imageModels,
            reversePromptModels: payload.reversePromptModels,
            videoModels: payload.videoModels ?? providerVideoModelCatalog,
          });
        }
      })
      .catch(() => undefined);
    return () => {
      isMounted = false;
    };
  }, []);

  function saveModelSettings() {
    startTransition(async () => {
      setStatus("");
      const response = await apiFetch("/api/admin/provider-models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabledImageModels: imageModels,
          enabledReversePromptModels: reversePromptModels,
          enabledVideoModels: videoModels,
          imageModel,
          textModel,
          videoModel,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setStatus(payload.error ?? "无法保存模型设置");
        return;
      }
      setSetting(payload.providerSetting);
      onSettingChange?.(payload.providerSetting);
      setImageModel(payload.providerSetting.imageModel);
      setTextModel(payload.providerSetting.textModel);
      setVideoModel(payload.providerSetting.videoModel);
      setImageModels(getInitialImageModels(payload.providerSetting));
      setReversePromptModels(getInitialReversePromptModels(payload.providerSetting));
      setVideoModels(getInitialVideoModels(payload.providerSetting));
      setStatus("模型池和调用通道已保存");
    });
  }

  return (
    <section className="provider-settings provider-model-pool-card" id="provider-model-pool">
      <div className="section-title">
        <div>
          <p className="eyebrow">模型与通道</p>
          <h2>前台模型池</h2>
        </div>
        <div className="provider-title-actions">
          <span className={setting?.enabled ? "provider-badge is-enabled" : "provider-badge"}>
            {setting?.enabled ? `${imageEnabledCount + textEnabledCount + videoEnabledCount} 个已启用` : "需先保存 API"}
          </span>
          <button
            aria-controls="provider-model-pool-body"
            aria-expanded={isExpanded}
            onClick={() => onExpandedChange(!isExpanded)}
            type="button"
          >
            {isExpanded ? <AppIcon icon={IconCollapseUp} size="md" /> : <AppIcon icon={IconCollapseDown} size="md" />}
            {isExpanded ? "收起模型池" : "展开模型池"}
          </button>
        </div>
      </div>
      {!isExpanded ? (
        <p className="provider-collapsed-summary">
          {setting?.enabled
            ? `生图/改图 ${imageEnabledCount} 个 · 视频 ${videoEnabledCount} 个 · 反推/提示词 ${textEnabledCount} 个 · 本地调用通道已配置`
            : "先保存第三方 API 设置后，再配置前台可见模型和后台调用通道。"}
        </p>
      ) : (
        <div className="provider-model-pool-body" id="provider-model-pool-body">
          <p className="provider-field-hint">
            前台只展示模型名称；每个模型实际走第三方 API、Codex 兼容代理还是 Gemini Bridge，由这里统一配置。官方 Codex OAuth 本身不是图片 API key，Codex 图片通道需要本机环境配置 CODEX_IMAGE_PROXY_BASE_URL。
          </p>
          <ModelListEditor
            catalog={modelCatalog.imageModels}
            fallbackModel={imageModel}
            label="生图 / 改图模型"
            models={imageModels}
            onFallbackModelChange={setImageModel}
            onModelsChange={setImageModels}
          />
          <ModelListEditor
            catalog={modelCatalog.videoModels as ProviderModelCatalog}
            fallbackModel={videoModel}
            label="视频生成模型"
            models={videoModels}
            onFallbackModelChange={setVideoModel}
            onModelsChange={setVideoModels}
          />
          <ModelListEditor
            catalog={modelCatalog.reversePromptModels}
            fallbackModel={textModel}
            label="反推 / 提示词模型"
            models={reversePromptModels}
            onFallbackModelChange={setTextModel}
            onModelsChange={setReversePromptModels}
          />
          <div className="provider-actions provider-model-save-row">
            <button disabled={isPending || !setting} onClick={saveModelSettings} type="button">
              <AppIcon icon={IconSave} size="md" />
              保存模型池
            </button>
            {status ? <span className="muted">{status}</span> : null}
          </div>
        </div>
      )}
    </section>
  );
}

function ProviderHistoryList({
  histories,
  isPending,
  onApply,
}: {
  histories: ProviderSettingHistoryPayload[];
  isPending: boolean;
  onApply: (historyId: string) => void;
}) {
  if (histories.length === 0) {
    return (
      <div className="provider-history-list">
        <div className="provider-history-empty">暂无历史记录。保存 API 设置后会自动保留最近使用过的配置。</div>
      </div>
    );
  }
  return (
    <div className="provider-history-list" aria-label="API 设置历史">
      <div className="provider-subsection-title">
        <h3>历史配置</h3>
        <span>最近 {histories.length} 条</span>
      </div>
      {histories.map((history) => (
        <button
          className="provider-history-item"
          disabled={isPending}
          key={history.id}
          onClick={() => onApply(history.id)}
          type="button"
        >
          <span>
            <strong>{history.displayName}</strong>
            <em>{history.baseUrl || "默认 OpenAI Base URL"}</em>
          </span>
          <span>
            <strong>{history.imageModel}</strong>
            <em>{history.apiKeyPreview ?? history.cliProxyApiKeyPreview ?? "已保存"}</em>
          </span>
        </button>
      ))}
    </div>
  );
}

function ModelListEditor({
  catalog,
  fallbackModel,
  label,
  models,
  onFallbackModelChange,
  onModelsChange,
}: {
  catalog: ProviderModelCatalog;
  fallbackModel: string;
  label: string;
  models: ConfiguredProviderModel[];
  onFallbackModelChange: (value: string) => void;
  onModelsChange: (models: ConfiguredProviderModel[]) => void;
}) {
  function updateModel(index: number, patch: Partial<ConfiguredProviderModel>) {
    onModelsChange(models.map((model, modelIndex) => modelIndex === index ? normalizeEditedModel({ ...model, ...patch }, catalog) : model));
  }

  function addModel() {
    onModelsChange([...models, { channel: defaultProviderModelChannel, enabled: true, id: "", label: "" }]);
  }

  function removeModel(index: number) {
    onModelsChange(models.filter((_, modelIndex) => modelIndex !== index));
  }

  function selectFallbackModel(value: string) {
    onFallbackModelChange(getStoredFallbackModelValue(value));
  }

  function addPreset(preset: ConfiguredProviderModel) {
    if (models.some((model) => model.id === preset.id && (model.channel ?? defaultProviderModelChannel) === (preset.channel ?? defaultProviderModelChannel))) {
      onModelsChange(models.map((model) => model.id === preset.id && (model.channel ?? defaultProviderModelChannel) === (preset.channel ?? defaultProviderModelChannel) ? {
        ...model,
        channel: preset.channel ?? defaultProviderModelChannel,
        enabled: true,
        label: model.label || preset.label,
      } : model));
      return;
    }
    onModelsChange([...models, preset]);
  }

  return (
    <div className="provider-model-editor">
      <div className="provider-model-editor-heading">
        <div>
          <strong>{label}</strong>
          <span>{models.filter((model) => model.enabled).length} 个已启用</span>
        </div>
        <div className="provider-model-editor-actions">
          <button onClick={addModel} type="button">
            <AppIcon icon={IconPlus} size="sm" />
            添加自定义
          </button>
        </div>
      </div>
      <div className="provider-model-presets" aria-label={`${label}常用模型`}>
        {getCatalogPresets(catalog).map((preset) => {
          const exists = models.some((model) => model.id === preset.id && (model.channel ?? defaultProviderModelChannel) === (preset.channel ?? defaultProviderModelChannel));
          return (
            <button disabled={exists} key={`${preset.channel ?? defaultProviderModelChannel}-${preset.id}`} onClick={() => addPreset(preset)} type="button">
              <AppIcon icon={IconPlus} size="sm" />
              {getProviderModelChannelLabel(preset.channel)} · {preset.label}
            </button>
          );
        })}
      </div>
      <label className="provider-default-model">
        默认模型
        <select onChange={(event) => selectFallbackModel(event.target.value)} value={getFallbackModelValue(fallbackModel, models)}>
          {getFallbackModelOptions(catalog, models).map((model) => (
            <option key={`fallback-${model.channel}-${model.id}`} value={encodeConfiguredModelValue(model)}>
              {getProviderModelChannelLabel(model.channel)} · {model.label}
            </option>
          ))}
          {!getFallbackModelOptions(catalog, models).some((model) => encodeConfiguredModelValue(model) === fallbackModel) ? <option value={fallbackModel}>{fallbackModel}</option> : null}
        </select>
      </label>
      <div className="provider-model-list">
        {models.map((model, index) => (
          <div className="provider-model-row" key={`${label}-${index}`}>
            <label className="provider-model-toggle">
              <input
                checked={model.enabled}
                onChange={(event) => updateModel(index, { enabled: event.target.checked })}
                type="checkbox"
              />
              启用
            </label>
            <label>
              调用通道
              <select
                onChange={(event) => {
                  const channel = event.target.value as ProviderModelChannel;
                  const option = catalog[channel][0];
                  updateModel(index, {
                    channel,
                    id: option?.id ?? "",
                    label: option?.label ?? "",
                  });
                }}
                value={model.channel ?? defaultProviderModelChannel}
              >
                <option value="provider">第三方 API</option>
                <option value="codex">Codex 代理</option>
                <option value="gemini-bridge">Gemini Bridge</option>
                <option value="cliproxy">CLIProxyAPI</option>
              </select>
            </label>
            <label>
              可选模型
              <select
                onChange={(event) => {
                  const option = getCatalogOption(catalog, model.channel, event.target.value);
                  updateModel(index, { id: event.target.value, label: option?.label ?? event.target.value });
                }}
                value={model.id}
              >
                {(catalog[model.channel ?? defaultProviderModelChannel] ?? []).map((option) => (
                  <option key={`${model.channel ?? defaultProviderModelChannel}-${option.id}`} value={option.id}>
                    {option.label}
                  </option>
                ))}
                {model.id && !getCatalogOption(catalog, model.channel, model.id) ? <option value={model.id}>{model.id}</option> : null}
              </select>
            </label>
            <label>
              模型 ID
              <input
                onChange={(event) => updateModel(index, { id: event.target.value, label: model.label || event.target.value })}
                placeholder="输入自定义模型 ID"
                value={model.id}
              />
            </label>
            <label>
              显示名
              <input
                onChange={(event) => updateModel(index, { label: event.target.value })}
                placeholder="前台显示名，可留空"
                value={model.label}
              />
            </label>
            <button aria-label={`删除${label}模型`} onClick={() => removeModel(index)} type="button">
              <AppIcon icon={IconDelete} size="sm" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function getCatalogPresets(catalog: ProviderModelCatalog): ConfiguredProviderModel[] {
  return (["provider", "codex", "gemini-bridge", "cliproxy"] as ProviderModelChannel[]).flatMap((channel) =>
    (catalog[channel] ?? []).map((model) => ({ ...model, channel, enabled: true })),
  );
}

function getCatalogOption(catalog: ProviderModelCatalog, channel: ProviderModelChannel | undefined, id: string) {
  return (catalog[channel ?? defaultProviderModelChannel] ?? []).find((model) => model.id === id);
}

function getFallbackModelOptions(catalog: ProviderModelCatalog, models: ConfiguredProviderModel[]) {
  const options = [
    ...models.filter((model) => model.enabled && model.id.trim()),
    ...getCatalogPresets(catalog),
  ];
  return options.filter((model, index, all) =>
    all.findIndex((candidate) => encodeConfiguredModelValue(candidate) === encodeConfiguredModelValue(model)) === index,
  );
}

function getFallbackModelValue(fallbackModel: string, models: ConfiguredProviderModel[]) {
  const parsedFallback = parseConfiguredModelValue(fallbackModel);
  const configuredModel = parsedFallback.channel
    ? models.find((model) =>
        model.enabled &&
        model.id === parsedFallback.id &&
        (model.channel ?? defaultProviderModelChannel) === parsedFallback.channel)
    : models.find((model) =>
        model.enabled &&
        model.id === parsedFallback.id &&
        (model.channel ?? defaultProviderModelChannel) === defaultProviderModelChannel) ??
      models.find((model) => model.enabled && model.id === parsedFallback.id);
  return configuredModel ? getProviderModelOptionValue(configuredModel) : fallbackModel;
}

function getStoredFallbackModelValue(value: string) {
  return value;
}

function normalizeEditedModel(model: ConfiguredProviderModel, catalog: ProviderModelCatalog): ConfiguredProviderModel {
  const option = getCatalogOption(catalog, model.channel, model.id);
  return option && !model.label.trim() ? { ...model, label: option.label } : model;
}

function getInitialImageModels(setting: ProviderSettingPayload | null): ConfiguredProviderModel[] {
  if (setting?.enabledImageModels?.length) return setting.enabledImageModels;
  const fallback = setting?.imageModel ?? "gpt-image-2";
  return [{ channel: defaultProviderModelChannel, enabled: true, id: fallback, label: fallback }];
}

function getInitialReversePromptModels(setting: ProviderSettingPayload | null): ConfiguredProviderModel[] {
  if (setting?.enabledReversePromptModels?.length) return setting.enabledReversePromptModels;
  const fallback = setting?.textModel ?? "gpt-5.5";
  return [{ channel: defaultProviderModelChannel, enabled: true, id: fallback, label: fallback }];
}

function getInitialVideoModels(setting: ProviderSettingPayload | null): ConfiguredProviderModel[] {
  if (setting?.enabledVideoModels?.length) return setting.enabledVideoModels;
  const fallback = setting?.videoModel ?? "cliproxy:grok-imagine-video";
  const parsedFallback = parseConfiguredModelValue(fallback);
  return [{ channel: parsedFallback.channel ?? "cliproxy", enabled: true, id: parsedFallback.id, label: parsedFallback.id }];
}

function createInitialCliProxyOAuthStates(): Record<CliProxyOAuthProvider, CliProxyOAuthState> {
  return cliProxyOAuthProviders.reduce((states, provider) => {
    states[provider.provider] = { status: "idle" };
    return states;
  }, {} as Record<CliProxyOAuthProvider, CliProxyOAuthState>);
}

function getCliProxyOAuthStatusText(state: CliProxyOAuthState | undefined) {
  if (!state || state.status === "idle") return "未开始";
  if (state.status === "opening") return "正在打开授权窗口";
  if (state.status === "wait") return "等待授权完成";
  if (state.status === "ok") return "已登录";
  return state.errorMessage ? `失败：${state.errorMessage}` : "登录失败";
}

function getCliProxyOAuthProviderTitle(providerName: CliProxyOAuthProvider) {
  return cliProxyOAuthProviders.find((provider) => provider.provider === providerName)?.title ?? providerName;
}

function getCliProxySyncStatusLabel(status: CliProxyInitializationPayload["apiKeySyncStatus"]) {
  if (status === "ok") return "已同步";
  if (status === "skipped") return "已跳过";
  return "需要确认";
}
