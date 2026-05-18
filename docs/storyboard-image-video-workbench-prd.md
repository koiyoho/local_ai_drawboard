# 图片视频一体化工作台 Brainstorm PRD

## Goal

把当前本地优先的 AI 图片画板扩展为从文案到分镜、首尾帧图片、再到首尾帧生成视频的端到端创作工作台。目标不是替换现有画板，而是在画板自由编排能力之上增加结构化视频生产链路。

## What I Already Know

- 当前项目是 Vite + React + Fastify + Prisma/SQLite 的本地优先应用。
- 现有能力包含登录、画板管理、图片素材、AI 生图、AI 改图、参考图角色、生成历史、Prompt Recipe、画板模板、批量导出和本地归档。
- 当前后端统一图片生成入口是 `POST /api/generation-jobs`，模式为 `text_to_image` 与 `inpaint`。
- 当前数据模型以 `Asset`、`GenerationJob`、`GenerationResult` 为核心，`Asset.mimeType` 可以表达视频文件，但业务上尚未建立视频生成、镜头、分镜、项目脚本或多阶段任务。
- `ProviderSetting` 已包含 `imageModel` 和 `textModel`，但没有 video model、模型能力声明或按任务类型选择 provider 的配置。
- 现有画板已能承载图片结果对比、历史和素材复用，适合作为“视觉 storyboard + 镜头板”基础。

## Assumptions

- 首版仍保持本地优先和单人工作流，不引入多人协作。
- 视频能力优先接入 OpenAI 兼容或第三方视频生成 API，不自研视频模型。
- “首尾帧生成视频”优先按镜头为单位生成短视频片段，再在后续阶段支持合成整片。
- 当前问题是功能规划，不进入代码实现。

## Requirements

### Phase 1 Scope Decision

状态更新：第一期已在 `v0.1.10` / commit `1dbbcd8` 发布，并于 2026-05-18 完成人工 UI 回巡，当前回巡未发现问题。

第一期范围已收敛为：

- 文案 / Brief 输入。
- 文案生成结构化分镜。
- 分镜编辑、排序、复制、状态管理。
- 每个分镜生成首帧提示词、尾帧提示词和视频生成提示词。
- 暂不接视频模型，暂不生成视频文件。

第二期再接入视频模型、视频任务、视频资产、视频预览和导出。

### 1. 文案与创意 Brief

- 新增项目级 Brief：产品/主题、目标平台、时长、画幅、风格、受众、卖点、禁忌元素。
- 支持从原始文案生成广告脚本、短视频脚本或镜头说明。
- 支持脚本版本管理：原文、优化版、分镜版、最终锁定版。
- 支持提示词助手把文案转换成图片提示词、分镜提示词和视频运动提示词；第一期只产出提示词，不提交视频生成。

### 2. 分镜管理

- 新增 Storyboard / Shot 数据结构：镜头编号、时长、景别、机位、画面描述、动作、台词/字幕、音效/音乐备注、状态。
- 支持一键从脚本拆分分镜，并允许手动新增、删除、重排、复制镜头。
- 每个镜头可绑定参考图、角色图、产品图、风格图和首帧/尾帧。
- 画布上需要能把分镜作为一组卡片或时间线展示，并支持把镜头卡片定位到对应画板区域。

### 3. 首尾帧图片生成

- 第二期范围。第一期只保存首帧提示词和尾帧提示词，不直接提交图片生成任务。
- 第二期每个镜头有独立的首帧提示词和尾帧提示词。
- 第二期支持从镜头描述生成首帧、从首帧和动作描述推导尾帧。
- 第二期复用现有 AI 生图/改图能力生成首帧与尾帧，并把结果保存为普通 `Asset`。
- 第二期支持角色、产品、Logo、风格等参考图沿用现有 `referenceItems` 体系。
- 第二期支持首尾帧成对比较、锁定、重生成、替换和标记通过。

### 4. 首尾帧生成视频

- 第二期范围，第一期只生成视频提示词和预留数据结构。
- 新增视频生成任务：输入首帧、尾帧、运动提示词、镜头时长、画幅、帧率/质量、模型。
- 支持 image-to-video、first-last-frame-to-video 两类视频模式；文本直出视频可后置。
- 视频生成结果作为视频资产进入素材库，并绑定回对应镜头。
- 支持失败重试、参数复用、任务状态轮询和错误脱敏。
- 支持视频预览、下载、加入画布/时间线、设为当前镜头成片。

