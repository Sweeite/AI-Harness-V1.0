# Client onboarding runbook (accounts · card · delegated access · OAuth)

> **Implements:** FR-10.PRV.004 (client-side onboarding runbook) and FR-10.PRV.002 (per-client
> OAuth app registration). **Rests on:** ADR-001 §5 (hybrid ownership — client owns data + vendor
> accounts, operator owns compute/IP), ADR-005 §5–§6. **This runbook's completion is the
> precondition the provisioning script (FR-10.PRV.001) depends on** — nothing operator-side can run
> until delegated access exists.

This is a **consent-gated** process: the client creates and owns every vendor account, puts their
own card on each, and grants the operator *delegated* access. The operator never owns the client's
data accounts (the moat + data-residency story), and the operator's prompt/agent IP never lives
inside a client account (per-client OAuth apps, never a shared operator app).

**Fail-loud rule (ADR-005 §5):** if any delegated-access grant below is missing, provisioning stops
loudly at that step — it never proceeds with a partial setup. Do not mark this runbook complete
until every ✅ checkpoint is verified.

---

## 0. Precondition — signed engagement

- [ ] Engagement signed; the client has agreed to the hybrid-ownership model (they own accounts +
  bear vendor cost per ADR-003; operator owns compute + IP).
- [ ] A shared secure channel exists for the client to transmit delegated credentials (a password
  manager vault or the client's own IdP invite — **never** email/Slack plaintext for secrets).

---

## 1. Client creates the data + AI accounts (client-owned, card on each)

The client (account owner) creates each of these in **their own** billing identity and puts **their
card** on each. The operator guides but does not own.

| # | Account | Notes |
|---|---|---|
| 1.1 | **Supabase project** | **Region: Sydney `ap-southeast-2`** (default per FR-10.ISO.003 / ADR-001). One project = one client silo (Postgres + Auth + pgvector). |
| 1.2 | **Anthropic** account | Model provider (Sonnet + Haiku, ADR-009). Card on file. |
| 1.3 | **OpenAI** account | Embeddings (`text-embedding-3-small`, ADR-009). Card on file. |
| 1.4 | **Connector SaaS** | Whichever connectors this client uses — **GoHighLevel**, **Google** (Workspace + a Google Cloud project for OAuth), **Slack**. Card where the plan requires it. Connectors are client-driven — only provision the ones in scope. |

**✅ Checkpoint 1 (AC-10.PRV.004.1, part a):** the client owns the Supabase + Anthropic/OpenAI +
in-scope connector accounts, each with the client's card. Record account identifiers (project ref,
org IDs) in the client's provisioning record — **not** any secrets yet.

---

## 2. Client grants the operator delegated access

The client grants **delegated** access so the operator can run provisioning and register OAuth apps
— without transferring account ownership.

- [ ] **Supabase service-role key** (Project Settings → API) — transmitted via the secure channel.
  This is the key the provisioning script uses to seed and to write into the silo. Treat as a
  top-tier secret; it lands only in the deployment's Railway env, never in the repo or
  `DEPLOYMENT_CONFIG`.
- [ ] **Supabase project access** — add the operator as a member (or supply the access token) so the
  Railway project can be linked and migrations applied.
- [ ] **OAuth app admin** on each connector — Google Cloud project (OAuth consent + credentials),
  GHL developer/marketplace access, Slack app management — so the operator can register the
  **client's own** OAuth apps in step 4.
- [ ] **Anthropic/OpenAI API keys** — issued by the client, transmitted via the secure channel, to
  land in the deployment env.

**✅ Checkpoint 2 (AC-10.PRV.004.1, part b):** the operator has verified working delegated access to
Supabase (service-role key + project) and to each in-scope connector's OAuth admin. **If any grant
is missing, STOP — provisioning is blocked loudly here; do not proceed to step 3.**

---

## 3. Ownership variant — client insists on owning compute (exception path)

Default: the **operator owns compute** (the Railway deployment) so the shared codebase + operator IP
stay operator-controlled.

- [ ] If a client insists on owning the Railway/compute too, that is a **per-client exception**,
  **not** the default. Record it explicitly in the client's provisioning record (who approved, what
  changes: the client owns the Railway project; the operator retains deploy access to the shared
  build repo). Note the IP-exposure trade-off was reviewed.

**✅ Checkpoint 3 (AC-10.PRV.004.2):** if compute ownership deviates from the default, it is
documented as a recorded exception — never a silent default change.

---

