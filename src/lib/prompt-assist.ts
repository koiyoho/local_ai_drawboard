export const promptAssistActions = ["optimize", "expand", "variations", "translate"] as const;
export const promptAssistEngines = ["standard", "skill2"] as const;

export const promptAssistImageTypes = [
  "auto",
  "ui",
  "infographic",
  "poster",
  "ecommerce",
  "person",
  "photo",
  "scene",
  "object",
  "brand",
  "architecture",
  "illustration",
  "character",
  "publication",
  "other",
] as const;

export type PromptAssistAction = (typeof promptAssistActions)[number];
export type PromptAssistEngine = (typeof promptAssistEngines)[number];
export type PromptAssistImageType = (typeof promptAssistImageTypes)[number];

export type PromptAssistInput = {
  action: PromptAssistAction;
  artStyle?: string;
  artStyleInstruction?: string;
  artStyleLabel?: string;
  engine?: PromptAssistEngine;
  imageType: PromptAssistImageType;
  prompt: string;
  referenceContext?: string;
};

export type PromptAssistOutput = {
  prompt: string;
  variations: string[];
  notes: string[];
};

const actionGuidance: Record<PromptAssistAction, string> = {
  optimize: "把现有提示词整理为适合 GPT Image 2 的结构化生成协议，保留原始意图，补足画面主体、参考图关系、版式构图、光线、材质、文字与约束。",
  expand: "在原始意图基础上扩写为完整可执行的工业级提示词，明确主体、场景、层级、风格、镜头/光线、材质、色彩、文本和负向约束。",
  variations: "生成 3 条方向不同但都保留用户原始意图的结构化提示词变体，每条都应可直接用于 GPT Image 2 图像生成。",
  translate: "将提示词翻译并重写为图像生成模型易理解的专业中文提示词协议，保留用户原始意图、参考图标记和关键限制。",
};

const imageTypeGuidance: Record<PromptAssistImageType, string> = {
  auto: "自动判断最合适的图片类型，再选择下列模板思路补全结构，避免泛泛堆形容词。",
  ui: "UI 与界面：明确平台、产品类型、核心功能、页面结构、组件层级、状态栏/导航/卡片/Tab 等界面元素，要求高保真截图、文字清晰可读、比例固定。",
  infographic: "图表与信息可视化：明确主题、目标读者、标题区、3-5 个模块、图标/短标题/短说明、箭头或连接关系、色彩分组，要求信息层级清晰、短文案可读。",
  poster: "海报与排版：明确主视觉、标题/副标题、版式、视觉焦点、留白、品牌氛围、色彩系统和传播比例，要求文字准确、层级强、不要杂乱拼贴。",
  ecommerce: "商品与电商：明确产品、卖点、包装/材质、使用场景、详情页或广告结构、商业摄影光线、干净背景，避免错误商品结构和无关道具。",
  person: "人物肖像：明确人物身份、年龄气质、姿态表情、服装妆发、背景关系、镜头焦段、光线和皮肤/织物质感，保护身份一致性。",
  photo: "摄影与写实：明确拍摄类型、镜头焦段、机位、景深、光线方向、时间天气、胶片/商业摄影质感和真实纹理。",
  scene: "场景与叙事：明确地点、时代/时间、空间层次、人物行动、情绪、叙事冲突、前中后景和镜头调度。",
  object: "产品或物体：明确外观形态、比例、材质、颜色、摆放方式、接触阴影、背景干净度和细节特写。",
  brand: "品牌与标志：明确品牌识别、Logo/VI、主辅色、触点系统、应用场景和调性一致性，避免官方商标误用和无关文字。",
  architecture: "建筑与空间：明确建筑/室内类型、透视、空间布局、材质、光线、尺度人物、室内外关系和氛围。",
  illustration: "插画与艺术：明确画风、笔触、媒介材质、线条/色块、构图、装饰元素和艺术参考，保持主体识别清晰。",
  character: "人物与角色：明确角色设定、年龄身份、服装道具、动作表情、三视图/卡牌/玩具等输出形式和一致性约束。",
  publication: "文档与出版物：明确页面系统、标题层级、目录/章节/图注、网格、页边距、纸张质感和中文可读性。",
  other: "通用图像：按主体、参考图、构图、风格、光线、材质、色彩、文字、约束的顺序补足，不添加冲突元素。",
};

export function buildPromptAssistInstruction(input: PromptAssistInput): string {
  if (input.engine === "skill2") return buildSkill2PromptAssistInstruction(input);
  return buildStandardPromptAssistInstruction(input);
}

