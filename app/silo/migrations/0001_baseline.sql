-- Client-silo baseline migration 0001 — transactional part (ISSUE-008)
--
-- SCOPE NOTE (Rule 0): this migration creates EXTENSIONS + TYPES + TABLES + TRIGGERS ONLY.
-- The rest of migration 0001 is split across siblings to honor the CONCURRENTLY
-- non-transactional rule (migrations.md L39, L46-48):
--   * 0001b — indexes (vector/heavy builds run CONCURRENTLY, outside any txn block).
--   * 0001c — RLS (enable row level security + policies + SECURITY DEFINER helpers).
--   * 0001d — seed (idempotent, first-boot-only).
-- Every column/type/default/constraint below is transcribed VERBATIM from the schema
-- source of truth: spec/04-data-model/schema.md. Do NOT diverge here.
--
-- This lives in a CLIENT SILO (the client's own Supabase). The management-plane tables
-- client_registry, deployment_health, offboarding_records are a SEPARATE migration
-- lineage (schema.md §13; migrations.md L50-54) owned by ISSUE-012 — they are EXCLUDED
-- here and never created in a client silo. `client_slug` never appears in a silo.
--
-- The runner wraps this file in a transaction — do NOT add BEGIN/COMMIT.

-- ── Extensions ─────────────────────────────────────────────────────────────
-- migrations.md L22: vector (pgvector); pgcrypto (for gen_random_uuid()).
create extension if not exists vector;
create extension if not exists pgcrypto;

-- ── Types (enums & domains) ────────────────────────────────────────────────
-- Verbatim from schema.md §Types (L74-140), in listed order. Tables reference them.

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
                                          'authz_revoked_midtask','rls_harness_divergence');   -- FR-7.ALR.004 alert types (6) + FR-7.MGM.001.3 reporter-attempt log
-- OD-170 (2026-07-03, Phase-6 gap-sweep change-control): +'authz_revoked_midtask' (FR-1.RLS.007 mid-task
-- authorization-stop → event_log, C1 L702) and +'rls_harness_divergence' (FR-1.RLS.008 divergence signal →
-- event_log, C1 L722/726). Both FRs mandate an event_log write but the enum admitted no matching value — a
-- Phase-6 slicing gap (ISSUE-020). Additive/expand-contract-safe.
create type notification_read   as enum ('unread','read','actioned');
create type alert_type          as enum ('task_failure_spike','queue_backup','memory_confidence_drop',
                                          'approval_queue_stale','hard_limit_hit','cost_threshold_breach','loop_missed',
                                          'proactive','alert_delivery_misconfigured','alert_engine_stalled');

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
-- NOTE (schema.md L142-146): config_edit_class and step_failure_mode are DOCUMENTATION enums —
-- not stored as a top-level column (config_edit_class = registry metadata on a key; step_failure_mode
-- types each step inside plan_body/steps jsonb). Defined here so the value sets are canonical.

-- ── Tables (dependency order per migrations.md L24-33) ──────────────────────

-- schema.md L161 (§1 Identity & Auth, C0)
create table profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text not null,
  name           text,
  active         boolean not null default true,        -- FR-1.USR.002 deactivation ≠ delete
  created_at     timestamptz not null default now(),
  last_active_at timestamptz
);

-- schema.md L170
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

-- schema.md L183 (OD-P4-02: webhook-verification secrets only)
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

-- schema.md L194
create table webhook_replay_cache (
  event_id          text not null,
  connector_type    text not null,
  source_id         text not null,                      -- connector+token+IP (FR-0.WHK.005)
  seen_at           timestamptz not null default now(),
  window_expires_at timestamptz not null,
  primary key (connector_type, event_id)
);  -- ephemeral; auto-purged after window; no backup.

-- schema.md L207 (§2 RBAC & Access, C1)
create table roles (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  is_default   boolean not null default false,          -- the six seeded roles
  is_protected boolean not null default false,          -- Super Admin always; others while in use (OD-025)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- schema.md L216
create table role_permissions (
  id              uuid primary key default gen_random_uuid(),
  role_id         uuid not null references roles(id) on delete cascade,
  permission_node text not null,                        -- e.g. PERM-memory.write; catalog = PERMISSION_NODES.md
  granted_at      timestamptz not null default now(),
  granted_by      uuid references profiles(id),
  unique (role_id, permission_node)                     -- presence = granted; absence = default-deny
);

-- schema.md L225
create table user_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  role_id     uuid not null references roles(id),
  active      boolean not null default true,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references profiles(id),
  unique (user_id)                                      -- one role per user, v1 (OD-029)
);

