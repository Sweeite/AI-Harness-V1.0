// ISSUE-081 — the fleet migration corpus fingerprint. The whole fleet migrates from ONE migrations
// directory in ONE repo (ADR-001 §2 — one codebase, no per-client schema fork). This derives the shared
// `MigrationCorpus` from that single directory: the ordered (tag, sha256(file)) pairs hashed into one
// fingerprint. Because every deployment builds from the same repo, every deployment's fingerprint is
// identical BY CONSTRUCTION — and a divergent fingerprint at propagation time is exactly the fork the
// #2 guard (propagateRelease) refuses to accept silently (AC-10.MIG.001.2).
//
// It reuses the ISSUE-008 journal shape (`_journal.json` + per-file sha256, cf. app/silo/src/journal.ts)
// so the fingerprint is anchored to the same bytes the silo runner applies — no second source of truth.

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { MigrationCorpus } from "./propagation.ts";

interface JournalShape {
  entries: { tag: string; file: string; transactional: boolean }[];
}

/**
 * Build the fleet `MigrationCorpus` for a release from the shared migrations directory. Reads
 * `_journal.json` (the ordered manifest) and, in journal order, hashes each migration file's bytes into
 * a single fingerprint. Throws (fail-loud) if the journal is missing/empty or references a file not on
 * disk — a corpus we cannot pin is never propagated.
 */
export function loadFleetCorpus(migrationsDir: string, release: string): MigrationCorpus {
  const raw = readFileSync(join(migrationsDir, "_journal.json"), "utf8");
  const journal = JSON.parse(raw) as JournalShape;
  if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
    throw new Error(`_journal.json has no entries (${migrationsDir}) — cannot pin a fleet corpus`);
  }
  const onDisk = new Set(readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")));
  const hash = createHash("sha256");
  const tags: string[] = [];
  for (const e of journal.entries) {
    if (!onDisk.has(e.file)) {
      throw new Error(`_journal.json references ${e.file} but it is not on disk in ${migrationsDir}`);
    }
    const sql = readFileSync(join(migrationsDir, e.file), "utf8");
    const fileHash = createHash("sha256").update(sql).digest("hex");
    // Order-sensitive: tag + per-file hash folded in sequence, so a reorder or an edit changes the print.
    hash.update(`${e.tag}:${fileHash}\n`);
    tags.push(e.tag);
  }
  return { release, fingerprint: hash.digest("hex"), tags };
}
