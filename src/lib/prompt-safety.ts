export type PromptSafetyMode = "standard" | "strict";

export type PromptSafetyOptimization = {
  applied: boolean;
  mode: PromptSafetyMode;
  prompt: string;
  reasons: string[];
};

type ReplacementRule = {
  pattern: RegExp;
  reason: string;
  replacement: string;
};

const highRiskReplacementRules: ReplacementRule[] = [
  { pattern: /性感女仆装/g, replacement: "优雅女仆角色设计", reason: "replaced_high_risk_terms" },
  { pattern: /性感美女/g, replacement: "拥有成熟女性魅力的成年女性角色", reason: "added_adult_age_guard" },
  { pattern: /性感/g, replacement: "成熟女性魅力", reason: "replaced_high_risk_terms" },
  { pattern: /火辣/g, replacement: "高级时尚表现力", reason: "replaced_high_risk_terms" },
  { pattern: /撩人/g, replacement: "自信从容", reason: "replaced_high_risk_terms" },
  { pattern: /魅惑/g, replacement: "眼神有故事感", reason: "replaced_high_risk_terms" },
  { pattern: /诱惑/g, replacement: "神情温柔安静", reason: "replaced_high_risk_terms" },
  { pattern: /挑逗/g, replacement: "神情温柔安静", reason: "replaced_high_risk_terms" },
  { pattern: /身材火辣/g, replacement: "身体比例自然协调", reason: "replaced_body_part_emphasis" },
  { pattern: /身材好|曲线好/g, replacement: "健康丰腴、自然流畅的身体曲线", reason: "replaced_body_part_emphasis" },
  { pattern: /胸大/g, replacement: "上半身轮廓自然饱满", reason: "replaced_body_part_emphasis" },
  { pattern: /翘臀/g, replacement: "体态圆润匀称", reason: "replaced_body_part_emphasis" },
  { pattern: /细腰/g, replacement: "腰部自然收束", reason: "replaced_body_part_emphasis" },
  { pattern: /S\s*型曲线|S型曲线|夸张身材/g, replacement: "身体比例自然协调", reason: "replaced_body_part_emphasis" },
  { pattern: /低机位(?:拍摄)?/g, replacement: "时尚杂志人像构图、自然视角", reason: "replaced_risky_camera_or_scene" },
  { pattern: /湿身(?:诱惑)?/g, replacement: "柔和光影", reason: "replaced_risky_camera_or_scene" },
  { pattern: /暧昧氛围|暧昧/g, replacement: "干净克制的高级室内场景", reason: "replaced_risky_camera_or_scene" },
  { pattern: /暴露/g, replacement: "得体自然", reason: "replaced_revealing_clothing" },
  { pattern: /超短裙/g, replacement: "服装剪裁合身、质感高级", reason: "replaced_revealing_clothing" },
  { pattern: /贴身特写/g, replacement: "服装质感清晰、整体人像构图", reason: "replaced_revealing_clothing" },
  { pattern: /湿\s*T\s*恤/gi, replacement: "质感高级的合身上装", reason: "replaced_revealing_clothing" },
  { pattern: /比基尼特写/g, replacement: "简约时尚泳装造型", reason: "replaced_revealing_clothing" },
];

const minorAdultConflictRules: ReplacementRule[] = [
  { pattern: /可爱小女孩/g, replacement: "20岁成年女性角色，气质清新优雅", reason: "removed_minor_adult_conflict" },
  { pattern: /小女孩/g, replacement: "20岁成年女性角色", reason: "removed_minor_adult_conflict" },
  { pattern: /少女/g, replacement: "成年女性角色", reason: "removed_minor_adult_conflict" },
  { pattern: /萝莉/g, replacement: "成年女性角色，避免幼态化", reason: "removed_minor_adult_conflict" },
  { pattern: /幼态/g, replacement: "成熟自然的成年女性脸型", reason: "removed_minor_adult_conflict" },
];

