// @harness/web-shared — the ISSUE-087 substrate core barrel.
// Pure logic (framework-free, proven with tsx --test) + the thin React component layer + the theme toggle.
// The two Next apps import EVERYTHING they need for the shell from here — one shared design system.

// ── Pure logic (the proven core) ──
export {
  visibleNav,
  navSections,
  CLIENT_NAV,
  ADMIN_NAV,
  type NavEntry,
} from './nav.ts';
export {
  resolveViewState,
  renderMetric,
  healthSummary,
  NO_VALUE,
  type ReadResult,
  type ViewState,
  type ViewTone,
} from './honest-state.ts';
export { answerModeDescriptor, type AnswerMode, type AnswerModeDescriptor } from './answer-mode.ts';
export {
  makeDataSeam,
  type DataSeam,
  type SeamCaller,
  type SeamRead,
  type SeamOutcome,
  type Clock,
} from './seam.ts';
export { readSeeded, simFrom, type Sim } from './seeded-read.ts';

// ── React component layer (thin renderers) ──
export {
  NavRail,
  AppShell,
  Panel,
  HonestState,
  StatusBanner,
  MetricTile,
  StatusBadge,
  AnswerModePill,
  PageHeader,
  EmptyState,
  SkeletonRows,
  DataTable,
  DescriptionList,
  MetricRow,
  Field,
  type Column,
} from './components.tsx';
export { Tabs, Modal, Drawer, Disclosure, type TabDef } from './ui.tsx';
export { ThemeToggle, applyTheme, type Theme } from './theme.tsx';
