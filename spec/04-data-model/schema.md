# Phase 4 — Consolidated Schema

**Status:** Draft (Phase 4). Built from `_data-inventory.md` + `_harvest-c7-c8.md`. This is the
**spec-level** schema (typed tables, constraints, relationships). Drizzle/SQL migration files are a
build artifact (`migrations.md` defines the migration story). RLS predicates → `rls-policies.md`;
indexes → `indexes.md`.

**Context manifest:** ADR-001 (physical isolation, mgmt plane §7), ADR-002 (Maturity/Retrieval),
ADR-003 (cost), ADR-004 (sole-writer memory), ADR-006 (static data-driven RLS), ADR-008 (backup/DR
→ Phase 5). Standards: `migration-discipline.md`, `rbac.md`. All 11 components' `DATA-` footers + the
14 surfaces' Phase-4 binding notes.

## Global rules (enforced across every table)

- **No `client_slug` (or any client-identity column) on any application table.** OD-096 / C10
  FR-10.ISO.001. `client_slug` is confined to the **management-plane deployment** (§13) — never a
  client silo — where it appears on `client_registry` plus the two mgmt-only rollup tables that key
  off it (`deployment_health`, `offboarding_records`). Isolation is physical (one Supabase per
  client); RLS is intra-client only.
- **Primary keys:** `uuid` default `gen_random_uuid()` unless a natural key is noted.
- **Timestamps:** `timestamptz`; server-authoritative (`now()`), never client-asserted (AC-7.ALR.005.3).
- **Versioned tables** (`prompt_layers`, `tools`, `agents`, `task_graph_versions`, `execution_plans`)
  are **append-only-by-version**: an edit inserts a new row with `previous_version_id` + a non-empty
  `change_reason`; prior versions are never overwritten. This is backstopped at the DB with a
  `BEFORE UPDATE OR DELETE` trigger (fires regardless of role, incl. `service_role`) on the tables that
  have one: `prompt_layers` (migration `0004`), `task_graph_versions` (migration `0013` — any UPDATE/DELETE
  of an existing version row is forbidden; a graph edit inserts a NEW version, FR-5.GRP.002 / change-control),
  and `agents` (migration `0016` — DELETE forbidden and the version-lineage columns `id`/`version`/
  `previous_version_id`/`change_reason`/`created_at`/`created_by` are immutable in place; an edit is a new
  version, FR-8.REG.004). See "Immutability enforcement — versioned tables" below.
- **Audit sinks** (`event_log`, `guardrail_log`, `access_audit`, `config_audit_log`) are **append-only**;
  the only mutation is a controlled forward status transition or a redaction-tombstone on erasure.
  **This is enforced by a DB trigger, NOT by RLS** — the writing path is `service_role`, which bypasses
  RLS, so RLS alone would leave history rewritable. See "Immutability enforcement" below.

### Immutability enforcement (audit sinks — fires regardless of role, incl. `service_role`)

