---
id: ISSUE-040
title: Google connector instance (Gmail / Drive / Calendar)
epic: D — tool layer
status: ready
github: "#40"
---

# ISSUE-040 — Google connector instance (Gmail / Drive / Calendar)

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Wire Google (Gmail / Drive / Calendar) into the shared connector runtime as a parameter-only instance — its read tools, its draft-to-approval write tools, its Pub/Sub + channel-token trigger transport with watch re-arm and gap reconciliation — so the harness reads and (on approval) writes Google data safely, inheriting all generic safety machinery unchanged.

## 2. Scope — in / out
**In:** The **Google arms** of the per-connector instance FRs, filled in as *parameters* over ISSUE-032's runtime and ISSUE-033/034/037's generic machinery — no new safety code:
- **Reads:** the Gmail arm of comms reads (`messages.list`/`get`, incremental `history.list` from `startHistoryId` with 404 full-sync fallback) — FR-3.OBS.002 (Gmail arm only; the Slack arm is ISSUE-041); Google Drive reads (`files.list`/`get`, `changes` incremental, `drive.file` default / `drive.readonly` + CASA escalation per OD-045) — FR-3.OBS.003; Google Calendar reads (`events.list` with `syncToken`, 410 full re-sync) — FR-3.OBS.004. All boundary-tagged (FR-3.CONN.003) and stored as `source_ref` pointers (golden rule).
- **Writes (all draft-to-approval / idempotent):** the Gmail arm of comms writes — outbound email is a **draft routed to the approval queue, never sent autonomously** (hard limit #1), `gmail.send` scope only if/when sending is enabled — FR-3.ACT.004 (email arm only; the Slack `chat.postMessage` arm is ISSUE-041); Drive create/append with idempotency guard, no autonomous delete — FR-3.ACT.005; Calendar invite drafted to approval, `events.insert` with client-supplied `id` for 409-dedup — FR-3.ACT.006.
- **Token parameters:** wire the Google token parameter set (FR-3.TOK.007) into the generic TOK engine (~1h access; refresh does **not** rotate; 100-token-per-account-per-client cap surfacing; 6-mo-unused / password-change / unused-client death → Layer-3 re-auth).
- **Trigger transport + verification:** the Google arm of FR-3.TRIG.004 — Gmail push via Cloud Pub/Sub with OIDC-JWT validation, Drive/Calendar via HTTPS callback with static `X-Goog-Channel-Token` compare + TLS; the whole watch/subscription re-arm lifecycle (FR-3.TRIG.005 — Gmail ~7d, Drive `files` 1d/`changes` 7d, Calendar-bounded, no auto-renew → fail-loud on lapse); the Gmail/Drive/Calendar full-sync arm of gap reconciliation (FR-3.TRIG.006 — `history.list` 404 / `changes` token-expiry / `events.list` 410 → full-sync from last good watermark).

**Out:**
- The connector contract, shared runtime, tool registry, `tools`/`connector_credentials`/`rate_limit_tracker`/`idempotency_ledger` DDL, boundary-tag + idempotency machinery — **ISSUE-032** (CONN/REG). This instance conforms to it; it does not build it.
- The generic 3-layer token refresh + atomic rotate-persist engine — **ISSUE-033** (TOK generic). This slice only supplies the Google *parameters* (FR-3.TOK.007) that engine consumes.
- Rate-limit tiers/backoff — **ISSUE-034** (RL). Google's real per-method quota numbers (AF-101) feed those trackers; this slice does not re-implement tiering.
- Generic trigger infra (webhook handler/parser scaffold, dashboard trigger config, generic liveness) — **ISSUE-037** (TRIG.001/003 + the generic side of 005/006). This slice supplies Google's transport + verification scheme + watch parameters.
- Write-tool hard-limit **code enforcement** and the approval-queue mechanism the email/calendar drafts route into — **ISSUE-055** (HRD, FR-3.ACT.002 enforcement) and **ISSUE-056** (APR). This slice *routes to* approval and *observes* the limits; it does not enforce them.
- Degraded-state surfacing (modal/banner), auto-resume, escalation clock, connector health panel — **ISSUE-038** (DSC). This slice *sets* `degraded` / emits the pause + re-arm-failure signals those surfaces render.
- The GHL instance — **ISSUE-039**; the Slack instance (Slack arms of OBS.002 / ACT.004 / TRIG.004 / TRIG.006, plus TOK.009) — **ISSUE-041**.
- C2 ingestion pipelines / Filter 2 that consume the boundary-tagged reads — **ISSUE-026** (C2 ING).

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-3.OBS.002 *(Gmail arm)*, FR-3.OBS.003, FR-3.OBS.004, FR-3.ACT.004 *(email/draft arm)*, FR-3.ACT.005, FR-3.ACT.006, FR-3.TOK.007, FR-3.TRIG.004 *(Google arm)*, FR-3.TRIG.005, FR-3.TRIG.006 *(Gmail/Drive/Calendar arm)* — all Component 3, Tool Layer, per-connector instances over the generic runtime.
- **NFRs:** NFR-INF.007 (per-client OAuth apps + Google production-verification lead-time — the Google connector is minted against the client's own verified OAuth app, and CASA/verification is a scheduled onboarding dependency).
- **Rests on:** ADR-001 (per-client OAuth apps + physical isolation + secrets custody); ADR-004 (idempotency/concurrency — Calendar `id` 409-dedup + app-side guard); ADR-005 §5 (per-client OAuth apps in the client's own Google account; CASA / production-verification as an onboarding critical path); ADR-007 (containment-first — boundary-tag reads, verified authenticated ingress, hard limit #1 no autonomous email); ADR-008 (golden rule — Drive/Gmail content referenced, not copied); OD-044 (per-vendor verified-ingress scheme homed in the connector); OD-045 (Drive `drive.file` default / `drive.readonly`+CASA escalation).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-3.OBS.002.3 *(Gmail `history.list` 404 → full sync; the Slack-arm ACs .1/.2 are ISSUE-041)*
- AC-3.OBS.003.1, AC-3.OBS.003.2
- AC-3.OBS.004.1
- AC-3.ACT.004.1 *(email → approval-queue draft, never autonomous; the Slack-post AC .2 is ISSUE-041)*
- AC-3.ACT.005.1, AC-3.ACT.005.2
- AC-3.ACT.006.1, AC-3.ACT.006.2
- AC-3.TOK.007.1, AC-3.TOK.007.2
- AC-3.TRIG.004.3 *(Gmail Pub/Sub OIDC-JWT validated)*, AC-3.TRIG.004.4 *(watch re-armed before lapse; the GHL .1 and Slack .2 arms are ISSUE-039/041)*
- AC-3.TRIG.005.1, AC-3.TRIG.005.2, AC-3.TRIG.005.3
- AC-3.TRIG.006.3 *(Gmail `history.list` 404 → full-sync reconciliation; the Slack-arm ACs .1/.2 are ISSUE-041)*
- AC-NFR-INF.007.1, AC-NFR-INF.007.2 *(OAuth app in the client's own account; Google verification lead-time is a scheduled provisioning dependency, AF-013)*
- **Gating spikes (if any):** none of the six launch-gating spikes (ISSUE-001–006) gate this issue. Build-time AFs that must be **GREEN** before the arms they gate ship (all 🔴 open in `feasibility-register.md`): **AF-109** (Gmail Pub/Sub OIDC push-token validation end-to-end) gates FR-3.TRIG.004 Gmail arm; **AF-102** (Calendar `events.insert` 409-duplicate idempotency holds distributed) gates FR-3.ACT.006 / FR-3.CONN.004 Calendar arm; **AF-108** (Drive `changes` page-token expiry → full-resync parity) gates FR-3.OBS.003 + FR-3.TRIG.006 Drive arm; **AF-106** (Google refresh non-rotation confirmed), **AF-107** (unused-OAuth-client deletion monitoring), **AF-110** (2025 dated-policy text) gate FR-3.TOK.007; **AF-101** (Drive/Calendar exact quota numbers) feeds FR-3.OBS.003/004 rate-tracking; **AF-088** (injection mitigation for untrusted external text) gates the boundary-tag read path (FR-3.CONN.003). *No PHI/BAA gate applies (that is AF-098, GHL-only, ISSUE-039).*

## 5. Touches (complete blast radius, by ID)
- **DATA:** `tools` (register the Google read/write tool rows — read/write via the registry, ISSUE-032); `connector_credentials` (Google row — read expiry, hold `scopes`, set `state=degraded` on dead refresh; DDL + refresh engine owned by ISSUE-032/033); `rate_limit_tracker` (Google window rows — tiering owned by ISSUE-034); `idempotency_ledger` (Calendar/Drive/Gmail external-write dedup keys — mechanism owned by ISSUE-032). Watch/subscription state (channel id, resource id, expiry) + per-channel watermarks (Gmail `historyId`, Drive page-token, Calendar `syncToken`) live in the connector's own config/state per FR-3.TRIG.005/006.
- **PERM:** none new — tool execution runs as `service_role` on the agent path (ADR-006); registry edits use `PERM-tool.manage` (homed in C1/C6, ISSUE-018); re-auth *action* authority (Admin/Super-Admin) is enforced at the DSC surface (ISSUE-038).
- **CFG:** `CFG-drive_full_corpus_ingest` (default false → `drive.file`; true → `drive.readonly` + CASA, OD-045); `CFG-watch_rearm_lead_minutes` (per-connector, below the shortest watch TTL); `CFG-event_reconciliation_sweep_minutes` (Google full-sync sweep cadence). *(Token/rotation CFG keys are owned by ISSUE-033; rate-limit caps by ISSUE-034.)*
- **UI:** none owned here — Google connector status/watch-expiry/token-expiry render only as metadata on the connector health panel + degraded modal, both owned by ISSUE-038 (FR-3.DSC.005/002). The email/calendar drafts appear in the approval queue owned by ISSUE-056.
- **Connectors:** Google (Gmail / Drive / Calendar).

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/01-requirements/component-03-tool-layer.md` — the per-connector instance FRs + ACs for the Google arms: OBS.002 (Gmail arm), OBS.003, OBS.004, ACT.004 (email arm), ACT.005, ACT.006, TOK.007, TRIG.004 (Google arm), TRIG.005, TRIG.006; plus the generic contract they inherit (CONN.002/003/004/005) for boundary-tag / idempotency / minimal-scope obligations.
- `spec/04-data-model/schema.md` §4 Tools & Connectors — `tools`, `connector_credentials`, `rate_limit_tracker`, `idempotency_ledger`.
- `spec/05-non-functional/infrastructure.md` §NFR-INF.007 — per-client OAuth apps + Google verification lead-time.
- `spec/00-foundations/adr/ADR-005-provisioning.md` §5 — per-client OAuth apps in the client's Google account; CASA / production-verification onboarding path.
- `spec/00-foundations/adr/ADR-007-containment.md` — boundary tag, verified authenticated ingress (+ OD-044 clarification note), hard limit #1 (no autonomous external email).
- `spec/00-foundations/adr/ADR-001-isolation-model.md` — per-client isolation + secrets custody.
- `spec/00-foundations/adr/ADR-004-concurrency-model.md` — idempotency/atomicity for the Calendar/Drive writes.
- `spec/00-foundations/adr/ADR-008-backup-dr.md` — golden rule (source_ref pointers, not copies).
- `spec/00-foundations/tool-integrations/google-gmail.md` — the Google dossier; cite it (not the design doc) for **all** Google vendor facts (§2 tokens, §3 quotas, §4 read endpoints/incremental sync, §5 Pub/Sub + channel-token + watch TTLs, §6 Limited-Use policy, §8 scopes/CASA).
- `spec/00-foundations/feasibility-register.md` — §§ AF-101, AF-102, AF-106, AF-107, AF-108, AF-109, AF-110, AF-088, AF-013 — the build-time gates named in §4.

## 7. Dependencies
- **Blocked-by:** ISSUE-033 (generic OAuth token lifecycle — this instance supplies Google params to it), ISSUE-034 (rate limiting — Google quota windows feed it), ISSUE-037 (generic trigger infra + liveness — this instance supplies Google's transport + watch params). *(None of these is a launch-gating spike; no ISSUE-001–006 gate applies to this issue.)*
- **Blocks:** none (leaf).

## 8. Build order within the slice
1. **Register the Google tools (FR-3.OBS.002/003/004, ACT.004/005/006 rows) in the `tools` registry** with plain-English descriptions, `category` read/write, `requires_approval` (true for email + calendar-invite drafts), `connector='google'`, and the dossier-pinned minimal scope set (`gmail.readonly`; `drive.file` default per OD-045; `calendar.readonly`; write scopes `gmail.send`/`drive.file`/`calendar.events` only where an action tool exists). Wire the Google token parameter set (FR-3.TOK.007) into the generic engine as data.
2. **Read tools (FR-3.OBS.002 Gmail arm, OBS.003, OBS.004):** implement Gmail `messages.list`/`get` + incremental `history.list` (404 → full sync); Drive `files.list`/`get` + `changes` incremental (`drive.file` default, `drive.readonly` escalation behind `CFG-drive_full_corpus_ingest`); Calendar `events.list` + `syncToken` (410 → full re-sync). Every result flows through the runtime's boundary-tag (FR-3.CONN.003) and is stored as `source_ref` — no content copies.
3. **Write tools (FR-3.ACT.004 email arm, ACT.005, ACT.006):** route outbound email to an approval-queue draft (never autonomous — hard limit #1); Drive create/append and Calendar `events.insert` (client-supplied `id`, invite drafted to approval) through the runtime idempotency guard (FR-3.CONN.004) — no autonomous delete of a source record.
4. **Trigger transport + verification (FR-3.TRIG.004 Google arm):** Gmail Cloud Pub/Sub push with OIDC-JWT validation (RS256, `aud`/`email`, clock skew); Drive/Calendar HTTPS callback with static `X-Goog-Channel-Token` compare + TLS. Fail-closed on verification failure. **Gmail arm gated on AF-109 GREEN.**
5. **Watch lifecycle (FR-3.TRIG.005):** scheduled re-arm job (mirrors the token-refresh job) that renews `users.watch`/`files.watch`/`changes.watch`/`events.watch` before expiry within `CFG-watch_rearm_lead_minutes`, persisting new channel/expiry; a failed/missed re-arm sets `degraded` (emits the ISSUE-038 signal) — never a silent stop.
6. **Gap reconciliation (FR-3.TRIG.006 Google arm):** on `history.list` 404 / `changes` token-expiry / `events.list` 410, run a full-sync reconciliation from the last good watermark on the `CFG-event_reconciliation_sweep_minutes` cadence; a sweep that cannot run is alerted (never assumed empty). **Drive arm gated on AF-108; Calendar write idempotency gated on AF-102.**
7. **Observability + degrade signals:** log read volume, boundary-tagged ingestion, suppressed duplicates, verification failures, re-arm outcomes, and reconciled gaps (C7 surfaces them); emit `degraded` / re-auth-needed to ISSUE-038.
8. Tests to every AC in §4.

## 9. Verification (how DoD is proven)
- Per `spec/05-non-functional/test-strategy.md`: integration tests per read/write/trigger tool against the Google arms; the write tools proven idempotent (Calendar `id` 409-dedup + app-side guard) via a rapid-retry test — **AF-102** must land GREEN before the Calendar write arm ships. **AF-109** (Gmail Pub/Sub OIDC push validation) is a build-time SPIKE that must be GREEN before the Gmail trigger arm ships; **AF-108** (Drive `changes` page-token expiry) before the Drive incremental/reconciliation arm; **AF-106/107/110** confirm the FR-3.TOK.007 Google token model; **AF-101** pins Drive/Calendar quota numbers into the ISSUE-034 trackers; **AF-088** covers injection containment for the boundary-tagged read path.
- Containment posture: a test asserts every Google read result carries the external-data boundary tag before it reaches memory/prompt (AC-3.CONN.003.1 path), and that an outbound email is *always* a draft to the approval queue — never sent autonomously (AC-3.ACT.004.1) — the hard-limit-#1 / never-do-something-it-shouldn't invariant proven concretely.
- Silent-loss posture: a test lapses a watch and asserts the connector goes `degraded` + surfaces rather than silently ceasing event delivery (AC-3.TRIG.005.2), and that a `history.list` 404 triggers full-sync reconciliation from the watermark (AC-3.TRIG.006.3) — the never-fail-silently invariant for Google event ingestion.
- Provisioning posture: assert the Google connector is minted against the client's own verified OAuth app with Google verification lead-time scheduled (AC-NFR-INF.007.1/.2, AF-013).
