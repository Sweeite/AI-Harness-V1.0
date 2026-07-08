-- Client-silo migration 0032 — profiles: the missing `authenticated` SELECT/UPDATE grant (ISSUE-013 fix)
--
-- BUG (found by the ISSUE-020 session-76 live capstone, latent since 0006): `0001c` REVOKEd the baseline
-- grants from `authenticated` on every silo table (default-deny by privilege). `0006_profiles_owner_rls`
-- (ISSUE-013) then authored the `profiles_owner_read` (SELECT self-row) + `profiles_owner_update` (UPDATE
-- self-row) POLICIES — but never GRANTed the table-level privilege back. A policy filters ROWS; the role
-- still needs the SQL privilege or the read is `permission denied` BEFORE RLS runs. Net effect: a user
-- reading/editing their OWN profile was permission-denied — the two self-row policies were dead. This is
-- fail-CLOSED (deny, no leak) but breaks the dashboard's self-profile read (FR-1.USR.*, the surface-02
-- "my profile" read). Every other opened table pairs GRANT+POLICY (0003/0004/0022/0031); profiles was the
-- gap. (ISSUE-013 is `done`; this is a bug-fix landed as a new additive migration, not a decision change.)
--
-- THE GRANT (scoped, #2-careful):
--   • SELECT — restores the self-row read gated by `profiles_owner_read` (auth.uid()=id ∧ aal2, per the
--     0031 retrofit). This is the actual reported bug.
--   • UPDATE (name) — COLUMN-SCOPED on purpose. `profiles_owner_update`'s WITH CHECK (auth.uid()=id) would,
--     under a blanket UPDATE grant, let a user write their OWN `active` column = self-reactivate/deactivate
--     — a #2 hazard, because activation/deactivation is the PERM-user.deactivate path (rls-policies.md), NOT
--     a self-edit. `email` mirrors auth.users and must not be edited here either. Granting UPDATE on ONLY
--     `name` (the display name) lets the self-edit the policy intends work while a write to `active`/`email`
--     fails loud (`permission denied for column …`) — closing a latent #2 hole the row-only policy carried.
--
-- Read-only otherwise; the service_role/owner path (invite seed, deactivation, the auth.users mirror) is
-- unaffected (service_role bypasses grants+RLS). Additive, non-destructive, idempotent (re-GRANT is a no-op).
-- transactional:true — the runner wraps it; do NOT add BEGIN/COMMIT.

grant select on public.profiles to authenticated;
grant update (name) on public.profiles to authenticated;
