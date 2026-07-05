# ISSUE-018 — live capstone evidence (2026-07-05, session 68)

Silo `SILO_DB_URL`, migration head `0005` (unchanged — ISSUE-018 adds no migration). Operator present (💻 FULL).

## Preflight (live silo state)
- `roles` / `role_permissions` tables present; `user_perms(uid)` helper present (ISSUE-009).
- 6 roles already seeded (prior provisioning), 0 active Super Admins assigned.

## Capstone — `app/rbac/results/issue-018-capstone.sql` (ONE rolled-back txn)
```
NOTICE:  ISSUE-018 capstone: ALL ASSERTIONS PASS (6 roles · AF-080 helper parity · atomic last-SA guard · 1 SA remain)
ROLLBACK   (exit 0)
```
Proved live, fail-loud:
- **AC-1.ROLE.001.1** — the six seed roles reach existence (seed mechanism target state).
- **AC-1.PERM.002.1 / AF-080 (part a, live)** — `user_perms(SuperAdmin)` returns `PERM-system.role_manage`; `user_perms(StandardUser)` does not. The RLS SECURITY-DEFINER helper reads the SAME `user_roles ⋈ role_permissions` rows the harness `can()` reads → the two readers agree on the live grant set (non-drift).
- **AC-1.ROLE.005.2 (guard logic)** — the conditional UPDATE applies to a non-last Super Admin (rowcount 1) and REFUSES the resulting last one (rowcount 0); count never reached zero.

## Concurrency spike — `app/rbac/results/issue-018-concurrency-spike.sh` (TWO live sessions racing)
```
── firing two concurrent demotions of the last two '__iss018_conc_guard__' holders ──
demotions applied: U1=1 U2=0 ; '__iss018_conc_guard__' holders remaining: 1
✓ AC-1.ROLE.005.2 LIVE: the advisory lock serialized the race — one demotion won, the invariant held (never zero).
(exit 0, ~2.5s)
```
This is the definitive live proof of **AC-1.ROLE.005.2 under real concurrency** — the write-skew the offline JS-serialized test cannot exercise. Two concurrent transactions each demote a *different* one of the last two protected-role holders; the ADR-004 `pg_advisory_xact_lock` serialized them so the second session saw the committed decrement and was refused. **Without** the lock (the first-cut implementation the independent verifier caught) both count sub-selects would read the pre-change count of 2 and both commit → zero holders → lockout. The spike uses its own throwaway protected role, so it is deterministic regardless of any real Super Admins, and tears its fixtures down unconditionally.

## Cleanup verified
Silo returned to 6 roles, 0 residual `__iss018%` roles/users. Byte-identical to pre-capstone (only ISSUE-009's 0002 persists from earlier).

## What the independent verifier caught (both fixed + re-proven)
- **MAJOR-1** — the live guard omitted the ADR-004 advisory lock (write-skew → possible zero-Super-Admin lockout). Fixed: `SupabaseRbacStore.withGuardLock` wraps both atomic guards in a txn-scoped `pg_advisory_xact_lock`. Proven by the concurrency spike above.
- **MAJOR-2** — the AF-080 offline differential compared `effectiveNodes`/`rlsHelperPerms`, which delegated to the same store methods (a tautology). Fixed: `rlsHelperPerms` now re-joins the raw tables independently; a `AF-080(teeth)` test proves a deactivated assignment is excluded by both readers (a dropped `active` filter would diverge). The live `user_perms` parity above is the cross-reader proof.
