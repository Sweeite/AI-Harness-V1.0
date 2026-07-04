# ISSUE-006 — webhook forgery / replay rejected end-to-end (AF-078 gate)

Red-team / E2E-adversarial harness for **[ISSUE-006](../../spec/06-issues/ISSUE-006-webhook-forgery-spike.md)**.
It proves that **forged and replayed inbound webhooks are rejected** across all three connectors —
**GHL (Ed25519) · Google Pub/Sub (JWT) · Slack (HMAC)** — the mechanic that upholds non-negotiable #2
(a forged event cannot drive the system). On a **MODE R** PASS, **AF-078** flips 🔴→🟢 — one of the
six launch go/no-go SPIKE-GATEs (`test-strategy.md` §4) — unblocking ISSUE-017 (the production
webhook-auth build).

Stack: **TypeScript / Node** ([ADR-009](../../spec/00-foundations/adr/ADR-009-implementation-stack.md)),
zero runtime deps — Node built-in `crypto` for Ed25519 · RS256/JWKS · HMAC-SHA256.

## The crux (why a PASS means something)

A webhook signature is computed over the **exact bytes the vendor sent**. The single load-bearing
failure mode AF-078 exists to catch: **a framework that buffers → `JSON.parse` → re-serialises the
body before the verifier runs breaks all three signatures at once** (key order / whitespace / number
formatting differ). So the harness captures the **raw body before any parse** and can only ever verify
over those bytes, and it ships a deliberately-wrong parse-then-verify variant to prove that path fails
a genuinely-valid signature (AC-0.WHK.005.1). Alongside: **constant-time compare** (`timingSafeEqual`,
never `===`), correct base strings, JWKS/audience/expiry (Google), and replay rejection (Slack 5-min
window + GHL/Google seen-event-ID cache).

## Two modes — honest about what is proven

| Mode | Needs | Proves | AF-078 |
|---|---|---|---|
| **M — mechanics** | nothing (self-contained) | the verifier LOGIC end-to-end using harness-generated keys/secrets: Slack self-signed; GHL via a **throwaway Ed25519 keypair simulating GHL's signer**; Google via a local JWKS. Proves parse-before-verify, constant-time compare, replay defense. | **stays 🔴** — does NOT resolve AF-090; the harness refuses to claim GREEN. |
| **R — real (you-present)** | operator supplies a **live captured GHL payload** + **GHL's real public key** (`.env`) | everything MODE M proves, **plus** the GHL path against REAL vendor signatures — resolving **AF-090** (the real GHL signing base string). | **flips 🟢** on PASS ("don't fake infra"). |

**MODE M can never be GREEN.** GHL has facts no repo file asserts by design (AF-090) — the exact bytes
GHL signs must be confirmed **empirically against a live captured payload verified with GHL's published
public key**. Only MODE R does that. Slack is fully self-signable; GHL's real-signature proof is not.

## What it does (maps 1:1 to ISSUE-006 §8 build order)

| Step | File | What |
|---|---|---|
| 8.0 discovery | `src/battery.ts` (`discoverGhlSigningInput`) | MODE R: resolve the **AF-090** GHL signing base string by testing candidate constructions against the live capture + real key; if none verify, it THROWS (a real finding — never signed away). |
| 1 raw-body shim | `src/rawBody.ts` | Captures the exact received bytes **before** JSON parse; exposes `raw` and `parsed` separately. Ships the wrong `parseThenVerifyIngress` variant to prove it FAILS the spec (AC-0.WHK.005.1). |
| — sinks | `src/sinks.ts` | In-memory `webhook_secrets` · `webhook_replay_cache` · `guardrail_log` · `event_log` matching the schema DDL, with invariants (guardrail_log append-only; `hard_limit` never `approved`; replay PK (connector,event_id)). |
| 2 Slack | `src/verifiers/slack.ts` | Reject timestamp >`replay_window_seconds` **first** (AC-0.WHK.004.1), then HMAC-SHA256 over `v0:[ts]:[raw]`, `timingSafeEqual` compare (AC-0.WHK.004.2). Self-signable reference. |
| 3 GHL | `src/verifiers/ghl.ts` | Ed25519 verify of `X-GHL-Signature` against the published key (read from `webhook_secrets`) using the §8.0-discovered base string; reject legacy `X-WH-Signature`-only after 2026-07-01 (AC-0.WHK.002.1/.2). |
| 4 Google | `src/verifiers/google.ts` | JWT from `Authorization`; RS256 verify against Google certs (local JWKS in MODE M); check audience + expiry (AC-0.WHK.003.1). |
| 5 reject path | `src/reject.ts` | Failed verify → 401 + `guardrail_log` `prompt_injection` + **no** downstream task (AC-0.WHK.001.1, AC-NFR-SEC.008.1); past `failure_alert_threshold` → alert. |
| 6 replay cache | `src/replayCache.ts` | Seen event IDs (GHL/Google) in `webhook_replay_cache`; a seen ID within the window → drop + log (AC-0.WHK.008.1, AC-NFR-SEC.008.2). |
| 7 battery | `src/battery.ts` | Per connector, a {valid, tampered-body, tampered-signature, replayed, stale-timestamp} matrix; assert accept/reject per the ACs. |
| 8 evidence | `src/report.ts` | Emits the AF-078 evidence block (fields a–h) + JSON → `results/` **at run time only**. |
| — config | `src/config.ts` | The `CFG-webhook.*` values + M/R mode selection + operator-input reading. |
| — keygen | `src/keygen.ts` | MODE M self-contained key/secret material (Slack secret, throwaway Ed25519 pair, RSA+JWKS). |
| — orchestrator | `src/main.ts` | §8 order; selects mode by env; **refuses to claim GREEN in MODE M**; exits non-zero on FAIL. |

## Run

```bash
npm install
# MODE M (mechanics — no operator infra; proves logic, stays 🔴 on AF-078):
npm run spike
# MODE R (real — flips AF-078 🟢): fill .env from .env.example first, then:
npm run spike
npm run typecheck
```

> This is an **R8 "you-present" spike**: the **operator runs it, present**, so the evidence is
> trustworthy. `results/` currently holds only `PENDING.md` — the `af-078-evidence.<date>.{json,md}`
> files are written **only when the harness is actually run**, never fabricated.

## What this proves — and what it does not

- **Proves (on a MODE R PASS → AF-078):** end-to-end inbound webhook verification across GHL/Google/Slack
  rejects forged & replayed events; the raw body is captured before parse; compares are constant-time;
  replay is defended. Yields the reusable red-team battery.
- **MODE M proves the mechanics only** — the GHL path uses a throwaway keypair, so **AF-090 is
  unresolved** and AF-078 stays 🔴. The harness says so loudly and exits without claiming GREEN.
- **Does NOT prove:** the *shipped* ISSUE-017 endpoints are safe — this is the throwaway stub sanctioned
  by §8; the retained battery re-runs against the real code pre-release. Secret rotation dual-accept,
  per-source throttle wiring, and the obscurity-token endpoint are ISSUE-017.

## On ⛔ FAIL

A forged/replayed event that verifies, or a parse-before-verify break, makes the auth boundary
incomplete. Per **R2 / ADR-007** the path is **closed in code** (a blocking finding on ISSUE-017),
**never patched with a detection rule**, then the battery re-runs. A FAIL is a design fork (log an OD),
not a bug to code around.
