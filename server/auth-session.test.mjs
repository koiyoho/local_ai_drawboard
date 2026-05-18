import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";
import test from "node:test";

function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verify(token, secret) {
  const [body, signature] = token.split(".");
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (!signature || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
}

test("signed session round-trips user id", () => {
  const token = sign({ expiresAt: Date.now() + 1000, userId: "user-1" }, "secret");
  assert.equal(verify(token, "secret").userId, "user-1");
});

test("tampered session is rejected", () => {
  const token = sign({ expiresAt: Date.now() + 1000, userId: "user-1" }, "secret");
  assert.equal(verify(`${token.slice(0, -1)}x`, "secret"), null);
});
