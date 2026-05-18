import { platformCopywritingPresets, platformPresetIds } from "@/lib/platform-copywriting-presets";
import { storyboardContentTypes, storyboardShotStatuses } from "@/lib/storyboard";

export const storyboardPlatformOptions = platformPresetIds.map((id) => ({
  label: platformCopywritingPresets[id].label,
  value: id,
}));

export const storyboardContentTypeOptions = storyboardContentTypes.map((value) => ({
  label: getContentTypeLabel(value),
  value,
}));

export const storyboardStatusOptions = storyboardShotStatuses.map((value) => ({
  label: getStoryboardStatusLabel(value),
  value,
}));

export function getStoryboardStatusLabel(status: string) {
  const labels: Record<string, string> = {
    approved: "已确认",
    draft: "草稿",
    frames_ready: "首尾帧就绪",
    needs_revision: "待修改",
    prompts_ready: "提示词就绪",
    script_ready: "脚本就绪",
  };
  return labels[status] ?? "草稿";
}

function getContentTypeLabel(value: string) {
  const labels: Record<string, string> = {
    ad: "广告",
    brand: "品牌",
    product: "产品",
    story: "故事",
    tutorial: "教程",
    ugc: "UGC",
  };
  return labels[value] ?? value;
}
