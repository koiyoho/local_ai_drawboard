"use client";

import { AppIcon } from "@/components/ui/AppIcon";
import { LayerPanel } from "@/components/board-layers/LayerPanel";
import { BoardManagementDrawer } from "@/components/board-management/BoardManagementDrawer";
import { useBoardActions } from "@/components/board-management/useBoardActions";
import { BoardGlobalMenu } from "@/components/board-menu/BoardGlobalMenu";
import { StoryboardWorkspace } from "@/components/storyboard/StoryboardWorkspace";
import {
  ArrowBendUpLeft,
  ArrowBendUpRight,
  BoundingBox,
  DownloadSimple,
  Export,
  ImageSquare,
  PaintBrush,
  Selection,
  Square as PhosphorSquare,
  TextT,
  Trash,
} from "@phosphor-icons/react";
import {
  IconAddImage,
  IconAi,
  IconAlignBottom,
  IconAlignCenterX,
  IconAlignCenterY,
  IconAlignLeft,
  IconAlignRight,
  IconAlignTop,
  IconAssets,
  IconBack,
  IconBoards,
  IconBringForward,
  IconBringToFront,
  IconClose,
  IconCopy,
  IconCrop,
  IconDelete,
  IconDistributeHorizontal,
  IconDistributeVertical,
  IconDownload,
  IconDragHandle,
  IconFitCanvas,
  IconGrid,
  IconLayers,
  IconLoading,
  IconMinus,
  IconPaint,
  IconPlus,
  IconPointer,
  IconRedo,
  IconRename,
  IconRefresh,
  IconSendBackward,
  IconSendToBack,
  IconStar,
  IconUndo,
  IconSave,
  IconImage,
  IconAiEdit,
} from "@/components/ui/icons";
import { getBoardTemplates, getCurrentUser, logout, type BoardTemplatePayload } from "@/client/api";
import { adminRouteHref } from "@/client/routing";
import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { apiFetch, apiUrl } from "@/lib/api-client";
import { canAccessAdmin } from "@/lib/admin-access";
import {
  appendArtStyleInstruction,
  boardArtStyleOptions,
  boardAspectRatioOptions,
  getAspectFromImageSize,
  getAvailableQualityOptions,
  getBoardAspectRatioSelection,
  getImageSizeForAspectQuality,
  getImageSizeForSourceAspect,
  getQualityFromImageSize,
  type BoardArtStyle,
  type BoardAspectRatio,
  type BoardQuality,
} from "@/lib/board-ui-options";
import { createProjectTimestampFilename, getImageExtension } from "@/lib/filenames";
import { getResultPickerComparisonPair, getResultPickerSummary } from "@/lib/result-picker";
import {
  dataUrlToBlob,
  isValidImageSize,
  type ImageSize,
} from "@/lib/image";
import {
  buildMultiAnglePrompt,
  defaultMultiAngleOptionValue,
  multiAngleOptions,
  type MultiAngleOptionValue,
} from "@/lib/multi-angle-generation";
import type { PromptSafetyMode } from "@/lib/prompt-safety";
import {
  getDefaultProviderModelSelection,
  getProviderModelOptionValue,
  normalizeProviderModelSelection,
  parseConfiguredModelValue,
  providerModelOptionMatchesSelection,
  type ProviderModelChannel,
} from "@/lib/provider-models";
import {
  isReferenceRole,
  referenceRoleInstruction,
  referenceRoleOptions,
  type ReferenceRole,
} from "@/lib/reference-roles";
import {
  createPersistedBoardSnapshot,
  createBoardHistory,
  alignObjectsOnCurrentPage,
  appendObjectsToCurrentPage,
  autoLayoutObjectsOnCurrentPage,
  duplicateObjectsOnCurrentPage,
  distributeObjectsOnCurrentPage,
  getBoardDocumentFromSnapshot,
  groupObjectsOnCurrentPage,
  moveObjectsOnCurrentPage,
  pushBoardHistory,
  redoBoardHistory,
  removeUnlockedObjectsFromCurrentPage,
  resolveGroupedSelectionOnCurrentPage,
  reorderObjectsOnCurrentPage,
  ungroupObjectsOnCurrentPage,
  undoBoardHistory,
  type BoardAutoLayoutMode,
  type BoardAlignment,
  type BoardDocument,
  type BoardDistribution,
  type BoardImageObject,
  type BoardHistory,
  type BoardObject,
  type BoardReorderAction,
  type BoardTextObject,
} from "./board-canvas/board-document";
import {
  createBatchExportFilename,
  exportObjectsToPng,
  getBatchExportBatches,
  type BatchExportMode,
} from "./board-canvas/export-board";
import { KonvaBoardCanvas } from "./board-canvas/KonvaBoardCanvas";
import { clampToolbarOffset } from "./board-canvas/toolbar-position";
import type { AssetPayload, BoardPayload, JobPayload, ShapePlacement, StoryboardProjectPayload, StoryboardShotPayload } from "./board-canvas/types";
import { fitBoundsToViewport, getObjectBounds, worldToScreen, type BoardViewport, type Point } from "./board-canvas/viewport";

export type { BoardPayload } from "./board-canvas/types";

function BoardWorkspaceDesktop({ children, view }: { children: ReactNode; view: WorkspaceView }) {
  return <div className={`board-page-shell board-workspace-desktop-shell mobile-view-${view}`}>{children}</div>;
}

function BoardWorkspaceMobile({
  children,
  sheetLevel,
  view,
}: {
  children: ReactNode;
  sheetLevel: MobileSheetLevel;
  view: WorkspaceView;
}) {
  return (
    <div className={`board-page-shell board-workspace-mobile-shell mobile-view-${view} sheet-${sheetLevel}`}>
      {children}
    </div>
  );
}

type GenerationJobParams = {
  count?: number;
  model?: string;
  referenceAssetIds?: string[];
  referenceItems?: ReferenceItem[];
  size?: string;
};

type ImageModelOption = {
  channel?: ProviderModelChannel;
  id: string;
  label: string;
};

type MaskStroke = Array<{ x: number; y: number }>;
type MaskState = {
  assetId: string;
  strokes: MaskStroke[];
};

type PreserveStrength = "strict" | "balanced" | "flexible";
type ReferenceFit = "balanced" | "shape" | "material" | "exact";
type ReferenceWeight = "low" | "medium" | "high";
type ReferencePreset = "outfit" | "product" | "logo" | "scene";
type ReferenceConflictStrategy = "blend" | "prefer_high" | "manual";
type ReferenceGroupKey = "person" | "clothing" | "product" | "scene" | "unmarked";
type ReferenceAssetMap = Partial<Record<ReferenceRole, string>>;
type ReferenceItem = {
  assetId: string;
  role?: ReferenceRole;
  weight?: ReferenceWeight;
};
type ResolvedReferenceAsset = {
  value: string;
  label: string;
  role?: ReferenceRole;
  weight?: ReferenceWeight;
  asset: AssetPayload;
};
type PromptAssistAction = "optimize" | "expand" | "variations" | "translate";
type PromptAssistEngine = "standard" | "skill2";
type PromptAssistSource = "assist" | "safety";
type PromptAssistImageType =
  | "auto"
  | "ui"
  | "infographic"
  | "poster"
  | "ecommerce"
  | "person"
  | "photo"
  | "scene"
  | "object"
  | "brand"
  | "architecture"
  | "illustration"
  | "character"
  | "publication"
  | "other";
type PromptAssistResult = {
  notes: string[];
  prompt: string;
  variations: string[];
};

type AppSnapshot = {
  artStyle?: BoardArtStyle;
  generationCount?: number;
  maskBrushRatio?: number;
  maskFeatherRatio?: number;
  maskState?: MaskState | null;
  prompt?: string;
  preserveStrength?: PreserveStrength;
  referenceFit?: ReferenceFit;
  referenceAssetIds?: string[];
  referenceAssetIdsByRole?: ReferenceAssetMap;
  referenceConflictStrategy?: ReferenceConflictStrategy;
  referenceItems?: ReferenceItem[];
  reversePromptByAssetId?: Record<string, string>;
  selectedAspectRatio?: BoardAspectRatio;
  sourceImageSize?: ImageSize;
  selectedImageModel?: string;
  sourceAssetId?: string;
  sourcePrompt?: string;
  toolbarOffset?: Point;
};

type SelectionInfo = {
  pageShapeCount: number;
  selectedCount: number;
};
type BoardToolbarAction<TAction extends string> = {
  action: TAction;
  icon: typeof IconAlignLeft;
  title: string;
};
type CanvasContextMenu = {
  objectId: string;
  x: number;
  y: number;
};
type ToolbarDragState = {
  pointerId: number;
  startOffset: Point;
  startPointer: Point;
};

type WorkspaceView = "canvas" | "generate" | "edit" | "storyboard" | "assets" | "more";
type DesktopWorkspaceView = "generate" | "edit" | "storyboard" | "assets";
type MobileSheetLevel = "collapsed" | "half" | "full";
type MobileAssetsTab = "current" | "history" | "versions";
type AssetKindFilter = "all" | "upload" | "generated" | "source" | "mask";
type GenerationNotice = {
  scope: "source" | "edit";
  tone: "success" | "error";
  text: string;
};
type ActiveGeneration = {
  modeLabel: string;
  prompt: string;
  startedAtMs: number;
  statusText?: string;
  taskLabel?: string;
};
type AssetMetadataPatch = {
  isFavorite?: boolean;
  tags?: string[];
};
type AssetListResponse = {
  assets?: Array<AssetPayload & { tags?: string[] }>;
  nextCursor?: string | null;
  totalMatching?: number;
};
type BoardSnapshotSummary = {
  createdAt: string;
  id: string;
  kind: "auto" | "manual" | string;
  name: string | null;
  version: number;
};
type PromptRecipePayload = {
  createdAt: string;
  id: string;
  mode: "text_to_image" | "inpaint" | string;
  name: string;
  params: Record<string, unknown>;
  prompt: string;
  updatedAt: string;
};

const assetKindLabels: Record<string, string> = {
  generated: "生成",
  mask: "蒙版",
  source: "源图",
  upload: "上传",
};
const assetKindFilterOptions: Array<{ value: AssetKindFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "upload", label: "上传" },
  { value: "generated", label: "生成" },
  { value: "source", label: "源图" },
  { value: "mask", label: "蒙版" },
];
const referenceRoleGroups: Array<{
  label: string;
  options: Array<(typeof referenceRoleOptions)[number]>;
}> = [
  {
    label: "人物",
    options: referenceRoleOptions.filter((option) =>
      ["subject", "face", "hair", "makeup", "body", "action"].includes(option.value),
    ),
  },
  {
    label: "服装",
    options: referenceRoleOptions.filter((option) =>
      [
        "clothing",
        "top",
        "bottom",
        "dress",
        "outerwear",
        "fabric",
        "colorPalette",
        "shoes",
        "bag",
        "hat",
        "accessory",
      ].includes(option.value),
    ),
  },
  {
    label: "商品",
    options: referenceRoleOptions.filter((option) =>
      ["product", "logo", "material", "packaging"].includes(option.value),
    ),
  },
  {
    label: "画面",
    options: referenceRoleOptions.filter((option) =>
      ["scene", "background", "composition", "lighting", "camera", "style", "mood"].includes(option.value),
    ),
  },
];
const ASSET_LIBRARY_PAGE_SIZE = 50;
const ASSET_LIBRARY_SEARCH_DEBOUNCE_MS = 250;

const targetEditInstruction =
  "Use the first image as the source image. Identify the target object or region from the user's instruction and replace that target with the relevant reference content; do not simply reproduce the source image unchanged.";

const preserveStrengthOptions: Array<{ value: PreserveStrength; label: string; instruction: string }> = [
  {
    value: "strict",
    label: "严格保留主体",
    instruction:
      "Be conservative: preserve identity, face, pose, hands, body proportions, lighting, camera angle, and every unmasked area as much as possible.",
  },
  {
    value: "balanced",
    label: "平衡保留",
    instruction:
      "Balance preservation and replacement quality: keep the source identity, pose, lighting, and unmasked regions stable while allowing natural adjustments inside the mask.",
  },
  {
    value: "flexible",
    label: "更自然融合",
    instruction:
      "Prioritize a natural final image inside the mask while still keeping unmasked regions unchanged and avoiding unnecessary changes to identity or pose.",
  },
];

const referenceFitOptions: Array<{ value: ReferenceFit; label: string; instruction: string }> = [
  {
    value: "balanced",
    label: "平衡参考",
    instruction:
      "Use reference images as visual guidance for the target object, clothing, style, or background without copying unrelated composition.",
  },
  {
    value: "shape",
    label: "优先轮廓",
    instruction:
      "Prioritize the silhouette, structure, size, and placement from the relevant reference image.",
  },
  {
    value: "material",
    label: "优先材质颜色",
    instruction:
      "Prioritize material, color, texture, pattern, branding, and surface details from the relevant reference image.",
  },
  {
    value: "exact",
    label: "严格贴合参考",
    instruction:
      "Match the relevant reference image as closely as possible for shape, material, color, texture, and visible details, while respecting the mask and source lighting.",
  },
];
const referenceWeightOptions: Array<{ value: ReferenceWeight; label: string; instruction: string }> = [
  { value: "low", label: "低", instruction: "Use this reference lightly; treat it as secondary inspiration." },
  { value: "medium", label: "中", instruction: "Use this reference as normal guidance." },
  { value: "high", label: "高", instruction: "Prioritize this reference strongly for its labeled role." },
];
const referenceConflictStrategyOptions: Array<{ value: ReferenceConflictStrategy; label: string; instruction: string }> = [
  {
    value: "blend",
    label: "合并参考",
    instruction: "If multiple references share the same role, blend them by visual consistency and avoid copying contradictory details.",
  },
  {
    value: "prefer_high",
    label: "优先高强度",
    instruction: "If multiple references share the same role, prioritize high influence references and treat lower influence references as secondary.",
  },
  {
    value: "manual",
    label: "手动保留",
    instruction: "If multiple references share the same role, preserve each labeled reference only for its clearly visible compatible details; do not merge conflicting details.",
  },
];

const DEFAULT_MASK_BRUSH_RATIO = 0.035;
const DEFAULT_MASK_FEATHER_RATIO = 0.012;
const mobileMaskColorOptions = ["#b8892f", "#d28b34", "#8b7357", "#f0d492", "#5a5248"];
const DEFAULT_GENERATION_COUNT = 1;
const MAX_GENERATION_COUNT = 3;
const DEFAULT_SOURCE_IMAGE_SIZE: ImageSize = "2048x1152";
const DEFAULT_IMAGE_MODEL = "gpt-image-2";
const DEFAULT_PRESERVE_STRENGTH: PreserveStrength = "balanced";
const DEFAULT_REFERENCE_FIT: ReferenceFit = "balanced";
const GENERATION_RECOVERY_ATTEMPTS = 40;
const GENERATION_RECOVERY_DELAY_MS = 1500;
const GENERATION_RECOVERY_CLOCK_SKEW_MS = 5000;
const MAX_PROMPT_LENGTH = 20000;
const MAX_REFERENCE_ASSETS = 8;
const DEFAULT_IMAGE_INSERT_X = 120;
const DEFAULT_IMAGE_INSERT_Y = 120;
const IMAGE_INSERT_GAP = 32;
const STORYBOARD_CARD_WIDTH = 320;
const STORYBOARD_CARD_HEIGHT = 188;
const STORYBOARD_CARD_GAP = 28;
const BOARD_DUPLICATE_OFFSET = { x: 24, y: 24 };
const BOARD_NUDGE_STEP = 1;
const BOARD_NUDGE_LARGE_STEP = 10;
const DEFAULT_VIEWPORT: BoardViewport = { x: 0, y: 0, zoom: 1 };
const DEFAULT_TOOLBAR_OFFSET: Point = { x: 0, y: -68 };
const DEFAULT_BOARD_ASPECT_RATIO: BoardAspectRatio = "16:9";
const DEFAULT_EDIT_ASPECT_RATIO: BoardAspectRatio = "auto";
const DEFAULT_BOARD_QUALITY: BoardQuality = "2k";
const DEFAULT_BOARD_ART_STYLE: BoardArtStyle = "auto";

const boardAlignmentActions: Array<BoardToolbarAction<BoardAlignment>> = [
  { action: "left", icon: IconAlignLeft, title: "左对齐" },
  { action: "centerX", icon: IconAlignCenterX, title: "水平居中" },
  { action: "right", icon: IconAlignRight, title: "右对齐" },
  { action: "top", icon: IconAlignTop, title: "顶对齐" },
  { action: "centerY", icon: IconAlignCenterY, title: "垂直居中" },
  { action: "bottom", icon: IconAlignBottom, title: "底对齐" },
];

const boardDistributionActions: Array<BoardToolbarAction<BoardDistribution>> = [
  { action: "horizontal", icon: IconDistributeHorizontal, title: "水平分布" },
  { action: "vertical", icon: IconDistributeVertical, title: "垂直分布" },
];

const boardAutoLayoutActions: Array<BoardToolbarAction<BoardAutoLayoutMode>> = [
  { action: "grid", icon: IconGrid, title: "网格排版" },
  { action: "beforeAfter", icon: IconCrop, title: "前后对比" },
];

const boardReorderActions: Array<BoardToolbarAction<BoardReorderAction>> = [
  { action: "front", icon: IconBringToFront, title: "置于顶层" },
  { action: "forward", icon: IconBringForward, title: "上移一层" },
  { action: "backward", icon: IconSendBackward, title: "下移一层" },
  { action: "back", icon: IconSendToBack, title: "置于底层" },
];
const pendingReversePromptStorageKey = "aiboard.pendingReversePrompt";

const mobileWorkspaceViewLabels: Record<WorkspaceView, string> = {
  canvas: "画布",
  more: "更多",
  generate: "AI 生图",
  edit: "AI 改图",
  storyboard: "分镜",
  assets: "素材",
};

const desktopWorkspaceViews: DesktopWorkspaceView[] = ["generate", "edit", "storyboard", "assets"];

