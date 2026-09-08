import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkerState } from "../src/state.js";
import type { WorkerTask } from "../src/types.js";

function task(id: string): WorkerTask {
  return {
    id,
    projectId: "project-1",
    threadId: "thread-1",
    messageId: "message-1",
    agent: "codex",
    action: "suggest",
    request: "Improve this paragraph.",
  };
}

test("claims messages atomically and keeps sessions agent-specific", () => {
  const directory = mkdtempSync(join(tmpdir(), "jujuleaf-worker-state-"));
  const state = new WorkerState(join(directory, "nested", "state.sqlite3"));
  try {
    assert.equal(state.claimTask(task("task-1")), true);
    assert.equal(state.claimTask(task("task-2")), false);
    assert.equal(state.hasMessage("project-1", "message-1"), true);

    state.setSession("project-1", "thread-1", "codex-session", "codex");
    state.setSession("project-1", "thread-1", "kimi-session", "kimi");
    assert.equal(
      state.getSession("project-1", "thread-1", "codex"),
      "codex-session",
    );
    assert.equal(
      state.getSession("project-1", "thread-1", "kimi"),
      "kimi-session",
    );
  } finally {
    state.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("makes interrupted messages claimable after restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "jujuleaf-worker-recovery-"));
  const state = new WorkerState(join(directory, "state.sqlite3"));
  try {
    assert.equal(state.claimTask(task("task-1")), true);
    state.updateTask("task-1", "running");
    assert.equal(state.recoverInterruptedTasks(), 1);
    assert.equal(state.hasMessage("project-1", "message-1"), false);
    assert.equal(state.claimTask(task("task-2")), true);
    const row = state.database
      .prepare("SELECT status FROM tasks WHERE task_id = ?")
      .get("task-1") as { status: string };
    assert.equal(row.status, "interrupted");
  } finally {
    state.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
