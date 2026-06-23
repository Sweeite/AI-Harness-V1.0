# Failure Overlay — the shadow map (what goes wrong at each step, and what catches it)

The overview (`../system-map.md`) is the happy path. This is its shadow: at every step, what can
go wrong and the mechanism that handles it. **This is where most of the engineering — and most of
the "great vs good" — actually lives.** Cites are design-doc lines / ADRs. `🔴` = a known gap.

```
STEP                     WHAT GOES WRONG                 CAUGHT BY
─────────────────────────────────────────────────────────────────────────────────────
1 Trigger fires          missed / dropped trigger        loop heartbeat + catch-up (L2852)
                         duplicate / concurrent          idempotency keys (ADR-004)
                         spoofed webhook                 signature verification (L740)
                         injection in the content        injection pipeline + hard limit (L2916, ADR-007*)

2 Access check           unauthorized / over-scope       RBAC default-deny + RLS (L420, L717)
                         automated trigger, no human     system-actor permissions (Phase-1 detail)
                         session expires mid-task        server-side task continues (L703)

3 Task queued            overload / queue backup         rate limits + backup alert (L2807, L3296)
                         poison task (keeps failing)     dead-letter queue after N (L2585)
                         lost task                       durable queue + Inngest (L2664)

4 Context assembled      thin / no memory                [Building] / [Unknown] (ADR-002)
                         wrong memory retrieved          ranking + relevance cross-check (L1829)
                         sensitive leak into context     sensitivity+visibility filter BEFORE rank (L1723)
                         stale memory                    decay + live cross-check (L1800, L1829)

5 Safety gate            disallowed action attempted     hard limit enforced in code (L2053)
                         anomalous behaviour             anomaly detection halts pre-step (L2791)
                         needs human sign-off            approval queue; escalation always resolves (L2881)
                         cost runaway                    cost ladder: throttle → kill (ADR-003)

6 Work happens           routed to wrong agent           confidence threshold + routing log (L2846)
                         an agent step fails             per-step retry / skip / halt (L3483)
                         chain too deep / pricey         chain-depth limit (ADR-003)
                         agent drifts out of scope       drift / dead-agent detection (L2847)

7 Act + remember         connector down mid-task         graceful degradation + disconnection flow (L2109, L2301)
                         3rd-party rate limit hit        backoff ladder; halt high-risk action (L2159)
                         write "succeeded" but no-op      said-vs-did cross-check (L2841)
                         concurrent same-entity writes   per-entity serialize + commit (ADR-004)
                  🔴     chain already emailed/updated,   no compensation/rollback story yet
                         then a later step halts         → OD-010

8 Answer + provenance    inference presented as fact     answer-mode pill, never fact (L1755)
                         wrong-but-confident output      output validation flag (L2827)
                         no provenance shown             pill always present, no exception (L1757)

CONTINUOUS               loop silently stops             heartbeat monitoring + alert (L2852)
                         memory erodes unnoticed         erosion detection (4 kinds) (L1819)
                  🔴     client data lost / corrupted    backup & DR undefined → OD-009
```

`*` ADR-007 (injection posture) is still open — the code-level hard limit holds regardless; the
detection layer is being decided.

## How to read this with the happy-path map

Put this next to `../system-map.md`. The happy path tells you what the system *does*; this tells
you what makes it *trustworthy*. When we simulate a scenario (the technique in `system-map.md`),
this overlay is the checklist of failure modes to probe at each step — and any failure mode here
without a named mechanism is a requirement we still owe.
