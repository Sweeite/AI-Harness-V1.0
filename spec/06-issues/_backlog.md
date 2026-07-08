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
| **M** | Frontend (Next.js app-shell + per-surface render — [[OD-197]]) | 087 |

---

## Issue roster

Legend: **FR groups** = the component AREA groups the issue implements (exact FR/AC IDs live in the
issue file). **Gate** = a launch-gating spike (ISSUE-00x) or build-time AF the issue rests on.

### Epic S — Launch-gating spikes (OD-157, RP-1)

| ID | Title | FR/NFR focus | Blocked-by | Gate proves |
|---|---|---|---|---|
| ISSUE-001 ✅ **done** | SPIKE: cost viability ≤~$20/day typical — **PASS $2.09/day** (AF-001 🟢, 2026-07-03; harness `spikes/issue-001-cost-viability/`) | NFR-COST.006, AF-001 | none | AF-001 |
| ISSUE-002 ✅ **done** | SPIKE: RLS hot-path latency — **PASS** (AF-067 🟢, 2026-07-04; initPlan 1.06 ms/stmt once-per-stmt, lint PASS, p95 0.9 ms; harness `spikes/issue-002-rls-latency/`). ⚠️ surfaced AF-019 planner-seqscan-under-RLS cliff (~300×) → hard ISSUE-023 requirement | NFR-PERF.001/003, AF-067 | none | AF-067 |
| ISSUE-003 ✅ **done** | SPIKE: injection containment red-team — **PASS** (AF-068 🟢, 2026-07-04; 12/12 attacks contained, 8 evasion payloads reached the model yet blocked by the code gate, 4/4 negative controls pass, mutation-tested; harness `spikes/issue-003-injection-containment/`). Clears AF-068 for ISSUE-020/055/059 (they retain other blockers) | NFR-SEC.004/006, AF-068 | none | AF-068 |
| ISSUE-004 ✅ **done** | SPIKE: restore actually works — **PASS (Path B)** (AF-069 🟢, 2026-07-04; R8 you-present, real off-platform pg_dump→pg_restore into a throwaway Supabase project: 5000/5000 memories + embeddings intact, 25/25 auth.users restored + resolvable, RTO 19.4s; Supabase-correct restore = public clean + auth.users data-only into the managed auth schema; harness `spikes/issue-004-restore-rehearsal/`). ⚠️ Path A (in-project/PITR restore) not exercised — residual before go-live. Unblocks ISSUE-085 (retains other blockers) | NFR-DR.003, AF-069 | none | AF-069 |
| ISSUE-005 ✅ **done** | SPIKE: brute-force / credential defense — **PASS** (AF-077 🟢, 2026-07-04; R8 you-present, live throwaway Supabase Auth project, Turnstile CAPTCHA observed live + leaked-pw on Pro; per-account soft-lock halts scripted single + simulated multi-IP attack before any session mints, 2FA soft-lock, 2 Super-Admin alerts; harness `spikes/issue-005-brute-force-defense/`). Unblocks ISSUE-014 (AF-077 gate clear; retains other blockers) | NFR-SEC.009, AF-077 | none | AF-077 |
| ISSUE-006 ✅ **done** | SPIKE: webhook forgery / replay rejected — **MECHANICS PASS** (AF-078 🟡, AF-090 DOCS-resolved, 2026-07-04; MODE-M harness 17/17: raw-body-before-parse + constant-time + replay proven; Slack symmetric = real proof; Google OIDC mechanics; GHL signing = raw-body-only Ed25519 + public key from GHL docs). **Live per-connector vendor confirmation deferred to onboarding (OD-172)** — operator has no GHL account; owed on ISSUE-017/039/040/041 before each connector ships. Harness `spikes/issue-006-webhook-forgery/` | NFR-SEC.008, AF-078 | none | AF-078 |

### Epic A — Platform foundations

