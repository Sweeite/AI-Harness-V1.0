# Phase 6 Coverage Inventory: C0–C3 (FRs, Touchpoints, Seams, Gating AFs)

## Component 0: Login & Authentication (C0)

**ID:** C0 | **Name:** Login & Authentication | **Total FRs:** 42 live + 1 retired (FR-0.REC.004)

### Area Groups

#### AUTH — Login methods (OAuth, email+password, 2FA)
OAuth as primary (C0.AUTH.001), OAuth-only for client-tenant users (C0.AUTH.002), provider toggle via config (C0.AUTH.003), login-identity hardening / tenant pinning (C0.AUTH.004), email+password for external Super Admins only (C0.AUTH.005), TOTP enrollment via QR (C0.AUTH.006), 2FA challenge with soft-lock (C0.AUTH.007), deployment-wide 2FA enforcement (C0.AUTH.008), brute-force / credential-stuffing defense (C0.AUTH.009), auth audit-trail completeness (C0.AUTH.010).
- **FR-0.AUTH.001–010** (10 FRs) — Primary login methods and 2FA

#### SESS — Sessions & tokens
Session = JWT access + rotating refresh (C0.SESS.001), access token TTL = 1h configurable (C0.SESS.002), refresh-token rotation + reuse-detection + persistence (C0.SESS.003), session lifetime bound via inactivity/time-box (C0.SESS.004), cookie session storage + HttpOnly posture (C0.SESS.005), mid-task continuation as service_role (C0.SESS.006), dashboard expiry → re-auth prompt (C0.SESS.007), JWT verification via local JWKS + getUser for revocation (C0.SESS.008).
- **FR-0.SESS.001–008** (8 FRs) — Session management

#### INV — Invite-based account creation
No self-registration; invite-only (C0.INV.001), invite link generation ≤24h (C0.INV.002), custom SMTP delivery (C0.INV.003), setup page user-chooses method (C0.INV.004), activation → role-default redirect (C0.INV.005), invite lifecycle edge cases (C0.INV.006), delivery-failure surfacing + bounce tracking (C0.INV.007).
- **FR-0.INV.001–007** (7 FRs) — User invitation and onboarding

#### SEED — First-boot Super Admin
Seed creates first Super Admin from env (C0.SEED.001), sends 24h setup link (C0.SEED.002), seed is idempotent with atomic guard (C0.SEED.003).
- **FR-0.SEED.001–003** (3 FRs) — Bootstrap Super Admin

#### REC — Login support ("trouble signing in")
No automated/self-service password reset (C0.REC.001), "Trouble signing in?" form creates support request (C0.REC.002), support-request visibility to Super Admin/Admin (C0.REC.003), support request status tracking (C0.REC.005), support-request notification (C0.REC.006), stale support-request re-escalation (C0.REC.007).
- **FR-0.REC.001–003, 005–007** (6 FRs) — Human-in-the-loop support intake

#### WHK — Inbound webhook authentication
Authenticate every webhook before processing (C0.WHK.001), GHL Ed25519 signature verification (C0.WHK.002), Google Pub/Sub JWT verification (C0.WHK.003), Slack HMAC + timestamp (C0.WHK.004), shared verification principles (C0.WHK.005), endpoint obscurity token (C0.WHK.006), webhook secret rotation (C0.WHK.007), replay cache + per-source accept-rate limit (C0.WHK.008).
- **FR-0.WHK.001–008** (8 FRs) — Webhook authentication & defense

### Touchpoints (C0)

**Data tables:** `auth.users`, `auth.identities` (Supabase), `auth.mfa_factors`, `auth` session store (Supabase), `support_requests` (email, name, issue, status, timestamps), `webhook_secrets` (versioned per connector), `webhook_replay_cache` (event IDs).

**Permissions (stubs homed in C1):** `PERM-user.invite`, `PERM-auth.provider_toggle`, `PERM-support.view`, `PERM-support.resolve`.

**Config keys:** `CFG-auth.oauth_enabled`, `CFG-auth.oauth_provider`, `CFG-auth.access_token_ttl`, `CFG-auth.session_inactivity_timeout`, `CFG-auth.session_absolute_timeout`, `CFG-auth.two_factor_required` (harness-implemented intent), `CFG-auth.mfa_softlock_threshold`, `CFG-auth.account_lockout_threshold`, `CFG-auth.invite_link_ttl` (≤24h native), `CFG-auth.captcha_enabled`, `CFG-auth.smtp_*` (SECRET), `CFG-webhook.replay_window_seconds`, `CFG-webhook.secret_rotation_window`, `CFG-webhook.failure_alert_threshold`.

**UI surfaces:** `UI-LOGIN` (OAuth primary, email/password fallback, "Trouble signing in?"), `UI-2FA-ENROLL`, `UI-2FA-CHALLENGE`, `UI-INVITE-SETUP`, `UI-REAUTH-PROMPT`, `UI-SUPPORT-REQUESTS`, `UI-USER-MGMT`, `UI-config-admin#auth`.

**Observability tables:** `event_log` (login, logout, session, 2FA, invite, seed, webhook auth fail), `audit` (config change, webhook rotation), `guardrail_log` (webhook-auth failures as `prompt_injection`), `access_audit`.

