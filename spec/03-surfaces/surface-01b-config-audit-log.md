# Surface: UI-config-audit-log (surface-01b) — Config-Change Audit Log Viewer

**Status:** 🟢 **Drafted + gate-clean 2026-07-01** — OD-153–156 raised + resolved surface-local (recommendations
delegated). The **fourteenth and final Phase-3 surface** — after it, Phase 3 is complete. Surface ID
**`UI-config-audit-log`** is **named by OD-099, not minted here** (surface-01's "View audit log →" links already target it;
OD-099 resolved it to a separate surface). FR source: the **config-change audit trail** — the `config_audit_log` table
that surface-01 appends to on every config save, mandated by `standards/config-edit-taxonomy.md` **rule 4** (a LIVE/BOOT/
REBUILD change *must* be audited: who / when / old→new). This is the **read/review** counterpart to surface-01: surface-01
*writes* config + appends the audit row; surface-01b *reads back* who changed which knob, from→to, when — with a
compliance export. **No PERM entry node is minted** — the viewer is scoped to the caller's existing `PERM-config.*` nodes
by key-prefix (a caller sees only the audit history of config sections they may manage, per surface-01's RLS guidance),
and export is gated by the catalogued `PERM-compliance.download_records`. Next OD: OD-157.

> **⚠️ KEY FINDING — Rule-0 governance gap closed via change-control (OD-153).** `config_audit_log` is the system's
> **third audit sink** alongside `event_log` (C7, governed by FR-7.LOG.001/006) and `guardrail_log` (C6 writes, C7 governs
> via FR-7.LOG.007) and `access_audit` (C1 content FR-1.AUD.001/002, C7 storage/retention/export via the FR-1.AUD.003
> seam). But `config_audit_log` had **no FR owner** for its *governance* (append-only, retention floor, tamper-evidence,
> export) — it existed only as a `config-edit-taxonomy.md` rule-4 *write* mandate + a surface-01 Phase-4 schema stub. A
> config audit trail that can be silently truncated, tampered, or has no compliance export is a **#1/#3 violation** (the
> record of who changed system behaviour is safety-critical). Resolved by **minting `FR-7.LOG.008` in C7 via
> change-control** — config_audit_log view / retention / tamper-evidence / export, mirroring FR-7.LOG.007's shape for
> guardrail_log (precedent: OD-097 → FR-7.ALR.009, minted into C7 from Phase 2 the same way). C7: 34 → **35 FRs**.

> **Verification gate (independent zero-context subagent, checks a–f): CLEAN — 0 HIGH · 0 MED · 2 LOW (both reconciled).**
> (a) Coverage PASS — the new FR-7.LOG.008 + its ACs, config-edit-taxonomy rule 4, surface-01's `config_audit_log`
> bindings, and `PERM-compliance.download_records` all resolve and paraphrase faithfully; no invented AC; over-claims
> correctly seamed out (config *editing* → surface-01; `event_log`/`guardrail_log`/`access_audit` are other sinks, not
> rendered here). (b) CFG PASS — the viewer edits no config; `event_log_retention_window` / the config-audit retention
> floor are reflected read-only. (c) DATA PASS — no `client_slug`; `config_audit_log` is the surface-01 Phase-4 stub
> (key/old_value/new_value/actor_id/changed_at), key-prefix RLS is the gate. (d) PERM PASS — no entry node minted; view =
> key-prefix-scoped `PERM-config.*`; export = `PERM-compliance.download_records` (catalogued, unseeded, default-deny);
> six roles, no role-string gates. (e) #1/#2/#3 sweep PASS — a failed load never reads as an empty history (no
> false "no changes"); the caller never sees config sections outside their `PERM-config.*` scope; secrets never appear
> (SECRET rows are not editable in-app so are never written to the log, FR-7.LOG.005); export never silently truncates.
> (f) Seams PASS. **LOW-1 (fixed):** this banner replaced its "pending" placeholder with the PASS result. **LOW-2
> (accepted):** "diff view" is surface-coined chrome for rendering `old_value`→`new_value`; legitimate Phase-3 naming.

