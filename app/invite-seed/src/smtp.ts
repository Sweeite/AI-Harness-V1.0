// ISSUE-015 — the custom-SMTP delivery seam (FR-0.INV.003 / FR-0.INV.007). Custom SMTP is MANDATORY for
// prod (the Supabase built-in is 2 emails/hr, demo-only — [SA14]). This module is the #3 ("never fail
// silently") control at the send edge: a not-configured / throttled / errored send is surfaced to the issuer
// as an EXPLICIT failure — never a false "sent" (AC-0.INV.003.1). Bounce (async, best-effort where the
// provider exposes it) marks the invite undelivered + re-alerts (AC-0.INV.007.1); full bounce reconciliation
// is OOS-015.
//
// Config (schema.md §CFG / config-registry): auth.smtp_* is SECRET-class (never in operator custody —
// ADR-001). This slice only READS "is SMTP configured?"; it does not own the smtp_* keys.

/** A single email send request (invite or seed setup link). */
export interface SmtpMessage {
  to: string;
  subject: string;
  /** the native ≤24h setup link (invite or seed). */
  setupLink: string;
}

/** The outcome of a send attempt. `ok` false ALWAYS carries a reason the issuer can see — the send edge
 *  never returns a bare boolean that a caller could mistake for success. */
export interface SendResult {
  ok: boolean;
  /** present iff !ok — the explicit, issuer-visible failure reason (#3). */
  reason?: string;
  /** the delivery state to stamp on the invite: 'sent_unconfirmed' on success (no bounce guarantee),
   *  'send_failed' on a send-side failure. */
  state: 'sent_unconfirmed' | 'send_failed';
}

/** The custom-SMTP delivery port. The live adapter (a real nodemailer/provider client) implements this; the
 *  fake below is the reference model that drives the not-configured / throttled failure paths offline. */
export interface SmtpSender {
  /** true iff custom SMTP is configured (auth.smtp_* present). When false, send() MUST fail explicitly. */
  isConfigured(): boolean;
  send(msg: SmtpMessage): Promise<SendResult>;
}

export const ERR_SMTP_NOT_CONFIGURED =
  'custom SMTP is not configured (auth.smtp_* missing) — the invite/seed email was NOT sent; ' +
  'configure custom SMTP and re-issue (FR-0.INV.003 / AC-0.INV.003.1 — never a silent drop, #3)';

export const ERR_SMTP_SEND_THROTTLED =
  'custom SMTP rejected the send (throttled / provider error) — the invite/seed email was NOT delivered; ' +
  'this is surfaced to the issuer, never a false "sent" (FR-0.INV.003 / #3)';

/** Fault injection for the fake so a test drives the two silent-failure risks explicitly. */
export interface SmtpFaultConfig {
  /** simulate auth.smtp_* absent → isConfigured() false → every send fails explicitly. */
  notConfigured?: boolean;
  /** simulate a configured-but-throttled/errored provider → send() fails explicitly. */
  throttled?: boolean;
}

/** In-memory reference SMTP sender. Records every attempt; a not-configured or throttled sender returns an
 *  EXPLICIT failure (not an exception a caller might swallow into a "sent"). Deterministic — no clock/random. */
export class InMemorySmtpSender implements SmtpSender {
  readonly sent: SmtpMessage[] = [];
  readonly failed: Array<{ msg: SmtpMessage; reason: string }> = [];

  constructor(private readonly faults: SmtpFaultConfig = {}) {}

  isConfigured(): boolean {
    return !this.faults.notConfigured;
  }

  async send(msg: SmtpMessage): Promise<SendResult> {
    if (!this.isConfigured()) {
      // The classic silent failure this FR closes: SMTP unset → the invite "silently looks like nothing
      // happened". We surface it as an explicit issuer-visible failure instead (#3).
      const reason = ERR_SMTP_NOT_CONFIGURED;
      this.failed.push({ msg, reason });
      return { ok: false, reason, state: 'send_failed' };
    }
    if (this.faults.throttled) {
      const reason = ERR_SMTP_SEND_THROTTLED;
      this.failed.push({ msg, reason });
      return { ok: false, reason, state: 'send_failed' };
    }
    this.sent.push(msg);
    // 'sent_unconfirmed', NOT 'delivered': a provider without a bounce webhook cannot confirm delivery, so we
    // never over-claim (FR-0.INV.007 branch). A later bounce (markBounced on the store) downgrades this.
    return { ok: true, state: 'sent_unconfirmed' };
  }
}