### 5. 时间线与镜头状态

- 新增镜头状态流：草稿、脚本已定、首帧已定、尾帧已定、视频生成中、视频已定、需返工。
- 支持镜头列表按状态过滤。
- 支持按分镜顺序预览所有视频片段。
- 后续支持把多个视频片段合成为完整视频，首版可先导出片段和分镜表。

### 6. 素材与资产管理扩展

- 素材库支持视频 MIME 类型、缩略图、时长、封面帧和类型筛选。
- 图片/视频资产都需要能追溯来源任务、prompt、模型和镜头。
- 支持按项目/镜头筛选素材，避免所有资产挤在同一个列表里。

### 7. Provider 与模型配置

- Provider 设置增加视频模型字段和能力声明：文本模型、图片模型、视频模型。
- 生成路由需要按任务类型选择对应模型和参数。
- 视频生成接口差异较大，应增加 provider adapter 层，避免把某一个平台参数硬编码进通用路由。

### 8. 成本、队列与可靠性

- 视频任务通常耗时更长，应从同步 HTTP 生成改成后台任务或可轮询任务。
- 额度统计需要区分图片张数、视频次数、视频秒数或不同模型成本。
- 需要处理长任务超时、取消、重试、服务重启后的 stale running job。
- 本地存储需要区分上传图片、生成图片、视频片段、导出成片和缩略图。

## Acceptance Criteria

- [x] 用户可以输入一段文案并生成可编辑分镜列表。
- [x] 每个分镜可以生成首帧提示词、尾帧提示词和视频生成提示词。
- [x] 每个分镜的文案、镜头字段、首尾帧提示词和视频提示词都可编辑、保存和导出。
- [x] 第一版不提交首尾帧图片生成任务。
- [x] 第一版不提交视频生成任务，也不要求视频模型配置。
- [x] 分镜能力不破坏现有图片生图、改图、素材、画板保存和导出流程。

## Technical Approach

推荐采用“媒体项目层 + 镜头层 + 通用媒体任务层”的增量架构：

- 保留现有画板作为视觉编排层。
- 新增结构化 `StoryboardProject` / `StoryboardShot` 或等价模型，管理脚本和镜头状态。
- 第一版不改造 `GenerationJob` 为媒体任务，也不新增视频任务模型；后续视频接入时再评估 `MediaGenerationJob` 或 provider adapter。
- 第一版不扩展视频资产字段；后续视频接入时再为 `Asset` 增加 `durationMs`、`thumbnailAssetId`、`metadataJson` 等通用字段。
- 前端在 `BoardWorkspace` 旁增加独立的“分镜/视频”工作区，避免继续把单个组件塞成更大的巨型状态容器。

## Suggested Phases

### Phase 0: 基础重构准备

- 抽出生成任务类型、资产类型、素材操作组件和任务状态 UI。
- 明确图片任务与未来视频任务的共享接口。

### Phase 1: 文案到分镜与提示词 MVP

- 新增 Brief / Script / Shot 数据模型与 API。
- 提供脚本拆分分镜能力。
- 提供分镜列表、镜头详情、状态、排序和镜头卡片画布投放。
- 每个镜头生成并保存首帧提示词、尾帧提示词和视频运动提示词。
- 不接视频模型，不创建视频生成任务。

### Phase 2: 镜头首尾帧

Phase 2A 状态更新：已接入首帧/尾帧图片生成并绑定回分镜镜头，继续复用现有图片生成 Provider 和 `GenerationJob`。视频模型、视频任务、视频资产、片段预览与整片导出仍留到 Phase 3。

- 为 Shot 增加 `startFrameAssetId`、`endFrameAssetId`、对应 prompt 和锁定状态。
- 复用图片生成接口生成首尾帧。
- 增加首尾帧对比、锁定、重生成和参数复用。

### Phase 3: 视频生成

- 增加视频 Provider 设置、视频模型配置和 provider adapter。
- 新增视频生成任务 API 与轮询。
- 存储视频资产、封面、时长和镜头绑定。

### Phase 4: 时间线与导出

- 镜头时间线预览。
- 片段下载和批量导出。
- 后续再做 FFmpeg 合成整片、字幕轨、音频轨和版本对比。

## Out Of Scope For MVP

- 多人协作、评论审批。
- 通用可视化工作流编排器。
- 自动合成完整带音乐字幕的成片。
- 专业 NLE 级时间线编辑。
- AI 自动保证角色跨镜头完全一致。
- 视频模型配置、视频生成任务、视频文件存储和视频预览。

