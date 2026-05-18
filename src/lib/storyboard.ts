import { z } from "zod";

import {
  getPlatformPreset,
  isPlatformPresetId,
  type PlatformLocale,
  type PlatformPresetId,
} from "./platform-copywriting-presets";

export const storyboardShotStatuses = [
  "draft",
  "script_ready",
  "prompts_ready",
  "frames_ready",
  "needs_revision",
  "approved",
] as const;

export type StoryboardShotStatus = (typeof storyboardShotStatuses)[number];

export const storyboardContentTypes = ["product", "tutorial", "ugc", "story", "brand", "ad"] as const;
export type StoryboardContentType = (typeof storyboardContentTypes)[number];

export type StoryboardBrief = {
  targetPlatform: PlatformPresetId;
  contentType: StoryboardContentType;
  locale: PlatformLocale;
  durationSec: number;
  aspectRatio: string;
  topic: string;
  audience: string;
  sellingPoints: string;
  tone: string;
  constraints: string;
};

export type StoryboardShotInput = {
  id?: string;
  shotIndex?: number;
  durationSec?: number;
  scene?: string;
  camera?: string;
  action?: string;
  dialogue?: string;
  caption?: string;
  audio?: string;
  startFrameAssetId?: string | null;
  endFrameAssetId?: string | null;
  startFramePrompt?: string;
  endFramePrompt?: string;
  videoPrompt?: string;
  status?: StoryboardShotStatus;
  metadata?: Record<string, unknown>;
};

export type StoryboardShot = {
  id?: string;
  shotIndex: number;
  durationSec: number;
  scene: string;
  camera: string;
  action: string;
  dialogue: string;
  caption: string;
  audio: string;
  startFrameAssetId: string | null;
  endFrameAssetId: string | null;
  startFramePrompt: string;
  endFramePrompt: string;
  videoPrompt: string;
  status: StoryboardShotStatus;
  metadata: Record<string, unknown>;
};

export type PersistedStoryboardShot = StoryboardShot & { id: string };

export type StoryboardGenerationResult = {
  title: string;
  scriptText: string;
  shots: StoryboardShot[];
};

export type ShotPromptOutput = {
  startFramePrompt: string;
  endFramePrompt: string;
  videoPrompt: string;
  notes: string[];
};

export type StoryboardFrameAssetContext = {
  assetId: string;
  kind: string;
  width: number | null;
  height: number | null;
  tags: string[];
  sourcePrompt: string;
};

export type StoryboardFrameContext = {
  startFrameAsset?: StoryboardFrameAssetContext;
  endFrameAsset?: StoryboardFrameAssetContext;
};

export const storyboardPromptFields = ["startFramePrompt", "endFramePrompt", "videoPrompt"] as const;
export type StoryboardPromptField = (typeof storyboardPromptFields)[number];
export type StoryboardPromptLocks = Record<StoryboardPromptField, boolean>;

export const storyboardBriefSchema = z.object({
  targetPlatform: z.string().transform(parsePlatformPresetId).default("douyin"),
  contentType: z.enum(storyboardContentTypes).default("product"),
  locale: z.enum(["zh-CN", "en-US", "bilingual"]).optional(),
  durationSec: z.number().int().min(6).max(180).default(30),
  aspectRatio: z.string().trim().min(1).max(20).default("9:16"),
  topic: z.string().trim().max(500).default(""),
  audience: z.string().trim().max(500).default(""),
  sellingPoints: z.string().trim().max(1000).default(""),
  tone: z.string().trim().max(200).default(""),
  constraints: z.string().trim().max(1000).default(""),
});

export const storyboardBriefPatchSchema = z.object({
  targetPlatform: z.string().transform(parsePlatformPresetId).optional(),
  contentType: z.enum(storyboardContentTypes).optional(),
  locale: z.enum(["zh-CN", "en-US", "bilingual"]).optional(),
  durationSec: z.number().int().min(6).max(180).optional(),
  aspectRatio: z.string().trim().min(1).max(20).optional(),
  topic: z.string().trim().max(500).optional(),
  audience: z.string().trim().max(500).optional(),
  sellingPoints: z.string().trim().max(1000).optional(),
  tone: z.string().trim().max(200).optional(),
  constraints: z.string().trim().max(1000).optional(),
});

