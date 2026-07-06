// ISSUE-077 §8 steps 4-6 — the C7 side of the management plane (FR-7.MGM.001–005). This slice OWNS the
// reporter allow-list enforcement + the read contract of the cross-deployment views. The mgmt-plane ingest
// endpoint / client_registry / deployment_health WRITES are ISSUE-012 (@harness/management) — this reporter
// PUSHES to that endpoint; these view contracts READ that registry. Because the offline workspace has no
// cross-package module resolution, the shapes below are authored faithful to schema.md §13 (the single
// authoritative field list) and ADR-001 §7 (the confirming rationale) — kept in lockstep with the ISSUE-012
// allow-list (a check-time parity gate in index.ts asserts they match).
//
// AF-118 (independent-heartbeat evaluator that cannot itself fail silently) + AF-120 (server-authoritative
// clock) are GREEN from Stage 2 and are modelled faithfully here — they gate FR-7.MGM.002.

// ── The operational-metadata allow-list (ADR-001 §7 / schema.md §13 deployment_health) ────────────────
//
// deny-by-default: the ONLY keys a health-reporter snapshot may carry across the silo→mgmt boundary. Anything
// else is business data by construction and is rejected. Canonical = the schema.md §13 deployment_health column
// set + client_registry.core_version (per §8 build note).
export const OPERATIONAL_METADATA_FIELDS = [
  "health_score",
  "queue_depth",
  "approval_queue_depth",
  "alert_counts",
  "core_version",
  "last_migrated_at",
  "connector_rollup",
  "cost_to_date",
  "plugin_version",
  "backup_health",
  "log_write_failing",
] as const;
export type OperationalField = (typeof OPERATIONAL_METADATA_FIELDS)[number];
const ALLOWED = new Set<string>(OPERATIONAL_METADATA_FIELDS);

export interface OperationalSnapshot {
  health_score?: number;
  queue_depth?: number;
  approval_queue_depth?: number;
  alert_counts?: Record<string, number>;
  core_version?: string;
  last_migrated_at?: string;
  connector_rollup?: Record<string, unknown>;
  cost_to_date?: number;
  plugin_version?: string;
  backup_health?: Record<string, unknown>;
  log_write_failing?: boolean;
}

export class BusinessDataAtBoundaryError extends Error {
  constructor(public offending: string[]) {
    super(
      `management-plane boundary: payload carries non-operational field(s) [${offending.join(", ")}] — business ` +
        `data may never cross the boundary (ADR-001 §7 / #2)`,
    );
    this.name = "BusinessDataAtBoundaryError";
  }
}

/** The non-allow-listed (business-data) keys in a payload, in input order. Empty ⇒ clean. */
export function offendingFields(payload: Record<string, unknown>): string[] {
  return Object.keys(payload).filter((k) => !ALLOWED.has(k));
}

/** Reduce a payload to ONLY its allow-listed operational fields (the reporter ASSEMBLES with this — a
 *  business-data field is dropped before send, AC-7.MGM.001.1). */
export function pickOperational(payload: Record<string, unknown>): OperationalSnapshot {
  const out: Record<string, unknown> = {};
  for (const f of OPERATIONAL_METADATA_FIELDS) if (f in payload && payload[f] !== undefined) out[f] = payload[f];
  return out as OperationalSnapshot;
}

/** REJECT a payload carrying any business-data field (the ingest boundary — it refuses, never silently drops). */
export function assertOperationalOnly(payload: Record<string, unknown>): OperationalSnapshot {
  const bad = offendingFields(payload);
  if (bad.length > 0) throw new BusinessDataAtBoundaryError(bad);
  return payload as OperationalSnapshot;
}

// ── The outbound health-reporter (FR-7.MGM.001) — runs INSIDE each deployment ─────────────────────────

export type PushTrigger = "interval" | "event";

/** The deployment-LOCAL append-only event_log this reporter WRITES its push attempts/failures to (AC-7.MGM.001.3). */
export interface LocalPushLog {
  append(entry: { event_type: string; level: "info" | "warn" | "error"; detail: string; at: number }): void;
}

