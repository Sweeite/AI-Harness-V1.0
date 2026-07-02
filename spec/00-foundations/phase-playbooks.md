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

**Status (2026-07-01, session 43): 🟢 COMPLETE — all 14 built + signed off** — `surface-00-auth.md`,
`surface-01-config-admin.md`, `surface-02-user-mgmt.md`, `surface-03-ingestion-queue.md`, `surface-04-approval-queue.md`,
`surface-05-dashboard-ops.md`, `surface-06-dashboard-super-admin.md`, `surface-07-dashboard-agency.md`,
`surface-08-dashboard-user.md`, `surface-09-agent-builder.md`, `surface-10-commands.md`,
`surface-11-memory-nav.md`, `surface-12-mobile.md`, `surface-01b-config-audit-log.md` ✅ signed off.
**Phase 3 is complete → next is Phase 4 (Data model).** (surface-01's "View audit log →" links target `surface-01b`,
now built.) **Mapping note:** C0's `UI-CONFIG-AUTH` stub
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

## Phase 4 — Data Model  *(full mechanical detail — finalized 2026-07-01)*

**Status (2026-07-01, session 44): 🟢 COMPLETE — signed off.**
All 5 files built (`_data-inventory.md`, `schema.md`, `rls-policies.md`, `indexes.md`, `migrations.md`);
~40 tables consolidated; 16 net-new stores designed; no `client_slug` on any app table; verification
gate 0 HIGH / 2 MED (reconciled) / 4 LOW. Sign-off finalization done: OD-P4-01…07 accepted (recommended
options), the 16 net-new owed-back `DATA-` cites + the R1 `client_slug` clerical amendment applied via
change-control, matrix wired. **→ next is Phase 5 (Non-Functional).**

**Goal:** One coherent, buildable schema — every `DATA-` reference across the 11 components and 14
surfaces consolidated into typed tables, with RLS policies, indexes, and migrations, so that no
build issue ever has to guess a column, a type, or a policy.

**Why this phase exists (plain English):** Phases 1–3 described *what the system does* and *what it
looks like*, but the database that underpins it all lives only as hundreds of scattered `DATA-`
stubs and `Data touched:` footers. Phase 4 is where those stop being notes and become one master
schema whose tables provably agree with each other — the last thing that must be true before the
spec can be sliced into build issues (Phase 6) and hardened (Phase 5).

**Scope call (locked at entry):** the schema is defined as **drizzle-shaped tables + column types +
constraints + RLS predicates + indexes + the migration story**, expressed in markdown (SQL-flavoured
DDL sketches allowed, but this is a *spec*, not the migration files — those are a build artifact,
same as `PERMISSION_NODES.md`). Actual `.sql`/drizzle files are written at build. Backup/DR schema
concerns → Phase 5 (ADR-008). Cross-deployment `client_registry` (mgmt plane) is in-scope but lives
on the **separate management deployment**, not a client silo (ADR-001 §7) — flag it as such.

### Output file structure (`spec/04-data-model/`)

