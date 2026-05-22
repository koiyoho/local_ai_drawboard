const terminalUpdateJobStatuses = new Set(["completed", "failed", "rolled_back"]);

export type UpdateJobStatusSnapshot = {
  id: string;
  status: string;
};

export function isTerminalUpdateJobStatus(status: string) {
  return terminalUpdateJobStatuses.has(status);
}

export function shouldSurfaceUpdatePollingError(currentJob: UpdateJobStatusSnapshot | null, polledJobId: string) {
  if (!currentJob) return true;
  if (currentJob.id !== polledJobId) return false;
  return !isTerminalUpdateJobStatus(currentJob.status);
}

export function formatUpdateError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (message === "Another update job is already active") {
    return "已有升级任务正在执行，请等待当前升级完成";
  }
  return message || fallback;
}
