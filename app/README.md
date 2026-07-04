# `app/` — the product code

This is the **application code** — the harness that actually runs for clients. It lives in the same
repo as the spec (per **ADR-011**, which supersedes ADR-010) so there is **one source of truth**:
the spec, the issues, and the code all in one place, no cross-repo drift.

- **`spec/`** (repo root) — *what* to build: requirements, ADRs, build order, acceptance criteria.
- **`app/`** (here) — *the code* that implements it. This is what Railway deploys, one copy per
  client, each pointed at that client's own Supabase.

Every change here traces back to a spec ID (`FR-* / ISSUE-* / AC-*`) and its commit is recorded in
the matching `spec/06-issues/ISSUE-*.md` (the sync ritual in the root `CLAUDE.md`).

## What's here now (from ISSUE-007 — provisioning + per-client bootstrap)

- **`runbooks/client-onboarding.md`** — the client-side onboarding runbook (accounts + card +
  delegated access + per-client OAuth registration). FR-10.PRV.004 / FR-10.PRV.002.
- **`provisioning/`** — the operator-side provisioning script (FR-10.PRV.001). Idempotent +
  fail-loud orchestration, unit-tested; the live infra adapter (`RailwayInfra`) is next (the AF-004
  two-party spike). See `provisioning/README.md`.

```
cd app/provisioning && npm install && npm test   # 4/4 green: idempotency + fail-loud proven
```

Stack: TypeScript / Node (ADR-009). Infra: Supabase + Inngest + Railway (ADR-001 / ADR-005).
