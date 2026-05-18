import { AppIcon } from "@/components/ui/AppIcon";
import {
  IconLogout,
  IconUser,
} from "@/components/ui/icons";
import { FormEvent } from "react";

import { apiFetch, getClientAppVariant } from "@/lib/api-client";

export function AccountActions({
  email,
  name,
}: {
  email?: string | null;
  name?: string | null;
}) {
  const isLocal = getClientAppVariant() === "local";
  const label = isLocal ? "本地工作区" : name || email || "已登录账号";

  async function signOut(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await apiFetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <div className="account-actions">
      <div className="account-user-pill">
        <AppIcon icon={IconUser} size="md" />
        <strong>{label}</strong>
      </div>
      {!isLocal ? (
        <form onSubmit={signOut}>
          <button type="submit">
            <AppIcon icon={IconLogout} size="md" />
            退出
          </button>
        </form>
      ) : null}
    </div>
  );
}
