import type {
  AgentClient,
  AgentRunOptions,
  AgentRunResult,
} from "./agent.js";
import { spawnProcess, runProcess } from "./process.js";
import { parseAgentResult } from "./result.js";
import type { AgentProgress } from "./types.js";

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      const item = object(part);
      if (!item) return "";
      if (typeof item.text === "string") return item.text;
      return typeof item.content === "string" ? item.content : "";
    })
    .join("");
}

function sessionIdFromKimiEvent(value: unknown): string | undefined {
  const event = object(value);
  if (
    event?.role === "meta" &&
    event.type === "session.resume_hint" &&
    typeof event.session_id === "string"
  ) {
    return event.session_id;
  }
  return undefined;
}

export function progressFromKimiEvent(value: unknown): AgentProgress | undefined {
  const event = object(value);
  if (!event || typeof event.role !== "string") return undefined;
  if (event.role === "meta" && event.type === "system.version") {
    return { phase: "analyzing", detail: "Kimi Code 正在分析评论和项目上下文。" };
  }
  if (event.role === "tool") {
    return { phase: "working", detail: "Kimi Code 正在检查项目或执行工具。" };
  }
  if (event.role !== "assistant") return undefined;
  if (Array.isArray(event.tool_calls) && event.tool_calls.length > 0) {
    const calls = JSON.stringify(event.tool_calls).toLowerCase();
    if (/(write|edit|patch|replace|delete)/.test(calls)) {
      return { phase: "editing", detail: "Kimi Code 正在处理项目文件。" };
    }
    if (/(shell|bash|command|test|compile)/.test(calls)) {
      return { phase: "validating", detail: "Kimi Code 正在检查项目或验证修改。" };
    }
    return { phase: "working", detail: "Kimi Code 正在执行任务所需的工具。" };
  }
  if (contentText(event.content)) {
    return { phase: "finalizing", detail: "Kimi Code 已完成处理，正在整理结果。" };
  }
  return undefined;
}

export class KimiClient implements AgentClient {
  readonly name = "kimi" as const;

  constructor(readonly binary = "kimi") {}

  async check(cwd: string): Promise<string> {
    const [version, help] = await Promise.all([
      runProcess(this.binary, ["--version"], { cwd }),
      runProcess(this.binary, ["--help"], { cwd }),
    ]);
    if (version.code !== 0) {
      throw new Error(version.stderr.trim() || "Kimi Code CLI is not available");
    }
    const required = ["--session", "--prompt", "--output-format", "stream-json"];
    const missing = required.filter((flag) => !help.stdout.includes(flag));
    if (help.code !== 0 || missing.length > 0) {
      throw new Error(
        `Kimi Code CLI is missing required prompt capabilities${missing.length > 0 ? `: ${missing.join(", ")}` : ""}`,
      );
    }
    return version.stdout.trim();
  }

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const args = [
      ...(options.sessionId ? ["--session", options.sessionId] : []),
      "--prompt",
      options.prompt,
      "--output-format",
      "stream-json",
    ];
    let observedSessionId = options.sessionId;
    let finalText = "";
    const processHandle = spawnProcess(this.binary, args, {
      cwd: options.cwd,
      ...(options.signal ? { signal: options.signal } : {}),
      onStdoutLine: (line) => {
        let event: unknown;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        const sessionId = sessionIdFromKimiEvent(event);
        if (sessionId && sessionId !== observedSessionId) {
          observedSessionId = sessionId;
          options.onSession?.(sessionId);
        }
        const record = object(event);
        if (
          record?.role === "assistant" &&
          !(Array.isArray(record.tool_calls) && record.tool_calls.length > 0)
        ) {
          const content = contentText(record.content);
          if (content) finalText = content;
        }
        const progress = progressFromKimiEvent(event);
        if (progress) options.onProgress?.(progress);
      },
    });
    const execution = await processHandle.result;
    if (execution.code !== 0) {
      const detail = execution.stderr.trim().split(/\r?\n/).slice(-6).join("\n");
      throw new Error(
        `Kimi Code exited with status ${execution.code}${execution.code === 75 ? " (retryable)" : ""}${detail ? `: ${detail}` : ""}`,
      );
    }
    if (!finalText) {
      throw new Error("Kimi Code did not emit a final assistant message");
    }
    return {
      result: parseAgentResult(finalText, "Kimi Code"),
      ...(observedSessionId ? { sessionId: observedSessionId } : {}),
    };
  }
}
