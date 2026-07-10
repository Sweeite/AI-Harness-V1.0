// ISSUE-025 — test fixtures (NOT a *.test.ts, so `npm test` does not run it). Builders for well-formed memories,
// entities, and requesters so the AC tests read as behaviour, not row-plumbing.

import type { MemoryRow, EntityRow } from '../../memory/src/store.ts';
import type { Requester } from './clearance.ts';

/** A 1536-dim unit-ish embedding aligned to a single axis `k` (so cosine similarity is controllable in tests): the
 *  vector is all-zero except a 1 at index k. Two memories on the same axis are cosine-1; orthogonal axes are cosine-0. */
export function axisVector(k: number, dims = 1536): number[] {
  const v = new Array(dims).fill(0);
  v[k % dims] = 1;
  return v;
}

let seq = 0;
export function mkMemory(p: Partial<MemoryRow> & Pick<MemoryRow, 'entity_ids'>): MemoryRow {
  const id = p.id ?? `m-${++seq}`;
  const source = p.source ?? 'ai_inferred';
  return {
    id,
    type: p.type ?? 'semantic',
    content: p.content ?? `content-${id}`,
    embedding: p.embedding ?? axisVector(0),
    embedding_model: p.embedding_model ?? 'text-embedding-3-small',
    entity_ids: p.entity_ids,
    source,
    source_ref: p.source_ref ?? (source === 'system_pointer' ? 'ghl:contact/123' : null),
    confidence: p.confidence ?? (source === 'system_pointer' ? null : 0.9),
    visibility: p.visibility ?? 'global',
    sensitivity: p.sensitivity ?? 'standard',
    superseded_by: p.superseded_by ?? null,
    content_hash: p.content_hash ?? `h-${id}`,
    idempotency_key: p.idempotency_key ?? `k-${id}`,
    expires_at: p.expires_at ?? null,
    created_at: p.created_at ?? '2026-07-01T00:00:00.000Z',
    updated_at: p.updated_at ?? '2026-07-01T00:00:00.000Z',
  };
}

export function mkEntity(p: Pick<EntityRow, 'id' | 'type' | 'name'> & Partial<EntityRow>): EntityRow {
  return {
    external_refs: {},
    is_internal_org: false,
    maturity: null,
    maturity_updated_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...p,
  };
}

/** A fully-cleared human requester (sees everything) — the default for tests not about clearance. */
export function fullClearanceHuman(overrides: Partial<Requester> = {}): Requester {
  return {
    path: 'human',
    aal2: true,
    visibility: ['global', 'team', 'private'],
    clearances: [
      { tier: 'confidential', entityTypeScope: null },
      { tier: 'personal', entityTypeScope: null },
    ],
    restricted: [],
    ...overrides,
  };
}
