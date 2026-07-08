-- Client-silo migration 0033 — push_subscriptions: owner-scoped RLS (ISSUE-079, surface-12 FR-7.VIEW.003)
--
-- GAP (found by the ISSUE-079 adversarial verify, session 77): `push_subscriptions` has RLS ENABLED +
-- REVOKE ALL from `authenticated` (0001c default-deny) but NO policy — so it is default-deny with no way
-- in: the authenticated mobile client cannot register or read its OWN device push subscription, i.e.
-- `registerPush` / the "push enabled" read are dead on the human path. A user must be able to manage ONLY
-- their own device subscriptions (#2) and read only their own state. Every other opened table pairs
-- GRANT+POLICY (0003/0004/0022/0031/0032); push_subscriptions was the gap for this surface.
--
-- THE BINDING (owner-scoped, #2-careful):
--   • GRANT select/insert/update/delete to `authenticated` — the privilege the policy then filters by row.
--   • POLICY `push_subscriptions_owner_all` — USING + WITH CHECK both pin `user_id = auth.uid()`, so a user
--     sees and writes ONLY their own subscriptions; the `(select auth.uid())` wrap is the AF-067 InitPlan
--     discipline (evaluate once per statement, not per row). `for all` = the CRUD a device needs (register,
--     refresh token, read enabled-state, unregister).
--   • aal2 baseline (`(select public.user_aal()) = 'aal2'`, FR-1.RLS.005 / AC-1.RLS.005.1) on BOTH USING and
--     WITH CHECK — the universal-aal2 rule the 0031 retrofit enforces on EVERY authenticated human-path policy
--     (only support_requests pre-auth intake is exempt). The src/rls-lint.ts aal2-coverage lint CAUGHT the
--     first draft of this migration omitting it — device push tokens are user data, reachable only after
--     step-up, never at aal1 (a #2/#3 step-up bypass otherwise).
--
-- SCOPE NOTE (Rule 0): the SAME default-deny-no-policy gap exists on the other stores this surface READS
-- (task_queue, notifications, event_log, conversations, messages, proactive_suggestions, guardrail_log).
-- Those human-path read policies are owed to their PRODUCER issues (C5/C6/C7/C9 — ISSUE-075/076/056/etc.),
-- NOT to ISSUE-079 — see OD-198 (Stage-5 batch-close forks). Only push_subscriptions is this issue's to add.
--
-- Additive / expand-safe (grant + one new policy on an already-RLS-enabled table). transactional:true.

grant select, insert, update, delete on public.push_subscriptions to authenticated;

create policy push_subscriptions_owner_all on public.push_subscriptions
  for all to authenticated
  using (
    (select public.user_aal()) = 'aal2'
    and user_id = (select auth.uid())
  )
  with check (
    (select public.user_aal()) = 'aal2'
    and user_id = (select auth.uid())
  );
