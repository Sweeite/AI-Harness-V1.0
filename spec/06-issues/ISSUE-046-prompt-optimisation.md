---
id: ISSUE-046
title: Prompt optimisation — version-to-outcome attribution + dynamic-L2 + compression discipline
epic: E — prompt
status: blocked
github: "#46"
---

# ISSUE-046 — Prompt optimisation — version-to-outcome attribution + dynamic-L2 + compression discipline

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Turn the versioned prompt store into a feedback loop — stable per-version identity captured at assembly so task outcomes attribute to the version in force, plus fresh dynamic-Layer-2 injection each session and the word-by-word compression discipline as maintained (not gated) practice — the three C4 OPT optimisations, all resting on the AF-111 "signal-not-noise" feasibility gate.

## 2. Scope — in / out
**In:**
- **Version-to-outcome attribution** — the stable version identity from ISSUE-042's store is made *attributable*: the prompt version(s) in force at assembly are captured against each completed task's outcome so a builder can later ask "which version produced better outcomes" (FR-4.OPT.001). C4 owns the version-identity + capture point; the outcome *signals/surfacing* are the C7 seam (below).
- **Dynamic Layer-2 injection as the runtime optimisation** — current goals / active campaigns / this-week priorities are injected fresh each session rather than baked into static config, realising the BIZ static/dynamic split at the assembly boundary with no redeploy/reboot (FR-4.OPT.002). This slice owns the *fresh-injection optimisation behaviour*; ISSUE-044 owns the BIZ field declaration + value-source + staleness semantics it consumes.
- **Prompt compression discipline** — the editing workflow supports word-by-word compression (inconsistently-followed content removed; compressed/audited preferred over organic) as an *enabled, maintained discipline*, never a save-blocking gate — a token-cost + reliability lever (FR-4.OPT.003).

