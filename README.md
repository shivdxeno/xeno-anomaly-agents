# xeno-anomaly-agents

Anomaly-detection agents for Xeno. A tested script does the detection; a model is asked only
about the things a rule cannot settle.

`src/core` is the **common** half every module extends. `src/modules/<part>` is the
part-specific half. Journeys is the first module.

## Why it is shaped this way

The first version of this agent was one 2,790-line prompt (`docs/agent-v4-source.md`) that a
model executed end to end. Every run re-loaded ~58k tokens of instructions and then did window
arithmetic, threshold comparisons, ranking and Slack formatting in-context — work that is
deterministic, untestable in that form, and different every morning.

Now that work is code with 59 tests behind it, and the prompt is ~2k tokens
(`skills/journeys/SKILL.md`). A clean morning costs no model tokens at all.

## Running it as a routine

The repo is the agent. Clone it, install, and point a Claude Code routine at it:

```
Run the journeys anomaly agent for today.
```

The skill at `.claude/skills/journeys-anomaly-agent/SKILL.md` is discovered automatically and
carries the whole procedure. **The session needs three connectors enabled** — db-mcp, DevRev
and Slack — because the scripts never touch the network; the agent makes every call.

One-time setup in the clone:

```bash
yarn install
```

That is all. There is no `.env`: every value the scripts need is plain configuration in
`src/modules/<part>/spec.ts`.

### The four script invocations

The agent runs these, executing connector calls between them — the full sequence with the
call-and-save steps is in [`instructions/COMMON.md`](instructions/COMMON.md).

```bash
yarn queries --module=journeys --date=2026-09-07 --out round1.plan.json
yarn queries --module=journeys --round=2 --results round1.json --out round2.plan.json
yarn detect  --module=journeys --round1 round1.json --round2 round2.json \
             --tickets tickets.json --out findings.json
yarn plan    --in findings.json --round2 round2.json --out plan.json --tokens=<N>
```

Nothing in that list touches the network, and none of it needs a credential. `plan.json` is a
plan, not a write — read it before the agent executes it.

**Test runs: add `--test` to `yarn plan`.** It DMs `slackChannel.testDmUserName` instead of the
channel **and drops every DevRev write from the plan**. Those two are one flag on purpose — a
report in a DM with real tickets filed against real merchants is the worst of both. The plan
comes back marked `"testRun": true` with an empty `planned[]`.

The DM target is a **name**, not an id: the agent resolves it through the Slack connector at
run time, so nothing needs pasting in.

## Everything external goes through an MCP connector

There is **no database driver, no HTTP client and no credential of any kind in this repo**.
Every external system is reached through its MCP **connector**, authenticated at the Claude
Code layer — which already holds the credentials, the read-only scopes, the per-user grants
and the audit trail.

**That is why the runner is a Claude Code routine and not a cron job.** A connector cannot be
authenticated by a headless process, so the agent session makes the calls and the scripts do
the deterministic work either side of them. The scripts compose every SQL string and every
tool argument; the agent composes none of it and calculates nothing.

| What | Connector | Tool |
| ---- | --------- | ---- |
| metrics: `xeno_sql_zenmaster_new`, `mongo_journeys` | db-mcp | `query_starrocks` |
| merchant names (**prod**) | db-mcp | `query_mysql` |
| DevRev mappings (**dev** — these tables do not exist in prod) | db-mcp | `query_mysql_dev` |
| tickets | DevRev | `src/core/services/devrev/tools.ts` |
| the report | Slack | `src/core/services/devrev/tools.ts` |

## Layout

```
src/core/          common: window · gates · classify · rank · render · devrev · slack · db
src/modules/       one directory per part: spec.ts, queries/*.sql, umbrellas/
src/scripts/       the five stages plus run:daily and skill:generate
instructions/      COMMON.md + modules/<part>/MODULE.md — the prompt, split once
skills/            GENERATED SKILL.md per module. yarn skill:check fails if stale
tests/             one test per rule that cost somebody a bad morning
docs/              the original v4 prompt, kept as the rationale record
```

## Adding a module

1. `src/modules/<part>/` with `spec.ts` satisfying `TModuleSpec`, plus `queries/` and
   `umbrellas/`.
2. `instructions/modules/<part>/MODULE.md`.
3. One line in `src/core/modules/registry.ts`.
4. `yarn skill:generate`.

Nothing in `src/core` changes, and the compiler checks every module against a core change in
the same build.

## Before the first run

Two values are unknown and will block rather than guess:

1. **The Slack ids.** `spec.ts` has the channel *name*
   (`proj-data-anomaly-alerting-agents`) but not its id, so `yarn plan` stops and says so.
   Fill `slackChannel.id`, or pass `--channel`. A guessed id posts the report into silence,
   which looks like a working run. **Test runs need nothing** — `--test` resolves a name.
2. **The DevRev and Slack connector tool names** in
   `src/core/services/devrev/tools.ts`. Open the connectors' tool lists in a session and
   correct that one file. A wrong name fails on the first call.

Then do the first run with `--tokens` set and read `plan.json` before letting the agent
execute it.

## Checks

```bash
yarn lint && yarn build && yarn test:run && yarn skill:check
```

`yarn skill:check` fails when a committed `SKILL.md` no longer matches its sources — without
it, a common instruction gets fixed in one module's composed file and never reaches the others.
# xeno-anomaly-agents
