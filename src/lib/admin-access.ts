import type { CurrentUserPayload } from "@/client/api";

export function canAccessAdmin(user: Pick<CurrentUserPayload, "role" | "username">) {
  return user.role === "admin";
}
