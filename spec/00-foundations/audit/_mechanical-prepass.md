# Mechanical pre-pass — whole-spec ID-integrity audit

**Purpose:** mechanical (grep-driven) pre-pass ahead of a full ID-integrity audit. For each ID
type this hunts every ID *referenced* somewhere in the repo that cannot be confirmed *defined*
in its home location. **This is a candidate list, not a verdict** — every row below still needs
a downstream triage pass (some are self-documented non-issues, some are illustrative examples in
`id-conventions.md`, some are real gaps). Where the source material itself already explains a
candidate (e.g. "no node minted, clean case"), that context is noted so triage isn't repeated.

**Date:** 2026-07-01. **Method:** `grep -rn` / `comm -23` diffs between a "defined" set (extracted
from each home file's actual heading/label/table-row grammar — verified by hand per ID type,
because the grammar differs file to file) and a "referenced anywhere" set (`spec/`, `README.md`,
`traceability-matrix.csv`, `PERMISSION_NODES.md`, `ACRONYMS.md`). Intermediate files live in the
sandbox scratchpad (not committed).

**Headline finding:** the great majority of dangling references cluster in **`traceability-matrix.csv`**
— its `config_deps` (CFG-) and `surfaces` (UI-) columns are, in large stretches (components 4–10),
populated with informal/lowercase/underscore slugs (`UI-fleet_map`, `UI-cost-tracking`, `CFG-rate_limits`,
`CFG-cost_price_table`...) that were evidently written **before** the Phase-2 config registry and
Phase-3 surface-ID minting passes locked down canonical names, and were **never reconciled** afterward.
The CSV's own header note only claims `DATA-*` was reconciled in the Phase-4 pass ("every `DATA-*` id
in the `data_touched` column is now consolidated + typed in `schema.md`") — no equivalent claim exists
for `CFG-`/`UI-`, and the mechanical scan confirms that gap is real, not just unclaimed.

---

## 1. FR-*

**Home:** `spec/01-requirements/component-*.md`, defined either as a `### FR-x.y.zzz — title`
heading (components 0,1,2,3,6,7,8,9,10) or a `**FR-x.y.zzz — title**` bold in-line label
(components 4,5). Both forms counted as "defined."

**Definitions found:** 438 distinct FR-IDs.

| ID | referencedIn | definedIn / MISSING |
|---|---|---|
| `FR-0.WHK.009` | `spec/02-config/_HARVEST.md:55` (Source column for `webhook.failure_alert_threshold`) | MISSING — component-00 WHK area stops at `FR-0.WHK.008` |
| `FR-2.RST.003` | `spec/01-requirements/component-08-agent-design.md:26`, `spec/SESSION-LOG.md:1567` | MISSING, but **self-documented as already fixed** — both citing occurrences are the verification-gate note that says this dead citation was *found and corrected* to `FR-2.RET.006`/`C1 FR-1.RST.003`. Low priority — the string only survives as a historical note. |
| `FR-2.MEM.014` | `spec/00-foundations/id-conventions.md:11` | MISSING — this is the **illustrative example** in the ID-format table, not a real citation. Almost certainly a non-issue, flagged for completeness. |
| `FR-3.OBS.005` | `spec/02-config/_HARVEST.md:106` (Source column for `drive_full_corpus_ingest`) | MISSING — component-03 OBS area stops at `FR-3.OBS.004` |

---

## 2. AC-*

**Home:** `spec/01-requirements/component-*.md`, defined as a list-item bullet starting with the
AC id (bold in some files, plain in others — grammar varies per file, not per convention).

**Definitions found:** 808 distinct AC-IDs.

| ID | referencedIn | definedIn / MISSING |
|---|---|---|
| `AC-2.MEM.014.2` | `spec/00-foundations/id-conventions.md:17` | MISSING — again the **illustrative example** in the ID-format table (pairs with the `FR-2.MEM.014` example above; the two examples were invented together and neither exists as a real FR/AC). Non-issue. |

