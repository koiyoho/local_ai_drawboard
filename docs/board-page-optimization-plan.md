# 画板页面优化方案

日期：2026-05-12

## 目标

优化当前画板页的稳定性、素材工作流、部署一致性和官方 Codex 登录入口，优先解决三个已确认问题，并把当前分支下未提交的 Vite + Fastify 迁移改动统一收口。目标架构只保留 Vite 客户端 + Fastify API/静态服务这一条运行路径，去除旧 Next.js / Auth.js 运行路径和旧 `src/app/api/*` API 维护面。

本方案同时把 `no-oauth` 分支中的直接登录 Codex OAuth 能力迁移到当前 Vite + Fastify 运行链路：

- 画板中的图片在部分操作后出现自动刷新，导致缩放、选区、视口等显示状态丢失。
- 素材页点击素材弹窗后的下载功能无效。
- 素材页/素材面板当前只显示前 8 张图片素材，删除部分素材后才露出后面的素材；这是展示层硬截断导致的错误逻辑。
- 首页缺少类似 `no-oauth` 分支的官方 Codex OAuth 登录入口，无法在当前 Fastify 服务中直接保存 Codex 登录信息。
- 当前分支还有统一 `apiFetch`、跨域/API Base URL、Cookie Domain、异步生成任务、快照保护、反推提示词、素材尺寸识别、systemd 和样式等未提交改动，需要纳入同一交付范围。
- 旧架构文件仍存在并发生局部改动，容易造成“双运行路径”误判，需要明确移除或冻结旧 Next 目录。

## 目标架构

### 保留

- Vite 客户端入口：`src/client/main.tsx`、`src/client/pages/*`。
- 共享 UI 组件：`src/components/*`。
- Fastify 服务端入口：`server/index.ts`、`server/app.ts`、`server/routes/*`。
- Fastify 静态托管构建产物：运行时读取 `dist/client`；仓库默认不提交 `dist/`。
- 共享库：`src/lib/*`，但只能被 Vite/Fastify 路径引用。
- Prisma schema/client 与本地 SQLite。

### 去除旧架构

- 不再维护 Next.js App Router 页面和 API 作为运行路径。
- 删除或移出旧 `src/app/api/**` API 路由，避免生成任务、素材、导出、认证出现 Next/Fastify 双实现。不要删除整个 `src/app` 目录，因为 `src/app/globals.css` 当前仍被 Vite 客户端入口引用。
- 删除或冻结旧 `src/auth.ts`、`src/lib/auth-guards.ts`、`src/types/next-auth.d.ts` 等 Auth.js 专用运行文件；若短期保留用于迁移参考，必须从构建和文档中标记为 legacy，不允许继续修改业务逻辑。
- 移除 `next`、`next-auth`、`eslint-config-next` 等旧运行依赖的计划应并入迁移验收；如果暂时不能删除依赖，需要在 README 标注“生产运行不依赖 Next.js”。

## 根因结论

### 图片刷新并丢失显示状态

当前画板使用 tldraw store 承载画布状态。部分素材操作完成后会调用 `refreshCanvasRender()`，旧实现会重新创建 tldraw store 并通过 `key` 强制重挂载 `<Tldraw />`。这会让图片重新加载，并丢失当前视口、选区和临时显示状态。

正确策略是：素材数据变化只更新业务侧 `board.assets`，画布编辑器本身保持挂载；如需刷新，只更新 viewport、selection 和 page info，不重建 store。
例外场景必须显式命名：切换到另一个 `boardId`、导入 `.tldr` 文件、用户主动恢复快照或快照损坏后重建空 store，才允许重建 tldraw store。

### 素材弹窗下载无效

素材弹窗下载链路包含两步：

1. 读取 `/api/assets/:assetId/file` 获取图片 blob。
2. 调用 `/api/exports` 保存到本地导出目录，并触发浏览器下载。

问题点有两个：

- 前端读取素材文件时使用原生 `fetch(asset.publicUrl)`，不会走项目统一的 `apiFetch`，在独立 API 地址或需要 cookie 会话时容易失败。
- Fastify 运行路径未注册 `/api/exports`，该接口只存在于旧 Next API 目录，因此当前实际服务端无法完成保存到本地导出目录。

