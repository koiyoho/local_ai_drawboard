import { GPT_IMAGE_SIZE_LIMITS, isValidImageSize, type ImageSize } from "./image";

export type BoardAspectRatio = "auto" | "16:9" | "4:3" | "3:2" | "2:1" | "21:9" | "1:1" | "3:4" | "4:5" | "2:3" | "9:16" | "1:2" | "9:21";
export type BoardQuality = "1k" | "2k" | "4k";
export type BoardArtStyle = "auto" | "realistic" | "illustration" | "anime" | "watercolor";

export const boardAspectRatioOptions: Array<{
  value: BoardAspectRatio;
  label: string;
  appIcon: string;
  appIconTone: "banner" | "photo" | "rednote" | "video" | "story";
  usageTitle: string;
  visualHeight: number;
  visualWidth: number;
}> = [
  { value: "auto", label: "自动", appIcon: "Auto", appIconTone: "photo", usageTitle: "跟随源图比例", visualHeight: 12, visualWidth: 16 },
  { value: "21:9", label: "21:9", appIcon: "Ad", appIconTone: "banner", usageTitle: "超宽横幅 / 展示页头图", visualHeight: 9, visualWidth: 21 },
  { value: "2:1", label: "2:1", appIcon: "We", appIconTone: "banner", usageTitle: "社媒头图 / 活动 Banner", visualHeight: 10, visualWidth: 20 },
  { value: "16:9", label: "16:9", appIcon: "▶", appIconTone: "video", usageTitle: "视频封面 / 横版内容", visualHeight: 9, visualWidth: 16 },
  { value: "3:2", label: "3:2", appIcon: "Cam", appIconTone: "photo", usageTitle: "摄影图 / 商品横图", visualHeight: 12, visualWidth: 18 },
  { value: "4:3", label: "4:3", appIcon: "Web", appIconTone: "photo", usageTitle: "传统展示图 / 平板画面", visualHeight: 12, visualWidth: 16 },
  { value: "1:1", label: "1:1", appIcon: "IG", appIconTone: "story", usageTitle: "头像 / 方形社媒贴文", visualHeight: 15, visualWidth: 15 },
  { value: "4:5", label: "4:5", appIcon: "RED", appIconTone: "rednote", usageTitle: "小红书 / Instagram 竖版贴文", visualHeight: 18, visualWidth: 14 },
  { value: "3:4", label: "3:4", appIcon: "Post", appIconTone: "photo", usageTitle: "竖版海报 / 商品图", visualHeight: 18, visualWidth: 13 },
  { value: "2:3", label: "2:3", appIcon: "Pin", appIconTone: "rednote", usageTitle: "竖版封面 / 详情页主图", visualHeight: 20, visualWidth: 13 },
  { value: "9:16", label: "9:16", appIcon: "抖", appIconTone: "video", usageTitle: "抖音 / 快手 / Reels / Story", visualHeight: 21, visualWidth: 12 },
  { value: "1:2", label: "1:2", appIcon: "Ad", appIconTone: "banner", usageTitle: "信息流长图 / 竖版广告", visualHeight: 22, visualWidth: 11 },
  { value: "9:21", label: "9:21", appIcon: "St", appIconTone: "story", usageTitle: "手机长屏 / 超长竖图", visualHeight: 23, visualWidth: 10 },
];

export const boardQualityOptions: Array<{ value: BoardQuality; label: string }> = [
  { value: "1k", label: "1K" },
  { value: "2k", label: "2K" },
  { value: "4k", label: "4K" },
];

export const boardArtStyleOptions: Array<{
  value: BoardArtStyle;
  label: string;
  instruction: string;
  previewUrl: string;
}> = [
  { value: "auto", label: "智能推荐", instruction: "", previewUrl: "/style-previews/auto.png" },
  { value: "realistic", label: "写实", instruction: "写实摄影质感，自然光照，真实材质细节，镜头感明确。", previewUrl: "/style-previews/realistic.png" },
  { value: "illustration", label: "插画", instruction: "精致插画风格，形体概括清晰，色彩层次丰富，画面完成度高。", previewUrl: "/style-previews/illustration.png" },
  { value: "anime", label: "二次元", instruction: "二次元动画风格，干净线稿，角色表现力强，色彩明快。", previewUrl: "/style-previews/anime.png" },
  { value: "watercolor", label: "水彩", instruction: "水彩质感，柔和颜料边缘，纸张肌理，清透层次。", previewUrl: "/style-previews/watercolor.png" },
];

const aspectQualitySizeMap: Record<BoardAspectRatio, Partial<Record<BoardQuality, ImageSize>>> = {
  auto: { "2k": "2048x1152" },
  "16:9": { "1k": "1536x864", "2k": "2048x1152", "4k": "3840x2160" },
  "4:3": { "1k": "1024x768", "2k": "2048x1536" },
  "3:2": { "1k": "1536x1024", "2k": "2048x1360" },
  "1:1": { "1k": "1024x1024", "2k": "2048x2048", "4k": "2880x2880" },
  "3:4": { "1k": "768x1024", "2k": "1536x2048" },
  "9:16": { "1k": "864x1536", "2k": "1152x2048", "4k": "2160x3840" },
  "4:5": { "1k": "1024x1280", "2k": "2048x2560" },
  "2:3": { "1k": "1024x1536", "2k": "1360x2048" },
  "21:9": { "1k": "1792x768", "4k": "3840x1648" },
  "2:1": { "2k": "2048x1024", "4k": "3840x1920" },
  "9:21": { "1k": "768x1792", "4k": "1648x3840" },
  "1:2": { "2k": "1024x2048", "4k": "1920x3840" },
};

