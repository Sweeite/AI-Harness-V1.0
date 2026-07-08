---
id: ISSUE-058
title: Rate-limit guardrails + cost-ladder enforcement
epic: G — guardrails
status: done
github: "#58"
---

# ISSUE-058 — Rate-limit guardrails + cost-ladder enforcement

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Build the C6 rate-limit guardrail layer — the five configurable-never-unlimited caps with their ownership split and tiered breach response, plus the cost-ladder enforcement (C7 meters → **C6 decides** → C5 executes) — so no deployment can silently over-act or burn unbounded client money overnight.

## 2. Scope — in / out
**In:** The C6 **policy + decision** half of two guardrail classes that share the same soft→throttle→hard-kill ladder shape. (1) **Rate-limit caps (FR-6.RTL.001–003):** C6 frames all five caps (max tool writes/task, max external comms/hour, max memory writes/min, max concurrent tasks/deployment, max retries-to-DLQ) as guardrails that can never be set unlimited (validator rejects unlimited/zero-guard *and* enforces a meaningful finite ceiling per cap); the ownership split that delegates the *counter mechanism* to its home owner while C6 owns the consistent breach response; and the breach ladder that writes a `guardrail_log` row (type `rate_limit`) and routes an irreversible/billed action at cap to halt-and-escalate (never auto-retry). (2) **Cost-ladder enforcement (FR-6.RTL.004):** the C6 decision node that takes C7's per-rung cost signal and directs the disposition — soft (alert only) → throttle (defer/queue non-critical: proactive loops + low-priority tasks) → hard-kill (stop new consequential spend, flag) — with the invariants that a cost rung never overrides a hard limit (FR-6.HRD.\*) and never fires silently (every rung transition writes a `guardrail_log` row).

