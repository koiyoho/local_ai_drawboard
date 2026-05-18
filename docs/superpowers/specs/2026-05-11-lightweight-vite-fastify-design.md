# Lightweight Vite + Fastify Migration Design

## Goal

Replace the current Next.js runtime with a lighter single-process Vite + Fastify architecture while preserving the existing AI board experience, users, boards, assets, generation history, and SQLite database.

The first successful version only needs to run the existing service reliably on the 1GB RAM server. It should not redesign the UI, change the database model, or add new product features.

## Current Constraints

- The current Next.js 16 dev server is too heavy for the target server.
- The target server has about 1GB RAM, plus a 2GB swap file added during migration.
- Existing durable data lives in `prisma/dev.db` and `public/uploads/`.
- The existing React/tldraw client is valuable and should be reused.
- Users and passwords are already stored in SQLite via `User.passwordHash`.
- Existing AI provider settings, generation jobs, assets, and board snapshots must remain compatible.

## Recommended Architecture

Use one Node.js process with two responsibilities:

- Serve the Vite-built React app from `dist/client`.
- Serve JSON/file APIs through Fastify from the same origin.

Runtime flow:

```text
Browser
  -> Fastify static files: /, /login, /boards/:boardId
  -> Fastify API routes: /api/*
  -> SQLite via existing Prisma client
  -> Local files under public/uploads
  -> OpenAI-compatible image API for generation/editing
```

This keeps deployment simple: one port, one service, one database, one uploads directory.

## Frontend Design

Use Vite + React for the client app.

Keep these components with targeted edits:

- `src/components/BoardWorkspace.tsx`
- `src/components/BoardList.tsx`
- `src/components/LoginPanel.tsx`
- `src/components/ProviderSettingsForm.tsx`
- `src/components/AdminUserReview.tsx`
- `src/components/AdminUsagePanel.tsx`
- `src/components/AccountActions.tsx`

Remove Next-specific frontend imports:

- Replace `next/link` with normal anchors or a small local `AppLink` component.
- Replace Next page-based navigation with browser navigation and client-side data loading.
- Remove `next/font/google` permanently; keep local CSS font variables.

Client routes:

- `/login` renders login/register UI.
- `/` loads the current user and board list from `/api/auth/me` and `/api/boards`.
- `/boards/:boardId` loads board payload from `/api/boards/:boardId`.
- `/mobile-preview/:boardId` can be preserved if it is still used; otherwise it can route to the same board view in the first migration.

Use a minimal client router. Prefer `react-router-dom` only if route parsing becomes awkward; otherwise use `window.location.pathname` to keep dependencies low.

## Backend Design

Create a Fastify server under `server/`.

Suggested files:

- `server/index.ts`: creates Fastify app, registers plugins/routes, starts listener.
- `server/auth.ts`: cookie session signing, login/register/logout, current user lookup.
- `server/routes/auth.ts`: `/api/auth/*` routes.
- `server/routes/boards.ts`: board CRUD, snapshots, duplication.
- `server/routes/assets.ts`: upload, file serving, delete, reverse prompt, background removal.
- `server/routes/generation-jobs.ts`: AI generation/edit job creation.
- `server/routes/provider-settings.ts`: provider settings read/write.
- `server/routes/admin.ts`: admin users and usage.
- `server/static.ts`: static file serving and SPA fallback.

Reuse existing libraries where possible:

- `src/lib/prisma.ts`
- `src/lib/storage.ts`
- `src/lib/openai.ts`
- `src/lib/image.ts`
- `src/lib/local-export.ts`
- `src/lib/background-removal.ts`
- `src/lib/ai-background-removal.ts`
- `src/lib/admin-usage.ts`
- `src/lib/reference-roles.ts`

Move or adapt code that currently depends on Next request/response types into framework-neutral helpers.

## API Contract

Auth:

```text
POST /api/auth/login
POST /api/auth/register
POST /api/auth/logout
GET  /api/auth/me
```

Boards:

```text
GET    /api/boards
POST   /api/boards
GET    /api/boards/:boardId
PATCH  /api/boards/:boardId
DELETE /api/boards/:boardId
POST   /api/boards/:boardId/snapshot
POST   /api/boards/:boardId/duplicate
```

Assets:

```text
POST   /api/assets
GET    /api/assets/:assetId/file
DELETE /api/assets/:assetId
POST   /api/assets/:assetId/reverse-prompt
POST   /api/assets/:assetId/remove-background
```

AI jobs and settings:

```text
POST /api/generation-jobs
GET  /api/provider-settings
POST /api/provider-settings
GET  /api/admin/users
POST /api/admin/users
GET  /api/admin/usage
```

The API responses should preserve the current payload shapes consumed by existing React components whenever practical. This reduces frontend churn.

## Authentication Design

Remove `next-auth` from the runtime path.

Implement a signed HTTP-only cookie session:

