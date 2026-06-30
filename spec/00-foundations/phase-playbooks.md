# Phase Playbooks — the repeatable procedure for each phase

> Read after `process-overview.md`. This is the **how**. Each phase has a fixed shape:
> **Goal · Inputs · Steps · Outputs · Done-when · Who decides · Hand-off.**
>
> **Altitude note (honest):** Phase 0 and Phase 1 are at **full mechanical detail** — they're
> here now or next. Phases 2–6 are at **goal + approach + done-when** altitude: their fine
> mechanics partly depend on Phase 1's output, so each one's detailed steps are **finalized right
> before we enter it** (a quick review pass), under change-control. This is deliberate, not
> incomplete — we don't invent specifics we can't yet know. All playbooks are living docs.

---

## Phase 0 — Foundations  *(complete — 2026-06-23)*

**Goal:** Lock the decide-once layer so nothing downstream is built on sand: conventions,
glossary, the load-bearing ADRs, cross-cutting standards, and the parallel tracks.

**Inputs:** the design doc; the review scaffolding; the user (for the grills).

**Steps:**
1. Repo skeleton, ID conventions, requirement template, traceability matrix. ✅
2. Glossary seeded; undefined terms flagged 🔴. ✅ (kept updated as ADRs resolve)
3. **ADRs.** Three load-bearing ones resolved by *grilling* (ADR-001 isolation, ADR-002 coverage,
   ADR-003 cost) ✅. Four remaining by *draft→approve* (ADR-004 concurrency, ADR-005
   provisioning/deploy, ADR-006 RLS, ADR-007 injection).
4. Standards (config edit taxonomy ✅, change control ✅; add others if a component needs one).
5. Parallel tracks live: feasibility register (AF + 4 priority spikes), out-of-scope register.
6. **Closer:** before entering Phase 1, confirm/refine the Phase 1 playbook below.

**Done when:** all 7 ADRs Accepted; conventions + standards locked; priority spikes at least
scoped (and ideally run, since AF-001/002 can invalidate the architecture).

**Who decides:** user resolves/approves every ADR. **Hand-off:** locked ADRs constrain every FR.

---

## Phase 1 — Functional Requirements (per component)  *(full detail — this is the engine)*

**Goal:** Turn each component's design prose into atomic, testable, traceable FRs with zero open
decisions, signed off by the user.

**Order:** components **0→10** in dependency order (0 Login, 1 RBAC, 2 Memory, 3 Tools, 4 Prompt,
5 Harness, 6 Guardrails, 7 Observability, 8 Agent Design, 9 Proactive, 10 Infra/Compliance).
**One component per working session.**

**Inputs:** the component's design-doc section; all locked ADRs; glossary; standards; the registers.

**Steps (every component, identically):**
1. **Create the component file** `spec/01-requirements/component-NN-<name>.md` opening with a
   **Context Manifest** — the exact ADRs, standards, glossary terms, and design-doc line ranges
   this component depends on. Load only those (bounded context).
2. **Decompose** the design prose into candidate behaviours; assign **area codes** (recorded at
   the top of the file, e.g. component 2 → MEM/ING/RET/CON/DEC).
3. **Draft each FR** per `requirement-template.md` — atomic, fielded, every branch explicit,
   **cited** to design-doc lines. Default-deny permissions.
4. **Log Open Decisions** (`OD-*`) for every ambiguity/gap, each with options + a recommendation.
   **Never guess** — an unknown is an OD, not an assumption.
5. **Park cross-phase items as you find them** (so nothing is lost across phase boundaries):
   - a config → `CFG-` stub noted for Phase 2
   - a screen/panel → `UI-` stub for Phase 3
   - a table/field → `DATA-` stub for Phase 4
   - a permission → `PERM-` stub
   - a test-only assumption → `feasibility-register.md` (`AF-`)
   - an exclusion/deferral → `out-of-scope.md` (`OOS-`)
6. **User resolves the ODs.** Apply resolutions; add/settle glossary terms.
7. **Write acceptance criteria** (`AC-*`, Given/When/Then) for every FR.
8. **Run the verification gate:** an independent subagent re-extracts FRs from the component's
   design prose and flags (a) orphaned design lines (intent with no FR) and (b) contradictions
   with locked ADRs/glossary. Reconcile every finding.
8a. **Quality-bar check:** check the component against the relevant rows of
   `what-makes-it-great.md`. If a great-harness dimension applies and we only specced the
   "good-enough" version, that's a flagged shortfall (an OD), not a silent choice. Also probe the
   `system-map/failure-overlay.md` failure modes for this component — any with no mechanism is an
   FR we still owe.
