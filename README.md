# AI Board

日期：2026-05-01
执行者：Codex

本项目是本地优先的 tldraw AI 图片画板。当前版本包含本地用户名密码登录、管理员审核、用户级画板隔离、OpenAI 兼容图片 API 设置、移动端/桌面端 AI 图片工作台、生成图片归档、管理员用量管理和 SQLite + Prisma 本地存储。

## Getting Started

安装依赖并初始化本地数据库：

```bash
npm install
npm run db:generate
npm run db:init
```

复制环境变量：

```bash
copy .env.example .env
```

基础环境变量：

```env
DATABASE_URL="file:./prisma/dev.db"
AUTH_SECRET="至少 32 位随机字符串"
AUTH_URL="http://localhost:3333"
VITE_TLDRAW_LICENSE_KEY=""
VITE_API_BASE_URL=""
CODEX_OAUTH_REDIRECT_URI=""
CODEX_OAUTH_LOCAL_CALLBACK=""
CODEX_IMAGE_PROXY_BASE_URL=""
CODEX_IMAGE_PROXY_API_KEY=""
```

`AUTH_URL` 必须和浏览器实际访问入口一致。比如通过外网地址访问时，设置为 `http://taki999.f3322.org:3333`；只在本机访问时，建议统一使用 `http://localhost:3333`，避免 `127.0.0.1` 和 `localhost` 混用导致登录回调不一致。

`VITE_API_BASE_URL` 只在前端静态站点和 API 服务分离部署时需要配置，例如 `https://api.example.com/api`。Codex OAuth 远程部署时必须设置 `CODEX_OAUTH_REDIRECT_URI`，例如 `https://example.com/api/codex-auth/callback`；仅本机开发且浏览器和服务运行在同一台机器时，可以设置 `CODEX_OAUTH_LOCAL_CALLBACK=1` 使用 `http://localhost:1455/auth/callback`。

官方 Codex 登录保存的是账号 OAuth token，用于显示 Codex 登录状态，不等同于 OpenAI Images API key。若管理员把某个生图模型的后台通道设置为“官方 Codex”，需要另外启动 CLIProxyAPI 等 OpenAI 兼容代理，并把 `CODEX_IMAGE_PROXY_BASE_URL` 指向代理的 `/v1` 地址；代理要求鉴权时再设置 `CODEX_IMAGE_PROXY_API_KEY`。未配置代理时，Codex 图片通道会拒绝生图请求并提示改用第三方 API 或 Gemini Bridge。

启动开发服务：

```bash
npm run dev -- --port 3333
```

生产构建验证：

```bash
npm run build
npm run start -- --port 3333
```

## 登录与首页

- 未登录用户进入登录页，可以登录或提交注册。
- 注册后的新账号默认为待审核，管理员审核通过后才能登录。
- `npm run db:init` 会确保管理员 `koiyoho` 存在，并标记为管理员和已通过。
- 登录后的首页包含项目工作区、创建画板、最近画板、账号操作、API 设置、用户审核和用户用量入口。
- API 设置位于首页管理区域，可通过按钮展开或收起；保存时如果已有 API Key，可以只修改 Base URL、模型或启用状态。
- 管理员首页包含 OpenAI Codex 登录入口。登录结果保存到本地 `.codex/codex-auth.json`，该文件包含敏感 token 并已被 `.gitignore` 排除。Codex 账号登录本身不直接提供图片 API 调用能力，Codex 图片通道需要配置 OpenAI 兼容代理。

## 用户与管理员

管理员能力：

- 审核或拒绝新用户。
- 授权用户使用管理员当前启用的 OpenAI 兼容接口。
- 查看每个用户的画板数、生成次数、成功/失败任务、最近生成图片和历史生成记录。
- 为用户设置生成总量限制和每 5 小时生成量限制。
- 停用、启用或删除用户。删除用户会清理其本地画板资产和 `generated-images/<username>` 归档目录。

默认用量限制：

- 新用户生成总量：30 张。
- 新用户每 5 小时生成量：10 张。
- 管理员可以在首页的用户用量卡片中按用户调整限制。

## AI 图片工作台

画板页面在桌面端和移动端保持一致的四个工作区：

- 画板：tldraw 自由画布、上传图片、选择素材、保存、同步、导出、缩放和工具栏配置。
- AI 生图：输入提示词、选择尺寸、选择数量、添加参考图，并为每张参考图标记角色。
- AI 改图：选择源图、输入修改要求、添加参考图，支持整图修改、涂抹区域和选区生成。
- 素材：查看当前画板最近 50 个已加载资产，图片可预览、缩放、设为源图、加入参考图或删除。前端会展示服务端返回的全部素材，不再只显示前 8 张；完整历史素材分页仍是后续优化项。

参考图角色：

- 不标记角色
- 主体人物
- 商品参考
- 服装参考
- Logo 参考
- 风格参考
- 背景参考

