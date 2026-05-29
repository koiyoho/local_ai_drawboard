import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { formatUpdateError, isTerminalUpdateJobStatus, shouldSurfaceUpdatePollingError } from "./system-update-ui";

const systemUpdatePanelSource = readFileSync("src/components/SystemUpdatePanel.tsx", "utf8");

test("isTerminalUpdateJobStatus recognizes finished update jobs", () => {
  assert.equal(isTerminalUpdateJobStatus("completed"), true);
  assert.equal(isTerminalUpdateJobStatus("failed"), true);
  assert.equal(isTerminalUpdateJobStatus("rolled_back"), true);
  assert.equal(isTerminalUpdateJobStatus("health_checking"), false);
});

test("shouldSurfaceUpdatePollingError ignores stale polling failures after completion", () => {
  assert.equal(
    shouldSurfaceUpdatePollingError({ id: "job-1", status: "completed" }, "job-1"),
    false,
  );
});

test("shouldSurfaceUpdatePollingError keeps active job failures visible", () => {
  assert.equal(
    shouldSurfaceUpdatePollingError({ id: "job-1", status: "health_checking" }, "job-1"),
    true,
  );
});

test("shouldSurfaceUpdatePollingError ignores failures from stale job requests", () => {
  assert.equal(
    shouldSurfaceUpdatePollingError({ id: "job-2", status: "queued" }, "job-1"),
    false,
  );
});

test("formatUpdateError explains active update jobs in local wording", () => {
  assert.equal(
    formatUpdateError(new Error("Another update job is already active"), "启动升级失败"),
    "已有升级任务正在执行，请等待当前升级完成",
  );
  assert.equal(formatUpdateError(new Error("custom error"), "fallback"), "custom error");
  assert.equal(formatUpdateError(null, "fallback"), "fallback");
});

test("system update panel can reapply the current release package", () => {
  assert.match(systemUpdatePanelSource, /canReapplyCurrent/);
  assert.match(systemUpdatePanelSource, /重新应用当前发布包/);
  assert.match(systemUpdatePanelSource, /forceReapply:\s*true/);
});
