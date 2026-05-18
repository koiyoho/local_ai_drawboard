import assert from "node:assert/strict";
import test from "node:test";

(globalThis as typeof globalThis & { __AIBOARD_API_BASE_URL__?: string }).__AIBOARD_API_BASE_URL__ =
  "";

test("ensureRecentBoard posts without forcing an empty JSON body", async () => {
  const calls: Array<{ init?: RequestInit; path: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path: String(input), init });
    return new Response(JSON.stringify({ board: { id: "board-id", name: "Board", updatedAt: "" } }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }) as typeof fetch;

  try {
    const { ensureRecentBoard } = await import("./api");
    await ensureRecentBoard();
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/boards/ensure-recent");
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(calls[0].init?.body, undefined);
  assert.equal(calls[0].init?.headers, undefined);
});
