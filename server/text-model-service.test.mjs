import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL("../dist/server/server/text-model-service.js", import.meta.url);

test("resolveTextModelChannel honors explicit channel-qualified text defaults", async () => {
  const { resolveTextModelChannel } = await import(moduleUrl);
  const providerSetting = {
    enabledReversePromptModels: JSON.stringify([
      { channel: "provider", enabled: true, id: "gpt-5.5", label: "GPT 5.5 · Provider" },
      { channel: "codex", enabled: true, id: "gpt-5.5", label: "GPT 5.5 · Codex" },
    ]),
    textModel: "codex:gpt-5.5",
  };

  assert.equal(resolveTextModelChannel(providerSetting, "gpt-5.5"), "codex");
});

test("resolveTextModelChannel keeps explicit provider default when duplicate text ids exist", async () => {
  const { resolveTextModelChannel } = await import(moduleUrl);
  const providerSetting = {
    enabledReversePromptModels: JSON.stringify([
      { channel: "codex", enabled: true, id: "gpt-5.5", label: "GPT 5.5 · Codex" },
      { channel: "provider", enabled: true, id: "gpt-5.5", label: "GPT 5.5 · Provider" },
    ]),
    textModel: "provider:gpt-5.5",
  };

  assert.equal(resolveTextModelChannel(providerSetting, "gpt-5.5"), "provider");
});

test("resolveRequestedTextModelChannel prefers provider for legacy duplicate text requests but keeps a channel-qualified default when no model pool exists", async () => {
  const { resolveRequestedTextModelChannel } = await import(moduleUrl);

  assert.equal(resolveRequestedTextModelChannel({
    enabledReversePromptModels: JSON.stringify([
      { channel: "provider", enabled: true, id: "gpt-5.5", label: "GPT 5.5 · Provider" },
      { channel: "codex", enabled: true, id: "gpt-5.5", label: "GPT 5.5 · Codex" },
    ]),
    textModel: "codex:gpt-5.5",
  }, "gpt-5.5"), "provider");

  assert.equal(resolveRequestedTextModelChannel({
    enabledReversePromptModels: null,
    textModel: "codex:gpt-5.5",
  }, "gpt-5.5"), "codex");
});

test("resolveTextModelChannel routes legacy Gemini Web text models to Gemini Bridge", async () => {
  const { resolveTextModelChannel } = await import(moduleUrl);
  const providerSetting = {
    enabledReversePromptModels: JSON.stringify([]),
    textModel: "gemini-web",
  };

  assert.equal(resolveTextModelChannel(providerSetting, "gemini-web"), "gemini-bridge");
});

test("getTextGenerationProviderSetting uses configured Codex text proxy without leaking channel value as model id", async () => {
  const { getTextGenerationProviderSetting } = await import(moduleUrl);
  const previousBaseUrl = process.env.CODEX_TEXT_PROXY_BASE_URL;
  const previousApiKey = process.env.CODEX_TEXT_PROXY_API_KEY;
  process.env.CODEX_TEXT_PROXY_BASE_URL = "http://127.0.0.1:9876/v1";
  process.env.CODEX_TEXT_PROXY_API_KEY = "proxy-key";
  try {
    const providerSetting = {
      apiKey: "provider-key",
      baseUrl: "https://provider.example/v1",
      displayName: "Provider",
      enabledReversePromptModels: null,
      textModel: "codex:gpt-5.5",
    };
    const routed = await getTextGenerationProviderSetting(providerSetting, "gpt-5.5", "codex");

    assert.equal(routed.apiKey, "proxy-key");
    assert.equal(routed.baseUrl, "http://127.0.0.1:9876/v1");
    assert.equal(routed.displayName, "官方 Codex 文本代理");
    assert.equal(routed.textModel, "gpt-5.5");
  } finally {
    if (previousBaseUrl === undefined) {
      delete process.env.CODEX_TEXT_PROXY_BASE_URL;
    } else {
      process.env.CODEX_TEXT_PROXY_BASE_URL = previousBaseUrl;
    }
    if (previousApiKey === undefined) {
      delete process.env.CODEX_TEXT_PROXY_API_KEY;
    } else {
      process.env.CODEX_TEXT_PROXY_API_KEY = previousApiKey;
    }
  }
});

test("callOpenAICompatibleTextModel rejects a disabled default text model before routing", async () => {
  const { callOpenAICompatibleTextModel } = await import(moduleUrl);
  await assert.rejects(
    () => callOpenAICompatibleTextModel({
      apiKey: "third-party-secret",
      baseUrl: "https://example.test/v1",
      displayName: "OpenAI 兼容接口",
      enabledReversePromptModels: JSON.stringify([
        { channel: "provider", enabled: false, id: "gpt-5.5", label: "GPT 5.5 · Provider" },
        { channel: "codex", enabled: true, id: "gpt-5.5", label: "GPT 5.5 · Codex" },
      ]),
      textModel: "provider:gpt-5.5",
    }, "instruction", 100, 0.2),
    /默认文本模型未启用/,
  );
});
