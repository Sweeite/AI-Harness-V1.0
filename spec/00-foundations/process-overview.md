# Process Overview — Full Optics

> **Read this second, right after CLAUDE.md.** It is the orientation for the whole effort:
> *what* we're doing, *what the user wants*, the *goal*, *why* we work this way, and *how* the
> machine runs. Any chat — fresh or continuing — should be able to act correctly from this doc
> plus the rest of the repo, with **zero** access to the original conversation. If something
> needed to act is missing here, that is a bug in this doc — fix it before proceeding.

---

## WHAT we are doing

Turning a narrative **design doc** (`spec/source/design-doc-v4.md` — "the AI Harness", a
memory + tools + agent platform sold to agencies as a "business brain") into a **build-ready
requirements specification**: atomic, testable, fully traceable, zero ambiguity. This repo is
the **spec**, not the build. The build happens afterward, *from* this spec.

A design doc explains and persuades; it is allowed to be vague ("coverage drives cold-start").
A requirements spec is fielded, testable "the system shall…" statements where nothing is left
to interpretation. The work of getting from one to the other is three things, in order of
difficulty: **(1) resolve** every decision the narrative left implicit, **(2) decompose** the
prose into atomic requirements, **(3) wire** traceability so every artifact links back to intent.
The writing is mechanical once a decision is made — **the real bottleneck is decision throughput,
and most decisions are the user's** (it's their vision and use case).

## WHAT the user wants (the standard to hold)

- A system that is **reasoned through, properly architected, and feasibility-aware** — and that
  will be **fully functional when built to this spec** (the spec is the blueprint; "functional"
  is delivered by the build + the feasibility spikes, never claimed of the document itself).
- **Every tunable config editable in the UI, not in backend code** — with exactly one justified
  exception: secrets (API keys) stay backend-only as a read-only presence row. See
  `standards/config-edit-taxonomy.md`.
- **Every dashboard/surface fully specified** (Phase 3).
- **Clean traceability "ribbons"** — the user must be able to trace any built thing back to a
  requirement they signed off, to verify build == spec.
- **Nothing ambiguous, assumed, or half-baked.** No "figure it out while building."
- **Full optics** — the system (and every future chat) must understand what we want, the goal,
  the why, and the how. That is the purpose of this document.

**Business context (locked):** Operator = Transpera AI (Austin). Charges a **retainer** for
building + managing; the **client pays all operating costs** (Supabase, API, connector SaaS) on
their own card. ~5 clients year one, ~20 year two. Architecture = **Silo** isolation + **hybrid**
account ownership (client owns data + keys; operator owns the Railway compute / the codebase
moat). See ADR-001.

## The GOAL (Point B — definition of done)

A spec that **decomposes into GitHub issues**, where:
- Every design-doc line traces to ≥1 functional requirement (no orphans).
- Every FR is atomic, has acceptance criteria, and has **zero open decisions**.
- Every config is captured, classified, surfaced, given an edit-mechanism, and validated.
- Every surface is fully specified with all states.
- Every component is **explicitly signed off by the user** before build.
- Every exclusion/deferral is logged (no silent scope drift).
- Every FR → an issue; every issue → back to FRs, in a defined build order.

When that's true, "ambiguous / assumed / half-baked" is **structurally impossible**, because the
gates don't let a requirement through without resolution.

## WHY we work this way (first principles)

1. **The repo is the source of truth — the conversation is not.** A model's memory of "what we
   decided" drifts and invents; a file with an ID and a citation does not. Everything is
   externalized to the repo so the work survives across chats and context windows. (CLAUDE.md Rule 0.)
2. **Anti-hallucination by construction.** Cite every requirement to design-doc lines; never use
   an open glossary term or carry an open decision into a `Ready` requirement; grep, don't guess.
3. **Paper-vs-proven, always stated.** A spec proves coherence, not function. Untestable-on-paper
   assumptions are logged (`AF-*`) and flagged, never presented as proven.
4. **Decisions are tracked, not improvised.** Every ambiguity becomes an Open Decision (`OD-*`)
   with options + a recommendation, and blocks `Ready` until the user resolves it.
