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
 * 새 DB 열기 + pragma + migration.
 */
export function createEmberdeckDb(path: string): EmberdeckDb {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const client = new Database(path);
  const db = drizzle(client, { schema, casing: 'snake_case' });
  configurePragmas(db);
  migrateEmberdeck(db);
  return db;
}

/**
 * 기존 DB에 emberdeck 마이그레이션만 실행 (CLI 통합용).
 */
export function migrateEmberdeck(db: EmberdeckDb): void {
  migrate(db, { migrationsFolder: getMigrationsFolder() });
}

export function closeDb(db: EmberdeckDb): void {
  db.$client.close();
}

/**
 * 트랜잭션 객체를 EmberdeckDb로 캐스팅하는 헬퍼.
 * drizzle-orm의 트랜잭션 타입과 EmberdeckDb가 정확히 일치하지 않아
 * `as unknown as EmberdeckDb` 패턴이 필요한데, 이 함수로 캐스팅을 한 곳에 집중시킨다.
 */
export function txDb(tx: unknown): EmberdeckDb {
  return tx as EmberdeckDb;
}
