// ISSUE-033 §8 steps 4-7 — the 3-LAYER refresh model + the automatic-vs-manual metric hook, all built
// ON TOP of the RefreshEngine (refresh.ts, the atomic rotate-persist backstop):
//   Layer 1 (FR-3.TOK.002): proactive job — every CFG-token_refresh_interval_minutes, refresh tokens
//           expiring within CFG-token_refresh_lead_minutes; skip non-expiring (Slack xoxb).
//   Layer 2 (FR-3.TOK.003): reactive — on a 401, refresh + retry the call EXACTLY once, then fail
//           toward Layer 3. Never retry-loop.
//   Layer 3 (FR-3.TOK.004): dead refresh token → state=degraded + emit the pause + re-auth-needed
//           SIGNAL (ISSUE-038 renders + auto-resumes; we only emit). Dependent tasks pause, not fail.
//   Metric (FR-3.TOK.006): count automatic (Layer 1+2) vs manual (Layer 3) resolutions; expose ratio.
//
// Deterministic: `now`/clock injected. The scheduling of Layer 1 (the actual cron tick) is owned by the
// platform scheduler; here Layer 1 is a runnable PASS whose cadence a scheduler drives — testable as a
// pure function of (now, lead, credentials).

import type { CredentialStore, CredentialState } from './store.js';
import { detectCapApproach, type TokenParams, type TokenCapWarning } from './params.js';
import { RefreshEngine, type RefreshResult } from './refresh.js';

// ── The re-auth signal Layer 3 emits (consumed by ISSUE-038 DSC — we ONLY emit, never render). ─────
export interface ReauthSignal {
  connector: string;
  /** Why the connector is degraded — always a non-secret reason (#2: no token material). */
  reason: 'dead_refresh_token' | 'rotate_persist_lost';
  /** The runtime instruction ISSUE-038 acts on: pause dependent tasks (do NOT fail them), surface a
   *  one-click re-auth. Auto-resume of paused tasks is proven in ISSUE-038 (AC-3.TOK.004.2 half). */
  pauseDependentTasks: true;
  emitted_at: string;
}

export interface LayerDeps {
  store: CredentialStore;
  engine: RefreshEngine;
  clock: () => number;
  /** Emit the pause + re-auth-needed signal (the seam ISSUE-038 consumes). MUST be delivered — a
   *  missed emit is a #3 silent failure; the caller wires this to the durable signal bus. */
  emitReauth: (signal: ReauthSignal) => void;
  /** Emit the loud warning that a per-account refresh-token count is approaching the vendor cap, BEFORE
   *  the oldest token is silently invalidated (AC-3.TOK.007.2). Same delivery contract as emitReauth: a
   *  missed emit would let a silent invalidation happen unannounced (#1/#3). Wired to the durable signal
   *  bus / health panel by the caller. */
  emitCapWarning: (warning: TokenCapWarning) => void;
  log: (event: { kind: string; connector: string; detail?: string }) => void;
  /** The refresh-outcome metric counter (FR-3.TOK.006). */
  metric: RefreshMetric;
}

// ── FR-3.TOK.006 — automatic (Layer 1+2) vs manual (Layer 3) refresh-resolution ratio. ─────────────
export class RefreshMetric {
  private automatic = 0; // Layer 1 + Layer 2 resolved without a human
  private manual = 0; // Layer 3 — a human re-auth is required

  recordAutomatic(): void {
    this.automatic += 1;
  }
  recordManual(): void {
    this.manual += 1;
  }
  /** AC-3.TOK.006.1 — the automatic-resolution ratio, reported + visible. NaN-safe (0 total → 1.0,
   *  "nothing has needed a human yet"). */
  automaticRatio(): number {
    const total = this.automatic + this.manual;
    if (total === 0) return 1;
    return this.automatic / total;
  }
  snapshot(): { automatic: number; manual: number; ratio: number } {
    return { automatic: this.automatic, manual: this.manual, ratio: this.automaticRatio() };
  }
}

/** Terminal states a dead refresh token can imply (Layer 3). GHL/Google/Slack all collapse to
 *  `degraded` as the operational state ISSUE-038 renders; the credential's underlying revoked/expired
 *  cause is recorded on the row's state where the vendor tells us, else degraded. */
const DEGRADED: CredentialState = 'degraded';

export class TokenLayers {
  constructor(private readonly deps: LayerDeps) {}

  // ── Layer 1 — proactive refresh pass (FR-3.TOK.002 / AC-3.TOK.002.1/.2). ─────────────────────────
  /** One proactive pass: refresh every active credential expiring within `leadSeconds`. Non-expiring
   *  credentials are excluded by the store query (AC-3.TOK.002.2 — Slack xoxb skipped). Returns the
   *  per-connector outcomes for observability. A scheduler calls this every interval. */
  async proactivePass(
    leadSeconds: number,
    paramsFor: (connector: string) => TokenParams,
  ): Promise<Array<{ connector: string; result: RefreshResult }>> {
    const due = await this.deps.store.dueForProactiveRefresh(this.deps.clock(), leadSeconds);
    const out: Array<{ connector: string; result: RefreshResult }> = [];
    for (const cred of due) {
      const params = paramsFor(cred.connector);
      const result = await this.deps.engine.refresh(cred.connector, params);
      await this.settle(cred.connector, result, 'layer1');
      out.push({ connector: cred.connector, result });
    }
    return out;
  }

