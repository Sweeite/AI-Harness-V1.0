---
id: ISSUE-041
title: Slack connector instance — Events API ingest, post-message, xoxb tokens
epic: D — tool layer
status: ready
github: "#41"
---

# ISSUE-041 — Slack connector instance — Events API ingest, post-message, xoxb tokens

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Stand up Slack as a concrete instance of the shared connector runtime — supplying only its parameters (endpoints, Events-API transport + HMAC scheme, `xoxb`/`xoxe` token model, scopes) so it reads channel/thread/DM history for ingestion, posts messages idempotently, verifies inbound events, and reconciles delivery gaps, with **no new safety machinery** written here.

## 2. Scope — in / out
**In:** The Slack *arm* of the four per-connector FRs, wired as data/parameters into the generic runtime (ISSUE-032) and its lifecycle engines (ISSUE-033/034/037):
- **Read:** the Slack observation tool — `conversations.history`/`.replies` incremental `ts`-based sync, `conversations.list` discovery, `users.info` ID resolution; `message_changed`→update and `message_deleted`→tombstone; file fetch; provisioned as an **internal custom app per workspace** (the OD-011 Tier-3 throttle path) (Slack arm of FR-3.OBS.002).
- **Write:** the Slack post tool — `chat.postMessage` routed through the runtime idempotency guard with app-side write-dedup on `ts`/key before retry (Slack arm of FR-3.ACT.004). *(The email half of ACT.004 is Google's, not this issue.)*
- **Token parameters:** `xoxb` non-expiring by default (proactive refresh skipped); revocation via `app_uninstalled`/`tokens_revoked`→Layer-3 re-auth; opt-in (default-off, OD-040) `xoxe` 12h rotation feeding the atomic rotate-persist (FR-3.TOK.009).
- **Trigger:** the Slack arm of the per-connector trigger scheme — Events API, HMAC-SHA256 `X-Slack-Signature` over `v0:{ts}:{raw_body}`, 300s skew reject, 3s 2xx ack, `event_id` dedup; plus the Slack arm of event-gap detection/reconciliation via a `conversations.history` sweep from the persisted per-channel watermark (Slack arms of FR-3.TRIG.004 and FR-3.TRIG.006).
- Rate-limit parameters seeded from the dossier (Slack per-method tiers; honor `Retry-After` exactly) fed into the ISSUE-034 tracker — *parameters only*, not the tiering logic.

**Out:**
- The generic runtime, tool-contract shape, boundary-tag machinery, and `idempotency_ledger` — **ISSUE-032** (CONN/REG). This issue supplies parameters into it.
- The 3-layer token engine + atomic rotate-persist mechanism — **ISSUE-033** (TOK). This issue only supplies FR-3.TOK.009 Slack parameters into it.
- The 80/95/429 rate-limit tiers/backoff logic — **ISSUE-034** (RL). This issue only feeds Slack caps + `Retry-After` handling as parameters.
- The generic trigger infra (handler/parser build-once, watch re-arm, gap-detect *pattern*) — **ISSUE-037** (TRIG). This issue supplies the Slack transport + HMAC + history-sweep parameters.
- Inbound webhook **authentication** (the HMAC verify primitive, raw-body-before-parse, replay cache) — **ISSUE-017** (C0 WHK); this slice consumes the verified event and homes the per-vendor scheme (FR-3.TRIG.004 = the OD-044 reconciliation).
- Disconnection surfacing / auto-resume / health panel / alerts — **ISSUE-038** (DSC); this arm only *sets* `degraded`/emits signals it renders.
- The seven hard limits' enforcement — **ISSUE-035** (ACT) + **ISSUE-055** (C6 HRD); ACT.004's Slack post follows the approval contract but the limit machinery is not built here.
- C2 ingestion (what the boundary-tagged Slack content *becomes*) — **ISSUE-026**.
- The GHL arm (**ISSUE-039**) and the Google/Gmail/Drive/Calendar arms incl. the Gmail half of OBS.002/ACT.004/TRIG.004/TRIG.006 (**ISSUE-040**).

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-3.OBS.002 (Slack arm), FR-3.ACT.004 (Slack post arm), FR-3.TOK.009, FR-3.TRIG.004 (Slack arm), FR-3.TRIG.006 (Slack arm) — all Component 3, Tool Layer.
  *(Roster-label note: the ISSUE-041 backlog row labels this "C3 OBS.003"; OBS.003 is the Google Drive read FR. The Slack read arm is **FR-3.OBS.002** — the coverage ledger's `OBS→039/040/041` split, the harvest inventory, and the spec all home Slack reads at OBS.002. This issue implements the OBS.002 Slack arm; the roster label is a clerical slip, tracked for the Phase-6 gap-sweep.)*
- **NFRs:** NFR-SEC.006 (containment-first injection posture — the boundary-tagged Slack text must not escape RBAC/hard limits), NFR-SEC.007 (external-data boundary tagging on Slack read content). *(NFR-SEC.008 webhook-auth posture is owned by ISSUE-017; this arm instantiates the Slack HMAC scheme that upholds it.)*
- **Rests on:** ADR-001 (physical Silo isolation — the Slack internal custom app + its tokens live in the client's own deployment; per-user Gmail-style isolation analogue for Slack content), ADR-004 (idempotency / safe re-run — the `chat.postMessage` dedup), ADR-006 (agent/tool path = `service_role`, no RLS), ADR-007 (external-data boundary tag on every Slack read; verified authenticated ingress); AF-003 finding F3/F6 + OD-011 (the non-Marketplace history throttle → internal-custom-app resolution), OD-039 (per-workspace default), OD-040 (rotation off by default).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-3.OBS.002.1, AC-3.OBS.002.2 *(Slack arm; AC-3.OBS.002.3 is the Gmail arm — ISSUE-040)*
- AC-3.ACT.004.2 *(Slack post dedup; AC-3.ACT.004.1 is the email-draft arm — ISSUE-040)*
- AC-3.TOK.009.1, AC-3.TOK.009.2
- AC-3.TRIG.004.2 *(Slack HMAC + skew + `event_id` dedup; other AC-3.TRIG.004.* arms belong to GHL/Google)*
- AC-3.TRIG.006.1, AC-3.TRIG.006.2 *(Slack gap detect + reconcile; AC-3.TRIG.006.3 is the Gmail arm — ISSUE-040)*
- **AC → NFR:** AC-NFR-SEC.007.1 (boundary-tagged Slack content), AC-NFR-SEC.006.1 (containment holds against injected Slack text).
- **Gating spikes (build-time, must be GREEN before the Slack ingest arm ships):**
  - **AF-083** (🔴) — the internal-custom-app Tier-3 exemption holds on a live workspace; **viability gate** for the Slack history-ingest arm (FR-3.OBS.002 / FR-3.TOK.009 / FR-3.TRIG.004 Slack arm). Until GREEN, this arm is `Ready`-on-paper only and does not build.
  - **AF-084** (🔴) — Events-API silent-failure surface + gap reconciliation recovers dropped events (gates FR-3.TRIG.006 Slack arm; the #3 no-silent-loss guarantee).
  - **AF-085** (🔴) — `chat.postMessage` app-side write-dedup prevents double-post on retry (gates FR-3.ACT.004 Slack arm).
  - **AF-088** (🔴) — prompt-injection containment for the ingested untrusted Slack text (gates the NFR-SEC.006 claim; the boundary tag is always-on, containment adequacy is the spike).

## 5. Touches (complete blast radius, by ID)
- **DATA:** `connector_credentials` (Slack `xoxb`/`xoxe` row — state, tokens; read/write, DDL owned by ISSUE-032/033); `rate_limit_tracker` (Slack per-method window rows; DDL ISSUE-032, tiers ISSUE-034); `idempotency_ledger` (Slack `chat.postMessage` key; DDL ISSUE-032); per-channel `ts` **watermark** state for incremental sync + gap reconciliation (Slack sync-cursor state — persisted per FR-3.OBS.002/TRIG.006). *(No net-new table; Slack reuses the shared C3 tables.)*
- **PERM:** none new — Slack read/write run on the agent path as `service_role` (ADR-006); re-auth *action* authority (Admin/Super-Admin) is enforced at the DSC surface (ISSUE-038). Registry edits use PERM-tool.manage (homed C1/C6).
- **CFG:** `CFG-slack_token_rotation_enabled` (default false, OD-040), `CFG-event_reconciliation_sweep_minutes` (Slack default). *(Rate-limit caps + `Retry-After` handling are ISSUE-034 config seeded from the dossier.)*
- **UI:** none owned here — Slack connector status renders only as metadata on the health panel / degraded modal (ISSUE-038, FR-3.DSC.005/002). Trigger enable/disable is the generic dashboard config (ISSUE-037, FR-3.TRIG.002/003).
- **Connectors:** **Slack** (comms) — provisioned as a per-workspace internal custom app (OD-011/OD-039).

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/01-requirements/component-03-tool-layer.md` — the Slack-arm FRs + their ACs: FR-3.OBS.002 (§OBS), FR-3.ACT.004 (§ACT per-connector), FR-3.TOK.009 (§TOK per-connector), FR-3.TRIG.004 + FR-3.TRIG.006 (§TRIG per-connector); plus the generic FRs they inherit (CONN.002/003/004, OPT.002, RL.005) named there.
- `spec/04-data-model/schema.md` §4 Tools & Connectors — `connector_credentials`, `rate_limit_tracker`, `idempotency_ledger`, `tools`.
- `spec/05-non-functional/security.md` §NFR-SEC.006 (containment-first injection) + §NFR-SEC.007 (external-data boundary tagging) — the postures the Slack read arm rests on.
- `spec/00-foundations/tool-integrations/slack.md` — the dated dossier; cite it (not the design doc) for ALL Slack vendor facts (§2 tokens/revocation, §3 rate tiers + `Retry-After`, §4 read APIs, §5 Events-API HMAC + gap behaviour, §6 edits/deletes/files, §8 scopes, §10 write-dedup).
- `spec/00-foundations/adr/ADR-007-*.md` — external-data boundary tag; verified authenticated ingress (OD-044 clarification note).
- `spec/00-foundations/adr/ADR-001-isolation-model.md` — physical isolation; the internal custom app + tokens live in the client deployment.
- `spec/00-foundations/feasibility-register.md` §AF-083, §AF-084, §AF-085, §AF-088 — the gating-spike rows this arm builds against.

## 7. Dependencies
- **Blocked-by:** ISSUE-033 (token lifecycle engine — supplies the 3-layer refresh + atomic rotate-persist that FR-3.TOK.009 parameterises), ISSUE-034 (rate-limit tiers — Slack caps + `Retry-After` feed the tracker), ISSUE-037 (trigger infra — the Events-API handler/parser + gap-detect pattern the Slack transport plugs into). *(Transitively: ISSUE-032 runtime + ISSUE-017 webhook-auth boundary, via those three.)*
- **Blocks:** none (leaf).

## 8. Build order within the slice
1. **Provision the Slack app parameters (OD-011/OD-039):** register the connector as a per-workspace **internal custom app** with the minimal scope set — `channels:history`,`channels:read`,`users:read` (+`groups/im/mpim:history` for private/DM), `chat:write` for posting, `users:read.email` only if email resolution is needed (slack.md §8). This is the OD-011 path that makes Tier-3 history affordable — **gated on AF-083 GREEN.**
2. **Token parameters (FR-3.TOK.009):** feed the ISSUE-033 engine the Slack params — `xoxb` non-expiring (proactive refresh skipped), `app_uninstalled`/`tokens_revoked`→Layer-3 re-auth, opt-in `xoxe` 12h rotation (`CFG-slack_token_rotation_enabled=false`) into the atomic rotate-persist. Parameters only — no new refresh code.
3. **Trigger transport + HMAC scheme (FR-3.TRIG.004 Slack arm):** plug the Slack Events-API transport into ISSUE-037's handler; verify HMAC-SHA256 over `v0:{X-Slack-Request-Timestamp}:{raw_body}` (constant-time), reject skew >300s, ack 2xx within 3s, dedup on `event_id` (slack.md §5). Consume the C0-verified event (ISSUE-017); do not rebuild the auth primitive.
4. **Read tool + incremental sync (FR-3.OBS.002 Slack arm):** `conversations.history`/`.replies` from the persisted per-channel `ts` watermark, `conversations.list` discovery, `users.info` resolution; `message_changed`→update / `message_deleted`→tombstone; file fetch (slack.md §4/§6). Every return goes through the runtime boundary-tag (CONN.003, ISSUE-032) before it reaches C2 — **gated on AF-083.**
5. **Gap detection + reconciliation (FR-3.TRIG.006 Slack arm):** monitor own 2xx delivery rate, alarm on `app_rate_limited`, flag approach to the 95%/60min auto-disable threshold as `degraded` (not silent); periodic `conversations.history` sweep from the watermark re-ingests any gap (slack.md §5/§10) — **gated on AF-084.**
6. **Write tool (FR-3.ACT.004 Slack arm):** `chat.postMessage` (channel/text/blocks/thread_ts) routed through the ISSUE-032 idempotency guard with app-side write-dedup on `ts`/key before any retry (slack.md §10); a rate-limited high-risk send halts+escalates via ISSUE-034/C6 — **gated on AF-085.**
7. **Rate params (RL.005):** seed the Slack per-method tiers into the ISSUE-034 tracker and honor `Retry-After` exactly on 429 (slack.md §3). Parameters only.
8. Tests to every AC in §4.

**Integration note (spans the bundled FRs):** this issue proves the FR-3.CONN.002 spine — Slack must land as *parameters plugged into* ISSUE-032/033/034/037, introducing **no** copy of refresh/rate-limit/idempotency/gap-detect logic. The single genuinely Slack-specific mechanism is the `message_changed`/`message_deleted` → update/tombstone path (Slack reads are *not* insert-only — edits/deletes mutate stored memories), and it feeds C2 through the same boundary-tag seam as every other read. Four AFs gate the ingest+post arms; until they are GREEN the FRs are `Ready`-on-paper and this issue does not ship its Slack ingest/post behaviour.

## 9. Verification (how DoD is proven)
- Per `spec/05-non-functional/test-strategy.md`: integration tests for the read/incremental-sync path, the HMAC verify + skew reject + `event_id` dedup, and the `chat.postMessage` dedup-on-retry; a **build-time EVAL** for AF-083 (internal-custom-app Tier-3 exemption on a live workspace) and a **LOAD/EVAL** for AF-084 (Events-API gap reconciliation recovers dropped events) — both must land GREEN before the Slack ingest arm advances from `Ready`-on-paper to build; a **SPIKE** for AF-085 (post dedup) before the post arm ships.
- Containment posture: an injection test asserts a boundary-tagged Slack message carrying an injected instruction leaves the agent's RBAC + hard limits + approval gates intact (AC-NFR-SEC.006.1) and that the content is enclosed in the external-data boundary tags on assembly (AC-NFR-SEC.007.1) — **AF-088** is the adequacy gate. The AC→`Verified` path for the ingest arm closes only when AF-083/084/088 flip 🔴→🟢 in `spec/00-foundations/feasibility-register.md`.
- No-silent-loss (#3): a fault-injection test drops/late-delivers Slack events during an `app_rate_limited`/auto-disable window and asserts the `conversations.history` sweep re-ingests every event since the watermark and flags `degraded` (AC-3.TRIG.006.1/.2) — never a silently empty gap.
