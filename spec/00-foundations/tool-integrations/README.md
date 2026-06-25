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

> When the management plane / infra dependencies (Supabase, Inngest, Railway, pgvector) need the same
> treatment, they already have DOCS findings in `feasibility-register.md` F7–F12 — but they're
> *platform* dependencies, not per-client connectors, so they live in the feasibility register, not
> here. This folder is for **client-facing tools/connectors**.

> Next: full dossiers for the three seeded connectors are written when their connector component is
> specced in Phase 1 (don't pre-research tools no client needs yet — research is triggered by demand).
