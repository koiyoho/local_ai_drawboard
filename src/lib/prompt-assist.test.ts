import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  buildPromptAssistInstruction,
  cleanPromptAssistText,
  parsePromptAssistOutput,
  promptAssistActions,
  promptAssistImageTypes,
  type PromptAssistAction,
} from "./prompt-assist";

describe("prompt assist utilities", () => {
  test("exposes the supported actions", () => {
    assert.deepEqual(promptAssistActions, ["optimize", "expand", "variations", "translate"]);
  });

  test("exposes the supported image types", () => {
    assert.deepEqual(promptAssistImageTypes, [
      "auto",
      "ui",
      "infographic",
      "poster",
      "ecommerce",
      "person",
      "photo",
      "scene",
      "object",
      "brand",
      "architecture",
      "illustration",
      "character",
      "publication",
      "other",
    ]);
  });

  test("builds a poster optimize instruction that preserves intent", () => {
    const instruction = buildPromptAssistInstruction({
      action: "optimize",
      imageType: "poster",
      prompt: "一个足球 logo，黑色背景",
    });

    assert.match(instruction, /保留用户原始意图/);
    assert.match(instruction, /Prompt-as-Code/);
    assert.match(instruction, /海报与排版/);
    assert.match(instruction, /标题层级/);
    assert.match(instruction, /一个足球 logo，黑色背景/);
    assert.match(instruction, /只输出 JSON/);
  });

  test("builds an auto instruction that asks the model to infer image type", () => {
    const instruction = buildPromptAssistInstruction({
      action: "expand",
      imageType: "auto",
      prompt: "球鞋产品图",
    });

    assert.match(instruction, /自动判断最合适的图片类型/);
    assert.match(instruction, /球鞋产品图/);
  });

  test("includes reference context in the instruction", () => {
    const instruction = buildPromptAssistInstruction({
      action: "optimize",
      imageType: "ecommerce",
      prompt: "生成商品图",
      referenceContext: "参考图 1：商品参考。\n参考图 2：背景参考。",
    });

    assert.match(instruction, /参考图标记/);
    assert.match(instruction, /商品参考/);
    assert.match(instruction, /背景参考/);
    assert.match(instruction, /不要把参考图混成同一对象/);
  });

  test("locks prompt assist away from rewriting the selected art style", () => {
    const instruction = buildPromptAssistInstruction({
      action: "optimize",
      artStyle: "realistic",
      artStyleInstruction: "写实摄影质感，自然光照，真实材质细节，镜头感明确。",
      artStyleLabel: "写实",
      imageType: "photo",
      prompt: "一位年轻女孩，穿女仆装并打扮成猫娘",
    });

    assert.match(instruction, /风格锁定/);
    assert.match(instruction, /当前画板风格选择为「写实」/);
    assert.match(instruction, /最终生成阶段会统一追加/);
    assert.match(instruction, /不要自行新增、替换或混入其他画风/);
    assert.match(instruction, /不要重复写入“画风要求”段落/);
  });

  test("cleans markdown wrappers and quoted text", () => {
    assert.equal(cleanPromptAssistText("```json\n{\"prompt\":\"test\"}\n```"), "{\"prompt\":\"test\"}");
    assert.equal(cleanPromptAssistText("“高清足球海报”"), "高清足球海报");
  });

  test("parses a single prompt response", () => {
    const output = parsePromptAssistOutput("optimize", JSON.stringify({
      prompt: "黑色背景上的现代足球队徽，金属质感，居中构图",
      notes: ["保留黑色背景", "增强材质描述"],
    }));

    assert.equal(output.prompt, "黑色背景上的现代足球队徽，金属质感，居中构图");
    assert.deepEqual(output.variations, []);
    assert.deepEqual(output.notes, ["保留黑色背景", "增强材质描述"]);
  });

  test("parses non-variation JSON missing prompt as an empty prompt and preserves notes", () => {
    const output = parsePromptAssistOutput("optimize", JSON.stringify({
      notes: ["无法处理", "", 123, "缺少提示词"],
    }));

    assert.equal(output.prompt, "");
    assert.deepEqual(output.variations, []);
    assert.deepEqual(output.notes, ["无法处理", "缺少提示词"]);
  });

  test("parses non-variation JSON with non-string prompt as an empty prompt", () => {
    const output = parsePromptAssistOutput("translate", JSON.stringify({
      prompt: { text: "高清足球海报" },
      notes: ["prompt 字段格式无效"],
    }));

    assert.equal(output.prompt, "");
    assert.deepEqual(output.variations, []);
    assert.deepEqual(output.notes, ["prompt 字段格式无效"]);
  });

  test("parses variations response", () => {
    const output = parsePromptAssistOutput("variations", JSON.stringify({
      variations: [
        "黑金足球队徽，强烈聚光",
        "极简足球 logo，扁平矢量",
        "复古足球徽章，织物纹理",
      ],
    }));

    assert.equal(output.prompt, "");
    assert.deepEqual(output.variations, [
      "黑金足球队徽，强烈聚光",
      "极简足球 logo，扁平矢量",
      "复古足球徽章，织物纹理",
    ]);
  });

  test("parses variations JSON by filtering invalid and blank items and capping to 3", () => {
    const output = parsePromptAssistOutput("variations", JSON.stringify({
      variations: [
        "黑金足球队徽，强烈聚光",
        "",
        42,
        " 极简足球 logo，扁平矢量 ",
        null,
        "复古足球徽章，织物纹理",
        "未来感足球标志，霓虹灯效",
      ],
      notes: ["保留足球主题"],
    }));

    assert.equal(output.prompt, "");
    assert.deepEqual(output.variations, [
      "黑金足球队徽，强烈聚光",
      "极简足球 logo，扁平矢量",
      "复古足球徽章，织物纹理",
    ]);
    assert.deepEqual(output.notes, ["保留足球主题"]);
  });

  test("parses variations JSON missing valid variations as an empty array", () => {
    const output = parsePromptAssistOutput("variations", JSON.stringify({
      variations: ["", 1, null],
      notes: ["没有可用变体"],
    }));

    assert.equal(output.prompt, "");
    assert.deepEqual(output.variations, []);
    assert.deepEqual(output.notes, ["没有可用变体"]);
  });

  test("falls back from plain text for non-variation actions", () => {
    const output = parsePromptAssistOutput("expand" satisfies PromptAssistAction, "主体：足球队徽\n背景：黑色");

    assert.equal(output.prompt, "主体：足球队徽\n背景：黑色");
    assert.deepEqual(output.variations, []);
  });
});
