# AI Board Server Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the AI board service to a new server with users, login continuity, boards, assets, snapshots, generation history, and provider settings preserved.

**Architecture:** This app currently stores durable state in local SQLite (`prisma/dev.db`) and local asset files under `public/uploads`. Auth.js uses JWT sessions, so seamless login requires keeping `AUTH_SECRET` unchanged and serving through the same public origin (`AUTH_URL`) or switching DNS only after the new host is ready.

**Tech Stack:** Next.js 16, React 19, Prisma 7 with `@prisma/adapter-better-sqlite3`, SQLite, Auth.js JWT credentials auth, local filesystem asset storage.

---

## Data Map

Durable data that must move:

- SQLite database: `prisma/dev.db`
- Uploads/assets: `public/uploads/`
- Environment secrets: `.env`, especially `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, and `NEXT_PUBLIC_TLDRAW_LICENSE_KEY`
- Code version: current git commit and local uncommitted changes if they are part of the running service

Database tables that carry user-facing history:

- `User`: users, roles, approval status, generation limits
- `ProviderSetting`: user/provider API key settings
- `Board`: board list and latest canvas snapshot
- `BoardSnapshot`: snapshot history
- `Asset`: metadata linking assets to files in `public/uploads`
- `GenerationJob` and `GenerationResult`: AI generation/edit history
- `Account`, `Session`, `VerificationToken`: Auth.js tables, mostly unused with current JWT strategy but still safe to migrate

Files not required for continuity:

- `node_modules/`
- `.next/`
- transient logs under `/tmp/`
- development backups unless explicitly needed

## Migration Strategy

Use a two-phase copy with a short final freeze:

1. Prepare and verify the new server while the old service keeps running.
2. Do an initial `rsync` of code/data/uploads to reduce final copy time.
3. Put the old service in maintenance or stop it briefly.
4. Copy `prisma/dev.db` and `public/uploads/` one final time while no writes are happening.
5. Start the new server with the same `AUTH_SECRET` and final public `AUTH_URL`.
6. Switch DNS/reverse proxy/port mapping to the new server.
7. Keep old server read-only or stopped until rollback window passes.

## Task 1: Inventory Current Production State

**Files:**
- Read: `.env`
- Read: `package.json`
- Read: `prisma/schema.prisma`
- Read: `src/lib/storage.ts`

- [ ] **Step 1: Record current commit and worktree status**

Run on old server:

```bash
git rev-parse HEAD
git status --short --branch
```

Expected: save the commit hash. If `git status` shows local modifications that are part of production behavior, either commit them or include the whole working tree in the migration package.

- [ ] **Step 2: Confirm database path**

Run on old server:

```bash
node -e "require('dotenv/config'); console.log(process.env.DATABASE_URL || 'file:./prisma/dev.db')"
```

Expected: `file:./prisma/dev.db` unless the current `.env` overrides it.

- [ ] **Step 3: Confirm uploads path and size**

Run on old server:

```bash
du -sh public/uploads prisma/dev.db 2>/dev/null || true
```

Expected: output includes `prisma/dev.db`. If `public/uploads` does not exist, confirm there are no uploaded/generated assets before proceeding.

- [ ] **Step 4: Export row counts for later comparison**

Run on old server:

```bash
sqlite3 prisma/dev.db "
SELECT 'User', COUNT(*) FROM User UNION ALL
SELECT 'Board', COUNT(*) FROM Board UNION ALL
SELECT 'BoardSnapshot', COUNT(*) FROM BoardSnapshot UNION ALL
SELECT 'Asset', COUNT(*) FROM Asset UNION ALL
SELECT 'GenerationJob', COUNT(*) FROM GenerationJob UNION ALL
SELECT 'GenerationResult', COUNT(*) FROM GenerationResult UNION ALL
SELECT 'ProviderSetting', COUNT(*) FROM ProviderSetting;
"
```

Expected: save the exact output. These counts must match after final sync.

- [ ] **Step 5: Check database integrity**

Run on old server:

```bash
sqlite3 prisma/dev.db "PRAGMA integrity_check; PRAGMA foreign_key_check;"
```

Expected: first line is `ok`; no rows after `foreign_key_check`.

## Task 2: Prepare New Server Runtime

**Files:**
- Create/modify on new server: `.env`
- Use from repository: `package.json`, `package-lock.json`, `scripts/init-db.mjs`, `prisma/schema.prisma`

- [ ] **Step 1: Install system dependencies**

Run on new server:

```bash
node --version
npm --version
git --version
```

Expected: Node and npm are available. Use the same major Node version as old server if possible.

- [ ] **Step 2: Clone or copy repository**

Run on new server:

```bash
git clone https://github.com/koiyoho/tldraw-ai-board.git /srv/tldraw-ai-board
cd /srv/tldraw-ai-board
git checkout <OLD_SERVER_COMMIT_HASH>
```

Expected: repository is checked out at the same commit as old server.

- [ ] **Step 3: Install dependencies**

Run on new server inside `/srv/tldraw-ai-board`:

```bash
npm ci
```

Expected: dependencies install without errors.

- [ ] **Step 4: Copy environment**

Create `/srv/tldraw-ai-board/.env` on new server with values copied from old server.

Required values:

```bash
DATABASE_URL="file:./prisma/dev.db"
AUTH_SECRET="<exact same value as old server>"
AUTH_URL="http://taki999.f3322.org:3333"
NEXT_PUBLIC_TLDRAW_LICENSE_KEY="<same value as old server>"
```

Expected: `AUTH_SECRET` is exactly identical to old server. This preserves existing Auth.js JWT cookie validation.

- [ ] **Step 5: Generate Prisma client**

Run on new server:

```bash
npm run db:generate
```

Expected: Prisma client generation succeeds.

## Task 3: Initial Data Copy While Old Server Is Live

**Files:**
- Copy from old: `prisma/dev.db`
- Copy from old: `public/uploads/`
- Optional copy from old: local modified source files if not committed

- [ ] **Step 1: Create target directories**

Run on new server:

```bash
mkdir -p /srv/tldraw-ai-board/prisma /srv/tldraw-ai-board/public/uploads
```

Expected: directories exist.

- [ ] **Step 2: Copy uploads with rsync**

Run from new server or an admin machine that can reach both servers:

```bash
rsync -aHAX --numeric-ids --info=progress2 old-server:/home/koiyoho/tldraw-ai-board/public/uploads/ /srv/tldraw-ai-board/public/uploads/
```

Expected: upload files are copied. This can run while service is live; final sync happens later.

- [ ] **Step 3: Copy a live-safe SQLite backup**

Run on old server:

```bash
sqlite3 prisma/dev.db ".backup '/tmp/tldraw-ai-board-dev.db.backup'"
```

Then copy it to new server:

```bash
rsync -aHAX old-server:/tmp/tldraw-ai-board-dev.db.backup /srv/tldraw-ai-board/prisma/dev.db
```

Expected: new server has `/srv/tldraw-ai-board/prisma/dev.db`.

- [ ] **Step 4: Verify copied database**

Run on new server:

```bash
sqlite3 prisma/dev.db "PRAGMA integrity_check; PRAGMA foreign_key_check;"
```

Expected: first line is `ok`; no rows after `foreign_key_check`.

- [ ] **Step 5: Build on new server**

Run on new server:

```bash
npm run build
```

Expected: build succeeds. If it fails, fix before scheduling cutover.

## Task 4: Pre-Cutover Functional Test on New Server

**Files:**
- No file changes expected

- [ ] **Step 1: Start new server on a temporary port**

Run on new server:

```bash
npm run dev -- --port 3334
```

Expected: Next.js reports `Local: http://localhost:3334` and ready.

