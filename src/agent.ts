import type { AgentName, AgentProgress, AgentResult } from "./types.js";

export interface AgentRunOptions {
  cwd: string;
  prompt: string;
  sessionId?: string;
  signal?: AbortSignal;
  onSession?: (sessionId: string) => void;
  onProgress?: (progress: AgentProgress) => void;
}

export interface AgentRunResult {
  result: AgentResult;
  sessionId?: string;
}

export interface AgentClient {
  readonly name: AgentName;
  check(cwd: string): Promise<string>;
  run(options: AgentRunOptions): Promise<AgentRunResult>;
}
