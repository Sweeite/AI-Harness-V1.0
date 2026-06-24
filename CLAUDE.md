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

## The three non-negotiables (the operator's top bar — the ranking rule)

The system must, above all: **(1) never lose or corrupt knowledge · (2) never do something it
shouldn't · (3) never fail silently.** Failure is allowed; *silent* failure is not. These are
inviolable: **when a trade-off pits one of these against convenience, speed, or scope, the
invariant wins** — flag the shortfall as an OD rather than quietly taking the cheap option. Every
component is checked against them in Phase 1. Full definitions + what upholds/threatens each:
`spec/00-foundations/what-makes-it-great.md`.

## Grounding mode — when the user feels overwhelmed (priority)

If the user shows anxiety/overwhelm, or says **"ground me"** / **"work with me"** (or *scared,
blank, can't see it, in my head, overwhelmed*), **stop and follow
`spec/00-foundations/working-with-me.md` before anything else.** Short version: the anxiety is
almost always a *missing-view* signal, not a defect — make it concrete and visible (pull up
`system-map.md`), anchor in what's already locked, narrow to one thing, externalise every worry
into a tracked OD/AF, end with one next action. Show, don't reassure. Never yes-man him.

The big-picture view lives in `spec/00-foundations/system-map.md` (end-to-end route) and
`spec/00-foundations/system-map/` (per-component zoom-ins) — use them to make the system visible.

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

## Adding a new tool / connector (research-first — this triggers research)

The tool set is **open-ended and client-driven** — new tools/connectors/APIs arrive per client,
vertical, and use case. **No tool is specced into a requirement until a dated, primary-source
research dossier exists for it.** When a new tool comes up (any client, any use case), or an existing
tool's vendor changes something, **stop and follow
`spec/00-foundations/standards/tool-integration-research.md`** — the repeatable 5-step gate:

1. Open a dossier from `spec/00-foundations/tool-integrations/_TEMPLATE.md` → `<tool-slug>.md`.
2. **Run the research fan-out** — parallel subagents over the 12 dimensions (auth/token lifecycle,
   rate limits, API surface, webhooks, data/sensitivity, provisioning, isolation, cost, failure
   modes, versioning), **primary vendor docs only, date-stamped**, always asking *"what changed in
   the last 12–18 months?"*
3. File outputs into the registers (Rule 0): `AF-NNN` for anything DOCS can't prove, `OD-NNN` for
   every fork, glossary terms, `OOS-NNN` for deferrals.
4. Independent verification re-check on stale/refuted/load-bearing claims.
5. **Only then** spec the connector FRs — citing the **dossier**, not the design doc, for vendor facts.

**Vendor facts go stale** — the AF-003 spike caught 3 stale/refuted claims and 1 design fork (OD-011).
Every dossier is dated with a `Re-verify by`; a stale dossier can't be cited as current. This is the
connector-level expression of the three non-negotiables (a mis-read token rule loses access → #1; an
over-scoped grant does something it shouldn't → #2; an unhandled rate limit fails silently → #3).

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
- **Repo self-sufficiency test — the context-handoff gate (required, not optional).** Before
  any chat handoff — whenever the user asks to switch / start a new chat, **or** when context is
  filling, **or** when you judge a handoff is near (a major work unit is wrapping) — you must
  *actively run* the self-sufficiency test, not merely assert it. Spawn an independent subagent
  with **zero conversation context** that reads **only the repo** (following this file's
  start-of-session order) and tries to resume the next action: it reports the next step, whether it
  can act **without guessing**, and **every** gap, dangling ID, or unrecorded "we decided X in chat."
  **Patch every gap in the repo before handing off**, then the handoff is safe. Trigger it when the
  user asks *or* on your own judgment — and propose it yourself when you sense a handoff coming.
  **Never hand off on "it's probably all written down" — prove it with the test.** This is the
  active, enforced form of the self-sufficiency test named in the reading-order section.

## End every session by

1. Updating `README.md` status, `open-decisions.md`, and `traceability-matrix.csv`.
2. Logging any new exclusions/deferrals in `out-of-scope.md`, and capturing the user's
   **sign-off** on any completed component (header + SESSION-LOG).
3. Appending a `spec/SESSION-LOG.md` entry (decisions made, files changed, next step, new
   open questions). The `handoff` skill can generate this if the session was long.
4. Committing (branch first unless it's an initial/baseline commit; never push unasked).
5. **If the session is ending in a handoff** (new chat next, or context filling), run the
   **repo self-sufficiency test** (see Context-window management) *before* you hand off — a
   zero-context subagent must be able to resume from the repo alone; patch any gap it finds first.
