-- Client-silo migration 0001b — concurrent indexes (ISSUE-008)
--
-- NON-TRANSACTIONAL STEP: every index below is built CONCURRENTLY, which cannot run
-- inside a transaction block (migrations.md L46-48). The runner MUST apply this file with
-- autocommit / no transaction wrapper. Applied immediately after 0001 (schema DDL).
--
-- Rule 0: spec/04-data-model/indexes.md is the SOLE source of truth for indexes. Every
-- statement below is transcribed verbatim from that file with its L### cite. Do NOT invent
-- indexes, columns, or options.
--
-- EXCLUSION: the "Management plane" indexes in indexes.md (L122-125) — deployment_health_stale,
-- deployment_health_version, offboarding_client — are OUT OF SCOPE for the client silo. They
-- belong to a separate management lineage (migrations.md L50-54, ISSUE-012) and are SKIPPED here.
-- (client_registry likewise carries no index in this file.)

-- Vector (the load-bearing one)
create index concurrently memories_embedding_hnsw on memories using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);  -- indexes.md L10-12

-- Memory write-path (sole-writer idempotency + watermark — ADR-004)
create index concurrently memories_entity_ids_updated_at on memories (entity_ids, updated_at);  -- indexes.md L24

-- Queue / oldest-first / overdue (the (status, created_at) family)
create index concurrently task_queue_status_created   on task_queue (status, created_at);  -- indexes.md L34
create index concurrently task_queue_user_status      on task_queue (originating_user_id, status);  -- indexes.md L35
create index concurrently guardrail_log_status_created on guardrail_log (status, created_at);  -- indexes.md L36
create index concurrently ingestion_queue_state_created on ingestion_queue (state, created_at);  -- indexes.md L37
create index concurrently memory_conflicts_state_created on memory_conflicts (state, created_at);  -- indexes.md L38
create index concurrently consolidation_state_created  on consolidation_approvals (state, created_at);  -- indexes.md L39

-- Observability / silent-failure detector
create index concurrently event_log_type_created on event_log (event_type, created_at);  -- indexes.md L46
create index concurrently event_log_task         on event_log (task_id);  -- indexes.md L47
create index concurrently event_log_entity_ids_gin on event_log using gin (entity_ids);  -- indexes.md L56
create index concurrently memories_entity_ids_gin  on memories using gin (entity_ids);  -- indexes.md L57

-- RBAC policy-read (initPlan performance — AF-067)
create index concurrently role_permissions_role_node on role_permissions (role_id, permission_node);  -- indexes.md L63
create index concurrently role_permissions_node      on role_permissions (permission_node);  -- indexes.md L64
create unique index concurrently user_roles_user     on user_roles (user_id);  -- indexes.md L65
create index concurrently clearances_subject         on sensitivity_clearances (user_id, tier, entity_type_scope);  -- indexes.md L66
create index concurrently clearances_review          on sensitivity_clearances (last_reviewed_at);  -- indexes.md L67
create index concurrently restricted_grantee_active  on restricted_grants (grantee_user_id) where revoked_at is null;  -- indexes.md L68

-- Connectors / tokens / rate limits
create unique index concurrently rate_tracker_conn_window on rate_limit_tracker (connector, window_label);  -- indexes.md L75
create index concurrently connector_credentials_conn on connector_credentials (connector);  -- indexes.md L76
create index concurrently webhook_replay_lookup on webhook_replay_cache (connector_type, source_id, seen_at);  -- indexes.md L77

-- Versioned tables (history chains)
create index concurrently prompt_layers_agent_core on prompt_layers (agent_id, layer);  -- indexes.md L83
create index concurrently prompt_layers_prev on prompt_layers (previous_version_id);  -- indexes.md L84
create index concurrently agents_enabled on agents (enabled);  -- indexes.md L85
create index concurrently agents_prev on agents (previous_version_id);  -- indexes.md L86
create index concurrently tools_prev on tools (previous_version_id);  -- indexes.md L87
create unique index concurrently task_graph_type_ver on task_graph_versions (task_type_name, version);  -- indexes.md L88
create unique index concurrently execution_plans_type_ver on execution_plans (task_type_name, version);  -- indexes.md L89

-- Net-new stores
create index concurrently notifications_recipient_read on notifications (recipient, read_state, created_at);  -- indexes.md L95
create index concurrently notifications_role on notifications (recipient_role) where recipient is null;  -- indexes.md L96
create index concurrently config_audit_key_changed on config_audit_log (key, changed_at);  -- indexes.md L97
create unique index concurrently push_sub_user_endpoint on push_subscriptions (user_id, endpoint);  -- indexes.md L98
create index concurrently agent_result_cache_key on agent_result_cache (agent_id, memory_version);  -- indexes.md L99
create index concurrently agent_result_cache_scope_gin on agent_result_cache using gin (scope_entity_ids);  -- indexes.md L100
create index concurrently agent_result_cache_expiry on agent_result_cache (expires_at);  -- indexes.md L101
create unique index concurrently commands_slug on commands (slug);  -- indexes.md L102
create index concurrently commands_agent on commands (assigned_agent_id);  -- indexes.md L103
create index concurrently messages_conversation on messages (conversation_id, created_at);  -- indexes.md L104
create index concurrently conversations_owner on conversations (owner_user_id, updated_at);  -- indexes.md L105
create index concurrently proactive_recipient_state on proactive_suggestions (recipient_id, state);  -- indexes.md L106
create index concurrently proactive_floor on proactive_suggestions (is_floor) where state in ('generated','surfaced');  -- indexes.md L107
create index concurrently task_history_task_step on task_history (task_id, step_index);  -- indexes.md L108

-- Compliance workflow (C10)
create index concurrently connector_deletion_flags_state_raised on connector_deletion_flags (state, raised_at);  -- indexes.md L114

-- Management plane (indexes.md L122-125) — INTENTIONALLY SKIPPED (out of scope for client silo —
-- management lineage, migrations.md L50-54 / ISSUE-012): deployment_health_stale,
-- deployment_health_version, offboarding_client.