AC-* is otherwise fully clean once both label grammars (bold and plain) are accounted for — an
earlier naive pass (bold-only regex) produced 614 false positives, all resolved once the plain-bullet
form used by components 0/1/10 etc. was included. Worth downstream awareness only as a documentation-consistency
note (two label grammars for the same ID type across files), not a dangling-ID finding.

---

## 3. CFG- / config keys

**Home:** `spec/02-config/config-registry.md` (bare backticked `dotted.key` or `snake_case` names,
**never** a literal `CFG-` prefix — confirmed: zero literal `CFG-` tokens exist in that file).

**Definitions found:** ~117 scalar knobs + 9 structured objects + 11 secrets per the file's own
header count; mechanically counted ≈137 distinct backticked key rows.

### 3a. Literal `CFG-` tokens (repo-wide)

Most literal `CFG-` tokens live in two places: (i) a "Parked cross-phase stubs" scratch table at
the bottom of `component-00-login.md` (pre-Phase-2 harvest notes, all of which *do* resolve to real
`config-registry.md` rows once the `CFG-` prefix is stripped), and (ii) `traceability-matrix.csv`'s
`config_deps` column (see headline finding — many of these do **not** resolve).

| ID / key (CFG- stripped) | referencedIn | definedIn / MISSING |
|---|---|---|
| `CFG-GHL-RATE-BURST`, `CFG-GHL-RATE-DAILY`, `CFG-GHL-ACCESS-TTL`, `CFG-GHL-REFRESH-TTL`, `CFG-GHL-VERSION-HEADER`, `CFG-GHL-SCOPES`, `CFG-GHL-WEBHOOK-PUBKEY`, `CFG-GHL-REVERIFY` | `spec/00-foundations/tool-integrations/gohighlevel.md:248-252` ("Config keys this implies (Phase 2)") | MISSING as named — `config-registry.md` only has `GOHIGHLEVEL_WEBHOOK_SECRET` and the generic `rate_max_calls_per_connector_window`; none of these 8 dossier-proposed keys were individually transcribed into the Phase-2 registry. |
| `parallel_execution` | `spec/01-requirements/component-08-agent-design.md:290` (`CFG-chain_depth_limit, CFG-parallel_execution`); also `traceability-matrix.csv:267` | MISSING as named — registry has `parallel_execution_enabled` (a different, longer key). Naming-drift candidate. |
| `rank_weight_recency` / `.confidence` / `.entity_match` / `.vector_similarity` | `spec/01-requirements/component-02-memory.md:786` ("Config dependencies: `CFG-rank_weight_recency/confidence/entity_match/vector_similarity`") | MISSING as four separate keys — registry models this as one structured object `ranking_weights` (sub-keys recency/confidence/entity_match/vector_similarity live *inside* it, not as top-level keys). Naming/shape-drift candidate. |
| `memory_writes_per_minute` (bare, no CFG- prefix) | `spec/01-requirements/component-02-memory.md:511,515,649` | MISSING as named — registry key is `rate_limit_memory_writes_per_minute`. Same default (30) so almost certainly the same knob under a different name; genuine drift, not a false alarm. |
| `mobile` (`CFG-mobile push (L1026–1030)`) | `spec/01-requirements/component-09-proactive.md:594` | MISSING / malformed — reads like a truncated or mis-typed config reference, not a real key name. Worth a human look; likely should cite a specific mobile-push key or be replaced with "N/A — delivery handled by C7." |
| `CFG-memory.amber_zone_threshold` | `spec/00-foundations/id-conventions.md:13` | MISSING as a *component-prefixed* key — the ID-format example uses the documented `CFG-<dotted.key.name>` grammar, but the real registry key is the flat `amber_zone_threshold` (no `memory.` component prefix). Doc-grammar-vs-practice mismatch; the convention as written in `id-conventions.md` is not actually followed anywhere in practice (no config key in the registry uses a component-name prefix). |