export const storyboardShotInputSchema = z.object({
  id: z.string().optional(),
  shotIndex: z.number().int().optional(),
  durationSec: z.number().int().optional(),
  scene: z.string().trim().max(1000).optional(),
  camera: z.string().trim().max(500).optional(),
  action: z.string().trim().max(1000).optional(),
  dialogue: z.string().trim().max(1000).optional(),
  caption: z.string().trim().max(500).optional(),
  audio: z.string().trim().max(500).optional(),
  startFrameAssetId: z.string().trim().min(1).max(200).nullable().optional(),
  endFrameAssetId: z.string().trim().min(1).max(200).nullable().optional(),
  startFramePrompt: z.string().trim().max(4000).optional(),
  endFramePrompt: z.string().trim().max(4000).optional(),
  videoPrompt: z.string().trim().max(4000).optional(),
  status: z.enum(storyboardShotStatuses).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const storyboardShotPatchSchema = storyboardShotInputSchema.omit({ id: true, shotIndex: true }).partial();

export function normalizeStoryboardBrief(input: unknown): StoryboardBrief {
  const result = storyboardBriefSchema.safeParse(input);
  const parsed = result.success ? result.data : storyboardBriefSchema.parse({});
  const preset = getPlatformPreset(parsed.targetPlatform);

  return {
    targetPlatform: parsed.targetPlatform,
    contentType: parsed.contentType,
    locale: parsed.locale ?? preset.locale,
    durationSec: parsed.durationSec,
    aspectRatio: parsed.aspectRatio,
    topic: parsed.topic,
    audience: parsed.audience,
    sellingPoints: parsed.sellingPoints,
    tone: parsed.tone,
    constraints: parsed.constraints,
  };
}

export function normalizeStoryboardShotInput(input: unknown): StoryboardShot {
  const parsed = storyboardShotInputSchema.catch({}).parse(input);

  return {
    ...(parsed.id ? { id: parsed.id } : {}),
    shotIndex: Math.max(1, parsed.shotIndex ?? 1),
    durationSec: parsed.durationSec && parsed.durationSec > 0 ? parsed.durationSec : 3,
    scene: parsed.scene ?? "",
    camera: parsed.camera ?? "",
    action: parsed.action ?? "",
    dialogue: parsed.dialogue ?? "",
    caption: parsed.caption ?? "",
    audio: parsed.audio ?? "",
    startFrameAssetId: parsed.startFrameAssetId ?? null,
    endFrameAssetId: parsed.endFrameAssetId ?? null,
    startFramePrompt: parsed.startFramePrompt ?? "",
    endFramePrompt: parsed.endFramePrompt ?? "",
    videoPrompt: parsed.videoPrompt ?? "",
    status: getValidStoryboardShotStatus(parsed.status),
    metadata: normalizeStoryboardShotMetadata(parsed.metadata),
  };
}

export function normalizeStoryboardPromptLocks(value: unknown): StoryboardPromptLocks {
  const locks = isRecord(value) ? value : {};
  return {
    startFramePrompt: locks.startFramePrompt === true,
    endFramePrompt: locks.endFramePrompt === true,
    videoPrompt: locks.videoPrompt === true,
  };
}

export function normalizeStoryboardShotMetadata(value: unknown): Record<string, unknown> {
  const metadata = isRecord(value) ? { ...value } : {};
  metadata.promptLocks = normalizeStoryboardPromptLocks(metadata.promptLocks);
  return metadata;
}

export function getValidStoryboardShotStatus(value: unknown): StoryboardShotStatus {
  return typeof value === "string" && storyboardShotStatuses.includes(value as StoryboardShotStatus)
    ? (value as StoryboardShotStatus)
    : "draft";
}

export function parseStoryboardGenerationOutput(value: string): StoryboardGenerationResult {
  const parsed = parseJsonObject(cleanModelJson(value));
  const shots = Array.isArray(parsed.shots) ? parsed.shots : [];

  return {
    title: typeof parsed.title === "string" ? parsed.title.trim() : "",
    scriptText: typeof parsed.scriptText === "string" ? parsed.scriptText.trim() : "",
    shots: shots.map((shot, index) =>
      normalizeStoryboardShotInput({
        ...(isRecord(shot) ? shot : {}),
        shotIndex: index + 1,
        status: isRecord(shot) ? getValidStoryboardShotStatus(shot.status) : "draft",
      }),
    ),
  };
}

export function parseShotPromptOutput(value: string): ShotPromptOutput {
  const parsed = parseJsonObject(cleanModelJson(value));

  return {
    startFramePrompt: readCleanString(parsed.startFramePrompt),
    endFramePrompt: readCleanString(parsed.endFramePrompt),
    videoPrompt: readCleanString(parsed.videoPrompt),
    notes: cleanStringArray(parsed.notes),
  };
}

export function reorderStoryboardShots<T extends StoryboardShot>(shots: T[], orderedShotIds: string[]): T[] {
  const existingIds = shots.map((shot) => shot.id).filter((id): id is string => Boolean(id));
  if (existingIds.length !== shots.length) {
    throw new Error("All storyboard shots must have ids before reorder");
  }
  const existingIdSet = new Set(existingIds);
  const orderedIdSet = new Set(orderedShotIds);
  if (orderedShotIds.length !== shots.length || orderedIdSet.size !== existingIdSet.size) {
    throw new Error("Reorder must include the same shot ids");
  }
  for (const id of orderedShotIds) {
    if (!existingIdSet.has(id)) {
      throw new Error("Reorder must include the same shot ids");
    }
  }

  const byId = new Map(shots.map((shot) => [shot.id, shot] as const));
  return orderedShotIds.map((id, index) => ({ ...byId.get(id), shotIndex: index + 1 }) as T);
}

export function buildStoryboardGenerationInstruction(input: { brief: StoryboardBrief; scriptText: string }): string {
  const preset = getPlatformPreset(input.brief.targetPlatform);
  const languageRule =
    input.brief.locale === "zh-CN"
      ? "Use Chinese for script, captions, and prompt text."
      : input.brief.locale === "en-US"
        ? "Use English for script, captions, and prompt text."
        : "Use bilingual Chinese and English only when it improves platform fit.";

  return [
    "You are a senior short-video creative director and storyboard planner.",
    `Platform: ${preset.label}`,
    `Platform hook strategy: ${preset.hookGuidance}`,
    `Caption strategy: ${preset.captionGuidance}`,
    `Storyboard strategy: ${preset.storyboardGuidance}`,
    `Visual strategy: ${preset.visualGuidance}`,
    `Compliance notes: ${preset.complianceNotes.join("; ")}`,
    `Content type: ${input.brief.contentType}`,
    `Target duration: ${input.brief.durationSec}s`,
    `Aspect ratio: ${input.brief.aspectRatio}`,
    `Topic: ${input.brief.topic}`,
    `Audience: ${input.brief.audience}`,
    `Selling points: ${input.brief.sellingPoints}`,
    `Tone: ${input.brief.tone}`,
    `Constraints: ${input.brief.constraints}`,
    languageRule,
    "Turn the copy into a structured storyboard with 3-12 shots. Each shot should have durationSec, scene, camera, action, dialogue, caption, and audio.",
    "Return only JSON. Do not include Markdown.",
    'Output shape: {"title":"...","scriptText":"...","shots":[{"durationSec":3,"scene":"...","camera":"...","action":"...","dialogue":"...","caption":"...","audio":"..."}]}',
    "User copy:",
    "<<<SCRIPT",
    input.scriptText.trim(),
    "SCRIPT>>>",
  ].join("\n");
}

export function buildShotPromptInstruction(input: {
  brief: StoryboardBrief;
  frameContext?: StoryboardFrameContext;
  shot: StoryboardShot;
}): string {
  const preset = getPlatformPreset(input.brief.targetPlatform);
  const outputLabels =
    input.brief.locale === "zh-CN" || input.brief.locale === "bilingual"
      ? ["首帧提示词", "尾帧提示词", "视频生成提示词"]
      : ["Start-frame prompt", "End-frame prompt", "Video generation prompt"];
  const frameContextLines = formatFrameContextLines(input.frameContext);

  return [
    "你是一名短视频分镜与图像/视频生成提示词导演。",
    `平台：${preset.label}`,
    `平台视觉策略：${preset.visualGuidance}`,
    `平台分镜策略：${preset.storyboardGuidance}`,
    `主题：${input.brief.topic}`,
    `受众：${input.brief.audience}`,
    `卖点：${input.brief.sellingPoints}`,
    `限制：${input.brief.constraints}`,
    `镜头编号：${input.shot.shotIndex}`,
    `时长：${input.shot.durationSec}s`,
    `场景：${input.shot.scene}`,
    `机位：${input.shot.camera}`,
    `动作：${input.shot.action}`,
    `台词：${input.shot.dialogue}`,
    `字幕：${input.shot.caption}`,
    `音频：${input.shot.audio}`,
    ...frameContextLines,
    "请生成三段可执行提示词，保持主体、产品、角色和场景连续。",
    `${outputLabels[0]}：描述镜头开始瞬间的静态画面，可用于生成第一帧。`,
    `${outputLabels[1]}：描述镜头结束瞬间的静态画面，可用于生成尾帧。`,
    `${outputLabels[2]}：描述从首帧到尾帧的运动、镜头、节奏和变化；当前仅保存提示词，不调用视频模型。`,
    "只输出 JSON，不要 Markdown。",
    '格式：{"startFramePrompt":"...","endFramePrompt":"...","videoPrompt":"...","notes":["..."]}',
  ].join("\n");
}

function formatFrameContextLines(context: StoryboardFrameContext | undefined) {
  const lines: string[] = [];
  if (context?.startFrameAsset) {
    lines.push("已绑定首帧参考素材：", ...formatFrameAssetContext(context.startFrameAsset));
  }
  if (context?.endFrameAsset) {
    lines.push("已绑定尾帧参考素材：", ...formatFrameAssetContext(context.endFrameAsset));
  }
  if (lines.length > 0) {
    lines.push("生成提示词时必须延续已绑定参考素材中的主体、构图、产品/角色身份和画面连续性；不要与绑定素材冲突。");
  }
  return lines;
}

function formatFrameAssetContext(asset: StoryboardFrameAssetContext) {
  return [
    `- 素材ID：${asset.assetId}`,
    `- 类型：${asset.kind}`,
    `- 尺寸：${asset.width && asset.height ? `${asset.width}x${asset.height}` : "未记录"}`,
    asset.tags.length > 0 ? `- 标签：${asset.tags.join(", ")}` : "",
    asset.sourcePrompt ? `- 原始生成/反推提示词：${asset.sourcePrompt}` : "",
  ].filter(Boolean);
}

function parsePlatformPresetId(value: string): PlatformPresetId {
  return isPlatformPresetId(value) ? value : "douyin";
}

function cleanModelJson(value: string): string {
  let text = value.trim();
  const fenceMatch = text.match(/^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```$/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }
  return text;
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readCleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
