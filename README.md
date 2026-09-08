# JujuLeaf Worker

JujuLeaf Worker watches normalized Overleaf comment events through the JujuLeaf
Bridge, dispatches `@worker` tasks to Codex or Kimi Code, and reports progress
back to the original comment thread.

## Requirements

- Node.js 22.13 or newer
- JujuLeaf with Bridge protocol 1 support (v0.1.2 or newer) installed on `PATH`
- An authenticated JujuLeaf profile and a dedicated JujuLeaf project clone
- Codex and/or Kimi Code CLI installed and authenticated
- The JujuLeaf Skill installed for each enabled agent with
  `jujuleaf skill install`

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

Codex is the default agent. Supported comment forms:

```text
@worker Explain this derivation.
@worker ask Explain this derivation.
@worker codex suggest Rewrite this paragraph more concisely.
@worker kimi edit Fix this typo directly.
@worker-codex compile Diagnose the current LaTeX error.
@worker-kimi suggest Improve the academic prose.
```

`@worker` uses `--default-agent`; `@worker-codex`, `@worker-kimi`, or the
first word after the mention selects an agent explicitly. Messages without an
explicit action default to `suggest`.

To make Kimi Code the default:

```bash
npx @jujuleaf/worker --default-agent kimi
```

The mention is configurable. For example, `--mention @paperbot` enables
`@paperbot`, `@paperbot-codex`, and `@paperbot-kimi`.

Run diagnostics without starting the worker:

```bash
npx @jujuleaf/worker doctor
```

## Options

```text
--mention <name>             Mention prefix (default: @worker)
--default-agent <name>       codex or kimi (default: codex)
--protocol <number>          JujuLeaf Bridge protocol (default: 1)
--reconcile-interval <secs>  Authoritative snapshot interval (default: 60)
--bootstrap <mode>           recent, ignore, or all (default: recent)
--lookback-minutes <mins>    Recent bootstrap window (default: 30)
--status-interval <secs>     Minimum progress edit interval (default: 15)
--state <path>               SQLite state database path
--jujuleaf <path>            JujuLeaf executable (default: jujuleaf)
--codex <path>               Codex executable (default: codex)
--kimi <path>                Kimi Code executable (default: kimi)
```

## Safety model

- JujuLeaf owns authentication, Overleaf protocol handling, synchronization,
  and Skill installation.
- JujuLeaf Bridge snapshots are authoritative; live events are wake-up hints.
- One worker handles one dedicated project clone and runs one agent turn at a
  time.
- The worker never parses private Overleaf payloads.
- Progress comments contain factual stages only, never hidden reasoning or raw
  command output.
- Codex runs with workspace-write isolation and automatic approval review.
  Kimi Code runs in non-interactive prompt mode, whose tool calls are
  auto-approved by Kimi Code. The dedicated clone is therefore the workspace
  boundary.
- JujuLeaf still performs version, hash, and conflict checks.

## Development

```bash
npm install
npm test
```

Maintainers can follow [the release guide][release-guide] to bootstrap npm
Trusted Publishing and publish later versions from Git tags.

[release-guide]: https://github.com/CsomePro/jujuleaf-worker/blob/main/docs/releasing.md

Licensed under the MIT License.
