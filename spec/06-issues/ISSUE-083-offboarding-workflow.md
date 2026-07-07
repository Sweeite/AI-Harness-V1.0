---
id: ISSUE-083
title: Client offboarding workflow (export-verified → sign-off → freeze → hard-delete → meta-record)
epic: K — infra & compliance
status: ready
github: "#83"
---

# ISSUE-083 — Client offboarding workflow (export-verified → sign-off → freeze → hard-delete → meta-record)

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Build the five-step, fail-closed client-offboarding state machine on the management plane — Super-Admin trigger → verified-complete export + encrypted delivery + client sign-off → retention-freeze → atomic-or-escalate hard-delete + deprovision → compliance meta-record — so a torn-down client is *provably, airtight-ly* gone with knowledge exported intact first, no partial-silent deprovision, and no silent completion without evidence.

## 2. Scope — in / out
**In:**
- The Super-Admin-only offboarding trigger that moves `client_registry.status` → `offboarding`, records `offboarding_at`, surfaces a contract-end prompt but never auto-executes (FR-10.OFF.001).
- The full verified-complete export (all listed client tables, JSON **and** CSV), row-count/checksum reconciliation against the live tables, and the fail-closed verification gate — anything short of an affirmative PASS blocks destruction (FR-10.OFF.002 + NFR-CMP.009 all-or-nothing).
- Encrypted, time-limited (signed-URL) delivery + reissue-on-expiry + client receipt sign-off (`export_acknowledged_at`) as a hard gate before the retention clock; a failed ack-write surfaces as a defect, not client latency (FR-10.OFF.003).
- The retention-freeze state: set `client_registry.status = frozen`, propagate `deployment_settings.frozen_at` into the client's own Supabase via the custodied `service_role` key, hold in `freeze_pending` (retry+escalate) if that cross-project write cannot be confirmed, and unfreeze-in-reverse on in-window reactivation (FR-10.OFF.004 — *this issue owns the management-plane write of the freeze flag*).
- The atomic-or-escalate hard-delete + deprovision sequence (Supabase truncate/drop + project deprovision → Railway deprovision → credential hard-delete → connector OAuth revoke via C3 → `internal_token` revoke-first → off-platform backup flagged for purge), each sub-step idempotent + result-recorded, `deletion_failed` on any partial, never auto-rolled-back, meta-record + per-system status written to the **management plane before** each destructive step (FR-10.OFF.005).
- The management-plane compliance meta-record (nine fields + `systems_deprovisioned[]` + `tokens_revoked[]`), no client business data, escalate-if-unwritten (FR-10.OFF.006).
- Second-authoriser requirement on the sensitive deletion (NFR-SEC.015) applied to the Step-4 hard-delete confirmation.

