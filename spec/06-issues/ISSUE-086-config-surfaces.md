---
id: ISSUE-086
title: Config admin + config-audit-log surfaces
epic: L — config surfaces
status: ready
github: "#86"
---

# ISSUE-086 — Config admin + config-audit-log surfaces

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Build the two config surfaces on top of the ISSUE-010 storage backbone: `UI-config-admin` (surface-01) — the single privileged screen that renders, validates, and **writes** every registry knob across 11 sections (appending the who/when/old→new audit row on each per-section Save), and `UI-config-audit-log` (surface-01b) — the read/review counterpart that renders that trail as a filterable timeline + change-detail + complete-or-loud compliance export.

## 2. Scope — in / out
**In:**
- The **write path** for config: the 11-section sidebar-plus-content Config Admin screen (`#auth #memory #tools #prompts #loops #guardrails #observability #agents #proactive #infra #secrets`), each key rendered as a row (name · plain-English helper bound DRY to `config-registry.md` · current value · edit control · edit-class badge), with **per-section Save** (OD-103) that validates all LIVE/BOOT rows, enforces the per-section cross-constraints (e.g. `confidence_floor ≤ amber_zone_threshold`; `ranking_weights`/`routing_weights` sum = 1.0; cost-ladder ordering; injection thresholds; cold-start ordering; `alert_routing_rules` resolvability per FR-7.ALR.009; `escalation_contacts` non-empty), persists to `config_values`, and **appends the `config_audit_log` row** (`config-edit-taxonomy.md` rule 4).
- The edit-class behaviour: LIVE applies immediately; BOOT triggers the "requires a redeploy" confirm dialog only when a dirtied BOOT row is in the batch (OD-101) + "applies next deploy" badge; REBUILD (`embedding_model`) always confirm-dialogs before write; SECRET (`#secrets`) is a read-only presence + `last_rotated` view (never a value, never a save control — reads `secret_manifest`).
- The floored/locked rows rendered read-only with server-side reject: the seven hard-limit keys ("Hard limit — not editable"), every `action_autonomy_matrix` sub-type ("Locked (hard_approval-or-Prepare)", OD-161), `deployment_region` ("Locked for v1").
- The **entry + per-section PERM gating**: entry requires ≥1 `PERM-config.*` node; sections the caller's PERM set doesn't cover are omitted (not shown as locked); `#infra` + `#secrets` are Super-Admin-only (never delegable); `action_autonomy_matrix` additionally requires `PERM-guardrail.edit_autonomy` (now no configurable row — retired, OD-161).
- The **read/review surface** (surface-01b): the Config-Change Timeline (Section A, key-prefix-scoped, filterable by section/key/actor/date), the Change Detail drawer (Section B, old→new diff + actor + class), and the Compliance Export (Section C, `PERM-compliance.download_records`-gated, all-or-nothing), all read-only over `config_audit_log`; the two always-loud alert banners (alert-engine-stalled AC-7.ALR.008.2, alert-delivery-misconfigured AC-7.ALR.009.1) pinned per FR-7.RTP.001/ALR.001.
- All five load states per section (Loading / Empty / Error / Partial / Offline) as specced — in particular the #3 discipline: a failed audit-log load never renders as an empty timeline ("no changes ever"), and a partial-load never overwrites good `config_values` with empty.
- Mobile graceful-degradation banners (OD-100): both surfaces are desktop-optimised; export is discouraged/degraded on narrow viewports.

