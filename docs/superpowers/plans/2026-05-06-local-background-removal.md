# Local Background Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the AI-based “删除背景” action with a local pure-color background removal path that preserves subject colors and outputs a PNG with alpha transparency.

**Architecture:** Add a server-side image utility using `sharp` to sample edge background colors and alpha out similar connected edge pixels. Expose it through a new authenticated asset route that creates a new generated asset for the same board. Update the existing right-click `删除背景` action to call this route and insert the returned asset onto the canvas.

**Tech Stack:** Next.js App Router, TypeScript, Prisma, SQLite, `sharp`, existing local asset storage helpers, existing tldraw board insertion flow.

---

## File Structure

- Create `src/lib/background-removal.ts`: pure server utility for edge-color sampling and transparent PNG generation.
- Create `scripts/check-background-removal.mjs`: executable regression check that creates synthetic images and verifies alpha output without requiring a browser.
- Create `src/app/api/assets/[assetId]/remove-background/route.ts`: authenticated POST endpoint that verifies ownership, processes the source asset, stores a new PNG asset, and returns it.
- Modify `src/components/BoardWorkspace.tsx`: change `removeSelectedImageBackground` to call the local route instead of `/api/generation-jobs`.
- Modify `package.json`: add a `check:background-removal` script for the regression check.

### Task 1: Local Background Removal Utility

**Files:**
- Create: `src/lib/background-removal.ts`
- Create: `scripts/check-background-removal.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing regression script**

Create `scripts/check-background-removal.mjs` with this complete content:

```js
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

console.log("background removal check passed");
```

- [ ] **Step 2: Add the check script to `package.json`**

Modify the `scripts` block in `package.json` to include:

```json
"check:background-removal": "node scripts/check-background-removal.mjs"
```

The scripts block should become:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "db:generate": "prisma generate",
  "db:init": "node scripts/init-db.mjs",
  "start": "next start",
  "lint": "eslint",
  "check:background-removal": "node scripts/check-background-removal.mjs"
}
```

- [ ] **Step 3: Run the regression script to verify it fails**

Run:

```bash
npm run check:background-removal
```

Expected: FAIL because `src/lib/background-removal.ts` does not exist or does not export `removePureColorBackground`.

- [ ] **Step 4: Implement the local utility**

Create `src/lib/background-removal.ts` with this complete content:

```ts
import sharp from "sharp";

type Rgb = { r: number; g: number; b: number };

const DEFAULT_TOLERANCE = 42;
const DEFAULT_EDGE_SAMPLE_STEP = 4;

export async function removePureColorBackground(input: Buffer) {
  const { data, info } = await sharp(input, { limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const background = sampleEdgeBackgroundColor(data, info.width, info.height, info.channels);
  const output = Buffer.from(data);
  const visited = new Uint8Array(info.width * info.height);
  const queue: Array<[number, number]> = [];

  function enqueue(x: number, y: number) {
    if (x < 0 || y < 0 || x >= info.width || y >= info.height) return;
    const pixelIndex = y * info.width + x;
    if (visited[pixelIndex]) return;
    visited[pixelIndex] = 1;
    queue.push([x, y]);
  }

  for (let x = 0; x < info.width; x += 1) {
    enqueue(x, 0);
    enqueue(x, info.height - 1);
  }
  for (let y = 1; y < info.height - 1; y += 1) {
    enqueue(0, y);
    enqueue(info.width - 1, y);
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const [x, y] = current;
    const offset = (y * info.width + x) * info.channels;
    if (!isNearBackground(data, offset, background, DEFAULT_TOLERANCE)) continue;

    output[offset + 3] = 0;
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }

  featherAlphaEdges(output, info.width, info.height, info.channels);

  return sharp(output, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .png()
    .toBuffer();
}

function sampleEdgeBackgroundColor(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
): Rgb {
  const samples: Rgb[] = [];

  function sample(x: number, y: number) {
    const offset = (y * width + x) * channels;
    samples.push({ r: data[offset], g: data[offset + 1], b: data[offset + 2] });
  }

  for (let x = 0; x < width; x += DEFAULT_EDGE_SAMPLE_STEP) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 0; y < height; y += DEFAULT_EDGE_SAMPLE_STEP) {
    sample(0, y);
    sample(width - 1, y);
  }

  return {
    r: median(samples.map((sample) => sample.r)),
    g: median(samples.map((sample) => sample.g)),
    b: median(samples.map((sample) => sample.b)),
  };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function isNearBackground(data: Buffer, offset: number, background: Rgb, tolerance: number) {
  const distance = Math.sqrt(
    (data[offset] - background.r) ** 2 +
      (data[offset + 1] - background.g) ** 2 +
      (data[offset + 2] - background.b) ** 2,
  );
  return distance <= tolerance;
}

function featherAlphaEdges(data: Buffer, width: number, height: number, channels: number) {
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      alpha[y * width + x] = data[(y * width + x) * channels + 3];
    }
  }

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const pixelIndex = y * width + x;
      if (alpha[pixelIndex] !== 255) continue;
      const hasTransparentNeighbor =
        alpha[pixelIndex - 1] === 0 ||
        alpha[pixelIndex + 1] === 0 ||
        alpha[pixelIndex - width] === 0 ||
        alpha[pixelIndex + width] === 0;
      if (hasTransparentNeighbor) {
        data[pixelIndex * channels + 3] = 220;
      }
    }
  }
}
```

