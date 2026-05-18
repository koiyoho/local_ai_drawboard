import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { createServer, type Server } from "node:http";
import path from "node:path";

export const codexOAuthIssuer = "https://auth.openai.com";
export const codexOAuthClientId = "app_EMoamEEZ73f0CkXaXp7hrann";

const callbackPort = 1455;
const localCallbackPath = "/auth/callback";
const localRedirectUri = `http://localhost:${callbackPort}${localCallbackPath}`;
const pendingStateMaxAgeMs = 10 * 60 * 1000;
const adminProofMaxAgeMs = 10 * 60 * 1000;

type AdminSessionProof = {
  issuedAt: number;
  nonce: string;
  proof: string;
  userId: string;
};

export type PendingCodexOAuth = {
  adminProof: AdminSessionProof;
  codeVerifier: string;
  createdAt: string;
  redirectUri: string;
  returnUrl: string;
  state: string;
};

type CodexTokenResponse = {
  access_token: string;
  id_token: string;
  refresh_token: string;
};

type SavedCodexAuth = {
  authMode: "chatgpt";
  clientId: string;
  issuer: string;
  lastLoginAt: string;
  openaiApiKey?: string;
  tokens: {
    accessToken: string;
    accountId?: string;
    idToken: string;
    idTokenClaims: Record<string, unknown>;
    refreshToken: string;
  };
};

type CodexApiKeyAuth = {
  OPENAI_API_KEY: string;
  auth_mode?: "apikey";
};

type CodexCliChatGptTokens = {
  access_token: string;
  account_id?: string;
  id_token: string;
  refresh_token: string;
};

type CodexCliChatGptAuth = {
  auth_mode?: "chatgpt";
  last_refresh?: string;
  openai_api_key?: string;
  tokens: CodexCliChatGptTokens;
};

type CodexCallbackServerGlobal = typeof globalThis & {
  __codexOAuthCallbackServer?: Server;
};

export type CodexAuthorizeInput = {
  clientId: string;
  codeChallenge: string;
  issuer: string;
  redirectUri: string;
  state: string;
};

export type StartCodexOAuthInput = {
  adminUserId: string;
  requestOrigin: string;
};

export class CodexOAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexOAuthConfigError";
  }
}

