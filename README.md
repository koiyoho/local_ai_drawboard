# Local AI Drawboard

[中文说明](README.zh-CN.md)

Local AI Drawboard is a local single-user AI image workspace. It runs on your own computer and stores boards, assets, settings, and generated files locally.

## Requirements

- Git
- Node.js 22 or newer
- npm 10 or newer

## Start From Zero

Run the command in the folder where you want `local_ai_drawboard` to be created.

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -Command "iwr https://raw.githubusercontent.com/koiyoho/local_ai_drawboard/main/install-local-ai-drawboard.bat -OutFile install-local-ai-drawboard.bat; .\install-local-ai-drawboard.bat"
```

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/koiyoho/local_ai_drawboard/main/install-local-ai-drawboard.sh | sh
```

The installer downloads this project, installs dependencies, creates local config, initializes the database, builds the app, installs the bundled CLIProxyAPI sidecar, and starts the local service.

Open:

```text
http://localhost:3010
```

## Stop

Press `Ctrl+C` in the terminal running the app.

## Start Next Time

Windows:

```powershell
cd local_ai_drawboard
.\start-local.bat
```

macOS / Linux:

```bash
cd local_ai_drawboard
sh start-local.sh
```

## Update

Stop the app with `Ctrl+C`, then run the same installer command again from the parent folder or from inside the existing `local_ai_drawboard` folder.

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -Command "iwr https://raw.githubusercontent.com/koiyoho/local_ai_drawboard/main/install-local-ai-drawboard.bat -OutFile install-local-ai-drawboard.bat; .\install-local-ai-drawboard.bat"
```

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/koiyoho/local_ai_drawboard/main/install-local-ai-drawboard.sh | sh
```

It will update the existing installation and restart the local service.

### Optional Update Checks

To let the app check the latest GitHub release from **Local Settings**, set this line in `.env`:

```text
UPDATE_MANIFEST_URL="https://github.com/koiyoho/local_ai_drawboard/releases/latest/download/update-manifest.json"
```

Restart the local service after changing `.env`. On Windows and macOS local installs, use the installer command above to apply updates after the app reports a new version.

## Configure AI

Open the app, go to **Local Settings**, and configure an OpenAI-compatible provider:

- API Key
- Base URL
- image model
- text model

Local startup uses single-user mode and keeps boards, assets, settings, and generated files on your own computer.

### Built-In CLIProxyAPI

The local installer downloads CLIProxyAPI automatically into `.local/cliproxy`, writes a local-only config, generates `CLIPROXY_API_KEY` / `MANAGEMENT_PASSWORD`, and starts CLIProxyAPI together with the app. Users do not need to download CLIProxyAPI separately.

Default local endpoint:

```text
http://127.0.0.1:8327/v1
```

Use **Local Settings → CLIProxyAPI** to check status, rotate the local API key, or start provider OAuth login.

### Network Notes For First Start

First start downloads CLIProxyAPI from GitHub as part of the automatic local setup. If your network cannot reach GitHub release assets directly, the setup may pause or fail during this download. You still do not need to install CLIProxyAPI manually.

In that case, configure a temporary proxy in the same terminal, then rerun the installer or `start-local` command:

```powershell
$env:CLIPROXY_DOWNLOAD_PROXY = "socks5h://your-proxy-host:port"
.\start-local.bat
```

On macOS / Linux:

```bash
export CLIPROXY_DOWNLOAD_PROXY="socks5h://your-proxy-host:port"
sh start-local.sh
```

The proxy only affects the CLIProxyAPI download step. `CLIPROXY_DOWNLOAD_PROXY` accepts `http://`, `https://`, `socks5://`, or `socks5h://` proxy URLs.
