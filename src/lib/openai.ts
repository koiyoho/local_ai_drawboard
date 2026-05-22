import OpenAI from "openai";
import { parseConfiguredModelValue } from "./provider-models";

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
  return parseConfiguredModelValue(config.imageModel || "gpt-image-2").id;
}

export function getTextModel(config: Pick<OpenAIProviderConfig, "textModel">) {
  return parseConfiguredModelValue(config.textModel?.trim() || process.env.OPENAI_TEXT_MODEL?.trim() || "gpt-5.5").id;
}