### 素材列表只显示 8 张

当前画板素材面板已经从服务端加载 `board.assets`，但前端渲染时使用 `imageAssets.slice(0, 8)` 只展示前 8 张图片素材。用户删除前面的素材后，数组后面的素材才会出现在面板中，表现为“删除部分素材才显示其他素材”。

正确策略是：素材面板不能通过硬编码 `slice(0, 8)` 隐藏已加载素材。短期修复应渲染所有已加载的 `imageAssets`，由面板滚动容器承载。当前 Fastify `GET /api/boards/:boardId` 仍只返回最近 50 个素材（`assets.take = 50`），所以本轮修复边界是“已加载素材不再被前端截断”；超过 50 个素材的完整历史访问必须改成显式分页、加载更多或虚拟滚动，不能继续依赖删除前面素材来访问后续素材。

### Codex OAuth 登录缺失

`no-oauth` 分支已有一套官方 Codex OAuth 登录流程：

- `src/lib/codex-oauth.ts`：创建 OpenAI OAuth 授权 URL、启动本地 `127.0.0.1:1455/auth/callback` 回调服务、交换 token、解析账号信息，并写入 `.codex/codex-auth.json`。
- `src/app/api/codex-auth/start/route.ts`：跳转到 OpenAI OAuth 授权页。
- `src/app/api/codex-auth/status/route.ts`：读取本地 Codex 登录状态。
- `src/components/CodexLoginCard.tsx` 和 `BoardList.tsx`：在首页展示 Codex 登录卡片与连接状态。

当前主线已经迁移到 Fastify，旧 Next API 路由不会参与运行。因此迁移策略不是照搬 `src/app/api/*`，而是保留 OAuth 核心逻辑并适配到 `server/routes/codex-auth.ts`、Vite 前端组件和统一 `apiFetch`。

### 当前未提交改动范围

当前分支已有这些未提交修改，方案需要一并收口，并在落地前按用途分组处理：

- 必须收口到 Vite/Fastify 主运行链路：
  - `server/app.ts`：CORS 支持、exports 路由注册。
  - `server/auth.ts`：`AUTH_COOKIE_DOMAIN` 支持，登录和退出使用相同 cookie domain。
  - `server/routes/assets.ts`：上传图片尺寸从文件元数据补齐、素材文件私有缓存、反推提示词改用 Responses API 优先并清洗模型包装文案。
  - `server/routes/boards.ts`：快照保存增加非空画布防空覆盖保护，支持显式 `allowEmpty=1`。
  - `server/routes/generation-jobs.ts`：生成任务改为 202 异步执行，并提供 `GET /api/generation-jobs/:jobId` 轮询；生成内部仍应按单张顺序调用第三方图片接口，避免本地 OpenAI 兼容代理并发流式返回时提前关闭。
  - `server/routes/exports.ts`：新增 Fastify 导出路由，替代旧 Next `/api/exports`。
  - `src/lib/api-client.ts`、`src/client/api.ts`、`src/components/AccountActions.tsx`、`src/components/AdminUsagePanel.tsx`、`src/components/AdminUserReview.tsx`、`src/components/BoardList.tsx`、`src/components/BoardWorkspace.tsx`、`src/components/ProviderSettingsForm.tsx`：统一 API 调用到 `apiFetch`，支持 `VITE_API_BASE_URL` 和 cookie；其中 `BoardWorkspace.tsx` 同时承接 tldraw store 单次挂载、生成任务轮询、素材预览弹窗下载/载入/提示词展示、素材列表去除 8 张硬截断、移动端视口修复和生成中状态。
  - `src/app/globals.css`：素材列表、预览弹窗、生成状态和移动端样式调整；这是共享 CSS 的短期例外，不代表保留 Next App Router。
  - `vite.config.ts`：注入 `VITE_API_BASE_URL`。
  - `scripts/smoke-fastify-server.mjs`：Fastify smoke 支持 method 参数并覆盖 `/api/exports`。
  - `docs/tldraw-ai-board.service`：生产 node 路径修正。
