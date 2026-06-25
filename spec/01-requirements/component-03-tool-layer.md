# Component 3 — Tool Layer (Connectors)

- **Status:** 🟡 **DRAFT — research-first gate PASSED; FR drafting pending OD resolution** (session 19,
  2026-06-25). All three dossiers complete + gate-passed: **GHL 🟢 · Google 🟢 · Slack 🟡** (dossier
  complete; connector *viability* gated on AF-083 EVAL, not research). Registers filed: feasibility
  **Block N (AF-083–110)**; **OD-011 resolved** + **OD-039–045** logged; **OOS-018–027**; +12 glossary
  terms. **Next: resolve the C3 ODs (esp. OD-044 — the ADR-007 webhook-auth reconciliation), then draft
  FRs** citing the dossiers (not the design doc) for every vendor fact.
- **Design-doc source:** `## 3. Tool Layer` = **L1968–2382** (next section `## 4. Prompt Architecture`
  ~L2384); C3 checklist overview ~L245–270.
- **Decomposition source:** session-19 design-map (Explore agent), cites verified against
  `spec/source/design-doc-v4.md`.

## Architectural spine (locked session 19) — the connector contract

C3 is specced as a **generic connector contract + shared tool runtime**, with **GHL, Google
(Gmail/Drive/Calendar), and Slack as the first three *instances*** — not three hand-built integrations.
This is the design doc's own mandate, not an embellishment:

> **L1976:** "The tool layer is built as a boilerplate. The current connectors … are the first
> implementations of the pattern, not the limit."

**Why this is the spine (not just convenience):** the safety machinery is built **once** in the runtime,
so every future tool inherits it and the three non-negotiables can't silently regress per tool —
- token-refresh-**and-persist** lives in the runtime → **#1 never lose access** can't be re-broken per tool
  (the F5/GHL rotating-refresh-token trap is handled in one place);
- least-privilege scopes + external-data **boundary-tagging** are contract obligations → **#2**;
- the rate-limit tracker + backoff + idempotent retry are generic → **#3 never fail silently**.

**The runtime owns (built once):** the tool registry; the 3-layer OAuth token lifecycle
(proactive/reactive/re-auth); credential storage (encrypted, Vault); the rate-limit tracker + tiered
backoff; external-data boundary-tagging on every read; idempotent safe re-run; the connector
disconnection/recovery flow + health surfacing; graceful degradation.
**Each connector instance supplies (fill-in-the-blanks):** its endpoints + field mappings; trigger
transport (webhook / Pub-Sub / poll); token TTL + rotation parameters (from its dossier); its minimal
scope set; batch capabilities; field validators.

