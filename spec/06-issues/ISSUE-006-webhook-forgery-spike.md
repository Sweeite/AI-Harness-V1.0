---
id: ISSUE-006
title: "SPIKE — webhook forgery / replay rejected end-to-end (AF-078)"
epic: S — spikes
status: ready
github: "#6"
---

# ISSUE-006 — SPIKE: webhook forgery / replay rejected end-to-end (AF-078)

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Prove, on a running system, that forged and replayed inbound webhooks are rejected across all three connectors (GHL Ed25519 · Google Pub/Sub JWT · Slack HMAC) — turning launch-gating spike **AF-078** GREEN so ISSUE-017 (the production webhook-auth build) may ship.

## 2. Scope — in / out
**In:** A throwaway but faithful verification harness that exercises the *mechanics* the three verifiers depend on and proves they reject bad input:
- Raw-body capture **before** JSON parse (a framework that buffers/parses first silently breaks all three signatures) — the load-bearing failure mode AF-078 exists to catch.
- Constant-time comparison (`crypto.timingSafeEqual`, never `===`).
- Per-connector signing/verification: GHL Ed25519 against GHL's published public key; Google Pub/Sub JWT (signature via Google certs + audience + expiry); Slack HMAC-SHA256 over `v0:[timestamp]:[raw body]` with the signing secret.
- Replay defense: Slack 5-minute timestamp window; GHL/Google seen-event-ID replay cache.
- A test battery of **valid · tampered · replayed** payloads per connector, asserting valid→accept and tampered/replayed→`401` + log.
This slice delivers the **evidence + logged PASS in the feasibility register** (the six-spike go/no-go gate), not the production endpoints.

**Out:** The productionised webhook-auth implementation, secret-rotation dual-accept window, per-source alert/throttle wiring, and the obscurity-token endpoint structure — all owned by **ISSUE-017** (C0 WHK, epic B). Trigger-infra consumption of the *verified* event (watch re-arm, event-gap reconcile) is **ISSUE-037** (C3 TRIG). This spike is throwaway: it proves the mechanics; ISSUE-017 builds them for real citing this PASS.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** proves the feasibility of FR-0.WHK.001, FR-0.WHK.002, FR-0.WHK.003, FR-0.WHK.004, FR-0.WHK.005 (component-00-login) — and exercises the replay path of FR-0.WHK.008. (This is a spike; it does not itself set these FRs `Verified` — it clears the AF gate that lets ISSUE-017 do so.)
- **NFRs:** NFR-SEC.008 (webhook authentication & anti-replay — this spike is its named `Verification` method).
- **Rests on:** ADR-007 (webhook auth = a hard control that ignores prompt content; a failed verify logs `prompt_injection`) · OD-046 (GHL HMAC→Ed25519 correction) · OD-022/OD-023 (replay cache, per-source rate/alert) · AF-078 (the gate this spike proves) · AF-090 (exact GHL Ed25519 signing input — shared with C3 FR-3.TRIG.004).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-0.WHK.001.1 — invalid/absent signature → `401`, no payload processing.
- AC-0.WHK.002.1 — GHL `X-GHL-Signature` Ed25519 fails → `401` + `prompt_injection` log.
- AC-0.WHK.002.2 — GHL legacy `X-WH-Signature`-only request after 2026-07-01 → rejected.
- AC-0.WHK.003.1 — Google push with wrong JWT audience → `401` + log.
- AC-0.WHK.004.1 — Slack timestamp >5 min → rejected as replay before signature check.
- AC-0.WHK.004.2 — Slack valid timestamp but mismatched signature → `401` + log.
- AC-0.WHK.005.1 — a parse-then-verify connector fails the spec (raw body must be captured before parse).
- AC-0.WHK.008.1 — a verified webhook whose event ID is already in the replay window → dropped + logged.
- AC-NFR-SEC.008.1 — invalid/absent signature → `401`, logged, (past threshold) alerted, no downstream task created.
- AC-NFR-SEC.008.2 — a replayed webhook → rejected/deduplicated, does not re-trigger work.
- **Gating spikes (this issue IS one):** AF-078 must be logged **GREEN** (PASS with evidence in `feasibility-register.md` §K) — it is a launch go/no-go spike (RP-1, OD-157) and the DoD of this issue is precisely that PASS. This issue has no blocking-by upstream (see §7).