function buildStandardPromptAssistInstruction(input: PromptAssistInput): string {
  const originalPrompt = input.prompt.trim();
  const outputShape =
    input.action === "variations"
      ? '{"variations":["提示词变体 1","提示词变体 2","提示词变体 3"],"notes":["说明调整依据"]}'
      : '{"prompt":"处理后的完整提示词","notes":["说明调整依据"]}';

  return [
    "你是一名专业的中文 AI 图像提示词助手。",
    "方法论：参考 GPT Image 2 Prompt-as-Code 思路，把散文式需求重写成结构化、可控、可复用的生成协议。",
    `任务：${actionGuidance[input.action]}`,
    `图片类型指导：${imageTypeGuidance[input.imageType]}`,
    input.artStyle && input.artStyle !== "auto"
      ? [
          `风格锁定：当前画板风格选择为「${input.artStyleLabel || input.artStyle}」。`,
          input.artStyleInstruction ? `最终生成阶段会统一追加这条画风要求：「${input.artStyleInstruction}」` : "",
          "你只优化主体、构图、参考图关系、材质、光线、文字和约束，不要自行新增、替换或混入其他画风、媒介、流派、艺术家或时代风格。",
          "输出提示词中不要重复写入“画风要求”段落，避免与画板风格选择叠加冲突。",
        ].filter(Boolean).join("\n")
      : "风格处理：用户没有锁定具体画风时，可按图片类型补充必要的风格或媒介描述，但不要过度堆叠互相冲突的风格。",
    "推荐结构：",
    "- 输出类型/画面目标：一句话定义最终图像是什么。",
    "- 主体与关键对象：列清主体、数量、外观、动作、关系和不能改变的身份特征。",
    "- 参考图使用规则：如有参考图，写明每张参考图分别约束主体、五官、服装、商品、Logo、背景、构图、风格等，不要把参考图混成同一对象。",
    "- 构图与版式：明确画幅比例、视角、前中后景、视觉焦点、留白、网格/模块/标题层级。",
    "- 风格与媒介：明确写实摄影、商业广告、UI 截图、信息图、插画、海报、出版物等风格。",
    "- 光线、色彩、材质：明确主光、补光、环境光、主辅色、材质纹理、阴影和反射。",
    "- 文字与信息：若画面含文字，必须指定精确文案、层级和可读性；若不需要文字，明确不要生成额外文字。",
    "- 质量与负向约束：写出避免项，如乱码、错字、杂乱拼贴、错误器材、无关 Logo、脸部崩坏、结构不一致。",
    "要求：",
    "- 保留用户原始意图、主体和关键限制，不擅自替换业务目标。",
    "- 输出应具体、可执行，适合直接交给图像生成模型。",
    "- 如果提供了参考图角色或标记，必须把这些参考关系改写进提示词，说明哪些元素来自哪类参考图。",
    "- 对 UI、信息图、海报、文档等含文字场景，优先使用短文案和清晰层级，强调文字必须准确可读。",
    "- 对摄影、人物、商品和空间场景，优先补充镜头、光线、材质、比例和真实物理关系。",
    "- 不要输出模板占位符、不要输出未替换的方括号字段。",
    "- 避免解释模型能力、避免输出 Markdown、避免额外寒暄。",
    input.referenceContext
      ? ["参考图标记：", "<<<REFERENCE_CONTEXT", input.referenceContext.trim(), "REFERENCE_CONTEXT>>>"].join("\n")
      : "",
    "用户原始提示词：",
    "<<<USER_PROMPT",
    originalPrompt,
    "USER_PROMPT>>>",
    `只输出 JSON，格式为：${outputShape}`,
  ].join("\n");
}

