---
id: ISSUE-029
title: Compliance erasure walk (memory-side transitive delete)
epic: C — memory
status: done
github: "#29"
---

> **✅ DONE (Session 87).** Built `app/memory-erasure/` (`@harness/memory-erasure`; port + InMemory fake +
> `supabase-store.ts` + `check` + **47/47** tests, tsc clean). The one sanctioned destructive path: gate (Super-Admin +
> `PERM-memory.delete` + erasure-specific confirm, fail-closed BEFORE any read) → target resolution → transitive walk
> (full `superseded_by` chain both directions + the OD-204 `derived_from` edge to merge/summary rows) → per-row
> classification (derived → delete; single-entity target → delete; multi-entity primary → retain+scrub AC-NFR-CMP.005.2;
> **other-subject rows reached via a shared consolidation-supersede → EXCLUDE + un-supersede live, never delete**) →
> the sole `delete from memories` primitive + embeddings → immutable `access_audit` tombstone → **raise** the
> NFR-DR.009 backup-purge flag (injected `BackupPurgePort` → app/backup-dr) + **trigger** the C7 log-sink redaction
> (injected `LogRedactionPort` → app/log-retention) → **verified-complete-or-fails-loud** per leg incl. an
> INDEPENDENT (non-delete-set-scoped) residue re-read (AC-2.MNT.017.5). **AF-137 GREEN** (residue-planting spike, 21
> assertions, 3 runs — full-clear · injected C7 failure · injected delete residue, composing the real C7 + backup-DR
> modules). **OD-204 RESOLVED** (migration 0045 `memories.derived_from` + 027 persists it). **Migrations 0045/0046
> applied LIVE**; R10 live smoke **16/16 PASS** (rolled back) incl. the over-erasure-safe consolidation scenario.
> Adversarial-verified by 3 independent zero-context lenses (1 BLOCKER + 2 MAJOR + MINOR/NITs, all fixed
> regression-test-first). **Unblocks ISSUE-082** (C10 two-person right-to-erasure). Evidence: SESSION-LOG Session 87;
> `results/af-137-completeness-spike.ts`; `results/live-smoke.ts`.

# ISSUE-029 — Compliance erasure walk (memory-side transitive delete)

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Build the C2 memory-side compliance-erasure mechanism — the one sanctioned destructive path — that, on a Super-Admin-gated request, transitively hard-deletes a target's Personal memory data across every derived layer (rows + full `superseded_by` chain + episodic evidence + embeddings + merged/summarised derived rows), writes an `access_audit` tombstone, raises the off-platform backup-purge flag, triggers the C7 log-sink redaction, and is verified-complete-or-fails-loud.

## 2. Scope — in / out
**In:** The transitive erasure *engine* invoked on `memories` — the memory-side machinery FR-2.MNT.017 owns:
- Target resolution (an individual / entity) → the set of that target's Personal memory rows, and the **true hard-delete** (not a supersede) of those rows + their episodic evidence + their embeddings, with an immutable `access_audit` tombstone (who / when / why / what-scope) per delete run.
- The **transitive walk**: follow the full `superseded_by` chain (older superseded rows deleted too, not just the live head), and use provenance refs to reach **summary rows derived from an erased episodic cluster** (FR-2.MNT.007) and **merge-collapsed rows that folded a Personal input** (FR-2.MNT.005) — deleting or **re-deriving each without the erased content**, so Personal data cannot survive re-tagged as Standard/Confidential in a derived row (AC-2.MNT.017.3).
- **Raising** the off-platform backup-purge flag on completion (AC-2.MNT.017.2) — this slice raises it; NFR-DR.009 (Phase 5 / ISSUE-085) receives + processes it.
- **Triggering** the C7 redaction-tombstone across `event_log` / `guardrail_log` (AC-2.MNT.017.4) — this slice fires the trigger; C7 owns the log-side mechanism.
- The **verified-complete-or-fails-loud** contract across all legs (AC-2.MNT.017.5): a per-leg status, a partial completion recorded + escalated, never reported done — this is the return contract the C10 caller (ISSUE-082) verifies before writing its "done" audit.
- Gating this destructive path on `PERM-memory.delete` + the erasure-specific Super-Admin gate (distinct from retire/supersede).