**Out:**
- The **C5 dispatch-side enforcement** of the freeze (the trigger/queue/loop gate that *reads* `deployment_settings.frozen_at` and fails closed): **ISSUE-047** owns AC-5.TRG.001.3 / NFR-INF.012; this issue *writes* the flag it reads.
- The `client_registry` schema, ingest endpoint, and `internal_token` mint/dual-store lifecycle: **ISSUE-012** (MGT). This issue *consumes* the registry + calls the MGT.004.3 revoke.
- The off-platform backup's own hourly dump / restore / actual purge mechanics: **ISSUE-085** (backup & DR, ADR-008). This issue only *raises* the purge flag and tracks it until acknowledged.
- Connector OAuth-token revocation runtime (the endpoints themselves): **ISSUE-033** (C3 TOK). This issue *invokes* them during Step 4.
- Individual right-to-erasure (per-person, transitive C2 delete, per-record backup-purge flag): **ISSUE-082** (DEL) — a distinct workflow; offboarding purges the client's *entire* backup, not a per-record flag.
- All rendering of the offboarding wizard: **Phase 3** (`UI-offboarding-wizard`). This issue owns the workflow + state contract only.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-10.OFF.001, FR-10.OFF.002, FR-10.OFF.003, FR-10.OFF.004, FR-10.OFF.005, FR-10.OFF.006 (all Component 10 — Infra & Compliance).
- **NFRs:** NFR-CMP.008 (offboarding sequence), NFR-CMP.009 (export all-or-nothing), NFR-INF.013 (deprovision completeness), NFR-SEC.015 (two-person authorization for sensitive deletion). *(NFR-INF.012 freeze-gate-fails-closed is enforced in ISSUE-047; this issue satisfies its precondition by writing the flag.)*
- **Rests on:** ADR-001 §3/§7 (physical isolation → deprovision = airtight deletion evidence; management plane is the only home of `client_slug`), ADR-008 §2/§5 (off-platform backup engineered to survive project deletion → must be flagged for purge; Supabase project-status independently monitored), OD-089 (partial-deprovision → `deletion_failed`, no auto-rollback), OD-090 (export-verified-before-destroy hard gate), OD-091 (freeze needs an enforcement consumer), OD-162 (freeze flag is `deployment_settings.frozen_at`, written via custodied `service_role`), OD-010 (no auto-rollback of a deprovision); AF-132 (deprovision completeness), AF-133 (export integrity/readability at scale), AF-135 (freeze-propagation completeness).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-10.OFF.001.1, AC-10.OFF.001.2, AC-10.OFF.001.3 (FR-10.OFF.001 — Super-Admin trigger; RBAC-reject non-Super-Admin; contract-end prompts, never auto-executes)
- AC-10.OFF.002.1, AC-10.OFF.002.2, AC-10.OFF.002.3, AC-10.OFF.002.4 (FR-10.OFF.002 — JSON+CSV export; count/checksum reconcile; timestamped; verification-gate fails closed)
- AC-10.OFF.003.1, AC-10.OFF.003.2, AC-10.OFF.003.3, AC-10.OFF.003.4 (FR-10.OFF.003 — encrypted time-limited link; reissue-not-silently-dead; no-sign-off holds+escalates; ack-write-failure is a surfaced defect)
- AC-10.OFF.004.1, AC-10.OFF.004.2, AC-10.OFF.004.3, AC-10.OFF.004.4, AC-10.OFF.004.5 (FR-10.OFF.004 — freeze sets status + writes `frozen_at`; C5 gate blocks (verified in ISSUE-047, precondition here); reactivation unfreezes; frozen≠dead C7 staleness seam; `freeze_pending` on unconfirmed cross-project write)
- AC-10.OFF.005.1, AC-10.OFF.005.2, AC-10.OFF.005.3, AC-10.OFF.005.4, AC-10.OFF.005.5, AC-10.OFF.005.6 (FR-10.OFF.005 — all systems deprovisioned+recorded; `deletion_failed` on partial + no auto-rollback; idempotent re-run; progress store in mgmt plane before each destructive step; `internal_token` revoked-first; off-platform backup flagged for purge)
- AC-10.OFF.006.1, AC-10.OFF.006.2, AC-10.OFF.006.3 (FR-10.OFF.006 — nine-field meta-record; no client business data; escalate-if-unwritten)
- AC-NFR-CMP.008.1, AC-NFR-CMP.008.2, AC-NFR-CMP.008.3, AC-NFR-CMP.008.4 (offboarding sequence, fail-closed)
- AC-NFR-CMP.009.1 (export never silently truncated)
- AC-NFR-INF.013.1, AC-NFR-INF.013.2 (deprovision completeness / partial escalates loud)
- AC-NFR-SEC.015.1, AC-NFR-SEC.015.2 (two-person auth on the Step-4 sensitive deletion)
- **Gating spikes (if any):** all three are build-time SPIKEs per `spec/05-non-functional/test-strategy.md` (not OD-157 launch spikes, so not a separate ISSUE-00x): **AF-133 GREEN** (export integrity + readable/re-importable at scale) before FR-10.OFF.002/003 ships; **AF-135 GREEN** (freeze propagates to every dispatch path) before the freeze in FR-10.OFF.004 is trusted — proven jointly with ISSUE-047's dispatch gate; **AF-132 GREEN** (end-to-end deprovision completes on every system — Supabase + Railway + connector revoke + off-platform backup purge) before FR-10.OFF.005 ships.

