---
id: ISSUE-028
title: Conflict quarantine + consolidation approval
epic: C — memory
status: ready
github: "#28"
---

# ISSUE-028 — Conflict quarantine + consolidation approval

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Hold hard write-conflicts and Personal-tier consolidation candidates in human-gated quarantine/approval queues — never auto-resolving, never silently applying, always escalating an un-actioned item.

## 2. Scope — in / out
**In:** The two human-gated review paths that guard the memory write path against silent corruption:
- The **hard-conflict quarantine** half of the contradiction check (FR-2.WRT.002): when the pre-write contradiction check finds a *hard* conflict, hold the new memory in the `memory_conflicts` store (pending, out of the live retrievable set, old memory untouched), attach the priority-rule *suggested* resolution (FR-2.MNT.008), and expose three reviewer actions — Keep-new (CAS-supersede existing via `superseded_by`), Keep-existing (discard held write), Keep-both (retain both live + link with a note so retrieval injects both; close the quarantine record). Every resolution routes through the sole writer (ADR-004), never a direct insert.
- The **Personal-tier consolidation approval** gate (FR-2.MNT.014): when the merge/summarise lifecycle jobs encounter a Personal-tier candidate they skip it and queue it in `consolidation_approvals`; a Personal-cleared reviewer Approves (route through the sole writer; evidence layer retained) or Rejects (keep separate). Standard-tier consolidation never appears here.
- The conflict-resolution priority rules themselves (FR-2.MNT.008) — the rule table that produces the *suggested* resolution and the rule-5 "inject both with a note" behaviour.
- The un-actioned → escalated computation on both queues (server-owned `escalated_at` vs `CFG-review_escalation_days`), and the two surface-03 tabs (Conflicts, Consolidation).
- The two new PERM nodes minted for these queues (OD-115): `PERM-memory.review_conflict`, `PERM-memory.approve_consolidation`.

