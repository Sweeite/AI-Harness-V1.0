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

## OD-010 — Compensation / rollback for partially-completed task chains 🔴
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

## OD-011 — Slack app registration class (Marketplace / internal-custom) for history ingest 🟡
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

> Next OD number: OD-039.
