export const imageSizeOptions = [
  {
    value: "auto",
    aspect: "auto",
    label: "自动分辨率",
    resolution: "auto",
  },
  {
    value: "1024x1024",
    aspect: "square",
    label: "1K · 1024 x 1024",
    resolution: "1024 x 1024",
  },
  {
    value: "1088x1088",
    aspect: "square",
    label: "1:1 社媒方图 · 1088 x 1088",
    resolution: "1088 x 1088",
  },
  {
    value: "2048x2048",
    aspect: "square",
    label: "2K · 2048 x 2048",
    resolution: "2048 x 2048",
  },
  {
    value: "2880x2880",
    aspect: "square",
    label: "1:1 最大方图 · 2880 x 2880",
    resolution: "2880 x 2880",
  },
  {
    value: "1024x1280",
    aspect: "portrait",
    label: "4:5 竖版图文 · 1024 x 1280",
    resolution: "1024 x 1280",
  },
  {
    value: "1088x1360",
    aspect: "portrait",
    label: "4:5 小红书/IG 近似 · 1088 x 1360",
    resolution: "1088 x 1360",
  },
  {
    value: "2048x2560",
    aspect: "portrait",
    label: "4:5 高清竖图 · 2048 x 2560",
    resolution: "2048 x 2560",
  },
  {
    value: "768x1024",
    aspect: "portrait",
    label: "3:4 封面图 · 768 x 1024",
    resolution: "768 x 1024",
  },
  {
    value: "1536x2048",
    aspect: "portrait",
    label: "3:4 高清封面 · 1536 x 2048",
    resolution: "1536 x 2048",
  },
  {
    value: "1536x1024",
    aspect: "landscape",
    label: "3:2 · 1536 x 1024",
    resolution: "1536 x 1024",
  },
  {
    value: "2048x1360",
    aspect: "landscape",
    label: "3:2 横版封面 · 2048 x 1360",
    resolution: "2048 x 1360",
  },
  {
    value: "1024x768",
    aspect: "landscape",
    label: "4:3 横版图文 · 1024 x 768",
    resolution: "1024 x 768",
  },
  {
    value: "2048x1536",
    aspect: "landscape",
    label: "4:3 高清横图 · 2048 x 1536",
    resolution: "2048 x 1536",
  },
  {
    value: "1536x864",
    aspect: "landscape",
    label: "16:9 视频封面 · 1536 x 864",
    resolution: "1536 x 864",
  },
  {
    value: "1920x1088",
    aspect: "landscape",
    label: "16:9 1080P 近似 · 1920 x 1088",
    resolution: "1920 x 1088",
  },
  {
    value: "2048x1152",
    aspect: "landscape",
    label: "16:9 · 2048 x 1152",
    resolution: "2048 x 1152",
  },
  {
    value: "3840x2160",
    aspect: "landscape",
    label: "4K 16:9 · 3840 x 2160",
    resolution: "3840 x 2160",
  },
  {
    value: "1792x768",
    aspect: "landscape",
    label: "21:9 横幅封面 · 1792 x 768",
    resolution: "1792 x 768",
  },
  {
    value: "3840x1648",
    aspect: "landscape",
    label: "21:9 高清横幅 · 3840 x 1648",
    resolution: "3840 x 1648",
  },
  {
    value: "2048x1024",
    aspect: "landscape",
    label: "2:1 头图横幅 · 2048 x 1024",
    resolution: "2048 x 1024",
  },
  {
    value: "3840x1920",
    aspect: "landscape",
    label: "2:1 高清头图 · 3840 x 1920",
    resolution: "3840 x 1920",
  },
  {
    value: "1024x1536",
    aspect: "portrait",
    label: "2:3 · 1024 x 1536",
    resolution: "1024 x 1536",
  },
  {
    value: "1360x2048",
    aspect: "portrait",
    label: "2:3 海报图 · 1360 x 2048",
    resolution: "1360 x 2048",
  },
  {
    value: "864x1536",
    aspect: "portrait",
    label: "9:16 竖屏封面 · 864 x 1536",
    resolution: "864 x 1536",
  },
  {
    value: "1088x1920",
    aspect: "portrait",
    label: "9:16 1080P 近似 · 1088 x 1920",
    resolution: "1088 x 1920",
  },
  {
    value: "1152x2048",
    aspect: "portrait",
    label: "9:16 高清竖屏 · 1152 x 2048",
    resolution: "1152 x 2048",
  },
  {
    value: "2160x3840",
    aspect: "portrait",
    label: "4K 9:16 · 2160 x 3840",
    resolution: "2160 x 3840",
  },
  {
    value: "768x1792",
    aspect: "portrait",
    label: "9:21 竖版长封面 · 768 x 1792",
    resolution: "768 x 1792",
  },
  {
    value: "1648x3840",
    aspect: "portrait",
    label: "9:21 高清长封面 · 1648 x 3840",
    resolution: "1648 x 3840",
  },
  {
    value: "1024x2048",
    aspect: "portrait",
    label: "1:2 长图海报 · 1024 x 2048",
    resolution: "1024 x 2048",
  },
  {
    value: "1920x3840",
    aspect: "portrait",
    label: "1:2 高清长图 · 1920 x 3840",
    resolution: "1920 x 3840",
  },
] as const;

export const customImageSizeValue = "custom" as const;

export type ImagePresetSize = (typeof imageSizeOptions)[number]["value"];
export type ImageSize = "auto" | `${number}x${number}`;

export const GPT_IMAGE_SIZE_LIMITS = {
  maxEdge: 3840,
  minPixels: 655360,
  maxPixels: 8294400,
  maxRatio: 3,
  multiple: 16,
} as const;

export function isValidImageSize(value: string): value is ImageSize {
  if (value === "auto") return true;
  const dimensions = dimensionsFromSize(value);
  if (!dimensions.width || !dimensions.height) return false;
  const longEdge = Math.max(dimensions.width, dimensions.height);
  const shortEdge = Math.min(dimensions.width, dimensions.height);
  const pixels = dimensions.width * dimensions.height;
  return (
    longEdge <= GPT_IMAGE_SIZE_LIMITS.maxEdge &&
    longEdge / shortEdge <= GPT_IMAGE_SIZE_LIMITS.maxRatio &&
    pixels >= GPT_IMAGE_SIZE_LIMITS.minPixels &&
    pixels <= GPT_IMAGE_SIZE_LIMITS.maxPixels &&
    dimensions.width % GPT_IMAGE_SIZE_LIMITS.multiple === 0 &&
    dimensions.height % GPT_IMAGE_SIZE_LIMITS.multiple === 0
  );
}

export function isPresetImageSize(value: string): value is ImagePresetSize {
  return imageSizeOptions.some((option) => option.value === value);
}

export function toImageSize(width: number, height: number): ImageSize {
  const value = `${width}x${height}`;
  if (!isValidImageSize(value)) {
    throw new Error("图片规格必须满足 gpt-image-2：最长边不超过 3840、宽高为 16 的倍数、长短边比例不超过 3:1、总像素 655360 到 8294400");
  }
  return value;
}

export function dimensionsFromSize(size: string) {
  const [width, height] = size.split("x").map((part) => Number(part));
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return { width: undefined, height: undefined };
  }
  return { width, height };
}

export function dataUrlToBlob(dataUrl: string) {
  const [header, base64] = dataUrl.split(",");
  const mimeType = header.match(/data:(.*);base64/)?.[1] ?? "image/png";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}
