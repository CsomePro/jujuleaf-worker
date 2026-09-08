import { randomUUID } from "node:crypto";
import type {
  AgentRunOptions,
  AgentRunResult,
} from "./agent.js";
import { buildPrompt } from "./prompt.js";
import { StatusReporter } from "./status.js";
import type { WorkerState } from "./state.js";
import { parseTrigger } from "./trigger.js";
import type {
  BridgeEnvelope,
  CommentEventData,
  CommentMessage,
  CommentSnapshot,
  CommentThread,
  ThreadContext,
  AgentName,
  WorkerTask,
} from "./types.js";

interface SnapshotRecordData {
  reason?: string;
  snapshot?: CommentSnapshot;
}

export interface CoordinatorOptions {
  cwd: string;
  mention: string;
  defaultAgent: AgentName;
  bootstrap: "recent" | "ignore" | "all";
  lookbackMinutes: number;
  statusIntervalSeconds: number;
}

export interface JujuLeafPort {
  getThread(threadId: string): Promise<ThreadContext>;
  reply(threadId: string, content: string): Promise<string | undefined>;
  editReply(threadId: string, messageId: string, content: string): Promise<void>;
}

export interface AgentPort {
  run(options: AgentRunOptions): Promise<AgentRunResult>;
}

function log(message: string): void {
  process.stderr.write(`[${new Date().toISOString()}] ${message}\n`);
}

function isCommentSnapshot(value: unknown): value is CommentSnapshot {
  const snapshot = value as CommentSnapshot;
  return Boolean(
    snapshot &&
      snapshot.project &&
      typeof snapshot.project.id === "string" &&
      Array.isArray(snapshot.documents) &&
      Array.isArray(snapshot.threads),
  );
}

function snapshotFromEnvelope(envelope: BridgeEnvelope<unknown>): CommentSnapshot | undefined {
  const data = envelope.data as SnapshotRecordData | CommentSnapshot | undefined;
  if (isCommentSnapshot(data)) return data;
  if (data && isCommentSnapshot((data as SnapshotRecordData).snapshot)) {
    return (data as SnapshotRecordData).snapshot;
  }
  return undefined;
}

function eventFromEnvelope(envelope: BridgeEnvelope<unknown>): CommentEventData | undefined {
  if (envelope.kind !== "comment.event" || !envelope.data) return undefined;
  const event = envelope.data as CommentEventData;
  return typeof event.type === "string" && typeof event.threadId === "string"
    ? event
    : undefined;
}

function threadContext(snapshot: CommentSnapshot, thread: CommentThread): ThreadContext {
  const referenced = new Set(thread.anchors.map((anchor) => anchor.documentId));
  return {
    project: snapshot.project,
    documents: snapshot.documents.filter((document) => referenced.has(document.id)),
    thread,
  };
}

function recent(message: CommentMessage, lookbackMinutes: number): boolean {
  if (!message.createdAt) return false;
  const createdAt = Date.parse(message.createdAt);
  if (!Number.isFinite(createdAt)) return false;
  return Date.now() - createdAt <= lookbackMinutes * 60_000;
}

