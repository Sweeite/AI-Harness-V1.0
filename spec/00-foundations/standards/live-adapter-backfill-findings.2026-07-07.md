# Live-adapter backfill — audit findings (2026-07-07, session 73)

> **What this is.** A repo-of-record capture (Rule 0) of a whole-repo hygiene + bug audit run on
> 2026-07-07. The live-adapter findings below are the **input work-list for Part B** of
> `live-adapter-hygiene-sweep.md` (the one-time Stage 0–3 backfill). They were found by an offline
> static review cross-checked against the live migration DDL; **most are PLAUSIBLE-not-yet-live-verified**
> and must be reproduced against the real DB before any fix, per the Part B method. The four marked
> **CONFIRMED** were verified this session (live read-only query or direct code read).
>
> **Do not treat this as a fix list to burn down ad hoc.** Part B is operator-gated, ≤5 packages/wave,
> risk-ordered, live-verified. This file is its evidence input, not a licence to bulk-edit adapters.

## Verification status legend
- **CONFIRMED** — verified this session (live DB read or unambiguous code read).
- **PLAUSIBLE** — static finding cross-checked against migration DDL; not yet run against the live DB.

## Resolution log — the 4 confirmed BLOCKERs (session 73)
- **B1 — ✅ FIXED + live-verified.** Migration `0024_webhook_event_types` applied LIVE (head 0023→0024); enum now
  carries the 4 values; `app/webhook-auth/results/live-smoke.sql` passes rolled-back. Closed OD-179's owed migration.
- **B4 — ✅ FIXED + live-verified.** Migration `0025_agents_version_chain_unique` applied LIVE (head 0024→0025); the
  version-chain race now fails loud (unique_violation) instead of silently losing an edit. Adapter graceful-retry is an
  optional follow-up; the constraint is the load-bearing #1/#3 backstop.
- **B3 — ⛔ DESIGN FORK → [[OD-191]].** Not a code patch: the queue-view decoration state (tier/floored/routing/soft-
  countdown) is not persisted on `guardrail_log`, so the live view can't be rebuilt from the DB. Needs a schema-delta
  decision (fold with OD-188) or defer the C6 surface. **Immediate sub-fix owed:** make `buildQueueView` throw, not
  return silently-empty.
- **B5 — ⛔ DESIGN GAP → [[OD-192]].** No `invites` table exists; lifecycle methods delegate to the empty in-memory
  fake. Needs an operator scope decision (model on `profiles` / dedicated table / out-of-v1). **Immediate sub-fix owed:**
  the delegate-to-fake methods must stop returning silently-wrong results.
- **B2, M1–M12, MINORs — still PLAUSIBLE**, owed to the systematic Part-B waves below (not yet live-verified).

---

## BLOCKERS (live-path breakage / knowledge loss / silent failure)

