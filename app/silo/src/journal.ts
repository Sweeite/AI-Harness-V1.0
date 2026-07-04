// Journal + migration-file loading. The `_journal.json` manifest is the ordered list of migrations
// the runner applies; each entry declares whether it is transactional (the runner wraps it in a
// BEGIN/COMMIT) or not (autocommit — required for CREATE INDEX CONCURRENTLY, migrations.md L46-48).

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export interface JournalEntry {
  tag: string;
  file: string;
  transactional: boolean;
}

export interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

export interface MigrationFile {
  tag: string;
  file: string;
  transactional: boolean;
  sql: string;
  checksum: string; // sha256 of the file bytes — drift detection on re-apply
}

export function loadJournal(migrationsDir: string): Journal {
  const raw = readFileSync(join(migrationsDir, "_journal.json"), "utf8");
  const j = JSON.parse(raw) as Journal;
  if (!Array.isArray(j.entries) || j.entries.length === 0) {
    throw new Error(`_journal.json has no entries (${migrationsDir})`);
  }
  return j;
}

export function loadMigrationFiles(migrationsDir: string, journal: Journal): Map<string, MigrationFile> {
  const onDisk = new Set(readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")));
  const files = new Map<string, MigrationFile>();
  for (const entry of journal.entries) {
    if (!onDisk.has(entry.file)) {
      throw new Error(`_journal.json references ${entry.file} but it is not on disk in ${migrationsDir}`);
    }
    const sql = readFileSync(join(migrationsDir, entry.file), "utf8");
    files.set(entry.tag, {
      tag: entry.tag,
      file: entry.file,
      transactional: entry.transactional,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex"),
    });
  }
  return files;
}
