# Phase 6 — Build Backlog (the index + map)

This is the **spine** of Phase 6: every build issue, grouped by epic, with its dependency edges,
the build-order sequence, the critical path, and the **coverage ledger** (every FR + every NFR →
the issue(s) that claim it). It is the one file you read to see the whole plan.

- **Canonical issue definitions** live in `spec/06-issues/ISSUE-<nnn>-<slug>.md`. This backlog
  *indexes* them; it does not restate them.
- **Build-state** (open/closed, progress) lives in the GitHub mirror once exported; each issue file
  records its GitHub `#<n>` in frontmatter.
- **The self-sufficiency contract** (per issue, `_TEMPLATE.md`): an issue is a precise build order
  that points into the repo by ID — it never copies `AC-*`/spec text.

> **Status legend:** `ready` (no unmet blocker) · `blocked` (waiting on a blocked-by) · `in-progress` · `done`.
> A **SPIKE** issue proves a launch-gating assumption (OD-157 / RP-1) before its dependents may ship.

---

## Epics

| Epic | Theme | Issues |
|---|---|---|
| **S** | Launch-gating spikes (OD-157) — first-class, precede dependents | 001–006 |
| **A** | Platform foundations / scaffold (no user surface) | 007–012 |
| **B** | Identity & Access (C0 auth, C1 RBAC/RLS) | 013–021 |
| **C** | Memory (C2) | 022–031 |
| **D** | Tool layer / connectors (C3) | 032–041 |
| **E** | Prompt & reasoning (C4) | 042–046 |
| **F** | Agent harness / execution (C5) | 047–054 |
| **G** | Guardrails / safety (C6) | 055–060 |
| **H** | Agent design / routing (C8) | 061–067 |
| **I** | Proactive intelligence (C9) | 068–073 |
| **J** | Observability & ops surfaces (C7 + dashboards) | 074–079 |
| **K** | Infrastructure & compliance (C10 + backup/DR) | 080–085 |
| **L** | Config surfaces | 086 |

---

## Issue roster

Legend: **FR groups** = the component AREA groups the issue implements (exact FR/AC IDs live in the
issue file). **Gate** = a launch-gating spike (ISSUE-00x) or build-time AF the issue rests on.

### Epic S — Launch-gating spikes (OD-157, RP-1)

| ID | Title | FR/NFR focus | Blocked-by | Gate proves |
|---|---|---|---|---|
| ISSUE-001 | SPIKE: cost viability ≤~$20/day typical | NFR-COST.006, AF-001 | none | AF-001 |
| ISSUE-002 | SPIKE: RLS hot-path latency (<~50ms/stmt, <~2s p95) | NFR-PERF.001/003, AF-067 | none | AF-067 |
| ISSUE-003 | SPIKE: injection containment red-team | NFR-SEC.004/006, AF-068 | none | AF-068 |
| ISSUE-004 | SPIKE: restore actually works (DB+pgvector+auth) | NFR-DR.003, AF-069 | none | AF-069 |
| ISSUE-005 | SPIKE: brute-force / credential defense | NFR-SEC.009, AF-077 | none | AF-077 |
| ISSUE-006 | SPIKE: webhook forgery / replay rejected | NFR-SEC.008, AF-078 | none | AF-078 |

### Epic A — Platform foundations

| ID | Title | FR groups | Blocked-by |
|---|---|---|---|
| ISSUE-007 | Provisioning + per-client Supabase bootstrap | C10 PRV | none |
| ISSUE-008 | Migration harness (expand-contract) + 0001 baseline | C2 VEC.002, migrations.md | 007 |
| ISSUE-009 | RLS scaffold — helpers, default-deny, 100% coverage CI gate | C1 RLS.001/004/006 | 008, 002(spike) |
| ISSUE-010 | Config store + secret manifest + config-audit-log immutability | C7 LOG.008 | 008 |
| ISSUE-011 | Observability skeleton — event_log append-only + silent-failure detector + alert-engine watchdog + escalate-don't-abandon | C7 LOG.001–006, ALR.008, RTP core | 008 |
| ISSUE-012 | Management-plane bootstrap — client_registry + ingest endpoint + health push | C10 MGT, C7 MGM | 008, 011 |

### Epic B — Identity & Access

