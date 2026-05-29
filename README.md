# Local AI Drawboard

[中文说明](README.zh-CN.md)

Local AI Drawboard is a local single-user AI image workspace. It runs on your own computer and stores boards, assets, settings, and generated files locally.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- Python 3.10 or newer only if you use the optional Gemini Web Bridge

## One-Click Start

On Windows, double-click this file in the project folder:

```text
start-local.bat
```

On macOS / Linux, run this from the project folder:

```bash
sh start-local.sh
```

It checks Node.js, installs dependencies, creates local config, initializes the database, builds the app, and starts the local service.

Open:

```text
http://localhost:3010
```

## First-Time Setup

Windows:

```powershell
git clone https://github.com/koiyoho/local_ai_drawboard.git
cd local_ai_drawboard
.\start-local.bat
```

macOS / Linux:

```bash
git clone https://github.com/koiyoho/local_ai_drawboard.git && cd local_ai_drawboard && sh start-local.sh
```

## Start

On Windows, double-click:

```text
start-local.bat
```

Or run:

```powershell
.\start-local.bat
```

On macOS / Linux, run this from the project folder:

```bash
sh start-local.sh
```

Local startup forces single-user mode and skips the login page.

## Stop

Press `Ctrl+C` in the terminal running the app.

## Next Time

On Windows, double-click `start-local.bat`, then open `http://localhost:3010`.

On macOS / Linux, run `sh start-local.sh`, then open `http://localhost:3010`.

## Update

Stop the app with `Ctrl+C`, then run:

Windows:

```powershell
git pull
.\start-local.bat --setup
```

macOS / Linux:

```bash
git pull
sh start-local.sh --setup
```

Then open `http://localhost:3010`.

## Configure AI

Open the app, go to **Local Settings**, and configure an OpenAI-compatible provider:

- API Key
- Base URL
- image model
- text model

The app is local single-user software. It has no login page, no user approval flow, and no usage quota management.

## Optional Gemini Web Bridge

Install the optional bridge dependencies:

```bash
python -m pip install -r scripts/requirements-gemini-bridge.txt
```

Start the bridge in another terminal:

```bash
npm run gemini:bridge
```

Then configure **Local Settings** with:

- API Key: the `GEMINI_BRIDGE_API_KEY` value in `.env`
- Base URL: `http://127.0.0.1:8317/v1`
- image model: `gemini-web`
- text model: `gemini-web`

Keep Gemini cookies and API keys on your own computer.