移动端和桌面端共用同一批画板数据、参考图角色、素材列表和生成请求结构。各页面标题栏提供返回设置页、同步和保存入口。

## 分镜脚本工作台

第一期分镜脚本工作台已在 `v0.1.10` 发布，并于 2026-05-18 完成人工 UI 回巡，当前回巡未发现问题。

第一期分镜工作台用于把短视频文案转为结构化镜头表。用户可以选择平台和内容类型，填写 Brief 与原始文案，生成可编辑分镜，并为每个镜头生成首帧提示词、尾帧提示词和视频生成提示词。镜头可把当前画布选中的图片绑定为首帧或尾帧参考，提示词生成会带入绑定素材的类型、尺寸、标签和来源提示词上下文。绑定素材可以从分镜页直接预览或定位到当前画布对象，单个镜头也可以复制包含镜头字段、绑定素材和三类提示词的 Markdown 提示词包。分镜页支持从首帧/尾帧提示词创建图片生成任务，生成结果会作为普通素材进入画板，并自动绑定回当前镜头。Markdown、JSON、CSV 导出会包含镜头提示词和首尾帧素材信息。当前阶段不接入视频模型，不创建视频生成任务。

## 生成能力

后端统一入口：

```text
POST /api/generation-jobs
```

文生图请求示例：

```json
{
  "boardId": "<board id>",
  "mode": "text_to_image",
  "prompt": "a clean product render on a white table",
  "size": "1024x1024",
  "count": 1,
  "referenceItems": [
    { "assetId": "<asset id>", "role": "product" }
  ]
}
```

局部编辑请求示例：

```json
{
  "boardId": "<board id>",
  "mode": "inpaint",
  "prompt": "replace the marked area with a glass display stand",
  "sourceAssetId": "<uploaded image asset id>",
  "maskAssetId": "<uploaded mask asset id>",
  "size": "1024x1024"
}
```

说明：

- 提示词前端限制为 2000 字。
- 参考图最多 8 张，角色会通过 `referenceItems` 传给后端并写入生成任务参数。
- 文生图无参考图时使用 `images.generate`；有参考图或执行改图时使用兼容 `images.edit` 的多图/源图接口。
- 生成请求按单张顺序调用，避免本地 OpenAI 兼容代理在并发流式返回时提前关闭。
- 生成成功后，图片会自动写入素材区，并插入画布的空白位置，避免多张结果堆叠。
- 页面会在生成按钮附近显示成功或失败提示。

## API 设置

每个用户都可以配置自己的 OpenAI 兼容图片接口：

- API Key：第三方平台的 key。
- Base URL：第三方平台提供的 OpenAI 兼容地址，例如 `http://localhost:8317/v1`。
- 图片模型：第三方支持的图片模型名，当前默认面向 `gpt-image-2`。

服务要求：

- 必须兼容 OpenAI Node SDK 的 Images API。
- 文生图至少支持 `images.generate`。
- 改图和参考图生成需要支持 `images.edit` 的 `image` / `mask` multipart 参数。

Provider 选择顺序：

1. 当前用户自己的启用 provider。
2. 当前用户被管理员授权时，使用管理员 `koiyoho` 当前启用的 provider。
3. 都不可用时返回“请配置第三方 API 或联系管理员授权使用当前 API”。

生成任务只记录 provider 元数据，不记录 API Key。

### Gemini Pro 网页额度本地桥接

个人本地使用时，可以用 `gemini-webapi` 复用 Gemini Web 登录态，并在本机暴露一个 OpenAI Images API 兼容桥接服务。该方式不是 Google 官方 OAuth/API，不适合公网部署或多人共享；`__Secure-1PSID` 等 cookie 等同于 Google 账号会话凭据，只能放在服务器本地 `.env` 或 `.codex/gemini-web-auth.json`，不要提交到仓库。

安装桥接依赖：

```powershell
python -m pip install -r scripts/requirements-gemini-bridge.txt
```

在 `.env` 中填写 bridge 本地服务配置：

```env
GEMINI_BRIDGE_API_KEY="local-only-secret"
GEMINI_BRIDGE_HOST="127.0.0.1"
GEMINI_BRIDGE_PORT="8317"
GEMINI_CLIENT_TIMEOUT_SECONDS="120"
```

Gemini Cookie 可以通过两种方式提供：

- 推荐：在本机浏览器获取 Cookie 后，在服务器执行导入命令。后端会按 `gemini-webapi` 的 Cookie JSON 习惯写入 `.codex/gemini-web-auth.json`，字段为 `__Secure-1PSID` 和 `__Secure-1PSIDTS`；该文件已被 `.gitignore` 排除。
- 可视化导入：进入管理中心的 `Gemini Web Bridge` 模块，粘贴 `__Secure-1PSID` 和 `__Secure-1PSIDTS` 后保存。
- 备用：直接在 `.env` 中填写 `GEMINI_SECURE_1PSID` 和 `GEMINI_SECURE_1PSIDTS`。

