import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test, { afterEach } from "node:test";

const imageOptimizerModuleUrl = new URL("../dist/server/server/image-optimizer.js", import.meta.url);

const originalFetch = globalThis.fetch;
const originalImageOptimizerToken = process.env.IMAGE_OPTIMIZER_TOKEN;
const originalImageOptimizerUrl = process.env.IMAGE_OPTIMIZER_URL;
const originalImageOptimizerDenoise = process.env.IMAGE_OPTIMIZER_DENOISE;
const originalImageOptimizerRadius = process.env.IMAGE_OPTIMIZER_RADIUS;
const originalImageOptimizerSigma = process.env.IMAGE_OPTIMIZER_SIGMA;
const originalImageOptimizerStrength = process.env.IMAGE_OPTIMIZER_STRENGTH;

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnv("IMAGE_OPTIMIZER_TOKEN", originalImageOptimizerToken);
  restoreEnv("IMAGE_OPTIMIZER_URL", originalImageOptimizerUrl);
  restoreEnv("IMAGE_OPTIMIZER_DENOISE", originalImageOptimizerDenoise);
  restoreEnv("IMAGE_OPTIMIZER_RADIUS", originalImageOptimizerRadius);
  restoreEnv("IMAGE_OPTIMIZER_SIGMA", originalImageOptimizerSigma);
  restoreEnv("IMAGE_OPTIMIZER_STRENGTH", originalImageOptimizerStrength);
});

test("optimizeGeneratedImage returns original image when optimizer is not configured", async () => {
  delete process.env.IMAGE_OPTIMIZER_TOKEN;
  delete process.env.IMAGE_OPTIMIZER_URL;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("fetch should not be called");
  };

  const { optimizeGeneratedImage } = await import(imageOptimizerModuleUrl);
  const bytes = Buffer.from("original");
  const result = await optimizeGeneratedImage({ bytes, filename: "image.png", mimeType: "image/png" });

  assert.equal(fetchCalled, false);
  assert.equal(result.bytes, bytes);
  assert.equal(result.mimeType, "image/png");
});

test("optimizeGeneratedImage sends image to the configured optimizer and returns optimized bytes", async () => {
  process.env.IMAGE_OPTIMIZER_TOKEN = "optimizer-token";
  process.env.IMAGE_OPTIMIZER_URL = "https://example.test/optimize";
  process.env.IMAGE_OPTIMIZER_DENOISE = "soft";
  process.env.IMAGE_OPTIMIZER_RADIUS = "3";
  process.env.IMAGE_OPTIMIZER_STRENGTH = "35";
  const optimizedBytes = Buffer.from("optimized");
  let requestUrl;
  let requestInit;
  globalThis.fetch = async (url, init) => {
    requestUrl = url;
    requestInit = init;
    return new Response(optimizedBytes, {
      headers: { "content-type": "image/png" },
      status: 200,
    });
  };

  const { optimizeGeneratedImage } = await import(imageOptimizerModuleUrl);
  const result = await optimizeGeneratedImage({ bytes: Buffer.from("original"), filename: "image.png", mimeType: "image/png" });

  assert.equal(requestUrl, "https://example.test/optimize");
  assert.equal(requestInit.method, "POST");
  assert.equal(requestInit.headers.Authorization, "Bearer optimizer-token");
  assert.ok(requestInit.body instanceof FormData);
  assert.equal(requestInit.body.get("denoise"), "soft");
  assert.equal(requestInit.body.get("radius"), "3");
  assert.equal(requestInit.body.get("strength"), "35");
  assert.deepEqual(result.bytes, optimizedBytes);
  assert.equal(result.mimeType, "image/png");
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
