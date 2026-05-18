# Storyboard Frame Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 2A of the storyboard workbench: generate start-frame and end-frame images from saved shot prompts, save them as normal board assets, and bind the generated asset back to the shot.

**Status:** Implemented in commits `baad6c5`, `9117c2a`, and `0680fd4`. Documentation and smoke coverage are being updated in this follow-up step.

**Architecture:** Reuse the existing OpenAI-compatible image generation path instead of creating a separate media-task system. Extract the current `/api/generation-jobs` creation and execution logic into a shared server service, then add storyboard-specific frame-generation routes that call that service with a fixed `text_to_image` image request and update `StoryboardShot.startFrameAssetId` or `StoryboardShot.endFrameAssetId` with the first generated asset. Keep video generation, video assets, frame comparison, and timeline composition out of scope.

**Tech Stack:** Fastify, Prisma/SQLite, React 19, Vite, OpenAI-compatible Images API, Zod, Node test runner, Playwright smoke script.

---

## Scope

Included:

- Generate a start-frame image from `StoryboardShot.startFramePrompt`.
- Generate an end-frame image from `StoryboardShot.endFramePrompt`.
- Persist the image through the existing `GenerationJob`, `GenerationResult`, and `Asset` tables.
- Store storyboard provenance in `GenerationJob.paramsJson`.
- Bind the generated image asset back to `startFrameAssetId` or `endFrameAssetId`.
- Refresh the board/storyboard frontend state after generation.
- Replace disabled Phase 2 placeholders with working buttons.

Excluded:

- Video provider settings.
- Video generation jobs.
- Video assets or previews.
- Batch frame generation across all shots.
- Frame compare/regenerate gallery UI.
- New database tables.

## File Structure

- Modify `server/routes/generation-jobs.ts`
  - Keep route validation and HTTP response handling.
  - Replace duplicated inline generation internals with calls to a shared service.
- Create `server/generation-job-service.ts`
  - Own image-generation input validation types, quota checks, provider checks, job creation, image execution, result persistence, and formatted job lookup.
- Modify `server/routes/storyboards.ts`
  - Add `POST /api/boards/:boardId/storyboard/shots/:shotId/generate-frame`.
  - Validate `frame: "start" | "end"` and optional `size`.
  - Call the shared generation service and update the shot frame asset binding.
- Modify `src/components/board-canvas/types.ts`
  - Add generated job/result payload types if the storyboard route returns them to the client.
- Modify `src/components/storyboard/StoryboardWorkspace.tsx`
  - Replace the disabled Phase 2 placeholder buttons with enabled start/end frame generation actions.
  - Show busy state and bind generated assets in the existing frame binding controls.
- Modify `src/components/BoardWorkspace.tsx`
  - Add a callback so storyboard frame generation can merge the returned `GenerationJob` and assets into the board state.
- Modify `server/storyboard-routes.test.mjs`
  - Add database schema setup for provider settings and generation tables if missing in a test case.
  - Add tests for frame prompt missing, wrong board ownership, successful start-frame generation binding, and successful end-frame generation binding.
- Modify `scripts/smoke-board.mjs`
  - Replace disabled placeholder assertions with UI assertions for enabled frame generation controls when prompts exist.
  - Keep the no-video assertion by checking there is no video generation control.
- Modify `README.md`
  - Update storyboard workbench docs after implementation.
- Modify `docs/storyboard-image-video-workbench-prd.md`
  - Mark Phase 2A frame image generation as started/completed after implementation.

---

## Task 1: Extract Shared Image Generation Service

**Files:**

- Create: `server/generation-job-service.ts`
- Modify: `server/routes/generation-jobs.ts`
- Test: `server/generation-jobs-routes.test.mjs`

- [ ] **Step 1: Create the service file with exported input types**

Create `server/generation-job-service.ts` with the shared route-independent surface:

```ts
import { toFile } from "openai/uploads";
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";

import { createProjectTimestampFilename } from "@/lib/filenames";
import type { Asset, GenerationJob, ProviderSetting, User } from "@/generated/prisma/client";
import { dimensionsFromSize, isValidImageSize, type ImageSize } from "@/lib/image";
import { saveGeneratedImageArchive, saveLocalExport } from "@/lib/local-export";
import { createOpenAIClient, getImageModel } from "@/lib/openai";
import { prisma } from "@/lib/prisma";
import { isReferenceRole, referenceRoleValues } from "@/lib/reference-roles";
import { AssetFileMissingError, readBoardAssetBytes, saveLocalAsset } from "@/lib/storage";
import { getProviderSetting } from "./provider-settings-helper";

export const storyboardFrameValues = ["start", "end"] as const;
export type StoryboardFrameKind = (typeof storyboardFrameValues)[number];

export const referenceItemSchema = z.object({
  assetId: z.string().min(1),
  role: z.string().refine(isReferenceRole, `Invalid reference role. Expected one of: ${referenceRoleValues.join(", ")}`).optional(),
  weight: z.enum(["low", "medium", "high"]).optional(),
});

export const imageGenerationInputSchema = z.object({
  boardId: z.string().min(1),
  count: z.number().int().min(1).max(3).default(1),
  maskAssetId: z.string().optional(),
  mode: z.enum(["text_to_image", "inpaint"]),
  model: z.string().trim().min(1).max(120).optional(),
  prompt: z.string().trim().min(1).max(32000),
  referenceAssetIds: z.array(z.string().min(1)).max(8).default([]),
  referenceItems: z.array(referenceItemSchema).max(8).optional(),
  replacementType: z.string().trim().max(80).optional(),
  size: z.string().refine(isValidImageSize, "Invalid gpt-image-2 image size").default("1024x1024"),
  sourceAssetId: z.string().optional(),
});

export type ImageGenerationInput = z.infer<typeof imageGenerationInputSchema>;

export type CreateGenerationJobInput = {
  boardName: string;
  generation: ImageGenerationInput;
  log?: FastifyBaseLogger;
  paramsMetadata?: Record<string, unknown>;
  user: Pick<User, "canUseAdminProvider" | "generationFiveHourLimit" | "generationLimit" | "id" | "name" | "username">;
};
```

- [ ] **Step 2: Move quota, provider, and linked-asset validation into the service**

Add this function in `server/generation-job-service.ts`:

```ts
export async function createAndRunImageGenerationJob(input: CreateGenerationJobInput) {
  const providerSetting = await getProviderSetting(input.user.id, input.user.canUseAdminProvider);
  const providerOwner = providerSetting?.userId === input.user.id ? "self" : "admin";
  if (!providerSetting?.enabled) {
    return { ok: false as const, error: "请配置第三方 API 或联系管理员授权使用当前 API", statusCode: 400 };
  }

  const model = input.generation.model ?? getImageModel(providerSetting);
  const quotaError = await getGenerationQuotaError({
    count: input.generation.count,
    generationFiveHourLimit: input.user.generationFiveHourLimit,
    generationLimit: input.user.generationLimit,
    userId: input.user.id,
  });
  if (quotaError) return { ok: false as const, error: quotaError, statusCode: 429 };

  const referenceItems = input.generation.referenceItems?.length
    ? input.generation.referenceItems
    : input.generation.referenceAssetIds.map((assetId) => ({ assetId }));
  const referenceAssetIds = referenceItems.map((item) => item.assetId);
  if (input.generation.mode === "inpaint" && !input.generation.sourceAssetId) {
    return { ok: false as const, error: "sourceAssetId is required for image edit mode", statusCode: 400 };
  }

  const linkedAssetIds = Array.from(new Set([
    input.generation.sourceAssetId,
    input.generation.maskAssetId,
    ...referenceAssetIds,
  ].filter((assetId): assetId is string => Boolean(assetId))));

  if (linkedAssetIds.length > 0) {
    const linkedAssetCount = await prisma.asset.count({
      where: { boardId: input.generation.boardId, id: { in: linkedAssetIds } },
    });
    if (linkedAssetCount !== linkedAssetIds.length) {
      return { ok: false as const, error: "Referenced asset not found", statusCode: 404 };
    }
  }

  const paramsJson = JSON.stringify({
    size: input.generation.size,
    count: input.generation.count,
    model,
    providerSettingId: providerSetting.id,
    providerDisplayName: providerSetting.displayName,
    providerOwner,
    providerBaseUrl: providerSetting.baseUrl ? "configured" : "default",
    referenceAssetIds,
    referenceItems,
    replacementType: input.generation.replacementType,
    ...input.paramsMetadata,
  });

  const job = await prisma.generationJob.create({
    data: {
      boardId: input.generation.boardId,
      maskAssetId: input.generation.maskAssetId,
      mode: input.generation.mode,
      paramsJson,
      prompt: input.generation.prompt,
      provider: providerSetting.provider,
      sourceAssetId: input.generation.sourceAssetId,
      status: "running",
    },
  });

  try {
    const savedAssets = await runGenerationJob({
      boardName: input.boardName,
      input: { ...input.generation, referenceAssetIds },
      job,
      model,
      providerSetting,
      user: { id: input.user.id, name: input.user.name, username: input.user.username },
    });
    const updatedJob = await prisma.generationJob.findUnique({
      where: { id: job.id },
      include: { results: { include: { asset: true } } },
    });
    return {
      ok: true as const,
      job: updatedJob ?? {
        ...job,
        paramsJson,
        results: savedAssets.map((asset: Asset) => ({ asset })),
        status: "succeeded",
        updatedAt: new Date(),
      },
      model,
      results: savedAssets,
    };
  } catch (error) {
    const message = formatGenerationError(error, {
      model,
      providerBaseUrl: providerSetting.baseUrl,
      providerBaseUrlConfigured: Boolean(providerSetting.baseUrl),
      providerDisplayName: providerSetting.displayName,
    });
    await prisma.generationJob.update({ where: { id: job.id }, data: { errorMessage: message, status: "failed" } });
    input.log?.error({ err: error }, "image generation failed");
    return { ok: false as const, error: message, statusCode: 500 };
  }
}
```

