// ISSUE-087 — the semantic component layer. THIN renderers over the proven pure-logic core
// (nav.ts, honest-state.ts, answer-mode.ts). These components hold NO permission or health logic of
// their own — they render exactly what visibleNav()/resolveViewState()/answerModeDescriptor() return.
// Styling is token-only (class names from components.css → semantic tokens); no hardcoded colour/size in
// markup, so the whole layer is skin-swappable (OD-197). a11y baseline (NFR-A11Y.001): semantic
// landmarks, keyboard-navigable links/buttons, labelled controls, status never conveyed by colour alone.

import * as React from 'react';

import { navSections, visibleNav, type NavEntry } from './nav.ts';
import {
  resolveViewState,
  renderMetric,
  healthSummary,
  NO_VALUE,
  type ReadResult,
  type ViewState,
  type ViewTone,
} from './honest-state.ts';
import { answerModeDescriptor, type AnswerMode } from './answer-mode.ts';

// A tiny glyph map so status carries a NON-colour signal (text + glyph), per NFR-A11Y.001.
const TONE_GLYPH: Record<ViewTone, string> = {
  ok: '●',
  stale: '◐',
  error: '▲',
  unknown: '◌',
  loading: '…',
};

const TONE_CLASS: Record<ViewTone, string> = {
  ok: 'ah-tone-ok',
  stale: 'ah-tone-stale',
  error: 'ah-tone-error',
  unknown: 'ah-tone-unknown',
  loading: 'ah-tone-loading',
};

