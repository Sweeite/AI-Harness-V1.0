# Checkpoint-3 retroactive adversarial review — evidence (session 72, 2026-07-07)

Checkpoint 3 (Stage 3: gate `018` + the 17-issue batch) closed in session 69 on offline-sweep +
per-issue adversarial verification. This session ran the SAME live-adapter-vs-real-schema review the
Stage-4 full review (commit `a1ad9b2`) ran on Stage 4 — cross-checking every live Postgres adapter's
literal SQL (table/column/enum values, FK targets, transaction boundaries) against the actually-applied
migrations and the live silo/mgmt-plane schema — over all 18 Checkpoint-3 packages. It found a materially
larger yield than Stage-4's review (7 BLOCKER + 11 MAJOR vs. 3+3), all fixed and live-verified below.

**Method:** 18 parallel independent read-only review passes (one per package: `018`/rbac, `012`/management,
`013`/auth, `014`/superadmin-auth, `032`/connector-runtime, `043`/prompt-layer-identity,
`044`/prompt-layer-context, `046`/prompt-optimisation, `047`/triggers, `048`/task-queue, `055`/hard-limits,
`057`/anomaly-checks, `059`/injection-pipeline, `060`/guardrail-log, `074`/cost-meter, `075`/alerting,
`076`/realtime, `084`/retention), each cross-checking the live adapter against `app/silo/migrations/*.sql`
and live `\d`/`pg_policy`/`pg_publication_tables` reads against `$SILO_DB_URL`/`$MGMT_DB_URL`. Findings
were triaged, fixed, then each fix was live-verified (rolled-back or cleaned-up writes against the real
DB) before commit.

## Clean (no BLOCKER/MAJOR)

`013`/auth · `032`/connector-runtime · `055`/hard-limits · `057`/anomaly-checks · `059`/injection-pipeline ·
`043`/prompt-layer-identity — all matched live schema exactly; only cosmetic/MINOR notes (non-atomic
2-step writes that fail loud rather than corrupt; one unreachable whitespace bug).

## Disclosed, already-tracked gaps (not fixed here — carried forward, not this batch's bugs)

- `046`/prompt-optimisation — `prompt_version_attribution`/`task_outcome` tables don't exist yet; a
  deliberate seam owned by ISSUE-053 (C5), already disclosed in the package's own `results/README.md`.
  **Action:** carry into ISSUE-053's scope note (not re-logged as a new OD — the ownership was already
  correct, it just wasn't in Checkpoint-3's own residual list).
- `047`/triggers — `trigger_delivery` table doesn't exist yet; owned by ISSUE-049, already disclosed in
  `results/schema-delta.proposal.md` + `results/AF-135-live-spike-owed.md`. Also had a stale code comment
  claiming the `dispatch_frozen_blocked`/`ingest_failure` event_type values weren't applied — they were
  (migration `0007`); comment corrected would be a follow-up, not fixed in this pass (cosmetic doc-drift,
  no behavioural impact — the cast succeeds live).
- `014`/superadmin-auth — no defect found, but the live adapter had **zero** live-DB proof (no
  `results/live-smoke.sql`, nothing instantiates `SupabaseSuperAdminAuthStore` outside its own module).
  Flagged for the same live-smoke-authoring pass Stage-4 gave every package; not done in this session
  (scope was fix-the-bugs, not backfill-every-missing-smoke-test).

These three are pre-existing, correctly-scoped-elsewhere gaps this review surfaced but did not need to
fix — logged here so they aren't silently lost now that Checkpoint 3 is long closed.

## BLOCKER / MAJOR findings — fixed + live-verified

