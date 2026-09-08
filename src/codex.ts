import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentClient,
  AgentRunOptions,
  AgentRunResult,
} from "./agent.js";
import { spawnProcess, runProcess } from "./process.js";
import { parseAgentResult } from "./result.js";
import type { AgentProgress } from "./types.js";

const resultSchemaPath = fileURLToPath(
  new URL("../../schemas/result.schema.json", import.meta.url),
);

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function sessionIdFromEvent(value: unknown): string | undefined {
  const event = object(value);
  if (!event) return undefined;
  for (const key of ["thread_id", "threadId", "session_id", "sessionId"]) {
    const candidate = event[key];
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  const thread = object(event.thread);
  if (thread) {
    const candidate = thread.id;
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return undefined;
}

export function progressFromCodexEvent(value: unknown): AgentProgress | undefined {
  const event = object(value);
  if (!event || typeof event.type !== "string") return undefined;
  const type = event.type;
  if (type === "thread.started" || type === "turn.started") {
    return { phase: "analyzing", detail: "Codex 正在分析评论和项目上下文。" };
  }
  if (type === "turn.completed") {
    return { phase: "finalizing", detail: "Codex 已完成处理，正在整理和验证结果。" };
  }
  if (type === "turn.failed" || type === "error") {
    return { phase: "failed", detail: "Codex 执行遇到错误，正在收集诊断信息。" };
  }
  if (type === "item.started" || type === "item.completed") {
    const item = object(event.item);
    const itemType = typeof item?.type === "string" ? item.type : "";
    if (itemType.includes("command")) {
      return { phase: "validating", detail: "Codex 正在检查项目或验证修改。" };
    }
    if (itemType.includes("file") || itemType.includes("change")) {
      return { phase: "editing", detail: "Codex 正在处理项目文件。" };
    }
    if (itemType.includes("agent") || itemType.includes("message")) {
      return { phase: "working", detail: "Codex 正在整理任务结果。" };
    }
  }
  return undefined;
}

export class CodexClient implements AgentClient {
  readonly name = "codex" as const;

  constructor(readonly binary = "codex") {}

  async version(cwd: string): Promise<string> {
    const result = await runProcess(this.binary, ["--version"], { cwd });
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || "Codex CLI is not available");
    }
    return result.stdout.trim();
  }

  async check(cwd: string): Promise<string> {
    const [version, help, resumeHelp] = await Promise.all([
      this.version(cwd),
      runProcess(this.binary, ["exec", "--help"], { cwd }),
      runProcess(this.binary, ["exec", "resume", "--help"], { cwd }),
    ]);
    const helpText = `${help.stdout}\n${resumeHelp.stdout}`;
    const required = ["--approve-for-me", "--json", "--output-schema", "--output-last-message"];
    const missing = required.filter((flag) => !helpText.includes(flag));
    if (help.code !== 0 || resumeHelp.code !== 0 || missing.length > 0) {
      throw new Error(
        `Codex CLI is missing required exec capabilities${missing.length > 0 ? `: ${missing.join(", ")}` : ""}`,
      );
    }
    return version;
  }

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const outputDirectory = mkdtempSync(join(tmpdir(), "jujuleaf-worker-"));
    const outputPath = join(outputDirectory, "result.json");
    const globalArgs = ["--approve-for-me", "-C", options.cwd];

    const args = options.sessionId
      ? [
          ...globalArgs,
          "exec",
          "resume",
          "--json",
          "--output-schema",
          resultSchemaPath,
          "--output-last-message",
          outputPath,
          options.sessionId,
          "-",
        ]
      : [
          ...globalArgs,
          "exec",
          "--json",
          "--output-schema",
          resultSchemaPath,
          "--output-last-message",
          outputPath,
          "-",
        ];

    let observedSessionId = options.sessionId;
    try {
      const processHandle = spawnProcess(this.binary, args, {
        cwd: options.cwd,
        input: options.prompt,
        ...(options.signal ? { signal: options.signal } : {}),
        onStdoutLine: (line) => {
          let event: unknown;
          try {
            event = JSON.parse(line);
          } catch {
            return;
          }
          const sessionId = sessionIdFromEvent(event);
          if (sessionId && sessionId !== observedSessionId) {
            observedSessionId = sessionId;
            options.onSession?.(sessionId);
          }
          const progress = progressFromCodexEvent(event);
          if (progress) options.onProgress?.(progress);
        },
      });
      const execution = await processHandle.result;
      if (execution.code !== 0) {
        const detail = execution.stderr.trim().split(/\r?\n/).slice(-6).join("\n");
        throw new Error(
          `Codex exited with status ${execution.code}${detail ? `: ${detail}` : ""}`,
        );
      }
      const finalText = readFileSync(outputPath, "utf8").trim();
      return {
        result: parseAgentResult(finalText, "Codex"),
        ...(observedSessionId ? { sessionId: observedSessionId } : {}),
      };
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  }
}
