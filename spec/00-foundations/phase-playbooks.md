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
   hard control per ADR-007, not content detection). *Out of C0:* roles / permission matrix /
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

## Phase 3 — Dashboard / UI Specs  *(approach altitude — finalize before entry)*

**Goal:** Every `UI-` surface fully specified.

**Approach:** Collect all `UI-` stubs (+ the surface inventory in `spec/source/review-scaffolding.md`
as a checklist). For each surface: layout, components, data bindings, actions, role-gating
(`PERM-`), real-time-vs-poll, and **all states** (loading / empty / error / partial / offline) per
the design doc's state patterns. Include the Config Admin surface from Phase 2.

**Done when:** every surface has a complete spec incl. all states and role-gating. **Who decides:**
user on UX/layout calls. **Hand-off:** data bindings reconcile with Phase 4.

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
