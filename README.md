# Local AI Drawboard

[中文说明](README.zh-CN.md)

Local AI Drawboard is a local-first image board for AI image workflows. It combines a canvas workspace, image generation, image editing, reference-image roles, asset management, prompt helpers, storyboard planning, local SQLite storage, and OpenAI-compatible provider settings.

The project is designed to run on Windows, macOS, and Linux with the same Node.js workflow.

## Quick Start

Prerequisites:

- Node.js 22 or newer
- npm 10 or newer
- Python 3.10 or newer only if you want to use the optional Gemini Web bridge

Clone the repository, then run one setup command:

```bash
npm run setup:local
```

Start the app:

```bash
npm run start -- --port 3010
```

Open:

```text
http://localhost:3010
```

`setup:local` creates a local `.env` when one does not exist, installs dependencies with `npm ci`, generates Prisma Client, initializes the SQLite database, and builds the production app.

## Development

```bash
npm ci
npm run db:init
npm run dev
```

The development server listens on `http://localhost:5173` by default. The Fastify API and static production server are built with:

```bash
npm run build
```

Run the production server after building:

```bash
npm run start -- --port 3010
```

## Environment

Copy one of the example files if you want to configure the app manually:

```bash
cp .env.local_board.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.local_board.example .env
```

Important variables:

```env
DATABASE_URL="file:./prisma/local-board.db"
APP_VARIANT="local"
AUTH_SECRET="replace-with-a-long-random-string"
AUTH_URL="http://localhost:3010"
ADMIN_USERNAME="local"
VITE_TLDRAW_LICENSE_KEY=""
VITE_API_BASE_URL=""
```

`APP_VARIANT="local"` disables password login and uses a built-in local admin user. For a multi-user deployment, use `APP_VARIANT="main"`, set `ADMIN_USERNAME`, set a strong `AUTH_SECRET`, and create or approve users through the app's admin flow.

Never commit `.env`, databases, generated images, uploads, local exports, or authentication files. The repository `.gitignore` excludes these by default.

## AI Providers

Users can configure an OpenAI-compatible image provider in the app UI:

- API Key
- Base URL, for example `https://api.example.com/v1`
- image model
- text model for prompt helpers and storyboard helpers

The server stores provider settings in the local SQLite database. API keys are not returned to the browser after saving.

Supported generation paths:

- text to image
- image editing
- inpainting with masks
- reference images with roles
- prompt assistance and image reverse-prompting through compatible text endpoints

## Optional Gemini Web Bridge

The Gemini Web bridge is optional and intended for personal local use only. It reuses a browser Gemini Web session and exposes an OpenAI-compatible local endpoint.

Install Python dependencies:

```bash
python -m pip install -r scripts/requirements-gemini-bridge.txt
```

Set bridge variables in `.env`:

```env
GEMINI_BRIDGE_API_KEY="local-only-secret"
GEMINI_BRIDGE_HOST="127.0.0.1"
GEMINI_BRIDGE_PORT="8317"
GEMINI_CLIENT_TIMEOUT_SECONDS="120"
```

Start the bridge:

```bash
npm run gemini:bridge
```

Then configure the app provider:

- API Key: `local-only-secret`
- Base URL: `http://127.0.0.1:8317/v1`
- image model: `gemini-web`
- text model: `gemini-web`

Do not use this bridge for public multi-user hosting. Gemini cookies are account session credentials and must stay local.

## Local Data

Default local paths:

- SQLite database: `prisma/local-board.db` or `prisma/dev.db`, depending on `.env`
- uploads: `public/uploads`
- generated image archive: `generated-images`
- manual exports: `local-exports`
- temporary files: `tmp`

All of these are ignored by Git.

## Scripts

- `npm run setup:local`: one-command local setup
- `npm run dev`: Vite development server
- `npm run build`: Prisma generate, Vite build, server TypeScript build
- `npm run start -- --port 3010`: production server
- `npm run db:init`: initialize or update the SQLite schema
- `npm run test`: build plus project test suite
- `npm run lint`: ESLint

## Public Repository Contents

The public repository should include source and reproducible build inputs:

- `src/`
- `server/`
- `public/`, excluding runtime uploads
- `prisma/schema.prisma`
- `scripts/`
- `package.json`
- `package-lock.json`
- TypeScript, Vite, ESLint, and Prisma config files
- `.env.example`
- `.env.local_board.example`
- `README.md`

It should not include generated dependencies, local databases, build output, private credentials, internal planning notes, or runtime user data.
