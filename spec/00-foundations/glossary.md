# Glossary — Ubiquitous Language

Every load-bearing term, defined exactly once. If a term is used in a requirement, it must
appear here with a single agreed meaning. Terms marked **🔴 OPEN** are undefined in the
design doc and blocked on an Open Decision — they cannot be used in a `Ready` requirement
until resolved.

| Term | Definition | Status |
|---|---|---|
| Deployment | One isolated instance (own Supabase project + Railway service) serving exactly one client. The tenant boundary. | ✅ ADR-001 |
| Management plane | The operator's separate Super Admin deployment; holds `client_registry` + pushed operational metadata only. Never client business data. | ✅ ADR-001 |
| Client | The agency that pays for and uses a deployment. One client = one deployment. | ✅ |
| Internal Org | The single first-class entity representing the agency itself (not its clients). | ✅ |
| Entity | A business noun memories attach to (client, contact, campaign, etc.). | ✅ |
| Memory | A stored unit of knowledge: semantic, episodic, or procedural. | ✅ |
| Working memory | The active context window during a task; transient unless written back. | ✅ |
| Visibility | Access scope of a memory: global / team / private. Orthogonal to sensitivity. | ✅ |
| Sensitivity | Handling class of a memory: standard / confidential / personal / restricted. | ✅ |
| Clearance | A role's granted access to sensitivity levels. | ✅ |
| Answer mode | The provenance pill on every AI output: Cited / Inferred / Unknown (/ Building?). | ⚠️ Building pill conflicts with "always exactly three" — see OD |
| **Coverage %** | The metric driving cold-start gating, the Building pill, and feature unlocks. | 🔴 OPEN — never defined; **ADR-002** |
| Cold start | The period from deployment to "sufficient" memory coverage. | ⚠️ depends on Coverage % |
| Confidence | A memory's 0.0–1.0 trust score, set at write and moved over its life. | ✅ |
| Decay | Scheduled downward drift of confidence for stale, unconfirmed memories. | ✅ |
| Supersede | Marking an old memory replaced by a newer one (chain preserved, not deleted). | ✅ |
| Consolidation | Merge / supersede / summarise jobs that keep memory healthy. | ✅ |
| System of record | The external system that owns a piece of data (GHL, Drive, Slack). | ✅ |
| Pointer | A memory that references data owned by a system of record, not a copy of it. | ✅ |
| Orchestrator | The routing agent; plans and delegates, never does the work itself. | ✅ |
| Specialist agent | A focused agent owning one domain (research, client, campaign, ...). | ✅ |
| Context envelope | The structured package passed through every agent in a task graph. | ✅ |
| Task graph | The ordered, versioned step sequence for a task type. | ✅ |
| Loop | A scheduled recurring job set: fast / medium / slow (+ custom). | ✅ |
| Trigger | What wakes the system: event-driven / scheduled / human / chained. | ✅ |
| Approval gate | Auto / soft / hard tiers of human oversight on an action. | ✅ |
| Hard limit | A never-do action enforced in both prompt and code. | ✅ |
| Guardrail | Any safety mechanism: hard limit / approval / anomaly / rate limit / injection. | ✅ |
| Tunable / Config key | A value that changes behaviour without code change. | ✅ |
| Config edit class | SECRET / BOOT / LIVE / REBUILD — how a config takes effect. | ✅ see standards/config-edit-taxonomy.md |
| Surface | Any UI view, panel, modal, banner, or queue. | ✅ |
| Permission node | An atomic, role-gated capability (default-deny). | ✅ |
| Open Decision (OD) | A tracked unresolved question blocking one or more requirements. | ✅ |

> Add a row the first time any new term appears in a requirement. Never let two requirements
> use the same word for different things.
