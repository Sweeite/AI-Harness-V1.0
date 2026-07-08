---
id: ISSUE-020
title: RLS enforcement — visibility/sensitivity/Restricted/aal2 + service_role path + mid-task revocation
epic: B — identity & access
status: done
github: "#20"
---

# ISSUE-020 — RLS enforcement — visibility/sensitivity/Restricted/aal2 + service_role path + mid-task revocation

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Author the *enforcing* RLS on top of the ISSUE-009 scaffold — the data-driven helper predicates (visibility ∩ sensitivity ∩ Restricted, entity-type-scoped), the universal `aal2` baseline clause, the harness/RLS divergence signal, and the harness-side mid-task authorization re-check that stops a `service_role` task once its originating user is deactivated or a relied-on grant is revoked.

## 2. Scope — in / out
**In:**
- The `STABLE SECURITY DEFINER` helper functions' *contract* wired into policies via the `(select …)` initPlan wrapper, so a role/clearance/grant edit changes the same static policy's result on the next statement with no migration (FR-1.RLS.002). The enforcing predicates read via `user_perms`, `user_visibility`, `user_clearances`, `user_restricted`, and `user_aal` — five helpers once the PERM-node resolver (`user_perms`) and the **visibility-tier resolver (`user_visibility`)** are kept distinct per **OD-168**. (Where a manifest file's "four helpers" phrasing predates OD-168, it collapsed `user_perms`/`user_visibility` under the `user_perms` shorthand.)
- The row-access-subset predicate on sensitive tables — a user reads a row only when they hold its visibility tier AND the required sensitivity clearance (entity-type-scoped) AND, for Restricted rows, a live per-individual grant; no `client_slug`/cross-deployment clause (FR-1.RLS.003).
- The `user_aal() = 'aal2'` baseline clause added to *every* protected table's human-path policy (FR-1.RLS.005) — the DB realization of C0's FR-0.AUTH.008.
- The harness step-boundary re-check binding the originating user to a `service_role` task and halting-and-quarantining before the next consequential side effect on deactivation / relied-on-clearance-or-Restricted revocation, while a benign session-expiry continues (FR-1.RLS.007) — this issue owns the **authorization rule**; the abort/quarantine machinery itself is C5/C6/C8 (ISSUE-024 and beyond).
- The runtime divergence signal: a harness-permitted read that RLS returns as zero rows is logged as a divergence event, not silently returned as "no data" (FR-1.RLS.008).

**Out:**
- RLS *scaffold* — `pg` enablement on every table, the default-deny baseline, the 100%-coverage CI gate, the human-vs-service_role split (FR-1.RLS.001/004) and instant-propagation guarantee (FR-1.RLS.006): **ISSUE-009** owns these; this issue builds *on* them.
- The role table / `can()` gate / permission matrix: **ISSUE-018**. The clearance + Restricted model (tiers, per-role defaults, grant/revoke flows): **ISSUE-019**.
- The per-agent `memory_scope` fail-closed retrieval filter (NFR-SEC.011's agent-side composition): consumed here as a boundary but authored in **ISSUE-025** (retrieval) / C8 scoping.
- The abort/quarantine/compensation mechanism for an already-applied side effect: seamed to C5/C6/C8 (OD-010); referenced, not built here.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-1.RLS.002, FR-1.RLS.003, FR-1.RLS.005, FR-1.RLS.007, FR-1.RLS.008 (all Component 1 — RBAC).
- **NFRs:** NFR-SEC.010 (aal2 + RLS coverage — shared with ISSUE-009), NFR-SEC.011 (service_role blast radius bounded), NFR-SEC.012 (mid-task authorization re-check).
- **Rests on:** ADR-006 (parts 2, 4, 5, 6 — static data-driven RLS; intra-client-only; harness/RLS division; human-path-RLS/agent-path-service_role), ADR-004 (sole-writer as service_role), ADR-007 (containment — a consequential side effect must hit a code gate), ADR-001 §3/§4 (physical isolation → no `client_slug` predicate); AF-067, AF-076, AF-079, AF-080, AF-081, AF-068; **ODs:** OD-031 (mid-task re-check rule), OD-010 (abort/compensation seamed out), OD-168 (helper naming + visibility-tier resolution reconciled).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-1.RLS.002.1, AC-1.RLS.002.2 (FR-1.RLS.002 — data-driven, initPlan-linted)
- AC-1.RLS.003.1, AC-1.RLS.003.2 (FR-1.RLS.003 — clearance predicate; no `client_slug`)
- AC-1.RLS.005.1 (FR-1.RLS.005 — every protected table carries the `aal2` clause)
- AC-1.RLS.007.1, AC-1.RLS.007.2, AC-1.RLS.007.3 (FR-1.RLS.007 — mid-task stop; expiry ≠ revocation)
- AC-1.RLS.008.1 (FR-1.RLS.008 — divergence logged, not silent zero-rows)
- AC-NFR-SEC.010.1, AC-NFR-SEC.010.2 (coverage + aal2 denial)
- AC-NFR-SEC.011.1, AC-NFR-SEC.011.2 (fail-closed scope; `S ∩ C`, Restricted never auto-injected) — **boundary-only in this slice.** Their enforcing FRs are `FR-8.SCO.001/002` + `AC-5.ASM.006.2` (C8/C5, per security.md NFR-SEC.011 "Implemented by"), which field 2 scopes **OUT** (authored in ISSUE-025 / C8). This issue builds the human-path clearance predicate these compose *with* (FR-1.RLS.003) and consumes the `memory_scope` filter as a boundary; the `memory_scope` fail-closed filter itself is **not built here**, so these two ACs are **fully proven only once ISSUE-025 / C8 land** — this slice cannot green them standalone (consistent with `status: blocked` + the ISSUE-025 seam). They remain on the DoD as the composed-behaviour target, not a within-slice build deliverable.
- AC-NFR-SEC.012.1, AC-NFR-SEC.012.2 (halt-before-side-effect; benign-expiry continues) — this issue owns the **authorization rule** (FR-1.RLS.007); the abort/quarantine **mechanism** is seamed to C5/C6/C8 (OD-010), so full end-to-end proof also depends on those slices.
- **Gating spikes (if any):** **AF-068 must be GREEN** before this issue ships — proven by **ISSUE-003** (injection-containment red-team, per backlog "RLS.007 → 003(spike)" and OD-157). AF-068 confirms no authorized-but-revoked autonomous path reaches a consequential side effect without hitting the FR-1.RLS.007 code gate. AF-067 (RLS hot-path latency, ISSUE-002) must also hold for the FR-1.RLS.002/003 predicates.

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-roles, DATA-role_permissions, DATA-user_roles, DATA-sensitivity_clearances (incl. `.entity_type_scope`, `.last_reviewed_at`), DATA-restricted_grants (incl. `.revoked_at`), DATA-memories (incl. `.visibility`), DATA-entities, DATA-access_audit (incl. `.originating_user_id`), DATA-event_log (the divergence/mid-task-stop sink, schema.md §8); read-composed by the helper functions `user_perms` (PERM nodes, `text[]`) / `user_visibility` (held visibility tiers) / `user_clearances` (sensitivity tiers+scopes) / `user_restricted` (live Restricted grants) / `user_aal` (session AAL). **Naming note (per OD-168):** the visibility resolver is **`user_visibility`**, a helper **distinct** from the PERM-node `user_perms` — `rls-policies.md`'s helper list used `user_perms` as a family shorthand and omitted `user_visibility`; the authoritative name + held-visibility-tier mapping contract are fixed in **OD-168**. This issue wires the subset of these the enforcing predicates need (see build order below).
- **PERM:** none newly created here (nodes are homed in ISSUE-018/019); the policies *read* PERM grants live via helpers.
- **CFG:** CFG-auth.two_factor_required (C0 intent flag consumed by the `aal2` clause).
- **UI:** none (DB/harness layer; the mid-task quarantine surface is C6/C8).
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-01-rbac.md — the FR text + ACs (RLS.002/003/005/007/008, and USR.002 reactivation branch for the revocation edge).
- spec/04-data-model/rls-policies.md — the per-table policy summary, the helper-function contracts (its L26-38 list names `user_perms`/`user_clearances`/`user_restricted`/`user_aal`; read the visibility resolver `user_visibility` per **OD-168**, which reconciles this file's omission), the `(select …)` initPlan rule, and the three-non-negotiables-in-RLS notes.
- spec/04-data-model/schema.md §2 (RBAC & Access) — `roles`/`role_permissions`/`user_roles`/`sensitivity_clearances`/`restricted_grants`/`access_audit`; §3 (Memory) — `memories` (incl. the `visibility` column, L296) / `entities` for the sensitive-table predicate; **§8 (Observability) — `event_log`**, the append-only sink the mid-task stop (step 5) and the divergence signal (step 6) write to (the column layout the write targets lives here, not in §2/§3).
- spec/05-non-functional/security.md — NFR-SEC.010, NFR-SEC.011, NFR-SEC.012 (and .004/.006 for the containment posture the mid-task gate sits inside).
- spec/00-foundations/adr/ADR-006-rls-dynamic-roles.md — parts 2, 4, 5, 6 (the architectural spine of this slice).
- spec/00-foundations/open-decisions.md — **OD-168** (RLS helper naming + visibility-tier resolution): read this for which helper resolves visibility (`user_visibility`, distinct from `user_perms`) and the held-visibility-tier mapping contract, before authoring build steps 2-3.

## 7. Dependencies
- **Blocked-by:** ISSUE-009 (RLS scaffold — enablement, default-deny, coverage gate, human/service_role split), ISSUE-019 (clearance + Restricted model this predicate reads), ISSUE-003 (**SPIKE** — proves AF-068 GREEN for the FR-1.RLS.007 mid-task path).
- **Blocks:** ISSUE-024 (memory write / sole-writer path — mid-task revocation gate applies to its `service_role` writes), ISSUE-025 (retrieval — clearance-before-ranking composes with this predicate).

## 8. Build order within the slice
1. Confirm the ISSUE-009 scaffold is in place (RLS enabled + default-deny baseline on every table, human/service_role split) — this slice adds predicates, it does not enable RLS.
2. Wire the helper functions (`user_perms`, `user_visibility`, `user_clearances`, `user_restricted`, `user_aal` — `user_visibility` is the visibility-tier resolver, distinct from `user_perms`, per **OD-168**) into the sensitive-table policies via the `(select helper(auth.uid()))` initPlan wrapper; index the policy columns; get the `auth_rls_initplan` advisor lint clean (FR-1.RLS.002 → AF-067). The exact SQL body of each helper (including `user_visibility`'s role→tier lookup) is a Phase-4 build artifact on the same footing as the `user_perms`/`user_clearances` bodies (rls-policies.md L107-110); OD-168 fixes the contract (returns the caller's held `visibility_tier` set, read live from the user's one active role).
3. Author the row-access-subset predicate on `memories`/`entities` and other sensitive tables: **visibility tier** (`memories.visibility` ∈ `global|team|private`, schema.md §3 L296, matched against the caller's held tiers from `user_visibility` per **OD-168**) ∩ entity-type-scoped sensitivity clearance (`user_clearances`) ∩ live Restricted grant (`user_restricted`, `revoked_at IS NULL`); assert no `client_slug` clause (FR-1.RLS.003).
4. Add the `user_aal() = 'aal2'` baseline clause to *every* protected table's human-path policy; run the coverage check so a missing clause fails the build (FR-1.RLS.005 → AF-076/AF-079, NFR-SEC.010).
5. Implement the harness mid-task authorization re-check: bind `originating_user_id` to the `service_role` task, re-evaluate active-status + relied-on clearances/grants at each step/injection boundary, halt+quarantine before the next consequential side effect on deactivation/revocation, continue on benign session-expiry (FR-1.RLS.007 → AF-068, NFR-SEC.012); write the stop to `access_audit` + security `event_log` with `event_type = 'authz_revoked_midtask'` (schema.md §8 enum, added per OD-170).
6. Add the runtime divergence signal: when the harness permitted a read but RLS returns zero rows, emit a divergence `event_log` event with `event_type = 'rls_harness_divergence'` (schema.md §8, OD-170) rather than a silent empty result (FR-1.RLS.008 → AF-080).
7. Test to each AC in field 4 across both the human path (RLS) and the agent/service_role path (harness re-check).

## 9. Verification (how DoD is proven)
- **DB/policy layer:** per spec/05-non-functional/test-strategy.md — coverage/lint gate (`auth_rls_initplan` clean, aal2-clause-present on every protected table, no `client_slug` predicate) proves AC-1.RLS.002.2 / AC-1.RLS.005.1 / AC-1.RLS.003.2 / AC-NFR-SEC.010.1.
- **Integration (human path):** an under-cleared / `aal1` / non-Restricted session sees zero forbidden rows — AC-1.RLS.003.1, AC-NFR-SEC.010.2, AC-NFR-SEC.011.2.
- **Integration (agent path):** a `service_role` task whose originating user is deactivated / has a relied-on clearance revoked mid-run halts+quarantines before the next consequential side effect, and a benign expiry continues — AC-1.RLS.007.1/.2/.3, AC-NFR-SEC.012.1/.2; fail-closed scope resolution — AC-NFR-SEC.011.1.
- **Divergence:** a deliberately-mismatched harness/RLS pairing emits the divergence event — AC-1.RLS.008.1.
- **Spike gate:** AF-068 GREEN (ISSUE-003 red-team) is a precondition to shipping FR-1.RLS.007; AF-067 latency budget (ISSUE-002) holds for the FR-1.RLS.002/003 predicates on the hot path. The AC→`Verified` path for each RLS AC runs once its spike gate is GREEN.

## 10. Build evidence (✅ DONE — Session 76, 2026-07-08, 💻 FULL)

**Slice built:** the *enforcing* RLS on top of the ISSUE-009 scaffold — the DB-side row-access predicates + the universal aal2 baseline (silo migration **0031**, applied LIVE, head `0030`→`0031`) **and** the harness-side authorization rules the service_role path needs (new package **`app/rls-enforcement/`**), which RLS cannot enforce (ADR-006 part 6).

**① Migration `0031_rls_enforcement` (transactional, applied LIVE):**
- **`user_visibility(uid)`** — the fifth helper, DISTINCT from `user_perms` (OD-168). Its source is a NEW additive **`roles.visibility_tiers`** role-attribute column (OD-168's sanctioned "small role-attribute" — keeps visibility OUT of ISSUE-018's PERM-node catalog, per §5), seeded from the design-doc L509-615 Memory-Access matrix (Global = all six · Team = all but Standard User · Private = SA+Admin). Same `SECURITY DEFINER STABLE set search_path=''` discipline as the four 0002 helpers, `(select …)`-wrapped (AF-067).
- **`memories_clearance_read`** — the marquee predicate: `aal2 ∧ user_visibility ⊇ [visibility] ∧ (sensitivity∉{confidential,personal} ∨ entity-type-scoped clearance) ∧ (sensitivity≠restricted ∨ live per-individual grant)`. NO `client_slug` clause (AC-1.RLS.003.2 — isolation is physical).
- **`entities_internal_org_read`** — Internal-Org rows walled behind a Confidential clearance; client-facing entities readable by any aal2 human.
- **RBAC-self read policies** (roles / role_permissions / user_roles / sensitivity_clearances / restricted_grants / access_audit) per rls-policies.md, each aal2-gated; **+ `grant select … to authenticated`** on every opened table (0001c revoked base grants — a policy filters rows but the privilege must exist first, exactly as 0003/0004/0022 do).
- **aal2 RETROFIT** — a non-destructive `ALTER POLICY` adds the `user_aal()='aal2'` conjunct to the four grant policies authored before the universal-aal2 rule (profiles ×2, prompt_edit, config_prompts_edit, config_values_read). A live tail assertion + the CI text-lint (below) prove no `authenticated` GRANT policy omits aal2 (support_requests pre-auth intake exempted). Realizes FR-1.RLS.005 / AC-1.RLS.005.1 / AF-076.

**② `src/rls-lint.ts` extended:** `user_visibility` added to the guarded-call set; a new **`checkAal2Coverage`** lint (create+alter aware, last-write-wins) is the CI teeth for FR-1.RLS.005 — wired into `checkAllRls` (`npm run check`). 6 new unit tests.

**③ `app/rls-enforcement/` (new package — port + fake + live adapter):** **`recheck.ts`** (FR-1.RLS.007 mid-task authorization re-check — binds originating_user_id, re-evaluates active-status + relied-on clearances/grants at each boundary, halts+quarantines before the next *consequential* side effect on deactivation/revocation, continues on benign expiry because the rule keys only on authz DATA not session liveness — expiry ≠ revocation; fail-closed on unknown user); **`divergence.ts`** (FR-1.RLS.008 — harness-permitted-but-RLS-zero-rows → `rls_harness_divergence` event, never silent); `store.ts` (port + `InMemoryRlsEnforcementStore`); `supabase-store.ts` (live adapter); `index.ts` (`check`: the two event_type constants are non-drift-guarded against the live 0001 enum).

**④ Tests — offline GREEN:** silo **76/76** (4 new 0031 assertions + 6 aal2-lint tests); rls-enforcement **12/12** (one per AC-1.RLS.007.1/.2/.3 + NFR-SEC.012.1/.2 + fail-closed + AC-1.RLS.008.1) + `check`. Typecheck clean both packages.

**⑤ R10 live-adapter capstone (`app/silo/results/issue-020-rls-enforcement-capstone.sql`, rolled back) — ALL ASSERTIONS PASSED** against the real silo as a genuine `authenticated` session: user_visibility resolves {global,team}≠private · **aal1 session sees 0 rows** (AC-1.RLS.005.1) · under-cleared user sees only the global/standard row, confidential/private/restricted all hidden (AC-1.RLS.003.1) · a confidential/finance clearance grant is **instant** on the next query (AC-1.RLS.006.1) · an hr-scoped clearance does NOT reveal a finance-typed row (entity-type scope, FR-1.CLR.004) · a live Restricted grant reveals then a revoke hides the restricted row (FR-1.RLS.003) · Internal-Org wall holds · service_role bypasses (ADR-006 part 6) · the rls-enforcement adapter's loadOriginatingAuthz reads + event_log/access_audit appends succeed. **The capstone caught + fixed two real bugs pre-commit** — the `= any((select …))` subquery-vs-array operator error, and a clause-A logic bug that made every `restricted` row unreadable (a `restricted` sensitivity is not a `clearance_tier`, so it must pass the clearance clause and be gated by the grant instead). Exactly the class R10 exists to catch.

**⑥ Feasibility:** AF-067 (initPlan latency) + AF-068 (containment red-team) were already 🟢 PASS (ISSUE-002/003) and gate this ship. **AF-076** (complete aal2 coverage) + **AF-079** (RLS coverage) + **AF-080** (harness/RLS divergence) are now realized in code (the aal2 lint + tail assertion; the divergence signal) — DOCS→shipped. AC-NFR-SEC.011.1/.2 remain **boundary-only** here (the fail-closed `memory_scope` filter is authored in ISSUE-025/C8, per §4); full AF-068-battery re-test of the shipped enforcement is the cross-C5/C6/C8 release gate.

**Tracker reconcile (Rule 0):** `020` frontmatter `ready → done`; **`024` flipped `blocked → ready`** (its co-blockers `022`+`020` are both `done`); BUILD-SCHEDULE `020` ticked; `_backlog` roll-up; feasibility AF-076/079/080 notes; README; traceability; GitHub #20 closed. **Checkpoint 5 stays OPEN** — `022`✅ + `020`✅ are two of its three closing conditions; the batch (`021`/`038`/connectors/`052`/`058`/`062`/`064`/`065`/`068`/`078`/`079`/`083`/`086`) must still prove as a group.

**Found (out of 020's scope — flagged):** `profiles` has NO `authenticated` SELECT grant (0006/ISSUE-013 never granted it), so `profiles_owner_read` is currently dead (permission-denied) — fail-CLOSED (denies, no leak), but a real latent gap in the ISSUE-013 slice. Not fixed here (profiles is ISSUE-013's table); flagged for that issue.
