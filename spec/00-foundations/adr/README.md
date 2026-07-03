# Architecture Decision Records

One ADR per architectural decision that ripples across components. ADRs are resolved in
Phase 0 because downstream requirements assume their answers. Each ADR follows
`ADR-template.md`.

## Index

| ID | Title | Resolution method | Status |
|---|---|---|---|
| ADR-001 | Isolation model (isolated-per-client vs shared multi-tenant) | Grill (load-bearing) | 🟢 Accepted |
| ADR-002 | "Coverage %" → Maturity + Retrieval Sufficiency | Grill (load-bearing) | 🟢 Accepted |
| ADR-003 | Cost model & economic viability (client-side; estimate-grade; cost ladder) | Grill (load-bearing) | 🟢 Accepted |
| ADR-004 | Concurrency model for memory writes (per-entity serialize + optimistic validate-and-commit) | Draft → approve | 🟢 Accepted |
| ADR-005 | Deploy fan-out & provisioning automation (canary + release-train; scripted provisioning; bounded version skew) | Draft → approve | 🟢 Accepted |
| ADR-006 | Dynamic roles vs static RLS (static data-driven policies over live permission tables; intra-client only) | Draft → approve | 🟢 Accepted |
| ADR-007 | Prompt-injection posture (containment-first; detection-as-signal; embedding scan off by default) | Draft → approve | 🟢 Accepted |
| ADR-008 | Backup & disaster recovery (hourly client-owned off-platform snapshot default + PITR opt-in upsell + operator-verified restore + backup-health on the management-plane push; golden rule = reference source data, don't copy it) | Draft → approve | 🟢 Accepted |
| ADR-009 | Implementation stack (TypeScript / Node — the language the locked Inngest + Supabase infra is driven from; recorded at build start, ISSUE-001) | Build-start (Rule-0 gap) | 🟢 Accepted |

More ADRs will be added if component work surfaces further cross-cutting decisions.

## Resolution order

Grill the three load-bearing ones first (ADR-001 → 002 → 003), because they constrain the
draft-and-approve ones. ADR-001 (isolation) comes first: it dictates the data model, which
ADR-004 (concurrency) and ADR-006 (RLS) both build on.
