# Local AI Drawboard 中文说明

Local AI Drawboard 是一个本地单用户 AI 图像工作台。它在你的电脑上运行，画板、素材、接口配置和生成文件都保存在本机。

## 准备环境

- Git
- Node.js 22 或更新版本
- npm 10 或更新版本

## 从零开始

在哪个目录运行命令，就会把 `local_ai_drawboard` 安装到哪个目录下。

Windows PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -Command "iwr https://raw.githubusercontent.com/koiyoho/local_ai_drawboard/main/install-local-ai-drawboard.bat -OutFile install-local-ai-drawboard.bat; .\install-local-ai-drawboard.bat"
```

macOS / Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/koiyoho/local_ai_drawboard/main/install-local-ai-drawboard.sh | sh
```

安装器会自动下载项目、安装依赖、创建本地配置、初始化数据库、构建应用、安装内置 CLIProxyAPI sidecar，并启动本地服务。

打开浏览器访问：

```text
http://localhost:3010
```

## 结束

在运行应用的终端里按 `Ctrl+C`。

## 下次启动

Windows：

```powershell
cd local_ai_drawboard
.\start-local.bat
```

macOS / Linux：

```bash
cd local_ai_drawboard
sh start-local.sh
```

## 更新

先在运行应用的终端里按 `Ctrl+C` 停止应用，然后在父目录或现有 `local_ai_drawboard` 目录内再次运行“从零开始”里的同一条安装命令。

Windows PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -Command "iwr https://raw.githubusercontent.com/koiyoho/local_ai_drawboard/main/install-local-ai-drawboard.bat -OutFile install-local-ai-drawboard.bat; .\install-local-ai-drawboard.bat"
```

macOS / Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/koiyoho/local_ai_drawboard/main/install-local-ai-drawboard.sh | sh
```

它会更新已有安装，并重新启动本地服务。

### 可选：检查更新

如果希望在 **本地设置** 里检查最新 GitHub Release，可以在 `.env` 中设置：

```text
UPDATE_MANIFEST_URL="https://github.com/koiyoho/local_ai_drawboard/releases/latest/download/update-manifest.json"
```

修改 `.env` 后需要重新启动本地服务。Windows 和 macOS 本地安装检测到新版本后，请使用上面的安装命令重新执行更新。

## 配置 AI 接口

打开应用后进入 **本地设置**，配置 OpenAI 兼容接口：

- API Key
- Base URL
- 生图 / 改图模型
- 反推 / 提示词模型

本地启动会使用单用户模式，画板、素材、配置和生成文件都保存在你自己的电脑上。

### 内置 CLIProxyAPI

本地安装器会自动把 CLIProxyAPI 下载到 `.local/cliproxy`，写入仅本机监听的配置，生成 `CLIPROXY_API_KEY` / `MANAGEMENT_PASSWORD`，并在启动应用时一并启动 CLIProxyAPI。用户无需额外下载或手动配置 CLIProxyAPI。

默认本地地址：

```text
http://127.0.0.1:8327/v1
```

在 **本地设置 → CLIProxyAPI** 中可以查看状态、轮换本地 API Key，或发起各服务商 OAuth 登录。
