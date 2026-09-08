import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentRunOptions, AgentRunResult } from "../src/agent.js";
import {
  TaskCoordinator,
  type AgentPort,
  type CoordinatorOptions,
  type JujuLeafPort,
} from "../src/coordinator.js";
import { WorkerState } from "../src/state.js";
import type {
  BridgeEnvelope,
  AgentName,
  CommentMessage,
  CommentSnapshot,
  ThreadContext,
} from "../src/types.js";

function snapshot(messages: CommentMessage[]): CommentSnapshot {
  return {
    project: { id: "project-1", name: "Paper" },
    documents: [
      {
        id: "document-1",
        path: "main.tex",
        remoteVersion: 1,
        contentHash: "sha256:test",
      },
    ],
    threads: [
      {
        id: "thread-1",
        state: "open",
        messages,
        anchors: [
          {
            documentId: "document-1",
            path: "main.tex",
            state: "attached",
            sourceRangeUtf16: { from: 0, to: 4 },
            visibleRangeUtf16: { from: 0, to: 4 },
            text: "Test",
            before: "",
            after: "",
          },
        ],
      },
    ],
  };
}

function envelope(value: CommentSnapshot): BridgeEnvelope<unknown> {
  return {
    protocol: { name: "jujuleaf.bridge", version: 1 },
    kind: "comments.snapshot",
    operation: "comments.watch",
    ok: true,
    data: { reason: "initial", snapshot: value },
  };
}

class FakeJujuLeaf implements JujuLeafPort {
  readonly replies: string[] = [];
  readonly edits: string[] = [];

  constructor(private readonly context: ThreadContext) {}

  async getThread(): Promise<ThreadContext> {
    return this.context;
  }

  async reply(_threadId: string, content: string): Promise<string> {
    this.replies.push(content);
    return "status-1";
  }

  async editReply(
    _threadId: string,
    _messageId: string,
    content: string,
  ): Promise<void> {
    this.edits.push(content);
  }
}

class FakeAgent implements AgentPort {
  calls = 0;

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    this.calls += 1;
    const taskId = /"taskId":\s*"([^"]+)"/.exec(options.prompt)?.[1];
    assert(taskId);
    assert.match(options.prompt, /Use \$jujuleaf\./);
    assert.match(options.prompt, /<thread_context>/);
    options.onSession?.("session-1");
    options.onProgress?.({
      phase: "validating",
      detail: "Codex 正在检查项目或验证修改。",
    });
    return {
      result: {
        schemaVersion: 1,
        taskId,
        status: "no_changes",
        summary: "The requested explanation was prepared.",
        changedFiles: [],
        validation: [],
        question: null,
        warnings: [],
      },
      sessionId: "session-1",
    };
  }
}

function coordinatorOptions(overrides: Partial<{
  defaultAgent: AgentName;
  bootstrap: "recent" | "ignore" | "all";
  lookbackMinutes: number;
}> = {}): CoordinatorOptions {
  return {
    cwd: process.cwd(),
    mention: "@worker",
    defaultAgent: overrides.defaultAgent ?? "codex",
    bootstrap: overrides.bootstrap ?? "all",
    lookbackMinutes: overrides.lookbackMinutes ?? 30,
    statusIntervalSeconds: 0,
  };
}

function agentMap(
  codex?: AgentPort,
  kimi?: AgentPort,
): ReadonlyMap<AgentName, AgentPort> {
  const agents = new Map<AgentName, AgentPort>();
  if (codex) agents.set("codex", codex);
  if (kimi) agents.set("kimi", kimi);
  return agents;
}