**Lifecycle commitment (extracted post-C3):** once C3 is done, grow
`standards/tool-integration-research.md` from a research-only gate into the full **Research → Spec →
Build → Verify** tool-onboarding lifecycle (learn it from this real example; don't pre-guess it). No
ADR — change-control already protects it (decision: session 19, user-approved "C3 spine + lifecycle
standard").

---

## Context manifest (load only these)

- **ADR-001** (Silo isolation; per-client account ownership; secrets custody; §7 mgmt-plane push) — each
  client's tools/credentials/rate-tracker live in *their own* Supabase; isolation is **physical**.
- **ADR-003** (cost) — tool-call volume feeds the cost model; batching/caching are cost levers.
- **ADR-004** (concurrency; idempotency) — every external write must be safe to re-run; per-entity
  serialize; `onFailure` semantics.
- **ADR-005** (§5 per-client OAuth apps in the client's own accounts; provisioning; redirect URIs →
  deployment domain; Google production-verification as an onboarding critical path).
- **ADR-006** (RLS / service-role) — the **agent/tool-execution path runs as `service_role`** (bypasses
  RLS; governed by harness RBAC), per the human-path-RLS vs agent-path-service_role division. **The tool
  registry's `client_slug` (L2083) is a per-deployment label, NOT an RLS scoping key** — cross-client
  isolation is physical (ADR-006 deleted `client_slug` from policies; mirror the C1 reconciliation).
- **ADR-007** (containment-first; **external-data boundary tag** on all ingested tool content = untrusted;
  webhook **HMAC auth** = a real hard control; the 7 hard limits at L2053–2066 are code-enforced gates
  that ignore prompt content).
- **ADR-008** (the `credentials` table is in-DB → covered by backup; **golden rule** — source files are
  referenced, not copied).
- **Standards:** `tool-integration-research.md` (the gate — **binding here**), `migration-discipline.md`
  (registry/credentials/rate-tracker schema), `config-edit-taxonomy` (the many C3 config keys),
  `rbac.md` (default-deny; `can()`; service-role caveat).
- **Glossary:** external-data boundary tag, service-role bypass, connector, golden rule, (new C3 terms
  TBD from dossiers).
- **Dossiers (gate):** `tool-integrations/gohighlevel.md`, `google-gmail.md`, `slack.md` — cite these for
  ALL vendor facts. Seeded from AF-003 findings F1–F6.

---

## Candidate FR area codes (9)

| Code | Title | Spine role |
|---|---|---|
| **CONN** | Connector contract — the base capability model every tool inherits | **GENERIC — the spine** |
| **REG** | Tool registry, description quality, versioning, per-deployment scoping | GENERIC |
| **OBS** | Observation (read) tools — CRM / comms / docs / calendar | per-connector instances |
| **ACT** | Action (write) tools + the 7 code-enforced hard limits | GENERIC limits + per-connector writes |
| **TRIG** | Trigger model — dev-built connector infra (L1) + dashboard config (L2) | GENERIC pattern + per-connector transport |
| **OPT** | Tool optimisation — confidence-gating, per-run caching, batching, graceful degradation | GENERIC |
| **RL** | Rate-limit management — tracker table + tiered (80/95/429) backoff + high-risk halt | GENERIC |
| **TOK** | OAuth token lifecycle — proactive/reactive/re-auth refresh; encrypted storage | GENERIC + per-connector TTL/rotation |
| **DSC** | Connector disconnection & recovery — system-wide vs individual; escalation; health panel | GENERIC |

---

## Design-intent inventory (verified cites; generic-vs-specific split done)

### GENERIC — the connector contract / shared runtime (~35 intents → CONN/REG/ACT-limits/OPT/RL/TOK/DSC)

- **OBS-1** read tools are read-only by contract `L2021,L2033`.
- **ACT-1** write tools share a higher-risk contract; approval gates apply uniformly `L2037,L2049`.
- **Hard limits (code-enforced in prompt AND application code; no role/config override)** `L2053–2066`:
  never autonomously send external email `L2056` · never make a financial transaction `L2057` · never
  delete a system-of-record record `L2058` · never share data across client deployments `L2059` · never
  impersonate a named human `L2060` · never self-approve a queued action `L2061` · never treat monitored
  tool content as instructions (injection defense) `L2062–2063`. *(ADR-007; enforcement seam → C7.)*
- **REG-1** `tools` registry table (name, description, category read|write, risk_level, requires_approval,
  connector, config, enabled, version, previous_version_id, change_reason) `L2072–2090`.
- **REG-2** plain-English tool **description drives AI tool selection** — quality is testable `L2093–2097`.
- **REG-3** tools versioned; `change_reason` mandatory on every version `L2084–2089`.
- **REG-4** registry is per-deployment (`client_slug` = label, not RLS — see manifest) `L2083`.
- **TRIG-1** dev builds webhook handler + payload parser + error handling **once per connector**
  `L1984–1986` *(generic+param: transport varies)*.
- **TRIG-3** end users configure *which events / conditions / what task fires* from the dashboard, no code
  `L1994–1998`.
- **OPT-1** confidence-gate tool choice; below threshold, ask rather than call `L2103`.
- **OPT-2** cache reads within a single task run; never cache writes `L2105`.
- **OPT-3** batch reads where the connector supports it `L2107` *(generic+param)*.
- **OPT-4** graceful degradation — a missing tool logs + completes what it can + flags the gap, never hard-fails `L2109`.
- **RL-1** `rate_limit_tracker` table (window_start, duration, limit, calls_made, reset_at) `L2144–2154`.
- **RL-2** check tracker **before** every call, update **after** — source of truth `L2157`.
- **RL-3** at 80%: slow non-urgent calls, deprioritise background jobs; urgent/human/approval-gated continue `L2162–2168`.
- **RL-4** at 95%: pause non-critical, queue for post-window, log + dashboard status `L2170–2174`.
- **RL-5** at 429: exponential backoff + jitter, retry after reset; **honor Slack `Retry-After` exactly** `L2176–2181`.
- **RL-6** rate-limit on a **high-risk** action → halt + escalate to human, **never auto-retry** `L2183–2190` *(seam → C7)*.
- **RL-8** each deployment's tracker is isolated in its own Supabase — no cross-client quota bleed `L2199`.
- **RL-9** configurable: max calls/connector/min, alert_threshold (80%), backoff initial(1000ms)/max(60000ms)/×2+jitter `L2203–2220`.
- **TOK-1/2/3** tokens in an encrypted `credentials` table (Supabase Vault); **never** in logs/env/UI/config;
  stores access+refresh (encrypted), expires_at, scopes, timestamps `L2231–2244`.
- **TOK-4** Layer-1 proactive refresh — job every 15 min, refresh tokens expiring within 30 min `L2250–2255`.
- **TOK-5** Layer-2 reactive refresh — on 401, refresh + retry once before failing `L2257–2262`.
- **TOK-6** Layer-3 re-auth — refresh-token dead → degraded state → one-click dashboard OAuth `L2264–2269`.
- **TOK-10** target: 99% fully automatic, user-invisible `L2295`.
- **DSC-1…12** disconnection/recovery: system-wide vs individual `L2301–2342`; non-dismissible modal
  (Admin/Super-Admin) vs banner (standard user) `L2305–2324`; auto-resume paused tasks on reconnect +
  audit `L2326–2353`; escalation if unresolved past `connector_disconnection_escalation_window`
  (default 24h) `L2356–2361`; connector health panel (status/last-call/token-expiry) `L2367–2371`;
  alerts (refresh-token expiring <7d → email owner; degraded → modal; unresolved → Super Admin) `L2373–2379`.

### GENERIC+PARAM — generic pattern, per-connector parameters

- **TRIG-1** transport per connector (native webhook vs Pub/Sub vs polling) `L1988–1992`.
- **TRIG-4** default trigger set per connector (GHL lead/stage/tag/overdue; Slack message/DM; Gmail new
  email; Calendar created/starting; Drive created/updated), enable/disable per deployment `L2000–2017`.
- **OPT-3** batch capability + max size per connector `L2107`.
- **ACT-6** internal memory-write tool (explicit write / flag-for-review / supersede) `L2047` — **owned by
  C2** (Memory write-flow FR-2.WRT.*); C3 only exposes it as a registered tool. *(seam → C2.)*

### TOOL-SPECIFIC — per-connector instances (~15 intents → OBS/ACT/TRIG/TOK; cite dossiers)

- **OBS** reads: CRM (contact/deal/pipeline/history/tags/custom fields — GHL) `L2023`; comms (Slack
  threads, emails, transcripts) `L2025`; documents (Drive) `L2027`; calendar (Google) `L2029`.
- **ACT** writes: CRM mutations (GHL) `L2039`; comms (post Slack msg, draft email → approval queue) `L2041`;
  document create/append (Drive) `L2043`; calendar invites → **draft to approval queue, never send direct** `L2045`.
- **TOK-7/8/9** per-connector token facts — **DO NOT cite from the design doc; cite the dossier**:
  - Google: access ~1h; refresh dies 6mo-unused / on password reset; **100-token/client-id cap**; prod
    needs verified OAuth app + **CASA** (`L2275–2279` → dossier F4).
  - GHL: access ~24h; **refresh rotates per-use + dies 1yr unused → MUST persist new token each refresh**
    (`L2281–2284` → dossier F5; design doc's "indefinite" is **refuted**).
  - Slack: `xoxb` non-expiring by default, admin/uninstall-revocable; optional rotation → 12h `xoxe`
    (`L2286–2290` → dossier F6).

---

## Cross-component seams (do NOT double-spec)

- **→ C2 (Memory):** the memory-write action tool `L2047` is C2's write-flow (FR-2.WRT.*); C3 registers
  it. C3's reads **feed** C2's three ingestion pipelines (FR-2.ING.006/007/008) and the live-data fetch
  for relevance cross-check (FR-2.MNT.011). Boundary-tagging on read (ADR-007) is where C3 hands C2
  untrusted external data.
- **→ C7 (Guardrails):** approval-gate enforcement, the high-risk rate-limit **halt + escalate**
  `L2183–2190`, and hard-limit enforcement machinery. C3 *names* the rule; C7 *enforces* the escalation.
- **→ C8 (Observability):** dashboard health panels `L2195,L2367–2371`, connector alerts `L2373–2379`,
  and disconnection/reconnection/rate-limit **event logging**. C3 emits; C8 surfaces.
- **→ C0 (Login):** C0 owns inbound **webhook authentication** (HMAC/JWT verify, FR-0.WHK.*); C3 owns the
  connector **trigger infrastructure** that consumes an authenticated webhook. The seam = a verified
  inbound event handed to a connector's payload parser.
- **→ C1 (RBAC):** tool execution runs as **`service_role`** (agent path, ADR-006); a mid-task
  deactivation/clearance-revoke halts before the next consequential side effect (FR-1.RLS.007). Reconnect
  authority (system-wide) is Admin/Super-Admin only (RBAC).
- **Carry-in:** OD-010 (compensation/rollback of partial external-write chains) lands at C5/C6/C8 — every
  C3 ACT tool that performs an external write is an OD-010 exposure point; note it, don't solve it here.

## Vendor facts the design doc states that are STALE/REFUTED — cite dossiers, never the doc

Per the AF-003 spike (and to be re-confirmed in each dossier as of 2026-06-25):
- Gmail "250 quota units/user/**sec**" `L2124` → **STALE** (F1: 6,000 QU/min/user, date-dependent on GCP
  project activation — pin per-environment).
- GHL "120 req/min/location, no burst" `L2129–2130` → **REFUTED** (F2: 100 req/10s burst + 200k/day).
- Slack "~1 req/sec" `L2134–2135` → **STALE** (F3: tiered; **+ OD-011** — non-Marketplace history throttle
  since 2025-05-29; recommend internal custom app per workspace — resolved in the Slack dossier).
- GHL refresh "valid indefinitely" `L2283` → **REFUTED** (F5: rotates per-use + dies 1yr unused).
- Google token facts `L2275–2279` → **VERIFIED but sharper** (F4: CASA, 100-token cap, 7-day Testing TTL).

## Reconciliations to make when drafting FRs

1. **`client_slug` in the `tools`/`credentials`/`rate_limit_tracker` tables** is a per-deployment label,
   not an RLS scoping key (ADR-006 — cross-client isolation is physical). Mirror the C1 reconciliation.
2. **Rate-limit numbers** (RL tier thresholds 80/95% are generic; the *underlying caps* are per-connector)
   come from the dossiers; the design doc's per-connector numbers are superseded.
3. **The agent/tool path is `service_role`** — no FR may assume RLS guards a tool call (ADR-006).

---

## Open decisions — all RESOLVED 🟢 (2026-06-25, per recommendation; OD-044 operator-delegated)

All seven resolved as recommended below. OD-044 was actioned via a dated **clarification note on ADR-007**
(control = "verified authenticated ingress"; HMAC is one instance). **FR drafting is now unblocked.**

| OD | Fork | Resolution | Note |
|---|---|---|---|
| **OD-044 ⭐** | ADR-007 says "webhook HMAC"; reality = HMAC (Slack) / Ed25519 (GHL) / OIDC-JWT + signed channel-token (Google) | Clarification note on ADR-007: control = "verified authenticated ingress," HMAC is one instance; CONN contract homes the per-vendor scheme | **Yes — amends a locked ADR** |
| OD-041 | GHL Private-app 5-agency install cap blocks client #6 | Pass GHL's optional Security Review (onboarding infra); flag the implicit 5-client v1 limit until then | Worth a nod (scaling/business) |
| OD-039 | Slack Enterprise Grid: per-workspace vs org-ready app | Per-workspace default; org-ready only for multi-workspace Grid clients | Delegable |
| OD-040 | Slack bot-token rotation ON/OFF | OFF by default | Delegable |
| OD-042 | GHL webhook receiver contract (docs contradict on retries) | Durable-queue → 2xx on receipt, dedup on `deliveryId`, idempotent (generic CONN pattern) | Delegable |
| OD-043 | GHL dossier re-verify cadence (high-staleness vendor) | Shorten to 90 days + standing changelog poll | Delegable |
| OD-045 | Google Drive `drive.file` vs `drive.readonly` (CASA) | `drive.file` default; escalate to `readonly` only for full-corpus ingest + client accepts CASA | Delegable |

Plus the **AF-098 (GHL PHI/BAA)** legal gate: ingesting PHI from a HIPAA-enabled GHL location is blocked
until the BAA chain is resolved (not an OD — a legal feasibility item, but it gates GHL ingest scope).

## Functional requirements

> **Deferred until the C3 ODs above are resolved.** FRs (CONN/REG/OBS/ACT/TRIG/OPT/RL/TOK/DSC) are then
> drafted — **generic CONN contract FRs first** (they define the runtime every instance plugs into), then
> the three connector instances — each citing its dossier (not the design doc) for vendor facts, then
> taken through ACs → the per-component verification gate → sign-off, per the Phase-1 playbook. Per-FR
> `Ready` is additionally gated on the build-time AFs noted above (e.g. Slack history-ingest FRs on
> AF-083; GHL webhook FRs on AF-090).
