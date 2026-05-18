export async function fetchText(baseUrl, path) {
  const response = await fetch(new URL(path, baseUrl));
  const text = await response.text();
  return { response, text };
}

export function extractAssetPaths(html) {
  return Array.from(html.matchAll(/(?:href|src)="([^"]*assets\/index-[^"]+)"/g), (match) => match[1])
    .map((assetPath) => assetPath.replace(/^\.\//, "/"))
    .sort();
}
