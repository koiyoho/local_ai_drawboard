"use client";

import Konva from "konva";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image as KonvaImage, Layer, Line, Rect, Stage, Text, Transformer } from "react-konva";
import { apiUrl } from "@/lib/api-client";
import type {
  BoardDocument,
  BoardImageObject,
  BoardObject,
  BoardPathObject,
  BoardRectObject,
  BoardTextObject,
} from "./board-document";
import type { AssetPayload } from "./types";
import {
  type BoardViewport,
  type Point,
  fitBoundsToViewport,
  getCombinedBounds,
  screenToWorld,
  zoomAtPoint,
} from "./viewport";
import { useKonvaImage } from "./useKonvaImage";

type KonvaBoardCanvasProps = {
  assets: AssetPayload[];
  document: BoardDocument;
  isMaskMode: boolean;
  maskBrushSize: number;
  sourceAssetId: string;
  onChange: (document: BoardDocument) => void;
  onMaskStrokeComplete: (stroke: Point[]) => void;
  onObjectContextMenu: (input: { id: string; point: Point }) => void;
  onSelectionChange: (ids: string[]) => void;
  onStageReady: (stage: Konva.Stage | null) => void;
  onViewportChange: (viewport: BoardViewport) => void;
  selectedObjectIds: string[];
  viewport: BoardViewport;
};

type BoardObjectNodeProps<TObject extends BoardObject> = {
  isMaskMode: boolean;
  object: TObject;
  registerNode: (id: string, node: Konva.Node | null) => void;
  onClick: (id: string, event: Konva.KonvaEventObject<MouseEvent>) => void;
  onContextMenu: (id: string, event: Konva.KonvaEventObject<PointerEvent>) => void;
  onTouchEnd: () => void;
  onTouchMove: (id: string, event: Konva.KonvaEventObject<TouchEvent>) => void;
  onTouchStart: (id: string, event: Konva.KonvaEventObject<TouchEvent>) => void;
  onDragEnd: (id: string, node: Konva.Node) => void;
  onTransformEnd?: (id: string, node: Konva.Node) => void;
};

type ObjectLongPressState = {
  id: string;
  point: Point;
  start: Point;
  timer: ReturnType<typeof window.setTimeout>;
};

const OBJECT_LONG_PRESS_DELAY_MS = 520;
const OBJECT_LONG_PRESS_CANCEL_DISTANCE = 10;

