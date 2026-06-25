# Tool Integration Dossier — Google (Gmail + Drive + Calendar)

> Built per `standards/tool-integration-research.md`. **No connector FR may be written until this
> dossier is 🟢.** Cite **primary vendor sources** with URLs; date-stamp every fact (vendor facts go
> stale). This dossier re-confirms the prior AF-003 DOCS findings **F1 (Gmail quota)** and **F4
> (Google OAuth)** as current, and fills the under-covered dimensions (API surface, push/webhooks,
> data/sensitivity, provisioning, scopes, cost, failure modes, versioning).

- **Tool / vendor:** Google — Gmail API (v1), Google Drive API (v3), Google Calendar API (v3), via Google OAuth 2.0
- **Status:** 🟢 verified — dossier complete + gate passed; registers filed (session 19, 2026-06-25). Load-bearing reconciliation: webhook auth has **no HMAC** → ADR-007 reconcile via **OD-044**.
- **Verified on:** 2026-06-25   ·   **Re-verify by:** 2026-12-25 (default +6 months; **but see Dim 11 — a sooner re-check is advised before the Workspace overage-billing go-live, which lands "later in 2026" with ≥90 days' notice**)
- **Researched by / session:** session 19
- **Applicability — which clients / use cases / entity types / memory slots need this, and why:**
  The harness **ingests** email (Gmail — messages, threads), files/documents (Drive), and calendar
  events for **most clients**, mapping them into the memory system. It may also perform **actions**
  (send email, create a calendar event). Per-client OAuth app registered in the **client's own Google
  Cloud project** (client pays); redirect URIs point to that deployment's domain. Gmail is a
  **restricted** scope (triggers CASA). Read-mostly for ingestion.
- **Read / write / both:** **Both, read-mostly.** Read = Gmail/Drive/Calendar ingestion (the dominant
  path). Write = optional `gmail.send` and `calendar.events.insert` actions.

---

## Verdict summary

The two pre-verified dimensions **hold as of 2026-06-25** (F1 Gmail per-minute quota; F4 OAuth
token lifecycle). The single **most spec-changing** finding is in Dim 5: **Google Workspace push has
NO HMAC webhook signature** — Gmail authenticates via a **Pub/Sub OIDC JWT**, and Drive/Calendar use a
**static client-set channel token over TLS only**. This contradicts ADR-007's webhook-HMAC assumption
and forces two distinct verification paths → **OD-044**. Runner-up: the Workspace APIs are **free
today but overage billing is planned "later in 2026"** (Dim 9), flipping "the APIs are free" into
"free-tier, billable-on-overage soon."

| Dimension | Verdict | Headline | Source date |
|---|---|---|---|
| 2 Auth & token lifecycle | **VERIFIED (F4 holds) + 1 new policy** | Access ~1h (`expires_in`); refresh: Testing=7-day expiry, Prod dies 6-mo-unused + revoked on password reset (Gmail scopes); 100-token/account/client-id cap; Google does **not** rotate refresh tokens. **NEW:** unused OAuth *clients* auto-deleted after ≥6 mo idle (policy eff. 2025-10-27). | 2026-06-25 |
| 3 Rate limits & quotas | **VERIFIED (F1 holds)** | Gmail 6,000 QU/min/user + 1.2M QU/min/project, **date-dependent by GCP project age** (≥2026-05-01 projects get new figures; Nov2025–Apr2026 projects keep old). Drive/Calendar per-minute model VERIFIED, **exact numbers UNCERTAIN** (AF-101). No `Retry-After` header — client-side backoff only. | 2026-06-25 |
| 5 Webhooks / events | **VERIFIED — contradicts ADR-007** | **No HMAC anywhere.** Gmail = Pub/Sub OIDC JWT; Drive/Calendar = client-set `X-Goog-Channel-Token` + TLS. Watch channels expire (Gmail ~7d, Drive `changes` 7d max / `files` 1d, Calendar bounded) with **no auto-renew**. At-least-once → dedup on `historyId`. → OD-044. | 2026-06-25 |
| 6 Data & sensitivity | **VERIFIED** | Gmail = HIGH-PII full bodies/headers/attachments; Drive = arbitrary/unbounded; Calendar = attendee PII + free text. **Limited Use policy** (current page updated 2026-04-20) bars using the data to train/improve any model **beyond that user's personalized model** + bars casual human reads. | 2026-06-25 |
| 7 Provisioning | **VERIFIED (F4 critical-path holds)** | Per-client OAuth app in client's own GCP project is fully supported. **Restricted-scope (Gmail) verification ≈ 6 weeks + annual CASA recert**; Google charges $0 but the third-party assessor charges (~$500–$4,500). **NEW:** console rebranded to "Google Auth Platform"; CASA self-scan deprecated. | 2026-06-25 |
| 8 Isolation & security | **VERIFIED** | Least-privilege: `gmail.send` is **Sensitive (no CASA)** — prefer over `gmail.modify`. **Drive fork:** `drive.readonly` (RESTRICTED, full corpus, CASA) vs `drive.file` (non-sensitive, no CASA, only app-touched files) → **OD-045**. No non-restricted way to read existing Gmail. Incremental auth supported. | 2026-06-25 |
| 9 Cost | **VERIFIED — with dated caveat** | API calls free **today**; **overage billing planned "later in 2026," ≥90 days' notice** → AF-103. **Cloud Pub/Sub is billable** (10 GiB/mo free, then $40/TiB) — client's GCP project pays for Gmail push. Works on consumer @gmail.com + Workspace alike; **no Workspace license required**. | 2026-06-25 |
| 10 Failure modes | **VERIFIED** | 429/403 (`rateLimitExceeded`/`userRateLimitExceeded`/`dailyLimitExceeded`) + 5xx → exponential backoff (jitter is *our* add, not in Workspace docs → AF-104). **Gmail send has NO idempotency key → double-send risk** (OD-010/ADR-004). **Calendar `events.insert` accepts a client `id` → retry returns 409-duplicate** = safe re-run (not 100% guaranteed in distributed races → AF-102). | 2026-06-25 |
| 11 Versioning / staleness | **VERIFIED** | Gmail v1 / Drive v3 / Calendar v3 (stable). Global HTTP batch endpoint dead since 2020 → use per-API batch. Granular OAuth consent mandatory. No explicit Workspace deprecation-notice window found (AF-105). Fast-moving → **short re-verify horizon**. | 2026-06-25 |

---

## 1. Identity & applicability
Three Google Workspace REST APIs accessed under one Google OAuth 2.0 authorization-code flow:
- **Gmail API v1** — ingest messages/threads (high-PII email); optional send.
- **Google Drive API v3** — ingest files/documents (arbitrary content).
- **Google Calendar API v3** — ingest events; optional event creation.

Maps into the memory system as the primary external-knowledge source for most clients. **Read-mostly**
(ingestion dominates); two optional **write** actions (`gmail.send`, `calendar.events.insert`). Per
ADR-001/ADR-005 the OAuth app lives in the **client's own Google Cloud project** (client pays opex);
redirect URIs point to that deployment's domain.

## 2. Auth & token lifecycle  *(→ non-negotiable #1: never lose access)* — **VERIFIED (F4 holds), +1 new policy**
- **OAuth flow:** OAuth 2.0 authorization-code, web-server flow. Src: developers.google.com/identity/protocols/oauth2/web-server (2026-06-25).
- **Access-token lifetime:** ~1 h. **Design to the returned `expires_in`, not a constant** — docs show `"expires_in": 3920` and document the field, not a guaranteed 3600. Src: developers.google.com/identity/protocols/oauth2/web-server (2026-06-25).
- **Refresh-token lifetime + rotation:**
  - **Testing publishing status → refresh token expires in 7 days** (verbatim), *unless* the only scopes are a subset of name/email/profile — **Gmail/restricted scopes do NOT qualify for that exception.** ⇒ every client's app **must be published to Production** before go-live, or the connector silently breaks every 7 days (#1 + #3). 
  - **Production → no fixed-clock aging, BUT** the token stops working if (a) **unused for 6 months**, or (b) **the user changed passwords and the token contains Gmail scopes**.
  - **Rotation: Google does NOT rotate refresh tokens on a normal refresh** (a standard refresh does not return a new refresh token; `prompt=consent` is required to force a new one). **This is the opposite of GHL (F5)** — do NOT build GHL-style "persist a new refresh token every refresh" logic for Google. *(Confirmed indirectly via the `prompt=consent` language → low-risk SPIKE AF-106.)*
  - Src: developers.google.com/identity/protocols/oauth2 ("Refresh token expiration"); developers.google.com/identity/protocols/oauth2/web-server (2026-06-25).
- **Per-account token-count cap:** **100 refresh tokens per Google Account per OAuth 2.0 client ID** (verbatim). *"If the limit is reached, creating a new refresh token automatically invalidates the oldest refresh token without warning."* **Load-bearing for a multi-user Silo reusing one OAuth client** — store and reuse one refresh token per account; avoid needless re-prompts. Src: developers.google.com/identity/protocols/oauth2 (2026-06-25).
- **Revocation triggers:** user revokes app access; 6-month inactivity; password change (Gmail/restricted scopes); exceeding the 100-token cap; time-based grant expiry; **Workspace admin restricting the requested service org-wide**; GCP session-length policy (Cloud-Platform scopes only). Treat `invalid_grant` as **needs re-consent**, never a transient retry (#3). Src: developers.google.com/identity/protocols/oauth2 (2026-06-25).
- **Token storage** (ADR-001 — client-owned accounts): the OAuth client (client_id/secret) lives in the **client's GCP project**; the per-user refresh token is held by the harness's per-client Silo token store. One persisted refresh token per account (no rotation churn).
- **What changed (12–18 mo):** **NEW policy effective 2025-10-27** — Google may **delete OAuth *clients* inactive ≥6 months** (no token exchanges and no config edits). Distinct from the 6-month *token* inactivity rule: a long-idle integration can lose **the whole OAuth client**, not just a token (#1/#3). → **AF-107 (monitor)**. Src: developers.google.com/identity/protocols/oauth2/policies (2026-06-25).
- **Source(s) + date:** developers.google.com/identity/protocols/oauth2 · /web-server · /policies — all accessed 2026-06-25. **F4 re-confirmed current; no prior finding refuted.**

## 3. Rate limits & quotas  *(→ #3: never fail silently)* — **VERIFIED (F1 holds)**
- **Gmail (verbatim, current):** *"As of May 1, 2026, the usage limits for this API were updated. Google Cloud projects that made any use of this API between November 2025 and April 2026 will continue with their previously set usage quotas. Cloud projects created on or after May 1, 2026 are subject to the new API quotas."* New per-minute figures: **6,000 QU/min/user/project** + **1,200,000 QU/min/project**; daily free ceiling **80,000,000 QU/project/day** (not raisable). **The effective limit a Silo gets depends on its GCP project's age/usage history — pin per-environment, never cite one number.** Quota-unit costs: `messages.send`=100, `.get`=20, `.list`=5, `history.list`=2, `getProfile`=1. **Quota hot path is the 20-unit `messages.get` × N during full sync, not `list`.** Src: developers.google.com/workspace/gmail/api/reference/quota (2026-06-25).
- **Drive:** per-minute quota-unit model with per-project + per-user-per-project ceilings and per-method costs (reads cheap, list/download expensive). **Model VERIFIED; exact current numbers UNCERTAIN → AF-101 (DOCS).** Src: developers.google.com/workspace/drive/api/guides/limits (2026-06-25).
- **Calendar:** requests/minute model with per-project + per-user-per-project ceilings + daily threshold. **Model VERIFIED; exact numbers UNCERTAIN → AF-101 (DOCS).** Src: developers.google.com/workspace/calendar/api/guides/quota (2026-06-25).
- **429 / `Retry-After`:** quota exhaustion surfaces as **403** (`rateLimitExceeded`/`userRateLimitExceeded`/`dailyLimitExceeded`) and/or **429**. **No `Retry-After` header is documented for any of the three** → the harness **must implement client-side truncated exponential backoff itself; do not depend on a server-supplied delay.** Src: gmail/drive/calendar handle-errors pages (2026-06-25).
- **What changed (12–18 mo):** the Gmail **per-second → per-minute migration (effective 2026-05-01), split by project age**, is the big one and is correctly captured by F1. Drive/Calendar pages also carry "limits updated May 1, 2026" language (whether the same project-age split applies is **UNCERTAIN → folded into AF-101**).
- **Source(s) + date:** as above, all 2026-06-25. **F1 re-confirmed current.**

## 4. API surface & capabilities — **VERIFIED**
- **Gmail:** `messages.list` (`q` filter, `pageToken`, `maxResults`); `messages.get` (`format`=full/metadata/raw); `messages.send`. **Incremental sync = History API:** `history.list` with `startHistoryId`; persist the latest `historyId` per sync. **Retention (verbatim):** *"History records are typically available for at least one week and often longer… the time period… may be significantly less and records may sometimes be unavailable in rare cases."* When `startHistoryId` is too old, `history.list` returns **HTTP 404** → **must full-sync** (`messages.list` → batched `messages.get`). **The harness must treat 404-on-history as a normal control-flow branch with a full-sync fallback; never assume a fixed retention.** Src: developers.google.com/workspace/gmail/api/guides/sync (2026-06-25).
- **Drive:** `files.list` (paginated), `files.get`. Incremental via `changes.getStartPageToken` → `changes.list`; three tokens — `pageToken` (input), `nextPageToken` (more pages), `newStartPageToken` (store on final page). **Page-token expiry/error not documented → AF-108 (DOCS/SPIKE)** (confirm whether change page tokens expire and the resulting error, for full-resync fallback parity with Gmail 404 / Calendar 410). Src: developers.google.com/workspace/drive/api/guides/manage-changes (2026-06-25).
- **Calendar:** `events.list` with `syncToken` for incremental; `events.insert` for writes. **`syncToken` invalidation → HTTP 410 GONE** (expiry or ACL change) → **wipe local store + fresh full sync.** `syncToken` appears only on the final page; keep query params identical across pages. Src: developers.google.com/workspace/calendar/api/guides/sync (2026-06-25).
- **Batch:** the **global** batch endpoint (`www.googleapis.com/batch`) was discontinued **2020-08-12** (historical, not upcoming) — **use per-API endpoints only** (e.g. `www.googleapis.com/batch/gmail/v1`). Gmail batch: hard cap **100 calls/batch**, **Google recommends ≤50** (*"Sending batches larger than 50 requests is not recommended… likely to trigger rate limiting"*). Src: developers.google.com/workspace/gmail/api/guides/batch; developers.googleblog.com/discontinuing-support-for-json-rpc-and-global-http-batch-endpoints (2026-06-25).
- **Pagination:** `pageToken` / `nextPageToken` across all three.
- **Idempotency:** **no native key for Gmail `messages.send`** (double-send risk); **Calendar `events.insert` accepts a client-supplied `id`** (base32hex, 5–1024 chars, unique per calendar) → a retry of a succeeded insert returns **409 `duplicate`** rather than creating a second event = the safe-re-run path. *(See Dim 10 for the distributed-race caveat → AF-102.)*
- **Source(s) + date:** all 2026-06-25.

## 5. Webhooks / events / realtime — **VERIFIED — contradicts ADR-007 (→ OD-044)**
- **Gmail push:** `users.watch` registers a **Cloud Pub/Sub topic**; **watch expires — call `watch` at least every 7 days** (Google recommends daily); response carries an `expiration` timestamp. **Notification payload = `historyId` + email address only, NOT message content** → then call `history.list`. IAM: grant **`publish`** to **`gmail-api-push@system.gserviceaccount.com`** on the topic. Delivery: notifications *"might be delayed or dropped"* (Gmail page) over Pub/Sub **at-least-once** → **dedup on `historyId`/Pub/Sub `messageId`** + keep a **poll-based full-sync fallback**; never make push the sole sync path. Src: developers.google.com/workspace/gmail/api/guides/push (2026-06-25).
- **Drive push:** `files.watch`/`changes.watch` → HTTPS callback (`type: web_hook`). **Max TTL: `files` = 86,400 s (1 day), `changes` = 604,800 s (1 week)**; default 3,600 s. **No auto-renew** — replace before expiry. Headers: `X-Goog-Resource-State` ∈ {sync, add, remove, update, trash, untrash, change}, `X-Goog-Channel-ID`, `X-Goog-Channel-Token`, `X-Goog-Resource-ID`. **Requires a valid SSL cert** (self-signed/untrusted/revoked/hostname-mismatch rejected). Src: developers.google.com/workspace/drive/api/guides/push (2026-06-25).
- **Calendar push:** `events.watch` → HTTPS callback; channel has an expiration (min of request + Google's internal limit); **no auto-renew.** Headers: `X-Goog-Channel-ID`, `X-Goog-Message-Number`, `X-Goog-Resource-ID`, `X-Goog-Resource-State` ∈ {sync, exists, not_exists}, `X-Goog-Resource-URI`, optional `X-Goog-Channel-Token`/`X-Goog-Channel-Expiration`. Valid SSL cert required. Src: developers.google.com/workspace/calendar/api/guides/push (2026-06-25).
- **Signature / HMAC auth — load-bearing, contradicts ADR-007:** **There is NO HMAC signature on any Google Workspace push** (independently re-verified):
  - **Gmail** — authenticated via a **Pub/Sub OIDC JWT** (RS256, sent as `Authorization: Bearer <JWT>`); the receiver validates the JWT against Google's public certs and checks the `aud`/`email` claims match the subscription config. **Not HMAC.** Src: developers.google.com/workspace/gmail/api/guides/push; docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions (note: `cloud.google.com/pubsub/...` now 301-redirects to `docs.cloud.google.com/pubsub/...` — cite the new host) (2026-06-25).
  - **Drive & Calendar** — verification is a **client-set static `X-Goog-Channel-Token`** you compare on receipt **+ enforced HTTPS/valid cert + domain ownership.** **No cryptographic signature.** Src: drive/calendar push pages (2026-06-25).
  - **⇒ ADR-007 expects webhook HMAC; Google provides none.** Two verification paths required: (1) Gmail → validate Pub/Sub OIDC JWT; (2) Drive/Calendar → validate channel token + TLS + domain verification. **→ OD-044.** The end-to-end OIDC validation (cert source, `aud`/`email` checks, clock skew) is provable only by standing one up → **AF-109 (SPIKE).**
- **What changed (12–18 mo):** none material to watch expiry, headers, or the no-HMAC posture; only the Pub/Sub docs host moved (301).
- **Source(s) + date:** all 2026-06-25.

## 6. Data, sensitivity & ingestion  *(→ #1 integrity, #2 containment)* — **VERIFIED**
- **What each API returns + sensitivity:** **Gmail** = full message bodies, all headers, attachments, labels, thread structure → **HIGH PII** (personal/financial/health content routine). **Drive** = arbitrary file content + metadata for all files (`drive.readonly`) → **unbounded/undeterminable sensitivity** at ingestion time. **Calendar** = events, attendee emails (PII), free-text descriptions, locations → **moderate PII.** All ingested content is **untrusted by default (ADR-007)** and must carry the external-data boundary tag.
- **Restricted vs sensitive tiers (drives CASA + Limited Use):** Non-sensitive (basic verification, no Limited Use) · **Sensitive** (verification + **Limited Use**, **no CASA**) · **Restricted** (verification + **annual CASA** + **Limited Use**). Gmail read/modify/metadata = **Restricted**; Calendar = **Sensitive**; Drive depends on scope (see Dim 8).
- **Limited Use / User Data Policy — current source of record:** **`developers.google.com/workspace/workspace-api-user-data-developer-policy` (Last updated 2026-04-20).** ⚠️ The legacy `developers.google.com/terms/api-services-user-data-policy` (updated 2024-02-15) is **STALE as the authoritative source** — do not cite it for current AI/ML rules. Limited Use applies to **both Sensitive and Restricted scopes** and to **raw + derived/aggregated** data. Key rules (verbatim/near-verbatim, 2026-04-20):
  - **AI/ML training (load-bearing):** prohibited to use the data to *"create, train, or improve a machine learning or artificial intelligence model **beyond that specific user's personalized model**."* ⇒ Gmail/Drive/Calendar data may **not** feed a generalized/cross-user model; a **per-user personalized memory model is permitted**, pooling into a shared model is **not** (#2). This is a hard constraint on the memory architecture — per-user isolation of learned/derived state is a **policy requirement**, not just a Silo nicety.
  - **Human review:** no casual human reads of ingested content; permitted only with documented per-user consent, or on aggregated+anonymized data for internal ops, or for security/legal. Ops access to raw memory needs consent or anonymization + audit logging.
  - **Transfer / advertising:** transfers restricted to providing the feature (with consent), security, legal, or M&A with prior consent; advertising/retargeting use prohibited.
- **Volume / incremental sync:** initial **full backfill** is the high-volume/high-cost event; steady state is delta sync (Gmail `history.list`, Drive `changes.list`, Calendar `syncToken` — see Dim 4).
- **Source(s) + date:** developers.google.com/workspace/gmail/api/auth/scopes; /identity/protocols/oauth2/scopes; /workspace/drive/api/guides/api-specific-auth; /workspace/workspace-api-user-data-developer-policy (2026-04-20) — accessed 2026-06-25.

## 7. Provisioning & per-client setup  *(ADR-001 §5 / ADR-005 §5)* — **VERIFIED (F4 critical-path holds)**
- **Per-client OAuth app in client's own GCP project:** fully supported and consistent with the client-owns/client-pays model. Google **mandates separate projects per deployment tier** (dev/staging/prod) for production apps — the spec should require a prod project distinct from any dev/test project per client. Redirect URIs configured per client, pointing at that deployment's domain. ("Client owns the project" is our deployment choice that Google supports, not a Google requirement.) Src: developers.google.com/identity/protocols/oauth2 · /web-server (2026-06-25).
- **Restricted-scope (Gmail) verification = onboarding critical path:** restricted-scope apps storing/transmitting Google user data on a third-party server **MUST complete a CASA security assessment** (baseline **Tier 2**; highest-risk apps land at **Tier 3**). **Reverified ≥ every 12 months** from the assessor's Letter of Assessment/Validation date. **Lead times (official):** brand verification **2–3 business days**; sensitive-scope verification **~10 business days**; **restricted-scope verification ~6 weeks** (explicitly *"not guaranteed,"* varies with developer responsiveness). Src: developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification (Last updated 2026-06-09); support.google.com/cloud/answer/13463817; appdefensealliance.dev/casa/tier-2 (2026-06-25).
- **Who pays:** **Google charges the developer $0** for the assessment; the **third-party authorized assessor charges directly** (Tier-2 fees commonly **~$500–$4,500 USD**, app-complexity-dependent), **recurring annually.** The client bears this as opex. Src: support.google.com/cloud/answer/13463817 (CASA FAQ); appdefensealliance.dev/casa/tier-2/tier2-overview (2026-06-25).
- **Brand + app verification artifacts (per client, not one-time):** verify authorized-domain ownership (Search Console) matching redirect URIs; accurate consent screen (name, support email, URIs); unlisted YouTube **demo video**; submit via the Verification Center.
- **What changed (12–18 mo):** **(a)** the console moved to **"Google Auth Platform"** (sections: Branding / Audience / Data Access / Clients), replacing the single "OAuth consent screen" page — old runbook screenshots are stale (exact cutover date UNCERTAIN, non-load-bearing). **(b)** **CASA self-scanning is deprecated** — self-scan now only checks readiness; a **Letter of Validation requires an authorized assessor** (don't spec a pure self-attestation path). Src: support.google.com/cloud/answer/15549049; appdefensealliance.dev/casa/tier-2 (2026-06-25).
- **Source(s) + date:** as above, 2026-06-25. **F4 (CASA = weeks of onboarding lead time + annual recert) re-confirmed current and sharpened with a fee range and the self-scan deprecation.**

## 8. Isolation & security — **VERIFIED**
Least-privilege scope enumeration (exact strings, tiers, grants; all verified against gmail/api/auth/scopes, drive/api/guides/api-specific-auth, identity/protocols/oauth2/scopes — 2026-06-25):

**Gmail (read-mostly ingest + optional send):**
| Scope | Tier | Grants / note |
|---|---|---|
| `…/auth/gmail.readonly` | **RESTRICTED** | Full read (body+headers+attachments). The ingest scope. |
| `…/auth/gmail.metadata` | **RESTRICTED** | Headers+labels, no body — **still restricted (still CASA)**. |
| `…/auth/gmail.modify` | **RESTRICTED** | Read/compose/send, no permanent delete — more than ingest needs. |
| `…/auth/gmail.send` | **SENSITIVE** | Send only, cannot read. **Best least-privilege choice for the send action — avoids CASA.** |

There is **no non-restricted way to read existing Gmail** — any existing-mail ingest is restricted (no `drive.file`-equivalent for Gmail).

**Drive — the design fork (→ OD-045):**
| Scope | Tier | Grants |
|---|---|---|
| `…/auth/drive.readonly` | **RESTRICTED** | View+download **all** files (full existing corpus). |
| `…/auth/drive.metadata.readonly` | **RESTRICTED** | Metadata for all files, no content. |
| `…/auth/drive` | **RESTRICTED** | Full read/write/delete all files. |
| `…/auth/drive.file` | **NON-SENSITIVE** | Only files the **app created** or the user **explicitly opened/shared** via the Google Picker — **no CASA**, but **cannot bulk-ingest a pre-existing Drive.** |

**Calendar (Sensitive — cheapest of the three to ingest, no CASA):**
| Scope | Tier | Grants |
|---|---|---|
| `…/auth/calendar.readonly` | **SENSITIVE** | Read any accessible calendar. Ingest scope. |
| `…/auth/calendar.events` | **SENSITIVE** | Read/write events on all calendars (create action). |
| `…/auth/calendar.events.owned` | **SENSITIVE** | Create/change/delete events only on owned calendars — tighter than `calendar.events`. |

- **Silo / RLS fit (ADR-001/ADR-006):** per-client app in the client's own GCP project + per-user token in the Silo token store fits the isolation model. The **Limited Use per-user-model rule (Dim 6)** reinforces per-client/per-user isolation of any derived state.
- **Incremental authorization (VERIFIED):** request scopes **only when the feature needs them** — request Calendar/Gmail-read at ingest setup; request `gmail.send`/`calendar.events` only when the user enables the optional action, deferring the restricted-tier prompt where possible.
- **What changed (scope policy, 12–18 mo):** Limited Use source-of-record relocated/refreshed (2026-04-20, see Dim 6); **granular OAuth consent now mandatory** (users may grant a *subset* of requested scopes — the connector **must handle partial grants gracefully**, #2/#3); CASA annual cadence reaffirmed. Dated policy additions 2025-10-27 (unused-client deletion) + 2025-12-15 (continuous improvements) — verbatim text not fully fetched → **AF-110 (DOCS)**.
- **Source(s) + date:** as above, 2026-06-25.

## 9. Cost  *(→ ADR-003)* — **VERIFIED, with a dated caveat**
- **Workspace API calls (Gmail/Drive/Calendar):** **free today** — *"All standard use of the Gmail API is available at no additional cost."* **BUT (verbatim):** *"Exceeding the quota request limits is planned to incur charges to your Google Cloud billing account later in 2026… Full billing details will be shared later in 2026 with at least 90 days' notice before any changes take effect."* Free daily threshold = **80,000,000 QU/project/day** (not raisable). **Flips "the APIs are free" → "free-tier, billable-on-overage soon" → AF-103 (DOCS, time-boxed).** Src: developers.google.com/workspace/gmail/api/reference/quota (2026-06-25).
- **Cloud Pub/Sub (required for Gmail push) — billable:** *"the first 10 GiB of throughput… is free… After that, the price is $40 per TiB in all Google Cloud regions"* (per billing account/month). Each client's GCP project incurs this for Gmail push; tiny `historyId` notifications usually stay under 10 GiB/mo (often $0), but it is **free-tier-covered, not free by contract.** **Client pays (matches retainer model).** Src: cloud.google.com/pubsub/pricing (2026-06-25).
- **CASA cost:** Google $0; third-party assessor ~$500–$4,500/yr (Dim 7). Recurring annual opex per app/scope-set.
- **Licensing:** Gmail/Drive/Calendar APIs work against **consumer @gmail.com and Workspace accounts alike; no Workspace license required.** The gate is OAuth restricted-scope verification + CASA, not a per-seat license. Src: developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification (2026-06-25).
- **Source(s) + date:** as above, 2026-06-25.

## 10. Failure modes & limits  *(→ #3, ADR-004, OD-010)* — **VERIFIED**
- **429/403 + 5xx:** quota/rate errors (`rateLimitExceeded`, `userRateLimitExceeded`, `dailyLimitExceeded`) surface as 403 and/or 429; transient 500/502/503/504 → retry. All three APIs recommend **exponential backoff** (`min(((2^n)+random_ms), max_backoff)`). **Jitter is OUR best-practice add — the Workspace error pages say exponential backoff but do NOT mandate jitter** (do not cite Google for "with jitter" on these pages) → **AF-104 (DOCS)** to find a primary cite or own it. **No `Retry-After`** (Dim 3) → client-side backoff only. Src: gmail/drive/calendar handle-errors pages (2026-06-25).
- **Idempotent safe re-run (writes):**
  - **Gmail `messages.send` — NO idempotency/dedup key documented → a retry can double-send.** Gmail send is **NOT safely retryable**; the harness needs its own dedup/sent-ledger before send (compensation exposure → **OD-010**, ties ADR-004). **Load-bearing unsafe-write case.**
  - **Calendar `events.insert` — supply a client `id` → a retry of a succeeded insert returns 409 `duplicate`** (*"The requested identifier already exists"*) instead of duplicating = safe re-run. ⚠️ Caveat (verbatim): *"Due to the globally distributed nature of the system, we cannot guarantee that ID collisions will be detected at event creation time"* → strong but not 100% docs-guaranteed → **AF-102 (EVAL)** before treating as airtight. Src: calendar/api/v3/reference/events/insert; calendar/api/guides/errors (2026-06-25).
- **Partial failures in batch:** each sub-request succeeds/fails independently — inspect each sub-response, not the HTTP envelope; retry only the failed sub-requests. Src: calendar/api/guides/errors (2026-06-25).
- **Pub/Sub redelivery:** **at-least-once** → duplicate Gmail notifications are normal → **dedup on `historyId`** (and/or Pub/Sub `messageId`); treat the watch as a *trigger to call `history.list`*, not as an authoritative payload. Src: cloud.google.com/pubsub (delivery semantics); Gmail push docs (2026-06-25).
- **Source(s) + date:** as above, 2026-06-25.

## 11. Versioning & staleness risk — **VERIFIED**
- **Current versions:** **Gmail API v1, Drive API v3, Calendar API v3** (stable GA; no migration needed at spec time). Src: developers.google.com/workspace/{gmail,drive,calendar} (2026-06-25).
- **Deprecation cadence:** Google states it manages breaking changes *"sparingly… with sufficient notice and support."* **No single explicit "N-month notice" guarantee surfaced on the Workspace pages** → **AF-105 (DOCS)** before citing a notice window in an ADR. Data point: Workspace Events API v1beta was decommissioned 2025-04-30 with a GA v1 successor.
- **Announced / relevant deprecations:** **(a)** Global HTTP batch endpoint already dead (2020) — use per-API batch (Dim 4). **(b) Granular OAuth consent now mandatory** — handle partial-scope grants (Dim 8). **(c)** Gmail/Drive/Calendar **MCP servers** now in developer preview (new agent surface; informational). The Maps `setAuthentication` June-2026 sunset does **not** affect our endpoints.
- **What changed / what's coming:** Gmail **quota model changed (≥2026-05-01 projects)** (Dim 3); **Workspace overage billing planned "later in 2026," ≥90 days' notice** (Dim 9) — money-and-access-sensitive. Src: developers.google.com/workspace/release-notes; gmail/release-notes; cloud.google.com/terms/deprecation (2026-06-25).
- **Re-verify horizon:** header set to **2026-12-25 (+6 mo default)**, **but** given the impending overage-billing go-live, a **hard re-check is required before that go-live date whenever it is announced** (≥90-day window). Pin a watch on the Gmail/Drive/Calendar release-notes + Pub/Sub pricing pages. This dossier **should not be cited as current past the overage-billing announcement.**
- **Source(s) + date:** as above, 2026-06-25.

---

## Outputs filed (Rule 0 — write it down)

> Filed into the registers by the main thread (session 19, 2026-06-25). **Reconciliation complete** —
> the cross-dossier ID collision was resolved on filing via a collision-safe renumber: Google's items
> are **AF-101–110**, **OD-044** (webhook-no-HMAC → ADR-007 reconcile) and **OD-045** (Drive scope), and
> **OOS-026–027**. These are now final and match `feasibility-register.md` (Block N), `open-decisions.md`,
> and `out-of-scope.md`.

- **AF (feasibility) items raised:**
  - **AF-101** — Drive & Calendar **exact** per-minute / per-method quota numbers (model verified; numbers unconfirmed verbatim). Method: **DOCS** (re-read live limits tables; also confirm whether the 2026-05-01 project-age split applies to Drive/Calendar).
  - **AF-102** — Calendar `events.insert` 409-duplicate idempotency guard is *"not guaranteed… at event creation time"* in the distributed system. Method: **EVAL** (rapid-retry test) before treating ADR-004 idempotency as airtight for Calendar.
  - **AF-103** — Workspace API **overage billing** ("later in 2026," ≥90 days' notice; rates/date TBD). "APIs are free" is true-but-expiring. Method: **DOCS** (time-boxed; re-verify before go-live).
  - **AF-104** — "Backoff **with jitter**" is our addition; Workspace error pages don't mandate jitter. Method: **DOCS** (find a primary cite on the linked Cloud APIs backoff page, or own it as a design choice).
  - **AF-105** — No explicit Workspace **deprecation-notice window** found in primary docs. Method: **DOCS** (locate the exact commitment before citing a notice period).
  - **AF-106** — Refresh-token **non-rotation** confirmed only indirectly (via `prompt=consent` language). Method: **SPIKE** (refresh twice; confirm the same refresh token is retained, no new one returned).
  - **AF-107** — **Unused OAuth *client* deletion** after ≥6 mo idle (policy eff. 2025-10-27) — distinct from token inactivity; a long-idle integration can lose the whole client. Method: **DOCS/monitor** (keep clients active; alert on long idle).
  - **AF-108** — Drive `changes` **page-token expiry/error** undocumented (full-resync fallback parity with Gmail 404 / Calendar 410). Method: **DOCS/SPIKE**.
  - **AF-109** — Gmail **Pub/Sub OIDC push-token validation** end-to-end (cert source, `aud`/`email` claim checks, clock skew). Method: **SPIKE** (stand up an authenticated push subscription, validate a real token).
  - **AF-110** — 2025 dated policy changes (2025-10-27 unused-client deletion, 2025-12-15 update) — verbatim text not fully fetched. Method: **DOCS** (quote the changelog).
  - *(Inherited/confirmed-current from AF-003: F1 Gmail quota, F4 Google OAuth — re-verified 2026-06-25, no new AF needed; this dossier supersedes them as the citable source.)*
- **OD (open decisions) raised:**
  - **OD-044** — **Webhook verification model fork (vs ADR-007's HMAC assumption).** Google provides **no HMAC**: Gmail = Pub/Sub OIDC JWT; Drive/Calendar = static `X-Goog-Channel-Token` + TLS + domain verification. *Recommendation:* implement **two verification paths** and **reconcile ADR-007** (the webhook-HMAC control doesn't apply to Google; OIDC-JWT + channel-token + TLS is the Google-native equivalent). Load-bearing for #3/containment.
  - **OD-045** — **Drive scope fork: `drive.readonly` (RESTRICTED, full corpus, annual CASA) vs `drive.file` (non-sensitive, no CASA, only app-touched files).** No free lunch — capability vs compliance cost. *Recommendation:* default to **`drive.file`** where the use case tolerates a Picker-based handoff (avoids CASA); escalate to **`drive.readonly`** only for clients that genuinely require full-corpus ingestion, who then accept the ~6-week verification + annual CASA cost. (Gmail has no such escape hatch — any existing-mail ingest is restricted.)
- **Glossary terms added (candidates):**
  - **CASA (Cloud Application Security Assessment)** — App Defense Alliance security assessment required for restricted-scope OAuth apps; ≥ every 12 months; ~6-week first-pass lead time; assessor-charged.
  - **Restricted scope / Sensitive scope** — Google OAuth tiers; restricted ⇒ CASA + Limited Use; sensitive ⇒ verification + Limited Use, no CASA.
  - **Limited Use (Google API Services User Data Policy)** — bars using Workspace user data to train/improve any model beyond that user's personalized model, and bars casual human reads.
  - **historyId** — Gmail incremental-sync cursor; `history.list` 404 when too old ⇒ full-sync fallback.
  - **Watch channel** — a push subscription (Gmail Pub/Sub / Drive/Calendar webhook) that **expires and must be renewed** (no auto-renew).
- **Out-of-scope logged (candidates):**
  - **OOS-026** — Gmail/Drive **delete/destructive** scopes (`gmail.modify` full, `https://mail.google.com/`, full `drive` write) — not needed for read-mostly ingestion + the two narrow actions; defer to avoid widening the restricted surface.
  - **OOS-027** — Google **MCP servers** (Gmail/Drive/Calendar, developer preview) — not adopted now; revisit when GA.
- **Connector FRs this unblocks (Phase 1):** Gmail/Drive/Calendar ingestion FRs (incremental sync + full-sync fallback), watch-channel renewal FRs, push-verification FRs (OIDC-JWT + channel-token paths), the two write-action FRs (gmail.send dedup; calendar.insert client-id idempotency), per-client provisioning/CASA FRs.
- **Config keys this implies (Phase 2):** per-Silo OAuth client_id/secret + per-user refresh-token store; per-environment Gmail quota profile (project-age-dependent); scope set per client (Drive fork OD-045); watch-renewal interval (Gmail ≤7d / Drive `changes` ≤7d / `files` ≤1d / Calendar bounded); Pub/Sub topic + IAM grant; backoff params (base/max, our jitter); CASA recert calendar reminder.

## Verification-gate result
**PASS.** An independent zero-context subagent (session 19, 2026-06-25) re-verified the three
load-bearing / surprising claims against primary docs: **(1) no-HMAC webhook posture** for all three
APIs (Gmail Pub/Sub OIDC JWT; Drive/Calendar `X-Goog-Channel-Token` + TLS) — **CONFIRMED**;
**(2) Workspace API overage billing "planned… later in 2026"** verbatim on the Gmail quota page —
**CONFIRMED**; **(3) scope tiers** (gmail.readonly/modify/metadata RESTRICTED, **gmail.send SENSITIVE**;
drive.readonly/metadata.readonly RESTRICTED, **drive.file non-sensitive**) — **CONFIRMED**. The
prior AF-003 findings F1 (Gmail quota) and F4 (Google OAuth) were re-confirmed current as of
2026-06-25; **no prior finding was refuted.** Source-citation note recorded: the Pub/Sub
authenticate-push doc now lives at `docs.cloud.google.com/pubsub/...` (301 from `cloud.google.com`).
