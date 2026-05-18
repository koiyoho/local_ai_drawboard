# Local AI Drawboard 中文说明

Local AI Drawboard 是一个本地优先的 AI 图像画板。它把画布、AI 生图、局部改图、参考图角色、素材管理、提示词辅助、分镜规划、本地 SQLite 存储和 OpenAI 兼容接口配置放在同一个本地应用里。

本项目默认定位为本地单用户版本。它不需要登录页，不启用注册审核、用户用量、配额运营或多用户管理流程。

## 快速开始

准备环境：

- Node.js 22 或更新版本
- npm 10 或更新版本
- Python 3.10 或更新版本，仅在使用可选 Gemini Web Bridge 时需要

Windows PowerShell：

```powershell
git clone https://github.com/koiyoho/local_ai_drawboard.git; cd local_ai_drawboard; npm run setup:local; npm run start -- --port 3010
```

macOS / Linux：

```bash
git clone https://github.com/koiyoho/local_ai_drawboard.git && cd local_ai_drawboard && npm run setup:local && npm run start -- --port 3010
```

打开浏览器访问：

```text
http://localhost:3010
```

`npm run setup:local` 会自动完成本地配置：

- 如果不存在 `.env`，从 `.env.local_board.example` 创建本地配置
- 生成随机 `AUTH_SECRET`
- 安装依赖
- 生成 Prisma Client
- 初始化 SQLite 数据库
- 构建生产版本

## 本地单用户模式

默认 `.env` 使用：

```env
APP_VARIANT="local"
ADMIN_USERNAME="local"
AUTH_URL="http://localhost:3010"
DATABASE_URL="file:./prisma/local-board.db"
```

在本地模式下：

- 应用自动使用内置本地用户
- `/login` 会回到本地画板，不展示登录页
- 管理入口显示为“本地设置”
- 不展示用户审核、用户用量、用户配额或多用户运营面板
- 画板、素材、接口配置和生成记录保存在本机

## 启动与开发

安装依赖并初始化数据库：

```bash
npm ci
npm run db:init
```

启动开发服务器：

```bash
npm run dev
```

开发服务器默认地址：

```text
http://localhost:5173
```

构建生产版本：

```bash
npm run build
```

启动生产服务：

```bash
npm run start -- --port 3010
```

## 配置 AI 接口

打开应用后进入“本地设置”，配置 OpenAI 兼容接口：

- API Key
- Base URL，例如 `https://api.example.com/v1`
- 生图 / 改图模型
- 反推 / 提示词模型

接口配置保存在本地 SQLite 数据库中。保存后，API Key 不会再回传给浏览器。

支持的能力包括：

- 文生图
- 图片编辑
- 蒙版局部重绘
- 参考图角色控制
- 提示词辅助
- 图片反推提示词
- 分镜文本与提示词辅助

## 可选 Gemini Web Bridge

Gemini Web Bridge 是可选本地能力，用于复用本机浏览器里的 Gemini Web 会话，并提供 OpenAI 兼容的本地接口。

安装 Python 依赖：

```bash
python -m pip install -r scripts/requirements-gemini-bridge.txt
```

在 `.env` 中配置：

```env
GEMINI_BRIDGE_API_KEY="local-only-secret"
GEMINI_BRIDGE_HOST="127.0.0.1"
GEMINI_BRIDGE_PORT="8317"
GEMINI_CLIENT_TIMEOUT_SECONDS="120"
```

启动 Bridge：

```bash
npm run gemini:bridge
```

然后在“本地设置”中配置：

- API Key：`local-only-secret`
- Base URL：`http://127.0.0.1:8317/v1`
- 图片模型：`gemini-web`
- 文本模型：`gemini-web`

不要把 Gemini Cookie 或 Bridge 用在公开多用户服务中。Cookie 是个人会话凭据，应只保存在本机。

## 本地数据位置

默认本地数据路径：

- SQLite 数据库：`prisma/local-board.db`
- 上传素材：`public/uploads`
- 生成图片归档：`generated-images`
- 手动导出：`local-exports`
- 临时文件：`tmp`
- Codex 凭据：`.codex/codex-auth.json`

这些路径已被 `.gitignore` 排除，不应提交到公开仓库。

## 常用脚本

| 命令 | 作用 |
| --- | --- |
| `npm run setup:local` | 一键完成本地配置、依赖安装、数据库初始化和构建 |
| `npm run dev` | 启动 Vite 开发服务器 |
| `npm run build` | 生成 Prisma Client，构建前端和服务端 |
| `npm run start -- --port 3010` | 启动生产服务 |
| `npm run db:init` | 初始化或更新 SQLite 数据库结构 |
| `npm run lint` | 运行 ESLint |
| `npm run test` | 运行完整测试套件 |

## 公开仓库应包含的内容

应提交：

- `src/`
- `server/`
- `public/`，但不包含运行时上传文件
- `prisma/schema.prisma`
- `scripts/`
- `package.json`
- `package-lock.json`
- TypeScript、Vite、ESLint、Prisma 配置
- `.env.example`
- `.env.local_board.example`
- `README.md`
- `README.zh-CN.md`

不应提交：

- `.env`
- `node_modules/`
- `dist/`
- `prisma/*.db`
- `public/uploads/`
- `generated-images/`
- `local-exports/`
- `tmp/`
- `.codex/`
- 任何 API Key、Cookie、OAuth 凭据或个人数据

## 故障排查

如果 `npm run setup:local` 失败，先确认 Node.js 和 npm 版本：

```bash
node --version
npm --version
```

如果端口被占用，换一个端口启动：

```bash
npm run start -- --port 3020
```

如果 AI 生图不可用，进入“本地设置”检查 API Key、Base URL 和模型池配置。