**Out:**
- The **config storage backbone** — `config_values` / `secret_manifest` / `config_audit_log` tables, the append-only + tamper-evident triggers, the key-prefix RLS policy, the retention/pruning + redaction-tombstone shape, and the complete-or-fail **export mechanism** (server-side complete read): **ISSUE-010** owns these (it builds the sink + immutability + export *contract*; this issue *writes into* and *renders* them).
- The `event_log` / `guardrail_log` / `access_audit` sinks and their views/exports: observability skeleton **ISSUE-011** + retention/export **ISSUE-077**.
- Minting the `PERM-config.*` catalog + `PERM-compliance.download_records` (FR-1.PERM.005): C1 / **ISSUE-018** — consumed here as gates, not created.
- The C10/C2 user-erasure walk that redaction-tombstones `config_audit_log.actor_id`: **ISSUE-082 / ISSUE-084** (this surface only *renders* a tombstoned actor as "redacted (erased user)").
- The individual knob *semantics* / consumers (each owning issue reads its own keys) — this surface edits values, it does not implement what a knob does.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-7.LOG.008 (Component 7 — Observability; `config_audit_log` view/retention/tamper-evidence/export — this issue is the render + write-append side), FR-7.LOG.005 (credential-never-in-log, held by construction via the SECRET edit class), FR-7.ALR.009 (unroutable alert fails loud — `alert_routing_rules` edited + validated in `#observability`; both surfaces pin the misconfigured-delivery banner), FR-7.ALR.008 (alert-engine-stalled banner pinned), FR-7.RTP.001 (neither surface holds a Realtime subscription — static + on-demand), FR-1.PERM.005 (the `PERM-config.*` node catalog these surfaces gate on).
- **NFRs:** NFR-A11Y.001 (accessibility baseline floor — both surfaces are within the 14-surface audit set).
- **Rests on:** ADR-004 (sole-writer / actor attribution — every config save is `actor_id`-attributed), ADR-006 (static data-driven key-prefix RLS — reads scoped to the caller's `PERM-config.*` set), ADR-007 + OD-047 + OD-060 (the seven hard limits are NOT knobs, never role/config/prompt-overridable, never human-overridable at runtime — enumerated in field 5; `injection_semantic_detection_enabled` off by default), ADR-001 §3/§7 (intra-client only — no `client_slug` on any binding; per-silo config), OD-098–103 (surface-01 layout/save/dialog/mobile/secret-source decisions), OD-153–156 (surface-01b governance/layout/gating/behaviour), OD-161 (autonomy matrix floored — Act retired), OD-099 (`UI-config-audit-log` named as separate surface).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-7.LOG.008.1 (complete-or-loud export over range + `PERM-config.*` key-prefix scope — the export UI never delivers a silent partial)
- AC-7.LOG.008.3 (append-only + tamper-evident — Change Detail renders the integrity/tamper-evidence indicator; the surface never offers an edit/delete of an audit row)
- AC-7.LOG.008.4 (a redaction-tombstoned actor renders as "redacted (erased user)"; the change record + key/old→new/changed_at still render)
- AC-7.LOG.008.5 (no credential material in the trail — SECRET rows are read-only presence, never UI-editable, so never produce an audit row)
- AC-7.LOG.005.1 (a payload that would carry a token/secret is redacted before write — upheld here by never writing SECRET-class values through Save)
- AC-7.ALR.009.1 (an unroutable `alert_routing_rules` edit is rejected on Save in `#observability`; the misconfigured-delivery banner surfaces loud on both surfaces)
- AC-7.ALR.008.2 (the alert-engine-stalled banner surfaces on both surfaces)
- AC-7.RTP.001.3 (no surface outside the two Realtime surfaces holds an open subscription — both config surfaces are static + on-demand)
- AC-NFR-A11Y.001.1, AC-NFR-A11Y.001.2 (keyboard-navigable, contrast baseline, semantic markup, labelled controls; status indicators not colour-only — the edit-class + Locked/Hard-limit badges carry a text cue)
- **Gating spikes (if any):** none. Both blockers (ISSUE-010, ISSUE-077) are build issues, not OD-157 spikes; no launch-gating AF gates this leaf surface slice.

## 5. Touches (complete blast radius, by ID)
- **DATA:** `config_values` (`.key` / `.value` / `.updated_at` / `.updated_by` — read all sections, write on Save), `secret_manifest` (`.key` / `.present` / `.last_rotated` — read-only `#secrets`), `config_audit_log` (`.key` / `.old_value` / `.new_value` / `.actor_id` / `.changed_at` — append on Save; read on surface-01b), `profiles`/`users` (resolve `actor_id`/`updated_by` → name + role-at-time; tombstoned → "redacted (erased user)").
- **PERM:** `PERM-config.auth`, `PERM-config.memory`, `PERM-config.tools`, `PERM-config.prompts`, `PERM-config.loops`, `PERM-config.guardrails`, `PERM-config.observability`, `PERM-config.agents`, `PERM-config.proactive`, `PERM-config.infra` (Super Admin only), `PERM-config.secrets` (Super Admin only, read-only), `PERM-guardrail.edit_autonomy` (no configurable row post-OD-161), `PERM-compliance.download_records` (export gate on surface-01b).
- **CFG:** every scalar/object/secret key in `config-registry.md` groups A–N is rendered/edited here (the surface is the registry's edit face). Cross-cutting keys with special handling: `embedding_model` (REBUILD), `action_autonomy_matrix` (locked, OD-161), `alert_routing_rules` + `escalation_contacts` + `quiet_hours` (resolvability validation, FR-7.ALR.009), `deployment_region` (v1-locked), `slack_token_rotation_enabled` (irreversible confirm), the **seven hard limits** (read-only, "Hard limit — not editable" — ADR-007/OD-047/OD-060, enumerated below). surface-01b reads `event_log_retention_window` + `individual_deletion_audit_years` read-only as retention context.
  - **The seven hard limits (ADR-007/OD-047/OD-060, design L2053–2066):** never autonomously (1) send external email · (2) make a financial transaction · (3) delete a system-of-record record · (4) share data across client deployments · (5) impersonate a named human · (6) self-approve a queued action · (7) treat monitored tool content as instructions. These are code-enforced prohibitions, not `config_values` rows — so by definition they are never editable and never appear as knobs; the surface renders any hard-limit key that accidentally lands in `config_values` read-only with the "Hard limit — not editable" badge (no save control, server-reject on write) as a defensive fallback (surface-01 Hard-limits note).
- **UI:** `UI-config-admin` (surface-01), `UI-config-audit-log` (surface-01b).
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/03-surfaces/surface-01-config-admin.md — the 11 sections, every key's data binding + edit class + cross-constraint, the Access/Layout/Save rules, all five states, OD-098–103.
- spec/03-surfaces/surface-01b-config-audit-log.md — the timeline/detail/export sections, key-prefix scope, the two loud banners, all five states, OD-153–156.
- spec/01-requirements/component-07-observability.md — FR-7.LOG.008 (+ .005 credential-redaction) text + ACs; FR-7.ALR.008/009 (banner ACs); FR-7.RTP.001 (no-subscription rule).
- spec/02-config/config-registry.md — the canonical per-key `What it does (plain English)` text (bound DRY as helper lines), edit class, PERM gate, and the `PERM-config.*` group→section map (groups A–N).
- spec/04-data-model/schema.md §8 (Observability) — `config_audit_log`; §12 (Config cluster) — `config_values` + `secret_manifest`; §"Immutability enforcement" — the append-only guarantee the surface must not attempt to violate.
- spec/05-non-functional/observability.md §NFR-A11Y.001 — the accessibility baseline floor + its ACs.
- spec/00-foundations/standards/config-edit-taxonomy.md — the LIVE/BOOT/REBUILD/SECRET edit classes + rule 2 (SECRET never UI-editable) + rule 4 (every editable change audited who/when/old→new).
- spec/00-foundations/adr/ADR-004-concurrency-model.md, spec/00-foundations/adr/ADR-006-rls-dynamic-roles.md, spec/00-foundations/adr/ADR-007-injection-posture.md — actor attribution, key-prefix RLS, hard-limits-are-not-knobs (+ `injection_semantic_detection` off by default). The seven hard limits are enumerated by name in field 5; OD-047/OD-060 (in `spec/00-foundations/open-decisions.md`) hold the keep-absolute / no-runtime-override resolutions.

## 7. Dependencies
- **Blocked-by:** ISSUE-010 (config store + `secret_manifest` + `config_audit_log` immutability + key-prefix RLS + export contract — this surface reads/writes/renders what ISSUE-010 stands up), ISSUE-077 (log retention/export + mgmt-plane views — the sibling three-sink retention/export contract + the C7 dashboard-view posture surface-01b's read/export contract sits inside). Neither is an OD-157 spike.
- **Blocks:** none (leaf).

## 8. Build order within the slice
1. Confirm the ISSUE-010 backbone is in place — `config_values` / `secret_manifest` / `config_audit_log` tables, the append-only trigger, the key-prefix RLS policy, and the server-side complete export read exist and are queryable; this slice renders + writes into them, it does not create them.
2. Build the Config Admin shell (surface-01): the "System Config" top-level nav item, the section rail rendering **only** the caller's PERM-covered sections (entry requires ≥1 `PERM-config.*`; `#infra`/`#secrets` Super-Admin-only), the sticky header + "Unsaved changes" badge.
3. Render each section's rows from `config_values`, binding the plain-English helper line DRY to `config-registry.md` (a key with no registry description is a registry defect, not a surface fallback); render the edit-class badge and the read-only Locked/Hard-limit badges (hard-limit keys, `action_autonomy_matrix` OD-161, `deployment_region` v1-lock).
4. Wire per-section Save (OD-103): validate all LIVE/BOOT rows + the section's cross-constraints; on a dirtied-BOOT batch show the redeploy confirm (OD-101); on REBUILD (`embedding_model`) always confirm; write passing rows to `config_values`; **append the `config_audit_log` row (key/old→new/actor/changed_at)** — reject at server any locked/hard-limit/floored downgrade.
5. Build `#secrets` as a read-only `secret_manifest` presence + `last_rotated` view (never a value, no save); build `#observability` `alert_routing_rules`/`escalation_contacts`/`quiet_hours` validation (resolvable route per FR-7.ALR.009, non-empty contacts, critical-never-suppressed).
6. Build the audit-log surface (surface-01b): Section A timeline (key-prefix-scoped, newest-first, section/key/actor/date filters, on-demand refresh — no Realtime), Section B change-detail drawer (old→new diff, actor + role, timestamp, class, tamper-evidence indicator), the "Edit this config →" link back to surface-01 at the owning section, and the two pinned loud banners (AC-7.ALR.008.2 / AC-7.ALR.009.1).
7. Build Section C Compliance Export: `PERM-compliance.download_records`-gated, scoped to the exporter's key-prefix set, calling ISSUE-010's complete-or-fail server read; render all-or-nothing (Partial = N/A → Error state), disable offline.
8. Implement every section's five states (Loading/Empty/Error/Partial/Offline) — enforce the #3 disciplines: audit Empty distinguishes "brand-new, no changes yet" from "filtered/permitted-empty" and never from a failed load; partial config load disables Save (never overwrite good values with empty).
9. Add the mobile degradation banners (OD-100) and run the a11y baseline (NFR-A11Y.001: keyboard nav, contrast, semantic markup, labelled controls, non-colour-only status).
10. Test to each AC in field 4 across both surfaces (write path + audit render/export path).

## 9. Verification (how DoD is proven)
- **Surface / integration layer** (per spec/05-non-functional/test-strategy.md): a Save on each section validates + persists to `config_values` + appends a `config_audit_log` row (who/when/old→new); a locked/hard-limit/floored row is server-rejected on write — proves the write side of AC-7.LOG.008.3 and the OD-161/ADR-007 floors.
- **Audit render / #3:** a forced `config_audit_log` read failure renders "Couldn't load the config change history" + retry, never an empty timeline; a brand-new deployment renders the explicit no-changes-yet empty, distinct from a permitted-but-filtered-empty — proves the audit-view #3 discipline behind AC-7.LOG.008.1's spirit.
- **Export:** a `PERM-compliance.download_records` holder exports the key-prefix-scoped range and receives every row or a loud failure (no silent short file); a non-holder has no export action — AC-7.LOG.008.1.
- **PERM scoping (#2):** a caller holding only one `PERM-config.*` node sees only that section on surface-01 and only that section's rows on surface-01b; `#infra`/`#secrets` never render for a non-Super-Admin — the key-prefix RLS backstop (ADR-006).
- **Credential safety (#1/#2):** a `#secrets` row renders presence + last-rotated only and offers no save; no SECRET value ever reaches `config_audit_log` — AC-7.LOG.008.5 / AC-7.LOG.005.1.
- **Loud banners + no-subscription:** the alert-engine-stalled and alert-delivery-misconfigured banners render on both surfaces (AC-7.ALR.008.2 / AC-7.ALR.009.1); neither surface opens a Realtime subscription (AC-7.RTP.001.3).
- **A11y:** the build-time a11y audit passes for both surfaces (keyboard-navigable, contrast, semantic markup, labelled controls, non-colour-only status) — AC-NFR-A11Y.001.1/.2. The AC→`Verified` path for each AC runs once its layer's test is green.
