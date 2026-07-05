// ISSUE-032 §8 steps 4-8 — the SHARED TOOL RUNTIME. This is the C3 spine (FR-3.CONN.002 keystone):
// the safety machinery lives here ONCE and every connector inherits it by supplying PARAMETERS only
// (a ConnectorParams record) — there is no per-connector safety code. The behavioural bodies for
// token refresh (033), rate-limit (034) and write limits (035) land later as thin seams the runtime
// already exposes; the two pieces of REAL machinery this issue lands are the boundary-tag-on-read
// (FR-3.CONN.003) and the idempotency ledger (FR-3.CONN.004).
//
// Everything here is deterministic (a caller-supplied `now` epoch-seconds; no Date.now()/random).

import type { ConnectorRuntimeStore, ToolRow } from './store.js';

// ── CONN.005: a connector supplies PARAMETERS ONLY (FR-3.CONN.002 AC.2 — no new safety code) ──────
// This is the entire per-connector surface. Adding a second connector = adding one of these; it
// introduces NO copy of the boundary-tag / idempotency / dispatch logic — that stays in the runtime.
export interface ConnectorParams {
  connector: string;
  /** Every read scope this connector's read tools need (minimal — FR-3.CONN.005). */
  readScopes: string[];
  /** Every write scope this connector's write tools need. Empty for a read-only deployment. */
  writeScopes: string[];
  /** Per-connector idempotency key derivation for a write (upsert-key / ts / client-id — the
   *  dossier mechanism realised in the instance issue; here it is just a pure function param). */
  deriveIdempotencyKey: (toolName: string, args: Record<string, unknown>) => string;
}

// ── FR-3.CONN.005 / AC-3.CONN.005.3: scopes that grant destructive delete-of-record. Requesting any
//    of these is forbidden at the grant itself (the cheapest gate for hard-limit #3). Pinned from the
//    dossiers named in the FR (GHL conversations.write thread-delete; full Google `drive`). ─────────
export const DELETE_GRANTING_SCOPES: ReadonlySet<string> = new Set<string>([
  'https://www.googleapis.com/auth/drive', // FULL drive — includes delete; use drive.file / drive.readonly
  'conversations.write', // GHL — carries thread-delete capability (FR-3.CONN.005 example)
]);

/** A read-tool's returned content, wrapped with the external-data boundary tag (FR-3.CONN.003).
 *  The glossary-pinned wrapper: <external_data source=…>…</external_data> — content inside is DATA,
 *  never instructions. */
export interface BoundaryTagged {
  tagged: true;
  source: string;
  content: string;
  /** The literal wrapper the downstream (C2 ingestion / prompt) receives. */
  wrapped: string;
}

export class BoundaryTagError extends Error {}
export class ScopeViolationError extends Error {}
export class NotRegisteredError extends Error {}

/** The external world a connector talks to — injected so the runtime is testable offline. A read
 *  returns raw content; a write performs the (mocked here) side effect and returns a result. */
export interface ExternalIO {
  read(toolName: string, args: Record<string, unknown>): Promise<{ source: string; content: string }>;
  write(toolName: string, args: Record<string, unknown>): Promise<unknown>;
}

/** A spy that records external side effects so tests can prove NON-occurrence (a read must not
 *  mutate; a suppressed retry must not re-fire). */
export interface WriteObserver {
  onExternalWrite(toolName: string, key: string): void;
}

export interface RuntimeDeps {
  store: ConnectorRuntimeStore;
  params: Record<string, ConnectorParams>; // connector name → its params (the ONLY per-connector code)
  io: ExternalIO;
  /** Sink for the fail-closed boundary-tag failure log (#3 — never silent). */
  logFailure: (event: { kind: string; detail: string }) => void;
}

