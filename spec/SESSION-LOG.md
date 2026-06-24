# Session Log

Reverse-chronological. One entry per working session. This is cross-session memory — the
next session reads the top entry to know exactly where to resume.

---

## Session 15 — 2026-06-24 — PHASE 1 ENTERED · component-0 scope finalized · Supabase Auth research-first gate run

User asked to confirm Phase 0 done + whether to reason about Phase 1 before starting (yes to both). Read the
whole repo + had subagents map the design-doc Login section and re-read every foundation file. **Phase 0 is
confirmed complete** (all 8 ADRs Accepted; the 3 SPIKE/EVAL priority spikes AF-001/002/004 are build-time by
design). **Phase 1 is now entered.** No FRs drafted yet — this session did the "finalize before entry" pass +
the research gate. **Nothing here is a code change; it's spec scaffolding for component 0 (the golden exemplar).**

**Two scope decisions locked (user-approved), recorded in `phase-playbooks.md` → "Component 0 — entry
finalization":**
1. **C0 = authentication only ("who you are").** In scope: dashboard login (Google/Microsoft as a *login-identity
   provider* via Supabase Auth), email+password, **2FA** (TOTP enroll+challenge), **sessions** (JWT, TTLs,
   cookies, expiry/re-auth), **invite-based account creation**, **first-boot Super Admin seed**, **"trouble
   signing in"** recovery + support-request handling, **inbound webhook authentication** (HMAC/JWT verify of
   GHL/Google/Slack webhooks — a hard control per ADR-007). Out of C0: roles/permissions/clearances/RLS → **C1**;
   **connector OAuth + token lifecycle** (the AI's data access to Gmail/Drive/GHL/Slack, AF-013/014) → **C3 Tool
   Layer**. The **seam** is the session establishing `auth.uid()`. NOTE: the design doc places much auth content
   **structurally under the `## 1.` RBAC header** (L643–816: app auth flow, sessions, webhook security) — we
   re-home it to C0 by semantics. C0's own header is only L358–390.
2. **Supabase Auth research-first gate done BEFORE drafting C0 FRs** (Supabase is a *platform* dep, so findings
   live in `feasibility-register.md`, not `tool-integrations/`).

**Supabase Auth research pass (2026-06-24, 4 parallel primary-source agents) → `feasibility-register.md` Block J
(findings SA1–SA17) + new AF-073–077 + sharpened AF-067.** It **refuted/corrected 6 design-doc claims** — these
MUST be cited from Block J, not the design doc, in C0 FRs:
- ⛔ **Refresh-token "7-day TTL" REFUTED** — Supabase refresh tokens **never expire**; single-use rotating, 10s
  reuse interval, reuse-detection revokes the whole session. Session bounds = optional time-box/inactivity
  (Pro+, no default, lazily enforced). The design's `auth.session_refresh_days:7` maps to **no native setting**.
- 🟠 **HTTP-only cookies** — NOT the documented default (`@supabase/ssr` says HttpOnly "not necessary") → AF-073.
- ⛔ **"Server-side session continues mid-task"** — no such object; either middleware refreshes the JWT or
  background runs as `service_role` (bypasses RLS, no `auth.uid()`).
- ⛔ **`two_factor_required` as a config flag** — no org-wide end-user MFA toggle exists; must be **built** via
  restrictive `aal2` RLS on every protected resource + post-login app gating → AF-076.
- ⛔ **72h invite links** — hard cap **24h (86400s)**, global setting, not per-link → AF-074 + custom-token fork.
- ⬜ **Microsoft Authenticator** — unnamed by Supabase; compat rests on open RFC-6238 → AF-075.
- ✅ Verified & useful: TOTP default-on; Google+Azure login IdP (pin tenant, require `email` scope, `xms_edov`);
  invite-only supported (admin API bypasses the signup toggle); **custom SMTP mandatory for prod** (built-in
  2/hr); **no per-account login lockout** (platform Cloudflare/fail2ban + CAPTCHA + leaked-pw Pro+) → AF-077;
  **asymmetric JWT (RS256/ES256) default since 2025-10-01** → local JWKS verification (`getClaims`), but
  `getUser` where revocation matters; API-key rename anon→`sb_publishable`, service_role→`sb_secret`.
- **AF-067 SHARPENED (load-bearing for C1/ADR-006):** `STABLE` alone ≠ once-per-statement; helper calls MUST be
  wrapped `(select …)` to force the initPlan (Supabase benchmark **178,000ms→12ms**), index policy cols, scope
  `TO authenticated`, wire the `auth_rls_initplan` lint. Now a binding implementation rule, not an open risk.

**Files changed:** `phase-playbooks.md` (Component 0 entry finalization), `feasibility-register.md` (Block J,
AF-073–077, AF-067 sharpened, next-AF→AF-078), `README.md` (Phase-1 row 🟡 + status line), this log.

**NEXT STEP — draft `spec/01-requirements/component-00-login.md`** (per Phase-1 playbook steps 1–5), as the golden
exemplar. Open with a **Context Manifest** (ADR-001 §2/§5 Supabase+secrets custody, ADR-006 §6 service-role
bypass, ADR-007 webhook-auth-as-hard-control; standards: config-edit-taxonomy, migration-discipline; glossary
auth terms; **feasibility Block J + AF-073–077**; design-doc **L358–390 + L643–816**). **Area codes:**
AUTH (login/OAuth/2FA), SESS (sessions/tokens), INV (invites), SEED (first-boot Super Admin), REC (recovery/
support), WHK (webhook auth). Decompose into atomic FRs citing **Block J** for vendor facts. Build
`system-map/00-login.md` zoom-in alongside (per-component map policy). Then user resolves ODs → ACs → verification
gate → sign-off.

**Component-0 OD candidates to LOG when drafting** (4 research forks + ~8 from the design-doc mapping — none
logged yet; will be OD-012+): (a) **session-lifetime model** — adopt Supabase rotating-never-expiring + inactivity
vs custom bounds [SA3]; (b) **mid-task continuation** — middleware JWT-refresh vs service_role [SA5]; (c) **invite/
setup-link expiry** — re-spec ≤24h vs custom invite-token layer [SA11/12, AF-074]; (d) **HttpOnly** — hard
requirement (spike AF-073) vs accept default [SA4]; (e) **2FA delivery UX** (same-page vs redirect) + wrong-code
rate-limiting; (f) **per-user 2FA override** vs deployment-wide; (g) **support-request notification** — who's
alerted on submit + phone capture/lookup + call logging + unreachable-user escalation; (h) **invite edge cases** —
expired→re-request? admin revoke-early? OAuth+password dual setup?; (i) **Super Admin seed** — OAuth option? bounced-
email recovery path?; (j) **RLS every-table coverage** discipline (ties to AF-076); (k) **webhook** — secret
rotation, replay beyond timestamp, accept-rate limits; (l) **webhook failure alert** — recipient, source-id,
escalation action.

**Carry-ins (unchanged):** GHL/Gmail/Slack connector findings (F1–F6, AF-013/014) are for **C3**, not C0; **OD-011**
(Slack app class) resolves at the C3 Slack connector; **`standards/rbac.md`** owed when C1/data-model specced
(from ADR-006); **OD-010** (compensation/rollback) is a C5/C6 item. Build-time spikes AF-001/002/004 + the new
AF-073–077 run on a runnable prototype.

---

## Session 14 — 2026-06-23 — ADR-008 ACCEPTED (backup & disaster recovery) — last Phase-0 blocker closed

User asked "what's next," chose **OD-009 (backup/DR)** — the last actionable Phase-0 item (the 3 SPIKE/EVAL
priority spikes are build-time, deferred). Then delegated the three forks to me ("what do you recommend and
why, explain simply"). Drafted → he probed two points (why PITR ~$100, the Storage-bucket caveat) → resolved
both → wrote **ADR-008**, closing OD-009. Phase 0 now has **no blockers left**.

**Research-first, per the AF-003 lesson (vendor facts go stale):** ran a dated primary-source pass on Supabase
backup/DR before asserting anything. It **reframed the whole decision** — the dominant loss path is **the
client's credit card, not a crash**: because ADR-001 puts the project on the client's account, a billing lapse
pauses it after ~7 days → restorable 90 days → then **the project AND all in-project backups (daily + PITR) are
permanently deleted together**. PITR alone can't save you (it lives inside the doomed project).

**Decided (6 binding parts):** *(Decision part 1 was revised later in the same session — see "In-session
revision" below; the entry reflects the final state.)*
- **Default = free daily in-project backups + an hourly off-platform snapshot** (~1-hour RPO, near-zero cost,
  AF-072-bounded). **PITR is an opt-in upsell** (off by default, ~$100+/mo on the client's card, for
  minute-level RPO or brains too big for an hourly logical dump). Running below hourly is a **logged downgrade
  exception**, never a silent default.
- **Independent off-platform `pg_dump` to a client-owned destination** (different region), run **hourly**,
  independent of the primary project lifecycle — the **only** defense against the deletion path. **Client-owned**
  so the operator never holds business data (preserves the ADR-001 boundary). Operator-held copy = logged
  per-client exception.
- **Ownership split:** client owns + pays; **operator operates + verifies** (the OD's core "whose job" ambiguity).
- **Tested restore rehearsal** to a throwaway project (Supabase verifies nothing; we do) — confirms DB + pgvector
  + auth rows come back queryable. ⚠️ AF-069.
- **Backup-health joins the management-plane push** (ADR-001 §7) — operational metadata only: recovery tier
  (daily+hourly, or PITR), last-backup time, **project status incl. pause/billing-at-risk**, off-platform-
  snapshot + rehearsal results; read via Supabase Management API (⚠️ AF-070); **loud Super Admin alert on
  lapse** → a failing client backup is *seen* before the deletion window (protects #1 + #3).
- **Golden rule governs scope + Storage buckets out of scope** (OOS-013): per `L1634` source files live in
  their system of record, **referenced (`source_ref`) not copied into Supabase**; v1 Storage holds only
  **regenerable offboarding exports** (`L97`), checked against the design doc — not source-of-truth. DR posture
  = restore-with-downtime, not hot failover (Enterprise-only; OOS-014).

**In-session revision (operator's call):** Austin pushed that ~$100/mo PITR-on-by-default is overkill, and
(correctly, citing the golden rule) that files should be **referenced in their system of record, not stored in
Supabase**. Both confirmed: (1) **default flipped to hourly off-platform snapshots + free daily; PITR demoted
to a documented opt-in upsell** — cheaper, and acceptable because memory is re-derivable from systems of record
that survive any incident (so AF-072 now gates the *default* hourly cadence). (2) The **golden rule (`L1634`)**
was already the design's law (only Storage use is the transient offboarding export); lifted it into the glossary
as a **binding principle** so no future component copies source files into Supabase. ADR-008 carries a dated
**Revision** note (Accepted-but-ink-wet, transparent amendment per change-control). Glossary +Golden rule,
+Off-platform snapshot, +RPO, +PITR upsell, +Restore rehearsal.

**Vendor facts that drove it (primary-source, 2026-06-23):** PITR = paid add-on, 2-min RPO, replaces daily,
not Spend-Cap-covered; free daily = Pro 7d/Team 14d, can lose ~24h; backups cover **DB only (incl. pgvector +
auth), NOT Storage buckets**; **Management API can read backup status** without business data; **no platform
restore-verification**; **no auto-failover** on Pro/Team. Could NOT verify from primary docs (→ AFs): backup
**region locality / AU residency** (AF-071), exact **Management-API payload fields** (AF-070).

**Captured as MUST-TEST:** new feasibility **block I** — AF-069 (restore actually works, SPIKE — the load-
bearing one), AF-070 (Management API exposes the health fields, SPIKE), AF-071 (backup region/AU residency,
DOCS/vendor confirmation — primary docs insufficient), AF-072 (off-platform dump completes in-window at scale,
LOAD).

**Files changed:** `adr/ADR-008-backup-dr.md` (new, Accepted); `open-decisions.md` (OD-009 → 🟢);
`adr/README.md` (ADR-008 row); `feasibility-register.md` (new block I AF-069–072; next AF-073);
`out-of-scope.md` (OOS-013 Storage buckets, OOS-014 HA/failover; next OOS-015); `what-makes-it-great.md`
(non-negotiable #1 watch + dimension-11 row cleared 🔴→🔵 + "one gap left" summary); `README.md` (ADR status
line — ADR-008, no Phase-0 blockers, next = Phase 1 component 0).

**Next step:** **Phase 0 is done — start Phase 1, component 0 (Login)** as the golden exemplar, building its
`system-map/` zoom-in alongside it (per the per-component map-build policy). Phase-1 carry-ins to honor:
**propagate the AF-003 corrected vendor values** into connector/token/rate-limit FRs (esp. GHL refresh-token
persistence F5, Gmail per-env quota F1, Slack app class **OD-011**); **OD-011** (Slack app registration,
🟡 rec (a) internal-custom-app) resolves when the Slack connector/ingestion component is specced;
**OD-010** (compensation/rollback) is a Phase-1 Harness/Guardrails item; write **`standards/rbac.md`** when
component 7 / data model is specced (owed from ADR-006). The 3 SPIKE/EVAL priority spikes (AF-001/002/004)
plus the new AF-069/070/072 are build-time, run on a runnable prototype.

---

## Session 13 — 2026-06-23 — AF-003 vendor-claims spike (DOCS pass) — first feasibility item verified

User asked "what's next," chose feasibility spikes, then asked whether "priority spikes" = "feasibility
spikes" (yes — priority = the run-first subset that can invalidate the architecture; same `AF-` register).
**Honest constraint surfaced:** 3 of the 4 priority spikes (AF-001 cost, AF-002 retrieval, AF-004
provisioning) are SPIKE/EVAL and **need a runnable prototype that doesn't exist** — can't run from inside a
spec repo without fabricating results (would violate non-negotiable #3 + anti-hallucination rule). The **one
doable now** is **AF-003 (vendor-claims, method DOCS)** — pure documentation verification. Ran it: 4 parallel
research agents over Google/Gmail, GHL+Slack, Supabase+pgvector, Inngest+Railway, all against current primary
vendor docs.

**Result — 3 claims stale/refuted, 1 design fork, rest verified:**
- ⛔ **AF-011 (GHL rate limit) REFUTED** — not "120/min, no burst"; real = **100 req/10s burst + 200k/day, per
  app per location**. No per-minute limit. Daily cap is the real ceiling.
- ⛔ **AF-014 (GHL OAuth refresh) PARTLY REFUTED** — refresh token is **NOT indefinite**; it **rotates per use**
  + dies after **1 yr unused**. ⚠️ **#1 risk:** harness must persist the new refresh token every refresh or
  silently lose access.
- 🟠 **AF-010 (Gmail quota) STALE** — "250/sec" gone → **6,000 QU/min/user**, and **date-dependent** on GCP
  project activation (pre/post 2026-05-01). Pin per-environment. +100-token-per-account cap.
- 🟠 **AF-017 (Edge Functions) STALE** — "150s" is Free-only; paid = 400s; real constraint = **2s CPU cap (all
  plans)**. Cite that, not 150s.
- 🔴 **AF-012 (Slack) → DESIGN FORK, logged OD-011** — since 2025-05-29 non-Marketplace apps have
  `conversations.history/.replies` throttled to **Tier 1 (1 call/min × 15 msgs)** = lethal for history ingest.
  **Exempt: Marketplace apps + internal custom apps.** OD-011 recommends **(a) internal custom app per client
  workspace** (fits ADR-001/005), EVAL-gated on a live workspace.
- 🟢 **Verified:** AF-013 (Google OAuth — sharper: Testing=7d expiry, 6mo-unused death, password-reset
  revoke, CASA annual reassessment ~weeks = onboarding critical path), AF-015 (Slack xoxb), AF-016 (Realtime —
  soft quotas + msgs/sec & joins/sec ceilings), AF-018 (Inngest — **per-key concurrency ✓ confirms ADR-004**;
  wording fixes: per-step ≤2h, `onFailure`/`inngest/function.failed` not "DLQ"; Free concurrency=5), AF-020
  (Railway — pre-deploy command blocks-on-fail ✓ confirms migrate-on-release + **branch-per-env corroborates
  AF-064 canary model**), AF-021 (cross-account Supabase works; ⚠️ service-role key = god-mode bypass-RLS, +
  static-egress-IP assumption for allowlisting).
- 🟡 **AF-019 (pgvector HNSW)** — HNSW verified, but **kept SPIKE/LOAD-open**: RLS/WHERE filters apply *after*
  the ANN scan, so per-client RLS (ADR-006) can starve recall; must LOAD-test **with RLS predicates applied**.

**Files changed:** `feasibility-register.md` (AF-003 row → 🟡; Block A all 12 statuses set; new "AF-003 DOCS
verification findings" subsection F1–F12 with corrected values + sources + design impacts); `open-decisions.md`
(new **OD-011** Slack app class, 🟡 rec (a); next OD-012); `README.md` (status line — spike progress + OD-011).

**Also built (user request) — the tool-integration research-first gate.** The tool set is open-ended and
client-driven; new connectors arrive per client/use case, and AF-003 just proved vendor facts go stale. So we
made a **repeatable research trigger**: no tool is specced until a dated, primary-source dossier exists.
- `standards/tool-integration-research.md` (new, **Binding**) — the 5-step procedure (open dossier → parallel
  research fan-out over 12 dimensions, primary docs only, date-stamped → file AF/OD/glossary outputs →
  verification re-check → only then spec the connector FRs) + the 12 research dimensions (auth/token lifecycle,
  rate limits, API, webhooks, data/sensitivity, provisioning, isolation, cost, failure, versioning) each tied to
  an ADR / non-negotiable, with the AF-003 finding that proves it matters + a **staleness / `Re-verify by`** rule.
- `tool-integrations/_TEMPLATE.md` (new) — the per-tool dossier shape.
- `tool-integrations/README.md` (new) — index; **pre-seeded** with Google/Gmail, GHL, Slack rows pointing at the
  AF-003 F1–F6 findings + OD-011 (so the spike work feeds the dossiers when those connectors are specced).
- `CLAUDE.md` — new section **"Adding a new tool / connector (research-first — this triggers research)"** after
  the feasibility rules; `README.md` repo map (+standard, +`tool-integrations/` folder).

**Next step:** **OD-009 (backup/DR — elevated, top-bar)** is now the last actionable Phase-0 item before
Phase 1 (the 3 SPIKE/EVAL priority spikes are build-time, deferred). Resolve OD-009 draft→approve (may spawn a
small ADR on the ownership question — client owns the Supabase, so backup ownership/verification is ambiguous;
underpins non-negotiable #1). **Then Phase 1 component 0 (Login)** as the golden exemplar + its `system-map/`
zoom-in. Corrected vendor values (F1–F12) must propagate into the Phase-1/2 connector, token-lifecycle, and
rate-limit FRs — esp. GHL refresh-token persistence (F5), Gmail per-env quota (F1), Slack app class (OD-011).
Carry-over from ADR-006: write `standards/rbac.md` when component 7 / data model is specced. OD-010
(compensation/rollback) is a Phase-1 Harness/Guardrails item.

---

## Session 12 — 2026-06-23 — ADR-007 ACCEPTED (prompt-injection posture) — last load-bearing ADR

Fourth **draft→approve** ADR, and the **last** of the seven. Closes OD-007. User was confused by the
first draft and asked to simplify — worked it through in plain language (Option A "spot the fakes" vs
Option B "lock the doors"; bank-teller-and-vault analogy landed). He then raised two sharp instincts
that *validated* the design: (1) detection is unreliable → that's why we lock the doors; (2) scanning
everything is expensive → that's why the one paid scanner is off by default. Approved, and explicitly
asked to "make sure to have the on/off switch for the smoke alarm" → captured as config
`injection_semantic_detection` (default **off**).

**Decided (6 binding parts):**
- **Containment-first, not detection-first.** The security boundary is the controls that **ignore
  prompt content entirely** — hard limits in code (`L2053`/`L2066`), default-deny RBAC + RLS (ADR-006),
  approval gates (`L2772`), rate limits (`L2809`), physical cross-client isolation (ADR-001),
  sole-writer + sensitivity-gated memory (ADR-004). A successful injection is **contained, not
  necessarily caught**. This is "controls before gates" (ADR-003) applied to injection, and the only
  posture consistent with non-negotiable #2.
- **Keep the cheap deterministic layers, always on:** external-data **boundary tagging** (`L2965`),
  high-precision **regex tripwires** (`L2943`, log/alert only — not a gate), **webhook HMAC auth**
  (`L742–809`, a real hard control = authentication, not content-detection).
- **Detection-as-signal:** the **embedding-similarity classifier** (`L2959`, the "partly theater" part)
  ships **off by default**; when on it may only flag for triage — **never** auto-quarantine/discard/
  block. Promotion past off-by-default is EVAL-gated.
- **Fail-safe = retain + route to human.** Quarantine **holds** content (shadow-retain) and never
  machine-discards it; **discard is a human-only logged decision** (protects non-negotiable #1). Every
  match logged loudly; every quarantine alerts (protects #3).
- **Thresholds (0.85/0.95) are signal-tuning knobs, not safety dials** — config registry must document
  them as such so no future requirement mistakes a threshold for the boundary.
- **Rejected:** A1 detection-primary (the review's "theater"; unbounded false-negatives + false-positive
  quarantine drops knowledge); mandating the embedding scan on the hot ingest path (read-path cost,
  unproven payoff); machine auto-discard (violates #1).

**Captured as MUST-TEST:** new feasibility block **H** —
- **AF-068 (SPIKE / red-team)** — the containment boundary holds end-to-end: **no authorized-but-
  dangerous autonomous action path** reaches a consequential side effect (external comm / financial /
  cross-client read / destructive write / memory poisoning) without hitting a code gate that ignores
  prompt content. The whole posture rests on this; a bypass must be **closed in code**, not patched with
  a detection rule.

**Files changed:** `adr/ADR-007-injection-posture.md` (new, Accepted); `open-decisions.md` (OD-007 →
🟢); `adr/README.md` (ADR-007 Accepted); `feasibility-register.md` (new block H AF-068; next AF-069);
`glossary.md` (+Containment-first injection posture, +External-data boundary tag, +Detection-as-signal);
`what-makes-it-great.md` (#2 ⚠️ flag cleared → now points at AF-068 red-team residual); `README.md`
(ADR status line — **all seven ADRs landed**).

**Next step:** **Phase 0 ADRs are done.** Remaining before Phase 1: the **priority feasibility spikes**
(AF-001 cost, AF-002 retrieval, AF-004 provisioning) and **OD-009 (backup/DR — elevated, top-bar)**.
Then **Phase 1 component 0 (Login)** as the golden exemplar, building its `system-map/` zoom-in
alongside. Note still-owed from ADR-006: the `standards/rbac.md` standard (write it when component 7 or
the data model is specced). OD-010 (compensation/rollback) is a Phase-1 Harness/Guardrails item.

---

## Session 11 — 2026-06-23 — The three non-negotiables captured (operator's top bar)

User noted (correctly, applying Rule 0) that the "what does *great* mean to you?" question lived
only in chat, never the repo. He answered: **wants all three** — never lose/corrupt knowledge,
never do something it shouldn't, never fail (silently). Affirmed coherent: the three don't conflict
(integrity / safety / observability), they only cost rigor.

**Captured:**
- `what-makes-it-great.md` — new top section **"The three non-negotiables (the operator's top bar)"**:
  each invariant + what upholds it + what threatens it. Framed as the **ranking rule** for Phase-1
  trade-offs (invariant wins over convenience/speed/scope).
- `process-overview.md` — added the three to "what the user wants."
- **OD-009 (backup/DR) ELEVATED** — it underpins non-negotiable #1, so it's now top-bar, not a
  Phase-5 nicety; resolve early.
- `CLAUDE.md` — added a binding **"three non-negotiables"** section right after Rule 0 (they were
  only transitively reachable via process-overview; now every chat treats them as the ranking rule).

**Consequence to remember:** invariant #1 leans on OD-009 (backup/DR — still a gap); invariant #2
leans on ADR-007 (injection — still open, next up). So the two open items both touch a non-negotiable.

**Next step:** unchanged — **ADR-007 (prompt-injection posture)**, draft→approve (last load-bearing
ADR); then priority spikes (AF-001/002/004); then Phase 1 (component 0 Login). Resolve OD-009 early
given its elevation.

---

## Session 10 — 2026-06-23 — ADR-006 ACCEPTED (dynamic roles vs static RLS)

Third **draft→approve** ADR. Closes OD-006 — roles are editable at runtime but RLS is authored at
migration time. User asked to "simplify" and worked through it interactively (anchored on "aren't we
using Supabase for login/OAuth?" — yes, and ADR-006 sits on top of it). The keycard analogy landed;
user pushed "why not make both [grant + revoke] instant?" — which pushed the design to the *simpler*
pole and removed a whole sub-problem.

**Decided (6 binding parts):**
- **False fork — keep both via static, data-driven RLS over *live* permission data.** Permissions
  live in **tables** (`roles`, `role_permissions`, `user_roles`, `sensitivity_clearances` w/
  entity-type scope, `restricted_grants`), edited from the dashboard with **no migration**. RLS
  policies are authored once, **generic** (never name a role), and look up the user's *current*
  permissions **live** each query via `STABLE SECURITY DEFINER` helpers keyed on `auth.uid()`.
- **Every change is instant** — grant *and* revoke — because nothing is cached on the token. This
  deleted the original "propagation latency" fork entirely (no JWT snapshot → no staleness window →
  no split grant-lazy/revoke-forced rule, no forced-logout machinery).
- **Division of labor:** RLS owns the visibility/sensitivity/Restricted **row-access** subset (DB
  backstop); the **harness** owns the full permission matrix in code. Both read the same tables →
  can't drift.
- **Two ADR-001 reconciliations baked in** (so nothing re-reads stale doc text): RLS is
  **intra-client only** — the doc's `client_slug` clause (`L724`) is **deleted**, cross-client
  isolation is physical; and RLS guards the **user-session** path only — the Memory Agent (sole
  writer, ADR-004) + backend run as the **service role**, which **bypasses RLS** (governed by harness
  RBAC). No requirement may assume RLS guards an agent write.
- **Rejected:** D1 one-policy-per-role (migration per edit, breaks `L471`/`L639`); D2 JWT-cached
  permission claims (faster reads but imports a staleness/propagation problem not worth it at ≤20
  users — kept only as the documented fallback, OOS-012).

**Captured as MUST-TEST:** new feasibility block **G** —
- **AF-067 (SPIKE+LOAD)** — live data-driven RLS performs on the **hot retrieval path** (the `STABLE`
  helper lookup, once per statement over tiny indexed tables, composing with pgvector ranking of a
  large memory batch). The whole D3 choice rests on this; D2 JWT-cache is the fallback if it fails.

**Files changed:** `adr/ADR-006-rls-dynamic-roles.md` (new, Accepted); `open-decisions.md`
(OD-006 → 🟢); `adr/README.md` (ADR-006 Accepted); `feasibility-register.md` (new block G AF-067;
next AF-068); `out-of-scope.md` (OOS-012 JWT-cached claims deferred; next OOS-013); `glossary.md`
(+Data-driven RLS, +Permission tables, +Restricted grant, +Entity-type-scoped clearance,
+Service-role bypass); `README.md` (ADR status line).

**Still owed (deferred to where context is richest, not now):** the new binding standard
`standards/rbac.md` (two-level RBAC + RLS model, default-deny, RLS-vs-harness division, service-role
caveat, `PERMISSION_NODES.md` convention) — write it when component 7 (RBAC/Guardrails) or the data
model is specced, per the ADR's Consequences. ADR-006 is the source of truth meanwhile.

**Next step:** **ADR-007 (prompt-injection posture)** — draft→approve (OD-007). The last load-bearing
ADR. Decide how much to lean on code-level hard limits vs regex/embedding detection (the doc calls the
latter "partly theater" + false-positive-quarantine risk); affects the Guardrails component. Note the
ADR-003 hard-limit precedent ("controls before gates") and `L2066` ("no user role, no agent
instruction, no config change can override a hard limit") as the lock-points. Then priority spikes
(AF-001 cost, AF-002 retrieval, AF-004 provisioning), then Phase 1 (component 0 Login).

---

## Session 9 — 2026-06-23 — Quality bar + failure overlay + honest "is it great?" audit

User pushed: the happy-path map looked too simple and lacked the finer detail separating a good vs
great harness, and asked whether the "great" stuff is actually in our system — capture it if not.

**Created:**
- `what-makes-it-great.md` — the great-vs-good quality bar across 12 dimensions, **plus an honest
  coverage audit** (where each lives in the design doc / ADRs + status: designed / ADR-hardened /
  paper-pending-test / gap). Headline: most great dimensions ARE designed in or ADR-hardened; the
  rest is "great on paper, must be tested" (AF register). Becomes a Phase-1 gate.
- `system-map/failure-overlay.md` — the shadow map: per step, what goes wrong + the mechanism that
  catches it (with cites). This is where the real depth/complexity lives.
- Rendered both as live visuals.

**Gaps surfaced & tracked:** **OD-010** (compensation/rollback of partially-completed task chains —
no undo story for external side effects when a chain halts; the one genuinely new gap from the
audit). OD-009 (backup/DR) reaffirmed. Everything else either designed, ADR-hardened, or in the AF
register as paper-pending-test.

**Wired:** README repo map; phase-playbooks Phase 1 step 8a (quality-bar + failure-overlay check
per component). 

**Answer to "is the great stuff in our system?":** mostly yes (dimensions 1–10 designed/hardened);
2 real gaps now tracked (OD-009, OD-010); the residual risk is paper-pending-test items, all logged.

**Next step:** unchanged — **ADR-006 (dynamic roles vs static RLS)**, draft→approve; then ADR-007;
then spikes; then Phase 1.

---

## Session 8 — 2026-06-23 — System map + per-component zoom-ins + grounding mode

User hit real anxiety: couldn't picture the system end-to-end ("blank in my head"), feared he
couldn't explain it / that the build won't match the vision stuck in his head. **Root cause = a
missing top-down VIEW** (we'd only ever built bottom-up: decisions/ADRs/requirements). Fix = make
the system visible, and build support for the user into the repo.

**Created:**
- `system-map.md` — top-down end-to-end route (8-stage "drive"), the continuous layer
  (loops/observability/proactive), the infra/compliance foundation, component legend C0–C10, and
  the **simulation technique** (walk a scenario down the map → each gap becomes an OD/requirement)
  with a worked GHL-lead example.
- `system-map/` — per-component zoom-in folder + index (all 11). **Build policy:** each zoom-in is
  built when we spec that component in Phase 1, so maps never drift from requirements. `02-memory.md`
  built now as the **exemplar** (reflects ADR-002/003/004). Out-of-order builds allowed if a
  component is causing anxiety.
- `working-with-me.md` — **grounding mode**: recognise the pattern (anxiety = missing-view signal,
  not a defect), do/don't list, and a 7-step "ground me" protocol.

**Wired:** CLAUDE.md now opens with a priority **grounding-mode** section + map pointers; README
repo map updated. Rendered the e2e map and the Memory zoom-in as live visuals in chat.

**Next step:** unchanged — **ADR-006 (dynamic roles vs static RLS)**, draft→approve; then ADR-007;
then priority spikes; then Phase 1 (component 0 Login as golden exemplar). When we spec each
component, build its `system-map/` zoom-in alongside it.

---

## Session 7 — 2026-06-23 — ADR-005 ACCEPTED (deploy fan-out & provisioning)

Second **draft→approve** ADR. Closes OD-005 — deploy fan-out, per-client provisioning, and version
skew, all asserted-not-designed in the doc. User chose the two forks in plain-language terms after I
explained them; then flagged a real gap (a brand-new business has no data to test a canary on), which
became a third decision axis.

**Decided (7 binding parts):**
- **Fan-out is already solved by ADR-001 §6** — no custom CI; each Railway project natively tracks the
  shared repo. `client_registry` is the observability map, not the deploy driver. Also re-stated
  ADR-001 §7 (push, not pull) for version/health reporting.
- **Blast radius = canary + release-train** (chose A3 over instant-global / per-deployment-manual):
  feature → `release` (canary tracks) → promote (fast-forward) → `main` (fleet auto-deploys). Promotion
  gated on tests + clean migration + green smoke battery + soak. Per-deployment migration-failure
  isolation retained (`L1141-1160`).
- **Version skew is normal + bounded, not an error** — made safe by **expand-contract migrations**
  (new binding standard `standards/migration-discipline.md`); rollback = code-redeploy + roll-forward,
  **never destructive down-migration**; `deploy_max_version_skew`/`deploy_max_skew_days` alert catches
  laggards.
- **Provisioning = scripted CLI + runbook** (chose B3 over full-IaC / pure-manual), **two-party** per
  ADR-001 hybrid: client creates cost-bearing accounts + card + delegated access (runbook); operator
  script does Railway link + env/`DEPLOYMENT_CONFIG` + `internal_token` mint/dual-store + `client_registry`
  insert + first-deploy→seed. **Operator-side registration** (no self-registration → no token chicken-and-egg).
- **OAuth apps per-client in the client's own accounts** (ADR-001 §5), redirect URIs → that deployment's
  Railway domain. ⚠️ Google **production verification** (AF-013) is a real onboarding **schedule dependency**.
- **Canary test method** (user's gap): **seeded synthetic client + deterministic smoke battery** now
  (catches boot/migration/connector + behavioral checks; shares the AF-001/AF-002 corpus), maturing into
  **operator dogfooding** its own deployment. Honest limit flagged: catches only what fixtures cover.
- **Plugins stay out of the release train** (per-deployment, manual; version-visibility only).

**Captured as MUST-TEST:** new feasibility block **F** —
- **AF-064 (DOCS+SPIKE)** — Railway supports the branch-based canary/promotion + build-history rollback model.
- **AF-065 (SPIKE)** — expand-contract keeps a mixed-version fleet safe (the skew + rollback premise). *Parts 3+4 rest on this.*
- **AF-066 (EVAL)** — the synthetic canary corpus is representative enough to catch behavioral regressions.
- Sharpened **AF-004** (full provisioning path) and **AF-020** (Railway auto-deploy + migrate-on-release).

**Files changed:** `adr/ADR-005-deploy-provisioning.md` (new, Accepted); `open-decisions.md` (OD-005 → 🟢);
`adr/README.md` (ADR-005 Accepted); `feasibility-register.md` (new block F AF-064–066; AF-004/020 sharpened;
next AF-067); `glossary.md` (+Canary deployment, +Release train/promotion, +Version skew, +Expand-contract
migration, +Provisioning script vs runbook, +Synthetic canary corpus/smoke battery); `out-of-scope.md`
(OOS-010 automated plugin distribution, OOS-011 full-IaC; next OOS-012); `standards/migration-discipline.md`
(new, Binding); `README.md` (ADR status line, repo map standards).

**Next step:** **ADR-006 (dynamic roles vs static RLS)** — draft→approve (OD-006). Roles are editable at
runtime but RLS is authored at migration time; ADR-001 made RLS **intra-client only** (role/visibility/
sensitivity, never client separation) — lock against that. Then ADR-007 (injection posture, OD-007), then
priority spikes (AF-001 cost, AF-002 retrieval, AF-004 provisioning), then Phase 1 (component 0 Login).

---

## Session 6 — 2026-06-23 — ADR-004 ACCEPTED (memory-write concurrency)

First **draft→approve** ADR (not a grill). Closes OD-004 — the contradiction-check-then-write
TOCTOU race under `parallel_execution`/fan-out.

**Decided:** **Per-entity serialization + optimistic validate-and-commit.**
- Serialize only **same-entity** writes (disjoint writes stay parallel → fan-out preserved). A
  contradiction is always same-entity, so that's the only race that matters.
- **Core insight:** can't hold a DB lock across the multi-second Sonnet writer (pool exhaustion +
  ADR-003 waste). So LLM work runs **unlocked**; then a **short** transaction under **sorted
  per-entity Postgres advisory locks** (`pg_advisory_xact_lock`, sorted = deadlock-free) re-checks
  a per-entity watermark `max(updated_at)` — unchanged → commit; changed → re-run only the cheap
  **DB** contradiction check (no LLM) and commit/re-target/bounce. Locks held ~ms.
- Three supports: **Memory Agent = sole writer** (invariant, locks design `L3435`); **unique
  idempotency constraint** `hash(source_ref, sorted entity_ids, content_hash)` kills retry
  double-writes; **CAS supersede** (`WHERE superseded_by IS NULL`) kills lost supersession.
- Daily supersede / weekly merge **demoted** from correctness to hygiene. `memory_writes_per_minute:30`
  makes serialization effectively free.
- **Rejected:** A do-nothing/daily-job (wrong for hours), B global-serialize (kills fan-out),
  C pessimistic-lock-across-LLM (wrong granularity + hold time), D optimistic-only (misses the
  duplicate-insert case — folded in as a support instead).
- **User-flagged knob (left as-is):** on a detected race the re-check re-runs the **DB** check, not
  a full Sonnet re-decision — deliberate "good enough" to avoid LLM livelock. User approved.

**Captured as MUST-TEST (user explicitly asked):** new feasibility block **E** —
- **AF-061 (SPIKE+EVAL)** — the validate-and-commit actually closes the window, no livelock. *The
  whole correctness claim rests on this.*
- **AF-062 (LOAD)** — advisory locks + short txns don't bottleneck at scale; multi-entity locks
  deadlock-free.
- **AF-063 (DOCS+SPIKE)** — Inngest per-key concurrency behaves as assumed; degrades safely to
  advisory-lock-only.

**Files changed:** `adr/ADR-004-concurrency-model.md` (new, Accepted); `open-decisions.md`
(OD-004 → 🟢); `adr/README.md` (ADR-004 Accepted); `feasibility-register.md` (new block E
AF-061–063; next AF-064); `glossary.md` (+TOCTOU race, +Per-entity serialization, +Advisory lock,
+Optimistic validate-and-commit, +Idempotency key); `README.md` (ADR status line).

**Next step:** **ADR-005 (deploy fan-out & provisioning automation)** — draft→approve (OD-005).
Push-deploy to N Railway projects + per-client Supabase/OAuth provisioning + version skew across
clients. Builds on ADR-001 (hybrid ownership). Priority spike AF-004 (provisioning) is its
companion. Remaining draft-approve ADRs after that: ADR-006 (RLS/dynamic roles, OD-006),
ADR-007 (injection posture, OD-007). Then priority spikes, then Phase 1 (component 0 Login).

---

## Session 5 — 2026-06-22 — Process fully externalized (full-optics docs)

User wanted the entire operating model written down now (not just-in-time), with full optics —
what/want/goal/why/how — so any future chat inherits the complete picture and never has to
*invent* methodology (only *follow* it).

**Created:**
- `spec/00-foundations/process-overview.md` — the optics bible: WHAT we're doing, WHAT the user
  wants, the GOAL (Point B / DoD), WHY (first principles), HOW (the machine), ID system,
  artifacts map, who-decides-what, current-state pointer.
- `spec/00-foundations/phase-playbooks.md` — repeatable procedure for all 6 phases. Phase 0 + 1
  at full mechanical detail (Phase 1 is the engine: 10-step per-component loop incl. parking
  cross-phase CFG/UI/DATA/PERM stubs, verification gate, sign-off). Phases 2–6 at goal+approach+
  done-when altitude, each finalized right before entry (living docs, change-controlled).

**Wired:** CLAUDE.md start-of-session reading list now includes both, + the **self-sufficiency
test** (repo alone must suffice, zero conversation). README repo map updated.

**Principle locked:** *author methodology where context is richest (now); future chats execute,
never invent.* The repo-self-sufficiency test is the guard against drift across chats.

**Next step:** unchanged — **ADR-004 (concurrency model for memory writes)**, draft→approve.
Then ADR-005/006/007, priority spikes (esp. AF-001 cost, AF-002 retrieval), then Phase 1
(component 0 Login as the golden exemplar).

---

## Session 4 — 2026-06-22 — Process hardening (5 additions) + retrofit pass

(Side chat, after ADR-003 committed `411364a`. This chat became the writer; working tree was
clean/synced first.) Added five process improvements the user requested:

1. **Backup & disaster recovery** — logged **OD-009** (whose job + strategy; ADR-001's
   client-owned Supabase makes backup ownership/verification ambiguous) and added it to Phase 5
   scope in README. Net-new gap, not a retrofit.
2. **out-of-scope.md created** (OOS-001..009) — seeded by **retrofitting deferrals already made**
   in ADR-001/002/003: region v2, confidence-weighted slot-fill v2, re-rank/HyDE off-by-default,
   self-host Inngest, full Model-A (client compute) exception-only, Pooled fallback, weekly cost
   auto-throttle out, HR ingestion off, cost reconcile deferred.
3. **Build-order / dependency map** — added to Phase 6 (README).
4. **Change-control standard** (`standards/change-control.md`) — Accepted ADRs immutable
   (supersede via new ADR); Ready/Approved FRs change via a new OD. Wired into CLAUDE.md +
   requirement-template.
5. **Component sign-off** — added `Approved` to the FR status lifecycle (requirement-template),
   the end-of-session ritual (CLAUDE.md), and the Definition of Done (README).

**Retrofit check — result: nothing needs reopening.** ADRs 001–003 stand as-is; they were
signed off via grilling, so the new `Approved` status applies to Phase-1 component FRs going
forward, not retroactively. The only retrofit was capturing their already-made deferrals into
out-of-scope.md (#2 above). Accepted ADRs are now under change-control from here on.

**Files changed:** `out-of-scope.md` (new), `standards/change-control.md` (new),
`open-decisions.md` (OD-009; next = OD-010), `requirement-template.md` (Approved status +
rules 7–8), `CLAUDE.md` (change-control + sign-off ritual), `README.md` (repo map, Phase 5
backup/DR, Phase 6 build-order, DoD).

**Next step:** unchanged — **ADR-004 (concurrency model for memory writes)**, draft→approve.
Lock against the ADR-003 write-path (code filter → Haiku gate → Haiku pre-check → Sonnet writer)
and the `memory_writes_per_minute:30` cap (per Session 3 note).

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
