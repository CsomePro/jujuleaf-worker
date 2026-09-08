<p align="center">
  <img src="https://raw.githubusercontent.com/CsomePro/jujuleaf-worker/main/assets/jujuleaf-worker-logo.png" alt="JujuLeaf Worker logo" width="176">
</p>

<h1 align="center">JujuLeaf Worker</h1>

<p align="center">
  Turn Overleaf comments into safe, observable coding-agent tasks.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@jujuleaf/worker">npm</a>
  · <a href="https://github.com/CsomePro/jujuleaf">JujuLeaf</a>
  · <a href="https://github.com/CsomePro/jujuleaf-worker/releases">Releases</a>
  · <a href="https://github.com/CsomePro/jujuleaf-worker/blob/main/docs/releasing.md">Release guide</a>
</p>

<p align="center">
  <a href="https://github.com/CsomePro/jujuleaf-worker/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/CsomePro/jujuleaf-worker/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://www.npmjs.com/package/@jujuleaf/worker"><img alt="npm version" src="https://img.shields.io/npm/v/%40jujuleaf%2Fworker.svg"></a>
  <a href="package.json"><img alt="Node.js 22.13+" src="https://img.shields.io/badge/node-%3E%3D22.13-339933?logo=node.js&logoColor=white"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/github/license/CsomePro/jujuleaf-worker"></a>
</p>

JujuLeaf Worker watches normalized Overleaf comment events through the JujuLeaf
Bridge, dispatches selected `@worker` tasks to Codex or Kimi Code, and reports
progress and a final summary back to the original comment thread.

## What it does

- **Comment-driven work.** Start an Agent task without leaving the Overleaf
  review thread where the request originated.
- **Explicit Agent policy.** Choose Codex, Kimi Code, or an ordered list when
  the worker starts; only configured Agents can receive tasks.
- **Visible progress.** Keep collaborators informed with concise stage updates
  and a structured final result instead of hidden terminal output.
- **Durable coordination.** Deduplicate comment events, serialize Agent turns,
  recover interrupted tasks, and resume per-thread Agent sessions.
- **JujuLeaf-native safety.** Leave Overleaf authentication, project context,
  Skill installation, synchronization, and conflict checks to JujuLeaf.

## Requirements

- Node.js 22.13 or newer
- JujuLeaf with Bridge protocol 1 support (v0.1.2 or newer) installed on `PATH`
- An authenticated JujuLeaf profile and a dedicated JujuLeaf project clone
- Codex and/or Kimi Code CLI installed and authenticated
- The JujuLeaf Skill installed for each enabled agent with
  `jujuleaf skill install`

JujuLeaf Worker does not install JujuLeaf, log in to Overleaf, or manage Agent
Skills. Those remain JujuLeaf responsibilities.

## Quick start

Use a dedicated JujuLeaf clone so unattended Agent edits do not collide with a
human working copy:

```bash
jujuleaf clone PROJECT_ID paper-worker
cd paper-worker
npx @jujuleaf/worker
```

The data flow stays deliberately small:

```text
Overleaf comment → JujuLeaf Bridge → JujuLeaf Worker → Codex / Kimi Code
       ↑                                      │
       └──────── progress and result ─────────┘
```

The first snapshot processes recent unhandled mentions from open threads.
Subsequent snapshots and events are deduplicated by Overleaf message ID.

## Choose the Agent

Codex is the only enabled Agent by default, so plain `@worker` comments go to
Codex. Choose Kimi Code instead when starting the worker:

```bash
npx @jujuleaf/worker --agent kimi
```

To enable per-comment routing, configure more than one Agent. The first Agent
handles plain `@worker` comments:

```bash
npx @jujuleaf/worker --agent codex,kimi
```

Supported comment forms for a multi-Agent worker:

```text
@worker Explain this derivation.
@worker ask Explain this derivation.
@worker codex suggest Rewrite this paragraph more concisely.
@worker kimi edit Fix this typo directly.
@worker-codex compile Diagnose the current LaTeX error.
@worker-kimi suggest Improve the academic prose.
```

`@worker` uses the first configured Agent. `@worker-codex`, `@worker-kimi`, or
the first word after the mention selects one of the other enabled Agents.
Selectors for Agents not enabled by `--agent` are ignored. Messages without an
explicit action default to `suggest`.

The mention is configurable. For example, `--mention @paperbot` enables
`@paperbot`, `@paperbot-codex`, and `@paperbot-kimi`.

Run diagnostics without starting the worker:

```bash
npx @jujuleaf/worker doctor --agent codex,kimi
```

## Options

```text
--mention <name>             Mention prefix (default: @worker)
--agent <names>              Agent(s), comma-separated; first handles @worker
                             (default: codex)
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
