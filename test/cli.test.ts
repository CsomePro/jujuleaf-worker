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

test("parses worker mention and configured agents", () => {
  const parsed = parseOptions([
    "run",
    "--mention",
    "agent",
    "--agent",
    "kimi,codex,kimi",
    "--kimi",
    "/opt/kimi",
    "--bootstrap",
    "all",
    "--reconcile-interval",
    "10",
    "--project-id",
    "project-123",
    "--profile",
    "overleaf",
    "--workspace",
    "./agent-workspace",
  ]);
  assert.notEqual(parsed, "help");
  assert.notEqual(parsed, "version");
  if (parsed === "help" || parsed === "version") return;
  assert.equal(parsed.mention, "@agent");
  assert.deepEqual(parsed.agents, ["kimi", "codex"]);
  assert.equal(parsed.kimi, "/opt/kimi");
  assert.equal(parsed.bootstrap, "all");
  assert.equal(parsed.reconcileInterval, 10);
  assert.equal(parsed.projectId, "project-123");
  assert.equal(parsed.profile, "overleaf");
  assert.equal(parsed.workspace, join(process.cwd(), "agent-workspace"));
});

test("rejects unsafe or invalid option values", () => {
  assert.throws(
    () => parseOptions(["--agent", "codex,unknown"]),
    /codex, kimi/,
  );
  assert.throws(() => parseOptions(["--agent", ""]), /--agent/);
  assert.throws(
    () => parseOptions(["--mention", "../worker"]),
    /simple @name/,
  );
  assert.throws(
    () => parseOptions(["--reconcile-interval", "4"]),
    /greater than or equal to 5/,
  );
  assert.throws(() => parseOptions(["--unknown"]), /unknown argument/);
  assert.throws(() => parseOptions(["--project-id", "--agent"]), /requires an id/);
  assert.throws(() => parseOptions(["--profile"]), /requires a name/);
  assert.throws(() => parseOptions(["--workspace", "--agent"]), /requires a path/);
});

test("uses Codex as the only configured agent by default", () => {
  const parsed = parseOptions([]);
  assert.notEqual(parsed, "help");
  assert.notEqual(parsed, "version");
  if (parsed === "help" || parsed === "version") return;
  assert.deepEqual(parsed.agents, ["codex"]);
  assert.equal(parsed.projectId, undefined);
  assert.equal(parsed.profile, undefined);
  assert.equal(parsed.workspace, process.cwd());
});

test("--cwd remains an alias for --workspace", () => {
  const parsed = parseOptions(["--cwd", "./legacy-workspace"]);
  assert.notEqual(parsed, "help");
  assert.notEqual(parsed, "version");
  if (parsed === "help" || parsed === "version") return;
  assert.equal(parsed.workspace, join(process.cwd(), "legacy-workspace"));
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
