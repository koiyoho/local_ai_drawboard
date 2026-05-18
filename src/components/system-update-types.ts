export type CurrentVersionPayload = {
  buildTime: string | null;
  commit: string | null;
  updateChannel: string;
  variant: string;
  version: string;
};

export type UpdateManifestPayload = {
  channel: string;
  commit?: string;
  migrationMode: "none" | "reversible" | "manual_required";
  packageUrl: string;
  publishedAt?: string;
  releaseNotes?: string;
  sha256: string;
  version: string;
};

export type UpdateCheckPayload = {
  configured: boolean;
  current: CurrentVersionPayload;
  manifest: UpdateManifestPayload | null;
  reason?: string;
  updateAvailable: boolean;
};

export type UpdateJobPayload = {
  channel: string;
  error?: string;
  failureReason?: string;
  fromVersion: string;
  id: string;
  message: string;
  rollbackStatus: string;
  status: string;
  step: string;
  toVersion: string;
  updatedAt: string;
};

export type UpdateJobResponse = {
  job: UpdateJobPayload;
};