- [ ] **Step 3: Move existing helper functions without changing behavior**

Move the existing helper functions from `server/routes/generation-jobs.ts` into `server/generation-job-service.ts`:

```ts
async function runGenerationJob(input: {
  boardName: string;
  input: ImageGenerationInput & { referenceAssetIds: string[] };
  job: Pick<GenerationJob, "createdAt" | "id">;
  model: string;
  providerSetting: ProviderSetting;
  user: { id: string; name: string | null; username: string | null };
}) {
  const openai = createOpenAIClient(input.providerSetting);
  const results = [];
  for (let index = 0; index < input.input.count; index += 1) {
    const result = input.input.mode === "text_to_image"
      ? input.input.referenceAssetIds.length > 0
        ? await generateReferencedTextToImage({ boardId: input.input.boardId, model: input.model, openai, prompt: input.input.prompt, referenceAssetIds: input.input.referenceAssetIds, size: input.input.size as ImageSize })
        : await openai.images.generate({ model: input.model, prompt: input.input.prompt, size: input.input.size as never, quality: "auto", output_format: "png", n: 1 })
      : await generateInpaint({ boardId: input.input.boardId, maskAssetId: input.input.maskAssetId, model: input.model, openai, prompt: input.input.prompt, referenceAssetIds: input.input.referenceAssetIds, size: input.input.size as ImageSize, sourceAssetId: input.input.sourceAssetId! });
    results.push(result);
  }

  const images = results.flatMap((result) => result.data ?? []);
  if (images.length !== input.input.count) throw new Error(`OpenAI returned ${images.length} of ${input.input.count} requested images`);
  const { width, height } = dimensionsFromSize(input.input.size as ImageSize);
  const savedAssets = await Promise.all(images.map(async (image, index) => {
    if (!image.b64_json) throw new Error("OpenAI returned an image without b64_json");
    const bytes = Buffer.from(image.b64_json, "base64");
    const filename = createProjectTimestampFilename(input.boardName, "png", {
      date: input.job.createdAt,
      index: images.length > 1 ? index : undefined,
      username: input.user.username ?? input.user.name,
    });
    await saveLocalExport({ bytes, filename, projectName: input.boardName });
    await saveGeneratedImageArchive({ bytes, filename, username: input.user.username ?? input.user.id });
    return saveLocalAsset({ boardId: input.input.boardId, kind: "generated", bytes, filename, height, mimeType: "image/png", width });
  }));

  await prisma.$transaction([
    prisma.generationJob.update({ where: { id: input.job.id }, data: { status: "succeeded" } }),
    ...savedAssets.map((asset: Asset) => prisma.generationResult.create({ data: { assetId: asset.id, jobId: input.job.id } })),
  ]);
  return savedAssets;
}
```

Also move `generateReferencedTextToImage`, `generateInpaint`, `toImageInput`, `getGenerationQuotaError`, and `formatGenerationError` unchanged.

- [ ] **Step 4: Simplify the existing generation route**

In `server/routes/generation-jobs.ts`, replace the local schema and helper usage with:

```ts
import type { FastifyInstance } from "fastify";

import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "../auth";
import { jsonError, parseBody } from "../http";
import { createAndRunImageGenerationJob, imageGenerationInputSchema } from "../generation-job-service";

const STALE_RUNNING_JOB_MINUTES = 30;
const STALE_RUNNING_JOB_MESSAGE = "任务运行超过 30 分钟，已在服务启动时标记为失败，请重新提交生成任务";

export async function registerGenerationJobRoutes(app: FastifyInstance) {
  await markStaleRunningJobsFailed(app);

  app.post("/api/generation-jobs", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const parsed = parseBody(imageGenerationInputSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const board = await prisma.board.findFirst({
      where: { id: parsed.data.boardId, userId: user.id },
      select: { id: true, name: true },
    });
    if (!board) return jsonError(reply, "Board not found", 404);

    const result = await createAndRunImageGenerationJob({
      boardName: board.name,
      generation: parsed.data,
      log: request.log,
      user,
    });
    if (!result.ok) return jsonError(reply, result.error, result.statusCode);
    return { job: result.job, model: result.model, results: result.results };
  });

  app.get<{ Params: { jobId: string } }>("/api/generation-jobs/:jobId", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const job = await prisma.generationJob.findFirst({
      where: { id: request.params.jobId, board: { userId: user.id } },
      include: { results: { include: { asset: true } } },
    });
    if (!job) return jsonError(reply, "Generation job not found", 404);
    return { job, results: job.results.map((result) => result.asset) };
  });
}
```

- [ ] **Step 5: Run the existing route test**

Run:

```powershell
npm run build
node server/generation-jobs-routes.test.mjs
```

Expected: both commands pass. The generation route test should still return the same sanitized missing-file error.

- [ ] **Step 6: Commit**

```powershell
git add server/generation-job-service.ts server/routes/generation-jobs.ts server/generation-jobs-routes.test.mjs
git commit -m "refactor: share image generation jobs"
```

---

## Task 2: Add Storyboard Frame Generation Route

**Files:**

- Modify: `server/routes/storyboards.ts`
- Test: `server/storyboard-routes.test.mjs`

- [ ] **Step 1: Add route request schema**

Near the existing storyboard schemas in `server/routes/storyboards.ts`, add:

```ts
const generateFrameSchema = z.object({
  frame: z.enum(["start", "end"]),
  size: z.string().regex(/^\d+x\d+$/).default("1024x1024"),
});
```

Use the shared `imageGenerationInputSchema` size validator instead if Task 1 exports a reusable `imageSizeSchema`.

- [ ] **Step 2: Add the frame route**

After the prompt-generation routes in `server/routes/storyboards.ts`, add:

```ts
  app.post<{ Params: { boardId: string; shotId: string } }>("/api/boards/:boardId/storyboard/shots/:shotId/generate-frame", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const parsed = parseBody(generateFrameSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const board = await findOwnedBoard(user.id, request.params.boardId);
    if (!board) return jsonError(reply, "Board not found", 404);
    const shot = await findOwnedShot(board.id, request.params.shotId);
    if (!shot) return jsonError(reply, "Shot not found", 404);

    const prompt = parsed.data.frame === "start" ? shot.startFramePrompt : shot.endFramePrompt;
    if (!prompt.trim()) {
      return jsonError(reply, parsed.data.frame === "start" ? "请先生成或填写首帧提示词" : "请先生成或填写尾帧提示词", 400);
    }

    const result = await createAndRunImageGenerationJob({
      boardName: board.name,
      generation: {
        boardId: board.id,
        count: 1,
        mode: "text_to_image",
        prompt,
        referenceAssetIds: [],
        size: parsed.data.size,
      },
      log: request.log,
      paramsMetadata: {
        storyboardFrame: {
          frame: parsed.data.frame,
          shotId: shot.id,
          shotIndex: shot.shotIndex,
          storyboardProjectId: shot.projectId,
        },
      },
      user,
    });
    if (!result.ok) return jsonError(reply, result.error, result.statusCode);

    const asset = result.results[0];
    if (!asset) return jsonError(reply, "首尾帧生成没有返回图片素材", 502);

    const updated = await prisma.storyboardShot.update({
      data: parsed.data.frame === "start"
        ? { startFrameAssetId: asset.id, status: getFrameReadyStatus(shot, "start") }
        : { endFrameAssetId: asset.id, status: getFrameReadyStatus(shot, "end") },
      where: { id: shot.id },
    });
    return { asset, frame: parsed.data.frame, job: result.job, shot: formatStoryboardShot(updated) };
  });
```