export function KonvaBoardCanvas({
  assets,
  document,
  isMaskMode,
  maskBrushSize,
  sourceAssetId,
  onChange,
  onMaskStrokeComplete,
  onObjectContextMenu,
  onSelectionChange,
  onStageReady,
  onViewportChange,
  selectedObjectIds,
  viewport,
}: KonvaBoardCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const nodeRegistryRef = useRef(new Map<string, Konva.Node>());
  const onStageReadyRef = useRef(onStageReady);
  const [stageSize, setStageSize] = useState({ h: 1, w: 1 });
  const [draftMaskWorldPoints, setDraftMaskWorldPoints] = useState<Point[]>([]);
  const maskStrokePixelPointsRef = useRef<Point[]>([]);
  const isDrawingMaskRef = useRef(false);
  const touchGestureRef = useRef<{
    center: Point;
    distance: number;
    viewport: BoardViewport;
  } | null>(null);
  const objectLongPressRef = useRef<ObjectLongPressState | null>(null);

  const currentPage = useMemo(
    () => document.pages.find((page) => page.id === document.currentPageId) ?? document.pages[0] ?? null,
    [document],
  );
  const pageObjects = currentPage?.objects ?? [];
  const visiblePageObjects = useMemo(() => pageObjects.filter((object) => !object.hidden), [pageObjects]);
  const assetsById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const sourceImageObject = useMemo(
    () =>
      visiblePageObjects.find(
        (object): object is BoardImageObject =>
          selectedObjectIds.includes(object.id) && object.type === "image" && object.assetId === sourceAssetId,
      ) ??
      visiblePageObjects.find((object): object is BoardImageObject => object.type === "image" && object.assetId === sourceAssetId),
    [selectedObjectIds, sourceAssetId, visiblePageObjects],
  );
  const sourceAsset = sourceImageObject ? assetsById.get(sourceImageObject.assetId) : undefined;

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const resize = () => {
      const rect = wrapper.getBoundingClientRect();
      setStageSize({
        h: Math.max(1, Math.round(rect.height)),
        w: Math.max(1, Math.round(rect.width)),
      });
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    onStageReadyRef.current = onStageReady;
    const stage = stageRef.current;
    onStageReady(stage);
  }, [onStageReady]);

  useEffect(() => {
    return () => onStageReadyRef.current(null);
  }, []);

  const registerNode = useCallback((id: string, node: Konva.Node | null) => {
    if (node) {
      nodeRegistryRef.current.set(id, node);
      return;
    }
    nodeRegistryRef.current.delete(id);
  }, []);

  const cancelObjectLongPress = useCallback(() => {
    const longPress = objectLongPressRef.current;
    if (longPress) {
      window.clearTimeout(longPress.timer);
      objectLongPressRef.current = null;
    }
  }, []);

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;

    const transformableObjectIds = new Set(
      visiblePageObjects
        .filter((object) => !object.locked && (object.type === "image" || object.type === "rect"))
        .map((object) => object.id),
    );
    const selectedNodes = isMaskMode
      ? []
      : selectedObjectIds
          .filter((id) => transformableObjectIds.has(id))
          .map((id) => nodeRegistryRef.current.get(id))
          .filter((node): node is Konva.Node => Boolean(node));
    transformer.nodes(selectedNodes);
    transformer.getLayer()?.batchDraw();
  }, [isMaskMode, selectedObjectIds, visiblePageObjects]);

  const updateObject = useCallback(
    (objectId: string, updater: (object: BoardObject) => BoardObject) => {
      onChange({
        ...document,
        pages: document.pages.map((page) =>
          page.id === document.currentPageId
            ? {
                ...page,
                objects: page.objects.map((object) => (object.id === objectId ? updater(object) : object)),
              }
            : page,
        ),
      });
    },
    [document, onChange],
  );

  const handleObjectClick = useCallback(
    (id: string, event: Konva.KonvaEventObject<MouseEvent>) => {
      event.cancelBubble = true;
      const object = pageObjects.find((pageObject) => pageObject.id === id);
      if (!object || object.hidden || object.locked) return;
      if (isMaskMode) return;
      if (event.evt.shiftKey || event.evt.ctrlKey || event.evt.metaKey) {
        onSelectionChange(
          selectedObjectIds.includes(id)
            ? selectedObjectIds.filter((selectedId) => selectedId !== id)
            : [...selectedObjectIds, id],
        );
        return;
      }
      onSelectionChange([id]);
    },
    [isMaskMode, onSelectionChange, pageObjects, selectedObjectIds],
  );

  const handleObjectContextMenu = useCallback(
    (id: string, event: Konva.KonvaEventObject<PointerEvent>) => {
      event.evt.preventDefault();
      event.cancelBubble = true;
      const object = pageObjects.find((pageObject) => pageObject.id === id);
      if (!object || object.hidden || object.locked) return;
      if (isMaskMode) return;
      onSelectionChange([id]);
      onObjectContextMenu({ id, point: { x: event.evt.clientX, y: event.evt.clientY } });
    },
    [isMaskMode, onObjectContextMenu, onSelectionChange, pageObjects],
  );

  const handleObjectTouchStart = useCallback(
    (id: string, event: Konva.KonvaEventObject<TouchEvent>) => {
      if (isMaskMode || event.evt.touches.length !== 1) return;
      const object = pageObjects.find((pageObject) => pageObject.id === id);
      if (!object || object.hidden || object.locked) return;
      const touch = event.evt.touches[0];
      const point = { x: touch.clientX, y: touch.clientY };
      event.cancelBubble = true;
      cancelObjectLongPress();
      objectLongPressRef.current = {
        id,
        point,
        start: point,
        timer: window.setTimeout(() => {
          objectLongPressRef.current = null;
          onSelectionChange([id]);
          onObjectContextMenu({ id, point });
        }, OBJECT_LONG_PRESS_DELAY_MS),
      };
    },
    [cancelObjectLongPress, isMaskMode, onObjectContextMenu, onSelectionChange, pageObjects],
  );

  const handleObjectTouchMove = useCallback(
    (id: string, event: Konva.KonvaEventObject<TouchEvent>) => {
      const longPress = objectLongPressRef.current;
      if (!longPress || longPress.id !== id) return;
      if (event.evt.touches.length !== 1) {
        cancelObjectLongPress();
        return;
      }
      const touch = event.evt.touches[0];
      const dx = touch.clientX - longPress.start.x;
      const dy = touch.clientY - longPress.start.y;
      if (Math.hypot(dx, dy) > OBJECT_LONG_PRESS_CANCEL_DISTANCE) {
        cancelObjectLongPress();
      }
    },
    [cancelObjectLongPress],
  );

  const handleDragEnd = useCallback(
    (id: string, node: Konva.Node) => {
      const targetObject = pageObjects.find((pageObject) => pageObject.id === id);
      if (!targetObject || targetObject.hidden || targetObject.locked) return;

      updateObject(id, (object) => {
        if (object.type === "path") {
          const dx = node.x();
          const dy = node.y();
          node.position({ x: 0, y: 0 });
          return {
            ...object,
            points: object.points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
          };
        }
        return {
          ...object,
          x: node.x(),
          y: node.y(),
        };
      });
    },
    [pageObjects, updateObject],
  );

  const handleTransformEnd = useCallback(
    (id: string, node: Konva.Node) => {
      const targetObject = pageObjects.find((pageObject) => pageObject.id === id);
      if (!targetObject || targetObject.hidden || targetObject.locked) return;

      updateObject(id, (object) => {
        if (object.type !== "image" && object.type !== "rect") return object;

        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        node.scale({ x: 1, y: 1 });

        return {
          ...object,
          h: Math.max(1, object.h * scaleY),
          rotation: node.rotation(),
          w: Math.max(1, object.w * scaleX),
          x: node.x(),
          y: node.y(),
        };
      });
    },
    [pageObjects, updateObject],
  );

  const getPointerWorldPoint = useCallback(() => {
    const pointer = stageRef.current?.getPointerPosition();
    return pointer ? screenToWorld(pointer, viewport) : null;
  }, [viewport]);

  const appendMaskPoint = useCallback(
    (worldPoint: Point) => {
      if (!sourceImageObject) return false;
      const pixelPoint = worldPointToImagePixelPoint(worldPoint, sourceImageObject, sourceAsset);
      if (!pixelPoint) return false;

      maskStrokePixelPointsRef.current = [...maskStrokePixelPointsRef.current, pixelPoint];
      setDraftMaskWorldPoints((points) => [...points, worldPoint]);
      return true;
    },
    [sourceAsset, sourceImageObject],
  );

  const cancelMaskStroke = useCallback(() => {
    isDrawingMaskRef.current = false;
    maskStrokePixelPointsRef.current = [];
    setDraftMaskWorldPoints([]);
  }, []);

  const finishMaskStroke = useCallback(() => {
    if (!isDrawingMaskRef.current) return;

    isDrawingMaskRef.current = false;
    const stroke = maskStrokePixelPointsRef.current;
    maskStrokePixelPointsRef.current = [];
    setDraftMaskWorldPoints([]);

    if (stroke.length > 0) {
      onMaskStrokeComplete(stroke);
    }
  }, [onMaskStrokeComplete]);

  useEffect(() => {
    if (!isMaskMode || draftMaskWorldPoints.length === 0) return;

    window.addEventListener("pointerup", finishMaskStroke);
    window.addEventListener("pointercancel", cancelMaskStroke);
    return () => {
      window.removeEventListener("pointerup", finishMaskStroke);
      window.removeEventListener("pointercancel", cancelMaskStroke);
    };
  }, [cancelMaskStroke, draftMaskWorldPoints.length, finishMaskStroke, isMaskMode]);

  useEffect(() => {
    if (!isMaskMode) {
      cancelMaskStroke();
    }
  }, [cancelMaskStroke, isMaskMode]);

  const handleStageMouseDown = useCallback(
    (event: Konva.KonvaEventObject<MouseEvent>) => {
      event.evt.preventDefault();
      if (!isMaskMode) {
        if (event.target === event.target.getStage()) {
          onSelectionChange([]);
        }
        return;
      }

      const worldPoint = getPointerWorldPoint();
      if (!worldPoint) return;

      maskStrokePixelPointsRef.current = [];
      setDraftMaskWorldPoints([]);
      isDrawingMaskRef.current = appendMaskPoint(worldPoint);
    },
    [appendMaskPoint, getPointerWorldPoint, isMaskMode, onSelectionChange],
  );

  const handleStageMouseMove = useCallback(() => {
    if (!isMaskMode || !isDrawingMaskRef.current) return;

    const worldPoint = getPointerWorldPoint();
    if (worldPoint) appendMaskPoint(worldPoint);
  }, [appendMaskPoint, getPointerWorldPoint, isMaskMode]);

  const handleStageMouseUp = useCallback(() => {
    if (!isMaskMode) return;
    finishMaskStroke();
  }, [finishMaskStroke, isMaskMode]);

  const handleTouchStart = useCallback(
    (event: Konva.KonvaEventObject<TouchEvent>) => {
      const touches = event.evt.touches;
      if (touches.length === 2) {
        event.evt.preventDefault();
        cancelObjectLongPress();
        cancelMaskStroke();
        touchGestureRef.current = {
          center: getTouchCenter(touches),
          distance: getTouchDistance(touches),
          viewport,
        };
        return;
      }
      handleStageMouseDown(event as unknown as Konva.KonvaEventObject<MouseEvent>);
    },
    [cancelMaskStroke, cancelObjectLongPress, handleStageMouseDown, viewport],
  );

  const handleTouchMove = useCallback(
    (event: Konva.KonvaEventObject<TouchEvent>) => {
      const gesture = touchGestureRef.current;
      const touches = event.evt.touches;
      if (gesture && touches.length === 2) {
        event.evt.preventDefault();
        const center = getTouchCenter(touches);
        const distance = getTouchDistance(touches);
        const zoomedViewport = zoomAtPoint(
          gesture.viewport,
          gesture.center,
          gesture.viewport.zoom * (distance / gesture.distance),
        );
        onViewportChange({
          ...zoomedViewport,
          x: zoomedViewport.x + center.x - gesture.center.x,
          y: zoomedViewport.y + center.y - gesture.center.y,
        });
        return;
      }
      handleStageMouseMove();
    },
    [handleStageMouseMove, onViewportChange],
  );

  const handleTouchEnd = useCallback(() => {
    cancelObjectLongPress();
    touchGestureRef.current = null;
    handleStageMouseUp();
  }, [cancelObjectLongPress, handleStageMouseUp]);

  const handleWheel = useCallback(
    (event: Konva.KonvaEventObject<WheelEvent>) => {
      event.evt.preventDefault();
      const pointer = stageRef.current?.getPointerPosition();
      if (!pointer) return;

      const factor = event.evt.deltaY > 0 ? 0.9 : 1.1;
      onViewportChange(zoomAtPoint(viewport, pointer, viewport.zoom * factor));
    },
    [onViewportChange, viewport],
  );

  const fitToContent = useCallback(() => {
    const bounds = getCombinedBounds(visiblePageObjects);
    if (!bounds) return;
    onViewportChange(fitBoundsToViewport(bounds, stageSize));
  }, [onViewportChange, stageSize, visiblePageObjects]);

  return (
    <div className="konva-board-canvas" ref={wrapperRef}>
      <button aria-label="适应全部" className="konva-board-fit" onClick={fitToContent} type="button">
        适应全部
      </button>
      <Stage
        height={stageSize.h}
        onContextMenu={(event) => event.evt.preventDefault()}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
        onPointerCancel={cancelMaskStroke}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={cancelMaskStroke}
        onTouchMove={handleTouchMove}
        onTouchStart={handleTouchStart}
        onWheel={handleWheel}
        ref={stageRef}
        scaleX={viewport.zoom}
        scaleY={viewport.zoom}
        width={stageSize.w}
        x={viewport.x}
        y={viewport.y}
      >
        <Layer>
          {visiblePageObjects.map((object) => {
            if (object.type === "image") {
              return (
                <ImageObjectNode
                  asset={assetsById.get(object.assetId)}
                  isMaskMode={isMaskMode}
                  key={object.id}
                  object={object}
                  onClick={handleObjectClick}
                  onContextMenu={handleObjectContextMenu}
                  onTouchEnd={cancelObjectLongPress}
                  onTouchMove={handleObjectTouchMove}
                  onTouchStart={handleObjectTouchStart}
                  onDragEnd={handleDragEnd}
                  onTransformEnd={handleTransformEnd}
                  registerNode={registerNode}
                />
              );
            }
            if (object.type === "rect") {
              return (
                <RectObjectNode
                  isMaskMode={isMaskMode}
                  key={object.id}
                  object={object}
                  onClick={handleObjectClick}
                  onContextMenu={handleObjectContextMenu}
                  onTouchEnd={cancelObjectLongPress}
                  onTouchMove={handleObjectTouchMove}
                  onTouchStart={handleObjectTouchStart}
                  onDragEnd={handleDragEnd}
                  onTransformEnd={handleTransformEnd}
                  registerNode={registerNode}
                />
              );
            }
            if (object.type === "text") {
              return (
                <TextObjectNode
                  isMaskMode={isMaskMode}
                  key={object.id}
                  object={object}
                  onClick={handleObjectClick}
                  onContextMenu={handleObjectContextMenu}
                  onTouchEnd={cancelObjectLongPress}
                  onTouchMove={handleObjectTouchMove}
                  onTouchStart={handleObjectTouchStart}
                  onDragEnd={handleDragEnd}
                  registerNode={registerNode}
                />
              );
            }
            return (
              <PathObjectNode
                isMaskMode={isMaskMode}
                key={object.id}
                object={object}
                onClick={handleObjectClick}
                onContextMenu={handleObjectContextMenu}
                onTouchEnd={cancelObjectLongPress}
                onTouchMove={handleObjectTouchMove}
                onTouchStart={handleObjectTouchStart}
                onDragEnd={handleDragEnd}
                registerNode={registerNode}
              />
            );
          })}
          {draftMaskWorldPoints.length > 1 ? (
            <Line
              dash={[maskBrushSize * 0.4, maskBrushSize * 0.25]}
              lineCap="round"
              lineJoin="round"
              listening={false}
              points={flattenPoints(draftMaskWorldPoints)}
              stroke="#d6a642"
              strokeWidth={maskBrushSize}
            />
          ) : null}
          <Transformer
            anchorCornerRadius={3}
            anchorFill="#f7e8bd"
            anchorSize={12}
            anchorStroke="#8a6422"
            anchorStrokeWidth={2.2}
            borderDash={[10, 4]}
            borderStroke="#d8bd76"
            borderStrokeWidth={2}
            boundBoxFunc={(oldBox, newBox) =>
              newBox.width < 12 || newBox.height < 12 ? oldBox : newBox
            }
            listening={!isMaskMode}
            padding={6}
            ref={transformerRef}
            rotateAnchorOffset={34}
            rotateEnabled
            visible={!isMaskMode}
          />
        </Layer>
      </Stage>
    </div>
  );
}

