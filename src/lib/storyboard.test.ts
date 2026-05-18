import assert from "node:assert/strict";
import test from "node:test";

import { getPlatformPreset, platformPresetIds } from "./platform-copywriting-presets";
import {
  buildShotPromptInstruction,
  buildStoryboardGenerationInstruction,
  getValidStoryboardShotStatus,
  normalizeStoryboardPromptLocks,
  normalizeStoryboardBrief,
  normalizeStoryboardShotInput,
  parseShotPromptOutput,
  parseStoryboardGenerationOutput,
  reorderStoryboardShots,
  storyboardShotStatuses,
} from "./storyboard";

test("platform presets include required first-phase platforms", () => {
  assert.deepEqual(platformPresetIds, [
    "douyin",
    "xiaohongshu",
    "wechat_channels",
    "tiktok",
    "youtube_shorts",
    "instagram_reels",
  ]);
  assert.equal(getPlatformPreset("douyin").locale, "zh-CN");
  assert.equal(getPlatformPreset("tiktok").locale, "en-US");
});

test("platform presets provide copywriting strategy fields", () => {
  const preset = getPlatformPreset("xiaohongshu");
  assert.equal(preset.id, "xiaohongshu");
  assert.ok(preset.hookGuidance.includes("体验"));
  assert.ok(preset.complianceNotes.length >= 2);
  assert.ok(preset.storyboardGuidance.includes("种草"));
});

test("normalizes unknown brief platform to default preset", () => {
  const brief = normalizeStoryboardBrief({
    targetPlatform: "unknown-platform",
    topic: "便携榨汁杯",
  });

  assert.equal(brief.targetPlatform, "douyin");
  assert.equal(brief.locale, "zh-CN");
  assert.equal(brief.topic, "便携榨汁杯");
});

test("normalizes brief locale from target platform when locale is omitted", () => {
  const brief = normalizeStoryboardBrief({
    targetPlatform: "tiktok",
    topic: "portable blender",
  });

  assert.equal(brief.targetPlatform, "tiktok");
  assert.equal(brief.locale, "en-US");
});

test("shot statuses are stable", () => {
  assert.deepEqual(storyboardShotStatuses, [
    "draft",
    "script_ready",
    "prompts_ready",
    "frames_ready",
    "needs_revision",
    "approved",
  ]);
});

test("normalizes shot input with safe defaults", () => {
  const shot = normalizeStoryboardShotInput({
    action: "展示产品倒入杯中",
    caption: "3 秒起泡",
    durationSec: 0,
    shotIndex: -1,
  });

  assert.equal(shot.shotIndex, 1);
  assert.equal(shot.durationSec, 3);
  assert.equal(shot.action, "展示产品倒入杯中");
  assert.equal(shot.camera, "");
  assert.equal(shot.startFrameAssetId, null);
  assert.equal(shot.endFrameAssetId, null);
  assert.equal(shot.status, "draft");
});

test("normalizes frame asset bindings", () => {
  const shot = normalizeStoryboardShotInput({
    startFrameAssetId: "  asset-start  ",
    endFrameAssetId: null,
  });

  assert.equal(shot.startFrameAssetId, "asset-start");
  assert.equal(shot.endFrameAssetId, null);
});

test("invalid stored shot status falls back safely", () => {
  assert.equal(getValidStoryboardShotStatus("prompts_ready"), "prompts_ready");
  assert.equal(getValidStoryboardShotStatus("legacy_status"), "draft");
  assert.equal(getValidStoryboardShotStatus(undefined), "draft");
});

test("normalizes prompt locks inside shot metadata", () => {
  const shot = normalizeStoryboardShotInput({
    action: "展示产品",
    metadata: {
      promptLocks: {
        endFramePrompt: "yes",
        startFramePrompt: true,
        videoPrompt: false,
      },
      source: "manual",
    },
  });

  assert.deepEqual(shot.metadata.promptLocks, {
    startFramePrompt: true,
    endFramePrompt: false,
    videoPrompt: false,
  });
  assert.equal(shot.metadata.source, "manual");
  assert.deepEqual(normalizeStoryboardPromptLocks(undefined), {
    startFramePrompt: false,
    endFramePrompt: false,
    videoPrompt: false,
  });
});

test("parses storyboard output and repairs indexes", () => {
  const output = parseStoryboardGenerationOutput(JSON.stringify({
    title: "新品短视频",
    scriptText: "开头制造痛点，结尾引导购买。",
    shots: [
      { durationSec: 2, scene: "厨房台面", action: "手拿产品入镜", caption: "早八也能快速搞定" },
      { durationSec: 4, scene: "杯子特写", action: "液体起泡", caption: "细腻泡沫" },
    ],
  }));

  assert.equal(output.title, "新品短视频");
  assert.equal(output.shots.length, 2);
  assert.equal(output.shots[0].shotIndex, 1);
  assert.equal(output.shots[1].shotIndex, 2);
});

