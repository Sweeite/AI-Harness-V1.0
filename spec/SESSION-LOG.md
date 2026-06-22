# Session Log

Reverse-chronological. One entry per working session. This is cross-session memory — the
next session reads the top entry to know exactly where to resume.

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
