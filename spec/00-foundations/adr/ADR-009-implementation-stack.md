# ADR-009 — Implementation stack (TypeScript / Node)

- **Status:** Accepted
- **Date decided:** 2026-07-03
- **Resolves:** the unrecorded stack gap surfaced at the start of the build phase — the
  implementation *language/runtime* was assumed ("TypeScript") in conversation across the whole
  spec effort but was **never written to a file with an ID** (Rule-0 gap, caught building ISSUE-001).
- **Affects:** every build issue (ISSUE-001–086); the language of all harness/connector/RLS/loop
  code; the SDKs used for vendor calls in the ISSUE-001 cost spike.
- **⚠️ Contested (2026-07-10) — see [[OD-203]] (OPEN):** the design doc (`design-doc-v4.md` L51)
  named the **Vercel AI SDK** as the *primary* model-call layer (Anthropic SDK alongside); this
  ADR's Decision below chose the direct `@anthropic-ai/sdk` + `openai` SDKs and dropped the Vercel
  AI SDK without reconciliation. The **language decision (TypeScript on Node) stands regardless** —
  only the **model-call SDK layer** is under review. Nothing built to date commits to either choice
  (all model calls are behind ports/fakes; the sole real dependency is the ISSUE-001 spike). Resolve
  OD-203 before the first real model-client adapter is wired, then update this ADR's Decision to match.

## Context

The spec (Phases 0–6) is complete and the build is beginning with ISSUE-001. No implementation
code exists yet, and no ADR or decision record names the implementation language. What *is*
already locked constrains the choice heavily:

- **Isolation & provisioning** — one **Supabase** (Postgres + auth + pgvector) instance per client
  (ADR-001, ADR-005). The Supabase client + admin SDKs are TypeScript-first.
- **Durable execution** — the harness runs tasks/loops on **Inngest** step/job runtime
  (referenced throughout the data model and C5/C6 issues, e.g. ISSUE-048/049/052). Inngest is a
  TypeScript-first framework; its step/durability model is the reference the FRs are written against.
- **RLS / service_role** access patterns (ADR-006, ISSUE-020) assume the Supabase Postgres client.

So the infrastructure was decided; the *language* it is written in was left implicit. Rule 0 says
an implicit decision is not a decision — hence this ADR.

## Options considered

- **TypeScript / Node** — matches the locked Inngest + Supabase infra (both TS-first); first-class
  `@anthropic-ai/sdk` and `openai` SDKs for the ISSUE-001 vendor calls; single language across
  harness, connectors, and any surface/UI work later. Cons: none material given the locked infra.
- **Python** — fastest to write a one-off measurement script; strong Anthropic/OpenAI SDKs. But it
  diverges from Inngest (TS-first) and Supabase's primary SDK, forcing either a second language for
  the durable runtime or a non-idiomatic Inngest path. Rejected: it optimises the throwaway spike
  script at the expense of every issue after it.

## Decision

**The implementation language and runtime is TypeScript on Node.** All build-phase code
(harness, connectors, RLS scaffolding, loops, and the ISSUE-001 cost spike) is written in
TypeScript. Vendor calls use the official `@anthropic-ai/sdk` (Sonnet + Haiku) and `openai`
(`text-embedding-3-small`) SDKs.

## Consequences

- Build code lives in TypeScript/Node; the ISSUE-001 spike harness is the first instance
  (`/spikes/issue-001-cost-viability/`).
- Package manager, exact Node version pin, and test runner are build-detail (not load-bearing) —
  fixed in the first scaffold and not re-litigated here.
- Rules nothing out at the infra level (Supabase + Inngest unchanged); this ADR only names the
  language they are driven from.
- Spawns no new OD. Recorded as the first build-phase decision; the ADR index (this folder's
  README) gains the ADR-009 row.
