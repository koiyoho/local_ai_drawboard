import OpenAI from "openai";

export type OpenAIProviderConfig = {
  apiKey: string;
  baseUrl?: string | null;
  imageModel: string;
  textModel?: string | null;
};

export function createOpenAIClient(config: OpenAIProviderConfig) {
  if (!config.apiKey) {
    throw new Error("Provider API key is not configured");
  }

  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl || undefined,
  });
}

export function getImageModel(config: Pick<OpenAIProviderConfig, "imageModel">) {
  return config.imageModel || "gpt-image-2";
}

export function getTextModel(config: Pick<OpenAIProviderConfig, "textModel">) {
  return config.textModel?.trim() || process.env.OPENAI_TEXT_MODEL?.trim() || "gpt-5.5";
}
