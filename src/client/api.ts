import { apiFetch } from "@/lib/api-client";

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const hasJsonBody = init?.body !== undefined && !(init.body instanceof FormData);
  const response = await apiFetch(path, {
    ...init,
    headers: hasJsonBody ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed with ${response.status}`);
  }
  return payload as T;
}

export type CurrentUserPayload = {
  canUseAdminProvider: boolean;
  email: string | null;
  generationFiveHourLimit: number | null;
  generationLimit: number | null;
  id: string;
  image: string | null;
  name: string | null;
  role: string;
  status: string;
  username: string | null;
};

export type BoardSummaryPayload = {
  id: string;
  name: string;
  updatedAt: string;
  _count?: {
    assets: number;
    jobs: number;
  };
};

export type BoardTemplatePayload = {
  defaultPrompt: string;
  description: string;
  id: string;
  name: string;
};

export async function getCurrentUser() {
  return apiJson<{ user: CurrentUserPayload }>("/api/auth/me");
}

export async function ensureRecentBoard() {
  return apiJson<{ board: BoardSummaryPayload }>("/api/boards/ensure-recent", {
    method: "POST",
  });
}

export async function getBoards() {
  return apiJson<{ boards: BoardSummaryPayload[] }>("/api/boards");
}

export async function getBoardTemplates() {
  return apiJson<{ templates: BoardTemplatePayload[] }>("/api/board-templates");
}

export async function login(username: string, password: string) {
  return apiJson<{ user: CurrentUserPayload }>("/api/auth/login", {
    body: JSON.stringify({ password, username }),
    method: "POST",
  });
}

export async function register(username: string, password: string) {
  return apiJson<{ ok: true }>("/api/auth/register", {
    body: JSON.stringify({ password, username }),
    method: "POST",
  });
}

export async function logout() {
  return apiJson<{ ok: true }>("/api/auth/logout", { method: "POST" });
}
