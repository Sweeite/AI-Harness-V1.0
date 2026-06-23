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
| Google / Gmail | `google-gmail` | Email + calendar ingestion (most clients) | ⚪ | — | — | DOCS findings already exist: `feasibility-register.md` **F1, F4** (Gmail quota now per-minute & date-dependent; OAuth refresh 6-mo-unused + 100-token cap + CASA annual reassessment). Seed the dossier from these; complete remaining dimensions. |
| GoHighLevel | `gohighlevel` | CRM / lead pipeline (GHL clients) | ⚪ | — | — | DOCS findings exist: **F2, F5** (rate limit = 100/10s + 200k/day per location; refresh token **rotates per-use** + dies 1yr unused → must persist new token each refresh). Load-bearing for #1. |
| Slack | `slack` | Team comms ingestion | ⚪ | — | — | DOCS findings exist: **F3, F6** + **OD-011** (2025 history throttle for non-Marketplace apps → recommend internal custom app per workspace; xoxb non-expiring). Resolve OD-011 in the dossier. |

> When the management plane / infra dependencies (Supabase, Inngest, Railway, pgvector) need the same
> treatment, they already have DOCS findings in `feasibility-register.md` F7–F12 — but they're
> *platform* dependencies, not per-client connectors, so they live in the feasibility register, not
> here. This folder is for **client-facing tools/connectors**.

> Next: full dossiers for the three seeded connectors are written when their connector component is
> specced in Phase 1 (don't pre-research tools no client needs yet — research is triggered by demand).