export class InMemoryLocalPushLog implements LocalPushLog {
  readonly entries: Array<{ event_type: string; level: string; detail: string; at: number }> = [];
  append(entry: { event_type: string; level: "info" | "warn" | "error"; detail: string; at: number }): void {
    this.entries.push({ ...entry });
  }
}

/** The transport that POSTs to the ISSUE-012 ingest. Returns accept/reject; throws on an unreachable plane. */
export interface IngestTransport {
  post(body: { bearer: string; payload: OperationalSnapshot; delivery_id: string }): Promise<{ accepted: boolean; detail: string }>;
}

export interface PushOutcome {
  attempted: true;
  accepted: boolean;
  trigger: PushTrigger;
  delivery_id: string;
  detail: string;
  dropped_business_fields: string[]; // fields stripped before send (proves the allow-list acted, AC-7.MGM.001.1)
}

let __delivery = 0;
const nextDeliveryId = (): string => `push-${String(++__delivery).padStart(6, "0")}`;

/** Assemble + push ONE operational-metadata snapshot. rawMetrics may contain anything the deployment knows;
 *  pickOperational strips it to the allow-list BEFORE send (a business-data key never leaves the silo,
 *  AC-7.MGM.001.1). Every attempt AND every failure is logged LOCALLY (AC-7.MGM.001.3). Push, never pull
 *  (AC-7.MGM.001.2) — there is no read-back path here; the reporter only ever POSTs. */
export async function pushHealthSnapshot(
  rawMetrics: Record<string, unknown>,
  bearer: string,
  transport: IngestTransport,
  localLog: LocalPushLog,
  trigger: PushTrigger,
  at: number,
): Promise<PushOutcome> {
  const dropped = offendingFields(rawMetrics);
  const snapshot = pickOperational(rawMetrics);
  const delivery_id = nextDeliveryId();

  localLog.append({
    event_type: "health_push.attempt",
    level: "info",
    detail:
      `outbound health push (${trigger}); delivery=${delivery_id}` +
      (dropped.length ? `; dropped non-operational field(s) before send: [${dropped.join(", ")}]` : ""),
    at,
  });

  try {
    const res = await transport.post({ bearer, payload: snapshot, delivery_id });
    if (!res.accepted) {
      localLog.append({
        event_type: "health_push.failure",
        level: "warn",
        detail: `management plane rejected the push (delivery=${delivery_id}): ${res.detail}`,
        at,
      });
      return { attempted: true, accepted: false, trigger, delivery_id, detail: res.detail, dropped_business_fields: dropped };
    }
    return { attempted: true, accepted: true, trigger, delivery_id, detail: res.detail, dropped_business_fields: dropped };
  } catch (e) {
    // Transport failure — the plane is UNREACHABLE. Exactly the condition that must not be invisible: log it
    // locally so the deployment's OWN dashboard shows it, not only (invisibly) by absence on the grid.
    localLog.append({
      event_type: "health_push.failure",
      level: "error",
      detail: `management plane UNREACHABLE (delivery=${delivery_id}): ${(e as Error).message}`,
      at,
    });
    return {
      attempted: true,
      accepted: false,
      trigger,
      delivery_id,
      detail: `unreachable: ${(e as Error).message}`,
      dropped_business_fields: dropped,
    };
  }
}

// ── The push-staleness detector (FR-7.MGM.002 + NFR-OBS.006; AF-118 + AF-120) ─────────────────────────

export type ClientStatus = "initialising" | "active" | "offboarding" | "frozen";

/** A client_registry projection (schema.md §13) — server-authoritative status (frozen ≠ dead). */
export interface RegistryCard {
  client_slug: string;
  client_name: string;
  status: ClientStatus;
  railway_url: string | null;
  core_version: string | null;
}

/** A deployment_health projection (schema.md §13) — push-fed operational metadata only. `last_push_at` is
 *  STORE-stamped at ingest on server time (AF-120), never reporter-asserted. */
