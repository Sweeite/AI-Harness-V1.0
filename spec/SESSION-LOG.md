# Session Log

Reverse-chronological. One entry per working session. This is cross-session memory — the
next session reads the top entry to know exactly where to resume.

---

## Session 3 — 2026-06-22 — ADR-003 ACCEPTED (cost model — client-side viability + cost ladder)

**Decided (grill complete, all forks resolved; closes OD-003):**
- **Scope reframed by ADR-001:** opex client-borne → operator marginal cost ≈ $0. Cost is **not**
  operator P&L. ADR-003 commits to (a) a per-deployment viability **envelope** and (b) runaway
  **guarantees**. (Rejected operator-P&L framing — would reopen ADR-001; rejected mechanisms-only.)
- **Breach = tiered ladder, not alert-only** (modelled on the rate-limit 80/95/100 ladder):
  soft alert `$50/day` + `$200/week` (notification only) → **throttle** non-critical at `$75/day`
  (1.5×) → **hard kill** at `$100/day` (2×) = urgent + human-only. All keys per-deployment,
  operator-tunable to client spend tolerance. Daily≠weekly×7 is intentional (spike vs sustained).
- **Cost source = estimate-grade**, not invoice: event-log tokens × an operator-editable price
  table; **all vendors** (Sonnet+Haiku+OpenAI embeddings); **fail-safe rounded UP** so the ceiling
  fires early. Real invoice is unreachable (ADR-001 boundary).
- **Memory write corrected:** OD-003's "3 Sonnet calls" is **wrong** → ≤**1 Sonnet** (writer) +
  Haiku pre-checks; code noise-filter + Haiku selective-writing gate run first. `memory_writes_per_minute:30`
  caps Sonnet writer at 30/min, not 90.
- **Loops short-circuit in code** (DB/condition check) before waking the Sonnet orchestrator —
  idle-deployment loop floor ≈ free. Not an LLM gate.
- **Principle "controls before gates"** (binding): structural/code limits first; one self-funding
  Haiku gate only (selective-writing); **re-rank/HyDE NOT mandated** (AF-002-gated). User pushed on
  "do we need extra LLM gates" — answer: mostly no.
- **Viability target ≤ ~$20/day typical**, $50 = investigate, $100 = backstop. Lever order if AF-001
  shows over-budget: model routing → selective-writing → loop gating → injection limit → orchestrator
  confidence threshold (highest leverage).
- **Haiku decision log + trust window (user-requested, ADR-003 §8):** all 3 memory-path Haiku
  decisions logged (input + verdict + outcome) for manual review; **3-week trust window**
  (`haiku_audit_window_days:21`) in **shadow-retain** mode (would-drop memories written + tagged,
  never lost); after the window, if disagree-rate < threshold the gate goes autonomous. This audit
  log IS the validation data for AF-043/AF-035. Same pattern = template for auditing routing later.
- **Model-routing telemetry (user-requested):** standing **dual-track** — cost (model+task+$) AND
  quality (false-drops/mis-routes/classifier errors). A cost win is worthless if quality silently
  degrades. → AF-035 sharpened.

**Files changed:** `adr/ADR-003-cost-model.md` (new, Accepted; incl. §8 Haiku decision log + routing
telemetry); open-decisions (OD-003 → 🟢); glossary (+Estimated cost, +Cost ladder, +Critical work,
+Haiku decision log, +Trust window, +Shadow-retain; Guardrail row +cost ladder); feasibility-register
(AF-001/035/040/041 sharpened; **AF-042** estimator drift, **AF-043** gate ROI/trust added); adr/README
(ADR-003 Accepted); README (ADR status line — all 3 load-bearing grills done).

**Feasibility:** ⚠️ AF-001/040/041 (viability target paper-only until cost spike) · ⚠️ AF-042
(estimate-vs-invoice drift) · ⚠️ AF-043 (selective-writing gate must pay for itself).

**Next step:** **ADR-004 (concurrency model for memory writes)** — draft→approve (not a grill).
TOCTOU race on contradiction-check-then-write under parallel agents; no per-entity locking defined
(OD-004). Note for ADR-004: the ADR-003 write-path (code filter → Haiku gate → Haiku pre-check →
Sonnet writer) and `memory_writes_per_minute:30` cap are the concurrency surface to lock against.

