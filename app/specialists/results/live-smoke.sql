-- ============================================================================
-- app/specialists — LIVE-ADAPTER SMOKE (ISSUE-062, C8 SPC)
-- R10 live-adapter hygiene sweep for src/supabase-store.ts (SupabaseSpecialistRegistry).
--
-- WHY THIS FILE EXISTS (the fake-passes-offline / live-diverges class R10 catches): the offline reference
-- (InMemory) proves the guard KERNEL is correct, but it classifies tools from an in-memory map. The live
-- adapter classifies from the real `tools` table via `config->>'hard_limit_class'`, and appends a new agents
-- version with real casts ($3::jsonb, $4::uuid[]). Any column/enum/cast/constraint drift between the code and
-- the 0001 baseline DDL would pass offline and throw only live — so we replay the adapter's ACTUAL statements
-- (VERBATIM shape) against the real silo DDL here.
--
-- WHAT THIS PROVES (each statement is the EXACT shape supabase-store.ts issues):
--   • (setup)  seed an auth.user + profile (created_by FK target), a Memory-specialist `agents` row
--              (name='__spc062_test__', a SPECIALIST_ROLES value — specialists.ts), and a category='write' `tools`
--              row WITHOUT a config.hard_limit_class tag (the fail-closed premise: an untagged write tool).
--   • (1) liveToolRows      — `select id::text, category::text, config->>'hard_limit_class' as klass from tools
--                             where id = any($1::uuid[])`. Proves the config->> projection + ::uuid[] cast are
--                             valid live, and that an untagged write tool projects klass=NULL (→ the live guard
--                             DENIES it, fail-closed; invisible to the offline map whose entry is populated).
--   • (2) INSERT version+1  — the append-only agents version INSERT: all 12 columns, values ($1..,$3::jsonb,
--                             $4::uuid[],..,$11,$11). Proves the real column set/casts; the new row is version+1
--                             with previous_version_id → the prior row's id.
--   • (3) version-chain backstop (append-only) — NOTE: `agents` is NOT one of the four append-only-TRIGGERED
--                             sinks (enforce_audit_append_only guards only event_log / guardrail_log /
--                             access_audit / config_audit_log — 0001 baseline L707–714). For `agents`,
--                             append-only is the ADAPTER discipline: it only ever INSERTs a new version and
--                             never UPDATEs/DELETEs a prior row, and currentByName resolves the HEAD via the
--                             "no-successor" predicate. So instead of asserting a trigger rejects an in-place
--                             UPDATE (there is none — it would silently succeed), we assert the chain SEMANTICS
--                             that make the discipline observable: after the INSERT, (a) BOTH versions are
--                             retained (the prior row is not mutated/removed — count=2) and (b) currentByName's
--                             "latest, no-successor" query resolves to the NEW version (v2), the prior row now
--                             carrying a successor. Drift in that self-join predicate would surface here.
--
-- CONNECTS AS: postgres (rolbypassrls) via SILO_DB_URL — the silo plane; proves WRITE/READ SHAPE vs the DDL.
-- SAFETY: everything runs inside ONE txn and ROLLBACKs — NO COMMIT; nothing persists (incl. the auth user).
-- RUN:  source ~/.ai-harness-secrets.env
--       /opt/homebrew/opt/libpq/bin/psql "$SILO_DB_URL" -v ON_ERROR_STOP=1 -f app/specialists/results/live-smoke.sql
-- Expected tail: "SPECIALISTS LIVE SMOKE: ALL ASSERTIONS PASS" then ROLLBACK.
-- Fixture UUIDs live in the __spc062__ namespace (prefix c8062xxx / hex-safe encoding of "C8 / ISSUE-062").
-- ============================================================================

\set ON_ERROR_STOP on
begin;

do $$
declare
  -- fixture ids (__spc062__ namespace; hex-safe: c8=stage C8, 062=issue) --------------------------------
  v_uid      uuid := gen_random_uuid();                          -- throwaway auth user / profile (created_by FK)
  v_tool     uuid := 'c8062001-0000-4000-8000-000000000001';     -- the untagged WRITE tool
  -- captured values --------------------------------------------------------------------------------------
  v_agent_v1 uuid;
  v_agent_v2 uuid;
  v_name     text;
  v_desc     text;
  v_scope    jsonb;
  v_max      int;
  v_enabled  boolean;
  v_ver1     int;
  -- liveToolRows projection round-trip
  v_tid      text;
  v_cat      text;
  v_klass    text;
  -- INSERT round-trip
  v_ver2     int;
  v_prev     uuid;
  -- version-chain backstop
  v_cur_id   uuid;
  v_cur_ver  int;
  v_count    int;
