-- Migration 0019 — connector_trigger_state: dedicated MUTABLE operational tables for the C3 trigger layer
-- (ISSUE-037 / OD-190). Additive, net-new tables only — NO change to `tools`, its 0008 version-discipline
-- trigger, or any existing table.
--
-- WHY (OD-190, operator-decided session 71): the trigger layer stored ALL runtime state (default-set enable
-- flags, no-code rules, watch/subscription liveness, per-channel reconciliation watermarks, the delivery
-- sample, and the seen-event dedup ledger) inside `tools.config` jsonb and mutated it IN PLACE. But `tools`
-- is version-locked by the 0008 enforce_tool_version_discipline trigger (only enabled/updated_at may flip in
-- place), so EVERY trigger write RAISES live -- a live-confirmed BLOCKER. High-churn operational state
-- (advancing watermarks, a growing dedup ledger) cannot live in a version-disciplined audit column. OD-190
-- re-homes that runtime state here, preserving the `tools` append-only-by-version audit invariant intact.
-- Rejected alternatives: exempting the carrier row from 0008 (carves a hole in the tools audit -- #1); leaving
-- it in tools.config (non-functional live).
--
-- ISOLATION: net-new, intra-silo, NO client_slug -- physical silo isolation is the boundary (ADR-001),
-- mirroring the other C3 tables (rate_limit_tracker / idempotency_ledger / rate_limit_deferred). The trigger
-- runtime reads/writes these as service_role, which bypasses RLS by design (ADR-006); the 0002 default_deny
-- PERMISSIVE-false floor + a belt-and-braces REVOKE keeps every table covered (rls coverage lint) and closed
-- to the normal roles.
--
-- transactional:true -- do NOT add BEGIN/COMMIT. Re-runnable (IF NOT EXISTS + pg_policies guard).

-- ── connector_triggers — the per-connector default set + no-code rules (admin-edited, low-churn) ──────────
-- kind='default': a shipped default trigger for an event (availableFields = the contract a rule validates
--   against at save); enabled flips per deployment (FR-3.TRIG.003). conditions/task_name are null.
-- kind='rule':    a user-authored no-code rule (FR-3.TRIG.002): event + conditions (jsonb) -> task_name.
create table if not exists connector_triggers (
  id               uuid primary key default gen_random_uuid(),
  connector        text not null,
  kind             text not null,                                -- 'default' | 'rule'
  event_name       text not null,
  available_fields text[] not null default '{}',                 -- default-trigger contract (kind='default')
  conditions       jsonb not null default '[]',                  -- rule condition clauses (kind='rule')
  task_name        text,                                         -- the task a matched rule launches (kind='rule')
  enabled          boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (kind in ('default', 'rule')),
  check (kind <> 'rule' or task_name is not null)                -- a rule MUST name a task
);
-- A 'default' is unique per (connector,event_name) -- enforced by the PARTIAL unique index (kind='default')
-- connector_triggers_default_uq, built CONCURRENTLY in 0020_connector_trigger_indexes.sql (a CONCURRENTLY /
-- partial index build cannot run inside this transactional migration -- migration-discipline.md L39). That
-- index is the ON CONFLICT arbiter for the setDefaultTriggerEnabled upsert. RULES are deliberately NOT unique
-- per event: multiple overlapping rules on one event are permitted (all matching rules fire, config.ts), so
-- each rule is its own row keyed by id and updated per-id.

-- ── connector_watches — expiring push-subscription / watch liveness (re-armed; FR-3.TRIG.005) ────────────
-- STABLE identity is (connector, kind) -- channel_id/resource_id change on every re-arm (a re-arm mints a
-- fresh channel), so keying on channel_id would leak a row per re-arm and orphan the old expiry (#1). One
-- watch row per (connector, kind) family; upsert-on-rearm keeps a single live row.
create table if not exists connector_watches (
  connector    text not null,
  kind         text not null,                                    -- gmail | drive_files | drive_changes | calendar
  channel_id   text not null,
  resource_id  text not null,
  expires_at   bigint not null,                                  -- epoch seconds the watch lapses
  degraded     boolean not null default false,                   -- true once a re-arm failed/lapsed (AC.005.2)
  updated_at   timestamptz not null default now(),
  primary key (connector, kind)
);

-- ── event_watermarks — per-channel reconciliation watermarks (high-churn; FR-3.TRIG.006) ─────────────────
-- The last successfully-ingested position per channel (Slack `ts` / Gmail `historyId`), an opaque string.
-- Advances on every sweep -- high-churn, which is precisely why it cannot live in the version-locked config.
create table if not exists event_watermarks (
  connector   text not null,
  channel     text not null,                                     -- slack channel id / gmail 'default'
  position    text not null,                                     -- opaque last-good position
  updated_at  bigint not null,                                   -- caller-supplied logical now (epoch seconds)
  primary key (connector, channel)
);

-- ── connector_delivery_health — per-connector rolling delivery sample (FR-3.TRIG.006 Slack 2xx monitor) ───
create table if not exists connector_delivery_health (
  connector     text primary key,
  success_rate  numeric not null,                                -- rolling 2xx rate in [0,1]
  updated_at    bigint not null,                                 -- caller-supplied logical now (epoch seconds)
  check (success_rate >= 0 and success_rate <= 1)
);

-- ── event_dedup_ledger — seen event ids (dedup, idempotent receive; FR-3.TRIG.004) ───────────────────────
-- Defence-in-depth over C0's replay drop: a re-delivered (connector,event_id) fires nothing twice. recordEvent
-- is `insert ... on conflict do nothing` -- idempotent, and the insert's rowCount tells new-vs-duplicate.
create table if not exists event_dedup_ledger (
  connector   text not null,
  event_id    text not null,                                     -- connector delivery id (deliveryId/event_id/messageId)
  seen_at     bigint not null,                                   -- caller-supplied logical now (epoch seconds)
  primary key (connector, event_id)
);

-- ── RLS floor (mirror 0012 / the 0002 scaffold: every net-new table carries the default_deny PERMISSIVE-false
--    policy so the rls coverage lint is satisfied; these are written/read by the trigger runtime as
--    service_role, which bypasses RLS by design -- ADR-006). Belt-and-braces REVOKE for the normal roles. ──

alter table connector_triggers enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'connector_triggers' and policyname = 'default_deny'
  ) then
    execute 'create policy default_deny on public.connector_triggers as permissive for all to authenticated using (false) with check (false);';
  end if;
end $$;
revoke all on connector_triggers from anon, authenticated;

alter table connector_watches enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'connector_watches' and policyname = 'default_deny'
  ) then
    execute 'create policy default_deny on public.connector_watches as permissive for all to authenticated using (false) with check (false);';
  end if;
end $$;
revoke all on connector_watches from anon, authenticated;

alter table event_watermarks enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'event_watermarks' and policyname = 'default_deny'
  ) then
    execute 'create policy default_deny on public.event_watermarks as permissive for all to authenticated using (false) with check (false);';
  end if;
end $$;
revoke all on event_watermarks from anon, authenticated;

alter table connector_delivery_health enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'connector_delivery_health' and policyname = 'default_deny'
  ) then
    execute 'create policy default_deny on public.connector_delivery_health as permissive for all to authenticated using (false) with check (false);';
  end if;
end $$;
revoke all on connector_delivery_health from anon, authenticated;

alter table event_dedup_ledger enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'event_dedup_ledger' and policyname = 'default_deny'
  ) then
    execute 'create policy default_deny on public.event_dedup_ledger as permissive for all to authenticated using (false) with check (false);';
  end if;
end $$;
revoke all on event_dedup_ledger from anon, authenticated;

-- The connector_triggers by-connector lookup index (connector_triggers_connector_idx) is built CONCURRENTLY
-- in 0020_connector_trigger_indexes.sql (a CONCURRENTLY build cannot run inside this transactional migration
-- -- migration-discipline.md L39).
