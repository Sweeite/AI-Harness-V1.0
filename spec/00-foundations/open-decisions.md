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

## OD-007 — Prompt-injection posture 🟢 RESOLVED → ADR-007
**Resolution (2026-06-23):** **Containment-first.** A successful prompt injection is made
**harmless by capability limits in code** — not reliably **caught** by detection. The security
boundary is the controls that ignore prompt content entirely: hard limits (`L2053`/`L2066`),
default-deny RBAC + RLS (ADR-006), approval gates, rate limits, physical isolation (ADR-001),
sole-writer memory (ADR-004). Detection is **demoted to a signal**: keep the cheap deterministic
layers always on (boundary tagging, regex tripwires, webhook HMAC auth) for logging/alerting; ship
the **embedding-similarity scan off by default** (`injection_semantic_detection`, the operator
on/off switch) — observability-only when on, never an autonomous gate. Fail-safe = **retain + route
to human**: flagged content is held, never machine-discarded (discard is a human-only logged
decision — protects non-negotiable #1); every event is logged loudly (#3). The injection thresholds
(0.85/0.95) are signal-tuning knobs, **not** safety dials. **Must be tested** — ⚠️ AF-068 (the
containment boundary holds end-to-end: no authorized-but-dangerous autonomous action path; red-team
with live payloads). See ADR-007.

---

## OD-008 — Answer-mode pill count: three vs four 🟢 RESOLVED → ADR-002
**Resolution (2026-06-22):** Three pills, no exception — Cited / Inferred / Unknown.
`[Building]` is a **flag** overlaid on a thin/`[Unknown]` response (driven by low Retrieval
Sufficiency + per-entity Maturity below proactive threshold), **not** a fourth pill. Settled as
a consequence of ADR-002.

## OD-009 — Backup & disaster recovery (whose job, what strategy) 🟢 RESOLVED → ADR-008
**Resolution (2026-06-23):** Defense-in-depth per silo. Primary-source vendor research reframed the
risk: the biggest loss path is **the client's credit card, not a crash** — a billing lapse pauses the
client-owned project after ~7 days, leaves it restorable for 90, then **permanently deletes the project
*and all its in-project backups* (daily and PITR) together**. So invariant #1 needs a copy that lives
*outside* the project lifecycle. The **golden rule** (`L1634`) shrinks the problem: the brain stores only
pointers + enrichment over systems of record that survive any incident, so recent loss is re-derivable by
re-ingestion → an ~1-hour RPO is acceptable. Six binding parts: (1) **default = free daily in-project
backups + an hourly off-platform snapshot** (~1-hour RPO, near-zero cost, AF-072-bounded); **PITR is an
opt-in upsell** (off by default, ~$100+/mo on the client's card, for minute-level RPO / brains too big for
hourly dumps); running below hourly is a logged exception; (2) an **independent off-platform `pg_dump`**
(the thing run hourly) to a **client-owned** second location in a different region, independent of the
primary project — the only defense against the deletion path, and client-owned so the operator never holds
business data (preserves the ADR-001 boundary; operator-held copy is a logged per-client exception only);
(3) **ownership split** — client owns + pays, **operator operates + verifies**; (4) a **tested restore
rehearsal** to a throwaway project (Supabase verifies nothing; we do) — ⚠️ AF-069; (5) **backup-health
joins the management-plane push** (operational metadata only: recovery tier, last-backup time, **project
status incl. pause/billing-at-risk**, off-platform-snapshot + rehearsal results) read via the Supabase
Management API (⚠️ AF-070), with a **loud Super Admin alert** if any lapse — so a client's failing backups
are *seen* before the deletion window (protects #1 + #3); (6) **golden rule governs scope** — source files
live in their system of record, referenced not copied; **Storage buckets out of scope** (OOS-013 — v1
Storage holds only regenerable offboarding exports). DR is backup-restore-with-downtime, not hot failover
(Enterprise-only; OOS-014). **Must be tested** — ⚠️ AF-069 (restore actually works), AF-070 (Management API
exposes the health fields), AF-071 (backup region / AU residency — unconfirmed in primary docs), AF-072
(**hourly** off-platform dump completes in-window at scale — gates the default cadence). See ADR-008.

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

## OD-011 — Slack app registration class (Marketplace / internal-custom) for history ingest 🟡
**Surfaced by:** AF-003 vendor-claims verification (finding F3), 2026-06-23.
**Why it matters:** As of **2025-05-29** Slack throttles `conversations.history` and
`conversations.replies` to **Tier 1 (1 call/min, `limit` max 15 objects)** for **non-Marketplace
apps** — about **15 messages/minute per token**. Any Slack channel-history ingest/backfill (a core
"business brain" source) is **non-viable** at that rate. **Exempt:** Slack-Marketplace-approved apps
**and internal custom apps** (these keep Tier 3, 50+/min × up to 1,000 objects). So the throttle is a
function of *how the Slack app is registered*, not of our code — and it directly gates ingest throughput.
**Options:**
- **(a) Internal custom app per client workspace** — each Silo's Slack integration is a custom app
  created inside the client's own workspace (fits the ADR-001 per-client / client-owned-account model
  and the ADR-005 per-client OAuth-app pattern). Exempt from the throttle; no Slack review. **Recommended.**
- **(b) One Slack-Marketplace-approved app** — a single distributed app, but requires passing Slack's
  Marketplace review (lead time + ongoing compliance) and conflicts with the per-client account model.
- **(c) Accept Tier 1 + design around it** — incremental/event-driven sync only (Events API push instead
  of history pull), no bulk backfill. Lossy for cold-start ingest of existing history.
**Recommendation:** **(a)** — aligns with ADR-001 (client owns the connector accounts) and ADR-005
(per-client OAuth apps live in the client's accounts); internal custom apps are the documented exempt
path. Confirm the exemption holds with an **EVAL against a live test workspace** (the AF-012 follow-up)
before locking. Resolve when we spec the Slack connector / ingestion component in Phase 1.

> Next OD number: OD-012.
