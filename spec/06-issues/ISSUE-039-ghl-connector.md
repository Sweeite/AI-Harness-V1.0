---
id: ISSUE-039
title: GHL connector instance — CRM reads/writes, rotating-refresh token, Ed25519 webhook
epic: D — tool layer
status: blocked
github: "#39"
---

# ISSUE-039 — GHL connector instance

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Instantiate GoHighLevel as the first concrete connector — CRM read tools, CRM write (action) tools, its rotating-refresh token parameters, and its Ed25519 webhook-verification arm — by parameterising the already-built shared runtime, with no new safety machinery.

## 2. Scope — in / out
**In:** The GHL *instance* only — the fill-in-the-blanks a connector supplies to the shared runtime (endpoints, field mappings, scope strings, token TTL/rotation params, webhook transport + signature scheme). Concretely: GHL CRM read tools (contacts search/get, tags, notes, opportunities/pipelines, conversations/messages, calendar appointments) via v2/v3 search endpoints, boundary-tagged; GHL CRM write tools (upsert contact, tag, note, move stage, send message) routed through the runtime's idempotency guard and approval contract; GHL token parameters (~24h access, single-use rotating refresh, 1yr-unused death) wired into the runtime's persist-on-refresh path; the GHL webhook arm (native app webhook, `X-GHL-Signature` Ed25519 verify, `deliveryId` dedup, durable-queue → 2xx). This is the coverage-ledger owner of **C3 OBS.001**.

