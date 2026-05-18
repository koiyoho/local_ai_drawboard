import { AppIcon } from "@/components/ui/AppIcon";
import {
  IconClose,
  IconCollapseDown,
  IconCollapseUp,
  IconDelete,
  IconLayers,
  IconLock,
  IconRename,
  IconUnlock,
  IconView,
  IconViewOff,
} from "@/components/ui/icons";
import type { BoardObject } from "@/components/board-canvas/board-document";

type LayerPanelProps = {
  objects: BoardObject[];
  selectedObjectIds: string[];
  collapsedGroupIds: string[];
  onClose: () => void;
  onDelete: (objectId: string) => void;
  onGroupSelect: (objectIds: string[]) => void;
  onMove: (objectId: string, direction: "up" | "down") => void;
  onRename: (objectId: string, name: string) => void;
  onSelect: (objectId: string) => void;
  onToggleGroupCollapsed: (groupId: string) => void;
  onToggleGroupHidden: (objectIds: string[]) => void;
  onToggleGroupLocked: (objectIds: string[]) => void;
  onToggleHidden: (objectId: string) => void;
  onToggleLocked: (objectId: string) => void;
  onUngroup: (objectIds: string[]) => void;
};

const typeLabels: Record<BoardObject["type"], string> = {
  image: "图片",
  path: "路径",
  rect: "矩形",
  text: "文本",
};

const defaultNames: Record<BoardObject["type"], string> = {
  image: "图片图层",
  path: "路径图层",
  rect: "矩形图层",
  text: "文本图层",
};

function getLayerName(object: BoardObject) {
  if (object.name?.trim()) return object.name.trim();
  if (object.type === "text" && object.text.trim()) return object.text.trim();
  return defaultNames[object.type];
}

export function LayerPanel({
  collapsedGroupIds,
  objects,
  selectedObjectIds,
  onClose,
  onDelete,
  onGroupSelect,
  onMove,
  onRename,
  onSelect,
  onToggleGroupCollapsed,
  onToggleGroupHidden,
  onToggleGroupLocked,
  onToggleHidden,
  onToggleLocked,
  onUngroup,
}: LayerPanelProps) {
  const selectedIds = new Set(selectedObjectIds);
  const collapsedIds = new Set(collapsedGroupIds);
  const topFirstObjects = [...objects].reverse();
  const rows = getLayerPanelRows(topFirstObjects);

  function handleRename(object: BoardObject) {
    const currentName = getLayerName(object);
    const nextName = window.prompt("输入图层名称", object.name ?? currentName)?.trim();
    if (!nextName || nextName === object.name) return;
    onRename(object.id, nextName);
  }

  return (
    <aside aria-label="图层面板" className="layer-panel">
      <header>
        <div>
          <span className="eyebrow">Layers</span>
          <h2>图层</h2>
        </div>
        <button aria-label="关闭图层面板" className="icon-button" onClick={onClose} type="button">
          <AppIcon icon={IconClose} size="md" />
        </button>
      </header>

      {topFirstObjects.length === 0 ? (
        <p className="drawer-empty">当前页面没有对象</p>
      ) : (
        <div className="layer-list">
          {rows.map((row) => {
            if (row.type === "group") {
              const isCollapsed = collapsedIds.has(row.groupId);
              const isSelected = row.objects.some((object) => selectedIds.has(object.id));
              const groupHidden = row.objects.every((object) => object.hidden);
              const groupLocked = row.objects.every((object) => object.locked);
              const objectIds = row.objects.map((object) => object.id);
              return (
                <section className={isSelected ? "layer-group is-selected" : "layer-group"} key={row.groupId}>
                  <div className="layer-group-header">
                    <button
                      aria-expanded={!isCollapsed}
                      className="layer-row-main"
                      onClick={() => onGroupSelect(objectIds)}
                      title={row.name}
                      type="button"
                    >
                      <AppIcon icon={IconLayers} size="md" />
                      <strong>{row.name}</strong>
                      <span>{row.objects.length} 个图层</span>
                    </button>
                    <div className="layer-row-actions">
                      <button
                        aria-label={`${isCollapsed ? "展开" : "折叠"} ${row.name}`}
                        onClick={() => onToggleGroupCollapsed(row.groupId)}
                        title={isCollapsed ? "展开" : "折叠"}
                        type="button"
                      >
                        <AppIcon icon={isCollapsed ? IconCollapseDown : IconCollapseUp} size="md" />
                      </button>
                      <button
                        aria-label={groupHidden ? `显示 ${row.name}` : `隐藏 ${row.name}`}
                        onClick={() => onToggleGroupHidden(objectIds)}
                        title={groupHidden ? "显示组" : "隐藏组"}
                        type="button"
                      >
                        <AppIcon icon={groupHidden ? IconViewOff : IconView} size="md" />
                      </button>
                      <button
                        aria-label={groupLocked ? `解锁 ${row.name}` : `锁定 ${row.name}`}
                        onClick={() => onToggleGroupLocked(objectIds)}
                        title={groupLocked ? "解锁组" : "锁定组"}
                        type="button"
                      >
                        <AppIcon icon={groupLocked ? IconLock : IconUnlock} size="md" />
                      </button>
                      <button
                        aria-label={`解组 ${row.name}`}
                        onClick={() => onUngroup(objectIds)}
                        title="解组"
                        type="button"
                      >
                        解
                      </button>
                    </div>
                  </div>
                  {!isCollapsed ? (
                    <div className="layer-group-children">
                      {row.objects.map((object) => renderLayerRow(object, objects, selectedIds, handleRename, {
                        onDelete,
                        onMove,
                        onSelect,
                        onToggleHidden,
                        onToggleLocked,
                      }))}
                    </div>
                  ) : null}
                </section>
              );
            }
            return renderLayerRow(row.object, objects, selectedIds, handleRename, {
              onDelete,
              onMove,
              onSelect,
              onToggleHidden,
              onToggleLocked,
            });
          })}
        </div>
      )}
    </aside>
  );
}

