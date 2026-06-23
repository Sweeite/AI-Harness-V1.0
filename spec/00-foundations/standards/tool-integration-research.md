# Standard — Tool / Connector Integration Research (research-first)

- **Status:** Binding
- **Source:** ADR-001 (per-client account ownership), ADR-003 (cost), ADR-005 (per-client OAuth /
  provisioning), ADR-006 (RLS / sensitivity), ADR-007 (external-data containment); proven by the
  **AF-003 vendor-claims spike** (`feasibility-register.md` F1–F12), which caught 3 stale/refuted
  vendor claims and 1 design fork **before** they reached a requirement.
- **Applies to:** every external tool, API, connector, or SaaS the harness reads from, writes to, or
  is provisioned against — **whenever one is added, for any client or use case.** The tool set is
  **open-ended and client-dependent**; this is the repeatable gate every new one passes through.

## Why this exists (the rule it encodes)

New tools arrive continuously — driven by client, use case, vertical, and vendor availability. Each
one drags in **its own** rate limits, token lifecycle, failure modes, cost, and security surface, and
**vendor facts go stale** (AF-003: Slack changed its rate limits in 2025; Gmail changed its quota
model in 2026; GHL's refresh-token behaviour was never what the doc claimed). If we spec a connector
from the design doc's prose or from memory, we bake in wrong numbers and silent-failure traps.

**The rule: no tool is specced into a requirement until a dated, primary-source research dossier
exists for it.** Research first, cite primary sources, date-stamp, flag paper-vs-proven — *then* write
FRs. This is the connector-level expression of Rule 0 (the repo, not the conversation, is the source
of truth) and the three non-negotiables (a mis-read token-rotation rule loses knowledge → #1; an
over-scoped grant does something it shouldn't → #2; an un-handled rate-limit fails silently → #3).

## When this triggers

- A client/use case requires a tool not already covered by a dossier in `tool-integrations/`.
- An existing dossier is **stale** (past its `Re-verify by` date — vendor facts drift; see §5).
- A tool's vendor announces an API/limit/auth change (re-run the affected dimensions).

## The procedure (5 steps — this is the "trigger")

### Step 1 — Open the dossier
Copy `spec/00-foundations/tool-integrations/_TEMPLATE.md` to
`spec/00-foundations/tool-integrations/<tool-slug>.md`, fill the header (tool, applicability: which
clients / use cases / entity types need it, why), and add a row to that folder's `README.md` index
with status 🟡 *researching*.

### Step 2 — Run the research fan-out (parallel subagents, primary sources only)
Spawn independent research subagents — **one per dimension cluster** below — exactly as the AF-003
spike did. Each agent's contract:
- **Primary/official vendor docs only** (developer docs, API reference, changelog, status/limits
  pages). No blog-post hearsay, no memory.
- For every claim: **VERIFIED / REFUTED / STALE / UNCERTAIN**, the **actual current value**, a
  **source URL**, and a one-line **design-impact** note.
- **Date-stamp everything** — vendor facts are true *as of* a date, not forever.
- Call out **recent changes** explicitly (the Slack-2025 lesson: ask "what changed in the last 12–18
  months?" for limits and auth).

Keep the main thread for decisions; let the agents carry the raw doc reading (context-window rule).

### Step 3 — File the outputs (Rule 0 — write it down)
From the dossier, propagate into the registers **immediately**:
- **Feasibility register** — every claim that can only be confirmed by *testing* (not docs) →
  `AF-NNN` with a method (DOCS / SPIKE / EVAL / LOAD). DOCS-verified facts are recorded *in the
  dossier*; behavioural/load claims become AF items.
- **Open decisions** — every fork the tool forces (app-registration class, scope set, sync strategy)
  → `OD-NNN` with options + a recommendation. (Template: OD-011, the Slack app-class fork.)
- **Glossary** — any new load-bearing term the tool introduces, defined once.
- **Out-of-scope** — anything consciously deferred (a capability we won't use yet) → `OOS-NNN`.

### Step 4 — Verification gate (independent re-check)
Run a second, independent subagent to re-verify the **stale/refuted/load-bearing** claims against
primary sources — the connector-level version of the standing hallucination gate. A claim relied on by
a requirement must survive two independent reads.

### Step 5 — Only now spec the connector
With the dossier green and its AF/OD/glossary outputs filed, write the connector's FRs (Phase 1) and
config keys (Phase 2), each **citing the dossier** (not the design doc) for vendor facts. Corrected
values from the dossier **override** the design doc's prose; if they contradict a *locked* decision,
that goes through change control.

## The research dimensions (what every dossier must answer)

Each maps to a part of our system; the parenthetical is what it protects/feeds. The AF-003 finding
that proves the dimension matters is cited where one exists.

1. **Identity & applicability** — what the tool is; which clients / use cases / entity types / memory
   slots it serves; read-only, write, or both. *(ADR-002 slots; scopes the whole dossier.)*
2. **Auth & token lifecycle** — OAuth flow; access + refresh token **lifetimes**; **rotation**
   behaviour (single-use? does each refresh return a new token?); **revocation** triggers (password
   reset, admin, uninstall); **expiry-from-disuse**; per-account **token-count caps**; **scope
   verification / security-assessment** requirements + lead time. *(→ #1 never lose access: F5 GHL
   refresh-token rotation MUST be persisted every refresh; F4 Google 6-mo-unused + 100-token cap +
   CASA annual reassessment is an onboarding critical path.)*
3. **Rate limits & quotas** — exact **current** limits with **scope** (per user / per location / per
   app / per token); burst **and** sustained **and** daily; quota-unit models; response headers;
   429 / `Retry-After` behaviour; **what changed recently**. *(→ #3 never fail silently: F2 GHL is
   100/10s + 200k/day not 120/min; F1 Gmail is now per-minute & date-dependent; F3 Slack 2025 cut.)*
4. **API surface & capabilities** — endpoints we need; pagination; bulk vs incremental; filtering;
   batch limits; idempotency support. *(Feeds ingestion + write-path design.)*
5. **Webhooks / events / realtime** — push vs pull; event catalogue; delivery guarantees
   (at-least-once?); **signature / HMAC auth**; replay & dedup. *(ADR-007 webhook HMAC = a real hard
   control, not content-detection; idempotency ties to ADR-004.)*
6. **Data, sensitivity & ingestion** — what data, what volume, mapping to entities/memory; **PII /
   sensitivity classification** (ADR-006 clearances); **external-data boundary tagging** (ADR-007 —
   all ingested content is untrusted by default). *(→ #1 integrity, #2 containment.)*
7. **Provisioning & per-client setup** — **per-client app registration in the client's own accounts**
   (ADR-001 §5 / ADR-005 §5); redirect URIs → that deployment's domain; **consent/verification lead
   times** as a schedule dependency; who creates the account + bears the cost (client, on their card).
   *(F4 Google CASA = weeks of onboarding lead time.)*
8. **Isolation & security** — fit with Silo isolation (ADR-001); RLS implications (ADR-006);
   **least-privilege scopes** (request the minimum); service-role boundaries; injection/containment
   surface (ADR-007). *(F12: a service-role-equivalent key is god-mode — scope it down; → #2.)*
9. **Cost** — per-call / per-volume costs if any; token or compute implications; feeds the ADR-003
   estimate-grade cost model + price table. *(→ ADR-003 viability envelope.)*
10. **Failure modes & limits** — outages; partial failures; retry/backoff expectations; idempotency
    for safe re-run (ADR-004); compensation/rollback exposure (OD-010) for any external write. *(→ #3.)*
11. **Versioning & staleness risk** — API version we target; deprecation cadence; how fast our facts
    could go stale → sets the dossier's **`Re-verify by`** date. *(The meta-lesson of AF-003.)*
12. **Paper-vs-proven** — every claim that DOCS can't settle (does retrieval/ingest actually work at
    volume? does the rate limit hold under our pattern?) → an `AF-NNN` with a non-DOCS method, surfaced
    out loud, never presented as proven.

## Dimension → research-agent clustering (suggested fan-out)

To keep agents focused, cluster the 12 dimensions into ~4 parallel agents (mirrors the AF-003 run):
- **Agent A — Auth & provisioning:** dims 2, 7 (token lifecycle, app registration, verification).
- **Agent B — Limits & API:** dims 3, 4, 5 (rate limits, endpoints, webhooks/events).
- **Agent C — Data, security & isolation:** dims 6, 8 (sensitivity, scopes, RLS/containment fit).
- **Agent D — Cost, failure & versioning:** dims 9, 10, 11 (cost, failure modes, deprecation/staleness).
Dims 1 & 12 are the main thread's job (framing + paper-vs-proven triage of every agent's claims).

## Staleness rule (vendor facts are dated, not eternal)

Every dossier header carries `Verified on:` and `Re-verify by:` (default **+6 months**, or sooner if
the vendor signals change). A dossier past its `Re-verify by` date is 🟠 **stale** and **may not be
cited as current** in a new `Ready` requirement until re-run. AF-003 is the standing proof that an
unchecked vendor number is a liability, not a fact.

## Definition of done (a dossier is 🟢 green when)

- Every dimension (1–12) answered with **primary-source citations** and a **verification date**.
- Every unprovable claim filed as an `AF-NNN`; every fork as an `OD-NNN`; new terms in the glossary.
- The verification-gate re-check passed on stale/refuted/load-bearing claims.
- `Re-verify by` date set. Index row in `tool-integrations/README.md` flipped to 🟢.
- Only then may a connector FR cite the dossier and proceed toward `Ready`.
