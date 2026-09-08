import assert from "node:assert/strict";
import test from "node:test";
import { parseTrigger } from "../src/trigger.js";

test("parses default and explicit actions", () => {
  assert.deepEqual(parseTrigger("@worker Explain this."), {
    action: "suggest",
    request: "Explain this.",
  });
  assert.deepEqual(parseTrigger("@worker edit Fix this typo."), {
    action: "edit",
    request: "Fix this typo.",
  });
  assert.deepEqual(parseTrigger("@worker compile"), {
    action: "compile",
    request: "",
  });
});

test("parses suffix and inline agent selectors", () => {
  assert.deepEqual(parseTrigger("@worker-kimi ask Improve this."), {
    action: "ask",
    request: "Improve this.",
    agent: "kimi",
  });
  assert.deepEqual(parseTrigger("@worker codex edit Fix this."), {
    action: "edit",
    request: "Fix this.",
    agent: "codex",
  });
  assert.deepEqual(parseTrigger("@leaf-kimi suggest Check it.", "leaf"), {
    action: "suggest",
    request: "Check it.",
    agent: "kimi",
  });
});

test("does not trigger on lookalikes or embedded mentions", () => {
  assert.equal(parseTrigger("Please ask @worker to review this."), null);
  assert.equal(parseTrigger("@workerish review this."), null);
  assert.equal(parseTrigger("@worker-unknown review this."), null);
});