-- schema.md L235
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

-- schema.md L279 (§3 Memory, C2) — entities precedes restricted_grants/access_audit/memories per migrations.md L26-27
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

-- schema.md L247
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

-- schema.md L259 (append-only, immutable)
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
  redacted_at         timestamptz,                        -- one-way redaction-tombstone target (schema.md §Immutability L69; FR-7.LOG.006 / OD-074)
  created_at          timestamptz not null default now()
);
-- RESOLVED (ISSUE-008): schema.md §Immutability L69 decided event_log/access_audit/config_audit_log carry a
-- `redacted_at timestamptz` column (the append-only trigger's redaction branch keys off new.redacted_at), but
-- the three table DDL blocks omitted it — a source inconsistency. Reconciled to the L69 decision here (column
-- added) and in schema.md (source patched). Not an invention: L69 already fixed the column. guardrail_log
-- intentionally has none (trigger special-cases it).

-- schema.md L290
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

-- schema.md L317
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

-- schema.md L333 (net-new surface-03: hard-conflict quarantine)
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

-- schema.md L346 (net-new surface-03: Personal-tier consolidation approval)
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

-- schema.md L368 (§4 Tools & Connectors, C3)
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

-- schema.md L386
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

-- schema.md L398
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

-- schema.md L411 (net-new FR-3.CONN.004)
create table idempotency_ledger (                        -- net-new (FR-3.CONN.004)
  idempotency_key text primary key,                      -- deterministic per external write
  connector       text not null,
  result          jsonb,
  created_at      timestamptz not null default now()
);

-- schema.md L582 (§9 Agent Design, C8) — agents precedes prompt_layers/commands per migrations.md L27
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

-- schema.md L422 (§5 Prompt Content, C4)
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

-- schema.md L437
create table dynamic_field_values (
  field_name   text primary key,
  field_value  text,
  last_updated timestamptz not null default now()        -- staleness surfaced past freshness threshold
);

-- schema.md L447 (§6 Execution / Harness, C5)
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
  originating_user_id uuid references profiles(id),       -- ⊕ net-new owed to C5 (no-self-approval + My Queue)
  action_payload      jsonb,                              -- proposed tool call + params + target
  attempts            int not null default 0,             -- Inngest projection (single retry authority)
  next_retry_at       timestamptz,
  error               jsonb,                              -- full per-attempt history, never collapsed
  completed_at        timestamptz,
  created_at          timestamptz not null default now()
);  -- permanent audit record (never deleted). status is a fixed state machine.
-- CHECK: status='flagged' set only by C6; 'awaiting_approval' distinct (see guardrail_log join).

-- schema.md L467
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

-- schema.md L480 (OD-P4-04: durable originals store)
create table task_history (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references task_queue(id) on delete cascade,
  step_index  int not null,
  full_output jsonb not null,                             -- uncompressed original (resume + audit)
  created_at  timestamptz not null default now(),
  unique (task_id, step_index)
);

-- schema.md L621 (§9 Agent Design, C8: net-new versioned routing-plan store)
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

-- schema.md L495 (§7 Guardrails, C6: append-only)
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
  created_at    timestamptz not null default now(),
  check (not (guardrail_type = 'hard_limit' and status = 'approved'))  -- AC-6.LOG.001.2: no override
);

-- schema.md L509 (net-new; shadow-retain ADR-007 pt4)
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

-- schema.md L526 (§8 Observability, C7: append-only)
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
  redacted_at  timestamptz,                                -- one-way redaction-tombstone target (schema.md §Immutability L69)
  created_at   timestamptz not null default now()
);  -- exactly one terminal event per task (task_completed XOR task_failed); silent-failure detector joins task_queue.
-- RESOLVED (ISSUE-008): redacted_at added to reconcile the schema.md L69 decision with this DDL (see access_audit note).

-- schema.md L540 (net-new store owed to C7)
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

-- schema.md L556 (append-only + tamper-evident, FR-7.LOG.008)
create table config_audit_log (                            -- append-only + tamper-evident (FR-7.LOG.008)
  id         uuid primary key default gen_random_uuid(),
  key        text not null,                                -- key-prefix-scoped reads (PERM-config.*)
  old_value  jsonb,                                        -- null on first-ever write
  new_value  jsonb not null,
  actor_id   uuid references profiles(id),                 -- redaction-tombstone target on erasure
  redacted_at timestamptz,                                 -- one-way redaction-tombstone target (schema.md §Immutability L69)
  changed_at timestamptz not null default now()
);  -- SECRET-class changes never produce a row.
-- RESOLVED (ISSUE-008): redacted_at added to reconcile the schema.md L69 decision with this DDL (see access_audit note).

