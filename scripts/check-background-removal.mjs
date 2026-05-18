import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const tmpDir = path.join(process.cwd(), "tmp", "background-removal-check");
await mkdir(tmpDir, { recursive: true });

const inputPath = path.join(tmpDir, "input.png");
const outputPath = path.join(tmpDir, "output.png");

const width = 64;
const height = 64;
const rgba = Buffer.alloc(width * height * 4);

for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const i = (y * width + x) * 4;
    const isSubject = x >= 20 && x <= 43 && y >= 16 && y <= 47;
    rgba[i] = isSubject ? 210 : 248;
    rgba[i + 1] = isSubject ? 32 : 248;
    rgba[i + 2] = isSubject ? 48 : 248;
    rgba[i + 3] = 255;
  }
}

await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toFile(inputPath);

const { removePureColorBackground } = await import("../src/lib/background-removal.ts");
const output = await removePureColorBackground(await readFile(inputPath));
await writeFile(outputPath, output);

const { data, info } = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

function alphaAt(x, y) {
  return data[(y * info.width + x) * info.channels + 3];
}

if (info.width !== width || info.height !== height) {
  throw new Error(`Expected ${width}x${height}, got ${info.width}x${info.height}`);
}

if (alphaAt(0, 0) !== 0 || alphaAt(63, 63) !== 0) {
  throw new Error("Expected sampled edge background pixels to be fully transparent");
}

if (alphaAt(32, 32) !== 255) {
  throw new Error("Expected subject center pixel to remain fully opaque");
}

const centerIndex = (32 * info.width + 32) * info.channels;
const centerRgb = [data[centerIndex], data[centerIndex + 1], data[centerIndex + 2]];
if (centerRgb.join(",") !== "210,32,48") {
  throw new Error(`Expected subject RGB to be preserved, got ${centerRgb.join(",")}`);
}

const routeSource = await readFile(
  "server/routes/assets.ts",
  "utf8",
);
if (!routeSource.includes('app.post<{ Params: { assetId: string } }>("/api/assets/:assetId/remove-background"')) {
  throw new Error("Fastify assets route must register the remove-background POST endpoint");
}

const workspaceSource = await readFile("src/components/BoardWorkspace.tsx", "utf8");
if (!workspaceSource.includes("/remove-background")) {
  throw new Error("BoardWorkspace must call the local remove-background endpoint");
}
if (workspaceSource.includes('operation: "remove_background"')) {
  throw new Error("BoardWorkspace must not use the AI generation operation for remove background");
}

const aiWrapperSource = await readFile("src/lib/ai-background-removal.ts", "utf8");
if (!aiWrapperSource.includes("removeBackgroundWithLocalAi")) {
  throw new Error("AI background removal wrapper must export removeBackgroundWithLocalAi");
}
if (!aiWrapperSource.includes("remove-background-ai.py")) {
  throw new Error("AI wrapper must call scripts/remove-background-ai.py");
}

if (!routeSource.includes("removeBackgroundWithLocalAi")) {
  throw new Error("Fastify remove-background route must try local AI matting first");
}
if (!routeSource.includes("removePureColorBackground")) {
  throw new Error("Fastify remove-background route must keep pure-color fallback");
}

console.log("background removal check passed");
