---
id: ISSUE-082
title: Individual right-to-erasure workflow (two-person auth, verify-before-done)
epic: K — infra & compliance
status: done
github: "#82"
---

> **DONE (Session 88, 2026-07-11).** `app/compliance-erasure/` (`@harness/compliance-erasure`; port + InMemory fakes +
> `supabase-store.ts` + `check` + **46/46** tests, tsc clean). The C10 request-to-audit workflow wrapping ISSUE-029's
> C2 `eraseTarget` — Admin deletion queue + derived escalation sweep (FR-10.DEL.001); two-class identification
> (deterministic `entity_ids[]` vs recall-oriented name-in-content, surfaced-for-confirmation, never auto-actioned —
> FR-10.DEL.002 / **AF-134 EVAL green**, 100% literal recall, paraphrase misses surfaced as residual review burden);
> **two-person authorisation as a perm-checked, persisted, two-step handshake** (`authorizeRequest` +
> `secondAuthorizeRequest`, execute READS persisted authorisers — a single admin can't fabricate a second; two-person
> unconditional, DB-mandated — FR-10.DEL.006 / NFR-SEC.015); frozen-deployment guard fail-closed (FR-10.DEL.007);
> de-link of the target from **every** surviving memory incl. non-Personal business records C2's Personal-remit skips,
> narrow-term `[REDACTED]` content scrub via the sole-writer (FR-10.DEL.003/004); connector_deletion_flags raise/track/
> escalate/fail-closed (FR-10.DEL.006(a)); and the **verify-before-done ALLOWLIST** gate (every C2 leg complete except
> `scrub_pending`=owed / `escalation_emit`=failed; empty/unknown/failed/blocked → hold + escalate, no done-audit —
> AC-10.DEL.003.4); immutable `access_audit` deletion record fail-closed (FR-10.DEL.005). Migration **`0047`** (9
> additive lifecycle `event_type` values) + **`0048` contract** (fixed a latent 0001 baseline bug: the
> `deletion_requests` distinctness CHECKs rejected the all-null intake insert — `is distinct from` is FALSE for
> both-null — discovered by R10). **3-lens adversarial verify: 1 BLOCKER (two-person self-satisfiable) + 2 MAJOR
> (denylist verify-gate; redaction over-scrubs third parties) + ~7 MINOR/NIT, all fixed regression-test-first.**
> Migrations `0047`+`0048` applied LIVE (silo head `0046→0048`); **R10 live smoke 15/15 PASS** (rolled back, silo clean).
> Logged **OD-206** (deletion_requests records subject as `target_user_id` only — audit-tombstone is the entity-level
> proof; ship-as-is). AF-137 consumed at the verify-before-done boundary. GitHub #82 CLOSED. **`082` is a leaf (blocks
> nothing); all Stage-7 issues now done → Checkpoint 7 ready for its integration test.**

> **Unblocked (Session 87):** ISSUE-029 (the C2 memory-side transitive-delete mechanism this workflow calls via
> FR-10.DEL.003) is `done` — `app/memory-erasure/` exposes `eraseTarget(deps, target, authz)` returning an
> `ErasureReport` whose `done` field is the completeness verdict this workflow verifies before writing its audit-done
> record (AC-10.DEL.003.4). Other blocker `021` is also done. §7 met → `ready`.

# ISSUE-082 — Individual right-to-erasure workflow (two-person auth, verify-before-done)

> **Self-sufficiency contract (read this first).** This issue is a *complete, precise build
> order that points into the repo by ID*. It does **not** restate `AC-*` text — that lives in the
> FR and is read there (copying it would create a second source of truth that rots = Rule-0
> violation). A builder with **zero conversation history** must be able to open the files named in
> the Context manifest and build this slice to its Definition of done **without guessing**.

## 1. Goal (one line)
Build the C10 individual right-to-erasure *workflow* — the Admin request queue, two-class identification (deterministic `entity_id` + human-confirmed name-in-content), conditional entity-id removal / content scrubbing, the permanent deletion audit record, the connector-notify flag + two-person authorisation, and the frozen-deployment guard — wrapping (never re-implementing) the ISSUE-029 C2 transitive-delete mechanism and verifying it returned complete before ever reporting a deletion done.

