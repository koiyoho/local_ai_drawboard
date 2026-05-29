# Local AI Drawboard 中文说明

Local AI Drawboard 是一个本地单用户 AI 图像工作台。它在你的电脑上运行，画板、素材、接口配置和生成文件都保存在本机。

## 准备环境

- Node.js 22 或更新版本
- npm 10 或更新版本
- Python 3.10 或更新版本，仅在使用可选 Gemini Web Bridge 时需要

## 一键启动

Windows 拉取项目后，双击根目录里的：

```text
start-local.bat
```

macOS / Linux 拉取项目后，在项目目录运行：

```bash
sh start-local.sh
```

它会自动检查 Node.js、安装依赖、创建本地配置、初始化数据库、构建应用，并启动本地服务。

打开浏览器访问：

```text
http://localhost:3010
```

## 第一次安装

Windows：

```powershell
git clone https://github.com/koiyoho/local_ai_drawboard.git
cd local_ai_drawboard
.\start-local.bat
```

macOS / Linux：

```bash
git clone https://github.com/koiyoho/local_ai_drawboard.git && cd local_ai_drawboard && sh start-local.sh
```

## 启动

Windows 下次使用直接双击：

```text
start-local.bat
```

或者在终端运行：

```powershell
.\start-local.bat
```

macOS / Linux 进入项目目录后运行：

```bash
sh start-local.sh
```

本地使用会强制启用单用户模式，并跳过登录页。

## 结束

在运行应用的终端里按 `Ctrl+C`。

## 下次使用

Windows 双击 `start-local.bat`，然后访问 `http://localhost:3010`。

macOS / Linux 运行 `sh start-local.sh`，然后访问 `http://localhost:3010`。

## 更新

先在运行应用的终端里按 `Ctrl+C` 停止应用，然后运行：

Windows：

```powershell
git pull
.\start-local.bat --setup
```

macOS / Linux：

```bash
git pull
sh start-local.sh --setup
```

更新后继续访问 `http://localhost:3010`。

## 配置 AI 接口

打开应用后进入 **本地设置**，配置 OpenAI 兼容接口：

- API Key
- Base URL
- 生图 / 改图模型
- 反推 / 提示词模型

这是本地单用户软件，不需要登录页，也没有用户审核、用量配额或多用户管理流程。

## 可选 Gemini Web Bridge

安装可选依赖：

```bash
python -m pip install -r scripts/requirements-gemini-bridge.txt
```

另开一个终端启动 Bridge：

```bash
npm run gemini:bridge
```

然后在 **本地设置** 中配置：

- API Key：`.env` 里的 `GEMINI_BRIDGE_API_KEY`
- Base URL：`http://127.0.0.1:8317/v1`
- 图片模型：`gemini-web`
- 文本模型：`gemini-web`

Gemini Cookie 和 API Key 都应只保存在你自己的电脑上。
