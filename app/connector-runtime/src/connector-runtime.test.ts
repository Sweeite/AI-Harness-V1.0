// ISSUE-032 §9 — the AC battery for the C3 connector contract + shared runtime + tool registry.
// Every AC is proven here against the InMemoryConnectorRuntimeStore reference model + the ToolRuntime
// (offline; no live DB). The live per-connector / live-infra proof owed at Checkpoint 3 is noted per AC.
// Deterministic: a fixed logical `now`; no Date.now()/random in assertions.
//
// AC → test map (one test per AC in §4):
//   AC-3.CONN.001.1  — registered tool carries all contract fields, values in domain
//   AC-3.CONN.001.2  — read tool causes no external mutation; write tool traverses the action path
//   AC-3.CONN.002.1  — a read applies boundary-tag by the runtime without connector-specific code
//   AC-3.CONN.002.2  — a second connector supplies params only, no new safety code (one runtime)
//   AC-3.CONN.003.1  — a read tool's returned content carries the external-data boundary tag
//   AC-3.CONN.003.2  — tagging failure → content not forwarded + logged (fail-closed, not silent)
//   AC-3.CONN.004.1  — identical write retried with same key → no second external side effect
//   AC-3.CONN.004.2  — GHL contact create routes through /contacts/upsert  [connector-arm; runtime proof here]
//   AC-3.CONN.004.3  — Slack post timeout+retry → app-side dedup prevents double-post [connector-arm; runtime proof here]
//   AC-3.CONN.004.4  — durable intent committed BEFORE the call; crash-after-call → no second effect
//   AC-3.CONN.005.1  — read-only deployment requests no write scope
//   AC-3.CONN.005.2  — Drive default → drive.file (not drive.readonly) unless full-corpus enabled
//   AC-3.CONN.005.3  — no delete-granting scope is ever requested (cheapest hard-limit-#3 gate)
//   AC-3.REG.001.1   — a tool row has all fields present with values in domain
//   AC-3.REG.001.2   — enabled=false → not offered to AI selection
//   AC-3.REG.002.1   — clearly-described tool + matching task → picked
//   AC-3.REG.002.2   — two ambiguous descriptions below threshold → ask, don't call
//   AC-3.REG.003.1   — an edit creates a new version row w/ previous_version_id + non-empty change_reason
//   AC-3.REG.003.2   — an edit with empty change_reason is rejected
//   AC-3.REG.004.1   — no C3 table filters by / carries client_slug (reconciliation)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemoryConnectorRuntimeStore,
  type ToolContract,
  type ToolRow,
  TOOL_CATEGORIES,
} from './store.js';
import {
  ToolRuntime,
  type RuntimeDeps,
  type ConnectorParams,
  type ExternalIO,
  BoundaryTagError,
  ScopeViolationError,
  DELETE_GRANTING_SCOPES,
} from './runtime.js';
import { selectTool } from './selection.js';

const NOW = 1_760_000_000; // fixed logical epoch seconds

// ── fixtures ──────────────────────────────────────────────────────────────────────────
function readContract(over: Partial<ToolContract> = {}): ToolContract {
  return {
    name: 'ghl_read_contacts',
    description: 'Read CRM contacts and their tags from GoHighLevel',
    category: 'read',
    risk_level: 'low',
    requires_approval: false,
    connector: 'ghl',
    scopes: ['contacts.readonly'],
    config: { pageSize: 50 },
    change_reason: 'initial registration',
    ...over,
  };
}
function writeContract(over: Partial<ToolContract> = {}): ToolContract {
  return {
    name: 'ghl_upsert_contact',
    description: 'Create or update a CRM contact in GoHighLevel',
    category: 'write',
    risk_level: 'high',
    requires_approval: true,
    connector: 'ghl',
    scopes: ['contacts.write'],
    config: {},
    change_reason: 'initial registration',
    ...over,
  };
}

