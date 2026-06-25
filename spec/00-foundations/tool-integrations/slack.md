# Tool Integration Dossier — Slack (Web API + Events API)

> Follows `standards/tool-integration-research.md`. Primary vendor sources only (docs.slack.dev,
> api.slack.com, docs.slack.dev/changelog), every fact date-stamped. **No connector FR may cite
> this dossier until it is 🟢; it is currently 🟡 (verified-on-paper, exemption pending live EVAL).**

- **Tool / vendor:** Slack — Web API (`conversations.*`, `chat.postMessage`, `users.info`) + Events API, authenticated by Slack OAuth v2 **bot tokens** (`xoxb`).
- **Status:** 🟡 researching (all 12 dims DOCS-verified; OD-011 exemption needs live EVAL before 🟢)
- **Verified on:** 2026-06-25   ·   **Re-verify by:** 2026-12-25 (+6 months; rate-limit surface is actively churning — re-check sooner if distribution model changes)
- **Researched by / session:** session 19 (fan-out: 4 parallel primary-source subagents + 2 main-thread gap-closing fetches)
- **Applicability — which clients / use cases / entity types / memory slots need this, and why:**
  Slack is the **team-comms ingestion connector**. The harness **INGESTS** channel messages, history,
  and thread replies (`conversations.history` / `conversations.replies`, plus live `message.*` events)
  into the memory system, and may **post** messages / send notifications (`chat.postMessage`, ACTION).
  A **per-client Slack app is installed in the client's OWN workspace** (ADR-001 client-owned account;
  client pays). The 2025 non-Marketplace rate-limit fork (OD-011) governs whether history ingestion is
  viable at all — the load-bearing decision this dossier exists to resolve.
- **Read / write / both:** **Both** (read-dominant: bulk + incremental history ingest; write: notifications/replies).

---

## Verdict summary

**The one finding that most changes the spec:** Slack's 2025-05-29 throttle of `conversations.history`
/ `conversations.replies` to **1 req/min × 15 objects** for non-Marketplace apps **explicitly exempts
internal customer-built apps** (verbatim: *"internal customer-built apps will not notice any changes …
will maintain their existing rate limits"*). A **per-client app created and installed inside the
client's own workspace is an internal customer-built app → exempt → keeps Tier 3 (50+/min, `limit`
default & max 1,000).** This **resolves OD-011 in favour of option (a)** and makes history ingest
viable — but only if the app is *never* packaged as a distributed/unlisted multi-workspace app, which
would collapse throughput ~67×.

| Dimension | Verdict | Headline | Source date |
|---|---|---|---|
| 2 Auth & token lifecycle | VERIFIED (F6 re-confirmed) | `xoxb` non-expiring by default; rotation opt-in+**irreversible** → 12h, prefix `xoxb-`→**`xoxe.xoxb-`** (refresh `xoxe-1-`); `tokens_revoked`/`app_uninstalled` on revoke | 2026-06-25 |
| 3 Rate limits & quotas | VERIFIED (F3 re-confirmed + sharpened) | Tiered T1–T4; **non-Marketplace `conversations.history`/`.replies` = 1/min × 15 since 2025-05-29; internal custom apps EXEMPT (50+/min × 1,000)**; phased-in for old installs 2025-09-02 (now live); 429+`Retry-After` | 2026-06-25 |
| 4 API surface | VERIFIED | Cursor pagination (`response_metadata.next_cursor`); `history` limit 100/999, `replies` 1000/1000, `list` Tier 2; incremental via `oldest` watermark | 2026-06-25 |
| 5 Events / webhooks | VERIFIED | HTTP push + `url_verification` challenge; **HMAC-SHA256 `v0:{ts}:{body}` signing-secret, 300s replay window, constant-time compare**; at-least-once, 3× retry, 3s ack, dedup by `event_id`; auto-disable at 95%-fail/60min; no missed-event replay | 2026-06-25 |
| 6 Data & sensitivity | VERIFIED | Free-text human comms = **HIGH-PII, external-untrusted** (prompt-injection surface); edits/deletes are memory mutations (`message_changed`/`message_deleted`); files = separate auth'd fetch (`files:read`) | 2026-06-25 |
| 7 Provisioning | VERIFIED | Internal single-workspace app at api.slack.com/apps, **no Slack review / no lead time**; manifest (JSON/YAML)-repeatable per client; client admin is installer/approver (app-approval setting) | 2026-06-25 |
| 8 Isolation & security | VERIFIED | Minimal read+post set = `channels:history`,`channels:read`,`chat:write`,`users:read`; `*:history` are broad; **bot must be invited to each channel (`not_in_channel`)** | 2026-06-25 |
| 9 Cost | VERIFIED (no fee documented) | No per-call API charge documented; paid-plan effect = **history retention** (free tier 90-day cap, `is_limited:true`) → ingestion-completeness caveat | 2026-06-25 |
| 10 Failure modes | VERIFIED | 429+`Retry-After`; events auto-disable on sustained fail + **no missed-event backfill** (reconcile via `conversations.history`); **`chat.postMessage` has NO idempotency key** → duplicate-post risk | 2026-06-25 |
| 11 Versioning / staleness | VERIFIED | Method-level (no global version); changelog is the deprecation feed; load-bearing rate fact already shifted in 2025 → 6-month re-verify | 2026-06-25 |

