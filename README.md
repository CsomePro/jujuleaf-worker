# JujuLeaf Worker

JujuLeaf Worker watches normalized Overleaf comment events through the JujuLeaf
Bridge, dispatches `@codex` tasks to Codex, and reports progress back to the
original comment thread.

## Requirements

- Node.js 22.13 or newer
- JujuLeaf with Bridge protocol 1 support (v0.1.2 or newer) installed on `PATH`
- An authenticated JujuLeaf profile and a dedicated JujuLeaf project clone
- Codex CLI installed and authenticated
- The JujuLeaf Skill installed for Codex with `jujuleaf skill install`

JujuLeaf Worker does not install JujuLeaf, log in to Overleaf, or manage Agent
Skills. Those remain JujuLeaf responsibilities.

## Run

Use a dedicated JujuLeaf clone so unattended Agent edits do not collide with a
human working copy:

```bash
jujuleaf clone PROJECT_ID paper-worker
cd paper-worker
npx @jujuleaf/worker
```

The first snapshot processes recent unhandled mentions from open threads.
Subsequent snapshots and events are deduplicated by Overleaf message ID.

Supported comment forms:

```text
@codex Explain this derivation.
@codex ask Explain this derivation.
@codex suggest Rewrite this paragraph more concisely.
@codex edit Fix this typo directly.
@codex compile Diagnose the current LaTeX error.
@codex-writing suggest Improve the academic prose.
```

`@codex-<name>` selects the matching Codex CLI profile with `--profile <name>`.
Profiles must be explicitly trusted when starting the worker, for example
`npx @jujuleaf/worker --allow-profile writing`. Messages without an explicit
action default to `suggest`.

Run diagnostics without starting the worker:

```bash
npx @jujuleaf/worker doctor
```

## Options

```text
--mention <name>             Mention prefix (default: @codex)
--allow-profile <name>       Permit an @codex-<name> profile (repeatable)
--protocol <number>          JujuLeaf Bridge protocol (default: 1)
--reconcile-interval <secs>  Authoritative snapshot interval (default: 60)
--bootstrap <mode>           recent, ignore, or all (default: recent)
--lookback-minutes <mins>    Recent bootstrap window (default: 30)
--status-interval <secs>     Minimum progress edit interval (default: 15)
--state <path>               SQLite state database path
```

## Safety model

- JujuLeaf owns authentication, Overleaf protocol handling, synchronization,
  and Skill installation.
- JujuLeaf Bridge snapshots are authoritative; live events are wake-up hints.
- One worker handles one dedicated project clone and runs one Codex turn at a
  time.
- The worker never parses private Overleaf payloads.
- Progress comments contain factual stages only, never hidden reasoning or raw
  command output.
- The worker invokes Codex with workspace-write isolation and automatic approval
  review. JujuLeaf still performs version, hash, and conflict checks.

## Development

```bash
npm install
npm test
```

Licensed under the MIT License.
