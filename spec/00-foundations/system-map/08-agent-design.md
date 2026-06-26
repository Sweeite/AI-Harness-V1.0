# Zoom-in: C8 Agent Design — "who does the work"

This opens up the **routing + agent-definition layer**: one **orchestrator** that routes-and-plans-only, a roster of
**specialist agents** each owning one domain, the **agent registry** that makes them data-driven, the **memory-scoping**
matrix, **per-step failure-mode assignment**, and the **agent-health / drift / dead-agent** metric *production*. This
map reflects the C8 resolutions (OD-075…OD-081) and the verification-gate hardening (the H1 scope-wiring + AF-121…126).
Where this map and a requirement disagree, the requirement wins and this map updates.

**Scope (what C8 owns):** the **orchestrator + 7-step routing** · the **`agents` registry** (minus `system_prompt`,
now `prompt_layers`) · the **8 specialist definitions** + their hard limits · **per-agent memory scope** · **per-step
failure-mode ASSIGNMENT** · **agent-health / drift / dead-agent metric PRODUCTION** · **orchestrator learning + result
caching** · **cost-routing by complexity** + the confidence dial.
**Seams out (what C8 does NOT own):** the **context envelope** mechanism + retry/skip/halt **execution** + parallel /
warm-up / checkpoints → **C5**; **self-healing** mechanisms → **C2/C3/C5**; the **dashboards** → **C7 + Phase 3**;
self-improvement **suggestion generation** → **C9**; cost **metering** → **C7**, cost-ladder **enforcement** → **C6
decides / C5 executes**; Layer-1 **content** + `prompt_layers` versioning → **C4**; **RBAC + clearance** → **C1**.

## The orchestrator — routes and plans only (L3383-3419)

```
   TASK at queue front → RBAC + sensitivity clearance check (C1)                 (ORC.001 precondition)
        │   orchestrator runs service_role; its OWN memory scope = semantic + entity model + tool registry (ORC.008)
        │   crash mid-route (dequeue→plan-persist) → idempotent re-route, never dequeued-but-unplanned (ORC.001.3 / H2, #3)
        ▼
   7-STEP ROUTING (description-driven, NOT hardcoded — "the most important thing", L3419)
        │   1 arrive · 2 CLASSIFY (domain/complexity/context/output)              (ORC.002)
        │   3 READ REGISTRY — route by description; vague description = wrong routing  (ORC.003)
        │   4 SCORE candidates (domain/complexity/memory/tool fit, weights configurable)  (ORC.004)
        │   5 BUILD PLAN — single | ordered chain w/ deps + parallel marked; failure mode on EVERY step  (ORC.005)
        │   6 CONFIDENCE CHECK — below threshold (0.75) → human clarification        (ORC.006)
        │        unanswered clarification ESCALATES on timeout, never parks/auto-proceeds  (ORC.006.2 / OD-077, #3)
        │   7 VERSION + LOG plan; track outcome → feeds learning                     (ORC.007)
        ▼
   plan written into the context envelope's execution_plan (C5 owns the envelope) → C5 EXECUTES   (ORC.005.3)
```

## The registry — data-driven, discoverable, versioned (L3497-3519)

```
   agents table: id · name · description · memory_scope(json) · tools_allowed(uuid[]) · max_tokens ·
        │         enabled · version · created_by · previous_version_id · change_reason            (REG.001)
        │   system_prompt REMOVED → Layer 1 resolves from prompt_layers by agent_id  (REG.002 / OD-075, closes OD-048)
        │   client_slug DROPPED intra-silo (single-tenant, ADR-001 §3, mirrors C7 OD-067)  (REG.001.3)
        │   add a specialist = insert a row → orchestrator auto-discovers, no code change  (REG.003)
        │   every change: mandatory change_reason + immutable previous_version + audit  (REG.004)
        │   enabled=false → retained but never a routing candidate                   (REG.005)
        ▼
   SEED at provisioning: orchestrator + 8 specialists, idempotent, editable after (ADR-005, mirrors C1 OD-030)  (REG.006 / OD-079)
        │   AUTHORITY split (OD-080, #2): memory_scope/tools_allowed/enabled = SUPER ADMIN only;
        │       description/routing-weight tuning = Super Admin + Admin
```

## The 8 specialists + their hard limits (L3423-3439)

```
   Research   → read-only, called FIRST in any gathering chain                     (SPC.002)
   Client     → client/contact relationship work
   Campaign   → active campaign work
   Comms      → drafts external comms; NEVER sends autonomously → approval queue    (SPC.003, #2)
   Ops        → internal ops, SOPs, Internal Org
   Memory     → THE sole agent identity for the C2 write flow; others hand off raw events  (SPC.005 / ADR-004, #1)
   Finance    → read-heavy; NEVER initiates transactions; Confidential finance-scope  (SPC.004, #2)
   Insight    → slow loop only, read-all no-write → feeds C9 + self-improvement      (SPC.006)
        │   Comms/Finance limits = 3-layer defense: prompt (SPC) + missing tool (C3) + hard limit (C6)
        │   adding a send tool to Comms / a transaction tool to Finance is REJECTED at write  (SPC.003.3/004.3 / M6, #2)
```