---

## 1. Identity & applicability
Slack Web API + Events API, accessed by an OAuth v2 **bot token** (`xoxb`) belonging to a **per-client
app installed in the client's own workspace** (ADR-001, ADR-005). Read path: ingest channel messages,
history, and thread replies into the memory system. Write path: post notifications / replies. The data
class is high-PII team conversation (dim 6). Read-and-write, read-dominant.

## 2. Auth & token lifecycle  *(→ non-negotiable #1: never lose access)*
- **OAuth flow:** OAuth 2.0 ("v2"). (1) redirect to `https://slack.com/oauth/v2/authorize?client_id&scope`; (2) receive temporary `code` (valid ~10 min) at the Redirect URL; (3) exchange at `oauth.v2.access` for `"token_type":"bot"`, `"access_token":"xoxb-…"`. For a single-workspace internal app the token can also be obtained via one-click **Install to Workspace** without coding the full redirect flow. **VERIFIED.** Src: docs.slack.dev/authentication/installing-with-oauth (2026-06-25).
- **Access-token lifetime:** `xoxb` bot tokens **do not expire by default** ("OAuth tokens do not expire … they can be revoked"). **VERIFIED — re-confirms prior F6.** Design to the absence of expiry, but store revocably. Src: docs.slack.dev/authentication/tokens/, /installing-with-oauth (2026-06-25).
- **Refresh-token lifetime + rotation:** rotation is **optional, opt-in, and IRREVERSIBLE** ("may not be turned off once it's turned on"). When enabled: access token `expires_in: 43200` (**12h**), **access-token prefix `xoxb-` → `xoxe.xoxb-`**, **refresh-token prefix `xoxe-1-`**; old refresh token is revoked on each rotation (single-use rotating). **⚠️ Correction to the F6 shorthand:** the access prefix is precisely `xoxe.xoxb-`, not a bare `xoxe-`. **VERIFIED.** If rotation is ON, the harness MUST refresh-before-12h and **persist the new refresh token every rotation** (the F5/GHL trap). Src: docs.slack.dev/authentication/using-token-rotation (2026-06-25).
- **Revocation triggers:** full app uninstall by a workspace owner; user removes config; installing user's account deactivated; `auth.revoke` called. Signalled by **`app_uninstalled`** (Events-API-only) and **`tokens_revoked`** (payload carries arrays of *user IDs*, not token strings; ordering vs `app_uninstalled` **not guaranteed**). **VERIFIED.** Subscribe to both; on either, stop using + purge the token (#1/#3). Src: docs.slack.dev/reference/events/tokens_revoked/, api.slack.com/events/app_uninstalled, docs.slack.dev/reference/methods/auth.revoke/ (2026-06-25).
- **Per-account token-count caps:** **UNCERTAIN** — no per-workspace bot-token count cap documented either way. Model as "one `xoxb` per workspace install." → **AF candidate (DOCS could not settle).** Src: docs.slack.dev/authentication/tokens/ (absence) (2026-06-25).
- **Scope verification / security assessment:** an **internal single-workspace app requires NO Slack review** to install (review attaches only to Marketplace listing). The only gate is the client admin's own app-approval policy (dim 7). **VERIFIED — no Slack-side lead time.** Src: docs.slack.dev/app-management/distribution/ (2026-06-25).
- **Token storage (ADR-001):** store the `xoxb` (or, if rotation on, the `xoxe.xoxb-` access + `xoxe-1-` refresh) **encrypted at rest, scoped per-client/per-Silo**; purge on `tokens_revoked`/`app_uninstalled`. The Signing Secret (dim 5) is a separate per-app secret in the same store.
- **Source(s) + date:** as cited above, all accessed **2026-06-25**.

