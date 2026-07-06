# ISSUE-056 (approval-tiers) — proposed shared-spec deltas

Isolation rule: this package touched ONLY `app/approval-tiers/`. Everything below is a precise description of
an additive shared delta for the orchestrator to apply SERIALLY after the fan-out. Nothing here was edited by
this agent. Deltas are ranked; the two 🔴 items are load-bearing for the live escalation/Hold paths.

---

## VERIFY-PRESENT (already in the baseline / registers — no change needed, confirmed by read)

1. **`guardrail_log.escalated_at timestamptz`** — present, `app/silo/migrations/0001_baseline.sql` L463
   (`⊕ net-new owed to C6 (server-owned)`). ✅
2. **`guardrail_log` CHECK `not (guardrail_type='hard_limit' and status='approved')`** — present, baseline L465
   (`AC-6.LOG.001.2: no override`). The workflow relies on this DB CHECK as the backstop for the no-override
   guard (AC-6.ESC.001.2). ✅ (ISSUE-055 owns proving it live.)
3. **`task_queue.originating_user_id uuid references profiles(id)`** — present, baseline L408 (`⊕ net-new owed
   to C5 (no-self-approval + My Queue)`). Consumed for the no-self-approval check (AC-6.APR.005.3). ✅
4. **`task_queue.action_payload jsonb`** — present, baseline L409. Consumed for the Modify resolution. ✅
5. **`task_status` enum includes `flagged` + `awaiting_approval`** — present, baseline L52. ✅
6. **`guardrail_status` enum = `pending|approved|rejected|modified`** — present, baseline L56. ✅
7. **`PERM-action.review`** — already MINTED in `PERMISSION_NODES.md` L162 under the **Approval Authority**
   category (OD-117 / FR-1.PERM.007), scope `intra-client (+ no-self-approval + matching clearance, per-item)`.
   ✅ No mint needed.
8. **Config keys** `approval_soft_timeout` (default **10 min**) + `approval_escalation_timeout` (default **4 h**)
   — present in `spec/02-config/_HARVEST.md` L147–148 and gated by `PERM-config.guardrails` in
   `app/silo/migrations/0003_config_values_rls.sql` L149–150. `DEFAULT_APPROVAL_CONFIG` in this package uses the
   same two defaults. ✅
9. **RLS on `task_queue` / `guardrail_log` / `injection_quarantine` reads** gated by `PERM-action.review` —
   already specified in `spec/04-data-model/rls-policies.md` L68/71/72. ✅ (Live RLS proof owed at checkpoint.)

---

## 🔴 DELTA-1 (REQUIRED for the live escalation path) — append-only trigger must permit an `escalated_at`-only forward UPDATE on `guardrail_log`

**Problem.** The append-only trigger `enforce_audit_append_only()` (baseline L688–705) whitelists exactly ONE
`guardrail_log` UPDATE shape:

```sql
if tg_table_name = 'guardrail_log'
   and old.status = 'pending' and new.status in ('approved','rejected','modified')
   and new.description = old.description and new.task_id = old.task_id then
  return new;   -- forward status transition
end if;
```

The escalate-don't-abandon path (`escalateStaleWaits`, AC-6.ESC.004.1 / AC-NFR-OBS.007.1) must set
`escalated_at = now()` on a row that **stays `pending`** (escalation must NOT resolve the item). That UPDATE is
`old.status='pending' and new.status='pending'`, so it falls through the whitelist → the trigger raises
`in-place UPDATE forbidden`. The live `SupabaseApprovalWorkflow.escalateStaleWaits` therefore currently throws
`ERR_ESCALATED_AT_NEEDS_DELTA` rather than half-doing it. The offline reference model proves the logic; the live
path is blocked on this delta.

**Proposed additive delta** (edit the whitelist to add an escalation branch that mutates ONLY `escalated_at` and
nothing else — still append-only in spirit, monotonic, forward-only):

```sql
-- inside enforce_audit_append_only(), for tg_table_name = 'guardrail_log', ADD before the final raise:
if tg_table_name = 'guardrail_log'
   and new.status = old.status                         -- status UNCHANGED (escalation never resolves)
   and old.escalated_at is null and new.escalated_at is not null  -- one-way: null → set, never cleared/moved
   and new.description = old.description
   and new.task_id = old.task_id
   and new.reviewed_by is not distinct from old.reviewed_by
   and new.reviewed_by is null then                    -- only an un-reviewed (still-pending) row escalates
  return new;                                           -- server-owned escalation stamp (AC-6.ESC.004.1)
end if;
```

Rationale: monotonic one-way (`null → timestamp`, never modified again — mirrors the redaction-tombstone
pattern already in the trigger), status unchanged, description/task_id/reviewed_by fixed. It cannot be used to
resolve or tamper a row. Owning slice for the trigger DDL is ISSUE-060 (LOG); this is a change-control edit to a
locked baseline object, so it goes through the orchestrator, not this package.

---

## 🔴 DELTA-2 (REQUIRED for the live Hold-for-full-review path) — persisting the OD-120 soft→explicit promotion

**Problem.** Hold-for-full-review (AC-6.APR.003.3 / OD-120) promotes a soft item to explicit approval while the
row **stays `pending`** (it is not yet resolved — a human is mid-review). The reference model records the
promotion by appending a note to `description`. On the live row that is (a) a `pending→pending` UPDATE and (b)
`new.description <> old.description` — both disqualify it from the trigger whitelist → the trigger raises. The
live `holdForFullReview` currently throws `ERR_ESCALATED_AT_NEEDS_DELTA` rather than half-doing it.

**Two options — orchestrator picks one:**

- **(A) Store the Hold flag out-of-band, not in `description`.** Add a nullable server-owned column
  `guardrail_log.held_for_review_at timestamptz` and whitelist a one-way `null → set`, status-unchanged,
  description-unchanged UPDATE (identical shape to DELTA-1, keyed on `held_for_review_at`). This is the cleaner
  option: it keeps `description` immutable (honouring the existing whitelist intent) and makes the Hold a
  first-class, queryable state for the surface-04 badge. **Preferred.**
  ```sql
  alter table guardrail_log add column held_for_review_at timestamptz;  -- ⊕ OD-120 Hold badge, server-owned
  -- + a whitelist branch mirroring DELTA-1, keyed on old.held_for_review_at is null and new is not null.
  ```
- **(B)** Reuse DELTA-1's escalation stamp mechanism generically for any server-owned one-way stamp column and
  add `held_for_review_at` under it. Same DDL surface, fewer trigger branches.

If neither column is added, the live Hold cannot persist and OD-120 is offline-only. (The offline reference
model + AC test fully prove the *logic*; this delta is purely about live persistence under the append-only
trigger.)

---

## DELTA-3 (nice-to-have, NOT blocking) — `access_audit.audit_type` value for approval resolutions

The live `resolve()` appends an `access_audit` row with `audit_type='approval_resolution'` and
`action ∈ {approve,reject,modify}` (per FR-6.APR.002.2 / the §5 access_audit-append obligation). `access_audit`
has no CHECK on `audit_type` (it is free `text`, baseline L213), so no schema delta is strictly required —
flagging only so the audit-type vocabulary register (if one is maintained) records `approval_resolution` as a
known value. **Verify-present / no code delta.**

---

## No other deltas

No new tables, types, config keys, or PERM nodes are introduced by this slice. No `client_slug` is written or
carried (OD-096). No `schema.md` doc change is required beyond the two trigger/column deltas above, which the
orchestrator applies to the LOG-owned trigger object (ISSUE-060) and `schema.md §7`.
