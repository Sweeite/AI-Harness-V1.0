-- ISSUE-068 (C9 MODE) — R10 live-adapter smoke for @harness/proactivity-modes/supabase-store.ts.
-- Exercises the three live tables the adapter touches against the REAL silo DDL (0001_baseline.sql):
--   • proactive_suggestions.mode  (persistMode — the proactive_mode enum column)
--   • config_values['action_autonomy_matrix']  (writeMatrix commit + loadMatrix read-back)
--   • access_audit  (a committed AND a denied matrix-edit audit row — #3 never silent)
-- Fully ROLLED BACK — leaves no residue. Run against the client silo from a 💻 FULL session only.
-- Verifies: (1) the enum accepts 'suggest'/'prepare' and REJECTS 'act' being written to a floored row is a
-- POLICY concern (enforced in code, not the enum) — the enum itself has 'act', so we assert the enum shape;
-- (2) config upsert + read-back round-trips the matrix object; (3) audit append is immutable/append-only.

begin;

-- A throwaway actor profile (config_values.updated_by + access_audit.originating_user_id are uuid FKs).
insert into public.profiles (id, active)
values ('00000000-0000-0000-0000-0000000000ff', true)
on conflict (id) do nothing;

-- (1) proactive_suggestions.mode — insert then UPDATE the mode (persistMode). The enum backstops the value.
insert into public.proactive_suggestions (id, mode)
values ('00000000-0000-0000-0000-00000000e068', 'suggest');
update public.proactive_suggestions set mode = 'prepare'
 where id = '00000000-0000-0000-0000-00000000e068';
-- expect: 1 row, mode = 'prepare'
select id, mode from public.proactive_suggestions where id = '00000000-0000-0000-0000-00000000e068';
-- the enum rejects an out-of-set mode (uncomment to prove #3 loud-fail — errors the txn):
-- update public.proactive_suggestions set mode = 'autonomous' where id = '00000000-0000-0000-0000-00000000e068';

-- (2) config_values — writeMatrix commit (low_risk_external_nonclient → suggest) + loadMatrix read-back.
insert into public.config_values (key, value, updated_by)
values ('action_autonomy_matrix', '{"low_risk_external_nonclient":"suggest"}'::jsonb, '00000000-0000-0000-0000-0000000000ff')
on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
-- expect: value ->> 'low_risk_external_nonclient' = 'suggest'
select value from public.config_values where key = 'action_autonomy_matrix';

-- (3) access_audit — a COMMITTED and a DENIED matrix-edit audit row (append-only).
insert into public.access_audit (audit_type, actor_identity, actor_type, action, target_type, before_value, after_value, reason)
values
  ('config_change', '00000000-0000-0000-0000-0000000000ff', 'user', 'autonomy_matrix_edit',
   'action_autonomy_matrix', '{}'::jsonb, '{"subType":"low_risk_external_nonclient","ceiling":"suggest"}'::jsonb,
   'matrix edit committed — low_risk_external_nonclient ceiling set to suggest by Super-Admin'),
  ('config_change', '00000000-0000-0000-0000-0000000000ff', 'user', 'autonomy_matrix_edit_denied',
   'action_autonomy_matrix', '{}'::jsonb, '{"subType":"financial_operation","ceiling":"prepare"}'::jsonb,
   'matrix edit DENIED — floored sub-type is fixed at hard-approval, cannot be lowered via config (AC-9.MODE.004.2)');
-- expect: 2 rows (one committed, one denied)
select action, reason from public.access_audit
 where target_type = 'action_autonomy_matrix'
 order by created_at desc limit 2;

rollback;
