# Phase 4 — Data Inventory (harvest ledger)

**Status:** Working ledger — the deduplicated harvest of every `DATA-`/table.field binding across
the 11 components + 14 surfaces + config registry. `schema.md` is built from this; this file is the
audit trail proving no data reference was dropped.

**Method:** subagent fan-out (2026-07-01) — one pass over the 14 surfaces' "Phase 4 data binding
notes", one over the 11 components' `Data touched:`/`DATA-` footers (sharded C0–C1, C2–C3, C4–C6,
C7–C8, C9–C10), one over the config-registry structured objects + the traceability-matrix `DATA-`
column (the authoritative id list). Raw shard outputs are preserved in `_harvest-c7-c8.md` and the
session transcript.

**Authoritative `DATA-*` id list (from `traceability-matrix.csv`) — 21 domain ids:**
`memories · entities · ingestion_queue · tools · credentials · rate_limit_tracker · prompt_layers ·
dynamic_field_store · agents · task_queue · context_envelope · task_graph_versions · guardrail_log ·
event_log · notifications · client_registry · proactive_suggestions · signal_weights · access_audit`
(field-qualified forms like `DATA-memories.content` are columns of their parent, not separate tables).
Config cluster (`config_values`, `config_audit_log`, `secret_manifest`) + the Phase-3 net-new stores
are **not** `DATA-`-prefixed in the matrix and are added below.

---

## Cross-cutting invariants (apply to every table unless noted)

1. **NO `client_slug` on ANY application table.** OD-096 / C10 FR-10.ISO.001 **deleted** it (it is not
   "label-only" — that older C2–C6 prose is superseded; see Reconciliation R1). The **only** surviving
   `client_slug` lives in `client_registry` on the **separate management deployment** (ADR-001 §3/§7).
2. **Isolation is physical** (one Supabase per client) — never an RLS predicate. RLS is intra-client only.
3. **RLS = static, data-driven, `(select …)` initPlan** (ADR-006; wrapped to evaluate once per statement,
   AF-067). **Human path** = RLS-enforced; **agent/background path** = `service_role` (bypasses RLS,
   governed by harness RBAC). Sole-writer tables (memories) are `service_role`-write-only (ADR-004).
4. **Restricted is never a row/role default** (C1); Personal/Restricted access is audited (access_audit).
5. **Audit/log sinks are append-only** (event_log, guardrail_log, access_audit, config_audit_log) — forward
   status transitions only; erasure = redaction-tombstone in place, never row-delete (FR-7.LOG.006/OD-074).

---

## A. Identity & Auth  (C0 · Supabase-managed)

