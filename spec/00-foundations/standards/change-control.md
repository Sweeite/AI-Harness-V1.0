# Standard: Change Control (how a locked decision changes)

Once a decision is locked, it is **never edited silently.** A spec you can't trust to be
current is worse than no spec — change control is what keeps "the repo is the source of truth"
true over weeks of work.

## Rules

1. **Accepted ADRs are immutable.** To change one, write a **new ADR that supersedes it**:
   - Set the old ADR `Status: Superseded by ADR-NNN`.
   - The new ADR states `Supersedes: ADR-MMM` and *why* the change is warranted.
   - Never rewrite the body of an Accepted ADR in place.

2. **A `Ready`/`Approved` FR changes via an OD.** Open a new Open Decision describing the change
   and the reason. On resolution: bump the FR (note the change), re-write/re-check its
   acceptance criteria, **re-acquire your sign-off**, and update the traceability matrix.

3. **Every change is logged** — what changed, why, who decided, when — in the ADR/OD itself
   *and* in `SESSION-LOG.md`.

4. **Glossary terms change only with the ADR/OD that motivates the change.** Never let a term
   carry two meanings across versions.

5. **Out-of-scope reversals are decisions too** — moving something out of `out-of-scope.md`
   back into scope goes through an OD, same as any other change.

## Why

The whole spec rests on Rule 0 in `CLAUDE.md`: the repo is the source of truth. That only holds
if the repo is *current* and *trustworthy*. Uncontrolled edits to locked decisions silently
reintroduce the ambiguity this whole process exists to remove.
