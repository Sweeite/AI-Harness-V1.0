# Tool Integration Dossier — GoHighLevel (GHL / HighLevel) v2 API + Marketplace OAuth

> Follows `standards/tool-integration-research.md`. **No connector FR may be written until this
> dossier is 🟢.** All facts cited to **primary vendor sources** with URLs; every fact date-stamped
> (vendor facts go stale). This dossier seeds from prior DOCS findings **F2** (rate limits) and **F5**
> (OAuth refresh-token rotation) in `feasibility-register.md` — both **re-confirmed current** below.

- **Tool / vendor:** GoHighLevel / HighLevel — v2 API (LeadConnector, `services.leadconnectorhq.com`) + Marketplace OAuth 2.0
- **Status:** 🟢 verified — dossier complete + gate passed; registers filed (session 19, 2026-06-25). Build-gate AFs that block specific FRs reaching `Ready`: **AF-090** (Ed25519 signing input), **AF-095** (no write idempotency), **AF-098** (PHI/BAA legal chain).
- **Verified on:** 2026-06-25   ·   **Re-verify by:** 2026-12-25 *(see Dim 11 — **shortened-interval recommendation**: GHL ships breaking changes with **no deprecation window** multiple times/week. Strongly consider a 60–90-day re-verify or a standing changelog-poll task. Header date kept at +6mo per template default; the AF/OD for cadence carries the shorter trigger.)*
- **Researched by / session:** session 19
- **Applicability — which clients / use cases / entity types / memory slots need this, and why:**
  GHL is the **CRM / lead-pipeline connector** for clients running on GoHighLevel. The harness
  **INGESTS** contacts, opportunities / pipeline stages, conversations / messages, and calendar /
  appointments (read), and performs **ACTIONS**: create/update contact, add note, add tag, send a
  message, move pipeline stage. **Webhooks** (new leads / inbound messages) drive ingestion.
  **Per-client OAuth app, scoped per location** (one client = one GHL sub-account/location = one token
  set). **Client-owned account** (ADR-001): the client pays the HighLevel subscription and the OAuth
  app is installed in their context.
- **Read / write / both:** **Both** — read-heavy ingest + a small, costed, partly-irreversible write set.

---

## Verdict summary

**The one finding that most changes the spec:** **GHL migrated webhook signature verification from
RSA (`X-WH-Signature`) to Ed25519 (`X-GHL-Signature`), and the legacy RSA header is *deprecated
2026-07-01* — ~one week from this dossier's date.** ADR-007's webhook-HMAC control must be specced as
**Ed25519 verification against the published public key, with `X-GHL-Signature` as primary**; building
on `X-WH-Signature` would ship dead-on-arrival. Second-biggest: **`GET /contacts/` was deprecated
2026-06-11** → contact ingest must use **`POST /contacts/search` (v3)**, and GHL ships **breaking
changes with no deprecation window** multiple times/week (a high-velocity staleness risk).

