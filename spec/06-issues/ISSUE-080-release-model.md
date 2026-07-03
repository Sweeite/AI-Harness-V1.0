---
id: ISSUE-080
title: Release model — canary/train + rollback + skew
epic: K — infra & compliance
status: blocked
github: "#80"
---

# ISSUE-080 — Release model — canary/train + rollback + skew

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Stand up the core release train — Railway-native per-project auto-deploy (canary tracks `release`, fleet tracks `main`), an operator-promoted canary gate (tests + clean migration + smoke battery + soak), rollback-by-code-redeploy with schema rolling forward only, and the fleet version-skew alert — so no core change reaches a client silo without passing a human-gated canary and no laggard silo drifts silently.

## 2. Scope — in / out
**In:**
- The deploy primitive: each Railway project natively tracks + auto-deploys its branch (canary→`release`, fleet→`main`) and runs `drizzle-kit migrate` against its own Supabase on release; GitHub Actions is a **merge-gate test runner only, never a deployer** (FR-10.DEP.001).
- The canary + release-train **promotion gate**: `release`→canary→**fast-forward promote**→`main`; promotion refused unless tests green + clean canary migration + green smoke battery + elapsed `CFG-canary_soak_minutes` soak; promotion is a deliberate operator action in v1 (FR-10.DEP.002, OD-094).
- **Rollback = redeploy of the prior Railway build** (per-deployment or fleet); schema is never un-migrated — a bad schema change is corrected by a roll-forward migration (FR-10.DEP.003), resting on expand-contract (NFR-INF.002, owned by ISSUE-081).
- **Version reporting + max-skew alert**: each deployment reports `core_version` + last-migrated via the health push; a laggard past `CFG-deploy_max_version_skew` (default 3) or `CFG-deploy_max_skew_days` (default 14) fires a cross-deployment alert (FR-10.DEP.004, OD-095).
- **Plugins kept out of the release train**: a core push never touches `/plugins`; plugin version is reported per deployment so drift is visible (FR-10.DEP.005).

