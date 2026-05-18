import assert from "node:assert/strict";
import test from "node:test";

import { isTerminalUpdateJobStatus, shouldSurfaceUpdatePollingError } from "./system-update-ui";

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
