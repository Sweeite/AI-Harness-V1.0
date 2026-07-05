// ISSUE-046 — the LIVE PromptOptimisationStore adapter (pg, against the client-owned silo Supabase). It is
// the only module that imports `pg`. It implements the same port as InMemoryPromptOptimisationStore against
// the real DDL. It reads ISSUE-042's prompt_layers (id, version) identity and ISSUE-044's
// dynamic_field_values table; it OWNS neither (NO migration — this slice adds no table).
//
// ⚠️ NOT YET RUN LIVE. Per the ISSUE-046 offline-build boundary, the live silo proof (the fresh-read
// against real dynamic_field_values, the attribution capture against real prompt_layers ids) is a
// Stage-3-checkpoint / ISSUE-053-integration concern, run by the operator. This adapter is authored to the
// DDL so the seam is real and typechecks; InMemoryPromptOptimisationStore is the proven reference model. Do
// NOT claim these code paths verified until live evidence is recorded.
//
// KEY BOUNDARY (Rule 0): the OPT.001 completion/outcome RECORD lives in C5 task_queue / C7 event_log
// (ISSUE-053/011), NOT in a table this slice owns. Where the outcome persistence lands is C5's; the
// attribution-capture columns below are the required-fields contract C5 must satisfy at FR-5.ASM.002/009.
// The concrete DDL for the attribution columns is PROPOSED in results/opt001-attribution-columns.sql for
// the orchestrator to fold into C5 — this adapter is written to that proposed shape so the seam is legible.

import pg from 'pg';
import type {
  DynamicFieldValue,
  InjectedDynamicField,
  LayerSlot,
  OutcomeRecord,
  PromptOptimisationStore,
  VersionAttribution,
  VersionOutcomeBucket,
  VersionRef,
} from './store.js';
import { LAYER_SLOTS } from './store.js';

// The attribution is stored as one row per (task, slot) so distinct versions never conflate and the
// version-bucketed roll-up is a plain GROUP BY. See results/opt001-attribution-columns.sql (PROPOSAL) —
// the concrete home is a C5-owned table (ISSUE-053), keyed to task_queue(id).
const ATTR_TABLE = 'prompt_version_attribution';

function toVersionRef(r: Record<string, unknown>): VersionRef {
  return { version_id: String(r.version_id), version: Number(r.version) };
}

function isLayerSlot(s: string): s is LayerSlot {
  return (LAYER_SLOTS as readonly string[]).includes(s);
}

export class SupabasePromptOptimisationStore implements PromptOptimisationStore {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  // ── OPT.001 — version-to-outcome attribution ──
  async captureAttribution(attr: VersionAttribution): Promise<VersionAttribution> {
    const presentSlots = LAYER_SLOTS.filter((s) => attr.slots[s]);
    if (!attr.slots.core) {
      throw new Error(`attribution for task '${attr.task_id}' is missing the required core slot (FR-4.LYR.004)`);
    }
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      // Capture-once: a unique (task_id) guard at the DB rejects a second pin (FR-4.STO.006 / OD-050). We
      // assert none exists first so the error is the domain error, not a raw constraint violation.
      const existing = await client.query(`select 1 from ${ATTR_TABLE} where task_id = $1 limit 1`, [attr.task_id]);
      if ((existing.rowCount ?? 0) > 0) {
        throw new Error(
          `attribution for task '${attr.task_id}' already captured — the version pin is captured once at assembly and is immutable (FR-4.OPT.001 / OD-050)`,
        );
      }
      for (const slot of presentSlots) {
        const ref = attr.slots[slot]!;
        await client.query(
          `insert into ${ATTR_TABLE} (task_id, slot, version_id, version, captured_at)
           values ($1, $2, $3, $4, $5)`,
          [attr.task_id, slot, ref.version_id, ref.version, attr.captured_at],
        );
      }
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
    return attr;
  }

  async getAttribution(task_id: string): Promise<VersionAttribution | null> {
    const res = await this.pool.query(
      `select slot, version_id, version, captured_at from ${ATTR_TABLE} where task_id = $1`,
      [task_id],
    );
    if (res.rowCount === 0) return null;
    const slots: Partial<Record<LayerSlot, VersionRef>> = {};
    let captured_at = '';
    for (const r of res.rows) {
      const slot = String(r.slot);
      if (isLayerSlot(slot)) slots[slot] = toVersionRef(r);
      captured_at = r.captured_at instanceof Date ? r.captured_at.toISOString() : String(r.captured_at);
    }
    return { task_id, slots, captured_at };
  }

