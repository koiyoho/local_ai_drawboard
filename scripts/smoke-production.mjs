import { extractAssetPaths, fetchText } from "./smoke-production-core.mjs";

const baseUrl = normalizeBaseUrl(process.env.SMOKE_BASE_URL ?? "http://aiboard.aipowers.site");

await checkHtml("/", "home");
const loginHtml = await checkHtml("/login", "login");
await checkHashAdminEntry();
await checkAssets(loginHtml);
await checkStatus("/api/auth/me", [401], "auth");
await checkStatus("/api/codex-auth/status", [401], "codex auth");

console.log(`production smoke passed: ${baseUrl}`);

async function checkHtml(path, label) {
  const { response, text } = await fetchText(baseUrl, path);
  if (response.status !== 200) {
    throw new Error(`${label} ${path} returned ${response.status}, expected 200`);
  }
  if (!text.includes('id="root"')) {
    throw new Error(`${label} ${path} did not return the client root html`);
  }
  console.log(`${label} ${path} -> ${response.status}`);
  return text;
}

async function checkHashAdminEntry() {
  const { response, text } = await fetchText(baseUrl, "/#/admin");
  if (response.status !== 200) {
    throw new Error(`admin hash route returned ${response.status}, expected 200`);
  }
  if (!text.includes('id="root"')) {
    throw new Error("admin hash route did not return the client root html");
  }
  console.log("admin /#/admin -> 200");
}

async function checkAssets(html) {
  const assetPaths = extractAssetPaths(html);
  if (assetPaths.length === 0) {
    throw new Error("no built client assets found in html");
  }
  for (const assetPath of assetPaths) {
    const response = await fetch(new URL(assetPath, baseUrl));
    if (response.status !== 200) {
      throw new Error(`${assetPath} returned ${response.status}, expected 200`);
    }
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length <= 0) {
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength <= 0) throw new Error(`${assetPath} returned an empty response`);
    }
    console.log(`${assetPath} -> 200`);
  }
}

async function checkStatus(path, expectedStatuses, label) {
  const response = await fetch(new URL(path, baseUrl));
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(`${label} ${path} returned ${response.status}, expected ${expectedStatuses.join("/")}`);
  }
  console.log(`${label} ${path} -> ${response.status}`);
}

function normalizeBaseUrl(value) {
  return value.endsWith("/") ? value : `${value}/`;
}
