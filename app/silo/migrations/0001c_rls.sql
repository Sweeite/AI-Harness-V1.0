-- Client-silo baseline migration 0001c — RLS substrate (ISSUE-008)
--
-- SCOPE (Rule 0 + the 008/009 boundary): this migration does exactly ONE thing — it turns ON
-- row-level security and REVOKEs the baseline grants for EVERY silo table, locking in
-- **default-deny** (RLS enabled + no policy = deny to every non-`service_role` caller). This is the
-- load-bearing #2 safety property of the baseline: after 0001, no silo table is readable on the human
-- path until an explicit policy opens it, and — critically — **no table is ever left RLS-disabled**
-- (an RLS-disabled table is a silent authorization bypass, #2). Enabling RLS on all 44 tables here,
-- in the baseline, is what guarantees that.
--
-- OWNED BY ISSUE-009 (its title: "RLS scaffold — helpers, default-deny, 100% coverage CI gate"),
-- NOT here: the five SECURITY DEFINER helper bodies (user_perms / user_visibility / user_clearances /
-- user_restricted / user_aal — rls-policies.md L26-40; bodies are deferred build artifacts per L111),
-- the per-table policies (rls-policies.md L48-85 summary), and the 100%-coverage CI gate that PROVES
-- every table has a correct policy. ISSUE-008 §8 step-5 fixes this split: "This baseline creates the
-- tables/types/RLS-enable + default-deny the predicates attach to; the policy logic + 100%-coverage CI
-- gate are owned by ISSUE-009." Authoring policies here (before that coverage gate exists) risks
-- shipping a wrong-permissive policy in the GATE migration — a #2 hole. Default-deny is fail-closed;
-- ISSUE-009 opens the correct reads under a coverage gate that proves completeness.
--
-- The agent / background path runs as `service_role`, which BYPASSES RLS by design (ADR-006 /
-- rls-policies.md L11-14) — containment on that path is the harness RBAC + per-agent memory_scope
-- filter, not RLS. The first-boot seed (0001d) therefore runs unhindered as the migration role.
--
-- The runner wraps this file in a transaction — do NOT add BEGIN/COMMIT.
-- Management-plane tables (client_registry/deployment_health/offboarding_records) are a separate
-- lineage (ISSUE-012) and are never in a client silo — not touched here.

-- ── Enable RLS + default-deny on every silo table ──────────────────────────
-- One block per table: enable RLS, then REVOKE the baseline grants from the Supabase client roles
-- (anon, authenticated) so access is default-deny even independent of RLS policy state
-- (rls-policies.md L20: "Baseline REVOKE ALL; every readable table needs an explicit policy").
-- `if exists` keeps this re-runnable (migrations.md hard constraint) even if run against a partial apply.

do $$
declare
  t text;
  silo_tables text[] := array[
    'profiles','support_requests','webhook_secrets','webhook_replay_cache',
    'roles','role_permissions','user_roles','sensitivity_clearances',
    'entities','restricted_grants','access_audit','memories',
    'ingestion_queue','memory_conflicts','consolidation_approvals',
    'tools','connector_credentials','rate_limit_tracker','idempotency_ledger',
    'agents','prompt_layers','dynamic_field_values',
    'task_queue','task_graph_versions','task_history','execution_plans',
    'guardrail_log','injection_quarantine',
    'event_log','notifications','config_audit_log','push_subscriptions',
    'agent_health_metrics','agent_result_cache',
    'proactive_suggestions','commands','signal_weights',
    'conversations','messages',
    'config_values','secret_manifest',
    'deletion_requests','connector_deletion_flags','deployment_settings'
  ];
begin
  foreach t in array silo_tables loop
    -- fail loud if a listed table is missing — a silent skip would leave a table RLS-disabled (#2/#3).
    if to_regclass('public.' || t) is null then
      raise exception 'RLS substrate: expected silo table public.% not found (0001 baseline drift)', t;
    end if;
    execute format('alter table public.%I enable row level security;', t);
    execute format('revoke all on public.%I from anon, authenticated;', t);
  end loop;
end $$;

-- ── Belt-and-braces: revoke DELETE on the four append-only sinks (schema.md L68) ──
-- The enforce_audit_append_only trigger already forbids DELETE regardless of role (the primary #1
-- guarantee). This is the redundant grant-layer defense schema.md L68 prescribes so a DELETE "can never
-- even reach the trigger". Retention pruning is a separate privileged (owner) job — not an app/service
-- DELETE — so revoking from anon/authenticated/service_role removes no legitimate path (#1).
revoke delete on event_log, guardrail_log, access_audit, config_audit_log from anon, authenticated, service_role;

-- Coverage assertion (belt-and-suspenders #2 / #3): every base table in `public` must have RLS enabled.
-- If any silo table is RLS-disabled after this migration, fail the migration LOUDLY rather than ship a
-- silent bypass. (ISSUE-009 adds the CI-level 100%-coverage gate on POLICIES; this is the schema-level
-- gate on RLS being ENABLED.)
do $$
declare
  bad text;
begin
  select string_agg(c.relname, ', ')
    into bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relrowsecurity = false;
  if bad is not null then
    raise exception 'RLS substrate incomplete — these public tables have RLS DISABLED (silent-bypass risk, #2): %', bad;
  end if;
end $$;
