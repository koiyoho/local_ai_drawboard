# AI Generation Prompt Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add type-aware prompt-assist tools to the AI image generation workflow so users can improve, expand, structure, and apply prompts for posters, people, scenes, objects, brand graphics, and other image categories before generating images.

**Architecture:** Add a small server-side prompt-assist endpoint that reuses the existing OpenAI-compatible provider configuration and returns structured prompt suggestions. Add a focused frontend panel beside the AI 生图 textarea that lets users choose an image type and assist action, preview the result, apply it to the current prompt, or retry. Keep the actual image generation endpoint unchanged.

**Tech Stack:** React 19, Vite, Fastify, Zod, Prisma provider settings, OpenAI-compatible Responses/Chat Completions API, existing Playwright smoke test.

---

## Scope

This plan implements prompt assistance only for the `AI 生图` prompt (`sourcePrompt`). It does not change image generation models, quota accounting, generation history, image editing prompts, or reference image reverse-prompt behavior.

The first version should support four actions:

- `optimize`: polish the current prompt while preserving the user's intent.
- `expand`: add subject, scene, lighting, composition, material, and style details.
- `variations`: return three alternate prompt directions.
- `translate`: convert mixed Chinese/English input into a clean Chinese prompt suitable for image generation.

The first version should support these image types:

- `auto`: automatically infer the image type from the user's prompt.
- `poster`: advertising poster, event poster, social media poster, product campaign poster, or matchday poster.
- `person`: portrait, character, athlete, fashion model, mascot, or other person-centered image.
- `scene`: indoor/outdoor environment, stadium, street, landscape, room, or atmosphere-centered image.
- `object`: product, prop, equipment, trophy, clothing, packaging, or other object-centered image.
- `brand`: logo, badge, emblem, icon, visual identity, or brand graphic.
- `other`: illustration, wallpaper, abstract visual, concept art, mixed creative image, or any category not covered above.

The prompt assistant must treat the selected image type as guidance, not as a forced rewrite. If the user chooses `auto`, the model should infer the closest type and explain the chosen direction through the returned `notes`.

The UI should be simple:

- A compact image type selector near the AI 生图 textarea.
- A compact action selector near the AI 生图 textarea.
- A button labeled `辅助提示词`.
- A preview result area.
- Result item buttons: `应用`, `复制`.
- A global result action button: `再次生成`.

## File Structure

- Create `src/lib/prompt-assist.ts`
  - Pure prompt-assist action types, image type profiles, request schema helpers, prompt builder, output cleaner, and parser.
  - No Fastify or React imports.

- Create `server/provider-settings-helper.ts`
  - Shared provider-setting lookup used by image generation, reverse prompt, and prompt assist routes.
  - Prevents a third copy of the admin-provider fallback query.

- Create `src/lib/prompt-assist.test.ts`
  - Unit tests for action validation, prompt instruction generation, and response parsing.

- Create `server/routes/prompt-assist.ts`
  - Fastify route `POST /api/prompt-assist`.
  - Authenticates user, checks board ownership, reuses shared provider settings helper, calls text model, returns structured JSON.

- Modify `server/routes/generation-jobs.ts`
  - Replace the local `getProviderSetting` function with the shared helper.

- Modify `server/routes/assets.ts`
  - Replace the local `getProviderSetting` function with the shared helper.

- Modify `server/app.ts`
  - Register `registerPromptAssistRoutes`.

- Modify `src/components/BoardWorkspace.tsx`
  - Add prompt-assist state and functions.
  - Render the prompt assistant controls in desktop and mobile AI 生图 panels.
  - Persist only the applied prompt through existing `sourcePrompt`; do not persist transient suggestions.

- Modify `scripts/smoke-board.mjs`
  - Assert the prompt-assist controls are present on the AI 生图 tab and absent from unrelated tabs.

- Modify `package.json`
  - Add `src/lib/prompt-assist.test.ts` to `npm test`.

---

### Task 1: Add Pure Prompt-Assist Utilities

