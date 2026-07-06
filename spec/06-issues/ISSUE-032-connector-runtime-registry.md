---
id: ISSUE-032
title: Connector contract + shared runtime + tool registry
epic: D — tool layer
status: done
github: "#32"
---

# ISSUE-032 — Connector contract + shared runtime + tool registry

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Stand up the generic connector contract + shared tool runtime + `tools` registry — the C3 spine that every connector instance (ISSUE-039/040/041) and every runtime concern (token/rate-limit/write/opt/trigger/disconnect) inherits, so the three non-negotiables are enforced once and cannot silently regress per tool.

## 2. Scope — in / out
**In:** The connector *contract* and the *shared runtime shell* that later C3 issues plug into, plus the tool registry. Concretely:
- The uniform tool contract shape + read/write path dispatch (CONN.001), the "safety machinery built once" runtime composition point (CONN.002), external-data boundary-tagging on every read (CONN.003), the idempotent-safe-re-run write obligation incl. the durable pre-call intent record + `idempotency_ledger` (CONN.004), and minimal-scope-per-connector incl. the delete-granting-scope exclusion (CONN.005).
- The `tools` registry table + registration validation that rejects a partially-defined tool (REG.001), description-drives-selection as a testable registry property (REG.002), tool versioning with mandatory `change_reason` + `previous_version_id` (REG.003), and the `client_slug`-is-not-an-RLS-key reconciliation (REG.004).
- The three C3 runtime tables that the machinery composes over: `tools`, `connector_credentials` (schema/state shell only), `rate_limit_tracker` (schema shell only), and the net-new `idempotency_ledger`.

**Out:**
- Token refresh *logic* (Layer-1/2/3, atomic rotate-persist) → **ISSUE-033** (C3 TOK). This issue only creates the `connector_credentials` shape + `state` enum the runtime reads.
- Rate-limit *behaviour* (80/95/429 tiers, backoff, halt-escalate) → **ISSUE-034** (C3 RL). This issue only creates the `rate_limit_tracker` shape.
- Write-tool *limits* (the seven hard limits) → **ISSUE-035** (C3 ACT). CONN.004's idempotency obligation and CONN.005's grant-level scope exclusion live here; the per-write hard-limit enforcement does not.
- Optimisation (confidence-gate/cache/batch/degrade) → **ISSUE-036**; trigger infra → **ISSUE-037**; disconnection/recovery flow → part of ISSUE-038.
- Per-connector endpoints/field-mappings/scopes/transport (the fill-in-the-blanks) → connector instances **ISSUE-039/040/041**.
- The memory-write action tool is registered here as a contract instance but its write-flow is **C2-owned** (FR-2.WRT.*, ISSUE-024) — do not implement its behaviour here.
- Inbound webhook *authentication* is **C0-owned** (FR-0.WHK.*, ISSUE-017) — the runtime consumes an already-verified event.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-3.CONN.001, FR-3.CONN.002, FR-3.CONN.003, FR-3.CONN.004, FR-3.CONN.005 (Component 3 — Tool Layer); FR-3.REG.001, FR-3.REG.002, FR-3.REG.003, FR-3.REG.004.
- **NFRs:** none directly owned (C3 runtime is the substrate; NFR postures are exercised by the behavioural issues 033–038). Boundary-tag (CONN.003) upholds the containment posture that NFR-SEC.006/007 rest on downstream.
- **Rests on:** ADR-001 (physical Silo isolation; per-client credentials custody), ADR-004 (idempotency / safe re-run), ADR-006 (agent path = `service_role`, no RLS; `client_slug` deleted from policies), ADR-007 (external-data boundary tag; containment-first), ADR-008 (in-DB credentials → backed up; golden rule); AF-088, AF-085, AF-095, AF-102 (see DoD gating spikes).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-3.CONN.001.1, AC-3.CONN.001.2
- AC-3.CONN.002.1, AC-3.CONN.002.2
- AC-3.CONN.003.1, AC-3.CONN.003.2
- AC-3.CONN.004.1, AC-3.CONN.004.2, AC-3.CONN.004.3, AC-3.CONN.004.4
- AC-3.CONN.005.1, AC-3.CONN.005.2, AC-3.CONN.005.3
- AC-3.REG.001.1, AC-3.REG.001.2
- AC-3.REG.002.1, AC-3.REG.002.2
- AC-3.REG.003.1, AC-3.REG.003.2
- AC-3.REG.004.1
- **Gating spikes (if any):** the following are `Ready`-on-paper but must be GREEN in `spec/00-foundations/feasibility-register.md` before the affected AC ships to production (all currently 🔴):
  - **AF-088** — prompt-injection containment for boundary-tagged untrusted content (gates FR-3.CONN.003; the tag is deterministic/always-on, but containment adequacy is the spike).
  - **AF-095** — confirm GHL has no `Idempotency-Key`; `/contacts/upsert` + app-side dedup is the substitute (gates FR-3.CONN.004 GHL arm, AC-3.CONN.004.2).
  - **AF-085** — Slack `chat.postMessage` app-side write-dedup design (gates FR-3.CONN.004 Slack arm, AC-3.CONN.004.3).
  - **AF-102** — Calendar `events.insert` 409-duplicate idempotency holds under rapid retry (gates FR-3.CONN.004 Calendar arm).
  - (Note: connector-arm ACs 004.2/004.3 exercise per-connector mechanisms delivered in ISSUE-039/040/041; the runtime *contract* and `idempotency_ledger` are proven here.)