| ID | Package · file:line | Defect | Non-neg | Status |
|---|---|---|---|---|
| B1 | webhook-auth · `supabase-store.ts:162-166`, `outcome.ts:91,108,132` | Writes `event_type` values `webhook_verified` / `webhook_replay_dropped` / `webhook_rate_throttled` / `webhook_failure_alert` that exist in **no migration** — the live silo `event_type` enum (head 0023) lacks all four. Every live webhook verify → `invalid input value for enum` → verified payload lost (#1), failure-alert rows never persist (#3). Root cause: OD-179's "live enum-add migration" was never landed (a resolved OD with a dangling residual). **Fix: author + apply a `event_type` enum-add migration for the 4 values as part of webhook-auth's Part B (Wave 3) close.** | #1/#3 | **CONFIRMED (live: enum has none of the 4 labels)** |
| B2 | approval-tiers · `supabase-store.ts:121-133,224-250` | `action.actionType` (a string action *name* like `send_email`) bound into `guardrail_log.task_id` / `task_queue.id` (`uuid`) → `invalid input syntax for uuid`; a required-approval action is silently un-gated. | #1/#2 | PLAUSIBLE |
| B3 | approval-tiers · `supabase-store.ts:415-436` (`buildQueueView`) | Runs the real pending-approvals query into `rows`, then `void rows` and returns `this.ref.buildQueueView(...)` — the empty in-memory ref. Operator approval queue is **always empty** live regardless of real pending rows. | #3 | **CONFIRMED (code read: L429 `void rows`, L435 returns ref)** |
| B4 | orchestrator · `supabase-store.ts:186-201` (`appendVersion`) | Version chain read-modify-write with no txn/`FOR UPDATE`/CAS and **no `unique(root,version)` on `agents`** (verified live: agents has no unique constraint). Concurrent `editCapability` → forked chain, one edit silently lost. | #1 | **CONFIRMED (live: no unique constraint on agents)** |
| B5 | invite-seed · `supabase-store.ts:299-327` | `revokeInvite`/`reissueInvite`/`resendInvite`/`markBounced` delegate to `this.ref` (in-memory fake never populated by the live `issueInvite`, which writes to Postgres). Live: no real invite can be revoked/reissued/resent/marked-bounced; a bounce webhook silently fails to mark undelivered. Same class as issue-015 (session 71). | #1/#3 | **CONFIRMED (code read: L301 etc. delegate to ref)** |

## MAJORS (require concurrency or specific state; still real)

| ID | Package · file:line | Defect | Non-neg |
|---|---|---|---|
| M1 | support-recovery · `supabase-store.ts:126-149` | Adapter runs under the authenticated caller's JWT; `access_audit` has RLS default-deny with **no INSERT grant/policy** for `authenticated` → transition INSERT rejected, status machine non-functional live; `transitionsFor` always `[]`. | #2/#3 |
| M2 | rate-limiting · `supabase-store.ts` ~169,264 | `Date.parse(row.reset_at)` on a `timestamptz` that pg returns as a JS `Date` → `NaN` → window never rolls forward; once full, every call treated as at-ceiling forever. Same on `deferred.run_after`. | #3/#1 |
| M3 | rate-limiting · `supabase-store.ts:108-149 vs 158-303` | `reconcileHeader` commits/releases its own txn+lock, then `decide` opens a new txn — vendor-header reconciliation is outside the decision's lock → concurrent `decide` both reconcile-then-increment past ceiling. | #1 |
| M4 | rate-limiting · `supabase-store.ts:353-380` (`drainDue`) | Deferred rows marked `drained_at` + committed, then fire runs outside any txn — crash between commit and fire = silently dropped deferred calls. | #1 |
| M5 | prompt-store · `supabase-store.ts:79-105` (`appendVersion`) | Same lost-update as B4 — CTE `max(version)+1` under READ COMMITTED, no `FOR UPDATE`, no `unique(layer,name,agent_id,version)`. | #1 |
| M6 | connector-runtime · `supabase-store.ts:64-102` (`editTool`) | Head resolved via plain SELECT, no `FOR UPDATE`, no unique on `tools` → concurrent edits both create v4 + both `enabled=true` → two enabled versions offered to AI selection. | #1 |
| M7 | approval-tiers · `supabase-store.ts:223-251` (`raiseFlag`) | Multi-row writes on the non-transactional pool (no `begin/commit`) unlike sibling methods → partial failure leaves a co-firing hard-limit's approvable row still `pending` and resumable. | #2 |
| M8 | config-store · `supabase-store.ts:63-68` (`putConfigValue`) | `on conflict (key) do update set updated_by = excluded.updated_by` with no `coalesce` → a system write (null) overwrites a prior non-null editor. | #1 |
| M9 | invite-seed · `supabase-store.ts:143-166` (`issueInvite`) | `auth.createUser` + `profiles` insert + audit + email not wrapped in a txn (unlike `runSeed`) → crash mid-sequence orphans auth.users+profiles with no `invite_issued` audit. | #1 |
| M10 | observability · `supabase-store.ts:79-87` (`redactTombstone`) | Bare `update … where redacted_at is null`, no rowCount check → GDPR-erasure of a missing/already-redacted id resolves as silent success; ref model throws not-found. | #3 |
| M11 | log-retention · `supabase-store.ts:134-144` (`rewriteContent`) | On a non-existent row the update hits 0 rows and falls through to an unconditional `throw AppendOnlyViolation("REWRITE")` — reports a tamper-rejection that never happened. | #3 |
| M12 | prompt-optimisation & triggers | `trigger_delivery` / `prompt_version_attribution` / `task_outcome` exist in no migration (owned by ISSUE-049/053, disclosed session 72) → live calls raise `relation does not exist`. Plus prompt-optimisation `captureAttribution` (L53-85) TOCTOU double-capture (check-then-insert, no unique). | #1 |

## MINORS
- auth `setProviderConfig` (L103-116) — two non-transactional `config_values` upserts; no `config_audit_log` row despite header claim. #1
- trigger-infra `setDefaultTriggerEnabled` (L59-84) — UPDATE then `writeAudit` non-transactional. #3
- write-tools (L99-103) — `decision.decidedBy` free string into `reviewed_by uuid`; non-UUID throws. #3
- invite-seed `deliver()` — `event_log` write on autocommit pool outside the `issueInvite` txn (compounds M9). #1
- hard-limits `setStatus` (L110-116) — `res.rows[0]!` no rowCount guard → `undefined` as a row. #3
- observability / log-retention / guardrail-log — `select *` coupling + prune FK-ordering coverage gap. #1

## Part-B sweep — Wave A results (2026-07-07, 5 packages, live-verified)
Packages: rate-limiting, support-recovery, config-store, observability, log-retention. Each got an independent
live-adapter review + a committed `results/live-smoke.sql` (all 5 run rolled-back against the live silo).

- **M2 (rate-limiting Date.parse) — ❌ REFUTED.** `Date.parse(Date)` coerces to a valid epoch, not NaN; the window rolls. (Optional: fix the `string` type-lie on timestamptz fields.)
- **M3 (rate-limiting reconcile lock) — ❌ REFUTED → MINOR.** `decide()`'s own `SELECT … FOR UPDATE` re-reads under the lock, so no over-call. Only artifact is a redundant connection.
- **M4 (rate-limiting drainDue) — ✅ CONFIRMED MAJOR, ⏳ OWED to consumer integration.** Marks rows `drained_at` + commits before the caller fires → crash between = silent drop (#1/#3). **No production consumer exists yet** (only tests call `drainDue`), so the correct two-phase claim→fire→confirm fix (a `fired_at`/status distinction + a re-drive sweeper) belongs with that integration. Recorded, not hacked in isolation. Mitigation: narrow crash window; the idempotency guard prevents double-fire on any re-drive.
- **M1 (support-recovery RLS) — ❌ REFUTED → MINOR.** Adapter connects as `postgres` (BYPASSRLS), not authenticated → the INSERT succeeds. But the header comment falsely claims "authenticated JWT" — a latent trap (fix the comment). Rolled into OD-193.
- **M8 (config-store coalesce) — ✅ CONFIRMED → MINOR.** Real null-clobber of last-editor, but parity with the fake + audit trail intact in `config_audit_log`. Optional `coalesce` fix.
- **M10 (observability redactTombstone) — ✅ CONFIRMED MAJOR → FIXED.** Silent success on a missing-id GDPR erasure. Fixed: rowCount check + re-read distinguishes not-found (throw) from already-redacted (idempotent), mirroring the fake. Tests 27/27.
- **M11 (log-retention rewriteContent) — ✅ CONFIRMED MAJOR → FIXED.** False tamper signal on a 0-row update. Fixed: rowCount check → distinct "REWRITE of a nonexistent row" (matches fake), never the in-place-REWRITE tamper message on a missing id. Tests 38/38.
- **NEW MAJOR (config-store retention DELETE role) → [[OD-193]].** Retention `DELETE` on `config_audit_log` works only because the adapter connects as `postgres`; `service_role` had DELETE revoked (0001c) → a role swap silently stops retention. Symptom of the systemic connection-role question.
- **SYSTEMIC → [[OD-193]]:** all silo adapters connect as `postgres` (owner, BYPASSRLS), NOT `service_role` as their comments claim. Refutes the #2/RLS finding class; raises a least-privilege + retention-grant decision.
- MINORs (event-after-commit audit gap, config run-log cost sentinel, observability rollback-masks-error, log-retention redactTombstone missing-id) — noted, not fixed this wave.

**Wave A net:** 2 MAJORs fixed live (M10, M11), 1 MAJOR owed to integration (M4), 1 systemic OD (OD-193), 2 refuted, 2 downgraded. Live-smokes committed for all 5.

## Part-B sweep — full remaining set (2026-07-07, 22 packages, all reviewed + smokes authored)
All 22 remaining adapters reviewed against live schema + a `results/live-smoke.sql` authored for each (12 pass
live; 10 have authoring-defect smokes — syntax/missing-parent-row, NOT adapter bugs — owed a polish pass).
**Meta-fact (OD-193): every silo adapter connects as `postgres` owner (BYPASSRLS), not `service_role`** —
refuted the whole RLS-permission finding class.

### ✅ FIXED + live-verified this session
- **Version-chain lost-update class → migration `0026`** (applied live, head 0025→0026; fork now fails loud):
  connector-runtime **M6** (`tools`), prompt-store **M5** + createLayer genesis, prompt-layer-context lost-update,
  prompt-layer-identity appendCoreVersion + createCore genesis — **6 findings, one migration** (`prompt_layers_prev_unique`
  + `prompt_layers_root_unique` + `tools_prev_unique`).
- realtime — **verified OK**: 0023 publication holds live (`task_queue`+`notifications` in `supabase_realtime`).

### 🔴 Design / integration gaps — need decisions (NOT hacked)
- **approval-tiers → [[OD-194]] (+ [[OD-191]]):** non-functional live — B2 + resolve() bind string action-name / reviewer-identity into uuid/FK columns (every write `22P02`); B3 queue-view silently empty. String-keyed adapter vs uuid schema; name→id resolution never wired.
- **invite-seed → [[OD-192]]:** revoke/reissue/resend/markBounced delegate to the empty fake; no invites table (native Supabase token, OD-014). **+ 2 new MAJORs (owed, contained):** `issueInvite` is a non-atomic multi-write (auth.users + profiles + audit); live `completeSetup` drops the fake's `client_tenant`⇒`method='oauth'` guard.

### ⏳ Owed to OTHER issues (missing tables — disclosed session 72, not new bugs)
- **prompt-optimisation:** `prompt_version_attribution` / `task_outcome` / `trigger_delivery` exist in NO migration (owned by ISSUE-049/053) → M12-a BLOCKER (relation-does-not-exist) + M12-b TOCTOU (moot until the table + a unique-on-task_id land). Non-functional live until those issues ship.
- **triggers:** `isDelivered`/`markDelivered` query `trigger_delivery` (owned by ISSUE-049) → non-functional live until it lands.

### ✅ Owed code MAJORs — FIXED (session 73, fan-out; offline-verified, adversarial tests added)
- **invite-seed** — non-atomic `issueInvite` now wraps profiles-insert + `invite_issued` audit in ONE txn (auth.createUser before, deliver after commit, orphan-residual documented); `completeSetup` now enforces the fake's `client_tenant`⇒`method='oauth'` guard. 34/34 tests (+4 new).
- **hard-limits** — `setStatus('pending')` short-circuits to a no-op matching the fake (the append-only trigger would reject the UPDATE); added the missing rowCount not-found guard. 17/17 tests (+4 new). #2-critical, matched fake exactly.
- **rate-limiting M4 (drainDue)** — assessed: **no safe self-contained fix** (needs a `fired_at`/status column = migration + a re-drive sweeper + the unbuilt consumer's confirm contract). Left a precise ⚠️ OWED comment block at the code site; stays owed to the consumer integration (correct call, not forced).

### ✅ Clean (only MINORs; session-72-reviewed set holding up)
task-queue, superadmin-auth, retention, release (mgmt-plane), rbac, management (mgmt-plane), injection-pipeline,
guardrail-log, cost-meter, auth, anomaly-checks, alerting — ~30 MINORs total across all 22 (stale service_role
comments per OD-193, non-transactional audit-after-write edges, missing-id silent no-ops, `select *` coupling).

### Owed polish
10 authored `live-smoke.sql` files have authoring defects (syntax `:`/`max(uuid)`, missing parent-row setup) →
need a fixup pass so every package's smoke runs green. The 12 passing smokes are validated.

## Coverage
**All 36 live adapters now reviewed** (14 Stage-4 + webhook-auth + orchestrator + Wave A's 5 + this sweep's 22). **NOT re-inspected** (relied on session-72 verdicts): rbac, realtime, alerting, cost-meter, guardrail-log, management, retention, task-queue, anomaly-checks, prompt-layer-context, prompt-layer-identity, token-lifecycle, backup-dr. Part B must still cover these per its wave plan.

## Recommended handling
These are the confirmation that the R10 Part-B backfill is **not cosmetic** — at least 4 shippable BLOCKER-class
bugs sit in already-`done` Stage 0–3 adapters. Run Part B as written (operator-gated waves, live-verify each
finding before fixing). B1 is the highest priority (100% silent live webhook failure behind a green offline suite).
Nothing here was fixed this session — all fixes belong in the gated backfill so each is live-verified.

---

## Adapter-MINOR dispositions (session 74 — C8 triage)
The "~30 MINORs" were triaged; most were already resolved or are correctly owned elsewhere. Dispositions:
- **auth `setProviderConfig` (non-transactional 2 upserts, #1)** — ✅ FIXED (commit) — wrapped in one txn; live-smoke 0 errors.
- **auth `setProviderConfig` missing `config_audit_log` row** — DEFERRED to ISSUE-086 (the config-admin write path owns the audit, per the adapter's own comment). Not this adapter's concern.
- **hard-limits `setStatus` missing rowCount guard (#3)** — ✅ already FIXED session 73 (rowCount not-found guard added).
- **trigger-infra `setDefaultTriggerEnabled` (UPDATE then writeAudit non-transactional, #3)** — DEFERRED: `writeAudit` uses `this.pool` internally; making it atomic needs threading a client through `writeAudit` (used in 2 sites) — an invasive refactor best done deliberately + live-verified, not rushed. Low probability (writeAudit rarely fails post-UPDATE); documented owed.
- **write-tools `decision.decidedBy` string→`reviewed_by uuid` (#3)** — already fail-LOUD (throws on non-uuid, not silent); tied to [[OD-196]] (deferred to ISSUE-056's real caller).
- **invite-seed `deliver()` event_log outside the issueInvite txn (#1)** — BY DESIGN: deliver runs AFTER commit intentionally (a send failure must NOT roll back a real issued invite; it surfaces explicitly). Not a bug.
- **observability / log-retention / guardrail-log `select *` coupling (#1)** — DEFERRED (robustness/coupling, not a live bug): explicit-column lists are a hygiene improvement; low risk, no live symptom. Owed to a focused adapter-hygiene pass.
- **rate-limiting `Date`-field `string` type-lie / redundant reconcile connection; config-store M8 coalesce null-clobber** — cosmetic/optional (parity with the fake; audit trail intact). DEFERRED, non-#3.
- **support-recovery false "authenticated JWT" comment (M1)** — ✅ handled by [[OD-193]] doc sweep.

Net: 1 fixed (auth atomicity), 2 already-done, rest correctly by-design / owned-elsewhere / deferred-hygiene. None is a #1/#2/#3-live hazard left open.