type LayerPanelRow =
  | { type: "group"; groupId: string; name: string; objects: BoardObject[] }
  | { type: "object"; object: BoardObject };

function getLayerPanelRows(topFirstObjects: BoardObject[]): LayerPanelRow[] {
  const rows: LayerPanelRow[] = [];
  const seenGroupIds = new Set<string>();
  for (const object of topFirstObjects) {
    if (!object.groupId) {
      rows.push({ object, type: "object" });
      continue;
    }
    if (seenGroupIds.has(object.groupId)) continue;
    seenGroupIds.add(object.groupId);
    const groupObjects = topFirstObjects.filter((item) => item.groupId === object.groupId);
    rows.push({
      groupId: object.groupId,
      name: object.groupName || "未命名分组",
      objects: groupObjects,
      type: "group",
    });
  }
  return rows;
}

function renderLayerRow(
  object: BoardObject,
  allObjects: BoardObject[],
  selectedIds: Set<string>,
  handleRename: (object: BoardObject) => void,
  actions: Pick<
    LayerPanelProps,
    "onDelete" | "onMove" | "onSelect" | "onToggleHidden" | "onToggleLocked"
  >,
) {
  const sourceIndex = allObjects.findIndex((item) => item.id === object.id);
  const isSelected = selectedIds.has(object.id);
  const layerName = getLayerName(object);
  return (
    <div className={isSelected ? "layer-row is-selected" : "layer-row"} key={object.id}>
      <button
        aria-pressed={isSelected}
        className="layer-row-main"
        onClick={() => actions.onSelect(object.id)}
        title={layerName}
        type="button"
      >
        <strong>{layerName}</strong>
        <span>{typeLabels[object.type]}</span>
      </button>
      <div className="layer-row-actions">
        <button aria-label={`重命名 ${layerName}`} onClick={() => handleRename(object)} title="重命名" type="button">
          <AppIcon icon={IconRename} size="md" />
        </button>
        <button
          aria-label={object.hidden ? `显示 ${layerName}` : `隐藏 ${layerName}`}
          onClick={() => actions.onToggleHidden(object.id)}
          title={object.hidden ? "显示" : "隐藏"}
          type="button"
        >
          <AppIcon icon={object.hidden ? IconViewOff : IconView} size="md" />
        </button>
        <button
          aria-label={object.locked ? `解锁 ${layerName}` : `锁定 ${layerName}`}
          onClick={() => actions.onToggleLocked(object.id)}
          title={object.locked ? "解锁" : "锁定"}
          type="button"
        >
          <AppIcon icon={object.locked ? IconLock : IconUnlock} size="md" />
        </button>
        <button
          aria-label={`上移 ${layerName}`}
          disabled={sourceIndex >= allObjects.length - 1}
          onClick={() => actions.onMove(object.id, "up")}
          title="上移"
          type="button"
        >
          <AppIcon icon={IconCollapseUp} size="md" />
        </button>
        <button
          aria-label={`下移 ${layerName}`}
          disabled={sourceIndex <= 0}
          onClick={() => actions.onMove(object.id, "down")}
          title="下移"
          type="button"
        >
          <AppIcon icon={IconCollapseDown} size="md" />
        </button>
        <button
          aria-label={`删除 ${layerName}`}
          disabled={object.locked}
          onClick={() => actions.onDelete(object.id)}
          title={object.locked ? "解锁后删除" : "删除"}
          type="button"
        >
          <AppIcon icon={IconDelete} size="md" />
        </button>
      </div>
    </div>
  );
}
