---
id: ISSUE-090
title: Render surface-04 approval queue (live Approve/Reject/Modify gate with mandatory audited reason)
epic: M — frontend
status: ready
github: "#90"
---
# ISSUE-090 — Render surface-04 (the real-time human gate on agent actions)

> **Self-sufficiency contract (read this first).** A *complete, precise build order that points into the repo by ID*;
> it does **not** restate `AC-*` text (read it in the surface spec + FR). A zero-context builder must build to the DoD
> from the Context manifest **without guessing.** Created session 80 by the [[OD-197]] `to-issues` render pass — `087`
> is done, so this render layer is schedulable; the logic it renders is ISSUE-056 (approval tiers) + ISSUE-048 (task_queue).

## 0. Context manifest (load only these)
- `spec/03-surfaces/surface-04-approval-queue.md` — the surface being rendered (the unified queue + detail panel + all states + ACs).
- [[ISSUE-087]] — the `web/client` shell + honest-state/a11y primitives + the typed seam. Consume, don't rebuild.
- [[ISSUE-056]] (`app/approval-tiers` — approval tiers + mandatory-hard set + escalation) + [[ISSUE-048]] (`app/task-queue` — the status machine incl. `awaiting_approval`/`flagged` + `originating_user_id`) + [[ISSUE-060]] (`app/guardrail-log`) — the backend logic this screen renders; already `done`.
- `spec/01-requirements/component-06-*` (C6 APR/ESC/LOG) + `component-07-*` (C7 RTP — the Realtime transport). `spec/05-non-functional/` NFR-OBS.011 + NFR-A11Y.001.
- `app/rbac` — `PERM-action.review` + the clearance model (the per-item authority the detail panel enforces).

## 1. Goal (one line)
Render surface-04 in **`web/client`** — the single live queue of `awaiting_approval` (C6 tiers) + `flagged` (C6 safety-holds) tasks with Approve/Reject/Modify + a **mandatory audited reason** — consuming ISSUE-056/048/060's logic through the `087` seam over the C7 Realtime transport, so **nothing consequential executes past this gate without an explicit audited decision** (#2) and a dropped socket **degrades to polling *visibly*, never a frozen view believed live** (#3, one of the two Realtime surfaces).