**Out:**
- The **C10 individual right-to-erasure workflow** — request intake, two-class identification (deterministic `entity_id` vs human-confirmed fuzzy name-in-content), two-person authorisation, and the verify-before-"done" audit record — owned by **ISSUE-082** (C10 DEL; this slice is its C2 mechanism, invoked by FR-10.DEL.003). This slice does **not** decide *which* records to erase from a fuzzy match; it erases the resolved target set it is handed.
- The **C7 log-sink redaction mechanism** itself (the in-place PII scrub + tamper-evident tombstone on `event_log` / `guardrail_log` / `config_audit_log`) — owned by C7 (NFR-CMP.007 / AC-7.LOG.006.3 / AC-7.LOG.007.4). This slice only *triggers* it.
- The **off-platform backup purge/expiry mechanics** — owned by Phase 5 backup/DR (NFR-DR.009, ISSUE-085 / ADR-008). This slice only *raises* the flag.
- **Client offboarding** hard-delete (FR-10.OFF.*, ISSUE-083) and **retention/residency** posture (ISSUE-084) — separate destructive paths.
- Decay / supersede / merge / expiry lifecycle (the *non*-destructive maintenance) — owned by ISSUE-027; this slice is the deliberate exception to "decay never deletes" (FR-2.MNT.002).

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-2.MNT.017 (component-02-memory)
- **NFRs:** NFR-CMP.005 (individual right-to-erasure — two-class ID, transitive delete, verify-before-done; this slice implements the C2 transitive-delete leg), NFR-CMP.007 (redaction-tombstone on erasure — this slice is the C2 caller that triggers the C7 log-sink tombstone), NFR-DR.009 (off-platform backup-purge flag — this slice raises it)
- **Rests on:** ADR-008 (backup posture — the off-platform purge flag), AF-137 (transitive-erasure completeness verification — the gating build-time SPIKE for AC-2.MNT.017.5)

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-2.MNT.017.1, AC-2.MNT.017.2, AC-2.MNT.017.3, AC-2.MNT.017.4, AC-2.MNT.017.5
- AC-NFR-CMP.005.2 (entity-id removal → single-entity memory cascades to hard-delete via C2; multi-entity retained + passed to scrubbing — the C2-side behaviour)
- AC-NFR-CMP.007.1 (matching `event_log` / `guardrail_log` rows have PII scrubbed on the erasure this slice triggers)
- AC-NFR-DR.009.1 (the off-platform purge flag this slice raises is received + actioned)
- **Gating spikes (if any):** **AF-137** (transitive-erasure completeness verification, SPIKE, build-time) must be GREEN before this issue ships — it plants residue in every leg (incl. a merged row + a log sink) and asserts every leg cleared + an injected partial failure is caught. This is *not* one of the six OD-157 launch-gating spikes (ISSUE-001–006); it is a build-time AF attached here per `test-strategy.md`, and it gates the #1/#2 no-residue claim (AC-2.MNT.017.5). Tracked in `feasibility-register.md`.

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-memories (transitive hard delete: the resolved rows + the full `superseded_by` chain + derived summary/merge rows + embeddings — schema §3 Memory), DATA-access_audit (immutable erasure tombstone — schema §2), plus **raises** the off-platform backup-purge flag (processed by NFR-DR.009, Phase 5) and **triggers** the C7 log-sink redaction on `event_log` / `guardrail_log` (schema §8, owned by C7). No new tables created here.
- **PERM:** PERM-memory.delete (homed in C1 `PERMISSION_NODES.md`, Compliance / Memory-Access category; consumed here) + the erasure-specific Super-Admin gate.
- **CFG:** backup retention window (Phase 5 / ADR-008 — read, not owned here).
- **UI:** none (the compliance-erasure action + log surface is Phase 3 / Phase 5, driven by the C10 workflow ISSUE-082).
- **Connectors:** none (SoR-side deletion notify is the C10 `connector_deletion_flags` path, ISSUE-082 — not this slice).

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-02-memory.md — FR-2.MNT.017 (statement, behaviour branches, ACs) + the MNT.005/MNT.007 provenance refs the walk relies on; the component Context Manifest table
- spec/04-data-model/schema.md §3 Memory — the `memories` DDL (`superseded_by` CAS chain, `embedding`/`embedding_v2`, `entity_ids`) the delete walks; §2 RBAC & Access — the `access_audit` tombstone shape + append-only immutability trigger; §8 Observability — the `event_log`/`guardrail_log` sinks + their `redacted_at` column the C7 tombstone uses
- spec/05-non-functional/compliance.md §NFR-CMP.005 (transitive delete / verify-before-done) + §NFR-CMP.007 (redaction-tombstone) — the posture + ACs this slice's C2 legs satisfy
- spec/05-non-functional/backup-dr.md §NFR-DR.009 — the off-platform backup-purge-flag contract this slice raises into
- spec/00-foundations/adr/ADR-008-backup-dr.md — the backup posture the purge flag rides
- spec/00-foundations/feasibility-register.md — AF-137 (the gating build-time SPIKE)