> The **read-back window onto every change to the system's own configuration** — the surface a Super Admin (or a
> section-scoped config admin) opens to answer *who changed this knob, from what to what, and when*. It renders the
> `config_audit_log` that surface-01 appends to on every save: a **filterable timeline** of config changes (by key,
> section, actor, date range), a **change detail** view (the full old→new diff + actor + timestamp + the knob's
> LIVE/BOOT/REBUILD class), and a **compliance export** of the trail. The three non-negotiables it most directly serves:
> **#1** — the audit trail is the durable record of *who changed the system's behaviour*; it is **append-only + tamper-
> evident** (FR-7.LOG.008), so a config change can never be silently unlogged or a past entry rewritten; **#2** — the
> viewer is **scoped by `PERM-config.*` key-prefix** (a Finance-config admin sees only finance-config history, never the
> infra-config trail — the same key-prefix RLS surface-01 uses for the config itself), and **secrets never appear** (a
> SECRET row is a read-only presence indicator, never editable in-app, so it never produces a `config_audit_log` row —
> FR-7.LOG.005's no-credential-in-logs discipline holds by construction); **#3** — a failed/empty load reads "—" /
> "couldn't load audit history", **never an empty timeline implying no changes were ever made** (a false-empty audit view
> is the most dangerous kind — it reads "nothing to see" when the truth may be "the record is unreachable"), and a
> compliance export **returns every row in range or fails loudly — never a silent partial** (AC-7.LOG.008.1). It does
> **not** edit config (surface-01), render the operational `event_log` (surface-05), the `guardrail_log` (surface-05), or
> the RBAC/`access_audit` trail (C7 audit views) — those are distinct sinks with their own surfaces.

---

## Context manifest

- **Surface ID:** **`UI-config-audit-log`** — **named by OD-099** ("Separate `UI-config-audit-log` surface — linked from
  each section's 'View audit log →'. Added to Phase 3 surface list."), **not minted here** (like `UI-COMMANDS` on
  surface-10). The operator's planning-doc "config history / change log" concept maps here.
- **Owned by:** **C7 (Observability)** — via the **newly-minted `FR-7.LOG.008`** (config_audit_log view / retention /
  tamper-evidence / export; change-control this session, OD-153), which parallels **FR-7.LOG.007** (the `guardrail_log`
  view/retention/tamper/export) and the **FR-1.AUD.003** seam (C1 owns audit *content*, C7 owns storage/retention/export).
  The **write** side is owned by **`standards/config-edit-taxonomy.md` rule 4** (every LIVE/BOOT/REBUILD change is audited
  who/when/old→new) + **surface-01's Save actions** (each appends to `config_audit_log`). **C1 (RBAC)** owns the
  `PERM-config.*` catalog + `PERM-compliance.download_records` (FR-1.PERM.005 / `PERMISSION_NODES.md`) and the actor
  attribution model (ADR-004). **C10 / C2** own the individual-erasure workflow the redaction-tombstone participates in
  (FR-10.DEL.004 / C2 FR-2.MNT.017 — a carry-forward this session adds `config_audit_log` to that walk for actor
  attribution).
- **FRs served:**
  - **`FR-7.LOG.008`** (**NEW — minted this session, change-control**) — **the `config_audit_log` view, retention,
    tamper-evidence, and export.** C7 owns the dashboard view + retention floor + append-only tamper-evidence + compliance
    export of the config-change audit trail (the *write* stays with config-edit-taxonomy rule 4 / surface-01, mirroring
    how C6 writes `guardrail_log` and C7 governs it, FR-7.LOG.007). The viewer renders it; export returns every row in the
    selected window with no silent truncation (AC-7.LOG.008.1); the log is append-only + tamper-evident (AC-7.LOG.008.3);
    retention honours the audit/compliance floor (AC-7.LOG.008.2); a compliance erasure of a *user* applies the
    redaction-tombstone to that user's `actor_id` attribution while retaining the change record (AC-7.LOG.008.4).
  - **`FR-7.LOG.005`** (tokens/secrets never appear in a log) — the viewer relies on this: because SECRET config rows are
    a read-only presence indicator that is **never editable in-app** (surface-01 `#secrets`, OD-102), no secret value is
    ever written to `config_audit_log`; the viewer can render `old_value`→`new_value` in the clear because they are, by
    construction, never credential material.
  - **`FR-1.PERM.005`** (`PERMISSION_NODES.md` is the source of truth) — the registry-governance context: config changes
    are gated by `PERM-config.*` per section, and the audit viewer's row-visibility mirrors those same nodes by key-prefix
    (surface-01's RLS guidance).
- **CFG dependencies** (all **read-only reflections** — the viewer *edits no config*; config is edited on **surface-01**;
  description text binds DRY to `config-registry.md`):
  - `event_log_retention_window` (BOOT; validation ≥ legal/audit floor, C10) — the audit-retention context shown on the
    viewer (the config-audit retention floor is the same audit/compliance floor, AC-7.LOG.008.2; the numeric floor is a
    C10/Phase-5 compliance input, flagged not fixed).
  - `individual_deletion_audit_years` (int years ≥ legal minimum; BOOT) — the deletion-audit retention floor context
    (surface-01 `#infra`); relevant to how long a redaction-tombstoned config-change record is retained.
- **PERM gates:** ⚠️ **OD-155 — the viewer is scoped to existing `PERM-config.*` nodes by key-prefix; no new entry node is
  minted** (a clean case, like surfaces 10/11/12). Config *editing* is already gated per section by `PERM-config.auth /
  .memory / .tools / .prompts / .loops / .guardrails / .observability / .agents / .proactive / .infra` (`PERMISSION_NODES.md`);
  the audit viewer shows a caller **only the `config_audit_log` rows whose `key` prefix is covered by a `PERM-config.*`
  node they hold** — the identical key-prefix RLS surface-01 mandates for `config_values`/`config_audit_log`
  (surface-01 §"RLS policy guidance"). Introducing a separate `PERM-config.view_audit` node would fork read authority
  away from the edit authority that produced the rows — an inconsistency; the audit history of a section is legible to
  whoever may change that section.
  - **View entry:** any holder of **≥1 `PERM-config.*` node** may open the surface; the row set is key-prefix-filtered to
    their held sections. A Super Admin (who holds all `PERM-config.*`) sees the full trail; a section-scoped admin sees
    only their section(s).
  - **`PERM-config.infra`** rows (Super Admin only, **never delegable**, surface-01 `#infra`) are visible only to a holder
    of that node — the highest-blast-radius config history stays tightest.
  - **Export:** **`PERM-compliance.download_records`** (Super Admin, **unseeded** — default-deny per OD-030 until seeded)
    gates the compliance export action; the export is itself key-prefix-scoped to the exporter's held config sections
    (a section-scoped admin cannot export sections they can't view). All nodes default-deny (FR-1.PERM.002 / OD-030).
- **DATA bindings** (Phase-4 stubs; **intra-client — no `client_slug` on any binding** per OD-096 / FR-10.ISO.001;
  reads are RLS key-prefix-scoped by the caller's `PERM-config.*` set per surface-01's RLS guidance; ADR-006):
  - **`config_audit_log`** (read; surface-01 Phase-4 stub) — `key` (TEXT NOT NULL), `old_value` (JSONB NULLABLE — NULL on
    the first-ever write of a key), `new_value` (JSONB NOT NULL), `actor_id` (UUID FK → users NOT NULL — ADR-004 actor
    attribution), `changed_at` (TIMESTAMPTZ NOT NULL; indexed for ordering). **Append-only + tamper-evident**
    (FR-7.LOG.008 / AC-7.LOG.008.3). **No `client_slug`.**
  - **`config_values`** (read, for the current-value + class context; surface-01) — `.updated_at`, `.updated_by`
    (UUID FK → users, actor attribution) — shown as "current value" context beside a change row; the knob's class
    (LIVE/BOOT/REBUILD) is derived from `config-registry.md` (read-only reflection, DRY).
  - **`users`** (read, for actor display name; C1 `DATA-user_roles`) — resolves `actor_id`/`updated_by` to a display
    name + role at time of change; a redaction-tombstoned actor renders as "redacted (erased user)" (AC-7.LOG.008.4).
  - **Config registry** (read, DRY) — the per-key `What it does` plain-English description + class (LIVE/BOOT/REBUILD) +
    owning section, rendered read-only beside each change (binds to `config-registry.md`, never re-typed).
  - **Export artifact** (generate; FR-7.LOG.008 / AC-7.LOG.008.1) — a client-presentable extract (CSV/PDF) of the
    key-prefix-scoped, date-ranged trail; every row in range or a loud failure — no silent truncation. **No `client_slug`.**
- **ADR constraints:**
  - **ADR-004** — **actor attribution**: every config change carries the `actor_id` of the human who made it
    (`config_audit_log.actor_id` / `config_values.updated_by`, FK → users NOT NULL); an unattributed config change is a
    #1/#2 defect (the write path enforces it, config-edit-taxonomy rule 4).
  - **ADR-006** — reads are **static data-driven RLS** key-prefix-scoped by the caller's `PERM-config.*` set (the same
    policy surface-01 uses); the human path is RLS-backstopped (no `service_role` browse of another section's history).
  - **ADR-001 §3** — intra-client only; **no `client_slug` column** on any binding; no cross-deployment view (the
    cross-deployment *management* config lives on the Super Admin management plane, surface-06 — not here).
  - **The three non-negotiables** — **#1** (append-only + tamper-evident config-change record; nothing silently unlogged,
    no past entry rewritten, FR-7.LOG.008/AC.3), **#2** (key-prefix `PERM-config.*` scoping — a caller sees only the audit
    history of sections they may manage; export gated by `PERM-compliance.download_records`; secrets never appear,
    FR-7.LOG.005), **#3** (a failed/empty load reads "—" / "couldn't load audit history", never a false "no changes ever";
    an export returns every row or fails loudly, never a silent partial, AC-7.LOG.008.1).