  // ── Layer 2 — reactive refresh + retry-once on 401 (FR-3.TOK.003 / AC-3.TOK.003.1/.2). ────────────
  /** Wrap a connector call: on a 401, refresh ONCE, retry the call EXACTLY once. A second 401 (or a
   *  refresh that reports the token dead) fails toward Layer 3 — NEVER a retry loop. `call` performs
   *  the actual tool call and resolves `{ status }`; a non-401 result passes straight through. */
  async callWithReactiveRefresh<T>(
    connector: string,
    params: TokenParams,
    call: () => Promise<{ status: number; value?: T }>,
  ): Promise<{ ok: boolean; status: number; value?: T }> {
    const first = await call();
    if (first.status !== 401) {
      return { ok: first.status < 400, status: first.status, value: first.value };
    }
    // 401 → single reactive refresh
    this.deps.log({ kind: 'layer2.reactive_401', connector });
    const refresh = await this.deps.engine.refresh(connector, params);
    if (refresh.kind !== 'refreshed') {
      // refresh itself couldn't recover the token → Layer 3, no retry
      await this.settle(connector, refresh, 'layer2');
      return { ok: false, status: 401 };
    }
    // retry the call EXACTLY once
    const second = await call();
    if (second.status === 401) {
      // still 401 after a successful refresh → the connector is genuinely broken → Layer 3, no loop
      this.deps.log({ kind: 'layer2.retry_still_401', connector });
      await this.degrade(connector, 'dead_refresh_token');
      return { ok: false, status: 401 };
    }
    // the retry resolved the call automatically (Layer 2 win)
    this.deps.metric.recordAutomatic();
    return { ok: second.status < 400, status: second.status, value: second.value };
  }

  // ── Layer 3 — dead-token detection → degraded + emit pause/re-auth signal (FR-3.TOK.004). ─────────
  /** Move the connector to degraded and emit the pause + re-auth-needed signal (AC-3.TOK.004.1). This
   *  is the ONLY place a token failure becomes a human-facing re-auth; it counts as a MANUAL resolution
   *  for the metric. The auto-resume half (AC-3.TOK.004.2) is realised in ISSUE-038 which consumes this
   *  signal — we emit; we do not render or resume. */
  async degrade(connector: string, reason: ReauthSignal['reason']): Promise<void> {
    await this.deps.store.setState(connector, DEGRADED, this.deps.clock());
    const signal: ReauthSignal = {
      connector,
      reason,
      pauseDependentTasks: true,
      emitted_at: new Date(this.deps.clock() * 1000).toISOString(),
    };
    this.deps.emitReauth(signal); // MUST be delivered — a missed emit would be a #3 silent failure
    this.deps.metric.recordManual();
    this.deps.log({ kind: 'layer3.degraded', connector, detail: reason });
  }

  // ── AC-3.TOK.007.2 — surface approach to a per-account refresh-token cap BEFORE silent eviction. ──
  /** Watch a connector's live per-account refresh-token count against its vendor cap and, if it is
   *  approaching (or has reached) the cap, emit the loud cap-warning + log it — BEFORE Google would
   *  silently invalidate the oldest token. Returns the warning it surfaced (or null if comfortably
   *  below / the connector has no documented cap → no-op). The MECHANISM lives here; the LIVE sourcing
   *  of `count` (and the unused-client-deletion watch) is the AF-107 residual. Only Google caps; GHL /
   *  Slack pass through as a no-op. Non-secret counters only (#2 — no token material). */
  surfaceCapApproach(count: number, params: TokenParams): TokenCapWarning | null {
    const warning = detectCapApproach(count, params);
    if (warning === null) return null; // no cap, or comfortably below → nothing to surface
    // Loud, BEFORE the silent invalidation (#3 — never fail silently). Emit + log the non-secret counts.
    this.deps.emitCapWarning(warning);
    this.deps.log({
      kind: warning.atCap ? 'tok.cap_reached' : 'tok.cap_approach',
      connector: warning.connector,
      detail: `refresh-token count ${warning.count}/${warning.cap} (${warning.remaining} slot(s) before oldest is silently invalidated)`,
    });
    return warning;
  }

  /** Route a RefreshEngine result to the right layer outcome + metric. `refreshed` = automatic win;
   *  `dead` / `degraded-persist-lost` = Layer 3 manual + emit. Shared by Layer 1 and Layer 2. Awaited
   *  by both callers so the Layer-3 emit can never be dropped mid-flight (#3 — no silent failure). */
  private async settle(connector: string, result: RefreshResult, origin: string): Promise<void> {
    if (result.kind === 'refreshed') {
      this.deps.metric.recordAutomatic();
      this.deps.log({ kind: `${origin}.refreshed`, connector });
      return;
    }
    // dead or degraded-persist-lost → Layer 3. For degraded-persist-lost the engine ALREADY set
    // state=degraded (it degraded loudly at the persist-lost site); for `dead` we set it here. In both
    // cases the pause/re-auth signal + manual metric are owed and emitted synchronously below.
    const reason: ReauthSignal['reason'] = result.kind === 'dead' ? 'dead_refresh_token' : 'rotate_persist_lost';
    const stateAlreadySet = result.kind === 'degraded-persist-lost';
    if (!stateAlreadySet) {
      await this.deps.store.setState(connector, DEGRADED, this.deps.clock());
    }
    const signal: ReauthSignal = {
      connector,
      reason,
      pauseDependentTasks: true,
      emitted_at: new Date(this.deps.clock() * 1000).toISOString(),
    };
    this.deps.emitReauth(signal);
    this.deps.metric.recordManual();
    this.deps.log({ kind: 'layer3.degraded', connector, detail: reason });
  }
}
