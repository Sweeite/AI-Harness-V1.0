# ISSUE-036 (tool-optimisation) — proposed shared-spec deltas

The orchestrator applies these SERIALLY after the fan-out. ISSUE-036 authored NOTHING in any shared
file (no schema.md, no migration, no config-registry, no PERMISSION_NODES). This slice adds NO table of
its own (issue §5 DATA): the run cache is ephemeral, the confidence-gate reads `tools` + a CFG knob, and
the graceful-degradation gap is a structured field on the task result (result schema owned by C5/C7).

The ONE additive delta OPT needs is on the `event_type` enum, because OPT owes two observability
emissions to `event_log` (issue §8 step 5) and the baseline enum admits neither value.

---

## DELTA 1 (REQUIRED, additive enum) — two OPT event_type values on `event_log`

**File:** `app/silo/migrations/000X_*.sql` (a NEW additive migration; do NOT edit `0001_baseline.sql`).
**What:** add two values to the existing `event_type` enum (baseline `0001_baseline.sql` L60-65):

```sql
-- ISSUE-036 (FR-3.OPT.001 / FR-3.OPT.004): the two Tool-Optimisation observability events. The baseline
-- event_type enum admits neither; both FRs mandate an event_log write (never-silent, #3), so the enum
-- must admit them. Additive / expand-contract-safe (same pattern as OD-170's authz_revoked_midtask add).
alter type event_type add value if not exists 'tool_selection_ask';   -- FR-3.OPT.001 below-threshold ask
alter type event_type add value if not exists 'tool_unavailable';     -- FR-3.OPT.004 missing-tool gap
```

**Why:**
- `tool_selection_ask` — the below-`CFG-tool_selection_confidence_threshold` ASK event (FR-3.OPT.001 /
  AC-3.OPT.001.1). The avoided-wrong-call must be LOGGED, never silent (#3).
- `tool_unavailable` — the missing-tool gap event (FR-3.OPT.004 / AC-3.OPT.004.1). A degraded task must
  LOG the gap it flagged, never silent (#3 at the tool grain; ADR-007 containment-first).

**Exact strings** are pinned in `src/store.ts` (`OPT_EVENT_TYPES`) and enforced by BOTH the in-memory
fake (`src/fake.ts`) and the live adapter (`src/supabase-store.ts`) — a value outside the set fails
closed in both, so the offline proof and the live INSERT agree.

**Fail-closed note (important):** until this delta is applied, the live `SupabaseOptEventSink.append()`
INSERT raises `invalid input value for enum event_type` — which is the CORRECT behaviour: it never
silently drops the ask/gap event. The offline suite (InMemoryOptEventSink) fully proves the emission
contract now; the live INSERT is owed at the Stage-4 checkpoint AFTER this delta lands.

**Note also (doc reconciliation, non-blocking):** the OD-170 comment block in `0001_baseline.sql`
L66-69 lists the last additive `event_type` values; when this delta lands, extend that comment (or the
new migration's header) to record these two OPT values in the same expand-contract-safe lineage, so the
enum's change history stays complete (Rule 0).

---

## VERIFY-PRESENT (believed already present — orchestrator confirms, does NOT re-add)

1. **`event_log` table + append-only trigger** — `0001_baseline.sql` L483-496 (columns `task_id`,
   `event_type`, `summary` NOT NULL, `payload` jsonb, `created_at`) + `t_append_only` L707. The OPT
   adapter INSERTs only; verify-present.
2. **`CFG-tool_selection_confidence_threshold`** — `spec/02-config/config-registry.md` L159 (float 0–1,
   LIVE, default 0.7). OPT CONSUMES it (`DEFAULT_OPT_CONFIG`), does not define it. Verify-present.
3. **`tools` table + read/write `category` branch** — `0001_baseline.sql` (tools) + the ISSUE-032
   `ToolCategory` / read-write dispatch. OPT's cache write-exclusion keys off this category. Verify-present.
4. **`idempotency_ledger`** — `0001_baseline.sql` L350-355. OPT does not write it; it is the ADR-004
   write-side guard that PAIRS with never-cache-writes (issue Integration note). Verify-present only.

## Per-connector batch-size limit (NOT a shared-spec delta)

The per-connector batch limit (FR-3.OPT.003; Gmail per-API ≤50 — google-gmail.md §4) is a PER-CONNECTOR
PARAMETER supplied by the connector instances (ISSUE-039/040/041) as a `BatchCapability`, not a global
config key. No shared-spec change is needed for it here.
