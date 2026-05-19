# Local AI Drawboard

[中文说明](README.zh-CN.md)

Local AI Drawboard is a local single-user AI image workspace. It runs on your own computer and stores boards, assets, settings, and generated files locally.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- Python 3.10 or newer only if you use the optional Gemini Web Bridge

## First-Time Setup

Windows PowerShell:

```powershell
git clone https://github.com/koiyoho/local_ai_drawboard.git; cd local_ai_drawboard; npm run setup:local
```

macOS / Linux:

```bash
git clone https://github.com/koiyoho/local_ai_drawboard.git && cd local_ai_drawboard && npm run setup:local
```

The setup command creates local config, installs dependencies, initializes the SQLite database, and builds the app.

## Start

Run this from the project folder:

```bash
npm run start:local
```

Use `start:local` for local use. It forces single-user local mode and skips the login page.

Open:

```text
http://localhost:3010
```

## Stop

Press `Ctrl+C` in the terminal running the app.

## Next Time

Open a terminal in the project folder and run:

```bash
npm run start:local
```

Then open:

```text
http://localhost:3010
```

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