| ID | Title | FR groups | Blocked-by |
|---|---|---|---|
| ISSUE-007 | Provisioning + per-client Supabase bootstrap | C10 PRV | none |
| ISSUE-008 | Migration harness (expand-contract) + 0001 baseline | C2 VEC.002, migrations.md | 007 |
| ISSUE-009 ✅ **done** | RLS scaffold — helpers, default-deny, 100% coverage CI gate — **DONE (session 65, 2026-07-05):** `app/silo` migration 0002 (4 helpers + `default_deny` on all 44 tables) + `rls-lint.ts` (auth_rls_initplan + coverage lints, `lint:rls`); offline 55/55 + LIVE capstone (service_role bypass · grant/revoke instant · InitPlan · coverage green). **AF-079 🔴→🟢.** GitHub #9 closed. | C1 RLS.001/004/006 | 008, 002(spike) |
| ISSUE-010 ✅ **done** | Config store + secret manifest + config-audit-log immutability — `app/config-store/` + migration 0003 (config_values key-prefix RLS); 14/14 + LIVE capstone 7/7 (session 66). Independent verify caught a #2 key-map BLOCKER → rebuilt from the registry (147 keys), [[OD-181]]. GitHub #10 | C7 LOG.008 | 008 |
| ISSUE-011 ✅ **done** | Observability skeleton — event_log append-only + silent-failure detector + alert-engine watchdog + escalate-don't-abandon — `app/observability/` (app-code, no migration); 27/27 + LIVE 5/5 (session 66). AF-118/120 🟢, AF-119 🟡 (seam proven; durability at 012). Retention-DELETE BLOCKER → [[OD-180]] retention-prune whitelist (migration 0005). GitHub #11 | C7 LOG.001–006, ALR.008, RTP core | 008 |
| ISSUE-012 | Management-plane bootstrap — client_registry + ingest endpoint + health push | C10 MGT, C7 MGM | 008, 011 |

### Epic B — Identity & Access

| ID | Title | FR groups | Blocked-by |
|---|---|---|---|
| ISSUE-013 | OAuth login + session lifecycle (+ surface-00 login/reauth) | C0 AUTH(OAuth), SESS | 009 |
| ISSUE-014 | Super-Admin password + TOTP 2FA + brute-force defense (+ surface-00 2FA) | C0 AUTH(pw/2FA/009) | 009, 005(spike) |
| ISSUE-015 | Invite + seed bootstrap (+ surface-00 invite-setup) | C0 INV, SEED | 009, 013 |
| ISSUE-016 | Support-request recovery intake (+ surface-00 support-requests) | C0 REC | 013 |
| ISSUE-017 ✅ **done** | Webhook authentication, per-vendor (Ed25519/JWT/HMAC + replay) — `app/webhook-auth/`, 18/18 AC battery + independent verification (session 63, 2026-07-05); live per-connector confirmation owed at onboarding (OD-172), event_type enum extended (OD-179) | C0 WHK | 006(spike) |
| ISSUE-018 | Role model + permission matrix + `can()` gate | C1 ROLE, PERM | 009 |
| ISSUE-019 ✅ **done** | Clearance + Restricted model — `app/rbac/src/clearance.ts` (four tiers + OD-186 per-role default seed + grant/revoke + review cadence + Restricted grants + never-auto-inject rule); 45 tests + LIVE capstone; independent verify caught 2 real defects (OD-186/OD-187), both fixed (session 70, 2026-07-06). The Stage-4 GATE. | C1 CLR, RST | 018 |
| ISSUE-020 ✅ **done** | RLS enforcement — **DONE (session 76, 2026-07-08):** migration `0031` (LIVE, head 0031) — `user_visibility` helper + `roles.visibility_tiers` (OD-168), memories clearance predicate (visibility∩sensitivity∩Restricted, no client_slug), entities Internal-Org wall, RBAC-self read policies + grants, universal aal2 retrofit + CI aal2-lint. `app/rls-enforcement/` — FR-1.RLS.007 mid-task authz re-check + FR-1.RLS.008 divergence signal. silo 76/76 + rls-enforcement 12/12 + R10 live capstone GREEN (caught 2 real bugs). AF-076/079/080 realized. Dependent `024` → ready. GitHub #20 CLOSED. | C1 RLS.002/003/005/007/008 | 009, 019; RLS.007 → 003(spike) |
| ISSUE-021 ✅ **done** (S77) | User management lifecycle + RBAC audit (+ surface-02) | C1 USR, AUD | 018, 019 |

