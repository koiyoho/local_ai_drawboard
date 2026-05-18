import { z } from "zod";

export const migrationModeSchema = z.enum(["none", "reversible", "manual_required"]);

export const updateManifestSchema = z.object({
  channel: z.string().trim().min(1),
  commit: z.string().trim().min(1),
  migrationMode: migrationModeSchema,
  minVersion: z.string().trim().min(1).optional(),
  packageUrl: z.string().url(),
  publishedAt: z.string().trim().min(1).optional(),
  releaseNotes: z.string().optional(),
  sha256: z.string().trim().regex(/^[a-fA-F0-9]{64}$/, "sha256 must be a 64 character hex digest"),
  signature: z.string().optional(),
  version: z.string().trim().min(1),
});

export const deployPackageFileSchema = z.object({
  path: z.string().trim().min(1),
  sha256: z.string().trim().regex(/^[a-fA-F0-9]{64}$/, "sha256 must be a 64 character hex digest"),
  size: z.number().int().nonnegative(),
});

export const deployPackageManifestSchema = z.object({
  appName: z.literal("tldraw-ai-board"),
  channel: z.string().trim().min(1),
  commit: z.string().trim().min(1),
  entrypoint: z.string().trim().min(1),
  files: z.array(deployPackageFileSchema).min(1),
  migrationMode: migrationModeSchema,
  version: z.string().trim().min(1),
});

export type MigrationMode = z.infer<typeof migrationModeSchema>;
export type UpdateManifest = z.infer<typeof updateManifestSchema>;
export type DeployPackageManifest = z.infer<typeof deployPackageManifestSchema>;

export function parseDeployPackageManifest(value: unknown) {
  return deployPackageManifestSchema.parse(value);
}

export function parseUpdateManifest(value: unknown) {
  return updateManifestSchema.parse(value);
}
