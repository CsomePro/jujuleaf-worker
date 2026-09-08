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
import { JujuLeafClient } from "../src/bridge.js";

function mockJujuLeaf(directory: string): string {
  const executable = join(directory, "mock-jujuleaf.mjs");
  const source = [
    "#!/usr/bin/env node",
    "import { appendFileSync } from 'node:fs';",
    "let args = process.argv.slice(2);",
    "appendFileSync('.mock-jujuleaf-calls.jsonl', JSON.stringify(args) + '\\n');",
    "const commandIndex = args.findIndex((arg) => ['bridge', 'skill', 'comment', 'edit-comment'].includes(arg));",
    "args = args.slice(commandIndex);",
    "const protocol = { name: 'jujuleaf.bridge', version: 1 };",
    "const snapshot = { project: { id: 'project-1', name: 'Paper' }, documents: [], threads: [] };",
    "const context = { project: snapshot.project, documents: [], thread: { id: 'thread-1', state: 'open', messages: [], anchors: [] } };",
    "const envelope = (kind, operation, data) => ({ protocol, kind, operation, ok: true, data });",
    "if (args[0] === 'bridge' && args[1] === 'describe') {",
    "  console.log(JSON.stringify(envelope('result', 'describe', { protocol: { name: 'jujuleaf.bridge', supportedVersions: [1], defaultVersion: 1 }, binary: { version: '0.1.2' } })));",
    "} else if (args[0] === 'bridge' && args[2] === 'list') {",
    "  console.log(JSON.stringify(envelope('result', 'comments.list', snapshot)));",
    "} else if (args[0] === 'bridge' && args[2] === 'get') {",
    "  console.log(JSON.stringify(envelope('result', 'comments.get', context)));",
    "} else if (args[0] === 'bridge' && args[2] === 'watch') {",
    "  console.log(JSON.stringify({ ...envelope('stream.opened', 'comments.watch', { projectId: 'project-1' }), sessionId: 'stream-1', sequence: 1 }));",
    "  console.log(JSON.stringify({ ...envelope('comments.snapshot', 'comments.watch', { reason: 'initial', snapshot }), sessionId: 'stream-1', sequence: 2 }));",
    "  console.log(JSON.stringify({ ...envelope('stream.closed', 'comments.watch', { reason: 'test' }), sessionId: 'stream-1', sequence: 3 }));",
    "} else if (args[0] === 'skill' && args[1] === 'status') {",
    "  console.log(JSON.stringify({ skillVersion: '1', installations: [{ status: 'current', agents: ['codex'] }] }));",
    "} else if (args[0] === 'comment') {",
    "  console.log(JSON.stringify({ success: true, data: { message: { id: 'status-1' } } }));",
    "} else if (args[0] === 'edit-comment') {",
    "  console.log(JSON.stringify({ success: true }));",
    "} else {",
    "  console.error('unexpected arguments: ' + JSON.stringify(args));",
    "  process.exitCode = 1;",
    "}",
  ].join("\n");
  writeFileSync(executable, source);
  chmodSync(executable, 0o755);
  return executable;
}

test("uses JujuLeaf Bridge v1 and ordinary comment commands", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jujuleaf-worker-bridge-"));
  try {
    const binary = mockJujuLeaf(directory);
    const client = new JujuLeafClient({
      cwd: directory,
      binary,
      projectId: "project-explicit",
      profile: "overleaf",
    });
    const description = await client.describe();
    assert.deepEqual(
      (description.protocol as { supportedVersions: number[] }).supportedVersions,
      [1],
    );
    assert.equal((await client.listComments()).project.id, "project-1");
    assert.equal((await client.getThread("thread-1")).thread.id, "thread-1");
    assert.equal(
      ((await client.skillStatus()) as { skillVersion: string }).skillVersion,
      "1",
    );
    assert.equal(await client.reply("thread-1", "queued"), "status-1");
    await client.editReply("thread-1", "status-1", "done");

    const kinds: string[] = [];
    for await (const envelope of client.watchComments(5)) {
      kinds.push(envelope.kind);
    }
    assert.deepEqual(kinds, [
      "stream.opened",
      "comments.snapshot",
      "stream.closed",
    ]);

    const calls = readFileSync(
      join(directory, ".mock-jujuleaf-calls.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    assert.deepEqual(calls[0], ["bridge", "describe"]);
    assert.deepEqual(calls[3], ["skill", "status", "--raw"]);
    for (const index of [1, 2, 4, 5, 6]) {
      assert.deepEqual(calls[index]?.slice(0, 4), [
        "--project-id",
        "project-explicit",
        "--profile",
        "overleaf",
      ]);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects a Bridge protocol not advertised by JujuLeaf", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jujuleaf-worker-bridge-version-"));
  try {
    const client = new JujuLeafClient({
      cwd: directory,
      binary: mockJujuLeaf(directory),
      protocol: 2,
    });
    await assert.rejects(() => client.describe(), /does not advertise Bridge protocol 2/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reports a missing watch executable instead of hanging", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jujuleaf-worker-bridge-missing-"));
  try {
    const client = new JujuLeafClient({
      cwd: directory,
      binary: join(directory, "missing-jujuleaf"),
    });
    await assert.rejects(async () => {
      for await (const _envelope of client.watchComments(5)) {
        // No records are expected.
      }
    }, /ENOENT/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