### Epic C — Memory

| ID | Title | FR groups | Blocked-by |
|---|---|---|---|
| ISSUE-022 ✅ **done** | Memory + entity model + sensitivity/visibility tagging — **DONE (session 75, 2026-07-08):** `app/memory/` (port+fake+live adapter) — deterministic entity resolution (ambiguity flagged, never guessed), Internal-Org singleton, orthogonal visibility×sensitivity tags. Delta migrations `0029` (Internal-Org partial-unique guard) + `0030` (entity_types seed) applied LIVE (head 0030). 18/18 offline (17 AC + AF-082 EVAL: false-merge=0) + R10 live-smoke green (caught 1 fake-vs-DB divergence). AF-082 🟡 (seed-EVAL proven; at-scale = fast-follow). Committed `ab6e415`; GitHub #22 CLOSED. | C2 MEM, ENT, TAG | 008, 019 |
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
| ISSUE-038 🔨 **in-progress** (S79, live-close pending) | Disconnection + recovery — `app/disconnection-recovery/` built + adversarially verified + fixed (23/23 + `check` + typecheck); migrations `0034`/`0035`/`0036` authored discipline+RLS-clean, NOT applied; [[OD-200]] logged. R10 live smoke + live migrations = morning pass. | C3 DSC | 033 |
| ISSUE-039 | GHL connector instance | C3 OBS.001 (+GHL TOK/TRIG) | 033, 034, 037 |
| ISSUE-040 | Google connector instance (Gmail/Drive/Calendar) | C3 OBS.002 | 033, 034, 037 |
| ISSUE-041 | Slack connector instance | C3 OBS.003 | 033, 034, 037 |

### Epic E — Prompt & reasoning

| ID | Title | FR groups | Blocked-by |
|---|---|---|---|
| ISSUE-042 ✅ **done** | Prompt layer model + storage + version-never-overwrite — `app/prompt-store/` + migration 0004 (version-discipline trigger + prompt_layers RLS); 14/14 + LIVE 7/7 (session 66); independent verify SAFE. GitHub #42 | C4 LYR, STO | 008 |
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
| ISSUE-052 ✅ **done** (S77) | Inngest execution engine + step retry + fan-out + DLQ | C5 JOB | 049 |
| ISSUE-053 | Run pipeline — prompt-stack assembly + gates (RBAC/approval/anomaly) + memory injection + answer-mode + completion dual-record | C5 ASM | 043, 045, 048, 055, 056, 057, 061 |
| ISSUE-054 | Execution optimisation (parallel DAG, scheduling, decomposition, pre-warm) | C5 OPT | 049, 052 |

### Epic G — Guardrails / safety

| ID | Title | FR groups | Blocked-by |
|---|---|---|---|
| ISSUE-055 | Seven hard limits — code enforcement, un-overridable | C6 HRD | 011, 003(spike) |
| ISSUE-056 | Approval tiers + mandatory-hard set + escalation/flagged workflow (+ surface-04 approval queue) | C6 APR, ESC | 048, 076 |
| ISSUE-057 | Five pre-step anomaly checks (signal-not-gate, baseline learning) | C6 ANM | 011 |
| ISSUE-058 ✅ **done** (S77) | Rate-limit guardrails + cost-ladder enforcement | C6 RTL | 034, 074; ladder → 001(spike) |
| ISSUE-059 | Injection sanitization pipeline (4-step) + quarantine (retain+route-to-human) | C6 INJ | 011, 003(spike) |
| ISSUE-060 | guardrail_log + no-silent-failure invariant + approval/anomaly learning | C6 LOG, FMM, OPT | 011 |

### Epic H — Agent design / routing

