import { useEffect, useMemo, useRef, useState } from "react";

import { apiJson } from "@/client/api";
import { AppIcon } from "@/components/ui/AppIcon";
import { IconAi, IconBack, IconClose, IconCopy, IconImage, IconLoading } from "@/components/ui/icons";
import { apiFetch } from "@/lib/api-client";
import {
  getDefaultProviderModelSelection,
  getProviderModelOptionValue,
  normalizeProviderModelSelection,
  providerModelOptionMatchesSelection,
  type ProviderModelChannel,
} from "@/lib/provider-models";

type ReversePromptModel = {
  channel?: ProviderModelChannel;
  id: string;
  label: string;
};

type ReversePromptPayload = {
  reversePromptModels?: ReversePromptModel[];
  selectedReversePromptModel?: string;
};

type ReversePromptMode = "preset" | "custom";
type ReversePromptLanguage = "zh" | "en";
type ReversePromptFormat = "natural" | "json";
type ReversePromptLength = "short" | "medium" | "long";
type ReversePromptAnalysis = "full" | "style";

const pendingReversePromptStorageKey = "aiboard.pendingReversePrompt";

export function ReversePromptApp() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const [mode, setMode] = useState<ReversePromptMode>("preset");
  const [language, setLanguage] = useState<ReversePromptLanguage>("zh");
  const [format, setFormat] = useState<ReversePromptFormat>("json");
  const [maxLength, setMaxLength] = useState<ReversePromptLength>("long");
  const [analysisMode, setAnalysisMode] = useState<ReversePromptAnalysis>("full");
  const [customInstruction, setCustomInstruction] = useState("");
  const [models, setModels] = useState<ReversePromptModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [promptText, setPromptText] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const imageMeta = useMemo(() => {
    if (!imageFile) return "";
    return `${imageFile.type || "image"} · ${Math.max(1, Math.round(imageFile.size / 1024))} KB`;
  }, [imageFile]);

  useEffect(() => {
    let ignore = false;
    setIsModelLoading(true);
    apiJson<ReversePromptPayload>("/api/provider-settings/model-options")
      .then((payload) => {
        if (ignore) return;
        if (payload.reversePromptModels?.length) {
          setModels(payload.reversePromptModels);
          setSelectedModel((current) =>
            payload.reversePromptModels!.some((model) => providerModelOptionMatchesSelection(model, current))
              ? normalizeProviderModelSelection(payload.reversePromptModels!, current)
              : getDefaultProviderModelSelection(payload.reversePromptModels!, payload.selectedReversePromptModel),
          );
          setError("");
        } else {
          setModels([]);
          setSelectedModel("");
          setError("本地设置中未配置可用的反推 / 提示词模型");
        }
      })
      .catch((error: unknown) => {
        if (!ignore) setError(error instanceof Error ? error.message : "模型配置读取失败");
      })
      .finally(() => {
        if (!ignore) setIsModelLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!imageFile) {
      setImagePreviewUrl("");
      return;
    }
    const objectUrl = URL.createObjectURL(imageFile);
    setImagePreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [imageFile]);

  function handleFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("仅支持上传图片文件");
      return;
    }
    setImageFile(file);
    setPromptText("");
    setError("");
  }

  async function runReversePrompt() {
    if (!imageFile) {
      setError("请先上传图片");
      return;
    }
    if (!selectedModel) {
      setError("本地设置中未配置可用的反推 / 提示词模型");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", imageFile);
      formData.append("analysisMode", analysisMode);
      formData.append("format", format);
      formData.append("language", language);
      formData.append("maxLength", maxLength);
      formData.append("mode", mode);
      formData.append("model", selectedModel);
      if (mode === "custom" && customInstruction.trim()) {
        formData.append("customInstruction", customInstruction.trim());
      }
      const response = await apiFetch("/api/reverse-prompt", {
        body: formData,
        method: "POST",
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; promptText?: string };
      if (!response.ok || !payload.promptText) throw new Error(payload.error ?? "反推提示词失败");
      setPromptText(payload.promptText);
    } catch (error) {
      setError(error instanceof Error ? error.message : "反推提示词失败");
    } finally {
      setIsLoading(false);
    }
  }

  async function copyPrompt() {
    if (!promptText.trim()) return;
    await copyText(promptText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function sendToBoard() {
    if (!promptText.trim()) return;
    window.localStorage.setItem(pendingReversePromptStorageKey, promptText.trim());
    window.location.href = "/";
  }

  return (
    <main className="reverse-prompt-page-shell">
      <section className="reverse-prompt-page-surface">
        <header className="reverse-prompt-page-header">
          <div>
            <a className="templates-back-link" href="/">
              <AppIcon icon={IconBack} size="sm" />
              返回画板
            </a>
            <p className="eyebrow">Reverse Prompt</p>
            <h1>反推提示词</h1>
          </div>
          <a className="reverse-prompt-header-link" href="/">回到画板</a>
        </header>

        <div className="reverse-prompt-workbench">
          <section className="reverse-upload-panel" aria-label="上传图片">
            <div className="reverse-section-heading">
              <h2>上传图片</h2>
              {imageFile ? (
                <button aria-label="移除图片" onClick={() => setImageFile(null)} type="button">
                  <AppIcon icon={IconClose} size="sm" />
                </button>
              ) : null}
            </div>
            <button className={`reverse-dropzone ${imagePreviewUrl ? "has-image" : ""}`} onClick={() => fileInputRef.current?.click()} type="button">
              {imagePreviewUrl ? (
                <img alt="上传预览" src={imagePreviewUrl} />
              ) : (
                <span>
                  <AppIcon icon={IconImage} size={36} />
                  点击上传参考图
                </span>
              )}
            </button>
            <input
              accept="image/*"
              hidden
              onChange={(event) => handleFile(event.target.files?.[0] ?? null)}
              ref={fileInputRef}
              type="file"
            />
            {imageMeta ? <p className="reverse-image-meta">{imageMeta}</p> : null}
          </section>

          <section className="reverse-controls-panel" aria-label="反推设置">
            <div className="reverse-section-heading">
              <h2>反推模式</h2>
            </div>
            <SegmentedControl
              options={[
                { label: "预设模式", value: "preset" },
                { label: "自定义模式", value: "custom" },
              ]}
              value={mode}
              onChange={(value) => setMode(value as ReversePromptMode)}
            />
            {mode === "custom" ? (
              <label className="reverse-field">
                <span>自定义要求</span>
                <textarea
                  onChange={(event) => setCustomInstruction(event.target.value)}
                  placeholder="例如：重点输出服装、镜头与材质，不要描述背景"
                  value={customInstruction}
                />
              </label>
            ) : null}

            <div className="reverse-field">
              <span>输出语言</span>
              <SegmentedControl
                options={[
                  { label: "中文", value: "zh" },
                  { label: "English", value: "en" },
                ]}
                value={language}
                onChange={(value) => setLanguage(value as ReversePromptLanguage)}
              />
            </div>

            <div className="reverse-field">
              <span>输出格式</span>
              <SegmentedControl
                options={[
                  { label: "自然语言", value: "natural" },
                  { label: "JSON", value: "json" },
                ]}
                value={format}
                onChange={(value) => setFormat(value as ReversePromptFormat)}
              />
            </div>

            <label className="reverse-field">
              <span>字数限制</span>
              <select onChange={(event) => setMaxLength(event.target.value as ReversePromptLength)} value={maxLength}>
                <option value="short">短（80-200字）</option>
                <option value="medium">中（120-300字）</option>
                <option value="long">长（201-500字）</option>
              </select>
            </label>

            <div className="reverse-field">
              <span>分析模式</span>
              <SegmentedControl
                options={[
                  { label: "全图描述", value: "full" },
                  { label: "风格提取", value: "style" },
                ]}
                value={analysisMode}
                onChange={(value) => setAnalysisMode(value as ReversePromptAnalysis)}
              />
            </div>

            <label className="reverse-field">
              <span>模型选择</span>
              <select disabled={isModelLoading || models.length === 0} onChange={(event) => setSelectedModel(event.target.value)} value={selectedModel}>
                {isModelLoading ? <option value="">正在读取本地模型...</option> : null}
                {!isModelLoading && models.length === 0 ? <option value="">未配置反推模型</option> : null}
                {models.map((model) => (
                  <option key={getProviderModelOptionValue(model)} value={getProviderModelOptionValue(model)}>{model.label}</option>
                ))}
              </select>
              <em>来自本地设置中的反推 / 提示词模型池</em>
            </label>

            <div className="reverse-execute-row">
              <button disabled={isLoading || isModelLoading || !selectedModel} onClick={() => void runReversePrompt()} type="button">
                {isLoading ? <AppIcon className="spin" icon={IconLoading} size="sm" /> : <AppIcon icon={IconAi} size="sm" />}
                {isModelLoading ? "读取模型中..." : isLoading ? "反推中..." : "执行反推"}
              </button>
            </div>
            {error ? <p className="reverse-error">{error}</p> : null}
          </section>

          <section className="reverse-output-panel" aria-label="输出提示词">
            <div className="reverse-section-heading">
              <h2>输出提示词</h2>
            </div>
            <textarea
              onChange={(event) => setPromptText(event.target.value)}
              placeholder="反推结果会显示在这里"
              value={promptText}
            />
          </section>
        </div>

        <footer className="reverse-prompt-actions-bar">
          <button disabled={!promptText.trim()} onClick={() => void copyPrompt()} type="button">
            <AppIcon icon={IconCopy} size="sm" />
            {copied ? "已复制" : "复制提示词"}
          </button>
          <button disabled={!promptText.trim()} onClick={sendToBoard} type="button">
            发送至生图
          </button>
        </footer>
      </section>
    </main>
  );
}

function SegmentedControl({
  onChange,
  options,
  value,
}: {
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <div className="reverse-segmented-control">
      {options.map((option) => (
        <button
          aria-pressed={value === option.value}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall through to the legacy copy path when clipboard permission is unavailable.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-10000px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}
