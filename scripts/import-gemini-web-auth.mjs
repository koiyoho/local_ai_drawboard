import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const secure1psid = process.env.GEMINI_IMPORT_SECURE_1PSID?.trim() || process.env.GEMINI_SECURE_1PSID?.trim() || "";
const secure1psidts = process.env.GEMINI_IMPORT_SECURE_1PSIDTS?.trim() || process.env.GEMINI_SECURE_1PSIDTS?.trim() || "";
const cookies = parseCookieImport(process.env.GEMINI_IMPORT_COOKIES?.trim() || "");
const resolved1psid = secure1psid || findCookieValue(cookies, "__Secure-1PSID");
const resolved1psidts = secure1psidts || findCookieValue(cookies, "__Secure-1PSIDTS");

if (!resolved1psid) {
  console.error("GEMINI_IMPORT_SECURE_1PSID or GEMINI_IMPORT_COOKIES with __Secure-1PSID is required");
  process.exit(1);
}

const authPath = process.env.GEMINI_WEB_AUTH_PATH?.trim() || path.join(process.cwd(), ".codex", "gemini-web-auth.json");
await mkdir(path.dirname(authPath), { recursive: true });
await writeFile(
  authPath,
  `${JSON.stringify({
    "__Secure-1PSID": resolved1psid,
    "__Secure-1PSIDTS": resolved1psidts,
    cookies,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 },
);

console.log(`Gemini Web auth saved to ${authPath}`);
console.log(`Full cookies: ${cookies.length ? `${cookies.length} saved` : "not provided"}`);
console.log(`__Secure-1PSIDTS: ${resolved1psidts ? "saved" : "not provided"}`);

function parseCookieImport(value) {
  if (!value) return [];
  const jsonCookies = normalizeCookies(parseCookieJson(value));
  if (jsonCookies.length > 0) return jsonCookies;
  return parseCookieHeader(value);
}

function parseCookieJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeCookies(value) {
  const rawCookies = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray(value.cookies)
      ? value.cookies
      : value && typeof value === "object" && Array.isArray(value.cookieList)
        ? value.cookieList
        : [];
  return dedupeCookies(rawCookies.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const cookieValue = typeof item.value === "string" ? item.value : "";
    if (!name || !cookieValue) return [];
    const domain = typeof item.domain === "string" && item.domain.trim() ? item.domain.trim() : ".google.com";
    const cookiePath = typeof item.path === "string" && item.path.trim() ? item.path.trim() : "/";
    const expires = typeof item.expirationDate === "number" ? item.expirationDate : typeof item.expires === "number" ? item.expires : undefined;
    return [{ domain, ...(expires ? { expires } : {}), name, path: cookiePath, value: cookieValue }];
  }));
}

function parseCookieHeader(value) {
  const cookieLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.includes("=") && !line.toLowerCase().startsWith("cookie:"))
    ?? value.replace(/^cookie:\s*/i, "");
  return dedupeCookies(cookieLine.split(";").flatMap((part) => {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) return [];
    const name = part.slice(0, separatorIndex).trim();
    const cookieValue = part.slice(separatorIndex + 1);
    return name && cookieValue ? [{ domain: ".google.com", name, path: "/", value: cookieValue }] : [];
  }));
}

function dedupeCookies(cookies) {
  const byKey = new Map();
  for (const cookie of cookies) {
    byKey.set(`${cookie.name}|${cookie.domain ?? ""}|${cookie.path ?? ""}`, cookie);
  }
  return [...byKey.values()];
}

function findCookieValue(cookies, name) {
  return cookies.find((cookie) => cookie.name === name)?.value.trim() ?? "";
}
