// RLS scaffold lints (ISSUE-009) — the CI teeth behind FR-1.RLS.001/002 + NFR-PERF.001 + NFR-SEC.010.
//
// Two text-level lints (no DB — run in `npm run check` on every migration, like discipline.ts) plus one
// live-catalog assertion (needs the silo — run at migrate/capstone). Together they make the RLS
// substrate self-policing:
//
//   1. auth_rls_initplan wrap lint (checkInitPlanWrapping) — AC-1.RLS.002.2 / AC-NFR-PERF.001.2.
//      Every helper/auth call inside a CREATE POLICY must sit inside a `(select …)` initPlan wrapper so
//      it evaluates once per statement, not once per row (AF-067). A bare `user_perms(auth.uid())` in a
//      policy qual is the anti-pattern this catches.
//   2. coverage lint (checkCoverage) — AC-1.RLS.001.1 / AC-NFR-SEC.010.1 / AF-079.
//      Every table CREATEd in the migration corpus must also be covered by a policy (a per-table
//      `create policy` OR membership in the default-deny baseline loop). A table added without a policy
//      fails the build — an unguarded table is a silent authorization hole (#2).
//
// The live half (assertRlsCoverageLive) is the ground-truth form: it reads pg_class/pg_policies so it
// also catches a table that exists in the DB but was never listed in any migration text. 0002's tail
// assertion runs the same check inside the migration; this exposes it as a standalone gate.

export type RlsRule = "initplan-unwrapped" | "table-uncovered" | "aal2-missing";

export interface RlsFinding {
  rule: RlsRule;
  tag: string;
  line: number;
  snippet: string;
  message: string;
}

// The helper/auth calls that MUST be `(select …)`-wrapped inside a policy (rls-policies.md L26-40).
const GUARDED_CALL = /\b(user_perms|user_visibility|user_clearances|user_restricted|user_aal|auth\.uid|auth\.jwt|auth\.role)\s*\(/i;
const GUARDED_CALL_G = new RegExp(GUARDED_CALL.source, "gi");

// Remove every balanced `(select …)` group (innermost-first) from a policy body. Whatever guarded call
// REMAINS afterwards was NOT inside a `(select …)` wrapper → unwrapped → flagged. This correctly treats
// `(select user_perms(auth.uid()))` as fully wrapped (both calls vanish with the group) while flagging a
// bare `user_perms(auth.uid())` and a top-level `auth.uid()` sitting outside any subquery.
export function stripSelectSubqueries(body: string): string {
  let s = body;
  // Repeatedly excise the innermost `( select … )` — a `(select` with no nested `(select` inside it.
  // Loop until a fixpoint so nested wrappers are all removed.
  for (;;) {
    let removed = false;
    const lower = s.toLowerCase();
    let i = 0;
    while (i < lower.length) {
      // find `(` followed by optional ws + `select`
      if (s[i] === "(") {
        const after = lower.slice(i + 1).match(/^\s*select\b/);
        if (after) {
          // walk to the matching close paren; bail out if a nested `(select` appears (not innermost)
          let depth = 0;
          let j = i;
          let nestedSelect = false;
          for (; j < s.length; j++) {
            if (s[j] === "(") {
              depth++;
              if (j !== i && lower.slice(j + 1).match(/^\s*select\b/)) nestedSelect = true;
            } else if (s[j] === ")") {
              depth--;
              if (depth === 0) break;
            }
          }
          if (!nestedSelect && depth === 0) {
            s = s.slice(0, i) + " " + s.slice(j + 1);
            removed = true;
            break; // restart scan on the shortened string
          }
        }
      }
      i++;
    }
    if (!removed) break;
  }
  return s;
}

// Extract each `create policy … ( … )` statement's body (the USING/WITH CHECK expressions) with the line
// it starts on. Quote/paren tolerant enough for the authored policy style; comment-stripped upstream.
function policyStatements(sql: string): { body: string; line: number }[] {
  const out: { body: string; line: number }[] = [];
  const noComments = sql.replace(/--.*$/gm, "");
  // Both CREATE and ALTER POLICY carry USING/WITH CHECK predicates — an unwrapped helper in either is
  // the per-row footgun (AF-067), so both are init-plan-linted.
  const re = /(?:create|alter)\s+policy\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(noComments))) {
    const start = m.index;
    // statement ends at the first top-level `;`
    let depth = 0;
    let end = start;
    for (; end < noComments.length; end++) {
      const ch = noComments[end];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === ";" && depth === 0) break;
    }
    const body = noComments.slice(start, end);
    const line = noComments.slice(0, start).split("\n").length;
    out.push({ body, line });
  }
  return out;
}

