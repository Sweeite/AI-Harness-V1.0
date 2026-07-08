-- Client-silo migration 0035 — connector_disconnection_state open-disconnection partial-unique guard (ISSUE-038)
--
-- ⚠️ AUTHORED, NOT YET APPLIED (offline overnight build, Session 79). Companion to 0034 (apply 0034 first).
-- APPLY LIVE (operator-present, morning): the migrate runner against $SILO_DB_URL after 0034.
--
-- WHAT it guarantees: at most ONE open disconnection row per (connector, scope, affected_user). Re-detecting an
-- already-open outage must be idempotent (a no-op update of the existing row), never a SECOND open row -- a second
-- open row would split the paused-task set across two records and let one escalation clock be missed (#1/#3). The
-- store enforces this in code too (lookup-then-insert), but the DB index makes it a hard guarantee under a race.
--
-- WHY a partial unique index: uniqueness is wanted ONLY among status='open' rows -- a connector may have many
-- historical resolved/escalated rows for the same tuple. coalesce(affected_user_id, all-zero-uuid) folds every
-- system_wide row (null user) into one group so two concurrent system_wide detections collide as intended.
--
-- transactional:false -- CREATE INDEX CONCURRENTLY cannot run inside a txn block. IF NOT EXISTS makes it idempotent
-- and resumable. Comments stay semicolon-free (the non-transactional runner splits on the semicolon -- 0007/0011 trap).

create unique index concurrently if not exists connector_disconnection_open_uniq
  on connector_disconnection_state (connector, scope, coalesce(affected_user_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'open';
