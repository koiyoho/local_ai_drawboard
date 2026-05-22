import assert from "node:assert/strict";
import test from "node:test";

(globalThis as typeof globalThis & { __AIBOARD_API_BASE_URL__?: string }).__AIBOARD_API_BASE_URL__ =
  "http://127.0.0.1:3344/api";

test("apiUrl maps relative API asset paths to configured API origin", async () => {
  const { apiUrl } = await import("./api-client");

  assert.equal(
    apiUrl("/api/assets/asset-id/file"),
    "http://127.0.0.1:3344/api/assets/asset-id/file",
  );
});

test("apiUrl keeps absolute asset URLs unchanged", async () => {
  const { apiUrl } = await import("./api-client");

  assert.equal(
    apiUrl("https://cdn.example.com/assets/asset-id/file"),
    "https://cdn.example.com/assets/asset-id/file",
  );
});

test("getRuntimeConfig returns an empty object outside the browser", async () => {
  const { getRuntimeConfig } = await import("./api-client");

  assert.deepEqual(getRuntimeConfig(), {});
});

test("apiUrl keeps same-origin asset paths in the browser", async () => {
  const testGlobal = globalThis as typeof globalThis & { window?: Window };
  const hadWindow = "window" in testGlobal;
  const previousWindow = testGlobal.window;
  Object.defineProperty(testGlobal, "window", {
    configurable: true,
    value: {} as Window,
  });
  try {
    const { apiUrl } = await import("./api-client");

    assert.equal(apiUrl("/api/assets/asset-id/file"), "/api/assets/asset-id/file");
  } finally {
    if (!hadWindow) {
      Reflect.deleteProperty(testGlobal, "window");
    } else {
      Object.defineProperty(testGlobal, "window", {
        configurable: true,
        value: previousWindow,
      });
    }
  }
});
