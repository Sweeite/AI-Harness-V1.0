-- Migration 0020 -- connector trigger-state indexes (built CONCURRENTLY). Additive (ISSUE-037 / OD-190)
--
-- The supporting indexes for the 0019 connector_trigger_state tables. Built CONCURRENTLY so a deploy never
-- locks the table (migration-discipline.md L39 / AC-NFR-INF.002.1) -- which is why they live here, not inline
-- in 0019: CREATE INDEX CONCURRENTLY (and a partial unique index) cannot run inside a transaction block.
--
-- transactional:false -- the runner applies with autocommit (no BEGIN/COMMIT), required for CONCURRENTLY. Each
-- build is idempotent (IF NOT EXISTS) and the migration resumable (mirror 0017 / 0001b_indexes). NOTE the
-- non-transactional runner splits on the statement terminator, so NO comment in this file may contain one --
-- a comment terminator would fragment a statement into a syntax error (the 0007/0011 live lesson)

-- The default-trigger uniqueness arbiter: one 'default' row per (connector,event_name). Partial (kind='default')
-- so RULES stay non-unique per event (overlapping rules all fire). This is the ON CONFLICT target for the
-- setDefaultTriggerEnabled upsert in supabase-store.ts
create unique index concurrently if not exists connector_triggers_default_uq
  on connector_triggers (connector, event_name) where kind = 'default';

-- The by-connector lookup: getDefaultTriggers / getRules scan connector_triggers by connector
create index concurrently if not exists connector_triggers_connector_idx
  on connector_triggers (connector);