| Dimension | Verdict | Headline | Source date |
|---|---|---|---|
| 2 Auth & token lifecycle | **VERIFIED** (F5 re-confirmed) | Access token `expires_in: 86399` (~24h); refresh token **single-use/rotating** (new token each refresh, old invalidated) + dies **1yr unused**; 30s concurrency window returns same token. **No Google-CASA-style blocking security review** for a private app on our own client locations. | 2026-06-25 |
| 3 Rate limits & quotas | **VERIFIED** (F2 re-confirmed, unchanged) | **100 req / 10 s** burst + **200,000 req / day**, scoped **per Marketplace app per resource (Location/Company)**. No per-minute limit. Headers `X-RateLimit-*` incl. `X-RateLimit-Daily-Remaining`. **429 body/Retry-After on outbound calls UNDOCUMENTED → AF.** | 2026-06-25 |
| 4 API surface | **VERIFIED** w/ material change | Full read+action surface exists. **`GET /contacts/` deprecated 2026-06-11 → use `POST /contacts/search` (v3).** OAuth paths renamed kebab-case (`/oauth/installed-locations`, `/oauth/location-token`) **removed w/o deprecation**. Pagination params, incremental filters, **no idempotency key**, no bulk → **AF (SPIKE).** | 2026-06-25 |
| 5 Webhooks / events | **VERIFIED — MATERIAL CHANGE** | App-level webhook URL; at-least-once. **Signing migrated RSA→Ed25519; `X-WH-Signature` (RSA) deprecates 2026-07-01; `X-GHL-Signature` (Ed25519) is current.** Dedup via **`deliveryId` (header)** + `webhookId` (body) + `timestamp`. **Retry policy CONFLICTS across two official docs (12/any-non-2xx vs 6/429-only) → AF+OD.** | 2026-06-25 |
| 6 Data & sensitivity | **VERIFIED**; one UNCERTAIN | Ingests real PII + **private comms incl. call recordings/transcripts** + deal + scheduling data. GHL is heavily used in healthcare → **every class can carry PHI.** HIPAA/BAA is an **opt-in, $297/mo, per-location** add-on (NOT default). **Whether OUR downstream app is covered by GHL's BAA = UNCERTAIN → AF (legal).** | 2026-06-25 |
| 7 Provisioning | **VERIFIED** | Free developer account; **Private app** (unlisted), **Target User = Sub-Account** → Location tokens. Client/agency admin installs + consents; client owns+pays. **Private app capped at 5 agencies free; 6+ blocked** unless Public (approval) or pass optional Security Review → **OD.** | 2026-06-25 |
| 8 Isolation & security | **VERIFIED** | Minimal least-privilege scope set enumerated below (9 scopes, all `.readonly`/scoped `.write`). **Avoid** `conversations.write` (thread-delete), `locations.write`, `companies.readonly`, `oauth.*`, `users.readonly`. **Use Location tokens, NOT Company/agency tokens** — Company token is cross-location (blast-radius/Silo violation). | 2026-06-25 |
| 9 Cost | **VERIFIED**; one UNCERTAIN | API itself **free** (bundled in subscription tier). **Outbound messaging is real money on the client's wallet, billed even on failed delivery**: SMS ~**$0.00747/segment**, MMS ~**$0.022/seg**, email ~**$0.000675/email**. Conversations-API send → same wallet **UNCERTAIN → AF (SPIKE).** | 2026-06-25 |
| 10 Failure modes | **VERIFIED**; 429-backoff UNCERTAIN | Daily cap = silent-fail risk (watch `X-RateLimit-Daily-Remaining`). **No write idempotency key.** Safe-retry contact write = **`POST /contacts/upsert`** (honors dedup setting). **Message send is irreversible + billed-on-failure** → app-layer send-once guard required. | 2026-06-25 |
| 11 Versioning / staleness | **VERIFIED** | `Version` header per-request; values `v3`(new **2026-06-11**), `2023-02-21`, `2021-07-28`, `2021-04-15`, `legacy`. **v1 EOL 2025-12-31** (don't spec). Changelog updated **multiple times/week**, **breaking changes w/o deprecation window** → high staleness risk. | 2026-06-25 |

---

## 1. Identity & applicability
GoHighLevel ("HighLevel"/"GHL") is an all-in-one CRM / marketing / pipeline platform. API host is
`services.leadconnectorhq.com` (LeadConnector). We use the **v2 API + Marketplace OAuth 2.0**.
**Entity mapping (our side):** GHL Contact → contact entity (PII); Conversation/Message → message
entity (private comms, possible recordings/transcripts); Opportunity/Pipeline → deal/pipeline entity;
Appointment/Calendar event → scheduling entity. **Read + write.** One client = one GHL location → one
per-location token set. All ingested content is **untrusted external data** (ADR-007).

## 2. Auth & token lifecycle  *(→ non-negotiable #1: never lose access)*  — **F5 RE-CONFIRMED CURRENT**
- **OAuth flow:** Authorization Code grant (3-legged). Token endpoint **`POST https://services.leadconnectorhq.com/oauth/token`**. As of the 2026-06-11 changelog, `POST /oauth/token` now **requires a `Version` header** and uses **camelCase** request/response props. The authorize/`chooselocation` redirect URL + exact query params were **not confirmed verbatim** this pass → **AF-091 (DOCS).**
- **Access-token lifetime:** `"expires_in": 86399` (~24h). **Design to the returned `expires_in`, not a constant.** (One sample shows 86400.) Src: marketplace.gohighlevel.com/docs/Authorization/OAuth2.0/ (2026-06-25).
- **Refresh-token lifetime + rotation — LOAD-BEARING (the F5 trap):** **single-use/rotating** — verbatim: *"Once you use a Refresh Token to obtain a new Access Token, the original Refresh Token becomes invalid, and the response will include a new Refresh Token."* Valid **up to one year, or until used.** **The harness MUST persist the new refresh token atomically on every refresh** or it silently loses GHL access (non-negotiable #1). A location idle >1yr loses access silently (non-negotiable #3 — needs a refresh heartbeat / re-auth path). **30-second concurrency grace:** concurrent refreshes within 30 s with the *same* `client_id`+`client_secret`+`refresh_token` return the **same** new token (race-safe), but single-flight locking is still recommended. Src: marketplace.gohighlevel.com/docs/Authorization/OAuth2.0/ + official changelog "Smarter Refresh Token Handling for Distributed Systems" (changelog page **carries no printed date → AF-091 DOCS**) (2026-06-25).
- **Token types (`userType`):** `"Location"` (sub-account, our case — also returns `locationId`) vs `"Company"` (agency, returns `companyId`). Response also includes `refreshTokenId`, `scope`, `userId`, `isBulkInstallation`. Store `refreshTokenId` + `locationId` for audit/reconciliation. Src: OAuth2.0/ (2026-06-25).
- **Revocation triggers:** user revoke via dashboard **Settings → Connected Apps** (VERIFIED). Token invalidation on **app uninstall** and on **scope change** is **not documented verbatim** → **AF-092 (SPIKE).**
- **Per-account token-count caps:** **none documented** (unlike Google's 100-token cap). Treat as "no documented cap"; verify before assuming unlimited → covered by **AF-092.**
- **Scope verification / security assessment:** **No Google-CASA-style mandatory pre-use security review** for a **private** app on our own client locations — usable immediately. (A Security Review exists only as an *optional* path to lift the private-app install cap — see Dim 7.) The new OAuth consent screen shows the full scope list + per-scope purpose + warnings for high-risk scopes (e.g. `users: write`). **Materially different from Google CASA: no multi-week blocking review on our path.** Src: help.gohighlevel.com/.../155000005002 (2026-06-25).
- **Token storage (ADR-001):** client-owned account; refresh token + `client_secret` live in the per-Silo secret store; write-through update on every refresh (per the rotation rule above).
- **What changed in last 12–18 months (auth):** (a) documented **30 s distributed-refresh window** (official changelog); (b) **enhanced consent screen** (scope list + high-risk warnings; applies to new installs / re-auth only); (c) `POST /oauth/token` now requires `Version` + camelCase; OAuth paths renamed kebab-case. The **CASA-fork is unchanged** — still no blocking review for private apps.
- **Source(s) + date:** marketplace.gohighlevel.com/docs/Authorization/OAuth2.0/ · ideas.gohighlevel.com/changelog/marketplace-api-oauth-smarter-refresh-token-handling-for-distributed-systems · help.gohighlevel.com/support/solutions/articles/155000005002 — all **2026-06-25.**

## 3. Rate limits & quotas  *(→ #3: never fail silently)*  — **F2 RE-CONFIRMED CURRENT, UNCHANGED**
- **Exact current limits + scope:** **100 API requests / 10 seconds** (burst) **+ 200,000 requests / day**, each **per Marketplace app per resource (Location or Company).** Verbatim from FAQ. **No per-minute limit exists** (refutes the original design-doc "120/min"). Src: marketplace.gohighlevel.com/docs/oauth/Faqs/ + help.gohighlevel.com/.../48001060529 (2026-06-25).
- **Scope nuance:** per-resource → a multi-location client multiplies headroom, but a single hot location can exhaust 200k/day. Throttle keyed on **`(appId, locationId)`**; scale by fanning out across locations, not by per-location concurrency.
- **Headers exposed:** `X-RateLimit-Max` (=100), `X-RateLimit-Remaining`, `X-RateLimit-Interval-Milliseconds` (=10000), `X-RateLimit-Limit-Daily` (=200000), `X-RateLimit-Daily-Remaining`. (Note: `X-RateLimit-Limit-Daily`, **not** `-Daily-Limit`; no documented `X-RateLimit-Reset`.) Daily exhaustion is visible via `X-RateLimit-Daily-Remaining` → **alarm on approach, don't discover via failed writes.**
- **429 / `Retry-After`:** 429 is the documented over-limit code, but the **response body shape and whether `Retry-After` is returned on *outbound* API 429s are NOT documented** (the retry docs cover *inbound* webhooks GHL sends us — do not conflate). → **AF-093 (SPIKE/EVAL):** backoff must not assume `Retry-After`; fall back to interval headers + exponential backoff.
- **What changed in last 12–18 months:** **nothing material** — the 100/10s + 200k/day numbers and per-resource scope are unchanged from F2 (2026-06-23 → re-confirmed 2026-06-25).
- **Source(s) + date:** marketplace.gohighlevel.com/docs/oauth/Faqs/ · help.gohighlevel.com/support/solutions/articles/48001060529 — **2026-06-25.**

## 4. API surface & capabilities
- **Required `Version` header:** send `Version` on every request. Stable widely-documented value **`2021-07-28`**; a named **`v3` shipped 2026-06-11** — do **not** auto-adopt; pin deliberately. Whether the header is strictly mandatory if omitted is **UNCERTAIN** (minor, folded into AF-094).
- **Endpoints (all present, verified to exist 2026-06-25):**
  - **Contacts:** `POST /contacts/search` (**v3 — the supported list/ingest path**), `GET /contacts/{id}`, create, **`POST /contacts/upsert`** (idempotent create-or-update — preferred write, see Dim 10), update, add tags (`POST /contacts/{id}/tags`), notes (`/contacts/{contactId}/notes`). **`GET /contacts/` is DEPRECATED (removed) as of 2026-06-11 — do NOT use.**
  - **Opportunities & pipelines:** `GET /opportunities/pipelines`, Search Opportunities (advanced), `GET /opportunities/{id}`, **Update Opportunity** (`PUT`), **Update Opportunity Status** (move stage).
  - **Conversations & messages:** Search Conversations, get messages by conversation id, get message by id, **`POST /conversations/messages`** (send).
  - **Calendars & appointments:** appointment/event get+list under calendars (read).
- **Pagination:** v3 search endpoints use a **body-based** model (page/pageLimit and/or a `searchAfter` cursor); legacy `GET` used `limit`+`startAfter`/`startAfterId`. **Exact current param names + max page size for v3 search NOT confirmable from rendered (Stoplight/JS) docs → AF-094 (SPIKE).** Do not hardcode `startAfter` for v3 search.
- **Incremental sync (updatedAt / date-range filters):** search endpoints advertise "advanced filters," but a reliable `dateUpdated`/`dateAdded` filter + stable sort for true incremental pulls is **not confirmable from rendered docs → AF-094 (SPIKE/DOCS).** Delta-vs-full-rescan strategy hinges on this.
- **Bulk:** **no** dedicated bulk import/export endpoint surfaced; ingest is paginated search. Treat as "no bulk" unless a SPIKE finds otherwise.
- **Idempotency on writes:** **NO `Idempotency-Key` header / idempotent-write semantics documented anywhere** (FAQ, versioning, changelog all silent). **Assume writes are NOT idempotent** (non-negotiable #1, never corrupt) → dedup on our side (see Dim 10). Confirm-by-absence → folded into **AF-095.**
- **OAuth endpoint renames (2026-06-11, breaking, no deprecation window):** `/oauth/installedLocations`→`/oauth/installed-locations`; `/oauth/locationToken`→`/oauth/location-token` (old paths **removed without deprecation**).
- **Source + date:** marketplace.gohighlevel.com/docs/Versioning/ · /docs/Changelog/ · /docs/ghl/contacts|opportunities|conversations/... · /docs/ghl/contacts/search-contacts-advanced/ — **2026-06-25.** *(Caveat: Stoplight endpoint reference pages are JS-rendered; endpoint existence + paths verified, exact request/response schemas marked UNCERTAIN with SPIKE methods rather than asserted.)*

## 5. Webhooks / events / realtime  *(ADR-007 webhook HMAC; ADR-004 idempotency)*
- **Config:** **app-level** single webhook URL (advanced settings → Webhook → enable + paste URL → check subscribed events). All subscribed events across **all installed locations** hit one endpoint → **handler must route by `locationId` in the payload.**
- **Event catalogue (present):** Contact (`ContactCreate`, `ContactUpdate`, delete, tag changes); Opportunity (`OpportunityCreate`, **`OpportunityStageUpdate`** — includes `pipelineStageId`, `status`); Appointment (`AppointmentCreate` + updates); plus Task/Invoice/Product/Association/Location/User; inbound/outbound message events exist (a Conversation-Provider outbound-message webhook page is confirmed). **Exact event-name strings for Inbound/Outbound message should be confirmed per-event before FRs** (DOCS, low risk; folded into AF-096).
- **Delivery guarantee:** **at-least-once** (duplicates expected → dedup required).
- **Signature / HMAC auth — MATERIAL CHANGE (load-bearing for ADR-007, non-negotiable #2):**
  - **Current:** header **`X-GHL-Signature`**, algorithm **Ed25519**, verified against a **published static public key** (PEM, inline in the integration guide — **no JWKS/key-server URL**): `MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=`.
  - **Legacy:** header **`X-WH-Signature`**, **RSA-SHA256** — **deprecated 2026-07-01** (~1 week from this dossier's date). Ed25519 takes precedence when both headers present.
  - **Spec Ed25519/`X-GHL-Signature` as primary; do NOT build on `X-WH-Signature` (dead ~2026-07-01).** Pin the public key as **config, not hardcoded**, so rotation needs no redeploy.
  - **The exact signed-message construction (what bytes are signed — raw body? body+timestamp?) is NOT stated → AF-090 (DOCS/SPIKE)** — must confirm against a live payload before implementing verification.
  - Src: marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide/ + ideas.gohighlevel.com/changelog/app-marketplace-security-update-webhook-authentication (2026-06-25).
- **Retry policy — DOCUMENTED CONFLICT (verified verbatim on both pages):**
  - **Integration Guide:** "up to **12** retries (excluding original), exponential backoff + jitter, on **any non-2xx** (3xx/4xx/5xx) + timeouts."
  - **Dedicated retries help article (155000007071):** "**6** retries, **~10 min** apart with jitter, ~1h10m total, **429 ONLY** — no retries on 5xx."
  - The two **genuinely contradict**; neither declares precedence. → **AF-097 (DOCS/SPIKE) + OD-042.** Design impact (non-negotiable #3): **if 5xx truly gets no retry, a transient outage on our side silently DROPS events.** Mitigation regardless of resolution: **durably queue then return 2xx on receipt; return 429 only as deliberate backpressure.**
- **Replay & dedup:** **`deliveryId`** (header, identical across all retries of an event — the retry-dedup key), **`webhookId`** (payload body — "store to prevent duplicate processing; make processing idempotent"), **`timestamp`** (ISO-8601, for out-of-order handling). **No documented replay-protection window/nonce** beyond timestamp → if freshness enforcement is required, we implement it (folded into AF-096). Ties to ADR-004 idempotency.
- **Source + date:** marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide/ · help.gohighlevel.com/support/solutions/articles/155000007071 — **2026-06-25.**

## 6. Data, sensitivity & ingestion  *(→ #1 integrity, #2 containment; ADR-006, ADR-007)*
- **What we read:** contact PII (name, email, phone, address, custom-field values, tags, notes); **message content incl. call recordings + transcriptions**; opportunity/pipeline data (deal value, stage); appointments/calendar. **All ingested content = untrusted external data, tagged at the ADR-007 boundary by default.**
- **Sensitivity (ADR-006 clearances):** message content + recordings/transcripts = **highest tier** (private two-party comms + voice). Contact PII + opportunity (commercial-sensitive) = Confidential. Classify the contact/message stores accordingly at rest.
- **PHI / HIPAA — VERIFIED material:** GHL explicitly enumerates PHI-bearing objects ("Contacts, Notes, Custom Fields, SMS/MMS, voice recordings, email bodies & attachments, form/survey submissions, calendars, invoices"). GHL is heavily used in healthcare → **every class we ingest can carry PHI.** HIPAA is **NOT default** — it's an **opt-in account-wide add-on (US$297/mo, per-location enable, cannot be disabled once on)**; BAA is HighLevel↔Agency, signed in-platform. **Track a HIPAA flag per client/location, not per agency.** Encryption at rest = AES-256 (vendor-side only; does **not** cover data egressed into our harness — our own encryption obligation stands). Src: help.gohighlevel.com/.../48000983084 (modified 2026-06-11) (2026-06-25).
- **BAA chain for OUR downstream app — UNCERTAIN → AF-098 (legal):** GHL's BAA is HighLevel↔Agency; docs are **silent** on whether a third-party Marketplace app that *egresses* PHI is covered or must hold its own BAA with the client. **Non-negotiable #2 risk: ingesting PHI without a BAA chain is a compliance violation.** Must resolve before ingesting any HIPAA-enabled location's data.
- **Volume / sync pacing:** record counts + bulk-backfill behaviour not in scope docs → **AF-094** (ties to rate limits, Dim 3/4).
- **Source + date:** marketplace.gohighlevel.com/docs/Authorization/Scopes/ · help.gohighlevel.com/.../48000983084 — **2026-06-25.**

## 7. Provisioning & per-client setup  *(ADR-001 §5 / ADR-005 §5)*
- **Developer account:** free signup at marketplace.gohighlevel.com (verify phone+email); not gated behind a paid agency plan. No commission on app revenue.
- **App class:** **Private** (unlisted, "personal/internal use", not listed in Marketplace) — our model. Avoids public listing + public-app approval.
- **Distribution (two distinct knobs):** **Target User** = **Sub-Account** (→ Location tokens, recommended for ~95% of apps; matches our per-location model) vs Agency; **Who Can Install** = marketplace visibility; plus a Bulk-installation flag. Single sub-account install → `isBulkInstallation:false`, `userType:"Location"`.
- **Redirect URI:** must be HTTPS, exact-match; multiple addable → register each deployment's domain (ADR-005).
- **Client ID / Secret:** generated in the Secrets section; **secret shown once** ("will not be shown again") → capture into the secret store at creation; only regenerate, no recovery.
- **Who installs / who pays:** the client/agency **admin** performs the install + OAuth consent (consent screen shows scopes + high-risk warnings); **client owns the GHL account and pays the subscription** (consistent with ADR-001 retainer model). Our connector consumes the resulting **Location** token.
- **Approval / verification lead time (the fork vs Google CASA):** a Private app needs **NO approval to install/use** within the install cap → **usable immediately, no multi-week review on our path.** **BUT: a Private app is capped at 5 unique Agencies; at 6+ Agencies new installs are BLOCKED** unless we (a) publish Public (needs approval) or (b) pass an **optional Security Review** to stay Private + uncapped. **Each client lives in its own GHL agency → >5 client agencies on one Private app trips the block → OD-041.**
- **Source + date:** marketplace.gohighlevel.com/docs/2021-07-28/oauth/CreateMarketplaceApp · /docs/oauth/AppDistribution/ · /docs/oauth/CreateDeveloperAccount/ · help.gohighlevel.com/.../155000000136 · /.../155000002141 · /.../155000005002 — **2026-06-25.**

## 8. Isolation & security  *(ADR-001 Silo, ADR-006 RLS, ADR-007 containment, F12 god-mode lesson)*
- **Least-privilege scope set — minimal set for our use case (VERIFIED scope strings):**
  ```
  contacts.readonly  contacts.write
  opportunities.readonly  opportunities.write
  conversations.readonly  conversations/message.readonly  conversations/message.write
  calendars.readonly  calendars/events.readonly
  ```
  (Add `locations.readonly` **only** if location config is actually consumed — otherwise omit.) Mapping: contact note/tag writes live under `contacts.write`; move-stage = `opportunities.write` (PUT opportunity status); send message = `conversations/message.write` (POST `/conversations/messages`); recordings/transcripts read under `conversations/message.readonly`.
- **Scopes to AVOID (over-broad / god-mode):** `conversations.write` (grants **thread delete** — violates least-privilege + non-negotiable #1; sending only needs `conversations/message.write`); `locations.write` (agency config); `companies.readonly` (breaks one-client-one-location isolation); `oauth.readonly`/`oauth.write` (agency token-minting); `users.readonly` (staff directory, not in our surface); any calendar `*.write` (read-only use case); `locations/tags.*` + `locations/customFields.*` (manage the location's tag/field *dictionary* — we only read/write *values*, covered by `contacts.write`).
- **Token scoping / Silo fit:** **use per-location `userType:"Location"` tokens, one per client install** — bound to one `locationId`, **no cross-location reach.** **Do NOT use the Company-token + agency-exchange pattern** (`Get Location Access Token from Agency Token`): a Company token is cross-location by design, would force us to hold agency-wide credentials, and concentrates blast radius — a Silo-isolation + non-negotiable #2 violation. This keeps each client's token blast-radius to a single location.
- **RLS (ADR-006):** ingested GHL data lands under per-client RLS like all other ingest; the per-location token boundary is the upstream complement to RLS downstream.
- **Confidence caveat:** scope *strings* corroborated against a live production OAuth consent URL in the docs; exact endpoint-to-scope *mappings* read via docs-fetch summarizer — an implementer should open the Scopes page directly and confirm the endpoint list under each scope before locking FRs (GHL revises these).
- **Source + date:** marketplace.gohighlevel.com/docs/Authorization/Scopes/ · /docs/Authorization/OAuth2.0/ · /docs/Authorization/TargetUserSubAccount/ — **2026-06-25.**

## 9. Cost  *(→ ADR-003)*
- **API per-call cost:** **none.** "Basic API access included with Starter and Unlimited plans; Advanced API access on Agency Pro." API is **bundled in the GHL subscription tier**, not metered per call. **Confirm the client's plan tier supports the endpoints we need** (some are Agency-Pro-gated). Src: help.gohighlevel.com/.../48001060529 (2026-06-25).
- **Developer account / publishing:** **free**; no commission on app revenue. (Private-app 5-agency cap is a scaling gate, not a cost — see Dim 7 / OD-041.)
- **Outbound MESSAGING — real per-action cost on the client's wallet (the load-bearing cost finding):**
  - **SMS (US/CA):** ~**$0.00747 / segment** (multi-segment multiplies); **MMS:** ~**$0.0220 / segment**.
  - **Email (LC Email):** ~**$0.000675 / email** ($0.675/1,000), charged on outgoing **and** incoming.
  - **Billed even on failure:** verbatim — *"Charges apply to every message where a delivery attempt has been made, regardless of the final delivery status."*
  - **Wallet model:** prepaid wallet auto-recharges below threshold; if it can't fund, **sending is blocked.**
  - **Design impact:** every `send message` WRITE is a **costed, billed-even-on-failure money event** on the client's wallet → guard with explicit policy/approval; **never blind-retry-loop a send** (each attempt that reaches "delivery attempted" bills again). Feeds the ADR-003 cost model as a **per-write-action variable cost** (distinct from per-call $0 API cost).
  - **⚠️ UNCERTAIN → AF-099 (SPIKE):** docs don't *explicitly* state that **Conversations-API** sends draw the *same* LC Phone/LC Email wallet as UI/workflow sends (strongly implied — single wallet per sub-account — but unverified). Confirm by sending one SMS via the v2 API on a test sub-account and observing the wallet debit.
- **Rebilling/reseller:** carrier + A2P 10DLC charges pass through (legacy SMTP path on $297 tier carries a fixed 1.05× email markup). **A2P 10DLC registration is a prerequisite + fee before US SMS works at all** → onboarding gate. In the retainer model, messaging cost lands on the client's wallet (consistent with "client pays opex").
- **Source + date:** help.gohighlevel.com/.../48001223556 (LC Phone) · /.../48001220605 (LC Email) · /.../155000001156 · /.../155000005200 (A2P) · /.../48001060529 — **2026-06-25.**

## 10. Failure modes & limits  *(→ #3, ADR-004, OD-010)*
- **Status / outage:** official page status.gohighlevel.com; **no documented machine-readable incident feed** → don't depend on it for automated degradation detection.
- **Daily-cap exhaustion = the silent-fail risk:** once 200k/day/location is hit, calls fail until reset. **Read `X-RateLimit-Daily-Remaining` and alarm on approach** — never discover exhaustion via failed writes (non-negotiable #3).
- **429 / outbound backoff:** **no official `Retry-After`/backoff spec for our outbound calls** → **AF-093.** (Inbound-webhook retry is the conflicted policy in Dim 5 / AF-097.)
- **Idempotency on writes:** **none** (no idempotency key — AF-095). The substitute:
  - **Contact write → use `POST /contacts/upsert`** (the documented idempotent create-or-update; honors the location's "Allow Duplicate Contact" dedup setting, primary Email + optional Phone). **Prefer upsert over `POST /contacts/`.**
  - `POST /contacts/` does **not** document an `allowDuplicate` body flag; the create-on-duplicate **error shape is UNCERTAIN → AF-100 (SPIKE)** (mitigated by preferring upsert).
- **Compensation / rollback (OD-010 exposure):** **message send is one-way, costed, irreversible** (no void/un-send; billed on "delivery attempted"). Contact writes are reversible via update/delete; sends are not. → **app-layer "already sent this" send-once guard required** (the API offers no server-side replay protection and no undo). Non-negotiables #2 + #3.
- **Source + date:** marketplace.gohighlevel.com/docs/oauth/Faqs/ · help.gohighlevel.com/.../155000007071 · /.../48001223556 · marketplace.gohighlevel.com/docs/ghl/contacts/upsert-contact/ · /docs/ghl/contacts/create-contact/ · help.gohighlevel.com/.../48001181714 · status.gohighlevel.com — **2026-06-25.**

## 11. Versioning & staleness risk
- **Version targeted:** pin an explicit `Version` header. Stable choice **`2021-07-28`**; named **`v3` released 2026-06-11** (decide migration deliberately, via this gate — don't auto-adopt). Valid header values: `v3`, `2023-02-21`, `2021-07-28`, `2021-04-15`, `legacy`. Src: marketplace.gohighlevel.com/docs/Versioning/ (2026-06-25).
- **v1 status:** **EOL 2025-12-31** — *"end-of-support… existing integrations continue to work, no support or updates."* **Do NOT spec any v1 endpoints** (v2 / OAuth / Private Integrations only). Src: help.gohighlevel.com/.../48001060529 (2026-06-25).
- **Deprecation cadence → Re-verify-by:** public changelog (marketplace.gohighlevel.com/docs/Changelog/) updated **multiple times/week** (recent: 2026-06-18/15/12/11). **Breaking changes ship with NO deprecation window** (OAuth paths "removed without deprecation"; contacts/opportunities migrated to v3, legacy removed; `GET /contacts/` removed). **High-velocity, low-warning vendor.** → **Recommend Re-verify-by of 60 days (max 90)** for this dossier and a **standing changelog-poll task**; any FR citing a specific endpoint shape (OAuth token paths, contact/opportunity schemas, webhook signing) is at elevated staleness risk and must be re-checked before build. **(Header `Re-verify by` kept at the +6mo template default 2026-12-25; the shorter trigger is carried by OD-043.)**
- **Source + date:** marketplace.gohighlevel.com/docs/Versioning/ · /docs/Changelog/ · help.gohighlevel.com/.../48001060529 — **2026-06-25.**

## 12. Paper-vs-proven (triage)
DOCS-settled facts are recorded above. Everything that DOCS could not settle is filed as an AF below
with a non-DOCS method (SPIKE/EVAL/LOAD) and must **not** be presented as proven. The load-bearing
ones for the three non-negotiables: refresh-token rotation persistence (#1 — DOCS-verified but the
*implementation* must be LOAD/SPIKE-checked for the race window), webhook 5xx-no-retry event loss
(#3 — AF-097), write non-idempotency + irreversible billed sends (#1/#2 — AF-095/094/095), PHI/BAA
chain (#2 — AF-098).

---

## Outputs filed (Rule 0 — write it down)

> **NOTE for the main thread:** this dossier *proposes* the register items below but **does NOT edit**
> `feasibility-register.md`, `open-decisions.md`, `glossary.md`, or `out-of-scope.md`. The main thread
> files them. IDs follow the prompt's allocation (next AF = AF-089+, next OD = OD-041+, next OOS = OOS-022+).

- **AF (feasibility) items to raise:**
  - **AF-089 — SPIKE/LOAD:** refresh-token rotation *implementation* — the harness must persist the new
    refresh token atomically on every refresh; verify the 30s-window race-safety holds under our
    concurrency pattern. *(Load-bearing for non-negotiable #1; the F5 trap.)*
  - **AF-090 — SPIKE:** webhook **Ed25519 signing input** — confirm exactly which bytes are signed (raw
    body? body+timestamp?) against a live `X-GHL-Signature` payload before implementing verification.
    *(ADR-007 hard control; non-negotiable #2.)*
  - **AF-091 — DOCS:** confirm the exact authorize/`chooselocation` endpoint URL + required query params,
    and date-stamp the "Smarter Refresh Token Handling" changelog (page has no printed date).
  - **AF-092 — SPIKE:** confirm token invalidation on **app uninstall** and **scope change**, and whether
    any **per-account/per-location token-count cap** exists (none documented).
  - **AF-093 — SPIKE/EVAL:** outbound-call **429 response shape + whether `Retry-After` is returned**;
    derive the backoff strategy.
  - **AF-094 — SPIKE:** v3 search **pagination params + max page size** (`searchAfter` vs `page`/`pageLimit`)
    and **incremental-sync filters** (`dateUpdated`/`dateAdded` + stable sort) per resource; full-sync
    volume per location. *(Ingest design + Dim 6 volume.)*
  - **AF-095 — DOCS/SPIKE:** confirm **no `Idempotency-Key` support** on writes (send the header on a create,
    verify it's ignored). *(Load-bearing for non-corruption #1.)*
  - **AF-096 — DOCS/SPIKE:** confirm exact **Inbound/Outbound message webhook event-name strings** and
    whether any **replay-protection window** exists beyond `timestamp`.
  - *(The original draft's separate "webhook signing input" SPIKE is folded into **AF-090** above.)*
  - **AF-097 — DOCS/SPIKE:** resolve the **webhook retry-policy conflict** (12/any-non-2xx vs 6/429-only).
    *(Load-bearing for never-fail-silently #3; pairs with OD-042.)*
  - **AF-098 — DOCS→LEGAL:** **PHI/BAA chain** for our downstream app egressing PHI — is it covered by
    GHL's HighLevel↔Agency BAA, or must we hold our own with the client? *(Non-negotiable #2; gate before
    ingesting any HIPAA-enabled location.)*
  - **AF-099 — SPIKE:** confirm **Conversations-API sends draw the LC Phone/LC Email wallet** (send one SMS
    via v2 API on a test sub-account, observe debit). *(ADR-003 cost model.)*
  - **AF-100 — SPIKE:** **create-contact duplicate error shape** (only if `POST /contacts/` is used instead
    of upsert; mitigated by preferring `/contacts/upsert`).
- **OD (open decisions) to raise:**
  - **OD-041 — Private-app 5-agency install cap.** Each client = its own GHL agency → >5 client agencies on
    one Private app is **blocked**. Fork: (a) **pass the optional Security Review** to keep Private +
    uncapped *(recommended — preserves least-exposure, no public listing)*; (b) publish **Public** (needs
    approval, lists the app); (c) **one Private app per ≤5 clients** (operational overhead, more secrets to
    manage). **Recommendation: (a).** Decide before onboarding the 6th client agency.
  - **OD-042 — Webhook retry/redelivery contract.** Given the documented 12-vs-6 / any-non-2xx-vs-429-only
    conflict (AF-097), pick our receiver contract independent of which doc is authoritative: **durably queue
    then return 2xx on receipt; return 429 only as deliberate backpressure; dedup on `deliveryId`.**
    **Recommendation: adopt that contract now**; AF-097 only tunes the backpressure assumption.
  - **OD-043 — Re-verify cadence for GHL.** GHL ships breaking changes with no deprecation window multiple
    times/week. Fork: keep the +6mo default vs **shorten to 60–90 days + standing changelog-poll**.
    **Recommendation: 90-day re-verify + changelog-poll task.**
- **Glossary terms to add:**
  - **Location token (GHL)** — a `userType:"Location"` OAuth access token bound to one sub-account
    (`locationId`); our per-client unit of access. Contrast **Company/Agency token** (cross-location).
  - **Refresh-token rotation (GHL)** — single-use refresh tokens: each refresh returns a new one and
    invalidates the old; the new token MUST be persisted every refresh.
  - **LC Phone / LC Email wallet** — the client's prepaid messaging-billing balance; outbound sends draw it,
    billed even on failed delivery.
  - **`deliveryId` (GHL webhook)** — header identical across all retries of one webhook event; the retry-dedup key.
- **Out-of-scope to log:**
  - **OOS-022 — Company/Agency-level tokens + agency token-exchange** (`oauth.*` scopes, `Get Location Access
    Token from Agency Token`): deliberately not used — cross-location blast radius breaks Silo isolation.
  - **OOS-023 — Calendar/appointment WRITE** (`calendars/events.write`): read-only for now; creating/editing
    appointments deferred.
  - **OOS-024 — GHL v1 API**: EOL 2025-12-31; never specced.
  - **OOS-025 — Bulk import/export**: no documented bulk endpoint; ingest is paginated search only (for now).
- **Connector FRs this unblocks (Phase 1):** Tool-Layer GHL connector FRs for OAuth install + per-location
  token lifecycle (rotation persistence), rate-limit throttling, contact/opportunity/conversation/calendar
  ingest, the five write actions, and webhook receipt + Ed25519 verification + dedup. *(Citing this dossier,
  not the design doc, for vendor facts.)*
- **Config keys this implies (Phase 2):** `CFG-GHL-RATE-BURST=100/10s`, `CFG-GHL-RATE-DAILY=200000/day`
  (per app per location), `CFG-GHL-ACCESS-TTL=expires_in` (~86399s, design to returned value),
  `CFG-GHL-REFRESH-TTL=1yr-unused`, `CFG-GHL-VERSION-HEADER=2021-07-28` (pin), `CFG-GHL-SCOPES=<the 9-scope
  set above>`, `CFG-GHL-WEBHOOK-PUBKEY=<Ed25519 PEM, as config not hardcoded>`,
  `CFG-GHL-REVERIFY=2026-12-25` (or 90-day per OD-043).

## Verification-gate result
**PASS.** An independent, zero-context verification subagent re-checked the stale/refuted/load-bearing
claims against primary sources (2026-06-25): webhook RSA→Ed25519 migration + `X-WH-Signature`
deprecation **2026-07-01** (CONFIRMED, verbatim, corroborated by changelog); `GET /contacts/`
deprecation 2026-06-11 + `POST /contacts/search` v3 (CONFIRMED); refresh-token single-use rotation +
1yr-unused + `expires_in` 86399 (CONFIRMED verbatim — F5 holds); rate limits 100/10s + 200k/day per app
per resource (CONFIRMED verbatim — F2 holds, unchanged); `v3` version released 2026-06-11 + header
values (CONFIRMED); Private-app 5-agency cap + unblock paths (CONFIRMED verbatim). The **webhook
retry-policy conflict (12/any-non-2xx vs 6/429-only) was CONFIRMED as a real, unresolved contradiction
across two official pages** → correctly logged as AF-097 + OD-042 rather than asserted as fact. No
load-bearing claim rests on a single read.
