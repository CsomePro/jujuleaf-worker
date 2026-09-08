import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { runProcess } from "./process.js";
import type {
  BridgeEnvelope,
  CommentSnapshot,
  JsonObject,
  ThreadContext,
} from "./types.js";

export class BridgeCommandError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly exitCode: number;

  constructor(message: string, code: string, retryable: boolean, exitCode: number) {
    super(message);
    this.name = "BridgeCommandError";
    this.code = code;
    this.retryable = retryable;
    this.exitCode = exitCode;
  }
}

function parseJson(text: string, source: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON from ${source}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asEnvelope<T>(value: unknown, protocol: number): BridgeEnvelope<T> {
  if (!isObject(value) || !isObject(value.protocol)) {
    throw new Error("JujuLeaf Bridge returned an invalid envelope");
  }
  if (
    value.protocol.name !== "jujuleaf.bridge" ||
    value.protocol.version !== protocol
  ) {
    throw new Error(
      `JujuLeaf Bridge protocol mismatch: expected jujuleaf.bridge/${protocol}`,
    );
  }
  return value as unknown as BridgeEnvelope<T>;
}

function findId(value: unknown, depth = 0): string | undefined {
  if (depth > 5 || value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = findId(item, depth + 1);
      if (id) return id;
    }
    return undefined;
  }
  if (!isObject(value)) return undefined;
  for (const key of ["id", "_id", "messageId", "message_id"]) {
    if (typeof value[key] === "string" && value[key].length > 0) {
      return value[key];
    }
  }
  for (const key of ["message", "data", "result"]) {
    const id = findId(value[key], depth + 1);
    if (id) return id;
  }
  return undefined;
}

export interface JujuLeafClientOptions {
  cwd: string;
  binary?: string;
  protocol?: number;
  projectId?: string;
  profile?: string;
}

export class JujuLeafClient {
  readonly cwd: string;
  readonly binary: string;
  readonly protocol: number;
  readonly projectId: string | undefined;
  readonly profile: string | undefined;

  constructor(options: JujuLeafClientOptions) {
    this.cwd = options.cwd;
    this.binary = options.binary ?? "jujuleaf";
    this.protocol = options.protocol ?? 1;
    this.projectId = options.projectId;
    this.profile = options.profile;
  }

  private targeted(args: string[]): string[] {
    const globalArgs: string[] = [];
    if (this.projectId) globalArgs.push("--project-id", this.projectId);
    if (this.profile) globalArgs.push("--profile", this.profile);
    return [...globalArgs, ...args];
  }

  private async oneShot<T>(args: string[], operation: string): Promise<BridgeEnvelope<T>> {
    const result = await runProcess(this.binary, this.targeted(args), { cwd: this.cwd });
    const line = result.stdout.trim();
    if (!line) {
      throw new Error(
        `${operation} produced no Bridge response${result.stderr.trim() ? `: ${result.stderr.trim()}` : ""}`,
      );
    }
    const envelope = asEnvelope<T>(parseJson(line, operation), this.protocol);
    if (!envelope.ok) {
      throw new BridgeCommandError(
        envelope.error?.message ?? `${operation} failed`,
        envelope.error?.code ?? "INTERNAL_ERROR",
        envelope.error?.retryable ?? false,
        result.code,
      );
    }
    if (result.code !== 0) {
      throw new BridgeCommandError(
        `${operation} exited with status ${result.code}`,
        "INTERNAL_ERROR",
        false,
        result.code,
      );
    }
    return envelope;
  }

