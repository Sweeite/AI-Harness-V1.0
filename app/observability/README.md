# @harness/observability — ISSUE-011 (Component 7, LOG + ALR.008)

The **observability skeleton** — the #3 ("never fail silently") backbone. From this slice on, nothing the
system does can fail silently, because every silent-failure mode has a detector here.

**Offline build.** No live infra. Every AC is proven with the house **port + in-memory fake** pattern
(cf. `app/release`, `app/webhook-auth`) plus **fault-injection** tests. The live `pg` adapters
(`supabase-store.ts`) are authored to the ISSUE-008 `0001_baseline` DDL but **not run** here; they are
exercised against a real silo Supabase at integration time.

## What this slice ships

| Piece | File | FR / AC |
|---|---|---|
| Append-only `event_log` write API (redacted payload, `summary` never empty, `cost_unknown`≠0) | `event-writer.ts`, `redact.ts` | FR-7.LOG.001/002/004/005 |
| Enum guard + append-only-trigger semantics (reference model) | `store.ts`, `types.ts` | AC-7.LOG.001.1/.2/.3 |
| Silent-failure detector (terminal task ⋈ terminal event) | `detector.ts` | FR-7.LOG.003 / NFR-OBS.001 / **AF-118** |
| Out-of-band write-failure path (stderr/file + `log-write-failing` health bit) | `event-writer.ts`, `store.ts` | AC-7.LOG.003.2 / NFR-OBS.002 / **AF-119** |
| Cross-sink reconciliation (`event_log` ⋈ `guardrail_log`) | `detector.ts` | AC-7.LOG.003.3 / NFR-OBS.003 |
| Retention + redaction-tombstone (floor, never-prune-referenced, logged) | `retention.ts` | FR-7.LOG.006 / NFR-OBS.010 |
| Alert-engine watchdog (heartbeat + independent watcher → critical notification) | `watchdog.ts` | FR-7.ALR.008 / NFR-OBS.004 / **AF-118** |
| Server-authoritative time (receiver-anchored window math) | `event-writer.ts`, `retention.ts`, `watchdog.ts` | **AF-120** |

## Boundaries (Rule 0)

- **No migration authored.** `event_log`, `notifications`, the enums, `redacted_at`, and the
  `t_append_only` trigger are all created by **ISSUE-008's `0001_baseline`** (`app/silo/migrations`). This
  slice is app-code only; `src/index.ts check` verifies that schema is present (never re-creates it).
- **Watchdog / notifications lifecycle:** only the `ALR.008` watchdog + the bare `notifications` write shell
  land here. The seven alert rules, routing, escalation, and the notification-centre lifecycle are
  **ISSUE-075**. The mgmt-plane push that *carries* the health bits is **ISSUE-012** (this slice only *sets*
  the bits on a channel it exposes).

## Commands

```
npm test        # one test per §4 AC + the AF-118/119/120 fault-injection evidence
npm run typecheck
npm run check    # offline gates: CFG valid · 0001_baseline schema present · enum-guard ↔ DDL no-drift
```
