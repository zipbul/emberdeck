import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { Database } from 'bun:sqlite';
import { resolve } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

import * as schema from './schema';
import { findPackageRoot } from '../fs/package-root';

export type EmberdeckDb = ReturnType<typeof drizzle<typeof schema>>;

function getMigrationsFolder(): string {
  const root = findPackageRoot(import.meta.dirname);
  const candidates = [resolve(root, 'drizzle'), resolve(root, 'migrations')];
  for (const c of candidates) {
    if (existsSync(resolve(c, 'meta/_journal.json'))) return c;
  }
  throw new Error(`emberdeck: migrations folder not found under ${root}`);
}

function configurePragmas(db: EmberdeckDb): void {
  const client = db.$client;
  client.run('PRAGMA journal_mode = WAL');
  client.run('PRAGMA foreign_keys = ON');
  client.run('PRAGMA busy_timeout = 5000');
}

/**
 * Open a new DB + configure pragmas + run migrations.
 */
export function createEmberdeckDb(path: string): EmberdeckDb {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const client = new Database(path);
  try {
    const db = drizzle(client, { schema, casing: 'snake_case' });
    configurePragmas(db);
    migrateEmberdeck(db);
    return db;
  } catch (err) {
    client.close();
    throw err;
  }
}

/**
 * Run only emberdeck migrations on an existing DB (for CLI integration).
 */
export function migrateEmberdeck(db: EmberdeckDb): void {
  migrate(db, { migrationsFolder: getMigrationsFolder() });
}

export function closeDb(db: EmberdeckDb): void {
  db.$client.close();
}

/**
 * Helper to cast a transaction object to EmberdeckDb.
 * drizzle-orm's transaction type does not exactly match EmberdeckDb,
 * requiring the `as unknown as EmberdeckDb` pattern — this function centralizes that cast.
 */
export function txDb(tx: unknown): EmberdeckDb {
  return tx as EmberdeckDb;
}
