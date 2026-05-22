export type ProviderModelOption = {
  channel?: ProviderModelChannel;
  id: string;
  label: string;
};

export type ConfiguredProviderModel = ProviderModelOption & {
  enabled: boolean;
};

export type ProviderModelChannel = "provider" | "gemini-bridge" | "codex";

export const defaultProviderModelChannel: ProviderModelChannel = "provider";
export type ProviderModelCatalog = Record<ProviderModelChannel, ProviderModelOption[]>;

export const geminiBridgeTextModels: ProviderModelOption[] = [
  { id: "gemini-web", label: "Gemini Web" },
  { id: "gemini-web-3.1-flash-lite", label: "3.1 Flash-Lite" },
  { id: "gemini-web-3.5-flash", label: "3.5 Flash" },
  { id: "gemini-web-3.1-pro-standard", label: "3.1 Pro · 标准" },
  { id: "gemini-web-3.1-pro-extended", label: "3.1 Pro · 扩展" },
];

export const geminiBridgeImageModels: ProviderModelOption[] = [
  ...geminiBridgeTextModels,
  { id: "nano-banana", label: "Nano Banana" },
];

export const providerImageModelCatalog: ProviderModelCatalog = {
  codex: [{ id: "gpt-image-2", label: "GPT Image 2" }],
  "gemini-bridge": geminiBridgeImageModels,
  provider: [
    { id: "gpt-image-2", label: "GPT Image 2" },
    { id: "flux-kontext-pro", label: "Flux Kontext Pro" },
    { id: "dall-e-3", label: "DALL·E 3" },
  ],
};

export const providerReversePromptModelCatalog: ProviderModelCatalog = {
  codex: [
    { id: "gpt-5.5", label: "GPT 5.5" },
    { id: "gpt-5.5-mini", label: "GPT 5.5 Mini" },
    { id: "gpt-5.4-mini", label: "GPT 5.4 Mini" },
  ],
  "gemini-bridge": geminiBridgeTextModels,
  provider: [
    { id: "gpt-5.5", label: "GPT 5.5" },
    { id: "gpt-5.5-mini", label: "GPT 5.5 Mini" },
    { id: "gpt-5.4-mini", label: "GPT 5.4 Mini" },
  ],
};

export function getProviderModelChannelLabel(channel: ProviderModelChannel | undefined) {
  if (channel === "codex") return "Codex 代理";
  if (channel === "gemini-bridge") return "Gemini Bridge";
  return "第三方 API";
}

const imageModelKeywords = [
  "image",
  "dall-e",
  "flux",
  "stable",
  "sd",
  "midjourney",
  "imagen",
];

export function normalizeConfiguredModels(
  rawModels: unknown,
  fallbackModel: string,
): ConfiguredProviderModel[] {
  const parsedModels = Array.isArray(rawModels) ? rawModels : parseJsonArray(rawModels);
  const models = parsedModels
    .map((model) => normalizeConfiguredModel(model))
    .filter((model): model is ConfiguredProviderModel => Boolean(model))
    .filter((model, index, all) => all.findIndex((candidate) => getConfiguredModelKey(candidate) === getConfiguredModelKey(model)) === index);

  const fallback = parseConfiguredModelValue(fallbackModel.trim());
  const fallbackChannel = fallback.channel ?? defaultProviderModelChannel;
  const hasFallback = fallback.channel
    ? models.some((model) => getConfiguredModelKey(model) === `${fallbackChannel}:${fallback.id}`)
    : models.some((model) => model.id === fallback.id);
  if (fallback.id && !hasFallback) {
    models.unshift({ channel: fallbackChannel, enabled: true, id: fallback.id, label: fallback.id });
  }
  return models;
}

export function getEnabledProviderModels(
  rawModels: unknown,
  fallbackModel: string,
): ProviderModelOption[] {
  return normalizeConfiguredModels(rawModels, fallbackModel)
    .filter((model) => model.enabled)
    .map(({ channel, id, label }) => ({ ...(channel ? { channel } : {}), id, label }))
    .filter((model, index, all) => all.findIndex((candidate) => getConfiguredModelKey(candidate) === getConfiguredModelKey(model)) === index);
}

export function getConfiguredModelError(value: string, label = "模型") {
  const trimmedValue = value.trim();
  if (!trimmedValue) return `${label}不能为空`;
  const parsed = parseConfiguredModelValue(trimmedValue);
  if (!parsed.id.trim()) return `${label}的模型 ID 不能为空`;
  return "";
}

