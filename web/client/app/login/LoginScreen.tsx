'use client';

// ISSUE-088 — surface-00 UI-LOGIN + UI-2FA-CHALLENGE (a same-page step, FR-0.AUTH.007). Renders the auth
// trust boundary: OAuth primary, a collapsed operator email/password disclosure (OD-105), a FAIL-CLOSED
// CAPTCHA (submit disabled if the widget can't load — #2), a "Trouble signing in?" support modal (public
// insert-only intake), and every login error state made visible (#3 — never a silent dead end).
//
// On the 087 dev-auth / seeded path there is no live OAuth (that is OD-175 onboarding): the OAuth and
// operator paths sign in through the seeded-dev session action so the RBAC shell is clickable. The dev
// role picker is the seeded affordance that lets the operator watch the nav change per role. All of it is
// clearly flagged "Dev session — seeded, no live DB" so it is never mistaken for live auth.

import * as React from 'react';
import { Disclosure, Modal, Field } from '@harness/web-shared';

import type { Role } from '../../lib/rbac-seam.ts';

const CAPTCHA_FAIL_MSG = 'Couldn’t load the security check — refresh to retry.';
const AUTH_COPY: Record<string, string> = {
  badcreds: 'Email or password is incorrect.',
  rejected: "This account isn’t permitted to sign in here.",
  locked: 'Too many attempts. This account is temporarily locked. Try again in a few minutes or use “Trouble signing in?”.',
  oauth: 'Sign-in with the provider didn’t complete. Try again.',
  offline: 'You appear to be offline. Check your connection and try again.',
  config: 'Sign-in is not configured for this deployment. Contact your administrator.',
};

export function LoginScreen(props: {
  live: boolean;
  roles: readonly Role[];
  signInAs: (role: Role, withMfa: boolean) => Promise<void>;
  submitSupport: (formData: FormData) => Promise<{ ok: boolean; message: string }>;
}): React.JSX.Element {
  const [step, setStep] = React.useState<'credentials' | '2fa'>('credentials');
  const [captchaFailed, setCaptchaFailed] = React.useState(false);
  const [errorKey, setErrorKey] = React.useState<string | null>(null);
  const [trouble, setTrouble] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  // ── 2FA challenge step (same-page swap, no redirect) ──
  if (step === '2fa') {
    return (
      <Card>
        <h1 className="ah-page-title">Enter your authentication code</h1>
        <p className="ah-page-lead">A valid 6-digit code from your authenticator app is required — there is no bypass.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            // Demo: any 6-digit code elevates the seeded session to aal2 (real TOTP verify is ISSUE-014).
            await props.signInAs('Super Admin', true);
          }}
        >
          <Field label="6-digit code" htmlFor="totp" hint="Codes refresh every 30 seconds.">
            <input id="totp" name="totp" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              className="ah-input ah-code-input" placeholder="••••••" required />
          </Field>
          <div className="ah-modal-actions" style={{ justifyContent: 'space-between' }}>
            <button type="button" className="ah-btn" onClick={() => setStep('credentials')}>Back</button>
            <button type="submit" className="ah-btn ah-btn-accent" disabled={pending}>
              {pending ? <><span className="ah-spinner" aria-hidden="true" /> Verifying…</> : 'Verify'}
            </button>
          </div>
        </form>
        <DevNote />
      </Card>
    );
  }

  // ── Credentials step (UI-LOGIN) ──
  return (
    <Card>
      <div className="ah-brand" style={{ marginBottom: 'var(--space-4)' }}>
        <span className="ah-brand-dot" aria-hidden="true" />
        <span>Harness</span>
      </div>
      <h1 className="ah-page-title">Sign in</h1>
      <p className="ah-page-lead">
        Sign in to your workspace. Client accounts use single sign-on; external administrators use the operator path.
      </p>

      {errorKey ? (
        <div className="ah-banner ah-tone-error" role="alert" style={{ marginBottom: 'var(--space-4)' }}>
          <span aria-hidden="true">▲</span>
          <span>{AUTH_COPY[errorKey] ?? 'Sign-in failed.'}</span>
        </div>
      ) : null}

      {/* OAuth primary */}
      <form action={props.signInAs.bind(null, 'Standard User', true)}>
        <button type="submit" className="ah-btn ah-btn-accent" style={{ width: '100%', justifyContent: 'center' }}>
          Continue with single sign-on
        </button>
      </form>

      <p className="ah-muted" style={{ margin: 'var(--space-3) 0' }}>
        <button type="button" className="ah-disclosure-btn" onClick={() => setTrouble(true)}>Trouble signing in?</button>
      </p>

      <hr className="ah-divider" />

      {/* Operator email/password — collapsed disclosure (OD-105) */}
      <Disclosure summary="Operator / admin sign-in">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (captchaFailed) return; // fail-closed: cannot submit without the CAPTCHA
            setStep('2fa'); // correct creds advance same-page to the 2FA challenge
          }}
        >
          <Field label="Email" htmlFor="op-email"><input id="op-email" type="email" className="ah-input" autoComplete="username" required /></Field>
          <Field label="Password" htmlFor="op-pw"><input id="op-pw" type="password" className="ah-input" autoComplete="current-password" required /></Field>

          {/* Fail-closed CAPTCHA (#2) */}
          <div className="ah-field">
            <span className="ah-field-label">Security check</span>
            {captchaFailed ? (
              <div className="ah-banner ah-tone-error" role="alert"><span aria-hidden="true">▲</span><span>{CAPTCHA_FAIL_MSG}</span></div>
            ) : (
              <div className="ah-banner ah-tone-ok"><span aria-hidden="true">●</span><span>Security check passed.</span></div>
            )}
            <label className="ah-field-hint" style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
              <input type="checkbox" checked={captchaFailed} onChange={(e) => setCaptchaFailed(e.target.checked)} />
              Simulate CAPTCHA load failure (demo — disables submit, fail-closed)
            </label>
          </div>

          <button type="submit" className="ah-btn" style={{ width: '100%' }} disabled={captchaFailed} aria-disabled={captchaFailed}>
            Sign in
          </button>
          {captchaFailed ? <p className="ah-field-error" style={{ marginTop: 'var(--space-2)' }}><span aria-hidden="true">▲</span>Submit is disabled until the security check loads.</p> : null}
        </form>
      </Disclosure>

      {/* Error-state previewer (dev only — lets the operator see every honest failure state live) */}
      <details style={{ marginTop: 'var(--space-4)' }}>
        <summary className="ah-muted">Preview login error states (demo)</summary>
        <div className="ah-row" style={{ marginTop: 'var(--space-2)' }}>
          {Object.keys(AUTH_COPY).map((k) => (
            <button key={k} type="button" className="ah-chip" aria-pressed={errorKey === k} onClick={() => setErrorKey(errorKey === k ? null : k)}>{k}</button>
          ))}
        </div>
      </details>

      <hr className="ah-divider" />

      {/* Seeded-dev role picker — the essential "watch the RBAC nav change per role" affordance */}
      <div>
        <div className="ah-dev-banner" style={{ marginBottom: 'var(--space-3)' }}>Dev session — seeded, no live DB. Pick a role to preview its RBAC-scoped shell.</div>
        <div className="ah-role-grid">
          {props.roles.map((role) => (
            <form key={role} action={props.signInAs.bind(null, role, true)}>
              <button type="submit" className="ah-btn" style={{ width: '100%', justifyContent: 'space-between' }}>
                <span>Continue as {role}</span><span aria-hidden="true">→</span>
              </button>
            </form>
          ))}
          <form action={props.signInAs.bind(null, 'Super Admin', false)}>
            <button type="submit" className="ah-btn" style={{ width: '100%' }}>
              Super Admin — sign in <em>without</em> 2FA (to see the aal2 step-up gate)
            </button>
          </form>
        </div>
      </div>

      {trouble ? <TroubleModal onClose={() => setTrouble(false)} submit={props.submitSupport} /> : null}
    </Card>
  );
}

