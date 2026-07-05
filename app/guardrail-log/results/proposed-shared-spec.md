# ISSUE-060 — proposed shared-spec deltas (for the orchestrator to mirror into the shared files)

> These are the changes ISSUE-060 could NOT write directly (Rule 0 / fan-out prohibition: no edits to
> `spec/04-data-model/schema.md`, `config-registry.md`, `app/silo/migrations/*`). They are proposals the
> integrating orchestrator applies to the shared files, then reconciles the trackers.

## 1. Migration 0009_guardrails (serves BOTH ISSUE-060 and ISSUE-059)

**File:** `results/proposed-migration-0009_guardrails.sql` — mirror into `app/silo/migrations/0009_guardrails.sql`
and append to `app/silo/migrations/_journal.json`:

```json
{ "tag": "0009_guardrails", "file": "0009_guardrails.sql", "transactional": true }
```

It stands up the schema §7 Guardrails group in dependency order: enums first
(`guardrail_type` 5 values, `guardrail_status`, `quarantine_decision`), then `guardrail_log` (with the
`check (not (guardrail_type='hard_limit' and status='approved'))` constraint), then `injection_quarantine`
(FK → `guardrail_log(id)`), then binds the shared append-only trigger to both. **No `client_slug` column**
(OD-096 / FR-10.ISO.001).

This is already exactly the DDL in `schema.md §7` — it is a faithful mirror, not a change, EXCEPT delta #2 below.

## 2. `enforce_audit_append_only()` — additive `injection_quarantine` branch (schema.md §Global rules)

**Why (a real defect if skipped):** the function today (schema.md §Global rules, L44–69) has only a
`guardrail_log` branch plus a `redaction-tombstone` `elsif new.redacted_at is not null` branch. But
`injection_quarantine` has **neither a `status` nor a `redacted_at` column**. Binding the UN-amended trigger to it
would:
- **crash** on the `elsif new.redacted_at is not null` reference — `record "new" has no field "redacted_at"` — on
  *any* update to a quarantine row; and
- **reject** the legitimate forward `human_decision` transition (`pending → discard | approved_safe`), which
  ISSUE-059's quarantine review pipeline needs.

**Proposed change (additive, every existing branch preserved byte-for-byte):** add an
`elsif tg_table_name = 'injection_quarantine'` branch that whitelists the one forward decision transition:

```sql
  elsif tg_table_name = 'injection_quarantine' then
    if old.human_decision is null and new.human_decision in ('discard','approved_safe')
       and new.quarantined_content = old.quarantined_content
       and new.guardrail_log_id = old.guardrail_log_id then
      return new;                                     -- forward human_decision transition (content shadow-retained)
    end if;
```

The full `create or replace` is in the migration (§4a). Note the shadow-retain invariant it enforces: even a
`discard` decision does **not** delete the row and does **not** rewrite `quarantined_content` — the content is
retained (ADR-007 pt4). **Mirror this branch into `schema.md §Global rules`** so the repo stays the source of truth.

*(Placement: this branch must sit BEFORE the `elsif new.redacted_at is not null` branch — as it does in the
migration — so the quarantine path never reaches the `redacted_at` reference.)*

## 3. §12 Config cluster — two learning enable/disable knobs (schema.md §12 / config-registry.md)

ISSUE-060 §5 CFG names two knobs (the anomaly *thresholds* themselves are ISSUE-057, not here):

| key | edit_class | default | meaning |
|-----|-----------|---------|---------|
| `guardrails.approval_pattern_learning_enabled` | `live` | `false` | FR-6.OPT.001 — gate the approval-tier candidate surfacing loop |
| `guardrails.anomaly_baseline_learning_enabled` | `live` | `false` | FR-6.OPT.002 — gate the anomaly-baseline candidate surfacing loop |

Both default OFF (learning is opt-in; a change only ever *surfaces a candidate*, never auto-applies — #2). No new
PERM node: admin confirmation of a candidate reuses the C1 RBAC admin gate (ISSUE-060 §5 PERM: none new).

## 4. Traceability

FR-6.LOG.001–004, FR-6.FMM.001, FR-6.OPT.001–002 → package `@harness/guardrail-log`; each AC in §4 has a teeth
test in `src/guardrail-log.test.ts`. The DB-level ACs (AC-6.LOG.001.2 check constraint, AC-6.LOG.002.1 append-only
trigger) are ALSO proven offline in the reference model and owed a LIVE re-proof at the Stage-3 checkpoint via
`results/issue-060-capstone.sql`.