- 文档同步改动：
  - `docs/ai-image-workbench-plan.md`、`docs/superpowers/plans/2026-05-11-vite-fastify-migration.md`、`verification.md` 需要和最终架构、验证命令、已知限制保持一致，不能继续描述旧 Next/Auth.js 为生产运行路径。
- 旧架构待删除或迁移确认：
  - `src/app/api/**`、`src/app/page.tsx`、`src/app/login/page.tsx`、`src/app/boards/[boardId]/page.tsx`、`src/app/mobile-preview/[boardId]/page.tsx`、`src/auth.ts`、`src/lib/auth-guards.ts`、`src/types/next-auth.d.ts` 中已有的有效业务改动必须先确认是否已迁移到 Fastify/Vite。迁移完成后删除旧文件；未迁移项列为 blocker，不允许通过回滚旧文件来丢弃用户未提交工作。
- 生成产物：
  - `dist/` 是构建输出，应由 `.gitignore` 或交付规范明确是否提交；默认不作为方案正文需要人工维护的源码改动。
  - 本轮默认不提交 `dist/`，需要把 `/dist` 加入 `.gitignore`；如果生产部署明确要求提交构建产物，必须在交付说明中单独声明。
- 忽略规则：
  - 本轮 P1 收口必须同步修改 `.gitignore`，让 `/dist`、`.codex/codex-auth.json`、`.codex/codex-oauth-state.json` 被忽略；不能等到 P3 OAuth 实现后再处理，因为当前 `dist/` 已经出现在未跟踪文件中。
  - 当前 `.gitignore` 尚未覆盖上述三项，`git check-ignore .codex/codex-auth.json .codex/codex-oauth-state.json dist/` 预期会失败；实施时必须把这项作为首个收口步骤，先清掉构建产物误提交风险，再继续代码迁移。

## 已完成修复

- 下载素材改为使用 `apiFetch(asset.publicUrl)`，复用统一 fetch 封装；当素材 URL 是相对 API 路径时，会携带 `credentials: include` 并兼容 `VITE_API_BASE_URL`。
- 新增 Fastify `/api/exports` 路由，校验当前用户、画板归属、文件和文件名后写入 `local-exports/<boardName>`。
- 在 Fastify app 中注册 exports 路由。
- 调整 `refreshCanvasRender()`，不再重建 tldraw store，也不再强制重挂载 `<Tldraw />`，避免素材操作导致画布显示状态丢失。

## 后续优化计划

### P0：稳定性收敛

- 保持 `<Tldraw />` 单次挂载，禁止普通素材/生成操作通过 React `key` 重建编辑器；只允许在切换 `boardId`、显式导入/恢复快照或快照损坏恢复时重建。
- 把所有 API 调用统一到 `apiFetch`，避免 Vite API Base URL、cookie 会话和跨域行为不一致。
- 为画板显示状态建立边界：持久化内容进入 snapshot，临时显示状态留在 tldraw editor 内存，不因素材列表刷新而重置。
- 素材面板必须展示所有已加载素材，不能用固定数量在前端静默隐藏。若服务端仍保留最近 50 个素材的加载上限，UI 或文档必须明确这是“最近 50 张”的已知边界；后续再通过分页、加载更多或虚拟滚动访问完整历史。
- 保留服务端快照防空覆盖保护：已有非空画布时，空 snapshot 默认返回 `409`；只有用户明确清空页面或导入空白文件时才允许 `allowEmpty=1`。

### P1：当前未提交功能收口

#### API 与部署

- 首先修改 `.gitignore`，加入 `/dist`、`.codex/codex-auth.json`、`.codex/codex-oauth-state.json`，并用 `git check-ignore .codex/codex-auth.json .codex/codex-oauth-state.json dist/` 验证通过；这是本轮收口的第一步。
- `src/lib/api-client.ts` 是唯一浏览器 API fetch 封装，所有客户端请求使用 `apiFetch` 或 `apiUrl`。
- `vite.config.ts` 继续通过 `VITE_API_BASE_URL` 注入 API Base URL，支持前端静态站点和 API 服务分离部署。
- `server/app.ts` 保留 CORS 白名单 `CORS_ORIGINS`，只允许配置过的 origin 携带 credentials。
- `server/auth.ts` 保留 `AUTH_COOKIE_DOMAIN`，并确保 set/clear cookie 的 domain、path、sameSite、secure 行为一致。
- `docs/tldraw-ai-board.service` 使用部署机器真实 node 路径；生产启动命令统一为 `node dist/server/server/index.js`。

