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
  const previousWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
  (globalThis as typeof globalThis & { window?: unknown }).window = {};
  try {
    const { apiUrl } = await import("./api-client");

    assert.equal(apiUrl("/api/assets/asset-id/file"), "/api/assets/asset-id/file");
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as typeof globalThis & { window?: unknown }).window;
    } else {
      (globalThis as typeof globalThis & { window?: unknown }).window = previousWindow;
    }
  }
});
