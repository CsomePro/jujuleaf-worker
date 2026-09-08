import type { AgentResult } from "./types.js";

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function unwrapFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^\`\`\`(?:json)?\s*\n([\s\S]*?)\n\`\`\`$/i);
  return match?.[1]?.trim() ?? trimmed;
}

function validChangedFile(value: unknown): boolean {
  const item = object(value);
  return Boolean(
    item &&
      typeof item.path === "string" &&
      typeof item.summary === "string",
  );
}

function validValidation(value: unknown): boolean {
  const item = object(value);
  return Boolean(
    item &&
      typeof item.name === "string" &&
      (item.status === "passed" ||
        item.status === "failed" ||
        item.status === "not_run") &&
      typeof item.summary === "string",
  );
}

export function parseAgentResult(text: string, source: string): AgentResult {
  let value: unknown;
  try {
    value = JSON.parse(unwrapFence(text));
  } catch (error) {
    throw new Error(
      `${source} final response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const result = object(value);
  if (
    !result ||
    result.schemaVersion !== 1 ||
    typeof result.taskId !== "string" ||
    !(
      result.status === "completed" ||
      result.status === "no_changes" ||
      result.status === "needs_input" ||
      result.status === "blocked"
    ) ||
    typeof result.summary !== "string" ||
    !Array.isArray(result.changedFiles) ||
    !result.changedFiles.every(validChangedFile) ||
    !Array.isArray(result.validation) ||
    !result.validation.every(validValidation) ||
    !Array.isArray(result.warnings) ||
    !result.warnings.every((warning) => typeof warning === "string") ||
    !(typeof result.question === "string" || result.question === null)
  ) {
    throw new Error(
      `${source} final response does not match the worker result contract`,
    );
  }
  return value as unknown as AgentResult;
}
