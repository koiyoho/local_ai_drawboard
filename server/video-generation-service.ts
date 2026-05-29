import { toFile } from "openai/uploads";

import type { GenerationJob, ProviderSetting } from "@/generated/prisma/client";
import { createProjectTimestampFilename } from "@/lib/filenames";
import { createOpenAIClient } from "@/lib/openai";
import { saveLocalExport } from "@/lib/local-export";
import { prisma } from "@/lib/prisma";
import { normalizeConfiguredModels, parseConfiguredModelValue, type ProviderModelChannel } from "@/lib/provider-models";
import { readBoardAssetBytes, saveLocalAsset } from "@/lib/storage";
import { formatGenerationError } from "./generation-job-service";
import { createCliProxyProviderSetting } from "./lib/cliproxy";

export type CreateVideoGenerationInput = {
  boardId: string;
  boardName: string;
  model: string;
  prompt: string;
  providerSetting: ProviderSetting;
  referenceAssetIds?: string[];
  referenceMode?: VideoReferenceMode;
  user: { id: string; name: string | null; username: string | null };
  videoOptions?: {
    aspectRatio?: string;
    durationSec?: number;
    resolution?: string;
  };
};

export type CreatedVideoGenerationJob = {
  boardId: string;
  boardName: string;
  job: GenerationJob;
  model: string;
  prompt: string;
  providerSetting: ProviderSetting;
  referenceAssetIds: string[];
  referenceMode: VideoReferenceMode;
  user: { id: string; name: string | null; username: string | null };
  videoChannel: ProviderModelChannel;
  videoOptions: Required<NonNullable<CreateVideoGenerationInput["videoOptions"]>>;
};

export type VideoReferenceMode = "image" | "reference_images";
const CANCELLED_VIDEO_GENERATION_MESSAGE = "视频生成任务已中止";

export async function createAndRunVideoGenerationJob(input: CreateVideoGenerationInput) {
  const created = await createVideoGenerationJob(input);
  if (!created.ok) return created;
  return runCreatedVideoGenerationJob(created);
}

export async function createVideoGenerationJob(input: CreateVideoGenerationInput) {
  if (!input.providerSetting.enabled) {
    return { ok: false as const, error: "请配置第三方 API 或联系管理员授权使用当前 API", statusCode: 400 };
  }
  let providerSetting = input.providerSetting;
  let model: string;
  let videoChannel: ProviderModelChannel;
  try {
    const resolvedModel = resolveVideoModelSelection(input.providerSetting, input.model);
    model = resolvedModel.model;
    videoChannel = resolvedModel.channel;
    if (videoChannel === "cliproxy") {
      providerSetting = createCliProxyProviderSetting(input.providerSetting, model);
    }
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "视频模型通道配置无效", statusCode: 400 };
  }
  try {
    const videoOptions = normalizeVideoOptions(input.videoOptions);
    const linkedAssetIds = input.referenceAssetIds ?? [];
    const referenceMode = normalizeVideoReferenceMode(input.referenceMode, linkedAssetIds.length);
    if (linkedAssetIds.length > 0) {
      const linkedAssetCount = await prisma.asset.count({
        where: { boardId: input.boardId, id: { in: linkedAssetIds } },
      });
      if (linkedAssetCount !== linkedAssetIds.length) {
        return { ok: false as const, error: "Referenced asset not found", statusCode: 404 };
      }
    }
    const job = await prisma.generationJob.create({
      data: {
        boardId: input.boardId,
        mode: "text_to_video",
        paramsJson: JSON.stringify({
          model: input.model,
          providerRoute: videoChannel,
          providerDisplayName: providerSetting.displayName,
          providerBaseUrl: providerSetting.baseUrl ? "configured" : "default",
          referenceAssetIds: linkedAssetIds,
          referenceMode,
          runtimeModel: model,
          videoOptions,
        }),
        prompt: input.prompt,
        provider: providerSetting.provider,
        sourceAssetId: linkedAssetIds[0],
        status: "calling_model",
      },
    });
    return {
      ok: true as const,
      boardId: input.boardId,
      boardName: input.boardName,
      job,
      model,
      prompt: input.prompt,
      providerSetting,
      referenceAssetIds: linkedAssetIds,
      referenceMode,
      user: input.user,
      videoChannel,
      videoOptions,
    };
  } catch (error) {
    return {
      ok: false as const,
      error: formatGenerationError(error, {
        model: input.model,
        providerBaseUrl: providerSetting.baseUrl,
        providerBaseUrlConfigured: Boolean(providerSetting.baseUrl),
        providerDisplayName: providerSetting.displayName,
      }),
      statusCode: 500,
    };
  }
}