RLS does not protect the audit sinks because their writer is `service_role` (RLS-exempt by design). Their
append-only / tamper-evident guarantee (#1 never lose knowledge · #3 never fail silently; AC-7.LOG.008.3)
is therefore bound to the table with a `BEFORE UPDATE OR DELETE` trigger that raises unless the change is
one of the whitelisted UPDATE mutations — a forward status transition (`guardrail_log`), a **monotonic
escalation stamp** (`escalated_at` null→ts on `guardrail_log`/`injection_quarantine`, and a write-once
`human_decision` on `injection_quarantine` — **OD-182**, migration `0009`, content always retained), or a
redaction-tombstone (PII columns → `[REDACTED]`, row + audit metadata retained). **DELETE is forbidden
except under the transaction-local retention-prune whitelist** (`app.retention_prune='on'`, set via
`set local` by the retention job alone — **OD-180**, change-control on NFR-CMP.006; migration
`0005_retention_prune_whitelist.sql` `create or replace`s the function below). Every non-retention DELETE,
any role, stays rejected; the floor (never prune below the audit/compliance window) is the retention job's
responsibility, not the trigger's.

```sql
create or replace function enforce_audit_append_only() returns trigger
  language plpgsql
  set search_path = ''                                -- OD-180 hardening (0005): unqualified names can't be shadowed
as $$
begin
  if tg_op = 'DELETE' then
    -- OD-180 retention-prune whitelist: the retention job sets `set local app.retention_prune='on'`;
    -- missing_ok current_setting → NULL when unset → still forbidden. Floor enforced by the job, not here.
    if current_setting('app.retention_prune', true) = 'on' then
      return old;
    end if;
    raise exception 'audit sink %: DELETE forbidden (append-only; retention prune must set app.retention_prune)', tg_table_name;
  end if;                                             -- UPDATE: allow only whitelisted mutations
  -- guardrail_log branch MUST be an outer if (not an inline AND): event_log/access_audit/config_audit_log
  -- have no `status` column, so referencing old.status there raises "record old has no field status" and
  -- breaks the redaction-tombstone on those sinks. (Bugfix folded into migration 0005, session 66.)
  if tg_table_name = 'guardrail_log' then
    if old.status = 'pending' and new.status in ('approved','rejected','modified')
       and new.description = old.description and new.task_id is not distinct from old.task_id then
      return new;                                     -- forward status transition (still append-only in spirit)
    end if;
    -- OD-182 (migrations 0009 + 0010 NULL-safe fix): monotonic escalation stamp — a stale/un-actioned pending
    -- guardrail row may be escalated (escalated_at null→ts) WITHOUT a status change; everything else immutable,
    -- action_blocked only false→true (escalation never un-blocks). ISSUE-057 markEscalated / ISSUE-059 escalateStale
    -- (#1/#3). task_id is nullable → `is not distinct from` (a plain `=` is NULL for a null-task row and wrongly
    -- rejects the escalation — caught + fixed live in 0010, session 69).
    if old.escalated_at is null and new.escalated_at is not null
       and new.status = old.status
       and new.description = old.description and new.task_id is not distinct from old.task_id
       and new.guardrail_type = old.guardrail_type
       and new.reviewed_by is not distinct from old.reviewed_by
       and new.reviewed_at is not distinct from old.reviewed_at
       and (new.action_blocked = old.action_blocked or (old.action_blocked = false and new.action_blocked = true)) then
      return new;
    end if;
    -- (c) OD-074 / FR-7.LOG.007.4 one-way redaction-tombstone (migration 0015): redacted_at null→ts, description
    -- scrubbed to the '[redacted]' sentinel, every OTHER field immutable. The ONLY in-place content mutation
    -- guardrail_log permits; distinguishable from a covert rewrite (which leaves redacted_at null and is rejected).
    -- The C7 export integrity check (AC-7.LOG.007.3) treats it as an authorized redaction (NFR-CMP.007), not a tamper.
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
  elsif tg_table_name = 'injection_quarantine' then   -- OD-182 (migration 0009): shadow-retain sink, now bound
    -- quarantined_content / guardrail_log_id / created_at are immutable forever (#1). A write-once human_decision
    -- (null → discard|approved_safe) and a monotonic escalated_at stamp are the only legitimate mutations; a
    -- `discard` decision does NOT delete the row.
    if new.quarantined_content = old.quarantined_content
       and new.guardrail_log_id = old.guardrail_log_id
       and new.source_tool = old.source_tool
       and new.source_record_id is not distinct from old.source_record_id
       and new.created_at = old.created_at
       and (old.human_decision is null or new.human_decision = old.human_decision)
       and (old.escalated_at  is null or new.escalated_at  = old.escalated_at)
       and (new.human_decision is null or new.human_decision in ('discard','approved_safe')) then
      return new;
    end if;
  elsif new.redacted_at is not null and old.redacted_at is null then
    return new;                                       -- one-way redaction-tombstone (FR-7.LOG.006 / OD-074)
  end if;
  raise exception 'audit sink %: in-place UPDATE forbidden (append-only / tamper-evident)', tg_table_name;
end $$;

create trigger t_append_only before update or delete on event_log
  for each row execute function enforce_audit_append_only();
create trigger t_append_only before update or delete on guardrail_log
  for each row execute function enforce_audit_append_only();
create trigger t_append_only before update or delete on access_audit
  for each row execute function enforce_audit_append_only();
create trigger t_append_only before update or delete on config_audit_log
  for each row execute function enforce_audit_append_only();
create trigger t_append_only before update or delete on injection_quarantine   -- OD-182 (migration 0009)
  for each row execute function enforce_audit_append_only();
```

Belt-and-braces: also `revoke delete on {these four + `injection_quarantine` (OD-182)} from anon, authenticated`
so a normal-role DELETE can never even reach the trigger; only `service_role` can DELETE at all, and only inside
a `app.retention_prune='on'` transaction (OD-180). (`event_log`/`access_audit`/`config_audit_log` — and now
`guardrail_log` (migration `0015`, branch (c) below) — carry a `redacted_at timestamptz` column; retention
pruning is a separate privileged job — the whitelisted DELETE path above — not an ordinary app/service DELETE.)

### Immutability enforcement (versioned tables — append-only-by-version, fires regardless of role)

The append-only-by-version guarantee (Global rules) is likewise bound at the table with a `BEFORE UPDATE OR
DELETE` trigger, so even the RLS-exempt `service_role` writer cannot rewrite history. Two Stage-4 additions
(both mirror the `prompt_layers` idiom from migration `0004`, `search_path=''`-pinned, with a belt-and-braces
`revoke update, delete … from anon, authenticated`):

```sql
-- task_graph_versions (migration 0013 · FR-5.GRP.002 / change-control · #1): the whole existing version row
-- is frozen — any UPDATE or DELETE raises; a graph edit inserts a NEW version (version = prior+1,
-- previous_version_id = prior.id). DB backstop to the app-layer SupabaseGraphStore.putVersion gate.
create or replace function public.task_graph_versions_block_mutation() returns trigger ...
  -- raises on any UPDATE/DELETE of an existing version: "append-only by version … insert a NEW version instead".
create trigger trg_task_graph_versions_no_update
  before update or delete on task_graph_versions for each row execute function ...;

-- agents (migration 0016 · FR-8.REG.004 / #1): DELETE forbidden (a rollback is a NEW version, never a delete);
-- on UPDATE the version-lineage columns (id, version, previous_version_id, change_reason, created_at,
-- created_by) are immutable — an edit is an INSERT of a new version. SCOPE-honest (Rule 0): this migration
-- freezes the version-lineage columns only; it does NOT yet force content edits (description / memory_scope /
-- tools_allowed) through the version chain — that lands with the agent-builder surface (ISSUE-067 / OD-080),
-- so the `enabled` routing toggle (REG.005) is left mutable in place for now.
create or replace function public.enforce_agents_version_lineage() returns trigger ... ;
create trigger trg_agents_version_lineage
  before update or delete on agents for each row execute function ...;
```

---

## Types (enums & domains — defined once, referenced everywhere)

```sql
-- Identity / support
create type support_status      as enum ('pending','in_progress','resolved');

-- Memory (C2)
create type memory_type         as enum ('semantic','episodic','procedural');
create type memory_source       as enum ('ai_inferred','human_verified','system_pointer');
create type visibility_tier     as enum ('global','team','private');
create type sensitivity_tier    as enum ('standard','confidential','personal','restricted');
create type ingestion_state     as enum ('pending','deferred','included','excluded','shadow_dropped');
create type mem_review_state    as enum ('pending','escalated','resolved');   -- conflict/consolidation queues
create type consolidation_op    as enum ('merge','summarise');

-- Clearance (C1)
create type clearance_tier      as enum ('confidential','personal');          -- standard implicit; restricted via restricted_grants
create type actor_type          as enum ('user','agent','system');

-- Tools (C3)
create type tool_category       as enum ('read','write');
create type credential_state    as enum ('active','degraded','revoked','expired');

-- Prompt (C4)
create type prompt_layer_kind   as enum ('core','business','memory','task_template');

-- Harness (C5)
create type task_type           as enum ('scheduled','event','human','chained');
create type task_status         as enum ('pending','running','awaiting_approval','completed','failed','flagged');

-- Guardrails (C6)
create type guardrail_type      as enum ('hard_limit','approval_gate','anomaly','rate_limit','prompt_injection');
create type guardrail_status    as enum ('pending','approved','rejected','modified');   -- 'modified' = FR-6.ESC.003 modify resolution
create type quarantine_decision as enum ('discard','approved_safe');          -- null = pending

-- Observability (C7)
create type event_type          as enum ('task_started','tool_called','memory_read','memory_written',
                                          'guardrail_hit','approval_requested','task_completed','task_failed',
                                          'task_failure_spike','queue_backup','memory_confidence_drop',
                                          'approval_queue_stale','cost_threshold_breach','loop_missed',
                                          'reporter_push',
                                          'authz_revoked_midtask','rls_harness_divergence',
                                          'webhook_verified','webhook_replay_dropped','webhook_rate_throttled','webhook_failure_alert',
                                          'email_send_ok','email_send_failed','invite_bounced','account_activated',
                                          'support_request_created','support_notification_sent','support_notification_failed','support_reescalation',
                                          'rate_limit_throttled','rate_limit_paused','rate_limit_backoff','rate_limit_halt_escalated',
                                          'tool_selection_ask','tool_unavailable',
                                          'task_graph_missing','task_graph_chain_depth_over_limit');   -- +16 Stage-4 slice events (migration 0011)
-- OD-170 (2026-07-03, Phase-6 gap-sweep change-control): +'authz_revoked_midtask' (FR-1.RLS.007 mid-task
-- authorization-stop → event_log, C1 L702) and +'rls_harness_divergence' (FR-1.RLS.008 divergence signal →
-- event_log, C1 L722/726). Both FRs mandate an event_log write but the enum admitted no matching value — a
-- Phase-6 slicing gap (ISSUE-020). Additive/expand-contract-safe.
-- OD-179 (2026-07-05, ISSUE-017 build gap-sweep change-control): +'webhook_verified' (FR-0.WHK.001 verified→event_log),
-- +'webhook_replay_dropped' (FR-0.WHK.008 replay-drop→event_log), +'webhook_rate_throttled' (FR-0.WHK.008 accept-rate
-- throttle→event_log), +'webhook_failure_alert' (FR-0.WHK.005 threshold alert). Same class as OD-170: the WHK FRs
-- mandate event_log writes but the enum admitted no matching value. Additive/expand-contract-safe; applying it as a
-- live silo migration (a 0002 enum-add) is owed at the ISSUE-017 onboarding live run (OD-172).
-- Stage-4 (migration 0011, expand-contract-safe): +16 values feeding the append-only event_log from five
-- Stage-4 slices — ISSUE-015 invite/seed (email_send_ok/email_send_failed/invite_bounced/account_activated,
-- FR-0.INV.003/.005/.007), ISSUE-016 support-recovery (support_request_created/support_notification_sent/
-- support_notification_failed/support_reescalation, FR-0.REC.002/.006/.007), ISSUE-034 rate-limiting
-- (rate_limit_throttled/rate_limit_paused/rate_limit_backoff/rate_limit_halt_escalated, FR-3.RL.003-006),
-- ISSUE-036 tool-optimisation (tool_selection_ask/tool_unavailable, FR-3.OPT.001/.004), ISSUE-049 task-graphs
-- (task_graph_missing/task_graph_chain_depth_over_limit, FR-5.GRP.001 / NFR-PERF.007). Same class as OD-170.
create type notification_read   as enum ('unread','read','actioned');
create type alert_type          as enum ('task_failure_spike','queue_backup','memory_confidence_drop',
                                          'approval_queue_stale','hard_limit_hit','cost_threshold_breach','loop_missed',
                                          'proactive','alert_delivery_misconfigured','alert_engine_stalled',
                                          'support_request');   -- +ISSUE-016 support-recovery admin notification (FR-0.REC.006; migration 0011)

-- Agents (C8)
create type step_failure_mode   as enum ('retry','skip_and_continue','halt_and_escalate');

-- Proactive (C9)
create type proactive_mode      as enum ('suggest','prepare','act');
create type suggestion_state    as enum ('generated','surfaced','acted','dismissed','expired','superseded');
create type answer_mode         as enum ('cited','inferred','unknown','building');

-- Infra / compliance (C10)
create type client_status       as enum ('initialising','active','offboarding','frozen');
create type deletion_status     as enum ('received','authorised','executed','rejected');
create type connector_deletion_flag_state as enum ('raised','acknowledged','resolved');

-- Config
create type config_edit_class   as enum ('live','boot','rebuild','secret');
```

> **Documentation enums (not stored as a column):** `config_edit_class` classifies each config key in
> the Phase-2 registry (it is metadata on the key definition, not a `config_values` column);
> `step_failure_mode` types each step's failure mode *inside* the `execution_plans.plan_body` /
> `task_graph_versions.steps` jsonb (default `halt_and_escalate`), not a top-level column. Both are
> defined here so the value sets are canonical and a build reader doesn't assume a missing column.

> `cost_tokens` uses a nullable `bigint` + a companion `cost_unknown boolean` sentinel (AC-7.LOG.004.1)
> — a genuinely-costless event records `0`; an uncomputable cost records `cost_unknown=true`, never a
> silent `0`. See `event_log`.

---

## 1. Identity & Auth  (C0 · Supabase-managed + app mirror)

Supabase-managed (referenced, not defined here): `auth.users`, `auth.identities`, `auth.mfa_factors`,
`auth.sessions`. OAuth-only for tenant users; email+password+TOTP for external Super Admins only (OD-018).

```sql
-- App-side user mirror (OD-P4-01: thin profile keyed to auth.uid)
create table profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text not null,
  name           text,
  active         boolean not null default true,        -- FR-1.USR.002 deactivation ≠ delete
  created_at     timestamptz not null default now(),
  last_active_at timestamptz,
  revoked_at     timestamptz,                           -- 0027/OD-192: issuer pre-use invite revoke (one-way; revoked invite no longer validates)
  bounced_at     timestamptz                            -- 0027/OD-192: setup email bounced (FR-0.INV.007 delivery axis; does not invalidate the token)
);

create table support_requests (
  id                uuid primary key default gen_random_uuid(),
  email             text not null,
  name              text not null,
  issue_description text not null,
  status            support_status not null default 'pending',
  assigned_to       uuid references profiles(id),       -- nullable while pending
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
-- RLS: read/resolve via PERM-support.view/.resolve; public INSERT-only pre-auth intake (§rls-policies).

-- OD-P4-02: split from connector credentials — webhook-verification secrets only
create table webhook_secrets (
  id                    uuid primary key default gen_random_uuid(),
  connector             text not null,                  -- ghl | slack | google
  secret_kind           text not null,                  -- e.g. ghl_webhook_ed25519, slack_signing
  secret_value          text not null,                  -- Vault-encrypted; service_role only
  secret_version        int not null default 1,         -- dual-accept rotation (FR-0.WHK.007)
  active                boolean not null default true,
  rotated_at            timestamptz,
  created_at            timestamptz not null default now()
);

create table webhook_replay_cache (
  event_id          text not null,
  connector_type    text not null,
  source_id         text not null,                      -- connector+token+IP (FR-0.WHK.005)
  seen_at           timestamptz not null default now(),
  window_expires_at timestamptz not null,
  primary key (connector_type, event_id)
);  -- ephemeral; auto-purged after window; no backup.
```

## 2. RBAC & Access  (C1)

```sql
create table roles (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  is_default   boolean not null default false,          -- the six seeded roles
  is_protected boolean not null default false,          -- Super Admin always; others while in use (OD-025)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table role_permissions (
  id              uuid primary key default gen_random_uuid(),
  role_id         uuid not null references roles(id) on delete cascade,
  permission_node text not null,                        -- e.g. PERM-memory.write; catalog = PERMISSION_NODES.md
  granted_at      timestamptz not null default now(),
  granted_by      uuid references profiles(id),
  unique (role_id, permission_node)                     -- presence = granted; absence = default-deny
);

create table user_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  role_id     uuid not null references roles(id),
  active      boolean not null default true,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references profiles(id),
  unique (user_id)                                      -- one role per user, v1 (OD-029)
);

create table sensitivity_clearances (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references profiles(id) on delete cascade,   -- OD-027: user- or role-scoped
  role_id           uuid references roles(id) on delete cascade,
  tier              clearance_tier not null,            -- standard implicit; restricted separate
  entity_type_scope text,                               -- null = Global (FR-1.CLR.004)
  granted_at        timestamptz not null default now(),
  granted_by        uuid references profiles(id),
  last_reviewed_at  timestamptz,                        -- drives review cadence (FR-1.CLR.005)
  check (num_nonnulls(user_id, role_id) = 1)            -- exactly one subject
);

create table restricted_grants (
  id               uuid primary key default gen_random_uuid(),
  grantee_user_id  uuid not null references profiles(id) on delete cascade,  -- named individual only
  granter_user_id  uuid not null references profiles(id),
  entity_id        uuid references entities(id),        -- null = scope wider (per OD-027)
  entity_type      text,
  reason           text not null,                       -- mandatory (L452)
  granted_at       timestamptz not null default now(),
  revoked_at       timestamptz,                         -- null = active (soft-delete)
  revoked_by       uuid references profiles(id)
);

create table access_audit (                             -- append-only, immutable
  id                  uuid primary key default gen_random_uuid(),
  audit_type          text not null,
  actor_identity      text not null,
  actor_type          actor_type not null,
  target_entity_id    uuid,
  target_type         text,
  action              text not null,
  before_value        jsonb,
  after_value         jsonb,
  reason              text,                              -- mandatory only for Restricted (enforced in app)
  path_context        text,
  originating_user_id uuid references profiles(id),      -- service_role task attribution (FR-1.RLS.007)
  redacted_at         timestamptz,                        -- one-way redaction-tombstone target (§Immutability L69; FR-7.LOG.006 / OD-074) — ISSUE-008 consistency fix
  created_at          timestamptz not null default now()
);
```

## 3. Memory  (C2)

```sql
create table entities (
  id            uuid primary key default gen_random_uuid(),
  type          text not null,                          -- validated vs config_values['entity_types']
  name          text not null,
  external_refs jsonb not null default '{}',            -- GHL/Slack/Drive ids — resolution join key
  is_internal_org boolean not null default false,       -- singleton per deployment (FR-2.ENT.003)
  maturity      numeric(4,3),                           -- filled slots / expected slots (ADR-002); stored, recomputed daily + on memory-write (FR-2.MAT.002)
  maturity_updated_at timestamptz,                       -- last recompute (slow-loop daily job or write-triggered)
  created_at    timestamptz not null default now()
);

create table memories (
  id             uuid primary key default gen_random_uuid(),
  type           memory_type not null,
  content        text not null,
  embedding      vector(1536) not null,                 -- never null/invalid (FR-2.WRT.007)
  embedding_model text not null default 'text-embedding-3-small',
  embedding_v2   vector(1536),                          -- expand-contract slot for model change (FR-2.VEC.003)
  entity_ids     uuid[] not null,                       -- ≥1 enforced by trigger/check (AC-2.MEM.002.2)
  source         memory_source not null,
  source_ref     text,                                  -- pointer to system-of-record (golden rule)
  confidence     numeric(4,3),                          -- 0–1; null only for system_pointer
  visibility     visibility_tier not null,
  sensitivity    sensitivity_tier not null,             -- never auto-restricted (app-enforced)
  superseded_by  uuid references memories(id),          -- CAS chain; null = live
  content_hash   text not null,                         -- idempotency component
  idempotency_key text not null,                        -- hash(source_ref, sorted entity_ids, content_hash) — ADR-004 §4
  expires_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (cardinality(entity_ids) >= 1),
  check (source = 'system_pointer' or confidence is not null),
  unique (idempotency_key)                              -- DB-level idempotency: retried step = no-op insert (ON CONFLICT DO NOTHING; ADR-004 §4)
);
-- Sole-writer: service_role (Memory Agent) only. Idempotency: unique(idempotency_key), modelled on idempotency_ledger (C3).
-- HNSW on embedding (indexes.md). RLS = C1 visibility/sensitivity/Restricted, clearance-before-ranking.
-- Per-entity watermark: (entity_ids, updated_at) index (indexes.md, ADR-004 §6) makes the top-k check cheap.

create table ingestion_queue (
  id               uuid primary key default gen_random_uuid(),
  content          text not null,
  source_ref       text,
  flag_reason      text,
  suggested_tier   sensitivity_tier,
  target_entity_id uuid references entities(id),
  state            ingestion_state not null default 'pending',
  deferred_until   timestamptz,
  reviewed_by      uuid references profiles(id),
  reviewed_at      timestamptz,
  decision_reason  text,
  created_at       timestamptz not null default now()
);  -- OD-P4-03: trust-window shadow-drops modelled as state='shadow_dropped' here (no separate store).

-- Net-new (surface-03): hard-conflict quarantine
create table memory_conflicts (
  id                    uuid primary key default gen_random_uuid(),
  new_memory            jsonb not null,                 -- pending candidate (not in live set)
  conflicting_memory_ids uuid[] not null,
  suggested_resolution  jsonb,                           -- FR-2.MNT.008 output
  state                 mem_review_state not null default 'pending',
  escalated_at          timestamptz,                     -- server-owned (C2 maintenance loop)
  resolved_by           uuid references profiles(id),
  resolved_at           timestamptz,
  created_at            timestamptz not null default now()
);

-- Net-new (surface-03): Personal-tier consolidation approval
create table consolidation_approvals (
  id                   uuid primary key default gen_random_uuid(),
  candidate_memory_ids uuid[] not null,
  op                   consolidation_op not null,
  tier                 sensitivity_tier not null default 'personal',
  state                mem_review_state not null default 'pending',
  escalated_at         timestamptz,
  resolved_by          uuid references profiles(id),
  resolved_at          timestamptz,
  created_at           timestamptz not null default now()
);
```
`entity_types`, `expected_slots`, `ranking_weights` are config structured objects in `config_values`
(§12), not tables. Per-entity Maturity is **stored** (`entities.maturity`), recomputed on the daily
slow loop and on memory-write for the touched entity (ADR-002 / FR-2.MAT.002); Aggregate Maturity
has no separate table — it is a rollup (`avg(entities.maturity)`) over that same stored column, cheap
because the per-entity values are already persisted. Retrieval Sufficiency is the other half of
ADR-002 and, unlike Maturity, genuinely **is** derived inline per query, not stored (FR-2.MAT.003).

## 4. Tools & Connectors  (C3)

```sql
create table tools (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  description         text not null,                    -- non-empty (drives AI selection)
  category            tool_category not null,
  risk_level          text,
  requires_approval   boolean not null default false,
  connector           text not null,
  scopes              text[],
  config              jsonb not null default '{}',
  enabled             boolean not null default true,    -- false hides from AI, keeps history
  version             int not null default 1,
  previous_version_id uuid references tools(id),
  change_reason       text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table connector_credentials (                    -- OD-P4-02: OAuth tokens (distinct from webhook_secrets)
  id            uuid primary key default gen_random_uuid(),
  connector     text not null,
  access_token  text not null,                          -- Vault-encrypted; service_role decrypt only
  refresh_token text,                                    -- Vault-encrypted
  expires_at    timestamptz,
  scopes        text[],
  state         credential_state not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table rate_limit_tracker (
  id              uuid primary key default gen_random_uuid(),
  connector       text not null,
  window_label    text not null,                        -- e.g. ghl_burst_10s, ghl_daily
  window_start    timestamptz not null,
  window_duration interval not null,
  call_limit      int not null,
  calls_made      int not null default 0,
  reset_at        timestamptz not null,
  updated_at      timestamptz not null default now(),
  unique (connector, window_label)
);

create table idempotency_ledger (                        -- net-new (FR-3.CONN.004)
  idempotency_key text primary key,                      -- deterministic per external write
  connector       text not null,
  result          jsonb,
  created_at      timestamptz not null default now()
);

create table rate_limit_deferred (                       -- net-new (FR-3.RL.004 persisted 95% deferral queue; migration 0012)
  id              uuid primary key default gen_random_uuid(),
  connector       text not null,
  window_label    text not null,                         -- the tracker window this call was paused against
  run_after       timestamptz not null,                  -- = the window reset_at at enqueue time
  risk_level      text,                                  -- carried across the pause so drain can re-route
  irreversible    boolean not null default false,        -- an irreversible write never queues (it halts); kept for drain-time assertion
  urgency         text not null,                         -- 'urgent' | 'background' (explicit, FR-3.RL.003)
  idempotency_key text,                                  -- present for writes → drain re-consults idempotency_ledger
  enqueued_at     timestamptz not null default now(),
  drained_at      timestamptz                            -- null = pending; set when drained (survives restart)
);  -- durable so a runtime restart never silently drops a paused call (AC-3.RL.004.1-2, #3). NO client_slug; carries
-- only the 0002 default_deny RLS floor (written/read by the connector runtime as service_role, RLS-exempt — ADR-006).
-- Drain scan served by rate_limit_deferred_due_idx (indexes.md; built CONCURRENTLY in migration 0017).

-- ── C3 trigger runtime state (OD-190; migration 0019_connector_trigger_state + 0020 indexes) ─────────────────
-- The trigger layer's MUTABLE operational state gets its OWN tables, NOT `tools.config`. tools.config is
-- version-locked by the 0008 enforce_tool_version_discipline trigger (only enabled/updated_at flip in place), so
-- the prior homing (all trigger state in tools.config, mutated in place) was a live-confirmed BLOCKER — every
-- trigger write RAISED. OD-190 re-homed the state below, keeping the tools append-only-by-version audit intact.
-- All net-new, intra-silo, NO client_slug (physical isolation is the boundary, ADR-001); each carries only the
-- 0002 default_deny RLS floor (written/read by the trigger runtime as service_role, RLS-exempt — ADR-006). All
-- mutating writes are single atomic upserts / insert-on-conflict (also fixes the prior non-atomic lost-update).

create table connector_triggers (                        -- net-new (FR-3.TRIG.002/003; migration 0019). Admin-edited, low-churn.
  id               uuid primary key default gen_random_uuid(),
  connector        text not null,
  kind             text not null,                         -- 'default' (shipped default set) | 'rule' (no-code rule)
  event_name       text not null,
  available_fields text[] not null default '{}',          -- the fields a default trigger carries (kind='default') — a rule validates against these at save
  conditions       jsonb not null default '[]',           -- rule condition clauses (kind='rule')
  task_name        text,                                  -- the task a matched rule launches (kind='rule')
  enabled          boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (kind in ('default', 'rule')),
  check (kind <> 'rule' or task_name is not null)         -- a rule MUST name a task
);  -- one 'default' per (connector,event_name) via the PARTIAL unique index connector_triggers_default_uq (kind='default';
-- migration 0020, CONCURRENTLY) — the ON CONFLICT arbiter for setDefaultTriggerEnabled. RULES are deliberately NOT unique
-- per event (overlapping rules all fire), so each is its own id-keyed row. Lookup by connector: connector_triggers_connector_idx (0020).

create table connector_watches (                         -- net-new (FR-3.TRIG.005; migration 0019). Expiring push-subscription liveness.
  connector    text not null,
  kind         text not null,                             -- gmail | drive_files | drive_changes | calendar
  channel_id   text not null,
  resource_id  text not null,
  expires_at   bigint not null,                           -- epoch seconds the watch lapses
  degraded     boolean not null default false,            -- true once a re-arm failed/lapsed (AC-3.TRIG.005.2)
  updated_at   timestamptz not null default now(),
  primary key (connector, kind)                           -- STABLE identity: channel_id/resource_id change every re-arm; upsert on (connector,kind) keeps one live row
);

create table event_watermarks (                          -- net-new (FR-3.TRIG.006; migration 0019). High-churn reconciliation cursor.
  connector   text not null,
  channel     text not null,                              -- slack channel id / gmail 'default'
  position    text not null,                              -- opaque last-good position (slack `ts` / gmail `historyId`)
  updated_at  bigint not null,                            -- caller-supplied logical now (epoch seconds)
  primary key (connector, channel)
);  -- advances every sweep — high-churn, which is exactly why it cannot ride in the version-locked tools.config (OD-190).

create table connector_delivery_health (                 -- net-new (FR-3.TRIG.006; migration 0019). Slack 2xx-rate monitor.
  connector     text primary key,
  success_rate  numeric not null,                         -- rolling 2xx delivery rate in [0,1]
  updated_at    bigint not null,                          -- caller-supplied logical now (epoch seconds)
  check (success_rate >= 0 and success_rate <= 1)
);

create table event_dedup_ledger (                         -- net-new (FR-3.TRIG.004; migration 0019). Idempotent receive.
  connector   text not null,
  event_id    text not null,                              -- connector delivery id (deliveryId / event_id / messageId)
  seen_at     bigint not null,                            -- caller-supplied logical now (epoch seconds)
  primary key (connector, event_id)                       -- recordEvent is insert ... on conflict do nothing → a re-delivery fires nothing twice (defence-in-depth over C0)
);
```

## 5. Prompt Content  (C4)

```sql
create table prompt_layers (
  id                  uuid primary key default gen_random_uuid(),
  layer               prompt_layer_kind not null,
  name                text not null,
  content             text not null,
  agent_id            uuid references agents(id),        -- required when layer='core'
  enabled             boolean not null default true,
  version             int not null default 1,
  previous_version_id uuid references prompt_layers(id),
  change_reason       text not null,                     -- non-empty (mandatory)
  created_at          timestamptz not null default now(),
  created_by          uuid references profiles(id),
  check (layer <> 'core' or agent_id is not null)
);  -- single authoritative Layer-1 store (no agents.system_prompt). Assembly halts if core missing (FR-4.LYR.004).

create table dynamic_field_values (
  field_name   text primary key,
  field_value  text,
  last_updated timestamptz not null default now()        -- staleness surfaced past freshness threshold
);
```

## 6. Execution / Harness  (C5)

```sql
create table task_queue (
  id                  uuid primary key default gen_random_uuid(),
  type                task_type not null,
  task_name           text not null,
  payload             jsonb not null default '{}',
  status              task_status not null default 'pending',
  priority            int not null default 100,
  requires_approval   boolean not null default false,
  approved_by         uuid references profiles(id),
  approved_at         timestamptz,
  awaiting_approval_at timestamptz,                        -- 0028: when the task ENTERED awaiting_approval (FR-5.QUE.005.2 staleness clock; coalesce(…, created_at) fallback)
  originating_user_id uuid references profiles(id),       -- ⊕ net-new owed to C5 (no-self-approval + My Queue)
  action_payload      jsonb,                              -- proposed tool call + params + target
  attempts            int not null default 0,             -- Inngest projection (single retry authority)
  next_retry_at       timestamptz,
  error               jsonb,                              -- full per-attempt history, never collapsed
  completed_at        timestamptz,
  created_at          timestamptz not null default now()
);  -- permanent audit record (never deleted). status is a fixed state machine.
-- CHECK: status='flagged' set only by C6; 'awaiting_approval' distinct (see guardrail_log join).

create table task_graph_versions (
  id                  uuid primary key default gen_random_uuid(),
  task_type_name      text not null,
  version             int not null default 1,
  steps               jsonb not null,                     -- ordered; per-step deps + failure mode
  change_reason       text not null,
  previous_version_id uuid references task_graph_versions(id),
  created_at          timestamptz not null default now(),
  created_by          uuid references profiles(id),
  unique (task_type_name, version)
);

-- OD-P4-04: durable originals store (never lose knowledge — #1); compression is envelope economy only.
create table task_history (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references task_queue(id) on delete cascade,
  step_index  int not null,
  full_output jsonb not null,                             -- uncompressed original (resume + audit)
  created_at  timestamptz not null default now(),
  unique (task_id, step_index)
);
```
The live context envelope (`DATA-context_envelope`, incl. `execution_plan`) lives in Inngest step-state
at runtime; `task_history` is the durable retention beyond Inngest's window (AF-115).

## 7. Guardrails  (C6)

```sql
create table guardrail_log (                              -- append-only
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid references task_queue(id),
  guardrail_type guardrail_type not null,
  description   text not null,
  action_blocked boolean not null,
  status        guardrail_status not null default 'pending',
  reviewed_by   uuid references profiles(id),
  reviewed_at   timestamptz,
  escalated_at  timestamptz,                              -- ⊕ net-new owed to C6 (server-owned)
  redacted_at   timestamptz,                              -- one-way redaction-tombstone target (§Immutability branch (c); FR-7.LOG.007.4 / OD-074) — added migration 0015 (reverses the 0001 H43 exclusion now C7/ISSUE-077 owns the erasure)
  created_at    timestamptz not null default now(),
  check (not (guardrail_type = 'hard_limit' and status = 'approved'))  -- AC-6.LOG.001.2: no override
);

create table injection_quarantine (                       -- net-new; shadow-retain (ADR-007 pt4)
  id               uuid primary key default gen_random_uuid(),
  guardrail_log_id uuid not null references guardrail_log(id),
  quarantined_content text not null,                      -- never machine-discarded
  source_tool      text not null,
  source_record_id text,
  human_decision   quarantine_decision,                   -- null = pending
  reviewed_by      uuid references profiles(id),
  reviewed_at      timestamptz,
  escalated_at     timestamptz,
  created_at       timestamptz not null default now()
);
```

## 8. Observability  (C7)  *(intra-client)*

```sql
create table event_log (                                  -- append-only
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid references task_queue(id),
  event_type   event_type not null,
  entity_ids   uuid[],
  summary      text not null,                             -- plain-English; never empty (AC-7.LOG.002.2)
  payload      jsonb,                                     -- redacted — no tokens/secrets (FR-7.LOG.005)
  duration_ms  int,
  cost_tokens  bigint,                                    -- nullable; see cost_unknown
  cost_unknown boolean not null default false,            -- sentinel ≠ 0 (AC-7.LOG.004.1)
  answer_mode  answer_mode,                               -- OD-P4-05: stored on AI-output rows (pill)
  redacted_at  timestamptz,                               -- one-way redaction-tombstone target (§Immutability L69) — ISSUE-008 consistency fix
  created_at   timestamptz not null default now()
);  -- exactly one terminal event per task (task_completed XOR task_failed); silent-failure detector joins task_queue.

create table notifications (                              -- net-new store owed to C7
  id              uuid primary key default gen_random_uuid(),
  type            alert_type not null,
  severity        text not null,
  title           text not null,
  body            text not null,
  recipient       uuid references profiles(id),           -- resolved role/user; null = broadcast-to-role (see routing)
  recipient_role  text,
  read_state      notification_read not null default 'unread',
  escalation_state text,                                   -- ⊕ net-new (FR-7.ALR.005)
  escalated_at    timestamptz,                             -- ⊕ net-new
  actioned_at     timestamptz,                             -- ⊕ net-new (unread-until-actioned)
  delivery_state  jsonb,                                   -- dashboard-first; Slack best-effort outcome
  created_at      timestamptz not null default now()
);  -- persisted before Slack fan-out; a Slack failure never loses the row (FR-7.ALR.006).

create table config_audit_log (                            -- append-only + tamper-evident (FR-7.LOG.008)
  id         uuid primary key default gen_random_uuid(),
  key        text not null,                                -- key-prefix-scoped reads (PERM-config.*)
  old_value  jsonb,                                        -- null on first-ever write
  new_value  jsonb not null,
  actor_id   uuid references profiles(id),                 -- redaction-tombstone target on erasure
  redacted_at timestamptz,                                 -- one-way redaction-tombstone target (§Immutability L69) — ISSUE-008 consistency fix
  changed_at timestamptz not null default now()
);  -- SECRET-class changes never produce a row.

create table push_subscriptions (                          -- net-new (surface-12, FR-7.VIEW.003)
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references profiles(id) on delete cascade,
  endpoint  text not null,
  keys      jsonb not null,
  platform  text,
  last_seen timestamptz not null default now(),
  unique (user_id, endpoint)
);  -- a failed registration reads "push not enabled", never a false "on".
```
**Cost (OD-P4-05):** no separate cost table — the running meter and per-task-type aggregation derive
from `event_log.cost_tokens` × `config_values['price_table']`. `alert_routing_rules`/`escalation_contacts`/
`quiet_hours` are config structured objects (§12), not tables.

## 9. Agent Design  (C8)

```sql
create table agents (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,                       -- '{slug}_<role>_agent' — slug only in the string
  description         text not null,                       -- non-empty (routing signal)
  memory_scope        jsonb not null,                      -- least-privilege retrieval filter
  tools_allowed       uuid[] not null default '{}',        -- → tools.id; hard-limit invariants reject-at-write
  max_tokens          int,
  enabled             boolean not null default true,       -- gates routing discovery
  version             int not null default 1,
  previous_version_id uuid references agents(id),
  change_reason       text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references profiles(id)
);  -- NO system_prompt (→ prompt_layers), NO model (complexity-routed), NO client_slug.

create table agent_health_metrics (                        -- net-new metric store
  agent_id       uuid not null references agents(id) on delete cascade,
  success_rate   numeric,
  failure_rate   numeric,
  last_run       timestamptz,
  drift_score    numeric,
  dead_agent_flag boolean not null default false,
  routing_mismatch_count int not null default 0,
  producer_heartbeat timestamptz,                           -- stalled producer → "stale" not green (AC-8.HLTH.004.2)
  updated_at     timestamptz not null default now(),
  primary key (agent_id)
);  -- flag-never-auto-correct (OD-078).

create table agent_result_cache (                          -- OD-P4-07: dedicated, auditable
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references agents(id) on delete cascade,
  scope_entity_ids uuid[] not null,
  memory_version text not null,                             -- last-write / version component of the key
  output        jsonb not null,
  expires_at    timestamptz not null,                       -- per-agent-type window (cache_time_window)
  created_at    timestamptz not null default now()
);  -- write-triggered scope-aware invalidation (OD-076); miss-on-uncertainty (AC-8.LRN.003.3).

create table execution_plans (                             -- net-new versioned routing-plan store
  id                  uuid primary key default gen_random_uuid(),
  task_type_name      text not null,
  version             int not null default 1,
  plan_body           jsonb not null,                       -- steps + per-step failure_mode + deps + parallel flag
  previous_version_id uuid references execution_plans(id),
  created_at          timestamptz not null default now(),
  created_by          uuid references profiles(id),
  unique (task_type_name, version)
);  -- human-only rollback (OOS-030). Live plan is copied into the C5 envelope's execution_plan at run.
```
Routing weights + orchestrator confidence threshold are config keys (§12). Per-step `failure_mode`
uses the `step_failure_mode` enum; unassigned defaults to `halt_and_escalate`.

## 10. Proactive  (C9)

```sql
create table proactive_suggestions (
  id            uuid primary key default gen_random_uuid(),
  mode          proactive_mode not null,
  state         suggestion_state not null default 'generated',
  reasoning     text,
  answer_mode   answer_mode,
  risk_type     text,
  recipient_id  uuid references profiles(id),
  delivery_state jsonb,
  rank          numeric,
  is_floor      boolean not null default false,             -- derisking safety-floor flag (queryable)
  linked_task_id uuid references task_queue(id),            -- Prepare-mode spawns a task
  generated_at  timestamptz not null default now(),
  surfaced_at   timestamptz
);  -- never silently dropped; reaches a terminal state. Floor items never dropped below risk floor.

create table commands (                                    -- net-new; user-defined only
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,                  -- collision-checked vs system slugs at write
  display_name      text not null,
  description       text,
  prompt_template   text not null,                         -- holds $ARGUMENTS
  assigned_agent_id uuid not null references agents(id),   -- must be enabled at save
  perm_node         text not null,                         -- C1 invocation gate
  active            boolean not null default true,         -- auto-false when agent disabled (trigger)
  created_by        uuid references profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);  -- system commands are code-registered, never rows here.

create table signal_weights (                              -- net-new dismissal-learning state
  id          uuid primary key default gen_random_uuid(),
  signal_key  text not null unique,
  weight      numeric not null,
  floor       numeric,                                     -- never suppresses derisking floor
  updated_at  timestamptz not null default now()
);
```

## 11. Chat  (net-new — OD-135)

```sql
create table conversations (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references profiles(id) on delete cascade,
  title         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);  -- losing history on reload = #1 violation → persisted.

create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender          text not null,                           -- 'user' | 'agent'
  body            text not null,
  answer_mode     answer_mode,                             -- pill on agent messages
  task_queue_id   uuid references task_queue(id),          -- nullable; sync command results have no task row
  created_at      timestamptz not null default now()
);  -- async results return via poll + notification nudge, no third Realtime socket (AC-7.RTP.001.3).
```

## 12. Config cluster  (Phase-2 registry → storage)

```sql
create table config_values (
  key        text primary key,                              -- dotted key; ~117 knobs + ~11 structured objects
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);  -- key-prefix RLS by PERM-config.* group. SECRET class never stored here.

create table secret_manifest (
  key          text primary key,                            -- env var name (the 11 platform secrets)
  present      boolean not null,                            -- required-missing blocks boot
  last_rotated timestamptz                                  -- deploy-hook populated (OD-102); else "Unknown"
);  -- presence + last_rotated only — values live in env/Railway, never here.
```
Structured objects stored as `config_values.value` JSON: `ranking_weights`, `routing_weights`,
`anomaly_thresholds`, `risk_thresholds`, `opportunity_thresholds`, `action_autonomy_matrix`,
`cache_time_window`, `price_table`, `entity_types`, `expected_slots`,
`rate_max_calls_per_connector_window`, `alert_routing_rules`, `escalation_contacts`, `quiet_hours`.
`config_audit_log` (§8) is the write-audit sink for every LIVE/BOOT/REBUILD change.

## 13. Management plane  (separate deployment — ADR-001 §7)

> These tables live **only** on the management deployment, never in a client silo. This is the **one**
> place `client_slug` is valid.

```sql
create table client_registry (
  id                      uuid primary key default gen_random_uuid(),
  client_slug             text not null unique,              -- ✅ the ONLY valid client_slug in the product
  client_name             text not null,
  railway_url             text,
  internal_token          text not null,                     -- encrypted; never returned to a surface
  core_version            text,                              -- push-updated (FR-7.MGM.001)
  region                  text not null default 'ap-southeast-2',
  status                  client_status not null default 'initialising',  -- server-authoritative
  created_at              timestamptz not null default now(),
  offboarding_initiated_at timestamptz,
  offboarding_at          timestamptz
);

create table deployment_health (                             -- push-fed operational metadata only (no business data)
  client_slug        text primary key references client_registry(client_slug),
  health_score       numeric,
  queue_depth        int,
  approval_queue_depth int,
  alert_counts       jsonb,
  core_version       text,
  last_migrated_at   timestamptz,
  connector_rollup   jsonb,
  cost_to_date       numeric,
  plugin_version     text,
  backup_health      jsonb,                                  -- Supabase Management API (FR-7.MGM.005)
  log_write_failing  boolean not null default false,        -- health bit (AC-7.LOG.003.2)
  last_push_at       timestamptz not null,                  -- staleness sweep vs server-authoritative time
  updated_at         timestamptz not null default now()
);

create table offboarding_records (                           -- mgmt DB; no client business data
  id                     uuid primary key default gen_random_uuid(),
  client_slug            text not null references client_registry(client_slug),
  offboarding_initiated_at timestamptz,
  export_delivered_at    timestamptz,
  export_acknowledged_at timestamptz,
  retention_window_end   timestamptz,
  deletion_executed_at   timestamptz,
  deletion_executed_by   uuid,
  systems_deprovisioned  text[],                             -- Supabase/Railway/credentials/...
  tokens_revoked         text[],
  created_at             timestamptz not null default now()
);
```

## 14. Compliance workflow  (C10 · client-side)

```sql
create table deletion_requests (
  id                   uuid primary key default gen_random_uuid(),
  requester_id         uuid not null references profiles(id),
  target_user_id       uuid references profiles(id),          -- individual right-to-erasure subject
  legal_basis          text,
  status               deletion_status not null default 'received',
  authorized_by        uuid references profiles(id),
  second_authoriser_id uuid references profiles(id),          -- two-person auth (≠ authorized_by, ≠ executor)
  executor_id          uuid references profiles(id),
  executed_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- AC-10.DEL.006.2 two-person auth. `is distinct from` is NULL-safe: allows pre-fill nulls, rejects same-person.
  check (second_authoriser_id is distinct from authorized_by),
  check (executor_id is distinct from authorized_by
         and executor_id is distinct from second_authoriser_id),
  -- and at execution, all three roles must be filled by three DISTINCT people (the guarantee, DB-enforced)
  check (status <> 'executed'
         or (authorized_by is not null and second_authoriser_id is not null and executor_id is not null))
);  -- Restricted/Personal require two-person auth (AC-10.DEL.006.2). Erasure walks the C2 sole-writer path;
-- audit written to access_audit (retained individual_deletion_audit_years even after data is gone).

-- net-new (FR-10.DEL.006(a)): per-system connector-notify flag, tracked-until-acknowledged, never silently closed
create table connector_deletion_flags (
  id                   uuid primary key default gen_random_uuid(),
  deletion_request_id  uuid not null references deletion_requests(id) on delete cascade,
  connector            text not null,                          -- e.g. ghl | slack | google — SoR holding the person's data
  state                connector_deletion_flag_state not null default 'raised',
  raised_at            timestamptz not null default now(),
  acknowledged_at      timestamptz,
  acknowledged_by      uuid references profiles(id),
  escalated_at         timestamptz,                             -- un-acknowledged past window (AC-10.DEL.006.3)
  created_at           timestamptz not null default now()
);  -- the harness never deletes from a SoR itself; this flag is the tracked reminder (AC-10.DEL.006.1/.3).

-- OD-162: the "local mirror" of client_registry.status (management plane) — lives INSIDE each client's own
-- Supabase project, not the management plane. Single row per deployment; written by a management-plane
-- action using the client's custodied service_role key (ADR-001 §7) when C10 sets
-- client_registry.status = 'frozen' (FR-10.OFF.004). Read locally (no cross-deployment query) by the C5
-- dispatch gate (FR-5.TRG.001.3) and the C10 erasure precondition (FR-10.DEL.007).
create table deployment_settings (
  frozen_at    timestamptz,                                     -- null = not frozen
  frozen_reason text
);  -- single row per deployment (seeded at first boot alongside the Internal-Org singleton; app never inserts a second row).
```

---

## Coverage note

Every one of the 21 matrix `DATA-*` ids + the config cluster + the 16 net-new Phase-3 stores/fields is
represented above. `DATA-context_envelope` is runtime (Inngest) with `task_history` as its durable tail.
The 7 schema ODs (OD-P4-01…07) are resolved here per the recommended options (user-delegated); listed in
`_data-inventory.md` for sign-off review. Owed-back change-control cites (net-new stores → component FRs)
are tracked in `_data-inventory.md` "Net-new stores owed back" and applied in Phase-4 step 8.
