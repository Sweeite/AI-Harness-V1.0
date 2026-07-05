---
id: ISSUE-059
title: Injection sanitization pipeline (4-step) + quarantine (retain + route-to-human)
epic: G — guardrails
status: in-progress
github: "#59"
---

# ISSUE-059 — Injection sanitization pipeline (4-step) + quarantine (retain + route-to-human)

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Build the application-layer, four-step prompt-injection pipeline (regex always-on → semantic OFF-by-default → boundary-wrap → log → high-confidence quarantine) that runs on every monitored-tool read between tool-read and AI-call, and quarantines high-confidence hits by **retaining** the content and routing it to a human — never machine-discarded, never silently passed.

## 2. Scope — in / out
**In:** The C6 INJ pipeline as *policy + mechanism*: the deterministic regex layer (the literal-pattern library), the off-by-default embedding semantic scan and its two signal-tuning thresholds, the `<external_data>` boundary-wrap ordering guarantee, the per-match `prompt_injection` log emission, and the high-confidence quarantine flow (retain to `injection_quarantine`, pause + set `flagged`, surface to reviewer, human-only discard/include decision, staleness escalation). This slice owns the pipeline call-site contract at the tool-read → AI-call seam and the quarantine review workflow.

**Out:**
- The **harness step-order invocation point** (naming the sanitization step in `FR-5.ASM.007`) — owned by the C5 run-pipeline **ISSUE-053**; this slice only defines the call-site contract it must honour (AC-6.INJ.001.2 cross-component note).
- The **`<external_data>` tag *application* at tool read** — owned by the connector runtime **ISSUE-032** (C3); the **Layer-1 data-not-instructions instruction** — owned by **ISSUE-043** (C4 FR-4.CID.003). This slice owns only pipeline *ordering* (sanitize-then-tag-then-inject).
- The **`guardrail_log` table + append-only/write-completeness invariant + FMM fail-closed** — owned by **ISSUE-060** (C6 LOG/FMM/OPT); this slice *writes* `prompt_injection` rows against that contract.
- The **`flagged` state machine, reviewer notification, three-resolution + escalation-timeout workflow** — owned by **ISSUE-056** (C6 ESC + APR); this slice *sets* `flagged` via FR-6.ESC.001 and *reuses* the FR-6.ESC.004 staleness owner for quarantine reviews.
- The seven **hard limits** (the containment boundary that actually makes a missed injection harmless) — owned by **ISSUE-055** (C6 HRD). Injection detection here is signal, not the security boundary (ADR-007 §1).

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-6.INJ.001, FR-6.INJ.002, FR-6.INJ.003, FR-6.INJ.004, FR-6.INJ.005, FR-6.INJ.006 (all component-06 Guardrails, area INJ).
- **NFRs:** NFR-SEC.006 (containment-first injection posture), NFR-SEC.007 (external-data boundary tagging).
- **Rests on:** ADR-007 (§1 containment-primary, §2 keep-deterministic-layers, §3 detection-as-signal, §4 retain-route-to-human, §5 every-event-loud, §6 thresholds-are-signal-knobs); AF-068 (containment red-team — the load-bearing gate, proven by spike ISSUE-003); AF-117 (semantic-library coverage EVAL, fast-follow).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-6.INJ.001.1, AC-6.INJ.001.2 (call-site seam — the C5 step-order naming it is ISSUE-053's DoD; this slice satisfies the C6 side of the contract)
- AC-6.INJ.002.1, AC-6.INJ.002.2
- AC-6.INJ.003.1, AC-6.INJ.003.2
- AC-6.INJ.004.1
- AC-6.INJ.005.1
- AC-6.INJ.006.1, AC-6.INJ.006.2, AC-6.INJ.006.3, AC-6.INJ.006.4
- AC-NFR-SEC.006.1, AC-NFR-SEC.006.2, AC-NFR-SEC.006.3
- AC-NFR-SEC.007.1
- **Gating spikes:** AF-068 must be GREEN before this issue ships (proven by **ISSUE-003** — injection containment red-team, blocking per OD-157/RP-1; NFR-SEC.006 launch-gate = blocking via AF-068). AF-117 (semantic-library EVAL) is **fast-follow**, not launch-blocking — the semantic scan ships OFF by default, so a fresh deployment does not depend on it (AC-6.INJ.003.1).

## 5. Touches (complete blast radius, by ID)
- **DATA:** `injection_quarantine` (schema.md §7 Guardrails — net-new; `quarantined_content` never machine-discarded; `human_decision` ∈ `quarantine_decision` enum `{discard, approved_safe}`, null = pending; `escalated_at`); `guardrail_log` (§7 — writes rows of type `prompt_injection`; table + invariant owned by ISSUE-060).
- **PERM:** none new. Quarantine review uses the inherited C1 approval-reviewer roles (contextual routing, per C6 touchpoints); `PERM-config.guardrails` gates the injection CFG keys (owned by config surface ISSUE-086).
- **CFG:** `injection_semantic_detection_enabled` (false at boot), `injection_semantic_threshold` (0.85), `injection_quarantine_threshold` (0.95; constraint `injection_semantic_threshold ≤ injection_quarantine_threshold`), `approval_escalation_timeout` (reused for quarantine-review staleness, shared with ISSUE-056).
- **UI:** Quarantine-review surface (discard vs review-and-include, human-only logged decision). The generic flagged-item reviewer + approval queue are ISSUE-056; the guardrail export/dashboard view is C7 (ISSUE-077/078).
- **Connectors:** none directly. Consumes monitored-tool content from GHL / Google / Slack via the connector runtime (ISSUE-032); no connector code changes here.

## 6. Context manifest (the EXACT files to open — nothing more)
- `spec/01-requirements/component-06-guardrails.md` — FR-6.INJ.001–006 text + ACs (area INJ); FR-6.ESC.001/004 for the `flagged`-set + staleness-owner references.
- `spec/04-data-model/schema.md` §7 Guardrails — `guardrail_log` + `injection_quarantine` tables; §Types for `guardrail_type` and `quarantine_decision` enums.
- `spec/00-foundations/adr/ADR-007-injection-posture.md` — the containment-first posture (parts 1–6) this slice implements.
- `spec/05-non-functional/security.md` — NFR-SEC.006 (containment posture) + NFR-SEC.007 (boundary tagging).
- `spec/02-config/config-registry.md` — the four injection/escalation CFG keys + their validation constraints.

## 7. Dependencies
- **Blocked-by:** ISSUE-011 (observability skeleton — the event/guardrail emission + silent-failure detector the `prompt_injection` log write and quarantine alert land on); ISSUE-003 (SPIKE — injection containment red-team; **AF-068 must be GREEN**, the load-bearing proof that a missed injection stays contained by code-enforced hard limits/RBAC/approval gates).
- **Blocks:** none (leaf).

## 8. Build order within the slice
1. **Schema:** migration for `injection_quarantine` (§7) + confirm `quarantine_decision` / `guardrail_type` enums exist (they land with the ISSUE-060 `guardrail_log` migration — sequence after or alongside it). Append-only + FK to `guardrail_log(id)`.
2. **CFG:** register the four keys with defaults + the `semantic ≤ quarantine` validation constraint; document (per ADR-007 §6) that the two thresholds are *signal-tuning knobs, not safety dials*.
3. **Step 1a — regex layer (FR-6.INJ.002):** implement the literal-pattern library (versioned/testable, AF-117-tracked), always-on; a high-confidence literal can quarantine on the regex layer alone (OD-066) — so the deterministic layer stands with semantic OFF.
4. **Step 1b — semantic scan (FR-6.INJ.003):** embed-and-compare against the known-injection library, gated by `injection_semantic_detection_enabled` (OFF at boot); when on, flag-only above `injection_semantic_threshold`, never an autonomous gate. Guard against a boot with it on by default — AC-6.INJ.003.1 must hold.
5. **Step 2 — boundary-wrap ordering (FR-6.INJ.004):** enforce sanitize-before-`<external_data>`-tag-before-inject ordering at the seam; the tag *application* is ISSUE-032, the Layer-1 instruction ISSUE-043 — this slice guarantees no un-tagged/un-sanitized tool content reaches a prompt layer.
6. **Step 3 — logging (FR-6.INJ.005):** every regex/semantic match writes a `prompt_injection` `guardrail_log` row (source tool+record, trigger content, matched pattern, action) — against ISSUE-060's write-completeness contract.
7. **Step 4 — quarantine (FR-6.INJ.006):** above `injection_quarantine_threshold` (or high-confidence literal when semantic is off) → retain content to `injection_quarantine`, pause task + set `flagged` (via FR-6.ESC.001, owned by ISSUE-056), surface to reviewer; human-only discard (logged who/when) or review-and-include (explicit approval); never auto-use, never machine-discard.
8. **Pipeline call-site contract (FR-6.INJ.001):** expose the single ordered entry point (steps 1–4) the harness invokes between tool-read and AI-call; coordinate the C5 change-control that names this step in FR-5.ASM.007 (ISSUE-053) so AC-6.INJ.001.2's explicit seam is real, not implicit.
9. **Staleness (AC-6.INJ.006.4):** wire quarantine-review timeout to the FR-6.ESC.004 escalation path (reusing `approval_escalation_timeout`) so a quarantined-and-forgotten task never sits silently holding retained content.
10. **Tests to the ACs** (see Verification).

## 9. Verification (how DoD is proven)
- **Unit / integration** (per `spec/05-non-functional/test-strategy.md`): regex library matches the literal set and misses benign lookalikes (AC-6.INJ.002.1); pattern-list updates are versioned/testable (AC-6.INJ.002.2); boot config asserts `injection_semantic_detection_enabled=false` (AC-6.INJ.003.1 / AC-NFR-SEC.006.3); no tool content reaches a prompt un-sanitized or un-tagged (AC-6.INJ.001.1 / AC-6.INJ.004.1 / AC-NFR-SEC.007.1); every match writes exactly one `prompt_injection` row (AC-6.INJ.005.1); quarantine retains-not-discards, pauses + flags, and requires explicit human approval to include (AC-6.INJ.006.1/.2); quarantine works on the regex layer alone with semantic off (AC-6.INJ.006.3); quarantine-review staleness escalates (AC-6.INJ.006.4).
- **SPIKE / red-team gate:** NFR-SEC.006 is **launch-blocking via AF-068** — the AC-NFR-SEC.006.1 property (a successful injection stays bounded by RBAC + hard limits + approval gates) is proven by the ISSUE-003 red-team battery, which must be GREEN before this issue ships. AC-NFR-SEC.006.2 (high-confidence match → quarantine-retain-route-log, never auto-discard) is verified by the integration tests above.
- **EVAL (fast-follow):** AF-117 measures the known-injection-embedding library's coverage/quality; not launch-blocking because the semantic layer defaults OFF. The `AC-* → Verified` path for this slice runs through the C6 verification gate once AF-068 is GREEN and the integration battery passes.
