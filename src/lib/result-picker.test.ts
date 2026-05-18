import assert from "node:assert/strict";
import test from "node:test";

import {
  getResultPickerComparisonPair,
  getResultPickerSummary,
  type ResultPickerJob,
} from "./result-picker";

const sourceAsset = {
  createdAt: "2026-05-14T00:00:00.000Z",
  height: 768,
  id: "source-asset",
  isFavorite: false,
  kind: "source",
  mimeType: "image/png",
  publicUrl: "/api/assets/source/file",
  sizeBytes: 100,
  tagsJson: null,
  width: 1024,
};

const resultAsset = {
  ...sourceAsset,
  id: "result-asset",
  kind: "generated",
  publicUrl: "/api/assets/result/file",
};

test("getResultPickerSummary reports candidate count and source comparison availability", () => {
  const job: ResultPickerJob = {
    id: "job-1",
    mode: "inpaint",
    prompt: "replace shirt",
    sourceAssetId: "source-asset",
    results: [{ asset: resultAsset }],
  };

  assert.deepEqual(getResultPickerSummary(job, [sourceAsset, resultAsset]), {
    candidateCount: 1,
    canCompareWithSource: true,
    modeLabel: "AI 改图",
    sourceAsset,
  });
});

test("getResultPickerComparisonPair returns null when the source asset is missing", () => {
  const job: ResultPickerJob = {
    id: "job-2",
    mode: "inpaint",
    prompt: "replace shirt",
    sourceAssetId: "missing-source",
    results: [{ asset: resultAsset }],
  };

  assert.equal(getResultPickerComparisonPair(job, resultAsset, [resultAsset]), null);
});