  async recordOutcome(rec: OutcomeRecord): Promise<OutcomeRecord> {
    // The outcome record itself is C5-owned (task_queue.completed_at / status + C7 event_log, ISSUE-053/011).
    // This adapter enforces the C4 contract: an outcome MUST carry a captured attribution or it is refused
    // (a versionless outcome is the lost signal #3 forbids). The write of the outcome proper is C5's — here
    // we only assert the attribution exists (the join key C5 records the outcome against).
    const attr = await this.pool.query(`select 1 from ${ATTR_TABLE} where task_id = $1 limit 1`, [rec.task_id]);
    if ((attr.rowCount ?? 0) === 0) {
      throw new Error(
        `cannot record an outcome for task '${rec.task_id}': no version attribution was captured at its assembly (FR-4.OPT.001 / #3)`,
      );
    }
    // Delegated to C5's outcome table (ISSUE-053). Left as the seam — this adapter does not own that table.
    return { ...rec };
  }

  async outcomesByVersion(slot?: LayerSlot): Promise<VersionOutcomeBucket[]> {
    // A plain GROUP BY over the (task,slot) attribution rows joined to C5's outcome table (ISSUE-053). The
    // outcome table name is C5-owned; this query is authored to the proposed join shape (results/…).
    const params: unknown[] = [];
    let slotFilter = '';
    if (slot) {
      params.push(slot);
      slotFilter = `where a.slot = $1`;
    }
    const res = await this.pool.query(
      `select a.slot, a.version_id, a.version,
              count(*)::int                                             as total,
              count(*) filter (where o.outcome = 'success')::int        as successes,
              count(*) filter (where o.outcome = 'failure')::int        as failures,
              avg(o.cost)                                               as mean_cost
       from ${ATTR_TABLE} a
       join task_outcome o on o.task_id = a.task_id
       ${slotFilter}
       group by a.slot, a.version_id, a.version`,
      params,
    );
    return res.rows
      .filter((r) => isLayerSlot(String(r.slot)))
      .map((r) => ({
        version_id: String(r.version_id),
        version: Number(r.version),
        slot: String(r.slot) as LayerSlot,
        total: Number(r.total),
        successes: Number(r.successes),
        failures: Number(r.failures),
        meanCost: r.mean_cost == null ? undefined : Number(r.mean_cost),
      }));
  }

  // ── OPT.002 — dynamic Layer-2 fresh injection ──
  async putDynamicField(field_name: string, field_value: string | null, now: number): Promise<DynamicFieldValue> {
    // Upsert into ISSUE-044's dynamic_field_values (schema §5) — the operator-editable per-deployment store.
    const res = await this.pool.query(
      `insert into dynamic_field_values (field_name, field_value, last_updated)
       values ($1, $2, $3)
       on conflict (field_name) do update set field_value = excluded.field_value, last_updated = excluded.last_updated
       returning field_name, field_value, last_updated`,
      [field_name, field_value, new Date(now * 1000).toISOString()],
    );
    const r = res.rows[0]!;
    return {
      field_name: String(r.field_name),
      field_value: r.field_value == null ? null : String(r.field_value),
      last_updated: r.last_updated instanceof Date ? r.last_updated.toISOString() : String(r.last_updated),
    };
  }

  async assembleDynamicLayer2(
    declaredFields: readonly string[],
    now: number,
    freshnessThresholdSeconds?: number,
  ): Promise<InjectedDynamicField[]> {
    // FRESH READ (AC-4.OPT.002.1): a live SELECT of the CURRENT values each call — no cached/baked snapshot.
    // An updated value is visible on the very next assembly with no redeploy/reboot.
    if (declaredFields.length === 0) return [];
    const res = await this.pool.query(
      `select field_name, field_value, last_updated from dynamic_field_values where field_name = any($1)`,
      [declaredFields],
    );
    const byName = new Map<string, { field_value: string | null; last_updated: string }>();
    for (const r of res.rows) {
      byName.set(String(r.field_name), {
        field_value: r.field_value == null ? null : String(r.field_value),
        last_updated: r.last_updated instanceof Date ? r.last_updated.toISOString() : String(r.last_updated),
      });
    }
    return declaredFields.map((field_name) => {
      const row = byName.get(field_name);
      const field_value = row?.field_value ?? null;
      const last_updated = row?.last_updated ?? new Date(0).toISOString();
      let stale = false;
      if (freshnessThresholdSeconds !== undefined) {
        stale = !row || now - Date.parse(row.last_updated) / 1000 > freshnessThresholdSeconds;
      }
      return { field_name, field_value, last_updated, stale };
    });
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
