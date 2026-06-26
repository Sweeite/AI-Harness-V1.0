# Zoom-in: C7 Observability — "how you know what it's doing"

This opens up the **observability backbone** — the data + logic layer of the three pillars: **logging** (what
happened), **monitoring** (is it healthy now), **alerting** (tell me when something needs attention). C7 *is*
non-negotiable #3 made into a system. This map reflects the C7 resolutions (OD-067…074) and the verification-gate
hardening (AF-118…120). Where this map and a requirement disagree, the requirement wins and this map updates.

**Scope (what C7 owns):** the **`event_log`** · the **real-time-vs-polling** contract · **alerting** (the 7 rules +
routing + escalation + the watchdog) · the **cost meter + ladder signal** · the **management-plane cross-deployment
push** (Super Admin) · **log retention/export** (incl. the C7 side of `guardrail_log`).
**Seams out (what C7 does NOT own):** every dashboard **surface / layout / state / mobile design** → **Phase 3**;
each panel's **signal** is *produced elsewhere* and only *displayed* here — memory health → **C2**, connector status
→ **C3**, loop/queue/DLQ → **C5**, guardrail write-completeness → **C6**, agent health/drift → **C8**,
self-improvement *suggestions* → **C9**, answer-mode pill *content* → **C4**; the cost-ladder **enforcement
mechanism** (throttle/kill) → **C6 decides / C5 executes**; alert **routing rules** → **C1**.

## The three pillars (L3033-3039)

```
   LOGGING — the event_log: the unified append-only timeline (L3045-3064)         (LOG.001)
        │   8 event types · summary = plain-English "what + WHY", not bare tool name  (LOG.002)
        │   completeness: every task has a terminal event; a gap = silent-failure flag  (LOG.003, #3)
        │   duration_ms + cost_tokens per event · NO tokens/secrets in the log (C3)  (LOG.004/005)
        │   client_slug DROPPED intra-silo (single-tenant, ADR-001 §3)             (LOG.001.3 / OD-067)
        ▼
   MONITORING — hybrid real-time vs polling (L3068-3179)                          (RTP.001)
        │   Realtime (WebSocket) for the 2 trust-critical surfaces ONLY:
        │       approval queue + notification centre                              (RTP.001)
        │   polling everywhere else: health 30s · event-log 60s · memory 5m ·
        │       self-improve 10m · cost 5m · agent 60s — all configurable          (RTP.002, L3179)
        │   connection budget is PER-SILO (200/500 per project) → degrade to
        │       polling near the cap, never silently freeze                        (RTP.003 / OD-073, #3)
        ▼
   ALERTING — dashboard-first, Slack supplementary (L3288-3315)                   (ALR.001)
        │   notification centre persists read/unread until actioned               (ALR.001)
        │   7 rules, configurable: task-failure-spike · queue-backup · mem-confidence-drop ·
        │       approval-stale · HARD-LIMIT-HIT (immediate+always) · cost-breach · loop-missed  (ALR.002)
        │   route by type to the right person (C1 authority)                       (ALR.003)
        │   every alert logged in event_log                                        (ALR.004, #3)
        │   no-ack in window → secondary alert, never auto-cleared                 (ALR.005 / OD-069)
        │   dashboard notification PERSISTED independent of Slack (Slack = fan-out)  (ALR.006 / OD-070)
        │   C7 DELIVERS the alerts C5/C6 only emit (hard-limit, stale-approval)     (ALR.007)
        │   the alert engine itself is WATCHED — heartbeat + independent watchdog   (ALR.008, ⚠️ AF-118, #3)
```

## Cost: meter here, enforcement seamed (ADR-003, L3201/3321)

```
   C7 owns the METER (running spend) + the LADDER SIGNAL                          (COST.003 / OD-068, #2)
        │   estimate-grade: token × operator price-table, rounded UP · NEVER the invoice  (COST.001, ADR-001 boundary)
        │   per-task-type from day one                                            (COST.002)
        │   ladder: soft alert $50/d+$200/wk → throttle $75 → hard-kill $100        (COST.003, ADR-003)
        ▼
   C7 SIGNALS the breach → C6 DECIDES (cost-ladder guardrail class) → C5 EXECUTES throttle/kill
        │   the proven approval-gate decide/execute split; C7 never kills the run itself
        │   hard-kill → guardrail_log (rate_limit) + immediate alert (never silent)
        │   ⚠️ carry-forward: the C6 cost-ladder FR is OWED (ADR-003 spawned it, C6 didn't write it);
        │       C5's "C7 enforces" seam line corrected this session (change-control)
```