#### 生成任务

- `POST /api/generation-jobs` 返回 `202` 和 running job，不在 HTTP 请求内等待 OpenAI 完成。
- 后台生成任务负责写入本地导出、生成归档、asset 和 generation result，并把 job 状态更新为 `succeeded` 或 `failed`。
- 后台生成任务内部必须顺序执行 `count` 张图片请求，不使用 `Promise.all` 并发调用第三方图片接口。README 已记录顺序调用是为了兼容本地 OpenAI 代理；如果要改为并发，必须先用目标代理完成压力验证，否则回滚并发改动。
- 前端通过 `GET /api/generation-jobs/:jobId` 轮询，显示等待时间、成功、失败和超时提示。
- 服务启动时应处理陈旧 running job：将超过配置阈值（建议 30 分钟）的 `running` job 标记为 `failed`，错误信息说明“服务重启或任务超时，请重新提交”。如果本轮不实现恢复扫描，必须在 README 和方案验收中标为已知限制，不能只在实现里静默遗留。

#### 素材与提示词

- 上传素材时通过 `sharp.metadata()` 补齐宽高，避免前端插入画布时尺寸为 0 或缺失。
- 素材文件响应使用 `private` 缓存，保持用户隔离，不使用公共缓存。
- 反推提示词优先走 OpenAI Responses API，失败后回退 Chat Completions，并清洗标题、Markdown、编号、引号和寒暄包装。
- 素材预览弹窗集中提供预览缩放、设为源图、设为参考图、载入画板、下载、反推提示词和删除。
- 素材列表渲染去掉 `imageAssets.slice(0, 8)`，改为展示所有已加载的图片素材；保留滚动布局，避免素材过多时撑破页面。
- 服务端 `GET /api/boards/:boardId` 当前 `assets.take = 50` 是独立加载上限。本轮若不实现素材分页，README/方案验收必须标注“超过最近 50 个素材仍需后续加载更多或分页支持”；如果要声称展示全部历史素材，则必须同步实现分页或取消该服务端上限并评估性能。

#### 样式与交互

- 保留素材列表从 6 列改为更可点选的 4 列，移动端 2 列。
- 保留素材预览弹窗遮罩、提示词区和操作按钮样式。
- 生成状态新增 `info` 样式，和 success/error 区分。

### P2：去除旧 Next/Auth.js 架构

#### 文件处理

- 先删除或移动旧 Next API 路由目录：`src/app/api/**`。如果暂时需要保留参考，应移动到 `docs/legacy-next-api/`，不能继续参与 TypeScript/ESLint/构建。
- 再删除旧 Next 页面运行文件：`src/app/page.tsx`、`src/app/login/page.tsx`、`src/app/boards/[boardId]/page.tsx`、`src/app/mobile-preview/[boardId]/page.tsx`，或确认它们不再被任何构建入口引用。
- 然后删除 Auth.js 运行文件：`src/auth.ts`、`src/lib/auth-guards.ts`、`src/types/next-auth.d.ts`。删除前必须确认旧 `src/app/**` 引用已清空，否则会产生半迁移构建失败。
- 保留 `src/app/globals.css` 作为共享 CSS 的短期路径可以接受，但它是明确例外，不代表保留 Next App Router。后续应迁移为 `src/client/globals.css`，避免目录名暗示 Next App Router 仍在运行。
- 删除或更新旧 Next 迁移文档中“Next.js 16 / Auth.js 为生产运行路径”的表述。

#### 依赖与脚本

- `package.json` scripts 移除 Next/Auth.js 相关脚本；保留 Vite/Fastify 运行脚本，以及数据库初始化、背景移除检查等当前功能脚本。
- 移除 `next`、`next-auth`、`eslint-config-next` 等不再使用的依赖，或在过渡期单独列为 legacy dependency 并给出删除条件。
- `next-env.d.ts` 只在彻底移除 Next 后删除；删除前先确认 TypeScript 不再引用 Next 类型。