- Cookie name: `ai_board_session`
- Cookie value: signed token containing `userId`, `issuedAt`, and `expiresAt`
- Signing secret: reuse `AUTH_SECRET`
- Default session duration: 30 days
- Cookie flags: `httpOnly`, `sameSite: "lax"`, `path: "/"`
- `secure` should be false for current plain HTTP deployment and true if HTTPS is later enabled.

Login flow:

- `POST /api/auth/login` accepts `{ username, password }`.
- Find `User` by username.
- Verify `passwordHash` with `bcryptjs.compare`.
- Reject non-admin users unless `status === "approved"`.
- Set signed cookie and return current user payload.

Register flow:

- `POST /api/auth/register` accepts `{ username, password }`.
- Preserve current behavior: new users are `pending`, `role: "user"`, and require admin approval.

Logout flow:

- `POST /api/auth/logout` clears the session cookie.

Authorization:

- `requireCurrentUser` becomes a Fastify helper that reads the cookie and loads the user from SQLite.
- `requireAdminUser` keeps the current rule: `username === "koiyoho" && role === "admin"`.

Existing users may need to log in again after the framework switch because Auth.js JWT cookies will be replaced by the new cookie. Account data and passwords remain unchanged.

## Data Compatibility

Do not change the Prisma schema in the first migration.

Keep using:

- `Board.snapshotJson`
- `BoardSnapshot`
- `Asset.storageKey`
- `Asset.publicUrl`
- `GenerationJob`
- `GenerationResult`
- `ProviderSetting`
- `User.passwordHash`, `role`, `status`, limits, and approval fields

Keep asset file paths compatible:

```text
public/uploads/<boardId>/<kind>/<filename>
```

Keep public asset URLs compatible where possible:

```text
/api/assets/:assetId/file
```

## Deployment Design

Use scripts like:

```json
{
  "dev": "vite --host 0.0.0.0 --port 5173",
  "server:dev": "tsx server/index.ts",
  "build": "vite build && tsc -p tsconfig.server.json",
  "start": "node dist/server/index.js"
}
```

The exact scripts can be adjusted during implementation, but the production command should be a plain Node server, not a framework dev server.

New server environment:

```text
DATABASE_URL="file:./prisma/dev.db"
AUTH_SECRET="existing secret"
AUTH_URL="http://aiboard.aipowers.site:3333"
NEXT_PUBLIC_TLDRAW_LICENSE_KEY="existing license key"
PORT=3333
```

The `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` name can remain initially to avoid frontend churn. A later cleanup can rename it to `VITE_TLDRAW_LICENSE_KEY`.

## Rollout Plan

The first rollout can happen on the already-migrated new server.

High-level sequence:

1. Keep current Next service stopped.
2. Implement Vite + Fastify locally.
3. Verify against the existing local SQLite and uploads data.
4. Sync code to `/srv/tldraw-ai-board`.
5. Run `npm ci`, `npm run build`, and `npm run start` on the new server.
6. Verify `http://aiboard.aipowers.site:3333/login` and login with an existing user.
7. Verify board list, board canvas, existing assets, AI generation, AI edit, and provider settings.
8. Add a `systemd` unit so the service survives reboot.

## Testing Requirements

Automated checks should cover:

- Session signing and verification.
- Login rejects invalid credentials.
- Login rejects unapproved non-admin users.
- Register creates pending users.
- Authenticated board list returns only the current user's boards.
- Asset file route returns existing local files.
- Provider settings redact API keys in read responses.
- Admin routes reject non-admin users.

Manual smoke test should cover:

- Login with an existing approved user.
- Open the board list.
- Open an existing board.
- Load several existing generated/uploaded assets.
- Upload a new image.
- Save a board snapshot.
- Run one AI generation or provider-backed edit if API quota allows.

## Out of Scope For First Migration

- UI redesign.
- Database schema redesign.
- Moving SQLite to Postgres.
- Moving uploads to S3/R2/MinIO.
- Full HTTPS setup.
- Multi-instance deployment.
- Perfect backward compatibility with existing Auth.js session cookies.

## Risks And Mitigations

Risk: Auth behavior changes.

Mitigation: keep username/password verification and approval rules identical; accept one-time re-login.

Risk: Payload shape drift breaks existing React components.

Mitigation: copy current API response shapes and add smoke tests for board list and board payload loading.

Risk: AI routes depend on Next-specific request objects.

Mitigation: isolate route handlers from framework response types and reuse framework-neutral helpers.

Risk: Server is still memory constrained.

Mitigation: production uses Vite static files plus Fastify, avoiding Next dev/build at runtime; keep 2GB swap as safety.

Risk: Some historical asset records point to missing files.

Mitigation: this exists in the source data already; do not block migration, but report missing file count during smoke checks.

## Success Criteria

- `npm run build` completes on the new server.
- `npm run start` serves `http://aiboard.aipowers.site:3333` without Next.js.
- Existing users can log in with their current usernames and passwords.
- Board list count and board IDs match the migrated database.
- Existing board pages load.
- Existing non-missing assets load through `/api/assets/:assetId/file`.
- AI generation/edit endpoints work with existing provider settings.
- Server runs under `systemd` and restarts after process failure.