  async describe(): Promise<JsonObject> {
    const result = await runProcess(this.binary, ["bridge", "describe"], {
      cwd: this.cwd,
    });
    const line = result.stdout.trim();
    if (!line) {
      throw new Error(
        `jujuleaf bridge describe produced no response${result.stderr.trim() ? `: ${result.stderr.trim()}` : ""}`,
      );
    }
    const value = parseJson(line, "bridge describe");
    if (!isObject(value) || !isObject(value.protocol)) {
      throw new Error("jujuleaf bridge describe returned an invalid envelope");
    }
    const envelope = value as unknown as BridgeEnvelope<unknown>;
    if (!envelope.ok || result.code !== 0) {
      throw new BridgeCommandError(
        envelope.error?.message ?? "bridge describe failed",
        envelope.error?.code ?? "INTERNAL_ERROR",
        envelope.error?.retryable ?? false,
        result.code,
      );
    }
    const description = envelope.data;
    if (
      envelope.protocol.name !== "jujuleaf.bridge" ||
      !isObject(description) ||
      !isObject(description.protocol) ||
      description.protocol.name !== "jujuleaf.bridge" ||
      !Array.isArray(description.protocol.supportedVersions) ||
      !description.protocol.supportedVersions.includes(this.protocol)
    ) {
      throw new Error(
        `JujuLeaf does not advertise Bridge protocol ${this.protocol}`,
      );
    }
    return description;
  }

  async listComments(): Promise<CommentSnapshot> {
    const envelope = await this.oneShot<CommentSnapshot>(
      ["bridge", "comments", "list", "--protocol", String(this.protocol)],
      "comments.list",
    );
    if (!envelope.data) throw new Error("comments.list returned no data");
    return envelope.data;
  }

  async getThread(threadId: string): Promise<ThreadContext> {
    const envelope = await this.oneShot<ThreadContext>(
      [
        "bridge",
        "comments",
        "get",
        threadId,
        "--protocol",
        String(this.protocol),
      ],
      "comments.get",
    );
    if (!envelope.data) throw new Error("comments.get returned no data");
    return envelope.data;
  }

  async skillStatus(): Promise<unknown> {
    const result = await runProcess(
      this.binary,
      ["skill", "status", "--raw"],
      { cwd: this.cwd },
    );
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || "jujuleaf skill status failed");
    }
    return parseJson(result.stdout.trim(), "skill status");
  }

  async reply(threadId: string, content: string): Promise<string | undefined> {
    const result = await runProcess(
      this.binary,
      this.targeted(["comment", "--raw", threadId, content]),
      { cwd: this.cwd },
    );
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || "failed to post JujuLeaf comment");
    }
    const body = result.stdout.trim();
    return body ? findId(parseJson(body, "comment")) : undefined;
  }

  async editReply(
    threadId: string,
    messageId: string,
    content: string,
  ): Promise<void> {
    const result = await runProcess(
      this.binary,
      this.targeted(["edit-comment", "--raw", threadId, messageId, content]),
      { cwd: this.cwd },
    );
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || "failed to edit JujuLeaf comment");
    }
  }

  async *watchComments(
    reconcileInterval: number,
    signal?: AbortSignal,
  ): AsyncGenerator<BridgeEnvelope<unknown>> {
    const args = this.targeted([
      "bridge",
      "comments",
      "watch",
      "--protocol",
      String(this.protocol),
      "--reconcile-interval",
      String(reconcileInterval),
    ]);
    const child = spawn(this.binary, args, {
      cwd: this.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    if (!child.stdout) throw new Error("failed to open JujuLeaf Bridge stdout");

    let spawnError: Error | undefined;
    const completion = new Promise<number>((resolve) => {
      child.once("error", (error) => {
        spawnError = error;
      });
      child.once("close", (code) => {
        resolve(code ?? 1);
      });
    });

    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        const envelope = asEnvelope<unknown>(
          parseJson(line, "comments.watch"),
          this.protocol,
        );
        if (!envelope.ok || envelope.kind === "error") {
          throw new BridgeCommandError(
            envelope.error?.message ?? "comments.watch failed",
            envelope.error?.code ?? "INTERNAL_ERROR",
            envelope.error?.retryable ?? false,
            1,
          );
        }
        yield envelope;
      }
    } catch (error) {
      if (child.exitCode === null && !child.killed) child.kill();
      await completion;
      throw error;
    }

    const exitCode = await completion;
    if (spawnError) throw spawnError;
    if (exitCode !== 0 && !signal?.aborted) {
      throw new Error(
        `jujuleaf comments.watch exited with status ${exitCode}${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
      );
    }
  }
}