// ── The RBAC-gated nav rail ────────────────────────────────────────────────────────────────────────
export function NavRail(props: {
  brand: string;
  entries: readonly NavEntry[];
  grantedNodes: ReadonlySet<string>;
  currentHref?: string;
}): React.JSX.Element {
  // The gate: render ONLY entries the caller's granted nodes permit (absent-not-empty). This reuses the
  // exact same node set app/rbac's can() resolves — the component adds no second permission source.
  const visible = visibleNav(props.entries, props.grantedNodes);
  const sections = navSections(visible);
  return (
    <nav className="ah-rail" aria-label="Primary">
      <div className="ah-brand">
        <span className="ah-brand-dot" aria-hidden="true" />
        <span>{props.brand}</span>
      </div>
      {sections.map((section) => (
        <div key={section.section}>
          <div className="ah-nav-section-label">{section.section}</div>
          <ul className="ah-nav-list">
            {section.entries.map((e) => {
              const current = props.currentHref === e.href;
              return (
                <li key={e.id}>
                  <a className="ah-nav-link" href={e.href} aria-current={current ? 'page' : undefined}>
                    <span aria-hidden="true">{glyphFor(e.icon)}</span>
                    <span>{e.label}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function glyphFor(icon?: string): string {
  return icon ? '›' : '·';
}

// ── The app shell (landmarks + skip link) ────────────────────────────────────────────────────────
export function AppShell(props: {
  brand: string;
  entries: readonly NavEntry[];
  grantedNodes: ReadonlySet<string>;
  currentHref?: string;
  topbar?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="ah-shell">
      <a className="ah-skip-link" href="#ah-main">
        Skip to content
      </a>
      <NavRail brand={props.brand} entries={props.entries} grantedNodes={props.grantedNodes} currentHref={props.currentHref} />
      <header className="ah-topbar">{props.topbar}</header>
      <main className="ah-main" id="ah-main" tabIndex={-1}>
        {props.children}
      </main>
    </div>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────────────────────────
export function Panel(props: { title?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="ah-panel" aria-label={props.title}>
      {props.title ? <h2 className="ah-panel-title">{props.title}</h2> : null}
      {props.children}
    </section>
  );
}

// ── HonestState — the never-false-healthy renderer ───────────────────────────────────────────────
// Given a raw ReadResult, render the ok content via `children(data)`, OR the honest banner for any
// non-ok tone. It is STRUCTURALLY unable to render ok content on a failed/stale-without-data read
// because it only calls children() when showData && data !== undefined.
export function HonestState<T>(props: {
  result: ReadResult<T>;
  children: (data: T) => React.ReactNode;
}): React.JSX.Element {
  const vs = resolveViewState(props.result);
  return (
    <>
      {vs.banner ? <StatusBanner tone={vs.tone} message={vs.banner} /> : null}
      {vs.tone === 'loading' ? (
        <div className="ah-banner ah-tone-loading" role="status">
          <span className="ah-spinner" aria-hidden="true" /> Loading…
        </div>
      ) : null}
      {vs.showData && vs.data !== undefined ? props.children(vs.data) : null}
    </>
  );
}

export function StatusBanner(props: { tone: ViewTone; message: string }): React.JSX.Element {
  return (
    <div className={`ah-banner ${TONE_CLASS[props.tone]}`} role={props.tone === 'error' ? 'alert' : 'status'}>
      <span aria-hidden="true">{TONE_GLYPH[props.tone]}</span>
      <span>{props.message}</span>
    </div>
  );
}

// ── MetricTile — a single stat that never shows a false-healthy value ─────────────────────────────
export function MetricTile<T>(props: {
  label: string;
  result: ReadResult<T>;
  format: (data: T) => string;
}): React.JSX.Element {
  const vs: ViewState<T> = resolveViewState(props.result);
  const value = renderMetric(vs, props.format);
  const summary = healthSummary(vs);
  // The value is NO_VALUE ('—') for any non-ok/stale read — never a fabricated 0/✓.
  return (
    <div className="ah-tile">
      <div className="ah-tile-label">{props.label}</div>
      <div className={`ah-tile-value ${TONE_CLASS[vs.tone]}`} aria-live="polite">
        {value}
      </div>
      <div className={`ah-badge ${TONE_CLASS[vs.tone]}`}>
        <span aria-hidden="true">{TONE_GLYPH[vs.tone]}</span>
        <span>{summaryLabel(summary, value)}</span>
      </div>
    </div>
  );
}

function summaryLabel(summary: 'ok' | 'attention' | 'unconfirmed', value: string): string {
  if (value === NO_VALUE) return summary === 'unconfirmed' ? "Can't confirm" : 'Unavailable';
  if (summary === 'ok') return 'Live';
  if (summary === 'attention') return 'Stale';
  return "Can't confirm";
}

// ── StatusBadge ──────────────────────────────────────────────────────────────────────────────────
export function StatusBadge(props: { tone: ViewTone; label: string }): React.JSX.Element {
  return (
    <span className={`ah-badge ${TONE_CLASS[props.tone]}`}>
      <span aria-hidden="true">{TONE_GLYPH[props.tone]}</span>
      <span>{props.label}</span>
    </span>
  );
}

// ── Presentational surface primitives (ISSUE-088/078/089) ─────────────────────────────────────────
// All server-safe (no state); interactive primitives with state live in ui.tsx ('use client'). Every
// one is a thin token-only renderer — no hardcoded styling, no permission/health logic of its own.

export function PageHeader(props: { title: string; lead?: string; actions?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="ah-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div className="ah-pagehead">
        <h1 className="ah-page-title" style={{ margin: 0 }}>{props.title}</h1>
        {props.lead ? <p className="ah-page-lead" style={{ margin: 0 }}>{props.lead}</p> : null}
      </div>
      {props.actions ? <div className="ah-row">{props.actions}</div> : null}
    </div>
  );
}

/** An honest empty state (a GENUINE zero — its own copy, distinct from error/stale which use banners). */
export function EmptyState(props: { message: string; glyph?: string; action?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="ah-emptystate">
      <div className="ah-emptystate-glyph" aria-hidden="true">{props.glyph ?? '◍'}</div>
      <div>{props.message}</div>
      {props.action ? <div style={{ marginTop: 'var(--space-3)' }}>{props.action}</div> : null}
    </div>
  );
}

/** Skeleton rows shown while loading — never a "0"/"✓" before data arrives (#3). */
export function SkeletonRows(props: { count?: number }): React.JSX.Element {
  const n = props.count ?? 4;
  return (
    <div role="status" aria-label="Loading" aria-busy="true">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="ah-skeleton ah-skeleton-row" />
      ))}
    </div>
  );
}

export interface Column<T> { key: string; header: string; cell: (row: T) => React.ReactNode; numeric?: boolean }

/** A simple, accessible, horizontally-scrollable table. Presentational only. */
export function DataTable<T>(props: {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  onRowActivate?: (row: T) => void;
  caption?: string;
}): React.JSX.Element {
  return (
    <div className="ah-table-wrap">
      <table className="ah-table">
        {props.caption ? <caption className="ah-muted" style={{ padding: 'var(--space-2)' }}>{props.caption}</caption> : null}
        <thead>
          <tr>{props.columns.map((c) => <th key={c.key} scope="col">{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr
              key={props.rowKey(row)}
              className={props.onRowActivate ? 'ah-row-clickable' : undefined}
              onClick={props.onRowActivate ? () => props.onRowActivate!(row) : undefined}
              tabIndex={props.onRowActivate ? 0 : undefined}
              onKeyDown={props.onRowActivate ? (e) => { if (e.key === 'Enter') props.onRowActivate!(row); } : undefined}
            >
              {props.columns.map((c) => (
                <td key={c.key} className={c.numeric ? 'ah-cell-num' : undefined}>{c.cell(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DescriptionList(props: { items: Array<{ term: string; detail: React.ReactNode }> }): React.JSX.Element {
  return (
    <dl className="ah-dl">
      {props.items.map((it, i) => (
        <React.Fragment key={i}>
          <dt>{it.term}</dt>
          <dd>{it.detail}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export function MetricRow(props: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="ah-metric-row">
      <span className="ah-metric-k">{props.label}</span>
      <span className="ah-metric-v">{props.value}</span>
    </div>
  );
}

/** A labelled form field wrapper (server-safe; the input itself is passed as children). */
export function Field(props: { label: string; htmlFor?: string; hint?: string; error?: string; required?: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="ah-field">
      <label className="ah-field-label" htmlFor={props.htmlFor}>
        {props.label}{props.required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {props.children}
      {props.hint ? <span className="ah-field-hint">{props.hint}</span> : null}
      {props.error ? <span className="ah-field-error"><span aria-hidden="true">▲</span>{props.error}</span> : null}
    </div>
  );
}

// ── AnswerModePill (NFR-OBS.012 seam) ────────────────────────────────────────────────────────────
export function AnswerModePill(props: { mode: AnswerMode | null | undefined }): React.JSX.Element {
  const d = answerModeDescriptor(props.mode);
  const toneClass =
    d.tone === 'ok' ? 'ah-tone-ok' : d.tone === 'info' ? 'ah-tone-info' : d.tone === 'stale' ? 'ah-tone-stale' : 'ah-tone-unknown';
  return (
    <span className={`ah-badge ${toneClass}`} title={d.detail} aria-label={`Answer mode: ${d.label}. ${d.detail}`}>
      <span aria-hidden="true">◆</span>
      <span>{d.label}</span>
    </span>
  );
}
