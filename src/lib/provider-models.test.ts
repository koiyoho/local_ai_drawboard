import assert from "node:assert/strict";

import {
  encodeConfiguredModelValue,
  filterImageModelOptions,
  getDefaultProviderModelSelection,
  getEnabledProviderModels,
  getProviderModelOptionValue,
  normalizeConfiguredModels,
  normalizeProviderModelSelection,
  parseConfiguredModelValue,
} from "./provider-models";

assert.deepEqual(filterImageModelOptions(
  [
    { id: "gpt-5.5" },
    { id: "gpt-image-2" },
    { id: "flux-kontext-pro" },
    { id: "text-embedding-3-large" },
  ],
  "gpt-image-2",
), [
  { id: "gpt-image-2", label: "gpt-image-2" },
  { id: "flux-kontext-pro", label: "flux-kontext-pro" },
]);

assert.deepEqual(filterImageModelOptions([{ id: "gpt-5.5" }], "custom-image-model"), [
  { id: "custom-image-model", label: "custom-image-model" },
]);

assert.deepEqual(filterImageModelOptions(["dall-e-3", "claude-4"], "gpt-image-2"), [
  { id: "dall-e-3", label: "dall-e-3" },
]);

assert.deepEqual(normalizeConfiguredModels([
  { enabled: false, id: "gpt-image-2", label: "GPT Image" },
  { id: "flux-kontext-pro" },
  { id: "flux-kontext-pro", label: "duplicate" },
], "gpt-image-2"), [
  { enabled: false, id: "gpt-image-2", label: "GPT Image" },
  { enabled: true, id: "flux-kontext-pro", label: "flux-kontext-pro" },
]);

assert.deepEqual(normalizeConfiguredModels([
  { channel: "provider", enabled: true, id: "gpt-image-2", label: "GPT Image · Third Party" },
  { channel: "codex", enabled: true, id: "gpt-image-2", label: "GPT Image · Codex" },
], "gpt-image-2"), [
  { channel: "provider", enabled: true, id: "gpt-image-2", label: "GPT Image · Third Party" },
  { channel: "codex", enabled: true, id: "gpt-image-2", label: "GPT Image · Codex" },
]);

assert.deepEqual(getEnabledProviderModels([
  { channel: "provider", enabled: true, id: "gpt-image-2", label: "GPT Image · Third Party" },
  { channel: "codex", enabled: true, id: "gpt-image-2", label: "GPT Image · Codex" },
], "gpt-image-2"), [
  { channel: "provider", id: "gpt-image-2", label: "GPT Image · Third Party" },
  { channel: "codex", id: "gpt-image-2", label: "GPT Image · Codex" },
]);

assert.equal(encodeConfiguredModelValue({ channel: "codex", id: "gpt-image-2" }), "codex:gpt-image-2");
assert.deepEqual(parseConfiguredModelValue("gemini-bridge:gemini-web"), {
  channel: "gemini-bridge",
  id: "gemini-web",
});
assert.deepEqual(parseConfiguredModelValue("legacy-model"), {
  channel: undefined,
  id: "legacy-model",
});

assert.deepEqual(normalizeConfiguredModels("not-json", "gpt-image-2"), [
  { channel: "provider", enabled: true, id: "gpt-image-2", label: "gpt-image-2" },
]);

assert.deepEqual(normalizeConfiguredModels([
  { channel: "provider", enabled: true, id: "gpt-image-2", label: "GPT Image · Third Party" },
], "codex:gpt-image-2"), [
  { channel: "codex", enabled: true, id: "gpt-image-2", label: "gpt-image-2" },
  { channel: "provider", enabled: true, id: "gpt-image-2", label: "GPT Image · Third Party" },
]);

assert.deepEqual(getEnabledProviderModels([
  { enabled: false, id: "gpt-image-2" },
  { enabled: true, id: "imagen-4" },
], "gpt-image-2"), [
  { id: "imagen-4", label: "imagen-4" },
]);

const duplicateModelOptions = [
  { channel: "codex" as const, id: "gpt-image-2", label: "GPT Image · Codex" },
  { channel: "provider" as const, id: "gpt-image-2", label: "GPT Image · Third Party" },
  { channel: "gemini-bridge" as const, id: "nano-banana", label: "Nano Banana" },
];

assert.equal(getProviderModelOptionValue(duplicateModelOptions[0]), "codex:gpt-image-2");
assert.equal(normalizeProviderModelSelection(duplicateModelOptions, "gpt-image-2"), "provider:gpt-image-2");
assert.equal(normalizeProviderModelSelection(duplicateModelOptions, "codex:gpt-image-2"), "codex:gpt-image-2");
assert.equal(getDefaultProviderModelSelection(duplicateModelOptions, "gpt-image-2"), "provider:gpt-image-2");
assert.equal(getDefaultProviderModelSelection(duplicateModelOptions, "codex:gpt-image-2"), "codex:gpt-image-2");