9. **Update `traceability-matrix.csv`** — one row per FR with its links.
10. **User sign-off** → set component FRs to `Approved`. Record sign-off (file header + SESSION-LOG).
    Commit. Append SESSION-LOG entry with next component as the resume point.

**Outputs:** a complete `component-NN` requirements file (FRs `Approved`); updated registers; matrix
rows; parked CFG/UI/DATA/PERM stubs for later phases.

**Done when:** every design line for the component maps to ≥1 FR; zero open ODs on those FRs;
verification gate clean; user signed off.

**Who decides:** user resolves ODs + signs off. Claude drafts, finds gaps, recommends, verifies.

**Hand-off:** parked stubs feed Phases 2–4. The first component (0 Login) is done carefully as the
**golden exemplar**; later components pattern-match it to minimize drift in fresh chats.

### Component 0 — entry finalization *(2026-06-24, the "finalize before entry" pass)*

Two scope decisions locked before drafting any C0 FR (user-approved, this session):

1. **C0 = authentication only ("who you are").** *In scope:* dashboard login (Google/Microsoft as a
   **login-identity provider** via Supabase Auth), email+password, **2FA** (TOTP enroll + challenge),
   **sessions** (JWT, access/refresh TTLs, HTTP-only cookies, mid-task + dashboard expiry/re-auth),
   **invite-based account creation** (72h link), **first-boot Super Admin** seed (24h link), the
   **"trouble signing in"** support/recovery flow + support-request handling, and **inbound webhook
   authentication** (HMAC/JWT verification of GHL/Google/Slack webhooks — this is *authentication*, a
   hard control per ADR-007, not content detection). **Webhook seam:** C0 owns *authenticating* the
   webhook (verify signature → reject 401 → log the failure as `prompt_injection` per ADR-007); the
   **content/payload handling** of a verified webhook belongs to the ingesting component (C2/C3).
   ADR-007 (`L742–809`) homes HMAC verification to "connector ingress" — that's not a contradiction;
   C0 owns the *auth step*, the ingest component owns *what the payload does*. *Out of C0:* roles / permission matrix /
   clearances / RLS → **C1 (RBAC)**; **connector OAuth + token lifecycle** for the AI's *data access*
   to Gmail/Drive/GHL/Slack → **C3 (Tool Layer)**, where the tool dossiers live. The **seam** between
   C0 and C1 is the session establishing `auth.uid()` — which ADR-006's RLS keys on. *Note:* the design
   doc places much auth content (L643–816: application auth flow, sessions, webhook security)
   **structurally under the RBAC (`## 1.`) header**; we re-home it to C0 by semantics. "Google OAuth"
   is deliberately split: *login-identity* OAuth = C0 (Supabase Auth handles it, simple); *connector*
   OAuth (Gmail/Drive read, AF-013/014 token caps & rotation) = C3.

