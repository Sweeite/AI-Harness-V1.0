# ADR-011 — One repo: product code lives with the spec (supersedes ADR-010)

- **Status:** Accepted
- **Date decided:** 2026-07-04
- **Supersedes:** [ADR-010](ADR-010-codebase-home.md) (dedicated build repo). ADR-010 is now
  **Superseded** — do not act on it.
- **Resolves:** the same question ADR-010 addressed — *where the durable product codebase lives* —
  re-decided the same session when the operator flagged that a second repo splits the project's
  context and creates a standing drift risk.
- **Affects:** every build issue from ISSUE-007 onward; where Railway subscribes for the per-client
  deploy fan-out (ADR-005); the home of all future code + PRs.

## Context

ADR-010 put the product code in a **separate build repo** (`ai-harness-core`) on the theory that a
clean, code-only repo is a tidier Railway deploy source. That reasoning holds for a large team with
many engineers, but it does **not** fit this project's actual shape:

- **Solo operator, occasional builds, sometimes from a phone.** Two repos means two things to pull,
  two to push, on every device — double the coordination and double the chance of them drifting.
- **The spec is the brain.** All 86 issues, the design doc, the ADRs, the glossary, and the build
  schedule live in the spec repo. A separate code repo does **not** carry that context, so building
  there risks acting without the full picture — exactly the misalignment the whole `CLAUDE.md`
  anti-drift protocol exists to prevent. The operator surfaced this directly.
- **The cost of the separation is real; its benefit is minor and solvable.** Railway can deploy from
  a subdirectory of a monorepo, so "the deploy source also contains markdown" is a non-issue.

The reversal is cheap now: ADR-010 was one session old with only a scaffold in the separate repo and
nothing built on top of it. This is the cheapest moment to consolidate.

## Options considered

- **One repo — spec + code together (chosen).** Product code lives in `app/` inside the spec repo.
  One source of truth; the spec, issues, and code are never out of sync because they are the same
  working tree and the same `git pull`/`git push`. Simplest possible mental model, and the safest on
  a phone. Railway is later pointed at the `app/` subdirectory (root-directory config) for the
  per-client fan-out. Cons: the deploy repo also contains the spec (cosmetic; Railway ignores what
  it isn't told to build).
- **Two repos (ADR-010, now rejected).** Cleaner deploy source, but splits context across two repos
  and doubles the sync burden — a standing drift risk for a solo operator. The benefit does not pay
  for the cost here.

## Decision

**The product code lives in the same repo as the spec, under `app/`.** There is one repo
(`Sweeite/AI-Harness-V1.0`), one source of truth. The separate `ai-harness-core` repo is retired
(its scaffold was moved into `app/`). Railway will later deploy from the `app/` subdirectory, one
deployment per client, each against that client's own Supabase (ADR-005 unchanged — only *which
directory* it deploys from is settled here).

Traceability rule (unchanged in spirit, simpler in practice): every code change cites its
`ISSUE-/FR-/AC-` IDs, and the issue file records the commit/PR. Now that code and issues share a
repo, a PR can reference an issue directly.

## Consequences

- Product code from ISSUE-007 onward lives in `app/` (currently `app/runbooks/` + `app/provisioning/`).
  The `spikes/` tree is unchanged (Tier-0 evidence).
- The `ai-harness-core` GitHub repo + its local clone are removed; ADR-010 is marked Superseded and
  the ADR index updated.
- Railway deploy wiring (the two-party step) points at `app/` as the service root; ADR-005's fan-out
  model is otherwise unchanged.
- Spawns no new OD. Recorded as the third build-phase decision (ADR-009 stack → ADR-010 → ADR-011).