## 5. Touches (complete blast radius, by ID)
- **DATA:** `DATA-tools` (created here), `DATA-connector_credentials` (schema + `credential_state` shell created here; refresh logic in ISSUE-033), `DATA-rate_limit_tracker` (schema shell created here; behaviour in ISSUE-034), `DATA-idempotency_ledger` (net-new, created here for CONN.004).
- **PERM:** `PERM-tool.manage` (registry edits = Admin/Super-Admin; node is *homed* in C1/C6 — consumed here, not defined here). Tool *invocation* runs as `service_role` (no per-tool RBAC gate).
- **CFG:** `CFG-tool_selection_confidence_threshold` (read by REG.002 / OPT.001 seam; owned by ISSUE-036). No new CFG keys are introduced by this slice.
- **UI:** none owned. The tool-registry admin view + version history is a Phase-3 surface not yet cut as a standalone `surface-NN` file; this issue delivers the backing contract only.
- **Connectors:** none instantiated here — GHL / Google / Slack are the fill-in-the-blanks instances (ISSUE-039/040/041). This issue is connector-agnostic.

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/01-requirements/component-03-tool-layer.md` §CONN (FR-3.CONN.001–005) + §REG (FR-3.REG.001–004) — the FR text + ACs + the architectural-spine note + the three drafting reconciliations.
- `spec/04-data-model/schema.md` §4 "Tools & Connectors (C3)" — the `tools`, `connector_credentials`, `rate_limit_tracker`, `idempotency_ledger` DDL; plus §"Global rules" (versioned-tables rule) and §"Types" (`tool_category`, `credential_state`).
- `spec/00-foundations/adr/ADR-001-isolation-model.md` — physical Silo isolation + per-client credentials custody (why `client_slug` is not a scoping key).
- `spec/00-foundations/adr/ADR-004-*.md` — idempotency / safe re-run (CONN.004).
- `spec/00-foundations/adr/ADR-006-*.md` — `service_role` agent path; `client_slug` deleted from policies (CONN.001 permissions, REG.004).
- `spec/00-foundations/adr/ADR-007-*.md` — external-data boundary tag; containment-first (CONN.003).
- `spec/00-foundations/adr/ADR-008-*.md` — in-DB credentials → backup; golden rule (TOK.001 seam / CONN context).
- `spec/00-foundations/feasibility-register.md` — AF-088, AF-085, AF-095, AF-102 rows (DoD gating spikes).

## 7. Dependencies
- **Blocked-by:** ISSUE-008 (migration harness — expand-contract + 0001 baseline; needed to lay the four C3 tables), ISSUE-010 (config store + secret manifest — `connector_credentials` is Vault-backed and the runtime reads config). Neither is a spike, so no AF-GREEN gate is imposed by the blocked-by edges (the AF gates in §4 are the slice's own feasibility items).
- **Blocks:** ISSUE-026 (memory ingestion needs registered read tools), ISSUE-033, ISSUE-034, ISSUE-035, ISSUE-036, ISSUE-037 (every C3 runtime concern plugs into this spine).

## 8. Build order within the slice
1. **Migration (schema §4):** create `tools`, `connector_credentials`, `rate_limit_tracker`, and the net-new `idempotency_ledger` via the ISSUE-008 harness; register the `tool_category` + `credential_state` enums from schema §Types. Apply the global versioned-table rule to `tools` (`version`, `previous_version_id`, `change_reason` NOT NULL).
2. **REG.004 reconciliation:** confirm no policy/query filters by `client_slug` on any C3 table (per ADR-006; the column is deleted, not label-only — mirror the C1 reconciliation). This is a review + CI-lint assertion, not new code.
3. **Registry validation (REG.001, REG.003):** registration/edit path rejects a row missing any required contract field, and rejects a version save with empty `change_reason`; every edit writes a new version row linking `previous_version_id`. Prior versions are retained (`enabled=false` hides without deleting).
4. **Contract dispatch (CONN.001):** the runtime reads a `tools` row and routes by `category` — `read` → read-only/cacheable path, `write` → the action path (stubbed to ISSUE-035's entry point) with the approval + idempotency obligations attached.
5. **Runtime composition point (CONN.002):** structure the runtime so token/rate-limit/boundary-tag/idempotency/recovery are *single* shared implementations a connector inherits by supplying parameters only — even where the behavioural bodies land in 033–038, the composition seams and "no per-connector safety code" invariant are established here.
6. **Boundary-tag on read (CONN.003):** the runtime annotates every read-tool return with the external-data boundary tag before it reaches memory/prompt; tagging failure is fail-closed + logged (never silent — #3). Selection driven by tool description (REG.002).
7. **Idempotency contract (CONN.004):** derive a deterministic idempotency key per external write, commit a durable intent record to `idempotency_ledger` **before** the external call, and suppress a second effect on retry with the same key (return prior result). Per-connector realisation (upsert / ts-dedup / client-`id`) is delivered by the instance issues; the ledger + pre-call-intent invariant is proven here.
8. **Minimal-scope contract (CONN.005):** the provisioning path requests only the tools' required read/write scopes and excludes any scope granting destructive delete-of-record (cheapest gate for hard-limit #3); unmet-scope tools degrade gracefully rather than returning silent empties.
9. **Tests to the ACs** in §4 (see Verification).

**Integration note (spans the bundled FRs):** CONN.002 is the keystone — it is *why* the later per-connector rotation/rate-limit traps are solved once. Build steps 4–8 as thin runtime seams with clear plug points for ISSUE-033/034/035/036/037/038; do not inline any connector-specific behaviour. CONN.003 (boundary tag) and CONN.004 (idempotency ledger) are the two pieces of *real* runtime machinery this issue must fully land; the rest are contract shape + composition scaffolding.

## 9. Verification (how DoD is proven)
- Unit + integration tests per `spec/05-non-functional/test-strategy.md`: registry validation (REG.001/003) and `client_slug`-absent lint (REG.004) at unit/CI-lint layer; boundary-tag-on-read (CONN.003) and idempotency-ledger pre-call-intent + retry-suppression (CONN.004) at integration layer; contract dispatch (CONN.001) and "second connector adds parameters only, no new safety code" (CONN.002.2) at integration/architecture-test layer; minimal-scope + delete-scope-exclusion (CONN.005) at provisioning-config test layer.
- **AC → Verified path:** the four gating AFs (AF-088/095/085/102) must reach GREEN in the feasibility register before the boundary-tag containment claim (CONN.003) and the connector-arm idempotency ACs (CONN.004.2/.3) are treated as proven-not-just-paper; the runtime-contract ACs (CONN.001/002/004.1/004.4, REG.*) verify independently of those spikes and gate the downstream C3 issues.
