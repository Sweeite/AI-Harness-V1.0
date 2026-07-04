# ADR-010 — Product codebase home (a dedicated build repo, separate from this spec repo)

> **⛔ SUPERSEDED by [ADR-011](ADR-011-single-repo.md) (2026-07-04, same session).** The operator
> flagged that a second repo splits the project's context and creates a standing drift risk. The
> decision was reversed to **one repo** (product code in `app/` inside the spec repo). Do not act on
> this ADR — kept for decision history only.

- **Status:** Superseded by ADR-011
- **Date decided:** 2026-07-04 · **Superseded:** 2026-07-04
- **Resolves:** the build-phase decision deferred into ISSUE-007 on purpose — *where the durable
  product codebase lives* (a dedicated build repo, a monorepo, or continuing in this spec repo).
  ISSUE-007 is the **first durable product code** (Tier-1 bootstrap, root of the 11-node critical
  path); everything before it (ISSUE-001–006) is disposable Tier-0 spike/evidence code under
  `spikes/<issue>/`. Rule 0: this call must be written with an ID before any product code is poured.
- **Affects:** every build issue from ISSUE-007 onward (all durable harness / connector / RLS / loop
  / surface code); where Railway subscribes for the per-client auto-deploy fan-out (ADR-005); the
  home of all future PRs referenced by the traceability spine.

## Context

Two axes were in play; the architecture already fixes one of them:

- **One shared codebase, not N.** ADR-005 §1/§5 mandates **one shared repo** to which every client's
  Railway project subscribes and auto-deploys on push — "N independent deployments" of a single
  codebase. So this is **not** "monorepo vs many repos"; there is one shared product codebase either
  way. The only open question is *which repo that codebase lives in*.
- **This spec repo's identity is Rule 0.** `/q` exists to be the **requirements-spec source of
  truth** — its `CLAUDE.md`, start-of-session reading order, and the zero-context self-sufficiency
  test all assume the repo *is* the spec. The `spikes/` code here was explicitly disposable Tier-0
  evidence, not durable product code.

## Options considered

- **A new dedicated build repo (chosen).** The spec repo stays the pure, signed requirements
  contract; durable product code lives in a separate repo that Railway subscribes to. Railway builds
  and deploys from a clean product tree (no ~90%-markdown spec in the build context — cleaner build
  caching, deploy triggers, and secret-scanning). Traceability is unaffected: the spine crosses repos
  by **ID**, not path (`FR-* → ISSUE# → PR# → TEST`), and PRs live wherever the code lives.
  Cons: two repos to keep in view; a build issue's PR lands in the build repo while its issue/ACs
  live here (mitigated — the issue files already point by ID, and each PR cites the ISSUE-/FR-/AC-
  IDs it satisfies).
- **Continue in this spec repo.** Everything co-located. But Railway would auto-deploy from a repo
  that also holds the entire spec, and durable product code would intermix with the Rule-0 spec
  source — muddying "the repo is the source of truth [for the spec]." Rejected: optimises
  one-click co-location at the cost of the spec repo's clarity and a clean deploy source.
- **Structured monorepo (spec/ + product workspace in one repo).** Co-location with a hard internal
  boundary and its own tooling. Same Railway-deploys-from-a-spec-repo drawback as above, plus the
  overhead of a formal workspace split for what is really two different lifecycles (a finished,
  signed spec vs. an evolving codebase). Rejected as more machinery than the separation it buys.

## Decision

**The durable product codebase lives in a new dedicated build repo, separate from this spec repo.**
That build repo **is** the "one shared repo" ADR-005 references — the single codebase Railway
subscribes to and auto-deploys per client. This spec repo (`/q`) remains the requirements-spec
source of truth and is **not** a Railway deploy source. The stack is TypeScript/Node (ADR-009);
infra is Supabase + Inngest (ADR-001/005).

Cross-repo traceability rule (binding): every build-repo PR **cites the ISSUE-/FR-/AC- IDs** it
implements, and each `spec/06-issues/ISSUE-*.md` records its PR URL in the sync ritual — so the
spine `design-doc → FR → ISSUE# → PR# → TEST` walks end to end across the two repos with no gap.

## Consequences

- Product code from ISSUE-007 onward is authored in the build repo, not under `spec/`. The `spikes/`
  tree here remains as-is (Tier-0 evidence, already committed); it is **not** migrated.
- **The build repo was created 2026-07-04 (session 58):** **`Sweeite/ai-harness-core`** (private;
  local `~/Desktop/ai-harness-core`). Repo name/visibility are build-detail, not load-bearing. It
  holds ISSUE-007's operator-independent artifacts — the FR-10.PRV.004 runbook (`runbooks/`) and the
  FR-10.PRV.001 provisioning scaffold (`provisioning/`, 4/4 tests green). The FR-10.PRV.003 canary
  fixture and the live `RailwayInfra` adapter (the AF-004 two-party run) land there next. Railway
  subscribes to this repo for the per-client deploy fan-out (the two-party wiring step). The initial
  staging folder (`build/` in this spec repo) has been removed — the code now lives only in the
  build repo (single source of truth).
- Railway's per-project GitHub auto-deploy is wired to the build repo (AF-020 / AF-064 confirm the
  mechanism); this ADR only names *which* repo, not the deploy mechanics (ADR-005 owns those).
- Rules nothing out at the infra level (Supabase + Inngest + Railway unchanged). Spawns no new OD.
  Recorded as the second build-phase decision (after ADR-009 stack); the ADR index gains the
  ADR-010 row.
