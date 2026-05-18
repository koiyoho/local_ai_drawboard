# Board Workspace Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the board workspace the post-login product surface, move board/admin management into board-first navigation, and add the first-slice layer, favorite, and asset-tag workflow.

**Architecture:** Add small server APIs for recent-board resolution and asset metadata, then reshape the client around `/boards/:id` as the main app surface. Keep existing board snapshot persistence for layer metadata and extract shared board-management primitives rather than duplicating the old workspace list.

**Tech Stack:** React 19, Vite, Fastify, Prisma SQLite, Konva/react-konva, TypeScript, zod, existing `tsx`/Node tests.

---

## File Structure

Server/API:

- Modify `prisma/schema.prisma`
  - Add `Asset.isFavorite` and `Asset.tagsJson`.
- Modify `server/routes/boards.ts`
  - Add `GET /api/boards/recent`.
  - Add `POST /api/boards/ensure-recent`.
  - Keep delete endpoint non-creating.
- Modify `server/routes/assets.ts`
  - Add `PATCH /api/assets/:assetId`.
  - Add tag validation helpers.
- Create `server/board-routes.test.mjs`
  - Test recent/ensure board behavior and deletion fallback shape.
- Create or extend `server/asset-routes.test.mjs`
  - Test favorite and tag metadata updates.

Client routing and admin:

- Modify `src/client/api.ts`
  - Add typed helpers for recent/ensure board, boards list, board CRUD, asset metadata, and current user.
- Modify `src/client/pages/LoginApp.tsx`
  - Login then call ensure-recent and redirect to `/boards/:id`.
- Modify `src/client/pages/HomeApp.tsx`
  - Replace ordinary workspace behavior with authenticated redirect to ensured recent board.
- Create `src/client/pages/AdminApp.tsx`
  - Admin-only management center using existing admin/provider components.
- Modify `src/client/main.tsx`
  - Route `/admin` to `AdminApp`.

Board menu and board drawer:

- Create `src/components/board-management/useBoardActions.ts`
  - Shared board CRUD hook used by the drawer.
- Create `src/components/board-management/BoardManagementDrawer.tsx`
  - Search, create, open, rename, duplicate, delete boards.
- Create `src/components/board-menu/BoardGlobalMenu.tsx`
  - Left titlebar menu and admin-aware entries.
- Modify `src/components/BoardWorkspace.tsx`
  - Load current user and board list metadata.
  - Use `BoardGlobalMenu`.
  - Open/close board-management drawer.
  - Handle current-board deletion fallback through `ensureRecentBoard`.

Asset metadata:

- Modify `src/components/board-canvas/types.ts`
  - Add `isFavorite` and `tagsJson` to `AssetPayload`.
- Modify `src/components/BoardWorkspace.tsx`
  - Toggle favorite state.
  - Edit/filter tags in asset UI.
  - Show favorite filters in existing asset panels.
- Modify `server/routes/boards.ts`
  - Ensure board fetch includes the new asset fields after Prisma generation.

Layer panel:

- Modify `src/components/board-canvas/board-document.ts`
  - Add shared layer metadata fields to board objects.
  - Parse and preserve `name`, `hidden`, and `locked`.
- Modify `src/components/board-canvas/export-board.ts`
  - Exclude hidden objects.
- Modify `src/components/board-canvas/KonvaBoardCanvas.tsx`
  - Do not render hidden objects.
  - Do not mutate locked objects.
  - Do not attach transformer to hidden or locked objects.
  - Keep hidden layer selection panel-only.
- Create `src/components/board-layers/LayerPanel.tsx`
  - List, select, rename, hide/show, lock/unlock, delete, and reorder layers.
- Modify `src/components/BoardWorkspace.tsx`
  - Wire layer panel actions into board document updates.

Tests:

- Modify `src/components/board-canvas/board-document.test.ts`
  - Add layer metadata parse/persist tests.
- Modify `src/components/board-canvas/viewport.test.ts` only if object bounds behavior changes.
- Add focused server tests described above.
- Run existing `npm run lint`, `npm run test`, `npm run build`, and `npm run smoke:board`.

---

### Task 1: Recent Board Server API

**Files:**
- Modify: `server/routes/boards.ts`
- Create: `server/board-routes.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests for recent-board read and ensure behavior**

Create `server/board-routes.test.mjs` with this structure:

```js
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const appModuleUrl = new URL("../dist/server/server/app.js", import.meta.url);
const authModuleUrl = new URL("../dist/server/server/auth.js", import.meta.url);

