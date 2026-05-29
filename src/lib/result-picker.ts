import type { AssetPayload } from "@/components/board-canvas/types";

export type ResultPickerJob = {
  id: string;
  mode: string;
  prompt: string;
  sourceAssetId: string | null;
  results: Array<{ asset: AssetPayload }>;
};

export function getResultPickerSummary(job: ResultPickerJob, assets: AssetPayload[]) {
  const sourceAsset = getJobSourceAsset(job, assets);
  return {
    candidateCount: job.results.length,
    canCompareWithSource: Boolean(sourceAsset && job.mode === "inpaint"),
    modeLabel: getResultPickerModeLabel(job.mode),
    sourceAsset,
  };
}

export function getResultPickerComparisonPair(
  job: ResultPickerJob,
  resultAsset: AssetPayload,
  assets: AssetPayload[],
) {
  const sourceAsset = getJobSourceAsset(job, assets);
  if (!sourceAsset || job.mode !== "inpaint") return null;
  return {
    resultAsset,
    sourceAsset,
  };
}

function getResultPickerModeLabel(mode: string) {
  if (mode === "text_to_image") return "AI 生图";
  if (mode === "text_to_video") return "AI 视频";
  return "AI 改图";
}

function getJobSourceAsset(job: ResultPickerJob, assets: AssetPayload[]) {
  if (!job.sourceAssetId) return null;
  return assets.find((asset) => asset.id === job.sourceAssetId) ?? null;
}
