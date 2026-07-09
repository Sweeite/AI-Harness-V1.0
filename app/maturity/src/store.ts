// ISSUE-030 (C2 MAT) — the MaturityStore PORT + in-memory reference fake (house port+fake pattern, cf. app/memory,
// app/embeddings). Every live side effect of the MAT signal-producers goes through this port: read entities + their
// live memories, UPDATE entities.maturity (+ stamp maturity_updated_at), read/write the cold-start latch, read
// CFG-* config, and emit the loud maturity_recomputed observability event. The in-memory fake is BOTH the test
// double AND the reference model the live pg adapter (supabase-store.ts) must match 1:1.
//
// Faithful to schema.md §3 (entities.maturity numeric(4,3), maturity_updated_at timestamptz — verify-present from
// ISSUE-022's 0001 baseline; this slice POPULATES them) + §12 Config cluster (config_values). Maturity is stored on
// entities; the aggregate is a derived avg (maturity.ts) — NO separate table. Retrieval Sufficiency is inline, never
// stored (sufficiency.ts). The cold-start latch persists in config_values['cold_start_mode_deactivated'] so it
// survives a restart (a forgotten latch would re-arm — #1).

import type { EntityRow, MemoryRow } from '../../memory/src/store.ts';
import { isLiveMemory } from './maturity.ts';
import type { ExpectedSlots } from './slots.ts';
import { validateExpectedSlots } from './slots.ts';
import { type ColdStartState, INITIAL_COLD_START_STATE } from './coldstart.ts';

// ── Config (CFG-*; config-registry.md §E Memory + §L Proactive + Appendix A #2) ─────────────────────────────
export interface MaturityConfig {
  /** CFG-expected_slots — entity TYPE → 5–8 slot names (config-registry Appendix A #2; LIVE-class). */
  expectedSlots: ExpectedSlots;
  /** CFG-cold_start_basic_threshold — int 0–100 (default 20). */
  coldStartBasicThreshold: number;
  /** CFG-cold_start_proactive_threshold — int 0–100 (default 50); also the [Building] Maturity cut (sufficiency.ts). */
  coldStartProactiveThreshold: number;
  /** CFG-cold_start_full_threshold — int 0–100 (default 80); the cold-start latch trip point. */
  coldStartFullThreshold: number;
  /** CFG-retrieval_sufficiency_threshold — float 0–1 (default 0.6); the thin bar for query-time sufficiency. */
  retrievalSufficiencyThreshold: number;
}

// Registry defaults (config-registry.md rows) — the loud fallback when a config_values row is absent on a fresh
// deployment. NOT a silent guess: these are the documented Rule-0 defaults, mirrored here for offline use + so the
// adapter degrades to the spec'd default rather than throwing on an unseeded knob.
export const DEFAULT_COLD_START_BASIC = 20;
export const DEFAULT_COLD_START_PROACTIVE = 50;
export const DEFAULT_COLD_START_FULL = 80;
export const DEFAULT_RETRIEVAL_SUFFICIENCY_THRESHOLD = 0.6;

/** The threshold ordering ADR-002 requires: basic ≤ proactive ≤ full (config-registry §L validation). Enforced so a
 *  mis-ordered edit is rejected LOUD, not silently producing an unreachable phase (#3). */
export function validateMaturityConfig(cfg: MaturityConfig): void {
  validateExpectedSlots(cfg.expectedSlots);
  const { coldStartBasicThreshold: b, coldStartProactiveThreshold: p, coldStartFullThreshold: f } = cfg;
  for (const [k, v] of [['basic', b], ['proactive', p], ['full', f]] as const) {
    if (!Number.isFinite(v) || v < 0 || v > 100) throw new MaturityConfigError(`cold_start_${k}_threshold must be an int 0–100 (got ${v})`);
  }
  if (!(b <= p && p <= f)) throw new MaturityConfigError(`cold_start thresholds must satisfy basic ≤ proactive ≤ full (got ${b} ≤ ${p} ≤ ${f})`);
  if (!Number.isFinite(cfg.retrievalSufficiencyThreshold) || cfg.retrievalSufficiencyThreshold < 0 || cfg.retrievalSufficiencyThreshold > 1) {
    throw new MaturityConfigError(`retrieval_sufficiency_threshold must be a float 0–1 (got ${cfg.retrievalSufficiencyThreshold})`);
  }
}

export class MaturityConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaturityConfigError';
  }
}

// ── The loud recompute observability record (→ event_log 'maturity_recomputed') ─────────────────────────────
/** Emitted on every per-entity Maturity recompute (FR-2.MAT.002 Observability). Loud + durable so a recompute is
 *  never a silent state change (#3). `trigger` distinguishes the daily slow loop from the on-write path. */
