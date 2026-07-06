---
id: ISSUE-012
title: Management-plane bootstrap — client_registry + ingest + health push
epic: A — foundations
status: done
github: "#12"
---

# ISSUE-012 — Management-plane bootstrap — client_registry + ingest + health push

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Stand up the operator's management-plane deployment — the `client_registry` (the single home of
client identity), the `internal_token`-authenticated ingest endpoint, and the per-deployment
outbound health-reporter push that feeds it — so the fleet is observable end-to-end (push, never
pull; operational-metadata-only).

## 2. Scope — in / out
**In:** The management-plane half of ADR-001 §7, both ends of the push seam:
- The **management deployment's** own tables — `client_registry` (client identity + status
  lifecycle) and the push-fed `deployment_health` operational-metadata store — plus the
  `internal_token` lifecycle (mint → dual-store → rotate → revoke).
- The **ingest endpoint** on the management plane: per-deployment `internal_token` bearer auth,
  operational-metadata-only payload validation (business-data rejected at the boundary), idempotent
  re-delivery, and the `client_registry` + `deployment_health` write.
- The **outbound health-reporter job** that runs inside each client deployment and posts its
  operational-metadata snapshot to the ingest endpoint, logging each push attempt/failure to the
  deployment's *local* `event_log`.
- The **push-staleness detector** (stale-not-green; independent-heartbeat evaluator;
  server-authoritative time) and the **frozen-≠-dead** reconciliation on the staleness path.
- The thin cross-deployment read contracts consumed by the Super Admin view — the health grid, the
  cross-deployment/CI-CD alert surface, and the backup-health + cost overview — as **data
  contracts** (which store field feeds which card). This slice owns the *contract*; the **screens**
  are Phase 3.

**Out:**
- **Provisioning orchestration** (the script that mints the token / inserts the `client_registry`
  row at first boot, per-client OAuth apps, canary fixture, client-side runbook) → **ISSUE-007**
  (FR-10.PRV.*). This slice defines the `internal_token` *lifecycle states* + the registry schema
  it writes into; ISSUE-007 drives the *provisioning* that first populates them.
- **The `event_log` schema + the base observability skeleton / alert-engine watchdog** the reporter
  and staleness detector reuse → **ISSUE-011** (C7 LOG/ALR core). This slice consumes them.
- **All dashboard rendering** — the Super Admin fleet console, the health grid screen, the version
  grid — → **ISSUE-078** (surface-05/06) and the retention/export + management-plane *views* →
  **ISSUE-077** (C7 MGM/VIEW render). This slice stops at the data contract.
- **Version reporting + max-skew alert, offboarding freeze-write, offboarding meta-record** — these
  *read/write* `client_registry`/`deployment_health` but are owned by **ISSUE-080** (C10 DEP),
  **ISSUE-083** (C10 OFF), **ISSUE-085** (backup-health push detail). `client_registry.status`
  values `offboarding`/`frozen` are defined here as the lifecycle enum; the transitions *into* them
  are driven by those issues.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:**
  - FR-10.MGT.001, FR-10.MGT.002, FR-10.MGT.003, FR-10.MGT.004 (component-10 infra & compliance)
  - FR-7.MGM.001, FR-7.MGM.002, FR-7.MGM.003, FR-7.MGM.004, FR-7.MGM.005 (component-07 observability)
- **NFRs:** NFR-SEC.002 (management-plane boundary), NFR-INF.010 (health-reporter push +
  `internal_token`-authed ingest), NFR-OBS.006 (management-plane staleness)
- **Rests on:** ADR-001 §3 (client_slug only in the registry) + §7 (push-not-pull,
  operational-metadata-only boundary); ADR-008 (backup-health via Supabase Management API, referenced
  only); ADR-003 (cost figures estimate-grade, for the cost overview); OD-071 (stale-not-green),
  OD-162 (`client_registry.status` server-authoritative source-of-truth). ⚠️ FEASIBILITY:
  **AF-118** (absence-of-signal detection is only as live as its evaluator — gates the staleness
  heartbeat), **AF-120** (cross-deployment clock-sync for the staleness window), **AF-139**
  (out-of-band external monitor for the management plane itself — build-time residual, not yet an FR).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-10.MGT.001.1, AC-10.MGT.001.2, AC-10.MGT.001.3
