# Stage-5 Readiness — Handover (from session 73 → next chat)

> **Purpose.** A self-contained checklist of everything still owed before the **foundation is cleared for
> Stage 5**. Written for a fresh chat with zero conversation context — act from this doc + the repo alone.
> **Read the top `spec/SESSION-LOG.md` (Session 73) entry first** for the full narrative; this is the actionable
> to-do distilled from it.

## Where things stand (session 73 outcome)
Session 73 ran a whole-repo hygiene + bug check, then the **R10 Part-B live-adapter sweep in full — all 36
silo adapters reviewed against the live DB**. Silo migration head is now **`0026`** (next free tag `0027`).

- **13 bugs fixed + live-verified** (migrations `0024`/`0025`/`0026`, plus code fixes in observability,
  log-retention, invite-seed, hard-limits, and the migration linter).
- **OD-191/192/193/194 all RESOLVED** (decisions made; *implementation* is downstream — see below).
- **12 adapters clean**; the session-72-reviewed set is holding up.
- Full evidence: **`spec/00-foundations/standards/live-adapter-backfill-findings.2026-07-07.md`**.

**The foundation is NOT yet cleared for Stage 5.** The items below are what remains. None is a hidden bug —
each is written down and actionable.

---

## Definition of "foundation cleared for Stage 5"
All of A–E below are done **and** the three non-negotiables re-checked (#1 never lose/corrupt knowledge ·
#2 never do what it shouldn't · #3 never fail silently). Only then open Stage-5 build work (R1).

---

## A. Resolved-OD implementation (the decisions are made — do the work)

1. **OD-194 — approval-tiers: wire the uuid id-resolution.** *(Biggest item; needs a design input.)*
   The adapter binds string action-names / reviewer-identities into `uuid`/FK columns → every
   `tierAndGate`/`raiseFlag`/`resolve` throws `22P02` (non-functional live). **Do:** thread the real
   `task_queue.id` + reviewer `profiles.id` (uuids) into those writes instead of the names.
   **First pin the caller contract:** where do the `task_queue.id` and reviewer `profiles.id` come from at
   gate time? (This is the C6 wiring — confirm the owner/issue before coding.) Ref: OD-194, findings doc
   (approval-tiers B2 + resolve).
2. **OD-192 — invite-seed lifecycle on the `profiles` row.** Implement `revokeInvite`/`reissueInvite`/
   `resendInvite`/`markBounced` against the pending-`profiles` row (revoke = deactivate + audit, etc.) — no
   new table. **Immediate sub-fix meanwhile:** they currently delegate to an empty in-memory fake (silent
   wrong result); make them operate on `profiles` or throw not-implemented — never silently-wrong (#3).
   Ref: OD-192.
3. **OD-191 — approval-queue `buildQueueView` fail-loud.** The C6 queue surface is deferred, but the method
   currently returns a silently-empty queue (#3). Make it **throw** a loud "decoration persistence owed
   (OD-191)" error until the surface + its decoration-persistence delta are built. Ref: OD-191.
4. **OD-193 — doc-only.** Ratified `postgres`/owner as the adapter runtime role. Correct ADR-006 + the
   misleading "service_role" comments across the silo adapters to say owner/RLS-bypass (so a future
   RLS-grant audit isn't misled). No migration/reconnect. Ref: OD-193.

## B. Owed code / integration bugs
5. **rate-limiting M4 (`drainDue`)** — marks rows drained + commits before the caller fires → a crash drops
   the deferred call (#1/#3). No safe self-contained fix exists (assessed session 73): needs a
   `fired_at`/status column (migration) + a re-drive sweeper + the **unbuilt** consumer's confirm contract.
   Owed to that consumer integration. A ⚠️ OWED comment marks the code site. Ref: findings doc M4.
6. **prompt-optimisation + triggers — missing tables.** `prompt_version_attribution` / `task_outcome`
   (prompt-optimisation) and `trigger_delivery` (triggers) exist in **no migration** — owned by
   **ISSUE-049 / ISSUE-053**. Those adapters are non-functional live until those issues land the tables.
   Verify ownership + land the tables (or confirm the sequencing). Ref: findings doc M12 + triggers.

## C. Test/hygiene polish
7. **Polish the 10 authoring-defect live-smokes.** 12 of the 22 sweep smokes pass; 10 have authoring defects
   (syntax `:` / `max(uuid)`, missing parent-row setup) — NOT adapter bugs. Fix each so every package's
   `results/live-smoke.sql` runs green against the silo (rolled back). List: prompt-store, hard-limits,
   triggers, rbac, alerting, retention, anomaly-checks, injection-pipeline, prompt-layer-identity, release.
8. **~30 MINORs** across packages (stale service_role comments per OD-193, non-transactional audit-after-write
   edges, missing-id silent no-ops, `select *` coupling). Triage; fix the #3-adjacent ones.

## D. Cross-component integration (Layer 3)
9. **One live cross-component integration pass.** The per-adapter smokes prove each piece works against the
   schema in isolation; they do NOT prove the *seams* work together live (orchestrator→task_queue→
   guardrail_log→alerting, etc.). Run a deliberate live integration check of the key Stage-0–4 seams before
   building Stage 5 on top. (This is "Layer 3" in the SESSION-LOG; the adapter sweep is Layer 1.)

## E. Tracker reconciliation (Rule 0 — do at session start)
10. **The 6 stale-`blocked` issues** (`020`/`052`/`058`/`062`/`065`/`068`) have all their §7 blockers `done`
    → by the written rule they are `ready`, but the frontmatter + `BUILD-SCHEDULE.md:263` still say blocked
    ("blocked on undone deps" is factually wrong for them; only `064` is correctly blocked, on `052`).
    **Decide:** flip the 6 → `ready`, OR record an explicit "hold until gate `022` closes" convention. Then
    reconcile every tracker (frontmatter · BUILD-SCHEDULE boxes · `_backlog` · GitHub). Ref: SESSION-LOG S73.

---

## Parallel track (NOT a Stage-5-readiness blocker, but queued)
- **Adversarial LOGIC-bug sweep** of the non-adapter business logic — a separate fresh-chat effort. Full plan:
  **`spec/00-foundations/standards/logic-bug-sweep-plan.md`**. Session 73 covered the DB-adapter boundary
  only; the pure business logic beyond its 767 green tests was not re-hunted.

## Start-of-session ritual (every chat)
`bash scripts/build-preflight.sh` → confirm env (💻 FULL needed for any live step) → reconcile trackers
(item 10) → then pick work. Live steps (migrations, smokes) need the Mac + `source ~/.ai-harness-secrets.env`;
silo DB is `$SILO_DB_URL`, mgmt is `$MGMT_DB_URL`, psql at `/opt/homebrew/opt/libpq/bin/psql`.