---

## Session 2 — 2026-06-22 — ADR-002 ACCEPTED (coverage % → Maturity + Retrieval Sufficiency)

**Decided (grill complete, 5 forks resolved):**
- **Q1 — split** the overloaded "coverage %" into two metrics (vs one number for both jobs).
- **Q2 — denominator = expected knowledge slots** per entity type (vs volume / confidence-only).
  Binary slot-fill at v1.
- **Q2b — one slot substrate, two read-paths** (vs two independent engines) + three anti-bloat
  guardrails: thin Sufficiency (no bespoke model), 5–8 operator-editable slots/type, defer
  confidence-weighted fill to v2.
- **`[Building]` recurs per-entity:** deployment cold-start *mode* is one-time (off at 80%
  permanently); the `[Building]` *flag* reappears for new/thin entities (e.g. a year-two client).
  Resolved the doc's two self-contradictions (per-entity vs overall; "permanent" vs recurring).
- **OD-008 closed:** `[Building]` is a flag, not a 4th pill → 3 pills (Cited/Inferred/Unknown).

**Model:** Maturity = `filled slots / expected slots` (stored, daily + on-write, aggregate gates
cold-start 20/50/80). Retrieval Sufficiency = query-time threshold over existing retrieval
signals (slots-touched filled AND surfaced above relevance×confidence bar). Pill rule:
low Sufficiency + entity Maturity < proactive(50) → `[Building]`; else `[Unknown]`.

**Files changed:** `adr/ADR-002-coverage-metric.md` (new, Accepted); glossary (retired Coverage %,
added Maturity / Retrieval Sufficiency / Expected knowledge slot, resolved Answer mode + Cold
start); open-decisions (OD-002, OD-008 → 🟢); adr/README (ADR-002 Accepted); feasibility-register
(AF-034 sharpened); README (ADR status line).

**Feasibility:** ⚠️ AF-034 — slot-fill Maturity predicting "useful" + the Sufficiency threshold
separating `[Building]`/`[Unknown]` are **paper-only**, validated in the AF-002 retrieval spike.

**Next step:** Grill **ADR-003** (cost model & economic viability — last load-bearing grill).
Note from ADR-001: opex is client-borne, so cost tracking is *visibility-grade, not
invoice-grade* — fold that into the ADR-003 framing. AF-001 cost spike runs alongside.

---

## Session 1 — 2026-06-22 — Foundations + ADR-001

**Decided:**
- Method locked: git markdown repo · grill load-bearing ADRs / draft-approve the rest ·
  foundations first then components 0→10. (See README.)
- **ADR-001 (Isolation model) — Accepted.** Silo (one Supabase per client) · single
  codebase / N runtimes · `client_slug` deleted from all app tables · hybrid account
  ownership (client owns Supabase + API keys + opex on their card; operator owns Railway
  compute / the moat) · Railway GitHub auto-deploy · Super Admin = pushed operational
  metadata only, never client business data.

**Created:**
- Repo skeleton: `README.md`, `CLAUDE.md`, `spec/00-foundations/` (id-conventions,
  requirement-template, glossary, open-decisions, adr/, standards/config-edit-taxonomy),
  `traceability-matrix.csv`, `spec/source/` (design doc + review scaffolding copied in).
- `spec/00-foundations/adr/ADR-001-isolation-model.md`.

**Open decisions remaining:** OD-002..OD-008 (see open-decisions.md). Load-bearing grills
left: ADR-002 (coverage metric), ADR-003 (cost model). Draft-approve: ADR-004 (concurrency),
ADR-005 (provisioning/deploy), ADR-006 (RLS), ADR-007 (injection), OD-008 (pill count).

**Added (post-ADR-001):** Feasibility track — `spec/00-foundations/feasibility-register.md`
(AF-* IDs, seeded with 4 priority spikes + vendor/behavioural/cost/scale assumptions). Wired
into CLAUDE.md (feasibility flagging rule), id-conventions (AF- type), requirement template
(Feasibility field), README (parallel track). ACRONYMS.md added at repo root.

**Next step:** Grill ADR-002 — define "memory coverage %" (the metric behind cold-start
gating, the [Building] pill, proactive suppression). Currently a percentage with no
denominator. When defined, link it to AF-034 (is the metric actually meaningful — EVAL).