#### 验收

- 在生产代码范围内执行 `rg "next-auth|NextAuth|from \"next/|next/navigation|src/app/api" src server package.json vite.config.ts tsconfig.json tsconfig.server.json` 不应命中；`docs/legacy-*` 或历史文档命中不计入失败。
- `npm run build` 不应执行 `next build`。
- `npm run start` 只启动 `dist/server/server/index.js`。
- 旧 Next API 文件被删除后，所有对应能力必须在 `server/routes/*` 中存在。

### P3：Codex OAuth 登录迁移

目标是在当前 Fastify/Vite 运行链路中提供和 `no-oauth` 分支等价的“登录 OpenAI Codex”能力，登录结果保存到项目本地 `.codex/codex-auth.json`，首页能显示连接状态并提供重新登录入口。

该能力默认只面向管理员 `koiyoho`，不作为普通用户功能开放。Codex OAuth 的发起和状态读取必须先通过本应用登录态校验，并使用 `requireAdminUser` 限制访问，避免任意访客发起 OAuth、覆盖服务器本地 token 或读取账号摘要。OAuth callback 不能依赖普通应用 cookie，必须改用 start 阶段写入的 OAuth state 和一次性 admin session proof 完成校验。

部署模式必须在实现前二选一：

- 本机部署模式：服务和浏览器运行在同一台机器，沿用 `no-oauth` 分支的 `http://localhost:1455/auth/callback`。这种模式只适合开发机或单机本地使用。
- 远程部署模式：服务可能被外部浏览器访问，不能使用浏览器机器上的 `localhost`。应改为 Fastify 自身提供 `GET /api/codex-auth/callback`，并通过环境变量配置公开回调地址，例如 `CODEX_OAUTH_REDIRECT_URI=https://example.com/api/codex-auth/callback`。

当前项目 README 已支持远程访问入口配置，因此正式实现应优先采用“远程部署模式”。只有明确确认项目只在本机访问时，才允许使用本机 callback server。

在实现远程部署模式前，必须先验证 `client_id = app_EMoamEEZ73f0CkXaXp7hrann` 是否允许目标 `redirect_uri`。如果 OpenAI OAuth client 不允许项目域名或自定义 callback，远程模式不能落地；此时只能保留本机 callback 模式，或改用官方 CLI/device flow 等不依赖项目域名回调的流程。不得假设任意 `/api/codex-auth/callback` 都能被该 client 接受。

#### 文件范围

- 新建 `server/lib/codex-oauth.ts`：从 `no-oauth` 分支迁移 OAuth 核心逻辑，保留 PKCE、state 校验、本地 callback server、token exchange、状态读取和 HTML 回调页渲染。该文件包含文件系统和 token 处理逻辑，只允许服务端导入，不能放在可能被 Vite 客户端误导入的 `src/lib`。
- 新建 `server/routes/codex-auth.ts`：Fastify 路由层，提供 `GET /api/codex-auth/start`、`GET /api/codex-auth/status`，远程部署模式下还提供 `GET /api/codex-auth/callback`。从该路由导入 OAuth 核心逻辑时必须使用相对路径 `../lib/codex-oauth`；当前 `@/*` 只映射到 `src/*`，不能用 `@/lib/codex-oauth`，否则会把服务端敏感逻辑误导回 `src/lib`。
- 修改 `server/app.ts`：注册 Codex auth 路由。
- 新建 `src/components/CodexLoginCard.tsx`：Vite 客户端组件，使用 `apiFetch("/api/codex-auth/status")` 读取状态，并链接到 `apiUrl("/api/codex-auth/start")`。
- 修改 `src/components/BoardList.tsx`：在管理中心或首页设置区展示 Codex 登录卡片和连接状态。
- 修改 `src/app/globals.css`：迁移 `.codex-login-card` 样式，保持和当前首页视觉一致。
- 复用 P1 已完成的 `.gitignore` 规则；OAuth 实现前再次执行 `git check-ignore .codex/codex-auth.json .codex/codex-oauth-state.json dist/`，确认 Codex token 文件和构建产物不会进入提交。

#### 实现步骤