- [ ] **Step 5: Run the regression script to verify it passes**

Run:

```bash
npm run check:background-removal
```

Expected: PASS with `background removal check passed`.

### Task 2: Authenticated Remove-Background API Route

**Files:**
- Create: `src/app/api/assets/[assetId]/remove-background/route.ts`
- Modify: `scripts/check-background-removal.mjs`

- [ ] **Step 1: Extend the regression script to verify route existence**

Append this check to `scripts/check-background-removal.mjs` before the final `console.log`:

```js
await import("../src/app/api/assets/[assetId]/remove-background/route.ts");
```

- [ ] **Step 2: Run the regression script to verify it fails**

Run:

```bash
npm run check:background-removal
```

Expected: FAIL because the route file does not exist.

- [ ] **Step 3: Implement the route**

Create `src/app/api/assets/[assetId]/remove-background/route.ts` with this complete content:

```ts
import { requireCurrentUser } from "@/lib/auth-guards";
import { jsonError } from "@/lib/api";
import { createProjectTimestampFilename } from "@/lib/filenames";
import { removePureColorBackground } from "@/lib/background-removal";
import { prisma } from "@/lib/prisma";
import { readOwnedAssetBytes, saveLocalAsset } from "@/lib/storage";
import sharp from "sharp";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const currentUser = await requireCurrentUser();
  if (!currentUser.ok) {
    return currentUser.response;
  }

  const { assetId } = await params;
  const { asset, bytes } = await readOwnedAssetBytes(assetId, currentUser.user.id);
  if (!asset.mimeType.startsWith("image/")) {
    return jsonError("只能处理图片素材", 400);
  }

  const board = await prisma.board.findFirst({
    where: { id: asset.boardId, userId: currentUser.user.id },
    select: { name: true },
  });
  if (!board) {
    return jsonError("Board not found", 404);
  }

  const output = await removePureColorBackground(bytes);
  const metadata = await sharp(output, { limitInputPixels: false }).metadata();
  const filename = createProjectTimestampFilename(board.name, "png", {
    username: currentUser.user.username ?? currentUser.user.name,
  });
  const removedAsset = await saveLocalAsset({
    boardId: asset.boardId,
    kind: "generated",
    bytes: output,
    filename,
    mimeType: "image/png",
    width: metadata.width,
    height: metadata.height,
  });

  return Response.json({ asset: removedAsset });
}
```

