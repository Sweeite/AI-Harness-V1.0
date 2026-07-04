# NFR — Security & Isolation  (`NFR-SEC`)

> **Context manifest.** Depends on: ADR-001 (isolation), ADR-007 (injection posture), ADR-006
> (RLS), C0 Block J (auth), and the enforcement FRs in C6 (guardrails) · C1 (RBAC) · C8 (agent
> hard limits) · C10 (isolation/compliance). **Reference-don't-re-spec:** each `NFR-SEC` row names
> the FR/ADR that *implements* it and adds only the security posture, the boundary invariant, or
> the verification method. The enforcement code is specified in those components; this file states
> the property that must hold and how it is proven.
>
> **Upholds primarily #2 (never do something it shouldn't)** — with #1 (isolation protects
> knowledge integrity) and #3 (every security event is loud) alongside.

### The NFR row shape (used by every Phase-5 domain file)

```
### NFR-<domain>.<nnn> — <short title>
- **Requirement:** The system shall <non-functional property / posture / threshold>.
- **Type:** posture | threshold | duty | verification
- **Upholds:** #1 | #2 | #3 | quality  (which non-negotiable, + one-line why)
- **Implemented by:** FR-*/AC-*/ADR-*  (the functional owner — reference, don't re-spec)
- **Target / threshold:** <number + config key, or N/A for a binary posture>
- **Verification:** DOCS | SPIKE | EVAL | LOAD | <test layer>  → AF-* gate (if paper-not-proven)
- **Launch gate:** blocking | fast-follow  (per RP-1, session 45)
- **Acceptance criteria:** AC-NFR-<id>.n — Given/When/Then (checkable).
- **Notes / OD:** <optional>
```

---

### NFR-SEC.001 — Physical per-client isolation

- **Requirement:** The system shall isolate each client in a dedicated Supabase project such that isolation is **physical (separate database), never an RLS predicate**, and no cross-client data path exists in application code.
- **Type:** posture (hard product invariant)
- **Upholds:** #2 (a client's data can never leak to another silo) + #1 (isolation protects knowledge integrity).
- **Implemented by:** FR-10.ISO.001 · ADR-001 §1/§3/§4.
- **Target / threshold:** binary — `client_slug` **deleted** from every application table (identity lives only in the mgmt-plane `client_registry`).
- **Verification:** DOCS (schema grep — no `client_slug` on any app table, confirmed in Phase-4 gate) + a build-time isolation test (no query joins across projects).
- **Launch gate:** blocking (foundational).
- **Acceptance criteria:**
  - AC-NFR-SEC.001.1 — Given the deployed schema, When every application table is inspected, Then none carries a `client_slug`/tenant column (only `client_registry` / `deployment_health` / `offboarding_records` on the separate mgmt deployment do).
  - AC-NFR-SEC.001.2 — Given a client silo, When any application query runs, Then it targets that silo's database only; there is no connection string or code path reaching another client's project.
- **Notes / OD:** OD-096 deleted the label; the only valid `client_slug` home is the mgmt plane (SEC.002).

### NFR-SEC.002 — Management-plane boundary (map, not warehouse)

- **Requirement:** The system shall allow only **operational metadata** to cross from a client silo to the management plane (health score, queue depth, alert counts, core version, cost estimate, backup health) — **never client business data** — and the flow shall be push-only.
- **Type:** posture.
- **Upholds:** #2 (a compromised mgmt plane leaks no client data).
- **Implemented by:** FR-10.MGT.003 · FR-7.MGM.001 · ADR-001 §7.
- **Target / threshold:** binary allow-list of metadata fields; ingest authenticated per-deployment (`internal_token`).
- **Verification:** DOCS (field allow-list) + a build-time test that the push payload contains no memory/entity/message content.
- **Launch gate:** blocking.
- **Acceptance criteria:**
  - AC-NFR-SEC.002.1 — Given the mgmt-plane push, When its payload is inspected, Then it contains only the allow-listed operational-metadata fields and zero business-data fields.
  - AC-NFR-SEC.002.2 — Given the mgmt-plane ingest endpoint, When a request arrives without a valid `internal_token`, Then it is rejected, logged, and alerted.
  - AC-NFR-SEC.002.3 — Given an operator needs to see inside a client, When they open that client's data, Then they navigate into the client's own deployment under that client's RBAC (not a mirror in the mgmt plane).
