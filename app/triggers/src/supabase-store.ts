// ISSUE-047 — the LIVE pg adapter for the TriggerStore port. Authored to the schema.md DDL; it is the
// reference model (InMemoryTriggerStore) realised against the real silo. NOT exercised by the offline suite —
// its behaviour is proven by the ISSUE-047 live capstone, above all the AF-135 freeze-propagation SPIKE
// (freeze a test deployment; attempt event / scheduled / manual / chained dispatch; confirm each is blocked
// + logged, and a status-resolution ambiguity fails closed). Every method mirrors an InMemory method 1:1.
//
// Schema faithfulness:
//   - readDeploymentSettings: single-row LOCAL read of this client's own deployment_settings (OD-162). NO
//     cross-deployment / management-plane query — a missing row is itself an ambiguity => the caller fails
//     closed (evaluateFreeze treats a throw as frozen). schema.md §14.
//   - insertTask: writes ONLY type + task_name + payload + originating_user_id (+ parent provenance in
//     `payload._parent_task_id`, since parent linkage lives in the envelope until ISSUE-048 finalises the
//     column set). `type` is cast to the `task_type` enum, so a bad value is rejected by the DB. schema.md §6.
//   - appendEvent: append-only insert into event_log via the C7 sink. `event_type` is cast to the enum — the
//     two values this slice emits (dispatch_frozen_blocked / ingest_failure) are the proposed additive delta
//     in results/; until that migration lands the cast fails loudly (never a silent skip). schema.md §8.
//   - isDelivered / markDelivered: the at-least-once delivery watermark. Modelled on a `trigger_delivery`
//     watermark table (proposed in results/, owned for the live build by ISSUE-049's idempotency store); the
//     adapter is authored to that shape so the seam is real, not stubbed.

import type { Pool } from 'pg';
import {
  type TriggerStore,
  type TaskRow,
  type TaskType,
  type DeploymentSettingsRow,
  type EventRow,
} from './store.ts';

export class SupabaseTriggerStore implements TriggerStore {
  constructor(private pool: Pool) {}

  async readDeploymentSettings(): Promise<DeploymentSettingsRow> {
    // LOCAL single-row read (OD-162). A missing row => throw => evaluateFreeze fails closed (ambiguity).
    const { rows } = await this.pool.query<DeploymentSettingsRow>(
      `select frozen_at, frozen_reason from deployment_settings limit 1`,
    );
    const row = rows[0];
    if (!row) {
      throw new Error('deployment_settings has no row — freeze status unresolvable (fail closed)');
    }
    return { frozen_at: row.frozen_at, frozen_reason: row.frozen_reason };
  }

  async insertTask(row: {
    type: TaskType;
    task_name: string;
    payload: Record<string, unknown>;
    originating_user_id: string | null;
    parent_task_id: string | null;
  }): Promise<TaskRow> {
    // Chained provenance travels in the payload until ISSUE-048 finalises task_queue's column set.
    const payload =
      row.parent_task_id !== null ? { ...row.payload, _parent_task_id: row.parent_task_id } : { ...row.payload };
    const { rows } = await this.pool.query<{ id: string; created_at: string }>(
      `insert into task_queue (type, task_name, payload, originating_user_id)
         values ($1::task_type, $2, $3::jsonb, $4)
         returning id, created_at`,
      [row.type, row.task_name, JSON.stringify(payload), row.originating_user_id],
    );
    const inserted = rows[0]!;
    return {
      id: inserted.id,
      type: row.type,
      task_name: row.task_name,
      payload,
      originating_user_id: row.originating_user_id,
      parent_task_id: row.parent_task_id,
      created_at: inserted.created_at,
    };
  }

  async appendEvent(row: EventRow): Promise<void> {
    // Append-only C7 sink write. event_type cast to the enum — the additive delta in results/ must be applied
    // first; until then this cast raises (loud, never a silent skip — #3).
    await this.pool.query(
      `insert into event_log (task_id, event_type, summary, payload)
         values ($1, $2::event_type, $3, $4::jsonb)`,
      [row.task_id, row.event_type, row.summary, JSON.stringify(row.payload)],
    );
  }

  async isDelivered(deliveryId: string): Promise<boolean> {
    // The delivery watermark (FR-5.TRG.005 / FR-5.GRP.003 seam). trigger_delivery is proposed in results/;
    // for the live build ISSUE-049 owns the idempotency store this reads.
    const { rows } = await this.pool.query<{ exists: boolean }>(
      `select exists(select 1 from trigger_delivery where delivery_id = $1) as exists`,
      [deliveryId],
    );
    return rows[0]?.exists ?? false;
  }

  async markDelivered(deliveryId: string, taskId: string): Promise<void> {
    // Watermark ONLY after a committed task row (the caller enforces order). on conflict do nothing keeps the
    // watermark idempotent under at-least-once re-delivery.
    await this.pool.query(
      `insert into trigger_delivery (delivery_id, task_id) values ($1, $2)
         on conflict (delivery_id) do nothing`,
      [deliveryId, taskId],
    );
  }
}