## Management plane — cross-deployment, PUSH only (ADR-001 §7, L3183-3203)

```
   per-deployment OUTBOUND health-reporter job → posts OPERATIONAL-METADATA-ONLY snapshots  (MGM.001)
        │   allow-list: health score · queue depth · alert counts · core version
        │   NO business data crosses ("a map, not a warehouse") · push, never pull   (MGM.001, #2)
        │   reporter logs each push attempt/failure to the LOCAL event_log too       (MGM.001.3, #3)
        ▼
   SUPER ADMIN view: deployment health grid · cross-deployment alerts · CI/CD status · cost overview  (MGM.003/004/005)
        │   card click-through → navigates INTO that client deployment (no mirror)    (MGM.003.2)
        │   STALE-NOT-GREEN: a snapshot past the staleness window → stale/unreachable + alert  (MGM.002 / OD-071, #3)
        │       evaluator runs on an INDEPENDENT heartbeat (the stale-detector can't itself stall)  (MGM.002.3, ⚠️ AF-118)
        │       window math = server-authoritative timestamp, never reporter clock    (MGM.002.4, ⚠️ AF-120)
        │   backup-health via Supabase Management API, remote, no business data        (MGM.005, ADR-008)
```

## Log retention + compliance erasure (OD-072 / OD-074)

```
   three DISTINCT append-only sinks: event_log (C7) · access_audit (C1) · guardrail_log (C6/view+retention=C7)  (LOG.007 / OD-065)
        │   each: per-deployment configurable retention + a FLOOR · never prune a referenced row · pruning logged  (LOG.006/007 / OD-072)
        ▼
   compliance erasure = REDACTION-TOMBSTONE (OD-074, user-decided)               (LOG.006.3 / LOG.007.4)
        │   scrub PII fields (summary · entity_ids · description) IN PLACE
        │   RETAIN the row + audit metadata → trail survives, subject unidentifiable
        │   guardrail export stays complete (no holes) · tamper-evident redaction
        │   ⚠️ carry-forward: C2 FR-2.MNT.017 must be AMENDED to reach these log sinks
```

## The surfaces are seamed to Phase 3 (the C7 scope call)

C7 specifies the observability **functions**; the five role dashboards (Super Admin · Operations · Manager ·
Standard User · Mobile) get only a thin "this view exists + is RBAC-routed + sources these signals" contract
(VIEW.001/002/003). **Full layout, every visual state, and the mobile interaction design → Phase 3 (Surfaces).**
Each panel's *signal* is produced by its home component — C7 guarantees the panel exists and is fed, it does not
recompute the signal. (Mirrors C6's "seam, don't absorb" call on the failure-mode map.)

## The three non-negotiables, applied to C7

- **#1 never lose knowledge** — log retention never prunes a referenced row (LOG.006) · erasure REDACTS not deletes,
  the audit trail survives (LOG.006.3/007.4) · cost meter records a `cost_unknown` sentinel, never a silent 0
  (LOG.004.1).
- **#2 never do what it shouldn't** — the cross-deployment push is operational-metadata-ONLY, enforced at the
  reporter (MGM.001, the ADR-001 boundary) · C7 signals but never itself throttles/kills (COST.003) · cost is an
  estimate, never read from the client's bill (COST.001).
- **#3 never fail silently** — the whole component IS this invariant: completeness gaps surface (LOG.003) · the log
  engine, alert engine, and stale-detector are all WATCHED (LOG.003.2 out-of-band · ALR.008 watchdog · MGM.002.3
  heartbeat) · alerts escalate, never auto-clear (ALR.005) · dashboard notifications survive a Slack outage
  (ALR.006) · stale-not-green (MGM.002) · degrade-don't-freeze (RTP.003/004).

## Open items C7 hands forward

- **AF-118** (absence-of-signal detection is only as live as its evaluator) · **AF-119** (out-of-band log-failure
  surface durability) · **AF-120** (cross-deployment clock-sync) — all build-time SPIKE/DOCS; none holds an FR from
  Approved-on-paper.
- **C2 FR-2.MNT.017 amendment** (OD-074): extend the transitive erasure walk to `event_log` + `guardrail_log`
  (redaction-tombstone) — change-control, owed to C2.
- **The C6 cost-ladder enforcement FR** (OD-068): ADR-003 spawned it, C6 (session 23) didn't write it — owed when
  C6 is next touched; C5's seam line corrected this session.
- Forward signals reserved for **C8** (agent health/drift, orchestrator confidence) and **C9** (Insight-Agent
  suggestions for the self-improvement panel) — C7 renders, they produce.