- **Notes / OD:** the one place `client_slug` legitimately exists (FR-10.MGT.001).

### NFR-SEC.003 — Secrets custody

- **Requirement:** The system shall store all secrets (Supabase service key, model API keys, per-connector OAuth secrets, `internal_token`) in the operator-controlled Railway environment only — never in the repo, the design config, or any client-readable surface — and shall expose secrets in the UI as **presence + last-rotated only, never the value**.
- **Type:** posture + duty.
- **Upholds:** #2 (least privilege; a leaked surface never yields a live credential).
- **Implemented by:** FR-10.PRV.003 (provisioning) · FR-7.LOG.005 (never in logs) · config-registry §secrets · surface-01 #secrets (read-only).
- **Target / threshold:** rotation is out-of-band; the 11 registry SECRETs are never UI-editable (config-edit-taxonomy rule 2).
- **Verification:** DOCS + a build-time test that `event_log`/`guardrail_log` payloads and any UI response redact secret values.
- **Launch gate:** blocking.
- **Acceptance criteria:**
  - AC-NFR-SEC.003.1 — Given any secret, When it is rendered on a surface, Then only its presence + last-rotated timestamp appear; the value is never returned to the client.
  - AC-NFR-SEC.003.2 — Given any log write, When a payload would contain a token/secret/credential, Then it is redacted before the row is written (FR-7.LOG.005).
- **Notes / OD:** rotation mechanism is operator-runbook (INF domain), not a surface.

### NFR-SEC.004 — The seven hard limits are code-enforced and non-overridable