- AC-10.MGT.002.1, AC-10.MGT.002.2, AC-10.MGT.002.3
- AC-10.MGT.003.1, AC-10.MGT.003.2
- AC-10.MGT.004.1, AC-10.MGT.004.2, AC-10.MGT.004.3
- AC-7.MGM.001.1, AC-7.MGM.001.2, AC-7.MGM.001.3
- AC-7.MGM.002.1, AC-7.MGM.002.2, AC-7.MGM.002.3, AC-7.MGM.002.4
- AC-7.MGM.003.1, AC-7.MGM.003.2
- AC-7.MGM.004.1, AC-7.MGM.004.2
- AC-7.MGM.005.1, AC-7.MGM.005.2
- AC-NFR-SEC.002.1, AC-NFR-SEC.002.2, AC-NFR-SEC.002.3
- AC-NFR-INF.010.1, AC-NFR-INF.010.2
- AC-NFR-OBS.006.1, AC-NFR-OBS.006.2, AC-NFR-OBS.006.3
- **Gating spikes (if any):** none launch-gating (blocked-by ISSUE-008/011 are both Epic-A
  foundations, not OD-157 spikes). Build-time feasibility to hold before ship: **AF-118** +
  **AF-120** (staleness evaluator liveness + clock-sync) per the DoD notes above; **AF-139** logged
  as a build-time residual (external monitor of the management plane itself), not a gate on this
  slice's ACs.

## 5. Touches (complete blast radius, by ID)
- **DATA:** `client_registry` (schema.md §13 — id, client_slug, client_name, railway_url,
  internal_token[encrypted], core_version, region, status[`client_status` enum], created_at,
  offboarding_initiated_at, offboarding_at); `deployment_health` (schema.md §13 — push-fed
  operational-metadata store: health_score, queue_depth, approval_queue_depth, alert_counts,
  core_version, last_migrated_at, connector_rollup, cost_to_date, plugin_version, backup_health,
  log_write_failing, last_push_at, updated_at); reads/writes the deployment-local `event_log` for the
  reporter push-attempt log (AC-7.MGM.001.3 — schema owned by ISSUE-011).
- **PERM:** management-plane operator RBAC (client-side C1 roles gate click-through, not the
  management plane itself); per-deployment `internal_token` (bearer) is the ingest credential.
- **CFG:** the reporter push cadence — governed by NFR-INF.010 (**interval + event-driven**; the push
  is *also* fired on significant events, so no single interval key gates it) with the per-deployment
  interval read from the client config's polling-cadence family (config-registry Group J,
  `polling_interval_health_metrics_s` default 30s, LIVE; per FR-7.RTP.002 "all polling intervals
  configurable per deployment"); and the read/staleness window `deployment_staleness_window`
  (config-registry Group J, default **15 min**, LIVE, validation *duration ≥ push interval* —
  server-authoritative, NFR-OBS.006). `realtime_connection_headroom_threshold` is **not** in scope
  (RTP, ISSUE-076). *(There is no config key literally named `health_poll_interval`; the earlier
  `CFG-health_poll_interval` reference was a placeholder and is retired — cite the two real keys above.)*
- **UI:** none built here (data contracts only). Consumed by `UI-dashboard-super-admin` (health grid,
  cross-deployment alerts, CI/CD status, cost overview) — rendered in ISSUE-078.
