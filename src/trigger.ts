import type { TaskAction, Trigger } from "./types.js";

const ACTIONS = new Set<TaskAction>(["ask", "suggest", "edit", "compile"]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseTrigger(content: string, mention = "@codex"): Trigger | null {
  const normalizedMention = mention.startsWith("@") ? mention : `@${mention}`;
  const expression = new RegExp(
    `^${escapeRegExp(normalizedMention)}(?:-([a-z0-9][a-z0-9_-]*))?(?:\\s+|$)([\\s\\S]*)$`,
    "i",
  );
  const match = content.trim().match(expression);
  if (!match) return null;

  const body = (match[2] ?? "").trim();
  const firstSpace = body.search(/\s/);
  const firstWord = (firstSpace === -1 ? body : body.slice(0, firstSpace)).toLowerCase();
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
  if (match[1]) trigger.agentProfile = match[1].toLowerCase();
  return trigger;
}