### 3b. Traceability-matrix.csv `config_deps` column (bareword sample, task 3b)

Sampled 138 distinct `CFG-`-tagged tokens from `traceability-matrix.csv`'s `config_deps` column
(components 4–10 mostly); **35 do not resolve** to any `config-registry.md` row even after prefix
stripping. Representative sample (full list of 35 in the scratch working file):

| Key | referencedIn | definedIn / MISSING |
|---|---|---|
| `rate_limits` | `traceability-matrix.csv:286` | MISSING (registry has specific keys like `rate_max_calls_per_connector_window`, not a generic `rate_limits`) |
| `cost_price_table` | `traceability-matrix.csv:326` | MISSING |
| `cost_hard_ceiling_daily_usd` / `cost_throttle_daily_usd` / `cost_alert_daily_usd` | `traceability-matrix.csv:328-329` | MISSING — registry's cost-ladder keys use different names (e.g. `cost_ladder_hard_kill_threshold`) |
| `approval_rules` / `approval_routing_rules` / `approval_tier_policy` / `approval_timeout` / `soft_approval_delay` | `traceability-matrix.csv:237,261,275,277,279` | MISSING |
| `mobile_push` / `mobile_push_frequency` | `traceability-matrix.csv:337,391` | MISSING |
| `injection_semantic_detection` | `traceability-matrix.csv:295` | MISSING (registry has `injection_semantic_threshold`, a related but differently-named key — likely the same knob, unreconciled) |
| `business_context` / `business_context.dynamic_fields` | `traceability-matrix.csv:206` | MISSING |
| `event_log_retention` / `guardrail_log_retention` / `retention` | `traceability-matrix.csv:311,312,406` | MISSING |
| `loop_cadences` / `poll_intervals` / `smart_scheduling` / `triggers` / `task_priority` | `traceability-matrix.csv:246,314,268,228,236` | MISSING |

**Assessment:** this cluster reads as **pre-Phase-2 placeholder shorthand** in the CSV's
`config_deps` column that was never revisited once `config-registry.md` finalized canonical
key names (unlike `data_touched`, which the Phase-4 header note explicitly confirms *was*
reconciled). Recommend the downstream pass treat this as one systemic finding (reconcile the whole
column) rather than 35 independent bugs.

### 3c. Prefix-dropped bareword references (component/surface files, task 3b)

A handful of bare (non-`auth.`-prefixed) references to keys that are only defined dotted:
`account_lockout_threshold` (component-00-login.md:261), `mfa_softlock_minutes` /
`mfa_softlock_threshold` (surface-00-auth.md:199), `two_factor_required` (component-00/01, multiple)
— all defined in the registry as `auth.account_lockout_threshold`, `auth.mfa_softlock_*`,
`auth.two_factor_required`. Low-severity / likely fine as informal shorthand within prose, but
listed for downstream awareness since a strict-match triage would flag them. Also
`full_threshold` (component-02-memory.md:1319, body prose) vs. the `Config dependencies:` line
two lines below that correctly cites `CFG-cold_start_full_threshold` — internal same-file
shorthand inconsistency, trivially resolvable, not flagged as a candidate row.

---

## 4. DATA-*

**Home:** `spec/04-data-model/schema.md`, tables defined via `create table <name> (` SQL blocks
(no literal `DATA-` prefix). 47 tables defined.

31 distinct `DATA-*` refs found across `spec/01-requirements/`, `spec/03-surfaces/`, and
`traceability-matrix.csv`.

