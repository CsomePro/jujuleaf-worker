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