begin
  -- ── (setup) throwaway auth user + profile (created_by → profiles(id) → auth.users(id)) ───────────────
  insert into auth.users (id, aud, role, email, created_at, updated_at)
    values (v_uid, 'authenticated', 'authenticated', 'smoke-0062@example.test', now(), now());
  insert into profiles (id, email, name, active) values (v_uid, 'smoke-0062@example.test', 'Smoke 0062', true);

  -- ── (setup) a category='write' tool WITHOUT config.hard_limit_class (the fail-closed premise) ────────
  insert into tools (id, name, description, category, connector, config, change_reason)
    values (v_tool, 'smoke_untagged_write', 'ISSUE-062 live-smoke: write tool with NO hard_limit_class tag',
            'write', 'smoke_connector',
            '{"note":"untagged write tool — hard_limit_class key deliberately absent"}'::jsonb,
            'issue-062 live-smoke');

  -- ── (setup) a Memory-specialist agents row (name='__spc062_test__' — a SPECIALIST_ROLES value) at version 1 ───
  insert into agents (name, description, memory_scope, tools_allowed, max_tokens, enabled, version,
                      change_reason, created_by)
    values ('__spc062_test__', 'ISSUE-062 live-smoke Memory specialist', '{"scope_tokens":["*"]}'::jsonb,
            '{}'::uuid[], 4000, true, 1, 'issue-062 live-smoke seed', v_uid)
    returning id into v_agent_v1;
  raise notice 'seed: memory agent v1 id=%, tool id=%', v_agent_v1, v_tool;

  -- ── (1) liveToolRows — the EXACT projection/cast the adapter issues (supabase-store.ts liveToolRows) ──
  select id::text, category::text, config->>'hard_limit_class'
    into v_tid, v_cat, v_klass
    from tools where id = any (array[v_tool::text]::uuid[]);
  if v_tid is null then
    raise exception 'FAIL 1: liveToolRows projection returned no row for the seeded tool';
  end if;
  if v_cat <> 'write' then
    raise exception 'FAIL 1: category::text projection wrong (got %, expected write)', v_cat;
  end if;
  if v_klass is not null then
    raise exception 'FAIL 1: untagged write tool projected klass=% (expected NULL → live guard fail-closes)', v_klass;
  end if;
  raise notice 'PASS 1: liveToolRows projection + =any($1::uuid[]) cast valid live (category=%, klass=NULL → fail-closed)', v_cat;

  -- ── (2) the append-only agents version INSERT — VERBATIM column set/casts (setToolsAllowed) ───────────
  -- currentByName (head resolve) supplies the carried-forward columns, exactly as the adapter does.
  select a.name, a.description, a.memory_scope, a.max_tokens, a.enabled, a.version
    into v_name, v_desc, v_scope, v_max, v_enabled, v_ver1
    from agents a
   where a.name = '__spc062_test__'
     and not exists (select 1 from agents b where b.previous_version_id = a.id)
   order by a.version desc
   limit 1;

  insert into agents (name, description, memory_scope, tools_allowed, max_tokens, enabled, version,
                      previous_version_id, change_reason, created_by, created_at, updated_at)
    values (v_name, v_desc, v_scope::jsonb, array[v_tool::text]::uuid[], v_max, v_enabled, v_ver1 + 1,
            v_agent_v1, 'grant tool (live-smoke)', v_uid, now(), now())
    returning id, version, previous_version_id into v_agent_v2, v_ver2, v_prev;
  -- NB: tools_allowed is uuid[] with NO referential FK, so the value only exercises the $4::uuid[] cast here;
  -- the guard that would DENY an untagged write grant is the offline kernel's job (this is the DDL-shape replay).
  if v_ver2 <> v_ver1 + 1 then
    raise exception 'FAIL 2: new version is % (expected % = prior+1)', v_ver2, v_ver1 + 1;
  end if;
  if v_prev is distinct from v_agent_v1 then
    raise exception 'FAIL 2: previous_version_id is % (expected %)', v_prev, v_agent_v1;
  end if;
  raise notice 'PASS 2: append-only INSERT ok (version %→%, previous_version_id set → %)', v_ver1, v_ver2, v_prev;

  -- ── (3) version-chain backstop — append-only DISCIPLINE observable (no trigger on agents; see header) ─
  -- (3a) prior row retained (never mutated/deleted): both versions still present.
  select count(*) into v_count from agents where name = '__spc062_test__';
  if v_count <> 2 then
    raise exception 'FAIL 3a: expected 2 retained agents versions, found % (prior row not append-only-preserved)', v_count;
  end if;
  -- (3b) currentByName's "latest, no-successor" query now resolves to the NEW version; the prior row carries a successor.
  select a.id, a.version into v_cur_id, v_cur_ver
    from agents a
   where a.name = '__spc062_test__'
     and not exists (select 1 from agents b where b.previous_version_id = a.id)
   order by a.version desc
   limit 1;
  if v_cur_id <> v_agent_v2 or v_cur_ver <> v_ver2 then
    raise exception 'FAIL 3b: head resolved to (id=%, v=%), expected the new version (id=%, v=%)',
      v_cur_id, v_cur_ver, v_agent_v2, v_ver2;
  end if;
  raise notice 'PASS 3: version chain intact — both versions retained, head resolves to v% (prior row superseded, not mutated)', v_cur_ver;

  raise notice 'SPECIALISTS LIVE SMOKE: ALL ASSERTIONS PASS';
end $$;

rollback;
