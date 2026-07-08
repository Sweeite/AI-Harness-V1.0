'use client';

// ISSUE-087 — the light/dark theme toggle. Stamps `data-theme` on <html> so the viewer's explicit choice
// wins over the OS `prefers-color-scheme` (tokens.css defines both themes). Persists to localStorage. This
// is the ONLY place theme state lives; components never branch on theme — they consume semantic tokens that
// resolve per-theme, so a reskin needs no component change.

import * as React from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'ah-theme';

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}

export function ThemeToggle(): React.JSX.Element {
  const [theme, setTheme] = React.useState<Theme | null>(null);

  React.useEffect(() => {
    const stored = (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY)) as Theme | null;
    const initial: Theme =
      stored ?? (typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(initial);
    applyTheme(initial);
  }, []);

  function toggle(): void {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, next);
  }

  // Render a stable label pre-hydration to avoid a flash; the icon carries a text label (not colour-only).
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button type="button" className="ah-btn" onClick={toggle} aria-label={label} title={label}>
      <span aria-hidden="true">{theme === 'dark' ? '☾' : '☀'}</span>
      <span>{theme === 'dark' ? 'Dark' : 'Light'}</span>
    </button>
  );
}
