// ISSUE-012 — the ManagementStore PORT + in-memory fake reference model (the house port+fake pattern, cf.
// app/rbac store.ts, app/config-store store.ts). Every live side effect of the management-plane bootstrap
// goes through this port so the ingest / token-lifecycle / staleness logic stays unit-testable with NO live
// DB. The in-memory fake is BOTH the test double AND the reference model the live pg adapter
// (supabase-store.ts) must match against the schema.md §13 DDL.
//
// Faithful to schema.md §13 (client_registry, deployment_health). Invariants enforced in the fake EXACTLY
// as the DB would:
//   1. client_registry.client_slug is UNIQUE and is the ONLY home of client identity (ADR-001 §3) — no app
//      table carries it. deployment_health.client_slug PK → client_registry.client_slug (FK).
//   2. internal_token is stored ENCRYPTED (never plaintext) — the fake holds an EncryptedToken, never the raw
//      string (AC-10.MGT.001.3). There is deliberately no method returning a decrypted token to a "surface".
//   3. client_registry.status is SERVER-AUTHORITATIVE — a push never sets it; only explicit lifecycle
//      transitions do (OD-162 / AC-10.MGT.001.2). The ingest updates core_version + deployment_health, not
//      status.
//   4. ingest is IDEMPOTENT on re-delivery — an upsert keyed on client_slug + a delivery id never
//      double-counts (AC-10.MGT.002.x). last_push_at is a SERVER timestamp (AF-120), never reporter-asserted.

import {
  type EncryptedToken,
  encryptToken,
  decryptToken,
  mintToken,
  newTokenId,
} from './crypto.ts';
import { type OperationalSnapshot } from './allowlist.ts';

// ── client_registry (schema.md §13) ─────────────────────────────────────────────
export type ClientStatus = 'initialising' | 'active' | 'offboarding' | 'frozen';
export const CLIENT_STATUSES: readonly ClientStatus[] = ['initialising', 'active', 'offboarding', 'frozen'];

/** The lifecycle transitions C10 owns (FR-10.MGT.001; provisioning→initialising→active; offboard→
 *  offboarding/frozen; reactivate→active). Any other transition is refused — status can never drift silently. */
const ALLOWED_TRANSITIONS: Record<ClientStatus, ClientStatus[]> = {
  initialising: ['active'],
  active: ['offboarding', 'frozen'],
  offboarding: ['frozen', 'active'],
  frozen: ['active', 'offboarding'],
};

export interface ClientRegistryRow {
  id: string;
  client_slug: string;
  client_name: string;
  railway_url: string | null;
  // internal_token is stored ENCRYPTED. The row never carries the plaintext (AC-10.MGT.001.3).
  internal_token: EncryptedToken;
  // token_id correlates the mgmt-DB copy with the deployment's Railway-env copy across a rotation.
  token_id: string;
  // Set false on revoke (deprovision) — a revoked token can no longer authenticate (AC-10.MGT.004.3).
  token_active: boolean;
  core_version: string | null;
  region: string;
  status: ClientStatus;
  created_at: string;
  offboarding_initiated_at: string | null;
  offboarding_at: string | null;
}

// ── deployment_health (schema.md §13) — push-fed operational metadata ONLY ────────
export interface DeploymentHealthRow {
  client_slug: string; // PK → client_registry(client_slug)
  health_score: number | null;
  queue_depth: number | null;
  approval_queue_depth: number | null;
  alert_counts: Record<string, number> | null;
  core_version: string | null;
  last_migrated_at: string | null;
  connector_rollup: Record<string, unknown> | null;
  cost_to_date: number | null;
  plugin_version: string | null;
  backup_health: Record<string, unknown> | null;
  log_write_failing: boolean;
  last_push_at: string; // SERVER-authoritative (AF-120)
  updated_at: string;
}

