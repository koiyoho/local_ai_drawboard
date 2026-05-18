# Board Workspace Navigation and Creation Loop Design

## Goal

Make the board page the primary product experience after login. Ordinary users should no longer land on a separate workspace page. They should log in, enter their most recently edited board, and manage boards, assets, layers, and creation history from inside the board workspace.

Admins should follow the same default creation flow, but get a left-menu entry to a management center for provider API settings, AI platform login, user review, and user usage controls.

This design chooses the first implementation slice as a minimum complete loop:

- Login routes users directly into the most recent board.
- The board's top-left menu becomes the global navigation surface.
- Board management moves into an in-board drawer.
- Admin management moves behind a menu-only admin entry.
- The board gains first-pass layer management, generation favorites, and asset tagging/search.

Broader professional editor features are captured as a roadmap, not part of the first implementation slice.

## Current Context

The current app uses:

- `/login` for login and registration.
- `/` for the workspace board list, provider settings, admin user review, usage controls, and Codex login card.
- `/boards/:id` for the Konva-based AI board workspace.
- Existing API routes for auth, boards, assets, provider settings, admin users, usage, generation jobs, and prompt assist.

Recent work already moved the board UI toward a creative workspace and standardized icon usage through `AppIcon` and semantic icon aliases.

## Selected Approach

Use the minimum complete loop approach.

Rejected alternatives:

- Navigation-only change: too small; it would not improve the board's creative workflow.
- Full professional editor in one pass: too large; it would combine navigation, admin, layers, undo/redo, snapping, templates, bulk export, and advanced AI controls into one risky change.

The first slice should be coherent and useful by itself while keeping the system easy to test.

## Login and Routing

After successful login, users go directly to a board.

Rules:

1. If the user has boards, redirect to the most recently updated board.
2. If the user has no boards, create a default board named `未命名画板` and redirect to it.
3. Ordinary users do not use the standalone workspace as their default product surface.
4. Admins also enter the most recent board by default.
5. Admin-only management remains available from the board's top-left menu.

Recommended APIs:

- `GET /api/boards/recent`
- `POST /api/boards/ensure-recent`

`GET /api/boards/recent` is read-only. It returns the most recently updated board for the authenticated user. If no board exists, it returns a no-board response such as `404` with `{ "error": "no_board" }`.

`POST /api/boards/ensure-recent` is the only endpoint that may create a default board as part of recent-board resolution. It returns the most recently updated board, or creates `未命名画板` when the user has no board. Login success, root redirect recovery, and deleted-current-board recovery should use this explicit mutation endpoint.

This split keeps reads idempotent and prevents accidental board creation from prefetches, retries, health checks, or page loads.

Route behavior:

- `/login`: login and registration only.
- `/boards/:id`: main authenticated product surface.
- `/`: for authenticated users, redirect to the recent board. For unauthenticated users, redirect to `/login`.
- `/admin`: admin management center. Ordinary users are redirected to their recent board with a non-sensitive permission message. Admin APIs still return `403` for ordinary users.

## Top-Left Board Menu

The current top-left board menu button becomes the global navigation entry.

Menu structure:

```text
AI Board
Current board: <board name>

Board
- New board
- Board management
- Rename current board
- Duplicate current board

Creation
- Layers
- Asset library
- Favorites
- Prompt history (deferred; do not show as enabled in the first slice)

Account
- Current account
- Sign out

Admin only
- Management center
- API settings
- AI platform login
- User management
```

First implementation can route several entries to existing panels or drawers. Entries that are intentionally not implemented yet should not appear as clickable dead controls. If a placeholder is needed, it should be visibly disabled with a concise title.

## Board Management Drawer

Board management moves from the standalone workspace into an in-board drawer.

Recommended presentation:

- Right-side drawer, because it preserves workspace context and matches the panel model already used by the board.
- Current board remains visible behind the drawer.
- Closing the drawer returns the user to the same board state.

Capabilities:

- List all boards.
- Highlight the current board.
- Search boards by name.
- Create a new board and navigate to it.
- Open a board.
- Rename a board.
- Duplicate a board.
- Delete a board with confirmation.

Implementation boundary:

- Board CRUD logic should be extracted from the current workspace list into shared client helpers or components that the drawer can use.
- The first implementation should not duplicate create, rename, duplicate, and delete behavior in both the old workspace and the drawer.
- Ordinary users should not keep a standalone board-list page as a primary UI. Existing workspace components may be reused internally or decomposed for the drawer/admin views.

Deletion rules:

- Deleting a non-current board only removes it from the list.
- Deleting the current board redirects to the next most recently updated board.
- If no boards remain, deletion returns success with no fallback board. The client then calls `POST /api/boards/ensure-recent` and redirects to the returned default board.

## Admin Management Center

Admins still land in the board workspace. The menu exposes "Management center".

Recommended route:

- `/admin`

First implementation should reuse existing components where possible:

- `ProviderSettingsForm` for API settings.
- `CodexLoginCard` for AI platform login.
- `AdminUserReview` for pending users.
- `AdminUsagePanel` for user status and usage quotas.

Admin center sections:

1. API settings
   - OpenAI-compatible provider display name.
   - Base URL.
   - API key.
   - Image model.
   - Prompt model.
   - Enable/disable state.

2. AI platform login
   - Existing Codex/OpenAI login status.
   - Login or re-login action.
   - No sensitive token display.

3. User management
   - Pending registration review.
   - Enable/disable user.
   - Delete user.
   - Total generation quota.
   - Five-hour quota.
   - Recent generation records.
   - Whether the user can use the admin provider.

Access control:

- Admin menu entries are visible only to admins.
- Admin APIs continue to enforce `requireAdminUser`.
- `/admin` redirects ordinary users to the recent board instead of rendering management data.
- `/admin` must not expose sensitive data to ordinary users during SSR, client bootstrap, or failed API responses.

## First-Slice Board Capabilities

### Layer Panel

Add an object-level layer panel for the current board.

Layer sources:

- Image objects.
- Paths and masks.
- Generated image objects.
- Reference/source objects when present on the canvas.

Capabilities:

- Select and focus a canvas object.
- Rename a layer.
- Delete a layer.
- Move layer up/down.
- Hide/show a layer.
- Lock/unlock a layer.

Persistence:

- Layer display name, hidden state, locked state, and object order live in the board snapshot.
- First implementation should use the existing object array order as z-order rather than adding a new database field.

Canvas behavior:

- Hidden layers are not rendered and are not exported.
- Locked layers are visible but cannot be dragged, resized, rotated, deleted from canvas shortcuts, or modified until unlocked.
- Locked layers can still be selected from the layer panel so the user can unlock them.

Hidden and locked acceptance matrix:

| Path | Hidden layer | Locked layer |
| --- | --- | --- |
| Canvas render | Not rendered | Rendered normally |
| Hit testing / pointer selection | Not selectable from canvas | Not selectable from canvas for transform/mutation; selectable from layer panel |
| Transformer handles | Not shown | Not shown |
| Drag / resize / rotate | Not possible | Not possible |
| Keyboard delete | Ignored | Ignored |
| Context menu delete | Not available | Not available |
| Context menu copy | Not available | Allowed only if it does not mutate the object |
| Layer panel select | Allowed, so users can unhide | Allowed, so users can unlock |
| Layer panel delete | Allowed after normal delete confirmation, because the panel is explicit management UI | Allowed after normal delete confirmation, because the panel is explicit management UI |
| Export | Excluded | Included |
| Snapshot save/load | Preserve `hidden` | Preserve `locked` |
| New generated placement | New objects default to visible | New objects default to unlocked |

Selecting a hidden layer from the layer panel is a panel-only metadata selection. It must not attach visible Konva transformer handles, focus the canvas to a non-rendered object, or expose canvas mutation controls until the layer is unhidden.

Out of scope for first slice:

- Groups.
- Multi-select operations.
- Alignment and distribution.
- Precision transform panel.
- Full undo/redo stack.

### Generation Favorites

Generated assets can be favorited.

Capabilities:

- Favorite/unfavorite from generation results or asset detail controls.
- Filter asset library by favorites.
- Use a favorite as a reference image.
- Place a favorite back onto the canvas.

Persistence:

- Add `Asset.isFavorite`.

Behavior:

- Favorite toggles should be optimistic but must roll back on API failure.
- Favorite state should not affect existing generation records or board snapshots.

### Asset Tags and Search

Add lightweight asset organization.

System tags:

- Source.
- Generated.
- Upload.
- Reference.
- Favorite.

User tags:

- Editable per asset.
- Stored as a small list of strings.
- First implementation should use a simple `tagsJson` field on `Asset` for speed and low schema complexity.
- Maximum 12 user tags per asset.
- Maximum 24 characters per tag after trimming.
- Empty tags are discarded.
- Duplicate tags are collapsed case-insensitively for display and storage.
- Tags may contain letters, numbers, Chinese characters, spaces, hyphens, and underscores.
- System tags are derived from asset metadata and cannot be edited by the user.
- Invalid or malformed `tagsJson` should be treated as an empty tag list and repaired on the next successful asset metadata update.

Search/filter:

- Asset name.
- Tags.
- Prompt text when available.
- Size.
- Asset kind.
- Favorite state.

API:

- `PATCH /api/assets/:id`

Supported first-slice updates:

- `isFavorite`
- `tags`

Asset renaming is not part of the first slice. If users need a display name, it should be derived from existing metadata until a later asset-management pass adds explicit naming.

## Data Model

Recommended first-slice schema changes:

- `Asset.isFavorite Boolean @default(false)`
- `Asset.tagsJson String?`

Snapshot object additions:

- `name?: string`
- `hidden?: boolean`
- `locked?: boolean`

Z-order:

- Use object array order in the board document.

`Board.updatedAt` continues to determine recent board ordering.

## Error Handling

Login and recent board:

- If recent board resolution fails, show a small error state with retry and sign-out.
- If the recent board was deleted, request a new recent board from the server.
- If a user has no board, the client calls `POST /api/boards/ensure-recent`; the server creates `未命名画板`.

Board drawer:

- Failed create/rename/duplicate/delete shows a non-blocking error.
- Delete current board follows the fallback rules above.
- Delete current board must not create a replacement board inside the delete request; replacement creation happens only through `POST /api/boards/ensure-recent`.

Layer panel:

- Hidden layers do not export.
- Locked layers do not mutate from canvas interactions.
- Layer operations save through the existing snapshot save path.

Favorites and tags:

- Failed updates roll back optimistic UI state.
- Tags are trimmed.
- Empty tags are discarded.
- Duplicate tags are collapsed case-insensitively for display.
- Tags that exceed validation limits are rejected with a field-level error.

Admin:

- Ordinary users visiting `/admin` are redirected to their recent board.
- Ordinary users cannot access admin APIs.
- Admin provider settings must not leak API key values.

## Testing

Automated tests:

- `GET /api/boards/recent` returns the most recently updated board without creating one.
- `GET /api/boards/recent` returns `no_board` when none exists.
- `POST /api/boards/ensure-recent` creates a default board when none exists.
- Login success redirects through recent board flow.
- Ordinary users visiting `/admin` are redirected to their recent board.
- Ordinary users cannot access admin APIs.
- Admin users can access management data.
- Board drawer actions create, rename, duplicate, and delete boards.
- Deleting current board chooses a fallback board.
- Asset patch updates favorite and tags.
- Asset patch validates max tag count, tag length, duplicates, and malformed stored JSON.
- Board document parsing accepts layer metadata.
- Hidden layers are excluded from export.
- Locked layers reject canvas mutation paths.

Manual/browser smoke:

- Login as ordinary user -> lands in recent board.
- Open left menu -> open board management drawer.
- Create/open/rename/delete board from drawer.
- Favorite a generated asset.
- Filter asset library by favorite/tag.
- Open layer panel -> hide/lock/reorder an object.
- Login as admin -> open management center from board menu.
- Update API settings and confirm image model list still loads.

Required commands before merge/deploy:

- `npm run lint`
- `npm run test`
- `npm run build`
- Existing board smoke script if the implementation touches board rendering.

## Implementation Milestones

The first slice should be implemented in reviewable milestones. Each milestone should leave the app buildable and should not depend on dead UI entries.

1. Navigation and admin shell
   - Add recent-board read and ensure endpoints.
   - Change login and root routing to enter the recent board.
   - Add `/admin` routing with ordinary-user redirect and admin-only data loading.
   - Move existing admin settings components into the admin route.

2. Board menu and board-management drawer
   - Turn the board titlebar menu into a functional global menu.
   - Extract reusable board CRUD helpers from the current workspace list.
   - Add in-board board management drawer.
   - Keep current-board deletion fallback behavior covered by tests.

3. Asset metadata
   - Add `Asset.isFavorite` and `Asset.tagsJson`.
   - Add `PATCH /api/assets/:id` for favorites and validated user tags.
   - Add favorite and tag filters to the asset UI.

4. Layer panel
   - Add layer metadata to board document parsing and persistence.
   - Add layer panel controls for select, rename, hide, lock, delete, and reorder.
   - Enforce hidden/locked behavior across render, interaction, context menu, keyboard, export, and snapshot paths.

5. Browser smoke and polish
   - Verify ordinary-user and admin flows.
   - Remove or disable any menu entries not implemented in the first slice.
   - Run required validation commands and board smoke checks.

## Roadmap After First Slice

Professional editing:

- True undo/redo history.
- Multi-select grouping.
- Alignment and distribution.
- Snapping guides.
- Precision transform panel.

AI workflow:

- Prompt version history.
- Local repaint history with before/after compare.
- Reference image role weights.
- Batch generation across multiple ratios.

Asset management:

- Bulk tag editing.
- Bulk export.
- Duplicate detection by image hash.
- Drag assets directly from drawer to canvas.

Production efficiency:

- Template system.
- Platform presets for Xiaohongshu, Douyin, video covers, banners, avatars.
- One-click layout application.
- Favorite sizes and ratio presets.

Collaboration:

- Version snapshots.
- Comments and review annotations.
- Realtime collaboration if product usage justifies it.

## Open Decisions Resolved

- Login target: most recently edited board.
- Ordinary user workspace: no standalone workspace as primary UI.
- Board management: in-board drawer.
- Admin entry: board left menu.
- First implementation scope: minimum complete loop plus layer panel, generation favorites, and asset tags/search.