1. 迁移 `server/lib/codex-oauth.ts`，但不要保持单个大文件的原样耦合。`server/routes/codex-auth.ts` 必须通过 `../lib/codex-oauth` 相对导入该文件；除非同时更新 `tsconfig`、`tsc-alias` 和构建约定，否则不要新增 `server/*` 路径别名。至少拆出这些可测试函数：
   - `buildCodexAuthorizeUrl(input)`：输入 issuer、clientId、redirectUri、codeChallenge、state，返回授权 URL。
   - `parseJwtAuthClaims(idToken)`：解析 JWT claims，不触碰文件系统和网络。
   - `readSavedCodexAuth()` / `writeSavedCodexAuth()`：只负责 `.codex/codex-auth.json` 读写。
   - `readPendingOAuthState()` / `writePendingOAuthState()` / `clearPendingOAuthState()`：只负责 state 文件读写。
   - `exchangeCodeForTokens()` / `exchangeIdTokenForApiKey()`：只负责 OpenAI token endpoint 调用。
   - `handleCodexCallback()`：串联 state 校验、token exchange、auth 写入和回调 HTML。
2. 在 `createCodexAuthorizeUrl` 中保留 `client_id = app_EMoamEEZ73f0CkXaXp7hrann`、issuer `https://auth.openai.com`、PKCE 和 `codex_cli_simplified_flow=true`。`redirect_uri` 必须来自部署模式：
   - 远程部署模式：使用 `CODEX_OAUTH_REDIRECT_URI`，必须是当前服务可接收的公开 HTTPS/HTTP URL。
   - 本机部署模式：仅在明确启用 `CODEX_OAUTH_LOCAL_CALLBACK=1` 时使用 `http://localhost:1455/auth/callback`。
3. 在 `server/routes/codex-auth.ts` 中实现：
   - `GET /api/codex-auth/start`：先调用 `requireAdminUser`，为当前管理员生成一次性 admin session proof，写入 pending OAuth state，再调用 `createCodexAuthorizeUrl` 并返回 `302` 跳转。
   - `GET /api/codex-auth/status`：先调用 `requireAdminUser`，再调用 `readCodexAuthStatus`，返回 `{ connected: false }` 或账号摘要。
   - `GET /api/codex-auth/callback`：远程部署模式下处理 OAuth callback，不能先调用 `requireAdminUser`，也不能依赖普通 `ai_board_session` cookie。callback 必须同时校验 OAuth state 和 pending state 中的一次性 admin session proof（例如由 admin user id、issuedAt、随机 nonce 和 `AUTH_SECRET` HMAC 生成）；校验通过后才交换 token 并写入 `.codex/codex-auth.json`。
   - callback 的 pending state 必须只能被消费一次；成功、OAuth error、state/proof 不匹配或 token exchange 失败后的清理策略要固定并测试，不能留下可复用的旧 proof。
4. 前端组件必须使用 `apiFetch` / `apiUrl`，避免独立 API 地址下仍指向前端源站。
5. 首页状态只显示账号摘要、plan、是否保存 API key，不在 UI 或日志中显示 token、refresh token、id token 或 OpenAI API key。
6. OAuth callback 到达后必须消费 pending state：成功、OAuth error、state/proof 不匹配或 token exchange 失败都清理 pending state；state/proof 不匹配时不写入 auth 文件，用户需要重新发起登录。
7. 错误响应和日志只允许输出错误类型、HTTP 状态、OpenAI 返回的非敏感错误文本；不得输出 token、authorization code、code verifier、id token、refresh token 或完整 auth JSON。
8. 重新登录会覆盖旧 `.codex/codex-auth.json`。覆盖前不需要保留历史 token；失败时保留旧可用 auth 文件，不写入半成品。

#### 验证步骤

