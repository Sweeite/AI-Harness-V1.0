'use client';

// ISSUE-088 — surface-00 UI-INVITE-SETUP (+ UI-2FA-ENROLL as its operator step). A valid token resolves to
// the account's ONE setup method (OD-020): client-tenant → connect SSO (Option A, activates with NO
// password — AC-0.INV.004.2); external operator → set password then enroll TOTP (Option B, enrolling TOTP
// is what activates the account — AC-0.INV.004.1). An invalid/expired token renders an ERROR (with "request
// a new link" → support), never the form. Abandoning TOTP leaves the account NOT activated (no half-account).

import * as React from 'react';
import { Field } from '@harness/web-shared';

import type { Role } from '../../lib/rbac-seam.ts';

export function SetupScreen(props: {
  token: 'valid' | 'expired' | 'invalid';
  accountType: 'client' | 'operator';
  role: Role;
  activate: () => void | Promise<void>; // a pre-bound server action (role + mfa already bound)
}): React.JSX.Element {
  const [step, setStep] = React.useState<'method' | 'enroll'>('method');
  const [qrFailed, setQrFailed] = React.useState(false);

  if (props.token !== 'valid') {
    const msg = props.token === 'expired'
      ? 'This setup link has expired (links are valid for up to 24 hours).'
      : 'This setup link is no longer valid.';
    return (
      <Card>
        <h1 className="ah-page-title">Set up your account</h1>
        <div className="ah-banner ah-tone-error" role="alert"><span aria-hidden="true">▲</span><span>{msg}</span></div>
        <p className="ah-page-lead" style={{ marginTop: 'var(--space-4)' }}>
          Ask your administrator for a fresh invite, or <a href="/login">use “Trouble signing in?” on the sign-in page</a>.
        </p>
      </Card>
    );
  }

  if (step === 'enroll') {
    // UI-2FA-ENROLL
    return (
      <Card>
        <h1 className="ah-page-title">Set up two-factor authentication</h1>
        <p className="ah-page-lead">Scan the QR with an authenticator app (e.g. Google Authenticator), then enter the 6-digit code.</p>
        {qrFailed ? (
          <div className="ah-banner ah-tone-stale" style={{ marginBottom: 'var(--space-3)' }}>
            <span aria-hidden="true">◐</span><span>Can’t see the QR? Enter this key in your app instead.</span>
          </div>
        ) : (
          <div aria-label="Enrollment QR code" role="img" style={{ width: 160, height: 160, margin: '0 auto var(--space-3)', display: 'grid', placeItems: 'center', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
            <span className="ah-muted">QR</span>
          </div>
        )}
        <Field label="Manual-entry secret (fallback)" htmlFor="secret">
          <input id="secret" className="ah-input ah-mono" readOnly value="JBSW Y3DP EHPK 3PXP" />
        </Field>
        <label className="ah-field-hint" style={{ display: 'flex', gap: 'var(--space-2)', margin: 'var(--space-1) 0 var(--space-3)' }}>
          <input type="checkbox" checked={qrFailed} onChange={(e) => setQrFailed(e.target.checked)} /> Simulate QR image failure (demo — shows the manual key)
        </label>
        <form action={props.activate}>
          <Field label="6-digit code" htmlFor="enroll-code" hint="Retry as many times as you need — the lockout is on the sign-in challenge, not here.">
            <input id="enroll-code" name="code" inputMode="numeric" maxLength={6} className="ah-input ah-code-input" placeholder="••••••" required />
          </Field>
          <button type="submit" className="ah-btn ah-btn-accent" style={{ width: '100%' }}>Verify &amp; enable</button>
        </form>
      </Card>
    );
  }

  // UI-INVITE-SETUP — method choice
  return (
    <Card>
      <h1 className="ah-page-title">Set up your account</h1>
      <p className="ah-page-lead">You’ve been invited as <strong>{props.role}</strong>. Choose how you’ll sign in.</p>
      {props.accountType === 'client' ? (
        <form action={props.activate}>
          <button type="submit" className="ah-btn ah-btn-accent" style={{ width: '100%', justifyContent: 'center' }}>
            Connect with single sign-on
          </button>
          <p className="ah-field-hint" style={{ marginTop: 'var(--space-2)' }}>No password is set — you’ll sign in with your identity provider.</p>
        </form>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); setStep('enroll'); }}>
          <Field label="Email" htmlFor="s-email"><input id="s-email" type="email" className="ah-input" required /></Field>
          <Field label="Create a password" htmlFor="s-pw"><input id="s-pw" type="password" className="ah-input" autoComplete="new-password" required /></Field>
          <button type="submit" className="ah-btn ah-btn-accent" style={{ width: '100%' }}>Set password &amp; continue</button>
          <p className="ah-field-hint" style={{ marginTop: 'var(--space-2)' }}>Next you’ll enroll two-factor authentication — that step activates your account.</p>
        </form>
      )}
      <p className="ah-muted" style={{ marginTop: 'var(--space-4)' }}>
        Preview the operator path: <a href="/setup?token=valid&type=operator">operator invite</a> · client path: <a href="/setup?token=valid&type=client">client invite</a> · <a href="/setup?token=expired">expired</a> · <a href="/setup?token=bad">invalid</a>
      </p>
    </Card>
  );
}

function Card(props: { children: React.ReactNode }): React.JSX.Element {
  return <div className="ah-login-wrap"><main className="ah-login-card">{props.children}</main></div>;
}