export interface MaturityRecomputed {
  entityId: string;
  maturity: number | null;
  filledCount: number;
  expectedCount: number;
  trigger: 'daily' | 'on_write';
  aggregate: number | null;
  coldStartDeactivated: boolean;
  at: string; // ISO
}

// ── The port ────────────────────────────────────────────────────────────────────────────────────────────────
export interface MaturityStore {
  /** Read CFG-* (expected_slots + the four thresholds) from config, falling back to registry defaults per key. */
  loadConfig(): Promise<MaturityConfig>;

  listEntities(): Promise<EntityRow[]>;
  getEntity(id: string): Promise<EntityRow | null>;
  /** An entity's LIVE memories (superseded_by null AND non-expired at now) — the slot-fill countable set. */
  liveMemoriesForEntity(id: string, nowMs: number): Promise<MemoryRow[]>;

  /** UPDATE entities SET maturity=$2, maturity_updated_at=$3 WHERE id=$1 (the stored per-entity Maturity). */
  setMaturity(id: string, maturity: number | null, updatedAtIso: string): Promise<void>;

  /** The persisted cold-start ONE-WAY LATCH (config_values['cold_start_mode_deactivated']). */
  readColdStartState(): Promise<ColdStartState>;
  writeColdStartState(state: ColdStartState): Promise<void>;

  /** Emit the loud maturity_recomputed event (event_log). */
  emitRecomputed(rec: MaturityRecomputed): Promise<void>;
}

// ── The in-memory fake reference model ────────────────────────────────────────────────────────────────────────
export class InMemoryMaturityStore implements MaturityStore {
  private config: MaturityConfig;
  private entities: EntityRow[];
  private memories: MemoryRow[];
  private coldStart: ColdStartState;
  /** Inspectable in tests: every emitted recompute event (the event_log the adapter writes to). */
  public readonly events: MaturityRecomputed[] = [];

  constructor(opts: {
    config: MaturityConfig;
    entities?: EntityRow[];
    memories?: MemoryRow[];
    coldStart?: ColdStartState;
  }) {
    validateMaturityConfig(opts.config); // reject an ill-formed slot/threshold config at construction (loud)
    this.config = opts.config;
    this.entities = (opts.entities ?? []).map((e) => ({ ...e }));
    this.memories = (opts.memories ?? []).map((m) => ({ ...m }));
    this.coldStart = opts.coldStart ? { ...opts.coldStart } : { ...INITIAL_COLD_START_STATE };
  }

  async loadConfig(): Promise<MaturityConfig> {
    return { ...this.config, expectedSlots: structuredClone(this.config.expectedSlots) };
  }

  async listEntities(): Promise<EntityRow[]> {
    return this.entities.map((e) => ({ ...e, external_refs: { ...e.external_refs } }));
  }
  async getEntity(id: string): Promise<EntityRow | null> {
    const e = this.entities.find((x) => x.id === id);
    return e ? { ...e, external_refs: { ...e.external_refs } } : null;
  }

  async liveMemoriesForEntity(id: string, nowMs: number): Promise<MemoryRow[]> {
    return this.memories
      .filter((m) => m.entity_ids.includes(id) && isLiveMemory(m, nowMs))
      .map((m) => ({ ...m, entity_ids: [...m.entity_ids], embedding: [...m.embedding] }));
  }

  async setMaturity(id: string, maturity: number | null, updatedAtIso: string): Promise<void> {
    const e = this.entities.find((x) => x.id === id);
    if (!e) throw new Error(`setMaturity: entity '${id}' not found`); // loud — never a silent no-op (#3)
    e.maturity = maturity;
    e.maturity_updated_at = updatedAtIso;
  }

  async readColdStartState(): Promise<ColdStartState> {
    return { ...this.coldStart };
  }
  async writeColdStartState(state: ColdStartState): Promise<void> {
    // Store-level ONE-WAY LATCH (matches the live adapter's SQL guard): `deactivated` is monotonic — a write can
    // NEVER clear it once set, so an interleaved recompute carrying a stale `false` cannot un-latch the mode
    // (AC-2.MAT.002.1 / #1). `phase` still tracks the latest observed aggregate for ISSUE-071's ladder.
    this.coldStart = { deactivated: this.coldStart.deactivated || state.deactivated, phase: state.phase };
  }

  async emitRecomputed(rec: MaturityRecomputed): Promise<void> {
    this.events.push({ ...rec });
  }

  // ── Test-seam helpers (not part of the port) ────────────────────────────────────────────────────────────────
  /** Seed/replace this fake's memories (tests build them with app/memory's InMemoryMemoryStore._memoryRow). */
  _setMemories(memories: MemoryRow[]): void {
    this.memories = memories.map((m) => ({ ...m }));
  }
}
