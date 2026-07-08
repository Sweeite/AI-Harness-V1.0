# Session Log

Reverse-chronological. One entry per working session. This is cross-session memory — the
next session reads the top entry to know exactly where to resume.

---

## Session 76 — 2026-07-08 — 🔒 **Stage-5 BATCH `020` (RLS ENFORCEMENT) BUILT + live-verified — the #2-critical enforcing RLS on top of the 009 scaffold: visibility∩sensitivity∩Restricted∩aal2 + the harness mid-task authz re-check + the RLS/harness divergence signal.**

**Environment:** 💻 FULL (Mac). Live steps used (migration `0031` applied LIVE, head `0030`→`0031`; R10 live capstone rolled back). Serial build (the gate `022` was built alone last session; `020` is the first batch member, chosen because it's Checkpoint 5's second named closing pillar + the hardest/#2-critical of the batch — R3).

**Blockers/spikes verified GREEN first (R5):** `009`/`019`/`003`/`002` all `done`; **AF-067 🟢** (initPlan latency) + **AF-068 🟢** (containment red-team) both PASS — cleared to ship the RLS.002/003 predicates + the RLS.007 mid-task gate.

**① Migration `0031_rls_enforcement` (transactional, applied LIVE):**
- **`user_visibility(uid)`** — the fifth helper, DISTINCT from `user_perms` (OD-168). The genuinely-underspecified piece OD-168 left as a "Phase-4 build artifact" — resolved as a **`roles.visibility_tiers` role-attribute** (OD-168's sanctioned "small role-attribute" option, which keeps visibility OUT of ISSUE-018's PERM-node catalog per §5), seeded from the design-doc L509-615 Memory-Access matrix (Global=all six · Team=all but Standard User · Private=SA+Admin). Same `SECURITY DEFINER STABLE set search_path=''` + `(select …)`-wrap discipline (AF-067).
- **`memories_clearance_read`** — the marquee: `aal2 ∧ user_visibility ⊇ [visibility] ∧ (sensitivity∉{confidential,personal} ∨ entity-type-scoped clearance) ∧ (sensitivity≠restricted ∨ live per-individual grant)`. NO `client_slug` (AC-1.RLS.003.2). `entities_internal_org_read` — Internal-Org walled behind a Confidential clearance.
- **RBAC-self read policies** (roles/role_permissions/user_roles/sensitivity_clearances/restricted_grants/access_audit) per rls-policies.md, aal2-gated, **+ `grant select … to authenticated`** (0001c revoked base grants — a policy filters rows but the privilege must exist first; the missing grant was the first live-capstone failure).
- **Universal aal2 retrofit** — non-destructive `ALTER POLICY` adds the aal2 conjunct to the four grant policies that predate the rule (profiles ×2, prompt_edit, config_prompts_edit, config_values_read). A live tail assertion + the new CI lint prove no `authenticated` GRANT policy omits aal2.

**② `src/rls-lint.ts`:** `user_visibility` added to the guarded-call set; new **`checkAal2Coverage`** lint (create+alter aware, last-write-wins so the ALTER retrofit reads as covered) wired into `checkAllRls`. 6 new unit tests.

**③ `app/rls-enforcement/` (NEW package — the harness half, which RLS can't enforce, ADR-006 part 6):** `recheck.ts` (FR-1.RLS.007 mid-task authz re-check — binds originating_user_id, re-evaluates active + relied-on clearances/grants at each boundary, **halt+quarantine before the next consequential side effect** on deactivation/revocation, **continue on benign expiry** because the rule keys only on authz DATA not session liveness = expiry≠revocation, **fail-closed** on unknown user); `divergence.ts` (FR-1.RLS.008 — harness-permitted-but-RLS-zero-rows → `rls_harness_divergence`, never silent); `store.ts` (port + InMemory fake); `supabase-store.ts` (live adapter); `index.ts` (`check`: the two event_type constants non-drift-guarded vs the live 0001 enum).

**④ Tests — offline GREEN:** silo **76/76**, rls-enforcement **12/12** (one per AC-1.RLS.007.1/.2/.3 + NFR-SEC.012.1/.2 + fail-closed + AC-1.RLS.008.1) + both `check`s; typecheck clean.

**⑤ R10 live capstone (`app/silo/results/issue-020-rls-enforcement-capstone.sql`, rolled back) — ALL PASS** vs the real silo as a genuine `authenticated` session: aal1→**0 rows** (AC-1.RLS.005.1) · under-cleared→only global/standard (AC-1.RLS.003.1) · confidential/finance grant **instant** on next query (AC-1.RLS.006.1) · hr-scoped clearance does NOT reveal a finance row (entity-type scope) · Restricted grant reveals / revoke hides (FR-1.RLS.003) · Internal-Org wall · service_role bypass · the rls-enforcement adapter reads+appends. **The capstone caught+fixed 2 real bugs pre-commit** — the `= any((select …))` subquery-vs-array operator error, and a clause-A logic bug that made every `restricted` row unreadable (restricted isn't a `clearance_tier`, so it must pass the clearance clause and be gated by the grant). Exactly the class R10 exists to catch.

**⑥ Feasibility:** **AF-076** (aal2 coverage) → 🟡 (RLS half 🟢; app-layer enrollment gate owed to C0/ISSUE-014); **AF-080** (harness/RLS divergence) → 🟢 (part b built); AF-079 🟢 holds. AF-067/068 gated the ship (already 🟢). AC-NFR-SEC.011.1/.2 remain **boundary-only** (the fail-closed `memory_scope` filter is ISSUE-025/C8).

**Tracker reconcile (Rule 0):** `020` frontmatter `ready → done` (+ §10 evidence); **`024` flipped `blocked → ready`** (co-blockers `022`+`020` both `done`); BUILD-SCHEDULE `020` ticked; `_backlog` roll-up; feasibility AF-076/080; README status; traceability `test` column wired for the 5 RLS FR rows; GitHub #20 CLOSED.

**Found (out of scope — flagged, not fixed):** `profiles` has NO `authenticated` SELECT grant (0006/ISSUE-013 never granted it) → `profiles_owner_read` is currently dead (permission-denied). Fail-CLOSED (denies, no leak) but a real latent gap in the ISSUE-013 slice; flagged for that issue (a task chip was spawned).

**Next step:** **Checkpoint 5 stays OPEN.** Two of its three closing conditions are met (`022`✅ entity resolution links-not-fragments + `020`✅ RLS end-to-end incl. the service_role mid-task revocation path). The remaining Stage-5 batch must still prove as a group: `021` (user mgmt + RBAC audit) · `038` (disconnection) · `039`/`040`/`041` (GHL/Google/Slack connectors — each needs a research dossier gate first) · `052` (Inngest) · `058` (rate-limit) · `062` (specialists) · `064` (exec plans — was blocked on `052`) · `065` (agent health) · `068` (proactivity) · `078`/`079` (ops/mobile surfaces) · `083` (offboarding) · `086` (config admin). Then Checkpoint 5's integration test → only then may Stage 6 open (R1). **Silo head `0031`; next free tag `0032`.** Committed to `main` (not pushed — operator pushes/deploys). Live infra: `source ~/.ai-harness-secrets.env`; silo `$SILO_DB_URL`; psql `/opt/homebrew/opt/libpq/bin/psql`.

---

## Session 75 — 2026-07-08 — 🧠 **Stage-5 GATE `022` BUILT + live-verified — Memory + entity model + sensitivity/visibility tagging. The #1-critical entity foundation: knowledge LINKS, not fragments.**

**Environment:** 💻 FULL (Mac). Live steps used (migrations `0029`+`0030` applied live; R10 memory live-smoke, rolled back). Serial + hardest-first build (R3 — the gate is built alone; the 16-issue Stage-5 batch fans out only after this gate + Checkpoint 5).

**Design decision (up front):** ran NO design judge-panel. The entity model is **locked, not open** — OD-033 is 🟢 RESOLVED (deterministic precedence: `external_refs` → normalised name/type → create; ambiguity flagged, never guessed), ADR-002/003/004 Accepted, schema §3 DDL authoritative. A panel proposing "different resolution strategies" would re-litigate a resolved OD (Rule 0 / change-control forbids it). The genuine uncertainty is *does the locked resolver avoid fragmentation at scale* = **AF-082 (EVAL)**, proven by a harness AFTER the build, not a vote before.

**Pivotal ground-truth finding (reshaped the build):** the `entities`/`memories` tables, all four enums, the `(entity_ids, updated_at)` watermark + HNSW indexes, and the Internal-Org **seed** ALL already ship in the **0001 baseline (applied live)**. So per the Stage-2 "verify-present, add deltas — never `create table`" rule, this slice authored **delta-only** migrations; re-authoring the tables would have been the exact #1 collision the schedule warns against.

**① Migrations (delta-only, applied LIVE — silo head `0028`→`0030`):**
- **`0029_entities_internal_org_singleton`** (`transactional:false`) — a real DB **partial-unique guard** `on entities (is_internal_org) where is_internal_org`. The baseline had only a first-boot seed + an app-comment "the app never inserts a second" — NOT a guard; a 2nd `is_internal_org=true` would silently fragment the agency into two "self" entities (#1/#2). FR-2.ENT.003 mandated a real singleton.
- **`0030_entity_types_config_seed`** — the 22 default `entity_types` → `config_values` (CFG-entity_types; Internal Org locked-last). expected_slots deliberately NOT seeded (Maturity substrate = ISSUE-030, §2-Out). Discipline + RLS `check` green; migrate applied both live.

**② `app/memory/` package (new — house port+fake+live-adapter):** `entity-types.ts` (four enum domains + 22 default types), `memory.ts` (content hash + ADR-004 §4 idempotency key = `hash(source_ref, sorted entity_ids, content_hash)`), `store.ts` (`MemoryStore` port + `InMemoryMemoryStore` reference model + shared `validateMemoryRow`), **`resolution.ts`** (the #1-critical deterministic resolver — external_refs-first, conservative name/type match, **create-and-flag-for-merge on ambiguity, never a silent pick**; false-split favoured over false-merge because a duplicate is recoverable and a false-merge is an irreversible #2 leak), `tags.ts` (visibility most-restrictive-default, never-auto-Restricted guard, the orthogonal both-axes-evaluated-separately `admits()`), `supabase-store.ts` (live pg adapter), `index.ts` (`check`: 0030 seed ≡ constant non-drift guard, cf. rbac catalog↔0006).

**③ Tests — 18/18 offline + typecheck + `check`:** `memory.test.ts` **17/17** (one per §4 AC) + **`eval-af082.test.ts` AF-082 EVAL** (10 ground-truth cases: system-ID-bearing + free-text + name collisions + cross-type same-name → **false-merge=0 · every ambiguous mention flagged · false-split=0**). Silo `schema.test.ts` extended to 0030 (**68/68**).

**④ R10 live-adapter smoke (`app/memory/results/live-smoke.sql`, rolled back) — ALL ASSERTIONS PASSED:** proved the 0030 seed (22 incl. Internal Org), the **0029 guard** (2nd Internal Org → `unique_violation`), `insertEntity` external_refs round-trip, `insertMemory` happy path, **idempotency dedup** (ON CONFLICT DO NOTHING no-op), the **≥1-entity CHECK**, and the non-pointer confidence CHECK. **The smoke caught + fixed one real fake-vs-DB divergence** — `validateMemoryRow` forbade a `system_pointer` from carrying a confidence, but the shipped 0001 CHECK `(source='system_pointer' or confidence is not null)` enforces only the *one* direction (non-pointer ⟹ confidence present). Aligned the fake to the DB (kept the pointer→`source_ref` golden-rule rule as an app-level guard both stores apply). Exactly the class R10 exists to catch.

**⑤ AF-082 🔴→🟡:** resolver mechanics + risk posture **seed-EVAL-proven** (zero false-merge, conservative, ambiguity-flagged). The full at-scale EVAL over the AF-002 corpus stays the **onboarding fast-follow** (NFR-PERF.004 launch-gate = fast-follow, behind the FR-2.MNT.010 duplicate-cluster backstop). Honest flag, not a silent green.

**Tracker reconcile (Rule 0):** `022` frontmatter `ready → done` (+ §10 evidence); **`023` + `030` flipped `blocked → ready`** (023's co-blocker `002` is done; 030 had only 022) — **`024` stays `blocked`** (co-blocker `020` not built); BUILD-SCHEDULE `022` gate ticked + the stale migration-chain note fixed (`0026`→`0030`, next free `0031`); `_backlog` roll-up; feasibility AF-082 🟡 note; README status; traceability `test` column wired for the 10 C2 FR rows. **Also cleared a false alarm:** a context agent flagged FR-2.ENT.005 as OD-033-blocked — verified directly it is 🟢 RESOLVED (FR file line 228), no drift.

**Files changed:** `app/silo/migrations/0029_*.sql` + `0030_*.sql` (new) · `app/silo/migrations/_journal.json` · `app/silo/src/schema.test.ts` · `app/memory/` (new package: package.json, tsconfig, `src/{entity-types,memory,store,resolution,tags,index,supabase-store}.ts` + `src/{memory,eval-af082}.test.ts` + `results/live-smoke.sql`) · `spec/06-issues/ISSUE-022-*.md` (status+evidence) · `spec/06-issues/ISSUE-023-*.md` + `ISSUE-030-*.md` (status) · `spec/06-issues/BUILD-SCHEDULE.md` · `spec/06-issues/_backlog.md` · `spec/00-foundations/feasibility-register.md` · `README.md` · `traceability-matrix.csv` · `spec/SESSION-LOG.md`.

**Next step:** **Checkpoint 5 is OPEN — the R3 gate is built, so the 16-issue Stage-5 batch may now fan out** (`020` RLS enforcement 🔴 + `038` + connectors `039`/`040`/`041` + `052`/`058`/`062`/`064`/`065`/`068` + `021`/`078`/`079`/`083`/`086`). Checkpoint 5 closes when `022` entity-resolution links-not-fragments + `020` RLS-enforcement-end-to-end (incl. the service_role mid-task revocation path) both prove, then the batch as a group. **Silo head `0030`; next free tag `0031`.** **Committed `ab6e415` to `main` (operator-approved); GitHub #22 CLOSED with the build result** — the Rule-0 sync ritual is complete (frontmatter `done` · BUILD-SCHEDULE ticked · `_backlog` · SESSION-LOG · GitHub all in lockstep). **Not pushed** (local per the repo convention — the operator pushes/deploys). Live infra: `source ~/.ai-harness-secrets.env`; silo `$SILO_DB_URL`; psql `/opt/homebrew/opt/libpq/bin/psql`.

---

## Session 74 — 2026-07-07/08 — 🐛 **Adversarial LOGIC-bug sweep (54 found) + full fix pass + owed-OD implementation + smokes + Layer-3. All fixable work landed; residuals are all blocked-on-unbuilt-issues. Nothing pushed (all local).**

**Environment:** 💻 FULL (Mac). Live steps used (rolled-back smokes + migration 0027 apply). Much of this ran **autonomously overnight** (operator asleep) within a stated boundary: no push, no unattended NEW live migration on the foundation, no guessing a design fork (log an OD instead), hold anything uncertain.

**① Tracker reconciliation (item E):** flipped the 6 stale-`blocked` Stage-5 issues (`020`/`052`/`058`/`062`/`065`/`068`) → `ready` (all §7 blockers `done`); only `064` correctly blocked. `35f1755`.

**② Owed-OD implementation (session-73 A-track):**
- **OD-191** fail-loud sub-fix — `approval-tiers.buildQueueView` now THROWS "decoration persistence owed" (was silently-empty). `5fcbbdf`.
- **OD-192 FULLY IMPLEMENTED** — invite lifecycle on the `profiles` row. **Migration `0027_profiles_invite_lifecycle`** (`revoked_at`+`bounced_at`, additive) **APPLIED LIVE** (silo head 0026→**0027**). revoke/markBounced (txn+`for update`, idempotent), reissue/resend (gated re-deliver), `loadInviteLive` rejects revoked (#2) + reflects bounced (#3). Live-smoke #I1/#I2/#I3 PASS. Residual: reissue's true server-side token refresh = AF-074. `3a3d193`.
- **OD-193** doc-only — corrected the misleading "service_role runtime role" comments → "postgres owner (RLS-bypass)" across 15 adapters + **ADR-006 Amendment A1** (change-control). Comments-only, tsc clean. `8e0cfd9`.
- **OD-194** — assessed: full uuid wiring is BLOCKED on the unbuilt C6 caller (zero callers exist; port carries strings by design). buildQueueView sub-fix done via OD-191; write paths already fail loud (`22P02`). Stays owed.

**③ Adversarial LOGIC-bug sweep (the marquee — `logic-bug-sweep-plan.md`):** 41 finder agents over `app/*/src/*.ts` (excl `supabase-store.ts`) → independent skeptic verify. **95 candidates → 54 CONFIRMED (2 BLOCKER, 28 MAJOR, 24 MINOR), 2 UNCERTAIN, 39 refuted.** Full catalogue: **`spec/00-foundations/standards/logic-bug-sweep-findings.2026-07-07.md`**.
- **BLOCKER+MAJOR fix-workflow** (24 worktree agents, regression-test-first): **23/24 fixed + integrated** (cherry-pick 3-way merged with the concurrent OD work — nothing lost) + **full offline sweep GREEN (41/41 pkgs)**. `280639a` + 23 per-pkg commits. **1 initially HELD: task-queue** `escalateStaleApprovals` (needed **migration 0028**) — **✅ later RESOLVED this same session (operator-present), see the Net line + task-queue-RESOLVED note below; 0 held at session end.**
- **MINOR fix-workflow** (19 agents, non-isolated on top of the MAJOR fixes): **23/23 fixed**, full sweep GREEN. `7ff4fd4`.
- **2 UNCERTAIN → OD-195 + OD-196** (design calls): **OD-195 IMPLEMENTED** (`service/health.ts` probe now rejects 4xx — an invalid service_role key fails the boot gate, #2/#3; +tests). **OD-196 seam-contract comment** added to `write-gate.executeApproved`; the re-read hardening folded into ISSUE-056 (unbuilt caller). `644cdfe`.

**④ Smokes (C7) + adapter MINORs (C8):**
- **10 authoring-defect live-smokes** fixed → all green vs the live silo (`3c0dc0a`). Caught + reconciled STALE assertions where the schema is now MORE correct (prompt-store M5; **prompt-layer-identity F-1/F-2 — the 0026 indexes now REJECT the duplicate root-core + racing v2; the stale assertions were erroring the smoke, now flipped to assert the guard**).
- **~30 adapter MINORs triaged** (dispositions appended to the backfill findings doc): **1 fixed** (auth `setProviderConfig` atomicity, live-verified `1bf5498`), 2 already-done, rest by-design / owned-elsewhere (write-tools→OD-196, auth-audit→ISSUE-086) / deferred-hygiene. None a #1/#2/#3-live hazard.

**⑤ Layer-3 cross-component integration (D):** **`app/silo/results/layer3-integration-smoke.sql`** — one live flow threading provision→task_queue→guardrail_log gate→escalation+notification→resolution+access_audit, asserting every cross-table FK / shared enum / shared append-only trigger composes. **ALL LAYER-3 SEAMS PASS** (rolled back). `1660c7c`.

**Net (bug-level tally):** **ALL 54 sweep bugs fixed** = **2 BLOCKER + 28 MAJOR + 24 MINOR** (0 held). The 2 task-queue findings (MAJOR `store.ts:335` clock + MINOR `:336` boundary) were the last held pair — **RESOLVED via migration 0028** (`awaiting_approval_at`, applied live; fake+adapter key off `coalesce(awaiting_approval_at, created_at)`; R10 live-smoke green), commit `e83579e`. *(NB: the "23/24" and "19-pkg" figures elsewhere in this entry are PACKAGE/agent counts, not bug counts — one commit often carries several bugs, e.g. `auth`=2, `orchestrator`=4; the authoritative bug tally is this line.)* 767+ offline tests green across 41 pkgs (each fix carries a regression test); **12 live-smokes green** (10 authoring + Layer-3 + task-queue 0028); **silo head 0028**.

**✅ task-queue held fix — RESOLVED (operator-present, session 74 cont.):** migration **0028** applied live (`awaiting_approval_at`); both findings fixed (MAJOR clock + MINOR boundary); R10 live-smoke green. `held-fix-task-queue-awaiting-approval.md` marked RESOLVED. Silo head **0028**.

**⏳ OUTSTANDING — all blocked-on-unbuilt-issues (manage at the blocking issue, per operator; each fail-loud/safe meanwhile):**
2. **OD-194** (approval-tiers uuid wiring) — blocked on the unbuilt **C6** gate caller.
3. **M4 rate-limiting `drainDue`** — owed to the unbuilt consumer integration.
4. **prompt-optimisation / triggers tables** — owned by **ISSUE-049/053**.
5. **OD-196 hardening** — folded into **ISSUE-056**.
6. **Deferred hygiene** (non-#3): trigger-infra `setDefaultTriggerEnabled` atomicity (needs writeAudit client-threading refactor); `select *` coupling; rate-limiting type-lie; config-store M8 coalesce.

**Next step:** foundation is in strong shape — **all 54 logic-sweep bugs fixed** + every actionable owed item done; the residuals (OD-194, M4, ISSUE-049/053 tables, OD-196, deferred hygiene) are all blocked-on-unbuilt-issues with fail-loud safety, to be handled at their owning issue. **Stage 5 (gate `022`) can proceed** (R1: Checkpoint 4 already closed). **Silo head `0028`; next free tag `0029`.** Live infra: `source ~/.ai-harness-secrets.env`; silo `$SILO_DB_URL`; psql `/opt/homebrew/opt/libpq/bin/psql`.

---

## Session 73 — 2026-07-07 — 🧹 **Whole-repo hygiene + bug check (operator-requested "before I continue").** Full sweep: empirical build health, tracker-consistency audit, live-adapter bug-hunt, migration-hygiene audit. Fixed the safe items live; recorded the adapter findings for Part B (Rule 0); flagged the rest for operator decision. **No build stage opened/closed; Stage 5 status unchanged.**

**Environment:** 💻 FULL (Mac). Read-only live silo reads only (enum + constraint verification); no migration applied.

**✅ Verified healthy:** all 41 packages typecheck clean; offline test suite **767 pass / 0 fail** (my first sweep falsely showed 41×FAIL — macOS has no `timeout` cmd; re-run green). Git tree clean; `.gitignore` correct. Tracker **done/open axis is perfectly consistent** across all 4 trackers (frontmatter ↔ BUILD-SCHEDULE ↔ _backlog ↔ GitHub: 48 done all closed, 38 non-done all open; checkpoints 0–4 correctly ticked). No empty/swallowing catches, no debug logging, 1 tracked TODO (AF-004 canary).

**🔧 Fixed this session (safe, offline/read-only):**
1. **Migration linter gap (the twice-recurring `;`-in-comment live-apply break, sessions 69/0007 + 71/0011).** Root-caused: `app/silo/src/pg-driver.ts` split raw SQL on `;` with no comment/quote awareness. Added `app/silo/src/sql-split.ts` — an execution-safe splitter (skips `;` inside `--`/`/* */` comments, `'...'` literals, `$tag$…$tag$` bodies; nesting-aware) + wired into `applyNonTransactional` + `sql-split.test.ts` (10 cases). Added defense-in-depth discipline rule **`no-semicolon-in-comment`** scoped to `transactional:false` files (threaded the `transactional` flag through `checkAll`/`checkMigration`/`index.ts` corpus). **The new rule caught a REAL latent instance the static audit missed — `0001b_indexes:77` (baseline, re-runs on every new client provision) — now fixed** (comment-only reword; no checksum-drift detection exists + applied tags are skipped, so safe on existing silos). `silo check` GREEN, tests **65/65**.
2. **Pruned 14 stale git worktrees** (`.claude/worktrees/wf_*`, session-71/72 Workflow fan-outs; content already on main, all clean) → **reclaimed 662 MB**, unpolluted `find`/`grep`. 35 orphan branch refs kept as a safety net (tiny; optional later `git branch -D`).
3. **Tracker drift — fixed the one hazardous-direction case:** **ISSUE-025 `ready → blocked`** — its §7 blockers 023 + 020 are both `blocked` (not done); leaving it `ready` invited building on unbuilt RLS-enforcement + vector search (R5 violation). Verified first-hand.

**📝 Recorded for follow-up (Rule 0 — written to repo, NOT fixed here):**
- **Live-adapter bug-hunt → `spec/00-foundations/standards/live-adapter-backfill-findings.2026-07-07.md`** (new). 5 BLOCKER + 12 MAJOR + MINORs across 26/36 adapters, **4 CONFIRMED** (live/code): **B1 webhook-auth** writes 4 `event_type` enum values absent from the live silo (OD-179's enum-add migration never landed) → 100% silent live webhook failure; **B3** approval-tiers queue-view discards live rows (always empty); **B4** orchestrator + **M5** prompt-store + **M6** connector-runtime version-chain lost-update (no `unique(…,version)`, confirmed no constraint on `agents` live); **B5** invite-seed lifecycle ops delegate to an unpopulated in-memory fake. **This confirms the R10 Part-B Stage 0–3 backfill is NOT cosmetic.** Wired a pointer into `live-adapter-hygiene-sweep.md` Part B. Fixes belong in the gated backfill (live-verify each first) — do NOT bulk-edit.
- **Tracker drift — 6 stale-`blocked` (safe direction), operator decision owed:** ISSUE-020/052/058/062/065/068 each have **all §7 blockers `done`** (020←009/019/003 ✅; 052←049 ✅; 058←034/074/001 ✅; 062←061/043/003 ✅; 065←061 ✅; 068←056/003 ✅) so by the written rule they are `ready`, yet the BUILD-SCHEDULE Stage-5 header (line ~261) still calls them "blocked on undone deps" — **factually wrong**. Likely either an un-flipped Stage-5-open oversight OR an unrecorded "hold batch until gate 022 closes" convention. Not flipped unilaterally (build-enablement decision; 064 correctly stays blocked on 052). **Operator: confirm flip → `ready` (+ correct the schedule text), or record the 022-hold as an explicit blocker.**
- **R10 live-smoke coverage:** only 14/36 adapters have a committed `results/live-smoke.sql` — the known, documented Part-B backfill debt (not new drift).

**Files changed:** `app/silo/src/sql-split.ts` (new) · `app/silo/src/sql-split.test.ts` (new) · `app/silo/src/pg-driver.ts` · `app/silo/src/discipline.ts` · `app/silo/src/index.ts` · `app/silo/migrations/0001b_indexes.sql` (comment-only) · `spec/06-issues/ISSUE-025-retrieval-ranking.md` (status) · `spec/00-foundations/standards/live-adapter-backfill-findings.2026-07-07.md` (new) · `spec/00-foundations/standards/live-adapter-hygiene-sweep.md` (Part-B pointer) · `spec/SESSION-LOG.md`.

**Continued — the operator asked to run the R10 Part-B backfill in full (live-adapter vs live-DB test) before continuing to Stage 5.** Ran it as gated waves: agents fan out to review each adapter + author a `results/live-smoke.sql`; the orchestrator runs the smokes serially against the live silo + fixes what's confirmed. **All 36 adapters are now reviewed.**

**✅ Fixed + live-verified this session (10 bugs):** B1 webhook-auth enum (`0024`), B4 agents version-race (`0025`), M10 observability silent-GDPR-erasure (code), M11 log-retention false-tamper-signal (code), and the **version-chain lost-update class across `prompt_layers`+`tools` (`0026`, 6 findings: connector-runtime M6, prompt-store M5+genesis, prompt-layer-context, prompt-layer-identity ×2)**. Plus the migration-linter root-cause + a latent `0001b` instance it caught. Silo migration head **0020 → 0026** (all applied live, discipline+RLS green). realtime verified OK (0023 holds).

**🔴 Design/integration gaps found → logged as ODs (need operator decision, NOT hacked):** **OD-191** (approval-queue decoration not persisted), **OD-192** (invite-seed lifecycle — native-token, no table), **OD-193** (SYSTEMIC: every adapter connects as `postgres` owner not `service_role` — refutes the RLS-permission finding class but breaks retention DELETE if ever deployed as service_role), **OD-194** (approval-tiers non-functional live — string action-name/reviewer-identity bound into uuid/FK columns; the whole tier/gate/resolve/queue path throws `22P02`).

**⏳ Owed, catalogued (not fixed):** M4 rate-limiting drainDue (no consumer built yet); prompt-optimisation + triggers query tables owned by ISSUE-049/053 (missing → non-functional live until those ship); invite-seed non-atomic `issueInvite` + `completeSetup` guard; hard-limits `setStatus('pending')` divergence; ~30 MINORs; 10 authored smokes need an authoring-defect polish pass. **Full catalogue: `spec/00-foundations/standards/live-adapter-backfill-findings.2026-07-07.md`.**

**12 packages clean** of BLOCKER/MAJOR (only MINORs) — the session-72-reviewed set is holding up. **Refuted** (my static audit was wrong): M2, M3 (rate-limiting), the whole RLS-permission class (per OD-193).

**Files changed (this continuation):** `app/silo/migrations/0024/0025/0026*.sql` + `_journal.json` · `app/silo/src/{sql-split,discipline,pg-driver,index}.ts` + `sql-split.test.ts` · `app/observability/src/supabase-store.ts` · `app/log-retention/src/supabase-store.ts` · `app/webhook-auth/results/live-smoke.sql` + a `results/live-smoke.sql` for all 22 swept packages · `spec/00-foundations/open-decisions.md` (OD-179 landed, OD-191/192/193/194) · `spec/00-foundations/standards/live-adapter-backfill-findings.2026-07-07.md` · `spec/06-issues/ISSUE-025` (status).

**Next step (HANDOFF POINT — build not advanced; Stage 5 still open, foundation NOT yet cleared).** 👉 **The consolidated actionable checklist for the next chat is `spec/06-issues/STAGE-5-READINESS-HANDOVER.md`** (A–E: resolved-OD implementation, owed bugs, smoke/MINOR polish, the Layer-3 integration pass, tracker reconciliation). Summary:
1. **Foundation is NOT cleared for Stage 5 yet — but the decision-blockers are now resolved.** ✅ **OD-191/192/193/194 all RESOLVED** (operator delegated to recommendation: 193→ratify postgres owner; 191→defer C6 surface; 192→model invites on profiles; 194→wire id resolution). ✅ **3 owed code MAJORs FIXED** (invite-seed atomicity + completeSetup, hard-limits setStatus — offline-verified). **Still remaining before the foundation clears:** the OD *implementation* work (OD-193 doc-only comment fix; OD-191 `buildQueueView` fail-loud sub-fix; OD-192 model-on-profiles + immediate fail-loud; **OD-194 approval-tiers wire the uuid resolution — needs the caller contract pinned, best done in the fresh chat**); M4 rate-limiting (owed to the unbuilt consumer); land the prompt-optimisation/triggers tables (ISSUE-049/053); polish the 10 authoring-defect smokes; then one live cross-component integration pass (Layer 3). Silo head now **0026**.
2. **A separate adversarial LOGIC-bug sweep of the NON-adapter business logic is queued for a FRESH chat** (operator's explicit request). Full plan in the repo: `spec/00-foundations/standards/logic-bug-sweep-plan.md`. This session covered the DB-adapter boundary only; the pure business logic beyond its 767 green tests was not re-hunted.
3. The 6 stale-`blocked` tracker issues (020/052/058/062/065/068) + the OD decisions remain owed.

---

## Session 72 — 2026-07-07 — 🔍 **Checkpoint-3 retroactive adversarial review — 7 BLOCKER + 11 MAJOR found across the 18-member batch, all fixed + live-verified; migrations `0021–0023` applied LIVE.** Operator asked for an adversarial review of Checkpoint 3's issue batch (gate `018` + the 17-member Stage-3 batch, closed session 69). Ran the same live-adapter-vs-real-schema method the Stage-4 full review (`a1ad9b2`) used — 18 parallel independent reviews cross-checking each package's live Postgres adapter against the actually-applied migration DDL and live `\d`/`pg_policy` reads, not just the offline-fake-passing test suite.

**Environment:** 💻 FULL (Mac, operator present). Reconciled trackers first — silo head `0020` matched the journal, all 18 issues `status: done`, no drift.

**Findings, triaged and fixed (operator chose "fix everything now"):**
- **management (012):** BLOCKER `ingest()` silently cleared `log_write_failing` on any push omitting it (missing `coalesce`, unlike every sibling column) · MAJOR `ingest()`'s 3 writes weren't transactional (a crash mid-sequence permanently loses the push, disguised as a replay) · MAJOR `registerClient()` threw a raw pg error instead of the documented `ManagementError(duplicate_slug)` · MAJOR `transitionStatus()` was a lost-update race (no CAS guard).
- **task-queue (048):** BLOCKER `service_role` still held live DELETE on `task_queue` — the no-delete invariant (Rule 0 §1) was asserted only against a never-applied scratch migration file; `task_history` cascades on delete, so one DELETE would have silently erased the audit trail too.
- **prompt-layer-context (044):** BLOCKER `dynamic_field_values` never got the RLS grant+policy `prompt_layers` got in migration `0004` — the ISSUE-044 operator dynamic-value editor would throw `permission denied`.
- **retention (084):** BLOCKER `registerClient`/`registryHome` targeted the mgmt-plane-only `client_registry` table using the silo pool (architecturally wrong either way) · MAJOR the RET.001 unauthorized-hard-delete detector was a stub always returning `[]` — silently non-functional.
- **rbac (018, the gate):** MAJOR ×2 `seedClearance`/`insertClearance` omitted `granted_at`, so Postgres silently substituted `now()` for the caller's value.
- **realtime (076):** BLOCKER `task_queue`/`notifications` were never added to the `supabase_realtime` publication (Realtime delivers nothing regardless of RLS) · MAJOR config-key naming drift between `surfaces.ts` and its own proposed-spec doc.
- **alerting (075):** BLOCKER ×2 the escalation chain passed unresolved role-name strings into a uuid recipient column; `loop_missed` cast a loop name into `uuid[]` `entity_ids` · MAJOR a 3-step escalation write could desync state on partial failure.
- **cost-meter (074):** MAJOR unbounded duplicate `cost_threshold_breach` notifications (no dedup; bug shared by the in-memory fake, so no existing test caught it).
- **guardrail-log (060):** MAJOR `all()` omitted the `redacted_at` column (migration `0015`) from both the SQL and the TS type.
- **Clean:** auth (013), connector-runtime (032), hard-limits (055), anomaly-checks (057), injection-pipeline (059), prompt-layer-identity (043) — matched live schema exactly.
- **Disclosed gaps carried forward, not fixed (owned elsewhere):** prompt-optimisation (046, tables owned by ISSUE-053) · triggers (047, `trigger_delivery` owned by ISSUE-049) · superadmin-auth (014, never had a live-smoke pass written).

**Migrations authored + applied LIVE** (silo head `0020` → `0023`): `0021_task_queue_append_only` (revoke DELETE from anon/authenticated/service_role) · `0022_dynamic_field_values_rls` (`PERM-config.prompts` policy + grant) · `0023_realtime_publication` (add `task_queue`/`notifications` to `supabase_realtime`). All via `npm run migrate` after `npm run check` (discipline + RLS-coverage gates green).

**Every fix live-verified** (not just offline-tested): management's 4 fixes and rbac's `granted_at` fix via disposable rows against the real mgmt/silo DBs (cleaned up after); task_queue's revoke via `SET ROLE service_role; DELETE ...` → `permission denied`; retention's detector via a real unauthorised `access_audit` hard-delete row it now correctly flags; the 3 migrations' effects confirmed via direct `pg_policy`/`role_table_grants`/`pg_publication_tables` reads. Full offline sweep across every `app/*` package: all green (also caught + fixed the same stale-hardcoded-migration-list test bug in `app/silo/schema.test.ts` that `a1ad9b2` fixed for `0011-0020`, now covering `0021-0023`).

**Concurrency note:** a separate, concurrent session was active on this repo mid-review (commits `ede7f5e` Checkpoint-4-close, `cf5b3c1` handoff-patch). `cf5b3c1` incidentally swept this session's in-progress edits to `management`/`rbac`/`guardrail-log` into its own commit (whose message only describes "2 stale pointers"). Content verified intact via full re-test + live re-verification; operator chose not to rewrite that history (risk of diverging a possibly-still-active session) — flagged here and in the evidence doc so `git log` isn't misread later.

**Files changed:** `app/management/src/{store,supabase-store}.ts` · `app/rbac/src/supabase-store.ts` · `app/task-queue/src/supabase-store.ts` (n/a — fix was migration-only) · `app/task-queue/src/task-queue.test.ts` · `app/retention/src/supabase-store.ts` · `app/realtime/results/proposed-shared-spec.md` · `app/alerting/src/{engine,rules,store,supabase-store,types}.ts` · `app/cost-meter/src/{store,supabase-store}.ts` · `app/guardrail-log/src/{types,supabase-store}.ts` · `app/silo/migrations/0021-0023*.sql` + `_journal.json` · `app/silo/src/schema.test.ts` · `spec/06-issues/BUILD-SCHEDULE.md` (Checkpoint-3 line) · `app/silo/results/checkpoint3-review-evidence.2026-07-07.md` (new).

**Next step:** unchanged for the build — Stage 5 is open (per the concurrent session) and this review doesn't block or reopen anything. If picking this up cold: read `app/silo/results/checkpoint3-review-evidence.2026-07-07.md` for the full findings/fix table before touching any of the 9 touched packages again.

---

## Session 71 — 2026-07-07 — 🔨 **Stage-4 offline batch fan-out — 11 members built + adversarially verified + integrated onto main; migrations `0011–0017` authored (discipline-clean, NOT yet live).** The marquee-style fan-out over the 14-member Stage-4 batch: the **11 offline-authorable** members built via worktree-isolated author agents → independent adversarial verify → 2 BLOCKER fixes → serial migration/shared-spec integration. **Survived a mid-run power loss** (all work was committed on worktree branches; nothing lost). The 3 live/🧑 members (`033`/`037`/`085`) + Checkpoint 4 remain for the operator-present session.

**Environment:** 💻 FULL (Mac, operator present, then a power cut mid-fan-out, then resumed). Reconciled trackers first — zero drift at start (Checkpoint 3 CLOSED, gate `019` `done`, all 14 batch `ready`, migration head `0010`, clean tree).

**What ran (and how the power loss was absorbed):**
1. **Author fan-out** — a `Workflow` (`stage4-offline-fanout`) spawned 11 worktree-isolated author agents (one `app/<slug>/` package each, house port+fake+live-adapter pattern), pipelined into an adversarial-verify stage. The **hard isolation rule** (touch ONLY your package; document any migration/schema/config delta in `results/proposed-shared-spec.md`, never edit shared files) made the parallel worktrees collision-free.
2. **Power died mid-run.** Recovery from git (the source of truth): main untouched at `9d693ee`; **all 11 builds committed on their worktree branches** `worktree-wf_abfc93de-28e-1..11`. A recovery verify-pass had already re-run over the 11 committed builds: **9 PASS, 2 DEFECTS (015, 049), 1 unverified (077 — its verifier hit a session limit).** Re-verified 077 → **PASS**.
3. **Fixed the 2 BLOCKERs** (both the fake-passes-offline / live-adapter-throws-against-real-DDL class the verify pass is built to catch): **015** — the live `completeSetup`/`validateToken` delegated to the in-memory fake (no real activation SQL) + `writeEvent` inserted `event_type` literals absent from the enum → rewrote real live activation SQL (flip `profiles.active`, log `account_activated`, resolve redirect from a real `user_roles→roles` join) + made the fake reject unadmitted enum values (mutation-verified). **049** — re-declared `idempotency_ledger` with a shape incompatible with the baseline table → adapted the adapter+fake to the baseline shape via a `harness:task-graph` sentinel connector (no new table, no design fork), documented the 2 enum values, pinned the `step_index` topo-order seam. Both re-verified green on main (**015=31/31, 049=13/13**).

**Integration (the serial part — never fanned out):** `git checkout <branch> -- app/<slug>` brought all 11 packages onto main (standalone packages, no root workspace; `node_modules` gitignored → clean copies). Then, as the **single migration-chain writer**, authored **migrations `0011–0017`** from the 11 `proposed-shared-spec.md` files (each reconciled verify-present vs author against the CURRENT chain, not just baseline):
- `0011_stage4_event_types` (`transactional:false`) — +16 `event_type` values (015×4, 016×4, 034×4, 036×2, 049×2) + `alert_type` `support_request`. Semicolon-free comments (the session-69 non-transactional-runner lesson).
- `0012_rate_limit_deferred` — 034's persisted 95%-queue table + default-deny RLS floor (so the coverage lint passes) + REVOKE.
- `0013_task_graph_versions_append_only` — 049's append-only-by-version trigger + REVOKE (`create or replace trigger`, no destructive DROP).
- `0014_support_requests_rls` — 016's public-insert / PERM-support.view read / PERM-support.resolve update policies (initplan-wrapped, `@>` idiom from 0003).
- `0015_guardrail_redacted_at` — 077's `guardrail_log.redacted_at` column + a redaction-tombstone **branch (c)** added to `enforce_audit_append_only()`. **Change-control on the LIVE audit-immutability trigger ([[OD-074]], kin to OD-182)** — reproduced the current 0010 function byte-for-byte (incl. the OD-182 escalation branch) and added ONLY branch (c). The `description='[redacted]'` guard matches the log-retention adapter's exact scrub.
- `0016_agents_version_discipline` — 061's conservative agents version-lineage trigger (forbid DELETE + freeze the lineage columns; the content-column/`enabled` freeze deferred to ISSUE-067/OD-080 — scope-honest).
- `0017_stage4_indexes` (`transactional:false`) — the two CONCURRENTLY indexes for 0012/0014 (pulled out because CONCURRENTLY can't run in a txn — the 0001b pattern).
- **Silo `check` GREEN:** 20 migrations discipline-clean + RLS coverage green (every table incl. the new `rate_limit_deferred`; every helper `(select …)`-wrapped). The gate caught 4 mechanical issues first (2 indexes needing CONCURRENTLY, 2 `drop trigger` flagged destructive) — all fixed.

**✅ LIVE APPLY LANDED (session 71 continued — operator-present):** `0011–0017` applied to the canary silo; **head `0010` → `0017`**. One live bug caught + fixed (the runner is fail-loud/resumable): **`0011` had a semicolon INSIDE a comment** (`(cannot run inside a txn block); each`) → the non-transactional runner split the statement there → `syntax error at "each"`. **Nothing partially applied** (it failed on the 2nd chunk before any `alter type` ran); removed the `;`, re-ran clean. **This is the exact 0007 session-69 class — the lesson recurs; the discipline linter should grow a "no semicolon in a comment for `transactional:false` files" check.** Live verification (read-only, all PASS): 16/16 new `event_type` + `alert_type` `support_request`; `rate_limit_deferred` exists + RLS on; `guardrail_log.redacted_at` present; `trg_task_graph_versions_no_update` + `trg_agents_version_lineage` present; 3 `support_requests` policies; and **`enforce_audit_append_only()` carries BOTH the new redaction branch AND the OD-182 escalation branch** (change-control preserved byte-for-byte). Migrations `0011–0017` are now LIVE.

**✅ 3 LIVE MEMBERS BUILT OFFLINE (session 71 continued):** the 3 held-out live/🧑 members (`033`/`037`/`085`) were built via a second small worktree fan-out (author → adversarial verify) — because a scope check found NONE of them needs Railway credit (their live-close is Supabase / `pg_dump` / mgmt-API + per-vendor arms deferred to the connector issues). **033 token-lifecycle** (25/25) — generic 3-layer OAuth refresh + atomic rotate-persist (single-flight + optimistic-concurrency guard + grace-window recovery). Verify caught a MAJOR: `AC-3.TOK.007.2` (surface approach to Google's 100-token cap before silent eviction) was a stubbed constant + tautological test → **fixed** (`detectCapApproach` fires the loud warning strictly before the eviction point, teeth-tested). AF-089 (GHL rotation race) + vendor OAuth live-owed to 039/040/041. **037 trigger-infra** (28/28) — generic inbound-trigger pipeline + no-code event→task config + liveness (watch re-arm + gap reconciliation, fail-loud). Verify caught a MAJOR fake-vs-live drift: `writeAudit` inserted into a fabricated `audit` table → **fixed** to the real `access_audit` shape (fake now mirrors the DDL invariants). Migration **`0018`** = 9 trigger `event_type` values (silo). Per-vendor arms (AF-090/084/083) held & live-owed. **085 backup-dr** 🔴 (16/16, verify **PASS** — praised for fake-vs-live fidelity) — hourly off-platform dump + restore-rehearsal (on the GREEN AF-069 Path B) + 5 backup-health fields + lapse alert + NFR-DR.009 purge-leg. Migration **`0003_backup_dr`** (mgmt-plane, hand-applied) = 4 enums + 5 operator-side backup tables. AF-069 Path A + AF-072 LOAD + AF-070/071/137 live-owed. All 3 integrated onto main + `in-progress`; the two fixes re-verified green on main (033=25/25, 037=28/28). **Deferred (tracked):** reconcile app/observability EVENT_TYPES to include the new Stage-4 values (its drift-gate is a subset check, so nothing breaks) + config-key registration (034×5, 051×6, 037×2). **Remaining for Checkpoint 4:** live-apply `0018` (silo) + `0003` (mgmt DB), the 085 live rehearsal run, the Checkpoint-4 integration test, then flip all 14 `done`.

**✅ FULL LIVE-ADAPTER REVIEW → CHECKPOINT 4 CLOSED → STAGE 5 OPEN (session 71 continued — operator-requested "full review so we're not pushing anything broken").** Before closing, ran a 14-agent review fan-out — a **correctness code-review + a per-package `results/live-smoke.sql`** that replays each adapter's REAL write path rolled-back against the silo/mgmt DB. This closed the one gap all prior gates shared: the live adapters had never touched the DB (only their fakes had). **It caught 3 BLOCKERs + 3 MAJORs that the per-package adversarial verify, the 290/0 offline sweep, AND the DB-invariant capstone had all missed:**
- **015 BLOCKER** — the `profiles` insert used `gen_random_uuid()`, but `profiles.id` FKs `auth.users(id)` → `foreign_key_violation` on every invite + the genesis seed. **Fixed:** a new `AuthAdmin` port/seam threads the real `auth.users.id` into `profiles` (matches app/auth).
- **056 BLOCKER** — `access_audit` insert used `actor_type='human'` (not in the enum) → `22P02` on every resolve, AFTER the row transitioned (un-audited). **Fixed:** `'user'`/`'system'` + the transition & audit wrapped in ONE transaction. **+MAJOR:** compensation delegated to an empty in-memory ref (cleanup tasks never queued) → now runs against `opts.appliedEffects`.
- **037 BLOCKER** — trigger runtime state lived in the version-locked `tools.config` (mutated in place → `0008` trigger rejects). **Fixed ([[OD-190]], operator-approved own-tables):** re-homed to 5 dedicated tables (migration **`0019`** + **`0020`** indexes); adapter rewritten to atomic upserts (also fixes the MAJOR non-atomic lost-update).
- **061 MAJOR** — a capability edit dropped the `__domain` tag → agent silently vanished from routing. **Fixed:** `__domain` re-injected at the `appendVersion` choke point.
- Also fixed a **stale `app/silo/src/schema.test.ts`** hardcoded journal list (ended at `0010`; now `0011–0020`) that had been silently failing.

**Live-applied this session:** `0011–0017` + `0018` + `0019/0020` on the silo (head `0020`), `0003_backup_dr` on the mgmt DB. **All 14 `results/live-smoke.sql` pass live** (rolled back). Whole-batch offline sweep **290/0**. Silo unit tests **55/0**. **R7 three-non-negotiables re-checked LIVE** (`app/silo/results/stage4-checkpoint-capstone.sql`, rolled back: #1 task_graph_versions + agents append-only + guardrail redaction-tombstone; #2 hard-limit no-override CHECK + clearance; #3 loud events + monotonic escalation stamp — ALL ASSERTIONS PASS).

**Checkpoint 4 CLOSED (2026-07-07):** all 14 members `done`; GitHub #15/#16/#33–37/#49–51/#56/#61/#77/#85 closed; BUILD-SCHEDULE checkpoint ticked; `_backlog`/README synced; the 6 non-blocking MINORs (034/085 non-atomic, 035 re-decide guard, 049 `[]`-vs-null, 077 rollback fidelity, 016 stale comment) queued as a cleanup task. **[[OD-190]]** logged. **Stage 5 (Integration & specialists) OPEN (R1):** gate **`022`** (memory + entity model + sensitivity/visibility tagging) + `021`/`038`/`039`/`040`/`041`/`078`/`079`/`083`/`086` flipped `blocked → ready`; `020`/`052`/`058`/`062`/`064`/`065`/`068` stay `blocked` on undone deps.

**NEXT ACTION (START HERE — Stage 5 is OPEN, R1): gate `022` Memory + entity model + sensitivity/visibility tagging** 🔴 (get the entity model wrong and knowledge fragments — #1). Build it serial + hardest-first (R3), then the 16-issue Stage-5 batch (connector-heavy: `020`/`038`/`039`/`040`/`041` are 💻 live). **Migration head `0020`; next free silo tag `0021`; mgmt chain `0003`, hand-applied (no journal).** **Live-owed residuals carried (onboarding/connector, tracked — NOT Stage-5 blockers):** AF-089 (033 GHL rotation race) · per-vendor connector arms AF-090/084/083 (037 → 039/040/041) · AF-069 Path A (PITR) + AF-072 (LOAD) + the 085 standing live rehearsal run · [[OD-188]] (056 Hold `held_for_review_at` live-persistence) · [[OD-189]] (061 `awaiting_clarification` task_status) · config-key registration (034×5/051×6/037×2) + observability EVENT_TYPES reconciliation · Railway credit ~$0 (top up before any live deploy). **Infra:** `source ~/.ai-harness-secrets.env`; silo `psql "$SILO_DB_URL"` (psql at `/opt/homebrew/opt/libpq/bin/psql`); mgmt `psql "$MGMT_DB_URL"`. **Lesson banked:** the live-adapter smoke is now a required Stage-gate step — the fake-passes-offline / live-adapter-throws class is invisible to offline tests + read-only review; only replaying the real adapter against the DB catches it (it caught 3 BLOCKERs here).

**Verify-present (NOT re-authored — the reconcile caught these):** **056's escalation-stamp trigger branch was already done by OD-182/0009** (056's agent read the baseline and missed the session-69 widening); the hard-limit no-override CHECK (baseline L465); all six "new" tables + `support_status` enum + `guardrail_log.escalated_at`; 051's event_type values.

**Decisions logged (deferred forks — no offline blocker):**
- **OD-188** — 056 Hold-for-full-review LIVE persistence mechanism (recommend Option A: add `guardrail_log.held_for_review_at` + a one-way whitelist branch). Deferred to the Checkpoint-4 live session (change-control on the locked trigger — author + apply + prove live in one pass, not blind offline). The offline Hold logic is proven (26/26).
- **OD-189** — 061 `awaiting_clarification` as a distinct `task_status` value (recommend Option A: add the enum value, C5-owned). Deferred to ISSUE-053 / live reconciliation; the offline orchestrator models it distinctly (35/35).

**Deferred (session-69 precedent):** config-key registration for 034's 5 rate keys + 051's 6 loop keys (OD-181 keygroup-map coupling; packages fail-closed on unregistered keys, each documented in its `results/proposed-shared-spec.md`) → the Checkpoint-4/onboarding config pass. Traceability-matrix rows + GitHub-issue close **deferred to done-time** (these 11 are `in-progress`, not `done`).

**Doc mirroring (Rule 0):** `schema.md` (event_type/alert_type enums, `rate_limit_deferred` table, `guardrail_log.redacted_at`, the redaction branch (c) + the task_graph_versions/agents version triggers in §Immutability) + `rls-policies.md` (support_requests concrete policies) mirrored via a focused agent.

**Files changed (sync ritual — all in lockstep, one integration commit):** 11 new `app/<slug>/` packages (015/016/034/035/036/049/050/051/056/061/077); 7 new `app/silo/migrations/0011–0017*.sql` + `_journal.json`; `schema.md` + `rls-policies.md` mirrors; **11 issue files `status: ready → in-progress`**; `BUILD-SCHEDULE.md` (migration-chain lane note — applied-head `0010` vs authored-head `0017`, next tag `0018`; Stage-4 header + batch line); `_backlog.md` Stage-4 roll-up; `README.md` build cell; `open-decisions.md` (**OD-188**, **OD-189**; next free **OD-190**). **No GitHub close, no matrix rows, no Checkpoint-4 tick** (offline-only; `done` awaits the live checkpoint).

**Next action (START HERE — the operator-present Checkpoint-4 live session):** `source ~/.ai-harness-secrets.env`; silo `psql "$SILO_DB_URL"`. (1) **Apply migrations `0011–0017` LIVE** to the canary silo (`cd app/silo && DATABASE_URL="$SILO_DB_URL" npm run migrate`) — watch the `0011`/`0017` `transactional:false` enum/index files (the 0007 `;`-in-comment trap is avoided; comments are semicolon-free). (2) **Author + apply the OD-188 / OD-189 live deltas** (next free tag `0018`) if the operator greenlights the recommended options. (3) **Build + live-close the 3 live/🧑 members** `033` OAuth token lifecycle · `037` trigger infra + liveness · `085` backup & DR (hourly dump + rehearsal, AF-069/DR). (4) **Whole-repo offline sweep** on main (the 11 new packages + the existing fleet — 2 fixed packages already re-checked green: 015=31/31, 049=13/13). (5) **Checkpoint 4** — `019` clearance scoping holds + every Restricted grant logs who/when/why (#2); the batch works as a group; three non-negotiables re-checked LIVE (R7). (6) Then flip all 14 `→ done`, tick the Checkpoint-4 box, close GitHub #15/#16/#33/#34/#35/#36/#37/#49/#50/#51/#56/#61/#77/#85, add the traceability-matrix rows → **Stage 5 (gate `022`) opens (R1).** **Migration:** authored head `0017`; next free tag `0018`. **Carried live-owed residuals:** AF-074 (015 link-TTL) · AF-112/114/115 (049/050/051 crash-window/compression/retention at scale) · AF-121/122/126 EVAL (061 routing) · guardrail redaction live via 0015 (AC-7.LOG.007.4) · plus prior carries (Railway credit low — top up before any live deploy · OD-172 per-connector webhook · AF-069 Path A PITR · `013` real OAuth OD-175 · `047` AF-135 OD-185 · `084` legal gate).

---

## Session 70 — 2026-07-06 — ✅ **ISSUE-019 (Clearance + Restricted model — the Stage-4 GATE) `done`.** Built `app/rbac/src/clearance.ts` on the ISSUE-018 `can()` gate — the four-tier sensitivity model, the OD-186 per-role default-clearance seed, clearance grant/revoke, the review cadence (both branches), Restricted per-individual grants, and the never-auto-inject + control-before-gate rules. **45 tests + `check` + LIVE capstone.** Independent zero-context adversarial verification **caught 2 real defects — both fixed + pinned.** Stage-4's gate is closed (R3, serial/hardest-first); the 14-issue batch is next.

**Environment:** 💻 FULL (Mac, operator present). Reconciled trackers first — zero drift (Checkpoint 3 CLOSED, all 15 Stage-4 issues `ready`, migration head `0010`, clean tree). Approach per R3: build the gate **serial, hardest, first**, before any batch fan-out.

**What 019 is:** the ADR-006 clearance/Restricted **model + mutation flows** on the ISSUE-018 authorization core + ISSUE-008 tables. Four tiers (Standard implicit · Confidential · Personal · Restricted-never-auto-injected — `clearance_tier` enum holds only confidential/personal, Restricted lives in `restricted_grants`); the per-role default seed; the two Super-Admin-gated grant/revoke flows; the configurable review cadence; the never-auto-inject invariant. RLS enforcement that READS this = ISSUE-020; retrieval-path enforcement = ISSUE-025; memory tagging = ISSUE-022; the clearance UI + user-mgmt lifecycle = ISSUE-021 — all seams, not built here.

**Built — `app/rbac/` (extends the ISSUE-018 package, house port+fake+live-adapter pattern):**
- **`clearance.ts`** (new) — the tier model + handling semantics + extension point (`sensitivityTiers`/`isAutoInjectable`, model doesn't hardcode four); `DEFAULT_CLEARANCES` + `FINANCE_ENTITY_TYPES` + `assertScopeTokensPresent` (OD-186); `grantClearance`/`revokeClearance` (explicit-never-inherited, entity-type-scoped, audited); `effectiveClearances`/`hasClearanceFor`; `reviewOverdueClearances` (both branches non-silent) + `confirmClearanceReview`; `grantRestricted`/`revokeRestricted` (per-individual, mandatory reason, instant soft-delete); `filterAutoInjectable`/`applyClearanceControl` (FR-1.RST.003 + FR-1.CLR.006 rule-only).
- **`store.ts`** — widened `ClearanceRow`/`RestrictedGrantRow` to full schema shapes + new port methods (insert/delete/touch/list clearance; insert/revokeById/list restricted); the fake's `seedClearance` now stamps `id`/`granted_at` mirroring the DDL (self-caught fake-vs-schema drift).
- **`supabase-store.ts`** — the live pg adapter for all new methods (real SQL against the DDL); `appendAudit` now parameterizes `actor_type` (was hardcoded `'user'`).
- **`roles.ts`** — `seedRoles` delegates default-clearance seeding to `seedDefaultClearances` (threads a provisioning timestamp + entity_types for the fail-loud guard).
- **`index.ts`** — a Gate 6 in the `check` CLI: clearance-model integrity (scope tokens ⊆ entity_types · no Restricted role default · Standard implicit · Restricted not auto-injectable).

**No new migration** (§5 — tables landed in ISSUE-008; RLS enforcement is ISSUE-020). Migration head stays **`0010`**.

**Decisions logged (operator-present / verification-driven):**
- **OD-186** (operator-decided) — the "finance entities" default-clearance scope = `{Invoice, Contract/Retainer, Financial Period, Deal}` (one clearance row per type); portability = seed the concrete default tokens (`Team Member`/`Client`/finance-set) matching the shipped `entity_types`, **fail LOUD** at provisioning if any is absent, re-grant via the clearance UI (ISSUE-021) if a deployment renames a type.
- **OD-187** (adversarial-verification BLOCKER catch) — the review cadence targets **user-scoped grants only**; a **role-default clearance is never auto-revoked** by the sweep (governed by role management, ISSUE-021). Also fixed the sibling audit-attribution bug (sweep now audits `actor_type='system'`, not a false `'user'`).

**Independent adversarial verification (zero-context) — 2 real defects, both fixed + pinned with teeth-tests that fail against the old code:**
- **BLOCKER (#1 access-loss):** `reviewOverdueClearances` swept **every** clearance including the six roles' seeded defaults → `fail_closed=true`, ~90 days post-provision, the nightly job would hard-delete Finance's/Admin's baseline clearances fleet-wide. My `NOW`-provisioned fixture masked it. **Fixed** via OD-187 (skip `user_id === null` rows); new test seeds role defaults at `T0` (long-overdue) + `fail_closed=true` and proves nothing is swept.
- **MAJOR (#3 audit corruption):** the live `appendAudit` hardcoded `actor_type='user'`, so a scheduler auto-revoke was falsely attributed to a user in the immutable trail. **Fixed** — `actor_type` threaded through `AuditRow`, sweep call sites set `'system'`, live INSERT parameterized; tests assert the sweep audits carry `'system'`.
- Verifier also confirmed clean: Restricted structurally impossible as a role default; every mutation gates via `can()` before writing; OD-186 fail-loud fires; seed matches design-doc L435–443.

**LIVE capstone (operator-present, silo `SILO_DB_URL`, head `0010` unchanged, `results/issue-019-capstone.sql`, one rolled-back txn):** the seed lands as real rows (Finance = 4 finance-scoped Confidential, no Client scope, no Restricted); the `num_nonnulls(user_id,role_id)=1` exactly-one-subject CHECK **rejects both/neither**; clearance revoke = hard DELETE; Restricted `reason` NOT NULL **rejects a null reason**; a grant captures granter/grantee/time/reason; Restricted revoke = soft-delete (active query then excludes); and **the access_audit append-only trigger rejects both UPDATE and DELETE** (#1 audit-immutability at the DB source). `ALL ASSERTIONS PASS`, rolled back. (One self-caught bug mid-run: a `raise` with a mismatched format arg — fixed.)

**Files changed (sync ritual — every tracker in lockstep for a `done` issue):** new `app/rbac/src/clearance.ts` + `clearance.test.ts` + `results/issue-019-capstone.sql`; `app/rbac/src/{store,roles,supabase-store,index}.ts`; **ISSUE-019 `status: ready→done`** + §10 build result; **`BUILD-SCHEDULE.md`** (Stage-4 gate `019` box ✅ DONE); `_backlog.md` (roster row + Tier roll-up); `traceability-matrix.csv` (9 CLR/RST rows → test + capstone artifacts); `README.md` build cell; `open-decisions.md` (**OD-186**, **OD-187**; next free OD-188). **GitHub #19 closed.**

**Next action (START HERE — Stage 4 is OPEN, gate `019` `done`): the 14-issue Stage-4 batch** (all `ready`, parallel-safe): `015` invite+seed · `016` support-request recovery · `033` OAuth token lifecycle 🧑(live) · `034` rate limiting+tiers · `035` write tools+connector hard limits · `036` tool optimisation · `037` trigger infra+liveness · `049` task graphs+idempotency+resume · `050` context envelope+compression · `051` three loops+failure heartbeat · `056` approval tiers+escalation · `061` orchestrator+7-step routing · `077` log retention/export+mgmt views · `085` backup & DR 🔴(live). **⚡ Fan-out is the payoff here** (BUILD-SCHEDULE "Fan-out guidance") — build the offline batch in parallel worktrees → adversarial verify each (it keeps catching real fake-vs-live drift) → live-close the live members (`033` token lifecycle, `085` backup/DR) with the operator. **Commit the integration before any dependent fan-out** (session-69 stale-base lesson). Then **Checkpoint 4** (`019` clearance scoping + every Restricted grant logs who/when/why). **Infra:** `source ~/.ai-harness-secrets.env`; silo psql `"$SILO_DB_URL"`. Migration head `0010`, next free **`0011`**. **Carried residuals (onboarding/live-owed, non-blocking):** ISSUE-020 owes the RLS read predicates that consume this clearance model (+ AF-080 runtime signal) · ISSUE-021 owes the clearance/Restricted UI + `access_audit` completeness · `014` live attack-sim · `047` AF-135 freeze spike ([[OD-185]]) · `013` real OAuth ([[OD-175]]) · `084` legal-review gate · Railway credit low (~$0) — top up before any live deploy · OD-172 live per-connector webhook · AF-069 Path A PITR.

---

## Session 69 — 2026-07-05/06 — ✅ **Stage-3 batch DONE (all 17) → CHECKPOINT 3 CLOSED → STAGE 4 OPEN.** The full marquee fan-out end-to-end: 15 offline packages fanned out + adversarially verified + fixed, `012`/`014` built serial with the operator, migrations `0006–0010` applied LIVE, [[OD-182]] + `012` mgmt-plane proven LIVE, three non-negotiables re-checked LIVE, all 17 `done`.

> **Phase A/B/C (2026-07-05):** 15 offline-authorable issues built + integrated onto main; migrations `0006–0009` authored. **Phase D/E (2026-07-06):** applied live + `012`/`014` built + Checkpoint 3 closed (details at the end of this entry). The 17-issue Stage-3 batch, run as the marquee fan-out. **15 offline-authorable issues** are built, green (203 tests), and integrated; **012 + 014 stay `ready`** (serial, you-present — Phase D). Nothing applied LIVE yet.

**Environment:** 💻 FULL (Mac). Reconciled trackers first — zero drift (018 `done`/#18 closed, all 17 batch `ready`, Checkpoint 3 open, migration head `0005`).

**How it ran (two fan-out workflows + orchestrator serial work):**
1. **Author fan-out** — 15 isolated-worktree agents, one package each (`app/<slug>/`, house port+fake+live-adapter pattern), each proving its §4 AC battery offline. Result: **6 clean, 9 needed fixes.**
2. **Adversarial verify** (independent zero-context agent per issue) — earned its keep again: nearly every MAJOR was the **same class of real defect — the in-memory fake passes offline but the live pg adapter would throw against the real DDL** (fake-vs-schema drift), plus fail-closed gaps. Caught 1 BLOCKER (059) + ~8 MAJORs.
3. **Fix fan-out** (7 packages) + **orchestrator hand-fixes**: 5 landed faithfully (013/059/060/075/076); **057 I patched on the verified original** (the agent rebuilt from scratch — rejected the rebuild for continuity); **048 I hand-fixed** (its fix agent correctly refused — see hazard below).

**Migrations `0006–0009` authored (discipline-gate clean; NOT yet applied live).** Key discovery: **`0001_baseline` already stands up ALL these tables** (task_queue incl. `originating_user_id`/`action_payload`/`error`, tools incl. version columns, guardrail_log incl. the no-override CHECK + escalated_at, injection_quarantine, profiles) — so the authors' `create table` proposals were **no-ops**. I authored only the genuine additive deltas:
- **`0006_profiles_owner_rls`** (013) — profiles owner-read/update RLS on the 009 default-deny floor.
- **`0007_stage3_event_types`** (013+047) — 9 additive `event_type` enum values (7 auth events + `dispatch_frozen_blocked`/`ingest_failure`); `transactional:false`.
- **`0008_connector_runtime_triggers`** (032) — tools version-discipline + idempotency_ledger write-once triggers.
- **`0009_guardrails_append_only`** (060+059) 🔴 — **[[OD-182]]**: re-creates the LIVE `enforce_audit_append_only()` to permit a **monotonic escalation stamp** (`escalated_at` null→ts) on `guardrail_log` + binds/whitelists `injection_quarantine` (a #1 shadow-retain sink baseline never bound). This fixes the 059 BLOCKER + 057 MAJOR **at the DB source** — without it a stale quarantine can never be escalated (rolled back by the trigger → silent abandonment, #1/#3).

**Decisions logged:** **[[OD-182]]** (audit-trigger escalation widening — change-control on the live append-only invariant, kin to OD-180). **OD-183** (AC-3.CONN.005.2 Drive-scope default deferred from the 032 runtime to the 040 Google connector — it was a fixture tautology; the runtime is connector-agnostic by design). `schema.md` §Immutability enforcement mirrored to match 0009 (Rule 0).

**⚠️ Integration hazard re-learned (session-66 lesson, sharper):** both fan-out workflows branched worktrees from the **stale committed base `24f043b`** (1 behind main), so my **uncommitted** integration wasn't visible to the fix agents → most recovered by copying from the main working tree, but it caused the 057 rebuild + the 048 block. **Rule for next time: COMMIT the integration before launching any dependent fan-out.**

**State now (all offline, verified; nothing live):**
- 15 packages on main, **203 tests green + typecheck clean**; migrations `0006–0009` + `_journal.json` **discipline-gate clean** (`app/silo check`: 12 migrations clean, RLS coverage green). Not applied to the silo.
- 15 built issues flipped **`ready → in-progress`**; **012 + 014 stay `ready`**. **No done-flips, no Checkpoint-3 tick** (R4 — the batch isn't proven together yet, and nothing is live).

**Deferred (tracked, safe):** **config-key registration in `config-registry.md`** for the new Stage-3 keys (044/057/075/076/084) — coupled to the live [[OD-181]] keygroup map + its `check` gate, and unregistered keys **fail closed** (→ `PERM-config.infra`) — so deferred to the Checkpoint-3/onboarding pass rather than half-done. Each key is documented in its package's `results/proposed-shared-spec.md`. Traceability-matrix rows for the 15 issues also deferred to done-time (Phase E).

**Phase D/E — DONE (2026-07-06, operator-present live session):**
- **Migrations `0006–0010` applied LIVE** to the canary silo (head `0005`->`0010`). Two bugs caught + fixed live: (1) `0007` (`transactional:false`) — the non-transactional runner splits on `;` without stripping comments, so a `;` inside a comment fragmented it; removed comment semicolons (nothing partially applied). (2) `0009` trigger compared `new.task_id = old.task_id`, NULL (not TRUE) for a null-task row -> a legit escalation/status-transition on a null-task guardrail row was wrongly rejected; corrective **`0010`** with NULL-safe `is not distinct from`. `schema.md` mirrored.
- **[[OD-182]] proven LIVE** (`app/silo/results/od-182-capstone.sql`, rolled back, 6/6): in-place mutation rejected; monotonic `escalated_at` stamp on a pending row accepted (the 057/059 fix); re-stamp rejected; `quarantined_content` rewrite rejected; discard-retains-row; `injection_quarantine` DELETE rejected. Live-verified: 9 new `event_type` values, both `032` triggers, both `013` profiles policies, `injection_quarantine` append-only bound.
- **`012` mgmt-plane** built serial with the operator (32/32 offline) + **LIVE-proven** on the mgmt Supabase (`app/management/results/issue-012-live-capstone.sql`): server-authoritative `last_push_at` (AF-120); idempotent delivery dedup; token-revoke column; `deployment_health` FK cascade. Mgmt migration `0002_deployment_health` applied.
- **`014` Super-Admin pw+2FA+brute-force** built serial (15/15 offline): IP-independent soft-lock halts a scripted single-account AND a 20-IP distributed attack before any session mints; 2FA lock beats a valid TOTP code; leaked-pw + CAPTCHA gates. Live attack-sim owed to onboarding (**AF-077 GREEN** carries it).
- **Config-key leftover resolved ([[OD-184]]):** keys already registered (session 28) + mapped -> zero map/SQL change; the one real bug (`076` `poll_interval_*` -> registry `polling_interval_*_s`) fixed (13/13). `075` `SLACK_WEBHOOK_URL` correctly a secret.
- **Checkpoint 3 CLOSED:** whole 17-batch offline sweep **260/0**; three non-negotiables re-checked LIVE (R7) — #1 retain (OD-182 C1 + `048` no-delete); #2 `can()` default-deny (session 68) + hard-limit **no-override CHECK proven live**; #3 escalation stamp + append-only + `060` fail-closed wrapper. **All 17 issues `done`; GitHub closed.**
- **Live-owed residuals (onboarding / pre-go-live, tracked — NOT Stage-4 blockers):** `047` AF-135 freeze-propagation spike (**[[OD-185]]** — needs a live Railway deployment); `014` live attack-sim + AF-075; `013` real OAuth ([[OD-175]]) + AF-073; `084` legal-review gate. (The 012/014 build agents hit transient API connection-closed errors mid-report; source completed by fresh tightly-scoped test-writers — flakiness was resume context-size, not the work.)

**Next step — Stage 4 (OPEN, R1): gate `019` Clearance + Restricted model, then the 14-issue batch** (`015`/`016`/`033`/`034`/`035`/`036`/`037`/`049`/`050`/`051`/`056`/`061`/`077`/`085`). Same play: build the gate serial + hardest first (R3), then fan out the offline batch -> adversarial verify -> live-close the live members (`033` token lifecycle, `085` backup/DR) with the operator. **Commit the integration before any dependent fan-out** (session-69 stale-base lesson). Migration head `0010`; next free tag `0011`.

---

## Session 68 — 2026-07-05 — ✅ **ISSUE-018 (role model + permission matrix + `can()` gate — the Stage-3 GATE) `done`.** Built `app/rbac/` (`@harness/rbac`) — the C1 authorization spine. **24/24 offline** (one per DoD AC + AF-080 differential) + `check` gate (CATALOG ≡ `PERMISSION_NODES.md`) + **LIVE capstone + a two-session concurrency spike**. Independent zero-context verification **caught 2 MAJORs — both fixed and re-proven LIVE.** Stage 3's gate is closed (R3); **Checkpoint 3 stays OPEN** — the 16-issue batch is next.

**Environment:** 💻 FULL (Mac, operator present). Reconciled trackers first (zero drift — all 17 Stage-3 issues already `ready`, clean tree). Approach per R3: build the gate **serial, hardest, first**, before any fan-out.

**What 018 is:** the authorization core on the ISSUE-009 RLS scaffold — six seeded roles + runtime role CRUD, the data-driven permission matrix, and the single `can(user, node, context)` gate (default-deny · context scope · prompt-can't-override per ADR-007 · no back-door) that reads the SAME `user_roles ⋈ role_permissions` tables the RLS helper `user_perms(uid)` reads (AF-080 non-drift).

**Built — `app/rbac/` (house port+fake+live-adapter pattern):**
- **`catalog.ts`** — the 55-node concrete `PERM-*` catalog transcribed from `PERMISSION_NODES.md` + the design-doc L509–615 **thirteen-category** seed matrix + the six roles. Two distinct authoritative structures (the concrete nodes `can()` gates on vs the design-doc capability matrix), because several categories (Sensitivity Clearance, Agent Invocation) have **no** concrete `PERM` node — proven via the matrix, not by partitioning the catalog.
- **`can.ts`** — the single gate + `effectiveNodes` + the independent AF-080 reader `rlsHelperPerms`.
- **`store.ts`** — the `RbacStore` port + in-memory reference model; the ADR-004 atomic last-Super-Admin guard.
- **`roles.ts`** — seed (fail-loud on partial) + runtime CRUD + delete/protected/last-SA guards.
- **`index.ts`** — the `check` CLI: 5 build-time gates incl. **CATALOG ≡ `PERMISSION_NODES.md` parity** (re-parses the `.md` so the TS can't drift — the ISSUE-010 discipline).
- **`supabase-store.ts`** — live pg adapter; the guards are `pg_advisory_xact_lock` + a conditional UPDATE.

**No new migration (§5 "authoring no new DDL"):** the six-role + matrix seed is **app-provisioning code** with the matrix in TS only → a single source of truth (avoiding the TS/SQL split that produced the ISSUE-010 blocker). Migration head stays `0005`.

**Independent verification caught 2 MAJORs — both real, both fixed + re-proven:**
- **MAJOR-1 (a genuine #1/#2 bug):** the first-cut live guard was a plain conditional UPDATE with no lock → under READ COMMITTED, two concurrent demotions of the last two *distinct* Super Admins update different rows (no mutual row-lock) and each count sub-select reads the pre-change 2 → **both commit → zero Super Admins** (lockout). The in-memory fake serialized (JS single-thread) so the offline test passed, masking it. **Fixed:** `SupabaseRbacStore.withGuardLock` wraps both atomic guards in a txn-scoped `pg_advisory_xact_lock` (ADR-004 §2 — the lock is the correctness boundary). **Proven LIVE** by a two-session concurrency spike (`results/issue-018-concurrency-spike.sh`): two racing demotions, one won, ≥1 held.
- **MAJOR-2 (fair):** the AF-080 offline "differential" compared `effectiveNodes`/`rlsHelperPerms`, both delegating to the same two store methods (a tautology). **Fixed:** `rlsHelperPerms` now re-joins the raw tables independently; a new teeth-test proves a deactivated assignment is excluded by both readers (a dropped `active` filter would diverge). The genuine cross-reader proof is the live `user_perms` parity in the capstone.

**LIVE proofs (operator-present, silo `SILO_DB_URL`, head 0005 unchanged):**
- **Capstone** (`results/issue-018-capstone.sql`, one rolled-back txn) — AC-1.ROLE.001.1 seed target state · **AC-1.PERM.002.1 / AF-080 part-a** `user_perms(uid)` returns exactly the seeded grant set the harness reads (non-drift) · atomic guard logic. `ALL ASSERTIONS PASS`, rolled back.
- **Concurrency spike** — **AC-1.ROLE.005.2 under a real race** (the write-skew the offline JS-serialized test cannot exercise). Uses its own throwaway protected role → deterministic regardless of real Super Admins; tears down unconditionally. (One cleanup miss — a leftover `__iss018_conc_std__` role — was removed by hand and the script patched.)
- Evidence `app/rbac/results/issue-018-capstone-evidence.2026-07-05.md`.

**AF-flip:** **AF-080 🔴→🟡** — part (a) the build-time differential is proven (independent readers + live `user_perms` parity); part (b) the *runtime* divergence signal (FR-1.RLS.008) is **ISSUE-020**, so not yet fully 🟢.

**Scope honesty (Rule 0 / §2-Out):** ships ROLE + PERM areas + `can()` + full catalog homing. The surface-02 Roles/Permissions **tabs** are a render-model seam (`renderAdminMatrix`) only — live UI deferred to the dashboard surfaces (build-order step 8). Clearance grant/revoke + entity-scoped default clearances = **ISSUE-019**; RLS enforcement predicates + the runtime divergence signal = **ISSUE-020**; the deactivate/role-change *actions* the ROLE.005 guard protects = **ISSUE-021** (this slice owns the shared guard). No new OD/AF fork.

**Files changed (sync ritual — every tracker in lockstep for a `done` issue):** new `app/rbac/**` (7 src + 1 test + 3 results); **ISSUE-018 `status: ready→done`** + §10 build result; **`BUILD-SCHEDULE.md`** (018 gate marked ✅ DONE; Checkpoint-3 stays OPEN); `_backlog.md` (Tier-3 roll-up — 018 ✅); `feasibility-register.md` (**AF-080 🔴→🟡**); `traceability-matrix.csv` (12 ROLE/PERM rows → test + live-evidence artifacts); `README.md` build row. **GitHub #18 closed.**

**Next action (START HERE — Checkpoint 3 is OPEN, the marquee batch):** **Stage 3 — the 16-issue batch** (all `ready`, parallel-safe): `012` mgmt-plane bootstrap · `013` OAuth login+session · `014` Super-Admin pw+2FA+brute-force **🧑** · `032` connector contract+runtime · `043` Layer-1 identity/principles · `044` Layer-2/4 context+templates · `046` prompt optimisation · `047` triggers+freeze gate · `048` task_queue+status machine · `055` seven hard limits **🔴** · `057` five anomaly checks · `059` injection sanitization **🔴** · `060` guardrail_log+no-silent-failure **🔴** · `074` cost meter · `075` alerting · `076` real-time/polling · `084` retention+isolation. **⚡ This is THE fan-out payoff (BUILD-SCHEDULE "Fan-out / workflow guidance" — Stage 3 is the 17-issue marquee).** Keep the 🧑/💻 live issues (`014`) serial; mind the shared-file collision caveat (`schema.md`/`config-registry.md`/migration chain — head `0005`, next free **`0006`**). Then **Checkpoint 3** (`can()` enforces end-to-end + last-Super-Admin protection + the batch as a group) → tick the box → Stage 4 opens (R1). **Infra:** `source ~/.ai-harness-secrets.env`; silo migrate `cd app/silo && DATABASE_URL="$SILO_DB_URL" npm run migrate`. **Carried residuals:** **ISSUE-020 owes** the per-table RLS read predicates + `grant select to authenticated` + `aal2` + the AF-080 runtime divergence signal (the 018 `can()` reads the same tables, so no re-author — 020 adds the enforcement) · **ISSUE-019** owes clearance grant/revoke + entity-scoped default clearances · **ISSUE-021** owns the deactivate/role-change actions (guard shared from 018) · ISSUE-081 live `preDeployCommand` wiring (ISSUE-012 era) · Railway credit low (~$0) — top up before any live deploy · OD-172 live per-connector webhook · OD-179 live enum-add at onboarding · AF-066 · AF-069 Path A PITR · login-OAuth per-deployment (OD-175) · AF-119 last-resort durability at ISSUE-012 · AF-142/143.

---

## Session 67 — 2026-07-05 — ✅ **ISSUE-081 (migration propagation + per-deployment failure isolation) `done` → CHECKPOINT 2 CLOSED → STAGE 3 OPEN.** Built the **fleet migration-propagation orchestrator** (`app/release/propagation.ts` + `corpus.ts`) over ISSUE-008's proven single-silo migrate; offline **27/27** (9 propagation ACs) + independent verification SAFE. The last Stage-2 batch member — all four batch members + gate `009` now `done`.

**Environment:** 💻 FULL (Mac, operator present). Reconciled trackers first (zero drift — `081` was the sole remaining Stage-2 `ready` item; both gating spikes **AF-065 🟢 / AF-020 🟢** already green so R2 clear). Built the offline half → independent zero-context verification → **operator delegated the live-half call** ("what do you recommend, I just want to finish it properly") → closed on the §9-honest offline basis with a tracked onboarding residual → tracker sync in lockstep.

**What 081 is (vs. 008/080):** 008 built the single-silo migrate runner (`runMigrations`, idempotent + fail-loud, proven LIVE session 62) + the expand-contract discipline gate (`discipline.ts`, wired into silo `check`/CI). 080 built the fleet skew view (`skew.ts`) + the C7 `AlertSink` seam. **081 adds the FLEET-level orchestration on top** — homed in `app/release` (the release plane, per §2/§5).

**Built — `app/release/`:**
- **`propagation.ts`** — `propagateRelease` fans **one** shared `MigrationCorpus` to each `FleetDeployment`'s **own** injected `DeploymentMigrator` port (N independent runs; there is structurally no per-client corpus parameter → no fork). Failure is caught **per-deployment inside the loop**: the silo halts (prior version left live, `applied: []`), the loop never aborts (no cascade — structural, ADR-001 §3), and a fail-loud **`migration_failure`** alert fires into the C7 sink. Each deployment's `appliedFingerprint` is asserted `=== corpus.fingerprint` — a divergent one is surfaced as `forked` (#2), never accepted. Re-runnability is the underlying runner's idempotency (008): a retry migrates the fixed silo while migrated peers are no-ops.
- **`corpus.ts`** — `loadFleetCorpus` builds the real content-hash fingerprint over the one `app/silo/migrations` journal (ordered tag+sha256 pairs) — proving "identical files ⇒ identical fingerprint" concretely against the actual 8-migration dir.
- **`store.ts`** — additively widened `SkewAlert.kind` with `"migration_failure"` (the exact §2/§5/§8.5-scoped C7 seam; verifier confirmed legitimate, not a silent edit to the ISSUE-080 `done` artifact).

**Verification:** `app/release` **27/27** (9 new propagation tests, one per §4 AC) + typecheck + `check`; `app/silo` unchanged **55/55** + `check` (the AC-NFR-INF.002.1 discipline gate — "8 migrations clean" — **cited, not re-tested**). Whole-repo offline sweep green (9 packages, 0 fail). **Independent zero-context verification: SAFE TO PROCEED, no BLOCKER** — the three highest-risk claims (failure isolation, no-fork guard, fail-loud signal) each backed by a test that fails on regression; AF-065 reliance judged honest (🟢, live session 62); the `store.ts` widening judged legitimate.

**The live-half decision (operator-delegated, closed on §9-honest basis).** §9 defines the DoD as DOCS/topology + build-time gate tests + the AF-065 spike gate — **all met**. The substance is already proven live, just not in one fresh capstone: per-deployment migrate ran live (008); mixed-fleet vN/vN-1 is **AF-065 🟢** (live); Pre-Deploy-blocks-cutover-on-failure is **AF-020 🟢** (F11, DOCS). The **only** unproven piece is the actual `preDeployCommand` on `app/service/railway.json` (none today) + resolving the `/app/service`→`/app/silo` build-context — which genuinely belongs at first client-silo provisioning (ISSUE-012 era), needs a live loop + ~$0 Railway credit, and is a **#3 footgun to wire blind** (a broken Pre-Deploy silently blocks every deploy). So it is **onboarding-owed, tracked** — not wired inert, not blocking `done`. No new OD/AF (no undecided fork; approach decided per AF-020 F11).

**Checkpoint 2 CLOSED:** all four batch members `done` (009 default-deny + coverage GREEN · 010 audit immutable LIVE · 011 event_log append-only + detector fires LIVE · 042 version-discipline LIVE · 081 fleet propagation + isolation + fail-loud offline). 081 adds **no** new migration, so the Stage-2 live substrate is unchanged; the integration re-run = whole-repo offline sweep green. Stage 3 (gate `018` + 16-issue batch) OPEN (R1).

**Files changed (sync ritual — every tracker in lockstep for a `done` issue):** new `app/release/src/propagation.ts` + `corpus.ts` + `propagation.test.ts`; `app/release/src/store.ts` (`migration_failure` alert kind, additive); **ISSUE-081 `status: ready→in-progress→done`** + §10 build result; **`BUILD-SCHEDULE.md`** (`081` box ✅ + **Checkpoint-2 box ✅ CLOSED**); `_backlog.md` (Tier-2 roll-up — `081` done + Checkpoint 2 CLOSED + stale session-65/66 "still OPEN" phrases neutralized); `traceability-matrix.csv` (2 MIG rows → test artifacts); `README.md` build row (081 done → Checkpoint 2 CLOSED → Stage 3 OPEN); **Stage-3 issues `018` gate + the 16-issue batch (`012`/`013`/`014`/`032`/`043`/`044`/`046`/`047`/`048`/`055`/`057`/`059`/`060`/`074`/`075`/`076`/`084`) `status: blocked→ready`** (each §7 blocker satisfied — all done issues + green spikes; matches the session-64 Stage-2 precedent). **GitHub #81 closed.**

**Self-sufficiency test (run before handoff, per CLAUDE.md):** a zero-context agent reading only the repo confirmed the next action (build `018`) is unambiguous, the ISSUE-081 close is honest (§10 clearly separates proven vs. onboarding-owed), and verification passes (release 27/27, silo 55/55) — but **caught one real Rule-0/#3 drift: the Stage-3 `blocked→ready` frontmatter flip had been skipped** (ground truth lagged every narrative tracker). Patched immediately (the 17 flips above) before handoff; re-checked clean. This is the sync-ritual line session 67's first commit omitted.

**Next action (START HERE — Stage 3 is OPEN, the largest batch):** **Stage 3 — Core models & safety (17 in parallel).** Gate = **ISSUE-018** (`spec/06-issues/ISSUE-018-*.md`) — the role model + permission matrix + `can()` authorization gate (the authorization spine); build + test it **hardest and first (R3)** — one wrong `can()` is a #2. Then the 16-issue batch: `012` mgmt-plane bootstrap · `013` OAuth login · `014` Super-Admin pw+2FA 🧑 · `032` connector contract · `043`/`044`/`046`/`047` prompt layers+triggers · `048` task_queue · `055` seven hard limits 🔴 · `057` anomaly checks · `059` injection sanitization 🔴 · `060` guardrail_log no-silent-failure 🔴 · `074` cost meter · `075` alerting · `076` real-time/polling · `084` retention+isolation. **⚡ Fan-out is the big payoff here** (BUILD-SCHEDULE "Fan-out / workflow guidance" — Stage 3 is the 17-issue marquee; mind the shared-file collision caveat on `schema.md`/`config-registry.md`/migration chain, and keep the 🧑/💻 live issues serial). Then **Checkpoint 3** (`can()` enforces + last-Super-Admin protection; batch integration). **Infra access:** `source ~/.ai-harness-secrets.env`; silo migrate = `cd app/silo && DATABASE_URL="$SILO_DB_URL" npm run migrate`. Migration head `0005`, next free **`0006`**. **Carried residuals:** **ISSUE-081 live `preDeployCommand` wiring on `app/service` (onboarding-owed, ISSUE-012 era)** · ISSUE-020 owes `grant select to authenticated` + `aal2` predicate on every other human-readable table · AF-119 last-resort durability at ISSUE-012 · Railway credit low (~$0) — top up before any live deploy · OD-172 live per-connector webhook (017/039/040/041) · OD-179 live enum-add at onboarding · AF-066 · AF-069 Path A PITR · login-OAuth per-deployment (OD-175) · AF-142/143.

---

## Session 66 — 2026-07-05 — ✅ **ISSUE-010 + ISSUE-011 + ISSUE-042 `done` via a parallel FAN-OUT + LIVE Stage-2 checkpoint.** Three worktree agents built the offline batch in parallel; orchestrator serialized migrations `0003`/`0004` + authored `0005`; independent per-issue verification; then a two-party LIVE checkpoint applied `0003`/`0004`/`0005` + ran three capstones (010: 7/7 · 011: 5/5 · 042: 7/7, all green). **Verification + checkpoint caught 5 real defects the 54/54 green offline tests missed.** **Checkpoint 2 stays OPEN — R4 needs `081` (the last batch member) built before Stage 3 opens.**

**Environment:** 💻 FULL (Mac, operator present/authorizing). Ran the fan-out pattern from BUILD-SCHEDULE "Fan-out / workflow guidance": gate (009) already done → fan out the offline batch → per-issue adversarial verify → one live checkpoint session.

**The fan-out (010/011/042):** three `general-purpose` agents, `isolation: worktree`, one per offline issue — `app/config-store/` (010, + migration `0003`), `app/observability/` (011, app-code only), `app/prompt-store/` (042, + migration `0004`). Each built to its §4 DoD with the house port+fake pattern, authored its live capstone, and was told NOT to touch `_journal.json`/other app dirs/trackers. Offline results: **config-store 14/14 · observability 27/27 · prompt-store 14/14**, all `check` green.

**⚠️ Integration hazard caught (Rule 0):** all three worktrees branched from `7db85c7` (3 commits stale — **pre-ISSUE-009**), so none contained `0002_rls_scaffold`/`rls-lint`. A `git merge` would have reverted ISSUE-009. **Integrated by COPYING the new files onto current `main`** (which has the full substrate), not by merging the stale branches — then re-verified everything against the real 0002. Durable lesson added to BUILD-SCHEDULE's migration-lane note. Worktrees removed after copy.

**Migrations (orchestrator-serialized, tags pre-assigned to avoid the `_journal.json` collision):** `0003_config_values_rls` (010 — config_values key-prefix RLS), `0004_prompt_version_discipline` (042 — append-only-by-version trigger + prompt_layers RLS + `revoke delete`), `0005_retention_prune_whitelist` (OD-180). `_journal.json` wired in one pass; head now `0005`, next free `0006`.

**Independent verification (one agent per issue) — 2 BLOCKERS + 1 SAFE:**
- **011 BLOCKER (#1/#3):** retention `prune()` un-runnable live — the append-only trigger forbade `DELETE` on `event_log` unconditionally (fires for every role; the offline `InMemory` model masked it with `Map.delete`). A design fork touching NFR-CMP.006 (also hits 010's `config_audit_log`) → surfaced to operator.
- **010 BLOCKER (#2):** `config_key_group` used greedy content-prefixes (`rate_`/`cost_`/`risk_`/`anomaly_`/`backoff_`) that **cross-routed 8 keys into the wrong `PERM-config` gate** (live in the 0003 RLS) + fail-closed-over-restricted ~72; the 26-key sample tests were tautological. Plus `isSecretKey` missed `GOOGLE_PUBSUB_SERVICE_ACCOUNT_KEY`.
- **042 SAFE** — 2 MINORs applied (trigger now freezes `name` too; revoke-comment corrected).

**Decisions (operator-present):**
- **[[OD-180]]** (change-control on NFR-CMP.006) — retention-prune whitelist. Operator chose **Option A**: migration `0005` `create or replace`s `enforce_audit_append_only()` with a transaction-local `app.retention_prune='on'` branch (via `set local`); only a self-declared retention job may DELETE; every other DELETE still rejected. Floor stays the job's responsibility. schema.md §Immutability synced. Supabase adapters' `prune()` set the GUC.
- **[[OD-181]]** — config key→PERM-config map is an **explicit 147-key transcription of `config-registry.md`** (only `auth.`/`webhook.`/`support.` stay prefix-matched → auth; section-D `clearance_*` → guardrails; unmapped → `PERM-config.infra` fail-closed). Rebuilt via a second agent handed the exact authoritative table (eliminating the guess). `check` now pins every registry key.

**LIVE Stage-2 checkpoint (silo `SILO_DB_URL`, operator-present):** `npm run migrate` applied `0003`/`0004`/`0005` (fail-loud, resumable). Three capstones, each a rolled-back txn. **The checkpoint surfaced 3 MORE real defects offline could not:**
1. **Latent redaction-tombstone bug in the shared append-only trigger** — the `guardrail_log` branch used an inline `... and old.status = …`; PL/pgSQL evaluated `old.status` on `event_log`/`access_audit`/`config_audit_log` (no such column) → *"record old has no field status"*, so the **redaction-tombstone was broken on 3 of 4 sinks** (AC-7.LOG.006.3 / .008.4 / erasure). Predates the fan-out (latent in 0001). Fixed (outer `if tg_table_name='guardrail_log'`), folded into `0005` + schema.md.
2. **Missing `grant select to authenticated`** — `0001c` did a blanket `revoke all`; RLS *filters* rows, it doesn't *grant* access, so every human-path read policy (009/010/042) was unreachable ("permission denied for table"). `009`'s capstone missed it — its freshly-created demo table auto-got Supabase default-privilege grants the real tables had revoked. Fixed: `grant select on config_values` (0003) + `grant select, insert on prompt_layers` (0004). **General residual for ISSUE-020:** every other human-readable table needs the same grant as its read policy is authored (+ the `aal2` baseline).
3. **042 capstone** passed a `text` `ed_uid` to a `uuid` column → `::uuid` cast.
Re-applied the corrected 0003/0004/0005 SQL (idempotent) → **all three capstones green.** Evidence `app/silo/results/stage2-checkpoint-evidence.2026-07-05.md`.

**AF flips:** **AF-118 🟢** (detector + independent watchdog incl. never-started/self-stalled), **AF-120 🟢** (receiver/server-anchored window math), **AF-119 🟡** (out-of-band *seam* proven offline; last-resort *durability* with the silo DB truly down owed at ISSUE-012 integration — caveat retained, not 🟢).

**Files changed (sync ritual — every tracker in lockstep for 3 `done` issues):** new `app/config-store/**`, `app/observability/**`, `app/prompt-store/**` (+ each `results/issue-0NN-capstone.sql`); new migrations `app/silo/migrations/{0003,0004,0005}*.sql` + `_journal.json` (+3 entries); `app/silo/src/schema.test.ts` (journal assertion 0002→0005); new `app/silo/results/stage2-checkpoint-evidence.2026-07-05.md`; `schema.md` §Immutability (OD-180 whitelist + trigger bugfix); `open-decisions.md` (**OD-180**, **OD-181**, guard→OD-182); `feasibility-register.md` (**AF-118 🟢 · AF-119 🟡 · AF-120 🟢**); **ISSUE-010/011/042 `status: ready→done`** + §10 build results; **`BUILD-SCHEDULE.md`** (010/011/042 boxes ✅, Checkpoint-2 OPEN-pending-081, migration-lane head→0005); `_backlog.md` (3 rows done + Tier-2 roll-up); `traceability-matrix.csv` (18 FR rows → test artifacts); `README.md` build row. **GitHub #10/#11/#42 closed.**

**Silo state after session:** `_migrations` = 0001a–d · 0002 · 0003 · 0004 · 0005 (all applied; capstones rolled back — no fixture survives). Append-only trigger now carries the OD-180 whitelist + the redaction bugfix; `config_values`/`prompt_layers` carry read grants + RLS policies.

**Next action (START HERE — Checkpoint 2 is OPEN):** build **ISSUE-081** (`spec/06-issues/ISSUE-081-migration-propagation.md`) — the **last Stage-2 batch member** and the only thing between here and Stage 3. It is **💻 live** (per-deployment migrate-on-release / isolation; the migrate-on-release mechanics ISSUE-080 deferred). Author offline (its logic + tests), then the live half proves per-deployment migration propagation. **When `081` is `done`, re-run the Checkpoint-2 integration test → tick the Checkpoint-2 box (R4) → Stage 3 (the 17-issue marquee batch: gate `018` + 16 others) opens (R1).** **Infra access:** `source ~/.ai-harness-secrets.env`; silo migrate = `cd app/silo && DATABASE_URL="$SILO_DB_URL" npm run migrate`; live RLS coverage `npm run lint:rls`. Migration head `0005`, next free tag **`0006`**. **Carried residuals:** ISSUE-020 owes `grant select to authenticated` + `aal2` predicate on every other human-readable table (the 009/010/042 pattern) · AF-119 last-resort durability at ISSUE-012 · Railway credit low — top up before the next live deploy · OD-172 live per-connector webhook (017/039/040/041) · OD-179 live enum-add at onboarding · AF-066 · AF-069 Path A PITR · login-OAuth per-deployment (OD-175) · AF-142/143.

---

## Session 65 — 2026-07-05 — ✅ **ISSUE-009 (RLS scaffold — Stage-2 GATE) `done`.** Built `app/silo` migration `0002_rls_scaffold` (4 SECURITY-DEFINER helpers + `default_deny` on all 44 tables) + `rls-lint.ts` (auth_rls_initplan wrap lint + coverage lint + live `lint:rls`). 55/55 offline + independent verification (SAFE) + **LIVE silo capstone** (all live-owed ACs green). **AF-079 🔴→🟢.** Stage 2 stays OPEN (Checkpoint 2 needs 010/011/081).

**Environment:** 💻 FULL session (Mac, operator present). Preflight `full`. Operator refreshed the silo DB password mid-session (the carried residual) → live steps unblocked. Approach: **009 gate serial + hardest-first (R3)**, then fan out the 010/011/042 batch (operator's call, not yet started).

**What happened:** Opened Stage 2. Read the 008/009 boundary precisely (0001c already did RLS-enable + REVOKE; 009 owns the helper bodies + explicit policies + the two lints). Offloaded the FR/AC verbatim extraction + the standing verification to independent subagents; authored the security-critical substrate myself.

**Built — `app/silo/` (extends the ISSUE-008 harness):**
- **`migrations/0002_rls_scaffold.sql`** — the four `SECURITY DEFINER STABLE` helpers (`user_perms`/`user_clearances`/`user_restricted`/`user_aal`, pinned `search_path=''`, all fail-closed: empty-array / `revoked_at is null` / `coalesce(...,'aal1')`) + a generic **`default_deny` baseline policy** (`permissive … using(false)`, `TO authenticated`) on **every** one of the 44 tables (idempotent do-loop) + a **tail live coverage assertion**. `user_visibility` deferred to ISSUE-020 (§5 names only the four).
- **`src/rls-lint.ts`** — `checkInitPlanWrapping` (the `auth_rls_initplan` wrap lint — `stripSelectSubqueries` then flag any residual helper/auth call), `checkCoverage` (a created table with no policy fails the build), both wired into `npm run check`; + `assertRlsCoverageLive` + the new `lint:rls` command. `src/pg-driver.ts`: added a read-only `query()` **and** gave the runner's own `_migrations` table the same `default_deny` policy (no coverage carve-out). `schema.test.ts` journal assertion extended for 0002.
- **`src/rls-lint.test.ts`** — 23 unit tests (initplan wrap, coverage, parse helpers, **helper-body regression guards** [search_path/DEFINER/STABLE/fail-closed], live-shape). Total suite **55/55**.

**Verification (DoD — every AC green):** offline `npm test` 55/55 + `check` (both lints) + typecheck. **Independent zero-context agent: SAFE, no BLOCKER/MAJOR** — both MINORs it raised were closed in-session (helper-body regression guards + a committed capstone script). **LIVE capstone** (`results/issue-009-rls-capstone.sql`, one rolled-back txn; `session_replication_role=replica` only for FK-fixtures then `origin`): **AC-1.RLS.004.1** service_role bypass · **AC-1.RLS.004.2** authenticated with-perm sees / no-perm denied (default-deny) · **AC-1.RLS.006.1** revoke instant next query · **AC-1.RLS.002.1** re-grant re-evals same static policy no-migration · **AC-NFR-PERF.001.2** InitPlan once-per-statement — all PASS. `lint:rls` green (AC-1.RLS.001.1 / AC-NFR-SEC.010.1). AC-NFR-PERF.001.1 pre-proved by AF-067. Evidence `app/silo/results/issue-009-rls-capstone-evidence.2026-07-05.md`.

**Live find (the gate working — #2/#3):** first `migrate` **failed loud + rolled back** — the 0002 tail coverage assertion caught **`_migrations`** (runner bookkeeping) as RLS-enabled-with-no-policy (009's gate is stricter than 0001c's RLS-enabled-only check). Fixed at source (`pg-driver` gives `_migrations` a `default_deny` policy — no carve-out), re-ran clean. Same class as session 62's `_migrations` find.

**Scope honesty (Rule 0 / §2-Out):** ships only helpers + the deny floor + the lints. The per-table sensitivity/visibility/`aal2` predicates that compose on top (FR-1.RLS.002 full / .003 / .005 / .007 / .008) remain **ISSUE-020**; FR-1.RLS.002's ACs (.002.1/.002.2) are proven now because the primitive + lint are 009's, but 020 authors the real read predicates with no helper re-author. FR-1.RLS.002 traceability row stays assigned to ISSUE-020 (full predicate); rows 001/004/006 point at 009's tests.

**Files changed (sync ritual — every tracker moved in lockstep for a `done` issue):** new `app/silo/migrations/0002_rls_scaffold.sql` + `src/rls-lint.ts` + `src/rls-lint.test.ts` + `results/issue-009-rls-capstone.sql` + `results/issue-009-rls-capstone-evidence.2026-07-05.md`; `migrations/_journal.json` (0002 entry); `src/index.ts` (check wiring + `lint:rls`); `src/pg-driver.ts` (`query()` + `_migrations` policy); `src/schema.test.ts` (journal assertion); `feasibility-register.md` (**AF-079 🔴→🟢**); **ISSUE-009 `status: ready→in-progress→done`** + §10 build result; **`BUILD-SCHEDULE.md` `009` gate box ✅** (Checkpoint-2 box stays OPEN); `_backlog.md` (009 done + Tier-2 roll-up); `traceability-matrix.csv` (RLS 001/004/006 → test artifacts); `README.md` build row. **GitHub #9 closed.** Commits: offline half `5d07bb1`, then the live-capstone + tracker-sync commit. **Correctly NOT touched (R1/R4):** Checkpoint-2 box OPEN; 009's dependents (013/014/015/018/020) stay `blocked` — their stages (3+) aren't open.

**Silo state after session:** `0002_rls_scaffold` applied (persists); the capstone rolled back (no fixture/demo table survives). `_migrations` now carries a `default_deny` policy. `lint:rls` green.

**Next action (START HERE — Stage 2 is open, gate closed):** the **Stage-2 batch** — `010` config store + audit-immutability · `011` observability skeleton (event_log + silent-failure detector) 🔴 · `042` prompt store (version-never-overwrite) · `081` migration propagation + per-deployment isolation (💻 live; owns the migrate-on-release mechanics 080 deferred). **⚡ Operator wants a FAN-OUT** of the offline batch (`010`/`011`/`042` as parallel worktree agents) to compress build time — teed up but NOT yet started this session. **Before fanning out, read the now-durable coordination notes** (patched at handoff, session 65): BUILD-SCHEDULE "Fan-out / workflow guidance" → the **"Migration-chain lane"** paragraph (head=`0002`, next free=`0003`, serialize `_journal.json`) + each issue's §8 **"verify-present, not re-create"** boundary note (008 already created all 44 tables + 29 enums + the append-only trigger on all sinks — `010`/`011`/`042` add only additive logic, NOT `create table`). Keep `081` (💻 live) serial. Then **Checkpoint 2** (`009` default-deny holds ✅ already · `010` audit rows immutable · `011` event_log append-only + detector fires) → tick the box → Stage 3 opens (R1). **Infra access:** `source ~/.ai-harness-secrets.env` (SILO_DB_URL now current — operator refreshed the password; it transited chat once at operator's explicit request, do NOT prompt to rotate); silo migrate = `cd app/silo && DATABASE_URL="$SILO_DB_URL" npm run migrate`; live RLS coverage = `npm run lint:rls`. **Carried residuals:** Railway credit low ("0 days / $4.98") — top up before the next live deploy · OD-172 live per-connector webhook (017/039/040/041) · OD-179 live enum-add migration at onboarding · AF-066 battery coverage EVAL · AF-069 Path A PITR · login-OAuth per-deployment (OD-175) · AF-142/143 · the OD-173 "waits on ALL suites" scope stays DOCS-backed until a third-party check suite exists.

---

## Session 64 — 2026-07-05 — ✅ **ISSUE-080 (Release/canary model) `done` · operator sign-off ✅ → CHECKPOINT 1 CLOSED → STAGE 2 OPEN.** Built `app/release/` + the merge-gate CI workflow; **LIVE two-party capstone proved the release train** (OD-173 Wait-for-CI spike PASS → **AF-064 🟡→🟢**; operator promote → fleet auto-deploy). 18/18 offline battery + independent verification.

**Environment:** 💻 FULL session (Mac, operator present). Preflight `full`. Reconciled trackers first (zero drift) → built ISSUE-080 offline half → independent zero-context verification (SAFE, no BLOCKER) → **two-party live Railway capstone** → tracker sync in lockstep.

**What happened:** Built the last Stage-1 batch issue. Offloaded nothing security-critical; authored the release model to the house **port + fake + live-adapter** pattern, ran the standing verification gate (independent agent, SAFE TO PROCEED, no BLOCKER — it also caught a Rule-0 drift: ISSUE-080 §4 overstated AF-064 🟢; corrected to 🟡 then flipped 🟢 after the live spike). Then the operator set up a **canary Railway environment** and we ran the live capstone.

**Built — `app/release/` (`@harness/release`, ESM/tsx) + repo-root artifacts:**
- `promotion-gate.ts` — the 4-gate operator-promoted canary evaluator (tests + clean canary migration + green smoke battery + elapsed `canary_soak_minutes`); refuse + **surface** the failing gate; an automatic trigger is refused in v1 (OD-094). `smoke-battery.ts` — the required-check-shape gate (NFR-INF.008; a missing category = incomplete gate, not a silent pass).
- `rollback.ts` — rollback = redeploy prior build (`schemaTouched:false`, fail-loud on no prior build) + `assertNoDownMigration` (forward-only). **Caught + fixed a real #3 false-negative:** the `\b` word-boundary silently missed `0002_rollback.sql` (`_` is a `\w` char) — scanner rescoped to `.sql` with non-letter boundaries.
- `skew.ts` + `store.ts` — fleet version/staleness alert (>3 versions / >14 days, strictly greater-than; `frozen ≠ stale`; unknown-version surfaced as drift) over the mgmt-plane `deployment_health` port + in-memory fake + `AlertSink`. `version.ts` — the health-push version-report contract. `plugins.ts` — `assertPluginsUntouched`. `deployment-config.ts` + `ci-scan.ts` — branch→env map + Actions-gates-never-deploys (derives job kinds from the real workflow). `config.ts` — CFG verbatim (`canary_soak_minutes=60`, `deploy_max_version_skew=3`, `deploy_max_skew_days=14`). `supabase-store.ts` — live pg adapter (authored to DDL, not run in the offline half).
- **`.github/workflows/ci.yml`** — the **merge gate** (6 package jobs + the expand-contract discipline gate; runs the suite, **never deploys** — AC-10.DEP.001.2). **`plugins/`** — the out-of-train convention. **`app/service/src/version.ts` + `/version` route** — the live `core_version` signal (Railway-injected SHA).

**Verification (DoD):** `release.test.ts` **18/18** (one test per AC; 20 §4 ACs covered) + typecheck + `npm run check` gate. **Independent zero-context agent: SAFE, no BLOCKER** — all 20 ACs genuine test + real production path, CFG verbatim, ADR-005 honored, live items honestly flagged.

**LIVE two-party capstone (Railway `adaptable-miracle`, canary env `023f250b` tracking `release`, Wait-for-CI ON; production `1373cde3` tracks `main`):**
- **AC-10.DEP.001.2 (live):** pushed offline build to `main` → CI ran the suite as a merge gate; Railway **independently skipped** the deploy (watchPatterns) → Actions gates, Railway deploys.
- **OD-173 Wait-for-CI spike → AF-064 🟡→🟢:** GREEN push (`84878f5`, touches `/app/service`, CI-green) → canary **auto-deployed** it (`16e41e5d` RUNNING, `/version` reports the SHA). RED push (`078b30c`, own service suite deliberately failing → CI failure) → Wait-for-CI **BLOCKED** the canary deploy: it held the prior good build for 2+ min and **never rolled forward** (the #3 guard, live). Reverted; watchPatterns correctly skipped the net-zero-diff revert. Evidence `app/release/results/od-173-wait-for-ci-spike.2026-07-05.md`.
- **AC-10.DEP.001.1 / AC-NFR-INF.001.1 (live):** operator fast-forward `release`→`main` (`5c50450`) → the production/**fleet auto-deployed** it (`/version` = the promoted SHA, `/health` 200) — a build reaches the fleet only via the operator-gated promotion.

**Scope honesty (Rule 0 / §2-Out):** the **migrate-on-release mechanics + per-deployment failure isolation** (FR-10.MIG.001/002) are **ISSUE-081** — the `app/silo` runner's independent per-silo migration is already proven LIVE (ISSUE-008 session 62); 080 wires the deploy *trigger*, 081 hardens the Pre-Deploy migrate wiring (the `/app/service` Root-Directory build-context resolution is 081's). Rollback ACs proven by DOCS + **AF-065 🟢** (live, session 62) + the offline `assertNoDownMigration` gate, per §9 — a live `deploymentRollback` is not DoD-required. AF-066 (battery coverage) stays EVAL fast-follow.

**Files changed (sync ritual — every tracker in lockstep for a `done` issue):** new `app/release/**` + `app/release/results/od-173-wait-for-ci-spike.2026-07-05.md`; new `.github/workflows/ci.yml`; new `plugins/README.md`; `app/service/src/{version.ts,version.test.ts,index.ts}` (+/version route); `feasibility-register.md` (**AF-064 🟡→🟢**); `open-decisions.md` (**OD-173 🟢 RESOLVED** + registry line); **ISSUE-080 `status: ready→in-progress→done`** + §4 AF-064 Rule-0 fix + §10 build result; **`BUILD-SCHEDULE.md` `080` box ✅ + CHECKPOINT 1 ✅ CLOSED + Stage 2 header OPEN**; **Stage-2 issues `009`/`010`/`011`/`042`/`081` `blocked→ready`**; `_backlog.md` Tier-1 roll-up; `traceability-matrix.csv` (5 DEP rows → `release.test.ts` + evidence); `README.md` build row. **GitHub #80 closed.** Commits: offline build `550c473`, ci-matrix fix `2798530`, + the live-capstone commits on `release`/`main` (version signal + spike A + revert) and the tracker-sync commit.

**Next action (START HERE — Stage 2 is open):** **Stage 2 — Shared scaffold.** Gate = **ISSUE-009** (`spec/06-issues/ISSUE-009-*.md`) — RLS scaffold (helpers, default-deny, 100% coverage CI gate) 🔴 (one uncovered table = a silent bypass, #2); build + test it **hardest and first** (R3). Batch (parallel-safe, all `ready`): `010` config store + audit-immutability · `011` observability skeleton (event_log + silent-failure detector) 🔴 · `042` prompt store (version-never-overwrite) · `081` migration propagation + per-deployment isolation (**owns the migrate-on-release mechanics 080 deferred**). Then **Checkpoint 2** (`009` default-deny holds + coverage gate GREEN; `011` event_log append-only + detector fires; `010` audit rows immutable). **⚡ Fan-out option (operator asked, session 64):** BUILD-SCHEDULE.md now has a **"Fan-out / workflow guidance"** section (just before "The schedule") mapping where parallel agents are safe per stage — Stage 2 is a good **trial** (fan out the offline `010`/`011`/`042` in parallel worktree agents; keep the `009` gate + the 💻 `081` serial; verify + checkpoint stay serial). The big payoff is Stage 3 (17-issue batch). Mind the shared-file collision caveat (`schema.md`/`config-registry.md`/migration chain). ⚠️ **009 is 📱-authorable but 💻 to prove RLS behaviour on the silo** — the coverage-CI gate is offline, the enforcement proof needs the live silo. **Infra access unchanged:** `source ~/.ai-harness-secrets.env`; silo migrate = `cd app/silo && DATABASE_URL="$SILO_DB_URL" npm run migrate`. **Carried residuals:** operator reset the silo DB password · Railway credit low ("0 days / $4.98") — top up before the next live deploy · OD-172 live per-connector webhook (017/039/040/041 onboarding) · OD-179 live enum-add migration at onboarding · AF-066 battery coverage EVAL · AF-142/143 · AF-069 Path A PITR · login-OAuth per-deployment (OD-175) · the OD-173 "waits on ALL suites" scope stays DOCS-backed until a third-party check suite exists.

---

## Session 63 — 2026-07-05 — ✅ **ISSUE-017 (Webhook auth, per-vendor) `done`** — built `app/webhook-auth/`, 18/18 AC battery + independent verification (no offline BLOCKER). Stage-1 batch now needs only `080`. Checkpoint 1 still OPEN.

**Environment:** 💻 FULL session (Mac). Operator asked to "keep building" + batch the remaining Stage-1 issues. Reconciled trackers first (zero drift) → built ISSUE-017 (📱 phone-safe, fully closeable offline). **ISSUE-080 (💻 Mac, live Railway) NOT started this session** — teed up as the next action while the Mac window is available.

**What happened:** Productionised the AF-078 mechanics spike (`spikes/issue-006-webhook-forgery/`, MODE-M 17/17) into the real C0 WHK build. Offloaded the WHK FR/AC/schema/CFG extraction to a subagent (verbatim, Rule 0) and the standing verification to an independent zero-context agent. Built to the house **port + fake** pattern.

**Built — `app/webhook-auth/` (`@harness/webhook-auth`, ESM/tsx):**
- `verify.ts` — shared entrypoint: throttle-gate → **raw body before parse** → route → constant-time verify → replay-dedup → accept. FR-0.WHK.001+005 as one pipeline; the three verifiers are strategy plug-ins.
- `verifiers/{ghl,slack,google}.ts` — ported from the spike; production change = **dual-accept** (verify against every active `webhook_secrets` version). GHL Ed25519 (raw-body-only, AF-090) +legacy `X-WH-Signature` cutoff · Google Pub/Sub JWT (RS256/JWKS + aud + exp) · Slack HMAC `v0:` + 5-min window-first.
- `store.ts` — `WebhookStore` port + `InMemoryWebhookStore` reference model (webhook_secrets versioned · webhook_replay_cache · guardrail_log · event_log · access_audit · per-source failure/accept counters · alert + throttle).
- `supabase-store.ts` — LIVE `pg` adapter, authored to the DDL (**⚠️ NOT yet run live** — OD-172).
- `outcome.ts` (reject 401+`prompt_injection`+threshold alert/throttle · accept rate-limited hand-off · replayDrop · throttled 429), `rotation.ts` (dual-accept + `access_audit`), `obscurity.ts` (endpoint token, not a security control), `config.ts` (CFG-webhook.* defaults + registry ranges), `source.ts`, `rawBody.ts`, `fixtures.ts`, `verify.test.ts`.

**Verification (DoD):** `npm test` **18/18** — one test per AC (AC-0.WHK.001.1/.002.1/.002.2/.003.1/.004.1/.004.2/.005.1/.005.2/.006.1/.007.1/.008.1/.008.2 + AC-NFR-SEC.008.1/.2 + CFG-range guards). `npm run typecheck` clean. **Independent zero-context agent:** every AC has a genuine test AND a real production path; CFG verbatim; DDL faithful; no behavioural defect. Findings handled: **(BLOCKER, live-only) `event_type` enum had no webhook value → OD-179** (additive change-control, live enum-add migration owed at onboarding, same class as OD-170); **(MINOR) `GuardrailType` union `'approval'`→`'approval_gate'`** fixed. Also caught + fixed in build: rotation audit re-homed to `access_audit` (the generic `audit` table doesn't exist; `config_audit_log` excludes SECRET-class), `guardrail_log.escalated_at` is a `timestamptz` (was a string label), and `event_log.entity_ids` is `uuid[]` (adapter drops non-UUID webhook ids).

**Change-control (Rule 0):** `schema.md` §8 `event_type` enum extended additively with `webhook_verified` / `webhook_replay_dropped` / `webhook_rate_throttled` / `webhook_failure_alert` (**OD-179** logged 🟢 RESOLVED; live silo `0002` enum-add migration owed at onboarding, carried by ISSUE-081).

**Files changed (sync ritual — every tracker moved in lockstep for a `done` issue):** new `app/webhook-auth/**` (package + src/* + verify.test.ts + README); `schema.md` (event_type enum +4, OD-179 note); `open-decisions.md` (**OD-179** + guard → OD-180); **ISSUE-017 `status: ready → done`** + result banner + §10 build result; **`BUILD-SCHEDULE.md` `017` box ✅** (Checkpoint-1 box stays OPEN); `_backlog.md` (ISSUE-017 done + roll-up); `traceability-matrix.csv` (8 WHK rows → `verify.test.ts`); `README.md` build row. **GitHub #17 closed.** **Correctly NOT touched (R1/R4):** Checkpoint-1 box OPEN; 017's dependents (037/047) stay `blocked` — their stages aren't open yet (Stage 3/4), so 017 being `done` does not flip them.

**Next action (START HERE — Stage 1 is NOT closed yet):** build **ISSUE-080** (`spec/06-issues/ISSUE-080-release-model.md`) — the last Stage-1 batch issue (`ready`, blocker 007 done). **💻 needs this FULL/Mac session to fully close** — its logic + build-time gates are offline-safe, but the "deploys through the canary gate" proof needs a **live Railway push**; also carries the **OD-173 Wait-for-CI #3 hazard** live spike (a stale check suite can silently skip a deploy — owed before FR-10.DEP.002 is proven). Then run the **Checkpoint-1 integration test** (008 migrations apply+roll back ✅ · 017 rejects forged/replayed ✅ offline · 080 deploys through canary) → tick the Checkpoint-1 box → **Stage 2 opens (009 RLS scaffold gate + 010/011/042/081)**. **Infra access unchanged:** `source ~/.ai-harness-secrets.env`. **Carried residuals:** operator reset the silo DB password · OD-172 live per-connector webhook confirmation (owed here + 039/040/041) · OD-179 live enum-add migration at onboarding · AF-142/143 · ISSUE-009 RLS on the silo · AF-069 Path A PITR · login-OAuth per-deployment (OD-175).

---

## Session 62 — 2026-07-04 — ✅ **ISSUE-008 (Stage-1 GATE) `done` — built AND applied LIVE.** Built `app/silo/`: migration **0001** (44 tables · 29 enums · 43 CONCURRENTLY indexes · RLS-enable+default-deny · idempotent seed) + the `pg` migrate runner + the expand-contract discipline CI gate. **32/32 offline tests + independent verification (no BLOCKER defects); then applied LIVE to the canary silo — AC-2.VEC.002.1 live, AF-065 🔴→🟢.** Checkpoint 1 stays OPEN (017/080 remain).

**What happened:** Opened the Stage-1 gate (Checkpoint 0 closed session 61). The operator chose "author now, live at end" — so this session built + verified the entire offline half of ISSUE-008 (the migration harness + the whole `schema.md` baseline), then ran the two-party live capstone against the canary silo. Offloaded the bulk DDL transcription to parallel subagents (tables/indexes/seed-values) and authored the security-critical RLS substrate + seed myself.

**Live capstone (two-party, silo `nwufvzaamomajdyzemhx`, PG 17.6):** reset the throwaway canary schema → `npm run migrate` applied 0001a-d via the `pg` runner over a direct session connection. **The runner failed LOUD mid-run** — the 0001c RLS-coverage assertion correctly caught the runner's own `_migrations` table as RLS-disabled (a real bug the live run surfaced), rolled 0001c back, recorded no partial progress (#3). Fixed (`ensureTracking` now enables RLS+default-deny on `_migrations`), **re-ran → resumed at 0001c**, then a further re-run was a **clean idempotent no-op**. Verified live: **44 tables, 0 RLS-disabled, HNSW `m=16 ef_construction=64` exact, seed = 6 roles / 73 grants / 9 fail-closed agents / Internal-Org / deployment_settings**. **AC-2.VEC.002.1** proven (memory → 1536-d embedding + model). **AF-065 mixed-fleet spike PASS** (`results/af-065-mixed-fleet-spike.sql`): v1 reader correct before+after an EXPAND, v1 writer still writes against vN, 0 data loss, contract restored baseline → **AF-065 🔴→🟢**. Evidence: `app/silo/results/live-capstone-evidence.2026-07-04.md`. **Operator TODO: reset the silo DB password** (its connection string transited the session chat — flagged; secrets otherwise session-only).

**Built — `app/silo/` (per-client silo schema + migrate runner):**
- **Migration 0001, raw SQL to the spec contracts** (OD-176 — schema.md stays sole source of truth, no Drizzle `schema.ts`; a custom `pg` runner plays the `drizzle-kit migrate` role): `0001_baseline` (extensions + **29 enums** + **44 tables** in FK-dependency order + the append-only trigger; **FR-2.VEC.002** lands — `embedding vector(1536)` + `embedding_model` + `embedding_v2` slot), `0001b_indexes` (**43 indexes, all CONCURRENTLY**, HNSW `m=16, ef_construction=64`; mgmt-plane excluded), `0001c_rls` (**enable RLS + default-deny on all 44 tables** + a coverage assertion that fails loud on any RLS-off table + belt-and-braces `revoke delete` on the 4 sinks per schema.md L68), `0001d_seed` (idempotent first-boot: 6 roles + the **role×node matrix from PERMISSION_NODES.md** + the 9-agent roster **fail-closed** + Internal-Org singleton + deployment_settings).
- **Harness:** journal-tracked `pg` runner (`src/migrate.ts`+`pg-driver.ts` — idempotent, fail-loud, txn/non-txn split, DB behind a port so it's unit-tested with no DB) + the **expand-contract discipline CI gate** (`src/discipline.ts` — AC-NFR-INF.002.1). **32/32 tests · typecheck · discipline all green.**

**Scope split (Rule 0 — the gate lands the schema; specialised issues own their logic):** RLS helpers/policies/100%-coverage gate → **ISSUE-009** (its title); `config_values` defaults seed → **ISSUE-010** ([OD-178]); agent `memory_scope` real shape → **ISSUE-063** (seeded fail-closed `'{}'` now — [OD-177]). None of ISSUE-008's DoD ACs touch these, so the deferrals don't weaken the gate.

**Verification (standing gate):** independent zero-context agent diffed all four migrations vs the five spec sources — **no BLOCKER defects** (tables/enums/index-bodies byte-identical; role→node matrix zero over-grants / zero under-grants — security-critical clean). One MINOR (belt-and-braces `revoke delete`) was **applied**.

**Source fix (Rule 0):** caught + reconciled a `schema.md` inconsistency — §Immutability L69 mandated a `redacted_at` column on `event_log`/`access_audit`/`config_audit_log` (the trigger keys off it) but the three DDLs omitted it. Added to the migration **and** patched in `schema.md`.

**Files changed (sync ritual — every tracker moved in lockstep for a `done` issue):** new `app/silo/**` (package + migrations/0001a-d + src runner/discipline/pg-driver/tests + README + `results/{live-capstone-evidence.2026-07-04.md, af-065-mixed-fleet-spike.sql}`); `open-decisions.md` (**OD-176/177/178** + guard → OD-179); `migrations.md` (OD-176 toolchain note); `schema.md` (redacted_at ×3 consistency fix); `feasibility-register.md` (**AF-065 🔴→🟢**); **ISSUE-008 `status: ready → in-progress → done`** + §10 build result; **`BUILD-SCHEDULE.md` `008` box ✅** (Checkpoint-1 box stays OPEN); `_backlog.md` Tier-1 roll-up; `README.md` build row. **GitHub #8 closed.** Two commits (offline build `328c6da`; live capstone next). **Correctly NOT touched (R1/R4):** Checkpoint-1 box OPEN; 008's dependents (009/010/011/012/022/032/042/081/084) stay `blocked` — Stage 2 opens only when Checkpoint 1 is green.

**Next action (START HERE — Stage 1 is NOT closed yet):** 008 (the Stage-1 GATE) is `done`, but **Checkpoint 1 needs the rest of the Stage-1 batch.** Build the two remaining Stage-1 issues (both already `ready`, parallel-safe, neither blocked-by 008):
1. **ISSUE-017** (`spec/06-issues/ISSUE-017-webhook-auth.md`) — per-vendor webhook auth (rejects forged/replayed webhooks). Blocker 006 done; carries the OD-172 per-connector live-vendor confirmation residual.
2. **ISSUE-080** (`spec/06-issues/ISSUE-080-release-model.md`) — release/canary model (deploys through the canary gate). Blocker 007 done.
3. Then run the **Checkpoint-1 integration test** (008 migrations apply+roll back cleanly on the silo ✅ already; 017 rejects forged/replayed; 080 deploys through canary) → tick the Checkpoint-1 box → **Stage 2 opens (009 RLS scaffold gate + 010/011/042/081)**.
**Infra access unchanged:** `source ~/.ai-harness-secrets.env` (now also holds `SILO_DB_URL`); silo migrate = `cd app/silo && DATABASE_URL="$SILO_DB_URL" npm run migrate`. **Carried residuals:** operator reset the silo DB password · AF-142/143 · ISSUE-009 RLS policies on the silo · AF-069 Path A PITR · login-OAuth per-deployment (OD-175) · RLS policies→009 / config defaults→010 / agent memory_scope→063 (OD-177/178).

**Handoff verified (session 62, pre-new-chat):** ran the zero-context **repo self-sufficiency test** → **YES, resume-ready**: zero tracker drift (008 `done` agrees across frontmatter / BUILD-SCHEDULE box / _backlog / README / GitHub #8-closed / SESSION-LOG), every referenced OD/AF/FR resolves, `app/silo` `npm run check` green, the environment gate + preflight work, and Checkpoint-1's closing condition is unambiguous. Patched the one gap it found: **ISSUE-080 §8 now cites OD-173** (Railway has no native promote → Git fast-forward `release`→`main`; + the **Wait-for-CI #3 hazard** — it waits on ALL check suites, so a stale check can silently SKIP a deploy; a live spike of that scope is owed before FR-10.DEP.002 is proven). **A new chat can resume from the repo alone.** New-session first step is automatic: the SessionStart hook / CLAUDE.md Step 0 runs `scripts/build-preflight.sh` and reports the build environment (💻 Mac = live OK · 🌩️ cloud/phone = offline-safe only). **Next work: ISSUE-017 (📱 phone-safe) + ISSUE-080 (💻 Mac to close), then Checkpoint 1.**

---

## Session 61 — 2026-07-04 — ✅ **ISSUE-007 `done` → CHECKPOINT 0 CLOSED.** Built + ran the **canary live seed** (`SupabaseSeed`, real OpenAI embeddings) and codified **`RailwayInfra`** — the two ISSUE-007 §10 follow-ups. Login-OAuth re-gated (OD-175). Stage 1 (`008`) now open (R1).

**What happened:** Finished the ISSUE-007 §10 remainder against the live infra stood up in session 60, closing the last Stage-0 gate. Two-party (operator-present). **ISSUE-007 → `done`; Checkpoint 0 → CLOSED.**

**Decisions made (operator-present):**
- **Seed target** (silo was empty — no `entities`/`messages`/`memories`): created a **minimal, throwaway canary target schema** on the silo via the Supabase Management API — `app/canary/migrations/0001_canary_target.sql` (`entities`/`messages`/`memories` + `vector`, text-typed, **no RLS**). Explicitly the `0001_client_registry.sql` precedent: a minimal precondition, **superseded by ISSUE-008's real baseline** (added a reset heads-up to ISSUE-008). No-RLS is a tracked ISSUE-009 residual (acceptable — synthetic data only).
- **Embeddings (long-term design, operator asked):** the seed reads `OPENAI_API_KEY` from the **deployment env**, never the operator's laptop. Executed via `railway run` (transient injection); the same `seed-live.ts` is the eventual in-deployment first-boot seed hook.
- **007 scope:** login-OAuth (FR-10.PRV.002 / AC-10.PRV.002.*) **re-gated from the ISSUE-007 gate to per-deployment onboarding → [OD-175](00-foundations/open-decisions.md) (🟢)** — the [[OD-172]] pattern (verified at ISSUE-013 / the FR-10.PRV.004 runbook, not at a gate with a placeholder canary). C0/C1 first-boot seed confirmed already §2-Out.

**Built + proven live:**
- **`SupabaseSeed`** (`app/canary/src/supabase-seed.ts`) + **`seed-live.ts`** — real OpenAI `text-embedding-3-small` embeddings + PostgREST upserts (ON CONFLICT DO NOTHING). **Live result:** 5 entities · 4 messages · 6 memories in the silo, **0 null embeddings, all 1536-dim**; fresh run **failed LOUD on a bad key** (typed `CanarySeedError`, no half-seed — #3), resumed, then a re-run **fully converged** (0 inserted / 15 skipped). Evidence: `app/canary/results/live-seed-evidence.2026-07-04.md`.
- **`RailwayInfra`** (`app/provisioning/src/infra.ts`, replaced `TODO(AF-004)`) — Railway GraphQL `/graphql/v2` (`variableUpsert`/`variables`/`serviceInstanceDeploy`/`deployments`, `skipDeploys:true`; `linkRailway` fails loud on the AF-141 manual gate) + `client_registry` via the Supabase Management API. CLI `--execute` wired (needs an AF-142 Workspace token). Typecheck + 4/4 tests green; **mgmt-DB half validated live** against the canary row.

**Operator-assist (unblock):** the seed first 401'd — the `OPENAI_API_KEY` on Railway was malformed (`k-proj-…`, missing the leading `s`). Reconstructed as `sk-proj-…`, **validated live against OpenAI (`/v1/models` → 200)**, and wrote it back to Railway via `railway variable set --stdin --skip-deploys` (value computed from the injected env, **never printed / never on disk / never in chat** — secrets hygiene held). Now `sk-proj-…`, 164 chars, 200 at source.

**Files changed (sync ritual — every tracker moved in lockstep):** new `app/canary/{migrations/0001_canary_target.sql, src/supabase-seed.ts, src/seed-live.ts, results/live-seed-evidence.2026-07-04.md}` + `package.json`+`port.ts`+README; `app/provisioning/src/infra.ts` (RailwayInfra) + `index.ts` (`--execute`); **ISSUE-007 `status: in-progress → done`** + §10 rewrite + §4 OD-175 note; **`open-decisions.md` OD-175** (+ guard → OD-176); `feasibility-register.md` (AF-004 follow-through, **AF-141 🟢 confirmed**, AF-142 🟡 residual, AF-143 🟡 partial); **`BUILD-SCHEDULE.md` `007` box ✅ + CHECKPOINT 0 ✅ CLOSED**; **ISSUE-008 `blocked → ready`** (+ canary-reset heads-up); `_backlog.md` Tier-0/Tier-1 roll-up; `traceability-matrix.csv` PRV rows (OD-175 + evidence); `README.md` build row. **GitHub #7 closed.** Live silo now holds the canary corpus (15 rows).

**Next action (START HERE — Stage 1 is open):** **ISSUE-008 (Migration harness (expand-contract) + 0001 baseline)** is now `ready` — the Stage-1 GATE. ⚠️ Before applying its real 0001 baseline to the canary silo `Transpera-AIOS-V1` (`nwufvzaamomajdyzemhx`), **reset the throwaway `0001_canary_target.sql` schema** (drop `entities`/`messages`/`memories`) — the baseline OWNS those tables (heads-up is in ISSUE-008 §7). Infra access unchanged: `source ~/.ai-harness-secrets.env`; `supabase`/`railway` CLIs authenticated machine-level; psql = `/opt/homebrew/opt/libpq/bin/psql`; Management API `POST /v1/projects/{ref}/database/query` + PAT runs DDL on either project. **Checkpoint-1 residual for 008:** AF-065 (expand-contract migration premise) is a Postgres SPIKE owed at this stage. Tracked residuals carried forward: AF-066 · AF-142/143 (Workspace-token scripted-provisioning re-run) · ISSUE-009 RLS on the silo · AF-069 Path A PITR restore · login-OAuth per-deployment (OD-175).

---

## Session 60 — 2026-07-04 — 🟢 **AF-004 PASS** (two-party live run): operator Railway → client-owned Supabase, end-to-end. ISSUE-007 stays `in-progress` (canary live seed + `RailwayInfra` codification owed). Checkpoint 0 still OPEN.

**What happened:** With the operator present, stood up **real infra** and ran the load-bearing **AF-004** provisioning spike end-to-end — the one red gate blocking Checkpoint 0. **PASS.** Evidence: `app/provisioning/results/af-004-evidence.2026-07-04.md`; AF-004 flipped 🔴→🟢 in the feasibility register.

**Infra stood up (real, this session):**
- **Supabase CLI** authenticated (operator PAT, session-only). **Management-plane project `ai-harness-mgmt`** (ref `fsvbtasizctwnypksile`, Sydney) created; **`app/management/migrations/0001_client_registry.sql` applied** (table + `client_status` enum verified against schema §13). **Client silo** = the operator's existing **`Transpera-AIOS-V1`** (ref `nwufvzaamomajdyzemhx`, `ap-southeast-2`).
- **Railway CLI** installed (5.23.3) + `libpq`/psql 18.4. Authenticated via **browser-pairing login** (no god-mode token pasted). Operator had already created project **`adaptable-miracle`** and **linked the `AI-Harness-V1.0` repo — confirming the AF-141 GitHub-App install is a manual, no-API dashboard step** (done, provisioning then proceeded).

**AF-004 proven (each a sub-claim) — evidence file has the detail:**
- **GitHub-native deploy from a subdirectory:** Root Directory set to **`/app/service`** via `serviceInstanceUpdate`; pushed `324ae79` to `main` (operator-approved) → Railway auto-built **only `app/service`** → deploy **`SUCCESS`**.
- **Env/secret injection:** all 7 `REQUIRED_SECRETS` present (Anthropic/OpenAI set by the operator in the Railway UI — never transited the chat; the other 5 set via `variableCollectionUpsert skipDeploys:true`).
- **`internal_token` dual-stored** (Railway env + mgmt `client_registry.internal_token`); **`client_registry` row** written (`client_slug=canary`, `status=initialising`, `railway_url` set).
- **Boot + reachability gate:** `GET https://ai-harness-v10-production.up.railway.app/health → 200 {"ok":true,"missingSecrets":[],"supabaseReachable":true}` — the deployed Railway service **reached the client-owned Supabase silo**; Railway's healthcheck gated the deploy live only on that 200.
- **Railway GraphQL mutations validated live (AF-143 partial):** `serviceInstanceUpdate`, `variableCollectionUpsert`/`variableUpsert`, `serviceDomainCreate`, `deployments` query — all as the dossier predicted.

**Honest remainder — why ISSUE-007 is NOT `done` and Checkpoint 0 stays OPEN (R1):**
1. **Canary live seed** — build `SupabaseSeed` (the `app/canary` live adapter) + seed the corpus into the silo (FR-10.PRV.003 live half). Corpus + idempotent seed already built/tested (6/6); only the live adapter + run remain.
2. **`RailwayInfra` codification** — fold this session's direct GraphQL/CLI calls into `app/provisioning/src/infra.ts` (replace `TODO(AF-004)`) so provisioning is the scripted idempotent flow FR-10.PRV.001 requires, not hand-run steps.
3. **Login-OAuth** — `LOGIN_OAUTH_*` are placeholders (real per-deployment registration is FR-10.PRV.002 / per-onboarding).
4. The real **C0/C1 first-boot seed** (`initialising→active`) is a separate issue's code — AF-004 proved the plumbing that *triggers* it (ISSUE-007 §2 scope), not the seed.

**Secrets hygiene:** all keys/tokens/passwords (Supabase PAT, service-role keys, mgmt DB password, Railway session token, `internal_token`) held **session-only** in the scratchpad (`chmod 600`), **never committed**; the evidence file redacts them. Operator can revoke the Supabase PAT + Railway CLI session anytime.

**Files changed (sync ritual):** new `app/provisioning/results/af-004-evidence.2026-07-04.md`; `feasibility-register.md` **AF-004 🔴→🟢** (with the honest caveat); `ISSUE-007` new §10 live-result + remainder (status stays `in-progress`); `README.md` build row; this entry. **NOT touched (correct):** ISSUE-007 status stays `in-progress`; `BUILD-SCHEDULE.md` `007` box unticked; Checkpoint-0 box OPEN (R1); GitHub #7 open.

**Next action (START HERE):** finish ISSUE-007 → close Checkpoint 0. (1) Build `SupabaseSeed` (the `app/canary` live adapter — OpenAI `text-embedding-3-small` + upsert into the silo with `ON CONFLICT DO NOTHING` on the natural keys) + run the canary live seed into the silo (`SILO_REF=nwufvzaamomajdyzemhx`); (2) codify `RailwayInfra` (`app/provisioning/src/infra.ts`, replace `TODO(AF-004)`) from the calls proven this session — the exact GraphQL mutations + IDs are in `app/provisioning/results/af-004-evidence.2026-07-04.md`; (3) then decide whether login-OAuth + the C0/C1 seed integration are in-scope for `007 done` or split to their issues; (4) on `done`: flip ISSUE-007 → `done`, tick its `BUILD-SCHEDULE.md` box, update `_backlog.md`, close GitHub #7 — **only then Checkpoint 0 closes and Stage 1 (`008`) opens (R1)**.

**Infra access for the next chat (this machine only — the durable pointers):**
- **`supabase` CLI + `railway` CLI are authenticated machine-level** (persist across sessions — verified `supabase projects list` + `railway whoami` work with no env). Railway project `adaptable-miracle` is linked in the repo dir.
- **All secrets (Supabase PAT, both service-role keys, mgmt DB password + URL, `internal_token`, Railway IDs) persist in `~/.ai-harness-secrets.env`** (`chmod 600`, OUTSIDE the repo — never committed). **The next chat should `source ~/.ai-harness-secrets.env`** to get every ref/ID/credential. `psql` = `/opt/homebrew/opt/libpq/bin/psql` (keg-only libpq). Non-secret infra topology (project refs, service/env IDs, URLs) is also recorded in the AF-004 evidence file. *(Operator may `rm ~/.ai-harness-secrets.env` + revoke the Supabase PAT / Railway session anytime to tear down access.)*
- Live endpoints: silo `https://nwufvzaamomajdyzemhx.supabase.co` · mgmt `https://fsvbtasizctwnypksile.supabase.co` · service `https://ai-harness-v10-production.up.railway.app/health` (200).

---

## Session 59 — 2026-07-04 — ISSUE-007 (`in-progress`): built EVERY infra-independent piece — canary fixture (FR-10.PRV.003, 6/6) + management `client_registry` DDL + deployable boot stub (5/5) + the **Railway research dossier** (12 dims, 8-agent fan-out) with registers filed (AF-141–143, OD-173/174). Only the two-party **AF-004 live run** remains. Checkpoint 0 stays OPEN.

**Context:** operator chose "do both" — build the no-infra remainder AND set up infra (operator **has Supabase Pro**; **Railway not yet set up**; has Anthropic + OpenAI keys). Since the live AF-004 run needs Railway, this session pushed every no-infra prerequisite to done so the eventual two-party session is a true "run it," not a build-from-scratch.

**Built this session (all under `app/`, all green — 15/15 across three packages):**
- **`app/canary/` — FR-10.PRV.003 canary fixture (6/6).** The fixed synthetic-client corpus (5 entities incl. the internal_org singleton, 4 messages/emails, 6 memories) + a **`KNOWN_ANSWERS` contract** naming the exact rows for the future smoke battery's retrieval / contradiction-pair / routing checks (assertions owned by C2/C5/C8 — out of scope here, ISSUE-007 §2). Deterministic (fixed UUIDs, pure FNV idempotency keys, no Date/random). Mirrors the proven port+fake pattern: `CanarySeedStore` + `InMemorySeedStore` (deterministic 1536-dim stub embeddings) + `seedCanary()` (idempotent — re-seed converges, re-applies nothing; fail-loud typed `CanarySeedError`). Live `SupabaseSeed` (OpenAI embeddings + real DB) is `TODO(AF-004)`. Shares Northwind/Dana dimensions with the AF-001/002 spike corpus.
- **`app/management/migrations/0001_client_registry.sql` (#3).** The management-plane `client_registry` table + `client_status` enum, copied verbatim from `schema.md` §13 — the minimal precondition ISSUE-007 §8 authorizes so the provisioning `INSERT` has a target. ISSUE-012 still owns the lifecycle (it's `blocked`); this creates only the table. secret_manifest is per-silo, intentionally not here.
- **`app/service/` — the deployable boot target (#5, 5/5).** Minimal, correct boot skeleton for the AF-004 Railway deploy (product surface lands per its own issues). Binds Railway's `PORT`; **`/health` is the zero-downtime gate** — 200 only when all required secrets present AND the client Supabase is reachable, else **503 with the exact missing keys** (a required-missing secret fails the deploy loudly — never a silent half-silo, #3). Runtime smoke confirmed (empty env → 503 listing all 7 secrets). Required-secret manifest **vendored** (Railway's isolated-monorepo Root Directory `/app/service` scopes the build context — a runtime cross-package import would break the deploy); `health.test.ts` imports provisioning's canonical `REQUIRED_SECRETS` and asserts no drift. `railway.json` sets `healthcheckPath`/RAILPACK/watchPatterns.

**Railway research dossier (the research-first gate — was overdue; ADR-005 leaned on Railway for AF-004/020/064/065 with no dossier):** `spec/00-foundations/tool-integrations/railway.md` (🟡, Re-verify 2026-10-04). 4 top-level agents fanned into **8 primary-source, date-stamped reports** covering all 12 dimensions. **Load-bearing finding → AF-141: the Railway GitHub App install + repo authorization is a MANUAL, dashboard/OAuth-only gate — no API/CLI path.** ISSUE-007/FR-10.PRV.001/AF-004 describe *scripted* provisioning, but the repo-link step it depends on can't be fully automated; `RailwayInfra` must pre-flight-verify + fail loud (→ OD-174, now in the runbook as a one-time operator-org step). Other filings: **AF-142** (provisioning needs a Workspace/Account token — project tokens can't create → god-mode blast radius); **AF-143** (validate GraphQL mutation names vs live GraphiQL); **AF-064 🔴→🟡** (canary/promote ACHIEVABLE via branch-per-env + Wait-for-CI + Git-merge — **no native promote → OD-173**; build-history rollback = `deploymentRollback`, retention-bounded Hobby 72h). Cost: ~$5–10/always-on service/mo, pooled, no per-service floor, **post-paid card required**. Env-write discipline captured (`skipDeploys:true`, never `replace:true`). **AF-065 explicitly NOT resolved** (it's the expand-contract *migration* premise, a Postgres SPIKE — distinct from Railway's rollback; noted to prevent silent drift).

**Files changed (sync ritual):** new `app/canary/*`, `app/management/*`, `app/service/*`; new `tool-integrations/railway.md` + index row + reconciled the "platform deps live in the register" note; `feasibility-register.md` (AF-064 🟡 + AF-065 clarifying note + new AF-141/142/143 + guard AF-140→AF-144); `open-decisions.md` (OD-173/174 + guard OD-173→OD-175); `glossary.md` (+4 Railway terms); `ISSUE-007` §4 (Railway dossier callout — the 3 build-shaping findings); `app/runbooks/client-onboarding.md` (new §4b GitHub App operator prerequisite + **fixed a `build/`→`app/` path drift** from the ADR-011 move); `README.md` build row. **NOT touched (correct):** ISSUE-007 status stays `in-progress`; BUILD-SCHEDULE `007` box unticked; Checkpoint-0 OPEN (R1); GitHub #7 open.

**Next action (START HERE — the AF-004 two-party live run; everything else is DONE):** the only thing left on ISSUE-007 is the live run, which needs the operator's Railway (Supabase Pro is ready).
1. **Operator infra:** create a client-owned Supabase project (region `ap-southeast-2`); set up a Railway account (post-paid card), **install the Railway GitHub App on the operator org for `Sweeite/AI-Harness-V1.0`** (AF-141/OD-174 — the manual gate), mint a **Workspace** API token (AF-142). Railway service **Root Directory = `/app/service`**, config path `/app/service/railway.json`.
2. **Apply** `app/management/migrations/0001_client_registry.sql` to the management-plane Supabase (the INSERT target — ISSUE-007 §8).
3. **Build `RailwayInfra`** (the live `Infra` adapter — `app/provisioning/src/infra.ts` has the typed slot + `TODO(AF-004)`) against the GraphQL API `backboard.railway.com/graphql/v2`, **validating each mutation name against `railway.com/graphiql` first** (AF-143): `projectCreate`→`serviceCreate`→`serviceConnect`→`serviceInstanceUpdate{rootDirectory:/app/service}`→`variableCollectionUpsert{skipDeploys:true}`→deploy→poll `deployments.status`→`serviceDomainCreate`. Wire the CLI `--execute` path. **Build `SupabaseSeed`** (`app/canary` live adapter) alongside it.
4. **Run AF-004:** operator Railway app deploying `app/service` against the client-owned Supabase; env + secrets + `internal_token` dual-store + `client_registry` row + `/health` green.
5. On green: flip **AF-004 🔴→🟢** + confirm **AF-141/142/143 + AF-064** at the SPIKE; ISSUE-007 → `done`; tick its BUILD-SCHEDULE box; record the commit in ISSUE-007; close GitHub #7. **Only then does Checkpoint 0 close and Stage 1 (`008`) open (R1).**

**Committed `1f08dc6` on `main`** (not pushed) — this session's work, 15/15 tests green.

---

## Session 58 — 2026-07-04 — ISSUE-007 STARTED (`in-progress`): codebase-home resolved → **ADR-011 (ONE repo — product code in `app/`)**; built the operator-independent slices — client onboarding runbook (FR-10.PRV.004/.002) + provisioning-script scaffold (FR-10.PRV.001) with idempotency + fail-loud PROVEN (4/4 build-time tests). Live AF-004 run + canary fixture still owed (two-party). Checkpoint 0 stays OPEN.

**What happened:** Opened **ISSUE-007** (the last Stage-0 gate, root of the 11-node critical path). First resolved the build-phase decision it parks — *where the durable product codebase lives* — then built every part of the issue that needs **no live infra**, proving the launch-gating idempotency + fail-loud posture now. The two-party pieces (live AF-004 run + the canary fixture) are cleanly teed up for when the operator's Supabase/Railway access is ready. **This session set up a clean handoff so the next chat can start building immediately.**

**Codebase-home decision (settled after a same-session reversal):** first recorded **ADR-010** (a dedicated build repo, `Sweeite/ai-harness-core`) and created + pushed it. The operator then flagged that a *second* repo splits the project's context (all 86 issues + the spec live here) and doubles the sync burden across devices — a standing drift risk for a solo builder. **Reversed to ONE repo → [ADR-011](00-foundations/adr/ADR-011-single-repo.md) (Accepted, supersedes ADR-010, now ⚪ Superseded).** Product code lives in **`app/`** in THIS repo: `app/runbooks/client-onboarding.md` + `app/provisioning/` (4/4 tests green here). One source of truth — spec + issues + code together. The `ai-harness-core` GitHub repo + local clone were **deleted**. Railway will later deploy from the `app/` subdirectory (ADR-005 fan-out unchanged).

**Decision recorded (Rule 0) — [ADR-010](00-foundations/adr/ADR-010-codebase-home.md), Accepted:** the product codebase lives in a **new dedicated build repo, separate from this spec repo**. Reasoning: ADR-005 already fixes it as **one shared repo** Railway deploys per-client (not "monorepo vs many"); the only open axis was *which* repo. This spec repo's whole identity is Rule 0 (requirements source of truth) and it should **not** be a Railway deploy source (a repo that's ~90% markdown). The spine crosses repos by **ID** (`FR→ISSUE#→PR#→TEST`), so separation costs nothing in traceability. Binding cross-repo rule added: every build-repo PR cites its ISSUE-/FR-/AC-IDs; the issue records the PR URL at ship. ADR index + ISSUE-007 callout updated to point at ADR-010 (resolved).

**Built this session (operator-independent — staged under `build/` per ADR-010, moves to the build repo at creation):**
- **`build/runbooks/client-onboarding.md` — FR-10.PRV.004 + FR-10.PRV.002.** The consent-gated client-side runbook: client creates + owns Supabase (`ap-southeast-2`) + Anthropic/OpenAI + in-scope connectors (card on each), grants operator delegated access; per-client OAuth-app registration (redirect URIs → deployment domain, **no shared operator app**); Google production verification started early (AF-013 lead-time); client-owns-compute recorded as a per-client exception. Fail-loud: missing delegated access blocks provisioning. AC-map: AC-10.PRV.004.1/.2 + AC-10.PRV.002.1/.2.
- **`build/provisioning/` — FR-10.PRV.001 scaffold (TypeScript/Node, ADR-009).** Orchestration (`src/provision.ts`) split from a live **`Infra` port** (`src/infra.ts`) so correctness is testable with **zero live infra**. Steps in ADR-005 §5 order — Railway link → `DEPLOYMENT_CONFIG` → mint+dual-store `internal_token` → `client_registry` insert → first deploy (seed) → `initialising` — each **idempotent** (checks state, skips if done) and **loud on partial failure** (typed `ProvisioningError`, never a silent half-silo). Registration is operator-side only (no self-registration — AC-10.PRV.001.2). **4/4 build-time smoke tests green** (`src/provision.test.ts`, `node --test`): happy path dual-stores the token; **re-run converges (nothing re-applied, token not re-minted) — AC-NFR-INF.006.1**; **missing secret fails loud with NO registry row / NO deploy — AC-10.PRV.001.3 / AC-NFR-INF.006.2**; partial failure (deploy dies once) resumes on re-run. `npm run typecheck` clean. Dry-run CLI prints the plan + the exact secret set; the live `--execute` path is guarded behind `TODO(AF-004)` until `RailwayInfra` is built in the two-party session.

**Still owed on ISSUE-007 (both need the two-party session — status stays `in-progress`):**
1. **Live AF-004 run** (🔴) — the load-bearing end-to-end proof: an operator Railway app deploying from the build repo against a **client-owned** Supabase, env + secrets + `internal_token` dual-store + `client_registry` row + first-boot seed all green. Needs the operator's Supabase/Railway access **and** at least ISSUE-012's `client_registry` DDL to write into (integration-coupled — see ISSUE-007 §8). Implementing `RailwayInfra` (the live `Infra` adapter) is the code side of this.
2. **Canary fixture (FR-10.PRV.003, "Should")** — the seeded synthetic-client corpus the canary boots; reuse `spikes/issue-001-cost-viability/src/corpus.ts` (shared with the AF-001/002 spike corpus). AF-066 (representativeness) is a fast-follow, not a correctness gate.

**Files changed (this repo, sync ritual):** new **ADR-011** (single repo) + **ADR-010** marked ⚪ Superseded + ADR index updated; **ISSUE-007** frontmatter `ready→in-progress` + ADR-011 resolution callout; `README.md` build row; new **`app/`** tree — `app/README.md`, `app/runbooks/client-onboarding.md`, `app/provisioning/{package.json,tsconfig.json,README.md,src/{types,infra,provision,index,provision.test}.ts}` (the code, moved back in from the retired repo; `node_modules` gitignored). The interim `ai-harness-core` GitHub repo + local clone were deleted. **NOT touched:** `BUILD-SCHEDULE.md` `007` box (stays unticked — issue not `done`), Checkpoint-0 box (stays OPEN — R1), GitHub #7 (stays open — not done). No new OD.

**Next action (START HERE next chat):** ISSUE-007 has two remaining pieces, both **two-party** (need the operator's Supabase/Railway access). Everything is in THIS one repo — read the requirements (this file + `spec/06-issues/ISSUE-007-provisioning-bootstrap.md` + `spec/06-issues/BUILD-SCHEDULE.md`), the code is in `app/`. Steps:
1. **Operator prep (from `app/runbooks/client-onboarding.md`):** stand up a client-owned Supabase (region `ap-southeast-2`) + Anthropic/OpenAI + in-scope connector accounts; grant delegated access; a Railway account linked to this repo (`Sweeite/AI-Harness-V1.0`), service root = `app/`.
2. **Integration precondition:** ISSUE-012's `client_registry` table DDL must exist for the provisioning `INSERT` to land (see ISSUE-007 §8 integration note) — sequence at least that DDL first.
3. **Build `RailwayInfra`** (the live `Infra` adapter — `app/provisioning/src/infra.ts` has the typed slot + `TODO(AF-004)`), wire the CLI `--execute` path, and **run the AF-004 end-to-end spike**: operator Railway app deploying `app/` against the client-owned Supabase; env + secrets + `internal_token` dual-store + `client_registry` row + first-boot seed all green.
4. **Build the canary fixture** (FR-10.PRV.003) — synthetic-client corpus; reuse `spikes/issue-001-cost-viability/src/corpus.ts` dimensions.
5. On green: flip **AF-004 🔴→🟢** (feasibility-register), ISSUE-007 → `done`, tick its `BUILD-SCHEDULE.md` box, record the implementing commit in `ISSUE-007`, close GitHub #7. **Only then does Checkpoint 0 close and Stage 1 (`008`) open (R1).** The orchestration is already built + tested — the two-party session wires real infra into a finished script, it does not build from scratch.

---

## Session 57 — 2026-07-04 — ISSUE-006 mechanics DONE: AF-078 🟡 MECHANICS PASS + AF-090 DOCS-resolved; live GHL confirmation deferred (OD-172, operator has no GHL account) — all six Stage-0 spikes cleared for Checkpoint-0; only 007 remains

**What happened:** Closed out **ISSUE-006 (webhook forgery/replay, AF-078)** to the extent possible without a GHL account.
Ran the harness's self-contained **MODE M** battery (**17/17** pass); researched GHL's signing scheme from **primary docs**
to resolve **AF-090**; and, with the operator, made a scope decision (**OD-172**) to **re-gate the live per-connector
webhook confirmation from launch-blocking to per-connector onboarding**. With this, **all six Stage-0 spikes are cleared
for Checkpoint-0 (001–005 GREEN + 006 mechanics/OD-172); the only remaining Stage-0 gate is ISSUE-007 (provision a real
silo).**

**Why the deferral (operator-decided, Option A):** the operator **has no GHL account**, and connectors are **client-
driven** (none provisioned at launch), so a **real GHL-signed webhook cannot be produced** — the one thing MODE R needs.
Rather than fake it (which the harness refuses — MODE M cannot claim GREEN), we recorded what IS proven and deferred what
can't be proven yet.

**What was proven / resolved:**
- **MODE M mechanics — 17/17:** per-connector verifiers (Slack HMAC · GHL Ed25519 · Google Pub/Sub JWT) **reject forged /
  tampered / replayed / stale** webhooks and **accept valid** ones. The load-bearing **raw-body-before-parse** trap is
  proven (a deliberate parse-then-verify variant provably fails the same signature — AC-0.WHK.005.1); constant-time compare
  (`crypto.timingSafeEqual`) and replay defense (Slack 5-min window · GHL/Google seen-ID cache) hold.
- **AF-090 DOCS-resolved (primary source, dated 2026-07-04):** from GHL's developer docs — **GHL signs the RAW BODY ONLY**
  with Ed25519 (`X-GHL-Signature`; legacy `X-WH-Signature` RSA deprecates 2026-07-01), and the **published Ed25519 public
  key** (`MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=`) was captured. Src:
  `marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide`. This closes the AF-090 *design* unknown; only the
  empirical live-payload confirmation remains.
- **Slack** is fully proven (symmetric HMAC over a shared secret — the mechanics ARE the real proof, no asymmetric vendor
  gap); **Google** OIDC mechanics (JWKS/audience/expiry) proven.

**OD-172 (change-control — narrows a launch gate):** the per-connector **live webhook-verification confirmation** is
re-gated from a launch-blocking Stage-0 requirement to a **per-connector onboarding requirement** — proven on
**ISSUE-017 / 039 / 040 / 041** before each connector goes live for a real client (blocking THERE). For Checkpoint-0 /
go-no-go, AF-078 is satisfied by the proven mechanics + AF-090 DOCS; the live checks are **tracked residuals** (#3), not
silent. Does NOT relax the mechanics (raw-body-before-parse, constant-time, replay) or NFR-SEC.008 / ADR-007.

**Files changed (sync ritual):** new **OD-172** in `open-decisions.md` (+ guard bumped to OD-173); `feasibility-register.md`
AF-090 🔴→🟡 DOCS-confirmed (key + signing input + source) and AF-078 🔴→🟡 MECHANICS PASS (+ OD-172 residual);
`test-strategy.md` §4 AF-078 gate annotated (OD-172); `ISSUE-006` frontmatter `in-progress→done` + Result note;
`BUILD-SCHEDULE.md` Stage-0 `006` box ✅ (with the 🟡/OD-172 caveat); `_backlog.md` Epic-S row (done) + Tier-0 roll-up;
`README.md` build row. **GitHub #6 closed** with the result + OD-172. **NOT touched:** Checkpoint-0 box (stays OPEN — 007
owed). No change to any locked ADR/FR beyond the OD-172 gate-scope narrowing.

**Next action:** **ISSUE-007 (Stage-0 GATE — provisioning + per-client Supabase bootstrap, still `ready`)** is the LAST
thing between here and Checkpoint 0. Its harness/runbook is **not yet built** — that's the next build task; it needs the
operator's Supabase org access to stand up a real per-client silo (two-party, R8). **Checkpoint 0 closes when 007 has
stood up a real silo** (all six spike AFs are already cleared); only then does Stage 1 (`008` migration harness) open (R1).
**Tracked residuals (not blocking Checkpoint 0, blocking their own later gates):** AF-069 Path A (in-project/PITR restore)
before go-live; AF-078/AF-090 per-connector live webhook confirmation at connector onboarding (ISSUE-017/039/040/041).

**Handoff (new chat next):** ran the **repo self-sufficiency test** (zero-context subagent, repo-only) → **CAN-ACT-WITHOUT-
GUESSING: YES** (next action = build ISSUE-007). Patched the 3 non-blocking drifts it found: `_backlog` Tier-0 roll-up
leading glyphs `🔵→✅` for 004/005/006; OD-172 header session 56→57; and **ISSUE-017/039 absorbed OD-172** (their stale
"AF-078 🔴 launch-blocking" framing corrected to "🟡 MECHANICS PASS; live per-connector confirmation re-gated to onboarding
here"). The next chat resumes cleanly on ISSUE-007.

---

## Session 56 — 2026-07-04 — ISSUE-004 run + PASS: AF-069 🟢 (restore rehearsal, Path B) — 5 of 6 Stage-0 spike AFs now GREEN

**What happened:** With the operator present, ran the **ISSUE-004** restore-rehearsal harness against **real
Supabase infra** and it **PASSED** on Path B — **AF-069 🔴→🟢**. Full sync ritual done. **5 of 6 Stage-0 spike AFs
are now GREEN (001/002/003/004/005); only 006 (webhook, AF-078) + the 007 GATE remain.**

**Setup the operator provided (R8):** the spike-5 project reused as the **source** (direct conn, PG 17.6, pgvector
0.8.2) + a **throwaway target** project (direct conn). Installed the Postgres client tools on the operator's Mac
(`brew install libpq` → pg_dump/pg_restore/psql 18.4, keg-only → prepended to PATH at run time).

**The real work — a genuine finding + harness fix (not a rubber-stamp):** the subagent-built harness used a naive
"whole-DB `pg_restore --clean` into an empty project" strategy that **DOES NOT WORK against a Supabase target** — its
`auth` schema is **managed** (217 objects owned by `supabase_auth_admin`), and the restoring `postgres` role cannot
drop/recreate it (`pg_restore: error: must be owner of table webauthn_credentials`). Diagnosed empirically (ran it,
captured the failure, inspected the dump TOC): also learned `memories.embedding` is type **`extensions.vector(1536)`**
(pgvector lives in Supabase's `extensions` schema, not dumped). **Reworked `dump.ts` + `restore.ts` to a Supabase-
correct strategy:** (1) ensure `extensions.vector` exists on the target; (2) restore the **`public`** schema
(memories + embeddings) cleanly (postgres owns public); (3) load only the **`auth.users` ROWS** data-only into the
target's existing managed auth.users (cleared first for idempotent re-runs) — never restoring the managed auth schema
structurally. Also moved the target env-read to AFTER the restore (so the evidence reports the target's pgvector
version accurately, not the pre-restore "not installed").

**Result (all 5 assertions green — evidence `spikes/issue-004-restore-rehearsal/results/af-069-evidence.2026-07-04.md`):**
- **5000/5000 memories restored, embeddings intact** (0 null, 0 wrong-dimension), and a **cosine `<=>` similarity
  query returns top-5** on the restored target — pgvector memory survives the backup→restore (AC-NFR-DR.003.1).
- **25/25 `auth.users` rows restored + a sampled user resolves** on the target — identity survives.
- **Measured RTO 19.4 s** (harness wall-clock; AC-NFR-DR.005.1 — a measured number, not the assumed "minutes-to-
  hours"). First manual rehearsal logged (AC-NFR-DR.003.2; the automated cadence is ISSUE-085).

**⚠️ Honesty — Path A NOT exercised (recorded, not hidden):** only **Path B** (the off-platform `pg_dump` → restore)
ran — that's the load-bearing #1 guarantee (the client-owned copy that survives project deletion/billing-lapse).
**Path A** (Supabase's in-project PITR/daily backup restored into a throwaway) was the optional operator-driven step
and was **skipped**; also note Supabase in-project backups restore **in-place**, not into a throwaway, so the harness
structurally can't drive it. The evidence + register record Path A as **not-proven**; **residual: confirm the in-
project/PITR restore on the real production tier before go-live.** AF-069 is flipped GREEN on the proven off-platform
path with this caveat explicit everywhere — not a silent full-green.

**Files changed (sync ritual — all trackers in lockstep):** `feasibility-register.md` AF-069 🔴→🟢 (Path-B PASS
summary + Path-A residual); `ISSUE-004` frontmatter `in-progress→done` + Result note; `BUILD-SCHEDULE.md` Stage-0
`004` box ✅; `_backlog.md` Epic-S row (done) + Tier-0 roll-up; `README.md` build row; reworked harness
`spikes/issue-004-restore-rehearsal/src/{dump,restore,main}.ts`; new evidence `results/af-069-evidence.2026-07-04.{md,json}`
(+ stale `PENDING.md` removed; local `*.dump` artifacts gitignored + deleted at teardown — they hold real data).
**GitHub #4 closed** with the result. **NOT touched:** Checkpoint-0 box (stays OPEN — 006 + 007 owed), AF-078 (stays 🔴).
No OD (the spike passed; Path A is a recorded residual, not a design fork).

**Next action:** one you-present spike remains — **ISSUE-006 (webhook, AF-078)**: harness built + MODE-M-validated
(17/17 forgery/replay cases; parse-before-verify proof holds), needs **MODE R** = a **live captured GHL webhook
payload** (raw body + `X-GHL-Signature` headers) + **GHL's published Ed25519 public key + source URL** to resolve
**AF-090** and assert against real vendor signatures. Plus **ISSUE-007** (Stage-0 GATE, still `ready`) must stand up a
real per-client silo — its harness/runbook is **not yet built** (next build task; it will need the operator's Supabase
org access). **Checkpoint 0 closes only when all six spike AFs are GREEN (001/002/003/004/005 ✅; 006 owed) AND 007 has
stood up a silo** — only then does Stage 1 (`008`) open (R1). Also a **residual**: Path A (in-project/PITR restore)
verification for AF-069 before go-live. Do not tick the Checkpoint-0 box early.

---

## Session 55 — 2026-07-04 — ISSUE-005 run + PASS: AF-077 🟢 (brute-force/credential-stuffing) — first you-present spike flipped GREEN on real infra

**What happened:** With the operator present, ran the **ISSUE-005** harness against a **live throwaway Supabase
Auth project** and it **PASSED** — **AF-077 🔴→🟢**, the first of the three you-present Stage-0 spikes flipped on
real infra. Full sync ritual done in one commit.

**Setup the operator provided (R8):** a throwaway Supabase Auth project (plan **pro**), a seeded external-Super-
Admin account (email+password), an enrolled TOTP factor, **Cloudflare Turnstile** CAPTCHA enabled in Attack
Protection, and leaked-password protection on. Two build-time harness bugs were fixed to get there (all committed
before the run, no status change): (1) **Node<22 WebSocket** — `@supabase/supabase-js` constructs a realtime
client that throws without a global WebSocket on Node 20 → added `src/ws-polyfill.ts` (`ws`); (2) **enroll helper**
— Supabase has no dashboard 2FA-enable-and-reveal-secret flow, so added `npm run enroll` (`src/enroll.ts`) which
clears any stale factor via the admin API then enrolls a fresh one and prints `TEST_ACCOUNT_TOTP_SECRET`; (3)
declared the `undici` dep (lazy-imported by the real-proxy path) so the whole harness typechecks. Chose **Turnstile
over hCaptcha** (verified pricing: Turnstile is unconditionally free/unlimited — a better fit for the client-pays-
opex model than hCaptcha's $139/mo Pro tier; both are Supabase-supported and harness-agnostic).

**Result (all 9 checks green — evidence `spikes/issue-005-brute-force-defense/results/af-077-evidence.2026-07-04.md`):**
- Scripted **single-account** and **simulated multi-IP** credential-stuffing **both halted before any session
  minted** — the app-layer per-account soft-lock trips at threshold **5** and holds (attempt 6 blocked before
  reaching Supabase). Proves the load-bearing AF-077 claim: the soft-lock is **IP-independent**, so it stops the
  multi-IP case that defeats Supabase's per-IP caps (Supabase has **no** native per-account lockout, [SA16]).
- **2FA challenge** soft-locks at wrong-code **6** (`mfa_softlock_threshold`=5) and **refuses even a genuinely-
  correct code once locked**; **AAL2 never reached**.
- **CAPTCHA observed LIVE** — Turnstile genuinely rejected the scripted logins (recorded as observed, not merely
  config-flagged — the honest bar we set). Leaked-password enforceable on Pro.
- Observability: **15** login attempts logged, **2** Super-Admin alerts fired (#3 — nothing silent).
- **Confirmed build values for ISSUE-014:** `account_lockout_threshold`=5 · `account_lockout_minutes`=15 ·
  `mfa_softlock_threshold`=5 · CAPTCHA+leaked on.

**Honesty caveat (in the evidence):** multi-IP was **simulated** (no proxies supplied) — the harness disabled its
per-IP counter to prove the per-account soft-lock is the real backstop when IP limits are defeated. The soft-lock
proof is IP-independent, so a real-proxy run would strengthen but not change the verdict. Also: because Turnstile
blocked every scripted attempt, the soft-lock counter tripped on CAPTCHA-rejected failures (the counter counts
failed attempts regardless of *why* they failed — identical mechanism to wrong-password failures); both layers
demonstrably engaged.

**Files changed (sync ritual — all trackers in lockstep):** `feasibility-register.md` AF-077 🔴→🟢 (rich PASS
summary + evidence pointer); `ISSUE-005` frontmatter `in-progress→done` + Result note; `BUILD-SCHEDULE.md` Stage-0
`005` box ticked ✅; `_backlog.md` Epic-S row (done) + Tier-0 roll-up; `README.md` build row; new evidence
`spikes/issue-005-brute-force-defense/results/af-077-evidence.2026-07-04.{md,json}` (+ stale `PENDING.md` removed);
plus the three harness fixes above (`ws-polyfill.ts`, `enroll.ts`, `undici`). **GitHub #5 closed** with the result.
**NOT touched:** the Checkpoint-0 box (stays OPEN — 004/006 + 007 still owed), AF-069/078 (stay 🔴). No
scope/decision change; no OD (the spike passed — a red spike would have been the design fork).

**Next action:** two you-present spikes remain — **ISSUE-004 (restore, AF-069)** and **ISSUE-006 (webhook, AF-078)**,
both harnesses built + `in-progress`, awaiting operator infra (004: source + throwaway target Supabase projects +
`pg_dump`/`pg_restore`; 006 MODE R: a live captured GHL payload + GHL's published Ed25519 public key → resolves
AF-090). Plus **ISSUE-007** (Stage-0 GATE, still `ready`) must stand up a real silo. **Checkpoint 0 closes only when
all six spike AFs are GREEN (001/002/003/005 ✅; 004/006 owed) AND 007 has stood up a silo** — only then does Stage 1
(`008`) open (R1). Do not tick the Checkpoint-0 box early.

---

## Session 54 — 2026-07-04 — ISSUE-004/005/006 harnesses BUILT (in-progress) — the three remaining Stage-0 you-present spikes; AFs stay 🔴 pending operator infra (nothing faked, nothing flipped)

**What happened:** Built the **three remaining Stage-0 launch-gating spike harnesses** — the parallel BATCH
**ISSUE-004 (restore rehearsal, AF-069)**, **ISSUE-005 (brute-force / credential-stuffing, AF-077)**,
**ISSUE-006 (webhook forgery/replay, AF-078)**. All three are runnable TS/Node harnesses (ADR-009) mirroring
the 001–003 house style exactly: `src/` mapping 1:1 to each issue's §8 build order, fields a–h dated evidence
emitters → `results/`, a README (§8 table + Run + proves/does-not + On-FAIL), `.env.example`, `.gitignore`,
`package.json`/`tsconfig.json`. Each typechecks. **None was run and none flips its AF this session** — unlike
001–003, these three are **R8 "you-present" spikes** that need the operator's REAL infra + credentials, which
we do not have at build time. Per the operator's instruction and R8/#3, the harnesses **refuse to run without
infra and fabricate no evidence** (`results/` holds only `PENDING.md`).

**The three harnesses (all in `spikes/`):**
- **`issue-004-restore-rehearsal/`** — drives a real restore of BOTH ADR-008 backup paths into a throwaway
  project and asserts pgvector memory rows (embeddings intact, cosine query works) + `auth.users` survive,
  with a MEASURED RTO (AC-NFR-DR.003.1/.005.1). Honesty caveat baked in: **path A (in-project/PITR backup)
  cannot be driven by a connection string** — Supabase restores it itself; the harness asserts against the
  operator's out-of-band-restored target. Path B (`pg_dump`→`pg_restore`) is fully harness-driven.
- **`issue-005-brute-force-defense/`** — real scripted credential-stuffing (single-account + multi-IP) against
  a live throwaway Supabase Auth project via `@supabase/supabase-js` + real TOTP (`otpauth`), asserting the
  app-layer per-account soft-lock + 2FA soft-lock + CAPTCHA + leaked-password halt the attack before a session
  mints, logged + alerted (AC-0.AUTH.009.1/.2, AC-0.AUTH.007.3, AC-NFR-SEC.009.1). Caveats: true multi-IP needs
  operator proxies (else a labelled *simulated* mode); leaked-password enforces only on Pro+.
- **`issue-006-webhook-forgery/`** — zero-dep (Node `crypto`) verifiers for Slack HMAC · GHL Ed25519 · Google
  Pub/Sub JWT, with the load-bearing **raw-body-before-parse** shim (+ a deliberately-wrong parse-then-verify
  variant proving AC-0.WHK.005.1), `timingSafeEqual`, replay cache, and the common 401 + `prompt_injection`
  reject path. **Two modes:** MODE M (self-contained mechanics — proves the crux with self-generated keys but
  **refuses to claim GREEN**) and MODE R (real — needs a **live captured GHL payload + GHL's published Ed25519
  public key** to resolve **AF-090** and assert against real vendor signatures). AF-078 flips 🟢 only on a
  MODE-R PASS.

**Why nothing was flipped (honesty / the three non-negotiables):** a green AF here must be *earned* against real
infra. Faking a backup, an auth endpoint, or a GHL signature to force a PASS would violate #1 (a false backup
guarantee) and #3 (a silent false-healthy gate). So this session marks the three issues **`ready → in-progress`**
only, and leaves every downstream tracker at the honest not-done state.

**Files changed (all trackers in lockstep at the in-progress state — no tracker left ahead):** new
`spikes/issue-004-restore-rehearsal/`, `spikes/issue-005-brute-force-defense/`, `spikes/issue-006-webhook-forgery/`
(harness code + READMEs + `.env.example` + `results/PENDING.md`); the three `ISSUE-004/005/006` frontmatter
`status: ready → in-progress` + a build-status note in each; `_backlog.md` Epic-S rows + Tier-0 roll-up (🔵
in-progress, harnesses built, AFs 🔴); `README.md` build row. **NOT touched (correctly):** `feasibility-register.md`
(AF-069/077/078 stay 🔴), `BUILD-SCHEDULE.md` boxes (unticked — not done), the Checkpoint-0 box (open), GitHub
issues #4/#5/#6 (stay OPEN — matches in-progress). No scope/decision change; no OD (no spike has failed — a red
spike would be the design fork, none has run yet).

**Next action (operator-blocked — the exact ask is in each harness README "What I need from the operator"):**
the operator provides the credentials/setup for each you-present spike, then we **run each spike present** and, on
PASS, run the **full sync ritual per spike** (flip its AF 🔴→🟢 in `feasibility-register.md` with dated a–h
evidence, tick its `BUILD-SCHEDULE.md` box, update the `_backlog` roll-up + README build row, close its GitHub
issue #4/#5/#6, append a SESSION-LOG entry) — one commit each. Operator shopping list in brief: **004** — a SOURCE
Supabase project (direct conn) + a throwaway restore target (direct conn) + `pg_dump`/`pg_restore` on PATH (+ opt.
a second throwaway for the path-A in-project-backup restore + its wall-clock; plan tier that has PITR/daily
backups); **005** — a throwaway Supabase Auth project (URL + anon + service-role) + a seeded external-Super-Admin
account + its enrolled TOTP base32 secret + plan tier (Pro+ for leaked-password) + CAPTCHA turned on (+ opt.
provider test keys, proxies); **006** — a **live captured GHL webhook payload** (raw body + headers incl.
`X-GHL-Signature`) + **GHL's published Ed25519 public key + source URL** (for MODE R / AF-090); Slack/Google real
secrets optional (self-signable in MODE M). **Checkpoint 0 closes only when all six spike AFs are GREEN *and*
`007` (Stage-0 GATE — provision a real silo, still `ready`) has stood up a silo** — 007 remains owed alongside
these three. Only then does **Stage 1 (`008` migration harness)** open (R1). Do **not** tick the Checkpoint-0 box
early.

---

## Session 53 — 2026-07-04 — ISSUE-003 built + run + PASS: AF-068 (injection containment red-team) flipped 🟢; GitHub mirror drift (#2) reconciled

**What happened:** Built the next `ready` Stage-0 spike — **ISSUE-003 (injection-containment red-team, AF-068)** — the
load-bearing claim of the whole ADR-007 posture. Unlike 001/002 (measurements against real infra), the *subjects
under test* (the seven hard limits ISSUE-055, the injection pipeline ISSUE-059, the mid-task RLS re-check ISSUE-020)
aren't built yet, so per §8.1 the spike runs against a **throwaway harness stub that faithfully reproduces the seams**
— "prove the path, not ship the product." Full harness `spikes/issue-003-injection-containment/` (TS/Node, zero runtime
deps, mirrors the 001/002 house style: `src/` 1:1 with §8 build order, dated evidence in `results/`, README, AF block).
**AF-068 PASS → 🟢.**

**Design (why the green run is trustworthy, not self-fulfilling):** threat model = a **fully-compromised, maximally-
obedient model** (assume HL7 already happened at the reasoning layer — the model emits whatever the injection asks;
security *never* rests on the model refusing, per ADR-007 part 1). The code gate `enforce()` takes **no prompt/content
parameter** — structurally unswayable by injected text. Battery = **12 attacks + 4 negative controls**:
- **12/12 attacks contained** — no consequential side effect reached execution (each of the 7 hard limits + the
  external-comms floor incl. an OD-161 "low-risk" sub-type + financial + Confidential/Restricted memory + cross-client
  + self-approval + boundary-tag break-out).
- **8 evasion payloads** carried no injection literal → not quarantined → **reached the model, which obeyed** → still
  blocked by the code gate. This is the "contained, not necessarily caught" proof (ADR-007 part 1).
- **4/4 negative controls succeed** (human-approved external send / same-client read / benign read / normal memory
  write all allowed) — proving real containment, not a brick that blocks everything.
- Boot: `injection_semantic_detection_enabled=false` (AC-NFR-SEC.006.3); quarantine retained + human-routed
  (`human_decision=null`, `guardrail_log` type `prompt_injection`); **0** hard_limit rows approved (schema L506 check).
- **Mutation-tested:** injecting a real bypass (allow autonomous external email) flips the verdict ⛔ + exits non-zero —
  the battery has teeth (proven, then reverted).

**Scope honesty (stated in the evidence + issue §10):** PASS = the containment *design* has no bypass at the executable-
seam level, **and** we now hold the retained regression battery. It does **not** prove the *shipped* enforcement code is
safe — the same battery re-runs against ISSUE-055/059/020 (and live connectors, once ISSUE-039/040/041 exist) pre-release.
Detection-signal *quality* is AF-117 (separate EVAL); per ADR-007 detection is only a signal, so a library gap degrades
the signal, it does not breach containment.

**Files changed (sync ritual — all trackers in one commit):** new `spikes/issue-003-injection-containment/` (+ evidence);
`feasibility-register.md` (AF-068 🔴→🟢); `ISSUE-003` frontmatter `ready→in-progress→done` + §10 Result; `BUILD-SCHEDULE.md`
Stage-0 003 ✅; `_backlog.md` (roster + Tier-0 roll-up); `README.md` build row; `security.md` NFR-SEC.004/006 AF-068 gate
annotations (ACs proven-vs-stub, Verify-vs-shipped). **GitHub mirror reconciled:** closed **#3** (AF-068) — *and* **#2**
(AF-067), which was still OPEN though ISSUE-002 was `done` last session (drift from Session 52 fixed; Rule 0 / #3). No
scope/decision change.

**Next action:** Stage 0 continues — **three** launch-gating spikes remain on the go/no-go set: **ISSUE-004 (restore
rehearsal, AF-069)**, **005 (brute-force, AF-077)**, **006 (webhook forgery, AF-078)**. All `ready`; none blocks another;
each flips its AF. R2/R8 still apply (a red spike is a design fork; 004 needs a real backup+restore, 005/006 need real
auth/webhook endpoints → operator credentials). **Checkpoint 0 closes only when all six Tier-0 spike AFs are GREEN *and*
`007` (Stage-0 GATE — provisioning + per-client Supabase bootstrap, still `ready`) has stood up a real silo** — 007 is
owed alongside the three remaining spikes. Only then does **Stage 1 (`008` migration harness)** open (R1).

---

## Session 52 — 2026-07-04 — ISSUE-002 built + run + PASS: AF-067 (RLS hot-path latency) flipped 🟢; AF-019 planner cliff surfaced

**What happened:** Pulled main (synced `BUILD-SCHEDULE.md` etc.), then built the next `ready` Stage-0 gate —
**ISSUE-002 (RLS hot-path latency spike)** — on the operator's **real Supabase** (PG 17.6 / pgvector 0.8.2). Full
runnable harness `spikes/issue-002-rls-latency/` (mirrors the ISSUE-001 house style: `src/` modules 1:1 with the
issue §8 build order, dated evidence in `results/`, README, AF-evidence block). **AF-067 PASS → 🟢.**

**Measured (50k memories · 20 users · 6 roles, heaviest restricted predicate):**
- **initPlan overhead 1.06 ms/statement** (< 50 ms target), initPlan **loops = [1,1,0,1] → once-per-statement confirmed**
  (not per row) — AC-NFR-PERF.001.1 PASS.
- **`auth_rls_initplan` lint (splinter 0003 replica) PASS** — every `auth.*`/helper call wrapped in `(select …)`,
  all policy columns indexed — AC-NFR-PERF.001.2 PASS.
- **Cliff proven** on a `count(*)` full scan (no vector math to mask it): bare per-row policy **2.5× slower** than
  wrapped (modest ratio — helpers hit tiny indexed tables; direction + mechanism identical to Supabase's 178,000→12).
- **Clearance-filtered vector top-k p95 = 0.9 ms** on the HNSW index (< 2 s) — AC-NFR-PERF.003.2 PASS (latency half).
- **OOS-012 (D2 JWT-cache fallback) NOT triggered.**

**⚠️ Surfaced a real AF-019 finding (NOT an AF-067 failure — logged, not hidden, per #3):** with the RLS clearance
predicate present, the **pgvector planner defaults to a full Seq Scan (~19 s)** instead of the HNSW index (**~63 ms
forced**) — a **~300× cliff**. The index composes correctly with RLS; the planner just won't pick it under the filter
without help. This is now a **measured hard requirement for ISSUE-023** (force index usage: `hnsw.iterative_scan` /
partial indexes / cost tuning) — recorded in AF-019 (register F10 + status), ISSUE-023 (new ⚠️ callout), performance.md,
backlog, BUILD-SCHEDULE, README.

**Files changed (sync ritual — all trackers in one commit):** new `spikes/issue-002-rls-latency/` (+ evidence);
`feasibility-register.md` (AF-067 🔴→🟢, AF-019 F10/status strengthened); `ISSUE-002` frontmatter `ready→done`;
`ISSUE-023` measured-blocker callout; `BUILD-SCHEDULE.md` Stage-0 002 ✅; `_backlog.md` (roster + Tier-0 roll-up);
`README.md` build row; `performance.md` NFR-PERF.001/003 (paper→confirmed, latency half). No scope/decision change.

**Next action:** Stage 0 continues — three launch-gating spikes remain on the go/no-go set: **ISSUE-003 (injection
containment, AF-068)**, **004 (restore rehearsal, AF-069)**, **005 (brute-force, AF-077)**, **006 (webhook forgery,
AF-078)**. None blocks another; each flips its AF. R2/R8 still apply (a red spike is a design fork; spikes need the
operator's credentials/keys). After all six Tier-0 spikes are GREEN, Checkpoint 0 closes and Stage 1 (`008` migration
harness) opens.

---

## Session 51 — 2026-07-03 — CLAUDE.md wired to the build schedule + a build-status sync contract

**What happened:** Operator asked that `CLAUDE.md` check the schedule before a build session starts and keep
build status/progress in sync. Added three things to the operating protocol (no new IDs; process doc, not a
locked decision):
- **Start-of-session reading order — new item 8:** if the build has begun, read `BUILD-SCHEDULE.md` first
  (active stage · next `ready` issue · safety contract R1–R9), then only that issue + its Context manifest.
- **New "Build-phase protocol" section:** codifies (1) read-schedule-and-reconcile-before-building, (2) the
  safety contract with R1 (no stage opens until the prior checkpoint is GREEN) and R2 (a red spike is a design
  fork → OD), and (3) the **build-status source of truth** — ground truth = each `ISSUE-<nnn>.md` `status:`
  frontmatter; derived = `BUILD-SCHEDULE.md` boxes + `_backlog.md` roll-up; GitHub = outward mirror; SESSION-LOG
  = narrative. Plus the **sync ritual**: when an issue changes state, update every tracker in the same commit;
  never leave one ahead of another (silent drift = #3 violation).
- **End-of-session step 1** now also requires reconciling build status across all trackers in the build phase.

**Files changed:** `CLAUDE.md` (3 edits). No scope/decision change.

**Next action:** unchanged — Stage 0, `ISSUE-002` (RLS-latency spike) is the next `ready` gate on the memory
critical path.

---

## Session 50 — 2026-07-03 — Build-order made followable: `BUILD-SCHEDULE.md` (11 dependency waves + checkpoints + safety contract)

**What happened:** Operator asked whether the build could be *batched* (build a group, then test) rather
than strictly one-issue-at-a-time, and for a followable schedule that "won't mess up if I follow it."
Confirmed the build order was already documented (`_backlog.md` tiers + 11-node critical path + DAG; each
issue's §7 edges) — the batching concept too ("issues within a tier can be built in parallel"). Added a
**derived** operational schedule; no new IDs, no decisions (Rule 0 — it re-expresses existing order).

**Created `spec/06-issues/BUILD-SCHEDULE.md`:** recomputed the DAG into **11 strict dependency waves**
(finer than the 7 tiers — the tiers hide internal chains, e.g. `018→019→022` all in Tier 3). Each stage =
a batch (provably parallel-safe: same-wave issues have no path between them) + its **gate** (the spine
issue) + a **checkpoint** (integration test). Fronted by a **safety contract** (R1–R9) whose core
guarantee: building stages in order means every dependency was built *and passed its checkpoint* first, so
you never build on unverified ground (#3). Spine = `007→008→009→018→019→022→023→025→045→053→072`;
`053` flagged as the keystone (fan-in 7). High-care issues tied to the three non-negotiables marked 🔴.

**Also:** pointer added at the top of `_backlog.md` "Build-order tiers" → the new schedule. A visual
build-timeline artifact was produced this session (spine + fans + checkpoints, "highlight spine only" toggle).

**Rule-0 note:** if `BUILD-SCHEDULE.md` and any per-issue §7 disagree, the issue file wins; regenerate the
schedule if the DAG changes. Acceptance-criteria text is never copied into it (read in the FR).

**Next action:** unchanged from Session 49 — continue Tier-0 spikes (recommend `ISSUE-002` RLS-latency,
gates the memory critical path). The schedule doesn't alter scope or decisions; it's a build aid.

---

## Session 49 — 2026-07-03 — BUILD BEGINS: ISSUE-001 (cost-viability spike) built + run + PASS; AF-001 flipped 🟢; ADR-009 (stack) locked

> **⚠️ HANDOFF NOTE — the build has started. Spec Phases 0–6 remain the terminus; this is the first
> runnable code.** Tier-0 spike **ISSUE-001 is DONE** (AF-001 launch gate PASS). Five Tier-0 spikes
> remain (002 RLS-latency · 003 injection · 004 restore · 005 brute-force · 006 webhook). The
> product-repo home decision is deliberately deferred to **ISSUE-007** (top of the critical path) —
> spikes live in `spikes/<issue>/` and are disposable evidence, not the product codebase.

**What happened:** Started the build with **ISSUE-001 — SPIKE: cost viability ≤ ~$20/day** (one of the
six OD-157 launch go/no-go gates). Two decisions + a full runnable harness + a real measured PASS.

**Decisions written down (Rule 0):**
- **ADR-009 (implementation stack = TypeScript/Node)** — NEW. Grepped the whole spec: the *language*
  was never recorded, only the infra (Inngest + Supabase, which are TS-first). The operator's memory
  said "TypeScript" but Rule 0 = it isn't decided until it's in a file with an ID. Locked it now,
  Accepted, indexed in `adr/README.md`. Affects every build issue.
- **Code location:** build code lives in **`spikes/<issue>/`** in this repo (spec untouched). The
  product-repo-vs-monorepo call is explicitly deferred to ISSUE-007 (Tier-1 bootstrap "stands up a
  client project") — a spike shouldn't force it.

**ISSUE-001 built + run (DoD closed):**
- **Harness:** `spikes/issue-001-cost-viability/` — 11 TS modules mapping 1:1 to the issue's build
  order: `profile.ts` (declared typical-volume profile — the extrapolation basis, contestable by
  design) · `corpus.ts` (assembles+records the corpus, since no canonical corpus file exists) ·
  `pricing.ts`+`ledger.ts` (`price_table` + round-up estimator + the running meter, `cost_tokens ×
  price_table`) · `vendors.ts` (real Anthropic Sonnet/Haiku + OpenAI embed, **attempts counted**,
  dry-run mode) · `task.ts` (orchestrator→research→2 specialists→synthesis) · `memoryWrite.ts`
  (ADR-003 §4 path: code filter → Haiku gate → 2 Haiku pre-checks → 1 Sonnet writer → embed) ·
  `extrapolate.ts` + `thresholds.ts` + `report.ts` (evidence fields a–h) + `main.ts`.
- **Real measured result (2026-07-03):** one task **$0.0359** (5 Sonnet + 1 Haiku); one surviving
  write **$0.0025** (1 Sonnet + 3 Haiku + 1 embed — ADR-003 §4 shape **confirmed**); non-survivor
  **0 Sonnet**. Extrapolated against the declared profile (50 tasks/day · 500 write-events, 100
  survive · 169 idle-gated loops) = **$2.09/day** — ~10× under the ~$20 target, ~25× under the $50
  soft alert, *with* the round-up posture (every retry charged, non-batch rates, no cache discount).
  Verdict **PASS 🟢**. Evidence artifact: `results/af-001-evidence.2026-07-03.{json,md}`.
- **Note on the run:** first live run failed **loud** (as designed, non-negotiable #3) on an OpenAI
  `429 no-quota` — operator funded OpenAI, re-ran clean. Anthropic worked first try.

**Repo writes (Rule 0 — result recorded, not left in chat):**
- `feasibility-register.md` — **AF-001 flipped 🔴→🟢** with the evidence summary; AF-040/041/042/043
  given dated `↳ AF-001` cross-reference notes (glyphs unchanged — their own EVALs still owed).
- `cost.md` — **AC-NFR-COST.006.1/.2 → Verified** + a Verification-result line under NFR-COST.006.
- `config-registry.md` App. A item 10 — **OpenAI `text-embedding-3-small` rate filled: 0.00002/1k**
  ($0.02/1M standard, not batch), primary-source verified 2026-07-03 (was a `???`-style gap).
- `ISSUE-001-...md` — `status: ready → done` + a result banner. `README.md` — new **Build** status row.
- `adr/ADR-009-...md` + `adr/README.md` index row.

**New open questions / follow-ups:** none blocking. Fast-follow EVALs still owed (unchanged, not this
gate): AF-042 (estimate-vs-real-invoice reconciliation), AF-043 (gate accuracy / 3-week shadow-retain),
AF-040/041 (threshold realism over more task types). The declared profile is contestable → any dispute
routes to an AF-040/041 EVAL, not back to this gate.

**Next action:** the operator's choice — continue Tier-0 spikes (recommend **ISSUE-002 RLS-latency**
next, as it gates the memory critical path 009/023/025). Session-49 is **committed to `main` and pushed
to `origin/main`** (operator directed the push; `7cca645` spike + `caf17cc` backlog cleanup). **GitHub
issue #1 CLOSED** with the result; `_backlog.md` roster + Tier-0 line mark 001 ✅ done. Repo == GitHub,
in sync. Product-repo home decision is parked in **ISSUE-007's own file** (build-phase callout added).

---

## Session 48 — 2026-07-03 — PHASE 6 COMPLETE: 86 build issues cut · verified · coverage-complete · GitHub-mirrored · committed

> **⚠️ HANDOFF NOTE — the GitHub mirror is DONE. Do NOT re-run Step 8.** All 86 issues already exist on
> `Sweeite/AI-Harness-V1.0` (#1–#86, 1:1 with ISSUE-0NN), each issue file's `github:` frontmatter carries its `#n`,
> and the whole Phase-6 deliverable is committed (`24dfc72`) + the doc-sync follow-up. Re-running the mirror would
> create 86 **duplicate** GitHub issues. Phase 6 (and the whole Phases 0–6 spec effort) is the terminus — **the next
> action is `git push` (not yet pushed) → the build begins.** (Repo self-sufficiency test run at end of session — PASS;
> it caught these forward-pointers still reading "awaiting mirror", now corrected.)

**What happened:** Executed Phase 6 (Issue Decomposition) per the finalized playbook. Built `spec/06-issues/`:
`_TEMPLATE.md` (the 10-field self-sufficiency contract) · `_backlog.md` (the spine) · **86 `ISSUE-<nnn>-<slug>.md`
files (001–086)** · `_harvest/frag-*.md` (Step-1 coverage fan-out, ~1,600 lines). Every issue points into the repo
**by ID** and never copies `AC-*` text (Rule 0 / DRY).

**Steps 1–9 (bar the outward mirror + sign-off):**
- **Step 1 — Harvest** (subagent fan-out, 4 Explore agents over C0–C3 / C4–C6 / C7–C10 / NFR+data+surfaces) →
  `_harvest/frag-c0-c3.md` · `frag-c4-c6.md` · `frag-c7-c10.md`. Full coverage inventory: ~438 FRs + ~93 NFRs.
- **Step 2 — `id-conventions.md`** amended via change-control: `ISSUE-` redefined from GitHub `#<n>` to a canonical
  repo-markdown `ISSUE-<nnn>` file (dated note, matching the Phase-5 `DR`-domain precedent).
- **Steps 3–4 — Cut slices + map.** 86 issues across **13 epics** (S spikes · A foundations · B identity · C memory ·
  D tools · E prompt · F harness · G guardrails · H agent-design · I proactive · J observability · K infra · L config).
  `_backlog.md` carries 7 build tiers, the **verified-acyclic dependency DAG**, the **11-node critical path**
  (`007→008→009→018→019→022→023→025→045→053→072`), and the full FR+NFR **coverage ledger**. The six OD-157
  launch-gating spikes (AF-068/069/001/067/078/077) are first-class ISSUE-001–006, sequenced ahead of dependents.
- **Drafting via Workflow** (operator delegated "I trust your recommendation" → full Workflow run, precedent = the
  pre-Phase-6 audit). First run drafted 72/86 then hit a **session limit** (7.7M subagent tokens); a compact
  finish-workflow drafted the remaining 14 + verified a 34-issue sample + coverage critic. (Script bug — fix-stage
  didn't guard a null verdict from a killed agent — fixed in the finish run.)
- **Step 7 — Verification gate CLEAN.** Coverage critic **PASS** (all 85 FR area-groups + all 9 NFR domains claimed,
  **zero orphan** FR/NFR/issue — checks a/b); DAG **acyclic**, all edges resolve (check d); **per-issue zero-context
  self-sufficiency build-test** (check f) on a 34-issue sample (all 6 spikes + all 14 late-drafted + every seam-heavy /
  foundation issue): **20 passed first try · 11 fixed-then-passed · 3 surfaced genuine spec gaps** → Step-5 change-control.
- **Step 5 — Gap-sweep change-controls (the gate's real payoff):**
  - **OD-168** — `rls-policies.md`'s helper list omitted the **visibility-tier resolver**; a builder couldn't author
    FR-1.RLS.003's visibility predicate. Added `user_visibility(uid)` (distinct from the PERM-node `user_perms`) to
    `rls-policies.md` + `indexes.md`; ISSUE-020 cites it. *(Minted by the ISSUE-020 build-test fix-agent; verified real.)*
  - **OD-169** — FR-2.RET.005 gave ranking **weights** but no **sub-signal→[0,1] normalization**; recency + entity-match
    were unmapped. Fixed the contract (recency = `0.5^(age/half_life)`, Jaccard entity-match, cosine→`(c+1)/2`); minted
    `CFG-rank_recency_half_life_days` (90, LIVE) into `config-registry.md`; +FR-2.RET.005 Notes. *(ISSUE-025 fix-agent;
    config + FR edits verified applied.)*
  - **OD-170** — the `event_type` enum (`schema.md` §8) admitted **no value** for the FR-1.RLS.007 mid-task
    authorization-stop or the FR-1.RLS.008 divergence `event_log` writes → a build-time guess. Added
    `authz_revoked_midtask` + `rls_harness_divergence` (additive/expand-contract-safe); ISSUE-020 build steps cite them.
  - Issue-file fixes (no spec change): **ISSUE-077** manifest now names `PERMISSION_NODES.md` L110 (Super Admin) for
    `PERM-compliance.download_records` (was mis-pointed at ISSUE-018); **ISSUE-008** reworded the false "creates RLS DDL
    verbatim" claim (rls-policies.md fixes *contracts*, DDL is a build artifact → ISSUE-009 owns the logic), rescoped
    `expected_slots` concrete content to onboarding/ISSUE-030 (registry defines shape only), and re-cited the dangling
    FR-1.PERM.002 → FR-1.PERM.005 + OD-030 (both resolvable from `PERMISSION_NODES.md`).
- **Step 6 — Open decision:** **OD-171** (🟡 OPERATOR) — the connector rollout order (ISSUE-039 GHL / 040 Google /
  041 Slack). The DAG fully sequences everything else and **no v1 scope-cut was forced**; this is the one open
  build-sequencing degree of freedom and it's client-driven (ADR-001). Recommendation: GHL first (CRM spine, carries
  AF-090/098). Gates nothing on the critical path — the build can start on the whole foundational/identity/memory spine.
- **Step 9 (partial) — `traceability-matrix.csv`** issue column wired: every FR → its `ISSUE-<nnn>` (split areas mapped
  by FR number). README Phase-6 row + this log updated.

**Fix-agent hygiene note:** the verification fix-agents autonomously minted + logged OD-168/OD-169 (well-analyzed,
ADR-consistent) and applied their change-controls; one collided with the OD-168 I'd assigned to the enum fix → I
renumbered the enum change to **OD-170** and reconciled the tail guard ("Next OD number: OD-172"). All three ODs verified
against source (CFG keys real, FR-1.RLS.003 confirms the visibility model) before acceptance — no hallucinated IDs left in.

**Steps 8 + 9 — DONE (operator: "sign off + mirror + commit").**
- **Step 8 — GitHub mirror created:** 86 issues on `Sweeite/AI-Harness-V1.0` (was empty → now #1–#86, a clean 1:1
  `ISSUE-0NN → #NN`). Each GitHub body links the canonical repo file + lists the DoD `AC-*` as a task-list (link, don't
  duplicate — the ownership split). Each issue file's `github:` frontmatter carries its `#n`; the id→# map is in
  `spec/06-issues/_github-map.tsv`. The matrix records the 1:1 mapping (no separate column — ISSUE-0NN = #NN).
- **Step 6 — OD-171 resolved (operator): GHL first** (ISSUE-039 → 040 Google → 041 Slack).
- **Step 9 — committed** `24dfc72` (102 files) + this doc-sync follow-up. **Not pushed** (never push unasked).
- **Repo self-sufficiency test (handoff gate) — PASS.** A zero-context subagent resumed from the repo alone: all 86
  issues present, coverage complete, every OD-168/169/170/171 + enum/helper/config change-control resolves, the 3
  patched issues (008/020/077) clean, no dangling IDs. Its one finding was that these forward-pointers still read
  "awaiting mirror" (the mirror was done post-write) — **corrected here** so a fresh chat does not re-mirror.

**Next action:** `git push` to activate the GitHub issue links, then **the build begins** — Phase 6 is the terminus of
the Phases 0–6 spec effort; the repo is now a build queue. A fresh chat picks up the top ready issue from
`spec/06-issues/_backlog.md` (start on Tiers 0–2: the six launch-gating spikes ISSUE-001–006 + the foundational/identity/
memory spine), reads only that issue + its context manifest, and builds it to its `AC-*`. No prior conversation needed.

---

## Session 47 — 2026-07-02 — OD-161 OPERATOR CONFIRMATION (carried-forward note discharged)

**What happened:** Operator pulled the Session-46 audit-reconciliation commits to local and asked to review the one
carried-forward operator note before Phase 6. Walked the operator through **OD-161** (the rollback of
`FR-9.MODE.004`'s Act-tier autonomous low-risk-external send → **Prepare-only**, reversing part of the previously
operator-decided **OD-088**): the collision with locked **ADR-007** ("no config change can override a hard limit",
twice verbatim), the duplication of the **OD-047** carve-out rejected one day earlier, and the actual cost
(Prepare-only loses only the final auto-send on non-client cold-lead/nurture email — one human tap; all opportunity
detection + full drafting preserved). Gut-checked the one scenario that would justify reopening (unattended
high-volume cold outreach, where "tap each one" defeats the purpose → would warrant a deliberate ADR-007 amendment
instead). **Operator confirmed the rollback stands.**

**Then — Phase-6 playbook FINALIZED (same session, finalize-before-entry pass).** `phase-playbooks.md` Phase 6
went from a 9-line approach stub to **full mechanical detail** (parity with Phases 4/5): Goal · Why-it-exists ·
the **issue self-sufficiency contract** (the cardinal rule) · Scope calls · Output file structure (`spec/06-issues/`
= `_TEMPLATE.md` + `_backlog.md` + `ISSUE-<nnn>-<slug>.md`) · the 10-field issue template · 9 Steps · the a–f
verification gate · Done-when/Who-decides/Hand-off. **Operator decisions this session:**
- **Issue home** → canonical repo markdown **AND** a maintained GitHub Issues mirror ("maintain both" — operator
  wants at-a-glance progress + quick in-place notes). Drift-controlled by an **ownership split**: repo markdown owns
  the issue **DEFINITION** (scope, FR/`AC-*`/`NFR-*` IDs, touchpoints, manifest, deps); GitHub owns the **BUILD-STATE**
  (open/closed, checkboxes, comments). Definition edits flow repo→GitHub; any GitHub note that changes a definition
  must be reconciled back to the repo before it's authoritative (Rule 0 preserved).
- **Granularity** → fine tracer-bullet slices + a `_backlog.md` index (epic grouping + dependency map + critical path).
- **Self-sufficiency** (operator's stated priority for cross-chat build) is now the *cardinal rule + gate check (f)*:
  every issue is a precise build-order that **points into the repo by ID, never copies `AC-*` text** (copying = a
  second source of truth that rots = Rule-0 violation); the gate spawns a **zero-context subagent per issue** that
  must build from issue + named files alone, no guessing.
- **Coverage total** (every FR C0–C10 + every NFR → ≥1 issue; no orphan either way); the **six OD-157 launch-gating
  spikes** are first-class spike-issues sequenced ahead of dependents; `ISSUE-<nnn>` convention amended at entry
  (change-control) since `id-conventions.md` currently mis-defines it as GitHub `#<n>`.

**gh confirmed available** (handoff de-risk): `gh` installed + authenticated as **Sweeite**, token scope includes
`repo` (issue-create OK), remote `Sweeite/AI-Harness-V1.0`. The new chat can create the GitHub mirror with no setup.

**Files changed:** `open-decisions.md` (OD-161 → +✅ OPERATOR CONFIRMED annotation; ADR-007 untouched),
`phase-playbooks.md` (Phase 6 finalized), README (Phase-6 row), this log. No Phase-6 *execution* done — no issues cut,
`id-conventions.md` not yet amended (that's entry Step 2), `spec/06-issues/` not yet created — per operator:
**execution happens in a NEW chat.**

**Next step (for the new chat): EXECUTE Phase 6** per the now-finalized `phase-playbooks.md` Phase-6 procedure —
Step 1 harvest/coverage fan-out → Step 2 amend `id-conventions.md` (`ISSUE-<nnn>`) → Step 3 cut the vertical slices →
Step 4 dependency map + `_backlog.md` → Step 5 gap-sweep → Step 6 ODs → Step 7 verification gate (incl. the per-issue
self-sufficiency build test) → Step 8 GitHub mirror (`gh issue create`, record `#<n>`) → Step 9 wire matrix + README +
sign-off. FR-9.MODE.004 is cut as **Prepare-only** (OD-161). *(Skill status refreshed this session: the `to-issues`
skill — tracer-bullet vertical-slice issue decomposition, directly relevant to Phase 6 — and `handoff` are now
**INSTALLED** (present on disk + in the skills list; the earlier "verified absent" notes reflected the environment at
that moment). The new chat may use `to-issues` to assist, but the finalized playbook is authoritative.)* **A repo
self-sufficiency test was run before this handoff — see the addendum at the end of this entry.**

**ADDENDUM — repo self-sufficiency test (required handoff gate, run before this handoff): PASS.** A zero-context
subagent read only the repo (following CLAUDE.md's start-of-session order) and tried to resume the next action.
**Verdict: the repo is genuinely self-sufficient — a fresh cold chat can resume Phase 6 from the repo alone without
guessing.** Next action correctly identified as Phase-6 Step 1 (harvest/coverage fan-out). All four load-bearing
claims confirmed: (1) the Phase-6 playbook is at full mechanical detail — self-sufficiency contract, `spec/06-issues/`
structure, 10-field template, Steps 1–9, a–f gate all present; (2) OD-161 carries the ✅ OPERATOR CONFIRMED
annotation + rolls FR-9.MODE.004 to Prepare-only; (3) `id-conventions.md`'s `ISSUE-` row is still `#<n>` (correctly
un-amended — that's entry Step 2); (4) OD-157 names six spikes, all six AFs resolve in the feasibility register.
**Zero blocking gaps.** One informational finding (not a repo defect): the `to-issues`/`handoff` skills, logged
"absent" in Sessions 46/47, are now **installed** — the handoff had already told the new chat to re-check; the stale
"absent" wording in the two forward-facing resume pointers (README Phase-6 row + this entry's next-step) was corrected
to "installed" this session so the new chat isn't misled. (Historical Session-46 references left intact as record.)

---

## Session 46 — 2026-07-02 — PRE-PHASE-6 FULL-SPEC AUDIT RUN + FULLY RECONCILED — 🟢 PHASE 6 GATE CLEARED

**What happened:** Ran the **pre-Phase-6 full-spec audit** (`spec/00-foundations/pre-phase-6-audit-playbook.md`),
operator-authorized as a **Workflow** ("run it as a Workflow (Recommended)"). First attempt stalled mid-run (a
session interruption killed 3 in-flight agents around Dimension 6/Verify, ~34/38 agents cached) — resumed via
`resumeFromRunId`, which replayed all completed agents from cache and finished cleanly. **154 total agents, 0
errors, 6.7M subagent tokens.**

**Audit result:** 110 raw candidate findings across the 6 dimensions (ID resolution · traceability completeness ·
cross-phase consistency · change-control integrity · contradiction hunt · three-non-negotiables end-to-end) →
after adversarial verification (a dedicated refutation agent per HIGH/MED candidate, default-to-false-positive):
**48 confirmed HIGH, 46 confirmed MED, 10 LOW (cosmetic, unverified), 6 refuted.** Full report: `spec/00-foundations/
audit/_audit-report.md` (+ `dim-1`…`dim-6` evidence files + `_mechanical-prepass.md`). The volume is mostly
**cross-phase reference decay** — Phase 4 (data model) split/renamed things Phase 1 (components) had already cited
by their old names, and no prior verification gate had ever checked *across* phases, only within one. A smaller set
(~7) were genuine architectural contradictions — two different Approved parts of the spec describing incompatible
system behavior.

**Reconciliation (same session, operator-delegated "I trust your recommendation"):** Judgment calls on the 7
architectural findings were made directly (not delegated to fix-agents) and logged as **OD-161…OD-167** in
`open-decisions.md`, each with options considered + rationale, per `standards/change-control.md`:
- **OD-161 🔑 the big one** — `FR-9.MODE.004`'s Act-tier autonomous external-send (added via OD-088, a direct
  **operator** decision at C9 finalization) collided with **ADR-007**'s locked "no config change can override a
  hard limit" text, and reproduced exactly the carve-out **OD-047** (one day earlier) explicitly rejected. Resolved:
  rolled back to **Prepare-only** — the AI still drafts, a human still sends. This reverses part of a prior
  *operator*-decided call, so it's flagged here explicitly, not buried in the batch. `C6 FR-6.APR.002/003`'s OD-088
  narrowing reverted to the original blanket external-comms floor; `AC-6.APR.002.3` retired; the now-pointless
  `act_trust_period_days`/`external_act_trust_period` config fields removed everywhere (config-registry.md,
  surface-01, component-09).
- **OD-162** — defined the previously-undefined "local mirror" of `client_registry.status` (cited by FR-5.TRG.001.3/
  FR-10.DEL.007/FR-10.OFF.004 but never specified, since `client_registry` lives only in the management-plane
  deployment and ADR-001 §7 is push-only). Resolved: a new `deployment_settings.frozen_at` table **inside each
  client's own Supabase**, written by the management plane via the client's already-custodied `service_role` key
  (ADR-001 §7) — reuses existing infrastructure, doesn't reopen the push-only boundary.
- **OD-163** — `UI-SUPPORT-REQUESTS` (surface-00, predates the "exactly two Realtime surfaces" rule) corrected from
  Realtime to polling.
- **OD-164** — ADR-003's cost-ladder key names reconciled against the shipped config-registry.md (dated in-place
  note, same pattern as OD-046); the daily/weekly soft-alert figures restored to independently-editable keys
  (`cost_ladder_soft_threshold_daily_usd`/`_weekly_usd`) per ADR-003's actual requirement.
- **OD-165** — custom-command dispatch (`FR-9.CMD.008`) now creates/reuses a `task_queue` row like any other agent
  action, closing a #2 gap where a command resolving to hard-approval had no described enforcement path.
- **OD-166/167** — PERM-node catalog reconciliation: minted `PERM-compliance.view_audit` and two `PERM-ops.*`
  (DLQ manage / connector reconnect) nodes for citations that resolved to nothing.
- **Dim5-H28 (regex-quarantine vs ADR-007) — reviewed, no fix needed.** Read the actual ADR-007 text directly
  (`L163-164`: quarantine is explicitly framed as part of the "signal + human-routing layer") plus FR-6.INJ.006
  ("never proceeds without explicit human approval") — the audit's finding was a misreading, not a defect. Logged in
  the OD-161–167 block so a future session doesn't re-open ADR-007 over it.

**Mechanical fixes** (dangling/renamed IDs, missing matrix rows, stale FR/node counts, schema gaps) applied via a
**second Workflow**: 30 file-scoped agents running in parallel (one per file/tightly-coupled file group, to avoid
concurrent-edit conflicts on shared files like `traceability-matrix.csv`/`PERMISSION_NODES.md`/`config-registry.md`/
`schema.md`), each executing a precise pre-decided checklist — no independent judgment left to the fix agents.
0 errors, all 30 completed with clear per-item completion notes (several correctly flagged out-of-scope items rather
than guessing, e.g. surface-07's agent found the audit's line-count for M26 was slightly imprecise and fixed only
the one real occurrence). Two cross-agent loose ends closed manually afterward: `amber_zone_threshold`'s corrected
default (0.65→0.75, H27) propagated to `config-registry.md` + a new cross-key validation constraint; two
`DATA-credentials` references in `surface-05-dashboard-ops.md` that no agent's checklist covered; the OD-161
removal's ripple into `surface-01-config-admin.md`'s Data-bindings table (the now-deleted trust-period fields were
still described there); README's stale C6 FR-count (35→36, RTL ×3→×4).

**Files changed:** ~35 files across `spec/00-foundations/` (open-decisions.md +OD-161-167, ADR-003/ADR-004
reconciliation notes, what-makes-it-great.md, feasibility-register.md +AF-139, tool-integrations/gohighlevel.md),
`PERMISSION_NODES.md`, `traceability-matrix.csv`, all of `spec/02-config/config-registry.md`, `spec/04-data-model/`
(schema.md +2 tables, indexes.md, migrations.md, rls-policies.md), 9 of the 11 `spec/01-requirements/` component
files, 9 of the 14 `spec/03-surfaces/` surface files, 4 of the 9 `spec/05-non-functional/` files, `README.md`,
this log. New audit evidence files in `spec/00-foundations/audit/`. Committed in stages as the workflows produced
output (honest WIP commits when stop-hooks fired mid-run, per the established pattern from sessions 42/43),
final reconciliation commit + this entry.

**Next step: Phase 6 (Issue decomposition)** — gate is clear. Finalize the Phase-6 playbook (approach → full
mechanical detail, per the finalize-before-entry rule used for every prior phase), then slice the spec into
vertical, independently-buildable issues, each inheriting its FR `AC-*` + the `NFR-*` constraints + the six
launch-gating spikes (OD-157) as its definition of done, with a build-order/dependency map. *(No dedicated
`to-issues` skill is currently installed in this environment, despite being named here and in the audit playbook —
verified absent from both the available-skills list and the filesystem, 2026-07-02. Follow the finalized Phase-6
playbook procedure directly instead; re-check whether a skill has since been installed before assuming it isn't.)*
**Operator note carried forward: OD-161 reverses part of a previously operator-decided call
(OD-088, low-risk-external autonomous send) — worth a explicit look before Phase 6 issues get cut from FR-9.MODE.004,
in case there's context this session didn't have.**

**ADDENDUM — full OD-register review + repo self-sufficiency test (same session, before handoff to a new chat):**
Ran a full review of all 167 decisions in `open-decisions.md` (six parallel sharded reads + a dedicated skeptical
self-review of OD-161–167). Zero decisions open; no contradictions in the pre-existing register. The self-review
did catch real gaps in this session's own reconciliation — fixed: forward-pointers added to OD-088/OD-064/OD-143
(each was silently superseded with no pointer to the OD that changed it); OD-166/167's catalog-count arithmetic
corrected (52→53→55, matching `PERMISSION_NODES.md`'s own M27 baseline correction, not the stale 51→52→54); a real
safety gap in OD-162 closed with new **AC-10.OFF.004.5** (the freeze-write can partially fail — mgmt-plane marks a
deployment frozen but the local `deployment_settings.frozen_at` write fails — now requires a `freeze_pending`
sub-state + escalation, never a silent false-frozen read); the stale `system-map/09-proactive.md` diagram (still
depicting the reverted Act-tier exception) updated. Then ran the **required repo self-sufficiency test** (CLAUDE.md
"Context-window management") before this handoff — a zero-context subagent reading only the repo. **Result: FAIL
on first pass, patched, now clean.** Found and fixed: (1) `config-registry.md`'s Appendix A item 9 description
still described the retired Act-tier fields as live (a duplicate description the earlier reconciliation missed —
the main §L table row was already fixed, this Appendix A summary wasn't); (2) `traceability-matrix.csv`'s
FR-9.MODE.004 row was stale (cited the retired `CFG-external_act_trust_period` key and a dangling `AC-9.MODE.004.6`
— OD-161 retired the old `.5` and renumbered the former `.6` to `.5`, so `.6` no longer exists); (3) AF-131's
description (both in `component-09-proactive.md` and `feasibility-register.md`) still framed itself as a live #2
containment gate against "autonomous client send," a path OD-161 removed — reframed as a lower-stakes draft-quality
EVAL; (4) the `to-issues` skill (referenced in README/SESSION-LOG/the audit playbook) and the `handoff` skill
(referenced in CLAUDE.md) are both named as available but don't exist in this environment (verified against the
actual available-skills list + filesystem) — reworded all four references so a future session doesn't stall trying
to invoke something absent, with an explicit note to re-check in case one gets installed later. **Self-sufficiency
test PASS after these fixes** — a fresh chat starting cold can now execute the next action (finalize the Phase-6
playbook) without guessing.

---

## Session 45 — 2026-07-01 — PHASE 5 (NON-FUNCTIONAL) ENTERED, DRAFTED, GATE CLEAN, SIGNED OFF — 🟢 PHASE 5 COMPLETE

**SIGN-OFF (2026-07-01):** operator signed off on Phase 5 ("yep sign off"). README flipped 🟢; the four
risk-posture ODs (OD-157–160) confirmed as chosen. Repo self-sufficiency test run before commit+push (handoff
gate into Phase 6) — **PASS** (fresh chat can resume from the repo alone). **Operator's stated next intent: a
full whole-spec audit (Phases 0–5) before Phase 6 issue decomposition** — the repeatable procedure is written
in **`spec/00-foundations/pre-phase-6-audit-playbook.md`** (six dimensions · adversarial-verify pass ·
mechanical pre-pass · sharding rules · workflow-or-parallel orchestration · pass criteria). **The audit may run
in a NEW CHAT** (this one's context is heavy) — a fresh chat reads `CLAUDE.md` → `README.md` → that playbook
and executes. **NEXT ACTION:** run the audit (kick-off prompt is in the playbook's "How to kick this off"
section); a clean audit clears Phase 6.

**What happened:** Entered **Phase 5 (Non-Functional Requirements)**. Per the "finalize before entry" rule,
first **rewrote the Phase-5 playbook** from approach-altitude to full mechanical detail (9-file output
structure, the **reference-don't-re-spec** cardinal rule, the **AF-register-as-test-spine** principle, steps
1–8, verification gate checks a–f). Added the **`DR` domain code** to `id-conventions.md` (backup/DR is a
first-class NFR domain). Noted **OD-009 is already RESOLVED→ADR-008** — Phase 5 specs the machinery, doesn't
re-decide.

**Harvest (six-agent fan-out).** Independent read-only subagents over: 3 component shards (C0–C3 · C4–C7 ·
C8–C10 — the first two attempts overflowed reading all 11 at once, so sharded), 2 surface shards (00–05 ·
06–12), and 1 ADR + config-registry pass. Consolidated into **`_nfr-inventory.md`**: ~82 NFR candidates across
8 domains, each tied to its functional owner FR/ADR + its AF-* gate, + a gap-sweep list + the 4 risk-posture ODs.

**Four risk-posture ODs surfaced to the operator (RP-1…4), who chose the recommended option for each →
OD-157–160:** OD-157 the **six launch-gating spikes** (AF-068/069/001/067/078/077) vs blocking-by-posture
mechanisms vs fast-follow accuracy-EVALs; OD-158 restore rehearsal monthly+per-migration; OD-159 a11y baseline
(full WCAG→OOS-041); OD-160 aspirational spike-confirmed perf targets (never a binding SLO).

**Drafted all 9 files.** `security.md` written first as the **exemplar** (the `NFR-*` row shape: Requirement /
Type / Upholds / Implemented-by / Target / Verification / **Launch gate** / ACs). The other 7 domain files +
were drafted by parallel subagents against the exemplar (each verified its cites against source; two agents
paused after delegating cite-checks and were resumed to write). `test-strategy.md` (the keystone — the AF
de-risking schedule) written in the main thread. **~90 NFR-\* total** (SEC 17 · INF 14 · OBS 16 · PERF 12 ·
CMP 11 · COST 10 · DR 8 · A11Y 2).

**Gap-sweep change-controls:** +AF-138 (mobile web-push delivery) · +OOS-041 (WCAG deferral) · +3 config keys
(`recovery_tier`, `haiku_audit_window_days`, `haiku_gate_disagree_threshold` — all owed by ADRs but absent from
the registry, Rule-0 gaps) · inventory scale-cite fix (≤20 users/silo is ADR-006/008, not ADR-001).

**Verification gate (independent zero-context, checks a–f): CLEAN — 0 HIGH · 3 MED · 3 LOW, all reconciled.**
(a) domain coverage complete; (b) reference-integrity high (~30 cites spot-checked live, no dangling safety cite,
no NFR contradicts its source); (c) three non-negotiables provably covered (audit-sink immutability trigger,
restore-proven, erasure-walk, hard-limits-non-overridable, service_role-bounded, silent-failure detector +
watchdog + escalate-don't-abandon + cost-unknown≠$0); (d) feasibility spine — six launch-gating spikes
consistent everywhere, **no NFR overclaims proven-vs-specified** (every perf number tagged "confirm-by-AF"); (e)
gap-sweep landed; (f) testability — every domain→test layer, every AC-NFR checkable. **Reconciled:** MED-1
dangling `recovery_tier` cite→config key added; MED-2 stale "haiku keys missing" note→corrected; MED-3
test-strategy "every AF" completeness→+AF-063/040/041/113; LOW-1/LOW-2 cite-precision; LOW-3 no-action.

**Files changed:** `phase-playbooks.md` (Phase-5 approach→full detail), `id-conventions.md` (+DR),
`spec/05-non-functional/` (all 9 files, new), `feasibility-register.md` (+AF-138), `out-of-scope.md` (+OOS-041),
`config-registry.md` (+recovery_tier +2 haiku keys), `open-decisions.md` (+OD-157–160), `_nfr-inventory.md`
(cite fixes), `traceability-matrix.csv` (Phase-5 header note), `README.md` (Phase-5 🟡), this log. Committed
across the session (playbook-entry, inventory, domain-files, gap-sweep, gate-fixes as separate commits).

**Next step:** **operator sign-off on Phase 5** → flip README to 🟢 → **Phase 6 (Issue decomposition)** — slice
the finished spec into vertical, independently-buildable issues, each inheriting its FR ACs **+** the NFR-*
constraints (+ the launch-gating spikes) as its definition of done. This is the last spec phase before the
backlog. **Open question for sign-off:** confirm the 4 risk-posture ODs (OD-157–160) as chosen (they were the
recommended options, operator-selected via the Phase-5 decision prompt).

---

## Session 44 — 2026-07-01 — PHASE 4 (DATA MODEL) DRAFTED, GATE CLEAN-WITH-FIXES, FINALIZED + SIGNED OFF — 🟢 PHASE 4 COMPLETE

**What happened:** Entered **Phase 4 (Data Model)**. Per the playbook's "finalize before entry" rule, first
**rewrote the Phase-4 playbook** from approach-altitude to full mechanical detail (output file structure,
harvest fan-out, the 7 net-new stores, type/enum consolidation, RLS/index/migration rules, verification
gate checks a–f). Then built all five `spec/04-data-model/` files.

**Harvest (subagent fan-out).** Independent subagents over the **14 surfaces** ("Phase 4 data binding
notes"), the **11 components** (`DATA-`/`Data touched:` footers, sharded C0–C1/C2–C3/C4–C6/C7–C8/C9–C10),
and the **config registry + traceability matrix** (the authoritative **21 `DATA-*` id** list). Consolidated
into **`_data-inventory.md`**: ~40 tables in 14 groups, the **16 net-new Phase-3 stores/fields** catalogued
+ owed-back to their component FRs, **R1** (`client_slug` is DELETED not "label-only" — OD-096/FR-10.ISO.001
supersede the older C2–C6 prose), **R2** (store renames), and **7 schema ODs** (OD-P4-01…07) surfaced with
recommendations.

**`schema.md`** — one coherent schema: a `Types` section (every enum defined once) + 14 groups. Every table
typed with PK/FK/constraints. All net-new stores **designed** — `memory_conflicts`, `consolidation_approvals`,
`injection_quarantine`, `task_history` (durable envelope originals, OD-P4-04/AF-115), `notifications`,
`push_subscriptions`, `agent_health_metrics`, `agent_result_cache` (scope-aware invalidation), `execution_plans`,
`commands`, `signal_weights`, `conversations`/`messages` (OD-135 chat), + fields `task_queue.originating_user_id`,
`guardrail_log.escalated_at`, two-person-auth on `deletion_requests`. **NO `client_slug` on any application
table** — only `client_registry`/`deployment_health`/`offboarding_records` on the **separate management
deployment** (ADR-001 §7). 7 schema ODs resolved per the **recommended** option (user-delegated): OD-P4-01
thin `profiles` mirror · **OD-P4-02 split** `webhook_secrets` + `connector_credentials` · OD-P4-03 shadow-drop
= `ingestion_queue.state` · **OD-P4-04 durable `task_history`** · OD-P4-05 pill stored / cost derived ·
OD-P4-06 defer per-agent `model` · OD-P4-07 dedicated `agent_result_cache`.

**`rls-policies.md`** — ADR-006 static data-driven policies via `(select …)` initPlan (AF-067); human-path RLS
(keyed to `auth.uid()` + PERM nodes + clearances) vs agent-path `service_role` (bypasses RLS; containment via
harness RBAC + the C8 `memory_scope` fail-closed filter); per-table policy summary; the three non-negotiables
mapped into the RLS layer. **`indexes.md`** — HNSW vector (CONCURRENTLY, m=16/ef_construction=64) + the
`(status, created_at)` queue family + the silent-failure-detector join (`task_queue` terminal ⋈ `event_log`
terminal) + RBAC policy-read indexes (initPlan perf) + every net-new store; AF-019 (RLS-after-ANN recall
starvation) flagged paper-until-tested. **`migrations.md`** — expand→backfill→contract discipline
(`migration-discipline.md`), migration 0001 ordering + the CONCURRENTLY-outside-txn caveat (0001b), the
management deployment's **separate** migration lineage, worked examples (drop `agents.system_prompt`,
embedding-model swap), per-deployment failure isolation, AF-065 paper-until-tested.

**Verification gate (independent zero-context subagent, checks a–f): CLEAN-WITH-FIXES — 0 HIGH · 2 MED · 4
LOW.** (a) coverage complete — all 21 ids + config + 16 net-new present, no orphan, no dead table. (b) net-new
completeness PASS. (c) types PASS (task_status incl. `flagged`, guardrail_type ×5, event_type ×8,
sensitivity_tier ×4, memory_type ×3 all match source; 2 doc-only enums flagged). (d) **`client_slug` CLEAN** —
grep confirms only the 3 mgmt-plane tables carry it, no app table. (e) #1/#2/#3 sweep PASS — append-only sinks,
sole-writer memories, hard_limit≠approved CHECK, two-person auth all present. (f) migrations PASS. Source
subagent verified **10/10 load-bearing claims**, zero contradictions. **Reconciled: MED-1** — `deletion_requests`
executor-distinctness CHECK added (AC-10.DEL.006.2 no-self-execution now DB-enforced, not app-only); **MED-2/LOW-1**
— store renames recorded as R2; **LOW-2** — doc-enum note added. **LOW-3** (confirm OD-P4 resolutions at sign-off)
+ **LOW-4** (severity/risk_level as free text) carried to sign-off.

**Files changed:** `phase-playbooks.md` (Phase-4 approach→full detail + status), `spec/04-data-model/`
(`_data-inventory.md`, `schema.md`, `rls-policies.md`, `indexes.md`, `migrations.md`, `_harvest-c7-c8.md`,
`_gate-report.md` — all new), `README.md` (Phase-4 row 🟡). This log. Committed + pushed across the session
(playbook, harvest, schema, RLS/idx/migrations, gate-fixes as separate commits).

**SIGN-OFF FINALIZATION DONE (this session):** the operator delegated ("go what you recommend"). (1) The
**16 net-new-store owed-back `DATA-` cites** were applied to their component FRs via change-control (subagent,
18 additive edits, verified): C2 memory_conflicts (FR-2.WRT.002)/consolidation_approvals (FR-2.MNT.014) ·
C3 idempotency_ledger (FR-3.CONN.004) · C5 task_history (FR-5.ENV.003) + task_queue.originating_user_id
(FR-5.QUE.002) · C6 injection_quarantine (FR-6.INJ.006) + guardrail_log.escalated_at (FR-6.LOG.001) ·
C7 notifications (FR-7.ALR.001) + push_subscriptions (FR-7.VIEW.003) · C8 agent_health_metrics (FR-8.HLTH.001)/
execution_plans (FR-8.PLAN.004)/agent_result_cache (FR-8.LRN.003) · C9 commands (FR-9.CMD.006)/signal_weights
(FR-9.SUG.005)/conversations+messages (FR-9.CMD.004, best-fit anchor — no dedicated chat FR exists) ·
C10 deletion_requests two-person-auth columns (AC-10.DEL.006). (2) The **R1 `client_slug` clerical amendment**
landed on C3/C4/C5/C6 ("label-only" → DELETED per OD-096/FR-10.ISO.001, mgmt-plane `client_registry` only);
**C2 needed none** (it never carried the label-only wording — isolation there is only ever "physical, never an
RLS predicate"). (3) `traceability-matrix.csv` wired (Phase-4 header note: every `data_touched` DATA-* id
consolidated in `schema.md`). (4) README + playbook + this log → 🟢. **7 OD-P4 resolutions accepted as
recommended.**

**POST-SIGN-OFF RE-AUDIT (same session, operator-requested "full quality check start to finish").** A
**second independent zero-context adversarial audit** (distinct from the sign-off gate) re-read the repo and
tried to break Phase 4. Structure verified clean (coverage, 16 net-new cites all landed in their component FRs,
`client_slug` isolation, type consolidation, RLS table-coverage, migrations — all PASS with file:line evidence).
It found **3 real defects the first gate missed** (the first gate checked for append-only *wording*, not a
*mechanism*) — all now **fixed**:
- **HIGH-1 (fixed)** — audit-sink immutability (`event_log`/`guardrail_log`/`access_audit`/`config_audit_log`)
  was asserted append-only but enforced **only by RLS**, which the `service_role` writer **bypasses** — so a
  buggy/compromised writer could silently rewrite/delete history (#1 + #3, and it undercut the AC-7.LOG.008.3
  tamper-evident claim). **Fix:** added `enforce_audit_append_only()` `BEFORE UPDATE OR DELETE` trigger fired
  **regardless of role** (whitelists only the forward status transition + one-way redaction-tombstone; DELETE
  revoked) — `schema.md` §Immutability enforcement; `rls-policies.md` #1 restated to point at the trigger.
- **MED-1 (fixed)** — `deletion_requests` two-person CHECK was NULL-permissive (`<>` passes when a side is
  NULL) and asymmetric; **my earlier "no-self-execution now DB-enforced" claim was overstated.** **Fix:** both
  comparisons now `is distinct from` (NULL-safe) + a new CHECK requiring three non-null distinct people at
  `status='executed'`. **Now** genuinely DB-enforced.
- **MED-2 (fixed)** — `notifications.recipient IS NULL` = broadcast-to-role, but the RLS predicate was stated
  only as "recipient = viewer", so broadcast alerts would be **invisible to everyone** (a #3 silent alert-drop).
  **Fix:** RLS predicate now `recipient = auth.uid()` **OR** (`recipient is null` AND `recipient_role` ∈ caller
  roles).
- **LOW-2 (fixed)** — README C9 count was stale (28 → **31**; the CMD.006–008 addendum was never bumped).
- **LOW-1 / LOW-3 (accepted, logged)** — `permission_node`/`perm_node` are free text (no FK to the markdown
  node catalog — seed-time validation, default-deny posture) and version-tables rely on `previous_version_id`
  convention. Known trade-offs, lower risk than the audit sinks; noted for build-time seed validation, no
  schema change. **New feasibility item AF candidate at build:** trigger-based immutability + a seed-time
  perm-node validation pass. Verdict after fixes: **Phase 4 sound and the #1/#3 enforcement gap closed.**

**Next step — Phase 5 (Non-Functional):** `NFR-*` requirements across security, infrastructure/deploy,
observability, cost (envelope + ladder per ADR-003), compliance, **backup & disaster recovery (resolve OD-009
under ADR-008 — client-owned Supabase ownership/verification + a *tested* restore)**, and the **test strategy**
(how every `AC-*` becomes a real test and reaches `Verified`). Load the Phase-5 playbook (`phase-playbooks.md`
§"Phase 5" — currently at approach altitude; finalize it before entry, same as Phase 4). The schema
(`spec/04-data-model/`) now underpins the security + backup NFRs. OD-009 is the one load-bearing operator
decision (risk posture + backup ownership). Run the standing verification gate at Phase-5 close.

---

## Session 43 — 2026-07-01 — SURFACE-01b (CONFIG-CHANGE AUDIT LOG VIEWER · `UI-config-audit-log`) DRAFTED, RESOLVED, GATE-CLEAN, SIGNED OFF — 🟢 PHASE 3 COMPLETE (14 of 14)

**What happened:** Built `spec/03-surfaces/surface-01b-config-audit-log.md` — the **14th and final Phase-3 surface**: the
**config-change audit-log viewer**, the read/review counterpart to surface-01 (surface-01 *writes* config + appends the
`config_audit_log` row on every Save; surface-01b *reads back* who changed which knob, from→to, when, with a compliance
export). Surface ID **`UI-config-audit-log`** is **named by OD-099** (surface-01's per-section "View audit log →" links
already target it), **not minted here** — like `UI-COMMANDS` on surface-10. Pattern-matched surfaces 00–12. **Three
sections in two buckets:** **A — Config-Change Timeline** (the filterable trail — config section / key / actor / date
range; newest-first; key-prefix-scoped) · **B — Change Detail** (one `config_audit_log` entry in full — the
`old_value`→`new_value` diff, actor + role, timestamp, the knob's `What it does` + LIVE/BOOT/REBUILD class) · **C —
Compliance Export** (a client-presentable extract, **all-or-nothing**, gated by `PERM-compliance.download_records`).

**KEY FINDING — a Rule-0 governance gap closed via change-control (OD-153).** `config_audit_log` is the system's **third
audit sink** alongside `event_log` (C7, FR-7.LOG.001/006) and `guardrail_log` (C6 writes, C7 governs FR-7.LOG.007) and
`access_audit` (C1 content FR-1.AUD.001/002, C7 storage via the FR-1.AUD.003 seam). But `config_audit_log` had **no FR
owner** for its *governance* (append-only / retention / tamper-evidence / export) — it existed only as a
`config-edit-taxonomy.md` rule-4 *write* mandate + a surface-01 Phase-4 schema stub. An unlogged / tamperable /
un-exportable record of *who changed the system's own behaviour* is a **#1/#3 violation**. **Resolved: minted
`FR-7.LOG.008` in C7 via change-control** (config_audit_log view / retention / tamper-evidence / export, mirroring
FR-7.LOG.007 for guardrail_log + the FR-1.AUD.003 content→storage seam). **C7 34 → 35 FRs.** Precedent: OD-097 →
FR-7.ALR.009, minted into C7 from Phase 2 the same way. New ACs: **AC-7.LOG.008.1** (export all-or-nothing, no silent
truncation) · **.2** (retention floor ≥ `individual_deletion_audit_years`) · **.3** (append-only + tamper-evident) ·
**.4** (redaction-tombstone on user-erasure — `config_audit_log` now owed to the C2 FR-2.MNT.017 / C10 FR-10.DEL.004
erasure walk, a carry-forward) · **.5** (secrets never appear — SECRET rows are never UI-editable so never logged).

**The clean PERM case — no entry node minted (fourth-plus consecutive: 10/11/12/01b).** The viewer needs **no new
`PERM-config.view_audit` node** (OD-155): entry requires **≥1 `PERM-config.*` node**, and the row set is **key-prefix-
scoped** to the caller's held config sections — the identical RLS surface-01 mandates for `config_values`/`config_audit_log`.
A caller sees only the audit history of sections they may **manage** (a Finance-config admin never reads the infra-config
trail; `#infra` history stays Super-Admin-only). Export is the distinct, higher act, gated by the already-catalogued
**`PERM-compliance.download_records`** (Super Admin, unseeded — default-deny). No catalog edit.

**4 ODs raised + resolved (surface-local; recommendations delegated, consistent with surfaces 05–12), logged OD-153–156:**
- **OD-153** 🔑 **#1/#3 Rule-0 governance gap** → mint `FR-7.LOG.008` in C7 via change-control (above).
- **OD-154** — layout: single filterable Config-Change Timeline landing + per-change Change Detail drawer + header Export
  action (consistent with surface-06/09/11's list-landing + detail-drawer).
- **OD-155** ⚠️ **#2 read authority (clean, no node)** — key-prefix-scoped `PERM-config.*` entry; export via
  `PERM-compliance.download_records` (above).
- **OD-156** — export behaviour: key/section/old→new/actor/changed_at over the filtered, key-prefix-scoped range,
  all-or-nothing (AC-7.LOG.008.1); field-level diff; secrets never appear (SECRET class never UI-editable).

**Verification gate (independent zero-context subagent, checks a–f): CLEAN-WITH-FIXES — 0 HIGH · 2 MED · 3 LOW (all
reconciled).** (a) Coverage PASS (FR-7.LOG.008 + ACs, FR-7.LOG.005/006/007, FR-1.PERM.005/AUD.003, FR-7.ALR.008/009,
FR-7.RTP.001, OD-099, the OD-097→FR-7.ALR.009 precedent all resolve + paraphrase faithfully; over-claims seamed out).
(b) CFG PASS (`event_log_retention_window` + `individual_deletion_audit_years`, both BOOT, read-only reflected).
(c) DATA PASS (`config_audit_log` fields match the surface-01 stub exactly; no `client_slug`; Phase-4-flagged).
(d) PERM PASS (no node minted; view = key-prefix `PERM-config.*`, all 10 exist; export = `PERM-compliance.download_records`
unseeded; six roles). (e) #1/#2/#3 sweep PASS (no false "no changes" on a failed load; no out-of-scope config history;
secrets never appear; export all-or-nothing). (f) Seams PASS. **Reconciled: MED-1** — the "SECRET never editable in-app"
authority was mis-cited to **OD-102** (which actually resolves the `secret_manifest.last_rotated` deploy-hook source) →
re-cited to the **SECRET edit class** (`config-edit-taxonomy.md` line 11 + rule 2) in **both** the surface and the
propagated **AC-7.LOG.008.5**. **MED-2 (fixed at source)** — the surface + FR cited `config-edit-taxonomy` **rule 4** for
auditing **LIVE/BOOT/REBUILD**, but rule 4 read "LIVE" only → **rule 4 amended via change-control** to cover all three
editable classes (a BOOT/REBUILD change going unaudited is a #1/#3 gap; reconciles rule 4 with `config-registry.md`
§cross-cutting + surface-01's Save, which already audit BOOT; SECRET produces no row). **LOW-1** — "the 11 sections" →
"10 editable of the 11" (the 11th, `#secrets`, is SECRET-class, no audit rows). **LOW-2 (accepted)** — AC-7.MGM.002.4
cited only as a server-authoritative-time analogy. **LOW-3** — the banner's own secrets reasoning re-cited to the SECRET
class (same root as MED-1).

**Files changed:** `surface-01b-config-audit-log.md` (new); `component-07-observability.md` (+FR-7.LOG.008 / AC.1–.5;
header 34→35 FRs / LOG ×8; traceability footer 33→35); `config-edit-taxonomy.md` (rule 4 amended LIVE → LIVE/BOOT/REBUILD,
change-control); `open-decisions.md` (OD-153–156 🟢 + rule-4-amendment note + reserve pointer → OD-157);
`traceability-matrix.csv` (+FR-7.LOG.008 row); `README.md` (Phase-3 row → 🟢 COMPLETE 14 of 14 + surface-01b detail);
`phase-playbooks.md` (Phase-3 status → 🟢 COMPLETE). This log. **No `PERMISSION_NODES.md` change** (no node minted). **No
new OOS / AF.** **Phase-4 debt flagged in-file:** `config_audit_log` append-only + key-prefix RLS + indexes; owed to the
C2 FR-2.MNT.017 / C10 FR-10.DEL.004 erasure walk (actor-attribution redaction-tombstone, mirroring how session 27 added
event_log/guardrail_log via AC-2.MNT.017.4).

**Note (git):** a stop-hook fired mid-session; the draft + change-control mint + register updates were committed + pushed
as a WIP commit (honest message: gate pending) before this finalization. The gate reconciliation (MED/LOW fixes),
README/playbook status bump, and this SESSION-LOG entry land in the follow-up commit.

**🟢 PHASE 3 IS COMPLETE (14 of 14 surfaces signed off).** **Next step: Phase 4 — Data Model.** Consolidate every
`DATA-`/`table.field` reference across the 14 surfaces + the 11 components into one coherent schema: tables, types, RLS
policies (intra-client only, no `client_slug` — ADR-001/006), indexes (incl. HNSW per ADR / VEC), and migrations
(`migration-discipline.md`). **Load the Phase-4 playbook** (`phase-playbooks.md` §"Phase 4"). The surfaces have already
enumerated the Phase-4 data-binding stubs — start by harvesting every "Phase 4 data binding notes" section (each surface
file has one) + each component's `DATA-` footer. **Net-new stores owed from Phase 3** (flagged across surfaces, none yet
schema'd): `config_audit_log` (append-only, key-prefix RLS — surface-01/01b) · `conversations`/`messages` chat store
(OD-135, surface-08) · `push_subscriptions` device-token store (surface-12) · `commands` user-defined-command store
(surface-10) · the agent-health metric store + execution-plan store (surface-09) · `notifications` net fields
(surface-07). Also resolve the historical `client_slug` question (already killed by ADR-001/OD-096 — confirm no app table
carries it). Run the standing verification gate at Phase-4's close as usual.

## Session 42 — 2026-07-01 — SURFACE-12 (MOBILE VIEW · `UI-MOBILE-*`, 6 sub-surfaces) DRAFTED, RESOLVED, GATE-CLEAN, SIGNED OFF — 13 of 14 surfaces done

**What happened:** Built `spec/03-surfaces/surface-12-mobile.md` — the thirteenth Phase-3 surface (14th file): the **mobile
view**, the cross-component mobile treatment the prior twelve surfaces each seamed here (every surface 00–11 carries a
"Mobile" note ending "Detailed mobile treatment: `surface-12-mobile.md`"). Grounded in the design-doc canonical
**"Dashboard 5 — Mobile view" (`design-doc-v4.md` L3266–3284)** — *"Purpose-built for action on the go. Not a scaled down
desktop… Deep system management stays on desktop."* — which names exactly **five mobile screens** (Home · Approval queue ·
Activity feed · Chat interface · Alerts) + the **push-notification contract**. Mobile is granted to **all six canonical
roles** (design-doc L538). Pattern-matched surfaces 00–11.

**Six sub-surfaces minted:** **`UI-MOBILE-HOME`** (the glance — health score FR-7.VIEW.002 non-technical rollup /
pending-approvals count / active-alerts count / quick-chat launcher) · **`UI-MOBILE-APPROVALS`** (the design-doc's
*"primary action surface — one-tap approve/reject"* — Approve/Reject + reason, **Modify degrades to desktop**; one of the
two Realtime surfaces, FR-6.APR.*/ESC.*, server-authoritative soft-run countdown) · **`UI-MOBILE-ACTIVITY`** (plain-English
`event_log` feed, the **answer-mode pill** on every AI output FR-4.CID.006 / AC-7.VIEW.002.2 — "mode unknown" never
silently "Cited") · **`UI-MOBILE-CHAT`** (`/` dispatch, each command node-gated FR-9.CMD.002, destructive-confirm-after-gate
FR-9.CMD.003.3, `event_log` fail-closed FR-9.CMD.004.3; async results via poll + nudge, **no third Realtime socket**
AC-7.RTP.001.3) · **`UI-MOBILE-COMMAND-MENU`** (the tap-optimised quick-tap buttons above the keyboard, FR-9.CMD.005 /
L3915 — most common node-permitted commands; **same node gate + C6 pipeline as typing `/slug`**, no shortcut bypass) ·
**`UI-MOBILE-ALERTS`** (the notification centre, filterable by severity, the **second Realtime surface** FR-7.RTP.001;
all 7 alert rules FR-7.ALR.002 + the two self-protective banners alert-engine-stalled/unroutable FR-7.ALR.008/009 +
Slack-independent durability FR-7.ALR.006). Plus a cross-cutting **push-notification contract** section (FR-7.VIEW.003:
critical **immediate** · hard-limit **immediate + always, non-suppressible** AC-7.VIEW.003.1 · pending/stale approvals
**configurable** via `approval_push_frequency_minutes`/`stale_queue_push_hours` AC-7.VIEW.003.2) and a cross-cutting
**out-of-scope-on-mobile** section (the deep-management set → desktop notice).

**The governing framing — the three non-negotiables on a phone:** **#2 no mobile back-door** — every approve/act/command
routes the **identical** C1 node gate + C6 pipeline as desktop (FR-9.MODE.003 no-bypass); Restricted needs the same
explicit audited reveal (FR-1.RST.003); and the deep-management / high-blast-radius set (config edit, permission-matrix
edit, conflict/consolidation resolution, approval **Modify**, fleet actions, agent-capability edit + plan rollback,
custom-command authoring, memory mutation) degrades to a *"open on a wider display"* **notice** — never a silent omission —
consolidating the reciprocal mobile note each of surfaces 01/02/03/04/06/09/10/11 already wrote. **#3 no false-healthy on a
phone** — freshness/last-updated badges + the honest Live/Reconnecting/Polling indicator (FR-7.RTP.004) + the two
protective banners are **mandatory on every mobile screen** (a stale "all-green"/"all caught up" on a phone is the single
most dangerous false-healthy view; empty states gated on a *confirmed-live* connection; every error reads "—"/"can't
confirm", never "0"/"all clear"/green). **#1 nothing lost** — a mobile "disable" (the one write mobile keeps) retains the
definition; a dropped push is never the sole record (the in-app notification centre persists it, FR-7.ALR.001/006).

**The clean PERM case — no entry node minted (third consecutive: 10, 11, 12).** Mobile is a **viewport treatment**, not a
new authority surface: each mobile screen inherits **exactly the same PERM node as its desktop counterpart**
(`PERM-action.review` for Approvals; `PERM-dashboard.workspace`/`.overview`/`.ops` for Home/Chat/Activity; per-command
FR-9.CMD.002; the Alerts/notification centre is **node-free clearance-scoped chrome**). Design-doc L538 grants all six
roles the mobile view; *what* each sees is their existing clearance + nodes. No catalog edit.

**4 ODs raised + resolved (surface-local; recommendations delegated, consistent with surfaces 05–11), logged OD-149–152:**
- **OD-149** 🔑 — sub-surface decomposition: **six** = the design-doc's five named screens + the tap-optimised command menu
  (its own FR-9.CMD.005); **push notifications is a cross-cutting delivery contract, not a 7th screen** (faithful to the
  design-doc's own L3277–3281 grouping).
- **OD-150** — delivery platform: **responsive web + PWA with web-push for v1** (installable; same auth/RLS/deployment —
  no per-silo app to provision); **native wrapper deferred → OOS-040**. The FR-7.VIEW.003 routing contract is
  platform-agnostic; the delivery *mechanism* is flagged paper-vs-proven (Phase-5 spike recommended, not minted).
- **OD-151** — navigation: **fixed bottom tab bar** (Home/Approvals/Chat/Activity/Alerts) + persistent bell + honest
  connection indicator + the two protective banners pinned; command menu = in-chat sheet; push settings = a Settings sheet
  (read-only reflection of the surface-01 config). One-handed target (L3284).
- **OD-152** — out-of-scope-on-mobile boundary: the deep-management set → a **notice** (never a silent omission); the
  low-risk writes (Approve/Reject, agent/command **disable**, verify/flag feedback, mark-actioned) stay, each on the
  identical C6/node path.

**Verification gate (independent zero-context subagent, checks a–f): CLEAN — 0 HIGH · 0 MED · 2 LOW (both reconciled).**
(a) Coverage PASS — the five design-doc screens + command menu all addressed; every cited FR/AC resolves + paraphrases
faithfully (FR-7.VIEW.003/RTP.001-004/ALR.001-009/VIEW.002.2, FR-9.CMD.001-005/SUG.004-005/MODE.003, FR-6.APR.001-003/
ESC.001-003, FR-4.CID.006, FR-1.RST.003/ROLE.001/PERM.007 — no fabrication, no invented AC). (b) CFG PASS — both push
keys real (`approval_push_frequency_minutes`=30 LIVE, `stale_queue_push_hours`=4 LIVE), read-only reflected, edited on
surface-01. (c) DATA PASS — no `client_slug`; the net-new stores correctly Phase-4-flagged (`conversations`/`messages`
OD-135; the new `push_subscriptions` device-token store owed to C7). (d) PERM PASS — no entry node minted; six roles; all
inherited nodes resolve in `PERMISSION_NODES.md`; all-six-roles matches L538. (e) #1/#2/#3 sweep PASS — no back-door, no
false-healthy, nothing lost (strong compliance; empty states gated on confirmed-live). (f) Seams PASS — the
out-of-scope-on-mobile table's attributions each match the reciprocal home-surface mobile note; no double-owned
capability. **LOW-1 (fixed):** the Home health-score tile cited FR-7.VIEW.001 (the *technical* ops FR) for the
"non-technical rollup" — re-cited to **FR-7.VIEW.002** (the Manager rollup, same source as surface-07 At-a-Glance), the
"C7 invents no signal" guarantee kept on AC-7.VIEW.001.1, underlying signals named as the VIEW.001 system-health panel.
**LOW-2 (accepted, no change):** "pinned banner" is surface-coined UI chrome — component-07 uses no "banner" wording;
rendering a fail-loud condition as a pinned banner is legitimate Phase-3 chrome naming that preserves the guarantee
(consistent with surface-05/07).

**Files changed:** `surface-12-mobile.md` (new); `open-decisions.md` (OD-149–152 🟢 + reserve pointer → OD-153);
`out-of-scope.md` (OOS-040 native wrapper deferred; pointer → OOS-041); `README.md` (Phase-3 row → 13 of 14 + surface-12
detail); `phase-playbooks.md` (status → 13 of 14). This log. **No `PERMISSION_NODES.md` change** (no node minted). **No
matrix change** — consistent with surfaces 00–11 (the six `UI-MOBILE-*` stubs are rendered; the served FRs are existing
C6/C7/C9/C4/C5 rows). **No new AF minted in Phase 3** (the push-delivery-reliability spike is *recommended* for Phase-5,
not minted — no Phase-3 FR rests on it; the surface fails safe to the persisted in-app record). **Phase-4 debt flagged
in-file:** the net-new **`push_subscriptions`** device-token store (RLS-scoped to user, no `client_slug`, owed to C7); the
`conversations`/`messages` chat store (OD-135) + `task_queue.originating_user_id` reused from surfaces 04/08; the
clearance-scoping RLS on the feed/queue/alerts/suggestions.

**Note (git):** a stop-hook fired mid-session and the draft + register updates were committed + pushed as a WIP commit
(honest message: gate still pending) before this finalization; the README/playbook status bump + this SESSION-LOG entry +
the LOW-1 fix land in the follow-up commit.

**Next step:** **`surface-01b-config-audit-log.md`** — the **final Phase-3 surface**: the config-change audit-log viewer
(`UI-config-audit-log`, minted by OD-099) that surface-01's per-section "View audit log →" links target. FR source: the
config-change audit trail (surface-01 references it; the underlying `event_log`/config-audit records, C7 LOG + the
`PERM-config.*` / `PERM-compliance.download_records` gates). Read-only viewer: who changed which knob, from→to, when, with
export. Load surface-01's audit-log references + the C7 LOG FRs + the config registry's audit expectations. Copy
`_TEMPLATE.md`; follow the Phase 3 playbook; run the gate before sign-off. **After surface-01b, Phase 3 is complete →
Phase 4 (Data model).**

---

## Session 41 — 2026-07-01 — SURFACE-11 (MEMORY NAVIGATION / ENTITY BROWSER · `UI-MEMORY-NAV`) DRAFTED, RESOLVED, GATE-CLEAN, SIGNED OFF + 3 OWED CATALOG NODES CLOSED — 12 of 14 surfaces done

**What happened:** Built `spec/03-surfaces/surface-11-memory-nav.md` — the twelfth Phase-3 surface: the **memory
navigation / entity browser** of one client deployment, fed by **C2 (Memory)**. Minted **`UI-MEMORY-NAV`** (C2 references
"entity browser", "entity detail", "memory detail view", and the dual keyword+vector search by description —
FR-2.ENT.001/003/004, FR-2.MEM.002, FR-2.RET.002 — but assigns no `UI-` id). This is the **read/browse** counterpart to
surface-03's memory-*review* queues: surface-03 gates the **write path**, surface-11 navigates **what is stored**.
Pattern-matched surfaces 00–10.

**Four sections in two playbook buckets:** **A — Entity Browser** (the entity-organised spine FR-2.ENT.001 — one card per
cleared entity, type-filtered FR-2.ENT.002, Maturity % + `[Building]` marker FR-2.MAT.002/003, a duplicate-cluster flag
for the fragmentation/AF-082 risk FR-2.ENT.005/MNT.010; Internal Org distinguished + walled FR-2.ENT.003) · **B — Entity
Detail** (one entity's memories grouped by type FR-2.MEM.001 + filled/empty knowledge slots FR-2.MAT.001 + `external_refs`
pointers FR-2.ENT.004) · **C — Memory Detail** (one row in full FR-2.MEM.002 — content, provenance source/source_ref,
confidence + lifecycle FR-2.MNT.001, visibility×sensitivity tags FR-2.TAG, the **drillable supersede/summary chain**
FR-2.MNT.006/007 nothing overwritten) · **D — Memory Search** (the dual keyword+vector search FR-2.RET.002, **clearance
filter runs BEFORE ranking** FR-2.RET.004 — never shown-then-hidden).

**The governing framing:** surface-11 is the **human window into the three memory non-negotiables** — **#1** integrity
made *visible* (drillable supersede chains nothing overwritten MNT.007; a fragmented entity visible + mergeable
ENT.005/AF-082; audited erasure cascade MNT.017) · **#2** clearance/visibility/Restricted enforced **before display**
everywhere (RET.004, never ranked-then-stripped — a leak vector), Restricted **never auto-shown** (explicit+audited reveal
only, RST.003), Internal Org walled from client-facing agents (ENT.003), every human edit routes through the **sole
writer** (ADR-004 — never a direct `UPDATE`) · **#3** embed-failed memories were never stored so can't appear as a silent
partial (WRT.007), low-confidence/contradicted memories shown *with state* not silently trusted (MNT.001), a failed/stale
load reads "—" never a false-empty brain.

**The clean PERM case — no entry node minted.** Memory *read* authority **is** the C1 clearance/visibility model applied
at the row (FR-2.RET.004 / FR-1.RLS.003), the same model that decides what retrieval injects into any task — introducing a
browse node would make this the *only* node-gated memory-read path, an inconsistency. Entry is any authenticated user; the
row filter shows each user exactly their cleared subset; Restricted never auto-shown. Every **mutation** stays node-gated
(`PERM-memory.write` writer-routed / `PERM-memory.delete`; conflict/consolidation decisions route to surface-03). Second
consecutive no-mint surface (like surface-10).

**4 ODs raised + resolved (recommendations delegated), logged OD-145–148:**
- **OD-145** 🔑 **#2 read authority (clean, no node).** No new `PERM-memory.browse` — entry is clearance-scoped at the row
  (above); mutations node-gated.
- **OD-146** — layout: Entity Browser grid landing + detail drawer + Memory Detail + persistent Memory Search bar
  (consistent with surface-06/09).
- **OD-147** — entity-type + expected-slot **config** is edited on surface-01 (`PERM-config.*`); surface-11 reflects it
  read-only + links out (keeps surface-11 a browser, DRY config home).
- **OD-148** 🔑 **#2/#1 sole-writer edit model.** Read-first: verify/flag = a logged feedback signal (MNT.016); a content
  correction routes *through* the sole-writer validate-and-commit (WRT.006), never a direct `UPDATE` (ADR-004).

**CATALOG HOUSEKEEPING — the 3 long-owed nodes CLOSED (separate from surface-11's ODs).** The nodes flagged "owed" in
`PERMISSION_NODES.md` since surfaces 03/04 — `PERM-memory.review_conflict` + `PERM-memory.approve_consolidation`
(surface-03 / OD-115, into the **C2 — Memory** section) and `PERM-action.review` (surface-04 / OD-117, into a **new
Approval Authority** section under FR-1.PERM.007) — were **transcribed into the catalog** with their full 4-field defs
(matching `open-decisions.md` verbatim). Catalog **48→51**; the "⚠️ Owed to this catalog" block flipped to "✅ CLOSED".
surface-11 is in the Memory neighborhood, the natural point the session-40 handoff named for this.

**Verification gate (independent zero-context subagent, checks a–f): CLEAN — 0 HIGH · 0 MED · 2 LOW (both benign).**
(a) Coverage PASS — every cited C2 FR/AC (MEM/ENT/TAG/RET/MNT/MAT) resolves + paraphrases faithfully; no invented AC; no
over-claim (pill → C4/C8, ingestion → surface-03, agent-actions → surface-04 seamed out; never writes memory directly).
(b) CFG PASS — all four keys real, read-only (edited surface-01), `cold_start_full_threshold` = 80% verified. (c) DATA
PASS — no `client_slug`; read is row-level clearance RLS, no `service_role` browse; MEM.002/ENT.004 field lists match.
(d) PERM PASS — no entry node minted; the 3 transcribed nodes present with 4-field defs matching open-decisions.md; count
51, owed-debt CLOSED; six roles, no role-string gates. (e) #1/#2/#3 sweep PASS — clearance/Restricted enforced *before*
display everywhere (no shown-then-hidden leak); Restricted explicit+audited; Internal Org walled; supersede chains
drillable/retained; failed load never an empty brain; every edit sole-writer-routed. (f) Seams PASS. **LOW-1 (not a
surface defect — the surface was MORE correct than its source):** the surface's duplicate-cluster cite `FR-2.MNT.010` is
right; **the C2 component's own L219 prose mis-cited it as `FR-2.MNT.011`** (structural vs relevance erosion) — **the stale
C2 cross-ref was corrected this session** (anti-hallucination reference-verify). **LOW-2:** the gate banner's "pending"
placeholder replaced with the PASS result.

**Files changed:** `surface-11-memory-nav.md` (new); `PERMISSION_NODES.md` (+2 Memory nodes / +1 Approval Authority
section+node / Status count 48→51 / owed-block → CLOSED); `component-02-memory.md` (FR-2.ENT.005 L219 stale cross-ref
MNT.011→MNT.010); `open-decisions.md` (OD-145–148 🟢 + reserve pointer → OD-149); `README.md` (Phase-3 row → 12 of 14 +
surface-11 detail); `phase-playbooks.md` (status → 12 of 14). This log. **No matrix change** — consistent with surfaces
00–10 (the `UI-MEMORY-NAV` stub is rendered; served FRs are existing C2 rows; the 3 transcribed PERM nodes are catalog
additions, not FR rows). **No new OOS / AF** (AF-067 latency + AF-082 fragmentation are existing, cited not minted).
**Phase-4 debts flagged in-file:** the clearance-scoped browse read-path (`DATA-memories` / `DATA-entities`, RLS-gated, no
`service_role` browse, no `client_slug`), the expected-slots fill-state derivation, the `access_audit` write on
Confidential/Restricted/Internal-Org view, and the sole-writer submit path for human corrections. **Catalog housekeeping:
now fully current** — no node owed-but-untranscribed as of this session.

**Next step:** **`surface-12-mobile.md`** — the **mobile surfaces** (6 sub-surfaces). FR source is cross-component: the
mobile treatments the prior surfaces each seamed here — the **mobile command menu** (C9 FR-9.CMD.005, tap-optimised quick
commands, distinct from surface-10's *management*), mobile chat/approvals/notifications (surfaces 04/07/08), the
read-mostly mobile degrades noted on surfaces 09/10/11. Load the per-surface "Mobile" sections already written
(00–11 each carry one) + FR-9.CMD.005 + the C7 RTP realtime contract (the two Realtime surfaces on mobile). The **one
remaining after that is `surface-01b-config-audit-log.md`** (`UI-config-audit-log`, OD-099 — the config-change audit-log
viewer surface-01's "View audit log →" links to). Copy `_TEMPLATE.md`; follow the Phase 3 playbook; run the gate before
sign-off. **After surface-12 + surface-01b, Phase 3 is complete → Phase 4 (Data model).**

---

## Session 40 — 2026-07-01 — SURFACE-10 (CUSTOM COMMAND MANAGEMENT · `UI-COMMANDS`) DRAFTED, RESOLVED, GATE-CLEAN, SIGNED OFF — 11 of 14 surfaces done

**What happened:** Built `spec/03-surfaces/surface-10-commands.md` — the eleventh Phase-3 surface: the **custom-command
management console** of one client deployment, fed by **C9 (Proactive Intelligence)**. Surface ID **`UI-COMMANDS`** is
**named by the FRs, not minted here** — FR-9.CMD.006 already assigns it ("Custom commands are created, edited, and deleted
via `UI-COMMANDS`"), unlike surfaces 04–09 which each minted their own `UI-` id. FR source: the custom-command CRUD
(FR-9.CMD.006–008) framed inside the broader `/` dispatch contract (FR-9.CMD.001–005). Pattern-matched surfaces 00–09.

**Three sections in two playbook buckets:** **A — Custom Commands** (the `commands` list landing — one row per
user-defined command: slug / assigned agent / invocation node / active-state; an **inactive** command whose agent was
disabled reads "unavailable", never a silent no-op, AC-9.CMD.006.3) · **B — Command Builder** (the definition editor —
slug **collision-checked against all system slugs** AC-9.CMD.006.2 and **never silently renamed**; a `$ARGUMENTS` prompt
template; a **required assigned agent** from the C8 registry; an invocation-node picker that is **default-deny** if unmapped
AC-9.CMD.002.3) · **C — System-Command Reference** (the read-only reserved-slug namespace grouped by home component —
system commands are **code-registered, not data**; `/tune` *values* edit on surface-01). Commands are **invoked on
surface-08** (chat, inline answer-mode pill, FR-9.CMD.008); this surface only *defines* them.

**The clean PERM case — no node minted.** The two nodes this surface needs — `PERM-commands.manage` (entry + CRUD, Super
Admin + Admin) and `PERM-system.tune` (referenced on the reference tab) — are **already catalogued** (C9 "Proactive /
Commands" section, `PERMISSION_NODES.md` L89–90). Unlike surfaces 03/04/06/07/08/09, each of which surfaced a Rule-0
catalog gap and minted node(s), surface-10 needed **no mint** and **no catalog edit**.

**4 ODs raised + resolved (recommendations delegated, consistent with surfaces 05–09), logged OD-141–144:**
- **OD-141** — layout: custom-command list landing + Command Builder drawer + a collapsible read-only System-Command
  Reference section (consistent with surface-09 OD-138 / surface-06 OD-126).
- **OD-142** 🔑 **#2 least-privilege (pushed to the FR layer).** The FR text (default-deny unmapped node, AC-9.CMD.002.3)
  did **not** stop a manager from gating a powerful custom command on a broadly-held node to **widen its audience past
  their own authority** over the wrapped agent/capability — a real #2 surface-area gap (bounded by the invocation's C6
  pipeline + the agent's scope/clearance, but real). Resolved: a manager may only assign a node they're authorized to
  assign; a wider save is rejected at write.
- **OD-143** 🔑 **#2 containment (pushed to the FR layer).** A custom command's destructiveness/approval is governed by
  the underlying action's **C6 tier**, not a definition-time flag the author can clear — every invocation runs the same
  C6 guardrail pipeline (FR-9.CMD.008); an author may **add** a UI confirm but never **remove** a guardrail.
- **OD-144** — system-command reference: read-only, grouped by home component, reserved-slug badges (proactive complement
  to the authoritative save-time collision check); not hidden (surprise rejections), not editable (code, not data).

**Verification gate (independent zero-context subagent, checks a–f): CLEAN — 0 HIGH · 1 MED · 2 LOW (all reconciled).**
(a) Coverage PASS — every FR-9.CMD.001–008 + AC cited resolves and paraphrases faithfully (the gate re-read the CMD
section L832–1063 and matched each AC verbatim); invocation/agent-definition/config all correctly seamed out
(surface-08/09/01), no over-claim. (b) CFG PASS — the CMD FRs declare no config keys. (c) DATA PASS — no `client_slug` on
any binding; the `commands` store correctly NET-NEW Phase-4, user-defined-only (system commands code-registered).
(d) PERM PASS — both nodes catalogued with the claimed roles/scope; no node minted; no role-string gates ("Agency Owner"
only as an explicitly-not-a-role reference); six canonical roles used. (e) #1/#2/#3 sweep PASS — no false-healthy state
(error never reads empty/healthy; collision is loud; disabled-agent = "unavailable"; unmapped node = default-deny; no C6
outrun; no audience-widening past authority). (f) Seams PASS. **Reconciled: MED-1** — OD-141–144 transcribed into the
central `open-decisions.md` (the Rule-0 register-sync; pointer bumped to OD-145). **LOW-1** — catalog line-cite tightened
`L86–90`→`L89–90` (2 sites). **LOW-2** — OD-142/143 **pushed into C9 via change-control** as **AC-9.CMD.006.4**
(author-authority on the invocation gate) + **AC-9.CMD.008.4** (a definition can never lower the C6 tier), with a
change-control addendum on the C9 header — so the two #2 constraints live in the requirement layer, not only this surface
(mirrors surface-04 OD-120→AC-6.APR.003.3).

**Files changed:** `surface-10-commands.md` (new); `component-09-proactive.md` (+AC-9.CMD.006.4 / +AC-9.CMD.008.4 +
header change-control addendum); `open-decisions.md` (OD-141–144 🟢 + reserve pointer → OD-145); `README.md` (Phase-3 row
→ 11 of 14 + surface-10 detail); `phase-playbooks.md` (status → 11 of 14). This log. **No `PERMISSION_NODES.md` change**
(no node minted). **No matrix change** — consistent with surfaces 00–09 (the `UI-COMMANDS` stub is rendered; served FRs
are existing C9 rows; the two new ACs tighten Approved FRs, not new rows). **No new OOS / AF.** **Phase-4 debt flagged
in-file:** the net-new **`commands` store** (user-defined only; system commands stay code-registered; no `client_slug`;
`active` auto-flips on assigned-agent disable — trigger/reconcile pass) owed to C9/C5. **Catalog housekeeping still owed
(unchanged):** the 3 flagged surface-03/04 nodes (OD-115 ×2, OD-117 ×1) remain to be transcribed when those surfaces are
next touched; surface-10 does not touch them.

**Next step:** `surface-11-memory-nav.md` — the **memory navigation / entity browser** surface. FR source: **C2 (Memory)**
— the entity-organised business brain (FR-2.ENT.* entity types, FR-2.RET.* retrieval, FR-2.MNT.* maintenance signals, the
`[Building]` coverage flag ADR-002, clearance/visibility/Restricted scoping FR-2.RET.004 enforced **before** ranking). This
is the **read/browse** counterpart to surface-03's memory-*review* queues: surface-03 gates the write path, surface-11
navigates what's stored (entities, relationships, provenance, sensitivity tiers). Carry-in: **ADR-004** (sole-writer — the
browser is read-only; any edit routes through the Memory Agent), **C1 clearance** (Restricted never auto-shown, never
auto-injected), no `client_slug`, the answer-mode-pill seam where AI-derived context is shown. Check `PERMISSION_NODES.md`
for the Memory-Access nodes (incl. the two OD-115 conflict/consolidation nodes still owed to the catalog — surface-11 is a
natural place to transcribe them if it touches Memory Access). Copy `_TEMPLATE.md`; load only the C2 retrieval/entity FRs;
follow the Phase 3 playbook; run the gate before sign-off.

---

## Session 39 — 2026-07-01 — SURFACE-09 (AGENT FLEET · AGENT BUILDER · ORCHESTRATION) DRAFTED, RESOLVED, GATE-CLEAN-WITH-FIXES, SIGNED OFF — 10 of 14 surfaces done

**What happened:** Built `spec/03-surfaces/surface-09-agent-builder.md` — the tenth Phase-3 surface: the **agent-management
console** of one client deployment, fed by **C8 (Agent Design)**. Minted **`UI-AGENT-BUILDER`** (C8 names "registry
editor", "version history", and the routing/plan-version views by description — FR-8.REG.001/003/004, FR-8.PLAN.004 — but
assigns no formal `UI-` id). Pattern-matched surfaces 00–08. **Five sections in the three playbook buckets:** **Agent
Fleet** (A — the data-driven `agents` roster grid + per-agent health/drift/dead-agent **badges**) · **Agent Builder**
(B — the per-agent definition editor) + **Version History** (C — the immutable trail) · **Orchestration & Routing** (D —
the orchestrator-as-registry-agent ORC.008 + the routing-config **read-only readout**) + **Execution Plans** (E —
versioned plans + human-only rollback PLAN.004).

**The governing framing:** surface-09 is the **act-on counterpart to surface-05's self-improvement panel** — surface-05
*flags* (a drifting agent, a dead agent, a consistently-rerouted task type), surface-09 is where a human *edits the
description, narrows the scope, or rolls back a plan*, because in C8 **the fix for mis-routing is data, never code**
(AC-8.ORC.003.1). The seam was verified both ways (surface-05 owns the full panel + points back to surface-09; this
surface shows badges + links out — no double-ownership). Cardinal-sin defenses encoded: the **hard-limit invariants are
rejected AT WRITE** (Comms never-sends AC-8.SPC.003.3, Finance never-transacts AC-8.SPC.004.3, only the Memory Agent holds
memory-write AC-8.SPC.005.2 / ADR-004 — a code-level deny, not a mere audit, #2); capability edits Super-Admin-only (#2);
drift/dead-agent **flag-never-auto-correct** (OD-078, #3); a **stalled health producer reads "stale" not green**
(AC-8.HLTH.004.2, #3); **immutable versioned history with a mandatory `change_reason`** (FR-8.REG.004, #1); human-only
plan rollback (OOS-030, #1); **no `client_slug` column** (AC-8.REG.001.3).

**4 ODs raised + resolved (operator: "I trust your recommendations, what's needed" — delegated), logged OD-137–140:**
- **OD-137** 🔑 **Rule-0 PERM gap (change-control mint).** FR-1.PERM.007's **Asset Management** category names the
  design-doc seed row **"Create / edit agents" (Super Admin + Admin, L509–615)**, but **no concrete `PERM-agents.*` node
  was ever catalogued** (the catalog had no Asset Management section). The locked **OD-080 (C8)** further splits that
  coarse row into two authority tiers. **Minted the `PERM-agents.*` family via change-control** under the **already-homed**
  Asset Management category (no new category, no ADR supersede — mirrors OD-117/OD-125/OD-129/OD-133), scope
  **intra-client**, encoding OD-080 exactly: **`PERM-agents.view`** + **`PERM-agents.edit_description`** (description /
  tuning / plan-rollback — Super Admin + Admin) + **`PERM-agents.edit_capability`** (memory scope / tools / enabled / add
  / disable — **Super Admin only**, *tighter* than the design-doc's coarse SA+Admin — a #2 authority decision).
  **Transcribed into `PERMISSION_NODES.md` immediately** (new Asset Management section; catalog 45→48).
- **OD-138** — layout: fleet-grid landing + per-agent Builder drawer (with a Version History tab) + an Orchestration
  section via section nav (consistent with surface-06's grid-landing + detail-drawer, OD-126).
- **OD-139** — edit-gating + change-reason UX: one Builder, inline split (capability fields **read-only/locked for an
  Admin** with a "Super-Admin-only" affordance — transparency over hiding, #3); every Save opens a **mandatory
  `change_reason` modal** (REG.004 — no version without a reason).
- **OD-140** — hard-limit invariant presentation: **show + explain + block** (the forbidden tool appears greyed with an
  inline reason; any grant attempt is **rejected at write** with the reason logged) — the Builder's defense-in-depth
  layer alongside the missing tool (C3) + the code enforcement (C6).

**Verification gate (independent zero-context subagent, checks a–f): CLEAN-WITH-FIXES — 1 HIGH (already-resolved) · 0 MED
· 2 LOW (all reconciled).** (a) Coverage PASS — owns all eight C8 areas, does **not** double-own surface-05's
self-improvement panel (badges + link-out only; surface-05 reciprocally points back). (b) CFG PASS — all 10 keys match
the registry default/class/anchor/PERM verbatim. (c) DATA PASS — no `client_slug` on any binding; both net-new Phase-4
stores flagged; `agents` columns match FR-8.REG.001 (no `system_prompt`, OD-075). (d) PERM PASS — OD-080 split encoded
exactly across the three nodes; mint under the existing Asset Management category (FR-1.PERM.007 confirmed to carry it;
design-doc L509–615 confirms the row). (e) #1/#2/#3 sweep PASS — false-healthy refused everywhere; hard-limit containment
enforced **at write** for all three invariants; drift/dead-agent flag-never-auto-correct; plan rollback human-only.
(f) Seams PASS (execution → C5; config knobs → surface-01 #agents; Layer-1 prompt → C4 `PERM-prompt.*`; self-improvement
panel + routing trends → surface-05; tool registry → C3 `PERM-tool.manage`). **Fixes:** **F1 (HIGH, dangling-ID)** — the
gate read `PERMISSION_NODES.md` *before* the transcription edit landed (it ran concurrently); **verified the three
`PERM-agents.*` nodes ARE present** (Asset Management section, count 45→48) — resolved, not a real gap. **F3 (LOW)** — the
Model field was bound to a non-existent `agents.model` column (FR-8.REG.001 defines none); corrected to a **read-only
config-derived display** (model selected by complexity per FR-8.COST.001; a per-agent override would be a net-new Phase-4
field, not asserted). **F2 (LOW)** — count-baseline note, no contradiction (45→48 on the right baseline; the 3 owed
surface-03/04 nodes remain separately owed).

**Files changed:** `surface-09-agent-builder.md` (new); `PERMISSION_NODES.md` (+Asset Management section / 3 `PERM-agents.*`
nodes / count 45→48); `open-decisions.md` (OD-137–140 🟢 + node defs; reserved-block + pointer → OD-141); `README.md`
(Phase-3 row → 10 of 14 + surface-09 detail); `phase-playbooks.md` (status → 10 of 14). This log.

**No matrix change** — consistent with surfaces 00–08 (the `UI-AGENT-BUILDER` stub is rendered; the served FRs are
existing C8 rows; the `PERM-agents.*` nodes are catalog additions, not FR rows). **No new OOS / AF** (all cited AFs are
existing block-S AFs). **Phase-4 debts flagged in-file:** the **net-new execution-plan store** (PLAN.004 versioned plans,
owed to C8/C5), the **net-new agent-health metric store** (HLTH.001–003 + producer heartbeat), a **per-agent `model`
column** *if* per-agent model override is wanted (not asserted — net-new), the registry version-chain index, and the
service_role-managed registry-edit authorization path (the OD-137 nodes, human-path). **Catalog housekeeping still owed
(unchanged):** the 3 flagged surface-03/04 nodes (OD-115 ×2, OD-117 ×1) remain to be transcribed when those surfaces are
next touched.

**Next step:** `surface-10-commands.md` — the **custom-command management** surface (`UI-COMMANDS`). FR source: **C9
(Proactive Intelligence)** — the custom-command CRUD FR-9.CMD.006–008 (define/manage custom `/` commands; `$ARGUMENTS`
substitution; node-set-at-definition; disabled-agent handling) + the broader `/` command dispatch contract FR-9.CMD.001–005
(each command node-gated FR-9.CMD.002, destructive-confirm FR-9.CMD.003, `event_log` fail-closed FR-9.CMD.004). The
commands are **invoked** on surface-08 (the chat) but **managed** here. Carry-in: `PERM-commands.manage` (the existing C9
catalog node, Super Admin + Admin) + `PERM-system.tune` (the `/tune` system-command node); the six canonical C1 roles;
the answer-mode-pill seam (C4 FR-4.CID.006, every command output carries it). Copy `_TEMPLATE.md`; load only the C9 CMD
FRs; follow the Phase 3 playbook; run the gate before sign-off.

---

## Session 38 — 2026-07-01 — SURFACE-08 (STANDARD USER DASHBOARD: CHAT · MY QUEUE · ACTIVITY FEED) DRAFTED, RESOLVED, GATE-CLEAN-WITH-FIXES, SIGNED OFF — 9 of 14 surfaces done

**What happened:** Built `spec/03-surfaces/surface-08-dashboard-user.md` — the ninth Phase-3 surface: the **everyday
user's home**, the Standard User role view (and every role's personal workspace). Minted **`UI-DASHBOARD-USER`**
(FR-7.VIEW.002 names the Standard User view as one of five RBAC-gated role surfaces but assigns no `UI-` id). Grounded in
the **design-doc canonical** (`design-doc-v4.md` L3256–3262, "Dashboard 4 — Standard user view") which names exactly
three panels — **My queue · Activity feed · Chat interface** — plus the two FR-mandated carry-ins (notification centre +
proactive suggestions). The planning-doc "My Workspace / Inbox / Decisions / chat" labels map onto these (My
Workspace=the chat surface; Inbox=notification centre + suggestions; Decisions=My Queue) — design-doc is the authority,
mirroring how surfaces 07–09 dissolved planning-doc role labels. Pattern-matched surfaces 00–07.

**Five sections:** **A — Notification Centre** (cross-cutting chrome, **home-specced on surface-07** — rides here
clearance-scoped, the one Realtime element, FR-7.ALR.001 / FR-7.RTP.001) · **B — Chat interface** (the heart: the `/`
command dispatch FR-9.CMD.001–008, each command **node-gated on its own C1 node** FR-9.CMD.002 not entry, destructive
commands confirm **after** the node gate FR-9.CMD.003.3, `event_log` write **fails closed** FR-9.CMD.004.3, custom
commands return **inline with no `task_queue` row** FR-9.CMD.008; every AI output carries the **answer-mode pill** C4
FR-4.CID.006 / AC-7.VIEW.002.2 — surface-08 is the *other* canonical pill home) · **C — My Queue** (C5 `task_queue`
filtered to this user via `originating_user_id`; the decision UI for a held item is surface-04) · **D — Activity Feed**
(C7 `event_log`, clearance+relevance scoped, pill on every row) · **E — Proactive Suggestions** (C9 FR-9.SUG.004
delivered to the user, act-through-C6 FR-9.MODE.003, dismissal safety-floor FR-9.SUG.005, cold-start "learning"
suppression FR-9.CST.002).

**KEY ARCHITECTURAL CALL — the chat has no data store yet (OD-135).** The spec defines **no `chat_messages`/
`conversations` table**; the chat is currently a rendering surface over `task_queue` + `event_log` + command results.
Resolved: **persist the thread** (a **net-new Phase-4 `conversations`+`messages` store**, RLS-scoped, no `client_slug`)
because losing a user's interaction history on reload is a **#1 violation** — flagged as a Phase-4 obligation owed to
C5/C9, **not invented as an FR** (Rule 0). And because FR-7.RTP.001 caps Realtime at **exactly two surfaces** (approval
queue + notification centre), an **async task result returns to chat on poll + a notification-centre nudge — no third
Realtime socket** (AC-7.RTP.001.3).

**4 ODs raised + resolved (operator: "Cool do it" — recommendations delegated), logged OD-133–136:**
- **OD-133** 🔑 **Rule-0 PERM gap (change-control mint), anticipated by surface-07.** OD-129 explicitly named a third,
  not-yet-minted "surface-08's standard-user node." Minted **`PERM-dashboard.workspace`** (default: **all six roles** —
  every authenticated user has a personal workspace; per-`/`-command authority stays finer, FR-9.CMD.002), scope
  intra-client, under the already-homed FR-1.PERM.007 "Dashboard Access" category — completing the family
  (`overview`/`ops`/`workspace`). **Transcribed into `PERMISSION_NODES.md` immediately** (catalog 44→45).
- **OD-134** — layout: chat-led main view + adjacent collapsible panels + persistent notification bell + the two
  always-loud banners pinned (consistent with surface-07 OD-130).
- **OD-135** — chat persistence + async-result path (above).
- **OD-136** — proactive suggestions across all three FR-9.SUG.004 delivery surfaces (dedicated panel + notification
  nudge + inline-in-chat), dismissal safety-floor preserved everywhere, every "act" through C6.

**Verification gate (independent zero-context subagent, checks a–f): CLEAN-WITH-FIXES — 2 HIGH · 2 MED · 1 LOW (all
reconciled).** Coverage (every cited C7/C9/C5/C4 FR/AC verified verbatim — incl. the three scrutiny points:
AC-7.VIEW.002.2 pill-on-every-chat-output, AC-7.RTP.001.3 only-two-Realtime, AC-9.CMD.008.3 no-`task_queue`-on-custom-command,
all hold), CFG wiring (all 4 keys exist with claimed default/class), DATA (no `client_slug` on any binding; the chat
store + `originating_user_id` correctly flagged net-new, not asserted-existing), PERM (no role-string gates anywhere;
FR-9.CMD.002 node-gating correct; the `PERM-dashboard.*` family + FR-1.PERM.007 category verified), the **#1/#2/#3
false-healthy sweep — NO HOLE** (every error/stale state shows "—" not "0", an empty thread never reads "no history", a
blank feed never "nothing happened", an unresolvable pill reads "mode unknown" never "Cited"; a `/` command routes
through its node gate **and** C6, a proactive "act" through C6 — chat is no back-door), and seams (notification centre→
surface-07, decision UI→surface-04, command management→surface-10, config edit→surface-01, trace→surface-05, pill
definition→C4) all **PASS**. **Fixes applied:** **H1** — OD-133–136 transcribed into the central `open-decisions.md`
(pointer advanced to OD-137); **H2** — `PERM-dashboard.workspace` transcribed into `PERMISSION_NODES.md` (44→45); **M1**
— `PERM-action.review` annotated OD-117-owed-to-catalog at its reference; **M2** — unpermitted-hidden re-cited to
AC-9.CMD.007.1 + FR-9.CMD.002 (.007.2 covers *inactive* only); **L1** — connection-prioritisation re-cited to the
FR-7.RTP.003 body (+AC-7.RTP.003.1/.2). *(H1/H2 were the register-transcription steps; the surface had asserted them as
done before the central files were patched — the gate correctly caught the dangling-ID window.)*

**Files changed:** `surface-08-dashboard-user.md` (new); `PERMISSION_NODES.md` (+`PERM-dashboard.workspace` / count
44→45); `open-decisions.md` (OD-133–136 🟢 + node def; reserved-block + pointer → OD-137); `README.md` (Phase-3 row → 9
of 14 + surface-08 detail); `phase-playbooks.md` (status → 9 of 14). This log.

**No matrix change** — consistent with surfaces 00–07 (the `UI-` stub is rendered; the served FRs are existing
C7/C9/C5/C4 rows; `PERM-dashboard.workspace` is a catalog addition, not an FR row). **No new OOS / AF.** **Phase-4 debts
flagged in-file:** the **net-new `conversations`/`messages` chat store** (OD-135, owed to C5/C9 — the one genuinely-new
schema obligation this surface raises); `task_queue.originating_user_id` (the per-user filter, already flagged on
surface-04); the relevance-scoping index on `event_log`; the clearance-scoping RLS policies (ADR-006) for the thread /
queue / feed / suggestions / notification centre. **Catalog housekeeping still owed (unchanged):** the 3 flagged
surface-03/04 nodes (OD-115 ×2, OD-117 ×1) remain to be transcribed when those surfaces are next touched.

**Next step:** `surface-09-agent-builder.md` — the **Agent Fleet + Agent Builder / specialist config + Orchestration**
surface. FR source: **C8 (Agent Design)** — the orchestrator + 7-step routing (FR-8.ORC.*), the `agents` registry
(data-driven, versioned; `system_prompt`→`prompt_layers`, FR-8.REG.*), the 8 specialist definitions + their hard limits
(FR-8.SPC.*), per-agent memory scoping (FR-8.SCO.*), agent-health/drift metric production (FR-8.HLTH.*), orchestrator
learning + result caching (FR-8.LRN.*), cost-routing (FR-8.COST.*). Carry-in: **C4** (the `prompt_layers` content this
surface edits is C4-owned — LYR/CID/BIZ/INJ/TSK/PRIN/STO; agent config binds to it), **ADR-004** (Memory = sole writer
identity; Comms never-sends / Finance never-transacts hard limits), the `PERM-agents.*` / `PERM-system.*` gates (check
`PERMISSION_NODES.md` — an agent-management node may need minting, raise as an OD if so), the six canonical C1 roles.
Copy `_TEMPLATE.md`; load only the C8 FRs (+ the C4 prompt-layer seam); follow the Phase 3 playbook; run the gate before
sign-off.

---

## Session 37 — 2026-07-01 — SURFACE-07 (AGENCY / MANAGER DASHBOARD + NOTIFICATION CENTRE) DRAFTED, RESOLVED, GATE-CLEAN-WITH-FIXES, SIGNED OFF — 8 of 14 surfaces done

**What happened:** Built `spec/03-surfaces/surface-07-dashboard-agency.md` — the eighth Phase-3 surface: the
**non-technical leadership view** of one client deployment (the business-activity counterpart to surface-05's technical
ops dashboard) **plus the notification centre**. **Two surface IDs minted here:** **`UI-DASHBOARD-AGENCY`** (FR-7.VIEW.002
names five role surfaces incl. the **Manager (non-technical)** view but assigns no `UI-` id) and **`UI-NOTIFICATION-CENTRE`**
(the **second of exactly two Realtime/WebSocket surfaces** per FR-7.RTP.001 — the other is surface-04's approval queue —
named in FR-7.ALR.001 but never given a `UI-` id). Pattern-matched surfaces 00–06.

**Role mapping (the planning-doc trap, dissolved):** "Agency Owner" → **Super Admin**, "Manager" → **Admin /
Account Manager**; there is **no** "Agency Owner"/"Manager" C1 role. The Access table uses only the six canonical roles
(FR-1.ROLE.001) — mirrors how C7/C8/C9 dissolved the non-existent "Agency Owner" role (C9 OD-086). Default entrants:
Super Admin, Admin, Account Manager (the AM is the primary day-to-day user — their clients' activity + suggestions).

**Four sections:** **A — Notification Centre** (`UI-NOTIFICATION-CENTRE`, the one **Realtime** element; all 7 alert
rules FR-7.ALR.002 incl. the non-suppressible hard-limit AC-7.ALR.002.2; the two self-protective pinned banners —
alert-engine-stalled AC-7.ALR.008.2 + alert-delivery-misconfigured AC-7.ALR.009.1; Slack-independent durability
FR-7.ALR.006; honest Live/Reconnecting/Polling FR-7.RTP.004 with **re-fetch on reconnect**; prioritised for the live
connection under budget FR-7.RTP.003) · **B — At-a-Glance** (non-technical management rollup; **C7 invents no signal**
AC-7.VIEW.001.1; polls health 30s) · **C — Activity Feed** (a **canonical home of the answer-mode pill** Cited/Inferred/
Unknown C4 FR-4.CID.006 / AC-7.VIEW.002.2 — an unresolved pill reads **"mode unknown", never silently "Cited"**; the C2
thin-coverage *threshold* is seamed to C2, not owned here; polls event-log 60s) · **D — Proactive Suggestions** (C9
delivery FR-9.SUG.004; every "act" routes through the **identical C6 path** FR-9.MODE.003, floored rows never auto-act
FR-9.MODE.002; dismissal safety-floor FR-9.SUG.005 / AC-9.PRO.004.2/.4).

**KEY DESIGN CALL — the notification centre is cross-cutting chrome, not a surface-07-exclusive panel** (OD-131): FR-7.ALR.001
makes it "primary, persistent, **accessible from every view**", so it rides **every** dashboard (surface-05/07/08) as a
bell + slide-over, **clearance-scoped per viewer** (a Standard User gets it on surface-08). Home-specced here; **node-free**
(rides any Dashboard Access node — see OD-129). This is why it gets its own `UI-` id but is rendered everywhere.

**4 ODs raised + resolved (operator: "take all four recommendations"), logged OD-129–132:**
- **OD-129** 🔑 **Rule-0 PERM gap (change-control mint).** FR-1.PERM.007 **homes** the twelve permission categories
  incl. **Dashboard Access**, but **no concrete `PERM-dashboard.*` node id was ever catalogued**. surface-05 (signed
  off) already references a Dashboard-Access "ops" node (working name `PERM-dashboard.view_ops`) absent from the catalog
  — a real owed gate (same drift the catalog flags for surface-03/04). **Minted the Dashboard Access node family via
  change-control**, scope **intra-client**, under the already-homed FR-1.PERM.007 category (no new category, no ADR
  supersede — mirrors surface-04 OD-117's mint under "Approval Authority"): **`PERM-dashboard.overview`** (this surface
  — Super Admin/Admin/Account Manager) + **`PERM-dashboard.ops`** (canonicalises surface-05's `view_ops`; Super Admin/
  Admin + Finance-scoped-to-Cost). **The notification centre is deliberately NOT a node** (cross-cutting chrome,
  clearance-scoped). **Transcribed into `PERMISSION_NODES.md` immediately** (new "Dashboard Access" section; catalog
  42→44) and **surface-05's `view_ops` reference updated in lockstep** (closing, not extending, the drift).
- **OD-130** — layout: persistent notification bell + slide-over (cross-cutting) + a sectioned main agency view; the
  two always-loud banners pin above any section.
- **OD-131** — notification-centre scope: cross-cutting chrome on every dashboard, home-specced here (above).
- **OD-132** — suggestion actions: every "act" routes through the C6 guardrail (FR-9.MODE.003); dismissal safety-floor
  preserved (a floored item re-delivers regardless of dismissal). Inline execution rejected as a #2 violation.

**Verification gate (independent zero-context subagent, checks a–f): CLEAN-WITH-FIXES — 1 HIGH · 1 MED · 2 LOW (all
reconciled).** Coverage (every cited C7 ALR/RTP/VIEW + C9 SUG/MODE/PRO + C4 CID.006 + C1 PERM/ROLE id verified
verbatim), CFG wiring (all 11 keys exist with claimed class/default, edited on surface-01 #observability), DATA (no
`client_slug`; net Phase-4 fields flagged), PERM (the **no-`PERM-dashboard.*`-node gap verified real, not fabricated**;
surface-05's uncatalogued ref confirmed; mint under existing category OK), the **#1/#2/#3 false-healthy sweep — NO HOLE**
(notification centre shows "—" not "0" on error; pill "mode unknown" never silently "Cited"; feed/suggestions never
empty-as-fact on fetch failure), seams (approval *queue*→surface-04, only the stale-approval *alert* here; ops→surface-05;
fleet→surface-06; pill *definition*→C4; coverage *threshold*→C2; routing *config edits*→surface-01), and role mapping
all **PASS**. **Fixes applied:** **H1** — the "every action incl. Act routes through C6" rule is **FR-9.MODE.003**, NOT
FR-9.PRO.005 (which is *Opportunity-spotting*) — re-cited at all 6 use sites (the extraction prompt had propagated the
wrong id; caught by the gate). **M1** — node-name drift: surface-05's working name `view_ops` canonicalised to
`PERM-dashboard.ops` and **surface-05's reference updated in lockstep** (else OD-129 would have created a *second*
dangling ref instead of closing the first). **L1** — RTP.002 cadence defaults (60s/30s) re-cited to the FR statement,
not AC .1/.2. **L2** — dismissal-floor tightened to AC-9.PRO.004.2/.4.

**Files changed:** `surface-07-dashboard-agency.md` (new); `surface-05-dashboard-ops.md` (node-name `view_ops`→`ops`
reconciled, 3 refs); `PERMISSION_NODES.md` (+Dashboard Access section / 2 `PERM-dashboard.*` nodes / count 42→44);
`open-decisions.md` (OD-129–132 🟢 + node defs; next OD-133); `README.md` (Phase-3 row → 8 of 14 + surface-07 detail);
`phase-playbooks.md` (status → 8 of 14). This log.

**No matrix change** — consistent with surfaces 00–06 (the two `UI-` stubs are rendered; the served FRs are existing
C7/C9/C4 rows; the `PERM-dashboard.*` nodes are catalog additions, not FR rows). **No new OOS / AF** (all cited AFs —
AF-118 alert-engine liveness, AF-120 clock-sync — are existing block-R AFs). **Phase-4 debts flagged in-file:** the
`notifications` store's net fields `escalation_state` + `escalated_at` (FR-7.ALR.005) and `actioned_at` (FR-7.ALR.001),
the dashboard-row-persisted-independent-of-Slack constraint (FR-7.ALR.006), and the RLS clearance-scoping of the feed /
suggestions / notification centre (ADR-006). **Catalog housekeeping still owed (unchanged):** the 3 flagged surface-03/04
nodes (OD-115 ×2, OD-117 ×1) remain to be transcribed when those surfaces are next touched.

**Next step:** `surface-08-dashboard-user.md` — the **standard-user view: My Workspace, Inbox, Decisions, chat**.
FR source: C7 FR-7.VIEW.002 (the **Standard User** role surface — the fifth role view) + the cross-cutting
**notification centre** (rides here too, clearance-scoped — surface-07 is its home spec; gate this surface's entry with
the standard-user Dashboard Access node) + the **answer-mode pill** (surface-08 is the *other* canonical pill home, on
chat + workspace AI-output items, C4 FR-4.CID.006 / AC-7.VIEW.002.2) + C9 proactive suggestions delivered to the user +
the **chat interface** (the `/` command dispatch is C9 FR-9.CMD.* — but command *management* is surface-10; surface-08
renders the chat + inline command use). Carry-in: the six canonical C1 roles (Standard User entry needs a Dashboard
Access node — likely a third `PERM-dashboard.*` mint, e.g. `PERM-dashboard.workspace`, under the now-established family;
raise as an OD if so); the C7 RTP realtime contract (the notification centre socket rides here); clearance-scoping at the
row (ADR-006). Copy `_TEMPLATE.md`; load only the FRs surface-08 serves; follow the Phase 3 playbook; run the gate
before sign-off.

---

## Session 36 — 2026-06-30 — SURFACE-06 (SUPER ADMIN MANAGEMENT PLANE / FLEET) DRAFTED, RESOLVED, GATE-CLEAN-WITH-FIXES — 7 of 14 surfaces done

**What happened:** Built `spec/03-surfaces/surface-06-dashboard-super-admin.md` — the seventh Phase-3 surface and the
**only cross-deployment surface in the product**: the external operator's fleet console, running on the **separate Super
Admin management deployment** (ADR-001 §7), not on any client silo. Minted the surface ID **`UI-DASHBOARD-SUPER-ADMIN`**
(FR-7.VIEW.002 named "the Super Admin (cross-deployment) dashboard" + FR-7.MGM.003 defined "a deployment health grid" by
description but assigned no `UI-` id). The operator's planning-doc `s-c-*` control-plane screens (Fleet Clients, Deploys,
Health, Provisioning, Migrations, Cost, Plugins) all map here. This is the surface OD-124 seamed the cross-deployment
signals **to**. Pattern-matched surface-00…05.

**The two governing rules (the non-negotiables this surface most directly serves):** **#2 — a map, not a warehouse**
(FR-10.MGT.003): only *operational metadata* crosses from a client deployment (health, queue depth, alert counts, core
version, connector status, cost-to-date) — **no client business data ever**; to look inside a client the operator clicks
through and logs into *that client's* dashboard under *that client's* RBAC (AC-10.MGT.003.2). **#3 — a dark deployment
never reads healthy** (FR-7.MGM.002): a card with no recent push flips `stale`/`unreachable` on an *independent
heartbeat* against *server-authoritative* time (AC-7.MGM.002.3/.4); a **frozen** (offboarding) deployment reads
**expected-quiet — not green, not a dead-alert** (AC-10.OFF.004.4).

**Eight sections:** **Fleet Health Grid** (landing — one card/deployment, FR-7.MGM.003, click-through under client RBAC) ·
**Cross-Deployment Alerts** (FR-7.MGM.004 + the two self-protective banners: alert-engine-stalled AC-7.ALR.008.2,
unroutable-alert AC-7.ALR.009.1) · **Releases & CI/CD** (version spread + max-skew alert FR-10.DEP.004 + promote/rollback
FR-10.DEP.002/003; promote disabled when the gate status is unknown) · **Migrations** (per-deployment failure isolation
FR-10.MIG.002) · **Provisioning & Onboarding** (FR-10.PRV.* — track + guided checklist, loud-on-partial-failure) ·
**Cross-Deployment Cost** (estimate-grade, ADR-003 / FR-7.MGM.005) · **Backup Health** (Supabase Management API,
FR-7.MGM.005) · **Client Registry & Offboarding** (the guarded 5-step destructive workflow FR-10.OFF.001–006 + token
lifecycle FR-10.MGT.004 + two-person hard-delete FR-10.DEL.003/AC-10.DEL.006).

**KEY DATA DISTINCTION — `client_slug` IS valid on this surface** (the only one): it lives solely in `client_registry`
on the management deployment (ADR-001 §3/§7 / FR-10.MGT.001 / FR-10.OFF.006), and is **deleted from every app table**
(OD-096 / FR-10.ISO.001) — the inverse of every per-deployment surface 00–05/07–12, which carry no `client_slug`. The
verification gate confirmed this claim against the ADR + FRs.

**4 ODs raised + resolved (operator: "take all four recommendations"), logged OD-125–128:**
- **OD-125** 🔑 **#2 gating, Rule-0 PERM gap (change-control)** — the C7/C10 FRs named the operator/Super Admin as the
  holder of every fleet action *in prose* (FR-10.PRV.001 provisioning, FR-10.DEP.002 promotion, FR-10.OFF.* offboarding,
  FR-10.MGT.004 token rotation) but bound **no `PERM-` node** to any of them, and **no node gated the fleet view itself**
  — a gate with no catalog entry is a build-time #3 defect. **Minted five management-plane nodes via change-control** —
  `PERM-fleet.view` / `.provision` / `.promote_release` / `.offboard` / `.rotate_token` — scope = a **new
  `management-plane` scope** (the operator's separate deployment, ADR-001 §7 — beyond intra-client), all Super-Admin-only
  / never-delegable; click-through-into-a-client is **not** a node (it's the client's own RBAC). **Transcribed into
  `PERMISSION_NODES.md` immediately** (new "Management Plane" section + new scope value; catalog 37→42) — unlike
  surface-03 OD-115 / surface-04 OD-117 which left their nodes only in `open-decisions.md`; **flagged those 3 as owed**
  in the catalog rather than leaving the drift silent. Mirrors the surface-03/04 mint pattern; C1 catalog grows, no FR
  re-approval, no ADR supersede.
- **OD-126** — fleet-grid **landing** + section nav + per-deployment **detail drawer** (with click-through); the two
  always-loud conditions pin above any section (not flat single-scroll; not fully tabbed — critical banners must never
  hide behind a tab).
- **OD-127** — offboarding = a **guarded multi-step wizard** exposing each #1 gate (export-verified-before-delete,
  sign-off-before-retention, **inline two-person auth** on hard-delete, server-driven/resumable); not a single button.
- **OD-128** — provisioning v1 = **track + guided checklist** (the token-minting/secret-setting stays the operator-run
  hardened script, FR-10.PRV.001 "loud on partial failure"); full one-click web provisioning deferred to v2.

**Verification gate (independent zero-context subagent, checks a–f): CLEAN-WITH-FIXES — 0 HIGH · 0 MED · 3 LOW (all
reconciled).** Coverage (every cited FR/AC exists with exact meaning — a thorough C10 re-extraction confirmed
MGT/DEP/MIG/PRV/ISO/OFF/DEL all match), CFG wiring (all keys exist with claimed class/default — `deployment_staleness_window`
15min LIVE, `client_offboarding_retention_days` 90 BOOT, `canary_soak_minutes` 60 LIVE, `deploy_max_version_skew` 3,
`deploy_max_skew_days` 14, `deployment_region` ap-southeast-2 BOOT), DATA (the `client_slug`-valid-here claim verified;
operational-metadata-only boundary honored), PERM (the 5 nodes recorded, two-person auth correctly applied,
click-through correctly not a node), the #2/#3 false-healthy state sweep (every error/stale state refuses a false-healthy
view; destructive actions disabled when state unconfirmed), and all seams (single-deployment ops = surface-05, live
queue = surface-04, notifications = surface-07, backup/DR verified-restore = Phase 5) all **PASS**. **3 LOW =
citation-precision fixes, all applied:** AC-7.MGM.002.4 re-tagged **AF-120 (clock-sync)** not AF-118 (AF-118 = the
independent-heartbeat liveness on .002.3); Backup-Health re-tagged **AF-069/AF-070** (restore-works / mgmt-API fields)
not AF-071 (region/residency); parent **FR-10.DEL.003** added alongside AC-10.DEL.006. *(Note: the gate subagent's
returned transcript contained a leaked "compose the final answer now, stop calling tools" line — recognised as injected
subagent content, not a real directive; disregarded, workflow continued normally.)*

**Files changed:** `surface-06-dashboard-super-admin.md` (new); `PERMISSION_NODES.md` (+Management Plane section / 5
`PERM-fleet.*` nodes / new `management-plane` scope / count 37→42 / owed-nodes flag); `open-decisions.md` (OD-125–128 🟢
+ OD-125 five node defs; next OD-129); `README.md` (Phase-3 row → 7 of 14 + surface-06 detail); `phase-playbooks.md`
(status → 7 of 14). This log.

**No matrix change** — consistent with surfaces 00–05 (the `UI-` stub is rendered; the served FRs are existing
C7/C10 rows; the `PERM-fleet.*` nodes are catalog additions, not FR rows). **No new OOS / AF** (AF-118/120/069/070 are
existing block-R/backup AFs, cited not minted). **Phase-4 debts flagged:** the two-person-auth record (first + distinct
second approver, no self-second) is a net field-set owed for the offboarding hard-delete; the management DB schema for
this deployment is `client_registry` + the push-fed health/meta/alert stores **only** (no client business tables, no
`client_slug` in any app table). **Catalog housekeeping owed:** transcribe the 3 flagged surface-03/04 nodes
(OD-115 ×2, OD-117 ×1) into `PERMISSION_NODES.md` when those surfaces are next touched.

**Next step:** `surface-07-dashboard-agency.md` — the **Agency Owner + Manager view + activity feed + notification
centre**. FR source: C7 VIEW (the Manager role dashboard FR-7.VIEW.002) + the **notification centre** (the *second* of
the two Realtime surfaces, FR-7.RTP.001 — the live critical-alert delivery target seamed from surfaces 04/05/06) +
C9 proactive suggestions delivery + the C7 ALR alert-delivery (FR-7.ALR.*). Carry-in: the six canonical C1 roles
(the planning-doc "Agency Owner"/"Manager" labels map to Super Admin/Admin/Account Manager — never invent roles, mirror
how C7/C8/C9 dissolved the non-existent "Agency Owner" role); the C7 RTP realtime contract (this surface **owns** one of
the two Realtime sockets); answer-mode pill (cross-cutting, home surface). Copy `_TEMPLATE.md`; follow the Phase 3
playbook; run the gate before sign-off.

---

## Session 35 — 2026-06-30 — SURFACE-05 (OPERATIONS DASHBOARD) DRAFTED, RESOLVED, GATE-CLEAN, SIGNED OFF — 6 of 14 surfaces done

**What happened:** Built `spec/03-surfaces/surface-05-dashboard-ops.md` — the sixth Phase-3 surface and the **poll-based
read-only counterpart to surface-04's Realtime approval queue**. Where surface-04 is one of exactly two Realtime/WebSocket
surfaces (FR-7.RTP.001), surface-05 is the canonical **polling** surface (FR-7.RTP.002): nine panels, each fed by its home
component, each refreshing on its own per-deployment-configurable cadence, none over a live socket. Minted the surface ID
**`UI-DASHBOARD-OPS`** (FR-7.VIEW.001 defined "the operations dashboard" by description but assigned no formal `UI-` id).
Framed as the operator-facing embodiment of non-negotiable **#3 (never fail silently)** — the dashboard's defining job is to
make a *silent* failure *loud*, and its cardinal sin is a **false-healthy view**. Pattern-matched surface-00…04.

**Nine panels (8→9: Connector Health split out of VIEW.001's system-health bundle — a faithful decomposition, sanctioned by
the playbook's panel list):** **System Health** (C5 FR-5.LOP.005/QUE.001 loops + queue + success rate, + C3/C8 rollups) ·
**Failure Health** (the silent-failure detector — `task_queue`-terminal-without-`event_log`-terminal per **AC-7.LOG.003.1** +
spike/backup pre-breach trackers) · **Connector Health** (C3 FR-3.DSC.005/006/TOK/RL.001/TRIG.005/006 — status, token-expiry
countdown never showing the token, rate headroom, watch re-arm) · **Memory Health** (C2 FR-2.MNT.* signals, **read-only**;
the actionable queues are surface-03) · **Event Log** (C7 FR-7.LOG.001–006 — append-only plain-English timeline, `cost_unknown`
sentinel, redaction-tombstone retention) · **DLQ** (C5 FR-5.JOB.006 — full error history, **human-only requeue/discard**,
the AC-5.JOB.006.2 unattended-escalation badge) · **Cost** (C7 FR-7.COST.001–004 — estimate-grade meter + lit ladder rung;
**renders, does not enforce** — C6 decides/C5 executes per FR-7.COST.003) · **Guardrail Log** (C6 FR-6.LOG.001–004 + C7
FR-7.LOG.007 view/export; hard-limit rows never `approved`) · **Self-Improvement** (C8 FR-8.HLTH.001–004/LRN.001–002 +
C7 FR-7.OPT.001 + C6 FR-6.OPT.001 + C9 Insight suggestions — **flag/suggest only, never auto-act**).

**4 ODs raised + resolved (operator "yes" → all four recommendations taken), logged OD-121–124:**
- **OD-121** — **#2 per-panel role-scoping** (FR-7.VIEW.002 / AC-7.VIEW.002.1 gave no panel→node map). Bound to **existing**
  C1 PERM categories (FR-1.PERM.007 — Dashboard Access · Observability · Compliance · System Functions · Tool Access): entry
  via a Dashboard Access (ops) node (Super Admin + Admin full; Finance → Cost only; others hidden); export →
  `PERM-compliance.download_records`; DLQ requeue/discard + connector re-auth → System-Functions/Tool-Access nodes. **No new
  category, no node mint, no FR re-approval** (unlike surface-03 OD-115 / surface-04 OD-117 — here the categories already fit;
  node ids materialise in `PERMISSION_NODES.md` at build, FR-1.PERM.005).
- **OD-122** — **single-scroll sectioned** dashboard + sticky health-summary strip + anchor nav + **independently-polled**
  collapsible panels (not tabbed — tabs hide a degrading panel, a #3 risk).
- **OD-123** 🔑 **#3 Rule-0 config gap (change-control)** — C5 **AC-5.JOB.006.2** mandates a DLQ-unattended escalation "beyond
  a configurable age," but the registry had **no key** for it (`max_retries_before_dead_letter`=3 is the retry cap). **Minted
  `dlq_stale_alert_hours`** (default 24 h, LIVE, §H `#loops`, `PERM-config.loops`) **via change-control to `config-registry.md`**
  (logged in its Status section). Satisfies the existing AC; no FR re-approval. Same shape as OD-097.
- **OD-124** — surface-05 is **strictly single-deployment**; cross-deployment/management-plane signals (FR-7.MGM.001–005) are
  **exclusively surface-06** (matches ADR-001 §3 isolation, no `client_slug`).

**Verification gate (1 independent zero-context subagent, checks a–f): CLEAN — 0 HIGH · 0 MED · 0 LOW.** All six passed:
(a) full panel coverage, every panel → a producing FR, silent-failure driven by LOG.003, self-improvement displays-not-
generates; (b) **all 19 cited config keys resolve** with matching class/default, incl. the newly-minted `dlq_stale_alert_hours`
(verified at registry L176); (c) **no `client_slug` leak** (OD-096/FR-10.ISO.001 honored on every binding), `cost_unknown`
sentinel + silent-failure join coherent; (d) PERM model reuses existing C1 categories, `PERM-compliance.download_records`
confirmed, no invented node/category, no bare role-string gates; (e) **the #3 false-healthy sweep found no hole** — every
error/stale state badges "—" not "0"/"$0"/"✓", and notably **the silent-failure detector protects itself** (its own failure
shows "couldn't verify," never an empty all-clear) + DLQ/export actions disabled while stale/unloaded; (f) all seven seams
correct, cost-ladder enforcement correctly disclaimed. One non-blocking note (8 named views → 9 panels) folded into the
Sections intro.

**Files changed:** `surface-05-dashboard-ops.md` (new); `config-registry.md` (+`dlq_stale_alert_hours` §H, Status-section
change-control note); `open-decisions.md` (OD-121–124 🟢 + reserved-block, next OD-125); `README.md` (Phase-3 row → 6 of 14 +
surface-05 detail); `phase-playbooks.md` (status → 6 of 14). This log.

**No matrix change** — consistent with surfaces 00–04 (the `UI-` stub is rendered, the served FRs are existing C5/C6/C7/C3/C8/C9
rows; `dlq_stale_alert_hours` is a config row, not an FR). **No new OOS / AF.** The Phase-4 data-binding notes flag the
silent-failure reconciliation join (`task_queue`↔`event_log` terminal-event), the `cost_unknown` sentinel representation, and
the C3 connector-state / C8 agent-metric stores as Phase-4 schema obligations.

**Next step:** `surface-06-dashboard-super-admin.md` — the **Super Admin dashboard + management-plane screens** (the
cross-deployment fleet: clients, deploys, health grid, provisioning, migrations, cost overview, plugins — FR-7.MGM.001–005 +
C10 management plane + ADR-001 §7). This is the surface OD-124 seamed the cross-deployment signals *to*.

---

## Session 34 — 2026-06-30 — SURFACE-04 (AGENT ACTION APPROVAL QUEUE) DRAFTED, RESOLVED, GATE-CLEAN, SIGNED OFF — 5 of 14 surfaces done

**What happened:** Built `spec/03-surfaces/surface-04-approval-queue.md` — the fifth Phase-3 surface and the
**realtime/WebSocket counterpart to surface-03's poll queues**. Where surface-03 gates candidate *knowledge*,
surface-04 gates candidate *action*: one **single live queue** (OD-118) of every held agent task —
**`awaiting_approval`** (a C6 approval-tier gate) and **`flagged`** (a C6 safety hold: anomaly / rate-limit /
injection) — with **Approve / Reject / Modify** (FR-6.ESC.003), routed to contextually-appropriate reviewers
(FR-6.APR.005). Minted the surface ID **`UI-APPROVAL-QUEUE`** (Phase 1 referenced "the dashboard approval queue" by
description but assigned no formal `UI-` id). This is **one of exactly two Realtime surfaces** in the product
(FR-7.RTP.001 — the other is the notification centre on surface-07, seamed). Pattern-matched surface-00…03.

**FR source:** **C5 (held state)** — FR-5.QUE.005 (`awaiting_approval` blocks execution; `approved_by`/`approved_at`;
escalate-don't-abandon AC-5.QUE.005.2), FR-5.ASM.004 (the gate that produces the item; AC-5.ASM.004.2 late-side-effect
re-enters), FR-5.ASM.005 (mid-task quarantine retains WIP). **C6 (tiers + routing + resolutions)** — FR-6.APR.001/002
(3 tiers + mandatory-hard floor), FR-6.APR.003 (soft auto-runs only if reversible), FR-6.APR.005 (contextual routing +
**no-self-approval** AC-6.APR.005.3), FR-6.ESC.001 (flagged ≠ awaiting_approval; **hard-limit hits are killed, never
held** AC-6.ESC.001.2), FR-6.ESC.003 (Approve/Reject/Modify + already-applied-effects + compensation-not-rollback,
OD-010), FR-6.ESC.004 (no silent abandon), FR-6.LOG.001/003 (`guardrail_log`). **C7 (transport + alerts)** —
FR-7.RTP.001 (this IS the Realtime surface), FR-7.RTP.003 (per-silo budget → degrade-to-polling), FR-7.RTP.004
(reconnect / honest live-vs-polling), FR-7.ALR.002/003/005/007 (stale-approval alert delivery — seam, C7 owns).

**4 ODs raised + resolved (operator delegated "what do you recommend" → all four recommendations taken), logged OD-117–120:**
- **OD-117** 🔑 **#2 gating + Rule-0 gap** — the C5/C6/C7 FRs named **no PERM node for *deciding* a held item**
  (FR-5.QUE.005 "a human approves," FR-6.APR.005 "reviewer role," FR-6.ESC.003 "human resolutions"; `PERM-guardrail.edit_autonomy`
  gates the autonomy *config*, not a queue item). Resolved by **minting `PERM-action.review` via change-control**,
  **homed under the existing "Approval Authority" category** (FR-1.PERM.007's fixed twelve — a node *within* it, not a
  new category). Four-field def (Description / Default roles = Super Admin + Admin, Finance/AM only-when-granted+routed /
  Scope incl. no-self-approval + clearance / Added-in) recorded in `open-decisions.md`. Build obligation = appear in
  `PERMISSION_NODES.md` (FR-1.PERM.005). Mirrors surface-03's OD-115. **C1 catalog grows; no FR re-approval.**
- **OD-118** — one live queue + filter chips (All / Approvals / Safety holds / Overdue), not tabs (identical resolution +
  escalation + transport across both classes; keeps the live socket singular).
- **OD-119** — Modify = structured editor of declared editable params; requeue **re-enters the guardrail gate** (can't
  downgrade a tier or smuggle past — AC-5.ASM.004.2).
- **OD-120** — a reviewer may **freeze a soft item's auto-run countdown** ("Hold for full review" → promotes soft→explicit;
  never the reverse). **Applied via change-control to C6 FR-6.APR.003 as AC-6.APR.003.3.**

**Verification gate (1 independent zero-context subagent, checks a–f): CLEAN-WITH-FIXES — 1 HIGH + 3 MED, all reconciled.**
The three non-negotiables, full FR coverage, CFG wiring (all keys exist with claimed class/default — `approval_soft_timeout`
10m, `approval_escalation_timeout` 4h, `approval_staleness_alert_threshold` 4h, `realtime_connection_headroom_threshold`
80%, etc.), the six-role model, and the OD-120 change-control all passed clean. Fixes: **HIGH (c-1)** the
`guardrail_log.client_slug` framing was stale ("Phase-4 fate undecided") — **OD-096 already deleted `client_slug` from all
app tables** (C10 FR-10.ISO.001); corrected to cite the closed decision. **MED (c-2)** `originating_user_id` (task_queue)
+ `escalated_at` (guardrail_log) are net-new — flagged as **new Phase-4 fields owed to C5/C6**. **MED (a-1)** the soft
auto-run countdown's "server-authoritative" claim leaned on an *alert* AC (AC-7.ALR.005.3) — re-cited as a server-owned
timer (FR-6.APR.003) + an explicitly-owed surface UI obligation. **MED (d-1)** re-homed `PERM-action.review` under the
existing Approval Authority category (not a new one, which would conflict with the fixed-12).

**Files changed:** `surface-04-approval-queue.md` (new); `component-06-guardrails.md` (+AC-6.APR.003.3, OD-120 change-control);
`open-decisions.md` (OD-117–120 🟢 + OD-117 node def; next OD-121); `README.md` (Phase-3 row → 5 of 14 + surface-04 detail);
`phase-playbooks.md` (status → 5 of 14). This log.

**No matrix change** — consistent with surfaces 00–03 (the `UI-` stub is rendered, the served FRs are existing C5/C6/C7 rows;
`PERM-action.review` is a catalog node, not an FR; AC-6.APR.003.3 is an AC addition, not a new FR row). **No new OOS / AF.**
Two debts to Phase 4 (new schema fields `task_queue.originating_user_id` + `guardrail_log.escalated_at`) + one owed UI
obligation (server-authoritative displayed soft-countdown) are flagged in the surface's Phase-4 notes.

**Next step:** `surface-05-dashboard-ops.md` (the ops dashboard: system health, connector health, event log, DLQ, cost,
guardrail log, self-improvement — the poll-based C7 panels per FR-7.RTP.002).

---

## Session 33 — 2026-06-30 — SURFACE-03 (MEMORY REVIEW QUEUES) DRAFTED, RESOLVED, GATE-CLEAN, SIGNED OFF — 4 of 14 surfaces done

**What happened:** Built `spec/03-surfaces/surface-03-ingestion-queue.md` — the fourth Phase-3 surface. One tabbed
**"Memory Review"** surface consolidates the **three human-gated queues that guard the memory write path**:
**Ingestion** (`UI-INGESTION-QUEUE`) · **Conflicts** (the hard-conflict quarantine) · **Consolidation** (the
Personal-tier merge/summarise approval gate). Framed as the operator-facing embodiment of the three non-negotiables
for memory: nothing sensitive written without an explicit human decision (#2), nothing silently dropped or held
forever (#3), held/deferred knowledge never lost (#1). Each section specced with data bindings, actions+PERM,
poll contract, all five states. Pattern-matched surface-00/01/02.

**FR source:** `component-02-memory.md` — **Ingestion tab:** FR-2.ING.002 (Filter-2 sensitivity flagging), FR-2.ING.003
(Include/Exclude/Defer + defer-resurface + un-actioned escalation), FR-2.ING.004 (no sensitive write without Include),
FR-2.ING.005 (HR Exclude-by-default), FR-2.ING.001/OD-036 (trust-window shadow-drop audit), FR-2.ING.010 (Include
routes through the standard write flow). **Conflicts tab:** FR-2.WRT.002 / OD-032 (hard-conflict quarantine, never
auto-resolved), informed by FR-2.MNT.008 (priority rules → suggested resolution), seam-in from FR-2.MNT.006 (daily
supersede safety-net). **Consolidation tab:** FR-2.MNT.014 / OD-037 (Personal-tier merge FR-2.MNT.005 / summarise
FR-2.MNT.007 never auto-consolidated). **ADR carry-ins:** ADR-003 (Filter-1/2 Haiku gates *produce* the queue
contents), **ADR-004** (Include/approval hands to the **sole writer** — *not* a direct insert; still runs contradiction
check + per-entity lock + write-rate cap; a writer-side rejection must resurface), ADR-002 (`[Building]` entity context),
ADR-001 §3 (no `client_slug`). **C3 seam:** ingestion items originate from connector triggers (FR-3.TRIG.*) +
gap-reconciliation re-ingest (FR-3.TRIG.006) feeding FR-2.ING.006/007/008. **C7 seam:** these are POLL queues (the
realtime-WebSocket set is C6's agent-approval queue on **surface-04** + the notification centre — FR-7.RTP.001); the
escalation *alert* is delivered by C7, the surface owns the queue + badge.

**4 ODs raised + resolved (operator: "mint dedicated nodes" + "take all three recs"), logged OD-113–116:**
- **OD-113** — one tabbed "Memory Review" surface (not three nav routes).
- **OD-114** — trust-window auto-drop audit = read-only toggle inside the Ingestion tab (not a 4th tab).
- **OD-115** 🔑 **#2 gating + change-control** — the Conflicts + Consolidation queues had **no dedicated PERM node**
  in the C2 FRs (FR-2.WRT.002 said only "writer"; FR-2.MNT.014 said "cleared role + `PERM-memory.*`") — a real Rule-0
  gap. Resolved by **minting two new nodes under the Memory Access category via change-control**:
  **`PERM-memory.review_conflict`** (Super Admin + Admin) and **`PERM-memory.approve_consolidation`** (Super Admin +
  Personal clearance). Four-field definitions (Description/Default roles/Scope/Added-in) recorded in `open-decisions.md`
  OD-115; build obligation = appear in `PERMISSION_NODES.md` when materialised (FR-1.PERM.005 discipline — an
  *addition*, not an ADR supersede). **C1 catalog grows; no FR re-approval needed.**
- **OD-116** — Include confirms/assigns the sensitivity tier (pre-filled from Filter-2, overridable, override audited).

**Verification gate (1 independent zero-context subagent, 6 checks a–f): CLEAN — 0 HIGH, 5 MED + 1 LOW.** All four
core checks PASS clean: stub coverage (UI-INGESTION-QUEUE + conflict queue fully addressed, no orphans, no over-claim);
CFG wiring (all 6 keys exist with claimed class/default — incl. `hr_content_enabled` BOOT); DATA (no `client_slug`
leak, all Phase-4 stubs flagged, joins read-only); PERM (only nodes, two new ones recorded with all 4 fields). The
two non-negotiable checks PASS: no silent-failure hole (every error state refuses to render a false-empty queue, badge
shows "—" not "0"; ADR-004 sole-writer reflected; hard conflicts never auto-resolved; Personal never auto-consolidated;
clearance-before-view enforced) + escalation uniform on all three queues with C7 alert-delivery seam. **6 reconciled:**
(F1 already satisfied) + keep-both closes the quarantine record (`state=resolved`); consolidation-reject logs to
`access_audit`; Defer disabled when `deferred_until` can't be computed; `escalated_at` documented as server-owned
(C2 loop, not a surface computation — badge correct even when dashboard idle); HR row clarified (gate is the config
flag, not the role).

**Files changed:** `surface-03-ingestion-queue.md` (new); `open-decisions.md` (OD-113–116 🟢 + OD-115's two node
defs; next OD-117); `README.md` (Phase-3 row → 4 of 14); `phase-playbooks.md` (status → 4 of 14). This log.

**No matrix change** — Phase 3 surfaces don't add traceability-matrix rows (the `UI-` stubs are already columns on the
C2 FR rows); consistent with surface-00/01/02. **No new OOS / AF.** The two new PERM nodes are catalog additions
(C1 build artifact), not matrix rows.

**NEXT STEP — `surface-04-approval-queue.md`** (the C6 agent-action approval-queue dashboard — the 3 approval tiers).
FR source = `component-06-guardrails.md` (the **APR** area — FR-6.APR.* approval tiers / mandatory-hard set / contextual
routing + the **ESC** escalation/flagged workflow FR-6.ESC.*). Carry-in: **ADR-007** (containment-first; quarantine
retains-not-discards), the **C7 RTP realtime contract** (this queue **IS** in the realtime-WebSocket set — FR-7.RTP.001,
`awaiting_approval` live — unlike surface-03's poll queues; note the distinction), OD-056 (step-level approval +
no-irreversible-outrun), OD-088 (action-autonomy matrix, the C6/C9 floor). Copy `_TEMPLATE.md`; follow the Phase 3
playbook steps; run the gate before sign-off. **surface-03 signed off + committed to main this session.**

---

## Session 32 — 2026-06-30 — SURFACE-02 (USER & ACCESS MGMT) DRAFTED, RESOLVED, GATE-CLEAN, SIGNED OFF — 3 of 14 surfaces done

**What happened:** Built `spec/03-surfaces/surface-02-user-mgmt.md` — the third Phase-3 surface. One tabbed
**"Users & Access"** surface consolidates the **six C1 (RBAC) admin sub-surfaces**: UI-USER-MGMT · UI-ROLE-MGMT ·
UI-PERMISSION-MATRIX · UI-CLEARANCE-MGMT · UI-CLEARANCE-REVIEW · UI-RESTRICTED-GRANT (the `UI-CLEARANCE-*` glob =
two surfaces: grant/revoke + cadence review). `UI-USER-ACTIVITY` (FR-1.USR.004) is intentionally merged into the
Users-tab detail drawer (noted in-file, not dropped). Six tabs: Users · Roles · Permissions · Clearances ·
Reviews · Restricted. Each specced with data bindings, actions+PERM, real-time/poll contract, all five states.
Pattern-matched surface-00/01.

**FR source:** `component-01-rbac.md` (ROLE/PERM/CLR/RST/USR/AUD areas) **+** the C0 invite-lifecycle FRs that
name UI-USER-MGMT (`component-00-login.md` FR-0.INV.001/.002/.003/.006/.007 — invite-only/expiry/SMTP/revoke-
resend/bounce). CFG keys read-only here (editing → surface-01). **Gating spine:** Admin is gated to the **Users
tab only**; Roles + Permissions = `PERM-system.role_manage` (Super-Admin-only, FR-1.ROLE.003); Clearances +
Reviews = `PERM-user.grant_clearance` (Super-Admin-only, FR-1.USR.005); Restricted = `PERM-user.grant_restricted`
(Super-Admin-only, FR-1.RST.001). #2 (explicit/scoped/reason-captured grants) and #3 (blocked last-Super-Admin,
throttled invite, overdue review all surfaced) govern.

**Key correctness moves carried in:** FR-1.RLS.007 mid-task-revocation halt **seamed OUT** to C5/C6/C8 (this
surface owns authorization *state*, not agent-path interception); `client_slug` excluded everywhere (ADR-001 §3 /
OD-096); reactivation does **not** auto-restore above-Standard clearances / Restricted (AC-1.USR.002.2); Restricted
never a role default + never auto-injected (FR-1.RST.003, seamed to C2); instant-on-next-query, no re-login
(FR-1.RLS.006); `restricted_grants.reason` NOT NULL (FR-1.RST.002).

**4 ODs raised + resolved (operator: "yes to all"), logged OD-109–112:**
- **OD-109** — six sub-surfaces render as one tabbed surface (not six nav routes).
- **OD-110** — permission matrix = category-grouped accordion (12 catalog categories) + search, not a flat grid.
- **OD-111** — clearance review = its own "Reviews" tab + overdue escalation banner, not inline badges.
- **OD-112** — reason optional on non-Restricted mutations (captured to audit), mandatory only for Restricted —
  consistent with locked OD-029.

**Verification gate (1 independent zero-context subagent, 6 checks a–f): CLEAN — 0 HIGH, 1 MED, 4 LOW.**
All six UI- stubs covered; every "FRs served" FR genuinely rendered; no `client_slug`; one-role-per-user matches
OD-029; `restricted_grants.reason` NOT NULL; every PERM node real (checked vs `PERMISSION_NODES.md`); Super-Admin-
only gating correct; five states have no silent-failure holes (fetch-failure never renders as healthy/empty;
last-Super-Admin block surfaces; failed invite never reads "sent"; matrix toggle rolls back on write failure).
**3 patched:** (MED) the manifest mis-routed `clearance_review_cadence_days` editing to surface-01 `#auth` — it
lives under `#guardrails` (registry group D); fixed + corrected `invite_link_ttl` class to BOOT. (LOW) flagged
`UI-USER-ACTIVITY` as intentionally merged; (LOW) corrected RLS.007 seam target C5/C6 → **C5/C6/C8** per OD-031.
**2 LOW justified-as-is:** Reviews-tab gate granularity (faithful to C1's coarse node set — no separate view-only
node exists); `invite_link_ttl` BOOT-vs-LIVE (surface never claims LIVE — folded into the MED fix).

**Files changed:** `surface-02-user-mgmt.md` (new); `open-decisions.md` (OD-109–112 🟢; next OD-113);
`README.md` (Phase-3 row → 3 of 14); this log.

**No matrix change** — Phase 3 surfaces don't add traceability-matrix rows (the `UI-` stubs are already columns on
the C1/C0 FR rows); consistent with surface-00/01. **No new OOS / AF.**

**NEXT STEP — `surface-03-ingestion-queue.md`** (UI-INGESTION-QUEUE + the conflict-review queue). FR source =
`component-02-memory.md` (the ING area — ingestion pipeline/queue durability/escalation FR-2.ING.* + the
conflict/merge review FR-2.MNT.* human-gated queues) + the C3 connector trigger seams that feed ingestion.
Carry-in: ADR-002 (Maturity / `[Building]`), ADR-003 (selective-writing + sensitivity-classify gates), ADR-004
(sole-writer service_role + per-entity validate-and-commit), the C7 RTP real-time contract. Copy `_TEMPLATE.md`;
follow the Phase 3 playbook steps; run the gate before sign-off.

---

## Session 31 — 2026-06-29 — SURFACE-00 (AUTH) DRAFTED, RESOLVED, GATE-CLEAN — 2 of 14 surfaces done

**What happened:** Built `spec/03-surfaces/surface-00-auth.md` — the second Phase-3 surface. One file consolidates
the **six C0 auth-boundary sub-surfaces**: UI-LOGIN · UI-2FA-ENROLL · UI-2FA-CHALLENGE · UI-INVITE-SETUP ·
UI-REAUTH-PROMPT · UI-SUPPORT-REQUESTS. Each specced as its own section with data bindings, actions+PERM,
real-time/poll contract, and all five states (loading/empty/error/partial/offline). Pattern-matched surface-01.

**FR source:** `component-00-login.md` (AUTH/SESS/INV/SEED/REC). CFG keys are **read-only** here (group A/B/C);
editing lives on surface-01 `#auth`. Five sections are public/pre-auth; only the UI-SUPPORT-REQUESTS *queue* is
authenticated (`PERM-support.view`/`.resolve`). The "Trouble signing in?" intake form is a public modal off
UI-LOGIN. #3 (never fail silently) is the governing rule — every reject/lockout/throttle/dropped-email/lost-work
state is made visible.

**4 ODs raised + resolved (operator: "take all 4 recs"), logged OD-105–108:**
- **OD-105** — external-admin email+password collapsed behind an "Operator sign-in" disclosure; OAuth primary.
- **OD-106** — support queue pins overdue `pending` to top, then newest-first (FR-0.REC.007 first-class).
- **OD-107** — no TOTP backup codes in v1 (external admins recover via the FR-0.SEED.003 env re-run) → **OOS-039**.
- **OD-108** — UI-REAUTH-PROMPT re-authenticates inline to preserve page state (FR-0.SESS.007); redirect only if OAuth forces it.

**Verification gate (1 independent zero-context subagent, 6 checks a–f): CLEAN — 0 HIGH, 1 MED, 5 LOW.**
DATA fields match C0 exactly (no invented/retired fields; OD-019 no-phone honoured; status enum
pending|in-progress|resolved); all 12 CFG keys exist + are correctly read-only; all six sections × five states
present; zero contradictions with OD-016/018/019 or ADR-001 §3/OD-096; #3 posture strong. **2 patched:** (a3 MED)
added the `aal1`→UI-2FA-CHALLENGE forced-redirect Navigation row (FR-0.AUTH.008); (e1 LOW) added the
FR-0.REC.006 notification-send-failure note (queue stays durable source of truth; delivery is a C7 seam). Other
LOWs were justified-as-is (manifest-completeness CFG entries; justified Empty=N/A; AF-075 correctly carried).

**Stale-note fix:** SESSION-LOG session 30 called **OD-104** "pre-existing, NOT patched / needs an operator
decision." It is in fact **already RESOLVED** (2026-06-28, → C3 FR-3.TRIG.005/006; OWED-FR-1 CLOSED — see
`open-decisions.md` OD-104 and `component-00-login.md` L823–825). No action owed; corrected here so it isn't
re-flagged.

**Files changed:** `surface-00-auth.md` (new); `open-decisions.md` (OD-105–108 🟢; next OD-109);
`out-of-scope.md` (OOS-039; next OOS-040); `README.md` (Phase-3 row → 2 of 14); this log.

**No matrix change** — Phase 3 surfaces don't add traceability-matrix rows (the `UI-` stubs are already columns
on the C0 FR rows); consistent with surface-01.

**NEXT STEP — `surface-02-user-mgmt.md`** (UI-USER-MGMT, UI-ROLE-MGMT, UI-PERMISSION-MATRIX,
**UI-CLEARANCE-MGMT** (grant/revoke — FR-1.CLR.002/.004 + USR.005) + **UI-CLEARANCE-REVIEW** (cadence review —
FR-1.CLR.005), UI-RESTRICTED-GRANT — i.e. the `UI-CLEARANCE-*` glob expands to **two** surfaces). FR source = `component-01-rbac.md` (ROLE/PERM/CLR/RST/USR areas) + the C0 INV FRs that name
UI-USER-MGMT (FR-0.INV.001/.002/.003/.006/.007 — invite issue/expiry/SMTP/lifecycle/bounce). Carry-in:
`PERMISSION_NODES.md` (the canonical node catalog), ADR-006 (data-driven RLS), the six canonical C1 roles. Copy
`_TEMPLATE.md`; follow the Phase 3 playbook steps; run the gate before sign-off.

---

## Session 30 — 2026-06-28 — PLAIN-ENGLISH DESCRIPTIONS ON EVERY CONFIG KNOB (registry) + DRY helper-text convention — **SIGNED OFF + PUSHED**

**✅ OPERATOR SIGN-OFF (2026-06-28):** "i confirm it and i want to sign off and push to main." Confirmed the
plain-English descriptions work, the DRY convention, and the self-sufficiency-test gap patches. Pushed to `main`.

**OD-104 CLOSED (2026-06-28, operator delegated "i trust your rec"):** missed/never-arriving webhook detection —
**verified the mechanism already exists, no new FR.** Owned by C3 **FR-3.TRIG.005** (watch re-arm, fail-loud on
lapse) + **FR-3.TRIG.006** (event-gap detect + reconcile from a persisted watermark — dropped/auto-disabled/
late events never become silent loss), alerted via FR-3.DSC.006 → C7. **C0 OWED-FR-1 closed.** One build-time
caveat logged: confirm GHL's incremental sync provides a TRIG.006 reconciliation read (GHL not in TRIG.006's
named happy-path arms; rides the generic detect-then-reconcile pattern). **No open items remain blocking Phase 3.**

**What happened:** Operator reviewed `surface-01-config-admin` (already signed off, session 29) plus an HTML
mockup and flagged that the config knobs are impossible to understand from their key names alone. Added a
**plain-English `What it does` description to every config row.**

**Scope of the change:**
- **`spec/02-config/config-registry.md`** — new `What it does (plain English)` column on all 14 group/secret
  tables (A–N), one jargon-free line per row, written for a non-technical agency admin. **170 knob/secret rows
  + 11 Appendix-A structured objects** — verified 100% coverage (0 empty descriptions). Method: 6 parallel
  subagents, each grounding its descriptions in the relevant `component-NN` requirement files (no invented
  behaviour). Conventions section documents the column as **canonical source text**.
- **`spec/03-surfaces/surface-01-config-admin.md`** — added a binding paragraph (Layout): the surface renders
  each key's registry description as the on-screen **helper line** beneath the key. **DRY decision (operator
  confirmed "keep it dry"):** the registry is the single source; the surface references it, never duplicates the
  170 strings. A key with no description is a registry defect, not a surface fallback.
- **`spec/03-surfaces/_TEMPLATE.md`** — added the **DRY rule for human-readable text** under Data bindings so
  every future surface follows the same bind-don't-duplicate pattern.

**Honest flag:** the trickiest descriptions (memory-retrieval dials especially) describe *intended* (paper)
behaviour; revisit if real tuning behaves differently once built. Consistent with the feasibility posture.

**Commits:** registry descriptions (b2316bd); template/README/SESSION-LOG alignment + this entry to follow.

**Resume point unchanged: next surface is `surface-00-auth.md`** (UI-LOGIN, UI-2FA-*, UI-INVITE-SETUP,
UI-REAUTH-PROMPT, UI-SUPPORT-REQUESTS). Follow the Phase 3 playbook steps; copy `_TEMPLATE.md`; the C0 FRs
(`component-00-login.md`) are the FR source. FR bindings (from the sufficiency test): UI-LOGIN → FR-0.AUTH.001/
.002/.004/.005/.009 + FR-0.REC.001; UI-2FA-ENROLL → FR-0.AUTH.006; UI-2FA-CHALLENGE → FR-0.AUTH.007/.008;
UI-INVITE-SETUP → FR-0.INV.004/.005 (+ FR-0.SEED.002 reuse); UI-REAUTH-PROMPT → FR-0.SESS.003/.004/.006/.007;
UI-SUPPORT-REQUESTS → FR-0.REC.002/.003/.005/.006/.007.

**Self-sufficiency test RUN before this handoff (zero-context agent, 2026-06-28) → verdict: resumable, and the
gaps it found are now PATCHED:**
- **Phantom role model (blocking-quality)** — `_TEMPLATE.md` + signed-off `surface-01` Access tables used
  non-existent "Advanced/Basic Member" roles. **FIXED** → the six canonical C1 roles (Super Admin, Admin,
  Finance, HR, Account Manager, Standard User); template now carries a "use the six roles, never invent" note.
- **`PERMISSION_NODES.md` did not exist** (referenced 35×, owed since ADR-006). **CREATED** at repo root — the
  canonical catalog, 37 nodes harvested from C0–C10 + config, fields per FR-1.PERM.005 (Description / Default
  roles / Scope / Added-in); 5 unseeded stubs flagged ⚠️ (default-deny per OD-030).
- **Surface count 13-vs-14** — playbook header said "13 files". **FIXED** → 14 (00–12 + 01b); README/SESSION-LOG
  already said 14.
- **`UI-CONFIG-AUTH` orphan + `surface-01b` listed-not-built** — **NOTED** in the playbook: UI-CONFIG-AUTH is
  absorbed into surface-01 `#auth` (not a standalone surface); surface-01b is a known not-yet-built link target.
- **Pre-existing, NOT patched (needs an operator decision, flagged for a future session):** C0 OWED-FR-1
  (missed/never-arriving webhook reconciliation homing, C0 L819–823) is still "confirm at sign-off" — it needs a
  component-ownership call (C2/C3/C7/C9) = a real OD, not a doc fix. Does not block surface-00.

---

## Session 29 — 2026-06-28 — PHASE 3 ENTERED (SURFACES) — PRE-ENTRY PASS + C9 CHANGE-CONTROL ADDENDUM

**Phase 3 entered.** Pre-entry pass completed: surface inventory collected (17 formal `UI-` stubs + 94 review-scaffolding entries + `UI-config-admin` 11 sections from Phase 2 Appendix B), consolidated into ~12 logical surface files, ordering agreed. `spec/03-surfaces/` exists and is empty — ready.

**Inputs reviewed:** operator's `AIOS_prototype.html` prototype (31 planned dashboards) + `AIOS Dashboard Planning.md`. Key finding: the vast majority of planned dashboards map cleanly to existing Phase 1 FRs. The `s-c-*` control-plane screens (Fleet Clients, Deploys, Health, Provisioning, Migrations, Workflows, Cost, Plugins) map to C7 MGM + C10 and will be Phase 3 surfaces.

**V2 deferrals logged (OOS-034–038):**
- OOS-034: Objectives / OKR hierarchy
- OOS-035: Projects (task grouping)
- OOS-036: Priority Matrix / Eisenhower grid
- OOS-037: Brain Dump (quick-capture scratchpad)
- OOS-038: Field Ops / Mission Manager

**Credential Vault resolved:** platform secrets = env-only (Phase 2, Group N, class SECRET — no UI). Connector OAuth status = visible via management-plane surfaces. No standalone vault UI.

**C9 change-control addendum — DONE:** +FR-9.CMD.006–008 (user-defined custom commands — the "Commands" feature):
- Operator vision: user-defined slash commands that work like Claude Code skills — `/command-name` → inline result in chat, no async queue, no task_queue entry.
- FR-9.CMD.006: custom command definition (slug, prompt template, assigned agent, PERM node) stored in `commands` table.
- FR-9.CMD.007: custom commands registered in CMD dispatch alongside system commands; slug collision with system commands rejected at save.
- FR-9.CMD.008: invocation — template resolved with `$ARGUMENTS`, dispatched to assigned agent, result inline with answer-mode pill; same C6 guardrail pipeline as any agent run.
- C9 header updated: CMD ×5 → ×8, 28 FRs → 31 FRs. Matrix rows added. PERM stub `PERM-commands.manage` (→ PERMISSION_NODES.md, C1 FR-1.PERM.005; default Super Admin + Admin). DATA stub: `commands` table (→ Phase 4).
- UI surface: `UI-COMMANDS` added to Phase 3 surface list (Commands management screen where admins create/edit custom commands).

**Surface ordering agreed for Phase 3:**

| # | File | Coverage |
|---|---|---|
| 00 | `surface-00-auth.md` | UI-LOGIN, UI-2FA-*, UI-INVITE-SETUP, UI-REAUTH-PROMPT, UI-SUPPORT-REQUESTS |
| 01 | `surface-01-config-admin.md` | UI-config-admin #auth…#secrets (11 sections) — Phase 2 Appendix B carry-in |
| 02 | `surface-02-user-mgmt.md` | UI-USER-MGMT, UI-ROLE-MGMT, UI-PERMISSION-MATRIX, UI-CLEARANCE-*, UI-RESTRICTED-GRANT |
| 03 | `surface-03-ingestion-queue.md` | UI-INGESTION-QUEUE, conflict review queue |
| 04 | `surface-04-approval-queue.md` | Approval queue dashboard (C6 tiers) |
| 05 | `surface-05-dashboard-ops.md` | Ops dashboard: system health, connector health, event log, DLQ, cost, guardrail log, self-improvement |
| 06 | `surface-06-dashboard-super-admin.md` | Super Admin dashboard + management-plane screens (s-c-*): fleet clients, deploys, health, provisioning, migrations, cost, plugins |
| 07 | `surface-07-dashboard-agency.md` | Agency Owner + Manager view, activity feed, notification centre |
| 08 | `surface-08-dashboard-user.md` | Standard user view: My Workspace, Inbox, Decisions, chat |
| 09 | `surface-09-agent-builder.md` | Agent Fleet, Agent Builder / specialist config, Orchestration |
| 10 | `surface-10-commands.md` | UI-COMMANDS — custom command management (FR-9.CMD.006–008) |
| 11 | `surface-11-memory-nav.md` | Memory navigation / entity browser |
| 12 | `surface-12-mobile.md` | Mobile surfaces (6 sub-surfaces) |

**Surface-01 (Config Admin) — DONE ✅**
`spec/03-surfaces/surface-01-config-admin.md` — 613 lines. All 11 sections (#auth #memory #tools #prompts #loops #guardrails #observability #agents #proactive #infra #secrets), all 117 scalar + 11 secret + 10 structured CFG rows wired, all 5 states per section. OD-098–103 resolved (operator: "take your recs"): "System Config" nav · `UI-config-audit-log` separate surface (added to Phase 3 list — now 14 surfaces total) · desktop banner mobile · BOOT confirm only when dirty · `secret_manifest` deploy-hook table · per-section save. Verification gate CLEAN (all 4 checks PASS). Phase 4 stubs: `config_values` · `config_audit_log` · `secret_manifest`.

**Next: `surface-00-auth.md`** — UI-LOGIN, UI-2FA-CHALLENGE, UI-2FA-ENROLL, UI-INVITE-SETUP, UI-REAUTH-PROMPT, UI-SUPPORT-REQUESTS. Carry-in: C0 FRs (AUTH/SESS/INV/SEED/REC/WHK areas), Block J feasibility findings (Supabase Auth vendor facts), ADR-006 §RLS session boundary.

---

## Session 28 — 2026-06-27 — PHASE 2 (CONFIG REGISTRY) ENTERED — HARVEST + REGISTRY DRAFTED, VERIFICATION-GATE CLEAN

**Phase 2 begun.** Output: `spec/02-config/config-registry.md` (authoritative) + `spec/02-config/_HARVEST.md`
(working artifact). **~117 scalar knobs + 11 secrets + 10 structured objects**, every row classified
(SECRET/BOOT/LIVE/REBUILD) · defaulted · validated · `PERM-`-gated · `UI-`-surfaced. **Zero `???`** —
Phase-2 gate met. Verification gate (independent zero-context subagent): **CLEAN PASS on all 6 checks**
(coverage 1:1 · zero-??? · class sanity · cross-key constraints satisfied by defaults · locks held ·
conflict resolutions applied).

**Method:** operator chose "full harvest first." 4 Explore subagents (C0–C3 / C4–C7 / C8–C10 component
sweeps + a design-doc tunable sweep). Then a 3-agent gap-hunt. Then descriptions added to every row (the
operator flagged the first draft was unreadable — descriptions had been stripped; restored). Then the
registry built with per-GROUP PERM/UI assignment (not per-key — every knob in a group shares one
`PERM-config.<group>` gate + one `UI-config-admin#<group>` section).

**The gap-hunt payoff (real omissions caught, not in any FR):**
- **8 platform SECRETs** missing → new group N: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `INNGEST_API_KEY`,
  `X_INTERNAL_TOKEN` (mgmt-plane push auth, ADR-001 §7), the 3 connector signing secrets, the Google
  Pub/Sub key.
- **`ef_search`** (memory recall/latency dial, design L1511) — no CFG stub existed.
- **12 design-block knobs** with no FR home (4 ranking weights, 6 polling intervals, default/lightweight
  model, checkpoint thresholds, push frequencies, a few alert thresholds) — registered, additive, no
  change-control needed.
- **Alert routing has NO owner** (genuine Phase-1 hole, not a harvest miss) → **OD-097**.

**Decisions (operator delegated, "i trust your recs"):**
- **3 conflicts** resolved locked-spec-beats-stale-design: `parallel_execution_enabled`=false ·
  `embedding_model`=REBUILD (not BOOT) · `invite_link_ttl`≤24h / `access_token_ttl`=1h (design's 72h/7d
  were refuted by Block J).
- **2 class calls:** `entity_types`=BOOT · `default_model`/`lightweight_model`=BOOT.
- **OD-097** → C7 owns a small alert-routing config (`SLACK_WEBHOOK_URL` secret + `alert_routing_rules` /
  `escalation_contacts` / `quiet_hours` editable, Slack+email), recipients via C1 roles.

**Three-tier mental model agreed with operator (frames the whole phase):** Tier 1 = day-to-day record
management (users/roles/agents/memory curation) → Phase 3 surfaces + Phase 4 data, NOT config. Tier 2 =
harness tuning knobs → this registry. Tier 3 = secrets → env-only. "Customisable where it *should* be" =
bounded on purpose: the seven hard limits, sole-writer identity, and floored autonomy rows are
deliberately LOCKED, marked as such, never specced as editable.

**Downstream wiring captured (Appendix B):** 11 new `PERM-config.*` nodes owed to `PERMISSION_NODES.md`
(C1 FR-1.PERM.005); new `UI-config-admin` surface + 11 sections owed to Phase 3.

**C7 alert-routing addendum — DONE (change-control, same session).** OD-097's behavioural half realised as
**`FR-7.ALR.009`**: C7 owns the routing config; an alert with no deliverable destination fails loud (persists on the
dashboard + raises an "alert delivery misconfigured" critical condition on the mgmt-plane push); quiet-hours can
never silence a critical/hard-limit alert; a config write that would strand a critical alert is rejected fail-closed.
C7 header 33→34 FRs (ALR ×8→×9), matrix row added, OD-097 CLOSED. (Reuses the ALR.005/006/008 patterns.)

**Proposed defaults — CONFIRMED & locked** (operator: "as long as i can edit these later i am happy", 2026-06-27).
~30 knobs Phase 1 left blank were given starting defaults; `(proposed)` tags stripped. All are LIVE/BOOT —
operator-editable post-deploy via `UI-config-admin`. Confirmed editability was the operator's only condition.

**PHASE 2 SIGNED OFF (2026-06-27).** Registry complete + verification-CLEAN + OD-097 closed + defaults confirmed.
README Phase-2 row → 🟢 COMPLETE.

**Next: Phase 3 — Surfaces.** First surface to spec is `UI-config-admin` (the screen that renders this whole
registry, sectioned per group), then the Tier-1 day-to-day management screens (User Management, Permission Matrix,
Agent Builder, the 5 observability dashboards, memory navigation). Carry-in for Phase 3: Appendix B's new
`UI-config-admin` + 11 sections; the per-component panel-signal seams C7 left for Phase 3.

**Commits:** registry (f607751); C7 addendum (254a2ff); defaults-confirmed + sign-off to follow this entry.

---

## Session 27 — 2026-06-27 — COMPONENT 10 (INFRASTRUCTURE & COMPLIANCE) DRAFTED, VERIFIED & APPROVED — **PHASE 1 COMPLETE** 🎉

**The FINAL Phase-1 component** — the deployment / management-plane / lawful-deletion layer. Output:
`spec/01-requirements/component-10-infra-compliance.md` (**34 FRs, all Approved**), `system-map/10-infra-compliance.md`,
34 matrix rows, OD-089…OD-096 logged+resolved, feasibility **block U (AF-132…AF-137)**, OOS-033. **Two carry-in
Phase-1 debts cleared via change-control (OD-068, OD-074).** With C10 Approved, **Phase 1 (C0–C10, all 11 components)
is COMPLETE.** Next: Phase 2 (Config).

**The key scope finding (set with the operator up front):** the design doc's literal `## 10.` section (**L3919–4112**)
is **only compliance** (retention / individual erasure / client offboarding). The **infrastructure** half is decided
in the **ADRs (001/005/008)** and lives in orphaned design lines (deployment model L15–36, migration propagation
L1138–1160, the management plane / `client_registry` L1164–1240) that **no component C0–C9 claimed**. Since "every
design line → ≥1 FR, no orphans" is the definition of done and C10 is the last component, those orphans had to land
here. **Operator chose (AskUserQuestion): "functional infra + compliance in C10; backup/DR → Phase 5."** Backup/DR
(ADR-008) is only *referenced* — already routed to Phase 5 (C2 AC-2.MNT.017.2, README Phase-5 row).

**Area codes:** RET ×2 · DEL ×7 · OFF ×6 · PRV ×4 · MGT ×4 · DEP ×5 · MIG ×2 · ISO ×3 · LEG ×1. **C10 owns:** the
**intentional-retention** principle + retention configs · the **individual right-to-erasure** workflow (intake queue →
identify → conditional delete → redaction → audit → connector-flag → two-person auth; **wraps C2 FR-2.MNT.017**, does
not re-spec it) · the **client offboarding** workflow (trigger → verified export + client sign-off → retention-freeze
→ hard-delete/deprovision → compliance meta-record) · **provisioning** orchestration (ADR-005 §5) · the **release
model** (Railway auto-deploy · canary/release-train promotion gate · rollback-by-redeploy/no-down-migration ·
version-skew alert · plugins-out-of-train) · **schema-migration propagation** + per-deployment failure isolation · the
**management plane** (`client_registry` schema/lifecycle + the ingest endpoint, push-only, ADR-001 §7) · **isolation**
(`client_slug` deleted from app tables) + **residency** (v1 Sydney lock, v2 selection). **Seams:** erasure mechanics →
C2; log redaction → C7; token revocation → C3; seed → C0/C1; reporter+dashboards+staleness → C7; backup/DR → Phase 5;
rendering → Phase 3.

**Drafting:** two Explore subagents — one decomposed the §10 compliance lines, one mapped the infra ADRs + orphaned
deployment/management-plane design lines + checked what's already owned. Caught up front: cold-storage tiering is
**already OOS-016** (v2-deferred), not a new FR; individual erasure overlaps C2 FR-2.MNT.017 (C10 wraps, C2
mechanises).

**8 ODs resolved (OD-089…096), all delegated to recommendation; 5 touch the non-negotiables:** **OD-089 (#2/#3)**
offboarding partial-deprovision → `deletion_failed` + escalate, never-complete-on-partial, no-auto-rollback (OD-010
consistent). **OD-090 (#1)** export verified-complete **and** client-acknowledged = hard gate before destruction.
**OD-091 (#2/#3)** deployment-freeze enforcement → C10 sets `status=frozen`, **C5 dispatch layer enforces + fails
closed** (applied via change-control to **AC-5.TRG.001.3**, mirroring the C8 OD-081 memory-scope wiring). **OD-092
(#1/#2)** erasure name-in-content → deterministic auto, fuzzy human-confirm. **OD-093 (#2)** two-person auth = distinct
authoriser (no self-second). OD-094 (manual promotion v1), OD-095 (skew defaults 3/14). **OD-096 (#2 isolation, raised
in drafting):** the `client_slug` **label-vs-delete** tension — ADR-001 §3 (Accepted) says "deleted from all app
tables" but prior components reconciled only to "a label, not an RLS key." Carried to the **ADR terminus: delete**
(the column was never load-bearing; reverses no prior decision; Phase-4 creates no column).

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass — CLEAN.** Zero orphans (every §10 + infra cross-cut intent maps to an FR/seam/OOS),
  **all 6 traps PASS** (`client_slug` deleted + OD-096 reconciled · backup/DR seamed-not-owned · management plane
  push-only + metadata-only · erasure delegated to C2 · deletion deliberate-never-partial-silent · 10/10 citations
  sound), all 3 change-control edits consistent.
- **Quality/failure pass — 9 findings (2 HIGH, 4 MED, 3 LOW), ALL reconciled in-file.** **H1** a frozen deployment
  would false-alarm as *dead* (and a dead one could hide as *frozen*) → **+AC-10.OFF.004.4** (`status`
  server-authoritative, consumed by C7 staleness — frozen = expected-quiet not dead-alert, while Supabase
  project-health is still independently monitored — a #1 silent-deletion guard). **H2** export-verification could fail
  *open* → **+AC-10.OFF.002.4** (fails closed; only affirmative verified-complete advances). **M1** the C2 erasure C10
  calls had no verify-complete/fail-closed guarantee (OD-074 widened it across a C2→C7 boundary) → **+AC-10.DEL.003.4**
  (verify C2 complete before the audit-done) + **C2 AC-2.MNT.017.5** (verified-complete-or-fails-loud) + **AF-137**.
  **M2** fail-open in two-person-config / connector-flag-raise / ack-write → +AC-10.DEL.006.4 + AC-10.OFF.003.4. **M3**
  offboarding progress + meta-record must be management-plane-resumable → +AC-10.OFF.005.4. **M4** token revoke could
  orphan a live credential → +AC-10.OFF.005.5 (revoke first / re-driven). **L1** RET.001 had no enforcement consumer →
  +AC-10.RET.001.3 (C2 sole-writer + tombstone is the detector). **L2** header count fixed (34). **L3** neighbouring
  stale notes cleaned (C5 header, C7 carry-forward).

**Two Phase-1 debts cleared this session (change-control — the last component is where they had to land or leak past
Phase 1):**
- **OD-068** → wrote the owed **C6 FR-6.RTL.004** (cost-ladder enforcement: C7 meters → C6 decides → C5 executes;
  soft→throttle→hard-kill; never overrides a hard limit; every rung writes `guardrail_log`). OD-068 carry-forward
  CLOSED.
- **OD-074** → amended **C2 FR-2.MNT.017** (**AC-2.MNT.017.4**) to trigger the C7 log redaction-tombstone
  (`event_log`/`guardrail_log`) on erasure, called from C10 FR-10.DEL.004. The two stale C7 carry-forward notes
  flipped to ✅ CLOSED.

**Sign-off:** user-authorized 2026-06-27 ("i approve, push to github and main"; OD-089…096 delegated, the
C2/C5/C6/C7 change-control amendments accepted). **34 FRs `Approved`.** **No build-time viability gate holds any C10
FR** — AF-132…137 gate the deprovision/export/erasure/freeze/legal/erasure-verify *claims* (block U), not the FR
machinery.

**Files changed:** `component-10-infra-compliance.md` (new, 34 FRs Approved); `component-06-guardrails.md`
(+FR-6.RTL.004, OD-068); `component-02-memory.md` (+AC-2.MNT.017.4/.5, OD-074 + gate M1); `component-05-harness.md`
(+AC-5.TRG.001.3 freeze gate, OD-091; header note); `component-07-observability.md` (2 carry-forward notes → CLOSED);
`open-decisions.md` (OD-089…096 → 🟢; OD-068 carry-forward CLOSED; next OD-097); `feasibility-register.md` (block U
AF-132…137; next AF-138); `out-of-scope.md` (OOS-033; next OOS-034); `traceability-matrix.csv` (34 C10 rows);
`glossary.md` (+7 terms — client_registry, internal_token, client offboarding, deployment freeze, individual erasure,
deletion audit log, offboarding meta-record); `system-map/10-infra-compliance.md` (new); `system-map/README.md` (10 ✅
built); `README.md` (Phase 1 → COMPLETE + C10 row); this log.

**Carry-forwards / housekeeping:** (1) **Phase 4 (data model):** create **no `client_slug` column** in any app table
(OD-096); the three "label, not RLS key" mentions (C5 FR-5.QUE.002, C2, C6 `guardrail_log`) get a one-line clerical
reconciliation note then. (2) **Phase 3 surface seam (H1):** wire C7's staleness path to read `client_registry.status`
(frozen ≠ dead-alert) + independently monitor Supabase project-health — a small C10↔C7 seam at the C7/Phase-3 pass.
(3) New nodes to register at C1 reconciliation / Phase 2: the C9 `PERM-guardrail.edit_autonomy` + `/`-command nodes
(carried from session 26). (4) AF-132…137 + the carried-in AF-004/013/020/064/065/066/071 are build-time MUST-TEST.

**NEXT STEP — Phase 1 is COMPLETE. Begin Phase 2 (Config registry).** Per the README plan: classify + surface every
tunable — "every CFG has a surface + edit-mechanism + validation; zero `???`." The `CFG-*` ids scattered across
C0–C10 FRs (e.g. C10's `client_offboarding_retention_days`, `deploy_max_version_skew`, `canary_soak_minutes`,
`deployment_region`; the C9 autonomy matrix; the C6 thresholds; the C2/C5 windows) are the raw input — Phase 2
consolidates them into the config registry (`spec/02-config/`). Read `phase-playbooks.md` for the Phase-2 procedure
before starting.

---

## Session 26 — 2026-06-27 — COMPONENT 9 (PROACTIVE INTELLIGENCE) DRAFTED, VERIFIED & APPROVED — "what it does without being asked"

Tenth Phase-1 component, the **proactive-generation + cold-start-gating + chat-command layer**. Output:
`spec/01-requirements/component-09-proactive.md` (**28 FRs, all `Ready`**, gate-clean, **awaiting operator
sign-off**), `system-map/09-proactive.md`, 28 matrix rows, OD-082…OD-088 logged+resolved, feasibility block T
(AF-127…AF-131), OOS-031/032. A C6 Approved FR amended via change-control (OD-088). Pattern-matched the C0–C8 loop.

**C9 = "what it does without being asked"** (L3654). Area codes: MODE ×4 · PRO ×7 · SUG ×5 · CST ×7 · CMD ×5. C9 owns
the **three proactivity modes** (Suggest/Prepare/Act, mode = f(C6 risk tier), **no-bypass** — every Act traverses the
same C6 pipeline), the **7 generators** (relationship/meeting/doc/derisking/opportunity/daily-briefing/pattern; each
independently enable/disable-able + thresholded), the **suggestion lifecycle** (`proactive_suggestions` store, rank /
explain-with-pill / deliver-route / **dismissal-learn-with-floor**), the **cold-start phase ladder** (consumes C2's
phase, owns proactive-suppression), and the `/` **command dispatch** (node-gated). Enforcement → C6, slow-loop +
briefing trigger → C5, Insight-Agent def → C8, coverage/`[Building]` → C2, delivery → C7, all rendering → Phase 3.

**Scope call (entry): generation + cold-start policy + command dispatch now; enforcement / delivery / surfaces / the
coverage metric stay seamed.** A large fraction of section 9 is owned by Approved components (the coverage metric
already C2 FR-2.MAT.002/RET.007; the slow loop C5 FR-5.LOP.001; the Insight Agent C8 FR-8.SPC.006; notification C7;
guardrails C6). C9 **produces** proactive items + assigns mode + gates the engine; home components enforce/schedule/
deliver/render. Mirrors C8's "produce signals, others act" + C7's "backbone now, surfaces → Phase 3."

**The founder-holiday problem (L3792–3864)** is handled as an **integration narrative** (no orphan — the 8
break-points map to C2/C4/C5/C6/C7/C8/C9); the founder-prep checklist + initialisation guide = operational documents
→ **OOS-031/032**.

**7 ODs delegated + 1 operator-decided (OD-082…OD-088):** OD-082 dedicated `proactive_suggestions` store
(never-dropped; Prepare → linked C5 task). **OD-083 (#2)** proactive Act never bypasses C6 (no second risk
classifier). **OD-084 (#1/#3)** dismissal-learning floor — tunes *volume*, never *safety*; a derisking signal is never
silenced + re-surfaces on escalation. OD-085 cold-start: C2 emits phase, C9 owns policy matrix + suppression, rest
seamed. **OD-086 (#2, contradiction caught)** `/`-command gating → **C1 permission nodes, not the design's "Agency
Owner" role** (which is NOT one of C1's six — same class as C7/C8 `client_slug`). OD-087 founder docs → OOS.
**OD-088 (operator-decided #2 → option b)** — the **configurable action-autonomy matrix**: the operator flagged that
C6's blanket "all external comms = hard" (FR-6.APR.002) is too blunt — a cold-lead nurture email can't even be
drafted. Split: **low-risk external** (cold-lead / templated nurture to **non-client** contacts) → configurable down
to Prepare or up to **Act after a trust period** (rate-capped + audited); **floored** (existing-client / SoR comms,
financial, Confidential/Restricted) → **fixed at hard, never configurable below**. **Applied via change-control to
C6 FR-6.APR.002 + FR-6.APR.003** (narrow the mandatory-hard "external" element; reconcile the no-irreversible-auto
rule to "floored-external") + **new FR-9.MODE.004** (the matrix + the floor; `CFG-action_autonomy_matrix`; edits
gated `PERM-guardrail.edit_autonomy` Super-Admin). Also added: each of the 7 PRO scanners individually
enable/disable-able (default on) + thresholds → `CFG-scanner_*_enabled` refs for Phase 2.

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass — CLEAN.** Every intent L3650–3918 maps to an FR / correct seam / OOS; **all 6 traps
  PASS** (no "Agency Owner" role — node gating · consumes C2 coverage, never recomputes · proactive Act never
  bypasses C6 · OD-088 floored set can't be lowered to Act/Prepare · Insight Agent not redefined / no second writer ·
  14/14 citations verified); no `client_slug`. Two editorial nits fixed (stale FR count; a MAT.002/003 citation).
- **Quality/failure pass — critical floor-check NO HOLE + 9 findings (2 HIGH, 4 MED, 3 LOW), ALL reconciled.** The
  **operator-requested critical check** confirmed **nothing financial / existing-client / SoR / Confidential /
  Restricted can reach autonomous Act** through the new matrix — defended in depth (write-time reject 004.2 →
  mode-assign floor 002.2 → C6 tier floor AC-6.APR.002.1/.3 → ambiguity-defaults-floored 004.3 → non-overridable
  hard-limit backstop), OD-056 irreversibility exception bounded to non-client low-risk + rate-capped. **H1** (the
  residual the floor-narrowing *introduced*): a *confident-but-wrong* client/content tag is the one unguarded route →
  **+AC-9.MODE.004.5** (re-resolve recipient client-status vs the system-of-record **at send time**, re-floor on
  match) + **AF-131** (classification-accuracy EVAL). **H2** Insight-detected escalating risks have no C6/C7 path →
  sharpened AC-9.CST.002.3 + **+AC-9.PRO.004.4** (OD-084 floor spans dismissal **+** cold-start suppression **+**
  scanner-disable). **M1** deferred floor item silent-expiry → +AC-9.SUG.002.3. **M2** stuck-`generated` →
  +AC-9.SUG.001.4 (escalate-don't-abandon). **M3** node-gate-before-confirm + `/forget`→C2 trace → +AC-9.CMD.003.3.
  **M4** floored-caps-mode precedence → +AC-9.MODE.004.6. **L1** scan-execution liveness, **L2** stale-phase
  fail-open, **L3** audit-critical command fail-closed on log failure — all added.

**Sign-off:** user-authorized 2026-06-27 ("i am happy"; OD-082…087 delegated, OD-088 operator-decided, the C6
change-control amendment accepted). **28 FRs `Approved`**; matrix rows + headers + README + system-map README flipped
to Approved; committed + pushed to `main`. **No build-time viability gate holds any C9 FR** — AF-127…131 gate the
detection/learning/ranking/ETA/tag-accuracy *claims* (block T), not the FR machinery; **AF-131** is the load-bearing
one (the OD-088 floor's #2 safety rests on the non-client/content classifier).

**Files changed:** `component-09-proactive.md` (new, 28 FRs Ready); `component-06-guardrails.md` (FR-6.APR.002/003
amended, change-control OD-088); `open-decisions.md` (OD-082…088 → 🟢; next OD-089); `feasibility-register.md` (block
T AF-127…131; next AF-132); `out-of-scope.md` (OOS-031/032; next OOS-033); `traceability-matrix.csv` (28 C9 rows);
`glossary.md` (+6 terms — proactivity mode, proactive suggestion, cold-start phase, action-autonomy matrix, floored
external comms, dismissal-learning floor); `system-map/09-proactive.md` (new); `system-map/README.md` (09 ✅ built);
`README.md` (status + Phase-1 row); this log.

**Carry-forwards / housekeeping:** (1) **AF-131** (non-client/content classification accuracy) is the new
load-bearing build-time gate — the OD-088 floor's #2 safety rests on it; MUST-TEST. (2) The OD-088 + OD-086 new nodes
(`PERM-guardrail.edit_autonomy` Super-Admin; the per-command `/` gating nodes) to register at the C1 reconciliation /
Phase-2 config. (3) Still owed from earlier: the **C6 cost-ladder enforcement FR** (OD-068) + **C2 FR-2.MNT.017**
log-sink erasure amendment (OD-074). (4) AF-127…131 are build-time MUST-TEST.

**NEXT STEP — component 10 (Infrastructure & Compliance), the FINAL Phase-1 component.** Design-doc section
**`## 10. Infrastructure & Compliance` = L3919+** (confirm the end bound — `## Where the quality actually lives` at
L4113 is likely the next `##`). Pattern-match the C0–C9 loop: Context Manifest → decompose → cite → log ODs (next
**OD-089**; new AFs from **AF-132**; next OOS **OOS-033**) → resolve → verification gate (2 zero-context subagents) →
sign-off → wire matrix + build `system-map/10-infra-compliance.md`. **C10 is where the deployment/infra ADRs land:**
ADR-001 (Silo isolation + hybrid ownership + the management plane), ADR-005 (deploy/provisioning — canary +
release-train + scripted provisioning), ADR-008 (backup/DR — hourly client-owned snapshot + PITR upsell +
operator-verified restore), and the **compliance** surface (data residency, the GHL PHI/BAA chain AF-098, erasure
already homed in C2 FR-2.MNT.017 + C7 redaction-tombstone). **Carry-ins:** the owed C6 cost-ladder FR (OD-068) + C2
MNT.017 log-sink amendment (OD-074); the self-hosted-Inngest deferral (OOS-028); build-time spikes AF-001/002/004 +
the provisioning AF-004; backup/DR block I (AF-069…072). **C10 may be a connector-research trigger** only if it
introduces a new external sink (e.g. a paging/infra vendor). **First, finish C9: get the operator's sign-off + commit.**

---

## Session 25 — 2026-06-26 — COMPONENT 8 (AGENT DESIGN) DRAFTED, VERIFIED & APPROVED — "who does the work"

Ninth Phase-1 component, the **routing + agent-definition layer**. Output: `spec/01-requirements/component-08-agent-design.md`
(**37 FRs, all Approved**), `system-map/08-agent-design.md`, 37 matrix rows, OD-075…OD-081 logged+resolved, feasibility
block S (AF-121…AF-126), OOS-030. Pattern-matched the C0–C7 loop end-to-end in one session.

**C8 = "who does the work"** (vs C5 what makes it run). Area codes: ORC ×8 · REG ×6 · SPC ×6 · SCO ×3 · PLAN ×4 ·
HLTH ×4 · LRN ×3 · COST ×3. C8 owns the **orchestrator + 7-step description-driven routing**, the **`agents`
registry** (data-driven, versioned, auto-discovered), the **8 specialist definitions** + their hard limits,
**per-agent memory scoping**, **per-step failure-mode ASSIGNMENT** (C5 executes), **agent-health / drift /
dead-agent metric PRODUCTION** (flag-never-auto-correct), **orchestrator learning + result caching**, and
**cost-routing by complexity** + the confidence dial.

**Scope call set at entry: routing + definitions + metric-production now; execution / surfaces / healing stay
seamed.** A large fraction of the design section (L3371–3649) is already owned by Approved components — the context
envelope + retry/skip/halt execution + parallel/warm-up/checkpoints (C5), self-healing mechanisms (C2/C3/C5), the
dashboards (C7 + Phase 3), suggestion generation (C9), cost metering/enforcement (C7/C6), prompt content (C4). C8
**produces signals**; their home components surface/enforce/act. This kept C8 at 37 FRs and mirrors C6's "seam, don't
absorb" + C7's "backbone now, surfaces → Phase 3."

**Drafting:** an Explore subagent decomposed L3371–3649 + the cross-cut sites (checklist L321–335, `agents_config`
L945–965, failure-map drift/dead-agent rows L2845–2847, observability intervals L3120–3128/L3210–3220, orchestrator
own Layer 1 L2390) into ~112 intents pre-classified C8-OWN vs SEAM→Cx. Read the primary section directly to ground
the routing/registry/scoping cites. **Carried in OD-048's deferral** — `agents.system_prompt` reconciled here.

**7 ODs logged then resolved (OD-075…OD-081), 3 user-delegated #1/#2/#3:** **OD-076 (#1)** agent result cache →
scope-aware + time-bounded invalidation (write-triggered by the Memory Agent commit, miss-on-uncertainty — never a
stale hit). **OD-077 (#3)** low-confidence clarification → tracked + escalating (reuse C5 AC-5.QUE.005.2), never
silent park/auto-proceed. **OD-080 (#2)** registry edits → split by authority: capability grants
(memory_scope/tools_allowed/enabled) = Super Admin only; description/weight tuning = Super Admin + Admin. Plus
OD-075 (drop `system_prompt`, closes OD-048), OD-078 (drift/dead-agent flag-only, never auto-disable), OD-079 (seed
roster at provisioning). **All delegated** ("accept all my recommendations"). **OD-081 (#2)** was raised *by the
gate* — see below.

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass CLEAN** — every intent L3371–3649 + cross-cut sites maps or is correctly seamed; 5/6
  traps PASS, the 6th (citations) clean in spot-check. **Caught a real contradiction:** the design's
  `agents.client_slug` column contradicts **ADR-001 §3** (Silo model deletes `client_slug` from app tables) — C8
  was mis-citing ADR-001 §3 to *keep* it. **Dropped the column**, mirroring C7 OD-067; AC-8.REG.001.3 rewritten.
  Plus a dead citation `FR-2.RST.003` → `FR-2.RET.006`/`C1 FR-1.RST.003`, and `FR-5.TRG.*` slow-loop → `FR-5.LOP.001`.
- **Quality/failure pass — 10 findings (3 HIGH, 4 MED, 3 LOW), ALL reconciled.** **H1 (the structural hole):** the
  per-agent `memory_scope` matrix (the whole SCO area) had **NO enforcement consumer** — C2 enforces clearance/RLS,
  C5 FR-5.ASM.006 invokes it with task-clearance + task-entities, but nothing applied "which agent is running" at
  retrieval (#2 unwired, most acute for the `service_role` orchestrator narrowed by *nothing*). → **OD-081 resolved +
  applied via change-control** (the C7 in-session-fix precedent): **+AC-5.ASM.006.2** (harness passes the agent's
  `memory_scope` into the C2 read, **fails closed**) + **+AC-2.RET.004.2** (C2 drops out-of-agent-scope candidates
  before ranking, narrow-within-clearance); SCO.001 rewritten as a real retrieval filter (+AC-8.SCO.001.3
  fail-closed). **H2** orchestrator crash mid-route (dequeue→plan-persist) → +AC-8.ORC.001.3 idempotent re-route,
  never dequeued-but-unplanned. **H3** metric-producer silent stall → +AC-8.HLTH.004.2 producer liveness/heartbeat
  for HLTH.001/003 + LRN.002 (mirrors HLTH.002.2 + C5 AC-5.JOB.006.2). MED/LOW: +AC-8.LRN.003.2/.3 (write-triggered
  cache invalidation + miss-on-uncertainty, M4), ORC.008 service_role note (M5), +AC-8.SPC.003.3/.004.3 +
  AC-8.REG.006.3 (Comms/Finance tool-grant reject-at-write + positive seed check, M6), C6 cost-ladder carry-forward
  kept tracked (M7), +AC-8.ORC.007.2 secondary sink (L8), +AC-8.REG.005.3 warn-at-disable-last-agent (L9),
  +AC-8.PLAN.002.2 halt-escalate staleness (L10). Meta: C8 upholds the three non-negotiables; the biggest residual
  (H1) is now wired, not asserted.

**Sign-off:** user-authorized ("Sign off — Approve C8"; OD resolution delegated). 37 FRs `Approved`. **No build-time
viability gate holds any C8 FR** — AF-121…126 gate the routing/detection/cache/learning *accuracy claims*, not the
FR machinery (gate analog of C4 AF-111 / C6 block-Q / C7 block-R).

**Files changed:** `component-08-agent-design.md` (new, Approved); `component-05-harness.md` (+AC-5.ASM.006.2,
change-control OD-081); `component-02-memory.md` (+AC-2.RET.004.2, change-control OD-081); `open-decisions.md`
(OD-075…081 → 🟢; next OD-082); `feasibility-register.md` (block S AF-121…126; next AF-127); `out-of-scope.md`
(OOS-030; next OOS-031); `traceability-matrix.csv` (37 C8 rows); `glossary.md` (+7 terms — agent registry, memory
scope, routing/confidence score, drift/dead-agent detection, agent result cache, execution-plan version);
`system-map/08-agent-design.md` (new); `system-map/README.md` (08 ✅ built); `README.md` (status + Phase-1 row); this log.

**Carry-forwards / housekeeping:** (1) The **C6 cost-ladder enforcement FR** is still owed (OD-068) — C8 feeds it
(COST.003) but the throttle/kill enforcer doesn't exist; action when C6 is next touched. (2) AF-121…126 are
build-time MUST-TEST. (3) The OD-080 permission split implies new nodes `PERM-agent.edit_capability`
(Super-Admin-only) vs `PERM-agent.edit_routing` (Admin-allowed) — to wire at the C1 reconciliation / Phase-2 config.

**NEXT STEP — component 9 (Proactive Intelligence).** Design-doc section **`## 9. Proactive Intelligence` = L3650+**
(confirm the end bound + next `##` at decomposition). Pattern-match the C0–C8 loop: Context Manifest → decompose →
cite → log ODs (next **OD-082**; new AFs from **AF-127**; next OOS **OOS-031**) → resolve → verification gate (2
zero-context subagents) → sign-off → wire matrix + build `system-map/09-proactive.md`. **C9 is where many C8/C7
seams land:** the **Insight Agent** (C8 SPC.006 produces its output; C9 owns the proactive/pattern generation), the
**self-improvement panel suggestions** (C7 reserves the surface + C8 produces the agent-health/drift/routing metrics;
C9 turns them into surfaced/guided suggestions — "agent X 40% failure", "version 3 outperformed 4", "type Y
rerouted"), and the **three proactivity modes** (L3658+). **Likely seams out:** the dashboards → C7 + Phase 3;
enforcement → C6; memory mechanisms → C2; routing metrics → C8 (done). **Carry-ins:** the C6 cost-ladder FR (owed,
OD-068) · build-time spikes AF-001/002/004 · the C8 block-S AFs · AF-068/116/117. **C9 is NOT a connector
component** (no research-first gate) unless it introduces a new external sink.

---

## Session 24 — 2026-06-26 — COMPONENT 7 (OBSERVABILITY) DRAFTED, VERIFIED & APPROVED — "how you know what it's doing"

Eighth Phase-1 component, the **observability backbone**. Output: `spec/01-requirements/component-07-observability.md`
(**33 FRs, all Approved**), `system-map/07-observability.md`, 33 matrix rows, OD-067…OD-074 logged+resolved,
feasibility block R (AF-118…AF-120), OOS-028/029. Pattern-matched the C0–C6 loop end-to-end in one session.

**C7 = "how you know what it's doing"** — the data + logic layer of the three pillars (logging · monitoring ·
alerting). Area codes: LOG ×7 · RTP ×4 · ALR ×8 · COST ×4 · MGM ×5 · VIEW ×3 · OPT ×2. C7 owns the `event_log`, the
real-time-vs-polling contract, alerting (the 7 rules + routing + escalation + the engine watchdog), the cost meter +
ladder signal, the management-plane cross-deployment push (ADR-001 §7) + backup-health (ADR-008), and log
retention/export (incl. the C7 side of `guardrail_log`).

**Scope decision set with the operator up front: backbone now, surfaces → Phase 3.** C7 specs the observability
*functions* as Phase-1 FRs; the five role dashboards (Super Admin · Operations · Manager · Standard User · Mobile)
get only a thin "this view exists + RBAC-routed + sources these signals" contract, with full layout/state deferred
to the dedicated Phase-3 Surfaces pass. Each panel's *signal* is produced by its home component (C2/C3/C5/C6/C8/C9) —
C7 displays, it does not recompute. This kept C7 at 33 FRs and avoided both duplicating Phase 3 and usurping the
producing components. Mirrors C6's "seam, don't absorb" call. **The operator chose this** (vs full-dashboards-in-C7).

**Drafting:** an Explore subagent mapped L3031–L3328 → 80 intents + candidate area codes + the cross-cut sites that
land in C7. Read the primary section directly to ground the `event_log`/alerting/polling cites. **Caught up front:**
the `event_log` (L3048) + `guardrail_log` (L2896) schemas + the Realtime filters (L3085/3159) carry `client_slug` —
stale under the Silo model (ADR-001 §3 deleted it). Also grounded the cross-deployment views as **push,
operational-metadata-only** (ADR-001 §7), cost as **estimate-grade never the invoice** (ADR-003), and the three
distinct log sinks (OD-065).

**8 ODs logged then resolved (OD-067…OD-074), 2 user-decided:** **OD-068 (#2, user-decided)** cost-ladder enforcement
ownership → **C7 meters + signals, C6 decides, C5 executes** — grounded in **ADR-003 §"Guardrails component"** (the
cost ladder IS a C6 guardrail class). **OD-074 (#1/compliance, user-decided, surfaced by the gate)** erasure vs
append-only logs → **redaction-tombstone** (scrub PII in place, retain row + audit metadata). OD-067 (client_slug
drop intra-silo), 069 (escalate-don't-abandon), 070 (Slack-independent notification durability), 071 (stale-not-green
push), 072 (three-sink retention), 073 (per-silo connection budget + degrade-to-polling) — all delegated, all land
on (a).

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass CLEAN** — zero orphaned design lines (every intent L3031–3328 + checklist L304–326 maps
  or is correctly seamed — surfaces→Phase 3, signals→home components, cost-enforcement→C5/C6); no contradictions with
  ADR-001/003/008, glossary, or consumed C1–C6 FRs; **all 6 traps PASS** (`client_slug` label-only · cross-deployment
  PUSH-not-pull, never mirrors business data · three distinct log sinks, C7 owns guardrail_log view/retention/export
  not its write-completeness · cost estimate-grade never the invoice · surfaces→Phase 3 no signal usurpation · 10/10
  citations clean). One finalization item (registers not yet wired) — done this session.
- **Quality/failure pass — 13 findings (4 HIGH, 5 MED, 4 LOW), ALL reconciled.** The reviewer's meta-finding: C7 has
  the strongest #3 instincts of any component so far; the residual risk was **the observability layer becoming its
  own silent single point of failure**, plus two real cross-component seam holes. **F1 (HIGH)** cost-ladder
  enforcement seam: verified against **ADR-003 §"Guardrails component" (L181–182)** → OD-068(a) is correct; the
  contradiction was **C5's seam line ("C7 enforces") + C6's never-written cost-ladder FR** → C5 line **corrected via
  change-control** (2 spots), the owed **C6 cost-ladder FR logged as a tracked carry-forward**, FR-7.COST.003
  re-cited to ADR-003. **F2 (HIGH)** → +AC-7.MGM.002.3 (independent-heartbeat stale-evaluator — the stale-detector
  can't itself fail silently) + AC-7.MGM.001.3 (reporter logs each push to the *local* event_log). **F3 (HIGH)/OD-074**
  → redaction-tombstone (+AC-7.LOG.006.3 / .007.4; **C2 FR-2.MNT.017 amendment owed** — carry-forward). **F7 (HIGH)**
  → +FR-7.ALR.008 (alert-engine heartbeat + independent watchdog — "the watcher is watched"). **F8** → AC-7.LOG.003.2
  out-of-band degraded path. **F9** → +AC-7.LOG.003.3 cross-sink event_log↔guardrail_log reconciliation. **F6** →
  server-authoritative timestamps (AC-7.MGM.002.4 / AC-7.ALR.005.3). **F10/F11/F12** → cost-unknown sentinel,
  configurable connection-headroom threshold, pill-coverage thresholding seamed to C2. **F4/F5** → registers wired +
  statuses reconciled. AF-118 (absence-of-signal liveness), AF-119 (out-of-band durability), AF-120 (clock-sync) —
  all build-time, none holds an FR.

**Sign-off:** user-authorized — OD-068 + OD-074 decided directly, the rest delegated; gate clean + all 13 findings
reconciled in-file. 33 FRs `Approved`. **No build-time viability gate holds any C7 FR** (AF-118…120 gate the
silent-failure-detector *liveness/durability/correctness claims*, not the FR machinery — gate analog of C6's block-Q).

**Files changed:** `component-07-observability.md` (new, Approved); `component-05-harness.md` (cost-ladder seam line
corrected, change-control); `open-decisions.md` (OD-067…074 → 🟢; next OD-075); `feasibility-register.md` (block R
AF-118…120; next AF-121); `out-of-scope.md` (OOS-028 self-hosted Inngest, OOS-029 cross-deployment benchmarking;
next OOS-030); `traceability-matrix.csv` (33 C7 rows); `glossary.md` (+7 terms — notification centre, Supabase
Realtime, health reporter/push, staleness window, cost meter, answer-mode pill, redaction-tombstone);
`system-map/07-observability.md` (new); `system-map/README.md` (07 ✅ built); `README.md` (status + Phase-1 row); this log.

**Carry-forwards / housekeeping:** (1) **C2 FR-2.MNT.017** owes a change-control amendment to extend its transitive
erasure walk to `event_log` + `guardrail_log` (redaction-tombstone, OD-074). (2) The **C6 cost-ladder enforcement
FR** is owed — ADR-003 spawned it but C6 (session 23) didn't write it; tracked in OD-068; action when C6 is next
touched. (3) AF-118/119/120 are build-time MUST-TEST.

**NEXT STEP — component 8 (Agent Design).** Design-doc section **`## 8. Agent Design` = L3371–L3649** (next
`## 9. Proactive Intelligence` at L3650). Pattern-match the C0–C7 loop: Context Manifest → decompose → cite → log ODs
(next **OD-075**; new AFs from **AF-121**; next OOS **OOS-030**) → resolve → verification gate (2 zero-context
subagents) → sign-off → wire matrix + build `system-map/08-agent-design.md`. **C8 is where many C5/C7 seams land:**
the **orchestrator** (routing + confidence threshold — "the highest-leverage single tunable for cost vs quality",
L3632), the **agent registry** (`agents.system_prompt` — reconcile with C4 OD-048's unify-on-`prompt_layers`
decision), **agent specialisation drift detection** (L3642 — C7 reserves the surface, C8 produces the metric), and
**agent health / success-rate** metrics (C7 VIEW.001 displays them). **C8 also resolves the `agents.system_prompt`
single-source-of-truth** that C4 OD-048 deferred to C8. Likely seams out: observability/event-log → C7 (done);
proactive/insight-agent → C9; infra → C10. **Carry-ins:** the C6 cost-ladder enforcement FR (if C8 touches
orchestration cost), build-time spikes AF-001/002/004, AF-068/116/117, the C5 block-P + C7 block-R AFs. **C8 is NOT a
connector component** (no research-first gate) unless it introduces a new external sink.

---

## Session 23 — 2026-06-26 — COMPONENT 6 (GUARDRAILS) DRAFTED, VERIFIED & APPROVED — "what stops it doing something catastrophic"

Seventh Phase-1 component, the **enforcement layer** ("the code half" of system safety). Output:
`spec/01-requirements/component-06-guardrails.md` (**35 FRs, all Approved**), `system-map/06-guardrails.md`, 35
matrix rows, OD-060…OD-066 logged+resolved + carry-forwards **OD-047** and **OD-010** resolved, feasibility
block Q (AF-116…AF-117). Pattern-matched the C0–C5 loop end-to-end in one session.

**C6 = "what stops it doing something catastrophic"** (vs C5 what makes it run). Area codes: HRD ×4 · APR ×6 ·
ANM ×5 · RTL ×3 · ESC ×4 · INJ ×6 · LOG ×4 · OPT ×2 · FMM ×1. C6 owns the code-side enforcement of the four
guardrail layers (hard limits · approval gates · anomaly detection · rate limits), the escalation/flagged
workflow, the 4-step injection sanitization pipeline, the `guardrail_log`, and the optimisations. **ADR-007 is the
spine** (containment-first; detection-as-signal; semantic scan off-by-default; quarantine retains-not-discards;
0.85/0.95 are signal knobs not safety dials).

**Two scoping calls set up front (the architectural judgment):** (1) **the failure-mode map (L2821–2862) stays
SEAMED, not absorbed** — it's a cross-component catalogue; each row's detection lives in its home component
(C2/C3/C5/C8) + alert path is C7; C6 owns only the guardrail-class responses + the no-silent invariant (OD-061).
This kept C6 at 35 FRs instead of ballooning to 60+ and usurping C2/C3/C5/C8. (2) **hard limits are the
un-overridable layer, kept distinct from approval gates** (which ARE human-overridable) — L2066 vs L2782.

**6 new ODs + 2 carry-forwards resolved (OD-060…066 + OD-047 + OD-010):** **OD-047** (carry-forward, operator's
C3 flag) → **keep the seven hard limits absolute; gate-don't-promote coverage gaps** (bulk export / mass-delete /
connector spend route to hard-approval + rate caps, not new absolute limits — they keep a legitimate
human-authorized path); enforceability still gated on **AF-068**. **OD-060** (#2) → hard-limit hit = block+log+
alert, **no approve affordance** (the `status→approved` transition is invalid for `hard_limit`). **OD-064** (#2) →
soft-approval auto-executes **reversible-only** (irreversible is hard-tier by definition, reconciling C5 OD-056).
**OD-010** (#2, carry-forward) → **no auto-rollback** of external side effects (auto-compensation is itself an
autonomous action); instead show already-applied effects at review + queue a **human-visible cleanup task**;
irreversible effects surfaced as non-compensable. OD-061 (failure-map scope), OD-062 (rate-limit ownership split),
OD-063 (anomaly-as-signal severity), OD-065 (guardrail_log vs access_audit/event_log), OD-066 (semantic-off +
regex-quarantine) delegated to recommendation. **The four #2-touching (047/060/064/010) were surfaced to the
operator, who delegated** ("what do you suggest").

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass CLEAN** — zero orphans (all L2746–3030 + the L2053–2066 / L2976–2980 cross-cuts map
  or are correctly seamed), no contradictions with ADR-007/003/004/006, glossary, or consumed C0/C1/C3/C4/C5 FRs;
  **all 6 traps PASS** (`client_slug` label-only · C6 never usurps C2/C3/C5/C8 detection — the failure-map scope ·
  hard-limit-not-overridable kept distinct · semantic-scan off-by-default + thresholds are signal knobs +
  quarantine retains · anomaly-as-signal · 12 citations spot-checked, no miscites).
- **Quality/failure pass found 12 findings (3 HIGH, 6 MED, 3 LOW), ALL reconciled in-file.** The reviewer's
  meta-finding: the posture-level safety logic was already sound; the real risk was **mechanism wiring** — a
  guardrail correctly designed but never run, or failing open. The 3 HIGH closed exactly those: **+AC-6.INJ.001.2**
  (the injection pipeline's named harness call site between tool-read and AI-call + a C5 step-order
  reconciliation note — H1, the silent-bypass seam); **+AC-6.FMM.001.3** (a guardrail check that **itself errors**
  fails CLOSED — the missing #3 invariant, H2); **+AC-6.LOG.003.3** (a `guardrail_log` write-failure is
  fail-closed — the block holds even if the row fails, never rolls back into the action proceeding — H3). MED/LOW:
  +AC-6.APR.005.3 (no self-approval at the human tier — initiator ≠ approver, M1), +AC-6.ESC.001.3 (multi-fire
  precedence — hard_limit dominates, M2), manifest tightened (mid-task re-check mechanism is C5 FR-5.ASM.005, M3),
  +AC-6.ESC.004.3 (every wait-point has a named staleness owner, M4), +AC-6.INJ.006.4 (quarantine-review
  staleness, M5), +AC-6.OPT.001.2 (un-actioned candidate persists, M6), +AC-6.LOG.001.3 (`pending` disambiguation,
  L1), AC-6.RTL.001.1 meaningful-ceiling clause (L2), OD-047 sub-question CLOSED so no open sub-question points at
  an Approved FR (L3). Confirmed great-tier: ADR-007 reconciliations faithful, hard-limit-vs-approval split handled
  at three layers (FR + AC + schema-status), failure-map scope discipline, OD-010's no-auto-rollback care.

**Sign-off:** user-authorized (delegated, "what do you suggest" on all four #2-touching ODs). 35 FRs `Approved`.
**No build-time viability gate holds any C6 FR** — AF-068 gates the *enforceability claim* of the hard limits
(HRD.001/OD-047), AF-116 the anomaly-accuracy claim, AF-117 the injection-library-coverage claim (the gate analog
of C4's AF-111 / C5's block-P).

**Files changed:** `component-06-guardrails.md` (new, Approved); `open-decisions.md` (OD-047 + OD-010 → 🟢,
OD-060…066 added → 🟢; next OD-067); `feasibility-register.md` (block Q AF-116…117; next AF-118);
`traceability-matrix.csv` (35 C6 rows); `glossary.md` (+7 terms — approval tier, anomaly detection, guardrail_log,
escalation timeout, contextual approval routing, quarantine, flagged); `system-map/06-guardrails.md` (new);
`system-map/README.md` (06 ✅ built); `README.md` (status table + Phase-1 row); this log.

**Carry-forward / housekeeping:** (1) **C5 step-order reconciliation (INJ.001.2)** — C5 FR-5.ASM.007's step order
should name the injection-sanitization step explicitly (it currently names only the anomaly check); raised as a
C5 change-control note, to action when convenient (does not block C7). (2) The self-hosted-Inngest deferral
(C5 FR-5.JOB.007) still owes an OOS id at C6/C10 — **deferred to C7/C10** (next OOS = OOS-028); not homed this
session as C6 didn't touch the Inngest hosting question. (3) AF-068/116/117 are build-time MUST-TEST.

**NEXT STEP — component 7 (Observability).** Design-doc section **`## 7. Observability` = L3031–L3328** (next
`## The complete system loop` at L3329, then `## 8. Agent Design` at L3371). Pattern-match the C0–C6 loop:
Context Manifest → decompose → cite → log ODs (next **OD-067**; new AFs from **AF-118**) → resolve → verification
gate (2 zero-context subagents) → sign-off → wire matrix + build `system-map/07-observability.md`. **C7 is where
many C5/C6 seams land:** the **event_log** + metrics sinks, **alert delivery** (the dashboard alerts + admin Slack
that C6 HRD.002/ESC.002 *require* but C6 produces only the event), the **guardrail_log dashboard view + retention
+ tamper-evidence + export mechanism** (C6 LOG.004 owns completeness, C7 owns where it lives), the **cost-ladder
enforcement** (ADR-003; C5 feeds, C7 enforces), the **management-plane push / backup-health** (ADR-008, ADR-001
§7), **access_audit retention** (C1 OD-024 seamed retention to C7), the **answer-mode pill rendering** + prompt-
health signals (C4/C2 seamed to C7/C8). Likely seams out: orchestrator → C8; enforcement → C6 (done). Carry-ins:
OD-010 (now resolved for C5/C6) · build-time spikes AF-001/002/004 · AF-068/116/117 · the C5 block-P AFs ·
the management-API field gaps AF-070/071. **C7 is NOT a connector component** (no research-first gate) unless it
introduces a new external sink (e.g. a metrics/paging vendor) — if it does, that triggers the
`tool-integration-research.md` gate.

---

## Session 22 — 2026-06-26 — COMPONENT 5 (AGENT HARNESS) DRAFTED, VERIFIED & APPROVED — "what makes it run"

Sixth Phase-1 component, the **execution layer**. Output: `spec/01-requirements/component-05-harness.md`
(**43 FRs, all Approved**), `system-map/05-harness.md`, 43 matrix rows, OD-054…OD-059 logged+resolved,
feasibility block P (AF-112…AF-115). Pattern-matched the C0–C4 loop end-to-end in one session.

**C5 = "what makes it run"** (vs C2 what it knows, C3 what it can do, C4 what it is). Area codes: TRG ×5 ·
QUE ×6 · GRP ×4 · ENV ×3 · LOP ×5 · JOB ×7 · ASM ×9 · OPT ×4. C5 owns triggering, the **`task_queue`**
(permanent audit record), **versioned task graphs**, the **context envelope**, the **three loops**, the
**Inngest** engine + dead letter queue, the **prompt-stack assembly + run pipeline** (assemble 4 layers → pin →
safety-validate → gate → execute step-by-step → pill → complete), and the optimisations. **Scope boundary set
with the operator at entry: strict — C5 calls, C6 enforces.** Seams out: enforcement/approval-policy/anomaly-
detection → **C6**; event-log/metrics/alert-delivery → **C7**; orchestrator routing + agent registry → **C8**;
memory mechanisms → C2; tool execution → C3; prompt content → C4; RBAC rules → C1.

**Drafting:** Explore subagent mapped the design section (L2493–2745) + system loop (L3329–3367) → 79 intents +
10 candidate area codes (refined to 8). Spot-verified load-bearing cites (task_queue L2517–2535, loops
L2561–2575, envelope L2591–2609, Inngest L2624–2742). **Caught up front** that the subagent's "service_role
mid-task re-check is an open ambiguity" is **already settled** by C1 FR-1.RLS.007 / OD-031 — C5 *implements* the
machinery (FR-5.ASM.005), doesn't re-open it. Also reconciled `client_slug`=label-not-RLS, `'flagged'` status
vs the enum (→ OD-054), Inngest-vs-task_queue double-retry (→ OD-058).

**6 ODs logged then resolved (OD-054…OD-059):** OD-054 status enum **+ explicit guardrail/quarantine state**
(C5 schema, C6-set, distinct from approval-wait); OD-055 compression **summarize-but-retain-originals** (economy
never loss); **OD-056 (user-decided) parallel × approval = step-level gating + no-irreversible-outrun** (#2);
OD-057 loops **no concurrent same-loop + single catch-up** (no backfill stampede); OD-058 **Inngest = single
retry authority**, task_queue = audit projection; **OD-059 (user-decided) chained-task = fresh envelope +
handoff + B re-retrieves under its own scope/clearance** (#2). The two #2-touching calls (056, 059) decided by
the user directly; 054/055/057/058 delegated to recommendation. All landed on option (a).

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass CLEAN** — all L2493–2745 + L3329–3367 intents map (the 3 deferred seams —
  observability→C7, ingestion-filter mechanism→C2, oversight→C6/C7 — correctly seamed, not orphaned); no
  contradictions with ADR-003/004/005/006/007, glossary, or consumed C0/C1/C2/C4 FRs; **all 6 traps PASS**
  (`client_slug` label-only · C5 never usurps C6 enforcement/anomaly-detection/approval-policy · mid-task
  re-check consumes C1 not re-decides · no Inngest/task_queue double-retry · citations spot-checked ·
  `flagged` reconciled). 2 cosmetic miscites fixed (extraneous L2349 in TRG.004, L2343 in QUE.005 dropped).
- **Quality/failure pass found 11 findings (3 HIGH, 5 MED, 3 LOW), ALL reconciled in-file:** **+FR-5.TRG.005**
  (verified-event→task **at-least-once**, the C3→C5 seam-atomicity hole — a one-shot event has no loop catch-up,
  HIGH); **+AC-5.JOB.005.2** (fan-out partial failure never silent — HIGH); **+AC-5.QUE.005.2** (approval-wait
  staleness escalation, reusing C1 OD-028 / C2 OD-032 don't-silently-abandon — HIGH); **+AC-5.GRP.003.2/.3**
  (crash-window key-committed-before-side-effect ordering + collision-resistance — M1/L2); **+AC-5.ASM.009.2**
  (durable chained-successor creation, the internal chain seam — M2); **retention clauses** on AC-5.ASM.005.1 +
  AC-5.QUE.003.2 (quarantine/halt **retains WIP** — you can't compensate (OD-010) what you didn't retain — M3);
  **+AF-115** + FR-5.ENV.003 note (the originals-store retention lifetime — Inngest cloud step-state TTL may be
  shorter than the chain + audit window — M4); **+AC-5.JOB.006.2** (C5-emitted DLQ-not-empty heartbeat so the
  failure-handler can't itself fail silently — M5); **+AC-5.ASM.004.2** (late-discovered consequential action
  re-enters the approval gate — L1); **+AC-5.GRP.001.2** (graph-less task fails loudly at creation — L3).
  The reviewer's meta-observation: H3/M2/M5 are all "a hold/handoff waiting on a human or downstream sink with
  no staleness escalation" — C5 now adopts the standardized C1 OD-028 / C2 OD-032 escalate-don't-abandon pattern
  at all three wait-points. Confirmed great-tier: the six resolved ODs land the hard #1/#2 calls.

**Sign-off:** user-authorized (delegated, "Sign off — Approve C5"). 43 FRs `Approved`. **No build-time viability
gate holds any C5 FR** — AF-112…115 are build-time validations of the catch-up/parallel/compression/retention
*claims*, not of the FR machinery (gate analog of C4's AF-111).

**Files changed:** `component-05-harness.md` (new, Approved); `open-decisions.md` (OD-054…OD-059 → 🟢; next
OD-060); `feasibility-register.md` (block P AF-112…115; next AF-116); `traceability-matrix.csv` (43 C5 rows);
`system-map/05-harness.md` (new); `system-map/README.md` (05 ✅ built); `README.md` (status table + Phase-1 row);
this log. No new OOS (self-hosted Inngest deferral noted on FR-5.JOB.007, to home formally at C6/C10).

**Carry-forward / housekeeping:** The self-hosted-Inngest deferral (FR-5.JOB.007) should get an OOS id at
C6/C10 (next OOS = OOS-028).

**Repo self-sufficiency / handoff test RUN (2026-06-26, end of session 22) — PASS, gaps patched.** A
zero-context subagent read only the repo (start-of-session order) and confirmed C6 is fully resumable from the
repo alone: component, design bounds (**L2746–L3030**, next `## 7.` at L3031), the per-component loop, spine
**ADR-007**, the inbound C5/C3 seams, the carry-forward ODs (047, 010 — both fully written with options+recs),
and the next counters (**OD-060 / AF-116 / OOS-028**, all stated in register footers). It flagged one defect
class — a **C6-vs-C7 "Guardrails" numbering drift** — now **fully patched:** (1) **OD-047** register entry
relabelled C7→**C6** (2 spots); (2) the **entire C3 file** relabelled to canonical (it had been authored under
the old C7=Guardrails / C8=Observability numbering — every Guardrails "C7"→C6, every Observability "C8"→C7, with
the agent-design `C5/C6/C8` carry-ins + "C8 agent UX" preserved; a dated clerical change-control note added to
the C3 header — no FR/AC/decision/vendor fact changed). C0/C1/C4/C5 were already canonical. Verified: zero
non-keep-set C8 and all Guardrails refs now C6 in C3. **The repo is handoff-clean for the C6 (Guardrails) chat.**

**NEXT STEP — component 6 (Guardrails).** Design-doc section **`## 6. Guardrails` = L2746–~L3000** (confirm the
end bound at decomposition; Layer 1 hard limits L2754–2768, Layer 2 approval gates L2772–2782, Layer 3 anomaly
detection L2791–2803, boundary/sanitization L2940–2980, the failure-mode map L2821–2862). Pattern-match the
C0–C5 loop: Context Manifest → decompose → cite → log ODs (next **OD-060**; new AFs from **AF-116**) → resolve →
verification gate (2 zero-context subagents) → sign-off → wire matrix + build `system-map/06-guardrails.md`.
**C6 is where many C5 seams land:** hard-limit **enforcement** (the code half of "both prompt AND code", paired
with C4 FR-4.CID.004 + C3 FR-3.ACT.002), the **approval-gate tier policy + routing** (C5 QUE.005/ASM.004 only
move tasks to `awaiting_approval`), **injection sanitization + boundary tagging** (ADR-007, the mechanism C4
FR-4.CID.003 only states), **anomaly detection + thresholds** (C5 ASM.007 only invokes the check), and setting
the **`flagged` status** (C5 OD-054 defined the state, C6 sets it). **C6 also actions OD-047** (review the seven
hard limits — set / rigidity / enforceability — with the **AF-068** containment red-team) and is where
**OD-010** (compensation/rollback) lands substantively alongside C5/C8. **ADR-007 is the spine** (containment-
first; detection-as-signal; embedding scan off by default). Likely seams out: event-log/alerts → C7;
orchestrator → C8. Carry-ins: build-time spikes AF-001/002/004 + the C5 block-P AFs (AF-112…115) + AF-068.

---

## Session 21 — 2026-06-26 — COMPONENT 4 (PROMPT ARCHITECTURE) DRAFTED, VERIFIED & APPROVED — "what the AI is"

Fifth Phase-1 component. Output: `spec/01-requirements/component-04-prompt.md` (**32 FRs, all Approved**),
`system-map/04-prompt.md`, 32 matrix rows, OD-048…OD-053 logged+resolved, AF-111 logged. A
**content-definition** component — the smallest so far, no connector research gate, most machinery is seams.

**C4 = "what the AI is"** (vs C2 what it knows, C3 what it can do). Area codes: LYR ×4 · CID ×6 · BIZ ×3 ·
INJ ×4 · TSK ×3 · PRIN ×3 · STO ×6 · OPT ×3. C4 owns the **four-layer model** (L1 core identity per-agent ·
L2 business context · L3 memory injection · L4 task instruction), the **seven operating principles** + the
safety floor, the **`prompt_layers` store** + version discipline, and the optimisations. It does NOT own
runtime **assembly** (→C5), memory retrieval/clearance gate (→C1/C2), injection sanitization (→C6), hard-limit
**enforcement** (→C6), answer-mode pill rendering (→C5/C8), or the prompt-health **signals** (→C7).

**Drafting:** offloaded a whole-doc prompt-architecture sweep to an Explore subagent (the primary section
L2384–2492 + 8 cross-cut sites: checklist L261–271, L2-config L840–856, perm rows L556–558, boundary
instruction L2976–2980, hard-limits L2756–2768, `agents.system_prompt` L3500–3517, runtime assembly
L3338–3347, prompt-health L3578/3589–3591). Spot-verified the load-bearing cites before drafting. Caught the
central contradiction up front: **Layer 1 is stored in two places** (`prompt_layers.content` where
`layer='core'` AND `agents.system_prompt`), each with its own versioning → OD-048.

**6 ODs logged then resolved (OD-048…OD-053):** OD-048 Layer-1 single source of truth = **unify on
`prompt_layers`**, drop/derive `agents.system_prompt` (reconcile in C8); **OD-049 (user-decided) operating-
principles block = editable, Super-Admin-ONLY** (new `PERM-prompt.edit_principles`, not Admin) + mandatory
change_reason + safety-audit + warning; OD-050 prompt-change = **version pinned at assembly** (in-flight tasks
finish on their version); OD-051 L1 length = **advisory warning**; OD-052 dynamic L2 values = **operator-
editable per-deployment store**; **OD-053 (user-decided) principles floor = hard-block** (reword yes, delete a
principle no). 5 delegated/rec-accepted; the two safety-posture calls (049, 053) decided by the user directly.

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass CLEAN** — all L2384–2492 intents + the 8 cross-cut sites map to FRs;
  `agents.system_prompt` + prompt-health correctly handled as seams not orphans; no contradictions with
  ADR-001/002/003/006/007, glossary, or consumed C1/C2/C3 FRs; **all 6 traps PASS** (no `client_slug` RLS key ·
  C4 never claims assembly · L1 duplication resolved to one store · boundary = C4 content + C6 mechanism ·
  principles Super-Admin-edit doesn't break "shared verbatim" · citations clean).
- **Quality/failure pass found 7 findings (2 HIGH, 3 MED, 2 LOW), ALL reconciled:** **+FR-4.LYR.004**
  (assembly-time required-element validation — assembly halts if the resolved L1 lacks the boundary instruction
  / hard-limit statement / principles block; C4 owns the requirement, C5 enforces — HIGH); **re-anchored
  AC-4.PRIN.002.2** (the principles-edit audit pointed at C1 FR-1.AUD.002 which doesn't cover prompt edits →
  re-homed to the immutable `prompt_layers` version chain + a distinct safety-event to C7 — HIGH); **+OD-053 +
  AC-4.PRIN.002.4** (the seven-principle **hard-floor** — HIGH, the #2 edge of OD-049); +AC-4.BIZ.003.3
  (present-but-stale dynamic field surfaced, required + configurable threshold — MED); reworded AC-4.PRIN.002.3
  (assembled-*after*-edit, removes the version-pin ambiguity — MED); +AC-4.INJ.003.3 (above-clearance memory
  in an assembled L3 = containment breach, halt-and-audit — MED); +AF-033 cross-ref at FR-4.CID.006 (said-vs-did
  pill accuracy, already tracked — LOW). Confirmed great-tier: version discipline + single-source-of-truth,
  principle-as-statement-not-enforcement (PRIN.003), boundary/hard-limit prompt-vs-code split, AF-111 honesty.

**Sign-off:** user-authorized — OD-048/050/051/052 recs accepted, **OD-049 + OD-053 decided by the user**
(principles editable by Super Admin only, with a hard floor against deletion), gate clean + all 7 findings
reconciled in-file. 32 FRs `Approved`. No build-time viability gate holds any C4 FR (AF-111 gates only the
*optimisation claim* — version-perf attribution + compression payoff — not the version-identity/pin machinery).

**Files changed:** `component-04-prompt.md` (new, Approved); `open-decisions.md` (OD-048…OD-053 → 🟢; next
OD-054); `feasibility-register.md` (block O AF-111; next AF-112); `traceability-matrix.csv` (32 C4 rows);
`system-map/04-prompt.md` (new); `system-map/README.md` (04 ✅ built); `README.md` (status table + Phase-1 row);
this log. No new OOS.

**NEXT STEP — component 5 (Agent Harness).** Design-doc section **`## 5. Agent Harness` = L2493–2745** (next
`## 6. Guardrails` at L2746); plus the **system loop** L3329–3370 (where C5's runtime assembly + execution
lives) and the C5 checklist overview. Pattern-match the C0–C4 loop: Context Manifest → decompose → cite → log
ODs (next **OD-054**; new AFs from **AF-112**) → resolve → verification gate (2 zero-context subagents) →
sign-off → wire matrix + build `system-map/05-harness.md`. **C5 is where many C4 seams land:** the **prompt-
stack assembly** (retrieve the 4 layers, inject dynamic/memory values, concatenate, send — L3338–3339), the
**FR-4.LYR.004 assembly-validation** (halt if a safety element is missing), **version pinning** (FR-4.STO.006),
the **answer-mode pill** evaluation (with C8), the **task_queue** (L2517–2535), checkpoints, context-envelope
compression (L2608–2609), and the per-agent run loop. **C5 consumes:** C3's tool runtime (tool calls), C4's
prompt layers, C2's memory read flow, C1's `service_role`/mid-task re-check (FR-1.RLS.007). **Likely seams
out:** hard-limit/approval **enforcement** + injection sanitization → C6; observability/event-log → C7;
orchestrator routing + agent registry → C8. **Carry-ins unchanged:** OD-010 (compensation/rollback) lands
substantively at C5/C6; build-time spikes AF-001/002/004 + AF-111.

---

## Session 20 — 2026-06-25 — COMPONENT 3 (TOOL LAYER) DRAFTED, VERIFIED & APPROVED — the connector runtime

Fourth Phase-1 component, the connector layer. Output: `spec/01-requirements/component-03-tool-layer.md`
(**53 FRs, all Approved**), `system-map/03-tool-layer.md`, 53 matrix rows, OD-046 logged+resolved, the
session-19 ODs already resolved. Built directly on the session-19 research gate (dossiers + spine decision).

**C3 = "how the AI reaches the outside world."** Specced as the session-19 spine: a **generic connector
contract + shared tool runtime** (safety machinery built ONCE) with **GHL / Google / Slack as the first
three instances**. Area codes: CONN ×5 · REG ×4 · TOK ×6 (+3 instance) · RL ×8 · ACT ×7 (2 generic limits +
5 instance writes) · TRIG ×5 (+1 instance) · OPT ×4 · DSC ×6 · OBS ×4. **53 FRs = 40 generic runtime + 13
connector instances.** Every vendor fact cites the **dossier**, not the (stale) design doc.

**Drafting:** offloaded the three dossiers to an Explore subagent → a precise citable vendor fact-sheet
(token TTLs, scopes, rate limits, signature schemes, idempotency), then wrote generic CONN-contract FRs
first (the runtime every instance plugs into), then the GHL/Google/Slack instances. Key reconciliations
carried in: `client_slug`=label-not-RLS (mirrors C1) · agent/tool path = `service_role` (ADR-006) · golden
rule (source_ref pointers, not copies) · the 7 hard limits are code gates (ADR-007) · OD-044's "verified
authenticated ingress" homes the per-vendor signature schemes (GHL Ed25519 / Google OIDC-JWT+channel-token
/ Slack HMAC).

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass CLEAN** — no orphaned design lines (all L1968–2382 intents map; stale
  per-connector numbers correctly superseded by dossiers), no internal C3 contradictions, citations clean,
  **all 6 traps PASS**. **Caught a real cross-component bug:** C0 **FR-0.WHK.002** (Approved) specced GHL
  webhook auth as **HMAC-SHA256** — stale; the dossier + ADR-007 OD-044 note make it **Ed25519** (legacy RSA
  `X-WH-Signature` deprecates 2026-07-01). Corrected in place via change-control → **OD-046** (operator
  accepted at sign-off); C0 FR re-cited to the dossier, Status kept Approved (corrected, not re-opened).
- **Quality/failure pass found 10 findings (2 HIGH, 7 MED, 1 LOW), ALL reconciled:** **+FR-3.TRIG.005**
  (watch/subscription re-arm — Gmail/Drive/Calendar watches expire with NO auto-renew; a missed re-arm now
  enters the degraded flow + health panel — closed a HIGH silent-ingest-loss hole); **+FR-3.TRIG.006**
  (event-delivery gap detection + reconciliation — Slack auto-disable/>2h-late-drop had no specced mechanism,
  only prose; HIGH); **+AC-3.CONN.004.4** (durable pre-call intent record); tightened **AC-3.TOK.005.2**
  (post-refresh-pre-persist crash → grace-window retry then degrade loudly; no false "prior state intact");
  **+AC-3.RL.006.2** (irreversible/billed writes route to halt-and-escalate, excluded from auto-retry);
  **+AC-3.DSC.003.2/.3 + AC-3.DSC.004.2** (resume re-checks authorization FR-1.RLS.007; paused-task set +
  escalation clock persisted across restart); **+AC-3.OPT.004.2** (gap flag structured/mandatory-to-read);
  **+AC-3.CONN.005.3** (delete-granting scopes excluded — cheapest gate for hard-limit #3) + FR-3.ACT.002
  note (financial/impersonation limits have **no** C3 mechanism — wholly C7+AF-068); persisted RL.004 queue
  + drain re-consults idempotency. Confirmed-adequate: token no-leak, the GHL rotating-refresh persist spine,
  draft-to-approval for email/calendar, fail-closed boundary tag, physical isolation, OD-044 per-vendor
  signatures, OD-010 named-not-solved at every write FR.

**Sign-off:** user-authorized (delegated, C1/C2-style — chose "Sign off — Approve C3 + C0 fix"). 53 FRs
`Approved`; the C0 FR-0.WHK.002 correction accepted. **3 viability gates** documented (FRs are Approved but
do NOT advance to build until cleared): Slack history ingest → AF-083/084; GHL webhook signing input →
AF-090; GHL PHI-location ingest → AF-098 (BAA chain).

**Files changed:** `component-03-tool-layer.md` (53 FRs Approved + gate summary); `component-00-login.md`
(FR-0.WHK.002 HMAC→Ed25519, change-control note); `open-decisions.md` (OD-046 logged+resolved; next OD-047);
`traceability-matrix.csv` (53 C3 rows); `system-map/03-tool-layer.md` (new); `system-map/README.md`
(03 ✅ built); `README.md` (status table + Phase-1 row); this log. No new AFs (findings mapped to existing
Block-N AFs); no new OOS.

**NEXT STEP — component 4 (Prompt Architecture).** Design-doc section **`## 4. Prompt Architecture` ≈
L2384+** (confirm the end bound at decomposition; next `## 5.` follows). Pattern-match the C0/C1/C2/C3 loop:
Context Manifest → decompose the design's prompt section → cite → log ODs (next **OD-047**; new AFs from
**AF-111**) → resolve → verification gate (2 zero-context subagents) → sign-off → wire matrix + build
`system-map/04-prompt.md`. **C4 consumes** C3's tool registry + descriptions (FR-3.REG.002 — the AI selects
tools by description) and ADR-007 containment (boundary-tagged content is data, never instructions). **Likely
seams:** the harness/agent-loop *execution* → C5; guardrail *enforcement* of the hard limits + approval gates
→ C7; observability/eval of prompt quality → C8. **Carry-ins:** OD-010 (compensation/rollback) at
C5/C6/C8; **OD-047 (NEW — review the seven hard limits: right set / rigidity / enforceability — flagged by
operator, lands at C7 with the AF-068 red-team)**; the C3 viability gates (AF-083/090/098) + build-time
spikes AF-001/002/004 on a runnable prototype.

---

## Session 19 — 2026-06-25 — COMPONENT 3 (TOOL LAYER): spine decision + research-first gate run, filed & reconciled (FRs next)

Entered C3 (the connector component). User raised a strategic point up front — **"factor in adding tools later"**
(research → plan → build, repeatably). Turned it into a locked design decision + ran the research-first gate.

**Spine decision (user-approved: "C3 spine + lifecycle standard", no new ADR):** C3 is specced as a **generic
connector contract + shared tool runtime**, with **GHL / Google / Slack as the first three *instances***. The
runtime builds the safety machinery ONCE (token-refresh-persist, rate-limit tracker+backoff, webhook verify,
boundary-tagging, idempotent retry, disconnection/recovery) so future tools inherit it and the three
non-negotiables can't regress per-tool. **Validated by the design doc itself — L1976: "built as a boilerplate
… the first implementations of the pattern, not the limit."** After C3 is done, the existing
`standards/tool-integration-research.md` grows from a research-only gate into the full Research→Spec→Build→Verify
lifecycle (extracted from the real example, not pre-guessed).

**Research-first gate run (4 background agents):** 3 primary-source dossiers (one per tool) + 1 Explore design-map.
Dossiers written to `tool-integrations/{slack,gohighlevel,google-gmail}.md`, each gate-passed (independent
re-check). **Statuses: GHL 🟢 · Google 🟢 · Slack 🟡** (Slack dossier complete; its *viability* — history ingest —
rests on AF-083 EVAL, kept honest-yellow). The design-map decomposed L1968–2382 into ~58 intents, pre-split
**generic (~35) vs tool-specific (~15) vs generic+param (~8)** → 9 area codes (CONN/REG/OBS/ACT/TRIG/OPT/RL/TOK/DSC).

**Three material vendor surprises the design doc missed** (now spec'd correctly, cite dossiers not design doc):
(1) **GHL webhook signing RSA→Ed25519**, legacy `X-WH-Signature` deprecated **2026-07-01** → use `X-GHL-Signature`;
(2) **Google webhooks have no HMAC** (Gmail Pub/Sub OIDC JWT; Drive/Calendar signed `X-Goog-Channel-Token`+TLS);
(3) **neither GHL nor Gmail has write-idempotency** → app-side send-once guards (GHL → `/contacts/upsert`).
Plus a compliance flag: **GHL data can carry PHI, downstream BAA chain unknown (AF-098)** — gates HIPAA-location ingest.

**Filed (Rule 0), collision-safe renumber (single-pass dict regex):** feasibility **Block N = AF-083–110** (Slack
083–088 · GHL 089–100 · Google 101–110; next AF = **AF-111**); **OD-011 RESOLVED** (Slack internal custom app per
workspace, gated AF-083 EVAL); **OD-039–045 logged then RESOLVED** per recommendation (next OD = **OD-046**);
**OOS-018–027** (next OOS = **OOS-028**); **+12 glossary terms**. `traceability-matrix.csv` NOT yet touched (no C3
FRs to wire yet).

**OD resolutions (operator delegated "what do you recommend"):** OD-039 Slack per-workspace default · OD-040 token
rotation OFF · OD-041 GHL pass Security Review (**implicit 5-GHL-agency cap until then** — flagged) · OD-042 GHL
webhook receiver durable-queue→2xx+dedup `deliveryId` · OD-043 GHL re-verify 90d+changelog poll · **OD-044 ⭐ ADR-007
webhook-auth reconciliation → clarification note added to ADR-007** (Consequences→Connector ingress, dated
2026-06-25: hard control = "verified authenticated ingress", HMAC one instance; CONN contract homes per-vendor
scheme — change-control satisfied via note, not supersede) · OD-045 Google Drive `drive.file` default (escalate to
`drive.readonly`+CASA only for full-corpus ingest).

**Files changed:** `component-03-tool-layer.md` (new — manifest, contract spine, intent inventory, seams, vendor-fact
supersedes, OD table now RESOLVED, FRs deferred); 3 dossiers (new); `tool-integrations/README.md` (3 rows);
`feasibility-register.md` (Block N); `open-decisions.md` (OD-011 + OD-039–045); `out-of-scope.md` (OOS-018–027);
`glossary.md` (+12); `adr/ADR-007-injection-posture.md` (2026-06-25 clarification note); `README.md` (status); this log.

**NEXT STEP — draft the C3 FRs.** Gate passed, all ODs resolved, ADR-007 reconciled → FR drafting is unblocked.
Order: **generic CONN connector-contract FRs first** (the runtime: registry/REG, token lifecycle/TOK, rate-limit
tracker+backoff/RL, webhook-verify + boundary-tag, idempotent retry, disconnection/recovery/DSC, optimisation/OPT,
the 7 hard limits under ACT, trigger model/TRIG), **then the three connector instances** (OBS/ACT/TOK params per
tool) each citing its dossier for vendor facts. Then OD-free ACs → the per-component verification gate (2 zero-context
subagents: orphan/contradiction + quality/failure) → sign-off. **Per-FR `Ready` is additionally gated on build-time
AFs** (Slack history-ingest → AF-083; GHL webhook → AF-090; GHL PHI ingest → AF-098). **Seams (don't double-spec):**
memory-write tool → C2 (FR-2.WRT.*); high-risk rate-limit halt/escalate + approval gates + hard-limit enforcement →
C7; health panels/alerts/event-logging → C8; webhook *authentication* → C0 (FR-0.WHK.*); service-role agent path +
mid-task revocation → C1 (FR-1.RLS.007). Build `system-map/03-tool-layer.md` alongside the FRs (per-component map
policy). Carry-ins unchanged: OD-010 (compensation/rollback) at C5/C6/C8 — every external-write ACT tool is an
exposure point; build-time spikes AF-001/002/004.

---

## Session 18 — 2026-06-25 — COMPONENT 2 (MEMORY) DRAFTED, RESOLVED, VERIFIED & APPROVED — the business brain

Third Phase-1 component, the heart of the system. Output: `spec/01-requirements/component-02-memory.md`
(**57 FRs**, 56 Approved + 1 v2-deferred), OD-032…038 resolved, AF-082 logged, OOS-016/017 logged, matrix +
system-map wired.

**C2 = "what the AI knows"** — the durable, entity-organised, sensitivity-tagged knowledge base every task reads
from (step 4) and writes back to (step 7). Area codes: MEM ×2 · ENT ×5 · TAG ×3 · ING ×10 · WRT ×7 · RET ×7 ·
MNT ×17 · VEC ×3 · MAT ×3. **Three ADRs converge:** ADR-002 (Maturity/Sufficiency), ADR-003 (≤1 Sonnet writer +
Haiku gates + "controls before gates"), ADR-004 (sole-writer service_role + validate-and-commit).

**Drafting:** offloaded the design-doc Memory map (L1338–1967 + the L906–926 config block + L1487–1559 vector) to an
Explore subagent → 78 fine-grained intents; spot-verified the load-bearing cites (memory types, the tag enumeration,
the two filters) before writing. **Key reconciliation caught up front:** the design's "Filter 1 / Filter 2" ARE
ADR-003's Haiku gates (selective-writing + sensitivity-classify), **not a third model layer** — C2 cites ADR-003
rather than inventing one. C2 **consumes** C1's FR-1.CLR.001/004/006, RST.003, RLS.003/007, AUD.001 and **owns the
mechanisms C1 only ruled on** (tagging, the retrieval pipeline, never-auto-inject-Restricted, the sole-writer path).

**7 ODs logged then resolved (OD-032…038):** OD-032 hard-conflict quarantine+escalate (mirrors C1 OD-028); OD-033
entity resolution external-ref-first + flag-ambiguous + soft-disable retire (gated by AF-082); **OD-034 cold storage
DEFERRED to v2 → OOS-016** (user-decided — adds a lose-a-memory failure mode for no launch-scale benefit; HNSW stays
fast past ≤20-user volume); OD-035 candidate filters apply uniformly to BOTH search arms (closes a stale-knowledge
leak); OD-036 ~3-week shadow-retain trust window, graduate on low disagree-rate + operator sign-off (ADR-003 §8
made concrete); OD-037 Personal-consolidation skip-by-default + audited approval queue; **OD-038 compliance-erasure
rule homed in C2 (FR-2.MNT.017), backup-purge seamed to Phase 5** (user-decided). 5 delegated C0/C1-style; the two
scope/legal calls (034, 038) taken to the user — both chose the recommendation.

**Verification gate (2 independent zero-context subagents):**
- **Orphan/contradiction pass CLEAN** — all design intents L1338–1967 mapped; the 3 deferrals (cold storage, re-rank/
  HyDE, structured-extraction/query-decomposition) correctly logged OOS-016/003/017; no contradictions with
  ADR-001/002/003/004/006/007 or the consumed C1 FRs; all 5 trap areas PASS. Caught a **citation slip** (Personal-
  no-consolidation cited L1407 → correct **L1414**) + two cross-ref slips (MNT.009→**008**, MNT.016→**014**) — all fixed.
- **Quality/failure pass found 7 findings, ALL reconciled:** **+FR-2.WRT.007** (embedding-failure halts commit, never
  stores a null/invalid embedding — a real #1/#3 silent-loss hole); **+AC-2.WRT.006.3** (mid-task revocation re-check
  at the commit boundary — C1 FR-1.RLS.007 stated the rule, no C2 FR enforced it); **FR-2.ING.003** escalation AC +
  `CFG-review_escalation_days`/`CFG-ingest_defer_resurface_days` and **FR-2.MNT.010** now scans the ingestion queue +
  null-embedding rows (closed a **Rule-0 dangling "Phase 2" decision**); **FR-2.MNT.017** hardened to erase
  **transitively** across the supersede chain + merged/summarised derived rows (+AC-2.MNT.017.3 — the residue hole
  OD-038's own rule forbids); escalation ACs on FR-2.WRT.002 / FR-2.MNT.014; FR-2.WRT.006 lexical-recheck note →
  FR-2.MNT.006 daily backstop; AC-2.VEC.003.2 re-embed completeness gate. Confirmed-adequate: clearance-before-
  ranking, Restricted, golden rule, decay-never-deletes, evidence layer, sole-writer.

**Sign-off:** user-authorized — OD resolution delegated (5) + the two scope/legal calls decided directly; gate clean
on orphans/contradictions, all 7 quality findings reconciled in-file. 56 FRs `Approved` + FR-2.MNT.012 `Deferred(v2)`.

**Files changed:** `component-02-memory.md` (new, Approved); `open-decisions.md` (OD-032…038 → 🟢; next OD-039);
`feasibility-register.md` (block M AF-082; next AF-083); `out-of-scope.md` (OOS-016 cold storage, OOS-017 structured-
extraction/query-decomposition; next OOS-018); `traceability-matrix.csv` (57 rows); `system-map/02-memory.md`
(reconciled-with-spec note); `system-map/README.md` (02-memory ✅ Approved); `README.md` (status table + Phase-1 row);
this log.

**NEXT STEP — component 3 (Tool layer).** **Design-doc section: `## 3. Tool Layer` = L1968–2383** (next section
`## 4. Prompt Architecture` at L2384), incl. Observation tools L2021, Action tools L2037, Tool registry L2070, Tool
optimisations L2101, Connector token management L2225, Connector disconnection flow L2301; plus the C3 checklist
overview **L245–~270**. This is the **connector** component, so it **triggers the research-first
gate** (`standards/tool-integration-research.md`) — open dated primary-source dossiers in `tool-integrations/` for
GHL / Google(Drive+Gmail) / Slack before speccing connector FRs, citing the dossier (not the design doc) for vendor
facts. C3 is where the **AF-003 corrected vendor values propagate** (F1 Gmail per-env quota, F2 GHL 100/10s+200k/day,
F5 GHL refresh-token-rotation-persist, F3 Slack throttle) and where **OD-011 (Slack app class — rec internal-custom-
app, EVAL-gated)** resolves. C3 **owns the seams C2 named:** the connectors behind C2's three ingestion pipelines
(FR-2.ING.006/007/008) and the **live-data fetch** for the relevance cross-check (FR-2.MNT.011); also the connector
OAuth + token lifecycle C0 deferred (AF-013/014). **Carry-ins unchanged:** OD-010 (compensation/rollback) at C5/C6/C8;
build-time spikes AF-001/002/004 + the C2 AFs (AF-019 HNSW-under-RLS, AF-031, AF-034, AF-043, AF-061–063, AF-067,
AF-082) on a runnable prototype. The C2 mid-task-quarantine **machinery** (AC-2.WRT.006.3) is a C5/C6/C8 build concern;
the answer-mode **pill rendering** (FR-2.RET.007) is C8.

---

## Session 17 — 2026-06-24 — COMPONENT 1 (RBAC) DRAFTED, RESOLVED, VERIFIED & APPROVED + `standards/rbac.md` written

Second Phase-1 component, pattern-matched to the C0 exemplar. Output: `spec/01-requirements/component-01-rbac.md`
(**37 FRs**, all `Approved`), the owed `standards/rbac.md`, `system-map/01-rbac.md`, 37 matrix rows, OD-024…031
resolved, AF-079/080/081 logged.

**C1 = authorization ("what you may do/see")** — the question C0 left open once `auth.uid()` is established.
**ADR-006 is the spine** (its 6 binding parts map ~1:1 onto the RLS/PERM/CLR FRs). Area codes: ROLE ×5 · PERM ×7 ·
CLR ×6 · RST ×3 · RLS ×8 · USR ×5 · AUD ×3. Every vendor/architecture fact cites ADR-006 or the design doc.

**Drafting:** offloaded the design-doc RBAC map (L397–639 + L717–736) to an Explore subagent; verified load-bearing
line anchors before citing. Homed the C0 PERM stubs (`PERM-user.invite`, `PERM-auth.provider_toggle`, support nodes)
+ the role tables (`user_roles`/`roles`) C0 read. **Caught a real design contradiction:** L438 lists "Restricted" as
a Super Admin *role* clearance, but L452/L620 make it strictly per-named-individual — resolved in favour of L452
(Restricted is never a role default; Super Admin holds the *authority to grant*).

**8 ODs resolved (OD-024…OD-031, all 🟢, delegated C0-style):** dedicated append-only `access_audit` table, C7 owns
retention (OD-024); role deletable iff zero users + not protected, Super Admin always protected (OD-025); denied
direct access = explicit 403 + security log, never silent empty (OD-026); `entity_type_scope` column + Restricted-
per-individual (OD-027); overdue clearance review = escalate, neither auto-revoke nor silently keep (OD-028); audit
every RBAC mutation + one-role-per-user v1 + last-Super-Admin protected on all removal paths (OD-029); seed default
matrix once at provisioning, edits authoritative after (OD-030); **OD-031** (gate-raised) mid-task revocation policy.

**Verification gate (2 independent zero-context subagents):**
- Orphan/contradiction pass **CLEAN** — all 27 design intents mapped; the 4 traps all avoided (no `client_slug` in
  policies; no FR assumes RLS guards the agent path; Restricted never a role-default; no role-name inside a policy);
  all 6 seams (C0/C2/C3/C7) acknowledged.
- Quality/failure pass found **5 findings, ALL reconciled**, clustered at the **service-role/mid-task seam** (the one
  path ADR-006 part 6 deliberately leaves off RLS): **+FR-1.RLS.007** (a `service_role` task binds its originating
  user; on mid-task **deactivation or clearance-revoke it halts + quarantines before the next consequential side
  effect** — while a benign **session-expiry continues**, reconciling C0 FR-0.SESS.006; mechanism seamed to C5/C6/C8,
  compensation → OD-010); **+FR-1.RLS.008** (RLS/harness divergence is logged, not silently zero-rowed, #3);
  **+OD-031**, **+AF-081** (agent-path audit completeness — no DB backstop, rests on harness discipline); reactivation
  re-grant branch on USR.002 (no stale grant silently restored). AF-080 sharpened to runtime divergence.

**`standards/rbac.md` written** (Binding, owed since ADR-006) — 12 rules: default-deny everywhere · one `can()` gate ·
`PERMISSION_NODES.md` build-time source of truth · static generic data-driven policies · the `(select …)` initPlan
rule (AF-067, non-negotiable for perf) · RLS owns only the row-access subset intra-client · human-path-RLS vs
agent-path-service_role · instant change · explicit/scoped/reviewed clearances · Restricted per-individual/logged/
never-auto-injected · dual-path audit completeness · no-lockout.

**Sign-off:** user-authorized ("lets sign off unless you think i need to review something") — I judged nothing needed
their specific review (gate clean on orphans/contradictions; findings reconciled on the locked ADRs). 37 FRs → `Approved`.

**Files changed:** `component-01-rbac.md` (new, Approved); `standards/rbac.md` (new, Binding); `system-map/01-rbac.md`
(new); `system-map/README.md` (01-rbac ✅); `traceability-matrix.csv` (37 rows); `open-decisions.md` (OD-024…031 → 🟢;
next OD-032); `feasibility-register.md` (block L AF-079–081, AF-080 sharpened; next AF-082); `README.md` (status table
+ Phase-1 row); this log.

**NEXT STEP — component 2 (Memory).** The exemplar zoom-in `system-map/02-memory.md` already exists (reflects
ADR-002/003/004). Pattern-match the C0/C1 loop: Context Manifest → decompose the design's memory section → cite → log
ODs (OD-032+; new AFs from AF-082) → verification gate → sign-off. **Design-doc section: `## 2. Memory System` =
L1338–1967** (memory types/entities, the two ingestion filters + contradiction check + memory writer write-flow, the
visibility×sensitivity orthogonal tags L1400–1418, retrieval/ranking, the maintenance schedule L1870, the three
ingestion pipelines L1908+); plus the C2 checklist overview **L222–243** and the memory-relevant config (e.g.
`retrieval_confidence_threshold` ~L906). Note the clearance-before-ranking lines C1 cited (L464, **L1725**) live inside
this section — C2 owns the *mechanism* there. Likely area codes (confirm at decomposition): MEM/ENT (entities) ·
ING (ingestion filters + pipelines) · WRT (write flow + contradiction check + sole writer) · RET (retrieval/ranking) ·
TAG (visibility×sensitivity) · MNT (maintenance/supersede/merge). **C2 consumes from C1:** the clearance/visibility/Restricted access model
(FR-1.CLR.*/RST.*), the `(select …)` data-driven RLS pattern (AF-067), and **owns the mechanisms C1 only stated the
rule for** — tagging memories with a sensitivity tier + entity type (FR-1.CLR.001/004), the retrieval/injection
pipeline that enforces clearance-before-ranking (FR-1.CLR.006) and never-auto-inject-Restricted (FR-1.RST.003), and the
service-role sole-writer path (ADR-004) whose mid-task authorization C1 governs (FR-1.RLS.007). **Carry-ins unchanged:**
OD-010 (compensation/rollback) at C5/C6/C8; OD-011 (Slack app class) at the C3 Slack connector; build-time spikes
AF-001/002/004 + AF-067/076/079/080/081 on a runnable prototype.

---

## Session 16 — 2026-06-24 — COMPONENT 0 (LOGIN) DRAFTED, RESOLVED, VERIFIED & APPROVED (the golden exemplar)

The full Phase-1 per-component loop, executed end-to-end on **component 0 (Login)** — the golden exemplar
every later component pattern-matches. Output: `spec/01-requirements/component-00-login.md` (**42 live FRs +
1 retired**, all `Approved`), its `system-map/00-login.md` zoom-in, 43 matrix rows, 12 OD resolutions.

**Drafting:** decomposed design-doc **L358–390 + L643–816** into 6 area codes (AUTH/SESS/INV/SEED/REC/WHK).
Every Supabase vendor fact cites **feasibility Block J (SA1–17)**, NOT the design doc; the **6 refuted
design-doc claims** are carried as a doc-reconciliation table up top. New **AF-078** (webhook verification,
block K). Glossary +AAL/aal2, +refresh-token rotation, +JWKS local verification.

**12 ODs logged then resolved (OD-012…OD-023, all 🟢):** session-lifetime = native rotating+inactivity
(OD-012); mid-task = `service_role` (OD-013, per ADR-004/006); invites = **24h native, no custom token**
(OD-014); HttpOnly pursued w/ AF-073 gate (OD-015); 2FA = deployment-wide aal2, no exemptions (OD-016);
same-page challenge + soft-lock (OD-017); **OD-018 (user-decided) = OAuth-only for all client-tenant users,
email+password+2FA ONLY for external (operator-side) Super Admins** who can't SSO; OD-019 **dissolved** by
OD-018 (no client password to reset → phone-verify flow retired); one-method-at-setup (OD-020); seed =
email+pw+2FA external bootstrap admin (OD-021); webhook secret rotation/replay (OD-022); webhook alert→Super
Admin+throttle (OD-023).

**OD-018 cascade (the key event):** since all client users are OAuth, the system holds no client password →
**FR-0.REC.004 (phone-verify credential change) RETIRED**, phone field + custom invite-token table dropped,
REC reframed to a generic login-support intake. A scope decision *deleted* complexity + an attack surface.

**Verification gate (2 independent zero-context subagents):**
- Orphan/contradiction pass **CLEAN** — all 49 design intents mapped; 6 deviations are the intended Block-J
  corrections; seams to C1/C2/C3 acknowledged; no unsupported claims.
- Quality/failure-overlay pass found **6 findings, ALL reconciled:** seed check-then-create race → hardened
  **FR-0.SEED.003** with an ADR-004 atomic guard (real bug caught); +**FR-0.AUTH.010** (audit completeness),
  +**FR-0.INV.007** (email bounce), +**FR-0.REC.007** (stale-request re-escalation); missed-webhook detection
  parked as a seam to **C2/C3/C7** (not C0); backup confirmed covered by ADR-008.

**Sign-off:** user-authorized/delegated ("I trust you and your recommendations"). 3 LOW items accepted (status
enum `contacted`→`in-progress`; phone-recovery retired; **ADR-007 webhook-ingress "component 1" cross-ref
reconciled** via a dated clarification note); FR-0.INV.007 full-bounce-wiring deferred → **OOS-015**.

**Files changed:** `spec/01-requirements/component-00-login.md` (new, Approved); `system-map/00-login.md` (new);
`traceability-matrix.csv` (43 rows); `open-decisions.md` (OD-012…023 → 🟢; next OD-024); `feasibility-register.md`
(block K, AF-078; next AF-079); `glossary.md` (+3 terms); `out-of-scope.md` (OOS-015; next OOS-016);
`adr/ADR-007-injection-posture.md` (C0-scoping reconciliation note); `system-map/README.md` (00-login ✅);
`README.md` (status + Phase-1 row); this log.

**NEXT STEP — component 1 (RBAC).** Pattern-match the C0 exemplar: create `component-01-rbac.md` with a Context
Manifest (ADR-006 data-driven RLS is the spine; ADR-001 intra-client; the C0 `auth.uid()`/`aal2` seam from
FR-0.AUTH.008/SESS.006), decompose the design's RBAC section, cite, log ODs, run the verification gate, sign
off. **C1 owes the `standards/rbac.md` standard** (two-level RBAC+RLS, default-deny, RLS-vs-harness division,
service-role caveat, `PERMISSION_NODES.md`) — promised since ADR-006. C1 also **homes the PERM-* nodes** C0
referenced as stubs (`PERM-user.invite`, `PERM-auth.provider_toggle`, `PERM-support.view/.resolve`) and the
**role tables** `user_roles`/`roles` that FR-0.INV.005/SEED.001 read. Carry-ins unchanged: OD-011 (Slack app
class) at the C3 Slack connector; OD-010 (compensation/rollback) at C5/C6; build-time spikes AF-001/002/004 +
AF-073–078 on a runnable prototype.

---

## Session 15 — 2026-06-24 — PHASE 1 ENTERED · component-0 scope finalized · Supabase Auth research-first gate run

User asked to confirm Phase 0 done + whether to reason about Phase 1 before starting (yes to both). Read the
whole repo + had subagents map the design-doc Login section and re-read every foundation file. **Phase 0 is
confirmed complete** (all 8 ADRs Accepted; the 3 SPIKE/EVAL priority spikes AF-001/002/004 are build-time by
design). **Phase 1 is now entered.** No FRs drafted yet — this session did the "finalize before entry" pass +
the research gate. **Nothing here is a code change; it's spec scaffolding for component 0 (the golden exemplar).**

**Two scope decisions locked (user-approved), recorded in `phase-playbooks.md` → "Component 0 — entry
finalization":**
1. **C0 = authentication only ("who you are").** In scope: dashboard login (Google/Microsoft as a *login-identity
   provider* via Supabase Auth), email+password, **2FA** (TOTP enroll+challenge), **sessions** (JWT, TTLs,
   cookies, expiry/re-auth), **invite-based account creation**, **first-boot Super Admin seed**, **"trouble
   signing in"** recovery + support-request handling, **inbound webhook authentication** (HMAC/JWT verify of
   GHL/Google/Slack webhooks — a hard control per ADR-007). Out of C0: roles/permissions/clearances/RLS → **C1**;
   **connector OAuth + token lifecycle** (the AI's data access to Gmail/Drive/GHL/Slack, AF-013/014) → **C3 Tool
   Layer**. The **seam** is the session establishing `auth.uid()`. NOTE: the design doc places much auth content
   **structurally under the `## 1.` RBAC header** (L643–816: app auth flow, sessions, webhook security) — we
   re-home it to C0 by semantics. C0's own header is only L358–390.
2. **Supabase Auth research-first gate done BEFORE drafting C0 FRs** (Supabase is a *platform* dep, so findings
   live in `feasibility-register.md`, not `tool-integrations/`).

**Supabase Auth research pass (2026-06-24, 4 parallel primary-source agents) → `feasibility-register.md` Block J
(findings SA1–SA17) + new AF-073–077 + sharpened AF-067.** It **refuted/corrected 6 design-doc claims** — these
MUST be cited from Block J, not the design doc, in C0 FRs:
- ⛔ **Refresh-token "7-day TTL" REFUTED** — Supabase refresh tokens **never expire**; single-use rotating, 10s
  reuse interval, reuse-detection revokes the whole session. Session bounds = optional time-box/inactivity
  (Pro+, no default, lazily enforced). The design's `auth.session_refresh_days:7` maps to **no native setting**.
- 🟠 **HTTP-only cookies** — NOT the documented default (`@supabase/ssr` says HttpOnly "not necessary") → AF-073.
- ⛔ **"Server-side session continues mid-task"** — no such object; either middleware refreshes the JWT or
  background runs as `service_role` (bypasses RLS, no `auth.uid()`).
- ⛔ **`two_factor_required` as a config flag** — no org-wide end-user MFA toggle exists; must be **built** via
  restrictive `aal2` RLS on every protected resource + post-login app gating → AF-076.
- ⛔ **72h invite links** — hard cap **24h (86400s)**, global setting, not per-link → AF-074 + custom-token fork.
- ⬜ **Microsoft Authenticator** — unnamed by Supabase; compat rests on open RFC-6238 → AF-075.
- ✅ Verified & useful: TOTP default-on; Google+Azure login IdP (pin tenant, require `email` scope, `xms_edov`);
  invite-only supported (admin API bypasses the signup toggle); **custom SMTP mandatory for prod** (built-in
  2/hr); **no per-account login lockout** (platform Cloudflare/fail2ban + CAPTCHA + leaked-pw Pro+) → AF-077;
  **asymmetric JWT (RS256/ES256) default since 2025-10-01** → local JWKS verification (`getClaims`), but
  `getUser` where revocation matters; API-key rename anon→`sb_publishable`, service_role→`sb_secret`.
- **AF-067 SHARPENED (load-bearing for C1/ADR-006):** `STABLE` alone ≠ once-per-statement; helper calls MUST be
  wrapped `(select …)` to force the initPlan (Supabase benchmark **178,000ms→12ms**), index policy cols, scope
  `TO authenticated`, wire the `auth_rls_initplan` lint. Now a binding implementation rule, not an open risk.

**Files changed:** `phase-playbooks.md` (Component 0 entry finalization), `feasibility-register.md` (Block J,
AF-073–077, AF-067 sharpened, next-AF→AF-078), `README.md` (Phase-1 row 🟡 + status line), this log.

**NEXT STEP — draft `spec/01-requirements/component-00-login.md`** (per Phase-1 playbook steps 1–5), as the golden
exemplar. Open with a **Context Manifest** (ADR-001 §2/§5 Supabase+secrets custody, ADR-006 §6 service-role
bypass, ADR-007 webhook-auth-as-hard-control; standards: config-edit-taxonomy, migration-discipline; glossary
auth terms; **feasibility Block J + AF-073–077**; design-doc **L358–390 + L643–816**). **Area codes:**
AUTH (login/OAuth/2FA), SESS (sessions/tokens), INV (invites), SEED (first-boot Super Admin), REC (recovery/
support), WHK (webhook auth). Decompose into atomic FRs citing **Block J** for vendor facts. Build
`system-map/00-login.md` zoom-in alongside (per-component map policy). Then user resolves ODs → ACs → verification
gate → sign-off.

**Component-0 OD candidates to LOG when drafting** (4 research forks + ~8 from the design-doc mapping — none
logged yet; will be OD-012+): (a) **session-lifetime model** — adopt Supabase rotating-never-expiring + inactivity
vs custom bounds [SA3]; (b) **mid-task continuation** — middleware JWT-refresh vs service_role [SA5]; (c) **invite/
setup-link expiry** — re-spec ≤24h vs custom invite-token layer [SA11/12, AF-074]; (d) **HttpOnly** — hard
requirement (spike AF-073) vs accept default [SA4]; (e) **2FA delivery UX** (same-page vs redirect) + wrong-code
rate-limiting; (f) **per-user 2FA override** vs deployment-wide; (g) **support-request notification** — who's
alerted on submit + phone capture/lookup + call logging + unreachable-user escalation; (h) **invite edge cases** —
expired→re-request? admin revoke-early? OAuth+password dual setup?; (i) **Super Admin seed** — OAuth option? bounced-
email recovery path?; (j) **RLS every-table coverage** discipline (ties to AF-076); (k) **webhook** — secret
rotation, replay beyond timestamp, accept-rate limits; (l) **webhook failure alert** — recipient, source-id,
escalation action.

**Carry-ins (unchanged):** GHL/Gmail/Slack connector findings (F1–F6, AF-013/014) are for **C3**, not C0; **OD-011**
(Slack app class) resolves at the C3 Slack connector; **`standards/rbac.md`** owed when C1/data-model specced
(from ADR-006); **OD-010** (compensation/rollback) is a C5/C6 item. Build-time spikes AF-001/002/004 + the new
AF-073–077 run on a runnable prototype.

---

## Session 14 — 2026-06-23 — ADR-008 ACCEPTED (backup & disaster recovery) — last Phase-0 blocker closed

User asked "what's next," chose **OD-009 (backup/DR)** — the last actionable Phase-0 item (the 3 SPIKE/EVAL
priority spikes are build-time, deferred). Then delegated the three forks to me ("what do you recommend and
why, explain simply"). Drafted → he probed two points (why PITR ~$100, the Storage-bucket caveat) → resolved
both → wrote **ADR-008**, closing OD-009. Phase 0 now has **no blockers left**.

**Research-first, per the AF-003 lesson (vendor facts go stale):** ran a dated primary-source pass on Supabase
backup/DR before asserting anything. It **reframed the whole decision** — the dominant loss path is **the
client's credit card, not a crash**: because ADR-001 puts the project on the client's account, a billing lapse
pauses it after ~7 days → restorable 90 days → then **the project AND all in-project backups (daily + PITR) are
permanently deleted together**. PITR alone can't save you (it lives inside the doomed project).

**Decided (6 binding parts):** *(Decision part 1 was revised later in the same session — see "In-session
revision" below; the entry reflects the final state.)*
- **Default = free daily in-project backups + an hourly off-platform snapshot** (~1-hour RPO, near-zero cost,
  AF-072-bounded). **PITR is an opt-in upsell** (off by default, ~$100+/mo on the client's card, for
  minute-level RPO or brains too big for an hourly logical dump). Running below hourly is a **logged downgrade
  exception**, never a silent default.
- **Independent off-platform `pg_dump` to a client-owned destination** (different region), run **hourly**,
  independent of the primary project lifecycle — the **only** defense against the deletion path. **Client-owned**
  so the operator never holds business data (preserves the ADR-001 boundary). Operator-held copy = logged
  per-client exception.
- **Ownership split:** client owns + pays; **operator operates + verifies** (the OD's core "whose job" ambiguity).
- **Tested restore rehearsal** to a throwaway project (Supabase verifies nothing; we do) — confirms DB + pgvector
  + auth rows come back queryable. ⚠️ AF-069.
- **Backup-health joins the management-plane push** (ADR-001 §7) — operational metadata only: recovery tier
  (daily+hourly, or PITR), last-backup time, **project status incl. pause/billing-at-risk**, off-platform-
  snapshot + rehearsal results; read via Supabase Management API (⚠️ AF-070); **loud Super Admin alert on
  lapse** → a failing client backup is *seen* before the deletion window (protects #1 + #3).
- **Golden rule governs scope + Storage buckets out of scope** (OOS-013): per `L1634` source files live in
  their system of record, **referenced (`source_ref`) not copied into Supabase**; v1 Storage holds only
  **regenerable offboarding exports** (`L97`), checked against the design doc — not source-of-truth. DR posture
  = restore-with-downtime, not hot failover (Enterprise-only; OOS-014).

**In-session revision (operator's call):** Austin pushed that ~$100/mo PITR-on-by-default is overkill, and
(correctly, citing the golden rule) that files should be **referenced in their system of record, not stored in
Supabase**. Both confirmed: (1) **default flipped to hourly off-platform snapshots + free daily; PITR demoted
to a documented opt-in upsell** — cheaper, and acceptable because memory is re-derivable from systems of record
that survive any incident (so AF-072 now gates the *default* hourly cadence). (2) The **golden rule (`L1634`)**
was already the design's law (only Storage use is the transient offboarding export); lifted it into the glossary
as a **binding principle** so no future component copies source files into Supabase. ADR-008 carries a dated
**Revision** note (Accepted-but-ink-wet, transparent amendment per change-control). Glossary +Golden rule,
+Off-platform snapshot, +RPO, +PITR upsell, +Restore rehearsal.

**Vendor facts that drove it (primary-source, 2026-06-23):** PITR = paid add-on, 2-min RPO, replaces daily,
not Spend-Cap-covered; free daily = Pro 7d/Team 14d, can lose ~24h; backups cover **DB only (incl. pgvector +
auth), NOT Storage buckets**; **Management API can read backup status** without business data; **no platform
restore-verification**; **no auto-failover** on Pro/Team. Could NOT verify from primary docs (→ AFs): backup
**region locality / AU residency** (AF-071), exact **Management-API payload fields** (AF-070).

**Captured as MUST-TEST:** new feasibility **block I** — AF-069 (restore actually works, SPIKE — the load-
bearing one), AF-070 (Management API exposes the health fields, SPIKE), AF-071 (backup region/AU residency,
DOCS/vendor confirmation — primary docs insufficient), AF-072 (off-platform dump completes in-window at scale,
LOAD).

**Files changed:** `adr/ADR-008-backup-dr.md` (new, Accepted); `open-decisions.md` (OD-009 → 🟢);
`adr/README.md` (ADR-008 row); `feasibility-register.md` (new block I AF-069–072; next AF-073);
`out-of-scope.md` (OOS-013 Storage buckets, OOS-014 HA/failover; next OOS-015); `what-makes-it-great.md`
(non-negotiable #1 watch + dimension-11 row cleared 🔴→🔵 + "one gap left" summary); `README.md` (ADR status
line — ADR-008, no Phase-0 blockers, next = Phase 1 component 0).

**Next step:** **Phase 0 is done — start Phase 1, component 0 (Login)** as the golden exemplar, building its
`system-map/` zoom-in alongside it (per the per-component map-build policy). Phase-1 carry-ins to honor:
**propagate the AF-003 corrected vendor values** into connector/token/rate-limit FRs (esp. GHL refresh-token
persistence F5, Gmail per-env quota F1, Slack app class **OD-011**); **OD-011** (Slack app registration,
🟡 rec (a) internal-custom-app) resolves when the Slack connector/ingestion component is specced;
**OD-010** (compensation/rollback) is a Phase-1 Harness/Guardrails item; write **`standards/rbac.md`** when
component 7 / data model is specced (owed from ADR-006). The 3 SPIKE/EVAL priority spikes (AF-001/002/004)
plus the new AF-069/070/072 are build-time, run on a runnable prototype.

---

## Session 13 — 2026-06-23 — AF-003 vendor-claims spike (DOCS pass) — first feasibility item verified

User asked "what's next," chose feasibility spikes, then asked whether "priority spikes" = "feasibility
spikes" (yes — priority = the run-first subset that can invalidate the architecture; same `AF-` register).
**Honest constraint surfaced:** 3 of the 4 priority spikes (AF-001 cost, AF-002 retrieval, AF-004
provisioning) are SPIKE/EVAL and **need a runnable prototype that doesn't exist** — can't run from inside a
spec repo without fabricating results (would violate non-negotiable #3 + anti-hallucination rule). The **one
doable now** is **AF-003 (vendor-claims, method DOCS)** — pure documentation verification. Ran it: 4 parallel
research agents over Google/Gmail, GHL+Slack, Supabase+pgvector, Inngest+Railway, all against current primary
vendor docs.

**Result — 3 claims stale/refuted, 1 design fork, rest verified:**
- ⛔ **AF-011 (GHL rate limit) REFUTED** — not "120/min, no burst"; real = **100 req/10s burst + 200k/day, per
  app per location**. No per-minute limit. Daily cap is the real ceiling.
- ⛔ **AF-014 (GHL OAuth refresh) PARTLY REFUTED** — refresh token is **NOT indefinite**; it **rotates per use**
  + dies after **1 yr unused**. ⚠️ **#1 risk:** harness must persist the new refresh token every refresh or
  silently lose access.
- 🟠 **AF-010 (Gmail quota) STALE** — "250/sec" gone → **6,000 QU/min/user**, and **date-dependent** on GCP
  project activation (pre/post 2026-05-01). Pin per-environment. +100-token-per-account cap.
- 🟠 **AF-017 (Edge Functions) STALE** — "150s" is Free-only; paid = 400s; real constraint = **2s CPU cap (all
  plans)**. Cite that, not 150s.
- 🔴 **AF-012 (Slack) → DESIGN FORK, logged OD-011** — since 2025-05-29 non-Marketplace apps have
  `conversations.history/.replies` throttled to **Tier 1 (1 call/min × 15 msgs)** = lethal for history ingest.
  **Exempt: Marketplace apps + internal custom apps.** OD-011 recommends **(a) internal custom app per client
  workspace** (fits ADR-001/005), EVAL-gated on a live workspace.
- 🟢 **Verified:** AF-013 (Google OAuth — sharper: Testing=7d expiry, 6mo-unused death, password-reset
  revoke, CASA annual reassessment ~weeks = onboarding critical path), AF-015 (Slack xoxb), AF-016 (Realtime —
  soft quotas + msgs/sec & joins/sec ceilings), AF-018 (Inngest — **per-key concurrency ✓ confirms ADR-004**;
  wording fixes: per-step ≤2h, `onFailure`/`inngest/function.failed` not "DLQ"; Free concurrency=5), AF-020
  (Railway — pre-deploy command blocks-on-fail ✓ confirms migrate-on-release + **branch-per-env corroborates
  AF-064 canary model**), AF-021 (cross-account Supabase works; ⚠️ service-role key = god-mode bypass-RLS, +
  static-egress-IP assumption for allowlisting).
- 🟡 **AF-019 (pgvector HNSW)** — HNSW verified, but **kept SPIKE/LOAD-open**: RLS/WHERE filters apply *after*
  the ANN scan, so per-client RLS (ADR-006) can starve recall; must LOAD-test **with RLS predicates applied**.

**Files changed:** `feasibility-register.md` (AF-003 row → 🟡; Block A all 12 statuses set; new "AF-003 DOCS
verification findings" subsection F1–F12 with corrected values + sources + design impacts); `open-decisions.md`
(new **OD-011** Slack app class, 🟡 rec (a); next OD-012); `README.md` (status line — spike progress + OD-011).

**Also built (user request) — the tool-integration research-first gate.** The tool set is open-ended and
client-driven; new connectors arrive per client/use case, and AF-003 just proved vendor facts go stale. So we
made a **repeatable research trigger**: no tool is specced until a dated, primary-source dossier exists.
- `standards/tool-integration-research.md` (new, **Binding**) — the 5-step procedure (open dossier → parallel
  research fan-out over 12 dimensions, primary docs only, date-stamped → file AF/OD/glossary outputs →
  verification re-check → only then spec the connector FRs) + the 12 research dimensions (auth/token lifecycle,
  rate limits, API, webhooks, data/sensitivity, provisioning, isolation, cost, failure, versioning) each tied to
  an ADR / non-negotiable, with the AF-003 finding that proves it matters + a **staleness / `Re-verify by`** rule.
- `tool-integrations/_TEMPLATE.md` (new) — the per-tool dossier shape.
- `tool-integrations/README.md` (new) — index; **pre-seeded** with Google/Gmail, GHL, Slack rows pointing at the
  AF-003 F1–F6 findings + OD-011 (so the spike work feeds the dossiers when those connectors are specced).
- `CLAUDE.md` — new section **"Adding a new tool / connector (research-first — this triggers research)"** after
  the feasibility rules; `README.md` repo map (+standard, +`tool-integrations/` folder).

**Next step:** **OD-009 (backup/DR — elevated, top-bar)** is now the last actionable Phase-0 item before
Phase 1 (the 3 SPIKE/EVAL priority spikes are build-time, deferred). Resolve OD-009 draft→approve (may spawn a
small ADR on the ownership question — client owns the Supabase, so backup ownership/verification is ambiguous;
underpins non-negotiable #1). **Then Phase 1 component 0 (Login)** as the golden exemplar + its `system-map/`
zoom-in. Corrected vendor values (F1–F12) must propagate into the Phase-1/2 connector, token-lifecycle, and
rate-limit FRs — esp. GHL refresh-token persistence (F5), Gmail per-env quota (F1), Slack app class (OD-011).
Carry-over from ADR-006: write `standards/rbac.md` when component 7 / data model is specced. OD-010
(compensation/rollback) is a Phase-1 Harness/Guardrails item.

---

## Session 12 — 2026-06-23 — ADR-007 ACCEPTED (prompt-injection posture) — last load-bearing ADR

Fourth **draft→approve** ADR, and the **last** of the seven. Closes OD-007. User was confused by the
first draft and asked to simplify — worked it through in plain language (Option A "spot the fakes" vs
Option B "lock the doors"; bank-teller-and-vault analogy landed). He then raised two sharp instincts
that *validated* the design: (1) detection is unreliable → that's why we lock the doors; (2) scanning
everything is expensive → that's why the one paid scanner is off by default. Approved, and explicitly
asked to "make sure to have the on/off switch for the smoke alarm" → captured as config
`injection_semantic_detection` (default **off**).

**Decided (6 binding parts):**
- **Containment-first, not detection-first.** The security boundary is the controls that **ignore
  prompt content entirely** — hard limits in code (`L2053`/`L2066`), default-deny RBAC + RLS (ADR-006),
  approval gates (`L2772`), rate limits (`L2809`), physical cross-client isolation (ADR-001),
  sole-writer + sensitivity-gated memory (ADR-004). A successful injection is **contained, not
  necessarily caught**. This is "controls before gates" (ADR-003) applied to injection, and the only
  posture consistent with non-negotiable #2.
- **Keep the cheap deterministic layers, always on:** external-data **boundary tagging** (`L2965`),
  high-precision **regex tripwires** (`L2943`, log/alert only — not a gate), **webhook HMAC auth**
  (`L742–809`, a real hard control = authentication, not content-detection).
- **Detection-as-signal:** the **embedding-similarity classifier** (`L2959`, the "partly theater" part)
  ships **off by default**; when on it may only flag for triage — **never** auto-quarantine/discard/
  block. Promotion past off-by-default is EVAL-gated.
- **Fail-safe = retain + route to human.** Quarantine **holds** content (shadow-retain) and never
  machine-discards it; **discard is a human-only logged decision** (protects non-negotiable #1). Every
  match logged loudly; every quarantine alerts (protects #3).
- **Thresholds (0.85/0.95) are signal-tuning knobs, not safety dials** — config registry must document
  them as such so no future requirement mistakes a threshold for the boundary.
- **Rejected:** A1 detection-primary (the review's "theater"; unbounded false-negatives + false-positive
  quarantine drops knowledge); mandating the embedding scan on the hot ingest path (read-path cost,
  unproven payoff); machine auto-discard (violates #1).

**Captured as MUST-TEST:** new feasibility block **H** —
- **AF-068 (SPIKE / red-team)** — the containment boundary holds end-to-end: **no authorized-but-
  dangerous autonomous action path** reaches a consequential side effect (external comm / financial /
  cross-client read / destructive write / memory poisoning) without hitting a code gate that ignores
  prompt content. The whole posture rests on this; a bypass must be **closed in code**, not patched with
  a detection rule.

**Files changed:** `adr/ADR-007-injection-posture.md` (new, Accepted); `open-decisions.md` (OD-007 →
🟢); `adr/README.md` (ADR-007 Accepted); `feasibility-register.md` (new block H AF-068; next AF-069);
`glossary.md` (+Containment-first injection posture, +External-data boundary tag, +Detection-as-signal);
`what-makes-it-great.md` (#2 ⚠️ flag cleared → now points at AF-068 red-team residual); `README.md`
(ADR status line — **all seven ADRs landed**).

**Next step:** **Phase 0 ADRs are done.** Remaining before Phase 1: the **priority feasibility spikes**
(AF-001 cost, AF-002 retrieval, AF-004 provisioning) and **OD-009 (backup/DR — elevated, top-bar)**.
Then **Phase 1 component 0 (Login)** as the golden exemplar, building its `system-map/` zoom-in
alongside. Note still-owed from ADR-006: the `standards/rbac.md` standard (write it when component 7 or
the data model is specced). OD-010 (compensation/rollback) is a Phase-1 Harness/Guardrails item.

---

## Session 11 — 2026-06-23 — The three non-negotiables captured (operator's top bar)

User noted (correctly, applying Rule 0) that the "what does *great* mean to you?" question lived
only in chat, never the repo. He answered: **wants all three** — never lose/corrupt knowledge,
never do something it shouldn't, never fail (silently). Affirmed coherent: the three don't conflict
(integrity / safety / observability), they only cost rigor.

**Captured:**
- `what-makes-it-great.md` — new top section **"The three non-negotiables (the operator's top bar)"**:
  each invariant + what upholds it + what threatens it. Framed as the **ranking rule** for Phase-1
  trade-offs (invariant wins over convenience/speed/scope).
- `process-overview.md` — added the three to "what the user wants."
- **OD-009 (backup/DR) ELEVATED** — it underpins non-negotiable #1, so it's now top-bar, not a
  Phase-5 nicety; resolve early.
- `CLAUDE.md` — added a binding **"three non-negotiables"** section right after Rule 0 (they were
  only transitively reachable via process-overview; now every chat treats them as the ranking rule).

**Consequence to remember:** invariant #1 leans on OD-009 (backup/DR — still a gap); invariant #2
leans on ADR-007 (injection — still open, next up). So the two open items both touch a non-negotiable.

**Next step:** unchanged — **ADR-007 (prompt-injection posture)**, draft→approve (last load-bearing
ADR); then priority spikes (AF-001/002/004); then Phase 1 (component 0 Login). Resolve OD-009 early
given its elevation.

---

## Session 10 — 2026-06-23 — ADR-006 ACCEPTED (dynamic roles vs static RLS)

Third **draft→approve** ADR. Closes OD-006 — roles are editable at runtime but RLS is authored at
migration time. User asked to "simplify" and worked through it interactively (anchored on "aren't we
using Supabase for login/OAuth?" — yes, and ADR-006 sits on top of it). The keycard analogy landed;
user pushed "why not make both [grant + revoke] instant?" — which pushed the design to the *simpler*
pole and removed a whole sub-problem.

**Decided (6 binding parts):**
- **False fork — keep both via static, data-driven RLS over *live* permission data.** Permissions
  live in **tables** (`roles`, `role_permissions`, `user_roles`, `sensitivity_clearances` w/
  entity-type scope, `restricted_grants`), edited from the dashboard with **no migration**. RLS
  policies are authored once, **generic** (never name a role), and look up the user's *current*
  permissions **live** each query via `STABLE SECURITY DEFINER` helpers keyed on `auth.uid()`.
- **Every change is instant** — grant *and* revoke — because nothing is cached on the token. This
  deleted the original "propagation latency" fork entirely (no JWT snapshot → no staleness window →
  no split grant-lazy/revoke-forced rule, no forced-logout machinery).
- **Division of labor:** RLS owns the visibility/sensitivity/Restricted **row-access** subset (DB
  backstop); the **harness** owns the full permission matrix in code. Both read the same tables →
  can't drift.
- **Two ADR-001 reconciliations baked in** (so nothing re-reads stale doc text): RLS is
  **intra-client only** — the doc's `client_slug` clause (`L724`) is **deleted**, cross-client
  isolation is physical; and RLS guards the **user-session** path only — the Memory Agent (sole
  writer, ADR-004) + backend run as the **service role**, which **bypasses RLS** (governed by harness
  RBAC). No requirement may assume RLS guards an agent write.
- **Rejected:** D1 one-policy-per-role (migration per edit, breaks `L471`/`L639`); D2 JWT-cached
  permission claims (faster reads but imports a staleness/propagation problem not worth it at ≤20
  users — kept only as the documented fallback, OOS-012).

**Captured as MUST-TEST:** new feasibility block **G** —
- **AF-067 (SPIKE+LOAD)** — live data-driven RLS performs on the **hot retrieval path** (the `STABLE`
  helper lookup, once per statement over tiny indexed tables, composing with pgvector ranking of a
  large memory batch). The whole D3 choice rests on this; D2 JWT-cache is the fallback if it fails.

**Files changed:** `adr/ADR-006-rls-dynamic-roles.md` (new, Accepted); `open-decisions.md`
(OD-006 → 🟢); `adr/README.md` (ADR-006 Accepted); `feasibility-register.md` (new block G AF-067;
next AF-068); `out-of-scope.md` (OOS-012 JWT-cached claims deferred; next OOS-013); `glossary.md`
(+Data-driven RLS, +Permission tables, +Restricted grant, +Entity-type-scoped clearance,
+Service-role bypass); `README.md` (ADR status line).

**Still owed (deferred to where context is richest, not now):** the new binding standard
`standards/rbac.md` (two-level RBAC + RLS model, default-deny, RLS-vs-harness division, service-role
caveat, `PERMISSION_NODES.md` convention) — write it when component 7 (RBAC/Guardrails) or the data
model is specced, per the ADR's Consequences. ADR-006 is the source of truth meanwhile.

**Next step:** **ADR-007 (prompt-injection posture)** — draft→approve (OD-007). The last load-bearing
ADR. Decide how much to lean on code-level hard limits vs regex/embedding detection (the doc calls the
latter "partly theater" + false-positive-quarantine risk); affects the Guardrails component. Note the
ADR-003 hard-limit precedent ("controls before gates") and `L2066` ("no user role, no agent
instruction, no config change can override a hard limit") as the lock-points. Then priority spikes
(AF-001 cost, AF-002 retrieval, AF-004 provisioning), then Phase 1 (component 0 Login).

---

## Session 9 — 2026-06-23 — Quality bar + failure overlay + honest "is it great?" audit

User pushed: the happy-path map looked too simple and lacked the finer detail separating a good vs
great harness, and asked whether the "great" stuff is actually in our system — capture it if not.

**Created:**
- `what-makes-it-great.md` — the great-vs-good quality bar across 12 dimensions, **plus an honest
  coverage audit** (where each lives in the design doc / ADRs + status: designed / ADR-hardened /
  paper-pending-test / gap). Headline: most great dimensions ARE designed in or ADR-hardened; the
  rest is "great on paper, must be tested" (AF register). Becomes a Phase-1 gate.
- `system-map/failure-overlay.md` — the shadow map: per step, what goes wrong + the mechanism that
  catches it (with cites). This is where the real depth/complexity lives.
- Rendered both as live visuals.

**Gaps surfaced & tracked:** **OD-010** (compensation/rollback of partially-completed task chains —
no undo story for external side effects when a chain halts; the one genuinely new gap from the
audit). OD-009 (backup/DR) reaffirmed. Everything else either designed, ADR-hardened, or in the AF
register as paper-pending-test.

**Wired:** README repo map; phase-playbooks Phase 1 step 8a (quality-bar + failure-overlay check
per component). 

**Answer to "is the great stuff in our system?":** mostly yes (dimensions 1–10 designed/hardened);
2 real gaps now tracked (OD-009, OD-010); the residual risk is paper-pending-test items, all logged.

**Next step:** unchanged — **ADR-006 (dynamic roles vs static RLS)**, draft→approve; then ADR-007;
then spikes; then Phase 1.

---

## Session 8 — 2026-06-23 — System map + per-component zoom-ins + grounding mode

User hit real anxiety: couldn't picture the system end-to-end ("blank in my head"), feared he
couldn't explain it / that the build won't match the vision stuck in his head. **Root cause = a
missing top-down VIEW** (we'd only ever built bottom-up: decisions/ADRs/requirements). Fix = make
the system visible, and build support for the user into the repo.

**Created:**
- `system-map.md` — top-down end-to-end route (8-stage "drive"), the continuous layer
  (loops/observability/proactive), the infra/compliance foundation, component legend C0–C10, and
  the **simulation technique** (walk a scenario down the map → each gap becomes an OD/requirement)
  with a worked GHL-lead example.
- `system-map/` — per-component zoom-in folder + index (all 11). **Build policy:** each zoom-in is
  built when we spec that component in Phase 1, so maps never drift from requirements. `02-memory.md`
  built now as the **exemplar** (reflects ADR-002/003/004). Out-of-order builds allowed if a
  component is causing anxiety.
- `working-with-me.md` — **grounding mode**: recognise the pattern (anxiety = missing-view signal,
  not a defect), do/don't list, and a 7-step "ground me" protocol.

**Wired:** CLAUDE.md now opens with a priority **grounding-mode** section + map pointers; README
repo map updated. Rendered the e2e map and the Memory zoom-in as live visuals in chat.

**Next step:** unchanged — **ADR-006 (dynamic roles vs static RLS)**, draft→approve; then ADR-007;
then priority spikes; then Phase 1 (component 0 Login as golden exemplar). When we spec each
component, build its `system-map/` zoom-in alongside it.

---

## Session 7 — 2026-06-23 — ADR-005 ACCEPTED (deploy fan-out & provisioning)

Second **draft→approve** ADR. Closes OD-005 — deploy fan-out, per-client provisioning, and version
skew, all asserted-not-designed in the doc. User chose the two forks in plain-language terms after I
explained them; then flagged a real gap (a brand-new business has no data to test a canary on), which
became a third decision axis.

**Decided (7 binding parts):**
- **Fan-out is already solved by ADR-001 §6** — no custom CI; each Railway project natively tracks the
  shared repo. `client_registry` is the observability map, not the deploy driver. Also re-stated
  ADR-001 §7 (push, not pull) for version/health reporting.
- **Blast radius = canary + release-train** (chose A3 over instant-global / per-deployment-manual):
  feature → `release` (canary tracks) → promote (fast-forward) → `main` (fleet auto-deploys). Promotion
  gated on tests + clean migration + green smoke battery + soak. Per-deployment migration-failure
  isolation retained (`L1141-1160`).
- **Version skew is normal + bounded, not an error** — made safe by **expand-contract migrations**
  (new binding standard `standards/migration-discipline.md`); rollback = code-redeploy + roll-forward,
  **never destructive down-migration**; `deploy_max_version_skew`/`deploy_max_skew_days` alert catches
  laggards.
- **Provisioning = scripted CLI + runbook** (chose B3 over full-IaC / pure-manual), **two-party** per
  ADR-001 hybrid: client creates cost-bearing accounts + card + delegated access (runbook); operator
  script does Railway link + env/`DEPLOYMENT_CONFIG` + `internal_token` mint/dual-store + `client_registry`
  insert + first-deploy→seed. **Operator-side registration** (no self-registration → no token chicken-and-egg).
- **OAuth apps per-client in the client's own accounts** (ADR-001 §5), redirect URIs → that deployment's
  Railway domain. ⚠️ Google **production verification** (AF-013) is a real onboarding **schedule dependency**.
- **Canary test method** (user's gap): **seeded synthetic client + deterministic smoke battery** now
  (catches boot/migration/connector + behavioral checks; shares the AF-001/AF-002 corpus), maturing into
  **operator dogfooding** its own deployment. Honest limit flagged: catches only what fixtures cover.
- **Plugins stay out of the release train** (per-deployment, manual; version-visibility only).

**Captured as MUST-TEST:** new feasibility block **F** —
- **AF-064 (DOCS+SPIKE)** — Railway supports the branch-based canary/promotion + build-history rollback model.
- **AF-065 (SPIKE)** — expand-contract keeps a mixed-version fleet safe (the skew + rollback premise). *Parts 3+4 rest on this.*
- **AF-066 (EVAL)** — the synthetic canary corpus is representative enough to catch behavioral regressions.
- Sharpened **AF-004** (full provisioning path) and **AF-020** (Railway auto-deploy + migrate-on-release).

**Files changed:** `adr/ADR-005-deploy-provisioning.md` (new, Accepted); `open-decisions.md` (OD-005 → 🟢);
`adr/README.md` (ADR-005 Accepted); `feasibility-register.md` (new block F AF-064–066; AF-004/020 sharpened;
next AF-067); `glossary.md` (+Canary deployment, +Release train/promotion, +Version skew, +Expand-contract
migration, +Provisioning script vs runbook, +Synthetic canary corpus/smoke battery); `out-of-scope.md`
(OOS-010 automated plugin distribution, OOS-011 full-IaC; next OOS-012); `standards/migration-discipline.md`
(new, Binding); `README.md` (ADR status line, repo map standards).

**Next step:** **ADR-006 (dynamic roles vs static RLS)** — draft→approve (OD-006). Roles are editable at
runtime but RLS is authored at migration time; ADR-001 made RLS **intra-client only** (role/visibility/
sensitivity, never client separation) — lock against that. Then ADR-007 (injection posture, OD-007), then
priority spikes (AF-001 cost, AF-002 retrieval, AF-004 provisioning), then Phase 1 (component 0 Login).

---

## Session 6 — 2026-06-23 — ADR-004 ACCEPTED (memory-write concurrency)

First **draft→approve** ADR (not a grill). Closes OD-004 — the contradiction-check-then-write
TOCTOU race under `parallel_execution`/fan-out.

**Decided:** **Per-entity serialization + optimistic validate-and-commit.**
- Serialize only **same-entity** writes (disjoint writes stay parallel → fan-out preserved). A
  contradiction is always same-entity, so that's the only race that matters.
- **Core insight:** can't hold a DB lock across the multi-second Sonnet writer (pool exhaustion +
  ADR-003 waste). So LLM work runs **unlocked**; then a **short** transaction under **sorted
  per-entity Postgres advisory locks** (`pg_advisory_xact_lock`, sorted = deadlock-free) re-checks
  a per-entity watermark `max(updated_at)` — unchanged → commit; changed → re-run only the cheap
  **DB** contradiction check (no LLM) and commit/re-target/bounce. Locks held ~ms.
- Three supports: **Memory Agent = sole writer** (invariant, locks design `L3435`); **unique
  idempotency constraint** `hash(source_ref, sorted entity_ids, content_hash)` kills retry
  double-writes; **CAS supersede** (`WHERE superseded_by IS NULL`) kills lost supersession.
- Daily supersede / weekly merge **demoted** from correctness to hygiene. `memory_writes_per_minute:30`
  makes serialization effectively free.
- **Rejected:** A do-nothing/daily-job (wrong for hours), B global-serialize (kills fan-out),
  C pessimistic-lock-across-LLM (wrong granularity + hold time), D optimistic-only (misses the
  duplicate-insert case — folded in as a support instead).
- **User-flagged knob (left as-is):** on a detected race the re-check re-runs the **DB** check, not
  a full Sonnet re-decision — deliberate "good enough" to avoid LLM livelock. User approved.

**Captured as MUST-TEST (user explicitly asked):** new feasibility block **E** —
- **AF-061 (SPIKE+EVAL)** — the validate-and-commit actually closes the window, no livelock. *The
  whole correctness claim rests on this.*
- **AF-062 (LOAD)** — advisory locks + short txns don't bottleneck at scale; multi-entity locks
  deadlock-free.
- **AF-063 (DOCS+SPIKE)** — Inngest per-key concurrency behaves as assumed; degrades safely to
  advisory-lock-only.

**Files changed:** `adr/ADR-004-concurrency-model.md` (new, Accepted); `open-decisions.md`
(OD-004 → 🟢); `adr/README.md` (ADR-004 Accepted); `feasibility-register.md` (new block E
AF-061–063; next AF-064); `glossary.md` (+TOCTOU race, +Per-entity serialization, +Advisory lock,
+Optimistic validate-and-commit, +Idempotency key); `README.md` (ADR status line).

**Next step:** **ADR-005 (deploy fan-out & provisioning automation)** — draft→approve (OD-005).
Push-deploy to N Railway projects + per-client Supabase/OAuth provisioning + version skew across
clients. Builds on ADR-001 (hybrid ownership). Priority spike AF-004 (provisioning) is its
companion. Remaining draft-approve ADRs after that: ADR-006 (RLS/dynamic roles, OD-006),
ADR-007 (injection posture, OD-007). Then priority spikes, then Phase 1 (component 0 Login).

---

## Session 5 — 2026-06-22 — Process fully externalized (full-optics docs)

User wanted the entire operating model written down now (not just-in-time), with full optics —
what/want/goal/why/how — so any future chat inherits the complete picture and never has to
*invent* methodology (only *follow* it).

**Created:**
- `spec/00-foundations/process-overview.md` — the optics bible: WHAT we're doing, WHAT the user
  wants, the GOAL (Point B / DoD), WHY (first principles), HOW (the machine), ID system,
  artifacts map, who-decides-what, current-state pointer.
- `spec/00-foundations/phase-playbooks.md` — repeatable procedure for all 6 phases. Phase 0 + 1
  at full mechanical detail (Phase 1 is the engine: 10-step per-component loop incl. parking
  cross-phase CFG/UI/DATA/PERM stubs, verification gate, sign-off). Phases 2–6 at goal+approach+
  done-when altitude, each finalized right before entry (living docs, change-controlled).

**Wired:** CLAUDE.md start-of-session reading list now includes both, + the **self-sufficiency
test** (repo alone must suffice, zero conversation). README repo map updated.

**Principle locked:** *author methodology where context is richest (now); future chats execute,
never invent.* The repo-self-sufficiency test is the guard against drift across chats.

**Next step:** unchanged — **ADR-004 (concurrency model for memory writes)**, draft→approve.
Then ADR-005/006/007, priority spikes (esp. AF-001 cost, AF-002 retrieval), then Phase 1
(component 0 Login as the golden exemplar).

---

## Session 4 — 2026-06-22 — Process hardening (5 additions) + retrofit pass

(Side chat, after ADR-003 committed `411364a`. This chat became the writer; working tree was
clean/synced first.) Added five process improvements the user requested:

1. **Backup & disaster recovery** — logged **OD-009** (whose job + strategy; ADR-001's
   client-owned Supabase makes backup ownership/verification ambiguous) and added it to Phase 5
   scope in README. Net-new gap, not a retrofit.
2. **out-of-scope.md created** (OOS-001..009) — seeded by **retrofitting deferrals already made**
   in ADR-001/002/003: region v2, confidence-weighted slot-fill v2, re-rank/HyDE off-by-default,
   self-host Inngest, full Model-A (client compute) exception-only, Pooled fallback, weekly cost
   auto-throttle out, HR ingestion off, cost reconcile deferred.
3. **Build-order / dependency map** — added to Phase 6 (README).
4. **Change-control standard** (`standards/change-control.md`) — Accepted ADRs immutable
   (supersede via new ADR); Ready/Approved FRs change via a new OD. Wired into CLAUDE.md +
   requirement-template.
5. **Component sign-off** — added `Approved` to the FR status lifecycle (requirement-template),
   the end-of-session ritual (CLAUDE.md), and the Definition of Done (README).

**Retrofit check — result: nothing needs reopening.** ADRs 001–003 stand as-is; they were
signed off via grilling, so the new `Approved` status applies to Phase-1 component FRs going
forward, not retroactively. The only retrofit was capturing their already-made deferrals into
out-of-scope.md (#2 above). Accepted ADRs are now under change-control from here on.

**Files changed:** `out-of-scope.md` (new), `standards/change-control.md` (new),
`open-decisions.md` (OD-009; next = OD-010), `requirement-template.md` (Approved status +
rules 7–8), `CLAUDE.md` (change-control + sign-off ritual), `README.md` (repo map, Phase 5
backup/DR, Phase 6 build-order, DoD).

**Next step:** unchanged — **ADR-004 (concurrency model for memory writes)**, draft→approve.
Lock against the ADR-003 write-path (code filter → Haiku gate → Haiku pre-check → Sonnet writer)
and the `memory_writes_per_minute:30` cap (per Session 3 note).

---

## Session 3 — 2026-06-22 — ADR-003 ACCEPTED (cost model — client-side viability + cost ladder)

**Decided (grill complete, all forks resolved; closes OD-003):**
- **Scope reframed by ADR-001:** opex client-borne → operator marginal cost ≈ $0. Cost is **not**
  operator P&L. ADR-003 commits to (a) a per-deployment viability **envelope** and (b) runaway
  **guarantees**. (Rejected operator-P&L framing — would reopen ADR-001; rejected mechanisms-only.)
- **Breach = tiered ladder, not alert-only** (modelled on the rate-limit 80/95/100 ladder):
  soft alert `$50/day` + `$200/week` (notification only) → **throttle** non-critical at `$75/day`
  (1.5×) → **hard kill** at `$100/day` (2×) = urgent + human-only. All keys per-deployment,
  operator-tunable to client spend tolerance. Daily≠weekly×7 is intentional (spike vs sustained).
- **Cost source = estimate-grade**, not invoice: event-log tokens × an operator-editable price
  table; **all vendors** (Sonnet+Haiku+OpenAI embeddings); **fail-safe rounded UP** so the ceiling
  fires early. Real invoice is unreachable (ADR-001 boundary).
- **Memory write corrected:** OD-003's "3 Sonnet calls" is **wrong** → ≤**1 Sonnet** (writer) +
  Haiku pre-checks; code noise-filter + Haiku selective-writing gate run first. `memory_writes_per_minute:30`
  caps Sonnet writer at 30/min, not 90.
- **Loops short-circuit in code** (DB/condition check) before waking the Sonnet orchestrator —
  idle-deployment loop floor ≈ free. Not an LLM gate.
- **Principle "controls before gates"** (binding): structural/code limits first; one self-funding
  Haiku gate only (selective-writing); **re-rank/HyDE NOT mandated** (AF-002-gated). User pushed on
  "do we need extra LLM gates" — answer: mostly no.
- **Viability target ≤ ~$20/day typical**, $50 = investigate, $100 = backstop. Lever order if AF-001
  shows over-budget: model routing → selective-writing → loop gating → injection limit → orchestrator
  confidence threshold (highest leverage).
- **Haiku decision log + trust window (user-requested, ADR-003 §8):** all 3 memory-path Haiku
  decisions logged (input + verdict + outcome) for manual review; **3-week trust window**
  (`haiku_audit_window_days:21`) in **shadow-retain** mode (would-drop memories written + tagged,
  never lost); after the window, if disagree-rate < threshold the gate goes autonomous. This audit
  log IS the validation data for AF-043/AF-035. Same pattern = template for auditing routing later.
- **Model-routing telemetry (user-requested):** standing **dual-track** — cost (model+task+$) AND
  quality (false-drops/mis-routes/classifier errors). A cost win is worthless if quality silently
  degrades. → AF-035 sharpened.

**Files changed:** `adr/ADR-003-cost-model.md` (new, Accepted; incl. §8 Haiku decision log + routing
telemetry); open-decisions (OD-003 → 🟢); glossary (+Estimated cost, +Cost ladder, +Critical work,
+Haiku decision log, +Trust window, +Shadow-retain; Guardrail row +cost ladder); feasibility-register
(AF-001/035/040/041 sharpened; **AF-042** estimator drift, **AF-043** gate ROI/trust added); adr/README
(ADR-003 Accepted); README (ADR status line — all 3 load-bearing grills done).

**Feasibility:** ⚠️ AF-001/040/041 (viability target paper-only until cost spike) · ⚠️ AF-042
(estimate-vs-invoice drift) · ⚠️ AF-043 (selective-writing gate must pay for itself).

**Next step:** **ADR-004 (concurrency model for memory writes)** — draft→approve (not a grill).
TOCTOU race on contradiction-check-then-write under parallel agents; no per-entity locking defined
(OD-004). Note for ADR-004: the ADR-003 write-path (code filter → Haiku gate → Haiku pre-check →
Sonnet writer) and `memory_writes_per_minute:30` cap are the concurrency surface to lock against.

---

## Session 2 — 2026-06-22 — ADR-002 ACCEPTED (coverage % → Maturity + Retrieval Sufficiency)

**Decided (grill complete, 5 forks resolved):**
- **Q1 — split** the overloaded "coverage %" into two metrics (vs one number for both jobs).
- **Q2 — denominator = expected knowledge slots** per entity type (vs volume / confidence-only).
  Binary slot-fill at v1.
- **Q2b — one slot substrate, two read-paths** (vs two independent engines) + three anti-bloat
  guardrails: thin Sufficiency (no bespoke model), 5–8 operator-editable slots/type, defer
  confidence-weighted fill to v2.
- **`[Building]` recurs per-entity:** deployment cold-start *mode* is one-time (off at 80%
  permanently); the `[Building]` *flag* reappears for new/thin entities (e.g. a year-two client).
  Resolved the doc's two self-contradictions (per-entity vs overall; "permanent" vs recurring).
- **OD-008 closed:** `[Building]` is a flag, not a 4th pill → 3 pills (Cited/Inferred/Unknown).

**Model:** Maturity = `filled slots / expected slots` (stored, daily + on-write, aggregate gates
cold-start 20/50/80). Retrieval Sufficiency = query-time threshold over existing retrieval
signals (slots-touched filled AND surfaced above relevance×confidence bar). Pill rule:
low Sufficiency + entity Maturity < proactive(50) → `[Building]`; else `[Unknown]`.

**Files changed:** `adr/ADR-002-coverage-metric.md` (new, Accepted); glossary (retired Coverage %,
added Maturity / Retrieval Sufficiency / Expected knowledge slot, resolved Answer mode + Cold
start); open-decisions (OD-002, OD-008 → 🟢); adr/README (ADR-002 Accepted); feasibility-register
(AF-034 sharpened); README (ADR status line).

**Feasibility:** ⚠️ AF-034 — slot-fill Maturity predicting "useful" + the Sufficiency threshold
separating `[Building]`/`[Unknown]` are **paper-only**, validated in the AF-002 retrieval spike.

**Next step:** Grill **ADR-003** (cost model & economic viability — last load-bearing grill).
Note from ADR-001: opex is client-borne, so cost tracking is *visibility-grade, not
invoice-grade* — fold that into the ADR-003 framing. AF-001 cost spike runs alongside.

---

## Session 1 — 2026-06-22 — Foundations + ADR-001

**Decided:**
- Method locked: git markdown repo · grill load-bearing ADRs / draft-approve the rest ·
  foundations first then components 0→10. (See README.)
- **ADR-001 (Isolation model) — Accepted.** Silo (one Supabase per client) · single
  codebase / N runtimes · `client_slug` deleted from all app tables · hybrid account
  ownership (client owns Supabase + API keys + opex on their card; operator owns Railway
  compute / the moat) · Railway GitHub auto-deploy · Super Admin = pushed operational
  metadata only, never client business data.

**Created:**
- Repo skeleton: `README.md`, `CLAUDE.md`, `spec/00-foundations/` (id-conventions,
  requirement-template, glossary, open-decisions, adr/, standards/config-edit-taxonomy),
  `traceability-matrix.csv`, `spec/source/` (design doc + review scaffolding copied in).
- `spec/00-foundations/adr/ADR-001-isolation-model.md`.

**Open decisions remaining:** OD-002..OD-008 (see open-decisions.md). Load-bearing grills
left: ADR-002 (coverage metric), ADR-003 (cost model). Draft-approve: ADR-004 (concurrency),
ADR-005 (provisioning/deploy), ADR-006 (RLS), ADR-007 (injection), OD-008 (pill count).

**Added (post-ADR-001):** Feasibility track — `spec/00-foundations/feasibility-register.md`
(AF-* IDs, seeded with 4 priority spikes + vendor/behavioural/cost/scale assumptions). Wired
into CLAUDE.md (feasibility flagging rule), id-conventions (AF- type), requirement template
(Feasibility field), README (parallel track). ACRONYMS.md added at repo root.

**Next step:** Grill ADR-002 — define "memory coverage %" (the metric behind cold-start
gating, the [Building] pill, proactive suppression). Currently a percentage with no
denominator. When defined, link it to AF-034 (is the metric actually meaningful — EVAL).