| ID | Title | FR groups | Blocked-by |
|---|---|---|---|
| ISSUE-061 | Orchestrator + 7-step routing + agents registry | C8 ORC, REG | 042, 048 |
| ISSUE-062 ✅ **done** (S77) | Eight specialist definitions + per-agent hard limits (Comms never-sends, Finance never-transacts, Memory sole-writer) | C8 SPC | 061, 043 |
| ISSUE-063 | Per-agent memory scoping (retrieval filter) | C8 SCO | 062, 025 |
| ISSUE-064 | Execution plans + per-step failure-mode assignment | C8 PLAN | 061, 052 |
| ISSUE-065 ✅ **done** (S77) | Agent health / drift / dead-agent (flag-never-auto-correct) + producer heartbeat | C8 HLTH | 061, 011 |
| ISSUE-066 | Orchestrator learning + scope-aware result cache + cost-routing | C8 LRN, COST | 061, 074 |
| ISSUE-067 | Agent builder surface | surface-09 (renders C8 REG/SPC/PLAN/HLTH) | 062, 064, 065 |

### Epic I — Proactive intelligence

| ID | Title | FR groups | Blocked-by |
|---|---|---|---|
| ISSUE-068 ✅ **done** (S77) | Proactivity modes + action-autonomy matrix (Prepare-only, OD-161) | C9 MODE | 056 |
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

### Epic M — Frontend ([[OD-197]] — the render layer the 86-issue backlog under-scoped)

| ID | Title | FR groups | Blocked-by |
|---|---|---|---|
| ISSUE-087 ✅ done (S78) | Frontend substrate — Next.js app-shell (client + super-admin) that every surface renders into (UI analog of 008; RBAC nav reuses `can()` nodes; honest-state primitives; data-access seam) — `web/` workspace (shared design system + rbac-bridge + web/client + web/admin); 11/11 shared tests; both apps boot + typecheck; RBAC/aal2/honest-state/seam live-verified; skin-swappable per OD-197 | surface-00 + all surface render hosts | 007, 013, 018 (all done) |

*(Frontend track, per [[OD-197]]: `087` substrate gate → walking skeleton → per-surface **render** layers, each gated on its own backend signal `done`. The per-surface render decomposition — reframing each surface issue with a render sub-deliverable, or minting render issues — is a `to-issues` pass owed once `087` lands.)*

---

## Build-order tiers & critical path

> **Followable version:** `BUILD-SCHEDULE.md` re-expresses this order as 11 strict dependency waves
> (finer than the 7 tiers below — the tiers contain a few internal chains, e.g. `018→019→022` all sit
> in Tier 3) with per-stage test checkpoints and a safety contract. Use it to build; use this section
> for the canonical tiers/critical-path/DAG it derives from.

Issues within a tier can be built in parallel; a tier's issues assume the prior tiers landed.