const adultSubjectPattern = /成年|成人|20岁|2[0-9]岁|3[0-9]岁|女性|女人|女士|人物|角色|人像|女/;
const riskPattern = /性感|诱惑|挑逗|火辣|撩人|魅惑|胸大|翘臀|细腰|S\s*型曲线|S型曲线|夸张身材|低机位|湿身|暧昧|暴露|超短裙|贴身特写|女仆|小女孩|少女|萝莉|幼态/;
const bodyAestheticPattern = /自然流畅的身体曲线|身体比例自然协调|健康丰腴/;
const safetyConstraintPattern = /整体回到高级商业人像和角色设计表达/;

const standardSafetySuffix = [
  "整体回到高级商业人像和角色设计表达，减少身体暴露，减少暧昧氛围，强调服装、光影、姿态和人物气质。",
  "避免低俗性感、避免夸张暴露、避免幼态化、避免儿童感、避免暧昧氛围、避免低机位、避免湿身诱惑。",
  "身体比例自然协调，四肢自然，手指数量正确，画面干净高级。",
].join(" ");

const strictSafetySuffix = [
  standardSafetySuffix,
  "人物必须是成年女性，不幼态、不儿童化；五官成熟自然，气质温柔自信。",
  "画面保持干净克制的商业质感，姿态舒展优雅，不使用私密、挑逗或擦边写真表达。",
].join(" ");

export function optimizePromptSafety(prompt: string, options: { mode?: PromptSafetyMode } = {}): PromptSafetyOptimization {
  const mode = options.mode ?? "standard";
  const originalPrompt = normalizePromptSpacing(prompt);
  if (!originalPrompt) {
    return { applied: false, mode, prompt: originalPrompt, reasons: [] };
  }

  const reasons: string[] = [];
  let optimizedPrompt = originalPrompt;

  for (const rule of [...minorAdultConflictRules, ...highRiskReplacementRules]) {
    if (rule.pattern.test(optimizedPrompt)) {
      optimizedPrompt = optimizedPrompt.replace(rule.pattern, rule.replacement);
      reasons.push(rule.reason);
    }
  }

  const hasRisk = riskPattern.test(originalPrompt);
  const isPersonPrompt = adultSubjectPattern.test(originalPrompt) || adultSubjectPattern.test(optimizedPrompt);
  if (hasRisk && isPersonPrompt && !/成年女性|20岁成年女性|成年人物/.test(optimizedPrompt)) {
    optimizedPrompt = `一位成年女性角色，${optimizedPrompt}`;
    reasons.push("added_adult_age_guard");
  }

  if (hasRisk && isPersonPrompt && !bodyAestheticPattern.test(optimizedPrompt)) {
    optimizedPrompt = `${optimizedPrompt}，拥有健康丰腴的身材和自然流畅的身体曲线，身体比例自然协调`;
    reasons.push("added_body_aesthetic_language");
  }

  if (hasRisk && !/高级商业人像|高级时尚杂志人像|时尚杂志人像/.test(optimizedPrompt)) {
    optimizedPrompt = `${optimizedPrompt}，画面采用高级时尚杂志人像风格，柔和光影，干净背景，整体克制、精致、有商业质感`;
    reasons.push("added_clean_commercial_tone");
  }

  if ((hasRisk || mode === "strict") && !safetyConstraintPattern.test(optimizedPrompt)) {
    optimizedPrompt = `${optimizedPrompt}。${mode === "strict" ? strictSafetySuffix : standardSafetySuffix}`;
    reasons.push(mode === "strict" ? "added_strict_constraints" : "added_safety_constraints");
  }

  optimizedPrompt = normalizePromptSpacing(optimizedPrompt);
  const uniqueReasons = Array.from(new Set(reasons));

  return {
    applied: optimizedPrompt !== originalPrompt,
    mode,
    prompt: optimizedPrompt,
    reasons: uniqueReasons,
  };
}

function normalizePromptSpacing(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/，+/g, "，")
    .replace(/。+/g, "。")
    .replace(/，。/g, "。")
    .trim();
}