| ID | Title | FR groups | Blocked-by |
|---|---|---|---|
| ISSUE-013 | OAuth login + session lifecycle (+ surface-00 login/reauth) | C0 AUTH(OAuth), SESS | 009 |
| ISSUE-014 | Super-Admin password + TOTP 2FA + brute-force defense (+ surface-00 2FA) | C0 AUTH(pw/2FA/009) | 009, 005(spike) |
| ISSUE-015 | Invite + seed bootstrap (+ surface-00 invite-setup) | C0 INV, SEED | 009, 013 |
| ISSUE-016 | Support-request recovery intake (+ surface-00 support-requests) | C0 REC | 013 |
| ISSUE-017 | Webhook authentication, per-vendor (Ed25519/JWT/HMAC + replay) | C0 WHK | 006(spike) |
| ISSUE-018 | Role model + permission matrix + `can()` gate | C1 ROLE, PERM | 009 |
| ISSUE-019 | Clearance + Restricted model | C1 CLR, RST | 018 |
| ISSUE-020 | RLS enforcement — visibility/sensitivity/Restricted/aal2 + service_role path + mid-task revocation | C1 RLS.002/003/005/007/008 | 009, 019; RLS.007 → 003(spike) |
| ISSUE-021 | User management lifecycle + RBAC audit (+ surface-02) | C1 USR, AUD | 018, 019 |

### Epic C — Memory

| ID | Title | FR groups | Blocked-by |
|---|---|---|---|
| ISSUE-022 | Memory + entity model + sensitivity/visibility tagging | C2 MEM, ENT, TAG | 008, 019 |
| ISSUE-023 | Embeddings + HNSW vector search | C2 VEC | 022, 002(spike) |
| ISSUE-024 | Memory write / sole-writer path (contradiction, confidence, validate-commit) | C2 WRT | 022, 020 |
| ISSUE-025 | Retrieval + ranking + clearance-before-ranking + answer modes | C2 RET | 023, 020 |
| ISSUE-026 | Ingestion filters + human queue (+ surface-03 ingestion) | C2 ING | 024, 026-dep-connectors(032) |
| ISSUE-027 | Maintenance lifecycle — decay/merge/supersede/expiry/erosion | C2 MNT(lifecycle) | 024 |
| ISSUE-028 | Conflict quarantine + consolidation approval (+ surface-03 conflicts/consolidation) | C2 MNT(conflict/consol), WRT.002 | 024, 056 |
| ISSUE-029 | Compliance erasure walk (memory-side transitive delete) | C2 MNT.017 | 024; → 082 |
| ISSUE-030 | Maturity + cold-start gating signal | C2 MAT | 022 |
| ISSUE-031 | Memory navigation surface | surface-11 (renders C2 RET/ENT/MNT) | 025, 027 |

### Epic D — Tool layer / connectors

| ID | Title | FR groups | Blocked-by |
|---|---|---|---|
| ISSUE-032 | Connector contract + shared runtime + tool registry | C3 CONN, REG | 008, 010 |
| ISSUE-033 | OAuth token lifecycle — 3-layer refresh + atomic persist | C3 TOK | 032 |
| ISSUE-034 | Rate limiting + 80/95/429 tiers + halt-escalate | C3 RL | 032 |
| ISSUE-035 | Write tools + seven hard limits at connector | C3 ACT | 032, 055 |
| ISSUE-036 | Tool optimisation (confidence-gate, cache, batch, degrade) | C3 OPT | 032 |
| ISSUE-037 | Trigger infra + liveness (watch re-arm, event-gap) | C3 TRIG | 032, 017 |
| ISSUE-038 | Disconnection + recovery (states, auto-resume, escalation) | C3 DSC | 033 |
| ISSUE-039 | GHL connector instance | C3 OBS.001 (+GHL TOK/TRIG) | 033, 034, 037 |
| ISSUE-040 | Google connector instance (Gmail/Drive/Calendar) | C3 OBS.002 | 033, 034, 037 |
| ISSUE-041 | Slack connector instance | C3 OBS.003 | 033, 034, 037 |

### Epic E — Prompt & reasoning

| ID | Title | FR groups | Blocked-by |
|---|---|---|---|
| ISSUE-042 | Prompt layer model + storage + version-never-overwrite | C4 LYR, STO | 008 |
| ISSUE-043 | Layer-1 identity/principles/limits + answer-mode signalling + principles floor | C4 CID, PRIN | 042 |
| ISSUE-044 | Layer-2 business context + Layer-4 task instruction + templates | C4 BIZ, TSK | 042 |
| ISSUE-045 | Layer-3 memory injection scoping + clearance filter + volume bounds | C4 INJ | 042, 025 |
| ISSUE-046 | Prompt optimisation / version-to-outcome attribution | C4 OPT | 042 |

