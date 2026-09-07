# Journey Anomaly Agent — module instructions

What this module watches: **journey communications**. Whether a merchant's journeys are still
sending, still arriving, and still reaching the customers who entered them.

Everything mechanical about that lives in code:
`src/modules/journeys/spec.ts` (name, caps, field labels, known-chronic, exclusions),
`src/modules/journeys/umbrellas/` (the closed slug list) and
`src/modules/journeys/queries/` (the twelve SQL files). **Read those, never restate them.**

## The stores

| What | Where | Tool |
| ---- | ----- | ---- |
| all metrics | `xeno_sql_zenmaster_new.commlog_aggregate`, `mongo_journeys.*` | `mcp__db-mcp__query_starrocks` |
| merchant names | `zenmaster_new.merchant` | `mcp__db-mcp__query_mysql` — **prod** |
| DevRev field resolution | `zenmaster_new.devrev_*` | `mcp__db-mcp__query_mysql_dev` — **dev** |

The last two are different MySQL instances. None of the `devrev_*` tables exist in prod.

`detect` issues these itself. You only need this table when a stage reports a store error and
you are naming which store failed.

## ⚑ THE BLIND SPOT — the one thing that makes this module hard

`commlog_aggregate` is built from `communication_log`. **A journey step that fails _upstream_
of the communication step never creates a row** — not a zero, an absence. No volume threshold
can see it. A `points` or `reward` step calling an external API that fails drops the customer
out of the journey with nothing, and every volume metric still reads healthy.

`mongo_journeys.journeysteplogs` is the only table that sees it, and query 10 is the only
query that reads it. **A run that skipped query 10 has not checked the platform**, however
clean the volume numbers look. `detect` runs it unconditionally; if its output says the
step-log census was skipped or empty, that is a defective run and not a clean morning.

## Facts that shape a judgment call

These are the ones that change how you read an output. Everything else is enforced in code.

- **A single blast inside the baseline manufactures a collapse.** The script compares against
  the baseline's typical day when one day dominates, and tells you when it did. A finding the
  script disqualified this way is not a finding — do not reinstate it because the percentage
  looked dramatic.
- **`A-Control` is a zero-send holdout**, not a broken arm. A/B integrity findings that turn
  out to be `A-Control` are not incidents.
- **A paused journey that stopped sending is an explanation, not a mystery.** The journey
  status prints for exactly this reason; read it before calling something a break.
- **A status-code change is one incident, not two.** A 404 stopping and a 401 starting the same
  day is someone fixing the URL and breaking auth doing it.
- **Delivery receipts arrive late**, so the freshest day reads low. The script's ratio check
  separates that from a real decline; when it reports the check as inconclusive, that is
  judgment call #2 and it is yours.

## Assigning an umbrella to a novel error

The slug list in `umbrellas/` is closed and append-only. For an error that matches nothing:

1. Does it describe a **call to something outside the journey engine** that failed?
   → `intermediate-processing-failing`.
2. Does it name **one content variant or one template**? → `content-variant-stopped`.
3. Does it describe a message that **went out but was never confirmed**?
   → `delivery-receipts-not-returning`.
4. Anything else → **`uncategorised`**, and say how many findings landed there in the
   `Overview` caveat so somebody can add the slug it needed.

Never force a finding into the nearest-looking slug to avoid `uncategorised`. An honest
`uncategorised` count is how the list grows correctly; a forced match corrupts the
`IncidentKey` for every future run of that incident.

## Ticketing values

`spec.ts` carries them. Two are worth knowing when you read a plan:
`productModule` is `Journeys`, which routes to pod **MA** — a wrong value routes to
`Unassigned`. And the ticket title prefix is `[Journey Anomaly Agent]`, which is what the next
run's lookup filters on. **A hand-filed test or demo ticket must NOT carry that prefix.**
