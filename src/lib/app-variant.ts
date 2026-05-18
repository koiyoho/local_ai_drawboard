export type AppVariant = "local" | "main";

export const localUserId = "local-user";

export function getAppVariant(): AppVariant {
  return process.env.APP_VARIANT === "local" ? "local" : "main";
}

export function isLocalVariant() {
  return getAppVariant() === "local";
}

export function getUpdateChannel() {
  return process.env.UPDATE_CHANNEL?.trim() || (isLocalVariant() ? "local" : "stable");
}
