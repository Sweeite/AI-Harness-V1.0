# ID Conventions

Every artifact in the spec has a stable, never-reused ID. IDs are the backbone of
traceability. Once assigned, an ID is permanent — if a requirement is dropped, its ID is
retired, not recycled.

## ID types

| Prefix | Meaning | Format | Example |
|---|---|---|---|
| `FR-` | Functional requirement | `FR-<component>.<area>.<nnn>` | `FR-2.MEM.014` |
| `NFR-` | Non-functional requirement | `NFR-<domain>.<nnn>` | `NFR-SEC.007` |
| `CFG-` | Config key | `CFG-<dotted.key.name>` | `CFG-memory.amber_zone_threshold` |
| `UI-` | Dashboard surface / panel | `UI-<dashboard>-<area>-<nn>` | `UI-OPS-MEM-03` |
| `DATA-` | Table or field | `DATA-<table>[.<field>]` | `DATA-memories.confidence` |
| `PERM-` | Permission node | `PERM-<category>.<action>` | `PERM-memory.write` |
| `AC-` | Acceptance criterion | `AC-<FR-id>.<n>` | `AC-2.MEM.014.2` |
| `OD-` | Open decision | `OD-<nnn>` | `OD-003` |
| `AF-` | Assumption / feasibility item (must be tested) | `AF-<nnn>` | `AF-001` |
| `ADR-` | Architecture decision record | `ADR-<nnn>` | `ADR-001` |
| `ISSUE-` | GitHub issue (assigned at Phase 6) | `#<n>` | `#142` |

## Component numbers (match the design doc)

```
0  Login & Authentication      → FR-0.*
1  RBAC                        → FR-1.*
2  Memory System               → FR-2.*
3  Tool Layer                  → FR-3.*
4  Prompt Architecture         → FR-4.*
5  Agent Harness               → FR-5.*
6  Guardrails                  → FR-6.*
7  Observability               → FR-7.*
8  Agent Design                → FR-8.*
9  Proactive Intelligence      → FR-9.*
10 Infrastructure & Compliance → FR-10.*
```

## Area codes (the `<area>` segment in FR IDs)

Assigned per component as we decompose it (e.g. component 2 Memory: `MEM`, `ING`
(ingestion), `RET` (retrieval), `CON` (consolidation), `DEC` (decay)...). Area codes are
recorded at the top of each component's requirements file.

## NFR domains

```
SEC   security        INF   infrastructure/deploy
OBS   observability   COST  cost/economics
CMP   compliance      PERF  performance
TEST  testing         A11Y  accessibility
DR    disaster recovery / backup
```

> `DR` added 2026-07-01 (Phase-5 entry, change-control): backup & disaster recovery is a
> first-class NFR domain in the plan (implements ADR-008) and warrants its own file + ID space
> rather than being folded under `INF`.

## Numbering rules

- Numbers are zero-padded to 3 digits and assigned sequentially within their scope.
- Gaps are fine (a retired ID leaves a gap). Never renumber.
- Sub-IDs (AC under FR) reset per parent.
