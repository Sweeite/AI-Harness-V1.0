// ISSUE-011 §8 step 1 — "schema is present (from ISSUE-008)". This VERIFIES the 0001_baseline already
// created what this slice depends on; it NEVER re-creates. An absence here is an ISSUE-008 gap to REPORT,
// not to patch. The check reads app/silo/migrations/0001_baseline.sql as text and asserts the presence of
// the objects named in §8 step 1: event_log, notifications, the four enums, the redacted_at column on
// event_log, and the t_append_only trigger bound to event_log.

import { readFileSync } from "node:fs";

export interface PresenceCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export function checkSchemaPresence(baselineSql: string): PresenceCheck[] {
  const checks: PresenceCheck[] = [];
  const has = (re: RegExp) => re.test(baselineSql);

  const req = (name: string, re: RegExp, detail: string) =>
    checks.push({ name, ok: has(re), detail });

  req("event_log table", /create table event_log\b/, "event_log created by 0001_baseline");
  req("notifications table", /create table notifications\b/, "notifications created by 0001_baseline");
  req("event_type enum", /create type event_type\b/, "event_type enum created");
  req("alert_type enum", /create type alert_type\b/, "alert_type enum created");
  req("notification_read enum", /create type notification_read\b/, "notification_read enum created");
  req("answer_mode enum", /create type answer_mode\b/, "answer_mode enum created");
  req(
    "event_log.redacted_at column",
    /create table event_log\b[\s\S]*?redacted_at\b[\s\S]*?\);/,
    "redacted_at column present on event_log (redaction-tombstone target)",
  );
  req(
    "cost_unknown column",
    /create table event_log\b[\s\S]*?cost_unknown\b[\s\S]*?\);/,
    "cost_unknown sentinel column present on event_log",
  );
  req(
    "t_append_only on event_log",
    /create trigger t_append_only[\s\S]*?on event_log\b/,
    "the append-only immutability trigger is bound to event_log",
  );
  req(
    "enforce_audit_append_only()",
    /create or replace function enforce_audit_append_only\(\)/,
    "the shared append-only trigger function exists",
  );
  return checks;
}

export function readBaseline(path: string): string {
  return readFileSync(path, "utf8");
}
