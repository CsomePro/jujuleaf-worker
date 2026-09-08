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
import { KimiClient, progressFromKimiEvent } from "../src/kimi.js";

function mockKimi(directory: string): string {
  const executable = join(directory, "mock-kimi.mjs");
  const source = [
    "#!/usr/bin/env node",
    "import { writeFileSync } from 'node:fs';",
    "const args = process.argv.slice(2);",
    "if (args[0] === '--version') { console.log('0.37.2'); process.exit(0); }",
    "if (args[0] === '--help') { console.log('--session --prompt --output-format stream-json'); process.exit(0); }",
    "const prompt = args[args.indexOf('--prompt') + 1];",
    "const taskId = /\\\"taskId\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"/.exec(prompt)?.[1] ?? 'missing';",
    "const result = { schemaVersion: 1, taskId, status: 'no_changes', summary: 'Mock Kimi completed.', changedFiles: [], validation: [], question: null, warnings: [] };",
    "writeFileSync(new URL('.mock-kimi-args.json', 'file://' + process.cwd() + '/'), JSON.stringify(args));",
    "console.log(JSON.stringify({ role: 'meta', type: 'system.version', version: '0.37.2' }));",
    "console.log(JSON.stringify({ role: 'assistant', content: 'Checking.', tool_calls: [{ type: 'function', function: { name: 'Shell', arguments: '{}' } }] }));",
    "console.log(JSON.stringify({ role: 'tool', tool_call_id: 'tool-1', content: 'ok' }));",
    "console.log(JSON.stringify({ role: 'assistant', content: '```json\\n' + JSON.stringify(result) + '\\n```' }));",
    "console.log(JSON.stringify({ role: 'meta', type: 'session.resume_hint', session_id: 'session-kimi-1' }));",
  ].join("\n");
  writeFileSync(executable, source);
  chmodSync(executable, 0o755);
  return executable;
}

test("maps Kimi Code JSONL messages to safe progress stages", () => {
  assert.equal(
    progressFromKimiEvent({
      role: "meta",
      type: "system.version",
      version: "0.37.2",
    })?.phase,
    "analyzing",
  );
  assert.equal(
    progressFromKimiEvent({
      role: "assistant",
      tool_calls: [{ function: { name: "WriteFile" } }],
    })?.phase,
    "editing",
  );
  assert.equal(
    progressFromKimiEvent({ role: "assistant", content: "Done." })?.phase,
    "finalizing",
  );
});

test("checks, runs, and resumes Kimi Code prompt mode", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jujuleaf-worker-kimi-"));
  try {
    const client = new KimiClient(mockKimi(directory));
    assert.equal(await client.check(directory), "0.37.2");
    const progress: string[] = [];
    const sessions: string[] = [];
    const first = await client.run({
      cwd: directory,
      prompt: '{ "taskId": "task-kimi-1" }',
      onProgress: (item) => progress.push(item.phase),
      onSession: (sessionId) => sessions.push(sessionId),
    });
    assert.equal(first.result.taskId, "task-kimi-1");
    assert.equal(first.sessionId, "session-kimi-1");
    assert.deepEqual(sessions, ["session-kimi-1"]);
    assert.deepEqual(progress, [
      "analyzing",
      "validating",
      "working",
      "finalizing",
    ]);

    await client.run({
      cwd: directory,
      prompt: '{ "taskId": "task-kimi-2" }',
      sessionId: "session-existing",
    });
    const args = JSON.parse(
      readFileSync(join(directory, ".mock-kimi-args.json"), "utf8"),
    ) as string[];
    assert.deepEqual(args.slice(0, 2), ["--session", "session-existing"]);
    assert(args.includes("--prompt"));
    assert(args.includes("stream-json"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
