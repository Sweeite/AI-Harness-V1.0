# Surface: UI-INGESTION-QUEUE (surface-03) — Memory Review Queues

**Status:** 🟢 **Signed off 2026-06-30** (operator-authorized — "mint dedicated nodes" + "take all three recs" + sign-off). Verification gate CLEAN on all 6 checks (a–f) — 0 HIGH, 5 MED + 1 LOW reconciled (Admin-clearance note already present; +keep-both quarantine-close, +consolidation-reject audit, +Defer-disabled-when-cadence-unknown, +`escalated_at` server-owned mechanism, +HR-gate-is-config-not-role). **4 of 14 Phase-3 surfaces complete.**

> Consolidates the **human-gated review queues that guard the memory write path** into one tabbed
> **"Memory Review"** surface. Three sections, each its own queue:
> **Ingestion** (`UI-INGESTION-QUEUE` — sensitivity-flagged content awaiting Include/Exclude/Defer) ·
> **Conflicts** (the hard-conflict quarantine, FR-2.WRT.002 / OD-032) ·
> **Consolidation** (the Personal-tier merge/summarise approval gate, FR-2.MNT.014 / OD-037).
> This surface is the operator-facing embodiment of the three non-negotiables for memory: **nothing
> sensitive is written without an explicit human decision (#2), nothing is silently dropped or held
> forever (#3), and held/deferred knowledge is never lost (#1).** It is **review**, not ingestion-pipeline
> operation — the three pipelines (structured / document / interview) and the automated maintenance jobs
> live elsewhere and only *feed* these queues (seams below).

---

## Context manifest

- **Surface ID(s):** `UI-INGESTION-QUEUE` (Ingestion tab); the **hard-conflict review queue** named by FR-2.WRT.002 (Conflicts tab); the **Personal-consolidation approval queue** named by FR-2.MNT.014 / OD-037 (Consolidation tab). The trust-window auto-drop audit (FR-2.ING.001 / OD-036) renders as a secondary view inside the Ingestion tab (OD-114).
- **Owned by:** **C2 (Memory)** — the rendering target for the ING review area + the WRT/MNT human-gated queues. Upstream producers are seamed in: **C3** connector triggers feed the ingestion pipelines; the **C2** maintenance jobs feed conflicts/consolidation/stuck-item escalation.
- **FRs served:**
  - **Ingestion tab (`UI-INGESTION-QUEUE`)** — FR-2.ING.002 (Filter 2 sensitivity flagging — what lands in the queue), FR-2.ING.003 (the queue: Include / Exclude / Defer, every decision logged; defer-resurface + un-actioned escalation), FR-2.ING.004 (no sensitive content written without an explicit human Include), FR-2.ING.005 (HR content Exclude-by-default unless `hr_content_enabled`); **+** FR-2.ING.001 / OD-036 (trust-window shadow-drop audit — what Filter 1 is auto-discarding), FR-2.ING.010 (Include routes through the standard write flow — *not* a direct insert).
  - **Conflicts tab** — FR-2.WRT.002 (no/soft/hard conflict; **hard → quarantine for human review, never silently applied**; un-actioned → escalated — AC-2.WRT.002.2/.3), informed by FR-2.MNT.008 (conflict-resolution priority rules — the *suggested* resolution), FR-2.MNT.006 (the daily supersede safety-net is what *adds* late-caught conflicts to this queue — seam-in).
  - **Consolidation tab** — FR-2.MNT.014 (Personal-tier memories never auto-consolidated without explicit human approval; un-actioned escalation — AC-2.MNT.014.2), gating FR-2.MNT.005 (weekly merge) + FR-2.MNT.007 (weekly episodic→semantic summarise) for Personal-tier candidates only (per OD-037).
  - **Cross-cutting:** every Include/Exclude/Defer, every conflict resolution, every consolidation approval is **audited** (FR-2.MNT.015 logs the job runs; FR-1.AUD.001/002 logs the human access + mutation). Viewing a flagged-Personal/Restricted item is itself an audited access (FR-1.AUD.001).
- **CFG dependencies** (read-only here — all edited on `surface-01`; description text binds DRY to `config-registry.md`'s `What it does` column, never re-typed):
  - `review_escalation_days` (default **7**, **LIVE** — `surface-01` `#guardrails`) — drives the un-actioned→escalated computation on **all three** queues (FR-2.ING.003 / FR-2.WRT.002.3 / FR-2.MNT.014.2).
  - `ingest_defer_resurface_days` (default **14**, **LIVE** — `#guardrails`) — a Deferred ingestion item auto-resurfaces after this cadence.
  - `hr_content_enabled` (default **false**, **BOOT** — `#guardrails`, legal-review gate) — when off, the default reviewer decision for HR-flagged items is **Exclude** (FR-2.ING.005); shown read-only as the active policy.
  - `chunk_size_tokens` (300, LIVE), `merge_similarity_threshold` (0.92, LIVE), `rate_limit_memory_writes_per_minute` (30, LIVE) — referenced as context (a queued document item's chunk size; the similarity that produced a consolidation candidate; the write-rate an Include is subject to) — **not edited here**.
- **PERM gates:**
  - **Ingestion tab review:** `PERM-ingestion.review` (Admin + Super Admin — FR-2.ING.003).
  - **Conflicts tab review:** `PERM-memory.review_conflict` (Super Admin + Admin) — **new node minted under the Memory Access category via OD-115** (C2's FRs named none; FR-2.WRT.002 said only "writer"). Default-deny.
  - **Consolidation tab review:** `PERM-memory.approve_consolidation` (Super Admin) **+ Personal clearance** — **new node minted under the Memory Access category via OD-115** (FR-2.MNT.014 said only "cleared role + `PERM-memory.*`"). Default-deny.
  - **Clearance-before-view (#2):** a queued item carrying **Personal / Restricted** content is only viewable by a reviewer holding the matching C1 sensitivity clearance (FR-1.CLR.*); the **Consolidation tab is Personal-tier by definition**, so it requires Personal clearance. Viewing such an item is an audited access (FR-1.AUD.001).
  - All nodes default-deny (FR-1.PERM.002); per-action gates inline below.
- **DATA bindings** (all Phase-4 stubs; C2-owned, **no `client_slug`** per ADR-001 §3 / OD-096):
  `ingestion_queue` (`id`, `content`, `source_ref`, `flag_reason`, `suggested_tier`, `target_entity_id`, `state` ∈ {pending, deferred, included, excluded}, `deferred_until`, `created_at`, `reviewed_by`, `reviewed_at`, `decision_reason`), the trust-window **shadow-drop** records (FR-2.ING.001 — a tagged subset, modelled as `ingestion_queue` rows with `state=shadow_dropped` or a sibling store — Phase 4 call), the **hard-conflict quarantine** store (FR-2.WRT.002 — `new_memory`, `conflicting_memory_ids`, `suggested_resolution`, `state`, `escalated_at`), the **consolidation-approval** store (FR-2.MNT.014 — `candidate_memory_ids`, `op` ∈ {merge, summarise}, `tier=Personal`, `state`, `escalated_at`). Read-only context: `memories`, `entities` (target entity + its Maturity / `[Building]` flag), `access_audit` (append-only).
- **ADR constraints:**
  - **ADR-003** (selective-writing + sensitivity-classify) — the **Haiku Filter 1 + Filter 2 gates produce this surface's contents**: Filter 1's would-drops populate the trust-window audit; Filter 2's sensitivity flags populate the Ingestion queue with a `flag_reason` + `suggested_tier`. The surface **renders** those classifier outputs (DRY — flag reason/suggested tier bind to the queue row, not re-derived).
  - **ADR-004** (sole writer + per-entity validate-and-commit) — an **Include / conflict-resolution / consolidation-approval does NOT write directly**. It hands the approved item to the **sole Memory-Agent writer** (FR-2.ING.010), which still runs the contradiction check, serialises same-entity writes via advisory lock, and respects `rate_limit_memory_writes_per_minute`. The surface must never imply "Include = instant insert" — it implies "Include = queued for the writer," and a write that the writer then rejects/holds (e.g. a fresh hard conflict) must surface, not vanish (#3).
  - **ADR-002** (Maturity / `[Building]`) — a queued item often targets a thin entity; the row shows the **target entity's `[Building]` flag** (per-entity Maturity < 50%) so the reviewer has context that this entity is still sparse.
  - **ADR-001 §3** — physical isolation; **no `client_slug`** on any table here.

---

## Overview

surface-03 is the operator's **memory gate** — the one place a human stands between *candidate* knowledge and the
durable memory store. It serves **Admins and Super Admins** (the Ingestion queue) and **clearance-holding reviewers**
(the Conflicts and Personal-Consolidation queues). It is a single tabbed surface with three queues:
**Ingestion · Conflicts · Consolidation**. Each queue exists because the system, by design, **refuses to act on
its own** in a sensitive case: sensitive content is held until a human decides (Filter 2, #2); a hard contradiction
is quarantined rather than guessed at (#2/#1); Personal data is never auto-folded into a broader memory (#2). The
surface's defining job is making those held items **loud and finite** — every queue shows a count, every un-actioned
item escalates past `review_escalation_days`, and **no state — loading, empty, error — is ever allowed to read as
"nothing to review" when it isn't** (#3). This surface is **review only**; it neither runs the ingestion pipelines
nor the maintenance jobs (those are seams).

---

## Access

> Uses the six canonical C1 roles (FR-1.ROLE.001). "Can enter?" is per-**tab**; the surface appears if the caller
> holds any one queue's review node. Custom roles are data-defined; the six defaults are the baseline.

| Role | Can enter? | Notes |
|---|---|---|
| Super Admin | Yes — all three tabs | Holds `PERM-ingestion.review` + `PERM-memory.review_conflict` + `PERM-memory.approve_consolidation` + all sensitivity clearances incl. Personal/Restricted |
| Admin | Yes — Ingestion + Conflicts | Holds `PERM-ingestion.review` + `PERM-memory.review_conflict`; sees Personal/Restricted-flagged items only with the matching clearance; **Consolidation tab hidden** (needs `PERM-memory.approve_consolidation`, Super-Admin-only by default + Personal clearance) |
| Finance | Only if granted | No review node by default → nav item hidden; a deployment may grant `PERM-ingestion.review` to a Finance reviewer for finance-flagged items (then finance-tier clearance governs what they see) |
| HR | Only if granted | No review node by default → hidden. HR-flagged items are **Exclude-by-default** — the gate is the `hr_content_enabled` **BOOT config flag** (default off), not the HR role; an HR reviewer is meaningful only once that flag is legally enabled on `surface-01` (FR-2.ING.005) |
| Account Manager | No | No review node by default → nav item hidden |
| Standard User | No | No review node by default → nav item hidden |

**Entry gate:** the surface renders iff the caller holds ≥1 queue-review node. A caller without any never sees the
"Memory Review" nav item; a direct URL returns 404 (FR-1.PERM.006 — denied surfaces are absent, not visible-but-empty).
Each tab is independently gated; a reviewer sees only the queues whose node (and, for sensitive items, whose
clearance) they hold.

---

## Layout

A standard in-app surface inside the authenticated shell — sidebar item **"Memory Review"**, a sticky page header
carrying the tab bar with a **per-tab pending/overdue count badge**, and a content pane per tab:

- **Tabs:** Ingestion · Conflicts · Consolidation (hidden per the Access table). Each tab badge shows the pending
  count, with overdue items (past `review_escalation_days`) called out in an alert colour.
- **Ingestion tab** — a list/table of flagged items awaiting decision, with a per-item **Include / Exclude / Defer**
  action set and a detail panel (content preview, flag reason, suggested tier, source/provenance, target entity).
  A view toggle exposes the **trust-window auto-drop audit** (OD-114).
- **Conflicts tab** — a list of quarantined hard-conflict writes; each opens a **side-by-side** view (new memory vs
  the conflicting existing memory/memories) with the priority-rule **suggested resolution** and Keep-new / Keep-existing /
  Keep-both-with-note actions.
- **Consolidation tab** — a list of Personal-tier merge/summarise candidates; each opens a preview of the proposed
  consolidated memory vs its sources, with Approve / Reject (Keep-separate) actions.

Every resolving action uses a confirm step; a **reason** field is captured to `access_audit` (mandatory where the
underlying FR requires it — see each section).

---

## Sections

---

### UI-INGESTION-QUEUE — Ingestion

**Purpose:** Hold every Filter-2-flagged candidate memory until a human decides Include / Exclude / Defer, so no
sensitive content is ever written without an explicit human approval (FR-2.ING.003/004). Admin + Super Admin
(sensitive items further gated by clearance).

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| Queue rows | `ingestion_queue.{id,content,flag_reason,suggested_tier,source_ref,target_entity_id,state,deferred_until,created_at}` where `state=pending` (+ `deferred` resurfaced) | One row per flagged item; sorted oldest-first so the nearest-to-escalation surfaces |
| Flag reason | `ingestion_queue.flag_reason` (Filter 2 output, ADR-003) | Why it was held: PII / financial / legal / HR / founder-private / source-marked-confidential — binds to the classifier output, not re-typed |
| Suggested tier | `ingestion_queue.suggested_tier` (Filter 2 output) | Confidential / Personal / Restricted suggestion; the reviewer confirms or overrides at Include (OD-116) |
| Source / provenance | `ingestion_queue.source_ref` → C3 trigger / pipeline | Which connector event or ingestion pipeline produced it (FR-3.TRIG.* → FR-2.ING.006/007/008 seam); a re-ingested gap-reconciliation item (FR-3.TRIG.006) is tagged as such |
| Target entity + maturity | `entities` (+ `[Building]` flag, ADR-002) | Shows whether the entity this would attach to is still sparse |
| Defer countdown | `ingestion_queue.deferred_until` vs `ingest_defer_resurface_days` | A deferred item shows when it will resurface |
| Overdue flag | `created_at` vs `review_escalation_days` | Un-actioned past cadence → overdue styling + counts toward the tab's escalation badge |

> **DRY rule for human-readable text.** Flag-reason labels, tier meanings (glossary / FR-1.CLR.001), and CFG helper
> text bind to their canonical sources — never re-typed here.

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| Include | Confirm/assign the sensitivity tier (pre-filled with the suggested tier, overridable — OD-116) → hands the item to the **sole Memory-Agent writer** (FR-2.ING.010 — *not* a direct insert; still runs contradiction check + per-entity lock + write-rate cap, ADR-004) → `state=included`; logged who/when/tier (FR-2.ING.003 / FR-1.AUD.002) | `PERM-ingestion.review` |
| Exclude | Confirm (reason captured) → `state=excluded`, content discarded permanently, audit record retains who/when/why (AC-2.ING.003.1) | `PERM-ingestion.review` |
| Defer | Holds the item → `state=deferred`, `deferred_until = now + ingest_defer_resurface_days`; it auto-resurfaces as pending on that cadence (FR-2.ING.003) — never an indefinite silent hold | `PERM-ingestion.review` |
| View item (detail) | Opens the content preview + flag context; for a Personal/Restricted-flagged item, opening is itself an audited access (FR-1.AUD.001) and requires the matching clearance | `PERM-ingestion.review` + tier clearance |
| Toggle: Auto-dropped (trust window) | Switches to the read-only shadow-drop audit view (FR-2.ING.001 / OD-036) — what Filter 1 is discarding during the trust window, for audit before fully-autonomous dropping | `PERM-ingestion.review` |

**Real-time / poll:** This is **not** one of the realtime-WebSocket surfaces (those are C6's agent-action approval
queue + the notification centre — FR-7.RTP.001; that approval queue is **surface-04**, distinct from this memory
queue). The Ingestion queue **polls** (default cadence per FR-7.RTP.002, configurable; on-load + on-action refresh).
The **overdue escalation alert** is produced by the C2 maintenance loop + C7 alerting (FR-2.ING.003 / FR-7.ALR.*) —
this surface renders the queue and the badge; it does not own alert delivery (seam).

**States:**
- **Loading:** Skeleton rows + a skeleton count badge (never a "0" badge while still loading — a false "nothing to review").
- **Empty:** "No items waiting for review. Sensitive content will appear here for your decision before it's saved." — the healthy zero-state (the gate is working, nothing is held).
- **Error:** Fetch fails → "Couldn't load the ingestion queue." + retry; **does not render an empty queue** (an empty queue that is actually a fetch failure would silently hide held sensitive content — #3). The tab badge shows "—", not "0".
- **Partial:** Rows load but a flag-reason / suggested-tier / target-entity fails to resolve → render the row with that field as "—" and **disable Include** for it (never Include an item whose sensitivity context didn't load — #2); Exclude/Defer remain available — **except** if `deferred_until` cannot be computed (cadence unknown), Defer is also disabled, since an item must never leave the queue via a Defer that can't guarantee its resurface (AC-2.ING.003.2 — no exit but an explicit, recoverable decision).
- **Offline / stale:** Stale banner with as-of time; Include/Exclude/Defer disabled (a decision must not be attempted against stale state — #2). The overdue badge persists (an overdue item offline is still overdue).

---

### Conflicts — hard-conflict review queue

**Purpose:** Surface every write the contradiction check (FR-2.WRT.002) flagged as a **hard conflict** — held in
quarantine, never auto-resolved and never silently applied — and let a reviewer decide the resolution. The daily
supersede safety-net (FR-2.MNT.006) adds late-caught conflicts here.

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| Conflict rows | hard-conflict quarantine store (`new_memory`, `conflicting_memory_ids`, `suggested_resolution`, `state`, `created_at`, `escalated_at`) | One row per held write; the new memory is **not** in the live retrievable set and has **not** overwritten the old (FR-2.WRT.002 / OD-032) |
| Side-by-side | `new_memory` vs `memories` (the 1–N conflicting existing memories) | The reviewer sees both/all in full |
| Suggested resolution | priority rules FR-2.MNT.008 (human_verified > system_of_record > recency > confidence > ambiguous) | A *suggestion*, never auto-applied; for genuinely ambiguous, the suggestion is "keep both with a note" (AC-2.MNT.008.2) |
| Provenance / confidence | `memories.{source,confidence}` | Source type + confidence drive which priority rule applies |
| Overdue flag | `created_at` vs `review_escalation_days` | Past cadence → overdue + escalation badge (AC-2.WRT.002.3) |

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| Keep new (supersede existing) | Approves the held write → routes to the sole writer; the existing memory is CAS-superseded via the `superseded_by` chain (chain intact, not deleted — ADR-004 / AC-2.WRT.002.1); audited | `PERM-memory.review_conflict` |
| Keep existing (discard new) | Rejects the held write → discarded, reason logged; the existing memory is untouched | `PERM-memory.review_conflict` |
| Keep both (with note) | Retains both, linked with a note so retrieval injects both with the note (FR-2.MNT.008 rule 5 / OD-032); both memories stay live in `memories` and the quarantine record is **closed** (`state=resolved`) — never left dangling; audited | `PERM-memory.review_conflict` |
| View conflict (detail) | Opens the side-by-side; for Personal/Restricted memories, an audited access requiring clearance | `PERM-memory.review_conflict` + tier clearance |

**Real-time / poll:** Polls (same contract as Ingestion); on-load + on-action refresh; the overdue count badge polls.
Escalation alert delivered by C7 (seam).

**States:**
- **Loading:** Skeleton conflict cards + skeleton badge.
- **Empty:** "No conflicts to resolve. New memories that contradicted existing ones would wait here." — healthy zero-state.
- **Error:** Fetch fails → "Couldn't load the conflict queue." + retry; **never renders empty** (a hidden hard conflict means a contradicted memory silently persists — #1/#3). Badge shows "—".
- **Partial:** A conflict loads but one side (new or an existing memory) fails to resolve → show the card flagged "one side unavailable" and **disable all resolve actions** (you cannot safely resolve a conflict you can't fully see — #2). Never auto-pick the visible side.
- **Offline / stale:** Stale banner; resolve actions disabled; overdue badge persists.

---

### Consolidation — Personal-tier merge/summarise approval

**Purpose:** Personal-tier memories are **never auto-consolidated** (merge FR-2.MNT.005 or episodic→semantic
summarise FR-2.MNT.007) — the jobs skip them and queue the candidate here for explicit human approval (FR-2.MNT.014 /
OD-037), so Personal data is never silently folded into a broader, more-exposed memory (#2). **Personal clearance
required.**

**Data bindings:**

| Element | Source | Notes |
|---|---|---|
| Candidate rows | consolidation-approval store (`candidate_memory_ids`, `op` ∈ {merge, summarise}, `tier=Personal`, `state`, `created_at`, `escalated_at`) | One row per skipped Personal-tier candidate; the source memories remain separate and live until approved |
| Proposed result vs sources | derived proposal vs `memories` (the candidate set) | Merge: the richer combined memory; Summarise: the proposed semantic memory + its episodic cluster (evidence retained either way) |
| Why flagged | `op` + `merge_similarity_threshold` (0.92) / `summarise_episode_trigger` | What triggered the candidate (≥0.92 similar, or ≥N episodics) — read-only context |
| Overdue flag | `created_at` vs `review_escalation_days` | Past cadence → overdue + escalation badge (AC-2.MNT.014.2) |

> **Note (informational):** consolidation **never deletes** the source memories' evidence layer — episodics are
> retained and remain drillable (FR-2.MNT.007, #1); approval changes how they're summarised/merged, not whether the
> evidence survives.

**Actions:**

| Action (label) | What it does | PERM gate |
|---|---|---|
| Approve consolidation | Approves the merge/summarise → routes through the sole writer (ADR-004); evidence retained; audited to `access_audit` (the Personal consolidation is a logged event) | `PERM-memory.approve_consolidation` + Personal clearance |
| Reject (keep separate) | Leaves the source memories separate; the candidate is cleared, reason logged to `access_audit` (a Personal-tier access event, FR-1.AUD.001) | `PERM-memory.approve_consolidation` + Personal clearance |
| View candidate (detail) | Opens the proposed-vs-sources preview — an audited Personal access requiring Personal clearance (FR-1.AUD.001) | `PERM-memory.approve_consolidation` + Personal clearance |

**Real-time / poll:** Polls (consolidation jobs run weekly, so a slow poll / on-focus refresh suffices); the overdue
count badge polls. Escalation alert delivered by C7 (seam).

**States:**
- **Loading:** Skeleton candidate cards + skeleton badge.
- **Empty:** "No Personal-tier consolidations awaiting approval." — healthy zero-state (Standard-tier consolidations run automatically and never appear here).
- **Error:** Fetch fails → "Couldn't load the consolidation queue." + retry; **never renders empty** (#3). Badge shows "—".
- **Partial:** A candidate loads but a source memory or the proposed result fails to resolve → flag "preview incomplete" and **disable Approve** (never approve a fold you can't fully preview — #2); Reject remains available.
- **Offline / stale:** Stale banner; Approve/Reject disabled; overdue badge persists.

---

## Navigation / transitions

| Trigger | Destination |
|---|---|
| Sidebar "Memory Review" | surface-03 (default tab = Ingestion) |
| Ingestion → click an item | Item detail panel (content, flag reason, suggested tier, source, target entity) |
| Ingestion → "Auto-dropped (trust window)" toggle | Read-only shadow-drop audit view (FR-2.ING.001 / OD-036) |
| Ingestion → Include | Confirm-tier modal → on confirm, item handed to the Memory-Agent writer (a subsequent writer-side hard conflict surfaces on the **Conflicts** tab — items don't vanish) |
| Conflicts → click a conflict | Side-by-side new-vs-existing detail with suggested resolution |
| Consolidation → click a candidate | Proposed-vs-sources preview |
| Any overdue escalation badge | (the alert is delivered via C7; the badge links to the overdue item in its queue) |
| Target entity link (any tab) | Memory navigation / entity browser (surface-11) |

---

## Mobile

This is operator/admin review tooling, primarily desktop. On narrow viewports the tab bar collapses to a dropdown
(carrying the per-tab count badges); the Ingestion queue collapses to stacked cards (content snippet / flag reason /
suggested tier / age) with Include/Exclude/Defer in a per-row action sheet. The **Conflicts side-by-side and the
Consolidation proposed-vs-sources previews are the views that do not adapt well to a phone** — below ~768 px they
show a "This review needs a wider display" notice with a read-only summary rather than a cramped, mis-resolvable
comparison (resolving a conflict or approving a Personal fold on a phone is out of scope — a wrong tap here is a #1/#2
event). The detailed mobile treatment lives in `surface-12-mobile.md`.

---

## Open decisions

**All resolved 2026-06-30 (operator: "mint dedicated nodes" on OD-115; "take all three recs" on OD-113/114/116).**

| # | Question | Resolution |
|---|---|---|
| OD-113 🟢 | One tabbed "Memory Review" surface, or three separate surfaces (Ingestion / Conflicts / Consolidation)? | **(a)** One tabbed surface with per-tab gating — the three are tightly coupled (all gate the memory write path), share a Super-Admin/Admin-reviewer audience, and a single surface shows all pending memory work with one escalation model. Mirrors surface-02's tabbed pattern. |
| OD-114 🟢 | The trust-window auto-drop audit (FR-2.ING.001 / OD-036): own tab, or a toggle inside Ingestion? | **(a)** A toggle/secondary view inside the Ingestion tab — it's a lower-traffic, read-only *audit* of the same source stream (what Filter 1 drops), not an action queue; a toggle keeps the action tabs uncluttered. Promote to its own tab only if trust-window volume warrants. |
| OD-115 🟢 | The Conflicts + Consolidation queues have **no dedicated PERM node** in the C2 FRs (FR-2.WRT.002 = "writer"; FR-2.MNT.014 = "cleared role + `PERM-memory.*`"). Mint dedicated nodes, or reuse `PERM-memory.write`? | **(a)** Mint **`PERM-memory.review_conflict`** (Super Admin + Admin) + **`PERM-memory.approve_consolidation`** (Super Admin; + Personal clearance) under the **Memory Access** category. Distinct, auditable review authorities that shouldn't be implied by generic memory-write authority (#2). Recorded into the C1 catalog via change-control (the OD-115 entry in `open-decisions.md` carries the four-field node definitions; this is an *addition* under FR-1.PERM.005's "updated whenever a new gate is added" discipline, not an ADR supersede). |
| OD-116 🟢 | At Include, does the reviewer confirm/assign the sensitivity tier, and may they override Filter 2's suggested tier? | **(a)** Include requires confirming the tier, pre-filled with Filter 2's suggestion, overridable, with the override audited — FR-2.ING.003 defines Include as "assign sensitivity + proceed," so the human owns the tier; an under-classification is a #2 risk worth a logged human decision. |

---

## Phase 4 data binding notes

- **`ingestion_queue`** — `id` (pk), `content`, `source_ref` (provenance → C3 trigger / pipeline), `flag_reason` (Filter-2 output), `suggested_tier`, `target_entity_id` (fk → `entities`, nullable), `state` ∈ {pending, deferred, included, excluded, shadow_dropped}, `deferred_until` (nullable — drives resurface, `ingest_defer_resurface_days`), `created_at` (drives escalation vs `review_escalation_days`), `reviewed_by`, `reviewed_at`, `decision_reason` (nullable). Index `(state, created_at)` for the oldest-first + overdue queries. RLS: readable with `PERM-ingestion.review`; Personal/Restricted-flagged rows additionally gated by clearance. **No `client_slug`** (ADR-001 §3).
- **Trust-window shadow-drop records** (FR-2.ING.001 / OD-036) — whether a distinct store or `ingestion_queue` rows with `state=shadow_dropped` is a **Phase-4 modelling call**; either way they are tagged, retained for the trust window, and read-only.
- **Hard-conflict quarantine** (FR-2.WRT.002) — `new_memory` (pending, not in the live retrievable set), `conflicting_memory_ids` (array → `memories`), `suggested_resolution` (FR-2.MNT.008 output), `state`, `created_at`, `escalated_at` (nullable). Index `(state, created_at)`.
- **Consolidation-approval** (FR-2.MNT.014) — `candidate_memory_ids` (array → `memories`), `op` ∈ {merge, summarise}, `tier=Personal`, `state`, `created_at`, `escalated_at` (nullable). Index `(state, created_at)`.
- **`escalated_at` is server-owned, not a surface computation:** on all three queues it is populated by the **C2 maintenance loop** when an un-actioned item passes `review_escalation_days` (FR-2.ING.003 / FR-2.WRT.002.3 / FR-2.MNT.014.2), which also emits the escalation alert via **C7** (FR-7.ALR.* — seam). The surface **reads** `escalated_at` (and `created_at` vs the cadence) to render the overdue styling + tab badge; it never decides escalation itself, so the badge is correct even if the surface is idle. This keeps the "never silently held" guarantee owned by the backend, not dependent on a dashboard being open (#3).
- **`access_audit`** — append-only (FR-1.AUD.001/002): every Include/Exclude/Defer, conflict resolution, consolidation approval, and every view of a Personal/Restricted item (actor, action, target, tier, reason, timestamp). Immutable; C7 owns retention/export.
- **Read-only joins:** `memories`, `entities` (+ Maturity/`[Building]` flag, ADR-002). The writer path an Include/approval routes into (`memories` via the sole writer, ADR-004) is **not** written by this surface — it is handed off.
- **PERM nodes (OD-115 resolved):** `PERM-memory.review_conflict` + `PERM-memory.approve_consolidation` are minted under the **Memory Access** category and recorded in OD-115 / SESSION-LOG; they must appear in `PERMISSION_NODES.md` (build artifact) with their four fields (Description / Default roles / Scope / Added-in) when that catalog is materialised at build (FR-1.PERM.005 discipline).
- **No `client_slug`** on any table on this surface (ADR-001 §3 / OD-096 — isolation is by deployment).
