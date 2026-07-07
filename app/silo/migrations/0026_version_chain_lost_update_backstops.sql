-- Migration 0026 — version-chain lost-update + genesis-fork backstops (session-73 Part-B sweep). Additive.
--
-- The session-73 live-adapter sweep found the same lost-update race the agents table had (fixed by 0025)
-- across two more version-disciplined tables, because neither carries a unique constraint on its chain:
--   * prompt_layers -- appendVersion (prompt-store M5), appendContentVersion (prompt-layer-context), and
--     appendCoreVersion (prompt-layer-identity) all read max(version) then INSERT version+1 under READ
--     COMMITTED with no FOR UPDATE -- two concurrent edits fork the chain and one operator edit is silently
--     dropped (#1). AND createLayer/createCore INSERT a v1 (previous_version_id null) with no guard, so a
--     second v1 for the same (layer,name,agent_id) forks the chain at genesis (the fake rejects this in code
--     store.ts, the live adapter had no backstop).
--   * tools -- editTool (connector-runtime M6) resolves the head via a plain SELECT and INSERTs version+1
--     with no lock, and tools has only a NON-unique tools_prev index -- concurrent edits leave TWO enabled
--     current versions offered to AI selection (#2, violates single-current-version FR-3.REG.001).
--
-- Live pre-checked (session 73): zero existing chain branches on tools/prompt_layers and zero duplicate
-- roots on prompt_layers, so every legitimate row satisfies these uniques today. A linear append-only
-- lineage has exactly one child per version and one v1 per asset, so the racing loser fails LOUD
-- (unique_violation) instead of silently forking -- converts a #1/#2 into a recoverable #3. Same proven
-- pattern as 0025 (agents_prev_unique).
--
-- transactional:false -- CREATE INDEX CONCURRENTLY cannot run inside a txn block. IF NOT EXISTS makes each
-- idempotent + resumable. Comments stay semicolon-free (the non-transactional runner splits on the semicolon).

-- prompt_layers edit-chain: at most one child per predecessor version.
create unique index concurrently if not exists prompt_layers_prev_unique
  on prompt_layers (previous_version_id)
  where previous_version_id is not null;

-- prompt_layers genesis: at most one v1 (root) per asset identity (layer, name, agent_id). agent_id is
-- nullable, so coalesce a sentinel uuid to make NULL a single class (a plain btree would treat each NULL
-- as distinct and let duplicate non-agent-scoped roots through).
create unique index concurrently if not exists prompt_layers_root_unique
  on prompt_layers (layer, name, coalesce(agent_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where previous_version_id is null;

-- tools edit-chain: at most one child per predecessor version (single live head per tool lineage).
create unique index concurrently if not exists tools_prev_unique
  on tools (previous_version_id)
  where previous_version_id is not null;
