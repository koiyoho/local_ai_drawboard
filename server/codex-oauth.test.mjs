import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const moduleUrl = new URL("../dist/server/server/lib/codex-oauth.js", import.meta.url);

async function withTempCodexDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "codex-oauth-test-"));
  const previous = process.env.CODEX_OAUTH_DATA_DIR;
  process.env.CODEX_OAUTH_DATA_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    if (previous === undefined) {
      delete process.env.CODEX_OAUTH_DATA_DIR;
    } else {
      process.env.CODEX_OAUTH_DATA_DIR = previous;
    }
    await rm(dir, { force: true, recursive: true });
  }
}

function encodedJwt(claims) {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.`;
}

test("buildCodexAuthorizeUrl includes required Codex OAuth parameters", async () => {
  const { buildCodexAuthorizeUrl } = await import(moduleUrl);
  const url = buildCodexAuthorizeUrl({
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    codeChallenge: "challenge",
    issuer: "https://auth.openai.com",
    redirectUri: "https://example.com/api/codex-auth/callback",
    state: "state-1",
  });
  const parsed = new URL(url);

  assert.equal(parsed.origin, "https://auth.openai.com");
  assert.equal(parsed.pathname, "/oauth/authorize");
  assert.equal(parsed.searchParams.get("response_type"), "code");
  assert.equal(parsed.searchParams.get("client_id"), "app_EMoamEEZ73f0CkXaXp7hrann");
  assert.equal(parsed.searchParams.get("redirect_uri"), "https://example.com/api/codex-auth/callback");
  assert.equal(parsed.searchParams.get("code_challenge"), "challenge");
  assert.equal(parsed.searchParams.get("code_challenge_method"), "S256");
  assert.equal(parsed.searchParams.get("state"), "state-1");
  assert.equal(parsed.searchParams.get("codex_cli_simplified_flow"), "true");
});

test("parseJwtAuthClaims prefers nested OpenAI auth claims", async () => {
  const { parseJwtAuthClaims } = await import(moduleUrl);
  const claims = parseJwtAuthClaims(
    encodedJwt({
      email: "user@example.com",
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_1",
        chatgpt_plan_type: "plus",
      },
    }),
  );

  assert.deepEqual(claims, {
    chatgpt_account_id: "acct_1",
    chatgpt_plan_type: "plus",
  });
});

test("readCodexAuthStatus returns only non-sensitive account summary", async () => {
  const { readCodexAuthStatus } = await import(moduleUrl);

  await withTempCodexDir(async (dir) => {
    await writeFile(
      path.join(dir, "codex-auth.json"),
      JSON.stringify({
        authMode: "chatgpt",
        clientId: "client",
        issuer: "issuer",
        lastLoginAt: "2026-05-12T00:00:00.000Z",
        openaiApiKey: "sk-secret",
        tokens: {
          accessToken: "access-secret",
          accountId: "acct_1",
          idToken: "id-secret",
          idTokenClaims: {
            chatgpt_plan_type: "plus",
            organization_id: "org_1",
            project_id: "proj_1",
          },
          refreshToken: "refresh-secret",
        },
      }),
      "utf8",
    );

    const status = await readCodexAuthStatus();
    const serialized = JSON.stringify(status);
    assert.equal(status.accountId, "acct_1");
    assert.equal(status.connected, true);
    assert.equal(status.hasApiKey, true);
    assert.equal(status.lastLoginAt, "2026-05-12T00:00:00.000Z");
    assert.equal(status.mode, "chatgpt");
    assert.equal(status.organizationId, "org_1");
    assert.equal(status.planType, "plus");
    assert.equal(status.projectId, "proj_1");
    assert.equal(serialized.includes("access-secret"), false);
    assert.equal(serialized.includes("refresh-secret"), false);
    assert.equal(serialized.includes("id-secret"), false);
    assert.equal(serialized.includes("sk-secret"), false);
  });
});

test("readCodexAuthStatus supports imported Codex CLI API key auth", async () => {
  const { readCodexAuthStatus } = await import(moduleUrl);

  await withTempCodexDir(async (dir) => {
    await writeFile(
      path.join(dir, "codex-auth.json"),
      JSON.stringify({
        auth_mode: "apikey",
        OPENAI_API_KEY: "sk-secret",
      }),
      "utf8",
    );

    const status = await readCodexAuthStatus();
    const serialized = JSON.stringify(status);
    assert.equal(status.connected, true);
    assert.equal(status.hasApiKey, true);
    assert.equal(status.mode, "apikey");
    assert.equal(serialized.includes("sk-secret"), false);
  });
});

test("importCodexAuthJson accepts Codex CLI API key auth without auth_mode", async () => {
  const { importCodexAuthJson, readSavedCodexAuth, readCodexAuthStatus } = await import(moduleUrl);

  await withTempCodexDir(async () => {
    const status = await importCodexAuthJson(JSON.stringify({
      OPENAI_API_KEY: " sk-codex-official-json ",
    }));
    const saved = await readSavedCodexAuth();
    const rereadStatus = await readCodexAuthStatus();

    assert.equal(status.connected, true);
    assert.equal(status.hasApiKey, true);
    assert.equal(status.mode, "apikey");
    assert.equal(saved.OPENAI_API_KEY, "sk-codex-official-json");
    assert.equal(saved.auth_mode, "apikey");
    assert.equal(rereadStatus.mode, "apikey");
    assert.equal(JSON.stringify(status).includes("sk-codex-official-json"), false);
  });
});

test("importCodexAuthJson accepts Codex CLI ChatGPT auth.json token format", async () => {
  const { importCodexAuthJson, readSavedCodexAuth, readCodexAuthStatus } = await import(moduleUrl);
  const idToken = fakeJwt({
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acct_cli",
      chatgpt_plan_type: "plus",
      organization_id: "org_cli",
      project_id: "proj_cli",
    },
  });

  await withTempCodexDir(async () => {
    const status = await importCodexAuthJson(JSON.stringify({
      auth_mode: "chatgpt",
      last_refresh: "2026-05-18T00:00:00.000Z",
      tokens: {
        access_token: "access-secret",
        id_token: idToken,
        refresh_token: "refresh-secret",
      },
    }));
    const saved = await readSavedCodexAuth();
    const rereadStatus = await readCodexAuthStatus();

    assert.equal(status.connected, true);
    assert.equal(status.mode, "chatgpt");
    assert.equal(status.accountId, "acct_cli");
    assert.equal(status.organizationId, "org_cli");
    assert.equal(status.planType, "plus");
    assert.equal(status.projectId, "proj_cli");
    assert.equal(saved.authMode, "chatgpt");
    assert.equal(saved.tokens.accessToken, "access-secret");
    assert.equal(saved.tokens.idToken, idToken);
    assert.equal(saved.tokens.refreshToken, "refresh-secret");
    assert.equal(saved.tokens.accountId, "acct_cli");
    assert.equal(rereadStatus.accountId, "acct_cli");
    assert.equal(JSON.stringify(status).includes("access-secret"), false);
    assert.equal(JSON.stringify(status).includes("refresh-secret"), false);
  });
});

test("importCodexAuthJson accepts Codex CLI ChatGPT token format without auth_mode", async () => {
  const { importCodexAuthJson, readSavedCodexAuth } = await import(moduleUrl);
  const idToken = fakeJwt({
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acct_tokens_only",
    },
  });

  await withTempCodexDir(async () => {
    await importCodexAuthJson(JSON.stringify({
      tokens: {
        access_token: "access-secret",
        id_token: idToken,
        refresh_token: "refresh-secret",
      },
    }));
    const saved = await readSavedCodexAuth();

    assert.equal(saved.authMode, "chatgpt");
    assert.equal(saved.tokens.accountId, "acct_tokens_only");
    assert.equal(saved.tokens.accessToken, "access-secret");
  });
});

test("OAuth callback saves account login without treating token exchange as Images API key", async () => {
  const {
    clearPendingOAuthState,
    handleCodexCallback,
    readCodexAuthStatus,
    readSavedCodexAuth,
    writePendingOAuthState,
  } = await import(moduleUrl);
  const previousAuthSecret = process.env.AUTH_SECRET;
  const previousFetch = globalThis.fetch;
  process.env.AUTH_SECRET = "codex-oauth-test-secret";
  const idToken = fakeJwt({
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acct_oauth",
      chatgpt_plan_type: "plus",
    },
  });

  await withTempCodexDir(async () => {
    const issuedAt = Date.now();
    const nonce = "oauth-test-nonce";
    const userId = "admin";
    const proof = createHmac("sha256", process.env.AUTH_SECRET)
      .update(`${userId}.${issuedAt}.${nonce}`)
      .digest("base64url");

    await writePendingOAuthState({
      adminProof: { issuedAt, nonce, proof, userId },
      codeVerifier: "verifier",
      createdAt: new Date().toISOString(),
      redirectUri: "https://example.com/api/codex-auth/callback",
      returnUrl: "https://example.com/",
      state: "expected-state",
    });

    globalThis.fetch = async (_url, init) => {
      const body = new URLSearchParams(String(init?.body ?? ""));
      if (body.get("grant_type") === "authorization_code") {
        return new Response(JSON.stringify({
          access_token: "oauth-access-secret",
          id_token: idToken,
          refresh_token: "oauth-refresh-secret",
        }), { headers: { "Content-Type": "application/json" }, status: 200 });
      }
      if (body.get("requested_token") === "openai-api-key") {
        return new Response(JSON.stringify({ access_token: "sk-should-not-be-saved" }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      return new Response("unexpected token request", { status: 400 });
    };

    try {
      const result = await handleCodexCallback(
        new URL("https://example.com/api/codex-auth/callback?state=expected-state&code=abc"),
      );
      const saved = await readSavedCodexAuth();
      const status = await readCodexAuthStatus();

      assert.equal(result.status, 200);
      assert.equal(saved.authMode, "chatgpt");
      assert.equal(saved.openaiApiKey, undefined);
      assert.equal(status.connected, true);
      assert.equal(status.hasApiKey, false);
      assert.equal(status.mode, "chatgpt");
    } finally {
      globalThis.fetch = previousFetch;
      await clearPendingOAuthState();
    }
  });

  if (previousAuthSecret === undefined) {
    delete process.env.AUTH_SECRET;
  } else {
    process.env.AUTH_SECRET = previousAuthSecret;
  }
});

test("callback state mismatch clears pending state and does not write auth", async () => {
  const {
    clearPendingOAuthState,
    handleCodexCallback,
    readPendingOAuthState,
    writePendingOAuthState,
  } = await import(moduleUrl);

  await withTempCodexDir(async (dir) => {
    await writePendingOAuthState({
      adminProof: {
        issuedAt: Date.now(),
        nonce: "nonce",
        proof: "proof",
        userId: "admin",
      },
      codeVerifier: "verifier",
      createdAt: new Date().toISOString(),
      redirectUri: "https://example.com/api/codex-auth/callback",
      returnUrl: "https://example.com/",
      state: "expected-state",
    });

    const result = await handleCodexCallback(
      new URL("https://example.com/api/codex-auth/callback?state=wrong&code=abc"),
    );

    assert.equal(result.status, 400);
    assert.equal(await readPendingOAuthState(), null);
    await assert.rejects(readFile(path.join(dir, "codex-auth.json"), "utf8"));
    await clearPendingOAuthState();
  });
});

function fakeJwt(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".");
}
