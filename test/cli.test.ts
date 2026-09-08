import assert from "node:assert/strict";
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isEntrypoint, parseOptions } from "../src/cli.js";

test("parses worker mention and default agent options", () => {
  const parsed = parseOptions([
    "run",
    "--mention",
    "agent",
    "--default-agent",
    "kimi",
    "--kimi",
    "/opt/kimi",
    "--bootstrap",
    "all",
    "--reconcile-interval",
    "10",
  ]);
  assert.notEqual(parsed, "help");
  assert.notEqual(parsed, "version");
  if (parsed === "help" || parsed === "version") return;
  assert.equal(parsed.mention, "@agent");
  assert.equal(parsed.defaultAgent, "kimi");
  assert.equal(parsed.kimi, "/opt/kimi");
  assert.equal(parsed.bootstrap, "all");
  assert.equal(parsed.reconcileInterval, 10);
});

test("rejects unsafe or invalid option values", () => {
  assert.throws(
    () => parseOptions(["--default-agent", "unknown"]),
    /codex or kimi/,
  );
  assert.throws(
    () => parseOptions(["--mention", "../worker"]),
    /simple @name/,
  );
  assert.throws(
    () => parseOptions(["--reconcile-interval", "4"]),
    /greater than or equal to 5/,
  );
  assert.throws(() => parseOptions(["--unknown"]), /unknown argument/);
});

test("recognizes an npm-style symlink as the CLI entrypoint", () => {
  const directory = mkdtempSync(join(tmpdir(), "jujuleaf-worker-bin-"));
  try {
    const cliPath = realpathSync(
      fileURLToPath(new URL("../src/cli.js", import.meta.url)),
    );
    const linkPath = join(directory, "jujuleaf-worker");
    symlinkSync(cliPath, linkPath);
    assert.equal(isEntrypoint(linkPath), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
