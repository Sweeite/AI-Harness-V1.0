// ISSUE-022 — the memory-write derivations this slice owns for the row shape the writer (ISSUE-024) populates:
// the content hash + the idempotency key (ADR-004 §4). Kept dependency-light (node:crypto only) so both the fake
// and the live adapter compute IDENTICAL keys — a divergent key would defeat the unique(idempotency_key) dedup.

import { createHash } from 'node:crypto';

/** A stable content hash — an idempotency component + the lexical-dup signal the maintenance job (FR-2.MNT.006)
 *  reuses. sha256 of the trimmed, whitespace-collapsed content (so trivial reformatting is the same memory). */
export function contentHash(content: string): string {
  const normalised = content.trim().replace(/\s+/g, ' ');
  return createHash('sha256').update(normalised).digest('hex');
}

/** The memory-write idempotency key (ADR-004 §4): hash(source_ref, SORTED entity_ids, content_hash). Sorting the
 *  entity_ids makes the key order-independent (the same fact about {A,B} and {B,A} is one memory). A retried
 *  Inngest step re-derives the same key → unique(idempotency_key) makes the re-insert a no-op (ON CONFLICT DO
 *  NOTHING), killing the retry-duplicate (ADR-004 §4). null source_ref participates as the empty string. */
export function computeIdempotencyKey(sourceRef: string | null, entityIds: readonly string[], hash: string): string {
  const sortedEntities = [...entityIds].sort();
  const material = JSON.stringify([sourceRef ?? '', sortedEntities, hash]);
  return createHash('sha256').update(material).digest('hex');
}