### Epic F — Agent harness / execution

| ID | Title | FR groups | Blocked-by |
|---|---|---|---|
| ISSUE-047 | Triggers + deployment-freeze gate | C5 TRG | 011, 017; freeze → 083 |
| ISSUE-048 | task_queue permanent record + status machine + approval-block + priority | C5 QUE | 011 |
| ISSUE-049 | Task graphs + idempotency keys + resume-from-incomplete-step | C5 GRP | 048 |
| ISSUE-050 | Context envelope + full-envelope-per-step + compression + originals retention | C5 ENV | 048 |
| ISSUE-051 | Three loops + config-extensible + catch-up dedup + failure heartbeat | C5 LOP | 048 |
| ISSUE-052 | Inngest execution engine + step retry + fan-out + DLQ | C5 JOB | 049 |
| ISSUE-053 | Run pipeline — prompt-stack assembly + gates (RBAC/approval/anomaly) + memory injection + answer-mode + completion dual-record | C5 ASM | 043, 045, 048, 055, 056, 057, 061 |
| ISSUE-054 | Execution optimisation (parallel DAG, scheduling, decomposition, pre-warm) | C5 OPT | 049, 052 |

### Epic G — Guardrails / safety

| ID | Title | FR groups | Blocked-by |
|---|---|---|---|
| ISSUE-055 | Seven hard limits — code enforcement, un-overridable | C6 HRD | 011, 003(spike) |
| ISSUE-056 | Approval tiers + mandatory-hard set + escalation/flagged workflow (+ surface-04 approval queue) | C6 APR, ESC | 048, 076 |
| ISSUE-057 | Five pre-step anomaly checks (signal-not-gate, baseline learning) | C6 ANM | 011 |
| ISSUE-058 | Rate-limit guardrails + cost-ladder enforcement | C6 RTL | 034, 074; ladder → 001(spike) |
| ISSUE-059 | Injection sanitization pipeline (4-step) + quarantine (retain+route-to-human) | C6 INJ | 011, 003(spike) |
| ISSUE-060 | guardrail_log + no-silent-failure invariant + approval/anomaly learning | C6 LOG, FMM, OPT | 011 |

### Epic H — Agent design / routing

| ID | Title | FR groups | Blocked-by |
|---|---|---|---|
| ISSUE-061 | Orchestrator + 7-step routing + agents registry | C8 ORC, REG | 042, 048 |
| ISSUE-062 | Eight specialist definitions + per-agent hard limits (Comms never-sends, Finance never-transacts, Memory sole-writer) | C8 SPC | 061, 043 |
| ISSUE-063 | Per-agent memory scoping (retrieval filter) | C8 SCO | 062, 025 |
| ISSUE-064 | Execution plans + per-step failure-mode assignment | C8 PLAN | 061, 052 |
| ISSUE-065 | Agent health / drift / dead-agent (flag-never-auto-correct) + producer heartbeat | C8 HLTH | 061, 011 |
| ISSUE-066 | Orchestrator learning + scope-aware result cache + cost-routing | C8 LRN, COST | 061, 074 |
| ISSUE-067 | Agent builder surface | surface-09 (renders C8 REG/SPC/PLAN/HLTH) | 062, 064, 065 |

### Epic I — Proactive intelligence

| ID | Title | FR groups | Blocked-by |
|---|---|---|---|
| ISSUE-068 | Proactivity modes + action-autonomy matrix (Prepare-only, OD-161) | C9 MODE | 056 |
| ISSUE-069 | Seven proactive generators (each enable/disable + thresholded) | C9 PRO | 051, 025 |
| ISSUE-070 | Suggestion lifecycle — persist/rank/explain/deliver/dismissal-learn (safety floor) | C9 SUG | 069, 068 |
| ISSUE-071 | Cold-start phase ladder + proactive suppression | C9 CST | 030, 069 |
| ISSUE-072 | Command dispatch + node-gating + custom commands (+ surface-10) | C9 CMD | 018, 053 |
| ISSUE-073 | User + agency dashboards (+ notification centre) | surface-07, surface-08 | 070, 075, 076 |

### Epic J — Observability & ops surfaces

