# Component Zoom-in Maps

The overview (`../system-map.md`) shows the whole route. Each file here **opens up one
component** — its internal flow, the pieces, where decisions/config/surfaces live.

**Build policy (deliberate, to avoid drift):** a component's zoom-in is built (or finalized)
**when we spec that component in Phase 1**, so the map and its requirements are written together
and stay perfectly in sync — never a speculative map that later contradicts the spec. Memory is
built now as the **exemplar** because it's the heart of the system and its internals are already
locked by accepted ADRs. **If a specific component is causing anxiety now, say so and its zoom-in
gets built immediately** — out-of-order is fine when it helps you see.

| Map | Component | Status |
|---|---|---|
| `02-memory.md` | C2 Memory | ✅ built (component 2 Approved, 2026-06-25) |
| `00-login.md` | C0 Login & auth | ✅ built (component 0 Approved, 2026-06-24) |
| `01-rbac.md` | C1 RBAC | ✅ built (component 1 Approved, 2026-06-24) |
| `03-tools.md` | C3 Tool layer | ⚪ at Phase 1 |
| `04-prompt.md` | C4 Prompt architecture | ⚪ at Phase 1 |
| `05-harness.md` | C5 Agent harness | ⚪ at Phase 1 |
| `06-guardrails.md` | C6 Guardrails | ⚪ at Phase 1 (after ADR-007) |
| `07-observability.md` | C7 Observability | ⚪ at Phase 1 |
| `08-agent-design.md` | C8 Agent design | ⚪ at Phase 1 |
| `09-proactive.md` | C9 Proactive intelligence | ⚪ at Phase 1 |
| `10-infra-compliance.md` | C10 Infra & compliance | ⚪ at Phase 1 |
