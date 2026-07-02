# Pre-Phase-6 Full-Spec Audit — Playbook

> **When to run this:** the README status table says *"full spec audit (operator-requested) before
> Phase 6."* Phases 0–5 are all 🟢 signed off; before slicing the spec into build issues (Phase 6),
> the operator wants **one whole-spec sweep** that checks the phases agree with each other
> end-to-end. This file is the repeatable procedure. It is written to be run by a **fresh chat with
> zero prior context** — read `CLAUDE.md` → `README.md` → this file, then execute.
>
> **Authored session 45 (2026-07-01).** Designed to survive a chat handoff (self-sufficiency test).

---

## Why this audit exists (and why now)

Every per-phase verification gate so far checked **one phase in isolation** — C0-C10 each, the 14
surfaces each, the config registry, the data model, the NFRs. What has **never** been checked in a
single pass is whether the phases **agree with each other**: does C2's memory model match the
Phase-4 `schema.md`, match the Phase-3 memory surfaces, match the Phase-5 NFRs that constrain it?

Phase 6 issues **inherit these seams** — each build issue is sliced from FRs + their ACs + the
NFR constraints + the schema. A cross-phase contradiction that has survived until now becomes a bug
built into the foundation. This audit is the last chance to catch it on paper, where it is cheap.

**Definition of done for the audit:** a consolidated report with **0 unresolved HIGH**, every MED
reconciled (fixed via change-control, or logged as an `OD-*`/`OOS-*`/`AF-*`), and a clean bill that
the spec is a sound build contract. Then — and only then — Phase 6 begins.

## Scope

**The whole spec, Phases 0–5:**
- `spec/00-foundations/` — ADRs (1–8), standards, glossary, id-conventions, the registers
  (open-decisions, out-of-scope, feasibility), `PERMISSION_NODES.md`.
- `spec/01-requirements/` — the 11 components C0–C10 (hundreds of FRs + ACs).
- `spec/02-config/config-registry.md` — ~170 keys + secrets + structured objects.
- `spec/03-surfaces/` — the 14 surface files.
- `spec/04-data-model/` — `schema.md`, `rls-policies.md`, `indexes.md`, `migrations.md`.
- `spec/05-non-functional/` — the 8 domain files + `test-strategy.md`.
- `traceability-matrix.csv` — the 442-row master index.
- `spec/source/design-doc-v4.md` — the origin (for orphan-intent checks).

## Output location

Create `spec/00-foundations/audit/` and write:
- `_audit-report.md` — the **consolidated** report: verdict + all findings by severity, each with
  `file:line` + a fix recommendation + resolution status.
- `dim-1-id-resolution.md` … `dim-6-non-negotiables.md` — one raw findings file per dimension
  (the working evidence the consolidated report is built from).
- `_mechanical-prepass.md` — the grep-based ID-extraction diff (see below), run first.

Findings severity: **HIGH** = a contradiction, a dangling safety-critical ID, an orphaned design
intent, or a change-control that landed in only one place → blocks Phase 6. **MED** = an
inconsistency or gap that needs a fix or a logged decision. **LOW** = cosmetic / cite-precision.

## The six audit dimensions

Each dimension is a work-unit. Run them independently (fan-out); each returns findings with
`file:line` + severity. **Every HIGH/MED finding is then adversarially verified** (see next section)
before it counts — this session's self-sufficiency test saw an Explore subagent throw **80
false-positive "dangling refs"** (it looked for ACs as standalone headers when they are FR
sub-bullets, and mislabelled DB identifiers as config keys). **Audit findings are guilty until
proven; verify every one against the source before acting.**

**Dimension 1 — Cross-phase ID resolution.** Every ID *reference* resolves to a real *definition*.
IDs: `FR-* · AC-* · CFG-*/config keys · UI-* · DATA-* · PERM-* · OD-* · AF-* · OOS-* · ADR-*`.
Method: the mechanical pre-pass (below) extracts all references and all definitions and diffs them;
an agent then triages the diff (many "unresolved" will be false positives — ACs are FR sub-bullets,
config keys vs DB columns, etc.). **Finding = a reference with no definition anywhere.**

**Dimension 2 — Traceability completeness.** (a) Every design-doc-v4 section maps to ≥1 FR (no
orphaned intent) — reconcile against the per-component "Data touched"/coverage footers + the
verification-gate history. (b) Every FR is issue-ready: has ≥1 AC, `Status: Approved`, **zero open
ODs pointing at it**. (c) The `traceability-matrix.csv` is accurate — every FR has a row, every row's
cited AC/DATA/CFG/PERM/UI ids match the component file. **Finding = an orphaned design line, a
not-ready FR, or a matrix row that disagrees with its component.**

**Dimension 3 — Cross-phase consistency (the heart of this audit).** The references that cross a
phase boundary all resolve *and agree*: every `DATA-`/table.field an FR or surface names exists in
`schema.md` with a matching type; every `CFG-` exists in the registry with the class the FR assumes;
every `PERM-` node cited exists in `PERMISSION_NODES.md`; every `UI-` surface an FR names exists;
every FR a surface renders exists; every FR an NFR constrains exists. **Finding = a cross-phase
reference that resolves in one phase but is absent/contradictory in the other.**

**Dimension 4 — Change-control integrity.** This project made many change-control edits — PERM-node
mints (OD-115/117/125/129/133/137), owed-back `DATA-` cites (16 Phase-4 stores), the C6/C7
amendments (OD-068/074/088/097/120/142/143/153), the Phase-5 config-key mints. Each must have landed
in **both** places: the source (the OD/decision) **and** the consumer (the FR/AC/registry/catalog).
Method: for each logged mint, grep both ends. **Finding = a change-control that landed in only one
place (e.g. an OD says "minted PERM-x" but the catalog lacks it, or a node in the catalog no FR
references).**