## Decision (ADR-lite)

**Context**: 视频模型当前不可用，直接做视频生成会引入 provider、长任务、视频存储、预览和成本统计等额外复杂度。

**Decision**: 第一期只做文案、分镜结构化、分镜编辑，以及首帧、尾帧、视频生成提示词产出。首尾帧图片生成、视频模型接入和实际视频生成放到后续阶段。

**Consequences**: 第一期可以先打通内容生产和镜头管理的核心体验，为后续接入图片和视频模型保留清晰接口；但用户暂时不能在应用内直接生成首尾帧图片或视频文件。

## Phase 1 Step / Project Map

第一期不建议引入大量新开源项目。优先复用当前 React、Konva、Fastify、Prisma、OpenAI SDK、Zod。只有当流式结构化输出和多 provider 文本模型需求明确时，再新增 AI SDK。

### Step 1: 文案 / Brief 输入

- Reuse existing: React UI、Fastify routes、Prisma/SQLite、现有用户/画板权限。
- Add inside this project:
  - `CreativeBrief` 或直接挂在 `StoryboardProject` 的 brief fields。
  - Brief editor panel：主题、目标平台、时长、画幅、风格、受众、卖点、禁忌元素。
  - 保存/加载 API。
- External project: none required.
- Optional external: Uppy only if later需要大批量上传参考素材；Phase 1 暂不需要。

### Step 2: 文案生成结构化分镜

- Reuse existing: `openai` Node SDK、`ProviderSetting.textModel`、`zod`。
- Add inside this project:
  - `StoryboardProject` model：boardId、briefJson、scriptText、status。
  - `StoryboardShot` model：shotIndex、durationSec、scene、camera、action、dialogue、caption、startFramePrompt、endFramePrompt、videoPrompt、status、metadataJson。
  - `POST /api/storyboards/:id/generate-shots` or `POST /api/boards/:boardId/storyboard/generate`。
  - Zod schema for LLM structured output and repair/retry on invalid JSON.
- External project candidate:
  - Vercel AI SDK: recommended only if we want streaming object generation/provider abstraction.
  - TypeChat: possible but not necessary; Zod + direct JSON schema is simpler.
  - LangGraph JS: not needed for Phase 1 unless generation becomes a multi-step approval workflow.

### Step 3: 分镜编辑

- Reuse existing: React state patterns、Konva board document、current board save/snapshot、icons/styles.
- Add inside this project:
  - Storyboard side panel / workspace tab.
  - Shot list with reorder, duplicate, delete, status change.
  - Shot detail editor.
  - Optional board projection: insert shot cards into canvas as text/image layout objects.
  - Shot state reducer/helpers and tests.
- External project candidate:
  - No new dependency recommended.
  - React Flow only if later需要节点式工作流，不适合 Phase 1 的线性分镜。
  - Storyboarder only as UX reference, not dependency.

### Step 4: 首帧、尾帧、视频提示词生成

- Reuse existing: text model provider, prompt assist patterns, prompt recipe ideas.
- Add inside this project:
  - `generate-shot-prompts` API: input shot + brief + style; output startFramePrompt, endFramePrompt, videoPrompt.
  - Per-shot prompt editor and regenerate buttons.
  - Prompt lock flags: prevent overwriting manually refined prompts.
  - Prompt version metadata if needed.
- External project candidate:
  - Vercel AI SDK optional for streaming prompt generation.
  - LangChain/LangGraph not needed unless prompts are generated through several chained review passes.

### Step 5: 首尾帧图片生成

- Deferred to Phase 2. Reuse existing:
  - `/api/generation-jobs`
  - `text_to_image`
  - `referenceItems`
  - `Asset`
  - `GenerationJob`
- Add inside this project in Phase 2:
  - `StoryboardShot.startFrameAssetId`
  - `StoryboardShot.endFrameAssetId`
  - Buttons: generate start frame / generate end frame / set selected asset as start/end.
  - Shot-frame compare UI.
- External project: none required.
- Optional Phase 2+ external: ComfyUI as external provider if local workflows are required.

### Step 6: 第一版验收与导出

- Reuse existing: board snapshots, local export patterns, JSON API tests.
- Add inside this project:
  - Export storyboard as JSON/Markdown/CSV or simple HTML/PDF later.
  - Include brief, shots, prompts, linked asset IDs.
  - API tests for permissions and structured output persistence.