/** The result of an ingest write — what was updated + whether it was a fresh delivery or an idempotent replay. */
export interface IngestResult {
  client_slug: string;
  core_version: string | null;
  health: DeploymentHealthRow;
  replayed: boolean; // true ⇒ this delivery_id was already applied; no re-count (AC-10.MGT.002.x)
}

export class ManagementError extends Error {
  constructor(
    public reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'ManagementError';
  }
}
export const ERR_NO_SUCH_CLIENT = 'no_such_client';
export const ERR_BAD_TRANSITION = 'bad_status_transition';
export const ERR_DUPLICATE_SLUG = 'duplicate_slug';

// ── The port ─────────────────────────────────────────────────────────────────────
export interface ManagementStore {
  // client_registry lifecycle (FR-10.MGT.001).
  registerClient(input: {
    client_slug: string;
    client_name: string;
    railway_url?: string | null;
    region?: string;
    plaintextToken: string; // encrypted at rest by the store; the store never persists the plaintext
    now: number;
  }): Promise<ClientRegistryRow>;
  getClientBySlug(slug: string): Promise<ClientRegistryRow | null>;
  listClients(): Promise<ClientRegistryRow[]>;
  transitionStatus(slug: string, to: ClientStatus, now: number): Promise<ClientRegistryRow>;

  // internal_token lifecycle (FR-10.MGT.004).
  /** Authenticate a bearer token against the stored (encrypted) token. Constant-shape; returns the row IFF
   *  the token matches AND is active. A revoked/rotated-away token returns null (no anonymous ingest). */
  authenticate(bearer: string): Promise<ClientRegistryRow | null>;
  /** Rotate: re-mint, dual-update (mgmt DB encrypted + deployment Railway env). The dualUpdate callback is
   *  the Railway-env side; if it throws, the rotation is a PARTIAL and is surfaced, never silently dropped. */
  rotateToken(slug: string, dualUpdate: (newToken: string) => Promise<void>, now: number): Promise<RotationResult>;
  /** Revoke (deprovision): the token can no longer authenticate (AC-10.MGT.004.3). */
  revokeToken(slug: string, now: number): Promise<void>;

  // Ingest write (FR-10.MGT.002). Idempotent on delivery_id; updates core_version + upserts deployment_health.
  ingest(input: { slug: string; snapshot: OperationalSnapshot; delivery_id: string; serverNow: number }): Promise<IngestResult>;
  getHealth(slug: string): Promise<DeploymentHealthRow | null>;
  listHealth(): Promise<DeploymentHealthRow[]>;
}

/** Outcome of a rotation — both stores updated, or a partial that is surfaced (AC-10.MGT.004.2). */
export interface RotationResult {
  slug: string;
  ok: boolean; // true ⇒ both stores updated; false ⇒ partial (mgmt updated, Railway side failed) — surfaced
  new_token_id: string;
  detail: string;
}

let __seq = 0;
const nextRowId = () => `mgmt-${String(++__seq).padStart(4, '0')}`;

// ── The in-memory fake reference model ─────────────────────────────────────────────
export class InMemoryManagementStore implements ManagementStore {
  private registry = new Map<string, ClientRegistryRow>(); // keyed by client_slug (the unique identity)
  private health = new Map<string, DeploymentHealthRow>(); // keyed by client_slug (PK → registry)
  // Idempotency ledger: the set of delivery_ids already applied per client (models a UNIQUE(delivery_id)
  // dedup table on the mgmt side — a replayed push is a no-op, never a double-count).
  private appliedDeliveries = new Set<string>();

  // The at-rest key (the live adapter supplies a KMS-managed key; the fake holds a fixed 32-byte key so the
  // encryption is REAL and reproducible). Private so no caller can read it.
  constructor(private readonly encKey: Buffer) {
    if (encKey.length !== 32) throw new Error('InMemoryManagementStore needs a 32-byte at-rest key');
  }

  private iso(now: number): string {
    return new Date(now * 1000).toISOString();
  }

