# AF-078 — evidence PENDING (not yet run)

This spike is an **R8 "you-present" spike**. No evidence file exists yet **by design** —
`af-078-evidence.<date>.{json,md}` is written **only when the harness is actually run**, and it
is never fabricated.

## Status

- **AF-078:** 🔴 open (not yet proven). No `af-078-evidence.*` file present → nothing has run.
- The harness is **built and ready to run**, but has deliberately **not been executed** by the
  builder (R8: the operator runs it, present, so the evidence is trustworthy).

## To produce evidence

- **MODE M (mechanics — no operator infra):** `npm install && npm run spike` with no `.env`.
  This proves the verifier LOGIC (parse-before-verify, constant-time compare, replay defense)
  but **cannot flip AF-078 GREEN** — the GHL real-signature assertion (AF-090) is still owed.
  MODE M prints exactly that and exits refusing to claim GREEN.
- **MODE R (real — flips AF-078 GREEN):** supply the operator values in `.env` (a **live
  captured GHL payload** + **GHL's real Ed25519 public key** at minimum — see `.env.example`),
  then `npm run spike`. Only a full MODE-R PASS writes a 🟢 verdict.

On a PASS, paste the emitted markdown block into `feasibility-register.md` §K, flip AF-078
🔴→🟢, and record the AF-090 discovery (GHL signing base string + public-key source) into its
register row.
