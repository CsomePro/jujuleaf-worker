#!/usr/bin/env node

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { JujuLeafClient } from "./bridge.js";
import { CodexClient } from "./codex.js";
import { TaskCoordinator } from "./coordinator.js";

const VERSION = "0.1.0";

export interface Options {
  command: "run" | "doctor";
  cwd: string;
  jujuleaf: string;
  codex: string;
  mention: string;
  allowedProfiles: string[];
  protocol: number;
  reconcileInterval: number;
  bootstrap: "recent" | "ignore" | "all";
  lookbackMinutes: number;
  statusInterval: number;
  statePath: string;
}

function defaultStatePath(): string {
  const dataHome = process.env.XDG_DATA_HOME || resolve(homedir(), ".local", "share");
  return resolve(dataHome, "jujuleaf-worker", "state.sqlite3");
}

function help(): string {
  return `JujuLeaf Worker ${VERSION}

Usage:
  jujuleaf-worker [run] [options]
  jujuleaf-worker doctor [options]

Options:
  --mention <name>             Mention prefix (default: @codex)
  --allow-profile <name>       Permit an @codex-<name> profile (repeatable)
  --protocol <number>          Bridge protocol version (default: 1)
  --reconcile-interval <secs>  Snapshot interval, minimum 5 (default: 60)
  --bootstrap <mode>           recent, ignore, or all (default: recent)
  --lookback-minutes <mins>    Initial recent window (default: 30)
  --status-interval <secs>     Progress edit interval (default: 15)
  --state <path>               SQLite state database
  --jujuleaf <path>            JujuLeaf executable (default: jujuleaf)
  --codex <path>               Codex executable (default: codex)
  -C, --cwd <path>             Dedicated JujuLeaf clone (default: current directory)
  -h, --help                   Show help
  -V, --version                Show version
`;
}