- **Tier 0 (spikes, run first / alongside):** ~~001~~ ✅ · ~~002~~ ✅ · ~~003~~ ✅ · ~~004~~ ✅ · ~~005~~ ✅ · ~~006~~ ✅ (mechanics/OD-172) — gate their dependents; none blocks another. (001 done 2026-07-03 — AF-001 PASS. 002 done 2026-07-04 — AF-067 PASS; surfaced AF-019 planner cliff → ISSUE-023. 003 done 2026-07-04 — AF-068 PASS; containment red-team, 12/12 attacks contained + mutation-tested. **004 + 005 + 006 DONE 2026-07-04 (Sessions 55–57): AF-077 🟢 (brute-force — Turnstile CAPTCHA observed live + per-account soft-lock halts the attack), AF-069 🟢 (restore — Path B off-platform pg_dump→pg_restore into a throwaway: 5000 memories+embeddings + 25 auth.users restored, RTO 19.4s), and AF-078 🟡 MECHANICS PASS + AF-090 DOCS-resolved (webhook — MODE-M 17/17; GHL live confirmation deferred to onboarding per OD-172, operator has no GHL account). All six Stage-0 spikes cleared for Checkpoint-0 (001–005 green + 006 mechanics/OD-172); the last Stage-0 item was the 007 GATE. **007 is `done` (Sessions 58–61) and ✅ CHECKPOINT 0 is CLOSED (2026-07-04):** AF-004 🟢 (session 60 — live provisioning on real Railway + client-owned Supabase, evidence `app/provisioning/results/af-004-evidence.2026-07-04.md`) + session 61 landed the §10 remainder — canary live seed (`SupabaseSeed`, real OpenAI embeddings + idempotent live upsert, evidence `app/canary/results/live-seed-evidence.2026-07-04.md`) and `RailwayInfra` codification (`app/provisioning/src/infra.ts`). Login-OAuth re-gated to onboarding (OD-175); C0/C1 seed §2-Out. **Stage 1 (008) is now OPEN (R1).** Tracked residuals: AF-069 Path A (PITR restore) · AF-078/AF-090 per-connector live webhook at onboarding · AF-066 canary representativeness · AF-142/143 Workspace-token scripted-provisioning re-run · ISSUE-009 RLS on the silo before real client data.**)
- **Tier 1 (bootstrap):** ~~007~~ ✅ → ~~008~~ ✅. (007 stands up a client project; 008 the migration harness.) **008 `done` 2026-07-04 (session 62):** `app/silo/` — migration 0001 (44 tables · 43 CONCURRENTLY indexes · RLS-enable/default-deny · idempotent seed) + the `pg` migrate runner + expand-contract discipline CI gate; applied LIVE to the canary silo, **AF-065 🟢** (mixed-fleet spike). Evidence `app/silo/results/live-capstone-evidence.2026-07-04.md`. **`017` `done` (session 63)** + **`080` `done` (session 64, 2026-07-05):** `app/release/` — the release/canary model (4-gate promotion, rollback-by-redeploy, version-skew alert, plugins-out-of-train) + `.github/workflows/ci.yml` merge gate; **LIVE capstone proved the train** (OD-173 Wait-for-CI spike PASS → **AF-064 🟢**: green push auto-deploys the canary, red own-suite blocks it; operator promote `release`→`main` → production/fleet auto-deployed). **✅ CHECKPOINT 1 CLOSED (session 64)** — Stage 2 (`009` gate + `010`/`011`/`042`/`081`, all now `ready`) is OPEN (R1). Migrate-on-release mechanics = `081` (§2-Out).
- **Tier 2 (shared scaffold):** ~~009~~ ✅ ~~010~~ ✅ ~~011~~ ✅ ~~042~~ ✅ ~~081~~ ✅ · 012 048 032. (RLS scaffold, config store, observability skeleton, mgmt plane, prompt store, task_queue, connector runtime.) **✅ CHECKPOINT 2 CLOSED (session 67, 2026-07-05):** `081` (migration propagation + per-deployment failure isolation) `done` — `app/release/propagation.ts`+`corpus.ts`, offline 27/27 (9 propagation ACs) + independent verify SAFE; fleet orchestration + failure isolation + no-fork + fail-loud proven offline, the live migrate mechanism pre-proven (ISSUE-008 live) + **AF-065 🟢** (mixed-fleet) + **AF-020 🟢** (Pre-Deploy blocks cutover) carrying the rest; the live `preDeployCommand` wiring on `app/service` is **onboarding-owed** (ISSUE-012 era, Railway credit). Whole-repo offline sweep green (9 pkgs). **Stage 3 (gate `018` + 16-issue batch) OPEN (R1).** **010/011/042 `done` 2026-07-05 (session 66)** via a parallel fan-out (3 worktree agents → offline build; orchestrator serialized migrations 0003/0004 + authored 0005; independent per-issue verification; LIVE Stage-2 checkpoint applied 0003/0004/0005 + ran 3 capstones, all green). The checkpoint caught 4 real defects offline missed: a latent redaction-tombstone bug in the shared append-only trigger (fixed in 0005), missing `grant select to authenticated` on the RLS read tables (0001c over-revoked; fixed in 0003/0004), a #2 config key-map cross-route ([[OD-181]]), and the retention-DELETE-vs-immutability fork ([[OD-180]], operator Option A). *(At session 66 Checkpoint 2 remained OPEN pending `081`; closed session 67 — see the roll-up above.)* **009 `done` 2026-07-05 (session 65) — the Stage-2 GATE:** `app/silo/migrations/0002_rls_scaffold.sql` (4 SECURITY-DEFINER helpers + `default_deny` baseline on all 44 tables + tail coverage assertion) + `src/rls-lint.ts` (auth_rls_initplan wrap lint + coverage lint wired into `check` + `lint:rls` live gate). Offline 55/55 + LIVE silo capstone (all live-owed ACs green, rolled back). **AF-079 🔴→🟢.** *(Session-65 state: Stage-2 batch `010`/`011`/`042`/`081` remaining, Checkpoint 2 OPEN — all now `done`/CLOSED as of session 67.)* 009's dependents (013/014/015/018/020) become `ready` as Stage 3 opens.
- **Tier 3 (core models & safety):** ~~018~~ ✅ · 013 019 022 033 034 043 044 047 055 057 059 060 074 075 076 080 084. **`018` (role model + permission matrix + `can()` gate — the Stage-3 GATE) `done` 2026-07-05 (session 68):** `app/rbac/` — six-role seed + runtime CRUD + the 55-node catalog (homed from `PERMISSION_NODES.md`) + the single default-deny `can()` gate reading the same tables the ISSUE-009 RLS helper does (AF-080 non-drift). Offline 24/24 + `check` (CATALOG ≡ `.md`, 13 categories, fail-closed) + LIVE capstone + two-session concurrency spike. **Independent verify caught 2 MAJORs (advisory-lock write-skew + tautological AF-080 differential), both fixed + re-proven LIVE. AF-080 🔴→🟡** (part-b runtime signal = ISSUE-020). No new migration (seed is app code, §5). GitHub #18 closed. **Checkpoint 3 OPEN — the 16-issue batch is next (R4); ⚡ marquee fan-out.** 018's dependent `019` is now `ready` (Stage 4 open); `021`/`072` stay `blocked` — their stages (5/10) aren't open yet. **Stage-3 batch fan-out ran session 69 (Phase C):** 15 offline-authorable issues (013/032/043/044/046/047/048/055/057/059/060/074/075/076/084) built + adversarially verified + fixed + integrated onto main — **203 tests green**, migrations `0006–0009` authored + discipline-clean (head `0005`→`0009`, NOT yet live). All 15 flipped `ready → in-progress`; **012 + 014 stay `ready`** (serial/you-present). [[OD-182]] (audit-trigger escalation widening) + OD-183 (032 CONN.005.2 scope defer) logged. **No done-flips / no Checkpoint-3 tick** — the live silo apply of `0006–0009` + 012/014 + the Checkpoint-3 integration test are Phase D/E (operator-present). Config-key registration deferred (OD-181-coupled; keys fail-closed-safe, documented in each package `results/`). **✅ Phase D/E DONE (session 69, 2026-07-06) → CHECKPOINT 3 CLOSED → STAGE 4 OPEN (R1):** migrations `0006–0010` applied LIVE (head `0005`→`0010`; two bugs caught+fixed live — a `;`-in-comment splitter trap in `0007`, a NULL-comparison flaw in the `0009` trigger → corrective `0010`); **[[OD-182]] proven LIVE** (all 6 assertions — in-place reject · escalation stamp accept · re-stamp reject · content immutable · discard-retains · delete-reject). `012` + `014` built serial with the operator (32/32 + 15/15); **`012` live-proven** on the mgmt Supabase (server `last_push_at`/AF-120, dedup, token-revoke, FK cascade). Whole 17-batch offline sweep **260/0**. Checkpoint-3 three-non-negotiables re-checked LIVE (R7). All 17 `done`. Config-key leftover resolved [[OD-184]] (keys pre-registered, 076 name bug fixed). Live-owed residuals tracked (onboarding, non-blocking): `014` attack-sim (AF-077 🟢) · `047` AF-135 [[OD-185]] · `013` OAuth [[OD-175]] · `084` legal gate. GitHub #12–14/32/43/44/46/47/48/55/57/59/60/74/75/76/84 closed.
- **Stage 4 (behaviour on the models) — GATE `019` `done` (session 70, 2026-07-06):** `app/rbac/src/clearance.ts` on the `018` `can()` gate — four-tier clearance model + OD-186 per-role default seed (HR→Team Member, AM→Client, Finance→{Invoice, Contract/Retainer, Financial Period, Deal}) + clearance grant/revoke + review cadence (both branches non-silent) + Restricted per-individual grants + never-auto-inject rule. **45 tests + `check` + LIVE capstone** (exactly-one-subject CHECK · mandatory-reason NOT NULL · hard/soft revoke · access_audit append-only). Independent adversarial verify caught **2 real defects — both fixed + pinned:** a #1 BLOCKER (sweep would auto-revoke role-default clearances → **OD-187** user-scoped-only) + a #3 MAJOR (live `actor_type` mislabel → threaded through). No new migration (head `0010`). GitHub #19 closed. **R3 gate closed serial/hardest-first; the 14-issue Stage-4 batch (`015`/`016`/`033`/`034`/`035`/`036`/`037`/`049`/`050`/`051`/`056`/`061`/`077`/`085`, all `ready`) may now fan out.** **🔨 Offline batch fan-out DONE (session 71, 2026-07-07):** the **11 offline-authorable** members (`015`/`016`/`034`/`035`/`036`/`049`/`050`/`051`/`056`/`061`/`077`) built via a worktree-isolated fan-out (11 author agents → independent adversarial verify) + integrated onto main — one `app/<slug>/` package each, all green + typecheck-clean (015=31/31·016=20/20·034=23/23·035=7/7·036=7/7·049=13/13·050=6/6·051=14/14·056=26/26·061=35/35·077=38/38). Adversarial verify caught **2 real BLOCKERs** (015 stubbed live activation + enum drift; 049 `idempotency_ledger` incompatible re-declare) — both the fake-passes-offline/live-throws class, **fixed + re-verified** (survived a mid-run power loss; work was committed on worktree branches). **Migrations `0011–0017` authored + discipline-gate clean; APPLIED LIVE + verified (session 71)** (head `0010`→`0017`): `0011` +16 event_type/+1 alert_type · `0012` rate_limit_deferred+RLS · `0013` task_graph_versions append-only · `0014` support_requests RLS · `0015` guardrail_log redacted_at + redaction branch ([[OD-074]], preserves the OD-182 escalation branch) · `0016` agents version-lineage · `0017` CONCURRENTLY indexes. **Verify-present:** 056's escalation-stamp branch already done by OD-182/0009 (not re-authored). **[[OD-188]]** (056 Hold live-persist) + **[[OD-189]]** (061 awaiting_clarification) logged, deferred. Config-key registration for 034(×5)/051(×6) deferred to Checkpoint-4/onboarding (OD-181-coupled, fail-closed-safe). schema.md/rls-policies.md mirrored. 11 flipped `ready → in-progress`; **`033`/`037`/`085` (live/🧑) stay `ready`, batched into the Checkpoint-4 operator session; no done-flips / no Checkpoint-4 tick.** **Next: Checkpoint-4 live session** — `0011–0017` APPLIED LIVE ✅. **3 live members built offline (session 71 cont.):** `033` 25/25 (cap-surfacing AC fixed) · `037` 28/28 (fake-`audit`-drift fixed → `access_audit`; +silo `0018`) · `085` 16/16 verify PASS (+mgmt `0003_backup_dr`) — all `in-progress`, residuals tracked. **Next: Checkpoint-4 live session** — live-apply `0018`+mgmt`0003`, 085 rehearsal, integration test → then flip all 14 `done`. **✅ CHECKPOINT 4 CLOSED (session 71, 2026-07-07):** all 14 batch members `done`; migrations `0011–0020` applied live; a **full live-adapter review** (correctness + a per-package rolled-back `live-smoke.sql`, 14/14 pass live) caught + fixed **3 BLOCKERs (015 profiles-FK · 056 actor_type · 037 tools-version-lock → OD-190 own-tables rework) + 3 MAJORs** the offline suites missed; R7 three-non-negotiables re-checked live. **Stage 5 OPEN (R1):** gate `022` + `021`/`038`/`039`/`040`/`041`/`078`/`079`/`083`/`086` now `ready`. *(Roster-table note: the static Issue-roster above marks `017`/`018`/`019` ✅ but the other Stage-3 dones are not individually ticked there — the authoritative boards are BUILD-SCHEDULE + this roll-up; the roster is a dependency reference, reconcile if it's ever used as a status board.)*
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
