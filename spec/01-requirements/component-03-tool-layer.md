# Component 3 — Tool Layer (Connectors)

> **Change-control note (2026-06-26, session 22 — clerical, non-substantive):** this file was authored
> (sessions 19–20) under a pre-canonical component numbering where Guardrails = "C7" and Observability = "C8".
> The canonical mapping is **C6 Guardrails · C7 Observability · C8 Agent design** (see `system-map/README.md`).
> All seam/surface cross-references were relabelled to match (every "C7"→**C6** Guardrails, every Observability
> "C8"→**C7**); the agent-design carry-ins (`C5/C6/C8`, `C2/C5/C6/C8`, "C8 agent UX") were preserved unchanged.
> No FR, AC, decision, or vendor fact changed — only the component-number labels on seams. Surfaced by the
> C5→C6 repo self-sufficiency handoff test.

- **Status:** 🟢 **Approved 2026-06-25** — **53 FRs**, verification gate run + reconciled; research-first
  gate PASSED + all C3 ODs resolved (session 19). **53 FRs** =
  38 generic runtime (CONN ×5 · REG ×4 · TOK ×6 · RL ×8 · ACT-limits ×2 · TRIG ×3 · OPT ×4 · DSC ×6) +
  15 connector instances (OBS ×4 · ACT ×5 · TOK ×3 · TRIG ×3). All three dossiers gate-passed:
  **GHL 🟢 · Google 🟢 · Slack 🟡**. Vendor facts cite the dossiers, not the design doc. **Three viability
  gates** hold specific FRs back from build until cleared: Slack history ingest
  (FR-3.OBS.002/TOK.009/TRIG.004/TRIG.006 Slack arms) → **AF-083/084**; GHL webhook (FR-3.TRIG.004 GHL arm)
  → **AF-090**; GHL PHI ingest (FR-3.OBS.001) → **AF-098**.
- **Sign-off:** ☑ **Approved 2026-06-25, user-authorized** (delegated, C1/C2-style) — ODs resolved (session
  19), verification gate run + all findings reconciled in-file; the cross-component catch (C0 FR-0.WHK.002
  GHL HMAC→Ed25519) corrected via change-control under **OD-046** (operator accepted at sign-off).

