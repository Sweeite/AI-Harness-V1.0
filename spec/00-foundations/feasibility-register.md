# Assumptions & Feasibility Register

Every claim or assumption that **can only be confirmed by testing** lives here. A spec proves
the design is *coherent*; it cannot prove the design *works*. This register tracks the gap.

**The contract:** if a requirement or ADR depends on an unproven assumption, it gets tagged
`⚠️ FEASIBILITY: AF-NNN` at the point of use, and an entry is created here. Nothing unproven
is ever presented as proven. These items are *expected to be tested* — surfacing them is the
safety mechanism, not a problem.

**Verification methods:** `DOCS` (confirm from vendor documentation / research) · `SPIKE`
(build a throwaway to prove it) · `EVAL` (measure output quality on real data) · `LOAD`
(test under volume).

**Status:** 🔴 unverified · 🟡 verifying · 🟢 verified · ⛔ failed (forces redesign)

---

## ⭐ Priority spikes — do these alongside the ADR phase (they can invalidate the architecture)

| ID | Spike | Why it's priority | Method | Status |
|---|---|---|---|---|
| AF-001 | **Cost spike** — run one real multi-agent task + memory write, measure actual tokens/$ | Validates the ADR-003 viability target (typical-volume deployment ≤ ~$20/day, under the $50 soft alert). Also measures memory-write cost (now corrected to ≤1 Sonnet + Haiku, AF-043) and feeds AF-042. Most likely thing to invalidate the design. | SPIKE+EVAL | 🔴 |
| AF-002 | **Memory retrieval spike** — load ~100 real memories, run dual-search + ranking, judge relevance | If retrieval surfaces noise, the whole "business brain" premise is shaky. Validates ranking weights. | SPIKE+EVAL | 🔴 |
| AF-003 | **Vendor-claims verification** — confirm every external limit/capability the doc asserts | Several are checkable and possibly stale; they shape rate-limit, token, and Realtime design. | DOCS | 🟡 **DOCS pass done 2026-06-23** — see Block A findings below. 3 claims stale/refuted (AF-010/011/014), 1 design-fork found (AF-012 Slack → OD-011). Residual: AF-019 stays SPIKE/LOAD-open; AF-012 needs EVAL on a live workspace. |
| AF-004 | **Provisioning/deploy spike** — run the ADR-005 §5 path end-to-end: operator Railway app deploying from the shared repo against a **client-owned** Supabase, with env + secrets + `internal_token` minted/dual-stored + `client_registry` row + first-boot seed all green | Proves the ADR-001 hybrid + ADR-005 provisioning script actually wire up before we spec it in full. | SPIKE | 🔴 |

---

## A. Vendor capability claims (verify by DOCS / research — AF-003 umbrella)

| ID | Claim (from design doc) | Source | Status |
|---|---|---|---|
| AF-010 | Google APIs: 100 req/100s/user; Gmail 250 quota units/user/sec | L2120-2126 | 🟠 **STALE** — see F1 |
| AF-011 | GHL: 120 req/min/location, hard limit, no burst | L2128-2131 | ⛔ **REFUTED** — see F2 |
| AF-012 | Slack: ~1 req/sec typical; Retry-After header on 429 | L2133-2138 | 🟠 **STALE + design fork** — see F3, OD-011 |
| AF-013 | Google access token 1h; refresh token dies after 6mo unused; prod needs verified OAuth app | L2275-2279 | 🟢 **VERIFIED** (sharper) — see F4 |
| AF-014 | GHL access token 1 day; refresh valid indefinitely | L2281-2284 | ⛔ **PARTLY REFUTED** — see F5 |
| AF-015 | Slack bot tokens don't expire; revocable by workspace admin | L2286-2290 | 🟢 **VERIFIED** — see F6 |
| AF-016 | Supabase Realtime: 200 (free) / 500 (pro) concurrent connections | L3134-3136 | 🟢 **VERIFIED** (soft quota) — see F7 |
| AF-017 | Supabase Edge Functions 150s execution limit (the reason to use Inngest) | L2630 | 🟠 **STALE** — see F8 |
| AF-018 | Inngest: no execution-time limit, step-level retries, DLQ, generous free tier | L2632-2662 | 🟢 **VERIFIED** (wording fixes) — see F9 |
| AF-019 | pgvector HNSW maintains fast/accurate search at millions of vectors | L1477-1489 | 🟡 **HNSW verified; perf stays SPIKE/LOAD-open** — see F10 |
| AF-020 | Railway native per-project GitHub auto-deploy + running `drizzle-kit migrate` on release behave as assumed (ADR-005 §1) | ADR-001 §6 | 🟢 **VERIFIED** (caveat) — see F11 |
| AF-021 | Operator Railway can securely connect to a client-owned Supabase (hybrid model) | ADR-001 §5 | 🟢 **VERIFIED** (caveats) — see F12 |