- `npm run lint`
- `npm run build`
- `npm run smoke:fastify`
- 新增 smoke：已登录本应用管理员、但未保存 `.codex/codex-auth.json` 时，`GET /api/codex-auth/status` 返回 `200` 和 `{ connected: false }`。
- 新增鉴权验证：未登录访问 `GET /api/codex-auth/start`、`GET /api/codex-auth/status` 返回 `401`；非管理员访问 start/status 返回 `403`；远程模式下 callback 缺少或伪造 state/proof 时返回失败页或结构化错误，不写 `.codex/codex-auth.json`。
- 新增 callback 可行性验证：确认目标 `CODEX_OAUTH_REDIRECT_URI` 被当前 OpenAI OAuth client 接受；若不接受，方案必须切换为本机 callback 或 device flow。
- 新增授权 URL 单元测试：`buildCodexAuthorizeUrl` 产物必须包含 `response_type=code`、`client_id`、`redirect_uri`、`code_challenge_method=S256`、`state` 和 `codex_cli_simplified_flow=true`。
- 新增 state/session proof 校验测试：callback state 或 admin session proof 不匹配时返回失败页，不写 `.codex/codex-auth.json`，并必须清理 pending state，要求用户重新发起登录。
- 新增 token 脱敏测试：错误响应和状态响应不得包含 `access_token`、`refresh_token`、`id_token`、`openaiApiKey` 或 `codeVerifier` 字段。
- 手动验证：
  - 远程部署模式：点击首页“登录 OpenAI Codex”，浏览器打开 OpenAI 授权页；完成授权后回到 `CODEX_OAUTH_REDIRECT_URI` 对应的 Fastify callback，页面显示“Codex 登录已保存”，首页刷新后显示已登录状态。
  - 本机部署模式：仅在 `CODEX_OAUTH_LOCAL_CALLBACK=1` 时验证 `http://localhost:1455/auth/callback`，完成授权后本地 callback 页显示“Codex 登录已保存”，首页刷新后显示已登录状态。

#### 风险边界

- 该能力保存的是 Codex OAuth 登录信息，不替代本应用用户名密码登录，也不绕过管理员审核。
- `.codex/codex-auth.json` 包含敏感 token，必须保持本地文件并被 `.gitignore` 排除。
- `.codex/codex-auth.json` 和 `.codex/codex-oauth-state.json` 必须只由服务端读写，不通过静态托管暴露。静态文件服务根目录仍应限定在 `dist/client`，不能把项目根目录作为静态根。
- 写入 `.codex/codex-auth.json` 后应尽量设置仅当前用户可读写的文件权限；Windows 环境至少不能放入 `public/`、`dist/`、`local-exports/` 等可下载目录。
- 本机 callback 模式下，`localhost:1455` 端口被占用必须返回明确错误。远程部署模式下，缺少 `CODEX_OAUTH_REDIRECT_URI` 必须启动失败或让 start 路由返回明确配置错误。

### P4：组件拆分

`BoardWorkspace.tsx` 当前承担画布、素材、AI 生图、AI 改图、导出、移动端交互等职责，维护成本过高。建议拆分为：

- `CanvasEditorSurface`：只管理 tldraw 挂载、viewport、selection、snapshot。
- `AssetPanel`：素材列表、预览弹窗、下载、删除、设为源图/参考图。
- `GenerationPanel`：文生图、参考图、生成状态和任务轮询。
- `ImageEditPanel`：源图、蒙版、局部编辑、背景移除。
- `useBoardAutosave`：集中处理防抖保存、空快照保护和保存状态。
- `useGenerationJobPolling`：集中处理任务创建、轮询、失败恢复和用户提示。

### P5：测试覆盖

