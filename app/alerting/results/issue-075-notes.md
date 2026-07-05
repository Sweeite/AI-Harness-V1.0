# ISSUE-075 alerting — build notes, offline proof, and live-proof owed

## What this package is

The C7 alerting layer on top of the ISSUE-011 observability skeleton. Port + in-memory fake **reference
model** (the fake enforces every FR invariant the DB/DDL would) + a live pg adapter authored to the existing
DDL (`app/silo/migrations/0001_baseline.sql` — `notifications`, `event_log`, `config_values`). **No migration
is authored** (ISSUE-075 MIGRATION note: writes `notifications`/`event_log`, reads the `config_values`
structured objects — all pre-existing tables/enums).

- `src/types.ts` — schema-faithful projections of `notifications` / `event_log` / the §12 config structured
  objects; the `alert_type` enum + the CRITICAL-class set (never quiet-silenced, never strandable).
- `src/rules.ts` — the seven alert rules as a pure evaluation pass with per-deployment thresholds;
  `hard_limit_hit` is event-driven + non-suppressible; `loop_missed` references the C5 catch-up.
- `src/config-validation.ts` — write-time fail-closed validation (a critical type with no destination is
  rejected) + the quiet-hours window math (server minute-of-day, wraps midnight, never silences criticals).
- `src/engine.ts` — the delivery engine: dashboard-persist-first → event_log-always → route-by-type with
  escalate-don't-drop → unroutable-fails-loud misconfigured-critical (+ mgmt-plane bit) → quiet-hours gate →
  best-effort Slack fan-out with surfaced failures; plus the escalation-window → secondary-alert chain and the
  C5/C6 seams (`deliverHardLimit`, `deliverStaleApproval`).
- `src/store.ts` — the ports + in-memory fakes + a controllable fake Slack client (fault injection).
- `src/supabase-store.ts` — three sibling live adapters over one pool (NOT run live here).

## Offline proof (this half) — ALL GREEN

- `npm install && npm test` → **28/28 pass** (one test per §4 AC + a quiet-window-wrap unit test + 3
  fail-closed-resolvability / chain-start regression tests — see "Fail-closed resolvability fix" below). Every
  test has teeth: each asserts the invariant AND a counterfactual (the thing that must not happen), so a
  tautological pass is impossible.
- `npm run typecheck` → **clean** (tsc --noEmit, strict + noUncheckedIndexedAccess).
- `npm run check` → 5/5 offline gates pass (critical-never-quiet-silenced, hard-limit-non-suppressible,
  fail-closed-config-validation, fail-closed-dead-string-destination, enum-shape).

### Fail-closed resolvability fix (post-verification, #2/#3)

