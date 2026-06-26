# Zoom-in: C4 Prompt Architecture — "what the AI *is*"

This opens up the **prompt layer** — the identity, principles, and constraints present in *every* model call.
Memory (C2) is what the AI knows; tools (C3) are what it can do; **C4 is what it is**. This map reflects the
C4 resolutions (OD-048…OD-053). Where this map and a requirement disagree, the requirement wins and this map
updates (change control).

**Scope (what C4 owns):** the four-layer model + content rules · the seven operating principles + the
safety floor · the `prompt_layers` store + version discipline · the optimisations.
**Seams out (what C4 does NOT own):** runtime **assembly** of the stack → **C5** (FR-4.LYR.004 says assembly
*must* validate; C5 *enforces*); memory retrieval/ranking + clearance gate → **C1/C2**; external-data tagging +
injection sanitization → **C6**; hard-limit *enforcement* → **C6** (+ C3 FR-3.ACT.002); answer-mode pill
*rendering* + `[Building]` overlay → **C5/C8**; orchestrator routing *behaviour* → **C8**; prompt-health /
version-performance *signals* → **C7**; the `agents` registry (minus the removed `system_prompt`) → **C8**.

## The four layers — defined by C4, assembled by C5

```
   ┌─────────────────────────────────────────────────────────────────────────┐
   │  LAYER 1  Core Identity     per-agent · never changes mid-run   (LYR.001-3)│
   │           who · principles · hard limits · uncertainty · scope · answer-mode│
   │  LAYER 2  Business Context  shared per deployment · static + dynamic (BIZ)  │
   │  LAYER 3  Memory Injection  per-agent + sensitivity-scoped         (INJ)    │
   │  LAYER 4  Task Instruction  the task · params · explicit output    (TSK)    │
   └───────────────────────────────────┬─────────────────────────────────────────┘
        C4 defines each layer + its content rules; C5 RETRIEVES, injects live/memory
        values, concatenates, and SENDS (L3338-3339).  ── assembly is the C5 seam ──
   FR-4.LYR.004: assembly MUST halt loudly if the resolved Layer 1 is missing the
   boundary instruction / hard-limit statement / principles block (#2/#3).
```
- **Layer 1 is per-agent, not global** (LYR.002) — orchestrator + each specialist have their own; only the
  **operating-principles block** is shared verbatim across all agents.

## Operating principles — the shared block + the floor (PRIN)

```
   THE SEVEN (every Layer 1, verbatim):  observe-before-acting · confirm-when-uncertain ·
   prefer-reversible · flag-don't-fix · memory-is-context-not-authority · stay-in-your-lane ·
   be-honest-about-what-you-know                                            (FR-4.PRIN.001)
        │
   EDITABLE — but only by SUPER ADMIN  (PERM-prompt.edit_principles, NOT Admin)   (OD-049)
        │   mandatory change_reason · safety-relevant audit event (C7) · confirm warning
   THE FLOOR (OD-053, hard-block):  reword/strengthen a principle = YES ·
        deleting one of the seven = BLOCKED  ── the safety posture can't be silently reduced (#2)
        │
   PRINCIPLES ≠ ENFCEMENT (PRIN.003): the prompt STATES; code ENFORCES
        stay-in-your-lane→C1 · prefer-reversible/flag→C6+OD-010 · memory-is-context→C2
```

## Prompt storage & versioning — one store, never overwrite (STO)

```
   prompt_layers  (core | business | memory | task_template)   single source of truth (OD-048)
        │          agents.system_prompt REMOVED/derived → reconciled in C8
   EDIT (dashboard, no redeploy):  PERM-prompt.edit (Super Admin + Admin)         (STO.005)
        │   principles need the higher PERM-prompt.edit_principles (Super Admin only)
   NEVER overwrite in place → increment version · keep priors (previous_version_id) ·
        mandatory change_reason (empty = rejected)   ── the immutable edit audit (STO.003)
   VERSION HISTORY + non-destructive ROLLBACK   (PERM-prompt.view_history/.rollback)  (STO.004)
   VERSION PINNING (OD-050):  pinned at assembly → in-flight tasks finish on their version,
        new tasks use the edit   ── reconciles LYR.003 mid-run immutability + clean attribution
```

## Layer 3 injection — scoped before it's built (INJ)

```
   retrieved memory → Layer 3 as Business Context                              (INJ.001)
        ├─ PER-AGENT scope (finance ≠ campaign memories)   agents.memory_scope (INJ.002)
        ├─ SENSITIVITY clearance — excluded BEFORE ranking, never after        (INJ.003)
        │       Restricted never auto-injected (C1 FR-1.RST.003 / C2 FR-2.RET.004)
        ├─ breach (above-clearance memory in an assembled L3) = halt-and-audit (INJ.003.3)
        └─ VOLUME bound: memories_injected_per_task (token-cost lever, ADR-003) (INJ.004)
```

## Optimisations (OPT) — feedback loop, paper-pending-test

- **Version→outcome attribution** (OPT.001): C4 owns the stable version identity + pin; the *signals* are C7
  (prompt-health L3589-3591). **Dynamic Layer 2** (OPT.002): goals/campaigns/priorities injected fresh, from
  the operator-editable store (OD-052), stale-beyond-threshold surfaced (BIZ.003.3). **Compression** (OPT.003):
  audited prompts preferred. ⚠️ **AF-111** — that attribution is signal-not-noise at low volume + that
  compression measurably outperforms is **EVAL, build-time** (paper, not proven).

## The three non-negotiables, applied to C4

- **#1 never lose knowledge** — never-overwrite versioning + retained priors + non-destructive rollback (STO.003/4).
- **#2 never do what it shouldn't** — the principles floor (OD-053), assembly-validates-safety-elements (LYR.004),
  sensitivity scoping before ranking (INJ.003), principle-states-but-code-enforces (PRIN.003).
- **#3 never fail silently** — mandatory change_reason + safety-audit on principles edits (PRIN.002), stale
  dynamic field surfaced (BIZ.003.3), assembly halts loudly on a missing element (LYR.004).