- [ ] **Step 2: Test login with Host header matching final domain**

Run from new server:

```bash
curl -I -H 'Host: taki999.f3322.org:3333' http://127.0.0.1:3334/
```

Expected: unauthenticated request returns redirect to `/login` or login page response.

- [ ] **Step 3: Compare row counts**

Run on new server:

```bash
sqlite3 prisma/dev.db "
SELECT 'User', COUNT(*) FROM User UNION ALL
SELECT 'Board', COUNT(*) FROM Board UNION ALL
SELECT 'BoardSnapshot', COUNT(*) FROM BoardSnapshot UNION ALL
SELECT 'Asset', COUNT(*) FROM Asset UNION ALL
SELECT 'GenerationJob', COUNT(*) FROM GenerationJob UNION ALL
SELECT 'GenerationResult', COUNT(*) FROM GenerationResult UNION ALL
SELECT 'ProviderSetting', COUNT(*) FROM ProviderSetting;
"
```

Expected: counts are close to the old inventory. They may be slightly stale because old server is still live.

- [ ] **Step 4: Verify asset file coverage**

Run on new server:

```bash
sqlite3 -readonly prisma/dev.db "SELECT storageKey FROM Asset;" | while IFS= read -r key; do test -f "public/$key" || printf 'missing %s\n' "$key"; done
```