-- schema.md L565 (net-new surface-12, FR-7.VIEW.003)
create table push_subscriptions (                          -- net-new (surface-12, FR-7.VIEW.003)
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references profiles(id) on delete cascade,
  endpoint  text not null,
  keys      jsonb not null,
  platform  text,
  last_seen timestamptz not null default now(),
  unique (user_id, endpoint)
);  -- a failed registration reads "push not enabled", never a false "on".

-- schema.md L598 (§9 Agent Design, C8: net-new metric store)
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

-- schema.md L611 (OD-P4-07: dedicated, auditable)
create table agent_result_cache (                          -- OD-P4-07: dedicated, auditable
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references agents(id) on delete cascade,
  scope_entity_ids uuid[] not null,
  memory_version text not null,                             -- last-write / version component of the key
  output        jsonb not null,
  expires_at    timestamptz not null,                       -- per-agent-type window (cache_time_window)
  created_at    timestamptz not null default now()
);  -- write-triggered scope-aware invalidation (OD-076); miss-on-uncertainty (AC-8.LRN.003.3).

-- schema.md L638 (§10 Proactive, C9)
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

-- schema.md L654 (net-new; user-defined only)
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

-- schema.md L668 (net-new dismissal-learning state)
create table signal_weights (                              -- net-new dismissal-learning state
  id          uuid primary key default gen_random_uuid(),
  signal_key  text not null unique,
  weight      numeric not null,
  floor       numeric,                                     -- never suppresses derisking floor
  updated_at  timestamptz not null default now()
);

-- schema.md L680 (§11 Chat, net-new OD-135)
create table conversations (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references profiles(id) on delete cascade,
  title         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);  -- losing history on reload = #1 violation → persisted.

-- schema.md L688
create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender          text not null,                           -- 'user' | 'agent'
  body            text not null,
  answer_mode     answer_mode,                             -- pill on agent messages
  task_queue_id   uuid references task_queue(id),          -- nullable; sync command results have no task row
  created_at      timestamptz not null default now()
);  -- async results return via poll + notification nudge, no third Realtime socket (AC-7.RTP.001.3).

-- schema.md L702 (§12 Config cluster)
create table config_values (
  key        text primary key,                              -- dotted key; ~117 knobs + ~11 structured objects
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);  -- key-prefix RLS by PERM-config.* group. SECRET class never stored here.

-- schema.md L709
create table secret_manifest (
  key          text primary key,                            -- env var name (the 11 platform secrets)
  present      boolean not null,                            -- required-missing blocks boot
  last_rotated timestamptz                                  -- deploy-hook populated (OD-102); else "Unknown"
);  -- presence + last_rotated only — values live in env/Railway, never here.

-- schema.md L776 (§14 Compliance workflow, C10 client-side)
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

-- schema.md L799 (net-new FR-10.DEL.006(a))
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

-- schema.md L816 (OD-162: local mirror of client_registry.status, lives inside each client silo)
create table deployment_settings (
  frozen_at    timestamptz,                                     -- null = not frozen
  frozen_reason text
);  -- single row per deployment (seeded at first boot alongside the Internal-Org singleton; app never inserts a second row).

-- ── Immutability enforcement (audit sinks) ─────────────────────────────────
-- Verbatim from schema.md §Immutability enforcement (L38-66). Fires regardless of role
-- (incl. service_role, which is RLS-exempt by design). Protects the four append-only sinks:
-- event_log, guardrail_log, access_audit, config_audit_log. DELETE always forbidden; UPDATE
-- allowed only for a whitelisted forward status transition (guardrail_log) or a one-way
-- redaction-tombstone. Referenced by rls-policies.md L94-98.
create or replace function enforce_audit_append_only() returns trigger
  language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'audit sink %: DELETE forbidden (append-only)', tg_table_name;
  end if;                                             -- UPDATE: allow only whitelisted mutations
  if tg_table_name = 'guardrail_log'
     and old.status = 'pending' and new.status in ('approved','rejected','modified')
     and new.description = old.description and new.task_id = old.task_id then
    return new;                                       -- forward status transition (still append-only in spirit)
  end if;
  if tg_table_name <> 'guardrail_log' then             -- guardrail_log has no redacted_at column (H43 fix)
    if new.redacted_at is not null and old.redacted_at is null then
      return new;                                     -- one-way redaction-tombstone (FR-7.LOG.006 / OD-074)
    end if;
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
