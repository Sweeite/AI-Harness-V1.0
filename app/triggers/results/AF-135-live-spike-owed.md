# AF-135 — deployment-freeze propagation completeness: LIVE spike still OWED (operator-present)

**Status: NOT proven offline. The completeness AC MUST NOT be marked proven by this package.**

`feasibility-register.md` AF-135 is an **UNRUN, launch-gating SPIKE** (method: SPIKE, not DOCS). Its claim is
that the freeze gate is checked at **every** dispatch site with **no path slipping through**, verified against
a **real** frozen test deployment.

## What this package DID prove (offline, in `src/triggers.test.ts`)

The `AF-135 (offline)` test asserts the *code-level* completeness of the gate: every dispatch path in this
slice — `event` trigger, `scheduled` loop, `human`/manual task, `chained` successor, verified-event ingest,
and a queued-task run — routes through the single `assertNotFrozen` choke point, and under a freeze each one
(a) throws `ERR_FROZEN`, (b) creates no `task_queue` row, and (c) logs exactly one `dispatch_frozen_blocked`
event. A negative control proves the block is the freeze, not a dead path. Status-resolution **ambiguity**
(an unresolvable `deployment_settings` read) fails closed too (AC-NFR-INF.012.2).

## What is STILL OWED — the LIVE spike (operator-present; `full` env only)

The offline test proves the paths *this package knows about* are gated. The SPIKE's real claim can only be
closed against live infra:

1. Freeze a **real** test deployment (write `deployment_settings.frozen_at` via the custodied `service_role`
   key, ADR-001 §7 / FR-10.OFF.004) and confirm the flag reads back **locally** (OD-162, no cross-deployment
   query).
2. Attempt **every** live dispatch path — including the ones outside this package's boundary: an **Inngest**
   job, all three **loops** (ISSUE-051 LOP), and a manual dashboard action — and confirm each is blocked +
   logged. AF-135's own text names "Inngest jobs, triggers, all three loops, manual actions"; a path built in
   another slice (e.g. the loop layer) cannot be exercised from here.
3. Confirm a status-resolution ambiguity against the real DB also fails closed.

**Owed to:** a `full` (Mac / Remote Control) operator-present session — a `cloud`/`limited` env cannot write to
a silo or run the engine. Until it is GREEN in `feasibility-register.md`, AC-5.TRG.001.3 / AC-NFR-INF.012.1-.2
are **proven-on-paper + code-unit only**, not launch-cleared.

## Design-fork check (per the issue note)

Every dispatch path reachable from this slice **can** be gated — no path was found that structurally cannot
route `assertNotFrozen`. So there is **no design fork / blocker** to log from the offline build. The only open
item is the runtime completeness across cross-slice paths (Inngest/loops), which is exactly what the LIVE
spike closes. If the live spike finds a path that cannot be gated, THAT is the design fork (log an OD, do not
code around it) — but nothing offline forces that conclusion.
