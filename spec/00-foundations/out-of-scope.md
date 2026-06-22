# Out-of-Scope & Deferred (v2+) Register

A home for things consciously **not** built in v1 and things **punted to later**. This exists
to (1) stop scope creep, (2) stop us re-litigating settled cuts, and (3) power the final
walkthrough's "here's what we decided *against* / deferred" prompt — which is how we catch
what's still stuck in your head.

Each item: what it is, why it's out/deferred, where the decision came from, and what would
make us revisit it. Adding something here is a *decision*, not a gap.

| # | Item | Status | Why out / deferred | Source | Revisit when |
|---|---|---|---|---|---|
| OOS-001 | Per-deployment region selection | Deferred v2 | v1 runs all deployments in Sydney (ap-southeast-2); per-client region is a single config value later | design-doc L29-33 | First non-AU client with residency needs |
| OOS-002 | Confidence-weighted slot-fill for Maturity | Deferred v2 | v1 Maturity uses **binary** slot-fill (filled / not); weighting by confidence is a refinement | ADR-002 | After AF-002 / AF-034 show binary is too coarse |
| OOS-003 | Re-ranking & HyDE retrieval | Out (v1), off-by-default | Add read-path LLM cost for unproven payoff; "controls before gates" forbids mandating them | ADR-003 §6, design L1950-1956 | If an AF-002 eval proves they earn their cost |
| OOS-004 | Self-hosted Inngest | Deferred | v1 uses Inngest cloud; self-host is for data-sovereignty/on-prem clients | design-doc L2740-2742 | A client contractually requires on-prem jobs |
| OOS-005 | Client-owned compute (full Model A) | Exception only | v1 is hybrid — operator owns Railway (protects the codebase moat); full client compute ownership only if a client insists | ADR-001 §5 | A specific client demands owning compute |
| OOS-006 | Pooled multi-tenant architecture | Rejected (fallback) | v1 is Silo; pooled kept only as a documented fallback | ADR-001 | Only if pivoting to many tiny price-sensitive clients |
| OOS-007 | Weekly cost **auto-throttle** | Out (v1) | v1 weekly cost rung is human-attention only; auto-actions are daily-anchored | ADR-003 §2 | If sustained just-under-ceiling burn becomes a real incident |
| OOS-008 | HR email / content ingestion | Off by default | Per-client decision requiring jurisdiction-specific legal review before enabling | design-doc L889, L1420 | Per client, with legal sign-off |
| OOS-009 | Hybrid cost reconcile (estimate → real invoice) | Deferred | Reconciling against the real bill needs invoice access, which the ADR-001 boundary forbids | ADR-003 §3 (C3) | Only if a boundary-safe invoice feed becomes possible |

> Add a row whenever a decision *excludes* or *postpones* something. Next OOS number: OOS-010.
