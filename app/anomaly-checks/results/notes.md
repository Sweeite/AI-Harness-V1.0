# ISSUE-057 — build notes (anomaly-checks)

## What is proven offline (this package)

All seven §4 ACs are proven against the in-memory reference model (`InMemoryAnomalyStore`), no live DB:

| AC | proven by | teeth |
| --- | --- | --- |
| AC-6.ANM.001.1 | `preStepAnomalyCheck` resolves + writes its row before the side-effect sentinel runs | throws on an already-run side effect (ORDERING VIOLATION); asserts row written pre-side-effect |
| AC-6.ANM.002.1 | each of the five conditions fires exactly its own check | calm obs fires nothing; boundary (19 vs 20, 0.51 vs 0.5) proves the comparator |
| AC-6.ANM.002.2 | contradiction flag tagged `source: 'live_vs_stored'` + carries live/stored values | distinct from the C2 stored-vs-stored queue; no conflicts → no fire |
| AC-6.ANM.003.1 | soft anomaly → pause + `guardrail_log` type `anomaly` (pending, not blocked) + review flag | calm step writes/flags nothing (not unconditional) |
| AC-6.ANM.003.2 | hard-raised anomaly → escalated_at set, action_blocked=true, routed to APR gate | a soft anomaly in the SAME step does NOT escalate (per-anomaly, not global) |
| AC-6.ANM.004.1 | same observation flips fired/not-fired purely by editing the config threshold | no code change; edited config round-trips through the validator |
| AC-6.ANM.005.1 | gate-altering (hard-severity) proposal throws unless admin-confirmed | signal-only proposal applies directly; learning-disabled → no proposals |

`npm test` → all pass. `npm run typecheck` → clean. `npm run check` → offline smoke OK.

## What is OWED to a live / integration session (not fake-passed here)

1. **Live `guardrail_log` writes + append-only trigger** — `supabase-store.ts` (`SupabaseAnomalyStore`)
   is authored to the schema.md §7 DDL but NOT run live. The append-only trigger, the forward-only
   status transition, and the `task_status → 'flagged'` update are proven live at the **ISSUE-011 /
   Stage checkpoint** (the sink owner), not by this slice. Reference model carries the behaviour.

2. **Baseline-proposal persistence** — the live store for FR-6.ANM.005 proposals is the reusable
   learning mechanism (FR-6.OPT.002) owned by **ISSUE-060**. `SupabaseAnomalyStore.recordBaselineProposal`
   / `confirmBaselineProposal` are deliberate **fail-loud stubs** (throw with a pointer), never silent
   (#3). Offline behaviour is fully proven in `InMemoryAnomalyStore`. Live wiring owed at ISSUE-060
   integration.

3. **AF-116 (build-time EVAL, NOT launch-gating)** — the volume/scope/sentiment thresholds have no
   DOCS-provable value (feasibility-register.md Block Q). Per-anomaly precision/recall against a
   labelled set on a runnable deployment is owed before the production accuracy claim; it tunes the
   FR-6.ANM.004 thresholds + FR-6.ANM.005 baselines. Not a blocking spike (not ISSUE-001..006); a DoD
   note. The machinery (detectors + config + baselines) is proven sound offline here; only the
   *accuracy* is EVAL-gated.

## Seam boundaries (what this slice does NOT own)

- **Invocation point** — ISSUE-053 wires `preStepAnomalyCheck` into the run pipeline at C5
  FR-5.ASM.007. This slice provides the callable + the ordering assert (AC-6.ANM.001.1), not the call.
- **Hard-approval gate** — the FR-6.APR.002 path an escalated anomaly enters is ISSUE-056. This slice
  sets `escalated_at` + `action_blocked` and stops at the seam.
- **`guardrail_log` table + silent-failure detector** — ISSUE-011. This slice writes rows, does not
  create the sink.
- **Reusable baseline-learning mechanism + candidate-surfacing UI** — ISSUE-060 (FR-6.OPT.002).

## Config shared-spec proposal

`anomaly_thresholds` structured object shape + the `baseline_learning_enabled` knob are proposed in
`proposed-shared-spec.md`. No edit to schema.md / config-registry.md / PERMISSION_NODES.md / glossary.md.
No migration.