  async registerClient(input: {
    client_slug: string;
    client_name: string;
    railway_url?: string | null;
    region?: string;
    plaintextToken: string;
    now: number;
  }): Promise<ClientRegistryRow> {
    if (this.registry.has(input.client_slug)) {
      throw new ManagementError(ERR_DUPLICATE_SLUG, `client_slug '${input.client_slug}' already registered (UNIQUE)`);
    }
    const row: ClientRegistryRow = {
      id: nextRowId(),
      client_slug: input.client_slug,
      client_name: input.client_name,
      railway_url: input.railway_url ?? null,
      internal_token: encryptToken(input.plaintextToken, this.encKey), // ENCRYPTED at rest (AC-10.MGT.001.3)
      token_id: newTokenId(),
      token_active: true,
      core_version: null,
      region: input.region ?? 'ap-southeast-2',
      status: 'initialising', // server-authoritative default (OD-162)
      created_at: this.iso(input.now),
      offboarding_initiated_at: null,
      offboarding_at: null,
    };
    this.registry.set(row.client_slug, row);
    return { ...row };
  }

  async getClientBySlug(slug: string): Promise<ClientRegistryRow | null> {
    const r = this.registry.get(slug);
    return r ? { ...r } : null;
  }
  async listClients(): Promise<ClientRegistryRow[]> {
    return [...this.registry.values()].map((r) => ({ ...r }));
  }

  async transitionStatus(slug: string, to: ClientStatus, now: number): Promise<ClientRegistryRow> {
    const row = this.registry.get(slug);
    if (!row) throw new ManagementError(ERR_NO_SUCH_CLIENT, `no client_registry row for '${slug}'`);
    if (row.status === to) return { ...row }; // idempotent no-op
    if (!ALLOWED_TRANSITIONS[row.status].includes(to)) {
      throw new ManagementError(
        ERR_BAD_TRANSITION,
        `status transition ${row.status} → ${to} is not allowed (server-authoritative lifecycle, FR-10.MGT.001)`,
      );
    }
    row.status = to;
    // Timestamp the lifecycle event (AC-10.MGT.001.2).
    if (to === 'offboarding') row.offboarding_initiated_at = this.iso(now);
    if (to === 'frozen') row.offboarding_at = this.iso(now);
    return { ...row };
  }

  async authenticate(bearer: string): Promise<ClientRegistryRow | null> {
    // A push presents its bearer token; we decrypt each stored token and compare. (The live adapter does this
    // as an indexed lookup on a token fingerprint; the fake mirrors the CONTRACT: active + matching only.)
    for (const row of this.registry.values()) {
      if (!row.token_active) continue; // revoked → can never authenticate (AC-10.MGT.004.3)
      let stored: string;
      try {
        stored = decryptToken(row.internal_token, this.encKey);
      } catch {
        continue; // corrupted at-rest token — never mis-authenticate on it (#2/#3)
      }
      if (constantTimeEqual(stored, bearer)) return { ...row };
    }
    return null;
  }

  async rotateToken(
    slug: string,
    dualUpdate: (newToken: string) => Promise<void>,
    now: number,
  ): Promise<RotationResult> {
    const row = this.registry.get(slug);
    if (!row) throw new ManagementError(ERR_NO_SUCH_CLIENT, `no client_registry row for '${slug}'`);
    const fresh = mintToken();
    const newId = newTokenId();
    // Update the mgmt DB copy FIRST (encrypted), then the Railway-env copy. If the Railway side throws we
    // have a PARTIAL: both stores must agree, so we surface it (ok:false) — push auth never SILENTLY breaks
    // (AC-10.MGT.004.2). We keep the new mgmt-side token (so a retry of the Railway side converges), and the
    // caller must act on ok:false (alert + retry), not ignore it.
    row.internal_token = encryptToken(fresh, this.encKey);
    row.token_id = newId;
    row.token_active = true;
    try {
      await dualUpdate(fresh);
    } catch (e) {
      return {
        slug,
        ok: false,
        new_token_id: newId,
        detail: `partial rotation: mgmt DB updated but Railway-env update failed (${(e as Error).message}) — SURFACED, push auth mismatch until reconciled`,
      };
    }
    return { slug, ok: true, new_token_id: newId, detail: 'both stores updated atomically' };
  }