### Seams (C0)

**C0 → C1 (RBAC):** Establishes `auth.uid()` (the seam identity); C1 consumes it to establish RLS row-access. C0 hands the default role on invitation (FR-0.INV.005); C1 owns the role table + assignment. C0 asserts the `aal2` coverage requirement (FR-0.AUTH.008); C1 realizes it via RLS on protected tables (FR-1.RLS.005). C0 specifies permission nodes as stubs (`PERM-user.invite`, `PERM-auth.provider_toggle`, `PERM-support.view/resolve`); C1 homes them in the catalog.

**C0 ← C1 (auth config):** C1 permissions control C0 config edits (`PERM-auth.provider_toggle`), invite issuance (`PERM-user.invite`), support queue access (`PERM-support.view/resolve`).

**C0 ← C2 (Memory):** Ingestion pipelines (FR-2.ING.006–008) consume verified webhooks (after C0 auth checks). C0 applies the webhook-auth boundary; C2 receives authenticated ingress.

**C0 ← C3 (Tool Layer):** Webhook endpoints for GHL/Google/Slack connectors feed C0 auth checks. C3 owns the connector trigger infra; C0 owns the inbound HMAC/JWT verification (Fr-0.WHK.*).

**C0 ← ADR-001, ADR-007:** ADR-001 dictates secrets custody (auth secrets live in client-owned Supabase, never operator custody). ADR-007 homes webhook auth as a hard control ("verified authenticated ingress"); the algorithm per vendor is clarified in OD-044 (HMAC Slack, Ed25519 GHL, OIDC-JWT Google).

### Gating AFs

**AF-073 (HttpOnly cookie):** Gates FR-0.SESS.005 (cookie HttpOnly posture). If spike shows HttpOnly breaks client-side session access, falls back to non-HttpOnly + CSP/short TTL mitigations.

**AF-074 (Invite/seed link 24h cap):** Gates FR-0.INV.002, FR-0.SEED.002. Confirms Supabase's global hard-cap + coupling on hosted platform. Custom invite-token layer was rejected; native is the only path.

**AF-075 (Microsoft Authenticator RFC-6238 compatibility):** Gates FR-0.AUTH.006 (TOTP enrollment). Supabase names Google Authenticator but **never** names Microsoft Authenticator; compat relies on RFC-6238 standard. Verify if client needs named guarantee.

