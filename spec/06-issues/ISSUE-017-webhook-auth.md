---
id: ISSUE-017
title: Webhook authentication, per-vendor (Ed25519/JWT/HMAC + replay)
epic: B — identity & access
status: blocked
github: "#17"
---

# ISSUE-017 — Webhook authentication, per-vendor (Ed25519/JWT/HMAC + replay)

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Authenticate every inbound connector webhook at the trust boundary — verify the vendor-specific signature (GHL Ed25519, Google Pub/Sub JWT, Slack HMAC+timestamp), reject unverified/replayed requests `401` before any payload is processed, and support secret rotation + per-source replay/rate defense.

## 2. Scope — in / out
**In:** The full C0 WHK slice — the shared verification entrypoint (raw-body-before-parse, constant-time compare, `401`-reject, `guardrail_log` as `prompt_injection`, ≥3-failures/source/hour alert + auto-throttle), the three per-vendor verifiers (GHL Ed25519 against GHL's published public key incl. legacy `X-WH-Signature` rejection after 2026-07-01; Google Pub/Sub JWT audience/expiry; Slack `v0:` HMAC + 5-min timestamp), the endpoint obscurity token, dual-accept secret rotation, and the replay cache + per-source accept-rate limit. The slice reads `webhook_secrets` / `webhook_replay_cache` and writes `guardrail_log`/`event_log`/`audit`. On success it hands the **verified** payload off to the ingesting component — that is the seam boundary.

**Out:** What the verified payload *does* — parsing, ingestion, task creation — belongs to C3 trigger infra (ISSUE-037) and C2 ingestion (ISSUE-026); this slice stops at "verified payload handed off." Detecting a webhook that **never arrives** (provider outage / dropped delivery, liveness) is C3 FR-3.TRIG.005/006 (OD-104), not here — auth ≠ liveness. Broader connector OAuth credentials (distinct from `webhook_secrets`) are C3 ISSUE-033. Per-connector build wiring (GHL/Google/Slack instances) lands in ISSUE-039/040/041, which consume this verification boundary. The `webhook_secrets` / `webhook_replay_cache` tables themselves are created by the migration harness; this slice owns their read/write logic and the rotation semantics, not the DDL scaffold.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-0.WHK.001, FR-0.WHK.002, FR-0.WHK.003, FR-0.WHK.004, FR-0.WHK.005, FR-0.WHK.006, FR-0.WHK.007, FR-0.WHK.008 (all Component 0 — Login & Authentication)
- **NFRs:** NFR-SEC.008
- **Rests on:** ADR-007 (webhook auth = a hard control = authentication, not content detection); ADR-001 §5 (webhook secrets live in the client-owned Supabase/Vault, never operator custody); OD-046 (GHL HMAC→Ed25519 correction); OD-022 (rotation + replay/rate); OD-023 (source identification + auto-throttle); OD-044 (per-vendor scheme clarification); AF-078 (end-to-end verification, launch-gating)

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-0.WHK.001.1
- AC-0.WHK.002.1, AC-0.WHK.002.2
- AC-0.WHK.003.1
- AC-0.WHK.004.1, AC-0.WHK.004.2
- AC-0.WHK.005.1, AC-0.WHK.005.2
- AC-0.WHK.006.1
- AC-0.WHK.007.1
- AC-0.WHK.008.1, AC-0.WHK.008.2
- AC-NFR-SEC.008.1, AC-NFR-SEC.008.2 (spec/05-non-functional/security.md)
- **Gating spikes:** AF-078 is **🟡 MECHANICS PASS** (ISSUE-006, MODE-M 17/17 — raw-body-before-parse + constant-time + replay proven; Slack symmetric = real proof; Google OIDC mechanics; GHL signing DOCS-resolved → AF-090). **Per OD-172 the proven mechanics satisfy the launch/Checkpoint-0 gate; the empirical live per-connector webhook confirmation (against real vendor key material) is re-gated to ONBOARDING and is owed HERE (and on ISSUE-039/040/041) before each connector goes live for a real client.** AF-090 (exact GHL Ed25519 signing input) is **DOCS-confirmed** (raw-body-only Ed25519 + published public key, GHL primary docs 2026-07-04) with the live-payload confirmation owed at GHL onboarding; it is shared with C3 FR-3.TRIG.004 and informs the GHL verifier's base-string.

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-webhook_secrets (`connector`, `secret_kind`, `secret_value`, `secret_version`, `active`, `rotated_at` — dual-accept rotation), DATA-webhook_replay_cache (`event_id`, `connector_type`, `source_id`, `window_expires_at`), guardrail_log (write on failure — `prompt_injection`), event_log (verified + replay-drop/throttle), audit (rotation)
- **PERM:** none (machine-to-machine — the signature *is* the auth; rotation runs as service-role provisioning)
- **CFG:** CFG-webhook.replay_window_seconds, CFG-webhook.replay_cache_window, CFG-webhook.accept_rate_limit, CFG-webhook.secret_rotation_window, CFG-webhook.failure_alert_threshold, CFG-webhook.google_expected_audience
- **UI:** none (operator sees verification failures via the alert surface, FR-0.WHK.005; endpoint obscurity token has no surface)
- **Connectors:** GHL (Ed25519), Google (Pub/Sub JWT), Slack (HMAC) — verification only; the connector instances themselves are ISSUE-039/040/041

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-00-login.md — WHK area (FR-0.WHK.001–008 text + ACs); read the WHK section header seam note
- spec/04-data-model/schema.md §1 Identity & Auth — `webhook_secrets` + `webhook_replay_cache` table definitions
- spec/05-non-functional/security.md §NFR-SEC.008 — webhook authentication & anti-replay posture + ACs
- spec/00-foundations/adr/ADR-007-*.md — containment-first; webhook verification as a hard control at the trust boundary
- spec/00-foundations/adr/ADR-001-*.md §5 — secrets custody (webhook secrets in client-owned project, never operator)

## 7. Dependencies
- **Blocked-by:** ISSUE-006 (SPIKE: webhook forgery/replay — AF-078 🟡 MECHANICS PASS; per OD-172 the live per-connector verification is re-gated to onboarding and owed here, not launch-blocking)
- **Blocks:** ISSUE-037 (C3 trigger infra — consumes the verified event), ISSUE-047 (C5 triggers — deployment-freeze gate)

## 8. Build order within the slice
1. Read path over the secrets store: load the active per-connector secret(s)/public key from `webhook_secrets` (`secret_kind` selector; service_role-only read, Vault-decrypted) — the source of truth for every verifier.
2. Shared verification entrypoint (FR-0.WHK.001 + FR-0.WHK.005): capture the **raw body before any JSON parse** (a framework that buffers/parses first silently breaks all three verifiers — see AF-078), route by connector, constant-time compare (`crypto.timingSafeEqual`, never `===`), reject `401` on failure, write `guardrail_log` as `prompt_injection`. This is the spine the three verifiers plug into.
3. Per-vendor verifiers on top of the entrypoint: GHL Ed25519 vs GHL's published public key + legacy `X-WH-Signature` rejection after 2026-07-01 (FR-0.WHK.002, base-string per AF-090); Google Pub/Sub JWT signature/audience/expiry via `oauth2/v3/certs` (FR-0.WHK.003, `CFG-webhook.google_expected_audience`); Slack 5-min timestamp gate then `v0:[ts]:[raw body]` HMAC (FR-0.WHK.004).
4. Source identification + threshold alert + auto-throttle (FR-0.WHK.005): identify source by connector + endpoint token + IP; ≥`CFG-webhook.failure_alert_threshold` failures/source/hour → alert all Super Admins + throttle that source.
5. Replay cache + per-source accept-rate limit on *verified* webhooks (FR-0.WHK.008): dedup by `event_id` within `CFG-webhook.replay_cache_window`; throttle per `CFG-webhook.accept_rate_limit`.
6. Dual-accept secret rotation (FR-0.WHK.007): both `secret_version` values verify during `CFG-webhook.secret_rotation_window`, then retire the old; write rotation `audit`.
7. Endpoint obscurity token (FR-0.WHK.006): per-deployment random URL token, absent from client-facing docs — explicitly *not* a security control (the signature check is the real boundary).
8. On success, hand the **verified** payload to the ingesting component (seam to ISSUE-037/ISSUE-026) — this slice does not parse or act on payload content.
9. Test to the ACs: valid / tampered / replayed payload battery per connector (the AF-078 test target).

**Integration note (spans the bundled FRs):** FR-0.WHK.001 and FR-0.WHK.005 are one shared pipeline, not two features — .001 is the reject-before-process contract and .005 is the how (raw-body/constant-time/log/alert). Build them together; the three per-vendor verifiers (.002/.003/.004) are strategy plug-ins into that one pipeline, and .007/.008 wrap it (rotation on the read side, replay/rate on the post-verify side). Getting the raw-body-before-parse ordering wrong invalidates every signature at once — this is the single load-bearing correctness point AF-078 exists to prove.

## 9. Verification (how DoD is proven)
- Per spec/05-non-functional/test-strategy.md: an end-to-end security test battery (valid, tampered, replayed payloads per connector) is the primary layer — this *is* the AF-078 spike (ISSUE-006) and must be GREEN before ship. Unit tests cover constant-time compare, base-string construction, and rotation dual-accept windows.
- The `AC-NFR-SEC.008` posture must hold: unverified/replayed → `401` + log + (past threshold) alert, no downstream task created. AF-078 is **🟡 MECHANICS PASS** (ISSUE-006); per **OD-172** the proven mechanics clear the Checkpoint-0 gate, and the AC→`Verified` path for this slice closes when this issue's **live per-connector webhook verification passes at onboarding** against real vendor key material (the residual OD-172 re-gated here), recorded in spec/00-foundations/feasibility-register.md.