**Out:**
- The `prompt_layers` store, `prompt_layer_kind`, version-discipline machinery (never-overwrite, `previous_version_id`, `change_reason`, rollback), version *pinning at assembly*, and the four-layer structure/immutability contract — **ISSUE-042** (C4 LYR/STO). This slice consumes the stable version identity + pin point that 042 delivers; it does not build them.
- BIZ Layer-2 **content** — static/dynamic classification, dynamic-field *declaration in config*, the operator-editable value store semantics, and staleness surfacing (`dynamic_field_freshness_threshold`) — **ISSUE-044** (C4 BIZ/TSK). OPT.002 is only the *fresh-per-session injection* optimisation over 044's declared fields.
- **Runtime prompt-stack assembly** (retrieve layers → inject dynamic/memory → concatenate → send) and the completion **outcome/event recording** that the attribution reads from — **ISSUE-053** (C5 ASM; FR-5.ASM.001/002 assembly + pinning, FR-5.ASM.009 completion dual-record). This slice defines *what version identity must be captured*; C5 captures it at assembly and records it at completion.
- **Prompt-health / version-performance signals + self-improvement surfacing** (the dashboards that read the attribution) — **C7 Observability** (ISSUE-077 / render surfaces). C4 owns version identity + the attribution requirement; C7 owns the signals.
- **The AF-111 EVAL itself** — this slice ships the machinery regardless; proving the feedback loop yields usable signal (and that compression measurably outperforms) is the build-time EVAL, run once a deployment has real task history (see Verification).

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-4.OPT.001, FR-4.OPT.002, FR-4.OPT.003 (all Component 4 — Prompt Architecture)
- **NFRs:** NFR-COST.010 (cost-per-task-type substrate + re-rank/HyDE off-by-default — the coverage-ledger maps `NFR-COST.010 → 046/066`; this slice's contribution is the version-attribution substrate + compression as a token-cost lever feeding ROI tuning; the per-task-type aggregation + routing model are owned at FR-7.COST.002 / FR-8.COST.003, ISSUE-074/066)
- **Rests on:** ADR-003 (cost — "controls before gates"; prompt compression + memory-injection volume are the token-cost levers, and there is exactly one LLM cost-gate — OPT is a lever, not a second gate), ADR-002 (Maturity/Retrieval — the answer-mode substrate the outcome signal is read against); ⚠️ **AF-111** (version→outcome attribution is signal not noise at low task volume; compressed/audited prompts measurably outperform — EVAL, build-time)

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-4.OPT.001.1  *(version(s) in force at assembly are attributable to a completed task's outcome — identity captured, not lost; the outcome record itself is written by C5 FR-5.ASM.009 in ISSUE-053, this slice guarantees the version identity is on it)*
- AC-4.OPT.002.1
- AC-4.OPT.003.1
- **Gating spikes (if any):** no launch-gating spike (ISSUE-001–006) blocks this slice. **Build-time feasibility gate: AF-111** must be run (EVAL) before the *optimisation claims* (FR-4.OPT.001 attribution discriminates versions; FR-4.OPT.003 compression outperforms) are relied on — the machinery ships regardless; AF-111 gates the claim that the feedback loop produces usable signal (feasibility-register block O).

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-prompt_layers (schema §5 — the versioned `prompt_layers` rows whose `id`/`version` are the stable identity attributed to outcomes; read-only here, owned by ISSUE-042), `dynamic_field_values` (schema §5 — read fresh at assembly for OPT.002; table + semantics owned by ISSUE-042/044). *(The outcome record the version attaches to lives in C5 `task_queue` / C7 `event_log` — ISSUE-053/011, not written here.)*
- **PERM:** none new  *(prompt edits remain gated by `PERM-prompt.edit` per ISSUE-042; OPT adds no node)*
- **CFG:** none owned here  *(`business_context.dynamic_fields` + `dynamic_field_freshness_threshold` are ISSUE-044's; `memories_injected_per_task` is ISSUE-045's)*
- **UI:** prompt-layer editor — the compression-discipline affordance (word-count + the OD-051 advisory that compression is enabled, not mandated by a gate) on the existing editor from ISSUE-042  *(the version-performance dashboards that render the attribution are C7 — ISSUE-077, out)*
- **Connectors:** none

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-04-prompt.md — the FR text + ACs for the OPT area (FR-4.OPT.001/002/003) plus the Context manifest / Seams at its head (the C7 version-performance-signal seam, the ADR-002/003 dependencies, the AF-111 tag)
- spec/04-data-model/schema.md §5 Prompt Content (C4) — the `prompt_layers` (stable `id`/`version` identity) + `dynamic_field_values` tables read by this slice
- spec/00-foundations/adr/ADR-003-* — cost posture: compression + injection-volume are the token-cost levers; "controls before gates" (OPT is a lever, exactly one LLM cost-gate)
- spec/00-foundations/adr/ADR-002-* — Maturity / Retrieval / answer-mode substrate the outcome signal is read against
- spec/05-non-functional/cost.md §NFR-COST.010 — the cost-per-task-type / re-rank-HyDE-off-by-default posture this slice's attribution substrate feeds
- spec/00-foundations/feasibility-register.md §"Block O" — AF-111 (the EVAL method, what it gates, why it is not a spec blocker)

## 7. Dependencies
- **Blocked-by:** ISSUE-042 (prompt layer model + store + version-never-overwrite — this slice consumes its stable version identity, the pin-at-assembly point, and the `dynamic_field_values` table). Not a spike; no launch-gating AF gate on the dependency edge. *(Build-time AF-111 is a DoD/verification gate on this slice's claims, not a blocking dependency — see field 4 + field 9.)*
- **Blocks:** none (leaf)

## 8. Build order within the slice
1. **Version-identity capture contract (FR-4.OPT.001)** — define the stable per-version identity to attribute (the `prompt_layers.id` + `version` of each layer resolved at assembly) and the contract that this identity is captured against the task outcome record. C4 owns *what must be captured and that it is never lost*; wire the actual capture into C5's assembly (FR-5.ASM.002 pin point) and completion dual-record (FR-5.ASM.009) in ISSUE-053 — this slice provides the required-fields contract and asserts it end-to-end there.
2. **Dynamic-Layer-2 fresh-injection optimisation (FR-4.OPT.002)** — at the assembly boundary, read the declared dynamic fields' live values from `dynamic_field_values` fresh each session (not the static-config baked value), so an updated value appears on the next session's Layer 2 with no redeploy/reboot. Consumes ISSUE-044's field declaration + value-source; this slice owns only the fresh-per-session behaviour.
3. **Compression-discipline workflow (FR-4.OPT.003)** — on the ISSUE-042 prompt editor, support the word-by-word compression discipline as an *enabled, non-blocking* affordance (word-count + the OD-051 advisory) — compressed/audited preferred, never gated. No save-block; this is discipline, not enforcement.
4. **AF-111 EVAL harness hooks** — ensure the version-bucketed outcome data (from step 1) is queryable so the build-time EVAL can measure whether version deltas exceed noise and whether compression improves task success/cost (the eval runs on real task history — feasibility-register block O). This slice makes the substrate measurable; it does not gate itself on the eval result.
5. **Tests to the AC IDs** in field 4.

## 9. Verification (how DoD is proven)
- **Attribution (FR-4.OPT.001)** — a completed task's recorded outcome carries the prompt version(s) in force at its assembly; changing a layer to a new version and running a new task attributes the new task's outcome to the new version, and neither version identity is lost (AC-4.OPT.001.1). The end-to-end outcome-record path is proven in ISSUE-053 (C5 FR-5.ASM.009); this slice proves the version identity is present and stable. Test layer per `spec/05-non-functional/test-strategy.md`.
- **Dynamic-L2 freshness (FR-4.OPT.002)** — updating a dynamic field's value and assembling the next session's prompt shows the new value in Layer 2 with no redeploy/reboot (AC-4.OPT.002.1).
- **Compression discipline (FR-4.OPT.003)** — the editor supports the compression workflow (word-count + advisory) and does **not** block a save for length — compression is enabled, not mandated by a gate (AC-4.OPT.003.1).
- **Feasibility (AF-111, build-time EVAL — not a launch gate)** — per `spec/05-non-functional/test-strategy.md` + feasibility-register block O: once a deployment has real task history, measure whether version-bucketed outcome deltas exceed noise and whether compression measurably improves task success/cost. The machinery ships regardless; this EVAL gates only the *claim* that the feedback loop yields usable signal. No launch-blocking `AC-NFR-*` posture is owned by this slice; it contributes the version-attribution substrate to NFR-COST.010's ROI evidence base (aggregation + routing owned at FR-7.COST.002 / FR-8.COST.003).