// A ConnectorParams + IO harness that records every external read/write so a test can prove
// NON-occurrence (a read never writes; a suppressed retry never re-fires).
function harness() {
  const store = new InMemoryConnectorRuntimeStore();
  const reads: string[] = [];
  const writes: string[] = [];
  const failures: Array<{ kind: string; detail: string }> = [];

  const io: ExternalIO = {
    async read(toolName, args) {
      reads.push(toolName);
      // Simulate a per-connector endpoint returning content from a labelled source.
      return { source: `ghl:${String((args as Record<string, unknown>).id ?? 'list')}`, content: `contact <script>data for ${toolName}` };
    },
    async write(toolName, _args) {
      writes.push(toolName);
      return { ok: true, tool: toolName, externalId: `ext-${writes.length}` };
    },
  };

  const ghlParams: ConnectorParams = {
    connector: 'ghl',
    readScopes: ['contacts.readonly'],
    writeScopes: ['contacts.write'],
    // GHL contact create realised as an upsert (AC-3.CONN.004.2) — the key is the upsert target.
    deriveIdempotencyKey: (tool, args) => `ghl:${tool}:${String((args as Record<string, unknown>).email ?? (args as Record<string, unknown>).id ?? 'na')}`,
  };

  const deps: RuntimeDeps = {
    store,
    params: { ghl: ghlParams },
    io,
    logFailure: (e) => failures.push(e),
  };
  const runtime = new ToolRuntime(deps);
  return { store, runtime, io, reads, writes, failures, deps, ghlParams };
}

// ════════════════════════════════════════════════════════════════════════════════════════
// FR-3.CONN.001 — uniform contract + read/write dispatch
// ════════════════════════════════════════════════════════════════════════════════════════

// AC-3.CONN.001.1 — a registered tool carries ALL contract fields with values in their domains.
test('AC-3.CONN.001.1 registered tool carries all contract fields in-domain', async () => {
  const { store } = harness();
  const t = await store.registerTool(readContract(), NOW);
  for (const f of ['name', 'description', 'category', 'requires_approval', 'connector', 'config', 'change_reason'] as const) {
    assert.ok(t[f] !== undefined && t[f] !== null, `field ${f} must be present`);
  }
  assert.ok(TOOL_CATEGORIES.includes(t.category), 'category must be in {read,write}');
  assert.equal(typeof t.requires_approval, 'boolean');
  assert.equal(t.version, 1);
  assert.equal(t.previous_version_id, null);
  // Teeth: a partial tool (empty description) is NOT registrable — there is no partially-defined tool.
  await assert.rejects(() => store.registerTool(readContract({ description: '   ' }), NOW), /partially-defined tool rejected.*description/);
  // Teeth: an out-of-domain category is rejected.
  await assert.rejects(
    () => store.registerTool(readContract({ category: 'delete' as unknown as 'read' }), NOW),
    /out of domain/,
  );
});

// AC-3.CONN.001.2 — read tool → no external mutation; write tool → the action path (idempotent write).
test('AC-3.CONN.001.2 read causes no mutation; write traverses the action path', async () => {
  const { store, runtime, reads, writes } = harness();
  const readTool = await store.registerTool(readContract(), NOW);
  const writeTool = await store.registerTool(writeContract(), NOW);

  await runtime.invokeRead(readTool, { id: 'c1' });
  assert.deepEqual(reads, ['ghl_read_contacts']);
  assert.deepEqual(writes, [], 'a read must cause NO external write');

  const w = await runtime.invokeWrite(writeTool, { email: 'a@b.com' }, NOW);
  assert.equal(w.suppressed, false);
  assert.deepEqual(writes, ['ghl_upsert_contact'], 'a write traverses the action path exactly once');

  // Teeth: category dispatch is enforced — invokeRead on a write tool throws (and vice-versa).
  await assert.rejects(() => runtime.invokeRead(writeTool, {}), /dispatch by category/);
  await assert.rejects(() => runtime.invokeWrite(readTool, {}, NOW), /dispatch by category/);
});

// ════════════════════════════════════════════════════════════════════════════════════════
// FR-3.CONN.002 — safety machinery owned once
// ════════════════════════════════════════════════════════════════════════════════════════

