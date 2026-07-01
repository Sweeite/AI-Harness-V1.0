# NFR Inventory — Phase 5 harvest ledger

> **What this is.** The consolidated harvest of every **non-functional** property surfaced across
> the 11 components, 14 surfaces, the load-bearing ADRs, the config registry, and the feasibility
> register (`AF-*`). This is the working ledger the eight domain files are built from — the Phase-5
> equivalent of Phase-4's `_data-inventory.md`.
>
> **How it was built.** Six independent read-only subagents (context discipline, per CLAUDE.md):
> three component shards (C0–C3 · C4–C7 · C8–C10), two surface shards (00–05 · 06–12), and one
> ADR + config-registry pass. Each returned a deduplicated, domain-tagged candidate list with
> `file:line` cites. Merged + deduplicated here.
>
> **The cardinal rule (see `phase-playbooks.md` Phase 5).** Phase 5 **references, does not
> re-spec.** Almost every property below already has a *functional owner* (an FR/AC or an ADR).
> The `NFR-*` row adds only the non-functional overlay: a **posture** (the risk stance), a
> **threshold/target** (a number the design implied but never stated), a **duty** (a property that
> must hold across components), or a **verification method** (the `AF-*` that will prove it). A
> property with **no** functional owner is a **gap-sweep candidate** (§ end) → mint the missing FR
> via change-control.

---

## The spine — the three non-negotiables

