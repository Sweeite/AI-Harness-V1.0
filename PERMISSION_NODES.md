# PERMISSION_NODES.md — the authoritative permission-node catalog

> **Owned by C1 FR-1.PERM.005.** This is the build-time source of truth for every permission node.
> It seeds `DATA-role_permissions` defaults and drives the Phase-3 permission-matrix admin dashboard
> (`UI-PERMISSION-MATRIX`). **Whenever a new gated action / view / config function / command ships,
> add its node here immediately** with all four fields (Description · Default roles · Scope · Added-in) —
> a gate with no catalog entry is a build-time defect (#3).

## Rules

- **Default-deny (OD-030).** Any node not explicitly granted to a role is denied for that role. A node
  with **no seed assignment** below defaults to **Super Admin only** until a seed is decided — it is never
  silently open.
- **Six canonical roles** (C1 FR-1.ROLE.001): **Super Admin · Admin · Finance · HR · Account Manager ·
  Standard User.** Custom roles are data-defined per deployment; these six are the seed baseline. Never
  invent role names (no "Advanced/Basic Member", no "Agency Owner").
- **Scope is intra-client** for every *client-deployment* node (ADR-001 / ADR-006) — permissions never cross
  deployment boundaries. The Scope column notes any narrower scope (e.g. own-records-only) **or** the broader
  **`management-plane`** scope (the operator's separate Super Admin deployment, ADR-001 §7 — the `PERM-fleet.*`
  family; surface-06 / OD-125). A management-plane node still grants nothing *inside* a client (FR-10.MGT.003).
- **The full role × node default matrix** lives in design-doc L509–615 (the 12 categories). This file is
  the per-node catalog; the matrix dashboard renders it (Phase 3).

## Status

Consolidated 2026-06-28 from a full `PERM-*` harvest across `spec/01-requirements/` + `spec/02-config/`.
**37 real nodes** at consolidation (4 harvested tokens were prose/wildcard fragments: `PERM-config`, `PERM-gated`,
`PERM-node`, `PERM-system` — not nodes). **+5 management-plane nodes** transcribed 2026-06-30 (surface-06 / OD-125 —
the `PERM-fleet.*` family) = **42 catalogued**; **+2 Dashboard Access nodes** transcribed 2026-07-01 (surface-07 /
OD-129 — `PERM-dashboard.overview` + `PERM-dashboard.ops`, formalising the FR-1.PERM.007 category + canonicalising
surface-05's `view_ops` working name) = **44 catalogued**; **+1 Dashboard Access node** transcribed 2026-07-01
(surface-08 / OD-133 — `PERM-dashboard.workspace`, the third node of the family, anticipated by OD-129) = **45
catalogued**; plus **3 owed** (surface-03 OD-115 ×2, surface-04 OD-117 ×1
— defined in `open-decisions.md`, not yet transcribed, flagged below). **5 nodes carry no explicit seed holder yet** (marked ⚠️ —
they default-deny per OD-030 until seeded): `PERM-compliance.download_records`, `PERM-memory.write`,
`PERM-prompt.rollback`, `PERM-prompt.view_history`, `PERM-system.add_sensitivity`.

---

## Catalog (grouped by owning component)

### C0 — Login / Auth (homed in C1)
| Node | Description | Default roles | Scope | Added-in |
|---|---|---|---|---|
| `PERM-auth.provider_toggle` | Toggle the OAuth / auth provider (deployment auth config) | Super Admin | deployment auth | C0 |
| `PERM-support.view` | View the support / "trouble signing in" queue | Super Admin, Admin | intra-client | C0 |
| `PERM-support.resolve` | Transition / resolve support-queue requests | Super Admin, Admin | intra-client | C0 |
| `PERM-user.invite` | Invite users | Super Admin, Admin | intra-client | C0 |

### C1 — RBAC
| Node | Description | Default roles | Scope | Added-in |
|---|---|---|---|---|
| `PERM-system.role_manage` | Create / edit / delete roles + their node assignments | Super Admin | intra-client | C1 |
| `PERM-system.add_sensitivity` ⚠️ | Add custom sensitivity levels beyond the four | Super Admin (unseeded) | intra-client | C1 |
| `PERM-user.assign_role` | Assign roles to users | Super Admin, Admin | intra-client | C1 |
| `PERM-user.deactivate` | Deactivate a user account | Super Admin, Admin | intra-client | C1 |
| `PERM-user.reset_2fa` | Reset a user's 2FA / MFA factors | Super Admin, Admin | intra-client | C1 |
| `PERM-user.view_activity` | View a user's activity log | Super Admin, Admin | intra-client | C1 |
| `PERM-user.grant_clearance` | Grant a sensitivity clearance | Super Admin | intra-client | C1 |
| `PERM-user.grant_restricted` | Grant Restricted access per named individual | Super Admin | per-individual | C1 |

### C2 — Memory (gated by C1)
| Node | Description | Default roles | Scope | Added-in |
|---|---|---|---|---|
| `PERM-memory.write` ⚠️ | Human writes / edits to memory rows | Super Admin (unseeded) | intra-client | C2 |
| `PERM-memory.delete` | Compliance erasure / hard-delete of memory (right-to-erasure) | Super Admin (+ erasure gate) | intra-client | C2 / C10 |
| `PERM-ingestion.initiate` | Initiate memory / document ingestion | Super Admin, Admin | intra-client | C2 |
| `PERM-ingestion.interview` | Run onboarding interviews | Super Admin, Admin | intra-client | C2 |
| `PERM-ingestion.review` | Review the ingestion queue (include / defer) | Super Admin, Admin | intra-client | C2 |

### C3 — Tool layer (homed in C1 / C6)
| Node | Description | Default roles | Scope | Added-in |
|---|---|---|---|---|
| `PERM-tool.manage` | Edit the tool registry (create / version tools) | Super Admin, Admin | intra-client | C3 |

### C4 — Prompt architecture (homed in C1)
| Node | Description | Default roles | Scope | Added-in |
|---|---|---|---|---|
| `PERM-prompt.edit` | Edit general (non-principles) prompt content | Super Admin, Admin | intra-client | C4 |
| `PERM-prompt.edit_principles` | Edit the operating-principles block (the hard floor) | Super Admin | intra-client | C4 |
| `PERM-prompt.rollback` ⚠️ | Roll back a prompt asset to a prior version | Super Admin (unseeded) | intra-client | C4 |
| `PERM-prompt.view_history` ⚠️ | View prompt version history | Super Admin (unseeded) | intra-client | C4 |

### C9 — Proactive / Commands (homed in C1)
| Node | Description | Default roles | Scope | Added-in |
|---|---|---|---|---|
| `PERM-commands.manage` | Create / edit / delete custom chat commands | Super Admin, Admin | intra-client | C9 |
| `PERM-system.tune` | `/tune` + full system commands (threshold config) | Super Admin, Admin | intra-client | C9 |

### C10 — Infra / Compliance
| Node | Description | Default roles | Scope | Added-in |
|---|---|---|---|---|
| `PERM-config.edit` | Edit infra / compliance CFG-* values | Super Admin | deployment | C10 |
| `PERM-compliance.download_records` ⚠️ | Export / download compliance audit records | Super Admin (unseeded) | intra-client | C1 (specced C7) |

### Config Admin — the `PERM-config.*` family (Phase 2; all default **Super Admin only**)
| Node | Description | Default roles | Scope | Added-in |
|---|---|---|---|---|
| `PERM-config.auth` | Config sections A (auth/session), B (webhooks), C (support) | Super Admin | deployment | Phase 2 |
| `PERM-config.memory` | Config section E (memory) | Super Admin | deployment | Phase 2 |
| `PERM-config.tools` | Config section F (tool layer / connectors) | Super Admin | deployment | Phase 2 |
| `PERM-config.prompts` | Config section G (prompt architecture) | Super Admin | deployment | Phase 2 |
| `PERM-config.loops` | Config section H (agent harness / loops) | Super Admin | deployment | Phase 2 |
| `PERM-config.guardrails` | Config section I (guardrails, anomaly, rate, cost ladder, injection) | Super Admin | deployment | Phase 2 |
| `PERM-config.observability` | Config section J (observability incl. alert routing) | Super Admin | deployment | Phase 2 |
| `PERM-config.agents` | Config section K (agent routing, models, health) | Super Admin | deployment | Phase 2 |
| `PERM-config.proactive` | Config section L (scanners, thresholds, cold-start) | Super Admin | deployment | Phase 2 |
| `PERM-config.infra` | Config section M (deploy, residency, retention, deletion policy) | Super Admin — never delegable | deployment | Phase 2 |
| `PERM-config.secrets` | Config section N (platform secrets — presence-only view) | Super Admin (read-only) | deployment | Phase 2 |

### Dashboard Access — the `PERM-dashboard.*` family (FR-1.PERM.007 category; surface-07 / OD-129, minted via change-control 2026-07-01)
> The FR-1.PERM.007 "Dashboard Access" category was homed but had **no concrete node id** until surface-07 OD-129
> formalised the family (closing surface-05's dangling `view_ops` working-name reference). Scope = **intra-client**
> (per-deployment dashboard views). The **notification centre is deliberately node-free** — it is cross-cutting chrome
> available to any holder of any Dashboard Access node, clearance-scoped per viewer (FR-7.ALR.001 "accessible from
> every view" / AC-7.VIEW.002.1).
| Node | Description | Default roles | Scope | Added-in |
|---|---|---|---|---|
| `PERM-dashboard.overview` | Enter the agency / management overview dashboard (surface-07 — activity feed + at-a-glance + proactive suggestions) | Super Admin, Admin, Account Manager | intra-client | surface-07 / OD-129 |
| `PERM-dashboard.ops` | Enter the technical operations dashboard (surface-05); canonicalises surface-05's working name `PERM-dashboard.view_ops` | Super Admin, Admin (+ Finance scoped to Cost panel, surface-05 OD-121) | intra-client | surface-05 (ref) / surface-07 / OD-129 |
| `PERM-dashboard.workspace` | Enter the personal user workspace (surface-08 — chat + My Queue + my activity feed + my proactive suggestions) | All six roles (every authenticated user has a personal workspace; per-`/`-command authority stays finer, FR-9.CMD.002) | intra-client | surface-08 / OD-133 |

### Guardrails — autonomy (pre-existing, glossary)
| Node | Description | Default roles | Scope | Added-in |
|---|---|---|---|---|
| `PERM-guardrail.edit_autonomy` | Edit `action_autonomy_matrix` (autonomy tiers; floored rows reject downgrade) | Super Admin | deployment | C6 / C9 |

### Management Plane — the fleet console (surface-06 / OD-125, minted via change-control 2026-06-30)
> **Scope = `management-plane`** — a scope *beyond* intra-client: these nodes live on the operator's **separate Super
> Admin management deployment** (ADR-001 §7), not in any client silo. All **Super Admin only / never delegable**.
> "Looking inside a client" is **not** one of these — it is logging into that client's own dashboard under that
> client's RBAC (FR-10.MGT.003.2).
| Node | Description | Default roles | Scope | Added-in |
|---|---|---|---|---|
| `PERM-fleet.view` | Enter the fleet console (deployment health grid + read-only cross-deployment panels) | Super Admin — never delegable | management-plane | surface-06 / OD-125 |
| `PERM-fleet.provision` | Run/track the provisioning flow + register a new client (FR-10.PRV.001) | Super Admin — never delegable | management-plane | surface-06 / OD-125 |
| `PERM-fleet.promote_release` | Promote a release (canary→main) and roll back (FR-10.DEP.002/003) | Super Admin — never delegable | management-plane | surface-06 / OD-125 |
| `PERM-fleet.offboard` | Initiate + execute client offboarding (FR-10.OFF.*); **hard-delete additionally requires two-person auth — a distinct second `PERM-fleet.offboard` holder, no self-second** (AC-10.DEL.006) | Super Admin — never delegable | management-plane | surface-06 / OD-125 |
| `PERM-fleet.rotate_token` | Rotate a deployment's `internal_token` (FR-10.MGT.004) | Super Admin — never delegable | management-plane | surface-06 / OD-125 |

> **⚠️ Owed to this catalog (known drift, flagged not hidden — #3):** two surface-03 nodes (OD-115
> `PERM-memory.review_conflict`, `PERM-memory.approve_consolidation`) and one surface-04 node (OD-117
> `PERM-action.review`) were minted via change-control and fully defined in `open-decisions.md` but have not yet been
> transcribed into this catalog. They are build obligations (FR-1.PERM.005) and should be added here when their owning
> surfaces are next touched. surface-06's nodes are transcribed above immediately, per this file's add-on-ship rule.

---

**Maintenance:** add a row the moment a new gate ships (FR-1.PERM.005). When a ⚠️ stub's seed holder is
decided, replace "(unseeded)" with the seeded roles and drop the ⚠️. Keep this file and the
`traceability-matrix.csv` PERM references in sync.
