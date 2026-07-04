// Pure migration planning — no I/O, no DB. Decides which migrations are pending, and fails LOUD on
// any drift between the journal order and what has actually been applied (a later migration applied
// while an earlier one is not is exactly the silent state-drift Rule 0 / non-negotiable #3 forbids).

import type { JournalEntry } from "./journal.ts";

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

/**
 * The applied set MUST be a contiguous prefix of the journal order. If migration N is applied but
 * some earlier migration M (M before N) is not, the deployment is in an unknown/corrupt state — halt
 * loudly rather than "fill the gap" (which could apply M against a schema that N already changed).
 */
export function assertContiguous(entries: JournalEntry[], applied: ReadonlySet<string>): void {
  const known = new Set(entries.map((e) => e.tag));
  for (const tag of applied) {
    if (!known.has(tag)) {
      throw new MigrationError(
        `applied migration '${tag}' is not in the journal — schema history diverged from the codebase (Rule 0 / #3).`,
      );
    }
  }
  let sawUnapplied = false;
  for (const entry of entries) {
    if (applied.has(entry.tag)) {
      if (sawUnapplied) {
        throw new MigrationError(
          `migration '${entry.tag}' is applied but an earlier migration is not — non-contiguous history (halt, do not auto-fill). #3.`,
        );
      }
    } else {
      sawUnapplied = true;
    }
  }
}

/** Pending = journal entries whose tag is not yet applied, in journal order. */
export function planPending(entries: JournalEntry[], applied: ReadonlySet<string>): JournalEntry[] {
  return entries.filter((e) => !applied.has(e.tag));
}
