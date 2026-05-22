import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMultiAnglePrompt,
  defaultMultiAngleOptionValue,
  multiAngleOptions,
} from "./multi-angle-generation";

test("buildMultiAnglePrompt preserves identity and environment while changing only camera angle", () => {
  const prompt = buildMultiAnglePrompt({
    angle: "left_45",
    candidateCount: 1,
    userInstruction: "",
  });

  assert.match(prompt, /same person identity/i);
  assert.match(prompt, /same environment/i);
  assert.match(prompt, /Only change the camera viewpoint/i);
  assert.match(prompt, /Do not redesign the character/i);
  assert.match(prompt, /left 45-degree/i);
});

test("buildMultiAnglePrompt asks multiple candidates to use different viewpoints", () => {
  const prompt = buildMultiAnglePrompt({
    angle: "angle_set",
    candidateCount: 3,
    userInstruction: "",
  });

  assert.match(prompt, /Each generated candidate must use a different viewpoint/i);
  assert.match(prompt, /left 45-degree/i);
  assert.match(prompt, /right 45-degree/i);
  assert.match(prompt, /side-view/i);
});

test("buildMultiAnglePrompt uses singular wording for one default candidate", () => {
  const prompt = buildMultiAnglePrompt({
    angle: "angle_set",
    candidateCount: 1,
    userInstruction: "",
  });

  assert.match(prompt, /Generate the same scene from a different camera viewpoint selected from/i);
  assert.doesNotMatch(prompt, /Each generated candidate must use a different viewpoint/i);
});

test("buildMultiAnglePrompt appends user instruction without removing preservation constraints", () => {
  const prompt = buildMultiAnglePrompt({
    angle: "overhead",
    candidateCount: 1,
    userInstruction: "make the crop slightly wider",
  });

  assert.match(prompt, /same person identity/i);
  assert.match(prompt, /same environment/i);
  assert.match(prompt, /Additional user instruction: make the crop slightly wider/);
  assert.match(prompt, /overhead/i);
});

test("multiAngleOptions exposes compact UI labels", () => {
  assert.equal(defaultMultiAngleOptionValue, "angle_set");
  assert.deepEqual(
    multiAngleOptions.map((option) => option.value),
    ["angle_set", "left_45", "right_45", "side", "back", "overhead", "low_angle"],
  );
  assert.ok(multiAngleOptions.every((option) => option.label.length > 0));
});
