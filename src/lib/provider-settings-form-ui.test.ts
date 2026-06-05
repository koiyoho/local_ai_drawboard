import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/components/ProviderSettingsForm.tsx", "utf8");
const adminAppSource = readFileSync("src/client/pages/AdminApp.tsx", "utf8");

test("provider model pool owns its model catalog state when expanded", () => {
  const poolStart = source.indexOf("export function ProviderModelPoolSettings");
  const historyStart = source.indexOf("function ProviderHistoryList");
  assert.ok(poolStart > 0, "ProviderModelPoolSettings should exist");
  assert.ok(historyStart > poolStart, "ProviderModelPoolSettings body should be bounded by ProviderHistoryList");

  const poolSource = source.slice(poolStart, historyStart);
  assert.match(poolSource, /const \[modelCatalog, setModelCatalog\] = useState/);
  assert.match(poolSource, /apiFetch\("\/api\/admin\/provider-models\/catalog"\)/);
  assert.match(poolSource, /catalog=\{modelCatalog\.imageModels\}/);
  assert.match(poolSource, /catalog=\{modelCatalog\.reversePromptModels\}/);
});

test("provider model pool keeps channel-qualified defaults and custom model input", () => {
  assert.match(source, /onFallbackModelChange\(getStoredFallbackModelValue\(value\)\)/);
  assert.match(source, /getFallbackModelOptions\(catalog, models\)/);
  assert.match(source, /\(model\.channel \?\? defaultProviderModelChannel\) === defaultProviderModelChannel/);
  assert.match(source, /getProviderModelOptionValue\(configuredModel\)/);
  assert.match(source, /placeholder="输入自定义模型 ID"/);
  assert.match(source, /onChange=\{\(event\) => updateModel\(index, \{ id: event\.target\.value/);
});

test("admin console exposes CLIProxyAPI management, official OAuth login, and Grok CLI guidance", () => {
  assert.match(source, /export function CliProxySettingsCard/);
  assert.match(source, /CLIProxyAPI 管理密钥/);
  assert.match(source, /hasCliProxyManagementKey/);
  assert.match(source, /cliProxyEnvironmentHasManagementKey/);
  assert.doesNotMatch(source, /provider: "xai"/);
  assert.match(source, /Grok \/ xAI/);
  assert.match(source, /\.\/cli-proxy-api --xai-login/);
  assert.match(source, /provider: "anthropic"/);
  assert.match(source, /Claude Code/);
  assert.match(source, /apiFetch\(`\/api\/provider-settings\/cliproxy\/oauth\/\$\{providerName\}\/start`/);
  assert.match(source, /body: "\{\}"/);
  assert.match(source, /headers: \{ "Content-Type": "application\/json" \}/);
  assert.match(source, /apiFetch\(`\/api\/provider-settings\/cliproxy\/oauth\/\$\{providerName\}\/status\?state=/);
  assert.match(source, /const popup = window\.open\("about:blank", "_blank"\)/);
  assert.match(source, /popup\.opener = null/);
  assert.match(source, /popup\.location\.href = payload\.url/);
  assert.match(source, /beginCliProxyOAuthPolling/);
  assert.match(adminAppSource, /CliProxySettingsCard/);
  assert.match(adminAppSource, /"\/api\/provider-settings\/cliproxy"/);
});
