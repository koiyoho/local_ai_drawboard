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
