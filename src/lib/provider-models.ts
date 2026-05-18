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

  const fallback = fallbackModel.trim();
  if (fallback && !models.some((model) => model.id === fallback)) {
    models.unshift({ channel: defaultProviderModelChannel, enabled: true, id: fallback, label: fallback });
  }
  return models;
}

export function getEnabledProviderModels(
  rawModels: unknown,
  fallbackModel: string,
): ProviderModelOption[] {
  return normalizeConfiguredModels(rawModels, fallbackModel)
    .filter((model) => model.enabled)
    .map(({ id, label }) => ({ id, label }))
    .filter((model, index, all) => all.findIndex((candidate) => candidate.id === model.id) === index);
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
  return model.id;
}

function getModelChannel(value: unknown): ProviderModelChannel | undefined {
  if (value === "codex" || value === "gemini-bridge" || value === "provider") return value;
  return undefined;
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
