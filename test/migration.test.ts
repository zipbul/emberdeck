import { describe, it, expect } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { createEmberdeckDb, closeDb } from '../src/db/connection';
import type { EmberdeckDb } from '../src/db/connection';

// ---- Tests ----

describe('migration', () => {
  // HP — in-memory
  it('should return an EmberdeckDb instance when createEmberdeckDb is called with :memory:', () => {
    // Arrange / Act
    const db = createEmberdeckDb(':memory:');
    // Assert
    expect(db).toBeDefined();
    closeDb(db);
  });

  it('should create card table when createEmberdeckDb is called with :memory:', () => {
    // Arrange
    const db = createEmberdeckDb(':memory:');
    // Act: query sqlite_master for card table
    const row = db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='card'")
      .get() as { name: string } | null;
    // Assert
    expect(row?.name).toBe('card');
    closeDb(db);
  });

  it('should create all emberdeck tables after migration when createEmberdeckDb is called with :memory:', () => {
    // Arrange
    const db = createEmberdeckDb(':memory:');
    const expected = ['card', 'tag', 'card_tag', 'card_relation', 'card_fts', 'card_changelog', 'code_link'];
    // Act
    const rows = db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type='table' OR type='shadow' OR type='virtual'")
      .all() as { name: string }[];
    const tableNames = rows.map((r) => r.name);
    // Assert
    for (const name of expected) {
      expect(tableNames).toContain(name);
    }
    closeDb(db);
  });

  // NE — file path: mkdirSync branch (path !== ':memory:')
  it('should create the DB file and directory when createEmberdeckDb is called with a real file path', async () => {
    // Arrange
    const tmpDir = join(tmpdir(), `emberdeck_migrate_test_${Date.now()}`);
    const dbPath = join(tmpDir, 'sub', 'emberdeck.sqlite');
    let db: EmberdeckDb | undefined;
    try {
      // Act — path !== ':memory:' → mkdirSync called
      db = createEmberdeckDb(dbPath);
      // Assert: DB accessible
      const row = db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='card'")
        .get() as { name: string } | null;
      expect(row?.name).toBe('card');
    } finally {
      if (db) closeDb(db);
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ── Schema regression: columns/tables removed by past migrations must stay gone ──
  // These guard against accidental re-introduction of legacy schema. migration's
  // existence-checks above prove the modern shape; these prove the legacy shape
  // did not leak back. (Moved from src/db/repository.spec.ts — schema concerns
  // belong with the migration layer, not the repo unit.)

  it('removed legacy table `keyword` does not exist after migration', () => {
    const db = createEmberdeckDb(':memory:');
    try {
      expect(() => db.$client.prepare('SELECT * FROM keyword').all()).toThrow();
    } finally {
      closeDb(db);
    }
  });

  it('removed legacy column `card.boundary_json` does not exist after migration', () => {
    const db = createEmberdeckDb(':memory:');
    try {
      expect(() => db.$client.prepare('SELECT boundary_json FROM card').all()).toThrow();
    } finally {
      closeDb(db);
    }
  });

  it('removed legacy column `card_relation.type` does not exist after migration', () => {
    const db = createEmberdeckDb(':memory:');
    try {
      expect(() => db.$client.prepare('SELECT type FROM card_relation').all()).toThrow();
    } finally {
      closeDb(db);
    }
  });

  it('current column `card.parent` exists (covered by `card` table check above; explicit query guards against accidental drop)', () => {
    const db = createEmberdeckDb(':memory:');
    try {
      const rows = db.$client.prepare('SELECT parent FROM card').all();
      expect(Array.isArray(rows)).toBe(true);
    } finally {
      closeDb(db);
    }
  });

  // HP — closeDb
  it('should throw when a query is attempted after closeDb is called', () => {
    // Arrange
    const db = createEmberdeckDb(':memory:');
    // Act
    closeDb(db);
    // Assert: closed DB throws on query
    expect(() => db.$client.query('SELECT 1').get()).toThrow('closed database');
  });
});