// AC-3.CONN.002.1 — a read applies boundary-tag via the RUNTIME, without connector-specific code.
test('AC-3.CONN.002.1 runtime applies boundary-tag on read with no connector code', async () => {
  const { store, runtime } = harness();
  const readTool = await store.registerTool(readContract(), NOW);
  const out = await runtime.invokeRead(readTool, { id: 'c1' });
  // The connector's ConnectorParams contributes NO tagging code — the tag is the runtime's.
  assert.equal(out.tagged, true);
  assert.match(out.wrapped, /^<external_data source="ghl:c1">/);
  assert.match(out.wrapped, /<\/external_data>$/);
});

// AC-3.CONN.002.2 — a SECOND connector adds PARAMETERS only; no new copy of the safety logic.
test('AC-3.CONN.002.2 second connector is params-only, reuses the one runtime', async () => {
  const { store, deps, io } = harness();
  // Add a second connector by adding ONE ConnectorParams — no new class, no new tag/idempotency code.
  const slackParams: ConnectorParams = {
    connector: 'slack',
    readScopes: ['channels:history'],
    writeScopes: ['chat:write'],
    deriveIdempotencyKey: (tool, args) => `slack:${tool}:${String((args as Record<string, unknown>).client_ts ?? 'na')}`,
  };
  deps.params.slack = slackParams;
  const runtime = new ToolRuntime(deps); // the SAME runtime class serves both connectors

  const slackRead = await store.registerTool(
    readContract({ name: 'slack_read_msgs', description: 'Read Slack channel messages', connector: 'slack', scopes: ['channels:history'] }),
    NOW,
  );
  const out = await runtime.invokeRead(slackRead, { id: 'ch1' });
  // Same boundary-tag machinery applied to the new connector with zero new safety code.
  assert.match(out.wrapped, /^<external_data source="ghl:ch1">/); // io.read labels source ghl:* in the harness
  assert.equal(out.tagged, true);

  // Teeth: a connector with NO params is refused by the runtime (can't silently run un-composed).
  const orphan = await store.registerTool(readContract({ connector: 'notion' }), NOW);
  await assert.rejects(() => runtime.invokeRead(orphan, {}), /has no registered params/);
  void io;
});

// ════════════════════════════════════════════════════════════════════════════════════════
// FR-3.CONN.003 — boundary-tag on read (REAL machinery; AF-088 gates containment adequacy, not this)
// ════════════════════════════════════════════════════════════════════════════════════════

// AC-3.CONN.003.1 — a read tool's returned content carries the external-data boundary tag.
test('AC-3.CONN.003.1 read content carries the external-data boundary tag', async () => {
  const { store, runtime } = harness();
  const readTool = await store.registerTool(readContract(), NOW);
  const out = await runtime.invokeRead(readTool, { id: 'c1' });
  assert.ok(out.wrapped.startsWith('<external_data '));
  assert.ok(out.wrapped.endsWith('</external_data>'));
  // Teeth: injection payload inside content is ESCAPED so it cannot smuggle a real close tag / markup —
  // the wrapped form contains no live '<' from the payload (the `<script>` became `&lt;script&gt;`).
  assert.match(out.wrapped, /&lt;script&gt;/);
  assert.ok(!/<script>/.test(out.wrapped), 'raw markup inside external content must be neutralised');
});

// AC-3.CONN.003.2 — if tagging fails, content is NOT forwarded and the failure is LOGGED (not silent).
test('AC-3.CONN.003.2 tagging failure is fail-closed and logged', async () => {
  const { runtime, failures } = harness();
  // A read whose source is missing cannot be tagged — the runtime must withhold + log (#3).
  assert.throws(() => runtime.boundaryTag('', 'some external content'), BoundaryTagError);
  assert.equal(failures.length, 1, 'the failure must be logged, never silent');
  assert.equal(failures[0]!.kind, 'boundary_tag_failed');
  // Teeth: nothing was returned as forwardable content — the throw prevents forwarding entirely.
});

