// Execution-safe SQL statement splitter for the NON-transactional migration runner (pg-driver.ts).
//
// Why this exists: `transactional:false` files (CONCURRENTLY indexes, `alter type ... add value`) cannot
// run as one `client.query(file.sql)` — each statement must be sent to autocommit separately. The old
// runner did `file.sql.split(";")`, which is NOT quote/comment-aware: a `;` inside a `-- comment` (or a
// string literal) fragments the statement and the live apply dies with `syntax error`. This exact bug
// broke the live apply of migration 0007 (session 69) and 0011 (session 71) — a `;` inside a comment.
// The offline discipline `check` passed both times because it strips comments before scanning, so the
// hazard was invisible until the migration hit the real DB (#3 — a latent build-breaker).
//
// This splitter is the runtime closure: it splits on top-level `;` while correctly skipping any `;` that
// appears inside a `-- line comment`, a `/* block comment */` (Postgres block comments nest), a
// `'string literal'` (with `''` escape), or a `$tag$ dollar-quoted body $tag$`. Comment text is dropped
// from the emitted statements (Postgres ignores it); string and dollar-quoted contents are preserved
// byte-for-byte so no statement is ever altered.
export function splitExecutableStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i]!;
    const two = sql.slice(i, i + 2);

    // -- line comment: strip through end of line (leave the newline for normal copy).
    if (two === "--") {
      let j = i + 2;
      while (j < n && sql[j] !== "\n") j++;
      i = j;
      continue;
    }

    // /* block comment */ — strip; Postgres allows nesting, so track depth.
    if (two === "/*") {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        const pair = sql.slice(j, j + 2);
        if (pair === "/*") { depth++; j += 2; continue; }
        if (pair === "*/") { depth--; j += 2; continue; }
        j++;
      }
      i = j;
      continue;
    }

    // 'single-quoted string literal' — copy verbatim, honouring the '' escape.
    if (ch === "'") {
      buf += ch;
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") { buf += "''"; i += 2; continue; }
        buf += sql[i]!;
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }

    // $tag$ dollar-quoted body $tag$ — copy verbatim ($$…$$ and $body$…$body$). Positional params
    // like $1 do not match (\$[A-Za-z_]*\$ requires a closing $ after an optional word tag).
    if (ch === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        buf += tag;
        i += tag.length;
        const end = sql.indexOf(tag, i);
        if (end === -1) { buf += sql.slice(i); i = n; } // unterminated — copy the rest unchanged
        else { buf += sql.slice(i, end + tag.length); i = end + tag.length; }
        continue;
      }
    }

    // Top-level statement terminator.
    if (ch === ";") {
      if (buf.trim() !== "") out.push(buf.trim());
      buf = "";
      i++;
      continue;
    }

    buf += ch;
    i++;
  }

  if (buf.trim() !== "") out.push(buf.trim());
  return out;
}
