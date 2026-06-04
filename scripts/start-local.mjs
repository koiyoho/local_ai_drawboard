process.env.APP_VARIANT = "local";
process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME?.trim() || "local";
process.env.AUTH_URL = process.env.AUTH_URL?.trim() || "http://localhost:3010";
process.env.PORT = process.env.PORT?.trim() || "3010";
process.env.UPDATE_CHANNEL = process.env.UPDATE_CHANNEL?.trim() || "local";

const { ensureCliProxyLocal } = await import("./cliproxy-local.mjs");
await ensureCliProxyLocal({ start: true });

await import("../dist/server/server/index.js");
