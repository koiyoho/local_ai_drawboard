"use client";

import { useEffect, useMemo, useState } from "react";

import { AppIcon } from "@/components/ui/AppIcon";
import { IconApiKey, IconCollapseDown, IconCollapseUp, IconCopy, IconExternalLink, IconGlobe, IconSave, IconRefresh } from "@/components/ui/icons";
import { apiFetch } from "@/lib/api-client";

type GeminiBridgeStatus = {
  bridgeBaseUrl: string;
  bridgeHealth: "online" | "offline" | "error";
  bridgeHost: string;
  bridgePort: number;
  hasApiKey: boolean;
  hasFullCookies: boolean;
  hasSecure1psid: boolean;
  hasSecure1psidts: boolean;
  imageModel: string;
  suggestedImageModels?: Array<{ id: string; label: string }>;
  suggestedTextModels?: Array<{ id: string; label: string }>;
  textModel: string;
};

export function GeminiBridgeCard() {
  const [status, setStatus] = useState<GeminiBridgeStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfiguringProvider, setIsConfiguringProvider] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [message, setMessage] = useState("");
  const [cookieImport, setCookieImport] = useState("");
  const [secure1psid, setSecure1psid] = useState("");
  const [secure1psidts, setSecure1psidts] = useState("");

  async function loadStatus() {
    setIsLoading(true);
    setMessage("");
    try {
      const response = await apiFetch("/api/gemini-bridge/status");
      if (!response.ok) throw new Error("无法读取 Gemini Bridge 状态");
      setStatus(await response.json());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法读取 Gemini Bridge 状态");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  const setupText = useMemo(() => {
    if (!status) return "";
    return [
      `Base URL: ${status.bridgeBaseUrl}`,
      `API Key: ${status.hasApiKey ? "使用本机 .env 中的 GEMINI_BRIDGE_API_KEY" : "需要在本机 .env 生成 GEMINI_BRIDGE_API_KEY"}`,
      `图片模型: ${status.imageModel}`,
      `提示词模型: ${status.textModel}`,
    ].join("\n");
  }, [status]);

  async function copyText(text: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(successMessage);
    } catch {
      setMessage("当前浏览器不允许复制，请手动选择文本");
    }
  }

  async function saveCookies() {
    setIsSaving(true);
    setMessage("");
    try {
      const response = await apiFetch("/api/gemini-bridge/auth", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookieImport, secure1psid, secure1psidts }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "保存 Gemini Cookie 失败");
      setCookieImport("");
      setSecure1psid("");
      setSecure1psidts("");
      setMessage(payload.cookieCount ? `Gemini Cookie 已导入本机项目，包含 ${payload.cookieCount} 条完整 Cookie` : "Gemini Cookie 已导入本机项目");
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存 Gemini Cookie 失败");
    } finally {
      setIsSaving(false);
    }
  }

  async function configureProvider() {
    setIsConfiguringProvider(true);
    setMessage("");
    try {
      const response = await apiFetch("/api/gemini-bridge/configure-provider", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "无法写入 Gemini Bridge API 设置");
      setMessage("已把 Gemini Web Bridge 写入 API 设置，并加入 Gemini Web / Nano Banana 模型池");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法写入 Gemini Bridge API 设置");
    } finally {
      setIsConfiguringProvider(false);
    }
  }

  const ready = Boolean(status?.hasApiKey && status.hasSecure1psid);
  const missingItems = [
    status && !status.hasApiKey ? "桥接访问密钥" : "",
    status && !status.hasSecure1psid ? "__Secure-1PSID Cookie" : "",
    status && status.bridgeHealth !== "online" ? "Gemini Bridge 本地服务" : "",
  ].filter(Boolean);
  const cookieSettingsUrl = "chrome://settings/siteData?searchSubpage=gemini.google.com";

  return (
    <section aria-label="Gemini Web 登录态" className="gemini-bridge-card">
      <div className="gemini-bridge-card-icon">
        <AppIcon icon={IconGlobe} size={20} />
      </div>
      <div className="gemini-bridge-card-body">
        <div className="gemini-bridge-card-title">
          <div>
            <p className="eyebrow">Google Gemini</p>
            <h2>Gemini Web Bridge</h2>
          </div>
          <div className="provider-title-actions">
            <span className={ready ? "provider-badge is-enabled" : "provider-badge"}>
              {isLoading ? "检查中" : ready ? "可用于模型池" : "需要补配置"}
            </span>
            <button
              aria-controls="gemini-bridge-body"
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
            Cookie {status?.hasSecure1psid ? "已设置" : "缺少"} · 完整 Cookie {status?.hasFullCookies ? "已导入" : "未导入"} · 桥接服务 {status?.bridgeHealth === "online" ? "运行中" : "未就绪"} · {status?.bridgeBaseUrl ?? "读取中"}
          </p>
        ) : (
          <div className="gemini-bridge-expanded" id="gemini-bridge-body">
            <p>
              复用本机 Gemini Web 登录态，为当前应用提供 OpenAI 兼容的生图、改图、提示词和分镜文本接口。
            </p>
            <div className="gemini-bridge-status-grid">
              <StatusItem label="Cookie" value={status?.hasSecure1psid ? "已设置" : "缺少 __Secure-1PSID"} />
              <StatusItem label="会话时间戳" value={status?.hasSecure1psidts ? "已设置" : "可选"} />
              <StatusItem label="完整 Cookie" value={status?.hasFullCookies ? "已导入" : "未导入"} />
              <StatusItem label="桥接密钥" value={status?.hasApiKey ? "已设置" : "缺少本机密钥"} />
              <StatusItem label="桥接服务" value={status?.bridgeHealth === "online" ? "运行中" : status?.bridgeHealth === "error" ? "响应异常" : "未启动"} />
              <StatusItem label="本地地址" value={status?.bridgeBaseUrl ?? "读取中"} />
            </div>
            {!isLoading && missingItems.length > 0 ? (
              <p className="gemini-cookie-note">
                还缺少：{missingItems.join("、")}。桥接访问密钥不是 Google API Key，需要写入本机 `.env`；Cookie 可在本页粘贴导入。
              </p>
            ) : null}
            {status ? (
              <pre className="gemini-bridge-config">{setupText}</pre>
            ) : null}
            <div className="gemini-cookie-import">
              <div>
                <h3>导入 Gemini Cookie</h3>
                <p>优先粘贴浏览器导出的完整 Google/Gemini Cookie JSON 或请求头 Cookie；只填下面两个值时，某些账号会在服务端被 Gemini 判定为未登录。</p>
              </div>
              <label>
                完整 Cookie JSON / Header
                <textarea
                  autoComplete="off"
                  onChange={(event) => setCookieImport(event.target.value)}
                  placeholder={status?.hasFullCookies ? "已导入，重新粘贴可覆盖" : "粘贴 Cookie-Editor 导出的 JSON，或 DevTools 请求头里的 Cookie: ..."}
                  rows={5}
                  value={cookieImport}
                />
              </label>
              <label>
                __Secure-1PSID
                <input
                  autoComplete="off"
                  onChange={(event) => setSecure1psid(event.target.value)}
                  placeholder={status?.hasSecure1psid ? "已导入，重新粘贴可覆盖" : "粘贴 __Secure-1PSID"}
                  type="password"
                  value={secure1psid}
                />
              </label>
              <label>
                __Secure-1PSIDTS
                <input
                  autoComplete="off"
                  onChange={(event) => setSecure1psidts(event.target.value)}
                  placeholder={status?.hasSecure1psidts ? "已导入，重新粘贴可覆盖" : "可选，建议一并粘贴"}
                  type="password"
                  value={secure1psidts}
                />
              </label>
            </div>
            <div className="provider-actions">
              <button
                disabled={isSaving || (!secure1psid.trim() && !cookieImport.trim())}
                onClick={() => void saveCookies()}
                type="button"
              >
                <AppIcon icon={IconSave} size="md" />
                {isSaving ? "保存中" : "保存 Cookie"}
              </button>
              <button disabled={isLoading} onClick={() => void loadStatus()} type="button">
                <AppIcon icon={IconRefresh} size="md" />
                刷新状态
              </button>
              <button
                className="secondary-action"
                disabled={!status}
                onClick={() => status && void copyText(setupText, "已复制接口配置")}
                type="button"
              >
                <AppIcon icon={IconCopy} size="md" />
                复制接口配置
              </button>
              <button
                className="secondary-action"
                disabled={isConfiguringProvider || !ready}
                onClick={() => void configureProvider()}
                type="button"
              >
                <AppIcon icon={IconApiKey} size="md" />
                {isConfiguringProvider ? "写入中" : "加入模型池"}
              </button>
              <button
                className="secondary-action"
                onClick={() => void copyText(cookieSettingsUrl, "已复制 Chrome Cookie 设置地址")}
                type="button"
              >
                <AppIcon icon={IconApiKey} size="md" />
                复制 Cookie 设置地址
              </button>
              <a className="gemini-bridge-link" href="https://gemini.google.com/" rel="noreferrer" target="_blank">
                <AppIcon icon={IconExternalLink} size="md" />
                打开 Gemini
              </a>
            </div>
            <p className="gemini-cookie-note">
              浏览器不允许本站直接读取 `gemini.google.com` 的会话 Cookie；推荐用 Cookie-Editor 等浏览器扩展导出 `google.com` / `gemini.google.com` 的完整 Cookie JSON，再粘贴到上方。`GEMINI_BRIDGE_API_KEY` 只保护本站到桥接服务的本地调用，不需要从 Google 获取。
            </p>
          </div>
        )}
        {message ? <span className="muted">{message}</span> : null}
      </div>
    </section>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-summary">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
