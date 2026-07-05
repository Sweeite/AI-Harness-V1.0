# ISSUE-055 — live proof owed for AC-NFR-SEC.004.3 (AF-068 red-team)

Everything in ISSUE-055 §4 is proven **offline** against the `InMemoryHardLimitGate` reference model
(`npm test`, one test per AC), **except** the DB-level and running-system proofs below, which are owed
to a live / you-present session. They are recorded here so nothing is silently claimed as verified
(#3 / Rule 0).

## 1. AC-NFR-SEC.004.3 — AF-068 red-team battery against the RUNNING system

- **What the offline test proves (proxy):** `hard-limits.test.ts` → `AC-NFR-SEC.004.3` drives each of the
  seven with a maximally-obedient jailbreak instruction + a relaxing config + Super-Admin role, and asserts
  every one still blocks, plus the fail-closed unknown-recipient edge. This proves the *code gate's*
  decision is un-overridable in isolation.
- **What is still owed:** AC-NFR-SEC.004.3 is defined as the AF-068 **red-team battery executed against the
  running system** (`spec/05-non-functional/security.md` L85) — the full containment harness driving a
  compromised model end-to-end through the real pipeline (gate + approval floor + RBAC-RLS + isolation).
- **Where it is owed:** ISSUE-003 (SPIKE). AF-068 gate is **🟢 PASS against the stub** (2026-07-04,
  evidence `spikes/issue-003-injection-containment/results/af-068-evidence.2026-07-04.md`); per the
  `AC → Verified` rule (`test-strategy.md` §1) AC-NFR-SEC.004.1/.3 reach **Verified** only when the same
  retained battery passes against the **shipped enforcement code** of ISSUE-055/059/020. That re-run is the
  live proof owed here.

## 2. AC-6.HRD.003.2 / AC-6.LOG.001.2 — the DB CHECK + append-only trigger

- **What the offline test proves:** the *application-layer* reject of `status→approved` on a hard_limit row
  (`store.ts` `setStatus`, mirrored in `supabase-store.ts` before it issues SQL).
- **What is still owed:** the **DB-level** reject — the schema `check (not (hard_limit and approved))` and
  the append-only trigger actually refusing an approve / a delete in the live silo. Exercised by
  `results/issue-055-capstone.sql`, run by the operator at the Stage-3 checkpoint after ISSUE-060's
  migration has applied. No migration is owned by ISSUE-055 — it relies on that schema.

## 3. Alert delivery (C7)

- This slice **emits** the `hard_limit_hit` event and **surfaces a dropped alert** out-of-band (proven
  offline: `AC-6.HRD.002.2`). Actual **delivery** (dashboard + admin Slack) is C7 / ISSUE-011 / ISSUE-075
  and is asserted here only as the emit + surfacing requirement, not the delivery mechanism.