export async function runCreatedVideoGenerationJob(input: CreatedVideoGenerationJob) {
  try {
    const result = await runVideoGeneration(input);
    return { ok: true as const, ...result };
  } catch (error) {
    if (isVideoGenerationCancelledError(error)) {
      return { ok: false as const, error: CANCELLED_VIDEO_GENERATION_MESSAGE, job: input.job, statusCode: 409 };
    }
    const message = formatGenerationError(error, {
      model: input.model,
      providerBaseUrl: input.providerSetting.baseUrl,
      providerBaseUrlConfigured: Boolean(input.providerSetting.baseUrl),
      providerDisplayName: input.providerSetting.displayName,
    });
    if (message === CANCELLED_VIDEO_GENERATION_MESSAGE) {
      return { ok: false as const, error: message, job: input.job, statusCode: 409 };
    }
    await prisma.generationJob.update({ data: { errorMessage: message, status: "failed" }, where: { id: input.job.id } });
    return { ok: false as const, error: message, job: input.job, statusCode: 500 };
  }
}

export function resolveVideoModelSelection(providerSetting: ProviderSetting, selection: string) {
  const parsedSelection = parseConfiguredModelValue(selection);
  if (!parsedSelection.id.trim()) {
    throw new Error("视频模型 ID 不能为空");
  }
  const configuredModels = normalizeConfiguredModels(providerSetting.enabledVideoModels, providerSetting.videoModel ?? selection);
  const selectedModel = parsedSelection.channel
    ? configuredModels.find((item) =>
        item.enabled &&
        item.id === parsedSelection.id &&
        (item.channel ?? "provider") === parsedSelection.channel)
    : configuredModels.find((item) => item.enabled && item.id === parsedSelection.id && (item.channel ?? "provider") === "provider")
      ?? configuredModels.find((item) => item.enabled && item.id === parsedSelection.id);
  if (configuredModels.length > 0 && !selectedModel) {
    throw new Error("所选视频模型未在后台启用");
  }
  return {
    channel: selectedModel?.channel ?? parsedSelection.channel ?? "provider",
    model: parsedSelection.id,
  };
}