function numberOption(name: string, value: string | undefined, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}`);
  }
  return parsed;
}

export function parseOptions(argv: string[]): Options | "help" | "version" {
  const args = [...argv];
  let command: Options["command"] = "run";
  if (args[0] === "run" || args[0] === "doctor") command = args.shift() as Options["command"];
  if (args.includes("--help") || args.includes("-h")) return "help";
  if (args.includes("--version") || args.includes("-V")) return "version";

  const options: Options = {
    command,
    cwd: process.cwd(),
    jujuleaf: "jujuleaf",
    codex: "codex",
    mention: "@codex",
    allowedProfiles: [],
    protocol: 1,
    reconcileInterval: 60,
    bootstrap: "recent",
    lookbackMinutes: 30,
    statusInterval: 15,
    statePath: defaultStatePath(),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    switch (arg) {
      case "--mention":
        if (!value) throw new Error("--mention requires a value");
        options.mention = value.startsWith("@") ? value : `@${value}`;
        index += 1;
        break;
      case "--allow-profile":
        if (!value || !/^[a-z0-9][a-z0-9_-]*$/i.test(value)) {
          throw new Error("--allow-profile requires a profile name");
        }
        if (!options.allowedProfiles.includes(value.toLowerCase())) {
          options.allowedProfiles.push(value.toLowerCase());
        }
        index += 1;
        break;
      case "--protocol":
        options.protocol = numberOption(arg, value, 1);
        index += 1;
        break;
      case "--reconcile-interval":
        options.reconcileInterval = numberOption(arg, value, 5);
        index += 1;
        break;
      case "--lookback-minutes":
        options.lookbackMinutes = numberOption(arg, value, 0);
        index += 1;
        break;
      case "--status-interval":
        options.statusInterval = numberOption(arg, value, 0);
        index += 1;
        break;
      case "--bootstrap":
        if (value !== "recent" && value !== "ignore" && value !== "all") {
          throw new Error("--bootstrap must be recent, ignore, or all");
        }
        options.bootstrap = value;
        index += 1;
        break;
      case "--state":
        if (!value) throw new Error("--state requires a path");
        options.statePath = resolve(value);
        index += 1;
        break;
      case "--jujuleaf":
        if (!value) throw new Error("--jujuleaf requires a path");
        options.jujuleaf = value;
        index += 1;
        break;
      case "--codex":
        if (!value) throw new Error("--codex requires a path");
        options.codex = value;
        index += 1;
        break;
      case "-C":
      case "--cwd":
        if (!value) throw new Error(`${arg} requires a path`);
        options.cwd = resolve(value);
        index += 1;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function codexSkillInstalled(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const installations = (value as { installations?: unknown }).installations;
  if (!Array.isArray(installations)) return false;
  return installations.some((installation) => {
    if (typeof installation !== "object" || installation === null) return false;
    const record = installation as { agents?: unknown; status?: unknown };
    return (
      Array.isArray(record.agents) &&
      record.agents.includes("codex") &&
      record.status === "current"
    );
  });
}

async function preflight(options: Options): Promise<{
  jujuleaf: JujuLeafClient;
  codex: CodexClient;
  codexVersion: string;
  skillInstalled: boolean;
}> {
  if (!existsSync(options.cwd)) throw new Error(`workspace does not exist: ${options.cwd}`);
  const jujuleaf = new JujuLeafClient({
    cwd: options.cwd,
    binary: options.jujuleaf,
    protocol: options.protocol,
  });
  const codex = new CodexClient(options.codex);
  await jujuleaf.describe();
  const skillStatus = await jujuleaf.skillStatus();
  const skillInstalled = codexSkillInstalled(skillStatus);
  const codexVersion = await codex.check(options.cwd);
  return { jujuleaf, codex, codexVersion, skillInstalled };
}

async function doctor(options: Options): Promise<number> {
  const checks: Array<{ name: string; status: "ok" | "error" | "warning"; detail: string }> = [];
  try {
    const result = await preflight(options);
    checks.push({ name: "jujuleaf-bridge", status: "ok", detail: `protocol ${options.protocol}` });
    checks.push({ name: "codex", status: "ok", detail: result.codexVersion });
    checks.push({
      name: "jujuleaf-skill",
      status: result.skillInstalled ? "ok" : "warning",
      detail: result.skillInstalled
        ? "Codex installation is current"
        : "run `jujuleaf skill install` and select Codex",
    });
    try {
      const snapshot = await result.jujuleaf.listComments();
      checks.push({
        name: "overleaf-project",
        status: "ok",
        detail: `${snapshot.project.name ?? snapshot.project.id} · ${snapshot.threads.length} threads`,
      });
    } catch (error) {
      checks.push({
        name: "overleaf-project",
        status: "error",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  } catch (error) {
    checks.push({
      name: "preflight",
      status: "error",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  for (const check of checks) {
    const icon = check.status === "ok" ? "✓" : check.status === "warning" ? "!" : "✗";
    process.stdout.write(`${icon} ${check.name}: ${check.detail}\n`);
  }
  return checks.some((check) => check.status === "error") ? 1 : 0;
}

async function run(options: Options): Promise<number> {
  const { jujuleaf, codex, codexVersion, skillInstalled } = await preflight(options);
  if (!skillInstalled) {
    throw new Error(
      "The JujuLeaf Skill is not currently installed for Codex. Run `jujuleaf skill install` and select Codex.",
    );
  }

  const { WorkerState } = await import("./state.js");
  const state = new WorkerState(options.statePath);
  const interrupted = state.recoverInterruptedTasks();
  const coordinator = new TaskCoordinator(state, jujuleaf, codex, {
    cwd: options.cwd,
    mention: options.mention,
    allowedProfiles: options.allowedProfiles,
    bootstrap: options.bootstrap,
    lookbackMinutes: options.lookbackMinutes,
    statusIntervalSeconds: options.statusInterval,
  });
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  process.stdout.write(
    `JujuLeaf Worker ${VERSION}\nWorkspace: ${options.cwd}\nCodex: ${codexVersion}\nMention: ${options.mention}\n`,
  );
  if (interrupted > 0) {
    process.stdout.write(`Recovered ${interrupted} interrupted task record(s).\n`);
  }
  process.stdout.write("Watching Overleaf comments. Press Ctrl+C to stop.\n");

  try {
    for await (const envelope of jujuleaf.watchComments(
      options.reconcileInterval,
      controller.signal,
    )) {
      await coordinator.accept(envelope);
    }
    await coordinator.drain();
    return 0;
  } catch (error) {
    if (controller.signal.aborted) {
      await coordinator.drain();
      return 0;
    }
    throw error;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    state.close();
  }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const parsed = parseOptions(argv);
  if (parsed === "help") {
    process.stdout.write(help());
    return 0;
  }
  if (parsed === "version") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  return parsed.command === "doctor" ? doctor(parsed) : run(parsed);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`jujuleaf-worker: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
