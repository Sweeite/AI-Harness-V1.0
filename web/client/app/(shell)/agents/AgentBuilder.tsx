'use client';

// ISSUE-067 — surface-09 the five-section Agent Builder cockpit (OD-138). Two top-level sections (Fleet ·
// Orchestration); the Fleet grid opens a per-agent Builder drawer carrying a Version History tab.
//   A. Fleet grid          — one card per agent; health/drift/dead-agent/heartbeat badges (never false-green).
//   B. Builder drawer      — description / memory_scope / tools / max_tokens / enabled + read-only model +
//                            C4 Layer-1 read-through; OD-080 capability fields LOCKED for a non-Super-Admin.
//   C. Version History tab — the immutable trail (view/diff/restore-as-new-version, forward-only).
//   D. Orchestration       — read-only routing readout (edit on surface-01) + the LRN.002 mismatch pointer.
//   E. Execution Plans     — versioned plans; per-step halt-and-escalate default; HUMAN-decided rollback only.
//
// Every Save routes through evaluateStagedSave → the composed reject-at-write guard (no reject logic re-implemented
// here): an empty change_reason / empty description / invalid memory_scope / forbidden capability is DENIED at write,
// the prior version stands (#1), the reason is surfaced inline (#3), the forbidden grant is blocked (#2). Writes are
// demo-local on the seeded path (the live registry write is the per-deployment adapter). Every list fails honest.

import * as React from 'react';

import {
  Tabs, Modal, Drawer, HonestState, SkeletonRows, EmptyState, StatusBadge, StatusBanner,
  DescriptionList, MetricRow, Field, Panel, type ReadResult, type TabDef,
} from '@harness/web-shared';

import {
  evaluateStagedSave, toolPickerOptions, CAPABILITY_LOCKED_AFFORDANCE, primaryHealthStale,
  BUILDER_REJECT_CODES, MEMORY_TIERS,
  type BuilderAuthority, type BuilderSaveVerdict, type MemoryScope, type MemoryTier, type StepFailureMode,
} from '../../../lib/agents-seam.ts';
import {
  DEMO_TOOLS, TOOL_LABEL, demoClassifier, DEFAULT_FAILURE_MODE, STEP_FAILURE_LABEL,
  type DemoAgent, type DemoHealth, type DemoPlan, type DemoRouting, type DemoVersion,
} from '../../../lib/demo-agents.ts';

type Section = 'fleet' | 'orchestration';

