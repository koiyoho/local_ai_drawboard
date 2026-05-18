import { useMemo } from "react";

import { LoginPanel } from "@/components/LoginPanel";
import { getClientAppVariant } from "@/lib/api-client";
import { ensureRecentBoard, login, register } from "../api";

export function LoginApp() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const mode = params.get("mode") === "register" ? "register" : "login";
  if (getClientAppVariant() === "local") {
    void ensureRecentBoard().then(({ board }) => {
      window.location.href = `/boards/${board.id}`;
    });
    return null;
  }
  return (
    <LoginPanel
      error={params.get("error") ?? undefined}
      mode={mode}
      registered={params.get("registered") ?? undefined}
      onLogin={async (username, password) => {
        await login(username, password);
        const { board } = await ensureRecentBoard();
        window.location.href = `/boards/${board.id}`;
      }}
      onRegister={async (username, password) => {
        await register(username, password);
        window.location.href = "/login?registered=1";
      }}
    />
  );
}