test("dispatches, reports, and deduplicates an @worker task", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jujuleaf-worker-coordinator-"));
  const state = new WorkerState(join(directory, "state.sqlite3"));
  const value = snapshot([
    {
      id: "message-1",
      content: "@worker ask Explain this equation.",
      createdAt: new Date().toISOString(),
      author: { id: "user-1", name: "Researcher" },
    },
  ]);
  const jujuleaf = new FakeJujuLeaf({
    project: value.project,
    documents: value.documents,
    thread: value.threads[0]!,
  });
  const codex = new FakeAgent();
  try {
    const coordinator = new TaskCoordinator(
      state,
      jujuleaf,
      agentMap(codex),
      coordinatorOptions(),
    );
    await coordinator.accept(envelope(value));
    await coordinator.drain();
    assert.equal(codex.calls, 1);
    assert.equal(jujuleaf.replies.length, 1);
    assert.match(jujuleaf.edits.at(-1) ?? "", /no_changes/);
    assert.equal(
      state.getSession("project-1", "thread-1", "codex"),
      "session-1",
    );

    await coordinator.accept(envelope(value));
    await coordinator.drain();
    assert.equal(codex.calls, 1);
  } finally {
    state.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("recent bootstrap handles every recent message and ignores old backlog", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jujuleaf-worker-bootstrap-"));
  const state = new WorkerState(join(directory, "state.sqlite3"));
  const value = snapshot([
    {
      id: "old-message",
      content: "@worker ask Old task.",
      createdAt: "2020-01-01T00:00:00.000Z",
    },
    {
      id: "recent-message-1",
      content: "@worker ask First recent task.",
      createdAt: new Date().toISOString(),
    },
    {
      id: "recent-message-2",
      content: "@worker ask Second recent task.",
      createdAt: new Date().toISOString(),
    },
  ]);
  const jujuleaf = new FakeJujuLeaf({
    project: value.project,
    documents: value.documents,
    thread: value.threads[0]!,
  });
  const codex = new FakeAgent();
  try {
    const coordinator = new TaskCoordinator(
      state,
      jujuleaf,
      agentMap(codex),
      coordinatorOptions({ bootstrap: "recent" }),
    );
    await coordinator.accept(envelope(value));
    await coordinator.drain();
    assert.equal(codex.calls, 2);
    assert.equal(state.hasMessage("project-1", "old-message"), true);
  } finally {
    state.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("blocks an unavailable explicitly selected agent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jujuleaf-worker-profile-"));
  const state = new WorkerState(join(directory, "state.sqlite3"));
  const value = snapshot([
    {
      id: "message-1",
      content: "@worker-kimi edit Change everything.",
      createdAt: new Date().toISOString(),
    },
  ]);
  const jujuleaf = new FakeJujuLeaf({
    project: value.project,
    documents: value.documents,
    thread: value.threads[0]!,
  });
  const codex = new FakeAgent();
  try {
    const coordinator = new TaskCoordinator(
      state,
      jujuleaf,
      agentMap(codex),
      coordinatorOptions(),
    );
    await coordinator.accept(envelope(value));
    await coordinator.drain();
    assert.equal(codex.calls, 0);
    assert.match(jujuleaf.edits.at(-1) ?? "", /not ready/);
  } finally {
    state.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("routes an explicit @worker-kimi task to Kimi Code", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jujuleaf-worker-kimi-route-"));
  const state = new WorkerState(join(directory, "state.sqlite3"));
  const value = snapshot([
    {
      id: "message-kimi",
      content: "@worker-kimi ask Explain this.",
      createdAt: new Date().toISOString(),
    },
  ]);
  const jujuleaf = new FakeJujuLeaf({
    project: value.project,
    documents: value.documents,
    thread: value.threads[0]!,
  });
  const codex = new FakeAgent();
  const kimi = new FakeAgent();
  try {
    const coordinator = new TaskCoordinator(
      state,
      jujuleaf,
      agentMap(codex, kimi),
      coordinatorOptions(),
    );
    await coordinator.accept(envelope(value));
    await coordinator.drain();
    assert.equal(codex.calls, 0);
    assert.equal(kimi.calls, 1);
    assert.equal(
      state.getSession("project-1", "thread-1", "kimi"),
      "session-1",
    );
  } finally {
    state.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
