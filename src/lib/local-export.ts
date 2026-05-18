import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { normalizeStorageFilename, sanitizeFilenameSegment } from "@/lib/filenames";

const exportRoot = path.join(process.cwd(), "local-exports");
const generatedArchiveRoot = path.join(process.cwd(), "generated-images");

export async function saveLocalExport(input: {
  bytes: Buffer;
  filename: string;
  projectName: string;
}) {
  const projectDirName = sanitizeFilenameSegment(input.projectName) || "未命名项目";
  const filename = normalizeStorageFilename(input.filename, "png");
  const targetDir = path.join(exportRoot, projectDirName);
  const targetPath = path.join(targetDir, filename);
  const relativePath = path.relative(exportRoot, targetPath);

  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Invalid local export path");
  }

  await mkdir(targetDir, { recursive: true });
  await writeFile(targetPath, input.bytes);

  return {
    absolutePath: targetPath,
    relativePath: path.relative(process.cwd(), targetPath),
  };
}

export async function saveGeneratedImageArchive(input: {
  bytes: Buffer;
  filename: string;
  username: string;
}) {
  const userDirName = sanitizeFilenameSegment(input.username) || "unknown-user";
  const filename = normalizeStorageFilename(input.filename, "png");
  const targetDir = path.join(generatedArchiveRoot, userDirName);
  const targetPath = path.join(targetDir, filename);
  const relativePath = path.relative(generatedArchiveRoot, targetPath);

  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Invalid generated image archive path");
  }

  await mkdir(targetDir, { recursive: true });
  await writeFile(targetPath, input.bytes);

  return {
    absolutePath: targetPath,
    relativePath: path.relative(process.cwd(), targetPath),
  };
}

export async function deleteGeneratedImageArchive(username: string | null) {
  if (!username) {
    return;
  }
  const userDirName = sanitizeFilenameSegment(username);
  if (!userDirName) {
    return;
  }
  const targetPath = path.join(generatedArchiveRoot, userDirName);
  const relativePath = path.relative(generatedArchiveRoot, targetPath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Invalid generated image archive path");
  }
  await rm(targetPath, { force: true, recursive: true });
}