export class TaskCoordinator {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly state: WorkerState,
    private readonly jujuleaf: JujuLeafPort,
    private readonly agents: ReadonlyMap<AgentName, AgentPort>,
    private readonly options: CoordinatorOptions,
  ) {}

  async accept(envelope: BridgeEnvelope<unknown>): Promise<void> {
    const snapshot = snapshotFromEnvelope(envelope);
    if (snapshot) {
      this.acceptSnapshot(snapshot);
      return;
    }

    const event = eventFromEnvelope(envelope);
    if (!event) return;
    if (!["message.created", "message.edited", "thread.changed"].includes(event.type)) {
      return;
    }
    try {
      const context = await this.jujuleaf.getThread(event.threadId);
      this.acceptThread(context, event.messageId);
    } catch (error) {
      log(
        `could not refresh thread ${event.threadId}; waiting for reconciliation: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async drain(): Promise<void> {
    await this.queue;
  }

  private acceptSnapshot(snapshot: CommentSnapshot): void {
    const firstSnapshot = !this.state.isBootstrapped(snapshot.project.id);
    for (const thread of snapshot.threads) {
      if (thread.state !== "open") {
        for (const message of thread.messages) {
          this.state.markSeen(snapshot.project.id, thread.id, message.id);
        }
        continue;
      }

      if (firstSnapshot && this.options.bootstrap !== "all") {
        const context = threadContext(snapshot, thread);
        for (const message of thread.messages) {
          if (
            this.options.bootstrap === "ignore" ||
            !recent(message, this.options.lookbackMinutes)
          ) {
            this.state.markSeen(snapshot.project.id, thread.id, message.id);
          } else {
            this.acceptMessage(context, message);
          }
        }
        continue;
      }

      const context = threadContext(snapshot, thread);
      for (const message of thread.messages) this.acceptMessage(context, message);
    }
    if (firstSnapshot) this.state.markBootstrapped(snapshot.project.id);
  }

  private acceptThread(context: ThreadContext, targetMessageId?: string): void {
    if (context.thread.state !== "open") return;
    for (const message of context.thread.messages) {
      if (targetMessageId && message.id !== targetMessageId) continue;
      this.acceptMessage(context, message);
    }
  }

  private acceptMessage(context: ThreadContext, message: CommentMessage): void {
    if (this.state.hasMessage(context.project.id, message.id)) return;
    const trigger = parseTrigger(message.content, this.options.mention);
    if (!trigger) return;

    const task: WorkerTask = {
      id: `task-${randomUUID().slice(0, 8)}`,
      projectId: context.project.id,
      threadId: context.thread.id,
      messageId: message.id,
      agent: trigger.agent ?? this.options.defaultAgent,
      action: trigger.action,
      request: trigger.request,
      ...(message.author?.id ? { actorId: message.author.id } : {}),
    };
    if (!this.state.claimTask(task)) return;

    log(`queued ${task.id} for ${task.agent} in thread ${task.threadId}`);
    this.queue = this.queue
      .then(() => this.execute(task, context))
      .catch((error: unknown) => {
        log(`task queue error: ${error instanceof Error ? error.message : String(error)}`);
      });
  }

  private async execute(task: WorkerTask, context: ThreadContext): Promise<void> {
    const reporter = new StatusReporter(
      this.jujuleaf,
      task,
      this.options.statusIntervalSeconds * 1000,
    );
    try {
      try {
        const messageId = await reporter.open();
        if (messageId) {
          this.state.updateTask(task.id, "queued", { statusMessageId: messageId });
        }
      } catch (error) {
        log(`could not post status for ${task.id}: ${error instanceof Error ? error.message : String(error)}`);
      }

      const agent = this.agents.get(task.agent);
      if (!agent) {
        await reporter.blocked(
          `${task.agent === "kimi" ? "Kimi Code" : "Codex"} is not ready for this worker. Run jujuleaf-worker doctor for details.`,
        );
        this.state.updateTask(task.id, "blocked");
        return;
      }

      if (!task.request && task.action !== "compile") {
        await reporter.needsRequest();
        this.state.updateTask(task.id, "needs_input");
        return;
      }

      this.state.updateTask(task.id, "running");
      const existingSession = this.state.getSession(
        task.projectId,
        task.threadId,
        task.agent,
      );
      const prompt = buildPrompt(task, context);
      const execution = await agent.run({
        cwd: this.options.cwd,
        prompt,
        ...(existingSession ? { sessionId: existingSession } : {}),
        onSession: (sessionId) => {
          this.state.setSession(
            task.projectId,
            task.threadId,
            sessionId,
            task.agent,
          );
          this.state.updateTask(task.id, "running", { sessionId });
        },
        onProgress: (progress) => {
          void reporter.progress(progress).catch((error: unknown) => {
            log(`could not update status for ${task.id}: ${error instanceof Error ? error.message : String(error)}`);
          });
        },
      });
      if (execution.result.taskId !== task.id) {
        throw new Error(
          `${task.agent} returned taskId ${execution.result.taskId}, expected ${task.id}`,
        );
      }
      if (execution.sessionId) {
        this.state.setSession(
          task.projectId,
          task.threadId,
          execution.sessionId,
          task.agent,
        );
      }
      await reporter.finish(execution.result);
      const status =
        execution.result.status === "needs_input"
          ? "needs_input"
          : execution.result.status === "blocked"
            ? "blocked"
            : "completed";
      this.state.updateTask(task.id, status, {
        ...(execution.sessionId ? { sessionId: execution.sessionId } : {}),
        ...(reporter.statusMessageId
          ? { statusMessageId: reporter.statusMessageId }
          : {}),
      });
      log(`completed ${task.id} with status ${execution.result.status}`);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.state.updateTask(task.id, "failed", { error: failure.message });
      try {
        await reporter.fail(failure);
      } catch (reportError) {
        log(`could not report failure for ${task.id}: ${reportError instanceof Error ? reportError.message : String(reportError)}`);
      }
      log(`failed ${task.id}: ${failure.message}`);
    }
  }
}
