export type AppVariant = "local" | "main";

export const localUserId = "local-user";
export const defaultAdminUsername = "admin";

export function getAppVariant(): AppVariant {
  return process.env.APP_VARIANT === "local" ? "local" : "main";
}

export function isLocalVariant() {
  return getAppVariant() === "local";
}

export function getAdminUsername() {
  return process.env.ADMIN_USERNAME?.trim() || (isLocalVariant() ? "local" : defaultAdminUsername);
}

export function getUpdateChannel() {
  return process.env.UPDATE_CHANNEL?.trim() || (isLocalVariant() ? "local" : "stable");
}