Expected: no `missing ...` output.

## Task 5: Final Freeze and Consistent Data Sync

**Files:**
- Copy final: `prisma/dev.db`
- Sync final: `public/uploads/`

- [ ] **Step 1: Announce a short freeze**

Tell users not to generate/upload/edit for 2-5 minutes. If there are active users, do this during the lowest traffic period.

Expected: users know a brief switch is happening.

- [ ] **Step 2: Stop old server writes**

Run on old server:

```bash
fuser -k 3333/tcp || true
```

Expected: old Next.js process is stopped and cannot write new database rows or assets.

- [ ] **Step 3: Create final SQLite backup**

Run on old server:

```bash
sqlite3 prisma/dev.db ".backup '/tmp/tldraw-ai-board-dev.db.final'"
sqlite3 /tmp/tldraw-ai-board-dev.db.final "PRAGMA integrity_check; PRAGMA foreign_key_check;"
```

Expected: first line is `ok`; no rows after `foreign_key_check`.

- [ ] **Step 4: Copy final database**

Run from new server or admin machine:

```bash
rsync -aHAX old-server:/tmp/tldraw-ai-board-dev.db.final /srv/tldraw-ai-board/prisma/dev.db
```

Expected: final old database replaces new staging database.

- [ ] **Step 5: Final uploads sync with deletion**

Run from new server or admin machine:

```bash
rsync -aHAX --delete --numeric-ids --info=progress2 old-server:/home/koiyoho/tldraw-ai-board/public/uploads/ /srv/tldraw-ai-board/public/uploads/
```

Expected: new uploads directory exactly matches old uploads directory.

- [ ] **Step 6: Verify final row counts**

Run on new server:

```bash
sqlite3 prisma/dev.db "
SELECT 'User', COUNT(*) FROM User UNION ALL
SELECT 'Board', COUNT(*) FROM Board UNION ALL
SELECT 'BoardSnapshot', COUNT(*) FROM BoardSnapshot UNION ALL
SELECT 'Asset', COUNT(*) FROM Asset UNION ALL
SELECT 'GenerationJob', COUNT(*) FROM GenerationJob UNION ALL
SELECT 'GenerationResult', COUNT(*) FROM GenerationResult UNION ALL
SELECT 'ProviderSetting', COUNT(*) FROM ProviderSetting;
"
```

Expected: output exactly matches the old server final inventory.

- [ ] **Step 7: Verify final asset file coverage**

Run on new server:

```bash
sqlite3 -readonly prisma/dev.db "SELECT storageKey FROM Asset;" | while IFS= read -r key; do test -f "public/$key" || printf 'missing %s\n' "$key"; done
```

Expected: no `missing ...` output.

## Task 6: Start New Server and Switch Traffic

**Files:**
- Use: `.env`
- Use: `next.config.ts`

- [ ] **Step 1: Start service on new server**

For dev-style current deployment:

```bash
setsid npm run dev -- --port 3333 > /tmp/tldraw-ai-board-3333.log 2>&1 < /dev/null &
```

For production-style deployment after a successful build:

```bash
setsid npm run start -- --port 3333 > /tmp/tldraw-ai-board-3333.log 2>&1 < /dev/null &
```

Expected: service listens on `0.0.0.0:3333` or `*:3333`.

- [ ] **Step 2: Confirm listener**

Run on new server:

```bash
ss -ltnp 'sport = :3333'
```

Expected: a `next-server` process is listening on port `3333`.

- [ ] **Step 3: Smoke test public host routing before DNS switch if possible**

Run on new server:

```bash
curl -I -H 'Host: taki999.f3322.org:3333' http://127.0.0.1:3333/
```

Expected: returns `307 /login` or a `200` page depending on auth state.

- [ ] **Step 4: Switch traffic**

Update the DNS record, port forwarding, reverse proxy upstream, or NAT rule so `http://taki999.f3322.org:3333` reaches the new server.

Expected: external requests hit the new server.