**Out:** The shared runtime itself and all generic machinery — the connector contract/registry (ISSUE-032), the 3-layer token lifecycle + atomic persist-on-refresh mechanism (ISSUE-033, this issue only supplies GHL's params to it), the rate-limit tracker + tiers (ISSUE-034, this issue only pins GHL's real caps 100/10s + 200k/day into it), the write-tool contract + seven hard limits (ISSUE-035), tool optimisation (ISSUE-036), the generic trigger infra + Google/Slack watch re-arm + event-gap reconciliation (ISSUE-037; GHL's app webhook does not expire and uses durable-queue dedup, so FR-3.TRIG.005/006 are NOT in this slice), and disconnection/recovery (ISSUE-038). Inbound webhook *authentication* primitive is C0 (FR-0.WHK.*, ISSUE-017) — this slice consumes the verified event and applies the GHL-specific scheme. Google connector = ISSUE-040; Slack = ISSUE-041. Ingestion of the read output into memory = C2 (ISSUE-026). Approval enforcement of gated writes = C6 (ISSUE-056).

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-3.OBS.001 (C3 tool-layer — GHL CRM reads; the coverage-ledger OBS anchor for this issue), FR-3.ACT.003 (GHL CRM mutations), FR-3.TOK.008 (GHL token parameters — rotating-refresh persist trap), FR-3.TRIG.004 (per-connector trigger transport + signature scheme — **GHL arm only**: native webhook + Ed25519 + `deliveryId` dedup).
- **NFRs:** none named directly (NFR-INF.007 token-lifecycle posture is realised in ISSUE-033; NFR-COST tool-volume in ISSUE-034/074).
- **Rests on:** ADR-001 (per-client GHL OAuth app + credentials in the client's own Supabase; physical isolation), ADR-004 (idempotency / concurrency — the rotating-refresh persist + write dedup), ADR-005 §5 (per-client OAuth app, redirect URIs), ADR-007 (boundary-tag reads; verified authenticated ingress; hard limits), ADR-008 (golden rule — store `source_ref` pointers, not copied CRM records); OD-042 (durable-queue → 2xx, dedup on `deliveryId`), OD-044 (per-vendor signature scheme homed in the connector contract), OD-046 (C0 FR-0.WHK.002 corrected HMAC→Ed25519), OD-041 (5-agency private-app install cap = implicit v1 scaling limit); AF-089, AF-090, AF-093, AF-095, AF-097, AF-098 (see gating spikes below).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-3.OBS.001.1, AC-3.OBS.001.2
- AC-3.ACT.003.1, AC-3.ACT.003.2
- AC-3.TOK.008.1
- AC-3.TRIG.004.1 (GHL arm — the Ed25519 / legacy `X-WH-Signature`-not-used criterion)
- **Gating spikes / feasibility (build-time — must be GREEN before the corresponding arm ships, per feasibility-register.md; all currently 🔴):**
  - **AF-098** (GHL PHI/BAA chain — LEGAL gate) must be GREEN before PHI ingest from any HIPAA-enabled GHL location; strict-block until then (AC-3.OBS.001.2).
  - **AF-090** (GHL Ed25519 exact signing input, confirmed on a live payload) must be GREEN before the webhook arm (FR-3.TRIG.004 GHL arm) ships.
  - **AF-089** (rotating-refresh persist/race under the 30s same-token grace window) gates FR-3.TOK.008 / the FR-3.TOK.005 persist path.
  - **AF-095** (confirm no native `Idempotency-Key` on GHL writes; `/contacts/upsert` + app-side dedup is the substitute) gates FR-3.ACT.003.
  - **AF-093** (outbound-429 shape; backoff must not assume `Retry-After`) and **AF-097** (webhook retry-policy contradiction; durable-queue → 2xx mitigation per OD-042) inform, not block, the read/webhook arms.
  - No launch-gating spike (ISSUE-001–006) is a direct blocked-by; blocked-by ISSUE-033/034/037 are feature issues, not spikes.

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-tools (register the GHL read + write tool rows; `connector='ghl'`), DATA-connector_credentials (GHL row — access/refresh/expires_at/scopes/state), DATA-rate_limit_tracker (GHL `window_label` rows, e.g. `ghl_burst_10s`, `ghl_daily`), DATA-idempotency_ledger (GHL write dedup keys). Read output feeds DATA-memories via C2 ING (ISSUE-026) as `source_ref` pointers — not written here.
- **PERM:** PERM-tool.manage (Admin/Super-Admin to register/version GHL tool rows; homed C1/C6). Tool *execution* runs agent-path `service_role` (no per-tool RBAC gate — ADR-006).
- **CFG:** none net-new to this slice; consumes runtime CFG (CFG-token_refresh_interval_minutes, CFG-token_refresh_lead_minutes, CFG-slack_token_rotation_enabled n/a for GHL) and per-tool `requires_approval` on the write rows. GHL rate caps are pinned as `rate_limit_tracker` rows, not CFG keys.
- **UI:** none owned here (backend instance). Its token-expiry + degraded state surface on the connector health panel owned by ISSUE-038 (FR-3.DSC.005); gated writes surface in the C6 approval queue (ISSUE-056).
- **Connectors:** GHL.

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-03-tool-layer.md — FR-3.OBS.001, FR-3.ACT.003, FR-3.TOK.008, FR-3.TRIG.004 (GHL arm) + their ACs; also the shared-runtime FRs they compose (FR-3.CONN.002/003/004/005, FR-3.TOK.005, FR-3.RL.*, FR-3.ACT.001/002, FR-3.TRIG.001) for the contract they plug into.
- spec/04-data-model/schema.md §4 (Tools & Connectors — `tools`, `connector_credentials`, `rate_limit_tracker`, `idempotency_ledger`).
- spec/00-foundations/tool-integrations/gohighlevel.md — the GHL dossier; cite it (NOT the design doc) for every vendor fact: §2 (token lifecycle L59–63), §3 (rate caps L70), §4 (endpoints L79–83), §5 (webhook Ed25519 L92–105), §8 (scopes L127–135), §10 (idempotency L158–161).
- spec/00-foundations/adr/ADR-007 (containment / boundary tag / hard limits / verified authenticated ingress + OD-044 clarification note), ADR-005 (§5 per-client OAuth app), ADR-008 (golden rule).
- spec/00-foundations/feasibility-register.md — AF-089, AF-090, AF-093, AF-095, AF-097, AF-098 (the GHL gate states).

## 7. Dependencies
- **Blocked-by:** ISSUE-033 (OAuth token lifecycle + atomic persist-on-refresh — GHL's rotating refresh plugs into it), ISSUE-034 (rate limiting + tiers — GHL caps pinned into the tracker), ISSUE-037 (trigger infra + liveness — GHL webhook arm plugs into it). None is a spike.
- **Blocks:** none (leaf).

## 8. Build order within the slice
1. **Register the GHL tool rows** in `tools` (schema §4): read tools (`category=read`, scopes from dossier §8 `contacts.readonly`/`opportunities.readonly`/`conversations.readonly`/`conversations/message.readonly`/`calendars.readonly`/`calendars/events.readonly`) and write tools (`category=write`, `requires_approval` per risk, scopes `contacts.write`/`opportunities.write`/`conversations/message.write`) — every row carries `connector='ghl'` and a non-empty `change_reason` (FR-3.REG.001/003, owned by ISSUE-032).
2. **Wire GHL token parameters (FR-3.TOK.008)** into the runtime token lifecycle (ISSUE-033): ~24h access (`expires_in: 86399`), single-use rotating refresh → the runtime's atomic persist-on-refresh path (FR-3.TOK.005) must persist the new refresh token *before* any call uses the new access token; honour the 30s same-token grace window under concurrency (dossier §2 L60). Gate on AF-089.
3. **Pin GHL rate caps** into `rate_limit_tracker` window rows (100 req/10s burst + 200k/day, dossier §3 L70) so ISSUE-034's tiers (80/95/429) run against GHL's real caps; backoff must not assume `Retry-After` on outbound 429s (AF-093).
4. **Implement GHL read tools (FR-3.OBS.001):** `POST /contacts/search` (NOT deprecated `GET /contacts/`), `GET /contacts/{id}`, tags/notes, `GET /opportunities/pipelines` + search + `GET /opportunities/{id}`, conversations search + messages-by-conversation, appointment list/get; every result boundary-tagged by the runtime (FR-3.CONN.003) and handed to C2 as `source_ref` pointers (golden rule, ADR-008). Block PHI ingest from HIPAA-enabled locations until AF-098 GREEN (AC-3.OBS.001.2).
5. **Implement GHL write tools (FR-3.ACT.003):** `POST /contacts/upsert` (create-or-update, idempotent), `POST /contacts/{id}/tags`, `POST /contacts/{contactId}/notes`, `PUT /opportunities/{id}/status`, `POST /conversations/messages`; each routed through the runtime idempotency guard (FR-3.CONN.004) with a durable pre-call intent record; message send is irreversible + billed on attempt, so the send-once guard must fire *before* the call, and a rate-limited high-risk send halts+escalates (FR-3.RL.006), never auto-retries. Confirm no native `Idempotency-Key` (AF-095).
6. **Implement the GHL webhook arm (FR-3.TRIG.004 GHL arm):** consume the C0-verified inbound event (FR-0.WHK.*, ISSUE-017), verify `X-GHL-Signature` Ed25519 against GHL's published public key (NOT legacy `X-WH-Signature` RSA, deprecated 2026-07-01), dedup on `deliveryId`, durable-queue → 2xx on receipt (OD-042). Gate the arm on AF-090 (exact signing bytes); AF-097 informs the retry/queue design.
7. **Test to the ACs** (see Verification).

## 9. Verification (how DoD is proven)
- Per spec/05-non-functional/test-strategy.md: integration tests against a GHL sandbox/live-payload for the read (search-endpoint + boundary-tag), write (upsert idempotency + send-once no-double-bill), token (rotated-refresh atomically persisted before use), and webhook (Ed25519 verify + `deliveryId` dedup) arms — each mapping to its AC in §4.
- The GHL arms remain paper-`Ready` until their build-time AFs flip GREEN: AF-090 → webhook arm, AF-089 → token persist, AF-095 → write idempotency, AF-098 → PHI-location read scope. The AC→`Verified` path for this slice is: AC passes in the integration layer **and** the gating AF for that arm is GREEN in feasibility-register.md; a red AF holds the arm out of build even with ACs drafted.
- Confirms the three non-negotiables at the GHL grain: #1 (persist rotated refresh — AF-089), #2 (minimal GHL scopes + Ed25519 verify + boundary tag + PHI block), #3 (no silent drop — durable-queue webhook, boundary-tag fail-closed, halt-escalate on high-risk send).
