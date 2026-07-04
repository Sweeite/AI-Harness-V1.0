// ISSUE-006 §8 (sinks) — faithful in-memory models of the four schema tables the verifier reads and
// writes, matching the DDL columns in the issue (schema.md §1 Identity&Auth, §7 Guardrails,
// §8 Observability). In-memory because §5 scopes the durable write path to ISSUE-017; the spike
// reproduces the SHAPE + the invariants the battery reads against, and nothing more.
//
// Invariants enforced in code exactly as the DB check/trigger would:
//   1. guardrail_log is APPEND-ONLY (no delete; forward-only).
//   2. a `hard_limit` guardrail_log row can never be `approved` (schema CHECK).
//   3. webhook_replay_cache PK is (connector_type, event_id) — a duplicate insert is a REPLAY.

export type Connector = 'ghl' | 'google' | 'slack';

// ── webhook_secrets ──────────────────────────────────────────────────────────────
// The verifier reads the GHL public key + Slack signing secret + Google expected-audience from HERE,
// never inline (CRITICAL RULE 2). Seeded from generated material (MODE M) or operator env (MODE R).
export type SecretKind = 'ed25519_public_key' | 'hmac_signing_secret' | 'expected_audience';

export interface WebhookSecretRow {
  id: string;
  connector: Connector;
  secret_kind: SecretKind;
  secret_value: string;
  secret_version: number;
  active: boolean;
  rotated_at: string | null;
  created_at: string;
}

// ── webhook_replay_cache ─────────────────────────────────────────────────────────
export interface ReplayCacheRow {
  event_id: string;
  connector_type: Connector;
  source_id: string | null;
  seen_at: number; // epoch seconds (logical)
  window_expires_at: number; // epoch seconds
}

// ── guardrail_log ────────────────────────────────────────────────────────────────
// Append-only; type `prompt_injection` on every failed verify (ADR-007). CHECK: hard_limit row
// never `approved`.
export type GuardrailType = 'prompt_injection' | 'hard_limit' | 'approval' | 'rate_limit' | 'anomaly';
export type GuardrailStatus = 'pending' | 'approved' | 'rejected' | 'modified';

export interface GuardrailLogRow {
  id: string;
  task_id: string | null;
  guardrail_type: GuardrailType;
  description: string;
  action_blocked: boolean;
  status: GuardrailStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  escalated_at: string | null;
  created_at: string;
}

// ── event_log ────────────────────────────────────────────────────────────────────
// verified-accept + replay-drop rows.
export interface EventLogRow {
  id: string;
  task_id: string | null;
  event_type: string; // 'webhook_verified_accept' | 'webhook_replay_drop'
  entity_ids: string[];
  summary: string;
  payload: unknown;
  duration_ms: number | null;
  cost_tokens: number | null;
  cost_unknown: boolean;
  answer_mode: string | null;
  created_at: string;
}

export class Sinks {
  private seq = 0;
  readonly webhookSecrets: WebhookSecretRow[] = [];
  readonly replayCache: ReplayCacheRow[] = [];
  readonly guardrailLog: GuardrailLogRow[] = [];
  readonly eventLog: EventLogRow[] = [];
  // A "downstream task" surface: proving NO task is created on a rejected verify (AC-NFR-SEC.008.1).
  readonly downstreamTasks: { id: string; connector: Connector; note: string }[] = [];

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(4, '0')}`;
  }
  private stamp(): string {
    return `t+${String(this.seq).padStart(4, '0')}`;
  }

  // ── webhook_secrets ──
  seedSecret(row: Omit<WebhookSecretRow, 'id' | 'created_at' | 'rotated_at'>): WebhookSecretRow {
    const full: WebhookSecretRow = {
      id: this.nextId('ws'),
      created_at: this.stamp(),
      rotated_at: null,
      ...row,
    };
    this.webhookSecrets.push(full);
    return full;
  }
  readSecret(connector: Connector, kind: SecretKind): string {
    const row = this.webhookSecrets.find(
      (r) => r.connector === connector && r.secret_kind === kind && r.active,
    );
    if (!row) {
      throw new Error(`no active webhook_secrets row for ${connector}/${kind} — verifier cannot read its key`);
    }
    return row.secret_value;
  }

  // ── guardrail_log (append-only) ──
  logGuardrail(
    row: Omit<GuardrailLogRow, 'id' | 'created_at' | 'reviewed_by' | 'reviewed_at' | 'escalated_at'> &
      Partial<Pick<GuardrailLogRow, 'escalated_at'>>,
  ): GuardrailLogRow {
    if (row.guardrail_type === 'hard_limit' && row.status === 'approved') {
      throw new Error('INVARIANT VIOLATION: hard_limit guardrail_log row cannot be approved (schema CHECK)');
    }
    const full: GuardrailLogRow = {
      id: this.nextId('gl'),
      created_at: this.stamp(),
      reviewed_by: null,
      reviewed_at: null,
      escalated_at: row.escalated_at ?? null,
      ...row,
    };
    this.guardrailLog.push(full);
    return full;
  }

  // ── event_log ──
  logEvent(
    row: Omit<
      EventLogRow,
      'id' | 'created_at' | 'duration_ms' | 'cost_tokens' | 'cost_unknown' | 'answer_mode'
    > &
      Partial<Pick<EventLogRow, 'duration_ms' | 'cost_tokens' | 'cost_unknown' | 'answer_mode'>>,
  ): EventLogRow {
    const full: EventLogRow = {
      id: this.nextId('ev'),
      created_at: this.stamp(),
      duration_ms: row.duration_ms ?? null,
      cost_tokens: row.cost_tokens ?? null,
      cost_unknown: row.cost_unknown ?? false,
      answer_mode: row.answer_mode ?? null,
      ...row,
    };
    this.eventLog.push(full);
    return full;
  }

  // ── downstream task (the thing that must NOT happen on reject) ──
  createDownstreamTask(connector: Connector, note: string): void {
    this.downstreamTasks.push({ id: this.nextId('task'), connector, note });
  }

  // ── webhook_replay_cache ──
  // Returns true if the (connector, event_id) is a REPLAY (already seen within its window); records
  // it as newly-seen otherwise. `now` is a logical clock (epoch seconds).
  recordOrDetectReplay(
    connector: Connector,
    eventId: string,
    sourceId: string | null,
    now: number,
    windowSeconds: number,
  ): { replay: boolean } {
    // Purge expired entries first (a seen-ID outside its window is no longer a replay).
    for (let i = this.replayCache.length - 1; i >= 0; i--) {
      if (this.replayCache[i].window_expires_at <= now) this.replayCache.splice(i, 1);
    }
    const existing = this.replayCache.find(
      (r) => r.connector_type === connector && r.event_id === eventId,
    );
    if (existing) return { replay: true };
    this.replayCache.push({
      event_id: eventId,
      connector_type: connector,
      source_id: sourceId,
      seen_at: now,
      window_expires_at: now + windowSeconds,
    });
    return { replay: false };
  }
}
