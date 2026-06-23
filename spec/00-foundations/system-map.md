# System Map — how the whole thing fits together

> **Purpose.** This is the *top-down* view the rest of the spec doesn't give you: what the
> system looks like and how a request flows through it end to end. It exists so the system is
> never "blank in your head" — you read the map instead of recalling it. It's also the **canvas
> for finding requirements**: walk a scenario down the map and every "what about X?" becomes a
> tracked decision. Living doc — grows as the spec does.

## The route a request takes (the "drive")

One trip through the system, top to bottom. Eleven components, one route.

```
  loops (C5) fire on a clock ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┐  (this is what starts most trips)
                                                   ▼
  1. TRIGGER FIRES         event · schedule · human · chained          C5
        ↓
  2. ACCESS CHECK          who gets in, what they may touch            C0 · C1
        ↓
  3. TASK QUEUED           priority · retry · audit trail              C5
        ↓
  4. CONTEXT ASSEMBLED     memory read + 4-layer prompt                C2 · C4
        ↓
  5. SAFETY GATE           hard limits · anomaly · approval            C6
        ↓
  6. WORK HAPPENS          orchestrator routes to specialists          C8
        ↓
  7. ACT + REMEMBER        tools act on the world · memory written     C3 · C2
        ↓
  8. ANSWER + PROVENANCE   tagged cited · inferred · unknown           (output)

  ── running continuously, around the route ──────────────────────────────
   observability (C7) logs & watches every step
   proactive intelligence (C9) does work nobody asked for, on the slow loop
  ── the foundation everything sits on ───────────────────────────────────
   infrastructure & compliance (C10)
```

### Plain-words walkthrough
Something **wakes the system up** (1) — a new CRM lead, a scheduled job, a chat message. It
checks **who this is and what they may touch** (2). The job is **written to a queue** (3) so it
can be retried, rate-limited, and audited rather than run on the spot. The system **gathers what
it knows** (4): relevant memories about the entities involved, wrapped with the agent's identity
and the task. It hits a **safety gate** (5) — allowed? anomalous? needs human approval? If it
passes, **the work happens** (6): an orchestrator routes to the right specialist agents. They
**act on the outside world and write back what they learned** (7). Finally an **answer comes out
stamped with where it came from** (8). Around all of it: **loops** keep firing (creating new
trips), **observability** watches everything, **proactive intelligence** runs on the slow loop —
all on the **infrastructure & compliance** foundation.

## The components

```
C0  Login & authentication     who gets in
C1  RBAC                        what they can do
C2  Memory                      what the AI knows          → zoom-in: system-map/02-memory.md
C3  Tool layer                  what the AI can do
C4  Prompt architecture         what the AI is
C5  Agent harness               what makes it run
C6  Guardrails                  what keeps it safe
C7  Observability               how you know it's working
C8  Agent design                who does the work
C9  Proactive intelligence      what it does unasked
C10 Infrastructure & compliance the operational/legal layer underneath
```

Each component gets its own **zoom-in map** (see `system-map/`). Built per component as we spec
it, so the map never drifts from the requirements.

## How to use this map to find requirements (the simulation technique)

Pick a real scenario. Walk it **down the route, stage by stage**, asking at each step: *"what do
I expect here, and what could go wrong?"* Every answer is a requirement or an edge case — say it,
and it gets logged as an OD or an AF. This is how what's "in your head" gets onto paper.

**Worked example — a new lead lands in GHL:**
- 1 trigger — *two leads in the same second?* → concurrent-trigger edge case
- 2 access — *a lead isn't a user; whose permissions apply to an automated trigger?* → system-actor permissions
- 4 context — *brand-new lead, zero memories* → cold-entity case (the `[Building]` flag, ADR-002)
- 5 safety — *AI wants to email the lead* → must hit approval queue, never auto-send
- 7 act — *GHL is down when it writes back* → connector-failure / graceful-degradation case

Five minutes, one scenario, five requirements that were previously only in your head.

> Anxious or can't picture it? See `working-with-me.md` — or just say **"ground me."**