**Dimension 5 — Contradiction hunt (adversarial).** The genuinely adversarial dimension: two
requirements that cannot both be true; a locked ADR a later FR quietly violates; a config default
that contradicts an FR's stated behaviour; a surface that shows something an NFR forbids. Method:
sharded reading agents, each given a slice + the locked ADRs + the three non-negotiables, prompted
to **find contradictions, not confirm coherence**. Run loop-until-dry (keep going until a round finds
nothing new). **Finding = a specific pair of requirements + why they conflict.**

**Dimension 6 — Three-non-negotiables end-to-end.** Trace each non-negotiable through the whole
stack, not per-component: **#1** (a piece of knowledge entering via a webhook → ingestion → memory
write → retrieval → surface → backup → erasure: is it *ever* silently lost or corrupted along that
path?); **#2** (an agent action: is there *any* path — surface, mobile, command, chained task,
proactive — that reaches a consequential effect without the node-gate + C6 pipeline?); **#3** (a
failure at each layer: does it *ever* read healthy/succeed-silently instead of surfacing?).
**Finding = a gap in the chain where the non-negotiable is not upheld.**

## The adversarial-verify pass (mandatory)

For every **HIGH/MED** finding from any dimension, spawn an independent verifier prompted to
**refute** it: read the actual source `file:line`, and default to "false positive" unless the
contradiction/gap is unambiguous. Only findings that **survive refutation** enter the consolidated
report as real. (This is why the per-phase gates were reliable and the raw Explore sweep was not.)
Perspective-diverse verification where useful: a "does-the-id-exist" check is different from a
"do-these-two-requirements-actually-conflict" check — use the right lens.

## Mechanical pre-pass (run first — cheap, catches the bulk)

Before any agent, run grep-based extraction to seed the audit (write to `_mechanical-prepass.md`):

1. **Extract every ID definition** — `FR-*`/`AC-*` from component headers + sub-bullets; config keys
   from the registry tables; `PERM-*` from `PERMISSION_NODES.md`; `DATA-`/tables from `schema.md`;
   `UI-*` from surface headers; `OD-*`/`AF-*`/`OOS-*`/`ADR-*` from their registers.
2. **Extract every ID reference** — every `FR-*`, `AC-*`, `CFG-*`, `DATA-*`, `PERM-*`, `UI-*`,
   `OD-*`, `AF-*`, `OOS-*`, `ADR-*` token used anywhere across `spec/`.
3. **Diff** references − definitions → the candidate-dangling list. This list is **input to
   Dimension 1's triage agent**, not a finding list (expect many false positives to triage away).

This mechanical pass is fast and deterministic; it front-loads dimensions 1 and 3 so the agents
spend their budget on triage + the semantic dimensions (2, 5, 6).

## Context discipline (learned session 45 — do not skip)

**The component and surface files are large — reading many at once overflows the agent context
("prompt too long").** Shard every reading task:
- Components: **C0–C3 · C4–C7 · C8–C10** (three shards), one at a time within a shard.
- Surfaces: **00–05 · 06–12** (two shards).
- NFR files, data-model files, registers: readable in one pass each.
Offload all bulk reading to subagents; keep the main thread for triage + synthesis (per CLAUDE.md).

## Orchestration — my recommendation

**Run it as a Workflow if the operator opts in** (says "ultracode" / "use a workflow" / "run a
workflow" in the executing chat). This audit is the textbook workflow shape: **fan out** the six
dimensions (sharded) → **adversarially verify** each finding → **synthesize** the consolidated
report, with **loop-until-dry** on the contradiction hunt. A workflow makes the fan-out
deterministic and the verify-before-count structural. Rough cost: dozens of agents, significant
tokens — appropriate for a build-contract gate, but it needs the explicit opt-in.

**Otherwise, hand-managed parallel subagents** (as session 45 ran the harvest + gates): launch the
mechanical pre-pass, then batches of dimension agents, then verifier agents, reconciling between
batches. More incremental, the driver stays in the loop, no opt-in needed.

Either way the *procedure* is identical — only the harness differs.

## Pass criteria (definition of done)

1. All six dimensions run; every HIGH/MED finding adversarially verified.
2. **0 unresolved HIGH.** Every real HIGH fixed via change-control (never a silent edit — see
   `standards/change-control.md`).
3. Every MED fixed or logged as an `OD-*`/`OOS-*`/`AF-*`.
4. `_audit-report.md` written with the verdict + findings + resolutions.
5. README + SESSION-LOG updated; committed. **Then Phase 6 is cleared to begin.**

## How to kick this off in a fresh chat

Open a new chat in this repo and say:

> *"Run the pre-Phase-6 full-spec audit per `spec/00-foundations/pre-phase-6-audit-playbook.md`.
> Start with the mechanical pre-pass, then the six dimensions."*  *(add "use a workflow" to
> authorize the multi-agent orchestration.)*

The fresh chat will read `CLAUDE.md` → `README.md` (which points here) → this playbook, and execute.
Everything it needs is in the repo; nothing lives only in a prior conversation.

## After the audit

A clean audit → **Phase 6 (Issue decomposition)**: finalize the Phase-6 playbook (approach→full
detail, per the finalize-before-entry rule), then slice the spec into vertical, independently-
buildable issues, each inheriting its FR `AC-*` **+** the `NFR-*` constraints **+** the launch-gating
spikes as its definition of done, with a build-order/dependency map. *(No dedicated `to-issues` skill is currently
installed in this environment — verified absent from the filesystem, 2026-07-02. Follow the finalized Phase-6
playbook procedure directly instead; re-check whether a skill has since been installed before assuming it isn't.)*
