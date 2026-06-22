# Open Decisions Log

Every ambiguity, gap, or fork is tracked here. An FR cannot be `Ready` while an OD pointing
at it is unresolved. Each OD: the question, why it matters, options, recommendation, and —
once you decide — the resolution + which FRs/ADRs it unblocks.

**Status key:** 🔴 open · 🟡 recommendation pending your call · 🟢 resolved

The 7 seeds below are the load-bearing architectural gaps found during design review. They
are promoted into ADRs in Phase 0. Hundreds more, smaller ODs will be logged per component.

---

## OD-001 — Isolation model: isolated-per-client vs multi-tenant-shared 🟢 RESOLVED → ADR-001
**Resolution (2026-06-22):** Silo (one isolated Supabase per client) with hybrid account
ownership — client owns Supabase + API keys + connector SaaS on their card; operator owns
Railway compute (codebase stays out of client accounts). `client_slug` deleted from all app
tables; client identity lives only in the management plane's `client_registry`. Super Admin
= push-based operational-metadata snapshots; no client business data crosses the boundary.
See ADR-001 for full detail and downstream consequences.

## OD-002 — Definition of "memory coverage %" 🟢 RESOLVED → ADR-002
**Resolution (2026-06-22):** "Coverage %" retired and split into two metrics over one slot
substrate. **Maturity** (`filled slots / expected slots`, binary at v1, stored, daily + on-write)
drives cold-start gating (20/50/80) and onboarding. **Retrieval Sufficiency** (query-time, thin
threshold over existing retrieval signals) drives the `[Building]` flag. Denominator = 5–8
operator-editable expected knowledge slots per entity type. Deployment cold-start *mode* is
one-time (off permanently at 80%); the `[Building]` flag recurs per-entity for new/thin entities.
Confidence-weighted slot-fill deferred to v2. ⚠️ AF-034 validates the metric in the AF-002 spike.
See ADR-002.

## OD-003 — Cost model & economic viability 🟡 → ADR-003
**Why it matters:** Every agent is Sonnet; memory writes fire up to 3 Sonnet calls/event.
No back-of-envelope shows whether real volume fits the $50/day default. Could invalidate
the architecture.
**Recommendation:** Resolve via grilling (load-bearing). → ADR-003.

## OD-004 — Concurrency model for memory writes 🔴 → ADR-004
**Why it matters:** Contradiction-check-then-write is a TOCTOU race under parallel agents /
fan-out. No per-entity locking defined.
**Recommendation:** I draft ADR-004 with a recommendation; you approve.

## OD-005 — Deploy fan-out & provisioning automation 🔴 → ADR-005
**Why it matters:** "Push deploys to all N Railway projects" + per-client Supabase/OAuth
provisioning is asserted, not designed. Version skew across clients is implied but unhandled.
**Recommendation:** I draft ADR-005; you approve.

## OD-006 — Dynamic roles vs static RLS 🔴 → ADR-006
**Why it matters:** Roles are editable at runtime, but RLS policies are authored at migration
time. Data-driven RLS is much harder/slower. Need one coherent model.
**Recommendation:** I draft ADR-006; you approve.

## OD-007 — Prompt-injection posture 🔴 → ADR-007
**Why it matters:** Regex + embedding-similarity detection is partly theater and risks
false-positive quarantine. Need to decide how much to lean on code-level hard limits vs
detection. Affects the guardrails component.
**Recommendation:** I draft ADR-007; you approve.

---

## OD-008 — Answer-mode pill count: three vs four 🟢 RESOLVED → ADR-002
**Resolution (2026-06-22):** Three pills, no exception — Cited / Inferred / Unknown.
`[Building]` is a **flag** overlaid on a thin/`[Unknown]` response (driven by low Retrieval
Sufficiency + per-entity Maturity below proactive threshold), **not** a fourth pill. Settled as
a consequence of ADR-002.

> Next OD number: OD-009.
