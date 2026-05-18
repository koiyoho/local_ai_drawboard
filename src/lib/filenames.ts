const fallbackProjectName = "未命名项目";

export function createProjectTimestampFilename(
  projectName: string,
  extension: string,
  options?: { date?: Date; index?: number; username?: string | null },
) {
  const safeProjectName = sanitizeFilenameSegment(projectName) || fallbackProjectName;
  const safeUsername = options?.username ? sanitizeFilenameSegment(options.username) : "";
  const timestamp = formatDateTimeNumber(options?.date ?? new Date());
  const indexSuffix =
    typeof options?.index === "number" ? `_${String(options.index + 1).padStart(2, "0")}` : "";
  const prefix = safeUsername ? `${safeUsername}_` : "";
  return `${prefix}${safeProjectName}_${timestamp}${indexSuffix}.${normalizeExtension(extension)}`;
}

export function formatDateTimeNumber(date: Date) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

export function getImageExtension(mimeType: string, filename?: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  const extension = filename?.split(".").at(-1);
  return extension ? normalizeExtension(extension) : "png";
}

export function normalizeStorageFilename(filename: string, fallbackExtension: string) {
  const baseName = filename.split(/[\\/]/).at(-1)?.trim() || fallbackProjectName;
  const dotIndex = baseName.lastIndexOf(".");
  const rawName = dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName;
  const rawExtension = dotIndex > 0 ? baseName.slice(dotIndex + 1) : fallbackExtension;
  return `${sanitizeFilenameSegment(rawName) || fallbackProjectName}.${normalizeExtension(rawExtension)}`;
}

export function sanitizeFilenameSegment(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function normalizeExtension(extension: string) {
  return extension.replace(/^\.+/, "").toLowerCase() || "png";
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
