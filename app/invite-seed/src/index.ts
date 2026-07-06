// @harness/invite-seed — ISSUE-015 (C0 identity & access, INV + SEED areas). Public surface: the domain
// types (types.ts), the custom-SMTP delivery port + fake (smtp.ts), the InviteSeedStore port + in-memory
// fake reference model (store.ts) + the live pg adapter (supabase-store.ts).
//
// Consumers / seams: ISSUE-021 (UI-USER-MGMT renders the invite/revoke/resend actions this slice provides),
// ISSUE-013 (OAuth login + session — the Option-A connect + the post-activation session), ISSUE-014
// (password + TOTP factor — the Option-B branch), ISSUE-018 (PERM-user.invite node + can() gate + role
// assignment / default-view definitions — consumed here as a boolean gate + a role read), ISSUE-016
// (support_requests intake — the invalid/expired setup token routes into it, FR-0.REC.002 seam).
//
// The `check` CLI runs the offline build-time gates (no DB, no network) — the invariants that must hold by
// construction so drift is caught before integration:
//   (1) INVITE-ONLY — self-registration is always refused (AC-0.INV.001.1).
//   (2) SMTP-FAIL-LOUD — a not-configured SMTP send surfaces an EXPLICIT failure, never a false "sent"
//       (AC-0.INV.003.1 / #3).
//   (3) TTL-CAPPED — every issued link expires ≤24h even if a larger TTL is requested (AC-0.INV.002.1 /
//       AF-074, offline portion).
//   (4) SEED-ONCE — the atomic guard mints exactly one Super Admin under concurrency; env-unset aborts;
//       there is no UI seed trigger (AC-0.SEED.001/.002/.003).

export {
  LINK_TTL_HARD_CAP_SECONDS,
  SAFE_NO_ACCESS_VIEW,
  type AccountType,
  type Activation,
  type DeliveryState,
  type Invite,
  type InviteState,
  type LinkOrigin,
  type SetupMethod,
} from './types.ts';
export {
  InMemorySmtpSender,
  ERR_SMTP_NOT_CONFIGURED,
  ERR_SMTP_SEND_THROTTLED,
  type SmtpFaultConfig,
  type SmtpMessage,
  type SmtpSender,
  type SendResult,
} from './smtp.ts';
export {
  InMemoryInviteSeedStore,
  ROLE_DEFAULT_VIEW,
  SUPER_ADMIN_ROLE,
  INVITE_SEED_EVENT_TYPES,
  isInviteSeedEventType,
  ERR_SEED_ENV_UNSET,
  ERR_INVITE_DENIED,
  ERR_PUBLIC_SIGNUP_OFF,
  ERR_TOKEN_INVALID,
  ERR_METHOD_MISMATCH,
  ERR_UNADMITTED_EVENT_TYPE,
  type InviteSeedEventType,
  type AuditEvent,
  type CompleteSetupInput,
  type EventLogEntry,
  type InviteSeedStore,
  type IssueInviteInput,
  type IssueOutcome,
  type SeedOutcome,
} from './store.ts';
export { SupabaseInviteSeedStore } from './supabase-store.ts';

import { InMemoryInviteSeedStore } from './store.ts';
import { InMemorySmtpSender } from './smtp.ts';
import { LINK_TTL_HARD_CAP_SECONDS } from './types.ts';
import { SupabaseInviteSeedStore } from './supabase-store.ts';

interface Finding {
  gate: string;
  ok: boolean;
  detail: string;
}

const T0 = 1_700_000_000; // fixed epoch seconds (deterministic).

async function runChecks(): Promise<Finding[]> {
  const findings: Finding[] = [];

  // (1) INVITE-ONLY — self-registration is always refused, no account created.
  {
    const store = new InMemoryInviteSeedStore();
    let refused = false;
    try {
      await store.attemptSelfRegister('stranger@example.com');
    } catch {
      refused = true;
    }
    findings.push({ gate: 'invite-only', ok: refused && store.profiles.size === 0, detail: `self-register refused=${refused}, accounts=${store.profiles.size}` });
  }

  // (2) SMTP-FAIL-LOUD — SMTP not configured → issue returns an EXPLICIT failure (not sent), never silent.
  {
    const store = new InMemoryInviteSeedStore();
    const smtp = new InMemorySmtpSender({ notConfigured: true });
    const out = await store.issueInvite(
      { email: 'invitee@example.com', accountType: 'client_tenant', issuedBy: 'admin-1', canInvite: true, now: T0 },
      smtp,
    );
    const surfaced = store.eventLog().some((e) => e.event_type === 'email_send_failed');
    findings.push({ gate: 'smtp-fail-loud', ok: out.sent === false && !!out.sendFailureReason && surfaced, detail: `sent=${out.sent}, reasonSurfaced=${surfaced}` });
  }

  // (3) TTL-CAPPED — request a 72h TTL, the issued link still expires ≤24h (AF-074 offline portion).
  {
    const store = new InMemoryInviteSeedStore();
    const smtp = new InMemorySmtpSender();
    const out = await store.issueInvite(
      { email: 'i@example.com', accountType: 'client_tenant', issuedBy: 'admin-1', canInvite: true, ttlSeconds: 72 * 3600, now: T0 },
      smtp,
    );
    const ttl = out.invite.expiresAt - out.invite.issuedAt;
    findings.push({ gate: 'ttl-capped', ok: ttl <= LINK_TTL_HARD_CAP_SECONDS, detail: `requested=259200s, actual=${ttl}s, cap=${LINK_TTL_HARD_CAP_SECONDS}s` });
  }

  // (4a) SEED-ONCE (concurrency) — two seed runs on first boot mint exactly one Super Admin.
  {
    const store = new InMemoryInviteSeedStore();
    const smtp = new InMemorySmtpSender();
    const [a, b] = await Promise.all([
      store.runSeed('boss@example.com', smtp, T0),
      store.runSeed('boss@example.com', smtp, T0),
    ]);
    const created = [a, b].filter((r) => r.created).length;
    const admins = [...store.userRoles.values()].filter((r) => r === 'Super Admin').length;
    findings.push({ gate: 'seed-once-concurrent', ok: created === 1 && admins === 1, detail: `creations=${created}, superAdmins=${admins}` });
  }

  // (4b) SEED env-unset aborts loudly; no UI trigger exists.
  {
    const store = new InMemoryInviteSeedStore();
    const smtp = new InMemorySmtpSender();
    let aborted = false;
    let noUi = false;
    try {
      await store.runSeed(undefined, smtp, T0);
    } catch {
      aborted = true;
    }
    try {
      await store.triggerSeedFromUi();
    } catch {
      noUi = true;
    }
    findings.push({ gate: 'seed-guards', ok: aborted && noUi, detail: `envUnsetAborts=${aborted}, noUiTrigger=${noUi}` });
  }

  return findings;
}

async function main(): Promise<void> {
  const findings = await runChecks();
  let failed = 0;
  for (const f of findings) {
    const mark = f.ok ? 'PASS' : 'FAIL';
    if (!f.ok) failed++;
    console.log(`[${mark}] ${f.gate} — ${f.detail}`);
  }
  if (failed > 0) {
    console.error(`\n${failed} build-time gate(s) failed.`);
    process.exit(1);
  }
  console.log(`\nall ${findings.length} build-time gates passed.`);
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly && process.argv[2] === 'check') {
  void main();
}

// referenced so the live adapter import isn't flagged unused when the CLI branch is not taken
void SupabaseInviteSeedStore;
