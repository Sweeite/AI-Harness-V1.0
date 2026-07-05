# `@harness/release` — ISSUE-080, the release / canary model

The core release train: **branch-per-environment auto-deploy**, the **four-gate operator-promoted canary
gate**, **rollback-by-redeploy** (schema forward-only), the **fleet version-skew alert**, and the
**plugins-out-of-train** guard — so no core change reaches a client silo without passing a human-gated
canary and no laggard silo drifts silently.

Implements **FR-10.DEP.001–005** + **NFR-INF.001/003/004/008/009** (C10). Rests on **ADR-005**
(§1/§2/§3/§4/§6/§7), **ADR-001** §6/§7, and **AF-020/064/065/066**. Source of truth for every AC is the
FR (`spec/01-requirements/component-10-infra-compliance.md`) — read there, never restated here (Rule 0).

## Layout (house port + fake pattern — cf. `app/silo`, `app/webhook-auth`)

| Module | Responsibility | ACs |
|---|---|---|
| `config.ts` | CFG defaults verbatim from the registry + fail-loud validation | CFG guards |
| `deployment-config.ts` | `DEPLOYMENT_CONFIG` branch→env map (canary←`release`, fleet←`main`); Actions-gates-never-deploys | DEP.001.1/.2 |
| `ci-scan.ts` | derive CI job kinds from the real workflow (proves it gates, never deploys) | DEP.001.2 |
| `promotion-gate.ts` | the four-gate evaluator (tests + clean canary migration + smoke + soak); refuse + surface; operator-deliberate v1 | DEP.002.1/.2, INF.001.1/.2, INF.008.2 |
| `smoke-battery.ts` | the required battery shape + result summariser (runner behind a port) | INF.008.1 |
| `rollback.ts` | rollback = redeploy prior build; `assertNoDownMigration` (forward-only) | DEP.003.1/.2, INF.003.1/.2 |
| `version.ts` | the version-report contract the health push carries (`core_version`/last-migrated/`plugin_version`) | DEP.004.1, DEP.005.2, INF.004.1, INF.009.2 |
| `skew.ts` | fleet skew evaluation + max-skew/stale alert (`frozen ≠ stale`) | DEP.004.2, INF.004.2 |
| `plugins.ts` | `assertPluginsUntouched` — a core push never edits `/plugins` | DEP.005.1, INF.009.1 |
| `store.ts` | `DeploymentHealthStore` + `AlertSink` ports + in-memory fakes (mgmt-plane only) | — |
| `supabase-store.ts` | live `pg` adapter reading `deployment_health` (mgmt plane) — authored to DDL, **not run in the offline half** | — |
| `index.ts` | CLI: `check` (offline build-time gates) · `skew` (live mgmt-plane monitor) | — |

Repo-root artifacts this slice adds: **`.github/workflows/ci.yml`** (the merge gate — runs the suite,
never deploys) and **`plugins/`** (the out-of-train convention).

## Test / run

```
npm test        # the 20-AC battery (18 offline-provable AC tests + CFG/store guards)
npm run typecheck
npm run check    # offline gates: CFG valid · no down-migration reverse path · CI gates-never-deploys
npm run skew     # LIVE: MGMT_DATABASE_URL + RELEASE_ORDER=v1,v2,v3 → evaluate fleet skew
```

## Paper-vs-proven (feasibility posture)

- **Offline-proven now (18/20 ACs):** the promotion gate logic, rollback/forward-only invariants, skew
  evaluation, plugin guard, version-report contract, CI-gates-never-deploys, CFG — all build-time.
- **🧑 Two-party live capstone (owed to fully close):**
  - **AC-10.DEP.001.1** — a real push → each fleet Railway project auto-deploys + migrates independently
    against its own Supabase.
  - **OD-173 / AF-064 — the Wait-for-CI scope spike (#3 hazard):** Railway "Wait for CI" waits on **ALL**
    check suites on the commit, so a stale/absent *own-suite* check can silently `SKIP` a deploy. The
    live spike confirms the scope **and** that a red/absent own-suite check actually blocks the deploy —
    **before FR-10.DEP.002 is treated as a proven live mechanism** (the gate *logic* is proven offline).
    Dossier: `spec/00-foundations/tool-integrations/railway.md` §7.
- **Consumes as premise (not owned here):** AF-065 (expand-contract mixed-fleet safety — ISSUE-081,
  already 🟢) and AF-066 (smoke-battery coverage adequacy — EVAL fast-follow; the battery only catches
  what its fixtures assert, ADR-005 §6 honest limit).
