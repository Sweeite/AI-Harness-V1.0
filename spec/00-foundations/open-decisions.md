# Open Decisions Log

Every ambiguity, gap, or fork is tracked here. An FR cannot be `Ready` while an OD pointing
at it is unresolved. Each OD: the question, why it matters, options, recommendation, and —
once you decide — the resolution + which FRs/ADRs it unblocks.

**Status key:** 🔴 open · 🟡 recommendation pending your call · 🟢 resolved

The 7 seeds below are the load-bearing architectural gaps found during design review. They
are promoted into ADRs in Phase 0. Hundreds more, smaller ODs will be logged per component.

---

## OD-001 — Isolation model: isolated-per-client vs multi-tenant-shared 🟢 RESOLVED → ADR-001
**Resolution (2026-06-22):** Silo (one isolated Supabase per client) with hybrid account
ownership — client owns Supabase + API keys + connector SaaS on their card; operator owns
Railway compute (codebase stays out of client accounts). `client_slug` deleted from all app
tables; client identity lives only in the management plane's `client_registry`. Super Admin
= push-based operational-metadata snapshots; no client business data crosses the boundary.
See ADR-001 for full detail and downstream consequences.

## OD-002 — Definition of "memory coverage %" 🟢 RESOLVED → ADR-002
**Resolution (2026-06-22):** "Coverage %" retired and split into two metrics over one slot
substrate. **Maturity** (`filled slots / expected slots`, binary at v1, stored, daily + on-write)
drives cold-start gating (20/50/80) and onboarding. **Retrieval Sufficiency** (query-time, thin
threshold over existing retrieval signals) drives the `[Building]` flag. Denominator = 5–8
operator-editable expected knowledge slots per entity type. Deployment cold-start *mode* is
one-time (off permanently at 80%); the `[Building]` flag recurs per-entity for new/thin entities.
Confidence-weighted slot-fill deferred to v2. ⚠️ AF-034 validates the metric in the AF-002 spike.
See ADR-002.

## OD-003 — Cost model & economic viability 🟢 RESOLVED → ADR-003
**Resolution (2026-06-22):** Reframed by ADR-001 — opex is client-borne, operator marginal cost
≈ $0, so "viability" is **client-side**: keep a deployment's bill low enough that the retainer is
worth paying, and stop a runaway from burning unbounded client money. Decisions: (1) cost tracking
is **estimate-grade** (token counts × an operator-editable price table, all vendors incl. OpenAI
embeddings, fail-safe rounded **up**) — never the vendor invoice (boundary forbids it). (2) Breach =
a **tiered ladder** (soft alert $50/day + $200/week → throttle non-critical at $75 → hard kill at
$100), per-deployment tunable, modelled on the rate-limit ladder. (3) Memory write = **≤1 Sonnet
call** (writer) + Haiku pre-checks; OD-003's "3 Sonnet calls" corrected. (4) Loops **short-circuit
in code** before the Sonnet orchestrator. (5) Principle **"controls before gates"** — structural/code
limits first, one self-funding Haiku gate (selective-writing) only; re-rank/HyDE not mandated.
(6) Viability target ≤ ~$20/day typical, **validated by AF-001** (also AF-040/041/042/043). See ADR-003.

## OD-004 — Concurrency model for memory writes 🟢 RESOLVED → ADR-004
**Resolution (2026-06-23):** The contradiction-check-then-write TOCTOU is closed by **per-entity
serialization + optimistic validate-and-commit**. Only **same-entity** writes serialize (disjoint
writes stay parallel, preserving fan-out); the slow Sonnet writer runs **unlocked**, then a short
transaction under **sorted per-entity Postgres advisory locks** re-checks a per-entity watermark
and commits — locks held for milliseconds, never across an LLM call. Backed by three supports: the
**Memory Agent is the sole writer** (invariant, locks `L3435`), a **unique idempotency constraint**
(kills retry double-writes), and a **CAS supersede** (`WHERE superseded_by IS NULL`, kills lost
supersession). Daily/weekly jobs demoted to hygiene. `memory_writes_per_minute:30` makes
serialization effectively free. **Must be tested** before/while building — ⚠️ AF-061 (the
validate-and-commit actually closes the window, no livelock), AF-062 (locks don't bottleneck at
scale, deadlock-free), AF-063 (Inngest per-key concurrency behaves as assumed). See ADR-004.

