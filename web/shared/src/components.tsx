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
