const baseUrl = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3333";

async function check(path, expectedStatuses, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(`${path} returned ${response.status}, expected ${expectedStatuses.join("/")}`);
  }
  console.log(`${path} -> ${response.status}`);
  return response;
}

await check("/login", [200]);
await check("/api/auth/me", [401]);
await check("/api/boards", [401, 404]);
await check("/api/codex-auth/status", [401]);
await check("/api/exports", [401], { method: "POST" });
await check("/api/codex-auth/callback?state=smoke", [400]);
