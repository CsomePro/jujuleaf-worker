import assert from "node:assert/strict";
import test from "node:test";
import { parseOptions } from "../src/cli.js";

test("parses worker options and normalizes trusted profiles", () => {
  const parsed = parseOptions([
    "run",
    "--mention",
    "agent",
    "--allow-profile",
    "Writing",
    "--allow-profile",
    "writing",
    "--bootstrap",
    "all",
    "--reconcile-interval",
    "10",
  ]);
  assert.notEqual(parsed, "help");
  assert.notEqual(parsed, "version");
  if (parsed === "help" || parsed === "version") return;
  assert.equal(parsed.mention, "@agent");
  assert.deepEqual(parsed.allowedProfiles, ["writing"]);
  assert.equal(parsed.bootstrap, "all");
  assert.equal(parsed.reconcileInterval, 10);
});

test("rejects unsafe or invalid option values", () => {
  assert.throws(
    () => parseOptions(["--allow-profile", "../unsafe"]),
    /profile name/,
  );
  assert.throws(
    () => parseOptions(["--reconcile-interval", "4"]),
    /greater than or equal to 5/,
  );
  assert.throws(() => parseOptions(["--unknown"]), /unknown argument/);
});