### AF-003 DOCS verification findings (2026-06-23) — corrected values + sources

Primary-source verification of the Block A claims. Where a claim is **stale/refuted**, the corrected
value below is the one the spec must cite. Items touching a locked decision are flagged; none force an
ADR supersede (these are vendor facts, not architecture), but the corrected numbers must propagate into
Phase-1/2 rate-limit, token-lifecycle, and Realtime requirements.

- **F1 · AF-010 (Gmail) — STALE.** "250 quota-units/user/**sec**" is retired. Current: **6,000 QU/min/user**
  + 1,200,000 QU/min/project. **Date-dependent:** projects active Nov 2025–Apr 2026 keep old quotas; only
  projects created **on/after 2026-05-01** get the new per-minute figures → the limit a Silo gets depends on
  **GCP project activation date** (pin per-environment, don't cite one number). Quota-unit model confirmed
  (`messages.send`=100, `.get`=20, `.list`=5). Src: developers.google.com/workspace/gmail/api/reference/quota
- **F2 · AF-011 (GHL) — REFUTED.** Not "120/min, no burst." Real v2 model: **100 req / 10 s burst** +
  **200,000 req / day**, scoped **per Marketplace app per location**. No per-minute limit exists. Daily cap is
  the real ceiling for high-volume sync. Headers expose it (`X-RateLimit-*`, `X-RateLimit-Limit-Daily`). Src:
  help.gohighlevel.com/support/solutions/articles/48001060529
- **F3 · AF-012 (Slack) — STALE + DESIGN FORK.** "~1/sec" is only the special posting tier; real model is
  tiered (T1 1+/min · T2 20+/min · T3 50+/min · T4 100+/min). Retry-After on 429 ✓. **The fork (→ OD-011):**
  since **2025-05-29**, non-Marketplace apps have `conversations.history`/`.replies` cut to **Tier 1 (1 call/min,
  `limit` max 15)** — ~15 msgs/min/token, lethal for history ingest. **Exempt:** Marketplace-approved apps **and
  internal custom apps** (keep 50+/min × 1,000). Needs an EVAL on a live workspace once we build ingest. Src:
  docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps
- **F4 · AF-013 (Google OAuth) — VERIFIED, sharper.** Access token ~1 h (design to `expires_in`, not a constant).
  Refresh token: **Testing-status apps expire it in 7 days** (Gmail scopes don't get the name/email exception) →
  must publish to Production; Production tokens don't age out but **die after 6 months unused** and are **revoked
  on user password reset**; **100-refresh-token-per-account-per-client-id cap** (101st silently kills the oldest)
  — load-bearing for a Silo reusing one OAuth client across users. Restricted-scope (Gmail) verification = **CASA
  security assessment, re-done ≥ every 12 months, ~weeks lead time** → onboarding critical-path (already AF-013 in
  ADR-005). Src: developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- **F5 · AF-014 (GHL OAuth) — PARTLY REFUTED.** Access token ~24 h ✓. Refresh token is **NOT indefinite** — it's
  **single-use/rotating** (each refresh returns a new one, invalidates the old) and **expires after 1 year unused**.
  ⚠️ **non-negotiable #1 risk:** the harness **must persist the new refresh token after every refresh** or it
  silently loses GHL access. (30 s concurrency window returns the same token — race-safe.) Src:
  marketplace.gohighlevel.com/docs/Authorization/OAuth2.0
- **F6 · AF-015 (Slack tokens) — VERIFIED.** `xoxb` non-expiring by default, admin/uninstall-revocable
  (`tokens_revoked` event). Optional rotation → 12 h tokens, prefix changes `xoxb`→`xoxe` (code must handle if
  enabled). Src: docs.slack.dev/authentication/tokens
- **F7 · AF-016 (Realtime) — VERIFIED, soft.** 200 Free / 500 Pro **concurrent connections** confirmed but these
  are **adjustable defaults, not hard caps** (Pro overflow bills ~$10/1k). Separate ceilings — **messages/sec** and
  **channel-joins/sec** (Free 100 / Pro 500) — often bind first. Model capacity as a provisionable quota. Src:
  supabase.com/docs/guides/realtime/limits
- **F8 · AF-017 (Edge Functions) — STALE.** "150 s" is **Free-only** wall-clock; **paid = 400 s**. The real
  binding constraint is the **2 s CPU-time cap on ALL plans** (excludes async I/O wait) — that, not wall-clock, is
  why long/CPU-bound work offloads to Inngest. Cite "2 s CPU (all plans) + 400 s paid wall-clock," not "150 s." Src:
  supabase.com/docs/guides/functions/limits
- **F9 · AF-018 (Inngest) — VERIFIED, two wording fixes.** Durable long functions ✓ but **per-step cap ≤ 2 h** —
  decompose accordingly (so "no execution limit" is true at function level, false at step level). Step-level retries
  ✓ (default 4). "DLQ" → correct mechanism is **`onFailure` / `inngest/function.failed`** event. Per-key concurrency
  (`concurrency.key`) ✓ — **confirms the ADR-004 assumption**. Footguns to log: Free **concurrency = 5**; billing
  counts **every step** as an execution (50k executions ≠ 50k jobs). Src: inngest.com/docs/guides/concurrency,
  inngest.com/docs/usage-limits/inngest
- **F10 · AF-019 (pgvector) — HNSW verified; perf stays open.** HNSW supported since 0.5.0; iterative index scans
  since 0.8.0 (current 0.8.x on Supabase). **Keep AF-019 SPIKE/LOAD-open:** WHERE/RLS filters apply **after** the
  ANN scan, so under **per-client RLS (ADR-006) selective filters can starve recall** — iterative scans mitigate but
  must be enabled+tuned (`ef_search`, `maintenance_work_mem`). Must be LOAD-tested **with RLS predicates applied**,
  not bare ANN benchmarks. Src: github.com/pgvector/pgvector
- **F11 · AF-020 (Railway) — VERIFIED.** Per-service GitHub auto-deploy with **configurable trigger branch per
  environment** + optional "Wait for CI" → **supports the ADR-005 canary/release-train branch model** (corroborates
  AF-064). **Pre-Deploy Command** runs between build and cutover and **blocks deploy on failure** → `drizzle-kit
  migrate` as a release-phase migration works as assumed. ⚠️ Caveat: pre-deploy runs in an **isolated container, no
  volumes mounted** — fine for a network DB migration, not for volume-dependent ones. Src:
  docs.railway.com/deployments/pre-deploy-command
- **F12 · AF-021 (cross-account Supabase) — VERIFIED.** No technical barrier — a Supabase project is Postgres + an
  API gateway; an external host connects with the connection string / service-role key regardless of dashboard
  ownership (Supavisor pooler IPv4-only; direct needs IPv4 add-on). ⚠️ Two security caveats, load-bearing under
  ADR-001 hybrid ownership + ADR-007 containment: (1) the **service-role key bypasses RLS entirely** (god-mode on the
  client's DB — a #2 containment concern, links ADR-006 service-role-bypass note); (2) the client *can* IP-allowlist
  the operator, but that **assumes the operator compute has a static egress IP** — verify before relying on it. Src:
  supabase.com/docs/guides/platform/network-restrictions

## B. Behavioral / quality feasibility (verify by EVAL / SPIKE — unprovable on paper)

| ID | Assumption | Status |
|---|---|---|
| AF-030 | Orchestrator routes to the correct agent from descriptions alone (the doc's claim that routing quality = description quality) | 🔴 |
| AF-031 | Memory writer produces clean semantic/episodic/procedural splits with sensible confidence | 🔴 |
| AF-032 | Prompt-injection defenses (regex + embedding similarity + boundary tags) actually hold — and don't over-quarantine legit content | 🔴 |
| AF-033 | Answer-mode classification (Cited/Inferred/Unknown) is accurate enough to trust | 🔴 |
| AF-034 | Slot-fill **Maturity** predicts "system is useful" for gating, **and** the Retrieval Sufficiency threshold cleanly separates `[Building]` from `[Unknown]` (ADR-002). Validate in AF-002 spike; if slot-fill doesn't predict retrieval adequacy, revisit the one-substrate coupling. | 🔴 |
| AF-035 | Two-model routing (Haiku for classification, Sonnet for reasoning) saves enough to matter **AND the cheap model is good enough** — i.e. Haiku's classification/gate decisions and Sonnet's routing don't lose quality. **Standing dual-track telemetry (not a one-off):** every routed call records model + task type + tokens/$ (**cost track**) and a correctness signal — gate false-drops, mis-routes, classifier errors (**quality track**) — so routing config is tuned with evidence. Cost win is worthless if quality silently degrades. | 🔴 |

## C. Cost feasibility (verify by measurement — AF-001 umbrella)

| ID | Assumption | Status |
|---|---|---|
| AF-040 | A real task's end-to-end cost (orchestrator + research + specialists + memory writes) is acceptable — sits under the ADR-003 viability target (≤ ~$20/day typical) | 🔴 |
| AF-041 | The $50/day soft-alert + $100/day hard-ceiling defaults (ADR-003 cost ladder) are realistic for a working deployment | 🔴 |
| AF-042 | The **token-derived cost estimate** (ADR-003) stays close to — and biased above — the real vendor invoice. The fail-safe round-up must keep drift conservative so the hard ceiling fires early, not late. Validate by reconciling estimate vs a real Anthropic/OpenAI bill. | 🔴 |
| AF-043 | The **Haiku selective-writing gate** (ADR-003 §4/§6) filters enough events to pay for its own Haiku cost vs running the Sonnet writer unfiltered, **and is accurate enough to trust** (low operator disagree-rate). Validated by the **Haiku decision log + 3-week shadow-retain trust window** (ADR-003 §8) — manual review is the gate to autonomy. If it fails either bar, drop or retune it (controls-before-gates). | 🔴 |

## D. Performance / scale feasibility (verify by LOAD)

| ID | Assumption | Status |
|---|---|---|
| AF-050 | Loops don't back up at ~20 concurrent client deployments | 🔴 |
| AF-051 | Vector search latency stays acceptable as memories grow | 🔴 |
| AF-052 | Consolidation/summarise jobs complete within Inngest comfortably at volume | 🔴 |

## E. Concurrency feasibility (ADR-004 — verify by SPIKE / LOAD / DOCS)

| ID | Assumption | Method | Status |
|---|---|---|---|
| AF-061 | The **optimistic validate-and-commit closes the TOCTOU window** (ADR-004 §3): running the Sonnet writer unlocked, then a short locked transaction that re-checks a per-entity watermark and re-runs only the cheap DB contradiction check on change, actually catches same-entity races **without livelock or excessive re-runs**. The whole correctness claim rests on this — it is the core thing that can only be proven by testing. | SPIKE+EVAL | 🔴 |
| AF-062 | **Sorted per-entity Postgres advisory locks + short commit transactions don't bottleneck under fan-out at scale** (`L2115`, ~20 concurrent deployments), and multi-entity writes (locking 2–3 entities each, in sorted order) stay **deadlock-free** and contention-light. | LOAD | 🔴 |
| AF-063 | **Inngest per-key concurrency serializes same-entity steps** as ADR-004 §2 assumes — and if it doesn't, the design **degrades safely** to "advisory lock alone" (the lock, not the queue, is the correctness boundary). | DOCS+SPIKE | 🔴 |

## F. Deploy / provisioning / version-skew feasibility (ADR-005 — verify by SPIKE / DOCS / EVAL)

| ID | Assumption | Method | Status |
|---|---|---|---|
| AF-064 | **Railway supports the branch-based canary/release-train + promotion model** (ADR-005 §2): a canary deployment tracking a `release` branch, the fleet tracking `main`, promotion by fast-forward, and **build-history rollback** (§4). If Railway's branch/environment model differs, the *mechanism* changes but the *decision* (a canary gate before the fleet) stands. | DOCS+SPIKE | 🔴 |
| AF-065 | **Expand-contract migrations keep a mixed-version fleet safe** (ADR-005 §3/§4): a `vN` and a `vN-1` deployment both run correctly against their own schema through a rollout, **and prior code runs against the newer schema** (the rollback premise). Parts 3 + 4 of ADR-005 rest entirely on this. | SPIKE | 🔴 |
| AF-066 | **The synthetic canary corpus + smoke battery is representative enough** (ADR-005 §6/C2) to catch behavioral/data-dependent regressions (retrieval, memory contradiction, agent routing) before promotion — i.e. the canary is not a false sense of safety. Honest limit: it only catches what its fixtures + assertions cover. Shares the AF-001/AF-002 corpus. | EVAL | 🔴 |

## G. RLS / dynamic-roles feasibility (ADR-006 — verify by SPIKE / LOAD)

| ID | Assumption | Method | Status |
|---|---|---|---|
| AF-067 | **Live data-driven RLS performs on the hot retrieval path** (ADR-006 §D3/Axis 3): a `STABLE SECURITY DEFINER` permission lookup keyed on `auth.uid()`, evaluated **once per statement** over the (tiny, fully-indexed) permission tables, composes with **pgvector** ranking of a large memory batch without unacceptable latency. The whole D3 "read permissions live, no token cache" choice rests on this. **Fallback if it fails at scale:** denormalise permissions into JWT claims (the rejected D2), accepting a staleness window — logged as OOS-012. **⚠️ Critical precision (from the Supabase Auth research, 2026-06-24, Block J/SA15): `STABLE` alone does NOT guarantee once-per-statement evaluation inside an RLS policy** — Postgres re-evaluates the helper **per row** unless the call is **wrapped in a scalar subquery** `(select helper())`, which forces an `initPlan` that caches per-statement (Supabase's own benchmark: **178,000ms → 12ms**). So the ADR-006 design-doc framing ("evaluated once per statement if STABLE") is half-right and must become a **binding implementation rule**: wrap every `auth.*`/helper call in `(select …)`, index every policy-referenced column, scope policies `TO authenticated`, and wire the `auth_rls_initplan` advisor lint (lint 0003) into CI. The spike still validates latency at scale, but the per-row cliff is now a known, avoidable footgun, not an open risk. Src: supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv; GitHub Discussion #14576. | SPIKE+LOAD | 🔴 |

## H. Prompt-injection / containment feasibility (ADR-007 — verify by SPIKE / red-team)

| ID | Assumption | Method | Status |
|---|---|---|---|
| AF-068 | **The containment boundary holds end-to-end** (ADR-007 part 1): there is **no authorized-but-dangerous autonomous action path** by which injected instructions reach a consequential side effect — external communication, financial action, cross-client read, destructive write of a system of record, or memory poisoning — **without** passing a code-enforced hard limit / RBAC check / approval gate that **ignores prompt content**. Verified by red-teaming the harness with live injection payloads and confirming none escalate. This is the load-bearing claim of the whole posture; if a bypass path exists it must be **closed in code**, not patched with a detection rule. | SPIKE (red-team) | 🔴 |

## I. Backup & disaster-recovery feasibility (ADR-008 — verify by SPIKE / DOCS / LOAD)

| ID | Assumption | Method | Status |
|---|---|---|---|
| AF-069 | **A restore actually works end-to-end** (ADR-008 part 4): a recent backup — in-project PITR target *and* the off-platform `pg_dump` — restored into a throwaway project comes back **complete and queryable**, including **pgvector memory** and **`auth` user rows**, within acceptable downtime. Supabase makes **no backup-verification claim**, so "a backup exists" ≠ "a restore works" — the entire tested-restore guarantee (and thus non-negotiable #1) rests on this. Verified by a periodic restore rehearsal, logged. | SPIKE | 🔴 |
| AF-070 | **The Supabase Management API exposes the backup-health fields** the management-plane push needs (ADR-008 part 5): `GET /v1/projects/{ref}/database/backups` (+ project status) returns a **last-backup timestamp**, the **recovery tier (`pitr_enabled` / retention)**, and **project status (active / paused / billing-at-risk)** — enough to drive remote health monitoring **without** crossing any business data. Endpoint *existence* is DOCS-verified (2026-06-23); the **exact response payload is not** — confirm against the live API. If a field is missing, the monitor degrades to what *is* exposed + a coarser pause alert. | SPIKE | 🔴 |
| AF-071 | **Backup + off-platform region locality satisfies AU data residency** (ap-southeast-2 / Sydney). Supabase primary docs state backups live "in S3" but **do not pin the backup storage region** relative to the project, nor confirm cross-region behaviour — DOCS were **insufficient** (2026-06-23). Confirm via Supabase support / SLA before asserting any residency guarantee; the off-platform copy's region is operator-chosen and controllable. | DOCS (vendor confirmation) | 🔴 |
| AF-072 | **The hourly off-platform `pg_dump` completes within the hour — and restore time scales acceptably — for a large mature brain** (ADR-008 part 1/2/4). The portable off-platform copy is a scripted logical dump whose duration grows with the memory corpus; an **hourly** cadence is the *default RPO mechanism*, so this directly gates the default — confirm it fits the hour without hammering the DB, and that restore downtime stays acceptable at volume. **Fallback if it can't keep up:** back off the cadence (logged) or move that client to the **PITR upsell**. | LOAD | 🔴 |

## J. Supabase Auth platform feasibility (Component 0 research-first gate — verify by DOCS / SPIKE / EVAL)

Supabase Auth underpins all of Component 0 (Login). Per the research-first gate (`standards/tool-integration-research.md`)
and the AF-003 "vendor facts go stale" lesson, a **dated primary-source pass was run on 2026-06-24** (4 parallel agents,
supabase.com/docs + blog + changelog + github.com/supabase). Supabase is a *platform* dependency, so these live here, not
in `tool-integrations/` (that folder is for client-facing connectors). **C0 FRs must cite the corrected values below, not
the design doc.** The pass **refuted or corrected 6 design-doc claims** — exactly the hallucinations the gate exists to catch.

| ID | New must-test item raised | Method | Status |
|---|---|---|---|
| AF-073 | **HttpOnly cookie enforcement.** The design's "HTTP-only cookies, not localStorage (prevents XSS)" is **not** Supabase's documented default — `@supabase/ssr` stores session in cookies but docs say HttpOnly is *"not necessary"* and tokens are designed client-readable. Prove HttpOnly can be forced via `@supabase/ssr` cookie options **without** breaking client-side `getSession`/`getClaims`, or accept the non-HttpOnly default and mitigate XSS otherwise. | SPIKE | 🔴 |
| AF-074 | **Link-expiry 24h hard cap + invite/OTP coupling.** Confirm on hosted Supabase that the email OTP/invite/recovery expiry is **hard-capped at 86400 s (24 h)**, is a **global** project setting (not per-link), and that lowering the global slider also shortens invite links (vs a separate fixed invite TTL). This refutes the design's **72 h invite** and constrains the **24 h** setup link. | SPIKE+DOCS | 🔴 |
| AF-075 | **Microsoft Authenticator (and other RFC-6238 apps) enroll/verify against Supabase TOTP.** Supabase docs name Google Authenticator/Authy/1Password/Apple Keychain but **never name Microsoft Authenticator**; compatibility rests on the open `otpauth`/RFC-6238 standard, not a vendor statement. Verify by enrolling MS Authenticator against a live project if the client needs a named guarantee. | EVAL | 🔴 |
| AF-076 | **Org-wide end-user 2FA enforcement has no silent bypass.** There is **no project toggle** to require MFA for app end-users (the one that exists governs only Supabase *dashboard* team members). Enforcement must be **built**: restrictive RLS policies requiring `aal = 'aal2'` on **every** protected resource **plus** post-login app-layer gating that forces enrollment/challenge before granting access. Prove coverage is complete — one unprotected table = a silent aal1 bypass (non-negotiable #2 + #3). | SPIKE | 🔴 |
| AF-077 | **Login brute-force / credential-stuffing posture.** Supabase provides **no per-account lockout or login backoff**; the password sign-in grant has **no separately documented numeric rate limit** (shares the `/token` path's 1800/hr IP limit). Platform defenses = Cloudflare + fail2ban + IP limits + CAPTCHA (hCaptcha/Turnstile) + leaked-password protection (Pro+). If the spec requires per-account lockout, it is an **app-layer** responsibility to build. | SPIKE | 🔴 |

### Block J findings (2026-06-24) — corrected values + sources (cite these in C0, not the design doc)

Verdict key: ✅ VERIFIED · 🟠 STALE · ⛔ REFUTED · ⬜ UNCONFIRMED (not stated in primary docs).
> **Doc-date caveat:** Supabase docs pages carry **no visible last-updated date** — facts are stamped to fetch date **2026-06-24**; the dated anchors are the JWT-signing-keys blog (2025-07-14) and the passkeys changelog (2026-05-28). Set **`Re-verify by 2026-12-24`** (Supabase Auth moves fast: asymmetric-keys + API-key-format migrations both have live deadlines into late 2026).

- **SA1 · Session = JWT + rotating refresh token — ✅.** Access token = JWT; refresh token = opaque single-use string.
- **SA2 · Access token TTL 1 h — ✅.** Default 1 h, configurable ("JWT expiry limit"); rec floor 5 min, >1 h discouraged.
- **SA3 · Refresh token "7-day TTL" — ⛔ REFUTED.** Refresh tokens **never expire**; they **rotate single-use** with a **10 s reuse interval** and **reuse-detection that revokes the whole session** on suspicious reuse. Session lifetime is instead bounded by optional **time-box** + **inactivity-timeout** settings (**Pro+ plan, no default, enforced lazily at next refresh**, not proactively). ⇒ the design's `auth.session_refresh_days: 7` **maps to no native setting** — C0 must re-model session bounds (→ component-0 OD). The harness must persist the new refresh token on every rotation and handle reuse-detection → full-session-revocation as a failure mode.
- **SA4 · HTTP-only cookies, not localStorage — 🟠 STALE/REFUTED as default.** `@supabase/ssr` uses cookies but HttpOnly is *"not necessary"* per docs; tokens are meant to be client-readable. → **AF-073**.
- **SA5 · "Server-side session continues mid-task after client JWT expires" — ⛔ REFUTED (wrong mechanism).** No distinct server-side-session object exists. Real options: (a) `@supabase/ssr` middleware **refreshes** the JWT server-side, or (b) background work runs as **service_role** (bypasses RLS, **no `auth.uid()`**). C0 must pick one explicitly (→ component-0 OD); the two have very different security postures (#2).
- **SA6 · `auth.uid()` per-request-stable — ✅.** From JWT `sub`; returns `null` when unauthenticated (policies must not silently pass on null — #3).
- **SA7 · 2FA = TOTP + QR — ✅.** GA, **enabled by default** on all projects, 30 s interval, ±1 interval skew tolerance. Phone (SMS/WhatsApp) factor exists but opt-in (SIM-swap warning); Passkeys/WebAuthn beta (2026-05-28) is positioned as **primary** auth, **not** a 2FA factor — do **not** spec it as 2FA yet.
- **SA8 · Compatible w/ Google + Microsoft Authenticator — ✅ via open standard / ⬜ MS unnamed.** Docs name Google Authenticator/Authy/1Password/Apple Keychain; **Microsoft Authenticator is not named**. → **AF-075**.
- **SA9 · "2FA required" is a deployment config — ⛔ REFUTED for end-users.** No project-wide end-user MFA toggle; enforce via restrictive `aal2` RLS + app gating. → the design's `auth.two_factor_required` must be **built**, not flipped. → **AF-076**.
- **SA10 · Google + Microsoft/Azure as login IdP — ✅.** Azure provider slug `azure`; **pin the tenant** (single-tenant URL for org-only login), **require the `email` scope**, enable the **`xms_edov`** claim to reject unverified-email domains (#2).
- **SA11 · Invite link 72 h — ⛔ REFUTED.** OTP/invite/recovery link expiry is **hard-capped at 86400 s = 24 h**, a **global** project setting (not per-link); Supabase recommends ≤1 h and its advisor flags >1 h. ⇒ 72 h is impossible natively — C0 must either re-spec to ≤24 h or **build a custom invite-token layer** (own table + token + expiry + delivery). → **AF-074** + component-0 OD.
- **SA12 · Super Admin setup link 24 h — achievable with caveats.** Only by setting the global OTP expiry to 86400 s (which stretches **all** magic/recovery links to 24 h and trips the ≤1 h advisor) **or** a custom token. Seed = admin `createUser` (no password, no email sent) + `generateLink` (you deliver) or custom token.
- **SA13 · Invite-only (no self-register) — ✅.** "Allow new users to sign up" toggle off; admin API (`createUser`/`inviteUserByEmail`/`generateLink`) **bypasses** the public toggle (that's *why* invite-only works); optional **Before User Created Hook** for domain allowlists.
- **SA14 · Email delivery — ⚠️ production constraint.** Built-in auth email = **2/hour** (demo only); production **requires custom SMTP** (default **30 new-user emails/hr**, raisable). A throttled invite looks like nothing happened (#3) — C0/Phase-5 must mandate custom SMTP.
- **SA15 · RLS on every query + service_role bypass — ✅, with precision.** RLS = implicit WHERE on every query; **service_role bypasses RLS**, but only when connecting **as `service_role` with no end-user JWT attached** (a user JWT + service key → the user's RLS still applies). **Performance:** see the sharpened **AF-067** — `STABLE` alone ≠ once-per-statement; must wrap helper calls in `(select …)` to force the initPlan (178,000ms→12ms), index policy columns, scope `TO authenticated`, wire the `auth_rls_initplan` lint.
- **SA16 · Auth endpoint rate limits — ✅ documented (config-driven).** verify 360/hr (burst 30, per IP, fixed); token/refresh 1800/hr; MFA 15/hr; built-in email 2/hr; send-OTP 30/hr (configurable). **No per-account lockout; no separate password-grant limit.** → **AF-077**.
- **SA17 · Asymmetric JWT signing keys — ✅ (architecture-relevant change).** New projects default to **RS256/ES256 since 2025-10-01**; backends verify JWTs **locally via JWKS** (`/auth/v1/.well-known/jwks.json`, `getClaims()`) with **no Auth-server round-trip** — but use `getUser()` where authoritative revocation/logout state matters (`getClaims()` won't see server-side logout). API-key rename: `anon`→`sb_publishable_…`, `service_role`→`sb_secret_…` (legacy keys migrate by **late 2026**). C0 token-verification + secrets-custody FRs must reflect this.

**Outputs filed:** AF-073–077 (above); AF-067 sharpened (initPlan `(select …)` rule). **Forks to become component-0 ODs** when C0 is drafted: session-lifetime model (SA3), mid-task continuation mechanism (SA5), invite-expiry approach 24h-vs-custom-token (SA11/12), HttpOnly requirement (SA4). **Glossary terms to add when first used in a C0 FR:** AAL (aal1/aal2), refresh-token rotation/reuse-detection, asymmetric JWT / JWKS local verification, custom invite-token layer. **Connector FRs this unblocks:** C0 login/session/2FA/invite/seed/webhook-auth FRs (cite Block J).

## K. Component 0 (Login) implementation feasibility (verify by SPIKE)

| ID | Must-test item | Method | Status |
|---|---|---|---|
| AF-078 | **End-to-end inbound webhook verification across GHL / Google / Slack actually rejects forged & replayed events.** The three verifiers (FR-0.WHK.002/003/004) each depend on getting the mechanics exactly right: capturing the **raw body before JSON parsing** (parsing re-serialises and invalidates the signature), **constant-time** comparison (`crypto.timingSafeEqual`, never `===`), correct base-string construction (Slack `v0:[ts]:[body]`), JWKS/audience/expiry checks (Google), and replay rejection (Slack 5-min window + the GHL/Google nonce cache from OD-022). One framework that buffers/parses the body before the verifier sees it silently breaks all three. Prove with a test battery of valid, tampered, and replayed payloads per connector. Load-bearing for non-negotiable #2 (an unverified webhook is the trust-boundary entry point per ADR-007). | SPIKE | 🔴 |

---

## L. Component 1 (RBAC) implementation feasibility

| ID | Must-test item | Method | Status |
|---|---|---|---|
| AF-079 | **RLS coverage is complete — no application table ships without RLS enabled + a policy.** The DB backstop (L719, ADR-006 part 5) only holds if it is *universal*: a single table created without `ENABLE ROW LEVEL SECURITY` + a policy is a silent hole an authenticated user can read directly. Prove with a CI/lint gate that fails the build if any table in the public schema lacks RLS + ≥1 policy (analogous to AF-076 for the `aal2` clause, but for the base default-deny policy). Load-bearing for #2/#3 (a silent un-guarded table). | SPIKE / CI-lint | 🔴 |
| AF-080 | **The harness `can()` check and the RLS helper functions, both reading the same permission tables, cannot disagree on the visibility/sensitivity/Restricted subset — and any runtime divergence is observable.** ADR-006 part 5's "single source of truth → cannot drift" claim rests on both readers deriving identically from the same rows. A subtle divergence (e.g. the harness applies entity-type scope but a helper forgets it, or `NULL`-scope semantics differ) would let one layer allow what the other denies — a leak or a false denial. Prove with (a) a build-time **differential test**: for a matrix of (user, node, entity, tier) cases, assert `can()` and the RLS result agree; **and (b)** a **runtime divergence signal** (FR-1.RLS.008) — when RLS zero-rows a read the harness believed permitted, it is logged/alerted, not silently returned as "no data" (#3). | EVAL / differential-test + runtime signal | 🔴 |
| AF-081 | **Agent-path (`service_role`) Personal/Restricted access audit is complete.** FR-1.RLS.004 puts the agent path **off** RLS by design, so the audit record for every agent read/write/injection of Personal/Restricted content (FR-1.AUD.001) rests **entirely on harness discipline** — there is no DB backstop catching a missed log, unlike the human path. A single un-instrumented agent access path is a permanent silent gap (#3) and a knowledge-provenance hole (#1). Prove with the same shape as AF-076/079: an audit-coverage check over every agent access path to sensitive content (instrument-or-fail), exercised by a test battery. | SPIKE / EVAL | 🔴 |

---

> This register grows as each ADR and component surfaces new assumptions. Next AF number: AF-082
> (priority spikes use AF-001–004; vendor block A uses AF-010–021; behavioral block B uses AF-030–035;
> cost block C uses AF-040–043, 044–049 reserved for cost overflow; performance block D uses AF-050–052;
> concurrency block E uses AF-061–063; deploy block F uses AF-064–066; RLS block G uses AF-067; injection
> block H uses AF-068; backup/DR block I uses AF-069–072; **Supabase Auth block J uses AF-073–077**;
> **Component-0 block K uses AF-078**; **Component-1 block L uses AF-079–081**).
> Items are not blockers to *writing* the spec — they are commitments to *test* before/while building.
