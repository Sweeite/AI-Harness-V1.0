---
id: ISSUE-007
title: Provisioning + per-client Supabase bootstrap
epic: A — foundations
status: ready
github: "#7"
---

# ISSUE-007 — Provisioning + per-client Supabase bootstrap

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Stand up a new client deployment via the scripted, idempotent, two-party provisioning flow — Railway link → `DEPLOYMENT_CONFIG` + secrets → `internal_token` mint/dual-store → `client_registry` insert → first-deploy seed → `initialising` — plus per-client OAuth-app registration, the client-side runbook, and the synthetic canary fixture.

## 2. Scope — in / out
**In:** The operator-side provisioning **orchestration** for a brand-new client silo: the provisioning script that links the Railway project to the shared repo, sets `DEPLOYMENT_CONFIG` + the env-secret set, mints and dual-stores the `internal_token`, inserts the `client_registry` row, and triggers the first deploy that runs the seed (leaving status `initialising`); idempotent + loud-on-partial-failure behaviour. Per-client OAuth-app registration in the client's own accounts (login provider + Gmail/Drive/Calendar/GHL/Slack), redirect URIs to the deployment domain, Google production-verification treated as a scheduled lead-time dependency. The client-side onboarding runbook (accounts + card + delegated access — the hybrid-ownership precondition). The seeded synthetic-client fixture/corpus that the canary boots (corpus provisioning only).