  async revokeToken(slug: string, _now: number): Promise<void> {
    const row = this.registry.get(slug);
    if (!row) throw new ManagementError(ERR_NO_SUCH_CLIENT, `no client_registry row for '${slug}'`);
    row.token_active = false;
  }

  async ingest(input: {
    slug: string;
    snapshot: OperationalSnapshot;
    delivery_id: string;
    serverNow: number;
  }): Promise<IngestResult> {
    const row = this.registry.get(input.slug);
    if (!row) throw new ManagementError(ERR_NO_SUCH_CLIENT, `no client_registry row for '${input.slug}'`);

    // Idempotency: a replayed delivery_id is a no-op that still returns the current state (AC-10.MGT.002.x).
    const dkey = `${input.slug}::${input.delivery_id}`;
    const replayed = this.appliedDeliveries.has(dkey);
    if (replayed) {
      const existing = this.health.get(input.slug)!;
      return { client_slug: input.slug, core_version: row.core_version, health: { ...existing }, replayed: true };
    }
    this.appliedDeliveries.add(dkey);

    const nowIso = this.iso(input.serverNow);
    // The ingest updates client_registry.core_version (FR-10.MGT.002) — NOT status (server-authoritative).
    if (input.snapshot.core_version !== undefined) row.core_version = input.snapshot.core_version;

    // Upsert deployment_health (push-fed). last_push_at is the SERVER timestamp, never reporter-asserted.
    const prev = this.health.get(input.slug);
    const next: DeploymentHealthRow = {
      client_slug: input.slug,
      health_score: input.snapshot.health_score ?? prev?.health_score ?? null,
      queue_depth: input.snapshot.queue_depth ?? prev?.queue_depth ?? null,
      approval_queue_depth: input.snapshot.approval_queue_depth ?? prev?.approval_queue_depth ?? null,
      alert_counts: input.snapshot.alert_counts ?? prev?.alert_counts ?? null,
      core_version: input.snapshot.core_version ?? prev?.core_version ?? null,
      last_migrated_at: input.snapshot.last_migrated_at ?? prev?.last_migrated_at ?? null,
      connector_rollup: input.snapshot.connector_rollup ?? prev?.connector_rollup ?? null,
      cost_to_date: input.snapshot.cost_to_date ?? prev?.cost_to_date ?? null,
      plugin_version: input.snapshot.plugin_version ?? prev?.plugin_version ?? null,
      backup_health: input.snapshot.backup_health ?? prev?.backup_health ?? null,
      log_write_failing: input.snapshot.log_write_failing ?? prev?.log_write_failing ?? false,
      last_push_at: nowIso, // AF-120: server-authoritative
      updated_at: nowIso,
    };
    this.health.set(input.slug, next);
    return { client_slug: input.slug, core_version: row.core_version, health: { ...next }, replayed: false };
  }

  async getHealth(slug: string): Promise<DeploymentHealthRow | null> {
    const h = this.health.get(slug);
    return h ? { ...h } : null;
  }
  async listHealth(): Promise<DeploymentHealthRow[]> {
    return [...this.health.values()].map((h) => ({ ...h }));
  }

  // ── test-seam helpers (not part of the port) ──
  /** The raw stored (encrypted) token — a test asserts it is NOT the plaintext (AC-10.MGT.001.3). */
  _storedToken(slug: string): EncryptedToken | null {
    return this.registry.get(slug)?.internal_token ?? null;
  }
}

/** Constant-time string compare — a token check must not leak length/prefix via timing (#2). */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
