# ISSUE-057 — proposed shared-spec deltas (anomaly_thresholds)

> Rule 0: this slice does **not** edit `spec/04-data-model/schema.md`,
> `spec/00-foundations/**/config-registry.md`, `PERMISSION_NODES.md`, or `glossary.md`.
> Everything the orchestrator needs to fold into the shared registry is proposed here as a file.
> Ground truth for the code is `app/anomaly-checks/src/config.ts`.

## 1. `anomaly_thresholds` — structured config object (schema.md §12 / config registry)

The schema already lists `anomaly_thresholds` as one of the `config_values` structured JSON objects
(schema.md L740). This slice proposes its concrete **shape**. No DDL change — it is a JSON value under
`config_values.key = 'anomaly_thresholds'`. No migration.

### Shape (JSON stored in `config_values.value`)

```jsonc
{
  // one entry per anomaly check (FR-6.ANM.002): confidence, volume, contradiction, scope, sentiment
  "confidence":    { "threshold": 0.5, "comparator": "lte", "severity": "soft" },
  "volume":        { "threshold": 20,  "comparator": "gte", "severity": "soft" },
  "contradiction": { "threshold": 1,   "comparator": "gte", "severity": "soft" },
  "scope":         { "threshold": 2.0, "comparator": "gte", "severity": "soft" },
  "sentiment":     { "threshold": 0.8, "comparator": "gte", "severity": "soft" },

  // FR-6.ANM.005 deployment-wide baseline-learning enable/disable knob
  "baseline_learning_enabled": false
}
```

### Field semantics

| field | meaning | FR |
| --- | --- | --- |
| `<kind>.threshold` | the numeric bar at/over which the check fires; per-deployment editable (starting points, not permanent) | FR-6.ANM.004 |
| `<kind>.comparator` | `lte` (confidence — fires when metric ≤ threshold) or `gte` (the other four — fires when metric ≥ threshold). Fixed per anomaly; not deployment-tunable (a wrong direction would invert a guardrail = #2). Stored so the detector reads a self-describing threshold. | FR-6.ANM.002 |
| `<kind>.severity` | `soft` (default — pause + flag for review) or `hard` (this deployment escalates this check to the FR-6.APR.002 hard-approval gate). Per-anomaly, per-deployment (OD-063). | FR-6.ANM.003 |
| `baseline_learning_enabled` | deployment-wide gate on FR-6.ANM.005 baseline proposal computation | FR-6.ANM.005 |

### Starting-point values (⚠️ AF-116)

`volume` / `scope` / `sentiment` thresholds have **no DOCS-provable value** — they are EVAL-tuned
starting points (feasibility-register.md Block Q, AF-116). The shipped numbers above are provisional
and MUST be tuned by the AF-116 per-anomaly precision/recall EVAL before the accuracy claim is trusted
in production. AF-116 is **not launch-gating** (the machinery is sound; the gate is on accuracy).

### Config-registry entries to add (Phase-2 registry)

- key `anomaly_thresholds` — class NORMAL (not SECRET), RLS group `PERM-config.*`, structured object.
- Validation: `validateAnomalyThresholds` in `app/anomaly-checks/src/config.ts` is the reference
  validator — reject a malformed object loudly (#3), normalise each comparator to the fixed per-anomaly
  direction. An edit takes effect on the next step with no code change (AC-6.ANM.004.1).

## 2. Baseline-proposal store — owed to ISSUE-060 (NOT proposed here)

FR-6.ANM.005 proposals are persisted through the **reusable baseline-learning mechanism (FR-6.OPT.002)
owned by ISSUE-060**. This slice does not create that table. The in-memory reference model
(`InMemoryAnomalyStore.recordBaselineProposal / confirmBaselineProposal`) proves the behaviour offline;
the live pg wiring is deliberately a fail-loud stub in `supabase-store.ts` pending ISSUE-060 integration
(see `notes.md`). No new table proposed here to avoid double-owning ISSUE-060's surface.

## 3. No new permission node

Admin confirmation of a gate-altering baseline change (FR-6.ANM.005) reuses the **C1 RBAC admin gate**
— no ANM-specific PERM node (ISSUE-057 §5 PERM: none new). Nothing to add to `PERMISSION_NODES.md`.

## 4. No migration

This slice writes `guardrail_log` rows (type `anomaly`) and consumes `status` / `escalated_at` — the
append-only sink is owned by **ISSUE-011**. No migration authored. `guardrail_type` already includes
`anomaly` (schema.md L120).