- [ ] **Step 5: Confirm external access**

Run from a client outside the new server:

```bash
curl -I http://taki999.f3322.org:3333/
```

Expected: returns `307 /login` or a `200` page from the new server.

## Task 7: User-Facing Verification

**Files:**
- No file changes expected

- [ ] **Step 1: Verify existing login session**

Open `http://taki999.f3322.org:3333` in a browser that was logged in before migration.

Expected: user remains logged in. If not, users can log in again; this means `AUTH_SECRET`, cookie domain/origin, or `AUTH_URL` changed.

- [ ] **Step 2: Verify board list**

Open the board list/home page.

Expected: all existing boards are visible for the logged-in user.

- [ ] **Step 3: Verify canvas history**

Open a board that had historical AI generations.

Expected: canvas loads, existing images appear, and generation history entries are visible.

- [ ] **Step 4: Verify asset files**

Click several existing generated/uploaded images.

Expected: images load without broken URLs. Requests to `/api/assets/<assetId>/file` return image content.

- [ ] **Step 5: Verify AI generation provider settings**

Open provider settings for a user who had custom settings.

Expected: display name, base URL, image model, enabled state, and API key-backed generation behavior are preserved.

- [ ] **Step 6: Verify write path**

Create a test board or upload a small image after cutover.

Expected: database row appears in new `prisma/dev.db`, and file appears under new `public/uploads`.

## Task 8: Rollback Plan

**Files:**
- Old server remains intact during rollback window

- [ ] **Step 1: Define rollback trigger**

Rollback if users cannot log in, board data is missing, assets are broken, or AI generation fails for reasons not present before migration.

- [ ] **Step 2: Stop new server**

Run on new server:

```bash
fuser -k 3333/tcp || true
```

Expected: new service stops accepting writes.

- [ ] **Step 3: Restore traffic to old server**

Point DNS/reverse proxy/NAT back to old server.

Expected: `http://taki999.f3322.org:3333` reaches old server again.

- [ ] **Step 4: Restart old server**

Run on old server:

```bash
setsid npm run dev -- --port 3333 > /tmp/tldraw-ai-board-3333.log 2>&1 < /dev/null &
```

Expected: old server listens on port `3333` and users can continue from pre-cutover state.

## Task 9: Post-Migration Hardening

**Files:**
- Optional modify: deployment service file, reverse proxy config, backup scripts

- [ ] **Step 1: Add a real process manager**

Use `systemd`, `pm2`, or Docker Compose instead of a detached `setsid` command.

Expected: service restarts automatically after reboot or crash.

- [ ] **Step 2: Add scheduled backups**

Back up both SQLite and uploads together:

```bash
sqlite3 /srv/tldraw-ai-board/prisma/dev.db ".backup '/backup/tldraw-ai-board/dev-$(date +%F-%H%M%S).db'"
rsync -aHAX --delete /srv/tldraw-ai-board/public/uploads/ /backup/tldraw-ai-board/uploads/
```

Expected: recoverable database and asset backups exist.

- [ ] **Step 3: Consider moving assets off local disk**

For future multi-server or zero-downtime deploys, replace local `public/uploads` storage with S3/R2/MinIO and store object keys in `Asset.storageKey`.

Expected: future server moves no longer require copying large local asset directories.

- [ ] **Step 4: Consider moving SQLite to Postgres**

For multiple instances or higher traffic, move from SQLite to Postgres. This requires schema/provider changes and data migration, so it should be a separate planned task.

Expected: database can support concurrent app instances and managed backups.

## Self-Review

Spec coverage:

- Users are covered by copying `User` and preserving `AUTH_SECRET`.
- Login continuity is covered by same public origin, same `AUTH_SECRET`, and final DNS/proxy switch.
- Board history is covered by `Board`, `BoardSnapshot`, `GenerationJob`, and `GenerationResult` row checks.
- Assets are covered by `Asset` table plus `public/uploads` file coverage verification.
- AI provider settings are covered by `ProviderSetting` migration and functional test.
- Rollback is covered by keeping old server intact and switching traffic back.

Placeholder scan:

- No `TBD`, `TODO`, or unspecified implementation steps remain.

Type consistency:

- Paths match the current repository: `prisma/dev.db`, `public/uploads`, `.env`, `next.config.ts`.
- Database table names match `prisma/schema.prisma`.