| ID | referencedIn | definedIn / MISSING |
|---|---|---|
| `DATA-credentials` (+ `.scopes`, `.slack_signing_secret`) | ~15 occurrences across `spec/01-requirements/component-00-login.md` and `component-03-tool-layer.md` (e.g. `component-03-tool-layer.md:495`), plus `traceability-matrix.csv:495-ish` | MISSING as a single table — schema.md splits this (per **OD-P4-02**) into two distinct tables: `connector_credentials` (C3 OAuth tokens) and `webhook_secrets` (C0 webhook-verification secrets). `component-00-login.md:1032` itself acknowledges the split in prose ("`DATA-credentials`... — read by WHK; broader connector creds are C3") but the requirement files still cite the pre-split umbrella name throughout. `.slack_signing_secret` doesn't exist as a column anywhere either — `webhook_secrets` uses generic `secret_kind`/`secret_value` columns instead. Highest-volume DATA- finding — likely worth a real reconciliation pass, not a one-line fix. |
| `DATA-invite_tokens` | `component-00-login.md:491,1036` | MISSING, but **self-documented as intentionally absent** — both occurrences explicitly say "no custom `DATA-invite_tokens` table — dropped per OD-014." Non-issue; the reference exists only to record that the table was *not* built. |
| `DATA-memories.entity_type` | `spec/01-requirements/component-01-rbac.md:424` | MISSING field — the `memories` table has `entity_ids` (plural, array), not a singular `entity_type` column. Genuine field-level mismatch. |
| `DATA-context_envelope` | `traceability-matrix.csv` (C5 rows, e.g. around line 261-270) | MISSING table — no `context_envelope` table in schema.md; likely modelled as a jsonb column inside `execution_plans` or `task_queue`, never given its own `DATA-` citation reconciliation. |
| `DATA-dynamic_field_store` | `traceability-matrix.csv` (C4 rows) | MISSING as named — schema.md's actual table is `dynamic_field_values`, a different name. |

All other DATA- refs (`entities`, `ingestion_queue`, `memories.*` other fields, `prompt_layers`,
`rate_limit_tracker`, `restricted_grants`, `role_permissions`, `roles`, `sensitivity_clearances.*`,
`support_requests.*`, `tools.*`, `user_roles`, `webhook_replay_cache`, `access_audit`) resolve
cleanly to a table + field in `schema.md`.

---

## 5. PERM-*

**Home:** `/home/user/AI-Harness-V1.0/PERMISSION_NODES.md`, table rows `| \`PERM-x.y\` | ... |`.

**Definitions found:** 52 table rows (the file's own running header count claims "51 catalogued"
as of the last transcription — off by one against a strict mechanical row count, immaterial to this
audit).

| ID | referencedIn | definedIn / MISSING |
|---|---|---|
| `PERM-audit.view` | `spec/04-data-model/rls-policies.md:51` (gate for `access_audit` table reads) | MISSING — no `PERM-audit.*` family exists in the catalog at all. |
| `PERM-clearance.grant` / `PERM-clearance.view` | `spec/04-data-model/rls-policies.md:49-50` | MISSING — catalog has no `PERM-clearance.*` family; the closest catalogued node is `PERM-user.grant_clearance`. `rls-policies.md` appears to have invented its own family name independent of the catalog. |
| `PERM-restricted.grant` | `spec/04-data-model/rls-policies.md:50` | MISSING — catalog has `PERM-user.grant_restricted` instead (different family prefix, same apparent intent). |
| `PERM-user.manage` | `spec/04-data-model/rls-policies.md:43,48` | MISSING — catalog only has more granular nodes (`PERM-user.assign_role`, `.deactivate`, `.reset_2fa`, `.grant_clearance`, `.grant_restricted`, `.invite`, `.view_activity`); no single coarse `.manage` node. |
| `PERM-user.view` | `spec/04-data-model/rls-policies.md:43,48` | MISSING — catalog has `.view_activity` but not a bare `.view`. |
| `PERM-agent.edit_capability` | `spec/SESSION-LOG.md:1597`, `spec/00-foundations/open-decisions.md:1221` | MISSING under this exact spelling — catalog has `PERM-agents.edit_capability` (**plural** "agents"). Likely the same node, singular/plural drift between the OD note and the eventual catalog entry. |
| `PERM-agent.edit_routing` | `spec/SESSION-LOG.md:1598`, `spec/00-foundations/open-decisions.md:1222` | MISSING entirely — this node was never minted; OD-137's actual resolution created a different 3-node split (`PERM-agents.view` / `.edit_description` / `.edit_capability`), with no separate "routing" node. |
| `PERM-guardrail.hard_limit` | `traceability-matrix.csv:271` (FR-6.HRD.001) | MISSING — not in catalog. |
| `PERM-guardrail.approve_restricted` | `traceability-matrix.csv:276` (FR-6.APR.002) | MISSING — not in catalog (closest is the differently-scoped `PERM-guardrail.edit_autonomy`). |
| `PERM-approval.action` | `traceability-matrix.csv:319` (FR-7.ALR.003) | MISSING — not in catalog. |

