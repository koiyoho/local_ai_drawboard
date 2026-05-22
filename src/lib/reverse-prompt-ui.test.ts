import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/client/pages/ReversePromptApp.tsx", "utf8");

test("reverse prompt model selection uses shared provider routing helpers", () => {
  assert.match(source, /providerModelOptionMatchesSelection\(model, current\)/);
  assert.match(source, /normalizeProviderModelSelection\(payload\.reversePromptModels!, current\)/);
  assert.match(source, /getDefaultProviderModelSelection\(payload\.reversePromptModels!, payload\.selectedReversePromptModel\)/);
  assert.match(source, /getProviderModelOptionValue\(model\)/);
});
