export type AssetPayload = {
  id: string;
  kind: string;
  publicUrl: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  isFavorite: boolean;
  tags?: string[];
  tagsJson: string | null;
  createdAt: string;
};

export type JobPayload = {
  id: string;
  mode: string;
  status: string;
  prompt: string;
  paramsJson: string | null;
  sourceAssetId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  results: Array<{ asset: AssetPayload }>;
};

export type StoryboardBriefPayload = {
  targetPlatform: string;
  contentType: string;
  locale: string;
  durationSec: number;
  aspectRatio: string;
  topic: string;
  audience: string;
  sellingPoints: string;
  tone: string;
  constraints: string;
};

export type StoryboardShotPayload = {
  id: string;
  shotIndex: number;
  durationSec: number;
  scene: string;
  camera: string;
  action: string;
  dialogue: string;
  caption: string;
  audio: string;
  startFrameAssetId: string | null;
  endFrameAssetId: string | null;
  startFramePrompt: string;
  endFramePrompt: string;
  videoPrompt: string;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type StoryboardProjectPayload = {
  id: string;
  boardId: string;
  title: string;
  brief: StoryboardBriefPayload;
  scriptText: string;
  shots: StoryboardShotPayload[];
  createdAt: string;
  updatedAt: string;
};

export type BoardPayload = {
  id: string;
  name: string;
  assets: AssetPayload[];
  jobs: JobPayload[];
  storyboardProject?: StoryboardProjectPayload | null;
};

export type ShapePlacement = {
  x: number;
  y: number;
  w: number;
  h: number;
};