## 4. Per-client OAuth app registration (FR-10.PRV.002)

Using the delegated OAuth-admin access from step 2, register the **client's own** OAuth apps **in
the client's accounts**. **Never** a shared operator app across clients (contradicts ADR-001 §5 and
leaks the moat).

For each in-scope provider:

- [ ] **Login provider** (the app's auth) — register the OAuth app in the client's account; set the
  **redirect URI to that deployment's Railway domain** (the `railway_url` this client will get).
- [ ] **Connector apps** — Gmail / Drive / Calendar (Google), GHL, Slack — register each in the
  client's account; redirect URIs → the deployment's Railway domain.
- [ ] Drop each resulting **`client_id` / `client_secret`** into the deployment's Railway env (the
  provisioning script's env-secret set) — **not** into the repo or `DEPLOYMENT_CONFIG`.

> **⚠️ Redirect-URI trap:** a redirect URI pointing anywhere but this deployment's domain breaks the
> OAuth loop. Confirm the deployment domain is known before registering, or update the URIs
> immediately after the domain is assigned in provisioning.

### 4a. Google production verification — start EARLY (AF-013 lead-time)

- [ ] Google OAuth **production verification** has **multi-day-to-week** lead time. Start it **now**,
  at onboarding — it is a **schedule dependency sequenced ahead of go-live**, not a code step. Track
  its status in the client's provisioning record. Other connectors (GHL, Slack) register faster and
  are not on this critical path.

**✅ Checkpoint 4 (AC-10.PRV.002.1 / AC-10.PRV.002.2):** every in-scope OAuth app lives in the
client's own account with redirect URIs to the deployment's Railway domain (no shared operator app);
Google production verification is initiated and tracked as a lead-time dependency.

---

## 4b. Operator-side one-time Railway prerequisite (OD-174 / AF-141)

**This is an operator step, done ONCE for the whole fleet — not per client** (the shared `app/` repo
is operator-owned, ADR-011). The Railway↔GitHub repo link that provisioning depends on **cannot be
scripted** — the **Railway GitHub App install + repo authorization is a manual, dashboard/OAuth-only
gate with no API/CLI path** (⚠️ FEASIBILITY: **AF-141**; `spec/00-foundations/tool-integrations/railway.md` §7).

- [ ] Install the **Railway GitHub App** on the operator GitHub org that owns `Sweeite/AI-Harness-V1.0`,
  and grant it access to that repo (Railway dashboard → connect GitHub → authorize the App on the org).
- [ ] Confirm a Railway **Workspace** (or Account) API token exists in the operator secret store — a
  **project token cannot create projects/services** (AF-142). Treat it as a god-mode credential.
- [ ] **The provisioning script pre-flight-verifies repo access and FAILS LOUD if the App is absent**
  (never a silent deploy-from-nothing — #3). Confirm this at the AF-141 SPIKE (part of the AF-004 run).

## 5. Hand-off to provisioning

When Checkpoints 1–4 (+ the §4b operator prerequisite) are green, the preconditions for FR-10.PRV.001
(the operator-side provisioning script) are satisfied:

- Client owns Supabase (`ap-southeast-2`) + Anthropic/OpenAI + in-scope connectors, card on each.
- Operator holds verified delegated access (Supabase service-role + project; connector OAuth admin).
- Per-client OAuth apps registered; redirect URIs → deployment domain; Google verification in flight.
- **Operator: Railway GitHub App installed on the shared repo + a Workspace token in the secret store (§4b).**

Proceed to `app/provisioning/` (FR-10.PRV.001). The provisioning script consumes the delegated
credentials from the secure channel; **no secret from this runbook is committed to any repo.**

---

## Acceptance-criteria map

| AC | Satisfied by |
|---|---|
| AC-10.PRV.004.1 | Checkpoints 1 + 2 — client owns accounts (card on each) **and** has granted delegated access |
| AC-10.PRV.004.2 | Checkpoint 3 — client-owns-compute recorded as a per-client exception |
| AC-10.PRV.002.1 | Checkpoint 4 — per-client OAuth apps in the client's accounts, redirect URIs → deployment domain, no shared operator app |
| AC-10.PRV.002.2 | Checkpoint 4a — Google production verification started early as a schedule dependency (AF-013) |

**Feasibility notes carried:** AF-013 (Google verification lead-time — 🟢 verified, treated as a
schedule dependency here, not a code gate). The end-to-end provisioning proof is **AF-004** (🔴, the
two-party live run driven from `build/provisioning/`).