## OD-005 — Deploy fan-out & provisioning automation 🟢 RESOLVED → ADR-005
**Resolution (2026-06-23):** Three gaps closed. (1) **Fan-out** — there is no custom CI fan-out;
ADR-001 §6 already made each client's Railway project natively track the shared repo, so fan-out is
N independent subscriptions, not an orchestrator. Blast radius is bounded by a **canary +
release-train**: a canary deployment tracks a `release` branch ahead of `main`, must pass a
smoke-test battery + soak, then promotion fast-forwards `main` and the fleet auto-deploys.
(2) **Provisioning** — a **two-party** process: client creates the cost-bearing accounts (Supabase
+ keys + connectors) on their card and grants delegated access; the operator runs a **provisioning
script** (Railway link, env + `DEPLOYMENT_CONFIG`, `internal_token`, `client_registry` row,
first-deploy → seed) plus a **runbook** for consent-gated steps (incl. per-client OAuth apps in the
client's own accounts, with Google production verification as a schedule dependency). Registration
is operator-side (no self-registration). (3) **Version skew** is a normal, bounded condition made
safe by **expand-contract migrations**; rollback = code-redeploy + roll-forward (never destructive
down-migration); a max-skew alert catches laggards. The canary is a **seeded synthetic client +
smoke battery** now, maturing into **operator dogfooding**. **Must be tested** — ⚠️ AF-004
(provisioning wires up), AF-020 (Railway auto-deploy + migrate-on-release), AF-064 (Railway supports
the canary/promotion branch model), AF-065 (expand-contract keeps a mixed-version fleet safe),
AF-066 (synthetic canary corpus is representative enough). See ADR-005.

## OD-006 — Dynamic roles vs static RLS 🟢 RESOLVED → ADR-006
**Resolution (2026-06-23):** False fork — the model keeps **both** via **static, data-driven RLS
policies over live permission data**. Permissions live in **tables** (`roles`, `role_permissions`,
`user_roles`, `sensitivity_clearances` with entity-type scope, `restricted_grants`), edited from the
dashboard with **no migration**. RLS policies are authored once, are **generic** (never name a role),
and look up the acting user's *current* permissions **live** each query via `STABLE SECURITY DEFINER`
helper functions keyed on `auth.uid()` — so editing a role is just a row write and **every change,
grant or revoke, is instant** (no JWT snapshot, no staleness window, no propagation rule). Rejected:
one-policy-per-role (needs a migration per edit) and JWT-cached claims (imports a staleness problem we
don't need at ≤20 users; kept only as a documented future optimisation, OOS-012). Division of labor:
**RLS** owns the visibility/sensitivity/Restricted **row-access** subset as the DB backstop; the
**harness** owns the full permission matrix in code — both read the same tables. Two ADR-001
reconciliations baked in: RLS is **intra-client only** (the doc's `client_slug` clause is deleted —
cross-client isolation is physical), and RLS guards the **user-session** path only (the Memory Agent /
backend run as the **service role**, which bypasses RLS — governed by harness RBAC + ADR-004). **Must
be tested** — ⚠️ AF-067 (live data-driven RLS performs on the hot retrieval path; D2 JWT-cache is the
fallback if not). See ADR-006.

## OD-007 — Prompt-injection posture 🟢 RESOLVED → ADR-007
**Resolution (2026-06-23):** **Containment-first.** A successful prompt injection is made
**harmless by capability limits in code** — not reliably **caught** by detection. The security
boundary is the controls that ignore prompt content entirely: hard limits (`L2053`/`L2066`),
default-deny RBAC + RLS (ADR-006), approval gates, rate limits, physical isolation (ADR-001),
sole-writer memory (ADR-004). Detection is **demoted to a signal**: keep the cheap deterministic
layers always on (boundary tagging, regex tripwires, webhook HMAC auth) for logging/alerting; ship
the **embedding-similarity scan off by default** (`injection_semantic_detection`, the operator
on/off switch) — observability-only when on, never an autonomous gate. Fail-safe = **retain + route
to human**: flagged content is held, never machine-discarded (discard is a human-only logged
decision — protects non-negotiable #1); every event is logged loudly (#3). The injection thresholds
(0.85/0.95) are signal-tuning knobs, **not** safety dials. **Must be tested** — ⚠️ AF-068 (the
containment boundary holds end-to-end: no authorized-but-dangerous autonomous action path; red-team
with live payloads). See ADR-007.

---

## OD-008 — Answer-mode pill count: three vs four 🟢 RESOLVED → ADR-002
**Resolution (2026-06-22):** Three pills, no exception — Cited / Inferred / Unknown.
`[Building]` is a **flag** overlaid on a thin/`[Unknown]` response (driven by low Retrieval
Sufficiency + per-entity Maturity below proactive threshold), **not** a fourth pill. Settled as
a consequence of ADR-002.

## OD-009 — Backup & disaster recovery (whose job, what strategy) 🟢 RESOLVED → ADR-008
**Resolution (2026-06-23):** Defense-in-depth per silo. Primary-source vendor research reframed the
risk: the biggest loss path is **the client's credit card, not a crash** — a billing lapse pauses the
client-owned project after ~7 days, leaves it restorable for 90, then **permanently deletes the project
*and all its in-project backups* (daily and PITR) together**. So invariant #1 needs a copy that lives
*outside* the project lifecycle. The **golden rule** (`L1634`) shrinks the problem: the brain stores only
pointers + enrichment over systems of record that survive any incident, so recent loss is re-derivable by
re-ingestion → an ~1-hour RPO is acceptable. Six binding parts: (1) **default = free daily in-project
backups + an hourly off-platform snapshot** (~1-hour RPO, near-zero cost, AF-072-bounded); **PITR is an
opt-in upsell** (off by default, ~$100+/mo on the client's card, for minute-level RPO / brains too big for
hourly dumps); running below hourly is a logged exception; (2) an **independent off-platform `pg_dump`**
(the thing run hourly) to a **client-owned** second location in a different region, independent of the
primary project — the only defense against the deletion path, and client-owned so the operator never holds
business data (preserves the ADR-001 boundary; operator-held copy is a logged per-client exception only);
(3) **ownership split** — client owns + pays, **operator operates + verifies**; (4) a **tested restore
rehearsal** to a throwaway project (Supabase verifies nothing; we do) — ⚠️ AF-069; (5) **backup-health
joins the management-plane push** (operational metadata only: recovery tier, last-backup time, **project
status incl. pause/billing-at-risk**, off-platform-snapshot + rehearsal results) read via the Supabase
Management API (⚠️ AF-070), with a **loud Super Admin alert** if any lapse — so a client's failing backups
are *seen* before the deletion window (protects #1 + #3); (6) **golden rule governs scope** — source files
live in their system of record, referenced not copied; **Storage buckets out of scope** (OOS-013 — v1
Storage holds only regenerable offboarding exports). DR is backup-restore-with-downtime, not hot failover
(Enterprise-only; OOS-014). **Must be tested** — ⚠️ AF-069 (restore actually works), AF-070 (Management API
exposes the health fields), AF-071 (backup region / AU residency — unconfirmed in primary docs), AF-072
(**hourly** off-platform dump completes in-window at scale — gates the default cadence). See ADR-008.

## OD-010 — Compensation / rollback for partially-completed task chains 🟢 RESOLVED (2026-06-26, C6 session 23)
**✅ Resolution (2026-06-26, C6 Guardrails — operator delegated):** a refinement of option **(a) + (c)**, NOT
saga-style auto-compensation. The exposure is **narrowed by three already-locked controls**: prefer-reversible +
approval gates make irreversible external side effects rare and human-gated (FR-6.APR.002, C5 OD-056); C5
quarantine **retains work-in-progress** (AC-5.ASM.005.1); idempotent resume makes re-run safe (C5 FR-5.GRP.003).
The residual — a chain that applied a *reversible* external write at step N then halts at N+k — is handled by:
on halt, C6 **records the already-applied side effects on the flagged task and queues an explicit, human-visible
compensation/cleanup task** (option (c)), durably (C5 AC-5.ASM.009.2). **No automatic rollback of an external
side effect** — auto-compensation is itself an autonomous external action (#2), so it is rejected (option (b)
rejected). An *irreversible* applied effect is surfaced as **non-compensable** with an explicit operator note
(no false "undo" impression). Homed in **FR-6.ESC.003 (+AC-6.ESC.003.2/.3)**. Promote to an ADR only if it
proves cross-cutting beyond C5/C6. *(Original entry retained below.)*

**Why it matters (surfaced by the "what makes it great" audit):** a task graph can act on the
outside world mid-chain (e.g. update the CRM at step 7) and then halt at a later step. The current
failure model is retry / skip / halt-escalate + idempotent re-run — but there is **no defined story
for undoing or compensating external side effects already applied** when a chain halts. For
external comms / records this is a real great-harness concern.
**Options:** (a) halt + human + idempotent resume only (current implicit) — simplest, leans on
"prefer reversible" + approval gates making partial side effects rare; (b) compensating actions
(saga-style) per reversible step; (c) explicit cleanup tasks queued on halt. Likely touches
components 5/6/8 (harness / guardrails / agent design).
**Recommendation:** draft→approve during the Harness/Guardrails component work in Phase 1; promote
to an ADR only if it proves cross-cutting. Not a Phase-0 blocker.

## OD-011 — Slack app registration class (Marketplace / internal-custom) for history ingest 🟢 RESOLVED
**Surfaced by:** AF-003 vendor-claims verification (finding F3), 2026-06-23.
**Why it matters:** As of **2025-05-29** Slack throttles `conversations.history` and
`conversations.replies` to **Tier 1 (1 call/min, `limit` max 15 objects)** for **non-Marketplace
apps** — about **15 messages/minute per token**. Any Slack channel-history ingest/backfill (a core
"business brain" source) is **non-viable** at that rate. **Exempt:** Slack-Marketplace-approved apps
**and internal custom apps** (these keep Tier 3, 50+/min × up to 1,000 objects). So the throttle is a
function of *how the Slack app is registered*, not of our code — and it directly gates ingest throughput.
**Options:**
- **(a) Internal custom app per client workspace** — each Silo's Slack integration is a custom app
  created inside the client's own workspace (fits the ADR-001 per-client / client-owned-account model
  and the ADR-005 per-client OAuth-app pattern). Exempt from the throttle; no Slack review. **Recommended.**
- **(b) One Slack-Marketplace-approved app** — a single distributed app, but requires passing Slack's
  Marketplace review (lead time + ongoing compliance) and conflicts with the per-client account model.
- **(c) Accept Tier 1 + design around it** — incremental/event-driven sync only (Events API push instead
  of history pull), no bulk backfill. Lossy for cold-start ingest of existing history.
**Recommendation:** **(a)** — aligns with ADR-001 (client owns the connector accounts) and ADR-005
(per-client OAuth apps live in the client's accounts); internal custom apps are the documented exempt
path. Confirm the exemption holds with an **EVAL against a live test workspace** (the AF-012 follow-up)
before locking. Resolve when we spec the Slack connector / ingestion component in Phase 1.

**✅ Resolution (2026-06-25, C3 research gate, session 19):** **(a) internal customer-built app, one per
client workspace.** Primary-source verified in `tool-integrations/slack.md` (Slack docs, two independent
reads): the 2025-05-29 non-Marketplace throttle **explicitly exempts internal customer-built apps**
(verbatim). Binding guardrails on the Slack connector FRs: **never** activate public distribution /
package as a distributed app (collapses throughput ~67× and voids the exemption → OOS-021);
Enterprise-Grid multi-workspace is a separate branch (**OD-039**); bot-token rotation OFF by default
(**OD-040**). The exemption is **DOCS-proven, not yet behaviour-proven** → locking this resolution and
marking the Slack history-ingest FRs `Ready` is **gated on AF-083 EVAL** on a live workspace.

---

## OD-012 — Session-lifetime model (the design's 7-day refresh-token TTL does not exist) 🟢 RESOLVED
**Resolution (2026-06-24):** (a) Native model — rotating refresh + an inactivity timeout (~7–14 d idle, approximating the design's 7-day intent) + an absolute cap. `auth.session_refresh_days` is **deleted** (maps to no native setting). Enforcement is **lazy** (evaluated at next refresh, not proactively) — the UI must not imply an idle session is already dead. Reuse-detection already revokes a compromised session. Unblocks FR-0.SESS.003/004.
**Surfaced by:** Supabase Auth research (Block J / SA3), 2026-06-24. Blocks **FR-0.SESS.003/004**.
**Why it matters:** the design (`L699`) sets `auth.session_refresh_days: 7`, but Supabase refresh
tokens **never expire** — they rotate single-use; session lifetime is instead bounded by optional
**inactivity-timeout** + **absolute time-box** (Pro+, no default, enforced **lazily** at next
refresh). So "how long is a session good for" has to be re-modelled. Touches non-negotiable #2 (a
never-expiring session is a standing risk if a token leaks).
**Options:** (a) **adopt the native model** — rotating refresh + an inactivity timeout (e.g. 7–14 d
idle) + an absolute cap, accepting lazy enforcement; (b) rotating-never-expiring with **no** bound
(simplest, weakest); (c) build a custom session-expiry layer (most work).
**Recommendation:** **(a)** — set an inactivity timeout that approximates the design's 7-day intent and
an absolute cap; document that enforcement is lazy (next-refresh), and that reuse-detection already
revokes a compromised session. Delete `auth.session_refresh_days` from the config registry.

## OD-013 — Mid-task continuation mechanism (no "server-side session" object exists) 🟢 RESOLVED
**Resolution (2026-06-24):** (b) Background work runs as **`service_role`** (bypasses RLS, no `auth.uid()`, governed by harness RBAC) — consistent with ADR-004 (Memory Agent = sole writer as service_role) and ADR-006 (backend work off the RLS path). The design's "server-side session continues" is read as "the task does not depend on the client session." Client re-auths on next dashboard interaction (FR-0.SESS.007). Unblocks FR-0.SESS.006.
**Surfaced by:** Block J / SA5, 2026-06-24. Blocks **FR-0.SESS.006**.
**Why it matters:** the design (`L704–710`) says a task "continues using the server-side session" after
the client JWT expires — but Supabase has no such object. The two real mechanisms have **different
security postures (#2)**.
**Options:** (a) `@supabase/ssr` **middleware refreshes** the user's JWT server-side (task keeps acting
*as the user*, RLS applies); (b) background work runs as **`service_role`** (bypasses RLS, no
`auth.uid()`, governed by harness RBAC).
**Recommendation:** **(b)** — it matches the architecture already locked: ADR-004 makes the Memory Agent
the **sole writer** as `service_role`, and ADR-006 routes backend/agent work **off** the RLS path. Read
the design's "server-side session continues" as "the task does not depend on the client session," which
(b) satisfies. The client re-auths on next dashboard interaction (FR-0.SESS.007).

## OD-014 — Invite / setup-link expiry: ≤24 h native vs custom invite-token layer 🟢 RESOLVED
**Resolution (2026-06-24):** (a) **≤24 h native** Supabase invite/OTP/recovery expiry — no custom invite-token layer (avoids owning bespoke security-sensitive auth code for a marginal convenience). `invite_link_ttl` and `seed_setup_link_ttl` both ≤24 h, accepting the global coupling. One-click **resend** (OD-020) is the pressure valve for expired invites. Confirm the global coupling on hosted Supabase via AF-074. **`DATA-invite_tokens` is dropped** (no custom layer). Unblocks FR-0.INV.002, FR-0.SEED.002.
**Surfaced by:** Block J / SA11–SA12 + AF-074, 2026-06-24. Blocks **FR-0.INV.002, FR-0.SEED.002**.
**Why it matters:** the design wants a **72 h** invite (`L653`) and a **24 h** seed link (`L683`). Supabase
caps OTP/invite/recovery expiry at **24 h (86400 s)**, as a **global** project setting (not per-link) —
so 72 h is impossible natively, and even 24 h stretches *all* magic/recovery links and trips the ≤1 h
advisor.
**Options:** (a) **re-spec invites to ≤24 h** and use the native setting (simplest, least attack surface;
loses the 72 h convenience); (b) build a **custom invite-token layer** (own table + token + expiry +
delivery) to keep 72 h and decouple from the global OTP slider (more code = more #2 surface).
**Recommendation:** **(a)** unless the client has a concrete reason 24 h is too short — a shorter-lived
invite is *more* secure, and a custom token layer is exactly the kind of bespoke auth path we'd rather
not own. If (a), set `invite_link_ttl` and `seed_setup_link_ttl` both ≤24 h and accept the global
coupling. Confirm the coupling on hosted Supabase (AF-074) before locking.

## OD-015 — HttpOnly cookie posture for the session 🟢 RESOLVED
**Resolution (2026-06-24):** (a) **Pursue HttpOnly** via `@supabase/ssr` cookie options (move session reads server-side), **gated by the AF-073 spike** (prove it doesn't break required client-side session access). (b) Non-HttpOnly default + XSS mitigation (strict CSP, short token TTL) is the **documented fallback** if the spike fails. localStorage is rejected outright either way. Unblocks FR-0.SESS.005.
**Surfaced by:** Block J / SA4 + AF-073, 2026-06-24. Blocks **FR-0.SESS.005**.
**Why it matters:** the design (`L700–701`) relies on **HttpOnly** cookies to prevent XSS token theft,
but `@supabase/ssr` does **not** set HttpOnly by default (docs call it *"not necessary"*; tokens are meant
to be client-readable). HttpOnly may break client-side `getSession`/`getClaims`.
**Options:** (a) **force HttpOnly** via `@supabase/ssr` cookie options and move all session reads
server-side (spike AF-073 to prove it doesn't break the app); (b) **accept the non-HttpOnly default** and
mitigate XSS by other means (strict CSP, input sanitisation, short token TTL).
**Recommendation:** **(a)** — the design's XSS-hardening intent is sound and aligns with #2; treat HttpOnly
as the target and AF-073 as the gating spike. Keep (b) as the documented fallback if the spike shows
HttpOnly breaks required client-side session access.

## OD-016 — 2FA enforcement scope: deployment-wide vs per-user override 🟢 RESOLVED
**Resolution (2026-06-24):** (a) **Deployment-wide `aal2` required, no exemptions** (honours "cannot be bypassed once enabled", L377). OAuth users satisfy the second factor at the **IdP** (Google/Microsoft MFA); the external-Super-Admin password accounts enroll app-level TOTP. Every path lands at `aal2`-equivalent. Complete RLS coverage proven by AF-076 (one unprotected table = a silent `aal1` bypass). Unblocks FR-0.AUTH.008 (and the FR-0.AUTH.006 OAuth case).
**Surfaced by:** design `L377` + Block J / SA9 + AF-076, 2026-06-24. Blocks **FR-0.AUTH.008** (and
FR-0.AUTH.006 OAuth-user case).
**Why it matters:** the design treats "2FA required across the deployment" as a config flag; it has to be
**built** (aal2 RLS + app gating). The open question is *scope*: is it all-or-nothing per deployment, or
can individual users be exempted/required? And do OAuth-login users (whose MFA is at the IdP) also need
app-level TOTP?
**Options:** (a) **deployment-wide required, no exemptions**, OAuth users covered by IdP MFA (simplest,
strongest); (b) deployment-wide default + per-user override (more flexible, more surface); (c) per-user
opt-in (weakest — rejected, conflicts with the "cannot bypass" intent `L377`).
**Recommendation:** **(a)** — deployment-wide `aal2` requirement; for OAuth users, require the IdP to
assert MFA (or enroll app TOTP if the IdP can't), so every path lands at an equivalent of `aal2`. Prove
complete RLS coverage (AF-076) — one unprotected table is a silent bypass.

## OD-017 — 2FA challenge UX + wrong-code handling 🟢 RESOLVED
**Resolution (2026-06-24):** (a) **Same-page challenge** (no redirect) + Supabase's native MFA-verify limit (15/hr) + an **app-layer soft-lock** after ~5 wrong codes (temporary lock, logged as a security event per #3). Pairs with the OD-018 password-path soft-lock. Unblocks FR-0.AUTH.007.
**Surfaced by:** design `L375–377` (unspecified), 2026-06-24. Blocks **FR-0.AUTH.007**.
**Why it matters:** the design says wrong codes block access but doesn't specify the challenge UX or what
happens on repeated wrong codes (Supabase MFA-verify is limited to 15/hr [SA16], but there's no per-account
lockout).
**Options:** (a) **same-page challenge** (no redirect) + rely on Supabase's 15/hr MFA limit + a short
app-layer soft-lock after N wrong codes; (b) redirect to a dedicated challenge page; (c) same-page, no
extra app-layer lock (rely only on the 15/hr limit).
**Recommendation:** **(a)** — same-page is the cleaner UX; add a modest app-layer soft-lock (e.g. lock the
challenge for a few minutes after 5 wrong codes) on top of the 15/hr platform limit, logged as a security
event (#3). Couple the lockout decision with OD-018.

## OD-018 — Login brute-force posture + OAuth/email-password coexistence 🟢 RESOLVED
**Resolution (2026-06-24, user-decided):** **OAuth-only for all client-tenant users.** Every user *in the client's business* logs in via OAuth (they are tenant members; FR-0.AUTH.004 tenant-pinning requires it). **Email+password+2FA exists solely for external (operator-side) Super Admins** — operator staff who administer/support the deployment but are **not** in the client's Google/MS tenant, so they cannot SSO. This resolves the `L369`-vs-`L373` tension: OAuth-only is the default (L369); the password "alternative" (L373) exists but is **narrowly scoped** to external admins, so no client user ever carries a dormant password. An **app-layer per-account soft-lock** (counter → temporary block + alert) defends the password path (Supabase has no native per-account lockout); platform controls (CAPTCHA + leaked-password protection + IP limits) also on. Lines up with the seed (OD-021): the bootstrap first Super Admin is a password+2FA external admin. Unblocks FR-0.AUTH.002, FR-0.AUTH.005 (re-scoped to external-admin-only), FR-0.AUTH.009.
**Surfaced by:** Block J / SA16 + AF-077, 2026-06-24; and the design `L369`-vs-`L373` tension. Blocks
**FR-0.AUTH.002, FR-0.AUTH.009**.
**Why it matters:** two coupled questions. (1) Supabase has **no per-account lockout**; do we build one?
(2) `L369` says an OAuth-enabled deployment allows no login "without a valid OAuth token," yet `L373`
offers email+password "as an alternative" — are both paths live at once, or is email+password a
break-glass path?
**Options (lockout):** (a) **platform controls only** — CAPTCHA + leaked-password protection + IP limits;
(b) **also build an app-layer per-account soft-lock** (counter → temp block + alert).
**Options (coexistence):** (i) both OAuth and email+password live in parallel (most flexible); (ii) when
OAuth is enabled, email+password is **break-glass only** for designated accounts (e.g. the Super Admin) —
tighter, honours `L369`.
**Recommendation:** **(b) + (ii)** — build a lightweight app-layer soft-lock for the password path (the
one brute-forceable surface) and treat email+password as a **break-glass** path when OAuth is enabled,
restricted to accounts that need it (Super Admin always retains it so an IdP outage can't lock everyone
out). This honours both design lines and #2.

## OD-019 — Support-request notification + phone handling + escalation 🟢 RESOLVED (largely dissolved by OD-018)
**Resolution (2026-06-24):** OD-018 (OAuth-only for client users) **removes the credential-reset problem this OD existed to solve** — an OAuth user has no credential the system holds, so there is nothing to phone-verify-and-reset; they recover at their IdP (Google/Microsoft), and access issues route to an admin checking tenant membership/role. Therefore: **retire the phone-verify-before-credential-change flow (FR-0.REC.004)** and the phone-at-invite capture (phone field dropped from `DATA-support_requests`). **Keep** the "Trouble signing in?" form as a **generic login-support intake** (email/name/issue → support request → visible to Super Admin/Admin → status-tracked), **notify Super Admin + Admin on submit** (so it isn't unseen, #3). **External Super Admin** (password) lockout recovers via the **bootstrap path** (OD-021: env-change seed re-run, or another operator Super Admin via Supabase admin tooling) — not this flow. Simplifies FR-0.REC.005/006; retires FR-0.REC.004.
**Surfaced by:** design `L385–387` (unspecified), 2026-06-24. Blocks **FR-0.REC.002, FR-0.REC.004,
FR-0.REC.006**.
**Why it matters:** the recovery flow is the one human-in-the-loop credential path (#2). The design omits:
who is alerted on submit, how the user's phone number is obtained (verification depends on it), whether the
verification call is logged, and what happens when the user can't be reached.
**Options:** (a) **notify all Super Admin + Admin** on submit (in-dashboard + email), capture phone at
**invite time** (stored on the user) with admin lookup fallback, **log the verification call** (who/when/
outcome) on the request, and define an **unreachable-user escalation** (e.g. second attempt + Super Admin
sign-off required); (b) minimal — dashboard queue only, no notifications, phone gathered ad hoc.
**Recommendation:** **(a)** — the credential-change gate is security-critical; make the notification,
phone provenance, and call logging explicit so the human verification is auditable (#2 + #3). Unreachable
user → no credential change; escalate to Super Admin.

## OD-020 — Invite lifecycle edge cases 🟢 RESOLVED
**Resolution (2026-06-24):** (a) **One login method at setup** (a second can be added later from account settings); **expired link → admin re-issues** (or user re-requests via the support form); **admin can revoke** an unused invite; all revoke/re-issue actions are `audit`-logged. Note: since client users are **OAuth-only** (OD-018), the "set up both methods" case is essentially moot — the password path applies only to external Super Admins. Unblocks FR-0.INV.004, FR-0.INV.006.
**Surfaced by:** design `L649–664` (unspecified), 2026-06-24. Blocks **FR-0.INV.004, FR-0.INV.006**.
**Why it matters:** the happy-path invite is specified, but not: may a user set up **both** OAuth and
email+password, or exactly one? expired link → re-request? admin revoke an outstanding invite?
**Options:** (a) **one method at setup, add a second later** from account settings; **expired link →
admin re-issues** (or user re-requests via the support form); **admin can revoke** an unused invite;
(b) both methods at setup; no revoke.
**Recommendation:** **(a)** — one method at setup keeps the flow simple; allow adding a second method later;
support expired-link re-issue and early revoke (both `audit`-logged). Resolve alongside OD-014 (the token
mechanism determines how revoke/re-issue work).

## OD-021 — Super Admin seed edge cases 🟢 RESOLVED
**Resolution (2026-06-24):** (a) **Seed = email+password+2FA only** — the bootstrap first Super Admin is an **external (operator-side) admin** (consistent with OD-018), so the seed never depends on the per-client IdP app being wired yet at first boot. **Bounce/expiry recovery = a deliberate env-change re-run** of the seed, guarded by the existence check (FR-0.SEED.003) so it can never mint a second admin. The Super Admin can connect OAuth later if they are also a tenant member. Unblocks FR-0.SEED.001, FR-0.SEED.002.
**Surfaced by:** design `L666–691` (unspecified), 2026-06-24. Blocks **FR-0.SEED.001, FR-0.SEED.002**.
**Why it matters:** first-boot seed: can the first admin use **OAuth** (the per-client IdP app may not be
configured yet at first boot)? what's the recovery if the **setup email bounces** or the link expires
before use (the seed is deliberately not UI-re-triggerable)?
**Options:** (a) **seed = email+password+2FA only** (OAuth needs the IdP app wired first, which may lag),
**bounce/expiry recovery = re-run the seed via a deliberate env change** (the documented non-UI re-trigger,
guarded by the existence check); (b) allow OAuth-first seed (requires the IdP app ready at provisioning).
**Recommendation:** **(a)** — keep the first admin on email+password+2FA so the seed never depends on the
IdP app being ready; document env-change re-run as the only recovery (consistent with FR-0.SEED.003). The
Super Admin can connect OAuth later.

## OD-022 — Webhook secret rotation, replay-beyond-timestamp, accept-rate limit 🟢 RESOLVED
**Resolution (2026-06-24):** (a) **Secrets rotated via the provisioning runbook** with a **dual-accept window** (both old and new secret accepted during rotation, so rotation is not an outage); **event-id replay cache** for GHL/Google (reject already-seen event IDs within a window — they lack Slack's timestamp defense); **per-source accept-rate limit** feeding the same alert as FR-0.WHK.005. The **auth-side** parts (rotation, replay reject, verification) stay in C0; ingest-side rate handling may live in C3. Unblocks FR-0.WHK.001–005.
**Surfaced by:** design `L740–815` (partially specified), 2026-06-24. Blocks **FR-0.WHK.001–005**.
**Why it matters:** the design covers the signature check but not: how webhook secrets are **rotated**
(GHL/Slack secrets in `credentials`), replay protection **beyond** Slack's 5-min timestamp (GHL/Google
have none specified), and whether to **rate-limit accepted** webhooks (a flood of *valid* events).
**Options:** (a) **secrets rotated via the provisioning runbook** (versioned in `credentials`, dual-accept
during rotation), **add a nonce/event-id replay cache** for GHL/Google (reject seen IDs within a window),
and a **per-source accept-rate limit**; (b) minimal — signature check only, no rotation procedure, no
extra replay defense.
**Recommendation:** **(a)** — define a rotation procedure (dual-accept window so rotation isn't an outage),
add event-id de-duplication for the connectors without native timestamps, and a per-source accept-rate
limit feeding the same alert as FR-0.WHK.005. Some of this may land in C3 ingest; the **auth-side** parts
(rotation, replay reject) stay in C0.

## OD-023 — Webhook failure-alert recipient + escalation 🟢 RESOLVED
**Resolution (2026-06-24):** (a) **Alert all Super Admin** (webhook-auth failures are logged as `prompt_injection` — a security signal per ADR-007); **identify the source** by connector + endpoint token + source IP; **auto-throttle the offending source** while alerting, so a forged-webhook flood can't hammer the endpoint (protects #2/#3). The throttle action may share machinery with the rate-limit ladder. Unblocks FR-0.WHK.005.
**Surfaced by:** design `L806–809`, 2026-06-24. Blocks **FR-0.WHK.005**.
**Why it matters:** the design fires a dashboard alert at >3 failures/source/hour but doesn't say **who**
is alerted, how the **source** is identified, or what **action** follows (the failures are logged as
`prompt_injection` — a security signal).
**Options:** (a) **alert all Super Admin** (security-relevant), identify the source by connector + endpoint
token + source IP, and **auto-throttle** that source endpoint while alerting; (b) log + dashboard badge
only, no active throttle.
**Recommendation:** **(a)** — treat repeated webhook-auth failures as a security event: Super Admin alert,
clear source identification, and an auto-throttle on the offending source so a forged-webhook flood can't
hammer the endpoint (protects #2/#3). The throttle action may share machinery with the rate-limit ladder.

---

## OD-024 — Audit store & schema for Personal/Restricted access + RBAC changes 🟢 RESOLVED
**Resolution (2026-06-24, delegated C0-style):** (a) **a dedicated append-only `access_audit` table** — immutable, distinct from `guardrail_log` (security events) and `event_log` (operational) — capturing subject/actor (user **or** agent identity)/tier/entity/path/time/outcome for access events, and actor/action/target/before-after/time/reason for RBAC-change events. **C1 owns the completeness + content requirement (across both the human and `service_role` paths); C7 / Phase 5 owns storage, retention, tamper-evidence, and export.** Unblocks FR-1.AUD.001/002/003, FR-1.RST.002.
**Surfaced by:** Component 1 (RBAC) drafting, 2026-06-24. Blocks **FR-1.AUD.001/002/003, FR-1.RST.002**.
**Why it matters:** the design mandates that "all Personal and Restricted memory access is fully
audited — every read, write, or injection produces a permanent audit record" (L456) and that every
Restricted grant logs who/when/why (L452), but it never names the store, the schema, or the
retention. There are already adjacent sinks — `guardrail_log` (security events) and `event_log`
(operational) — so the question is whether access-audit is a third dedicated table or rides one of
those. Getting this wrong risks either a silent gap (#1/#3) or audit data lost in a high-volume
operational log.
**Options:** (a) **a dedicated append-only `access_audit` table** (subject/actor/tier/entity/path/
time/outcome), immutable, distinct from `guardrail_log`/`event_log`; C7 owns retention/export;
(b) reuse `guardrail_log` with an access-audit event type; (c) reuse `event_log`.
**Recommendation:** **(a)** — Personal/Restricted access audit is compliance-grade and must be
immutable + queryable independently of operational noise; a dedicated table keeps it clean and lets
C7 set its own retention/tamper-evidence/export (L597). C1 fixes *what is captured + that it is
complete across both the human and agent paths*; C7 fixes *where it lives + how long + how it's
protected*.

## OD-025 — "Role removed if unused" criterion + which roles are protected 🟢 RESOLVED
**Resolution (2026-06-24, delegated):** (a) a role is **deletable iff zero users are assigned AND it is not protected**; deletion of a role with ≥1 assigned user is **blocked** with a reassign-first message naming the count. **Super Admin is always protected** (un-deletable). The other five defaults are **un-deletable while in use** but removable once empty (they are "defaults," not system roles — L471 "all are editable"). All deletes/blocked-deletes audited. Unblocks FR-1.ROLE.004.
**Surfaced by:** Component 1 drafting, 2026-06-24. Blocks **FR-1.ROLE.004**.
**Why it matters:** the design says roles "can be removed if unused" (L471) but never defines
"unused" or which roles (if any) are undeletable. A loose criterion risks orphaning users into a
no-role state (#1/#3); a missing protection risks deleting Super Admin.
**Options:** (a) **deletable iff zero assigned users AND not a protected role** (Super Admin always
protected), with deletion blocked + a reassign-first message otherwise; (b) allow deletion with
cascade-reassign to a default role; (c) soft-delete/disable instead of hard delete.
**Recommendation:** **(a)** — block deletion of any role with ≥1 assigned user (force explicit
reassignment first) and protect Super Admin outright. *Open sub-question for your call:* are the
other five defaults (Admin/Finance/HR/Account Manager/Standard User) also protected from deletion,
or merely un-deletable while in use? (Rec: un-deletable while in use, otherwise removable — they're
"defaults," not "system roles," per L471 "all are editable.")

## OD-026 — Denied-access runtime semantics for direct/API attempts 🟢 RESOLVED
**Resolution (2026-06-24, delegated):** (a) for an authenticated user, a denied direct/API attempt returns an **explicit 403-equivalent authorization error** + a **security-level log**; the surface is simply **absent** in the UI (L462). **Never a silent empty-200 / partial render / swallowed denial** (#3). The 404-to-avoid-enumeration variant is available per-endpoint only where enumeration is a concrete concern (not the default). Unblocks FR-1.PERM.006.
**Surfaced by:** Component 1 drafting, 2026-06-24. Blocks **FR-1.PERM.006**.
**Why it matters:** the design says denied dashboard views "do not exist in their UI" (L462) but is
silent on what a **direct** programmatic attempt returns. A silent empty-200 or an info-level
swallow would be a silent failure (#3); an over-informative error could enable endpoint enumeration.
**Options:** (a) **explicit 403-equivalent authorization error + security-level log**; (b) **404 to
avoid enumeration** + security log; (c) 403 for known users, 404 for unauthenticated.
**Recommendation:** **(a)** for authenticated users (clear, auditable), with the surface simply
absent in the UI; consider (b)/(c) only where endpoint enumeration is a real concern. Never a silent
empty success. Log every denied direct attempt at security level.

## OD-027 — Entity-type clearance-scope representation + the L438/L452 Restricted contradiction 🟢 RESOLVED
**Resolution (2026-06-24, delegated):** **Scope = (a)** an `entity_type_scope` column on `sensitivity_clearances` (`NULL` = global). **Contradiction = (i): L452 governs** — no role, including Super Admin, holds Restricted as a default clearance; L438's "Restricted" for Super Admin reads as the **authority to grant** Restricted (`PERM-user.grant_restricted`), with any actual Restricted access being a per-individual, logged, self-grant. This preserves the invariant that every Restricted access traces to a who/when/why grant. Unblocks FR-1.CLR.002/004, FR-1.RST.001, FR-1.USR.005.
**Surfaced by:** Component 1 drafting, 2026-06-24. Blocks **FR-1.CLR.002/004, FR-1.RST.001, FR-1.USR.005**.
**Why it matters:** two coupled gaps. (1) Clearance is "scoped by entity type" (L450) — Finance sees
Confidential *finance* memories, not Confidential *client-strategy* — but the representation isn't
specified. (2) **Contradiction:** L438 lists "Restricted" among Super Admin's role clearances, while
L452/L620 say Restricted is **per named individual, never per role**.
**Options (scope):** (a) an `entity_type_scope` column on `sensitivity_clearances` (null = global);
(b) a separate scope table. **Options (contradiction):** (i) **L452 governs** — no role, including
Super Admin, holds Restricted as a default; Super Admin holds the *authority to grant* it
(`PERM-user.grant_restricted`) and may self-grant per-entity with logging; (ii) treat Super Admin's
Restricted as a true global role clearance (contradicts L452/L620).
**Recommendation:** scope = **(a)**; contradiction = **(i)** — Restricted is always a per-individual,
logged grant; L438's "Restricted" for Super Admin = grant authority, not an automatic clearance.
This keeps the audit invariant (every Restricted access traceable to a who/when/why grant) intact.

## OD-028 — Un-actioned clearance-review handling 🟢 RESOLVED
**Resolution (2026-06-24, delegated):** (a) an overdue, un-actioned review is **flagged + escalated (Super Admin alert + dashboard badge)** — the access **persists** but is loudly surfaced until actioned. **Not auto-revoked** (avoids silently losing legitimate access, #1) and **not silently retained as if reviewed** (avoids silent staleness, #3). A client wanting fail-closed sets it as a **per-deployment config**, not the default. Unblocks FR-1.CLR.005.
**Surfaced by:** Component 1 drafting, 2026-06-24. Blocks **FR-1.CLR.005**.
**Why it matters:** clearances are "reviewed on a configurable cadence" with a Super Admin
confirm/revoke (L454), but the design doesn't say what happens when a review is **not actioned** in
time. Auto-revoking risks silently losing legitimate access (#1); silently keeping it risks stale
over-clearance (#3). This is a direct three-non-negotiables tension.
**Options:** (a) **flag + escalate (alert), neither auto-revoke nor silently retain** — the access
persists but is loudly surfaced as overdue until actioned; (b) auto-revoke on overdue (fail-closed);
(c) silently keep until actioned (fail-open).
**Recommendation:** **(a)** — escalate an overdue review (alert the Super Admin, badge it) so it
can't be silently ignored, but don't auto-revoke working access. If a client wants fail-closed, make
it a per-deployment config rather than the default.

## OD-029 — RBAC-change audit scope + single-vs-multi role per user + last-Super-Admin protection 🟢 RESOLVED
**Resolution (2026-06-24, delegated):** (a) **audit every RBAC mutation** (role edit, matrix toggle, clearance, Restricted grant, role assignment, deactivation, 2FA reset) with actor/target/before-after/time; a **reason is mandatory for Restricted** grants (L452) and captured-where-supplied elsewhere. **One role per user in v1** (matches the role→default-view routing, C0 FR-0.INV.005; a real multi-role need is revisited as a future OOS, not built now). **The last Super Admin is protected across all three removal paths** — deactivate, role-change, role-delete — guarded atomically (ADR-004). Unblocks FR-1.AUD.002, FR-1.USR.001, FR-1.ROLE.005.
**Surfaced by:** Component 1 drafting, 2026-06-24. Blocks **FR-1.AUD.002, FR-1.USR.001, FR-1.ROLE.005**.
**Why it matters:** three coupled model questions the design leaves implicit. (1) Only Restricted
grants have an explicit who/when/why (L452); is **every** RBAC mutation (role edit, matrix toggle,
clearance, role assignment, deactivation, 2FA reset) audited, and which require a mandatory reason?
(2) May a user hold **multiple roles** or exactly one? (3) Is the "one Super Admin minimum" (L474)
enforced across deactivate + role-change + role-delete?
**Options:** (a) **audit all RBAC mutations** (reason mandatory for Restricted, optional-but-captured
elsewhere) · **one role per user** in v1 (matches role-default-view routing, C0 FR-0.INV.005) ·
**protect the last Super Admin across all three removal paths** (atomic guard, ADR-004); (b) audit
only Restricted + clearances; multi-role users; protect only at deactivation.
**Recommendation:** **(a)** — full RBAC-mutation audit (the privilege-escalation surface must be
fully traceable, #2/#3); one role per user for v1 (simpler, matches routing; revisit if a real
multi-role need appears → OOS); last-Super-Admin protection on every removal path.

## OD-030 — Default permission-matrix seed mechanism 🟢 RESOLVED
**Resolution (2026-06-24, delegated):** (a) **seed the default role→node rows once at provisioning** from `PERMISSION_NODES.md` defaults, then treat operator edits as authoritative — later deploys **do not** overwrite edits; a newly-added node arrives **default-deny** until a Super Admin grants it (FR-1.PERM.002). Honours both "ships with sensible defaults" (L471) and "no code change to adjust" (L639). Unblocks FR-1.ROLE.001, FR-1.PERM.004.
**Surfaced by:** Component 1 drafting, 2026-06-24. Blocks **FR-1.ROLE.001, FR-1.PERM.004**.
**Why it matters:** the matrix is "tracked during the build, not finalised before it" (L504) and
becomes editable data with "no code change required" (L639) — so the six default roles' node
assignments must be **seeded** somewhere, then live as editable rows. The question is the seed
source and whether defaults re-assert on later deploys.
**Options:** (a) **seed default role→node rows at provisioning from `PERMISSION_NODES.md` defaults**,
then fully editable; later deploys **do not** overwrite operator edits (new nodes default-deny until
granted, FR-1.PERM.002); (b) defaults re-asserted every deploy (overwrites edits — rejected, breaks
runtime-editable promise); (c) no seed, Super Admin configures from scratch (poor first-run UX).
**Recommendation:** **(a)** — seed once at provisioning; treat operator edits as authoritative
thereafter; a newly-added node arrives default-deny and is granted explicitly. This honours both the
"ships with sensible defaults" (L471) and "no code change to adjust" (L639) promises.

---

## OD-031 — Mid-task authorization revocation on the service-role path 🟢 RESOLVED
**Surfaced by:** Component 1 verification gate (quality pass), 2026-06-24. Blocks **FR-1.RLS.007**.
**Why it matters:** ADR-006 part 6 runs background/agent work as `service_role`, which **bypasses RLS
and has no `auth.uid()`** — so the "every change is instant" guarantee (FR-1.RLS.006) covers only the
human path. If the originating user is **deactivated** or a relied-on **clearance is revoked** *while*
their task is mid-flight as `service_role`, nothing re-checks it: the task rides a stale snapshot to a
consequential side effect (external comm / financial / cross-entity write). This is a direct #2/#3
exposure on the one path the design deliberately leaves off RLS. It must be distinguished from a
**benign session-expiry**, which C0 FR-0.SESS.006 *intentionally* lets continue.
**Options:** (a) **re-check the originating user's active status + relied-on clearances at each
step/injection boundary; on deactivation/revocation, halt + quarantine the in-flight task for human
review** (never silently drop the work, #1), treating session-expiry as benign (continue); already-
applied side effects → compensation (OD-010); the interception/quarantine **mechanism** seamed to
C5/C6/C8; (b) finish the current step, then stop; (c) let the task run to completion (status quo —
rejected, #2).
**Recommendation / Resolution (2026-06-24, delegated C0-style):** **(a)** — the authorization rule is
fixed in C1 (FR-1.RLS.007): a service-role task binds its originating identity and may not perform a
further consequential side effect once that user is deactivated or a relied-on grant is revoked;
expiry ≠ revocation. The step-boundary + quarantine machinery is a Harness/Guardrails/Agent-Design
(C5/C6/C8) concern; compensation of already-applied effects is OD-010. Tied to **AF-068** (containment
red-team).

---

## OD-032 — Unresolved hard-conflict handling + the "inject both with a note" behaviour 🟢 RESOLVED
**Resolution (2026-06-25, delegated C0/C1-style):** (a) a hard conflict **holds the new memory in a pending/quarantine state** — not in the live retrievable set, not discarded — surfaces it in a conflict-review queue, and **escalates an un-actioned hard conflict** (alert + badge), never auto-resolving and never silently dropping it (mirrors C1 OD-028). For rule-5 genuine ambiguity, **both memories stay live and are injected with an explicit "conflicting memory" note** until a human resolves; resolution is tied to the conflict-review queue (bounding how long both persist). Unblocks FR-2.WRT.002, FR-2.MNT.008.
**Surfaced by:** Component 2 (Memory) drafting, 2026-06-25. Blocks **FR-2.WRT.002, FR-2.MNT.008**.
**Why it matters:** the contradiction check flags a **hard conflict** for human review and "never silently
overwrites" (L1615); the conflict-resolution rules say a genuinely ambiguous conflict is "flagged for human
and **inject both with a note**" (L1844). Two things are unspecified: (1) what happens to the **new memory**
while a hard conflict is unreviewed — is it held un-written, written-but-quarantined, or written-pending? and
what if the review **never happens** (the same un-actioned-review tension as C1 OD-028)? (2) how "inject both
with a note" actually renders and how long both versions persist. Getting (1) wrong risks either losing the
new knowledge (#1) or acting on a contradiction silently (#2/#3).
**Options:** (a) **hold the new memory in a pending/quarantine state** (not in the live retrievable set, not
discarded), surface it in a conflict-review queue, and **escalate** an un-actioned hard conflict (alert +
badge, never auto-resolve, never silently drop) — mirroring C1 OD-028; for rule-5 ambiguity, **inject both
with an explicit "conflicting memory" note** and keep both live until a human resolves; (b) write the new
memory live immediately and rely on the supersede safety-net + review (weaker — acts on unresolved conflict);
(c) drop the new memory until the conflict is resolved (rejected — loses knowledge, #1).
**Recommendation:** **(a)** — quarantine-pending + escalate-if-unreviewed is the only option consistent with
all three non-negotiables (don't lose it, don't act on it silently, don't fail silently). The rule-5
"inject both with a note" is the *retrieval-time* expression of an unresolved ambiguity; cap how long both
persist by tying resolution to the conflict-review queue. Reuses the C1 OD-028 escalate-don't-auto-act pattern.

## OD-033 — Entity resolution / disambiguation / merge mechanism 🟢 RESOLVED
**Resolution (2026-06-25, delegated):** (a) **deterministic precedence** — match by `external_refs` (system ID) first, then a normalised name+type match above a confidence threshold; **confident match → link**; **ambiguous/low-confidence → create-and-flag-for-merge or hold for human confirm, never silently guess**; duplicates are backstopped by the structural-erosion check (FR-2.MNT.010) feeding an entity-merge queue; entity-type retirement = **soft-disable** (hidden for new writes, existing memories retained, never orphaned). Auto-resolution accuracy is gated by **AF-082** (EVAL — false-merge / false-split rates) before it's trusted. Unblocks FR-2.ENT.005, FR-2.ENT.002, FR-2.RET.001.
**Surfaced by:** Component 2 drafting, 2026-06-25. Blocks **FR-2.ENT.005, FR-2.ENT.002, FR-2.RET.001**.
**Why it matters:** the design defines the entity model + schema (L1353–1394, L1429–1436) but never the
**resolution** mechanism — how a mention in a task or ingested item maps to an *existing* entity vs. creates a
new one. This is a direct #1 (knowledge-integrity) risk: if "Acme Corp" resolves to two different entity rows,
the brain **fragments** — every retrieval about Acme silently sees half its knowledge. Also unspecified: how an
in-use entity **type** is retired without orphaning its memories (FR-2.ENT.002 edge).
**Options:** (a) **deterministic precedence** — match by `external_refs` (system ID) first, then a normalised
name+type match above a confidence threshold; **confident match → link**; **ambiguous/low-confidence →
create-and-flag-for-merge** (or hold for human confirm), never silently guess; duplicates caught by the
structural-erosion check (FR-2.MNT.010) feed an entity-merge queue; entity-type retire = **soft-disable**
(hidden for new writes, existing memories retained); (b) name-only fuzzy match (simpler, higher fragmentation
risk); (c) always-human-confirm new entities (safest, heavy onboarding friction).
**Recommendation:** **(a)** — external-ref-first + deterministic name/type fallback + a flag-don't-guess rule on
ambiguity, with a merge queue as the backstop. Validate accuracy at scale via **AF-082** (EVAL) before trusting
auto-resolution. Soft-disable for entity-type retirement so #1 is preserved.

## OD-034 — Cold-storage mechanism + retrieval-back path 🟢 RESOLVED
**Resolution (2026-06-25, user-decided):** (c) **defer cold storage to v2 → OOS-016.** Cold storage is a scale optimisation that does not bite until the vector index is large; shipping it at launch (≤20 users) adds a lose-a-memory failure mode (#1) for no benefit, since HNSW stays fast well past launch volume (the reason it was chosen, AF-019). **FR-2.MNT.012 is marked v2-deferred** (no v1 build). When built, design toward option (a) — cold memories stay in-table + keyword-reachable + rehydratable, never fully unsearchable. AF-019 identifies the hot-index size that actually motivates it.
**Surfaced by:** Component 2 drafting, 2026-06-25. Blocks **FR-2.MNT.012**.
**Why it matters:** the design moves "memories >12 months old with low access frequency to cold storage to
keep the vector index fast and cheap" (L1897, L1962) but never says **what cold storage is** technically or how
a cold memory is **retrieved back** if it becomes relevant again. Done wrong this is a #1/#3 risk: a memory
that is silently unfindable when needed is effectively lost knowledge.
**Options:** (a) **flag + drop-from-HNSW, keep in the table** — a `cold` flag removes the row from the hot
vector index (kept in Postgres, still keyword-reachable); a cold hit (e.g. a keyword/entity match, or a
periodic relevance signal) **rehydrates** it back into the index; (b) **separate cold table/tier** (archived,
not searchable) with an explicit operator "restore" action only; (c) **defer cold storage entirely to v2**
(it's a `Could`-priority optimisation; the brain is small at ≤20 users / first 12 months, so the hot index
won't be large enough to need it soon).
**Recommendation:** **(c) for v1, design toward (a).** Cold storage is a scale optimisation that does not bite
until the index is large; shipping it early adds a lose-a-memory failure mode (#1) for little benefit at launch
volume. Log the v1 deferral (OOS) and, when built, prefer (a) — keep cold memories in-table + keyword-reachable
+ rehydratable, never fully unsearchable. Confirm the hot-index size that actually motivates it via AF-019.

## OD-035 — Vector-arm candidate-filter uniformity + system_pointer admission 🟢 RESOLVED
**Resolution (2026-06-25, delegated):** (a) the confidence-floor / expiry / superseded filters **apply uniformly to both the keyword and vector arms** before the clearance filter and ranking — a superseded, expired, or sub-threshold memory must never re-enter via semantic similarity (closes a stale-knowledge leak, #1/#2). An unscored `system_pointer` memory is **admitted unconditionally** (it dereferences to the live source of record). Unblocks FR-2.RET.003.
**Surfaced by:** Component 2 drafting, 2026-06-25. Blocks **FR-2.RET.003**.
**Why it matters:** the design states the candidate filters (confidence > 0.7, not expired, not superseded)
explicitly only for the **keyword** arm (L1707–1716); the **vector** arm is described as "top-20 semantically
similar" with no stated filter. If the floors don't apply to the vector arm, a **low-confidence, expired, or
superseded** memory can re-enter retrieval purely by semantic similarity — surfacing stale or retracted
knowledge (#1/#2). Also unspecified: whether an unscored `system_pointer` memory is admitted unconditionally.
**Options:** (a) **apply the confidence-floor / expiry / superseded filters uniformly to both arms** before the
clearance filter and ranking; admit `system_pointer` memories (unscored) on their own rule since they point at
authoritative live data; (b) keep the vector arm unfiltered (rejected — re-surfaces stale/superseded memory);
(c) apply expiry+superseded uniformly but let the vector arm ignore the confidence floor (partial — still
surfaces low-confidence memory).
**Recommendation:** **(a)** — the floors are integrity filters, not keyword-search quirks; a superseded or
expired memory must never re-enter via the vector arm. Admit `system_pointer` unconditionally (it dereferences
to the source of record). Low cost, closes a real stale-knowledge leak.

## OD-036 — Trust-window shadow-retain mechanics + exit criteria (Filter-1 Haiku gate) 🟢 RESOLVED
**Resolution (2026-06-25, delegated):** (a) **a fixed ~3-week shadow-retain window per deployment** (ADR-003 §8): every Filter-1 "would-drop" is written to a shadow store tagged `would_drop` + the Haiku decision/reason, surfaced in the Haiku-decision review queue; the gate **graduates to live-discard on an operator sign-off gated by a low measured disagree-rate** (AF-043's bar) — "manual review is the gate to autonomy." After graduation, drops are real (no shadow retain) but a **sampled audit continues** so the gate can't silently drift. Unblocks FR-2.ING.001; makes AF-043 the measurable bar.
**Surfaced by:** Component 2 drafting, 2026-06-25. Blocks **FR-2.ING.001**. Ties to **AF-043**, **ADR-003 §8**.
**Why it matters:** ADR-003 §8 audits the selective-writing Haiku gate (= design Filter 1) in a **shadow-retain
trust window**: a "would-drop" is **written + tagged**, never lost, so the gate's accuracy can be reviewed
before it's trusted to discard. The design's Filter 1, by contrast, "discards immediately" (L1583). The
mechanics are unspecified: **what** is retained (the dropped content + the Haiku decision + reason), **for how
long** (a fixed window? per-deployment?), **where** it surfaces (the Haiku-decision review queue), and **what
graduates** the gate to trusted-discard (a manual sign-off? a disagree-rate bar?).
**Options:** (a) **a fixed ~3-week shadow-retain window per deployment** (ADR-003 §8's figure): every Filter-1
drop is written to a shadow store tagged `would_drop` + the Haiku reason, surfaced in the Haiku-decision review
queue; the gate graduates to live-discard on an **operator sign-off** gated by a **low measured disagree-rate**
(AF-043's bar); after graduation, drops are real (no shadow retain) but a **sampled** audit continues; (b) keep
shadow-retain **always on** (safest, but defeats the cost saving the gate exists for); (c) trust the gate
immediately, no window (rejected — unvalidated autonomy over what knowledge to discard, #1).
**Recommendation:** **(a)** — a bounded trust window with a manual-sign-off-on-low-disagree-rate graduation is
exactly ADR-003 §8's "manual review is the gate to autonomy." After graduation keep a sampled audit so the gate
can't silently drift. Makes AF-043 the measurable bar.

## OD-037 — Personal-consolidation gate: skip vs human-approval queue 🟢 RESOLVED
**Resolution (2026-06-25, delegated):** (a) **skip by default + an opt-in audited approval queue** — the weekly merge + summarise jobs exclude Personal-tier candidates from auto-consolidation (the safe default honouring L1414); a cleared human may explicitly approve a specific Personal consolidation, logged via `access_audit`. Matches the system-wide pattern: Personal/Restricted handling is always explicit + logged, never automatic. Unblocks FR-2.MNT.014, FR-2.MNT.005, FR-2.MNT.007.
**Surfaced by:** Component 2 drafting, 2026-06-25. Blocks **FR-2.MNT.014, FR-2.MNT.005, FR-2.MNT.007**.
**Why it matters:** "Personal — never consolidated into broader memories without explicit human approval"
(L1414). The weekly **merge** + **summarise** jobs therefore must not auto-fold Personal-tier memories. The
mechanism is unspecified: do the jobs **skip** Personal memories outright, or **route** them to a human-approval
queue so the consolidation can still happen with sign-off? Auto-folding Personal data into a broader,
more-injected memory would broaden its exposure beyond its tier (#2).
**Options:** (a) **skip by default + an opt-in approval queue** — the jobs exclude Personal-tier candidates from
auto-consolidation; a cleared human may explicitly approve a specific Personal consolidation (audited via
`access_audit`); (b) **always skip** (simplest, but Personal knowledge never benefits from consolidation);
(c) **route all Personal candidates to an approval queue** (more reviewer load).
**Recommendation:** **(a)** — skip automatically (the safe default that honours L1414), but provide an audited
human-approval path so a reviewer *can* consolidate Personal memories deliberately. Matches the broader pattern:
Personal/Restricted handling is always explicit + logged, never automatic.

## OD-038 — Memory hard-delete / compliance erasure path 🟢 RESOLVED
**Resolution (2026-06-25, user-decided):** (a) **own the rule in C2, seam the backup specifics to Phase 5.** C2 homes a **compliance-erasure capability** (new **FR-2.MNT.017**): distinct from decay/supersede, Super-Admin-gated, writes an audit tombstone to `access_audit`, and **cascades across the live derived layers** — the memory rows, the episodic evidence layer, the embeddings, (and any future cold tier). The **backup-purge mechanics + retention windows + legal specifics** are seamed to **Phase 5 (compliance) + ADR-008**; the documented posture is that erasure is honoured on the next off-platform backup cycle / within the retention window. This keeps the non-destructive default (decay never deletes) intact while making deliberate, audited erasure possible on day one (a #2 obligation). Unblocks FR-2.MNT.017.
**Surfaced by:** Component 2 drafting, 2026-06-25. Cross-cutting; seams to **Phase 5 (compliance)** + **ADR-008
(backups)**. Touches FR-2.MNT.002 ("decay never deletes") + C1 `PERM-memory.delete`.
**Why it matters:** the memory model is deliberately **non-destructive** — soft decay never deletes, human-written
memories never decay, the episodic evidence layer is never deleted. But a real deployment will face a
**right-to-erasure** request (delete all Personal data about an individual), which must purge across the
*episodic evidence layer*, the *embeddings*, *cold storage*, **and the off-platform backups** (ADR-008). The
design gives Super Admin/Admin a "delete/retire memory" capability (C1) but never defines a complete erasure
path. Leaving it implicit risks either an inability to comply (#2, legal) or a "deleted" memory that survives in
backups/evidence (a silent integrity gap, #3).
**Options:** (a) **define an explicit, audited compliance-erasure path** distinct from decay/supersede — a
Super-Admin-gated hard delete that cascades across the memory + its episodic evidence + embeddings + cold
storage, records a tombstone in `access_audit`, and **flags the backup-purge requirement** (the off-platform
snapshot must honour the erasure on its next cycle, ADR-008); (b) treat erasure as out-of-scope for v1 and rely
on retire/supersede (rejected — no real erasure = a compliance gap); (c) full crypto-shredding of Personal data
(heavier; revisit if a client requires it).
**Recommendation:** **(a)**, but **own only the *rule* in C2** (a compliance-erasure capability exists, is
Super-Admin-gated, audited, and cascades across the derived layers) and **seam the cross-cutting backup-purge +
retention specifics to Phase 5 (compliance) + ADR-008**. This keeps the non-destructive default intact while
making deliberate, audited erasure possible. Resolve the storage/retention/backup-purge details in Phase 5.

---

## OD-039 — Slack Enterprise Grid: per-workspace internal apps vs org-ready app 🟢 RESOLVED (2026-06-25 → (a) per-workspace default)
**Surfaced by:** Slack dossier (`tool-integrations/slack.md`), C3 research gate, 2026-06-25.
**Why it matters:** OD-011's internal-custom-app exemption is per single workspace. A client on
**Enterprise Grid** with multiple workspaces needs either one internal app per workspace (N installs/
tokens) or an **org-ready app** (single org-level token spanning workspaces). Provisioning + token-model
impact, Grid clients only.
**Options:** (a) default per-workspace internal app, add org-ready only when a Grid client needs
multi-workspace coverage; (b) org-ready app for all; (c) refuse Grid multi-workspace in v1.
**Recommendation:** **(a)** — keeps the simple exempt path for the common (single-workspace) case;
org-ready is a per-client escalation, not a default.

---

## OD-040 — Slack bot-token rotation: ON vs OFF 🟢 RESOLVED (2026-06-25 → (a) OFF by default)
**Surfaced by:** Slack dossier, 2026-06-25.
**Why it matters:** Slack token rotation is **opt-in and irreversible**; ON → 12 h access tokens
(`xoxe.xoxb-`) + a refresh obligation; OFF → non-expiring `xoxb`. For an internal ingest bot, OFF is
lower-complexity (revocation still handled via `tokens_revoked`/`app_uninstalled` → re-auth flow).
**Options:** (a) OFF by default; (b) ON (short-lived tokens) for all.
**Recommendation:** **(a) OFF** unless a client security policy mandates short-lived tokens — then accept
the 12 h refresh + persist-rotating-refresh-token obligation.

---

## OD-041 — GHL Private-app 5-agency install cap 🟢 RESOLVED (2026-06-25 → (a) pass GHL Security Review)
**Surfaced by:** GHL dossier (`tool-integrations/gohighlevel.md`), 2026-06-25.
**Why it matters:** A GHL **Private app installs without review** but is **capped at 5 unique agencies**.
Each client is its own agency, so the **6th client onward is blocked from installing** unless we publish
Public (Marketplace approval) or pass an **optional Security Review** to stay Private + uncapped. A real
scaling gate on a per-client connector (ties ADR-001/005).
**Options:** (a) pass the optional Security Review → stay Private, uncapped, no Marketplace listing;
(b) publish a Public/Marketplace app (review + ongoing compliance, conflicts with per-client model);
(c) cap the product at 5 GHL clients in v1.
**Recommendation:** **(a)** — keeps the per-client install model, removes the cap, avoids Marketplace;
treat the Security Review as onboarding infrastructure (like Google CASA). Until passed, **(c)** is the
implicit v1 limit — **flag it so we don't silently hit the block at GHL client #6** (#3).
**✅ Resolution (2026-06-25, operator-delegated):** **(a)** — pass GHL's optional Security Review (an
onboarding-infrastructure task, like Google CASA). **Until it passes, v1 is implicitly capped at 5 GHL
agencies** — recorded here so client #6 never hits a silent install block; the Security Review goes on the
C3 / provisioning build checklist. Re-open if onboarding outpaces the review.

---

## OD-042 — GHL inbound-webhook receiver contract 🟢 RESOLVED (2026-06-25 → (a) durable-queue→2xx, dedup `deliveryId`)
**Surfaced by:** GHL dossier, 2026-06-25 (AF-097 — GHL's own docs contradict on retry policy).
**Why it matters:** GHL's two official docs disagree on webhook retries (12/any-non-2xx vs 6/429-only/
no-5xx-retry). If 5xx truly gets no retry, a transient outage on our receiver **silently drops events**
(#3, and #1 if it was an ingest event).
**Options:** (a) durably queue the event then return **2xx on receipt**, dedup on `deliveryId`, make
processing idempotent, return 429 only as deliberate backpressure; (b) process synchronously and rely on
GHL retries.
**Recommendation:** **(a)** — decouple "I got it" from "I processed it" so our processing failures never
depend on GHL's ambiguous retry behaviour. This is the **generic receiver pattern for all webhook
connectors** (CONN contract). Resolve AF-097 to tune backpressure; (a) is safe regardless.

---

## OD-043 — GHL dossier re-verify cadence 🟢 RESOLVED (2026-06-25 → (a) 90-day re-verify + changelog poll)
**Surfaced by:** GHL dossier, 2026-06-25.
**Why it matters:** GHL ships **breaking changes with no deprecation window, multiple times/week**
(`GET /contacts/` already removed; v1 EOL'd; OAuth paths renamed without notice). The default +6-month
dossier re-verify is too slow for this vendor.
**Options:** (a) shorten GHL's `Re-verify by` to **90 days** + a standing changelog-poll task; (b) keep
the 6-month default.
**Recommendation:** **(a)** — and flag in the GHL connector FRs that any FR citing a specific endpoint
shape (OAuth paths, contact/opportunity schema, webhook signing) is high-staleness and must be re-checked
before build.

---

## OD-044 — ⭐ Webhook-auth reconciliation: ADR-007 "HMAC" vs per-vendor signature schemes 🟢 RESOLVED (2026-06-25 → (a) ADR-007 clarification note)
**Surfaced by:** Google + GHL dossiers, C3 research gate, 2026-06-25. **Touches a locked ADR (ADR-007) →
change-control.**
**Why it matters:** ADR-007 names **webhook HMAC** as "a real hard control." Across our three connectors
it is **not HMAC for two of them:** Google has **no HMAC** (Gmail = Pub/Sub **OIDC JWT**; Drive/Calendar =
client-set **`X-Goog-Channel-Token` + TLS + domain verification**); GHL uses **Ed25519** (`X-GHL-Signature`);
only Slack uses **HMAC-SHA256** (`X-Slack-Signature`). ADR-007's control is right in spirit (verify
authenticated ingress) but Slack-shaped in letter.
**Options:** (a) **clarification note** on ADR-007: the hard control is **"verified, authenticated webhook
ingress"** — HMAC is one instance; the connector contract requires each connector to declare + enforce its
vendor's signature scheme (HMAC / Ed25519 / OIDC-JWT / signed channel-token), and an unverifiable webhook
is rejected; (b) supersede ADR-007 with a new ADR; (c) leave ADR-007 as-is, handle divergence per-connector
(risks future FRs mis-citing "HMAC").
**Recommendation:** **(a)** — same posture (authenticated ingress = a hard control that ignores prompt
content), generalised wording; a clarification note (not a supersede) is the lightest change-control move,
consistent with how C0 reconciled ADR-007's webhook-ingress wording. The CONN contract's webhook-verify
obligation homes the per-vendor scheme. *(Operator decision recommended — it amends a locked ADR.)*
**✅ Resolution (2026-06-25, operator-delegated):** **(a)** — a dated **clarification note added to ADR-007**
(Consequences → Connector ingress): the hard control is "verified, authenticated webhook ingress," HMAC is
one instance, and the CONN connector contract requires each connector to enforce its vendor's scheme
(Slack HMAC / GHL Ed25519 / Gmail OIDC-JWT / Drive·Calendar signed channel-token); unverifiable → reject.
Posture unchanged; change-control satisfied via the note (not a supersede).

---

## OD-045 — Google Drive scope: `drive.file` vs `drive.readonly` 🟢 RESOLVED (2026-06-25 → (a) `drive.file` default)
**Surfaced by:** Google dossier, 2026-06-25.
**Why it matters:** Reading **existing** Drive files requires `drive.readonly` — a **RESTRICTED** scope
(full-corpus access → triggers **CASA** annual assessment, ~6 wk + cost). `drive.file` is **non-sensitive**
(no CASA) but only sees files the app created/opened — can't ingest a pre-existing corpus.
**Options:** (a) default `drive.file`, escalate to `drive.readonly` only when a client needs full-corpus
ingestion **and** accepts the CASA cost/lead-time; (b) always `drive.readonly`; (c) no Drive ingestion in v1.
**Recommendation:** **(a)** — least-privilege by default (#2), avoids CASA for clients who don't need
corpus-wide Drive ingest; corpus ingest is a deliberate, CASA-gated onboarding upgrade. (Gmail has no
non-restricted read option — Gmail read always implies restricted + CASA; only Drive has this fork.)

---

## OD-046 — C0 FR-0.WHK.002 GHL webhook scheme is stale (HMAC) vs dossier-correct Ed25519 🟢 RESOLVED (2026-06-25 → correct C0 FR via change-control)
**Surfaced by:** C3 verification gate (orphan/contradiction pass), session 20, 2026-06-25. **Touches a locked
(Approved) FR → change-control.**
**Why it matters:** C0 **FR-0.WHK.002** (Approved) specs GHL webhook verification as **HMAC-SHA256** over the
raw body against `X-GHL-Signature`. The GHL dossier (gohighlevel.md §5 L95–98, primary-source 2026-06-25)
establishes GHL migrated **RSA→Ed25519**: current scheme is **Ed25519** verifying `X-GHL-Signature` against
GHL's **published static public key**; the legacy RSA header `X-WH-Signature` is **deprecated 2026-07-01**.
C3 FR-3.TRIG.004 and the ADR-007 OD-044 clarification note already spec Ed25519 — so the Approved C0 FR now
contradicts both the dossier and its own governing ADR. Building C0 as-written would reject every real GHL
webhook (wrong algorithm). This is a stale vendor fact (#3 risk: silent webhook rejection), not a design fork.
**Options:** (a) **correct FR-0.WHK.002 in place via a dated change-control note** — change algorithm
HMAC-SHA256 → **Ed25519 against the published public key**, header `X-GHL-Signature`, cite the dossier (not
the design doc); (b) supersede the FR; (c) leave C0 stale, rely on C3 (risks a build using the C0 FR).
**Recommendation:** **(a)** — a factual vendor correction, not a judgment call (dossier is primary-source;
ADR-007 OD-044 already generalised the control to per-vendor schemes). Lightest change-control move; keeps
the two components consistent. *(Surfaced for operator veto — it edits an Approved component.)*
**✅ Resolution (2026-06-25, operator-delegated):** **(a)** — FR-0.WHK.002 corrected in place with a dated
change-control note: algorithm → **Ed25519** verifying `X-GHL-Signature` against GHL's published public key;
legacy RSA `X-WH-Signature` rejected after its 2026-07-01 deprecation; Source re-cited to the GHL dossier +
ADR-007 OD-044 note. Status remains `Approved` (corrected, not re-opened). AF-090 (exact Ed25519 signing
input) carries the residual build-time verification, shared with C3 FR-3.TRIG.004.

---

## OD-047 — Review the seven hard limits: right set, and right rigidity? 🟢 RESOLVED (2026-06-26, C6 session 23)
**✅ Resolution (2026-06-26, C6 Guardrails — operator delegated "what do you suggest"):** **Keep the seven as
absolute, strict-by-default; do not tier-gate or remove any before the AF-068 red-team.** (a) **Too-strict** is
handled *without* weakening a limit — every limit is "never **autonomously** X"; legitimate low-risk automation
flows through the **approval-gate** layer (a human-approved action is not autonomous), so the limit is never
tripped. (b) **Too-lax** is handled by **coverage via approval-gates + rate-limits, not new absolute limits** —
bulk export, mass memory-delete, public/external posting, connector-mediated spend, destructive config change
route to **hard-approval (FR-6.APR.002)** and/or **rate caps (FR-6.RTL.001)**; the sub-question "promote any of
these to an absolute limit?" is **CLOSED → gate, don't promote** (they keep a legitimate human-authorized path an
absolute limit would forbid). (c) **Enforceability** is **not yet proven** — it rests on **AF-068** (the
containment red-team); the seven stay the safe default *because* enforceability is unproven; do not relax before
AF-068. Any change to the set/rigidity goes through change-control (ADR-007 + FR-3.ACT.002, both Approved). Homed
in **FR-6.HRD.001/003/004**. *(Original flag retained below.)*

**Cross-reference (2026-07-02, pre-Phase-6 audit):** this position was briefly narrowed by **OD-088** (2026-06-27,
low-risk-external Act-tier carve-out) and then **restored** by **OD-161** (2026-07-02) — OD-161's reasoning is
exactly this OD's original "coverage via approval-gates, not weakening a limit" stance. OD-047 was vindicated, not
reversed; no correction needed here, noted for traceability only.

**Surfaced by:** operator, 2026-06-25. **Touches locked decisions** (ADR-007 + FR-3.ACT.002, both Approved)
→ any change goes through change-control.
**The seven (code-enforced, no role/config/prompt override — FR-3.ACT.002, design L2053–2066):** never
autonomously (1) send external email · (2) make a financial transaction · (3) delete a system-of-record
record · (4) share data across client deployments · (5) impersonate a named human · (6) self-approve a
queued action · (7) treat monitored tool content as instructions.
**Why it matters / the two failure directions:**
- **Too STRICT** — a blanket "never" could block legitimate, low-risk automation a client actually wants
  (e.g. routine outbound comms), pushing real work into manual approval and hurting usefulness. Is a flat
  prohibition right, or should some be *tier-gated* (auto-allow low-risk, gate high-risk) rather than absolute?
- **Too LAX** — are seven *enough*? Other dangerous autonomous actions may not be covered: bulk data
  export, mass-delete of memory, posting publicly/externally, spending via a connector that isn't a
  classic "financial transaction," destructive config changes. And is "no override, ever" actually
  *enforceable* end-to-end, or are there bypass paths (AF-068 red-team is the proof, still pending)?
**Scope of the review:** confirm the *set* (add/remove limits), confirm the *rigidity* (absolute vs
tier-gated per limit), and confirm *enforceability* (the AF-068 containment red-team). 
**Home:** **C6 (Guardrails)** — C6 owns the enforcement machinery, so the review lands there; C3 only
*declares* the limits. Carried forward until then.
**Recommendation:** revisit at C7 with the AF-068 red-team results in hand; do not change the seven before
then (they are the safe default — strict-by-default protects #2 while we decide).

---

## OD-048 — Layer-1 single source of truth: `prompt_layers` vs `agents.system_prompt` 🟢 RESOLVED
**Surfaced by:** Component 4 (Prompt Architecture) drafting, 2026-06-26. Blocks **FR-4.LYR.001,
FR-4.STO.001/002**.
**Why it matters:** the design doc stores each agent's Layer 1 in **two** places — `prompt_layers.content`
where `layer='core'` (L2460) **and** `agents.system_prompt` (L3504, "this agent's Layer 1") — each with its
own `version`/`previous_version_id`/`change_reason`. Two authoritative stores for the same content is a direct
#1 risk: an edit to one leaves the other stale, and the harness could assemble a prompt from the wrong copy.
**Options:** (a) **unify on `prompt_layers`** as the single versioned store for all four layers; drop
`agents.system_prompt` (or make it a derived read/pointer), reconcile in C8; (b) unify on
`agents.system_prompt` for Layer 1 and use `prompt_layers` only for the other three layers (splits the store);
(c) keep both, designate one canonical + sync (rejected — sync is the failure mode).
**Resolution (2026-06-26, user — accepted recommendation):** **(a)** — `prompt_layers` is the single
authoritative, versioned store for **all four** layer types (Layer 1 = `layer='core'`, keyed to `agent_id`).
`agents.system_prompt` is **removed** (or reduced to a derived read) and this is reconciled in **C8 (Agent
Design)** where the `agents` registry is specced. One store, one versioning path, no sync.

## OD-049 — Operating-principles block editability 🟢 RESOLVED
**Surfaced by:** Component 4 drafting, 2026-06-26. Blocks **FR-4.PRIN.002**.
**Why it matters:** the seven operating principles are included in every agent's Layer 1 "without exception"
(L2427) and are the one part of Layer 1 shared verbatim across all agents (L2390). Several of them *are* the
safety posture — "prefer reversible actions", "memory is context, not authority", "stay in your lane" (#2). But
prompts are dashboard-editable (L2475). If the principles block can be silently weakened, the system's
guarantees change with no trace.
**Options:** (a) **locked/system-managed block**, not editable from the dashboard; (b) **editable, but gated to
Super Admin only** (tighter than general prompt-editing, which is Super Admin + Admin), with mandatory
`change_reason` + audit + a safety-warning on the edit; (c) editable like any other prompt content (Super Admin
+ Admin, no special gate).
**Resolution (2026-06-26, user-decided):** **(b)** — the operating-principles block **is editable, but only by
Super Admin** (a dedicated, higher-privilege permission node `PERM-prompt.edit_principles`, NOT held by Admin,
who can edit other prompt content). Every principles edit requires a mandatory `change_reason`, is
audit-logged as a **safety-relevant change**, and surfaces a confirmation warning that the operator is
modifying the shared safety posture. Honours "the operator owns their deployment" while keeping the change
**never silent** (#3) and fully traceable. *(User preference over the rec-(a) lock: "I would like [it] to be
editable for superadmin.")*

## OD-050 — Prompt-change effect on in-flight tasks (version pinning) 🟢 RESOLVED
**Surfaced by:** Component 4 drafting, 2026-06-26. Blocks **FR-4.LYR.003, FR-4.STO.006, FR-4.OPT.001**.
**Why it matters:** prompts are edited live ("bump version, reload", L2475). If a running task picks up a new
Layer 1 mid-flight, the agent's identity/principles change underneath it (contradicting "Layer 1 never changes
mid-run", L2397) and version→outcome attribution (L2485) becomes ambiguous.
**Options:** (a) **pin the prompt version at prompt-stack assembly time** — in-flight tasks finish on the
version they began with, only tasks assembled after the edit use the new version; (b) hot-swap all tasks to the
newest version immediately (breaks mid-run immutability); (c) pin per-step rather than per-task.
**Resolution (2026-06-26, user — accepted recommendation):** **(a)** — the prompt version is pinned at
assembly time; running tasks complete on their pinned version, new tasks use the edit. Preserves FR-4.LYR.003
(mid-run immutability) and gives clean version→outcome attribution for FR-4.OPT.001 (#1/#3).

## OD-051 — Layer-1 length-bound enforcement 🟢 RESOLVED
**Surfaced by:** Component 4 drafting, 2026-06-26. Blocks **FR-4.CID.002**.
**Why it matters:** the design caps Layer 1 at "300–500 words maximum" (L2403). A hard save-block could prevent
a legitimate edit; an unbounded prompt undermines the compression discipline (L2489) and inflates token cost.
**Options:** (a) **advisory warning** above the bound, save still permitted; (b) hard save-blocking validation;
(c) no enforcement at all.
**Resolution (2026-06-26, user — accepted recommendation):** **(a)** — an advisory warning when Layer 1
exceeds ~500 words, but the save is permitted. No safety reason to fail-closed; compression is a maintained
discipline (FR-4.OPT.003), not a gate.

## OD-052 — Dynamic Layer-2 field value source + freshness 🟢 RESOLVED
**Surfaced by:** Component 4 drafting, 2026-06-26. Blocks **FR-4.BIZ.003, FR-4.OPT.002**.
**Why it matters:** deployment config *names* the dynamic Layer-2 fields (`current_quarter_goals`,
`active_campaigns`, `this_week_priorities`, L851–855) but never says where their **live values** are stored,
who edits them, or how stale they may be. A stale "this week's priorities" silently misleads the AI (#3).
**Options:** (a) **operator-editable per-deployment key→value store** named by the config field list, injected
at assembly time, with staleness optionally surfaced; (b) values pulled live from a connector each session
(more moving parts, connector-dependent); (c) values baked into static config (defeats the "fresh each
session" intent, L2487).
**Resolution (2026-06-26, user — accepted recommendation):** **(a)** — dynamic-field values live in an
operator-editable per-deployment store keyed by the config-declared field names, injected fresh at assembly;
staleness is the operator's responsibility and may be surfaced in the editor (a `last_updated` hint). CFG/UI/
DATA stubs parked for Phases 2–4.

## OD-053 — Operating-principles floor: hard-block removal vs override-with-confirmation 🟢 RESOLVED
**✅ Resolution (2026-06-26, user-decided):** **(a) hard-block** — a save that removes/empties any of the seven
canonical principles is rejected outright; rewording/strengthening a principle is fully permitted. Faithful to
L2427 "without exception"; keeps the safety floor intact (#2) while honouring OD-049's Super-Admin-edit intent.
Realised by AC-4.PRIN.002.4.

**Surfaced by:** Component 4 verification gate (quality pass, HIGH finding #2), 2026-06-26. Refines **OD-049**.
Blocks the final AC of **FR-4.PRIN.002** (AC-4.PRIN.002.4).
**Why it matters:** OD-049 made the operating-principles block Super-Admin-editable. The design also says the
seven principles appear in every Layer 1 "without exception" (L2427), and several *are* the safety posture
(#2: prefer-reversible, memory-is-context, stay-in-your-lane). So "editable" must not mean "a principle can be
silently dropped." Rewording/strengthening a principle is clearly fine; **deleting one** is the edge. The
question is only *how hard* the floor is enforced.
**Options:** (a) **hard-block** — a save that removes/empties any of the seven is rejected outright (reword
yes, remove no); (b) **override-with-explicit-second-confirmation** — removal is allowed but requires a
distinct "I am reducing the safety floor" confirmation, itself audited as its own event; (c) no floor —
removal allowed like any edit (rejected — silently weakens #2, contradicts L2427).
**Recommendation:** **(a) hard-block** — it is faithful to the design's "without exception" (L2427), keeps the
safety floor intact (#2), and still lets a Super Admin fully *edit the expression* of every principle (honours
OD-049's intent). (b) is acceptable if you want the escape hatch; (c) is not. **Default in the spec = (a)**
pending your call. *(This is the one C4 item that touches a non-negotiable and your own OD-049 decision, so
it's surfaced rather than silently resolved.)*

---

## OD-054 — `task_queue` status enum vs the guardrail-set `'flagged'`/quarantine state 🟢 RESOLVED (2026-06-26 → (a) explicit guardrail/quarantine status, C5-owned schema, C6-set)
**Surfaced by:** Component 5 (Agent Harness) drafting, 2026-06-26. Blocks **FR-5.QUE.003** (and the
guardrail-routing AC of FR-5.ASM.007).
**Why it matters:** the `task_queue` schema enumerates status as
`pending | running | awaiting_approval | completed | failed` (L2523), but the guardrails section sets a task's
status to **`'flagged'`** when a guardrail fires (L2870, C6). The schema and its usage disagree — a guardrail
hit would write a status the enum doesn't define. Left unreconciled, a held/quarantined task either rides an
**undefined/blank status** (a silent-state failure, #3) or is mis-coded as `awaiting_approval` (conflating a
**safety hold** with a routine **approval wait** — they need different handling and different dashboards).
C5 owns the `task_queue` schema + state machine; C6 sets the value on a guardrail hit.
**Options:**
- (a) **Extend the enum with an explicit guardrail/quarantine state** (e.g. `flagged` / `quarantined`) defined
  in the C5 schema, set by C6 — distinct from `awaiting_approval`; the state machine defines its transitions
  (→ human review → requeue/discard/approve). A held task always has a real, defined status.
- (b) Reuse `awaiting_approval` for guardrail holds (no new state) — simpler enum, but conflates safety holds
  with approval waits and loses the distinction in the audit record.
- (c) Track the flagged/held condition on a **separate column** (status stays in the base enum; a `hold_reason`
  / `guardrail_state` field carries the safety hold).
**Recommendation:** **(a)** — a defined, distinct status is the only option that never persists an undefined
state (#3) and keeps a safety hold cleanly separable from a routine approval wait in the audit record and the
dashboards. C5 owns the enum + the state machine; C6 sets the value. *(Delegable — schema-shape call,
non-negotiable-#3-aligned; not a posture decision.)*

## OD-055 — Context-envelope compression policy (trigger, strategy, original-output retention) 🟢 RESOLVED (2026-06-26 → (a) configurable threshold; summarize but retain full originals — economy, never loss)
**Surfaced by:** Component 5 drafting, 2026-06-26. Blocks **FR-5.ENV.003**. Ties **AF-114**.
**Why it matters:** the design compresses earlier step outputs into summaries between steps "in long chains" with
a "configurable threshold" (L2608), but never says **what triggers** compression (token count? step count?
chain depth?), **what strategy** summarizes (and at what fidelity), or — critically — **whether the original
uncompressed outputs are retained**. If compression discards the only copy of a step's output and a later step
(or an audit, or a resume-from-failure) needs it, that is silent **knowledge/state loss** (#1) and could corrupt
a resumed chain (FR-5.GRP.004 reuses prior step outputs).
**Options:**
- (a) **Configurable token/step threshold; summarize into the working envelope but preserve the full original
  outputs in the durable step record** (Inngest step state / task history) — compression bounds the *prompt
  context*, never deletes the source. Later steps read the summary; resume/audit can recover the original.
- (b) Lossy compression — discard originals once summarized (cheapest context, but loses the source; rejected
  for the resume/audit/#1 risk unless originals are provably never needed again).
- (c) No compression in v1 — accept token growth (simplest, but the design calls for it on real long chains).
**Recommendation:** **(a)** — compression is a context-window **economy**, never a knowledge loss. Trigger on a
configurable token/step threshold; summarize for the next step's prompt; keep the full originals in the durable
step record so resume-from-failure and audit are intact. **AF-114** validates that the summary preserves the
task-critical state a later step actually needs. *(Delegable — #1-aligned; rec is the safe reading.)*

## OD-056 — Parallel step execution × approval-gate semantics 🟢 RESOLVED (2026-06-26, user-decided → (a) step-level gating + no-irreversible-outrun constraint, AF-113-gated)
**Surfaced by:** Component 5 drafting, 2026-06-26. **Touches non-negotiable #2.** Blocks **FR-5.OPT.001**.
Ties **AF-113**.
**Why it matters:** parallel execution runs independent steps simultaneously (L2614); approval gates block a
step until a human approves (L2525, FR-5.QUE.005). When the two combine, the design is silent on the semantics:
if one step in a parallel set requires approval, does the **whole set block**, or only that step (and its
dependents) while independent siblings proceed? Get this wrong and a parallel sibling could fire an
**irreversible external side effect** (a CRM write, a comm) *before* the human approves a gated step that would
have changed or cancelled it — a direct #2 exposure (an autonomous consequential action ahead of its gate).
**Options:**
- (a) **Step-level gating** — an approval-gated step blocks **itself and its dependents**; independent siblings
  with no dependency on the gated step proceed. **Constraint:** a step may not pre-apply an irreversible side
  effect that a *pending* approval elsewhere in the same task would logically precede; the planner/DAG marks
  such ordering so the irreversible step waits. Maximises throughput while protecting #2.
- (b) **All-or-nothing** — if any step in a parallel set requires approval, the entire set blocks until that
  approval clears. Safest/simplest, lowest throughput; can stall independent work needlessly.
- (c) Step-level gating with **no** irreversibility constraint — fastest, but reintroduces the #2 risk
  (rejected).
**Recommendation:** **(a)** — step-level gating with the irreversibility constraint: independent reversible work
parallelises, but no irreversible side effect outruns a pending approval it should follow. **AF-113** proves
the DAG honours this with no `shared_context` race. Fall back to **(b)** if AF-113 shows the ordering can't be
made reliable. *(Surfaced for your decision — it touches #2: how aggressively parallel work may proceed around a
human gate.)*

## OD-057 — Loop missed-run catch-up + same-loop overlap semantics 🟢 RESOLVED (2026-06-26 → (a) no concurrent same-loop runs + single catch-up + idempotency, AF-112-gated)
**Surfaced by:** Component 5 drafting, 2026-06-26. Blocks **FR-5.LOP.004**. Ties **AF-112**.
**Why it matters:** "a missed run triggers automatic catch-up" and "all loops run independently" (L2575), but two
behaviours are unspecified. (1) **Catch-up:** does a missed loop **backfill every missed interval** (N runs), or
run **a single catch-up** now? Backfill-all could stampede after an outage. (2) **Self-overlap:** if a fast-loop
run (5 min cadence) takes 7 min, does the next scheduled run start **concurrently** with the still-running one?
Concurrent same-loop runs risk **double-processing** the same queue items / double side effects (#1/#3) unless
idempotency fully covers them.
**Options:**
- (a) **No concurrent same-loop runs** (skip the tick, or queue exactly one, if the prior run is still going) +
  **single catch-up** on the next interval after a miss (not backfill-all) + idempotency keys (FR-5.GRP.003)
  guarantee a catch-up can't duplicate already-done work. Predictable, no stampede, no double-act.
- (b) Backfill every missed interval + allow concurrent runs — maximal "catch up" but stampede + double-process
  risk (rejected unless idempotency is proven exhaustive).
- (c) Skip missed runs entirely (no catch-up) — simplest, but silently drops a scheduled sweep (#3).
**Recommendation:** **(a)** — serialize a loop against itself (skip/queue-one on overrun), do a single catch-up
rather than a backfill stampede, and lean on idempotency so even a late catch-up double-fire can't duplicate
work. **AF-112** validates the idempotency holds under catch-up at scale. *(Delegable — #1/#3-aligned operational
call.)*

## OD-058 — Inngest retry/DLQ authority vs `task_queue.attempts` 🟢 RESOLVED (2026-06-26 → (a) Inngest = single retry authority; task_queue = audit projection)
**Surfaced by:** Component 5 drafting, 2026-06-26. Blocks **FR-5.JOB.004** (and the retry ACs of FR-5.QUE).
**Why it matters:** Inngest provides built-in retry-with-backoff + a dead letter queue (L2646–2648), **and** the
`task_queue` table carries `attempts` / `next_retry_at` (L2528–2529). If **both** drive retries independently, a
task can be retried twice per failure (Inngest *and* a task_queue poller) → **double execution** of a
consequential step (#2) and an incoherent audit record (#3). The design says "Inngest executes, Supabase
records, neither replaces the other" (L2681) but never states which one **owns** retry.
**Options:**
- (a) **Inngest is the single retry/DLQ authority**; `task_queue.attempts` / `next_retry_at` / `status` are an
  **audit projection** synced *from* Inngest (written as Inngest reports attempts/outcomes). There is exactly
  one retry loop. The task_queue never independently schedules a retry.
- (b) task_queue owns retry; Inngest configured with retries=0 (inverts the design — loses Inngest's native
  backoff/DLQ; rejected).
- (c) Both retry, reconciled by idempotency keys (relies entirely on idempotency to suppress the double-run;
  fragile, and still pollutes the audit record — rejected).
**Recommendation:** **(a)** — Inngest is the execution + retry authority (its whole value proposition,
AF-018-verified); task_queue is the durable record, updated from Inngest's lifecycle events. One retry loop, one
source of truth, no double-execution. *(Delegable — #2/#3-aligned; rec follows the design's own "Inngest
executes, Supabase records" split.)*

## OD-059 — Chained-task scope inheritance 🟢 RESOLVED (2026-06-26, user-decided → (a) fresh envelope + explicit handoff + B re-retrieves under its own scope/clearance)
**Surfaced by:** Component 5 drafting, 2026-06-26. **Touches non-negotiable #2.** Blocks **FR-5.TRG.004**
(and FR-5.OPT.004 pre-warm).
**Why it matters:** a chained trigger fires Task B from Task A's output (L2511). The design never says what
**context** crosses the boundary: does B **inherit A's full context envelope** (entities, retrieved memories,
`shared_context`), or start **fresh** with just a handoff payload? Inheriting the whole envelope is convenient
but risks **carrying A's broader entity/memory scope into B** — B then acts on memories it never independently
retrieved or cleared, potentially **above B's own scope/clearance** (a #2 over-reach) and on **stale** context
(A's retrieval, not B's). Starting fresh is safer but loses useful continuity unless an explicit handoff carries
what B needs.
**Options:**
- (a) **Fresh envelope + explicit handoff** — B starts a new context envelope seeded with an explicit handoff
  payload (A's relevant output + a provenance link to A) and **re-runs its own memory retrieval** for its own
  entity scope (re-applying the C2 clearance gate). B never silently inherits A's broader scope; continuity is
  carried deliberately, not by leakage. Pre-warm (FR-5.OPT.004) warms B's *own* retrieval.
- (b) **Full envelope inheritance** — B receives A's complete envelope (entities, memories, shared_context).
  Maximal continuity, but B acts on A-scoped memory it didn't retrieve/clear (the #2 over-reach + staleness
  risk).
- (c) Configurable per chain (inherit vs fresh) — flexible, but makes the unsafe mode available by default
  unless carefully governed.
**Recommendation:** **(a)** — fresh envelope + explicit handoff + B re-retrieves under its own scope/clearance.
It keeps every task's memory access traceable to *that task's* retrieval + clearance (preserves #2 and the C2
clearance-before-ranking invariant), carries continuity deliberately via the handoff payload, and keeps a
provenance link for audit. *(Surfaced for your decision — it touches #2: whether one task's memory scope may
flow into the next.)*

---

## OD-060 — Hard-limit override posture: is a hard-limit hit ever human-overridable? 🟢 RESOLVED (2026-06-26, C6 session 23)
**Surfaced by:** Component 6 (Guardrails) drafting, 2026-06-26. Blocks **FR-6.HRD.003**. **#2-touching** — surfaced
to the operator, who delegated ("what do you suggest").
**Why it matters:** L2066 says no role/instruction/config can override a hard limit; L2782 says hard *approval*
blocks until a human approves. If the approval queue exposes "approve" on a **hard-limit** violation the same way
it does for an approval-gate flag, the absolute boundary becomes human-overridable — collapsing #2.
**✅ Resolution → (a):** **hard limit = block + log + alert, with NO approve/override affordance anywhere.** The
queue's approve/reject/modify apply only to approval-gate, anomaly, and injection flags — never to a `hard_limit`
event (the `status→approved` transition is invalid for type `hard_limit`). Legitimate "the client wants this
automation" cases are served by the **approval-gate** layer (a human approves the *specific* action), not by
weakening the autonomous prohibition. Pairs with OD-047. Homed in FR-6.HRD.003 (+ AC-6.HRD.003.2, AC-6.LOG.001.2).

## OD-061 — Failure-mode-map ownership / scope 🟢 RESOLVED (2026-06-26, C6 session 23)
**Surfaced by:** Component 6 drafting, 2026-06-26. Blocks **FR-6.FMM.001**. Delegated.
**Why it matters:** the failure-mode map (L2821–2862) lists 26 failure modes across task/memory/tool/agent/system.
Read literally, C6 would re-implement memory health scans, connector health, loop heartbeats, orchestrator
confidence logging — usurping C2/C3/C5/C8 and ballooning C6.
**✅ Resolution → (a):** the map is a **cross-component catalogue** — each row's *detection* belongs to its home
component and its *alert path* is C7. C6 owns only (i) the **guardrail-class responses** (hard-limit / injection /
anomaly / rate-limit / approval-abandonment) and (ii) the **no-silent-failure invariant** (#3). Homed in
FR-6.FMM.001.

## OD-062 — Rate-limit guardrail ownership split 🟢 RESOLVED (2026-06-26, C6 session 23)
**Surfaced by:** Component 6 drafting, 2026-06-26. Blocks **FR-6.RTL.002**. Delegated.
**Why it matters:** the five caps (L2811–2816) overlap existing owners — `memory_writes_per_minute` is C2/ADR-004,
concurrent-tasks + retries-to-DLQ are C5, tool-writes + external-comms are C6/C3.
**✅ Resolution → (a):** C6 **frames all five as guardrails** (configurable, never-unlimited, breach →
`guardrail_log` + ladder) and **delegates the enforcement mechanism** to the home owner. C6 owns the policy + the
breach response; it does not re-implement existing counters. Homed in FR-6.RTL.001/002/003.

## OD-063 — Anomaly → severity / approval-tier mapping 🟢 RESOLVED (2026-06-26, C6 session 23)
**Surfaced by:** Component 6 drafting, 2026-06-26. Blocks **FR-6.ANM.003**. Delegated.
**Why it matters:** L2791–2803 defines five anomaly checks but never says what an anomaly *does* — flag only, or
block? Per ADR-007 detection-as-signal, it must not autonomously hard-gate.
**✅ Resolution → (a):** an anomaly **flags + routes to human review (the soft path) by default**, with a
per-anomaly, per-deployment **configurable severity** that may escalate a specific anomaly to hard-approval. No
anomaly autonomously blocks-and-acts. Homed in FR-6.ANM.003.

## OD-064 — Soft-approval auto-execute-on-inaction posture 🟢 RESOLVED (2026-06-26, C6 session 23)
**Surfaced by:** Component 6 drafting, 2026-06-26. Blocks **FR-6.APR.003**. **#2-adjacent** — surfaced to the
operator, who delegated.
**Why it matters:** soft approval "executes after X minutes unless rejected" (L2780) = human **inaction →
auto-execute**; for an irreversible action that is a #2 exposure, and must reconcile with C5 OD-056 (no
irreversible action auto-executes).
**✅ Resolution → (a):** soft-tier auto-execute-on-timeout applies **only to reversible actions**; anything
irreversible / external-communication / financial / Confidential / Restricted is **hard-tier by definition**
(L2783–2784) and never auto-executes on inaction. Bounded by the OD-056 no-irreversible-outrun rule. Homed in
FR-6.APR.003.

**Cross-reference (2026-07-02, pre-Phase-6 audit):** **OD-088** (2026-06-27) briefly carved a low-risk-external
sub-type out of this "external-communication = hard-tier, never auto-executes" rule, letting it reach an
autonomous Act tier. **OD-161** (2026-07-02) reverted that carve-out — this OD's original rule (external comms stay
hard-tier, never auto-executes on inaction) is back in force with no exceptions. Noted for traceability; no
correction needed here.

## OD-065 — `guardrail_log` relationship to `access_audit` (C1) + `event_log` (C7) + completeness 🟢 RESOLVED (2026-06-26, C6 session 23)
**Surfaced by:** Component 6 drafting, 2026-06-26. Blocks **FR-6.LOG.001/003**. Delegated.
**Why it matters:** three append-only sinks now exist — `access_audit` (C1/OD-024), `event_log` (C7),
`guardrail_log` (C6). Their boundaries + ownership of view/retention must be crisp or events fall between them (#3).
**✅ Resolution → (a):** `guardrail_log` is the **distinct, append-only security-event store** for all five
guardrail types; it does **not** duplicate `access_audit` or `event_log`. **C6 owns write-completeness** (every
event of all five types produces a row, never silent); **C7 owns the dedicated view, retention, tamper-evidence,
and export mechanism** (L2902). `client_slug` is label-only. Homed in FR-6.LOG.001/003/004.

## OD-066 — Semantic-scan default + quarantine-when-semantic-off 🟢 RESOLVED (2026-06-26, C6 session 23)
**Surfaced by:** Component 6 drafting, 2026-06-26. Blocks **FR-6.INJ.002/003/006**. Delegated.
**Why it matters:** ADR-007 ships the semantic-similarity scan **off by default**; the design's step-4 quarantine
combines "pattern match + semantic similarity" — so if semantic is off, does quarantine still function?
**✅ Resolution → (a):** the **deterministic regex layer is always-on** and can **quarantine on a high-confidence
literal match alone**; the **semantic scan is an additive signal** that, when enabled, raises the combined score
toward the quarantine threshold. With semantic off, the regex layer still detects, logs, boundary-wraps, and
quarantines high-confidence literals — never undefended; the semantic scan only *widens* coverage. Thresholds
remain signal knobs (ADR-007). Homed in FR-6.INJ.002/003/006.

---

## OD-067 — `event_log` / `guardrail_log` `client_slug` under the Silo model 🟢 RESOLVED (2026-06-26, C7 session 24)
**Surfaced by:** C7 drafting. **Blocks:** FR-7.LOG.001, FR-7.RTP.003. **Delegated.** The design schemas + Realtime
examples carry `client_slug`; under ADR-001 §3 each client is a single-tenant silo with the column deleted.
**✅ Resolution → (a):** **drop `client_slug` intra-silo** — identity is implicit; the Realtime filter reduces to
`status=eq.awaiting_approval`; client identity appears only at the management-plane `client_registry`. Mirrors C1–C6.

## OD-068 — Cost-ladder enforcement ownership: who throttles / hard-kills? 🟢 RESOLVED (2026-06-26, C7 session 24) — **#2, user-decided**
**Surfaced by:** C7 drafting. **Blocks:** FR-7.COST.003. **Why it matters:** the ladder ends in throttle ($75) +
hard-kill ($100) — actions that stop the system. Fuzzy ownership → either a runaway burns unbounded client money
(#1) or legitimate work halts without authority (#2/#3). **✅ Resolution → (a)** (user-decided): **C7 owns the meter +
the ladder trigger signal; C6 decides + C5 executes** the throttle/kill — grounded in **ADR-003 §"Guardrails
component" (L181–182)** which makes the cost ladder a C6 guardrail class (sibling to the rate-limit ladder).
**Carry-forward ✅ CLOSED (2026-06-27, session 27):** the owed C6 cost-ladder enforcement FR was written —
**C6 FR-6.RTL.004** (C7 meters → C6 decides → C5 executes; soft→throttle→hard-kill; never overrides a hard limit;
every rung writes `guardrail_log`), added via change-control alongside C10 as the final-Phase-1 debt clear. OD-068
is now fully realised (decision + enforcement FR both exist).

## OD-069 — Alert escalation: no-response → secondary alert (no silent drop) 🟢 RESOLVED (2026-06-26, C7 session 24)
**Surfaced by:** C7 drafting. **Blocks:** FR-7.ALR.005. **Delegated.** L3315 names an escalation window but no owner
or end-state. **✅ Resolution → (a):** every alert carries an escalation window + a routing chain; no ack in the
window escalates to the next in the chain; a critical/hard-limit alert that exhausts its chain stays persistently
escalated, never auto-cleared — reusing the C1 OD-028 / C2 OD-032 / C5 AC-5.QUE.005.2 escalate-don't-abandon pattern.

## OD-070 — Notification-centre delivery durability vs Slack 🟢 RESOLVED (2026-06-26, C7 session 24)
**Surfaced by:** C7 drafting. **Blocks:** FR-7.ALR.006. **Delegated.** **✅ Resolution → (a):** the dashboard
notification is persisted first + independently; Slack is a best-effort fan-out off that row; a Slack-delivery
failure never loses the dashboard notification and is itself surfaced (#3).

## OD-071 — Management-plane push staleness: stale-not-green 🟢 RESOLVED (2026-06-26, C7 session 24)
**Surfaced by:** C7 drafting. **Blocks:** FR-7.MGM.002. **Delegated.** The Super Admin grid is push-fed (ADR-001 §7);
a stopped reporter would show a stale-but-green card. **✅ Resolution → (a):** every card carries a freshness
timestamp; a snapshot older than a configurable window flips to `stale`/`unreachable` + raises a cross-deployment
alert — absence of signal is itself a signal. *(C7 verification gate hardened this with AC-7.MGM.002.3 — an
independent-heartbeat evaluator so the stale-detector can't itself fail silently — and AC-7.MGM.002.4 server-time.)*

## OD-072 — Three-sink retention windows + completeness 🟢 RESOLVED (2026-06-26, C7 session 24)
**Surfaced by:** C7 drafting. **Blocks:** FR-7.LOG.006, FR-7.LOG.007. **Delegated.** **✅ Resolution → (a):** each
sink (`event_log` / `guardrail_log` / `access_audit`) has a per-deployment configurable retention window with a
floor (audit/guardrail ≥ the compliance/audit minimum); a row is never pruned while still referenced; pruning is
logged. The exact numeric floors are a C10/Phase-5 compliance input (flagged, not invented here).

## OD-073 — Realtime connection budget per-silo + degrade-to-polling 🟢 RESOLVED (2026-06-26, C7 session 24)
**Surfaced by:** C7 drafting. **Blocks:** FR-7.RTP.003. **Delegated.** The 200/500 Realtime cap is per Supabase
project = per silo. **✅ Resolution → (a):** on approaching the per-silo cap, extra subscriptions degrade to the
polling cadence (never silently freeze); the two trust-critical subscriptions (approval queue + notifications) are
prioritized for live connections; the condition is surfaced. *(Gate added a configurable headroom threshold,
AC-7.RTP.003.2.)*

## OD-074 — Compliance erasure vs the append-only log sinks 🟢 RESOLVED (2026-06-26, C7 session 24) — **#1/compliance, user-decided**
**Surfaced by:** the C7 verification gate (quality finding F3). **Blocks:** FR-7.LOG.006, FR-7.LOG.007. **Why it
matters:** `event_log.summary` + `entity_ids` and `guardrail_log.description` carry the PII a GDPR/erasure request
targets; C2 **FR-2.MNT.017** walks only the memory layers + `access_audit`, not these log sinks — so an erased
subject's identity persists in the logs (#1 / compliance). **✅ Resolution → (a) redaction-tombstone** (user-decided,
as the parent OD-038 was): scrub the PII fields in place, retain the row + audit metadata. Homed in
AC-7.LOG.006.3 / AC-7.LOG.007.4. **Carry-forward (change-control):** C2 **FR-2.MNT.017** must be amended to name
`event_log` + `guardrail_log` in its transitive erasure walk.

## OD-075 — `agents.system_prompt` disposition (closes OD-048) 🟢 RESOLVED (2026-06-26, C8 session 25)
**Surfaced by:** C8 drafting (carry-in from OD-048). **Blocks:** FR-8.REG.001, FR-8.REG.002, FR-8.ORC.008.
**Why it matters:** OD-048 resolved Layer-1 to a single source of truth in `prompt_layers` but deferred the concrete
`agents.system_prompt` disposition to C8. Two stores for the same content is a #1 risk (an edit to one leaves the
other stale). **Options:** (a) **remove the column entirely** — Layer-1 lives solely in `prompt_layers` keyed by
`agent_id` (`layer='core'`), the registry resolves it by `agent_id`; (b) keep it as a derived read-only
pointer/view. **✅ Resolution → (a)** (delegated, accepted rec): remove `agents.system_prompt`; one authoritative
store, no sync surface. A one-time migration folds any populated values into `prompt_layers` then drops the column
(Phase 4/6). Homed in FR-8.REG.002.

## OD-076 — Agent result cache invalidation 🟢 RESOLVED (2026-06-26, C8 session 25) — **#1, user-delegated**
**Surfaced by:** C8 drafting. **Blocks:** FR-8.LRN.003. **Why it matters:** the design specifies a time-based
`cache_time_window` per agent type (L952–960) **and** "reuse … when data hasn't changed" (L3630) — two different
invalidation models. Time-window-only reuse can serve a stale Research/agent output after a relevant write — a #1
corruption-by-staleness risk (acting on outdated knowledge). **Options:** (a) time-window-only (the literal config);
(b) **scope-aware + time-bounded** — cache key includes the in-scope entity ids + their last-write/memory version;
any write to an in-scope entity invalidates the entry, *and* a max time window still applies; on uncertainty,
miss-and-recompute rather than risk a stale hit. **✅ Resolution → (b)** (delegated, accepted rec). Homed in
AC-8.LRN.003.1/.2; staleness-safety gated by AF-125.

## OD-077 — Low-confidence clarification that goes unanswered 🟢 RESOLVED (2026-06-26, C8 session 25) — **#3, user-delegated**
**Surfaced by:** C8 drafting. **Blocks:** FR-8.ORC.006. **Why it matters:** below the confidence threshold the
orchestrator asks a human for clarification (L3413). If that request is never answered, the task must not silently
park (work lost, #3) and must not silently auto-proceed on a low-confidence plan (#2/quality). **Options:** (a)
**tracked + escalating** — the clarification is a `task_queue` item that escalates on timeout (reuse C1 OD-028 / C5
AC-5.QUE.005.2 escalate-don't-abandon), never silently dropped, never auto-executed below threshold; (b) auto-proceed
on best-guess after timeout; (c) silently park. **✅ Resolution → (a)** (delegated, accepted rec). Homed in
AC-8.ORC.006.2 + CFG-clarification_escalation window.

## OD-078 — Drift + dead-agent detection: threshold, signal, action 🟢 RESOLVED (2026-06-26, C8 session 25)
**Surfaced by:** C8 drafting. **Blocks:** FR-8.HLTH.001/002/003/004. **Why it matters:** "agent X has a 40% failure
rate" (L3578), specialisation drift (L3642), and dead-agent detection (L3644) need a threshold, a quality signal, and
an action policy. Auto-correcting/disabling an agent is itself an autonomous action (the L3563 prompt-drift rule says
"never auto-corrected — too risky"; OD-010 says no auto-rollback). **Options:** (a) **flag-only, never auto-disable**
— configurable thresholds with defaults; quality signal = task success/failure + answer-mode-pill distribution +
human approval/rejection outcomes; C8 produces the metric, C7 surfaces, a human decides; (b) auto-disable a dead
agent above a hard threshold. **✅ Resolution → (a)** (delegated, accepted rec). Gated by AF-123 (drift accuracy) +
AF-124 (dead-agent signal reliability).

## OD-079 — Specialist roster seeding 🟢 RESOLVED (2026-06-26, C8 session 25)
**Surfaced by:** C8 drafting. **Blocks:** FR-8.REG.006, FR-8.SPC.001. **Why it matters:** the eight specialists +
orchestrator have to exist before any task can route. **Options:** (a) **seed the 8 canonical specialists + the
orchestrator at provisioning** (ADR-005 scripted, mirrors C1 OD-030 seed-then-authoritative), editable/extensible
after; (b) empty registry, operator builds from scratch. **✅ Resolution → (a)** (delegated, accepted rec). Homed in
FR-8.REG.006 (idempotent seed).

## OD-080 — Who may edit the registry / roll back plans 🟢 RESOLVED (2026-06-26, C8 session 25) — **#2, user-delegated**
**Surfaced by:** C8 drafting. **Blocks:** FR-8.REG.001/003/004/005, FR-8.SCO.001/003, FR-8.PLAN.004. **Why it
matters:** an agent's `memory_scope` + `tools_allowed` are **capability grants** — widening them changes what the
agent may see and do (#2). Editing them should be tighter than tuning a description. **Options:** (a) **split by
authority** — `memory_scope`/`tools_allowed`/`enabled` changes = **Super Admin only** (mirrors C4 OD-049
principles-are-tighter); `description`/routing-weight tuning = Super Admin + Admin; mandatory `change_reason` + audit
on every change; (b) Super Admin + Admin for all (like general prompt editing); (c) Super Admin only for everything.
**✅ Resolution → (a)** (delegated, accepted rec). Homed in REG.004 (capability changes flagged) + the permission
notes across REG/SCO/PLAN FRs. *(New permission node implied — wired at OD-137 as `PERM-agents.edit_capability`
(plural "agents") Super-Admin-only vs `PERM-agents.edit_description` Admin-allowed; the singular spelling above was
this OD's original working name, corrected repo-wide by the pre-Phase-6 audit's H9 finding, 2026-07-02.)*

## OD-081 — Per-agent `memory_scope` enforcement wiring 🟢 RESOLVED (2026-06-26, C8 session 25 — change-control to C5+C2) — **#2, surfaced by the C8 gate**
**Surfaced by:** the C8 verification gate (quality finding H1), 2026-06-26. **Blocked `Ready` on:** FR-8.SCO.001,
FR-8.SCO.003, FR-8.ORC.008. **Why it mattered:** C8 defines a per-agent `memory_scope` matrix (the SCO area) and
asserts it is enforced as least-privilege. But the gate traced the only retrieval-into-envelope mechanism — **C5
FR-5.ASM.006**, which invokes the **C2 read flow (FR-2.RET.004)** filtered by *task clearance* + *task entities* —
and found **no per-agent scope filter**: nothing applied "which agent is running" at retrieval. So the Comms Agent's
"semantic for brand guides only" was not actually narrower than the Client Agent's; clearance still held (so
Restricted was safe), but the *agent-level* least-privilege (#2) was unwired. Most acute for the **orchestrator**,
which runs `service_role` (RLS-bypass) and is narrowed *only* by this scope. **Options:** (a) **amend C5 FR-5.ASM.006
+ C2 FR-2.RET.004 (change-control) to accept and apply an agent-scope predicate** alongside clearance + entities; (b)
post-retrieval filter only (weaker — over-fetches then drops, more cost + a brief in-memory exposure); (c) accept
clearance-only, downgrade SCO to advisory (rejected — abandons an agent-level #2 boundary the design intends, L3479).
**✅ Resolution → (a)** (delegated, accepted rec). **Applied this session via change-control** (mirrors C7's in-session
C5 cost-seam fix): **+AC-5.ASM.006.2** (the harness passes the running agent's `memory_scope` into the C2 read flow;
**fails closed** if the predicate can't be applied) and **+AC-2.RET.004.2** (the C2 read flow drops out-of-agent-scope
candidates before ranking — a narrowing *within* clearance, never a widening). Both dated change-control, no prior AC
altered. C8 SCO FRs are now genuinely enforceable, not asserted-only.

---

## OD-082 — Proactive-item persistence (dedicated store vs task_queue) 🟢 RESOLVED (2026-06-27, C9 session 26 — delegated)
**Blocked `Ready` on:** FR-9.MODE.001, FR-9.SUG.001. **Why it mattered:** a proactive suggestion has a lifecycle
(generated → surfaced → acted/dismissed) the team learns from (L3694–3697); if it lived only as a `task_queue` row,
"what was surfaced and what the human did with it" would blur into the execution record, and a generated-but-
undelivered suggestion could be silently lost (#3). **Options:** (a) a dedicated `proactive_suggestions` store
(C9-owned, state-tracked); a Prepare-mode item spawns a linked C5 task; (b) reuse `task_queue` with a "suggestion"
type (rejected — conflates surfacing-audit with execution; muddies dismissal-learning). **✅ Resolution → (a)**
(delegated). Homed in **FR-9.SUG.001** (lifecycle + never-dropped + Prepare→linked-C5-task).

## OD-083 — Proactive mode-assignment + the no-bypass rule 🟢 RESOLVED (2026-06-27, C9 session 26 — delegated) — **#2**
**Blocked `Ready` on:** FR-9.MODE.002, FR-9.MODE.003. **Why it mattered:** "Mode determined by risk level and
approval tier… All proactive actions follow the same guardrails as reactive ones" (L3666). A proactive **Act**
(autonomous, no human) is the highest-leverage place for an unintended action — if proactivity had any bypass of the
C6 pipeline it would violate #2 (never do something it shouldn't). **Options:** (a) C9 **maps** the mode from C6's
risk/tier (FR-6.APR.001) and **every** proactive action — including Act — traverses the identical C6 pipeline
(approval / hard limits / anomaly / injection); no second risk classifier; (b) C9 owns its own proactive risk model
(rejected — a divergent second classifier is exactly the #2 hole). **✅ Resolution → (a)** (delegated; operator
confirmed the no-bypass rule). Homed in **FR-9.MODE.002** (map) + **FR-9.MODE.003** (no-bypass; Act traverses C6).

## OD-084 — Dismissal-learning safety floor 🟢 RESOLVED (2026-06-27, C9 session 26 — delegated) — **#1 / #3**
**Blocked `Ready` on:** FR-9.SUG.005, FR-9.PRO.004, FR-9.SUG.002. **Why it mattered:** "Dismissed suggestions reduce
that signal type over time" (L3696). Naïvely, repeated dismissals could teach the system to go **silent on a genuine
escalating risk** — losing knowledge (#1) and failing silently (#3). **Options:** (a) dismissal down-weights the
signal type *for that context* (tunes volume/ranking), but a derisking / hard-risk class is **floored** — never
silenced — and **re-surfaces** when its underlying metric escalates past threshold (reuses the C1/C2/C5
don't-silently-abandon pattern); (b) uniform decay across all signal types (rejected — silences risk). **✅
Resolution → (a)** (delegated). Homed in **FR-9.SUG.005** (floor + re-surface), **AC-9.PRO.004.2** (escalation
re-surface), **AC-9.SUG.002.1** (no risk-floor item silently dropped at the volume cap). Gated by **AF-128**.

## OD-085 — Cold-start ownership (phase metric vs behaviour matrix) 🟢 RESOLVED (2026-06-27, C9 session 26 — delegated) — **#2 / #3**
**Blocked `Ready` on:** FR-9.CST.001/002/005/006. **Why it mattered:** the cold-start section (L3700–3788) mixes a
**metric** (coverage/Maturity, already C2 FR-2.MAT.002, ADR-002) with a **behaviour matrix** (suppress proactive /
read-only external writes / reduced loops / banner / `[Building]`). Without a clear owner the contract risks either
duplication (C9 recomputing coverage) or a hole (no one guaranteeing "below 50% = no external writes"). **Options:**
(a) **C2 emits the phase** (per-entity); **C9 owns the policy matrix** (the single FR assigning behaviours to phases)
**+ the proactive-suppression behaviour itself**; the other behaviours are enforced by their owners consuming the
phase (external-write → C6/C3/C5, loop freq → C5, `[Building]` → C2, banner/progress → Phase 3) — the C8
failure-mode-assignment pattern; (b) C9 owns + enforces everything (rejected — usurps C2/C3/C5/C6). **✅ Resolution →
(a)** (delegated). Homed in **FR-9.CST.001** (matrix, fail-safe-to-cold), **CST.002** (suppression), **CST.005**
(read-only seam), **CST.006** (loop-freq seam).

## OD-086 — `/` command gating: node-based, not the "Agency Owner" role ladder 🟢 RESOLVED (2026-06-27, C9 session 26 — delegated) — **#2, contradiction caught**
**Blocked `Ready` on:** FR-9.CMD.001/002. **Why it mattered:** the design's command role-gating table (L3907–3912)
gates on roles **Standard User / Agency Owner / Admin / Super Admin** — but **"Agency Owner" is not one of C1's six
locked roles** (FR-1.ROLE.001: Super Admin, Admin, Finance, HR, Account Manager, Standard User). Same class of
contradiction the C7/C8 gates caught with `agents.client_slug` — a design label that contradicts a locked decision.
A hardcoded role ladder also violates ADR-006 (permissions-in-data). **Options:** (a) gate each command on a **C1
permission node**, evaluated against the caller's node set; the four-tier table becomes the **default node
assignment**; "Agency Owner" dissolves into "whoever holds the node"; (b) add an "Agency Owner" role (rejected —
re-opens the locked six-role model + ADR-006). **✅ Resolution → (a)** (delegated). Homed in **FR-9.CMD.002**
(per-command node gating, default-deny, no "Agency Owner" introduced). *(New command-gating nodes to register at the
C1 reconciliation / Phase-2 config: a memory-retire node for `/forget`, the approval node for `/approve` `/reject`,
`PERM-system.tune` for `/tune`, scheduling/trigger nodes for `/schedule` `/trigger`.)*

## OD-087 — Founder-resilience + initialisation guide = operational docs 🟢 RESOLVED (2026-06-27, C9 session 26 — delegated)
**Blocked `Ready` on:** the founder-holiday narrative (L3792–3864) + the init-guide reference (L3786). **Why it
mattered:** these read like a checklist of system features but are explicitly *operational documents*; speccing them
as FRs would invent behaviour. **Options:** (a) **OOS** both — the readiness each item checks is already covered by
existing FRs (memory verification → C2, approval owners → C1/C6, agent Layer-1s → C4, triggers/briefing → C5/C9,
alert thresholds → C7); the eight break-points map to existing components (integration narrative, no orphan); (b)
spec a "founder-readiness" FR (rejected — duplicates existing FRs + encodes an ops doc as system behaviour). **✅
Resolution → (a)** (delegated). Logged **OOS-031** (founder-prep checklist) + **OOS-032** (initialisation guide).

## OD-088 — Configurable action-risk/autonomy matrix (narrow the "all external comms = hard" floor) 🟢 RESOLVED (2026-06-27, C9 session 26 — **operator-decided → option b**) — **#2**
**Surfaced by:** the operator at C9 finalization. **Blocked `Ready` on:** FR-9.MODE.002, **FR-9.MODE.004** (new);
amends **C6 FR-6.APR.002 + FR-6.APR.003**. **Why it mattered:** C6's mandatory-hard set floors **all** external
communications to hard-approval (FR-6.APR.002, L2783–2784). That is too blunt for proactivity — a **cold-lead /
templated nurture email to a non-client contact** is low-risk, but the blanket floor means the system refuses to even
*draft* it autonomously, defeating relationship-management/opportunity proactivity. **Options:** (a) keep the blanket
floor (status quo — too blunt); (b) **split "external comms" into sub-types** — **low-risk external** (cold-lead /
templated nurture to **non-client** contacts) configurable down to Prepare or up to **Act after a trust period**
(rate-capped + audited); **floored** (existing-client / system-of-record comms, anything financial,
Confidential/Restricted) **fixed at hard-approval, never configurable below**. **✅ Resolution → (b)**
(**operator-decided**, the operator's #2 call). **Applied this session via change-control:** **C6 FR-6.APR.002**
narrowed (the mandatory-hard "external" element → existing-client/SoR only; +AC-6.APR.002.3) + **C6 FR-6.APR.003**
reconciled (blanket "external never auto-executes" → "**floored**-external"); **+FR-9.MODE.004** (the matrix + the
non-negotiable floor; `CFG-action_autonomy_matrix`; edits gated `PERM-guardrail.edit_autonomy`, Super-Admin; UI →
Phase 3); **FR-9.MODE.002** "never Act" branch updated to the floored set. **The Act-tier low-risk-external send is
the single bounded, opt-in, trust-gated, rate-capped exception to OD-056's no-irreversible-auto default**, confined
to the non-client low-risk sub-type — **surfaced, not hidden** (the C9 gate confirms no floored sub-type can reach
Act). *(New node implied: `PERM-guardrail.edit_autonomy`, Super-Admin-only — to register at C1 reconciliation /
Phase-2.)* Gated by **AF-068** (containment of the floored set under the new matrix).

> **⚠️ SUPERSEDED IN PART (2026-07-02, OD-161 — pre-Phase-6 audit).** The Act-tier low-risk-external send capability
> described above is **reverted to Prepare-only**: it collided with locked ADR-007's "no config change can override
> a hard limit" text and reproduced exactly the carve-out **OD-047** (one day before this OD) had explicitly
> rejected. `FR-9.MODE.004` no longer has an Act path; `C6 FR-6.APR.002/003`'s narrowing above is reverted to the
> original blanket external-comms floor; `AC-6.APR.002.3` is retired; `act_trust_period_days`/
> `external_act_trust_period` are removed from the config registry. **This annotation is the only edit to this
> entry** — the original text above is left intact as the historical record of what was decided and why; see
> **OD-161** for the full reversal rationale. This reverses an operator-decided call, flagged for the operator's
> awareness.

## OD-089 — Offboarding hard-deletion partial-failure handling 🟢 RESOLVED (2026-06-27, C10 session 27 — delegated) — **#2/#3**
**Surfaced by:** C10 drafting (FR-10.OFF.005). **Why it mattered:** Step 4 deprovisions four systems (Supabase, Railway,
credentials, OAuth tokens); a mid-sequence failure could leave a half-deprovisioned client (orphaned Supabase / live
token) — a security + compliance gap, and if reported "complete" a silent #3 failure. **Options:** (a) each sub-step
idempotent + result-recorded, a failure holds the offboarding in `deletion_failed` + escalation, **never** marked
complete on partial, **no auto-rollback** of a deprovision (can't un-delete — fix forward); (b) best-effort + log.
**✅ Resolution → (a)** (delegated; consistent with OD-010 no-auto-rollback + the escalate-don't-abandon pattern).
Realised in **FR-10.OFF.005**.

## OD-090 — Export integrity as a hard gate before destruction 🟢 RESOLVED (2026-06-27, C10 session 27 — delegated) — **#1**
**Surfaced by:** C10 drafting (FR-10.OFF.002/003). **Why it mattered:** destroying a client's data after a corrupt or
incomplete export is irreversible #1 knowledge loss. **Options:** (a) the export is **verified-complete** (row-count /
checksum reconciliation) **and** **client-acknowledged** (`export_acknowledged_at`) as a **hard gate** — destruction
cannot run without both; (b) generate-and-trust. **✅ Resolution → (a)** (delegated). Realised in **FR-10.OFF.002**
(verify) + **FR-10.OFF.003** (acknowledge) gating **FR-10.OFF.005** (destroy). AF-133 gates export integrity.

## OD-091 — Deployment-freeze enforcement during the retention window 🟢 RESOLVED (2026-06-27, C10 session 27 — delegated) — **#2/#3**
**Surfaced by:** C10 drafting (FR-10.OFF.004). **Why it mattered:** "no new data written, no agents run, no loops
execute" (L4054–4056) is a status *label* with no enforcement consumer — a frozen deployment that keeps running is a
#2/#3 failure (the C8 OD-081 memory-scope class: a rule with no enforcer). **Options:** (a) C10 sets
`client_registry.status = frozen`; the **C5 trigger/queue/loop dispatch layer checks it before any dispatch + fails
closed** (applied via change-control to a C5 AC, mirroring OD-081); (b) leave as a label. **✅ Resolution → (a)**
(delegated). Realised in **FR-10.OFF.004** + the C5 dispatch-gate amendment; **AF-135** gates freeze-propagation
completeness. *(C5 change-control AC to be wired at finalization — see carry-forward.)*

## OD-092 — Individual-erasure name-in-content matching: auto vs human-confirm 🟢 RESOLVED (2026-06-27, C10 session 27 — delegated) — **#1/#2**
**Surfaced by:** C10 drafting (FR-10.DEL.002). **Why it mattered:** the Step-1 "semantic search for the person's name
in content" (L3963–3965) is fuzzy — a false negative leaves PII un-erased (#2 compliance), a false positive
over-deletes legitimate context (#1). **Options:** (a) **deterministic `entity_id` matches auto-action; name-in-content
matches surfaced for human confirmation**, never auto-deleted/redacted; the sweep is recall-oriented + reviewed; (b)
auto-redact all matches. **✅ Resolution → (a)** (delegated). Realised in **FR-10.DEL.002/004**; **AF-134** gates
erasure recall.

## OD-093 — Two-person authorisation: no self-second-authorisation 🟢 RESOLVED (2026-06-27, C10 session 27 — delegated) — **#2**
**Surfaced by:** C10 drafting (FR-10.DEL.006). **Why it mattered:** a two-person gate is meaningless if the executor
can be their own second authoriser. **Options:** (a) the second authoriser must be a **distinct** Admin/Super Admin
(no self-authorisation, mirrors C6 AC-6.APR.005.3); (b) allow same person twice. **✅ Resolution → (a)** (delegated).
Realised in **FR-10.DEL.006**.

## OD-094 — Release-train promotion: manual vs automated 🟢 RESOLVED (2026-06-27, C10 session 27 — delegated) — (process)
**Surfaced by:** C10 drafting (FR-10.DEP.002); ADR-005 §2 left it "operator action (or automated once trust
established)". **✅ Resolution:** **manual operator-initiated promotion in v1**; automated promotion deferred until
trust is established (later config flag). Realised in **FR-10.DEP.002**.

## OD-095 — Version-skew alert threshold defaults 🟢 RESOLVED (2026-06-27, C10 session 27 — delegated) — (process/#3)
**Surfaced by:** C10 drafting (FR-10.DEP.004); ADR-005 §3 said "config-tunable" with no defaults. **✅ Resolution:**
defaults **3 versions behind / 14 days stale**, config-tunable (`deploy_max_version_skew` / `deploy_max_skew_days`).
Realised in **FR-10.DEP.004**.

## OD-096 — `client_slug` in application tables: label-demotion vs deletion 🟢 RESOLVED (2026-06-27, C10 session 27 — delegated, ADR-grounded) — **#2 (isolation)**
**Surfaced by:** C10 drafting FR-10.ISO.001 (homing the ADR-001 §3 invariant). **Why it mattered:** **ADR-001 §3**
(Accepted) says `client_slug` is "**deleted from all application tables**," but prior Approved components reconciled it
only to "**a label, not an RLS key**" (C5 FR-5.QUE.002 lists it in the `task_queue` schema; C2 + C6 `guardrail_log`
similar) — a *partial* reconciliation that removed it as an RLS mechanism but left a descriptive column. The two
readings are in tension, and C10 owns the data-model isolation invariant. **Options:** (a) **delete** — Phase-4 schema
creates no `client_slug` column anywhere; identity lives only in `client_registry` (the literal ADR-001 §3 reading;
the column is never load-bearing — no component uses it for RLS or any filter); (b) keep it as a descriptive label
(softens ADR-001 §3). **✅ Resolution → (a)** (delegated; the ADR is the source of truth, Rule 0). **Reverses no prior
decision** — the "not used for RLS" decision stands; this removes a now-redundant column. Realised in **FR-10.ISO.001**
(+AC-10.ISO.001.3). **Carry-forward (Phase 4):** the schema authoring creates no such column, and C5 FR-5.QUE.002 / C2
/ C6 `guardrail_log` get a one-line clerical reconciliation note then (no behavioural change).

## OD-097 — Alert routing has no owner or destination config 🟢 RESOLVED (2026-06-27, Phase-2 harvest session 28 — delegated) — **#3 (never fail silently)**
**Surfaced by:** Phase-2 config harvest gap-hunt. **Why it matters:** C7 fires alerts and routes them "by role"
(FR-7.ALR.003/005), but the spec **never defines the physical destination** — no Slack webhook URL, no admin channel,
no escalation-contact list, no quiet-hours. An alert with nowhere to go is the observability layer **failing silently
about itself** (#3). This was never specified in Phase 1, so it's a genuine hole, not a harvest miss.
**Options:** (a) **C7 owns a small routing config** — `SLACK_WEBHOOK_URL` (SECRET) + `alert_routing_rules` /
`escalation_contacts` / `quiet_hours` (editable), recipients resolved through C1 roles, **Slack + email both
supported**; (b) deployment-env only, no UI; (c) defer the whole thing to Phase 3.
**✅ Resolution → (a)** (operator delegated, "i trust your recs"). **Two outputs, both DONE:** (1) the config keys are
registered in the Phase-2 registry (`config-registry.md`, group J/N); (2) the *behaviour* — **an alert that cannot be
routed must fail loud, never drop silently** — **realised via change-control in `FR-7.ALR.009`** (session 28,
2026-06-27): C7 owns the routing config; unroutable alert persists + raises an "alert delivery misconfigured"
critical condition on the dashboard + mgmt-plane push; quiet-hours can never silence a critical alert; a config write
that would leave a critical alert with no destination is rejected fail-closed. C7 header count 33→34, ALR ×8→×9.
**Carry-forward CLOSED.**

---

## OD-104 — Missed / never-arriving inbound webhook: detection homing 🟢 RESOLVED (2026-06-28, Phase-3 sign-off — operator delegated "i trust your rec") — **#3 (never fail silently)**

**Why it matters:** C0 authenticates webhooks that *arrive* (FR-0.WHK.*). A webhook that **never arrives**
(provider outage / dropped delivery) is a silent missed-trigger — C0's auth boundary cannot see it. Parked
since session 16 as **OWED-FR-1** with a "confirm the homing at sign-off" note (C0 L819–823); converted to a
tracked OD here so it is not a dangling note. Not C0's concern (auth ≠ liveness).

**Options:**
- **(a)** Home detection to **C3 ingestion** — connector event-gap reconciliation (**FR-3.TRIG.006** periodic
  reconciliation sweep + **FR-3.TRIG.005** watch re-arm) already detects gaps in at-least-once delivery; a
  missed webhook is a special case. **C7** raises the alert.
- **(b)** Home to **C7 observability** — absence-of-signal liveness (AF-118) detects the missing expected trigger.
- **(c)** Home to **C9 proactive** — treat as an "expected-but-absent" pattern.

**✅ Resolution → (a)** (operator delegated). **Verified against the FRs (2026-06-28):** the mechanism already
exists — **no new FR needed.**
- **FR-3.TRIG.005** (watch / subscription re-arm) — proactively re-arms every expiring push subscription and
  treats a failed/missed re-arm as a `degraded` condition surfaced loudly (Google watch family; AC-3.TRIG.005.2).
- **FR-3.TRIG.006** (event-delivery gap detection + reconciliation) — *"detect gaps in at-least-once event
  delivery and reconcile … so dropped, auto-disabled, or late-expired events never become silent knowledge
  loss"*; Slack `conversations.history` sweep from a persisted watermark, Gmail/Drive/Calendar full-sync on a
  history-gap; the detect-then-reconcile pattern is declared **generic**.
- **Alerting** rides **FR-3.DSC.006** (degraded-connector alert) → C7. C0's auth boundary is correctly *not*
  the owner (auth ≠ liveness).

**Build-time caveat (not a spec hole):** TRIG.006's named happy-path arms are Slack + Google; **GHL** is the one
connector not explicitly named (its app webhook is non-expiring, skipped by TRIG.005). When the GHL connector's
incremental sync is built, confirm it provides the TRIG.006 reconciliation read (a GHL watermark re-read) under
the generic pattern. Tracked as a build-time check, not an open spec decision. **OWED-FR-1 (C0) CLOSED.**

---

---

## OD-105…OD-108 — surface-00 (auth) layout/behaviour calls 🟢 RESOLVED (2026-06-29, operator delegated "take all 4 recs")

Surface-local UX/behaviour decisions for `spec/03-surfaces/surface-00-auth.md` (full options + reasoning live
in that file's Open decisions table). All four resolved to the recommendation:

- **OD-105** 🟢 — UI-LOGIN external-admin email+password path is **collapsed behind an "Operator / admin sign-in"
  disclosure**; OAuth shown primary. Client-tenant users are OAuth-only (FR-0.AUTH.002), so a visible password
  form would invite a path they have no account on.
- **OD-106** 🟢 — UI-SUPPORT-REQUESTS queue **pins overdue `pending` requests to top, then newest-first**, with
  status filter chips. Surfaces FR-0.REC.007 "overdue" by default — the #3 expression for this queue.
- **OD-107** 🟢 — UI-2FA-ENROLL issues **no TOTP backup/recovery codes in v1**. The only TOTP accounts are
  external Super Admins, who recover via the deterministic env-change seed re-run (FR-0.SEED.003). Deferral
  logged → **OOS-039** (not a silent omission).
- **OD-108** 🟢 — UI-REAUTH-PROMPT **re-authenticates inline (modal) to preserve page state**, full-page redirect
  only when the OAuth provider forces it (returning to the same route). FR-0.SESS.007 requires preserving page
  state with no data loss; a blanket redirect would discard the in-progress work the FR exists to protect.

---

## OD-109…OD-112 — surface-02 (user & access mgmt) layout/behaviour calls 🟢 RESOLVED (2026-06-30, operator delegated "yes to all")

Surface-local UX/behaviour decisions for `spec/03-surfaces/surface-02-user-mgmt.md` (full options + reasoning
live in that file's Open decisions table). All four resolved to the recommendation:

- **OD-109** 🟢 — The six C1 admin sub-surfaces render as **one tabbed "Users & Access" surface** (Users/Roles/
  Permissions/Clearances/Reviews/Restricted) with per-tab PERM gating, not six separate nav routes. Tightly
  coupled, shared Super-Admin audience; mirrors surface-01's sectioned model. Admins (Users-only) see one tab.
- **OD-110** 🟢 — The permission matrix (~37 nodes × 6+ roles) is a **category-grouped accordion** (the 12
  FR-1.PERM.007 catalog categories), each a node-row × role-column sub-grid with a sticky role header + node
  search — not one flat grid (too wide to scan).
- **OD-111** 🟢 — Clearance review (FR-1.CLR.005) is its **own "Reviews" tab** surfacing due+overdue with an
  escalation banner, not inline badges. The escalate-don't-revoke posture is the surface's sharpest #3
  expression and deserves a countable queue (mirrors surface-00 overdue-pinning).
- **OD-112** 🟢 — A reason on sensitive **non-Restricted** mutations (deactivate, role-delete, clearance-revoke)
  is **optional**, captured to `access_audit` when given; mandatory only for Restricted grants (FR-1.RST.002).
  Consistent with the locked OD-029 (audit every mutation; reason mandatory only for Restricted).

---

---

## OD-113…OD-116 — surface-03 (memory review queues) layout/behaviour + a PERM-node gap 🟢 RESOLVED (2026-06-30, operator: "mint dedicated nodes" + "take all three recs")

Surface-local decisions for `spec/03-surfaces/surface-03-ingestion-queue.md` (full options + reasoning live in
that file's Open decisions table). All four resolved to the recommendation:

- **OD-113** 🟢 — The three human-gated memory queues render as **one tabbed "Memory Review" surface**
  (Ingestion / Conflicts / Consolidation) with per-tab PERM gating, not three separate nav routes. All three
  gate the memory write path, share a Super-Admin/Admin-reviewer audience; mirrors surface-02's tabbed model.
- **OD-114** 🟢 — The trust-window auto-drop audit (FR-2.ING.001 / OD-036 — what Filter 1 is discarding) renders
  as a **read-only toggle/secondary view inside the Ingestion tab**, not a 4th tab. It's a lower-traffic audit of
  the same source stream, not an action queue; promote to its own tab only if trust-window volume warrants.
- **OD-115** 🟢 — **#2 gating.** The Conflicts + Consolidation review queues had **no dedicated PERM node** in
  the C2 FRs (FR-2.WRT.002 named only "writer"; FR-2.MNT.014 named only "cleared role + `PERM-memory.*`") — a
  real Rule-0 gap surfaced by the surface-03 draft. Resolved by **minting two new nodes via change-control**,
  homed under the **Memory Access** category (FR-1.PERM.007), recorded here per FR-1.PERM.005's "updated whenever
  a new gate is added" discipline (an *addition*, not an ADR supersede — the catalog is designed to grow):
  - **`PERM-memory.review_conflict`** — *Description:* resolve a quarantined hard-conflict write (keep-new /
    keep-existing / keep-both-with-note) on the surface-03 Conflicts queue. *Default roles:* Super Admin + Admin.
    *Scope:* deployment-wide; viewing a Personal/Restricted memory in a conflict additionally requires the matching
    sensitivity clearance. *Added-in:* surface-03 (2026-06-30).
  - **`PERM-memory.approve_consolidation`** — *Description:* approve/reject a Personal-tier merge or
    episodic→semantic summarise held for human approval (FR-2.MNT.014) on the surface-03 Consolidation queue.
    *Default roles:* Super Admin only. *Scope:* deployment-wide; **requires Personal clearance** (the queue is
    Personal-tier by definition). *Added-in:* surface-03 (2026-06-30).
  - **Build obligation:** both must appear in `PERMISSION_NODES.md` (build artifact, FR-1.PERM.005) with these
    four fields when that catalog is materialised; both default-deny (FR-1.PERM.002).
- **OD-116** 🟢 — At **Include**, the reviewer **confirms/assigns the sensitivity tier** (pre-filled with Filter
  2's suggestion, overridable, the override audited) — FR-2.ING.003 defines Include as "assign sensitivity +
  proceed," so the human owns the tier; an under-classification is a #2 risk worth a logged human decision.

---

## OD-117…OD-120 — surface-04 (agent action approval queue) layout/behaviour + a PERM-node gap 🟢 RESOLVED (2026-06-30, operator delegated "what do you recommend" → all recommendations taken)

- **OD-117** 🟢 — **#2 gating, Rule-0 gap.** The agent-action approval queue had **no dedicated PERM node** in the
  C5/C6/C7 FRs for *deciding* a held item: FR-5.QUE.005 said only "a human approves," FR-6.APR.005 routed to a
  "reviewer role," FR-6.ESC.003 said "human resolutions" — none cited a node, and `PERM-guardrail.edit_autonomy`
  gates editing the autonomy **config**, not deciding a queue item. A real Rule-0 gap (the OD-115 situation again,
  surfaced by the surface-04 draft). Resolved by **minting one new node via change-control**, homed under the
  **existing "Approval Authority" category** (FR-1.PERM.007's fixed twelve — a node *added within* that category,
  the natural home for authority over approving agent actions; **not** a new category, which would conflict with the
  fixed-12 set), recorded here per FR-1.PERM.005's "updated whenever a new gate is added" discipline (an *addition*,
  not an ADR supersede):
  - **`PERM-action.review`** — *Description:* enter the surface-04 approval queue and Approve / Reject / Modify a
    held agent action (a `task_queue` item in `awaiting_approval` or `flagged`). *Default roles:* Super Admin +
    Admin (the default reviewers + escalation terminus); Finance and Account Manager **only when granted** and
    only for items routed to their role (FR-6.APR.005 contextual routing — financial → finance, CRM → account
    manager). *Scope:* deployment-wide; **per-item authority is further narrowed at the item** by (1) contextual
    routing or fallback (FR-6.APR.005), (2) **no-self-approval** — the caller's identity ≠ the item's
    `originating_user_id` (AC-6.APR.005.3), and (3) the matching **sensitivity clearance** for any
    Confidential/Personal/Restricted-touching action (Restricted routes to grantee/Super-Admin, AC-6.APR.002.2).
    Injection-type holds default-route to Super Admin/Admin. *Added-in:* surface-04 (2026-06-30).
  - **Build obligation:** must appear in `PERMISSION_NODES.md` (build artifact, FR-1.PERM.005) with these four
    fields when that catalog is materialised; default-deny (FR-1.PERM.002).
- **OD-118** 🟢 — The held items render as **one live queue with filter chips** (All / Approvals / Safety holds /
  Overdue) + a per-item type-tier badge, **not** two tabs. The resolution model (Approve/Reject/Modify), the
  escalation model, and the Realtime transport are identical across `awaiting_approval` and `flagged`, so a single
  queue keeps the live count + connection singular; filters give the split without fragmenting the live socket.
- **OD-119** 🟢 — **Modify** exposes a **structured editor of the action's declared editable params only**; on save
  the task **requeues and re-enters the full guardrail gate** (re-classifies tier — an edit that raises risk can
  re-floor it). FR-6.ESC.003 names Modify explicitly and AC-5.ASM.004.2 already requires a late-surfacing
  consequential change to re-enter the gate; constraining the editor + forcing re-classification means a Modify can
  never downgrade a tier or smuggle an action past the gate (#2).
- **OD-120** 🟢 — **#2.** A reviewer **may freeze a reversible soft item's auto-run countdown** via a **Hold for full
  review** affordance that promotes the soft item to require explicit approval (stops the `approval_soft_timeout`
  auto-run). A one-directional tightening (soft→explicit only; never hard→soft). **Applied via change-control to C6
  FR-6.APR.003** as **AC-6.APR.003.3** — an action must not auto-run while a human is mid-review of it.

---

## OD-121…OD-124 — surface-05 (operations dashboard) gating / layout / a config gap / scope 🟢 RESOLVED (2026-06-30, operator "yes" → all four recommendations taken)

- **OD-121** 🟢 — **#2 gating, per-panel role-scoping.** FR-7.VIEW.002 / AC-7.VIEW.002.1 require the ops dashboard to be
  role-scoped ("a role sees only the panels its permissions allow") but the C7 FRs give **no panel→PERM-node map**.
  Resolved by binding to **existing C1 PERM categories** (FR-1.PERM.007 — Dashboard Access · Observability · Compliance ·
  System Functions · Tool Access): **entry** via a **Dashboard Access (ops)** node (Super Admin + Admin full; Finance →
  Cost panel only; HR/Account Manager/Standard User hidden by default); **export** (Event-Log / Guardrail-Log,
  FR-7.LOG.007 / FR-6.LOG.004) via `PERM-compliance.download_records`; **DLQ requeue/discard** + **connector re-auth** via
  System-Functions / Tool-Access nodes. **No new category, no node mint, no ADR supersede** (unlike surface-03 OD-115 /
  surface-04 OD-117, which minted nodes because no category fit) — here the categories already exist; exact node ids
  **materialise in `PERMISSION_NODES.md`** at build (FR-1.PERM.005). A build-artifact enumeration, not a new decision;
  **C1 catalog unchanged, no FR re-approval.** Panel×role table recorded in `surface-05-dashboard-ops.md` (Access + OD-121).
- **OD-122** 🟢 — **Layout.** The ops dashboard is a **single-scroll, sectioned** surface with a **sticky health-summary
  strip** + anchor nav + collapsible, **independently-polled** panels — not tabbed. A monitoring glass is read as a whole;
  tabs hide a degrading panel behind an unselected tab (a #3 risk — the failure you don't see). Independent per-panel poll
  + per-panel error/stale states keep one failed panel from taking down the dashboard.
- **OD-123** 🟢 — **#3, Rule-0 config gap (change-control).** C5 **AC-5.JOB.006.2** mandates an escalating signal when a
  DLQ entry sits "**beyond a configurable age**," but the config registry had **no key** for that age
  (`max_retries_before_dead_letter`=3 is the *retry* cap, not the staleness age) — the loud-condition's threshold was
  unspecified (same shape as OD-097). **Resolved: minted `dlq_stale_alert_hours`** (default **24 h**, **LIVE**, §H
  `#loops`, `PERM-config.loops`) **via change-control to `config-registry.md`** (logged in its Status section). Satisfies
  the existing AC; **no FR re-approval** (an FR's AC already assumed the knob). Adds one registry row.
- **OD-124** 🟢 — **Scope seam.** surface-05 is **strictly single-deployment**; it renders **no** cross-deployment /
  management-plane signal (FR-7.MGM.001–005). The fleet grid + cross-deployment cost/health/CI-CD is **exclusively
  surface-06** (the Super Admin management-plane surface). Matches ADR-001 §3 isolation (no `client_slug`, no cross-silo
  data on a per-deployment surface) and the Phase-3 surface split. A Super Admin on surface-05 sees only the local
  deployment; they reach the fleet via surface-06.

---

## OD-125…OD-128 — surface-06 (Super Admin management plane / fleet) gating / layout / offboarding-UI / provisioning-scope 🟢 RESOLVED (2026-06-30, operator "take all four recommendations")

- **OD-125** 🔑 🟢 — **#2 gating, Rule-0 PERM gap (change-control mint).** The C7/C10 FRs name the **operator / Super
  Admin** as the holder of every fleet action *in prose* (FR-10.PRV.001 provisioning, FR-10.DEP.002 promotion,
  FR-10.OFF.* offboarding, FR-10.MGT.004 token rotation) but bind **no `PERM-` node** to any of them, and **no node
  gated the fleet view itself** — a gate with no catalog entry is a build-time #3 defect (PERMISSION_NODES.md rule).
  `PERM-config.infra`/`.observability` gate *editing the thresholds* the fleet consumes, not viewing/acting on the
  fleet. **Resolved: minted five management-plane nodes via change-control**, scope = **`management-plane`** (the
  operator's separate Super Admin deployment, ADR-001 §7 — a scope *beyond* intra-client), all **Super Admin only /
  never delegable**:
  - `PERM-fleet.view` — Description: enter the fleet console (deployment health grid + read-only cross-deployment
    panels). · Default roles: Super Admin (never delegable). · Scope: management-plane. · Added-in: surface-06.
  - `PERM-fleet.provision` — Description: run/track the provisioning flow + register a new client (FR-10.PRV.001). ·
    Default roles: Super Admin (never delegable). · Scope: management-plane. · Added-in: surface-06.
  - `PERM-fleet.promote_release` — Description: promote a release (canary→main) + roll back (FR-10.DEP.002/003). ·
    Default roles: Super Admin (never delegable). · Scope: management-plane. · Added-in: surface-06.
  - `PERM-fleet.offboard` — Description: initiate + execute client offboarding (FR-10.OFF.*); **the hard-delete step
    additionally requires two-person auth — a distinct second `PERM-fleet.offboard` holder, no self-second**
    (AC-10.DEL.006). · Default roles: Super Admin (never delegable). · Scope: management-plane. · Added-in: surface-06.
  - `PERM-fleet.rotate_token` — Description: rotate a deployment's `internal_token` (FR-10.MGT.004). · Default roles:
    Super Admin (never delegable). · Scope: management-plane. · Added-in: surface-06.
  **Click-through into a client is NOT a management-plane node** — it is logging into that client's own dashboard under
  *that client's* RBAC (FR-10.MGT.003.2). **Transcribed into `PERMISSION_NODES.md` immediately** (per that file's
  add-on-ship rule) — a new "Management Plane" section + a new `management-plane` Scope value; catalog count 37→42.
  Mirrors surface-03 OD-115 / surface-04 OD-117 (mint via change-control when no existing node fits). **C1 catalog grows;
  no FR re-approval, no ADR supersede.** *(Side-finding logged: OD-115's two nodes + OD-117's one node were defined here
  but never transcribed to the catalog — flagged as owed in `PERMISSION_NODES.md`, not silently left.)*
- **OD-126** 🟢 — **Layout.** Fleet-grid **landing** + section nav (Alerts · Releases & CI/CD · Migrations ·
  Provisioning · Cost · Backup · Registry & Offboarding) + a **per-deployment detail drawer** (with the "Open client
  dashboard ↗" click-through). The two always-loud conditions (alert-delivery-misconfigured AC-7.ALR.009.1,
  alert-engine-stalled AC-7.ALR.008.2) pin above any section. Not a flat single-scroll (the grid deserves to be home)
  and not fully tabbed (the critical banners must never hide behind an unselected tab — #3).
- **OD-127** 🟢 — **Offboarding workflow UI (behaviour).** The destructive offboarding is a **guarded multi-step wizard**
  on this surface — Initiate → Export (verified-complete + client sign-off gate) → Freeze (retention countdown,
  reactivation possible) → Hard-delete (**inline two-person auth, distinct second approver, no self-second**) →
  Meta-record — each transition exposing its #1 gate (AC-10.OFF.002.4 export-verified-before-delete, AC-10.OFF.003.3
  sign-off-before-retention, AC-10.DEL.006 two-person, AC-10.OFF.005.4 server-driven/resumable). Makes the C10 gates
  *visible + UI-enforced* rather than relying on operator memory; not a single "Offboard" button.
- **OD-128** 🟢 — **Provisioning launch vs track (scope).** v1 = **track + guided checklist**: the surface shows
  provisioning status (`client_registry` `initialising`→`active`), per-step results, and the onboarding runbook, with a
  "Provision new client" entry that launches the **guided flow**; the **token-minting / Railway-secret-setting steps
  remain the operator-run script** (FR-10.PRV.001 "scripted, operator-run"), surfaced **loud on partial failure**. Full
  one-click web provisioning (which would webify the product's most privileged secret-handling) is a **v2** consideration.

---

## OD-129…OD-132 — surface-07 (agency / manager dashboard + notification centre) PERM-gap / layout / notification-scope / suggestion-actions 🟢 RESOLVED (2026-07-01, operator "take all four recommendations")

- **OD-129** 🔑 🟢 — **Rule-0 PERM gap (change-control mint).** FR-1.PERM.007 **homes** the twelve design-doc
  permission categories — including **Dashboard Access** — but **no concrete `PERM-dashboard.*` node id was ever
  catalogued** in `PERMISSION_NODES.md`. surface-05 (signed off) already **references** a Dashboard-Access "ops" node
  (working name `PERM-dashboard.view_ops`) that did not exist in the catalog — an owed gate, the same drift the catalog
  flags for surface-03/04. A gate with no catalog entry is a build-time #3 defect. **Resolved: minted the concrete
  Dashboard Access node family via change-control**, scope = **intra-client** (these are per-deployment dashboard
  views, not management-plane), under the **already-homed** FR-1.PERM.007 "Dashboard Access" category (no new category,
  no ADR supersede — mirrors surface-04 OD-117's mint under "Approval Authority"):
  - `PERM-dashboard.overview` — Description: enter the agency / management overview dashboard (surface-07 — activity
    feed + at-a-glance rollup + proactive-suggestions panel). · Default roles: Super Admin, Admin, Account Manager. ·
    Scope: intra-client. · Added-in: surface-07.
  - `PERM-dashboard.ops` — Description: enter the technical operations dashboard (surface-05). **Canonicalises
    surface-05's working name `PERM-dashboard.view_ops`** (surface-05's reference updated in lockstep). · Default
    roles: Super Admin, Admin (+ Finance scoped to the Cost panel, surface-05 OD-121). · Scope: intra-client. ·
    Added-in: surface-05 (referenced) / surface-07 (formalised).
  **The notification centre is NOT a node** — it is **cross-cutting chrome available to any holder of any Dashboard
  Access node** (`PERM-dashboard.overview` / `PERM-dashboard.ops` / surface-08's standard-user node), **clearance-scoped
  per viewer** (AC-7.VIEW.002.1 / FR-9.SUG.004) — FR-7.ALR.001 ("accessible from every view") mandates it ride every
  dashboard rather than gate behind one surface. **Alert-routing config edits** stay surface-01 #observability
  (`PERM-config.observability`). All nodes default-deny (OD-030). **Transcribed into `PERMISSION_NODES.md` immediately**
  (new "Dashboard Access" section; catalog count 42→44). **C1 catalog grows; no FR re-approval, no ADR supersede.**
- **OD-130** 🟢 — **Layout.** A **persistent notification-centre affordance (bell + slide-over) as cross-cutting chrome**
  + a sectioned main agency view (At-a-Glance · Activity Feed · Proactive Suggestions). The bell carries the
  live/reconnecting/polling indicator (FR-7.RTP.004); the two always-loud banners (alert-delivery-misconfigured
  AC-7.ALR.009.1, alert-engine-stalled AC-7.ALR.008.2) pin above any section. Not fully tabbed (would hide the unread
  count + break "accessible from every view"); not a fixed side-column (wastes space on the technical dashboards).
- **OD-131** 🟢 — **Notification-centre scope (behaviour).** The notification centre is **cross-cutting chrome,
  home-specced here** — rendered on **every** dashboard (surface-05/07/08), available to any holder of any Dashboard
  Access node, **clearance-scoped per viewer**. FR-7.ALR.001 is explicit ("primary, persistent, accessible from every
  view"); gating it to surface-07 alone would leave a Standard User on surface-08 with no way to receive a notification.
- **OD-132** 🟢 — **Proactive-suggestion actions (behaviour).** **Every "act" routes through the identical C6 approval
  path** (FR-9.MODE.003) — a held action lands in surface-04; a reversible Act-mode item may auto-run *per C6*, never
  bypassing the guardrail; floored rows (client/financial/Restricted comms) never auto-act (FR-9.MODE.002). The
  **dismissal safety floor** (FR-9.SUG.005 / AC-9.PRO.004.2/.4) is preserved: a floored/de-risking item re-delivers
  while its metric stays past threshold — dismissal-learning never silences a safety-critical suggestion. Inline
  execution (a back-door around C6) rejected as a #2 violation.

---

## OD-133…OD-136 — surface-08 (Standard User dashboard: chat · My Queue · activity feed) PERM-gap / layout / chat-mechanics / suggestion-placement 🟢 RESOLVED (2026-07-01, operator "Cool do it" — recommendations delegated)

- **OD-133** 🔑 🟢 — **Rule-0 PERM gap (change-control mint), anticipated by surface-07.** OD-129 minted the Dashboard
  Access node family (`PERM-dashboard.overview`, `PERM-dashboard.ops`) and **explicitly named a third, not-yet-minted
  "surface-08's standard-user node"** as a holder of the cross-cutting notification centre. surface-08 mints it:
  **`PERM-dashboard.workspace`** — enter the personal user workspace (chat + My Queue + my activity feed + my
  suggestions). Scope = **intra-client**, under the **already-homed** FR-1.PERM.007 "Dashboard Access" category (no new
  category, no ADR supersede — mirrors OD-129 / OD-117 / OD-125):
  - `PERM-dashboard.workspace` — Description: enter the personal user workspace (chat + My Queue + my activity feed + my
    proactive suggestions; surface-08). · **Default roles: all six** (Super Admin, Admin, Finance, HR, Account Manager,
    Standard User) — every authenticated user has a personal workspace/chat. · Scope: intra-client. · Added-in:
    surface-08.
  Per-action authority inside stays finer than entry: **each `/` command is gated on its own C1 node** (FR-9.CMD.002),
  My-Queue decisions route to surface-04 (`PERM-action.review`), and acting on a suggestion is gated by the action's C6
  tier + clearance (FR-9.MODE.003). The **notification centre stays node-free** (OD-131, clearance-scoped). All nodes
  default-deny (OD-030). **Transcribed into `PERMISSION_NODES.md` immediately** (Dashboard Access family; catalog count
  44→45). **C1 catalog grows; no FR re-approval, no ADR supersede.**
- **OD-134** 🟢 — **Layout.** A **chat-led main view + adjacent collapsible panels** (My Queue · Activity Feed ·
  Proactive Suggestions) + the persistent cross-cutting notification bell (with the live/reconnecting/polling indicator,
  FR-7.RTP.004) + the two always-loud banners (alert-delivery-misconfigured AC-7.ALR.009.1, alert-engine-stalled
  AC-7.ALR.008.2) pinned above any section. The chat is the Standard User's primary tool (design-doc L3261), so it earns
  the centre; not fully tabbed (would bury the queue/suggestions); not a flat scroll (would demote the chat). Consistent
  with surface-07 OD-130.
- **OD-135** 🟢 — **Chat thread — persistence + async-result return path (behaviour + Phase-4 data).** The spec defines
  **no `chat_messages`/`conversations` store** today and FR-7.RTP.001 caps Realtime at exactly two surfaces (approval
  queue + notification centre). Resolved: **persist the thread** (a **net-new Phase-4 `conversations`+`messages` store**,
  RLS-scoped, no `client_slug`) so a user's interaction history survives reload (#1 — losing it is a violation);
  **async task results return on poll** (`task_queue` status) **+ a notification-centre nudge** — **no third Realtime
  socket** (honours FR-7.RTP.001 / AC-7.RTP.001.3). Synchronous commands (FR-9.CMD.008) already return inline with no
  `task_queue` row — their record is the message store + the `event_log` audit entry (FR-9.CMD.004). The chat store is
  **flagged as a net-new Phase-4 schema obligation owed to C5/C9** — surfaced here, not invented as an FR (Rule 0).
- **OD-136** 🟢 — **Proactive-suggestion placement (UX).** **All three delivery surfaces** (FR-9.SUG.004 names dashboard
  + chat + push): a dedicated **Suggestions panel (Section E)** for act/dismiss + the notification-centre nudge + the
  option to surface inline in chat. The dismissal **safety floor** (FR-9.SUG.005 / AC-9.SUG.005.2/.3) holds on every
  surface — a floored de-risking item re-delivers while its metric stays past threshold; **every "act" routes through
  the C6 guardrail** (FR-9.MODE.003). Cold-start suppression (FR-9.CST.002) shows the labelled "learning" state, never an
  empty panel.

---

## OD-137…OD-140 — surface-09 (Agent Fleet / Agent Builder / Orchestration) PERM-gap / layout / edit-gating / hard-limit-presentation 🟢 RESOLVED (2026-07-01, surface-local; recommendations delegated)

- **OD-137** 🔑 🟢 — **Rule-0 PERM gap (change-control mint).** The agent fleet/builder needs an entry + edit authority
  model. FR-1.PERM.007's **Asset Management** category names the design-doc seed row **"Create / edit agents" (Super Admin
  + Admin, L509–615)**, but **no concrete `PERM-agents.*` node was ever catalogued** (the catalog had no Asset Management
  section). The locked **OD-080 (C8)** further splits that coarse row into two authority tiers. Resolved: **mint the
  `PERM-agents.*` family via change-control** under the **already-homed** Asset Management category (no new category, no
  ADR supersede — mirrors OD-117/OD-125/OD-129/OD-133), scope **intra-client**, encoding OD-080 exactly:
  - **`PERM-agents.view`** — enter the fleet/builder; view registry/definitions/version-history/routing-readout/health-badges. **Default: Super Admin, Admin.**
  - **`PERM-agents.edit_description`** — edit `description` / `max_tokens` / per-agent tuning; roll back a plan version (PLAN.004 "task graphs"). **Default: Super Admin, Admin** (OD-080 description/tuning tier).
  - **`PERM-agents.edit_capability`** — edit `memory_scope` / `tools_allowed` / `enabled`; add / disable an agent. **Default: Super Admin only** (OD-080 capability tier — *tighter* than the design-doc's coarse SA+Admin, an authority decision, #2).

  Config *knobs* (section K) stay on `PERM-config.agents` (surface-01); Layer-1 prompt content stays on `PERM-prompt.*`
  (C4). **Transcribed into `PERMISSION_NODES.md` immediately** (new Asset Management section; catalog 45→48). C1 catalog
  grows; no FR re-approval.
- **OD-138** 🟢 — **Layout.** Fleet-grid landing + per-agent Builder drawer (with a Version History tab) + an
  Orchestration section via section nav (not fully tabbed, which separates an agent from its history/edit; not a single
  scroll, which buries orchestration config). Consistent with surface-06's grid-landing + detail-drawer (OD-126).
- **OD-139** 🟢 — **Edit gating + change-reason UX.** One Builder, **inline split**: capability fields (scope/tools/
  enabled) render **read-only/locked for an Admin** with a "Super-Admin-only" affordance (transparency over hiding, #3);
  description/tuning fields editable per tier; **every Save opens a mandatory `change_reason` modal** (REG.004 — no version
  without a reason, AC-8.REG.004.1); capability saves flagged as authority changes (OD-080).
- **OD-140** 🟢 — **Hard-limit invariant presentation.** **Show + explain + block:** a forbidden tool appears in the
  picker **greyed with an inline reason** ("Comms Agent can never hold an autonomous-send tool — hard limit, ADR-007"),
  and any attempt to grant it is **rejected at write** with the reason logged (AC-8.SPC.003.3 / .004.3 / .005.2) — the
  Builder's defense-in-depth layer alongside the missing tool (C3) + the code enforcement (C6). Surfacing the constraint
  with its reason is the #3-honest choice; hiding it reads as a bug, allowing-with-warning drops a safety layer (#2).

---

## OD-141…OD-144 — surface-10 (Custom Command Management, `UI-COMMANDS`) layout / invocation-node authority / destructiveness / system-command reference 🟢 RESOLVED (2026-07-01, surface-local; recommendations delegated)

- **OD-141** 🟢 — **Layout.** Custom-command **list landing + Command Builder drawer** (opens over the list, keeps context)
  **+ a collapsible read-only System-Command Reference section** via section nav — not two symmetric tabs (which would
  imply system commands are editable here; they are code-registered, read-only), not a single scroll (which buries the
  reference). Consistent with surface-09's list-landing + detail-drawer (OD-138) and surface-06 (OD-126).
- **OD-142** 🔑 🟢 — **#2 least-privilege on the invocation gate (pushed to the FR layer via change-control).** When an
  admin defines a custom command, the invocation PERM node (FR-9.CMD.002) is **chosen from the existing C1 catalog** — **no
  node is minted per command** (the clean case; `PERM-commands.manage` already gates *managing*). But the FR text alone
  (default-deny unmapped node, AC-9.CMD.002.3) did **not** stop a manager from gating a powerful custom command on a
  broadly-held node to **widen its audience past their own authority** over the wrapped agent/capability — a #2 surface-area
  gap (bounded by the invocation's C6 pipeline + the agent's scope/clearance, but real). Resolved: **the manager may only
  assign a node they are authorized to assign; a save that would widen a capability past that is rejected at write.**
  **Pushed into C9 via change-control as AC-9.CMD.006.4** (so the constraint lives in the requirement layer, not only the
  surface — mirrors surface-04 OD-120→AC-6.APR.003.3). No node mint; no FR re-approval (AC addition tightening an Approved FR).
- **OD-143** 🔑 🟢 — **#2 containment: destructiveness/tier (pushed to the FR layer via change-control).** A custom
  command's destructiveness/approval is **governed by the underlying action's C6 tier, not a definition-time flag the
  author can clear** — every invocation runs the **same C6 guardrail pipeline** as any agent run (FR-9.CMD.008), so the
  action's tier governs execution regardless of the definition (mirrors AC-9.CMD.003.2 — the UI confirm is never the sole
  barrier). The author may **add** friction (a UI confirm) but never **remove** a guardrail. **Pushed into C9 via
  change-control as AC-9.CMD.008.4.**
  **Amended (2026-07-02, OD-165 — pre-Phase-6 audit, Dim6-H47):** the mechanism this OD assumed (an existing hold
  point the C6 tier could route into) didn't actually exist for custom-command dispatch — AC-9.CMD.008.3 said no
  `task_queue` entry was ever created, so a floored/hard-approval result had nowhere to land. **OD-165** resolved
  this: a custom-command dispatch now creates/reuses a `task_queue` row like any other agent action, and
  AC-9.CMD.008.4 is restated to say the created row "carries the wrapped action's real C6 tier." This OD's
  substance (tier governs, author can't clear it) is unchanged — OD-165 just supplies the enforcement mechanism
  this OD's own AC-9.CMD.008.4 didn't specify.
- **OD-144** 🟢 — **System-command reference presentation.** A **read-only reference list grouped by home component**,
  each system command with its default node + destructive flag + reserved-slug badge — visible so an admin sees the
  reserved namespace and can't collide blindly (proactive complement to the authoritative save-time check,
  AC-9.CMD.006.2). Not hidden (which turns every collision into a surprise rejection), not editable here (system commands
  are code-registered, not data — editing them here would fork code and data, a #3/#1 risk; `/tune` *values* live on
  surface-01).

**No PERM node minted** — `PERM-commands.manage` + `PERM-system.tune` already catalogued (C9 section, `PERMISSION_NODES.md`
L89–90). Two C9 change-control AC additions (AC-9.CMD.006.4, AC-9.CMD.008.4); one NET-NEW Phase-4 store flagged (`commands`,
owed to C9/C5).

---

## OD-145…OD-148 — surface-11 (Memory Navigation / Entity Browser, `UI-MEMORY-NAV`) read-authority / layout / config-ownership / sole-writer-edit 🟢 RESOLVED (2026-07-01, surface-local; recommendations delegated)

- **OD-145** 🔑 🟢 — **#2 read authority (clean case — no node minted).** Does a memory browser need a new
  `PERM-memory.view`/`.browse` entry node, or is memory *read* governed by the existing clearance model? Resolved: **no new
  node — entry is any authenticated user; the row-level clearance/visibility/Restricted RLS (FR-2.RET.004 / FR-1.RLS.003)
  is the gate**, showing each user exactly the cleared subset their retrieval would surface (Restricted never auto-shown,
  RST.003). Memory *read* authority **is** the C1 clearance model everywhere else (retrieval is clearance-scoped, not
  node-gated); a browse node would make this the *only* node-gated memory-read path — an inconsistency that would either
  over-gate (hiding a user's own cleared business knowledge) or be redundant. Every **mutation** stays node-gated
  (`PERM-memory.write` writer-routed / `PERM-memory.delete`); conflict/consolidation decisions route to surface-03. Like
  surface-10, a clean no-mint case.
- **OD-146** 🟢 — **Layout.** Entity Browser grid/list **landing + per-entity detail drawer + a Memory Detail view within
  it + a persistent Memory Search bar** (dual keyword+vector) in the header. Not fully tabbed (separates a memory from its
  entity), not a single scroll (buries search + detail). Consistent with surface-06/09 grid-landing + detail-drawer
  (OD-126/OD-138).
- **OD-147** 🟢 — **Entity-type + expected-slot config ownership.** The config *values* (entity-type list FR-2.ENT.002,
  expected slots FR-2.MAT.001) live in the config registry, **edited on surface-01 (`PERM-config.*`)**; surface-11
  **reflects them read-only and links out** — keeping surface-11 a *browser*, not a config editor (DRY, single config
  home, no split authority).
- **OD-148** 🔑 🟢 — **#2/#1 sole-writer edit model.** Given ADR-004 (the Memory Agent is the sole writer), a cleared user
  "corrects" a memory as follows: **read-first — a verify/flag is a logged feedback signal (FR-2.MNT.016); a content/tier
  correction is an authorized request (`PERM-memory.write`) that routes *through* the sole-writer validate-and-commit
  (per-entity lock + contradiction check, FR-2.WRT.006), never a direct `UPDATE`.** A direct row edit would break the
  invariant that protects knowledge integrity; no-edit-at-all would drop the mandated human-correction loop.

**No PERM entry node minted** (OD-145 clean case). **Catalog housekeeping this session (separate from surface-11's ODs):**
the 3 long-owed nodes — `PERM-memory.review_conflict` + `PERM-memory.approve_consolidation` (surface-03 / OD-115) +
`PERM-action.review` (surface-04 / OD-117) — **transcribed into `PERMISSION_NODES.md`** (count 48→51), closing the standing
dangling-ID debt flagged in that file since surfaces 03/04. One NET-NEW Phase-4 read binding note (`DATA-memories` /
`DATA-entities` clearance-scoped browse); one C2 stale cross-ref corrected (FR-2.ENT.005 L219: MNT.011→**MNT.010**).

---

## OD-149…OD-152 — surface-12 (Mobile View, `UI-MOBILE-*`) sub-surface decomposition / delivery platform / navigation / out-of-scope-on-mobile 🟢 RESOLVED (2026-07-01, surface-local; recommendations delegated)

- **OD-149** 🔑 🟢 — **Sub-surface decomposition.** How many mobile sub-surfaces, and are push / the command menu their
  own? Resolved: **six sub-surfaces = the design-doc's five named screens** (Home / Approvals / Activity feed / Chat /
  Alerts, `design-doc-v4.md` L3266–3284) **+ the tap-optimised command menu** (its own FR-9.CMD.005 / L3915). **Push
  notifications** (FR-7.VIEW.003) is a **cross-cutting delivery contract**, specced as a section governing all six, **not**
  a seventh screen. Faithful to the design-doc's own list; the command menu earns sub-surface status because it carries its
  own FR + is referenced as its own surface by surface-08/10.
- **OD-150** 🟢 — **Delivery platform.** Native app vs responsive PWA vs plain responsive web (affects push delivery).
  Resolved: **responsive web + PWA with web-push for v1** (installable; same auth / RLS / deployment — no separate app to
  provision per silo); a **native wrapper is deferred → OOS-040**. The routing contract (FR-7.VIEW.003) is
  platform-agnostic; the delivery *mechanism* (web-push / APNs / FCM) is a build detail flagged **paper-vs-proven** (a
  Phase-5 AF `push-delivery-reliability` recommended, not minted in Phase 3 — no Phase-3 FR rests on it; the surface fails
  safe to the persisted in-app notification centre, FR-7.ALR.006).
- **OD-151** 🟢 — **Navigation pattern.** Resolved: **fixed bottom tab bar** (Home / Approvals / Chat / Activity / Alerts)
  + persistent notification bell + the honest Live/Reconnecting/Polling indicator (FR-7.RTP.004) in the top bar + the two
  protective banners (alert-engine-stalled AC-7.ALR.008.2, unroutable-alert AC-7.ALR.009.1) pinned above content. The
  command menu is an in-chat sheet, not a tab. Push-frequency settings under a Settings sheet (read-only reflection of the
  surface-01 config). One-handed operation is the design target (L3284).
- **OD-152** 🟢 — **Out-of-scope-on-mobile boundary.** Which desktop actions degrade to "open on a wider display."
  Resolved: the **deep-management set** already named across surfaces 01/02/03/04/06/09/10/11 (config edit,
  permission-matrix edit, conflict/consolidation resolution, approval **Modify**, fleet actions, agent-capability edit +
  plan rollback, custom-command authoring, memory mutation) degrades to a **notice** (never a silent omission — the user is
  told the action lives on desktop). The low-risk retained writes (Approve/Reject, agent/command **disable**, verify/flag
  feedback, mark-actioned) stay — each runs the **identical** C6 pipeline + node gate as desktop (no #2 back-door).

**No PERM entry node minted** (mobile is a viewport treatment — each screen inherits its desktop counterpart's node; the
notification centre / Alerts is node-free clearance-scoped chrome). Third consecutive clean-no-mint surface (10, 11, 12).
**New OOS-040** (native mobile wrapper deferred). One **NET-NEW** Phase-4 binding flagged: a `push_subscriptions`
device-token store owed to C7 for FR-7.VIEW.003 delivery (RLS-scoped to user, no `client_slug`). No new AF minted in
Phase 3 (the push-delivery-reliability spike is recommended for Phase 5).

---

## OD-153…OD-156 — surface-01b (Config-Change Audit Log Viewer, `UI-config-audit-log`) governance-owner / layout / read-authority / export-behaviour 🟢 RESOLVED (2026-07-01, surface-local; recommendations delegated)

- **OD-153** 🔑 🟢 **#1/#3 Rule-0 governance gap (change-control mint).** `config_audit_log` is the system's **third
  audit sink** (alongside `event_log` FR-7.LOG.001/006 and `guardrail_log` FR-7.LOG.007), but had **no FR owner** for its
  governance — only a `standards/config-edit-taxonomy.md` **rule-4** *write* mandate (who/when/old→new) + a surface-01
  Phase-4 schema stub. An unlogged / tamperable / un-exportable config-change record is a **#1/#3 violation** (the record
  of who changed system behaviour is safety-critical). **Resolved: mint `FR-7.LOG.008` in C7 via change-control** —
  config_audit_log view / retention / tamper-evidence / export, mirroring FR-7.LOG.007 (guardrail_log) + the FR-1.AUD.003
  seam (C1 owns audit *content*, C7 owns storage/retention/export). C7 **34 → 35 FRs**. Precedent: **OD-097 →
  FR-7.ALR.009** minted into C7 from Phase 2 the same way. New ACs: AC-7.LOG.008.1 (export all-or-nothing, no silent
  truncation) · .2 (retention floor) · .3 (append-only + tamper-evident) · .4 (redaction-tombstone on user-erasure —
  `config_audit_log` now owed to the C2 FR-2.MNT.017 / C10 FR-10.DEL.004 erasure walk, a carry-forward) · .5
  (secrets-never-appear-by-construction — SECRET rows aren't editable in-app so never logged).
- **OD-154** 🟢 — **Layout.** How to structure timeline + detail + export. Resolved: **a single filterable
  Config-Change Timeline landing + a per-change Change Detail drawer + a header Export action** — the natural
  audit-review shape (scan time, drill a change); consistent with surface-06/09/11's list-landing + detail-drawer
  (OD-126/138/146). Not tabbed, not per-section sub-pages (both fragment the trail).
- **OD-155** ⚠️ 🟢 **#2 read authority (clean, no node).** Does the viewer need a new `PERM-config.view_audit` node?
  Resolved: **no new node — entry requires ≥1 `PERM-config.*` node; the row set is key-prefix-scoped to the caller's held
  config sections** (the identical RLS surface-01 mandates for `config_values`/`config_audit_log`); a caller sees only
  the audit history of sections they may **manage** (a Finance-config admin never reads the infra-config trail;
  `PERM-config.infra` history stays Super-Admin-only). **Export** is the distinct, higher act, gated by the catalogued
  **`PERM-compliance.download_records`** (Super Admin, unseeded — default-deny) and itself key-prefix-scoped. A separate
  view node would fork read authority from the edit authority that produced the rows. **No node minted** (a clean case,
  like surfaces 10/11/12).
- **OD-156** 🟢 — **Export behaviour + diff rendering + secret handling.** Resolved: the export = key / section /
  old→new / actor / changed_at over the **filtered, key-prefix-scoped** range, **all-or-nothing** (AC-7.LOG.008.1 — every
  row or a loud failure, never a silent partial); old→new rendered as a **field-level diff**; **secrets never appear**
  because SECRET rows are a read-only presence indicator, never editable in-app, so never produce an audit row
  (FR-7.LOG.005 by construction, AC-7.LOG.008.5). Export mirrors the caller's permitted view (never wider, #2); values
  shown plainly (the value change *is* the record — redacting it would defeat the audit).

**FR-7.LOG.008 minted via change-control** (C7 34→35); **`config-edit-taxonomy.md` rule 4 amended via change-control**
(gate MED-2) — the audit mandate broadened from "LIVE" to **all three editable classes (LIVE/BOOT/REBUILD)**, reconciling
it with `config-registry.md` §cross-cutting + surface-01's Save (which already audit BOOT); SECRET produces no audit row
(never UI-editable). **No PERM entry node minted** (view = existing `PERM-config.*`
key-prefix scope; export = catalogued `PERM-compliance.download_records`). **`UI-config-audit-log` is named by OD-099**,
not minted here (like `UI-COMMANDS`). Carry-forward logged: `config_audit_log` owed to the C2 FR-2.MNT.017 / C10
FR-10.DEL.004 erasure walk (actor-attribution redaction-tombstone, Phase-4/C10). **Surface-01b is the fourteenth and
final Phase-3 surface — Phase 3 is now COMPLETE.**

---

## OD-157…OD-160 — Phase 5 (NFR) risk-posture decisions 🟢 RESOLVED (2026-07-01, session 45, operator-decided)

The four genuine risk-posture calls the Phase-5 playbook reserves for the operator ("who decides:
user on risk posture"). Surfaced from the NFR harvest as RP-1…RP-4; the operator chose the
recommended option for each. Locked here (Rule 0) so `test-strategy.md` and the domain files cite a
written decision, not a conversation.

- **OD-157 (RP-1) — The launch-gating spike set.** 🟢 Resolved: **six** paper-not-proven `AF-*` are
  **launch-blocking** (must PASS before go-live) — **AF-068** (injection containment red-team, #2),
  **AF-069** (restore actually works, #1), **AF-001** (cost viability), **AF-067** (RLS hot-path
  latency), **AF-078** (webhook forgery/replay, #2), **AF-077** (brute-force defense, #2). The
  accuracy-EVAL spikes (retrieval AF-002, entity-res AF-082, anomaly AF-116/117, routing/proactive
  AF-121–131, cost-estimate AF-042, Haiku-gate AF-043/035) ship **fast-follow**, each behind an
  already-safe posture (shadow-retain / flag-only / human-in-loop / fails-safe). Distinct from
  *blocking-by-posture* mechanisms (isolation, audit-sink immutability, freeze gate, RLS coverage,
  expand-contract, the #3 watchdogs) which are locked-ADR/FR requirements built regardless, their
  `AF-*` a build-time proof. **Applied in:** `test-strategy.md` §2–4; every domain file's Launch-gate
  field. *This is the #1/#2 trade-off the three-non-negotiables rule required be surfaced, not
  silently taken.* **Scope note (2026-07-02, OD-161 — pre-Phase-6 audit):** **AF-068**'s red-team scope narrowed
  slightly — it no longer needs to prove containment of the low-risk-external Act-tier path (OD-088), since OD-161
  removed that path entirely. AF-068 remains fully launch-blocking for the other six hard limits' enforceability;
  this is a narrowing of what it must prove, not a removal of the gate.
- **OD-158 (RP-2) — Backup restore-rehearsal cadence.** 🟢 Resolved: **monthly automated rehearsal +
  on every schema-migration release** (ADR-008 §4 said "periodic"; Phase 5 fixes the number).
  **Applied in:** `backup-dr.md` NFR-DR.003.
- **OD-159 (RP-3) — Accessibility floor.** 🟢 Resolved: a **baseline** floor (keyboard-navigable +
  sufficient contrast + semantic markup + labelled action controls on the 14 surfaces) as
  `NFR-A11Y.001`; a full **WCAG 2.1 AA** conformance audit is deferred → **OOS-041**. The design-doc
  named no a11y standard, so per anti-hallucination we set a modest floor, not an invented target.
  **Applied in:** `observability.md` NFR-A11Y.001/002; OOS-041.
- **OD-160 (RP-4) — Performance-target philosophy.** 🟢 Resolved: **aspirational, spike-confirmed**
  targets — `performance.md` states concrete numbers (retrieval p95 < ~2 s, RLS predicate overhead
  < ~50 ms/statement, ANN recall ≥ ~0.9 recall@10 under RLS) each explicitly tagged "**to be
  CONFIRMED by AF-067/019/002 — not yet proven (paper target)**", never a binding SLO (the
  anti-hallucination rule forbids claiming an unmeasured number as proven). **Applied in:**
  `performance.md` NFR-PERF.001–004.

---

## OD-161…OD-167 — Pre-Phase-6 whole-spec audit reconciliation 🟢 RESOLVED (2026-07-02, operator-delegated "I trust your recommendation")

Surfaced by the pre-Phase-6 full-spec audit (`spec/00-foundations/audit/_audit-report.md`, 48 confirmed HIGH / 46
confirmed MED findings). The mechanical/citation-drift findings (renamed IDs, missing matrix rows, stale counts) are
fixed in place without a dedicated OD — this block covers only the findings that touch a locked ADR, reverse a prior
decision, or require a genuine architectural call. Each is logged here per `standards/change-control.md` rule 2/3.

- **OD-161 🔑 — FR-9.MODE.004's Act-tier autonomous external-send is rolled back to Prepare-only; the
  low-risk-external category never reaches Act.** — **#2, supersedes the Act-tier portion of OD-088**
  **Why it matters:** the audit (Dim5 H21/H22) found FR-9.MODE.004's `CFG-action_autonomy_matrix` lets a "low-risk
  external" send **autonomously execute** after a trust period. This is the exact scenario **OD-047** (resolved one
  day earlier, C6 session 23) explicitly considered and rejected: *"legitimate low-risk automation flows through the
  approval-gate layer (a human-approved action is not autonomous), so the limit is never tripped"* — i.e. Prepare,
  never a config-gated Act. It also collides head-on with **ADR-007**'s own locked text, verbatim, twice: *"hard
  limits enforced in application code (L2053/L2066 — **never send external email autonomously**...)"* and *"No user
  role, no agent instruction, **no config change can override a hard limit**"* (ADR-007 L51, restating design-doc
  L2066). `CFG-action_autonomy_matrix` is precisely a config change gating an autonomous send. OD-088 was itself a
  direct **operator** decision (not AI-delegated) at C9 finalization, so this is not a casual reversal — it is
  logged, not silently taken, per Rule 0.
  **Options:** (a) amend/supersede ADR-007 to carve out a bounded exception for the low-risk-external sub-type; (b)
  cap FR-9.MODE.004 at **Prepare** for every sub-type (the AI drafts, a human sends with one tap) — the proactivity
  value (relationship-management, opportunity nurture) is preserved via the draft-ready UX, only the *autonomous
  send* capability is removed.
  **✅ Resolution → (b) (recommended; applied).** Per CLAUDE.md's ranking rule — when a trade-off pits a
  non-negotiable against convenience/speed/scope, the invariant wins — and because ADR-007's "no config change can
  override" text is unambiguous and twice-stated, amending a locked ADR to route around it is the wrong instrument
  for a proactivity nicety. **Applied via change-control:** `FR-9.MODE.004`'s low-risk-external sub-type ceiling
  changes from "Prepare or Act-after-trust-period" to **Prepare only**; `CFG-action_autonomy_matrix`'s
  `act_trust_period_days` field and the standalone `external_act_trust_period` key (the M43 duplicate) are **both
  removed** (the capability they gated no longer exists); `C6 FR-6.APR.002/003`'s OD-088 narrowing (mandatory-hard
  "external" → existing-client/SoR only) is **reverted to the original blanket floor** (all external comms — not
  just existing-client/SoR — stay hard-approval-or-Prepare, never Act); `AC-6.APR.002.3` (the floored-sub-type
  carve-out AC) is retired. `AF-068` no longer needs to gate a "floored-set containment" claim for this path, since
  there is no Act-tier external-send path left to contain. **The operator should be aware this reverses a
  previously operator-decided call (OD-088)** — flagged explicitly, not buried in a batch of mechanical fixes.
  **✅ OPERATOR CONFIRMED (2026-07-02):** the reversal was surfaced to the operator directly (the carried-forward
  Session-46 handoff note), who reviewed the trade-off (Prepare-only loses only the final auto-send on non-client
  low-risk email — one human tap; all detection + drafting preserved) and **confirmed the rollback stands**. The
  Session-46 operator-awareness note is hereby discharged; ADR-007 stays untouched. No further action; Phase-6 issues
  may be cut from FR-9.MODE.004 as it now stands (Prepare-only).

- **OD-162 — Define the "local mirror" of `client_registry.status` the C5 dispatch gate and C10 erasure
  precondition both depend on but no FR ever specifies.** — **#1/#2**
  **Why it matters:** `client_registry` lives **exclusively** in the management-plane deployment (ADR-001 §3); ADR-001
  §7 mandates the health-metadata flow is **push-only, client → management-plane**, and FR-10.MGT.002 defines only
  that inbound direction. Yet **OD-091** (already resolved) requires "the C5 trigger/queue/loop dispatch layer
  checks it [`client_registry.status`] before any dispatch," and FR-10.DEL.007/FR-10.OFF.004 cite reading it "via the
  local mirror / FR-10.MGT.002" — a mechanism that is named but never defined anywhere (Dim5 H20/H41).
  **Options:** (a) add a new bidirectional pull/query path from client deployments to the management plane (rejected
  — reopens exactly the exfiltration surface ADR-001 §7's push-only rule exists to close, a #2 risk for a freeze flag
  that doesn't need one); (b) use infrastructure **already established** by ADR-001's own Consequences section: *"the
  operator's Railway securely stores each client's Supabase service key"* — the operator already custodies a direct,
  authenticated administrative channel into every client's own Supabase project (established for provisioning,
  ADR-005 §5). A freeze command is a management-plane-initiated **write** using already-custodied credentials, not a
  pull of client business data — orthogonal to the health-metadata reporting direction ADR-001 §7 restricts.
  **✅ Resolution → (b).** **Applied via change-control:** a new `deployment_settings` table (single row per client
  deployment; columns: `frozen_at timestamptz`, `frozen_reason text`) lives **inside each client's own Supabase
  project** (added to `spec/04-data-model/schema.md`, Phase-4 owed-back to C10/C5). When C10's offboarding trigger
  sets `client_registry.status = frozen` in the management plane (FR-10.OFF.004), it **also** writes
  `deployment_settings.frozen_at` directly into that client's Supabase using the client's custodied service_role key
  (the same credential path ADR-001 §7 already establishes) — this is the "local mirror." `FR-10.OFF.004`,
  `FR-10.DEL.007`, and `FR-5.TRG.001.3` are amended to cite `deployment_settings.frozen_at` (a **local** read, no
  cross-deployment query) instead of "the local mirror / FR-10.MGT.002." Unfreezing (AC-10.OFF.004.3) uses the same
  write path in reverse.
  **Gap closed (2026-07-02, self-review):** the original resolution above didn't specify what happens if the
  management-plane write to `client_registry.status = frozen` succeeds but the follow-on cross-project write to
  `deployment_settings.frozen_at` fails (client Supabase unreachable, stale/rotated service key) — since C5 and C10
  read *only* the local flag, that failure would leave the management plane believing a deployment is frozen while
  it keeps dispatching, a #1/#3 silent-failure window OD-089's careful partial-failure handling for the later
  deprovision step doesn't cover for this earlier freeze step. **Fix:** `FR-10.OFF.004` gets a new AC — the freeze
  step is not complete until the local write is confirmed; a failed/unconfirmed local write holds the deployment in
  a `freeze_pending` sub-state (not `frozen`), retries with backoff, and escalates to the operator (never silently
  reads as frozen) — mirroring OD-089's own "never marked complete on a partial" discipline.

- **OD-163 — `UI-SUPPORT-REQUESTS` (surface-00) is not a Realtime surface; corrected to polling.** — **#3**
  **Why it matters:** surface-04 and surface-07 together establish "**exactly two** Realtime surfaces in the whole
  product" (FR-7.RTP.001/AC-7.RTP.001.3), load-bearing for the FR-7.RTP.003 connection-budget accounting. Surface-00
  was signed off one day *before* that "exactly two" constraint was formalized on surface-04, and specs
  `UI-SUPPORT-REQUESTS` as a live WebSocket subscription — a third, unaccounted-for Realtime consumer (Dim5 H23, with
  a hedged companion in surface-02, M25).
  **✅ Resolution:** `UI-SUPPORT-REQUESTS` is corrected to **poll** (same cadence family as the other non-Realtime
  surfaces, FR-7.RTP.002), consistent with the two-surfaces-only rule; surface-02's hedged "may subscribe via the C7
  RTP contract" wording is corrected to state it polls. No FR content changes — support-request status was never
  itself an FR-level Realtime requirement, only a surface-authoring slip.

- **OD-164 — ADR-003's cost-ladder config-key names reconciled against the shipped `config-registry.md`; the
  daily/weekly soft-alert figures restored to independently-editable keys.** — (naming + a Phase-2 implementation gap)
  **Why it matters:** ADR-003 names `cost_alert_daily_usd` / `cost_alert_weekly_usd` / `cost_throttle_daily_usd` /
  `cost_hard_ceiling_daily_usd` / `cost.price_table` as the four-plus-one locked keys, and explicitly requires the
  daily and weekly soft-alert figures be **independently editable** (deliberately not a multiple of each other).
  `config-registry.md` instead ships `cost_ladder_soft_threshold` / `cost_ladder_throttle_threshold` /
  `cost_ladder_hard_kill_threshold` / `price_table`, with the soft-alert row **collapsing daily+weekly into one
  compound-default string**, removing independent editability (Dim5 H33, H36).
  **✅ Resolution:** this is a naming-drift-plus-implementation-gap, not a contested decision — ADR-003's underlying
  requirement (three ladder rungs + an independently-editable price table, with daily/weekly soft-alerts each
  editable) is upheld; the artifacts are reconciled to it. **Applied via change-control:** ADR-003 gets a dated
  reconciliation note (same in-place-correction pattern as OD-046 for FR-0.WHK.002) recording the shipped names;
  `config-registry.md`'s `cost_ladder_soft_threshold` is **split into two independently-editable keys**
  (`cost_ladder_soft_threshold_daily_usd`, default $50/day; `cost_ladder_soft_threshold_weekly_usd`, default
  $200/wk, deliberately not 7×daily) matching ADR-003's four-key requirement; `cost.md` updated to match.

- **OD-165 — Custom-command dispatch (FR-9.CMD.008) routes through the standard `task_queue`/C6 approval-hold
  pipeline instead of bypassing it.** — **#2, amends AC-9.CMD.008.3**
  **Why it matters:** AC-9.CMD.008.3 states no `task_queue` entry is created for a custom-command dispatch, while
  AC-9.CMD.008.4 insists the wrapped action's C6 tier "governs execution regardless." But the only mechanism the spec
  defines anywhere for enacting a soft/hard-approval hold is `task_queue`-based (FR-6.APR.006, FR-5.QUE.005) — so if
  a custom command resolves to a floored/hard-approval tier at execution time, nothing in the spec describes what
  actually stops the send (Dim6 H47, a #2 gap: "never do something it shouldn't" with no described enforcement path
  on this route).
  **✅ Resolution:** a custom-command dispatch **creates (or reuses) a `task_queue` row** exactly like any other agent
  action, routing to surface-04 like any other agent action when it resolves above auto-approve/reversible-soft —
  reusing the existing, already-audited approval-hold machinery rather than inventing a parallel one. **Applied via
  change-control:** AC-9.CMD.008.3 amended (a task_queue row IS created; the "no task_queue entry" framing is
  retired); AC-9.CMD.008.4 restated as "the created task_queue row carries the wrapped action's real C6 tier — a
  custom command can never resolve to a lower tier than its wrapped action would outside the command path."

- **OD-166 — `rls-policies.md`'s PERM-node citations reconciled against the actual `PERMISSION_NODES.md` catalog;
  one new node minted.** — (Dim1 H4–H8)
  **Why it matters:** five distinct PERM- citations in `rls-policies.md` (`PERM-audit.view`, `PERM-clearance.grant`,
  `PERM-clearance.view`, `PERM-restricted.grant`, `PERM-user.manage`, `PERM-user.view`) resolve to nothing in the
  51-node catalog — either a typo'd family (the catalog uses `PERM-user.grant_clearance` /
  `PERM-user.grant_restricted`) or a genuinely uncovered read-gate (`access_audit` reads have no node at all).
  **✅ Resolution:** (1) **mint `PERM-compliance.view_audit`** (Super Admin + Compliance-holding roles) under the
  existing Compliance category, paralleling the already-catalogued `PERM-compliance.download_records`, gating
  `access_audit` reads. (2) Correct `PERM-clearance.grant`/`PERM-restricted.grant` citations to the real nodes
  `PERM-user.grant_clearance`/`PERM-user.grant_restricted`. (3) `sensitivity_clearances`/`restricted_grants` **reads**
  need no new node — the RLS read policy is **self-row** (`auth.uid() = user_id`) **OR** caller holds the
  corresponding grant-node (an admin who can grant clearance can also see who holds it); no bare `.view`/`.clearance`
  node is minted. (4) `profiles`/`user_roles` writes gated by the non-existent `PERM-user.manage` are corrected to
  the specific granular node for each actual write path (role assignment → `PERM-user.assign_role`; no coarse
  `.manage` node is minted, consistent with the catalog's granular-nodes-only convention). (5) `profiles`/`user_roles`
  **reads** gated by the non-existent `PERM-user.view` are corrected to **self-row OR any User-Management-category
  node holder** (admin visibility derives from already holding a specific management node, not a new coarse
  `.view`). PERMISSION_NODES.md catalog count **52 → 53** (corrected 2026-07-02: the true pre-session baseline was
  52, not 51 — see the catalog's own M27 recount-correction note, which found `PERM-guardrail.edit_autonomy` had
  never been rolled into the running tally).

- **OD-167 — Mint two `PERM-ops.*` nodes for surface-05's DLQ and connector-reconnect actions (OD-121's
  never-transcribed "System-Functions"/"Tool-Access" gates).** — (Dim5 H32)
  **Why it matters:** surface-05 (OD-121) gates DLQ Requeue/Discard and Connector Reconnect behind a "System
  Functions" node and a "Tool Access" node that were never actually minted into `PERMISSION_NODES.md` — an
  unguarded-at-build-time action gate for two genuinely consequential operations (discarding a dead-lettered task;
  forcing a connector re-auth).
  **✅ Resolution:** mint **`PERM-ops.dlq_manage`** (DLQ requeue/discard, Admin + Super Admin default) and
  **`PERM-ops.connector_reconnect`** (connector reconnect action, Admin + Super Admin default) under a new
  **Operations Actions** category in `PERMISSION_NODES.md`; surface-05 re-cited to the real node names.
  PERMISSION_NODES.md catalog count **53 → 55** (after OD-166's corrected 52→53 mint; see that entry's note).

**Dim5-H28 audit disposition (no OD, no fix needed — logged for the record so it is not re-litigated):** the audit
flagged OD-066 (regex-only high-confidence match → autonomous quarantine) as contradicting ADR-007's "never an
autonomous gate" text. On direct re-read of ADR-007 (`L163-164`: *"regex/semantic/quarantine as the **signal +
human-routing layer**"*) and FR-6.INJ.006 (*"the task never proceeds with quarantined content without explicit human
approval"*), quarantine is the **automated form of "route-to-review"** ADR-007 itself explicitly permits — the human
still makes the only consequential decision (discard/include); nothing is autonomously approved, sent, or
permanently discarded. This is not a violation of "never an autonomous gate" (which bars the regex layer from
autonomously *permitting* an action), and OD-066 stands unchanged. Recorded here specifically so a future session
doesn't re-open ADR-007 over a finding that was checked and found to be a misreading, not a defect.

---

## OD-168 — RLS helper-function naming + visibility-tier resolution reconciled across manifest files 🟢 RESOLVED (2026-07-03, ISSUE-020 build-test reconciliation; canonical-name-wins)

- **OD-168** 🔑 ⚠️ **#3 Rule-0 cross-file divergence (surfaced by the ISSUE-020 zero-context build test).** The named
  manifest files disagree on the RLS helper that resolves a user's **visibility tier**, and no file states where the
  `user → held-visibility-tier` mapping comes from — so a builder cannot author FR-1.RLS.003's visibility-tier predicate
  (build step 3) without guessing. Two divergences:
  1. **Naming.** `component-01-rbac.md` (FR-1.RLS.002 preconditions L581, the `(select …)` example L583, and the Phase-4
     DATA stub L929) and `ADR-006` (L124) name the visibility helper **`user_visibility(uid)`**. `rls-policies.md`
     (L29-38, L109), `indexes.md` (L70), and issues ISSUE-002/009 instead name a **`user_perms(uid)`** helper that
     `returns text[]` of **PERM nodes** (`user_roles ⋈ role_permissions`) — *not* visibility tiers.
  2. **Resolution.** `rls-policies.md`'s `user_perms` returns PERM nodes and `user_clearances` returns clearance
     tiers/scopes; **neither returns the visibility tier** (`memories.visibility` ∈ `global|team|private`, schema.md
     L83/L296). The schema has **no** `user_roles → visibility_tier` column or table, so "which tiers a user holds" is
     unresolved from the named files.
- **✅ Resolution (canonical-name-wins; no new mechanism invented):**
  - There are **four distinct helpers**, not three-with-a-rename: **`user_perms(uid)`** (PERM nodes, `text[]` — the
    `can()`/policy PERM lookup) and **`user_visibility(uid)`** (the caller's held visibility tiers) are **separate**
    functions. `rls-policies.md`'s helper list omitted `user_visibility` and the ISSUE-002/009 lists used the
    `user_perms` shorthand for the whole family; the **authoritative name for the visibility resolver is
    `user_visibility`** (ADR-006 L124 + FR-1.RLS.002 L581 + DATA stub L929 — three canonical citations vs a summary-file
    shorthand). Visibility resolution is a **distinct helper**, not folded into `user_perms`.
  - **Held-visibility mapping:** a user holds a visibility tier **via their one active role** (`user_roles`, one-role-per-user
    OD-029) — the same live-read shape as `user_perms`/`user_clearances`. The exact role→tier lookup (a `role_permissions`
    convention vs a small role-attribute) is a **Phase-4 build artifact** of `user_visibility`'s body, on the same footing
    as the `user_perms`/`user_clearances` SQL bodies already deferred as build artifacts in `rls-policies.md` L107-110; the
    **contract** (returns the caller's held `visibility_tier` set, read live, `(select …)`-wrapped) is fixed here.
  - **Housekeeping owed (do NOT block ISSUE-020):** `rls-policies.md`'s helper list (L26-38) and `indexes.md` L70 should
    add `user_visibility` alongside `user_perms` so all four appear in the summary files; and the ISSUE-002/009 helper
    lists carry the `user_perms` shorthand. These are documentation reconciliations (no policy-logic change) — logged here
    so a future editor closes them; ISSUE-020 proceeds by citing this OD for the name + contract.

---

## OD-169 — Ranking sub-signal → 0–1 normalization defined for the FR-2.RET.005 weighted score 🟢 RESOLVED (2026-07-03, ISSUE-025 build-test reconciliation; contract-fixed, SQL body a Phase-4 build artifact, tuning gated by AF-002)

- **OD-169** ⚠️ **#3 build-input gap (surfaced by the ISSUE-025 zero-context build test).** `FR-2.RET.005`
  (`component-02-memory.md` L775-794) gives the ranking **weights** (recency 0.3 + confidence 0.3 + entity-match 0.2 +
  vector-similarity 0.2, sum = 1.0 — canonical `ranking_weights`, `config-registry.md` L322) and the procedural ×1.2
  boost, but **no named file defines how each raw signal becomes a 0–1 score before weighting.** Two of the four are
  already 0–1 (`confidence` is `numeric(4,3)` 0–1, schema.md L295; `vector-similarity` is a cosine that maps
  monotonically to 0–1). The other two — **recency** (a raw `created_at` timestamp) and **entity-match** (a set overlap)
  — have no defined mapping, so a builder must guess three of the four sub-scores AC-2.RET.005.1 requires. This is a real
  spec-level underspecification, not merely a missing manifest pointer: the design-doc source (design-doc-v4.md
  L1727–1738) also treats "recency", "entity match relevance", and "vector similarity score" as already-normalized
  inputs without defining the mapping.
- **✅ Resolution (contract-fixed here; no new scoring engine — an ADR-002 anti-bloat guardrail):** each sub-signal
  normalizes to `[0,1]` by the following **fixed defaults**, computed inline in the ranking step (no stored score, no
  model call):
  - **recency** — exponential decay over the candidate's age from `created_at` (schema.md L302):
    `recency = 0.5 ^ (age_days / CFG-rank_recency_half_life_days)`; a memory at the half-life scores 0.5, a brand-new
    one ~1.0. New LIVE config key **`rank_recency_half_life_days`** (default **90**, float days > 0) minted into
    `config-registry.md` so the decay is operator-tunable and not a magic constant.
  - **confidence** — used directly (already 0–1, schema.md L295; `system_pointer` is unscored → admitted by its own rule
    per FR-2.RET.003/OD-035 and does not participate in the confidence term).
  - **entity-match** — Jaccard overlap of the task's resolved entity set (FR-2.RET.001) against the candidate's
    `entity_ids` (schema.md L292): `|Q ∩ E| / |Q ∪ E|` ∈ [0,1]; a vector-arm-only candidate sharing no task entity
    scores 0 on this term (it still ranks via its other three terms).
  - **vector-similarity** — cosine similarity mapped to `[0,1]` as `(cosine + 1) / 2` (pgvector cosine distance `d`
    ⇒ `similarity = 1 − d`, then to `[0,1]`); the keyword-arm-only candidate with no vector score uses its arm's
    similarity or 0 on this term, symmetric to entity-match.
  - The four normalized sub-scores are combined by the LIVE `ranking_weights`, the procedural ×`procedural_boost` (1.2)
    is applied, and the top `memories_injected_per_task` (7) are taken — unchanged from FR-2.RET.005.
- **Status of the numbers:** the **normalization *shapes*** (exponential recency decay, Jaccard entity-match,
  cosine→[0,1]) are fixed here as the build contract; the **half-life default (90 d)** and the **weights** themselves are
  LIVE-tunable and are **validated/curve-fit by AF-002** (the relevance/ranking-weight EVAL already gating this issue) —
  the exact SQL body of the scoring expression is a **Phase-4 build artifact**, on the same footing as the deferred RLS
  helper bodies (OD-168). No new engine, consistent with ADR-002 anti-bloat guardrail 1 ("Retrieval Sufficiency /
  ranking stays a thin threshold over existing retrieval signals — no bespoke model").
- **Applied via change-control:** `config-registry.md` gains `rank_recency_half_life_days` (LIVE, default 90);
  `FR-2.RET.005` gains a Notes line citing this OD for the sub-signal normalization contract; ISSUE-025 cites this OD in
  its DoD and build step 5.

---

> **Reserved:** OD-098–103 are used by `spec/03-surfaces/surface-01-config-admin.md`; OD-105–108 by
> `spec/03-surfaces/surface-00-auth.md`; OD-109–112 by `spec/03-surfaces/surface-02-user-mgmt.md`;
> OD-113–116 by `spec/03-surfaces/surface-03-ingestion-queue.md` (surface-local; OD-115 mints two C1 Memory-Access
> PERM nodes via change-control); OD-117–120 by `spec/03-surfaces/surface-04-approval-queue.md` (surface-local; all
> resolved in-file; OD-117 mints `PERM-action.review` via change-control, OD-120 amends C6 FR-6.APR.003); OD-121–124 by
> `spec/03-surfaces/surface-05-dashboard-ops.md` (surface-local; all resolved in-file; OD-123 mints `dlq_stale_alert_hours`
> via change-control to the config registry) — do not reuse those numbers. OD-125–128 by
> `spec/03-surfaces/surface-06-dashboard-super-admin.md` (surface-local; all resolved in-file; OD-125 mints five
> `PERM-fleet.*` management-plane nodes via change-control + introduces the `management-plane` scope). OD-129–132 by
> `spec/03-surfaces/surface-07-dashboard-agency.md` (surface-local; all resolved in-file; OD-129 mints the
> `PERM-dashboard.overview` + `PERM-dashboard.ops` Dashboard Access nodes via change-control + canonicalises surface-05's
> `view_ops` working name). OD-133–136 by `spec/03-surfaces/surface-08-dashboard-user.md` (surface-local; all resolved
> in-file; OD-133 mints `PERM-dashboard.workspace` via change-control — the third Dashboard Access node, anticipated by
> OD-129; OD-135 flags a net-new Phase-4 `conversations`/`messages` chat store owed to C5/C9). OD-137–140 by
> `spec/03-surfaces/surface-09-agent-builder.md` (surface-local; all resolved in-file; OD-137 mints the `PERM-agents.*`
> Asset Management node family via change-control — encoding the locked OD-080 capability-vs-description authority split).
> OD-141–144 by `spec/03-surfaces/surface-10-commands.md` (surface-local; all resolved in-file; **no PERM node minted** —
> `PERM-commands.manage` + `PERM-system.tune` already catalogued; OD-142 + OD-143 pushed into C9 via change-control as
> AC-9.CMD.006.4 + AC-9.CMD.008.4). OD-145–148 by `spec/03-surfaces/surface-11-memory-nav.md` (surface-local; all
> resolved in-file; **no PERM entry node minted** — memory read is clearance-scoped, OD-145; the 3 long-owed nodes
> OD-115 ×2 + OD-117 transcribed to `PERMISSION_NODES.md` as housekeeping, 48→51). OD-149–152 by
> `spec/03-surfaces/surface-12-mobile.md` (surface-local; all resolved in-file; **no PERM entry node minted** — mobile
> inherits each screen's desktop node, OD-149/151; OD-150 defers a native wrapper → OOS-040 + flags a Phase-5
> push-delivery-reliability spike; one net-new `push_subscriptions` device-token store owed to C7). OD-153–156 by
> `spec/03-surfaces/surface-01b-config-audit-log.md` (surface-local; all resolved in-file; **OD-153 mints `FR-7.LOG.008`
> in C7 via change-control** — the config_audit_log governance owner, C7 34→35; **no PERM entry node minted** — view is
> key-prefix-scoped `PERM-config.*`, export is catalogued `PERM-compliance.download_records`, OD-155).
> OD-157–160 are the Phase-5 (NFR) risk-posture decisions (RP-1…RP-4, resolved above). OD-161–167 are the
> pre-Phase-6 whole-spec audit reconciliation decisions (resolved above) — do not reuse those numbers.
> OD-168 (RLS helper naming + visibility-tier resolution, resolved above) was minted by the ISSUE-020 build-test
> reconciliation — do not reuse. OD-169 (ranking sub-signal normalization for FR-2.RET.005, resolved above) was minted
> by the ISSUE-025 build-test reconciliation — do not reuse. OD-170 (event_type enum additions, resolved below)
> was minted by the ISSUE-020 build-test gap-sweep — do not reuse. OD-171 (Phase-6 connector build-order fork, 🟡
> OPERATOR, resolved below) — do not reuse. OD-172 (webhook live-vendor verification re-gated to per-connector onboarding, 🟢 operator-decided Option A, resolved above) — do not reuse. OD-173 (Railway promotion mechanism = Git-merge, no native promote; 🟢 RESOLVED session 64 — confirmed LIVE at the ISSUE-080 capstone, AF-064 🟢, at file end) — do not reuse. OD-174 (manual Railway GitHub App install as a consent-gated onboarding step + pre-flight verify; 🟡 recommendation, minted by the Railway dossier, at file end) — do not reuse. OD-175 (per-client login-OAuth registration re-gated from the ISSUE-007 gate to per-deployment onboarding, FR-10.PRV.002; 🟢 resolved session 61, at file end) — do not reuse. OD-176 (migration harness = raw-SQL + custom runner, not drizzle-kit generate/schema.ts; 🟢 RESOLVED operator-ratified session 62, at file end) — do not reuse. OD-177 (9-agent roster seed: name amended to slug-only via FR-8.REG.001 change-control, memory_scope owed to ISSUE-063; 🟢 RESOLVED session 62, at file end) — do not reuse. OD-178 (config_values defaults seed deferred from 0001 to ISSUE-010; 🟢 resolved+ratified session 62, at file end) — do not reuse. OD-179 (event_type enum lacks values for the FR-0.WHK.* webhook event_log writes; 🟢 RESOLVED session 63 via additive change-control, live enum-add migration owed at onboarding, at file end) — do not reuse. OD-180 (retention-prune whitelist on the audit-sink immutability trigger, change-control on NFR-CMP.006; 🟢 RESOLVED session 66 operator Option A, migration 0005, at file end) — do not reuse. OD-181 (config key→PERM-config map = explicit registry transcription + fail-closed default; 🟢 RESOLVED session 66, at file end) — do not reuse. OD-182 (audit-immutability trigger widened to permit a monotonic escalation stamp on guardrail_log + injection_quarantine, change-control on the live append-only invariant; 🟢 RESOLVED session 69, migration 0009, at file end) — do not reuse. OD-183 (AC-3.CONN.005.2 Drive-scope default deferred from the ISSUE-032 runtime to the ISSUE-040 Google connector; 🟢 RESOLVED session 69, at file end) — do not reuse. Next OD number: OD-184.

---

## OD-170 — `event_type` enum lacks values for the FR-1.RLS.007/008 event_log writes 🟢 RESOLVED (2026-07-03, ISSUE-020 build-test gap-sweep; additive enum change-control)

- **OD-170** ⚠️ **#3 build-input gap (surfaced by the ISSUE-020 zero-context build test).** Both `FR-1.RLS.007`
  (mid-task authorization stop → "security `event_log` + `access_audit`", `component-01-rbac.md` L702) and
  `FR-1.RLS.008` (RLS-vs-harness divergence → "`event_log` + alert", C1 L722/726) **mandate an `event_log` write**,
  but the `event_type` enum in `schema.md` §8 (L110-114) admitted **no value** for either event. A builder authoring
  ISSUE-020 build steps 5-6 could not `INSERT` the row without inventing an enum value (reuse `guardrail_hit`? mint a
  new one?) — an unspecified schema change forced at build time. The same gap blocks any consumer of these two events
  (the observability skeleton ISSUE-011, the silent-failure/divergence signal).
- **✅ Resolution (additive, expand-contract-safe; no behaviour change):** two enum values added to `event_type`
  (`schema.md` §8) via change-control:
  - **`authz_revoked_midtask`** — the FR-1.RLS.007 mid-task authorization-stop event (deactivation / relied-on
    clearance or Restricted-grant revocation halts the `service_role` task before its next consequential side effect).
  - **`rls_harness_divergence`** — the FR-1.RLS.008 signal that the harness `can()` decision and the RLS row result
    disagreed (a harness-permitted read that RLS returned as zero rows), so the silent backstop becomes observable (#3).
  Additive enum values are forward-safe under `migration-discipline.md` (no drop/rename). ISSUE-020 build steps 5-6 +
  its DATA `event_log` line now cite these values by name; no FR text changes (the FRs already named the `event_log`
  write — this only gives it a typeable value).

---

## OD-171 — Phase-6 build-sequencing fork: connector rollout order (the one open degree of freedom) 🟢 RESOLVED (2026-07-03, session 48, operator-decided: **GHL first**)

- **✅ Resolution (operator, 2026-07-03):** **GHL first** (ISSUE-039), then Google (040), then Slack (041) — the
  recommended option (a): the CRM spine most flows assume, and the connector carrying the most connector-specific
  viability gates (AF-090 webhook Ed25519, AF-098 PHI/BAA), so building it first de-risks the connector pattern earliest.
  No dependency changes (the three are independent Tier-6 leaves); this sets the build priority, not the graph shape.


- **OD-171 — the only genuine build-sequencing choice the operator must own.** The Phase-6 dependency DAG
  (`spec/06-issues/_backlog.md`) fully sequences the 86 issues into 7 tiers with a verified 11-node critical path, and
  the six OD-157 launch-gating spikes are ordered ahead of their dependents — so **no forced v1 scope-cut was needed**
  (every FR + NFR maps to an in-scope issue; the optimisation / self-improvement issues — 036/046/054/065/066 — and the
  aggregation surfaces naturally sequence last via the DAG, not by a scope decision). The **one** remaining degree of
  freedom is the order the three connector instances are built: **ISSUE-039 (GHL) · ISSUE-040 (Google) · ISSUE-041
  (Slack)** — all three share Tier-6 and depend only on the connector runtime (032) + token lifecycle (033) + rate-limit
  (034) + trigger infra (037); none blocks another.
- **Why it's the operator's:** per **ADR-001** + the business model, the tool set is **open-ended and client-driven** —
  which connector matters first is a *per-client / per-vertical* rollout choice, not a v1 architecture decision.
- **Options:** (a) **GHL first** *(recommended reference build)* — GHL is the CRM spine most design-doc flows assume, and
  carries the most connector-specific viability gates (AF-090 webhook Ed25519, AF-098 PHI/BAA), so building it first
  de-risks the connector pattern earliest; (b) Google first (broadest surface: Gmail/Drive/Calendar); (c) Slack first
  (lightest, but gated by AF-083/084 ingest). **Recommendation: (a) GHL first**, then Google, then Slack — but this is
  genuinely client-driven and the operator sets it per the first onboarding. **No dependency changes either way** (the
  three are independent leaves), so this can be decided at build time without reshaping the backlog.
- **Status:** 🟢 RESOLVED (GHL first). It was surfaced for the operator because it is a rollout-priority call, not a spec
  correctness call; the build can start on the entire foundational + identity + memory spine (Tiers 0–5) independently.
  It gates nothing on the critical path.

## OD-172 — Webhook live-vendor verification re-gated from launch-blocking to per-connector onboarding (AF-078 / AF-090) 🟢 RESOLVED (2026-07-04, session 57, operator-decided: Option A — defer)

- **OD-172 — the connector-driven gating call for the webhook forgery spike (ISSUE-006 / AF-078).** ISSUE-006 proved the
  webhook-verification **mechanics** against a self-contained harness (MODE M, 17/17: valid accepted; forged / tampered /
  replayed / stale rejected; the **raw-body-before-parse** trap and **constant-time** compare hold). The one genuine
  unknown — **AF-090, exactly which bytes GHL signs** — was **resolved from GHL's primary developer docs (2026-07-04):
  GHL signs the RAW BODY ONLY with Ed25519 (`X-GHL-Signature`); the published Ed25519 public key was captured** (see the
  AF-090 row + `spikes/issue-006-webhook-forgery/`). What remains unproven is the **empirical live confirmation** that a
  real vendor-signed webhook verifies against real vendor key material — which cannot be produced without the vendor
  account. **The operator has no GHL account**, and connectors are **client-driven** (none is provisioned at launch).
- **Decision (operator, Option A):** the per-connector **live webhook-verification confirmation** is **re-gated from a
  launch-blocking Stage-0 requirement to a per-connector ONBOARDING requirement** — proven on **ISSUE-017** (webhook auth)
  / the connector issues (**039** GHL · **040** Google · **041** Slack) **before that connector goes live for a real
  client**, not before general launch. For Checkpoint-0 / go-no-go purposes, **AF-078 is satisfied by the proven mechanics
  + the AF-090 DOCS resolution**; the live per-connector checks are **tracked residuals**, never silent omissions (#3).
- **Rationale:** (1) the security property (#2 — a forged/replayed webhook cannot drive the system) rests on the
  verification *mechanics*, which are proven and reusable; (2) **Slack's scheme is symmetric** (HMAC over a shared
  secret), so the mechanics ARE the real proof — no asymmetric vendor gap to close; (3) **Google** is standard OIDC
  (JWKS / audience / expiry) — mechanics proven; (4) **GHL's signing input is now DOCS-known**, leaving only a live-payload
  confirmation that is meaningless without a GHL client.
- **What this does NOT relax:** the mechanics ship exactly as proven (raw-body-before-parse, constant-time compare, replay
  cache); **a connector may not go live until its live webhook verification passes at onboarding** (the residual is
  blocking THERE). No change to NFR-SEC.008 or ADR-007.
- **Status:** 🟢 RESOLVED (Option A — defer live confirmation to onboarding). **Owed:** AF-090 empirical live-payload
  confirmation + AF-078 per-connector live verification, on ISSUE-017 / 039 / 040 / 041, before each connector ships.
  Checkpoint 0 no longer blocks on the GHL live check; it **still blocks on ISSUE-007** (silo).

---

## OD-173 — Railway "promote to fleet" mechanism: Git-merge, not a native promote primitive 🟢 RESOLVED (2026-07-05, ISSUE-080 live capstone)

- **OD-173** — **Surfaced by the Railway research dossier** (`tool-integrations/railway.md` §7 / AF-064). ADR-005 §2
  frames a canary→promote release train; the design language ("promotion by fast-forward") is close, but the dossier
  confirms **Railway has NO native "promote" primitive** between environments (the only cross-env feature is *Sync
  Environments*, which is config sync, not build promotion). So the *mechanism* must be pinned down before FR-10.DEP.002
  is built.
- **Options:** (a) **branch-per-environment + "Wait for CI" gate + Git-merge promotion** — model each stage as a Railway
  environment whose service tracks a distinct branch (`canary`←`canary` branch, `production`←`main`); "promote to fleet"
  = merge/fast-forward `canary`→`main`, which auto-deploys the fleet; Railway "Wait for CI" holds each deploy until GitHub
  checks pass. (b) hope for a native promote (does not exist — rejected). (c) fully manual operator redeploys (loses the
  canary gate).
- **Recommendation: (a).** It preserves ADR-005 §2's *decision* (a canary gate before the fleet) exactly; only the
  *mechanism* is Git rather than a Railway button — which ADR-005 §2 already anticipated ("if Railway's branch model
  differs, the mechanism changes but the gate stands"). **Owed before FR-10.DEP.002 is Ready:** a live SPIKE of "Wait for
  CI" scope — it waits on **ALL** GitHub check suites on the commit, not just ours, so a stale/unrelated check can silently
  `SKIP` a deploy (#3 hazard). Does not change any locked ADR; ADR-005 §2 should cite this OD as the mechanism detail.
- **Status:** 🟢 **RESOLVED — Option (a), confirmed LIVE 2026-07-05 (session 64, ISSUE-080 capstone, operator-present).**
  Branch-per-environment (canary env tracks `release`, production tracks `main`) + Wait-for-CI gate + Git fast-forward
  `release`→`main` promotion works end-to-end: a green push auto-deploys the canary; a **red own-suite check BLOCKS** the
  canary deploy (the #3 hazard guarded — a broken build never rolls forward, held for 2+ min); the operator fast-forward
  promoted `release`→`main` and the production/fleet auto-deployed. **AF-064 🟡→🟢.** Residual (honest, non-gating): only one
  check-suite producer exists in-repo, so the "Wait for CI waits on ALL suites" scope stays DOCS-backed — re-confirm if a
  third-party check suite is later added. Evidence `app/release/results/od-173-wait-for-ci-spike.2026-07-05.md`.

## OD-174 — The manual Railway GitHub App install is a consent-gated onboarding step + provisioning pre-flight 🟡 RECOMMENDATION (2026-07-04, Railway dossier session 59)

- **OD-174** ⚠️ **#3 provisioning-input gap — surfaced by the Railway dossier** (`tool-integrations/railway.md` §7 /
  **AF-141**). ISSUE-007 / FR-10.PRV.001 describe a *scripted, idempotent* provisioning flow, but the Railway↔GitHub repo
  link the script depends on requires the **Railway GitHub App installed + granted repo access**, and there is **NO API/CLI
  path** to do that install (dashboard + GitHub OAuth only). Left implicit, an automated run would hit a confusing
  deploy-from-nothing failure. Two sub-questions: (1) *where* does the install live in onboarding, and (2) *which* GitHub
  account installs it — the operator org that owns the shared `app/` repo, or the client (the shared repo is operator-owned
  per ADR-011, so almost certainly the operator, but confirm at the SPIKE).
- **Options:** (a) **add an explicit consent-gated "install the Railway GitHub App on the repo" step to
  `app/runbooks/client-onboarding.md`, and have `RailwayInfra` pre-flight-verify repo access and FAIL LOUD if absent**
  (a missing install blocks provisioning with a clear, actionable error — never a silent half-deploy). (b) leave it implicit
  (rejected — a silent-failure #3 violation). 
- **Recommendation: (a).** Because the shared repo is operator-owned (ADR-011), the install is most likely a **one-time
  operator-org step** (install the Railway GitHub App on the org, grant it the `app/` repo) done once for the whole fleet,
  not per client — the AF-141 SPIKE confirms this. The per-client runbook still records it as a checked precondition.
  **Owed:** the AF-141 SPIKE (confirm the installing account + that `serviceConnect` fails loud without it) before AF-004
  goes green. Feeds the client-onboarding runbook + the `RailwayInfra` pre-flight.
- **Status:** 🟡 RECOMMENDATION — operator to confirm at the AF-141 SPIKE (part of the AF-004 two-party session).

## OD-175 — Per-client login-OAuth registration (FR-10.PRV.002) re-gated from the ISSUE-007 gate to per-deployment onboarding 🟢 RESOLVED (2026-07-04, session 61, operator-delegated: "I trust your rec")

- **OD-175 — the deployment-driven gating call for the provisioning login-OAuth requirement (ISSUE-007 / FR-10.PRV.002).**
  ISSUE-007 §4 lists **AC-10.PRV.002.1/.2** (register the client's OWN login + connector OAuth apps in the client's
  accounts, redirect URIs → that deployment's Railway domain; start Google production verification early) in its Definition
  of Done. But FR-10.PRV.002 is **inherently per-deployment onboarding work**: it needs a *real* client (or a real login
  provider) account, and its redirect URIs point at a *specific* deployment domain. The **AF-004 canary** ran with
  **placeholder `LOGIN_OAUTH_*`** (the boot gate checks *presence*, not validity — af-004-evidence §caveats): there is no
  real client account behind the synthetic canary to register a real login-OAuth app in. Proving AC-10.PRV.002.* now would
  mean registering a throwaway OAuth app for a synthetic client — a fake proof, not a real one.
- **Decision (operator-delegated):** **re-gate the per-deployment login-OAuth registration + Google verification lead-time
  (AC-10.PRV.002.1/.2) from an ISSUE-007 / Checkpoint-0 requirement to a per-deployment ONBOARDING requirement** — proven
  when a real deployment's OAuth apps are registered during onboarding (the client-onboarding runbook step FR-10.PRV.004 /
  the login issue **ISSUE-013 OAuth login + session**, Stage 3), **not** before Checkpoint 0. This is the exact analogue of
  **[[OD-172]]** (webhook live-vendor confirmation re-gated to per-connector onboarding). For Checkpoint-0 / go-no-go,
  ISSUE-007 is satisfied by the proven provisioning plumbing (AF-004 🟢), the codified `RailwayInfra`, and the live canary
  seed; the per-deployment OAuth registration is a **tracked residual**, never a silent omission (#3).
- **Rationale:** (1) FR-10.PRV.002 stays **Approved and unchanged** — this relocates *where its ACs are verified*, it does
  not relax them; (2) the canary is operator-owned synthetic infra with no client account, so a real per-client OAuth app
  cannot exist for it; (3) redirect-URI correctness + Google prod-verification lead-time are only meaningful against a real
  deployment domain + real client Google project, which exist at onboarding, not at the Stage-0 gate.
- **What this does NOT relax:** per-client apps in the client's OWN accounts (never a shared operator app — ADR-001 §5 /
  ADR-005 §6); redirect URIs → the deployment domain; Google production verification started early as a schedule
  dependency (AF-013). A real deployment may not go live for a real client until its login-OAuth registration is done +
  verified at onboarding (the residual is blocking THERE).
- **Companion scope facts (recorded, not forks — see ISSUE-007 §10):** the **C0/C1 first-boot seed** (Internal Org + first
  Super Admin + roles + agents) was already **§2-Out** (owned by C0 `FR-0.SEED.*` / C1 `FR-1.ROLE.001`); AF-004 proved only
  the plumbing that *triggers* it. The **minimal canary target schema** (`app/canary/migrations/0001_canary_target.sql`) is
  a throwaway precondition (the `client_registry` precedent), superseded by ISSUE-008's real 0001 baseline; it carries **no
  RLS** (a #2 posture gap tracked as an ISSUE-009 residual — acceptable only because the silo holds solely synthetic data).
- **Status:** 🟢 RESOLVED. **Owed:** per-deployment login-OAuth registration + Google verification at onboarding
  (ISSUE-013 / FR-10.PRV.004 runbook), before a real client login goes live. Checkpoint 0 no longer blocks on login-OAuth;
  it closes on **ISSUE-007 `status: done`** (canary live seed + `RailwayInfra` — the plumbing already 🟢 via AF-004).

---

## OD-176 — Migration harness = raw-SQL migrations + a custom runner, NOT `drizzle-kit generate`/`schema.ts` 🟢 RESOLVED (2026-07-04, session 62, operator-ratified: "long-term, least headache")

- **Resolution (operator-ratified):** **keep the raw-SQL migrations + custom `pg` runner** as the standing toolchain
  (Option A). Rationale the operator asked for — long-term, least headache: schema.md stays the single source of truth
  (no `schema.ts` to drift), the harness is already built + proven live (idempotent/fail-loud/resumable, ISSUE-008
  capstone), and `drizzle-kit generate` could never emit the RLS/helpers/CONCURRENTLY/seed anyway. The migration SQL
  stays reusable under drizzle if that ever changes. `migrations.md` L9-10 note already records the deviation.

- **OD-176 — the toolchain fork the ISSUE-008 gate had to settle.** `migrations.md` L9-10 names the toolchain as
  "generated once (`drizzle-kit generate`) and applied per-deployment (`drizzle-kit migrate`)". `drizzle-kit generate`,
  however, produces table DDL **from a Drizzle `schema.ts`** — which would create a **second source of truth** competing
  with `schema.md` (a Rule-0 drift risk), and it **cannot generate** the RLS policies, SECURITY DEFINER helpers,
  `CREATE INDEX CONCURRENTLY`, the append-only trigger, or the seed — all of which are hand-authored SQL regardless. The
  existing `app/management` + `app/canary` migrations are already **raw hand-authored SQL** (applied via psql / the
  Supabase Management API — the path proven live in sessions 60-61).
- **Decision (recommendation):** author migrations as **raw SQL to the `schema.md`/`indexes.md`/`rls-policies.md`
  contracts** (schema.md stays the *sole* Rule-0 source of truth — no `schema.ts`), and implement the `drizzle-kit migrate`
  role directly as a small **custom TypeScript runner** (`app/silo/src/migrate.ts`, `pg`-based, journal-tracked in a
  `_migrations` table) — idempotent, fail-loud, honouring the transactional / `--no-transaction` split. `drizzle-kit
  generate` is **not** adopted.
- **Options considered:** (A) *this* — raw SQL + custom runner [chosen: zero source-of-truth fork, matches the proven live
  path, full control of the CONCURRENTLY split]; (B) full Drizzle ORM — author a `schema.ts`, `generate` table DDL, hand-add
  the rest [rejected: `schema.ts` forks Rule 0; generate covers only ~⅓ of 0001]; (C) drizzle-kit `migrate` over
  hand-authored custom SQL [rejected: finicky journal/transaction semantics for the non-txn 0001b, no upside over (A)].
- **What this does NOT change:** the migration *content* is still authored strictly to `schema.md` et al.; per-deployment
  apply-on-release + failure isolation stay as specified (ISSUE-081); `migrations.md`'s expand-contract discipline is
  enforced by `app/silo/src/discipline.ts` (AC-NFR-INF.002.1). If the operator prefers literal `drizzle-kit`, the migration
  SQL is reusable as-is under drizzle's custom-migration mode.
- **Status:** 🟡 RECOMMENDATION — implemented in session 62; **flag for operator confirmation**. Deviation from
  `migrations.md` L9-10 wording is recorded here (Rule 0), not silent. A one-line note added to `migrations.md`.

---

## OD-177 — The 9-agent roster seed is under-specified: `memory_scope` jsonb shape + `name` literal 🟢 RESOLVED (2026-07-04, session 62; name amended, memory_scope owed to ISSUE-063)

- **Resolution (operator-delegated, "long-term"):** (1) **`name` conflict CLOSED** — **FR-8.REG.001 amended** (change-control)
  to drop the design-doc `{client_slug}_<role>_agent` pattern in favour of the **bare role slug** (`orchestrator`/`research`/…),
  since OD-096 forbids `client_slug` on a silo table and there is one client per silo (no value to interpolate). This matches
  what ISSUE-008 `0001d` already seeded + the live silo. (2) **`memory_scope` jsonb shape** stays **owned by its consumer
  ISSUE-063** (per-agent memory scoping) — not an open fork but tracked downstream work; seeded **fail-closed `'{}'`** now
  (retrieves nothing — AC-8.SCO.001.3), so the live silo is safe until ISSUE-063 wires the real scope (a data update,
  expand-contract-safe). (3) `max_tokens` stays null (model default) until ISSUE-062/063 tune it. **No residual fork; the
  only owed item is ISSUE-063's scope wiring, tracked in that issue.**

- **OD-177 — a genuine spec gap the 0001 seed hit (not a guess to paper over).** `agents` has `memory_scope jsonb not null`
  — the per-agent least-privilege retrieval filter, a **#2 containment control**. FR-8.REG.006 says provisioning seeds it
  "(SCO matrix)", but the spec fixes only a **conceptual** access matrix (component-08 L3467-3476), **not the concrete jsonb
  shape** (keys/structure). That shape is fixed by its **consumer, ISSUE-063** (per-agent memory scoping, Stage 8). Two
  companion gaps: (a) `name` has no fixed literal — FR-8.REG.001's pattern `{client_slug}_<role>_agent` **embeds
  client_slug, which OD-096 forbids on any silo table** (a spec conflict); (b) `max_tokens` is unspecified.
- **Decision taken in 0001d (safe, invariant-upholding, documented):** seed the roster **fail-closed** — `memory_scope =
  '{}'::jsonb` (empty = retrieves nothing, exactly the fail-closed rule **AC-8.SCO.001.3**), so no *invented* containment
  value is shipped in the gate migration; `name` = the bare role slug (no client_slug — honours OD-096); `max_tokens = null`;
  `description` = verbatim design-doc prose (L3423-3439); `tools_allowed = '{}'` (no tool rows exist at first boot).
- **Owed / to resolve:** **ISSUE-063** fixes the concrete `memory_scope` jsonb shape and wires each agent's real scope (a
  data update, not a schema change — expand-contract-safe). At that point: (1) define the jsonb structure; (2) reconcile the
  FR-8.REG.001 name pattern vs OD-096 (drop the client_slug segment from the FR, or confirm slug-only); (3) decide
  per-agent `max_tokens` (or leave null = model default). Until then the silo boots with a fail-closed roster — safe (#2),
  and nothing runs on the human path until Stage 3+ anyway.
- **Status:** 🟡 OPEN — non-blocking for ISSUE-008 (its DoD ACs do not touch agent scope) and for Checkpoint 1. Resolve at
  ISSUE-063; carry as a tracked residual.

---

## OD-178 — `config_values` defaults seed deferred from 0001 to ISSUE-010 (Config store) 🟢 RESOLVED (2026-07-04, session 62, ISSUE-008)

- **OD-178 — where the ~117 config defaults + structured objects get seeded.** ISSUE-008 §6 lists "default
  entity_types/expected_slots/config defaults" among 0001's seed. But **ISSUE-010's title is "Config store +
  audit-immutability"** — it owns `config_values` and the change-controlled edit path. The defaults are numerous, several
  are OD-gated, and transcribing ~117 values into the gate migration risks Rule-0 drift against `config-registry.md`.
- **Decision:** **defer the `config_values` defaults seed to ISSUE-010** (which owns the store + its audit trail). 0001d
  seeds only the fully-specified, security-/structurally-load-bearing data (6 roles, the role×node matrix, the 9-agent
  roster, the Internal-Org singleton, `deployment_settings`). The Internal-Org entity seeds fine without the config
  (entities.type is a plain `text` column; the entity_types validation is app-level). This mirrors the RLS split (policies →
  ISSUE-009) — the gate migration lands the schema + the invariant-critical seed; the specialised issues own their data.
- **Owed:** ISSUE-010 seeds `entity_types`, `expected_slots` (shape only — concrete per-type content is onboarding-authored,
  ISSUE-030), `ef_search` (default 40), and the rest of the Tier-2 defaults into `config_values`, idempotently, on first boot.
- **Status:** 🟢 RESOLVED (deferral logged; **operator-ratified session 62** — "keep deferred to ISSUE-010"). ISSUE-008 §6
  seed scope reduced accordingly — recorded here, not silent (#3). ISSUE-010 owns seeding the `config_values` defaults.

---

## OD-179 — `event_type` enum lacks values for the FR-0.WHK.* webhook event_log writes 🟢 RESOLVED (2026-07-05, ISSUE-017 build gap-sweep; additive enum change-control)

- **OD-179** ⚠️ **#3 build-input gap (surfaced by the ISSUE-017 zero-context verification pass).** The Component-0 WHK
  FRs mandate `event_log` writes on the verified-webhook path — `FR-0.WHK.001` ("verified → `event_log`"),
  `FR-0.WHK.008` (replay-drop + rate-throttle → `event_log`), and `FR-0.WHK.005` (the >threshold failure alert) — but the
  `event_type` enum in `schema.md` §8 (L110-115) admitted **no value** for any of them. The live `WebhookStore` adapter
  (`app/webhook-auth/src/supabase-store.ts`) therefore could not `INSERT` a verified-accept / replay-drop / rate-throttle /
  failure-alert row without an unspecified schema change — and the in-memory fake typed `event_type` as a bare `string`, so
  the offline suite passed while the real DDL would reject every one of those writes (`invalid input value for enum
  event_type`). Exactly the OD-170 pattern (an FR names an `event_log` write the enum can't type), surfaced one issue later.
- **✅ Resolution (additive, expand-contract-safe; no behaviour change):** four enum values added to `event_type`
  (`schema.md` §8) via change-control, matching OD-170's precedent:
  - **`webhook_verified`** — FR-0.WHK.001 verified-webhook accept row (the seam hand-off to C2/C3 is logged).
  - **`webhook_replay_dropped`** — FR-0.WHK.008 a verified event whose ID was already seen in the replay window (dropped, no re-trigger).
  - **`webhook_rate_throttled`** — FR-0.WHK.008 a verified source over `CFG-webhook.accept_rate_limit` (throttled, excess not handed off).
  - **`webhook_failure_alert`** — FR-0.WHK.005 the >`failure_alert_threshold`/source/hour Super-Admin alert row.
  The `app/webhook-auth` code + tests cite these values by name; no FR text changes (the FRs already named the `event_log`
  write — this only gives it a typeable value). The TS `EventLogRow.event_type` stays `string` in the fake for assertion
  convenience; the live adapter now emits the enum-valid strings.
- **Owed (tracked, not silent — #3):** applying this additive enum change to the **live** client silo is a `0002` enum-add
  migration, owed at the **ISSUE-017 onboarding live run** (the same OD-172 deferral that re-gates the live per-connector
  webhook confirmation). Until that migration runs, the live adapter's `event_log` writes would fail against the *current*
  silo — which is fine, because per OD-172 the live path is not exercised until onboarding. ISSUE-081 (migration propagation)
  is the mechanism that carries the enum-add to each deployment.
- **Status:** 🟢 RESOLVED (schema source-of-truth updated; live migration owed at onboarding per OD-172). Does **not** block
  ISSUE-017 `done` — the DoD ACs are all proven offline against the reference model; the enum gap only affected the
  not-yet-run live adapter, and the source of truth now admits the writes.

- **OD-180** ⚠️ **CHANGE-CONTROL on a locked non-negotiable (NFR-CMP.006 audit-sink immutability) — surfaced by the
  Stage-2 fan-out verification (session 66).** `enforce_audit_append_only()` (`0001_baseline.sql`, verbatim from
  `schema.md` §Immutability enforcement) forbids `DELETE` on all four append-only sinks (`event_log`, `guardrail_log`,
  `access_audit`, `config_audit_log`) **unconditionally**. But a `BEFORE DELETE` **row-level trigger fires for every
  role** (incl. `service_role` and the table owner) — privilege cannot bypass it. So the retention pruning that
  **FR-7.LOG.006 / AC-7.LOG.008.2 / AC-7.LOG.006.1** mandate (delete rows past the configured window, never below the
  audit/compliance floor) is literally un-runnable: the live `prune()` on `event_log` (ISSUE-011) **and** on
  `config_audit_log` (ISSUE-010) always throws. The spec text calls retention "a separate privileged job" but never gave
  that job a path through the immutability wall; the offline `InMemory*` reference models masked the gap with a plain
  `Map.delete`. This is a genuine #1-vs-#2 tension: either the audit trail grows unbounded (retention never runs) or
  someone disables the immutability trigger to prune (a tamper hole). Per R2, a red launch-gating mechanism is a design
  fork, not a code-around — logged here, operator-decided.
- **Options weighed:** **(A) GUC-whitelist branch** — a transaction-local session flag (`app.retention_prune='on'`, set
  via `set local`, auto-reset at commit) that the retention job alone sets; the trigger allows `DELETE` only under it,
  every other delete still rejected. **(B) `session_replication_role=replica`** owner job — disables ALL triggers for the
  job's session (broader blast radius; needs elevated privilege `service_role` may lack on Supabase). **(C) partition +
  DROP old partitions** — cleanest (no DELETE path ever) but a significant schema change beyond Stage 2; retention stays
  un-pruned meanwhile. **(D) redaction-only, never delete** — simplest/most-immutable but unbounded growth, contradicts
  FR-7.LOG.006's configurable-window pruning.
- **✅ Resolution (operator-decided 2026-07-05, session 66 — Option A):** add the GUC-whitelist branch to
  `enforce_audit_append_only()` via **migration `0005_retention_prune_whitelist.sql`** (`create or replace` the one
  function — additive, no DROP, re-binds no triggers; passes the expand-contract discipline gate). A `DELETE` is allowed
  **iff** the executing transaction has `current_setting('app.retention_prune', true) = 'on'`; normal writes/deletes by
  any role stay rejected exactly as before — immutability for the non-retention path is unchanged. **Floor safety (#1)
  stays in the retention JOB** (app-code: it selects only past-floor, non-referenced row ids and deletes them inside the
  flagged transaction) — the trigger gates only *that* a delete happens within a declared retention transaction, not the
  floor (which is per-sink policy the trigger can't know). **Tamper surface (#2), stated:** only `service_role` can DELETE
  at all (0001c `revoke delete` from anon+authenticated), and the GUC is a second explicit per-transaction opt-in — a
  retention delete is auditable-by-construction (the setting job is the only intended setter). A stricter external
  retention-volume monitor is an ops concern (AF-139 family), not this trigger's job.
- **Change-control trail:** `schema.md` §Immutability enforcement updated with the whitelist branch + a pointer here (the
  source of truth must match the migration — Rule 0). The reference models (`app/config-store`, `app/observability`) now
  model the same whitelist (reject `prune()` unless the retention flag is set) so the offline suite is faithful to DB
  truth; the live `supabase-store` adapters issue `set local app.retention_prune='on'` inside the prune transaction.
- **Status:** 🟢 RESOLVED (operator Option A). Live proof (normal DELETE still rejected · a `set local`-flagged retention
  delete succeeds · floor rows survive) is owed at the **Stage-2 checkpoint** capstone. Unblocks ISSUE-010 + ISSUE-011.

- **OD-181** **Config key→PERM-config group mapping is an explicit registry transcription with a fail-closed default
  (ISSUE-010; surfaced by the Stage-2 fan-out verification, session 66).** `config_values` key-prefix RLS
  (`0003_config_values_rls.sql` `config_key_group()` + its `keygroup.ts` mirror) must map each config key to the
  `PERM-config.*` node that owns it. The registry (`config-registry.md` §"Permission gates" + sections A–N) is the
  authoritative key→section→node table, but its keys are **overwhelmingly bare** (only sections A/B/C use dotted
  prefixes); the fan-out's first cut used *content-based* prefixes (`rate_`/`cost_`/`risk_`/`anomaly_`/`backoff_`) that
  **cross-routed 8 keys into the wrong delegable gate** (a real #2 leak, live in the RLS) and fail-closed-over-restricted
  ~72 more. **✅ Resolution:** rebuild the map as an **explicit per-key transcription of the registry** (not heuristic
  prefixes — only the genuinely-uniform `auth.`/`webhook.`/`support.` families stay prefix-matched, all → `PERM-config.auth`),
  with the section-D RBAC keys (`clearance_review_*`) explicitly → `PERM-config.guardrails` per their registry row, and an
  **unmapped key fails closed → `PERM-config.infra`** (Super-Admin-only, never delegable) so a newly-added registry key
  denies-by-default rather than leaking (#2). The registry stays the source of truth; the SQL + TS map encode it and the
  `check` gate + tests pin **every** registry key (not a sample) against the expected node so any future divergence fails
  the build. **Status:** 🟢 RESOLVED (implementation-level authorization-scope decision; no FR/registry text changed —
  the map now matches the registry it always should have).

---

## OD-182 — audit-immutability trigger must permit a monotonic ESCALATION stamp 🟢 RESOLVED (2026-07-05, Stage-3 fan-out verification, session 69; change-control on the live append-only invariant)

- **OD-182** ⚠️ **#1/#3 live-invariant gap (surfaced by the ISSUE-059 adversarial verify).** The live
  `enforce_audit_append_only()` trigger (0001 baseline + OD-180 patch in 0005) permits a `guardrail_log` UPDATE **only**
  for a forward status transition (`pending → approved|rejected|modified`). But **ISSUE-057** (`markEscalated`) and
  **ISSUE-059** (`escalateStale`) must stamp `escalated_at` on a still-`pending` row when a quarantine/anomaly sits
  un-actioned past its staleness window — i.e. an `escalated_at`-only UPDATE with **no** status change. Against the
  un-amended trigger that UPDATE hits `raise exception 'in-place UPDATE forbidden'` and **rolls back**, so a stale
  quarantine is **never escalated** — the exact never-silently-abandon guarantee (`AC-6.ANM.003.2` / `AC-6.INJ.006.4`)
  fails at the DB layer (#1 lost signal / #3 silent). The same gap applies to `injection_quarantine`, which the baseline
  never bound to the append-only trigger at all.
- **Options.** (A) Widen the trigger to permit a strictly-monotonic, content-preserving escalation/review mutation.
  (B) Model escalation as a NEW row (a separate escalations sink) so audit rows are never mutated. (C) Route escalation
  through `service_role` only — rejected: the trigger fires regardless of role, and bypassing it would gut the guarantee.
- **✅ Resolution (Option A — matches the schema's intent; `escalated_at` is an on-row server-owned column by design).**
  Migration **`0009_guardrails_append_only.sql`** `create or replace`s the function, **preserving every existing branch
  byte-for-byte** and adding: (1) a `guardrail_log` branch permitting `escalated_at` null→timestamp on a `pending` row
  with status/description/task_id/guardrail_type/reviewers unchanged and `action_blocked` only `false→true` (escalation
  never un-blocks); (2) an `injection_quarantine` branch permitting a **write-once** `human_decision` (`null →
  discard|approved_safe`) and a monotonic `escalated_at` while the **shadow-retained `quarantined_content` /
  `guardrail_log_id` / `created_at` stay immutable** (#1 retain); (3) binding `t_append_only` to `injection_quarantine`
  + a normal-role DELETE revoke. The mutation is monotonic and content-preserving, so the tamper-evidence guarantee is
  intact — nothing already written is ever rewritten or erased; only null→value forward stamps are allowed.
- **Reference-model faithfulness (Rule 0).** The ISSUE-057/059 in-memory fakes model this exact whitelist (the drift the
  verify caught was that the fakes had no trigger and accepted mutations the DB would reject). `schema.md` §Immutability
  enforcement is updated with the two branches + a pointer here.
- **Status:** 🟢 RESOLVED. Authored offline + passes the app/silo discipline+RLS `check`. **Live proof owed at the
  Checkpoint-3 capstone (operator-present):** a normal in-place mutation still rejected · an `escalated_at`-only stamp on
  a pending guardrail row succeeds · `quarantined_content` rewrite/delete rejected. Unblocks ISSUE-057 + ISSUE-059 + ISSUE-060.

---

## OD-183 — AC-3.CONN.005.2 (Drive scope default) belongs to the connector-instance issues, not the connector-agnostic runtime 🟢 RESOLVED (2026-07-05, ISSUE-032 adversarial verify, session 69)

- **OD-183** **DoD-scope correction (surfaced by the ISSUE-032 verify).** `AC-3.CONN.005.2` ("Drive default config →
  `drive.file` requested, not `drive.readonly`, unless full-corpus ingest is explicitly enabled") is bound to
  `CFG-drive_full_corpus_ingest` and a specific connector's scope strings. ISSUE-032 is the **connector-agnostic** shared
  runtime + registry + contract — by design (`§2`) it holds **no per-connector scope strings** and makes no drive.file-vs-
  readonly decision (`requestedScopes()` only concatenates the caller's read/write scopes and filters delete-granting
  ones). The runtime's genuine scope-safety AC — `AC-3.CONN.005.3` (delete-granting scopes excluded) — **is** real runtime
  machinery and is genuinely tested. Proving `005.2` here required a fixture tautology (hand-set `drive.file`, assert it
  echoes back), which overstates what is verified.
- **✅ Resolution.** `AC-3.CONN.005.2`'s proof is **deferred to the connector-instance issues (ISSUE-039 GHL / ISSUE-040
  Google / ISSUE-041 Slack)** — specifically the Google connector (ISSUE-040), which owns the Drive scope strings +
  `CFG-drive_full_corpus_ingest` default binding (`FR-3.OBS.003` / `AC-3.OBS.003.1`). ISSUE-032 is marked done on its
  genuine contract/registry ACs; the tautological `005.2` fixture test is removed from ISSUE-032 and the AC is tracked as
  owed at ISSUE-040. No FR text changes — the AC simply verifies where the code that satisfies it actually lives.
- **Status:** 🟢 RESOLVED (build-test DoD-scope correction; carries a coverage obligation onto ISSUE-040).
