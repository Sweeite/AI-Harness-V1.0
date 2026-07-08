// ISSUE-062 (C8 SPC) — the LIVE pg adapter (against the client-owned silo Supabase). The only module that imports
// `pg`. It implements the same SpecialistRegistry port as the in-memory reference model against the REAL baseline
// DDL (app/silo/migrations/0001_baseline.sql — `agents`, `tools`). The reject-at-write guard reuses the EXACT same
// pure kernel (evaluateToolsAllowed) as the fake — the ONLY difference is the class predicate is resolved from the
// live `tools` table instead of an in-memory map, so a test cannot pass offline while the live adapter would allow
// a forbidden grant.
//
// ⚠️ NOT YET RUN LIVE (R10). Authored to the DDL so the seam is real + typechecks; the in-memory reference model is
// the proven contract. Do NOT claim these paths verified until the live-adapter smoke records evidence.
//
// THE CLASS PREDICATE, LIVE: the three forbidden classes are NOT a stored column (schema §4 `tools`: category is
// only 'read'|'write'). This adapter reads a VERSION-CONTROLLED class tag from `tools.config->>'hard_limit_class'`
// (values: 'memory_write' | 'autonomous_send' | 'transaction'), the classification owned WITH C3 (FR-3.ACT.002/
// .004/.007) and part of the AF-068 battery. THIS TAG CONVENTION must be documented in C3 / schema §4 — see
// results/proposed-shared-spec.md (sharedSpecEdits): the memory-write tool (FR-3.ACT.007) MUST carry
// config.hard_limit_class='memory_write'.
//
// FAIL-CLOSED (the fix, not the old fail-open): because that tag is TODAY on no tool row, a naive "no tag ⇒
// non-forbidden" default would silently PERMIT granting an untagged memory-write tool to a non-Memory agent (#2) —
// the exact SPC.005.2 invariant this slice exists to enforce, invisible to the offline fake (whose map is
// populated). So the live guard uses `evaluateLiveGrant` (store.ts): a WRITE-category tool with no recognized class
// tag, or an id absent from `tools`, CANNOT be certified safe and is DENIED (UncertifiableCapabilityGrant), never
// defaulted to allowed. Read-category untagged tools are provably non-forbidden and pass. Once the tag convention +
// the seeded memory-write tag ship, the recognized-class path resolves it precisely; until then no write grant the
// classifier cannot prove benign is permitted.
//
// #1/#2/#3: an edit that passes the guard INSERTs a new agents version (append-only — the prior row is never
// UPDATEd/DELETEd, mirroring the C8 agents version chain); a rejected edit writes the reason to the injected
// RejectionLog sink (never-silent) and throws BEFORE any write to `agents` lands.

import pg from 'pg';
import {
  ERR_EMPTY_CHANGE_REASON,
  ERR_UNKNOWN_ROLE,
  ForbiddenCapabilityGrant,
  UncertifiableCapabilityGrant,
  evaluateLiveGrant,
  type LiveToolRow,
  type RejectionLog,
  type SpecialistDef,
  type SpecialistRegistry,
} from './store.ts';
import { SPECIALIST_CONTRACTS, SPECIALIST_ROLES, type SpecialistRole } from './specialists.ts';

/** The `tools.config` key carrying the version-controlled hard-limit class tag (owned with C3; sharedSpecEdits). */
export const TOOL_CLASS_CONFIG_KEY = 'hard_limit_class' as const;

/** RFC-4122 canonical uuid form — the shape `agents.tools_allowed uuid[]` / `tools.id uuid` accept. A tool id that
 * is not a uuid cannot be a row in `tools`, so it cannot be classified — the live guard treats it as unknown_tool
 * (fail-closed) rather than letting `$1::uuid[]` throw a raw pg parse error over the whole batch. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A minimal query seam so the adapter is unit-testable against a fake `tools`/`agents` without a live pool. */
export type QueryExec = <R extends pg.QueryResultRow>(
  text: string,
  params?: unknown[],
) => Promise<{ rows: R[] }>;

function isRole(role: string): role is SpecialistRole {
  return (SPECIALIST_ROLES as readonly string[]).includes(role);
}

interface RawAgent {
  id: string;
  name: string;
  memory_scope: unknown;
  tools_allowed: string[];
  max_tokens: number | null;
  enabled: boolean;
  version: number;
  change_reason: string;
  description: string;
  created_by: string | null;
  updated_at: string;
}

export class SupabaseSpecialistRegistry implements SpecialistRegistry {
  private pool: pg.Pool | null = null;
  private readonly exec: QueryExec;
  constructor(
    connectionString: string,
    private readonly deps: { rejections?: RejectionLog; queryExec?: QueryExec } = {},
  ) {
    if (deps.queryExec) {
      this.exec = deps.queryExec;
    } else {
      const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
      const pool = new pg.Pool({ connectionString, ssl });
      this.pool = pool;
      this.exec = (text, params) => pool.query(text, params);
    }
  }

