# Tool Integration Dossiers — index

Per-tool research dossiers. Every external tool/connector the harness touches gets one **before** it
is specced into a requirement. Governed by `standards/tool-integration-research.md`. Template:
`_TEMPLATE.md`.

**Why this folder exists:** the tool set is open-ended and client-driven — new tools arrive per
client, vertical, and use case — and **vendor facts go stale** (the AF-003 spike caught 3 stale/refuted
claims). This is the standing gate each new tool passes through: dated, primary-source research →
register outputs (AF/OD/glossary) → verification re-check → *then* connector FRs.

## How to add a tool

1. Copy `_TEMPLATE.md` → `<tool-slug>.md`; fill the header (applicability: which clients/use cases).
2. Run the 5-step procedure in `standards/tool-integration-research.md` (parallel research fan-out →
   file AF/OD/glossary outputs → verification gate → spec the connector).
3. Add/flip the row below.

## Status key
🟡 researching · 🟢 verified (dossier complete + gate passed) · 🟠 stale (past re-verify date) ·
⛔ blocked · ⚪ identified, not started

## Dossiers

| Tool | Slug | Applicability (clients / use cases) | Status | Verified on | Re-verify by | Notes |
|---|---|---|---|---|---|---|
| Google / Gmail | `google-gmail` | Email + calendar + Drive ingestion (most clients) | 🟢 | 2026-06-25 | 2026-12-25 | **Dossier complete, session 19; gate passed, registers filed (AF-101–110).** Key finding: Workspace push has **no HMAC** (Gmail = Pub/Sub OIDC JWT; Drive/Calendar = signed `X-Goog-Channel-Token` + TLS) → reconcile ADR-007 (**OD-044**). Drive scope fork `drive.file` vs `drive.readonly`/CASA (**OD-045**). API "free today" but overage billing later-2026 (AF-103). F1/F4 re-confirmed & superseded here. |
| GoHighLevel | `gohighlevel` | CRM / lead pipeline (GHL clients) | 🟢 | 2026-06-25 | 2026-12-25 | **Dossier complete, session 19; gate passed, registers filed (AF-089–100).** Key finding: webhook signing migrated **RSA→Ed25519**, legacy `X-WH-Signature` deprecated **2026-07-01** → use `X-GHL-Signature` (AF-090). `GET /contacts/` removed → `POST /contacts/search` v3; **no write idempotency** → upsert + app dedup (AF-095); **PHI/BAA legal gate** (AF-098); 5-agency cap (OD-041). F2/F5 re-confirmed. High-staleness vendor → re-verify 90d (OD-043). |
| Slack | `slack` | Team comms ingestion (Web API + Events API, bot tokens) | 🟡 | 2026-06-25 | 2026-12-25 | **Dossier complete, session 19 (2026-06-25); all 12 dims DOCS-verified, gate passed.** Stays 🟡 (not 🟢) pending **AF-083 EVAL** on a live workspace. Key finding: 2025-05-29 non-Marketplace `conversations.history`/`.replies` throttle (1/min × 15) **exempts internal customer-built apps** (verbatim) → **resolves OD-011 → (a) internal app per client workspace**. F3/F6 re-confirmed (prefix correction: rotating bot access = `xoxe.xoxb-`). |
| Railway (**platform**) | `railway` | Operator-owned compute — one service per client (deploy target of `RailwayInfra` / provisioning, ISSUE-007 / AF-004) | 🟡 | 2026-07-04 | 2026-10-04 | **Dossier complete, session 59; all 12 dims DOCS-verified (8-agent fan-out), gate passed; registers filed (AF-141–143, OD-173/174).** Load-bearing: **the Railway GitHub App install + repo authorization is a MANUAL, dashboard/OAuth-only gate — no API/CLI (AF-141)** → provisioning can't be fully unattended; script pre-flights + fails loud (OD-174). No native promote → Git-merge promotion (**OD-173**, updates AF-064 🟡). Rollback = `deploymentRollback`, retention-bounded (Hobby 72h). Provisioning token must be Workspace/Account-scoped = god-mode blast radius (AF-142). Stays 🟡 pending the AF-004 live SPIKE. **Re-verify 90d — no public-API stability SLA.** |

> **Platform dependencies vs client connectors.** Supabase, Inngest, and pgvector have DOCS findings in
> `feasibility-register.md` F7–F12 and remain there (light platform deps). **Railway is the exception:**
> it is the target of automated provisioning code (`RailwayInfra`) with real design forks (AF-141 GitHub
> App gate, OD-173 promotion, AF-142 token blast radius), so it earned a **full 12-dimension dossier here**
> (`railway.md`, session 59). If Supabase/Inngest later need adapter code, they graduate to a dossier too.
> This folder is otherwise for **client-facing tools/connectors**.

> Next: full dossiers for the three seeded connectors are written when their connector component is
> specced in Phase 1 (don't pre-research tools no client needs yet — research is triggered by demand).
