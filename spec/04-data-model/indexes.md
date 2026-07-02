# Phase 4 — Indexes

**Status:** Draft (Phase 4). Companion to `schema.md`. Every index cites the query it serves. Heavy /
vector index builds run **`CONCURRENTLY`** so a deploy never locks the table (`migration-discipline.md`).

## Vector (the load-bearing one)

```sql
-- memories.embedding — HNSW cosine (pgvector ≥ 0.8), per FR-2.VEC.001
create index concurrently memories_embedding_hnsw
  on memories using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);
-- query-time: set hnsw.ef_search = <ef_search config>  (~40 default, tunable knob)
```
- During an embedding-model change (expand-contract), `embedding_v2` gets its own HNSW index built
  `CONCURRENTLY` before the contract step drops the old column + index (FR-2.VEC.003).
- ⚠️ **AF-019 (paper-until-tested):** pgvector applies RLS/WHERE **after** the ANN scan, so aggressive
  clearance filtering can starve recall. Retrieval strategy (over-fetch + filter, or partial indexes per
  clearance band) is a Phase-5 spike, not decided here.

## Memory write-path (sole-writer idempotency + watermark — ADR-004)

```sql
create index concurrently memories_entity_ids_updated_at on memories (entity_ids, updated_at);  -- ADR-004 §3/§6 per-entity watermark
```
`memories.idempotency_key` is already indexed by its own `UNIQUE` constraint (`schema.md`) — no separate
index needed. `memories_entity_ids_updated_at` backs the optimistic validate-and-commit's `v0≠v1` re-check:
a cheap "most recent write touching this entity" lookup, so the lock wraps only the DB validate-and-commit,
never the LLM call (ADR-004 §3).

## Queue / oldest-first / overdue (the `(status, created_at)` family)

```sql
create index concurrently task_queue_status_created   on task_queue (status, created_at);
create index concurrently task_queue_user_status      on task_queue (originating_user_id, status);   -- My Queue
create index concurrently guardrail_log_status_created on guardrail_log (status, created_at);
create index concurrently ingestion_queue_state_created on ingestion_queue (state, created_at);
create index concurrently memory_conflicts_state_created on memory_conflicts (state, created_at);
create index concurrently consolidation_state_created  on consolidation_approvals (state, created_at);
```
Serve: approval/review queues (oldest-first + overdue/escalation math), My Queue per user, DLQ view.

## Observability / silent-failure detector

```sql
create index concurrently event_log_type_created on event_log (event_type, created_at);
create index concurrently event_log_task         on event_log (task_id);      -- terminal-event reconciliation
```
- The **silent-failure detector** (AC-7.LOG.003.1) joins `task_queue` (terminal status) against
  `event_log` (terminal event via `event_log_task`) to find "tasks with a terminal status but no
  terminal event". `event_log_type_created` also serves the 60s polled event-log feed.
- Relevance-scoping of the per-user activity feed (surface-08/12) needs an index supporting "rows
  relevant to me"; concrete shape (GIN on `entity_ids` vs a relevance column) is a build call — flagged.

```sql
create index concurrently event_log_entity_ids_gin on event_log using gin (entity_ids);  -- per-entity pill-mix + relevance
create index concurrently memories_entity_ids_gin  on memories using gin (entity_ids);    -- entity → memories browse
```

## RBAC policy-read (initPlan performance — AF-067)

```sql
create index concurrently role_permissions_role_node on role_permissions (role_id, permission_node);
create index concurrently role_permissions_node      on role_permissions (permission_node);   -- coverage proofs
create unique index concurrently user_roles_user     on user_roles (user_id);                  -- one role/user (OD-029)
create index concurrently clearances_subject         on sensitivity_clearances (user_id, tier, entity_type_scope);
create index concurrently clearances_review          on sensitivity_clearances (last_reviewed_at);   -- overdue-review sweep
create index concurrently restricted_grantee_active  on restricted_grants (grantee_user_id) where revoked_at is null;
```
These back the `(select user_perms/…)` helper lookups so the initPlan is a single indexed read per statement.

## Connectors / tokens / rate limits

```sql
create unique index concurrently rate_tracker_conn_window on rate_limit_tracker (connector, window_label);
create index concurrently connector_credentials_conn on connector_credentials (connector);
create index concurrently webhook_replay_lookup on webhook_replay_cache (connector_type, source_id, seen_at);
```

## Versioned tables (history chains)

```sql
create index concurrently prompt_layers_agent_core on prompt_layers (agent_id, layer);   -- Layer-1 fetch WHERE agent_id AND layer='core'
create index concurrently prompt_layers_prev on prompt_layers (previous_version_id);
create index concurrently agents_enabled on agents (enabled);                            -- routing candidacy
create index concurrently agents_prev on agents (previous_version_id);
create index concurrently tools_prev on tools (previous_version_id);
create unique index concurrently task_graph_type_ver on task_graph_versions (task_type_name, version);
create unique index concurrently execution_plans_type_ver on execution_plans (task_type_name, version);
```

## Net-new stores

```sql
create index concurrently notifications_recipient_read on notifications (recipient, read_state, created_at);
create index concurrently notifications_role on notifications (recipient_role) where recipient is null;
create index concurrently config_audit_key_changed on config_audit_log (key, changed_at);   -- key-prefix + ordering
create unique index concurrently push_sub_user_endpoint on push_subscriptions (user_id, endpoint);
create index concurrently agent_result_cache_key on agent_result_cache (agent_id, memory_version);
create index concurrently agent_result_cache_scope_gin on agent_result_cache using gin (scope_entity_ids);  -- write-triggered invalidation lookup
create index concurrently agent_result_cache_expiry on agent_result_cache (expires_at);
create unique index concurrently commands_slug on commands (slug);
create index concurrently commands_agent on commands (assigned_agent_id);                -- disabled-agent auto-flip watch
create index concurrently messages_conversation on messages (conversation_id, created_at);
create index concurrently conversations_owner on conversations (owner_user_id, updated_at);
create index concurrently proactive_recipient_state on proactive_suggestions (recipient_id, state);
create index concurrently proactive_floor on proactive_suggestions (is_floor) where state in ('generated','surfaced');
create index concurrently task_history_task_step on task_history (task_id, step_index);
```

## Compliance workflow (C10)

```sql
create index concurrently connector_deletion_flags_state_raised on connector_deletion_flags (state, raised_at);
```
Serves the tracked-until-acknowledged connector-flag queue (oldest-first + escalation sweep, AC-10.DEL.006.3),
same `(status, created_at)`-family shape as the other review queues above. `deployment_settings` is a
single-row-per-deployment table (schema.md) — no index needed.

## Management plane

```sql
create index concurrently deployment_health_stale on deployment_health (last_push_at);    -- staleness sweep (AC-7.MGM.002.3)
create index concurrently deployment_health_version on deployment_health (core_version);  -- version-skew spread
create index concurrently offboarding_client on offboarding_records (client_slug);
```

## Notes

- Every index above is additive (expand step). No `CONCURRENTLY` inside a transaction block (migration
  discipline). Partial indexes (`where …`) keep the hot queues small.
- REBUILD-class config changes (`embedding_model`) trigger the vector-index rebuild path (taxonomy rule 5)
  — an expand-contract on `memories_embedding_hnsw` via `embedding_v2`, never an in-place drop.