export function isConfiguredModelEnabled(
  rawModels: unknown,
  modelValue: string,
) {
  const parsed = parseConfiguredModelValue(modelValue.trim());
  if (!parsed.id.trim()) return false;
  const configuredModels = normalizeConfiguredModels(rawModels, "");
  if (configuredModels.length === 0) return true;
  return configuredModels
    .some((model) =>
      model.enabled &&
      model.id === parsed.id &&
      (parsed.channel ? (model.channel ?? defaultProviderModelChannel) === parsed.channel : true));
}

export function filterImageModelOptions(rawModels: unknown[], fallbackModel: string): ProviderModelOption[] {
  const models = rawModels
    .map(getModelId)
    .filter((id): id is string => Boolean(id))
    .filter((id, index, all) => all.indexOf(id) === index)
    .filter((id) => {
      const lowerId = id.toLowerCase();
      return imageModelKeywords.some((keyword) => lowerId.includes(keyword));
    })
    .map((id) => ({ id, label: id }));

  if (models.length > 0) return models;
  return fallbackModel.trim() ? [{ id: fallbackModel.trim(), label: fallbackModel.trim() }] : [];
}

function getModelId(model: unknown) {
  if (typeof model === "string") return model;
  if (!model || typeof model !== "object") return "";
  const candidate = model as { id?: unknown; name?: unknown };
  if (typeof candidate.id === "string") return candidate.id;
  if (typeof candidate.name === "string") return candidate.name;
  return "";
}

function normalizeConfiguredModel(model: unknown): ConfiguredProviderModel | null {
  const id = getModelId(model).trim();
  if (!id) return null;
  if (typeof model === "object" && model) {
    const candidate = model as { channel?: unknown; enabled?: unknown; label?: unknown; provider?: unknown };
    const channel = getModelChannel(candidate.channel ?? candidate.provider);
    return {
      ...(channel ? { channel } : {}),
      enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : true,
      id,
      label: typeof candidate.label === "string" && candidate.label.trim() ? candidate.label.trim() : id,
    };
  }
  return { channel: defaultProviderModelChannel, enabled: true, id, label: id };
}

function getConfiguredModelKey(model: ProviderModelOption) {
  return `${model.channel ?? defaultProviderModelChannel}:${model.id}`;
}

function getModelChannel(value: unknown): ProviderModelChannel | undefined {
  if (value === "codex" || value === "gemini-bridge" || value === "provider") return value;
  return undefined;
}

export function encodeConfiguredModelValue(model: Pick<ProviderModelOption, "channel" | "id">) {
  const channel = model.channel ?? defaultProviderModelChannel;
  return `${channel}:${model.id}`;
}

export function getProviderModelOptionValue(model: Pick<ProviderModelOption, "channel" | "id">) {
  return model.channel ? encodeConfiguredModelValue(model) : model.id;
}

export function providerModelOptionMatchesSelection(
  model: Pick<ProviderModelOption, "channel" | "id">,
  selection: string,
) {
  return getProviderModelOptionValue(model) === selection || model.id === selection;
}

export function normalizeProviderModelSelection(
  models: Array<Pick<ProviderModelOption, "channel" | "id">>,
  selection: string,
) {
  const parsedSelection = parseConfiguredModelValue(selection);
  const selectedModel = parsedSelection.channel
    ? models.find((model) =>
        model.id === parsedSelection.id &&
        (model.channel ?? defaultProviderModelChannel) === parsedSelection.channel)
    : findProviderPreferredModel(models, parsedSelection.id);
  return selectedModel ? getProviderModelOptionValue(selectedModel) : selection;
}

export function getDefaultProviderModelSelection(
  models: Array<Pick<ProviderModelOption, "channel" | "id">>,
  fallback?: string,
) {
  const parsedFallback = fallback ? parseConfiguredModelValue(fallback) : null;
  const fallbackModel = parsedFallback
    ? parsedFallback.channel
      ? models.find((model) =>
          model.id === parsedFallback.id &&
          (model.channel ?? defaultProviderModelChannel) === parsedFallback.channel)
      : findProviderPreferredModel(models, parsedFallback.id)
    : undefined;
  return getProviderModelOptionValue(fallbackModel ?? models[0]);
}

export function parseConfiguredModelValue(value: string): { channel?: ProviderModelChannel; id: string } {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0) return { channel: undefined, id: value };
  const channel = getModelChannel(value.slice(0, separatorIndex));
  if (!channel) return { channel: undefined, id: value };
  return { channel, id: value.slice(separatorIndex + 1) };
}

function findProviderPreferredModel(models: Array<Pick<ProviderModelOption, "channel" | "id">>, id: string) {
  return models.find((model) => model.id === id && (model.channel ?? defaultProviderModelChannel) === defaultProviderModelChannel) ??
    models.find((model) => model.id === id);
}

function parseJsonArray(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
