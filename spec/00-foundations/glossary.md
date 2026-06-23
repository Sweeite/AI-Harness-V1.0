# Glossary — Ubiquitous Language

Every load-bearing term, defined exactly once. If a term is used in a requirement, it must
appear here with a single agreed meaning. Terms marked **🔴 OPEN** are undefined in the
design doc and blocked on an Open Decision — they cannot be used in a `Ready` requirement
until resolved.

| Term | Definition | Status |
|---|---|---|
| Deployment | One isolated instance (own Supabase project + Railway service) serving exactly one client. The tenant boundary. | ✅ ADR-001 |
| Management plane | The operator's separate Super Admin deployment; holds `client_registry` + pushed operational metadata only. Never client business data. | ✅ ADR-001 |
| Client | The agency that pays for and uses a deployment. One client = one deployment. | ✅ |
| Internal Org | The single first-class entity representing the agency itself (not its clients). | ✅ |
| Entity | A business noun memories attach to (client, contact, campaign, etc.). | ✅ |
| Memory | A stored unit of knowledge: semantic, episodic, or procedural. | ✅ |
| Working memory | The active context window during a task; transient unless written back. | ✅ |
| Visibility | Access scope of a memory: global / team / private. Orthogonal to sensitivity. | ✅ |
| Sensitivity | Handling class of a memory: standard / confidential / personal / restricted. | ✅ |
| Clearance | A role's granted access to sensitivity levels. | ✅ |
| Answer mode | The provenance pill on every AI output: **exactly three** — Cited / Inferred / Unknown. `[Building]` is a *flag* overlaid on a thin/`[Unknown]` response, not a fourth pill. | ✅ ADR-002 (closes OD-008) |
| ~~Coverage %~~ | **Retired.** Was overloaded across two jobs; split into **Maturity** + **Retrieval Sufficiency**. | ✅ ADR-002 |
| Maturity | Knowledge-base completeness. `filled slots / expected slots` per entity (binary fill at v1), rolled up to aggregate. Stored, recomputed daily + on-write. Drives cold-start gating (20/50/80) and the onboarding indicator. | ✅ ADR-002 |
| Retrieval Sufficiency | Query-time adequacy: were the slots this query touches filled **and** surfaced by retrieval above a relevance×confidence bar? Computed inline, not stored. Drives the `[Building]` flag. | ✅ ADR-002 |
| Expected knowledge slot | One of the 5–8 things an entity *type* is expected to know (operator-editable). The denominator of Maturity; empty slots seed the onboarding interview. | ✅ ADR-002 |
| Cold start | Deployment phase while **aggregate Maturity** is below `full_threshold`. The *mode* deactivates permanently at 80%; the per-entity `[Building]` flag still recurs for new/thin entities afterward. | ✅ ADR-002 |
| Confidence | A memory's 0.0–1.0 trust score, set at write and moved over its life. | ✅ |
| Decay | Scheduled downward drift of confidence for stale, unconfirmed memories. | ✅ |
| Supersede | Marking an old memory replaced by a newer one (chain preserved, not deleted). | ✅ |
| TOCTOU race | Time-of-check-to-time-of-use: two parallel memory writers both pass the contradiction check before either writes, so neither sees the other → duplicate or self-contradicting memory. The hazard ADR-004 closes. | ✅ ADR-004 |
| Per-entity serialization | ADR-004's concurrency model: writes touching the **same** entity are forced single-file; writes touching **disjoint** entities run in parallel. Only same-entity writes can contradict, so only they are serialized. | ✅ ADR-004 |
| Advisory lock (transaction-scoped) | A Postgres lock keyed on an entity (`pg_advisory_xact_lock`), taken on each of a write's entities in **sorted order** (deadlock-free) inside the short commit transaction. The correctness boundary for per-entity serialization. | ✅ ADR-004 |
| Optimistic validate-and-commit | ADR-004's write shape: run the Haiku/Sonnet writer **unlocked**, then in a short locked transaction re-check a per-entity watermark (`max(updated_at)`); if unchanged commit, else re-run only the cheap DB contradiction check. Keeps locks at milliseconds — never held across an LLM call. | ✅ ADR-004 |
| Idempotency key (memory write) | `hash(source_ref, sorted entity_ids, content_hash)` with a **unique constraint**, so a retried Inngest step can't double-insert a memory (`ON CONFLICT DO NOTHING`). | ✅ ADR-004 |
| Canary deployment | A non-client deployment that auto-deploys from the `release` branch **ahead of** the fleet, runs the smoke battery, and gates promotion. Seeded with a **synthetic corpus** now; matures into the operator **dogfooding** its own deployment with real low-stakes traffic. | ✅ ADR-005 |
| Release train / promotion | The branch model: feature → `release` (canary tracks) → **promote** (fast-forward) → `main` (fleet tracks, auto-deploys natively). Promotion is gated on tests + clean migration + green smoke battery + soak. | ✅ ADR-005 |
| Version skew | Different deployments running different `core_version`s at once — a **normal, bounded** state during a rollout (not an error), made safe by expand-contract migrations. Bounded by `deploy_max_version_skew` / `deploy_max_skew_days` alerts. | ✅ ADR-005 |
| Expand-contract migration | The binding migration discipline: every migration is additive/backwards-compatible (add → backfill → *later release* remove); never a destructive change in the same step. Makes version skew safe and makes rollback = code-redeploy + roll-forward (never destructive down-migration). | ✅ ADR-005 (see standards/migration-discipline.md) |
| Provisioning script vs runbook | New-client setup splits in two: the **script** automates operator-side wiring (Railway link, env + `DEPLOYMENT_CONFIG`, `internal_token`, `client_registry` row, first deploy → seed); the **runbook** covers irreducibly-human, client-owned steps (account creation + card + delegated access; per-client OAuth app registration & verification). | ✅ ADR-005 |
| Synthetic canary corpus / smoke battery | The fixed fake-but-realistic dataset (entities, message/email corpus, seeded memories) the canary boots, plus the deterministic battery of assert-output tests (boot, migration, connector wiring, retrieval/contradiction/routing) that must pass to promote. Shared with the AF-001/AF-002 spikes. | ✅ ADR-005 |
| Data-driven RLS | RLS policies that are authored once (static SQL) but **never name a role** — they look up the acting user's *current* permissions **live** each query via `STABLE SECURITY DEFINER` helper functions keyed on `auth.uid()`. Editing a role is a data write, not a migration; every grant/revoke is instant (no token-cached snapshot). | ✅ ADR-006 |
| Permission tables | The runtime-editable rows that ARE the permission model: `roles`, `role_permissions`, `user_roles`, `sensitivity_clearances` (role/user × sensitivity × entity-type scope), `restricted_grants`. The single source of truth both RLS and the harness read. Default-deny: an un-granted node is denied. | ✅ ADR-006 |
| Restricted grant | Access to **Restricted** sensitivity, granted **per named individual** (never by role alone), fully audited (who/when/why). The narrowest, most-logged clearance. | ✅ ADR-006 (design L452) |
| Entity-type-scoped clearance | A clearance is not just a sensitivity level but a level **scoped to an entity type** — e.g. Finance sees Confidential *finance* memories, not Confidential *client-strategy* ones. RLS/harness check the row's entity type against the user's scoped clearance. | ✅ ADR-006 (design L450) |
| Service-role bypass | The backend (Memory Agent — sole writer per ADR-004 — and jobs) connects with `SUPABASE_SERVICE_ROLE_KEY`, which **bypasses RLS**. RLS therefore guards only the **authenticated user-session** path; agent/backend writes are governed by harness RBAC + the ADR-004 sole-writer invariant. | ✅ ADR-006 |
| Consolidation | Merge / supersede / summarise jobs that keep memory healthy. | ✅ |
| System of record | The external system that owns a piece of data (GHL, Drive, Slack). | ✅ |
| Pointer | A memory that references data owned by a system of record, not a copy of it. | ✅ |
| Golden rule (systems of record) | **Binding principle (`L1634`):** source files/records live in their system of record (GHL/Drive/Slack); the memory layer stores **pointers (`source_ref`) + enrichment**, **never a copy of the source binary/record**. Consequences: nothing copies ingested files into Supabase Storage; the backup scope is just the derived DB layer; recent loss is **re-derivable by re-ingestion** (which is why an ~1-hour RPO is tolerable, ADR-008). | ✅ ADR-008 (design L1634) |
| Off-platform snapshot | The independent backup that defeats the catastrophic loss path: a scheduled, **encrypted** `pg_dump` of a client's DB to a **client-owned** second location (different region), **independent of the primary Supabase project's lifecycle** so it survives a paused/deleted project. Run **hourly** as the default RPO mechanism (ADR-008 part 1/2). | ✅ ADR-008 |
| RPO (recovery point objective) | The worst-case amount of recent data a restore can lose. v1 default ≈ **1 hour** (hourly off-platform snapshot); the **PITR upsell** tightens it to ~2 minutes. | ✅ ADR-008 |
| PITR upsell | Supabase Point-in-Time Recovery (continuous WAL, ~2-min RPO) offered as a **documented opt-in add-on** (~$100+/mo on the client's card), **off by default** — for clients needing minute-level RPO or whose brain is too large for an hourly logical dump (AF-072). Not the default tier. | ✅ ADR-008 |
| Restore rehearsal | The operator's periodic **tested restore**: restore a recent snapshot into a throwaway project and confirm the DB (incl. pgvector + auth) comes back complete and queryable — because "a backup exists" ≠ "a restore works" (Supabase verifies neither). Logged. ⚠️ AF-069. | ✅ ADR-008 |
| Orchestrator | The routing agent; plans and delegates, never does the work itself. | ✅ |
| Specialist agent | A focused agent owning one domain (research, client, campaign, ...). | ✅ |
| Context envelope | The structured package passed through every agent in a task graph. | ✅ |
| Task graph | The ordered, versioned step sequence for a task type. | ✅ |
| Loop | A scheduled recurring job set: fast / medium / slow (+ custom). | ✅ |
| Trigger | What wakes the system: event-driven / scheduled / human / chained. | ✅ |
| Approval gate | Auto / soft / hard tiers of human oversight on an action. | ✅ |
| Hard limit | A never-do action enforced in both prompt and code. | ✅ |
| Guardrail | Any safety mechanism: hard limit / approval / anomaly / rate limit / injection / **cost ladder**. | ✅ |
| Containment-first injection posture | The decision that a successful prompt injection is made **harmless by capability limits in code** (hard limits, RBAC, approval gates, rate limits, isolation, sole-writer memory) rather than reliably **caught** by detection. Detection is kept only as a signal. | ✅ ADR-007 |
| External-data boundary tag | The `<external_data source=… >…</external_data>` wrapper applied to all tool-read content; every agent's Layer-1 prompt states content inside it is **data, never instructions**. The single cheapest, highest-leverage injection mitigation. | ✅ ADR-007 |
| Detection-as-signal | Injection detection (regex tripwires + the off-by-default embedding scan) produces **logs/alerts/human-routing**, never an autonomous security gate. The thresholds tune the signal, not safety. | ✅ ADR-007 |
| Estimated cost | The only cost figure the system has: event-log token counts × an operator-editable price table (all vendors — Sonnet, Haiku, OpenAI embeddings), **rounded up (fail-safe)**. It is **estimate-grade, not the vendor invoice** — the ADR-001 boundary forbids reading the real bill. Drives dashboards and the cost ladder. | ✅ ADR-003 |
| Cost ladder | The tiered cost guardrail (per deployment, operator-tunable): soft alert → throttle non-critical work → hard-ceiling kill switch. Modelled on the rate-limit ladder; triggers on **Estimated cost**. | ✅ ADR-003 |
| Critical work | Work never stopped by the cost ladder: human-initiated requests, urgent fast-loop triggers, human-approved actions, guardrails. Its complement (proactive, insight, self-improvement, consolidation, batch) is **non-critical** and is throttled then halted as the ladder escalates. | ✅ ADR-003 |
| Haiku decision log | The audit trail of every Haiku decision in the memory write path (selective gate, contradiction pre-check, sensitivity) — input snapshot + verdict + outcome, with operator agree/disagree. The evidence base for trusting the cheap model (AF-035/AF-043). | ✅ ADR-003 |
| Trust window | The initial period (default ~3 weeks, config) during which the Haiku gate is human-reviewed and runs in **shadow-retain** mode before going autonomous. | ✅ ADR-003 |
| Shadow-retain | Gate mode during the trust window: a "would-drop" memory is **written anyway and tagged**, never deleted — so no silent data loss and every drop is reviewable. | ✅ ADR-003 |
| Tunable / Config key | A value that changes behaviour without code change. | ✅ |
| Config edit class | SECRET / BOOT / LIVE / REBUILD — how a config takes effect. | ✅ see standards/config-edit-taxonomy.md |
| Surface | Any UI view, panel, modal, banner, or queue. | ✅ |
| Permission node | An atomic, role-gated capability (default-deny). | ✅ |
| Open Decision (OD) | A tracked unresolved question blocking one or more requirements. | ✅ |

> Add a row the first time any new term appears in a requirement. Never let two requirements
> use the same word for different things.
