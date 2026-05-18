import { useCallback, useState } from "react";

import { apiJson, ensureRecentBoard, getBoards, type BoardSummaryPayload } from "@/client/api";

export function useBoardActions(currentBoardId: string) {
  const [boards, setBoards] = useState<BoardSummaryPayload[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const refreshBoards = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const payload = await getBoards();
      setBoards(payload.boards);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载画板失败";
      setError(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createBoard = useCallback(async (name: string, templateId?: string) => {
    setIsLoading(true);
    setError("");
    try {
      const { board } = await apiJson<{ board: BoardSummaryPayload }>("/api/boards", {
        body: JSON.stringify({ name, ...(templateId ? { templateId } : {}) }),
        method: "POST",
      });
      window.location.href = `/boards/${board.id}`;
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "创建画板失败";
      setError(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const renameBoard = useCallback(async (boardId: string, name: string) => {
    setIsLoading(true);
    setError("");
    try {
      const { board } = await apiJson<{ board: BoardSummaryPayload }>(`/api/boards/${boardId}`, {
        body: JSON.stringify({ name }),
        method: "PATCH",
      });
      setBoards((current) => current.map((item) => (item.id === boardId ? { ...item, ...board } : item)));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "重命名画板失败";
      setError(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const duplicateBoard = useCallback(async (boardId: string) => {
    setIsLoading(true);
    setError("");
    try {
      const { board } = await apiJson<{ board: BoardSummaryPayload }>(`/api/boards/${boardId}/duplicate`, {
        method: "POST",
      });
      setBoards((current) => [board, ...current.filter((item) => item.id !== board.id)]);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "复制画板失败";
      setError(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const deleteBoard = useCallback(async (boardId: string) => {
    setIsLoading(true);
    setError("");
    try {
      await apiJson<{ ok: true }>(`/api/boards/${boardId}`, { method: "DELETE" });
      if (boardId === currentBoardId) {
        const { board } = await ensureRecentBoard();
        window.location.href = `/boards/${board.id}`;
        return;
      }
      setBoards((current) => current.filter((item) => item.id !== boardId));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除画板失败";
      setError(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [currentBoardId]);

  return {
    boards,
    createBoard,
    deleteBoard,
    duplicateBoard,
    error,
    isLoading,
    refreshBoards,
    renameBoard,
  };
}