**Out:** The rate-limit **tracker + tiers + high-risk halt-escalate machinery** in the shared connector runtime — ISSUE-034 (C3 RL); this slice consumes that halt-escalate hook, it does not re-build it. The **cost meter, per-task aggregation, and ladder-signal emission** — ISSUE-074 (C7 COST); this slice consumes the signal, it does not meter. The **run-pipeline execution** of throttle/kill (deferring/queuing/killing work) — ISSUE-053 (C5 ASM); C6 decides, C5 executes. The **memory-write counter** (`rate_limit_memory_writes_per_minute`) → ISSUE-024 (C2 WRT); **concurrent-tasks + retries-to-DLQ counters** → ISSUE-048/052 (C5 QUE/JOB). The **hard-limit gate** (FR-6.HRD.\*) → ISSUE-055; this slice only asserts the cost rung never relaxes it. Alert **delivery**, the **guardrail_log dashboard/export view**, and the ops **cost dashboard** → C7 (ISSUE-075/077/078). Config-key **registry + admin surface** → ISSUE-010/086.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-6.RTL.001, FR-6.RTL.002, FR-6.RTL.003, FR-6.RTL.004 (Component 6 — Guardrails).
- **NFRs:** NFR-COST.001 (four-rung ladder), NFR-COST.002 (throttle action), NFR-COST.003 (hard-ceiling action), NFR-COST.004 (decide/execute split), NFR-COST.007 (controls-before-gates precedence), NFR-SEC.005 (coverage-gap posture — the rate caps are the "gate, don't promote" mechanism for dangerous-action coverage extensions).
- **Rests on:** ADR-003 (cost ladder = a guardrail class; the soft→throttle→hard-kill rungs + defaults; controls-before-gates), ADR-007 (containment-first — a guardrail is code, never config-overridable; irreversible/billed at cap → halt-escalate), ADR-001 (client-borne opex → the unbounded-spend guarantee this closes; `client_slug` on `guardrail_log` is label-only, not an RLS key); OD-062 (rate-limit ownership split), OD-068 (cost-ladder decide/execute ownership).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-6.RTL.001.1, AC-6.RTL.001.2
- AC-6.RTL.002.1
- AC-6.RTL.003.1, AC-6.RTL.003.2
- AC-6.RTL.004.1, AC-6.RTL.004.2, AC-6.RTL.004.3
- AC-NFR-COST.001.1, AC-NFR-COST.001.2
- AC-NFR-COST.002.1, AC-NFR-COST.002.2
- AC-NFR-COST.003.1, AC-NFR-COST.003.2
- AC-NFR-COST.004.1, AC-NFR-COST.004.2
- AC-NFR-COST.007.1, AC-NFR-COST.007.2
- AC-NFR-SEC.005.1
- **Gating spikes (if any):** **AF-001** (cost-viability spike, ISSUE-001) must be **GREEN** before this issue ships — per the backlog "Gate" column (`ladder → 001(spike)`) and the spike sequencing note (`001 (cost) → 058, 074`). AF-001 (SPIKE+EVAL, feasibility-register.md §C) proves the ADR-003 viability target (typical volume ≤ ~$20/day, under the $50 soft alert) so the ladder's default thresholds are anchored to a measured reality, not a guess. The ladder *mechanism* is blocking-by-posture (locked ADR); the threshold-realism half (AF-040/041) is fast-follow behind the fail-safe round-up + this ladder.

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-guardrail_log (write rows of type `rate_limit` on every cap breach and every cost-ladder rung transition; append-only, `status` starts `pending`; `guardrail_type='hard_limit'` cannot go `approved` — CHECK exists but is a HRD concern, not this slice; `client_slug` label-only). No new table — `guardrail_log` is created by ISSUE-060 (C6 LOG); this slice is a producer.
- **PERM:** none new — the cap/threshold config edits are gated by the C1-homed config-management permission (see ISSUE-010/086); C6 decision logic runs on the `service_role` agent path (no per-action RLS gate — enforcement is code, ADR-007).
- **CFG:** CFG-rate_limit_memory_writes_per_minute (30; C2-owned counter, C6-framed cap), CFG-cost_ladder_soft_threshold_daily_usd (50), CFG-cost_ladder_soft_threshold_weekly_usd (200), CFG-cost_ladder_throttle_threshold (75/day), CFG-cost_ladder_hard_kill_threshold (100/day), plus the per-cap meaningful-finite-ceiling upper bounds for the five rate caps (AC-6.RTL.001.1 L2 refinement; registered in the config registry, ISSUE-010). (Key names per ADR-003 §2/§3 OD-164 reconciliation + `cost.md`; the counter-owning caps for concurrent-tasks/retries live with C5.)
- **UI:** none in this slice — C6 *decides*; the guardrail_log/cost-dashboard rendering + alert delivery are C7 (ISSUE-075/077/078), the config-admin surface is ISSUE-086.
- **Connectors:** none instantiated here — the tool-writes/external-comms caps consume C3's connector rate-limit tracker (ISSUE-034); no connector logic is built in this slice.

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-06-guardrails.md — the RTL FR text + ACs (FR-6.RTL.001–004); also the OD-062/OD-068 resolutions and the FMM no-silent-failure invariant this slice honours.
- spec/04-data-model/schema.md §7 (Guardrails) — the `guardrail_log` DDL + the `guardrail_type`/`guardrail_status` enums (`rate_limit` is the type this slice writes).
- spec/05-non-functional/cost.md — NFR-COST.001–004/007 (the ladder rungs, throttle/hard-kill actions, decide/execute split, controls-before-gates precedence) and their AC-NFR-COST IDs.
- spec/05-non-functional/security.md §NFR-SEC.005 — the coverage-gap "gate, don't promote" posture the rate caps implement.
- spec/00-foundations/adr/ADR-003-cost-model.md — §2 (cost ladder rungs + critical/never-killed set), §3 (fail-safe token estimate), §6 (controls before gates), §7 (viability target / lever order).
- spec/00-foundations/adr/ADR-007-injection-posture.md — containment-first (a guardrail is code, never config-overridable; irreversible/billed at cap halts-and-escalates).

## 7. Dependencies
- **Blocked-by:**
  - ISSUE-034 (C3 rate-limit tracker + 80/95/429 tiers + high-risk halt-escalate) — this slice's breach response consumes the halt-and-escalate hook C3 raises (FR-6.RTL.003 → C3 AC-3.RL.006.2) and frames C3's connector-side caps (tool-writes/task, external-comms/hour). Not a spike.
  - ISSUE-074 (C7 cost meter + per-task aggregation + ladder signal) — this slice's FR-6.RTL.004 decision node is triggered by C7's per-rung cost signal (FR-7.COST.003); no signal, nothing to decide on. Not a spike.
  - ISSUE-001 (**SPIKE** — cost viability ≤ ~$20/day typical) — **AF-001 must be GREEN** before ship (see field 4). This is the launch-gating spike from OD-157/RP-1.
- **Blocks:** none (leaf).

