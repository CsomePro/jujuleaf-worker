import assert from "node:assert/strict";
import test from "node:test";
import { parseTrigger } from "../src/trigger.js";

test("parses default and explicit actions", () => {
  assert.deepEqual(parseTrigger("@codex Explain this."), {
    action: "suggest",
    request: "Explain this.",
  });
  assert.deepEqual(parseTrigger("@codex edit Fix this typo."), {
    action: "edit",
    request: "Fix this typo.",
  });
  assert.deepEqual(parseTrigger("@codex compile"), {
    action: "compile",
    request: "",
  });
});

test("parses a named Codex profile and custom mention", () => {
  assert.deepEqual(parseTrigger("@codex-Writing ask Improve this.", "@codex"), {
    action: "ask",
    request: "Improve this.",
    agentProfile: "writing",
  });
  assert.deepEqual(parseTrigger("@leaf suggest Check it.", "leaf"), {
    action: "suggest",
    request: "Check it.",
  });
});

test("does not trigger on lookalikes or embedded mentions", () => {
  assert.equal(parseTrigger("Please ask @codex to review this."), null);
  assert.equal(parseTrigger("@codexify review this."), null);
});
