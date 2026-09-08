import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CodexClient, progressFromCodexEvent } from "../src/codex.js";

function mockCodex(directory: string): string {
  const executable = join(directory, "mock-codex.mjs");
  const source = [
    "#!/usr/bin/env node",
    "import { writeFileSync } from 'node:fs';",
    "const args = process.argv.slice(2);",
    "const chunks = [];",
    "for await (const chunk of process.stdin) chunks.push(chunk);",
    "const prompt = Buffer.concat(chunks).toString('utf8');",
    "const taskId = /\\\"taskId\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"/.exec(prompt)?.[1] ?? 'missing';",
    "const outputIndex = args.indexOf('--output-last-message');",
    "writeFileSync(args[outputIndex + 1], JSON.stringify({ schemaVersion: 1, taskId, status: 'no_changes', summary: 'Mock completed.', changedFiles: [], validation: [], question: null, warnings: [] }));",
    "writeFileSync(new URL('.mock-codex-args.json', 'file://' + process.cwd() + '/'), JSON.stringify(args));",
    "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'session-123' }));",
    "console.log(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution' } }));",
    "console.log(JSON.stringify({ type: 'turn.completed' }));",
  ].join("\n");
  writeFileSync(executable, source);
  chmodSync(executable, 0o755);
  return executable;
}

test("maps Codex JSONL events to safe progress stages", () => {
  assert.equal(progressFromCodexEvent({ type: "thread.started" })?.phase, "analyzing");
  assert.equal(
    progressFromCodexEvent({
      type: "item.completed",
      item: { type: "command_execution" },
    })?.phase,
    "validating",
  );
  assert.equal(progressFromCodexEvent({ type: "unknown" }), undefined);
});

test("runs and resumes Codex with a structured output schema", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jujuleaf-worker-codex-"));
  try {
    const client = new CodexClient(mockCodex(directory));
    const progress: string[] = [];
    const sessions: string[] = [];
    const first = await client.run({
      cwd: directory,
      prompt: '{ "taskId": "task-1" }',
      profile: "writing",
      onProgress: (item) => progress.push(item.phase),
      onSession: (sessionId) => sessions.push(sessionId),
    });
    assert.equal(first.result.taskId, "task-1");
    assert.equal(first.sessionId, "session-123");
    assert.deepEqual(sessions, ["session-123"]);
    assert.deepEqual(progress, ["analyzing", "validating", "finalizing"]);

    const firstArgs = JSON.parse(
      readFileSync(join(directory, ".mock-codex-args.json"), "utf8"),
    ) as string[];
    assert.deepEqual(firstArgs.slice(0, 4), [
      "--approve-for-me",
      "-C",
      directory,
      "--profile",
    ]);
    assert(firstArgs.includes("--output-schema"));

    await client.run({
      cwd: directory,
      prompt: '{ "taskId": "task-2" }',
      sessionId: "session-existing",
    });
    const resumeArgs = JSON.parse(
      readFileSync(join(directory, ".mock-codex-args.json"), "utf8"),
    ) as string[];
    assert(resumeArgs.indexOf("--json") < resumeArgs.indexOf("session-existing"));
    assert.equal(resumeArgs[resumeArgs.indexOf("resume") + 1], "--json");
    assert.equal(resumeArgs.at(-1), "-");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