- 增加 Fastify 路由挂载/鉴权 smoke：`POST /api/exports` 未登录应返回 `401`。
- 增加 API 级集成测试并列为下载功能必做验收：登录后创建画板，上传小 PNG，调用 `/api/exports`，确认返回 `output.relativePath`，文件存在于 `local-exports/<boardName>`，且文件字节或 hash 与上传 blob 一致。
- 增加权限边界测试：用户 A 使用用户 B 的 `boardId` 调用 `/api/exports` 必须返回 `404` 或 `403`，且不得写入 `local-exports`。
- 增加生成任务集成测试：创建 generation job 后返回 `202/running`，轮询接口能返回 `succeeded/failed`，失败时包含用户可读错误。
- 增加生成顺序测试或回归检查：`count > 1` 时第三方图片接口调用顺序必须是串行；若采用并发实现，必须记录目标代理兼容性验证结果。
- 增加陈旧 running job 测试：服务启动或维护函数能把超过阈值的 running job 标记 failed；若暂不实现，README 必须标明已知限制。
- 增加快照保护测试：非空画布不能被空 snapshot 覆盖；带 `allowEmpty=1` 时允许清空。
- 增加 API Base URL 测试：`apiUrl("/api/boards")` 在配置 `VITE_API_BASE_URL=http://host:3333/api` 时解析到正确 API 地址。
- 增加前端回归测试：打开画板、缩放/选择图片、打开素材弹窗下载后，确认 tldraw 未重挂载且视口不重置。
- 增加 Codex OAuth 状态 smoke：已登录本应用管理员、但未保存 `.codex/codex-auth.json` 时，`GET /api/codex-auth/status` 返回 `{ connected: false }`。
- 增加素材列表回归测试：构造至少 12 张图片素材，用于验证前端不再 `slice(0, 8)`；素材面板应能看到或滚动访问全部已加载素材，不允许通过删除前 8 张素材才能访问后续素材。
- 增加素材加载上限验证：构造超过 50 张素材，用于验证服务端上限边界；如果本轮未实现分页/加载更多，必须明确只能返回最近 50 张并在 README 标注已知限制；如果实现分页/加载更多，则验证能访问第 51 张及之后的素材。

### P6：性能和体验

- 对 tldraw 相关依赖做路由级懒加载，降低首页首屏包体。
- 生成任务状态从组件本地轮询抽成 hook，统一处理超时、取消和页面切换。
- 素材弹窗下载按钮增加独立 pending 状态，避免和全局 transition 互相影响。
- `BoardWorkspace.tsx` 拆分完成前，避免继续在同一文件中追加大块新功能。

## 验证标准

- `npm run lint` 通过。
- `npm run build` 通过。
- `npm run smoke:fastify` 通过。
- `rg "next-auth|NextAuth|from \"next/|next/navigation|src/app/api" src server package.json vite.config.ts tsconfig.json tsconfig.server.json` 不命中生产运行代码。
- `rg "@/lib/codex-oauth|src/lib/codex-oauth" server src` 不命中，确保 Codex OAuth 服务端实现只存在于 `server/lib/codex-oauth.ts`，并由 `server/routes/codex-auth.ts` 通过 `../lib/codex-oauth` 相对导入。
- `npm run start` 只启动 Fastify 构建产物，生产不依赖 Next.js。
- 已登录本应用管理员、但未登录 Codex 时，`GET /api/codex-auth/status` 返回 `200` 和 `{ connected: false }`。
- Codex OAuth start/status 未登录返回 `401`，非管理员返回 `403`；callback 不依赖应用 cookie，缺少或伪造 state/proof 时必须失败且不写 auth 文件。
- `git check-ignore .codex/codex-auth.json .codex/codex-oauth-state.json dist/` 通过，避免敏感 Codex token 和构建产物误提交。
- `buildCodexAuthorizeUrl`、state/session proof mismatch、token 脱敏、OAuth redirect 可用性、exports 文件字节一致性、跨用户 `boardId` 权限、异步 generation job、生成顺序、陈旧 running job、快照空覆盖保护和 API Base URL 测试通过。
- 手动验证：
  - 打开画板，缩放并选中一张图片，执行上传/载入素材后，视口和选区不应被重置。
  - 打开含 12 张以上图片素材的画板，验证前端不再只显示前 8 张，素材面板应能直接滚动访问全部已加载素材，不需要删除前面的素材。
  - 打开含 51 张以上图片素材的画板，验证服务端素材加载边界：若未实现分页/加载更多，应确认文档已标注最近 50 张上限；若实现分页/加载更多，应能访问第 51 张及之后素材。
  - 打开素材弹窗点击下载，应触发浏览器下载，并在 `local-exports/<画板名>` 下生成文件。
  - 点击首页 Codex 登录入口，完成 OpenAI OAuth 后，远程模式回到 Fastify callback，本机模式回到 `localhost:1455` callback，`.codex/codex-auth.json` 被写入且首页显示已登录状态。
  - 部署服务使用 `docs/tldraw-ai-board.service` 的 `ExecStart` 可正常启动。
