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

function configurePragmas(db: EmberdeckDb, readonly = false): void {
  const client = db.$client;
  // journal_mode = WAL rewrites the DB header → unsafe on a read-only handle. Skip it.
  if (!readonly) client.run('PRAGMA journal_mode = WAL');
  // foreign_keys / busy_timeout are connection-level (no disk write) — safe read-only.
  client.run('PRAGMA foreign_keys = ON');
  client.run('PRAGMA busy_timeout = 5000');
}

/**
 * Open a new DB + configure pragmas + run migrations.
 *
 * `opts.readonly` (§10 Phase 1.1) opens the existing DB read-only for write-free
 * validation: no directory creation, no migration, no WAL write. The DB must
 * already exist and be migrated; writes raise SQLITE_READONLY.
 * @spec card-storage/persistence/db-connection
 */
export function createEmberdeckDb(path: string, opts?: { readonly?: boolean }): EmberdeckDb {
  const readonly = opts?.readonly ?? false;
  if (path !== ':memory:' && !readonly) {
    mkdirSync(dirname(path), { recursive: true });
  }
  const client = readonly ? new Database(path, { readonly: true }) : new Database(path);
  try {
    const db = drizzle(client, { schema, casing: 'snake_case' });
    configurePragmas(db, readonly);
    if (!readonly) migrateEmberdeck(db);
    return db;
  } catch (err) {
    client.close();
    throw err;
  }
}

/**
 * Run only emberdeck migrations on an existing DB (for CLI integration).
 * @spec card-storage/persistence/db-connection
 */
export function migrateEmberdeck(db: EmberdeckDb): void {
  migrate(db, { migrationsFolder: getMigrationsFolder() });
}

/** @spec card-storage/persistence/db-connection */
export function closeDb(db: EmberdeckDb): void {
  db.$client.close();
}

/**
 * Helper to cast a transaction object to EmberdeckDb.
 * drizzle-orm's transaction type does not exactly match EmberdeckDb,
 * requiring the `as unknown as EmberdeckDb` pattern — this function centralizes that cast.
 * @spec card-storage/persistence/db-connection
 */
export function txDb(tx: unknown): EmberdeckDb {
  return tx as EmberdeckDb;
}