export interface HealthCard {
  client_slug: string;
  health_score: number | null;
  queue_depth: number | null;
  approval_queue_depth: number | null;
  alert_counts: Record<string, number> | null;
  core_version: string | null;
  last_migrated_at: string | null;
  plugin_version: string | null;
  cost_to_date: number | null;
  backup_health: Record<string, unknown> | null;
  log_write_failing: boolean;
  last_push_at: string; // ISO-8601, server-authoritative
}

export type Liveness = "fresh" | "stale" | "unreachable" | "frozen-quiet" | "never-reported";

export interface CardLiveness {
  client_slug: string;
  liveness: Liveness;
  status: ClientStatus;
  last_push_at: string | null;
  age_seconds: number | null; // serverNow − last_push_at on server-authoritative time (AF-120)
  alert: boolean; // true ⇒ a cross-deployment alert is raised (never a silent green)
  detail: string;
}

function ageSeconds(lastPushAtIso: string, serverNow: number): number {
  // serverNow is epoch seconds (server-authoritative); last_push_at was store-stamped on server time too, so
  // this subtraction is skew-free (AF-120) — no reporter clock enters the computation.
  return Math.max(0, serverNow - Math.floor(Date.parse(lastPushAtIso) / 1000));
}

/** Evaluate one deployment's liveness against a server-authoritative clock (AF-120). A snapshot older than
 *  windowSeconds flips to stale (AC-7.MGM.002.1) and raises a cross-deployment alert (AC-7.MGM.002.2); a frozen
 *  silo reads intentionally quiet, not dead. */
export function evaluateLiveness(
  registry: RegistryCard,
  health: HealthCard | null,
  serverNow: number,
  windowSeconds: number,
  unreachableFactor = 2,
): CardLiveness {
  const base = { client_slug: registry.client_slug, status: registry.status, last_push_at: health?.last_push_at ?? null };

  if (registry.status === "frozen") {
    return {
      ...base,
      liveness: "frozen-quiet",
      age_seconds: health ? ageSeconds(health.last_push_at, serverNow) : null,
      alert: false,
      detail: "client_registry.status=frozen — intentionally quiet (retention-freeze), not a dead deployment",
    };
  }
  if (!health) {
    return { ...base, liveness: "never-reported", age_seconds: null, alert: true, detail: "no snapshot ever received — surfaced, not rendered healthy" };
  }
  const age = ageSeconds(health.last_push_at, serverNow);
  if (age <= windowSeconds) return { ...base, liveness: "fresh", age_seconds: age, alert: false, detail: `fresh (age ${age}s ≤ window ${windowSeconds}s)` };
  if (age <= windowSeconds * unreachableFactor)
    return { ...base, liveness: "stale", age_seconds: age, alert: true, detail: `STALE (age ${age}s > window ${windowSeconds}s) — cross-deployment alert raised, not a carried-forward green` };
  return { ...base, liveness: "unreachable", age_seconds: age, alert: true, detail: `UNREACHABLE (age ${age}s > ${windowSeconds * unreachableFactor}s) — cross-deployment alert raised` };
}

export interface SweepRecord {
  ran_at: number;
  evaluated: number;
  alerts_raised: number;
}

/** AF-118 — the independent-heartbeat evaluator that cannot itself fail silently. The sweep records each run;
 *  a meta-check confirms the evaluator is alive — if the last sweep is older than its heartbeat window, THAT is
 *  a surfaced meta-staleness alert, so the stale-detector cannot go dark unnoticed (AC-7.MGM.002.3). */
export class StalenessEvaluator {
  private lastSweepAt: number | null = null;
  readonly sweeps: SweepRecord[] = [];

