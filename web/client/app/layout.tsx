// ISSUE-087 — the client-deployment root layout. Imports the SHARED design system (tokens = the swappable
// skin, then the component structural CSS), then a thin app reset. No skin lives in this app.
import '@harness/web-shared/src/tokens.css';
import '@harness/web-shared/src/components.css';
import './globals.css';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Harness — Client Deployment',
  description: 'ISSUE-087 frontend substrate — the per-client deployment app shell.',
};

export default function RootLayout({ children }: { children: ReactNode }): React.JSX.Element {
  // suppressHydrationWarning: the theme toggle stamps data-theme on <html> client-side (viewer's choice
  // wins over the OS preference) — the attribute legitimately differs between server and first client paint.
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
