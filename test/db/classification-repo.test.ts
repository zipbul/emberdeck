import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createEmberdeckDb, closeDb } from '../../src/db/connection';
import { DrizzleCardRepository } from '../../src/db/card-repo';
import { DrizzleClassificationRepository } from '../../src/db/classification-repo';
import { tag } from '../../src/db/schema';
import type { EmberdeckDb } from '../../src/db/connection';
import type { CardRow } from '../../src/db/repository';

// ---- Setup ----

let db: EmberdeckDb;
let cardRepo: DrizzleCardRepository;
let repo: DrizzleClassificationRepository;

beforeEach(() => {
  db = createEmberdeckDb(':memory:');
  cardRepo = new DrizzleCardRepository(db);
  repo = new DrizzleClassificationRepository(db);
});

afterEach(() => {
  closeDb(db);
});

// ---- Helpers ----

function insertCard(key: string): void {
  const row: CardRow = {
    key,
    summary: `Card ${key}`,
    status: 'draft',
    type: 'spec',
    parent: null,
    boundaryJson: null,
    namespacesJson: null,
    body: null,
    glossaryJson: '[]',
    filePath: `/cards/${key}.card.md`,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  cardRepo.upsert(row);
}

// ---- Tests ----

describe('DrizzleClassificationRepository', () => {
  // HP
  it('should create tag and return it when replaceTags is called with new tag name', () => {
    // Arrange
    insertCard('t1');
    // Act
    repo.replaceTags('t1', ['brief']);
    // Assert
    expect(repo.findTagsByCard('t1')).toContain('brief');
  });

  it('should return mapped tag names when findTagsByCard is called after replaceTags', () => {
    // Arrange
    insertCard('t2');
    repo.replaceTags('t2', ['alpha', 'beta']);
    // Act
    const result = repo.findTagsByCard('t2');
    // Assert
    expect(result).toContain('alpha');
    expect(result).toContain('beta');
    expect(result).toHaveLength(2);
  });

  it('should remove all card_tag mappings when deleteByCardKey is called', () => {
    // Arrange
    insertCard('del');
    repo.replaceTags('del', ['tg']);
    // Act
    repo.deleteByCardKey('del');
    // Assert
    expect(repo.findTagsByCard('del')).toEqual([]);
  });

  // NE
  it('should delete existing tag mappings when replaceTags is called with empty array', () => {
    // Arrange
    insertCard('e2');
    repo.replaceTags('e2', ['existing-tag']);
    // Act
    repo.replaceTags('e2', []);
    // Assert
    expect(repo.findTagsByCard('e2')).toEqual([]);
  });

  it('should return empty array when findTagsByCard is called for card with no tags', () => {
    // Arrange
    insertCard('nt');
    // Act / Assert
    expect(repo.findTagsByCard('nt')).toEqual([]);
  });

  // pruneOrphans

  // 3. [NE] Delete orphan tag
  it('should remove tag row when no card_tag mapping references it', () => {
    // Arrange
    insertCard('pk-c');
    repo.replaceTags('pk-c', ['orphan-tag']);
    repo.replaceTags('pk-c', []); // mapping removed -> orphan
    // Act
    repo.pruneOrphans();
    // Assert
    const rows = db.select({ name: tag.name }).from(tag).all();
    expect(rows.map((r) => r.name)).not.toContain('orphan-tag');
  });

  // 5. [ST] After card deletion, pruneOrphans -> tag rows deleted
  it('should delete tag rows that became orphan after card is deleted', () => {
    // Arrange
    insertCard('pk-e');
    repo.replaceTags('pk-e', ['tag-del']);
    cardRepo.deleteByKey('pk-e'); // CASCADE removes card_tag mappings, tag rows remain
    // Act
    repo.pruneOrphans();
    // Assert
    const tagRows = db.select({ name: tag.name }).from(tag).all();
    expect(tagRows.map((r) => r.name)).not.toContain('tag-del');
  });
});
