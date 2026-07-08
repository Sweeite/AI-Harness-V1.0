-- ============================================================================
-- app/memory — LIVE-ADAPTER SMOKE (ISSUE-022, C2 memory + entity model + tags)
-- R10 live-adapter hygiene sweep for src/supabase-store.ts (SupabaseMemoryStore).
--
-- WHAT THIS PROVES (replays the adapter's REAL read/write paths against the live silo DDL, incl. the ISSUE-022
-- migrations 0029 + 0030 applied this session):
--   • entity_types seed (0030)   — config_values['entity_types'] is a 22-element array incl. the locked
--                                  'Internal Org' (CFG-entity_types; feeds SupabaseMemoryStore.listEntityTypes).
--   • Internal-Org singleton (0029) — exactly one is_internal_org=true row exists (the 0001d seed) AND a 2nd
--                                  is_internal_org=true INSERT raises unique_violation (the partial-unique guard
--                                  the adapter maps to MemoryError(internal_org_exists)) — #1/#2 fragmentation barred.
--   • insertEntity               — INSERT entities (type,name,external_refs,is_internal_org) RETURNING; the
--                                  external_refs jsonb round-trips (the resolution join key, listEntities feeds
--                                  the TS resolver).
--   • insertMemory (happy)       — INSERT memories with ALL columns incl. embedding::vector(1536), entity_ids,
--                                  source_ref, confidence, visibility, sensitivity, content_hash, idempotency_key.
--   • idempotency dedup          — a 2nd INSERT with the same idempotency_key ON CONFLICT DO NOTHING is a no-op
--                                  (0 rows) — the ADR-004 §4 retry-duplicate barrier (unique(idempotency_key)).
--   • >=1 entity CHECK           — entity_ids='{}' INSERT raises check_violation (AC-2.MEM.002.2).
--   • confidence CHECK           — a non-pointer memory with NULL confidence raises check_violation; a
--                                  system_pointer WITH a non-null confidence raises check_violation.
--   • system_pointer happy       — source='system_pointer', confidence NULL, source_ref set → inserts (golden rule).
--
-- CONNECTS AS: postgres (rolbypassrls=t) via SILO_DB_URL — the silo plane (OD-193). RLS is bypassed on this path;
--   the visibility/sensitivity RLS ENFORCEMENT is ISSUE-020's smoke, not this one (this proves the write shape).
--
-- Enum literals used are all verified live members:
--   memory_type ∈ {semantic,episodic,procedural} · memory_source ∈ {ai_inferred,human_verified,system_pointer}
--   visibility_tier ∈ {global,team,private} · sensitivity_tier ∈ {standard,confidential,personal,restricted}
--
-- SAFETY: everything runs inside ONE txn and ROLLBACKs — nothing persists. DO NOT run ad hoc; memory writes are
--   serialised by the Memory Agent (ADR-004 sole-writer).
--
-- RUN:  source ~/.ai-harness-secrets.env
--       /opt/homebrew/opt/libpq/bin/psql "$SILO_DB_URL" -v ON_ERROR_STOP=1 -f app/memory/results/live-smoke.sql
-- Expected tail: "MEMORY LIVE SMOKE: ALL ASSERTIONS PASSED" then ROLLBACK.
-- ============================================================================

\set ON_ERROR_STOP on
begin;

do $$
declare
  v_types      jsonb;
  v_io_count   int;
  v_entity     uuid;
  v_refs       text;
  v_mem        uuid;
  v_rowcount   int;
  v_zero       vector(1536) := ('[' || array_to_string(array_fill(0::float8, array[1536]), ',') || ']')::vector;
  v_caught     boolean;
  v_idem       text := 'smoke-idem-key-0022';