**Self-documented non-issues (low priority, included for completeness):**
- `PERM-memory.browse` / `PERM-memory.view` — `surface-11-memory-nav.md:110,419` and OD-145 explicitly
  resolve "no new node — entry is any authenticated user, clearance-scoped at the row level." The
  reference exists only to record the decision *not* to mint it.
- `PERM-config.view_audit` — OD-155 explicitly resolves "no node minted (a clean case)."
- `PERM-dashboard.view` (bare) / `PERM-fleet.admin` / `PERM-agents.manage` — each appears only as a
  **rejected alternative-option label** inside an OD's reasoning table (OD-129, OD-125, OD-137
  respectively), never as a real citation elsewhere.

---

## 6. UI-*

**Home:** `spec/03-surfaces/*.md`, minted via the `# Surface: UI-XXX (surface-NN) — ...` heading or
an explicit `**Surface ID:**` line; cross-checked against `open-decisions.md` (no OD independently
mints a UI- id that isn't also in a surface file).

**Definitions found:** 32 distinct minted surface IDs.

| ID | referencedIn | definedIn / MISSING |
|---|---|---|
| `UI-CONFIG-AUTH` | `component-00-login.md:123,1028`, `system-map/00-login.md:98`, `phase-playbooks.md:182,184`, `traceability-matrix.csv:8` (FR-0.AUTH.003 surfaces column) | MISSING — **self-documented as an orphan** in `spec/SESSION-LOG.md:1213` ("`UI-CONFIG-AUTH` orphan + `surface-01b` listed-not-built — NOTED in the playbook"). The intent was folded into `UI-config-admin#auth`, but the literal `UI-CONFIG-AUTH` id was never minted as its own surface heading and is still cited directly (not via the fold-in) in several places, including a live traceability-matrix row. Genuine, already-tracked, still-open gap — good candidate for the real triage pass to actually close. |
| `UI-OPS-MEM-03` | `spec/00-foundations/id-conventions.md:14` | MISSING — the illustrative example in the ID-format table. Non-issue. |

### 6a. `traceability-matrix.csv` `surfaces` column (headline finding)

54 additional lowercase/underscore/hyphen `UI-` slugs appear only in the CSV's `surfaces` column
(components 4–10) and match no minted surface ID: `UI-approval-queue` / `UI-approval_queue`,
`UI-audit_log`, `UI-autonomy_matrix`, `UI-briefing`, `UI-build_status`, `UI-canary_status`,
`UI-cicd_status`, `UI-clarification`, `UI-cold_start_banner`, `UI-command_menu`,
`UI-compliance_record`, `UI-config`, `UI-confirm`, `UI-connector_checklist`, `UI-cost` /
`UI-cost-tracking`, `UI-dead-letter-queue`, `UI-deletion_queue`, `UI-deletion_step`,
`UI-dynamic-field-editor`, `UI-failure-health`, `UI-fleet_map`, `UI-fleet_view`,
`UI-guardrail-log`, `UI-init_progress`, `UI-manager`, `UI-migration_alert`, `UI-migration_status`,
`UI-mobile`, `UI-notification-centre`, `UI-offboarding_state`, `UI-offboarding_wizard`,
`UI-ops-dashboard`, `UI-ops-event-log`, `UI-pill`, `UI-plan-history`, `UI-plugin_drift`,
`UI-principles-editor`, `UI-prompt-editor`, `UI-prompt-health`, `UI-region_view`,
`UI-registry-editor`, `UI-relationship_health`, `UI-release_status`, `UI-self-improvement`,
`UI-state_conflict`, `UI-suggestion`, `UI-super-admin`, `UI-user`, `UI-verification-queue`,
`UI-version-history`, `UI-version_grid` (line numbers: `traceability-matrix.csv`, see the FR row for
each, e.g. `UI-fleet_map` → line 426, `UI-cost-tracking` → line 309, `UI-approval-queue` → line 237).

**Assessment:** same pattern as the CFG- finding in §3b — these read as pre-Phase-3 informal widget/
panel names typed into the `surfaces` column before the 12 formal surfaces (`UI-DASHBOARD-OPS`,
`UI-AGENT-BUILDER`, `UI-COMMANDS`, etc.) were minted with their final IDs, and never reconciled
afterward. Some clearly correspond to a panel *within* an already-minted surface (e.g.
`UI-approval-queue` almost certainly means `UI-APPROVAL-QUEUE`, `UI-fleet_map` a panel inside
`UI-DASHBOARD-SUPER-ADMIN`), but the CSV never got the casing/reconciliation pass `data_touched`
received in Phase 4. Recommend treating as one systemic finding for the real audit rather than 54
independent rows.

---

## 7. OD-*

**Home:** `spec/00-foundations/open-decisions.md`, `## OD-NNN` single headers or `- **OD-NNN**`
bold sub-items inside grouped range headers (`## OD-105…OD-108`, etc.).

**Definitions found:** 154 distinct OD-IDs with prose in `open-decisions.md` (OD-001…OD-160,
with gaps where retired, per the "numbers are never renumbered" rule).

| ID | referencedIn | definedIn / MISSING |
|---|---|---|
| `OD-098`…`OD-103` | Referenced throughout `spec/03-surfaces/surface-01-config-admin.md` (e.g. lines 53,57,63,65,67,591-596) and named in `open-decisions.md`'s own "Reserved" footnote (~line 1947) | **Not detailed in `open-decisions.md`** — unlike every other surface-local OD range (105-160), which gets a short bold summary directly in `open-decisions.md` *in addition to* full detail in the surface file, OD-098–103 are only **reserved** (numbers claimed, no prose) in `open-decisions.md`; their only real definition lives entirely in `surface-01-config-admin.md`'s own resolution table. This is an internal inconsistency in how the "surface-local OD" pattern was applied — worth a downstream look at whether `open-decisions.md` should get the same one-line summaries OD-105+ received, purely for the Rule-0 "repo alone must be enough" self-sufficiency test. Likely low severity (the decisions *are* written down, just not in the nominal home file) but flagged since it breaks the strict single-home-file rule for this ID type. |

`OD-161` only appears as `open-decisions.md`'s own "Next OD number" pointer — not a real dangling
reference, excluded.

---

## 8. AF-*

**Home:** `spec/00-foundations/feasibility-register.md` — two definition grammars: `| AF-NNN | ... |`
table rows (blocks A–D, J) and `**AF-NNN — title** (METHOD, timing).` bold in-line labels (blocks
K onward, incl. component-specific blocks O–T and C10).

**Definitions found:** 107 distinct AF-IDs (AF-001…AF-138, with a documented "Next AF number:
AF-139" pointer confirming 138 is the last assigned).

**No dangling AF-* references found.** `AF-139` appears exactly once, as the register's own
"next number" pointer — not a real citation anywhere else. AF-* is fully clean once both label
grammars are accounted for (a naive table-only regex first produced 29 false positives, AF-111
through AF-139, all resolved by including the bold-label grammar used from block O onward).

---

## 9. OOS-*

**Home:** `spec/00-foundations/out-of-scope.md`, `| OOS-NNN | ... |` table rows.

**Definitions found:** 41 distinct OOS-IDs (OOS-001…OOS-041).

**No dangling OOS-* references found.** `OOS-042` appears exactly once, as the register's own
"Next OOS number" pointer — not a real citation. Fully clean.

---

## 10. ADR-*

**Home:** `spec/00-foundations/adr/ADR-NNN-*.md`, filenames and `# ADR-NNN — Title` headers.

**Definitions found:** 8 (ADR-001…ADR-008).

**No dangling ADR-* references found anywhere in the repo.** Fully clean — every ADR-NNN cited
resolves to one of the 8 files.

---

## 11. NFR-*

**Home:** `spec/05-non-functional/*.md`, `### NFR-<DOMAIN>.<nnn> — title` headings (8 domain files:
security, infrastructure, performance, observability, cost, compliance, backup-dr, test-strategy;
`_nfr-inventory.md` is a pre-drafting harvest ledger, not itself a definition source, but was
included in the scan for completeness).

**Definitions found:** 90 distinct NFR-IDs, matching the repo's own "~90 NFR-* rows" claim in
`traceability-matrix.csv`'s Phase-5 header note.

**No dangling NFR-* references found anywhere in the repo** (including `traceability-matrix.csv`).
Fully clean — every NFR-<DOMAIN>.<nnn> cited resolves to a heading in `spec/05-non-functional/`.

---

## Summary table

| ID type | Definitions found (home) | Dangling candidates | Notes |
|---|---|---|---|
| FR- | 438 | 4 | 2 are `_HARVEST.md`-only pre-Phase-2 citations past the last real FR in their area; 1 is a self-documented already-fixed dead citation; 1 is the id-conventions.md example |
| AC- | 808 | 1 | the id-conventions.md example only |
| CFG- (config keys) | ~137 rows | ~45 (8 GHL dossier keys + `parallel_execution` + 4 `rank_weight_*` + `memory_writes_per_minute` + `mobile` + 35 traceability-matrix.csv-only) | dominated by one systemic traceability-matrix.csv reconciliation gap (§3b) |
| DATA- | 47 tables | 5 clusters (`DATA-credentials` family ×~15 refs, `DATA-invite_tokens` ×2 self-documented, `DATA-memories.entity_type`, `DATA-context_envelope`, `DATA-dynamic_field_store`) | `DATA-credentials` is the highest-volume real finding in this type |
| PERM- | 52 rows | 10 confirmed + 4 self-documented non-issues | `rls-policies.md` appears to use its own informal PERM- family names independent of the catalog in several spots |
| UI- | 32 surfaces | 2 (1 self-documented known orphan, 1 example) + 54 traceability-matrix.csv-only slugs | second half of the systemic traceability-matrix.csv reconciliation gap |
| OD- | 154 | 1 cluster (OD-098–103, surface-local-only, inconsistent with the pattern used for every later surface-local range) | |
| AF- | 107 | 0 | clean |
| OOS- | 41 | 0 | clean |
| ADR- | 8 | 0 | clean |
| NFR- | 90 | 0 | clean |

**Overall read:** the formal spec body (`spec/01-requirements/`, `spec/03-surfaces/`,
`spec/04-data-model/`, `spec/05-non-functional/`, the `spec/00-foundations/` registers) is in very
good shape — most "dangling" hits are either illustrative examples in `id-conventions.md` or
self-documented decisions-not-to-mint. The two real clusters worth a human triage pass are:
(1) **`traceability-matrix.csv`'s `config_deps`/`surfaces` columns**, which were never reconciled
to the Phase-2/Phase-3 canonical names the way `data_touched` explicitly was in Phase 4; and
(2) **the `DATA-credentials` / `PERM-` family-naming drift** between `rls-policies.md` (and a few
component files) and the tables/nodes actually built in `schema.md`/`PERMISSION_NODES.md`.