// LINT 1 — every guarded call in a CREATE POLICY must be `(select …)`-wrapped (once-per-statement).
export function checkInitPlanWrapping(tag: string, sql: string): RlsFinding[] {
  const findings: RlsFinding[] = [];
  for (const { body, line } of policyStatements(sql)) {
    const residual = stripSelectSubqueries(body);
    const bad = residual.match(GUARDED_CALL_G);
    if (bad) {
      findings.push({
        rule: "initplan-unwrapped",
        tag,
        line,
        snippet: body.trim().replace(/\s+/g, " ").slice(0, 120),
        message: `Unwrapped permission lookup in a policy (${[...new Set(bad.map((b) => b.replace(/\s*\($/, "")))].join(", ")}) — wrap every helper/auth call as \`(select fn(…))\` so it evaluates once per statement, not once per row (AF-067; auth_rls_initplan / AC-1.RLS.002.2).`,
      });
    }
  }
  return findings;
}

// Parse the base-table names CREATEd in a migration (`create table [public.]name (`).
export function parseCreatedTables(sql: string): string[] {
  const noComments = sql.replace(/--.*$/gm, "");
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
  const names: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(noComments))) names.push(m[1]!.toLowerCase());
  return names;
}

// Parse the table names a migration COVERS with a policy: an explicit `create policy … on [public.]name`
// PLUS every name listed in a `silo_tables … array[ '…','…' ]` literal (the default-deny baseline loop).
export function parseCoveredTables(sql: string): string[] {
  const noComments = sql.replace(/--.*$/gm, "");
  const covered = new Set<string>();
  const onRe = /create\s+policy\b[\s\S]*?\bon\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;
  let m: RegExpExecArray | null;
  while ((m = onRe.exec(noComments))) covered.add(m[1]!.toLowerCase());
  // the default-deny loop: `silo_tables text[] := array[ '…', '…', … ]`
  const arrM = noComments.match(/silo_tables[^=]*:=\s*array\s*\[([\s\S]*?)\]/i);
  if (arrM) {
    const items = arrM[1]!.match(/'([a-z_][a-z0-9_]*)'/gi) ?? [];
    for (const it of items) covered.add(it.replace(/'/g, "").toLowerCase());
  }
  return [...covered];
}

// LINT 2 — every CREATEd application table must be covered by a policy somewhere in the corpus.
export function checkCoverage(files: { tag: string; sql: string }[]): RlsFinding[] {
  const created = new Map<string, { tag: string; line: number }>();
  const covered = new Set<string>();
  for (const f of files) {
    for (const name of parseCreatedTables(f.sql)) {
      if (!created.has(name)) {
        const idx = f.sql.toLowerCase().indexOf(`table ${name}`);
        const line = idx >= 0 ? f.sql.slice(0, idx).split("\n").length : 1;
        // recompute line against a public.-qualified form too
        const idx2 = f.sql.toLowerCase().search(new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?"?${name}\\b`));
        created.set(name, { tag: f.tag, line: idx2 >= 0 ? f.sql.slice(0, idx2).split("\n").length : line });
      }
    }
    for (const name of parseCoveredTables(f.sql)) covered.add(name);
  }
  const findings: RlsFinding[] = [];
  for (const [name, where] of created) {
    if (!covered.has(name)) {
      findings.push({
        rule: "table-uncovered",
        tag: where.tag,
        line: where.line,
        snippet: `create table ${name}`,
        message: `Table \`${name}\` is created but has NO RLS policy in any migration — an unguarded table is a silent authorization hole (#2). Add it to the default-deny baseline loop (0002) or give it an explicit policy (AC-1.RLS.001.1 / AC-NFR-SEC.010.1 / AF-079).`,
      });
    }
  }
  return findings;
}

// ── LINT 3 — every protected human GRANT policy carries the aal2 baseline (FR-1.RLS.005) ──
// AC-1.RLS.005.1 / AF-076: no protected table is reachable at aal1. A policy that GRANTS to
// `authenticated` (its body is not the bare default-deny `false`) MUST gate on `user_aal()`. The
// support_requests pre-auth intake (public INSERT, FR-0.REC.002) is the ONE documented exemption.
//
// last-create-wins: a policy authored without the clause in an early migration and later superseded by
// a `drop policy … ; create policy … (with aal2)` in a retrofit migration (ISSUE-020 / 0031) is judged
// on its FINAL definition — the retrofit is what runs live, so the early source text is not a violation.
interface ParsedPolicy { table: string; name: string; body: string; tag: string; line: number }

// Parse `{create|alter} policy <name> on [public.]<table> … <body-through-terminating-;>`. An ALTER
// restates the USING/WITH CHECK predicate; since it runs after the original CREATE in corpus order, the
// last-write-wins map below correctly treats a retrofit ALTER (ISSUE-020 / 0031) as the effective final
// predicate — so a policy created without the aal2 clause but later ALTERed to add it reads as covered.
function parsePolicies(tag: string, sql: string): ParsedPolicy[] {
  const noComments = sql.replace(/--.*$/gm, "");
  const out: ParsedPolicy[] = [];
  const re = /(?:create|alter)\s+policy\s+"?([a-z_][a-z0-9_]*)"?\s+on\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(noComments))) {
    const start = m.index;
    let depth = 0;
    let end = start;
    for (; end < noComments.length; end++) {
      const ch = noComments[end];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === ";" && depth === 0) break;
    }
    out.push({
      name: m[1]!.toLowerCase(),
      table: m[2]!.toLowerCase(),
      body: noComments.slice(start, end),
      tag,
      line: noComments.slice(0, start).split("\n").length,
    });
  }
  return out;
}