**Files:**
- Create: `src/lib/prompt-assist.ts`
- Create: `src/lib/prompt-assist.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Create failing tests**

Create `src/lib/prompt-assist.test.ts`:

```ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  buildPromptAssistInstruction,
  cleanPromptAssistText,
  parsePromptAssistOutput,
  promptAssistActions,
  promptAssistImageTypes,
  type PromptAssistAction,
} from "./prompt-assist";

describe("prompt assist utilities", () => {
  test("exposes the supported actions", () => {
    assert.deepEqual(promptAssistActions, ["optimize", "expand", "variations", "translate"]);
  });

  test("exposes the supported image types", () => {
    assert.deepEqual(promptAssistImageTypes, ["auto", "poster", "person", "scene", "object", "brand", "other"]);
  });

  test("builds a poster optimize instruction that preserves intent", () => {
    const instruction = buildPromptAssistInstruction({
      action: "optimize",
      imageType: "poster",
      prompt: "一个足球 logo，黑色背景",
    });

    assert.match(instruction, /保留用户原始意图/);
    assert.match(instruction, /广告海报/);
    assert.match(instruction, /标题层级/);
    assert.match(instruction, /一个足球 logo，黑色背景/);
    assert.match(instruction, /只输出 JSON/);
  });

  test("builds an auto instruction that asks the model to infer image type", () => {
    const instruction = buildPromptAssistInstruction({
      action: "expand",
      imageType: "auto",
      prompt: "球鞋产品图",
    });

    assert.match(instruction, /自动判断最合适的图片类型/);
    assert.match(instruction, /球鞋产品图/);
  });

  test("cleans markdown wrappers and quoted text", () => {
    assert.equal(cleanPromptAssistText("```json\n{\"prompt\":\"test\"}\n```"), "{\"prompt\":\"test\"}");
    assert.equal(cleanPromptAssistText("“高清足球海报”"), "高清足球海报");
  });

  test("parses a single prompt response", () => {
    const output = parsePromptAssistOutput("optimize", JSON.stringify({
      prompt: "黑色背景上的现代足球队徽，金属质感，居中构图",
      notes: ["保留黑色背景", "增强材质描述"],
    }));

    assert.equal(output.prompt, "黑色背景上的现代足球队徽，金属质感，居中构图");
    assert.deepEqual(output.variations, []);
    assert.deepEqual(output.notes, ["保留黑色背景", "增强材质描述"]);
  });

  test("parses variations response", () => {
    const output = parsePromptAssistOutput("variations", JSON.stringify({
      variations: [
        "黑金足球队徽，强烈聚光",
        "极简足球 logo，扁平矢量",
        "复古足球徽章，织物纹理",
      ],
    }));

    assert.equal(output.prompt, "");
    assert.deepEqual(output.variations, [
      "黑金足球队徽，强烈聚光",
      "极简足球 logo，扁平矢量",
      "复古足球徽章，织物纹理",
    ]);
  });

  test("falls back from plain text for non-variation actions", () => {
    const output = parsePromptAssistOutput("expand" satisfies PromptAssistAction, "主体：足球队徽\n背景：黑色");

    assert.equal(output.prompt, "主体：足球队徽\n背景：黑色");
    assert.deepEqual(output.variations, []);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
npx tsx src/lib/prompt-assist.test.ts
```

Expected: fails because `src/lib/prompt-assist.ts` does not exist.

- [ ] **Step 3: Implement pure utilities**

Create `src/lib/prompt-assist.ts`:

```ts
export const promptAssistActions = ["optimize", "expand", "variations", "translate"] as const;
export const promptAssistImageTypes = ["auto", "poster", "person", "scene", "object", "brand", "other"] as const;

export type PromptAssistAction = (typeof promptAssistActions)[number];
export type PromptAssistImageType = (typeof promptAssistImageTypes)[number];

export type PromptAssistInput = {
  action: PromptAssistAction;
  imageType: PromptAssistImageType;
  prompt: string;
};

export type PromptAssistOutput = {
  prompt: string;
  variations: string[];
  notes: string[];
};

const actionInstruction: Record<PromptAssistAction, string> = {
  optimize: "优化用户的 AI 生图提示词，使其更清晰、更适合图像生成。保留用户原始意图，不新增无关主体。",
  expand: "扩写用户的 AI 生图提示词，补充主体、场景、构图、光照、材质、镜头和风格细节。保留用户原始意图。",
  variations: "基于用户的 AI 生图提示词，给出 3 个明显不同但仍相关的创意方向。",
  translate: "将用户输入整理为自然、准确、可直接用于 AI 生图的中文提示词。保留专有名词和关键视觉要求。",
};

const imageTypeInstruction: Record<PromptAssistImageType, string> = {
  auto: "图片类型：自动判断最合适的图片类型，并在 notes 中说明判断依据。根据实际内容选择广告海报、人物、场景、物品、品牌图形或其他更贴切方向。",
  poster: "图片类型：广告海报。重点补齐标题层级、主视觉、卖点表达、版式结构、留白、品牌露出、传播场景和视觉冲击力。",
  person: "图片类型：人物。重点补齐人物身份、姿态、表情、服装、发型、年龄气质、镜头景别、背景关系和真实感要求。",
  scene: "图片类型：场景。重点补齐空间位置、时间、天气、环境氛围、前中后景、光线方向、镜头焦段和空间层次。",
  object: "图片类型：物品。重点补齐物体材质、形状、颜色、工艺细节、摆放角度、产品摄影光线、背景和尺度参照。",
  brand: "图片类型：品牌图形。重点补齐标志形态、行业属性、图形语义、配色、字体气质、可识别性、矢量感和应用场景。",
  other: "图片类型：其他创意图像。根据用户内容自行选择最合适的补充维度，适用于插画、壁纸、抽象视觉、概念图和混合类型画面。",
};

export function buildPromptAssistInstruction(input: PromptAssistInput) {
  const format =
    input.action === "variations"
      ? `只输出 JSON，格式为：{"variations":["提示词1","提示词2","提示词3"],"notes":["说明1","说明2"]}`
      : `只输出 JSON，格式为：{"prompt":"优化后的完整提示词","notes":["说明1","说明2"]}`;

  return [
    "你是专业 AI 生图提示词助手。",
    actionInstruction[input.action],
    imageTypeInstruction[input.imageType],
    "不要输出 Markdown，不要输出标题，不要添加解释性前后缀。",
    "提示词应具体、可执行，避免空泛词。",
    format,
    "",
    "用户原始提示词：",
    input.prompt.trim(),
  ].join("\n");
}

export function cleanPromptAssistText(value: string) {
  let text = value.trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  text = text.replace(/^["“”'`]+|["“”'`]+$/g, "").trim();
  return text;
}

export function parsePromptAssistOutput(action: PromptAssistAction, value: string): PromptAssistOutput {
  const cleaned = cleanPromptAssistText(value);
  try {
    const parsed = JSON.parse(cleaned) as {
      notes?: unknown;
      prompt?: unknown;
      variations?: unknown;
    };
    const notes = Array.isArray(parsed.notes)
      ? parsed.notes.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    const variations = Array.isArray(parsed.variations)
      ? parsed.variations.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    const prompt = typeof parsed.prompt === "string" ? parsed.prompt.trim() : "";
    return {
      notes,
      prompt: action === "variations" ? "" : prompt,
      variations: action === "variations" ? variations.slice(0, 3) : [],
    };
  } catch {
    return {
      notes: [],
      prompt: action === "variations" ? "" : cleaned,
      variations: action === "variations" ? cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 3) : [],
    };
  }
}
```

- [ ] **Step 4: Add the test to `npm test`**

Modify `package.json` test script by inserting the prompt assist test after `src/lib/api-client.test.ts`:

```json
"test": "tsx src/components/board-canvas/board-document.test.ts && tsx src/components/board-canvas/viewport.test.ts && tsx src/lib/api-client.test.ts && tsx src/lib/prompt-assist.test.ts && node server/codex-oauth.test.mjs && node server/codex-auth-routes.test.mjs && node server/static.test.mjs"
```

- [ ] **Step 5: Verify utilities**

Run:

```powershell
npx tsx src/lib/prompt-assist.test.ts
npm test
```

Expected: prompt-assist tests pass; full test suite passes.

---

### Task 2: Extract Shared Provider Setting Lookup

**Files:**
- Create: `server/provider-settings-helper.ts`
- Modify: `server/routes/generation-jobs.ts`
- Modify: `server/routes/assets.ts`

- [ ] **Step 1: Create shared helper**

Create `server/provider-settings-helper.ts`:

```ts
import { prisma } from "@/lib/prisma";

export async function getProviderSetting(userId: string, canUseAdminProvider: boolean) {
  const ownProviderSetting = await prisma.providerSetting.findUnique({
    where: { userId_provider: { provider: "openai-compatible", userId } },
  });
  if (ownProviderSetting?.enabled) return ownProviderSetting;
  if (!canUseAdminProvider) return null;
  return prisma.providerSetting.findFirst({
    where: {
      enabled: true,
      provider: "openai-compatible",
      user: { role: "admin", status: "approved", username: "koiyoho" },
    },
  });
}
```

- [ ] **Step 2: Update generation route imports**

In `server/routes/generation-jobs.ts`, add:

```ts
import { getProviderSetting } from "../provider-settings-helper";
```

Delete the local `getProviderSetting` function at the bottom of the file. Keep existing call sites unchanged.

- [ ] **Step 3: Update assets route imports**

In `server/routes/assets.ts`, add:

```ts
import { getProviderSetting } from "../provider-settings-helper";
```

Delete the local `getProviderSetting` function at the bottom of the file. Keep existing call sites unchanged.

- [ ] **Step 4: Verify helper extraction**

Run:

```powershell
npm run build
npm test
```

Expected: TypeScript server build passes, existing unit tests pass, and existing generation/reverse-prompt routes still compile.

---

### Task 3: Add Prompt-Assist API Route

**Files:**
- Create: `server/routes/prompt-assist.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Create route implementation**

Create `server/routes/prompt-assist.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  buildPromptAssistInstruction,
  parsePromptAssistOutput,
  promptAssistActions,
  promptAssistImageTypes,
} from "@/lib/prompt-assist";
import { createOpenAIClient } from "@/lib/openai";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "../auth";
import { getErrorMessage, jsonError, parseBody } from "../http";
import { getProviderSetting } from "../provider-settings-helper";

const promptAssistSchema = z.object({
  action: z.enum(promptAssistActions),
  boardId: z.string().min(1),
  imageType: z.enum(promptAssistImageTypes).default("auto"),
  prompt: z.string().trim().min(1).max(4000),
});

export async function registerPromptAssistRoutes(app: FastifyInstance) {
  app.post("/api/prompt-assist", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;

    const parsed = parseBody(promptAssistSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);

    const board = await prisma.board.findFirst({
      where: { id: parsed.data.boardId, userId: user.id },
      select: { id: true },
    });
    if (!board) return jsonError(reply, "Board not found", 404);

    const providerSetting = await getProviderSetting(user.id, user.canUseAdminProvider);
    if (!providerSetting?.enabled) {
      return jsonError(reply, "请配置第三方 API 或联系管理员授权使用当前 API", 400);
    }

    try {
      const openai = createOpenAIClient(providerSetting);
      const model = process.env.OPENAI_TEXT_MODEL?.trim() || "gpt-5.5";
      const instruction = buildPromptAssistInstruction({
        action: parsed.data.action,
        imageType: parsed.data.imageType,
        prompt: parsed.data.prompt,
      });
      let text = "";
      try {
        const response = await openai.responses.create({
          input: [{ content: [{ text: instruction, type: "input_text" }], role: "user" }],
          max_output_tokens: parsed.data.action === "variations" ? 1800 : 1200,
          model,
          temperature: parsed.data.action === "variations" ? 0.8 : 0.3,
        });
        text = response.output_text?.trim() ?? "";
      } catch {
        const response = await openai.chat.completions.create({
          max_tokens: parsed.data.action === "variations" ? 1800 : 1200,
          messages: [{ content: instruction, role: "user" }],
          model,
          temperature: parsed.data.action === "variations" ? 0.8 : 0.3,
        });
        const content = response.choices[0]?.message.content;
        text = typeof content === "string" ? content.trim() : "";
      }

      if (!text) return jsonError(reply, "提示词助手未返回可用内容", 502);
      return reply.send(parsePromptAssistOutput(parsed.data.action, text));
    } catch (error) {
      return jsonError(reply, getErrorMessage(error, "提示词辅助失败"), 500);
    }
  });
}

```

- [ ] **Step 2: Register route**

Modify `server/app.ts`:

```ts
import { registerPromptAssistRoutes } from "./routes/prompt-assist";
```

Register before static routes:

```ts
  await app.register(registerPromptAssistRoutes);
```

- [ ] **Step 3: Verify server build**

Run:

```powershell
npm run build
```

Expected: TypeScript server build passes.

---

### Task 4: Add Frontend Prompt Assistant Controls

**Files:**
- Modify: `src/components/BoardWorkspace.tsx`

- [ ] **Step 1: Add local state and types near existing prompt state**

Add these types near the component type declarations:

```ts
type PromptAssistAction = "optimize" | "expand" | "variations" | "translate";
type PromptAssistImageType = "auto" | "poster" | "person" | "scene" | "object" | "brand" | "other";

type PromptAssistResult = {
  notes: string[];
  prompt: string;
  variations: string[];
};
```

Add state near `sourcePrompt` state:

```ts
  const [promptAssistAction, setPromptAssistAction] = useState<PromptAssistAction>("optimize");
  const [promptAssistImageType, setPromptAssistImageType] = useState<PromptAssistImageType>("auto");
  const [promptAssistResult, setPromptAssistResult] = useState<PromptAssistResult | null>(null);
  const [promptAssistError, setPromptAssistError] = useState("");
  const [isPromptAssistLoading, setIsPromptAssistLoading] = useState(false);
```

- [ ] **Step 2: Add prompt assist request functions**

Add functions near `generateSourceFromPrompt()`:

```ts
  async function runPromptAssist() {
    const promptText = sourcePrompt.trim();
    if (!promptText) {
      setPromptAssistError("请先输入 AI 生图提示词");
      return;
    }
    setIsPromptAssistLoading(true);
    setPromptAssistError("");
    setPromptAssistResult(null);
    try {
      const response = await apiFetch("/api/prompt-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: promptAssistAction,
          boardId: board.id,
          imageType: promptAssistImageType,
          prompt: promptText,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as Partial<PromptAssistResult> & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "提示词辅助失败");
      }
      setPromptAssistResult({
        notes: Array.isArray(payload.notes) ? payload.notes : [],
        prompt: typeof payload.prompt === "string" ? payload.prompt : "",
        variations: Array.isArray(payload.variations) ? payload.variations : [],
      });
      setStatus("已生成提示词建议");
    } catch (error) {
      const message = getFriendlyErrorMessage(error, "提示词辅助失败");
      setPromptAssistError(message);
      setStatus(message);
    } finally {
      setIsPromptAssistLoading(false);
    }
  }

  function applyPromptAssistPrompt(promptText: string) {
    setSourcePrompt(promptText);
    setPromptAssistError("");
    setStatus("已应用提示词建议");
    scheduleSave({ appSnapshot: { sourcePrompt: promptText } });
  }

  async function copyPromptAssistPrompt(promptText: string) {
    try {
      await navigator.clipboard.writeText(promptText);
      setStatus("已复制提示词建议");
    } catch {
      setStatus("复制失败，请手动选择文本复制");
    }
  }
```

- [ ] **Step 3: Render a reusable prompt assistant block**

Add a local render function before `return (`:

```tsx
  function renderPromptAssistControls(idPrefix: string) {
    const primaryPrompt = promptAssistResult?.prompt.trim();
    const suggestions = primaryPrompt
      ? [primaryPrompt]
      : promptAssistResult?.variations ?? [];

    return (
      <div className="prompt-assist-panel" data-testid={`${idPrefix}-prompt-assist`}>
        <div className="prompt-assist-controls">
          <label className="select-field">
            图片类型
            <select
              onChange={(event) => setPromptAssistImageType(event.target.value as PromptAssistImageType)}
              value={promptAssistImageType}
            >
              <option value="auto">自动判断</option>
              <option value="poster">广告海报</option>
              <option value="person">人物</option>
              <option value="scene">场景</option>
              <option value="object">物品</option>
              <option value="brand">品牌图形</option>
              <option value="other">其他创意</option>
            </select>
          </label>
          <label className="select-field">
            提示词辅助
            <select
              onChange={(event) => setPromptAssistAction(event.target.value as PromptAssistAction)}
              value={promptAssistAction}
            >
              <option value="optimize">优化表达</option>
              <option value="expand">扩写细节</option>
              <option value="variations">生成变体</option>
              <option value="translate">整理中文</option>
            </select>
          </label>
          <button
            disabled={isPromptAssistLoading || !sourcePrompt.trim()}
            onClick={() => void runPromptAssist()}
            type="button"
          >
            {isPromptAssistLoading ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
            辅助提示词
          </button>
        </div>
        {promptAssistError ? <p className="generation-result-hint error">{promptAssistError}</p> : null}
        {suggestions.length > 0 ? (
          <div className="prompt-assist-results">
            <div className="prompt-assist-result-actions">
              <button disabled={isPromptAssistLoading} onClick={() => void runPromptAssist()} type="button">
                再次生成
              </button>
            </div>
            {suggestions.map((suggestion, index) => (
              <article className="prompt-assist-result" key={`${idPrefix}-prompt-assist-${index}`}>
                <p>{suggestion}</p>
                <div className="button-row">
                  <button onClick={() => applyPromptAssistPrompt(suggestion)} type="button">应用</button>
                  <button onClick={() => void copyPromptAssistPrompt(suggestion)} type="button">复制</button>
                </div>
              </article>
            ))}
            {promptAssistResult?.notes.length ? (
              <ul className="prompt-assist-notes">
                {promptAssistResult.notes.map((note, index) => <li key={`${idPrefix}-prompt-note-${index}`}>{note}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }
```

- [ ] **Step 4: Insert controls in desktop AI 生图 panel**

In the desktop `AI 生图` panel, place this immediately after the source prompt textarea:

```tsx
          {renderPromptAssistControls("desktop-generate")}
```

- [ ] **Step 5: Insert controls in mobile AI 生图 panel**

In the mobile `AI 生图` panel, place this immediately after the mobile source prompt textarea:

```tsx
            {renderPromptAssistControls("mobile-generate")}
```

- [ ] **Step 6: Verify frontend build**

Run:

```powershell
npm run build
npx eslint src/components/BoardWorkspace.tsx
```

Expected: build and lint pass.

---

### Task 5: Style Prompt Assistant UI

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add desktop and mobile-safe styles**

Add these styles near existing panel/button styles:

```css
.prompt-assist-panel {
  display: grid;
  gap: 10px;
}

.prompt-assist-controls {
  align-items: end;
  display: grid;
  gap: 8px;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
}

.prompt-assist-controls > button {
  align-items: center;
  display: inline-flex;
  gap: 6px;
  justify-content: center;
  min-height: 38px;
}

.prompt-assist-results {
  display: grid;
  gap: 8px;
}

.prompt-assist-result-actions {
  display: flex;
  justify-content: flex-end;
}

.prompt-assist-result {
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid var(--line);
  border-radius: 8px;
  display: grid;
  gap: 8px;
  padding: 10px;
}

.prompt-assist-result p {
  color: var(--foreground);
  font-size: 13px;
  line-height: 1.55;
  margin: 0;
  white-space: pre-wrap;
}

.prompt-assist-notes {
  color: var(--muted);
  display: grid;
  font-size: 12px;
  gap: 4px;
  margin: 0;
  padding-left: 18px;
}

@media (max-width: 720px) {
  .prompt-assist-controls {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 2: Verify layout**

Run:

```powershell
npm run build
```

Expected: build passes. Visually, the controls fit inside the AI 生图 drawer without horizontal overflow.

---

### Task 6: Extend Smoke Test Coverage

**Files:**
- Modify: `scripts/smoke-board.mjs`

- [ ] **Step 1: Add AI 生图 prompt-assist assertions**

In the initial desktop layout section, after asserting the generate page is visible, add:

```js
  await page.getByRole("button", { name: "AI 生图" }).first().click();
  const generatePromptAssist = page.getByTestId("desktop-generate-prompt-assist");
  await generatePromptAssist.getByRole("button", { name: "辅助提示词" }).waitFor({ timeout: 30000 });
  await generatePromptAssist.getByLabel("图片类型").selectOption("poster");
  await generatePromptAssist.getByLabel("提示词辅助").selectOption("expand");
```

Add an assertion after switching to `AI 改图`:

```js
  assert(
    (await page.getByTestId("desktop-generate-prompt-assist").count()) === 0,
    "expected prompt assist button to stay out of AI edit tab",
  );
```

- [ ] **Step 2: Verify smoke test**

Run:

```powershell
$env:SMOKE_BASE_URL='http://127.0.0.1:3333'; npm run smoke:board
```

Expected: smoke passes, confirms the prompt-assist controls are scoped to AI 生图, and rechecks the existing board generation, asset modal, download, mask-save, and zero-dimension asset flows after the provider helper extraction.

---

### Task 7: Manual QA Checklist

**Files:**
- No file changes.

- [ ] **Step 1: Start latest local app**

Run:

```powershell
npm run build
```

Restart local server on `3333` if it is already running from an older build.

- [ ] **Step 2: Validate happy path**

Manual steps:

1. Open `http://127.0.0.1:3333/boards/<boardId>`.
2. Open `AI 生图`.
3. Enter `一个足球 logo，黑色背景`.
4. Select `广告海报` as the image type.
5. Select `优化表达`.
6. Click `辅助提示词`.
7. Confirm a suggestion appears and includes poster-oriented details such as title hierarchy, main visual, layout, or campaign usage.
8. Click the global `再次生成` button and confirm the result area refreshes as a whole.
9. Click `应用`.
10. Confirm the AI 生图 textarea updates.
11. Click `生成源图`.
12. Confirm generation still uses the applied prompt.

- [ ] **Step 3: Validate error path**

Manual steps:

1. Clear the AI 生图 prompt.
2. Confirm `辅助提示词` is disabled.
3. Temporarily use an account without provider access.
4. Enter a prompt and click `辅助提示词`.
5. Confirm the UI shows `请配置第三方 API 或联系管理员授权使用当前 API`.

- [ ] **Step 4: Validate provider-helper regression paths**

Manual steps:

1. Open a board that has at least one image asset.
2. Open the asset detail modal.
3. Click the asset reverse-prompt action.
4. Confirm the reverse-prompt request still reaches the configured provider or shows the existing provider-access error.
5. Run a normal `AI 生图` generation from the same board.
6. Confirm the generation job still starts and uses the existing provider configuration.

---

## Self-Review

Spec coverage:

- Adds prompt assistance for AI 生图 prompt.
- Provides optimize, expand, variations, and translate actions.
- Adds type-aware prompt assistance for automatic detection, advertising posters, people, scenes, objects, brand graphics, and other creative image types.
- Allows applying suggestions back to `sourcePrompt`.
- Reuses existing provider configuration through a shared helper and avoids adding another provider lookup copy.
- Keeps image generation endpoint unchanged.
- Adds unit and smoke coverage.
- Adds manual regression checks for existing image generation and asset reverse-prompt paths touched by provider helper extraction.

Placeholder scan:

- No `TBD`, `TODO`, or unspecified implementation steps remain.

Type consistency:

- `PromptAssistAction` values match `promptAssistActions`.
- `PromptAssistImageType` values match `promptAssistImageTypes`.
- API schema uses `z.enum(promptAssistActions)` and `z.enum(promptAssistImageTypes)` so `parsed.data.action` and `parsed.data.imageType` keep their literal union types.
- API request and frontend state both use `optimize | expand | variations | translate` and `auto | poster | person | scene | object | brand | other`.
- API response shape matches frontend `PromptAssistResult`.
- Prompt-assist API returns successful payloads through `reply.send(...)`.
- Smoke selectors use `data-testid` and do not depend on layout class names or hidden mobile DOM.
