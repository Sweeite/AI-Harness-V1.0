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
| OOS-010 | Automated plugin distribution / versioning | Deferred v2 | v1 `/plugins` is per-deployment, manually updated, out of the core release train; only version **visibility** (per-deployment) is in v1 | ADR-005 §7, design L19-27 | If plugin churn across many clients makes manual updates painful |
| OOS-011 | Full IaC (Terraform) provisioning | Rejected (v1) | v1 uses a scripted CLI + runbook; full IaC is gold-plating a ≤~20-run path, and the client-owned/consent steps can't be IaC'd | ADR-005 §B (Axis 2) | If client count materially exceeds the ~20 ceiling |

| OOS-012 | JWT-cached permission claims (denormalise roles/clearances onto the token) | Deferred (perf optimisation) | v1 reads permissions **live** from the tables each query (ADR-006 D3) — instant grant/revoke, no staleness. Caching on the JWT (D2) is faster but imports a stale-access window + propagation machinery not worth it at ≤20 users; kept as the documented **fallback** only if AF-067 shows the live lookup can't keep up at scale | ADR-006 §Axis 1 (D2), AF-067 | If a deployment's permission-check latency on the retrieval path proves unacceptable |
| OOS-013 | Backup of Supabase Storage buckets | Out (v1) | Backups (daily + PITR) cover the Postgres DB only (incl. pgvector + auth). In v1 Storage holds solely **regenerable offboarding export files** (`L97`) — transient output, not source-of-truth knowledge; losing one means re-running an export. **Re-opens** if a future component stores non-regenerable files in Storage (bucket-copy must then join the off-platform job) | ADR-008 part 6 | A component puts non-regenerable files in Supabase Storage |
| OOS-014 | Hot failover / read-replica HA as a v1 default | Out (v1), per-client upsell | Supabase auto-failover is Enterprise-only; a silo's DR is backup-restore-with-downtime, acceptable at ADR-001 scale (≤~20 clients, ≤~20 users). Read replicas / HA are a per-client upsell, not a default | ADR-008 (DR posture) | A client needs sub-restore-window RTO / contractual HA |
| OOS-015 | Full SMTP bounce-webhook reconciliation for invite/seed emails | Deferred (Phase 5 / connector) | C0 ships the **send-side** delivery guarantee (FR-0.INV.003 surfaces unconfigured/throttled SMTP) + best-effort bounce surfacing where the provider exposes it (FR-0.INV.007). Wiring provider-specific async bounce webhooks + reconciliation is heavier connector plumbing, not core C0 auth; the send-side guard covers the common silent-failure case | FR-0.INV.007, quality-gate OWED-FR-2 | Choosing the production SMTP provider (Phase 5) / first real bounced-invite incident |

| OOS-016 | Cold storage for old, low-access memories (tiered storage) | Deferred v2 | The design moves memories >12 months old with low access out of the hot vector index (`L1897`, `L1962`). v1 **does not build it**: it adds a lose-a-memory failure mode (#1 — a cold memory silently unfindable when needed) for a benefit that doesn't materialise at launch scale, since HNSW stays fast well past ≤20-user / first-12-month volume (the reason HNSW was chosen, AF-019). FR-2.MNT.012 is specced but v2-deferred. When built, design toward keeping cold memories **in-table + keyword-reachable + rehydratable**, never fully archived-and-unsearchable | OD-034, design L1897/L1962, AF-019 | When AF-019 (pgvector LOAD) shows the hot index has grown enough that retrieval latency/cost needs thinning |
| OOS-017 | Structured typed-field extraction at write time; query decomposition | Deferred v2 | Design optimisations (`L1958–1961`): extract key facts into typed fields (sharper keyword retrieval) and break complex tasks into sub-questions retrieved separately. v1 stores prose memories + the dual-search/ranking path; these are refinements to add if retrieval quality needs them | design L1958-1961, ADR-003 (controls before gates) | If an AF-002 eval shows prose retrieval misses structured facts / multi-part queries |

> Add a row whenever a decision *excludes* or *postpones* something. Next OOS number: OOS-018.
