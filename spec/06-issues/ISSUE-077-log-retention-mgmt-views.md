---
id: ISSUE-077
title: Log retention/export + mgmt-plane views + feedback flywheel
epic: J — observability
status: in-progress
github: "#77"
---

# ISSUE-077 — Log retention/export + mgmt-plane views + feedback flywheel

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Complete the C7 observability backbone above the ISSUE-011 skeleton: the three-sink retention + compliance-erasure (redaction-tombstone) + client-presentable export contract, the *client-side* health-reporter push + management-plane cross-deployment views (health grid, staleness, cross-deployment alerts, backup-health + cost overview), the five RBAC-gated dashboard *data contracts* (VIEW), and the feedback-flywheel signal substrate (OPT).

## 2. Scope — in / out
**In:**
- **Retention + erasure + export** for the three C7-governed append-only sinks: the `event_log` per-deployment retention window with an operational floor, referenced-row protection, and the redaction-tombstone on compliance erasure (FR-7.LOG.006); the C7 side of `guardrail_log` — dashboard view, retention floor, tamper-evidence, and complete-or-fail export as client trust evidence, plus its redaction-tombstone (FR-7.LOG.007). *(`config_audit_log` view/retention/export, FR-7.LOG.008, is built in ISSUE-010; this issue does not re-build it.)*
- **The client-side of the management plane (FR-7.MGM.001–005):** the per-deployment outbound health-reporter job that pushes operational-metadata-only snapshots (allow-list enforced at the reporter, local-`event_log` push-attempt logging); staleness → stale-not-green with an independent-heartbeat server-authoritative evaluator; the deployment health grid contract; cross-deployment alerts + CI/CD status; backup-health (Supabase Management API) + cross-deployment cost overview. This owns the **reporter + the read contract of the mgmt views**; the mgmt-plane *ingest endpoint, `client_registry`, `deployment_health` writes* are ISSUE-012.
- **The five dashboard data contracts (FR-7.VIEW.001–003):** operations dashboard as per-deployment source of truth with each panel mapped to its producing-component FR; RBAC-gated role surfaces + answer-mode-pill render seam; mobile push-notification routing contract. **Data contract + signal wiring only — all layout/visual state is Phase 3 (rendered by ISSUE-078/073/079).**
- **The feedback-flywheel + benchmarking substrate (FR-7.OPT.001–002):** durable capture of the four review-signal classes; the v1 per-deployment benchmarkable substrate, with cross-deployment comparison explicitly held OOS-029.

