---
id: ISSUE-027
title: Memory maintenance lifecycle — decay / merge / supersede / expiry / erosion
epic: C — memory
status: blocked
github: "#27"
---

# ISSUE-027 — Memory maintenance lifecycle — decay / merge / supersede / expiry / erosion

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Build the scheduled + on-signal maintenance jobs that keep the business brain healthy over time — confidence lifecycle & daily soft-decay, amber/bulk-drop alerts, hard expiry, weekly merge / summarise, the daily supersede safety-net, coverage / structural / relevance erosion scans, embedding-cache validation, the feedback loop, and the cadence scheduler that logs every run and never fails silently.

## 2. Scope — in / out
**In:** The autonomous, non-destructive lifecycle machinery that runs *over* the already-written memory graph (ISSUE-022 schema, ISSUE-024 write path) on real-time / daily / weekly / monthly cadences:
- **Confidence lifecycle** (up/down/freeze signal deltas + never-decay-`human_verified`) and the **daily soft-decay** job that drifts stale low-confidence rows toward the floor and never deletes (MNT.001, MNT.002).
- **Amber-zone + bulk-drop alerts** fired before a memory falls below the retrieval floor, and on a burst of drops (MNT.003).
- **Hard expiry** — writer-set `expires_at`, excluded (not deleted) at retrieval (MNT.004).
- **Weekly merge** (collapse ≥ threshold-similar rows; supersede rather than merge for far-apart pairs, skip/queue Personal) and **weekly summarise** (episodic→semantic with the retained evidence layer) (MNT.005, MNT.007).
- **Daily supersede safety-net** that catches contradictions the write-time check missed, via the traceable `superseded_by` chain (MNT.006).
- **Erosion scans:** daily **coverage** (per-entity staleness), weekly **structural** (orphans, over-long chains, missed duplicate clusters, null/invalid embeddings, stuck ingestion-queue items), monthly + on-use **relevance** (live-data cross-check + review window) (MNT.009, MNT.010, MNT.011).
- **Embedding-cache validation** (monthly, don't re-embed unchanged content) (MNT.013).
- **The maintenance scheduler** running all cadences with a per-run log (time/outcome/records-affected), loud-on-failure, plus the completion-rate metric and the weekly Haiku-gate sampled-drop audit run-record (MNT.015).
- **The feedback loop** — usage/human-correction confidence signals logged with who/when/why, human direct-writes at 1.0 via the sole writer (MNT.016).

**Out:**
- **Conflict resolution + Personal-consolidation approval** — the hard-conflict quarantine/consolidation *review workflow*, `memory_conflicts` / `consolidation_approvals` tables, the conflict-resolution priority rules (MNT.008) and the never-auto-consolidate-Personal gate (MNT.014, WRT.002) — owned by **ISSUE-028**. This slice's merge/summarise jobs must **skip/queue Personal-tier candidates and route hard conflicts** to that workflow but do not build it.
- **Compliance erasure** — the transitive hard-delete walk (MNT.017) — owned by **ISSUE-029**. Erasure is the deliberate destructive exception to this slice's "decay never deletes" invariant.
- **Cold storage** (MNT.012) — **v2-DEFERRED (OOS-016 / OD-034)**; not built in v1. Do not implement.
- **The write path itself** (contradiction check, confidence *initial* assignment, validate-and-commit, embedding-failure halt) — ISSUE-024 (C2 WRT); this slice consumes its outputs and the `superseded_by`/`confidence`/`expires_at` columns it populates.
- **The `event_log` sink, the alert engine, the scheduler runtime (loops/watchdog) and the silent-failure/producer-liveness detectors** — owned by ISSUE-011 (C7 observability skeleton); this slice *emits into* them (job-run records, amber/bulk/coverage alerts) but does not build them.
- **The live-tool-data fetch** behind relevance cross-check (MNT.011) — C3 Tool Layer seam (ISSUE-039/040/041); this slice consumes the fetched authoritative record.
- **Maturity recompute** (MNT.002-adjacent `entities.maturity`) — ISSUE-030 (C2 MAT); the coverage-erosion scan reads staleness, it does not compute Maturity.
- **The memory-health dashboard rendering** of these flags/queues — ISSUE-031 (surface-11); this slice produces the flags/maintenance tasks it renders.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-2.MNT.001, FR-2.MNT.002, FR-2.MNT.003, FR-2.MNT.004, FR-2.MNT.005, FR-2.MNT.006, FR-2.MNT.007, FR-2.MNT.009, FR-2.MNT.010, FR-2.MNT.011, FR-2.MNT.013, FR-2.MNT.015, FR-2.MNT.016 (all component-02-memory)
- **NFRs:** NFR-OBS.005 (metric-producer liveness — a maintenance producer that stops running reads stale, never green), NFR-DR.008 (append-only audit sinks as a knowledge-durability layer — decay/merge/supersede are non-destructive; loss is never total)
- **Rests on:** ADR-002 (Maturity/Retrieval Sufficiency — coverage erosion + summarise cadence lean on the metric), ADR-003 (cost shape — embedding-cache validation + merge/summarise Sonnet/embedding spend), ADR-004 (concurrency — merge/supersede jobs mutate via CAS `superseded_by` on the sole-writer path), ADR-008 (backups — decay-never-deletes + the append-only durability layer), AF-002 (retrieval relevance — the erosion/decay tuning shares its corpus), AF-019 (HNSW recall under RLS — the merge/embedding-cache jobs must not degrade the hot index)

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-2.MNT.001.1, AC-2.MNT.001.2
- AC-2.MNT.002.1
- AC-2.MNT.003.1, AC-2.MNT.003.2
- AC-2.MNT.004.1
- AC-2.MNT.005.1, AC-2.MNT.005.2
- AC-2.MNT.006.1
- AC-2.MNT.007.1
- AC-2.MNT.009.1
- AC-2.MNT.010.1, AC-2.MNT.010.2, AC-2.MNT.010.3
- AC-2.MNT.011.1
- AC-2.MNT.013.1
- AC-2.MNT.015.1, AC-2.MNT.015.2, AC-2.MNT.015.3
- AC-2.MNT.016.1
- AC-NFR-OBS.005.* , AC-NFR-DR.008.1 (postures held by this slice's producers/jobs)
- **Gating spikes (if any):** none launch-gating (spikes ISSUE-001–006 do not gate this slice). Build-time feasibility: AF-002 (retrieval relevance/ranking corpus, EVAL) and AF-019 (HNSW recall under RLS, LOAD) inform decay/merge/erosion tuning — tracked in `feasibility-register.md`, not ship-blockers for the job logic.

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-memories (reads + non-destructive mutations: `confidence`, `superseded_by` (CAS chain), `expires_at`, `embedding`/`embedding_v2`/`embedding_model`, `content_hash`; merge/summarise create new rows), DATA-entities (coverage-erosion staleness read; structural orphan/duplicate scan), DATA-ingestion_queue (structural scan reads stuck items — MNT.010; created by ISSUE-026) — schema §3 Memory. Emits job-run + confidence-change + alert records into `event_log` (C7 sink, ISSUE-011).
- **PERM:** none created here (maintenance jobs run as `service_role`; human direct-writes in the feedback loop are gated by `PERM-memory.write`, homed in C1 and enforced via the ISSUE-024 sole-writer path).
- **CFG:** CFG-soft_decay_age_months (6), CFG-soft_decay_multiplier (0.95), CFG-confidence_floor (0.5), CFG-amber_zone_threshold (0.75), CFG-bulk_drop_alert_count (10), CFG-bulk_drop_alert_window_minutes (60), CFG-merge_similarity_threshold (0.92), CFG-summarise_episode_trigger (10), CFG-coverage_stale_window_days (30), CFG-relevance_review_window_days (30) — all LIVE, `config_values` per schema §12. (Structural chain-length threshold + maintenance cadence schedules are Phase-2 keys; `CFG-review_escalation_days` is consumed for the stuck-queue escalation in MNT.010 but homed/owned by ISSUE-026.)
- **UI:** none built here (the memory-health dashboard — job-run log, completion-rate, amber/coverage/structural flags — is surface-11, ISSUE-031; this slice produces the flags/tasks it renders).
- **Connectors:** none directly; the relevance cross-check (MNT.011) consumes a C3 live-data fetch (GHL/Google/Slack) via the ISSUE-039/040/041 seam.

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-02-memory.md — the FR text + ACs for the MNT area (lifecycle subset: MNT.001–007, 009–011, 013, 015, 016), plus its Context Manifest table + Doc-reconciliation notes; note the MNT.008/014/017 out-of-scope siblings and the MNT.012 v2 deferral
- spec/04-data-model/schema.md §3 Memory — the `memories` / `entities` / `ingestion_queue` DDL (the `confidence`, `superseded_by` CAS chain, `expires_at`, `content_hash`, embedding columns these jobs mutate), plus §12 `config_values` for the LIVE decay/merge/erosion keys and §8 Observability for the `event_log` append-only sink the job-run log writes to
- spec/05-non-functional/observability.md §NFR-OBS.005 — metric-producer liveness (stale-never-green) posture + AC the maintenance producers must satisfy
- spec/05-non-functional/backup-dr.md §NFR-DR.008 — the append-only / decay-never-deletes durability posture + AC
- spec/00-foundations/adr/ADR-002-coverage-metric.md — the Maturity/Retrieval-Sufficiency metric the coverage-erosion + summarise cadences lean on
- spec/00-foundations/adr/ADR-004-concurrency-model.md — the sole-writer + CAS-supersede (`WHERE superseded_by IS NULL`) + per-entity concurrency the merge/supersede jobs mutate through
- spec/00-foundations/adr/ADR-003-cost-model.md — the write/embedding cost shape governing merge/summarise Sonnet spend + embedding-cache validation
- spec/00-foundations/adr/ADR-008-backup-dr.md — decay-never-deletes as a durability layer + the backup relationship

## 7. Dependencies
- **Blocked-by:** ISSUE-024 (Memory write / sole-writer path — the confidence *initial* assignment, contradiction/supersede primitives, and the `service_role` write path all maintenance mutations flow through; not a spike). Transitively assumes ISSUE-022 (schema) and ISSUE-011 (observability skeleton — the `event_log` sink + scheduler + alert path these jobs emit into).
- **Blocks:** ISSUE-031 (Memory navigation surface — surface-11 renders the maintenance flags, job-run log, completion-rate, and erosion tasks this slice produces).

## 8. Build order within the slice
1. **Config keys** — register the ten LIVE decay/merge/erosion keys in `config_values` (§12) with their defaults (§5 above); classify per the config-edit taxonomy. These parameterise every job below.
2. **Confidence lifecycle engine** (MNT.001) — the signal→delta table (verify/use/corroborate up; decay/flag/contradiction/poor-outcome down), the `[floor, 1.0]` clamp, the freeze rules (active-review + never-decay `human_verified`). Every confidence change writes a cause-tagged record (feeds MNT.016 log). Mutations go through the ISSUE-024 sole-writer path.
3. **Feedback loop** (MNT.016) — wire retrieval-outcome + human-action signals into the confidence engine; log who/when/why; human direct-writes enter at 1.0 / `human_verified` via the sole writer. (Shares the confidence-change log with step 2.)
4. **Daily soft-decay job** (MNT.002) — age + confidence + no-newer-confirming predicate → `× soft_decay_multiplier` toward `confidence_floor`; never delete; never touch `human_verified`. Emits a run record.
5. **Amber + bulk-drop alerts** (MNT.003) — threshold-cross flag (fires above the 0.7 retrieval floor at 0.75) + burst detector (`> bulk_drop_alert_count` within the window) → alerts into the C7 sink.
6. **Hard expiry** (MNT.004) — the maintenance side is the retrieval-time exclusion contract for passed `expires_at` (the writer sets it in ISSUE-024; retrieval enforces in ISSUE-025); excluded, not deleted.
7. **Daily supersede safety-net** (MNT.006) — catch write-time-missed contradictions; CAS-supersede via `superseded_by` (`WHERE superseded_by IS NULL`, ADR-004); a hard conflict it finds routes to the ISSUE-028 quarantine, never auto-resolves.
8. **Weekly merge job** (MNT.005) — collapse `≥ merge_similarity_threshold` same-entity/same-tier rows into one richer row (evidence preserved); supersede (not merge) > 3-months-apart pairs; **skip/queue Personal-tier** candidates to ISSUE-028; never merge across entities or tiers.
9. **Weekly summarise job** (MNT.007) — for entities with `≥ summarise_episode_trigger` new episodics, emit one semantic memory referencing the cluster; **retain the episodic evidence layer (never delete/supersede)**; skip/queue Personal.
10. **Daily coverage erosion** (MNT.009) — per-entity `no new memory within coverage_stale_window_days` → stale flag (ties into Maturity read from ISSUE-030).
11. **Weekly structural erosion** (MNT.010) — scan orphans, over-long supersede chains, missed duplicate clusters (→ merge path), **null/invalid-embedding rows** (→ re-embed, the sole detector for these), and **stuck ingestion-queue items** past `CFG-review_escalation_days` (→ escalate); each finding → a dashboard maintenance task.
12. **Relevance erosion** (MNT.011) — on-use live-data cross-check (contradiction → immediate soft-conflict flag via WRT.002 path; confirmation → +confidence) through the C3 seam, plus the monthly not-retrieved-or-confirmed sweep → relevance-review flag.
13. **Embedding-cache validation** (MNT.013, monthly) — re-embed only on `content_hash` change; skip unchanged. (Model-change re-embedding is ISSUE-023's FR-2.VEC.003 migration, not this job.)
14. **The maintenance scheduler + run log** (MNT.015) — register every job on its cadence (real-time / daily / weekly / monthly) via the ISSUE-011 scheduler; each run writes a time/outcome/records-affected record; failures alert loudly (never swallowed); expose the completion-rate metric; log the weekly Haiku-gate sampled-drop audit run-record even on a zero-drop week (AC-2.MNT.015.3). Producer liveness per NFR-OBS.005 — a job that stops reads stale, never green.
15. **Tests to the AC** — unit + job-integration tests for every AC in §4 (e.g. decay-math + never-delete + freeze-`human_verified`, amber-before-floor + bulk burst, CAS-supersede chain intact, merge-collapse + Personal-skip, summarise-with-retained-evidence, structural null-embedding + stuck-queue surfacing, relevance on-use flag, embedding-cache skip-unchanged, run-logged-and-loud-on-failure).

## 9. Verification (how DoD is proven)
- **Unit tests** (per `spec/05-non-functional/test-strategy.md`): the confidence-delta math + clamp + freeze rules (MNT.001), the decay multiplier + never-delete + never-decay-`human_verified` (MNT.002), the amber-before-0.7-floor + bulk-window trigger (MNT.003), the merge similarity/tier/entity guards + Personal-skip (MNT.005), the summarise trigger + evidence-retention (MNT.007), the embedding-cache `content_hash` skip (MNT.013).
- **Job-integration / DB tests:** the daily supersede safety-net produces an intact `superseded_by` chain via CAS (MNT.006 / AC-2.MNT.006.1); the structural scan surfaces orphans, null/invalid embeddings, and stuck-queue items (MNT.010 / AC-2.MNT.010.1–.3); coverage staleness flag (MNT.009); relevance on-use contradiction → immediate soft-conflict flag through the WRT.002 path (MNT.011 / AC-2.MNT.011.1).
- **Scheduler / observability tests** (NFR-OBS.005): every job run emits a run record (AC-2.MNT.015.1), a failure surfaces/alerts and is not silent (AC-2.MNT.015.2), the zero-drop Haiku-gate audit week still logs a run record (AC-2.MNT.015.3); a maintenance producer that stops running reads stale, never green — the `Verified` path for the no-silent-failure invariant this slice owns (#3).
- **Durability check** (NFR-DR.008): AC-NFR-DR.008.1 — decay/merge/supersede are non-destructive; a low-confidence or superseded memory remains recoverable via the chain + append-only history (no single-layer loss is total). Erasure (MNT.017, ISSUE-029) is the only sanctioned destructive path and is explicitly out of scope here.
- **Feedback-loop test** (MNT.016 / AC-2.MNT.016.1): a human edit is logged with user/time/reason and flows through the sole writer, not a side-channel.