## 2. Scope — in / out
**In:** the request-to-audit workflow C10 owns end-to-end:
- The **Admin deletion queue** (FR-10.DEL.001): intake with requester + legal-basis + target, review, Admin/Super-Admin authorise, execute; a request that sits un-actioned past a configured window **escalates** (legal obligation, statutory clock), never silently expiring; RBAC-gated on `PERM-memory.delete`.
- **Step 1 — two-class identification** (FR-10.DEL.002): deterministic set (target's entity record + every memory whose `entity_ids[]` contains the target) auto-enumerated; probabilistic set (name/identifier in `content`, keyword + semantic) **surfaced for human confirmation**, never auto-actioned on a fuzzy match; the sweep is recall-oriented (identifiers + name variants).
- **Steps 2–3 — conditional id-removal + hard-delete + entity-record delete** (FR-10.DEL.003): C10 owns the array-removal / empty-test **policy** (remove `entity_id`; empty → invoke C2 transitive hard-delete; non-empty → retain + audit-note; then hard-delete the entity record + entity-only data) — the actual transitive delete is **ISSUE-029's** C2 mechanism (FR-2.MNT.017), invoked here; and the **verify-before-"done"** gate across the C10→C2 boundary (AC-10.DEL.003.4).
- **Step 4 — content scrubbing** (FR-10.DEL.004): on human confirmation, `[REDACTED]` of personal mentions in *retained* multi-entity memories (via the C2 sole-writer), context preserved, logged per memory; a target also present in log sinks **triggers** the C7 redaction-tombstone (via C2 AC-2.MNT.017.4 — this slice fires it as the caller).
- **Step 5 — permanent deletion audit record** (FR-10.DEL.005): immutable `access_audit` record (requester / authoriser / executor / when / affected-count / hard-deleted∣id-removed∣redacted split) retained `CFG-individual_deletion_audit_years`, containing no erased PII; the audit write fails the erasure **closed** if it cannot be written.
- **Step 6 + authorisation** (FR-10.DEL.006): per-system `connector_deletion_flags` (tracked-until-acknowledged; the harness never deletes from a SoR) + the **two-person auth** gate for Restricted/Personal (a second *distinct* Admin/Super-Admin; executor ≠ authoriser ≠ second — DB-enforced), fail-closed when the config or connector-presence detection can't be resolved.
- **Frozen-deployment guard** (FR-10.DEL.007): an ad-hoc erasure on an `offboarding`/`frozen` deployment is blocked + surfaced (local read of `deployment_settings.frozen_at`), never silently no-op'd.

**Out:**
- The **C2 memory-side transitive-delete engine** — the true hard-delete of rows + `superseded_by` chain + episodic evidence + embeddings + merged/summarised derived rows, the `access_audit` tombstone, raising the backup-purge flag, triggering the C7 log redaction, and the per-leg verified-complete-or-fails-loud return: **ISSUE-029** (FR-2.MNT.017). This slice *invokes* it via FR-10.DEL.003 and *verifies* its completeness return; it does not re-implement the walk.
- The **C7 log-sink redaction mechanism** itself (in-place PII scrub + tamper-evident tombstone on `event_log`/`guardrail_log`/`config_audit_log`): C7 (NFR-CMP.007 / AC-7.LOG.006.3 / AC-7.LOG.007.4). This slice only triggers it (through C2).
- The **off-platform backup-purge** processing: Phase 5 backup/DR (NFR-DR.009, ISSUE-085). ISSUE-029 raises the flag; ISSUE-085 processes it.
- The **role model / `can()` gate / permission-node table** that homes `PERM-memory.delete`: **ISSUE-018**. The **user lifecycle + RBAC audit** the two-person authoriser identities resolve against: **ISSUE-021**.
- The **client offboarding** hard-delete path (FR-10.OFF.*): **ISSUE-083**. **Retention config values + isolation/residency**: **ISSUE-084**.
- All **rendering** — the Admin deletion queue, the affected-records / redaction confirmation views, the connector-deletion checklist + two-person confirm: **Phase 3**. This slice owns the workflow + state contract.

## 3. Implements (traceability spine — by ID, not restated)
- **FRs:** FR-10.DEL.001, FR-10.DEL.002, FR-10.DEL.003, FR-10.DEL.004, FR-10.DEL.005, FR-10.DEL.006, FR-10.DEL.007 (all Component 10 — infra & compliance).
- **NFRs:** NFR-CMP.005 (individual right-to-erasure — two-class ID, transitive delete, verify-before-done; this slice owns the C10 workflow legs), NFR-CMP.007 (redaction-tombstone on erasure — this slice is the caller that triggers it via C2), NFR-SEC.015 (two-person authorization for sensitive deletion — DB-enforced distinctness), NFR-SEC.016 (reason-capture on sensitive mutations — legal-basis capture on the request), NFR-DR.009 (off-platform backup-purge flag — raised on the C2 leg this workflow drives).
- **Rests on:** ADR-004 (sole-writer path all hard-deletes go through), ADR-001 §3 (no `client_slug` in app tables — target resolves by `entity_id`, not client identity) / §7 (management plane, freeze-write path OD-162), AF-134 (erasure recall / name-identifier matching), AF-136 (jurisdiction-specific lawful minimums — gated by legal review, FR-10.LEG.001), AF-137 (transitive-erasure completeness verification — the C2 leg's gate, consumed here at the verify-before-done boundary).

## 4. Definition of done (the `AC-*` IDs that must pass — text read in the FR)
- AC-10.DEL.001.1, AC-10.DEL.001.2, AC-10.DEL.001.3 (FR-10.DEL.001 — queue, escalate-on-timeout, RBAC)
- AC-10.DEL.002.1, AC-10.DEL.002.2, AC-10.DEL.002.3 (FR-10.DEL.002 — deterministic vs human-confirmed; recall)
- AC-10.DEL.003.1, AC-10.DEL.003.2, AC-10.DEL.003.3, AC-10.DEL.003.4 (FR-10.DEL.003 — id-removal / hard-delete via C2 / no residue / verify-before-done)
- AC-10.DEL.004.1, AC-10.DEL.004.2, AC-10.DEL.004.3 (FR-10.DEL.004 — `[REDACTED]` + context / via sole-writer / C7 log tombstone trigger)
- AC-10.DEL.005.1, AC-10.DEL.005.2, AC-10.DEL.005.3 (FR-10.DEL.005 — immutable audit / retained-past-data / fail-closed audit write)
- AC-10.DEL.006.1, AC-10.DEL.006.2, AC-10.DEL.006.3, AC-10.DEL.006.4 (FR-10.DEL.006 — connector flag / two-person distinct / flag-escalates / gates fail-closed)
- AC-10.DEL.007.1 (FR-10.DEL.007 — frozen-deployment erasure blocked + surfaced)
- AC-NFR-CMP.005.1, AC-NFR-CMP.005.3 (two-class identification; verify-complete-before-"done" audit — the C10 workflow legs; AC-NFR-CMP.005.2's C2-cascade leg is ISSUE-029)
- AC-NFR-SEC.015.1, AC-NFR-SEC.015.2 (DB CHECK rejects self-execution; three distinct non-null identities at `executed`)
- AC-NFR-SEC.016.1 (reason/legal-basis captured to `access_audit`)
- **Gating spikes (if any):** none of the six OD-157 launch-gating spikes (ISSUE-001–006) gate this issue. Two **build-time** AFs attach as DoD notes (`test-strategy.md`): **AF-134** (erasure recall / name-identifier matching — FR-10.DEL.002's probabilistic sweep) must be GREEN as an EVAL before this ships; **AF-137** (transitive-erasure completeness verification) is proven on the **ISSUE-029** C2 leg and consumed here at the AC-10.DEL.003.4 verify-before-done gate — the C10 "done" audit must not be reachable until the C2 return is verified complete. **AF-136** (jurisdiction-specific lawful minimums) is legal-review-gated (FR-10.LEG.001), not a build blocker for this workflow.

## 5. Touches (complete blast radius, by ID)
- **DATA:** DATA-deletion_requests (queue + the `requester_id` / `authorized_by` / `second_authoriser_id` / `executor_id` / `legal_basis` / `status` fields + the executor-distinctness CHECKs — schema §14), DATA-connector_deletion_flags (per-system tracked-until-acknowledged flag — schema §14), DATA-access_audit (the immutable deletion audit record — schema §2), reads DATA-deployment_settings.frozen_at (local freeze read — schema §14); reads across DATA-memories / DATA-entities for Step-1 identification and **invokes** the C2 sole-writer for the id-removal / hard-delete / scrub (schema §3, mechanism ISSUE-029).
- **PERM:** PERM-memory.delete (Admin / Super Admin; homed in C1 / ISSUE-018 permission matrix — consumed here); the two-person gate requires two *distinct* PERM-memory.delete holders for Restricted/Personal.
- **CFG:** CFG-individual_deletion_audit_years (audit retention floor), CFG-deletion_two_person_auth_required (toggles the two-person gate), an erasure-request escalation window (config — FR-10.DEL.001). Retention-value *config* + legal-minimum validation is ISSUE-084; consumed here.
- **UI:** none built here — the deletion queue, affected-records / redaction confirmation, connector-deletion checklist + two-person confirm are Phase 3 (state contract owned here).
- **Connectors:** none deleted directly — the harness raises a per-system `connector_deletion_flags` reminder (GHL / Google / Slack) and never deletes from a system of record (manual Admin action per system).

## 6. Context manifest (the EXACT files to open — nothing more)
- spec/01-requirements/component-10-infra-compliance.md — FR-10.DEL.001–007 (statements, behaviour branches, ACs) + the C10 Context manifest + the DEL/OFF seam table (what C10 owns vs calls).
- spec/01-requirements/component-02-memory.md — FR-2.MNT.017 + AC-2.MNT.017.1–.5 (the C2 transitive-delete mechanism this workflow *invokes* and whose completeness return AC-10.DEL.003.4 verifies).
- spec/04-data-model/schema.md §14 (Compliance workflow) — `deletion_requests` (two-person distinctness CHECKs) + `connector_deletion_flags` + `deployment_settings`; §2 (RBAC & Access) — `access_audit` + the `t_append_only` immutability trigger; §3 (Memory) — `memories` / `entities` (`entity_ids[]`) for Step-1 identification.
- spec/05-non-functional/compliance.md — NFR-CMP.005 (two-class ID / transitive delete / verify-before-done) + NFR-CMP.007 (redaction-tombstone).
- spec/05-non-functional/security.md — NFR-SEC.015 (two-person authorization for sensitive deletion) + NFR-SEC.016 (reason-capture on sensitive mutations).
- spec/00-foundations/feasibility-register.md — AF-134, AF-136, AF-137 (the build-time AFs attached to this workflow).

## 7. Dependencies
- **Blocked-by:** ISSUE-029 (C2 memory-side transitive-delete mechanism — this workflow *calls* it via FR-10.DEL.003 and verifies its completeness return at AC-10.DEL.003.4; not a spike), ISSUE-021 (user management lifecycle + RBAC audit — the requester / authoriser / second-authoriser / executor identities the two-person gate resolves against, and `PERM-memory.delete` holders; not a spike).
- **Blocks:** none (leaf).

## 8. Build order within the slice
1. **Migration (schema §14):** confirm `deletion_requests` (with the `is distinct from` executor/authoriser/second-authoriser CHECKs + the `status='executed'` all-three-non-null CHECK) and `connector_deletion_flags` are present (Phase-4 consolidated); this slice consumes the DDL, it does not redefine it.
2. **Request queue + RBAC + escalation** (FR-10.DEL.001): intake writes requester + legal-basis + target; gate authorise/execute on `PERM-memory.delete`; wire the un-actioned-past-window **escalation** to the alert path (never silent expiry); record request lifecycle to `event_log`.
3. **Frozen-deployment precondition** (FR-10.DEL.007): before execution, local-read `deployment_settings.frozen_at`; block + surface on an `offboarding`/`frozen` deployment (route through the offboarding delete path, not ad-hoc).
4. **Step 1 — identify** (FR-10.DEL.002 → AF-134): enumerate the deterministic set (`entity_ids[]` matches + entity record); run the recall-oriented probabilistic sweep (identifiers + name variants) over `content`; **queue class (b) for human confirmation**, never auto-action; record per-class counts.
5. **Two-person auth gate** (FR-10.DEL.006 → NFR-SEC.015): for a Restricted/Personal erasure with `CFG-deletion_two_person_auth_required`, require a second *distinct* Admin/Super-Admin (rely on the DB CHECK; fail closed on an unresolvable config read).
6. **Steps 2–3 — id-removal + hard-delete + entity delete** (FR-10.DEL.003): apply the array-removal / empty-test policy; **invoke the ISSUE-029 C2 transitive delete** (FR-2.MNT.017) for empty-array / entity-record hard-deletes through the sole-writer; retain + audit-note multi-entity rows.
7. **Step 4 — content scrubbing** (FR-10.DEL.004): on human confirmation, `[REDACTED]` the confirmed personal mentions in retained rows via the C2 sole-writer; a log-sink presence **triggers** the C7 redaction-tombstone (through C2 AC-2.MNT.017.4).
8. **Connector flag** (FR-10.DEL.006(a)): raise per-system `connector_deletion_flags` (tracked-until-acknowledged); escalate an un-acknowledged flag; fail-closed / block if connector-presence detection itself errors.
9. **Verify-before-done + Step-5 audit** (AC-10.DEL.003.4 → FR-10.DEL.005): **verify** the C2 erasure (incl. the C7 log redaction) reported complete; only then write the **immutable** `access_audit` deletion record (the three disposition counts, retained `CFG-individual_deletion_audit_years`); a partial/failed/indeterminate C2 return **holds the request + escalates** — and a failure to write the audit itself fails the erasure closed.
10. **Test to each AC** in field 4 (see Verification).

## 9. Verification (how DoD is proven)
- **DB layer** (per spec/05-non-functional/test-strategy.md): the `deletion_requests` distinctness CHECK rejects self-execution and guarantees three distinct non-null identities at `status='executed'` — AC-NFR-SEC.015.1/.2, AC-10.DEL.006.2; the `access_audit` `t_append_only` trigger proves the deletion record is immutable — AC-10.DEL.005.1.
- **Integration (identification):** a seeded target's deterministic `entity_ids[]` set is enumerated exactly and its name-in-content matches are surfaced-for-confirmation (never auto-actioned) — AC-10.DEL.002.1/.2, AC-NFR-CMP.005.1; the recall-oriented sweep + AF-134 EVAL acknowledges the un-found risk — AC-10.DEL.002.3.
- **Integration (erasure legs):** empty-array rows transitively hard-delete via the invoked C2 mechanism with no residue and the entity record is deleted through the sole-writer — AC-10.DEL.003.1/.2/.3 (delegates to ISSUE-029 AC-2.MNT.017.3); retained multi-entity rows are `[REDACTED]` + context preserved via the sole-writer, and a log-sink presence fires the C7 tombstone — AC-10.DEL.004.1/.2/.3, AC-NFR-CMP.007 (trigger side).
- **Integration (verify-before-done):** an injected partial/failed/indeterminate C2 return **blocks** the "done" audit, holds the request, and escalates — AC-10.DEL.003.4, AC-NFR-CMP.005.3; a forced audit-write failure fails the erasure closed — AC-10.DEL.005.3. The C2-side completeness itself is proven by **AF-137** on ISSUE-029 and consumed at this gate.
- **Integration (workflow gates):** an un-actioned request escalates on timeout — AC-10.DEL.001.2; a non-Admin/Super-Admin is RBAC-rejected — AC-10.DEL.001.3; a connector-present target raises a tracked flag that escalates un-acknowledged — AC-10.DEL.006.1/.3; an unresolvable two-person-config / connector-detection error fails closed — AC-10.DEL.006.4; a frozen-deployment erasure is blocked + surfaced — AC-10.DEL.007.1; the legal-basis reason is captured to `access_audit` — AC-NFR-SEC.016.1; the audit record survives the erased data for the retention floor — AC-10.DEL.005.2.
- **Build-time AF gate:** AF-134 (recall EVAL) GREEN before ship; AF-137 GREEN on ISSUE-029 is a precondition to the AC-10.DEL.003.4 verify-before-done path closing to `Verified`.
