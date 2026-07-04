# ISSUE-004 — restore-rehearsal spike (AF-069 gate)

Runnable restore-rehearsal harness for **[ISSUE-004](../../spec/06-issues/ISSUE-004-restore-rehearsal-spike.md)**.
It proves — by a **real, logged restore** of a recent backup into a **throwaway** Supabase project —
that the backup comes back **complete + queryable**: the **pgvector memory rows** return **with their
embeddings** (a vector similarity query works), the **`auth.users` rows** survive (count matches +
resolvable), and the end-to-end restore **downtime (RTO)** is a **measured** number, not an assumed
one. On PASS, **AF-069** flips 🔴→🟢 — one of the six launch go/no-go **SPIKE-GATEs**
(`test-strategy.md` §4). It exercises **both** backup paths ADR-008 defines: the in-project PITR/daily
backup **and** the off-platform `pg_dump`.

Stack: **TypeScript / Node** ([ADR-009](../../spec/00-foundations/adr/ADR-009-implementation-stack.md)) + `pg`.

> **This is an R8 "you-present" spike.** It runs against the **operator's real Supabase infra and
> backup-ops credentials**, which we do not have at build time. The harness is **built and ready**;
> it has **not been run**, and `results/` holds only [`PENDING.md`](results/PENDING.md) — no fabricated
> evidence. `main.ts` **refuses to run and prints exactly which env vars are missing** rather than
> silently "passing" with no infra (a #3 silent-failure guard).

## What it does (maps 1:1 to ISSUE-004 §8 build order)

| Step | File | What |
|---|---|---|
| 1 declare profile | `src/config.ts` | The representative source corpus (a few thousand `memories` with `vector(1536)` embeddings + a set of `auth.users`) + which paths to exercise, **derived from which env vars are set**. **Contestable by design.** |
| — connections | `src/db.ts` | Direct (session-mode, **port 5432**) pools for SOURCE and TARGET(s) — same GUC/DDL caveat as ISSUE-002. Every URL is an operator-provided env var (nothing hard-coded). |
| 2 (source data) | `src/seed.ts` | Seeds representative data into the SOURCE **only if it is empty** (idempotent): `vector` ext + a `memories(vector(1536))` table with rows (embeddings server-side) + `auth.users` rows — so the backup has something meaningful to restore. Never rewrites operator data. |
| 2 path B dump | `src/dump.ts` | Drives path B half 1: `pg_dump -Fc` of SOURCE (public + auth schemas) → `results/`, or accepts a pre-existing artifact via `PGDUMP_ARTIFACT`. |
| 3 restore | `src/restore.ts` | Path B: `pg_restore` the artifact into the throwaway `TARGET_DB_URL` (harness-driven, end-to-end). Path A: asserts against `TARGET_A_DB_URL` — the throwaway project the operator restored the **in-project** backup into **out-of-band** (see caveat). |
| 4 assert | `src/assert.ts` | Completeness + queryability vs source: `memories` count matches · embeddings **not null / right dim** · a **cosine `<=>` similarity query returns rows** · `auth.users` count matches + a sampled user **resolves**. Structured pass/fail per assertion. |
| 5 measure RTO | `src/rto.ts` | Times the restore per path → the **measured** RTO (AC-NFR-DR.005.1). Path B: harness wall-clock. Path A: the operator-recorded `TARGET_A_RESTORE_MINUTES`. |
| 6–7 evidence | `src/report.ts` | Emits the AF-069 evidence block (fields a–h) → `results/af-069-evidence.<date>.{json,md}` **at run time only**. |
| orchestrate | `src/main.ts` | env-gate (refuse if infra absent) → seed → dump → restore (A and/or B) → assert → time → evidence → verdict + teardown reminder. |

## Run

```bash
npm install
cp .env.example .env      # fill in the operator's connection strings (see .env.example)
npm run spike             # gates on env → seeds source if empty → dump → restore → assert → results/
npm run spike:teardown    # prints the manual teardown checklist (delete throwaway project + dump)
npm run typecheck
```

**Prerequisites (operator side):** a SOURCE Supabase project (`SOURCE_DB_URL`); a **throwaway** target
project for path B (`TARGET_DB_URL`, disposable — deleted after); optionally a second throwaway project
the operator restored the **in-project** backup into out-of-band for path A (`TARGET_A_DB_URL`); the
Postgres **client tools** (`pg_dump` / `pg_restore`) on PATH, matching the server major version. Use the
**direct** connection (session mode, port 5432) — the transaction pooler can break the DDL/session state
the restore + assertions need. See **"What I need from the operator"** below and `.env.example` for the
exact list.

## The three acceptance criteria this proves

- **AC-NFR-DR.003.1** — the restored throwaway project has **pgvector memory AND `auth` rows complete +
  queryable** within acceptable downtime (embeddings intact, similarity query works, users resolvable).
- **AC-NFR-DR.003.2** — the rehearsal **logs its result + timestamp** (this is the first, manual run;
  the standing automated cadence + stale/lapse alert is ISSUE-085).
- **AC-NFR-DR.005.1** — the recorded restore is backup-restore-**with-bounded-downtime**, and the RTO is a
  **MEASURED** number, not an assumed one.

PASS on the exercised path(s) ⇒ AF-069 → 🟢. Paste the emitted markdown block into
[feasibility-register.md](../../spec/00-foundations/feasibility-register.md) block I.

## What this proves — and what it does not

- **Proves (AF-069):** a recent backup restores complete + queryable (pgvector memory embeddings +
  `auth.users`), and yields a **measured** RTO — the non-negotiable #1 backup guarantee is proven, not
  assumed, before go-live.
- **Does NOT prove (out of scope, ISSUE-004 §2 — owned by ISSUE-085):** the **standing** automated
  rehearsal cadence + lapse/stale **alert wiring**; scheduling the **hourly** off-platform dump +
  client-owned-destination provisioning (ISSUE-007); whether the hourly dump **fits-the-hour at scale**
  (AF-072, LOAD); the Management-API backup-health payload (AF-070); **region/residency** confirmation
  (AF-071, DOCS); off-platform **purge-on-erasure** (NFR-DR.009 / AF-137). Random embeddings are correct
  here — the spike proves embeddings **survive the restore**, not that they are relevant (AF-002/ISSUE-025).

## Honesty caveats (read before running)

- **Path A cannot be driven by a connection string.** The in-project daily/PITR backup is restored by
  **Supabase itself** — dashboard **"Restore"** / Management API / **PITR** — into a **new project**, not by
  piping a URL to `pg_restore`. So the harness does **not** perform the path-A restore: the operator restores
  the in-project backup into a throwaway project **out-of-band**, records the wall-clock, and hands the harness
  that project's `TARGET_A_DB_URL` (+ `TARGET_A_RESTORE_MINUTES`). The harness then runs the **same**
  completeness/queryability assertions against it. This keeps path A honest — we assert what was restored; we
  never claim to have driven a restore we structurally can't.
- **Path B is fully harness-driven** (`pg_dump` → `pg_restore`), so its RTO is a fully measured wall-clock
  number.
- **PITR / daily-backup availability is plan-tier gated.** Daily backups and (especially) **Point-in-Time
  Recovery** require a paid Supabase tier and PITR add-on; a free-tier project may have no in-project backup to
  restore for path A. If path A isn't available on the operator's tier, run **path B only** — the evidence
  records path A honestly as **"not exercised"**, and the go/no-go still needs the operator to confirm path A on
  the real production tier before launch.
- **The throwaway target receives a full restore including `auth` rows** — treat it as disposable and delete it
  at teardown. The local dump artifact may hold **real client data** (gitignored; delete it too).

## What I need from the operator (before this can run)

1. **A SOURCE Supabase project** + its **direct** connection string (port 5432) → `SOURCE_DB_URL`. May be
   empty (the harness seeds a representative corpus) or already hold representative data.
2. **A throwaway Supabase project for path B** + its direct connection string → `TARGET_DB_URL`. Disposable —
   created for this rehearsal, **deleted after**. It will receive a full `pg_restore` of the source.
3. *(Path A, optional but needed for the full gate)* **A second throwaway project the operator restores the
   in-project backup into out-of-band** (dashboard "Restore" / Management API / PITR), its direct connection
   string → `TARGET_A_DB_URL`, and the observed restore wall-clock → `TARGET_A_RESTORE_MINUTES`.
4. **Postgres client tools** (`pg_dump`, `pg_restore`, `psql`) installed on PATH, version **≥ the server major**
   (Supabase is currently PG 15/17). Check: `pg_dump --version`.
5. **Plan-tier note:** confirm the SOURCE project's tier actually **has** the in-project backups / **PITR** you
   intend to rehearse for path A (paid tier + PITR add-on). If not, path A must be re-run on the real production
   tier before go-live; path B alone can still run today.
6. *(Optional automation)* a **Supabase Management API** personal access token + `SOURCE_PROJECT_REF`
   (`SUPABASE_MGMT_TOKEN`, `SOURCE_PROJECT_REF`) if you want to enumerate/trigger the in-project backup
   programmatically — but note the restore target is still a Supabase-managed project we assert against via
   `TARGET_A_DB_URL`, not a psql restore.

## On ⛔ FAIL

A backup that does not restore complete + queryable is a **non-negotiable #1 catastrophe** (knowledge lost).
Per **R2 / R9 / RP-1**, AF-069 **stays 🔴**, a **launch-blocking OD** is opened, and the **design does not
proceed** — the backup/DR mechanism ([ADR-008](../../spec/00-foundations/adr/ADR-008-backup-dr.md)) must change
and **re-rehearse** before go-live. [ISSUE-085](../../spec/06-issues/) stays blocked. A FAIL is a design fork,
not a bug to code around.

## Output

`results/af-069-evidence.<date>.{json,md}` — paste the markdown block into
[feasibility-register.md](../../spec/00-foundations/feasibility-register.md) block I (AF-069) and flip 🔴→🟢 on
PASS. Until then, `results/` holds only [`PENDING.md`](results/PENDING.md).