## 3. Rate limits & quotas  *(→ #3: never fail silently)*
- **Tiered model (VERIFIED):** T1 1+/min · T2 20+/min · T3 50+/min · T4 100+/min · Special (varies). Applied **per method, per workspace/team, per app** (token-scoped). Src: docs.slack.dev/apis/web-api/rate-limits/ (2026-06-25).
- **THE LOAD-BEARING FORK (OD-011) — VERIFIED, clarified, NOT superseded:** the **2025-05-29** change "Rate limit changes for non-Marketplace apps" throttles **only `conversations.history` and `conversations.replies`** to **1 request/minute** with the `limit` parameter **default & max both reduced to 15 objects**. Rationale (verbatim): these methods "in the hands of unvetted applications have the potential to exfiltrate large amounts of sensitive conversational data."
  - **Exemption — BOTH classes exempt (verbatim):** *"Marketplace apps will not see a rate limit change, and internal customer-built apps will not notice any changes."* and (2025-06-03 clarification) *"Any internal customer-built apps will maintain their existing rate limits and will not be subject to the new posted limits."* → an **internal customer-built (single-workspace, non-distributed) app keeps Tier 3 (50+/min, `limit` default & max = 1,000).**
  - **Who IS throttled:** commercially-distributed / "unlisted" apps that are **not** Marketplace-approved.
  - **Phased rollout (VERIFIED):** immediate (2025-05-29) for new unlisted apps + new installations of existing unlisted non-Marketplace apps; **2025-09-02** the throttle extended to *existing* installations of non-Marketplace apps. As of 2026-06-25 that phase is **live** (grandfathering lapsed). Internal apps were never in scope.
  - **Supersession check:** the 2025-06-03 entry clarifies/extends, does not reverse; **no entry after June 2025 (through 2026-06) amends or supersedes it.** Current as of 2026-06-25.
  - Src: docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps/, docs.slack.dev/changelog/2025/06/03/rate-limits-clarity/ (2026-06-25).
- **429 / `Retry-After`:** on exceed → `HTTP 429` with **`Retry-After`** header in **seconds** (e.g. `Retry-After: 30`); honor before retry. **VERIFIED.** **UNCERTAIN:** docs mention only `Retry-After` — no evidence of `X-RateLimit-Remaining/-Limit/-Reset` introspection headers on Web API 429s → design backoff off `Retry-After` only (verify by SPIKE if quota introspection is needed). Src: docs.slack.dev/apis/web-api/rate-limits/ (2026-06-25).
- **What changed in the last 12–18 months:** *this fork is the change* — the 2025-05-29 / 09-02 non-Marketplace throttle. It is the single most spec-changing fact in the dossier.
- **Source(s) + date:** as cited, **2026-06-25**.

## 4. API surface & capabilities
All accessed **2026-06-25**.
- **`conversations.history`** (VERIFIED) — params `channel` (req), `limit`, `cursor`, `oldest`, `latest`, `inclusive`, `include_all_metadata`. **`limit` default 100, max 999** (throttled apps: 15). Tier 3 (throttled apps 1/min). Cursor pagination via `response_metadata.next_cursor` + `has_more`. Scope: one of `channels|groups|im|mpim:history`. Src: docs.slack.dev/reference/methods/conversations.history/.
- **`conversations.replies`** (VERIFIED) — params `channel`+`ts` (req), `cursor`, `limit`, `oldest`, `latest`, `inclusive`. **`limit` default 1000, max 1000** (note the asymmetry vs `history`; throttled apps 15). Tier 3. Cursor pagination. To read a full thread, page by the parent `ts`. Src: docs.slack.dev/reference/methods/conversations.replies/.
- **`conversations.list`** (VERIFIED) — params `types` (CSV `public_channel,private_channel,mpim,im`), `exclude_archived`, `limit`, `cursor`. `limit` default 100, max <1000. **Tier 2 (20+/min)** — tighter than history/replies, so channel discovery is the throttle bottleneck. Scope: `channels|groups|im|mpim:read`. Src: docs.slack.dev/reference/methods/conversations.list/.
- **`users.info`** (VERIFIED) — resolves `user` ID → `real_name`, `tz`, `profile.*`. **Tier 4 (100+/min).** Scope `users:read`; **`email` field requires `users:read.email` requested *alongside* `users:read`** (apps created after 2017-01-04). Src: docs.slack.dev/reference/methods/users.info/.
- **`chat.postMessage`** (VERIFIED) — params `channel` (req), `text`, `blocks` (URL-encoded JSON), `thread_ts`. **Special limit: ~1 message/sec/channel + a workspace ceiling of several hundred/min.** Scope `chat:write`. **No idempotency key** (see dim 10). Src: docs.slack.dev/reference/methods/chat.postMessage/.
- **Pagination & sync (VERIFIED):** uniform cursor model (`next_cursor` → `cursor` until empty). **Bulk backfill:** page history (newest→oldest, or window with `oldest`/`latest`); for each message where `thread_ts == ts`, page `conversations.replies`. **Incremental sync:** persist the latest ingested `ts` per channel; next run pass it as `oldest` (`inclusive=false`). The incremental-watermark path is throughput-friendly and the recommended steady-state mode.