- **Connectors:** none (backup-health reads the Supabase Management API, `GET /v1/projects/{ref}/database/backups`,
  which is infra-plane, not a client connector).

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/01-requirements/component-10-infra-compliance.md` — FR-10.MGT.001–004 (text + ACs); its
  Context manifest + the MGT area seams.
- `spec/01-requirements/component-07-observability.md` — FR-7.MGM.001–005 (text + ACs);
  reconciliation #2 (push, operational-metadata-only) + OD-071.
- `spec/04-data-model/schema.md` §13 (Management plane — `client_registry`, `deployment_health`,
  `offboarding_records`) + §Global rules (the `client_slug`-confined-to-management-plane rule).
- `spec/05-non-functional/security.md` §NFR-SEC.002 (management-plane boundary).
- `spec/05-non-functional/infrastructure.md` §NFR-INF.010 (health-reporter push + ingest auth).
- `spec/05-non-functional/observability.md` §NFR-OBS.006 (management-plane staleness).
- `spec/02-config/config-registry.md` §J (Observability) — the two CFG touchpoints this slice reads:
  `deployment_staleness_window` (15 min, LIVE, *duration ≥ push interval*) and the reporter push
  cadence via `polling_interval_health_metrics_s` (30s, LIVE).
- `spec/01-requirements/component-07-observability.md` §FR-7.RTP.002 (per-deployment polling cadences —
  the FR that makes the reporter push interval configurable per deployment; already opened above for
  FR-7.MGM.001–005).
- `spec/00-foundations/adr/ADR-001-isolation-model.md` — §3 (`client_slug` only in the registry) +
  §7 (push-not-pull, operational-metadata-only, the management plane is a map not a warehouse).

## 7. Dependencies
- **Blocked-by:** ISSUE-008 (migration harness + 0001 baseline — needed to author the §13 tables),
  ISSUE-011 (observability skeleton — `event_log` append-only + the alert-engine watchdog the
  staleness detector/reporter reuse). Neither is an OD-157 spike, so no AF-GREEN gate applies.
- **Blocks:** ISSUE-077 (log retention/export + management-plane views + feedback flywheel),
  ISSUE-083 (client offboarding — writes `client_registry.status` transitions + meta-record),
  ISSUE-085 (backup & DR — backup-health push).

## 8. Build order within the slice
1. **Management-plane schema (migration, expand-only per ISSUE-008 harness):** create `client_registry`
   + `deployment_health` in the management deployment's own Supabase (schema.md §13). Confirm the
   `client_status` enum (`initialising | active | offboarding | frozen`) and that `client_slug` lives
   *only* here (§Global rules — the ADR-001 §3 invariant; FR-10.ISO.001 is its client-side inverse,
   owned by ISSUE-084 — do not add `client_slug` to any app table).
2. **`internal_token` lifecycle (FR-10.MGT.004):** mint + dual-store (management DB encrypted +
   deployment Railway env), rotate (atomic dual-update, surface a mismatch), revoke. The *minting at
   provisioning* is invoked by ISSUE-007; wire the lifecycle state machine + the encrypted-at-rest
   store here (AC-10.MGT.001.3 / AC-10.MGT.004.*).
3. **Ingest endpoint (FR-10.MGT.002 + NFR-SEC.002 + NFR-INF.010):** bearer-validate the
   `internal_token` (reject + log + alert anonymous/invalid — AC-10.MGT.002.2 / AC-NFR-SEC.002.2);
   validate the payload against the operational-metadata allow-list, **rejecting any business-data
   field at the boundary** (AC-NFR-SEC.002.1 — this is the #2 boundary); idempotent on re-delivery;
   write `client_registry.core_version` + upsert `deployment_health`. No pull path — the stale
   `/api/internal/status` design reference (L1170–1190) is superseded (AC-10.MGT.002.3).
4. **Outbound health-reporter (FR-7.MGM.001):** the per-deployment job that assembles the
   allow-listed snapshot and POSTs it to the ingest endpoint **on interval + on significant events**
   (NFR-INF.010 / AC-NFR-INF.010.1) — the interval read per-deployment from the client config's
   polling-cadence family (config-registry Group J `polling_interval_health_metrics_s`, default 30s;
   FR-7.RTP.002), and the downstream `deployment_staleness_window` (Group J, 15 min) must stay
   *≥ push interval*; enforce the allow-list at the reporter too (AC-7.MGM.001.1, defence-in-depth
   with step 3); log every push
   *attempt and failure* to the deployment-**local** `event_log` (AC-7.MGM.001.3), so a deployment
   that cannot reach the management plane surfaces it on its own dashboard.
5. **Push-staleness detector (FR-7.MGM.002 + NFR-OBS.006):** an **independent-heartbeat** evaluator
   (not a one-shot the receiver could miss — AC-7.MGM.002.3, AF-118) that flips a card to
   `stale`/`unreachable` past the configurable window and raises a cross-deployment alert; compute the
   window against a **single server-authoritative timestamp** (`deployment_health.last_push_at` vs
   server time — AC-7.MGM.002.4, AF-120). Reconcile **frozen ≠ dead**: a silo in
   `client_registry.status = frozen` reads *intentionally quiet*, not a dead-deployment alert
   (AC-NFR-OBS.006.3 / AC-10.OFF.004.4), while its underlying project status stays independently
   monitored.
6. **Push-only boundary (FR-10.MGT.003 + NFR-SEC.002):** assert the architectural invariant —
   operational metadata flows inbound only; "look inside a client" = click-through into that client's
   own deployment under *its* RBAC (AC-10.MGT.003.2 / AC-NFR-SEC.002.3); no path copies business data
   into the management store.
7. **Cross-deployment read contracts (FR-7.MGM.003/004/005):** map each Super Admin card to its
   `deployment_health` source field — health grid (AC-7.MGM.003.*), cross-deployment/CI-CD alert +
   version surface (AC-7.MGM.004.*, keyed on `core_version`/`last_migrated_at`/`plugin_version`),
   backup-health from the Supabase Management API + estimate-grade cost overview (AC-7.MGM.005.*,
   ADR-008/ADR-003). Contract only — screens are ISSUE-078.
8. **Tests to the ACs** (see Verification).

**Integration note (spans FR-10.MGT.002 ↔ FR-7.MGM.001, the two halves of ADR-001 §7):** the
operational-metadata allow-list is enforced on **both** sides — the reporter never *sends* a
business-data field (C7 side, AC-7.MGM.001.1) **and** the ingest re-validates and *rejects* one (C10
side, AC-10.MGT.002.x / AC-NFR-SEC.002.1). Build them together and test the seam end-to-end (valid
token + clean payload updates the registry+health store; invalid token rejected+logged+alerted;
business-data field rejected at ingest even if a rogue reporter sent it). `client_registry.status` is
**server-authoritative** — the staleness detector and the frozen-≠-dead reconciliation both read the
registry status, never a reporter-asserted value.

## 9. Verification (how DoD is proven)
- **Migration/schema test:** the §13 tables apply under the ISSUE-008 expand-contract harness against
  the management deployment's Supabase; `client_slug` is present only on management-plane tables
  (assert its absence in every client-silo app table — the ADR-001 §3 / schema §Global-rules trap).
- **Integration (the push seam, per `spec/05-non-functional/test-strategy.md`):** end-to-end
  reporter→ingest→store — valid-token clean-payload path (AC-10.MGT.002.1 / AC-NFR-INF.010.1);
  invalid/absent-token rejected+logged+alerted (AC-10.MGT.002.2 / AC-NFR-SEC.002.2 / AC-NFR-INF.010.2);
  business-data field rejected at the boundary on both reporter and ingest (AC-7.MGM.001.1 /
  AC-10.MGT.003.1 / AC-NFR-SEC.002.1); idempotent re-delivery does not double-count.
- **Staleness (absence-of-signal, the #3 posture):** a deployment that stops pushing flips to
  stale/unreachable within the window and raises an alert, never a carried-forward green
  (AC-7.MGM.002.1/.2 / AC-NFR-OBS.006.1); the evaluator runs on an independent heartbeat and surfaces
  its own stall (AC-7.MGM.002.3 — ⚠️ **AF-118** must be GREEN); window math uses server-authoritative
  time (AC-7.MGM.002.4 / AC-NFR-OBS.006.2 — ⚠️ **AF-120**); a `frozen` silo reads intentionally-quiet
  (AC-NFR-OBS.006.3).
- **`internal_token` lifecycle:** minted+dual-stored+encrypted authenticates a push; rotation updates
  both stores atomically (partial update surfaced); revocation blocks all further auth
  (AC-10.MGT.004.1/.2/.3, AC-10.MGT.001.3).
- **Boundary posture (AC-NFR-SEC.002.*):** the push payload contains only allow-listed operational
  fields and zero business-data fields; click-through routes into the client deployment under client
  RBAC. **AC→`Verified`** for this slice: each AC above maps to a test layer in `test-strategy.md`;
  AF-118/AF-120 must be GREEN (staleness liveness + clock-sync) before ship, and AF-139 (out-of-band
  external monitor of the management plane) is logged as a build-time residual carried past this slice.