| File | Contents |
|---|---|
| `_data-inventory.md` | The **harvest** — every `DATA-`/table.field binding, deduplicated, with owning component + source cites. The working ledger the schema is built from (like Phase 2's registry harvest). |
| `schema.md` | The consolidated schema — one section per table: columns, types, nullability, defaults, PK, FKs, constraints, and a one-line "owned by / written by" note. Enums/domains consolidated in a leading `## Types` section. |
| `rls-policies.md` | Every table's RLS: the `(select …)` initPlan predicate, human-path vs agent-path (`service_role`) division, intra-client scope, no `client_slug`. Per ADR-006 + `standards/rbac.md`. |
| `indexes.md` | Every index incl. the HNSW vector index (VEC / ADR), the clearance/relevance scoping indexes surfaces flagged, and the `(status, created_at)` queue indexes. |
| `migrations.md` | The migration set + ordering + the expand-contract story per `standards/migration-discipline.md`; the per-deployment propagation + failure-isolation (C10 MIG). |

Create `spec/04-data-model/` and these five files. `schema.md` is the spine; the other four hang off it.

### The net-new stores owed from Phase 3 (must all be designed, none skipped)

Phase 3 flagged **seven** stores that features assume but no component ever schema'd. Each gets a full
table design in `schema.md` **and** an "owed back to component X" note (Rule 0 — the FR that needs it
must gain a `DATA-` cite via change-control):

1. `config_audit_log` (append-only, key-prefix RLS) — surface-01/01b; owed to C7 FR-7.LOG.008.
2. `conversations` + `messages` (chat thread store, RLS-scoped) — surface-08 OD-135; owed to C5/C9.
3. `push_subscriptions` (device-token store, RLS-scoped to user) — surface-12; owed to C7 FR-7.VIEW.003.
4. `commands` (user-defined custom commands; system commands stay code-registered) — surface-10; owed to C9/C5.
5. the **agent-health metric store** (HLTH.001–003 + producer heartbeat) — surface-09; owed to C8.
6. the **execution-plan store** (PLAN.004 versioned plans) — surface-09; owed to C8/C5.
7. `notifications` net-new fields / `task_queue.originating_user_id` / `escalated_at` — surfaces 04/07/08; owed to C5/C7/C6.

Harvest may surface more; if so, add them to this list and log the owed-back note.

### Steps

1. **Harvest (subagent fan-out).** Offload the bulk read to independent subagents (context discipline):
   one pass over the 14 surfaces' "Phase 4 data binding notes" sections, one over the 11 components'
   `Data touched: DATA-*` footers + `DATA-` inline cites, one over the config-registry's structured
   objects + secrets. Each returns a structured list: `table · field · type-hint · owning-component ·
   RLS-hint · index-hint · source-cite`. Merge into `_data-inventory.md`, deduplicated by table.field.
2. **Cluster into tables.** Group every binding by table. For each table draft the column set: name,
   type, nullability, default, PK/FK. Reconcile conflicting field mentions (a field named two ways →
   one canonical name + a note). Flag every net-new store from the list above.
3. **Consolidate types.** Pull every enum/domain into the `## Types` section — sensitivity tiers,
   visibility, `task_queue.status`, `guardrail_type`, answer-mode, etc. One definition each; tables
   reference them. No inline enum re-declared per table.
4. **Write RLS (`rls-policies.md`).** Per ADR-006: static, data-driven, `(select …)` initPlan
   (wrapped so it evaluates once per statement — AF-067). Human-path tables carry RLS keyed to the
   caller's held PERM nodes + clearance; agent-path writes go through `service_role` (the sole-writer
   pattern, ADR-004). **No `client_slug` in any predicate** (ADR-001 §3 / OD-096) — confirm table by
   table. Restricted never a row default (C1).
5. **Write indexes (`indexes.md`).** HNSW on the memory embedding column (VEC / ADR; built
   `CONCURRENTLY`). The `(status, created_at)` queue indexes (task_queue, guardrail_log,
   ingestion_queue). The clearance/relevance scoping indexes surfaces named. Every index cites the
   query it serves.
6. **Write migrations (`migrations.md`).** The initial schema as the first migration; the
   expand-contract discipline (`standards/migration-discipline.md`) for anything that will later
   change; the per-deployment propagation + failure-isolation model (C10 FR-10.MIG.*). Note AF-065
   (expand-contract-keeps-mixed-fleet-safe) is paper-until-tested.
7. **Log Open Decisions (`OD-*`)** for every genuine schema fork a builder couldn't resolve from the
   spec alone (a type choice with trade-offs, a normalize-vs-denormalize call, a nullable-vs-required
   with a real consequence). Options + recommendation each. **User resolves.**
8. **Change-control the owed-back cites.** For each net-new store, add the `DATA-` reference to its
   owning FR(s) via change-control (mirrors how Phase 3 minted PERM nodes back into components) so the
   requirement layer points at the schema, not just the surface.
9. **Run the verification gate** (independent zero-context subagent, checks a–f below). Reconcile
   every finding.
10. **Update** `traceability-matrix.csv` (DATA- rows / column), `README.md` (Phase-4 status),
    `SESSION-LOG.md`. **User sign-off** → commit.

### Verification gate (independent subagent, checks a–f)

- **(a) Coverage** — every `DATA-` / `Data touched:` reference in all 11 components + 14 surfaces maps
  to a table.field in `schema.md`. No orphaned data reference; no table referenced-but-undefined.
- **(b) Net-new completeness** — all seven (or more) net-new stores are designed **and** owed-back to
  a component FR via change-control. None left as a dangling surface-only note.
- **(c) Types** — every enum/status/tier value used anywhere resolves to a `## Types` definition;
  no field typed two ways.
- **(d) RLS** — every table has a policy; intra-client only; **no `client_slug` anywhere**;
  human-path vs agent-path (`service_role`) division explicit; consistent with ADR-006 + C1 RLS FRs.