- [ ] **Step 3: Add status helper**

Add this helper near other route helpers:

```ts
function getFrameReadyStatus(shot: StoryboardShot, generatedFrame: "end" | "start") {
  const hasStart = generatedFrame === "start" || Boolean(shot.startFrameAssetId);
  const hasEnd = generatedFrame === "end" || Boolean(shot.endFrameAssetId);
  return hasStart && hasEnd ? "frames_ready" : shot.status;
}
```

- [ ] **Step 4: Import shared service**

At the top of `server/routes/storyboards.ts`, add:

```ts
import { createAndRunImageGenerationJob } from "../generation-job-service";
```

- [ ] **Step 5: Add server tests**

In `server/storyboard-routes.test.mjs`, add tests using `app.inject`:

```js
test("POST /api/boards/:boardId/storyboard/shots/:shotId/generate-frame requires a saved frame prompt", async () => {
  const app = await createTestApp();
  try {
    await withTestUser(async (user) => {
      await createProviderFor(user.id);
      const board = await createBoardFor(user.id);
      const project = await prisma.storyboardProject.create({
        data: { boardId: board.id, briefJson: JSON.stringify({ targetPlatform: "douyin" }), title: "Frames" },
      });
      const shot = await prisma.storyboardShot.create({
        data: { action: "展示产品", projectId: project.id, shotIndex: 1 },
      });
      const response = await app.inject({
        body: { frame: "start" },
        headers: { cookie: await sessionCookieFor(user.id) },
        method: "POST",
        url: `/api/boards/${board.id}/storyboard/shots/${shot.id}/generate-frame`,
      });
      assert.equal(response.statusCode, 400);
      assert.match(JSON.parse(response.body).error, /首帧提示词/);
    });
  } finally {
    await app.close();
  }
});
```

For success tests, inject a fake image generation service if Task 1 exposes dependency injection. If not, add a `createStoryboardRoutes({ runImageGenerationJob })` test hook:

```ts
export type StoryboardRoutesOptions = {
  callTextModel?: StoryboardTextModelCaller;
  runImageGenerationJob?: typeof createAndRunImageGenerationJob;
};
```

Then test:

```js
test("POST /api/boards/:boardId/storyboard/shots/:shotId/generate-frame binds generated start frame", async () => {
  const app = await createTestApp({
    runImageGenerationJob: async () => ({
      ok: true,
      model: "gpt-image-2",
      results: [{ id: "generated-start", boardId: "board", kind: "generated", publicUrl: "/api/assets/generated-start/file", mimeType: "image/png", width: 1024, height: 1024, sizeBytes: 12, isFavorite: false, tagsJson: null, createdAt: new Date() }],
      job: { id: "job-start", results: [], mode: "text_to_image", status: "succeeded", prompt: "start prompt", paramsJson: "{}", sourceAssetId: null, errorMessage: null, createdAt: new Date(), updatedAt: new Date() },
    }),
  });
  try {
    await withTestUser(async (user) => {
      const board = await createBoardFor(user.id);
      const project = await prisma.storyboardProject.create({
        data: { boardId: board.id, briefJson: JSON.stringify({ targetPlatform: "douyin" }), title: "Frames" },
      });
      const shot = await prisma.storyboardShot.create({
        data: { projectId: project.id, shotIndex: 1, startFramePrompt: "start prompt" },
      });
      const response = await app.inject({
        body: { frame: "start" },
        headers: { cookie: await sessionCookieFor(user.id) },
        method: "POST",
        url: `/api/boards/${board.id}/storyboard/shots/${shot.id}/generate-frame`,
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.frame, "start");
      assert.equal(body.shot.startFrameAssetId, "generated-start");
    });
  } finally {
    await app.close();
  }
});
```

Add the matching end-frame test and a cross-user 404 test.

- [ ] **Step 6: Run tests**

Run:

```powershell
npm run build
node server/storyboard-routes.test.mjs
```

Expected: build passes, storyboard route tests pass.

- [ ] **Step 7: Commit**

```powershell
git add server/routes/storyboards.ts server/storyboard-routes.test.mjs
git commit -m "feat: generate storyboard frame assets"
```

---

## Task 3: Wire Frontend Frame Generation