async function createHarness() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "board-routes-test-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
  process.env.AUTH_SECRET = "board-routes-test-secret";
  process.env.STORAGE_DIR = path.join(dir, "storage");
  const { prisma } = await import("../src/lib/prisma.ts");
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS User (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      passwordHash TEXT,
      role TEXT DEFAULT 'user',
      status TEXT DEFAULT 'approved',
      canUseAdminProvider BOOLEAN DEFAULT false,
      generationLimit INTEGER DEFAULT 30,
      generationFiveHourLimit INTEGER DEFAULT 10,
      approvedAt DATETIME,
      approvedByUserId TEXT,
      name TEXT,
      email TEXT UNIQUE,
      emailVerified DATETIME,
      image TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS Board (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      name TEXT NOT NULL,
      snapshotJson TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS Board_userId_updatedAt_idx ON Board(userId, updatedAt)");
  const { createApp } = await import(appModuleUrl);
  const { signSession } = await import(authModuleUrl);
  const app = await createApp();
  const user = await prisma.user.create({
    data: { id: "user-1", role: "user", status: "approved", username: "route-user" },
  });
  const cookie = `session=${signSession({ id: user.id, role: user.role, status: user.status, username: user.username })}`;
  return { app, cookie, dir, prisma, user };
}

test("GET /api/boards/recent is read-only and reports no_board", async () => {
  const harness = await createHarness();
  try {
    const response = await harness.app.inject({
      headers: { cookie: harness.cookie },
      method: "GET",
      url: "/api/boards/recent",
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error, "no_board");
    assert.equal(await harness.prisma.board.count({ where: { userId: harness.user.id } }), 0);
  } finally {
    await harness.app.close();
    await harness.prisma.$disconnect();
    await rm(harness.dir, { force: true, recursive: true });
  }
});

test("POST /api/boards/ensure-recent creates a default board when none exists", async () => {
  const harness = await createHarness();
  try {
    const response = await harness.app.inject({
      headers: { cookie: harness.cookie },
      method: "POST",
      url: "/api/boards/ensure-recent",
    });
    assert.equal(response.statusCode, 201);
    const payload = response.json();
    assert.equal(payload.board.name, "未命名画板");
    assert.equal(await harness.prisma.board.count({ where: { userId: harness.user.id } }), 1);
  } finally {
    await harness.app.close();
    await harness.prisma.$disconnect();
    await rm(harness.dir, { force: true, recursive: true });
  }
});
```

- [ ] **Step 2: Add the test file to `package.json`**

Add `node server/board-routes.test.mjs` to the `test` script after existing server route tests.

- [ ] **Step 3: Run the failing test**

Run: `npm run build; node server/board-routes.test.mjs`

Expected: fails because `/api/boards/recent` and `/api/boards/ensure-recent` do not exist.

- [ ] **Step 4: Implement recent and ensure endpoints**

In `server/routes/boards.ts`, add helpers near the top:

```ts
const DEFAULT_BOARD_NAME = "未命名画板";

async function findRecentBoard(userId: string) {
  return prisma.board.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { assets: true, jobs: true } } },
  });
}
```

Inside `registerBoardRoutes`, before `app.get("/api/boards/:boardId", ...)`, add:

```ts
  app.get("/api/boards/recent", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const board = await findRecentBoard(user.id);
    if (!board) return jsonError(reply, "no_board", 404);
    return { board };
  });

  app.post("/api/boards/ensure-recent", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const existing = await findRecentBoard(user.id);
    if (existing) return { board: existing };
    const board = await prisma.board.create({
      data: { name: DEFAULT_BOARD_NAME, userId: user.id },
      include: { _count: { select: { assets: true, jobs: true } } },
    });
    return reply.status(201).send({ board });
  });
```

- [ ] **Step 5: Run focused tests**

Run: `npm run build; node server/board-routes.test.mjs`

Expected: both tests pass.

- [ ] **Step 6: Commit**

```powershell
git add package.json server/routes/boards.ts server/board-routes.test.mjs
git commit -m "feat: add recent board resolution api"
```

---

### Task 2: Login, Root Redirect, and Admin Shell

**Files:**
- Modify: `src/client/api.ts`
- Modify: `src/client/pages/LoginApp.tsx`
- Modify: `src/client/pages/HomeApp.tsx`
- Create: `src/client/pages/AdminApp.tsx`
- Modify: `src/client/main.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add typed client helpers**

In `src/client/api.ts`, add:

```ts
export type BoardSummaryPayload = {
  id: string;
  name: string;
  updatedAt: string;
  _count?: {
    assets: number;
    jobs: number;
  };
};

export async function ensureRecentBoard() {
  return apiJson<{ board: BoardSummaryPayload }>("/api/boards/ensure-recent", { method: "POST" });
}

export async function getBoards() {
  return apiJson<{ boards: BoardSummaryPayload[] }>("/api/boards");
}
```

- [ ] **Step 2: Change login success redirect**

In `src/client/pages/LoginApp.tsx`, replace the login handler body:

```ts
await login(username, password);
const { board } = await ensureRecentBoard();
window.location.href = `/boards/${board.id}`;
```

Add `ensureRecentBoard` to the import from `../api`.

- [ ] **Step 3: Change `HomeApp` into authenticated recent-board redirect**

Replace `HomeApp` with:

```tsx
import { useEffect, useState } from "react";

import { ensureRecentBoard, getCurrentUser } from "../api";
import { ErrorState, LoadingState } from "./LoadingState";

export function HomeApp() {
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        await getCurrentUser();
        const { board } = await ensureRecentBoard();
        window.location.replace(`/boards/${board.id}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "加载失败";
        if (message.includes("Authentication")) window.location.href = "/login";
        else setError(message);
      }
    }
    void load();
  }, []);

  if (error) return <ErrorState message={error} />;
  return <LoadingState message="正在进入最近画板..." />;
}
```

- [ ] **Step 4: Create admin page**

Create `src/client/pages/AdminApp.tsx`:

```tsx
import { useEffect, useState } from "react";

import { AccountActions } from "@/components/AccountActions";
import { AdminUsagePanel, type AdminUsageUserPayload } from "@/components/AdminUsagePanel";
import { AdminUserReview, type AdminReviewUser } from "@/components/AdminUserReview";
import { CodexLoginCard } from "@/components/CodexLoginCard";
import { ProviderSettingsForm, type ProviderSettingPayload } from "@/components/ProviderSettingsForm";
import { apiJson, ensureRecentBoard, getCurrentUser, type CurrentUserPayload } from "../api";
import { ErrorState, LoadingState } from "./LoadingState";

type AdminPayload = {
  pendingReviewUsers: AdminReviewUser[];
  providerSetting: ProviderSettingPayload | null;
  usageUsers: AdminUsageUserPayload[];
  user: CurrentUserPayload;
};