function TroubleModal(props: { onClose: () => void; submit: (fd: FormData) => Promise<{ ok: boolean; message: string }> }): React.JSX.Element {
  const [result, setResult] = React.useState<{ ok: boolean; message: string } | null>(null);
  return (
    <Modal
      title="Trouble signing in?"
      onClose={props.onClose}
      actions={result?.ok ? <button className="ah-btn ah-btn-accent" onClick={props.onClose}>Done</button> : null}
    >
      {result?.ok ? (
        <div className="ah-banner ah-tone-ok"><span aria-hidden="true">●</span><span>{result.message}</span></div>
      ) : (
        <form
          action={async (fd) => {
            const r = await props.submit(fd);
            setResult(r);
          }}
        >
          <p className="ah-page-lead">Tell us what’s happening and an administrator will follow up. This does not reveal whether an account exists.</p>
          <Field label="Your email" htmlFor="t-email"><input id="t-email" name="email" type="email" className="ah-input" required /></Field>
          <Field label="Your name" htmlFor="t-name"><input id="t-name" name="name" className="ah-input" required /></Field>
          <Field label="What’s the problem?" htmlFor="t-issue"><textarea id="t-issue" name="issue" className="ah-textarea" rows={3} required /></Field>
          {result && !result.ok ? <p className="ah-field-error"><span aria-hidden="true">▲</span>{result.message}</p> : null}
          <div className="ah-modal-actions">
            <button type="button" className="ah-btn" onClick={props.onClose}>Cancel</button>
            <button type="submit" className="ah-btn ah-btn-accent">Send request</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function Card(props: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="ah-login-wrap">
      <main className="ah-login-card">{props.children}</main>
    </div>
  );
}

function DevNote(): React.JSX.Element {
  return <p className="ah-muted" style={{ marginTop: 'var(--space-4)' }}>Dev session — seeded, no live DB. Real TOTP verification is ISSUE-014.</p>;
}
