import { useEffect, useState } from "react";

import { getClientAppVariant } from "@/lib/api-client";
import { ensureRecentBoard, getCurrentUser } from "../api";
import { ErrorState, LoadingState } from "./LoadingState";

export function HomeApp() {
  const [error, setError] = useState("");
  useEffect(() => {
    async function load() {
      try {
        await getCurrentUser();
        const { board } = await ensureRecentBoard();
        window.location.replace(`/boards/${board.id}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "加载失败";
        if (message.includes("Authentication")) {
          if (getClientAppVariant() === "local") window.location.reload();
          else window.location.href = "/login";
          return;
        }
        setError(message);
      }
    }
    void load();
  }, []);
  if (error) return <ErrorState message={error} />;
  return <LoadingState />;
}
