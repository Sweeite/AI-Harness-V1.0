# PENDING — no evidence yet (this is correct)

**AF-069 is 🔴 and STAYS 🔴 until a real, operator-present restore rehearsal runs.**

This directory is intentionally empty of evidence. ISSUE-004 is an **R8 "you-present" spike**:
it proves a real Supabase backup restores complete + queryable on the **operator's real infra
and backup-ops credentials** — which we do **not** have at build time. Fabricating an
`af-069-evidence.*.md` here would be a #1 (knowledge-loss) and #3 (silent-failure) violation of
the three non-negotiables — the whole point of AF-069 is that the backup guarantee is **proven,
not assumed**.

## What lands here — and when

When the operator runs `npm run spike` against real infra (see
[`../README.md`](../README.md) "Run" and "What I need from the operator"), the harness writes:

- `af-069-evidence.<date>.json`
- `af-069-evidence.<date>.md` — the AF-069 evidence block (fields a–h) to paste into
  `spec/00-foundations/feasibility-register.md` block I, flipping AF-069 🔴→🟢 **on PASS**.

The harness also drops the off-platform dump artifact (`source-dump.<date>.dump`) here during a
path-B run — it may contain **real client data**, so it is gitignored and must be deleted at
teardown.

## If the rehearsal FAILS

AF-069 stays 🔴, a **launch-blocking OD** is opened, and the **design does not proceed** — the
backup/DR mechanism (ADR-008) must change and re-rehearse before go-live (R2 / R9 / RP-1). ISSUE-085
stays blocked. A FAIL is a design fork, not a bug to code around.