async function runVideoGeneration(input: CreatedVideoGenerationJob) {
  const openai = createOpenAIClient(input.providerSetting);
  const references = await Promise.all(input.referenceAssetIds.map((assetId) => readBoardAssetBytes(assetId, input.boardId)));
  const referenceImages = references
    .filter((reference) => reference.asset.mimeType.startsWith("image/"))
    .map((reference) => toDataUri(reference.bytes, reference.asset.mimeType));
  const imageFiles = await Promise.all(references
    .filter((reference) => reference.asset.mimeType.startsWith("image/"))
    .map((reference, index) => toFile(reference.bytes, `reference-${index + 1}.png`, { type: reference.asset.mimeType })));
  const body: Record<string, unknown> = {
    aspect_ratio: input.videoOptions.aspectRatio,
    duration: input.videoOptions.durationSec,
    model: input.model,
    prompt: input.prompt,
    resolution: input.videoOptions.resolution,
  };
  if (imageFiles.length > 0) body.input_reference = imageFiles;
  const video = await createVideoGeneration(openai, input.providerSetting, input.videoChannel, body, referenceImages, input.referenceMode);
  const providerJobId = readVideoJobId(video);
  if (!providerJobId) throw new Error("Video generation did not return a job id");
  await updateActiveVideoJob(input.job.id, {
    paramsJson: JSON.stringify({
      ...safeParseJsonObject(input.job.paramsJson),
      providerJobId,
      providerStatus: readVideoStatus(video),
    }),
  });
  const completed = await pollVideoJob(openai, input.providerSetting, input.videoChannel, providerJobId, input.job.id);
  await updateActiveVideoJob(input.job.id, {
    paramsJson: JSON.stringify({
      ...safeParseJsonObject(input.job.paramsJson),
      providerJobId,
      providerStatus: readVideoStatus(completed),
    }),
    status: "saving_results",
  });
  const response = await downloadGeneratedVideo(openai, input.providerSetting, input.videoChannel, providerJobId, completed);
  await assertVideoJobActive(input.job.id);
  const bytes = Buffer.from(await response.arrayBuffer());
  const filename = createProjectTimestampFilename(input.boardName, "mp4", {
    date: input.job.createdAt,
    username: input.user.username ?? input.user.name,
  });
  await saveLocalExport({ bytes, filename, projectName: input.boardName });
  await assertVideoJobActive(input.job.id);
  const asset = await saveLocalAsset({
    boardId: input.boardId,
    bytes,
    filename,
    kind: "generated",
    mimeType: readContentType(response) || "video/mp4",
  });
  await assertVideoJobActive(input.job.id);
  await prisma.$transaction(async (tx) => {
    const update = await tx.generationJob.updateMany({
      data: { status: "succeeded" },
      where: { id: input.job.id, status: { not: "cancelled" } },
    });
    if (update.count === 0) throw new Error(CANCELLED_VIDEO_GENERATION_MESSAGE);
    await tx.generationResult.create({ data: { assetId: asset.id, jobId: input.job.id } });
  });
  const updatedJob = await prisma.generationJob.findUnique({
    include: { results: { include: { asset: true } } },
    where: { id: input.job.id },
  });
  return { asset, job: updatedJob ?? input.job, providerJobId };
}

async function updateActiveVideoJob(jobId: string, data: { paramsJson?: string; status?: string }) {
  const result = await prisma.generationJob.updateMany({
    data,
    where: { id: jobId, status: { not: "cancelled" } },
  });
  if (result.count === 0) throw new Error(CANCELLED_VIDEO_GENERATION_MESSAGE);
}

async function assertVideoJobActive(jobId: string) {
  const job = await prisma.generationJob.findUnique({ select: { status: true }, where: { id: jobId } });
  if (job?.status === "cancelled") throw new Error(CANCELLED_VIDEO_GENERATION_MESSAGE);
}

function isVideoGenerationCancelledError(error: unknown) {
  return error instanceof Error && error.message === CANCELLED_VIDEO_GENERATION_MESSAGE;
}

async function createVideoGeneration(
  openai: ReturnType<typeof createOpenAIClient>,
  providerSetting: ProviderSetting,
  videoChannel: ProviderModelChannel,
  body: Record<string, unknown>,
  referenceImages: string[],
  referenceMode: VideoReferenceMode,
) {
  if (videoChannel === "cliproxy") {
    return postCliProxyVideoGeneration(providerSetting, "/videos/generations", toCliProxyVideoRequestBody(body, referenceImages, referenceMode));
  }
  try {
    return await openai.videos.create(body as never);
  } catch (error) {
    if (!shouldFallbackToCliProxyVideoEndpoint(error)) throw error;
    const fallbackBody = toCliProxyVideoRequestBody(body, referenceImages, referenceMode);
    return postCliProxyVideoGeneration(providerSetting, "/videos/generations", fallbackBody);
  }
}