  sweep(
    fleet: Array<{ registry: RegistryCard; health: HealthCard | null }>,
    serverNow: number,
    windowSeconds: number,
  ): { cards: CardLiveness[]; sweep: SweepRecord } {
    const cards = fleet.map((f) => evaluateLiveness(f.registry, f.health, serverNow, windowSeconds));
    const rec: SweepRecord = { ran_at: serverNow, evaluated: cards.length, alerts_raised: cards.filter((c) => c.alert).length };
    this.lastSweepAt = serverNow;
    this.sweeps.push(rec);
    return { cards, sweep: rec };
  }

  /** Is the EVALUATOR ITSELF alive? If the last sweep is older than heartbeatWindow (or it never ran), the
   *  detector has gone dark — a surfaced meta-staleness alert (AF-118). */
  evaluatorLiveness(serverNow: number, heartbeatWindowSeconds: number): { alive: boolean; alert: boolean; detail: string } {
    if (this.lastSweepAt === null) return { alive: false, alert: true, detail: "staleness evaluator has never run — meta-staleness alert (AF-118)" };
    const age = serverNow - this.lastSweepAt;
    if (age > heartbeatWindowSeconds)
      return { alive: false, alert: true, detail: `staleness evaluator STALLED (last sweep ${age}s ago > heartbeat window ${heartbeatWindowSeconds}s) — meta-staleness alert (AF-118)` };
    return { alive: true, alert: false, detail: `evaluator alive (last sweep ${age}s ago)` };
  }
}

// ── Cross-deployment read contracts (FR-7.MGM.003/004/005) — data only; screens are ISSUE-078 ─────────

/** FR-7.MGM.003 — health grid: one card per active deployment, sourcing ONLY operational metadata; click-through
 *  routes INTO the client deployment (never a mgmt-plane data mirror, AC-7.MGM.003.2). */
export interface HealthGridCard {
  client_slug: string;
  client_name: string;
  health_score: number | null;
  last_active: string | null; // = last_push_at
  open_alerts: number; // = sum of alert_counts
  approval_queue_depth: number | null;
  core_version: string | null;
  liveness: Liveness;
  click_through_url: string | null; // route into the CLIENT's own deployment under ITS RBAC (never mgmt data)
}

function sumAlerts(counts: Record<string, number> | null): number {
  if (!counts) return 0;
  return Object.values(counts).reduce((a, b) => a + (b || 0), 0);
}

export function healthGridCard(registry: RegistryCard, health: HealthCard | null, liveness: CardLiveness): HealthGridCard {
  return {
    client_slug: registry.client_slug,
    client_name: registry.client_name,
    health_score: health?.health_score ?? null,
    last_active: health?.last_push_at ?? null,
    open_alerts: sumAlerts(health?.alert_counts ?? null),
    approval_queue_depth: health?.approval_queue_depth ?? null,
    core_version: health?.core_version ?? registry.core_version ?? null,
    liveness: liveness.liveness,
    click_through_url: registry.railway_url, // AC-7.MGM.003.2 — navigates into the client deployment
  };
}

/** FR-7.MGM.004 — cross-deployment alerts + CI/CD status. */
export interface CrossDeploymentAlert {
  client_slug: string;
  kind: string;
  count: number;
  detail: string;
}
export interface CiCdRow {
  client_slug: string;
  core_version: string | null;
  last_migrated_at: string | null;
  plugin_version: string | null;
  last_push_at: string | null;
  push_failing: boolean; // derived from liveness (stale/unreachable/never-reported ⇒ last push failed to land)
}

export function crossDeploymentAlerts(fleet: Array<{ health: HealthCard | null; liveness: CardLiveness }>): CrossDeploymentAlert[] {
  const out: CrossDeploymentAlert[] = [];
  for (const f of fleet) {
    for (const [kind, count] of Object.entries(f.health?.alert_counts ?? {})) {
      if (count > 0) out.push({ client_slug: f.liveness.client_slug, kind, count, detail: `${count} ${kind} alert(s)` });
    }
    if (f.liveness.alert) out.push({ client_slug: f.liveness.client_slug, kind: f.liveness.liveness, count: 1, detail: f.liveness.detail });
  }
  return out;
}