function buildSkill2PromptAssistInstruction(input: PromptAssistInput): string {
  const originalPrompt = input.prompt.trim();
  const outputShape =
    input.action === "variations"
      ? '{"variations":["提示词变体 1","提示词变体 2","提示词变体 3"],"notes":["说明调整依据","可复用变量建议"]}'
      : '{"prompt":"处理后的完整提示词","notes":["说明调整依据","可复用变量建议"]}';

  return [
    "你是一名专业的中文 AI 图像提示词工程师，当前模式是“辅助提示词2”。",
    "方法论：吸收 PromptSkill4image 的需求路由、复杂度分层和变量词库思路，但输出必须适配本项目的 GPT Image 2 / OpenAI-compatible Images API，不输出 Midjourney 参数、Stable Diffusion 标签串或未解释的模型尾缀。",
    `任务：${actionGuidance[input.action]}`,
    `图片类型指导：${imageTypeGuidance[input.imageType]}`,
    "需求路由：",
    "- 如果输入是短关键词或粗糙想法，先推断图像目标，再补足主体、场景、构图、风格、光线、材质、文字和约束。",
    "- 如果输入已经是完整提示词，只重组层级、强化可执行细节，不改写核心主体和业务目标。",
    "- 如果输入像中英混合或翻译需求，保留专有名词，转成自然、具体、模型易理解的中文提示词。",
    "- 如果输入适合模板复用，在 notes 中给出可替换变量建议，但不要在 prompt 字段里留下占位符。",
    "复杂度层级：",
    "- 极简增强版：补齐最少但关键的主体、构图和画质要求，适合快速生成。",
    "- 平衡增强版：默认采用这一层，加入风格、镜头、光线、材质、色彩、参考图关系和负向约束。",
    "- 高级结构化版：仅当用户需求复杂、包含商业海报/UI/信息图/多参考图/多主体关系时使用，明确模块、层级和执行规则。",
    "变量建议：",
    "- notes 可列出 2-5 个可复用变量，例如主体、场景、风格、光线、色彩、镜头、材质、比例、文字文案。",
    "- 变量建议必须服务于用户当前提示词，不要泛泛罗列词库。",
    input.artStyle && input.artStyle !== "auto"
      ? [
          `风格锁定：当前画板风格选择为「${input.artStyleLabel || input.artStyle}」。`,
          input.artStyleInstruction ? `最终生成阶段会统一追加这条画风要求：「${input.artStyleInstruction}」` : "",
          "不要自行新增、替换或混入其他画风、媒介、流派、艺术家或时代风格；只优化主体、构图、参考图关系、材质、光线、文字和约束。",
        ].filter(Boolean).join("\n")
      : "风格处理：可根据图片类型选择一个清晰风格方向，但避免堆叠互相冲突的风格词。",
    "输出提示词结构建议：",
    "- 画面目标：最终图像是什么，服务什么用途。",
    "- 主体与关系：主体数量、外观、动作、身份、产品/角色一致性。",
    "- 参考图规则：如有参考图，逐一说明每张图约束什么，不要混成一个对象。",
    "- 构图与视觉层级：画幅、视角、焦点、留白、前中后景、版式模块。",
    "- 风格、光线、材质、色彩：使用具体可观察描述，不堆空泛形容词。",
    "- 文字与负向约束：需要文字就给精确文案，不需要文字就明确不要额外文字；列出错字、乱码、结构错误、无关 Logo 等避免项。",
    "硬性要求：",
    "- 保留用户原始意图，不擅自替换主体、业务目标或参考图标记。",
    "- prompt 字段必须是一条可直接使用的完整提示词，不输出 Markdown，不输出解释段落。",
    "- notes 只写简短依据和变量建议。",
    input.referenceContext
      ? ["参考图标记：", "<<<REFERENCE_CONTEXT", input.referenceContext.trim(), "REFERENCE_CONTEXT>>>"].join("\n")
      : "",
    "用户原始提示词：",
    "<<<USER_PROMPT",
    originalPrompt,
    "USER_PROMPT>>>",
    `只输出 JSON，格式为：${outputShape}`,
  ].join("\n");
}

export function cleanPromptAssistText(value: string): string {
  let text = value.trim();
  const fenceMatch = text.match(/^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```$/i);

  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
    ["“", "”"],
    ["‘", "’"],
  ];

  let changed = true;
  while (changed) {
    changed = false;
    text = text.trim();

    for (const [start, end] of quotePairs) {
      if (text.startsWith(start) && text.endsWith(end) && text.length >= start.length + end.length) {
        text = text.slice(start.length, text.length - end.length).trim();
        changed = true;
      }
    }
  }

  return text;
}

export function parsePromptAssistOutput(action: PromptAssistAction, value: string): PromptAssistOutput {
  const cleaned = cleanPromptAssistText(value);
  const fallback = parsePlainTextFallback(action, cleaned);

  try {
    const parsed: unknown = JSON.parse(cleaned);

    if (!isRecord(parsed)) {
      return emptyParsedOutput();
    }

    const notes = cleanStringArray(parsed.notes);

    if (action === "variations") {
      const variations = cleanStringArray(parsed.variations).slice(0, 3);

      return {
        prompt: "",
        variations,
        notes,
      };
    }

    return {
      prompt: typeof parsed.prompt === "string" ? cleanPromptAssistText(parsed.prompt) : "",
      variations: [],
      notes,
    };
  } catch {
    return fallback;
  }
}

function parsePlainTextFallback(action: PromptAssistAction, value: string): PromptAssistOutput {
  if (action === "variations") {
    return {
      prompt: "",
      variations: value
        .split(/\r?\n/)
        .map((line) => cleanPromptAssistText(line.replace(/^\s*(?:[-*]|\d+[.)、])\s*/, "")))
        .filter((line) => line.length > 0)
        .slice(0, 3),
      notes: [],
    };
  }

  return {
    prompt: value,
    variations: [],
    notes: [],
  };
}

function emptyParsedOutput(): PromptAssistOutput {
  return {
    prompt: "",
    variations: [],
    notes: [],
  };
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => cleanPromptAssistText(item))
    .filter((item) => item.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