| Table | Owner | Key fields | Net-new | Notes |
|---|---|---|---|---|
| `auth.users` | Supabase | id, email, encrypted_password (only for external Super Admins — OAuth users have none, OD-018), last_sign_in_at | — | Supabase-managed; referenced, not defined by us. |
| `auth.identities` | Supabase | user_id, provider (google/azure), provider_id | — | Tenant-pinned OAuth (FR-0.AUTH.004). |
| `auth.mfa_factors` | Supabase | user_id, factor_type=totp, status | — | External Super-Admin TOTP; OAuth MFA at IdP. |
| `profiles` (app `users`) | C1 | id (=auth.uid), email, name, active (bool, default true — deactivation ≠ delete FR-1.USR.002), created_at, last_active_at | ⚠️ **OD** | Surface-02 binds `users/profile` (name/active/last_active_at) — an **app-side mirror of `auth.users`**. Confirm whether this is a distinct `profiles` table or a view. **OD-P4-01.** |
| `support_requests` | C0 | id, email, name, issue_description, status ∈{pending,in-progress,resolved} (default pending), assigned_to (fk, nullable), created_at, updated_at | — | RLS: read/resolve via `PERM-support.view`/`.resolve`; **public INSERT-only** pre-auth intake policy (can't read existing rows). idx (status, created_at). |
| `webhook_secrets` (C0 `credentials`) | C0 | ghl_webhook_secret (Ed25519, OD-046), slack_signing_secret, google_oauth2_audience, secret_version, rotated_at, active | ⚠️ **OD** | C0 calls it `credentials`; C3 also has a `credentials` (OAuth tokens). **Same table or two? OD-P4-02** — recommend **two** distinct tables (webhook-verification secrets vs connector OAuth tokens); rename C0's to `webhook_secrets`. `service_role` only. |
| `webhook_replay_cache` | C0 | event_id, connector_type, source_id, seen_at, window_expires_at | — | Ephemeral; auto-purge after window; no backup. idx (connector_type, source_id, seen_at). |

## B. RBAC & Access  (C1)

| Table | Key fields | Net-new | Notes |
|---|---|---|---|
| `roles` | id, name (unique), is_protected (Super Admin always true; others true-while-in-use OD-025), is_default, created_at, updated_at | — | Six seeded defaults (FR-1.ROLE.001); ≥1 Super Admin always exists (FR-1.ROLE.005). |
| `role_permissions` | id, role_id (fk), permission_node (text), granted_at, granted_by | — | Presence = granted; **default-deny on absence** (FR-1.PERM.002). **idx the policy-read columns** (AF-067). Seeded from `PERMISSION_NODES.md` at provision (FR-1.PERM.005). |
| `user_roles` | id, user_id (fk), role_id (fk), assigned_at, assigned_by, active (bool) | — | **One role per user v1** (OD-029 → unique on user_id). Deactivation = active→false, row retained. |
| `sensitivity_clearances` | id, subject (user_id or role_id), tier ∈{Confidential,Personal} (Standard implicit, Restricted separate), entity_type_scope (NULL=Global, FR-1.CLR.004), granted_at, granted_by, last_reviewed_at (nullable) | — | ⚠️ subject model (user vs role) = **OD-027 carry** — confirm shape. idx (last_reviewed_at) for review cadence. |
| `restricted_grants` | id, grantee_user_id (named individual only), granter_user_id, entity/entity_type scope (nullable), reason (**NOT NULL**, L452), granted_at, revoked_at (nullable=active), revoked_by | — | Per-individual only (FR-1.RST.001); never auto-injected. idx (grantee, revoked_at). Append-only semantics (revoked_at soft-delete). |
| `access_audit` | id, audit_type, actor_identity, actor_type ∈{user,agent,system}, target_entity_id, target_type, action, before_value, after_value, reason (nullable except Restricted), timestamp, originating_user_id, path_context | — | **Append-only, immutable.** Every Personal/Restricted read/write/injection + every RBAC change (FR-1.AUD.001/002). C7 owns retention/export (FR-1.AUD.003). |

*(Helper fns `user_clearances/visibility/restricted/aal` → `rls-policies.md`.)*

## C. Memory  (C2)

| Table | Key fields | Net-new | Notes |
|---|---|---|---|
| `memories` | id, type ∈{semantic,episodic,procedural}, content, **embedding vector(1536)**, embedding_model, embedding_v2 vector(1536) nullable (expand-contract), entity_ids uuid[] (**≥1**), source ∈{ai_inferred,human_verified,system_pointer}, source_ref, confidence numeric(0–1, nullable only for system_pointer), visibility ∈{global,team,private}, sensitivity ∈{standard,confidential,personal,restricted}, superseded_by uuid nullable, expires_at nullable, created_at, updated_at | — | **Sole-writer** (Memory Agent, ADR-004) — no direct insert/update. **No null/invalid embedding** (FR-2.WRT.007). Idempotency key = hash(source_ref, sorted entity_ids, content_hash). CAS supersede WHERE superseded_by IS NULL. **HNSW** on embedding. RLS = C1 visibility/sensitivity/Restricted (FR-1.RLS.003), clearance-before-ranking (FR-2.RET.004). |
| `entities` | id, type (validated vs CFG-entity_types), name, external_refs json (GHL/Slack/Drive ids), created_at | — | Internal-Org = **singleton** per deployment (FR-2.ENT.003). 5–8 expected slots per type (Maturity denom). Fragmentation is a #1 risk (FR-2.ENT.005). external_refs is the resolution join key. |
| `ingestion_queue` | id, content, source_ref, flag_reason, suggested_tier, target_entity_id (fk nullable), state ∈{pending,deferred,included,excluded,shadow_dropped}, deferred_until (nullable), created_at, reviewed_by, reviewed_at, decision_reason | — | Leaves only by logged Include/Exclude/Defer. Resurface (`ingest_defer_resurface_days`), escalate (`review_escalation_days`), never silent. idx (state, created_at). RLS `PERM-ingestion.review` + clearance on Personal/Restricted rows. |
| `hard_conflict_quarantine` | new_memory, conflicting_memory_ids[], suggested_resolution, state, created_at, escalated_at (nullable, server-owned) | 🆕 | **Net-new** (surface-03, FR-2.WRT.002/OD-032). Held out of live retrievable set. idx (state, created_at). |
| `consolidation_approvals` | candidate_memory_ids[], op ∈{merge,summarise}, tier=Personal, state, created_at, escalated_at (nullable) | 🆕 | **Net-new** (surface-03, FR-2.MNT.014/OD-037). Personal-tier merge/summarise human gate. |
| trust-window shadow-drops | (content, tag, retained-for-trust-window, read-only) | ⚠️ **OD** | **OD-P4-03:** a **distinct store** OR `ingestion_queue` rows with `state=shadow_dropped`? (FR-2.ING.001/OD-036). Recommend reuse `ingestion_queue.state`. |
| `expected_slots` | entity_type → slot-name list | — | Config-derived (edited surface-01 as structured object `expected_slots`); fill-state derived from memories. Model as config JSON, not a first-class table unless per-row needed. |

*(`entity_types`, `ranking_weights` = config structured objects in `config_values`, not tables.)*

## D. Tools & Connectors  (C3)

| Table | Key fields | Net-new | Notes |
|---|---|---|---|
| `tools` | id, name, description (non-empty — drives AI selection), category ∈{read,write}, risk_level, requires_approval, connector, config json, scopes, enabled, version, previous_version_id, change_reason (**mandatory**), created_at, updated_at | — | No partial registration. `enabled=false` hides from AI without delete. Versioned. |
| `credentials` (connector OAuth) | id, connector, access_token (enc, Vault), refresh_token (enc, Vault), expires_at, scopes, state ∈{active,degraded,…}, created_at, updated_at | — | Decrypt = `service_role` runtime only; never surfaced/logged. Atomic rotated-refresh persist (GHL 30s grace). **See OD-P4-02** (vs C0 webhook_secrets). |
| `rate_limit_tracker` | id, connector, window_start, window_duration, limit, calls_made, reset_at, created_at, updated_at | — | Source of truth, checked pre-call/updated post-call; vendor headers reconcile (conservative wins). One row per connector×window (GHL has 2). |
| `idempotency_ledger` | (deterministic idempotency key, connector, first-seen, result) | 🆕 | **Net-new** app-side write-dedup (FR-3.CONN.004; "DATA TBD Phase 4"). |

## E. Prompt Content  (C4)

| Table | Key fields | Net-new | Notes |
|---|---|---|---|
| `prompt_layers` | id, layer ∈{core,business,memory,task_template}, name, content, agent_id (fk, required for layer=core), enabled, version, previous_version_id, change_reason (**mandatory, non-empty**), created_at, updated_at, created_by | — | **Append-only versioned** (change-control). core layer must carry boundary+hard-limit+principles or assembly halts (FR-4.LYR.004). Version pinned at assembly (FR-4.STO.006/OD-050). Principles block identical across agents, Super-Admin-only, hard-floor (OD-053). **client_slug removed** (was label — R1). |
| `dynamic_field_values` | field_name, field_value, last_updated | — | Operator-editable per-deployment (OD-052). Read **fresh at assembly**, not baked. Staleness surfaced past `dynamic_field_freshness_threshold`. |

## F. Execution / Harness  (C5)

| Table | Key fields | Net-new | Notes |
|---|---|---|---|
| `task_queue` | id, type ∈{scheduled,event,human,chained}, task_name, payload jsonb, status ∈{pending/queued,running,awaiting_approval,completed,failed,**flagged**}, priority, requires_approval, approved_by, approved_at, **originating_user_id** 🆕, attempts (Inngest projection), next_retry_at, completed_at, error (full history, never collapsed), step/action payload, created_at | field 🆕 | **Permanent audit record** — never deleted (FR-5.QUE.001). Fixed status state machine. `flagged` = C6 quarantine, retains WIP. **`originating_user_id` net-new owed to C5** (drives no-self-approval + FR-5.ASM.005 + per-user My-Queue). idx (status, created_at); (originating_user_id, status). |
| `task_graph_versions` | id, task_type, version, steps jsonb (ordered, per-step deps + failure-mode), change_reason (**mandatory**), previous_version_id, created_at, created_by | — | Versioned; undefined graph fails loud at dequeue, never silent pending (FR-5.GRP.001). |
| task-history / envelope originals | (task_id, step, full uncompressed output, retained ≥ chain+audit window) | 🆕 ⚠️ | **OD-P4-04:** `DATA-context_envelope` lives in Inngest step-state at runtime; **durable originals store** owed **if** Inngest retention < longest chain + audit (AF-115). Compression = context economy, never knowledge loss (FR-5.ENV.003). |

## G. Guardrails  (C6)

| Table | Key fields | Net-new | Notes |
|---|---|---|---|
| `guardrail_log` | id, task_id (fk), guardrail_type ∈{hard_limit,approval_gate,anomaly,rate_limit,prompt_injection}, description, action_blocked, status ∈{pending,approved,rejected}, reviewed_by, reviewed_at, **escalated_at** 🆕 (nullable, server-owned), created_at | field 🆕 | **Append-only** (FR-6.LOG.002); write-complete for all 5 types. **`status=approved` INVALID where `guardrail_type=hard_limit`** (AC-6.LOG.001.2 — enforce as CHECK/partial constraint). Block+row bound in one txn; row-write-fail still blocks (fail-closed). **`escalated_at` net-new owed to C6.** **client_slug deleted** (R1). |
| `injection_quarantine` | guardrail_log_id (fk), quarantined_content, source_tool, source_record_id, timestamp, human_decision ∈{null,discard,approved_safe}, reviewed_by, reviewed_at | 🆕 | **Net-new** shadow-retain (ADR-007 pt4). Never machine-discarded; task never proceeds w/o explicit human approval (FR-6.INJ.006). Escalates past timeout (AC-6.INJ.006.4). |

## H. Observability  (C7)  *(authoritative field lists → `_harvest-c7-c8.md`)*

| Table | Key fields | Net-new | Notes |
|---|---|---|---|
| `event_log` | id, task_id, event_type ∈{task_started,tool_called,memory_read,memory_written,guardrail_hit,approval_requested,task_completed,task_failed}, entity_ids, summary (plain-English), payload (**redacted — no tokens/secrets**), duration_ms, cost_tokens (**nullable + `cost_unknown` sentinel ≠ 0**), created_at | — | **Append-only.** Erasure = redaction-tombstone (FR-7.LOG.006/OD-074). Retention `event_log_retention_window` (365d). idx (event_type, created_at), (task_id) for silent-failure reconcile (AC-7.LOG.003.1). Carries answer-mode pill value for AI-output rows (confirm stored vs derived — see OD-P4-05). |
| `notifications` | id, type, severity, title, body, recipient, read_state ∈{unread,read,actioned}, **escalation_state** 🆕, **escalated_at** 🆕, **actioned_at** 🆕, delivery_state (dashboard-first, Slack best-effort), created_at | 🆕 store | **Net-new store owed to C7** (surface-07; FR-7.ALR.001/005/006). RLS clearance-scoped to viewer. Realtime subscription filter is intra-silo (no client_slug). Dashboard row never contingent on Slack success. |
| `config_audit_log` | key, old_value jsonb (nullable on first write), new_value jsonb, actor_id (fk users), changed_at | — | **Governance = FR-7.LOG.008** (minted Phase 2/3). Append-only + tamper-evident (AC-7.LOG.008.3). Key-prefix RLS (= `config_values` policy). Retention ≥ audit floor. actor_id owed to erasure walk (redaction-tombstone). SECRET rows never logged. |
| `push_subscriptions` | id, user_id (fk), endpoint, keys, platform, last_seen | 🆕 | **Net-new** device-token store owed to C7 (surface-12, FR-7.VIEW.003). RLS to owning user. A silently-failed registration reads "push not enabled", never false "on". |
| cost tracking | — | ⚠️ **OD** | **OD-P4-05:** is cost a separate rollup table or purely `event_log.cost_tokens`-derived + `price_table` config? Recommend derived (no separate table) unless a materialised daily rollup is needed for the meter. |

## H2. Management plane  (C7 push + C10)  *(separate deployment — ADR-001 §7)*

| Table | Key fields | Net-new | Notes |
|---|---|---|---|
| `client_registry` | id, **client_slug** (✅ the ONLY valid client_slug in the product), client_name, railway_url, internal_token (**encrypted, never returned**), core_version (push-updated), region, status ∈{initialising,active,offboarding,frozen} (**server-authoritative**, frozen≠dead), created_at, offboarding_initiated_at, offboarding_at | — | Lives only on mgmt DB. C5 dispatch reads status, fails closed if frozen (OD-091). |
| deployment health store | per-deployment latest snapshot: health score, last_push_at, open-alert counts, approval-queue depth, core_version + last-migrated, connector rollup, cost-to-date, plugin version, backup-health | 🆕 | **Operational metadata only** — no business-data column (FR-10.MGT.003). Push-fed, never pulled. idx last_push_at (staleness sweep AC-7.MGM.002.3), version-spread (skew). |
| `offboarding_records` | 9 lifecycle timestamps + deletion_executed_by + systems_deprovisioned[] + tokens_revoked[] | — | Mgmt DB; no client business data; retained legal period (FR-10.LEG.001); resumable (AC-10.OFF.005.4). |

## I. Agent Design  (C8)  *(authoritative field lists → `_harvest-c7-c8.md`)*

| Table | Key fields | Net-new | Notes |
|---|---|---|---|
| `agents` | id, name ('{slug}_<role>_agent' — **slug only inside the name string, never a column** AC-8.REG.001.3), description (non-empty), memory_scope json, tools_allowed uuid[], max_tokens, enabled, version, previous_version_id, change_reason (**mandatory**), created_at, updated_at, created_by | — | **NO `system_prompt`** (OD-075 → prompt_layers). **NO `model` column** (complexity-routed; per-agent override would be net-new, not asserted — OD-P4-06). Hard-limit invariants reject-at-write (Comms/Finance/Memory-sole-writer). idx enabled (routing candidacy); version chain queryable. |
| `agent_health_metrics` | agent_id, success/failure rate, last_run, drift_score, dead_agent_flag, routing-mismatch counts, **producer heartbeat / last_emitted** | 🆕 | **Net-new metric store** (surface-09; FR-8.HLTH.*). Stalled producer renders **"stale" not green** (AC-8.HLTH.004.2). Flag-never-auto-correct (OD-078). |
| `execution_plans` | id, task-type key, plan body (steps + per-step failure mode), version, previous_version_id, outcome attribution | 🆕 | **Net-new versioned store** (surface-09; FR-8.PLAN.004). Human-only rollback (OOS-030). C5 owns live envelope execution; this is the versioned management record. |
| orchestrator result cache | (scope-keyed cache entries, per-agent-type TTL from `cache_time_window`) | ⚠️ | FR-8.LRN result caching; **scope-aware invalidation** (OD-076, a #1 concern). Confirm table vs cache layer — **OD-P4-07**. |

## J. Proactive  (C9)

| Table | Key fields | Net-new | Notes |
|---|---|---|---|
| `proactive_suggestions` | id, mode ∈{Suggest,Prepare,Act}, state ∈{generated,surfaced,acted,dismissed,expired,superseded}, reasoning, answer_mode_pill, risk_type, recipient_id, delivery_state, rank, dismissal state + **safety-floor flag (queryable)**, generated_at, surfaced_at | — | State machine, never silently dropped. Prepare spawns a linked task_queue task. Floor-class never dropped below risk floor (FR-9.SUG.005). RLS clearance-scoped to recipient. |
| `commands` | id, slug (unique, collision-checked vs system slugs), display_name, description, prompt_template ($ARGUMENTS), assigned_agent_id (fk agents, enabled-at-save), perm_node (C1 node), active (**auto-false when agent disabled** — trigger/reconcile), created_by, created_at, updated_at | 🆕 | **Net-new** (surface-10; FR-9.CMD.006). **User-defined only** — system commands stay code-registered (not rows). RLS `PERM-commands.manage`. |
| `signal_weights` | (dismissal-learning weights, with safety floor) | 🆕 | **Net-new** learning state (FR-9.SUG.005). Never suppresses derisking floor. |

## K. Infra / Compliance  (C10)  *(client-side)*

| Table | Key fields | Net-new | Notes |
|---|---|---|---|
| `deletion_requests` | requester_id, on_behalf_of/target, legal_basis, status ∈{received,authorised,executed,rejected}, authorized_by, two_person_authoriser, executor_id, executed_at, created_at, updated_at | — | Admin/Super-Admin gate; **two-person auth** for Restricted/Personal (executor ≠ authoriser, AC-10.DEL.006.2). Escalates past window; rejection recorded; never silently dropped. |
| two-person-auth record | first_approver, second_approver (**≠ first**, no self-second), decided_at | 🆕 | **Net-new field-set** owed for offboarding hard-delete + individual erasure (surface-06; AC-10.DEL.006). Could be columns on deletion_requests / offboarding_records. |
| (writes to `access_audit`) | requested_by, authorized_by, executed_by, executed_at, affected_record_count, hard_deleted_count, entity_id_removed_count, content_redacted_count | — | Immutable deletion audit; retained `individual_deletion_audit_years` (7y) even after data gone. Deletion never "done" without audit proof; audit-write-fail fails erasure closed. |

## L. Config cluster  (Phase-2 registry → storage)

| Table | Key fields | Net-new | Notes |
|---|---|---|---|
| `config_values` | key (text, unique, PK), value (jsonb — scalar + the ~11 structured objects), updated_at, updated_by (fk users) | — | ~117 knobs + ~11 structured objects (`ranking_weights`, `routing_weights`, `anomaly_thresholds`, `risk_thresholds`, `opportunity_thresholds`, `action_autonomy_matrix`, `cache_time_window`, `price_table`, `entity_types`, `expected_slots`, `rate_max_calls_per_connector_window`). **Key-prefix RLS** by `PERM-config.*` group. Edit-class LIVE/BOOT/REBUILD/SECRET (SECRET never stored here). Includes minted `dlq_stale_alert_hours` (OD-123). |
| `config_audit_log` | (see H — C7-governed) | — | Same physical table as C7 §H. |
| `secret_manifest` | key (unique), present (bool — required-missing blocks boot), last_rotated (nullable, deploy-hook OD-102) | — | **Presence + last_rotated only** — the 11 secrets live in env/Railway, never stored/UI-editable. Super-Admin (`PERM-config.secrets`) read-only. |

## M. Chat  (net-new — OD-135)

| Table | Key fields | Net-new | Notes |
|---|---|---|---|
| `conversations` | id, owner_user_id, created_at, … | 🆕 | **Net-new** persisted chat thread (surface-08 OD-135); owed to C5/C9. RLS to owning user. Losing history on reload = #1 violation. |
| `messages` | id, conversation_id (fk), sender ∈{user,agent}, body, answer_mode_pill (on agent msgs), task_queue_id (nullable — sync command results persist here with **no task_queue row**), created_at | 🆕 | **Net-new** (OD-135). Async results return via poll + notification nudge, **no third Realtime socket** (AC-7.RTP.001.3). |

---

## Reconciliations (clerical, decided — for change-control notes, not ODs)

- **R1 — `client_slug` is DELETED, not "label-only".** C2/C3/C4/C5/C6 component prose still says "label,
  not an RLS key". OD-096 / FR-10.ISO.001 superseded that: the column **is not created** on any app table.
  Phase 4 carries no `client_slug` anywhere except `client_registry`; a one-line clerical amendment is owed
  to each of those component files (change-control).
- **R2 — store renames (schema canonical names).** The harvest names below were renamed in `schema.md`
  to canonical, consistent identifiers; same stores, same owing FRs:
  - `hard_conflict_quarantine` → **`memory_conflicts`** (C2, FR-2.WRT.002).
  - C0 `credentials` (webhook secrets) → **`webhook_secrets`**; C3 `credentials` (OAuth) → **`connector_credentials`** (OD-P4-02 split).
  - `DATA-dynamic_field_store` (matrix id) → **`dynamic_field_values`** (C4, FR-4.BIZ.003).
  - `DATA-context_envelope` → runtime (Inngest step-state) + durable tail **`task_history`** (OD-P4-04 / AF-115).

## Net-new stores/fields owed back to a component FR (change-control, Phase-4 step 8)

| # | Store/field | Owed to | Source |
|---|---|---|---|
| 1 | `hard_conflict_quarantine` | C2 (FR-2.WRT.002) | surface-03 |
| 2 | `consolidation_approvals` | C2 (FR-2.MNT.014) | surface-03 |
| 3 | `idempotency_ledger` | C3 (FR-3.CONN.004) | C3 |
| 4 | task-history/envelope-originals store | C5 (FR-5.ENV.003 / AF-115) | C5 |
| 5 | `task_queue.originating_user_id` | C5 | surface-04/08/12 |
| 6 | `guardrail_log.escalated_at` | C6 | surface-04 |
| 7 | `injection_quarantine` | C6 (FR-6.INJ.006) | C6 |
| 8 | `notifications` store + escalation_state/escalated_at/actioned_at | C7 (FR-7.ALR.001/005) | surface-07 |
| 9 | `push_subscriptions` | C7 (FR-7.VIEW.003) | surface-12 |
| 10 | `agent_health_metrics` | C8 (FR-8.HLTH.*) | surface-09 |
| 11 | `execution_plans` | C8/C5 (FR-8.PLAN.004) | surface-09 |
| 12 | `commands` | C9/C5 (FR-9.CMD.006) | surface-10 |
| 13 | `signal_weights` | C9 (FR-9.SUG.005) | surface-09/C9 |
| 14 | two-person-auth record | C10 (AC-10.DEL.006) | surface-06 |
| 15 | `conversations` + `messages` | C5/C9 (OD-135) | surface-08/12 |
| 16 | `config_audit_log` governance | C7 (FR-7.LOG.008 — already minted) | surface-01b |

## Open Decisions surfaced (for `schema.md` step 7 — options + rec to user)

- **OD-P4-01** — `profiles`/app-`users` table vs `auth.users`: distinct mirror or view? (rec: thin `profiles` mirror keyed to auth.uid).
- **OD-P4-02** — C0 `credentials` (webhook secrets) vs C3 `credentials` (OAuth tokens): one table or two? (rec: **two** — `webhook_secrets` + `connector_credentials`).
- **OD-P4-03** — trust-window shadow-drops: distinct store vs `ingestion_queue.state=shadow_dropped`? (rec: reuse state).
- **OD-P4-04** — envelope originals: rely on Inngest retention vs a durable `task_history` table? (rec: durable table, gated by AF-115).
- **OD-P4-05** — answer-mode pill + cost: stored columns vs derived? (rec: pill stored on event_log/messages; cost derived from cost_tokens + price_table).
- **OD-P4-06** — per-agent `model` override column: add now or defer? (rec: defer — not asserted by any FR; complexity-routed).
- **OD-P4-07** — orchestrator result cache: table vs cache layer + scope-aware invalidation (OD-076). (rec: dedicated table for auditability).
