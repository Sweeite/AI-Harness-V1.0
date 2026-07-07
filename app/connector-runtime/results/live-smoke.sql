-- ══════════════════════════════════════════════════════════════════════════════
-- live-smoke.sql — LIVE-ADAPTER HYGIENE SWEEP (R10) for app/connector-runtime
--   Target: src/supabase-store.ts  (SupabaseConnectorRuntimeStore)
--   Plane : CLIENT SILO  (public schema on SILO_DB_URL)
--   Role  : connects as `postgres` (rolbypassrls=t) — NOT service_role, despite the
--           code/DDL comments (OD-193). RLS is bypassed on this path; grants intact.
--
-- WHAT THIS PROVES / DISPROVES (run serially by the orchestrator; NOTHING persists):
--   (A) registerTool INSERT column list + tool_category enum literal land against the
--       real 0007 DDL (all 9 supplied cols + defaults for id/enabled/version/timestamps).
--   (B) editTool's real write path (INSERT v2 linking head + UPDATE head enabled=false)
--       lands, and the version-discipline trigger permits the enabled flip.
--   (C) ★ M6 (CONFIRMED here as a data-integrity gap) ★ — `tools` has ONLY tools_pkey(id)
--       + a NON-UNIQUE index tools_prev(previous_version_id); NO unique(previous_version_id)
--       and NO unique(root,version). editTool resolves the head with a plain SELECT (no
--       FOR UPDATE) under READ COMMITTED, so two concurrent edits both read the same head,
--       both INSERT a v2 pointing at it, both flip it disabled → TWO enabled v2 rows of one
--       logical tool are offered to AI selection (violates single-current-version
--       FR-3.REG.001). This script replays that end-state SEQUENTIALLY (two v2 inserts off
--       the same predecessor) and asserts the DB ACCEPTS it — i.e. nothing at the DB layer
--       stops the double-head. It then shows a unique(previous_version_id) index WOULD.
--   (D) commitIntent ON CONFLICT (idempotency_key) DO NOTHING dedups atomically; a repeat
--       key yields rowCount=0 (→ 'suppressed').
--   (E) recordResult fills result once (WHERE result IS NULL); a second fill affects 0 rows
--       (adapter then raises — #1 write-once). The immutability trigger also blocks a rewrite.
--
--   NOTE: connector_credentials / rate_limit_tracker are SHELL-only reads for this adapter
--   (getCredential is SELECT-only) — no write path to smoke there.
-- ══════════════════════════════════════════════════════════════════════════════

begin;

-- ── (A) registerTool: the real INSERT (9 cols; id/enabled/version/timestamps defaulted) ──
insert into tools (name, description, category, risk_level, requires_approval, connector, scopes, config, change_reason)
values ('smoke_send_email', 'Send an email via the connector', 'write', 'medium', true, 'ghl', array['email.send'], '{"limit":5}'::jsonb, 'initial registration')
returning id, version, enabled \gset v1_

do $$
declare v1 record;
begin
  select * into v1 from tools where change_reason = 'initial registration' and name = 'smoke_send_email';
  if v1.version <> 1 then raise exception 'A FAIL: register version expected 1, got %', v1.version; end if;
  if v1.enabled is not true then raise exception 'A FAIL: register enabled expected true'; end if;
  if v1.previous_version_id is not null then raise exception 'A FAIL: v1 previous_version_id should be null'; end if;
  if v1.category <> 'write'::tool_category then raise exception 'A FAIL: category enum mismatch'; end if;
end $$;

-- ── (B) editTool WRITE PATH (as issued by the adapter): INSERT v2 linking head, then flip head ──
insert into tools (name, description, category, risk_level, requires_approval, connector, scopes, config, enabled, version, previous_version_id, change_reason)
select 'smoke_send_email', 'Send an email (v2)', 'write', 'medium', true, 'ghl', array['email.send'], '{"limit":10}'::jsonb,
       h.enabled, h.version + 1, h.id, 'edit: raise limit'
from tools h where h.name = 'smoke_send_email' and h.version = 1;

update tools set enabled = false, updated_at = now()
where id = (select id from tools where name = 'smoke_send_email' and version = 1);

do $$
declare enabled_heads int;
begin
  select count(*) into enabled_heads from tools where name = 'smoke_send_email' and enabled = true;
  if enabled_heads <> 1 then raise exception 'B FAIL: after one edit exactly one enabled head expected, got %', enabled_heads; end if;
end $$;

-- ── (C) ★ M6 ★ — replay the CONCURRENT-EDIT END STATE sequentially: a SECOND edit that also
--        reads v1 as its head (the lost-update window: both txns saw v1 before either flip).
--        No FOR UPDATE + no unique(previous_version_id) ⇒ the DB ACCEPTS a second v2 off v1.
insert into tools (name, description, category, risk_level, requires_approval, connector, scopes, config, enabled, version, previous_version_id, change_reason)
select 'smoke_send_email', 'Send an email (v2-racing)', 'write', 'medium', true, 'ghl', array['email.send'], '{"limit":20}'::jsonb,
       true, 2, (select id from tools where name='smoke_send_email' and version=1), 'edit: racing limit'
;  -- succeeds today → the bug. (This INSERT would need to FAIL for the invariant to hold.)

do $$
declare dup_heads int; dup_prev int;
begin
  -- Two version-2 rows now share the SAME previous_version_id AND are both enabled → double head.
  select count(*) into dup_heads
    from tools where name = 'smoke_send_email' and version = 2 and enabled = true;
  if dup_heads < 2 then
    raise exception 'C: EXPECTED the double-head to be reproducible (>=2 enabled v2), got % — did a new unique constraint land? Re-verify M6.', dup_heads;
  end if;
  raise notice 'C CONFIRMED (M6): % enabled version-2 heads share one predecessor — AI selection sees both (FR-3.REG.001 violated). No unique(previous_version_id) at the DB layer stops this.', dup_heads;

  -- Demonstrate the fix would bite: a unique index on previous_version_id would reject the 2nd v2.
  select count(*) into dup_prev from (
    select previous_version_id from tools where name='smoke_send_email' and previous_version_id is not null
    group by previous_version_id having count(*) > 1
  ) x;
  if dup_prev < 1 then raise exception 'C FAIL: expected a duplicated previous_version_id to exist'; end if;
  raise notice 'C FIX-CHECK: unique(previous_version_id) WOULD have rejected the 2nd edit (found % duplicated predecessor).', dup_prev;
end $$;

-- ── (D) commitIntent: ON CONFLICT (idempotency_key) DO NOTHING atomically dedups ──
insert into idempotency_ledger (idempotency_key, connector) values ('smoke:intent:1', 'ghl')
  on conflict (idempotency_key) do nothing;              -- fresh: 1 row
do $$
declare n int;
begin
  with ins as (
    insert into idempotency_ledger (idempotency_key, connector) values ('smoke:intent:1', 'ghl')
      on conflict (idempotency_key) do nothing returning 1
  ) select count(*) into n from ins;
  if n <> 0 then raise exception 'D FAIL: duplicate intent key should insert 0 rows (suppressed), got %', n; end if;
end $$;

-- ── (E) recordResult: fill-once WHERE result IS NULL; 2nd fill affects 0 rows ──
do $$
declare n1 int; n2 int;
begin
  with u1 as (
    update idempotency_ledger set result = '{"ok":true}'::jsonb
      where idempotency_key = 'smoke:intent:1' and result is null returning 1
  ) select count(*) into n1 from u1;
  if n1 <> 1 then raise exception 'E FAIL: first result fill should affect 1 row, got %', n1; end if;

  with u2 as (
    update idempotency_ledger set result = '{"ok":false}'::jsonb
      where idempotency_key = 'smoke:intent:1' and result is null returning 1
  ) select count(*) into n2 from u2;
  if n2 <> 0 then raise exception 'E FAIL: second result fill must affect 0 rows (write-once), got %', n2; end if;
  raise notice 'E CONFIRMED: recordResult is write-once (1 then 0 rows).';
end $$;

-- (E') the immutability trigger also blocks a forced rewrite of a recorded result.
do $$
begin
  update idempotency_ledger set result = '{"ok":false}'::jsonb where idempotency_key = 'smoke:intent:1';
  raise exception 'E2 FAIL: rewriting a recorded result should have been blocked by t_idempotency_ledger_immutable';
exception when others then
  if sqlerrm like '%write-once%' then
    raise notice 'E2 CONFIRMED: immutability trigger blocked the result rewrite.';
  else
    raise; -- unexpected error
  end if;
end $$;

rollback;
