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
**Carry-forward:** ADR-003 spawned a C6 cost-ladder enforcement FR that **C6 (session 23) did not write**, and C5's
seam line previously read "C7 enforces" (corrected this session via change-control) — the **owed C6 cost-ladder FR**
is tracked (session log) for when C6 is next touched.

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
notes across REG/SCO/PLAN FRs. *(New permission node implied — to wire at C1 reconciliation: `PERM-agent.edit_capability`
Super-Admin-only vs `PERM-agent.edit_routing` Admin-allowed.)*

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

> Next OD number: OD-082.
