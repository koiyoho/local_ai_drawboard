## Context

日期：2026-04-29  
执行者：Codex

当前项目是 Next.js App Router + React + Prisma + SQLite 的本地 AI 画板。README 记录当前范围是“无登录单人应用”，`Board`、`Asset`、`GenerationJob` 等业务数据没有用户归属字段，`src/app/page.tsx` 会直接读取全部画板，API 路由也只按 `boardId` 操作资源。AI provider 配置集中在 `src/lib/openai.ts`，通过 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_IMAGE_MODEL` 构造全局 OpenAI 客户端。

本变更需要同时引入登录态、本地用户名密码登录、用户数据隔离和用户级 OpenAI 兼容 provider 配置。设计依据包括本地 Next.js 16 文档 `node_modules/next/dist/docs/01-app/02-guides/authentication.md`、Route Handlers 文档，以及 Auth.js 官方文档中 Next.js `auth.ts`、`app/api/auth/[...nextauth]/route.ts`、Credentials provider 和 server action `signIn` 的集成方式。

## Goals / Non-Goals

**Goals:**

- 使用 Auth.js Credentials provider 接入本地用户名密码登录，建立服务端可读取的当前用户身份。
- 注册账号默认进入 `pending`，不建立会话；只有固定管理员 `koiyoho` 审核通过后才能登录。
- 将画板、素材、快照、生成任务和导出访问限制到当前用户拥有的数据。
- 提供用户级第三方 OpenAI 兼容 API 配置，包含 API Key、Base URL、图片模型和启用状态。
- 让 AI 生成链路优先按当前用户 provider 创建 OpenAI SDK client；用户没有 provider 且被授权时回退到 `koiyoho` 当前启用 provider。
- 保持现有本地 SQLite + Prisma + `scripts/init-db.mjs` 初始化方式可用。
- 为后续支持多个 AI provider 留出清晰的数据模型边界。

**Non-Goals:**

- 不做团队、组织、共享画板或多人协作；只引入固定管理员 `koiyoho` 与普通用户审核状态。
- 不做线上对象存储迁移，文件仍使用当前本地存储。
- 不做 provider 市场、计费、额度管理或生成队列重构。
- 不改造 tldraw 画布核心交互和 AI 图片工作台主流程。

## Decisions

### 1. 本地账号登录和会话使用 Auth.js

采用 Auth.js（NextAuth）Credentials provider 作为用户名密码校验、会话读取和登录/退出入口的标准实现，新增 `auth.ts` 导出 `auth`、`handlers`、`signIn`、`signOut`，并在 `src/app/api/auth/[...nextauth]/route.ts` 暴露 Auth.js route handlers。用户表保存 `username` 和 `passwordHash`，登录页通过 server action 调用 `signIn("credentials")`。非管理员登录前必须满足 `status = approved`；注册动作只创建 `pending` 用户并返回待审核提示。

备选方案是手写 cookie session 和登录校验。该方案会引入额外自研维护面，因此不采用。

### 2. 数据持久化使用 Prisma Client 和 JWT Session

Auth.js Credentials provider 使用 JWT session；本地账号数据由 Prisma `User` 模型持久化。`User` 增加 `role`、`status`、`canUseAdminProvider`、`approvedAt`、`approvedByUserId` 和注册时间字段。`scripts/init-db.mjs` 会把用户名为 `koiyoho` 的既有账号标记为 `admin + approved`，但不迁移 `local-default-user` 及其画板。现有业务模型新增 `userId` 外键：`Board.userId` 是核心归属边界，`Asset`、`BoardSnapshot`、`GenerationJob` 继续通过 `boardId` 归属到用户，也可以在查询时通过 board 关联校验。

备选方案是数据库 session。Credentials provider 与 JWT session 组合更直接，且本地账号资料仍落在 `User` 表，因此采用 JWT session。

### 3. 用户级 provider 配置独立建模

新增 `ProviderSetting` 模型，最小字段包括 `id`、`userId`、`provider`、`displayName`、`apiKey`、`baseUrl`、`imageModel`、`enabled`、`createdAt`、`updatedAt`。第一阶段 provider 枚举值使用 `openai-compatible`，以 OpenAI Node SDK 兼容接口为契约。

备选方案是继续只用 `.env` 全局配置。该方案无法满足“设置第三方 API”的用户级需求，并且多用户会共享同一个 key，因此不采用。

### 4. API 鉴权集中在服务端 helper

新增服务端 helper，例如 `requireUser()` 和 `requireBoardOwner(boardId)`：页面 Server Component 使用 `auth()` 判断登录态并重定向，Route Handler 在每次读写前读取当前用户；涉及 boardId 的接口必须通过 `Board.id + userId` 查找，不允许只按 `boardId` 更新或删除。

备选方案是在前端隐藏按钮或只做页面级重定向。该方案不能保护 API 路由，因此不采用。

### 5. OpenAI client 改为按请求选择 provider

`src/lib/openai.ts` 从读取全局环境变量的单例改为接收 provider 配置，例如 `createOpenAIClient(setting)`。`POST /api/generation-jobs` 在创建任务前先读取当前用户启用的 provider setting；如果没有且用户 `canUseAdminProvider = true`，则读取 `koiyoho` 当前启用的 `openai-compatible` provider。任务参数记录 provider id、展示名、owner（`self` / `admin`）、baseUrl 是否配置和 model，便于生成历史可追溯，同时不记录 API key。

备选方案是把用户配置注入环境变量或全局缓存。该方案会在多用户并发下混用配置，因此不采用。

## Risks / Trade-offs

- [Risk] Prisma 7 当前项目使用自定义 client 输出路径，Auth.js Prisma Adapter 对 client 形态可能有兼容细节 → Mitigation：实施前用当前生成的 Prisma client 做最小 adapter 编译验证；如 adapter 要求标准导出，则通过本项目 `src/lib/prisma.ts` 提供兼容实例，不改变业务调用入口。
- [Risk] 现有 SQLite 数据没有用户归属，直接新增必填 `Board.userId` 会让旧数据无法归属 → Mitigation：本地开发迁移时创建一个本地默认用户并把既有 Board 归属过去，或明确清空本地 dev.db 后重新初始化。
- [Risk] API Key 持久化后需要避免发送到客户端 → Mitigation：设置 API 只允许写入和读取脱敏摘要，生成接口只在服务端读取完整值。
- [Risk] 第三方 OpenAI 兼容网关对 `images.generate`、`images.edit` 支持差异大 → Mitigation：保存配置时做可选连通性检查；生成失败时保留当前错误写入 `GenerationJob.errorMessage`。
- [Risk] 多用户后本地文件路径仍按 boardId 存储 → Mitigation：删除和读取文件前通过 board 归属校验，文件目录结构暂不作为权限来源。

## Migration Plan

1. 安装并配置 Auth.js Credentials provider 和密码哈希依赖。
2. 更新 Prisma schema 与 `scripts/init-db.mjs`，新增 Auth.js 表、`ProviderSetting` 表和业务数据用户归属字段。
3. 执行本地数据库初始化或迁移脚本，确保旧本地数据保留在 `local-default-user`，并把 `koiyoho` 标记为管理员已通过。
4. 增加 `auth.ts`、登录/退出路由入口、注册待审核提示、登录页和首页登录状态组件。
5. 改造页面和 API 路由，所有 boardId 访问都使用当前用户约束。
6. 增加管理员审核 API 和首页审核 UI。
7. 改造 provider 设置页面/API、管理员 API 授权回退和 OpenAI client 创建逻辑。
8. 执行 lint、build、未登录 API 拒绝、登录后画板 CRUD、provider 设置、管理员审核和生成链路冒烟测试。

Rollback 策略：本地开发环境可回退代码并恢复变更前 `prisma/dev.db` 备份；如果没有备份，则执行 `npm run db:init` 重新初始化空库。

## Open Questions

- 本地注册失败时是否需要在表单内展示更细分的错误原因；当前实现对重复用户名、待审核和拒绝状态返回明确提示。
- 用户未配置 provider 时是否允许回退到服务端 `.env` 默认配置；本设计不回退 `.env`，只允许在管理员审核时显式授权使用 `koiyoho` 当前 API。
- API Key 是否需要在本地 SQLite 中加密保存；本设计只规定不得返回明文给客户端，具体存储保护策略在实施阶段结合部署形态决定。