**Files:**

- Modify: `src/components/board-canvas/types.ts`
- Modify: `src/components/BoardWorkspace.tsx`
- Modify: `src/components/storyboard/StoryboardWorkspace.tsx`

- [ ] **Step 1: Add frontend response type**

In `src/components/storyboard/StoryboardWorkspace.tsx`, add:

```ts
type GenerateFrameResponse = {
  asset: AssetPayload;
  frame: "end" | "start";
  job: unknown;
  shot: StoryboardShotPayload;
};
```

If `BoardWorkspace` needs a concrete job type, import `JobPayload` from `src/components/board-canvas/types.ts` and use:

```ts
import type { AssetPayload, JobPayload, StoryboardBriefPayload, StoryboardProjectPayload, StoryboardShotPayload } from "@/components/board-canvas/types";

type GenerateFrameResponse = {
  asset: AssetPayload;
  frame: "end" | "start";
  job: JobPayload;
  shot: StoryboardShotPayload;
};
```

- [ ] **Step 2: Add callback prop**

Extend `StoryboardWorkspaceProps`:

```ts
  onFrameGenerationComplete?: (payload: { asset: AssetPayload; job: JobPayload; shot: StoryboardShotPayload }) => void;
```

- [ ] **Step 3: Add generate function**

Inside `StoryboardWorkspace`, add:

```ts
  function generateShotFrame(frame: "end" | "start") {
    if (!selectedShot) return;
    const prompt = frame === "start" ? selectedShot.startFramePrompt : selectedShot.endFramePrompt;
    if (!prompt.trim()) {
      setNotice(frame === "start" ? "请先生成或填写首帧提示词" : "请先生成或填写尾帧提示词");
      return;
    }
    runAction(async () => {
      const payload = await apiJson<GenerateFrameResponse>(`/api/boards/${boardId}/storyboard/shots/${selectedShot.id}/generate-frame`, {
        body: JSON.stringify({ frame }),
        method: "POST",
      });
      replaceShotDraft(payload.shot);
      onFrameGenerationComplete?.({ asset: payload.asset, job: payload.job, shot: payload.shot });
      setNotice(frame === "start" ? "已生成并绑定首帧" : "已生成并绑定尾帧");
    });
  }
```

- [ ] **Step 4: Replace disabled placeholder UI**

Replace the `storyboard-frame-generation-placeholder` block with:

```tsx
                <div className="storyboard-frame-generation-panel" aria-label="首尾帧生成">
                  <div>
                    <span className="storyboard-phase-badge">图片生成</span>
                    <strong>首尾帧生成</strong>
                    <span>使用已保存的首帧/尾帧提示词创建图片任务，并自动绑定生成素材。</span>
                  </div>
                  <div>
                    <button
                      disabled={isBusy || !selectedShot.startFramePrompt.trim()}
                      onClick={() => generateShotFrame("start")}
                      title={!selectedShot.startFramePrompt.trim() ? "请先生成或填写首帧提示词" : "生成并绑定首帧图片"}
                      type="button"
                    >
                      生成首帧
                    </button>
                    <button
                      disabled={isBusy || !selectedShot.endFramePrompt.trim()}
                      onClick={() => generateShotFrame("end")}
                      title={!selectedShot.endFramePrompt.trim() ? "请先生成或填写尾帧提示词" : "生成并绑定尾帧图片"}
                      type="button"
                    >
                      生成尾帧
                    </button>
                  </div>
                </div>
```

- [ ] **Step 5: Merge generated job and asset into board state**

In `src/components/BoardWorkspace.tsx`, pass the callback into both desktop and mobile `StoryboardWorkspace` instances:

```tsx
          onFrameGenerationComplete={({ asset, job, shot }) => {
            mergeGenerationJobIntoBoard(job);
            setBoard((current) => ({
              ...current,
              assets: current.assets.some((item) => item.id === asset.id)
                ? current.assets
                : [asset, ...current.assets],
            }));
            setStoryboardProject((current) => current
              ? { ...current, shots: current.shots.map((item) => (item.id === shot.id ? shot : item)) }
              : current);
          }}
```

If `mergeGenerationJobIntoBoard` already inserts assets through `job.results`, avoid duplicating asset insertion by checking the existing implementation first.

- [ ] **Step 6: Run TypeScript build**

Run:

```powershell
npm run build
```

Expected: build passes with no TypeScript errors.

