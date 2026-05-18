export const referenceRoleOptions = [
  { value: "subject", label: "主体人物" },
  { value: "face", label: "五官脸型" },
  { value: "hair", label: "发型发色" },
  { value: "makeup", label: "妆容" },
  { value: "body", label: "身形比例" },
  { value: "clothing", label: "整体服装" },
  { value: "top", label: "上衣" },
  { value: "bottom", label: "下装" },
  { value: "dress", label: "连衣裙" },
  { value: "outerwear", label: "外套" },
  { value: "fabric", label: "面料纹理" },
  { value: "colorPalette", label: "配色" },
  { value: "shoes", label: "鞋子" },
  { value: "bag", label: "包包" },
  { value: "hat", label: "帽子" },
  { value: "accessory", label: "配饰" },
  { value: "product", label: "商品" },
  { value: "logo", label: "Logo" },
  { value: "material", label: "材质" },
  { value: "packaging", label: "包装" },
  { value: "scene", label: "场景" },
  { value: "background", label: "背景" },
  { value: "action", label: "动作姿势" },
  { value: "composition", label: "构图机位" },
  { value: "lighting", label: "光线" },
  { value: "camera", label: "镜头" },
  { value: "style", label: "风格" },
  { value: "mood", label: "氛围" },
] as const;

export type ReferenceRole = (typeof referenceRoleOptions)[number]["value"];

export const referenceRoleValues = referenceRoleOptions.map((option) => option.value) as [
  ReferenceRole,
  ...ReferenceRole[],
];

export const referenceRoleInstruction =
  "subject, face, hair, makeup, body, clothing, top, bottom, dress, outerwear, fabric, colorPalette, shoes, bag, hat, accessory, product, logo, material, packaging, scene, background, action, composition, lighting, camera, style, or mood";

export function isReferenceRole(value: unknown): value is ReferenceRole {
  return typeof value === "string" && referenceRoleValues.includes(value as ReferenceRole);
}
