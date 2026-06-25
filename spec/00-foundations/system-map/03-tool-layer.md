# Zoom-in: C3 Tool Layer — "how the AI reaches the outside world"

This opens up the **connector layer** between the harness and the client's real systems (GHL, Google,
Slack). It is the spec home of the **generic connector contract + shared tool runtime** (session-19 spine
decision) and reflects the C3 resolutions (OD-011, OD-039…046). Where this map and a requirement disagree,
the requirement wins and this map updates (change control).

**Scope:** the tool registry · the 3-layer OAuth token lifecycle · the rate-limit tracker + tiered backoff ·
external-data boundary-tagging · idempotent writes · the trigger model · watch re-arm + event-gap
reconciliation · connector disconnection/recovery. **Seams out:** webhook *authentication* → **C0**
(FR-0.WHK.*); memory *write* behaviour → **C2** (FR-2.WRT.*); approval-gate + hard-limit + high-risk-halt
*enforcement* → **C7**; health panels / alerts / event-logging *rendering* → **C8**; the agent path runs
as **`service_role`** with mid-task re-check → **C1** (FR-1.RLS.007); partial-write-chain compensation →
**C5/C6/C8** (+ OD-010).

## The spine — build the safety machinery ONCE (L1976)

```
  ┌──────────────────────  SHARED TOOL RUNTIME (built once)  ──────────────────────┐
  │ token refresh-and-PERSIST · rate-limit tracker + tiered backoff · boundary-tag  │
  │ idempotent safe re-run · watch re-arm · event-gap reconcile · disconnect/recover│
  └────────────────────────────────────┬───────────────────────────────────────────┘
       each connector supplies only PARAMETERS (fill-in-the-blanks):
       endpoints · field maps · transport · token TTL/rotation · minimal scopes · batch limits
                  │                      │                       │
              ┌───┴────┐            ┌────┴────┐             ┌────┴────┐
              │  GHL   │            │ Google  │             │  Slack  │   ← the first 3 INSTANCES,
              └────────┘            └─────────┘             └─────────┘     "not the limit" (L1976)
```
- **Why the spine matters:** the safety machinery lives in one place, so a new tool inherits it and the
  three non-negotiables **can't silently regress per tool** (FR-3.CONN.002).
- Each connector is read|write tools with a fixed contract shape (FR-3.CONN.001); the AI selects by the
  **plain-English description** (FR-3.REG.002), invokes through the runtime.

## OAuth tokens — the #1 "silently lose access" trap, closed in one place

```
  LAYER 1 proactive   job every 15 min refreshes tokens expiring <30 min        (FR-3.TOK.002)
  LAYER 2 reactive    on 401 → refresh + retry ONCE                             (FR-3.TOK.003)
  LAYER 3 re-auth     refresh DEAD → degraded → one-click dashboard OAuth       (FR-3.TOK.004)
        │                                                        target ~99% invisible (TOK.006)
  ROTATING REFRESH (the trap):  GHL rotates per-use (old dies) · Slack opt-in rotation
        │
   persist the NEW refresh token ATOMICALLY before using the new access token   (FR-3.TOK.005)
   refresh(HTTP) + persist(DB) are NOT one txn → if persist fails after rotation,
   retry within the vendor grace window (GHL 30s) else go degraded LOUDLY — never silent
```
- Tokens live **encrypted** (Vault); never in logs/env/UI/config (FR-3.TOK.001).
- Per-connector facts cite **dossiers, not the design doc**: GHL ~24h + rotating (TOK.008) · Google ~1h,
  **non-rotating**, 100-token cap (TOK.007) · Slack `xoxb` non-expiring, rotation OFF by default (TOK.009).

## Rate limits — graduated, never a silent stall (#3)

```
  check tracker BEFORE every call · update AFTER  =  source of truth   (FR-3.RL.002)
        │      (trust the more conservative of tracker vs vendor header; log divergence)
   80% ─► slow non-urgent / background; urgent + human + approval-gated proceed   (RL.003)
   95% ─► pause non-critical → DURABLE queue (survives restart) for post-reset    (RL.004)
  429 ─► exp backoff + jitter; honor Slack Retry-After EXACTLY                    (RL.005)
        │
   HIGH-RISK / irreversible-billed action rate-limited  ─►  HALT + ESCALATE,
        never auto-retry (excluded from the RL.005 path, regardless of urgency)   (RL.006 → C7)
  per-deployment tracker, physically isolated — no cross-client quota bleed       (RL.007, ADR-001)
```
- The real caps are **per-connector** (GHL 100/10s + 200k/day · Gmail QU model · Slack per-method tiers),
  seeded from the dossiers as config (RL.008); the 80/95% tiers are generic.

## Triggers, watches & the silent-loss holes the gate closed