## 5. Touches (complete blast radius, by ID)
- **DATA:** `DATA-webhook_secrets` (versioned per-connector secrets: `ghl_webhook_secret`, `slack_signing_secret`, Google expected-audience — read) · `DATA-webhook_replay_cache` (seen event IDs + window — read/write) · `guardrail_log` (write, `prompt_injection`, on every failed verify — DDL in schema §7) · `event_log` (write: verified-accept and replay-drop rows — DDL in schema §8 Observability, named in the manifest §6).
- **PERM:** none (machine-to-machine — the signature *is* the auth; FR-0.WHK.001).
- **CFG:** `CFG-webhook.replay_window_seconds` (Slack, default 300) · `CFG-webhook.replay_cache_window` (GHL/Google) · `CFG-webhook.google_expected_audience` · `CFG-webhook.failure_alert_threshold` (default 3/hr/source — referenced for the AC-NFR-SEC.008.1 alert assertion; full wiring is ISSUE-017).
- **UI:** none (operator sees failures via alerts — Phase-3 surface, out of this spike).
- **Connectors:** GHL · Google · Slack (all three verifiers must pass; a single parse-before-verify framework breaks all three — the AF-078 crux).

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/01-requirements/component-00-login.md` §WHK (FR-0.WHK.001–005, 008 + their ACs) + the `CFG-webhook.*` stub table (default values, incl. `google_expected_audience`).
- `spec/05-non-functional/security.md` §NFR-SEC.008 (posture + AC-NFR-SEC.008.1/.2).
- `spec/05-non-functional/test-strategy.md` §3 (AF de-risking schedule — AF-078 row) + §4 (the six-spike go/no-go gate: what a logged PASS requires).
- `spec/00-foundations/feasibility-register.md` §K (AF-078 full statement) + §J (Block J vendor facts) + §N Google/GHL/Slack dossier AFs (AF-090 GHL Ed25519 signing input — see §8.0 below: this is a spike **input to discover**, not a precondition to look up).
- `spec/04-data-model/schema.md` §1 Identity & Auth (`webhook_secrets`, `webhook_replay_cache` DDL) + §7 Guardrails (`guardrail_log` DDL) + §8 Observability (`event_log` DDL — the verified-accept / replay-drop write target named in §5).
- `spec/00-foundations/adr/ADR-007-injection-posture.md` (webhook auth = a hard control; failed verify → `prompt_injection`).

## 7. Dependencies
- **Blocked-by:** none (foundational spike — Tier 0; runs first / alongside per the backlog build-order tiers).
- **Blocks:** ISSUE-017 (Webhook authentication, per-vendor — Ed25519/JWT/HMAC + replay). ISSUE-017 in turn feeds ISSUE-037 (trigger infra) and ISSUE-047 (harness triggers). Per the backlog "Spike sequencing (OD-157)": 006 → 017 (→ 037, 047).

## 8. Build order within the slice

> **8.0 — Spike-discovery preamble (why three facts are deliberately absent from the manifest).**
> This issue **is** the spike whose job is to *establish* facts that no repo file yet asserts —
> they are unresolvable from the named files **by design** (an unverified 🔴 AF is an open question,
> not a lookup), so the builder resolves them **as the first act of the spike**, from primary vendor
> sources, and **writes each discovered value back into the repo** (Rule 0) before it becomes
> load-bearing. Do **not** guess or hard-code these; discover and record them:
> - **GHL Ed25519 signing input (AF-090, `feasibility-register.md` §N).** The exact bytes GHL signs
>   (raw body only, or body concatenated with a timestamp/header) are **not** in any named file — that
>   is precisely what AF-090 is 🔴 open on. Determine it empirically against GHL's published public key
>   on a **live captured payload** (per AF-090's method), then record the confirmed base-string
>   construction in the AF-090 row before implementing step 3. This resolves the base string for
>   AC-0.WHK.002.1.
> - **GHL published Ed25519 public key (value + fetch source).** FR-0.WHK.002's precondition ("GHL's
>   published public key available to the verifier") names the *dependency* but no file carries the
>   concrete key or its URL. Obtain it from GHL's primary developer docs during discovery, capture the
>   value/URL in the AF-090 row (alongside the signing-input finding), and have the verifier read it
>   from `DATA-webhook_secrets` (the "GHL published public key" column, per §5) — never inline it.
> - **Google expected audience (`CFG-webhook.google_expected_audience`).** The CFG stub default is `—`
>   (unset — it is *per-deployment* config, correctly not a repo constant). For this throwaway harness,
>   **choose a fixed test audience value**, set it in the harness config, and mint the valid-case JWT
>   with that same audience so AC-0.WHK.003.1 has a concrete value to assert against (wrong-audience →
>   `401`). The chosen value is spike-local and is **not** written back to the spec.
>
> The Slack path has **no** such gap — the signing secret is self-generated and the base string
> (`v0:[timestamp]:[raw body]`) is fully specified — so it is built first (step 2) as the
> self-signable reference that proves the ingress shim (step 1) before the two vendor-keyed paths.

1. **Stand up a raw-body ingress shim** — an HTTP handler that captures the exact received bytes *before* any JSON parse, and expose the parsed body separately, so the harness can prove the raw-vs-parsed distinction (AC-0.WHK.005.1). This is the single most important step: it is the mechanic AF-078 was written to catch.
2. **Slack verifier** — reject timestamp >`replay_window_seconds` first (AC-0.WHK.004.1), then HMAC-SHA256 over `v0:[timestamp]:[raw body]` with the signing secret, `timingSafeEqual` compare (AC-0.WHK.004.2). Simplest to self-sign end-to-end, so build first as the reference.
3. **GHL verifier** — Ed25519 verify of `X-GHL-Signature` against GHL's published public key, using the exact signed-bytes base string and the public-key value/source **discovered and recorded in step 8.0** (AF-090); reject legacy `X-WH-Signature`-only after 2026-07-01 (AC-0.WHK.002.1/.2).
4. **Google verifier** — JWT from `Authorization`, verify signature against Google certs (`https://www.googleapis.com/oauth2/v3/certs`, per FR-0.WHK.003), check audience against the spike-local `CFG-webhook.google_expected_audience` value **chosen in step 8.0** + expiry (AC-0.WHK.003.1).
5. **Common reject path** — every failed verify → `401`, write `guardrail_log` as `prompt_injection`, no downstream work (AC-0.WHK.001.1, AC-NFR-SEC.008.1); assert no task is created.
6. **Replay cache** — record seen event IDs (GHL/Google) in `webhook_replay_cache`; a seen ID within `replay_cache_window` → drop + log (AC-0.WHK.008.1, AC-NFR-SEC.008.2).
7. **Test battery** — per connector, a matrix of {valid, tampered-body, tampered-signature, replayed, stale-timestamp} payloads; assert accept/reject per the ACs above.
8. **Log the result** — record AF-078 PASS (with the battery as evidence) in `feasibility-register.md` §K, and reflect the GREEN status so ISSUE-017 may unblock. A FAIL forces the mechanics to change (a bypass must be closed in code, per ADR-007) — not patched with a detection rule.

## 9. Verification (how DoD is proven)
- **Test layer:** **Red-team / E2E adversarial** per `test-strategy.md` §1 (the layer that proves "an adversary cannot exceed the containment boundary" — webhook forgery). AF-078's method is "E2E adversarial" (§3 schedule).
- **Gate:** AF-078 is one of the **six launch go/no-go spikes** (`test-strategy.md` §4) — it must show a **PASS with evidence logged** in the feasibility register before go-live; ISSUE-017 cannot mark FR-0.WHK.001–005 `Verified` until this AF is GREEN (the `AC → Verified` rule: an AC held by a paper-not-proven AF stays `Ready`, not `Verified`, until the gate clears).
- **Posture asserted:** NFR-SEC.008 (a forged event cannot drive the system) — upholds non-negotiable #2. The proof battery must cover valid + tampered + replayed per connector; a single parse-before-verify path failing the AC-0.WHK.005.1 assertion is a spike FAIL, not a warning.