function ImageObjectNode({
  asset,
  isMaskMode,
  object,
  onClick,
  onContextMenu,
  onTouchEnd,
  onTouchMove,
  onTouchStart,
  onDragEnd,
  onTransformEnd,
  registerNode,
}: BoardObjectNodeProps<BoardImageObject> & { asset: AssetPayload | undefined }) {
  const { image } = useKonvaImage(asset ? apiUrl(asset.publicUrl) : undefined);

  return (
    <KonvaImage
      draggable={!isMaskMode && !object.locked}
      height={object.h}
      image={image ?? undefined}
      onClick={(event) => onClick(object.id, event)}
      onContextMenu={(event) => onContextMenu(object.id, event)}
      onTouchEnd={onTouchEnd}
      onTouchMove={(event) => onTouchMove(object.id, event)}
      onTouchStart={(event) => onTouchStart(object.id, event)}
      onDragEnd={(event) => onDragEnd(object.id, event.target)}
      onTransformEnd={(event) => onTransformEnd?.(object.id, event.target)}
      ref={(node) => registerNode(object.id, node)}
      rotation={object.rotation}
      width={object.w}
      x={object.x}
      y={object.y}
    />
  );
}

function RectObjectNode({
  isMaskMode,
  object,
  onClick,
  onContextMenu,
  onTouchEnd,
  onTouchMove,
  onTouchStart,
  onDragEnd,
  onTransformEnd,
  registerNode,
}: BoardObjectNodeProps<BoardRectObject>) {
  return (
    <Rect
      draggable={!isMaskMode && !object.locked}
      fill="rgba(184, 137, 47, 0.14)"
      height={object.h}
      onClick={(event) => onClick(object.id, event)}
      onContextMenu={(event) => onContextMenu(object.id, event)}
      onTouchEnd={onTouchEnd}
      onTouchMove={(event) => onTouchMove(object.id, event)}
      onTouchStart={(event) => onTouchStart(object.id, event)}
      onDragEnd={(event) => onDragEnd(object.id, event.target)}
      onTransformEnd={(event) => onTransformEnd?.(object.id, event.target)}
      ref={(node) => registerNode(object.id, node)}
      rotation={object.rotation}
      stroke="#b8892f"
      strokeWidth={2}
      width={object.w}
      x={object.x}
      y={object.y}
    />
  );
}

