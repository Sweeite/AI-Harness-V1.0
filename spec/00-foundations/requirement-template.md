# Functional Requirement Template

Every functional requirement uses this exact shape. No prose paragraphs — fielded data so
nothing is implied. A requirement with any field blank (other than where explicitly N/A)
is not `Ready`.

```markdown
### FR-<comp>.<area>.<nnn> — <short imperative title>

- **Statement:** The system shall <single, atomic, testable behaviour>.
- **Source:** design-doc-v4.md L<line(s)> [+ other origins]
- **Status:** Draft | Review | Ready | Built | Verified
- **Priority:** Must | Should | Could  (MoSCoW)
- **Actor / trigger:** <who or what initiates — role, event, loop, schedule>
- **Preconditions:** <what must be true before this can run>
- **Behaviour:**
  - Happy path: <ordered steps>
  - Branches: <every conditional outcome>
  - Edge / failure: <what happens when it goes wrong>
- **Data touched:** DATA-<...> (read/write per field)
- **Permissions:** PERM-<...> (who may invoke; default-deny otherwise)
- **Config dependencies:** CFG-<...> (which tunables affect behaviour)
- **Surfaces:** UI-<...> (where this is seen / actioned), or N/A (backend-only)
- **Observability:** what gets logged (event_log / guardrail_log / audit) and what alerts
- **Acceptance criteria:**
  - AC-<id>.1 — Given <state>, When <action>, Then <observable result>.
  - AC-<id>.2 — ...
- **Open decisions:** OD-<...> (must be empty before Status = Ready)
- **Notes:** <implementation hints that are NOT requirements — clearly marked>
```

## Rules for writing good requirements

1. **Atomic** — one behaviour per FR. If a statement has "and" joining two behaviours, split it.
2. **Testable** — every FR must have at least one Given/When/Then acceptance criterion. If
   you can't write the test, the requirement is too vague.
3. **No solutioning in the Statement** — say *what*, not *how*. Implementation hints go in Notes.
4. **Every branch explicit** — happy path is never enough. Enumerate every conditional and failure.
5. **Default-deny permissions** — if a role isn't listed, it's denied. State it.
6. **No `???` in a Ready requirement** — any unknown is an OD, and an open OD blocks Ready.
