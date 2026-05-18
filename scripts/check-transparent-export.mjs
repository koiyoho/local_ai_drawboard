import { readFile } from "node:fs/promises";

const source = await readFile("src/components/BoardWorkspace.tsx", "utf8");
const match = source.match(/function exportSelectionAsPng\(\) \{[\s\S]*?\n  \}/);

if (!match) {
  throw new Error("exportSelectionAsPng was not found");
}

const body = match[0];
if (body.includes("background: true")) {
  throw new Error("exportSelectionAsPng must not force an opaque canvas background");
}
if (!body.includes("editor.getInstanceState().exportBackground")) {
  throw new Error("exportSelectionAsPng must follow the tldraw transparent background toggle");
}

console.log("transparent export check passed");
