import { useEffect, useState } from "react";

import { BoardWorkspace, type BoardPayload } from "@/components/BoardWorkspace";
import { getClientAppVariant } from "@/lib/api-client";
import { apiJson } from "../api";
import { ErrorState, LoadingState } from "./LoadingState";

export function BoardApp({ boardId }: { boardId: string }) {
  const [payload, setPayload] = useState<{ board: BoardPayload; snapshot: unknown } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    apiJson<{ board: BoardPayload; snapshot: unknown }>(`/api/boards/${boardId}`)
      .then(setPayload)
      .catch((error) => {
        const message = error instanceof Error ? error.message : "加载画板失败";
        if (message.includes("Authentication")) {
          if (getClientAppVariant() === "local") window.location.href = "/";
          else window.location.href = "/login";
        } else {
          setError(message);
        }
      });
  }, [boardId]);
  if (error) return <ErrorState message={error} />;
  if (!payload) return <LoadingState message="正在加载画板..." />;
  return <BoardWorkspace initialBoard={payload.board} initialSnapshot={payload.snapshot} />;
}