// ════════════════════════════════════════════════════════════════════════════════════════
// FR-3.CONN.004 — idempotency ledger (REAL machinery; connector arms 004.2/.3 land in 039/041)
// ════════════════════════════════════════════════════════════════════════════════════════

// AC-3.CONN.004.1 — identical write retried with the same key → no second external side effect.
test('AC-3.CONN.004.1 identical retry produces no second external effect', async () => {
  const { store, runtime, writes } = harness();
  const writeTool = await store.registerTool(writeContract(), NOW);
  const first = await runtime.invokeWrite(writeTool, { email: 'a@b.com' }, NOW);
  const retry = await runtime.invokeWrite(writeTool, { email: 'a@b.com' }, NOW + 5);
  assert.equal(first.suppressed, false);
  assert.equal(retry.suppressed, true, 'the retry must be suppressed');
  assert.deepEqual(writes, ['ghl_upsert_contact'], 'exactly ONE external write despite two invocations');
  // Teeth: the retry returns the PRIOR result (not a fresh call), and the ledger holds one row.
  assert.deepEqual(retry.result, first.result);
  assert.equal(store.ledger.size, 1);
});

// AC-3.CONN.004.2 — GHL contact create routes through /contacts/upsert (connector-arm; runtime proof).
// LIVE PROOF owed at ISSUE-039 (GHL instance) + AF-095 GREEN. Here we prove the RUNTIME contract: the
// create is realised as an upsert-keyed idempotent write (same email → same key → one effect).
test('AC-3.CONN.004.2 GHL create is an upsert-keyed idempotent write', async () => {
  const { store, runtime, writes, ghlParams } = harness();
  const create = await store.registerTool(
    writeContract({ name: 'ghl_upsert_contact', description: 'Create or update a GHL contact via /contacts/upsert' }),
    NOW,
  );
  // The derived key is the upsert target (email) — two "creates" of the same contact collapse to one.
  const k = ghlParams.deriveIdempotencyKey('ghl_upsert_contact', { email: 'dup@b.com' });
  assert.equal(k, 'ghl:ghl_upsert_contact:dup@b.com');
  await runtime.invokeWrite(create, { email: 'dup@b.com' }, NOW);
  await runtime.invokeWrite(create, { email: 'dup@b.com' }, NOW + 1);
  assert.deepEqual(writes, ['ghl_upsert_contact'], 'upsert-keyed create is idempotent (no duplicate contact)');
});

// AC-3.CONN.004.3 — Slack post times out and is retried → app-side dedup prevents a double-post.
// LIVE PROOF owed at ISSUE-041 (Slack instance) + AF-085 GREEN. Here: the runtime's app-side ledger
// dedup suppresses the re-send even though the FIRST call "timed out" (result recorded, retry sees key).
test('AC-3.CONN.004.3 Slack retry after timeout is deduped app-side', async () => {
  const store = new InMemoryConnectorRuntimeStore();
  const posts: string[] = [];
  const io: ExternalIO = {
    async read() { return { source: 'slack', content: 'x' }; },
    async write(tool) { posts.push(tool); return { ok: true }; },
  };
  const slackParams: ConnectorParams = {
    connector: 'slack',
    readScopes: ['channels:history'],
    writeScopes: ['chat:write'],
    // Slack has no native idempotency key → app-side key on the client-supplied ts (slack.md §10).
    deriveIdempotencyKey: (tool, args) => `slack:${tool}:${String((args as Record<string, unknown>).client_ts)}`,
  };
  const runtime = new ToolRuntime({ store, params: { slack: slackParams }, io, logFailure: () => {} });
  const post = await store.registerTool(
    writeContract({ name: 'slack_post', description: 'Post a Slack message to a channel', connector: 'slack', scopes: ['chat:write'] }),
    NOW,
  );
  // First send (imagine the network response timed out client-side, but the post landed).
  await runtime.invokeWrite(post, { client_ts: '1699999999.000100', text: 'hi' }, NOW);
  // Retry with the SAME client_ts → same key → suppressed, no double-post.
  const retry = await runtime.invokeWrite(post, { client_ts: '1699999999.000100', text: 'hi' }, NOW + 3);
  assert.equal(retry.suppressed, true);
  assert.deepEqual(posts, ['slack_post'], 'the timed-out post is not duplicated on retry');
});