## 5. Webhooks / events / realtime
All accessed **2026-06-25**. Src: docs.slack.dev/apis/events-api/ unless noted.
- **Delivery model:** HTTP event subscriptions to a public Request URL **or** Socket Mode (WebSocket). **Use HTTP push** for the hosted connector (one HTTPS Request URL, keyed by `team_id`/`api_app_id` in the envelope). **VERIFIED.**
- **URL verification handshake:** on registration Slack POSTs `{"type":"url_verification","challenge":"<random>", …}`; app echoes the `challenge` in a 200 body (plain text, form-encoded, or JSON). Verify the signature *before* responding. **VERIFIED.** Src: docs.slack.dev/reference/events/url_verification/.
- **Request signing / HMAC (ADR-007 hard control — VERIFIED, exact recipe):** headers `X-Slack-Signature` + `X-Slack-Request-Timestamp`. Base string = **`v0:{X-Slack-Request-Timestamp}:{raw_body}`**; HMAC-**SHA256** keyed with the app's **Signing Secret**, hex digest; compare against `X-Slack-Signature` of form **`v0=<hex>`** using a **constant-time** compare. **Replay protection: reject if `|now − timestamp| > 300s`.** Must HMAC the **raw unparsed body** (re-serialising breaks it). Per-app Signing Secret → Silo secret store. Src: docs.slack.dev/authentication/verifying-requests-from-slack/.
- **Delivery guarantees / retry / dedup (VERIFIED):** **at-least-once**; app must return **2xx within 3 seconds** or the attempt fails. Retries **up to 3×** (≈immediate, ≈1 min, ≈5 min). Headers `X-Slack-Retry-Num` (1–3) + `X-Slack-Retry-Reason` (`http_timeout`,`too_many_redirects`,`connection_failed`,`ssl_error`,`http_error`,`unknown_error`). **Dedup by `event_id`** (globally unique). → **Ack fast, process async; never write to memory inline.** Dedup by `event_id` before commit (#1). Idempotency design is *our inference* — Slack documents the retry mechanics, not an idempotency prescription.
- **Volume / auto-disable (VERIFIED — silent-failure threat, #3):** event delivery caps at **30,000 events / workspace / app / 60 min**; over that Slack sends an **`app_rate_limited`** event (with `minute_rate_limited`, `team_id`) instead of the dropped events. Subscriptions are **temporarily disabled** if failures exceed **95% of attempts in 60 min** (apps under 1,000 events/hr exempt); Slack will not deliver an event **more than 2 hours late** by default. **There is NO replay/backfill of missed events** (the 2026-02-05 "Delayed Events" feature extends retries to hourly-for-24h but is still not a backfill). → must alarm on `app_rate_limited`, monitor own 2xx rate, and **reconcile gaps via `conversations.history`.** → **AF (LOAD/EVAL).**

## 6. Data, sensitivity & ingestion  *(→ #1 integrity, #2 containment)*
All accessed **2026-06-25**.
- **What data:** message `text`/`blocks`, sender `user`, `ts`, `thread_ts`, `channel`/`channel_type`, `attachments`, `reactions`, `edited`, `files`; resolvable `real_name`/`email`/`tz` via `users.info`. `conversations.history` returns the `messages` array with cursor pagination. Src: docs.slack.dev/reference/events/message/, /reference/methods/conversations.history/.
- **`message` event variants ↔ scopes (VERIFIED):** `message.channels`→`channels:history`, `message.groups`→`groups:history`, `message.im`→`im:history`, `message.mpim`→`mpim:history` (`message.channels` + `message.groups` scope reqs fetched directly; `im`/`mpim` follow the documented one-to-one pattern). Src: docs.slack.dev/reference/events/message.channels, /message.groups.
- **Edits & deletes are first-class memory mutations (VERIFIED):** `message_changed` (`hidden:true`, nested new `message`, `edited:{user,ts}`) → update the stored message keyed by `channel`+`ts`. `message_deleted` (`deleted_ts`, `hidden:true`) → tombstone/redact keyed by `channel`+`deleted_ts`. To uphold #1, the memory model must mutate on these, not only insert. **UNCERTAIN:** `previous_message` presence in `message_changed` differs between legacy and current pages — do not depend on it. Src: docs.slack.dev/reference/events/message/message_changed/, /message_deleted/.
- **Files:** message file attachments expose `url_private` / `url_private_download`, which **require `Authorization: Bearer <token>` + `files:read`** — a **separate authenticated fetch**, not inline. Treat fetched bytes as the same high-PII/untrusted class. Src: docs.slack.dev/reference/objects/file-object/.
- **PII / sensitivity (VERIFIED by data nature):** free-text human team comms = **HIGH-PII / high-sensitivity** (names, emails, confidential business info, accidentally-pasted secrets). Classify the entire Slack ingest stream as **high-PII, external-untrusted** under ADR-006; store inside the per-client Silo only.
- **External-data boundary / injection (ADR-007 — VERIFIED concern):** channel text is attacker-influenceable (anyone in a channel can type adversarial instructions). When it flows into a memory/LLM system it is an **untrusted-input → prompt-injection vector**; ingested Slack text must be treated as **data, never instructions** (#2). → **AF/OD candidate (injection-mitigation control).**

## 7. Provisioning & per-client setup  *(ADR-001 §5 / ADR-005 §5)*
All accessed **2026-06-25**. Src: docs.slack.dev/app-management/distribution/, /app-manifests/, /admins/managing-app-approvals/, /enterprise/organization-ready-apps/.
- **Internal custom app creation (VERIFIED):** at api.slack.com/apps → **Create New App** (from scratch or from a manifest); the app "resides in one workspace." Per-client provisioning = one app created in *that client's* workspace.
- **Manifest support (VERIFIED):** every app has a JSON/YAML **manifest** (scopes, event subscriptions, redirect URLs), authorable in-console or via the **App Manifest API** → maintain one canonical manifest and instantiate per client. Strong fit for repeatable per-client provisioning.
- **Distribution states (VERIFIED — exact, load-bearing for OD-011):** (1) **single-workspace / undistributed (internal)** — full capabilities, cannot install elsewhere, **no Slack review**, install via "Install App to Workspace"; (2) **publicly distributed (unlisted)** — OAuth flow + "Activate Public Distribution," **no formal review** but each install hits admin approval; (3) **Marketplace-listed** — **reviewed** by Slack. **Our connector = state (1).** Do NOT activate public distribution.
- **Review / lead time (VERIFIED):** internal single-workspace app = **no Slack review, no Slack-side lead time.** Latency is bounded only by the client admin's own approval process.
- **Redirect URI (VERIFIED):** configure HTTPS Redirect URL(s) under App Management; `redirect_uri` must match or be a subdirectory; → that deployment's domain (ADR-005).
- **Who installs / app-approval (VERIFIED):** a member triggers install, but with **Require App Approval** enabled the **client admin must approve** (controls allowed scopes; `admin.apps.approve`/`.restrict`, `app_requested` event). The **client admin is the effective installer/approver and bears the account cost** (client-owned, ADR-001). The onboarding runbook must treat this as a setup prerequisite.
- **Enterprise Grid (VERIFIED):** an **organization-ready / org-wide** app installs once at org level → a single org-level token spanning granted workspaces. If a client is on Grid and wants multi-workspace ingest, that is a **different provisioning path** (single org token vs per-workspace tokens). → **OD candidate (per-client branch).**

## 8. Isolation & security
All accessed **2026-06-25**. Src: docs.slack.dev/reference/scopes/ + the per-method pages above.
- **Least-privilege scope set (VERIFIED).** Minimal set for **public-channel read + post**:
  - `channels:history` — read public-channel history + `message.channels` events
  - `channels:read` — `conversations.list` channel discovery
  - `chat:write` — `chat.postMessage`
  - `users:read` — resolve author IDs → names
  - Add only per surface in scope: `groups:history`+`groups:read` (private), `im:history` (DMs), `mpim:history` (group DMs); **`users:read.email` only if email is actually needed** (high-PII; Slack has historically tightened it).
- **Scope breadth:** no `*:history` scope is flagged "sensitive" in the reference, but they are **broad** — they expose full message content of every conversation the bot is in. Highest-sensitivity grant in the set (#1/#2).
- **Channel-membership requirement (VERIFIED, load-bearing):** `conversations.history` works only for conversations the bot is **a member of**; reading a channel the bot isn't in returns **`not_in_channel`**. **Scope is necessary but not sufficient — the bot must be invited to each channel.** Provisioning/onboarding needs an explicit invite step + per-channel reconciliation when the bot is removed.
- **Silo fit (ADR-001) / RLS (ADR-006):** Slack token + Signing Secret live per-Silo; ingested content lands in the client's own DB. Ingest writes go through the Memory Agent as the sole writer (ADR-004), off the RLS path; the high-PII class drives ADR-006 clearances.

## 9. Cost  *(→ ADR-003)*
- **No per-call API charge is documented** anywhere in the developer docs. **UNCERTAIN by the primary-source standard** (absence of a fee statement, not a positive "free") → treat "API calls are free" as the working assumption and **flag as an AF** rather than a VERIFIED fact. Src: docs.slack.dev (absence) (2026-06-25).
- **Paid-plan implication = retention, not API cost (VERIFIED):** free-tier workspaces cap accessible message/file history at **90 days**; the API signals truncation via **`is_limited: true`** on `conversations.history`. → **ingestion-completeness caveat:** on a free workspace, history older than 90 days is unreachable — record `is_limited:true` as a known coverage gap, not a failure (#3: surface truncation, don't fail silently). Marketplace guidelines also bar retaining/exposing data **beyond** the workspace's own retention — a constraint on how long ingested history may be cached. Src: docs.slack.dev/reference/methods/conversations.history/, /slack-marketplace/slack-marketplace-app-guidelines-and-requirements/ (2026-06-25).

## 10. Failure modes & limits  *(→ #3, ADR-004, OD-010)*
All accessed **2026-06-25**.
- **Rate-limit (VERIFIED):** 429 + `Retry-After` (seconds); honor, back off, retry the same call. Per-method, per-workspace.
- **Events auto-disable + no replay (VERIFIED):** subscription temporarily disabled if failures exceed 95%/60min; events >2h late are dropped; **no historical replay of missed events** → reconcile via `conversations.history` polling; the harness cannot trust the event stream as complete (#3). Optional Delayed Events (2026-02-05) = hourly retries for 24h, still not a backfill.
- **Events retry / dedup (VERIFIED):** 3× retry with `X-Slack-Retry-Num`/`-Reason`; respond 2xx <3s; **handlers must be idempotent — dedup by `event_id` / message `ts`** (idempotency *guidance* is our inference, not a Slack prescription).
- **History-ingest idempotency (UNCERTAIN):** docs don't explicitly guarantee identical results for a repeated `oldest`/`latest` range; safe design = **dedup ingested rows by `channel`+`ts`** (the stable per-message key).
- **`chat.postMessage` duplicate-post risk (VERIFIED — no mechanism):** **no documented idempotency key** for normal posts (`client_msg_id` is server-assigned/informational). A retried post after an ambiguous timeout **can double-post** → the harness must implement **app-side write dedup** (track an app-side key / the returned `ts` before retrying). Compensation exposure for the external write ties to OD-010. → **AF.**
- **Error envelope (VERIFIED):** every response carries `ok`; on failure `error` (machine code, e.g. `not_in_channel`, `missing_scope`, `ratelimited`, `channel_not_found`, `access_denied`); partial success → `ok:true` + `warning`. Src: docs.slack.dev/apis/web-api/.

## 11. Versioning & staleness risk
All accessed **2026-06-25**. Src: docs.slack.dev/changelog/ + per-method pages.
- **Versioning model (VERIFIED by pattern + absence):** Slack Web API is **method-level — no global version number**; methods evolve and are deprecated individually.
- **Announcement channel:** the **Changelog** is the canonical deprecation feed.
- **RTM:** no 2025–2026 deprecation; irrelevant anyway — use **Events API over HTTP**, not RTM.
- **Recent changes (2025–2026, VERIFIED):** 2025-05-29 / 06-03 the load-bearing rate-limit fork; 2025-08-26 `team.preferences.list` dropped `allow_message_deletion`; 2025-11-12 `files.upload` retired (sequenced upload methods); 2026-02-05 Delayed Events; 2026-02-17 search-scope split; 2026-03-05 `assistant.threads.setStatus` accepts `chat:write`; 2026-03-16 optional scopes; 2026-03-30 PKCE GA (desktop/localhost PKCE can't request bot scopes → use server-side web flow); 2026-06-17 system notifications move Slackbot→`USLACK`.
- **Staleness horizon:** Slack ships breaking method/scope/rate changes several times a year, and the most load-bearing fact (rate limits) already shifted in 2025. **`Re-verify by: 2026-12-25` (6 months)**, with a hard re-check trigger if the per-client app's distribution model ever changes (internal ↔ distributed) — that flips the rate-limit tier.

---

## Outputs filed (Rule 0 — write it down)

> Per the task contract, the main thread files these into feasibility-register.md / open-decisions.md /
> glossary.md / out-of-scope.md. This section is the **evidence-backed proposal**; IDs use the next
> free numbers (AF-083+, OOS-018+, OD-039+; OD-011 already exists).

### OD-011 resolution — RECOMMENDED: option (a), internal custom app per client workspace
**Firm recommendation: RESOLVE OD-011 → (a) internal customer-built app, one per client workspace.**
Primary-source basis (verbatim, 2026-06-25): the 2025-05-29 changelog (clarified 2025-06-03) states
*"Marketplace apps will not see a rate limit change, and internal customer-built apps will not notice
any changes"* and *"Any internal customer-built apps will maintain their existing rate limits and will
not be subject to the new posted limits."* A per-client app **created and installed inside the client's
own workspace** is a single-workspace, **non-distributed internal customer-built app** (dim 7,
distribution state 1) → **exempt → retains Tier 3 (50+/min, `limit` default & max 1,000)** on
`conversations.history`/`.replies`. This:
- makes history ingest **viable** (the throttled path = 1/min × 15 = ~900 msgs/hr/channel worst case is
  avoided);
- aligns with **ADR-001** (client owns the connector account) and **ADR-005** (per-client OAuth apps in
  the client's accounts) — no architectural friction, unlike option (b) Marketplace (review lead time +
  ongoing compliance + conflicts with per-client ownership);
- needs **no Slack review and no lead time** (dim 7).
**Guardrails to record with the resolution:** (i) the app must **never** be packaged as a
distributed/unlisted multi-workspace app — that would collapse ingest ~67×; (ii) **Enterprise-Grid
clients are a branch** (org-ready app / single org token) — flag as a new OD; (iii) the exemption is
DOCS-verified but **not yet proven on a live workspace** → gate the resolution behind the AF-012
follow-up **EVAL** (run `conversations.history` against a live internal app and confirm 50+/min ×
1,000) before marking the connector FRs `Ready`.

### AF (feasibility) items raised — proposed AF-083+
- **AF-083 — EVAL** — Confirm on a **live test workspace** that a per-client *internal customer-built* app actually receives Tier 3 (50+/min, `limit`=1,000) on `conversations.history`/`.replies` — the OD-011 exemption is DOCS-verified but unproven for our exact setup. (This is the named AF-012 follow-up; gates OD-011 lock.)
- **AF-084 — LOAD/EVAL** — Events API silent-failure surface: prove the connector stays under the 95%-fail/60min auto-disable threshold and that gap-reconciliation via `conversations.history` recovers events dropped during `app_rate_limited` / disable windows.
- **AF-085 — SPIKE** — `chat.postMessage` has **no idempotency key**; verify the app-side write-dedup design prevents double-posting on retry-after-timeout (OD-010 compensation exposure).
- **AF-086 — SPIKE** — Whether any Web-API rate-limit **introspection headers** beyond `Retry-After` exist (quota-remaining); if not, backoff must rely on `Retry-After` only.
- **AF-087 — DOCS/vendor** — Confirm Slack Web/Events API has **no per-call charge** (docs state no fee, but never positively "free") — settle via Terms/pricing or vendor confirmation before the ADR-003 cost model treats Slack as $0.
- **AF-088 — SECURITY/SPIKE** — Prompt-injection mitigation for ingested untrusted Slack text flowing into the memory/LLM system (ADR-007 containment; #2).
- **(carry-over) AF-015 / F6** — re-confirmed: `xoxb` non-expiring; rotation opt-in→12h/`xoxe.xoxb-`. No new AF, but note the **prefix correction** (`xoxe.xoxb-`, not bare `xoxe-`).

### OD (open decisions) raised — proposed OD-039+
- **OD-039 — Enterprise-Grid provisioning branch:** for Grid clients wanting multi-workspace ingest, use an **organization-ready app (single org-level token)** vs per-workspace internal apps. Recommendation: default per-workspace internal app; org-ready only when a Grid client requires multi-workspace coverage.
- **OD-040 — Token rotation ON vs OFF:** rotation is **irreversible**; OFF (non-expiring `xoxb`) is the lower-complexity default for an internal ingest bot. Recommendation: **OFF** unless a client security policy mandates short-lived tokens — then accept the 12h-refresh + persist-rotating-refresh-token obligation.

### Glossary terms surfaced (proposed)
- **Internal customer-built app** — a single-workspace, non-distributed Slack app; the OD-011 rate-limit-exempt class.
- **Distributed / unlisted app** — public-distribution-activated, non-Marketplace; the **throttled** class.
- **Marketplace-listed app** — Slack-reviewed distributed app (also exempt).
- **Signing Secret** — per-app secret keying the `X-Slack-Signature` HMAC-SHA256.
- **`tokens_revoked` / `app_uninstalled`** — revocation events.
- Token prefixes: `xoxb-` (bot, non-rotating), `xoxe.xoxb-` (rotating bot access), `xoxe-1-` (rotating refresh).
- `thread_ts`, `event_id`, **Request URL**, **Socket Mode**, `is_limited`, `not_in_channel`.

### Out-of-scope logged (proposed OOS-018+)
- **OOS-018 — Socket Mode** (use HTTP push; Socket Mode deferred unless a client can't expose a public endpoint).
- **OOS-019 — Slack Marketplace listing** (per-client internal apps make Marketplace review unnecessary; defer unless a single distributed app is ever needed).
- **OOS-020 — File-content ingestion** (`files:read` + authenticated `url_private` fetch) — deferred until a use case needs file bodies; message text/metadata first.
- **OOS-021 — Public distribution** (consciously NOT activated — would void the OD-011 exemption).

### Connector FRs this unblocks (Phase 1)
- FR-Tool.Slack.* : OAuth-v2 bot-token acquisition + storage; `conversations.history`/`.replies` cursor backfill + `oldest`-watermark incremental sync; Events-API HTTP subscription with `url_verification` + HMAC verification + 3s-ack/async + `event_id` dedup; `message_changed`/`message_deleted` memory mutation; `chat.postMessage` with app-side dedup; channel-invite onboarding step; `tokens_revoked`/`app_uninstalled` purge.

### Config keys this implies (Phase 2)
- `slack.app_class` (= internal-custom; enforces OD-011) · `slack.rate_limit.history_tier` (T3 50/min, limit 1000) · `slack.token.rotation_enabled` (default false; OD-040) · `slack.token.access_ttl_s` (43200 if rotation) · `slack.signing_secret` · `slack.events.ack_deadline_ms` (<3000) · `slack.events.dedup_key` (event_id) · `slack.scopes` (least-privilege set) · `slack.retention.is_limited_gap_flag`.

## Verification-gate result
**Independent re-check of stale/refuted/load-bearing claims — PASS (with named EVAL gate).**
The load-bearing OD-011 exemption was verified by **two independent reads**: (1) the Limits-&-API
research agent and (2) the Cost/Failure/Versioning research agent, both independently fetching the
2025-05-29 + 2025-06-03 changelog entries and **independently surfacing the verbatim
"internal customer-built apps … will maintain their existing rate limits" wording** — agreement
across two zero-shared-context reads. F3 (rate-limit fork) and F6 (token lifecycle) re-confirmed
current as of 2026-06-25, with one correction (rotating-access prefix is `xoxe.xoxb-`, not bare
`xoxe-`). The exemption remains **DOCS-proven, not behaviourally proven** → AF-083 EVAL gates marking
the connector FRs `Ready` and locking OD-011. Status stays **🟡** until that EVAL passes; all other
dimensions are DOCS-green.