export function BoardWorkspace({
  initialBoard,
  initialSnapshot,
}: {
  initialBoard: BoardPayload;
  initialSnapshot: unknown;
}) {
  const initialAppSnapshot = getAppSnapshot(initialSnapshot);
  const initialReferenceItems =
    initialAppSnapshot.referenceItems ??
    getReferenceItemsFromLegacyState(
      initialAppSnapshot.referenceAssetIds,
      initialAppSnapshot.referenceAssetIdsByRole,
    );
  const initialReferenceAssetIds = initialReferenceItems.map((item) => item.assetId);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mobileDraftStrokeRef = useRef<MaskStroke>([]);
  const canvasAreaRef = useRef<HTMLElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const toolbarDragStateRef = useRef<ToolbarDragState | null>(null);
  const mobileSheetDragRef = useRef<{ level: MobileSheetLevel; startY: number } | null>(null);
  const boardDocumentRef = useRef<BoardDocument>(getBoardDocumentFromSnapshot(initialSnapshot));
  const boardHistoryRef = useRef<BoardHistory>(createBoardHistory(boardDocumentRef.current));
  const boardClipboardRef = useRef<string[]>([]);
  const promptAssistRequestIdRef = useRef(0);
  const assetListRequestKeyRef = useRef("");
  const assetListGenerationRef = useRef(0);
  const assetListNextCursorRef = useRef<string | null>(null);
  const visibleImageAssetsRef = useRef<AssetPayload[]>(
    initialBoard.assets.filter((asset) => asset.mimeType.startsWith("image/")),
  );
  const [board, setBoard] = useState(initialBoard);
  const [storyboardProject, setStoryboardProject] = useState<StoryboardProjectPayload | null>(
    initialBoard.storyboardProject ?? null,
  );
  const boardActions = useBoardActions(board.id);
  const [isMobileShell, setIsMobileShell] = useState(false);
  const [boardDocument, setBoardDocument] = useState(boardDocumentRef.current);
  const [boardHistory, setBoardHistory] = useState(boardHistoryRef.current);
  const [isGlobalMenuOpen, setIsGlobalMenuOpen] = useState(false);
  const [isBoardDrawerOpen, setIsBoardDrawerOpen] = useState(false);
  const [isLayerPanelOpen, setIsLayerPanelOpen] = useState(false);
  const [isCanvasMoreMenuOpen, setIsCanvasMoreMenuOpen] = useState(false);
  const [collapsedLayerGroupIds, setCollapsedLayerGroupIds] = useState<string[]>([]);
  const [currentUserRole, setCurrentUserRole] = useState("");
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
  const [viewport, setViewport] = useState<BoardViewport>(DEFAULT_VIEWPORT);
  const [toolbarOffset, setToolbarOffset] = useState<Point>(initialAppSnapshot.toolbarOffset ?? DEFAULT_TOOLBAR_OFFSET);
  const [sourcePrompt, setSourcePrompt] = useState(initialAppSnapshot.sourcePrompt ?? "");
  const [promptAssistAction, setPromptAssistAction] = useState<PromptAssistAction>("optimize");
  const [promptAssistEngine, setPromptAssistEngine] = useState<PromptAssistEngine>("standard");
  const [promptAssistSource, setPromptAssistSource] = useState<PromptAssistSource>("assist");
  const [promptAssistImageType, setPromptAssistImageType] = useState<PromptAssistImageType>("auto");
  const [promptAssistResult, setPromptAssistResult] = useState<PromptAssistResult | null>(null);
  const [isPromptAssistDialogOpen, setIsPromptAssistDialogOpen] = useState(false);
  const [promptAssistError, setPromptAssistError] = useState("");
  const [isPromptAssistLoading, setIsPromptAssistLoading] = useState(false);
  const [prompt, setPrompt] = useState(initialAppSnapshot.prompt ?? "");
  const [sourceImageSize, setSourceImageSize] = useState<ImageSize>(
    initialAppSnapshot.sourceImageSize ?? DEFAULT_SOURCE_IMAGE_SIZE,
  );
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<BoardAspectRatio>(
    initialAppSnapshot.selectedAspectRatio ?? DEFAULT_EDIT_ASPECT_RATIO,
  );
  const [selectedQuality, setSelectedQuality] = useState<BoardQuality>(
    getQualityFromImageSize(initialAppSnapshot.sourceImageSize ?? getImageSizeForAspectQuality(DEFAULT_BOARD_ASPECT_RATIO, DEFAULT_BOARD_QUALITY)),
  );
  const [artStyle, setArtStyle] = useState<BoardArtStyle>(
    initialAppSnapshot.artStyle ?? DEFAULT_BOARD_ART_STYLE,
  );
  const [selectedImageModel, setSelectedImageModel] = useState(
    initialAppSnapshot.selectedImageModel ?? DEFAULT_IMAGE_MODEL,
  );
  const [imageModelOptions, setImageModelOptions] = useState<ImageModelOption[]>([
    { id: initialAppSnapshot.selectedImageModel ?? DEFAULT_IMAGE_MODEL, label: initialAppSnapshot.selectedImageModel ?? DEFAULT_IMAGE_MODEL },
  ]);
  const [reversePromptModelOptions, setReversePromptModelOptions] = useState<ImageModelOption[]>([
    { id: "gpt-5.5", label: "gpt-5.5" },
  ]);
  const [selectedReversePromptModel, setSelectedReversePromptModel] = useState("gpt-5.5");
  const [imageModelStatus, setImageModelStatus] = useState("");
  const [generationCount, setGenerationCount] = useState(
    initialAppSnapshot.generationCount ?? DEFAULT_GENERATION_COUNT,
  );
  const [status, setStatus] = useState("就绪");
  const [desktopView, setDesktopView] = useState<DesktopWorkspaceView>("generate");
  const [mobileView, setMobileView] = useState<WorkspaceView>("canvas");
  const [mobileSheetLevel, setMobileSheetLevel] = useState<MobileSheetLevel>("collapsed");
  const [mobileAssetsTab, setMobileAssetsTab] = useState<MobileAssetsTab>("current");
  const [isMobileResultStripDismissed, setIsMobileResultStripDismissed] = useState(false);
  const [assetSearchQuery, setAssetSearchQuery] = useState("");
  const [assetFavoriteOnly, setAssetFavoriteOnly] = useState(false);
  const [assetKindFilter, setAssetKindFilter] = useState<AssetKindFilter>("all");
  const [assetTagFilter, setAssetTagFilter] = useState("");
  const [visibleImageAssets, setVisibleImageAssets] = useState<AssetPayload[]>(
    initialBoard.assets.filter((asset) => asset.mimeType.startsWith("image/")),
  );
  const [assetListNextCursor, setAssetListNextCursor] = useState<string | null>(null);
  const [assetListTotalMatching, setAssetListTotalMatching] = useState<number | null>(null);
  const [assetListError, setAssetListError] = useState("");
  const [isAssetListLoading, setIsAssetListLoading] = useState(false);
  const [assetListRefreshKey, setAssetListRefreshKey] = useState(0);
  const [boardSnapshots, setBoardSnapshots] = useState<BoardSnapshotSummary[]>([]);
  const [boardSnapshotName, setBoardSnapshotName] = useState("");
  const [boardSnapshotError, setBoardSnapshotError] = useState("");
  const [isBoardSnapshotLoading, setIsBoardSnapshotLoading] = useState(false);
  const [isBoardSnapshotSaving, setIsBoardSnapshotSaving] = useState(false);
  const [activeBoardSnapshotId, setActiveBoardSnapshotId] = useState("");
  const [boardTemplates, setBoardTemplates] = useState<BoardTemplatePayload[]>([]);
  const [promptRecipes, setPromptRecipes] = useState<PromptRecipePayload[]>([]);
  const [promptRecipeName, setPromptRecipeName] = useState("");
  const [promptRecipeError, setPromptRecipeError] = useState("");
  const [isPromptRecipeLoading, setIsPromptRecipeLoading] = useState(false);
  const [resultPickerJobId, setResultPickerJobId] = useState("");
  const [resultPickerComparisonAssetId, setResultPickerComparisonAssetId] = useState("");
  const [mobileDraftStroke, setMobileDraftStroke] = useState<MaskStroke>([]);
  const [mobileMaskColor, setMobileMaskColor] = useState("");
  const [mobileMaskRedoStrokes, setMobileMaskRedoStrokes] = useState<MaskStroke[]>([]);
  const [mobileSourceZoom] = useState(1);
  const [isMobileSyncing, setIsMobileSyncing] = useState(false);
  const [assetPreviewAsset, setAssetPreviewAsset] = useState<AssetPayload | null>(null);
  const [assetPreviewZoom, setAssetPreviewZoom] = useState(1);
  const [reversePromptAsset, setReversePromptAsset] = useState<AssetPayload | null>(null);
  const [reversePromptByAssetId, setReversePromptByAssetId] = useState<Record<string, string>>(
    initialAppSnapshot.reversePromptByAssetId ?? {},
  );
  const [reversePromptErrorByAssetId, setReversePromptErrorByAssetId] = useState<Record<string, string>>({});
  const [reversePromptLoadingAssetId, setReversePromptLoadingAssetId] = useState("");
  const [reversePromptCopied, setReversePromptCopied] = useState(false);
  const [openReferenceRoleAssetId, setOpenReferenceRoleAssetId] = useState("");
  const [collapsedReferenceGroups, setCollapsedReferenceGroups] = useState<ReferenceGroupKey[]>([]);
  const [isGenerationChecklistExpanded, setIsGenerationChecklistExpanded] = useState(false);
  const [generationNotice, setGenerationNotice] = useState<GenerationNotice | null>(null);
  const [activeGeneration, setActiveGeneration] = useState<ActiveGeneration | null>(null);
  const [clockNowMs, setClockNowMs] = useState(Date.now());
  const [sourceAssetId, setSourceAssetId] = useState(initialAppSnapshot.sourceAssetId ?? "");
  const [preserveStrength, setPreserveStrength] = useState<PreserveStrength>(
    initialAppSnapshot.preserveStrength ?? DEFAULT_PRESERVE_STRENGTH,
  );
  const [referenceFit, setReferenceFit] = useState<ReferenceFit>(
    initialAppSnapshot.referenceFit ?? DEFAULT_REFERENCE_FIT,
  );
  const [referenceConflictStrategy, setReferenceConflictStrategy] = useState<ReferenceConflictStrategy>(
    getValidReferenceConflictStrategy(initialAppSnapshot.referenceConflictStrategy),
  );
  const [referenceAssetIds, setReferenceAssetIds] = useState<string[]>(initialReferenceAssetIds);
  const [referenceItems, setReferenceItems] = useState<ReferenceItem[]>(initialReferenceItems);
  const [referenceAssetIdsByRole, setReferenceAssetIdsByRole] = useState<ReferenceAssetMap>(
    initialAppSnapshot.referenceAssetIdsByRole ?? {},
  );
  const [currentToolId, setCurrentToolId] = useState("select");
  const [canvasContextMenu, setCanvasContextMenu] = useState<CanvasContextMenu | null>(null);
  const [maskBrushRatio, setMaskBrushRatio] = useState(
    initialAppSnapshot.maskBrushRatio ?? DEFAULT_MASK_BRUSH_RATIO,
  );
  const [maskFeatherRatio, setMaskFeatherRatio] = useState(
    initialAppSnapshot.maskFeatherRatio ?? DEFAULT_MASK_FEATHER_RATIO,
  );
  const [maskState, setMaskState] = useState<MaskState | null>(
    initialAppSnapshot.maskState ?? null,
  );
  const isAdmin = canAccessAdmin({ role: currentUserRole, username: currentUsername });
  const [isPending, startTransition] = useTransition();

  const imageAssets = useMemo(
    () => board.assets.filter((asset) => asset.mimeType.startsWith("image/")),
    [board.assets],
  );
  const currentPage = useMemo(
    () => boardDocument.pages.find((page) => page.id === boardDocument.currentPageId) ?? boardDocument.pages[0],
    [boardDocument],
  );
  const pageObjects = currentPage?.objects ?? [];
  const selectablePageObjects = useMemo(
    () => pageObjects.filter((object) => !object.hidden && !object.locked),
    [pageObjects],
  );
  const selectableObjectIds = useMemo(
    () => new Set(selectablePageObjects.map((object) => object.id)),
    [selectablePageObjects],
  );
  const activeSelectedObjectIds = useMemo(
    () => selectedObjectIds.filter((id) => selectableObjectIds.has(id)),
    [selectableObjectIds, selectedObjectIds],
  );
  const selectedImageObject = useMemo(
    () =>
      activeSelectedObjectIds
        .map((id) => pageObjects.find((object) => object.id === id))
        .find((object): object is BoardImageObject => Boolean(object && object.type === "image")) ?? null,
    [activeSelectedObjectIds, pageObjects],
  );
  const sourceAsset = imageAssets.find((asset) => asset.id === sourceAssetId);
  const selectedCanvasAsset = selectedImageObject
    ? imageAssets.find((asset) => asset.id === selectedImageObject.assetId) ?? null
    : null;
  const selectedImageToolbarPosition = useMemo(() => {
    if (!selectedImageObject) return null;
    const bounds = getObjectBounds(selectedImageObject);
    const anchor = worldToScreen({ x: bounds.x + bounds.w / 2, y: bounds.y }, viewport);
    return {
      left: Math.round(anchor.x),
      top: Math.max(48, Math.round(anchor.y - 54)),
    };
  }, [selectedImageObject, viewport]);
  const sourceAssetSize = sourceAsset ? getSourceImageSize(sourceAsset) : null;
  const activeGenerationText = activeGeneration
    ? `${activeGeneration.statusText ?? `${activeGeneration.taskLabel ?? activeGeneration.modeLabel}进行中`} · 已运行 ${formatDuration(clockNowMs - activeGeneration.startedAtMs)}`
    : "";
  const currentStatusText = activeGeneration ? activeGenerationText : status;
  const activeGenerationElapsed = activeGeneration
    ? formatDuration(clockNowMs - activeGeneration.startedAtMs)
    : "";
  const isGenerating = Boolean(activeGeneration) || isPending;
  const generateButtonLabel =
    activeGeneration?.modeLabel === "AI 生图"
      ? `${activeGeneration.taskLabel ?? "AI 生图"}中 · ${activeGenerationElapsed}`
      : isGenerating
        ? `${activeGeneration?.taskLabel ?? "生成"}中 · ${activeGenerationElapsed || "计时中"}`
        : "开始生成";
  const editButtonLabel =
    activeGeneration?.modeLabel === "AI 改图"
      ? `${activeGeneration.taskLabel ?? "AI 改图"}中 · ${activeGenerationElapsed}`
      : isGenerating
        ? `${activeGeneration?.taskLabel ?? "生成"}中 · ${activeGenerationElapsed || "计时中"}`
        : "开始 AI 改图";
  const activeMobileMaskColor = mobileMaskColor || mobileMaskColorOptions[0];
  const canEditMobileMask = Boolean(sourceAsset && sourceAssetSize && mobileMaskColor);
  const referenceAssets = useMemo(
    () => getResolvedReferenceAssets(referenceItems, imageAssets),
    [imageAssets, referenceItems],
  );
  const groupedReferenceAssets = useMemo(() => getGroupedReferenceAssets(referenceAssets), [referenceAssets]);
  const referenceConflictEntries = useMemo(() => getReferenceConflictEntries(referenceItems), [referenceItems]);
  const markedReferenceCount = referenceItems.filter((item) => item.role).length;
  const highWeightReferenceCount = referenceItems.filter((item) => item.weight === "high").length;
  const latestGenerationJob = board.jobs[0] ?? null;
  const latestGenerationParams = useMemo(
    () => (latestGenerationJob ? getGenerationJobParams(latestGenerationJob) : {}),
    [latestGenerationJob],
  );
  const currentPageName = currentPage?.name ?? "第 1 页";
  const latestGenerationRecord = latestGenerationJob
    ? {
        count: latestGenerationParams.count ?? latestGenerationJob.results.length,
        modeLabel: latestGenerationJob.mode === "text_to_image" ? "AI 生图" : "AI 改图",
        model: latestGenerationParams.model ?? "当前图像模型",
        prompt: latestGenerationJob.prompt,
        referenceCount:
          latestGenerationParams.referenceItems?.length ??
          latestGenerationParams.referenceAssetIds?.length ??
          0,
        resultCount: latestGenerationJob.results.length,
        size: latestGenerationParams.size ?? "未记录",
        status: getGenerationJobStatusLabel(latestGenerationJob.status),
      }
    : null;
  const shouldShowLatestGenerationRecord = Boolean(latestGenerationRecord && !activeGeneration);
  const latestGenerationResults = latestGenerationJob?.results.map((result) => result.asset) ?? [];
  const latestGenerationHasResults = latestGenerationResults.length > 0;
  const latestGenerationHasError = latestGenerationJob?.status === "failed" || generationNotice?.tone === "error";
  const shouldShowMobileResultFilmstrip = latestGenerationHasResults && !isMobileResultStripDismissed;
  const resultPickerJob = resultPickerJobId
    ? board.jobs.find((job) => job.id === resultPickerJobId) ?? null
    : null;
  const resultPickerSummary = resultPickerJob
    ? getResultPickerSummary(resultPickerJob, imageAssets)
    : null;
  const primaryReferenceAsset = referenceAssets[0]?.asset;
  const selectedSourceQualityOptions = getAvailableQualityOptions(selectedAspectRatio);
  const selectedFixedSourceSize = getImageSizeForAspectQuality(selectedAspectRatio, selectedQuality);
  const sourceAspectImageSize = sourceAssetSize ? getImageSizeForSourceAspect(sourceAssetSize) : selectedFixedSourceSize;
  const selectedSourceSize = selectedAspectRatio === "auto" ? sourceAspectImageSize : selectedFixedSourceSize;
  const selectedSourceSizeLabel =
    selectedAspectRatio === "auto"
      ? `自动 · ${selectedSourceSize}`
      : selectedSourceQualityOptions.find((option) => option.value === selectedQuality)?.size ?? selectedSourceSize;
  const currentArtStyleOption =
    boardArtStyleOptions.find((option) => option.value === artStyle) ?? boardArtStyleOptions[0];
  const preserveStrengthOption =
    preserveStrengthOptions.find((option) => option.value === preserveStrength) ??
    preserveStrengthOptions[1];
  const referenceFitOption =
    referenceFitOptions.find((option) => option.value === referenceFit) ?? referenceFitOptions[0];
  const maskStrokes =
    sourceAsset && maskState?.assetId === sourceAsset.id ? maskState.strokes : [];
  const generationChecklistItems = [
    { label: "参考", value: referenceAssets.length > 0 ? `${referenceAssets.length} 张` : "无" },
    { label: "标记", value: markedReferenceCount > 0 ? `${markedReferenceCount} 张` : "未标记" },
    { label: "高强度", value: highWeightReferenceCount > 0 ? `${highWeightReferenceCount} 张` : "无" },
    { label: "匹配", value: referenceFitOption.label },
  ];
  const generationChecklistSummary = [
    `${generationCount} 张`,
    referenceAssets.length > 0 ? `${referenceAssets.length} 张参考` : "无参考",
    referenceFitOption.label,
  ].join(" · ");
  const editChecklistItems = [
    { label: "源图", value: sourceAsset ? "已就绪" : "缺失" },
    { label: "参考", value: referenceAssets.length > 0 ? `${referenceAssets.length} 张` : "无" },
    { label: "标记", value: markedReferenceCount > 0 ? `${markedReferenceCount} 张` : "未标记" },
    { label: "蒙版", value: maskStrokes.length > 0 ? `${maskStrokes.length} 条` : "整图" },
    { label: "匹配", value: referenceFitOption.label },
  ];
  const selectionInfo: SelectionInfo = {
    pageShapeCount: pageObjects.length,
    selectedCount: activeSelectedObjectIds.length,
  };
  const workflowStatus = !sourceAsset
    ? "缺源图"
    : maskStrokes.length > 0 && primaryReferenceAsset
      ? `局部 · ${referenceAssets.length} 张参考`
      : maskStrokes.length > 0
        ? "局部涂抹"
        : primaryReferenceAsset
          ? `整图 · ${referenceAssets.length} 张参考`
          : "整图";
  const isSourceOnCanvas = Boolean(
    sourceAsset && pageObjects.some((object) => object.type === "image" && object.assetId === sourceAsset.id && !object.hidden),
  );
  const sourceAssetDimensions = sourceAsset
    ? `${sourceAsset.width ?? getSourceImageSize(sourceAsset).width}×${sourceAsset.height ?? getSourceImageSize(sourceAsset).height}`
    : "";
  const sourceAssetKindLabel = sourceAsset
    ? isSourceOnCanvas
      ? "来自画布"
      : assetKindLabels[sourceAsset.kind] ?? sourceAsset.kind
    : "未选择";
  const desktopEditModeLabel =
    currentToolId === "mask" || maskStrokes.length > 0
      ? "局部涂抹"
      : activeSelectedObjectIds.length > 0
        ? "变体候选"
        : "整图改图";
  const editChecklistSummary = [
    sourceAsset ? "源图已就绪" : "缺源图",
    referenceAssets.length > 0 ? `${referenceAssets.length} 张参考` : "无参考",
    maskStrokes.length > 0 ? `${maskStrokes.length} 条蒙版` : "整图改图",
  ].join(" · ");
  const selectedImageModelLabel =
    imageModelOptions.find((model) => getProviderModelOptionValue(model) === selectedImageModel || model.id === selectedImageModel)?.label ??
    parseConfiguredModelValue(selectedImageModel).id;
  const desktopGenerateActionMeta = [
    `${generationCount} 张`,
    selectedSourceSizeLabel,
    selectedImageModelLabel,
    referenceAssets.length > 0 ? `${referenceAssets.length} 张参考` : "无参考图",
  ];
  const desktopEditActionMeta = [
    desktopEditModeLabel,
    sourceAsset ? sourceAssetKindLabel : "等待源图",
    referenceAssets.length > 0 ? `${referenceAssets.length} 张参考` : "无参考图",
    selectedSourceSizeLabel,
  ];
  const primaryGenerateDisabled =
    isGenerating ||
    !sourceAsset ||
    Boolean(sourceAsset && maskStrokes.length === 0 && !prompt.trim());
  const canClearCurrentPage =
    selectionInfo.pageShapeCount > 0 ||
    Boolean(sourcePrompt.trim()) ||
    Boolean(prompt.trim()) ||
    Boolean(sourceAssetId) ||
    referenceItems.length > 0 ||
    Boolean(maskState) ||
    Boolean(generationNotice);

  const buildAppSnapshot = useCallback(
    (overrides: Partial<AppSnapshot> = {}): AppSnapshot => ({
      artStyle,
      generationCount,
      maskFeatherRatio,
      maskBrushRatio,
      maskState,
      prompt,
      preserveStrength,
      referenceFit,
      referenceAssetIds,
      referenceAssetIdsByRole,
      referenceConflictStrategy,
      referenceItems,
      reversePromptByAssetId,
      selectedAspectRatio,
      selectedImageModel,
      sourceImageSize,
      sourceAssetId,
      sourcePrompt,
      toolbarOffset,
      ...overrides,
    }),
    [
      artStyle,
      generationCount,
      maskBrushRatio,
      maskFeatherRatio,
      maskState,
      prompt,
      preserveStrength,
      referenceFit,
      referenceAssetIds,
      referenceAssetIdsByRole,
      referenceConflictStrategy,
      referenceItems,
      reversePromptByAssetId,
      selectedAspectRatio,
      selectedImageModel,
      sourceAssetId,
      sourceImageSize,
      sourcePrompt,
      toolbarOffset,
    ],
  );

  const saveSnapshot = useCallback(
    async (input?: { allowEmpty?: boolean; appSnapshot?: Partial<AppSnapshot>; document?: BoardDocument; kind?: "auto" | "manual"; name?: string }) => {
      const document = input?.document ?? boardDocumentRef.current;
      const snapshot = createPersistedBoardSnapshot(document, buildAppSnapshot(input?.appSnapshot));
      setStatus("正在保存");
      const response = await apiFetch(`/api/boards/${board.id}/snapshot${input?.allowEmpty ? "?allowEmpty=1" : ""}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: input?.kind,
          name: input?.name,
          snapshot,
        }),
      });
      setStatus(response.ok ? "已保存" : "保存失败");
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        const message = payload.error ?? "保存失败";
        setStatus(message);
        throw new Error(message);
      }
      return (await response.json().catch(() => ({}))) as { version?: number };
    },
    [board.id, buildAppSnapshot],
  );

  const scheduleSave = useCallback(
    (input?: { allowEmpty?: boolean; appSnapshot?: Partial<AppSnapshot>; document?: BoardDocument }) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void saveSnapshot(input).catch(() => undefined);
      }, 900);
    },
    [saveSnapshot],
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 900px)");
    const updateShell = () => setIsMobileShell(mediaQuery.matches);
    updateShell();
    mediaQuery.addEventListener("change", updateShell);
    return () => mediaQuery.removeEventListener("change", updateShell);
  }, []);

  useEffect(() => {
    if (!activeGeneration) return;
    setClockNowMs(Date.now());
    const timer = window.setInterval(() => setClockNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeGeneration]);

  useEffect(() => {
    setSelectedObjectIds((current) => {
      const nextIds = filterExistingObjectIds(boardDocumentRef.current, current);
      return nextIds.length === current.length ? current : nextIds;
    });
    setCanvasContextMenu((current) =>
      current && filterExistingObjectIds(boardDocumentRef.current, [current.objectId]).length === 0 ? null : current,
    );
  }, [boardDocument]);

  useEffect(() => {
    void loadBoardSnapshots();
    void loadPromptRecipes();
    getBoardTemplates()
      .then((payload) => setBoardTemplates(payload.templates))
      .catch(() => setBoardTemplates([]));
  }, [board.id]);

  useEffect(() => {
    visibleImageAssetsRef.current = visibleImageAssets;
  }, [visibleImageAssets]);

  useEffect(() => {
    assetListNextCursorRef.current = assetListNextCursor;
  }, [assetListNextCursor]);

  useEffect(() => {
    const controller = new AbortController();
    const generation = assetListGenerationRef.current + 1;
    assetListGenerationRef.current = generation;
    const requestKey = getAssetListRequestKey({
      favoriteOnly: assetFavoriteOnly,
      kind: assetKindFilter,
      q: assetSearchQuery,
      tag: assetTagFilter,
    });
    assetListRequestKeyRef.current = requestKey;
    const timer = window.setTimeout(() => {
      setIsAssetListLoading(true);
      setAssetListError("");
      apiFetch(
        getBoardAssetsPath(board.id, {
          favoriteOnly: assetFavoriteOnly,
          kind: assetKindFilter,
          limit: ASSET_LIBRARY_PAGE_SIZE,
          q: assetSearchQuery,
          tag: assetTagFilter,
        }),
        { signal: controller.signal },
      )
        .then(async (response) => {
          const payload = (await response.json()) as AssetListResponse & { error?: string };
          if (
            controller.signal.aborted ||
            assetListRequestKeyRef.current !== requestKey ||
            assetListGenerationRef.current !== generation
          ) return;
          if (!response.ok) {
            throw new Error(payload.error ?? "载入素材失败");
          }
          const normalized = normalizeAssetListResponse(payload);
          const assets = normalized.assets.filter((asset) => asset.mimeType.startsWith("image/"));
          setVisibleImageAssets(assets);
          setAssetListNextCursor(normalized.nextCursor);
          setAssetListTotalMatching(normalized.totalMatching);
          mergeAssetsIntoBoard(assets);
        })
        .catch((error) => {
          if (
            controller.signal.aborted ||
            assetListRequestKeyRef.current !== requestKey ||
            assetListGenerationRef.current !== generation
          ) return;
          setAssetListError(getFriendlyErrorMessage(error, "载入素材失败"));
          setVisibleImageAssets([]);
          setAssetListNextCursor(null);
          setAssetListTotalMatching(null);
        })
        .finally(() => {
          if (
            !controller.signal.aborted &&
            assetListRequestKeyRef.current === requestKey &&
            assetListGenerationRef.current === generation
          ) {
            setIsAssetListLoading(false);
          }
        });
    }, ASSET_LIBRARY_SEARCH_DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [assetFavoriteOnly, assetKindFilter, assetListRefreshKey, assetSearchQuery, assetTagFilter, board.id]);

  useEffect(() => {
    let isCancelled = false;
    async function loadCurrentUser() {
      try {
        const { user } = await getCurrentUser();
        if (isCancelled) return;
        setCurrentUserRole(user.role);
        setCurrentUsername(user.username);
      } catch {
        if (isCancelled) return;
        setCurrentUserRole("");
        setCurrentUsername(null);
      }
    }
    void loadCurrentUser();
    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    const pendingPrompt = window.localStorage.getItem(pendingReversePromptStorageKey)?.trim();
    if (!pendingPrompt) return;
    window.localStorage.removeItem(pendingReversePromptStorageKey);
    updateSourcePromptDraft(pendingPrompt);
    setDesktopView("generate");
    setMobileView("generate");
    setStatus("已载入反推提示词");
  }, []);

  useEffect(() => {
    scheduleSave();
  }, [
    generationCount,
    artStyle,
    selectedImageModel,
    maskBrushRatio,
    maskFeatherRatio,
    maskState,
    preserveStrength,
    referenceFit,
    referenceAssetIds,
    referenceAssetIdsByRole,
    referenceItems,
    reversePromptByAssetId,
    scheduleSave,
    sourceImageSize,
    sourceAssetId,
  ]);

  useEffect(() => {
    let isCancelled = false;
    async function loadImageModels() {
      try {
        const response = await apiFetch("/api/provider-settings/model-options");
        const payload = (await response.json().catch(() => ({}))) as {
          imageModels?: ImageModelOption[];
          error?: string;
          models?: ImageModelOption[];
          reversePromptModels?: ImageModelOption[];
          selectedImageModel?: string;
          selectedModel?: string;
          selectedReversePromptModel?: string;
        };
        if (isCancelled) return;
        if (!response.ok) {
          setImageModelStatus(payload.error ?? "请先在本地设置中配置模型接口");
          return;
        }
        const nextImageModels = Array.isArray(payload.imageModels) ? payload.imageModels : payload.models;
        if (Array.isArray(nextImageModels) && nextImageModels.length > 0) {
          setImageModelOptions(nextImageModels);
          const nextModel =
            selectedImageModel && nextImageModels.some((model) => providerModelOptionMatchesSelection(model, selectedImageModel))
              ? normalizeProviderModelSelection(nextImageModels, selectedImageModel)
              : getDefaultProviderModelSelection(nextImageModels, payload.selectedImageModel ?? payload.selectedModel);
          setSelectedImageModel(nextModel);
          setImageModelStatus(payload.error ?? "");
        }
        if (Array.isArray(payload.reversePromptModels) && payload.reversePromptModels.length > 0) {
          setReversePromptModelOptions(payload.reversePromptModels);
          setSelectedReversePromptModel((current) =>
            payload.reversePromptModels!.some((model) => providerModelOptionMatchesSelection(model, current))
              ? normalizeProviderModelSelection(payload.reversePromptModels!, current)
              : getDefaultProviderModelSelection(payload.reversePromptModels!, payload.selectedReversePromptModel),
          );
        }
      } catch {
        if (!isCancelled) setImageModelStatus("");
      }
    }
    void loadImageModels();
    return () => {
      isCancelled = true;
    };
  }, []);

  function toggleGlobalMenu() {
    setIsGlobalMenuOpen((current) => !current);
  }

  function openBoardDrawer() {
    setIsLayerPanelOpen(false);
    setIsBoardDrawerOpen(true);
    void boardActions.refreshBoards().catch(() => undefined);
  }

  function openLayerPanel() {
    setIsBoardDrawerOpen(false);
    setIsLayerPanelOpen(true);
  }

  async function saveCurrentBoard() {
    try {
      await saveSnapshot({ kind: "manual", name: `手动保存 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` });
    } catch (error) {
      setStatus(getFriendlyErrorMessage(error, "保存失败"));
    }
  }

  function openAdmin() {
    window.location.href = adminRouteHref;
  }

  async function signOut() {
    await logout().catch(() => undefined);
    window.location.href = "/login";
  }

  async function renameBoard(boardId: string, name: string) {
    const isRenamed = await boardActions.renameBoard(boardId, name);
    if (isRenamed && boardId === board.id) {
      setBoard((current) => ({ ...current, name }));
    }
    return isRenamed;
  }

  function applyAppSnapshot(snapshot: AppSnapshot) {
    setArtStyle(snapshot.artStyle ?? DEFAULT_BOARD_ART_STYLE);
    setGenerationCount(snapshot.generationCount ?? DEFAULT_GENERATION_COUNT);
    setMaskBrushRatio(snapshot.maskBrushRatio ?? DEFAULT_MASK_BRUSH_RATIO);
    setMaskFeatherRatio(snapshot.maskFeatherRatio ?? DEFAULT_MASK_FEATHER_RATIO);
    setMaskState(snapshot.maskState ?? null);
    setPrompt(snapshot.prompt ?? "");
    setPreserveStrength(snapshot.preserveStrength ?? DEFAULT_PRESERVE_STRENGTH);
    setReferenceFit(snapshot.referenceFit ?? DEFAULT_REFERENCE_FIT);
    const nextReferenceItems =
      snapshot.referenceItems ??
      getReferenceItemsFromLegacyState(snapshot.referenceAssetIds, snapshot.referenceAssetIdsByRole);
    setReferenceItems(nextReferenceItems);
    setReferenceAssetIds(nextReferenceItems.map((item) => item.assetId));
    setReferenceAssetIdsByRole(getReferenceAssetMapFromItems(nextReferenceItems));
    setReversePromptByAssetId(snapshot.reversePromptByAssetId ?? {});
    const nextModel = snapshot.selectedImageModel || DEFAULT_IMAGE_MODEL;
    setSelectedImageModel(nextModel);
    setSourceAssetId(snapshot.sourceAssetId ?? "");
    const nextSourceSize = snapshot.sourceImageSize ?? DEFAULT_SOURCE_IMAGE_SIZE;
    setSourceImageSize(nextSourceSize);
    setSelectedAspectRatio(snapshot.selectedAspectRatio ?? DEFAULT_EDIT_ASPECT_RATIO);
    setSelectedQuality(getQualityFromImageSize(nextSourceSize));
    setSourcePrompt(snapshot.sourcePrompt ?? "");
    setToolbarOffset(snapshot.toolbarOffset ?? DEFAULT_TOOLBAR_OFFSET);
    setMobileDraftStroke([]);
    mobileDraftStrokeRef.current = [];
    setMobileMaskRedoStrokes([]);
  }

  const setDocumentAndSave = useCallback(
    (document: BoardDocument, options: { allowEmpty?: boolean; appSnapshot?: Partial<AppSnapshot>; recordHistory?: boolean } = {}) => {
      const shouldRecordHistory = options.recordHistory ?? true;
      boardDocumentRef.current = document;
      setBoardDocument(document);
      if (shouldRecordHistory) {
        const nextHistory = pushBoardHistory(boardHistoryRef.current, document);
        boardHistoryRef.current = nextHistory;
        setBoardHistory(nextHistory);
      }
      scheduleSave({ allowEmpty: options.allowEmpty, appSnapshot: options.appSnapshot, document });
    },
    [scheduleSave],
  );

  const restoreDocumentHistory = useCallback(
    (history: BoardHistory, statusText: string) => {
      boardHistoryRef.current = history;
      setBoardHistory(history);
      setDocumentAndSave(history.document, { recordHistory: false });
      setSelectedObjectIds((current) => {
        const availableIds = new Set(getCurrentPageObjects(history.document).map((object) => object.id));
        return current.filter((id) => availableIds.has(id));
      });
      setCanvasContextMenu(null);
      setStatus(statusText);
    },
    [setDocumentAndSave],
  );

  const undoBoardDocument = useCallback(() => {
    if (!boardHistoryRef.current.canUndo) {
      setStatus("没有可撤销的操作");
      return;
    }
    restoreDocumentHistory(undoBoardHistory(boardHistoryRef.current), "已撤销");
  }, [restoreDocumentHistory]);

  const redoBoardDocument = useCallback(() => {
    if (!boardHistoryRef.current.canRedo) {
      setStatus("没有可重做的操作");
      return;
    }
    restoreDocumentHistory(redoBoardHistory(boardHistoryRef.current), "已重做");
  }, [restoreDocumentHistory]);

  const appendMaskStroke = useCallback((assetId: string, stroke: MaskStroke) => {
    setMaskState((current) => ({
      assetId,
      strokes: current?.assetId === assetId ? [...current.strokes, stroke] : [stroke],
    }));
    setMobileMaskRedoStrokes([]);
  }, []);

  function getMobileMaskPoint(event: PointerEvent<SVGSVGElement>) {
    if (!sourceAsset) return null;
    const svg = event.currentTarget;
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const localPoint = point.matrixTransform(matrix.inverse());
    const { width, height } = getSourceImageSize(sourceAsset);
    return {
      x: Math.max(0, Math.min(width, localPoint.x)),
      y: Math.max(0, Math.min(height, localPoint.y)),
    };
  }

  function beginMobileMaskStroke(event: PointerEvent<SVGSVGElement>) {
    if (!mobileMaskColor) {
      setStatus("请先选择涂抹颜色，再在源图上操作");
      return;
    }
    const point = getMobileMaskPoint(event);
    if (!sourceAsset || !point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    mobileDraftStrokeRef.current = [point];
    setMobileDraftStroke([point]);
    setStatus("正在源图上标记修改区域");
  }

  function updateMobileMaskStroke(event: PointerEvent<SVGSVGElement>) {
    if (mobileDraftStrokeRef.current.length === 0) return;
    const point = getMobileMaskPoint(event);
    if (!point) return;
    event.preventDefault();
    const previous = mobileDraftStrokeRef.current.at(-1);
    if (previous && getDistance(previous, point) < 3) return;
    mobileDraftStrokeRef.current = [...mobileDraftStrokeRef.current, point];
    setMobileDraftStroke(mobileDraftStrokeRef.current);
  }

  function finishMobileMaskStroke(event: PointerEvent<SVGSVGElement>) {
    if (!sourceAsset || mobileDraftStrokeRef.current.length === 0) return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    appendMaskStroke(sourceAsset.id, mobileDraftStrokeRef.current);
    mobileDraftStrokeRef.current = [];
    setMobileDraftStroke([]);
    setStatus("已在源图上标记修改区域");
  }

  function cancelMobileMaskStroke() {
    mobileDraftStrokeRef.current = [];
    setMobileDraftStroke([]);
  }

  function getClampedToolbarOffset(nextOffset: Point) {
    const canvasRect = canvasAreaRef.current?.getBoundingClientRect();
    const toolbarRect = toolbarRef.current?.getBoundingClientRect();
    if (!canvasRect || !toolbarRect) return nextOffset;
    return clampToolbarOffset({
      canvasSize: { h: canvasRect.height, w: canvasRect.width },
      offset: nextOffset,
      toolbarSize: { h: toolbarRect.height, w: toolbarRect.width },
    });
  }

  function beginToolbarDrag(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    toolbarDragStateRef.current = {
      pointerId: event.pointerId,
      startOffset: toolbarOffset,
      startPointer: { x: event.clientX, y: event.clientY },
    };
    setStatus("正在移动工具条");
  }

  function updateToolbarDrag(event: PointerEvent<HTMLButtonElement>) {
    const dragState = toolbarDragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const nextOffset = getClampedToolbarOffset({
      x: dragState.startOffset.x + event.clientX - dragState.startPointer.x,
      y: dragState.startOffset.y + event.clientY - dragState.startPointer.y,
    });
    setToolbarOffset(nextOffset);
  }

  function finishToolbarDrag(event: PointerEvent<HTMLButtonElement>) {
    const dragState = toolbarDragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    toolbarDragStateRef.current = null;
    const nextOffset = getClampedToolbarOffset({
      x: dragState.startOffset.x + event.clientX - dragState.startPointer.x,
      y: dragState.startOffset.y + event.clientY - dragState.startPointer.y,
    });
    setToolbarOffset(nextOffset);
    scheduleSave({ appSnapshot: { toolbarOffset: nextOffset } });
    setStatus("已移动工具条");
  }

  function cancelToolbarDrag(event: PointerEvent<HTMLButtonElement>) {
    if (toolbarDragStateRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    toolbarDragStateRef.current = null;
  }

  async function refreshBoard() {
    const response = await apiFetch(`/api/boards/${board.id}`);
    const payload = (await response.json()) as { board?: BoardPayload; error?: string };
    if (!response.ok) {
      throw new Error(typeof payload.error === "string" ? payload.error : "同步失败");
    }
    if (!payload.board) {
      throw new Error("同步失败");
    }
    const refreshedBoard = payload.board;
    setBoard((current) => mergeBoardCache(refreshedBoard, current));
    setStoryboardProject(refreshedBoard.storyboardProject ?? null);
    return refreshedBoard;
  }

  async function loadBoardSnapshots() {
    setIsBoardSnapshotLoading(true);
    setBoardSnapshotError("");
    try {
      const response = await apiFetch(`/api/boards/${board.id}/snapshots`);
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        snapshots?: BoardSnapshotSummary[];
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "版本加载失败");
      }
      setBoardSnapshots(payload.snapshots ?? []);
    } catch (error) {
      setBoardSnapshotError(getFriendlyErrorMessage(error, "版本加载失败"));
    } finally {
      setIsBoardSnapshotLoading(false);
    }
  }

  async function saveNamedBoardSnapshot() {
    const name = boardSnapshotName.trim();
    if (!name) {
      setBoardSnapshotError("请输入版本名称");
      return;
    }
    setIsBoardSnapshotSaving(true);
    setBoardSnapshotError("");
    try {
      await saveSnapshot({ kind: "manual", name });
      setBoardSnapshotName("");
      await loadBoardSnapshots();
      setStatus("已保存命名版本");
    } catch (error) {
      setBoardSnapshotError(getFriendlyErrorMessage(error, "保存版本失败"));
    } finally {
      setIsBoardSnapshotSaving(false);
    }
  }

  async function loadPromptRecipes() {
    setIsPromptRecipeLoading(true);
    setPromptRecipeError("");
    try {
      const response = await apiFetch("/api/prompt-recipes");
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        recipes?: PromptRecipePayload[];
      };
      if (!response.ok) throw new Error(payload.error ?? "配方加载失败");
      setPromptRecipes(payload.recipes ?? []);
    } catch (error) {
      setPromptRecipeError(getFriendlyErrorMessage(error, "配方加载失败"));
    } finally {
      setIsPromptRecipeLoading(false);
    }
  }

  async function savePromptRecipe(mode: "text_to_image" | "inpaint") {
    const name = promptRecipeName.trim();
    const promptText = mode === "text_to_image" ? sourcePrompt.trim() : prompt.trim();
    if (!name) {
      setPromptRecipeError("请输入配方名称");
      return;
    }
    if (!promptText) {
      setPromptRecipeError("当前提示词为空，无法保存配方");
      return;
    }
    setIsPromptRecipeLoading(true);
    setPromptRecipeError("");
    try {
      const response = await apiFetch("/api/prompt-recipes", {
        body: JSON.stringify({
          mode,
          name,
          params: getCurrentPromptRecipeParamsFromValues({
            artStyle,
            count: generationCount,
            model: selectedImageModel,
            preserveStrength,
            referenceFit,
            size: selectedSourceSize,
          }),
          prompt: promptText,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        recipe?: PromptRecipePayload;
      };
      if (!response.ok || !payload.recipe) throw new Error(payload.error ?? "保存配方失败");
      setPromptRecipes((current) => [payload.recipe!, ...current.filter((recipe) => recipe.id !== payload.recipe!.id)]);
      setPromptRecipeName("");
      setStatus("已保存提示词配方");
    } catch (error) {
      setPromptRecipeError(getFriendlyErrorMessage(error, "保存配方失败"));
    } finally {
      setIsPromptRecipeLoading(false);
    }
  }

  async function deletePromptRecipe(recipe: PromptRecipePayload) {
    if (!window.confirm(`删除配方「${recipe.name}」？`)) return;
    setIsPromptRecipeLoading(true);
    setPromptRecipeError("");
    try {
      const response = await apiFetch(`/api/prompt-recipes/${recipe.id}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "删除配方失败");
      setPromptRecipes((current) => current.filter((item) => item.id !== recipe.id));
      setStatus("已删除提示词配方");
    } catch (error) {
      setPromptRecipeError(getFriendlyErrorMessage(error, "删除配方失败"));
    } finally {
      setIsPromptRecipeLoading(false);
    }
  }

  async function restoreBoardSnapshot(snapshot: BoardSnapshotSummary) {
    const confirmed = window.confirm("恢复版本会覆盖当前画板内容。建议先保存当前版本，是否继续？");
    if (!confirmed) return;
    setActiveBoardSnapshotId(snapshot.id);
    setBoardSnapshotError("");
    try {
      const response = await apiFetch(`/api/boards/${board.id}/snapshots/${snapshot.id}/restore`, { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; snapshot?: unknown };
      if (!response.ok) {
        throw new Error(payload.error ?? "恢复版本失败");
      }
      const restoredDocument = getBoardDocumentFromSnapshot(payload.snapshot);
      boardDocumentRef.current = restoredDocument;
      const nextHistory = createBoardHistory(restoredDocument);
      boardHistoryRef.current = nextHistory;
      setBoardDocument(restoredDocument);
      setBoardHistory(nextHistory);
      setSelectedObjectIds([]);
      setCanvasContextMenu(null);
      applyAppSnapshot(getAppSnapshot(payload.snapshot));
      await refreshBoard();
      await loadBoardSnapshots();
      setStatus(`已恢复版本 ${snapshot.version}`);
    } catch (error) {
      setBoardSnapshotError(getFriendlyErrorMessage(error, "恢复版本失败"));
    } finally {
      setActiveBoardSnapshotId("");
    }
  }

  async function duplicateBoardSnapshot(snapshot: BoardSnapshotSummary) {
    setActiveBoardSnapshotId(snapshot.id);
    setBoardSnapshotError("");
    try {
      const response = await apiFetch(`/api/boards/${board.id}/snapshots/${snapshot.id}/duplicate`, { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as { board?: { id: string }; error?: string };
      if (!response.ok || !payload.board) {
        throw new Error(payload.error ?? "另存版本失败");
      }
      window.location.href = `/boards/${payload.board.id}`;
    } catch (error) {
      setBoardSnapshotError(getFriendlyErrorMessage(error, "另存版本失败"));
    } finally {
      setActiveBoardSnapshotId("");
    }
  }

  async function syncCurrentBoard() {
    if (isMobileSyncing) return;
    setIsMobileSyncing(true);
    setStatus("正在同步最新内容");
    try {
      await refreshBoard();
      setStatus("已同步最新内容");
    } catch (error) {
      setStatus(getFriendlyErrorMessage(error, "同步失败"));
    } finally {
      setIsMobileSyncing(false);
    }
  }

  function mergeAssetsIntoBoard(assets: AssetPayload[]) {
    if (assets.length === 0) return;
    setBoard((current) => ({
      ...current,
      assets: mergeAssetsById(assets, current.assets),
    }));
  }

  function refreshVisibleAssetList() {
    setAssetListRefreshKey((current) => current + 1);
  }

  function addAssetsToVisibleList(assets: AssetPayload[]) {
    if (normalizeAssetSearchText(assetSearchQuery)) {
      refreshVisibleAssetList();
      return;
    }
    const matchingAssets = assets.filter((asset) =>
      assetMatchesServerListFilters(asset, {
        favoriteOnly: assetFavoriteOnly,
        kind: assetKindFilter,
        q: assetSearchQuery,
        tag: assetTagFilter,
      }),
    );
    if (matchingAssets.length === 0) return;
    const currentIds = new Set(visibleImageAssetsRef.current.map((asset) => asset.id));
    const addedCount = matchingAssets.filter((asset) => !currentIds.has(asset.id)).length;
    if (addedCount === 0) return;
    assetListGenerationRef.current += 1;
    setIsAssetListLoading(false);
    setVisibleImageAssets((current) => mergeAssetsById(matchingAssets, current));
    setAssetListTotalMatching((current) => (typeof current === "number" ? current + addedCount : current));
  }

  async function loadMoreAssets() {
    if (!assetListNextCursor || isAssetListLoading) return;
    const cursor = assetListNextCursor;
    const requestKey = assetListRequestKeyRef.current;
    const generation = assetListGenerationRef.current;
    const controller = new AbortController();
    setIsAssetListLoading(true);
    setAssetListError("");
    try {
      const response = await apiFetch(
        getBoardAssetsPath(board.id, {
          cursor,
          favoriteOnly: assetFavoriteOnly,
          kind: assetKindFilter,
          limit: ASSET_LIBRARY_PAGE_SIZE,
          q: assetSearchQuery,
          tag: assetTagFilter,
        }),
        { signal: controller.signal },
      );
      const payload = (await response.json()) as AssetListResponse & { error?: string };
      if (
        controller.signal.aborted ||
        assetListRequestKeyRef.current !== requestKey ||
        assetListGenerationRef.current !== generation ||
        assetListNextCursorRef.current !== cursor
      ) return;
      if (!response.ok) {
        throw new Error(payload.error ?? "载入更多素材失败");
      }
      const assets = normalizeAssetListResponse(payload).assets.filter((asset) =>
        asset.mimeType.startsWith("image/"),
      );
      setVisibleImageAssets((current) => mergeAssetsById(current, assets));
      setAssetListNextCursor(payload.nextCursor ?? null);
      setAssetListTotalMatching(payload.totalMatching ?? null);
      mergeAssetsIntoBoard(assets);
    } catch (error) {
      if (
        controller.signal.aborted ||
        assetListRequestKeyRef.current !== requestKey ||
        assetListGenerationRef.current !== generation
      ) return;
      setAssetListError(getFriendlyErrorMessage(error, "载入更多素材失败"));
    } finally {
      if (
        !controller.signal.aborted &&
        assetListRequestKeyRef.current === requestKey &&
        assetListGenerationRef.current === generation
      ) {
        setIsAssetListLoading(false);
      }
    }
  }

  function mergeGenerationJobIntoBoard(job: JobPayload | undefined) {
    if (!job) return;
    setBoard((current) => ({
      ...current,
      jobs: [job, ...current.jobs.filter((item) => item.id !== job.id)].sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      ),
    }));
  }

  function updateActiveGenerationStatus(status: string) {
    setActiveGeneration((current) => current ? { ...current, statusText: getGenerationJobStatusLabel(status) } : current);
  }

  async function startGenerationJob(body: Record<string, unknown>) {
    const response = await apiFetch("/api/generation-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, waitForCompletion: false }),
    });
    const payload = (await response.json()) as { error?: string; job?: JobPayload; model?: string; results?: AssetPayload[] };
    if (!response.ok || !payload.job) {
      throw new Error(payload.error ?? "生成失败");
    }
    mergeGenerationJobIntoBoard(payload.job);
    updateActiveGenerationStatus(payload.job.status);
    return payload.job;
  }

  async function waitForGenerationJob(jobId: string) {
    for (;;) {
      await delay(1500);
      const response = await apiFetch(`/api/generation-jobs/${jobId}`);
      const payload = (await response.json()) as { error?: string; job?: JobPayload; results?: AssetPayload[] };
      if (!response.ok || !payload.job) {
        throw new Error(payload.error ?? "读取生成进度失败");
      }
      mergeGenerationJobIntoBoard(payload.job);
      updateActiveGenerationStatus(payload.job.status);
      if (payload.job.status === "failed") {
        throw new Error(payload.job.errorMessage ?? "生成失败");
      }
      if (payload.job.status === "succeeded") {
        return { job: payload.job, results: payload.results ?? payload.job.results.map((result) => result.asset) };
      }
    }
  }

  function handleStoryboardFrameGenerationComplete(payload: {
    asset: AssetPayload;
    job: JobPayload;
    shot: StoryboardShotPayload;
  }) {
    mergeGenerationJobIntoBoard(payload.job);
    setBoard((current) => ({
      ...current,
      assets: current.assets.some((asset) => asset.id === payload.asset.id)
        ? current.assets.map((asset) => (asset.id === payload.asset.id ? payload.asset : asset))
        : [payload.asset, ...current.assets],
    }));
    setStoryboardProject((current) => current
      ? { ...current, shots: current.shots.map((shot) => (shot.id === payload.shot.id ? payload.shot : shot)) }
      : current);
  }

  async function recoverGeneratedAssets(input: {
    beforeAssetIds: Set<string>;
    doneText: (count: number) => string;
    moveToCanvas?: boolean;
    noticeScope: GenerationNotice["scope"];
    placement?: ShapePlacement;
    promptText: string;
    startedAtMs: number;
  }) {
    setStatus("请求已断开，正在恢复生成结果");
    for (let attempt = 0; attempt < GENERATION_RECOVERY_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        await delay(GENERATION_RECOVERY_DELAY_MS);
      }
      try {
        const response = await apiFetch(`/api/boards/${board.id}`);
        if (!response.ok) continue;
        const payload = (await response.json()) as {
          board?: BoardPayload;
          error?: string;
          job?: JobPayload;
          results: AssetPayload[];
        };
        if (!payload.board) continue;
        const nextBoard = payload.board;
        const recoveredAssets = getRecoveredGeneratedAssets(
          nextBoard,
          input.beforeAssetIds,
          input.promptText,
          input.startedAtMs,
        );
        if (recoveredAssets.length === 0) continue;
        setBoard((current) => mergeBoardCache(nextBoard, current));
        addAssetsToVisibleList(recoveredAssets);
        await insertAssets(recoveredAssets, input.placement);
        const doneText = input.doneText(recoveredAssets.length);
        setStatus(doneText);
        setGenerationNotice({ scope: input.noticeScope, tone: "success", text: doneText });
        if (input.moveToCanvas) {
          setMobileView("canvas");
        }
        return true;
      } catch {
        // 只作为生成请求网络失败后的恢复尝试；失败时继续走原错误提示。
      }
    }
    return false;
  }

  async function uploadAsset(file: File, kind: "upload" | "mask" | "source") {
    const dimensions = await getImageDimensions(URL.createObjectURL(file));
    const formData = new FormData();
    formData.set("boardId", board.id);
    formData.set("kind", kind);
    formData.set("file", file);
    formData.set("width", String(dimensions.width));
    formData.set("height", String(dimensions.height));

    const response = await apiFetch("/api/assets", { method: "POST", body: formData });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "上传失败");
    }
    return payload.asset as AssetPayload;
  }

  async function patchAssetMetadata(assetId: string, patch: AssetMetadataPatch) {
    const response = await apiFetch(`/api/assets/${assetId}`, {
      body: JSON.stringify(patch),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    const payload = (await response.json()) as {
      asset?: AssetPayload & { tags?: string[] };
      error?: string;
    };
    if (!response.ok || !payload.asset) {
      throw new Error(payload.error ?? "更新素材失败");
    }
    const updatedAsset = getAssetPayloadFromMetadataResponse(payload.asset);
    setBoard((current) => ({
      ...current,
      assets: current.assets.map((asset) => (asset.id === assetId ? { ...asset, ...updatedAsset } : asset)),
      jobs: current.jobs.map((job) => ({
        ...job,
        results: job.results.map((result) =>
          result.asset.id === assetId ? { ...result, asset: { ...result.asset, ...updatedAsset } } : result,
        ),
      })),
    }));
    setVisibleImageAssets((current) =>
      current
        .map((asset) => (asset.id === assetId ? { ...asset, ...updatedAsset } : asset))
        .filter((asset) => assetMatchesServerListFilters(asset, {
          favoriteOnly: assetFavoriteOnly,
          kind: assetKindFilter,
          q: assetSearchQuery,
          tag: assetTagFilter,
        })),
    );
    setAssetPreviewAsset((current) => (current?.id === assetId ? { ...current, ...updatedAsset } : current));
    setStatus("已更新素材");
    return updatedAsset;
  }

  function toggleAssetFavorite(asset: AssetPayload) {
    startTransition(async () => {
      try {
        await patchAssetMetadata(asset.id, { isFavorite: !asset.isFavorite });
      } catch (error) {
        setStatus(getFriendlyErrorMessage(error, "更新收藏失败"));
      }
    });
  }

  function editAssetTags(asset: AssetPayload) {
    const value = window.prompt("标签，用逗号分隔", getAssetTags(asset).join(", "));
    if (value === null) return;
    const tags = value.split(",").map((tag) => tag.trim());
    startTransition(async () => {
      try {
        await patchAssetMetadata(asset.id, { tags });
      } catch (error) {
        setStatus(getFriendlyErrorMessage(error, "更新标签失败"));
      }
    });
  }

  function createBoardImageFilename(extension: string, options?: { date?: Date; index?: number }) {
    return createProjectTimestampFilename(board.name, extension, options);
  }

  function renameImageFileForBoard(file: File, options?: { date?: Date; index?: number }) {
    const date = options?.date ?? new Date();
    return new File(
      [file],
      createBoardImageFilename(getImageExtension(file.type, file.name), {
        date,
        index: options?.index,
      }),
      {
        lastModified: date.getTime(),
        type: file.type || "image/png",
      },
    );
  }

  function downloadAsset(asset: AssetPayload) {
    startTransition(async () => {
      try {
        setStatus("正在下载图片");
        const response = await apiFetch(asset.publicUrl);
        if (!response.ok) throw new Error("下载图片失败");
        const blob = await response.blob();
        const filename =
          getFilenameFromContentDisposition(response.headers.get("Content-Disposition")) ??
          createBoardImageFilename(getImageExtension(asset.mimeType));
        downloadBlob(blob, filename);
        try {
          const output = await saveBlobToLocalExport(blob, filename);
          setStatus(`已下载图片，并保存到 ${output.relativePath}`);
        } catch (error) {
          setStatus(`已触发浏览器下载，本地保存失败：${getFriendlyErrorMessage(error, "保存到本地目录失败")}`);
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "下载图片失败");
      }
    });
  }

  async function saveBlobToLocalExport(blob: Blob, filename: string) {
    const formData = new FormData();
    formData.set("boardId", board.id);
    formData.set("filename", filename);
    formData.set("file", new File([blob], filename, { type: blob.type || "application/octet-stream" }));

    const response = await apiFetch("/api/exports", { method: "POST", body: formData });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "保存到本地目录失败");
    }
    return payload.output as { absolutePath: string; relativePath: string };
  }

  async function insertAsset(
    asset: AssetPayload,
    placement?: ShapePlacement,
    batchCount = 1,
    batchIndex = 0,
  ) {
    const { height, width } = await getAssetImageSize(asset);
    const targetWidth = placement?.w ?? Math.min(width, 640);
    const displayWidth = batchCount > 1 ? Math.min(targetWidth, 300) : targetWidth;
    const targetHeight = placement?.h ?? Math.round((targetWidth / width) * height);
    const displayHeight = batchCount > 1
      ? Math.round((displayWidth / targetWidth) * targetHeight)
      : targetHeight;
    const currentObjects = getCurrentPageObjects(boardDocumentRef.current);
    const { x, y } = getNextImageInsertPosition(currentObjects, placement, displayWidth, displayHeight, batchIndex);
    const object: BoardImageObject = {
      assetId: asset.id,
      h: displayHeight,
      id: createBoardObjectId(asset.id),
      rotation: 0,
      type: "image",
      w: displayWidth,
      x,
      y,
    };
    const nextDocument = updateCurrentPageObjects(boardDocumentRef.current, (objects) => [...objects, object]);
    setDocumentAndSave(nextDocument);
    setSelectedObjectIds([object.id]);
    setSourceAssetId(asset.id);
    return { x, y, w: displayWidth, h: displayHeight };
  }

  async function insertAssets(assets: AssetPayload[], placement?: ShapePlacement) {
    if (assets.length === 0) {
      setStatus("没有可载入的图片");
      return [];
    }
    const objects: BoardImageObject[] = [];
    const currentObjects = getCurrentPageObjects(boardDocumentRef.current);
    const stagedObjects = [...currentObjects];
    for (const [index, asset] of assets.entries()) {
      const { height, width } = await getAssetImageSize(asset);
      const targetWidth = placement?.w ?? Math.min(width, 640);
      const displayWidth = assets.length > 1 ? Math.min(targetWidth, 300) : targetWidth;
      const targetHeight = placement?.h ?? Math.round((targetWidth / width) * height);
      const displayHeight = assets.length > 1
        ? Math.round((displayWidth / targetWidth) * targetHeight)
        : targetHeight;
      const { x, y } = getNextImageInsertPosition(stagedObjects, placement, displayWidth, displayHeight, index);
      const object: BoardImageObject = {
        assetId: asset.id,
        h: displayHeight,
        id: createBoardObjectId(asset.id),
        rotation: 0,
        type: "image",
        w: displayWidth,
        x,
        y,
      };
      objects.push(object);
      stagedObjects.push(object);
    }
    const result = appendObjectsToCurrentPage(boardDocumentRef.current, objects);
    setDocumentAndSave(result.document);
    setSelectedObjectIds(result.createdObjectIds);
    setSourceAssetId(assets[0]?.id ?? "");
    setMobileView("canvas");
    setStatus(`已载入 ${result.createdObjectIds.length} 张图片到画板`);
    return result.createdObjectIds;
  }

  function handleUpload(file: File | undefined) {
    if (!file) return;
    startTransition(async () => {
      try {
        setStatus("正在上传");
        const asset = await uploadAsset(renameImageFileForBoard(file), "upload");
        setBoard((current) => ({ ...current, assets: [asset, ...current.assets] }));
        addAssetsToVisibleList([asset]);
        await insertAsset(asset);
        setStatus("已上传");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "上传失败");
      }
    });
  }

  function addReferenceAsset(assetId: string) {
    setReferenceAssetIds((current) =>
      Array.from(new Set([...current, assetId])).slice(0, MAX_REFERENCE_ASSETS),
    );
    setReferenceItems((current) => {
      if (current.some((item) => item.assetId === assetId)) return current;
      const nextItems = [...current, { assetId, weight: "medium" as ReferenceWeight }].slice(0, MAX_REFERENCE_ASSETS);
      scheduleSave({
        appSnapshot: {
          referenceAssetIds: nextItems.map((item) => item.assetId),
          referenceAssetIdsByRole: getReferenceAssetMapFromItems(nextItems),
          referenceItems: nextItems,
          referenceFit: "exact",
        },
      });
      return nextItems;
    });
    setReferenceAssetIdsByRole((current) => (current.product ? current : { ...current, product: assetId }));
    setReferenceFit("exact");
  }

  function removeReferenceAsset(assetId: string) {
    setReferenceAssetIds((current) => current.filter((item) => item !== assetId));
    setReferenceItems((current) => current.filter((item) => item.assetId !== assetId));
    setReferenceAssetIdsByRole((current) => {
      const next = { ...current };
      for (const key of Object.keys(next) as ReferenceRole[]) {
        if (next[key] === assetId) {
          delete next[key];
        }
      }
      return next;
    });
    setStatus("已移除参考图");
  }

  function updateReferenceRole(assetId: string, role: ReferenceRole | "") {
    setReferenceItems((current) => {
      const nextItems = current.map((item) => {
        if (item.assetId !== assetId) return item;
        const nextItem = { ...item };
        if (role) nextItem.role = role;
        else delete nextItem.role;
        return nextItem;
      });
      scheduleSave({
        appSnapshot: {
          referenceItems: nextItems,
          referenceAssetIds: nextItems.map((item) => item.assetId),
          referenceAssetIdsByRole: getReferenceAssetMapFromItems(nextItems),
        },
      });
      return nextItems;
    });
    setReferenceAssetIdsByRole((current) => {
      const next = { ...current };
      for (const key of Object.keys(next) as ReferenceRole[]) {
        if (next[key] === assetId) {
          delete next[key];
        }
      }
      if (role) {
        next[role] = assetId;
      }
      return next;
    });
    setOpenReferenceRoleAssetId("");
    setStatus(role ? "已标记参考图角色" : "已取消参考图角色标记");
  }

  function updateReferenceWeight(assetId: string, weight: ReferenceWeight) {
    setReferenceItems((current) => {
      const nextItems = current.map((item) => (item.assetId === assetId ? { ...item, weight } : item));
      scheduleSave({ appSnapshot: { referenceItems: nextItems } });
      return nextItems;
    });
    setStatus("已调整参考图影响强度");
  }

  function updateReferenceConflictStrategy(strategy: ReferenceConflictStrategy) {
    setReferenceConflictStrategy(strategy);
    scheduleSave({ appSnapshot: { referenceConflictStrategy: strategy } });
    setStatus("已更新参考冲突处理方式");
  }

  function toggleReferenceGroup(groupKey: ReferenceGroupKey) {
    setCollapsedReferenceGroups((current) =>
      current.includes(groupKey) ? current.filter((key) => key !== groupKey) : [...current, groupKey],
    );
  }

  function moveReferenceItem(assetId: string, direction: -1 | 1) {
    setReferenceItems((current) => {
      const index = current.findIndex((item) => item.assetId === assetId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const nextItems = [...current];
      const [item] = nextItems.splice(index, 1);
      nextItems.splice(nextIndex, 0, item);
      scheduleSave({
        appSnapshot: {
          referenceAssetIds: nextItems.map((nextItem) => nextItem.assetId),
          referenceAssetIdsByRole: getReferenceAssetMapFromItems(nextItems),
          referenceItems: nextItems,
        },
      });
      return nextItems;
    });
    setStatus("已调整参考图顺序");
  }

  function applyReferencePreset(preset: ReferencePreset) {
    if (referenceItems.length === 0) {
      setStatus("请先添加参考图");
      return;
    }
    const nextFit = getReferenceFitForPreset(preset);
    const nextItems = referenceItems.map((item, index) => ({
      ...item,
      role: getPresetReferenceRole(preset, index, item.role),
      weight: index === 0 ? "high" : item.weight ?? "medium",
    }));
    setReferenceFit(nextFit);
    setReferenceItems(nextItems);
    setReferenceAssetIdsByRole(getReferenceAssetMapFromItems(nextItems));
    scheduleSave({
      appSnapshot: {
        referenceAssetIds: nextItems.map((item) => item.assetId),
        referenceAssetIdsByRole: getReferenceAssetMapFromItems(nextItems),
        referenceFit: nextFit,
        referenceItems: nextItems,
      },
    });
    setStatus(`已应用${getReferencePresetLabel(preset)}预设`);
  }

  function applyModeReferenceFit(mode: "full" | "mask" | "variant") {
    const nextFit: ReferenceFit = mode === "mask" ? "exact" : mode === "variant" ? "balanced" : "balanced";
    setReferenceFit(nextFit);
    setCurrentToolId(mode === "mask" ? "mask" : "select");
    scheduleSave({ appSnapshot: { referenceFit: nextFit } });
    setStatus(mode === "mask" ? "已切换局部涂抹，并建议严格贴合参考" : "已切换改图模式，并建议平衡参考");
  }

  async function openReferencePrompt(asset: AssetPayload, options: { force?: boolean } = {}) {
    setReversePromptAsset(asset);
    setReversePromptCopied(false);
    if (reversePromptByAssetId[asset.id] && !options.force) return;

    try {
      setReversePromptErrorByAssetId((current) => {
        const next = { ...current };
        delete next[asset.id];
        return next;
      });
      setReversePromptLoadingAssetId(asset.id);
      setStatus("正在反推参考图提示词");
      const response = await apiFetch(`/api/assets/${asset.id}/reverse-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: selectedReversePromptModel }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        promptText?: string;
      };
      if (!response.ok || !data.promptText) {
        throw new Error(data.error ?? "反推提示词失败");
      }
      setReversePromptByAssetId((current) => ({ ...current, [asset.id]: data.promptText! }));
      setStatus("已生成参考图提示词");
    } catch (error) {
      const errorText = error instanceof Error ? error.message : "反推提示词失败";
      setReversePromptErrorByAssetId((current) => ({ ...current, [asset.id]: errorText }));
      setStatus(errorText);
    } finally {
      setReversePromptLoadingAssetId((current) => (current === asset.id ? "" : current));
    }
  }

  async function rerunReversePrompt(asset: AssetPayload) {
    await openReferencePrompt(asset, { force: true });
  }

  async function saveReversePromptToSource(asset: AssetPayload) {
    const promptText = reversePromptByAssetId[asset.id]?.trim();
    if (!promptText) {
      setStatus("请先反推提示词");
      return;
    }
    setSourcePrompt(promptText);
    setStatus("已保存到 AI 生图提示词");
    scheduleSave({ appSnapshot: { sourcePrompt: promptText } });
  }

  function appendReversePromptToSource(asset: AssetPayload) {
    const promptText = reversePromptByAssetId[asset.id]?.trim();
    if (!promptText) {
      setStatus("请先反推提示词");
      return;
    }
    const nextPrompt = [sourcePrompt.trim(), promptText].filter(Boolean).join("\n\n参考图关键词：");
    setSourcePrompt(nextPrompt);
    setStatus("已追加到生图提示词");
    scheduleSave({ appSnapshot: { sourcePrompt: nextPrompt } });
  }

  function appendReversePromptToEdit(asset: AssetPayload) {
    const promptText = reversePromptByAssetId[asset.id]?.trim();
    if (!promptText) {
      setStatus("请先反推提示词");
      return;
    }
    const nextPrompt = [prompt.trim(), promptText].filter(Boolean).join("\n\n参考图约束：");
    setPrompt(nextPrompt);
    setDesktopView("edit");
    setStatus("已追加到改图要求");
    scheduleSave({ appSnapshot: { prompt: nextPrompt } });
  }

  async function copyReversePrompt() {
    if (!reversePromptAsset) return;
    const promptText = reversePromptByAssetId[reversePromptAsset.id];
    if (!promptText) return;

    try {
      await navigator.clipboard.writeText(promptText);
      setReversePromptCopied(true);
      setStatus("已复制提示词");
      window.setTimeout(() => setReversePromptCopied(false), 1600);
    } catch {
      setStatus("复制失败，请手动选择文本复制");
    }
  }

  function handleReferenceUpload(files: FileList | null | undefined) {
    const fileList = Array.from(files ?? []).slice(0, MAX_REFERENCE_ASSETS);
    if (fileList.length === 0) return;
    startTransition(async () => {
      try {
        setStatus(`正在上传 ${fileList.length} 张参考图`);
        const date = new Date();
        const assets = await Promise.all(
          fileList.map((file, index) =>
            uploadAsset(renameImageFileForBoard(file, { date, index }), "upload"),
          ),
        );
        setBoard((current) => ({ ...current, assets: [...assets, ...current.assets] }));
        addAssetsToVisibleList(assets);
        setReferenceAssetIds((current) =>
          Array.from(new Set([...current, ...assets.map((asset) => asset.id)])).slice(0, MAX_REFERENCE_ASSETS),
        );
        setReferenceItems((current) => {
          const next = [...current];
          for (const asset of assets) {
            if (!next.some((item) => item.assetId === asset.id)) {
              next.push({ assetId: asset.id, weight: "medium" });
            }
          }
          const nextItems = next.slice(0, MAX_REFERENCE_ASSETS);
          scheduleSave({
            appSnapshot: {
              referenceAssetIds: nextItems.map((item) => item.assetId),
              referenceAssetIdsByRole: getReferenceAssetMapFromItems(nextItems),
              referenceFit: "exact",
              referenceItems: nextItems,
            },
          });
          return nextItems;
        });
        setReferenceAssetIdsByRole((current) =>
          current.product ? current : { ...current, product: assets[0].id },
        );
        setReferenceFit("exact");
        setStatus(`已添加 ${assets.length} 张参考图`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "上传参考图失败");
      }
    });
  }

  function setAssetAsSource(assetId: string) {
    setSourceAssetId(assetId);
    setMobileMaskRedoStrokes([]);
    setMobileMaskColor("");
    const matchingObject = pageObjects.find(
      (object): object is BoardImageObject => object.type === "image" && object.assetId === assetId,
    );
    if (matchingObject) setSelectedObjectIds([matchingObject.id]);
    setStatus("已设置源图");
  }

  function clearSourceAsset() {
    setSourceAssetId("");
    setMaskState(null);
    setMobileMaskRedoStrokes([]);
    setMobileMaskColor("");
    cancelMobileMaskStroke();
    setStatus("已清除源图，可重新选择");
  }

  function setAssetAsPrimaryReference(assetId: string) {
    addReferenceAsset(assetId);
    setStatus("已设置参考图");
  }

  function clearReferenceAssets() {
    setReferenceAssetIds([]);
    setReferenceItems([]);
    setReferenceAssetIdsByRole({});
    setStatus("已清除参考图，可重新选择");
  }

  function setSelectedImageAsSource() {
    const selected = getSelectedImageAssetFromDocument();
    if (!selected) {
      setStatus("请先选中画布中的一张图片");
      return;
    }
    setSourceAssetId(selected.id);
    setMobileMaskRedoStrokes([]);
    setMobileMaskColor("");
    setCanvasContextMenu(null);
    setStatus("已将选中图片设为源图");
  }

  function setSelectedImageAsPrimaryReference() {
    const selected = getSelectedImageAssetFromDocument();
    if (!selected) {
      setStatus("请先选中画布中的一张图片");
      return;
    }
    setAssetAsPrimaryReference(selected.id);
    setCanvasContextMenu(null);
  }

  function runPrimaryAiEdit() {
    if (!sourceAsset) {
      setStatus("请先上传源图，或从素材页载入源图");
      return;
    }
    if (maskStrokes.length > 0) {
      generate(primaryReferenceAsset ? "local_replace" : "inpaint", {
        preserveStrength: "strict",
        referenceFit: primaryReferenceAsset ? "exact" : referenceFit,
      });
      return;
    }
    if (primaryReferenceAsset) {
      generate("local_replace", {
        wholeImageEdit: true,
        preserveStrength: "balanced",
        referenceFit: "exact",
      });
      return;
    }
    editSelectedImageFromPrompt();
  }

  function generateSourceFromPrompt() {
    const sourceGenerationSize = selectedAspectRatio === "auto"
      ? getImageSizeForAspectQuality(DEFAULT_BOARD_ASPECT_RATIO, selectedQuality)
      : selectedSourceSize;
    generate("text_to_image", {
      noticeScope: "source",
      promptText: sourcePrompt,
      size: sourceGenerationSize,
    });
  }

  async function runPromptAssist(engine: PromptAssistEngine = promptAssistEngine) {
    const promptText = sourcePrompt.trim();
    if (!promptText) {
      setPromptAssistError("请先输入 AI 生图提示词");
      setStatus("请先输入 AI 生图提示词");
      return;
    }
    const requestId = promptAssistRequestIdRef.current + 1;
    promptAssistRequestIdRef.current = requestId;
    setPromptAssistEngine(engine);
    setPromptAssistSource("assist");
    setIsPromptAssistLoading(true);
    setPromptAssistError("");
    setPromptAssistResult(null);
    try {
      const response = await apiFetch("/api/prompt-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: promptAssistAction,
          artStyle,
          artStyleLabel: currentArtStyleOption.label,
          artStyleInstruction: currentArtStyleOption.instruction,
          boardId: board.id,
          engine,
          imageType: promptAssistImageType,
          prompt: promptText,
          referenceContext: buildPromptAssistReferenceContext(referenceAssets),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as Partial<PromptAssistResult> & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "提示词辅助失败");
      }
      if (requestId !== promptAssistRequestIdRef.current) return;
      setPromptAssistResult({
        notes: getStringArray(payload.notes),
        prompt: typeof payload.prompt === "string" ? payload.prompt : "",
        variations: getStringArray(payload.variations),
      });
      setIsPromptAssistDialogOpen(false);
      setStatus(engine === "skill2" ? "已生成辅助提示词2建议" : "已生成提示词建议");
    } catch (error) {
      if (requestId !== promptAssistRequestIdRef.current) return;
      const message = getFriendlyErrorMessage(error, "提示词辅助失败");
      setPromptAssistError(message);
      setStatus(message);
    } finally {
      if (requestId === promptAssistRequestIdRef.current) {
        setIsPromptAssistLoading(false);
      }
    }
  }

  async function runPromptSafetyOptimizer(mode: PromptSafetyMode = "standard") {
    const promptText = sourcePrompt.trim();
    if (!promptText) {
      setPromptAssistError("请先输入 AI 生图提示词");
      setStatus("请先输入 AI 生图提示词");
      return;
    }
    const requestId = promptAssistRequestIdRef.current + 1;
    promptAssistRequestIdRef.current = requestId;
    setPromptAssistSource("safety");
    setIsPromptAssistLoading(true);
    setPromptAssistError("");
    setPromptAssistResult(null);
    try {
      const response = await apiFetch("/api/prompt-safety/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boardId: board.id,
          mode,
          prompt: promptText,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        applied?: boolean;
        error?: string;
        prompt?: string;
        reasons?: string[];
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "提示词安全优化失败");
      }
      if (requestId !== promptAssistRequestIdRef.current) return;
      setPromptAssistResult({
        notes: getPromptSafetyNotes(getStringArray(payload.reasons)),
        prompt: typeof payload.prompt === "string" ? payload.prompt : promptText,
        variations: [],
      });
      setIsPromptAssistDialogOpen(false);
      setStatus(payload.applied ? "已生成安全优化提示词" : "当前提示词未发现需要优化的高风险表达");
    } catch (error) {
      if (requestId !== promptAssistRequestIdRef.current) return;
      const message = getFriendlyErrorMessage(error, "提示词安全优化失败");
      setPromptAssistError(message);
      setStatus(message);
    } finally {
      if (requestId === promptAssistRequestIdRef.current) {
        setIsPromptAssistLoading(false);
      }
    }
  }

  function applyPromptAssistPrompt(promptText: string) {
    setSourcePrompt(promptText);
    setPromptAssistError("");
    setIsPromptAssistDialogOpen(false);
    setStatus("已应用提示词建议");
    scheduleSave({ appSnapshot: { sourcePrompt: promptText } });
  }

  function updateGenerationCount(value: number) {
    const nextValue = getValidGenerationCount(value);
    setGenerationCount(nextValue);
    scheduleSave({ appSnapshot: { generationCount: nextValue } });
  }

  function updateSourceAspectRatio(value: BoardAspectRatio) {
    const qualityOptions = getAvailableQualityOptions(value);
    const nextQuality = qualityOptions.some((option) => option.value === selectedQuality)
      ? selectedQuality
      : qualityOptions[0]?.value ?? DEFAULT_BOARD_QUALITY;
    const nextSize = getImageSizeForAspectQuality(value, nextQuality);
    setSelectedAspectRatio(value);
    setSelectedQuality(nextQuality);
    setSourceImageSize(nextSize);
    scheduleSave({ appSnapshot: { selectedAspectRatio: value, sourceImageSize: nextSize } });
  }

  function updateSourceQuality(value: BoardQuality) {
    if (selectedAspectRatio === "auto") {
      setSelectedQuality(value);
      scheduleSave();
      return;
    }
    const nextSize = getImageSizeForAspectQuality(selectedAspectRatio, value);
    setSelectedQuality(value);
    setSourceImageSize(nextSize);
    scheduleSave({ appSnapshot: { selectedAspectRatio, sourceImageSize: nextSize } });
  }

  function updateArtStyle(value: BoardArtStyle) {
    setArtStyle(value);
    scheduleSave({ appSnapshot: { artStyle: value } });
  }

  function updateSelectedImageModel(value: string) {
    setSelectedImageModel(value);
    scheduleSave({ appSnapshot: { selectedImageModel: value } });
  }

  async function copyPromptAssistPrompt(promptText: string) {
    try {
      await navigator.clipboard.writeText(promptText);
      setStatus("已复制提示词建议");
    } catch {
      setStatus("复制失败，请手动选择文本复制");
    }
  }

  function generate(
    mode: "text_to_image" | "inpaint" | "local_replace",
    options?: {
      noticeScope?: GenerationNotice["scope"];
      preserveStrength?: PreserveStrength;
      promptAlreadyStyled?: boolean;
      promptText?: string;
      referenceFit?: ReferenceFit;
      referenceAssetsOverride?: ResolvedReferenceAsset[];
      size?: ImageSize;
      wholeImageEdit?: boolean;
    },
  ) {
    void (async () => {
      const noticeScope = options?.noticeScope ?? (mode === "text_to_image" ? "source" : "edit");
      let recoveryPromptText = "";
      let recoveryPlacement: ShapePlacement | undefined;
      let beforeGenerationAssetIds = new Set<string>();
      let generationStartedAtMs = 0;
      try {
        setGenerationNotice(null);
        const effectivePrompt = options?.promptText ?? prompt;
        const effectiveReferenceAssets = options?.referenceAssetsOverride ?? referenceAssets;
        if (!effectivePrompt.trim() && mode !== "local_replace") throw new Error("请输入提示词");
        if (!effectivePrompt.trim() && options?.wholeImageEdit) throw new Error("请输入要修改的关键词或提示词");
        if (mode === "local_replace" && effectiveReferenceAssets.length === 0) {
          throw new Error("请先上传或选择参考图");
        }
        const placement = mode !== "text_to_image" ? getSelectedImagePlacementFromDocument() : undefined;
        recoveryPlacement = placement;
        const activeStartedAtMs = Date.now();
        generationStartedAtMs = activeStartedAtMs;
        const activeModeLabel = mode === "text_to_image" ? "AI 生图" : "AI 改图";
        setActiveGeneration({ modeLabel: activeModeLabel, prompt: effectivePrompt, startedAtMs: activeStartedAtMs });
        setStatus(`${activeModeLabel}进行中，已运行 0 秒`);
        let maskAssetId: string | undefined;
        if (mode !== "text_to_image") {
          if (!sourceAsset) throw new Error("请先选择一张源图");
          if (mode === "local_replace" && maskStrokes.length === 0 && !options?.wholeImageEdit) {
            throw new Error("请先用蒙版笔涂抹要替换的区域");
          }
          if (!options?.wholeImageEdit) {
            const maskBlob = await createMaskBlob(
              sourceAsset,
              maskStrokes,
              maskBrushRatio,
              maskFeatherRatio,
            );
            const maskFile = new File([maskBlob], createBoardImageFilename("png"), {
              type: "image/png",
            });
            const maskAsset = await uploadAsset(maskFile, "mask");
            maskAssetId = maskAsset.id;
            setBoard((current) => ({ ...current, assets: [maskAsset, ...current.assets] }));
            addAssetsToVisibleList([maskAsset]);
          }
        }
        const effectivePreserveStrengthOption =
          preserveStrengthOptions.find(
            (option) => option.value === (options?.preserveStrength ?? preserveStrength),
          ) ?? preserveStrengthOption;
        const effectiveReferenceFitOption =
          referenceFitOptions.find((option) => option.value === (options?.referenceFit ?? referenceFit)) ??
          referenceFitOption;
        const basePromptText =
          mode === "local_replace"
            ? buildLocalReplacePrompt(
                effectivePrompt,
                effectiveReferenceAssets,
                effectivePreserveStrengthOption,
                effectiveReferenceFitOption,
                referenceConflictStrategy,
                Boolean(maskAssetId),
              )
            : effectiveReferenceAssets.length > 0
              ? buildReferencedTextPrompt(effectivePrompt, effectiveReferenceAssets, referenceConflictStrategy)
              : effectivePrompt;
        const promptText = options?.promptAlreadyStyled
          ? basePromptText
          : appendArtStyleInstruction(basePromptText, artStyle);
        setActiveGeneration({ modeLabel: activeModeLabel, prompt: promptText, startedAtMs: activeStartedAtMs });
        const requestSize = options?.size ?? selectedSourceSize;
        const requestReferenceAssetIds =
          mode === "local_replace" || mode === "text_to_image"
            ? effectiveReferenceAssets.map((item) => item.asset.id)
            : [];
        const requestReferenceItems =
          mode === "local_replace" || mode === "text_to_image"
            ? effectiveReferenceAssets.map((item) => ({
                assetId: item.asset.id,
                ...(item.role ? { role: item.role } : {}),
                ...(item.weight ? { weight: item.weight } : {}),
              }))
            : [];

        beforeGenerationAssetIds = new Set(board.assets.map((asset) => asset.id));
        recoveryPromptText = promptText;
        const job = await startGenerationJob({
          boardId: board.id,
          model: selectedImageModel,
          mode: mode === "text_to_image" ? "text_to_image" : "inpaint",
          prompt: promptText,
          size: requestSize,
          sourceAssetId: mode !== "text_to_image" ? sourceAsset?.id : undefined,
          maskAssetId,
          referenceAssetIds: requestReferenceAssetIds,
          referenceItems: requestReferenceItems,
          count: generationCount,
        });
        const payload = await waitForGenerationJob(job.id);
        const results = payload.results;
        mergeGenerationJobIntoBoard(payload.job);
        mergeAssetsIntoBoard(results);
        addAssetsToVisibleList(results);
        await insertAssets(results, placement);
        void refreshBoard().catch(() => undefined);
        const doneText = `已生成 ${payload.results.length} 张候选图`;
        setStatus(doneText);
        setGenerationNotice({ scope: noticeScope, tone: "success", text: doneText });
        if (payload.job?.id && payload.results.length > 1) {
          setResultPickerJobId(payload.job.id);
          setResultPickerComparisonAssetId("");
        }
        setMobileView("canvas");
      } catch (error) {
        if (isNetworkError(error) && recoveryPromptText) {
          const recovered = await recoverGeneratedAssets({
            beforeAssetIds: beforeGenerationAssetIds,
            doneText: (count) => `已生成 ${count} 张候选图`,
            moveToCanvas: true,
            noticeScope,
            placement: recoveryPlacement,
            promptText: recoveryPromptText,
            startedAtMs: generationStartedAtMs,
          });
          if (recovered) return;
        }
        const errorText = getFriendlyErrorMessage(error, "生成失败");
        setStatus(errorText);
        setGenerationNotice({ scope: noticeScope, tone: "error", text: errorText });
      } finally {
        setActiveGeneration(null);
      }
    })();
  }

  function selectAllCanvasObjects() {
    setSelectedObjectIds(selectablePageObjects.map((object) => object.id));
  }

  function deleteSelectedObjects() {
    if (activeSelectedObjectIds.length === 0) {
      setStatus("请先选中对象");
      return;
    }
    const result = removeUnlockedObjectsFromCurrentPage(boardDocumentRef.current, activeSelectedObjectIds);
    if (result.removedObjectIds.length === 0) {
      setStatus("选中图层已锁定，需解锁后删除");
      return;
    }
    setDocumentAndSave(result.document, { allowEmpty: true });
    setSelectedObjectIds((current) => current.filter((id) => !result.removedObjectIds.includes(id)));
    setCanvasContextMenu(null);
    setStatus(`已删除 ${result.removedObjectIds.length} 个对象`);
  }

  function insertShapeObject() {
    const object: BoardObject = {
      h: 132,
      id: `rect:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      name: "暖灰标注框",
      rotation: 0,
      type: "rect",
      w: 220,
      x: DEFAULT_IMAGE_INSERT_X + pageObjects.length * 12,
      y: DEFAULT_IMAGE_INSERT_Y + pageObjects.length * 12,
    };
    const result = appendObjectsToCurrentPage(boardDocumentRef.current, [object]);
    setDocumentAndSave(result.document);
    setSelectedObjectIds(result.createdObjectIds);
    setStatus("已添加形状图层");
  }

  function insertTextObject() {
    const object: BoardObject = {
      id: `text:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      name: "标题文案",
      rotation: 0,
      text: "新品视觉标注",
      type: "text",
      x: DEFAULT_IMAGE_INSERT_X + pageObjects.length * 12,
      y: DEFAULT_IMAGE_INSERT_Y + pageObjects.length * 12,
    };
    const result = appendObjectsToCurrentPage(boardDocumentRef.current, [object]);
    setDocumentAndSave(result.document);
    setSelectedObjectIds(result.createdObjectIds);
    setStatus("已添加文本图层");
  }

  function placeStoryboardShotsOnBoard(shots: StoryboardShotPayload[]) {
    const normalizedShots = shots.filter((shot) => shot.id);
    if (normalizedShots.length === 0) {
      setStatus("没有可投放的分镜");
      return;
    }
    const currentObjects = getCurrentPageObjects(boardDocumentRef.current);
    const existingCardCount = getStoryboardCardCount(currentObjects);
    const existingIds = new Set(currentObjects.map((object) => object.id));
    const objects = normalizedShots.flatMap((shot, index) => {
      const cardIndex = existingCardCount + index;
      const column = cardIndex % 3;
      const row = Math.floor(cardIndex / 3);
      return createStoryboardShotCardObjects(shot, {
        existingIds,
        x: DEFAULT_IMAGE_INSERT_X + column * (STORYBOARD_CARD_WIDTH + STORYBOARD_CARD_GAP),
        y: DEFAULT_IMAGE_INSERT_Y + row * (STORYBOARD_CARD_HEIGHT + STORYBOARD_CARD_GAP),
      });
    });
    const result = appendObjectsToCurrentPage(boardDocumentRef.current, objects);
    setDocumentAndSave(result.document);
    setSelectedObjectIds(result.createdObjectIds);
    setDesktopView("storyboard");
    setMobileView("canvas");
    setStatus(normalizedShots.length === 1 ? "已投放分镜卡片到画板" : `已投放 ${normalizedShots.length} 张分镜卡片到画板`);
  }

  function copySelectedObjectsToBoardClipboard() {
    if (activeSelectedObjectIds.length === 0) {
      setStatus("请先选中对象");
      return;
    }
    const editableIds = activeSelectedObjectIds.filter((id) => {
      const object = pageObjects.find((item) => item.id === id);
      return object && !object.locked;
    });
    if (editableIds.length === 0) {
      setStatus("选中图层已锁定，需解锁后复制");
      return;
    }
    boardClipboardRef.current = editableIds;
    setStatus(`已复制 ${editableIds.length} 个对象`);
  }

  function pasteBoardClipboard() {
    const sourceIds = boardClipboardRef.current.filter((id) =>
      getCurrentPageObjects(boardDocumentRef.current).some((object) => object.id === id && !object.locked),
    );
    if (sourceIds.length === 0) {
      setStatus("剪贴板为空，或复制的图层已不可用");
      return;
    }
    const result = duplicateObjectsOnCurrentPage(boardDocumentRef.current, sourceIds, {
      idPrefix: `copy-${Date.now()}`,
      offset: BOARD_DUPLICATE_OFFSET,
    });
    if (result.createdObjectIds.length === 0) {
      setStatus("没有可粘贴的对象");
      return;
    }
    setDocumentAndSave(result.document);
    setSelectedObjectIds(result.createdObjectIds);
    boardClipboardRef.current = result.createdObjectIds;
    setCanvasContextMenu(null);
    setStatus(`已粘贴 ${result.createdObjectIds.length} 个对象`);
  }

  function duplicateSelectedObjects() {
    if (activeSelectedObjectIds.length === 0) {
      setStatus("请先选中对象");
      return;
    }
    const result = duplicateObjectsOnCurrentPage(boardDocumentRef.current, activeSelectedObjectIds, {
      idPrefix: `copy-${Date.now()}`,
      offset: BOARD_DUPLICATE_OFFSET,
    });
    if (result.createdObjectIds.length === 0) {
      setStatus("选中图层已锁定，需解锁后复制");
      return;
    }
    setDocumentAndSave(result.document);
    setSelectedObjectIds(result.createdObjectIds);
    boardClipboardRef.current = result.createdObjectIds;
    setCanvasContextMenu(null);
    setStatus(`已复制副本 ${result.createdObjectIds.length} 个对象`);
  }

  function nudgeSelectedObjects(delta: Point) {
    if (activeSelectedObjectIds.length === 0) {
      setStatus("请先选中对象");
      return;
    }
    const result = moveObjectsOnCurrentPage(boardDocumentRef.current, activeSelectedObjectIds, delta);
    if (result.changedObjectIds.length === 0) {
      setStatus("选中图层已锁定，需解锁后移动");
      return;
    }
    setDocumentAndSave(result.document);
    setStatus(`已移动 ${result.changedObjectIds.length} 个对象`);
  }

  function alignSelectedObjects(alignment: BoardAlignment) {
    if (activeSelectedObjectIds.length < 2) {
      setStatus("请选择至少 2 个对象再对齐");
      return;
    }
    const actionLabel = boardAlignmentActions.find((item) => item.action === alignment)?.title ?? "对齐";
    const result = alignObjectsOnCurrentPage(boardDocumentRef.current, activeSelectedObjectIds, alignment);
    if (result.changedObjectIds.length === 0) {
      setStatus("选中对象无需调整，或包含不可对齐图层");
      return;
    }
    setDocumentAndSave(result.document);
    setStatus(`${actionLabel}：已调整 ${result.changedObjectIds.length} 个对象`);
  }

  function distributeSelectedObjects(distribution: BoardDistribution) {
    if (activeSelectedObjectIds.length < 3) {
      setStatus("请选择至少 3 个对象再分布");
      return;
    }
    const actionLabel = boardDistributionActions.find((item) => item.action === distribution)?.title ?? "分布";
    const result = distributeObjectsOnCurrentPage(boardDocumentRef.current, activeSelectedObjectIds, distribution);
    if (result.changedObjectIds.length === 0) {
      setStatus("选中对象无需调整，或包含不可分布图层");
      return;
    }
    setDocumentAndSave(result.document);
    setStatus(`${actionLabel}：已调整 ${result.changedObjectIds.length} 个对象`);
  }

  function groupSelectedObjects() {
    if (activeSelectedObjectIds.length < 2) {
      setStatus("请选择至少 2 个对象再成组");
      return;
    }
    const result = groupObjectsOnCurrentPage(boardDocumentRef.current, activeSelectedObjectIds, {
      name: `分组 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`,
    });
    if (result.changedObjectIds.length === 0) {
      setStatus("选中图层已锁定，需解锁后成组");
      return;
    }
    setDocumentAndSave(result.document);
    setSelectedObjectIds(result.changedObjectIds);
    setCanvasContextMenu(null);
    setStatus(`已成组 ${result.changedObjectIds.length} 个对象`);
  }

  function ungroupSelectedObjects() {
    if (activeSelectedObjectIds.length === 0) {
      setStatus("请先选中分组内对象");
      return;
    }
    const result = ungroupObjectsOnCurrentPage(boardDocumentRef.current, activeSelectedObjectIds);
    if (result.changedObjectIds.length === 0) {
      setStatus("选中对象不在分组内，或分组已锁定");
      return;
    }
    setDocumentAndSave(result.document);
    setSelectedObjectIds(result.changedObjectIds);
    setCanvasContextMenu(null);
    setStatus(`已解组 ${result.changedObjectIds.length} 个对象`);
  }

  function autoLayoutSelectedObjects(mode: BoardAutoLayoutMode) {
    const minimumCount = mode === "beforeAfter" ? 2 : 1;
    if (activeSelectedObjectIds.length < minimumCount) {
      setStatus(mode === "beforeAfter" ? "请选择 2 张图片生成前后对比" : "请先选择要排版的图片");
      return;
    }
    const result = autoLayoutObjectsOnCurrentPage(boardDocumentRef.current, activeSelectedObjectIds, {
      columns: mode === "grid" ? Math.ceil(Math.sqrt(activeSelectedObjectIds.length)) : undefined,
      gap: mode === "beforeAfter" ? 24 : 28,
      mode,
    });
    if (result.changedObjectIds.length === 0) {
      setStatus("请选择未锁定图片进行智能排版");
      return;
    }
    setDocumentAndSave(result.document);
    setSelectedObjectIds(result.changedObjectIds);
    setStatus(`${mode === "beforeAfter" ? "前后对比" : "网格排版"}：已调整 ${result.changedObjectIds.length} 张图片`);
  }

  function reorderSelectedObjects(action: BoardReorderAction) {
    if (activeSelectedObjectIds.length === 0) {
      setStatus("请先选中对象");
      return;
    }
    const actionLabel = boardReorderActions.find((item) => item.action === action)?.title ?? "调整层级";
    const result = reorderObjectsOnCurrentPage(boardDocumentRef.current, activeSelectedObjectIds, action);
    if (result.changedObjectIds.length === 0) {
      setStatus("选中图层已在目标层级，或已锁定");
      return;
    }
    setDocumentAndSave(result.document);
    setCanvasContextMenu(null);
    setStatus(`${actionLabel}：已调整 ${result.changedObjectIds.length} 个图层`);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isEditableKeyboardTarget(event.target)) return;
      const isCommand = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (isCommand && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redoBoardDocument();
        else undoBoardDocument();
        return;
      }
      if (isCommand && key === "y") {
        event.preventDefault();
        redoBoardDocument();
        return;
      }
      if (isCommand && key === "a") {
        event.preventDefault();
        selectAllCanvasObjects();
        return;
      }
      if (isCommand && key === "c") {
        event.preventDefault();
        copySelectedObjectsToBoardClipboard();
        return;
      }
      if (isCommand && key === "v") {
        event.preventDefault();
        pasteBoardClipboard();
        return;
      }
      if (isCommand && key === "d") {
        event.preventDefault();
        duplicateSelectedObjects();
        return;
      }
      if (event.key.startsWith("Arrow")) {
        const step = event.shiftKey ? BOARD_NUDGE_LARGE_STEP : BOARD_NUDGE_STEP;
        const deltaByKey: Record<string, Point> = {
          ArrowDown: { x: 0, y: step },
          ArrowLeft: { x: -step, y: 0 },
          ArrowRight: { x: step, y: 0 },
          ArrowUp: { x: 0, y: -step },
        };
        const delta = deltaByKey[event.key];
        if (delta) {
          event.preventDefault();
          nudgeSelectedObjects(delta);
          return;
        }
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelectedObjects();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  function clearCurrentPage() {
    const nextDocument = updateCurrentPageObjects(boardDocumentRef.current, () => []);
    setDocumentAndSave(nextDocument, { allowEmpty: true });
    void saveSnapshot({ allowEmpty: true, document: nextDocument }).catch((error) =>
      setStatus(getFriendlyErrorMessage(error, "清空保存失败")),
    );
    setSelectedObjectIds([]);
    setSourcePrompt("");
    setPrompt("");
    setSourceAssetId("");
    setReferenceAssetIds([]);
    setReferenceItems([]);
    setReferenceAssetIdsByRole({});
    setMaskState(null);
    setMobileMaskRedoStrokes([]);
    setMobileMaskColor("");
    setGenerationNotice(null);
    setStatus("已清空当前画板状态");
  }

  function openAssetPreview(asset: AssetPayload) {
    setAssetPreviewAsset(asset);
    setAssetPreviewZoom(1);
  }

  function focusAssetOnBoard(assetId: string) {
    const object = getCurrentPageObjects(boardDocumentRef.current).find(
      (item) => item.type === "image" && item.assetId === assetId && !item.hidden,
    );
    if (!object) {
      setStatus("该素材未在当前画布中");
      return;
    }
    const canvasRect = canvasAreaRef.current?.getBoundingClientRect();
    const bounds = getObjectBounds(object);
    if (canvasRect && bounds.w > 0 && bounds.h > 0) {
      setViewport(fitBoundsToViewport(bounds, { h: canvasRect.height, w: canvasRect.width }));
    }
    setSelectedObjectIds([object.id]);
    setSourceAssetId(assetId);
    setCurrentToolId("select");
    setStatus("已定位绑定素材");
  }

  function removeAssetFromCanvas(assetId: string, appSnapshot?: Partial<AppSnapshot>) {
    const nextDocument = {
      ...boardDocumentRef.current,
      pages: boardDocumentRef.current.pages.map((page) => ({
        ...page,
        objects: page.objects.filter((object) => object.type !== "image" || object.assetId !== assetId),
      })),
    };
    setDocumentAndSave(nextDocument, { allowEmpty: true, appSnapshot });
    setSelectedObjectIds((current) => filterExistingObjectIds(nextDocument, current));
    setCanvasContextMenu((current) =>
      current && !filterExistingObjectIds(nextDocument, [current.objectId]).includes(current.objectId) ? null : current,
    );
    return nextDocument;
  }

  function updateLayer(objectId: string, patch: Partial<Pick<BoardObject, "hidden" | "locked" | "name">>) {
    const nextDocument = updateCurrentPageObjects(boardDocumentRef.current, (objects) =>
      objects.map((object) => (object.id === objectId ? cleanBoardObjectMetadata({ ...object, ...patch }) : object)),
    );
    setDocumentAndSave(nextDocument);
  }

  function toggleLayerHidden(objectId: string) {
    const object = getCurrentPageObjects(boardDocumentRef.current).find((item) => item.id === objectId);
    if (!object) return;
    updateLayer(objectId, { hidden: !object.hidden });
    setCanvasContextMenu(null);
    setStatus(object.hidden ? "已显示图层" : "已隐藏图层");
  }

  function toggleLayerLocked(objectId: string) {
    const object = getCurrentPageObjects(boardDocumentRef.current).find((item) => item.id === objectId);
    if (!object) return;
    updateLayer(objectId, { locked: !object.locked });
    setCanvasContextMenu(null);
    setStatus(object.locked ? "已解锁图层" : "已锁定图层");
  }

  function renameLayer(objectId: string, name: string) {
    updateLayer(objectId, { name });
    setStatus("已重命名图层");
  }

  function selectLayer(objectId: string) {
    const resolvedIds = resolveGroupedSelectionOnCurrentPage(boardDocumentRef.current, [objectId]);
    setSelectedObjectIds(resolvedIds);
    setCanvasContextMenu(null);
    const object = getCurrentPageObjects(boardDocumentRef.current).find((item) => item.id === objectId);
    if (object?.type === "image" && !object.hidden && !object.locked) {
      setSourceAssetId(object.assetId);
    }
  }

  function selectLayerGroup(objectIds: string[]) {
    const selectableIds = resolveGroupedSelectionOnCurrentPage(boardDocumentRef.current, objectIds).filter((id) =>
      selectableObjectIds.has(id),
    );
    setSelectedObjectIds(selectableIds);
    setCanvasContextMenu(null);
    const firstImage = getCurrentPageObjects(boardDocumentRef.current).find(
      (object): object is BoardImageObject => selectableIds.includes(object.id) && object.type === "image",
    );
    if (firstImage) setSourceAssetId(firstImage.assetId);
  }

  function toggleLayerGroupCollapsed(groupId: string) {
    setCollapsedLayerGroupIds((current) =>
      current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId],
    );
  }

  function toggleLayerGroupHidden(objectIds: string[]) {
    const groupObjects = getCurrentPageObjects(boardDocumentRef.current).filter((object) => objectIds.includes(object.id));
    const shouldShow = groupObjects.length > 0 && groupObjects.every((object) => object.hidden);
    const nextDocument = updateCurrentPageObjects(boardDocumentRef.current, (objects) =>
      objects.map((object) =>
        objectIds.includes(object.id)
          ? cleanBoardObjectMetadata({ ...object, hidden: shouldShow ? undefined : true })
          : object,
      ),
    );
    setDocumentAndSave(nextDocument);
    setStatus(shouldShow ? "已显示分组" : "已隐藏分组");
  }

  function toggleLayerGroupLocked(objectIds: string[]) {
    const groupObjects = getCurrentPageObjects(boardDocumentRef.current).filter((object) => objectIds.includes(object.id));
    const shouldUnlock = groupObjects.length > 0 && groupObjects.every((object) => object.locked);
    const nextDocument = updateCurrentPageObjects(boardDocumentRef.current, (objects) =>
      objects.map((object) =>
        objectIds.includes(object.id)
          ? cleanBoardObjectMetadata({ ...object, locked: shouldUnlock ? undefined : true })
          : object,
      ),
    );
    setDocumentAndSave(nextDocument);
    setStatus(shouldUnlock ? "已解锁分组" : "已锁定分组");
  }

  function ungroupLayerObjects(objectIds: string[]) {
    const result = ungroupObjectsOnCurrentPage(boardDocumentRef.current, objectIds);
    if (result.changedObjectIds.length === 0) {
      setStatus("这个分组无法解组");
      return;
    }
    setDocumentAndSave(result.document);
    setSelectedObjectIds(result.changedObjectIds);
    setStatus(`已解组 ${result.changedObjectIds.length} 个对象`);
  }

  function deleteCanvasObject(objectId: string) {
    const targetObject = getCurrentPageObjects(boardDocumentRef.current).find((object) => object.id === objectId);
    if (targetObject?.locked) {
      setCanvasContextMenu(null);
      setStatus("图层已锁定，需解锁后删除");
      return;
    }
    const result = removeUnlockedObjectsFromCurrentPage(boardDocumentRef.current, [objectId]);
    if (result.removedObjectIds.length === 0) return;
    const nextDocument = result.document;
    setDocumentAndSave(nextDocument, { allowEmpty: true });
    setSelectedObjectIds((current) => current.filter((id) => id !== objectId));
    if (canvasContextMenu?.objectId === objectId) {
      setCanvasContextMenu(null);
    }
    const remainingObjects = getCurrentPageObjects(nextDocument);
    const sourceStillExists = remainingObjects.some(
      (object) => object.type === "image" && object.assetId === sourceAssetId && !object.hidden,
    );
    if (!sourceStillExists) {
      setSourceAssetId("");
      setMaskState(null);
      setMobileMaskRedoStrokes([]);
      setMobileMaskColor("");
      cancelMobileMaskStroke();
    }
    setStatus("已删除图层");
  }

  function moveLayer(objectId: string, direction: "up" | "down") {
    const nextDocument = updateCurrentPageObjects(boardDocumentRef.current, (objects) => {
      const currentIndex = objects.findIndex((object) => object.id === objectId);
      if (currentIndex < 0) return objects;
      const nextIndex = direction === "up" ? currentIndex + 1 : currentIndex - 1;
      if (nextIndex < 0 || nextIndex >= objects.length) return objects;
      const nextObjects = [...objects];
      const [object] = nextObjects.splice(currentIndex, 1);
      nextObjects.splice(nextIndex, 0, object);
      return nextObjects;
    });
    setDocumentAndSave(nextDocument);
    setCanvasContextMenu(null);
    setStatus(direction === "up" ? "已上移图层" : "已下移图层");
  }

  function deleteAsset(asset: AssetPayload) {
    startTransition(async () => {
      try {
        setStatus("正在删除素材");
        const response = await apiFetch(`/api/assets/${asset.id}`, { method: "DELETE" });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error ?? "删除素材失败");
        }
        setBoard((current) => ({
          ...current,
          assets: current.assets.filter((item) => item.id !== asset.id),
          jobs: removeAssetFromJobs(current.jobs, asset.id),
        }));
        const wasVisible = visibleImageAssetsRef.current.some((item) => item.id === asset.id);
        setVisibleImageAssets((current) => current.filter((item) => item.id !== asset.id));
        if (wasVisible) {
          setAssetListTotalMatching((current) =>
            typeof current === "number" ? Math.max(0, current - 1) : current,
          );
        }
        const nextReferenceItems = referenceItems.filter((item) => item.assetId !== asset.id);
        const nextReferenceAssetIds = referenceAssetIds.filter((item) => item !== asset.id);
        const nextReferenceAssetIdsByRole = { ...referenceAssetIdsByRole };
        for (const key of Object.keys(nextReferenceAssetIdsByRole) as ReferenceRole[]) {
          if (nextReferenceAssetIdsByRole[key] === asset.id) {
            delete nextReferenceAssetIdsByRole[key];
          }
        }
        const shouldClearSource = sourceAssetId === asset.id;
        const shouldClearMask = maskState?.assetId === asset.id;
        if (shouldClearSource) {
          setSourceAssetId("");
          setMaskState(null);
          setMobileMaskRedoStrokes([]);
          setMobileMaskColor("");
          cancelMobileMaskStroke();
        }
        setReferenceAssetIds(nextReferenceAssetIds);
        setReferenceItems(nextReferenceItems);
        setReferenceAssetIdsByRole(nextReferenceAssetIdsByRole);
        if (shouldClearMask) {
          setMaskState(null);
          setMobileMaskRedoStrokes([]);
        }
        if (assetPreviewAsset?.id === asset.id) {
          setAssetPreviewAsset(null);
        }
        const cleanedAppSnapshot: Partial<AppSnapshot> = {
          maskState: shouldClearMask ? null : maskState,
          referenceAssetIds: nextReferenceAssetIds,
          referenceAssetIdsByRole: nextReferenceAssetIdsByRole,
          referenceItems: nextReferenceItems,
          sourceAssetId: shouldClearSource ? "" : sourceAssetId,
        };
        const cleanedDocument = removeAssetFromCanvas(asset.id, cleanedAppSnapshot);
        await saveSnapshot({ allowEmpty: true, appSnapshot: cleanedAppSnapshot, document: cleanedDocument });
        await refreshBoard();
        refreshVisibleAssetList();
        setStatus("已删除素材");
      } catch (error) {
        setStatus(getFriendlyErrorMessage(error, "删除素材失败"));
      }
    });
  }

  function reuseGenerationJob(job: JobPayload) {
    const params = getGenerationJobParams(job);
    if (job.mode === "text_to_image") {
      setSourcePrompt(job.prompt);
      if (params.size && isValidImageSize(params.size)) {
        setSourceImageSize(params.size);
      }
    } else {
      setPrompt(job.prompt);
      if (params.size && isValidImageSize(params.size)) {
        setSourceImageSize(params.size);
      }
      if (job.sourceAssetId) {
        setSourceAssetId(job.sourceAssetId);
      }
    }
    setStatus("已复用最新生成记录");
  }

  function retryGenerationJob(job: JobPayload) {
    const params = getGenerationJobParams(job);
    const nextReferenceItems =
      params.referenceItems ??
      params.referenceAssetIds?.map((assetId) => ({ assetId })) ??
      [];
    const size = params.size && isValidImageSize(params.size) ? params.size : selectedSourceSize;
    if (params.model) setSelectedImageModel(params.model);
    setGenerationCount(getValidGenerationCount(params.count));
    setReferenceItems(nextReferenceItems);
    setReferenceAssetIds(nextReferenceItems.map((item) => item.assetId));
    setReferenceAssetIdsByRole(getReferenceAssetMapFromItems(nextReferenceItems));
    const nextReferenceAssets = getResolvedReferenceAssets(nextReferenceItems, imageAssets);
    if (job.mode === "text_to_image") {
      setSourcePrompt(job.prompt);
      setSourceImageSize(size);
      generate("text_to_image", {
        noticeScope: "source",
        promptAlreadyStyled: true,
        promptText: job.prompt,
        referenceAssetsOverride: nextReferenceAssets,
        size,
      });
      return;
    }
    if (!job.sourceAssetId) {
      setStatus("这条改图记录缺少源图，无法重试");
      return;
    }
    setSourceAssetId(job.sourceAssetId);
    setPrompt(job.prompt);
    setSourceImageSize(size);
    generate("inpaint", {
      noticeScope: "edit",
      promptAlreadyStyled: true,
      promptText: job.prompt,
      referenceAssetsOverride: nextReferenceAssets,
      size,
    });
  }

  function applyPromptRecipe(recipe: PromptRecipePayload) {
    const params = getPromptRecipeParams(recipe.params);
    if (recipe.mode === "inpaint") {
      setPrompt(recipe.prompt);
      if (params.preserveStrength) setPreserveStrength(params.preserveStrength);
      setDesktopView("edit");
      setMobileView("edit");
    } else {
      setSourcePrompt(recipe.prompt);
      setDesktopView("generate");
      setMobileView("generate");
    }
    if (params.size && isValidImageSize(params.size)) {
      setSourceImageSize(params.size);
      setSelectedAspectRatio(getAspectFromImageSize(params.size));
      setSelectedQuality(getQualityFromImageSize(params.size));
    }
    if (params.artStyle) setArtStyle(params.artStyle);
    if (params.count) setGenerationCount(params.count);
    if (params.model) setSelectedImageModel(params.model);
    if (params.referenceFit) setReferenceFit(params.referenceFit);
    setStatus(`已载入配方：${recipe.name}`);
  }

  function loadGenerationResultsToCanvas(job: JobPayload) {
    const assets = job.results.map((result) => result.asset);
    if (assets.length === 0) {
      setStatus("这条生成记录没有可载入结果");
      return;
    }
    startTransition(async () => {
      try {
        await insertAssets(assets);
      } catch (error) {
        setStatus(getFriendlyErrorMessage(error, "载入生成结果失败"));
      }
    });
  }

  function openLatestGenerationResults() {
    if (!latestGenerationJob) return;
    setIsMobileResultStripDismissed(false);
    if (latestGenerationHasResults) {
      openResultPicker(latestGenerationJob);
      return;
    }
    setMobileView(latestGenerationJob.mode === "text_to_image" ? "generate" : "edit");
    setMobileSheetLevel("half");
  }

  function revealMobileResultFilmstrip() {
    setIsMobileResultStripDismissed(false);
    setMobileView("canvas");
    setMobileSheetLevel("collapsed");
  }

  function retryLatestGeneration() {
    if (!latestGenerationJob) return;
    retryGenerationJob(latestGenerationJob);
  }

  function insertMobileAsset(asset: AssetPayload) {
    startTransition(async () => {
      try {
        await insertAsset(asset);
        setMobileView("canvas");
        setMobileSheetLevel("collapsed");
        setIsMobileResultStripDismissed(true);
        setStatus("已插入素材到画布");
      } catch (error) {
        setStatus(getFriendlyErrorMessage(error, "插入素材失败"));
      }
    });
  }

  function exportBatchAsPng(mode: BatchExportMode) {
    startTransition(async () => {
      try {
        const batches = getBatchExportBatches({
          mode,
          objects: pageObjects,
          selectedObjectIds: activeSelectedObjectIds,
        });
        if (batches.length === 0) {
          throw new Error(
            mode === "groups"
              ? "当前画板没有可导出的分组"
              : mode === "selection"
                ? "请先选择可导出的对象"
                : "画板为空，无法导出",
          );
        }
        const exportDate = new Date();
        const outputs: Array<{ relativePath: string }> = [];
        for (const [index, batch] of batches.entries()) {
          const dataUrl = await exportObjectsToPng({ assets: board.assets, objects: batch.objects });
          const blob = dataUrlToBlob(dataUrl);
          const filename = createBatchExportFilename(board.name, "png", {
            date: exportDate,
            index,
            label: batch.label,
            mode,
          });
          const output = await saveBlobToLocalExport(blob, filename);
          downloadBlob(blob, filename);
          outputs.push(output);
        }
        setStatus(`已导出 ${outputs.length} 个 PNG，保存到 ${outputs.at(-1)?.relativePath ?? "local-exports"}`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "导出 PNG 失败");
      }
    });
  }

  function exportSelectionAsPng() {
    exportBatchAsPng(activeSelectedObjectIds.length > 0 ? "selection" : "page");
  }

  function generateSelectedImageVariant() {
    void (async () => {
      try {
        const source = getSelectedImageAssetFromDocument() ?? sourceAsset;
        if (!source) throw new Error("请先选择一张图片");
        setSourceAssetId(source.id);
        setDesktopView("edit");
        setMobileView("edit");
        setCanvasContextMenu(null);
        const placement = getSelectedImagePlacementFromDocument();
        const variantPrompt = prompt.trim()
          ? `Create image variations based on the selected source image. ${prompt.trim()}`
          : "Create visually distinct variations based on this source image. Preserve the main subject and composition, while changing surface details, lighting nuance, material feel, and finishing style enough that each result is a usable candidate.";
        await generateImageEdit({
          count: generationCount,
          source,
          promptText: variantPrompt,
          placement,
          statusText: `正在生成变体候选，结果会插入到原图右侧`,
          doneText: "已生成变体候选",
          taskLabel: "变体生成",
        });
      } catch (error) {
        const errorText = getFriendlyErrorMessage(error, "生成变体失败");
        setStatus(errorText);
        setGenerationNotice({ scope: "edit", tone: "error", text: errorText });
      }
    })();
  }

  function generateSelectedImageMultiAngle(angle: MultiAngleOptionValue = defaultMultiAngleOptionValue) {
    void (async () => {
      try {
        const source = getSelectedImageAssetFromDocument() ?? sourceAsset;
        if (!source) throw new Error("请先选择一张图片");
        setSourceAssetId(source.id);
        setDesktopView("edit");
        setMobileView("edit");
        setCanvasContextMenu(null);
        const candidateCount = getValidGenerationCount(generationCount);
        const multiAnglePrompt = buildMultiAnglePrompt({
          angle,
          candidateCount,
          userInstruction: prompt,
        });
        await generateImageEdit({
          count: candidateCount,
          source,
          promptText: multiAnglePrompt,
          placement: getSelectedImagePlacementFromDocument(),
          statusText: "正在生成多角度候选，结果会插入到原图右侧",
          doneText: "已生成多角度候选",
          promptAlreadyStyled: true,
          taskLabel: "多角度",
        });
      } catch (error) {
        const errorText = getFriendlyErrorMessage(error, "生成多角度失败");
        setStatus(errorText);
        setGenerationNotice({ scope: "edit", tone: "error", text: errorText });
      }
    })();
  }

  function editSelectedImageFromPrompt() {
    void (async () => {
      try {
        if (!prompt.trim()) throw new Error("请输入提示词");
        const source = getSelectedImageAssetFromDocument() ?? sourceAsset;
        if (!source) throw new Error("请先选择一张图片");
        await generateImageEdit({
          source,
          promptText: prompt,
          placement: getSelectedImagePlacementFromDocument(),
          statusText: "正在图生图",
          doneText: "已完成图生图",
        });
      } catch (error) {
        const errorText = getFriendlyErrorMessage(error, "图生图失败");
        setStatus(errorText);
        setGenerationNotice({ scope: "edit", tone: "error", text: errorText });
      }
    })();
  }

  function removeSelectedImageBackground() {
    startTransition(async () => {
      try {
        const source = getSelectedImageAssetFromDocument() ?? sourceAsset;
        if (!source) throw new Error("请先选择一张图片");
        setStatus("正在本地删除纯色背景");
        setGenerationNotice(null);

        const response = await apiFetch(`/api/assets/${source.id}/remove-background`, {
          method: "POST",
        });
        const payload = (await response.json()) as { asset?: AssetPayload; error?: string };
        if (!response.ok || !payload.asset) {
          throw new Error(payload.error ?? "删除背景失败");
        }

        mergeAssetsIntoBoard([payload.asset]);
        addAssetsToVisibleList([payload.asset]);
        await insertAsset(payload.asset, getSelectedImagePlacementFromDocument(), 1);
        void refreshBoard().catch(() => undefined);
        setStatus("已生成本地透明背景 PNG");
        setGenerationNotice({ scope: "edit", tone: "success", text: "已生成本地透明背景 PNG" });
      } catch (error) {
        const errorText = getFriendlyErrorMessage(error, "删除背景失败");
        setStatus(errorText);
        setGenerationNotice({ scope: "edit", tone: "error", text: errorText });
      }
    });
  }

  function runFixedWorkflow(workflow: "logo" | "outfit" | "product") {
    setIsCanvasMoreMenuOpen(false);
    if (workflow === "product") {
      setSourcePrompt(
        "Create a clean e-commerce hero image for this product, natural studio lighting, premium material details, clear subject edges, commercial catalog quality.",
      );
      setPrompt(
        "Replace the marked product area with the product reference. Keep hands, pose, lighting, background, and all unmasked regions stable.",
      );
      setPreserveStrength("strict");
      setReferenceFit("exact");
      setDesktopView("edit");
      setMobileView("edit");
      setStatus("已载入商品图固定流程，请确认源图、参考图和蒙版后生成");
      return;
    }
    if (workflow === "outfit") {
      setPrompt(
        "Replace only the selected outfit with the clothing reference. Preserve face, body proportions, pose, hands, lighting, and background.",
      );
      setPreserveStrength("strict");
      setReferenceFit("exact");
      setDesktopView("edit");
      setMobileView("edit");
      setStatus("已载入人物换装固定流程，请确认服装区域和参考图后生成");
      return;
    }
    setSourcePrompt(
      "Place the uploaded logo in realistic brand application scenes, premium packaging and signage mockups, clean composition, commercial presentation board.",
    );
    setPrompt(
      "Generate a realistic application scene using the logo reference. Keep the logo readable, correctly proportioned, and naturally integrated.",
    );
    setPreserveStrength("balanced");
    setReferenceFit("exact");
    setDesktopView("generate");
    setMobileView("generate");
    setStatus("已载入 Logo 展示固定流程，请确认参考 Logo 后生成");
  }

  async function generateImageEdit(input: {
    count?: number;
    source: AssetPayload;
    promptText: string;
    placement?: ShapePlacement;
    statusText: string;
    doneText: string;
    promptAlreadyStyled?: boolean;
    taskLabel?: string;
  }) {
    const generationStartedAtMs = Date.now();
    setActiveGeneration({
      modeLabel: "AI 改图",
      prompt: input.promptText,
      startedAtMs: generationStartedAtMs,
      taskLabel: input.taskLabel,
    });
    setStatus(`${input.statusText}，已运行 0 秒`);
    setGenerationNotice(null);
    const beforeGenerationAssetIds = new Set(board.assets.map((asset) => asset.id));
    const promptText = input.promptAlreadyStyled
      ? input.promptText
      : appendArtStyleInstruction(input.promptText, artStyle);

    let payload: { job: JobPayload; results: AssetPayload[] };
    try {
      const job = await startGenerationJob({
        boardId: board.id,
        model: selectedImageModel,
        mode: "inpaint",
        prompt: promptText,
        size: selectedSourceSize,
        sourceAssetId: input.source.id,
        count: input.count ?? generationCount,
      });
      payload = await waitForGenerationJob(job.id);
    } catch (error) {
      if (isNetworkError(error)) {
        const recovered = await recoverGeneratedAssets({
          beforeAssetIds: beforeGenerationAssetIds,
          doneText: (count) => `${input.doneText}：${count} 张候选图`,
          noticeScope: "edit",
          placement: input.placement,
          promptText,
          startedAtMs: generationStartedAtMs,
        });
        if (recovered) return;
      }
      throw error;
    } finally {
      setActiveGeneration(null);
    }

    const results = payload.results as AssetPayload[];
    mergeGenerationJobIntoBoard(payload.job);
    mergeAssetsIntoBoard(results);
    addAssetsToVisibleList(results);
    await insertAssets(results, input.placement);
    void refreshBoard().catch(() => undefined);
    const doneText = `${input.doneText}：${payload.results.length} 张候选图`;
    setStatus(doneText);
    setGenerationNotice({ scope: "edit", tone: "success", text: doneText });
    if (payload.job?.id && payload.results.length > 1) {
      setResultPickerJobId(payload.job.id);
      setResultPickerComparisonAssetId("");
    }
  }

  function getSelectedImageAssetFromDocument() {
    if (!selectedImageObject) return null;
    return board.assets.find((asset) => asset.id === selectedImageObject.assetId) ?? null;
  }

  function getSelectedImagePlacementFromDocument(): ShapePlacement | undefined {
    if (!selectedImageObject) return undefined;
    return {
      h: selectedImageObject.h,
      w: selectedImageObject.w,
      x: selectedImageObject.x,
      y: selectedImageObject.y,
    };
  }

  function undoMaskStroke() {
    if (!sourceAsset || maskStrokes.length === 0) return;
    const removedStroke = maskStrokes.at(-1);
    setMaskState((current) => {
      if (!current || current.assetId !== sourceAsset.id) return current;
      const nextStrokes = current.strokes.slice(0, -1);
      return nextStrokes.length > 0 ? { assetId: sourceAsset.id, strokes: nextStrokes } : null;
    });
    if (removedStroke) {
      setMobileMaskRedoStrokes((current) => [removedStroke, ...current]);
    }
    setStatus("已撤销上一笔涂抹");
  }

  function redoMaskStroke() {
    if (!sourceAsset || mobileMaskRedoStrokes.length === 0) return;
    const [stroke, ...rest] = mobileMaskRedoStrokes;
    appendMaskStroke(sourceAsset.id, stroke);
    setMobileMaskRedoStrokes(rest);
    setStatus("已恢复上一笔涂抹");
  }

  function resetMaskStrokes() {
    setMaskState(null);
    setMobileMaskRedoStrokes([]);
    setStatus("已重置涂抹区域");
  }

  function updateSourcePromptDraft(value: string) {
    setSourcePrompt(value);
    scheduleSave({ appSnapshot: { sourcePrompt: value } });
  }

  function updateEditPromptDraft(value: string) {
    setPrompt(value);
    scheduleSave({ appSnapshot: { prompt: value } });
  }

  function clearSourcePromptDraft() {
    updateSourcePromptDraft("");
    setStatus("已清空生图提示词");
  }

  function clearEditPromptDraft() {
    updateEditPromptDraft("");
    setStatus("已清空改图要求");
  }

  function handleCanvasMaskStroke(stroke: Point[]) {
    if (!sourceAsset) {
      setStatus("请先设置源图");
      return;
    }
    appendMaskStroke(sourceAsset.id, stroke);
    setStatus("已添加画布蒙版，可继续涂抹或点击局部重绘");
  }

  function handleCanvasSelectionChange(ids: string[]) {
    setCanvasContextMenu(null);
    const selectableIds = resolveGroupedSelectionOnCurrentPage(boardDocumentRef.current, ids).filter((id) =>
      selectableObjectIds.has(id),
    );
    setSelectedObjectIds(selectableIds);
    const imageObject = selectableIds
      .map((id) => pageObjects.find((object) => object.id === id))
      .find((object): object is BoardImageObject => Boolean(object && object.type === "image" && !object.hidden && !object.locked));
    if (imageObject) {
      setSourceAssetId(imageObject.assetId);
    }
  }

  function handleCanvasObjectContextMenu(input: { id: string; point: Point }) {
    const object = pageObjects.find((item) => item.id === input.id);
    if (!object) {
      setCanvasContextMenu(null);
      return;
    }
    if (!activeSelectedObjectIds.includes(input.id)) {
      setSelectedObjectIds(resolveGroupedSelectionOnCurrentPage(boardDocumentRef.current, [input.id]));
    }
    setCanvasContextMenu({ objectId: input.id, x: input.point.x, y: input.point.y });
  }

  async function copyContextMenuImage() {
    if (!canvasContextMenu) return;
    const object = pageObjects.find((item): item is BoardImageObject => item.id === canvasContextMenu.objectId && item.type === "image");
    const asset = object ? imageAssets.find((item) => item.id === object.assetId) : null;
    if (!asset) {
      setStatus("未找到可复制的图片素材");
      setCanvasContextMenu(null);
      return;
    }
    try {
      const response = await fetch(apiUrl(asset.publicUrl));
      if (!response.ok) throw new Error("图片读取失败");
      const blob = await response.blob();
      if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
        throw new Error("当前浏览器不支持复制图片到剪贴板");
      }
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type || asset.mimeType || "image/png"]: blob,
        }),
      ]);
      setStatus("已复制图片");
    } catch (error) {
      setStatus(getFriendlyErrorMessage(error, "复制图片失败"));
    } finally {
      setCanvasContextMenu(null);
    }
  }

  function renderPromptAssistControls(idPrefix: string) {
    const suggestions = promptAssistResult
      ? getStringArray([promptAssistResult.prompt, ...promptAssistResult.variations])
      : [];

    return (
      <div className="prompt-assist-panel" data-testid={`${idPrefix}-prompt-assist`}>
        <div className="prompt-assist-controls">
          <label className="select-field">
            图片类型
            <select
              onChange={(event) => setPromptAssistImageType(event.target.value as PromptAssistImageType)}
              value={promptAssistImageType}
            >
              <option value="auto">自动判断</option>
              <option value="ui">UI 界面</option>
              <option value="infographic">信息图表</option>
              <option value="poster">广告海报</option>
              <option value="ecommerce">商品电商</option>
              <option value="person">人物</option>
              <option value="photo">摄影写实</option>
              <option value="scene">场景</option>
              <option value="object">物品</option>
              <option value="brand">品牌图形</option>
              <option value="architecture">建筑空间</option>
              <option value="illustration">插画艺术</option>
              <option value="character">角色设定</option>
              <option value="publication">文档出版物</option>
              <option value="other">其他创意</option>
            </select>
          </label>
          <label className="select-field">
            提示词辅助
            <select
              onChange={(event) => setPromptAssistAction(event.target.value as PromptAssistAction)}
              value={promptAssistAction}
            >
              <option value="optimize">优化表达</option>
              <option value="expand">扩写细节</option>
              <option value="variations">生成变体</option>
              <option value="translate">整理中文</option>
            </select>
          </label>
          <button
            disabled={isPromptAssistLoading || !sourcePrompt.trim()}
            onClick={() => void runPromptAssist("standard")}
            type="button"
          >
            {isPromptAssistLoading ? <AppIcon icon={IconLoading} className="spin" size="md" /> : <AppIcon icon={IconAi} size="md" />}
            辅助提示词
          </button>
          <button
            disabled={isPromptAssistLoading || !sourcePrompt.trim()}
            onClick={() => void runPromptAssist("skill2")}
            type="button"
          >
            {isPromptAssistLoading ? <AppIcon icon={IconLoading} className="spin" size="md" /> : <AppIcon icon={IconAi} size="md" />}
            辅助提示词2
          </button>
          <button
            disabled={isPromptAssistLoading || !sourcePrompt.trim()}
            onClick={() => void runPromptSafetyOptimizer("standard")}
            type="button"
          >
            {isPromptAssistLoading ? <AppIcon icon={IconLoading} className="spin" size="md" /> : <AppIcon icon={IconAi} size="md" />}
            安全优化器
          </button>
        </div>
        {promptAssistError ? <p className="generation-result-hint error">{promptAssistError}</p> : null}
        {suggestions.length > 0 ? (
          <button
            className="prompt-assist-ready"
            onClick={() => setIsPromptAssistDialogOpen(true)}
            type="button"
          >
            已生成 {suggestions.length} 条提示词建议，点击查看
          </button>
        ) : null}
      </div>
    );
  }

  function renderPromptRecipePanel(mode: "text_to_image" | "inpaint") {
    const modeRecipes = promptRecipes.filter((recipe) => recipe.mode === mode);
    return (
      <section className="panel-section prompt-recipe-section">
        <div className="section-title">
          <span>提示词配方</span>
          <button disabled={isPromptRecipeLoading} onClick={() => void loadPromptRecipes()} type="button">
            <AppIcon icon={IconRefresh} className={isPromptRecipeLoading ? "spin" : undefined} size="sm" />
            刷新
          </button>
        </div>
        <div className="prompt-recipe-save-row">
          <input
            maxLength={80}
            onChange={(event) => setPromptRecipeName(event.target.value)}
            placeholder="配方名称"
            value={promptRecipeName}
          />
          <button disabled={isPromptRecipeLoading || !promptRecipeName.trim()} onClick={() => void savePromptRecipe(mode)} type="button">
            <AppIcon icon={IconSave} size="sm" />
            保存
          </button>
        </div>
        {promptRecipeError ? <p className="generation-result-hint error">{promptRecipeError}</p> : null}
        <div className="prompt-recipe-list">
          {modeRecipes.map((recipe) => (
            <article className="prompt-recipe-item" key={recipe.id}>
              <button onClick={() => applyPromptRecipe(recipe)} title={recipe.prompt} type="button">
                <strong>{recipe.name}</strong>
                <span>{recipe.prompt}</span>
              </button>
              <button aria-label={`删除配方 ${recipe.name}`} onClick={() => void deletePromptRecipe(recipe)} type="button">
                <AppIcon icon={IconDelete} size="sm" />
              </button>
            </article>
          ))}
          {modeRecipes.length === 0 ? <p className="muted">还没有保存的配方</p> : null}
        </div>
      </section>
    );
  }

  function renderReferencePanel(title: string) {
    const activeReferenceRoleItem =
      referenceAssets.find((item) => item.asset.id === openReferenceRoleAssetId) ?? null;
    return (
      <section className="panel-section reference-panel-section">
        <div className="section-title">
          <span>{title}</span>
          <button disabled={referenceAssets.length === 0} onClick={clearReferenceAssets} type="button">
            清空
          </button>
        </div>
        {renderGroupedReferenceList(title)}
        {activeReferenceRoleItem ? renderReferenceRolePanel(activeReferenceRoleItem) : null}
        {renderReferenceConflictControls()}
        <label className="upload-inline">
          <AppIcon icon={IconPlus} size="md" />
          添加参考图
          <input
            accept="image/*"
            multiple
            onChange={(event) => {
              handleReferenceUpload(event.target.files);
              event.currentTarget.value = "";
            }}
            suppressHydrationWarning
            type="file"
          />
        </label>
        <label className="select-field">
          参考匹配
          <select onChange={(event) => setReferenceFit(event.target.value as ReferenceFit)} value={referenceFit}>
            {referenceFitOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </section>
    );
  }

  function renderAspectRatioControls() {
    return (
      <div className="creative-field-group">
        <div className="creative-field-title">画面比例</div>
        <div className="aspect-chip-row">
          {boardAspectRatioOptions.map((option) => (
            <button
              aria-label={`${option.label}，${option.usageTitle}`}
              aria-pressed={selectedAspectRatio === option.value}
              className={`aspect-chip aspect-chip-${getAspectRatioOrientation(option.value)}`}
              key={option.value}
              onClick={() => updateSourceAspectRatio(option.value)}
              title={option.usageTitle}
              type="button"
            >
              <span
                aria-hidden="true"
                className="aspect-chip-visual"
                style={{
                  "--aspect-visual-height": `${option.visualHeight}px`,
                  "--aspect-visual-width": `${option.visualWidth}px`,
                } as CSSProperties}
              >
                <em className={`aspect-app-badge aspect-app-badge-${option.appIconTone}`}>
                  {option.appIcon}
                </em>
              </span>
              <strong>{option.label}</strong>
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderArtStyleControls() {
    return (
      <div className="creative-field-group">
        <div className="creative-field-title">风格选择</div>
        <div className="style-card-row">
          {boardArtStyleOptions.map((option) => (
            <button
              aria-pressed={artStyle === option.value}
              key={option.value}
              onClick={() => updateArtStyle(option.value)}
              type="button"
            >
              <img alt="" className="style-preview" src={option.previewUrl} />
              <em>{option.label}</em>
            </button>
          ))}
        </div>
        {currentArtStyleOption.instruction ? <p className="muted">{currentArtStyleOption.instruction}</p> : null}
      </div>
    );
  }

  function renderQualityControls() {
    if (selectedAspectRatio === "auto") {
      return (
        <div className="creative-field-group">
          <div className="creative-field-title">画质选项</div>
          <p className="muted">当前输出：{selectedSourceSizeLabel}</p>
        </div>
      );
    }
    return (
      <div className="creative-field-group">
        <div className="creative-field-title">画质选项</div>
        <div className="quality-segment-row">
          {selectedSourceQualityOptions.map((option) => (
            <button
              aria-pressed={selectedQuality === option.value}
              key={option.value}
              onClick={() => updateSourceQuality(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="muted">当前输出：{selectedSourceSizeLabel}</p>
      </div>
    );
  }

  function renderCreativeCountControls() {
    return (
      <div className="creative-field-group">
        <div className="creative-field-title">生成数量</div>
        <div className="creative-count-row">
          <button onClick={() => updateGenerationCount(generationCount - 1)} type="button">
            <AppIcon icon={IconMinus} size="md" />
          </button>
          <input
            max={MAX_GENERATION_COUNT}
            min={1}
            onChange={(event) => updateGenerationCount(Number(event.target.value))}
            type="range"
            value={generationCount}
          />
          <span>{generationCount}</span>
          <button onClick={() => updateGenerationCount(generationCount + 1)} type="button">
            <AppIcon icon={IconPlus} size="md" />
          </button>
        </div>
      </div>
    );
  }

  function renderImageModelSelect(id: string) {
    return (
      <label className="creative-model-select" htmlFor={id}>
        <span>模型选择</span>
        <select id={id} onChange={(event) => updateSelectedImageModel(event.target.value)} value={selectedImageModel}>
          {imageModelOptions.map((model) => (
            <option key={getProviderModelOptionValue(model)} value={getProviderModelOptionValue(model)}>
              {model.label}
            </option>
          ))}
        </select>
        {imageModelStatus ? <em>{imageModelStatus}</em> : null}
      </label>
    );
  }

  function renderDesktopGenerateAdvancedSettings() {
    return (
      <details className="desktop-advanced-settings">
        <summary>
          <span>高级输出设置</span>
          <em>{generationCount} 张 · {selectedSourceSizeLabel}</em>
        </summary>
        <div className="desktop-advanced-settings-body">
          {renderPromptRecipePanel("text_to_image")}
        </div>
      </details>
    );
  }

  function renderGenerationChecklist(summary: string, items: Array<{ label: string; value: string }>) {
    return (
      <div className={isGenerationChecklistExpanded ? "desktop-generation-checklist is-expanded" : "desktop-generation-checklist"} aria-label="生成前检查">
        <span className="desktop-generation-checklist-summary">{summary}</span>
        <button
          aria-expanded={isGenerationChecklistExpanded}
          className="desktop-generation-checklist-toggle"
          onClick={() => setIsGenerationChecklistExpanded((current) => !current)}
          type="button"
        >
          {isGenerationChecklistExpanded ? "收起" : "详情"}
        </button>
        {isGenerationChecklistExpanded ? (
          <div className="desktop-generation-checklist-detail" role="status">
            {items.map((item) => (
              <span key={`${item.label}-${item.value}`}>
                <strong>{item.label}</strong>
                <em>{item.value}</em>
              </span>
            ))}
            <span>{sourceAsset ? `源图：${sourceAssetKindLabel}` : "源图：未选择"}</span>
            <span>模型：{selectedImageModelLabel}</span>
            <span>输出：{generationCount} 张 · {selectedSourceSizeLabel}</span>
            <span>参考：{markedReferenceCount}/{referenceAssets.length} 已标记 · {referenceFitOption.label}</span>
            <span>冲突：{referenceConflictEntries.length ? `${referenceConflictEntries.length} 组 · ${getReferenceConflictStrategyLabel(referenceConflictStrategy)}` : "无"}</span>
          </div>
        ) : null}
      </div>
    );
  }

  function renderGroupedReferenceList(keyPrefix: string) {
    if (referenceAssets.length === 0) {
      return <p className="muted">可从素材中设为参考图，或上传新参考图。</p>;
    }
    return (
      <div className="reference-group-stack">
        {groupedReferenceAssets.map((group) => {
          const isCollapsed = collapsedReferenceGroups.includes(group.key);
          return (
            <section className="reference-group" key={`${keyPrefix}-${group.key}`}>
              <button
                aria-expanded={!isCollapsed}
                className="reference-group-header"
                onClick={() => toggleReferenceGroup(group.key)}
                type="button"
              >
                <span>{isCollapsed ? "+" : "-"} {group.label}</span>
                <em>{group.items.length} 张</em>
              </button>
              {!isCollapsed ? (
                <div className="reference-grid reference-group-track">
                  {group.items.map((item) => renderReferenceCard(item, `${keyPrefix}-${group.key}`, { showReversePrompt: true }))}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    );
  }

  function renderReferenceConflictControls() {
    if (referenceConflictEntries.length === 0) return null;
    return (
      <section className="reference-conflict-controls" aria-label="参考冲突处理">
        <div className="reference-conflict-note" role="status">
          {referenceConflictEntries.map((entry) => `${entry.label} ×${entry.count}`).join(" · ")}
          <span>同一角色多图会按下方策略处理</span>
        </div>
        <div className="reference-conflict-strategy-row">
          {referenceConflictStrategyOptions.map((option) => (
            <button
              aria-pressed={referenceConflictStrategy === option.value}
              key={option.value}
              onClick={() => updateReferenceConflictStrategy(option.value)}
              title={option.instruction}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>
    );
  }

  function renderDesktopEditSourceSummary() {
    const contextStatus = !sourceAsset
      ? "需补源图"
      : !prompt.trim()
        ? "需补修改要求"
        : "可改图";
    return (
      <section className="panel-section desktop-edit-source-summary">
        <div className="section-title">
          <span>1. 当前上下文</span>
          <span className="pill">{contextStatus}</span>
        </div>
        <div className="desktop-source-summary-row">
          <div className="desktop-source-summary-thumb">
            {sourceAsset ? (
              <>
                <img alt="" src={apiUrl(sourceAsset.publicUrl)} />
                <button
                  aria-label="移除当前源图"
                  className="desktop-source-summary-clear"
                  onClick={clearSourceAsset}
                  type="button"
                >
                  <AppIcon icon={IconClose} size="sm" />
                </button>
              </>
            ) : (
              <label>
                <AppIcon icon={IconAddImage} size={20} />
                <span>上传</span>
                <input
                  accept="image/*"
                  onChange={(event) => {
                    handleUpload(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                  suppressHydrationWarning
                  type="file"
                />
              </label>
            )}
          </div>
          <div className="desktop-source-summary-body">
            <div className="desktop-source-summary-heading">
              <strong>源图</strong>
              <em>{sourceAsset ? sourceAssetKindLabel : "从素材、画布或本地上传一张待修改图片"}</em>
            </div>
            <div className="desktop-source-summary-meta">
              <span>{sourceAsset ? sourceAssetDimensions : "未选择"}</span>
              <span>{sourceAsset ? assetKindLabels[sourceAsset.kind] ?? sourceAsset.kind : "等待源图"}</span>
              <span>{sourceAsset ? formatDateTime(sourceAsset.createdAt) : "AI 改图需要源图"}</span>
            </div>
          </div>
        </div>
      </section>
    );
  }

  function renderDesktopEditModeControls() {
    const isMaskModeActive = currentToolId === "mask" || maskStrokes.length > 0;
    return (
      <div className="desktop-edit-mode-stack">
        <div className="desktop-mode-card-row" aria-label="改图模式">
          <button
            aria-pressed={!maskStrokes.length && currentToolId !== "mask"}
            onClick={() => applyModeReferenceFit("full")}
            type="button"
          >
            <strong>整图</strong>
            <span>建议平衡参考</span>
          </button>
          <button
            aria-pressed={currentToolId === "mask"}
            onClick={() => applyModeReferenceFit("mask")}
            type="button"
          >
            <strong>局部涂抹</strong>
            <span>建议严格贴合</span>
          </button>
          <button aria-pressed={false} onClick={() => applyModeReferenceFit("variant")} type="button">
            <strong>变体</strong>
            <span>弱化参考发散</span>
          </button>
        </div>
        <div className={isMaskModeActive ? "desktop-mask-tuning is-active" : "desktop-mask-tuning"}>
          <div className="desktop-subsection-title">
            <span>{isMaskModeActive ? "蒙版与保真" : "主体保真"}</span>
            <em>{isMaskModeActive ? `${maskStrokes.length} 条蒙版` : preserveStrengthOption.label}</em>
          </div>
          {isMaskModeActive ? (
            <div className="mask-controls">
              <label>
                笔触大小
                <input
                  max="0.12"
                  min="0.01"
                  onChange={(event) => setMaskBrushRatio(Number(event.target.value))}
                  step="0.005"
                  type="range"
                  value={maskBrushRatio}
                />
              </label>
              <label>
                羽化强度
                <input
                  max="0.06"
                  min="0"
                  onChange={(event) => setMaskFeatherRatio(Number(event.target.value))}
                  step="0.003"
                  type="range"
                  value={maskFeatherRatio}
                />
              </label>
            </div>
          ) : null}
          <label className="select-field">
            保留主体强度
            <select onChange={(event) => setPreserveStrength(event.target.value as PreserveStrength)} value={preserveStrength}>
              {preserveStrengthOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {isMaskModeActive ? (
            <div className="desktop-mask-action-row">
              <button aria-pressed={currentToolId === "mask"} onClick={() => setCurrentToolId(currentToolId === "mask" ? "select" : "mask")} type="button">
                <AppIcon icon={IconPaint} size="md" />
                蒙版笔
              </button>
              <button disabled={maskStrokes.length === 0} onClick={undoMaskStroke} type="button">撤销</button>
              <button disabled={mobileMaskRedoStrokes.length === 0} onClick={redoMaskStroke} type="button">恢复</button>
              <button disabled={maskStrokes.length === 0} onClick={resetMaskStrokes} type="button">清除</button>
            </div>
          ) : (
            <button className="desktop-mask-entry-button" onClick={() => setCurrentToolId("mask")} type="button">
              <AppIcon icon={IconPaint} size="md" />
              进入局部涂抹
            </button>
          )}
        </div>
      </div>
    );
  }

  function renderGenerationHistoryItem(job: JobPayload, key = job.id) {
    const promptText = job.prompt.trim() || "无提示词";
    const durationMs = getGenerationJobDurationMs(job, job.status === "running" ? clockNowMs : undefined);
    const resultCount = job.results.length;
    return (
      <article className="history-item" key={key}>
        <button className="history-item-main" onClick={() => reuseGenerationJob(job)} type="button">
          <span>{job.mode === "text_to_image" ? "AI 生图" : "AI 改图"}</span>
          <strong>{getGenerationJobStatusLabel(job.status)}</strong>
          <em>{durationMs === null ? "耗时未记录" : `耗时 ${formatDuration(durationMs)}`}</em>
          <small title={promptText}>提示词：{promptText}</small>
        </button>
        <div className="history-item-actions">
          <button onClick={() => reuseGenerationJob(job)} type="button">复用</button>
          {job.status === "failed" ? (
            <button onClick={() => retryGenerationJob(job)} type="button">重试</button>
          ) : null}
          {resultCount > 0 ? (
            <button onClick={() => loadGenerationResultsToCanvas(job)} type="button">
              全部载入
            </button>
          ) : null}
          {resultCount > 0 ? (
            <button onClick={() => openResultPicker(job)} type="button">
              挑选
            </button>
          ) : null}
        </div>
        {resultCount > 0 ? (
          <small className="history-item-result-count">{resultCount} 张结果可载入</small>
        ) : null}
      </article>
    );
  }

  function renderAssetFilters() {
    return (
      <div className="asset-filter-bar">
        <input
          aria-label="搜索素材"
          onChange={(event) => setAssetSearchQuery(event.target.value)}
          placeholder="搜索素材"
          type="search"
          value={assetSearchQuery}
        />
        <select
          aria-label="素材类型"
          onChange={(event) => setAssetKindFilter(event.target.value as AssetKindFilter)}
          value={assetKindFilter}
        >
          {assetKindFilterOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          aria-label="按标签筛选"
          onChange={(event) => setAssetTagFilter(event.target.value)}
          placeholder="标签精确筛选"
          type="search"
          value={assetTagFilter}
        />
        <button aria-pressed={assetFavoriteOnly} onClick={() => setAssetFavoriteOnly((value) => !value)} type="button">
          <AppIcon icon={IconStar} size="sm" />
          收藏
        </button>
      </div>
    );
  }

  function renderAssetCard(asset: AssetPayload, key = asset.id) {
    const tags = getAssetTags(asset);
    const className = [
      "asset-thumb",
      asset.id === sourceAsset?.id || referenceAssetIds.includes(asset.id) ? "active" : "",
      asset.isFavorite ? "is-favorite" : "",
    ].filter(Boolean).join(" ");
    return (
      <div className={className} data-asset-id={asset.id} data-testid="asset-card" key={key}>
        <button
          aria-label="预览素材"
          className="asset-preview-trigger"
          onClick={() => openAssetPreview(asset)}
          type="button"
        >
          <img alt="" decoding="async" loading="lazy" src={apiUrl(getAssetThumbnailUrl(asset))} />
        </button>
        <div className="asset-card-actions">
          <button
            aria-label={asset.isFavorite ? "取消收藏素材" : "收藏素材"}
            aria-pressed={asset.isFavorite}
            onClick={() => toggleAssetFavorite(asset)}
            title={asset.isFavorite ? "取消收藏" : "收藏"}
            type="button"
          >
            <AppIcon icon={IconStar} size="sm" />
          </button>
          <button aria-label="编辑素材标签" onClick={() => editAssetTags(asset)} title="编辑标签" type="button">
            <AppIcon icon={IconRename} size="sm" />
          </button>
        </div>
        <span>{assetKindLabels[asset.kind] ?? asset.kind}</span>
        {tags.length > 0 ? <em className="asset-tag-line">{tags.join(", ")}</em> : null}
      </div>
    );
  }

  function renderAssetList(emptyText = "还没有素材") {
    const isFiltered =
      assetSearchQuery.trim().length > 0 ||
      assetFavoriteOnly ||
      assetKindFilter !== "all" ||
      assetTagFilter.trim().length > 0;
    return (
      <>
        {renderAssetFilters()}
        <div className="asset-list" data-asset-count={visibleImageAssets.length} data-testid="asset-list">
          {visibleImageAssets.map((asset) => renderAssetCard(asset))}
          {visibleImageAssets.length === 0 && !isAssetListLoading ? (
            <p className="muted asset-empty">{isFiltered ? "没有符合筛选的素材" : emptyText}</p>
          ) : null}
        </div>
        <div className="asset-list-footer" aria-live="polite">
          {assetListError ? <p className="muted asset-list-error">{assetListError}</p> : null}
          {!assetListError && isAssetListLoading ? <p className="muted">正在载入素材...</p> : null}
          {!assetListError && !isAssetListLoading && assetListTotalMatching !== null ? (
            <p className="muted">已显示 {visibleImageAssets.length} / {assetListTotalMatching}</p>
          ) : null}
          {assetListNextCursor ? (
            <button disabled={isAssetListLoading} onClick={() => void loadMoreAssets()} type="button">
              {isAssetListLoading ? "载入中..." : "加载更多"}
            </button>
          ) : null}
        </div>
      </>
    );
  }

  function openResultPicker(job: JobPayload) {
    if (job.results.length === 0) {
      setStatus("这条生成记录没有可挑选结果");
      return;
    }
    setResultPickerJobId(job.id);
    setResultPickerComparisonAssetId("");
  }

  function renderVersionHistoryPanel() {
    return (
      <section className="panel-section version-panel-section">
        <div className="section-title">
          <span>画板版本</span>
          <button disabled={isBoardSnapshotLoading} onClick={() => void loadBoardSnapshots()} type="button">
            <AppIcon icon={IconRefresh} size="sm" />
            刷新
          </button>
        </div>
        <div className="version-save-row">
          <input
            maxLength={80}
            onChange={(event) => setBoardSnapshotName(event.target.value)}
            placeholder="命名版本，例如：提交前"
            type="text"
            value={boardSnapshotName}
          />
          <button
            disabled={isBoardSnapshotSaving || !boardSnapshotName.trim()}
            onClick={() => void saveNamedBoardSnapshot()}
            type="button"
          >
            {isBoardSnapshotSaving ? <AppIcon icon={IconLoading} className="spin" size="sm" /> : <AppIcon icon={IconSave} size="sm" />}
            保存
          </button>
        </div>
        {boardSnapshotError ? <p className="muted version-error">{boardSnapshotError}</p> : null}
        <div className="version-list">
          {boardSnapshots.map((snapshot) => (
            <article className="version-item" key={snapshot.id}>
              <div>
                <strong>{snapshot.name || `自动版本 ${snapshot.version}`}</strong>
                <span>{snapshot.kind === "manual" ? "命名版本" : "自动保存"} · v{snapshot.version}</span>
                <small>{formatDateTime(snapshot.createdAt)}</small>
              </div>
              <div className="version-item-actions">
                <button
                  disabled={activeBoardSnapshotId === snapshot.id}
                  onClick={() => void restoreBoardSnapshot(snapshot)}
                  type="button"
                >
                  恢复
                </button>
                <button
                  disabled={activeBoardSnapshotId === snapshot.id}
                  onClick={() => void duplicateBoardSnapshot(snapshot)}
                  type="button"
                >
                  另存
                </button>
              </div>
            </article>
          ))}
          {boardSnapshots.length === 0 && !isBoardSnapshotLoading ? <p className="muted">还没有历史版本</p> : null}
          {isBoardSnapshotLoading ? <p className="muted">正在载入版本...</p> : null}
        </div>
      </section>
    );
  }

  function renderTopbarAction(
    label: string,
    icon: typeof IconSave,
    onClick: () => void | Promise<unknown>,
    options: { disabled?: boolean; loading?: boolean; primary?: boolean } = {},
  ) {
    return (
      <button
        className={options.primary ? "topbar-action is-primary" : "topbar-action"}
        disabled={options.disabled}
        onClick={onClick}
        title={label}
        type="button"
      >
        <AppIcon icon={options.loading ? IconLoading : icon} className={options.loading ? "spin" : undefined} size="md" />
        <span>{label}</span>
      </button>
    );
  }

  function renderToolButton(input: {
    label: string;
    icon: typeof Selection;
    onClick: () => void;
    disabled?: boolean;
    pressed?: boolean;
    tone?: "danger" | "standard";
  }) {
    const ToolIcon = input.icon;
    return (
      <button
        aria-label={input.label}
        aria-pressed={input.pressed}
        className={[
          "creator-tool-button",
          input.disabled ? "is-disabled" : "",
          input.tone === "danger" ? "is-danger" : "",
        ].join(" ")}
        disabled={input.disabled}
        onClick={input.onClick}
        title={input.label}
        type="button"
      >
        <ToolIcon aria-hidden="true" size={20} weight={input.pressed ? "fill" : "regular"} />
        <span>{input.label}</span>
      </button>
    );
  }

  function renderAssetFilmstrip() {
    const filmstripAssets = visibleImageAssets.slice(0, 12);
    return (
      <aside aria-label="素材胶片" className="asset-filmstrip">
        <header>
          <div>
            <span className="eyebrow">Filmstrip</span>
            <strong>素材胶片</strong>
          </div>
          <button onClick={() => setDesktopView("assets")} type="button">
            查看素材
          </button>
        </header>
        <div className="filmstrip-track">
          {filmstripAssets.map((asset) => {
            const isSource = asset.id === sourceAsset?.id;
            const isReference = referenceAssetIds.includes(asset.id);
            const isActive = isSource || isReference;
            const kindLabel = assetKindLabels[asset.kind] ?? asset.kind;
            const primaryBadge = isSource ? "源图" : isReference ? "参考" : asset.isFavorite ? "收藏" : kindLabel;
            return (
              <button
                aria-label={`预览${kindLabel}素材`}
                aria-pressed={isActive}
                className={[
                  "filmstrip-item",
                  isSource ? "is-source" : "",
                  isReference ? "is-reference" : "",
                  asset.isFavorite ? "is-favorite" : "",
                ].join(" ")}
                key={`filmstrip-${asset.id}`}
                onClick={() => openAssetPreview(asset)}
                type="button"
              >
                <span className="filmstrip-thumb-frame">
                  <img alt="" src={apiUrl(asset.publicUrl)} />
                  <em className="filmstrip-primary-badge">{primaryBadge}</em>
                </span>
                <span>{asset.width && asset.height ? `${asset.width}×${asset.height}` : kindLabel}</span>
                <em className="filmstrip-more-label">更多</em>
              </button>
            );
          })}
          {filmstripAssets.length === 0 ? <p className="muted">上传或生成图片后会出现在这里</p> : null}
        </div>
      </aside>
    );
  }

  function renderWorkspaceOverlays() {
    return (
      <>
        {isBoardDrawerOpen ? (
          <BoardManagementDrawer
            boards={boardActions.boards}
            currentBoardId={board.id}
            error={boardActions.error}
            isLoading={boardActions.isLoading}
            onClose={() => setIsBoardDrawerOpen(false)}
            onCreateBoard={boardActions.createBoard}
            onDeleteBoard={boardActions.deleteBoard}
            onDuplicateBoard={boardActions.duplicateBoard}
            onRefreshBoards={boardActions.refreshBoards}
            onRenameBoard={renameBoard}
            templates={boardTemplates}
          />
        ) : null}
        {isLayerPanelOpen ? (
          <LayerPanel
            collapsedGroupIds={collapsedLayerGroupIds}
            objects={pageObjects}
            onClose={() => setIsLayerPanelOpen(false)}
            onDelete={deleteCanvasObject}
            onGroupSelect={selectLayerGroup}
            onMove={moveLayer}
            onRename={renameLayer}
            onSelect={selectLayer}
            onToggleGroupCollapsed={toggleLayerGroupCollapsed}
            onToggleGroupHidden={toggleLayerGroupHidden}
            onToggleGroupLocked={toggleLayerGroupLocked}
            onToggleHidden={toggleLayerHidden}
            onToggleLocked={toggleLayerLocked}
            onUngroup={ungroupLayerObjects}
            selectedObjectIds={selectedObjectIds}
          />
        ) : null}
      </>
    );
  }

  function renderBoardCanvasShell(options: { mobile?: boolean } = {}) {
    const record = latestGenerationRecord;
    return (
      <section className={options.mobile ? "mobile-canvas-stage" : "canvas-area"} ref={canvasAreaRef}>
        <div className={options.mobile ? "mobile-canvas-meta" : "canvas-meta"}>
          <span>{currentPageName}</span>
          <span>{selectionInfo.selectedCount} 个选中 / {selectionInfo.pageShapeCount} 个对象</span>
          {shouldShowLatestGenerationRecord && record ? (
            <span>{record.modeLabel}：{record.status}</span>
          ) : null}
          <span>{currentStatusText}</span>
        </div>
        <KonvaBoardCanvas
          assets={board.assets}
          document={boardDocument}
          isMaskMode={currentToolId === "mask"}
          maskBrushSize={sourceAssetSize ? getMaskBrushSize(sourceAssetSize, maskBrushRatio) : 24}
          onChange={setDocumentAndSave}
          onMaskStrokeComplete={handleCanvasMaskStroke}
          onObjectContextMenu={handleCanvasObjectContextMenu}
          onSelectionChange={handleCanvasSelectionChange}
          onStageReady={() => undefined}
          onViewportChange={setViewport}
          selectedObjectIds={selectedObjectIds}
          sourceAssetId={sourceAssetId}
          viewport={viewport}
        />
        {renderCanvasContextMenu()}
        {renderSelectedObjectQuickToolbar()}
        {options.mobile ? renderMobileObjectToolbar() : renderCanvasToolbar()}
      </section>
    );
  }

  function renderSelectedObjectQuickToolbar() {
    if (!selectedImageObject || !selectedImageToolbarPosition || currentToolId === "mask") return null;
    return (
      <div
        aria-label="选中图片快捷操作"
        className="selected-object-quick-toolbar"
        style={{
          "--selected-toolbar-left": `${selectedImageToolbarPosition.left}px`,
          "--selected-toolbar-top": `${selectedImageToolbarPosition.top}px`,
        } as CSSProperties}
      >
        <span>{selectedCanvasAsset ? assetKindLabels[selectedCanvasAsset.kind] ?? "图片" : "图片"}</span>
        <button aria-label="设为源图" onClick={setSelectedImageAsSource} title="设为源图" type="button">
          <AppIcon icon={IconImage} size="sm" />
          源图
        </button>
        <button
          aria-label="设为参考图"
          onClick={() => {
            addReferenceAsset(selectedImageObject.assetId);
            setStatus("已将选中图片设为参考图");
          }}
          title="设为参考图"
          type="button"
        >
          <AppIcon icon={IconAddImage} size="sm" />
          参考
        </button>
        <button aria-label="生成变体" onClick={generateSelectedImageVariant} title="生成变体" type="button">
          <AppIcon icon={IconAiEdit} size="sm" />
          变体
        </button>
        <button aria-label="生成多角度" onClick={() => generateSelectedImageMultiAngle()} title="生成多角度" type="button">
          <AppIcon icon={IconAiEdit} size="sm" />
          多角度
        </button>
        <button aria-label="导出选中图片" onClick={exportSelectionAsPng} title="导出选中图片" type="button">
          <AppIcon icon={IconDownload} size="sm" />
        </button>
        <button aria-label="删除选中图片" className="is-danger" onClick={deleteSelectedObjects} title="删除选中图片" type="button">
          <AppIcon icon={IconDelete} size="sm" />
        </button>
      </div>
    );
  }

  function renderCanvasContextMenu() {
    if (!canvasContextMenu) return null;
    if (isMobileShell) return null;
    const isImageObject = pageObjects.some((item) => item.id === canvasContextMenu.objectId && item.type === "image");
    return (
      <div
        className="canvas-context-menu"
        style={{ left: canvasContextMenu.x, top: canvasContextMenu.y }}
        role="menu"
      >
        {isImageObject ? (
          <button onClick={() => void copyContextMenuImage()} type="button" role="menuitem">
            复制图片
          </button>
        ) : null}
        <button onClick={duplicateSelectedObjects} type="button" role="menuitem">
          复制副本
        </button>
        <button onClick={() => reorderSelectedObjects("front")} type="button" role="menuitem">
          置于顶层
        </button>
        <button onClick={() => reorderSelectedObjects("back")} type="button" role="menuitem">
          置于底层
        </button>
        {isImageObject ? (
          <button onClick={setSelectedImageAsSource} type="button" role="menuitem">
            设为源图
          </button>
        ) : null}
        {isImageObject ? (
          <button onClick={generateSelectedImageVariant} type="button" role="menuitem">
            生成变体
          </button>
        ) : null}
        {isImageObject ? (
          <>
            {multiAngleOptions.map((option) => (
              <button key={option.value} onClick={() => generateSelectedImageMultiAngle(option.value)} type="button" role="menuitem">
                多角度：{option.label}
              </button>
            ))}
          </>
        ) : null}
        <button onClick={exportSelectionAsPng} type="button" role="menuitem">
          导出 PNG
        </button>
        <button onClick={deleteSelectedObjects} type="button" role="menuitem">
          删除
        </button>
        <button onClick={() => setCanvasContextMenu(null)} type="button" role="menuitem">
          关闭
        </button>
      </div>
    );
  }

  function renderMobileObjectContextSheet() {
    if (!canvasContextMenu) return null;
    const isImageObject = pageObjects.some((item) => item.id === canvasContextMenu.objectId && item.type === "image");
    return (
      <div className="mobile-context-backdrop" role="presentation" onClick={() => setCanvasContextMenu(null)}>
        <div
          aria-label="对象快捷菜单"
          className="mobile-object-context-sheet"
          onClick={(event) => event.stopPropagation()}
          role="menu"
        >
          <header>
            <div>
              <strong>对象操作</strong>
              <span>{isImageObject ? "图片图层" : "画布图层"}</span>
            </div>
            <button aria-label="关闭对象菜单" onClick={() => setCanvasContextMenu(null)} type="button">
              <AppIcon icon={IconClose} size={18} />
            </button>
          </header>
          <div className="mobile-object-context-grid">
            <button onClick={duplicateSelectedObjects} type="button" role="menuitem">
              <AppIcon icon={IconCopy} size={18} />
              复制
            </button>
            <button onClick={() => reorderSelectedObjects("front")} type="button" role="menuitem">
              <AppIcon icon={IconBringToFront} size={18} />
              置顶
            </button>
            <button onClick={() => reorderSelectedObjects("back")} type="button" role="menuitem">
              <AppIcon icon={IconSendToBack} size={18} />
              置底
            </button>
            <button onClick={exportSelectionAsPng} type="button" role="menuitem">
              <AppIcon icon={IconDownload} size={18} />
              导出
            </button>
            {isImageObject ? (
              <>
                <button onClick={setSelectedImageAsSource} type="button" role="menuitem">
                  <AppIcon icon={IconImage} size={18} />
                  源图
                </button>
                <button onClick={setSelectedImageAsPrimaryReference} type="button" role="menuitem">
                  <AppIcon icon={IconAddImage} size={18} />
                  参考
                </button>
                <button onClick={generateSelectedImageVariant} type="button" role="menuitem">
                  <AppIcon icon={IconAiEdit} size={18} />
                  变体
                </button>
                {multiAngleOptions.map((option) => (
                  <button key={option.value} onClick={() => generateSelectedImageMultiAngle(option.value)} type="button" role="menuitem">
                    <AppIcon icon={IconAiEdit} size={18} />
                    多角度：{option.label}
                  </button>
                ))}
                <button
                  onClick={() => {
                    setSelectedImageAsSource();
                    setMobileView("edit");
                    setMobileSheetLevel("collapsed");
                    enterMobileMaskMode();
                    setCanvasContextMenu(null);
                  }}
                  type="button"
                  role="menuitem"
                >
                  <AppIcon icon={IconPaint} size={18} />
                  局部
                </button>
              </>
            ) : null}
            <button className="is-danger" onClick={deleteSelectedObjects} type="button" role="menuitem">
              <AppIcon icon={IconDelete} size={18} />
              删除
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderCanvasToolbar() {
    return (
      <div
        className="canvas-toolbar canvas-toolbar-bottom"
        aria-label="快捷操作"
        ref={toolbarRef}
        style={{
          "--toolbar-offset-x": `${toolbarOffset.x}px`,
          "--toolbar-offset-y": `${toolbarOffset.y}px`,
        } as CSSProperties}
      >
        <button
          className="canvas-toolbar-drag-handle"
          onPointerCancel={cancelToolbarDrag}
          onPointerDown={beginToolbarDrag}
          onPointerMove={updateToolbarDrag}
          onPointerUp={finishToolbarDrag}
          title="拖动工具条"
          type="button"
        >
          <AppIcon icon={IconDragHandle} size="lg" />
        </button>
        <span className="toolbar-divider"></span>
        <button disabled={!boardHistory.canUndo} onClick={undoBoardDocument} title="撤销" type="button">
          <AppIcon icon={IconUndo} size="lg" />
        </button>
        <button disabled={!boardHistory.canRedo} onClick={redoBoardDocument} title="重做" type="button">
          <AppIcon icon={IconRedo} size="lg" />
        </button>
        <span className="toolbar-divider"></span>
        <button aria-pressed={currentToolId === "select"} onClick={() => setCurrentToolId("select")} title="选择" type="button">
          <AppIcon icon={IconPointer} size="lg" />
        </button>
        <button aria-pressed={currentToolId === "mask"} onClick={() => setCurrentToolId("mask")} title="蒙版笔" type="button">
          <AppIcon icon={IconPaint} size="lg" />
        </button>
        <button onClick={selectAllCanvasObjects} title="全选" type="button">
          <AppIcon icon={IconGrid} size="lg" />
        </button>
        <button disabled={activeSelectedObjectIds.length === 0} onClick={() => setSelectedObjectIds([])} title="取消选择" type="button">
          <AppIcon icon={IconClose} size="lg" />
        </button>
        <button disabled={activeSelectedObjectIds.length === 0} onClick={deleteSelectedObjects} title="删除" type="button">
          <AppIcon icon={IconDelete} size="lg" />
        </button>
        <button disabled={activeSelectedObjectIds.length === 0} onClick={duplicateSelectedObjects} title="复制副本" type="button">
          <AppIcon icon={IconCopy} size="lg" />
        </button>
        <button disabled={!selectedImageObject} onClick={setSelectedImageAsSource} title="设为源图" type="button">
          源图
        </button>
        <button disabled={!selectedImageObject} onClick={generateSelectedImageVariant} title="生成变体" type="button">
          变体
        </button>
        <button disabled={!selectedImageObject} onClick={removeSelectedImageBackground} title="去背景" type="button">
          去背景
        </button>
        <button disabled={activeSelectedObjectIds.length === 0} onClick={exportSelectionAsPng} title="导出 PNG" type="button">
          <AppIcon icon={IconDownload} size="lg" />
        </button>
        <span className="toolbar-divider"></span>
        {renderCanvasMoreMenu()}
        <span className="toolbar-divider"></span>
        <label className="canvas-zoom-select">
          <select
            aria-label="缩放比例"
            onChange={(event) => setViewport((current) => ({ ...current, zoom: Number(event.target.value) }))}
            value={viewport.zoom}
          >
            <option value={0.5}>50%</option>
            <option value={1}>100%</option>
            <option value={1.5}>150%</option>
            <option value={2}>200%</option>
          </select>
        </label>
        <button onClick={() => setStatus("已切换全屏视图控制")} title="全屏" type="button">
          <AppIcon icon={IconFitCanvas} size="lg" />
        </button>
      </div>
    );
  }

  function renderCanvasMoreMenu() {
    return (
      <div className={isCanvasMoreMenuOpen ? "canvas-toolbar-more is-open" : "canvas-toolbar-more"}>
        <button
          aria-expanded={isCanvasMoreMenuOpen}
          aria-haspopup="menu"
          onClick={() => setIsCanvasMoreMenuOpen((current) => !current)}
          title="更多画板工具"
          type="button"
        >
          <AppIcon icon={IconAi} size="lg" />
        </button>
        {isCanvasMoreMenuOpen ? (
          <div className="canvas-toolbar-more-content workflow-menu" role="menu">
            <header className="toolbar-more-header">
              <strong>画板工具</strong>
              <button aria-label="关闭更多画板工具" onClick={() => setIsCanvasMoreMenuOpen(false)} type="button">
                <AppIcon icon={IconClose} size="md" />
              </button>
            </header>
            <section className="toolbar-more-section">
              <strong>图层</strong>
              <div className="toolbar-action-grid">
                <button disabled={activeSelectedObjectIds.length < 2} onClick={groupSelectedObjects} type="button">
                  <AppIcon icon={IconLayers} size="md" />
                  成组
                </button>
                <button disabled={activeSelectedObjectIds.length === 0} onClick={ungroupSelectedObjects} type="button">
                  解组
                </button>
              </div>
            </section>
            <section className="toolbar-more-section">
              <strong>对齐与层级</strong>
              <div className="toolbar-action-grid">
                {boardAlignmentActions.map((item) => (
                  <button
                    disabled={activeSelectedObjectIds.length < 2}
                    key={item.action}
                    onClick={() => alignSelectedObjects(item.action)}
                    type="button"
                  >
                    <AppIcon icon={item.icon} size="md" />
                    {item.title}
                  </button>
                ))}
                {boardDistributionActions.map((item) => (
                  <button
                    disabled={activeSelectedObjectIds.length < 3}
                    key={item.action}
                    onClick={() => distributeSelectedObjects(item.action)}
                    type="button"
                  >
                    <AppIcon icon={item.icon} size="md" />
                    {item.title}
                  </button>
                ))}
                {boardReorderActions.map((item) => (
                  <button
                    disabled={activeSelectedObjectIds.length === 0}
                    key={item.action}
                    onClick={() => reorderSelectedObjects(item.action)}
                    type="button"
                  >
                    <AppIcon icon={item.icon} size="md" />
                    {item.title}
                  </button>
                ))}
              </div>
            </section>
            <section className="toolbar-more-section">
              <strong>智能排版</strong>
              <div className="toolbar-action-grid">
                {boardAutoLayoutActions.map((item) => (
                  <button
                    disabled={activeSelectedObjectIds.length < (item.action === "beforeAfter" ? 2 : 1)}
                    key={item.action}
                    onClick={() => autoLayoutSelectedObjects(item.action)}
                    type="button"
                  >
                    <AppIcon icon={item.icon} size="md" />
                    {item.title}
                  </button>
                ))}
              </div>
            </section>
            <section className="toolbar-more-section">
              <strong>批量导出</strong>
              <div className="toolbar-action-grid">
                <button onClick={() => exportBatchAsPng("page")} type="button">
                  整页 PNG
                </button>
                <button disabled={activeSelectedObjectIds.length === 0} onClick={() => exportBatchAsPng("selection")} type="button">
                  选区 PNG
                </button>
                <button onClick={() => exportBatchAsPng("groups")} type="button">
                  分组 PNG
                </button>
              </div>
            </section>
            <section className="toolbar-more-section">
              <strong>固定工作流</strong>
              <div className="toolbar-action-grid">
                <button onClick={() => runFixedWorkflow("product")} type="button">
                  商品图流程
                </button>
                <button onClick={() => runFixedWorkflow("outfit")} type="button">
                  人物换装流程
                </button>
                <button onClick={() => runFixedWorkflow("logo")} type="button">
                  Logo 展示流程
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    );
  }

  function openMobileView(view: WorkspaceView) {
    setMobileView(view);
    setMobileSheetLevel(view === "canvas" ? "collapsed" : "half");
    if (view === "edit" && currentToolId !== "mask") setCurrentToolId("select");
  }

  function expandMobileSheet() {
    if (mobileView === "canvas") return;
    setMobileSheetLevel((level) => (level === "full" ? "half" : "full"));
  }

  function collapseMobileSheet() {
    setMobileSheetLevel("collapsed");
  }

  function closeMobileSheet() {
    setMobileView("canvas");
    setMobileSheetLevel("collapsed");
    if (currentToolId === "mask") setCurrentToolId("select");
  }

  function enterMobileMaskMode() {
    setCurrentToolId("mask");
    setMobileSheetLevel("collapsed");
    if (!mobileMaskColor) setMobileMaskColor(mobileMaskColorOptions[0]);
    setStatus("正在绘制局部重绘蒙版");
  }

  function finishMobileMaskMode() {
    setCurrentToolId("select");
    setMobileSheetLevel("half");
    setStatus(maskStrokes.length > 0 ? `已保留 ${maskStrokes.length} 条局部重绘蒙版` : "已退出蒙版绘制");
  }

  function renderMobileCanvasPreviewScrim() {
    if (mobileView === "canvas" || mobileSheetLevel === "collapsed") return null;
    return <div className="mobile-canvas-preview-scrim" aria-hidden="true" />;
  }

  function beginMobileSheetDrag(event: PointerEvent<HTMLButtonElement>) {
    mobileSheetDragRef.current = { level: mobileSheetLevel, startY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateMobileSheetDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = mobileSheetDragRef.current;
    if (!drag) return;
    const delta = event.clientY - drag.startY;
    if (delta < -56) setMobileSheetLevel("full");
    if (delta > 56) setMobileSheetLevel(drag.level === "full" ? "half" : "collapsed");
  }

  function finishMobileSheetDrag(event: PointerEvent<HTMLButtonElement>) {
    mobileSheetDragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function renderMobileObjectToolbar() {
    if (activeSelectedObjectIds.length === 0) return null;
    return (
      <div className="mobile-object-action-bar" aria-label="选中对象操作">
        <button onClick={duplicateSelectedObjects} type="button">
          <AppIcon icon={IconCopy} size={16} />
          复制
        </button>
        <button onClick={deleteSelectedObjects} type="button">
          <AppIcon icon={IconDelete} size={16} />
          删除
        </button>
        <button
          disabled={!selectedImageObject}
          onClick={() => {
            setSelectedImageAsSource();
            openMobileView("edit");
          }}
          type="button"
        >
          <AppIcon icon={IconImage} size={16} />
          源图
        </button>
        <button
          disabled={!selectedImageObject}
          onClick={() => selectedImageObject ? addReferenceAsset(selectedImageObject.assetId) : setStatus("请先选择图片对象")}
          type="button"
        >
          <AppIcon icon={IconStar} size={16} />
          参考
        </button>
        <button
          disabled={!selectedImageObject}
          onClick={() => {
            setSelectedImageAsSource();
            openMobileView("edit");
            enterMobileMaskMode();
          }}
          type="button"
        >
          <AppIcon icon={IconAiEdit} size={16} />
          局部重绘
        </button>
        <button
          disabled={!selectedImageObject}
          onClick={() => {
            openMobileView("edit");
            generateSelectedImageMultiAngle();
          }}
          type="button"
        >
          <AppIcon icon={IconAiEdit} size={16} />
          多角度
        </button>
      </div>
    );
  }

  function renderMobileTopbar() {
    return (
      <header className="mobile-board-topbar" aria-label="移动端画板顶部栏">
        <a aria-label="返回工作台" href="/" title="返回工作台">
          <AppIcon icon={IconBack} size={20} />
        </a>
        <div className="mobile-board-title">
          <strong>{board.name}</strong>
          <span>{isMobileSyncing ? "同步中" : status || "本地优先"}</span>
        </div>
        <div className="mobile-board-actions">
          <button aria-label="保存画板" onClick={saveCurrentBoard} title="保存" type="button">
            <AppIcon icon={IconSave} size={20} />
          </button>
          <button aria-label="更多菜单" onClick={() => openMobileView("more")} title="更多" type="button">
            <AppIcon icon={IconBoards} size={20} />
          </button>
        </div>
      </header>
    );
  }

  function renderMobileBottomBar() {
    const items: Array<{ icon: typeof IconPointer; label: string; view: WorkspaceView; onClick?: () => void }> = [
      {
        icon: IconPointer,
        label: "选择",
        onClick: () => {
          setCurrentToolId("select");
          openMobileView("canvas");
        },
        view: "canvas",
      },
      { icon: IconAssets, label: "素材", view: "assets" },
      { icon: IconAi, label: "生图", view: "generate" },
      { icon: IconPaint, label: "改图", view: "edit" },
      { icon: IconBoards, label: "分镜", view: "storyboard" },
      { icon: IconBoards, label: "更多", view: "more" },
    ];
    return (
      <nav className="mobile-creator-tabbar" aria-label="移动端创作工具栏">
        {items.map((item) => (
          <button
            aria-pressed={mobileView === item.view && mobileSheetLevel !== "collapsed"}
            key={item.label}
            onClick={item.onClick ?? (() => openMobileView(item.view))}
            type="button"
          >
            <AppIcon icon={item.icon} size={22} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    );
  }

  function renderMobileGenerationStatus() {
    if (!activeGeneration && !latestGenerationRecord && !generationNotice) return null;
    const label = activeGeneration
      ? activeGenerationText
      : generationNotice?.text ?? `${latestGenerationRecord?.modeLabel ?? "生成"}：${latestGenerationRecord?.status ?? "已记录"}`;
    return (
      <div className={latestGenerationHasError ? "mobile-generation-status has-error" : "mobile-generation-status"}>
        <button
          className="mobile-generation-status-main"
          onClick={() => openMobileView(activeGeneration?.modeLabel === "AI 改图" ? "edit" : "generate")}
          type="button"
        >
          <AppIcon
            icon={activeGeneration ? IconLoading : latestGenerationHasError ? IconAiEdit : IconAi}
            className={activeGeneration ? "spin" : undefined}
            size={18}
          />
          <strong>{activeGeneration ? "处理中" : latestGenerationHasError ? "需要处理" : latestGenerationRecord ? "最近结果" : "生成状态"}</strong>
          <span>{label}</span>
        </button>
        {!activeGeneration && latestGenerationHasResults ? (
          <button className="mobile-generation-status-action" onClick={revealMobileResultFilmstrip} type="button">
            结果
          </button>
        ) : null}
        {!activeGeneration && latestGenerationHasError && latestGenerationJob ? (
          <button className="mobile-generation-status-action" onClick={retryLatestGeneration} type="button">
            重试
          </button>
        ) : null}
      </div>
    );
  }

  function renderMobileResultFilmstrip() {
    if (!shouldShowMobileResultFilmstrip) return null;
    const resultAssets = latestGenerationResults.slice(0, 8);
    return (
      <aside className="mobile-result-filmstrip" aria-label="最近生成结果">
        <header>
          <div>
            <strong>最近结果</strong>
            <span>{latestGenerationRecord?.modeLabel ?? "生成"} · {latestGenerationResults.length} 张</span>
          </div>
          <div className="mobile-result-header-actions">
            <button onClick={openLatestGenerationResults} type="button">挑选</button>
            <button aria-label="收起最近结果" onClick={() => setIsMobileResultStripDismissed(true)} type="button">
              收起
            </button>
          </div>
        </header>
        <div className="mobile-result-track">
          {resultAssets.map((asset) => (
            <article className="mobile-result-card" key={`mobile-result-${asset.id}`}>
              <button aria-label="预览最近生成结果" onClick={() => openAssetPreview(asset)} type="button">
                <img alt="" src={apiUrl(asset.publicUrl)} />
              </button>
              <div>
                <button onClick={() => insertMobileAsset(asset)} type="button">插入</button>
                <button onClick={() => setAssetAsSource(asset.id)} type="button">源图</button>
                <button onClick={() => setAssetAsPrimaryReference(asset.id)} type="button">参考</button>
              </div>
            </article>
          ))}
        </div>
      </aside>
    );
  }

  function renderMobileSheet() {
    if (mobileView === "canvas") return null;
    const title = mobileWorkspaceViewLabels[mobileView];
    return (
      <section className={`mobile-creator-sheet sheet-${mobileSheetLevel}`} aria-label={title}>
        <button
          aria-label="拖拽调整面板高度"
          className="mobile-sheet-grabber"
          onClick={expandMobileSheet}
          onPointerCancel={finishMobileSheetDrag}
          onPointerDown={beginMobileSheetDrag}
          onPointerMove={updateMobileSheetDrag}
          onPointerUp={finishMobileSheetDrag}
          type="button"
        >
          <span />
        </button>
        <header className="mobile-sheet-header">
          <div>
            <strong>{title}</strong>
            <span>{mobileSheetLevel === "collapsed" ? "已收起，输入内容保留" : activeGenerationText || "画布保持可预览"}</span>
          </div>
          <div>
            <button aria-label="收起面板" onClick={collapseMobileSheet} type="button">
              <AppIcon icon={IconMinus} size={18} />
            </button>
            <button aria-label="关闭面板" onClick={closeMobileSheet} type="button">
              <AppIcon icon={IconClose} size={18} />
            </button>
          </div>
        </header>
        {mobileSheetLevel === "collapsed" ? (
          <div className="mobile-sheet-collapsed">
            <AppIcon icon={getMobileSheetIcon(mobileView)} size={18} />
            {renderMobileGenerationStatus() ?? <span>{title} 面板已收起，输入内容已保留</span>}
          </div>
        ) : (
          <div className="mobile-sheet-content">
            {mobileView === "generate" ? renderMobileGenerateSheet() : null}
            {mobileView === "edit" ? renderMobileEditSheet() : null}
            {mobileView === "storyboard" ? renderMobileStoryboardSheet() : null}
            {mobileView === "assets" ? renderMobileAssetsSheet() : null}
            {mobileView === "more" ? renderMobileMoreSheet() : null}
          </div>
        )}
      </section>
    );
  }

  function getMobileSheetIcon(view: WorkspaceView) {
    if (view === "generate") return IconAi;
    if (view === "edit") return IconAiEdit;
    if (view === "storyboard") return IconBoards;
    if (view === "assets") return IconAssets;
    return IconBoards;
  }

  function renderMobileGenerateSheet() {
    return (
      <div className="mobile-sheet-stack ai-generate-section">
        <label className="mobile-field-block" htmlFor="mobile-generate-prompt">
          <span>提示词</span>
          <span className="prompt-input-shell">
            <textarea
              id="mobile-generate-prompt"
              maxLength={MAX_PROMPT_LENGTH}
              onChange={(event) => updateSourcePromptDraft(event.target.value)}
              placeholder="描述要生成的图片"
              value={sourcePrompt}
            />
            <button
              aria-label="清空生图提示词"
              className="prompt-clear-button"
              disabled={!sourcePrompt.trim()}
              onClick={clearSourcePromptDraft}
              title="清空"
              type="button"
            >
              <AppIcon icon={IconClose} size="sm" />
            </button>
          </span>
        </label>
        {renderPromptAssistControls("mobile-generate")}
        <div className="mobile-sheet-section">
          <strong>主要参数</strong>
          {renderAspectRatioControls()}
          {renderQualityControls()}
          {renderCreativeCountControls()}
          {mobileSheetLevel === "full" ? renderArtStyleControls() : null}
        </div>
        <div className="mobile-reference-filmstrip">
          <div className="section-title"><span>参考图</span></div>
          {renderReferencePanel("参考图")}
        </div>
        {activeGeneration?.modeLabel === "AI 生图" ? (
          <p className="generation-result-hint info">{activeGenerationText}</p>
        ) : null}
        <button className="primary-generate mobile-primary-action" disabled={isGenerating || !sourcePrompt.trim()} onClick={generateSourceFromPrompt} type="button">
          {isGenerating ? <AppIcon icon={IconLoading} className="spin" size="md" /> : <AppIcon icon={IconAi} size="md" />}
          {generateButtonLabel}
        </button>
      </div>
    );
  }

  function renderMobileEditSheet() {
    return (
      <div className="mobile-sheet-stack">
        <section className="mobile-source-card">
          <div className="section-title">
            <span>源图</span>
            <span className="pill">{sourceAsset ? "已选源图" : "未选源图"}</span>
          </div>
          <div className="mobile-source-preview">
            {sourceAsset ? (
              <>
                <img alt="" src={apiUrl(sourceAsset.publicUrl)} style={{ transform: `scale(${mobileSourceZoom})` }} />
                <button
                  aria-label="移除当前源图"
                  className="image-clear-button"
                  onClick={clearSourceAsset}
                  type="button"
                >
                  <AppIcon icon={IconClose} size="sm" />
                </button>
              </>
            ) : (
              <label className="mobile-source-upload">
                <AppIcon icon={IconAddImage} size={20} />
                上传源图
                <span>或在画布选中图片后设为源图</span>
                <input
                  accept="image/*"
                  onChange={(event) => {
                    handleUpload(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                  type="file"
                />
              </label>
            )}
            {sourceAsset && sourceAssetSize ? (
              <svg
                className={canEditMobileMask ? "mobile-mask-layer is-drawing" : "mobile-mask-layer"}
                onPointerCancel={cancelMobileMaskStroke}
                onPointerDown={beginMobileMaskStroke}
                onPointerLeave={cancelMobileMaskStroke}
                onPointerMove={updateMobileMaskStroke}
                onPointerUp={finishMobileMaskStroke}
                preserveAspectRatio="xMidYMid meet"
                role="img"
                viewBox={`0 0 ${sourceAssetSize.width} ${sourceAssetSize.height}`}
              >
                {(maskState?.assetId === sourceAsset.id ? maskState.strokes : []).map((stroke, index) => (
                  <path
                    d={getStrokeSvgPath(stroke)}
                    fill="none"
                    key={`mask-${index}`}
                    stroke={activeMobileMaskColor}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeOpacity="0.82"
                    strokeWidth={getMaskBrushSize(sourceAssetSize, maskBrushRatio)}
                  />
                ))}
                {mobileDraftStroke.length > 0 ? (
                  <path
                    d={getStrokeSvgPath(mobileDraftStroke)}
                    fill="none"
                    stroke={activeMobileMaskColor}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeOpacity="0.82"
                    strokeWidth={getMaskBrushSize(sourceAssetSize, maskBrushRatio)}
                  />
                ) : null}
              </svg>
            ) : null}
          </div>
        </section>
        <label className="mobile-field-block" htmlFor="mobile-edit-prompt">
          <span>修改要求</span>
          <span className="prompt-input-shell">
            <textarea
              id="mobile-edit-prompt"
              maxLength={MAX_PROMPT_LENGTH}
              onChange={(event) => updateEditPromptDraft(event.target.value)}
              placeholder="输入修改要求"
              value={prompt}
            />
            <button
              aria-label="清空改图要求"
              className="prompt-clear-button"
              disabled={!prompt.trim()}
              onClick={clearEditPromptDraft}
              title="清空"
              type="button"
            >
              <AppIcon icon={IconClose} size="sm" />
            </button>
          </span>
        </label>
        <div className="edit-mode-segments" aria-label="改图模式">
          <button aria-pressed={!maskStrokes.length && currentToolId !== "mask"} onClick={() => setCurrentToolId("select")} type="button">整图</button>
          <button aria-pressed={currentToolId === "mask"} onClick={enterMobileMaskMode} type="button">局部</button>
          <button aria-pressed={false} onClick={generateSelectedImageVariant} type="button">变体</button>
          <button aria-pressed={false} onClick={() => generateSelectedImageMultiAngle()} type="button">多角度</button>
        </div>
        {sourceAsset ? (
          <div className="mobile-mask-tools">
            <label>
              <span>笔刷</span>
              <input
                max="0.12"
                min="0.01"
                onChange={(event) => setMaskBrushRatio(Number(event.target.value))}
                step="0.005"
                type="range"
                value={maskBrushRatio}
              />
            </label>
            <button disabled={maskStrokes.length === 0} onClick={undoMaskStroke} type="button">
              <AppIcon icon={IconUndo} size={16} />
              撤销
            </button>
            <button onClick={finishMobileMaskMode} type="button">
              完成
            </button>
          </div>
        ) : null}
        {mobileSheetLevel === "full" ? (
          <>
            <label className="select-field">
              保留主体
              <select onChange={(event) => setPreserveStrength(event.target.value as PreserveStrength)} value={preserveStrength}>
                {preserveStrengthOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {renderReferencePanel("参考图")}
            {renderAspectRatioControls()}
            {renderQualityControls()}
          </>
        ) : null}
        {activeGeneration?.modeLabel === "AI 改图" ? (
          <p className="generation-result-hint info">{activeGenerationText}</p>
        ) : null}
        <button className="primary-generate mobile-primary-action" disabled={primaryGenerateDisabled} onClick={runPrimaryAiEdit} type="button">
          {isGenerating ? <AppIcon icon={IconLoading} className="spin" size="md" /> : <AppIcon icon={IconAi} size="md" />}
          {editButtonLabel}
        </button>
      </div>
    );
  }

  function renderMobileStoryboardSheet() {
    return (
      <div className="mobile-storyboard-workbench">
        <StoryboardWorkspace
          boardId={board.id}
          imageAssets={imageAssets}
          initialStoryboard={storyboardProject}
          onFrameGenerationComplete={handleStoryboardFrameGenerationComplete}
          onStoryboardChange={setStoryboardProject}
          onFocusAssetOnBoard={focusAssetOnBoard}
          onPlaceAllShotsOnBoard={placeStoryboardShotsOnBoard}
          onPlaceShotOnBoard={(shot) => placeStoryboardShotsOnBoard([shot])}
          onPreviewAsset={openAssetPreview}
          selectedCanvasAsset={selectedCanvasAsset}
        />
      </div>
    );
  }

  function renderMobileAssetsSheet() {
    return (
      <div className="mobile-sheet-stack">
        <div className="mobile-assets-tabs" aria-label="素材与历史">
          <button aria-pressed={mobileAssetsTab === "current"} onClick={() => setMobileAssetsTab("current")} type="button">素材</button>
          <button aria-pressed={mobileAssetsTab === "history"} onClick={() => setMobileAssetsTab("history")} type="button">历史</button>
          <button aria-pressed={mobileAssetsTab === "versions"} onClick={() => setMobileAssetsTab("versions")} type="button">版本</button>
        </div>
        {mobileAssetsTab === "current" ? renderMobileAssetFilmstrip() : null}
        {mobileAssetsTab === "history" ? (
          <div className="history-list">
            {board.jobs.slice(0, 8).map((job) => renderGenerationHistoryItem(job, `mobile-${job.id}`))}
            {board.jobs.length === 0 ? <p className="muted">还没有生成记录</p> : null}
          </div>
        ) : null}
        {mobileAssetsTab === "versions" ? renderVersionHistoryPanel() : null}
      </div>
    );
  }

  function renderMobileAssetFilmstrip() {
    const filmstripAssets = visibleImageAssets.slice(0, mobileSheetLevel === "full" ? 30 : 14);
    return (
      <div className="mobile-asset-filmstrip">
        <div className="mobile-asset-track">
          {filmstripAssets.map((asset) => {
            const isActive = asset.id === sourceAsset?.id || referenceAssetIds.includes(asset.id);
            return (
              <article
                aria-label={`${assetKindLabels[asset.kind] ?? asset.kind}素材`}
                aria-selected={isActive}
                className="mobile-asset-chip"
                key={`mobile-asset-${asset.id}`}
              >
                <button aria-label="预览素材" className="mobile-asset-preview-button" onClick={() => openAssetPreview(asset)} type="button">
                  <img alt="" src={apiUrl(asset.publicUrl)} />
                </button>
                <span>{assetKindLabels[asset.kind] ?? asset.kind}</span>
                <div className="mobile-asset-chip-actions">
                  <button onClick={() => insertMobileAsset(asset)} type="button">插入</button>
                  <button onClick={() => setAssetAsSource(asset.id)} type="button">源图</button>
                  <button onClick={() => setAssetAsPrimaryReference(asset.id)} type="button">参考</button>
                </div>
              </article>
            );
          })}
          {filmstripAssets.length === 0 ? <p className="muted">生成或上传图片后会出现在这里</p> : null}
        </div>
        {mobileSheetLevel === "full" ? renderAssetList() : null}
      </div>
    );
  }

  function renderMobileMoreSheet() {
    return (
      <div className="mobile-more-grid">
        <button onClick={openLayerPanel} type="button">
          <AppIcon icon={IconLayers} size={20} />
          图层
        </button>
        <button onClick={openBoardDrawer} type="button">
          <AppIcon icon={IconBoards} size={20} />
          画板
        </button>
        <button onClick={syncCurrentBoard} type="button">
          <AppIcon icon={isMobileSyncing ? IconLoading : IconRefresh} className={isMobileSyncing ? "spin" : undefined} size={20} />
          同步
        </button>
        <button onClick={() => exportBatchAsPng("page")} type="button">
          <AppIcon icon={IconDownload} size={20} />
          导出
        </button>
        <button onClick={() => setIsCanvasMoreMenuOpen(true)} type="button">
          <AppIcon icon={IconGrid} size={20} />
          对齐排版
        </button>
        <button onClick={signOut} type="button">
          <AppIcon icon={IconBack} size={20} />
          退出
        </button>
      </div>
    );
  }

  function renderSharedWorkspaceDialogs() {
    return (
      <>
        {assetPreviewAsset ? (
          <div className="asset-preview-modal" role="dialog" aria-modal="true">
            <div className="asset-preview-backdrop" onClick={() => setAssetPreviewAsset(null)} />
            <div className="asset-preview-content">
              <header>
                <div className="asset-preview-title">
                  <strong>{assetKindLabels[assetPreviewAsset.kind] ?? assetPreviewAsset.kind}</strong>
                  <span>{assetPreviewAsset.width && assetPreviewAsset.height ? `${assetPreviewAsset.width}×${assetPreviewAsset.height}` : "图片素材"}</span>
                </div>
                <div className="asset-preview-toolbar">
                  <div className="asset-preview-tool-group asset-preview-primary-group">
                    <button onClick={() => void insertAsset(assetPreviewAsset)} type="button">载入</button>
                    <button
                      aria-pressed={assetPreviewAsset.id === sourceAsset?.id}
                      onClick={() => setAssetAsSource(assetPreviewAsset.id)}
                      type="button"
                    >
                      源图
                    </button>
                    <button
                      aria-pressed={referenceAssetIds.includes(assetPreviewAsset.id)}
                      onClick={() => setAssetAsPrimaryReference(assetPreviewAsset.id)}
                      type="button"
                    >
                      {referenceAssetIds.includes(assetPreviewAsset.id) ? "已参" : "参考"}
                    </button>
                    <button
                      aria-pressed={assetPreviewAsset.isFavorite}
                      onClick={() => toggleAssetFavorite(assetPreviewAsset)}
                      type="button"
                    >
                      <AppIcon icon={IconStar} size="md" />
                      {assetPreviewAsset.isFavorite ? "已藏" : "收藏"}
                    </button>
                  </div>
                  <div className="asset-preview-tool-group asset-preview-secondary-group">
                    <button onClick={() => editAssetTags(assetPreviewAsset)} type="button">
                      <AppIcon icon={IconRename} size="md" />
                      标签
                    </button>
                    <button onClick={() => downloadAsset(assetPreviewAsset)} type="button">
                      <AppIcon icon={IconDownload} size="md" />
                      下载
                    </button>
                    <button
                      disabled={reversePromptLoadingAssetId === assetPreviewAsset.id}
                      onClick={() => void openReferencePrompt(assetPreviewAsset)}
                      type="button"
                    >
                      {reversePromptByAssetId[assetPreviewAsset.id] ? "提示词" : "反推"}
                    </button>
                    <button
                      disabled={reversePromptLoadingAssetId === assetPreviewAsset.id}
                      onClick={() => void rerunReversePrompt(assetPreviewAsset)}
                      type="button"
                    >
                      再推
                    </button>
                    <button
                      disabled={!reversePromptByAssetId[assetPreviewAsset.id]}
                      onClick={() => void saveReversePromptToSource(assetPreviewAsset)}
                      type="button"
                    >
                      保存
                    </button>
                    <button
                      disabled={!reversePromptByAssetId[assetPreviewAsset.id]}
                      onClick={() => appendReversePromptToEdit(assetPreviewAsset)}
                      type="button"
                    >
                      约束
                    </button>
                  </div>
                  <div className="asset-preview-tool-group asset-preview-zoom-group">
                    <button aria-label="缩小预览" onClick={() => setAssetPreviewZoom((zoom) => Math.max(0.25, zoom - 0.25))} type="button">
                      <AppIcon icon={IconMinus} size="md" />
                    </button>
                    <span>{Math.round(assetPreviewZoom * 100)}%</span>
                    <button aria-label="放大预览" onClick={() => setAssetPreviewZoom((zoom) => Math.min(4, zoom + 0.25))} type="button">
                      <AppIcon icon={IconPlus} size="md" />
                    </button>
                  </div>
                  <div className="asset-preview-tool-group asset-preview-danger-group">
                    <button
                      aria-label="删除素材"
                      className="asset-delete-button"
                      onClick={() => {
                        void deleteAsset(assetPreviewAsset);
                        setAssetPreviewAsset(null);
                      }}
                      type="button"
                    >
                      <AppIcon icon={IconDelete} size="md" />
                      删除
                    </button>
                  </div>
                </div>
                <button
                  aria-label="关闭"
                  className="asset-preview-close-button"
                  onClick={() => setAssetPreviewAsset(null)}
                  type="button"
                >
                  <AppIcon icon={IconClose} size="md" />
                </button>
              </header>
              <div className="asset-preview-workbench">
                <div className="asset-preview-image">
                  <img alt="" src={apiUrl(assetPreviewAsset.publicUrl)} style={{ transform: `scale(${assetPreviewZoom})` }} />
                </div>
                <aside className="asset-preview-inspector" aria-label="素材属性">
                  <section>
                    <span>文件信息</span>
                    <dl>
                      <div>
                        <dt>尺寸</dt>
                        <dd>{assetPreviewAsset.width && assetPreviewAsset.height ? `${assetPreviewAsset.width}×${assetPreviewAsset.height}` : "未记录"}</dd>
                      </div>
                      <div>
                        <dt>来源</dt>
                        <dd>{assetKindLabels[assetPreviewAsset.kind] ?? assetPreviewAsset.kind}</dd>
                      </div>
                      <div>
                        <dt>时间</dt>
                        <dd>{formatDateTime(assetPreviewAsset.createdAt)}</dd>
                      </div>
                    </dl>
                  </section>
                  <section>
                    <span>工作流状态</span>
                    <div className="asset-preview-status-grid">
                      <em>{assetPreviewAsset.id === sourceAsset?.id ? "当前源图" : "未设源图"}</em>
                      <em>{referenceAssetIds.includes(assetPreviewAsset.id) ? "参考图" : "非参考"}</em>
                      <em>{assetPreviewAsset.isFavorite ? "已收藏" : "未收藏"}</em>
                    </div>
                  </section>
                  <section>
                    <span>标签</span>
                    <p>{getAssetTags(assetPreviewAsset).join(" · ") || "尚未添加标签"}</p>
                  </section>
                  <section>
                    <span>提示词</span>
                    <p>{reversePromptByAssetId[assetPreviewAsset.id] || getGenerationJobForAsset(board.jobs, assetPreviewAsset.id)?.prompt || "尚未反推提示词"}</p>
                  </section>
                </aside>
              </div>
            </div>
          </div>
        ) : null}

        {reversePromptAsset ? (
          <div className="asset-preview-modal" role="dialog" aria-modal="true">
            <div className="asset-preview-backdrop" onClick={() => setReversePromptAsset(null)} />
            <div className="asset-preview-content reverse-prompt-dialog">
              <header>
                <strong>参考图提示词</strong>
                <button aria-label="关闭" onClick={() => setReversePromptAsset(null)} type="button"><AppIcon icon={IconClose} size="md" /></button>
              </header>
              <label className="select-field">
                反推模型
                <select
                  disabled={reversePromptLoadingAssetId === reversePromptAsset.id}
                  onChange={(event) => setSelectedReversePromptModel(event.target.value)}
                  value={selectedReversePromptModel}
                >
                  {reversePromptModelOptions.map((model) => (
                    <option key={getProviderModelOptionValue(model)} value={getProviderModelOptionValue(model)}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </label>
              <textarea
                readOnly
                value={
                  reversePromptLoadingAssetId === reversePromptAsset.id
                    ? "正在反推提示词..."
                    : reversePromptErrorByAssetId[reversePromptAsset.id] ??
                      reversePromptByAssetId[reversePromptAsset.id] ??
                      ""
                }
              />
              <div className="reverse-prompt-actions">
                <button disabled={!reversePromptByAssetId[reversePromptAsset.id]} onClick={copyReversePrompt} type="button">
                  {reversePromptCopied ? "已复制" : "复制提示词"}
                </button>
                <button
                  disabled={reversePromptLoadingAssetId === reversePromptAsset.id}
                  onClick={() => void rerunReversePrompt(reversePromptAsset)}
                  type="button"
                >
                  再次反推
                </button>
                <button
                  disabled={!reversePromptByAssetId[reversePromptAsset.id]}
                  onClick={() => void saveReversePromptToSource(reversePromptAsset)}
                  type="button"
                >
                  替换生图
                </button>
                <button
                  disabled={!reversePromptByAssetId[reversePromptAsset.id]}
                  onClick={() => appendReversePromptToSource(reversePromptAsset)}
                  type="button"
                >
                  追加生图
                </button>
                <button
                  disabled={!reversePromptByAssetId[reversePromptAsset.id]}
                  onClick={() => appendReversePromptToEdit(reversePromptAsset)}
                  type="button"
                >
                  作为改图约束
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {promptAssistResult && isPromptAssistDialogOpen ? (
          <div className="asset-preview-modal" role="dialog" aria-modal="true">
            <div className="asset-preview-backdrop" onClick={() => setIsPromptAssistDialogOpen(false)} />
            <div className="asset-preview-content prompt-assist-dialog">
              <header>
                <div>
                  <strong>{promptAssistSource === "safety" ? "提示词安全优化器" : promptAssistEngine === "skill2" ? "辅助提示词2" : "辅助提示词"}</strong>
                  <span>选择一条应用到 AI 生图提示词</span>
                </div>
                <button aria-label="关闭" onClick={() => setIsPromptAssistDialogOpen(false)} type="button">
                  <AppIcon icon={IconClose} size="md" />
                </button>
              </header>
              <div className="prompt-assist-dialog-body">
                {getStringArray([promptAssistResult.prompt, ...promptAssistResult.variations]).map((suggestion, index) => (
                  <article className="prompt-assist-result" key={`prompt-assist-dialog-${index}`}>
                    <p>{suggestion}</p>
                    <div className="button-row">
                      <button onClick={() => applyPromptAssistPrompt(suggestion)} type="button">
                        应用
                      </button>
                      <button onClick={() => void copyPromptAssistPrompt(suggestion)} type="button">
                        复制
                      </button>
                    </div>
                  </article>
                ))}
                {promptAssistResult.notes.length ? (
                  <ul className="prompt-assist-notes">
                    {promptAssistResult.notes.map((note, index) => (
                      <li key={`prompt-assist-dialog-note-${index}`}>{note}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="prompt-assist-dialog-actions">
                <button
                  disabled={isPromptAssistLoading || !sourcePrompt.trim()}
                  onClick={() => void (promptAssistSource === "safety" ? runPromptSafetyOptimizer("strict") : runPromptAssist(promptAssistEngine))}
                  type="button"
                >
                  {isPromptAssistLoading ? <AppIcon icon={IconLoading} className="spin" size="md" /> : <AppIcon icon={IconAi} size="md" />}
                  {promptAssistSource === "safety" ? "严格优化" : "再生成"}
                </button>
                <button onClick={() => setIsPromptAssistDialogOpen(false)} type="button">
                  关闭
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {resultPickerJob && resultPickerSummary ? (
          <div className="asset-preview-modal result-picker-modal" role="dialog" aria-modal="true">
            <div className="asset-preview-backdrop" onClick={() => setResultPickerJobId("")} />
            <div className="asset-preview-content result-picker-content">
              <header>
                <div>
                  <strong>结果挑选</strong>
                  <span>{resultPickerSummary.modeLabel} · {resultPickerSummary.candidateCount} 张候选</span>
                </div>
                <button aria-label="关闭" onClick={() => setResultPickerJobId("")} type="button">
                  <AppIcon icon={IconClose} size="md" />
                </button>
              </header>
              <div className="result-picker-grid">
                {resultPickerJob.results.map(({ asset }, index) => (
                  <article className="result-picker-card" key={asset.id}>
                    <button className="result-picker-preview" onClick={() => openAssetPreview(asset)} type="button">
                      <img alt="" src={apiUrl(asset.publicUrl)} />
                      <span>候选 {index + 1}</span>
                    </button>
                    <div className="result-picker-card-actions">
                      <button className="result-picker-primary-action" onClick={() => void insertAsset(asset)} type="button">载入</button>
                      <button onClick={() => setAssetAsSource(asset.id)} type="button">设为源图</button>
                      <button onClick={() => setAssetAsPrimaryReference(asset.id)} type="button">设为参考</button>
                      {resultPickerSummary.canCompareWithSource ? (
                        <button onClick={() => setResultPickerComparisonAssetId(asset.id)} type="button">对比</button>
                      ) : null}
                      <button aria-label={asset.isFavorite ? "取消收藏" : "收藏"} aria-pressed={asset.isFavorite} onClick={() => toggleAssetFavorite(asset)} type="button">
                        <AppIcon icon={IconStar} size="sm" />
                      </button>
                      <button aria-label="删除候选图" className="asset-delete-button" onClick={() => void deleteAsset(asset)} type="button">
                        <AppIcon icon={IconDelete} size="sm" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {resultPickerComparisonAssetId ? (
                (() => {
                  const resultAsset = resultPickerJob.results.find((result) => result.asset.id === resultPickerComparisonAssetId)?.asset;
                  const pair = resultAsset ? getResultPickerComparisonPair(resultPickerJob, resultAsset, imageAssets) : null;
                  return pair ? (
                    <div className="result-picker-compare">
                      <figure>
                        <img alt="" src={apiUrl(pair.sourceAsset.publicUrl)} />
                        <figcaption>源图</figcaption>
                      </figure>
                      <figure>
                        <img alt="" src={apiUrl(pair.resultAsset.publicUrl)} />
                        <figcaption>结果</figcaption>
                      </figure>
                    </div>
                  ) : null;
                })()
              ) : null}
            </div>
          </div>
        ) : null}
      </>
    );
  }

  if (isMobileShell) {
    return (
      <BoardWorkspaceMobile view={mobileView} sheetLevel={mobileSheetLevel}>
        {renderWorkspaceOverlays()}
        {renderMobileTopbar()}
        {renderMobileGenerationStatus()}
        {renderBoardCanvasShell({ mobile: true })}
        {renderMobileCanvasPreviewScrim()}
        {renderMobileObjectContextSheet()}
        {renderMobileResultFilmstrip()}
        {currentToolId === "mask" && sourceAsset ? (
          <div className="mobile-mask-floating-bar" aria-label="蒙版绘制工具">
            <div className="mobile-mask-floating-status">
              <strong>局部蒙版</strong>
              <span>{maskStrokes.length > 0 ? `${maskStrokes.length} 笔已标记` : "在图上涂抹要改的区域"}</span>
            </div>
            <label className="mobile-mask-floating-slider">
              <span>笔刷</span>
              <input
                aria-label="蒙版笔刷大小"
                max="0.12"
                min="0.01"
                onChange={(event) => setMaskBrushRatio(Number(event.target.value))}
                step="0.005"
                type="range"
                value={maskBrushRatio}
              />
            </label>
            <div className="mobile-mask-floating-actions">
              <button aria-pressed={Boolean(mobileMaskColor)} onClick={() => setMobileMaskColor(mobileMaskColor || mobileMaskColorOptions[0])} type="button">
                <AppIcon icon={IconPaint} size={16} />
                画笔
              </button>
              <button disabled={maskStrokes.length === 0} onClick={undoMaskStroke} type="button">
                <AppIcon icon={IconUndo} size={16} />
                橡皮
              </button>
              <button disabled={mobileMaskRedoStrokes.length === 0} onClick={redoMaskStroke} type="button">
                <AppIcon icon={IconRedo} size={16} />
                恢复
              </button>
              <button disabled={maskStrokes.length === 0} onClick={resetMaskStrokes} type="button">
                <AppIcon icon={IconDelete} size={16} />
                清空
              </button>
              <button onClick={finishMobileMaskMode} type="button">完成</button>
            </div>
          </div>
        ) : null}
        {renderMobileBottomBar()}
        {renderMobileSheet()}
        {renderSharedWorkspaceDialogs()}
      </BoardWorkspaceMobile>
    );
  }

  return (
    <BoardWorkspaceDesktop view={mobileView}>
      <header className="board-window-titlebar" aria-label="应用标题栏">
        <div className="board-titlebar-brand">
          <BoardGlobalMenu
            boardId={board.id}
            boardName={board.name}
            isAdmin={isAdmin}
            isOpen={isGlobalMenuOpen}
            onOpenAdmin={openAdmin}
            onOpenBoardManagement={openBoardDrawer}
            onOpenLayers={openLayerPanel}
            onOpenMenu={toggleGlobalMenu}
            onRenameBoard={renameBoard}
            onSignOut={signOut}
          />
          <div className="brand-lockup" aria-label="AI Board">
            <span className="brand-mark">AB</span>
            <strong>AI Board</strong>
          </div>
          <div className="board-title-summary">
            <span>{board.name}</span>
            <em>
              {currentStatusText || "本地优先画板"}
            </em>
          </div>
        </div>
        <div className="board-topbar-actions" aria-label="画板操作">
          {renderTopbarAction("保存", IconSave, saveCurrentBoard, { primary: true })}
          {renderTopbarAction("同步", IconRefresh, syncCurrentBoard, {
            disabled: isMobileSyncing,
            loading: isMobileSyncing,
          })}
          {renderTopbarAction("导出", IconDownload, () => exportBatchAsPng("page"))}
          <a className="canvas-home-link topbar-account-link" href="/reverse-prompt" title="打开反推提示词">
            <AppIcon icon={IconAiEdit} size="md" />
            反推
          </a>
          {renderTopbarAction("图层", IconLayers, openLayerPanel)}
          {renderTopbarAction("画板", IconBoards, openBoardDrawer)}
          <a className="canvas-home-link topbar-account-link" href="/" title="返回工作台">
            <AppIcon icon={IconBack} size="md" />
            工作台
          </a>
        </div>
      </header>
      {isBoardDrawerOpen ? (
        <BoardManagementDrawer
          boards={boardActions.boards}
          currentBoardId={board.id}
          error={boardActions.error}
          isLoading={boardActions.isLoading}
          onClose={() => setIsBoardDrawerOpen(false)}
          onCreateBoard={boardActions.createBoard}
          onDeleteBoard={boardActions.deleteBoard}
          onDuplicateBoard={boardActions.duplicateBoard}
          onRefreshBoards={boardActions.refreshBoards}
          onRenameBoard={renameBoard}
          templates={boardTemplates}
        />
      ) : null}
      {isLayerPanelOpen ? (
        <LayerPanel
          collapsedGroupIds={collapsedLayerGroupIds}
          objects={pageObjects}
          onClose={() => setIsLayerPanelOpen(false)}
          onDelete={deleteCanvasObject}
          onGroupSelect={selectLayerGroup}
          onMove={moveLayer}
          onRename={renameLayer}
          onSelect={selectLayer}
          onToggleGroupCollapsed={toggleLayerGroupCollapsed}
          onToggleGroupHidden={toggleLayerGroupHidden}
          onToggleGroupLocked={toggleLayerGroupLocked}
          onToggleHidden={toggleLayerHidden}
          onToggleLocked={toggleLayerLocked}
          onUngroup={ungroupLayerObjects}
          selectedObjectIds={selectedObjectIds}
        />
      ) : null}

      <nav className="board-mode-rail desktop-mode-rail" aria-label="创作工具">
        {renderToolButton({
          icon: Selection,
          label: "选择",
          onClick: () => setCurrentToolId("select"),
          pressed: currentToolId === "select",
        })}
        <label className="creator-tool-button upload-tool-button" title="上传图片">
          <ImageSquare aria-hidden="true" size={20} weight="regular" />
          <span>上传</span>
          <input
            accept="image/*"
            onChange={(event) => {
              handleUpload(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
            suppressHydrationWarning
            type="file"
          />
        </label>
        {renderToolButton({
          icon: PaintBrush,
          label: "蒙版",
          onClick: () => {
            setCurrentToolId(currentToolId === "mask" ? "select" : "mask");
            setDesktopView("edit");
          },
          pressed: currentToolId === "mask",
        })}
        {renderToolButton({ icon: PhosphorSquare, label: "形状", onClick: insertShapeObject })}
        {renderToolButton({ icon: TextT, label: "文本", onClick: insertTextObject })}
        {renderToolButton({ icon: BoundingBox, label: "适应", onClick: () => setStatus("已切换全屏视图控制") })}
        {renderToolButton({ disabled: !boardHistory.canUndo, icon: ArrowBendUpLeft, label: "撤销", onClick: undoBoardDocument })}
        {renderToolButton({ disabled: !boardHistory.canRedo, icon: ArrowBendUpRight, label: "重做", onClick: redoBoardDocument })}
        {renderToolButton({ disabled: activeSelectedObjectIds.length === 0, icon: Trash, label: "删除", onClick: deleteSelectedObjects, tone: "danger" })}
        {renderToolButton({ disabled: activeSelectedObjectIds.length === 0, icon: DownloadSimple, label: "下载", onClick: exportSelectionAsPng })}
        {renderToolButton({ icon: Export, label: "导出", onClick: exportSelectionAsPng })}
      </nav>

      <aside className="control-panel desktop-panel">
        <header className="panel-header">
          <div>
            <span className="eyebrow">AI Board</span>
            <h1>{board.name}</h1>
          </div>
          <div className="panel-header-actions">
            <a className="canvas-home-link" href="/" title="返回工作台">
              <AppIcon icon={IconBack} size="md" />
              工作台
            </a>
            <button className="icon-button" disabled={isMobileSyncing} onClick={syncCurrentBoard} title="同步" type="button">
              {isMobileSyncing ? <AppIcon icon={IconLoading} className="spin" size="md" /> : <AppIcon icon={IconRefresh} size="md" />}
            </button>
          </div>
        </header>

        <nav className="desktop-workspace-tabs" aria-label="画板工具分页">
          {desktopWorkspaceViews.map((view) => (
            <button
              aria-pressed={desktopView === view}
              key={view}
              onClick={() => setDesktopView(view)}
              type="button"
            >
              {mobileWorkspaceViewLabels[view]}
            </button>
          ))}
        </nav>

        {desktopView === "generate" ? (
        <div className="desktop-panel-workflow creative-generate-workflow">
        <div className="desktop-view-panel-stack creative-generate-panel">
          <section className="panel-section desktop-view-panel ai-generate-section">
            <div className="section-title">
              <span>创作描述</span>
              <span className="prompt-help-icon">?</span>
            </div>
            <div className="prompt-input-shell">
              <textarea
                maxLength={MAX_PROMPT_LENGTH}
                onChange={(event) => updateSourcePromptDraft(event.target.value)}
                placeholder="描述你想要的画面内容、风格、细节等..."
                suppressHydrationWarning
                value={sourcePrompt}
              />
              <button
                aria-label="清空生图提示词"
                className="prompt-clear-button"
                disabled={!sourcePrompt.trim()}
                onClick={clearSourcePromptDraft}
                title="清空"
                type="button"
              >
                <AppIcon icon={IconClose} size="sm" />
              </button>
            </div>
            <div className="prompt-character-count">{sourcePrompt.length}/{MAX_PROMPT_LENGTH}</div>
            <div className="creative-field-group">
              <div className="creative-field-title">辅助提示词</div>
              {renderPromptAssistControls("desktop-generate")}
            </div>
            {renderImageModelSelect("desktop-generate-model")}
            {renderAspectRatioControls()}
            {renderQualityControls()}
            {renderCreativeCountControls()}
            {renderArtStyleControls()}
            {renderReferencePanel("参考图")}
            {renderGenerationChecklist(generationChecklistSummary, generationChecklistItems)}
            {generationNotice?.scope === "source" ? (
              <div className="desktop-inline-action-summary" aria-live="polite">
                <strong>{generationNotice.text}</strong>
                <span>{desktopGenerateActionMeta.join(" · ")}</span>
              </div>
            ) : null}
            {renderDesktopGenerateAdvancedSettings()}
          </section>
        </div>
          <div className="desktop-generate-footer" aria-live="polite">
            <button className="primary-generate" disabled={isGenerating || !sourcePrompt.trim()} onClick={generateSourceFromPrompt} type="button">
              {isGenerating ? <AppIcon icon={IconLoading} className="spin" size="lg" /> : <AppIcon icon={IconAi} size={20} />}
              {generateButtonLabel}
            </button>
          </div>
        </div>
        ) : null}

        {desktopView === "edit" ? (
        <div className="desktop-panel-workflow ai-edit-workbench-panel">
        <div className="desktop-view-panel-stack">
        {renderDesktopEditSourceSummary()}

        <section className="panel-section">
          <div className="section-title">
            <span>2. 改图设置</span>
            <span className="pill">{workflowStatus}</span>
          </div>
          <div className="desktop-edit-reference-flow">
            <div className="desktop-context-heading">
              <div className="desktop-context-title-stack">
                <span>参考图</span>
                <em>{referenceAssets.length > 0 ? `${referenceAssets.length} 张 · 全部可标记` : "用于角色、风格、构图约束"}</em>
              </div>
              <div className="desktop-context-heading-actions">
                <label className="upload-inline">
                  <AppIcon icon={IconPlus} size="md" />
                  添加
                  <input
                    accept="image/*"
                    multiple
                    onChange={(event) => {
                      handleReferenceUpload(event.target.files);
                      event.currentTarget.value = "";
                    }}
                    suppressHydrationWarning
                    type="file"
                  />
                </label>
                <button disabled={referenceAssets.length === 0} onClick={clearReferenceAssets} type="button">
                  清空
                </button>
              </div>
            </div>
            <div className="desktop-context-reference-grid">
              {renderGroupedReferenceList("desktop-edit-settings")}
            </div>
            {referenceAssets.find((item) => item.asset.id === openReferenceRoleAssetId)
              ? renderReferenceRolePanel(referenceAssets.find((item) => item.asset.id === openReferenceRoleAssetId)!)
              : null}
            <div className="reference-preset-row" aria-label="参考图预设">
              <button onClick={() => applyReferencePreset("outfit")} type="button">人物换装</button>
              <button onClick={() => applyReferencePreset("product")} type="button">商品替换</button>
              <button onClick={() => applyReferencePreset("logo")} type="button">Logo 融合</button>
              <button onClick={() => applyReferencePreset("scene")} type="button">场景重构</button>
            </div>
            {renderReferenceConflictControls()}
            <div className="desktop-context-reference-actions">
              <label className="select-field">
                参考匹配
                <select onChange={(event) => setReferenceFit(event.target.value as ReferenceFit)} value={referenceFit}>
                  {referenceFitOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          {renderGenerationChecklist(editChecklistSummary, editChecklistItems)}
          {generationNotice?.scope === "edit" ? (
            <div className="desktop-inline-action-summary" aria-live="polite">
              <strong>{generationNotice.text}</strong>
              <span>{desktopEditActionMeta.join(" · ")}</span>
            </div>
          ) : null}
          {renderImageModelSelect("desktop-edit-model")}
          <label className="field-label" htmlFor="desktop-edit-prompt">修改要求</label>
          <div className="prompt-input-shell">
            <textarea
              id="desktop-edit-prompt"
              maxLength={MAX_PROMPT_LENGTH}
              onChange={(event) => updateEditPromptDraft(event.target.value)}
              placeholder="例如：把人物手里的物品替换为参考图中的工具，保持人物、姿势、光照和背景不变"
              suppressHydrationWarning
              value={prompt}
            />
            <button
              aria-label="清空改图要求"
              className="prompt-clear-button"
              disabled={!prompt.trim()}
              onClick={clearEditPromptDraft}
              title="清空"
              type="button"
            >
              <AppIcon icon={IconClose} size="sm" />
            </button>
          </div>
          {renderDesktopEditModeControls()}
          <details className="advanced-edit-settings">
            <summary>高级输出设置</summary>
            {renderAspectRatioControls()}
            {renderQualityControls()}
            {renderCreativeCountControls()}
            {renderPromptRecipePanel("inpaint")}
          </details>
        </section>
        </div>
          <div className="desktop-generate-footer" aria-live="polite">
            <button className="primary-generate" disabled={primaryGenerateDisabled} onClick={runPrimaryAiEdit} type="button">
              {isGenerating ? <AppIcon icon={IconLoading} className="spin" size="md" /> : <AppIcon icon={IconAi} size="md" />}
              {editButtonLabel}
            </button>
          </div>
        </div>
        ) : null}

        {desktopView === "storyboard" ? (
        <div className="desktop-panel-workflow storyboard-panel-workflow">
        <div className="desktop-view-panel-stack">
          <StoryboardWorkspace
            boardId={board.id}
            imageAssets={imageAssets}
            initialStoryboard={storyboardProject}
            onFrameGenerationComplete={handleStoryboardFrameGenerationComplete}
            onStoryboardChange={setStoryboardProject}
            onFocusAssetOnBoard={focusAssetOnBoard}
            onPlaceAllShotsOnBoard={placeStoryboardShotsOnBoard}
            onPlaceShotOnBoard={(shot) => placeStoryboardShotsOnBoard([shot])}
            onPreviewAsset={openAssetPreview}
            selectedCanvasAsset={selectedCanvasAsset}
          />
        </div>
        </div>
        ) : null}

        {desktopView === "assets" ? (
        <div className="desktop-panel-workflow">
        <div className="desktop-view-panel-stack">
        <div className="mobile-assets-tabs desktop-assets-tabs" aria-label="素材与历史">
          <button aria-pressed={mobileAssetsTab === "current"} onClick={() => setMobileAssetsTab("current")} type="button">当前素材</button>
          <button aria-pressed={mobileAssetsTab === "history"} onClick={() => setMobileAssetsTab("history")} type="button">生成历史</button>
          <button aria-pressed={mobileAssetsTab === "versions"} onClick={() => setMobileAssetsTab("versions")} type="button">画板版本</button>
        </div>
        {mobileAssetsTab === "current" ? (
        <section className="panel-section assets-panel-section">
          <div className="section-title">
            <span>当前素材</span>
            <button disabled={!canClearCurrentPage} onClick={clearCurrentPage} type="button">
              <AppIcon icon={IconDelete} size="sm" />
              清空画板
            </button>
          </div>
          {renderAssetList()}
        </section>
        ) : null}
        {mobileAssetsTab === "history" ? (
        <section className="panel-section history-panel-section">
          <div className="section-title">
            <span>生成历史</span>
            <span className="pill">{board.jobs.length} 条</span>
          </div>
          <div className="history-list">
            {board.jobs.slice(0, 6).map((job) => renderGenerationHistoryItem(job))}
            {board.jobs.length === 0 ? <p className="muted">还没有生成记录</p> : null}
          </div>
        </section>
        ) : null}
        {mobileAssetsTab === "versions" ? renderVersionHistoryPanel() : null}
        </div>
        </div>
        ) : null}
      </aside>

      <section className="canvas-area desktop-canvas-area" ref={canvasAreaRef}>
        <div className="canvas-meta">
          <span>{currentPageName}</span>
          <span>{selectionInfo.selectedCount} 个选中 / {selectionInfo.pageShapeCount} 个对象</span>
          {shouldShowLatestGenerationRecord && latestGenerationRecord ? (
            <span>{latestGenerationRecord.modeLabel}：{latestGenerationRecord.status}</span>
          ) : null}
          <span>{currentStatusText}</span>
        </div>
        <KonvaBoardCanvas
          assets={board.assets}
          document={boardDocument}
          isMaskMode={currentToolId === "mask"}
          maskBrushSize={sourceAssetSize ? getMaskBrushSize(sourceAssetSize, maskBrushRatio) : 24}
          onChange={setDocumentAndSave}
          onMaskStrokeComplete={handleCanvasMaskStroke}
          onObjectContextMenu={handleCanvasObjectContextMenu}
          onSelectionChange={handleCanvasSelectionChange}
          onStageReady={() => undefined}
          onViewportChange={setViewport}
          selectedObjectIds={selectedObjectIds}
          sourceAssetId={sourceAssetId}
          viewport={viewport}
        />
        {renderSelectedObjectQuickToolbar()}
        {canvasContextMenu ? (
          <div
            className="canvas-context-menu"
            style={{ left: canvasContextMenu.x, top: canvasContextMenu.y }}
            role="menu"
          >
            {pageObjects.some((item) => item.id === canvasContextMenu.objectId && item.type === "image") ? (
            <button onClick={() => void copyContextMenuImage()} type="button" role="menuitem">
              复制图片
            </button>
            ) : null}
            <button onClick={duplicateSelectedObjects} type="button" role="menuitem">
              复制副本
            </button>
            <button onClick={() => reorderSelectedObjects("front")} type="button" role="menuitem">
              置于顶层
            </button>
            <button onClick={() => reorderSelectedObjects("back")} type="button" role="menuitem">
              置于底层
            </button>
            {pageObjects.some((item) => item.id === canvasContextMenu.objectId && item.type === "image") ? (
            <button onClick={setSelectedImageAsSource} type="button" role="menuitem">
              设为源图
            </button>
            ) : null}
            <button onClick={exportSelectionAsPng} type="button" role="menuitem">
              导出 PNG
            </button>
            <button onClick={deleteSelectedObjects} type="button" role="menuitem">
              删除
            </button>
            <button onClick={() => setCanvasContextMenu(null)} type="button" role="menuitem">
              关闭
            </button>
          </div>
        ) : null}
        <div
          className="canvas-toolbar canvas-toolbar-bottom"
          aria-label="快捷操作"
          ref={toolbarRef}
          style={{
            "--toolbar-offset-x": `${toolbarOffset.x}px`,
            "--toolbar-offset-y": `${toolbarOffset.y}px`,
          } as CSSProperties}
        >
          <button
            className="canvas-toolbar-drag-handle"
            onPointerCancel={cancelToolbarDrag}
            onPointerDown={beginToolbarDrag}
            onPointerMove={updateToolbarDrag}
            onPointerUp={finishToolbarDrag}
            title="拖动工具条"
            type="button"
          >
            <AppIcon icon={IconDragHandle} size="lg" />
          </button>
          <span className="toolbar-divider"></span>
          <button disabled={!boardHistory.canUndo} onClick={undoBoardDocument} title="撤销" type="button">
            <AppIcon icon={IconUndo} size="lg" />
          </button>
          <button disabled={!boardHistory.canRedo} onClick={redoBoardDocument} title="重做" type="button">
            <AppIcon icon={IconRedo} size="lg" />
          </button>
          <span className="toolbar-divider"></span>
          <button aria-pressed={currentToolId === "select"} onClick={() => setCurrentToolId("select")} title="选择" type="button">
            <AppIcon icon={IconPointer} size="lg" />
          </button>
          <button aria-pressed={currentToolId === "mask"} onClick={() => setCurrentToolId("mask")} title="蒙版笔" type="button">
            <AppIcon icon={IconPaint} size="lg" />
          </button>
          <button onClick={selectAllCanvasObjects} title="全选" type="button">
            <AppIcon icon={IconGrid} size="lg" />
          </button>
          <button disabled={activeSelectedObjectIds.length === 0} onClick={() => setSelectedObjectIds([])} title="取消选择" type="button">
            <AppIcon icon={IconClose} size="lg" />
          </button>
          <button disabled={activeSelectedObjectIds.length === 0} onClick={deleteSelectedObjects} title="删除" type="button">
            <AppIcon icon={IconDelete} size="lg" />
          </button>
          <button disabled={activeSelectedObjectIds.length === 0} onClick={duplicateSelectedObjects} title="复制副本" type="button">
            <AppIcon icon={IconCopy} size="lg" />
          </button>
          <button disabled={!selectedImageObject} onClick={setSelectedImageAsSource} title="设为源图" type="button">
            源图
          </button>
          <button disabled={!selectedImageObject} onClick={generateSelectedImageVariant} title="生成变体" type="button">
            变体
          </button>
          <button disabled={!selectedImageObject} onClick={() => generateSelectedImageMultiAngle()} title="生成多角度" type="button">
            多角度
          </button>
          <button disabled={!selectedImageObject} onClick={removeSelectedImageBackground} title="去背景" type="button">
            去背景
          </button>
          <button disabled={activeSelectedObjectIds.length === 0} onClick={exportSelectionAsPng} title="导出 PNG" type="button">
            <AppIcon icon={IconDownload} size="lg" />
          </button>
          <span className="toolbar-divider"></span>
          <div className={isCanvasMoreMenuOpen ? "canvas-toolbar-more is-open" : "canvas-toolbar-more"}>
            <button
              aria-expanded={isCanvasMoreMenuOpen}
              aria-haspopup="menu"
              onClick={() => setIsCanvasMoreMenuOpen((current) => !current)}
              title="更多画板工具"
              type="button"
            >
              <AppIcon icon={IconAi} size="lg" />
            </button>
            {isCanvasMoreMenuOpen ? (
              <div className="canvas-toolbar-more-content workflow-menu" role="menu">
                <header className="toolbar-more-header">
                  <strong>画板工具</strong>
                  <button aria-label="关闭更多画板工具" onClick={() => setIsCanvasMoreMenuOpen(false)} type="button">
                    <AppIcon icon={IconClose} size="md" />
                  </button>
                </header>
                <section className="toolbar-more-section">
                  <strong>图层</strong>
                  <div className="toolbar-action-grid">
                    <button disabled={activeSelectedObjectIds.length < 2} onClick={groupSelectedObjects} type="button">
                      <AppIcon icon={IconLayers} size="md" />
                      成组
                    </button>
                    <button disabled={activeSelectedObjectIds.length === 0} onClick={ungroupSelectedObjects} type="button">
                      解组
                    </button>
                  </div>
                </section>
                <section className="toolbar-more-section">
                  <strong>对齐与层级</strong>
                  <div className="toolbar-action-grid">
                    {boardAlignmentActions.map((item) => (
                      <button
                        disabled={activeSelectedObjectIds.length < 2}
                        key={item.action}
                        onClick={() => alignSelectedObjects(item.action)}
                        type="button"
                      >
                        <AppIcon icon={item.icon} size="md" />
                        {item.title}
                      </button>
                    ))}
                    {boardDistributionActions.map((item) => (
                      <button
                        disabled={activeSelectedObjectIds.length < 3}
                        key={item.action}
                        onClick={() => distributeSelectedObjects(item.action)}
                        type="button"
                      >
                        <AppIcon icon={item.icon} size="md" />
                        {item.title}
                      </button>
                    ))}
                    {boardReorderActions.map((item) => (
                      <button
                        disabled={activeSelectedObjectIds.length === 0}
                        key={item.action}
                        onClick={() => reorderSelectedObjects(item.action)}
                        type="button"
                      >
                        <AppIcon icon={item.icon} size="md" />
                        {item.title}
                      </button>
                    ))}
                  </div>
                </section>
                <section className="toolbar-more-section">
                  <strong>智能排版</strong>
                  <div className="toolbar-action-grid">
                    {boardAutoLayoutActions.map((item) => (
                      <button
                        disabled={activeSelectedObjectIds.length < (item.action === "beforeAfter" ? 2 : 1)}
                        key={item.action}
                        onClick={() => autoLayoutSelectedObjects(item.action)}
                        type="button"
                      >
                        <AppIcon icon={item.icon} size="md" />
                        {item.title}
                      </button>
                    ))}
                  </div>
                </section>
                <section className="toolbar-more-section">
                  <strong>批量导出</strong>
                  <div className="toolbar-action-grid">
                    <button onClick={() => exportBatchAsPng("page")} type="button">
                      整页 PNG
                    </button>
                    <button disabled={activeSelectedObjectIds.length === 0} onClick={() => exportBatchAsPng("selection")} type="button">
                      选区 PNG
                    </button>
                    <button onClick={() => exportBatchAsPng("groups")} type="button">
                      分组 PNG
                    </button>
                  </div>
                </section>
                <section className="toolbar-more-section">
                  <strong>固定工作流</strong>
                  <div className="toolbar-action-grid">
                    <button onClick={() => runFixedWorkflow("product")} type="button">
                      商品图流程
                    </button>
                    <button onClick={() => runFixedWorkflow("outfit")} type="button">
                      人物换装流程
                    </button>
                    <button onClick={() => runFixedWorkflow("logo")} type="button">
                      Logo 展示流程
                    </button>
                  </div>
                </section>
              </div>
            ) : null}
          </div>
          <span className="toolbar-divider"></span>
          <label className="canvas-zoom-select">
            <select
              aria-label="缩放比例"
              onChange={(event) => setViewport((current) => ({ ...current, zoom: Number(event.target.value) }))}
              value={viewport.zoom}
            >
              <option value={0.5}>50%</option>
              <option value={1}>100%</option>
              <option value={1.5}>150%</option>
              <option value={2}>200%</option>
            </select>
          </label>
          <button onClick={() => setStatus("已切换全屏视图控制")} title="全屏" type="button">
            <AppIcon icon={IconFitCanvas} size="lg" />
          </button>
        </div>
      </section>
      {renderAssetFilmstrip()}

      <aside className="asset-panel desktop-side-assets">
        <section className="panel-section assets-panel-section">
          <div className="section-title">
            <span>当前素材</span>
            <button disabled={!canClearCurrentPage} onClick={clearCurrentPage} type="button">
              <AppIcon icon={IconDelete} size="sm" />
              清空画板
            </button>
          </div>
          {renderAssetList()}
        </section>
        <section className="panel-section history-panel-section">
          <div className="section-title">
            <span>生成历史</span>
            <span className="pill">{board.jobs.length} 条</span>
          </div>
          <div className="history-list">
            {board.jobs.slice(0, 6).map((job) => renderGenerationHistoryItem(job))}
            {board.jobs.length === 0 ? <p className="muted">还没有生成记录</p> : null}
          </div>
        </section>
      </aside>
      {renderSharedWorkspaceDialogs()}
    </BoardWorkspaceDesktop>
  );

  function renderReferenceCard(
    item: (typeof referenceAssets)[number],
    keyPrefix: string,
    options: { showReversePrompt?: boolean } = {},
  ) {
    const isReversePromptLoading = reversePromptLoadingAssetId === item.asset.id;
    const hasReversePrompt = Boolean(reversePromptByAssetId[item.asset.id]);
    const hasReversePromptError = Boolean(reversePromptErrorByAssetId[item.asset.id]);
    const roleLabel = item.role
      ? referenceRoleOptions.find((option) => option.value === item.role)?.label ?? item.role
      : "未标记";
    const isRolePickerOpen = openReferenceRoleAssetId === item.asset.id;
    const itemIndex = referenceItems.findIndex((referenceItem) => referenceItem.assetId === item.asset.id);
    const weightLabel = referenceWeightOptions.find((option) => option.value === item.weight)?.label ?? "中";
    return (
      <div className={["preview-card mobile-reference-card", item.role ? "has-role" : ""].join(" ")} key={`${keyPrefix}-${item.asset.id}`}>
        <div className="reference-card-image-frame">
          <img alt="" src={apiUrl(item.asset.publicUrl)} />
          <button
            className="image-clear-button"
            onClick={() => removeReferenceAsset(item.asset.id)}
            title="移除这张参考图"
            type="button"
          >
            <AppIcon icon={IconClose} size="sm" />
          </button>
        </div>
        <div className="reference-card-meta">
          <span>#{itemIndex + 1}</span>
          <span>强度 {weightLabel}</span>
          <button aria-label="前移参考图" disabled={itemIndex <= 0} onClick={() => moveReferenceItem(item.asset.id, -1)} type="button">
            <AppIcon icon={IconUndo} size="xs" />
          </button>
          <button aria-label="后移参考图" disabled={itemIndex < 0 || itemIndex >= referenceItems.length - 1} onClick={() => moveReferenceItem(item.asset.id, 1)} type="button">
            <AppIcon icon={IconRedo} size="xs" />
          </button>
        </div>
        <div className="reference-card-actions">
          <div className="reference-role-picker">
            <button
              aria-expanded={isRolePickerOpen}
              aria-haspopup="menu"
              className="reference-role-badge"
              onClick={() => setOpenReferenceRoleAssetId((current) => current === item.asset.id ? "" : item.asset.id)}
              title={`当前角色：${roleLabel}`}
              type="button"
            >
              {item.role ? roleLabel : "标记"}
            </button>
          </div>
          {options.showReversePrompt ? (
            <button
              className={[
                "reference-prompt-pill",
                isReversePromptLoading
                  ? "is-loading"
                  : hasReversePrompt
                    ? "is-complete"
                    : hasReversePromptError
                      ? "is-error"
                      : "is-ready",
              ].join(" ")}
              disabled={isReversePromptLoading}
              onClick={() => void openReferencePrompt(item.asset)}
              title={
                isReversePromptLoading
                  ? "正在反推这张参考图的提示词"
                  : hasReversePromptError
                    ? `重新反推关键词：${reversePromptErrorByAssetId[item.asset.id]}`
                    : hasReversePrompt
                      ? "查看或更新这张参考图的关键词"
                      : "反推这张参考图的关键词"
              }
              type="button"
            >
              {isReversePromptLoading ? <AppIcon icon={IconLoading} className="spin" size="xs" /> : null}
              关键词
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  function renderReferenceRolePanel(item: (typeof referenceAssets)[number]) {
    const roleLabel = item.role
      ? referenceRoleOptions.find((option) => option.value === item.role)?.label ?? item.role
      : "未标记";
    return (
      <div className="reference-role-panel" role="menu">
        <header>
          <div>
            <strong>参考图标记</strong>
            <span>当前：{roleLabel}</span>
          </div>
          <button aria-label="关闭参考图标记" onClick={() => setOpenReferenceRoleAssetId("")} type="button">
            <AppIcon icon={IconClose} size="sm" />
          </button>
        </header>
        <button className="reference-role-clear" onClick={() => updateReferenceRole(item.asset.id, "")} type="button" role="menuitem">
          不标记
        </button>
        <section className="reference-weight-panel">
          <span>影响强度</span>
          <div>
            {referenceWeightOptions.map((option) => (
              <button
                aria-pressed={(item.weight ?? "medium") === option.value}
                key={`${item.asset.id}-${option.value}`}
                onClick={() => updateReferenceWeight(item.asset.id, option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>
        <div className="reference-role-panel-groups">
          {referenceRoleGroups.map((group) => (
            <section key={`${item.asset.id}-${group.label}`}>
              <span>{group.label}</span>
              <div>
                {group.options.map((option) => (
                  <button
                    aria-pressed={item.role === option.value}
                    key={`${item.asset.id}-${option.value}`}
                    onClick={() => updateReferenceRole(item.asset.id, option.value)}
                    type="button"
                    role="menuitem"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    );
  }
}

function updateCurrentPageObjects(
  document: BoardDocument,
  update: (objects: BoardObject[]) => BoardObject[],
): BoardDocument {
  return {
    ...document,
    pages: document.pages.map((page) =>
      page.id === document.currentPageId ? { ...page, objects: update(page.objects) } : page,
    ),
  };
}

function getCurrentPageObjects(document: BoardDocument) {
  return document.pages.find((page) => page.id === document.currentPageId)?.objects ?? document.pages[0]?.objects ?? [];
}

function cleanBoardObjectMetadata<TObject extends BoardObject>(object: TObject): TObject {
  const nextObject = { ...object };
  if (nextObject.hidden !== true) delete nextObject.hidden;
  if (nextObject.locked !== true) delete nextObject.locked;
  if (!nextObject.name?.trim()) delete nextObject.name;
  return nextObject;
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}

function getNextImageInsertPosition(
  objects: BoardObject[],
  placement: ShapePlacement | undefined,
  width: number,
  height: number,
  batchIndex = 0,
) {
  if (placement) {
    const x = placement.x + placement.w + IMAGE_INSERT_GAP;
    let y = placement.y + batchIndex * (height + IMAGE_INSERT_GAP);
    while (objects.some((object) => objectOverlaps({ h: height, w: width, x, y }, object))) {
      y += height + IMAGE_INSERT_GAP;
    }
    return { x, y };
  }
  const imageCount = objects.filter((object) => object.type === "image").length;
  const batchColumn = batchIndex % 3;
  const batchRow = Math.floor(batchIndex / 3);
  const offset = imageCount * IMAGE_INSERT_GAP;
  return {
    x: DEFAULT_IMAGE_INSERT_X + offset + batchColumn * (width + IMAGE_INSERT_GAP),
    y: DEFAULT_IMAGE_INSERT_Y + offset + batchRow * (height + IMAGE_INSERT_GAP),
    w: width,
    h: height,
  };
}

function createBoardObjectId(assetId: string) {
  return `image:${assetId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function createStoryboardShotCardObjects(
  shot: StoryboardShotPayload,
  input: { existingIds: Set<string>; x: number; y: number },
): BoardObject[] {
  const groupId = getNextBoardObjectId(input.existingIds, `storyboard:${shot.id}`);
  const cardName = `分镜 ${shot.shotIndex}`;
  const background = {
    groupId,
    groupName: cardName,
    h: STORYBOARD_CARD_HEIGHT,
    id: getNextBoardObjectId(input.existingIds, `${groupId}:bg`),
    name: `${cardName} 卡片`,
    rotation: 0,
    type: "rect",
    w: STORYBOARD_CARD_WIDTH,
    x: input.x,
    y: input.y,
  } satisfies BoardObject;
  const textObjects: BoardTextObject[] = [
    {
      groupId,
      groupName: cardName,
      id: getNextBoardObjectId(input.existingIds, `${groupId}:title`),
      name: `${cardName} 标题`,
      rotation: 0,
      text: `#${shot.shotIndex} ${truncateBoardText(shot.caption || shot.action || "未命名镜头", 24)}`,
      type: "text",
      x: input.x + 18,
      y: input.y + 16,
    },
    {
      groupId,
      groupName: cardName,
      id: getNextBoardObjectId(input.existingIds, `${groupId}:body`),
      name: `${cardName} 内容`,
      rotation: 0,
      text: buildStoryboardCardBody(shot),
      type: "text",
      x: input.x + 18,
      y: input.y + 54,
    },
  ];
  return [background, ...textObjects];
}

function buildStoryboardCardBody(shot: StoryboardShotPayload) {
  return [
    `时长 ${shot.durationSec}s · ${shot.status}`,
    `场景：${truncateBoardText(shot.scene || "待补充", 32)}`,
    `动作：${truncateBoardText(shot.action || "待补充", 32)}`,
    `字幕：${truncateBoardText(shot.caption || shot.dialogue || "待补充", 32)}`,
    `提示词：${getStoryboardPromptSummary(shot)}`,
  ].join("\n");
}

function getStoryboardPromptSummary(shot: StoryboardShotPayload) {
  const completedCount = [shot.startFramePrompt, shot.endFramePrompt, shot.videoPrompt].filter((value) => value.trim()).length;
  return completedCount === 3 ? "已完成" : `${completedCount}/3`;
}

function truncateBoardText(value: string, maxLength: number) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function getNextBoardObjectId(existingIds: Set<string>, prefix: string) {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9:_-]/g, "-");
  let nextId = `${safePrefix}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  while (existingIds.has(nextId)) {
    nextId = `${safePrefix}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  }
  existingIds.add(nextId);
  return nextId;
}

function getStoryboardCardCount(objects: BoardObject[]) {
  return new Set(
    objects
      .map((object) => object.groupId)
      .filter((groupId): groupId is string => Boolean(groupId?.startsWith("storyboard:"))),
  ).size;
}

function objectOverlaps(rect: ShapePlacement, object: BoardObject) {
  if (!("x" in object) || !("y" in object)) return false;
  const objectWidth = "w" in object ? object.w : 0;
  const objectHeight = "h" in object ? object.h : 0;
  return (
    rect.x < object.x + objectWidth + IMAGE_INSERT_GAP &&
    rect.x + rect.w + IMAGE_INSERT_GAP > object.x &&
    rect.y < object.y + objectHeight + IMAGE_INSERT_GAP &&
    rect.y + rect.h + IMAGE_INSERT_GAP > object.y
  );
}

function getAppSnapshot(snapshot: unknown): AppSnapshot {
  if (!isRecord(snapshot) || !isRecord(snapshot.app)) {
    return {};
  }
  return {
    artStyle: getValidArtStyle(snapshot.app.artStyle),
    generationCount: getValidGenerationCount(snapshot.app.generationCount),
    maskFeatherRatio: getValidMaskFeatherRatio(snapshot.app.maskFeatherRatio),
    maskBrushRatio: getValidMaskBrushRatio(snapshot.app.maskBrushRatio),
    maskState: getValidMaskState(snapshot.app.maskState),
    prompt: typeof snapshot.app.prompt === "string" ? snapshot.app.prompt : "",
    preserveStrength: getValidPreserveStrength(snapshot.app.preserveStrength),
    referenceFit: getValidReferenceFit(snapshot.app.referenceFit),
    referenceAssetIds: getValidAssetIdList(snapshot.app.referenceAssetIds),
    referenceAssetIdsByRole: getValidReferenceAssetMap(snapshot.app.referenceAssetIdsByRole),
    referenceConflictStrategy: getValidReferenceConflictStrategy(snapshot.app.referenceConflictStrategy),
    referenceItems: getValidReferenceItems(snapshot.app.referenceItems),
    reversePromptByAssetId: getValidReversePromptMap(snapshot.app.reversePromptByAssetId),
    selectedAspectRatio: getBoardAspectRatioSelection(snapshot.app.selectedAspectRatio),
    selectedImageModel: typeof snapshot.app.selectedImageModel === "string" ? snapshot.app.selectedImageModel : "",
    sourceImageSize: typeof snapshot.app.sourceImageSize === "string" && isValidImageSize(snapshot.app.sourceImageSize)
      ? snapshot.app.sourceImageSize
      : undefined,
    sourceAssetId: typeof snapshot.app.sourceAssetId === "string" ? snapshot.app.sourceAssetId : "",
    sourcePrompt: typeof snapshot.app.sourcePrompt === "string" ? snapshot.app.sourcePrompt : "",
    toolbarOffset: getValidPoint(snapshot.app.toolbarOffset, DEFAULT_TOOLBAR_OFFSET),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getValidPoint(value: unknown, fallback: Point): Point {
  if (!isRecord(value) || typeof value.x !== "number" || typeof value.y !== "number") {
    return fallback;
  }
  return {
    x: Number.isFinite(value.x) ? value.x : fallback.x,
    y: Number.isFinite(value.y) ? value.y : fallback.y,
  };
}

function getGenerationJobParams(job: Pick<JobPayload, "paramsJson">): GenerationJobParams {
  if (!job.paramsJson) return {};
  try {
    const parsed: unknown = JSON.parse(job.paramsJson);
    if (!isRecord(parsed)) return {};
    return {
      count: typeof parsed.count === "number" ? parsed.count : undefined,
      model: typeof parsed.model === "string" ? parsed.model : undefined,
      referenceAssetIds: Array.isArray(parsed.referenceAssetIds)
        ? parsed.referenceAssetIds.filter((assetId): assetId is string => typeof assetId === "string")
        : undefined,
      referenceItems: Array.isArray(parsed.referenceItems)
        ? parsed.referenceItems
            .filter((item): item is Record<string, unknown> => isRecord(item) && typeof item.assetId === "string")
            .map((item) => ({
              assetId: item.assetId as string,
              ...(typeof item.role === "string" && isReferenceRole(item.role) ? { role: item.role } : {}),
              ...(isReferenceWeight(item.weight) ? { weight: item.weight } : {}),
            }))
        : undefined,
      size: typeof parsed.size === "string" ? parsed.size : undefined,
    };
  } catch {
    return {};
  }
}

function getReferenceAssetMapFromItems(items: ReferenceItem[]): ReferenceAssetMap {
  return items.reduce<ReferenceAssetMap>((map, item) => {
    if (item.role) map[item.role] = item.assetId;
    return map;
  }, {});
}

function getReferenceGroupKey(role: ReferenceRole | undefined): ReferenceGroupKey {
  if (!role) return "unmarked";
  if (["subject", "face", "hair", "makeup", "body", "action"].includes(role)) return "person";
  if (["clothing", "top", "bottom", "dress", "outerwear", "fabric", "colorPalette", "shoes", "bag", "hat", "accessory"].includes(role)) {
    return "clothing";
  }
  if (["product", "logo", "material", "packaging"].includes(role)) return "product";
  return "scene";
}

function getGroupedReferenceAssets(items: ResolvedReferenceAsset[]) {
  const groupDefs: Array<{ key: ReferenceGroupKey; label: string }> = [
    { key: "person", label: "人物" },
    { key: "clothing", label: "服装" },
    { key: "product", label: "商品" },
    { key: "scene", label: "画面" },
    { key: "unmarked", label: "未标记" },
  ];
  return groupDefs
    .map((group) => ({
      ...group,
      items: items.filter((item) => getReferenceGroupKey(item.role) === group.key),
    }))
    .filter((group) => group.items.length > 0);
}

function getReferenceConflictEntries(items: ReferenceItem[]) {
  const counts = new Map<ReferenceRole, number>();
  for (const item of items) {
    if (!item.role) continue;
    counts.set(item.role, (counts.get(item.role) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([role, count]) => ({
      count,
      label: referenceRoleOptions.find((option) => option.value === role)?.label ?? role,
      role,
    }));
}

function getReferenceFitForPreset(preset: ReferencePreset): ReferenceFit {
  if (preset === "product" || preset === "logo") return "exact";
  if (preset === "outfit") return "material";
  return "balanced";
}

function getReferencePresetLabel(preset: ReferencePreset) {
  const labels: Record<ReferencePreset, string> = {
    logo: "Logo 融合",
    outfit: "人物换装",
    product: "商品替换",
    scene: "场景重构",
  };
  return labels[preset];
}

function getReferenceConflictStrategyLabel(strategy: ReferenceConflictStrategy) {
  return referenceConflictStrategyOptions.find((option) => option.value === strategy)?.label ?? "合并参考";
}

function getPresetReferenceRole(
  preset: ReferencePreset,
  index: number,
  fallback?: ReferenceRole,
): ReferenceRole | undefined {
  const roles: Record<ReferencePreset, ReferenceRole[]> = {
    logo: ["logo", "material", "composition", "lighting", "style"],
    outfit: ["subject", "top", "bottom", "shoes", "bag", "lighting"],
    product: ["product", "material", "packaging", "lighting", "composition"],
    scene: ["scene", "background", "lighting", "camera", "mood"],
  };
  return roles[preset][index] ?? fallback;
}

function getResolvedReferenceAssets(items: ReferenceItem[], imageAssets: AssetPayload[]): ResolvedReferenceAsset[] {
  return items
    .flatMap((item, index) => {
      const roleOption = referenceRoleOptions.find((option) => option.value === item.role);
      const asset = imageAssets.find((assetItem) => assetItem.id === item.assetId);
      if (!asset) return [];
      return [{
        value: `reference-${index + 1}`,
        label: roleOption?.label ?? (index === 0 ? "主参考图" : `参考图 ${index + 1}`),
        ...(item.role ? { role: item.role } : {}),
        ...(item.weight ? { weight: item.weight } : {}),
        asset,
      }];
    });
}

function getGenerationJobForAsset(jobs: JobPayload[], assetId: string) {
  return jobs.find((job) => job.results.some((result) => result.asset.id === assetId)) ?? null;
}

function getGenerationJobDurationMs(
  job: Pick<JobPayload, "createdAt" | "status" | "updatedAt">,
  nowMs?: number,
) {
  const startedAt = Date.parse(job.createdAt);
  const endedAt = job.status === "running" && typeof nowMs === "number" ? nowMs : Date.parse(job.updatedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) return null;
  return endedAt - startedAt;
}

function getGenerationJobStatusLabel(status: string) {
  if (status === "preparing") return "准备素材";
  if (status === "calling_model") return "请求模型中";
  if (status === "saving_results") return "保存结果";
  if (status === "succeeded") return "已完成";
  if (status === "running") return "运行中";
  if (status === "failed") return "失败";
  return status;
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds} 秒`;
  return `${minutes} 分 ${seconds.toString().padStart(2, "0")} 秒`;
}

function getCurrentPromptRecipeParamsFromValues(input: {
  artStyle: BoardArtStyle;
  count: number;
  model: string;
  preserveStrength: PreserveStrength;
  referenceFit: ReferenceFit;
  size: ImageSize;
}) {
  return {
    artStyle: input.artStyle,
    count: input.count,
    model: input.model,
    preserveStrength: input.preserveStrength,
    referenceFit: input.referenceFit,
    size: input.size,
  };
}

function getPromptRecipeParams(value: Record<string, unknown>) {
  return {
    artStyle: boardArtStyleOptions.some((option) => option.value === value.artStyle)
      ? value.artStyle as BoardArtStyle
      : undefined,
    count: getValidGenerationCount(value.count),
    model: typeof value.model === "string" && value.model.trim() ? value.model : undefined,
    preserveStrength: preserveStrengthOptions.some((option) => option.value === value.preserveStrength)
      ? value.preserveStrength as PreserveStrength
      : undefined,
    referenceFit: referenceFitOptions.some((option) => option.value === value.referenceFit)
      ? value.referenceFit as ReferenceFit
      : undefined,
    size: typeof value.size === "string" && isValidImageSize(value.size) ? value.size : undefined,
  };
}

function formatDateTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(timestamp));
}

function mergeAssetsById(incoming: AssetPayload[], current: AssetPayload[]) {
  const incomingIds = new Set(incoming.map((asset) => asset.id));
  return [...incoming, ...current.filter((asset) => !incomingIds.has(asset.id))];
}

function mergeJobsById(incoming: JobPayload[], current: JobPayload[]) {
  const incomingIds = new Set(incoming.map((job) => job.id));
  return [...incoming, ...current.filter((job) => !incomingIds.has(job.id))].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

function removeAssetFromJobs(jobs: JobPayload[], assetId: string) {
  return jobs.map((job) => ({
    ...job,
    results: job.results.filter((result) => result.asset.id !== assetId),
  }));
}

function filterExistingObjectIds(document: BoardDocument, objectIds: string[]) {
  if (objectIds.length === 0) return objectIds;
  const existingIds = new Set(document.pages.flatMap((page) => page.objects.map((object) => object.id)));
  return objectIds.filter((id) => existingIds.has(id));
}

function mergeBoardCache(incoming: BoardPayload, current: BoardPayload) {
  return {
    ...current,
    ...incoming,
    assets: mergeAssetsById(incoming.assets, current.assets),
    jobs: mergeJobsById(incoming.jobs, current.jobs),
    storyboardProject: incoming.storyboardProject ?? current.storyboardProject ?? null,
  };
}

function getAssetTags(asset: AssetPayload) {
  if (asset.tags) return getStringArray(asset.tags);
  if (!asset.tagsJson) return [];
  try {
    const value = JSON.parse(asset.tagsJson);
    return getStringArray(value);
  } catch {
    return [];
  }
}

function getAssetThumbnailUrl(asset: AssetPayload) {
  return asset.thumbnailUrl ?? asset.publicUrl.replace(/\/file(?:\?.*)?$/, "/thumbnail");
}

function getAssetPayloadFromMetadataResponse(asset: AssetPayload & { tags?: string[] }) {
  const tagsJson = asset.tagsJson ?? (asset.tags ? JSON.stringify(asset.tags) : null);
  return {
    ...asset,
    tagsJson,
  };
}

function normalizeAssetListResponse(payload: AssetListResponse) {
  return {
    assets: (payload.assets ?? []).map(getAssetPayloadFromMetadataResponse),
    nextCursor: payload.nextCursor ?? null,
    totalMatching: payload.totalMatching ?? null,
  };
}

function getBoardAssetsPath(
  boardId: string,
  input: {
    cursor?: string;
    favoriteOnly: boolean;
    kind: AssetKindFilter;
    limit: number;
    q: string;
    tag: string;
  },
) {
  const params = new URLSearchParams();
  params.set("limit", String(input.limit));
  if (input.cursor) params.set("cursor", input.cursor);
  if (input.kind !== "all") params.set("kind", input.kind);
  if (input.favoriteOnly) params.set("favorite", "true");
  const tag = normalizeAssetSearchText(input.tag);
  if (tag) params.set("tag", tag);
  const query = normalizeAssetSearchText(input.q);
  if (query) params.set("q", query);
  return `/api/boards/${boardId}/assets?${params.toString()}`;
}

function normalizeAssetSearchText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function getAssetListRequestKey(input: {
  favoriteOnly: boolean;
  kind: AssetKindFilter;
  q: string;
  tag: string;
}) {
  return JSON.stringify({
    favorite: input.favoriteOnly,
    kind: input.kind,
    q: normalizeAssetSearchText(input.q),
    tag: normalizeAssetSearchText(input.tag),
  });
}

function assetMatchesServerListFilters(
  asset: AssetPayload,
  input: {
    favoriteOnly: boolean;
    kind: AssetKindFilter;
    q: string;
    tag: string;
  },
) {
  if (!asset.mimeType.startsWith("image/")) return false;
  if (input.favoriteOnly && !asset.isFavorite) return false;
  if (input.kind !== "all" && asset.kind !== input.kind) return false;
  const tag = normalizeAssetSearchText(input.tag);
  if (tag && !getAssetTags(asset).some((assetTag) => normalizeAssetSearchText(assetTag) === tag)) return false;
  const query = normalizeAssetSearchText(input.q);
  if (!query) return true;
  const searchableText = [
    asset.kind,
    asset.mimeType,
    asset.createdAt,
    ...getAssetTags(asset),
  ].map(normalizeAssetSearchText).join(" ");
  return searchableText.includes(query);
}

function getRecoveredGeneratedAssets(
  board: BoardPayload,
  beforeAssetIds: Set<string>,
  promptText: string,
  startedAtMs: number,
) {
  const isNewerThanRequest = (createdAt: string) =>
    Date.parse(createdAt) >= startedAtMs - GENERATION_RECOVERY_CLOCK_SKEW_MS;
  const matchedJob = board.jobs.find(
    (job) =>
      job.status === "succeeded" &&
      job.prompt === promptText &&
      isNewerThanRequest(job.createdAt) &&
      job.results.some((result) => !beforeAssetIds.has(result.asset.id)),
  );
  if (matchedJob) {
    return matchedJob.results
      .map((result) => result.asset)
      .filter((asset) => !beforeAssetIds.has(asset.id));
  }
  return board.assets.filter(
    (asset) =>
      asset.kind === "generated" &&
      !beforeAssetIds.has(asset.id) &&
      isNewerThanRequest(asset.createdAt),
  );
}

function getValidGenerationCount(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_GENERATION_COUNT
    ? value
    : DEFAULT_GENERATION_COUNT;
}

function getValidMaskBrushRatio(value: unknown) {
  return typeof value === "number" && value >= 0.01 && value <= 0.12
    ? value
    : DEFAULT_MASK_BRUSH_RATIO;
}

function getValidMaskFeatherRatio(value: unknown) {
  return typeof value === "number" && value >= 0 && value <= 0.06
    ? value
    : DEFAULT_MASK_FEATHER_RATIO;
}

function getValidPreserveStrength(value: unknown): PreserveStrength {
  return preserveStrengthOptions.some((option) => option.value === value)
    ? (value as PreserveStrength)
    : DEFAULT_PRESERVE_STRENGTH;
}

function getValidReferenceFit(value: unknown): ReferenceFit {
  return referenceFitOptions.some((option) => option.value === value)
    ? (value as ReferenceFit)
    : DEFAULT_REFERENCE_FIT;
}

function getValidReferenceConflictStrategy(value: unknown): ReferenceConflictStrategy {
  return referenceConflictStrategyOptions.some((option) => option.value === value)
    ? (value as ReferenceConflictStrategy)
    : "blend";
}

function isReferenceWeight(value: unknown): value is ReferenceWeight {
  return referenceWeightOptions.some((option) => option.value === value);
}

function getValidArtStyle(value: unknown): BoardArtStyle {
  return boardArtStyleOptions.some((option) => option.value === value)
    ? (value as BoardArtStyle)
    : DEFAULT_BOARD_ART_STYLE;
}

function getAspectRatioOrientation(value: BoardAspectRatio) {
  if (value === "auto") return "landscape";
  const [width, height] = value.split(":").map(Number);
  if (width > height) return "landscape";
  if (width < height) return "portrait";
  return "square";
}

function getValidReferenceAssetMap(value: unknown): ReferenceAssetMap {
  if (!isRecord(value)) return {};
  const output: ReferenceAssetMap = {};
  for (const option of referenceRoleOptions) {
    const assetId = value[option.value];
    if (typeof assetId === "string") {
      output[option.value] = assetId;
    }
  }
  return output;
}

function getValidReversePromptMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] =>
      entry[0].length > 0 && typeof entry[1] === "string" && entry[1].trim().length > 0,
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function getValidReferenceItems(value: unknown): ReferenceItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const output: ReferenceItem[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.assetId !== "string" || item.assetId.length === 0) continue;
    const role = isReferenceRole(item.role) ? item.role : undefined;
    const weight = isReferenceWeight(item.weight) ? item.weight : undefined;
    if (output.some((current) => current.assetId === item.assetId)) continue;
    output.push({ assetId: item.assetId, ...(role ? { role } : {}), ...(weight ? { weight } : {}) });
    if (output.length >= MAX_REFERENCE_ASSETS) break;
  }
  return output.length > 0 ? output : undefined;
}

function getReferenceItemsFromLegacyState(
  assetIds: string[] | undefined,
  roleMap: ReferenceAssetMap | undefined,
) {
  const ids = assetIds ?? Array.from(new Set(Object.values(roleMap ?? {})));
  return ids.map((assetId) => {
    const role = referenceRoleOptions.find((option) => roleMap?.[option.value] === assetId)?.value;
    return role ? { assetId, role } : { assetId };
  });
}

function getValidAssetIdList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const output = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return output.length > 0 ? Array.from(new Set(output)).slice(0, MAX_REFERENCE_ASSETS) : undefined;
}

function buildPromptAssistReferenceContext(
  referenceAssets: Array<{
    label: string;
    role?: ReferenceRole;
    asset: AssetPayload;
  }>,
) {
  if (referenceAssets.length === 0) return undefined;
  return referenceAssets
    .map((item, index) => {
      const roleLabel =
        item.role
          ? referenceRoleOptions.find((option) => option.value === item.role)?.label ?? item.role
          : item.label || `参考图 ${index + 1}`;
      return `参考图 ${index + 1}：${roleLabel}。`;
    })
    .join("\n");
}

function getPromptSafetyNotes(reasons: string[]) {
  const labels: Record<string, string> = {
    added_adult_age_guard: "已补充成年女性年龄约束，降低年龄不明确导致的拒绝风险。",
    added_body_aesthetic_language: "已用整体体态和自然比例描述替代局部刺激表达。",
    added_clean_commercial_tone: "已补充干净克制的商业人像表达。",
    added_safety_constraints: "已加入通用安全约束，减少低俗、幼态、暧昧和过度暴露表达。",
    added_strict_constraints: "已加入更严格的成年、克制、商业质感约束。",
    removed_minor_adult_conflict: "已移除未成年/幼态与成人性感表达的冲突。",
    replaced_body_part_emphasis: "已弱化局部身体强调，改为整体比例和自然体态。",
    replaced_high_risk_terms: "已替换高风险性感词为更安全的时尚/角色表达。",
    replaced_revealing_clothing: "已将暴露服装描述改为得体服装和材质描述。",
    replaced_risky_camera_or_scene: "已替换易触发风险的机位或场景氛围描述。",
  };
  return reasons.map((reason) => labels[reason] ?? reason).filter((note) => note.length > 0);
}

function getValidMaskState(value: unknown): MaskState | null {
  if (!isRecord(value) || typeof value.assetId !== "string" || !Array.isArray(value.strokes)) {
    return null;
  }
  const strokes = value.strokes
    .map((stroke) =>
      Array.isArray(stroke)
        ? stroke.filter(
            (point): point is { x: number; y: number } =>
              isRecord(point) && typeof point.x === "number" && typeof point.y === "number",
          )
        : [],
    )
    .filter((stroke) => stroke.length > 0);
  return { assetId: value.assetId, strokes };
}

function drawStroke(context: CanvasRenderingContext2D, stroke: MaskStroke) {
  if (stroke.length === 0) return;
  if (stroke.length === 1) {
    context.beginPath();
    context.arc(stroke[0].x, stroke[0].y, context.lineWidth / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }
  context.beginPath();
  context.moveTo(stroke[0].x, stroke[0].y);
  for (const point of stroke.slice(1)) {
    context.lineTo(point.x, point.y);
  }
  context.stroke();
}

function getStrokeSvgPath(stroke: MaskStroke) {
  if (stroke.length === 0) return "";
  if (stroke.length === 1) {
    return `M ${stroke[0].x} ${stroke[0].y} L ${stroke[0].x + 0.01} ${stroke[0].y + 0.01}`;
  }
  return stroke
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
}

function getSourceImageSize(asset: AssetPayload) {
  return {
    width: asset.width ?? 1024,
    height: asset.height ?? 1024,
  };
}

function getMaskBrushSize(size: { width: number; height: number }, maskBrushRatio: number) {
  return Math.max(size.width, size.height) * maskBrushRatio;
}

async function createMaskBlob(
  asset: AssetPayload,
  strokes: MaskStroke[],
  maskBrushRatio: number,
  maskFeatherRatio: number,
) {
  const { width, height } = getSourceImageSize(asset);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建蒙版");

  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  const cutCanvas = document.createElement("canvas");
  cutCanvas.width = width;
  cutCanvas.height = height;
  const cutContext = cutCanvas.getContext("2d");
  if (!cutContext) throw new Error("无法创建蒙版");
  cutContext.lineCap = "round";
  cutContext.lineJoin = "round";
  cutContext.lineWidth = getMaskBrushSize({ width, height }, maskBrushRatio);
  cutContext.strokeStyle = "#000";
  cutContext.fillStyle = "#000";
  for (const stroke of strokes) {
    drawStroke(cutContext, stroke);
  }
  context.globalCompositeOperation = "destination-out";
  const feather = getMaskBrushSize({ width, height }, maskFeatherRatio);
  if (feather > 0) {
    context.filter = `blur(${Math.round(feather)}px)`;
  }
  context.drawImage(cutCanvas, 0, 0);
  context.filter = "none";

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("无法导出蒙版");
  return blob;
}

async function getImageDimensions(src: string) {
  const shouldRevokeObjectUrl = src.startsWith("blob:");
  try {
    const image = new Image();
    image.src = src;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    if (shouldRevokeObjectUrl) {
      URL.revokeObjectURL(src);
    }
  }
}

async function getAssetImageSize(asset: AssetPayload) {
  if (isPositiveDimension(asset.width) && isPositiveDimension(asset.height)) {
    return { height: asset.height, width: asset.width };
  }
  const dimensions = await getImageDimensions(apiUrl(asset.publicUrl));
  if (isPositiveDimension(dimensions.width) && isPositiveDimension(dimensions.height)) {
    return dimensions;
  }
  return { height: 1024, width: 1024 };
}

function isPositiveDimension(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function buildLocalReplacePrompt(
  promptText: string,
  references: Array<{ label: string; asset: AssetPayload; weight?: ReferenceWeight }>,
  preserveStrength: (typeof preserveStrengthOptions)[number],
  referenceFit: (typeof referenceFitOptions)[number],
  conflictStrategy: ReferenceConflictStrategy,
  hasMask: boolean,
) {
  return [
    targetEditInstruction,
    hasMask
      ? preserveStrength.instruction
      : "Preserve the person's identity, pose, hands, body proportions, lighting, camera angle, and background unless the user explicitly asks to change them.",
    hasMask
      ? referenceFit.instruction
      : referenceFit.instruction.replace(
          ", while respecting the mask and source lighting",
          " while matching the source lighting",
        ),
    hasMask
      ? "Use the first image as the source image and only modify transparent/marked mask areas."
      : "No mask is provided. Perform a targeted image edit based on the text instruction and reference images, changing only the relevant object or visual attribute.",
    `Use any following reference images according to their roles: ${referenceRoleInstruction}.`,
    getReferenceConflictInstruction(conflictStrategy),
    "For character appearance roles, apply only the labeled visual attribute. For clothing roles, apply garment type, fabric, palette, or accessories only as labeled. For product roles, apply product shape, logo, material, or packaging only as labeled. For scene, action, composition, lighting, camera, style, and mood roles, apply environment, pose/movement, framing, illumination, lens feel, visual style, or atmosphere separately.",
    "Do not copy unrelated backgrounds, clothing, pose, or layout from reference images unless that role explicitly asks for it.",
    references.length > 0
      ? `Reference role mapping:\n${formatReferenceRoleMapping(references)}`
      : "No extra reference image was provided; rely on the user's text instruction.",
    promptText.trim() ? `User instruction: ${promptText.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildReferencedTextPrompt(
  promptText: string,
  references: Array<{ label: string; asset: AssetPayload; weight?: ReferenceWeight }>,
  conflictStrategy: ReferenceConflictStrategy,
) {
  return [
    "Generate a new image from the user's instruction.",
    `Use the attached reference images according to their labels: ${referenceRoleInstruction}.`,
    getReferenceConflictInstruction(conflictStrategy),
    "For character appearance roles, apply only the labeled visual attribute. For clothing roles, apply garment type, fabric, palette, or accessories only as labeled. For product roles, apply product shape, logo, material, or packaging only as labeled. For scene, action, composition, lighting, camera, style, and mood roles, apply environment, pose/movement, framing, illumination, lens feel, visual style, or atmosphere separately.",
    "Do not copy unrelated composition, background, clothing, pose, or layout from a reference image unless the user explicitly asks for it or the label calls for it.",
    references.length > 0
      ? `Reference role mapping:\n${formatReferenceRoleMapping(references)}`
      : "",
    `User instruction: ${promptText.trim()}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function getReferenceConflictInstruction(strategy: ReferenceConflictStrategy) {
  return referenceConflictStrategyOptions.find((option) => option.value === strategy)?.instruction ?? referenceConflictStrategyOptions[0].instruction;
}

function formatReferenceRoleMapping(references: Array<{ label: string; weight?: ReferenceWeight }>) {
  return references
    .map((item, index) => {
      const weightOption = referenceWeightOptions.find((option) => option.value === item.weight);
      return `Reference image ${index + 1}: ${item.label}${weightOption ? `, influence ${weightOption.label} (${weightOption.instruction})` : ""}.`;
    })
    .join("\n");
}

function getFilenameFromContentDisposition(value: string | null) {
  if (!value) return null;
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  return value.match(/filename="?([^";]+)"?/i)?.[1] ?? null;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function getDistance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function getFriendlyErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (isNetworkError(error)) {
    return "无法连接当前服务，请检查页面服务或第三方 API 是否可访问";
  }
  return message || fallback;
}

function isNetworkError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lowerMessage = message.toLowerCase();
  return (
    lowerMessage.includes("failed to fetch") ||
    lowerMessage.includes("fetch failed") ||
    lowerMessage.includes("connection error") ||
    lowerMessage.includes("network")
  );
}

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

