---
id: ISSUE-010
title: Config store + secret manifest + config-audit-log immutability
epic: A — foundations
status: blocked
github: "#10"
---

# ISSUE-010 — Config store + secret manifest + config-audit-log immutability

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Stand up the config persistence backbone — `config_values` + `secret_manifest` storage and the
append-only, tamper-evident `config_audit_log` (the system's third audit sink) — so every later
knob edit is durably stored, secret presence is exposed without leaking values, and every
config change is immutably recorded.

## 2. Scope — in / out
**In:** the three config-cluster tables and their integrity guarantees, as the scaffold every
config-owning issue writes against:
- `config_values` storage (key → JSON value, `updated_at`/`updated_by`), keyed to the Phase-2
  registry key set; key-prefix RLS by `PERM-config.*` group. SECRET-class keys are never stored here.
- `secret_manifest` storage — presence + `last_rotated` only (values live in env/Railway), with
  required-missing feeding the boot gate; the UI/read path returns presence + last-rotated, never
  a value.
- `config_audit_log` as the **third audit sink**: append-only + tamper-evident, the
  `enforce_audit_append_only()` `BEFORE UPDATE OR DELETE` trigger + the `revoke delete` belt-and-braces,
  the `redacted_at` column, retention honouring the audit/compliance floor, and complete-or-fail
  export scoped by `PERM-config.*` key-prefix (gated for download by `PERM-compliance.download_records`).
- The redaction-tombstone shape on `config_audit_log.actor_id` (the erasure walk *entry point* on
  this table; the C10/C2 caller that triggers it is out).

**Out:**
- The **write path** that appends audit rows on Save (per-section validate → persist → append
  who/when/old→new) — that is the config-admin surface, **ISSUE-086** (`surface-01`/`surface-01b`).
  This issue provides the sink + immutability + export contract that ISSUE-086 writes into and renders.
- Actual knob semantics / individual key consumers — each owning issue reads its own keys.
- The `event_log`/`guardrail_log`/`access_audit` sinks and their triggers/views — the observability
  skeleton is **ISSUE-011**; this issue only adds the *config* sink (same `enforce_audit_append_only()`
  function, one more `t_append_only` trigger).
- Secret rotation mechanism (out-of-band operator runbook, INF) and provisioning-time secret minting
  (**ISSUE-007** PRV).
- The C10 erasure workflow that walks this sink on user-erasure (**ISSUE-082**/**ISSUE-084** consume
  the tombstone entry point defined here; AC-7.LOG.008.4 carry-forward).

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-7.LOG.008 (component-07 Observability — `config_audit_log` view/retention/tamper-evidence/export)
- **NFRs:** NFR-CMP.006 (audit-sink immutability, fires regardless of role incl. `service_role`);
  NFR-SEC.003 (secrets custody — presence + last-rotated only, never the value)
- **Rests on:** ADR-001 §7 (silo isolation / per-deployment config, mgmt-plane split); migrations.md
  Migration 0001 (config cluster created in dependency order); `standards/config-edit-taxonomy.md`
  (SECRET/BOOT/LIVE/REBUILD classes; rule 2 SECRET never UI-editable; rule 4 every change audited)

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-7.LOG.008.1 — complete-or-fail export over range + `PERM-config.*` key-prefix scope
- AC-7.LOG.008.2 — retention honours the audit/compliance floor (`individual_deletion_audit_years`); pruning logged, never silent
- AC-7.LOG.008.3 — append-only + tamper-evident (post-hoc modification detectable)
- AC-7.LOG.008.4 — redaction-tombstone on `actor_id` under user erasure (row + change data retained)
- AC-7.LOG.008.5 — no credential material ever appears (SECRET rows never produce an audit row)
- AC-NFR-CMP.006.1 — `service_role` DELETE on any audit sink is rejected by the trigger
- AC-NFR-CMP.006.2 — `service_role` in-place UPDATE on an audit-sink row is rejected
- AC-NFR-CMP.006.3 — each of the four audit sinks carries the `BEFORE UPDATE OR DELETE` trigger bound to `enforce_audit_append_only()`
- AC-NFR-SEC.003.1 — a rendered secret returns presence + last-rotated only; value never returned to the client
- AC-NFR-SEC.003.2 — a log write that would carry a token/secret/credential is redacted before the row is written (FR-7.LOG.005)
- **Gating spikes (if any):** none. Blocked-by ISSUE-008 is the migration harness (not a spike); no OD-157 AF gates this slice.

## 5. Touches (complete blast radius, by ID)
- **DATA:** `config_values` · `secret_manifest` · `config_audit_log` (incl. `config_audit_log.actor_id`, `config_audit_log.redacted_at`)
- **PERM:** `PERM-config.*` family (key-prefix read scope: `PERM-config.auth/memory/tools/prompts/loops/guardrails/observability/agents/proactive/infra/secrets`) · `PERM-config.secrets` (presence-only view) · `PERM-compliance.download_records` (export gate)
- **CFG:** `individual_deletion_audit_years` (retention floor read); `event_log_retention_window` (parallel floor reference). No new keys introduced — this issue *stores* the registry, does not define knobs.
- **UI:** none (surface `UI-config-admin` / `UI-config-audit-log` are ISSUE-086)
- **Connectors:** none

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-07-observability.md — FR-7.LOG.008 (+ FR-7.LOG.005 credential-redaction dependency) text + ACs
- spec/04-data-model/schema.md §"12. Config cluster" — `config_values`, `secret_manifest`
- spec/04-data-model/schema.md §8 — `config_audit_log` table definition
- spec/04-data-model/schema.md §"Immutability enforcement" — `enforce_audit_append_only()` + the four `t_append_only` triggers + `revoke delete` + `redacted_at`
- spec/04-data-model/migrations.md — Migration 0001 ordering (config cluster) + expand-contract constraints
- spec/05-non-functional/compliance.md §NFR-CMP.006 (audit-sink immutability) + §NFR-CMP.007 (redaction-tombstone, the sanctioned mutation)
- spec/05-non-functional/security.md §NFR-SEC.003 (secrets custody)
- spec/00-foundations/standards/config-edit-taxonomy.md — edit classes + rules 2/4
- spec/00-foundations/adr/ADR-001-isolation-model.md — §7 mgmt-plane / per-silo config split

## 7. Dependencies
- **Blocked-by:** ISSUE-008 (migration harness — expand-contract + 0001 baseline; the config cluster ships as part of 0001)
- **Blocks:** ISSUE-032 (connector runtime reads config), ISSUE-084 (retention configs + isolation), ISSUE-086 (config admin + config-audit-log surfaces — the write path + render)

## 8. Build order within the slice
1. **Migration (config cluster):** in Migration 0001 dependency order, create `config_values`
   (key PK, JSON `value`, `updated_at`, `updated_by`→profiles) and `secret_manifest`
   (key PK env-var name, `present` bool, `last_rotated`); `config_audit_log` already ordered in the
   `event_log`/`notifications`/`config_audit_log` block of §8. Add `redacted_at timestamptz` to
   `config_audit_log` (parallels `event_log`/`access_audit`).
2. **Immutability enforcement:** add the fourth `t_append_only` `BEFORE UPDATE OR DELETE` trigger on
   `config_audit_log` bound to the shared `enforce_audit_append_only()` function, plus
   `revoke delete on config_audit_log from <app+service roles>` (belt-and-braces so a DELETE never
   reaches the trigger). Confirm the function pins `search_path`. — AC-NFR-CMP.006.1/.2/.3, AC-7.LOG.008.3
3. **RLS on `config_values`:** key-prefix policies mapping each `PERM-config.*` group to its key set;
   default-deny for unmatched prefixes. SECRET-class keys are never stored here (enforce by write-path
   contract + presence in `secret_manifest` only). — supports AC-7.LOG.008.5
4. **`secret_manifest` presence contract:** boot gate reads `present` for required secrets
   (required-missing blocks boot); read path returns presence + `last_rotated` only, never a value;
   `last_rotated` deploy-hook-populated else "Unknown". — AC-NFR-SEC.003.1
5. **Config-audit read + export:** key-prefix-scoped read (caller's `PERM-config.*` nodes; no separate
   view node); export gated by `PERM-compliance.download_records`, all-or-nothing (complete range or
   loud failure — never a silent partial file). — AC-7.LOG.008.1
6. **Retention job:** privileged pruning that never removes a floor-window row
   (≥ `individual_deletion_audit_years`) and logs the run. — AC-7.LOG.008.2
7. **Redaction-tombstone entry point on `config_audit_log`:** scrub `actor_id` attribution while
   retaining `key`/`old_value`/`new_value`/`changed_at`, as a tamper-evident logged op that still
   passes the integrity check (the sanctioned mutation of NFR-CMP.007). — AC-7.LOG.008.4
8. **No-secret-in-log invariant:** verify SECRET rows never produce an audit row and log payloads
   redact credential material before write (FR-7.LOG.005). — AC-7.LOG.008.5, AC-NFR-SEC.003.2
9. **Tests to the ACs** (see Verification).

**Integration note (spanning the bundled sink + storage):** `config_values` write authority and the
audit-row *append* on Save both live in the config-admin write path (ISSUE-086) — this issue delivers
the *sink and its immutability/export/retention/tombstone contract* that the write path appends into,
exactly as C6 writes `guardrail_log` and C7 governs it. The immutability trigger and `revoke delete`
must be in the same migration 0001 that creates `config_audit_log` (never a later bare add), so no
window exists where the sink is mutable.

## 9. Verification (how DoD is proven)
- **DB / migration test** (build-time, per `spec/05-non-functional/test-strategy.md`): apply 0001; a
  `service_role` connection attempting DELETE and in-place UPDATE on `config_audit_log` (and the other
  three sinks) is rejected by `enforce_audit_append_only()`; all four sinks carry the trigger. — proves
  AC-NFR-CMP.006.1/.2/.3, AC-7.LOG.008.3
- **Secrets-custody test:** any surface/read response for a secret returns presence + last-rotated only;
  a log write with a token/secret payload is redacted pre-write. — proves AC-NFR-SEC.003.1/.2, AC-7.LOG.008.5
- **Export test:** a range + key-prefix export returns every matching row or fails loud (no silent
  truncation); export requires `PERM-compliance.download_records`. — proves AC-7.LOG.008.1
- **Retention/tombstone test:** a pruning run never removes a floor-window row and is logged; a
  user-erasure redacts `actor_id` while retaining the change record and still passing the
  tamper-evidence check (NFR-CMP.007). — proves AC-7.LOG.008.2/.4
- **AC→`Verified` path:** the NFR-CMP.006 / NFR-SEC.003 postures hold under the above build-time tests;
  no launch-gating AF blocks this slice.
