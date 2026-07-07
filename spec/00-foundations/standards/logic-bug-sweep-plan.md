# Queued: adversarial LOGIC-bug sweep of the non-adapter business logic

> **Status:** QUEUED (operator-requested, session 73). To be run in a **fresh chat** with clean context —
> not bolted onto the adapter-sweep session. This doc is the repo-of-record so a cold resumer can run it
> without any prior conversation (self-sufficiency contract).

## What this is
A dedicated adversarial hunt for **logic bugs in the core business logic** — the pure functions +
orchestration that are NOT the DB-adapter layer: tier classification, escalation, routing, rate-limit
ladders, injection detection, memory-write gating, prompt assembly, loop short-circuits, etc.

## Why (the gap it closes)
The session-73 Part-B sweep covered the **DB-adapter boundary** (adapter SQL vs live schema + adapter
logic). It did **not** re-hunt the pure business logic. That logic is covered today only by:
- the offline test suites (767 green across all packages),
- `tsc` typecheck (clean),
- the per-issue adversarial verify done when each issue was built.

But a green suite proves the code matches **what the tests assert, not that the tests assert the right
things** — the exact offline-green/live-broken blind spot R10 exists for, applied to pure logic instead of
the DB. The business logic is in *better* shape than the adapters were (the DB boundary was the known
systematic hole, not the pure logic), but "is there a logic bug the existing tests don't cover" is
unanswered.

## How to run it (fresh chat)
1. Build-preflight → confirm env; reconcile trackers (Rule 0) — same start ritual as any session.
2. Fan out per-package agents (same style as the adapter sweep in
   `live-adapter-backfill-findings.2026-07-07.md`), but targeting `src/*.ts` **excluding** `supabase-store.ts`
   (the pure logic + fakes + orchestration), hunting for logic bugs the unit tests miss: wrong branch
   conditions, off-by-one/boundary errors, precedence mistakes (e.g. most-restrictive-tier), state-machine
   holes, silent-swallow paths, incorrect defaults, spec-vs-code divergences the AC tests don't exercise.
3. Adversarially verify each candidate (independent skeptic) before recording.
4. Triage → fix the confirmed ones with tests; log design forks as ODs (never silently code around them).

## Prerequisite
The session-73 Part-B **adapter** sweep must be wrapped first (it is: all 36 adapters reviewed; fixes +
owed-catalogue in `live-adapter-backfill-findings.2026-07-07.md`). This logic sweep is a separate,
later pass. It is part of clearing the foundation before Stage 5 (the "Layer 3 / logic" coverage the
adapter sweep does not provide).
