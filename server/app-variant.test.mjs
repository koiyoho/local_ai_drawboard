import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

process.env.AUTH_SECRET = "test-secret";
process.env.DATABASE_URL = `file:./tmp/app-variant-${randomUUID()}.db`;
process.env.APP_VARIANT = "local";

execFileSync("node", ["scripts/init-db.mjs"], { cwd: process.cwd(), stdio: "ignore" });

const { prisma } = await import("../dist/server/src/lib/prisma.js");
const { createApp } = await import("../dist/server/server/app.js");

test("local variant exposes a deterministic local user without a session", async () => {
  const app = await createApp();
  try {
    const response = await app.inject({ method: "GET", url: "/api/auth/me" });
    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.equal(payload.user.id, "local-user");
    assert.equal(payload.user.username, "local");
    assert.equal(payload.user.role, "admin");
  } finally {
    await app.close();
  }
});

test("local variant disables password login and registration", async () => {
  const app = await createApp();
  try {
    const login = await app.inject({
      method: "POST",
      payload: { password: "secret", username: "local" },
      url: "/api/auth/login",
    });
    assert.equal(login.statusCode, 404);

    const registration = await app.inject({
      method: "POST",
      payload: { password: "secret", username: "local" },
      url: "/api/auth/register",
    });
    assert.equal(registration.statusCode, 404);
  } finally {
    await app.close();
  }
});

test.after(async () => {
  await prisma.$disconnect();
});
