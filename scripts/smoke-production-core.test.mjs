import assert from "node:assert/strict";
import test from "node:test";

import { extractAssetPaths } from "./smoke-production-core.mjs";

test("extractAssetPaths reads built css and js assets from index html", () => {
  const html = `
    <link rel="stylesheet" href="/assets/index-zHNkyaSF.css">
    <script type="module" src="/assets/index-CugdOVKW.js"></script>
  `;

  assert.deepEqual(extractAssetPaths(html), [
    "/assets/index-CugdOVKW.js",
    "/assets/index-zHNkyaSF.css",
  ]);
});