- **Requirement:** The system shall enforce, in code, seven hard limits that **no approval can override** — no autonomous (1) external email/send, (2) financial transaction, (3) record deletion, (4) cross-client data share, (5) impersonation, (6) self-approval, (7) treating tool-returned content as instructions — and shall present **no approve affordance** for a hard-limit-blocked action anywhere in the product.
- **Type:** posture (the #2 keystone).
- **Upholds:** #2 (the system's absolute floor of what it may never do autonomously).
- **Implemented by:** FR-6.HRD.001/002/003 · FR-8.SPC.003/004/005 · AC-8.SPC.003.3/004.3/005.2 (rejected-at-write) · ADR-007 §1.
- **Target / threshold:** binary; every hit logged immediately + alerted (FR-6.HRD.002).
- **Verification:** **SPIKE — red-team** (AF-068): drive the running system and confirm there is **no authorized-but-dangerous autonomous path** past any of the seven; also unit + agent-definition-write tests.
- **Launch gate:** **blocking** (RP-1) — the containment boundary must be proven before go-live.
- **Acceptance criteria:**
  - AC-NFR-SEC.004.1 — Given any agent run, When it attempts one of the seven hard-limited actions autonomously, Then the action is blocked at the code layer, logged, and alerted — and there is no UI path to approve it.
  - AC-NFR-SEC.004.2 — Given the agent-registry editor, When a definition would grant Comms send / Finance transact / a non-Memory-Agent memory write, Then the write is rejected at save (not merely audited).
  - AC-NFR-SEC.004.3 — Given the red-team battery (AF-068), When executed against the running system, Then no test achieves a hard-limited effect without an explicit, authorized, non-bypassable human step.
- **Notes / OD:** AF-068 also gates the *enforceability claim* (AF-068 is the standing gate on the hard-limit set). **AF-068 gate 🟢 PASS (2026-07-04, ISSUE-003)** — the red-team battery drove a containment-first harness (a fully-compromised, maximally-obedient model) and confirmed no authorized-but-dangerous autonomous path past the seven limits / approval floor / RBAC-RLS / isolation; 12/12 attacks contained, mutation-tested. Per the `AC → Verified` rule (`test-strategy.md` §1), AC-NFR-SEC.004.1/.3 are proven **against the stub** and reach `Verified` when the same retained battery passes against the shipped enforcement code (ISSUE-055/059/020). Evidence: `spikes/issue-003-injection-containment/results/af-068-evidence.2026-07-04.md`.

### NFR-SEC.005 — Coverage-gap posture (gate, don't promote)

- **Requirement:** The system shall treat the seven hard limits as an audited safe-default and route **newly-identified dangerous capabilities** (bulk export, mass-delete, external post, spend, config change) to **hard-approval + rate caps — not** to new hard limits — with any change to the hard-limit set passing change-control.
- **Type:** posture.
- **Upholds:** #2 (coverage gaps fail safe to human approval, not to silent permission).
- **Implemented by:** FR-6.HRD.004 · OD-047.
- **Target / threshold:** N/A (governance posture).
- **Verification:** DOCS (change-control review of any hard-limit-set change).
- **Launch gate:** blocking (governance in place at launch).
- **Acceptance criteria:**
  - AC-NFR-SEC.005.1 — Given a new dangerous capability, When it is added, Then it is gated by hard-approval + a rate cap and is reachable only via an authorized human step.
- **Notes / OD:** —

### NFR-SEC.006 — Containment-first injection posture

- **Requirement:** The system shall make its prompt-injection defense **code-enforced capability control** (RBAC, hard limits, approval gates, rate limits, isolation) rather than detection; semantic-similarity detection shall be **off by default**, signal-only, and shall **never autonomously gate**; a high-confidence injection match shall **quarantine (retain) and route to a human**, never auto-discard.
- **Type:** posture.
- **Upholds:** #2 (a successful injection still cannot exceed the agent's real capabilities) + #1 (quarantine never loses the content) + #3 (every match is logged).
- **Implemented by:** FR-6.INJ.001–006 · ADR-007 §2–5 · `injection_semantic_detection_enabled=false`.
- **Target / threshold:** quarantine threshold >0.95 combined / high-confidence literal (FR-6.INJ.006); deterministic regex layer always-on.
- **Verification:** SPIKE red-team (AF-068, shared with SEC.004) + EVAL of the pattern/embedding library coverage (AF-117, fast-follow).
- **Launch gate:** **blocking** (the containment posture, via AF-068); the library-coverage EVAL (AF-117) is fast-follow. **AF-068 gate 🟢 PASS (2026-07-04, ISSUE-003)** — quarantine retained + human-routed (`human_decision=null`, `guardrail_log` type `prompt_injection`); `injection_semantic_detection_enabled=false` at boot; **8 evasion payloads that evaded quarantine still reached the model and were contained by the code gate** ("contained, not caught" — ADR-007 part 1), i.e. containment does not depend on detection. AC-NFR-SEC.006.1/.2/.3 proven against the stub; Verify against shipped code (ISSUE-059/055/020). AF-117 (detection-signal quality) remains a separate fast-follow EVAL and does not gate containment.
- **Acceptance criteria:**
  - AC-NFR-SEC.006.1 — Given tool-returned content containing an injection attempt, When an agent processes it, Then the agent's actions remain bounded by its RBAC + hard limits + approval gates regardless of the injected instruction.
  - AC-NFR-SEC.006.2 — Given a high-confidence injection match, When it fires, Then the content is quarantined (retained), routed to a human, and logged to `guardrail_log` as `prompt_injection` — never auto-discarded.
  - AC-NFR-SEC.006.3 — Given the default config, When the system boots, Then `injection_semantic_detection_enabled=false` and no detector autonomously blocks a step.
- **Notes / OD:** ADR-007 is the spine; detection is observability, not a gate.

### NFR-SEC.007 — External-data boundary tagging

- **Requirement:** The system shall wrap all tool-read content in `<external_data>…</external_data>` before it enters a prompt, and the Layer-1 system prompt shall state that tagged content is data, never instructions.
- **Type:** duty.
- **Upholds:** #2 (the model is told, structurally, what is untrusted).
- **Implemented by:** FR-6.INJ.004 · C4 INJ layer.
- **Target / threshold:** mandatory at the tool-read → prompt-assembly seam.
- **Verification:** build-time test (every tool-read path emits the wrapper).
- **Launch gate:** blocking.
- **Acceptance criteria:**
  - AC-NFR-SEC.007.1 — Given any tool-returned content, When it is assembled into a prompt, Then it is enclosed in the external-data boundary tags and the Layer-1 prompt's data-not-instructions statement is present.
- **Notes / OD:** —

### NFR-SEC.008 — Webhook authentication & anti-replay

- **Requirement:** The system shall verify every inbound webhook with its vendor-specific scheme (HMAC / **Ed25519** for GHL per OD-046 / OIDC), reject an unverified or replayed request with 401 + log + alert, and never process an unauthenticated payload.
- **Type:** posture + verification.
- **Upholds:** #2 (a forged event cannot drive the system).
- **Implemented by:** FR-0.WHK.001–005 · OD-046.
- **Target / threshold:** alert on >3 verification failures / source / hour.
- **Verification:** **end-to-end test — forgery + replay rejected** (AF-078).
- **Launch gate:** **blocking** (RP-1).
- **Acceptance criteria:**
  - AC-NFR-SEC.008.1 — Given a webhook with an invalid/absent signature, When it arrives, Then it is rejected 401, logged, and (past threshold) alerted, and no downstream task is created.
  - AC-NFR-SEC.008.2 — Given a previously-seen (replayed) webhook, When it arrives again, Then it is rejected/deduplicated and does not re-trigger work (AF-078).
- **Notes / OD:** the C3 harvest corrected GHL HMAC→Ed25519 via OD-046.

### NFR-SEC.009 — Brute-force / credential defense (external Super-Admin path)

- **Requirement:** The system shall defend the external Super-Admin password+2FA login against brute-force with lockout/backoff that demonstrably stops an automated attack.
- **Type:** verification.
- **Upholds:** #2 (the one password path cannot be brute-forced).
- **Implemented by:** FR-0.AUTH.* (2FA + lockout) · C0 Block J.
- **Target / threshold:** lockout/backoff thresholds (config; confirmed at spike).
- **Verification:** **attack simulation** (AF-077).
- **Launch gate:** **blocking** (RP-1).
- **Acceptance criteria:**
  - AC-NFR-SEC.009.1 — Given a scripted credential-stuffing attack, When run against the Super-Admin login, Then lockout/backoff halts it before success (AF-077), and the attempts are logged + alerted.
- **Notes / OD:** client-tenant users are OAuth-only (OD-018) — no password path to brute-force.

### NFR-SEC.010 — Complete aal2 + RLS coverage

- **Requirement:** The system shall enforce 2FA deployment-wide via `aal2` RLS and shall guarantee **every** application table carries an RLS policy (no unguarded table), verified by an automated coverage check.
- **Type:** duty + verification.
- **Upholds:** #2 (no table is silently world-readable; 2FA is not bypassable per-table).
- **Implemented by:** FR-0.AUTH.008 · FR-1.RLS.* · ADR-006 · rls-policies.md.
- **Target / threshold:** 100% table coverage.
- **Verification:** **table audit + CI/lint gate** (AF-076, AF-079) — a migration that adds a table without a policy fails CI.
- **Launch gate:** **blocking** (a coverage hole is a #2 breach).
- **Acceptance criteria:**
  - AC-NFR-SEC.010.1 — Given the schema, When the coverage check runs, Then every application table has an RLS policy and any table lacking one fails the build (AF-079).
  - AC-NFR-SEC.010.2 — Given a human-path session below aal2, When it queries an aal2-gated resource, Then RLS denies it (AF-076).
- **Notes / OD:** AF-076/079 are the CI-gate spikes.

### NFR-SEC.011 — service_role blast radius bounded

- **Requirement:** The system shall bound the agent-path `service_role` (which bypasses RLS) by harness RBAC plus the C8 per-agent `memory_scope` fail-closed filter, such that an agent's effective access is `scope ∩ clearance` and a missing/failed scope predicate **denies**, never opens.
- **Type:** posture + duty.
- **Upholds:** #2 (the one credential that bypasses RLS is still least-privilege).
- **Implemented by:** FR-8.SCO.001/002 · AC-5.ASM.006.2 (fail-closed) · AC-2.RET.004.2 · OD-081.
- **Target / threshold:** fail-closed on scope-resolution failure.
- **Verification:** build-time test (scope-resolution failure denies retrieval) + agent-path audit completeness (AF-081, fast-follow).
- **Launch gate:** blocking (the fail-closed behaviour); AF-081 audit-completeness is fast-follow.
- **Acceptance criteria:**
  - AC-NFR-SEC.011.1 — Given an agent retrieval, When its `memory_scope` cannot be resolved, Then retrieval is denied (fail-closed), not defaulted to all.
  - AC-NFR-SEC.011.2 — Given an agent with scope S and the caller's clearance C, When it retrieves, Then only memories in `S ∩ C` are returned; Restricted is never auto-injected.
- **Notes / OD:** OD-081 wired the enforcement consumer via change-control (C5+C2).

### NFR-SEC.012 — Mid-task authorization re-check

- **Requirement:** The system shall re-check the originating user's active status and clearances at each step / injection boundary of a `service_role` task and, on deactivation or clearance-revocation, **halt and quarantine (retaining work-in-progress)** before any further consequential side effect — while a benign session expiry continues.
- **Type:** duty.
- **Upholds:** #2 (a revoked user's task cannot keep acting) + #1 (WIP is retained, not dropped).
- **Implemented by:** FR-5.ASM.005 · FR-2.WRT.006 · FR-1.RLS.007 · OD-031.
- **Target / threshold:** re-check at every step/injection boundary.
- **Verification:** build-time test (revoke mid-task → halt+quarantine before side effect) + agent-path audit completeness (AF-081).
- **Launch gate:** blocking.
- **Acceptance criteria:**
  - AC-NFR-SEC.012.1 — Given a running `service_role` task, When the originating user is deactivated or a required clearance is revoked, Then the task halts and quarantines its WIP before the next consequential side effect, and the halt is logged.
  - AC-NFR-SEC.012.2 — Given a benign session expiry (no deactivation/revoke), When it occurs mid-task, Then the task continues (FR-0.SESS.006 reconciliation).
- **Notes / OD:** —

### NFR-SEC.013 — No back-door (every path runs the identical gate)

- **Requirement:** The system shall route every action — on every surface **including mobile** — through the identical C1 permission-node gate and C6 guardrail pipeline; a destructive command's node-gate shall be evaluated **before** any confirm prompt; deep-management actions shall degrade to an explicit "open on a wider display" notice, never a silent omission or a shortcut bypass.
- **Type:** posture.
- **Upholds:** #2 (no surface is a weaker door than another).
- **Implemented by:** FR-9.MODE.003 · FR-9.CMD.003 · AC-9.CMD.008.4 · mobile no-bypass (surface-12).
- **Target / threshold:** N/A (uniform-pipeline invariant).
- **Verification:** build-time test (a mobile/quick-command action reaches the same node-gate + C6 pipeline as the desktop path).
- **Launch gate:** blocking.
- **Acceptance criteria:**
  - AC-NFR-SEC.013.1 — Given the same action invoked from desktop, mobile, a `/`-command, or the quick-tap menu, When it runs, Then it passes the identical node-gate and C6 pipeline; none is a bypass.
  - AC-NFR-SEC.013.2 — Given a destructive command from an unauthorized caller, When invoked, Then the node-gate denies it **before** any confirm dialog is shown.
- **Notes / OD:** the mobile Modify/deep-management set degrades to a notice (surface-12).

### NFR-SEC.014 — Least-privilege on custom commands

- **Requirement:** The system shall allow a manager to gate a custom command only on a permission node they are themselves authorized to assign, and a command definition shall **never lower** the C6 tier of the action it wraps (it may only add friction).
- **Type:** posture.
- **Upholds:** #2 (a command author cannot widen audience or weaken guardrails past their own authority).
- **Implemented by:** AC-9.CMD.006.4 · AC-9.CMD.008.4 · OD-142/143.
- **Target / threshold:** N/A.
- **Verification:** build-time test (save-time rejection of an over-authority node; invocation runs the wrapped action's own C6 tier).
- **Launch gate:** blocking.
- **Acceptance criteria:**
  - AC-NFR-SEC.014.1 — Given a manager authoring a command, When they set an invocation node above their own authority, Then the save is rejected.
  - AC-NFR-SEC.014.2 — Given a custom command wrapping a hard-tier action, When invoked, Then it runs the same C6 tier as any agent run; the definition cannot downgrade it.
- **Notes / OD:** —

### NFR-SEC.015 — Two-person authorization for sensitive deletion

- **Requirement:** The system shall require a distinct second authoriser (no self-execution) for erasure of Restricted/Personal/system-of-record data, enforced at the database layer.
- **Type:** posture.
- **Upholds:** #2 (no single actor can destroy sensitive data) + #1 (deletion is deliberate).
- **Implemented by:** FR-10.DEL.006 · AC-10.DEL.006.2 · schema.md `deletion_requests` distinctness CHECK (Phase-4 re-audit).
- **Target / threshold:** three non-null distinct people at `status='executed'`.
- **Verification:** DB CHECK (`is distinct from`, NULL-safe) + build-time test.
- **Launch gate:** blocking.
- **Acceptance criteria:**
  - AC-NFR-SEC.015.1 — Given a sensitive-deletion request, When one person tries to both request and execute it, Then the DB CHECK rejects the execution.
  - AC-NFR-SEC.015.2 — Given an executed deletion, When its row is inspected, Then requester, authoriser, and executor are three distinct, non-null identities.
- **Notes / OD:** Phase-4 re-audit tightened the CHECK to NULL-safe.

### NFR-SEC.016 — Reason-capture on sensitive mutations

- **Requirement:** The system shall require a reason on every Restricted grant and shall capture (optionally) a reason on role change, clearance revoke, and deactivation, writing it to `access_audit`.
- **Type:** duty.
- **Upholds:** #2 (chain-of-custody on authority changes) + #3 (the why is never lost).
- **Implemented by:** FR-1.RST.002 · OD-112.
- **Target / threshold:** reason mandatory for Restricted; captured-if-given elsewhere.
- **Verification:** build-time test (Restricted grant without a reason is rejected).
- **Launch gate:** fast-follow (audit-completeness enhancement; the grant itself is gated regardless).
- **Acceptance criteria:**
  - AC-NFR-SEC.016.1 — Given a Restricted grant, When it is submitted without a reason, Then it is rejected; When submitted with one, Then the reason is written to `access_audit`.
- **Notes / OD:** —

### NFR-SEC.017 — Off-platform backup is client-held and encrypted (custody)

- **Requirement:** The system shall write the off-platform backup to a **client-owned**, encrypted destination in a different region, independent of the primary project lifecycle — the operator orchestrates but never holds the copy (an operator-held copy is a logged per-client exception).
- **Type:** posture (security-custody view of ADR-008; the DR/recovery view is in `backup-dr.md`).
- **Upholds:** #2 (the operator's blast radius excludes the client's backup) + #1 (survives the billing-lapse→deletion path).
- **Implemented by:** ADR-008 §2 · FR-10 (offboarding/provisioning seam).
- **Target / threshold:** encrypted, client-owned, different region.
- **Verification:** DOCS (region + custody) — AF-071 confirms residency; the restore proof is AF-069 (`backup-dr.md`).
- **Launch gate:** blocking (custody model in place); the restore *proof* is DR-domain blocking.
- **Acceptance criteria:**
  - AC-NFR-SEC.017.1 — Given the off-platform backup, When its custody is inspected, Then it is held by the client (not the operator) in a different region, encrypted; any operator-held copy is a logged exception.
- **Notes / OD:** see `backup-dr.md` NFR-DR.* for the recovery-side requirements.

---

## Accessibility baseline (`NFR-A11Y`) — see note

The accessibility floor (RP-3: baseline, full WCAG audit deferred to OOS) is specified as
`NFR-A11Y.001–002` at the end of **`observability.md`** (co-located with the surface-UX perceivability
duties — "never-false-healthy", honest indicators — since accessibility is the same *"the human can
perceive the true state"* family). Cross-referenced here for the SEC reader.

---

*Drafted session 45 (2026-07-01). Exemplar file — establishes the `NFR-*` row shape for the other
seven domain files. Cites verified against the Phase-1 components + ADRs at draft; re-checked by the
Phase-5 verification gate.*
