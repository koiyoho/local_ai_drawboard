import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync("src/app/globals.css", "utf8");

test("result picker modal keeps candidate images prominent and actions compact", () => {
  assert.match(css, /\.result-picker-content\s*{[^}]*width:\s*min\(1120px,\s*calc\(100vw - 48px\)\)/s);
  assert.match(css, /\.result-picker-grid\s*{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(260px,\s*1fr\)\)/s);
  assert.match(css, /\.result-picker-preview\s*{[^}]*height:\s*clamp\(260px,\s*42dvh,\s*460px\)/s);
  assert.match(css, /\.result-picker-preview\s*{[^}]*min-height:\s*clamp\(240px,\s*34dvh,\s*420px\)/s);
  assert.match(css, /\.result-picker-preview\s*{[^}]*max-height:\s*clamp\(260px,\s*42dvh,\s*460px\)/s);
  assert.match(css, /\.result-picker-card-actions\s*{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
});
