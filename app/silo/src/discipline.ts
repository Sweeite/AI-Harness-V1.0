// Expand-contract discipline guardrails — the static (CI/review) enforcement of the binding rules in
// spec/00-foundations/standards/migration-discipline.md. This is the mechanised form of
// AC-NFR-INF.002.1 ("any authored migration contains no destructive change relied on by the prior
// build — add-then-later-remove only"), plus the other hard constraints (migrations.md L67-76).
//
// It is a TEXT-level check (no live DB): it reads the migration SQL and flags violations. A DESTRUCTIVE
// finding is a hard failure; the others are hard failures too but scoped to the migration classes they
// apply to (a dedicated *_contract migration is the ONLY place a drop/rename is allowed).

export type Rule =
  | "no-destructive-change" // AC-NFR-INF.002.1 — no DROP/RENAME outside a contract migration
  | "new-column-nullable-or-default" // no bare NOT NULL add-column on a populated table
  | "heavy-index-concurrently" // standalone index builds must be CONCURRENTLY
  | "seed-idempotent"; // every seed INSERT is guarded (on conflict / where not exists)

export interface Finding {
  rule: Rule;
  tag: string;
  line: number;
  snippet: string;
  message: string;
}

// Strip `-- ...` line comments and blank the insides of $$-quoted bodies so keywords in comments /
// plpgsql exception strings ("DELETE forbidden", etc.) never trip the scanners. Line count preserved.
function sanitise(sql: string): string[] {
  const lines = sql.split("\n").map((l) => l.replace(/--.*$/, ""));
  // Blank out dollar-quoted blocks ($$ ... $$) — function bodies aren't schema changes.
  let inDollar = false;
  return lines.map((l) => {
    const hasMarker = /\$\$/.test(l);
    if (inDollar) {
      const out = "";
      if (hasMarker) inDollar = false;
      return out;
    }
    if (hasMarker && (l.match(/\$\$/g) ?? []).length === 1) {
      inDollar = true;
      return l.replace(/\$\$.*$/, "");
    }
    return l;
  });
}

const DESTRUCTIVE = /\b(drop\s+(table|column|type|index|constraint|trigger|policy|schema)|rename\s+(to|column|constraint))\b/i;
const ADD_COLUMN = /\badd\s+column\b/i;
const NOT_NULL = /\bnot\s+null\b/i;
const HAS_DEFAULT = /\bdefault\b/i;
const STANDALONE_INDEX = /\bcreate\s+(unique\s+)?index\b/i;
const CONCURRENTLY = /\bconcurrently\b/i;

export function checkMigration(tag: string, sql: string): Finding[] {
  const findings: Finding[] = [];
  const lines = sanitise(sql);
  const isContract = /contract/i.test(tag);
  const isSeed = /seed/i.test(tag);

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    const snippet = line.trim().slice(0, 120);

    // R1 — no destructive change outside a dedicated *_contract migration (AC-NFR-INF.002.1).
    if (DESTRUCTIVE.test(line) && !isContract) {
      findings.push({
        rule: "no-destructive-change",
        tag,
        line: lineNo,
        snippet,
        message:
          "DROP/RENAME is a destructive change — it belongs only in a later, dedicated *_contract migration once no deployment reads the old shape (migration-discipline.md L35-46; AC-NFR-INF.002.1).",
      });
    }

    // R2 — an ADD COLUMN must be nullable or defaulted (never bare NOT NULL on a populated table).
    if (ADD_COLUMN.test(line) && NOT_NULL.test(line) && !HAS_DEFAULT.test(line)) {
      findings.push({
        rule: "new-column-nullable-or-default",
        tag,
        line: lineNo,
        snippet,
        message:
          "ADD COLUMN ... NOT NULL without a DEFAULT breaks the prior code against the new schema — add nullable/defaulted, backfill, then tighten (migration-discipline.md L37).",
      });
    }

    // R3 — a standalone index build must be CONCURRENTLY (inline PK/UNIQUE inside CREATE TABLE are not
    // `create index` statements, so they are never matched here).
    if (STANDALONE_INDEX.test(line) && !CONCURRENTLY.test(line)) {
      findings.push({
        rule: "heavy-index-concurrently",
        tag,
        line: lineNo,
        snippet,
        message:
          "Index builds must run CONCURRENTLY so a deploy never locks the table (migration-discipline.md L39).",
      });
    }
  });

  // R4 — seed idempotency: every INSERT in a *seed* migration must be guarded (on conflict / where not
  // exists) so re-running writes nothing new (migrations.md hard constraint). Statement-scoped.
  if (isSeed) {
    for (const stmt of splitStatements(sql)) {
      if (/\binsert\s+into\b/i.test(stmt.text)) {
        const guarded = /\bon\s+conflict\b/i.test(stmt.text) || /\bwhere\s+not\s+exists\b/i.test(stmt.text);
        if (!guarded) {
          findings.push({
            rule: "seed-idempotent",
            tag,
            line: stmt.line,
            snippet: stmt.text.trim().slice(0, 120),
            message:
              "Unguarded INSERT in a seed migration — first-boot seed must be idempotent (ON CONFLICT DO NOTHING or WHERE NOT EXISTS) so a re-run is a no-op (migrations.md L73).",
          });
        }
      }
    }
  }

  return findings;
}

interface Stmt {
  text: string;
  line: number; // 1-based line where the statement starts
}

// Split on `;` at top level. Quote-aware: a `;` inside a '...' string literal (e.g. an agent
// description "…tool registry only; never writes") does NOT end a statement. Postgres '' escape handled.
// (Runs on comment-stripped, $$-blanked text so `--` and function bodies never interfere.)
function splitStatements(sql: string): Stmt[] {
  const text = sanitise(sql).join("\n");
  const out: Stmt[] = [];
  let buf = "";
  let line = 1;
  let bufStartLine = 1;
  let bufEmpty = true;
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\n") line++;
    if (bufEmpty && ch.trim() !== "") {
      bufStartLine = line;
      bufEmpty = false;
    }
    if (ch === "'") {
      if (inStr && text[i + 1] === "'") {
        buf += "''"; // escaped quote inside a string — consume both
        i++;
        continue;
      }
      inStr = !inStr;
      buf += ch;
      continue;
    }
    if (ch === ";" && !inStr) {
      out.push({ text: buf, line: bufStartLine });
      buf = "";
      bufEmpty = true;
      continue;
    }
    buf += ch;
  }
  if (buf.trim() !== "") out.push({ text: buf, line: bufStartLine });
  return out;
}

export function checkAll(files: { tag: string; sql: string }[]): Finding[] {
  return files.flatMap((f) => checkMigration(f.tag, f.sql));
}
