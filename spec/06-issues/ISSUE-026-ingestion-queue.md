---
id: ISSUE-026
title: Ingestion filters + human review queue
epic: C — memory
status: done
github: "#26"
---

> **✅ DONE (Session 85, 2026-07-10).** `app/ingestion/` — **59/59 · check green · R10 batch smoke PASS** (migration `0041` LIVE, head `0043`). Two filters + human queue (log-every-decision, no silent exit) + three pipelines + the **no-backdoor invariant in code** (store exposes no memory-insert; the sole-writer gate refuses any un-gated route). Adversarial-verify: **1 BLOCKER + 2 MAJOR** fixed regression-test-first (Include/ingest marked items done on a non-committed write → lost #1/#3 → terminal only on commit, else held-for-retry + loud). Carries AF-043 (Filter-1 trust-window) + LIVE Haiku classifiers at deploy. GitHub #26 CLOSED.

# ISSUE-026 — Ingestion filters + human review queue

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Build the two ingestion filters (Filter 1 relevance / Filter 2 sensitivity), the human ingestion review queue (Include/Exclude/Defer with escalation), the three ingestion pipelines, the ordered initialisation sequence, and the no-backdoor invariant — the human gate between candidate knowledge and the memory write path.

## 2. Scope — in / out
**In:** The complete C2 **ING** area (FR-2.ING.001–010): Filter 1 (relevance / selective-writing Haiku gate, incl. shadow-retain trust window + post-graduation sampled audit), Filter 2 (sensitivity classify → flag), the `ingestion_queue` and its Include/Exclude/Defer decisions (every decision logged; Deferred resurface + un-actioned escalation), the "no sensitive content without an explicit human Include" invariant, the HR-content-off-by-default gate, the three pipelines (structured / document / interview), the ordered initialisation sequence with the mandatory verification pass, and the "ingestion is not a backdoor" rule. Renders the **surface-03 Ingestion tab** (`UI-INGESTION-QUEUE`) including the trust-window auto-drop audit toggle view.

**Out:**
- The actual memory-writer, contradiction check, and validate-and-commit an Include routes into — owned by **ISSUE-024** (C2 WRT). This slice *hands the approved item to the writer*; it never inserts into `memories` directly.
- The connectors / OAuth / rate-limit / triggers the three pipelines consume for source reads — owned by **ISSUE-032** (C3 CONN/REG) and the connector instances (ISSUE-039/040/041). This slice consumes verified, extracted content at the seam.
- The **Conflicts** and **Consolidation** tabs of surface-03 — owned by **ISSUE-028** (C2 MNT conflict/consol). This slice builds only the Ingestion tab of that shared surface.
- Retrieval-time clearance/visibility enforcement — owned by **ISSUE-025** (C2 RET). This slice only *tags/flags* sensitivity at ingest.
- The C1 permission-node catalog + `can()` gate — owned by ISSUE-018; this slice *consumes* `PERM-ingestion.review` / `PERM-ingestion.initiate` / `PERM-ingestion.interview`.
- The C7 escalation-alert delivery — owned by ISSUE-075; this slice populates the overdue/escalation state that C7 delivers (seam).

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-2.ING.001, FR-2.ING.002, FR-2.ING.003, FR-2.ING.004, FR-2.ING.005, FR-2.ING.006, FR-2.ING.007, FR-2.ING.008, FR-2.ING.009, FR-2.ING.010 (all C2 — Memory).
- **NFRs:** NFR-CMP.010 (HR content disabled by default, legal-review-gated).
- **Rests on:** ADR-003 (write-path routing + cost — Filter 1 = the single self-funding Haiku selective-writing gate; Filter 2 = the Haiku sensitivity classify), ADR-004 (sole-writer invariant — the backdoor rule + Include-routes-to-writer), ADR-008 / golden rule (pipelines point, don't copy). Surface decisions OD-113/OD-114/OD-116 (surface-03) and OD-036 (trust-window mechanics), OD-115 (mints the sibling review nodes — informational, not this tab's gate).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-2.ING.001.1, AC-2.ING.001.2, AC-2.ING.001.3 (Filter 1: drop-with-no-Sonnet; trust-window shadow retain; post-graduation ≥5%/min-20-weekly sampled audit)
- AC-2.ING.002.1 (Filter 2 holds sensitive for human decision)
- AC-2.ING.003.1, AC-2.ING.003.2, AC-2.ING.003.3 (Exclude logged who/when/why; queue exit only via logged decision; un-actioned → escalated)
- AC-2.ING.004.1 (no write without an explicit human Include)
- AC-2.ING.005.1, AC-2.ING.005.2 (HR default-Exclude; HR-role clearance governs when flag on)
- AC-2.ING.006.1 (Pipeline 1: entities with external_refs, no wholesale copy)
- AC-2.ING.007.1 (Pipeline 2: chunk at configured size, both filters, stored via writer)
- AC-2.ING.008.1 (Pipeline 3: interview memories surfaced for verification before confidence 1.0)
- AC-2.ING.009.1, AC-2.ING.009.2 (init-sequence incomplete-verification warning; verified → confidence 1.0 / human_verified)
- AC-2.ING.010.1 (every pipeline write passed relevance + sensitivity + contradiction gates + sole writer)
- AC-NFR-CMP.010.1, AC-NFR-CMP.010.2 (HR off at boot; enablement is legal-review output, not an engineering default)
- **Gating spikes (if any):** none launch-gating. Build-time **⚠️ AF-043** (the Filter-1 Haiku selective-writing gate pays for its own cost **and** is accurate enough to trust) must reach GREEN via the OD-036 3-week shadow-retain trust window before Filter 1 graduates from shadow-retain to live-discard — until then Filter 1 retains would-drops (AC-2.ING.001.2). Also relies on AF-031 (writer type/confidence quality, proven in ISSUE-024) upstream of the Filter-2→writer handoff.

## 5. Touches (complete blast radius, by ID)
- **DATA:** `ingestion_queue` (incl. `state` ∈ {pending, deferred, included, excluded, shadow_dropped}, `flag_reason`, `suggested_tier`, `target_entity_id`, `deferred_until`, `reviewed_by`, `reviewed_at`, `decision_reason`), `entities` (Pipeline 1 creates with `external_refs`; init-sequence Internal Org singleton), `memories` (written **only** via the sole writer at Include / pipeline store — not directly), `access_audit` (Include/Exclude/Defer + Personal/Restricted views — append-only).
- **PERM:** `PERM-ingestion.review` (queue Include/Exclude/Defer — Admin/Super Admin), `PERM-ingestion.initiate` (Pipelines 1 & 2), `PERM-ingestion.interview` (Pipeline 3). All consumed from C1; sensitive items further gated by C1 sensitivity clearance (FR-1.CLR.*).
- **CFG:** `hr_content_enabled` (BOOT, default false — legal-gate), `ingest_defer_resurface_days` (LIVE, default 14), `review_escalation_days` (LIVE, default 7), `chunk_size_tokens` (LIVE, default 300), `rate_limit_memory_writes_per_minute` (LIVE, default 30 — the write-rate an Include is subject to), Filter-1 trust-window + post-graduation sample-rate/cadence keys (Phase 2).
- **UI:** `UI-INGESTION-QUEUE` (surface-03 Ingestion tab, incl. the trust-window auto-drop audit toggle view); onboarding/init-sequence dashboard + interview-verification UI (surface-03 seam / Phase-3 onboarding surface).
- **Connectors:** none directly — pipelines consume connector reads at the C3 seam (GHL / Google / Slack via ISSUE-032/039/040/041); no connector code in this slice.

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/01-requirements/component-02-memory.md` — the ING FR text + ACs (FR-2.ING.001–010) and the doc-reconciliation notes tying Filter 1/2 to ADR-003.
- `spec/04-data-model/schema.md` §3 Memory — `ingestion_queue`, `entities`, `memories` (the Include/pipeline write target, sole-writer only).
- `spec/03-surfaces/surface-03-ingestion-queue.md` — the Ingestion-tab UI states, data bindings, actions, and the trust-window audit toggle (build only this tab; Conflicts/Consolidation are ISSUE-028).
- `spec/05-non-functional/compliance.md` §NFR-CMP.010 — HR-content-off-by-default posture + its ACs.
- `spec/00-foundations/adr/ADR-003-*.md` — write-path routing/cost (Filter 1 = the one self-funding Haiku gate; Filter 2 = Haiku sensitivity classify; the shadow-retain trust window).
- `spec/00-foundations/adr/ADR-004-*.md` — sole-writer invariant (the no-backdoor rule; Include routes to the writer, never a direct insert).

## 7. Dependencies
- **Blocked-by:** ISSUE-024 (C2 write / sole-writer path — an Include and every pipeline store route into it; not a spike), ISSUE-032 (connector contract + shared runtime — the three pipelines consume connector reads at the seam; not a spike).
- **Blocks:** none (leaf).

## 8. Build order within the slice
1. **Schema** — confirm/land `ingestion_queue` (state machine + escalation columns) and the `entities.external_refs` / `entities.is_internal_org` shape from `schema.md` §3 Memory (the migration harness is ISSUE-008; this issue owns the ING-specific columns).
2. **Filter 1 (relevance / selective-writing Haiku gate)** — the cheap gate that drops non-save-worthy events before any Sonnet cost; build both modes behind the trust-window flag: **shadow-retain** (would-drops written + tagged `state=shadow_dropped` for audit) and, post-graduation (AF-043 GREEN), **live-discard** with the ≥5%/min-20-weekly sampled audit into the Haiku-decision review queue.
3. **Filter 2 (sensitivity classify)** — Haiku classify → clean content proceeds to the writer with an auto-assigned tier (FR-2.TAG.002 seam in ISSUE-022); flagged content lands in `ingestion_queue` with `flag_reason` + `suggested_tier`, never auto-written.
4. **Ingestion queue logic** — Include (confirm/override tier → hand to the sole writer, FR-2.ING.010) / Exclude (discard + logged reason) / Defer (`deferred_until = now + ingest_defer_resurface_days`, auto-resurface); the "queue exit only via a logged decision" invariant; HR default-Exclude gated by `hr_content_enabled`.
5. **Escalation** — the un-actioned-past-`review_escalation_days` computation is **server-owned** by the C2 maintenance loop (populates `escalated_at`, seam to ISSUE-027/C7 for delivery); this slice renders the overdue styling + tab badge from `created_at` vs cadence and `escalated_at`.
6. **Pipelines** — Pipeline 1 (structured: connect → extract → create entities with `external_refs` → summarise → human sample-validate → report, points-not-copies), Pipeline 2 (documents: collect → chunk at `chunk_size_tokens` → Filter 2 → human-confirm → writer → verification pass → report), Pipeline 3 (three interview sessions → writer → interviewee verification → gap detection). All route through the standard write flow (no-backdoor, FR-2.ING.010).
7. **Initialisation sequence** — enforce the seven-step order + the mandatory verification pass (bumps verified memories to confidence 1.0 / `human_verified`), with the persistent incomplete-verification dashboard warning.
8. **Surface wiring** — surface-03 Ingestion tab: rows/detail, Include/Exclude/Defer actions, trust-window audit toggle, all the required states (Loading / Empty / Error / Partial / Offline — never render an empty queue on a fetch failure, disable Include when sensitivity context didn't load, disable Defer when the resurface cadence is unknown).
9. **Guardrail/observability hooks** — every Include/Exclude/Defer + every Personal/Restricted view → `access_audit`; Filter-1/2 decisions → the Haiku decision log / `event_log`; the sampled-audit run logged so a missed/empty run is never silent.
10. **Tests to the ACs** — cover each AC in §4, especially the never-silent paths (empty-on-error, un-actioned escalation, no-Include-no-write, HR default-Exclude).

## 9. Verification (how DoD is proven)
- Test layers per `spec/05-non-functional/test-strategy.md`: unit (Filter 1/2 decisions, tier assignment, queue state transitions), integration (Include → sole-writer handoff without direct insert; Defer resurface; escalation population; pipeline end-to-end through the write flow), and surface/UI-state tests (empty-vs-error distinction, disabled-action guards).
- **AF-043** is proven not by a unit test but by the OD-036 3-week shadow-retain trust window (Haiku decision log + manual operator review of would-drops); Filter 1 may not graduate to live-discard until AF-043 reaches GREEN — the shadow-retain path (AC-2.ING.001.2) is the launch behaviour until then.
- **NFR-CMP.010** posture (`hr_content_enabled=false` at boot; no HR content enters memory by default; enablement is the FR-10.LEG.001 legal-review output) verified by DOCS (config default) + build-time test — the AC→`Verified` path for AC-NFR-CMP.010.1/.2.
- No-silent-failure guarantees (queue exit only via logged decision; un-actioned escalation; empty-queue-never-on-error) verified as explicit negative tests — these are the #1/#2/#3 invariants this slice exists to uphold.