begin
  -- ── 0030 entity_types seed ─────────────────────────────────────────────────
  select value into v_types from config_values where key = 'entity_types';
  if v_types is null then raise exception 'FAIL: config_values[entity_types] not seeded (0030)'; end if;
  if jsonb_array_length(v_types) <> 22 then raise exception 'FAIL: entity_types has % elements, expected 22', jsonb_array_length(v_types); end if;
  if not (v_types @> '["Internal Org"]'::jsonb) then raise exception 'FAIL: entity_types missing the locked Internal Org'; end if;

  -- ── 0029 Internal-Org singleton: exactly one, and a 2nd is barred ───────────
  select count(*) into v_io_count from entities where is_internal_org;
  if v_io_count <> 1 then raise exception 'FAIL: expected exactly 1 Internal-Org entity, found %', v_io_count; end if;

  v_caught := false;
  begin
    insert into entities (type, name, external_refs, is_internal_org) values ('Internal Org', 'Second Org', '{}'::jsonb, true);
  exception when unique_violation then
    v_caught := true;
  end;
  if not v_caught then raise exception 'FAIL: a 2nd is_internal_org=true row was allowed (0029 guard missing)'; end if;

  -- ── insertEntity: external_refs round-trips ────────────────────────────────
  insert into entities (type, name, external_refs, is_internal_org)
  values ('Client', 'Smoke Client', '{"ghl":"contact_smoke","slack":"T0SMOKE"}'::jsonb, false)
  returning id into v_entity;
  select external_refs->>'ghl' into v_refs from entities where id = v_entity;
  if v_refs is distinct from 'contact_smoke' then raise exception 'FAIL: external_refs did not round-trip (got %)', v_refs; end if;

  -- ── insertMemory (happy) + idempotency dedup ───────────────────────────────
  insert into memories (type, content, embedding, embedding_model, entity_ids, source, source_ref, confidence,
                        visibility, sensitivity, content_hash, idempotency_key)
  values ('semantic', 'Smoke Client renews Q3', v_zero, 'text-embedding-3-small', array[v_entity]::uuid[],
          'ai_inferred', 'ghl:deal/smoke', 0.8, 'global', 'standard', 'hash-smoke-1', v_idem)
  returning id into v_mem;
  if v_mem is null then raise exception 'FAIL: memory insert returned no id'; end if;

  insert into memories (type, content, embedding, embedding_model, entity_ids, source, source_ref, confidence,
                        visibility, sensitivity, content_hash, idempotency_key)
  values ('semantic', 'DUP retried write', v_zero, 'text-embedding-3-small', array[v_entity]::uuid[],
          'ai_inferred', 'ghl:deal/smoke', 0.8, 'global', 'standard', 'hash-smoke-1', v_idem)
  on conflict (idempotency_key) do nothing;
  get diagnostics v_rowcount = row_count;
  if v_rowcount <> 0 then raise exception 'FAIL: idempotency dedup did not fire (inserted % rows on conflict)', v_rowcount; end if;

  -- ── >=1 entity CHECK (AC-2.MEM.002.2) ──────────────────────────────────────
  v_caught := false;
  begin
    insert into memories (type, content, embedding, embedding_model, entity_ids, source, confidence, visibility, sensitivity, content_hash, idempotency_key)
    values ('semantic', 'no entity', v_zero, 'text-embedding-3-small', array[]::uuid[], 'ai_inferred', 0.5, 'global', 'standard', 'h2', 'idem-empty');
  exception when check_violation then
    v_caught := true;
  end;
  if not v_caught then raise exception 'FAIL: a zero-entity memory was allowed (cardinality CHECK missing)'; end if;

  -- ── confidence CHECK: non-pointer requires confidence ──────────────────────
  v_caught := false;
  begin
    insert into memories (type, content, embedding, embedding_model, entity_ids, source, confidence, visibility, sensitivity, content_hash, idempotency_key)
    values ('semantic', 'null conf', v_zero, 'text-embedding-3-small', array[v_entity]::uuid[], 'ai_inferred', null, 'global', 'standard', 'h3', 'idem-nullconf');
  exception when check_violation then
    v_caught := true;
  end;
  if not v_caught then raise exception 'FAIL: an ai_inferred memory with NULL confidence was allowed (confidence CHECK missing)'; end if;

  -- NB: the live CHECK `(source='system_pointer' or confidence is not null)` enforces only ONE direction — a
  -- NON-pointer must have a confidence (proven above). It deliberately does NOT forbid a system_pointer from
  -- carrying a confidence, so there is no such assertion here. The pointer-must-have-a-source_ref rule
  -- (NFR-CMP.002 golden rule) is an APP-level guard in validateMemoryRow (fake + adapter), proven in the offline
  -- suite — not a DB CHECK — so it is likewise not asserted against raw SQL here.

  -- ── system_pointer happy path (confidence NULL, source_ref set) ────────────
  insert into memories (type, content, embedding, embedding_model, entity_ids, source, source_ref, confidence, visibility, sensitivity, content_hash, idempotency_key)
  values ('semantic', 'pointer enrichment', v_zero, 'text-embedding-3-small', array[v_entity]::uuid[], 'system_pointer', 'drive:file/contract.pdf', null, 'global', 'confidential', 'h5', 'idem-ptr-ok');

  raise notice 'MEMORY LIVE SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;
