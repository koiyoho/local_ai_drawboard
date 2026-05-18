import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const rolesSource = readFileSync(join(root, "src/lib/reference-roles.ts"), "utf8");
const boardSource = readFileSync(join(root, "src/components/BoardWorkspace.tsx"), "utf8");
const routeSource = readFileSync(join(root, "server/routes/generation-jobs.ts"), "utf8");

const requiredRoleValues = [
  "face",
  "hair",
  "makeup",
  "body",
  "top",
  "bottom",
  "dress",
  "shoes",
  "bag",
  "hat",
  "accessory",
  "scene",
  "action",
  "composition",
];

const requiredRoleLabels = [
  "五官脸型",
  "发型发色",
  "妆容参考",
  "身形比例",
  "上衣参考",
  "下装参考",
  "连衣裙参考",
  "鞋子参考",
  "包包参考",
  "帽子参考",
  "配饰参考",
  "场景参考",
  "动作姿势",
  "构图机位",
];

for (const role of requiredRoleValues) {
  assertIncludes(rolesSource, `"${role}"`, `reference role value ${role}`);
}

for (const label of requiredRoleLabels) {
  assertIncludes(rolesSource, label, `reference role label ${label}`);
}

assertIncludes(boardSource, "referenceRoleInstruction", "frontend prompt uses shared role instruction");
assertIncludes(routeSource, "referenceRoleValues", "API schema uses shared role values");
assertIncludes(routeSource, "isReferenceRole", "API schema validates roles through shared guard");

function assertIncludes(source, needle, label) {
  if (!source.includes(needle)) {
    throw new Error(`Missing ${label}`);
  }
}