2. **Supabase Auth research-first gate (do this before C0 FRs).** Supabase Auth underpins all of C0 and
   carries ~7 unverified vendor claims (TOTP/QR compatibility with Google **and** Microsoft
   Authenticator; HTTP-only-cookie session mode; access/refresh TTL semantics incl. inactivity
   revocation; auth-endpoint rate limits; OAuth-IdP provider support per region; RLS-evaluated-per-query
   cost). Per `standards/tool-integration-research.md` + the AF-003 "vendor facts go stale" lesson, run a
   **dated, primary-source** pass on Supabase Auth first, then C0 FRs cite *those findings*, not the
   design doc, for vendor behaviour. **Filing location:** Supabase is a *platform* dependency, and
   `tool-integrations/` is for *client-facing connectors* only (per that folder's README), so the
   findings land as a **new dated AF block in `feasibility-register.md`** (AF-003 F-finding style) +
   glossary/OD outputs — **not** a `tool-integrations/` dossier.

**Doc-reconciliation notes for the C0 drafter** (the design doc states these; carry them into the FRs,
don't inherit them silently or re-derive them from prose):
- **OAuth is the *primary* login, email+password+2FA is *secondary*** (`L360`, `L373`). Preserve that
  priority in the AUTH FRs (the login surface leads with OAuth; email/password is the fallback path).
- **No automated/self-service password reset — deliberate** (`L382`). This drives the **REC** area:
  recovery is the human-verified **"trouble signing in"** flow (user submits a request → Super
  Admin/Admin phone-verifies → manual credential change), *not* a self-service reset link. Do not spec a
  forgot-password reset; spec the human-in-the-loop recovery.
- **Notation:** `§N` in a Context Manifest = the ADR's **numbered decision point N** (ADRs number their
  decisions 1–N; they carry no literal `§` markers). E.g. "ADR-001 §5" = ADR-001's 5th numbered decision.

---

## Phase 2 — Config Registry  *(approach altitude — finalize before entry)*

**Goal:** Every tunable captured, classified, surfaced, and validated — honouring "every config has
a dashboard / backend-vs-on-screen defined."

**Approach:** Collect all `CFG-` stubs parked in Phase 1 (+ sweep the design doc for any missed).
Classify each into the **config edit taxonomy** (SECRET / BOOT / LIVE / REBUILD —
`standards/config-edit-taxonomy.md`). For each: default, validation/range/enum, the `PERM-` to
edit it, the `UI-` surface it lives on, live-vs-reload behaviour. Resolve any open `???`.

**Done when:** every CFG row has class + surface + edit-mechanism + validation + permission; **zero
`???`**. **Who decides:** user confirms edit-policy where non-obvious. **Hand-off:** surfaces feed
Phase 3; the Config Admin screen is specified in Phase 3.

## Phase 3 — Dashboard / UI Specs  *(full mechanical detail — finalized 2026-06-28)*

**Goal:** Every `UI-` surface fully specified — layout, data bindings, actions, role-gating,
real-time-vs-poll contract, and all states (loading / empty / error / partial / offline).

**Surface ordering (14 files: 00–12 + 01b, agreed 2026-06-28):**

| # | File | Coverage |
|---|---|---|
| 00 | `surface-00-auth.md` | UI-LOGIN, UI-2FA-*, UI-INVITE-SETUP, UI-REAUTH-PROMPT, UI-SUPPORT-REQUESTS |
| 01 | `surface-01-config-admin.md` | UI-config-admin #auth…#secrets (11 sections) — Phase 2 Appendix B carry-in |
| 02 | `surface-02-user-mgmt.md` | UI-USER-MGMT, UI-ROLE-MGMT, UI-PERMISSION-MATRIX, UI-CLEARANCE-*, UI-RESTRICTED-GRANT |
| 03 | `surface-03-ingestion-queue.md` | UI-INGESTION-QUEUE, conflict review queue |
| 04 | `surface-04-approval-queue.md` | Approval queue dashboard (C6 tiers) |
| 05 | `surface-05-dashboard-ops.md` | Ops dashboard: system health, connector health, event log, DLQ, cost, guardrail log, self-improvement |
| 06 | `surface-06-dashboard-super-admin.md` | Super Admin dashboard + management-plane screens (s-c-*): fleet clients, deploys, health, provisioning, migrations, cost, plugins |
| 07 | `surface-07-dashboard-agency.md` | Agency Owner + Manager view, activity feed, notification centre |
| 08 | `surface-08-dashboard-user.md` | Standard user view: My Workspace, Inbox, Decisions, chat |
| 09 | `surface-09-agent-builder.md` | Agent Fleet, Agent Builder / specialist config, Orchestration |
| 10 | `surface-10-commands.md` | UI-COMMANDS — custom command management (FR-9.CMD.006–008) |
| 11 | `surface-11-memory-nav.md` | Memory navigation / entity browser |
| 12 | `surface-12-mobile.md` | Mobile surfaces (6 sub-surfaces) |
| 01b | `surface-01b-config-audit-log.md` | UI-config-audit-log — config change audit log viewer (OD-099 resolved) |

**Status (2026-06-30):** 7 of 14 built — `surface-00-auth.md`, `surface-01-config-admin.md`,
`surface-02-user-mgmt.md`, `surface-03-ingestion-queue.md`, `surface-04-approval-queue.md`,
`surface-05-dashboard-ops.md`, `surface-06-dashboard-super-admin.md` ✅ signed off.
The other 7 (incl. `surface-01b`) are **listed but not yet built**; surface-01's "View audit log →" link targets `surface-01b`,
which is a known not-yet-built target (not a defect). **Mapping note:** C0's `UI-CONFIG-AUTH` stub
(FR-0.AUTH.003) is **not a separate surface** — it is absorbed into `surface-01-config-admin` `#auth`; do not
create a standalone `UI-CONFIG-AUTH` surface. Role coverage labels in the table above (e.g. "Agency Owner",
"Manager") are planning-doc shorthand — every surface's Access table must use the **six canonical C1 roles**
(FR-1.ROLE.001), not those labels.

**Template:** `spec/03-surfaces/_TEMPLATE.md` — every surface file follows this shape exactly.

**Inputs:** the ordered `UI-` stubs from Phase 1 + `spec/source/review-scaffolding.md` + Phase 2
Appendix B (config-admin 11 sections + PERM-config.* gates). For each surface, load only the FRs
it serves — bounded context.

**Steps (every surface, identically):**
1. **Create the surface file** from `_TEMPLATE.md` — open with Context Manifest (FRs served, CFG
   deps, PERM gates, DATA bindings, ADR constraints). Load only those FRs + the config-registry
   rows for that surface's sections.
2. **Identify sections / panels / tabs** — decompose the surface into logical areas. Name each one.
3. **Spec each section:** data bindings (table.field → display element), actions (label → behaviour
   → PERM gate), and the real-time / poll contract per the C7 RTP area (FR-7.RTP.*).
4. **Spec all five states** for every live section: loading / empty / error / partial / offline.
   Never leave a state blank — "n/a" must be justified.
5. **Log Open Decisions** (`OD-*`) for UX/layout calls — anything a developer couldn't decide from
   the spec alone. Each OD gets options + a recommendation. Never assume a layout choice.
6. **User resolves the ODs.** Apply resolutions.
7. **Run the verification gate:** an independent subagent checks:
   - (a) every `UI-` stub from Phase 1 that this surface covers is addressed — no orphaned stub
   - (b) every CFG row in the config-registry that maps to this surface's section is wired
   - (c) every DATA binding references a table/field that Phase 1 defined or flags it as a new Phase 4 stub
   - (d) the PERM model is consistent with C1 FRs (no role string — only PERM nodes)
8. **Reconcile every finding** from the verification gate.
9. **Update the traceability matrix** — add a surface row noting which FRs it serves.
10. **User sign-off** → commit. Append SESSION-LOG entry with next surface as resume point.

**OD types in Phase 3:** two kinds — **(a) UX/layout** (how it looks, what order things appear,
labels, empty-state copy) and **(b) behaviour** (what happens when an action fires, who gets
notified, what the confirmation says). Both are ODs; never guess either.

**The real-time / poll contract (C7 RTP):** every live-updating element must state which
mechanism it uses. Options: (1) real-time Supabase subscription, (2) polling at a named interval,
(3) static on page load, (4) on-demand user refresh. Mixed panels must specify per-element.

**Done when:** every surface file is complete (all sections, all states, all ODs resolved) and the
verification gate is clean.

**Who decides:** user resolves ODs (layout + behaviour calls). Claude drafts, finds gaps, verifies.

**Hand-off:** data bindings (table.field stubs) feed Phase 4 schema consolidation.

## Phase 4 — Data Model  *(approach altitude — finalize before entry)*

**Goal:** One coherent schema.

**Approach:** Consolidate every `DATA-` reference into tables/fields/types; define RLS policies
(intra-client only, per ADR-001/006), indexes (incl. HNSW per design), and migrations. Resolve
schema contradictions surfaced earlier (e.g. the historical `client_slug` / `memories` issue —
already killed by ADR-001).

**Done when:** every DATA- ref consolidated, typed, consistent; RLS + indexes + migrations defined.
**Hand-off:** schema underpins build issues.

## Phase 5 — Non-Functional  *(approach altitude — finalize before entry)*

**Goal:** All NFRs explicit (`NFR-*`).

**Approach:** Security, infrastructure/deploy, observability, cost (envelope + ladder per ADR-003),
compliance, **backup & disaster recovery** (resolve **OD-009** — ownership/verification under
client-owned Supabase; a *tested* restore), and the test strategy (how `AC-*` become real tests
and reach `Verified`).

**Done when:** every NFR domain has explicit requirements; OD-009 resolved. **Who decides:** user
on risk posture + backup ownership.

## Phase 6 — Issue Decomposition  *(approach altitude — finalize before entry)*

**Goal:** A buildable, ordered backlog.

**Approach:** Slice the finished spec into **vertical, independently-buildable** issues
(tracer-bullet slices), each linking back to its FR IDs and inheriting their `AC-*` as its
definition of done. Produce a **build-order / dependency map** (what blocks what; critical path).

**Done when:** every FR maps to an issue; every issue maps back to FRs; build sequence defined.
**Hand-off:** the build begins, with priority feasibility spikes already de-risking the scary parts.

---

## How to use these playbooks across chats

A fresh chat: read CLAUDE.md → process-overview.md → this file → SESSION-LOG.md (resume point) →
the registers, then execute the current phase's playbook. If a phase's steps feel
under-specified for the work in front of you, that's the "finalize before entry" pass — tighten
the playbook *first* (it's a living doc under change-control), then proceed. Never improvise past
a gap; write the procedure down, then follow it.
