-- Migration 0013 — task_graph_versions append-only-by-version (ISSUE-049). Additive. #1 knowledge integrity.
--
-- The task_graph_versions table already exists (0001_baseline.sql L419-429) with change_reason NOT NULL +
-- unique(task_type_name, version), and carries the 0002 default_deny RLS floor. But nothing yet stops an
-- in-place UPDATE/DELETE of a PRIOR version row. Change-control (standards/change-control.md) + FR-5.GRP.002
-- require prior versions to be retained and never overwritten: a graph EDIT inserts a NEW version row
-- (version = prior+1, previous_version_id = prior.id); prior rows are immutable. This is the DB backstop to
-- the app-layer gate (app/task-graphs SupabaseGraphStore.putVersion) -- so even a rogue path fails LOUD (#1).
-- Mirrors 0004_prompt_version_discipline (prompt_layers) and the audit-sink immutability idiom.
--
-- transactional:true -- do NOT add BEGIN/COMMIT. Re-runnable (create or replace + drop-if-exists).

-- search_path pinned to '' so a same-named object cannot shadow references. Fires regardless of role (incl.
-- service_role) -- the append-only guarantee cannot be bypassed by the RLS-exempt writer.
create or replace function public.task_graph_versions_block_mutation() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  raise exception
    'task_graph_versions is append-only by version: % on an existing version is forbidden -- insert a NEW version instead (FR-5.GRP.002 / change-control)', tg_op;
end $$;

create or replace trigger trg_task_graph_versions_no_update
  before update or delete on task_graph_versions
  for each row execute function public.task_graph_versions_block_mutation();

-- Belt to the trigger suspenders: no normal role may UPDATE/DELETE prior versions. (service_role bypasses
-- grants, so the trigger -- not the REVOKE -- is the real correctness boundary; matches the task_queue posture.)
revoke update, delete on task_graph_versions from anon, authenticated;