```
  L1 dev infra:  handler + parser + error-handling built once per connector      (TRIG.001)
  L2 dashboard:  users map  event + condition → task,  no code                   (TRIG.002)
        │        default trigger set per connector, toggle per deployment        (TRIG.003)
  TRANSPORT + SIGNATURE per connector (homes OD-044 — "verified authenticated ingress"):
        GHL  native webhook · Ed25519 X-GHL-Signature (legacy RSA dies 2026-07-01)
        Google  Gmail Pub/Sub OIDC-JWT · Drive/Cal signed X-Goog-Channel-Token + TLS
        Slack  Events API · HMAC-SHA256 X-Slack-Signature (v0:ts:rawbody, ±300s)  (TRIG.004 → C0 auth)
        │
  ⚠ WATCHES EXPIRE with NO auto-renew (Gmail ~7d, Drive 1d/7d): proactive RE-ARM;
     a missed re-arm → DEGRADED + health-panel, never a silent quiet channel     (TRIG.005)  ◄ HIGH gate-find
  ⚠ EVENTS get DROPPED (Slack auto-disable >95%/60min, >2h-late, no backfill):
     detect the gap + reconcile via conversations.history from the watermark      (TRIG.006)  ◄ HIGH gate-find
```

## Reads & writes — boundary-tag in, draft-to-approval out

```
  OBS (read)   GHL CRM · Slack+Gmail comms · Drive docs · Calendar     (OBS.001-004)
        │      EVERY read is boundary-tagged UNTRUSTED at ingestion (fail-closed)  (CONN.003, ADR-007)
        │      golden rule: store source_ref POINTER, never copy the source       (ADR-008)
        ▼ feeds C2 ingestion (FR-2.ING.*) + live cross-check (FR-2.MNT.011)

  ACT (write)  every external write is IDEMPOTENT — durable intent record BEFORE the call  (CONN.004)
        GHL  /contacts/upsert · tag · note · move-stage · send (irreversible+billed → send-once)  (ACT.003)
        Slack post · EMAIL → draft to approval queue, never autonomous              (ACT.004, hard-limit #1)
        Drive create/append (no autonomous delete)                                  (ACT.005, hard-limit #3)
        Calendar invite → DRAFT to approval, never send direct                      (ACT.006)
        memory-write tool is REGISTERED here but OWNED by C2 (sole writer)          (ACT.007 → C2)
```

## The seven hard limits — code gates, not prompt rules (ADR-007)

```
  no autonomous external email · no financial txn · no delete-of-record · no cross-client share ·
  no impersonation · no self-approval · no tool-content-as-instructions          (FR-3.ACT.002, L2053-2066)
        │  no role / config / instruction can override — they bind even service_role
  WHERE each is actually enforced (honest seam):
     email→draft (ACT.004) · calendar→draft (ACT.006) · cross-client→physical isolation (ADR-001) ·
     injection→boundary tag (CONN.003) · delete→scope-grant excludes it (CONN.005.3) + C7
     ⚠ financial + impersonation have NO C3 mechanism — wholly C7 + the AF-068 red-team
```

## Disconnection & recovery — pause, never abandon (#1/#3)

```
  detect → classify system-wide vs individual                                    (DSC.001)
  surface: non-dismissible MODAL (Admin/SuperAdmin) vs BANNER (standard user)     (DSC.002)
  reconnect → AUTO-RESUME paused tasks + audit;  re-check authorization (FR-1.RLS.007)
              before the first post-resume consequential side effect              (DSC.003)
  paused-task set + escalation clock PERSISTED across restart (no silent abandon) (DSC.003/004)
  unresolved past 24h → escalate Super Admin                                      (DSC.004)
  health panel: status · last call · token expiry · WATCH expiry  (emit → C8)     (DSC.005)
  alerts: refresh-token <7d → owner · degraded → modal · unresolved → Super Admin (DSC.006 → C8)
  missing tool → complete-what-it-can + FLAG the gap (structured, mandatory-read), never silent-partial (OPT.004)
```

## Non-negotiables, mapped

- **#1 (never lose/corrupt knowledge):** rotating-refresh atomic persist (TOK.005/008); golden-rule
  pointers not copies; paused tasks persisted + resumed; watch re-arm + event-gap reconcile prevent silent
  ingest loss.
- **#2 (never do what it shouldn't):** minimal scopes (CONN.005) incl. no delete-grant; the 7 code-enforced
  hard limits (ACT.002); email/calendar draft-to-approval; high-risk rate-limit halts not retries (RL.006);
  boundary-tag fail-closed (CONN.003).
- **#3 (never fail silently):** check-before/update-after with conservative reconciliation (RL.002);
  degraded states surfaced loudly; missed watch/dropped event detected + reconciled; graceful degradation
  flags the gap; alert-delivery failure itself surfaced.

## Feasibility residuals (paper-until-proven) — Block N

**Viability gates (hold specific FRs from build):** AF-083 (Slack internal-app Tier-3 exemption — history
ingest) · AF-090 (GHL Ed25519 signing input) · AF-098 (GHL PHI/BAA chain). Plus AF-084 (Slack event-gap
reconciliation) · AF-085 (Slack write-dedup) · AF-089 (GHL rotation under the 30s race) · AF-093 (GHL 429
backoff) · AF-095 (GHL no idempotency key) · AF-101 (Drive/Calendar quota numbers) · AF-102 (Calendar 409
dedup) · AF-106/107/108/109/110 (Google refresh/client-deletion/watch/OIDC/policy) · AF-068 (the containment
red-team that the hard limits ultimately rest on). Carry-in: OD-010 (partial-chain compensation) at C5/C6/C8.
