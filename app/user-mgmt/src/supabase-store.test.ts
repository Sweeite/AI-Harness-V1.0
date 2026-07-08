// ISSUE-021 — live-adapter regression tests. These exercise SupabaseUserMgmtStore against a small in-test
// Postgres mock that is FAITHFUL to the two facts the last-Super-Admin guard depends on:
//   (1) `pg_advisory_xact_lock` is a mutually-exclusive lock, and
//   (2) the last-SA count subquery and the row write are two steps with a scheduling gap between them (the real
//       count uses the statement snapshot) — so WITHOUT serialization two concurrent deactivations of DIFFERENT
//       Super-Admin rows both read count=2 and both apply (write skew → 0 Super Admins).
// The `control` test proves the mock reproduces that race (so the regression test below is genuinely sensitive);
// the adapter tests prove the shipped code serializes on the advisory lock and always leaves ≥1 Super Admin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { SupabaseUserMgmtStore } from './supabase-store.ts';
import { UserMgmtError, ERR_NO_SUCH_USER } from './store.ts';

/** A minimal Postgres mock for the last-Super-Admin deactivation guard. */
class FakeSaDb {
  readonly active: Map<string, boolean>; // super-admin userId -> active
  private locked = false;
  private readonly waiters: Array<() => void> = [];

  constructor(saIds: string[]) {
    this.active = new Map(saIds.map((id) => [id, true]));
  }

  private activeCount(): number {
    let n = 0;
    for (const a of this.active.values()) if (a) n++;
    return n;
  }

  private async acquireLock(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    await new Promise<void>((res) => this.waiters.push(res));
  }

  private releaseLock(): void {
    const next = this.waiters.shift();
    if (next) next(); // hand the lock straight to the next waiter (stays locked)
    else this.locked = false;
  }

  /** One deactivate statement: snapshot the count → scheduling gap → maybe write. Public so the `control` test
   *  can drive it WITHOUT the advisory lock to reproduce the pre-fix write-skew race. */
  async rawDeactivate(userId: string): Promise<{ rowCount: number }> {
    if (this.active.get(userId) !== true) return { rowCount: 0 };
    const count = this.activeCount(); // step 1: the count subquery's snapshot
    await Promise.resolve(); // the window in which a concurrent, unserialized txn interleaves
    await Promise.resolve();
    if (count <= 1) return { rowCount: 0 }; // guard refuses — this would drop the last Super Admin
    this.active.set(userId, false); // step 2: apply the deactivation
    return { rowCount: 1 };
  }

  /** A pg.Pool whose only supported path is connect() — the guard MUST go through a transaction, never a bare
   *  pool.query (which would take no advisory lock and re-open the race). */
  asPool(): Pool {
    const db = this;
    return {
      async connect() {
        let holdsLock = false;
        return {
          async query(sql: string, params?: unknown[]) {
            const s = String(sql).trim().toLowerCase();
            if (s === 'begin') return { rows: [], rowCount: 0 };
            if (s === 'commit' || s === 'rollback') {
              if (holdsLock) {
                db.releaseLock();
                holdsLock = false;
              }
              return { rows: [], rowCount: 0 };
            }
            if (s.includes('pg_advisory_xact_lock')) {
              await db.acquireLock();
              holdsLock = true;
              return { rows: [], rowCount: 0 };
            }
            if (s.startsWith('update public.profiles')) {
              return db.rawDeactivate((params as string[])[0]!);
            }
            if (s.startsWith('select active from public.profiles')) {
              const id = (params as string[])[0]!;
              return { rows: db.active.has(id) ? [{ active: db.active.get(id) }] : [] };
            }
            throw new Error(`unexpected sql in FakeSaDb: ${sql}`);
          },
          release() {
            if (holdsLock) {
              db.releaseLock();
              holdsLock = false;
            }
          },
        };
      },
      async query() {
        throw new Error('the SA guard must run inside connect()+advisory-lock, not a bare pool.query');
      },
    } as unknown as Pool;
  }
}

test('control — WITHOUT serialization the mock exhibits the write-skew race (proves the regression test is sensitive)', async () => {
  const db = new FakeSaDb(['sa-1', 'sa-2']);
  // Drive the raw guard statements concurrently with NO advisory lock — the pre-fix behaviour.
  const [a, b] = await Promise.all([db.rawDeactivate('sa-1'), db.rawDeactivate('sa-2')]);
  assert.equal(a.rowCount + b.rowCount, 2, 'both pass the guard (each snapshot saw 2 active Super Admins)');
  assert.equal([...db.active.values()].filter(Boolean).length, 0, 'BOTH Super Admins deactivated — the #2 leak the fix must close');
});

test('FR-1.ROLE.005 (concurrency) — two concurrent deactivations of different Super Admins never orphan the last one', async () => {
  const db = new FakeSaDb(['sa-1', 'sa-2']);
  const store = new SupabaseUserMgmtStore(db.asPool());
  const [r1, r2] = await Promise.all([store.atomicDeactivate('sa-1'), store.atomicDeactivate('sa-2')]);
  assert.equal([r1, r2].filter(Boolean).length, 1, 'exactly one deactivation succeeds; the other is refused by the guard');
  assert.equal([...db.active.values()].filter(Boolean).length, 1, 'at least one Super Admin always survives (write skew closed)');
});

test('atomicDeactivate — a sole Super Admin cannot be deactivated (guard refuses, returns false, no throw)', async () => {
  const db = new FakeSaDb(['sa-only']);
  const store = new SupabaseUserMgmtStore(db.asPool());
  assert.equal(await store.atomicDeactivate('sa-only'), false, 'the last Super Admin is protected');
  assert.equal(db.active.get('sa-only'), true, 'still active');
});

// ── isOAuthUser dead-branch fix — a nonexistent user must fail LOUD (matches the fake), not silently false ──
function poolReturning(rows: Record<string, unknown>[]): Pool {
  return { async query() { return { rows }; } } as unknown as Pool;
}

test('isOAuthUser — a nonexistent user throws NO_SUCH_USER (no silent is_oauth=false; matches the fake)', async () => {
  const store = new SupabaseUserMgmtStore(poolReturning([{ user_exists: false, is_oauth: false }]));
  await assert.rejects(() => store.isOAuthUser('ghost'), (e: UserMgmtError) => e.reason === ERR_NO_SUCH_USER);
});

test('isOAuthUser — an existing OAuth user returns true; an existing password user returns false', async () => {
  const oauth = new SupabaseUserMgmtStore(poolReturning([{ user_exists: true, is_oauth: true }]));
  assert.equal(await oauth.isOAuthUser('u1'), true);
  const pwd = new SupabaseUserMgmtStore(poolReturning([{ user_exists: true, is_oauth: false }]));
  assert.equal(await pwd.isOAuthUser('u2'), false);
});