- External project candidate:
  - None for JSON/Markdown.
  - PDF/export libraries can wait until output format is fixed.

### Deferred to Phase 2

- Video provider adapter.
- Video model configuration.
- Video generation task API.
- Video assets, thumbnails, duration metadata.
- Video preview and download.
- FFmpeg/Remotion integration.
- BullMQ or durable worker queue.

## Technical Notes

- Inspected: `README.md`, `docs/ai-image-workbench-plan.md`, `docs/ai-board-feature-roadmap.md`, `prisma/schema.prisma`, `server/routes/generation-jobs.ts`, `src/components/BoardWorkspace.tsx`, `src/client/api.ts`, `src/lib/provider-models.ts`.
- Existing roadmap already covers素材库、历史版本、生成参数复用、任务中心、配方库、模板、PSD、图层分组、智能排版、批量导出、固定工作流自动化。
- Video workbench should build on top of task center, asset metadata, prompt recipes, templates and version history rather than duplicate them.

## Open Source Candidate Research

Research date: 2026-05-16. Stars and activity are snapshots from GitHub API and should be rechecked before implementation.

### 文案、结构化输出、脚本拆分

**Vercel AI SDK** — https://github.com/vercel/ai

- Fit: High for this TypeScript app. Useful for streaming text, structured object generation, provider abstraction and React integration.
- License: Apache-2.0 in repository files.
- Snapshot: ~24k stars, active as of 2026-05-15.
- Use for: Brief -> script, script -> shot JSON, prompt variants, UI streaming.
- Risk: It does not solve workflow persistence or review state; still need local data model.

**LangChain JS / LangGraph JS** — https://github.com/langchain-ai/langchainjs / https://github.com/langchain-ai/langgraphjs

- Fit: Medium to high for multi-step planning and retryable graph workflows.
- License: MIT.
- Snapshot: LangChain JS ~17k stars; LangGraph JS ~2.9k stars; both active on 2026-05-16.
- Use for: script splitting, shot refinement, multi-step agentic planning if workflows become complex.
- Risk: Bigger abstraction surface than current app needs. Avoid in MVP unless prompt flows become stateful and branching.

**Mastra** — https://github.com/mastra-ai/mastra

- Fit: Medium. Modern TypeScript AI app framework.
- License: Apache-2.0 for core, with enterprise directories separated.
- Snapshot: ~23k stars, active on 2026-05-16.
- Use for: agents/workflows if the app later needs durable AI pipelines.
- Risk: Could overlap with existing Fastify server architecture. Adopt only after a spike.

**TypeChat** — https://github.com/microsoft/TypeChat

- Fit: Medium. Simple typed natural language -> JSON extraction.
- License: MIT.
- Snapshot: ~8.6k stars, active in 2026.
- Use for: narrow schema-constrained script -> shot extraction.
- Risk: Less comprehensive than AI SDK/LangChain; not a workflow framework.

Recommendation: Start with Vercel AI SDK or direct provider calls plus Zod schema validation. Add LangGraph only if workflows need branching, retries and human approval checkpoints.

### 文案 Skills / Prompt Library

**boraoztunc/skills** — https://github.com/boraoztunc/skills

- Fit: High as source material for internal copywriting strategy presets, not as runtime dependency.
- License: Apache-2.0.
- Snapshot: small repo, low stars, but directly includes `copywriting`, `copy-editing`, `ogilvy`, `content-strategy`, `page-cro`, and video composition related skills.
- Use for: extracting reusable copywriting review passes, headline/CTA frameworks, Ogilvy-style positioning rules, anti-AI-slop editing pass.
- Risk: Not short-video-platform specific. Need adapt into our own platform presets.

**alirezarezvani/claude-skills** — https://github.com/alirezarezvani/claude-skills

- Fit: Medium-high as broad skill library reference.
- License: MIT.
- Snapshot: ~15k stars, active in 2026. README lists marketing skills, content creator, SEO/CRO, product and compliance domains.
- Use for: discovering marketing/copywriting skill structures and evaluation rubrics.
- Risk: Very broad; quality can vary by skill. Do not import wholesale.

**EBOLABOY/xhs-ai-writer** — https://github.com/EBOLABOY/xhs-ai-writer

- Fit: Medium as Chinese platform reference, especially 小红书文案.
- License: not declared by GitHub API; verify before reuse.
- Snapshot: ~273 stars, active in 2026.
- Use for: product/UX reference, 小红书爆款笔记 workflow ideas.
- Risk: Not a reusable skill library; unclear license; avoid code/prompt copying unless license is confirmed.

