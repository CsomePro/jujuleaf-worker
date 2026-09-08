import type { AgentProgress, AgentResult, WorkerTask } from "./types.js";

export interface CommentWriter {
  reply(threadId: string, content: string): Promise<string | undefined>;
  editReply(threadId: string, messageId: string, content: string): Promise<void>;
}

function truncate(value: string, limit = 9000): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 24)}\n\n…内容已截断`;
}

function taskLabel(task: WorkerTask): string {
  return task.id.slice(0, 13);
}

function agentLabel(task: WorkerTask): string {
  return task.agent === "kimi" ? "Kimi Code" : "Codex";
}

export function renderFinal(task: WorkerTask, result: AgentResult): string {
  const icon =
    result.status === "completed" || result.status === "no_changes" ? "✅" : "⚠️";
  const lines = [
    `${icon} ${taskLabel(task)} · ${agentLabel(task)} · ${result.status}`,
    "",
    result.summary,
  ];
  if (result.changedFiles.length > 0) {
    lines.push("", "修改文件：");
    for (const file of result.changedFiles.slice(0, 12)) {
      lines.push(`- ${file.path}：${file.summary}`);
    }
  }
  if (result.validation.length > 0) {
    lines.push("", "验证：");
    for (const validation of result.validation.slice(0, 8)) {
      lines.push(`- ${validation.name} [${validation.status}]：${validation.summary}`);
    }
  }
  if (result.question) lines.push("", `需要确认：${result.question}`);
  if (result.warnings.length > 0) {
    lines.push("", "注意：", ...result.warnings.slice(0, 8).map((item) => `- ${item}`));
  }
  return truncate(lines.join("\n"));
}

export class StatusReporter {
  private messageId: string | undefined;
  private lastUpdate = 0;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly jujuleaf: CommentWriter,
    private readonly task: WorkerTask,
    private readonly minimumIntervalMs: number,
  ) {}

  get statusMessageId(): string | undefined {
    return this.messageId;
  }

  async open(): Promise<string | undefined> {
    const content = [
      `⏳ ${taskLabel(this.task)} · queued`,
      "",
      `已接收 ${this.task.action} 任务，正在启动 ${agentLabel(this.task)}。`,
    ].join("\n");
    this.messageId = await this.jujuleaf.reply(this.task.threadId, content);
    this.lastUpdate = Date.now();
    return this.messageId;
  }

  async progress(progress: AgentProgress): Promise<void> {
    if (!this.messageId || Date.now() - this.lastUpdate < this.minimumIntervalMs) return;
    const messageId = this.messageId;
    const content = [
      `⏳ ${taskLabel(this.task)} · ${progress.phase}`,
      "",
      progress.detail,
    ].join("\n");
    this.lastUpdate = Date.now();
    await this.enqueue(() =>
      this.jujuleaf.editReply(this.task.threadId, messageId, content),
    );
  }

  async finish(result: AgentResult): Promise<void> {
    const content = renderFinal(this.task, result);
    if (this.messageId) {
      const messageId = this.messageId;
      await this.enqueue(() =>
        this.jujuleaf.editReply(this.task.threadId, messageId, content),
      );
    } else {
      this.messageId = await this.jujuleaf.reply(this.task.threadId, content);
    }
    this.lastUpdate = Date.now();
  }

  async fail(error: Error): Promise<void> {
    const content = truncate(
      [`❌ ${taskLabel(this.task)} · failed`, "", error.message].join("\n"),
      4000,
    );
    if (this.messageId) {
      const messageId = this.messageId;
      await this.enqueue(() =>
        this.jujuleaf.editReply(this.task.threadId, messageId, content),
      );
    } else {
      this.messageId = await this.jujuleaf.reply(this.task.threadId, content);
    }
    this.lastUpdate = Date.now();
  }

  async needsRequest(): Promise<void> {
    const content = [
      `⚠️ ${taskLabel(this.task)} · needs_input`,
      "",
      "请在 worker mention 后写明需要执行的任务。",
    ].join("\n");
    if (this.messageId) {
      const messageId = this.messageId;
      await this.enqueue(() =>
        this.jujuleaf.editReply(this.task.threadId, messageId, content),
      );
    } else {
      this.messageId = await this.jujuleaf.reply(this.task.threadId, content);
    }
  }

  async blocked(reason: string): Promise<void> {
    const content = truncate(
      [`⚠️ ${taskLabel(this.task)} · blocked`, "", reason].join("\n"),
      4000,
    );
    if (this.messageId) {
      const messageId = this.messageId;
      await this.enqueue(() =>
        this.jujuleaf.editReply(this.task.threadId, messageId, content),
      );
    } else {
      this.messageId = await this.jujuleaf.reply(this.task.threadId, content);
    }
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const queued = this.writeQueue.then(operation);
    this.writeQueue = queued.catch(() => undefined);
    return queued;
  }
}
