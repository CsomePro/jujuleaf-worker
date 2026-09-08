import assert from "node:assert/strict";
import test from "node:test";
import { parseAgentResult } from "../src/result.js";

const valid = {
  schemaVersion: 1,
  taskId: "task-1",
  status: "no_changes",
  summary: "Done.",
  changedFiles: [],
  validation: [],
  question: null,
  warnings: [],
};

test("accepts a fenced schemaVersion 1 result", () => {
  const result = parseAgentResult(
    `\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``,
    "Agent",
  );
  assert.equal(result.taskId, "task-1");
});

test("rejects invalid nested or enum values", () => {
  assert.throws(
    () =>
      parseAgentResult(
        JSON.stringify({ ...valid, status: "finished" }),
        "Agent",
      ),
    /does not match/,
  );
  assert.throws(
    () =>
      parseAgentResult(
        JSON.stringify({
          ...valid,
          changedFiles: [{ path: "main.tex", summary: 42 }],
        }),
        "Agent",
      ),
    /does not match/,
  );
});