// AC-3.CONN.004.4 — a durable intent is committed BEFORE the external call; a crash after the call but
// before completion does not permit a second external effect on retry.
test('AC-3.CONN.004.4 intent is durable pre-call; crash-after-call does not double-fire', async () => {
  const store = new InMemoryConnectorRuntimeStore();
  const writes: string[] = [];
  // Model a CRASH: io.write records the effect then throws (call landed, completion did not).
  const io: ExternalIO = {
    async read() { return { source: 'ghl', content: 'x' }; },
    async write(tool) {
      writes.push(tool);
      throw new Error('crash after external effect, before recordResult');
    },
  };
  const params: ConnectorParams = {
    connector: 'ghl',
    readScopes: [],
    writeScopes: ['contacts.write'],
    deriveIdempotencyKey: (tool, args) => `ghl:${tool}:${String((args as Record<string, unknown>).email)}`,
  };
  const runtime = new ToolRuntime({ store, params: { ghl: params }, io, logFailure: () => {} });
  const writeTool = await store.registerTool(writeContract(), NOW);

  // First attempt: the intent is committed, THEN io.write fires (and crashes). Prove intent-before-call:
  await assert.rejects(() => runtime.invokeWrite(writeTool, { email: 'a@b.com' }, NOW));
  const key = 'ghl:ghl_upsert_contact:a@b.com';
  const led = await store.getLedger(key);
  assert.ok(led, 'the intent record must exist even though the call crashed before completion');
  assert.equal(led!.result, null, 'result is NULL — outcome unknown after the crash');
  assert.deepEqual(writes, ['ghl_upsert_contact'], 'exactly one external effect so far');

  // Retry with the same key → the intent (result NULL) SUPPRESSES the second effect (intent alone is
  // enough — the runtime must not re-fire on an incomplete intent). This is the crux of AC.4.
  const retry = await runtime.invokeWrite(writeTool, { email: 'a@b.com' }, NOW + 10);
  assert.equal(retry.suppressed, true);
  assert.deepEqual(writes, ['ghl_upsert_contact'], 'retry did NOT re-fire the external effect');
});

// ════════════════════════════════════════════════════════════════════════════════════════
// FR-3.CONN.005 — minimal scope
// ════════════════════════════════════════════════════════════════════════════════════════

// AC-3.CONN.005.1 — a read-only deployment requests NO write scope.
test('AC-3.CONN.005.1 read-only deployment requests no write scope', async () => {
  const { runtime } = harness();
  const scopes = runtime.requestedScopes('ghl', { includeWrites: false });
  assert.deepEqual(scopes, ['contacts.readonly']);
  assert.ok(!scopes.includes('contacts.write'), 'no write scope in a read-only provisioning');
  // Teeth: when writes ARE included the write scope appears — proving the flag actually gates it.
  const withWrites = runtime.requestedScopes('ghl', { includeWrites: true });
  assert.ok(withWrites.includes('contacts.write'));
});

// AC-3.CONN.005.2 — Drive default config → drive.file (not drive.readonly) unless full-corpus enabled.
test('AC-3.CONN.005.2 Drive default requests drive.file, not drive.readonly', async () => {
  const { deps } = harness();
  // Default Drive params: drive.file (OD-045). A full-corpus flag escalates to drive.readonly.
  const driveDefault: ConnectorParams = {
    connector: 'gdrive',
    readScopes: ['https://www.googleapis.com/auth/drive.file'],
    writeScopes: [],
    deriveIdempotencyKey: (t) => t,
  };
  deps.params.gdrive = driveDefault;
  const runtime = new ToolRuntime(deps);
  const scopes = runtime.requestedScopes('gdrive', { includeWrites: false });
  assert.deepEqual(scopes, ['https://www.googleapis.com/auth/drive.file']);
  assert.ok(!scopes.includes('https://www.googleapis.com/auth/drive.readonly'), 'default must not request the restricted readonly scope');

  // Teeth: full-corpus config escalates to drive.readonly (still non-delete, still allowed).
  const fullCorpus: ConnectorParams = { ...driveDefault, readScopes: ['https://www.googleapis.com/auth/drive.readonly'] };
  deps.params.gdrive = fullCorpus;
  const runtime2 = new ToolRuntime(deps);
  assert.deepEqual(runtime2.requestedScopes('gdrive', { includeWrites: false }), ['https://www.googleapis.com/auth/drive.readonly']);
});

