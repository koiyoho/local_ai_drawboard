"use client";

import { AppIcon } from "@/components/ui/AppIcon";
import {
  IconApiKey,
  IconCollapseDown,
  IconCollapseUp,
  IconCopy,
  IconPlus,
  IconSave,
  IconDelete,
} from "@/components/ui/icons";
import { useEffect, useState, useTransition } from "react";

import { apiFetch } from "@/lib/api-client";
import { defaultProviderModelChannel, getProviderModelChannelLabel, type ConfiguredProviderModel, type ProviderModelChannel } from "@/lib/provider-models";

export type ProviderSettingPayload = {
  id: string;
  provider: string;
  displayName: string;
  baseUrl: string | null;
  imageModel: string;
  textModel: string;
  enabledImageModels: ConfiguredProviderModel[];
  enabledReversePromptModels: ConfiguredProviderModel[];
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyPreview: string | null;
  updatedAt: string;
};

export type ProviderSettingHistoryPayload = Omit<ProviderSettingPayload, "enabled" | "hasApiKey"> & {
  apiKeyPreview: string | null;
};

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
  const [imageModels, setImageModels] = useState<ConfiguredProviderModel[]>(getInitialImageModels(initialSetting));
  const [reversePromptModels, setReversePromptModels] = useState<ConfiguredProviderModel[]>(getInitialReversePromptModels(initialSetting));
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();
  const imageEnabledCount = imageModels.filter((model) => model.enabled).length;
  const textEnabledCount = reversePromptModels.filter((model) => model.enabled).length;

  useEffect(() => {
    setSetting(initialSetting);
    setImageModel(initialSetting?.imageModel ?? "gpt-image-2");
    setTextModel(initialSetting?.textModel ?? "gpt-5.5");
    setImageModels(getInitialImageModels(initialSetting));
    setReversePromptModels(getInitialReversePromptModels(initialSetting));
  }, [initialSetting?.id, initialSetting?.updatedAt]);

  function saveModelSettings() {
    startTransition(async () => {
      setStatus("");
      const response = await apiFetch("/api/admin/provider-models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabledImageModels: imageModels,
          enabledReversePromptModels: reversePromptModels,
          imageModel,
          textModel,
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
      setImageModels(getInitialImageModels(payload.providerSetting));
      setReversePromptModels(getInitialReversePromptModels(payload.providerSetting));
      setStatus("模型池和后台通道已保存");
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
            {setting?.enabled ? `${imageEnabledCount + textEnabledCount} 个已启用` : "需先保存 API"}
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
            ? `生图/改图 ${imageEnabledCount} 个 · 反推/提示词 ${textEnabledCount} 个 · 后台通道由管理员在此配置`
            : "先保存第三方 API 设置后，再配置前台可见模型和后台调用通道。"}
        </p>
      ) : (
        <div className="provider-model-pool-body" id="provider-model-pool-body">
          <p className="provider-field-hint">
            前台只展示模型名称；每个模型实际走第三方 API、官方 Codex 代理还是 Gemini Bridge，由这里统一配置。官方 Codex 账号 OAuth 本身不是图片 API key，Codex 图片通道需要服务器配置 CODEX_IMAGE_PROXY_BASE_URL。
          </p>
          <ModelListEditor
            fallbackModel={imageModel}
            label="生图 / 改图模型"
            models={imageModels}
            onFallbackModelChange={setImageModel}
            onModelsChange={setImageModels}
            presets={[
              { channel: "provider", enabled: true, id: "gpt-image-2", label: "GPT Image 2" },
              { channel: "codex", enabled: true, id: "gpt-image-2", label: "GPT Image 2 · Codex Proxy" },
              { channel: "gemini-bridge", enabled: true, id: "nano-banana", label: "Nano Banana" },
              { channel: "gemini-bridge", enabled: true, id: "gemini-web", label: "Gemini Web" },
            ]}
          />
          <ModelListEditor
            fallbackModel={textModel}
            label="反推 / 提示词模型"
            models={reversePromptModels}
            onFallbackModelChange={setTextModel}
            onModelsChange={setReversePromptModels}
            presets={[
              { channel: "provider", enabled: true, id: "gpt-5.5", label: "GPT 5.5" },
              { channel: "codex", enabled: true, id: "gpt-5.5", label: "GPT 5.5 · Codex Proxy" },
              { channel: "provider", enabled: true, id: "gpt-5.5-mini", label: "GPT 5.5 Mini" },
              { channel: "gemini-bridge", enabled: true, id: "gemini-web", label: "Gemini Web" },
            ]}
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
            <em>{history.apiKeyPreview ?? "已保存"}</em>
          </span>
        </button>
      ))}
    </div>
  );
}

function ModelListEditor({
  fallbackModel,
  label,
  models,
  onFallbackModelChange,
  onModelsChange,
  presets,
}: {
  fallbackModel: string;
  label: string;
  models: ConfiguredProviderModel[];
  onFallbackModelChange: (value: string) => void;
  onModelsChange: (models: ConfiguredProviderModel[]) => void;
  presets: ConfiguredProviderModel[];
}) {
  function updateModel(index: number, patch: Partial<ConfiguredProviderModel>) {
    onModelsChange(models.map((model, modelIndex) => modelIndex === index ? { ...model, ...patch } : model));
  }

  function addModel() {
    onModelsChange([...models, { channel: defaultProviderModelChannel, enabled: true, id: "", label: "" }]);
  }

  function removeModel(index: number) {
    onModelsChange(models.filter((_, modelIndex) => modelIndex !== index));
  }

  function addPreset(preset: ConfiguredProviderModel) {
    if (models.some((model) => model.id === preset.id)) {
      onModelsChange(models.map((model) => model.id === preset.id ? {
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
        {presets.map((preset) => (
          <button key={`${preset.channel ?? defaultProviderModelChannel}-${preset.id}`} onClick={() => addPreset(preset)} type="button">
            <AppIcon icon={IconPlus} size="sm" />
            {getProviderModelChannelLabel(preset.channel)} · {preset.label}
          </button>
        ))}
      </div>
      <label className="provider-default-model">
        默认模型
        <input onChange={(event) => onFallbackModelChange(event.target.value)} value={fallbackModel} />
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
              后台通道
              <select
                onChange={(event) => updateModel(index, { channel: event.target.value as ProviderModelChannel })}
                value={model.channel ?? defaultProviderModelChannel}
              >
                <option value="provider">第三方 API</option>
                <option value="codex">Codex 代理</option>
                <option value="gemini-bridge">Gemini Bridge</option>
              </select>
            </label>
            <label>
              模型 ID
              <input
                onChange={(event) => updateModel(index, { id: event.target.value })}
                placeholder="模型 ID"
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
