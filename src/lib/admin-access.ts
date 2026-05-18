import type { CurrentUserPayload } from "@/client/api";
import { getClientAppVariant } from "@/lib/api-client";

export function canAccessAdmin(user: Pick<CurrentUserPayload, "role" | "username">) {
  if (getClientAppVariant() === "local") return user.role === "admin";
  return user.username === "koiyoho" && user.role === "admin";
}