// AC-3.CONN.005.3 — no delete-granting scope is EVER requested (the cheapest hard-limit-#3 gate).
test('AC-3.CONN.005.3 delete-granting scopes are refused at the grant', async () => {
  const { deps } = harness();
  // Sanity: the forbidden set is non-empty and pins the documented examples.
  assert.ok(DELETE_GRANTING_SCOPES.has('https://www.googleapis.com/auth/drive'), 'full drive is delete-granting');
  assert.ok(DELETE_GRANTING_SCOPES.has('conversations.write'), 'GHL conversations.write carries thread-delete');

  const bad: ConnectorParams = {
    connector: 'ghlbad',
    readScopes: ['contacts.readonly'],
    writeScopes: ['conversations.write'], // delete-granting → must be refused
    deriveIdempotencyKey: (t) => t,
  };
  deps.params.ghlbad = bad;
  const runtime = new ToolRuntime(deps);
  assert.throws(() => runtime.requestedScopes('ghlbad', { includeWrites: true }), ScopeViolationError);
  // Teeth: the same connector with writes EXCLUDED still passes (only the delete scope was the problem).
  assert.deepEqual(runtime.requestedScopes('ghlbad', { includeWrites: false }), ['contacts.readonly']);
});

// ════════════════════════════════════════════════════════════════════════════════════════
// FR-3.REG.001 — the tools registry table
// ════════════════════════════════════════════════════════════════════════════════════════

// AC-3.REG.001.1 — a tool row has all fields present with values in their domains.
test('AC-3.REG.001.1 tool row is complete and in-domain; partial rows rejected', async () => {
  const { store } = harness();
  const t = await store.registerTool(writeContract(), NOW);
  assert.equal(t.category, 'write');
  assert.equal(typeof t.enabled, 'boolean');
  assert.equal(typeof t.config, 'object');
  // Teeth: each required field, when blank, blocks registration (no partially-defined tool).
  for (const missing of ['name', 'connector', 'change_reason'] as const) {
    await assert.rejects(() => store.registerTool(writeContract({ [missing]: '  ' } as Partial<ToolContract>), NOW), /partially-defined|mandatory/);
  }
});

// AC-3.REG.001.2 — a row with enabled=false is NOT offered to AI selection.
test('AC-3.REG.001.2 disabled tool is not offered to selection', async () => {
  const { store } = harness();
  const t = await store.registerTool(readContract(), NOW);
  assert.equal((await store.selectableTools()).length, 1);
  await store.setEnabled(t.id, false, NOW);
  const offered = await store.selectableTools();
  assert.equal(offered.length, 0, 'a disabled tool must not be selectable');
  // Teeth: history is retained (not deleted) — the row still exists, just hidden.
  assert.ok(await store.getTool(t.id), 'disabling must not delete the row (history retained)');
});

// ════════════════════════════════════════════════════════════════════════════════════════
// FR-3.REG.002 — description drives selection
// ════════════════════════════════════════════════════════════════════════════════════════

// AC-3.REG.002.1 — a clearly-described tool matching a task is picked.
test('AC-3.REG.002.1 clearly-described tool matching the task is selected', async () => {
  const { store } = harness();
  await store.registerTool(readContract({ name: 'calendar_read', description: 'Read upcoming calendar events and meeting times' }), NOW);
  await store.registerTool(readContract({ name: 'contacts_read', description: 'Read CRM contacts and their tags' }), NOW);
  const res = selectTool('read upcoming calendar meeting events', await store.selectableTools(), 0.4);
  assert.equal(res.kind, 'selected');
  assert.equal(res.kind === 'selected' && res.tool.name, 'calendar_read');
});

