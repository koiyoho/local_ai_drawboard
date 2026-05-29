import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/components/BoardWorkspace.tsx", "utf8");

test("desktop generate and edit panels both render image model selection", () => {
  const modelSelectCalls = [...source.matchAll(/renderImageModelSelect\("desktop-(?:generate|edit)-model"\)/g)];
  assert.equal(modelSelectCalls.length, 2);
  assert.match(source, /renderImageModelSelect\("desktop-generate-model"\)/);
  assert.match(source, /renderImageModelSelect\("desktop-edit-model"\)/);
});

test("board image actions expose multi-angle generation alongside variants", () => {
  const variantActionCalls = [...source.matchAll(/generateSelectedImageVariant/g)].length;
  const multiAngleActionCalls = [...source.matchAll(/generateSelectedImageMultiAngle/g)].length;

  assert.match(source, /function generateSelectedImageMultiAngle/);
  assert.match(source, /buildMultiAnglePrompt/);
  assert.match(source, /const candidateCount = getValidGenerationCount\(generationCount\)/);
  assert.match(source, /promptAlreadyStyled: true/);
  assert.match(source, /aria-label="生成多角度"/);
  assert.match(source, />多角度</);
  assert.match(source, /多角度：\{option\.label\}/);
  assert.match(source, /taskLabel: "多角度"/);
  assert.ok(multiAngleActionCalls >= Math.floor(variantActionCalls / 2));
});

test("prompt assist controls expose prompt safety optimizer", () => {
  assert.match(source, /type PromptAssistSource = "assist" \| "safety"/);
  assert.match(source, /function getPromptSafetyNotes/);
  assert.match(source, /runPromptSafetyOptimizer\("standard"\)/);
  assert.match(source, /安全优化器/);
  assert.match(source, /提示词安全优化器/);
  assert.match(source, /runPromptSafetyOptimizer\("strict"\)/);
  assert.match(source, /严格优化/);
});

test("board model selection uses shared provider routing helpers", () => {
  assert.match(source, /normalizeProviderModelSelection\(nextImageModels, selectedImageModel\)/);
  assert.match(source, /getDefaultProviderModelSelection\(nextImageModels, payload\.selectedImageModel \?\? payload\.selectedModel\)/);
  assert.match(source, /normalizeProviderModelSelection\(payload\.reversePromptModels!, current\)/);
  assert.match(source, /getDefaultProviderModelSelection\(payload\.reversePromptModels!, payload\.selectedReversePromptModel\)/);
  assert.match(source, /getProviderModelOptionValue\(model\)/);
  assert.doesNotMatch(source, /getImageModelOptionValue/);
});

test("video assets are not inserted as image canvas layers", () => {
  assert.match(source, /if \(!asset\.mimeType\.startsWith\("image\/"\)\) \{/);
  assert.match(source, /throw new Error\("视频已保存到素材库，不能作为图片图层载入画布"\)/);
  assert.match(source, /const isImageAsset = asset\.mimeType\.startsWith\("image\/"\)/);
  assert.match(source, /disabled=\{!isImageAsset\}/);
  assert.match(source, /asset\.mimeType\.startsWith\("video\/"\) \? \(/);
});

test("generation polling exits when a job is cancelled", () => {
  assert.match(source, /if \(payload\.job\.status === "cancelled"\) \{/);
  assert.match(source, /throw new Error\(payload\.job\.errorMessage \?\? "生成任务已中止"\)/);
});

test("video jobs keep video labels and retry through the video endpoint", () => {
  assert.match(source, /function getGenerationModeLabel\(mode: string\)/);
  assert.match(source, /if \(mode === "text_to_video"\) return "AI 视频"/);
  assert.match(source, /if \(job\.mode === "text_to_video"\) \{/);
  assert.match(source, /runVideoGeneration\(\{/);
  assert.doesNotMatch(source, /modeLabel: latestGenerationJob\.mode === "text_to_image" \? "AI 生图" : "AI 改图"/);
});
