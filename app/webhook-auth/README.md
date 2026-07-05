# @harness/webhook-auth — ISSUE-017 (C0 WHK)

Per-vendor inbound **webhook authentication** at the trust boundary. Verifies the vendor-specific
signature, rejects unverified/replayed requests `401` **before any payload is processed**, and
supports secret rotation + per-source replay/rate defense.

- **Implements:** FR-0.WHK.001–008 · NFR-SEC.008 (see `spec/01-requirements/component-00-login.md` WHK area).
- **Rests on:** ADR-007 (webhook auth = a hard control), ADR-001 §5 (secrets in the client-owned
  Supabase/Vault, never operator custody), OD-046/022/023/044/172, AF-078/AF-090.
- **Productionises** the AF-078 mechanics spike (`spikes/issue-006-webhook-forgery/`, MODE-M 17/17):
  the proven raw-body-before-parse ingress, constant-time compare, three verifiers, and replay cache
  are carried over; this package adds the four pieces the spike deferred — **dual-accept rotation**
  (FR-0.WHK.007), the **real alert + auto-throttle** wiring (FR-0.WHK.005), the **per-source
  accept-rate limit** (FR-0.WHK.008), and the **endpoint obscurity token** (FR-0.WHK.006).

## Shape (house port + fake pattern)

```
src/
  verify.ts         The shared entrypoint (FR-0.WHK.001+005): throttle-gate → raw body → route →
                    verify → replay-dedup → accept. The three verifiers are strategy plug-ins.
  verifiers/        ghl.ts (Ed25519 +legacy cutoff) · slack.ts (HMAC v0 + 5-min window) ·
                    google.ts (Pub/Sub JWT: RS256/JWKS + aud + exp).
  store.ts          WebhookStore PORT + InMemoryWebhookStore fake (the reference model). Models
                    webhook_secrets (versioned) · webhook_replay_cache · guardrail_log · event_log ·
                    audit · per-source failure/accept counters · alert + throttle.
  supabase-store.ts LIVE pg adapter of the port (⚠️ NOT YET RUN LIVE — see below).
  outcome.ts        reject/accept/replayDrop/throttled — 401 + guardrail_log(prompt_injection),
                    threshold alert + throttle, accept-rate throttle, replay drop.
  rotation.ts       Dual-accept rotation ops (FR-0.WHK.007) + audit rows.
  obscurity.ts      Endpoint obscurity token (FR-0.WHK.006) — explicitly NOT a security control.
  source.ts         Source identity: connector + endpoint token + IP (FR-0.WHK.005).
  config.ts         CFG-webhook.* defaults + registry validation ranges.
  rawBody.ts        Raw-body-before-parse ingress — the AF-078 load-bearing correctness point.
  fixtures.ts       Test key material (Ed25519 / HMAC / RSA+JWKS).
  verify.test.ts    The AC battery — one test per AC (18/18).
```

## Verify

```
npm run typecheck   # tsc --noEmit (clean)
npm test            # 18/18 — every AC-0.WHK.* + AC-NFR-SEC.008.*
```

## The seam

On a `200` outcome the caller takes `outcome.verifiedPayload` and hands it to the ingesting
component (C2/C3 — ISSUE-037/026). This slice stops at "verified payload handed off"; it never
parses or acts on payload content.

## Owed at onboarding (OD-172 — NOT launch-blocking, blocking THERE)

Per OD-172, the **live per-connector webhook confirmation against real vendor key material** is
re-gated from launch to per-connector onboarding — owed here and on ISSUE-039/040/041 before each
connector ships for a real client. The offline battery proves the mechanics + logic (AF-078 🟡
MECHANICS PASS, AF-090 DOCS-confirmed); it does **not** prove a live GHL/Google/Slack payload
verifies end to end. `supabase-store.ts` is authored to the DDL but **has not been run live** — do
not treat its code paths as verified until an onboarding live run records evidence. A multi-instance
rollout also owes a shared (Redis/table) counter+throttle store; the current single-Railway-service
model makes the in-process counters correct for now.