## 8. Build order within the slice
1. **Rate-cap policy + config validation:** define the five caps as a policy set and wire the config validator that (a) rejects unlimited/zero-guard and (b) enforces a per-cap meaningful-finite-ceiling upper bound (FR-6.RTL.001; AC-6.RTL.001.1). No counters are implemented here — record which owner holds each counter (memory→C2, concurrency/retries→C5, tool/comms→C3).
2. **Ownership-split breach contract:** implement the single, consistent C6 breach response that any home-owner's counter calls when its cap breaches, so the response does not diverge per owner (FR-6.RTL.002; AC-6.RTL.002.1). This is the seam every counter reports into.
3. **Rate-breach ladder + halt-escalate:** on breach, write a `guardrail_log` row (type `rate_limit`) and apply the soft-alert → throttle-non-critical → hard-stop ladder; route any irreversible/billed action at its cap to halt-and-escalate (consume C3's ISSUE-034 hook), excluded from auto-retry (FR-6.RTL.003; AC-6.RTL.001.2/003.1/003.2).
4. **Cost-ladder decision node:** subscribe to C7's per-rung cost signal (ISSUE-074, FR-7.COST.003) and implement the C6 decision for each rung — soft → alert only; throttle → direct C5 to defer/queue non-critical work (proactive loops + low-priority first, user-facing/urgent untouched, critical-in-flight escalates rather than being dropped); hard-kill → stop new consequential spend + flag, irreversible/billed at rung halts-and-escalates (FR-6.RTL.004; AC-6.RTL.004.1/.2/.3 + AC-NFR-COST.001/002/003).
5. **Invariant guards (fail-loud, never-relax):** assert every rung transition and every cap breach writes a `guardrail_log` row (never silent, #3) and that no cost rung path can override or relax a hard limit (FR-6.HRD.\*; AC-6.RTL.004.3, AC-NFR-COST.003.2). Assert the decide/execute boundary: C6 emits a disposition, C5 executes it — C6 never itself throttles/kills the run (AC-NFR-COST.004.1/.2).
6. **Coverage-gap wiring:** confirm a new dangerous action outside the seven hard limits is routed to a hard-approval tier and/or a rate cap (the "gate, don't promote" path — NFR-SEC.005 / FR-6.HRD.004 seam), not silently auto-allowed (AC-NFR-SEC.005.1).
7. **Tests to the ACs:** synthetic spend series crossing each ladder rung fires exactly that rung's disposition with no rung skipped/silent; each of the five caps rejects unlimited + enforces its ceiling; an irreversible/billed action at cap halts-and-escalates and is excluded from auto-retry; a hard-kill never touches a hard limit; controls-before-gates lever order + "exactly one cost model-gate" invariant hold (the field-4 AC list).

## 9. Verification (how DoD is proven)
- Per spec/05-non-functional/test-strategy.md: integration tests driving a stubbed C7 cost signal through each rung (soft/throttle/hard-kill) and asserting the C6 disposition + the `guardrail_log` `rate_limit`-class row (AC-NFR-COST.001.2/002.1/003.2); unit/property tests that the config validator rejects unlimited/zero-guard *and* an absurd-but-finite ceiling for each of the five caps (AC-6.RTL.001.1); a test that an irreversible/billed action at cap halts-and-escalates and is never placed on auto-retry (AC-6.RTL.003.2); and a decide/execute boundary test proving C6 emits a disposition C5 acts on while C6 never itself throttles/kills (AC-NFR-COST.004.1).
- **AC-NFR-* postures owned here:** AC-NFR-COST.001–004/007 and AC-NFR-SEC.005.1 reach `Verified` via the build-time tests above (a synthetic spend series + a config-validation battery + a coverage-gap route test); the "never fail silently" (#3) invariant is proven by asserting every rung transition and cap breach writes a loud `guardrail_log` row, and the "never relaxes a hard limit" (#2) invariant by asserting no cost-rung path can mark or bypass a `hard_limit`.
- **Gate:** the ladder mechanism is blocking-by-posture (locked ADR-003) and ships at launch; **AF-001 (ISSUE-001) must be GREEN** to anchor the default thresholds; AF-040/041 (threshold realism) are fast-follow behind the fail-safe round-up + this ladder (feasibility-register.md §C / cost.md launch-gate notes).

---
## §10 Evidence — built + closed (session 77, 2026-07-08)
- **Built** via the Stage-5 offline-batch fan-out (`app/rate-cost-ladder/`): 30/30 offline AC tests green + typecheck clean + `check` non-drift guard.
- **Adversarially verified** (independent zero-context agent); findings fixed **regression-test-first, fail-safe** (see [[OD-198]] for the batch-close forks; all fail-safe-shipped).
- **R10 live-adapter smoke GREEN** against the real silo — `app/rate-cost-ladder/results/live-smoke.sql` (rolled back). Proves the adapter's real SQL/casts/constraints vs the 0001+delta DDL (the fake-passes-offline / live-diverges class).
- **status: ready → done.** GitHub closed. Full narrative + evidence: `spec/SESSION-LOG.md` (Session 77).