**bigscience-workshop/promptsource** — https://github.com/bigscience-workshop/promptsource

- Fit: Low for marketing copy directly, medium as prompt storage/design reference.
- License: Apache-2.0.
- Snapshot: ~3k stars, last active 2023.
- Use for: idea of storing prompts as structured templates with variables.
- Risk: Research/NLP dataset orientation, Python 3.7 era; overkill for this app.

Recommendation: For Phase 1, create an internal `platform-copywriting-presets.ts` instead of adding a runtime dependency. Seed it by adapting ideas from Apache/MIT skill repos and by writing first-party presets for Douyin, Xiaohongshu, WeChat Channels, TikTok, YouTube Shorts, and Instagram Reels. Treat unclear-license projects only as product references.

### 分镜编辑与工作流画布

**Current Konva board** — https://github.com/konvajs/konva

- Fit: Highest because the project already uses React Konva and custom board documents.
- License: MIT.
- Snapshot: ~14k stars, active in 2026.
- Use for: shot cards, storyboard lanes, visual grouping, frame comparison.
- Risk: More custom product work, but least integration risk.

**React Flow / xyflow** — https://github.com/xyflow/xyflow

- Fit: Medium. Excellent if storyboard becomes node graph or workflow graph.
- License: MIT.
- Snapshot: ~36k stars, active on 2026-05-16.
- Use for: visual pipeline builder, shot dependency graph, fixed workflow editor.
- Risk: Current UX is canvas/storyboard rather than node workflow. Not needed for MVP.

**Storyboarder** — https://github.com/wonderunit/storyboarder

- Fit: Low to medium as inspiration, not direct dependency.
- License: unclear from GitHub API; verify before reuse.
- Snapshot: ~3.6k stars, last push 2024.
- Use for: storyboard UX patterns, shot metadata ideas, board export concepts.
- Risk: Electron/product app, not a library; older activity; direct integration likely costly.

**Small React storyboard repos** such as `Miatoo/web-storyboard`, `rishidandu/cutagent`, `manynames3/prompt-vista-editor`

- Fit: Low.
- Use for: quick UX references only.
- Risk: Very small communities, incomplete licensing in some cases, not stable enough as core dependencies.

Recommendation: Build storyboard UI in the current Konva/React system. Use Storyboarder and small repos as product references only.

### 图片生成、首尾帧生成、工作流后端

**ComfyUI** — https://github.com/Comfy-Org/ComfyUI

- Fit: High as optional external local worker/provider, not as embedded library.
- License: GPL-3.0.
- Snapshot: ~113k stars, active on 2026-05-16.
- Use for: local image/video workflows, graph templates, first/last-frame pipelines through custom nodes.
- Risk: GPL and Python runtime. Keep it out-of-process and treat as provider integration, not copied code.

**Diffusers** — https://github.com/huggingface/diffusers

- Fit: High for Python model workers.
- License: Apache-2.0.
- Snapshot: ~33k stars, active on 2026-05-15.
- Use for: custom local worker for image/video models if the project eventually owns inference.
- Risk: Requires GPU/Python ops. Current app is Node local-first; direct integration is a deployment jump.

**InvokeAI** — https://github.com/invoke-ai/InvokeAI

- Fit: Medium as external creative engine/provider.
- License: Apache-2.0.
- Snapshot: ~27k stars, active on 2026-05-16.
- Use for: local Stable Diffusion creative backend, asset workflows.
- Risk: Large product/server; less lightweight than current provider model.

**AUTOMATIC1111 WebUI** — https://github.com/AUTOMATIC1111/stable-diffusion-webui

- Fit: Medium-low for integration.
- License: AGPL-3.0.
- Snapshot: ~163k stars, active but lower recent cadence.
- Use for: user-managed external backend via API if already installed.
- Risk: AGPL if embedding/modifying; avoid code reuse.

Recommendation: Keep current OpenAI-compatible image path for MVP. Add ComfyUI as an optional external provider adapter if local workflows matter.

### 开源首尾帧/图生视频模型

**Wan2.2 / Wan2.1** — https://github.com/Wan-Video/Wan2.2 / https://github.com/Wan-Video/Wan2.1

- Fit: High as local/open model candidate through worker/ComfyUI.
- License: Apache-2.0.
- Snapshot: ~15-16k stars, active in 2026.
- Use for: image-to-video and first/last-frame style workflows depending on pipeline support.
- Risk: GPU requirements, model weights/license details, inference complexity.

