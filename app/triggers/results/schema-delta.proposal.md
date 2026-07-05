# ISSUE-047 — shared-spec proposals (schema deltas owed to change-control)

This slice does **not** edit `spec/04-data-model/schema.md` (a shared file this parallel fan-out must not
touch) and authors **no** `app/silo/migration`. The deltas below are what the live integration owes; they are
recorded here for the orchestrator to apply through change-control (same class as OD-170 / OD-179 — an FR
mandates an `event_log` write but the enum admits no matching value).

## 1. `event_type` enum — two additive values (append-only, expand-contract-safe)

`schema.md` §5 `event_type` (and `app/observability` `EVENT_TYPES`) has **no** value for either event this
slice's FRs mandate. Both are additive (never renamed/removed), so they are expand-contract-safe like OD-179.

| value | emitted by | FR / AC |
|-------|-----------|---------|
| `dispatch_frozen_blocked` | `assertNotFrozen` — every dispatch path blocked under a deployment freeze | FR-5.TRG.001 / AC-5.TRG.001.3, NFR-INF.012 / AC-NFR-INF.012.1-.2 |
| `ingest_failure` | `ingestVerifiedEvent` — a verified event that produced no `task_queue` row | FR-5.TRG.005 / AC-5.TRG.005.1 |

Proposed migration (owned for the live build by the orchestrator, NOT authored into `app/silo` here):

```sql
-- additive; expand-contract-safe (cf. OD-170 / OD-179)
alter type event_type add value if not exists 'dispatch_frozen_blocked';
alter type event_type add value if not exists 'ingest_failure';
```

Until applied, `SupabaseTriggerStore.appendEvent`'s `$2::event_type` cast raises **loudly** (never a silent
skip — #3), so the missing delta cannot hide.

## 2. `trigger_delivery` — the at-least-once delivery watermark (FR-5.TRG.005 / FR-5.GRP.003 seam)

FR-5.TRG.005 requires a **delivery watermark** so accept→`task_queue`-row is at-least-once and a re-delivery
de-dups (AC-5.TRG.005.2). The idempotency/de-dup store is **FR-5.GRP.003, owned by ISSUE-049** — this slice
only *consumes* it. `SupabaseTriggerStore.isDelivered` / `markDelivered` are authored to the shape below so
the seam is real; ISSUE-049 owns the canonical DDL (this is a proposal for that owner to reconcile, not a
migration this slice applies).

```sql
create table trigger_delivery (
  delivery_id text primary key,                 -- the connector's per-delivery id (C3 receiver contract)
  task_id     uuid not null references task_queue(id),
  created_at  timestamptz not null default now()
);
```

## 3. No migration authored here (per the ISSUE-047 §5 blast radius)

- `task_queue` — **ISSUE-048** owns the table + lifecycle; this slice writes only `type` + `payload`
  (+ `task_name` / `originating_user_id`, and chained provenance carried in `payload._parent_task_id` until
  ISSUE-048 finalises the column set). No DDL here.
- `deployment_settings` — **read-only** here (OD-162 local read); written by **ISSUE-083** (C10 OFF).
- `event_log` — written via the C7 sink (ISSUE-011); this slice adds only the two enum values above.