- [ ] **Step 7: Commit**

```powershell
git add src/components/board-canvas/types.ts src/components/BoardWorkspace.tsx src/components/storyboard/StoryboardWorkspace.tsx
git commit -m "feat: wire storyboard frame generation UI"
```

---

## Task 4: Update Smoke Coverage And Documentation

**Files:**

- Modify: `scripts/smoke-board.mjs`
- Modify: `README.md`
- Modify: `docs/storyboard-image-video-workbench-prd.md`
- Modify: `docs/superpowers/plans/2026-05-16-storyboard-copywriting-workbench.md`

- [ ] **Step 1: Update smoke assertions**

Replace `expectDisabledFrameGenerationPlaceholders` with a new assertion:

```js
async function expectFrameGenerationControls(page) {
  await page.getByText("首尾帧生成").waitFor({ timeout: 30000 });
  const startButton = page.getByRole("button", { name: "生成首帧" });
  const endButton = page.getByRole("button", { name: "生成尾帧" });
  await startButton.waitFor({ timeout: 30000 });
  await endButton.waitFor({ timeout: 30000 });
  assert(!(await startButton.isDisabled()), "expected start-frame generation button to be enabled when prompt exists");
  assert(!(await endButton.isDisabled()), "expected end-frame generation button to be enabled when prompt exists");
  assert((await page.getByRole("button", { name: /生成视频/ }).count()) === 0, "expected video generation to stay out of Phase 2A");
}
```

Update callers from `expectDisabledFrameGenerationPlaceholders(page)` to `expectFrameGenerationControls(page)`.

- [ ] **Step 2: Keep smoke offline-friendly**

Do not click the real frame-generation buttons in `scripts/smoke-board.mjs` unless the script is updated to run against a fake provider. The current smoke should assert UI availability and no layout regression, not spend external image-generation quota.

- [ ] **Step 3: Update README**

In `README.md`, change the storyboard paragraph so it says:

```md
分镜页支持从首帧/尾帧提示词创建图片生成任务，生成结果会作为普通素材进入画板，并自动绑定回当前镜头。视频生成仍未接入，不创建视频任务。
```

- [ ] **Step 4: Update PRD status**

In `docs/storyboard-image-video-workbench-prd.md`, add a Phase 2A note:

```md
### Phase 2A Scope Decision

第二期先拆为 Phase 2A：只接入首帧/尾帧图片生成并绑定回分镜镜头，继续复用现有图片生成 Provider 和 `GenerationJob`。视频模型、视频任务、视频资产、片段预览与整片导出仍留到 Phase 3。
```

- [ ] **Step 5: Run final verification**

Run:

```powershell
npm run build
node server/storyboard-routes.test.mjs
node server/generation-jobs-routes.test.mjs
```

If a local server is already running, run:

```powershell
npm run smoke:board
```

Expected: build and route tests pass. Smoke passes when a compatible local app server is available.

- [ ] **Step 6: Commit**

```powershell
git add scripts/smoke-board.mjs README.md docs/storyboard-image-video-workbench-prd.md docs/superpowers/plans/2026-05-16-storyboard-copywriting-workbench.md
git commit -m "docs: document storyboard frame generation"
```

---

## Review Checklist

- [ ] The existing `/api/generation-jobs` endpoint still accepts the same request body and returns the same `job`, `model`, and `results` shape.
- [ ] Storyboard frame generation checks board ownership through `findOwnedBoard` and `findOwnedShot`.
- [ ] Empty start/end prompt returns a 400 before creating a generation job.
- [ ] Generated assets are normal `Asset(kind="generated")` rows and normal `GenerationResult` rows.
- [ ] `paramsJson` includes `storyboardFrame.frame`, `storyboardFrame.shotId`, and `storyboardFrame.storyboardProjectId`.
- [ ] Generated start frame updates only `startFrameAssetId`.
- [ ] Generated end frame updates only `endFrameAssetId`.
- [ ] Shot status changes to `frames_ready` only after both frame asset ids exist.
- [ ] The UI keeps manual binding, preview, locate, and clear actions working.
- [ ] The UI does not expose video generation controls.
- [ ] No new database tables are introduced.

## Execution Notes

Run the full suite before release:

```powershell
npm test
```

For online update after implementation, follow the existing release flow used for `v0.1.10`: build, package, version bump, push, and publish into the update directory. Do not create a version until the UI has passed local smoke and manual review.
