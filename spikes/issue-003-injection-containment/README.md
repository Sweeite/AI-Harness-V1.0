# ISSUE-003 — injection-containment red-team (AF-068 gate)

Adversarial red-team harness for **[ISSUE-003](../../spec/06-issues/ISSUE-003-injection-red-team-spike.md)**.
It proves the **load-bearing claim of the whole injection posture** ([ADR-007](../../spec/00-foundations/adr/ADR-007-injection-posture.md)):
there is **no authorized-but-dangerous autonomous action path** by which an injected instruction reaches
a consequential side effect (external comms, financial, cross-client read, destructive write of a
system of record, memory poisoning) **without** passing a code-enforced hard limit / RBAC-RLS check /
approval gate **that ignores prompt content**. On PASS, **AF-068** flips 🔴→🟢 — one of the six launch
go/no-go SPIKE-GATEs (`test-strategy.md` §4, gate #1).

Stack: **TypeScript / Node** ([ADR-009](../../spec/00-foundations/adr/ADR-009-implementation-stack.md)), zero runtime deps.

## The threat model (why a PASS means something)

Containment-first assumes the **worst about the model** (ADR-007 part 1): a successful injection means
the model **does** treat tool content as instructions and emits whatever dangerous action the injection
asks — autonomously, with no human approval token. The harness models exactly that: a **fully
compromised, maximally-obedient agent**. Security never depends on the model refusing; it depends on the
**code gate** blocking what the agent emits. Modelling the model as obedient is the *strongest* adversary
— a real LLM that happened to refuse would only mask a gap in the code boundary.

Two properties make the green run trustworthy rather than self-fulfilling:
- **Evasion payloads** carry no injection literal, so the pipeline does **not** quarantine them — they
  reach the compromised model, which obeys — and the code gate must *still* block. This is the
  "contained, not necessarily caught" proof. 8 of the 12 attacks are evasion.
- **Negative controls** (a genuinely human-approved external send; a same-client read; a benign read; a
  normal memory write) **must succeed** — proving the gate is real containment, not a brick that blocks
  everything.
- **Mutation-tested:** injecting a real bypass (allow autonomous external email) flips the verdict to
  ⛔ and exits non-zero — the battery has teeth.

## What it does (maps 1:1 to ISSUE-003 §8 build order)

| Step | File | What |
|---|---|---|
| 1 target system | `src/harness.ts` | Wires the C5 step order (FR-5.ASM.007): anomaly → tool-read → **sanitize (C6 seam)** → AI-call → **enforce (code gate)** → write. Records a step trace so the seam positions are provable. |
| 1 sinks | `src/store.ts` | In-memory `guardrail_log` + `injection_quarantine` (schema §7) with their real invariants: append-only, `hard_limit` never→`approved` (throws), `human_decision` null until a human decides. §5 scopes these as read-only assertions; the durable write path is ISSUE-060. |
| 2 matrix | `src/config.ts` | Boot config (semantic detection **off**), the seven hard limits (which are human-approvable vs absolute), the hard-approval floor (OD-161: no external sub-type exempt). |
| 2 pipeline | `src/sanitize.ts` | FR-6.INJ.001/004/006 — deterministic regex tripwires (always on), `<external_data>` boundary wrap, quarantine=retain+route-to-human. Semantic classifier present but off + signal-only. |
| 2 gate | `src/enforcement.ts` | The code-layer gate. Takes **no prompt/content parameter** — structurally can't be swayed by injected text (ADR-007 part 1). Enforces the seven limits + floor + RLS/isolation on structural facts alone. |
| 3 adversary | `src/agent.ts` | The compromised-model simulator (maximally obedient). |
| 3 battery | `src/payloads.ts` | 12 attacks (each matrix cell, literal + evasion + boundary-tag break-out) + 4 negative controls. |
| 4 drive+assert | `src/redteam.ts` | Runs each payload; asserts contained, seam order, quarantine retention, boundary wrap, loud guardrail row, evasion-reached-model. |
| 5 evidence | `src/report.ts` | Emits the AF-068 evidence block (fields a–h) + JSON → `results/`. |

## Run

```bash
npm install
npm run spike        # asserts boot config → runs battery → writes results/
npm run typecheck
```

No credentials or DB needed — the harness is self-contained and deterministic, which is exactly what a
**retained regression battery** requires (`test-strategy.md` §1). The ingress surfaces (Slack/GHL/Gmail/
Drive) are simulated; a fast-follow re-runs the *same* battery against live connectors once ISSUE-039/
040/041 exist, and against the real enforcement code once ISSUE-055/059/020 ship.

## What this proves — and what it does not

- **Proves (AF-068):** the containment-first *design* has no bypass at the executable-seam level; every
  dangerous autonomous action — including injections that evade detection — is stopped by a code control
  that ignores prompt content. And it yields the reusable red-team battery.
- **Does NOT prove:** that the *shipped* enforcement code (ISSUE-055/059/020) is safe — this is the
  throwaway stub sanctioned by §8.1; the retained battery is re-run against the real code pre-release.
  Detection-signal **quality** (regex/embedding coverage + false-positive rate) is **AF-117**, a separate
  build-time EVAL (ISSUE-059 DoD) — per ADR-007, detection is only a signal, so a library gap degrades
  the signal, it does not breach containment.

## On ⛔ FAIL

A bypass makes containment-primary incomplete. Per **R2 / ADR-007** the path is **closed in code** (a
blocking finding on the owning ISSUE-055/059/020), **never patched with a detection rule**, then the
battery re-runs. A FAIL is a design fork (log an OD), not a bug to code around.