test("parses fenced shot prompt output", () => {
  const output = parseShotPromptOutput(`\`\`\`json
{
  "startFramePrompt": "办公室桌面产品特写",
  "endFramePrompt": "用户拿起产品露出结果",
  "videoPrompt": "镜头从产品推到用户动作",
  "notes": ["保持主体一致", 123]
}
\`\`\``);

  assert.equal(output.startFramePrompt, "办公室桌面产品特写");
  assert.equal(output.endFramePrompt, "用户拿起产品露出结果");
  assert.equal(output.videoPrompt, "镜头从产品推到用户动作");
  assert.deepEqual(output.notes, ["保持主体一致"]);
});

test("reorders storyboard shots by ids", () => {
  const shots = [
    normalizeStoryboardShotInput({ id: "a", shotIndex: 1, action: "A" }),
    normalizeStoryboardShotInput({ id: "b", shotIndex: 2, action: "B" }),
    normalizeStoryboardShotInput({ id: "c", shotIndex: 3, action: "C" }),
  ];

  const reordered = reorderStoryboardShots(shots, ["c", "a", "b"]);
  assert.deepEqual(reordered.map((shot) => `${shot.id}:${shot.shotIndex}`), ["c:1", "a:2", "b:3"]);
});

test("rejects incomplete shot reorder ids", () => {
  const shots = [
    normalizeStoryboardShotInput({ id: "a", shotIndex: 1, action: "A" }),
    normalizeStoryboardShotInput({ id: "b", shotIndex: 2, action: "B" }),
  ];

  assert.throws(() => reorderStoryboardShots(shots, ["b"]), /same shot ids/i);
});

test("builds platform-aware storyboard generation instruction", () => {
  const instruction = buildStoryboardGenerationInstruction({
    brief: {
      targetPlatform: "tiktok",
      contentType: "product",
      locale: "en-US",
      durationSec: 15,
      aspectRatio: "9:16",
      topic: "portable blender",
      audience: "busy gym users",
      sellingPoints: "quick smoothie, easy cleaning",
      tone: "direct",
      constraints: "no medical claims",
    },
    scriptText: "Show the problem, then the blender solves it.",
  });

  assert.match(instruction, /TikTok/);
  assert.match(instruction, /first 1-2 seconds/);
  assert.match(instruction, /portable blender/);
  assert.match(instruction, /only JSON/i);
});

test("builds shot prompt instruction", () => {
  const instruction = buildShotPromptInstruction({
    brief: {
      targetPlatform: "douyin",
      contentType: "product",
      locale: "zh-CN",
      durationSec: 20,
      aspectRatio: "9:16",
      topic: "便携榨汁杯",
      audience: "上班族",
      sellingPoints: "快洗，轻便",
      tone: "强节奏",
      constraints: "不要绝对化承诺",
    },
    shot: normalizeStoryboardShotInput({
      shotIndex: 1,
      scene: "办公室桌面",
      action: "产品从包里拿出",
      caption: "早八也能喝新鲜果汁",
    }),
  });

  assert.match(instruction, /首帧提示词/);
  assert.match(instruction, /尾帧提示词/);
  assert.match(instruction, /视频生成提示词/);
  assert.match(instruction, /抖音/);
});

test("builds shot prompt instruction with bound frame asset context", () => {
  const instruction = buildShotPromptInstruction({
    brief: {
      targetPlatform: "douyin",
      contentType: "product",
      locale: "zh-CN",
      durationSec: 20,
      aspectRatio: "9:16",
      topic: "便携榨汁杯",
      audience: "上班族",
      sellingPoints: "快洗，轻便",
      tone: "强节奏",
      constraints: "不要绝对化承诺",
    },
    frameContext: {
      startFrameAsset: {
        assetId: "asset-start",
        height: 1920,
        kind: "generated",
        sourcePrompt: "产品在办公室桌面",
        tags: ["产品", "办公室"],
        width: 1080,
      },
      endFrameAsset: {
        assetId: "asset-end",
        height: null,
        kind: "upload",
        sourcePrompt: "",
        tags: [],
        width: null,
      },
    },
    shot: normalizeStoryboardShotInput({
      shotIndex: 1,
      scene: "办公室桌面",
      action: "产品从包里拿出",
      caption: "早八也能喝新鲜果汁",
    }),
  });

  assert.match(instruction, /已绑定首帧参考素材/);
  assert.match(instruction, /asset-start/);
  assert.match(instruction, /1080x1920/);
  assert.match(instruction, /产品在办公室桌面/);
  assert.match(instruction, /已绑定尾帧参考素材/);
  assert.match(instruction, /不要与绑定素材冲突/);
});