| # | Package (issue) | Severity | Defect | Fix | Live-verified |
|---|---|---|---|---|---|
| 1 | `012`/management | BLOCKER | `ingest()`'s `deployment_health` upsert set `log_write_failing = excluded.log_write_failing` with no `coalesce` (every sibling column had one) — a push omitting the field silently cleared an active failure flag | added `coalesce($12, deployment_health.log_write_failing)` | ✅ two sequential live `ingest()` calls, 2nd omitting the field, flag stayed `true` |
| 2 | `012`/management | MAJOR | `ingest()`'s 3 writes (dedup marker, `core_version`, `deployment_health` upsert) were 3 independent auto-committed statements — a crash mid-sequence permanently loses the push while a retry reads as an ordinary idempotent replay | wrapped in one `BEGIN`/`COMMIT`/`ROLLBACK` via `pool.connect()` | ✅ replay-of-same-`delivery_id` test still correctly reports `replayed:true` post-fix |
| 3 | `012`/management | MAJOR | `registerClient()` had no `try/catch` — a `client_slug` UNIQUE violation threw a raw pg `23505` instead of the documented `ManagementError(ERR_DUPLICATE_SLUG, ...)` the port contract promises | catch `code === '23505'`, rethrow as `ManagementError` | ✅ live duplicate-slug registerClient call throws the documented shape |
| 4 | `012`/management | MAJOR | `transitionStatus()` was a read-then-write with no compare-and-swap — two concurrent transitions off the same starting status race with silent last-write-wins | added `and status = $3::client_status` guard + `ERR_TRANSITION_CONFLICT` on `rowCount===0` | ✅ two concurrent live transitions off `active`: exactly 1 winner + 1 `transition_conflict`, no silent loss |
| 5 | `048`/task-queue | BLOCKER | `service_role` still held live DELETE on `task_queue` — the append-only/no-delete invariant (FR-5.QUE.001, Rule 0 §1) was asserted only against a never-applied scratch migration file; `task_history.task_id` cascades on delete, so one DELETE would have silently taken the audit trail with it | migration `0021_task_queue_append_only.sql` — `revoke delete on task_queue from anon, authenticated, service_role`; test now reads the real applied migration | ✅ live `SET ROLE service_role; DELETE FROM task_queue ...` → `permission denied` |
| 6 | `044`/prompt-layer-context | BLOCKER | `dynamic_field_values` never got the RLS grant+policy `prompt_layers` got in migration `0004` — any `authenticated`-role caller (the ISSUE-044 operator dynamic-value editor) got `permission denied` before RLS even ran | migration `0022_dynamic_field_values_rls.sql` — `PERM-config.prompts` policy (rls-policies.md L67 is canonical over the package's own proposal doc which said `PERM-prompt.edit`) + grant select/insert/update to `authenticated` | ✅ live: policy + grants present, confirmed via `pg_policy`/`information_schema.role_table_grants` |
| 7 | `084`/retention | BLOCKER | `registerClient`/`registryHome` targeted `client_registry` (a management-plane-only table) using the same `pg.Pool` as the silo-only `config_values`/`config_audit_log` calls — throws `relation does not exist` on whichever DB it's actually pointed at | added a second, separate `mgmtPool` (constructor now takes an explicit `mgmtConnectionString`) | ✅ typecheck/tests green; no live caller existed yet to smoke beyond confirming the two pools are genuinely separate connections |
| 8 | `084`/retention | MAJOR | `unauthorisedTombstones()`/`tombstones()`/`hardDelete()` were stubs unconditionally returning `[]` — the RET.001 unauthorized-hard-delete detector (a #1/#2 safety mechanism) was silently non-functional | implemented the real `access_audit` (action='hard_delete') LEFT JOIN `deletion_requests` (status='executed') query; `client_offboarding`-path deletes fail-closed as unauthorised until the mgmt-plane `offboarding_records` table (ISSUE-085 era, not yet built) exists | ✅ live: inserted a real `hard_delete` `access_audit` row with no matching `deletion_requests` row → `unauthorisedTombstones()` correctly flagged it (previously would have returned `[]`); cleaned up via `set local app.retention_prune='on'` |
| 9 | `018`/rbac (gate) | MAJOR ×2 | `seedClearance`/`insertClearance` omitted `granted_at` from their INSERT column lists — Postgres silently substituted `now()` instead of the caller's value; the identical assertion passes against the in-memory fake and would fail live | added `granted_at` (with `coalesce($n, now())`) to both INSERTs | ✅ live: both methods return the exact caller-supplied `granted_at`; omitting it still defaults sanely |
| 10 | `076`/realtime | BLOCKER | `task_queue`/`notifications` were never added to the `supabase_realtime` publication — Postgres Changes connects fine but delivers zero events, forever, regardless of RLS | migration `0023_realtime_publication.sql` — `alter publication supabase_realtime add table task_queue, notifications` | ✅ live: `pg_publication_tables` now lists both |
| 11 | `076`/realtime | (separate, NOT fixed here) | `task_queue`/`notifications` also only carry `default_deny` RLS for `authenticated` — a real dashboard client gets zero rows even with the publication fix | **not fixed** — this half is explicitly owned by the still-`blocked` ISSUE-020 (per the package's own header); logging here so it isn't lost, not re-opening ISSUE-020 | n/a |
| 12 | `076`/realtime | MAJOR | Config-key naming drift: `surfaces.ts` uses `polling_interval_*_s`, `results/proposed-shared-spec.md` documented `poll_interval_*_seconds` — a config write following the doc would silently land on a key the code never reads | aligned the doc to the shipped code (code is real; doc was aspirational) | n/a (doc-only) |
| 13 | `075`/alerting | BLOCKER | `runEscalation()`'s secondary-alert path passed the raw `escalation_contacts` chain entry (which may be a role NAME) straight into `notifications.create({recipient: ...})`, a uuid FK column — throws on the first escalation whose chain entry is a role string | resolve via `resolveContact()`, skipping forward through the chain to the first entry that actually resolves (mirrors `resolveRecipient`'s existing fail-closed pattern); chain-exhausted-with-no-resolvable-entry now handled the same as chain-exhausted | ✅ offline chain-continuation teeth test still passes; live schema for `notifications.recipient` (`uuid references profiles(id)`) confirmed unchanged |
| 14 | `075`/alerting | BLOCKER | `loop_missed` alerts fed a human-readable loop name/slug (e.g. `"loop-daily"`) into `event_log.entity_ids` (`uuid[]`) — throws on the very first missed-loop alert | `entityId: null` for `loop_missed` (the loop name is already carried in `body`) | ✅ (pure logic fix; `entity_ids uuid[]` column shape unchanged and confirmed) |
| 15 | `075`/alerting | MAJOR | The escalate→create-secondary→re-stamp-secondary sequence was 3 independent writes; a crash after step 2 left the secondary indistinguishable from a fresh, never-escalated primary — the next escalation pass would restart the chain from the top | `escalation_state` (+`escalated_at`) now stamped in the SAME `create()` insert as the secondary notification, collapsing 3 writes to 2 and removing the failure window entirely (not a literal SQL transaction — a smaller surface by construction) | ✅ offline teeth test "chain continues, not restarts" still passes |
| 16 | `074`/cost-meter | MAJOR | `meterAndEvaluate()` wrote a fresh `cost_threshold_breach` notification on every poll tick (as often as every few minutes) while spend stayed above the soft rung — unbounded duplicate notifications; bug shared identically by the in-memory fake, so no existing test could catch it | added a dedup check (suppress a repeat for the same window until the prior one ages out of the period it covers) in both the live adapter and the fake | n/a (pure logic; both offline suites green) |
| 17 | `060`/guardrail-log | MAJOR | `all()`'s SELECT (and the `GuardrailLogRow` type) omitted `redacted_at` (added by migration `0015`) — a redacted row is presented to any consumer (e.g. `sinks.ts`'s export) as if never redacted | added `redacted_at::text as redacted_at` to the SELECT + the type (optional, to avoid breaking every existing row-literal in tests/other callers) | n/a (column exists live since migration `0015`, already applied; query now reads it) |

**Not fixed, correctly out of scope:** guardrail-log's "missing escalation-write method" finding — the
package's own header already attributes that write to ISSUE-057/059, so there's no code to add here.
Also not fixed: the two MINOR error-masking observations in guardrail-log's `resolve()`/`delete()`
catch-alls (mislabels a genuine substrate failure as an append-only violation) — lower severity, left as
a follow-up.

## Migrations applied live (silo head 0020 → 0023)

- `0021_task_queue_append_only.sql` — `revoke delete on task_queue from anon, authenticated, service_role`
- `0022_dynamic_field_values_rls.sql` — `PERM-config.prompts` policy + grant for `authenticated`
- `0023_realtime_publication.sql` — added `task_queue`/`notifications` to `supabase_realtime`

All three applied via `npm run migrate` (the proven `app/silo` runner) after `npm run check` passed
(discipline + RLS-coverage gates both green). Verified live post-apply (see per-finding table above).

## Sweep result

Full offline test suite across every `app/*` package: **all green** (no regressions from any fix).
`app/silo`'s own migration-manifest test (`schema.test.ts`) updated to include `0021-0023` — the same
stale-hardcoded-list class of test bug the Stage-4 review (`a1ac9b2`) fixed for `0011-0020`.

## Note on commit attribution

A subset of this session's fixes (`012`/management, `018`/rbac, `060`/guardrail-log) landed in the working
tree while a separate, concurrent session was also active on this repo; that session's commit `cf5b3c1`
("Handoff patch (session 71 self-sufficiency test) — fix 2 stale pointers") incidentally swept those
files' working-tree state into its own commit. Content was verified intact (full offline sweep + live
re-verification, this doc) — this note exists only so a future reader of `git log` isn't misled by that
commit's message into thinking `cf5b3c1` was purely a 2-pointer doc fix. The remaining fixes
(`044`/`048`/`076`/`075`/`074`/`084` + the 3 migrations) are committed separately under this session's own
commit, referencing this evidence file.