export function getImageSizeForAspectQuality(aspect: BoardAspectRatio, quality: BoardQuality): ImageSize {
  if (aspect === "auto") return aspectQualitySizeMap.auto["2k"] ?? "2048x1152";
  const size = aspectQualitySizeMap[aspect][quality];
  if (size) return size;
  const fallback = getAvailableQualityOptions(aspect)[0]?.size;
  return fallback ?? "1024x1024";
}

export function getAvailableQualityOptions(aspect: BoardAspectRatio) {
  const sizes = aspectQualitySizeMap[aspect];
  return boardQualityOptions
    .map((option) => ({ ...option, size: sizes[option.value] }))
    .filter((option): option is typeof option & { size: ImageSize } => Boolean(option.size));
}

export function getAspectFromImageSize(size: ImageSize): BoardAspectRatio {
  for (const [aspect, qualityMap] of Object.entries(aspectQualitySizeMap)) {
    if (aspect === "auto") continue;
    if (Object.values(qualityMap).includes(size)) return aspect as BoardAspectRatio;
  }
  return "auto";
}

export function getQualityFromImageSize(size: ImageSize): BoardQuality {
  for (const qualityMap of Object.values(aspectQualitySizeMap)) {
    for (const [quality, mappedSize] of Object.entries(qualityMap)) {
      if (mappedSize === size) return quality as BoardQuality;
    }
  }
  return "1k";
}

export function getBoardAspectRatioSelection(value: unknown): BoardAspectRatio | undefined {
  return boardAspectRatioOptions.some((option) => option.value === value)
    ? value as BoardAspectRatio
    : undefined;
}

export function appendArtStyleInstruction(prompt: string, artStyle: BoardArtStyle) {
  const option = boardArtStyleOptions.find((item) => item.value === artStyle);
  if (!option?.instruction) return prompt;
  return `${prompt.trim()}\n\n画风要求：${option.instruction}`;
}

export function getImageSizeForSourceAspect(size: { width?: number | null; height?: number | null }): ImageSize {
  const sourceWidth = getPositiveNumber(size.width);
  const sourceHeight = getPositiveNumber(size.height);
  if (!sourceWidth || !sourceHeight) return getImageSizeForAspectQuality("16:9", "2k");

  const rounded = normalizeDimensionsToImageLimits(sourceWidth, sourceHeight);
  return `${rounded.width}x${rounded.height}` as ImageSize;
}

function normalizeDimensionsToImageLimits(width: number, height: number) {
  const ratio = width / height;
  const clampedRatio = Math.min(
    GPT_IMAGE_SIZE_LIMITS.maxRatio,
    Math.max(1 / GPT_IMAGE_SIZE_LIMITS.maxRatio, ratio),
  );
  const currentPixels = width * height;
  const targetPixels = Math.min(
    GPT_IMAGE_SIZE_LIMITS.maxPixels,
    Math.max(GPT_IMAGE_SIZE_LIMITS.minPixels, currentPixels),
  );
  let normalizedWidth = Math.sqrt(targetPixels * clampedRatio);
  let normalizedHeight = normalizedWidth / clampedRatio;
  const longEdge = Math.max(normalizedWidth, normalizedHeight);
  if (longEdge > GPT_IMAGE_SIZE_LIMITS.maxEdge) {
    const scale = GPT_IMAGE_SIZE_LIMITS.maxEdge / longEdge;
    normalizedWidth *= scale;
    normalizedHeight *= scale;
  }
  const candidates = getImageSizeCandidates(normalizedWidth, normalizedHeight);
  return candidates.find((candidate) => isValidImageSize(`${candidate.width}x${candidate.height}`)) ?? {
    height: 1152,
    width: 2048,
  };
}

function getImageSizeCandidates(width: number, height: number) {
  const roundedWidth = roundToMultiple(width, GPT_IMAGE_SIZE_LIMITS.multiple);
  const roundedHeight = roundToMultiple(height, GPT_IMAGE_SIZE_LIMITS.multiple);
  const floorWidth = floorToMultiple(width, GPT_IMAGE_SIZE_LIMITS.multiple);
  const floorHeight = floorToMultiple(height, GPT_IMAGE_SIZE_LIMITS.multiple);
  const ceilWidth = ceilToMultiple(width, GPT_IMAGE_SIZE_LIMITS.multiple);
  const ceilHeight = ceilToMultiple(height, GPT_IMAGE_SIZE_LIMITS.multiple);
  const candidates = [
    { height: roundedHeight, width: roundedWidth },
    { height: ceilHeight, width: ceilWidth },
    { height: floorHeight, width: floorWidth },
    { height: roundedHeight, width: ceilWidth },
    { height: ceilHeight, width: roundedWidth },
    { height: roundedHeight, width: floorWidth },
    { height: floorHeight, width: roundedWidth },
  ];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.width}x${candidate.height}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function roundToMultiple(value: number, multiple: number) {
  return Math.max(multiple, Math.round(value / multiple) * multiple);
}

function floorToMultiple(value: number, multiple: number) {
  return Math.max(multiple, Math.floor(value / multiple) * multiple);
}

function ceilToMultiple(value: number, multiple: number) {
  return Math.max(multiple, Math.ceil(value / multiple) * multiple);
}

function getPositiveNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
