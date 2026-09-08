import type { AgentName, TaskAction, Trigger } from "./types.js";

const ACTIONS = new Set<TaskAction>(["ask", "suggest", "edit", "compile"]);
const AGENTS = new Set<AgentName>(["codex", "kimi"]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseTrigger(content: string, mention = "@worker"): Trigger | null {
  const normalizedMention = mention.startsWith("@") ? mention : `@${mention}`;
  const expression = new RegExp(
    `^${escapeRegExp(normalizedMention)}(?:-([a-z0-9][a-z0-9_-]*))?(?:\\s+|$)([\\s\\S]*)$`,
    "i",
  );
  const match = content.trim().match(expression);
  if (!match) return null;

  const suffix = match[1]?.toLowerCase();
  if (suffix && !AGENTS.has(suffix as AgentName)) return null;

  let body = (match[2] ?? "").trim();
  let agent = suffix as AgentName | undefined;
  let firstSpace = body.search(/\s/);
  let firstWord = (firstSpace === -1 ? body : body.slice(0, firstSpace)).toLowerCase();
  if (!agent && AGENTS.has(firstWord as AgentName)) {
    agent = firstWord as AgentName;
    body = body.slice(firstWord.length).trim();
    firstSpace = body.search(/\s/);
    firstWord = (firstSpace === -1 ? body : body.slice(0, firstSpace)).toLowerCase();
  }
  const explicitAction = ACTIONS.has(firstWord as TaskAction)
    ? (firstWord as TaskAction)
    : undefined;
  const request = explicitAction
    ? body.slice(firstWord.length).trim()
    : body;

  const trigger: Trigger = {
    action: explicitAction ?? "suggest",
    request,
  };
  if (agent) trigger.agent = agent;
  return trigger;
}