## Memory scoping — the agent-level least-privilege boundary (L3464-3479)

```
   each agent's memory_scope = an ADDITIONAL retrieval filter on top of clearance   (SCO.001)
        │   the matrix: Research read-all · Client sem+epi · Campaign sem+epi+proc · Comms sem ·
        │       Ops proc+sem+InternalOrg · Memory full r/w · Finance sem finance-only · Insight read-all ·
        │       Orchestrator sem+entity+tool-registry
        │   ⭐ WIRED (OD-081, gate H1): the run pipeline passes the agent's scope into the C2 read —
        │       C5 AC-5.ASM.006.2 (fail-closed) + C2 AC-2.RET.004.2 (narrow within clearance)        (#2)
        │   sensitivity clearance applies ON TOP; Restricted never auto-injected even for read-all agents  (SCO.002)
        │   scope is registry DATA, not code (SCO.003)
```

## Failure handling, health, learning, cost

```
   FAILURE MODE per step assigned UPFRONT (retry/skip/halt) — never at failure time  (PLAN.001)
        │   no mode → default HALT-AND-ESCALATE (fail safe, #3)                      (PLAN.002)
        │   unattended halt inherits the staleness-escalation guarantee              (PLAN.002.2 / L10, #3)
        │   chain-depth limit enforced at BUILD (default 6), not mid-run             (PLAN.003)
        │   plans VERSIONED per task type; rollback is HUMAN-decided (auto deferred OOS-030)  (PLAN.004 / OD-010)
   ── C5 EXECUTES the assigned mode (retry-backoff / skip+log / halt+escalate) ──    (seam)

   METRICS produced here, surfaced (C7) + acted-on (C9 + human) elsewhere           (HLTH.004)
        │   agent health (success/failure/last-run)                                 (HLTH.001)
        │   specialisation DRIFT → flagged, NEVER auto-corrected (L3563)             (HLTH.002 / OD-078, ⚠️ AF-123)
        │   DEAD-AGENT → flagged, NEVER auto-disabled                                (HLTH.003 / OD-078, ⚠️ AF-124)
        │   a stalled metric PRODUCER is itself surfaced — never last-known-good green  (HLTH.004.2 / H3, #3)

   ORCHESTRATOR LEARNING — outcome → routing refinement                             (LRN.001, ⚠️ AF-126)
        │   routing-mismatch metric (consistently rerouted → description signal)     (LRN.002)
        │   result CACHE: per-agent window AND scope-aware invalidation — write-triggered by
        │       the Memory Agent commit; miss-on-uncertainty; NEVER a stale hit       (LRN.003 / OD-076, ⚠️ AF-125, #1)

   COST routing: single | two-agent | full chain — prefer cheapest that fits        (COST.001)
        │   confidence threshold = highest-leverage cost/quality dial (L3620)         (COST.002, ⚠️ AF-122)
        │   emit per-route cost shape → C7 meters, C6 ladder enforces (OD-068 owed)   (COST.003)
```

## The three non-negotiables, applied to C8

- **#1 never lose/corrupt knowledge** — the Memory Agent is the *sole* writer identity (SPC.005, ADR-004) · the
  result cache invalidates on any in-scope write + misses-on-uncertainty (LRN.003) · `prompt_layers` is the single
  Layer-1 store, no dual `system_prompt` (REG.002).
- **#2 never do what it shouldn't** — capability edits (scope/tools) are Super-Admin-gated (OD-080) · Comms/Finance
  hard limits are 3-layer + reject-grant-at-write (SPC.003/004) · per-agent scope is a *real* retrieval filter, wired
  into C5/C2 (SCO.001 / OD-081) — most load-bearing for the `service_role` orchestrator.
- **#3 never fail silently** — orchestrator crash → idempotent re-route (ORC.001.3) · low-confidence clarification
  escalates (ORC.006.2) · default halt-and-escalate (PLAN.002) · stalled metric producers surface (HLTH.004.2) ·
  drift/dead-agent flagged not hidden (HLTH.002/003).

## Open items C8 hands forward

- **AF-121…126** (routing accuracy · confidence calibration · drift detection · dead-agent signal · cache staleness ·
  learning-improves-routing) — all build-time EVAL/SPIKE; **none holds an FR from Approved-on-paper**.
- **The C6 cost-ladder enforcement FR** (OD-068): ADR-003 spawned it, C6 didn't write it — C8 feeds it but the
  throttle/kill enforcer is still owed when C6 is next touched.
- **C9 (Proactive Intelligence)** consumes the Insight-Agent output + C8's routing/health metrics to generate the
  self-improvement *suggestions*; **Phase 3** renders the self-improvement panel + registry editor + clarification UI.