// ── The escape used by the boundary-tag wrapper (prevents a payload smuggling a fake close tag). ──
function escapeForTag(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class ToolRuntime {
  constructor(private readonly deps: RuntimeDeps) {}

  private paramsFor(connector: string): ConnectorParams {
    const p = this.deps.params[connector];
    if (!p) throw new NotRegisteredError(`connector '${connector}' has no registered params (add a ConnectorParams — FR-3.CONN.002)`);
    return p;
  }

  // ── FR-3.CONN.003: boundary-tag every read-tool return. Fail-closed: if tagging cannot be applied,
  //    the content is NOT forwarded and the failure is logged (never silent — #3 / AC-3.CONN.003.2). ──
  boundaryTag(source: string, content: string): BoundaryTagged {
    // Tagging "fails" if we cannot form a well-defined tag — e.g. a null source. We fail CLOSED.
    if (source === null || source === undefined || source === '') {
      this.deps.logFailure({ kind: 'boundary_tag_failed', detail: 'missing source; content withheld (fail-closed)' });
      throw new BoundaryTagError('boundary-tag failed: missing source — content withheld, not forwarded (FR-3.CONN.003 / AC-3.CONN.003.2)');
    }
    if (typeof content !== 'string') {
      this.deps.logFailure({ kind: 'boundary_tag_failed', detail: 'non-string content; withheld (fail-closed)' });
      throw new BoundaryTagError('boundary-tag failed: non-string content — withheld (FR-3.CONN.003)');
    }
    const wrapped = `<external_data source="${escapeForTag(source)}">${escapeForTag(content)}</external_data>`;
    return { tagged: true, source, content, wrapped };
  }

  // ── FR-3.CONN.001 / AC-3.CONN.001.2 (read arm): invoke a READ tool. NO external mutation occurs;
  //    the returned content is boundary-tagged by the runtime before it is handed on (CONN.003 /
  //    CONN.002 — the connector supplied no tagging code). ──
  async invokeRead(tool: ToolRow, args: Record<string, unknown>): Promise<BoundaryTagged> {
    if (tool.category !== 'read') {
      throw new Error(`invokeRead called on a '${tool.category}' tool '${tool.name}' — dispatch by category (FR-3.CONN.001)`);
    }
    this.paramsFor(tool.connector); // asserts the connector is composed into the runtime
    const raw = await this.deps.io.read(tool.name, args);
    // The runtime tags — the connector contributes nothing here (machinery once — CONN.002).
    return this.boundaryTag(raw.source, raw.content);
  }

  // ── FR-3.CONN.001 / AC-3.CONN.001.2 (write arm) + FR-3.CONN.004: invoke a WRITE tool through the
  //    idempotency guard. A durable pre-call intent is committed BEFORE the external call; a retry
  //    with the same derived key is suppressed and returns the prior result — never a second effect
  //    (AC-3.CONN.004.1/.4). ──
  async invokeWrite(
    tool: ToolRow,
    args: Record<string, unknown>,
    now: number,
    observer?: WriteObserver,
  ): Promise<{ result: unknown; suppressed: boolean }> {
    if (tool.category !== 'write') {
      throw new Error(`invokeWrite called on a '${tool.category}' tool '${tool.name}' — dispatch by category (FR-3.CONN.001)`);
    }
    const params = this.paramsFor(tool.connector);
    const key = params.deriveIdempotencyKey(tool.name, args);

    // 1. Commit the durable intent BEFORE the external call (AC-3.CONN.004.4).
    const outcome = await this.deps.store.commitIntent(key, tool.connector, now);
    if (outcome.kind === 'suppressed') {
      // A prior intent exists — the write already happened (or its outcome is unknown after a crash).
      // Suppress the second external effect; return the prior result. NO io.write is called.
      return { result: outcome.result, suppressed: true };
    }

    // 2. Fresh key → perform the external write exactly once, then record the result (write-once).
    observer?.onExternalWrite(tool.name, key);
    const result = await this.deps.io.write(tool.name, args);
    await this.deps.store.recordResult(key, result);
    return { result, suppressed: false };
  }

  // ── FR-3.CONN.005: the minimal-scope set a connector requests. Read-only deployment → no write
  //    scope (AC-3.CONN.005.1). No delete-granting scope may ever appear (AC-3.CONN.005.3). ──
  requestedScopes(connector: string, opts: { includeWrites: boolean }): string[] {
    const p = this.paramsFor(connector);
    const scopes = opts.includeWrites ? [...p.readScopes, ...p.writeScopes] : [...p.readScopes];
    const forbidden = scopes.filter((s) => DELETE_GRANTING_SCOPES.has(s));
    if (forbidden.length > 0) {
      // The grant itself is the cheapest gate for hard-limit #3 — refuse to request it (never silently
      // request an over-broad scope — #2).
      throw new ScopeViolationError(
        `connector '${connector}' requested delete-granting scope(s): ${forbidden.join(', ')} — forbidden at the grant (AC-3.CONN.005.3 / hard-limit #3)`,
      );
    }
    return scopes;
  }
}
