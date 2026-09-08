import { spawn, type ChildProcess } from "node:child_process";

export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunProcessOptions {
  cwd: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}

function consumeLines(
  chunk: Buffer | string,
  buffer: string,
  callback: ((line: string) => void) | undefined,
): string {
  const combined = buffer + chunk.toString();
  const lines = combined.split(/\r?\n/);
  const remainder = lines.pop() ?? "";
  for (const line of lines) {
    if (line.length > 0) callback?.(line);
  }
  return remainder;
}

export function spawnProcess(
  command: string,
  args: string[],
  options: RunProcessOptions,
): { child: ChildProcess; result: Promise<ProcessResult> } {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
    signal: options.signal,
  });

  let stdout = "";
  let stderr = "";
  let stdoutLineBuffer = "";
  let stderrLineBuffer = "";

  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
    stdoutLineBuffer = consumeLines(
      chunk,
      stdoutLineBuffer,
      options.onStdoutLine,
    );
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
    stderrLineBuffer = consumeLines(
      chunk,
      stderrLineBuffer,
      options.onStderrLine,
    );
  });

  if (options.input !== undefined) {
    child.stdin?.end(options.input);
  } else {
    child.stdin?.end();
  }

  const result = new Promise<ProcessResult>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (stdoutLineBuffer.length > 0) options.onStdoutLine?.(stdoutLineBuffer);
      if (stderrLineBuffer.length > 0) options.onStderrLine?.(stderrLineBuffer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });

  return { child, result };
}

export async function runProcess(
  command: string,
  args: string[],
  options: RunProcessOptions,
): Promise<ProcessResult> {
  return spawnProcess(command, args, options).result;
}
