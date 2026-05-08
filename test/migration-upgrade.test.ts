/**
 * Verify that an existing DB at migration 0001 can be upgraded to 0002 (system_lock added).
 * This protects against breaking existing user databases on emberdeck upgrade.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from 'bun:sqlite';
import { setupEmberdeck, teardownEmberdeck } from '../src/setup';

describe('migration: 0001 → 0002 upgrade path', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mig-up-'));
    mkdirSync(join(tmp, 'cards'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test('0002 adds only system_lock to a DB already at 0001', () => {
    const dbPath = join(tmp, 'data.db');
    // Manually apply 0000 + 0001 to simulate an existing user DB.
    const projectRoot = resolve(import.meta.dir, '..');
    const sql0000 = readFileSync(join(projectRoot, 'drizzle/0000_init.sql'), 'utf-8');
    const sql0001 = readFileSync(join(projectRoot, 'drizzle/0001_glossary.sql'), 'utf-8');

    const db = new Database(dbPath);
    db.run(sql0000);
    if (sql0001.trim().length > 0) db.run(sql0001);

    // Mark drizzle's __drizzle_migrations table as having applied 0000 + 0001 only.
    db.run(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at NUMERIC
    )`);

    // Compute correct hashes from the meta journal so drizzle accepts them as applied.
    const journal = JSON.parse(
      readFileSync(join(projectRoot, 'drizzle/meta/_journal.json'), 'utf-8'),
    );
    const entries0001 = journal.entries.slice(0, 2);
    for (const e of entries0001) {
      // hash format used by drizzle bun-sqlite: hash of migration SQL content
      const sqlPath = join(projectRoot, `drizzle/${e.tag}.sql`);
      const content = readFileSync(sqlPath, 'utf-8');
      const hash = Bun.CryptoHasher.hash('sha256', content, 'hex');
      db.run(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('${hash}', ${e.when})`);
    }

    // Confirm system_lock does NOT yet exist
    const before = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='system_lock'")
      .get();
    expect(before).toBeNull();
    db.close();

    // Now run setupEmberdeck which should auto-apply 0002
    return (async () => {
      const ctx = await setupEmberdeck({
        cardsDir: join(tmp, 'cards'),
        dbPath,
        projectRoot: tmp,
      });

      // After setup, system_lock should exist
      const after = ctx.db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='system_lock'")
        .get();
      expect(after).toEqual({ name: 'system_lock' });

      // Pre-existing tables (card, tag, etc.) should still exist + be queryable
      const cards = ctx.db.$client.prepare('SELECT count(*) as n FROM card').get() as { n: number };
      expect(cards.n).toBe(0);

      await teardownEmberdeck(ctx);
    })();
  });
});
