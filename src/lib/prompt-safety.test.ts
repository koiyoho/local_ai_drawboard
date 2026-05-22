import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { optimizePromptSafety } from "./prompt-safety";

describe("prompt safety optimizer", () => {
  test("rewrites risky female portrait wording into safer aesthetic language", () => {
    const result = optimizePromptSafety("性感美女，身材火辣，胸大，翘臀，挑逗眼神，低机位拍摄");

    assert.equal(result.applied, true);
    assert.doesNotMatch(result.prompt, /性感美女|身材火辣|胸大|翘臀|挑逗眼神|低机位拍摄/);
    assert.match(result.prompt, /成年女性/);
    assert.match(result.prompt, /高级时尚|高级商业人像|时尚杂志/);
    assert.match(result.prompt, /自然流畅的身体曲线|身体比例自然协调/);
    assert.match(result.prompt, /避免低俗性感/);
    assert.ok(result.reasons.includes("replaced_high_risk_terms"));
    assert.ok(result.reasons.includes("added_adult_age_guard"));
    assert.ok(result.reasons.includes("added_safety_constraints"));
  });

  test("leaves unrelated safe product prompts unchanged", () => {
    const prompt = "黑色背景上的现代足球队徽，金属质感，居中构图";
    const result = optimizePromptSafety(prompt);

    assert.equal(result.applied, false);
    assert.equal(result.prompt, prompt);
    assert.deepEqual(result.reasons, []);
  });

  test("strict mode adds stronger non-child and clean commercial constraints", () => {
    const result = optimizePromptSafety("可爱小女孩，性感女仆装，诱惑眼神", { mode: "strict" });

    assert.equal(result.applied, true);
    assert.doesNotMatch(result.prompt, /小女孩|性感女仆装|诱惑眼神/);
    assert.match(result.prompt, /20岁成年女性|成年女性/);
    assert.match(result.prompt, /优雅女仆角色设计/);
    assert.match(result.prompt, /不幼态|避免幼态化/);
    assert.match(result.prompt, /干净克制|商业质感|高级商业人像/);
    assert.ok(result.reasons.includes("removed_minor_adult_conflict"));
    assert.ok(result.reasons.includes("added_strict_constraints"));
  });

  test("detects body-part emphasis and returns normalized reasons", () => {
    const result = optimizePromptSafety("S型曲线，超短裙，湿身暧昧氛围");

    assert.equal(result.applied, true);
    assert.doesNotMatch(result.prompt, /S型曲线|超短裙|湿身暧昧/);
    assert.match(result.prompt, /身体比例自然协调/);
    assert.match(result.prompt, /服装剪裁合身|得体自然/);
    assert.match(result.prompt, /柔和光影|干净背景/);
    assert.deepEqual([...new Set(result.reasons)], result.reasons);
  });
});