async function pollVideoJob(openai: ReturnType<typeof createOpenAIClient>, providerSetting: ProviderSetting, videoChannel: ProviderModelChannel, videoId: string, jobId: string) {
  const pollIntervalMs = getPositiveInteger(process.env.VIDEO_GENERATION_POLL_INTERVAL_MS, 5000);
  const maxAttempts = getPositiveInteger(process.env.VIDEO_GENERATION_MAX_POLL_ATTEMPTS, 120);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await assertVideoJobActive(jobId);
    const video = await retrieveVideoJob(openai, providerSetting, videoChannel, videoId);
    const status = readVideoStatus(video);
    if (isCompletedVideoStatus(status)) return video;
    if (isFailedVideoStatus(status)) {
      throw new Error(`Video generation failed with status ${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error("Video generation timed out before completion");
}

async function retrieveVideoJob(openai: ReturnType<typeof createOpenAIClient>, providerSetting: ProviderSetting, videoChannel: ProviderModelChannel, videoId: string) {
  if (videoChannel === "cliproxy") {
    return getCliProxyVideoJob(providerSetting, videoId, "/videos");
  }
  try {
    return await openai.videos.retrieve(videoId);
  } catch (error) {
    if (!shouldFallbackToCliProxyVideoEndpoint(error)) throw error;
    return getCliProxyVideoJob(providerSetting, videoId, "/videos");
  }
}

async function downloadGeneratedVideo(
  openai: ReturnType<typeof createOpenAIClient>,
  providerSetting: ProviderSetting,
  videoChannel: ProviderModelChannel,
  videoId: string,
  completed: unknown,
) {
  const resultUrl = getVideoResultUrl(completed);
  if (resultUrl) {
    return fetchVideoUrl(providerSetting, resultUrl);
  }
  if (videoChannel === "cliproxy") {
    const latest = await getCliProxyVideoJob(providerSetting, videoId, "/videos");
    const latestResultUrl = getVideoResultUrl(latest);
    if (!latestResultUrl) throw new Error("Video generation did not return a downloadable video URL");
    return fetchVideoUrl(providerSetting, latestResultUrl);
  }
  try {
    return await openai.videos.downloadContent(videoId);
  } catch (error) {
    if (!shouldFallbackToCliProxyVideoEndpoint(error)) throw error;
    const latest = await getCliProxyVideoJob(providerSetting, videoId, "/videos");
    const latestResultUrl = getVideoResultUrl(latest);
    if (!latestResultUrl) throw error;
    return fetchVideoUrl(providerSetting, latestResultUrl);
  }
}

async function postCliProxyVideoGeneration(providerSetting: ProviderSetting, path: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetchOpenAICompatible(providerSetting, path, {
    body: JSON.stringify(body),
    method: "POST",
  });
  if (response.status === 404 || response.status === 405) {
    const legacyResponse = await fetchOpenAICompatible(providerSetting, "/video/generations", {
      body: JSON.stringify(body),
      method: "POST",
    });
    return readJsonResponse(legacyResponse);
  }
  return readJsonResponse(response);
}

async function getCliProxyVideoJob(providerSetting: ProviderSetting, videoId: string, pathPrefix: "/video/generations" | "/videos"): Promise<unknown> {
  const response = await fetchOpenAICompatible(providerSetting, `${pathPrefix}/${encodeURIComponent(videoId)}`, { method: "GET" });
  if (response.status === 404 && pathPrefix === "/videos") {
    const legacyResponse = await fetchOpenAICompatible(providerSetting, `/video/generations/${encodeURIComponent(videoId)}`, { method: "GET" });
    return readJsonResponse(legacyResponse);
  }
  return readJsonResponse(response);
}

async function fetchOpenAICompatible(providerSetting: ProviderSetting, path: string, init: RequestInit) {
  const response = await fetch(`${trimTrailingSlash(providerSetting.baseUrl || "https://api.openai.com/v1")}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${providerSetting.apiKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  return response;
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  const payload = text ? safeParseJson(text) : {};
  if (!response.ok) {
    throw new Error(readResponseError(payload, `Video endpoint returned ${response.status} status code`));
  }
  return payload;
}

async function fetchVideoUrl(providerSetting: ProviderSetting, url: string) {
  const shouldSendAuth = isSameOrigin(url, providerSetting.baseUrl || "https://api.openai.com/v1");
  const response = await fetch(url, {
    ...(shouldSendAuth ? { headers: { Authorization: `Bearer ${providerSetting.apiKey}` } } : {}),
  });
  if (!response.ok) {
    throw new Error(`Video download returned ${response.status} status code`);
  }
  return response;
}

function toDataUri(bytes: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function readContentType(response: Response) {
  return response.headers.get("content-type")?.split(";")[0]?.trim() || "";
}

function readStringField(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : "";
}

function readVideoJobId(value: unknown) {
  return readStringField(value, "id")
    || readStringField(value, "request_id")
    || readStringField(value, "task_id")
    || readStringField(value, "job_id");
}

function readVideoStatus(value: unknown) {
  return readStringField(value, "status") || readStringField(value, "state");
}

function isCompletedVideoStatus(status: string) {
  return ["completed", "done", "succeeded", "success"].includes(status.toLowerCase());
}

function isFailedVideoStatus(status: string) {
  return ["cancelled", "canceled", "error", "failed"].includes(status.toLowerCase());
}

function readResponseError(value: unknown, fallback: string) {
  if (isRecord(value)) {
    if (typeof value.error === "string") return value.error;
    if (isRecord(value.error) && typeof value.error.message === "string") return value.error.message;
    if (typeof value.message === "string") return value.message;
  }
  return fallback;
}

function getVideoResultUrl(value: unknown): string {
  if (!isRecord(value)) return "";
  const candidates = [
    value.url,
    value.download_url,
    value.output_url,
    value.video_url,
    value.video,
    isRecord(value.video) ? value.video.url : undefined,
    isRecord(value.metadata) ? value.metadata.url : undefined,
    isRecord(value.result) ? value.result.url : undefined,
  ];
  const data = Array.isArray(value.data) ? value.data[0] : undefined;
  if (isRecord(data)) {
    candidates.push(data.url, data.download_url, data.output_url, data.video_url);
  }
  const output = Array.isArray(value.output) ? value.output[0] : undefined;
  if (isRecord(output)) {
    candidates.push(output.url, output.download_url, output.output_url, output.video_url);
  }
  return candidates.find((candidate): candidate is string => typeof candidate === "string" && isAbsoluteHttpUrl(candidate)) ?? "";
}

function toCliProxyVideoRequestBody(body: Record<string, unknown>, referenceImages: string[], referenceMode: VideoReferenceMode) {
  const fallbackBody: Record<string, unknown> = {
    aspect_ratio: body.aspect_ratio,
    duration: body.duration,
    model: body.model,
    prompt: body.prompt,
    resolution: body.resolution,
  };
  if (referenceImages.length > 0) {
    if (referenceMode === "reference_images") {
      fallbackBody.reference_images = referenceImages.map((url) => ({ url })).slice(0, 7);
    } else {
      fallbackBody.image = { url: referenceImages[0] };
    }
  }
  return fallbackBody;
}

function normalizeVideoReferenceMode(mode: CreateVideoGenerationInput["referenceMode"], referenceCount: number): VideoReferenceMode {
  if (referenceCount <= 0) return "image";
  if (mode === "reference_images") return "reference_images";
  return "image";
}

function normalizeVideoOptions(options: CreateVideoGenerationInput["videoOptions"]): Required<NonNullable<CreateVideoGenerationInput["videoOptions"]>> {
  return {
    aspectRatio: isAllowedVideoAspectRatio(options?.aspectRatio) ? options.aspectRatio : "9:16",
    durationSec: options?.durationSec === 10 ? 10 : 6,
    resolution: options?.resolution === "480p" ? "480p" : "720p",
  };
}

function isAllowedVideoAspectRatio(value: string | undefined) {
  return value === "1:1"
    || value === "16:9"
    || value === "9:16"
    || value === "3:2"
    || value === "2:3";
}

function shouldFallbackToCliProxyVideoEndpoint(error: unknown) {
  const status = getErrorNumber(error, "status") ?? getErrorNumber(error, "statusCode");
  if (status === 404 || status === 405) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return [
    "method not allowed",
    "endpoint not found",
    "route not found",
    "unknown endpoint",
    "unknown url",
    "invalid url",
    "not implemented",
    "/videos",
    "videos endpoint",
  ].some((fallbackMessage) => message.includes(fallbackMessage));
}

function getErrorNumber(error: unknown, key: string) {
  if (!isRecord(error)) return undefined;
  const value = error[key];
  return typeof value === "number" ? value : undefined;
}

function safeParseJsonObject(value: string | null) {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function isAbsoluteHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isSameOrigin(value: string, baseUrl: string) {
  try {
    return new URL(value).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