Adversarial verification caught a fail-OPEN gap: `hasResolvableDestination()`/`resolveRecipient()` accepted ANY
non-empty escalation-contact string as a deliverable destination (the old `looksLikeUserId` = `length > 0`). A
critical/`hard_limit_hit` alert routed to a role nobody holds whose only escalation contact was a **typo'd,
role-shaped string nobody holds** (e.g. `supr_admin`) was accepted at write time and, at runtime, "delivered" to
that dead string — a critical alert silently reaching **no one** (#2/#3).

Fix (fail-CLOSED): `RoleResolver` gained `isKnownRecipient(userId)` — the C1 model's set of actual known
recipients — and a single shared `resolveContact(contact, roles)` rule (types.ts) resolves a destination to a
concrete user id ONLY if it is a role with ≥1 holder OR a genuinely-known bare user id; anything else (a typo'd
role, a removed/unknown id) resolves to `null`. BOTH write-time validation (`hasResolvableDestination`) and
runtime routing (`resolveRecipient`) now route through that one rule, so they cannot disagree. A genuinely
resolvable bare user id is still allowed (no over-rejection). Also fixed a related chain-start bug: `runEscalation`
assumed the primary recipient == `chain[0]`; when the routed-role holder is NOT `chain[0]`, the first escalation
now starts explicitly after the primary (`firstChainStepAfterPrimary`) so `chain[0]` is never silently skipped.
New regression tests: AC-7.ALR.009.3 (typo'd-role critical REJECTED on write), AC-NFR-OBS.008.1 (runtime raises
the misconfigured-critical, never routes to the dead string), AC-7.ALR.005.1 (routed-role holder != chain[0]).

### AC → offline coverage (all proved against the in-memory reference model)

| AC | Proved offline | Notes |
|---|---|---|
| AC-7.ALR.001.1/.2 | ✅ | dashboard row with no Slack; unread-until-actioned (read ≠ actioned) |
| AC-7.ALR.002.1/.2/.3 | ✅ | threshold fires-at-not-before; hard_limit non-suppressible by construction; loop_missed → C5 |
| AC-7.ALR.003.1/.2 | ✅ | stale-approval to the specific reviewer; unresolvable role → escalation chain, not dropped |
| AC-7.ALR.004.1 | ✅ | event_log row exists even when Slack fails |
| AC-7.ALR.005.1/.2/.3 | ✅ | secondary at window expiry; critical never auto-resolved (stays open/escalated); server clock governs |
| AC-7.ALR.006.1/.2 | ✅ | Slack outage keeps rows; failure surfaced on delivery_state |
| AC-7.ALR.007.1/.2 | ✅ | C6 hard-limit → immediate dashboard+Slack; C5 stale approval → reviewer |
| AC-7.ALR.009.1/.2/.3/.4 | ✅ | unroutable → misconfigured critical + mgmt-plane bit; quiet-hours never silences critical; fail-closed config write; runtime-invalid webhook surfaced |
| AC-NFR-OBS.008.1/.2 | ✅ | unresolved target → louder alert; hard-limit delivered in quiet-hours |
| AC-NFR-OBS.009.1/.2 | ✅ | persist-first ordering (row survives a throwing fan-out); failure retained+surfaced |
| AC-NFR-OBS.016.1 | ✅ | audit row written independent of a failed delivery |

## Live proof owed (NOT provable in this offline half — owed to the ISSUE-075 Stage-3 checkpoint)

The reference model proves the **logic** of every AC offline. The following need a **live silo** (a 💻 FULL /
🧑 you-present session) to close, because they exercise the real DB substrate / real network — do NOT claim
them verified until the checkpoint records evidence:

1. **event_log append-only enforcement against a real service_role write** — the fake models the append-only
   trigger; the live proof that `event_log`'s BEFORE UPDATE OR DELETE trigger actually rejects a service_role
   mutation is the ISSUE-011 capstone (`app/observability/results/issue-011-capstone.sql`). This slice only
   appends; it inherits ISSUE-011's live trigger proof.
2. **dashboard-persist-first durability across a real Slack outage** — the fake proves the ordering
   (persist → fan-out) and that a throwing fan-out cannot lose the row; the live integration (a real webhook
   forced to 503/404, the row still present) is the delivery-durability integration test at the checkpoint
   (AC-7.ALR.006.1/.2, AC-NFR-OBS.009.1/.2).
3. **the mgmt-plane push carrying the `alert_delivery_misconfigured` bit onto the Super Admin grid** — this
   slice latches the health bit (`HealthBitChannel`); the actual outbound push is **ISSUE-012** (ADR-001 §7).
   AC-7.ALR.009.1's "carried on the mgmt-plane push, so a fully-misconfigured silo still surfaces on the Super
   Admin grid" is closed end-to-end only once ISSUE-012's reporter carries the bit.

## Feasibility flags (per ISSUE-075 §3 / §4)

- **AF-118** (absence-of-signal detection is only as live as its evaluator) — 🟢 already proven in ISSUE-011
  (the watchdog runs on an injected clock; this slice consumes the health-bit path, does not re-author it).
- **AF-120** (cross-deployment clock-sync for the escalation-window / staleness math) — 🟢 the window math here
  runs off a **single injected server clock** (`deps.now()`); `runEscalation` takes no caller timestamp, so a
  skewed client clock has no way in (AC-7.ALR.005.3 test, part B). The remaining cross-deployment clock-sync
  concern is a mgmt-plane / ISSUE-012 property, not a property of this slice's math.
- **AF-119** (last-resort out-of-band log-failure surface durability) — 🟡 **seam noted, not owned here.** This
  is the `event_log`-write-failure out-of-band path (stderr/file + `log_write_failing` health bit),
  authored in ISSUE-011 (`app/observability/src/store.ts` DegradedSink). This slice's alert-audit append rides
  that same path; its durability proof is owed to ISSUE-011/AF-119, not blocked here.

## Hard prohibitions honoured

No shared file touched: no `app/silo/migrations/*` change, no edit to `schema.md`, `config-registry.md`,
`PERMISSION_NODES.md`, `glossary.md`, any tracker, or any other `app/*` package. All proposals are files under
`app/alerting/results/` (`proposed-shared-spec.md`, this file). Only `app/alerting/` was created.