| ID | Title | FR groups | Blocked-by |
|---|---|---|---|
| ISSUE-074 | Cost meter + per-task aggregation + ladder signal | C7 COST | 011, 001(spike) |
| ISSUE-075 | Alerting — seven rules + routing + escalation + notification centre + fails-loud | C7 ALR | 011 |
| ISSUE-076 | Real-time / polling contract + connection budget + degrade | C7 RTP | 011 |
| ISSUE-077 | Log retention/export + management-plane views + feedback flywheel | C7 MGM, VIEW, OPT | 011, 012 |
| ISSUE-078 | Ops dashboards (single-deployment + super-admin fleet console) | surface-05, surface-06 | 075, 076, 077 |
| ISSUE-079 | Mobile surface (responsive/PWA + web-push) | surface-12 | 075, 076, 056 |

### Epic K — Infrastructure & compliance

| ID | Title | FR groups | Blocked-by |
|---|---|---|---|
| ISSUE-080 | Release model — auto-deploy + canary/release-train gate + rollback-by-redeploy + version-skew alert | C10 DEP | 007 |
| ISSUE-081 | Schema-migration propagation + per-deployment failure isolation | C10 MIG | 008, 080 |
| ISSUE-082 | Individual right-to-erasure workflow (two-person auth, verify-before-done) | C10 DEL | 029, 021 |
| ISSUE-083 | Client offboarding workflow (export-verified → sign-off → freeze → hard-delete → meta-record) | C10 OFF | 012, 085 |
| ISSUE-084 | Retention configs + isolation (client_slug deleted) + residency + legal-review gate | C10 RET, ISO, LEG | 008, 010 |
| ISSUE-085 | Backup & DR — hourly off-platform dump + restore rehearsal + backup-health push | ADR-008, NFR-DR | 012, 004(spike) |

### Epic L — Config surfaces

| ID | Title | FR groups | Blocked-by |
|---|---|---|---|
| ISSUE-086 | Config admin + config-audit-log surfaces | surface-01, surface-01b | 010, 077 |

---

## Build-order tiers & critical path

Issues within a tier can be built in parallel; a tier's issues assume the prior tiers landed.

- **Tier 0 (spikes, run first / alongside):** 001 002 003 004 005 006 — gate their dependents; none blocks another.
- **Tier 1 (bootstrap):** 007 → 008. (007 stands up a client project; 008 the migration harness.)
- **Tier 2 (shared scaffold):** 009 010 011 012 042 048 032. (RLS scaffold, config store, observability skeleton, mgmt plane, prompt store, task_queue, connector runtime.)
- **Tier 3 (core models & safety):** 013 018 019 022 033 034 043 044 047 055 057 059 060 074 075 076 080 084.
- **Tier 4 (behaviour on the models):** 014 015 016 017 020 023 024 037 045 046 049 050 051 056 058 061 077 081.
- **Tier 5 (integration & specialists):** 021 025 027 030 035 036 038 052 062 064 065 068 069 082 085.
- **Tier 6 (composition & orchestration):** 026 028 029 039 040 041 053 063 066 070 071 072 083.
- **Tier 7 (surfaces & leaves):** 031 054 067 073 078 079 086.

**Critical path (longest dependency chain — verified acyclic, 11 nodes):**
`007 → 008 → 009 → 018 → 019 → 022 → 023 → 025 → 045 → 053 → 072`
i.e. **provisioning → migrations → RLS scaffold → roles → clearance → memory model → embeddings → retrieval → Layer-3 injection → run pipeline → command dispatch**. The run pipeline (ISSUE-053) is the highest-fan-in node (blocked by 7 issues: 043/045/048/055/056/057/061) — it is the integration keystone and should be resourced accordingly. **DAG validated 2026-07-03** (no cycles, every blocked-by/blocks edge resolves to a real issue — gate check (d)).

**Spike sequencing (OD-157):** each spike precedes the feature issues that name it in "Gate":
- 001 (cost) → 058, 074
- 002 (RLS latency) → 009, 023, 025
- 003 (injection) → 055, 059, and 020 (RLS.007 mid-task path)
- 004 (restore) → 085
- 005 (brute-force) → 014
- 006 (webhook) → 017 (→ 037, 047)

---

## Coverage ledger

Every FR AREA-group (C0–C10) and every NFR domain maps to ≥1 issue. Exact FR→issue rows are in
each issue's **Implements** section; this ledger proves no group is orphaned.

### FR coverage (by component AREA group → issue)