**AF-076 (Deployment-wide aal2 RLS coverage):** Gates FR-0.AUTH.008 (the requirement that `aal2` gates all protected data). Must prove **no protected table is reachable at `aal1`** — a single gap = a silent bypass (#2/#3). Composed with AF-067 (the initPlan performance).

**AF-077 (Brute-force posture):** Gates FR-0.AUTH.009 (password path defense). No native per-account lockout on Supabase; must confirm platform controls (IP rate limit 1800/hr) + leaked-password protection + app-layer soft-lock actually stop the attack.

**AF-078 (End-to-end webhook verification):** Gates FR-0.WHK.001–005. Raw-body capture before parse, constant-time compare, replay window — must actually reject forged/replayed events across GHL/Google/Slack.

---

## Component 1: RBAC (C1)

**ID:** C1 | **Name:** RBAC: Roles, Permissions, Clearances & RLS | **Total FRs:** 37

### Area Groups

#### ROLE — Role model & management
Six default roles ship per deployment (C1.ROLE.001), roles fully editable at runtime (C1.ROLE.002), role management is Super-Admin-only (C1.ROLE.003), role deletion allowed only when unused (C1.ROLE.004), at least one Super Admin must always exist (C1.ROLE.005).
- **FR-1.ROLE.001–005** (5 FRs) — Role provisioning and lifecycle

#### PERM — Permission matrix & enforcement
Two-level enforcement: harness primary + prompt advisory (C1.PERM.001), default-deny (C1.PERM.002), single `can()` gate (C1.PERM.003), permission matrix as data (C1.PERM.004), `PERMISSION_NODES.md` build-time catalog (C1.PERM.005), denied-access behavior (C1.PERM.006), 13-category node catalog homed (C1.PERM.007).
- **FR-1.PERM.001–007** (7 FRs) — Permission matrix and enforcement

#### CLR — Sensitivity clearances
Four sensitivity tiers (Standard, Confidential, Personal, Restricted) (C1.CLR.001), default clearances per role (C1.CLR.002), clearances explicitly granted, never inherited (C1.CLR.003), clearance scoped by entity type (C1.CLR.004), clearances reviewed on configurable cadence (C1.CLR.005), clearance + visibility enforced before ranking/injection (C1.CLR.006).
- **FR-1.CLR.001–006** (6 FRs) — Sensitivity tier access control

#### RST — Restricted grants
Restricted is per-named-individual only (C1.RST.001), every Restricted grant logged (who/when/why); revocation instant (C1.RST.002), Restricted never auto-injected (C1.RST.003).
- **FR-1.RST.001–003** (3 FRs) — Per-individual Restricted access

#### RLS — Row-level security
Every table has RLS policy, default-deny baseline (C1.RLS.001), policies static + data-driven via helpers (C1.RLS.002), RLS enforces visibility + sensitivity + Restricted (C1.RLS.003), RLS guards human path; service_role bypasses (C1.RLS.004), deployment-wide `aal2` in every protected policy (C1.RLS.005), every permission/clearance change is instant (C1.RLS.006), service_role task carries originating user's authorization; deactivation/revocation stops before next side effect (C1.RLS.007), RLS-vs-harness divergence observable (C1.RLS.008).
- **FR-1.RLS.001–008** (8 FRs) — Row-level security enforcement

#### USR — User management
Assign and change user role (C1.USR.001), deactivate user account (C1.USR.002), reset user 2FA (C1.USR.003), view user activity logs (C1.USR.004), grant and revoke sensitivity clearances (C1.USR.005).
- **FR-1.USR.001–005** (5 FRs) — Post-invite user lifecycle

#### AUD — Audit
Every Personal/Restricted access produces permanent audit record (C1.AUD.001), permission/role/clearance changes audited (C1.AUD.002), audit trail storage/retention/export seamed to C7 (C1.AUD.003).
- **FR-1.AUD.001–003** (3 FRs) — Audit completeness

### Touchpoints (C1)

**Data tables:** `roles`, `role_permissions`, `user_roles`, `sensitivity_clearances` (with `entity_type_scope`, `last_reviewed_at`), `restricted_grants` (granter/grantee/reason/scope/time), `access_audit` (append-only; complement to event_log/audit).

**Helper functions (RLS enforcement):** `user_clearances(uid)`, `user_visibility(uid)`, `user_restricted(uid)`, `user_aal()` — all wrapped in `(select …)` per-statement initPlan rule.

**Permissions (catalog in `PERMISSION_NODES.md`):** 13 categories (Memory Access, Sensitivity Clearance, Dashboard Access, Tool Access, Agent Invocation, Asset Management, System Functions, User Management, Approval Authority, Ingestion & Initialisation, Compliance, Observability, Chat Commands) with ~74 seeded nodes; C0 stubs homed: `PERM-user.invite`, `PERM-auth.provider_toggle`, `PERM-support.view/resolve`.

**Config keys (Phase 2):** `CFG-clearance_review_cadence_days` (LIVE, default 90), `CFG-clearance_review_fail_closed` (LIVE, default `false`), `CFG-auth.two_factor_required` (C0 intent, consumed here for `aal2` RLS clause).

**UI surfaces:** `UI-ROLE-MGMT`, `UI-PERMISSION-MATRIX`, `UI-CLEARANCE-MGMT`, `UI-CLEARANCE-REVIEW`, `UI-RESTRICTED-GRANT`, `UI-USER-MGMT`, `UI-USER-ACTIVITY`, audit/compliance views.

**Observability tables:** `audit` (role/permission/clearance changes), `access_audit` (Personal/Restricted access), `event_log` (denials).

### Seams (C1)

**C1 ← C0 (auth):** C0 establishes `auth.uid()` on login; C1 RLS consumes it. C0 specifies permission nodes as stubs; C1 homes them in the catalog. C0's `two_factor_required` intent (CFG) drives C1's `aal2` RLS clause on protected tables. C0's FR-0.AUTH.008 requires coverage; C1's FR-1.RLS.005 realizes it.

**C1 → C2 (Memory):** C1 defines clearance model (tiers, per-role defaults, entity-type scope, Restricted per-individual only); C2 tags memories with sensitivity and applies C1's clearance/visibility before ranking (FR-1.CLR.006, FR-2.RET.004). C1 defines Restricted never auto-inject (FR-1.RST.003); C2's retrieval pipeline enforces it.

**C1 ← C3 (Tools):** Tool execution runs as `service_role` (agent path, no RLS); harness RBAC governs it. Reconnect authority is Admin/Super-Admin (C1 RBAC).

**C1 ← ADR-001, ADR-006:** ADR-006 is C1's architectural spine — data-driven RLS, static policies with live-permission reads, instant grants/revokes, intra-client only (no `client_slug` in policies), two-level harness/RLS division. ADR-001 isolation means RLS is intra-client only; cross-client is physical.

### Gating AFs

**AF-067 (Live data-driven RLS + pgvector perf):** Gates FR-1.RLS.002, FR-1.CLR.006. The `(select user_clearances(uid))` helper lookup + visibility/sensitivity predicates must compose with pgvector ranking within latency budget. D2 JWT-cache is the fallback if it fails at scale (OOS-012).

**AF-076 (Deployment-wide aal2 RLS coverage):** Gates FR-1.RLS.005 (C0's requirement; C1 realizes it). No protected table missing `aal2` predicate.

**AF-079 (RLS coverage completeness):** Gates FR-1.RLS.001. Prove every table ships with RLS enabled + at least default-deny baseline. CI/lint check.

**AF-080 (Harness/RLS non-drift):** Gates FR-1.PERM.003, FR-1.RLS.008. Harness `can()` and RLS must read the same tables (visibility/sensitivity/Restricted subset); sharpened to runtime divergence detection (FR-1.RLS.008).

**AF-081 (Agent-path access-audit completeness):** Gates FR-1.AUD.001. Service-role path has **no** RLS/DB backstop, so audit coverage rests entirely on harness discipline. Prove no agent-path Personal/Restricted access is unlogged.

---

## Component 2: Memory (C2)

**ID:** C2 | **Name:** Memory System: the business brain | **Total FRs:** 57 (56 Approved + 1 v2-deferred)

### Area Groups

#### MEM — Memory model
Four memory types: semantic, episodic, procedural, working (C2.MEM.001), memory row schema (C2.MEM.002).
- **FR-2.MEM.001–002** (2 FRs) — Memory typology and storage

#### ENT — Entities
Every memory references ≥1 entity (C2.ENT.001), entity types per-deployment config + defaults (C2.ENT.002), Internal Org entity singular + walled (C2.ENT.003), entity row schema with external_refs (C2.ENT.004), entity resolution deterministic (C2.ENT.005).
- **FR-2.ENT.001–005** (5 FRs) — Entity model and resolution

#### TAG — Visibility × sensitivity tagging
Visibility axis: global / team / private (C2.TAG.001), writer assigns sensitivity; never autonomously Restricted (C2.TAG.002), visibility + sensitivity orthogonal + both apply (C2.TAG.003).
- **FR-2.TAG.001–003** (3 FRs) — Memory classification

#### ING — Ingestion
Filter 1 (relevance): save-worthy vs discard (C2.ING.001), Filter 2 (sensitivity): hold for human decision (C2.ING.002), ingestion queue: human Include/Exclude/Defer (C2.ING.003), no sensitive content without human approval (C2.ING.004), HR content excluded by default (C2.ING.005), Pipeline 1: structured data (point, don't copy) (C2.ING.006), Pipeline 2: documents (chunk, classify, verify) (C2.ING.007), Pipeline 3: tacit-knowledge interviews (C2.ING.008), initialization sequence ordered + verification mandatory (C2.ING.009), ingestion not a backdoor (C2.ING.010).
- **FR-2.ING.001–010** (10 FRs) — Ingestion pipelines and filters

#### WRT — Write flow
Memory Agent sole writer (C2.WRT.001), contradiction check before write (C2.WRT.002), memory writer extracts facts/types/entities/confidence (C2.WRT.003), golden-rule system_pointer not copy (C2.WRT.004), confidence lifecycle (C2.WRT.005), validate-and-commit (C2.WRT.006), embedding-failure halts commit (C2.WRT.007), selective-writing gate (Haiku Filter 1) (C2.WRT.008).
- **FR-2.WRT.001–008** (8 FRs) — Write path and sole-writer invariant

#### RET — Retrieval & ranking
Entity extraction (C2.RET.001), dual search + candidate filters (C2.RET.002), clearance before ranking (C2.RET.003), retrieval surfaces relevant, low-noise memory (C2.RET.004), answer modes + Retrieval Sufficiency (C2.RET.005).
- **FR-2.RET.001–005** (5 FRs) — Retrieval pipeline

#### MNT — Maintenance
Confidence lifecycle + decay (C2.MNT.001), re-compute Maturity daily (C2.MNT.002), recompute Retrieval Sufficiency query-time (C2.MNT.003), merge similar memories (C2.MNT.004), hard expiry (C2.MNT.005), decay never deletes, supersedes (C2.MNT.006), supersession chain (C2.MNT.007), conflict-resolution priority (C2.MNT.008), relevance erosion / stale-memory audit (C2.MNT.009), structural erosion / entity dedup (C2.MNT.010), contradiction-watch + golden-rule audit (C2.MNT.011), maintenance schedule (C2.MNT.012), evidence layer (C2.MNT.013), grace-window retry on ingestion conflicts (C2.MNT.014), Haiku-gate audit sampled (C2.MNT.015), cold storage (deferred OOS-016) (C2.MNT.016), erasure transitive + merge chain (C2.MNT.017).
- **FR-2.MNT.001–017** (17 FRs) — Memory lifecycle management

#### VEC — Vector index & embeddings
HNSW + ingestion (C2.VEC.001), embedding-model change expand-contract migration (C2.VEC.002), re-embedding completeness + atomic swap (C2.VEC.003).
- **FR-2.VEC.001–003** (3 FRs) — Vector search

#### MAT — Maturity & Retrieval Sufficiency
Expected slots per entity type config (C2.MAT.001), cold-start gating 20/50/80 Maturity tiers (C2.MAT.002), `[Building]` flag threshold (C2.MAT.003).
- **FR-2.MAT.001–003** (3 FRs) — Knowledge sufficiency metrics

### Touchpoints (C2)

**Data tables:** `memories` (id, type, content, embedding, entity_ids, source, source_ref, confidence, visibility, sensitivity, superseded_by, expires_at, created_at, updated_at), `entities` (id, type, name, external_refs, created_at), `ingestion_queue` (held/flagged content), `memory_conflicts` (hard-conflict quarantine), `memory_maturity` (per-entity slot-fill state).

**Permissions (C1 gates ingestion):** `PERM-ingestion.review` (Filter 2 queue), `PERM-ingestion.initiate` (Pipelines 1–3), `PERM-memory.write` (human dashboard writes).

**Config keys (Phase 2):** `CFG-chunk_size_tokens` (default 300), `CFG-entity_types` (configurable list), `CFG-ingest_defer_resurface_days`, `CFG-review_escalation_days`, `CFG-hr_content_enabled` (default off), `CFG-memory_decay_half_life`, `CFG-confidence_minimum_for_injection`, various maintenance schedules.

**UI surfaces:** memory health dashboard (types, Maturity by entity, `[Building]` flags), ingestion queue (Filter 2 human review), hard-conflict review queue, entity browser, entity-merge/dedup queue.

**Observability tables:** `event_log` (Filter 1/2 decisions, contradictions, merges), `audit` (human confirms, queue actions).

### Seams (C2)

**C2 ← C1 (clearance/sensitivity):** C1 defines four tiers + per-role defaults + entity-type scope (FR-1.CLR.001–005); C2 tags memories at write (FR-2.TAG.002) and applies C1's clearance/visibility before ranking (FR-2.RET.004, FR-1.CLR.006). C1 owns Restricted rules (never auto-assign, per-individual only, never auto-inject); C2 enforces them.

**C2 ← C0 (auth + session):** Auth session (C0 SESS) and `auth.uid()` enable the human-path RLS that C1 enforces on memory reads. Mid-task continuation as `service_role` (C0 FR-0.SESS.006) means memory writes run off-RLS, governed by harness RBAC (ADR-004/006).

**C2 → C3 (Tools):** Read tools (GHL/Gmail/Drive/Calendar, C3 OBS.*) feed three ingestion pipelines (ING.006–008); boundary-tagged untrusted content flows to Filter 2. Memory-write tool (explicit write/flag-for-review/supersede) is C3-registered but C2-owned (WRT flow).

**C2 ← ADR-002, ADR-003, ADR-004:** ADR-002 (Maturity/Retrieval Sufficiency) fixes the metrics; ADR-003 (write cost ≤1 Sonnet) fixes the model (cheap Haiku gates wrapping one Sonnet call); ADR-004 (sole writer, service_role, per-entity concurrency) fixes the invariant.

### Gating AFs

**AF-031 (Writer type quality):** Gates FR-2.MEM.001, FR-2.WRT.003. Writer produces clean type splits + sensible confidence.

**AF-034 (Maturity as cold-start gate):** Gates FR-2.MAT.001–003. Slot-fill Maturity predicts usefulness; Retrieval Sufficiency cleanly separates `[Building]`/`[Unknown]`.

**AF-043 (Selective-writing gate pays for itself):** Gates FR-2.ING.001, FR-2.WRT.008 (Haiku Filter 1). Gate accuracy + volume savings justify the Haiku cost.

**AF-061/062/063 (Validate-and-commit closes TOCTOU):** Gates FR-2.WRT.006. Per-entity lock serialize + optimistic validate-and-commit (slow Sonnet unlocked, short txn re-checks watermark). Idempotency key kills retries; CAS supersede (`WHERE superseded_by IS NULL`) kills lost supersession.

**AF-067 (Live clearance predicate + pgvector perf):** Gates FR-2.RET.004, FR-1.CLR.006 (C1). Clearance filter composes with ranking on hot path within latency.

**AF-082 (Entity resolution accuracy):** Gates FR-2.ENT.005. Resolution accurate enough brain doesn't fragment into duplicate entities at scale.

---

## Component 3: Tool Layer (C3)

**ID:** C3 | **Name:** Connector: Registry, OAuth, Rate-limit, Triggers | **Total FRs:** 53 (38 generic + 15 per-connector instances)

### Area Groups (Generic Contract + Per-Connector Instances)

#### CONN — Connector contract (the spine)
Every tool registered with contract shape (C3.CONN.001), shared runtime owns safety machinery once (C3.CONN.002), boundary-tag all external content (C3.CONN.003), every external write idempotent (C3.CONN.004), minimal scope per connector (C3.CONN.005).
- **FR-3.CONN.001–005** (5 FRs) — Generic connector model

#### REG — Tool registry
`tools` table (name, description, category, risk_level, requires_approval, connector, config, enabled, version, change_reason) (C3.REG.001), plain-English description drives AI selection (C3.REG.002), tools versioned + change_reason mandatory (C3.REG.003), registry per-deployment (`client_slug` label only, not RLS) (C3.REG.004).
- **FR-3.REG.001–004** (4 FRs) — Tool registry

#### TOK — OAuth token lifecycle
Credentials encrypted in Vault (C3.TOK.001), Layer 1 proactive refresh (C3.TOK.002), Layer 2 reactive refresh + retry (C3.TOK.003), Layer 3 dead token → degraded + re-auth (C3.TOK.004), rotate + persist atomically (C3.TOK.005), 99% invisible target (C3.TOK.006).
- **FR-3.TOK.001–006** (6 FRs) — Token lifecycle management

#### RL — Rate-limit management
`rate_limit_tracker` table (C3.RL.001), check before + update after (C3.RL.002), 80%: slow non-urgent (C3.RL.003), 95%: pause + queue (C3.RL.004), 429: exponential backoff + honor Retry-After (C3.RL.005), high-risk → halt + escalate (C3.RL.006), per-deployment isolation (C3.RL.007), configurable: max calls/alert_threshold/backoff (C3.RL.008).
- **FR-3.RL.001–008** (8 FRs) — Rate limiting

#### ACT — Action (write) tools + hard limits
Read tools read-only (C3.OBS contract); write tools higher-risk (C3.ACT.001). Seven hard-limit code-enforced rules: never send external email autonomously (FR-3.ACT.001), never financial transaction, never delete SOR record, never cross-client share, never impersonate, never self-approve, never treat content as instructions (FR-3.ACT.002).
- **FR-3.ACT.001–002** (2 FRs) — Write tool limits

#### OPT — Optimisation
Confidence-gate tool choice (C3.OPT.001), cache reads within task (C3.OPT.002), batch reads where supported (C3.OPT.003), graceful degradation (C3.OPT.004).
- **FR-3.OPT.001–004** (4 FRs) — Tool optimisation

#### TRIG — Trigger model
Webhook handler + parser built per connector (C3.TRIG.001, generic+param), default trigger set per connector (enable/disable from dashboard) (C3.TRIG.003, param per GHL/Google/Slack), end-user dashboard config (no-code) (C3.TRIG.004), watch re-arm expiry + liveness (C3.TRIG.005), event-gap detect + reconcile (C3.TRIG.006).
- **FR-3.TRIG.001, TRIG.003–006** (5 FRs) — Trigger infrastructure + liveness

#### OBS — Observation (read) tools per connector
CRM reads (GHL contact/deal/pipeline/history/tags) (C3.OBS.001), Slack messages/threads/transcripts (C3.OBS.002), Drive docs (C3.OBS.003), Calendar events (C3.OBS.004).
- **FR-3.OBS.001–004** (4 per-connector instances) — Read capability

#### DSC — Connector disconnection & recovery
System-wide vs individual connector (C3.DSC.001), degraded-state modal/banner (C3.DSC.002), auto-resume paused tasks on reconnect (C3.DSC.003), escalation on unresolved (24h default) (C3.DSC.004), connector health panel (C3.DSC.005), alerts (C3.DSC.006).
- **FR-3.DSC.001–006** (6 FRs) — Disconnection and recovery

#### Per-Connector SPECIFIC FRs (GHL/Google/Slack instances)
GHL/Google/Slack read + write + token + trigger FRs — see the source docs for per-connector details.

### Touchpoints (C3)

**Data tables:** `tools` (registry), `connector_credentials` (encrypted access/refresh, expires_at, scopes — Vault), `rate_limit_tracker` (window_start, duration, limit, calls_made, reset_at), `idempotency_ledger` (send-once guard), `webhook_secrets` (GHL/Google/Slack per-connector), connector status/health metadata.

**Permissions (C1 gates tool management):** `PERM-tool.manage` (Admin/Super-Admin for registry edits); tool **execution** runs as `service_role` (agent path, no harness RBAC gate per tool — C5/C6 handles approval).

**Config keys (Phase 2):** `CFG-tool_selection_confidence_threshold`, `CFG-token_refresh_interval_minutes`, `CFG-token_refresh_lead_minutes`, `CFG-slack_token_rotation_enabled` (default false), `CFG-connector_disconnection_escalation_window` (default 24h), rate-limit per-connector caps (from dossiers, not design doc), various per-connector TTL/rotation params.

**UI surfaces:** tool registry admin (version history), connector health panel (status, last-call, token-expiry countdown, alerts), degraded-state modal/banner, rate-limit dashboard, re-auth one-click button.

**Observability tables:** `event_log` (tool selection, invocation, rate-limit events, connector disconnects), `audit` (tool version changes), network logs (request/response counts per connector).

**Connectors (instances):** GHL (CRM), Gmail/Drive/Calendar (Google), Slack (comms).

### Seams (C3)

**C3 ← C0 (webhook auth):** C0 owns inbound webhook verification (GHL Ed25519 / Google JWT / Slack HMAC, FR-0.WHK.001–005); C3 owns trigger infrastructure that consumes the *verified* event (C3 TRIG.*). Seam = verified event handed to parser.

**C3 → C2 (ingestion):** Read tools feed C2's three ingestion pipelines (ING.006–008); boundary-tagged content flows to Filter 2. Memory-write tool (C3-registered, C2-owned write flow) is how agents record learned facts.

**C3 ← C1 (RBAC):** Tool execution runs as `service_role` (no user-path RLS), governed by harness RBAC. Reconnect authority is Admin/Super-Admin (RBAC role). Mid-task revocation (FR-1.RLS.007) applies to tool-initiated writes.

**C3 ← ADR-001, ADR-004, ADR-006, ADR-007, ADR-008:** ADR-001 (per-client accounts + secrets in client Supabase). ADR-004 (idempotency + concurrency). ADR-006 (service_role path, no RLS). ADR-007 (boundary tag external data, webhook verified auth, hard limits). ADR-008 (golden rule — source_ref pointers, not copies).

**C3 → C5/C6/C8 (Guardrails + Observability):** Rate-limit halt + escalate (RL.006) → C6 approval gate. Tool-invocation logging + health events → C7 observability. Approval-gate machinery for write tools → C6. OD-010 (compensation for partial external-write chains) → C5/C6/C8.

### Gating AFs

**AF-083 (Slack history ingest):** Gates FR-3.OBS.002 (Slack arm), FR-3.TOK.009, FR-3.TRIG.004 (Slack arm), FR-3.TRIG.006. Non-Marketplace history throttle since 2025-05-29; recommend internal custom app per workspace.

**AF-084 (Slack history + liveness):** Accompanies AF-083 (event-gap detection for Slack).

**AF-085 (Slack post-message app-side write-dedup):** Gates FR-3.CONN.004 (Slack arm). App-side dedup design for Slack posts (no native idempotency key).

**AF-088 (Prompt-injection for untrusted tool content):** Gates FR-3.CONN.003 (boundary-tag). Containment control for untrusted Slack/external text in memory/LLM.

**AF-089 (GHL rotation correctness):** Gates FR-3.TOK.005 (GHL arm). GHL refresh rotates per-use + dies 1yr unused; 30s same-token grace window under concurrency.

**AF-090 (GHL webhook verification Ed25519):** Gates FR-3.TRIG.004 (GHL arm). GHL migrated from RSA to Ed25519; exact signing input + key model.

**AF-095 (GHL lacks native Idempotency-Key):** Gates FR-3.CONN.004 (GHL arm). Confirm GHL has no `Idempotency-Key` header; app-side guard is required.

**AF-098 (GHL PHI/BAA):** Gates FR-3.OBS.001 (GHL PHI arm). Ingesting PHI from HIPAA-enabled GHL location requires BAA chain resolution (legal gate).

**AF-102 (Google Calendar 409-duplicate idempotency):** Gates FR-3.CONN.004 (Calendar arm). Client-supplied `id` yields 409 on re-run; distributed-system idempotency holds.

---

## Cross-Component Seams Summary

1. **C0 → C1:** `auth.uid()` establishes identity; C1 RLS consumes it. Permission stubs homed in C1 catalog. `aal2` requirement (C0) realized via RLS (C1).

2. **C0 → C3:** Webhook auth (C0) → verified ingress consumed by trigger infra (C3).

3. **C1 ↔ C2:** Clearance model (C1) + memory tagging (C2); clearance enforced before ranking (C1 rule, C2 mechanism). Restricted rules (C1) guarded in retrieval (C2).

4. **C2 ← C3:** External reads from tools (C3) → boundary-tagged → ingestion pipelines (C2). Memory-write tool registered (C3) but owned by C2 write flow.

5. **C1 ← C3:** Service_role tool execution (agent path) governed by harness RBAC, not RLS (ADR-006 division).

---

## OD-157 Launch-Gating Spikes (Six Feasibility Items)

**OD-157** lists the six spikes that must clear before Phase 6 issues unblock to build:

| AF | Component | FRs Gated | Description |
|---|---|---|---|
| **AF-068** | C1 (Guardrails) | FR-1.RLS.007 (mid-task revocation gate) | Containment red-team — confirm no authorized-but-revoked path reaches a consequential side effect. |
| **AF-069** | C1 (RBAC) | (ambient) | Restore a deactivated/revoked user's state mid-task. Mechanism seamed to C5/C6/C8. |
| **AF-001** | C2 (Memory) | (cost model spine) | Memory cost estimate. Tiered cost ladder is the runaway backstop. |
| **AF-067** | C1/C2 (RBAC + Memory) | FR-1.RLS.002, FR-1.CLR.006, FR-2.RET.004 | Live data-driven RLS (pgvector ranking with initPlan helper). Latency on hot path. |
| **AF-078** | C0 (Webhooks) | FR-0.WHK.001–008 | End-to-end webhook verification (raw-body, constant-time, replay defense). |
| **AF-077** | C0 (Auth) | FR-0.AUTH.009 | Brute-force posture (platform IP limits + CAPTCHA + leaked-password + app soft-lock). |

**Additional C3 gates (not OD-157 but blocking C3 FRs):**
- **AF-083/084** (Slack history) → FR-3.OBS.002 Slack arm, FR-3.TRIG.004/006 Slack arms.
- **AF-090** (GHL webhook Ed25519) → FR-3.TRIG.004 GHL arm.
- **AF-098** (GHL PHI/BAA) → FR-3.OBS.001.

---

## Suggested Vertical-Slice Groupings (Phase 6 Issues)

These are thin end-to-end buildable slices:

### Auth Slices (C0)
1. **OAuth onboarding** — FR-0.AUTH.001/002/003/004 + related config + UI-LOGIN + tests.
2. **Email+password path** — FR-0.AUTH.005 + FR-0.AUTH.009 (CAPTCHA/soft-lock) + UI-LOGIN fallback.
3. **2FA (TOTP)** — FR-0.AUTH.006/007/008 + soft-lock config + enrollment/challenge UX.
4. **Session management** — FR-0.SESS.001–008 + cookie/refresh mechanics + mid-task service_role.
5. **Invite + seed** — FR-0.INV.001–007 + FR-0.SEED.001–003 (atomic seed, idempotent) + setup UX + SMTP.
6. **Support intake** — FR-0.REC.001–003, 005–007 (retire phone-verify path) + form + queue UX.
7. **Webhook auth** — FR-0.WHK.001–008 per connector (GHL Ed25519, Google JWT, Slack HMAC) + replay/rate + rotation (gated AF-078).
8. **Auth audit completeness** — FR-0.AUTH.010 + event_log instrumentation across all auth paths.

### RBAC Slices (C1)
1. **Role model + defaults** — FR-1.ROLE.001–005 + six default roles seed + deletion guard + last-Super-Admin protection.
2. **Permission matrix** — FR-1.PERM.001–007 + `PERMISSION_NODES.md` catalog + harness `can()` gate + default-deny + matrix UI.
3. **Clearance model** — FR-1.CLR.001–006 + four tiers + per-role defaults + entity-type scope + review cadence + before-ranking enforcement.
4. **Restricted grants** — FR-1.RST.001–003 (per-individual, never role, never auto-inject) + mandatory reason + revoke instant.
5. **RLS foundation** — FR-1.RLS.001–002 (every table has policy; static + data-driven via `(select …)` helpers + initPlan performance gate AF-067).
6. **RLS + aal2** — FR-1.RLS.005 (C0's aal2 requirement realized here) + complete coverage gate AF-076.
7. **Service-role path** — FR-1.RLS.004, FR-1.RLS.007 (mid-task revocation re-check) + originating-user binding.
8. **User management** — FR-1.USR.001–005 (role assign, deactivate, reset 2FA, activity logs, clearance grant/revoke) + lifecycle UX.
9. **RBAC audit** — FR-1.AUD.001–003 (Personal/Restricted access + RBAC mutation audit + completeness) + AF-081 (agent-path coverage).

### Memory Slices (C2)
1. **Memory model + entities** — FR-2.MEM.001–002 + FR-2.ENT.001–005 (entity resolution, internal-org singleton, external_refs).
2. **Visibility + sensitivity tagging** — FR-2.TAG.001–003 + orthogonal axes + defaults (global business, private personal).
3. **Ingestion filters** — FR-2.ING.001–004 (relevance + sensitivity filters, queue human decision, no sensitive without approval).
4. **Ingestion pipelines** — FR-2.ING.005–010 (structured/doc/interview + HR config flag + not-a-backdoor invariant).
5. **Memory write + sole-writer** — FR-2.WRT.001–008 (sole writer, contradiction check, sensitivity assign, confidence, validate-and-commit, embedding fail guard).
6. **Retrieval + ranking** — FR-2.RET.001–005 (entity extraction, candidate filter, clearance-before-ranking, ranking formula, answer modes + Sufficiency).
7. **Memory maintenance** — FR-2.MNT.001–017 (confidence decay/merge/supersede/expiry, structural/relevance erosion, erasure transitive, cold storage deferred, Haiku-gate audit sampled).
8. **Maturity metrics** — FR-2.MAT.001–003 (expected slots per entity type, cold-start gating 20/50/80, `[Building]` flag) + gate AF-034.
9. **Embeddings + vector search** — FR-2.VEC.001–003 (HNSW, embedding model, expand-contract migration, re-embed completeness).

### Tool Layer Slices (C3)
1. **Connector contract + runtime** — FR-3.CONN.001–005 (registry shape, shared safety machinery, boundary-tag, idempotent, minimal scope).
2. **Tool registry** — FR-3.REG.001–004 (tools table, description quality, versioning, per-deployment).
3. **OAuth token lifecycle** — FR-3.TOK.001–006 (Vault + 3-layer refresh: proactive/reactive/re-auth, 99% invisible, atomic persist).
4. **Rate limiting** — FR-3.RL.001–008 (tracker, 80/95/429 tiers, backoff, high-risk halt, per-deployment isolation, configurable).
5. **Write tools + hard limits** — FR-3.ACT.001–002 (seven code-enforced rules, no autonomy on email/financial/delete/impersonate).
6. **Tool optimisation** — FR-3.OPT.001–004 (confidence-gate selection, read-cache, batch, graceful degrade).
7. **Trigger infrastructure + liveness** — FR-3.TRIG.001, 003–006 (webhook handler, default triggers per connector, end-user config, watch re-arm, event-gap detection) + per-connector (GHL webhook AF-090, Slack history AF-083).
8. **Disconnection + recovery** — FR-3.DSC.001–006 (system/individual states, modal/banner, auto-resume on reconnect, escalation, health panel, alerts).
9. **GHL connector instance** — FR-3.OBS.001 (CRM reads, gated AF-098 PHI/BAA) + FR-3.ACT.* (mutations) + FR-3.TOK.* (24h access, rotating refresh AF-089) + FR-3.TRIG.004 (GHL webhook AF-090).
10. **Google connector instance** — FR-3.OBS.003–004 (Gmail/Drive/Calendar reads) + FR-3.ACT.* (draft email to approval, calendar invite to approval) + FR-3.TOK.* (1h access, 6mo refresh, CASA) + FR-3.TRIG.* (Pub/Sub, watches).
11. **Slack connector instance** — FR-3.OBS.002 (messages/threads, gated AF-083/084 history) + FR-3.ACT.* (post msg to approval) + FR-3.TOK.* (xoxb non-expiring or xoxe rotation per OD-040) + FR-3.TRIG.* (Events API, gated AF-083/084).

