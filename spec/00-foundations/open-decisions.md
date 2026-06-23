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

## OD-003 — Cost model & economic viability 🟢 RESOLVED → ADR-003
**Resolution (2026-06-22):** Reframed by ADR-001 — opex is client-borne, operator marginal cost
≈ $0, so "viability" is **client-side**: keep a deployment's bill low enough that the retainer is
worth paying, and stop a runaway from burning unbounded client money. Decisions: (1) cost tracking
is **estimate-grade** (token counts × an operator-editable price table, all vendors incl. OpenAI
embeddings, fail-safe rounded **up**) — never the vendor invoice (boundary forbids it). (2) Breach =
a **tiered ladder** (soft alert $50/day + $200/week → throttle non-critical at $75 → hard kill at
$100), per-deployment tunable, modelled on the rate-limit ladder. (3) Memory write = **≤1 Sonnet
call** (writer) + Haiku pre-checks; OD-003's "3 Sonnet calls" corrected. (4) Loops **short-circuit
in code** before the Sonnet orchestrator. (5) Principle **"controls before gates"** — structural/code
limits first, one self-funding Haiku gate (selective-writing) only; re-rank/HyDE not mandated.
(6) Viability target ≤ ~$20/day typical, **validated by AF-001** (also AF-040/041/042/043). See ADR-003.

## OD-004 — Concurrency model for memory writes 🟢 RESOLVED → ADR-004
**Resolution (2026-06-23):** The contradiction-check-then-write TOCTOU is closed by **per-entity
serialization + optimistic validate-and-commit**. Only **same-entity** writes serialize (disjoint
writes stay parallel, preserving fan-out); the slow Sonnet writer runs **unlocked**, then a short
transaction under **sorted per-entity Postgres advisory locks** re-checks a per-entity watermark
and commits — locks held for milliseconds, never across an LLM call. Backed by three supports: the
**Memory Agent is the sole writer** (invariant, locks `L3435`), a **unique idempotency constraint**
(kills retry double-writes), and a **CAS supersede** (`WHERE superseded_by IS NULL`, kills lost
supersession). Daily/weekly jobs demoted to hygiene. `memory_writes_per_minute:30` makes
serialization effectively free. **Must be tested** before/while building — ⚠️ AF-061 (the
validate-and-commit actually closes the window, no livelock), AF-062 (locks don't bottleneck at
scale, deadlock-free), AF-063 (Inngest per-key concurrency behaves as assumed). See ADR-004.