**LTX-Video** — https://github.com/Lightricks/LTX-Video

- Fit: Medium-high for local video model experimentation.
- License: Apache-2.0.
- Snapshot: ~10k stars, active into 2026.
- Use for: text/image-to-video worker experiments.
- Risk: Quality/performance trade-offs need visual spike.

**CogVideo / CogVideoX** — https://github.com/zai-org/CogVideo

- Fit: Medium-high.
- License: Apache-2.0.
- Snapshot: ~12k stars, active into late 2025.
- Use for: text/image-to-video worker, research baseline.
- Risk: Heavy inference; integration is Python service rather than Node package.

**FramePack** — https://github.com/lllyasviel/FramePack

- Fit: Medium for practical long-ish video diffusion workflows.
- License: Apache-2.0.
- Snapshot: ~16k stars, active in 2025.
- Use for: external video generation worker experiments.
- Risk: Need verify API shape and first/last-frame suitability.

**HunyuanVideo-I2V** — https://github.com/Tencent-Hunyuan/HunyuanVideo-I2V

- Fit: Medium.
- License: GitHub API reports no SPDX assertion; verify manually before commercial use.
- Snapshot: ~1.8k stars, active in 2026.
- Use for: image-to-video experiments.
- Risk: License and model terms require review.

Recommendation: Product architecture should not bind to one model. Implement a video provider adapter and test Wan + LTX/CogVideo through external workers or ComfyUI.

### 视频工作台、时间线、预览

**Remotion** — https://github.com/remotion-dev/remotion

- Fit: High for programmatic composition/export with React.
- License: custom two-tier license; free for individuals and small companies, company license may be required.
- Snapshot: ~47k stars, active on 2026-05-15.
- Use for: final preview/composition, captions, assembling generated clips, server-side render.
- Risk: license constraints for larger commercial usage; not a full NLE editor by itself.

**OpenVideo** — https://github.com/openvideodev/openvideo

- Fit: Medium as reference or possible embedded editor.
- License: GitHub API no SPDX assertion; verify.
- Snapshot: ~227 stars, active in 2026.
- Use for: React video editor ideas, client-side WebCodecs + Pixi approach.
- Risk: Young project, smaller community.

**Twick** — https://github.com/ncounterspecialist/twick

- Fit: Medium-low until license and maturity are reviewed.
- License: GitHub API no SPDX assertion.
- Snapshot: ~473 stars, active in 2026.
- Use for: React timeline/editor SDK ideas.
- Risk: small ecosystem; avoid core dependency before spike.

**ffmpeg.wasm** — https://github.com/ffmpegwasm/ffmpeg.wasm

- Fit: Medium for small client-side operations.
- License: MIT.
- Snapshot: ~17k stars, active in 2026.
- Use for: lightweight browser-side trimming, thumbnails, simple transcodes.
- Risk: browser memory/performance; not ideal for long exports.

**Native FFmpeg process**

- Fit: High for local-first desktop/server deployments.
- Use for: concat clips, extract thumbnails, transcode, mux audio/subtitles.
- Risk: Need package/install strategy on Windows deployment.

Recommendation: Use a simple custom shot timeline for MVP. Use FFmpeg server-side for clip operations. Consider Remotion for React-based composition if licensing fits.

### 上传、资产、任务队列

**Uppy** — https://github.com/transloadit/uppy

- Fit: Medium-high if uploads become more complex.
- License: MIT.
- Snapshot: ~30k stars, active in 2026.
- Use for: large files, progress, resumable uploads, video uploads.
- Risk: Current upload needs may remain simple enough for native inputs.

**BullMQ** — https://github.com/taskforcesh/bullmq

- Fit: Medium for production queues.
- License: MIT.
- Snapshot: ~8.8k stars, active in 2026.
- Use for: video generation queues, retries, delayed jobs if Redis is acceptable.
- Risk: Redis dependency conflicts with current SQLite/local-first simplicity.

**p-queue** — https://github.com/sindresorhus/p-queue

- Fit: High for MVP local queue.
- License: MIT.
- Snapshot: ~4.2k stars, active in 2026.
- Use for: in-process concurrency control for image/video tasks.
- Risk: Not durable across process restarts. Pair with DB job statuses and stale-job recovery.

Recommendation: Use DB-backed job records plus `p-queue` first. Move to BullMQ only if deployments accept Redis and need durable distributed workers.