**Out:**
- The `event_log` schema + append-only enforcement + silent-failure detector + alert-engine watchdog + real-time/polling core: **ISSUE-011** (LOG.001–005, ALR.008, RTP core). This issue builds *on* that skeleton — it adds retention/export/erasure and the mgmt/view/opt layers.
- The **management-plane deployment itself** — `client_registry` + `deployment_health` + `offboarding_records` tables, the ingest endpoint, `internal_token` auth: **ISSUE-012** (C10 MGT). This issue's reporter *pushes to* that endpoint; it does not build the receiver.
- `config_audit_log` governance (FR-7.LOG.008): **ISSUE-010**. Alerting rules/routing/escalation/delivery: **ISSUE-075**. Cost meter + ladder trigger: **ISSUE-074**. Real-time/polling contract: **ISSUE-076**.
- **All rendering** of the ops/super-admin/manager/user/mobile surfaces: Phase 3 — **ISSUE-078** (ops + super-admin fleet console), **ISSUE-073** (user + agency dashboards), **ISSUE-079** (mobile). This issue delivers the data/signal contract they render.
- The producing-component signals themselves (memory health → C2, connector status → C3, loop/queue/DLQ → C5, guardrail write-completeness → C6, agent health → C8, Insight suggestions → C9): consumed as mapped sources, authored elsewhere.
- The redaction-tombstone *trigger* (the C2/C10 transitive erasure walk that calls it): C2 FR-2.MNT.017 (AC-2.MNT.017.4) / C10 FR-10.DEL.004 — **ISSUE-029 / ISSUE-082**. This issue owns the C7-side scrub-in-place mechanism it invokes.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-7.LOG.006, FR-7.LOG.007, FR-7.MGM.001, FR-7.MGM.002, FR-7.MGM.003, FR-7.MGM.004, FR-7.MGM.005, FR-7.VIEW.001, FR-7.VIEW.002, FR-7.VIEW.003, FR-7.OPT.001, FR-7.OPT.002 (all Component 7 — Observability).
- **NFRs:** NFR-CMP.007 (redaction-tombstone), NFR-CMP.009 (export all-or-nothing), NFR-OBS.010 (append-only + retention-pruning-logged); NFR-OBS.006 (mgmt-plane staleness — shared with ISSUE-012, enforced on the reporter/evaluator side here); NFR-CMP.006 (audit-sink immutability — the retention/tombstone paths must not violate the append-only trigger).
- **Rests on:** ADR-001 §3/§7 (Silo isolation; management plane is push-only, operational-metadata-only — "a map, not a warehouse"), ADR-003 (estimate-grade cost for the cross-deployment overview), ADR-008 (backup-health via the Supabase Management API, no business data), OD-065 (three distinct sinks), OD-072 (per-sink retention windows + floors), OD-074 (redaction-tombstone), OD-071 (stale-not-green), OD-029 (deployment benchmarking v2 → OOS-029); AF-118, AF-119, AF-120, AF-139, AF-133, AF-137.

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-7.LOG.006.1, AC-7.LOG.006.2, AC-7.LOG.006.3 (FR-7.LOG.006 — retention window, pruning-logged, redaction-tombstone)
- AC-7.LOG.007.1, AC-7.LOG.007.2, AC-7.LOG.007.3, AC-7.LOG.007.4 (FR-7.LOG.007 — export complete, floor, tamper-evidence, tombstone)
- AC-7.MGM.001.1, AC-7.MGM.001.2, AC-7.MGM.001.3 (FR-7.MGM.001 — allow-list, push-not-pull, local push-attempt log)
- AC-7.MGM.002.1, AC-7.MGM.002.2, AC-7.MGM.002.3, AC-7.MGM.002.4 (FR-7.MGM.002 — stale-not-green, independent heartbeat, server-authoritative clock)
- AC-7.MGM.003.1, AC-7.MGM.003.2 (FR-7.MGM.003 — grid from snapshots, click-through navigates, no data mirror)
- AC-7.MGM.004.1, AC-7.MGM.004.2 (FR-7.MGM.004 — cross-deployment alerts, CI/CD status)
- AC-7.MGM.005.1, AC-7.MGM.005.2 (FR-7.MGM.005 — backup-health via Management API, cost overview)
- AC-7.VIEW.001.1, AC-7.VIEW.001.2, AC-7.VIEW.001.3 (FR-7.VIEW.001 — panel→producer mapping, silent-failure indicators, self-improvement panel)
- AC-7.VIEW.002.1, AC-7.VIEW.002.2 (FR-7.VIEW.002 — RBAC-scoped signals, answer-mode pill everywhere)
- AC-7.VIEW.003.1, AC-7.VIEW.003.2 (FR-7.VIEW.003 — hard-limit push immediate, configurable push frequencies)
- AC-7.OPT.001.1 (FR-7.OPT.001 — four signal classes durably captured)
- AC-7.OPT.002.1, AC-7.OPT.002.2 (FR-7.OPT.002 — v1 substrate captured; no false cross-deployment claim)
- AC-NFR-CMP.007.1, AC-NFR-CMP.007.2 (redaction-tombstone scrubs PII + tamper-check still passes)
- AC-NFR-CMP.009.1 (export all-or-nothing, fails loud on shortfall)
- AC-NFR-OBS.010.1/.2 (append-only + retention-pruning-logged — as read in `observability.md`)
- **Gating spikes (if any):** none of the six OD-157 launch spikes (ISSUE-001–006) blocks this issue directly — it is not in any spike's "Gate" list. **Build-time AFs attached as DoD notes** (`test-strategy.md`): **AF-118** (staleness evaluator liveness) + **AF-120** (server-authoritative clock) must be GREEN for FR-7.MGM.002; **AF-119** + **AF-139** (out-of-band last-resort / external monitor of the mgmt plane) are build-time carry-forwards flagged on the push path; **AF-133** (export integrity at scale) for FR-7.LOG.007 export; **AF-137** (transitive-erasure completeness across the C10→C2→C7 sink boundary) for the redaction-tombstone (FR-7.LOG.006/007).

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-event_log (retention/redaction of `.summary`, `.entity_ids`; append-only), DATA-guardrail_log (C6-written; C7 owns view/retention/tamper-evidence/export + redaction of `.description`), DATA-config_audit_log (read for the third-sink retention floor parity only; governed by ISSUE-010), DATA-notifications (cross-deployment alert surfacing), DATA-push_subscriptions (mobile push routing, FR-7.VIEW.003); **management-plane (ISSUE-012-owned, written *by* this issue's reporter push, not created here):** DATA-client_registry (`.core_version` push-updated), DATA-deployment_health (`.health_score`, `.queue_depth`, `.approval_queue_depth`, `.alert_counts`, `.backup_health`, `.log_write_failing`, `.last_push_at`, `.cost_to_date`).
- **PERM:** `PERM-compliance.download_records` (guardrail_log export authority — catalogued in `PERMISSION_NODES.md` L110, default **Super Admin (unseeded)**; cited at its point of use in component-07-observability.md L398), `PERM-config.observability` (mgmt-view / cross-deployment config surface — defined in the CFG register cluster J, config-registry.md; consumed from ISSUE-075/010).
- **CFG:** `CFG-event_log_retention_window` (default 365d; config-registry.md cluster J), `CFG-deployment_staleness_window` (default 15min — the mgmt-plane staleness window for MGM.002 per NFR-OBS.006; config-registry.md cluster J), `CFG-price_table` (App. A object; the estimate-grade cross-deployment cost overview; config-registry.md cluster I/App. A). **Retention floors are a deliberate deferral, not CFG keys:** the guardrail-log and access-audit numeric floors on top of `CFG-event_log_retention_window` are "a C10/Phase-5 compliance input (flagged, not invented here)" per OD-072 — build the floor **check** (retention ≥ the compliance/audit minimum) as a parameter, do **not** invent a numeric default here.
- **UI:** UI-dashboard-super-admin (health grid, cross-deployment alerts, CI/CD, cost overview — contract only), UI-dashboard-operations (per-deployment source-of-truth panels — contract only), UI-dashboard-manager, UI-dashboard-standard-user, UI-dashboard-mobile (push routing) — **all Phase-3-rendered (ISSUE-078/073/079); this issue supplies the data/signal contract**.
- **Connectors:** none owned (C7 consumes C3 connector-status rollup for the health grid; the Supabase Management API backup-health read is a platform call per ADR-008, not a client connector).

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-07-observability.md — the FR text + ACs (LOG.006/007, MGM.001–005, VIEW.001–003, OPT.001–002; the OD-065/071/072/074 resolutions and the reconciliation notes #2/#3/#4).
- spec/05-non-functional/compliance.md — NFR-CMP.006 (audit-sink immutability), NFR-CMP.007 (redaction-tombstone), NFR-CMP.009 (export all-or-nothing).
- spec/05-non-functional/observability.md — NFR-OBS.006 (mgmt-plane staleness), NFR-OBS.010 (append-only + retention-pruning-logged).
- spec/04-data-model/schema.md §8 (Observability) — `event_log` / `notifications` / `config_audit_log` / `push_subscriptions`; §13 (Management plane) — `client_registry` / `deployment_health` / `offboarding_records` (the push targets); §7 (Guardrails) — `guardrail_log` for the view/retention/export; §12 (Config cluster) for the retention/staleness/price CFG objects.
- spec/02-config/config-registry.md — the CFG register: cluster J (`PERM-config.observability`) for `event_log_retention_window` (365d) + `deployment_staleness_window` (15min); cluster I / App. A for `price_table` (estimate-grade, operator-editable). Read here for exact key/default/edit-class of every CFG-* in field 5. The retention floors are NOT keys here — they are the OD-072 C10/Phase-5 deferral.
- `PERMISSION_NODES.md` (repo root) — the authoritative node catalog: `PERM-compliance.download_records` (L110) is the guardrail_log export authority (for AC-7.LOG.007.1) and defaults to **Super Admin (unseeded)**. This is where the node→default-role mapping is resolved — do not guess. (ISSUE-018 *seeds* this catalog into `role_permissions`; component-07-observability.md L398 cites the node at its point of use.)
- spec/00-foundations/adr/ADR-001-isolation-model.md — §3 (single-tenant, no `client_slug` intra-silo) + §7 (management plane = push, operational-metadata-only).
- spec/00-foundations/adr/ADR-008-backup-dr.md — backup-health via the Supabase Management API without touching business data (FR-7.MGM.005).

## 7. Dependencies
- **Blocked-by:** ISSUE-011 (observability skeleton — `event_log` append-only store + silent-failure detector + alert-engine watchdog; this issue adds retention/export/erasure + the MGM/VIEW/OPT layers on top), ISSUE-012 (management-plane bootstrap — `client_registry` + ingest endpoint + `deployment_health`; this issue's health-reporter push targets that endpoint and its cross-deployment views read that registry). Neither blocker is a spike.
- **Blocks:** ISSUE-078 (ops dashboards + super-admin fleet console — renders the VIEW/MGM data contracts this issue defines), ISSUE-086 (config admin + config-audit-log surfaces — depends on the retention/export/audit backbone landing).

## 8. Build order within the slice
1. **Retention + pruning (FR-7.LOG.006 / FR-7.LOG.007 / NFR-OBS.010):** implement the per-sink configurable retention windows with floors for `event_log` and `guardrail_log` (read from the §12 config objects); the pruning job skips any still-referenced row (open task/approval/cleanup) and logs every run (count + window). Assert the retention floor ≥ the compliance/audit minimum (parity with `config_audit_log`, ISSUE-010).
2. **Redaction-tombstone (FR-7.LOG.006.3 / FR-7.LOG.007.4 / NFR-CMP.007):** implement the scrub-in-place of PII fields (`event_log.summary`/`entity_ids`, `guardrail_log.description`) that retains the row + audit metadata; verify it does not trip the audit-sink append-only trigger (NFR-CMP.006 — it is the *only* sanctioned in-place mutation) and that the tamper-evidence check (AC-7.LOG.007.3) still passes afterward. Wire it as the callee invoked by the C2/C10 transitive walk (ISSUE-029/082); AF-137 gates completeness.
3. **Export (FR-7.LOG.007.1 / NFR-CMP.009):** the `guardrail_log` date-range export returns every row in a client-presentable format or **fails loud** on any reconciliation shortfall — all-or-nothing, never a silently-truncated file (AF-133 at scale). Gate the export action on `PERM-compliance.download_records` (Super Admin, unseeded — `PERMISSION_NODES.md` L110; cited at use in component-07-observability.md L398).
4. **Health-reporter push (FR-7.MGM.001):** the per-deployment outbound job that posts operational-metadata-only snapshots to the ISSUE-012 ingest endpoint; enforce the allow-list at the reporter (reject any business-data field before send, ADR-001 §7); log every push attempt/failure to the **local** `event_log` and carry the `log_write_failing` health bit. **Canonical allow-list = the `deployment_health` column set in schema.md §13** (`health_score`, `queue_depth`, `approval_queue_depth`, `alert_counts`, `backup_health`, `log_write_failing`, `last_push_at`, `cost_to_date`) **+ `client_registry.core_version`**, cross-checked against ADR-001 §7's named operational-metadata fields — treat schema.md §13 as the single authoritative field list; ADR-001 §7 is the confirming rationale, not a second list.
5. **Staleness evaluator (FR-7.MGM.002 / NFR-OBS.006):** stale-not-green — an independent-heartbeat evaluator, computed against a single server-authoritative timestamp (AF-118, AF-120), flips a card to `stale`/`unreachable` and raises a cross-deployment alert; a frozen silo reads `frozen`, not dead.
6. **Cross-deployment views (FR-7.MGM.003/004/005):** the deployment health grid (cards from pushed snapshots, click-through *navigates into* the deployment — no data mirror), cross-deployment alerts + CI/CD status, backup-health via the Supabase Management API (ADR-008), and the estimate-grade cross-deployment cost overview (ADR-003). Data contract only; the Super Admin surface renders in ISSUE-078.
7. **Dashboard data contracts (FR-7.VIEW.001–003):** map every ops-dashboard panel to its producing-component FR (no C7-invented signal); wire the silent-failure indicator to the ISSUE-011 LOG.003 completeness gap; RBAC-scope each role surface to C1 permissions; wire the answer-mode-pill render seam (C4) and the mobile push-notification routing classes (hard-limit immediate + always). Layout/state → Phase 3.
8. **Feedback-flywheel + benchmarking substrate (FR-7.OPT.001/002):** durably capture the four review-signal classes (approval/rejection/memory-flag/task-failure) for review; capture the v1 per-deployment benchmarkable substrate (cost-per-task-type + outcome/health) with no surface claiming the OOS-029 cross-deployment comparison exists.
9. Test to each AC in field 4 across the retention, erasure, export, push, staleness, view-contract, and substrate paths.

## 9. Verification (how DoD is proven)
- **Retention/pruning:** per spec/05-non-functional/test-strategy.md — a pruning run over a fixture that skips a referenced row and logs the run proves AC-7.LOG.006.1/.2 + AC-NFR-OBS.010.1/.2; the floor check proves AC-7.LOG.007.2.
- **Erasure (redaction-tombstone):** a compliance-erasure fixture scrubs PII in `event_log`/`guardrail_log` while retaining row + audit metadata and passing the post-hoc tamper-evidence check — AC-7.LOG.006.3, AC-7.LOG.007.4, AC-NFR-CMP.007.1/.2; the append-only trigger is not violated (NFR-CMP.006). AF-137 (transitive completeness across the C10→C2→C7 boundary) GREEN gates the erasure claim.
- **Export:** a forced reconciliation shortfall in the `guardrail_log` export fails loud with no "complete" claim and no partial file — AC-7.LOG.007.1, AC-NFR-CMP.009.1; AF-133 covers scale.
- **Management plane (reporter + views):** a snapshot carrying a business-data field is rejected at the reporter (AC-7.MGM.001.1); the mgmt plane never pulls (AC-7.MGM.001.2); a stopped reporter flips its card to stale within the window and raises a cross-deployment alert via the independent server-authoritative evaluator — AC-7.MGM.002.1/.2/.3/.4, AC-NFR-OBS.006.1/.2 (AF-118, AF-120 GREEN); grid/CI-CD/backup-health/cost-overview contracts render from pushed snapshots only — AC-7.MGM.003.1/.2, .004.1/.2, .005.1/.2.
- **View contracts:** each panel resolves to a producing-component FR and no C7-invented signal (AC-7.VIEW.001.1); the silent-failure indicator is driven by LOG.003 gaps (AC-7.VIEW.001.2); a role sees only its C1-permitted signals + every AI-output item carries its answer-mode pill (AC-7.VIEW.002.1/.2); the hard-limit push is immediate/unsuppressible (AC-7.VIEW.003.1).
- **Substrate:** the four signal classes are durably recorded/retrievable (AC-7.OPT.001.1) and no v1 surface claims cross-deployment benchmarking (AC-7.OPT.002.2, logged OOS-029).
- **Build-time AF gates:** AF-118/AF-120 (staleness liveness + clock) for FR-7.MGM.002; AF-119/AF-139 (out-of-band last-resort + external monitor) flagged on the push path; AF-133 (export) / AF-137 (erasure) as noted. The AC→`Verified` path for each AC runs once its attached build-time AF is GREEN.
