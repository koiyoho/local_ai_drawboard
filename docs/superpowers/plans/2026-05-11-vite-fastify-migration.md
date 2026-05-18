# Vite Fastify Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Next.js runtime with a lighter Vite + Fastify single-process service while preserving users, boards, assets, generation history, and existing UI behavior.

**Architecture:** Vite builds the React/tldraw client into static files. Fastify serves those files, implements `/api/*`, verifies signed cookie sessions, and reuses the current SQLite/Prisma and local asset storage. Existing React components are kept with targeted Next-specific import removal.

**Tech Stack:** Vite, React 19, Fastify, TypeScript, Prisma 7 + better-sqlite3, SQLite, bcryptjs, OpenAI SDK, tldraw.

---

## File Structure

- Create `index.html`: Vite HTML entry.
- Create `src/client/main.tsx`: browser entrypoint and minimal route switch.
- Create `src/client/api.ts`: typed fetch helpers for auth, boards, and bootstrap data.
- Create `src/client/pages/LoginApp.tsx`: renders `LoginPanel` with API-backed login/register.
- Create `src/client/pages/HomeApp.tsx`: fetches current user, boards, provider setting, admin data, then renders `BoardList`.
- Create `src/client/pages/BoardApp.tsx`: fetches board payload and renders `BoardWorkspace`.
- Create `src/client/pages/LoadingState.tsx`: shared loading/error UI.
- Create `server/index.ts`: Fastify bootstrap and listener.
- Create `server/app.ts`: app factory used by tests and production.
- Create `server/auth.ts`: signed cookie sessions and user guards.
- Create `server/http.ts`: shared JSON error/schema helpers.
- Create `server/routes/auth.ts`: login/register/logout/me.
- Create `server/routes/boards.ts`: board list/detail/create/update/delete/snapshot/duplicate.
- Create `server/routes/assets.ts`: upload/file/delete/reverse-prompt/remove-background.
- Create `server/routes/generation-jobs.ts`: framework-neutral port of current image generation route.
- Create `server/routes/provider-settings.ts`: provider settings CRUD.
- Create `server/routes/admin.ts`: admin user review/manage/delete and usage.
- Create `server/static.ts`: static file serving and SPA fallback.
- Create `scripts/smoke-fastify-server.mjs`: post-start smoke test for login page and API shape.
- Create `tsconfig.server.json`: server build config.
- Create `vite.config.ts`: Vite client build config with `@` alias.
- Modify `package.json`: add Fastify/Vite deps, remove Next runtime scripts, add build/start/smoke scripts.
- Modify `tsconfig.json`: make it Vite/client compatible.
- Modify `src/components/BoardList.tsx`: remove `next/link` and `useRouter`.
- Modify `src/components/BoardWorkspace.tsx`: remove `next/link`.
- Modify `src/components/LoginPanel.tsx`: replace server-action form props with client submit callbacks.
- Modify `src/components/AccountActions.tsx`: replace server action logout with API call.
- Keep `src/app/**` temporarily if useful for reference, but production build must not depend on it.

## Task 1: Tooling Skeleton

**Files:**
- Create: `index.html`
- Create: `vite.config.ts`
- Create: `tsconfig.server.json`
- Modify: `package.json`
- Modify: `tsconfig.json`
- Test: `scripts/verify-no-google-fonts.mjs`

- [ ] **Step 1: Update dependencies and scripts in `package.json`**

Add runtime dependencies:

```json
"@fastify/cookie": "^11.0.2",
"@fastify/multipart": "^9.3.0",
"@fastify/static": "^8.3.0",
"fastify": "^5.6.2",
"vite": "^7.1.12"
```

Add dev dependencies:

```json
"@vitejs/plugin-react": "^5.1.0",
"tsx": "^4.20.6"
```

Change scripts to:

```json
"dev": "vite --host 0.0.0.0 --port 5173",
"server:dev": "tsx server/index.ts",
"build": "vite build && tsc -p tsconfig.server.json",
"start": "node dist/server/index.js",
"smoke:fastify": "node scripts/smoke-fastify-server.mjs"
```

Expected: `next`, `next-auth`, and old Next scripts are no longer required for production runtime.

- [ ] **Step 2: Create `index.html`**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Board</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/client/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Create `vite.config.ts`**

```ts
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
```

- [ ] **Step 4: Create `tsconfig.server.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "allowJs": false,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "noEmit": false,
    "outDir": "dist/server",
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["server/**/*.ts", "src/lib/**/*.ts", "src/generated/**/*.ts"],
  "exclude": ["node_modules", "src/app", "src/client", "src/components"]
}
```

