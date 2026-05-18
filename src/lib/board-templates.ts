import { BOARD_DOCUMENT_VERSION, type BoardDocument, type BoardObject } from "@/components/board-canvas/board-document";
import type { BoardArtStyle } from "./board-ui-options";
import type { ImageSize } from "./image";

export type BoardTemplate = {
  defaultPrompt: string;
  description: string;
  id: string;
  name: string;
  snapshot: {
    app: {
      artStyle: BoardArtStyle;
      boardDocument: BoardDocument;
      sourceImageSize: ImageSize;
      sourcePrompt: string;
    };
  };
};

const templatePresets: Array<{
  artStyle: BoardArtStyle;
  defaultPrompt: string;
  description: string;
  id: string;
  name: string;
  objects: BoardObject[];
  size: ImageSize;
}> = [
  {
    artStyle: "realistic",
    defaultPrompt: "生成一张电商商品主图：白底、主体居中、柔和阴影、材质细节清晰，适合平台首图。",
    description: "白底商品图、卖点占位和居中产品区域。",
    id: "ecommerce-main",
    name: "电商主图",
    objects: [
      textObject("template-title", "商品主图", 80, 72),
      textObject("template-note", "替换为产品图，生成白底高质感主图", 84, 152),
      frameObject("template-product-frame", 430, 260, 720, 720, "产品区域"),
    ],
    size: "2048x2048",
  },
  {
    artStyle: "realistic",
    defaultPrompt: "生成一张小红书封面：清晰主题、自然光、标题留白、生活方式氛围，适合竖版种草内容。",
    description: "竖版封面结构，预留标题和主体图片区。",
    id: "rednote-cover",
    name: "小红书封面",
    objects: [
      textObject("template-title", "封面标题", 80, 88),
      frameObject("template-visual-frame", 116, 240, 760, 1040, "主视觉"),
      textObject("template-note", "副标题 / 卖点 / 关键词", 96, 1320),
    ],
    size: "2048x2560",
  },
  {
    artStyle: "illustration",
    defaultPrompt: "生成一张活动海报主视觉：明确主题、强层次构图、留出标题和行动按钮区域。",
    description: "活动海报的主标题、视觉区和底部信息区。",
    id: "poster",
    name: "海报",
    objects: [
      textObject("template-title", "活动标题", 108, 96),
      frameObject("template-hero-frame", 128, 260, 820, 980, "海报主视觉"),
      textObject("template-footer", "时间 / 地点 / CTA", 128, 1320),
    ],
    size: "1536x2048",
  },
  {
    artStyle: "realistic",
    defaultPrompt: "基于人物照片生成穿搭方案：保持人物脸部、姿态和体型稳定，突出服装材质和整体造型。",
    description: "人物源图、参考服装和结果对比区。",
    id: "outfit",
    name: "人物穿搭",
    objects: [
      frameObject("template-source-frame", 80, 180, 460, 720, "人物源图"),
      frameObject("template-reference-frame", 590, 180, 380, 520, "服装参考"),
      frameObject("template-result-frame", 1020, 180, 460, 720, "生成结果"),
      textObject("template-title", "穿搭方案对比", 80, 72),
    ],
    size: "2048x1152",
  },
  {
    artStyle: "realistic",
    defaultPrompt: "生成 Logo 应用场景图：真实材质、清晰品牌展示、自然透视，可用于品牌提案。",
    description: "Logo 输入区和多场景展示区。",
    id: "logo-showcase",
    name: "Logo 展示",
    objects: [
      frameObject("template-logo-frame", 96, 180, 420, 420, "Logo"),
      frameObject("template-scene-a", 600, 150, 560, 360, "场景 1"),
      frameObject("template-scene-b", 600, 570, 560, 360, "场景 2"),
      textObject("template-title", "品牌应用展示", 96, 72),
    ],
    size: "2048x1152",
  },
  {
    artStyle: "auto",
    defaultPrompt: "围绕同一个主题生成四张方向不同的方案图，保持视觉质量一致，便于横向比较。",
    description: "四宫格候选结果对比布局。",
    id: "four-up-compare",
    name: "四宫格方案对比",
    objects: [
      textObject("template-title", "方案对比", 84, 72),
      frameObject("template-a", 100, 160, 430, 430, "方案 A"),
      frameObject("template-b", 570, 160, 430, 430, "方案 B"),
      frameObject("template-c", 100, 630, 430, 430, "方案 C"),
      frameObject("template-d", 570, 630, 430, 430, "方案 D"),
    ],
    size: "2048x2048",
  },
];

export const boardTemplates: BoardTemplate[] = templatePresets.map((template) => ({
  defaultPrompt: template.defaultPrompt,
  description: template.description,
  id: template.id,
  name: template.name,
  snapshot: {
    app: {
      artStyle: template.artStyle,
      boardDocument: createTemplateDocument(template.name, template.objects),
      sourceImageSize: template.size,
      sourcePrompt: template.defaultPrompt,
    },
  },
}));

export function getBoardTemplate(templateId: string | undefined) {
  if (!templateId) return null;
  return boardTemplates.find((template) => template.id === templateId) ?? null;
}

function createTemplateDocument(name: string, objects: BoardObject[]): BoardDocument {
  return {
    currentPageId: "page-1",
    pages: [
      {
        id: "page-1",
        name,
        objects,
      },
    ],
    version: BOARD_DOCUMENT_VERSION,
  };
}

function textObject(id: string, text: string, x: number, y: number): BoardObject {
  return {
    id,
    name: text,
    rotation: 0,
    text,
    type: "text",
    x,
    y,
  };
}

function frameObject(id: string, x: number, y: number, w: number, h: number, label: string): BoardObject {
  return {
    h,
    id,
    name: label,
    rotation: 0,
    type: "rect",
    w,
    x,
    y,
  };
}
