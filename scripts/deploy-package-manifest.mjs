export const deployPackageEntries = [
  "dist",
  "deploy-manifest.json",
  "package.json",
  "package-lock.json",
  "prisma",
  "prisma.config.ts",
  "scripts",
];

export const deployPackageExcludes = [
  "dist/client/uploads",
  "public/uploads",
  "local-exports",
  "generated-images",
  "prisma/*.db",
  "prisma/*.db-*",
  ".env",
  ".local",
  ".local/**",
  "node_modules",
];

export const forbiddenDeployPackagePatterns = [
  /^dist\/client\/uploads(?:\/|$)/,
  /^public\/uploads(?:\/|$)/,
  /^local-exports(?:\/|$)/,
  /^generated-images(?:\/|$)/,
  /^prisma\/.*\.db(?:-.+)?$/,
  /^\.env$/,
  /^\.local(?:\/|$)/,
  /^node_modules(?:\/|$)/,
];

export function isForbiddenDeployPackagePath(pathname) {
  const normalizedPath = pathname.replaceAll("\\", "/").replace(/^\.\//, "");
  return forbiddenDeployPackagePatterns.some((pattern) => pattern.test(normalizedPath));
}

export const deployManifestPath = "deploy-manifest.json";

export const deployPackageManifestRequiredFields = [
  "appName",
  "version",
  "commit",
  "channel",
  "migrationMode",
  "entrypoint",
  "files",
];
