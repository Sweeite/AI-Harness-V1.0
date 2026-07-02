# Dimension 4 — Change-control Integrity

This dimension checked whether references between config/registry entries and their cited
source ADRs (and other change-controlled decision records) are verifiable by name — i.e.
whether a config key, enum value, or decision cited as sourced to a specific ADR section is
actually named (verbatim, by key or literal) in that ADR, and whether the citation chain from
downstream docs back to the locked decision record holds without gaps. Agents traced citations
in config-registry.md and related NFR/backup-DR documentation against the ADR text they point to.

| Severity | File | Line | Summary | Detail | Recommendation |
|---|---|---|---|---|---|
| MED | spec/00-foundations/adr/ADR-008-backup-dr.md | 103,129 | config-registry.md cites ADR-008 §1 as the owner of `recovery_tier`, but ADR-008 never names that config key (or its enum values) verbatim. | spec/02-config/config-registry.md:286 adds `recovery_tier` (enum: daily_in_project · hourly_off_platform · pitr) sourced to 'ADR-008 §1'. ADR-008-backup-dr.md Decision part 1 (L103) and part 5 (L129) discuss 'recovery tier' only as prose ('Default recovery tier = free daily in-project backups + an hourly off-platform snapshot'; 'the recovery tier (daily+hourly, or PITR)') — it never uses the literal snake_case key `recovery_tier`, nor the enum literals `daily_in_project` / `hourly_off_platform` / `pitr`, anywhere in the file (grep confirms zero hits for all four strings). This breaks the pattern used correctly elsewhere in the same batch: ADR-003-cost-model.md L170-197 references `haiku_audit_window_days` and `haiku_gate_disagree_threshold` by exact backticked name, satisfying the 'ADR references the key by name' bar. The actual by-name citation for `recovery_tier` only exists one level removed, in spec/05-non-functional/backup-dr.md:36 ('config `recovery_tier`'), which is not the file config-registry.md points to as the source ADR. Per Rule 0 / change-control, the citation chain from config-registry.md → ADR-008 is broken even though a downstream NFR doc happens to close the gap; ADR-008 itself should be updated to name the key (or the config-registry source citation corrected to point at backup-dr.md). | No explicit recommendation provided by the source finding. |