## OD-005 — Deploy fan-out & provisioning automation 🟢 RESOLVED → ADR-005
**Resolution (2026-06-23):** Three gaps closed. (1) **Fan-out** — there is no custom CI fan-out;
ADR-001 §6 already made each client's Railway project natively track the shared repo, so fan-out is
N independent subscriptions, not an orchestrator. Blast radius is bounded by a **canary +
release-train**: a canary deployment tracks a `release` branch ahead of `main`, must pass a
smoke-test battery + soak, then promotion fast-forwards `main` and the fleet auto-deploys.
(2) **Provisioning** — a **two-party** process: client creates the cost-bearing accounts (Supabase
+ keys + connectors) on their card and grants delegated access; the operator runs a **provisioning
script** (Railway link, env + `DEPLOYMENT_CONFIG`, `internal_token`, `client_registry` row,
first-deploy → seed) plus a **runbook** for consent-gated steps (incl. per-client OAuth apps in the
client's own accounts, with Google production verification as a schedule dependency). Registration
is operator-side (no self-registration). (3) **Version skew** is a normal, bounded condition made
safe by **expand-contract migrations**; rollback = code-redeploy + roll-forward (never destructive
down-migration); a max-skew alert catches laggards. The canary is a **seeded synthetic client +
smoke battery** now, maturing into **operator dogfooding**. **Must be tested** — ⚠️ AF-004
(provisioning wires up), AF-020 (Railway auto-deploy + migrate-on-release), AF-064 (Railway supports
the canary/promotion branch model), AF-065 (expand-contract keeps a mixed-version fleet safe),
AF-066 (synthetic canary corpus is representative enough). See ADR-005.

## OD-006 — Dynamic roles vs static RLS 🟢 RESOLVED → ADR-006
**Resolution (2026-06-23):** False fork — the model keeps **both** via **static, data-driven RLS
policies over live permission data**. Permissions live in **tables** (`roles`, `role_permissions`,
`user_roles`, `sensitivity_clearances` with entity-type scope, `restricted_grants`), edited from the
dashboard with **no migration**. RLS policies are authored once, are **generic** (never name a role),
and look up the acting user's *current* permissions **live** each query via `STABLE SECURITY DEFINER`
helper functions keyed on `auth.uid()` — so editing a role is just a row write and **every change,
grant or revoke, is instant** (no JWT snapshot, no staleness window, no propagation rule). Rejected:
one-policy-per-role (needs a migration per edit) and JWT-cached claims (imports a staleness problem we
don't need at ≤20 users; kept only as a documented future optimisation, OOS-012). Division of labor:
**RLS** owns the visibility/sensitivity/Restricted **row-access** subset as the DB backstop; the
**harness** owns the full permission matrix in code — both read the same tables. Two ADR-001
reconciliations baked in: RLS is **intra-client only** (the doc's `client_slug` clause is deleted —
cross-client isolation is physical), and RLS guards the **user-session** path only (the Memory Agent /
backend run as the **service role**, which bypasses RLS — governed by harness RBAC + ADR-004). **Must
be tested** — ⚠️ AF-067 (live data-driven RLS performs on the hot retrieval path; D2 JWT-cache is the
fallback if not). See ADR-006.

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

## OD-009 — Backup & disaster recovery (whose job, what strategy) 🔴
**Why it matters:** Nothing in the design doc or ADRs addresses **data loss or corruption** of a
client's Supabase. For a "business brain," losing the memory layer is catastrophic — and ADR-001
makes it thornier: the **client owns the Supabase project**, so the operator may be managing a
system whose backups they don't control or can't verify.
**Scope to resolve (Phase 5 / non-functional):** point-in-time recovery + backup cadence;
retention; a *tested* restore procedure (a backup you've never restored is a guess); **who owns
and who verifies** backups under client-owned Supabase; whether backup-health is part of the
management-plane push so the operator can see if a client's backups lapse.
**Priority — ELEVATED:** this directly underpins **non-negotiable #1 (never lose or corrupt
knowledge)** in `what-makes-it-great.md`. It is a top-bar gap, not a Phase-5 nicety; resolve early.
**Recommendation:** Draft → approve in Phase 5 (or sooner); may spawn a small ADR if the ownership
question is contentious. Log a feasibility item that restore *actually works* (SPIKE/LOAD), not just
that backups exist.

## OD-010 — Compensation / rollback for partially-completed task chains 🔴
**Why it matters (surfaced by the "what makes it great" audit):** a task graph can act on the
outside world mid-chain (e.g. update the CRM at step 7) and then halt at a later step. The current
failure model is retry / skip / halt-escalate + idempotent re-run — but there is **no defined story
for undoing or compensating external side effects already applied** when a chain halts. For
external comms / records this is a real great-harness concern.
**Options:** (a) halt + human + idempotent resume only (current implicit) — simplest, leans on
"prefer reversible" + approval gates making partial side effects rare; (b) compensating actions
(saga-style) per reversible step; (c) explicit cleanup tasks queued on halt. Likely touches
components 5/6/8 (harness / guardrails / agent design).
**Recommendation:** draft→approve during the Harness/Guardrails component work in Phase 1; promote
to an ADR only if it proves cross-cutting. Not a Phase-0 blocker.

> Next OD number: OD-011.
