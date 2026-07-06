# ISSUE-016 (support-recovery) — proposed shared-spec deltas

These are the SHARED-SPEC changes ISSUE-016 needs but must NOT author itself (they touch files outside
`app/support-recovery/` — the baseline migration, the RLS scaffold, schema.md). The orchestrator applies them
SERIALLY after the fan-out. Each is stated as exact SQL / key name / doc section. Items believed already present
are marked **verify-present**.

---

## 1. RLS policy — `support_requests` (NEW policy on the ISSUE-009 scaffold) — REQUIRED

Homed in `spec/04-data-model/rls-policies.md` §Per-table summary L51 (already lists the intent:
`PERM-support.view` read · **public INSERT-only** intake · `PERM-support.resolve` updates). The concrete policy
DDL is owed. It rides the ISSUE-009 helpers (`user_perms(auth.uid())` via the `(select …)` initPlan, AF-067) and
the ISSUE-009 default-deny baseline (`REVOKE ALL` + RLS enabled). Proposed migration body (new migration file,
e.g. `app/silo/migrations/00NN_support_requests_rls.sql` — orchestrator assigns the number):

```sql
-- support_requests RLS (FR-0.REC.002/.003/.005; rls-policies.md L51).
-- Default-deny baseline (REVOKE ALL + enable RLS) ships from the ISSUE-009 scaffold; this file adds the policies.
alter table support_requests enable row level security;

-- (a) PUBLIC INSERT-only intake — the pre-auth "Trouble signing in?" form (FR-0.REC.002). The anon role may
--     INSERT a new row but can NEVER SELECT existing rows (no USING clause on a read; only a WITH CHECK on the
--     insert). NOTE: this is the one table whose write path is intentionally NOT aal2-gated — the intake is
--     pre-authentication, so the universal aal2 baseline (rls-policies.md rule 5) does not apply to THIS insert.
create policy support_requests_public_insert
  on support_requests for insert
  to anon, authenticated
  with check (
    status = 'pending'                    -- a public insert may only file a pending row (no status injection)
    and assigned_to is null               -- cannot self-assign on intake
  );

-- (b) Read — PERM-support.view holders only (FR-0.REC.003 / AC-0.REC.003.1). aal2 baseline applies (rule 5).
create policy support_requests_view
  on support_requests for select
  to authenticated
  using (
    'PERM-support.view' = any (select user_perms(auth.uid()))
    and (select user_aal()) = 'aal2'
  );

-- (c) Update (status transitions) — PERM-support.resolve holders only (FR-0.REC.005). aal2 baseline applies.
--     The legal-move + resolved-immutable enforcement is app-layer (SupabaseSupportStore.transition, guarded by
--     `where status = <from>` for concurrency); this policy governs WHO may update, not WHICH transition.
create policy support_requests_resolve
  on support_requests for update
  to authenticated
  using (
    'PERM-support.resolve' = any (select user_perms(auth.uid()))
    and (select user_aal()) = 'aal2'
  )
  with check (
    'PERM-support.resolve' = any (select user_perms(auth.uid()))
    and (select user_aal()) = 'aal2'
  );

-- No DELETE policy — support_requests is never deleted from the human path (resolved = immutable history,
-- FR-0.REC.005). The stale-sweep read (FR-0.REC.007) runs as service_role (bypasses RLS).

-- OD-106 / FR-0.REC.007 overdue computation reads created_at + status → supporting index:
create index if not exists support_requests_status_created_idx on support_requests (status, created_at);
```

Rationale for the `anon, authenticated` INSERT grant: the intake form is reachable pre-auth (a locked-out user is
not signed in) — so `anon` must be able to insert; `authenticated` is included so a signed-in user who still can't
proceed can also file. Neither may read back (no SELECT policy grants them), which is the "public INSERT-only,
cannot SELECT existing" boundary from L51 and AC-0.REC.003.1.

---

## 2. `event_type` enum — THREE additive values — REQUIRED

`spec/04-data-model/schema.md` / `app/silo/migrations/0001_baseline.sql` L60-65 define `event_type`. The REC
area writes three event kinds the enum does not yet admit (FR-0.REC.002/.006/.007). Additive / expand-contract-safe
(same class as OD-170's `authz_revoked_midtask` / `rls_harness_divergence` additions):

```sql
alter type event_type add value if not exists 'support_request_created';       -- FR-0.REC.002
alter type event_type add value if not exists 'support_notification_sent';     -- FR-0.REC.006
alter type event_type add value if not exists 'support_notification_failed';   -- FR-0.REC.006 edge (#3 — dropped alert logged)
alter type event_type add value if not exists 'support_reescalation';          -- FR-0.REC.007
```

(Four values — `support_notification_failed` is the #3 "never let a dropped alert hide a stuck user" record; if
the orchestrator prefers to fold delivery-failure into the C7 generic `alert_delivery_misconfigured` alert_type
instead, drop that one value and route the failure event there. Recommended: keep it explicit here for the REC
audit trail.)

## 3. `alert_type` enum — ONE additive value — REQUIRED (or map to existing)

`event_type`'s sibling `alert_type` (0001_baseline.sql L71-73) carries no support type. The FR-0.REC.006 admin
notification is a `notifications` row whose `type alert_type` needs a value:

```sql
alter type alert_type add value if not exists 'support_request';               -- FR-0.REC.006 admin notification
```

If the orchestrator prefers to reuse `proactive` or route support notifications outside the `alert_type` taxonomy,
adjust `sinks.ts` `ALERT_SUPPORT_REQUEST` accordingly — this slice references the value only through that constant.

---

## 4. `access_audit` — status-transition record (uses EXISTING columns) — verify-present

FR-0.REC.005 status transitions are written to the existing `access_audit` table (0001_baseline.sql L211-226) as
`audit_type = 'support_status_transition'` rows, one per transition (before_value/after_value = `{status}`,
`actor_identity` = the resolver, `created_at` = the timestamp). **No DDL change** — `audit_type` is free `text`.
Verify-present: the `access_audit` table + its append-only trigger (ISSUE-008) already exist. This slice's live
adapter (`supabase-store.ts`) writes these rows; the offline fake models the same history via `transitionsFor`.

## 5. `CFG-support.stale_request_minutes` — config key — verify-present

Already registered in the ISSUE-010 config store: `app/config-store/src/index.ts` L56 maps
`support.stale_request_minutes → PERM-config.auth` (and the `support.` uniform-prefix family probe at L88 /
keygroup.ts L222). **No new key needed** — verify-present. This slice's `DEFAULT_STALE_REQUEST_MINUTES = 30` is
the sweep fallback when no override is set.

## 6. Scheduled job — the stale sweep (FR-0.REC.007) — wiring note (no DDL)

The `SupportService.runStaleSweep(now, staleMinutes)` is the job body. It runs as **service_role** (bypasses RLS,
no `auth.uid()`, ADR-006) on the harness scheduler cadence (Inngest/cron — the C7/scheduler owns the trigger). No
migration; the orchestrator/C7 wires the cron entry to call `runStaleSweep`. Read-only over `support_requests`
(never mutates status), so an un-picked-up request keeps re-alerting each run (bounded, never vanishes — #3).

---

## Nothing else is owed to the shared spec.

`support_requests` + `support_status` (the enum) already exist in the ISSUE-008 baseline (0001_baseline.sql
L107-116 / L28) with no `client_slug` (ADR-001 §3 / OD-096) — this slice authored NO create-table / create-type
DDL, matching the fan-out isolation rule.
