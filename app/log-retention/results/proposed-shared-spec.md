# ISSUE-077 — proposed shared-spec deltas (for the orchestrator to apply SERIALLY post-fan-out)

> These are the changes ISSUE-077 could NOT write directly (fan-out isolation rule: no edits to
> `spec/04-data-model/schema.md`, `config-registry.md`, `PERMISSION_NODES.md`, `app/silo/migrations/*`,
> `_journal.json`, or any other `app/*` package). They are proposals the integrating orchestrator applies to
> the shared files, then reconciles the trackers (Rule 0). Each is tagged verify-present / additive / amend.

The offline build (`app/log-retention/`) is proven GREEN against the DESIRED end-state (the in-memory fakes
model the guardrail_log redaction-tombstone as working). The two deltas below are what the LIVE guardrail_log
tombstone path (FR-7.LOG.007.4 / AC-NFR-CMP.007.1/.2) needs before the live adapter can succeed — they are
owed-to-live, listed here so the seam is real, not faked.

---

## 1. Migration delta — `guardrail_log.redacted_at` column (ADDITIVE) — **required for FR-7.LOG.007.4**

**Why (a real defect if skipped):** `0001_baseline.sql` L699 states plainly *"guardrail_log has no redacted_at
column (H43 fix)"*, and the append-only trigger's redaction branch is explicitly excluded from guardrail_log.
FR-7.LOG.007.4 / OD-074 require the SAME redaction-tombstone on `guardrail_log` that `event_log` already has
(scrub `description` in place, retain the security event + audit metadata). Without the column, the live
tombstone UPDATE has no target and AC-7.LOG.007.4 / AC-NFR-CMP.007.1/.2 cannot pass live.

**Proposed — a new migration** `app/silo/migrations/0011_guardrail_redacted_at.sql` (next free tag), ADDITIVE,
re-runnable (expand-contract; no DROP):

```sql
-- Migration 0011 — add the one-way redaction-tombstone target to guardrail_log (FR-7.LOG.007.4 / OD-074).
-- Reverses the 0001_baseline H43 exclusion now that C7 (ISSUE-077) owns the guardrail_log erasure path.
alter table guardrail_log add column if not exists redacted_at timestamptz;   -- one-way tombstone target
```

Append to `app/silo/migrations/_journal.json`:

```json
{ "tag": "0011_guardrail_redacted_at", "file": "0011_guardrail_redacted_at.sql", "transactional": true }
```

Mirror into `spec/04-data-model/schema.md §7 Guardrails` (`guardrail_log`): add `redacted_at timestamptz  --
one-way redaction-tombstone target (FR-7.LOG.007.4 / OD-074)` and remove/annotate the H43 "no redacted_at"
note.

## 2. Trigger amendment — `enforce_audit_append_only()`: a guardrail_log redaction branch (AMEND) — **required for FR-7.LOG.007.4**

**Why (a real defect if skipped):** in the current function (as of `0010_guardrail_escalation_nullfix.sql`)
`guardrail_log` matches the OUTER `if tg_table_name = 'guardrail_log' then …` block, whose inner clauses only
whitelist the forward *status* transition and the OD-182 escalation stamp. The one-way redaction branch lives
in a LATER `elsif new.redacted_at is not null …` — which `guardrail_log` can never reach (it already took the
outer `if`). So a guardrail_log redaction-tombstone UPDATE falls through to the final
`raise exception '… in-place UPDATE forbidden'`. The live tombstone is blocked even after delta #1 lands.

**Proposed change (additive; every existing branch preserved byte-for-byte):** inside the
`if tg_table_name = 'guardrail_log' then` block, add a THIRD clause **(c)** — the one-way redaction-tombstone —
alongside (a) the forward status transition and (b) the OD-182 escalation stamp:

```sql
    -- (c) OD-074 / FR-7.LOG.007.4 one-way redaction-tombstone: redacted_at null→ts, description scrubbed to
    --     the sentinel; every OTHER immutable field unchanged. This is the ONLY in-place content mutation
    --     guardrail_log permits, and it is distinguishable from tampering (redacted_at is set) — the C7 export
    --     integrity check (AC-7.LOG.007.3) treats it as an authorized redaction, not a tamper.
    if old.redacted_at is null and new.redacted_at is not null
       and new.description = '[redacted]'
       and new.status = old.status
       and new.task_id is not distinct from old.task_id
       and new.guardrail_type = old.guardrail_type
       and new.action_blocked = old.action_blocked
       and new.reviewed_by is not distinct from old.reviewed_by
       and new.reviewed_at is not distinct from old.reviewed_at
       and new.escalated_at is not distinct from old.escalated_at
       and new.created_at = old.created_at then
      return new;
    end if;
```

Place this migration in the SAME file as delta #1 (`0011_guardrail_redacted_at.sql`), via
`create or replace function enforce_audit_append_only()` (re-binds nothing — the four `t_append_only` triggers
already point at the function name). Mirror the new branch into `schema.md §Global rules`
(`enforce_audit_append_only`).

**NFR-CMP.006 note:** this is the ONLY new in-place mutation; normal writes stay immutable, DELETE stays gated
by the 0005 retention-prune whitelist. The append-only posture is unchanged for every non-redaction path.

---

## 3. Verify-present (already in the shared files — NO change needed, listed for the orchestrator's check)

- **`event_log.redacted_at`** — present (`0001_baseline.sql` L494) + the trigger's `elsif new.redacted_at …`
  branch already permits the event_log one-way tombstone (0005/0009/0010). FR-7.LOG.006.3 works live as-is.
- **Retention-prune DELETE whitelist** — present (`0005_retention_prune_whitelist.sql`, OD-180): a DELETE on any
  audit sink is permitted only inside a `set local app.retention_prune='on'` transaction. Both `runEventLogRetention`
  and `runGuardrailLogRetention` prune through this path (the live `supabase-store.ts` wraps each prune in that
  transaction). FR-7.LOG.006.1 / FR-7.LOG.007.2 / NFR-OBS.010 work live as-is.
- **`PERM-compliance.download_records`** — present (`PERMISSION_NODES.md` L110, default **Super Admin
  (unseeded)**, intra-client). The export gate (`app/log-retention/src/export.ts`) consumes it; ISSUE-018 seeds
  the catalog. No change.
- **CFG keys** — `event_log_retention_window` (365 d, BOOT — config-registry.md L219),
  `deployment_staleness_window` (15 min, LIVE — L228), `polling_interval_health_metrics_s` (30 s, LIVE — L229),
  `price_table` (App. A, LIVE — L235) all present. This slice reads defaults from them (`src/config.ts`); no
  new key is introduced. **The per-sink retention FLOORS are deliberately NOT keys** (OD-072 — a C10/Phase-5
  compliance input); this slice enforces the CONTRACT ("window ≥ floor", clamp-up-to-floor on prune) with the
  floor as a parameter, and invents no numeric legal minimum.
- **`deployment_health` / `client_registry` (management plane, schema.md §13)** — the reporter push targets +
  the cross-deployment view sources are ISSUE-012-owned; this slice only READS their shapes (the C7 view
  contracts) and enforces the operational-metadata allow-list against `deployment_health`'s column set. No
  change to §13. The allow-list in `src/mgm.ts` is kept in lockstep with `@harness/management`'s allow-list; a
  check-time parity gate (`src/index.ts` gate 3) asserts they match the schema §13 operational columns.
- **`push_subscriptions` (schema.md, FR-7.VIEW.003)** — present (`0001_baseline.sql` L529). Read-only here (the
  mobile push routing target). No change.
- **No new C7 table** — per §8 build note, this slice introduces NO new table (the review-signal substrate
  INDEXES the existing event_log/guardrail_log/memory-flag rows; it does not add storage).

---

## 4. Cross-package note (no action, informational)

`@harness/log-retention` re-implements the mgmt-plane reporter/allow-list/staleness/cross-deployment contracts
(FR-7.MGM.*) that also live in `@harness/management` (ISSUE-012), because the offline fan-out workspace has no
cross-package module resolution (no root workspace / node_modules). They are kept byte-faithful to the same
schema.md §13 field list and AF-118/AF-120 shapes. If the integrator later wires a workspace, the C7 MGM
surface in `src/mgm.ts` SHOULD be collapsed onto `@harness/management`'s exports (single source of truth) — the
allow-list parity gate exists to catch any drift until then.
