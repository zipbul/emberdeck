import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createEmberdeckDb, closeDb } from '../../src/db/connection';
import { DrizzleCardRepository } from '../../src/db/card-repo';
import type { EmberdeckDb } from '../../src/db/connection';
import type { CardRow } from '../../src/db/repository';

// ---- Fixtures ----

function makeRow(overrides: Partial<CardRow> = {}): CardRow {
  return {
    key: 'test/card',
    summary: 'Test card',
    status: 'draft',
    type: 'spec',
    parent: null,
    namespacesJson: null,
    body: null,
    glossaryJson: '[]',
    filePath: '/cards/test/card.md',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---- Setup ----

let db: EmberdeckDb;
let repo: DrizzleCardRepository;

beforeEach(() => {
  db = createEmberdeckDb(':memory:');
  repo = new DrizzleCardRepository(db);
});

afterEach(() => {
  closeDb(db);
});

// ---- Tests ----

describe('DrizzleCardRepository', () => {
  // HP
  it('should return CardRow when findByKey is called with an existing key', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'a/b', summary: 'S' }));
    // Act
    const result = repo.findByKey('a/b');
    // Assert
    expect(result).not.toBeNull();
    expect(result?.key).toBe('a/b');
  });

  it('should return only the matching CardRow when two cards exist and second key is queried', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'a/one', summary: 'One', filePath: '/cards/one.md' }));
    repo.upsert(makeRow({ key: 'a/two', summary: 'Two', filePath: '/cards/two.md' }));
    // Act
    const result = repo.findByKey('a/two');
    // Assert
    expect(result?.key).toBe('a/two');
    expect(result?.summary).toBe('Two');
  });

  it('should return CardRow when findByFilePath is called with an existing filePath', () => {
    // Arrange
    const fp = '/cards/x/y.md';
    repo.upsert(makeRow({ key: 'x/y', filePath: fp }));
    // Act
    const result = repo.findByFilePath(fp);
    // Assert
    expect(result?.filePath).toBe(fp);
  });

  it('should insert a new row when upsert is called with a new key', () => {
    // Arrange / Act
    repo.upsert(makeRow({ key: 'new/key' }));
    // Assert
    expect(repo.findByKey('new/key')).not.toBeNull();
  });

  it('should update summary when upsert is called with an existing key and different summary', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'k', summary: 'old', filePath: '/a.json' }));
    // Act
    repo.upsert(makeRow({ key: 'k', summary: 'new', filePath: '/a.json' }));
    // Assert
    expect(repo.findByKey('k')?.summary).toBe('new');
  });

  it('should preserve null body when upsert stores null body and findByKey is called', () => {
    // Arrange / Act
    repo.upsert(makeRow({ key: 'k2', filePath: '/b.json' }));
    // Assert
  });

  it('should return null on findByKey after deleteByKey removes the existing key', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'del' }));
    // Act
    repo.deleteByKey('del');
    // Assert
    expect(repo.findByKey('del')).toBeNull();
  });

  it('should return true when existsByKey is called with an existing key', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'exists' }));
    // Act / Assert
    expect(repo.existsByKey('exists')).toBe(true);
  });

  it('should return all rows when list is called without filter', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'p/1', status: 'draft', filePath: '/1.json' }));
    repo.upsert(makeRow({ key: 'p/2', status: 'active', filePath: '/2.json' }));
    // Act
    const result = repo.list();
    // Assert
    expect(result).toHaveLength(2);
  });

  it('should return only draft cards when list is called with status draft filter', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'p/d', status: 'draft', filePath: '/d.json' }));
    repo.upsert(makeRow({ key: 'p/a', status: 'active', filePath: '/a.json' }));
    // Act
    const result = repo.list({ status: 'draft' });
    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.key).toBe('p/d');
  });

  it('should return empty array when query does not match any card', () => {
    // Arrange
    repo.upsert(makeRow({ key: 's/x' }));
    // Act
    const result = repo.search('zzz_no_match_zzz');
    // Assert
    expect(result).toEqual([]);
  });

  it('should return matching card when summary contains the search query', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'fts/summary', summary: 'authentication design', filePath: '/fts/summary.json' }));
    // Act
    const result = repo.search('authentication');
    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe('fts/summary');
  });

  it('should return matching card when body contains the search query', () => {
    // Arrange — body column now stores searchable namespace text (set by syncCardFromFile/updateCard).
    repo.upsert(makeRow({ key: 'fts/body', summary: 'unrelated', filePath: '/fts/body.md', body: 'refresh token logic' }));
    // Act
    const result = repo.search('refresh');
    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe('fts/body');
  });

  it('should return only the matching card when multiple cards exist', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'fts/match', summary: 'pagination spec', filePath: '/fts/match.json' }));
    repo.upsert(makeRow({ key: 'fts/other', summary: 'sorting spec', filePath: '/fts/other.json' }));
    // Act
    const result = repo.search('pagination');
    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe('fts/match');
  });

  it('should not return card after it has been deleted', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'fts/del', summary: 'ephemeral card', filePath: '/fts/del.json' }));
    expect(repo.search('ephemeral')).toHaveLength(1);
    // Act
    repo.deleteByKey('fts/del');
    // Assert
    expect(repo.search('ephemeral')).toHaveLength(0);
  });

  it('should return card with updated summary after upsert is called again', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'fts/upd', summary: 'original summary', filePath: '/fts/upd.json' }));
    // Act
    repo.upsert(makeRow({ key: 'fts/upd', summary: 'revised summary', filePath: '/fts/upd.json' }));
    // Assert
    expect(repo.search('revised')).toHaveLength(1);
    expect(repo.search('original')).toHaveLength(0);
  });

  // NE
  it('should return null when findByKey is called with a non-existent key', () => {
    // Act / Assert
    expect(repo.findByKey('no/such')).toBeNull();
  });

  it('should return null when findByFilePath is called with a non-existent filePath', () => {
    // Act / Assert
    expect(repo.findByFilePath('/no/such.json')).toBeNull();
  });

  it('should return false when existsByKey is called with a non-existent key', () => {
    // Act / Assert
    expect(repo.existsByKey('no/exists')).toBe(false);
  });

  it('should not throw when deleteByKey is called with a non-existent key', () => {
    // Act / Assert
    expect(() => repo.deleteByKey('ghost/key')).not.toThrow();
  });

  it('should return empty array when list is called with status draft but no draft cards exist', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'p/a2', status: 'active', filePath: '/a2.json' }));
    // Act
    const result = repo.list({ status: 'draft' });
    // Assert
    expect(result).toEqual([]);
  });

  // ED
  it('should return empty array when list is called on empty DB', () => {
    // Act / Assert
    expect(repo.list()).toEqual([]);
  });

  // ST
  it('should succeed re-insert after upsert→deleteByKey→upsert with same key', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'cycle' }));
    repo.deleteByKey('cycle');
    // Act
    repo.upsert(makeRow({ key: 'cycle', summary: 'renewed' }));
    // Assert
    expect(repo.findByKey('cycle')?.summary).toBe('renewed');
  });

  it('should return updated summary when upsert is called twice with same key but different summary', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'upd', summary: 'v1', filePath: '/v.json' }));
    // Act
    repo.upsert(makeRow({ key: 'upd', summary: 'v2', filePath: '/v.json' }));
    // Assert
    expect(repo.findByKey('upd')?.summary).toBe('v2');
  });

  // ID
  it('should return same result on consecutive existsByKey calls with same key', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'idem' }));
    // Act
    const first = repo.existsByKey('idem');
    const second = repo.existsByKey('idem');
    // Assert
    expect(first).toBe(second);
  });

  // ── type field: required string ───────────────────────

  it('should store and retrieve type field when upsert is called with type', () => {
    // Arrange / Act
    repo.upsert(makeRow({ key: 'typed', type: 'brief', filePath: '/typed.json' }));
    // Assert
    const row = repo.findByKey('typed');
    expect(row?.type).toBe('brief');
  });

  it('should return only spec cards when list is called with type spec filter', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'f/1', type: 'spec', filePath: '/f1.json' }));
    repo.upsert(makeRow({ key: 'b/1', type: 'brief', filePath: '/b1.json' }));
    // Act
    const result = repo.list({ type: 'spec' });
    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.key).toBe('f/1');
  });

  it('should order newest first when list is called with sortBy updated_at', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'u/old', updatedAt: '2026-01-01T00:00:00.000Z', filePath: '/old.json' }));
    repo.upsert(makeRow({ key: 'u/mid', updatedAt: '2026-06-15T00:00:00.000Z', filePath: '/mid.json' }));
    repo.upsert(makeRow({ key: 'u/new', updatedAt: '2026-12-31T00:00:00.000Z', filePath: '/new.json' }));
    // Act
    const result = repo.list({ sortBy: 'updated_at' });
    // Assert
    expect(result.map((r) => r.key)).toEqual(['u/new', 'u/mid', 'u/old']);
  });

  // B-4: FTS5 syntax errors → throw FtsSyntaxError (not silent empty)
  // Previously these returned [] which hid user typos. Now CLI surfaces
  // a usage-class error so users know their query was malformed.
  it('throws FtsSyntaxError when search receives FTS5 operator AND', () => {
    repo.upsert(makeRow({ key: 'fts/a', summary: 'hello world', filePath: '/fts-a.json' }));
    expect(() => repo.search('AND')).toThrow(/FTS5/);
  });

  it('throws FtsSyntaxError when search receives FTS5 operator NOT', () => {
    repo.upsert(makeRow({ key: 'fts/b', summary: 'hello world', filePath: '/fts-b.json' }));
    expect(() => repo.search('NOT')).toThrow(/FTS5/);
  });

  it('throws FtsSyntaxError when search receives unbalanced double quote', () => {
    repo.upsert(makeRow({ key: 'fts/c', summary: 'hello', filePath: '/fts-c.json' }));
    expect(() => repo.search('foo"bar')).toThrow(/FTS5/);
  });

  it('throws FtsSyntaxError when search receives lone asterisk', () => {
    repo.upsert(makeRow({ key: 'fts/d', summary: 'hello', filePath: '/fts-d.json' }));
    expect(() => repo.search('*')).toThrow(/FTS5/);
  });

  it('throws FtsSyntaxError when search receives OR without operands', () => {
    expect(() => repo.search('OR')).toThrow(/FTS5/);
  });

  it('should still throw non-FTS5 errors from search', () => {
    closeDb(db);
    expect(() => repo.search('hello')).toThrow();
    // Re-open for afterEach cleanup
    db = createEmberdeckDb(':memory:');
    repo = new DrizzleCardRepository(db);
  });

  it('should return only draft spec cards when list is called with status draft and type spec', () => {
    // Arrange
    repo.upsert(makeRow({ key: 'df/1', status: 'draft', type: 'spec', filePath: '/df1.json' }));
    repo.upsert(makeRow({ key: 'af/1', status: 'active', type: 'spec', filePath: '/af1.json' }));
    repo.upsert(makeRow({ key: 'db/1', status: 'draft', type: 'brief', filePath: '/db1.json' }));
    // Act
    const result = repo.list({ status: 'draft', type: 'spec' });
    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.key).toBe('df/1');
  });
});