## 5. Touches (complete blast radius, by ID)
- **DATA:** `client_registry` (`.status`, `.offboarding_at`, `.offboarding_initiated_at`, `.internal_token`), `offboarding_records` (all nine fields + `.systems_deprovisioned[]` + `.tokens_revoked[]`), `deployment_settings.frozen_at` / `.frozen_reason` (written into the client's own Supabase via custodied `service_role`); reads all client-silo tables for the export (`memories`, `entities`, `event_log`, `guardrail_log`, `task_queue`, …); the client-silo credential stores hard-deleted at Step 4 — **`connector_credentials`** (OAuth tokens) and **`webhook_secrets`** (webhook-verification secrets), the two real named stores in `schema.md` §11/§9. *(The FR-10.OFF.005 statement, its data-touched line, and the `offboarding_records.systems_deprovisioned` comment all say "credentials / the credentials table" as a **role name**, not a table — there is **no** `create table credentials` in `schema.md`. Build the discrete hard-delete sub-step against `connector_credentials` + `webhook_secrets`; the Supabase truncate/drop + project-deprovision in the same Step-4 sequence already removes every silo-resident secret, so the discrete sub-step is the belt-and-braces explicit purge of these two named tables, not a separate store. `internal_token` is **not** part of this sub-step — it lives on the management plane and is revoked-first per AC-10.OFF.005.5 / MGT.004.3.)* *(`client_status` enum: `offboarding` / `frozen`; the `freeze_pending` sub-state and `deletion_failed` state are workflow states this issue must add per AC-10.OFF.004.5 / AC-10.OFF.005.2 — see Build order step 5.)*
- **PERM:** `PERM-config.infra` (Super Admin — offboarding initiation, freeze/unfreeze, final destruction confirm). Second-authoriser identity per NFR-SEC.015 on the Step-4 confirm.
- **CFG:** `CFG-data_export_link_expiry_hours` (default 72), `CFG-client_offboarding_retention_days` (default 90).
- **UI:** `UI-offboarding-wizard` (Phase 3 — renders this state machine; not built here).
- **Connectors:** GHL / Google / Slack — OAuth revocation endpoints invoked at Step 4 via C3 FR-3.TOK.* (ISSUE-033).

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-10-infra-compliance.md — the OFF FR text + ACs (OFF.001–006), and MGT.004 (§`internal_token` revoke-on-offboard) + ISO.002 (airtight-deletion-evidence claim this workflow proves).
- spec/05-non-functional/compliance.md — NFR-CMP.008 (offboarding sequence) + NFR-CMP.009 (export all-or-nothing).
- spec/05-non-functional/infrastructure.md — NFR-INF.013 (deprovision completeness) + NFR-INF.012 (freeze-gate posture, the ISSUE-047 consumer this issue feeds).
- spec/05-non-functional/security.md — NFR-SEC.015 (two-person authorization for sensitive deletion).
- spec/05-non-functional/test-strategy.md — the **build-time-SPIKE** definitions of the three gating spikes named in fields 4 and 9: AF-132 (offboarding deprovision completeness), AF-133 (export integrity/readability at scale), AF-135 (freeze-propagation completeness). Read here for what "GREEN" means and why these are build-time POSTURE/FAST-FOLLOW gates, not OD-157 launch spikes.
- spec/01-requirements/component-05-harness.md — AC-5.TRG.001.3 (the C5 freeze-gate consumer contract, so the flag this issue writes is written the way the gate reads it — OD-162).
- spec/04-data-model/schema.md §13 (Management plane — `client_registry`, `offboarding_records`) + §14 (Compliance workflow — `deployment_settings`; `deletion_requests` two-person-auth pattern to mirror for NFR-SEC.015) + §Types (`client_status` enum). *(The two CFG keys — `CFG-data_export_link_expiry_hours` = 72, `CFG-client_offboarding_retention_days` = 90 — are **defined in component-10 FR-10.RET.002**, already named above, not in schema §12.)*
- spec/00-foundations/adr/ADR-001-account-ownership.md §3/§7 (isolation + management plane) and spec/00-foundations/adr/ADR-008-*.md §2/§5 (off-platform backup survives deletion; project-status monitored) — the architectural spine.

## 7. Dependencies
- **Blocked-by:** ISSUE-012 (management-plane bootstrap — `client_registry` + ingest endpoint + `internal_token` lifecycle this workflow drives), ISSUE-085 (backup & DR — the off-platform backup Step 4 flags for purge; without it there is no backup to flag), ISSUE-047 (C5 triggers + deployment-freeze gate — the dispatch-boundary enforcement consumer of the `frozen_at` flag this issue writes; FR-10.OFF.004's freeze is a label without it). *(None is an OD-157 launch spike; the SPIKEs this issue rests on — AF-132/133/135 — are build-time gates named in field 4, not blocked-by issues.)*
- **Blocks:** none (leaf).

## 8. Build order within the slice
1. **Trigger (Step 1):** the Super-Admin-only initiation on the management plane — set `client_registry.status = offboarding`, record `offboarding_at` / `offboarding_initiated_at`; RBAC-reject non-Super-Admin; contract-end date surfaces a prompt only (FR-10.OFF.001 → AC-10.OFF.001.1/.2/.3). Log to management-plane + `event_log`.
2. **Export + verify (Step 2):** stream/chunk every listed client table to JSON **and** CSV; reconcile row-counts/checksums against the live tables; make the verification gate fail closed — error/timeout/indeterminate = block+escalate, only an affirmative PASS advances (FR-10.OFF.002 + NFR-CMP.009 → AC-10.OFF.002.1–.4, AC-NFR-CMP.009.1, AC-NFR-CMP.008.1) → **AF-133**.
3. **Deliver + sign-off (Step 2 cont.):** encrypt + serve behind a `CFG-data_export_link_expiry_hours` signed URL; surface expired-unused links for reissue; require `export_acknowledged_at` before the retention clock; treat an ack-write failure as a surfaced defect, not "not yet acknowledged" (FR-10.OFF.003 → AC-10.OFF.003.1–.4).
4. **Freeze (Step 3):** set `client_registry.status = frozen`; write `deployment_settings.frozen_at` into the client's own Supabase via the custodied `service_role` key; hold in `freeze_pending` (retry+backoff, escalate past window) if that write can't be confirmed; unfreeze-in-reverse on in-window reactivation; expose `client_registry.status` for C7's staleness path so frozen reads as expected-quiet, not green and not a dead-deployment alarm, while Supabase project-status is still independently monitored (FR-10.OFF.004 → AC-10.OFF.004.1/.3/.4/.5; AC-10.OFF.004.2 verified in ISSUE-047) → **AF-135**, OD-162. *(This step writes the flag; ISSUE-047's C5 gate reads it — coordinate on the AC-5.TRG.001.3 contract.)*
5. **Add the workflow states:** extend the offboarding state model with `freeze_pending` (AC-10.OFF.004.5) and `deletion_failed` (AC-10.OFF.005.2) — either as offboarding-workflow states tracked in `offboarding_records`/registry or an enum extension; keep `client_status` server-authoritative.
6. **Hard-delete + deprovision (Step 4):** require the second authoriser (NFR-SEC.015, mirror the `deletion_requests` three-distinct-identity CHECK pattern); run the sequence — **`internal_token` revoke first** (MGT.004.3, independently re-driven) → Supabase truncate/drop + project deprovision → Railway deprovision → hard-delete the client-silo credential stores `connector_credentials` + `webhook_secrets` (the two real named tables — there is no `credentials` table; see field 5 DATA) → connector OAuth revoke via C3 (ISSUE-033) → **off-platform backup flagged for purge** (ADR-008, tracked-until-acknowledged); each sub-step idempotent + result-recorded to the **management plane before** the next destructive step; any partial → `deletion_failed` + per-system status + escalation, never auto-rolled-back (FR-10.OFF.005 + NFR-INF.013 → AC-10.OFF.005.1–.6, AC-NFR-INF.013.1/.2, AC-NFR-CMP.008.3, AC-NFR-SEC.015.1/.2) → **AF-132**.
7. **Meta-record (Step 5):** write the `offboarding_records` compliance meta-record (nine fields + `systems_deprovisioned[]` + `tokens_revoked[]`) to the management plane; no client business data; reference the client by `client_registry` identity (the sole valid `client_slug` use); a completed deletion whose meta-record fails to write does **not** report complete — it escalates (FR-10.OFF.006 → AC-10.OFF.006.1/.2/.3, AC-NFR-CMP.008.4).
8. **Test to each AC in field 4** across the happy path and the fail-closed branches (unverified export, no sign-off, unconfirmed freeze write, partial deprovision, unwritten meta-record).

## 9. Verification (how DoD is proven)
- **Sequence/gate (integration):** per spec/05-non-functional/test-strategy.md — drive the full state machine and prove no destruction runs without a verified-complete export **and** `export_acknowledged_at` (AC-NFR-CMP.008.1, AC-10.OFF.002.2/.4, AC-10.OFF.003.3); RBAC rejects a non-Super-Admin trigger (AC-10.OFF.001.2); the Step-4 confirm requires a distinct second authoriser (AC-NFR-SEC.015.1/.2).
- **Export integrity:** a forced shortfall in an export path fails loud with no "complete" claim (AC-NFR-CMP.009.1, AC-10.OFF.002.1/.3) — scale/readability is the **AF-133** SPIKE.
- **Freeze:** setting `frozen` writes `deployment_settings.frozen_at` into the client's own Supabase; an unconfirmable cross-project write holds `freeze_pending` and escalates (AC-10.OFF.004.1/.5); C7's staleness path reads `status` and shows frozen as expected-quiet, not green, not dead-alarm (AC-10.OFF.004.4). The dispatch-boundary block itself (AC-10.OFF.004.2 / AC-NFR-INF.012.*) is proven in **ISSUE-047** against the flag this issue writes — the **AF-135** SPIKE covers propagation completeness across both.
- **Deprovision:** every sub-step deletes/revokes + records; a partial stops in `deletion_failed` with per-system status + loud escalation, no auto-rollback, and a re-run is idempotent to completion; `internal_token` is revoked first; the off-platform backup is flagged and tracked (AC-10.OFF.005.1–.6, AC-NFR-INF.013.1/.2, AC-NFR-CMP.008.3) — end-to-end completeness is the **AF-132** SPIKE.
- **Evidence:** the meta-record is written to the management plane with all fields and no client data; an unwritten meta-record escalates rather than reporting "done" (AC-10.OFF.006.1/.2/.3, AC-NFR-CMP.008.4). The AC→`Verified` path for FR-10.OFF.002/004/005 runs once AF-133 / AF-135 / AF-132 are GREEN respectively.
