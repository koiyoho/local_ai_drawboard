import assert from "node:assert/strict";
import test from "node:test";

const staticModuleUrl = new URL("../dist/server/server/static.js", import.meta.url);

async function withServerEnv(env, fn) {
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("injectPublicRuntimeConfig injects API base from server environment", async () => {
  await withServerEnv(
    {
      VITE_API_BASE_URL: "https://api.example.test/api",
    },
    async () => {
      const { injectPublicRuntimeConfig } = await import(staticModuleUrl);
      const html = injectPublicRuntimeConfig(
        '<!doctype html><html><head><title>AI Board</title></head><body><div id="root"></div></body></html>',
      );

      assert.match(html, /window\.__AIBOARD_RUNTIME_CONFIG__=/);
      assert.match(html, /https:\/\/api\.example\.test\/api/);
      assert.match(html, /api\.example\.test\/api.*<\/script>\n {2}<\/head>/);
    },
  );
});