- **(e) #1/#2/#3 sweep** — no store can silently lose data (append-only where the spec demands it;
  cascade/erasure walks intact — FR-2.MNT.017 / C10 FR-10.DEL.004); no over-broad grant (#2); no
  write path that can fail silently (embed-fail-never-stores WRT.007; audit sinks append-only).
- **(f) Migrations** — expand-contract respected; no DROP/RENAME beside its replacement; vector index
  `CONCURRENTLY`; migrations re-runnable (failure-isolation).

**Done when:** every `DATA-` ref is consolidated, typed, and consistent; every table has RLS +
indexes; migrations defined; net-new stores designed + owed-back; ODs resolved; gate clean;
user signed off.

**Who decides:** user resolves schema ODs (type/shape/normalization calls with real trade-offs).
Claude drafts, harvests, finds gaps, verifies.

**Hand-off:** the finished schema underpins Phase 5 (NFR — security/backup rest on it) and the
Phase 6 build issues (every issue's data layer is now unambiguous).

## Phase 5 — Non-Functional  *(full mechanical detail — finalized 2026-07-01, session 45)*

**Goal:** Every non-functional requirement made explicit and traceable (`NFR-*`) — the *how-safe /
how-reliable / how-compliant / how-fast / how-provable* overlay on top of the functional spec.

**Why this phase exists (plain English):** Phases 1–4 nailed down *what the system does*, *what it
looks like*, and *what its data is*. But "the memory brain must never silently lose knowledge,"
"a client's data must physically never leak to another silo," "cost must stay under the envelope,"
"a restore must actually work," and "every acceptance criterion must become a real test" are not
features you can point at in one component — they are **cross-cutting properties** that live in the
seams between components. Phase 5 is where those properties stop being implied and become named,
owned, testable requirements. It is the phase that turns the three non-negotiables
(never lose knowledge · never do what it shouldn't · never fail silently) from a slogan at the top
of `CLAUDE.md` into `NFR-*` rows a builder and an auditor can check off.

**The cardinal rule of this phase — reference, don't re-spec.** Most non-functional *machinery*
already exists as the functional half of a component: security enforcement lives in **C6**
(guardrails) + **ADR-007** (injection posture) + **ADR-001** (isolation boundary); observability
lives in **C7**; infra/provisioning/deploy in **C10** + **ADR-005**; cost in **ADR-003** + C7's
meter; compliance/erasure/residency in **C10**; backup/DR in **ADR-008**. Phase 5 does **not**
re-write those FRs. Each `NFR-*` **cites** the FRs/ADRs that implement it and adds only what is
genuinely non-functional and not yet written: a **posture** (the risk stance), a **threshold/target**
(a number the design implied but never stated — p95 latency, RPO, cost ceiling), a **duty** (a
property that must hold across components, e.g. "no audit sink is ever silently mutable"), or a
**verification method** (how we will *prove* the property — DOCS/SPIKE/EVAL/LOAD). If a Phase-5
sweep finds a property with **no** functional owner, that is a real gap → mint the missing FR back
into its component via **change-control** (exactly as Phase 3 minted PERM nodes and Phase 4 minted
owed-back `DATA-` cites).

**The feasibility register is the spine of the test-strategy domain.** Every `AF-*` in
`feasibility-register.md` is a paper-not-proven claim with a verification method. Phase 5's
`test-strategy.md` is where those become a **de-risking schedule**: each AF gets an owner, a
go/no-go gate, and a link to the `NFR-*`/FR it currently holds on paper. The priority spikes
(**AF-001** cost · **AF-002** retrieval · **AF-004** provisioning · **AF-068** injection red-team ·
**AF-069/070/072** backup restore/health/dump-window · **AF-019/067** LOAD) are the load-bearing
ones. No `NFR-*` may claim a property is *proven* — only *specified*, with the spike that will prove
it named.

**Scope call (locked at entry):**
- **OD-009 is already RESOLVED → ADR-008** (2026-06-23). Phase 5 does **not** re-decide backup
  ownership/governance — it **specs the machinery** ADR-008 locked (restore rehearsal, off-platform
  job, backup-health push, RPO/RTO posture). The playbook's older "resolve OD-009" wording is
  superseded by "implement ADR-008 as `NFR-DR.*`."
- **Disaster-recovery posture is backup-restore-with-downtime, not hot failover** (ADR-008, at
  ADR-001's ≤~20-user scale). Phase 5 states the RPO/RTO numbers; it does not introduce HA.
- **Backup/DR storage-*schema* concerns already landed in Phase 4** (or are on the mgmt plane).
  Phase 5 owns the *operational* backup/DR requirements, not new tables.
- **Accessibility (`NFR-A11Y`)** is included only as a **baseline** (keyboard/contrast/semantic
  markup for the 14 surfaces) — the design doc never specified an a11y standard, so per
  anti-hallucination we set a modest floor and log anything richer as OOS, not invent WCAG-AAA.

**ID-convention amendment (one line, change-control):** the `NFR-*` domain codes
(`SEC/INF/OBS/COST/CMP/PERF/TEST/A11Y`) already exist in `id-conventions.md`, **but there is no
backup/DR code.** Add **`DR` — disaster recovery / backup** to the `id-conventions.md` NFR domain
list at Phase-5 entry (backup/DR is a first-class domain in the plan and warrants its own file +
ID space rather than being buried under `INF`).

### Output file structure (`spec/05-non-functional/`)

| File | Domain | Contents |
|---|---|---|
| `_nfr-inventory.md` | — | The **harvest** — every non-functional concern surfaced across the 11 components, 14 surfaces, ADRs, config registry, and the AF register, deduplicated, with owning source + which NFR domain it belongs to. The working ledger the domain files are built from (like Phase-4's `_data-inventory.md`). |
| `security.md` | `NFR-SEC` | Isolation boundary as a security property (ADR-001 §3/§7 — physical, never an RLS predicate); injection containment posture (ADR-007 + AF-068 red-team); secrets custody (the 11 registry secrets, rotation, mgmt-plane token); auth/session posture (C0 Block J); data custody + least-privilege (`service_role` blast radius). |
| `infrastructure.md` | `NFR-INF` | Provisioning reliability (ADR-005 §5 + AF-004); the release model (auto-deploy · canary/release-train · rollback-by-redeploy · version-skew bound — C10 DEP); migration propagation + per-deployment failure isolation (C10 MIG + AF-065); runtime/environment reliability + the mgmt-plane separation. |
| `performance.md` | `NFR-PERF` | The numeric targets the design implied but never stated: retrieval latency + quality (AF-002/019), RLS hot-path cost (`(select …)` initPlan, AF-067), HNSW recall-under-RLS (AF-019), queue/loop throughput, and the **scale envelope** (≤~20 users/silo per ADR-001) every target is stated against. |
| `observability.md` | `NFR-OBS` | The **#3 (never fail silently)** duty made a requirement: the silent-failure detector as an NFR (not just a panel), alert-delivery guarantees + the self-watching alert engine, log-sink durability/retention/immutability, the mgmt-plane health push completeness. References C7; adds the *bar*, not new panels. |
| `cost.md` | `NFR-COST` | The economic envelope + ladder (ADR-003 applied): estimate-grade metering, the soft/hard thresholds, cost-per-client viability (AF-001), and the ladder's enforce-path (C6 FR-6.RTL.004 decides, C5 executes, C7 meters). States the numbers + the "cost-unknown never reads $0" duty. |
| `compliance.md` | `NFR-CMP` | Data residency (AU / `ap-southeast-2`, AF-071); intentional-retention + the erasure/offboarding rigor (C10 DEL/OFF + C2 MNT.017); audit-sink immutability as a compliance requirement (the three sinks + the append-only trigger from Phase-4 re-audit); legal minimums (AF-136). |
| `backup-dr.md` | `NFR-DR` | ADR-008 as operational requirements: RPO (~1 h default) / RTO (downtime-restore) targets; the hourly off-platform dump (AF-072 dump-window) + client-owned encrypted destination; the operator-run restore rehearsal (AF-069); backup-health on the mgmt-plane push (AF-070 + FR-7.MGM.005); the billing-lapse-deletion early-warning. |
| `test-strategy.md` | `NFR-TEST` | How every `AC-*` becomes a real test and reaches `Verified`: the test-layer taxonomy (unit/integration/RLS-policy/E2E/LOAD/EVAL/red-team); the **AF de-risking schedule** (each AF → owner + gate + the NFR/FR it holds); the verification-gate lineage (Phase 1–4 gates → build-time tests); the confidence story (paper-vs-proven, stated openly). |

Create `spec/05-non-functional/` and these nine files. There is no single "spine" file (unlike
Phase-4's `schema.md`); the spine is the **three non-negotiables**, and each domain file shows how
its `NFR-*` rows uphold them. `test-strategy.md` is the closing keystone — it proves every other
file's claims are testable.

### Steps

1. **Harvest (subagent fan-out).** Offload the bulk read (context discipline). Independent subagents:
   one over the 11 components' seams + `⚠️ FEASIBILITY` tags + the "never fail silently / never lose /
   never do what it shouldn't" hooks; one over the 14 surfaces' error/stale-state treatments (these
   are latent `NFR-OBS`/`NFR-SEC` requirements); one over the ADRs (001/003/005/007/008) for the
   posture each locked; one over `feasibility-register.md` (every AF → domain + method + what it
   holds); one over the config registry for the tunable safety/cost/perf thresholds. Merge into
   `_nfr-inventory.md`, tagged by domain, deduplicated, each with a source cite.
2. **Amend `id-conventions.md`** — add the `DR` domain code (change-control, one line + a dated note).
3. **Draft each domain file's `NFR-*` rows.** One row per genuine non-functional property. Each row:
   an ID (`NFR-<domain>.<nnn>`), a one-line statement, the **posture/target/duty** it fixes, the
   **FRs/ADRs it cites** (reference-don't-re-spec), the **AF** that will prove it (if paper-not-proven),
   and `AC-NFR-*` acceptance criteria where the property is checkable. Zero-pad 3 digits, sequential
   per domain.
4. **Gap-sweep → change-control.** Where a property has no functional owner (no FR implements it),
   mint the missing FR back into its component via change-control and cite it. Where a property is
   only paper, ensure its AF exists (add to the register if missing).
5. **Write `test-strategy.md`** — the AF de-risking schedule + the AC→test mapping + the confidence
   story. Every AF gets an owner, a go/no-go gate, and the NFR/FR it currently holds on paper.
6. **Log Open Decisions (`OD-*`)** for every genuine risk-posture fork the user must own (a threshold
   with a real trade-off, an "accept-this-risk-for-v1-vs-harden-now" call, an a11y floor choice).
   Options + recommendation each. **User resolves.**
7. **Run the verification gate** (independent zero-context subagent, checks a–f below). Reconcile
   every finding.
8. **Update** `traceability-matrix.csv` (NFR- rows), `README.md` (Phase-5 status), `SESSION-LOG.md`.
   **User sign-off** → commit.

### Verification gate (independent subagent, checks a–f)

- **(a) Domain coverage** — every NFR domain (SEC/INF/OBS/PERF/COST/CMP/DR/TEST + A11Y baseline) has
  explicit `NFR-*` rows; no domain left implicit.
- **(b) Reference integrity** — every `NFR-*` cites the FR(s)/ADR(s) it rests on, and those cites
  resolve (no dangling FR/ADR ref); no `NFR-*` silently re-specs a functional requirement that
  contradicts its source.
- **(c) Three-non-negotiables sweep** — each non-negotiable is provably covered: #1 (no silent
  knowledge loss — audit-sink immutability, backup restore-proven, erasure-walk intact), #2 (no
  over-broad authority — isolation boundary, `service_role` blast-radius bounded, least-privilege),
  #3 (no silent failure — the observability duty, the self-watching detectors, cost-unknown≠$0).
- **(d) Feasibility spine** — every paper-not-proven `NFR-*` names the `AF-*` that will prove it;
  every load-bearing AF (001/002/004/068/069/070/072/019/067) appears in the test-strategy schedule
  with an owner + gate; no property claimed *proven* that is only *specified*.
- **(e) No new silent gaps** — the gap-sweep found + change-controlled every property lacking a
  functional owner; no residency/retention/security/cost duty left without either an FR or a logged OD.
- **(f) Testability** — `test-strategy.md` maps every NFR domain to a concrete test layer; every
  `AC-NFR-*` is checkable; the AC→`Verified` path is defined (how a criterion becomes a passing test).

**Done when:** every NFR domain has explicit `NFR-*` requirements citing their functional owners;
the AF de-risking schedule is complete with owners + gates; gap-sweep change-controls landed; ODs
resolved; verification gate clean; user signed off.

**Who decides:** user on **risk posture** — the accept-for-v1-vs-harden-now calls, the thresholds
with real trade-offs, the a11y floor. (Backup ownership is already decided — ADR-008.) Claude
drafts, harvests, finds gaps, verifies.

**Hand-off:** with NFRs explicit and every AF on a de-risking schedule, Phase 6 can slice the spec
into build issues where each issue inherits both its FR acceptance criteria **and** the `NFR-*`
constraints (+ the spikes that must pass) as its definition of done. Phase 5 is the last hardening
pass before the backlog.

## Phase 6 — Issue Decomposition  *(full mechanical detail — finalized 2026-07-02, session 47)*

**Goal:** Turn the finished spec (Phases 0–5) into a **buildable, dependency-ordered backlog** — a
set of vertical, independently-buildable issues where every FR and NFR maps to ≥1 issue, every issue
maps back to the requirements it satisfies, and the build sequence (what blocks what, the critical
path) is explicit.

**Why this phase exists (plain English):** The spec proves the design is *coherent, complete, and
traceable*. It does not tell a builder *what to pick up first, what one unit of work is, or when a
unit is done*. A 300-FR spec is not a plan — it's a reference. Phase 6 converts the reference into a
**work queue**: small, ordered, self-contained units a builder (a person, or a fresh Claude chat)
can grab one at a time and complete without holding the whole spec in their head. This is the last
spec-side phase; its output is what the build actually consumes.

### The cardinal rule of this phase — the issue self-sufficiency contract

**Every issue must be buildable by a worker with ZERO conversation history, reading only that issue
plus the repo files the issue names — with no guessing.** This is the per-issue expression of the
repo self-sufficiency test in `CLAUDE.md`: today that test is applied to the *spec*; Phase 6 makes
it true of *each issue individually*, because in the build phase a different chat may pick up each
issue cold.

**What self-sufficiency does NOT mean: copying the spec into the issue.** An issue that restates
`AC-*` text creates a *second source of truth* that rots the moment the FR changes — a direct Rule-0
violation. So the contract is precise:

> **issue + the exact repo files it names = enough to build correctly, with zero guessing.**

The issue is a **complete, precise build order that points into the repo** — never a duplicate of
it. Self-sufficiency comes from the issue *naming every input by stable ID* (leaving nothing to
"figure out"), carrying a **context manifest** (the exact files to open, nothing more), and stating
its **definition of done as `AC-*`/`AC-NFR-*` IDs** (whose text lives in the FR, read there). The
verification gate then *proves* it by having a zero-context subagent try to build from the issue +
repo alone and report every gap (see gate check (f)).

The only things an issue states in its own words are the things that don't exist anywhere else: the
**slice boundary** (what's in vs. out of this unit), the **build order within the slice**, and any
**integration note** that spans the FRs it bundles.

### Scope calls (locked at entry, session 47)

- **Issues are canonical as repo markdown in `spec/06-issues/`, AND mirrored to GitHub Issues —
  maintain both** (operator decision, session 47: GitHub is wanted for at-a-glance progress + quick
  in-place notes). To keep two homes from splitting the source of truth (Rule 0), they are divided
  by **what each OWNS**, not duplicated:
  - **Repo markdown = canonical for the issue's DEFINITION** — scope, the FR/`AC-*`/`NFR-*` IDs it
    implements, touchpoints, context manifest, dependencies. The build resumes across chats by
    reading the repo, so definition must live in the repo.
  - **GitHub = the issue's BUILD-STATE** — open/closed, task-list checkboxes, progress comments,
    assignees. This is where day-to-day progress is seen and jotted.
  - **The sync rule:** a change to a *definition* is made in the repo markdown and pushed to GitHub;
    a note made in GitHub that would change a *definition* must be **reconciled back into the repo
    markdown before it is authoritative** (a GitHub-only definition edit is not yet "decided", per
    Rule 0). GitHub issues are created from the canonical markdown via `gh issue create` at cut time;
    each GitHub `#<n>` is recorded in that issue file's frontmatter (`github:`) + the matrix `issue`
    column. Keeping the two in agreement is an explicit maintenance duty, not an afterthought.
- **Fine-grained vertical (tracer-bullet) slices, plus a grouping/ordering index.** Many small,
  independently-buildable issues (each ≈ one coherent FR-cluster / thin end-to-end slice) — the most
  chat-robust unit — with a `_backlog.md` index that supplies the epic-level grouping **and** the
  build-order / dependency map + critical path on top. Buildable atoms + a navigable map.
- **A "vertical slice" = a thin end-to-end cut of one coherent capability:** its data (schema/RLS/
  migration) → its logic (the FR behavior) → its surface (the UI panel/state, if any) → its
  guardrail/observability hooks (if any). Small enough to build in one focused session; big enough
  to be independently testable against its `AC-*`. Pure-enabling work with no user-facing surface
  (schema bootstrap, RLS scaffold, the observability skeleton) is a legitimate **foundational
  issue** — it maps to the FRs/`DATA-`/ADRs it stands up, not to a surface.
- **Coverage is total.** Every FR across C0–C10 **and** every `NFR-*` must be claimed by ≥1 issue —
  the Phase-6 analog of Phase-1's "no orphan design line." An FR claimed by no issue is a build gap.
  Conversely every issue names ≥1 FR/NFR/ADR/AF it exists to satisfy (no orphan issue).
- **The six launch-gating spikes (OD-157) are first-class.** `AF-068` (injection red-team) ·
  `AF-069` (restore) · `AF-001` (cost) · `AF-067` (RLS latency) · `AF-078` (webhook) · `AF-077`
  (brute-force) each become a **gating spike-issue** scheduled *before* the feature issues that rest
  on them, and each dependent feature issue names the spike in its "blocked-by" list. Build-time and
  fast-follow AFs are attached to the issues they gate as DoD notes, per the RP-1 posture.
- **ID-convention amendment (change-control, at entry):** `id-conventions.md`'s `ISSUE-` row
  currently reads "GitHub issue · `#<n>`". Amend it to **`ISSUE-<nnn>` — a canonical repo-markdown
  issue file (`spec/06-issues/ISSUE-<nnn>-<slug>.md`)**, with the optional exported GitHub `#<n>`
  recorded in the issue's frontmatter + the matrix `issue` column *if and when* exported. Add a
  dated change-control note, exactly as Phase-5 entry added the `DR` domain.

### Output file structure (`spec/06-issues/`)

| File | Contents |
|---|---|
| `_TEMPLATE.md` | The issue template — the self-sufficiency contract as a fill-in form. Every issue is a copy of this. Carries the DRY rule (point into the repo by ID; never restate `AC-*` text). |
| `_backlog.md` | The **index + map**: every issue listed, grouped by epic/capability, with status, its blocked-by / blocks edges, the **build-order sequence**, and the **critical path**. The one file you read to see the whole plan. Also carries the **coverage ledger** (or links it): every FR/NFR → the issue(s) that claim it, proving zero orphans. |
| `ISSUE-<nnn>-<slug>.md` | One file per issue. Sequential, zero-padded 3 digits, never renumbered (retired IDs leave gaps, per `id-conventions.md`). |

Create `spec/06-issues/` and these files. `_backlog.md` is the spine (the Phase-6 analog of Phase-4's
`schema.md`); each issue file shows how its slice satisfies its named requirements.

### The issue template (every issue carries all of these)

1. **Frontmatter** — `id: ISSUE-<nnn>`, `title`, `epic` (grouping), `status` (`ready`/`blocked`/
   `in-progress`/`done`), `github: #<n>` (blank until exported).
2. **One-line goal** — the slice in a sentence.
3. **Scope: in / out** — the slice boundary in the issue's own words (this is genuinely new prose).
   What this issue delivers, and explicitly what it does *not* (deferred to which other issue).
4. **Implements (the traceability spine)** — the FR IDs (and their component), the `NFR-*` IDs, the
   `ADR-*`/`AF-*` it rests on. By ID, not restated.
5. **Definition of done** — the `AC-*` and `AC-NFR-*` IDs that must pass (their text is read in the
   FR — do **not** copy it here). Plus the spikes (`AF-*`) that must be green if this issue is gated.
6. **Touches** — `DATA-*` tables/fields, `PERM-*` nodes, `CFG-*` keys, `UI-*` surfaces, connectors.
   The complete blast radius, by ID.
7. **Context manifest** — the **exact** files a builder must read (the FR component file, the schema
   group, the surface file, the relevant ADR/NFR), nothing more. Same discipline as every component
   file's manifest — this is the heart of self-sufficiency.
8. **Dependencies** — **blocked-by** (issues/spikes that must land first) and **blocks** (what this
   unblocks). Drives the `_backlog.md` map.
9. **Build order within the slice** — the sequence inside this unit (e.g. migration → RLS policy →
   FR logic → surface wiring → guardrail hook → test), where order matters.
10. **Verification** — how the DoD is proven (which test layer per `test-strategy.md`; which
    `AC-NFR-*` posture must hold). The AC→`Verified` path for this slice.

### Steps

1. **Harvest / coverage extraction (subagent fan-out — context discipline).** Independent subagents
   read the requirement files (C0–C10), the NFR domain files, the surfaces, and the data model, and
   return a structured **coverage inventory**: every FR + every NFR, its component/domain, its
   `AC-*`, its `DATA-`/`PERM-`/`CFG-`/`UI-` touchpoints, and its cross-component seams. This is the
   raw material the slices are cut from — no FR may be missed, so this is an extraction, not a
   sample. Merge into the coverage ledger.
2. **Amend `id-conventions.md`** — the `ISSUE-<nnn>` change-control note (see Scope calls).
3. **Cut the slices.** Group the coverage inventory into vertical tracer-bullet slices per the
   slicing rule. Assign `ISSUE-<nnn>` IDs. Foundational/enabling issues first (schema bootstrap,
   auth, RBAC/RLS scaffold, config bootstrap, observability skeleton), then feature slices, then
   cross-cutting hardening. Write each `ISSUE-<nnn>-<slug>.md` from `_TEMPLATE.md`.
4. **Build the dependency map + `_backlog.md`.** Resolve blocked-by/blocks edges into a DAG;
   sequence the build; identify the critical path; slot the six gating spike-issues (OD-157) ahead
   of their dependents. Write the coverage ledger (every FR/NFR → issue) into `_backlog.md`.
5. **Gap-sweep → change-control.** If the coverage ledger shows any FR/NFR claimed by **no** issue,
   that is a build gap → cut the missing issue (or extend one) and record it. If slicing surfaces a
   genuine spec hole (a behavior no FR covers), that is a real defect → mint the FR back via
   change-control, exactly as prior phases did. Log any conscious deferral in `out-of-scope.md`.
6. **Log Open Decisions (`OD-*`)** for any genuine build-sequencing fork the operator must own (e.g.
   "build connector X before Y", a scope-cut for v1, a spike that could be deferred). Options +
   recommendation each. **Operator resolves.**
7. **Run the verification gate** (independent zero-context subagents, checks a–f below). The
   headline check is **(f) the per-issue self-sufficiency build test** — spawn a zero-context
   subagent per issue (or a representative sample across every epic + all six spike-issues + the
   most seam-heavy issues) that reads **only** the issue + the repo files it names and reports:
   *"Could I build this without guessing? What's missing, dangling, or assumed?"* Reconcile every
   finding — patch the issue until the answer is an unqualified yes.
8. **Create the GitHub mirror.** After the issue set is verified clean, create one GitHub issue per
   `ISSUE-<nnn>` via `gh issue create` (title + a body that links to the canonical repo file and
   lists the DoD `AC-*` as a task-list for progress-ticking — *link, don't duplicate the definition*).
   Record each returned `#<n>` back into the issue file's `github:` frontmatter + the matrix `issue`
   column. Thereafter maintain both per the sync rule (Scope calls). Requires `gh` authenticated.
9. **Wire `traceability-matrix.csv`** (the `issue` column, every FR → its `ISSUE-<nnn>` and, once
   exported, its GitHub `#<n>`), update `README.md` (Phase-6 status) + `SESSION-LOG.md`. **Operator
   sign-off** → commit.

### Verification gate (independent subagent, checks a–f)

- **(a) Total coverage** — every FR (C0–C10) and every `NFR-*` is claimed by ≥1 issue; the coverage
  ledger has no empty cell. No orphan requirement (nothing that never gets built).
- **(b) No orphan issue** — every issue names ≥1 FR/NFR/ADR/AF it satisfies; no issue exists that
  builds something the spec never asked for.
- **(c) Traceability integrity** — every ID an issue cites (FR/AC/NFR/DATA/PERM/CFG/UI/ADR/AF)
  resolves to a real, current artifact; no dangling or renamed reference (the exact decay class the
  pre-Phase-6 audit found — do not re-introduce it).
- **(d) Dependency soundness** — the blocked-by/blocks graph is a DAG (no cycles); every dependency
  points at a real issue/spike; the six gating spikes (OD-157) precede their dependents; the
  critical path is identified.
- **(e) Slice quality** — each issue is a genuine vertical slice (independently buildable + testable
  against its `AC-*`), not a horizontal layer-dump; foundational issues are ordered ahead of the
  features that need them; no issue is too large to complete in a focused session without further
  decomposition.
- **(f) Per-issue self-sufficiency (the headline)** — a zero-context subagent, reading only the
  issue + the files its context manifest names, can state the next build action and act **without
  guessing**; every gap it finds is patched. Run per-issue (sampled across all epics + all six
  spike-issues + the seam-heavy issues at minimum). **No issue copies `AC-*`/spec text** (DRY /
  single-source-of-truth check — a self-sufficiency *shortcut* that would rot is itself a failure).

**Done when:** every FR + NFR maps to ≥1 issue and every issue back to its requirements; the
dependency map + critical path + coverage ledger are complete in `_backlog.md`; the six gating
spikes are sequenced ahead of their dependents; every issue passes the self-sufficiency build test;
gap-sweep change-controls landed; ODs resolved; verification gate clean; matrix wired; operator
signed off.

**Who decides:** operator on **build sequencing / scope** — the order forks, any v1 scope-cut, any
spike deferral. Claude harvests coverage, cuts the slices, builds the map, finds gaps, verifies.

**Hand-off:** the build begins. A fresh chat picks up the top ready issue from `_backlog.md`, reads
only that issue + its context manifest, and builds it to its `AC-*` — the self-sufficiency contract
means it needs nothing from any prior conversation. The priority feasibility spikes have already
de-risked the scary parts. This is the terminus of the spec effort: the repo is now a build queue.

---

## How to use these playbooks across chats

A fresh chat: read CLAUDE.md → process-overview.md → this file → SESSION-LOG.md (resume point) →
the registers, then execute the current phase's playbook. If a phase's steps feel
under-specified for the work in front of you, that's the "finalize before entry" pass — tighten
the playbook *first* (it's a living doc under change-control), then proceed. Never improvise past
a gap; write the procedure down, then follow it.
