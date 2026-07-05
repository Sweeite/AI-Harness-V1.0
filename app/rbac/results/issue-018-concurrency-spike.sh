#!/usr/bin/env bash
# ISSUE-018 — AC-1.ROLE.005.2 LIVE two-session concurrency proof (the write-skew guard).
#
# Proves that the ADR-004 transaction-scoped advisory lock actually prevents the last-Super-Admin
# write-skew: two concurrent transactions each demote a DIFFERENT one of the last two protected-role
# holders. WITHOUT the lock both count sub-selects read the pre-change count (2) and both commit → zero
# holders (lockout). WITH the lock they serialize → the second sees the committed decrement and is refused
# → exactly one holder remains. This is the invariant offline JS-serialized tests cannot exercise.
#
# SAFE + DETERMINISTIC regardless of any real Super Admins on the silo: it operates on its OWN throwaway
# protected role (`__iss018_conc_guard__`) and two throwaway users, using the identical guard SQL
# (advisory xact lock + conditional UPDATE + count sub-select) parameterised to that role. Everything is
# torn down unconditionally on exit.
#
#   source ~/.ai-harness-secrets.env
#   bash app/rbac/results/issue-018-concurrency-spike.sh
set -euo pipefail

PSQL="${PSQL:-/opt/homebrew/opt/libpq/bin/psql}"
DB="${SILO_DB_URL:?SILO_DB_URL must be set (source ~/.ai-harness-secrets.env)}"
ROLE='__iss018_conc_guard__'
LOCK='iss018:conc-test'
U1='00000000-0000-0000-0000-0000180c0a01'
U2='00000000-0000-0000-0000-0000180c0a02'

cleanup() {
  "$PSQL" "$DB" -v ON_ERROR_STOP=0 -q >/dev/null 2>&1 <<SQL || true
    set session_replication_role = replica;
    delete from user_roles where user_id in ('$U1','$U2');
    delete from profiles  where id      in ('$U1','$U2');
    delete from role_permissions where role_id in (select id from roles where name in ('$ROLE','__iss018_conc_std__'));
    delete from roles where name in ('$ROLE','__iss018_conc_std__');
SQL
}
trap cleanup EXIT

# ── setup (committed so both sessions see it) ─────────────────────────────────────────────────────
"$PSQL" "$DB" -v ON_ERROR_STOP=1 -q <<SQL
  set session_replication_role = replica;
  insert into roles (name, is_default, is_protected) values ('$ROLE', false, true) on conflict (name) do nothing;
  insert into roles (name, is_default, is_protected) values ('__iss018_conc_std__', false, false) on conflict (name) do nothing;
  insert into profiles (id, email) values
    ('$U1','iss018-conc-1@example.invalid'), ('$U2','iss018-conc-2@example.invalid') on conflict do nothing;
  insert into user_roles (user_id, role_id, active) values
    ('$U1', (select id from roles where name='$ROLE'), true),
    ('$U2', (select id from roles where name='$ROLE'), true)
  on conflict (user_id) do update set role_id = excluded.role_id, active = true;
SQL

# ── the guarded demotion (identical shape to SupabaseRbacStore.atomicChangeRole) ──────────────────
demote() {
  local uid="$1"
  "$PSQL" "$DB" -v ON_ERROR_STOP=1 -q -t <<SQL
    begin;
    select pg_advisory_xact_lock(hashtext('$LOCK'));
    select pg_sleep(0.4);   -- widen the overlap window so the two sessions genuinely race
    with upd as (
      update user_roles set role_id = (select id from roles where name='__iss018_conc_std__')
        where user_id = '$uid' and active
          and not (
            role_id = (select id from roles where name='$ROLE')
            and (select count(*) from user_roles ur join roles r on ur.role_id = r.id
                   where r.name = '$ROLE' and ur.active) <= 1
          )
      returning 1
    )
    select coalesce(count(*),0) as demoted from upd;
    commit;
SQL
}

echo "── firing two concurrent demotions of the last two '$ROLE' holders ──"
demote "$U1" > /tmp/iss018_c1.out &
P1=$!
demote "$U2" > /tmp/iss018_c2.out &
P2=$!
wait "$P1"; wait "$P2"

D1=$(tr -dc '0-9' < /tmp/iss018_c1.out | head -c1 || echo 0)
D2=$(tr -dc '0-9' < /tmp/iss018_c2.out | head -c1 || echo 0)
REMAIN=$("$PSQL" "$DB" -v ON_ERROR_STOP=1 -q -t -A -c \
  "select count(*) from user_roles ur join roles r on ur.role_id=r.id where r.name='$ROLE' and ur.active")

echo "demotions applied: U1=$D1 U2=$D2 ; '$ROLE' holders remaining: $REMAIN"

FAIL=0
if [ "$(( ${D1:-0} + ${D2:-0} ))" -ne 1 ]; then echo "FAIL: expected exactly ONE demotion to apply, got $(( ${D1:-0} + ${D2:-0} ))"; FAIL=1; fi
if [ "${REMAIN:-0}" -ne 1 ]; then echo "FAIL: expected exactly ONE protected holder to remain, got $REMAIN"; FAIL=1; fi
if [ "$FAIL" -eq 0 ]; then
  echo "✓ AC-1.ROLE.005.2 LIVE: the advisory lock serialized the race — one demotion won, the invariant held (never zero)."
else
  echo "✗ AC-1.ROLE.005.2 LIVE: write-skew NOT prevented."
fi
exit "$FAIL"