function TextObjectNode({
  isMaskMode,
  object,
  onClick,
  onContextMenu,
  onTouchEnd,
  onTouchMove,
  onTouchStart,
  onDragEnd,
  registerNode,
}: BoardObjectNodeProps<BoardTextObject>) {
  return (
    <Text
      draggable={!isMaskMode && !object.locked}
      fill="#221d17"
      fontSize={24}
      onClick={(event) => onClick(object.id, event)}
      onContextMenu={(event) => onContextMenu(object.id, event)}
      onTouchEnd={onTouchEnd}
      onTouchMove={(event) => onTouchMove(object.id, event)}
      onTouchStart={(event) => onTouchStart(object.id, event)}
      onDragEnd={(event) => onDragEnd(object.id, event.target)}
      ref={(node) => registerNode(object.id, node)}
      rotation={object.rotation}
      text={object.text}
      x={object.x}
      y={object.y}
    />
  );
}

function PathObjectNode({
  isMaskMode,
  object,
  onClick,
  onContextMenu,
  onTouchEnd,
  onTouchMove,
  onTouchStart,
  onDragEnd,
  registerNode,
}: BoardObjectNodeProps<BoardPathObject>) {
  return (
    <Line
      draggable={!isMaskMode && !object.locked}
      lineCap="round"
      lineJoin="round"
      onClick={(event) => onClick(object.id, event)}
      onContextMenu={(event) => onContextMenu(object.id, event)}
      onTouchEnd={onTouchEnd}
      onTouchMove={(event) => onTouchMove(object.id, event)}
      onTouchStart={(event) => onTouchStart(object.id, event)}
      onDragEnd={(event) => onDragEnd(object.id, event.target)}
      points={flattenPoints(object.points)}
      ref={(node) => registerNode(object.id, node)}
      rotation={object.rotation}
      stroke="#2a241d"
      strokeWidth={3}
    />
  );
}

function flattenPoints(points: Point[]) {
  return points.flatMap((point) => [point.x, point.y]);
}

function worldPointToImagePixelPoint(
  worldPoint: Point,
  object: BoardImageObject,
  asset: AssetPayload | undefined,
): Point | null {
  const radians = (-object.rotation * Math.PI) / 180;
  const dx = worldPoint.x - object.x;
  const dy = worldPoint.y - object.y;
  const localX = dx * Math.cos(radians) - dy * Math.sin(radians);
  const localY = dx * Math.sin(radians) + dy * Math.cos(radians);

  if (localX < 0 || localY < 0 || localX > object.w || localY > object.h) {
    return null;
  }

  const naturalWidth = asset?.width ?? object.w;
  const naturalHeight = asset?.height ?? object.h;

  return {
    x: (localX / object.w) * naturalWidth,
    y: (localY / object.h) * naturalHeight,
  };
}

function getTouchCenter(touches: TouchList): Point {
  const first = touches[0];
  const second = touches[1];
  return {
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2,
  };
}

function getTouchDistance(touches: TouchList) {
  const first = touches[0];
  const second = touches[1];
  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
}