export function buildCodexAuthorizeUrl(input: CodexAuthorizeInput) {
  const authorizeUrl = new URL("/oauth/authorize", input.issuer);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", input.clientId);
  authorizeUrl.searchParams.set("redirect_uri", input.redirectUri);
  authorizeUrl.searchParams.set(
    "scope",
    "openid profile email offline_access api.connectors.read api.connectors.invoke",
  );
  authorizeUrl.searchParams.set("code_challenge", input.codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("id_token_add_organizations", "true");
  authorizeUrl.searchParams.set("codex_cli_simplified_flow", "true");
  authorizeUrl.searchParams.set("prompt", "login");
  authorizeUrl.searchParams.set("state", input.state);
  return authorizeUrl.toString();
}

export async function createCodexAuthorizeUrl(input: StartCodexOAuthInput) {
  const redirectUri = getCodexRedirectUri();
  if (isLocalCallbackMode()) {
    await ensureCodexCallbackServer();
  }

  const codeVerifier = randomBase64Url(64);
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const state = randomBase64Url(32);
  const adminProof = createAdminSessionProof(input.adminUserId);

  await writePendingOAuthState({
    adminProof,
    codeVerifier,
    createdAt: new Date().toISOString(),
    redirectUri,
    returnUrl: input.requestOrigin,
    state,
  });

  return buildCodexAuthorizeUrl({
    clientId: codexOAuthClientId,
    codeChallenge,
    issuer: codexOAuthIssuer,
    redirectUri,
    state,
  });
}

export async function readCodexAuthStatus() {
  const auth = await readSavedCodexAuth();
  if (!auth) {
    return {
      connected: false as const,
      importSourceAvailable: await canImportCodexCliAuth(),
      mode: getCodexAuthMode(),
      startAvailable: isCodexOAuthStartAvailable(),
      startDisabledReason: getCodexOAuthStartDisabledReason(),
    };
  }

  if (isCodexApiKeyAuth(auth)) {
    return {
      accountId: null,
      connected: true as const,
      hasApiKey: true,
      importSourceAvailable: await canImportCodexCliAuth(),
      lastLoginAt: null,
      mode: "apikey" as const,
      organizationId: null,
      planType: null,
      projectId: null,
      startAvailable: isCodexOAuthStartAvailable(),
      startDisabledReason: getCodexOAuthStartDisabledReason(),
    };
  }

  return {
    accountId: auth.tokens.accountId ?? null,
    connected: true as const,
    hasApiKey: Boolean(auth.openaiApiKey),
    importSourceAvailable: await canImportCodexCliAuth(),
    lastLoginAt: auth.lastLoginAt,
    mode: "chatgpt" as const,
    organizationId: getStringClaim(auth.tokens.idTokenClaims, "organization_id"),
    planType: getStringClaim(auth.tokens.idTokenClaims, "chatgpt_plan_type"),
    projectId: getStringClaim(auth.tokens.idTokenClaims, "project_id"),
    startAvailable: isCodexOAuthStartAvailable(),
    startDisabledReason: getCodexOAuthStartDisabledReason(),
  };
}

export async function importCodexCliAuth() {
  const sourcePath = getCodexCliAuthPath();
  const raw = await readFile(sourcePath, "utf8");
  const parsed = parseCodexAuthJson(raw);
  await ensureCodexAuthDir();
  await writeFile(codexAuthPath(), `${JSON.stringify(parsed, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return readCodexAuthStatus();
}

export async function importCodexAuthJson(raw: string) {
  const parsed = parseCodexAuthJson(raw);
  await ensureCodexAuthDir();
  await writeFile(codexAuthPath(), `${JSON.stringify(parsed, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return readCodexAuthStatus();
}

export async function handleCodexCallback(requestUrl: URL) {
  const pending = await readPendingOAuthState();
  if (!pending) {
    return {
      body: renderCallbackPage(
        "Codex 登录失败",
        "未找到本项目发起的登录状态，请从工作台重新打开登录入口。",
        "/",
      ),
      status: 400,
    };
  }

  const fail = async (message: string, status = 400) => {
    await clearPendingOAuthState();
    return {
      body: renderCallbackPage("Codex 登录失败", escapeHtml(message), pending.returnUrl),
      status,
    };
  };

  const callbackState = requestUrl.searchParams.get("state");
  if (!callbackState || callbackState !== pending.state) {
    return fail("登录回调状态不匹配，请重新发起登录。");
  }

  if (isPendingExpired(pending)) {
    return fail("登录状态已过期，请重新发起登录。");
  }

  if (!verifyAdminSessionProof(pending.adminProof)) {
    return fail("管理员会话证明无效，请重新发起登录。", 403);
  }

  const oauthError = requestUrl.searchParams.get("error");
  if (oauthError) {
    return fail(requestUrl.searchParams.get("error_description") || oauthError);
  }

  const code = requestUrl.searchParams.get("code");
  if (!code) {
    return fail("登录回调缺少授权 code。");
  }

  try {
    const tokens = await exchangeCodeForTokens(code, pending.codeVerifier, pending.redirectUri);
    const idTokenClaims = parseJwtAuthClaims(tokens.id_token);

    await writeSavedCodexAuth({
      authMode: "chatgpt",
      clientId: codexOAuthClientId,
      issuer: codexOAuthIssuer,
      lastLoginAt: new Date().toISOString(),
      tokens: {
        accessToken: tokens.access_token,
        accountId: getStringClaim(idTokenClaims, "chatgpt_account_id") ?? undefined,
        idToken: tokens.id_token,
        idTokenClaims,
        refreshToken: tokens.refresh_token,
      },
    });
    await clearPendingOAuthState();

    return {
      body: renderCallbackPage(
        "Codex 登录已保存",
        "OAuth 登录信息已保存到项目本地 .codex/codex-auth.json。",
        pending.returnUrl,
      ),
      status: 200,
    };
  } catch (error) {
    return fail(toSafeOAuthError(error), 502);
  }
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri = getCodexRedirectUri(),
) {
  const body = new URLSearchParams({
    client_id: codexOAuthClientId,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  const response = await fetch(`${codexOAuthIssuer}/oauth/token`, {
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`OAuth token exchange failed with status ${response.status}: ${await response.text()}`);
  }

  return (await response.json()) as CodexTokenResponse;
}

export async function writePendingOAuthState(state: PendingCodexOAuth) {
  await ensureCodexAuthDir();
  await writeFile(codexOAuthStatePath(), `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function readPendingOAuthState() {
  try {
    return JSON.parse(await readFile(codexOAuthStatePath(), "utf8")) as PendingCodexOAuth;
  } catch {
    return null;
  }
}

export async function clearPendingOAuthState() {
  await rm(codexOAuthStatePath(), { force: true });
}

export async function writeSavedCodexAuth(auth: SavedCodexAuth) {
  await ensureCodexAuthDir();
  await writeFile(codexAuthPath(), `${JSON.stringify(auth, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function readSavedCodexAuth() {
  try {
    return JSON.parse(await readFile(codexAuthPath(), "utf8")) as SavedCodexAuth;
  } catch {
    return null;
  }
}

export async function readCodexApiKey() {
  const auth = await readSavedCodexAuth();
  if (!auth) return null;
  if (isCodexApiKeyAuth(auth)) return auth.OPENAI_API_KEY;
  return auth.openaiApiKey ?? null;
}

export function parseJwtAuthClaims(jwt: string) {
  const [, payload] = jwt.split(".");
  if (!payload) {
    return {};
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const nestedClaims = decoded["https://api.openai.com/auth"];
    return isRecord(nestedClaims) ? nestedClaims : decoded;
  } catch {
    return {};
  }
}

function getCodexRedirectUri() {
  if (isLocalCallbackMode()) {
    return localRedirectUri;
  }

  const configured = process.env.CODEX_OAUTH_REDIRECT_URI?.trim();
  if (!configured) {
    throw new CodexOAuthConfigError(
      "CODEX_OAUTH_REDIRECT_URI is required for Codex OAuth remote callback mode. Set it to the exact registered callback URL, for example https://example.com/api/codex-auth/callback, or set CODEX_OAUTH_LOCAL_CALLBACK=1 for local-only callback mode.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new CodexOAuthConfigError("CODEX_OAUTH_REDIRECT_URI must be an absolute HTTP or HTTPS URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new CodexOAuthConfigError("CODEX_OAUTH_REDIRECT_URI must use HTTP or HTTPS.");
  }
  return parsed.toString();
}

function isLocalCallbackMode() {
  return process.env.CODEX_OAUTH_LOCAL_CALLBACK === "1";
}

export function getCodexAuthMode() {
  return isLocalCallbackMode() ? "local-oauth" : "remote-oauth";
}

export function isCodexOAuthStartAvailable() {
  return isLocalCallbackMode() || Boolean(process.env.CODEX_OAUTH_REDIRECT_URI?.trim());
}

export function getCodexOAuthStartDisabledReason() {
  if (isCodexOAuthStartAvailable()) return null;
  return "官方 Codex OAuth 使用固定的本机 CLI 回调地址，线上公网回调不可用。请上传或粘贴本机 Codex CLI 的 auth.json。";
}

function createAdminSessionProof(userId: string): AdminSessionProof {
  const issuedAt = Date.now();
  const nonce = randomBase64Url(32);
  return {
    issuedAt,
    nonce,
    proof: signAdminSessionProof(userId, issuedAt, nonce),
    userId,
  };
}

function verifyAdminSessionProof(adminProof: AdminSessionProof) {
  if (!adminProof.userId || !adminProof.nonce || !adminProof.proof) return false;
  if (Date.now() - adminProof.issuedAt > adminProofMaxAgeMs) return false;

  const expected = signAdminSessionProof(adminProof.userId, adminProof.issuedAt, adminProof.nonce);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(adminProof.proof);
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function signAdminSessionProof(userId: string, issuedAt: number, nonce: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new CodexOAuthConfigError("AUTH_SECRET is required for Codex OAuth admin proof signing.");
  return createHmac("sha256", secret)
    .update(`${userId}.${issuedAt}.${nonce}`)
    .digest("base64url");
}

function isPendingExpired(pending: PendingCodexOAuth) {
  const createdAt = Date.parse(pending.createdAt);
  return !Number.isFinite(createdAt) || Date.now() - createdAt > pendingStateMaxAgeMs;
}

async function ensureCodexCallbackServer() {
  const globalWithServer = globalThis as CodexCallbackServerGlobal;
  if (globalWithServer.__codexOAuthCallbackServer?.listening) {
    return;
  }

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", localRedirectUri);
      if (requestUrl.pathname !== localCallbackPath) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not Found");
        return;
      }

      const result = await handleCodexCallback(requestUrl);
      response.writeHead(result.status, { "Content-Type": "text/html; charset=utf-8" });
      response.end(result.body);
    } catch (error) {
      const message = toSafeOAuthError(error);
      response.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      response.end(renderCallbackPage("Codex 登录失败", escapeHtml(message), "/"));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(callbackPort, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  globalWithServer.__codexOAuthCallbackServer = server;
}

function codexAuthDir() {
  return process.env.CODEX_OAUTH_DATA_DIR?.trim() || path.join(process.cwd(), ".codex");
}

function codexAuthPath() {
  return path.join(codexAuthDir(), "codex-auth.json");
}

function codexOAuthStatePath() {
  return path.join(codexAuthDir(), "codex-oauth-state.json");
}

function getCodexCliAuthPath() {
  return process.env.CODEX_CLI_AUTH_PATH?.trim() || path.join(os.homedir(), ".codex", "auth.json");
}

async function ensureCodexAuthDir() {
  await mkdir(codexAuthDir(), { recursive: true, mode: 0o700 });
}

function getStringClaim(claims: Record<string, unknown>, key: string) {
  const value = claims[key];
  return typeof value === "string" && value ? value : null;
}

function randomBase64Url(size: number) {
  return randomBytes(size).toString("base64url");
}

function toSafeOAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : "Codex OAuth callback failed";
  return message
    .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
    .replace(/refresh_token=[^&\s]+/gi, "refresh_token=[redacted]")
    .replace(/id_token=[^&\s]+/gi, "id_token=[redacted]")
    .replace(/code_verifier=[^&\s]+/gi, "code_verifier=[redacted]");
}

function renderCallbackPage(title: string, message: string, returnUrl: string) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f7f2; color: #1b2118; }
      main { width: min(420px, calc(100vw - 32px)); border: 1px solid #d9e2d4; border-radius: 12px; background: #fff; padding: 24px; }
      h1 { font-size: 22px; margin: 0 0 10px; }
      p { color: #5e6759; line-height: 1.5; margin: 0 0 18px; }
      a { align-items: center; background: #2f6b43; border-radius: 8px; color: #fff; display: inline-flex; font-weight: 750; min-height: 40px; padding: 0 14px; text-decoration: none; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${message}</p>
      <a href="${escapeHtml(returnUrl)}">返回工作台</a>
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function canImportCodexCliAuth() {
  try {
    const raw = await readFile(getCodexCliAuthPath(), "utf8");
    parseCodexAuthJson(raw);
    return true;
  } catch {
    return false;
  }
}

function parseCodexAuthJson(raw: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CodexOAuthConfigError("Codex auth.json 不是有效 JSON");
  }
  const normalized = normalizeCodexAuth(parsed);
  if (!normalized) {
    throw new CodexOAuthConfigError("未识别的 Codex auth.json 格式");
  }
  return normalized;
}

function normalizeCodexAuth(value: unknown): CodexApiKeyAuth | SavedCodexAuth | null {
  if (isCodexApiKeyAuth(value)) {
    return {
      OPENAI_API_KEY: value.OPENAI_API_KEY.trim(),
      auth_mode: "apikey",
    };
  }
  if (isSavedCodexOAuth(value)) return value;
  if (!isCodexCliChatGptAuth(value)) return null;

  const idTokenClaims = parseJwtAuthClaims(value.tokens.id_token);
  return {
    authMode: "chatgpt",
    clientId: codexOAuthClientId,
    issuer: codexOAuthIssuer,
    lastLoginAt: value.last_refresh || new Date().toISOString(),
    openaiApiKey: value.openai_api_key?.trim() || undefined,
    tokens: {
      accessToken: value.tokens.access_token,
      accountId: value.tokens.account_id || getStringClaim(idTokenClaims, "chatgpt_account_id") || undefined,
      idToken: value.tokens.id_token,
      idTokenClaims,
      refreshToken: value.tokens.refresh_token,
    },
  };
}

function isCodexApiKeyAuth(value: unknown): value is CodexApiKeyAuth {
  return isRecord(value)
    && (value.auth_mode === undefined || value.auth_mode === "apikey")
    && typeof value.OPENAI_API_KEY === "string"
    && value.OPENAI_API_KEY.trim().length > 0;
}

function isSavedCodexOAuth(value: unknown): value is SavedCodexAuth {
  return isRecord(value)
    && value.authMode === "chatgpt"
    && isRecord(value.tokens)
    && typeof value.tokens.accessToken === "string"
    && typeof value.tokens.idToken === "string"
    && typeof value.tokens.refreshToken === "string";
}

function isCodexCliChatGptAuth(value: unknown): value is CodexCliChatGptAuth {
  return isRecord(value)
    && (value.auth_mode === undefined || value.auth_mode === "chatgpt")
    && isRecord(value.tokens)
    && typeof value.tokens.access_token === "string"
    && value.tokens.access_token.trim().length > 0
    && typeof value.tokens.id_token === "string"
    && value.tokens.id_token.trim().length > 0
    && typeof value.tokens.refresh_token === "string"
    && value.tokens.refresh_token.trim().length > 0;
}
