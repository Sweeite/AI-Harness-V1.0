# Provisioning script (operator-side) — FR-10.PRV.001

> **Implements:** FR-10.PRV.001 — the scripted, operator-run provisioning flow for a new client
> silo. **Rests on:** ADR-005 §5, ADR-001 §5/§7, ADR-009 (TS/Node).
> **Feasibility:** the end-to-end live run is **AF-004** (🔴, two-party).

## The flow (ADR-005 §5)

```
Railway link → DEPLOYMENT_CONFIG + env secrets → mint internal_token (dual-store:
Railway env + management DB) → insert client_registry row → trigger first deploy
→ seed (C0/C1) runs → status `initialising`
```

Two non-negotiable properties, built into every step:

- **Idempotent** — a re-run after a partial failure *converges*; each step checks current state
  before acting and is a no-op if already done (AC-NFR-INF.006.1).
- **Loud on partial failure** — a missing secret or a failed step **stops visibly** (throws /
  non-zero exit / status never reaches ready); it **never** leaves a silently half-provisioned silo
  (AC-10.PRV.001.3, AC-NFR-INF.006.2). This is the #3 non-negotiable (never fail silently).

Registration is **operator-side only** — the script inserts the `client_registry` row; the
deployment never self-registers (avoids the token chicken-and-egg, AC-10.PRV.001.2).

## Design — orchestration vs live adapter

The orchestration logic (the ordered, idempotent, fail-loud step pipeline) is separated from the
**`Infra` port** — the interface to Railway / Supabase management / the management DB. This is
deliberate:

- `src/provision.ts` — the orchestrator. **Buildable + testable now**, no live infra.
- `src/infra.ts` — the `Infra` port (interface) + a `DryRunInfra` fake that records calls and lets
  us inject failures. The **live adapter** (`RailwayInfra`, real Supabase/DB calls) is the
  **two-party AF-004 step** — stubbed here with clear `TODO(AF-004)` markers.
- `src/provision.test.ts` — proves the two ACs now against the fake:
  (a) re-run converges idempotently; (b) a missing secret / failed step fails loud, no half-silo.

So the **correctness of the orchestration** is provable today; only the **live wiring** waits on
the two-party session. When AF-004 runs, we implement `RailwayInfra` against the real APIs and the
orchestrator is unchanged.

## Not owned here

- `client_registry` **table DDL** + status lifecycle + token **rotate/revoke** → ISSUE-012
  (FR-10.MGT.*). This script *writes the first row* + *mints/dual-stores* the token; the management
  deployment (or at least its `client_registry` DDL) must exist before a live run.
- The **seed** (Internal Org + first Super Admin + roles) → C0 `FR-0.SEED.*` / C1 `FR-1.ROLE.001`;
  this script only *triggers* it via the first deploy.

## Run

```
npm install
npm test          # proves idempotency + fail-loud against DryRunInfra (no live infra)
npm run provision -- --dry-run --client <slug>   # prints the plan; no live calls
```

The live (`--execute`) path is intentionally guarded until `RailwayInfra` is implemented in the
AF-004 two-party session.