**Out:**
- The **no/soft-conflict** write path, the pre-write similarity pull, validate-and-commit, and the sole-writer mechanics themselves — owned by **ISSUE-024** (WRT). This issue *consumes* that path; it only adds the hard-conflict quarantine branch and its human resolution.
- The **merge (FR-2.MNT.005) and summarise (FR-2.MNT.007) lifecycle jobs** and the daily supersede safety-net (FR-2.MNT.006) — owned by **ISSUE-027** (MNT lifecycle). This issue only adds the Personal-tier *gate* those jobs call and the approval queue they feed.
- The generic **approval-tier / escalation / flagged-workflow engine + realtime approval queue (surface-04)** — owned by **ISSUE-056**; this slice reuses it for delivery/escalation of these two memory queues.
- The **Ingestion tab** of surface-03 (Filter-2 review) — owned by **ISSUE-026**.
- Alert *delivery* for overdue escalations (C7 seam) — owned by ISSUE-075.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-2.WRT.002 (component-02 Memory — hard-conflict quarantine branch only), FR-2.MNT.008 (conflict-resolution priority + inject-both-with-note), FR-2.MNT.014 (Personal-tier consolidation approval gate).
- **NFRs:** none named directly (guarded by the three non-negotiables #1/#2/#3 via the FR ACs).
- **Rests on:** ADR-004 (sole writer + CAS-supersede `WHERE superseded_by IS NULL` + per-entity validate-and-commit — resolutions route through the writer, never a direct insert), ADR-002 (Maturity context shown on candidate/conflict detail), OD-032 (unresolved-hard-conflict + inject-both-with-note behaviour — RESOLVED), OD-037 (Personal-consolidation skip-vs-approval-queue mechanism — RESOLVED), OD-115 (mints `PERM-memory.review_conflict` + `PERM-memory.approve_consolidation` into the C1 catalog via change-control), OD-113 (one tabbed surface-03). ⚠️ FEASIBILITY: AF-061 (validate-and-commit closes the same-entity TOCTOU window without livelock — a hard conflict surfaced at the commit re-check must land in this quarantine, not be lost).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-2.WRT.002.1 (soft-conflict supersede — the CAS-chain behaviour a Keep-new resolution reuses)
- AC-2.WRT.002.2 (hard conflict → held in quarantine, never silently applied)
- AC-2.WRT.002.3 (hard conflict un-actioned past `CFG-review_escalation_days` → escalated, neither auto-resolved nor silently held)
- AC-2.MNT.008.1 (priority-rule resolution — human_verified wins)
- AC-2.MNT.008.2 (genuinely ambiguous → both injected with a note + human flagged)
- AC-2.MNT.014.1 (Personal-tier memory not auto-consolidated)
- AC-2.MNT.014.2 (Personal-consolidation approval item un-actioned past `CFG-review_escalation_days` → escalated, never silently held)
- **Gating spikes (if any):** none launch-gating. Build-time AF-061 (validate-and-commit) must hold so that a hard conflict raised at the writer's commit-boundary re-check is routed to `memory_conflicts` (not swallowed) — verify per `test-strategy.md`.

## 5. Touches (complete blast radius, by ID)
- **DATA:** `memory_conflicts` (net-new — `new_memory`, `conflicting_memory_ids`, `suggested_resolution`, `state`, `escalated_at`, `resolved_by`, `resolved_at`), `consolidation_approvals` (net-new — `candidate_memory_ids`, `op`, `tier`, `state`, `escalated_at`, `resolved_by`, `resolved_at`), `memories` (read for side-by-side; Keep-new CAS-superseded via `superseded_by`; Keep-both note-link; all writes via the sole writer only), `entities` (read — Maturity / `[Building]` context), `access_audit` (append-only — Personal/Restricted view + Personal consolidation resolution logged). Enums: `mem_review_state` (pending/escalated/resolved), `consolidation_op` (merge/summarise).
- **PERM:** `PERM-memory.review_conflict` (Super Admin + Admin — Conflicts tab), `PERM-memory.approve_consolidation` (Super Admin + Personal clearance — Consolidation tab). Both minted under the Memory Access category via OD-115; default-deny.
- **CFG:** `CFG-review_escalation_days` (LIVE, default 7 — drives the un-actioned→escalated computation on both queues); `CFG-merge_similarity_threshold` (0.92, LIVE — read-only context: the similarity that produced a consolidation candidate).
- **UI:** `UI-INGESTION-QUEUE` (surface-03) — the **Conflicts** tab and the **Consolidation** tab only (the Ingestion tab is ISSUE-026).
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/01-requirements/component-02-memory.md` — FR-2.WRT.002, FR-2.MNT.008, FR-2.MNT.014 (statements + all ACs) and the WRT/MNT context manifest.
- `spec/04-data-model/schema.md` §3 Memory — the `memory_conflicts` + `consolidation_approvals` tables, the `mem_review_state` / `consolidation_op` enums (§Types), and the `memories.superseded_by` CAS chain; plus §Global rules (no `client_slug`, intra-client RLS) and the `access_audit` immutability sink.
- `spec/03-surfaces/surface-03-ingestion-queue.md` — the Conflicts + Consolidation tab specs (fields, actions, empty/error/partial states, access table, OD-113/OD-115).
- `spec/00-foundations/adr/ADR-004-*.md` — sole-writer + CAS-supersede + validate-and-commit (resolutions route through the writer).
- `spec/00-foundations/open-decisions.md` — OD-032, OD-037, OD-115 (the resolved decisions + OD-115's four-field node definitions).

## 7. Dependencies
- **Blocked-by:** ISSUE-024 (memory write / sole-writer path — the contradiction check this extends), ISSUE-056 (approval tiers + escalation/flagged workflow + surface-04 approval-queue infrastructure this reuses for delivery/escalation).
- **Blocks:** none (leaf).

## 8. Build order within the slice
1. **Migration** — ⚠️ **VERIFY-PRESENT, do NOT `create table`.** The `memory_conflicts` + `consolidation_approvals` tables **and** the `mem_review_state` (pending/escalated/resolved) / `consolidation_op` (merge/summarise) enums **already ship in the `0001` baseline** (`app/silo/migrations/0001_baseline.sql` — tables ~L278/L291, enums ~L36/L37; the standing convention, BUILD-SCHEDULE L182–191 — the baseline stands up all 44 tables). So this slice adds **no `create table`** — the `check` gate asserts them present (cf. ISSUE-022/024/026). The ONLY migration it may need is an **additive `event_type` value** for its escalation/quarantine observability *if* it emits one not already in the enum (an un-actioned-item escalation likely REUSES the baseline `approval_queue_stale`, as ISSUE-026 did — grep the enum first; author a new value only if none fits). **Next free silo tag is `0044`** (applied head `0043`, session 85); additive `event_type` migrations are `transactional:false` + `add value if not exists` + semicolon-free comments (the 0007/0011 non-txn-runner trap). No `client_slug` (ADR-001 §3).
2. **RLS + PERM** — enable RLS default-deny on both tables; mint `PERM-memory.review_conflict` (Conflicts, Super Admin + Admin) and `PERM-memory.approve_consolidation` (Consolidation, Super Admin + Personal clearance) into the C1 catalog per OD-115; add clearance-before-view on any Personal/Restricted-carrying row (FR-1.CLR.*).
3. **Priority rules (FR-2.MNT.008)** — implement the five-rule resolver that produces the `suggested_resolution`; encode rule-5 "keep both with a note" as the ambiguous outcome. Pure/testable; consumed by both the write-time hard-conflict branch (via ISSUE-024) and the daily supersede job (ISSUE-027).
4. **Hard-conflict quarantine branch (FR-2.WRT.002)** — on a hard conflict, insert a `memory_conflicts` row (new memory NOT in the live set, old untouched), attach the suggested resolution; wire the commit-boundary re-check (AF-061) so a hard conflict raised there also lands here, never swallowed.
5. **Personal-tier gate (FR-2.MNT.014)** — the gate the merge/summarise jobs (ISSUE-027) call: a Personal-tier candidate is skipped from auto-consolidation and inserted into `consolidation_approvals` (`op ∈ {merge, summarise}`, `tier=personal`).
6. **Resolution actions → sole writer** — Keep-new (CAS-supersede existing `WHERE superseded_by IS NULL`), Keep-existing (discard held write), Keep-both (retain both live + note-link; close record `state=resolved`); Approve/Reject consolidation. All mutations hand off to the Memory-Agent writer (ADR-004) — never a direct insert; a writer-side rejection surfaces, never vanishes (#3).
7. **Escalation** — server-owned `escalated_at` set when `now() - created_at > CFG-review_escalation_days`; reuse ISSUE-056's escalation/alert routing (C7 delivery seam) so an un-actioned item can never sit in silent indefinite hold.
8. **Surface wiring** — the surface-03 Conflicts tab (side-by-side new-vs-existing + suggested resolution + three actions; partial-load disables resolve actions) and Consolidation tab (proposed-vs-sources preview + Approve/Reject); per-tab PERM gating; overdue badge; empty/error states never read as "nothing to do".
9. **Audit** — Personal/Restricted view and Personal-consolidation resolution → `access_audit` (FR-1.AUD.001); every resolution/decision logged.
10. **Tests to the ACs** (§9).

## 9. Verification (how DoD is proven)
- **Unit:** the FR-2.MNT.008 five-rule resolver (each rule + rule-5 ambiguous → keep-both-with-note) — AC-2.MNT.008.1/.2.
- **Integration:** a hard conflict is held in `memory_conflicts` and the old memory is untouched (AC-2.WRT.002.2); Keep-new CAS-supersedes with the chain intact (AC-2.WRT.002.1); a Personal-tier candidate is skipped from auto-consolidation and queued (AC-2.MNT.014.1); resolutions/approvals route through the sole writer, not a direct insert (ADR-004).
- **Escalation:** an un-actioned conflict / consolidation item past `CFG-review_escalation_days` gets `escalated_at` set + is surfaced, never auto-resolved or silently held (AC-2.WRT.002.3 / AC-2.MNT.014.2).
- **Guardrail (AF-061):** a hard conflict raised at the writer's commit-boundary re-check lands in the quarantine (not swallowed) — the build-time AF-061 check per `spec/05-non-functional/test-strategy.md`.
- **Surface:** Conflicts/Consolidation error + partial states never render as an empty "nothing to do"; partial-load disables all resolve actions (#2). AC→`Verified` per `test-strategy.md`.
