# ADR-012 — Model-call SDK layer (Vercel AI SDK primary + Anthropic SDK alongside)

- **Status:** Accepted
- **Date decided:** 2026-07-10
- **Supersedes:** the **model-call SDK-layer portion of ADR-009 only.** ADR-009's language/runtime
  decision (TypeScript on Node) is **unchanged and remains authoritative**; this ADR replaces only
  the sentence in ADR-009's Decision that named the direct `@anthropic-ai/sdk` + `openai` SDKs as the
  model-call layer.
- **Resolves:** [[OD-203]] — the unreconciled drift between the design doc and ADR-009 over which SDK
  layer drives model calls (surfaced by operator recall in a status review, 2026-07-10).
- **Affects:** every model call the harness makes — C8 orchestrator model routing, the specialists
  (ISSUE-062), memory-write (ISSUE-024), the run pipeline (ISSUE-053), and the cost ladder
  (ISSUE-058/066/074). No production model-client adapter exists yet (all model calls are behind
  injected ports + in-memory fakes), so this changes no shipped code — it fixes the target the first
  real adapter will be built against.

## Context

ADR-009 (Accepted 2026-07-03) was written to close a Rule-0 gap: the implementation *language* had
never been recorded. Its focus was language/runtime (TypeScript vs Python). In passing, its Decision
named `@anthropic-ai/sdk` + `openai` as the SDKs for vendor calls — and in doing so **silently dropped
the design doc's explicit model-SDK-layer choice.** The design doc (`spec/source/design-doc-v4.md`
L51) had named:

> **AI — Vercel AI SDK (primary):** "Unified interface for all model calls. Enables per-task model
> routing without rewriting agent logic." **Anthropic SDK (alongside)** — used directly when a
> Claude-specific capability (extended thinking, citations, new features) is not yet abstracted by
> the AI SDK.

OD-203 logged the fork with two options: **(A)** adopt the Vercel AI SDK as the design intended, or
**(B)** ratify the direct SDKs ADR-009 implicitly chose. The operator chose **(A)**.

## Decision

**The model-call layer is the Vercel AI SDK (`ai` + provider packages, e.g. `@ai-sdk/anthropic`) as
the primary unified interface, with the Anthropic SDK (`@anthropic-ai/sdk`) alongside** for
Claude-specific capabilities not yet abstracted by the AI SDK (extended thinking, citations,
newly-landed features). `openai` is retained for **embeddings** (`text-embedding-3-small`), which is
not a chat-model call and is unaffected by this decision.

Rationale for (A): per-task model routing is a **first-class abstraction** the design relies on — the
C8 orchestrator routes different task types to different models, and the cost ladder throttles/downgrades
by model, both without rewriting agent logic. A unified interface makes that routing and any future
provider-swap a config concern, not a code rewrite. This is the design-doc intent, and adopting it now —
before the first real model-client adapter is built — costs nothing already shipped.

## Consequences

- **The model-client port's real adapter** (unbuilt; owed at ISSUE-053 / the orchestrator's live path)
  is implemented against the Vercel AI SDK, not a direct Anthropic chat client. The in-memory fakes and
  the `ModelCallMeter` cost-shape contract (`app/memory-write`) are unaffected — they sit above the port.
- **The ISSUE-001 cost spike** (`spikes/issue-001-cost-viability/`, `@anthropic-ai/sdk` + `openai`
  direct) is **historical and left as-is** — it was a throwaway measurement harness, not production
  code; ADR-009's own Consequences already scoped it that way. Its cost numbers (AF-001 🟢) stand:
  the Vercel AI SDK is a thin interface over the same provider APIs, so per-token economics are unchanged.
- **Anthropic SDK stays a direct dependency** alongside the AI SDK for Claude-only features — this is
  not "AI SDK exclusively."
- `openai` remains for embeddings only.
- No glossary term changes. No new OD spawned. OD-203 → 🟢 RESOLVED.
- ADR-009 gains a "model-call SDK layer amended — superseded by ADR-012" banner; its language decision
  is untouched. The ADR index marks ADR-009 "SDK-layer amended by ADR-012" and adds this ADR-012 row.

## Feasibility note (paper-vs-proven)

The per-task-routing and provider-swap benefits are **design-coherent, not yet proven in code** — no
live model adapter exists. When the first real adapter is built (ISSUE-053 / orchestrator live path),
confirm the Vercel AI SDK's provider abstraction cleanly expresses (a) Claude-specific extended-thinking
/ citation calls via the Anthropic SDK escape hatch and (b) the cost-ladder model-downgrade routing. No
new `AF-*` is minted here (nothing is claimed proven); this note flags the verification owed at that
build step.