- [ ] **Step 4: Run the regression script to verify it passes**

Run:

```bash
npm run check:background-removal
```

Expected: PASS with `background removal check passed`.

### Task 3: Frontend Wiring

**Files:**
- Modify: `src/components/BoardWorkspace.tsx:2650-2663`

- [ ] **Step 1: Write a failing static check for local endpoint usage**

Add this block to `scripts/check-background-removal.mjs` before the final `console.log`:

```js
const workspaceSource = await readFile("src/components/BoardWorkspace.tsx", "utf8");
if (!workspaceSource.includes("/remove-background")) {
  throw new Error("BoardWorkspace must call the local remove-background endpoint");
}
if (workspaceSource.includes('operation: "remove_background"')) {
  throw new Error("BoardWorkspace must not use the AI generation operation for remove background");
}
```

- [ ] **Step 2: Run the regression script to verify it fails**

Run:

```bash
npm run check:background-removal
```

Expected: FAIL because `BoardWorkspace` still calls the AI generation path with `operation: "remove_background"`.

- [ ] **Step 3: Replace `removeSelectedImageBackground` with local route call**

In `src/components/BoardWorkspace.tsx`, replace the body of `removeSelectedImageBackground` with:

```tsx
  function removeSelectedImageBackground() {
    startTransition(async () => {
      try {
        const source = getSelectedImageAsset(editorRef.current, board.assets) ?? sourceAsset;
        if (!source) throw new Error("请先选择一张图片");
        setStatus("正在本地删除纯色背景");
        setGenerationNotice(null);

        const response = await fetch(`/api/assets/${source.id}/remove-background`, {
          method: "POST",
        });
        const payload = (await response.json()) as { asset?: AssetPayload; error?: string };
        if (!response.ok || !payload.asset) {
          throw new Error(payload.error ?? "删除背景失败");
        }

        mergeAssetsIntoBoard([payload.asset]);
        await insertAsset(payload.asset, getSelectedImagePlacement(editorRef.current), 1);
        void refreshBoard().catch(() => undefined);
        setStatus("已生成本地透明背景 PNG");
        setGenerationNotice({ scope: "edit", tone: "success", text: "已生成本地透明背景 PNG" });
      } catch (error) {
        const errorText = getFriendlyErrorMessage(error, "删除背景失败");
        setStatus(errorText);
        setGenerationNotice({ scope: "edit", tone: "error", text: errorText });
      }
    });
  }
```

Then remove `operation?: "remove_background"` from the `generateImageEdit` input type and remove `operation: input.operation` from its JSON body if no other caller uses it.

- [ ] **Step 4: Run the regression script to verify it passes**

Run:

```bash
npm run check:background-removal
```

Expected: PASS with `background removal check passed`.

### Task 4: Final Verification and Service Restart

**Files:**
- No additional code files.

- [ ] **Step 1: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS with no ESLint errors.

- [ ] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected: PASS with `✓ Compiled successfully`.

- [ ] **Step 3: Restart production service**

Run:

```bash
pkill -f "next start --port 3333" || true
pkill -f "next-server" || true
nohup npm run start -- --port 3333 > /tmp/tldraw-ai-board-3333.log 2>&1 &
```

Expected: command exits successfully.

- [ ] **Step 4: Verify service is reachable**

Run:

```bash
curl -I http://localhost:3333
```

Expected: `HTTP/1.1 307 Temporary Redirect` with `location: /login`.

## Self-Review

- Spec coverage: covers local pure-color background removal, new API route, frontend right-click integration, regression checks, build, and restart.
- Placeholder scan: no placeholders, TBDs, or incomplete steps remain.
- Type consistency: route returns `{ asset }`; frontend expects `{ asset?: AssetPayload; error?: string }`; utility exports `removePureColorBackground(input: Buffer)`.
- Scope check: focused on local pure-color background removal only; does not introduce model-based segmentation or manual mask editing.