export function AgentBuilder(props: {
  authority: BuilderAuthority;
  agentsRead: ReadResult<DemoAgent[]>;
  healthRead: ReadResult<Record<string, DemoHealth>>;
  plansRead: ReadResult<DemoPlan[]>;
  routingRead: ReadResult<DemoRouting>;
}): React.JSX.Element {
  const [section, setSection] = React.useState<Section>('fleet');
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);

  const agents = props.agentsRead.kind === 'ok' || props.agentsRead.kind === 'stale' ? props.agentsRead.data : [];
  const openAgent = agents.find((a) => a.id === openId) ?? null;

  const openById = (id: string) => { setSection('fleet'); setOpenId(id); };

  const tabs: TabDef[] = [
    { id: 'fleet', label: 'Fleet' },
    { id: 'orchestration', label: 'Orchestration' },
  ];

  return (
    <div>
      <Tabs tabs={tabs} active={section} onSelect={(id) => setSection(id as Section)} />
      <div id={`panel-${section}`} role="tabpanel" aria-labelledby={`tab-${section}`}>
        {section === 'fleet' ? (
          <FleetGrid agentsRead={props.agentsRead} healthRead={props.healthRead} onOpen={setOpenId} authority={props.authority} onAdd={() => setAdding(true)} />
        ) : (
          <Orchestration routingRead={props.routingRead} plansRead={props.plansRead} authority={props.authority} onOpenAgent={openById} />
        )}
      </div>

      {openAgent ? (
        <BuilderDrawer
          key={openAgent.id}
          agent={openAgent}
          allAgents={agents}
          authority={props.authority}
          onClose={() => setOpenId(null)}
        />
      ) : null}

      {adding ? <AddAgentModal existing={agents} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

// ── A. Add-agent (AC-8.REG.003.1 — add = insert an enabled row, auto-discovered). Capability action → gated on
// PERM-agents.edit_capability (OD-080, Super-Admin only). Routes the insert through the SAME reject-at-write guard
// with descriptionRequired:true, so an empty description (REG.001.2) or empty change_reason (REG.004.1) is denied
// at write; a new agent is a bare role slug (NO client_slug, REG.001.3). Demo-local insert; the live registry
// write is the per-deployment adapter. ─────────────────────────────────────────────────────────────────────
function AddAgentModal(props: { existing: DemoAgent[]; onClose: () => void }): React.JSX.Element {
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [verdict, setVerdict] = React.useState<Extract<BuilderSaveVerdict, { ok: false }> | null>(null);
  const [added, setAdded] = React.useState(false);

  const submit = () => {
    const role = name.trim();
    // Duplicate-name guard (a new agent is auto-discovered by its unique role slug).
    if (role && props.existing.some((a) => a.name === role)) {
      setVerdict({ ok: false, code: BUILDER_REJECT_CODES.DESCRIPTION_REQUIRED, field: 'description', reason: `an agent named '${role}' already exists — pick a unique role slug` });
      return;
    }
    // A new agent starts fail-closed narrow ('{}') with no tools — the same reject-at-write guard runs on insert.
    const v = evaluateStagedSave(
      { role: role || 'new-agent', description, tools_allowed: [], memory_scope: {}, change_reason: reason, descriptionRequired: true },
      demoClassifier(),
    );
    if (v.ok) { setAdded(true); return; }
    setVerdict(v);
  };

  return (
    <Modal title="Add agent" onClose={props.onClose}>
      {added ? (
        <div className="ah-banner ah-tone-ok" role="status">
          <span aria-hidden="true">●</span>
          <span>Added agent “{name.trim()}” as a new <strong>enabled</strong> row (v1, auto-discovered) — starts with the fail-closed narrow memory scope and no tools until a capability edit (demo-local on the seeded path). AC-8.REG.003.1.</span>
        </div>
      ) : (
        <>
          <Field label="Role slug (no client prefix — AC-8.REG.001.3)" htmlFor="add-name">
            <input id="add-name" className="ah-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. insight" />
          </Field>
          <Field label="Description (required — assembly halts without it)" htmlFor="add-desc">
            <textarea id="add-desc" className="ah-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Change reason (mandatory — AC-8.REG.004.1)" htmlFor="add-reason">
            <input id="add-reason" className="ah-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {verdict ? (
            <div className="ah-banner ah-tone-error" role="alert" style={{ marginTop: 'var(--space-2)' }}>
              <span aria-hidden="true">▲</span><span>{verdict.reason}</span>
            </div>
          ) : null}
          <div className="ah-row" style={{ marginTop: 'var(--space-3)', gap: 'var(--space-2)' }}>
            <button className="ah-btn ah-btn-primary" onClick={submit}>Add agent</button>
            <button className="ah-btn" onClick={props.onClose}>Cancel</button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ── Health resolution — structurally never a false-green. ─────────────────────────────────────────────────
type HealthView =
  | { state: 'loading' }
  | { state: 'unavailable' } // read failed / can't-confirm / per-agent probe unknown → "—", never green
  | { state: 'ok'; h: DemoHealth }
  | { state: 'stale'; h: DemoHealth; asOf: string };

function healthFor(read: ReadResult<Record<string, DemoHealth>>, agentId: string): HealthView {
  if (read.kind === 'loading') return { state: 'loading' };
  if (read.kind === 'ok' || read.kind === 'stale') {
    const h = read.data[agentId];
    if (!h || h.readState === 'unknown') return { state: 'unavailable' };
    return read.kind === 'stale' ? { state: 'stale', h, asOf: read.asOf } : { state: 'ok', h };
  }
  return { state: 'unavailable' }; // error / unknown
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

// ── A. Fleet grid ─────────────────────────────────────────────────────────────────────────────────────────
function FleetGrid(props: {
  agentsRead: ReadResult<DemoAgent[]>;
  healthRead: ReadResult<Record<string, DemoHealth>>;
  onOpen: (id: string) => void;
  authority: BuilderAuthority;
  onAdd: () => void;
}): React.JSX.Element {
  return (
    <div>
      <div className="ah-row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
        <h1 className="ah-page-title" style={{ margin: 0 }}>Agent fleet</h1>
        {/* Add agent = a capability action (OD-080) → Super-Admin only; absent (not disabled) for a non-holder. */}
        {props.authority.canEditCapability ? (
          <button className="ah-btn ah-btn-primary" onClick={props.onAdd} aria-label="Add a new agent">+ Add agent</button>
        ) : null}
      </div>
      <StatusBanner tone="unknown" message="Health badges poll (polling_interval_agent_health_s · 60s) — not Realtime. A drift/dead-agent flag is surfaced for a human; nothing is auto-changed or auto-disabled (OD-078)." />
      {props.agentsRead.kind === 'loading' ? <SkeletonRows count={4} /> : null}
      <HonestState result={props.agentsRead}>
        {(agents) => agents.length === 0
          ? <StatusBanner tone="error" message="The agent registry is empty — no orchestrator, no specialists. This is an ALARM: routing cannot run. Contact the operator (seed may have failed)." />
          : (
            <div className="ah-dash-grid">
              {agents.map((a) => (
                <AgentCard key={a.id} agent={a} health={healthFor(props.healthRead, a.id)} onOpen={() => props.onOpen(a.id)} />
              ))}
            </div>
          )}
      </HonestState>
    </div>
  );
}

function AgentCard(props: { agent: DemoAgent; health: HealthView; onOpen: () => void }): React.JSX.Element {
  const a = props.agent;
  const hv = props.health;
  return (
    <Panel>
      <div className="ah-panel-head">
        <h2 className="ah-panel-title" style={{ margin: 0 }}>
          {a.name}{a.isOrchestrator ? <span className="ah-muted"> · orchestrator</span> : null}
        </h2>
        <StatusBadge tone={a.enabled ? 'ok' : 'unknown'} label={a.enabled ? `enabled · v${a.version}` : `disabled · v${a.version}`} />
      </div>
      <p className="ah-muted" style={{ margin: '0 0 var(--space-2)' }}>{a.description}</p>

      <div className="ah-row" style={{ flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <HealthBadges health={hv} />
      </div>

      <div style={{ marginTop: 'var(--space-3)' }}>
        <button className="ah-btn ah-btn-sm" onClick={props.onOpen} aria-label={`Open Builder for ${a.name}`}>Open Builder</button>
      </div>
    </Panel>
  );
}

function HealthBadges(props: { health: HealthView }): React.JSX.Element {
  const hv = props.health;
  if (hv.state === 'loading') return <StatusBadge tone="loading" label="health loading…" />;
  if (hv.state === 'unavailable') {
    // Badge-read failure / can't-confirm → "—"/"health unavailable", NEVER a fabricated green/0/✓.
    return <StatusBadge tone="unknown" label="health unavailable — —" />;
  }
  const h = hv.h;
  // AC-8.HLTH.004.2 (#3, never-false-healthy): the primary success/failure badge must be NON-green whenever its
  // metrics are stale-at-source — a stalled producer heartbeat (the numbers are last-known, not current) OR a
  // dead-agent flag (a 0%-success agent must never read as a confident green "0.0% ok"). The overall read being
  // fresh is NOT enough; fold the producer/dead signals into the tone so the at-a-glance health signal is never a
  // last-known-good green while the source is unreliable. (M1 fix — the render-only #3 hole the pure suite missed.)
  const producerStalled = h.producerHeartbeat === 'stalled';
  const sourceStale = primaryHealthStale({ readStale: hv.state === 'stale', producerHeartbeat: h.producerHeartbeat, deadAgentFlag: h.deadAgentFlag });
  const staleNote = producerStalled
    ? ' · STALE (producer stalled — last-known, not current)'
    : h.deadAgentFlag
      ? ' · last-known (dead-agent — not live)'
      : hv.state === 'stale'
        ? ` · stale as of ${hv.asOf}`
        : '';
  return (
    <>
      <StatusBadge
        tone={sourceStale ? 'stale' : 'ok'}
        label={`${pct(h.successRate)} ok · ${pct(h.failureRate)} fail · last run ${h.lastRun}${staleNote}`}
      />
      {h.driftFlag ? <StatusBadge tone="stale" label={`drift flagged (${h.driftScore.toFixed(2)}) — human review; not auto-changed`} /> : null}
      {h.deadAgentFlag ? <StatusBadge tone="error" label="dead-agent flag — stays enabled until a human decides" /> : null}
      {producerStalled
        ? <StatusBadge tone="stale" label={`producer heartbeat STALE — as of ${h.heartbeatAsOf} (never shown as last-known green)`} />
        : <StatusBadge tone="ok" label="producer heartbeat fresh" />}
    </>
  );
}

// ── B + C. Builder drawer (definition editor + version history) ──────────────────────────────────────────
type DrawerTab = 'builder' | 'history';

interface Staged {
  description: string;
  maxTokens: string; // form field (string) → number|null on save
  tiers: Set<MemoryTier>;
  entityModel: boolean;
  toolRegistry: boolean;
  note: string;
  tools: Set<string>;
  enabled: boolean;
  malformedScopeDemo: boolean; // demo: inject an invalid scope to prove the SCO.003.1 write-time reject
  forcedForbiddenTool: string | null; // demo: stage a forbidden tool to prove the SPC reject-at-write
}

function initStaged(a: DemoAgent): Staged {
  return {
    description: a.description,
    maxTokens: a.max_tokens === null ? '' : String(a.max_tokens),
    tiers: new Set(a.memory_scope.tiers),
    entityModel: a.memory_scope.entity_model,
    toolRegistry: a.memory_scope.tool_registry,
    note: a.memory_scope.note ?? '',
    tools: new Set(a.tools_allowed),
    enabled: a.enabled,
    malformedScopeDemo: false,
    forcedForbiddenTool: null,
  };
}

function stagedScope(s: Staged): unknown {
  if (s.malformedScopeDemo) return { tiers: ['not-a-real-tier'], entity_model: 'yes' }; // deliberately invalid
  const scope: MemoryScope = {
    tiers: [...s.tiers],
    entity_model: s.entityModel,
    tool_registry: s.toolRegistry,
    ...(s.note.trim() ? { note: s.note.trim() } : {}),
  };
  return scope;
}

/** The forbidden-class exemplar tool for a role (for the reject-at-write demo). */
function forbiddenExemplar(role: string): string | null {
  if (role === 'comms') return 'tool-send-email';
  if (role === 'finance') return 'tool-initiate-payment';
  if (role === 'memory') return null; // Memory is the sole permitted holder of memory-write
  return 'tool-memory-write'; // any non-Memory role: memory-write is forbidden
}

function BuilderDrawer(props: {
  agent: DemoAgent;
  allAgents: DemoAgent[];
  authority: BuilderAuthority;
  onClose: () => void;
}): React.JSX.Element {
  const a = props.agent;
  const canCap = props.authority.canEditCapability;
  const canDesc = props.authority.canEditDescription;
  const classifier = React.useMemo(() => demoClassifier(), []);

  const [tab, setTab] = React.useState<DrawerTab>('builder');
  const [s, setS] = React.useState<Staged>(() => initStaged(a));
  const [modal, setModal] = React.useState<null | { kind: 'save' | 'restore'; version?: DemoVersion }>(null);
  const [saved, setSaved] = React.useState<{ version: number; capability: boolean } | null>(null);

  // Sole-enabled-agent-for-domain check (REG.005.2/.3) — each disable of the last enabled agent stalls its domain.
  const enabledPeers = props.allAgents.filter((x) => x.domain === a.domain && x.enabled && x.id !== a.id).length;
  const disablingSole = !s.enabled && a.enabled && enabledPeers === 0;

  // The tools picker: every tool shown; a forbidden one is greyed WITH its inline reason (OD-140).
  const pickerOpts = toolPickerOptions(a.name, DEMO_TOOLS.map((t) => t.id), classifier);

  // REG.006.3 positive seed check — Comms holds no autonomous-send tool, Finance no transaction tool.
  const seedCheck = seedHardLimitCheck(a);

  const exemplar = forbiddenExemplar(a.name);

  const runSave = (reason: string): BuilderSaveVerdict => {
    // Build exactly the staged edit; capability fields only travel when the caller may edit them (else untouched).
    const tools = new Set(s.tools);
    if (s.forcedForbiddenTool) tools.add(s.forcedForbiddenTool);
    const verdict = evaluateStagedSave(
      {
        role: a.name,
        description: canDesc ? s.description : undefined,
        memory_scope: canCap ? stagedScope(s) : undefined,
        tools_allowed: canCap ? [...tools] : undefined,
        change_reason: reason,
      },
      classifier,
    );
    if (verdict.ok) {
      // Demo-local: a NEW immutable version (version++). The live registry write is the per-deployment adapter.
      // m5 — flag as a capability/authority change ONLY when a capability field (tools_allowed / memory_scope /
      // enabled) ACTUALLY changed, not on any save by a capability-holder (a description-only edit by a Super Admin
      // is a description-tier change, not a capability one — over-flagging adds audit noise + mislabels the tier).
      // m4 — `enabled` is a capability field (OD-080); its change counts here, gated by canCap like the others (its
      // edit authority is enforced by the disabled checkbox + this canCap gate; the live server projection must gate
      // it the same way — tracked as the server-write residual, OD-202-adjacent).
      const currentTools = [...a.tools_allowed].sort();
      const stagedTools = [...tools].sort();
      const toolsChanged = stagedTools.length !== currentTools.length || stagedTools.some((t, i) => t !== currentTools[i]);
      const st = { tiers: [...s.tiers], entity_model: s.entityModel, tool_registry: s.toolRegistry, note: s.note.trim() };
      const scopeChanged =
        [...st.tiers].sort().join(',') !== [...a.memory_scope.tiers].sort().join(',') ||
        st.entity_model !== a.memory_scope.entity_model ||
        st.tool_registry !== a.memory_scope.tool_registry ||
        st.note !== (a.memory_scope.note ?? '');
      const capability = canCap && (toolsChanged || scopeChanged || s.enabled !== a.enabled);
      setSaved({ version: a.version + 1, capability });
      setModal(null);
      setS((prev) => ({ ...prev, malformedScopeDemo: false, forcedForbiddenTool: null }));
    }
    return verdict;
  };

  const runRestore = (version: DemoVersion, reason: string): BuilderSaveVerdict => {
    // Restore is forward-only: it writes a NEW version. Treated as an edit → routed through the same gate.
    const verdict = evaluateStagedSave(
      { role: a.name, description: canDesc ? a.description : undefined, change_reason: reason },
      classifier,
    );
    if (verdict.ok) { setSaved({ version: a.version + 1, capability: version.capabilityChange }); setModal(null); }
    return verdict;
  };

  const drawerTabs: TabDef[] = [
    { id: 'builder', label: 'Builder' },
    { id: 'history', label: 'Version History', count: a.history.length },
  ];

  return (
    <Drawer title={`Agent: ${a.name}`} onClose={props.onClose}>
      {saved ? (
        <div className="ah-banner ah-tone-ok" role="status" style={{ marginBottom: 'var(--space-3)' }}>
          <span aria-hidden="true">●</span>
          <span>Saved as v{saved.version}{saved.capability ? ' (flagged as an authority/capability change)' : ''} — a new immutable version; the prior version stays retrievable (demo-local on the seeded path).</span>
        </div>
      ) : null}

      {!canCap ? (
        <StatusBanner tone="unknown" message={`Capability fields are read-only for you. ${CAPABILITY_LOCKED_AFFORDANCE}`} />
      ) : null}

      <Tabs tabs={drawerTabs} active={tab} onSelect={(id) => setTab(id as DrawerTab)} />

      {tab === 'builder' ? (
        <div id="panel-builder" role="tabpanel">
          {/* Read-only config-derived model (no agents.model column — FR-8.REG.001). */}
          <DescriptionList items={[
            { term: 'Model (read-only)', detail: <span className="ah-muted">{a.model}</span> },
            { term: 'Domain', detail: a.domain },
          ]} />

          {/* Layer-1 read-through (C4 prompt_layers, layer='core'). No core layer → assembly-halt note, never blank. */}
          <div className="ah-field">
            <span className="ah-field-label">Layer 1 (core prompt · read-through from prompt_layers)</span>
            {a.layer1 === null
              ? <StatusBanner tone="error" message="No Layer 1 — assembly will halt (FR-4.LYR.004). Editing prompt layers is done in Prompts (PERM-prompt.*)." />
              : <p className="ah-mono ah-muted" style={{ margin: 0 }}>{a.layer1}</p>}
          </div>

          {/* Description / tuning tier (SA + Admin). */}
          <Field label="Description (the routing signal — fixes mis-routing, ORC.003.1)" htmlFor="ab-desc">
            <textarea id="ab-desc" className="ah-textarea" rows={3} value={s.description} disabled={!canDesc}
              onChange={(e) => setS((p) => ({ ...p, description: e.target.value }))} />
          </Field>
          <Field label="Max tokens" htmlFor="ab-maxtok" hint="Tuning tier — Super Admin + Admin.">
            <input id="ab-maxtok" className="ah-input" inputMode="numeric" value={s.maxTokens} disabled={!canDesc}
              onChange={(e) => setS((p) => ({ ...p, maxTokens: e.target.value }))} />
          </Field>

          <hr className="ah-divider" />
          <h3 className="ah-nav-section-label">Capability {canCap ? '' : '(locked — Super-Admin-only)'}</h3>

          {/* memory_scope (capability tier). */}
          <div className="ah-field">
            <span className="ah-field-label">Memory scope (least-privilege retrieval filter)</span>
            <div className="ah-row" style={{ flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              {MEMORY_TIERS.map((t) => (
                <label key={t} className="ah-chip">
                  <input type="checkbox" checked={s.tiers.has(t)} disabled={!canCap}
                    onChange={(e) => setS((p) => { const tiers = new Set(p.tiers); if (e.target.checked) tiers.add(t); else tiers.delete(t); return { ...p, tiers }; })} /> {t}
                </label>
              ))}
              <label className="ah-chip"><input type="checkbox" checked={s.entityModel} disabled={!canCap} onChange={(e) => setS((p) => ({ ...p, entityModel: e.target.checked }))} /> entity model</label>
              <label className="ah-chip"><input type="checkbox" checked={s.toolRegistry} disabled={!canCap} onChange={(e) => setS((p) => ({ ...p, toolRegistry: e.target.checked }))} /> tool registry</label>
            </div>
            <input className="ah-input" placeholder="narrowing note (optional)" value={s.note} disabled={!canCap} style={{ marginTop: 'var(--space-2)' }}
              onChange={(e) => setS((p) => ({ ...p, note: e.target.value }))} />
            <p className="ah-field-hint">Retrieval fails closed if scope wiring is missing (SCO.001.3). Restricted memory is never auto-injected — it sits on top of clearance (SCO.002.2).</p>
            {canCap ? (
              <label className="ah-field-hint" style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <input type="checkbox" checked={s.malformedScopeDemo} onChange={(e) => setS((p) => ({ ...p, malformedScopeDemo: e.target.checked }))} /> Simulate a malformed memory_scope (demo — proves the SCO.003.1 reject-at-write)
              </label>
            ) : null}
          </div>

          {/* tools_allowed picker (capability tier) — OD-140 show + explain + block. */}
          <div className="ah-field">
            <span className="ah-field-label">Tools allowed</span>
            {seedCheck ? <p className="ah-field-hint ah-tone-ok"><span aria-hidden="true">✓ </span>{seedCheck}</p> : null}
            <div className="ah-stack" style={{ gap: 'var(--space-1)' }}>
              {pickerOpts.map((o) => (
                <label key={o.toolId} className="ah-metric-row" title={o.reason} style={o.forbidden ? { opacity: 0.55 } : undefined}>
                  <span style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                    <input type="checkbox" checked={s.tools.has(o.toolId)} disabled={!canCap || o.forbidden}
                      onChange={(e) => setS((p) => { const tools = new Set(p.tools); if (e.target.checked) tools.add(o.toolId); else tools.delete(o.toolId); return { ...p, tools }; })} />
                    <span>{TOOL_LABEL[o.toolId] ?? o.toolId}{o.forbidden ? <span className="ah-tone-error"> — {o.reason}</span> : null}</span>
                  </span>
                </label>
              ))}
            </div>
            {canCap && exemplar ? (
              <label className="ah-field-hint" style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <input type="checkbox" checked={s.forcedForbiddenTool === exemplar} onChange={(e) => setS((p) => ({ ...p, forcedForbiddenTool: e.target.checked ? exemplar : null }))} /> Force-stage a forbidden tool (demo — proves the SPC reject-at-write for this agent)
              </label>
            ) : null}
          </div>

          {/* enabled (capability tier) + sole-agent warning (REG.005.2/.3). */}
          <div className="ah-field">
            <label className="ah-field-label" style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <input type="checkbox" checked={s.enabled} disabled={!canCap} onChange={(e) => setS((p) => ({ ...p, enabled: e.target.checked }))} /> Enabled (gates routing candidacy)
            </label>
            {disablingSole ? (
              <div className="ah-inline-block-msg" role="alert"><span aria-hidden="true">▲</span>This is the sole enabled agent for domain “{a.domain}”. Disabling it means a task for that domain routes to CLARIFICATION, not a silent drop (REG.005.2/.3). Disabled agents are retained and still shown.</div>
            ) : null}
          </div>

          {/* Orchestrator containment note (display/link only — SCO.001.3 context). */}
          <p className="ah-field-hint">Scope is enforced by the orchestrator's containment at retrieval time; this editor sets the filter, it does not bypass it.</p>

          <div className="ah-modal-actions">
            <button className="ah-btn" onClick={props.onClose}>Close</button>
            <button className="ah-btn ah-btn-accent" onClick={() => setModal({ kind: 'save' })} disabled={!canDesc && !canCap}>Save…</button>
          </div>
        </div>
      ) : (
        <VersionHistory agent={a} authority={props.authority} onRestore={(version) => setModal({ kind: 'restore', version })} />
      )}

      {modal ? (
        <ChangeReasonModal
          title={modal.kind === 'save' ? `Save ${a.name}` : `Restore v${modal.version?.version} as a new version`}
          hint={modal.kind === 'save'
            ? 'Every save creates a new immutable version. A save without a reason is rejected (REG.004.1). A capability change is flagged as an authority change.'
            : 'Restore is forward-only: it writes a NEW version from the selected one; the current version is not deleted.'}
          onCancel={() => setModal(null)}
          onSubmit={(reason) => (modal.kind === 'save' ? runSave(reason) : runRestore(modal.version!, reason))}
        />
      ) : null}
    </Drawer>
  );
}

/** REG.006.3 positive seed check for Comms/Finance (rendered as a green positive check). */
function seedHardLimitCheck(a: DemoAgent): string | null {
  const classifier = demoClassifier();
  if (a.name === 'comms') {
    const hasSend = a.tools_allowed.some((t) => classifier.classOf(t) === 'autonomous_send');
    return hasSend ? null : 'Seed check: Comms holds no autonomous-send tool (hard limit, SPC.003).';
  }
  if (a.name === 'finance') {
    const hasTxn = a.tools_allowed.some((t) => classifier.classOf(t) === 'transaction');
    return hasTxn ? null : 'Seed check: Finance holds no transaction tool (hard limit, SPC.004).';
  }
  return null;
}

// ── C. Version history ────────────────────────────────────────────────────────────────────────────────────
function VersionHistory(props: { agent: DemoAgent; authority: BuilderAuthority; onRestore: (v: DemoVersion) => void }): React.JSX.Element {
  const [selected, setSelected] = React.useState<DemoVersion | null>(null);
  const history = props.agent.history;
  return (
    <div id="panel-history" role="tabpanel">
      <p className="ah-field-hint">The immutable version trail (via previous_version_id). Prior versions are always retrievable (REG.004.2); nothing is overwritten. Restore is forward-only.</p>
      <ul className="ah-stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 'var(--space-2)' }}>
        {history.map((h, i) => {
          const canRestore = h.capabilityChange ? props.authority.canEditCapability : props.authority.canEditDescription;
          const isCurrent = i === 0;
          return (
            <li key={h.id} className="ah-metric-row" style={{ alignItems: 'flex-start' }}>
              <span>
                <strong>v{h.version}</strong> {isCurrent ? <StatusBadge tone="ok" label="current" /> : null}
                {h.capabilityChange ? <StatusBadge tone="stale" label="authority/capability change" /> : null}
                <div className="ah-muted">{h.change_reason}</div>
                <div className="ah-muted ah-mono">{h.updatedAt} · {h.summary}</div>
              </span>
              <span className="ah-row">
                <button className="ah-btn ah-btn-sm" onClick={() => setSelected(selected?.id === h.id ? null : h)}>{selected?.id === h.id ? 'Hide' : 'View/diff'}</button>
                {!isCurrent ? (
                  <button className="ah-btn ah-btn-sm" onClick={() => props.onRestore(h)} disabled={!canRestore}
                    title={canRestore ? undefined : 'Restoring this version is a capability change — Super-Admin-only (OD-080)'}>Restore as new version</button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {selected ? (
        <div className="ah-banner ah-tone-unknown" style={{ marginTop: 'var(--space-3)' }}>
          <span aria-hidden="true">◌</span>
          <span>v{selected.version} vs current (v{props.agent.version}): {selected.capabilityChange ? 'capability tier changed' : 'description/tuning tier changed'} — “{selected.change_reason}”. Restore writes a new forward version; it never mutates this row.</span>
        </div>
      ) : null}
    </div>
  );
}

// ── D + E. Orchestration section ─────────────────────────────────────────────────────────────────────────
function Orchestration(props: {
  routingRead: ReadResult<DemoRouting>;
  plansRead: ReadResult<DemoPlan[]>;
  authority: BuilderAuthority;
  onOpenAgent: (id: string) => void;
}): React.JSX.Element {
  return (
    <div className="ah-stack">
      <Panel title="Orchestration & Routing (read-only — edit on surface-01 #agents)">
        {props.routingRead.kind === 'loading' ? <SkeletonRows count={3} /> : null}
        <HonestState result={props.routingRead}>
          {(r) => <RoutingReadout r={r} onOpenAgent={props.onOpenAgent} />}
        </HonestState>
      </Panel>

      <Panel title="Execution Plans (versioned; halt-and-escalate default; human-decided rollback)">
        {props.plansRead.kind === 'loading' ? <SkeletonRows count={3} /> : null}
        <HonestState result={props.plansRead}>
          {(plans) => plans.length === 0
            ? <EmptyState message="No execution plans yet — plans are created per task type on first run." />
            : <div className="ah-stack">{plans.map((p) => <PlanCard key={p.id} plan={p} authority={props.authority} />)}</div>}
        </HonestState>
      </Panel>
    </div>
  );
}

function dash(v: string | number | null | undefined): React.ReactNode {
  return v === null || v === undefined ? <span className="ah-muted">—</span> : String(v);
}

function RoutingReadout(props: { r: DemoRouting; onOpenAgent: (id: string) => void }): React.JSX.Element {
  const r = props.r;
  return (
    <div>
      <DescriptionList items={[
        { term: 'Orchestrator confidence threshold', detail: dash(r.orchestratorConfidenceThreshold) },
        { term: 'Chain depth limit', detail: dash(r.chainDepthLimit) },
        { term: 'Default model', detail: dash(r.defaultModel) },
        { term: 'Lightweight model', detail: dash(r.lightweightModel) },
      ]} />
      <h3 className="ah-nav-section-label">Cache windows</h3>
      {r.cacheWindows.map((c) => <MetricRow key={c.label} label={c.label} value={dash(c.value)} />)}
      <h3 className="ah-nav-section-label">Routing weights (reflects surface-01 edits)</h3>
      {r.routingWeights.map((w) => <MetricRow key={w.agent} label={w.agent} value={dash(w.weight)} />)}
      <p className="ah-field-hint">Config values are edited on surface-01 (#agents) — this is a read-only readout. A missing value shows “—”, never a default shown as if live.</p>

      {r.routingMismatch ? (
        <div className="ah-inline-block-msg" role="status" style={{ marginTop: 'var(--space-3)' }}>
          <span aria-hidden="true">◌</span>
          <span>
            Routing-mismatch (LRN.002): {r.routingMismatch.note}{' '}
            <button className="ah-btn ah-btn-sm" onClick={() => props.onOpenAgent(r.routingMismatch!.implicatedAgent)}>Open {r.routingMismatch.implicatedAgent}’s Builder</button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function PlanCard(props: { plan: DemoPlan; authority: BuilderAuthority }): React.JSX.Element {
  const p = props.plan;
  const [rolledBack, setRolledBack] = React.useState(false);
  // Rollback is HUMAN-initiated + audited, NEVER automatic (OOS-030); disabled on uncertain/stale state, and gated
  // on the description tier (OD-137: "roll back a plan version" = PERM-agents.edit_description).
  const canRollback = props.authority.canEditDescription && !p.uncertain && p.version > 1;
  return (
    <Panel>
      <div className="ah-panel-head">
        <h3 className="ah-panel-title" style={{ margin: 0 }}>{p.taskType} · v{p.version}</h3>
        <span className="ah-panel-freshness">updated {p.updatedAt}{p.uncertain ? ' · state uncertain' : ''}</span>
      </div>
      <ol className="ah-stack" style={{ margin: 0, paddingLeft: 'var(--space-4)', gap: 'var(--space-1)' }}>
        {p.steps.map((st) => (
          <li key={st.order}>
            {st.label}{' '}
            {st.failureMode === null
              ? <StatusBadge tone="stale" label={`no explicit mode → ${STEP_FAILURE_LABEL[DEFAULT_FAILURE_MODE]} (default)`} />
              : <StatusBadge tone={st.failureMode === 'halt_and_escalate' ? 'ok' : 'unknown'} label={STEP_FAILURE_LABEL[st.failureMode as StepFailureMode]} />}
          </li>
        ))}
      </ol>
      {rolledBack ? (
        <div className="ah-banner ah-tone-ok" role="status" style={{ marginTop: 'var(--space-2)' }}><span aria-hidden="true">●</span><span>Rolled back to v{p.version - 1} — human-initiated and audited (demo-local).</span></div>
      ) : (
        <div className="ah-modal-actions">
          <button className="ah-btn ah-btn-sm" onClick={() => setRolledBack(true)} disabled={!canRollback}
            title={p.uncertain ? 'Rollback disabled: plan state is uncertain/stale' : p.version <= 1 ? 'No prior version to roll back to' : !props.authority.canEditDescription ? 'Rollback needs PERM-agents.edit_description' : undefined}>
            Roll back one version (human-decided)
          </button>
        </div>
      )}
      {p.uncertain ? <p className="ah-field-hint">Rollback is disabled while this plan's latest state is uncertain — a rollback is never automatic and never acts on stale state (OOS-030 / PLAN.004.2).</p> : null}
    </Panel>
  );
}

// ── The mandatory change-reason modal (no silent edits — REG.004). ───────────────────────────────────────
function ChangeReasonModal(props: {
  title: string;
  hint: string;
  onCancel: () => void;
  onSubmit: (reason: string) => BuilderSaveVerdict;
}): React.JSX.Element {
  const [reason, setReason] = React.useState('');
  const [verdict, setVerdict] = React.useState<Extract<BuilderSaveVerdict, { ok: false }> | null>(null);
  const submit = () => {
    const v = props.onSubmit(reason);
    if (!v.ok) setVerdict(v); // on ok the parent closes this modal
  };
  const fieldErr = (field: string) => (verdict && verdict.field === field ? verdict.reason : undefined);
  return (
    <Modal
      title={props.title}
      onClose={props.onCancel}
      actions={<><button className="ah-btn" onClick={props.onCancel}>Cancel</button><button className="ah-btn ah-btn-accent" onClick={submit}>Confirm save</button></>}
    >
      <p className="ah-field-hint">{props.hint}</p>
      <Field label="Change reason" htmlFor="ab-reason" required error={fieldErr('change_reason')} hint="Mandatory — written to the audit trail.">
        <textarea id="ab-reason" className="ah-textarea" rows={2} value={reason} onChange={(e) => { setReason(e.target.value); setVerdict(null); }} />
      </Field>
      {verdict && verdict.code !== BUILDER_REJECT_CODES.CHANGE_REASON_REQUIRED ? (
        <div className="ah-inline-block-msg" role="alert"><span aria-hidden="true">▲</span>{verdict.reason}</div>
      ) : null}
    </Modal>
  );
}