- [ ] **Step 5: Run install and baseline checks**

Run:

```bash
npm install
node scripts/verify-no-google-fonts.mjs
```

Expected: install succeeds; font check prints `No next/font/google dependency found`.

## Task 2: Fastify Auth Core

**Files:**
- Create: `server/http.ts`
- Create: `server/auth.ts`
- Create: `server/routes/auth.ts`
- Create: `server/app.ts`
- Test: `server/auth.test.ts` if a test runner is added, otherwise use `node --test` compatible tests in `server/auth.test.mjs`

- [ ] **Step 1: Write auth session tests**

Create `server/auth-session.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createHmac, timingSafeEqual } from "node:crypto";

function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verify(token, secret) {
  const [body, signature] = token.split(".");
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
}

test("signed session round-trips user id", () => {
  const token = sign({ userId: "user-1", expiresAt: Date.now() + 1000 }, "secret");
  assert.equal(verify(token, "secret").userId, "user-1");
});

test("tampered session is rejected", () => {
  const token = sign({ userId: "user-1", expiresAt: Date.now() + 1000 }, "secret");
  assert.equal(verify(token.replace("user", "xxxx"), "secret"), null);
});
```

- [ ] **Step 2: Run tests to verify RED-style baseline**

Run:

```bash
node --test server/auth-session.test.mjs
```

Expected: tests pass as a contract sketch. Then implement production functions with the same behavior.

- [ ] **Step 3: Create `server/http.ts`**

```ts
import type { FastifyReply } from "fastify";
import { z } from "zod";

export function jsonError(reply: FastifyReply, message: string, status = 400) {
  return reply.status(status).send({ error: message });
}

export function parseBody<T>(schema: z.Schema<T>, value: unknown) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }
  return { ok: true as const, data: parsed.data };
}
```

- [ ] **Step 4: Create `server/auth.ts`**

Implement signed cookie sessions, `getCurrentUser`, `requireCurrentUser`, and `requireAdminUser` using `AUTH_SECRET`, `bcryptjs`, and `prisma.user`.

- [ ] **Step 5: Create `server/routes/auth.ts`**

Implement:

```text
POST /api/auth/login
POST /api/auth/register
POST /api/auth/logout
GET  /api/auth/me
```

Keep current pending-user registration behavior and approval rules.

## Task 3: Fastify App Shell And Static Serving

**Files:**
- Create: `server/app.ts`
- Create: `server/index.ts`
- Create: `server/static.ts`
- Create: `scripts/smoke-fastify-server.mjs`

- [ ] **Step 1: Create app factory**

`server/app.ts` should create Fastify, register cookie/multipart, register all route modules, and call static setup.

- [ ] **Step 2: Create server entry**

`server/index.ts` should listen on `process.env.PORT ?? 3333`, host `0.0.0.0`, and log the URL.

- [ ] **Step 3: Create static fallback**

`server/static.ts` should serve `dist/client` if it exists and return `index.html` for non-API routes.

- [ ] **Step 4: Create smoke script**

`scripts/smoke-fastify-server.mjs` should request `/login`, `/api/auth/me`, and `/api/boards`, accepting unauthenticated 401 for protected APIs.

## Task 4: Board And Admin APIs

**Files:**
- Create: `server/routes/boards.ts`
- Create: `server/routes/admin.ts`
- Reuse: `src/lib/admin-usage.ts`
- Reuse: `src/lib/storage.ts`
- Reuse: `src/lib/local-export.ts`

- [ ] **Step 1: Port board list/create/detail/update/delete**

Use current logic from `src/app/api/boards/route.ts` and `src/app/api/boards/[boardId]/route.ts`.

- [ ] **Step 2: Port snapshot route**

Use current logic from `src/app/api/boards/[boardId]/snapshot/route.ts`.

- [ ] **Step 3: Port duplicate route**

Use current duplicate behavior and preserve copied assets/snapshot relationships.

- [ ] **Step 4: Port admin users and usage**

Use current logic from `src/app/api/admin/users/route.ts` and `src/app/api/admin/usage/route.ts`.

## Task 5: Assets, Provider Settings, And Generation APIs

**Files:**
- Create: `server/routes/assets.ts`
- Create: `server/routes/provider-settings.ts`
- Create: `server/routes/generation-jobs.ts`
- Reuse: `src/lib/storage.ts`
- Reuse: `src/lib/openai.ts`
- Reuse: `src/lib/image.ts`
- Reuse: `src/lib/background-removal.ts`
- Reuse: `src/lib/ai-background-removal.ts`