---

## Overview

surface-01b is the **config-change audit-log viewer** of one client deployment — the surface a Super Admin (or a
section-scoped config admin) opens to *read back who changed which config knob, from what to what, and when*. It is the
read/review counterpart to surface-01 (Config Admin): surface-01 *writes* config and, on every save, appends a row to
`config_audit_log` (who / when / old→new — mandated by `config-edit-taxonomy.md` rule 4); surface-01b *renders that
trail*. It presents a **filterable timeline** (Section A — by key, config section, actor, and date range), a **change
detail** view (Section B — one change in full: the `old_value`→`new_value` diff, the actor + role, the timestamp, and the
knob's LIVE/BOOT/REBUILD class), and a **compliance export** (Section C — a client-presentable extract of the trail,
gated by `PERM-compliance.download_records`). It is **read-only** — the viewer edits no config and writes nothing to the
audit trail (the trail is written by the config save path). It is the human window into *the change history of the
system's own behaviour*: where that history is made **durable + tamper-evident** (#1), **scoped to whoever may manage the
section** (#2), and **never falsely shown as empty** on a failed load (#3). The cardinal sins here are a **failed load
rendered as "no changes ever made"** (a #3 false-healthy audit view — the most dangerous kind), a **caller seeing config
history outside their `PERM-config.*` scope** (a #2 over-exposure — e.g. a Finance admin reading the infra-config trail),
and a **compliance export that silently truncates** (a #1/#3 incomplete-record failure).

---

## Access

> Uses the six canonical C1 roles (FR-1.ROLE.001). **Entry requires ≥1 `PERM-config.*` node** — the same nodes that
> gate *editing* config on surface-01; the viewer shows each caller **only the audit rows for the config sections they
> may manage** (key-prefix RLS, surface-01 §"RLS policy guidance"). There is no separate audit-view node (OD-155). Export
> requires `PERM-compliance.download_records` (Super Admin, unseeded — default-deny).

| Role | Can enter? | What they see / can do |
|---|---|---|
| Super Admin | Yes | Full config-change trail (holds all `PERM-config.*` incl. `.infra`); may export (if `PERM-compliance.download_records` seeded) |
| Admin | Conditional | Only if they hold ≥1 `PERM-config.*` node; sees only those sections' history; **never** `#infra` (Super-Admin-only, never delegable) |
| Finance | Conditional | Only if granted a `PERM-config.*` node (none by default); sees only that section's history |
| HR | Conditional | Only if granted a `PERM-config.*` node (none by default) |
| Account Manager | Conditional | Only if granted a `PERM-config.*` node (none by default) |
| Standard User | No | No `PERM-config.*` node by default → surface hidden / 404 |

**Entry gate:** holding **≥1 `PERM-config.*` node**; callers with none see the surface hidden in nav / 404 (mirrors the
denied-access behaviour of OD-026 — explicit, never a silent empty view). The **row set is key-prefix-filtered** to the
caller's held config sections (a caller holding only `PERM-config.auth` reads only `auth.*`-key change history, never
`infra.*`). **Export** is additionally gated by **`PERM-compliance.download_records`** and is itself scoped to the
exporter's held sections. All nodes default-deny (OD-030).

---

## Layout

A **single filterable timeline + detail-drawer** viewer on the client deployment, reached from surface-01's per-section
**"View audit log →"** links and from the main nav (**OD-154**): a **Config-Change Timeline** (Section A) as the landing —
one row per `config_audit_log` entry, newest first, with a filter bar (config section · key · actor · date range) — and a
**Change Detail** drawer (Section B) that opens over the timeline for a single change (the full old→new diff + actor +
class context). An **Export** action (Section C) in the header produces a compliance extract of the currently-filtered,
key-prefix-scoped trail. Persistent chrome: a sticky header with the filter bar + the Export button (gated) + a
retention/scope indicator ("showing your permitted config sections · retained N years"), and the two always-loud
notification banners (alert-engine-stalled AC-7.ALR.008.2, alert-delivery-misconfigured AC-7.ALR.009.1) pinned above
(FR-7.ALR.001).

- **Timeline section (landing):** the **Config-Change Timeline** (Section A); clicking a row opens the **Change Detail**
  drawer (Section B).
- **Export:** the **Export** action (Section C) is available in the header to `PERM-compliance.download_records` holders.

**No section here holds a Realtime subscription** — surface-01b is a read/review surface, not one of the two Realtime
surfaces (FR-7.RTP.001 = approval queue + notification centre). The timeline is **static on load + on-demand refresh /
re-filter** (config changes are made elsewhere on surface-01; a manual refresh or a filter change re-reads). An audit
review is a deliberate, point-in-time read — not a live feed.

---

## Sections

> Three sections in two playbook buckets: **read the trail** (A Config-Change Timeline · B Change Detail) and **extract
> it** (C Compliance Export). Each states its poll contract and all five states.

---

### Section A — Config-Change Timeline (the filterable change list; landing)

**Purpose:** The chronological trail of config changes (FR-7.LOG.008) — one row per `config_audit_log` entry the caller is
permitted to see (key-prefix-scoped), newest first, filterable by config section / key / actor / date range. This is where
a Super Admin answers *what has changed in this deployment's configuration, by whom, and when* — the durable record of
every adjustment to system behaviour.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Change row (one per entry) | `config_audit_log` (surface-01 stub / FR-7.LOG.008) | `key`, `changed_at`, actor (from `actor_id`), a compact `old_value → new_value` summary; **key-prefix-scoped** — only permitted sections appear |
| Config section label | derived from `key` prefix + `config-registry.md` | Which of the 11 surface-01 sections the key belongs to (auth/memory/tools/prompts/loops/guardrails/observability/agents/proactive/infra) |
| Actor | `actor_id` → `users` (ADR-004) | Display name + role at time of change; a redaction-tombstoned actor reads "redacted (erased user)" (AC-7.LOG.008.4) |
| Knob description + class | `config-registry.md` (`What it does`, LIVE/BOOT/REBUILD) | Read-only reflection (DRY); binds to the registry, never re-typed |
| Filter bar | section / key / actor / date range | Client-side + server-side filter over the permitted, key-prefix-scoped set |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Open change (row click) | Opens the Change Detail drawer (Section B) | same as entry (key-prefix-scoped read) |
| Filter (section / key / actor / date) | Narrows the timeline within the caller's permitted set | same as entry |
| Refresh | Re-reads `config_audit_log` (on-demand) | same as entry |
| Export → | Opens the Compliance Export (Section C) | `PERM-compliance.download_records` |
| Edit this config → | Links to **surface-01** at the owning section (the trail is read-only; edits happen there) | `PERM-config.<section>` (surface-01) |

**Real-time / poll:** **Static on load + on-demand refresh / re-filter.** Not Realtime.

**States:**
- **Loading:** Skeleton rows — never a false "no changes" before data resolves.
- **Empty:** Distinguish two genuine cases: **a brand-new deployment with no config changes yet** ("No configuration
  changes have been recorded yet — changes appear here as config is edited on the Config Admin") vs **a permitted-but-
  filtered-empty view** ("No changes match your filters" / "No changes in your permitted config sections"). **Never a
  bare blank**, and never conflate "you can't see any" with "none exist".
- **Error:** `config_audit_log` read fails → "Couldn't load the config change history" + retry; **never render an empty
  timeline as if no config had ever changed** (a false-empty audit view could mask a lost/unreachable audit store — a
  #1/#3 risk, the single most dangerous state on this surface).
- **Partial:** Rows load but actor resolution (`users`) or the registry description reflection fails → render the change
  rows with actor marked **"actor unresolved"** and description **"—"**, never dropping the change row itself (the
  *change* is the audit fact; a missing actor name must not hide that a change occurred, #3).
- **Offline / stale:** "last loaded HH:MM" + manual refresh; Export disabled offline (a compliance export must be a
  confirmed-live, complete read — never exported from a stale cache).

---

### Section B — Change Detail (one config change in full)

**Purpose:** One `config_audit_log` entry in full (FR-7.LOG.008) — the config `key`, the **`old_value` → `new_value`
diff**, the **actor** (who + role at the time, ADR-004), the **timestamp**, and the knob's context (its `What it does`
description + LIVE/BOOT/REBUILD class from the registry). This is where a change's *meaning* is legible: not just "this key
changed" but "this behaviour was turned on, by this person, at this time, and it took effect immediately / next deploy /
after a rebuild".

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Config key + section | `config_audit_log.key` + registry | The key + which surface-01 section owns it |
| Old → new diff | `config_audit_log.old_value` / `.new_value` (JSONB) | Rendered as a diff; `old_value` NULL on first-ever write reads "(first set)"; structured (JSONB object) values diffed field-by-field |
| Actor | `actor_id` → `users` (ADR-004) | Name + role at time of change; redaction-tombstoned actor reads "redacted (erased user)" (AC-7.LOG.008.4) |
| Timestamp | `config_audit_log.changed_at` | Server-authoritative time (mirrors AC-7.MGM.002.4 discipline); shown in the viewer's tz + UTC |
| Knob description + class | `config-registry.md` | `What it does` (DRY read-only) + LIVE/BOOT/REBUILD class → "took effect: immediately / next deploy / after rebuild" |
| Current value (context) | `config_values.value` / `.updated_at` / `.updated_by` | The knob's *current* value + who last set it — so a reviewer sees whether this change is the latest |
| Tamper-evidence note | FR-7.LOG.008 / AC-7.LOG.008.3 | The row is append-only; an integrity-check indicator confirms the entry is unmodified |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Close / back to timeline | Returns to Section A | same as entry |
| Edit this config → | Links to **surface-01** at the owning section (read-only trail; edits there) | `PERM-config.<section>` (surface-01) |
| Copy change reference | Copies a stable reference (key + changed_at) for citing in a compliance record | same as entry |

**Real-time / poll:** **Static on load + on-demand.** Not Realtime.

**States:**
- **Loading:** Skeleton detail; the diff renders after the row resolves.
- **Empty:** N/A — Change Detail opens for an existing `config_audit_log` entry (there is no empty change: a config save
  either wrote a row or the save failed on surface-01).
- **Error:** Read fails → "Couldn't load this change" + retry; a **current-value** (`config_values`) read failure shows
  the recorded change but marks "current value unavailable", never implying the recorded change is the current state.
- **Partial:** The change row loads but actor resolution or the registry description fails → render the diff + timestamp
  (the audit facts), mark actor "unresolved" / description "—"; **the old→new diff never silently renders a partial JSONB
  value as complete** (an unresolved sub-field reads "unavailable", not a blank that looks like "unset").
- **Offline / stale:** "as-of HH:MM"; the Edit and Copy actions remain (read-only), Export-from-detail (if offered)
  disabled offline.

---

### Section C — Compliance Export (the trust-evidence extract)

**Purpose:** A client-presentable export of the config-change trail (FR-7.LOG.008 / AC-7.LOG.008.1) over the currently-
filtered, key-prefix-scoped set — the config-config analogue of the `guardrail_log` export (FR-7.LOG.007). It exists
because the record of *who changed the system's configuration* is compliance-grade trust evidence; the export **returns
every row in the selected window or fails loudly — never a silent partial**.

**Data bindings:**
| Element | Source | Notes |
|---|---|---|
| Export scope | Section A's active filters + key-prefix scope | The export covers exactly the caller's permitted, filtered set (never wider than they can view) |
| Export rows | `config_audit_log` (FR-7.LOG.008) | key · section · old→new · actor · changed_at; complete over the range (AC-7.LOG.008.1) |
| Format | client-presentable (CSV / PDF) | Faithful, complete extract (mirrors AC-7.LOG.007.1) |
| Completeness attestation | AC-7.LOG.008.1 | The export states its range + row count; a truncated/failed export is surfaced as an error, never a silent short file |

**Actions:**
| Action (label) | What it does | PERM gate |
|---|---|---|
| Export config audit trail | Generates the extract over the filtered, key-prefix-scoped range; returns every row or fails loudly | `PERM-compliance.download_records` (+ implicit `PERM-config.*` scope) |
| Choose range / format | Sets the export window + format before generating | same as export |

**Real-time / poll:** **On-demand** (the user triggers an export). Not Realtime.

**States:**
- **Loading:** "Preparing export…" with the range + estimated row count; long exports show progress, never a frozen button.
- **Empty:** A genuine no-rows-in-range → "No config changes in the selected range/sections" (offered as an explicit,
  attested empty export, not a silent zero-byte file).
- **Error:** Export fails (read or generation) → "Export couldn't complete — no partial file was produced" + retry;
  **never deliver a truncated file as if complete** (AC-7.LOG.008.1 — a silent partial compliance export is a #1/#3
  failure).
- **Partial:** N/A by design — an export is **all-or-nothing** (AC-7.LOG.008.1); a partial read aborts to the Error state
  rather than producing a short file.
- **Offline / stale:** Export disabled with "You're offline — export unavailable" (a compliance export must be a
  confirmed-live, complete read).

---

## Navigation / transitions

| Trigger | Destination |
|---|---|
| surface-01 per-section "View audit log →" | surface-01b (Config-Change Timeline, pre-filtered to that section) |
| Main nav → Config change history | surface-01b (Timeline landing) |
| Change row click | Section B Change Detail drawer |
| Export → | Section C Compliance Export |
| Edit this config → | surface-01 at the owning section (`PERM-config.<section>`) |

---

## Mobile

This is a **read-review** surface — reading the config-change timeline and a change detail works on a phone, and the
key-prefix scope is identical on any viewport. On a narrow viewport the timeline collapses to a single-column list, the
filter bar becomes a filter sheet, and Change Detail becomes a full-screen view. **Compliance export** is
**best-effort / discouraged on mobile** and may degrade to a "do this on desktop" notice — a compliance extract is better
generated and saved on a wider display — consistent with the deep-management → desktop degrade elsewhere. The two
protective notification banners remain mandatory. Detailed mobile treatment: `surface-12-mobile.md`.

---

## Open decisions

| # | Question | Options | Recommendation |
|---|---|---|---|
| OD-153 🔑 **#1/#3 Rule-0 governance gap** | `config_audit_log` is a third audit sink but has **no FR owner** for its governance (append-only / retention / tamper-evidence / export) — only a `config-edit-taxonomy` rule-4 *write* mandate + a surface-01 schema stub. Who owns it? | (a) **Mint `FR-7.LOG.008` in C7 via change-control** — config_audit_log view/retention/tamper-evidence/export, mirroring FR-7.LOG.007 (guardrail_log) + the FR-1.AUD.003 seam (C1 content → C7 storage). (b) Leave it as a `config-edit-taxonomy` standard + Phase-4 schema stub with no governance FR. (c) Own governance in C1 alongside `access_audit`. | **(a)** — an unlogged/tamperable/un-exportable config-change record is a **#1/#3 violation** (the record of who changed system behaviour is safety-critical); C7 already owns the two sibling sinks' governance (event_log FR-7.LOG.006, guardrail_log FR-7.LOG.007) and the access_audit storage seam (FR-1.AUD.003), so config_audit_log belongs there too. Precedent: OD-097 → FR-7.ALR.009 minted into C7 from Phase 2 the same way. (b) leaves the gap open; (c) splits it from its C7 siblings. **FR-7.LOG.008 minted; C7 34→35.** |
| OD-154 | **Layout** — how to structure the timeline + detail + export. | (a) **Single filterable Config-Change Timeline landing + per-change Change Detail drawer + a header Export action.** (b) Fully tabbed (Timeline / Export). (c) Per-section sub-pages. | **(a)** — a single chronological timeline with a rich filter bar (section/key/actor/date) is the natural audit-review shape (an auditor scans time, then drills a change); a drawer keeps timeline context; export is a cross-cutting header action, not a co-equal tab. Consistent with surface-06/09/11's list-landing + detail-drawer (OD-126/138/146). (b)/(c) fragment the trail. |
| OD-155 ⚠️ **#2 read authority (clean, no node)** | **Entry gating** — does the viewer need a new `PERM-config.view_audit` node, or is it scoped by the existing `PERM-config.*` edit nodes? | (a) **No new node — entry requires ≥1 `PERM-config.*` node; the row set is key-prefix-scoped to the caller's held sections** (the same RLS surface-01 uses for `config_values`/`config_audit_log`); export gated by the catalogued `PERM-compliance.download_records`. (b) Mint `PERM-config.view_audit`. (c) Gate on `PERM-compliance.download_records` for the whole surface (conflates *view* with *export/download*). | **(a)** — the audit history of a config section is legible to whoever may **manage** that section; a separate view node would fork read authority from the edit authority that produced the rows, and surface-01 already mandates the key-prefix RLS. Export is a distinct, higher act (`PERM-compliance.download_records`). **No node minted** (a clean case, like surfaces 10/11/12). |
| OD-156 | **Behaviour** — what the export contains + how old→new is rendered + secret handling. | (a) **Export = key/section/old→new/actor/changed_at over the filtered, key-prefix-scoped range, all-or-nothing (AC-7.LOG.008.1); old→new rendered as a field-level diff; secrets never appear because SECRET rows are never editable in-app (FR-7.LOG.005 by construction).** (b) Export everything regardless of the caller's scope (over-exposure, #2). (c) Redact values in the export (loses the audit's point — the value change *is* the record). | **(a)** — the export mirrors the caller's permitted view (never wider, #2), is complete-or-loud (#1/#3, AC-7.LOG.008.1), and renders the value change plainly because config values are, by construction, never credential material (secrets are a read-only presence indicator, never written to the log). (b) over-exposes; (c) defeats the audit. |

*(All four resolved surface-local, recommendations delegated — consistent with surfaces 05–12. **OD-153 is the key
finding** — a Rule-0 governance gap closed via a C7 change-control mint (FR-7.LOG.008), mirroring OD-097→FR-7.ALR.009.
OD-155 is a clean-case resolution — no node mint, reusing the existing `PERM-config.*` + `PERM-compliance.download_records`
nodes.)*

---

## Phase 4 data binding notes

- **`config_audit_log`** (read here; the surface-01 Phase-4 stub) — `key` / `old_value` (JSONB NULLABLE) / `new_value`
  (JSONB NOT NULL) / `actor_id` (UUID FK → users NOT NULL) / `changed_at` (TIMESTAMPTZ NOT NULL, indexed). Phase 4:
  **append-only + tamper-evident** (FR-7.LOG.008 / AC-7.LOG.008.3 — no UPDATE/DELETE outside retention pruning + an
  integrity check); a **key-prefix RLS policy** tied to the caller's `PERM-config.*` set (surface-01 §"RLS policy
  guidance" — the identical policy `config_values` uses); an index on `changed_at` (ordering) + on `key` (section/key
  filter). **No `client_slug`.**
- **`config_values`** (read here, for current-value context) — `.value` / `.updated_at` / `.updated_by`; already a
  surface-01 binding. No new field.
- **`users`** (read here, actor resolution) — resolves `actor_id`/`updated_by` to name + role-at-time; the
  role-at-time may require a point-in-time lookup (Phase 4 decides whether to denormalise the actor's role onto the audit
  row or resolve live) — a redaction-tombstoned user resolves to "redacted (erased user)" (AC-7.LOG.008.4).
- **Export artifact** (generate here) — a client-presentable extract (CSV/PDF) of the key-prefix-scoped, date-ranged
  trail; **all-or-nothing** (AC-7.LOG.008.1). Phase 4/6 wires the export to a complete server-side read (no client-side
  pagination truncation).
- **Retention** — the config-audit retention floor follows the audit/compliance floor (AC-7.LOG.008.2), the same floor as
  `event_log`/`guardrail_log` (FR-7.LOG.006/007) and the `individual_deletion_audit_years` legal minimum (surface-01
  `#infra`); a pruning run never removes a floor-window row and is itself logged.
- **Redaction-tombstone (carry-forward)** — on an individual right-to-erasure (C10 FR-10.DEL.004 / C2 FR-2.MNT.017's
  transitive walk, which already names `event_log` + `guardrail_log`), the erased user's `config_audit_log.actor_id`
  attribution is redaction-tombstoned (the change record + `key`/`old_value`/`new_value`/`changed_at` retained, the
  actor made unidentifiable) — **this session flags `config_audit_log` as owed to that erasure walk** (a Phase-4/C10
  carry-forward, mirroring how session 27 added event_log/guardrail_log to it via AC-2.MNT.017.4).
- **No new PERM node minted** — view is key-prefix-scoped by existing `PERM-config.*` (OD-155); export reuses
  `PERM-compliance.download_records` (catalogued, unseeded). No catalog edit.