export function ciCdRow(registry: RegistryCard, health: HealthCard | null, liveness: CardLiveness): CiCdRow {
  return {
    client_slug: registry.client_slug,
    core_version: health?.core_version ?? registry.core_version ?? null,
    last_migrated_at: health?.last_migrated_at ?? null,
    plugin_version: health?.plugin_version ?? null,
    last_push_at: health?.last_push_at ?? null,
    push_failing: liveness.liveness === "stale" || liveness.liveness === "unreachable" || liveness.liveness === "never-reported",
  };
}

/** FR-7.MGM.005 — backup-health via the Supabase Management API (ADR-008) + estimate-grade cost overview
 *  (ADR-003). backup_health is pushed as an opaque operational rollup (no business data); cost is ALWAYS
 *  labelled estimate-grade. */
export interface BackupHealthCard {
  client_slug: string;
  backup_health: Record<string, unknown> | null;
  source: "supabase-management-api";
}
export interface CostOverviewRow {
  client_slug: string;
  cost_to_date: number | null;
  grade: "estimate"; // ALWAYS estimate-grade (ADR-003) — never presented as billed/actual
}

export function backupHealthCard(registry: RegistryCard, health: HealthCard | null): BackupHealthCard {
  return { client_slug: registry.client_slug, backup_health: health?.backup_health ?? null, source: "supabase-management-api" };
}
export function costOverviewRow(registry: RegistryCard, health: HealthCard | null): CostOverviewRow {
  return { client_slug: registry.client_slug, cost_to_date: health?.cost_to_date ?? null, grade: "estimate" };
}

/** Aggregate the fleet cost overview with a trend, ALWAYS labelled estimate-grade (AC-7.MGM.005.2). */
export interface CostOverview {
  rows: CostOverviewRow[];
  total_estimate: number;
  grade: "estimate";
  trend: "up" | "down" | "flat" | "unknown";
}

export function costOverview(rows: CostOverviewRow[], priorTotal: number | null): CostOverview {
  const total = rows.reduce((a, r) => a + (r.cost_to_date ?? 0), 0);
  let trend: CostOverview["trend"] = "unknown";
  if (priorTotal !== null) trend = total > priorTotal ? "up" : total < priorTotal ? "down" : "flat";
  return { rows, total_estimate: total, grade: "estimate", trend };
}

// ── The backup-health read from the Supabase Management API (ADR-008) — STUBBED offline ───────────────
//
// The live read is `GET /v1/projects/{ref}/database/backups` (ADR-008) — a PLATFORM call that returns backup
// status only, NO business data. Offline we inject a stub so the reporter can assemble backup_health into the
// snapshot without touching any silo business table. The live adapter (supabase-store.ts) makes the real call.
export interface SupabaseBackupApi {
  getBackups(projectRef: string): Promise<{ backups: Array<{ status: string; inserted_at: string }> }>;
}

/** An offline stub of the Management API backup read — returns operational backup metadata ONLY (ADR-008).
 *  Proves the reporter path assembles backup_health without any business-data source. */
export class StubSupabaseBackupApi implements SupabaseBackupApi {
  constructor(private readonly canned: Record<string, Array<{ status: string; inserted_at: string }>> = {}) {}
  async getBackups(projectRef: string): Promise<{ backups: Array<{ status: string; inserted_at: string }> }> {
    return { backups: this.canned[projectRef] ?? [] };
  }
}

/** Assemble the opaque backup_health rollup for a snapshot from the Management API read — operational metadata
 *  ONLY (status + freshness), never business data (AC-7.MGM.005.1). */
export async function readBackupHealth(api: SupabaseBackupApi, projectRef: string): Promise<Record<string, unknown>> {
  const { backups } = await api.getBackups(projectRef);
  const latest = backups[0] ?? null;
  return {
    source: "supabase-management-api",
    project_ref: projectRef,
    backup_count: backups.length,
    latest_status: latest?.status ?? "none",
    latest_at: latest?.inserted_at ?? null,
  };
}
