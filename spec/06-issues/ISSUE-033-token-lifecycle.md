---
id: ISSUE-033
title: OAuth token lifecycle — 3-layer refresh + atomic rotate-persist
epic: D — tool layer
status: blocked
github: "#33"
---

# ISSUE-033 — OAuth token lifecycle — 3-layer refresh + atomic rotate-persist

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Keep every connector's OAuth credentials alive and safe end-to-end: encrypted storage, a 3-layer refresh model (proactive job → reactive-on-401 → dead-token degrade/re-auth), and atomic persist of rotated refresh tokens so the harness never silently loses access.

## 2. Scope — in / out
**In:** The generic TOK runtime that lives once in the shared connector runtime (ISSUE-032's spine) and serves all connectors:
- Encrypted `connector_credentials` storage + no-token-leak redaction boundary (FR-3.TOK.001).
- Layer 1 — the scheduled proactive-refresh job (default 15 min interval, 30 min lead) that renews soon-to-expire tokens (FR-3.TOK.002).
- Layer 2 — reactive refresh-and-retry-once on a 401, no retry-loop (FR-3.TOK.003).
- Layer 3 — dead-refresh-token detection → move connector to `degraded` + emit the one-click re-auth signal; dependent tasks pause, not fail (FR-3.TOK.004).
- Atomic rotate-persist: persist the newly-issued refresh token as part of the refresh, before the new access token is used, incl. the post-refresh-pre-persist crash recovery (grace-window retry → degrade loudly) (FR-3.TOK.005).
- The 99%-invisible metric hook: report the automatic-vs-manual refresh ratio (FR-3.TOK.006).
- Wire the three per-connector token **parameter sets** — Google (FR-3.TOK.007), GHL (FR-3.TOK.008), Slack (FR-3.TOK.009) — into the generic engine as data/config, so the connector instances (ISSUE-039/040/041) supply only parameters.

**Out:**
- The `credentials`/`connector_credentials` table DDL itself and the connector-runtime spine that hosts this machinery — owned by **ISSUE-032** (CONN/REG). This issue *populates and drives* that runtime; it does not create it.
- The degraded-state surfacing (modal/banner), auto-resume of paused tasks, escalation clock, and health panel — owned by **ISSUE-038** (DSC). Layer 3 here only *sets* `state=degraded` and emits the re-auth-needed / pause signals that ISSUE-038 renders and resumes (FR-3.DSC.002/003, FR-3.TOK.004.2 resume is proven there).
- Rate-limit tiers/backoff (FR-3.RL.*) — **ISSUE-034**.
- The concrete connector read/write/trigger behaviour and OAuth-app provisioning per connector — **ISSUE-039 (GHL) / 040 (Google) / 041 (Slack)**; this issue only defines their token parameter FRs so those instances inherit them.
- Inbound webhook secret custody/rotation (`webhook_secrets`) — that is a separate C0 table (ISSUE-017), not `connector_credentials`.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-3.TOK.001, FR-3.TOK.002, FR-3.TOK.003, FR-3.TOK.004, FR-3.TOK.005, FR-3.TOK.006 (Component 3 — Tool Layer, generic runtime); FR-3.TOK.007 (Google params), FR-3.TOK.008 (GHL params), FR-3.TOK.009 (Slack params).
- **NFRs:** NFR-SEC.003 (secrets custody — token no-leak + presence/last-rotated-only surfacing); NFR-INF.007 (per-client OAuth apps — tokens are minted against the client's own OAuth app, not a shared operator app).
- **Rests on:** ADR-001 (secrets custody — credentials live in the client-owned deployment, never operator custody); ADR-004 (atomicity/concurrency — the atomic rotate-persist and single-flight refresh); ADR-008 (in-DB `connector_credentials` is covered by backup/DR); AF-003 finding F5 (the GHL rotating-refresh persist trap that motivates FR-3.TOK.005).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-3.TOK.001.1, AC-3.TOK.001.2
- AC-3.TOK.002.1, AC-3.TOK.002.2
- AC-3.TOK.003.1, AC-3.TOK.003.2
- AC-3.TOK.004.1, AC-3.TOK.004.2 *(the auto-resume half of .004.2 is realised + proven in ISSUE-038; this slice must emit the pause/re-auth-needed signal it consumes)*
- AC-3.TOK.005.1, AC-3.TOK.005.2
- AC-3.TOK.006.1
- AC-3.TOK.007.1, AC-3.TOK.007.2 (Google)
- AC-3.TOK.008.1 (GHL)
- AC-3.TOK.009.1, AC-3.TOK.009.2 (Slack)
- AC-NFR-SEC.003.1, AC-NFR-SEC.003.2 (token/credential never rendered or logged in the clear)
- **Gating spikes (if any):** **AF-089** (GHL refresh-token rotation persistence/race under concurrency — the 30 s same-token grace window) must be **GREEN** before the GHL rotate-persist arm (FR-3.TOK.005 / FR-3.TOK.008) ships — it is a build-time SPIKE/LOAD gate, currently 🔴 open (feasibility-register.md AF-089). FR-3.TOK.006's 99% figure is a paper target verified by EVAL at build, not a launch gate.

## 5. Touches (complete blast radius, by ID)
- **DATA:** `connector_credentials` (access_token, refresh_token, expires_at, scopes, state, timestamps — read expiry / write new+rotated tokens / set `state=degraded`). *(Table DDL owned by ISSUE-032; this slice reads/writes it.)*
- **PERM:** none new — decrypt + refresh run as runtime/`service_role` only; the re-auth *action* authority (Admin/Super-Admin) is enforced at the DSC surface (ISSUE-038), not here.
- **CFG:** `CFG-token_refresh_interval_minutes` (default 15), `CFG-token_refresh_lead_minutes` (default 30), `CFG-slack_token_rotation_enabled` (default false, OD-040).
- **UI:** none owned here — token state renders only as metadata on the connector health panel / degraded modal, both owned by ISSUE-038 (FR-3.DSC.005/002). NFR-SEC.003.1 (presence + last-rotated only) constrains that surface.
- **Connectors:** GHL (rotating single-use refresh — the persist trap), Google (Gmail/Drive/Calendar — non-rotating refresh), Slack (`xoxb` non-expiring default; opt-in `xoxe` rotation).

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/01-requirements/component-03-tool-layer.md` §TOK — the six generic TOK FRs + their ACs, and the per-connector TOK.007/008/009 parameter FRs + ACs.
- `spec/04-data-model/schema.md` §4 Tools & Connectors — the `connector_credentials` table.
- `spec/05-non-functional/security.md` §NFR-SEC.003 — secrets custody + no-leak posture.
- `spec/05-non-functional/infrastructure.md` §NFR-INF.007 — per-client OAuth apps (token issuer).
- `spec/00-foundations/adr/ADR-001-isolation-model.md` — secrets custody / isolation.
- `spec/00-foundations/adr/ADR-004-concurrency-model.md` — atomicity + single-flight for the rotate-persist.
- `spec/00-foundations/adr/ADR-008-backup-dr.md` — in-DB credentials covered by backup.
- `spec/00-foundations/feasibility-register.md` §AF-089 — the GHL rotation-race spike this slice's GHL arm gates on.

## 7. Dependencies
- **Blocked-by:** ISSUE-032 (connector contract + shared runtime + `connector_credentials` table — this machinery lives inside that runtime).
- **Blocks:** ISSUE-038 (disconnection/recovery — consumes the `degraded` state + pause/re-auth signal), ISSUE-039 (GHL instance), ISSUE-040 (Google instance), ISSUE-041 (Slack instance — each inherits its TOK parameter FR).

## 8. Build order within the slice
1. **Credential access layer (FR-3.TOK.001):** wrap `connector_credentials` reads to decrypt only in-runtime at call time; add the logging-boundary redactor so no token reaches `event_log`/UI/env/config (satisfies NFR-SEC.003.1/.2). Build this first — every later layer writes through it.
2. **Refresh primitive + atomic rotate-persist (FR-3.TOK.005):** implement the single refresh op that, for rotating connectors, writes new access + new refresh in one atomic step before the new access token is used; add single-flight guarding (ADR-004) and the post-refresh-pre-persist recovery path (retry within the vendor grace window → else `state=degraded` loudly). This is the #1 "silently lose access" backstop — build before the layers that call it. **GHL arm gated on AF-089 GREEN.**
3. **Per-connector parameter sets (FR-3.TOK.007/008/009):** feed the refresh primitive as data — Google (~1h access, refresh not rotated, 100-token-cap surfacing), GHL (~24h access, single-use rotating, 30 s grace), Slack (`xoxb` non-expiring skip; `xoxe` opt-in rotation persist). No per-connector code branches — parameters only (proves the FR-3.CONN.002 spine).
4. **Layer 1 proactive job (FR-3.TOK.002):** scheduled every `CFG-token_refresh_interval_minutes`; refresh tokens within `CFG-token_refresh_lead_minutes`; skip non-expiring (Slack `xoxb`).
5. **Layer 2 reactive path (FR-3.TOK.003):** on 401, call the refresh primitive, retry the call exactly once, then fail toward Layer 3 — never loop.
6. **Layer 3 dead-token detection (FR-3.TOK.004):** on unrecoverable refresh, set `connector_credentials.state=degraded` and emit the pause + re-auth-needed signal (the signal ISSUE-038 consumes; do not build the surface here).
7. **Metric hook (FR-3.TOK.006):** count automatic (Layer 1+2) vs manual (Layer 3) resolutions and expose the ratio.
8. Tests to every AC in §4.

## 9. Verification (how DoD is proven)
- Per `spec/05-non-functional/test-strategy.md`: integration tests for the refresh layers + a **build-time SPIKE/LOAD** for the GHL concurrent-rotation persist race (**AF-089** must land GREEN before the GHL rotate-persist arm ships); an **EVAL** measures the FR-3.TOK.006 automatic-resolution ratio (paper target, not a gate).
- Security posture: a build-time redaction test asserts no token material appears in `event_log`/`guardrail_log` payloads or any UI response (AC-NFR-SEC.003.1/.2) — the AC→`Verified` path for the no-leak invariant.
- Atomicity: a fault-injection test crashes between the vendor refresh response and the local persist and asserts the connector never uses a half-saved credential and degrades loudly (AC-3.TOK.005.2) — the #1 non-negotiable (never silently lose access) proven concretely.
