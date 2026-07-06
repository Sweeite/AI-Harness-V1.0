# ISSUE-034 (rate-limiting) — proposed shared-spec deltas

This slice touched ONLY `app/rate-limiting/`. The deltas below are additive changes to SHARED files that this
slice may not edit directly (schema.md, the baseline migration, PERMISSION_NODES, config-registry). The
orchestrator applies them SERIALLY after the fan-out. Everything is expand-contract-safe (additive only).

---

## 1. NEW TABLE — `rate_limit_deferred` (the persisted 95% deferral queue) — REQUIRED

**Why:** FR-3.RL.004 / AC-3.RL.004.1–2 require the 95% pause tier to enqueue non-critical calls on a
**persisted** queue that **survives a runtime restart** (no silent drop, #3) and, on drain, **re-consults the
idempotency guard** before re-firing a write (→ FR-3.CONN.004). The baseline DDL has `rate_limit_tracker` and
`idempotency_ledger` but **no deferral-queue table** — an in-memory queue would violate the restart-durability
AC. This is net-new and must live in the client silo (no `client_slug`, ADR-001 / FR-3.RL.007, mirroring the
other C3 tables).

**Proposed DDL (author into schema.md §4 Tools & Connectors + a new expand migration, C3 group):**

```sql
create table rate_limit_deferred (                       -- net-new (FR-3.RL.004 persisted 95% queue)
  id              uuid primary key default gen_random_uuid(),
  connector       text not null,
  window_label    text not null,                          -- the tracker window this call was paused against
  run_after       timestamptz not null,                   -- = the window's reset_at at enqueue time
  risk_level      text,                                   -- carried across the pause so drain can re-route
  irreversible    boolean not null default false,         -- (an irreversible write never queues — it halts;
                                                           --  kept for completeness + drain-time assertion)
  urgency         text not null,                           -- 'urgent' | 'background' (explicit, FR-3.RL.003)
  idempotency_key text,                                    -- present for writes → drain re-consults the guard
  enqueued_at     timestamptz not null default now(),
  drained_at      timestamptz                              -- null = pending; set when drained (survives restart)
);
create index rate_limit_deferred_due_idx
  on rate_limit_deferred (run_after) where drained_at is null;  -- the drainDue() scan
```

Notes for the applier:
- **No `client_slug`** — physical isolation is the silo boundary (FR-3.RL.007 / ADR-001), consistent with
  `rate_limit_tracker` and the other C3 tables. A REG.004-style lint should include this table in its
  "no client-identity column" assertion.
- The live adapter (`app/rate-limiting/src/supabase-store.ts`) already references this table + the
  `for update skip locked` drain claim; until the table exists its queue methods reject at the DB. The
  in-memory fake proves the contract offline.
- `urgency` / `risk_level` could be enums; left as `text` to match how `rate_limit_tracker.window_label` is
  modelled (text) and to avoid a new enum type. Applier may promote to enums if the house prefers.

---

## 2. `event_type` ENUM — add 4 rate-limit values — REQUIRED

**Why:** FR-3.RL.003/004/005/006 observability requires this slice to EMIT loud events for every tier decision
(throttle-engaged / pause+queued-count / 429+backoff / halt+escalation) so #3 (never fail silently) holds and
C7 (ISSUE-076/078) can surface them. The baseline `event_type` enum (0001_baseline.sql L60-65) has NO
rate-limit values.

**Proposed additive enum values (expand-contract-safe — `alter type ... add value`):**

```sql
alter type event_type add value if not exists 'rate_limit_throttled';      -- 80% tier engaged / header divergence
alter type event_type add value if not exists 'rate_limit_paused';         -- 95% tier: pause + queued-count
alter type event_type add value if not exists 'rate_limit_backoff';        -- 429 + backoff delay
alter type event_type add value if not exists 'rate_limit_halt_escalated'; -- high-risk halt + escalation raised
```

The `RateLimitEventType` union in `store.ts` is the authoritative list; keep the enum in lockstep. The
halt-escalate event is the upstream hook ISSUE-058 (C6) is verified to consume (issue §9).

---

## 3. CONFIG KEYS (config-registry / Phase-2 taxonomy) — verify-present / add if absent

FR-3.RL.008 names these per-connector, live (no-redeploy) config keys. They are cited in the issue §5 CFG list
and the FR. If already registered in the Phase-2 config taxonomy, **verify-present**; if not, add them
(class: per-connector operational limit; Admin/Super-Admin edit, default-deny — PERM-tool.manage):

- `CFG-rate_max_calls_per_connector_window` — per-connector window limit (seeded from the dossier caps).
- `CFG-rate_alert_threshold` — default `0.80` (the 80% tier boundary).
- `CFG-backoff_initial_ms` — default `1000`.
- `CFG-backoff_max_ms` — default `60000` (the hard cap; backoff never exceeds it).
- `CFG-backoff_multiplier` — default `2`.

This slice consumes them via `RateLimitConfig` (defaults in `DEFAULT_RATE_LIMIT_CONFIG`); the live wiring to
the config store lands with the config-admin surface (ISSUE-086) + the connector instances (039/040/041).

---

## 4. VERIFY-PRESENT (believed already in the baseline — no change asked)

- **`rate_limit_tracker`** — present (0001_baseline.sql L336-347), columns
  `connector, window_label, window_start, window_duration (interval), call_limit, calls_made, reset_at`,
  `unique(connector, window_label)`. The adapter reads `window_duration` via `extract(epoch ...)` → seconds.
  ✅ verify-present, no change.
- **`idempotency_ledger`** — present (0001_baseline.sql L350-355). Consumed read-only on queue-drain via the
  `IdempotencyGuard` port (owned by ISSUE-032 / FR-3.CONN.004). ✅ verify-present, no change.
- **`tools.risk_level`** — present (0001_baseline.sql L309, `text`). Read by the runtime to classify the
  FR-3.RL.006 halt route (supplied into `CallContext.riskLevel`). ✅ verify-present, no change.
- **`PERM-tool.manage`** — gates the FR-3.RL.008 config edits (issue §5). Homed in C1; this slice does not
  define it. ✅ verify-present in PERMISSION_NODES; no change requested here.

---

## 5. RESIDUAL AFs (owed-to-live — per-connector backoff, finalize under ISSUE-039/040/041)

Per issue §4 / §9, three feasibility items scope the **per-connector** backoff (they finalize when the real
caps + `Retry-After` behaviour are wired in the connector instances, not here). The GENERIC backoff built here
degrades safely when no `Retry-After` is present (proven offline: exponential+jitter capped at max):

- **AF-093** — GHL outbound 429 has no documented `Retry-After` → app-side exponential backoff. (SPIKE/EVAL,
  owed under ISSUE-039.)
- **AF-104** — Google jitter is our addition, not vendor-mandated. (DOCS, owed under ISSUE-040.)
- **AF-086** — Slack quota-introspection headers beyond `Retry-After`. (SPIKE, owed under ISSUE-041.)

Also owed-to-live (Stage-4 checkpoint, a 💻 full/live env), NOT provable offline: the live pg adapter paths —
tracker source-of-truth under concurrent writers, the persisted-queue restart-durability against a real table,
conservative-header reconciliation, and the halt-escalate INSERT landing on the live `event_log`. The
in-memory fake is the proven reference model; the adapter is authored to the DDL and typechecks but is NOT run
live in this offline fan-out.
