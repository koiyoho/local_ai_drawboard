export type ClientRoute =
  | { kind: "admin" }
  | { boardId: string; kind: "board" }
  | { kind: "home" }
  | { kind: "login" };

export const adminRouteHref = "/#/admin";

export function getClientRoute(location: Pick<Location, "hash" | "pathname">): ClientRoute {
  if (location.hash === "#/admin") return { kind: "admin" };
  if (location.pathname === "/login") return { kind: "login" };
  if (location.pathname === "/admin" || location.pathname === "/admin/") return { kind: "admin" };
  const boardMatch = location.pathname.match(/^\/(?:boards|mobile-preview)\/([^/]+)$/);
  if (boardMatch?.[1]) return { boardId: boardMatch[1], kind: "board" };
  return { kind: "home" };
}
