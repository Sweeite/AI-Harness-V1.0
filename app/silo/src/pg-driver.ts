// Live Postgres MigrationDriver (the only module that imports `pg`). Not exercised offline (no local
// Postgres); it runs for real at the live capstone (ISSUE-008 §live) against the client silo's own
// Supabase. Kept separate from migrate.ts so the runner orchestration + tests stay DB-free.

import pg from "pg";
import type { MigrationFile } from "./journal.ts";
import type { MigrationDriver } from "./migrate.ts";
import { MigrationError } from "./plan.ts";

const TRACKING_DDL = `
create table if not exists _migrations (
  tag        text primary key,
  checksum   text not null,
  applied_at timestamptz not null default now()
);
-- The runner's own tracking table lives in public — enable RLS + default-deny so it is neither
-- PostgREST-exposed nor a hole in the fleet-wide RLS-coverage assertions (#2). The runner connects as
-- the table owner, which bypasses RLS, so its own reads/writes are unaffected.
--   • 0001c asserts every public table has RLS ENABLED.
--   • ISSUE-009's 0002 asserts every public table also carries >=1 POLICY. _migrations is a public
--     table, so it must satisfy that gate too — give it the same explicit default_deny policy every
--     application table gets (no coverage carve-out; a carve-out is a future hole). REVOKE ALL already
--     denies anon/authenticated; the policy is the belt-and-braces that keeps the gate absolute.
alter table _migrations enable row level security;
revoke all on _migrations from anon, authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = '_migrations' and policyname = 'default_deny') then
    execute 'create policy default_deny on public._migrations as permissive for all to authenticated using (false) with check (false)';
  end if;
end $$;`;

export class PgDriver implements MigrationDriver {
  private pool: pg.Pool;
  constructor(connectionString: string) {
    // Supabase requires SSL. Enable it unless the URL explicitly disables it (e.g. a local DB with
    // sslmode=disable). rejectUnauthorized:false is acceptable for this operator-run capstone against
    // the managed pooler cert.
    const ssl = /sslmode=disable/.test(connectionString) ? undefined : { rejectUnauthorized: false };
    this.pool = new pg.Pool({ connectionString, ssl });
  }

  async ensureTracking(): Promise<void> {
    await this.pool.query(TRACKING_DDL);
  }

  async appliedTags(): Promise<Set<string>> {
    const res = await this.pool.query<{ tag: string }>("select tag from _migrations");
    return new Set(res.rows.map((r) => r.tag));
  }

  async applyTransactional(file: MigrationFile): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(file.sql);
      await client.query("insert into _migrations (tag, checksum) values ($1, $2)", [file.tag, file.checksum]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw new MigrationError(`migration '${file.tag}' failed and was rolled back: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }

  async applyNonTransactional(file: MigrationFile): Promise<void> {
    // CONCURRENTLY cannot run in a transaction. Apply each statement in autocommit. For re-runnability
    // after a partial/failed build: first drop any INVALID indexes (a crashed CONCURRENTLY build leaves
    // one behind), then run each statement, treating "already exists" (42P07) as success.
    const client = await this.pool.connect();
    try {
      await client.query(
        `do $$
         declare r record;
         begin
           for r in select indexrelid::regclass::text as name from pg_index where not indisvalid loop
             execute format('drop index concurrently if exists %s', r.name);
           end loop;
         end $$;`,
      );
      for (const stmt of file.sql.split(";").map((s) => s.trim()).filter(Boolean)) {
        try {
          await client.query(stmt);
        } catch (err) {
          const code = (err as { code?: string }).code;
          if (code === "42P07") continue; // duplicate_table / relation already exists — idempotent skip
          throw new MigrationError(
            `migration '${file.tag}' statement failed: ${(err as Error).message}\n  ${stmt.slice(0, 160)}`,
          );
        }
      }
      await client.query("insert into _migrations (tag, checksum) values ($1, $2) on conflict (tag) do nothing", [
        file.tag,
        file.checksum,
      ]);
    } finally {
      client.release();
    }
  }

  // Read-only passthrough for live assertions (the RLS coverage lint — ISSUE-009). Kept minimal; the
  // migration path above is the only writer.
  async query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }> {
    const res = await this.pool.query(sql);
    return { rows: res.rows };
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