5. **Bounded context.** One component or one ADR per session; offload bulk reading to subagents.
   Keeps each session sharp and below the point where lossy summarization starts.
6. **Author where context is richest; future chats execute, never invent.** Methodology and
   intent are written down *while live* (this doc), so a fresh chat *follows* rather than guesses.
   **The repo-self-sufficiency test:** before ending a phase, ask "could a fresh chat do the next
   step from the repo alone?" If no, write more down before switching.

## HOW the machine runs (overview — detail in `phase-playbooks.md`)

- **Phases 0→6**, dependency-ordered (see README and `phase-playbooks.md`). Each phase has a hard
  done-when gate before the next begins.
- **Per-component rhythm (Phase 1):** Claude drafts FRs + the OD list (each OD with a
  recommendation) → user resolves ODs → Claude finalizes acceptance criteria, wires traceability,
  runs the verification gate → user signs off → commit.
- **The gates:**
  - *Verification gate* — after each component, an independent subagent re-extracts FRs from the
    design prose and flags orphaned lines / contradictions with locked ADRs.
  - *Feasibility track* — `AF-*` assumptions + four priority spikes (cost, retrieval, vendor-claims,
    provisioning) run alongside; tested before/while building.
  - *Change control* — Accepted ADRs are immutable (supersede); locked FRs change via a new OD.
  - *Sign-off* — a component is `Approved` only when the user green-lights it.
- **Context preservation:** CLAUDE.md (auto-loaded protocol) → SESSION-LOG.md (resume point) →
  this doc + the registers. Subagents for bulk reads. The repo-self-sufficiency test as the guard.

## The ID system (traceability spine)

`FR` functional requirement · `NFR` non-functional · `CFG` config key · `UI` surface ·
`DATA` table/field · `PERM` permission · `AC` acceptance criterion · `OD` open decision ·
`ADR` architecture decision · `AF` feasibility assumption · `OOS` out-of-scope/deferred.
Full reference: `id-conventions.md`. Plain-English: `/ACRONYMS.md`.

## The artifacts map

| File / folder | Role |
|---|---|
| `CLAUDE.md` | Auto-loaded operating protocol (read first, every session) |
| `spec/00-foundations/process-overview.md` | **This doc** — full optics |
| `spec/00-foundations/phase-playbooks.md` | The repeatable procedure for each phase |
| `spec/00-foundations/glossary.md` | Every term, defined once |
| `spec/00-foundations/id-conventions.md` | The ID scheme |
| `spec/00-foundations/requirement-template.md` | The shape every FR takes |
| `spec/00-foundations/open-decisions.md` | OD log (anti-ambiguity gate) |
| `spec/00-foundations/out-of-scope.md` | Conscious exclusions / deferrals (OOS) |
| `spec/00-foundations/feasibility-register.md` | Test-only assumptions (AF) + priority spikes |
| `spec/00-foundations/adr/` | Architecture Decision Records + index |
| `spec/00-foundations/standards/` | Decide-once patterns (config edit taxonomy, change control) |
| `spec/01-requirements/` | FRs per component (Phase 1) |
| `spec/02-config/` `03-surfaces/` `04-data-model/` | Phases 2–4 outputs |
| `spec/source/` | Design doc + review scaffolding (read-only reference) |
| `traceability-matrix.csv` | Master index — walk any requirement end to end |
| `spec/SESSION-LOG.md` | Per-session resume point |

## Who decides what

- **User:** resolves Open Decisions; approves/redirects ADRs; signs off components; sets scope.
- **Claude:** decomposes, drafts, finds gaps, recommends, wires traceability, runs the verification
  gate, flags paper-vs-proven. Never asserts an unlogged decision; never invents methodology that
  isn't written — writes it down first.

## Current state pointer

Authoritative status lives in `README.md` (phase table + ADR line) and the top of `SESSION-LOG.md`.
As of writing: Phase 0 in progress — ADR-001/002/003 Accepted; ADR-004–007 pending (draft-approve);
priority spikes pending; Phase 1 not started.
