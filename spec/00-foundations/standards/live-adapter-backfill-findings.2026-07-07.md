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

## Coverage
26 of 36 live adapters inspected this pass. **NOT re-inspected** (relied on session-72 verdicts): rbac, realtime, alerting, cost-meter, guardrail-log, management, retention, task-queue, anomaly-checks, prompt-layer-context, prompt-layer-identity, token-lifecycle, backup-dr. Part B must still cover these per its wave plan.

## Recommended handling
These are the confirmation that the R10 Part-B backfill is **not cosmetic** — at least 4 shippable BLOCKER-class
bugs sit in already-`done` Stage 0–3 adapters. Run Part B as written (operator-gated waves, live-verify each
finding before fixing). B1 is the highest priority (100% silent live webhook failure behind a green offline suite).
Nothing here was fixed this session — all fixes belong in the gated backfill so each is live-verified.