## 7. Dependencies
- **Blocked-by:** ISSUE-024 (Memory write / sole-writer path — erasure runs through the C2 sole-writer path and depends on the provenance refs the write/merge/supersede flow populates: the `superseded_by` chain, merge-collapsed rows FR-2.MNT.005, summary provenance FR-2.MNT.007). Not a spike.
  - **✅ RESOLVED (OD-204, Session 87):** the merge/summary `derived_from` provenance edge is now persisted queryably — migration **0045** adds `memories.derived_from uuid[]` (+ GIN index) and ISSUE-027's `insertDerivedMemory` writes it on every derived path (the InMemory fake already tracked it; offline/live parity holds). The transitive walk queries `derived_from && ARRAY[<erased ids>]`. Proven live (R10 [2b]/[3]). **See [[OD-204]] (🟢 resolved).**
- **Blocks:** ISSUE-082 (C10 individual right-to-erasure workflow — two-person auth, verify-before-done — which *calls* this C2 mechanism via FR-10.DEL.003 and verifies its completeness return via AC-10.DEL.003.4).

## 8. Build order within the slice
1. **Erasure gate** — wire `PERM-memory.delete` (C1) + the destructive-erasure-specific Super-Admin gate as the entry precondition; reject anything below it. This is destructive-by-design, so the gate is stricter than retire/supersede (FR-2.MNT.017 preconditions).
2. **Target resolution → primary set** — resolve the erasure target (individual / entity) to its set of Personal `memories` rows.
3. **Transitive walk (the core)** — from each primary row, expand the erasure set: (a) walk the full `superseded_by` chain to the head and to every older superseded row; (b) via provenance refs, reach summary rows derived from an erased episodic cluster (FR-2.MNT.007) and merge-collapsed rows that folded a Personal input (FR-2.MNT.005). For each derived row, decide **delete vs re-derive-without-the-erased-content** (single-entity → hard-delete; multi-entity/mixed → re-derive/scrub so no residue survives re-tagged — AC-2.MNT.017.3, AC-NFR-CMP.005.2).
4. **Hard delete + evidence + embeddings** — execute the true delete (not supersede) of the resolved set including episodic evidence layer + embeddings; do it through the C2 sole-writer path (ISSUE-024) so the invariant holds even for this destructive op.
5. **Tombstone** — write the immutable `access_audit` tombstone (who / when / why / what-scope) per run (schema §2 append-only trigger enforces immutability).
6. **Fan-out legs** — raise the off-platform backup-purge flag (→ NFR-DR.009); trigger the C7 log-sink redaction-tombstone on `event_log`/`guardrail_log` (→ AC-7.LOG.006.3 / AC-7.LOG.007.4).
7. **Verified-complete-or-fails-loud** — track a **per-leg status** across every store (rows + chain + derived rows + evidence + embeddings + tombstone + C7 log redaction + backup-purge flag); on any mid-way leg failure, record + escalate the partial state and return **not-done** — never report done. This is the completeness return the C10 caller (ISSUE-082) verifies (AC-2.MNT.017.5 / AC-10.DEL.003.4).
8. **Tests to the AC** — see Verification; wire the AF-137 residue-planting spike harness.

## 9. Verification (how DoD is proven)
- **Build-time SPIKE — AF-137** (per `spec/05-non-functional/test-strategy.md`): erase a seeded target with residue planted in *every* leg — a live row, an older superseded-chain row, a merge-collapsed row, a summary derived from an erased episodic cluster, embeddings, a log-sink row, and a pre-erasure off-platform snapshot — then assert every leg is cleared **and** that an injected partial failure is detected + escalated (not reported done). This is the `Verified` path for AC-2.MNT.017.5 / AC-NFR-CMP.005.3; a paper-only pass is not sufficient. Must be GREEN before ship.
- **Integration/DB tests:** the transitive walk hard-deletes the full `superseded_by` chain + evidence + embeddings (AC-2.MNT.017.1); derived summary/merge rows are deleted or re-derived with no residue and no Personal-data survival under a re-tag (AC-2.MNT.017.3, AC-NFR-CMP.005.2); the `access_audit` tombstone is written and is immutable (schema §2 trigger).
- **Fan-out tests:** the off-platform backup-purge flag is raised and received (AC-2.MNT.017.2 → AC-NFR-DR.009.1); the C7 redaction-tombstone fires and matching `event_log`/`guardrail_log` PII is scrubbed while rows + audit metadata remain (AC-2.MNT.017.4 → AC-NFR-CMP.007.1).
- **Gate posture:** this is the one sanctioned destructive path (#2 legal obligation) — the AC→`Verified` path is not closed until AF-137 proves completeness across all legs and the fail-loud-on-partial behaviour holds.