export function AdminApp() {
  const [payload, setPayload] = useState<AdminPayload | null>(null);
  const [error, setError] = useState("");
  const [isProviderExpanded, setIsProviderExpanded] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const { user } = await getCurrentUser();
        if (user.role !== "admin") {
          const { board } = await ensureRecentBoard();
          window.location.replace(`/boards/${board.id}?notice=admin-required`);
          return;
        }
        const [{ providerSetting }, pending, usage] = await Promise.all([
          apiJson<{ providerSetting: ProviderSettingPayload | null }>("/api/provider-settings"),
          apiJson<{ users: AdminReviewUser[] }>("/api/admin/users"),
          apiJson<{ users: AdminUsageUserPayload[] }>("/api/admin/usage"),
        ]);
        setPayload({ pendingReviewUsers: pending.users, providerSetting, usageUsers: usage.users, user });
      } catch (error) {
        const message = error instanceof Error ? error.message : "加载失败";
        if (message.includes("Authentication")) window.location.href = "/login";
        else setError(message);
      }
    }
    void load();
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!payload) return <LoadingState message="正在加载管理中心..." />;

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <a href="/">返回画板</a>
        <AccountActions email={payload.user.email} name={payload.user.name ?? payload.user.username} />
      </header>
      <section className="admin-content">
        <div className="home-title-block">
          <p className="eyebrow">管理中心</p>
          <h1>API、AI 平台和用户管理</h1>
        </div>
        <ProviderSettingsForm
          initialSetting={payload.providerSetting}
          isExpanded={isProviderExpanded}
          onExpandedChange={setIsProviderExpanded}
        />
        <CodexLoginCard />
        <AdminUserReview initialUsers={payload.pendingReviewUsers} />
        <AdminUsagePanel initialUsers={payload.usageUsers} />
      </section>
    </main>
  );
}
```

- [ ] **Step 5: Route `/admin`**

In `src/client/main.tsx`, import `AdminApp` and add before board matching:

```ts
if (path === "/admin") return <AdminApp />;
```

- [ ] **Step 6: Add minimal admin layout CSS**

Append to `src/app/globals.css`:

```css
.admin-shell {
  min-height: 100vh;
  background: #f5f7fb;
  color: #111827;
  padding: 20px;
}

.admin-topbar,
.admin-content {
  margin: 0 auto;
  max-width: 1180px;
}

.admin-topbar {
  align-items: center;
  display: flex;
  justify-content: space-between;
  margin-bottom: 18px;
}

.admin-topbar a {
  color: #2563eb;
  font-weight: 700;
  text-decoration: none;
}

.admin-content {
  display: grid;
  gap: 16px;
}
```

- [ ] **Step 7: Run validation**

Run: `npm run lint && npm run test && npm run build`

Expected: all pass.

- [ ] **Step 8: Commit**

```powershell
git add src/client/api.ts src/client/pages/LoginApp.tsx src/client/pages/HomeApp.tsx src/client/pages/AdminApp.tsx src/client/main.tsx src/app/globals.css
git commit -m "feat: route users into recent board"
```

---

### Task 3: Board Global Menu and Management Drawer

**Files:**
- Create: `src/components/board-management/useBoardActions.ts`
- Create: `src/components/board-management/BoardManagementDrawer.tsx`
- Create: `src/components/board-menu/BoardGlobalMenu.tsx`
- Modify: `src/components/BoardWorkspace.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Create shared board actions hook**

Create `src/components/board-management/useBoardActions.ts`:

```ts
import { useCallback, useState } from "react";

import { apiJson, ensureRecentBoard, getBoards, type BoardSummaryPayload } from "@/client/api";

export function useBoardActions(currentBoardId: string) {
  const [boards, setBoards] = useState<BoardSummaryPayload[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const refreshBoards = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const payload = await getBoards();
      setBoards(payload.boards);
    } catch (error) {
      setError(error instanceof Error ? error.message : "加载画板失败");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createBoard = useCallback(async (name: string) => {
    const payload = await apiJson<{ board: BoardSummaryPayload }>("/api/boards", {
      body: JSON.stringify({ name }),
      method: "POST",
    });
    window.location.href = `/boards/${payload.board.id}`;
  }, []);

  const renameBoard = useCallback(async (boardId: string, name: string) => {
    const payload = await apiJson<{ board: BoardSummaryPayload }>(`/api/boards/${boardId}`, {
      body: JSON.stringify({ name }),
      method: "PATCH",
    });
    setBoards((current) => current.map((board) => (board.id === boardId ? { ...board, name: payload.board.name } : board)));
  }, []);

  const duplicateBoard = useCallback(async (boardId: string) => {
    const payload = await apiJson<{ board: BoardSummaryPayload }>(`/api/boards/${boardId}/duplicate`, { method: "POST" });
    setBoards((current) => [payload.board, ...current]);
  }, []);

  const deleteBoard = useCallback(async (boardId: string) => {
    await apiJson<{ ok: true }>(`/api/boards/${boardId}`, { method: "DELETE" });
    if (boardId === currentBoardId) {
      const { board } = await ensureRecentBoard();
      window.location.href = `/boards/${board.id}`;
      return;
    }
    setBoards((current) => current.filter((board) => board.id !== boardId));
  }, [currentBoardId]);

  return { boards, createBoard, deleteBoard, duplicateBoard, error, isLoading, refreshBoards, renameBoard };
}
```

- [ ] **Step 2: Create `BoardGlobalMenu`**

Create `src/components/board-menu/BoardGlobalMenu.tsx`:

```tsx
import { AppIcon } from "@/components/ui/AppIcon";
import { IconAssets, IconBoards, IconLayers, IconLogout, IconMenu, IconReview, IconStar } from "@/components/ui/icons";

type BoardGlobalMenuProps = {
  boardName: string;
  isAdmin: boolean;
  isOpen: boolean;
  onOpenAdmin: () => void;
  onOpenBoardManagement: () => void;
  onOpenLayers: () => void;
  onOpenMenu: () => void;
  onSignOut: () => void;
};

export function BoardGlobalMenu({
  boardName,
  isAdmin,
  isOpen,
  onOpenAdmin,
  onOpenBoardManagement,
  onOpenLayers,
  onOpenMenu,
  onSignOut,
}: BoardGlobalMenuProps) {
  return (
    <div className="board-global-menu-wrap">
      <button aria-expanded={isOpen} aria-label="打开菜单" className="board-titlebar-menu" onClick={onOpenMenu} type="button">
        <AppIcon icon={IconMenu} size="xl" />
      </button>
      {isOpen ? (
        <div className="board-global-menu" role="menu">
          <div className="board-global-menu-header">
            <strong>AI Board</strong>
            <span>{boardName}</span>
          </div>
          <button onClick={onOpenBoardManagement} role="menuitem" type="button"><AppIcon icon={IconBoards} size="md" />画板管理</button>
          <button onClick={onOpenLayers} role="menuitem" type="button"><AppIcon icon={IconLayers} size="md" />图层面板</button>
          <button disabled role="menuitem" title="第一期暂不启用" type="button"><AppIcon icon={IconAssets} size="md" />提示词历史</button>
          <button disabled role="menuitem" title="从素材区筛选收藏" type="button"><AppIcon icon={IconStar} size="md" />生成收藏</button>
          {isAdmin ? <button onClick={onOpenAdmin} role="menuitem" type="button"><AppIcon icon={IconReview} size="md" />管理中心</button> : null}
          <button onClick={onSignOut} role="menuitem" type="button"><AppIcon icon={IconLogout} size="md" />退出登录</button>
        </div>
      ) : null}
    </div>
  );
}
```

Add `Star as IconStar` to `src/components/ui/icons.ts` in the same commit.

- [ ] **Step 3: Create board management drawer**

Create `src/components/board-management/BoardManagementDrawer.tsx`:

```tsx
import { useMemo, useState } from "react";

import type { BoardSummaryPayload } from "@/client/api";
import { AppIcon } from "@/components/ui/AppIcon";
import { IconClose, IconCopy, IconDelete, IconOpen, IconPlus, IconRename } from "@/components/ui/icons";

type BoardManagementDrawerProps = {
  boards: BoardSummaryPayload[];
  currentBoardId: string;
  error: string;
  isLoading: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  onDelete: (boardId: string) => Promise<void>;
  onDuplicate: (boardId: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onRename: (boardId: string, name: string) => Promise<void>;
};

export function BoardManagementDrawer({
  boards,
  currentBoardId,
  error,
  isLoading,
  onClose,
  onCreate,
  onDelete,
  onDuplicate,
  onRefresh,
  onRename,
}: BoardManagementDrawerProps) {
  const [query, setQuery] = useState("");
  const [name, setName] = useState("未命名画板");
  const filteredBoards = useMemo(
    () => boards.filter((board) => board.name.toLowerCase().includes(query.trim().toLowerCase())),
    [boards, query],
  );

  return (
    <aside className="board-management-drawer" aria-label="画板管理">
      <header>
        <div>
          <strong>画板管理</strong>
          <span>{isLoading ? "加载中" : `${boards.length} 个画板`}</span>
        </div>
        <button aria-label="关闭画板管理" onClick={onClose} type="button"><AppIcon icon={IconClose} size="md" /></button>
      </header>
      {error ? <p className="generation-result-hint error">{error}</p> : null}
      <div className="drawer-inline-form">
        <input maxLength={80} onChange={(event) => setName(event.target.value)} value={name} />
        <button disabled={!name.trim()} onClick={() => void onCreate(name.trim())} type="button"><AppIcon icon={IconPlus} size="md" />新建</button>
      </div>
      <input className="drawer-search" onChange={(event) => setQuery(event.target.value)} placeholder="搜索画板" value={query} />
      <div className="drawer-board-list">
        {filteredBoards.map((board) => (
          <article className={board.id === currentBoardId ? "drawer-board-row is-current" : "drawer-board-row"} key={board.id}>
            <div>
              <strong>{board.name}</strong>
              <span>更新于 {new Date(board.updatedAt).toLocaleString("zh-CN")}</span>
            </div>
            <div>
              <a aria-label={`打开 ${board.name}`} href={`/boards/${board.id}`}><AppIcon icon={IconOpen} size="md" /></a>
              <button aria-label={`重命名 ${board.name}`} onClick={() => {
                const nextName = window.prompt("画板名称", board.name)?.trim();
                if (nextName) void onRename(board.id, nextName);
              }} type="button"><AppIcon icon={IconRename} size="md" /></button>
              <button aria-label={`复制 ${board.name}`} onClick={() => void onDuplicate(board.id)} type="button"><AppIcon icon={IconCopy} size="md" /></button>
              <button aria-label={`删除 ${board.name}`} className="danger-action" onClick={() => {
                if (window.confirm(`确定删除“${board.name}”？`)) void onDelete(board.id);
              }} type="button"><AppIcon icon={IconDelete} size="md" /></button>
            </div>
          </article>
        ))}
      </div>
      <button className="secondary-action" disabled={isLoading} onClick={() => void onRefresh()} type="button">刷新列表</button>
    </aside>
  );
}
```

