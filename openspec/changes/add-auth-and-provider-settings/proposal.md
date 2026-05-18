## Why

当前应用是无登录单人本地应用，所有画板、素材和生成任务都共享同一个数据空间，并且 AI provider 只读取服务端 `.env` 的全局 OpenAI 配置。现在需要支持多用户使用和用户自带第三方 OpenAI 兼容 API，必须先建立身份边界、用户数据归属和用户级 provider 配置契约。

## What Changes

- **BREAKING**: 画板、素材、快照、生成任务和导出访问从全局共享数据改为当前登录用户可访问的数据。
- 新增用户登录状态：未登录用户不能进入画板列表、画板详情、上传、导出、保存快照或发起 AI 生成。
- 新增本地用户名密码登录能力，账号凭据保存在本地 SQLite 数据库；注册后进入待审核状态，不自动登录。
- 固定管理员账号 `koiyoho` 初始化为 `admin + approved`，只有该管理员可以审核新用户。
- 管理员审核通过用户时可以授权该用户使用 `koiyoho` 当前启用的 OpenAI 兼容 API。
- 新增用户级第三方 API 设置能力，用户可以配置 OpenAI 兼容接口的 API Key、Base URL 和图片模型。
- AI 生成接口优先使用当前用户保存的 provider 配置；无用户配置但已获授权时使用 `koiyoho` 当前启用的 provider；两者都没有时提示用户设置第三方 API 或联系管理员授权。
- 首页和画板页增加登录/退出入口、当前账号状态和 provider 设置入口。
- 初始化数据库和 Prisma schema 增加用户、密码哈希、账号会话和用户 provider 配置相关模型。

## Capabilities

### New Capabilities

- `user-auth`: 覆盖用户会话、本地用户名密码登录、注册待审核、管理员审核、退出、路由/API 鉴权和用户数据隔离。
- `provider-settings`: 覆盖用户级 OpenAI 兼容 provider 配置、管理员 API 授权回退、配置校验、生成接口选用规则和设置界面。

### Modified Capabilities

- 无。当前仓库没有既有 OpenSpec specs；现有画板和 AI 生成行为会在新能力约束下被纳入用户身份边界。

## Impact

- 影响 `src/app` 页面结构：需要登录页或登录入口、用户状态展示、provider 设置界面，以及首页/画板页的登录态处理。
- 影响 `src/app/api`：boards、assets、exports、generation-jobs、snapshot、duplicate 等接口需要读取当前用户并限制资源归属。
- 影响 `prisma/schema.prisma` 和 `scripts/init-db.mjs`：需要新增用户相关表，并为 Board 等业务表补充用户归属字段。
- 影响 `src/lib/openai.ts`：需要从全局单例环境配置切换为按当前用户 provider 配置创建客户端。
- 影响环境变量：需要新增应用 URL 和会话密钥等配置。
- 影响验证：需要增加本地鉴权冒烟测试、未登录 API 拒绝测试、登录后画板隔离测试和用户 provider 配置生效测试。
