# Live-adapter hygiene sweep + the standing live-smoke gate

> **Why this exists.** The Stage-4 live-adapter review (session 71) and the Checkpoint-3 adversary check both
> found real, shippable bugs (3 BLOCKERs + 3 MAJORs in Stage 4 alone) that the offline test suites, the
> per-package adversarial verify, **and** the DB-invariant capstones all passed. Two whole bug classes are
> invisible to the offline-only process:
> 1. **fake-passes-offline / live-adapter-throws** — the in-memory fake is green while the real
>    `supabase-store.ts` would throw against the live DDL (missing/renamed column, an enum value not in the
>    type, a FK with no parent, an in-place UPDATE a version/append-only trigger rejects).
> 2. **plain correctness bugs** — code that compiles and passes its own test but is logically wrong
>    (fail-open gate, bad SQL semantics, a swallowed error, a lost-update race).
>
> Only two things catch these: **running the real adapter against the real database**, and a
> **correctness-focused read**. This doc makes that a standing gate, and defines the one-time backfill sweep
> for the stages closed before the gate existed.

## Part A — the standing gate (all future stages)

**Every stage checkpoint, before flipping issues `done`, must include a live-adapter smoke of every package
built in that stage** — not just the offline tests + the gate capstone. Each package ships a
`app/<slug>/results/live-smoke.sql`: a rolled-back (`begin; … rollback;`) plpgsql `DO`-block that **replays
the adapter's actual write-path statements** against the live DB, satisfying FKs inside the txn, asserting
each write succeeds and each guarded reject raises. Model it on
`app/silo/results/stage4-checkpoint-capstone.sql` and any Stage-4 `app/*/results/live-smoke.sql`.

**Two authoring traps (both have bitten us live):**
- **No `;` inside a comment in a `transactional:false` migration/file** — the non-transactional runner splits
  on the terminator and fragments the statement (caught live on `0007` and `0011`).
- **No explicit `SAVEPOINT` / `ROLLBACK TO SAVEPOINT` inside a plpgsql `DO`-block** — illegal; use a nested
  `begin … exception when … then … end` block (that IS an implicit savepoint).

The smoke **execution** is done serially by the orchestrator via `psql` (cheap) — only the authoring/review
fan-out spends tokens. `psql` lives at `/opt/homebrew/opt/libpq/bin/psql`; DBs are `$SILO_DB_URL` (silo) and
`$MGMT_DB_URL` (management plane); `source ~/.ai-harness-secrets.env` first (💻 FULL session only).

## Part B — the one-time backfill sweep (Stages 0–3)

Stage 4's 14 packages already have `live-smoke.sql`. The **Stage 0–3 foundation packages do not** — they were
closed before this gate existed, and they are what Stage 5 builds on top of, so harden them first.

> **Work-list input (2026-07-07 audit, session 73):** a whole-repo hygiene pass pre-found the likely defects
> Part B will confirm — see `live-adapter-backfill-findings.2026-07-07.md` (5 BLOCKER + 12 MAJOR, 4 already
> live/code-CONFIRMED incl. **B1 webhook-auth** = every live webhook write throws on a missing enum). Use it as
> the review seed per wave, but still **live-verify each finding against the real DB before fixing** (most are
> PLAUSIBLE-not-live-verified). It does not replace the per-package correctness read.

### Do NOT start until
- The **Checkpoint-3 adversary fixes are committed + pushed** (that session added migrations `0021–0023`; do
  not overlap an active fixer or you'll collide on the same files and check mid-change code).
- **First action:** `bash scripts/build-preflight.sh` (must be 💻 FULL), then **reconcile every tracker**
  (issue `status:` frontmatter · `BUILD-SCHEDULE.md` boxes + migration-chain lane note · `_backlog.md` ·
  `_journal.json` head · GitHub) — multiple sessions have touched the repo, so confirm the migration head and
  the done-set are in lockstep before doing anything.

### Method per package
1. **Correctness review** — hunt real logic bugs (not AC coverage, which is already done).
2. **Author `app/<slug>/results/live-smoke.sql`** per Part A.
3. **Orchestrator runs the smokes serially** against the DB; fix what throws; re-smoke.
4. **Skip pure-logic packages** (no `src/supabase-store.ts`) beyond a light correctness read — find the
   live-adapter set with `grep -l . app/*/src/supabase-store.ts`.

### ⏱ Token control (hard constraint — do not exceed)
- **Max 5 packages per Workflow call.** Never one giant run (the Stage-4 review was ~1M tokens for 14).
- **Operator-gated between waves:** after each wave, report findings + rough spend, then **STOP and wait for
  an explicit "go"** before the next wave.
- **Risk-ordered** (below) so stopping early still covers the load-bearing code.
- Optional: begin the session with a token target (e.g. `+400k`) — the Workflow `budget` guard then stops
  cleanly and resumes next wave.
- **Only the offline author/review work fans out.** Live steps stay serial (no agent count helps).

### Wave order (highest #1/#2/#3 + most-depended-on first)
| Wave | Packages (slug · issue) |
|---|---|
| 1 — safety & shared-runtime core | `connector-runtime` (032) · `rbac` (018/019) · `hard-limits` (055) · `guardrail-log` (060) · `injection-pipeline` (059) |
| 2 — data/audit + task core | `config-store` (010) · `observability` (011) · `task-queue` (048) · `management` (012) · `prompt-store` (042) |
| 3 — auth + trust boundary | `auth` (013) · `superadmin-auth` (014) · `webhook-auth` (017) · `anomaly-checks` (057) · `alerting` (075) |
| 4 — remaining logic | `realtime` (076) · `retention` (084) · `cost-meter` (074) · `triggers` (047) · `prompt-layer-*`/`prompt-optimisation` (043/044/046) |
| 5 — infra (lower adapter risk) | `silo` · `release` · `provisioning` · `canary` · `service` · `runbooks` |

### Definition of done (per package)
Live-smoke passes against the real DB (rolled back) + correctness findings triaged; every BLOCKER/MAJOR fixed
+ re-smoked; MINORs queued as a task. **Commit per wave.** These are already-`done` packages — this is
*hardening*, not re-opening a stage: log any real fix (and any new OD/migration) through change control, keep
trackers in lockstep, don't silently re-close.

## Part C — guardrails
- Reconcile trackers first; commit between waves; never fan out live steps.
- If a fix needs a migration, it's the orchestrator's single-writer job — pick the next free tag from
  `_journal.json` (confirm the current head first; sessions 71–72 pushed it past `0020`), semicolon-free
  comments in `transactional:false` files, run `cd app/silo && npm run check` before applying live.
- A design-level fix (like Stage 4's ISSUE-037 tools-version-lock) is a Rule-0 fork → log an OD, don't code
  around it.