Phase 5 has no single "spine file" (unlike Phase-4's `schema.md`). The spine is the three
non-negotiables from `CLAUDE.md`; every `NFR-*` row exists to uphold one of them, and the
verification gate sweeps for all three:

- **#1 never lose or corrupt knowledge** — physical isolation, sole-writer + validate-and-commit,
  append-only audit sinks (+ the Phase-4 immutability trigger), embed-fail-never-stores, backup
  defense-in-depth + *proven* restore, transitive erasure walk intact, at-least-once trigger
  delivery, idempotency keys, compensation durability.
- **#2 never do what it shouldn't** — the seven code-enforced hard limits (non-overridable),
  default-deny RBAC + RLS, approval gates on consequential actions, never-unlimited rate caps,
  containment-first injection posture, `service_role` blast-radius bounded, mid-task authorization
  re-check, no-back-door (every surface + mobile runs the identical node-gate + C6 pipeline),
  management-plane "map not warehouse".
- **#3 never fail silently** — the silent-failure detector (terminal task ⋈ no terminal event),
  the self-watching alert engine + producer heartbeats, escalate-don't-abandon on every wait-point,
  fail-closed on guardrail/log-write error, unroutable-alert-fails-loud, cost-unknown≠$0,
  never-false-healthy on every surface (stale reads "—", not "0"/"✓"/"all clear"/"Live").

---

## Domain summary

| Domain | Code | File | ~Count | Load-bearing AF gates |
|---|---|---|---|---|
| Security | `SEC` | `security.md` | ~18 | AF-068 · AF-078 · AF-077 · AF-076/079 · AF-073 · AF-081 |
| Infrastructure / deploy | `INF` | `infrastructure.md` | ~14 | AF-004 · AF-064/066 · AF-065 · AF-020/021 · AF-013 · AF-132/135 |
| Performance / scale | `PERF` | `performance.md` | ~12 | AF-067 · AF-019 · AF-002 · AF-082 · AF-125 |
| Observability | `OBS` | `observability.md` | ~16 | AF-118 · AF-119 · AF-120 · AF-124 |
| Cost | `COST` | `cost.md` | ~10 | AF-001 · AF-042 · AF-043/035 · AF-002 |
| Compliance | `CMP` | `compliance.md` | ~11 | AF-071 · AF-136 · AF-134 · AF-137 · AF-133 |
| Backup / DR | `DR` | `backup-dr.md` | ~8 | AF-069 · AF-070 · AF-072 · AF-071 |
| Test strategy | `TEST` | `test-strategy.md` | (schedule) | **all** paper-not-proven AFs |
| Accessibility | `A11Y` | (baseline in `security.md`/surfaces note) | ~2 | — (design silent → baseline floor) |

Numbers are estimates; final counts land as the domain files are drafted. `NFR-*` IDs below are
**preliminary** (assigned at draft time in the domain files, sequential per domain, zero-padded 3).

---

## SEC — Security & isolation

| # | Property (posture / duty) | Functional owner | AF | Source cites |
|---|---|---|---|---|
| SEC-a | Physical isolation — one client per isolated Supabase project; isolation is **physical, never an RLS predicate**; `client_slug` deleted from every app table (identity only in mgmt-plane `client_registry`) | FR-10.ISO.001 · ADR-001 §1/§3/§7 | — | C10:1180; ADR-001:26,34,57; surfaces all note no-client_slug |
| SEC-b | Management-plane boundary — **map not warehouse**; only operational metadata crosses; no client business data; push-not-pull; ingest is `internal_token`-authed | FR-10.MGT.003 · FR-7.MGM.001 · FR-10.MGT.004 | — | C10:899,930; C7 MGM; ADR-001 §7:57 |
| SEC-c | Secrets custody — operator Railway env holds Supabase key + API keys + OAuth + `internal_token`; never in repo/config; UI shows presence + last-rotated only, never value; rotation out-of-band | FR-10.PRV.003 · FR-7.LOG.005 · config §secrets | — | ADR-001 §5:44; surface-01:521; surface-05:358; C7:344 |
| SEC-d | **The seven hard limits, code-enforced & non-overridable** — no autonomous external email, transact, delete records, cross-client share, impersonate, self-approve, treat tool-content as instructions; every hit logged + alerted; no approve affordance anywhere | FR-6.HRD.001/002/003 · FR-8.SPC.003/004/005 | **AF-068** | C6:315,336,348; C8:601,659; ADR-007 §1:119 |
| SEC-e | Coverage-gap posture — the seven are an audited safe-default; new dangerous capabilities (bulk export, mass-delete, external post, spend, config change) get **hard-approval + rate caps, not new hard limits** | FR-6.HRD.004 · OD-047 | AF-068 | C6:360 |
| SEC-f | Containment-first injection posture — the boundary is **code-enforced capability control** (RBAC, limits, gates, isolation), not detection; semantic scan **off by default**, signal-only, never an autonomous gate; quarantine retains + routes to human, never auto-discards | FR-6.INJ.001–006 · ADR-007 §2–5 | AF-068 · AF-117 | C6:671–733; ADR-007:65,128,148 |
| SEC-g | External-data boundary tagging — all tool-read content wrapped `<external_data>…`; Layer-1 prompt states tags are data never instructions | FR-6.INJ.004 · FR-4 (INJ layer) | — | C6:714; ADR-007 §2:128 |
| SEC-h | Webhook authentication — every ingress verified vendor-specific (HMAC / **Ed25519** per OD-046 / OIDC); unverified → 401 + log + alert; **replay/forgery rejected** | FR-0.WHK.001–005 | **AF-078** | C0:827–933; ADR-007:88; OD-046 |
| SEC-i | Brute-force / credential defense (external Super-Admin password path) — lockout/backoff actually stops an attack | FR-0.AUTH.* (2FA/lockout) | **AF-077** | C0 Block J; feasibility AF-077 |
| SEC-j | Complete `aal2` + RLS coverage — 2FA enforced deployment-wide via aal2 RLS; **every table** has a policy (no unguarded table); CI/lint gate | FR-0.AUTH.008 · FR-1.RLS.* | **AF-076 · AF-079** | C0:222; C1 RLS; feasibility |
| SEC-k | `service_role` blast radius bounded — agent-path bypasses RLS; containment via harness RBAC + the C8 `memory_scope` fail-closed filter (scope ∩ clearance); agent-path audit completeness | FR-8.SCO.001/002 · FR-1.RLS.007 · AC-2.RET.004.2 | **AF-081** | C8:713,754; C1:645; OD-081 |
| SEC-l | Mid-task authorization re-check — a `service_role` task re-checks originating user's active status + clearances at each step/injection boundary; deactivation/revoke → halt + **quarantine (retains WIP)**, never silent drop; benign session-expiry continues | FR-5.ASM.005 · FR-2.WRT.006 · FR-1.RLS.007 | AF-081 | C5:490; C2 WRT; C1:645 |
| SEC-m | No-back-door — every surface **and mobile** runs the identical C1 node-gate + C6 pipeline; destructive command node-gate evaluated **before** confirm prompt; deep-management degrades to a notice, never a silent omission; no shortcut bypass | FR-9.MODE.003 · FR-9.CMD.003 · AC-9.CMD.008.4 | — | surface-12:57; surface-08/09/10; C9:204,900 |
| SEC-n | Agent hard-limit **rejected-at-write** — Comms never-sends, Finance never-transacts, Memory sole-writer are code-level denies in the registry editor, not audits | AC-8.SPC.003.3/004.3/005.2 | AF-068 | surface-09:85; C8:601 |
| SEC-o | Least-privilege on custom commands — a manager may only gate a command on a node they're authorized to assign; a definition can never *lower* the assigned action's C6 tier | AC-9.CMD.006.4 · AC-9.CMD.008.4 | — | surface-10:358; C9:1051; OD-142/143 |
| SEC-p | Two-person auth for sensitive deletion — Restricted/Personal/SoR erasure needs a distinct second authoriser (no self-execution, DB-enforced per Phase-4 re-audit) | FR-10.DEL.006 · AC-10.DEL.006.2 | — | C10:381; schema.md deletion_requests CHECK |
| SEC-q | Reason-capture on sensitive mutations — mandatory on Restricted grants, captured for role/clearance/deactivate | FR-1.RST.002 · OD-112 | — | surface-02:94,310 |
| SEC-r | Off-platform backup **client-held & encrypted**, different region, independent of project lifecycle (security custody, not just DR) | ADR-008 §2 | AF-071 | ADR-008:110 |

**A11Y baseline (design silent → floor):** keyboard-navigable + sufficient contrast + semantic
markup on the 14 surfaces; screen-reader labels on action controls. Anything richer (full WCAG
2.1 AA conformance audit) → risk-posture OD (below) or OOS.

## INF — Infrastructure & deployment

| # | Property | Functional owner | AF | Source cites |
|---|---|---|---|---|
| INF-a | Canary + release-train — feature → release(canary) → **operator-promoted** → main(fleet); promotion gated on tests + migration + smoke + **soak** (`canary_soak_minutes=60`) | FR-10.DEP.001/002 · ADR-005 | AF-064 · AF-066 | C10:966,996; ADR-005:71 |
| INF-b | Expand-contract migrations — no destructive change in one migration; add→backfill→(later)remove; vN and vN-1 both run correctly | FR-10.MIG.001 · migration-discipline.md | **AF-065** | C10:1120; ADR-005:148 |
| INF-c | Rollback = code-redeploy of prior build; **schema rolls forward only** (no down-migration) | FR-10.DEP.003 | AF-065 | C10:1029; ADR-005:158 |
| INF-d | Version-skew bounded + monitored — deployment reports `core_version` + last-migrated; alert if > `deploy_max_version_skew=3` versions or `deploy_max_skew_days=14` stale | FR-10.DEP.004 | — | C10:1060; config |
| INF-e | Per-deployment migration-failure **isolation** + halt + alert; one client's failure never cascades to the fleet | FR-10.MIG.002 | — | C10:1147 |
| INF-f | Provisioning scripted & idempotent, two-party — client owns accounts + card + OAuth; operator provisions Railway link, env, `internal_token`, `client_registry` row + seed; **fails loud on partial setup** | FR-10.PRV.001 · ADR-005 §5 | **AF-004** · AF-020/021 | C10:697; ADR-005:165 |
| INF-g | Per-client OAuth apps in the client's own accounts; Google production verification is a provisioning schedule dependency | FR-10.PRV.002 | AF-013 | C10:736; ADR-005 §6 |
| INF-h | Synthetic canary corpus + smoke battery (boot, migration, connector wiring, retrieval/contradiction/routing behavioral checks); green battery is the promotion gate | FR-10.PRV.003 · ADR-005 §C2 | AF-066 | C10:768; ADR-005:110 |
| INF-i | Plugins **out of** the release train — per-deployment, manual update, version-reported (drift observable) | FR-10.DEP.005 | — | C10:1090; OOS-033 |
| INF-j | Health reporter — each deployment pushes operational-metadata snapshots on interval + on significant events; ingest per-deployment `internal_token`-authed; rejections logged + alerted | FR-7.MGM.001 · FR-10.MGT.002/004 | — | C7 MGM; ADR-001 §7:57 |
| INF-k | Inngest = single retry/DLQ authority; `task_queue` is the audit projection (never dual-retry); v1 Inngest **cloud-hosted** (self-host deferred, OOS-028) | FR-5.JOB.004/007 | — | C5:410,445 |
| INF-l | Deployment **freeze gate** — a silo in retention-freeze (`client_registry.status=frozen`) blocks all trigger/dispatch, fails closed; enforced at the dispatch boundary not the status label | FR-5.TRG.001 · AC-5.TRG.001.3 · FR-10.OFF.004 | **AF-135** | C5:170; C10:560; OD-091 |
| INF-m | Deprovision completeness — offboarding hard-delete actually deletes/revokes Supabase + Railway + credentials + tokens (atomic-or-escalate, never partial-silent) | FR-10.OFF.005 | **AF-132** | C10:606 |
| INF-n | Idempotent seed + crash-window resilience — task graph resumes from first incomplete step, prior outputs reused; idempotency keys prevent retry-duplication; single catch-up on missed loop runs (no backfill stampede) | FR-5.GRP.003/004 · FR-5.LOP.004 · FR-0.SEED.003 | AF-112 · AF-063 | C5:291,306,366; C0:649 |

## PERF — Performance & scale

| # | Property (target the design implied but never stated) | Functional owner | AF | Source cites |
|---|---|---|---|---|
| PERF-a | **RLS-on-hot-path latency** — live data-driven `(select …)` initPlan evaluates once per statement; the clearance predicate composes *before* vector ranking within the retrieval latency budget | FR-1.RLS.* · FR-2.RET.004 · ADR-006 | **AF-067** | C1 RLS; C2:RET; surface-11:435; feasibility:165 |
| PERF-b | **Vector search recall-under-RLS** — pgvector HNSW returns relevant memories with the RLS predicate applied without recall starvation (ANN-then-filter) | FR-2.VEC.* · indexes.md | **AF-019** | feasibility:43; indexes.md |
| PERF-c | **Retrieval quality/relevance** — the memory retrieval surfaces the *right* memories (the whole system's usefulness rests here) | FR-2.RET.* | **AF-002** | feasibility:24 |
| PERF-d | **Entity-resolution accuracy at scale** — the fragmentation/duplicate risk; entities don't shard into near-dupes | FR-2.ENT.005 · AC-2.MNT.010 | **AF-082** | C2 ENT; surface-11:76 |
| PERF-e | Scale envelope — every target stated against the **≤~20 users / silo** figure (ADR-006 §Axis-2 + ADR-008 posture; ADR-001 speaks of ~20 *clients* by year two — distinct); not designed for hot failover or high concurrency | ADR-006 §Axis-2 · ADR-008 posture | — | ADR-006:84; ADR-008:145 |
| PERF-f | Memory-injection cap — `memories_injected_per_task=7` (token-cost lever) | config · FR-2.RET | — | config:116 |
| PERF-g | Chain-depth limit — `chain_depth_limit=6`, enforced at plan-build (bounded chains, never silent truncation) | FR-8.PLAN.003 · config | — | C8:856; config:235 |
| PERF-h | Compression threshold — `compression_threshold_tokens=8000`; longer chains summarize, **originals retained** in durable `task_history` (economy never = knowledge loss) | FR-5.ENV.003 · config | AF-114/115 | C5:327; config:169 |
| PERF-i | ef_search dial — `ef_search=40` (range 10–500), recall/latency trade-off | config · indexes.md | AF-019 | config:126 |
| PERF-j | Loop cadence — fast `*/10m`, medium `2h`, slow `08:00 daily`; lazy spin-up: code DB-condition check before waking Sonnet (idle floor ≈ free) | config · ADR-003 §5 | — | config:165; ADR-003:130 |
| PERF-k | Realtime connection budget — per-silo (Free 200 / Pro 500 concurrent); at `realtime_connection_headroom_threshold=80%` extras degrade to polling (never silent freeze); the two Realtime surfaces prioritized | FR-7.RTP.003 · config | — | C7:438; config:205 |
| PERF-l | Result caching — scope-aware, write-triggered invalidation, per-agent-type window (`cache_time_window`: research 30m … insight 1440m); miss-on-uncertainty | FR-8.LRN.003 · config | **AF-125** | C8:1059; config:242 |

## OBS — Observability

| # | Property (duty / bar) | Functional owner | AF | Source cites |
|---|---|---|---|---|
| OBS-a | **Silent-failure detector** — every task has a terminal `event_log` event; terminal `task_queue` status with **no** terminal event = a detectable gap, surfaced in Failure Health (not a dashboard nicety — an NFR) | FR-7.LOG.003 · AC-7.LOG.003.1 | **AF-118** | C7:314; surface-05:292 |
| OBS-b | Event-log write-failure out-of-band path — failure surfaced via local stderr/file + a `log-write-failing` health bit on the mgmt-plane push (visible even when silo DB unreachable) | AC-7.LOG.003.2 | **AF-119** | C7:324 |
| OBS-c | Cross-sink reconciliation — `guardrail_log` row without an `event_log` counterpart (and vice-versa) flagged; the two sinks cannot silently diverge | AC-7.LOG.003.3 | — | C7:329 |
| OBS-d | **Alert-engine watchdog** — the alert-evaluation engine emits a heartbeat; an independent watchdog raises a critical alert if it stalls (the watcher is watched — the worst #3 is the observability layer failing silently) | FR-7.ALR.008 | **AF-118** | C7:533 |
| OBS-e | Metric-producer liveness — agent-health / drift / dead-agent / risk-scan producers emit heartbeats; a stalled producer reads **"stale", never green** | AC-8.HLTH.004.2 · AC-9.PRO.004.3 | AF-124 | C8:982; C9:371; surface-09:288 |
| OBS-f | Mgmt-plane staleness — every card carries a freshness timestamp; snapshot older than `deployment_staleness_window=15min` flips to stale/unreachable + alert; **absence of signal is itself a signal**; server-authoritative time (no fast-reporter clock skew); **frozen ≠ dead** | FR-7.MGM.002 · AC-10.OFF.004.4 | AF-118/120 | C7:630; C10:560; config:213 |
| OBS-g | Escalate-don't-abandon (the universal wait-point pattern) — un-actioned ingestion > `review_escalation_days`, approval > timeout, DLQ > `dlq_stale_alert_hours=24`, unacked alert > `alert_escalation_window_hours=2`, clarification, halt, stuck suggestion — all escalate + persist, **never auto-cleared / auto-approved / silently parked** | FR-6.ESC.004 · FR-7.ALR.005 · FR-5.QUE.005 · FR-8.ORC.006 · FR-9.SUG.001 | AF-120 | C6:652; C7:500; C5:261; C8:302; C9:485 |
| OBS-h | Unroutable-alert-fails-loud — routing target unresolved → escalation + "alert delivery misconfigured" critical (never silent drop); quiet-hours never silence hard-limit/critical | FR-7.ALR.003/009 | — | C7:485,545; OD-097 |
| OBS-i | Alert delivery invariant — dashboard notification persisted **first + independently**; Slack is best-effort fan-out off the persisted row; Slack failure never loses the notification + is itself surfaced | FR-7.ALR.006 | — | C7:514; surface-07:251 |
| OBS-j | Append-only event log — unified plain-English timeline; every row's `summary` states what happened + why; no UPDATE/DELETE except retention pruning (pruning logged, never while referenced by an open item) | FR-7.LOG.001/002/006 | — | C7:291,304,350 |
| OBS-k | Never-false-healthy (surface duty) — every error/stale state reads "—"/"mode unknown"/"can't confirm", never "0"/"$0"/"✓"/"all clear"; honest Live/Polling/Reconnecting indicator; offline **re-fetch before re-enabling actions** | FR-7.RTP.004 · AC-7.VIEW.002.2 | — | all surfaces; surface-04:100,169; surface-12:63 |
| OBS-l | Answer-mode pill everywhere — Cited/Inferred/Unknown on every AI output; unresolved reads "mode unknown", never silently "Cited" | FR-4.CID.006 · AC-7.VIEW.002.2 | — | surface-07/08/12; C7:690 |
| OBS-m | Cost meter honesty — per-event `cost_tokens` estimate-grade rounded up; **`cost_unknown` sentinel, never a silent $0** (a blind meter is detectable, not averaged as free) | FR-7.LOG.004 · FR-7.COST.001 | AF-042 | C7:333,574 |
| OBS-n | Realtime cap — **exactly two** Realtime surfaces (approval queue + notification centre); everything else polls at defined, configurable cadences | FR-7.RTP.001/002 | — | C7:419,429 |
| OBS-o | Drift/dead-agent **flag-never-auto-correct** — surfaced for human decision, never auto-disabled/auto-fixed | FR-8.HLTH.001–003 · OD-078 | AF-123/124 | C8:906–981; surface-09:268 |
| OBS-p | Every guardrail hit + every alert logged to a sink independent of delivery success (audit history never lost if delivery fails) | FR-6.INJ.005 · FR-7.ALR.004 | — | C6:724; C7:494 |

## COST — Cost & economic viability

| # | Property | Functional owner | AF | Source cites |
|---|---|---|---|---|
| COST-a | **Cost ladder (four rungs)** — soft alert `$50/day` (+`$200/wk`) → throttle `$75` → hard kill `$100/day`; all operator-editable per client | ADR-003 §2 · config | **AF-001** · AF-040/041 | ADR-003:84; config |
| COST-b | Throttle action — pause non-critical (proactive suggestions, insight agent, self-improvement, consolidation, medium-loop) + reduce loop frequency; user-facing + urgent untouched | ADR-003 §2 · FR-6.RTL.004 | — | ADR-003:92 |
| COST-c | Hard-ceiling action — halt all non-critical; allow only urgent fast-loop triggers + human-initiated + human-approved (+ guardrails) | ADR-003 §2 · FR-6.RTL.004 | — | ADR-003:93 |
| COST-d | Cost-ladder decision/execute split — **C7 meters + signals, C6 decides (guardrail class), C5 executes (throttle/kill)**; hard-kill → `guardrail_log` (rate_limit) + immediate alert | FR-7.COST.003 · FR-6.RTL.004 · FR-8.COST.003 | — | C7:590; OD-068 |
| COST-e | Cost source is a **fail-safe token estimate** (ADR-001 boundary, estimate-grade, never a vendor invoice); price table config-driven, updates without deploy; rounds up | FR-7.COST.001 · ADR-003 §3 | AF-042 | ADR-003:100 |
| COST-f | Viability target — a healthy deployment ≤ **~$20/day (~$600/mo)**; soft $50 = investigate; ceiling $100 = backstop; measured at AF-001 | ADR-003 §7 | **AF-001** | ADR-003:147 |
| COST-g | Cost-lever precedence (**controls before gates**) — model routing → selective-writing gate → loop idle-gating → memory-injection limit → orchestrator confidence threshold; never an LLM gate whose cost exceeds its savings | ADR-003 §6/§7 | — | ADR-003:136,152 |
| COST-h | Memory-write cost model — code noise filter → Haiku selective-writing gate → Haiku pre-checks (contradiction + sensitivity) → **exactly 1 Sonnet writer** per written memory, wrapped in ≤3 Haiku; `memory_writes_per_minute=30` caps Sonnet | ADR-003 §4 · FR-2.WRT.* | **AF-043** | ADR-003:115; config |
| COST-i | Selective-writing gate ships in **shadow-retain mode** during a `haiku_audit_window_days=21` trust window (would-drop memories tagged, nothing lost); goes autonomous only if disagree-rate < threshold | ADR-003 §8 · FR-2.ING.* | AF-035/043 | ADR-003:156 |
| COST-j | Cost aggregated per task-type from day one (ROI substrate); re-ranking + HyDE **off by default** in the v1 cost model (justified only if AF-002 earns them) | FR-7.COST.002 · ADR-003 §6/§8 | AF-002 | C7:583; ADR-003:143 |

## CMP — Compliance & data governance

| # | Property | Functional owner | AF | Source cites |
|---|---|---|---|---|
| CMP-a | **Data residency** — v1 hard-locked to Sydney `ap-southeast-2`, recorded per deployment (v2 selectable); residency trivially per-client (client owns Supabase) | FR-10.ISO.003 · config | **AF-071** | C10:1255; config:283 |
| CMP-b | **Golden rule** — the brain stores pointers + enrichment, **never copies** of source data; source stays in its system of record; memory row carries `source_ref` (governs data model + ingestion + backup scope) | ADR-008 Context · FR-2.* | — | ADR-008:32 |
| CMP-c | Intentional-retention — hard-delete only via erasure or offboarding, **never incidental**; deletion deliberate + audited | FR-10.RET.001 | — | C10:128 |
| CMP-d | Retention values with legal-minimum floors — `event_log_retention_window=365d`, `client_offboarding_retention_days=90`, `individual_deletion_audit_years=7`, `data_export_link_expiry_hours=72`; Super-Admin-gated; floors jurisdiction-dependent | FR-10.RET.002 · config | **AF-136** | C10:165; config:204,276 |
| CMP-e | Individual right-to-erasure — two-class identification (deterministic auto / probabilistic human-confirmed); entity-id removal + transitive hard-delete (memory retained if multi-entity, else cascade via C2); content scrubbing human-confirmed; **verify erasure complete before audit-done** | FR-10.DEL.002/003/004 · FR-2.MNT.017 | **AF-134** · AF-137 | C10:237–346; C2 MNT |
| CMP-f | Audit-sink immutability — `event_log` / `guardrail_log` / `config_audit_log` / `access_audit` append-only + **tamper-evident**; enforced by the Phase-4 `enforce_audit_append_only()` trigger fired **regardless of role** (the `service_role` writer cannot rewrite history) | FR-7.LOG.001/007/008 · schema.md | — | C7:291,384; schema.md §Immutability |
| CMP-g | Redaction-tombstone on erasure — PII fields scrubbed in place, row existence + audit metadata retained; the tombstone is tamper-evident (doesn't break the integrity check); walks event_log + guardrail_log + config_audit_log actor_id | AC-7.LOG.006.3/007.4/008.4 · FR-2.MNT.017 | — | C7:362,405; OD-074 |
| CMP-h | Client offboarding — trigger → **export verified-complete before any deletion** (row-count/checksum, fails closed) → encrypted export + client sign-off → retention-freeze → hard-delete/deprovision → compliance meta-record (mgmt-plane only, no client data) | FR-10.OFF.002–006 | **AF-133** · AF-132 | C10:484–692 |
| CMP-i | Export integrity everywhere — compliance/config-audit/event-log exports are **all-or-nothing, no silent truncation** | AC-7.LOG.008.1 · FR-10.OFF.002 | — | surface-01b:334; surface-05:416 |
| CMP-j | HR-related content **disabled by default** — legal-review gate required to enable | FR-10.LEG.001 · config | AF-136 | C10:1290; config:130 |
| CMP-k | Mandatory legal review before regulated personal data (retention values + deletion procedures by jurisdiction); change-control binds locked ADR postures | FR-10.LEG.001 · change-control.md | AF-136 | C10:1290; ADR-008:10 |

## DR — Backup & disaster recovery (ADR-008 → operational NFRs)

| # | Property | Functional owner | AF | Source cites |
|---|---|---|---|---|
| DR-a | Recovery tier default — free daily in-project backups + **hourly off-platform `pg_dump`**; target **RPO ~1 hour**; PITR is an opt-in upsell (~$100+/mo, off by default) | ADR-008 §1 | **AF-072** | ADR-008:103 |
| DR-b | Off-platform logical backup — encrypted, written to a **client-owned** destination (not operator-held), different region, hourly, independent of project lifecycle; the **only** defense against the billing-lapse→deletion path | ADR-008 §2 | AF-072 · AF-071 | ADR-008:110 |
| DR-c | **Tested restore** — periodic operator rehearsal into a throwaway project confirms DB + pgvector + auth rows complete + queryable; result + timestamp logged. Supabase verifies nothing; the operator does. ("backup exists ≠ restore works") | ADR-008 §4 · FR-7.MGM.005 | **AF-069** | ADR-008:124 |
| DR-d | Ownership split — client **owns + pays** (project, plan, off-platform destination, optional PITR); operator **operates + verifies** (schedules the job, runs rehearsals, watches health). Preserves the ADR-001 boundary | ADR-008 §3 | — | ADR-008:118 |
| DR-e | Backup-health on the mgmt-plane push — recovery tier · last in-project backup + ts · project status (active/paused/**billing-at-risk**) · last off-platform snapshot + ts · last rehearsal + result; read via Supabase Management API; **loud lapse/stale alert** to Super Admin (catches the deletion path early) | FR-7.MGM.005 · ADR-008 §5 | **AF-070** | C7:662; ADR-008:129 |
| DR-f | DR posture — **backup-restore with downtime, not hot failover**; acceptable at ADR-001's ≤~20-user scale; read-replicas/HA are a per-client upsell (OOS-014) | ADR-008 posture | — | ADR-008:145 |
| DR-g | Storage buckets **out of scope** for v1 backup (used only for regenerable offboarding exports; source files never copied). Future non-regenerable Storage content re-opens this | ADR-008 §6 · OOS-013 | — | ADR-008:137 |
| DR-h | Append-only audit sinks are themselves a knowledge-durability layer (the history survives even if a restore is needed); backup + immutability + shadow-retain = #1 defense-in-depth | XCUT (ties CMP-f, DR-a) | — | ADR-008; ADR-007 |

---

## Gap-sweep candidates (properties whose functional owner is thin or process-only)

Per playbook step 4, each is either (i) minted as an FR via change-control, or (ii) recorded as a
process/OOS duty. Flagged for decision at draft time:

1. **Mobile web-push delivery reliability** — surface-12 flagged a *new* spike: the push *routing
   contract* (FR-7.VIEW.003) is specced, but background web-push delivery of a "critical, immediate,
   always" alert is unproven. Fails safe to the persisted in-app notification centre. → **new
   `AF-138` (SPIKE/LOAD)**; no FR rests on delivery, so no mint needed — log the AF + note in
   `test-strategy.md` + `backup-dr`/OBS.
2. **Weekly-review / operator discipline** (FR-7.OPT.001) — signals are captured + surfaced, but the
   *discipline of acting on them* is a human process, not software. → process duty, note in
   `test-strategy.md`, not an FR.
3. **Compensation-task execution** (FR-6.ESC.003) + **quarantine discard/review** (FR-6.INJ.006) —
   the software queues + surfaces; the *decision* is a human duty with an explicit escalation owner.
   Owned; no gap.
4. **Push-notification `push_subscriptions` device-token store** — net-new Phase-3 store, already
   owed-back to C7 FR-7.VIEW.003 in Phase 4. Confirm the DR/retention posture of device tokens in
   `compliance.md`.
5. **A11Y floor** — no functional owner (design silent). → risk-posture OD (below): set a baseline
   or log OOS.

*(No hard #1/#2/#3 duty was found orphaned — every safety-critical property maps to an FR/AC. The
gaps above are a new spike, two human-process duties, a store-retention confirm, and the a11y floor.)*

---

## Risk-posture Open Decisions (the genuine user calls for Phase 5)

These are surfaced for the operator per the playbook ("who decides: user on risk posture"). Each
gets a full `OD-*` entry with options + recommendation when the domain files are drafted; listed
here so the inventory names them:

- **RP-1 — The launch-gating set: which paper-not-proven `AF-*` must PASS before go-live vs
  fast-follow.** The load-bearing safety/viability spikes are **AF-068** (injection containment
  red-team, #2), **AF-069** (restore actually works, #1), **AF-001** (cost viability, or the
  business model breaks), **AF-067** (RLS hot-path latency — if it blows the budget the product is
  unusable), **AF-078** (webhook forgery/replay, #2), **AF-077** (brute-force defense, #2).
  *Recommendation:* these six are **launch-blocking**; the accuracy-EVAL spikes (AF-002 retrieval,
  AF-082 entity-res, AF-116/117 anomaly/injection-lib, AF-121–131 routing/proactive) ship with the
  shadow-retain / flag-only / human-in-loop postures that already de-risk them → fast-follow.
- **RP-2 — Backup restore-rehearsal cadence.** ADR-008 says "periodic"; Phase 5 must pick a number.
  *Recommendation:* monthly automated rehearsal + on every schema-migration release.
- **RP-3 — Accessibility floor.** *Recommendation:* baseline (keyboard + contrast + semantic markup
  + control labels) as `NFR-A11Y.001–002`; full WCAG 2.1 AA conformance audit → OOS (v2).
- **RP-4 — Performance-target philosophy.** The design states **no** latency numbers.
  *Recommendation:* set *aspirational* targets in `performance.md` (e.g. retrieval p95 < 2 s
  end-to-end, RLS predicate overhead < 50 ms/statement) explicitly tagged "to be **confirmed** by
  AF-067/019/002 LOAD/EVAL — not proven" rather than leaving them unstated; a builder needs a number
  to test against.

---

*Built session 45 (2026-07-01) from a six-way subagent harvest. Next: draft the eight domain files
(`security.md` first), gap-sweep change-control, then `test-strategy.md` as the keystone.*