- [ ] **Step 4: Wire menu and drawer into `BoardWorkspace`**

In `src/components/BoardWorkspace.tsx`:

1. Import `BoardGlobalMenu`, `BoardManagementDrawer`, `useBoardActions`, `getCurrentUser`, and `logout`.
2. Add state:

```ts
const [isGlobalMenuOpen, setIsGlobalMenuOpen] = useState(false);
const [isBoardDrawerOpen, setIsBoardDrawerOpen] = useState(false);
const [isLayerPanelOpen, setIsLayerPanelOpen] = useState(false);
const [currentUserRole, setCurrentUserRole] = useState("user");
```

3. Load user role in an effect:

```ts
useEffect(() => {
  let active = true;
  getCurrentUser()
    .then(({ user }) => {
      if (active) setCurrentUserRole(user.role);
    })
    .catch(() => undefined);
  return () => {
    active = false;
  };
}, []);
```

4. Initialize board actions:

```ts
const boardActions = useBoardActions(board.id);
```

5. Replace the titlebar menu button with `BoardGlobalMenu`.
6. Render `BoardManagementDrawer` when `isBoardDrawerOpen`.
7. On opening the drawer, call `void boardActions.refreshBoards()`.

- [ ] **Step 5: Add drawer/menu CSS**

Add focused CSS to `src/app/globals.css` for `.board-global-menu-wrap`, `.board-global-menu`, `.board-management-drawer`, `.drawer-inline-form`, `.drawer-search`, `.drawer-board-list`, and `.drawer-board-row`. Keep it aligned with current board styling: white surfaces, `8px` radius, restrained borders, no nested card styling.

- [ ] **Step 6: Run validation**

Run: `npm run lint && npm run test && npm run build`

Expected: all pass.

- [ ] **Step 7: Commit**

```powershell
git add src/components/board-management src/components/board-menu src/components/BoardWorkspace.tsx src/components/ui/icons.ts src/app/globals.css
git commit -m "feat: add board workspace management menu"
```

---

### Task 4: Asset Favorites and Tags

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `server/routes/assets.ts`
- Create: `server/asset-routes.test.mjs`
- Modify: `src/components/board-canvas/types.ts`
- Modify: `src/components/BoardWorkspace.tsx`

- [ ] **Step 1: Add Prisma fields**

In `prisma/schema.prisma`, add to `model Asset`:

```prisma
  isFavorite Boolean  @default(false)
  tagsJson   String?
```

- [ ] **Step 2: Generate Prisma client**

Run: `npm run db:generate`

Expected: `src/generated/prisma` updates.

- [ ] **Step 3: Write asset metadata tests**

Create `server/asset-routes.test.mjs` with tests for:

```js
test("PATCH /api/assets/:assetId updates favorite and normalized tags", async () => {
  // Create user, board, asset in temp DB.
  // Send { isFavorite: true, tags: [" 产品 ", "产品", "bg_1"] }.
  // Assert response asset.isFavorite === true.
  // Assert tags are ["产品", "bg_1"].
});

test("PATCH /api/assets/:assetId rejects too many or too long tags", async () => {
  // Send 13 tags and assert 400.
  // Send one 25-char tag and assert 400.
});
```

Use the harness style from `server/board-routes.test.mjs`, but include the `Asset` table with `isFavorite` and `tagsJson` columns.

- [ ] **Step 4: Implement tag normalization and patch route**

In `server/routes/assets.ts`, add near the top:

```ts
import { z } from "zod";
import { parseBody } from "../http";

const MAX_ASSET_TAGS = 12;
const MAX_ASSET_TAG_LENGTH = 24;
const tagPattern = /^[\p{Script=Han}\p{L}\p{N}_ -]+$/u;

const assetPatchSchema = z.object({
  isFavorite: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});

function normalizeAssetTags(tags: string[]) {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const rawTag of tags) {
    const tag = rawTag.trim().replace(/\s+/g, " ");
    if (!tag) continue;
    if (tag.length > MAX_ASSET_TAG_LENGTH) throw new Error(`标签不能超过 ${MAX_ASSET_TAG_LENGTH} 个字符`);
    if (!tagPattern.test(tag)) throw new Error("标签只能包含文字、数字、空格、连字符和下划线");
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(tag);
  }
  if (normalized.length > MAX_ASSET_TAGS) throw new Error(`每个素材最多 ${MAX_ASSET_TAGS} 个标签`);
  return normalized;
}
```

Inside `registerAssetRoutes`, add before delete:

```ts
  app.patch<{ Params: { assetId: string } }>("/api/assets/:assetId", async (request, reply) => {
    const user = await requireCurrentUser(request, reply);
    if (!user) return;
    const parsed = parseBody(assetPatchSchema, request.body);
    if (!parsed.ok) return jsonError(reply, parsed.error);
    const asset = await prisma.asset.findFirst({ where: { id: request.params.assetId, board: { userId: user.id } } });
    if (!asset) return jsonError(reply, "Asset not found", 404);
    const data: { isFavorite?: boolean; tagsJson?: string } = {};
    if (typeof parsed.data.isFavorite === "boolean") data.isFavorite = parsed.data.isFavorite;
    if (parsed.data.tags) {
      try {
        data.tagsJson = JSON.stringify(normalizeAssetTags(parsed.data.tags));
      } catch (error) {
        return jsonError(reply, getErrorMessage(error, "标签格式不正确"), 400);
      }
    }
    const updatedAsset = await prisma.asset.update({ where: { id: asset.id }, data });
    return { asset: { ...updatedAsset, tags: parseAssetTags(updatedAsset.tagsJson) } };
  });
```

Also add:

```ts
function parseAssetTags(tagsJson: string | null) {
  if (!tagsJson) return [];
  try {
    const parsed = JSON.parse(tagsJson);
    return Array.isArray(parsed) ? normalizeAssetTags(parsed.filter((tag): tag is string => typeof tag === "string")) : [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 5: Update payload type**

In `src/components/board-canvas/types.ts`, add:

```ts
  isFavorite: boolean;
  tagsJson: string | null;
```

to `AssetPayload`.

- [ ] **Step 6: Add UI helpers in `BoardWorkspace`**

In `BoardWorkspace`, add functions:

```ts
function getAssetTags(asset: AssetPayload) {
  if (!asset.tagsJson) return [];
  try {
    const parsed = JSON.parse(asset.tagsJson);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

async function patchAssetMetadata(assetId: string, patch: { isFavorite?: boolean; tags?: string[] }) {
  const response = await apiFetch(`/api/assets/${assetId}`, {
    body: JSON.stringify(patch),
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "素材更新失败");
  const updatedAsset = payload.asset as AssetPayload & { tags?: string[] };
  setBoard((current) => ({
    ...current,
    assets: current.assets.map((asset) =>
      asset.id === assetId
        ? { ...asset, isFavorite: updatedAsset.isFavorite, tagsJson: updatedAsset.tagsJson ?? JSON.stringify(updatedAsset.tags ?? []) }
        : asset,
    ),
  }));
}
```

Add favorite buttons in asset cards and generated-result controls. Add a simple tag input using `window.prompt("标签，用逗号分隔", getAssetTags(asset).join(", "))` for the first slice.

- [ ] **Step 7: Add asset filter state**

Add:

```ts
const [assetSearchQuery, setAssetSearchQuery] = useState("");
const [assetFavoriteOnly, setAssetFavoriteOnly] = useState(false);
```

Create `visibleAssets` filtered by `assetSearchQuery`, `assetFavoriteOnly`, kind, size, prompt text from jobs, and tags. Use it in the asset panel instead of raw `board.assets` where the asset list is displayed.

- [ ] **Step 8: Run validation**

Run: `npm run db:generate && npm run lint && npm run test && npm run build`

Expected: all pass.

- [ ] **Step 9: Commit**

```powershell
git add prisma/schema.prisma src/generated/prisma server/routes/assets.ts server/asset-routes.test.mjs src/components/board-canvas/types.ts src/components/BoardWorkspace.tsx
git commit -m "feat: add asset favorites and tags"
```

---

### Task 5: Board Layer Metadata and Parser Tests

**Files:**
- Modify: `src/components/board-canvas/board-document.ts`
- Modify: `src/components/board-canvas/board-document.test.ts`

- [ ] **Step 1: Write failing tests for layer metadata**

Add to `src/components/board-canvas/board-document.test.ts`:

```ts
test("getBoardDocumentFromSnapshot preserves layer metadata", () => {
  const document = getBoardDocumentFromSnapshot({
    app: {
      boardDocument: {
        currentPageId: "page:1",
        pages: [
          {
            id: "page:1",
            name: "第 1 页",
            objects: [
              {
                assetId: "asset-1",
                hidden: true,
                h: 120,
                id: "image-1",
                locked: true,
                name: "主图",
                rotation: 0,
                type: "image",
                w: 160,
                x: 1,
                y: 2,
              },
            ],
          },
        ],
        version: 1,
      },
    },
  });
  assert.deepEqual(document.pages[0]?.objects[0], {
    assetId: "asset-1",
    hidden: true,
    h: 120,
    id: "image-1",
    locked: true,
    name: "主图",
    rotation: 0,
    type: "image",
    w: 160,
    x: 1,
    y: 2,
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `tsx src/components/board-canvas/board-document.test.ts`

Expected: fails because layer metadata is not parsed.

- [ ] **Step 3: Add shared layer metadata type**

In `board-document.ts`, add:

```ts
export type BoardLayerMetadata = {
  hidden?: boolean;
  locked?: boolean;
  name?: string;
};
```

Change object types to intersect metadata:

```ts
export type BoardImageObject = BoardLayerMetadata & { ... };
```

Repeat for rect, text, and path objects.

- [ ] **Step 4: Add metadata parser helper**

Add:

```ts
function getLayerMetadata(value: Record<string, unknown>): BoardLayerMetadata {
  return {
    ...(typeof value.name === "string" && value.name.trim() ? { name: value.name.trim().slice(0, 80) } : {}),
    ...(value.hidden === true ? { hidden: true } : {}),
    ...(value.locked === true ? { locked: true } : {}),
  };
}
```

Spread `...getLayerMetadata(value)` into each parsed object.

- [ ] **Step 5: Run parser tests**

Run: `tsx src/components/board-canvas/board-document.test.ts`

Expected: pass.

- [ ] **Step 6: Commit**

```powershell
git add src/components/board-canvas/board-document.ts src/components/board-canvas/board-document.test.ts
git commit -m "feat: preserve board layer metadata"
```

---

### Task 6: Hidden and Locked Canvas Behavior

**Files:**
- Modify: `src/components/board-canvas/KonvaBoardCanvas.tsx`
- Modify: `src/components/board-canvas/export-board.ts`
- Modify: `src/components/board-canvas/board-document.test.ts`

- [ ] **Step 1: Add export hidden-object test**

If export tests are not currently practical in Node, add a pure helper to `export-board.ts`:

```ts
export function getExportableObjects(objects: BoardObject[]) {
  return objects.filter((object) => !object.hidden);
}
```

Add a test in `board-document.test.ts` or a new `export-board.test.ts`:

```ts
test("getExportableObjects excludes hidden layers", async () => {
  const { getExportableObjects } = await import("./export-board");
  const objects: BoardObject[] = [
    { hidden: true, id: "rect-hidden", rotation: 0, type: "rect", w: 10, h: 10, x: 0, y: 0 },
    { id: "rect-visible", rotation: 0, type: "rect", w: 10, h: 10, x: 0, y: 0 },
  ];
  assert.deepEqual(getExportableObjects(objects).map((object) => object.id), ["rect-visible"]);
});
```

- [ ] **Step 2: Run failing test**

Run: `tsx src/components/board-canvas/board-document.test.ts`

Expected: fails until helper exists or export uses it.

- [ ] **Step 3: Implement export filtering**

In `export-board.ts`, call `getExportableObjects(objects)` before bounds and render:

```ts
const exportableObjects = getExportableObjects(objects);
const bounds = getCombinedBounds(exportableObjects);
```

Iterate `exportableObjects` instead of `objects`.

- [ ] **Step 4: Update Konva rendering**

In `KonvaBoardCanvas.tsx`:

1. Add:

```ts
const visiblePageObjects = pageObjects.filter((object) => !object.hidden);
```

2. Use `visiblePageObjects` for render and transformer candidate nodes.
3. In `handleObjectClick`, `handleObjectContextMenu`, `handleDragEnd`, and `handleTransformEnd`, early-return if the object is locked or hidden:

```ts
const object = pageObjects.find((item) => item.id === id);
if (!object || object.hidden || object.locked) return;
```

Suppress the context menu for locked objects in the first slice. This means copy and delete are both unavailable from the canvas context menu until the object is unlocked.

4. Pass `draggable={!isMaskMode && !object.locked}` to all object nodes.

5. Exclude locked objects from transformer candidates:

```ts
pageObjects.filter((object) => !object.hidden && !object.locked && (object.type === "image" || object.type === "rect"))
```

- [ ] **Step 5: Run validation**

Run: `npm run lint && npm run test && npm run build`

Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add src/components/board-canvas/KonvaBoardCanvas.tsx src/components/board-canvas/export-board.ts src/components/board-canvas/board-document.test.ts
git commit -m "feat: enforce layer visibility and locks"
```

---

### Task 7: Layer Panel UI

**Files:**
- Create: `src/components/board-layers/LayerPanel.tsx`
- Modify: `src/components/BoardWorkspace.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Create `LayerPanel`**

Create `src/components/board-layers/LayerPanel.tsx`:

```tsx
import type { BoardObject } from "@/components/board-canvas/board-document";
import { AppIcon } from "@/components/ui/AppIcon";
import { IconClose, IconDelete, IconLayers, IconLock, IconUnlock, IconView, IconViewOff } from "@/components/ui/icons";

type LayerPanelProps = {
  objects: BoardObject[];
  selectedObjectIds: string[];
  onClose: () => void;
  onDelete: (objectId: string) => void;
  onMove: (objectId: string, direction: "up" | "down") => void;
  onRename: (objectId: string, name: string) => void;
  onSelect: (objectId: string) => void;
  onToggleHidden: (objectId: string) => void;
  onToggleLocked: (objectId: string) => void;
};

export function LayerPanel({
  objects,
  selectedObjectIds,
  onClose,
  onDelete,
  onMove,
  onRename,
  onSelect,
  onToggleHidden,
  onToggleLocked,
}: LayerPanelProps) {
  return (
    <aside className="layer-panel" aria-label="图层面板">
      <header>
        <div><AppIcon icon={IconLayers} size="md" /><strong>图层</strong></div>
        <button aria-label="关闭图层面板" onClick={onClose} type="button"><AppIcon icon={IconClose} size="md" /></button>
      </header>
      {objects.length === 0 ? <p className="muted">当前画板没有图层。</p> : null}
      <div className="layer-list">
        {[...objects].reverse().map((object) => (
          <article className={selectedObjectIds.includes(object.id) ? "layer-row is-selected" : "layer-row"} key={object.id}>
            <button onClick={() => onSelect(object.id)} type="button">
              <strong>{object.name || getDefaultLayerName(object)}</strong>
              <span>{object.type}</span>
            </button>
            <div>
              <button aria-label="重命名" onClick={() => {
                const name = window.prompt("图层名称", object.name || getDefaultLayerName(object))?.trim();
                if (name) onRename(object.id, name);
              }} type="button">名</button>
              <button aria-label={object.hidden ? "显示" : "隐藏"} onClick={() => onToggleHidden(object.id)} type="button">
                <AppIcon icon={object.hidden ? IconViewOff : IconView} size="sm" />
              </button>
              <button aria-label={object.locked ? "解锁" : "锁定"} onClick={() => onToggleLocked(object.id)} type="button">
                <AppIcon icon={object.locked ? IconLock : IconUnlock} size="sm" />
              </button>
              <button aria-label="上移" onClick={() => onMove(object.id, "up")} type="button">↑</button>
              <button aria-label="下移" onClick={() => onMove(object.id, "down")} type="button">↓</button>
              <button aria-label="删除" className="danger-action" onClick={() => onDelete(object.id)} type="button">
                <AppIcon icon={IconDelete} size="sm" />
              </button>
            </div>
          </article>
        ))}
      </div>
    </aside>
  );
}

function getDefaultLayerName(object: BoardObject) {
  if (object.type === "image") return "图片图层";
  if (object.type === "rect") return "矩形图层";
  if (object.type === "text") return "文字图层";
  return "路径图层";
}
```

Add missing icon aliases to `src/components/ui/icons.ts`: `Eye as IconView`, `EyeOff as IconViewOff`, `Lock as IconLock`, `Unlock as IconUnlock`.

- [ ] **Step 2: Add document update helpers in `BoardWorkspace`**

Add helpers:

```ts
function updateCurrentPageObjects(updater: (objects: BoardObject[]) => BoardObject[]) {
  const nextDocument = {
    ...boardDocumentRef.current,
    pages: boardDocumentRef.current.pages.map((page) =>
      page.id === boardDocumentRef.current.currentPageId ? { ...page, objects: updater(page.objects) } : page,
    ),
  };
  setDocumentAndSave(nextDocument);
}

function updateLayer(objectId: string, patch: Partial<Pick<BoardObject, "hidden" | "locked" | "name">>) {
  updateCurrentPageObjects((objects) => objects.map((object) => (object.id === objectId ? { ...object, ...patch } : object)));
}
```

This uses the existing `setDocumentAndSave(nextDocument)` helper, which updates `boardDocumentRef`, React state, and scheduled persistence together.

- [ ] **Step 3: Wire panel actions**

In `BoardWorkspace`, render:

```tsx
{isLayerPanelOpen ? (
  <LayerPanel
    objects={currentPageObjects}
    onClose={() => setIsLayerPanelOpen(false)}
    onDelete={deleteCanvasObject}
    onMove={moveLayer}
    onRename={(id, name) => updateLayer(id, { name })}
    onSelect={(id) => setSelectedObjectIds([id])}
    onToggleHidden={(id) => toggleLayerHidden(id)}
    onToggleLocked={(id) => toggleLayerLocked(id)}
    selectedObjectIds={selectedObjectIds}
  />
) : null}
```

Implement `moveLayer`, `toggleLayerHidden`, `toggleLayerLocked`, and `deleteCanvasObject` against the current page objects.

- [ ] **Step 4: Ensure hidden panel selection is metadata-only**

When a hidden object is selected from the layer panel, keep `selectedObjectIds` for panel highlight but ensure `KonvaBoardCanvas` does not create transformer nodes for hidden objects. This was enforced in Task 6.

- [ ] **Step 5: Add CSS**

Add `.layer-panel`, `.layer-list`, `.layer-row`, and `.layer-row.is-selected` styles to `globals.css`. Use the same fixed right panel position as the board-management drawer, offset if both are open. Prefer only one of drawer/layer panel open at a time.

- [ ] **Step 6: Run validation**

Run: `npm run lint && npm run test && npm run build`

Expected: all pass.

- [ ] **Step 7: Commit**

```powershell
git add src/components/board-layers/LayerPanel.tsx src/components/BoardWorkspace.tsx src/components/ui/icons.ts src/app/globals.css
git commit -m "feat: add board layer panel"
```

---

### Task 8: Browser Smoke and Cleanup

**Files:**
- Modify only files needed to fix smoke findings.

- [ ] **Step 1: Run full validation**

Run:

```powershell
npm run lint
npm run test
npm run build
npm run smoke:board
```

Expected:

- lint passes.
- tests pass.
- build succeeds with only the known Vite chunk size warning.
- smoke creates/loads a board and captures a nonblank board screenshot.

- [ ] **Step 2: Start local dev server**

Run:

```powershell
npm run dev
```

Use the shown local URL, usually `http://localhost:5173`.

- [ ] **Step 3: Browser smoke ordinary user flow**

In browser:

1. Open `/login`.
2. Log in with an approved ordinary test user.
3. Confirm redirect goes to `/boards/:id`.
4. Open left menu.
5. Open board management drawer.
6. Create a new board.
7. Rename it.
8. Delete it.
9. Confirm fallback board loads if current board was deleted.

- [ ] **Step 4: Browser smoke admin flow**

In browser:

1. Log in as admin.
2. Confirm redirect goes to `/boards/:id`.
3. Open left menu.
4. Click management center.
5. Confirm `/admin` loads provider settings, AI platform login, pending users, and usage panel.

- [ ] **Step 5: Browser smoke creative flow**

In browser:

1. Open asset panel.
2. Favorite an asset.
3. Add tags with comma-separated input.
4. Filter by favorite/tag.
5. Open layer panel.
6. Hide a layer and confirm it disappears from canvas.
7. Lock a layer and confirm it cannot be moved or transformed.
8. Export visible objects and confirm hidden object is excluded.

- [ ] **Step 6: Remove dead menu entries**

Verify no first-slice menu entry is clickable unless implemented. Prompt history remains disabled or absent.

- [ ] **Step 7: Commit smoke fixes**

If smoke fixes were made:

```powershell
git add src/components src/client server prisma package.json
git commit -m "fix: polish board workspace management flow"
```

If no fixes were needed, do not create an empty commit.

---

## Plan Self-Review

- Spec coverage:
  - Login direct to recent board: Tasks 1 and 2.
  - Ordinary workspace removal: Task 2.
  - Admin center from menu: Tasks 2 and 3.
  - Board management drawer: Task 3.
  - Explicit ensure endpoint: Task 1.
  - Asset favorite/tags/search: Task 4.
  - Layer metadata and behavior: Tasks 5, 6, and 7.
  - Hidden/locked matrix: Tasks 6 and 7.
  - Validation and browser smoke: Task 8.
- Placeholder scan:
  - No `TBD` or unresolved placeholders.
  - Prompt history is intentionally disabled in Task 3 and verified in Task 8.
- Type consistency:
  - `BoardSummaryPayload`, `AssetPayload`, and board object metadata are introduced before downstream use.
  - Route names match the spec: `GET /api/boards/recent`, `POST /api/boards/ensure-recent`, and `PATCH /api/assets/:assetId`.
