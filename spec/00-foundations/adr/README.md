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
| ADR-004 | Concurrency model for memory writes | Draft → approve | 🔴 open |
| ADR-005 | Deploy fan-out & provisioning automation | Draft → approve | 🔴 open |
| ADR-006 | Dynamic roles vs static RLS | Draft → approve | 🔴 open |
| ADR-007 | Prompt-injection posture | Draft → approve | 🔴 open |

More ADRs will be added if component work surfaces further cross-cutting decisions.

## Resolution order

Grill the three load-bearing ones first (ADR-001 → 002 → 003), because they constrain the
draft-and-approve ones. ADR-001 (isolation) comes first: it dictates the data model, which
ADR-004 (concurrency) and ADR-006 (RLS) both build on.
