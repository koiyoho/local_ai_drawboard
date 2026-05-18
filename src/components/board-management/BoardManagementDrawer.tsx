import { type FormEvent, useMemo, useState } from "react";

import { AppIcon } from "@/components/ui/AppIcon";
import {
  IconClose,
  IconCopy,
  IconCreateBoard,
  IconDelete,
  IconOpen,
  IconRefresh,
  IconRename,
} from "@/components/ui/icons";
import type { BoardSummaryPayload, BoardTemplatePayload } from "@/client/api";

type BoardManagementDrawerProps = {
  boards: BoardSummaryPayload[];
  currentBoardId: string;
  error: string;
  isLoading: boolean;
  onClose: () => void;
  onCreateBoard: (name: string, templateId?: string) => Promise<void>;
  onDeleteBoard: (boardId: string) => Promise<void>;
  onDuplicateBoard: (boardId: string) => Promise<void>;
  onRefreshBoards: () => Promise<void>;
  onRenameBoard: (boardId: string, name: string) => Promise<void>;
  templates: BoardTemplatePayload[];
};

function formatBoardMeta(board: BoardSummaryPayload) {
  const updatedAt = new Date(board.updatedAt);
  const updatedLabel = Number.isNaN(updatedAt.getTime()) ? "更新时间未知" : updatedAt.toLocaleString("zh-CN");
  const assetCount = board._count?.assets ?? 0;
  const jobCount = board._count?.jobs ?? 0;
  return `${updatedLabel} · ${assetCount} 素材 · ${jobCount} 任务`;
}

export function BoardManagementDrawer({
  boards,
  currentBoardId,
  error,
  isLoading,
  onClose,
  onCreateBoard,
  onDeleteBoard,
  onDuplicateBoard,
  onRefreshBoards,
  onRenameBoard,
  templates,
}: BoardManagementDrawerProps) {
  const [newBoardName, setNewBoardName] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [query, setQuery] = useState("");

  const filteredBoards = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return boards;
    return boards.filter((board) => board.name.toLowerCase().includes(keyword));
  }, [boards, query]);

  async function handleCreateBoard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newBoardName.trim();
    if (!name) return;
    await onCreateBoard(name, selectedTemplateId || undefined);
  }

  async function handleRenameBoard(board: BoardSummaryPayload) {
    const name = window.prompt("输入新的画板名称", board.name)?.trim();
    if (!name || name === board.name) return;
    await onRenameBoard(board.id, name);
  }

  async function handleDeleteBoard(board: BoardSummaryPayload) {
    if (!window.confirm(`确定删除「${board.name}」吗？此操作不可撤销。`)) return;
    await onDeleteBoard(board.id);
  }

  return (
    <aside aria-label="画板管理" className="board-management-drawer">
      <header>
        <div>
          <span className="eyebrow">Boards</span>
          <h2>画板管理</h2>
        </div>
        <button aria-label="关闭画板管理" className="icon-button" onClick={onClose} type="button">
          <AppIcon icon={IconClose} size="md" />
        </button>
      </header>

      <form className="drawer-inline-form" onSubmit={handleCreateBoard}>
        <input
          disabled={isLoading}
          maxLength={80}
          onChange={(event) => setNewBoardName(event.target.value)}
          placeholder="新画板名称"
          value={newBoardName}
        />
        <select
          aria-label="画板模板"
          disabled={isLoading}
          onChange={(event) => setSelectedTemplateId(event.target.value)}
          value={selectedTemplateId}
        >
          <option value="">空白画板</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
        <button disabled={isLoading || !newBoardName.trim()} type="submit">
          <AppIcon icon={IconCreateBoard} size="md" />
          新建
        </button>
      </form>
      {selectedTemplateId ? (
        <p className="drawer-template-hint">
          {templates.find((template) => template.id === selectedTemplateId)?.description}
        </p>
      ) : null}

      <div className="drawer-search">
        <input
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索画板"
          type="search"
          value={query}
        />
        <button disabled={isLoading} onClick={onRefreshBoards} type="button">
          <AppIcon icon={IconRefresh} className={isLoading ? "spin" : undefined} size="md" />
          刷新
        </button>
      </div>

      {error ? <p className="drawer-error">{error}</p> : null}

      <div className="drawer-board-list">
        {filteredBoards.length ? (
          filteredBoards.map((board) => (
            <div className="drawer-board-row" data-current={board.id === currentBoardId} key={board.id}>
              <a href={`/boards/${board.id}`} title={board.name}>
                <strong>{board.name}</strong>
                <span>{formatBoardMeta(board)}</span>
              </a>
              <div>
                <a aria-label={`打开 ${board.name}`} href={`/boards/${board.id}`} title="打开">
                  <AppIcon icon={IconOpen} size="md" />
                </a>
                <button
                  aria-label={`重命名 ${board.name}`}
                  disabled={isLoading}
                  onClick={() => handleRenameBoard(board)}
                  title="重命名"
                  type="button"
                >
                  <AppIcon icon={IconRename} size="md" />
                </button>
                <button
                  aria-label={`复制 ${board.name}`}
                  disabled={isLoading}
                  onClick={() => onDuplicateBoard(board.id)}
                  title="复制"
                  type="button"
                >
                  <AppIcon icon={IconCopy} size="md" />
                </button>
                <button
                  aria-label={`删除 ${board.name}`}
                  disabled={isLoading}
                  onClick={() => handleDeleteBoard(board)}
                  title="删除"
                  type="button"
                >
                  <AppIcon icon={IconDelete} size="md" />
                </button>
              </div>
            </div>
          ))
        ) : (
          <p className="drawer-empty">{isLoading ? "正在加载画板..." : "没有匹配的画板"}</p>
        )}
      </div>
    </aside>
  );
}