浏览器不允许本站直接读取 `gemini.google.com` 的会话 Cookie；管理中心提供的 Gemini 链接和 Chrome Cookie 设置地址只能辅助定位，Cookie 值仍需人工复制。

服务器命令行导入示例：

```powershell
$env:GEMINI_IMPORT_SECURE_1PSID="复制到的 __Secure-1PSID"
$env:GEMINI_IMPORT_SECURE_1PSIDTS="复制到的 __Secure-1PSIDTS"
npm run gemini:import-auth
```

启动桥接服务：

```powershell
npm run gemini:bridge
```

bridge 启动后会默认设置 `GEMINI_COOKIE_PATH=.codex/gemini-webapi-cookies`，用于 `gemini-webapi` 持久化自动刷新后的 Cookie；该路径同样已被 `.gitignore` 排除。
如果 Gemini Web 生图经常返回等待超时，可把 `GEMINI_CLIENT_TIMEOUT_SECONDS` 提高到 `180` 或 `240` 后重启 bridge。

然后在应用首页的 OpenAI 兼容接口中配置：

- API Key：`local-only-secret`
- Base URL：`http://127.0.0.1:8317/v1`
- 图片模型：`gemini-web`
- 提示词模型：`gemini-web`

桥接服务支持：

- `GET /v1/models`
- `POST /v1/responses`
- `POST /v1/chat/completions`
- `POST /v1/images/generations`
- `POST /v1/images/edits`

文生图会直接请求 Gemini Web 生成图片；参考图、图生图和涂抹编辑会把上传图片转交给 Gemini Web，并把结果转成 OpenAI SDK 需要的 `b64_json` 返回。
提示词助手、分镜脚本、镜头提示词和图片反推提示词会通过文本端点转发到 Gemini Web；当请求携带 `input_image` 或 `image_url` data URL 时，桥接层会把图片落成本地临时文件并一并传给 Gemini Web。

## 本地存储

- SQLite 数据库：`prisma/dev.db`
- 上传和生成素材：`public/uploads`
- 手动导出：`local-exports/<projectName>`
- 生成图片归档：`generated-images/<username>`

生成图片文件名规则：

```text
<username>_<projectName>_<yyyyMMddHHmmss>.png
<username>_<projectName>_<yyyyMMddHHmmss>_02.png
```

`public/uploads`、`local-exports`、`generated-images` 和 `prisma/dev.db` 都被 `.gitignore` 排除，不会提交到仓库。

## 部署包

部署包必须通过固定脚本生成，不要手写 `tar` 参数：

```bash
npm run build
npm run deploy:package
```

脚本输出 `tmp/aiboard-runtime-deploy.tar.gz`，只包含运行所需的构建产物、依赖清单、Prisma schema、初始化脚本和 systemd service 文件。

部署包会自动排除并校验以下生产数据和本地生成物：

- `public/uploads`
- `dist/client/uploads`
- `prisma/*.db`
- `.env`
- `node_modules`
- `local-exports`
- `generated-images`

如果包内出现上述路径，`npm run deploy:package` 会失败并删除错误包。线上部署时保留服务器已有的 `.env`、`prisma/dev.db` 和 `public/uploads`，只覆盖运行代码与构建产物。

## Features

- 登录页：登录/注册与工作台视觉预览，移动端单列适配。
- 首页：项目工作区、创建画板、最近画板、账号操作、API 设置、用户审核、用户用量管理。
- 管理员：用户审核、API 授权、用量查看、生成历史、限制设置、停用/启用/删除用户。
- 画板：tldraw 编辑器、画板快照保存/恢复、工具栏配置、选择/复制/删除/组合/定位/适应画布。
- AI 生图：提示词、尺寸、数量、参考图角色标记、成功/失败反馈。
- AI 改图：源图、参考图、涂抹区域、笔触大小、颜色选择、缩放控制、撤回/重做/重置笔触。
- 素材：当前画板图片列表、弹窗预览、缩放查看、删除、设为源图、加入参考图。
- 导出：选区或整页导出 PNG / SVG，也可以把选区保存为 AI 参考图。
- 图片右键菜单：局部重绘、图生图、生成变体、删除背景。
- 本地归档：生成图片同时保存到用户专属 `generated-images` 子目录。

## Notes

- tldraw 生产环境可能显示 license watermark。正式部署前配置 `VITE_TLDRAW_LICENSE_KEY`。
- 当前不包含团队、多人协作、线上对象存储和跨画板素材库。
- Prisma 7 的 `migrate dev/db push` 在当前 Windows 环境可能返回空的 schema engine error；本项目保留 Prisma schema/client，并使用 `npm run db:init` 创建和补齐 SQLite 表。
