# AI Harness Spec — Operating Protocol (read me first, every session)

This repo turns a design doc into a build-ready requirements spec. This file is the
anti-hallucination + context-management contract. **Claude: follow it every session.**

## Rule 0 — The repo is the source of truth. The conversation is not.

A decision **exists only if it is written in a file with an ID** (an ADR, an OD resolution,
or an FR). If it is not written down, it has not been decided — do not assert it, do not act
on it. When a decision is made in conversation, **write it to the repo immediately** before
moving on. Never reconstruct prior decisions from memory; read them.

**Changing a locked decision** (an Accepted ADR or a Ready/Approved FR) is never a silent edit
— it goes through change control: supersede the ADR / open a new OD. See
`spec/00-foundations/standards/change-control.md`. A decision to *exclude* or *defer* something
is logged in `spec/00-foundations/out-of-scope.md`.

## Start every session by reading (in this order)

1. `README.md` — the status table (where we are, what's next).
2. `spec/00-foundations/process-overview.md` — full optics: what/want/goal/why/how.
3. `spec/00-foundations/phase-playbooks.md` — the procedure for the current phase.
4. `spec/SESSION-LOG.md` — the last session's handoff (resume point).
5. `spec/00-foundations/open-decisions.md` — what's unresolved.
6. `spec/00-foundations/glossary.md` — agreed terms (do not redefine them).
7. The specific ADR(s) and component file for today's task only.

Do not load the whole spec. Load the minimum set for the task in front of you.

**Self-sufficiency test:** the repo alone (these docs + registers) must be enough to act
correctly with **zero** access to any prior conversation. If something needed to act is only in
a chat, that's a bug — write it down before proceeding.

## Anti-hallucination rules

- **Cite the source.** Every requirement cites design-doc lines (`spec/source/design-doc-v4.md L###`). No citation = suspect, do not mark Ready.
- **No open terms.** Never use a 🔴 OPEN glossary term in a `Ready` requirement.
- **No open decisions.** A requirement cannot be `Ready` while an OD points at it.
- **When unsure if something was decided, grep the repo. Do not guess.**
- **Verify file/line references before relying on them** — the design doc can move; re-check.

## Feasibility flagging (say paper-vs-proven out loud, always)

- A spec proves the design is *coherent*, not that it *works*. Many claims can only be
  confirmed by testing — never present those as proven.
- **When a requirement or ADR rests on an unproven assumption, tag it `⚠️ FEASIBILITY: AF-NNN`
  at the point of use and log it in `spec/00-foundations/feasibility-register.md`** with a
  verification method (DOCS / SPIKE / EVAL / LOAD).
- In conversation, explicitly call out which parts are decided-on-paper vs need-testing, both
  now and whenever new ones surface. The user expects these and wants them surfaced, not hidden.

## Context-window management

- **One component or one ADR per working session.** Bounded scope keeps context sharp.
- **Offload bulk reading to subagents** (Explore / general-purpose). They read large files
  and return conclusions + line cites — keep the main thread's context for *decisions*, not
  raw file contents.
- **Every component file opens with a "Context manifest"** — the exact ADRs, standards,
  glossary terms, and design-doc sections it depends on. Load only those.
- **Standing verification gate:** after drafting a component's FRs, run an independent
  subagent to re-extract FRs from the design prose and flag any orphaned design lines or
  contradictions with locked ADRs. This is the per-component hallucination check.

## End every session by

1. Updating `README.md` status, `open-decisions.md`, and `traceability-matrix.csv`.
2. Logging any new exclusions/deferrals in `out-of-scope.md`, and capturing the user's
   **sign-off** on any completed component (header + SESSION-LOG).
3. Appending a `spec/SESSION-LOG.md` entry (decisions made, files changed, next step, new
   open questions). The `handoff` skill can generate this if the session was long.
4. Committing (branch first unless it's an initial/baseline commit; never push unasked).
