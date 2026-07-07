---
id: ISSUE-034
title: Rate limiting — tracker + 80/95/429 tiers + high-risk halt-escalate
epic: D — tool layer
status: done
github: "#34"
---

# ISSUE-034 — Rate limiting — tracker + 80/95/429 tiers + high-risk halt-escalate

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Build the shared-runtime rate-limit subsystem — a `rate_limit_tracker` as the source of truth, the graduated 80% / 95% / 429 backoff tiers, and the high-risk halt-and-escalate rule — so no connector can silently over-call a vendor or auto-retry a consequential action.

## 2. Scope — in / out
**In:** The generic (connector-agnostic) rate-limit machinery that lives once in the shared tool runtime (FR-3.CONN.002): the tracker table + read/write source-of-truth discipline; the three graduated tiers (80% slow-non-urgent, 95% pause-and-persist-queue, 429 exponential-backoff-with-jitter honoring `Retry-After`); the high-risk/irreversible-write halt-and-escalate branch (the rule; the escalation *machinery* is C6's); per-deployment physical tracker isolation; and the per-connector config surface for limits/threshold/backoff. Vendor-real caps are seeded from the dossiers as config values, not hard-coded.
**Out:** OAuth token refresh/persist (ISSUE-033, C3 TOK). Per-connector *instances* that supply real cap numbers + `Retry-After` behavior (GHL → ISSUE-039, Google → ISSUE-040, Slack → ISSUE-041). The C6 escalation/approval machinery + the cost-ladder decision/kill this seams into (ISSUE-058, C6 RTL). The C7 dashboard/health-panel that *surfaces* rate-limit status (ISSUE-076 RTP / ISSUE-078 ops dashboards) — this slice only *emits* the events. Idempotency-guard implementation itself (ISSUE-032, FR-3.CONN.004) — this slice *consumes* it on queue-drain.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-3.RL.001, FR-3.RL.002, FR-3.RL.003, FR-3.RL.004, FR-3.RL.005, FR-3.RL.006, FR-3.RL.007, FR-3.RL.008 (Component 3 — Tool Layer).
- **NFRs:** none owned here. (The rate-limit → cost-ladder NFR posture — NFR-COST.002/003, "escalate-don't-abandon" — is owned by ISSUE-058/074, which are blocked-by this issue; the halt-escalate rule here is their upstream hook.)
- **Rests on:** ADR-001 (physical per-client isolation → FR-3.RL.007), ADR-004 (idempotency on queue-drain), ADR-007 (containment → high-risk halt-escalate); dossiers gohighlevel.md §3, slack.md §3, google-gmail.md §3 (real caps + `Retry-After` facts — cited by the FRs, seeded as config).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-3.RL.001.1
- AC-3.RL.002.1, AC-3.RL.002.2
- AC-3.RL.003.1
- AC-3.RL.004.1, AC-3.RL.004.2
- AC-3.RL.005.1, AC-3.RL.005.2
- AC-3.RL.006.1, AC-3.RL.006.2
- AC-3.RL.007.1
- AC-3.RL.008.1
- **Gating spikes (if any):** none launch-gating. Note three build-time feasibility items attached to FR-3.RL.005 that must be resolved as the caps/backoff are wired (they scope *per-connector* backoff, so they finalize under ISSUE-039/040/041, not here): AF-093 (GHL outbound 429 has no documented `Retry-After` → app-side backoff), AF-104 (Google jitter is our addition, not vendor-mandated), AF-086 (Slack quota-introspection headers beyond `Retry-After`). Build the generic backoff so it degrades safely when no `Retry-After` is present.

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-rate_limit_tracker (owned/created by this slice — connector, window_label, window_start, window_duration, call_limit, calls_made, reset_at; unique(connector, window_label)); DATA-idempotency_ledger (read-only, on 95%-queue drain per FR-3.RL.004 → FR-3.CONN.004).
- **PERM:** PERM-tool.manage (Admin/Super-Admin, homed in C1 — gates the FR-3.RL.008 config edits). Runtime rate-limit checks run on the `service_role` agent path (no per-tool RLS gate).
- **CFG:** CFG-rate_max_calls_per_connector_window, CFG-rate_alert_threshold (0.80), CFG-backoff_initial_ms (1000), CFG-backoff_max_ms (60000), CFG-backoff_multiplier (2).
- **UI:** none in this slice (rate-limit status is *emitted* to event_log; the health-panel/dashboard that renders it is ISSUE-076/078). Config edits land on the config-admin surface (ISSUE-086).
- **Connectors:** none instantiated here — generic runtime only (real caps/`Retry-After` supplied by ISSUE-039/040/041).

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-03-tool-layer.md — the RL FR text + ACs (FR-3.RL.001–008); also FR-3.CONN.002 (why this lives once in the runtime) and FR-3.RL.006's seam note to C6.
- spec/04-data-model/schema.md §4 (Tools & Connectors) — the `rate_limit_tracker` + `idempotency_ledger` DDL.
- spec/00-foundations/adr/ADR-001-*.md — physical per-client isolation (FR-3.RL.007).
- spec/00-foundations/adr/ADR-004-*.md — idempotency semantics consumed on queue-drain (FR-3.RL.004).
- spec/00-foundations/adr/ADR-007-*.md — containment-first; the high-risk halt-and-escalate posture (FR-3.RL.006).
- spec/00-foundations/tool-integrations/gohighlevel.md §3, slack.md §3, google-gmail.md §3 — the real caps + `Retry-After` facts the FRs cite (seed config values from these, never the design doc).

## 7. Dependencies
- **Blocked-by:** ISSUE-032 (connector contract + shared runtime + tool registry — this rate-limit machinery is built *into* that runtime per FR-3.CONN.002, and reads `tools.risk_level` from the registry to classify FR-3.RL.006). Not a spike — no AF-GREEN gate.
- **Blocks:** ISSUE-039, ISSUE-040, ISSUE-041 (the three connector instances that supply real caps + honor real `Retry-After` on top of this generic tracker), ISSUE-058 (C6 rate-limit guardrails + cost-ladder — consumes the halt-escalate hook defined here).

## 8. Build order within the slice
1. **Migration:** add `rate_limit_tracker` to the C3 schema group (schema.md §4) via the expand-contract harness — connector + window_label composite key so a connector with multiple windows (e.g. GHL 100/10s burst *and* 200k/day) gets a row per window (FR-3.RL.001). `idempotency_ledger` already exists from ISSUE-032; no new table there.
2. **Isolation posture:** confirm the tracker lives only in the client silo — no `client_slug`/cross-client predicate, no shared/global ledger (FR-3.RL.007; mirrors FR-3.REG.004). This is an assertion + a test, not code.
3. **Source-of-truth core:** the runtime's before-call check / after-call increment against the tracker, with vendor-header reconciliation choosing the *conservative* value and logging divergence (FR-3.RL.002). Everything below reads this.
4. **Config wiring:** surface CFG-rate_max_calls_per_connector_window, CFG-rate_alert_threshold, CFG-backoff_initial_ms/max_ms/multiplier as live, per-connector, no-redeploy config, seeded from the dossiers; validate a configured limit against the dossier-pinned cap (FR-3.RL.008).
5. **Graduated tiers (read the tracker % from step 3):** 80% → slow/deprioritise non-urgent while urgent/human/approval-gated proceed, urgency an explicit call attribute not inferred (FR-3.RL.003); 95% → pause non-critical and enqueue for post-`reset_at` on a **persisted** queue that survives restart, and on drain **re-consult the idempotency guard** before re-firing any write (FR-3.RL.004 → FR-3.CONN.004); 429 → exponential backoff with jitter capped at CFG-backoff_max_ms, honoring `Retry-After` exactly when present (FR-3.RL.005).
6. **High-risk branch:** route any `risk_level=high` *or* irreversible/billed external write (e.g. a GHL send) to halt-and-escalate, **excluded** from the 429 auto-retry path, regardless of urgency; C3 raises the halt + emits the escalation event, C6 (ISSUE-058) owns the escalation machinery — do not implement the approval queue here (FR-3.RL.006).
7. **Observability hook:** emit throttle-engaged / pause+queued-count / 429+backoff / halt+escalation events to `event_log` (C7 surfaces them; this slice only emits) — the loud-not-silent path for #3.
8. **Tests to the ACs:** cover each tier boundary, the conservative-reconciliation rule, the persisted-queue-survives-restart + idempotent-drain path, and the high-risk-excluded-from-auto-retry rule (the AC list in field 4).

## 9. Verification (how DoD is proven)
- Per spec/05-non-functional/test-strategy.md: integration tests against a stubbed connector for the tracker source-of-truth + tier transitions (80/95/429) + conservative-header reconciliation; a restart/crash test proving the 95% queue is durable and drains without double-firing a write (FR-3.RL.004 → idempotency_ledger); a unit/property test that a high-risk or irreversible/billed action is never placed on the auto-retry path (FR-3.RL.006, AC-3.RL.006.2).
- No `AC-NFR-*` posture is owned by this slice; the "never fail silently" (#3) invariant is proven by asserting every tier decision (throttle/pause/backoff/halt) writes a loud `event_log` entry and the high-risk halt raises an escalation event that C6 (ISSUE-058) is verified to consume. AF-093 / AF-104 / AF-086 are resolved when the per-connector backoff is finalized under ISSUE-039/040/041; the generic backoff here must be safe with no `Retry-After` present.