**Out:**
- **The `client_registry` table schema + status-lifecycle transitions, the ingest endpoint, push-only flow, and the full `internal_token` lifecycle (rotate/revoke)** — owned by ISSUE-012 (C10 MGT.001–004). This issue *writes the first row* and *mints+dual-stores the token*; ISSUE-012 owns the table DDL, transition machinery, and rotation/revocation. The management deployment must already exist (ISSUE-012 tier-2) for the registry write to land; see the integration note in §8.
- **The idempotent first-boot seed logic itself** (Internal Org + first Super Admin + roles + agents) — owned by C0 `FR-0.SEED.*` / C1 `FR-1.ROLE.001`; provisioning only *triggers* it via the first deploy.
- **The migration harness / `drizzle-kit migrate` on release** — ISSUE-008. **The release-train / canary promotion gate + the smoke-battery assertions** — ISSUE-080 (C10 DEP) and the assertions' home components (C2/C5/C8); this issue provisions only the synthetic *corpus* the canary boots.
- **Secrets-custody NFR depth** (Railway holds each client's keys) — NFR-SEC posture, Phase 5.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-10.PRV.001, FR-10.PRV.002, FR-10.PRV.003, FR-10.PRV.004 (Component 10 — Infrastructure & Compliance).
- **NFRs:** NFR-INF.006 (scripted/idempotent/two-party, fails-loud-on-partial), NFR-INF.007 (per-client OAuth + Google verification lead-time), NFR-INF.008 (synthetic canary corpus + smoke battery), NFR-INF.014 (idempotent seed + crash-window resume — the seed step invoked here).
- **Rests on:** ADR-005 (§5 provisioning, §6 per-client OAuth + canary corpus), ADR-001 (§3 identity only in `client_registry`, §5 hybrid ownership, §7 management plane), AF-004, AF-013, AF-066.

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-10.PRV.001.1, AC-10.PRV.001.2, AC-10.PRV.001.3
- AC-10.PRV.002.1, AC-10.PRV.002.2
- AC-10.PRV.003.1, AC-10.PRV.003.2
- AC-10.PRV.004.1, AC-10.PRV.004.2
- AC-NFR-INF.006.1, AC-NFR-INF.006.2, AC-NFR-INF.006.3
- AC-NFR-INF.007.1, AC-NFR-INF.007.2
- AC-NFR-INF.008.1, AC-NFR-INF.008.2
- **Gating spikes (if any):** AF-004 (end-to-end provisioning against a client-owned Supabase — currently 🔴) must be GREEN before this issue ships (RP-1 blocking-by-posture; feasibility-register). AF-013 (Google production-verification lead-time — 🟢 verified, treated as a schedule dependency, not a code gate) and AF-066 (canary-corpus representativeness — 🔴, fast-follow) attach as build-time notes; AF-020 (🟢) underlies the first-deploy path.

## 5. Touches (complete blast radius, by ID)
- **DATA:** `client_registry` (management-plane; this issue **inserts** the first row + writes the encrypted `internal_token` — table DDL owned by ISSUE-012); the new silo's seed tables (written by C0/C1 seed, not here); `secret_manifest` (presence of the env-secret set — required-missing blocks boot).
- **PERM:** operator / Super Admin (provisioning is operator-side; no in-app permission node — `PERM-config.infra` governs later infra config edits, not provisioning itself).
- **CFG:** `DEPLOYMENT_CONFIG` (non-secret JSON), the ~11-env-secret set (`secret_manifest` keys); region default `ap-southeast-2` (FR-10.ISO.003); per-connector `client_id`/`client_secret`; `CFG-canary_soak_minutes` (consumed by the promotion gate, ISSUE-080 — referenced, not set here).
- **UI:** none (operator-run script + operational runbooks; no in-app surface).
- **Connectors:** GHL / Google / Slack — per-client OAuth **app registration** in the client's own accounts (not the runtime token lifecycle, which is C3 / ISSUE-033).

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/01-requirements/component-10-infra-compliance.md` §PRV (FR-10.PRV.001–004 — the FR text + ACs)
- `spec/05-non-functional/infrastructure.md` (NFR-INF.006, .007, .008, .014 — the posture + `AC-NFR-INF.*`)
- `spec/00-foundations/adr/ADR-005-deploy-provisioning.md` (§5 provisioning, §6 per-client OAuth + canary, §C2 synthetic corpus)
- `spec/00-foundations/adr/ADR-001-isolation-model.md` (§3 identity in `client_registry`, §5 hybrid ownership, §7 management plane)
- `spec/04-data-model/schema.md` §13 Management plane (`client_registry` — the row this issue inserts) and §12 Config cluster (`config_values`, `secret_manifest`)

## 7. Dependencies
- **Blocked-by:** none (foundational — tier-1 bootstrap root of the critical path). Gated by spike **AF-004** (must be GREEN before ship, per RP-1 / the feasibility register — see §4).
- **Blocks:** ISSUE-008 (migration harness), ISSUE-080 (release model). Integration-coupled to ISSUE-012 (management plane must exist for the `client_registry` write — see §8).

## 8. Build order within the slice
1. **Client-side runbook first (FR-10.PRV.004):** the consent-gated document — client creates Supabase (region `ap-southeast-2`) + Anthropic/OpenAI + connector SaaS accounts, puts card on each, grants operator delegated access. This is the precondition the script depends on; nothing operator-side can run until delegated access exists.
2. **Per-client OAuth-app registration (FR-10.PRV.002):** register the client's own OAuth apps (login + connector) in their accounts, redirect URIs → deployment Railway domain, secrets into the deployment env. **Start Google production verification early** (AF-013 lead-time) — it is a schedule dependency, sequenced ahead of go-live, not code.
3. **The provisioning script (FR-10.PRV.001):** Railway link → `DEPLOYMENT_CONFIG` + env secrets (populate `secret_manifest` presence) → mint `internal_token` + dual-store (Railway env + management DB) → insert `client_registry` row → trigger first deploy → seed runs (C0/C1) → status `initialising`. Build the **idempotent + loud-on-partial-failure** behaviour into every step (re-run converges; a missing secret / failed seed fails visibly, never a silent half-silo).
4. **Synthetic canary fixture (FR-10.PRV.003):** provision the fixed synthetic-client corpus (curated entities + message/email corpus + seeded memories) the canary boots; shared with the AF-001/AF-002 spike corpus. Assertions themselves are out of scope (C2/C5/C8 own them; ISSUE-080 wires the gate).
5. Verify to the ACs (§9).

**Integration note (spans this slice ↔ ISSUE-012):** steps 3's `client_registry` insert + `internal_token` dual-store *land in* tables and a management deployment that **ISSUE-012 owns** (FR-10.MGT.001 table DDL + status lifecycle; FR-10.MGT.004 token rotate/revoke). This issue is the **producer** of the first row + the mint; ISSUE-012 is the **owner** of the schema, the transition machinery, and the token's later lifecycle. Sequence ISSUE-012's management-plane bootstrap (or at minimum its `client_registry` DDL) before a real provisioning run so the write has a target; the `initialising` status this issue sets is the first transition ISSUE-012's lifecycle recognises. Do not re-declare the `client_registry` schema here.

## 9. Verification (how DoD is proven)
- **Layer (per `spec/05-non-functional/test-strategy.md`):** end-to-end / integration — the AF-004 spike is the load-bearing proof (operator Railway app deploying from the shared repo against a client-owned Supabase, env + secrets + `internal_token` dual-store + `client_registry` row + first-boot seed all green); plus build-time smoke checks that (a) a re-run after partial failure converges idempotently (AC-NFR-INF.006.1) and (b) a partial provision fails loud (AC-NFR-INF.006.2, AC-10.PRV.001.3).
- **`AC-NFR-*` posture that must hold:** NFR-INF.006 (idempotent, atomic-or-loud on partial) is the launch-gating posture (RP-1, AF-004 blocking); NFR-INF.007 (per-client OAuth, no shared operator app — verified via DOCS + the registration walk-through), and NFR-INF.008 (the synthetic corpus exists and is boot-able as the canary fixture; coverage adequacy is AF-066, fast-follow).
- **AC → `Verified` path:** the PRV ACs move to `Verified` once the AF-004 spike is GREEN and the idempotency/fail-loud build-time tests pass; AF-013 (Google verification) is closed as a scheduling dependency, AF-066 as fast-follow — neither blocks the correctness ACs above.