- **C0:** AUTH→013/014 · SESS→013 · INV→015 · SEED→015 · REC→016 · WHK→017
- **C1:** ROLE→018 · PERM→018 · CLR→019 · RST→019 · RLS→009(scaffold)+020(enforcement) · USR→021 · AUD→021
- **C2:** MEM→022 · ENT→022 · TAG→022 · ING→026 · WRT→024 · RET→025 · MNT→027(lifecycle)+028(conflict/consol)+029(erasure) · VEC→023 · MAT→030
- **C3:** CONN→032 · REG→032 · TOK→033 · RL→034 · ACT→035 · OPT→036 · TRIG→037 · OBS→039/040/041 · DSC→038
- **C4:** LYR→042 · STO→042 · CID→043 · PRIN→043 · BIZ→044 · TSK→044 · INJ→045 · OPT→046
- **C5:** TRG→047 · QUE→048 · GRP→049 · ENV→050 · LOP→051 · JOB→052 · ASM→053 · OPT→054
- **C6:** HRD→055 · APR→056 · ESC→056 · ANM→057 · RTL→058 · INJ→059 · LOG→060 · FMM→060 · OPT→060
- **C7:** LOG→011(001–006)+010(008 config-audit)+077(007 export) · RTP→076 · ALR→075(+011 watchdog ALR.008) · COST→074 · MGM→012+077 · VIEW→077(+078/073 render) · OPT→077
- **C8:** ORC→061 · REG→061 · SPC→062 · SCO→063 · PLAN→064 · HLTH→065 · LRN→066 · COST→066
- **C9:** MODE→068 · PRO→069 · SUG→070 · CST→071 · CMD→072
- **C10:** RET→084 · DEL→082 · OFF→083 · PRV→007 · MGT→012 · DEP→080 · MIG→081 · ISO→084 · LEG→084

### NFR coverage (by domain → issue)

- **NFR-SEC:** 001→007/084 · 002→012 · 003→010/033 · 004→055/003 · 005→055/058 · 006→059/003 · 007→045/059 · 008→017/006 · 009→014/005 · 010→009/020 · 011→020 · 012→020 · 013→056/079 · 014→072 · 015→082 · 016→021/082 · 017→085
- **NFR-INF:** 001/003/004→080 · 002→008/081 · 005→081 · 006→007 · 007→040/033 · 008→080 · 009→080 · 010→012 · 011→052 · 012→047/083 · 013→083 · 014→015/051
- **NFR-PERF:** 001/003→002+025 · 002/009→023 · 004→022 · 005→(infra, 007) · 006→045/025 · 007→049 · 008→050 · 010→051 · 011→076 · 012→066
- **NFR-OBS:** 001/002→011 · 003→011/060 · 004→011/075 · 005→065 · 006→012 · 007→011/056 · 008/009→075 · 010→011 · 011→078/073/079 · 012→043/073 · 013→074 · 014→076 · 015→065 · 016→060/075
- **NFR-A11Y:** 001→all surface issues (013–016,021,031,056,067,072,073,078,079,086 baseline) · 002→OOS-041
- **NFR-COST:** 001/002/003/004→058+074 · 005→074 · 006→001(spike) · 007→058 · 008→024 · 009→024 · 010→046/066
- **NFR-CMP:** 001→084 · 002→024 · 003/004→084 · 005→082/029 · 006→010/011 · 007→082/029 · 008→083 · 009→083/077 · 010→026 · 011→084
- **NFR-DR:** 001–007→085 · 008→011/060 · 009→085/082
- **NFR-TEST:** the AF de-risking schedule governs the **Verification** field of every issue; the six launch-gating AFs are ISSUE-001–006; build-time AFs are attached to the issues they gate as DoD notes (`test-strategy.md`).

**Orphan check:** no FR AREA-group and no NFR domain is unclaimed (gate check (a)); every issue names ≥1 FR/NFR/ADR/AF (gate check (b)). To be re-proven by the verification gate before sign-off.

---

## Status roll-up

| Phase-6 step | State |
|---|---|
| 1 Harvest / coverage | ✅ done (fan-out → `_harvest/frag-*.md`) |
| 2 `id-conventions.md` amend | ✅ done (`ISSUE-<nnn>` change-control note) |
| 3 Cut slices | 🔄 roster defined here; issue files being drafted |
| 4 Dependency map + backlog | ✅ this file (tiers, critical path, coverage ledger) |
| 5 Gap-sweep → change-control | ⚪ pending |
| 6 Open decisions | ⚪ pending |
| 7 Verification gate (a–f, incl. per-issue self-sufficiency) | ⚪ pending |
| 8 GitHub mirror | ⚪ pending (operator confirm — outward-facing) |
| 9 Wire matrix + README + sign-off | ⚪ pending |