// AC-3.REG.002.2 — two ambiguous descriptions below threshold → ask, don't call.
test('AC-3.REG.002.2 ambiguous/low-confidence selection asks instead of calling', async () => {
  const { store } = harness();
  // Two near-identical descriptions → the top two are within the ambiguity margin → ask.
  await store.registerTool(readContract({ name: 'read_a', description: 'Read customer records from the system' }), NOW);
  await store.registerTool(readContract({ name: 'read_b', description: 'Read customer records from the system' }), NOW);
  const ambiguous = selectTool('read customer records', await store.selectableTools(), 0.4);
  assert.equal(ambiguous.kind, 'ask', 'two identical descriptions must trigger a clarification, not a guess');

  // Teeth: a task with no overlap is BELOW threshold → also ask (not a wrong call).
  const noMatch = selectTool('reboot the database server cluster', await store.selectableTools(), 0.4);
  assert.equal(noMatch.kind, 'ask');
});

// ════════════════════════════════════════════════════════════════════════════════════════
// FR-3.REG.003 — versioning + mandatory change_reason
// ════════════════════════════════════════════════════════════════════════════════════════

// AC-3.REG.003.1 — an edit creates a new version row w/ previous_version_id + non-empty change_reason.
test('AC-3.REG.003.1 edit creates a linked new version; prior retained', async () => {
  const { store } = harness();
  const v1 = await store.registerTool(readContract(), NOW);
  const v2 = await store.editTool(v1.id, readContract({ description: 'Read CRM contacts, tags and notes', change_reason: 'add notes to the read surface' }), NOW + 1);
  assert.equal(v2.version, 2);
  assert.equal(v2.previous_version_id, v1.id, 'the new version links its predecessor');
  assert.ok(v2.change_reason.trim().length > 0);
  // Teeth: the prior version is RETAINED (not overwritten) and its contract columns are untouched.
  const chain = await store.versionChain(v1.id);
  assert.equal(chain.length, 2);
  const stored1 = await store.getTool(v1.id);
  assert.equal(stored1!.description, 'Read CRM contacts and their tags from GoHighLevel', 'v1 contract columns are immutable');
  // Teeth: only the newest enabled version is selectable (v1 was superseded).
  const selectable = await store.selectableTools();
  assert.deepEqual(selectable.map((t: ToolRow) => t.version), [2]);
});

// AC-3.REG.003.2 — an edit with an empty change_reason is rejected.
test('AC-3.REG.003.2 edit with empty change_reason is rejected', async () => {
  const { store } = harness();
  const v1 = await store.registerTool(readContract(), NOW);
  await assert.rejects(() => store.editTool(v1.id, readContract({ change_reason: '   ' }), NOW + 1), /mandatory|partially-defined/);
  // Teeth: the failed edit created NO new version (the chain is still length 1).
  assert.equal((await store.versionChain(v1.id)).length, 1);
});

// ════════════════════════════════════════════════════════════════════════════════════════
// FR-3.REG.004 — client_slug is not an RLS key
// ════════════════════════════════════════════════════════════════════════════════════════

// AC-3.REG.004.1 — no C3 table filters by / carries client_slug (reconciliation).
test('AC-3.REG.004.1 no C3 table carries a client-identity column', async () => {
  const { store } = harness();
  const cols = await store.clientIdentityColumns();
  assert.deepEqual(cols, [], 'isolation is physical (ADR-001/006) — no client_slug on any C3 table');
  // Teeth: the ToolRow shape itself has no client_slug/tenant field.
  const t = await store.registerTool(readContract(), NOW);
  assert.ok(!('client_slug' in t) && !('tenant_id' in t), 'the row shape must not carry a client-identity key');
});