  /** The CURRENT (latest, no-successor) agents row for a specialist name. */
  private async currentByName(role: string): Promise<RawAgent | null> {
    const res = await this.exec<RawAgent>(
      `select a.id, a.name, a.memory_scope, a.tools_allowed, a.max_tokens, a.enabled, a.version,
              a.change_reason, a.description, a.created_by, a.updated_at
         from agents a
        where a.name = $1
          and not exists (select 1 from agents b where b.previous_version_id = a.id)
        order by a.version desc
        limit 1`,
      [role],
    );
    return res.rows[0] ?? null;
  }

  async getByRole(role: SpecialistRole): Promise<SpecialistDef | null> {
    const cur = await this.currentByName(role);
    if (!cur) return null;
    return {
      role,
      domain: SPECIALIST_CONTRACTS[role].domain,
      tools_allowed: cur.tools_allowed ?? [],
      version: cur.version,
      change_reason: cur.change_reason,
      // The PERSISTED column — not wall-clock. Reflects the real DB row (deterministic; caller-now on guard writes).
      updated_at: new Date(cur.updated_at).toISOString(),
    };
  }

  /** Fetch the `tools` rows for exactly the proposed ids (id + coarse category + the hard_limit_class tag). One
   * query. Non-uuid ids are NOT sent to `$1::uuid[]` (they'd throw a raw pg parse error over the whole batch); they
   * simply never appear in the result, so the fail-closed kernel treats them as unknown_tool. Returns LiveToolRows
   * for `evaluateLiveGrant` — the FAIL-CLOSED kernel (an untagged write id is denied, not defaulted to allowed). */
  private async liveToolRows(toolIds: readonly string[]): Promise<LiveToolRow[]> {
    const uuids = toolIds.filter((id) => UUID_RE.test(id));
    if (uuids.length === 0) return [];
    const res = await this.exec<{ id: string; category: string; klass: string | null }>(
      `select id::text as id, category::text as category, config->>'${TOOL_CLASS_CONFIG_KEY}' as klass
         from tools where id = any($1::uuid[])`,
      [uuids],
    );
    return res.rows.map((r) => ({ id: r.id, category: r.category, klass: r.klass }));
  }

  async setToolsAllowed(
    role: SpecialistRole,
    toolsAllowed: string[],
    change_reason: string,
    actorId: string,
    now: number,
  ): Promise<SpecialistDef> {
    if (!isRole(role)) throw new Error(ERR_UNKNOWN_ROLE(role));
    if (typeof change_reason !== 'string' || change_reason.trim().length === 0) {
      throw new Error(ERR_EMPTY_CHANGE_REASON);
    }
    // THE reject-at-write invariant — classify from the LIVE tools table, evaluate the FAIL-CLOSED kernel, deny
    // BEFORE any write to `agents`. Fires regardless of caller role (a negative invariant on the data — independent
    // of OD-080). A write tool the live classifier cannot certify (no hard_limit_class tag / absent from `tools`) is
    // DENIED, never defaulted to allowed — closing the live fail-open the offline reference cannot see (#2).
    const verdict = evaluateLiveGrant(role, toolsAllowed, await this.liveToolRows(toolsAllowed));
    if (!verdict.ok) {
      if ('forbidden' in verdict) {
        const bad = verdict.forbidden;
        this.deps.rejections?.logRejection(
          { role: bad.role, tool_id: bad.tool_id, tool_class: bad.tool_class, reason: bad.reason, actor_id: actorId },
          now,
        );
        throw new ForbiddenCapabilityGrant(bad);
      }
      const u = verdict.uncertifiable;
      this.deps.rejections?.logRejection(
        { role: u.role, tool_id: u.tool_id, tool_class: u.kind, reason: u.reason, actor_id: actorId },
        now,
      );
      throw new UncertifiableCapabilityGrant(u);
    }

    const cur = await this.currentByName(role);
    if (!cur) throw new Error(ERR_UNKNOWN_ROLE(role));
    // Append a new agents version (INSERT, never UPDATE) — #1 append-only, mirroring the C8 version chain. Every
    // column is carried forward; only tools_allowed + change_reason + version change. created_at/updated_at are set
    // from the caller-supplied `now` (house discipline; deterministic) so the persisted row == the returned value.
    const iso = new Date(now * 1000).toISOString();
    const res = await this.exec<RawAgent>(
      `insert into agents (name, description, memory_scope, tools_allowed, max_tokens, enabled, version,
         previous_version_id, change_reason, created_by, created_at, updated_at)
       values ($1, $2, $3::jsonb, $4::uuid[], $5, $6, $7, $8, $9, $10, $11, $11)
       returning id, name, memory_scope, tools_allowed, max_tokens, enabled, version, change_reason, description,
                 created_by, updated_at`,
      [
        cur.name,
        cur.description,
        JSON.stringify(cur.memory_scope),
        toolsAllowed,
        cur.max_tokens,
        cur.enabled,
        cur.version + 1,
        cur.id,
        change_reason,
        cur.created_by,
        iso,
      ],
    );
    const next = res.rows[0]!;
    return {
      role,
      domain: SPECIALIST_CONTRACTS[role].domain,
      tools_allowed: next.tools_allowed ?? [],
      version: next.version,
      change_reason: next.change_reason,
      updated_at: new Date(next.updated_at).toISOString(),
    };
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }
}

export { SupabaseSpecialistRegistry as default };
