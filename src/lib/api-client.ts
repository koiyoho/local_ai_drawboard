declare const __AIBOARD_API_BASE_URL__: string | undefined;
declare global {
  interface Window {
    __AIBOARD_RUNTIME_CONFIG__?: {
      apiBaseUrl?: string;
      appVariant?: string;
      updateChannel?: string;
    };
  }
}

export function getRuntimeConfig() {
  return typeof window === "undefined" ? {} : (window.__AIBOARD_RUNTIME_CONFIG__ ?? {});
}

const apiBaseUrl = (getRuntimeConfig().apiBaseUrl ?? __AIBOARD_API_BASE_URL__ ?? "").replace(/\/$/, "");

export function apiUrl(path: string) {
  if (!apiBaseUrl || /^https?:\/\//.test(path)) {
    return path;
  }
  if (typeof window !== "undefined" && path.startsWith("/api/assets/")) {
    return path;
  }
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const apiRootPath = normalizedPath.startsWith("/api/")
    ? normalizedPath.slice(4)
    : normalizedPath;
  return `${apiBaseUrl}${apiRootPath}`;
}

export function apiFetch(path: string, init?: RequestInit) {
  return fetch(apiUrl(path), {
    ...init,
    credentials: "include",
  });
}

export function getClientAppVariant() {
  return getRuntimeConfig().appVariant === "local" ? "local" : "main";
}
