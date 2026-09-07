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

## Running it

```bash
cp .env.example .env          # values come from Infisical, never committed
yarn install

# one command — what the CronJob runs
yarn run:daily --module=journeys --channel=$SLACK_CHANNEL_ID

# or stage by stage
yarn detect  --module=journeys --date=2026-09-07 --out findings.json
yarn render  --in findings.json --out messages.json --channel=$SLACK_CHANNEL_ID
yarn tickets:plan  --in findings.json --out plan.json
yarn tickets:apply --in plan.json          # the ONLY stage that writes to DevRev
yarn post    --in messages.json
```

`--dry-run` on `tickets:apply`, `post` or `run:daily` prints what would happen and writes
nothing. Use it for the first live run.

## Stores

| What | Where | Why separate |
| ---- | ----- | ------------ |
| all metrics | StarRocks `xeno_sql_zenmaster_new`, `mongo_journeys` | speaks the MySQL wire protocol, so one driver |
| merchant names | **prod** MySQL `zenmaster_new.merchant` | source of truth for names; never metrics |
| DevRev mappings | **dev** MySQL `zenmaster_new.devrev_*` | those tables do not exist in prod |

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

## Checks

```bash
yarn lint && yarn build && yarn test:run && yarn skill:check
```

`yarn skill:check` fails when a committed `SKILL.md` no longer matches its sources — without
it, a common instruction gets fixed in one module's composed file and never reaches the others.