## 2. Scope — in / out
**In:** the render of the unified queue per the spec (OD-118): a sidebar "Approvals" with a **live count badge** + an honest connection indicator (● Live / ◐ Polling / ⟳ Reconnecting) + filter chips (All / Approvals / Safety holds / Overdue) + a row per item (proposed action + tier badge + age + **server-authoritative** soft-run countdown) + a detail panel (full action + params + provenance + tier rationale + already-applied side effects + a clearance-gated preview + Approve/Reject/Modify with mandatory reason). Every state honest: a fetch failure renders the badge "—" (not "0") and the indicator shows failure (not ● Live) — an empty queue that is actually a fetch failure hides a running server-side soft timer (#2); **offline disables ALL resolve actions**, and on reconnect the queue **re-fetches BEFORE re-enabling** (a soft item may have auto-run server-side).
**Out:** the **approval-tier/escalation/guardrail LOGIC** (ISSUE-056/060 — rendered, not built) · the **task_queue status machine + soft-timer** (ISSUE-048/052) · the C7 Realtime transport contract itself (ISSUE-076 — this consumes it) · the app shell/seam (087).

## 3. Implements (traceability spine — by ID, not restated)
- **Surface:** `surface-04` (UI-APPROVAL-QUEUE). **FRs rendered:** FR-5.QUE.005, FR-5.ASM.004/005; FR-6.APR.001/002/003/005/006, FR-6.ESC.001/003/004, FR-6.LOG.001/003; FR-7.RTP.001/002/003/004, FR-7.ALR.002/003/005/007. **Key ACs:** AC-5.QUE.005.1/.2, AC-6.APR.002.1/.2, AC-6.APR.003.1/.3, AC-6.APR.005.2/.3 (no self-approval), AC-6.ESC.001.2/.3, AC-7.RTP.001.1, AC-7.RTP.003.1/.2/.3, AC-7.RTP.004.2, AC-7.ALR.003.1/.005.3 (+ the surface's own ACs).
- **NFRs / posture:** NFR-OBS.011 · NFR-A11Y.001 · #1/#2/#3 · ADR-007 · OD-010/056.
- **Consumes (renders, owns none):** ISSUE-056/048/060 logic; the C7 Realtime transport (ISSUE-076); the `087` shell + seam + primitives; `PERM-action.review` + the clearance model.

## 4. Definition of done
- The unified queue + detail panel render per `surface-04-approval-queue.md`, with all specified states.
- **#2 gate:** Approve/Reject/Modify each require a **mandatory reason** written to the audit trail; **no self-approval** (the initiator can never approve their own item, AC-6.APR.005.3); per-item authority = `PERM-action.review` **AND** the routed-reviewer/fallback **AND** the matching sensitivity clearance for Confidential/Personal/Restricted content. `hard_limit` rows **never appear** here (killed + logged, no Approve affordance). Modify **re-enters the full guardrail gate** (can re-floor).
- **#3 Realtime honesty:** a dropped socket degrades to polling **visibly** (indicator ◐/⟳), never a frozen "live" view; a fetch failure shows badge "—" + a failure indicator, never "0"/● Live; **offline disables all resolve actions**; on reconnect the queue re-fetches before re-enabling; a partial load disables Approve/Modify but keeps Reject.
- **Server-authoritative soft-run countdown** — only on reversible soft items, never on hard/floored/irreversible; from the server clock, not the browser.
- **RBAC absent-not-empty:** the Approvals nav entry is hidden + 404 for a caller without `PERM-action.review`.
- **A11y + theming:** a11y baseline holds; light+dark render; mobile shows Approve/Reject/Hold + the countdown, and degrades Modify + Restricted-review to a desktop notice (this surface's mobile subset is also mirrored by surface-12/ISSUE-079).
- **Gating spikes:** none. (Realtime-delivery reliability at scale is a C7 concern, not this render's build gate.)

## 5. Touches (blast radius, by ID)
- **New:** `web/client` route/components for the approvals queue + detail panel — from `@harness/web-shared`; subscribes to the C7 Realtime channel (ISSUE-076) through the seam. **Consumes (no edits):** the `087` shell/seam/primitives; ISSUE-056/048/060; the C7 transport; `app/rbac`.
- **DATA:** read/decide through the seam (`task_queue` incl. `awaiting_approval`/`flagged`, `guardrail_log` incl. `escalated_at`, read-only joins `agents`/`memories`/`entities`/`access_audit`). **Mints no node, authors no migration.**

## 6. Evidence to capture (§10)
Component/UI-state tests (queue + detail states; the mandatory-reason + no-self-approval gate; the hard_limit-never-shown case); the Realtime-degradation test (socket drop → visible polling, never frozen-live); the fetch-failure test (badge "—" not "0"); the offline-disables-resolve + re-fetch-on-reconnect test; an a11y audit; screenshots light+dark.

## 7. Blocked-by
- **`087`** ✅ done · **`056`** (approval tiers) ✅ done · **`048`** (task_queue) ✅ done · **`060`** (guardrail_log) ✅ done · **`076`** (Realtime transport) ✅ done.
- **Blocks:** none (leaf render). *(surface-12/ISSUE-079 mirrors this queue on mobile — coordinate the shared queue components.)*

## 8. Build order within the slice
1. The queue list + connection indicator + filter chips + live count badge, subscribed to the C7 Realtime channel through the `087` seam (with the visible poll-degradation path).
2. The detail panel (action/params/provenance/tier rationale/side-effects/clearance-gated preview) + Approve/Reject/Modify with the mandatory-reason + no-self-approval + clearance authority gate; Modify re-enters the guardrail gate.
3. The server-authoritative soft-run countdown (reversible soft items only); the offline-disable + reconnect-re-fetch discipline; hard_limit rows excluded.
4. RBAC gate (absent-not-empty); a11y + theming; test to each §4 item.

## 9. Verification (how DoD is proven)
- **Component/UI-state layer** (+ the `preview` tooling): the queue/detail render their states; the reason-mandatory + no-self-approval + hard-limit-excluded gates fire; a simulated socket drop shows visible polling (never frozen-live); a fetch failure shows "—" not "0"; offline disables resolve + reconnect re-fetches first.
- **RBAC non-drift:** the entry gate reads `app/rbac`'s `PERM-action.review` (hidden + 404 when absent).
- **A11y:** the build-time a11y audit passes (NFR-A11Y.001).
