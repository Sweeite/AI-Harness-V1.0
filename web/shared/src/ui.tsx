'use client';

// ISSUE-088/078/089 — the INTERACTIVE design-system primitives (state-bearing, hence 'use client').
// Thin, token-only, a11y-baseline renderers reused across the surface render layer: a tab bar, a modal
// dialog (with a bottom-sheet variant for <768px per surface-00 UI-REAUTH-PROMPT), a right-hand detail
// drawer, and a disclosure. They hold NO permission/health logic — gating is done by the caller before
// an entry is ever passed in (absent-not-empty), exactly like the pure-logic nav gate.

import * as React from 'react';

// ── Tabs ──────────────────────────────────────────────────────────────────────────────────────────
export interface TabDef { id: string; label: string; count?: number; countTone?: 'error' | 'stale' }

/**
 * A controlled-by-URL-free tab bar. The caller passes ONLY the tabs the user may see (absent-not-empty);
 * this renders them and calls onSelect. Keyboard: arrow keys move focus, Enter/Space selects (roving).
 */
export function Tabs(props: { tabs: readonly TabDef[]; active: string; onSelect: (id: string) => void }): React.JSX.Element {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const next = (i + dir + props.tabs.length) % props.tabs.length;
    const target = props.tabs[next];
    if (!target) return;
    refs.current[next]?.focus();
    props.onSelect(target.id);
  };
  return (
    <div className="ah-tabbar" role="tablist" aria-label="Sections">
      {props.tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => { refs.current[i] = el; }}
          role="tab"
          type="button"
          id={`tab-${t.id}`}
          aria-selected={props.active === t.id}
          aria-controls={`panel-${t.id}`}
          tabIndex={props.active === t.id ? 0 : -1}
          className="ah-tab"
          onClick={() => props.onSelect(t.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          <span>{t.label}</span>
          {typeof t.count === 'number' ? (
            <span className={`ah-tab-count${t.countTone ? ` ah-tone-${t.countTone}` : ''}`}>{t.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

// ── Modal / dialog ──────────────────────────────────────────────────────────────────────────────
export function Modal(props: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  actions?: React.ReactNode;
  /** Render as a full-width bottom sheet on <768px (surface-00 re-auth prompt). */
  sheet?: boolean;
}): React.JSX.Element {
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    document.addEventListener('keydown', onEsc);
    ref.current?.querySelector<HTMLElement>('input, button, select, textarea, [tabindex]')?.focus();
    return () => document.removeEventListener('keydown', onEsc);
  }, [props]);
  return (
    <div className={`ah-modal-backdrop${props.sheet ? ' ah-sheet' : ''}`} onClick={props.onClose}>
      <div
        ref={ref}
        className="ah-modal"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="ah-modal-title">{props.title}</h2>
        {props.children}
        {props.actions ? <div className="ah-modal-actions">{props.actions}</div> : null}
      </div>
    </div>
  );
}

// ── Drawer (right-hand detail) ───────────────────────────────────────────────────────────────────
export function Drawer(props: { title: string; onClose: () => void; children: React.ReactNode }): React.JSX.Element {
  React.useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [props]);
  return (
    <>
      <div className="ah-drawer-backdrop" onClick={props.onClose} />
      <aside className="ah-drawer" role="dialog" aria-modal="true" aria-label={props.title}>
        <div className="ah-drawer-head">
          <h2 className="ah-panel-title" style={{ margin: 0 }}>{props.title}</h2>
          <button type="button" className="ah-btn ah-btn-sm" onClick={props.onClose} aria-label="Close detail">Close</button>
        </div>
        {props.children}
      </aside>
    </>
  );
}

// ── Disclosure (collapsed operator sign-in, etc.) ────────────────────────────────────────────────
export function Disclosure(props: { summary: string; children: React.ReactNode; defaultOpen?: boolean }): React.JSX.Element {
  const [open, setOpen] = React.useState(props.defaultOpen ?? false);
  return (
    <div>
      <button type="button" className="ah-disclosure-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {props.summary}
      </button>
      {open ? <div style={{ marginTop: 'var(--space-3)' }}>{props.children}</div> : null}
    </div>
  );
}