- [ ] **Step 1: Port provider settings CRUD**

Use current logic from `src/app/api/provider-settings/route.ts`, preserving API key redaction.

- [ ] **Step 2: Port asset upload and file serving**

Use Fastify multipart for `POST /api/assets`, Node streams or `reply.sendFile` for `GET /api/assets/:assetId/file`.

- [ ] **Step 3: Port asset delete, reverse prompt, and remove background**

Preserve current response shapes.

- [ ] **Step 4: Port generation jobs**

Move current `src/app/api/generation-jobs/route.ts` logic to Fastify, keeping quota checks and result persistence.

## Task 6: Vite Client Entry And Page Data Loading

**Files:**
- Create: `src/client/main.tsx`
- Create: `src/client/api.ts`
- Create: `src/client/pages/LoadingState.tsx`
- Create: `src/client/pages/LoginApp.tsx`
- Create: `src/client/pages/HomeApp.tsx`
- Create: `src/client/pages/BoardApp.tsx`
- Modify: `src/components/LoginPanel.tsx`
- Modify: `src/components/BoardList.tsx`
- Modify: `src/components/BoardWorkspace.tsx`
- Modify: `src/components/AccountActions.tsx`

- [ ] **Step 1: Create minimal browser router**

Route by `window.location.pathname`:

```text
/login -> LoginApp
/boards/:boardId -> BoardApp
/mobile-preview/:boardId -> BoardApp
/ -> HomeApp
```

- [ ] **Step 2: Add fetch helpers**

`src/client/api.ts` should include `apiJson`, `getMe`, `getBoards`, `getBoard`, `login`, `register`, and `logout`.

- [ ] **Step 3: Convert login panel to client callbacks**

Remove server action imports and use `fetch('/api/auth/login')`, `fetch('/api/auth/register')`.

- [ ] **Step 4: Convert board list navigation**

Replace `router.push` with `window.location.href = ...`; replace `Link` with `<a>`.

- [ ] **Step 5: Convert board workspace back link**

Replace `next/link` with `<a>`.

- [ ] **Step 6: Convert account actions logout**

Call `POST /api/auth/logout`, then set `window.location.href = '/login'`.

## Task 7: Build, Local Verification, And Remote Deployment

**Files:**
- Modify: remote `/srv/tldraw-ai-board`
- Create: `/etc/systemd/system/tldraw-ai-board.service` on new server

- [ ] **Step 1: Local build**

Run:

```bash
npm run build
```

Expected: Vite and server TypeScript build complete.

- [ ] **Step 2: Local smoke**

Run server locally on a non-conflicting port and run:

```bash
SMOKE_BASE_URL=http://127.0.0.1:3333 npm run smoke:fastify
```

Expected: login page returns 200 and protected APIs return expected auth status.

- [ ] **Step 3: Sync to new server**

Use rsync excluding `node_modules`, `.next`, and local-only archives.

- [ ] **Step 4: Remote install/build**

Run on new server:

```bash
cd /srv/tldraw-ai-board
npm ci
npm run build
```

Expected: build completes on 1GB server with swap.

- [ ] **Step 5: Create systemd service**

Use:

```ini
[Unit]
Description=AI Board Fastify Service
After=network.target

[Service]
Type=simple
WorkingDirectory=/srv/tldraw-ai-board
Environment=NODE_ENV=production
Environment=PORT=3333
EnvironmentFile=/srv/tldraw-ai-board/.env
ExecStart=/usr/bin/node dist/server/server/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 6: Start and verify remote service**

Run:

```bash
cp /srv/tldraw-ai-board/docs/tldraw-ai-board.service /etc/systemd/system/tldraw-ai-board.service
systemctl daemon-reload
systemctl enable --now tldraw-ai-board
systemctl status tldraw-ai-board --no-pager
ss -ltnp 'sport = :3333'
curl -I http://aiboard.aipowers.site:3333/login
```

Expected: `/login` returns 200; root redirects or serves app; no Next.js process runs.

## Self-Review

- Spec coverage: plan covers Vite client, Fastify server, auth replacement, data compatibility, deployment, smoke tests, and systemd.
- Placeholder scan: no TBD/TODO placeholders; some steps intentionally reference current route files as source logic to keep the plan concise for direct porting.
- Type consistency: route names and file paths match the approved spec.
