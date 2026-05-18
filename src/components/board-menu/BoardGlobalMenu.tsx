import { useEffect, useState } from "react";

import { BoardUpdateMenuItem } from "@/components/board-menu/BoardUpdateMenuItem";
import { AppIcon } from "@/components/ui/AppIcon";
import {
  IconBoards,
  IconApprove,
  IconLayers,
  IconLogout,
  IconMenu,
  IconReview,
  IconStar,
  IconUsage,
} from "@/components/ui/icons";

type BoardGlobalMenuProps = {
  boardId: string;
  boardName: string;
  isAdmin: boolean;
  isOpen: boolean;
  onOpenAdmin: () => void;
  onOpenBoardManagement: () => void;
  onOpenLayers: () => void;
  onOpenMenu: () => void;
  onRenameBoard: (boardId: string, name: string) => Promise<boolean>;
  onSignOut: () => void;
};

export function BoardGlobalMenu({
  boardId,
  boardName,
  isAdmin,
  isOpen,
  onOpenAdmin,
  onOpenBoardManagement,
  onOpenLayers,
  onOpenMenu,
  onRenameBoard,
  onSignOut,
}: BoardGlobalMenuProps) {
  const [draftName, setDraftName] = useState(boardName);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameMessage, setRenameMessage] = useState("");

  useEffect(() => {
    if (isOpen) {
      setDraftName(boardName);
      setRenameMessage("");
    }
  }, [boardName, isOpen]);

  function runMenuAction(action: () => void) {
    action();
    onOpenMenu();
  }

  async function submitRename() {
    const nextName = draftName.trim();
    if (!nextName) {
      setRenameMessage("请输入画板名称");
      return;
    }
    if (nextName === boardName) {
      setRenameMessage("名称未变化");
      return;
    }
    setIsRenaming(true);
    setRenameMessage("");
    try {
      const renamed = await onRenameBoard(boardId, nextName);
      setRenameMessage(renamed ? "已重命名" : "重命名失败");
    } catch {
      setRenameMessage("重命名失败");
    } finally {
      setIsRenaming(false);
    }
  }

  return (
    <div className="board-global-menu-wrap">
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="打开画板菜单"
        className="board-titlebar-menu"
        onClick={onOpenMenu}
        type="button"
      >
        <AppIcon icon={IconMenu} size="xl" />
      </button>
      {isOpen ? (
        <div className="board-global-menu" role="menu">
          <div className="board-global-menu-heading" role="none">
            <span>当前画板</span>
            <label className="board-global-menu-rename">
              <input
                aria-label="画板名称"
                disabled={isRenaming}
                maxLength={80}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submitRename();
                  }
                }}
                value={draftName}
              />
              <button
                aria-label="保存画板名称"
                disabled={isRenaming || !draftName.trim() || draftName.trim() === boardName}
                onClick={() => void submitRename()}
                role="button"
                type="button"
              >
                <AppIcon icon={IconApprove} size="sm" />
                保存
              </button>
            </label>
            {renameMessage ? <em aria-live="polite">{renameMessage}</em> : null}
          </div>
          <button onClick={() => runMenuAction(onOpenBoardManagement)} role="menuitem" type="button">
            <AppIcon icon={IconBoards} size="md" />
            画板管理
          </button>
          <button onClick={() => runMenuAction(onOpenLayers)} role="menuitem" type="button">
            <AppIcon icon={IconLayers} size="md" />
            图层面板
          </button>
          <button disabled role="menuitem" type="button">
            <AppIcon icon={IconReview} size="md" />
            提示词历史
          </button>
          <button disabled role="menuitem" type="button">
            <AppIcon icon={IconStar} size="md" />
            生成收藏
          </button>
          <BoardUpdateMenuItem isAdmin={isAdmin} />
          {isAdmin ? (
            <button onClick={() => runMenuAction(onOpenAdmin)} role="menuitem" type="button">
              <AppIcon icon={IconUsage} size="md" />
              管理中心
            </button>
          ) : null}
          <button onClick={() => runMenuAction(onSignOut)} role="menuitem" type="button">
            <AppIcon icon={IconLogout} size="md" />
            退出登录
          </button>
        </div>
      ) : null}
    </div>
  );
}