// A policy is a pure default-deny (needs no aal2) iff it has a `using (false)` predicate and grants
// nothing else — no permission-lookup call and no data predicate that could open a row.
function isPureDeny(body: string): boolean {
  return /\busing\s*\(\s*false\s*\)/i.test(body) && !GUARDED_CALL.test(body);
}

export function checkAal2Coverage(files: { tag: string; sql: string }[]): RlsFinding[] {
  // Collect every policy across the corpus; last definition per (table,name) wins (supersession).
  const finalDef = new Map<string, ParsedPolicy>();
  for (const f of files) for (const p of parsePolicies(f.tag, f.sql)) finalDef.set(`${p.table}.${p.name}`, p);

  const findings: RlsFinding[] = [];
  for (const p of finalDef.values()) {
    if (p.name === "default_deny" || isPureDeny(p.body)) continue;      // deny grants nothing → no aal2 needed
    if (p.table === "support_requests" && /\bfor\s+insert\b/i.test(p.body)) continue; // documented pre-auth exemption
    if (!/\buser_aal\b/i.test(p.body)) {
      findings.push({
        rule: "aal2-missing",
        tag: p.tag,
        line: p.line,
        snippet: p.body.trim().replace(/\s+/g, " ").slice(0, 120),
        message: `Policy \`${p.name}\` on \`${p.table}\` grants to authenticated but omits the \`(select user_aal()) = 'aal2'\` baseline clause — a protected table reachable at aal1 is a silent step-up bypass (#2/#3; FR-1.RLS.005 / AC-1.RLS.005.1 / AF-076). Add the aal2 clause (support_requests pre-auth intake is the only exemption).`,
      });
    }
  }
  return findings;
}

// Both text lints over the whole migration corpus (used by `npm run check`).
export function checkAllRls(files: { tag: string; sql: string }[]): RlsFinding[] {
  const initplan = files.flatMap((f) => checkInitPlanWrapping(f.tag, f.sql));
  return [...initplan, ...checkCoverage(files), ...checkAal2Coverage(files)];
}

// ── Live-catalog coverage assertion (needs the silo) ──────────────────────────
// Ground truth: every public base table has RLS enabled AND >=1 policy. Catches a table that exists in
// the DB but is missing from the migration text — the one gap the text lint cannot see. Returns the list
// of offending tables ([] = clean). The caller decides how to fail (the CLI exits non-zero).
export interface QueryableClient {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export async function assertRlsCoverageLive(client: QueryableClient): Promise<{ rlsDisabled: string[]; noPolicy: string[] }> {
  const disabled = await client.query(`
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
    order by c.relname
  `);
  const nopolicy = await client.query(`
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = true
      and not exists (
        select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
      )
    order by c.relname
  `);
  return {
    rlsDisabled: disabled.rows.map((r) => String(r.relname)),
    noPolicy: nopolicy.rows.map((r) => String(r.relname)),
  };
}