> **Verification gate (2 zero-context subagents, session 20, 2026-06-25):**
> - **Orphan/contradiction pass — NEEDS-RECONCILIATION (1 issue), now reconciled.** No orphaned design lines
>   (all L1968–2382 intents map to FRs; stale per-connector numbers correctly superseded by dossiers), no
>   internal C3 contradictions, citations clean, **all 6 traps PASS** (no `client_slug` RLS key · agent path
>   `service_role` · external content boundary-tagged · golden-rule `source_ref` not copy · every write
>   idempotent · FR-3.TRIG.004 correctly homes OD-044's per-vendor schemes). **One cross-component
>   contradiction caught:** C0 **FR-0.WHK.002** (Approved) specced GHL webhook auth as HMAC-SHA256 — stale;
>   the dossier + ADR-007 OD-044 note make it **Ed25519**. Corrected via change-control under **OD-046**.
> - **Quality/failure pass — 10 findings (2 HIGH, 7 MED, 1 LOW), ALL reconciled in-file:** **+FR-3.TRIG.005**
>   (watch/subscription re-arm — Gmail/Drive/Calendar watches expire with no auto-renew; a missed re-arm now
>   enters the degraded flow + health panel, closing a HIGH silent-loss hole); **+FR-3.TRIG.006**
>   (event-delivery gap detection + reconciliation — Slack auto-disable/late-drop had no specced detect-and-
>   reconcile mechanism, only prose; HIGH); **+AC-3.CONN.004.4** (durable pre-call intent record); tightened
>   **AC-3.TOK.005.2** (post-refresh-pre-persist crash → grace-window retry then degrade loudly, no false
>   "prior state intact"); **+AC-3.RL.006.2** (irreversible/billed writes route to halt-and-escalate,
>   excluded from auto-retry); **+AC-3.DSC.003.2/.3 + AC-3.DSC.004.2** (resume re-checks authorization;
>   paused-task set + escalation clock persisted across restart); **+AC-3.OPT.004.2** (gap flag is
>   structured/mandatory-to-read); **+AC-3.CONN.005.3** (delete-granting scopes excluded — cheapest gate for
>   hard-limit #3) + FR-3.ACT.002 note (financial/impersonation limits have **no** C3 mechanism — wholly
>   C6+AF-068); persisted RL.004 queue + drain re-consults idempotency. Confirmed-adequate: token no-leak,
>   the GHL rotating-refresh persist spine, draft-to-approval for email/calendar, fail-closed boundary tag,
>   physical isolation, the OD-044 per-vendor signatures, OD-010 named-not-solved at every write FR.
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
  tool content as instructions (injection defense) `L2062–2063`. *(ADR-007; enforcement seam → C6.)*
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
- **RL-6** rate-limit on a **high-risk** action → halt + escalate to human, **never auto-retry** `L2183–2190` *(seam → C6)*.
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
- **→ C6 (Guardrails):** approval-gate enforcement, the high-risk rate-limit **halt + escalate**
  `L2183–2190`, and hard-limit enforcement machinery. C3 *names* the rule; C6 *enforces* the escalation.
- **→ C7 (Observability):** dashboard health panels `L2195,L2367–2371`, connector alerts `L2373–2379`,
  and disconnection/reconnection/rate-limit **event logging**. C3 emits; C7 surfaces.
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

> **Drafting status (session 20, 2026-06-25):** generic CONN-contract FRs + the three connector
> instances drafted at `Ready` (all C3 ODs resolved last session; ACs written). **Vendor facts cite the
> dossiers, never the design doc** (per the stale/refuted table above). **Three FRs carry a viability
> gate** — they are `Ready` on paper but do **not** advance to build until their gating AF clears:
> Slack history-ingest (FR-3.OBS.002 Slack arm, FR-3.TOK.009, FR-3.TRIG.004 Slack arm) on **AF-083**;
> GHL webhook verification (FR-3.TRIG.004 GHL arm) on **AF-090**; GHL PHI-location ingest (FR-3.OBS.001)
> on **AF-098**. Sign-off → `Approved` is the user's call after the per-component verification gate.

---

# CONN — Connector contract (the spine)

### FR-3.CONN.001 — Every tool is a registered capability with a defined contract shape
- **Statement:** The system shall model every tool as a registered capability with a fixed contract shape — name, plain-English description, category (`read` | `write`), risk level, approval requirement, owning connector, scope set, and config — so the AI selects and invokes tools through one uniform interface regardless of vendor.
- **Source:** design-doc-v4.md L1976, L2021, L2033, L2037, L2072–2090
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** N/A (definitional; the registry FR-3.REG.001 stores it; the harness reads it to select tools).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: a tool is described once in the registry by its contract fields; the AI chooses it by description (FR-3.REG.002) and invokes it through the shared runtime, which applies the contract (category → read/write path, risk → approval gate, connector → token + rate-limit context).
  - Branches: `category=read` → read-only path (no mutation, cacheable per FR-3.OPT.002); `category=write` → the higher-risk action path (FR-3.ACT.001) with approval + idempotency obligations.
  - Edge / failure: a tool whose contract is missing a required field is not registrable (FR-3.REG.001 rejects it) — there is no "partially defined" tool.
- **Data touched:** `DATA-tools` (read).
- **Permissions:** tool *invocation* runs on the agent path as `service_role` (ADR-006); registry *edits* are Admin/Super-Admin (PERM-tool.manage, homed in C1/C6).
- **Config dependencies:** —
- **Surfaces:** tool registry admin view (Phase 3).
- **Observability:** tool selection + invocation logged to `event_log` (C7 surfaces).
- **Acceptance criteria:**
  - AC-3.CONN.001.1 — Given a registered tool, When inspected, Then it carries all contract fields (name, description, category, risk_level, requires_approval, connector, scopes, config) with values in their domains.
  - AC-3.CONN.001.2 — Given a `read` tool, When invoked, Then no external mutation occurs; Given a `write` tool, When invoked, Then it traverses the action path (FR-3.ACT.001).
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** This is the design doc's "boilerplate" mandate (L1976) made into a contract. The three first connectors (GHL/Google/Slack) are *instances* that fill this shape; future tools inherit it unchanged.

### FR-3.CONN.002 — The shared tool runtime owns the safety machinery once
- **Statement:** The system shall implement the connector safety machinery — token refresh-and-persist, the rate-limit tracker + backoff, external-data boundary-tagging, idempotent safe re-run, and the disconnection/recovery flow — once in a shared runtime that every connector inherits, so no connector can individually regress a non-negotiable.
- **Source:** design-doc-v4.md L1976, L1984–1986; ADR-001, ADR-004, ADR-007
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** N/A (architectural invariant; realised by FR-3.TOK.*, FR-3.RL.*, FR-3.CONN.003/004, FR-3.DSC.*).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: a connector instance supplies only its *parameters* (endpoints, field mappings, transport, token TTL/rotation, scope set, batch limits, validators); all enforcement (refresh-persist, rate tracking, boundary tag, idempotency, recovery) is the runtime's, applied identically to every connector.
  - Branches: a new connector added later inherits the full machinery by conforming to the contract — no new safety code per tool.
  - Edge / failure: a connector that needs behaviour the runtime does not provide is a runtime change under change control, not a per-connector bypass.
- **Data touched:** N/A (composes the other FRs).
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** —
- **Acceptance criteria:**
  - AC-3.CONN.002.1 — Given any registered connector, When it performs a read, Then boundary-tagging (FR-3.CONN.003), rate-tracking (FR-3.RL.002), and token validity (FR-3.TOK.*) are applied by the runtime without connector-specific code.
  - AC-3.CONN.002.2 — Given a second connector instance, When added, Then it supplies parameters only and introduces no new copy of the refresh/rate-limit/recovery logic.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** This FR is the spine. It is *why* the F5/GHL rotating-refresh trap (FR-3.TOK.005) is solved in one place, not per connector. Lifecycle standard grows from this example post-C3 (per the architectural-spine note above).

### FR-3.CONN.003 — Boundary-tag all ingested tool content as untrusted at the point of read
- **Statement:** The system shall tag every piece of external content returned by a read tool with the external-data boundary tag (untrusted) at the point of ingestion, before it reaches memory or any prompt, so downstream layers treat tool content as data and never as instructions.
- **Source:** design-doc-v4.md L2025, L2962–2965; ADR-007 (containment-first; boundary tag)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Every read-tool invocation (FR-3.OBS.*).
- **Preconditions:** A read tool returns external content.
- **Behaviour:**
  - Happy path: the runtime wraps/annotates returned content with the boundary tag (glossary: external-data boundary tag) and hands it to C2 ingestion (FR-2.ING.*) or to the live-data cross-check (FR-2.MNT.011) already marked untrusted.
  - Branches: applies uniformly to CRM records, messages, emails, documents, and calendar data — there is no "trusted source" exemption.
  - Edge / failure: if tagging cannot be applied, the content is not forwarded (fail-closed) — never inject untagged external content (protects #2; the seam to C2 assumes everything arriving is tagged).
- **Data touched:** N/A (annotation in transit; C2 stores the provenance).
- **Permissions:** N/A (runtime).
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** boundary-tagged ingestion volume is observable (C7).
- **Acceptance criteria:**
  - AC-3.CONN.003.1 — Given any read tool returns content, When the runtime forwards it, Then the content carries the external-data boundary tag.
  - AC-3.CONN.003.2 — Given tagging fails, When forwarding is attempted, Then the content is not forwarded and the failure is logged (not silent — #3).
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-088 (prompt-injection mitigation for untrusted Slack/external text flowing into memory/LLM — the containment control, ADR-007).
- **Notes:** C3 *applies* the tag; ADR-007's containment posture (sole-writer memory, hard limits) is what makes a successful injection *contained*. The tag is the deterministic always-on layer, not a detector.

### FR-3.CONN.004 — Every external write is idempotent / safe to re-run
- **Statement:** The system shall make every external write safe to re-run, using an app-side send-once guard keyed on a deterministic idempotency key, because the first three connectors offer no native write-idempotency (GHL, Gmail, Slack) and a retry must never produce a duplicate side effect.
- **Source:** design-doc-v4.md L2039–2045; ADR-004 (idempotency); dossiers — gohighlevel.md §10 L158–161, google-gmail.md §10 L162, slack.md §10 L134
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Every write-tool invocation (FR-3.ACT.*).
- **Preconditions:** A write tool is about to perform an external mutation.
- **Behaviour:**
  - Happy path: the runtime derives a stable idempotency key for the action and records intent before the call; on a retry with the same key it suppresses a second external effect (returns the prior result).
  - Branches: GHL contact create → use `POST /contacts/upsert` (idempotent create-or-update) rather than raw create (gohighlevel.md §10 L158–160); Gmail send → app-side dedup (no native key, google-gmail.md §10 L162); Calendar insert → client-supplied `id` yields 409 on re-run (google-gmail.md §10 L163, ⚠️ AF-102); Slack `chat.postMessage` → app-side write-dedup on `ts`/key before retry (slack.md §10 L134).
  - Edge / failure: GHL outbound message send is **irreversible and billed on attempt** — the send-once guard must prevent a duplicate *before* the call, not compensate after (gohighlevel.md §10 L161); the partial-chain compensation problem (multi-write task halts mid-way) is **OD-010**, owned at C5/C6/C8 — named here as an exposure point, not solved.
- **Data touched:** an app-side idempotency/dedup ledger (Schema: `idempotency_ledger` — consolidated in `spec/04-data-model/schema.md`, Phase 4.).
- **Permissions:** N/A (runtime).
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** suppressed-duplicate events logged (C7).
- **Acceptance criteria:**
  - AC-3.CONN.004.1 — Given a write performed once, When the identical write is retried with the same idempotency key, Then no second external side effect occurs.
  - AC-3.CONN.004.2 — Given a GHL contact create, When invoked, Then it routes through `/contacts/upsert`.
  - AC-3.CONN.004.3 — Given a Slack post that times out and is retried, When re-sent, Then the app-side dedup prevents a double-post.
  - AC-3.CONN.004.4 — Given any external write, When invoked, Then a durable intent record keyed on the idempotency key is committed **before** the external call is made; a crash after the call but before completion does not permit a second external effect on retry.
- **Open decisions:** — (OD-010 is a carry-in at C5/C6/C8, not a blocker here)
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-085 (Slack post-message app-side write-dedup design), AF-095 (confirm GHL has no `Idempotency-Key`), AF-102 (Calendar 409-duplicate idempotency holds in a distributed system).
- **Notes:** Idempotency is a *runtime contract obligation* (FR-3.CONN.002), realised per connector via the dossier-specified mechanism. "Never cache writes" (FR-3.OPT.002) is the complementary rule.

### FR-3.CONN.005 — Each connector requests only its minimal scope set
- **Statement:** The system shall request, for each connector, only the minimal OAuth scope set required for the tools that connector exposes — separate read and write scopes — so a compromised or over-broad grant cannot do something it shouldn't (#2).
- **Source:** design-doc-v4.md L2037 (least-privilege); ADR-005 §5 (per-client OAuth apps); dossiers — gohighlevel.md §8 L127–135, google-gmail.md §8 L122–146, slack.md §8 L114–120
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Connector provisioning / OAuth consent (ADR-005).
- **Preconditions:** A connector's tool set is defined.
- **Behaviour:**
  - Happy path: provisioning requests the dossier-pinned minimal scopes — read scopes for observation tools, write scopes only when an action tool exists; a deployment that uses only reads never requests a write scope.
  - Branches: Google Drive scope is **OD-045-resolved** — `drive.file` (non-sensitive, no CASA) is the default; escalate to `drive.readonly` (restricted, CASA) only for full-corpus ingest with client acceptance (google-gmail.md §8, OD-045); Slack email resolution adds `users:read.email` only if email is needed (slack.md §8 L114–119).
  - Edge / failure: a tool whose required scope was not granted is unavailable and degrades gracefully (FR-3.OPT.004), never silently returns empty.
- **Data touched:** `DATA-connector_credentials.scopes` (read).
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** connector setup / OAuth screen (Phase 3).
- **Observability:** granted vs required scope gaps surfaced on the health panel (FR-3.DSC.005).
- **Acceptance criteria:**
  - AC-3.CONN.005.1 — Given a read-only deployment, When provisioned, Then no write scope is requested.
  - AC-3.CONN.005.2 — Given Drive default config, When provisioned, Then `drive.file` is requested (not `drive.readonly`) unless full-corpus ingest is explicitly enabled.
  - AC-3.CONN.005.3 — Given any connector's requested scope set, When reviewed, Then no scope that grants destructive delete-of-record is requested (e.g. GHL `conversations.write`'s thread-delete capability, full `drive`) — partly enforcing hard limit #3 (FR-3.ACT.002) at the cheapest possible gate, the grant itself.
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-098 (GHL PHI/BAA chain gates HIPAA-location read scope — see FR-3.OBS.001).
- **Notes:** Minimal-scope strings per connector are pinned in FR-3.OBS.*/FR-3.ACT.* from the dossiers. CASA lead time (~6 weeks) for `drive.readonly` is an onboarding critical path (ADR-005; google-gmail.md §7).

---

# REG — Tool registry

### FR-3.REG.001 — The `tools` registry table
- **Statement:** The system shall store every tool in a `tools` registry row carrying name, description, category (`read`|`write`), risk_level, requires_approval, connector, config, enabled, version, previous_version_id, and change_reason.
- **Source:** design-doc-v4.md L2072–2090
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** N/A (schema; Phase 4 authors the SQL).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: every registered tool populates all fields; `category ∈ {read, write}`, `requires_approval` boolean, `enabled` boolean, `connector` references a configured connector.
  - Branches: `enabled=false` removes the tool from AI selection without deleting its history; `requires_approval=true` forces the action through the approval queue (C6).
  - Edge / failure: a row missing a required contract field (FR-3.CONN.001) is rejected — no partially-defined tool is registrable.
- **Data touched:** `DATA-tools` (defined here; SQL in Phase 4).
- **Permissions:** registry writes = Admin/Super-Admin (PERM-tool.manage, C1/C6); default-deny otherwise.
- **Config dependencies:** —
- **Surfaces:** tool registry admin view (Phase 3).
- **Observability:** —
- **Acceptance criteria:**
  - AC-3.REG.001.1 — Given a tool row, When inspected, Then all fields are present with values in their domains.
  - AC-3.REG.001.2 — Given a row with `enabled=false`, When the AI selects tools, Then it is not offered.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** `DATA-tools` is consolidated in Phase 4. `client_slug` is **not** a column-as-RLS-key here (see FR-3.REG.004).

### FR-3.REG.002 — The plain-English description drives AI tool selection
- **Statement:** The system shall drive AI tool selection from each tool's plain-English description, and shall treat description quality as a testable property of the registry (a poorly-described tool is mis-selected).
- **Source:** design-doc-v4.md L2093–2097
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** The harness, at tool-selection time within a task run.
- **Preconditions:** Tools are registered with descriptions.
- **Behaviour:**
  - Happy path: the AI matches the task need against tool descriptions and selects the best-fit tool; below a confidence threshold it asks rather than guesses (FR-3.OPT.001).
  - Branches: ambiguous/overlapping descriptions → confidence-gate triggers a clarification (FR-3.OPT.001) rather than a wrong call.
  - Edge / failure: a missing/empty description makes the tool unselectable — caught at registration (FR-3.REG.001).
- **Data touched:** `DATA-tools.description` (read).
- **Permissions:** N/A.
- **Config dependencies:** CFG-tool_selection_confidence_threshold (FR-3.OPT.001).
- **Surfaces:** N/A.
- **Observability:** tool-selection decisions logged (C7) for description-quality review.
- **Acceptance criteria:**
  - AC-3.REG.002.1 — Given a clearly-described tool and a matching task, When the AI selects, Then it picks that tool.
  - AC-3.REG.002.2 — Given two ambiguous descriptions, When selection confidence is below threshold, Then the AI asks instead of calling.
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-031-adjacent — selection accuracy from descriptions is an EVAL property (homed with the prompt-architecture/eval work; named here as testable).
- **Notes:** Description quality is a first-class registry concern, not a code concern — this is why it's an FR.

### FR-3.REG.003 — Tools are versioned; `change_reason` is mandatory on every version
- **Statement:** The system shall version every tool and require a non-empty `change_reason` on each new version, linking to `previous_version_id`, so every change to a tool's behaviour is traceable.
- **Source:** design-doc-v4.md L2084–2089
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Admin/Super-Admin editing a tool.
- **Preconditions:** A tool exists.
- **Behaviour:**
  - Happy path: editing a tool creates a new version row with `previous_version_id` set and `change_reason` populated; the prior version is retained.
  - Branches: a rollback is itself a new version citing the reason.
  - Edge / failure: a version save with an empty `change_reason` is rejected (no silent behavioural change).
- **Data touched:** `DATA-tools` (version, previous_version_id, change_reason — write).
- **Permissions:** Admin/Super-Admin (PERM-tool.manage); default-deny.
- **Config dependencies:** —
- **Surfaces:** tool version history (Phase 3).
- **Observability:** version changes audited (C7 / audit).
- **Acceptance criteria:**
  - AC-3.REG.003.1 — Given a tool edit, When saved, Then a new version row exists with `previous_version_id` and a non-empty `change_reason`.
  - AC-3.REG.003.2 — Given an edit with empty `change_reason`, When saving, Then it is rejected.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Mirrors change-control discipline at the tool grain.

### FR-3.REG.004 — The registry is per-deployment; `client_slug` is a label, not an RLS key
- **Statement:** The system shall scope the tool registry to its own deployment, treating any `client_slug` field as a per-deployment label only — never as an RLS scoping predicate — because cross-client isolation is physical (one Supabase per client, ADR-001/006).
- **Source:** design-doc-v4.md L2083; ADR-001, ADR-006 (the C1 `client_slug` reconciliation)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** N/A (architectural reconciliation).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: each client's deployment has its own `tools`/`credentials`/`rate_limit_tracker` tables in its own Supabase; no policy filters by `client_slug`.
  - Branches: the label may appear for human readability/labelling, never in a security predicate.
  - Edge / failure: any policy or query that tried to use `client_slug` to separate clients is a defect — cross-client separation is the physical silo, full stop.
- **Data touched:** `DATA-tools`, `DATA-connector_credentials`, `DATA-rate_limit_tracker` (label field only).
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** —
- **Acceptance criteria:**
  - AC-3.REG.004.1 — Given any C3 table, When its RLS/policies are reviewed, Then none filters by `client_slug`.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Mirrors the C1 reconciliation exactly (ADR-006 deleted `client_slug` from policies). The agent/tool path is `service_role` anyway (FR-3.CONN.001 permissions). (Phase-4 reconciliation: the column is DELETED, not label-only — OD-096 / FR-10.ISO.001; it exists only in management-plane `client_registry`.)

---

# TOK — OAuth token lifecycle

### FR-3.TOK.001 — Credentials live encrypted in a `credentials` store; never in logs/env/UI/config
- **Statement:** The system shall store connector credentials (access token, refresh token, expires_at, scopes, timestamps) encrypted in a `credentials` table backed by Supabase Vault, and shall never expose a token in logs, environment variables, the UI, or config.
- **Source:** design-doc-v4.md L2231–2244; ADR-001 (secrets custody), ADR-008 (in-DB → backed up)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Token storage on OAuth grant / refresh.
- **Preconditions:** A connector is being authorized.
- **Behaviour:**
  - Happy path: access + refresh tokens are stored encrypted (Vault); reads decrypt only in the runtime at call time; `expires_at`, `scopes`, `created/updated_at` accompany them.
  - Branches: rotation-enabled connectors store the new refresh token on every rotation (FR-3.TOK.005).
  - Edge / failure: any code path that would write a token to a log line, env var, UI field, or config file is forbidden — a leak is a #2 violation; redaction is enforced at the logging boundary.
- **Data touched:** `DATA-connector_credentials` (encrypted access/refresh, expires_at, scopes, timestamps).
- **Permissions:** decrypt = runtime/`service_role` only; never a human-readable surface.
- **Config dependencies:** —
- **Surfaces:** connector status only ever shows *metadata* (last refresh, expiry countdown), never token material (FR-3.DSC.005).
- **Observability:** refresh successes/failures logged *without* token values.
- **Acceptance criteria:**
  - AC-3.TOK.001.1 — Given a stored credential, When the row is read, Then access and refresh tokens are encrypted at rest.
  - AC-3.TOK.001.2 — Given any log/UI/env/config output, When inspected, Then no token material appears.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** `credentials` being in-DB means ADR-008 backup covers it; the golden rule (no source-file copies) is unaffected — tokens are operational secrets, not business source data.

### FR-3.TOK.002 — Layer 1: proactive refresh of soon-to-expire tokens
- **Statement:** The system shall run a proactive refresh job at a fixed interval (default every 15 minutes) that refreshes any access token expiring within a lead window (default 30 minutes), so tokens are renewed before a call needs them.
- **Source:** design-doc-v4.md L2250–2255
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Scheduled job (every `CFG-token_refresh_interval_minutes`, default 15).
- **Preconditions:** Connectors with refreshable tokens exist.
- **Behaviour:**
  - Happy path: the job finds tokens with `expires_at` within `CFG-token_refresh_lead_minutes` (default 30) and refreshes them, persisting new access (and rotated refresh, FR-3.TOK.005) tokens.
  - Branches: connectors with non-expiring tokens (Slack `xoxb` default, FR-3.TOK.009) are skipped.
  - Edge / failure: a refresh failure here does not yet fail a user call (Layer 2 still catches it); a hard failure escalates toward Layer 3 re-auth (FR-3.TOK.004) and surfaces on the health panel.
- **Data touched:** `DATA-connector_credentials` (read expiry; write new tokens).
- **Permissions:** runtime/`service_role`.
- **Config dependencies:** CFG-token_refresh_interval_minutes (15), CFG-token_refresh_lead_minutes (30).
- **Surfaces:** N/A (health panel shows results).
- **Observability:** refresh outcomes logged; repeated failures alert (FR-3.DSC.006).
- **Acceptance criteria:**
  - AC-3.TOK.002.1 — Given a token expiring within the lead window, When the job runs, Then it is refreshed and the new token persisted before expiry.
  - AC-3.TOK.002.2 — Given a non-expiring token, When the job runs, Then it is skipped.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Layer 1 of the 3-layer model; targets the 99%-invisible goal (FR-3.TOK.006).

### FR-3.TOK.003 — Layer 2: reactive refresh on a 401, retry once
- **Statement:** The system shall, on receiving a 401 from a connector, refresh the token and retry the call exactly once before treating the call as failed.
- **Source:** design-doc-v4.md L2257–2262
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any tool call that returns 401.
- **Preconditions:** A call was made with a token believed valid.
- **Behaviour:**
  - Happy path: 401 → refresh token → retry the same call once → success.
  - Branches: if the retry also fails (or refresh fails), the call fails and the connector moves toward degraded/re-auth (FR-3.TOK.004); never retry-loop on 401.
  - Edge / failure: a 401 on a high-risk write does not auto-retry indefinitely — single retry only, then halt (composes with FR-3.RL.006 / approval rules).
- **Data touched:** `DATA-connector_credentials` (refresh).
- **Permissions:** runtime/`service_role`.
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** reactive-refresh events logged.
- **Acceptance criteria:**
  - AC-3.TOK.003.1 — Given a 401, When the runtime handles it, Then it refreshes and retries exactly once.
  - AC-3.TOK.003.2 — Given the retry also returns 401, When handled, Then the call fails and the connector degrades (no further auto-retry).
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Layer 2 backstops Layer 1's timing gaps.

### FR-3.TOK.004 — Layer 3: dead refresh token → degraded state → one-click re-auth
- **Statement:** The system shall, when a refresh token is dead (revoked/expired/invalid), move the connector to a degraded state and surface a one-click dashboard re-authorization, rather than silently failing tasks.
- **Source:** design-doc-v4.md L2264–2269, L2301–2342
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A refresh attempt that fails because the refresh token is invalid.
- **Preconditions:** Layers 1/2 could not recover.
- **Behaviour:**
  - Happy path: connector → `degraded`; dependent tasks pause; the dashboard shows a one-click OAuth re-connect (FR-3.DSC.002); on reconnect, paused tasks auto-resume (FR-3.DSC.003).
  - Branches: refresh-token death causes per connector — Google (6-mo unused / password reset / 100-token overflow), GHL (1-yr unused / rotation-persist miss), Slack (uninstall / `auth.revoke`) — all converge to this same degraded→re-auth path.
  - Edge / failure: never drop a task on the floor — it pauses and is recoverable; the degradation is loudly surfaced (#3), not a silent failure.
- **Data touched:** `DATA-connector_credentials` (state); paused-task references.
- **Permissions:** re-auth action = Admin/Super-Admin for system-wide connectors (RBAC); the OAuth consent is the connecting user's.
- **Config dependencies:** —
- **Surfaces:** degraded-connector modal/banner (FR-3.DSC.002); health panel (FR-3.DSC.005).
- **Observability:** degradation + re-auth logged + alerted (FR-3.DSC.006).
- **Acceptance criteria:**
  - AC-3.TOK.004.1 — Given a dead refresh token, When detected, Then the connector enters `degraded` and dependent tasks pause (not fail).
  - AC-3.TOK.004.2 — Given a one-click re-auth completes, When tokens are restored, Then paused tasks auto-resume (FR-3.DSC.003).
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Layer 3 of the model; the disconnection/recovery FRs (FR-3.DSC.*) implement the surfacing + resume.

### FR-3.TOK.005 — Persist the rotated refresh token atomically on every refresh
- **Statement:** The system shall, for any connector whose refresh token rotates on use, persist the newly-issued refresh token atomically as part of the refresh transaction — before the new access token is used — so a crash between refresh and persist can never strand the connector with a dead, unsaved refresh token.
- **Source:** dossiers — gohighlevel.md §2 L60–61 (GHL single-use rotating), slack.md §2 L57 (Slack rotation opt-in); ADR-004 (atomicity); AF-003 finding F5
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any token refresh on a rotating-refresh connector (GHL always; Slack if rotation enabled).
- **Preconditions:** A refresh is being performed.
- **Behaviour:**
  - Happy path: refresh call returns a new access **and** new refresh token → both persisted in one atomic write → only then is the new access token used for calls.
  - Branches: GHL — every refresh rotates (single-use; old invalidated); a 30s concurrency window returns the same token for racing refreshes (gohighlevel.md §2 L60). Slack — only if rotation is enabled (default OFF per OD-040); when on, the `xoxe-1-` refresh token must be persisted each rotation. Google — does **not** rotate on normal refresh (google-gmail.md §2 L65), so persist-new is a no-op there but harmless.
  - Edge / failure: if persistence fails, never use a new token whose refresh half was not saved (this is the #1 "silently lose access" trap the runtime exists to close). **The refresh (external HTTP) and the persist (local DB write) are not one transaction** — once the vendor rotates, the *old* refresh token is already dead server-side, so "retry with old state" will fail. The recovery path must retry the persist within the vendor's same-token grace window (GHL 30s, gohighlevel.md §2 L60) and, if that window is missed, move the connector to `degraded`/re-auth (FR-3.TOK.004) **loudly** — never silently retry-fail.
- **Data touched:** `DATA-connector_credentials` (atomic write of access + refresh).
- **Permissions:** runtime/`service_role`.
- **Config dependencies:** CFG-slack_token_rotation_enabled (default false, OD-040).
- **Surfaces:** N/A.
- **Observability:** rotation persistence success/failure logged.
- **Acceptance criteria:**
  - AC-3.TOK.005.1 — Given a GHL refresh, When it returns a rotated refresh token, Then access + refresh are persisted atomically before any call uses the new access token.
  - AC-3.TOK.005.2 — Given the persist fails after the vendor has rotated (old token already dead), When recovering, Then the persist is retried within the vendor's same-token grace window; if missed, the connector enters `degraded`/re-auth loudly — it is never left silently retry-failed, and no half-saved credential is used.
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-089-adjacent (GHL rotation correctness under concurrency — the 30s window). *(Block N GHL AF.)*
- **Notes:** This single FR, living in the runtime, is *why* FR-3.CONN.002 (machinery once) protects #1 — the GHL/Slack rotation trap is handled in one place for all connectors.

### FR-3.TOK.006 — Target: 99% of refreshes fully automatic and user-invisible
- **Statement:** The system should keep token maintenance automatic and user-invisible for the large majority of cases (design target ~99%), surfacing a manual re-auth only when the refresh chain is genuinely dead (FR-3.TOK.004).
- **Source:** design-doc-v4.md L2295
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** N/A (quality target measured over Layer-1/2 outcomes).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: Layers 1+2 (FR-3.TOK.002/003) resolve refreshes without user action; Layer 3 (re-auth) is the rare exception.
  - Branches: per-connector death causes (FR-3.TOK.004) are the expected residual that needs a human.
  - Edge / failure: a connector requiring frequent manual re-auth is a signal surfaced on the health panel for investigation.
- **Data touched:** refresh-outcome metrics (C7).
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** health panel trend (Phase 3 / C7).
- **Observability:** automatic-vs-manual refresh ratio is a tracked metric.
- **Acceptance criteria:**
  - AC-3.TOK.006.1 — Given normal operation, When refresh outcomes are measured, Then the automatic-resolution ratio is reported and visible.
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: the 99% figure is a paper target until measured under real connector behaviour (EVAL at build).
- **Notes:** This is a `Should` quality target, not a hard gate — it frames the Layer-1/2/3 design's success metric.

---

# RL — Rate-limit management

### FR-3.RL.001 — The `rate_limit_tracker` table
- **Statement:** The system shall track each connector's API usage in a `rate_limit_tracker` row carrying window_start, window_duration, limit, calls_made, and reset_at.
- **Source:** design-doc-v4.md L2144–2154
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** N/A (schema; updated by FR-3.RL.002).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: one tracker per connector per rate-limit window; fields reflect the connector's real limits (from the dossier, not the design doc).
  - Branches: connectors with multiple windows (e.g. GHL 100/10s burst **and** 200k/day) track each window.
  - Edge / failure: a call made without a tracker update is a defect (FR-3.RL.002 is the source-of-truth rule).
- **Data touched:** `DATA-rate_limit_tracker` (defined here; SQL Phase 4).
- **Permissions:** runtime/`service_role`.
- **Config dependencies:** —
- **Surfaces:** rate-limit status on the health panel (Phase 3 / C7).
- **Observability:** —
- **Acceptance criteria:**
  - AC-3.RL.001.1 — Given a connector with burst + daily limits, When tracked, Then both windows have tracker rows.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Underlying caps are per-connector (dossiers); the 80/95% tiers (FR-3.RL.003/004) are generic.

### FR-3.RL.002 — Check the tracker before every call, update after — the source of truth
- **Statement:** The system shall check the rate-limit tracker before every connector call and update it after, making the tracker the authoritative record of remaining quota.
- **Source:** design-doc-v4.md L2157
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Every connector call.
- **Preconditions:** A tracker exists for the connector/window.
- **Behaviour:**
  - Happy path: before-call check confirms headroom → call → after-call increment; vendor rate headers (e.g. GHL `X-RateLimit-Remaining`, gohighlevel.md §3 L72) reconcile the tracker when present.
  - Branches: at 80% → FR-3.RL.003; at 95% → FR-3.RL.004; at 429 → FR-3.RL.005.
  - Edge / failure: tracker and vendor headers disagree → trust the more conservative value and log the divergence (never silently over-call).
- **Data touched:** `DATA-rate_limit_tracker` (read/write).
- **Permissions:** runtime/`service_role`.
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** divergence between tracker and vendor headers logged.
- **Acceptance criteria:**
  - AC-3.RL.002.1 — Given a call, When made, Then the tracker is checked before and incremented after.
  - AC-3.RL.002.2 — Given vendor headers report less headroom than the tracker, When reconciling, Then the conservative value wins and the divergence is logged.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Tiers below read this tracker; isolation is per-deployment (FR-3.RL.007).

### FR-3.RL.003 — At 80% usage: slow non-urgent calls, protect urgent/human/approval-gated
- **Statement:** The system shall, at 80% of a window's limit, slow and deprioritise non-urgent and background calls while letting urgent, human-initiated, and approval-gated calls proceed.
- **Source:** design-doc-v4.md L2162–2168
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Tracker crossing `CFG-rate_alert_threshold` (default 80%).
- **Preconditions:** Usage ≥ threshold.
- **Behaviour:**
  - Happy path: background/batch jobs are throttled/deferred; user-facing and approval-gated actions continue.
  - Branches: distinguishes call urgency (background ingest vs a human-triggered action).
  - Edge / failure: misclassifying an urgent call as background would stall a user — urgency is an explicit call attribute, not inferred.
- **Data touched:** `DATA-rate_limit_tracker` (read).
- **Permissions:** runtime.
- **Config dependencies:** CFG-rate_alert_threshold (0.80).
- **Surfaces:** dashboard status (C7).
- **Observability:** throttle-engaged event logged + dashboard status.
- **Acceptance criteria:**
  - AC-3.RL.003.1 — Given usage at 80%, When a background call is queued, Then it is slowed/deferred while an urgent call proceeds.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** First of the graduated tiers; 95% (FR-3.RL.004) is stricter.

### FR-3.RL.004 — At 95% usage: pause non-critical, queue for post-window, log + surface
- **Statement:** The system shall, at 95% of a window's limit, pause non-critical calls and queue them for execution after the window resets, logging the pause and showing it on the dashboard.
- **Source:** design-doc-v4.md L2170–2174
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Tracker crossing 95%.
- **Preconditions:** Usage ≥ 95%.
- **Behaviour:**
  - Happy path: non-critical calls are queued with a run-after-`reset_at` time; critical/approval-gated calls still proceed within remaining headroom.
  - Branches: a high-risk action that hits this ceiling escalates rather than silently queueing (FR-3.RL.006).
  - Edge / failure: queued calls must actually run post-window — the queue is **persisted (survives a runtime restart)**, not best-effort (no silent drop); draining a queued **write** re-consults the idempotency guard (FR-3.CONN.004) so a deferred irreversible send cannot double-fire.
- **Data touched:** `DATA-rate_limit_tracker` (read); a deferred-call queue.
- **Permissions:** runtime.
- **Config dependencies:** —
- **Surfaces:** dashboard rate-limit status (C7).
- **Observability:** pause + queued-count logged and surfaced.
- **Acceptance criteria:**
  - AC-3.RL.004.1 — Given usage at 95%, When a non-critical call arrives, Then it is queued for post-reset and the pause is shown on the dashboard.
  - AC-3.RL.004.2 — Given the window resets, When the queue drains, Then queued calls execute (none dropped), the queue having survived any intervening restart, and each queued write re-consults the idempotency guard before firing.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Composes with FR-3.RL.006 for high-risk actions.

### FR-3.RL.005 — At 429: exponential backoff with jitter; honor `Retry-After` exactly
- **Statement:** The system shall, on a 429, back off exponentially with jitter and retry after the window resets, and shall honor a vendor-supplied `Retry-After` header exactly when present (Slack always supplies one).
- **Source:** design-doc-v4.md L2176–2181; dossiers — slack.md §3 L72 (`Retry-After`), gohighlevel.md §3 L73 (no documented Retry-After → AF-093), google-gmail.md §3 L77 (no Retry-After → AF-104)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any call returning 429.
- **Preconditions:** A call was rate-limited.
- **Behaviour:**
  - Happy path: Slack 429 → wait exactly `Retry-After` seconds then retry (slack.md §3 L72); GHL/Google 429 (no documented `Retry-After`) → app-side exponential backoff with jitter from `CFG-backoff_initial_ms` to `CFG-backoff_max_ms`.
  - Branches: a 429 on a **high-risk** action halts + escalates and is **never** auto-retried (FR-3.RL.006).
  - Edge / failure: unbounded retry is forbidden — backoff caps at `CFG-backoff_max_ms`; persistent 429 surfaces as a degraded/limited connector.
- **Data touched:** `DATA-rate_limit_tracker` (read reset_at).
- **Permissions:** runtime.
- **Config dependencies:** CFG-backoff_initial_ms (1000), CFG-backoff_max_ms (60000), CFG-backoff_multiplier (2 + jitter).
- **Surfaces:** N/A (status via C7).
- **Observability:** 429 + backoff events logged.
- **Acceptance criteria:**
  - AC-3.RL.005.1 — Given a Slack 429 with `Retry-After: N`, When retrying, Then the runtime waits exactly N seconds.
  - AC-3.RL.005.2 — Given a GHL 429 with no `Retry-After`, When retrying, Then it uses exponential backoff with jitter capped at `CFG-backoff_max_ms`.
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-093 (GHL outbound 429 backoff — no official `Retry-After`), AF-104 (Google jitter is our addition, not vendor-mandated), AF-086 (Slack quota-introspection headers beyond `Retry-After`).
- **Notes:** Jitter avoids synchronized retry storms across a deployment's queued calls.

### FR-3.RL.006 — A rate-limited high-risk action halts and escalates — never auto-retries
- **Statement:** The system shall, when a high-risk action is rate-limited, halt it and escalate to a human rather than auto-retrying, because silently retrying a consequential external action is unsafe.
- **Source:** design-doc-v4.md L2183–2190; ADR-007 (containment); seam → C6
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A high-risk/approval-gated action that hits a rate limit or 429.
- **Preconditions:** The action is classified high-risk (FR-3.ACT.001).
- **Behaviour:**
  - Happy path: rate-limit on a high-risk write → halt → escalate to a human via the approval/escalation path (C6) with context; no automatic retry.
  - Branches: low-risk/background calls follow the backoff/queue tiers (FR-3.RL.004/005) instead.
  - Edge / failure: the escalation itself must be delivered (loud, not silent — #3); a missed escalation is a defect.
- **Data touched:** `DATA-rate_limit_tracker` (read); escalation record (C6).
- **Permissions:** escalation routes to Admin/Super-Admin per C6.
- **Config dependencies:** —
- **Surfaces:** approval/escalation queue (C6, Phase 3).
- **Observability:** halt + escalation logged + alerted.
- **Acceptance criteria:**
  - AC-3.RL.006.1 — Given a high-risk action is rate-limited, When handled, Then it halts and a human escalation is raised — and it is not auto-retried.
  - AC-3.RL.006.2 — Given an action with `risk_level=high` **or any irreversible/billed external side effect** (e.g. a GHL message send), When it is rate-limited or 429s, Then it routes to this halt-and-escalate path and is **excluded** from the FR-3.RL.005 auto-retry path — regardless of any urgency flag.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** **Seam → C6** enforces the escalation machinery; C3 *names* the rule. Pairs with the hard limits (FR-3.ACT.002). The classification that routes a call here (vs the FR-3.RL.003/004/005 tiers) is the tool's `risk_level` (FR-3.REG.001) **plus** an irreversible/billed flag — urgency never overrides it.

### FR-3.RL.007 — Each deployment's rate tracker is physically isolated — no cross-client quota bleed
- **Statement:** The system shall keep each deployment's rate-limit tracker in that deployment's own Supabase, so one client's API usage can never consume or reveal another client's quota.
- **Source:** design-doc-v4.md L2199; ADR-001
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** N/A (isolation invariant).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: tracker rows live in the client silo; there is no shared/global rate ledger.
  - Branches: per-connector OAuth apps are also per-client (ADR-005 §5), so vendor-side quotas are separated too.
  - Edge / failure: any shared tracker would be a #2/isolation violation — forbidden.
- **Data touched:** `DATA-rate_limit_tracker` (per-silo).
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** —
- **Acceptance criteria:**
  - AC-3.RL.007.1 — Given two client deployments, When their trackers are inspected, Then they are physically separate with no shared row.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Physical isolation (ADR-001), consistent with FR-3.REG.004.

### FR-3.RL.008 — Rate-limit behaviour is configurable per connector
- **Statement:** The system shall expose the rate-limit controls as config — per-connector window limit, alert threshold (default 80%), and backoff initial/max/multiplier — so limits track each vendor's real caps without code change.
- **Source:** design-doc-v4.md L2203–2220
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Admin/Super-Admin config edit (Phase 2 taxonomy).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: each connector's limits are config values seeded from its dossier (GHL 100/10s + 200k/day; Slack per-method tiers; Gmail QU model); thresholds and backoff are tunable.
  - Branches: changing a limit takes effect for subsequent calls (no redeploy).
  - Edge / failure: a config limit set above the vendor's real cap would invite 429s — validation warns when a configured limit exceeds the dossier-pinned cap.
- **Data touched:** config store (Phase 2).
- **Permissions:** Admin/Super-Admin; default-deny.
- **Config dependencies:** CFG-rate_max_calls_per_connector_window, CFG-rate_alert_threshold (0.80), CFG-backoff_initial_ms (1000), CFG-backoff_max_ms (60000), CFG-backoff_multiplier (2).
- **Surfaces:** config admin (Phase 3).
- **Observability:** config changes audited.
- **Acceptance criteria:**
  - AC-3.RL.008.1 — Given a connector limit changed in config, When the next call is made, Then the new limit governs (no redeploy).
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** All CFG-* keys are classified in Phase 2 per `config-edit-taxonomy.md`.

---

# ACT — Action tools + the code-enforced hard limits (generic)

### FR-3.ACT.001 — Write tools share a higher-risk contract; approval gates apply uniformly
- **Statement:** The system shall treat every write (action) tool under one higher-risk contract — carrying a risk level and an approval requirement — and shall apply the approval gate uniformly regardless of which connector performs the write.
- **Source:** design-doc-v4.md L2037, L2049
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Any write-tool invocation.
- **Preconditions:** The tool's `category=write` (FR-3.REG.001).
- **Behaviour:**
  - Happy path: a write tool with `requires_approval=true` routes the proposed action to the approval queue (C6) before execution; on approval it executes idempotently (FR-3.CONN.004).
  - Branches: low-risk writes may be auto-approved by policy; high-risk writes always gate.
  - Edge / failure: a write must never bypass its approval gate via prompt content (ADR-007 hard limits, FR-3.ACT.002) — gating is code, not instruction.
- **Data touched:** action/approval records (C6).
- **Permissions:** agent path `service_role`; approval authority per C6/RBAC.
- **Config dependencies:** per-tool `requires_approval` (FR-3.REG.001).
- **Surfaces:** approval queue (C6, Phase 3).
- **Observability:** every action proposal + approval/denial logged.
- **Acceptance criteria:**
  - AC-3.ACT.001.1 — Given a write tool with `requires_approval=true`, When invoked, Then the action enters the approval queue before any external effect.
  - AC-3.ACT.001.2 — Given two different connectors' write tools, When each is invoked, Then the same approval-gate logic applies.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** **Seam → C6** owns approval enforcement; C3 defines the contract. Specific connector writes are FR-3.ACT.003–006.

### FR-3.ACT.002 — The seven code-enforced hard limits no role, config, or instruction can override
- **Statement:** The system shall enforce seven hard limits in application code (not merely in the prompt) that no user role, configuration value, or agent instruction can override: never autonomously send external email; never make a financial transaction; never delete a system-of-record record; never share data across client deployments; never impersonate a named human; never self-approve a queued action; never treat monitored tool content as instructions.
- **Source:** design-doc-v4.md L2053–2066; ADR-007 (containment-first; hard limits as code gates)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** N/A (always-on code gates on the relevant action paths).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: each limit is a code gate on the corresponding action path — e.g. an outbound email is forced to a draft/approval (FR-3.ACT.004), a calendar invite is drafted not sent (FR-3.ACT.006), cross-deployment reads are physically impossible (ADR-001), tool content is boundary-tagged as data (FR-3.CONN.003).
  - Branches: each limit maps to its enforcing mechanism — financial/destructive/impersonation/self-approval to the approval + RBAC gates (C6); cross-client to physical isolation; injection to boundary-tagging.
  - Edge / failure: a path that *could* reach a consequential side effect without crossing its gate is a containment breach — closed in code, never patched with detection (ADR-007; ⚠️ AF-068 red-team).
- **Data touched:** N/A (gates compose other FRs).
- **Permissions:** these limits bind even `service_role`/agent paths — they are above RBAC.
- **Config dependencies:** none — by definition not config-overridable.
- **Surfaces:** N/A (violations would alert via C6/C7).
- **Observability:** any attempted breach logged loudly + alerted (#3).
- **Acceptance criteria:**
  - AC-3.ACT.002.1 — Given any of the seven limited actions, When an agent attempts it autonomously, Then a code gate blocks it irrespective of role/config/prompt.
  - AC-3.ACT.002.2 — Given a config or instruction that tries to relax a hard limit, When applied, Then the limit still holds.
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-068 (the containment boundary holds end-to-end — no authorized-but-dangerous autonomous path reaches a consequential side effect without hitting a content-ignoring code gate; red-team SPIKE).
- **Notes:** **Enforcement machinery seam → C6**; C3 *declares* the limits as a contract obligation. This is ADR-007's "controls before gates" at the tool grain. **Per-limit honesty about where it's enforced:** external email → draft (FR-3.ACT.004); calendar → draft (FR-3.ACT.006); cross-client → physical isolation (ADR-001); tool-content-as-instructions → boundary tag (FR-3.CONN.003); destructive delete → *partly* at the scope grant (AC-3.CONN.005.3) + C6. **Two limits have NO C3 mechanism — financial transaction and impersonation rest wholly on C6 enforcement + the AF-068 red-team** (named here so the seam is visible, not silently assumed covered). **⚠️ FLAGGED FOR REVIEW — OD-047 (operator, 2026-06-25):** revisit the *set* (are seven enough?), the *rigidity* (absolute vs tier-gated — too strict could block legitimate automation; too lax could miss bulk-export/mass-delete/public-post), and *enforceability* (AF-068) at **C6**. Strict-by-default holds until then.

---

# TRIG — Trigger model

### FR-3.TRIG.001 — Developers build the webhook handler + parser + error handling once per connector
- **Statement:** The system shall provide, per connector, a developer-built trigger pipeline — inbound handler, payload parser, and error handling — built once as connector infrastructure, with the transport (native webhook / Pub-Sub / polling) varying per connector.
- **Source:** design-doc-v4.md L1984–1992
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Connector build time (developer), then runtime on inbound events.
- **Preconditions:** The connector's transport + signature scheme are known (FR-3.TRIG.004).
- **Behaviour:**
  - Happy path: an authenticated inbound event (verified by C0 webhook-auth, FR-0.WHK.*) is handed to the connector's parser → normalized event → trigger evaluation (FR-3.TRIG.002/003).
  - Branches: transport differs — GHL native webhook, Google Pub/Sub (Gmail) + channel callbacks (Drive/Calendar), Slack Events API (FR-3.TRIG.004); polling fallback where no push exists.
  - Edge / failure: a malformed/unverifiable payload is rejected at the handler (fail-closed); parser errors are logged, never silently dropped (#3).
- **Data touched:** inbound event records.
- **Permissions:** N/A (runtime).
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** inbound event volume + parse errors logged (C7).
- **Acceptance criteria:**
  - AC-3.TRIG.001.1 — Given an authenticated inbound event, When received, Then the connector parser normalizes it and passes it to trigger evaluation.
  - AC-3.TRIG.001.2 — Given a malformed payload, When received, Then it is rejected and logged (not silently dropped).
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** **Seam → C0** owns webhook *authentication* (HMAC/JWT/channel-token verify); C3 consumes the already-verified event. Signature schemes per connector are FR-3.TRIG.004.

### FR-3.TRIG.002 — End users configure which events/conditions fire which task, no code
- **Statement:** The system shall let end users configure, from the dashboard and without code, which connector events under which conditions trigger which task.
- **Source:** design-doc-v4.md L1994–1998
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Admin/authorized user configuring triggers in the dashboard.
- **Preconditions:** The connector's trigger infrastructure exists (FR-3.TRIG.001) and default trigger set is available (FR-3.TRIG.003).
- **Behaviour:**
  - Happy path: a user maps `event + condition → task` via the dashboard; the runtime evaluates the condition on each normalized event and launches the task when it matches.
  - Branches: conditions can filter (e.g. "lead tagged X", "message in channel Y").
  - Edge / failure: an invalid/overlapping rule is validated at save; a condition referencing a missing field is rejected.
- **Data touched:** trigger configuration records.
- **Permissions:** trigger config = Admin/authorized role (RBAC); default-deny.
- **Config dependencies:** —
- **Surfaces:** trigger configuration UI (Phase 3).
- **Observability:** trigger config changes audited; trigger firings logged.
- **Acceptance criteria:**
  - AC-3.TRIG.002.1 — Given a configured `event+condition→task` rule, When a matching event arrives, Then the task launches.
  - AC-3.TRIG.002.2 — Given a non-matching event, When received, Then no task launches.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** This is the "Layer 2 / dashboard config" half of the trigger model; FR-3.TRIG.001 is the "Layer 1 / dev infra" half.

### FR-3.TRIG.003 — Each connector ships a default trigger set, enable/disable per deployment
- **Statement:** The system shall ship each connector with a default set of triggers, each independently enable/disable-able per deployment.
- **Source:** design-doc-v4.md L2000–2017
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Admin enabling/disabling triggers per deployment.
- **Preconditions:** Connector configured.
- **Behaviour:**
  - Happy path: defaults are available out of the box — GHL (new lead, stage change, tag added, task overdue), Slack (message, DM), Gmail (new email), Calendar (event created, event starting), Drive (file created, file updated); each can be toggled.
  - Branches: a disabled default trigger fires nothing; a deployment can rely only on the subset it enables.
  - Edge / failure: enabling a trigger whose required scope/transport is missing surfaces the gap (FR-3.OPT.004 / FR-3.DSC.005).
- **Data touched:** trigger configuration (enabled flags).
- **Permissions:** Admin/authorized; default-deny.
- **Config dependencies:** per-trigger enabled flags.
- **Surfaces:** trigger configuration UI (Phase 3).
- **Observability:** enable/disable audited.
- **Acceptance criteria:**
  - AC-3.TRIG.003.1 — Given a connector, When set up, Then its default triggers are present and individually toggleable.
  - AC-3.TRIG.003.2 — Given a disabled default trigger, When its event occurs, Then nothing fires.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** The default *lists* are per-connector parameters (generic+param); the toggle mechanism is generic.

---

# OPT — Tool optimisation

### FR-3.OPT.001 — Confidence-gate tool selection; below threshold, ask rather than call
- **Statement:** The system shall gate tool selection on a confidence threshold and, when confidence is below it, ask for clarification rather than calling a possibly-wrong tool.
- **Source:** design-doc-v4.md L2103
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** The harness at tool-selection time.
- **Preconditions:** Candidate tools exist with descriptions (FR-3.REG.002).
- **Behaviour:**
  - Happy path: selection confidence ≥ `CFG-tool_selection_confidence_threshold` → call; below → ask the user/operator to disambiguate.
  - Branches: a high-risk write defaults to asking when ambiguous.
  - Edge / failure: never silently pick the wrong tool to avoid asking — a wrong external action is worse than a question.
- **Data touched:** N/A.
- **Permissions:** N/A.
- **Config dependencies:** CFG-tool_selection_confidence_threshold.
- **Surfaces:** clarification prompt (C8 agent UX).
- **Observability:** below-threshold ask events logged.
- **Acceptance criteria:**
  - AC-3.OPT.001.1 — Given selection confidence below threshold, When choosing a tool, Then the system asks instead of calling.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Threshold tuning is an EVAL concern (with the prompt-architecture work).

### FR-3.OPT.002 — Cache reads within a single task run; never cache writes
- **Statement:** The system shall cache read results within a single task run to avoid redundant calls, and shall never cache writes.
- **Source:** design-doc-v4.md L2105
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Repeated reads within one task run.
- **Preconditions:** A read was already performed this run.
- **Behaviour:**
  - Happy path: a second identical read in the same run returns the cached result; the cache is scoped to the run and discarded at its end.
  - Branches: writes are never cached and never served from cache (FR-3.CONN.004 idempotency is the write-side guard).
  - Edge / failure: stale-within-run risk is bounded by the single-run scope; cross-run caching is out of scope (freshness wins).
- **Data touched:** in-run cache (ephemeral).
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** cache hit/miss counts (optional, C7).
- **Acceptance criteria:**
  - AC-3.OPT.002.1 — Given a repeated identical read in one run, When requested, Then it is served from cache (no second call).
  - AC-3.OPT.002.2 — Given a write, When performed, Then it is never cached or served from cache.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Run-scoped only; complements "never cache writes" with the idempotency contract.

### FR-3.OPT.003 — Batch reads where the connector supports it
- **Statement:** The system shall batch read calls where the connector supports batching, up to that connector's documented batch limit.
- **Source:** design-doc-v4.md L2107; dossier — google-gmail.md §4 L86 (Gmail batch ≤100, recommend ≤50)
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** Multiple reads issuable as a batch.
- **Preconditions:** The connector exposes a batch endpoint.
- **Behaviour:**
  - Happy path: eligible reads are grouped to the connector's batch limit (Gmail per-API batch, recommend ≤50 to avoid rate-limiting; Slack/GHL per their pagination models).
  - Branches: connectors without batching issue individual calls under the rate tiers (FR-3.RL.*).
  - Edge / failure: batch size above the vendor max is rejected/clamped (no over-large batch).
- **Data touched:** N/A.
- **Permissions:** N/A.
- **Config dependencies:** per-connector batch-size limit.
- **Surfaces:** N/A.
- **Observability:** —
- **Acceptance criteria:**
  - AC-3.OPT.003.1 — Given a batch-capable connector, When multiple reads are issued, Then they are grouped within the documented batch limit.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Batch limits are per-connector parameters (Gmail global batch endpoint was retired 2020; per-API batch only — google-gmail.md §4).

### FR-3.OPT.004 — Graceful degradation: a missing tool logs, completes what it can, flags the gap
- **Statement:** The system shall, when a tool is unavailable, log the gap, complete whatever the task can do without it, and flag what was skipped — never hard-fail the whole task.
- **Source:** design-doc-v4.md L2109
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A task needing a tool that is disconnected/disabled/unscoped.
- **Preconditions:** A required tool is unavailable.
- **Behaviour:**
  - Happy path: the task proceeds with available tools, records what it couldn't do, and surfaces the gap to the operator.
  - Branches: a fully blocking dependency pauses the task (recoverable, FR-3.DSC.003) rather than erroring out.
  - Edge / failure: silently producing a partial result *as if complete* is forbidden — the gap is always flagged (#3).
- **Data touched:** task result + gap annotations.
- **Permissions:** N/A.
- **Config dependencies:** —
- **Surfaces:** task result surface (C7) shows the flagged gap.
- **Observability:** missing-tool events logged + surfaced.
- **Acceptance criteria:**
  - AC-3.OPT.004.1 — Given a missing tool, When a task runs, Then it completes the doable part and flags the skipped part (no hard fail, no silent partial).
  - AC-3.OPT.004.2 — Given a flagged gap, When the result is consumed downstream, Then the gap is a structured, mandatory-to-read field on the result (not advisory free-text) so a consumer (C2 ingestion / a C5/C6 task graph) cannot present the partial result as complete.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** This is the #3 (never fail silently) guarantee at the tool grain. **Seam:** downstream consumers must surface the gap flag — C3 guarantees it is present and structured; it cannot guarantee a consumer reads it (a C2/C5/C6/C8 obligation).

---

# DSC — Connector disconnection & recovery

### FR-3.DSC.001 — Detect connector disconnection: system-wide vs individual
- **Statement:** The system shall detect connector disconnections and classify them as system-wide (the connector is down for the deployment) or individual (one user's authorization lapsed).
- **Source:** design-doc-v4.md L2301–2342
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A failed call / dead refresh (FR-3.TOK.004) / revocation event.
- **Preconditions:** A connector was connected.
- **Behaviour:**
  - Happy path: the runtime marks the connector `degraded` and classifies the scope; dependent tasks pause (FR-3.TOK.004).
  - Branches: system-wide (e.g. app uninstalled, refresh dead) vs individual (one user's grant revoked) drives the surfacing (FR-3.DSC.002) and reconnect authority.
  - Edge / failure: an undetected disconnection causing silent task failure is the failure mode this FR exists to prevent (#3).
- **Data touched:** `DATA-connector_credentials`/connector state.
- **Permissions:** N/A (detection); reconnect authority per FR-3.DSC.002.
- **Config dependencies:** —
- **Surfaces:** health panel (FR-3.DSC.005).
- **Observability:** disconnection events logged + alerted.
- **Acceptance criteria:**
  - AC-3.DSC.001.1 — Given a connector failure, When detected, Then it is marked degraded and classified system-wide or individual.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Per-connector revocation signals differ (Slack `app_uninstalled`/`tokens_revoked`, slack.md §2 L58; Google revocation triggers, google-gmail.md §2 L68) but converge to this classification.

### FR-3.DSC.002 — Surface disconnection: non-dismissible modal for admins, banner for standard users
- **Statement:** The system shall surface a disconnection as a non-dismissible modal to Admin/Super-Admin users (who can reconnect) and as a banner to standard users, so the right person is prompted to act.
- **Source:** design-doc-v4.md L2305–2324
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A detected disconnection (FR-3.DSC.001).
- **Preconditions:** Connector degraded.
- **Behaviour:**
  - Happy path: Admin/Super-Admin see a non-dismissible modal with a one-click re-auth (FR-3.TOK.004); standard users see an informational banner.
  - Branches: system-wide reconnect authority is Admin/Super-Admin (RBAC); individual lapses prompt the affected user.
  - Edge / failure: the modal cannot be dismissed without resolving or explicitly deferring — the disruption is not hideable (#3).
- **Data touched:** N/A.
- **Permissions:** reconnect = Admin/Super-Admin (system-wide); affected user (individual). Default-deny otherwise.
- **Config dependencies:** —
- **Surfaces:** disconnection modal/banner (Phase 3 / C7).
- **Observability:** surfacing + acknowledgement logged.
- **Acceptance criteria:**
  - AC-3.DSC.002.1 — Given a system-wide disconnection, When an Admin views the dashboard, Then a non-dismissible modal with reconnect is shown.
  - AC-3.DSC.002.2 — Given the same, When a standard user views, Then a banner (not a modal) is shown.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** **Seam → C7** renders the surfaces; C3 defines the behaviour + authority.

### FR-3.DSC.003 — Auto-resume paused tasks on reconnect, with an audit trail
- **Statement:** The system shall, on connector reconnection, automatically resume the tasks paused by the disconnection and record an audit trail of the pause and resume.
- **Source:** design-doc-v4.md L2326–2353
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A successful reconnect (FR-3.TOK.004).
- **Preconditions:** Tasks were paused by the disconnection.
- **Behaviour:**
  - Happy path: reconnect → paused tasks resume from where they paused → pause+resume audited.
  - Branches: a task whose paused work is now stale re-validates before resuming (composes with mid-task authorization re-check, FR-1.RLS.007).
  - Edge / failure: a paused task must never be silently abandoned — it resumes or is explicitly escalated (FR-3.DSC.004).
- **Data touched:** paused-task state; audit.
- **Permissions:** runtime/`service_role`.
- **Config dependencies:** —
- **Surfaces:** task status (C7).
- **Observability:** pause/resume audited.
- **Acceptance criteria:**
  - AC-3.DSC.003.1 — Given tasks paused by a disconnection, When the connector reconnects, Then they auto-resume and the pause/resume is in the audit trail.
  - AC-3.DSC.003.2 — Given a task resumes after a disconnection, When its next step is a consequential external side effect, Then authorization is re-checked (FR-1.RLS.007) before the side effect executes; a revoked authorization halts-and-escalates rather than acting.
  - AC-3.DSC.003.3 — Given paused tasks, When the runtime restarts, Then the paused-task set is persisted and recovered (no paused task is silently abandoned).
- **Open decisions:** — (OD-010 compensation for partial external-write chains is a C5/C6/C8 carry-in)
- **Feasibility assumptions:** —
- **Notes:** Resume composes with FR-1.RLS.007 (re-check authorization before a consequential side effect on resume).

### FR-3.DSC.004 — Escalate a disconnection unresolved past the escalation window
- **Statement:** The system shall escalate a connector disconnection to Super Admin if it remains unresolved past a configurable window (default 24h).
- **Source:** design-doc-v4.md L2356–2361
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A disconnection still open past `CFG-connector_disconnection_escalation_window`.
- **Preconditions:** Disconnection detected and surfaced (FR-3.DSC.001/002).
- **Behaviour:**
  - Happy path: timer from detection; if unresolved at the window, escalate to Super Admin (loud alert).
  - Branches: window is configurable (default 24h).
  - Edge / failure: the escalation must fire even if the original modal was deferred — an ignored disconnection cannot decay silently (#3).
- **Data touched:** disconnection state + timers.
- **Permissions:** escalation targets Super Admin.
- **Config dependencies:** CFG-connector_disconnection_escalation_window (default 24h).
- **Surfaces:** escalation alert (C7).
- **Observability:** escalation logged + alerted.
- **Acceptance criteria:**
  - AC-3.DSC.004.1 — Given a disconnection unresolved at the window, When the timer elapses, Then a Super Admin escalation is raised.
  - AC-3.DSC.004.2 — Given a disconnection-detection timestamp, When the runtime restarts, Then the escalation clock is persisted (not reset) so the 24h window is honored across restarts.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Mirrors the escalation pattern used across C1/C2 for overdue human-gated items.

### FR-3.DSC.005 — Connector health panel: status, last call, token expiry
- **Statement:** The system shall expose a connector health panel showing each connector's status, last successful call time, and token expiry, emitting the data for the dashboard to render.
- **Source:** design-doc-v4.md L2195, L2367–2371
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Admin viewing connector health.
- **Preconditions:** Connectors configured.
- **Behaviour:**
  - Happy path: per connector, the panel shows status (connected/degraded), last-call timestamp, token expiry countdown, and rate-limit headroom (FR-3.RL.001); never token material (FR-3.TOK.001).
  - Branches: a degraded connector is visually flagged with its re-auth action (FR-3.DSC.002).
  - Edge / failure: missing/stale health data is itself shown as a warning, not a blank.
- **Data touched:** connector state, `DATA-connector_credentials` (metadata only), `DATA-rate_limit_tracker`.
- **Permissions:** view = Admin/Super-Admin (RBAC).
- **Config dependencies:** —
- **Surfaces:** connector health panel (Phase 3 / C7).
- **Observability:** —
- **Acceptance criteria:**
  - AC-3.DSC.005.1 — Given configured connectors, When an Admin opens the health panel, Then status, last-call, token-expiry, and rate headroom are shown without exposing token material.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** **Seam → C7** owns the dashboard rendering; C3 *emits* the health data.

### FR-3.DSC.006 — Connector alerts: token expiring (<7d), degraded, unresolved
- **Statement:** The system shall raise connector alerts — refresh-token expiring within 7 days emails the connector owner; a degraded connector triggers the modal; an unresolved disconnection alerts Super Admin — so connector trouble is always seen before it loses knowledge or fails a task.
- **Source:** design-doc-v4.md L2373–2379
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Token-expiry monitor; degradation; escalation timer.
- **Preconditions:** Connectors configured.
- **Behaviour:**
  - Happy path: a token nearing expiry (<`CFG-token_expiry_alert_days`, default 7) emails the owner; degradation raises the modal (FR-3.DSC.002); unresolved past window escalates (FR-3.DSC.004).
  - Branches: alert recipients differ by scope (owner vs Super Admin).
  - Edge / failure: an alert that cannot be delivered is itself surfaced — alerting failure is not silent (#3).
- **Data touched:** `DATA-connector_credentials` (expiry); alert records.
- **Permissions:** N/A (system-initiated).
- **Config dependencies:** CFG-token_expiry_alert_days (default 7).
- **Surfaces:** email + dashboard alerts (C7).
- **Observability:** alerts logged.
- **Acceptance criteria:**
  - AC-3.DSC.006.1 — Given a refresh token expiring within 7 days, When the monitor runs, Then the connector owner is emailed.
  - AC-3.DSC.006.2 — Given an alert delivery failure, When it occurs, Then the failure is surfaced (not silent).
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** **Seam → C7** owns alert delivery; C3 defines the triggers + recipients. Note Slack default `xoxb` is non-expiring (FR-3.TOK.009) so the <7d alert applies to rotating/expiring connectors (GHL, Google, rotation-on Slack).

---

# Connector instances (GHL · Google · Slack)

> These FRs fill in the contract for the first three connectors. **Every vendor fact cites the dossier**
> (`tool-integrations/{gohighlevel,google-gmail,slack}.md`), not the design doc. They inherit all generic
> machinery above (FR-3.CONN/REG/TOK/RL/ACT/TRIG/OPT/DSC) and supply only parameters.

## OBS — Observation (read) tools

### FR-3.OBS.001 — GHL CRM reads (contacts, opportunities, conversations, calendars)
- **Statement:** The system shall read GoHighLevel CRM data — contacts (search/get, tags, notes), opportunities & pipelines, conversations & messages, and calendar appointments — through read-only tools using the v2 API search endpoints.
- **Source:** design-doc-v4.md L2023; dossier — gohighlevel.md §4 L79–83
- **Status:** Approved *(viability-gated for HIPAA locations — see AF-098)*
- **Priority:** Must
- **Actor / trigger:** A task needing CRM context (read), or an ingestion pipeline (FR-2.ING.*).
- **Preconditions:** GHL connected with read scopes (FR-3.CONN.005); valid token (FR-3.TOK.008).
- **Behaviour:**
  - Happy path: contacts via `POST /contacts/search` (the supported ingest path) + `GET /contacts/{id}` + tags/notes; opportunities via `GET /opportunities/pipelines` + search + `GET /opportunities/{id}`; conversations via search + messages-by-conversation; appointments via list/get (gohighlevel.md §4 L79–83). Results are boundary-tagged (FR-3.CONN.003).
  - Branches: **do not use `GET /contacts/`** — deprecated 2026-06-11; use v3 search (gohighlevel.md §4 L79).
  - Edge / failure: rate-limited per FR-3.RL.* against GHL's real caps (100/10s + 200k/day, gohighlevel.md §3 L70); a missing read scope degrades gracefully (FR-3.OPT.004).
- **Data touched:** feeds C2 ingestion (`DATA-memories` via FR-2.ING.*); golden rule — stores `source_ref` pointers, not copied records.
- **Permissions:** agent path `service_role`; scopes `contacts.readonly`, `opportunities.readonly`, `conversations.readonly`, `conversations/message.readonly`, `calendars.readonly`, `calendars/events.readonly` (gohighlevel.md §8 L127–135).
- **Config dependencies:** —
- **Surfaces:** N/A (backend); ingested data appears in memory surfaces (Phase 3).
- **Observability:** read volume + boundary-tagged ingestion logged.
- **Acceptance criteria:**
  - AC-3.OBS.001.1 — Given GHL connected, When contacts are read, Then `POST /contacts/search` is used (not the deprecated `GET /contacts/`) and results are boundary-tagged.
  - AC-3.OBS.001.2 — Given a HIPAA-enabled GHL location, When PHI ingest is attempted, Then it is blocked until the BAA chain is resolved (AF-098).
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: **AF-098 (GHL PHI/BAA chain — gates HIPAA-location ingest; viability gate)**; AF-093 (GHL 429 backoff).
- **Notes:** **Viability gate:** PHI ingest from a HIPAA GHL location does not advance to build until AF-098 (BAA chain) clears. The 5-agency private-app install cap (OD-041) is an implicit v1 scaling limit until GHL Security Review is passed.

### FR-3.OBS.002 — Comms reads: Slack message history + Gmail messages
- **Statement:** The system shall read communications content — Slack public-channel history, threads, and DMs, and Gmail messages — through read-only tools, with incremental sync, normalizing edits and deletions where the source supports them.
- **Source:** design-doc-v4.md L2025; dossiers — slack.md §4 L77–83 + §6 L97, google-gmail.md §4 L82–86
- **Status:** Approved *(Slack arm viability-gated — see AF-083)*
- **Priority:** Must
- **Actor / trigger:** A task needing comms context, or an ingestion pipeline (FR-2.ING.*).
- **Preconditions:** Slack/Gmail connected with read scopes; valid tokens (FR-3.TOK.007/009).
- **Behaviour:**
  - Happy path (Slack): `conversations.history`/`conversations.replies` (incremental via persisted per-channel `ts` as `oldest`), `conversations.list` for discovery, `users.info` to resolve IDs (slack.md §4 L77–83); `message_changed`→update, `message_deleted`→tombstone (slack.md §6 L97); files via separate authenticated fetch (slack.md §6 L98).
  - Happy path (Gmail): `messages.list`+`messages.get`, incremental via `history.list` from `startHistoryId` with full-sync fallback on 404 (google-gmail.md §4 L82–86).
  - Branches: **Slack throttle fork (OD-011 resolved)** — history/replies are usable at Tier-3 rates (50+/min, limit 1,000) **only as an internal custom app per workspace** (slack.md §3 L66–71); a non-Marketplace distributed app collapses to 1/min×15 (lethal for ingest).
  - Edge / failure: all content boundary-tagged (FR-3.CONN.003); HIGH-PII handling per silo (slack.md §6 L99–101); Gmail `history.list` 404 (token too old) → full re-sync.
- **Data touched:** feeds C2 ingestion (FR-2.ING.*); Slack edits/deletes mutate stored memories (not insert-only).
- **Permissions:** agent path `service_role`; Slack `channels:history`,`channels:read`,`users:read` (+`groups/im/mpim:history` for private/DM) (slack.md §8 L114–120); Gmail `gmail.readonly` (restricted, google-gmail.md §8 L122).
- **Config dependencies:** —
- **Surfaces:** N/A (backend).
- **Observability:** ingest volume; Slack Events-API gap reconciliation logged (FR-3.TRIG.004).
- **Acceptance criteria:**
  - AC-3.OBS.002.1 — Given Slack connected as an internal custom app, When history is read, Then it uses incremental `ts`-based sync and boundary-tags results.
  - AC-3.OBS.002.2 — Given a Slack `message_deleted` event, When ingested, Then the stored memory is tombstoned/redacted (not left stale).
  - AC-3.OBS.002.3 — Given Gmail `history.list` returns 404, When syncing, Then the connector falls back to a full sync.
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: **AF-083 (Slack internal-custom-app Tier-3 exemption holds on a live workspace — viability gate for Slack history ingest)**; AF-084 (Events-API silent-failure + gap reconciliation); AF-088 (injection mitigation for untrusted text).
- **Notes:** **Viability gate:** the Slack history-ingest arm does not advance to build until AF-083 EVAL confirms the throttle exemption. Gmail Limited Use policy (google-gmail.md §6 L105) forbids cross-user model training — per-user isolation is a *policy* requirement, honored by the per-client silo (ADR-001).

### FR-3.OBS.003 — Google Drive document reads
- **Statement:** The system shall read Google Drive documents through read-only tools with incremental change tracking, defaulting to the `drive.file` scope and escalating to `drive.readonly` only for full-corpus ingest.
- **Source:** design-doc-v4.md L2027; dossier — google-gmail.md §4 L84–86 + §8 (OD-045)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A task needing document context, or an ingestion pipeline.
- **Preconditions:** Drive connected; valid token (FR-3.TOK.007).
- **Behaviour:**
  - Happy path: `files.list`+`files.get`; incremental via `changes.getStartPageToken`→`changes.list` (google-gmail.md §4 L84–86). Results boundary-tagged (FR-3.CONN.003); golden rule — store `source_ref`, not file copies.
  - Branches: **scope fork (OD-045 resolved)** — `drive.file` (non-sensitive, Picker-based, app-touched files only) is the default; `drive.readonly` (restricted, full corpus) requires CASA (~6wk lead, annual renewal) + client acceptance (google-gmail.md §8).
  - Edge / failure: `changes` page-token expiry behaviour is undocumented (⚠️ AF-108) → treat parity with Gmail 404 / Calendar 410 (full-sync fallback).
- **Data touched:** feeds C2 ingestion (`source_ref` pointers).
- **Permissions:** agent path `service_role`; scope `drive.file` (default) or `drive.readonly` (escalated).
- **Config dependencies:** CFG-drive_full_corpus_ingest (default false → `drive.file`).
- **Surfaces:** N/A.
- **Observability:** read volume logged.
- **Acceptance criteria:**
  - AC-3.OBS.003.1 — Given default config, When Drive is read, Then the `drive.file` scope is used.
  - AC-3.OBS.003.2 — Given full-corpus ingest enabled with client acceptance, When provisioned, Then `drive.readonly` + CASA is used.
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-101 (Drive exact quota numbers), AF-108 (Drive `changes` page-token expiry).
- **Notes:** CASA lead time is an onboarding critical path (ADR-005). Golden rule applies — Drive binaries are referenced, never copied (ADR-008).

### FR-3.OBS.004 — Google Calendar reads
- **Statement:** The system shall read Google Calendar events through read-only tools with incremental sync via sync tokens.
- **Source:** design-doc-v4.md L2029; dossier — google-gmail.md §4 L85–86
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** A task needing calendar context.
- **Preconditions:** Calendar connected; valid token.
- **Behaviour:**
  - Happy path: `events.list` with `syncToken` for incremental reads; on 410 GONE (sync token expired) → full re-sync (google-gmail.md §4 L85). Boundary-tagged.
  - Branches: read uses `calendar.readonly`; writes (invites) are FR-3.ACT.006.
  - Edge / failure: 410 → full sync; quota per FR-3.RL.* (exact Calendar numbers ⚠️ AF-101).
- **Data touched:** feeds C2 ingestion / live cross-check (FR-2.MNT.011).
- **Permissions:** agent path `service_role`; scope `calendar.readonly`.
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** read volume logged.
- **Acceptance criteria:**
  - AC-3.OBS.004.1 — Given a calendar sync, When the sync token is valid, Then incremental events are read; When it returns 410, Then a full re-sync runs.
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-101 (Calendar exact quota numbers).
- **Notes:** Calendar `events.insert` (write) is the complementary action tool (FR-3.ACT.006).

## ACT — Action (write) tools per connector

### FR-3.ACT.003 — GHL CRM mutations (upsert contact, tag, note, move stage, send message)
- **Statement:** The system shall write to GoHighLevel CRM — upsert contact, add tag, add note, move pipeline stage, and send a message — through idempotent action tools, using `/contacts/upsert` for create-or-update.
- **Source:** design-doc-v4.md L2039; dossier — gohighlevel.md §4 L79–82 + §10 L158–161
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** An approved action within a task (FR-3.ACT.001).
- **Preconditions:** GHL connected with write scopes; action approved if `requires_approval`.
- **Behaviour:**
  - Happy path: `POST /contacts/upsert`, `POST /contacts/{id}/tags`, `POST /contacts/{contactId}/notes`, `PUT /opportunities/{id}/status`, `POST /conversations/messages` (gohighlevel.md §4 L79–82); each routed through the idempotency guard (FR-3.CONN.004).
  - Branches: contact create/update → always upsert (idempotent, honors dedup; gohighlevel.md §10 L158–160).
  - Edge / failure: **message send is irreversible and billed on attempt** — the app-side send-once guard must prevent a duplicate *before* the call (gohighlevel.md §10 L161); a rate-limited send (high-risk) halts + escalates (FR-3.RL.006), never auto-retries.
- **Data touched:** external GHL records; app-side idempotency ledger.
- **Permissions:** agent path `service_role`; scopes `contacts.write`, `opportunities.write`, `conversations/message.write` (gohighlevel.md §8 L135).
- **Config dependencies:** per-tool `requires_approval` (FR-3.REG.001).
- **Surfaces:** approval queue (C6) for gated writes.
- **Observability:** every mutation logged; suppressed duplicates logged (FR-3.CONN.004).
- **Acceptance criteria:**
  - AC-3.ACT.003.1 — Given a contact write, When performed, Then it uses `/contacts/upsert` and is idempotent on retry.
  - AC-3.ACT.003.2 — Given a message send that times out and retries, When re-attempted, Then the send-once guard prevents a duplicate (no double-bill).
- **Open decisions:** — (OD-010 partial-chain compensation is a C5/C6/C8 carry-in)
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-095 (confirm no native `Idempotency-Key`).
- **Notes:** Sending external messages is bounded by the hard limits (FR-3.ACT.002) — autonomous external *email* is forbidden; GHL in-CRM messaging follows the approval contract.

### FR-3.ACT.004 — Comms writes: post Slack message; draft email to approval queue
- **Statement:** The system shall post Slack messages through an idempotent action tool, and shall route any outbound email to a draft in the approval queue rather than sending it autonomously.
- **Source:** design-doc-v4.md L2041; ADR-007 hard limit (no autonomous external email, L2056); dossiers — slack.md §4 L82 + §10 L134, google-gmail.md §8 L122–146 (`gmail.send`)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** An approved action within a task.
- **Preconditions:** Slack connected (`chat:write`); Gmail send only via approval.
- **Behaviour:**
  - Happy path (Slack): `chat.postMessage` (channel/text/blocks/thread_ts), with app-side write-dedup on `ts`/key before any retry (slack.md §10 L134).
  - Happy path (email): an email action produces a **draft routed to the approval queue** (C6); it is never sent autonomously (hard limit FR-3.ACT.002 / L2056). If/when sending is enabled, the least-privilege `gmail.send` scope is used (google-gmail.md §8).
  - Branches: a Slack post timing out → app-side dedup prevents a double-post (slack.md §10 L134).
  - Edge / failure: Slack has no idempotency key → dedup is app-side (FR-3.CONN.004); a rate-limited high-risk send halts + escalates (FR-3.RL.006).
- **Data touched:** external Slack messages; email drafts (approval queue, C6).
- **Permissions:** agent path `service_role`; Slack `chat:write`; email gated to approval.
- **Config dependencies:** per-tool `requires_approval`.
- **Surfaces:** approval queue (C6) for email drafts.
- **Observability:** posts + drafts logged; suppressed duplicates logged.
- **Acceptance criteria:**
  - AC-3.ACT.004.1 — Given an email action, When proposed, Then it becomes an approval-queue draft and is never sent autonomously.
  - AC-3.ACT.004.2 — Given a Slack post retried after timeout, When re-sent, Then app-side dedup prevents a double-post.
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-085 (Slack post-message app-side write-dedup).
- **Notes:** This FR realises hard limit #1 (no autonomous external email, FR-3.ACT.002) at the connector grain.

### FR-3.ACT.005 — Google Drive document create / append
- **Statement:** The system shall create and append to Google Drive documents through idempotent action tools.
- **Source:** design-doc-v4.md L2043; dossier — google-gmail.md §4
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** An approved action within a task.
- **Preconditions:** Drive connected with a write-capable scope; action approved if gated.
- **Behaviour:**
  - Happy path: create or append a document; the write is routed through the idempotency guard (FR-3.CONN.004) so a retry does not create a duplicate file.
  - Branches: `drive.file` scope covers app-created files (the default, OD-045).
  - Edge / failure: a destructive operation on a system-of-record record is forbidden by hard limit #3 (FR-3.ACT.002 / L2058) — create/append only, no autonomous delete.
- **Data touched:** external Drive documents (regenerable outputs; golden rule unaffected).
- **Permissions:** agent path `service_role`; `drive.file`.
- **Config dependencies:** per-tool `requires_approval`.
- **Surfaces:** approval queue (C6) for gated writes.
- **Observability:** writes logged.
- **Acceptance criteria:**
  - AC-3.ACT.005.1 — Given a document create retried, When re-attempted with the same key, Then no duplicate file is created.
  - AC-3.ACT.005.2 — Given an autonomous delete of a source record is attempted, When evaluated, Then hard limit #3 blocks it.
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** Output docs are regenerable artifacts (not source-of-truth) per the golden rule (ADR-008).

### FR-3.ACT.006 — Calendar invite → draft to approval queue, never send direct
- **Statement:** The system shall create calendar invites as drafts routed to the approval queue, never sending a calendar invite directly/autonomously, using a client-supplied event id for idempotency.
- **Source:** design-doc-v4.md L2045; dossier — google-gmail.md §10 L163 (client `id` → 409 on re-run)
- **Status:** Approved
- **Priority:** Should
- **Actor / trigger:** An approved action within a task.
- **Preconditions:** Calendar connected (`calendar.events`); approval required.
- **Behaviour:**
  - Happy path: an invite is drafted to the approval queue (C6); on approval, `events.insert` runs with a client-supplied `id` so a retry returns 409 `duplicate` rather than a second event (google-gmail.md §10 L163).
  - Branches: never auto-send — invites always gate (L2045).
  - Edge / failure: Calendar's distributed-id idempotency is "not guaranteed at creation time" → ⚠️ AF-102 (EVAL before trusting 409-dedup as the sole guard); pair with the app-side guard (FR-3.CONN.004).
- **Data touched:** external calendar events; approval-queue drafts.
- **Permissions:** agent path `service_role`; `calendar.events`.
- **Config dependencies:** per-tool `requires_approval` (effectively always true here).
- **Surfaces:** approval queue (C6).
- **Observability:** invite drafts + sends logged.
- **Acceptance criteria:**
  - AC-3.ACT.006.1 — Given a calendar invite action, When proposed, Then it becomes an approval-queue draft (never auto-sent).
  - AC-3.ACT.006.2 — Given an approved invite retried with the same client id, When re-attempted, Then it returns 409 (no duplicate event).
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-102 (Calendar 409-duplicate idempotency in a distributed system).
- **Notes:** Reinforces the "draft, don't send" posture for outbound human-facing actions.

### FR-3.ACT.007 — The internal memory-write tool is registered here, owned by C2
- **Statement:** The system shall expose the internal memory-write capability (explicit write / flag-for-review / supersede) as a registered tool in the registry, while the write behaviour itself is owned and enforced by the Memory component (C2).
- **Source:** design-doc-v4.md L2047; seam → C2 (FR-2.WRT.*)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** The agent choosing to persist knowledge (routed to C2's sole writer).
- **Preconditions:** —
- **Behaviour:**
  - Happy path: the tool appears in the registry (FR-3.REG.001) so the AI can select it; invocation hands off to C2's Memory Writer (sole writer, `service_role`, ADR-004) which performs the contradiction check, sensitivity classify, and validate-and-commit (FR-2.WRT.*).
  - Branches: explicit write vs flag-for-review vs supersede are C2 write-flow modes (FR-2.WRT.*).
  - Edge / failure: C3 does **not** write memory directly — ingestion is not a backdoor (FR-2 reconciliation #3); the only writer is C2.
- **Data touched:** `DATA-memories` (via C2 only).
- **Permissions:** C2 sole-writer path.
- **Config dependencies:** —
- **Surfaces:** N/A.
- **Observability:** memory writes logged by C2.
- **Acceptance criteria:**
  - AC-3.ACT.007.1 — Given the memory-write tool, When invoked, Then the write is performed by C2's sole writer (not by the connector runtime).
- **Open decisions:** —
- **Feasibility assumptions:** —
- **Notes:** **Seam → C2.** C3 registers the tool so it is selectable; all write semantics live in FR-2.WRT.*. Listed here only to avoid an orphaned design line (L2047).

## TOK — Per-connector token parameters (cite dossiers)

### FR-3.TOK.007 — Google token parameters
- **Statement:** The system shall configure the Google connector token lifecycle from its dossier: ~1h access tokens; refresh tokens that do **not** rotate on normal refresh but expire after 6 months unused or on password change (Gmail scopes); a 100-refresh-token-per-account-per-client cap; and the unused-OAuth-client deletion policy.
- **Source:** dossier — google-gmail.md §2 L61–70
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Token lifecycle (FR-3.TOK.002–005) applied with Google parameters.
- **Preconditions:** Google connected.
- **Behaviour:**
  - Happy path: access ~1h (use returned `expires_in`, not a constant); refresh persists but is **not** rotated on refresh (google-gmail.md §2 L65) → FR-3.TOK.005 persist-new is a harmless no-op; new refresh only via `prompt=consent`.
  - Branches: refresh death triggers — user revoke / 6-mo unused / password change / 100-token overflow (oldest silently invalidated) / Workspace admin restriction (google-gmail.md §2 L67–68) → all to Layer-3 re-auth (FR-3.TOK.004).
  - Edge / failure: the **100-token cap** can silently invalidate the oldest token → monitor token count; the unused-client deletion (≥6mo idle, eff. 2025-10-27) can delete the whole OAuth client → alert on long idle (⚠️ AF-107).
- **Data touched:** `DATA-connector_credentials` (Google).
- **Permissions:** runtime/`service_role`.
- **Config dependencies:** —
- **Surfaces:** health panel (FR-3.DSC.005).
- **Observability:** refresh outcomes + token-count proximity logged.
- **Acceptance criteria:**
  - AC-3.TOK.007.1 — Given a Google refresh, When performed, Then access is renewed and the existing refresh token is retained (no rotation expected).
  - AC-3.TOK.007.2 — Given approach to the 100-token cap, When detected, Then it is surfaced before the oldest is silently invalidated.
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-106 (refresh non-rotation confirmed indirectly — SPIKE), AF-107 (unused-client deletion monitoring), AF-110 (2025 dated policy text).
- **Notes:** Opposite of GHL — Google does not rotate refresh tokens. CASA applies to restricted scopes (FR-3.OBS.002/003).

### FR-3.TOK.008 — GHL token parameters (rotating refresh — the persist trap)
- **Statement:** The system shall configure the GoHighLevel connector token lifecycle from its dossier: ~24h access tokens; single-use rotating refresh tokens that invalidate the prior token on each use and die after 1 year unused — making atomic persist-on-refresh (FR-3.TOK.005) mandatory.
- **Source:** dossier — gohighlevel.md §2 L59–63; AF-003 finding F5
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** Token lifecycle applied with GHL parameters.
- **Preconditions:** GHL connected.
- **Behaviour:**
  - Happy path: access ~24h (`expires_in: 86399`); each refresh returns a new refresh token and invalidates the old → FR-3.TOK.005 atomically persists it before use (gohighlevel.md §2 L60–61).
  - Branches: concurrent refreshes within a 30s window return the same token (race-safe, gohighlevel.md §2 L60).
  - Edge / failure: failing to persist the rotated token **silently loses GHL access** (the #1 trap this connector most exemplifies); refresh dies after 1yr unused → Layer-3 re-auth.
- **Data touched:** `DATA-connector_credentials` (GHL).
- **Permissions:** runtime/`service_role`.
- **Config dependencies:** —
- **Surfaces:** health panel (FR-3.DSC.005).
- **Observability:** rotation persistence success/failure logged.
- **Acceptance criteria:**
  - AC-3.TOK.008.1 — Given a GHL refresh, When it returns a rotated refresh token, Then it is atomically persisted before any call uses the new access token (FR-3.TOK.005).
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-089 (GHL rotation correctness under the 30s concurrency window).
- **Notes:** This is the canonical case for FR-3.TOK.005 and the spine argument (FR-3.CONN.002).

### FR-3.TOK.009 — Slack token parameters
- **Statement:** The system shall configure the Slack connector with non-expiring bot tokens (`xoxb`) by default, with optional (default-off) token rotation that, when enabled, yields 12h access tokens and a rotating refresh token requiring atomic persistence.
- **Source:** dossier — slack.md §2 L56–59; OD-040 (rotation off by default)
- **Status:** Approved *(viability-gated with Slack ingest — see AF-083)*
- **Priority:** Must
- **Actor / trigger:** Token lifecycle applied with Slack parameters.
- **Preconditions:** Slack connected.
- **Behaviour:**
  - Happy path: default `xoxb` is non-expiring → no proactive refresh needed (FR-3.TOK.002 skips it); revocation via app uninstall / `auth.revoke`, signalled by `app_uninstalled` + `tokens_revoked` (slack.md §2 L58) → Layer-3 re-auth.
  - Branches: **rotation is OFF by default (OD-040, CFG-slack_token_rotation_enabled=false)**; if turned on it is irreversible → 12h `xoxe.xoxb-` access + `xoxe-1-` refresh that must be persisted each rotation (FR-3.TOK.005, slack.md §2 L57).
  - Edge / failure: no documented per-account token cap (slack.md §2 L59) → treat as one `xoxb` per workspace; revocation ordering of `app_uninstalled` vs `tokens_revoked` is not guaranteed.
- **Data touched:** `DATA-connector_credentials` (Slack).
- **Permissions:** runtime/`service_role`.
- **Config dependencies:** CFG-slack_token_rotation_enabled (default false).
- **Surfaces:** health panel.
- **Observability:** revocation events logged.
- **Acceptance criteria:**
  - AC-3.TOK.009.1 — Given default config, When Slack is connected, Then the non-expiring `xoxb` token is used and proactive refresh is skipped.
  - AC-3.TOK.009.2 — Given rotation enabled, When a rotation occurs, Then the new refresh token is atomically persisted (FR-3.TOK.005).
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: **AF-083 (internal-custom-app provisioning, shared with the Slack ingest viability gate)**.
- **Notes:** Default-off rotation is the lower-complexity choice (OD-040); the internal-custom-app provisioning (OD-011) that makes ingest viable is the same app whose token this governs.

## TRIG — Per-connector trigger transport & signature scheme (homes OD-044)

### FR-3.TRIG.004 — Per-connector trigger transport and signature verification scheme
- **Statement:** The system shall implement each connector's trigger transport and its specific inbound-verification scheme — GHL native webhook with Ed25519 signature, Google Pub/Sub OIDC-JWT (Gmail) and signed channel-token + TLS (Drive/Calendar), and Slack Events API with HMAC-SHA256 — realising the ADR-007 "verified authenticated ingress" control with each vendor's actual scheme.
- **Source:** design-doc-v4.md L1988–1992, L2000–2017; ADR-007 + OD-044 clarification note (2026-06-25); dossiers — gohighlevel.md §5 L92–105, google-gmail.md §5 L91–97, slack.md §5 L87–91
- **Status:** Approved *(GHL webhook arm viability-gated — see AF-090)*
- **Priority:** Must
- **Actor / trigger:** An inbound event from a connector (verified before processing).
- **Preconditions:** The connector's webhook/subscription is registered.
- **Behaviour:**
  - Happy path (GHL): native app-level webhook → verify **Ed25519** signature in `X-GHL-Signature` against GHL's published public key (gohighlevel.md §5 L95–98); dedup on `deliveryId` (gohighlevel.md §5 L105); durable-queue → 2xx on receipt (OD-042).
  - Happy path (Google): Gmail push via Cloud Pub/Sub with **OIDC JWT** (RS256, validate `aud`/`email` + clock skew, google-gmail.md §5 L91/L97); Drive/Calendar via HTTPS callback with static `X-Goog-Channel-Token` compare + TLS (google-gmail.md §5 L92–93); **re-arm watches before expiry** (Gmail ~7d, Drive `files` 1d/`changes` 7d, no auto-renew).
  - Happy path (Slack): Events API → verify **HMAC-SHA256** `X-Slack-Signature` over `v0:{X-Slack-Request-Timestamp}:{raw_body}`, constant-time compare, reject if timestamp skew > 300s; ack 2xx within 3s, dedup on `event_id`; reconcile gaps via `conversations.history` (slack.md §5 L89–91).
  - Branches: **transport differs per connector** (native webhook / Pub-Sub / channel callback / Events API); the **legacy GHL `X-WH-Signature` (RSA) is deprecated 2026-07-01** → use `X-GHL-Signature` (gohighlevel.md §5 L97).
  - Edge / failure: a signature/JWT/token that fails verification is rejected (fail-closed); Slack auto-disables subscriptions failing >95%/60min and drops events >2h late with no backfill → the connector reconciles via history reads (slack.md §5 L91); GHL retry policy is contradictory in vendor docs (⚠️ AF-097).
- **Data touched:** inbound event records; watch/subscription state.
- **Permissions:** verification is runtime; **webhook *authentication* is C0's (FR-0.WHK.*)** — C3 consumes the verified event and applies the per-vendor scheme as the connector contract homes it (OD-044).
- **Config dependencies:** per-connector signing secret / public key / channel token (in `credentials`, FR-3.TOK.001).
- **Surfaces:** N/A.
- **Observability:** verification failures + dropped/late-event reconciliation logged (#3).
- **Acceptance criteria:**
  - AC-3.TRIG.004.1 — Given a GHL webhook, When received, Then its `X-GHL-Signature` Ed25519 signature is verified before processing (legacy `X-WH-Signature` not used post-2026-07-01).
  - AC-3.TRIG.004.2 — Given a Slack event, When received, Then the HMAC-SHA256 signature is verified, timestamp skew >300s is rejected, and the event is deduped on `event_id`.
  - AC-3.TRIG.004.3 — Given a Gmail Pub/Sub push, When received, Then the OIDC JWT is validated (`aud`/`email`, clock skew) before processing.
  - AC-3.TRIG.004.4 — Given a watch nearing expiry, When the monitor runs, Then it is re-armed before it lapses.
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: **AF-090 (GHL Ed25519 signing input — exact signed bytes — must be confirmed against a live payload; viability gate for the GHL webhook arm)**; AF-097 (GHL webhook retry-policy contradiction); AF-109 (Gmail Pub/Sub OIDC validation end-to-end); AF-084 (Slack Events-API gap reconciliation).
- **Notes:** This FR is the **OD-044 reconciliation in spec form** — ADR-007's "webhook HMAC" was generalised (dated note, 2026-06-25) to "verified authenticated ingress," with HMAC as one instance (Slack); GHL Ed25519 and Google OIDC/channel-token are the others. **Seam → C0** owns the authentication primitive; C3 homes the per-vendor scheme. **Viability gate:** the GHL webhook arm does not advance to build until AF-090 confirms the signing input. **Cross-component reconciliation (verification gate, session 20):** C0 **FR-0.WHK.002** (Approved) still specs GHL webhook auth as HMAC-SHA256 — stale; corrected to Ed25519 via change-control under **OD-046** (see that FR's dated note).

### FR-3.TRIG.005 — Watch / subscription lifecycle: proactive re-arm, fail loud on lapse
- **Statement:** The system shall proactively re-arm every push subscription / watch channel before it expires, and shall treat a failed or missed re-arm as a degraded-connector condition that is surfaced loudly — never a silent stop of inbound events.
- **Source:** design-doc-v4.md L1988–1992; dossier — google-gmail.md §5 L91–94 (Gmail ~7d, Drive `files` 1d/`changes` 7d, Calendar bounded; **no auto-renew**)
- **Status:** Approved
- **Priority:** Must
- **Actor / trigger:** A scheduled re-arm job (per the connector's watch TTL), mirroring the token-refresh job (FR-3.TOK.002).
- **Preconditions:** A connector uses an expiring push subscription (Gmail Pub/Sub watch; Drive/Calendar channels).
- **Behaviour:**
  - Happy path: the job finds watches expiring within a lead window and re-arms them (`users.watch` / `files.watch` / `changes.watch` / `events.watch`) before they lapse, persisting the new channel/expiry.
  - Branches: connectors whose trigger transport does not expire (Slack Events subscription, GHL app webhook) are skipped — this FR governs the Google watch family.
  - Edge / failure: a re-arm that **fails or is missed** moves the connector to `degraded` and enters the disconnection flow (FR-3.DSC.001) — an expired-but-not-re-armed watch is a #3 silent-loss hole otherwise (it looks identical to a quiet channel); watch expiry is shown on the health panel (FR-3.DSC.005) and alerted (FR-3.DSC.006).
- **Data touched:** watch/subscription state (channel id, resource id, expiry).
- **Permissions:** runtime/`service_role`.
- **Config dependencies:** CFG-watch_rearm_lead_minutes (per-connector default below the shortest TTL — e.g. Drive `files` 1d → hours, not days).
- **Surfaces:** connector health panel (FR-3.DSC.005) shows watch expiry.
- **Observability:** re-arm successes/failures logged; a missed re-arm alerts.
- **Acceptance criteria:**
  - AC-3.TRIG.005.1 — Given a watch expiring within the lead window, When the re-arm job runs, Then it is re-armed before it lapses and the new expiry is persisted.
  - AC-3.TRIG.005.2 — Given a re-arm fails or is missed, When detected, Then the connector enters `degraded` (FR-3.DSC.001) and is surfaced — it does not silently stop receiving events.
  - AC-3.TRIG.005.3 — Given a connector with an expiring watch, When the health panel is viewed, Then watch expiry is shown alongside token expiry.
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-108 (Drive `changes` page-token expiry behaviour), AF-109 (Gmail Pub/Sub watch + OIDC validation end-to-end).
- **Notes:** This is the Gmail/Drive/Calendar analogue of FR-3.TOK.002's token-refresh job. Added by the session-20 verification gate (HIGH finding — watch re-arming had no owning FR, no fail-loud path).

### FR-3.TRIG.006 — Event-delivery gap detection and reconciliation
- **Statement:** The system shall detect gaps in at-least-once event delivery and reconcile them by re-reading from the source against a persisted per-channel watermark, so dropped, auto-disabled, or late-expired events never become silent knowledge loss.
- **Source:** design-doc-v4.md L1984–1998; dossier — slack.md §5 L91 + §10 L131–132 (auto-disable >95%/60min, events >2h dropped, **no backfill**), google-gmail.md §5 L91 (Gmail `historyId` gap → full sync)
- **Status:** Approved *(Slack arm viability-gated — see AF-083/084)*
- **Priority:** Must
- **Actor / trigger:** A scheduled reconciliation sweep + delivery-health monitor.
- **Preconditions:** A connector ingests via an at-least-once event stream.
- **Behaviour:**
  - Happy path (Slack): monitor own 2xx delivery rate and alarm on `app_rate_limited`; flag approach to the 95%-failure / 60-min auto-disable threshold as `degraded` (not silent); run a periodic `conversations.history` sweep from the persisted per-channel `ts` watermark, detecting and re-ingesting any gap (slack.md §5 L91, §10 L131).
  - Happy path (Gmail/Drive/Calendar): a `history.list` 404 / `changes` token-expiry / `events.list` 410 triggers a full-sync reconciliation from the last good watermark (google-gmail.md §4–5).
  - Branches: reconciliation is per-connector (Slack history sweep; Google full-sync fallback) but the detect-then-reconcile pattern is generic.
  - Edge / failure: a sustained delivery failure (Slack subscription disabled) is surfaced via FR-3.DSC.001; a reconciliation sweep that itself cannot run is alerted — the gap is never assumed empty.
- **Data touched:** per-channel watermarks; re-ingested events feed C2 (FR-2.ING.*).
- **Permissions:** runtime/`service_role`.
- **Config dependencies:** CFG-event_reconciliation_sweep_minutes (default per connector).
- **Surfaces:** delivery-health on the connector health panel (FR-3.DSC.005).
- **Observability:** detected gaps + reconciled counts logged; delivery-rate threshold breaches alerted.
- **Acceptance criteria:**
  - AC-3.TRIG.006.1 — Given a Slack delivery gap (auto-disable or >2h-late drop), When the reconciliation sweep runs, Then events since the watermark are re-read via `conversations.history` and re-ingested.
  - AC-3.TRIG.006.2 — Given the Slack 2xx delivery rate approaches the 95%/60min threshold, When detected, Then the connector is flagged degraded (not silent).
  - AC-3.TRIG.006.3 — Given a Gmail `history.list` 404, When syncing, Then a full-sync reconciliation runs from the last good watermark.
- **Open decisions:** —
- **Feasibility assumptions:** ⚠️ FEASIBILITY: AF-084 (Slack Events-API silent-failure surface + gap reconciliation recovers dropped events — LOAD/EVAL); AF-083 (Slack internal-app rate exemption makes the history sweep affordable).
- **Notes:** Added by the session-20 verification gate (HIGH finding — gap reconciliation was asserted in FR-3.TRIG.004/OBS.002 prose but no FR specified the detect-and-reconcile mechanism). This is the #3 guarantee for event ingestion.

