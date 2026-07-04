# AF-077 evidence — PENDING (spike not yet run)

This is an **R8 "you-present"** launch-gating spike (ISSUE-005 / AF-077, one of the six OD-157/RP-1
go/no-go SPIKE-GATEs). It has **not been run** — no evidence exists yet, and none has been
fabricated.

Running it requires the operator's **real, throwaway Supabase Auth project + credentials** (see
`../.env.example` and the README's "What the operator must provide"). It drives a **real scripted
attack** against that project, so it can only run with the operator present and a disposable target
they can delete afterwards.

When the spike runs it writes `af-077-evidence.<date>.{json,md}` alongside this file. On **PASS**,
paste the markdown block into `spec/00-foundations/feasibility-register.md` Block J/K and flip
**AF-077 🔴→🟢**. On **FAIL**, the verdict is a **design fork** (R2 / OD-018) — log an OD with the
redesign it forces and do **not** let ISSUE-014 ship on an unproven gate.

Do not delete this file until real evidence replaces it.