**Out:**
- **Per-deployment migrate-on-release mechanics + migration-failure isolation** (FR-10.MIG.001/002, expand-contract discipline NFR-INF.002/005): **ISSUE-081** owns these; this slice consumes them as the safety premise and is blocked-by 081's predecessor edges via the backlog.
- **The provisioning script, `client_registry` insert, Railway-link, `internal_token` mint, first-boot seed** (FR-10.PRV.*, FR-10.MGT.*): **ISSUE-007** (blocked-by) — this slice assumes a provisioned, registered fleet exists.
- **The synthetic canary corpus fixture + smoke-battery *authoring*** (FR-10.PRV.003 / NFR-INF.008): the fixture is seeded by ISSUE-007; this slice **wires the battery result as a promotion gate**, it does not author the corpus.
- **The management-plane fleet version grid + cross-deployment alert *rendering/delivery*** (C7 FR-7.MGM.003/004): C7 (ISSUE-012/077/078) owns the ingest + alert-fire + view; this slice produces the `core_version`/skew *signal*.
- **Client offboarding freeze / `frozen` status** (FR-10.OFF.004): ISSUE-083; `frozen ≠ stale skew` (NFR-INF.004 note).

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-10.DEP.001, FR-10.DEP.002, FR-10.DEP.003, FR-10.DEP.004, FR-10.DEP.005 (all Component 10 — Infrastructure & Compliance).
- **NFRs:** NFR-INF.001 (canary + operator-promoted train), NFR-INF.003 (rollback = redeploy prior build; schema forward-only), NFR-INF.004 (version-skew bounded + monitored), NFR-INF.008 (synthetic corpus + smoke battery as promotion gate), NFR-INF.009 (plugins out of train). *(NFR-INF.002 expand-contract is the safety premise this rests on but is implemented by ISSUE-081.)*
- **Rests on:** ADR-005 §1/§2/§3/§4/§6/§7 (Railway-native auto-deploy; canary/release-train; version-skew bound; rollback = redeploy; canary corpus + smoke gate; plugins out of train); ADR-001 §6 (no custom fan-out CI — N independent Railway subscriptions), ADR-001 §7 (push-based version reporting); AF-020, AF-064, AF-065, AF-066.

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-10.DEP.001.1, AC-10.DEP.001.2 (FR-10.DEP.001 — fleet auto-deploy + independent migrate; Actions gates, never deploys)
- AC-10.DEP.002.1, AC-10.DEP.002.2 (FR-10.DEP.002 — four-gate promotion; deliberate operator action in v1)
- AC-10.DEP.003.1, AC-10.DEP.003.2 (FR-10.DEP.003 — rollback redeploys prior build; roll-forward, no destructive down-migration)
- AC-10.DEP.004.1, AC-10.DEP.004.2 (FR-10.DEP.004 — version + last-migrated reported; over-skew fires alert)
- AC-10.DEP.005.1, AC-10.DEP.005.2 (FR-10.DEP.005 — `/plugins` untouched by a core push; plugin version reported)
- AC-NFR-INF.001.1, AC-NFR-INF.001.2 (canary-first; red-gate/incomplete-soak promotion refused + surfaced)
- AC-NFR-INF.003.1, AC-NFR-INF.003.2 (redeploy on unchanged forward-only schema; no down-migration script)
- AC-NFR-INF.004.1, AC-NFR-INF.004.2 (push carries `core_version` + last-migrated; over-skew/stale drift alert)
- AC-NFR-INF.008.1, AC-NFR-INF.008.2 (battery exercises boot/migration/wiring/behavioral checks; red battery blocks promotion)
- AC-NFR-INF.009.1, AC-NFR-INF.009.2 (no plugin updated on core promotion; plugin versions reported)
- **Gating spikes (if any):** none is *launch-gating* for this issue (the six OD-157/RP-1 launch spikes are ISSUE-001–006 and none is `AF-064/065/066/020`). Build-time feasibility that must be GREEN before ship: **AF-064** (Railway branch-based canary/release-train + promotion + build-history rollback) and **AF-020** (Railway native per-project auto-deploy + on-release `drizzle-kit migrate`) — both already 🟢 **VERIFIED** in the feasibility register; **AF-065** (expand-contract mixed-version safety — the rollback premise of FR-10.DEP.003, proven by ISSUE-081's migration track); **AF-066** (canary corpus representativeness — the smoke-battery gate of FR-10.DEP.002 / NFR-INF.008, EVAL fast-follow, coverage-limited by its own fixtures).

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-client_registry (`.core_version`; read for fleet spread) and DATA-deployment_health (`.core_version`, `.last_migrated_at`, `.plugin_version` — push-fed operational metadata; the skew evaluation reads these) — both **management-plane only** (schema §13); no client-silo table is written by this slice.
- **PERM:** operator-only capabilities — repo + Railway control, release promotion, per-deployment plugin update, rollback trigger (ADR-005 §5/§6; `PERM-config.infra` is the surfaced config authority, homed in C10). No new PERM node created here.
- **CFG:** `CFG-canary_soak_minutes` (promotion soak window; seeded by ISSUE-007), `CFG-deploy_max_version_skew` (default 3), `CFG-deploy_max_skew_days` (default 14); `DEPLOYMENT_CONFIG` branch-to-environment mapping (non-secret).
- **UI:** none authored here — CI/CD + release/promotion status + fleet version grid + skew/plugin-drift views are the management-plane surfaces owned by C7 (FR-7.MGM.003/004) + Phase 3.
- **Connectors:** none.

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-10-infra-compliance.md — the FR text + ACs (DEP.001–005; the MIG.001/002 seam paragraph for the ISSUE-081 boundary).
- spec/05-non-functional/infrastructure.md — NFR-INF.001/002/003/004/008/009 (the release-train postures + the expand-contract premise this rests on).
- spec/04-data-model/schema.md §13 (Management plane) — `client_registry` (`core_version`) + `deployment_health` (`core_version`, `last_migrated_at`, `plugin_version`, `last_push_at`); the mgmt-only-table rule at §Global rules.
- spec/00-foundations/adr/ADR-005-deploy-provisioning.md — §1 (Railway-native deploy), §2 (canary/release-train + promotion gate), §3 (bounded version skew), §4 (rollback = redeploy), §6 (canary corpus/smoke), §7 (plugins out of train).
- spec/00-foundations/adr/ADR-001-*.md — §6 (no custom fan-out CI) + §7 (push-based reporting), the two reconciliations ADR-005 builds on.
- spec/00-foundations/feasibility-register.md — AF-020/AF-064/AF-065/AF-066 status + caveats (F11 Railway caveat: Pre-Deploy Command blocks deploy on failure).

## 7. Dependencies
- **Blocked-by:** ISSUE-007 (provisioning + per-client Supabase bootstrap — a provisioned, `client_registry`-registered fleet with the branch model + seeded canary corpus must exist before a release train can run). ISSUE-007 is itself spike-gated by **AF-004** (provisioning end-to-end) per RP-1.
- **Blocks:** ISSUE-081 (schema-migration propagation + per-deployment failure isolation — builds on this release/deploy primitive).

## 8. Build order within the slice
1. Confirm the ISSUE-007 baseline: each client Railway project linked to the shared repo, `client_registry` rows present, the canary deployment + seeded synthetic corpus exist, `CFG-canary_soak_minutes` seeded.
2. Configure the branch-to-environment mapping in `DEPLOYMENT_CONFIG`: canary tracks `release`, the fleet tracks `main`; wire Railway per-project native auto-deploy + on-release `drizzle-kit migrate` against each deployment's own Supabase; confirm GitHub Actions runs the test suite as a **merge gate only, not a deployer** (FR-10.DEP.001 → AF-020; heed the F11 Pre-Deploy-Command caveat).
3. Build the promotion gate: on `release`→canary, run the smoke battery (NFR-INF.008 / FR-10.PRV.003) against the synthetic corpus; require tests green + clean canary migration + green battery + elapsed `CFG-canary_soak_minutes`; **refuse + surface the failing gate** otherwise; promotion is a deliberate operator fast-forward of `main` in v1 (FR-10.DEP.002 → AF-064/AF-066, OD-094).
4. Wire the rollback path: rollback = redeploy of the prior Railway build (per-deployment or fleet); assert **no down-migration script exists** and a schema fix is a roll-forward migration (FR-10.DEP.003 → AF-065, resting on ISSUE-081's expand-contract).
5. Wire the version-skew signal: read `core_version` + `last_migrated_at` from each deployment's health push (into `deployment_health`); evaluate skew vs `CFG-deploy_max_version_skew` / `CFG-deploy_max_skew_days`; emit the cross-deployment max-skew alert to C7 (FR-7.MGM.004) when a laggard exceeds bound; keep `frozen ≠ stale` (FR-10.DEP.004 → OD-095).
6. Assert plugins-out-of-train: a core push must not modify `/plugins`; the health push carries `plugin_version` per deployment so drift is observable (FR-10.DEP.005 → OOS-033).
7. Test to each AC in field 4 across the deploy path (auto-deploy + independent migrate), the promotion gate (each of the four gates red → blocked), the rollback path (redeploy on unchanged schema), and the skew evaluation (synthetic over-skew silo raises the alert).

## 9. Verification (how DoD is proven)
- **DOCS / topology (per spec/05-non-functional/test-strategy.md):** the `feature→release(canary)→promote→main` train topology + the gated promotion step prove AC-NFR-INF.001.1 and AC-10.DEP.001.2 (Actions gates, never deploys); the rollback-runbook = redeploy + zero-down-migration proves AC-NFR-INF.003.1/.2 and AC-10.DEP.003.1/.2.
- **Build-time gate tests:** a canary with any red gate (test / migration / smoke) or incomplete soak → promotion refused + failing gate surfaced (AC-10.DEP.002.1, AC-NFR-INF.001.2, AC-NFR-INF.008.2); a synthetic over-skew silo → drift alert raised (AC-10.DEP.004.2, AC-NFR-INF.004.2); a core promotion leaves `/plugins` untouched (AC-10.DEP.005.1, AC-NFR-INF.009.1).
- **Integration (deploy path):** a push to `main` → each fleet Railway project auto-deploys + migrates independently against its own Supabase (AC-10.DEP.001.1); the health push carries `core_version` + last-migrated + plugin version (AC-10.DEP.004.1, AC-NFR-INF.004.1, AC-10.DEP.005.2, AC-NFR-INF.009.2).
- **Feasibility posture:** AF-020 + AF-064 hold 🟢 for the deploy + train mechanism; AF-065 (mixed-version/rollback premise, via ISSUE-081) and AF-066 (battery coverage adequacy, EVAL fast-follow) are the paper-vs-proven caveats — the smoke battery only catches what its fixtures assert (ADR-005 §6 honest limit). The AC→`Verified` path for each DEP AC runs once its build-time gate test is green.
