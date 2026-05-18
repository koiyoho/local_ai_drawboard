## 1. Dependencies and Configuration

- [x] 1.1 Add Auth.js Credentials provider support and password hashing dependencies using the existing npm workflow.
- [x] 1.2 Add required environment variables to `.env.example` for app URL and Auth.js secret.
- [x] 1.3 Create `auth.ts` with Auth.js Credentials configuration, session access exports, and local username/password verification.
- [x] 1.4 Add `src/app/api/auth/[...nextauth]/route.ts` to expose Auth.js GET and POST handlers.

## 2. Database Model and Initialization

- [x] 2.1 Extend `prisma/schema.prisma` with Auth.js models: `User`, `Account`, `Session`, and `VerificationToken`.
- [x] 2.2 Add `ProviderSetting` model with user ownership, OpenAI-compatible provider fields, enabled state, and timestamps.
- [x] 2.3 Add user ownership to `Board` and update relations so board-scoped data is reachable through the owner.
- [x] 2.4 Update `scripts/init-db.mjs` to create the new auth, provider setting, and user ownership tables/indexes.
- [x] 2.5 Add a deterministic local migration or reinitialization path for existing boards without owners.

## 3. Auth Helpers and Route Protection

- [x] 3.1 Create server-side helpers for requiring the current user and loading a board owned by that user.
- [x] 3.2 Protect the home page so unauthenticated users see a login entry and authenticated users see only their boards.
- [x] 3.3 Protect board workspace page loading so users cannot open another user's board.
- [x] 3.4 Update board list, create, detail, rename, duplicate, delete, and snapshot APIs to scope all queries by current user.
- [x] 3.5 Update assets, asset file, exports, and generation APIs to reject unauthenticated requests and verify board ownership.

## 4. Login and Account UI

- [x] 4.1 Add login and logout controls using Auth.js server actions or route-backed forms.
- [x] 4.2 Add authenticated account status to the existing home or shell UI without changing the board workflow.
- [x] 4.3 Ensure unauthenticated API errors and page states show actionable login messaging.

## 5. Provider Settings

- [x] 5.1 Add provider settings API for reading redacted settings and saving or disabling the authenticated user's active setting.
- [x] 5.2 Validate provider display name, API key, optional base URL, and image model with the existing zod-based API style.
- [x] 5.3 Add provider settings UI for entering OpenAI-compatible API key, base URL, and image model.
- [x] 5.4 Ensure provider settings responses never include the raw API key.

## 6. Generation Integration

- [x] 6.1 Refactor `src/lib/openai.ts` to create an OpenAI-compatible client from a supplied provider setting instead of a global singleton.
- [x] 6.2 Update `POST /api/generation-jobs` to load the authenticated user's active provider setting before creating a job.
- [x] 6.3 Reject generation requests when the current user has no active provider setting.
- [x] 6.4 Record provider setting metadata and model in `GenerationJob.paramsJson` without storing API keys.

## 7. Verification and Documentation

- [x] 7.1 Run Prisma client generation and database initialization against the updated schema.
- [x] 7.2 Run lint and production build using the existing npm scripts.
- [x] 7.3 Add and run local smoke coverage for unauthenticated API rejection, authenticated board CRUD, board ownership isolation, provider setting save/read redaction, and generation provider selection.
- [x] 7.4 Update README and verification docs with local account setup, provider setting setup, local migration behavior, and test results.

## 8. Admin Review and API Authorization Revision

- [x] 8.1 Add user review fields: `role`, `status`, `canUseAdminProvider`, approval metadata, and registration timestamps.
- [x] 8.2 Make registration create `pending` users without automatic login and return duplicate username / pending / rejected login messages.
- [x] 8.3 Mark username `koiyoho` as fixed `admin + approved` during database initialization without migrating `local-default-user` boards.
- [x] 8.4 Add admin-only pending-user review API for approve/reject and API authorization.
- [x] 8.5 Add home-page user review UI visible only to `koiyoho`.
- [x] 8.6 Update generation provider selection to prefer the user's provider, then authorized `koiyoho` provider, and otherwise reject with the configured API guidance.
- [x] 8.7 Expand smoke coverage for pending/rejected login, admin approval with/without API authorization, normal-user review API denial, provider redaction, and admin-provider generation.
- [x] 8.8 Update README, OpenSpec, verification, operations, and testing records for the admin review behavior.
