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
    canCompareWithSource: Boolean(sourceAsset && job.mode !== "text_to_image"),
    modeLabel: job.mode === "text_to_image" ? "AI 生图" : "AI 改图",
    sourceAsset,
  };
}

export function getResultPickerComparisonPair(
  job: ResultPickerJob,
  resultAsset: AssetPayload,
  assets: AssetPayload[],
) {
  const sourceAsset = getJobSourceAsset(job, assets);
  if (!sourceAsset || job.mode === "text_to_image") return null;
  return {
    resultAsset,
    sourceAsset,
  };
}

function getJobSourceAsset(job: ResultPickerJob, assets: AssetPayload[]) {
  if (!job.sourceAssetId) return null;
  return assets.find((asset) => asset.id === job.sourceAssetId) ?? null;
}
