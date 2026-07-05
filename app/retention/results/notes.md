# ISSUE-084 — build notes (what is proven offline; what is owed to a live/you-present session)

## Environment
Offline-safe authoring session (worktree). No live infra touched. `npm install`, `npm test`,
`npm run typecheck`, `npm run check` all run offline against the in-memory reference model + the
read-only ISSUE-008 baseline migration.

## Proven OFFLINE (all 22 AC tests pass; typecheck clean; check CLI green — 44 tables linted)

| AC(s) | Proven by |
|---|---|
| AC-10.RET.001.1 | routine ops (decay/supersede/archive/cold-tier) produce **no** tombstone |
| AC-10.RET.001.2 | every hard-delete traces to a sanctioned path (individual_erasure / client_offboarding) + authoriser |
| AC-10.RET.001.3 / AC-NFR-CMP.003.1 | the detector: a tombstone with **no** DEL/OFF authorisation is surfaced as the violation (both no-path and path-without-auth cases; sanctioned one is NOT flagged) |
| AC-10.RET.002.1 | the four values resolve to **90 / 7 / 72 / true** unset |
| AC-10.RET.002.2 / AC-NFR-CMP.004.1 | **below-floor write rejected with the floor surfaced**; **non-Super-Admin write rejected** by `PERM-config.infra`; the denied write did not mutate the value |
| AC-10.RET.002.3 / AC-NFR-CMP.003.2 | every accepted change audited (old default → new, actor, time); a **rejected** write leaves **no** audit row |
| AC-10.ISO.001.1 / AC-NFR-SEC.001.1 | the **no-client_slug lint** over the real baseline is clean; a negative test proves the lint CATCHES a planted `client_slug` and IGNORES a comment mention |
| AC-10.ISO.001.2 / AC-NFR-SEC.001.2 | identity only in `client_registry`; an app-row write carrying `client_slug`/`tenant_id` is rejected (`ERR_CLIENT_SLUG`) |
| AC-10.ISO.001.3 | the OD-096 reconciliation note (`client_registry` / management-plane; ``client_slug` never appears in a silo`) present in the baseline |
| AC-10.ISO.002.1 | no shared business-data store (`hasSharedBusinessStore()===false`); the registry holds only identity+region metadata |
| AC-10.ISO.003.1 / AC-NFR-CMP.001.1 | v1 residency defaults to `ap-southeast-2` and is a **recorded** fact, read back (not defaulted at read time) |
| AC-10.ISO.003.2 | v2 `deployment_region` knob present; a selected non-default region is honoured |
| AC-NFR-CMP.001.2 | the recorded residency carries `surfaced_for_legal_review` |
| AC-NFR-CMP.011.2 | an ADR-posture change (a legal-minimum floor) moves **only** via an explicit change-control `setFloor` — a value write never mutates the floor as a side effect |

## LIVE-OWED — the 🧑 legal-review gate (OD-172 pattern)

The **legal-review go-live gate** — **AC-10.LEG.001.1, AC-10.LEG.001.2, AC-NFR-CMP.011.1, AC-NFR-CMP.004.2**
— is a **live / you-present go-live precondition**: a *qualified lawyer* reviews the specific retention
values + deletion procedures for a jurisdiction (Australia Privacy Act 1988 / UK GDPR / EU GDPR / US) before
the deployment handles that jurisdiction's regulated personal data, and before a jurisdiction-sensitive
feature (HR content) is enabled. **This is NOT an offline test** (AF-136: the spec cannot assert the lawful
minimums; a lawyer must sign off), and it is **not faked here**.

What IS proven offline: the **precondition SEMANTICS** — the store **fails closed** until a completed review
(retention values reviewed **and** deletion procedures reviewed **and** a named lawyer) is recorded, the gate
is **per-jurisdiction** (AU review does not unlock UK/EU), and the floor a review installs is read at runtime
(AC-NFR-CMP.004.2's "review-set, not engineering default" is proven as installability, not as a real legal
value). See tests `AC-10.LEG.001.1/.2`.

**Owed to a live onboarding session (OD-172 pattern):** the actual lawyer sign-off + the installed
per-jurisdiction floors are recorded at onboarding, before go-live, by the operator — the ISSUE-084 live
capstone. Until then `mayHandleRegulatedData` / `mayEnableSensitiveFeature` return **false** (fail-closed) in
both the fake and the live adapter, so no regulated-data path can silently open. The live adapter's
`recordLegalReview` is a no-op stub for exactly this reason (the record is an operational/onboarding artifact,
not an offline write path).

## Migration
**None authored** (per the issue). This slice registers CFG keys into the ISSUE-010 config store and asserts
the ISSUE-008 baseline via the offline lint. No `app/silo/migrations/*` touched.
